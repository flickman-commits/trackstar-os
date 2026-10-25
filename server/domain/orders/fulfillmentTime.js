/**
 * How long an order sits with us: from the moment we can work it to the
 * moment a person marks it complete. Shipping is Artelo's; this measures the
 * personalization and handling the team controls. The goal (since Oct 25,
 * 2026) is an average of a day and a half (GOAL_MEAN_HOURS); each order still
 * has two days before it counts as late (GOAL_HOURS, the header's on-time).
 *
 * The clock starts at the order, or at race day for an order placed before
 * the race (nothing can happen until the runner has run). It stops when the
 * order went to production at Artelo (Artelo's "received"):
 *   standard  the first "artelo.sent" line for it (the automatic send, since
 *             Oct 23, 2026: an approval completes the order first and the
 *             print goes to Artelo after the hold), else the first
 *             "order.complete" line: a person's click, which attached the
 *             designs and sent it. Orders the Artelo sync
 *             completed on its own (shipped without anyone marking them) have
 *             no line and are left out, since that time is shipping, not ours.
 *   custom    the same log line (written by Sent to Production since Oct 17,
 *             2026); before that, designCompletedAt or researchedAt, which the
 *             tool stamped at completion.
 * The two are reported apart: a custom design is a different job.
 *
 * Time spent waiting on the customer is not ours either: while a Support
 * conversation with them was waiting on their reply (from one of our messages
 * to their next), the clock is paused. Measured 2026-10-22, it moved the week
 * from 57% to 58%: the misses are volume, not customers.
 */
import prisma from '../../db.js'

const HOUR = 3600e3
export const GOAL_HOURS = 48
export const GOAL_MEAN_HOURS = 36

function quantile(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function summarize(hours) {
  const s = [...hours].sort((a, b) => a - b)
  if (!s.length) return { count: 0, medianHours: null, meanHours: null, p90Hours: null, withinGoal: 0, withinGoalPct: null, overFiveDays: 0 }
  const within = s.filter(h => h <= GOAL_HOURS).length
  return {
    count: s.length,
    medianHours: quantile(s, 0.5),
    meanHours: s.reduce((a, b) => a + b, 0) / s.length,
    p90Hours: quantile(s, 0.9),
    withinGoal: within,
    withinGoalPct: Math.round((100 * within) / s.length),
    overFiveDays: s.filter(h => h > 120).length,
  }
}

/**
 * @param {{since: Date, until: Date}} range  completions in this window
 * @returns per type: the summary, a weekly series (last 8 weeks, by completion week),
 *          and what was left out and why; plus the open backlog past the goal right now.
 */
/**
 * The header polls this every two minutes from every open tab, and the
 * numbers barely move in that time, so a result is reused per instance for
 * a minute.
 */
const CACHE_MS = 60_000
const cache = new Map()

export async function computeFulfillmentTime(range) {
  const key = `${new Date(range.since).getTime()}|${Math.floor(new Date(range.until).getTime() / CACHE_MS)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const value = await computeFulfillmentTimeFresh(range)
  cache.clear()
  cache.set(key, { at: Date.now(), value })
  return value
}

async function computeFulfillmentTimeFresh({ since, until }) {
  // Only what the window and the 8-week series can use. This used to read
  // every completion event and every completed order ever, a little more
  // each day, on every poll.
  const floor = new Date(Math.min(new Date(since).getTime(), new Date(until).getTime() - 8 * 7 * 24 * HOUR))
  const [events, sends, races] = await Promise.all([
    prisma.auditEvent.findMany({ where: { action: 'order.complete', createdAt: { gte: floor } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, detail: true } }),
    prisma.auditEvent.findMany({ where: { action: 'artelo.sent', createdAt: { gte: floor } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, detail: true } }),
    prisma.race.findMany({ select: { raceName: true, year: true, raceDate: true } }),
  ])
  const loggedNumbers = [...new Set(events.map(e => e.detail?.orderNumber).filter(Boolean))]
  const orders = await prisma.order.findMany({
    where: {
      status: 'completed',
      OR: [
        { trackstarOrderType: { in: ['standard', 'custom'] }, orderNumber: { in: loggedNumbers } },
        { trackstarOrderType: 'standard', id: { in: [...new Set(sends.map(e => e.detail?.orderId).filter(Boolean))] } },
        { trackstarOrderType: 'custom', OR: [{ designCompletedAt: { gte: floor } }, { researchedAt: { gte: floor } }] },
      ],
    },
    select: { id: true, orderNumber: true, trackstarOrderType: true, createdAt: true, researchedAt: true, designCompletedAt: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true, customerEmail: true },
  })
  const waits = await customerWaits(orders.map(o => o.customerEmail))
  const completedAt = new Map()
  for (const e of events) { const n = e.detail?.orderNumber; if (n && !completedAt.has(n)) completedAt.set(n, e.createdAt) }
  const sentAt = new Map()
  for (const e of sends) { const id = e.detail?.orderId; if (id && !sentAt.has(id)) sentAt.set(id, e.createdAt) }
  const raceDate = new Map(races.map(r => [`${r.raceName}|${r.year}`, r.raceDate]))

  const rows = { standard: [], custom: [] }
  const leftOut = { standard: { noLogLine: 0, doneBeforeRace: 0 }, custom: { noTimestamp: 0, doneBeforeRace: 0 } }
  for (const o of orders) {
    const type = o.trackstarOrderType
    const done = (type === 'standard' && sentAt.get(o.id)) || completedAt.get(o.orderNumber) || (type === 'custom' ? (o.designCompletedAt || o.researchedAt) : null)
    if (!done) { leftOut[type][type === 'standard' ? 'noLogLine' : 'noTimestamp']++; continue }
    if (done < since || done >= until) continue
    const rd = raceDate.get(`${o.raceNameOverride ?? o.raceName}|${o.yearOverride ?? o.raceYear}`) || null
    const preRace = Boolean(rd && rd > o.createdAt)
    const start = preRace ? rd : o.createdAt
    if (done - start < 0) { leftOut[type].doneBeforeRace++; continue }
    const hours = (done - start - waitedWithin(waits, o.customerEmail, start, done)) / HOUR
    rows[type].push({ hours, done, preRace })
  }

  const weekly = list => {
    const weeks = []
    const end = new Date(until)
    for (let i = 7; i >= 0; i--) {
      const from = new Date(end.getTime() - (i + 1) * 7 * 24 * HOUR), to = new Date(end.getTime() - i * 7 * 24 * HOUR)
      const inWeek = list.filter(r => r.done >= from && r.done < to).map(r => r.hours)
      const s = summarize(inWeek)
      weeks.push({ from: from.toISOString().slice(0, 10), count: s.count, meanHours: s.meanHours, medianHours: s.medianHours, withinGoalPct: s.withinGoalPct })
    }
    return weeks
  }

  const out = {}
  for (const type of ['standard', 'custom']) {
    const list = rows[type]
    out[type] = {
      ...summarize(list.map(r => r.hours)),
      orderedBeforeRace: list.filter(r => r.preRace).length,
      weekly: weekly(list),
      leftOut: leftOut[type],
    }
  }

  // The backlog right now: open orders already past the goal.
  const open = await prisma.order.findMany({
    where: { status: { notIn: ['completed', 'flagged'] }, trackstarOrderType: 'standard' },
    select: { createdAt: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true },
  })
  const now = Date.now()
  let workable = 0, pastGoal = 0
  for (const o of open) {
    const rd = raceDate.get(`${o.raceNameOverride ?? o.raceName}|${o.yearOverride ?? o.raceYear}`) || null
    const start = rd && rd > o.createdAt ? rd : o.createdAt
    if (start.getTime() > now) continue  // race not run yet: not ours to work
    workable++
    if ((now - start.getTime()) / HOUR > GOAL_HOURS) pastGoal++
  }
  out.openStandard = { workable, pastGoal }
  out.goalHours = GOAL_HOURS
  out.goalMeanHours = GOAL_MEAN_HOURS
  return out
}

/**
 * The stretches each customer had our question and we had no answer: from a
 * message we sent in Support to their next one (or now). Keyed by the
 * lower-cased email.
 */
export async function customerWaits(emails) {
  const list = [...new Set(emails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
  const out = new Map()
  if (!list.length) return out
  const msgs = await prisma.$queryRaw`
    SELECT lower(t."customerEmail") AS email, m.direction, m."sentAt"
    FROM "SupportMessage" m JOIN "SupportThread" t ON t.id = m."threadId"
    WHERE lower(t."customerEmail") = ANY(${list}) AND t."mergedIntoId" IS NULL
    ORDER BY m."sentAt" ASC`
  for (const m of msgs) {
    const spans = out.get(m.email) || []
    out.set(m.email, spans)
    const open = spans.find(w => !w.to)
    if (m.direction === 'out' && !open) spans.push({ from: m.sentAt, to: null })
    if (m.direction === 'in' && open) open.to = m.sentAt
  }
  return out
}

/** Milliseconds between start and end that the customer spent with our question unanswered. */
export function waitedWithin(waits, email, start, end) {
  let ms = 0
  for (const w of waits.get(String(email || '').trim().toLowerCase()) || []) {
    ms += Math.max(0, Math.min(end.getTime(), (w.to || end).getTime()) - Math.max(start.getTime(), w.from.getTime()))
  }
  return ms
}

/** Midnight today in New York, as a Date. The team's day, whatever the server's zone. */
export function startOfTodayNY(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  const sinceMidnight = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + now.getMilliseconds()
  return new Date(now.getTime() - sinceMidnight)
}

/**
 * Standard orders sent to production since midnight (New York), and who sent
 * them: the person who marked each one complete (the Activity Log line),
 * not whoever it was assigned to. Each order counts once, for its first
 * completion today. The header counter that says whether the day's pace
 * keeps up with what comes in.
 */
export async function sentToProductionToday() {
  // Rolling 24 hours, not the calendar day, so the morning count isn't empty.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const events = await prisma.auditEvent.findMany({
    where: { action: 'order.complete', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: { detail: true, actorEmail: true, user: { select: { firstName: true } } },
  })
  const firstBy = new Map()
  for (const e of events) {
    const n = e.detail?.orderNumber
    if (n && !firstBy.has(n)) firstBy.set(n, e.user?.firstName || (e.actorEmail === 'system' ? 'Automatic' : String(e.actorEmail || 'Someone').split('@')[0]))
  }
  if (!firstBy.size) return { count: 0, byPerson: [], since }
  const standard = await prisma.order.findMany({ where: { orderNumber: { in: [...firstBy.keys()] }, trackstarOrderType: 'standard' }, select: { orderNumber: true } })
  const tally = new Map()
  for (const { orderNumber } of standard) { const who = firstBy.get(orderNumber); tally.set(who, (tally.get(who) || 0) + 1) }
  const byPerson = [...tally.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  return { count: standard.length, byPerson, since }
}
