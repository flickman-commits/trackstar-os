/**
 * Watch for official results going up. Some timers post the official list a
 * day or more after race day (NYRR: NYC 2026 had nothing on results.nyrr.org
 * on race night). A scraper that can tell "posted" from "not yet" has a
 * resultsPosted() method; for every race of the last two weeks with one, this
 * checks on each auto-import run (every 10 minutes). The first time the
 * results are up it posts to Slack and remembers when (SystemConfig
 * results_posted:<race>|<year>). From then on every run works through that
 * race year's open orders with no result, as many as fit in its time box, so
 * a few hundred orders are looked up within the hour instead of on the
 * two-hourly retry; found ones render on their own. A second Slack message
 * says when the backlog is done.
 *
 * Instant Lookup needs nothing: a "not posted yet" answer is never cached
 * (api/_routes/public/results-lookup.js), so the first search after posting finds it.
 */
import prisma from '../../db.js'
import { researchService } from '../../services/ResearchService.js'
import { getScraperForRace, getCanonicalRaceName } from '../../scrapers/index.js'
import { ensureOverridesLoaded } from '../../scrapers/scraperOverrides.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { KNOWN_YEAR } from '../orders/yearUnknown.js'

const DAY = 24 * 60 * 60 * 1000
const WATCH_DAYS = 14
// How long one run may spend looking orders up (the import runs every 10 minutes, 300s budget).
const RESEARCH_BUDGET_MS = 120 * 1000
const BACKLOG_DAYS = 3
const POSTED = 'results_posted:'

// A ping for the team: #trackstar-alerts.
const post = text => slackTo('alerts', text, { timeoutMs: 8000 })

export async function watchOfficialResults() {
  await ensureOverridesLoaded()
  const now = Date.now()
  const out = { posted: [], researched: 0, found: 0 }

  // 1. Newly posted results.
  const races = await prisma.race.findMany({
    where: { raceDate: { gte: new Date(now - WATCH_DAYS * DAY), lte: new Date(now) } },
    select: { raceName: true, year: true },
  })
  const seen = new Set()
  for (const r of races) {
    const name = getCanonicalRaceName(r.raceName) || r.raceName
    const key = `${POSTED}${name}|${r.year}`
    if (seen.has(key)) continue
    seen.add(key)
    let scraper
    try { scraper = getScraperForRace(name, r.year) } catch { continue }
    if (typeof scraper.resultsPosted !== 'function') continue
    if (await prisma.systemConfig.findUnique({ where: { key } })) continue
    if (!(await scraper.resultsPosted())) continue
    const at = new Date().toISOString()
    await prisma.systemConfig.create({ data: { key, value: at } })
    out.posted.push({ race: name, year: r.year })
    const waiting = (await waitingOrders(name, r.year, new Date(at))).length
    await post(`:checkered_flag: *Official ${slackText(name)} ${r.year} results are posted.* Instant Lookup finds runners now. Looking up the ${waiting} waiting order${waiting === 1 ? '' : 's'} over the next runs; found ones render on their own.`).catch(() => {})
  }

  // 2. The backlog of every race year posted in the last few days, time boxed.
  const started = Date.now()
  const posted = await prisma.systemConfig.findMany({ where: { key: { startsWith: POSTED } } })
  for (const row of posted) {
    const postedAt = new Date(row.value)
    if (isNaN(postedAt) || now - postedAt.getTime() > BACKLOG_DAYS * DAY) continue
    const [name, y] = row.key.slice(POSTED.length).split('|')
    const year = Number(y)
    const orders = await waitingOrders(name, year, postedAt)
    for (const o of orders) {
      if (Date.now() - started > RESEARCH_BUDGET_MS) return out
      try {
        const { runnerResearch } = await researchService.researchOrder(o.orderNumber)
        // Research stamps researchedAt only on a find; stamp the rest (several
        // runners share the name, no match) so they leave the backlog for a person.
        await prisma.order.updateMany({ where: { orderNumber: o.orderNumber }, data: { researchedAt: new Date() } })
        out.researched++
        if (runnerResearch?.researchStatus === 'found') out.found++
      } catch (err) {
        console.warn(`[resultsWatch] ${o.orderNumber}: ${err.message}`)
      }
    }
    // Every order has been looked up since posting: say so once.
    const doneKey = `results_done:${name}|${year}`
    if (!orders.length || !(await waitingOrders(name, year, postedAt)).length) {
      if (!(await prisma.systemConfig.findUnique({ where: { key: doneKey } }))) {
        await prisma.systemConfig.create({ data: { key: doneKey, value: new Date().toISOString() } })
        const missing = await stillMissing(name, year)
        await post(`:white_check_mark: *${slackText(name)} ${year}: every waiting order has been looked up* in the official results.${missing ? ` ${missing} still have no result (name or year mismatch); they are under Runner not found.` : ''}`).catch(() => {})
      }
    }
  }
  return out
}

/** Open standard orders for a race year with no result yet. */
function openWithoutResult(year) {
  return prisma.order.findMany({
    where: {
      trackstarOrderType: 'standard',
      status: { notIn: ['completed', 'flagged'] },
      hadNoTime: false,
      OR: [{ raceYear: year, yearOverride: null }, { yearOverride: year }],
      NOT: { runnerResearch: { some: { researchStatus: 'found', officialTime: { not: null } } } },
      AND: [KNOWN_YEAR],
    },
    select: { orderNumber: true, raceName: true, raceNameOverride: true, researchedAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

/** Those not looked up since the results were posted. */
async function waitingOrders(name, year, postedAt) {
  const orders = await openWithoutResult(year)
  return orders.filter(o => getCanonicalRaceName(o.raceNameOverride ?? o.raceName) === name && (!o.researchedAt || o.researchedAt < postedAt))
}

async function stillMissing(name, year) {
  const orders = await openWithoutResult(year)
  return orders.filter(o => getCanonicalRaceName(o.raceNameOverride ?? o.raceName) === name).length
}
