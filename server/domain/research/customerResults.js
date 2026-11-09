/**
 * Instant Lookup results become research records.
 *
 * The research record is the one source of truth for a runner's result.
 * Scrapers write it, hand edits write it, and a result the customer verified
 * or typed in the storefront widget must too, or every reader has to merge
 * two places and they drift (one tag says Verified, another says Needs
 * research; a check reaches the race through one path and misses it).
 *
 * The import's research step does this (ResearchService.applyVerifiedResult),
 * but the ten-minute auto-import runs with research off, so its orders were
 * left with lookup data on the order and no record. This closes that gap:
 * every standard order with lookup data and no record gets its record, on
 * every auto-import and from the backfill script. Nothing is scraped here.
 */
import prisma from '../../db.js'
import { ResearchService } from '../../services/ResearchService.js'
import { paceFromTypedTime } from './customerPace.js'
import { onlyEventFor } from '../../scrapers/index.js'

export async function ordersMissingCustomerResult(limit = 500) {
  return prisma.order.findMany({
    where: {
      trackstarOrderType: 'standard',
      OR: [{ customerBib: { not: null } }, { customerFinishTime: { not: null } }],
      // No result yet, or only a failed lookup: what the customer typed beats
      // "not found" (two runners on one print, a name the results spell differently).
      runnerResearch: { none: { researchStatus: 'found' } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, orderNumber: true, raceName: true, raceYear: true, lookupVerified: true, lookupOutcome: true, customerBib: true, customerFinishTime: true, status: true },
  })
}

/**
 * Write the missing records. Returns what it did, order by order.
 * @param {{ dryRun?: boolean, limit?: number, log?: (s: string) => void }} opts
 */
export async function applyCustomerResults({ dryRun = false, limit = 500, log = () => {} } = {}) {
  const orders = await ordersMissingCustomerResult(limit)
  const service = new ResearchService()
  const out = { found: orders.length, applied: 0, failed: 0, rows: [] }
  for (const o of orders) {
    const verified = o.lookupVerified === true
    const row = { orderNumber: o.orderNumber, race: `${o.raceName} ${o.raceYear}`, source: verified ? 'customer_verified' : 'customer_supplied', bib: o.customerBib, time: o.customerFinishTime }
    if (dryRun) { out.rows.push({ ...row, result: 'would apply' }); log(`would apply ${row.source} for ${o.orderNumber} (${row.race}, bib ${row.bib || '-'}, ${row.time || 'no time'})`); continue }
    try {
      await service.applyVerifiedResult(o.orderNumber, { verified })
      out.applied++
      out.rows.push({ ...row, result: 'applied' })
      log(`applied ${row.source} for ${o.orderNumber}`)
    } catch (e) {
      out.failed++
      out.rows.push({ ...row, result: `failed: ${e.message}` })
      log(`FAILED ${o.orderNumber}: ${e.message}`)
    }
  }
  return out
}

/**
 * A result the customer typed, saved before its pace could be worked out
 * ("2:47" with no seconds, "3:28:17.1"): fill the pace in from their time
 * (customerPace.js), so the order can render. Their time is not touched.
 * Runs on every auto-import; the backfill script runs it by hand.
 * @param {{ dryRun?: boolean, limit?: number, log?: (s: string) => void }} opts
 */
export async function fillCustomerPace({ dryRun = false, limit = 500, log = () => {} } = {}) {
  const rows = await prisma.runnerResearch.findMany({
    where: { source: { in: ['customer_supplied', 'customer_verified'] }, researchStatus: 'found', officialPace: null, officialTime: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, officialTime: true, eventType: true, researchNotes: true, order: { select: { orderNumber: true, customerEventType: true, raceName: true, raceNameOverride: true } } },
  })
  const out = { checked: rows.length, filled: 0, rows: [] }
  for (const r of rows) {
    const pace = paceFromTypedTime(r.officialTime, r.eventType || r.order?.customerEventType || onlyEventFor(r.order?.raceNameOverride ?? r.order?.raceName))
    if (!pace) continue
    out.rows.push({ orderNumber: r.order?.orderNumber, time: r.officialTime, pace })
    log(`${dryRun ? 'would fill' : 'filled'} ${r.order?.orderNumber}: ${r.officialTime} -> ${pace}/mi`)
    if (dryRun) continue
    await prisma.runnerResearch.update({ where: { id: r.id }, data: { officialPace: pace, researchNotes: `${r.researchNotes ? `${r.researchNotes} ` : ''}Pace ${pace} calculated from their time.` } })
    out.filled++
  }
  return out
}
