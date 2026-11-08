/**
 * Put Support conversations that were closed while we were waiting on the
 * customer back to "waiting on the customer", so their orders show under
 * Waiting on customer again. A conversation counts when it was closed in the
 * last 30 days, our message is the last one (the customer never wrote, or
 * wrote before our latest reply), and the customer still has an open order.
 * Dry run by default.
 *
 * Nov 2026: Dani's inbox passes closed 4991, 5346, 5759, 6145 (never
 * answered) and 6265, 6783 (waiting on a photo the customer said was coming).
 *
 * Not every match was closed by mistake: a conversation that ended with our
 * last word ("all set!") or a custom proof the customer answers in the portal
 * looks the same. So it lists them all, and --apply only touches the orders
 * named with --orders.
 *
 *   node --env-file=.env.local scripts/reopen-unanswered-closes.js
 *   node --env-file=.env.local scripts/reopen-unanswered-closes.js --orders=6265,6783 --apply
 */
import prisma from '../server/db.js'

const only = new Set((process.argv.find(a => a.startsWith('--orders=')) || '').slice('--orders='.length).split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean))
const apply = process.argv.includes('--apply')
if (apply && !only.size) { console.log('Name the orders to reopen: --orders=6265,6783'); process.exit(1) }
const since = new Date(Date.now() - 30 * 86_400_000)
const threads = await prisma.supportThread.findMany({
  where: { status: 'closed', mergedIntoId: null, filtered: false, channel: 'email', lastOutboundAt: { not: null }, updatedAt: { gte: since } },
  select: { id: true, subject: true, customerEmail: true, lastInboundAt: true, lastOutboundAt: true },
})
let n = 0
for (const t of threads) {
  if (t.lastInboundAt && t.lastInboundAt > t.lastOutboundAt) continue // they spoke last: an answer was owed, not awaited
  const email = String(t.customerEmail || '').trim()
  if (!email) continue
  const open = await prisma.order.findMany({
    where: { status: { not: 'completed' }, customerEmail: { equals: email, mode: 'insensitive' } },
    select: { shopifyOrderData: true, parentOrderNumber: true },
  })
  if (!open.length) continue
  // Closed by a person, not by a send that closes (a notice): the last event says who.
  const last = await prisma.supportNote.findFirst({ where: { threadId: t.id, kind: 'event' }, orderBy: { createdAt: 'desc' }, select: { body: true } })
  if (!/ closed this$/.test(last?.body || '')) continue
  const list = [...new Set(open.map(o => String(o.shopifyOrderData?.name || o.parentOrderNumber).replace(/^#/, '')))]
  const numbers = list.join(', ')
  if (only.size && !list.some(x => only.has(x))) continue
  n++
  console.log(`#${numbers} (${email}): "${t.subject}" closed while waiting on them (${last.body}) -> waiting`)
  if (apply) {
    await prisma.$transaction([
      prisma.supportThread.update({ where: { id: t.id }, data: { status: 'waiting', snoozedUntil: null } }),
      prisma.supportNote.create({ data: { threadId: t.id, kind: 'event', body: 'Marked waiting on the customer: it was closed while we were waiting on their reply', authorName: 'TrackstarOS' } }),
    ])
  }
}
console.log(`${n} conversation(s) ${apply ? 'set to waiting' : 'would be set to waiting (dry run; --apply to write)'}`)
await prisma.$disconnect()
