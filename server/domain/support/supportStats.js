/**
 * Support numbers for Settings > Stats > Support (admin only).
 *
 *   daily   email tickets in and closed per day, Eastern time. In: the
 *           customer's first message in a conversation, or their first
 *           message after it was closed (writing back reopens it, and it is
 *           closed again later, so it counts as a ticket both ways), dated by
 *           when they sent it, not when the mirror saw it.
 *           Closed: conversations closed that day, whoever closed them,
 *           counted once a day however often they were closed. Filtered
 *           senders (vendors, alerts) and conversations folded into another
 *           are left out of both.
 *   rate    the share of orders whose customer wrote to support about them:
 *           orders (one per Shopify or Etsy order, however many prints) by
 *           the month they were placed, and how many of those customers
 *           opened a conversation from the same email in the 60 days after.
 *           Instagram conversations carry no email, so they cannot be
 *           matched to an order and are not in the rate.
 */
import prisma from '../../db.js'

const TZ = 'America/New_York'
const WINDOW_DAYS = 60

/** The last n days, Eastern, newest first. */
function lastDays(n) {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

/** @returns {{ days: { day, received, closed }[], totals: { received, closed } }} */
export async function emailDaily(days = 30) {
  const n = Math.min(Math.max(Number(days) || 30, 1), 366)
  const [received, closed] = await Promise.all([
    prisma.$queryRaw`
      WITH since AS (SELECT (date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${n - 1}::int)) AT TIME ZONE ${TZ} AS at)
      SELECT to_char(m."sentAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "SupportMessage" m JOIN "SupportThread" t ON t.id = m."threadId", since
      LEFT JOIN LATERAL (SELECT max(p."sentAt") AS at FROM "SupportMessage" p WHERE p."threadId" = m."threadId" AND p.direction = 'in' AND p."sentAt" < m."sentAt") prev ON true
      LEFT JOIN LATERAL (SELECT max(c."createdAt") AS at FROM "SupportNote" c WHERE c."threadId" = m."threadId" AND c.kind = 'event' AND c.body LIKE '% closed this' AND c."createdAt" < m."sentAt") shut ON true
      WHERE m.direction = 'in' AND m."sentAt" >= since.at
        AND t.channel = 'email' AND t.filtered = false AND t."mergedIntoId" IS NULL
        AND (prev.at IS NULL OR (shut.at IS NOT NULL AND shut.at > prev.at))
      GROUP BY 1`,
    prisma.$queryRaw`
      SELECT to_char(nt."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, count(DISTINCT nt."threadId")::int AS n
      FROM "SupportNote" nt JOIN "SupportThread" t ON t.id = nt."threadId"
      WHERE nt.kind = 'event' AND nt.body LIKE '% closed this'
        AND t.channel = 'email' AND t.filtered = false AND t."mergedIntoId" IS NULL
        AND nt."createdAt" >= (date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${n - 1}::int)) AT TIME ZONE ${TZ}
      GROUP BY 1`,
  ])
  const inBy = new Map(received.map(r => [r.day, r.n]))
  const outBy = new Map(closed.map(r => [r.day, r.n]))
  const list = lastDays(n).map(day => ({ day, received: inBy.get(day) || 0, closed: outBy.get(day) || 0 }))
  return { days: list, totals: { received: list.reduce((s, d) => s + d.received, 0), closed: list.reduce((s, d) => s + d.closed, 0) } }
}

/**
 * @param {number} months - how many months back, this one included
 * @returns {{ windowDays, trackedFrom, months: { month, orders, withTicket, pct, tracked, complete }[] }}
 *   complete is false while some of the month's orders are still inside their 60 days;
 *   tracked is false for months before the inbox mirror's first message.
 */
export async function ticketRate(months = 6) {
  const n = Math.min(Math.max(Number(months) || 6, 1), 24)
  const rows = await prisma.$queryRaw`
    WITH orders AS (
      SELECT o.source, o."parentOrderNumber", min(o."createdAt") AS placed, lower(min(o."customerEmail")) AS email
      FROM "Order" o
      WHERE o.source IN ('shopify', 'etsy') AND o."trackstarOrderType" IN ('standard', 'custom')
        AND o."createdAt" >= (date_trunc('month', now() AT TIME ZONE ${TZ}) - make_interval(months => ${n - 1}::int)) AT TIME ZONE ${TZ}
      GROUP BY o.source, o."parentOrderNumber"
    )
    SELECT to_char(o.placed AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}, 'YYYY-MM') AS month,
           count(*)::int AS orders,
           count(*) FILTER (WHERE o.email <> '' AND EXISTS (
             SELECT 1 FROM "SupportThread" t JOIN "SupportMessage" m ON m."threadId" = t.id AND m.direction = 'in'
             WHERE lower(t."customerEmail") = o.email AND t.filtered = false AND t."mergedIntoId" IS NULL
               AND m."sentAt" >= o.placed - interval '1 day'
               AND m."sentAt" < o.placed + make_interval(days => ${WINDOW_DAYS}::int)
           ))::int AS "withTicket",
           max(o.placed) AS last
    FROM orders o
    GROUP BY 1
    ORDER BY 1 DESC`
  // The inbox mirror's first message: months before it have no tickets to find, not zero.
  const [first] = await prisma.$queryRaw`SELECT to_char(min(m."sentAt") AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}, 'YYYY-MM') AS month FROM "SupportMessage" m JOIN "SupportThread" t ON t.id = m."threadId" WHERE t.channel = 'email' AND m.direction = 'in'`
  const from = first?.month || null
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000
  return {
    windowDays: WINDOW_DAYS,
    trackedFrom: from,
    months: rows.map(r => {
      const tracked = Boolean(from && r.month >= from)
      return {
        month: r.month, orders: r.orders, withTicket: tracked ? r.withTicket : null,
        pct: tracked && r.orders ? Math.round((r.withTicket / r.orders) * 1000) / 10 : null,
        tracked, complete: new Date(r.last).getTime() < cutoff,
      }
    }),
  }
}
