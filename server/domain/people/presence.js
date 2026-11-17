/**
 * Who is on right now, for admins: anyone who used the app in the last few
 * minutes, and anyone with an hours timer running.
 *
 * "Last seen" is written at most every five minutes per person
 * (api/_lib/users.js touchLastSeen), so the window is a little over that: a
 * person active a minute ago may read up to five minutes stale.
 */
import prisma from '../../db.js'

export const ACTIVE_MS = 6 * 60 * 1000

export async function presence(now = Date.now()) {
  const since = new Date(now - ACTIVE_MS)
  const [seen, timers] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, lastSeenAt: { gte: since } }, select: { id: true, firstName: true, lastName: true, lastSeenAt: true } }),
    prisma.timeEntry.findMany({ where: { startedAt: { not: null }, endedAt: null }, select: { userId: true, startedAt: true } }),
  ])
  const names = new Map(seen.map(u => [u.id, u]))
  const missing = [...new Set(timers.map(t => t.userId))].filter(id => !names.has(id))
  if (missing.length) for (const u of await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, firstName: true, lastName: true } })) names.set(u.id, u)
  const row0 = id => ({ userId: id, firstName: names.get(id)?.firstName || 'Someone', lastName: names.get(id)?.lastName || '', lastSeenAt: null, timerSince: null })
  const out = new Map()
  for (const u of seen) out.set(u.id, { ...row0(u.id), lastSeenAt: u.lastSeenAt })
  for (const t of timers) {
    const row = out.get(t.userId) || row0(t.userId)
    if (!row.timerSince || t.startedAt < row.timerSince) row.timerSince = t.startedAt
    out.set(t.userId, row)
  }
  return [...out.values()]
}
