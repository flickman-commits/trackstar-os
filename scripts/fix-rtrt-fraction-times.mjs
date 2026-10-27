/**
 * fix-rtrt-fraction-times.mjs
 *
 * RTRT races (Marine Corps, Illinois and the rest) printed a second high:
 * the scraper rounded the fraction (4:35:30.654 -> 4:35:31) where the
 * official results cut it (4:35:30). The scraper now cuts it. This reads
 * every open order's RTRT result again by bib and, where the stored time is
 * exactly one second high, writes the right time and pace, then renders a
 * new design for any order whose design is not approved yet (no design, a
 * pending review, rejected or failed). Approved and sent prints are listed,
 * not touched.
 *
 * Usage:
 *   node scripts/fix-rtrt-fraction-times.mjs            # dry run, no writes
 *   node scripts/fix-rtrt-fraction-times.mjs --apply    # fix and re-render
 */
import 'dotenv/config'
import { readdir } from 'node:fs/promises'
import prisma from '../server/db.js'
import { getScraperForRace } from '../server/scrapers/index.js'
import { ensureOverridesLoaded } from '../server/scrapers/scraperOverrides.js'
import { checkOrder, createJob } from '../server/domain/render/jobs.js'

const APPLY = process.argv.includes('--apply')
const seconds = t => String(t || '').split(':').map(Number).reduce((s, n) => s * 60 + n, 0)

// The races whose config is on RTRT (a year can move elsewhere through
// yearOverrides; the scraper built for that year says which it is).
const names = []
for (const f of await readdir(new URL('../server/scrapers/configs/', import.meta.url))) {
  if (!f.endsWith('.js')) continue
  const cfg = (await import(`../server/scrapers/configs/${f}`)).default
  if (cfg?.platform === 'rtrt') names.push(cfg.raceName)
}
await ensureOverridesLoaded()

const rows = await prisma.runnerResearch.findMany({
  where: { researchStatus: 'found', officialTime: { not: null }, bibNumber: { not: null }, race: { raceName: { in: names } }, order: { status: { not: 'completed' }, trackstarOrderType: 'standard' } },
  select: { id: true, bibNumber: true, officialTime: true, officialPace: true, orderId: true, race: { select: { raceName: true, year: true } }, order: { select: { id: true, orderNumber: true, shopifyOrderData: true, customerFinishTime: true } } },
})
console.log(`${rows.length} open orders with an RTRT result (${names.join(', ')})\n`)

const quiet = console.log
const counts = { checked: 0, high: 0, fixed: 0, rerendered: 0, approved: 0, sent: 0, cannot: 0 }
for (const r of rows) {
  const name = String(r.order.shopifyOrderData?.name || r.order.orderNumber)
  const scraper = getScraperForRace(r.race.raceName, r.race.year)
  if (!scraper || scraper.constructor.name !== 'RTRTScraper') continue
  console.log = () => {}
  const fresh = await scraper.searchRunnerByBib(r.bibNumber).catch(e => ({ error: e.message }))
  console.log = quiet
  counts.checked++
  if (!fresh?.officialTime) { console.log(`${name}: ${r.race.raceName} ${r.race.year} bib ${r.bibNumber}: no result read (${fresh?.error || 'not found'}), left alone`); continue }
  if (seconds(r.officialTime) - seconds(fresh.officialTime) !== 1) continue
  counts.high++

  const last = await prisma.renderJob.findFirst({ where: { orderId: r.orderId }, orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, review: true, arteloSentAt: true } })
  const state = !last ? 'no design' : last.arteloSentAt ? 'sent to production' : last.review === 'approved' ? 'approved' : last.status === 'done' ? `review ${last.review}` : last.status
  console.log(`${name}: ${r.race.raceName} ${r.race.year} bib ${r.bibNumber}: ${r.officialTime} -> ${fresh.officialTime} (${state})`)
  if (!APPLY) continue

  await prisma.runnerResearch.update({ where: { id: r.id }, data: { officialTime: fresh.officialTime, ...(fresh.officialPace ? { officialPace: fresh.officialPace } : {}) } })
  if (r.order.customerFinishTime === r.officialTime) await prisma.order.update({ where: { id: r.orderId }, data: { customerFinishTime: fresh.officialTime } })
  await prisma.orderComment.create({ data: { orderId: r.orderId, authorName: 'Trackstar', text: `Finish time corrected from ${r.officialTime} to ${fresh.officialTime}: the results show the time cut to the second, and we had rounded it up.` } })
  counts.fixed++

  if (last?.arteloSentAt) { counts.sent++; continue }
  if (last?.review === 'approved') { counts.approved++; continue }
  // Not approved: close a design waiting on review (it shows the old time) and render again.
  if (last?.status === 'done' && last.review === 'pending') {
    await prisma.renderJob.update({ where: { id: last.id }, data: { review: 'closed', reviewNote: 'Finish time corrected (a second high)', reviewedAt: new Date() } })
  }
  if (last && ['queued', 'rendering'].includes(last.status)) {
    console.log(`  a render is already ${last.status} with the old time; re-render it once it finishes`)
    continue
  }
  const { ok, reasons } = await checkOrder(r.orderId)
  if (!ok) { counts.cannot++; console.log(`  cannot render: ${reasons.join('. ')}`); continue }
  const job = await createJob({ orderId: r.orderId, requestedBy: 'system' })
  counts.rerendered++
  console.log(`  queued design v${job.version}`)
}

console.log(`\nChecked ${counts.checked}; ${counts.high} a second high.${APPLY
  ? ` Fixed ${counts.fixed}; re-rendered ${counts.rerendered}; ${counts.approved} approved and not sent (left as is); ${counts.sent} already sent to production; ${counts.cannot} could not render.`
  : ' Dry run; add --apply to fix them.'}`)
await prisma.$disconnect()
