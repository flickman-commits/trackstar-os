/**
 * First proofs (v1) emailed to customers today (since midnight New York), and
 * who sent them: the person on the "proof.send" Activity Log line. A send
 * counts only when it is the order's first round: no earlier proof.send for
 * the order, and no revision-round proof (batch 2+) made by then. Revision
 * re-sends do not count (Matt, 2026-11-23: v1 only, the calendar day).
 */
import prisma from '../../db.js'
import { startOfTodayNY } from './fulfillmentTime.js'

export async function firstProofsSentToday(now = new Date()) {
  const since = startOfTodayNY(now)
  const events = await prisma.auditEvent.findMany({
    where: { action: 'proof.send', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: { detail: true, actorEmail: true, createdAt: true, user: { select: { firstName: true } } },
  })
  const firstBy = new Map()
  for (const e of events) {
    const id = e.detail?.orderId
    if (id && !firstBy.has(id)) firstBy.set(id, { who: e.user?.firstName || String(e.actorEmail || 'Someone').split('@')[0], at: e.createdAt })
  }
  if (!firstBy.size) return { count: 0, byPerson: [], since }
  const ids = [...firstBy.keys()]
  const [earlier, revisions, custom] = await Promise.all([
    prisma.auditEvent.findMany({ where: { action: 'proof.send', createdAt: { lt: since }, OR: ids.map(id => ({ detail: { path: ['orderId'], equals: id } })) }, select: { detail: true } }),
    prisma.proof.findMany({ where: { orderId: { in: ids }, batch: { gt: 1 } }, select: { orderId: true, createdAt: true } }),
    prisma.order.findMany({ where: { id: { in: ids }, trackstarOrderType: 'custom' }, select: { id: true } }),
  ])
  const sentBefore = new Set(earlier.map(e => e.detail?.orderId))
  const tally = new Map()
  let count = 0
  for (const { id } of custom) {
    const { who, at } = firstBy.get(id)
    if (sentBefore.has(id) || revisions.some(p => p.orderId === id && p.createdAt <= at)) continue
    count++
    const t = tally.get(who) || { name: who, count: 0, first: at, last: at }
    t.count++
    if (at > t.last) t.last = at
    tally.set(who, t)
  }
  return { count, byPerson: [...tally.values()].sort((a, b) => b.count - a.count), since }
}
