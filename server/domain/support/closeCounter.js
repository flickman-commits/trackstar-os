/**
 * Support conversations each person closed, per day (Eastern time), for the
 * admin counter in Settings. Credit goes to the account that clicked Close,
 * not the assignee: every close leaves an event note ("<name> closed this")
 * whose authorId is that account (threads.js setStatus), so the history
 * counts from the first close. A conversation closed, reopened and closed
 * again by the same person on the same day counts once.
 */
import prisma from '../../db.js'

/**
 * @param {number} days - how many days back, today included
 * @returns {Promise<{ days: string[], people: { id: string, name: string, total: number, byDay: Record<string, number> }[] }>}
 */
export async function closeCounter(days = 30) {
  const n = Math.min(Math.max(Number(days) || 30, 1), 366)
  const rows = await prisma.$queryRaw`
    SELECT n."authorId" AS id,
           to_char(n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
           count(DISTINCT n."threadId")::int AS closed
    FROM "SupportNote" n
    WHERE n.kind = 'event' AND n.body LIKE '% closed this' AND n."authorId" IS NOT NULL
      AND n."createdAt" >= (date_trunc('day', now() AT TIME ZONE 'America/New_York') - make_interval(days => ${n - 1}::int)) AT TIME ZONE 'America/New_York'
    GROUP BY 1, 2`
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(r => r.id))] } }, select: { id: true, firstName: true, lastName: true } })
  const nameOf = new Map(users.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Someone']))

  const people = new Map()
  for (const r of rows) {
    const p = people.get(r.id) || { id: r.id, name: nameOf.get(r.id) || 'Someone', total: 0, byDay: {} }
    p.byDay[r.day] = r.closed
    p.total += r.closed
    people.set(r.id, p)
  }

  // Every day in the range, newest first, so a day nobody closed anything still shows.
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const list = []
  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    list.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return { days: list, people: [...people.values()].sort((a, b) => b.total - a.total) }
}
