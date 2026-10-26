/**
 * The header's pulse on getting standard orders out on time. Each order has
 * its own deadline, a day and a half after we could start on it (two days
 * until Oct 26, 2026), and the questions
 * are: of the orders whose deadline passed in the window, how many were out
 * before it; and which open orders are past theirs right now.
 *
 * Measured by deadline, not by completion, so an open order counts as late
 * the moment it misses (not the day someone finally finishes it), and
 * clearing an old backlog does not drag this week down: those orders were
 * already counted late in the week their deadline went by.
 *
 * The clock starts at the order, or at race day for an order placed before
 * the race. It pauses for what is not ours:
 *   results   from race day until the first runner of that race year was
 *             found by a scraper (the results went up), for at most three
 *             days; past that, a missing scraper is ours to fix.
 *   customer  while a Support conversation with them waited on their reply
 *             (the same pause as fulfillmentTime.js).
 * Completion is the first "order.complete" Activity Log line, as in
 * fulfillmentTime.js. Orders completed with no line (the Artelo sync closed
 * them) have no time of ours and are left out. Flagged orders are left out.
 */
import prisma from '../../db.js'
import { GOAL_HOURS, customerWaits, waitedWithin } from './fulfillmentTime.js'

const HOUR = 3600e3
const DAY = 24 * HOUR
const RESULTS_PAUSE_MAX = 3 * DAY

const CACHE_MS = 60_000
let cached = null

export async function computeOnTime({ days = 7 } = {}) {
  if (cached && cached.days === days && Date.now() - cached.at < CACHE_MS) return cached.value
  const value = await computeOnTimeFresh(days)
  cached = { at: Date.now(), days, value }
  return value
}

async function computeOnTimeFresh(days) {
  const now = new Date()
  const since = new Date(now.getTime() - days * DAY)
  // A deadline in the window belongs to an order started within the window
  // plus the deadline and the longest pauses; a month back covers it. Open
  // orders are read whatever their age, for the late list.
  const floor = new Date(since.getTime() - 30 * DAY)
  const orders = await prisma.order.findMany({
    where: { trackstarOrderType: 'standard', status: { not: 'flagged' }, OR: [{ createdAt: { gte: floor } }, { status: { not: 'completed' } }] },
    select: { orderNumber: true, status: true, createdAt: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true, customerEmail: true },
  })
  const raceKey = o => `${o.raceNameOverride ?? o.raceName}|${o.yearOverride ?? o.raceYear}`
  const keys = [...new Set(orders.map(raceKey))]
  const [races, events, waits] = await Promise.all([
    prisma.race.findMany({
      where: { OR: keys.map(k => { const [raceName, year] = k.split('|'); return { raceName, year: Number(year) } }) },
      select: { id: true, raceName: true, year: true, raceDate: true },
    }),
    prisma.auditEvent.findMany({ where: { action: 'order.complete', createdAt: { gte: floor } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, detail: true } }),
    customerWaits(orders.map(o => o.customerEmail)),
  ])
  const firstFound = races.length ? await prisma.runnerResearch.groupBy({
    by: ['raceId'],
    where: { raceId: { in: races.map(r => r.id) }, researchStatus: 'found', source: 'scraper' },
    _min: { createdAt: true },
  }) : []
  const foundAt = new Map(firstFound.map(f => [f.raceId, f._min.createdAt]))
  const race = new Map(races.map(r => [`${r.raceName}|${r.year}`, { date: r.raceDate, resultsAt: foundAt.get(r.id) || null }]))
  const completedAt = new Map()
  for (const e of events) { const n = e.detail?.orderNumber; if (n && !completedAt.has(n)) completedAt.set(n, e.createdAt) }

  let due = 0, onTime = 0
  const late = []
  for (const o of orders) {
    const r = race.get(raceKey(o))
    const rd = r?.date || null
    const start = rd && rd > o.createdAt ? rd : o.createdAt
    // Race not run yet (the pipeline's rule: no date known and this year or later counts as not run).
    if (start > now || (!rd && (o.yearOverride ?? o.raceYear) >= now.getUTCFullYear())) continue
    const done = completedAt.get(o.orderNumber) || null
    if (o.status === 'completed' && !done) continue  // closed by the Artelo sync: no time of ours
    const end = done || now
    // Waiting for results: race day until the first scraper find, capped.
    let paused = 0
    if (rd && rd <= end) {
      const resultsUp = r.resultsAt && r.resultsAt > rd ? r.resultsAt : (r.resultsAt ? rd : now)
      const stop = new Date(Math.min(resultsUp.getTime(), rd.getTime() + RESULTS_PAUSE_MAX, end.getTime()))
      paused += Math.max(0, stop.getTime() - Math.max(start.getTime(), rd.getTime()))
    }
    paused += waitedWithin(waits, o.customerEmail, start, end)
    const deadline = new Date(start.getTime() + GOAL_HOURS * HOUR + paused)
    const made = Boolean(done && done <= deadline)
    if (deadline >= since && deadline <= now) { due++; if (made) onTime++ }
    if (!done && deadline <= now) late.push({ orderNumber: o.orderNumber, start })
  }
  late.sort((a, b) => a.start - b.start)
  return {
    days,
    goalHours: GOAL_HOURS,
    due,
    onTime,
    onTimePct: due ? Math.round((100 * onTime) / due) : null,
    lateNow: late.length,
    oldestLateDays: late.length ? Math.floor((now - late[0].start) / DAY) : null,
    lateOrders: late.map(l => l.orderNumber),
  }
}
