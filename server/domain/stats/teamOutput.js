/**
 * What each person got done, day by day (Eastern), for the Team by day card
 * on Settings > Stats (admin only). Every count comes from something already
 * recorded, so the history is there from the start:
 *
 *   prints   standard prints sent to production: the person on the Activity
 *            Log's "order.complete" line. A print counts once a day, for
 *            whoever did it first. Closed by hand without Artelo, excluded,
 *            and sent by Artelo itself are not anyone's work.
 *   firsts   custom orders whose first designs they emailed the customer
 *            (the same rule as proofsToday.js: the first send, no later round).
 *   customs  custom and race partner orders they sent to production.
 *   tickets  Support conversations they closed (whoever clicked Close), once
 *            a day each, as in supportStats.js.
 *   replies  emails and DMs they sent a customer who had written to us. Proof
 *            emails that start a conversation, and Artelo, are left out.
 *   minutes  what they logged on their timesheet (a running timer counts once
 *            it stops).
 *
 * The page reads the 90 days once and slices its periods out of them, rather
 * than asking once per period. Totals and the per hour rate are worked out
 * there (src/components/TeamByDay.tsx).
 */
import prisma from '../../db.js'

const CLOSED = '% closed this'
const KEYS = ['prints', 'firsts', 'customs', 'tickets', 'replies', 'minutes']
const nyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const nyTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

/** Pure: the whole Eastern days in the window, newest first. A day the window starts partway through is dropped, so every row is comparable. */
export function wholeDays({ since, until }) {
  const first = nyDay.format(since)
  const partial = nyTime.format(since) !== '00:00:00'
  const last = nyDay.format(new Date(until.getTime() - 1))
  const out = []
  // Walked as plain dates, so a clock change cannot repeat or skip one.
  const d = new Date(`${last}T12:00:00Z`)
  for (let i = 0; i < 400; i++) {
    const day = d.toISOString().slice(0, 10)
    if (day < first || (partial && day === first)) break
    out.push(day)
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

/**
 * Pure: the page's shape from the counts.
 * @param {{ days: string[], counts: Record<string, { id: string, day: string, n: number }[]>, names: Map<string, string> }} p
 */
export function buildTeam({ days, counts, names }) {
  const inWindow = new Set(days)
  const people = new Map()
  for (const key of KEYS) {
    for (const { id, day, n } of counts[key] || []) {
      if (!id || !n || !inWindow.has(day)) continue
      const p = people.get(id) || { id, name: names.get(id) || 'Someone', byDay: {} }
      const row = p.byDay[day] || (p.byDay[day] = Object.fromEntries(KEYS.map(k => [k, 0])))
      row[key] += n
      people.set(id, p)
    }
  }
  return { days, people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

/** @param {{ since: Date, until: Date }} w */
export async function teamOutput({ since, until }) {
  const days = wholeDays({ since, until })
  if (!days.length) return { days, people: [] }
  const [first, last] = [days[days.length - 1], days[0]]
  const [done, firsts, tickets, replies, minutes] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, day, kind, count(*)::int AS n FROM (
        SELECT DISTINCT ON (day, a.detail->>'orderNumber') a."userId" AS id, d.day,
               CASE WHEN a.detail->>'orderType' = 'standard' THEN 'prints' ELSE 'customs' END AS kind
        FROM "AuditEvent" a, LATERAL (SELECT to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day) d
        WHERE a.action = 'order.complete' AND a."createdAt" >= ${since} AND a."createdAt" < ${until}
          AND a.detail->>'orderType' IN ('standard', 'custom', 'race_partner')
          AND a.detail->>'via' IN ('approve', 'manual', 'sent_to_production')
          AND coalesce(a.detail->>'override', 'false') <> 'true'
        ORDER BY day, a.detail->>'orderNumber', a."createdAt"
      ) x WHERE id IS NOT NULL GROUP BY 1, 2, 3`,
    prisma.$queryRaw`
      SELECT s.id, to_char(s.at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM (
        SELECT DISTINCT ON (a.detail->>'orderId') a.detail->>'orderId' AS "orderId", a."userId" AS id, a."createdAt" AS at
        FROM "AuditEvent" a WHERE a.action = 'proof.send' AND a.detail->>'orderId' IS NOT NULL AND a."createdAt" < ${until}
        ORDER BY a.detail->>'orderId', a."createdAt"
      ) s JOIN "Order" o ON o.id = s."orderId" AND o."trackstarOrderType" = 'custom'
      WHERE s.at >= ${since} AND s.id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Proof" p WHERE p."orderId" = s."orderId" AND p.batch > 1 AND p."createdAt" <= s.at)
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT nt."authorId" AS id, to_char(nt."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day, count(DISTINCT nt."threadId")::int AS n
      FROM "SupportNote" nt
      WHERE nt.kind = 'event' AND nt.body LIKE ${CLOSED} AND nt."authorId" IS NOT NULL AND nt."createdAt" >= ${since} AND nt."createdAt" < ${until}
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT m."sentById" AS id, to_char(m."sentAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "SupportMessage" m JOIN "SupportThread" t ON t.id = m."threadId"
      WHERE m.direction = 'out' AND m.auto = false AND m."sentById" IS NOT NULL AND m."sentAt" >= ${since} AND m."sentAt" < ${until}
        AND t.filtered = false AND t."customerEmail" NOT ILIKE '%artelo%'
        AND EXISTS (SELECT 1 FROM "SupportMessage" p WHERE p."threadId" = m."threadId" AND p.direction = 'in' AND p."sentAt" < m."sentAt")
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT e."userId" AS id, e.day, sum(e.minutes)::int AS n
      FROM "TimeEntry" e WHERE e.day >= ${first} AND e.day <= ${last} GROUP BY 1, 2`,
  ])
  const counts = { prints: done.filter(r => r.kind === 'prints'), customs: done.filter(r => r.kind === 'customs'), firsts, tickets, replies, minutes }
  const ids = [...new Set(Object.values(counts).flat().map(r => r.id))]
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true } })
  // First names, as the team uses them; with the last one when two people share it.
  const shared = users.map(u => u.firstName).filter((n, i, all) => n && all.indexOf(n) !== i)
  const names = new Map(users.map(u => [u.id, (shared.includes(u.firstName) ? [u.firstName, u.lastName].filter(Boolean).join(' ') : u.firstName) || String(u.email || 'Someone').split('@')[0]]))
  return buildTeam({ days, counts, names })
}
