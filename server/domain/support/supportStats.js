/**
 * Support numbers for the Stats page (Settings > Stats, admin only), for any
 * window the page picks (today, yesterday, the past 7, 30 or 90 days).
 *
 *   email    email tickets in and closed. In: the customer's first message
 *            in a conversation, or their first after it was closed (writing
 *            back reopens it, and it is closed again later, so it counts as
 *            a ticket both ways), dated by when they sent it, not when the
 *            mirror saw it. Closed: conversations closed, whoever closed
 *            them, once a day however often. Filtered senders (vendors,
 *            alerts) and conversations folded into another are left out.
 *   rate     the share of orders whose customer wrote in: orders placed in
 *            the window (one per Shopify or Etsy order, however many
 *            prints), and how many of those customers emailed from the same
 *            address within 60 days. Instagram conversations carry no
 *            email, so they cannot be matched and are not in it. Before the
 *            inbox mirror's first message there is nothing to match.
 *   closers  conversations each person closed, credited to whoever clicked
 *            Close (closeCounter.js counts the same way, by day).
 *   replacements  what we paid Artelo for replacements made in the window
 *            (finance/replacements.js), cancelled and paid-back ones left out.
 */
import prisma from '../../db.js'

const WINDOW_DAYS = 60
const CLOSED = '% closed this'

const cents = r => r.billedCents ?? r.quotedCents ?? 0

/** @param {{ since: Date, until: Date }} w */
export async function supportStats({ since, until }) {
  const [[received], [closed], closers, rate, first, reps] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*)::int AS n
      FROM "SupportMessage" m JOIN "SupportThread" t ON t.id = m."threadId"
      LEFT JOIN LATERAL (SELECT max(p."sentAt") AS at FROM "SupportMessage" p WHERE p."threadId" = m."threadId" AND p.direction = 'in' AND p."sentAt" < m."sentAt") prev ON true
      LEFT JOIN LATERAL (SELECT max(c."createdAt") AS at FROM "SupportNote" c WHERE c."threadId" = m."threadId" AND c.kind = 'event' AND c.body LIKE ${CLOSED} AND c."createdAt" < m."sentAt") shut ON true
      WHERE m.direction = 'in' AND m."sentAt" >= ${since} AND m."sentAt" < ${until}
        AND t.channel = 'email' AND t.filtered = false AND t."mergedIntoId" IS NULL
        AND (prev.at IS NULL OR (shut.at IS NOT NULL AND shut.at > prev.at))`,
    prisma.$queryRaw`
      SELECT count(DISTINCT (nt."threadId", to_char(nt."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')))::int AS n
      FROM "SupportNote" nt JOIN "SupportThread" t ON t.id = nt."threadId"
      WHERE nt.kind = 'event' AND nt.body LIKE ${CLOSED} AND nt."createdAt" >= ${since} AND nt."createdAt" < ${until}
        AND t.channel = 'email' AND t.filtered = false AND t."mergedIntoId" IS NULL`,
    prisma.$queryRaw`
      SELECT nt."authorId" AS id, count(DISTINCT (nt."threadId", to_char(nt."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')))::int AS n
      FROM "SupportNote" nt
      WHERE nt.kind = 'event' AND nt.body LIKE ${CLOSED} AND nt."authorId" IS NOT NULL AND nt."createdAt" >= ${since} AND nt."createdAt" < ${until}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      WITH orders AS (
        SELECT o.source, o."parentOrderNumber", min(o."createdAt") AS placed, lower(min(o."customerEmail")) AS email
        FROM "Order" o
        WHERE o.source IN ('shopify', 'etsy') AND o."trackstarOrderType" IN ('standard', 'custom')
        GROUP BY o.source, o."parentOrderNumber"
        HAVING min(o."createdAt") >= ${since} AND min(o."createdAt") < ${until}
      )
      SELECT count(*)::int AS orders,
             count(*) FILTER (WHERE o.email <> '' AND EXISTS (
               SELECT 1 FROM "SupportThread" t JOIN "SupportMessage" m ON m."threadId" = t.id AND m.direction = 'in'
               WHERE lower(t."customerEmail") = o.email AND t.filtered = false AND t."mergedIntoId" IS NULL
                 AND m."sentAt" >= o.placed - interval '1 day'
                 AND m."sentAt" < o.placed + make_interval(days => ${WINDOW_DAYS}::int)
             ))::int AS "withTicket"
      FROM orders o`,
    prisma.$queryRaw`SELECT min(m."sentAt") AS at FROM "SupportMessage" m JOIN "SupportThread" t ON t.id = m."threadId" WHERE t.channel = 'email' AND m.direction = 'in'`,
    prisma.replacement.findMany({ where: { createdAt: { gte: since, lt: until }, canceled: false, reimbursed: false }, select: { billedCents: true, quotedCents: true } }),
  ])

  const users = await prisma.user.findMany({ where: { id: { in: closers.map(c => c.id) } }, select: { id: true, firstName: true, lastName: true } })
  const nameOf = new Map(users.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Someone']))
  const days = Math.max(1, (until.getTime() - since.getTime()) / 86_400_000)
  const trackedFrom = first[0]?.at ? new Date(first[0].at) : null
  const r = rate[0] || { orders: 0, withTicket: 0 }
  return {
    days: Math.round(days * 10) / 10,
    email: { received: received.n, closed: closed.n },
    rate: {
      windowDays: WINDOW_DAYS,
      orders: r.orders,
      withTicket: r.withTicket,
      pct: r.orders ? Math.round((r.withTicket / r.orders) * 1000) / 10 : null,
      // Some orders here still have time to write in, or the window starts before the inbox was mirrored.
      stillCounting: until.getTime() > Date.now() - WINDOW_DAYS * 86_400_000,
      partial: !trackedFrom || trackedFrom > since,
    },
    closers: closers.map(c => ({ id: c.id, name: nameOf.get(c.id) || 'Someone', closed: c.n })),
    replacements: { count: reps.length, cents: reps.reduce((s, x) => s + cents(x), 0) },
  }
}
