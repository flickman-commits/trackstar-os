/**
 * Put Support conversations that were closed before the customer ever
 * answered back to "waiting on the customer", so their orders show under
 * Waiting on customer again. Only conversations we started from an order
 * ("... (Action Required)"), where the customer has never written, and
 * whose order is still open. Dry run by default.
 *
 *   node --env-file=.env.local scripts/reopen-unanswered-closes.js
 *   node --env-file=.env.local scripts/reopen-unanswered-closes.js --apply
 */
import prisma from '../server/db.js'

const apply = process.argv.includes('--apply')
const threads = await prisma.supportThread.findMany({
  where: { status: 'closed', lastInboundAt: null, mergedIntoId: null, filtered: false, subject: { endsWith: '(Action Required)' } },
  select: { id: true, subject: true, customerEmail: true },
})
let n = 0
for (const t of threads) {
  const number = /Order (\S+) \(Action Required\)/.exec(t.subject)?.[1]
  if (!number) continue
  const open = await prisma.order.findFirst({
    where: { status: { not: 'completed' }, OR: [{ shopifyOrderData: { path: ['name'], equals: number } }, { shopifyOrderData: { path: ['name'], equals: `#${number}` } }, { parentOrderNumber: number }] },
    select: { id: true },
  })
  if (!open) continue
  n++
  console.log(`#${number} (${t.customerEmail}): closed, never answered, order still open -> waiting`)
  if (apply) {
    await prisma.$transaction([
      prisma.supportThread.update({ where: { id: t.id }, data: { status: 'waiting', snoozedUntil: null } }),
      prisma.supportNote.create({ data: { threadId: t.id, kind: 'event', body: 'Marked waiting on the customer: it was closed before they answered', authorName: 'TrackstarOS' } }),
    ])
  }
}
console.log(`${n} conversation(s) ${apply ? 'set to waiting' : 'would be set to waiting (dry run; --apply to write)'}`)
await prisma.$disconnect()
