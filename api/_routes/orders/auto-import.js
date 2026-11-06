/**
 * /api/orders/auto-import - pulls new orders from Artelo every 10 minutes
 * (vercel.json), so nobody has to press Import. Scraping is left to its own
 * pipeline; this only brings orders in. One exception: a result the customer
 * verified or typed in Instant Lookup is recorded as the order's research
 * record right away, so it reads the same everywhere (customerResults.js).
 * Then the orders this run brought in are researched (autoResearch.js), so
 * every order is researched once, as it arrives, without anyone clicking,
 * and orders placed before their race are researched once it is two days past.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { processOrders } from '../../../server/processOrders.js'
import { runLockedImport } from '../../../server/lib/importStamp.js'
import { syncShopifyBulkOrders } from '../../../server/domain/bulk/shopifyBulk.js'
import { applyCustomerResults, fillCustomerPace } from '../../../server/domain/research/customerResults.js'
import { autoResearchNew, autoResearchAfterRace } from '../../../server/domain/research/autoResearch.js'
import { watchOfficialResults } from '../../../server/domain/research/resultsWatch.js'
import { autoQueueRenders } from '../../../server/domain/render/jobs.js'
import { researchRacedRunners } from '../../../server/domain/bulk/bulkOrders.js'
import { closeShopifyCancels } from '../../../server/domain/orders/shopifyCancels.js'
import { deliverPending } from '../../../server/domain/render/deliver.js'
import { uploadPending } from '../../../server/domain/render/artelo.js'
import { refreshUnpaidPhotoOrders } from '../../../server/domain/orders/photoRefresh.js'
import { runPhotoLater } from '../../../server/domain/orders/photoLater.js'
import { checkStorageUploads } from '../../../server/lib/storageHealth.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const started = new Date()
    // Outside the import lock: an upload outage must be reported even when an import is stuck.
    const storageCheck = checkStorageUploads().catch(err => console.error('[orders.auto-import] storage check failed:', err.message))
    // The lock is held for the whole run, not just the import: two overlapping
    // runs used to upload the same PDF to Drive twice and double-count
    // customers served.
    const out = await runLockedImport(async () => {
      const imported = await processOrders({ runResearch: false, verbose: false })
      if (imported.imported) console.log(`[orders.auto-import] imported ${imported.imported}, updated ${imported.updated || 0}`)
      const applied = await applyCustomerResults({ limit: 100 }).catch(err => { console.error('[orders.auto-import] customer results failed:', err.message); return null })
      if (applied?.found) console.log(`[orders.auto-import] customer results: ${applied.applied} recorded, ${applied.failed} failed`)
      const paced = await fillCustomerPace({ limit: 100 }).catch(err => { console.error('[orders.auto-import] customer pace failed:', err.message); return null })
      if (paced?.filled) console.log(`[orders.auto-import] customer pace filled for ${paced.filled}`)
      const researched = await autoResearchNew({ since: started }).catch(err => { console.error('[orders.auto-import] auto research failed:', err.message); return null })
      if (researched?.researched || researched?.failed) console.log(`[orders.auto-import] researched ${researched.researched} (${researched.found} found), ${researched.failed} errors: ${researched.orders.join(', ')}`)
      // Orders that came in before their race, now that results should be posted.
      const caughtUp = await autoResearchAfterRace({ limit: 10 }).catch(err => { console.error('[orders.auto-import] post-race research failed:', err.message); return null })
      if (caughtUp?.researched || caughtUp?.failed) console.log(`[orders.auto-import] post-race research ${caughtUp.researched} (${caughtUp.found} found), ${caughtUp.failed} errors: ${caughtUp.orders.join(', ')}`)
      // Official results that went up since the last run (NYRR posts a day or so late): Slack, and research those orders now.
      const watch = await watchOfficialResults().catch(err => { console.error('[orders.auto-import] results watch failed:', err.message); return null })
      for (const p of watch?.posted || []) console.log(`[orders.auto-import] official results posted: ${p.race} ${p.year}`)
      if (watch?.researched) console.log(`[orders.auto-import] posted-results backlog: researched ${watch.researched} (${watch.found} found)`)
      // Prints waiting on a photo payment: re-read those orders from Shopify so a payment shows.
      const photos = await refreshUnpaidPhotoOrders().catch(err => { console.error('[orders.auto-import] photo refresh failed:', err.message); return null })
      if (photos?.updated) console.log(`[orders.auto-import] photo payments refreshed: ${photos.updated} of ${photos.checked} checked`)
      // Pre-orders whose photo comes after the race: the upload link, one reminder, and at the deadline print without it and refund.
      const later = await runPhotoLater({ log: m => console.log(`[orders.auto-import] photo later: ${m}`) }).catch(err => { console.error('[orders.auto-import] photo later failed:', err.message); return null })
      if (later && (later.requested || later.reminded || later.closed || later.unpaid || later.failed)) console.log(`[orders.auto-import] photo later: ${later.requested} emailed, ${later.reminded} reminded, ${later.closed} closed at the deadline, ${later.unpaid} unpaid, ${later.failed} failed`)
      // Orders that have everything get their print rendered without anyone clicking.
      const renders = await autoQueueRenders().catch(err => { console.error('[orders.auto-import] auto renders failed:', err.message); return null })
      if (renders?.queued) console.log(`[orders.auto-import] renders queued: ${renders.queued}`)
      // Approved prints that have not reached the Drive Orders folder yet.
      const sent = await deliverPending().catch(err => { console.error('[orders.auto-import] deliveries failed:', err.message); return null })
      if (sent && (sent.delivered || sent.failed)) console.log(`[orders.auto-import] prints saved to Drive: ${sent.delivered}, failed: ${sent.failed}`)
      const lib = await uploadPending().catch(err => { console.error('[orders.auto-import] Artelo uploads failed:', err.message); return null })
      if (lib && (lib.uploaded || lib.failed)) console.log(`[orders.auto-import] prints in the Artelo library: ${lib.uploaded}, failed: ${lib.failed}`)
      // Bulk runners whose race is over and who are not researched yet, a few each run.
      const bulkResearch = await researchRacedRunners({ limit: 10 }).catch(err => { console.error('[orders.auto-import] bulk research failed:', err.message); return null })
      if (bulkResearch?.researched) console.log(`[orders.auto-import] bulk research: ${bulkResearch.runs.join(', ')}`)
      // Bulk runs paid through Shopify: link or create their runs, mark paid.
      const bulk = await syncShopifyBulkOrders().catch(err => { console.error('[orders.auto-import] bulk sync failed:', err.message); return null })
      if (bulk && (bulk.created || bulk.linked || bulk.paid)) console.log(`[orders.auto-import] bulk: ${bulk.created} created, ${bulk.linked} linked, ${bulk.paid} paid`)
      // Orders cancelled in Shopify itself leave the queue as complete.
      const cancels = await closeShopifyCancels().catch(err => { console.error('[orders.auto-import] Shopify cancels failed:', err.message); return null })
      if (cancels?.closed) console.log(`[orders.auto-import] closed ${cancels.closed} order(s) cancelled in Shopify`)
      return imported
    })
    await storageCheck
    if (out.skipped) return res.status(200).json({ skipped: out.skipped })
    return res.status(200).json({ imported: out.imported || 0, updated: out.updated || 0, skipped: out.skipped || 0, lastImportedAt: out.lastImportedAt || null })
  } catch (error) {
    console.error('[API /orders/auto-import]', error)
    return res.status(500).json({ error: 'Auto import failed' })
  }
}
