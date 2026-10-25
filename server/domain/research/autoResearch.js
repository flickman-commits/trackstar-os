/**
 * Research the orders that arrived in this run of the 10-minute auto-import,
 * and only those: every order is researched once, as it comes in. Orders
 * already in the tool are never picked up here; a person re-runs research
 * from the order after fixing a name or year, or once a scraper exists.
 * An Instant Lookup result is recorded by customerResults.js before this
 * runs, so those orders already have research and are skipped.
 *
 * Races that have not happened yet, or ran in the last two days (results are
 * usually not posted yet), are left alone on arrival. autoResearchAfterRace
 * picks those orders up from race day on, and keeps retrying the ones whose
 * results are not up yet, so a pre-race order is not stamped "not found" and
 * then never looked at again.
 */
import prisma from '../../db.js'
import { researchService } from '../../services/ResearchService.js'
import { hasScraperForRace, getCanonicalRaceName } from '../../scrapers/index.js'
import { ensureOverridesLoaded } from '../../scrapers/scraperOverrides.js'

const DAY = 24 * 60 * 60 * 1000
// Results are looked for this long after race day, and no longer: older
// unresearched orders are a person's call (Re-run research on the order).
const RESULTS_AFTER_DAYS = 2, CATCH_UP_DAYS = 21

async function researchEach(orders, limit, out) {
  for (const o of orders) {
    if (out.researched + out.failed >= limit) break
    try {
      const { runnerResearch } = await researchService.researchOrder(o.orderNumber)
      out.researched++
      if (runnerResearch?.researchStatus === 'found') out.found++
      out.orders.push(`${o.orderNumber}: ${runnerResearch?.researchStatus}`)
    } catch (e) {
      out.failed++
      out.orders.push(`${o.orderNumber}: error ${e.message.slice(0, 80)}`)
    }
  }
  return out
}

export async function autoResearchNew({ since, limit = 20 } = {}) {
  if (!since) throw new Error('autoResearchNew needs the time this import started')
  await ensureOverridesLoaded()
  const candidates = await prisma.order.findMany({
    where: {
      trackstarOrderType: 'standard',
      status: { notIn: ['completed', 'flagged'] },
      runnerResearch: { none: {} },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: limit * 6,
    select: { orderNumber: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true },
  })
  const thisYear = new Date().getUTCFullYear(), resultsBy = Date.now() - RESULTS_AFTER_DAYS * DAY
  const out = { researched: 0, found: 0, failed: 0, skipped: 0, orders: [] }
  const ready = []
  for (const o of candidates) {
    const race = o.raceNameOverride ?? o.raceName, year = o.yearOverride ?? o.raceYear
    if (!race || !year || !hasScraperForRace(race) || year > thisYear) { out.skipped++; continue }
    // Not run yet, too recent for results, or no date on file: the catch-up handles it.
    const row = await prisma.race.findFirst({ where: { raceName: race, year }, select: { raceDate: true } })
    if (year === thisYear && (!row?.raceDate || row.raceDate.getTime() > resultsBy)) { out.skipped++; continue }
    ready.push(o)
  }
  return researchEach(ready, limit, out)
}

/**
 * The orders that came in before their race, from race day on. Every open
 * order for a race in the last three weeks is looked up again when it has:
 *   - no research yet, or "race not run yet" (researched before race day),
 *   - a result with no finish time (a bib found before the runner finished),
 *   - "not found" or a site error in the first two days, while results are
 *     still going up.
 * Research fills only the missing time on a timeless result
 * (ResearchService.getOrFetchRunnerData). Retries are spaced out
 * (researchedAt) so runners still on course do not starve the rest, and the
 * least recently tried go first. Runs on each import.
 */
const MIN = 60 * 1000
function retryAfter(status, raceDate, now) {
  const fresh = now - raceDate.getTime() < RESULTS_AFTER_DAYS * DAY
  if (status === 'found') return fresh ? 30 * MIN : 12 * 60 * MIN
  if (status === 'not_found' || status === 'upstream_error') return fresh ? 2 * 60 * MIN : null
  return 0 // never researched, or researched before race day
}

export async function autoResearchAfterRace({ limit = 10 } = {}) {
  await ensureOverridesLoaded()
  const now = Date.now()
  const races = await prisma.race.findMany({
    where: { raceDate: { gte: new Date(now - CATCH_UP_DAYS * DAY), lte: new Date(now) } },
    select: { raceName: true, year: true, raceDate: true },
  })
  const out = { researched: 0, found: 0, failed: 0, skipped: 0, orders: [] }
  if (!races.length) return out
  // Race rows and orders do not always spell a race the same way ("NYC
  // Marathon", "New York City Marathon"), so match on the canonical name.
  const dates = new Map(races.map(r => [`${getCanonicalRaceName(r.raceName)}|${r.year}`, r.raceDate]))
  const years = [...new Set(races.map(r => r.year))]
  const orders = await prisma.order.findMany({
    where: {
      trackstarOrderType: 'standard',
      status: { notIn: ['completed', 'flagged'] },
      hadNoTime: false,
      OR: [{ raceYear: { in: years } }, { yearOverride: { in: years } }],
      AND: [{ OR: [
        { runnerResearch: { none: {} } },
        { runnerResearch: { some: { researchStatus: 'race_not_run' } } },
        { runnerResearch: { some: { researchStatus: 'found', officialTime: null } } },
        { runnerResearch: { some: { researchStatus: { in: ['not_found', 'upstream_error'] }, source: 'scraper' } } },
      ] }],
    },
    take: 500,
    select: { id: true, orderNumber: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true, researchedAt: true, runnerResearch: { select: { researchStatus: true } } },
  })
  const ready = []
  for (const o of orders) {
    const race = o.raceNameOverride ?? o.raceName, year = o.yearOverride ?? o.raceYear
    const raceDate = race && dates.get(`${getCanonicalRaceName(race)}|${year}`)
    if (!raceDate || !hasScraperForRace(race)) continue
    const status = o.runnerResearch.find(r => r.researchStatus !== 'race_not_run')?.researchStatus || 'none'
    const wait = retryAfter(status, raceDate, now)
    if (wait === null || (wait && o.researchedAt && now - o.researchedAt.getTime() < wait)) { out.skipped++; continue }
    ready.push(o)
  }
  ready.sort((a, b) => (a.researchedAt?.getTime() || 0) - (b.researchedAt?.getTime() || 0))
  const res = await researchEach(ready, limit, out)
  // Stamp every attempt, found or not, so the next run tries someone else.
  const tried = ready.slice(0, out.researched + out.failed).map(o => o.id)
  if (tried.length) await prisma.order.updateMany({ where: { id: { in: tried } }, data: { researchedAt: new Date() } })
  return res
}
