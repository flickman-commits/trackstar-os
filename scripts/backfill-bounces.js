/**
 * Mark Support conversations whose last email from us bounced before bounce
 * detection existed (mailbox.js isBounce): a mailer-daemon notice newer than
 * our last message, with no real reply from the customer after it. Sets
 * bouncedAt and recomputes lastInboundAt without the bounce, so the order
 * shows "Email bounced" under Action instead of looking answered. Dry run
 * by default.
 *
 *   node --env-file=.env.local scripts/backfill-bounces.js
 *   node --env-file=.env.local scripts/backfill-bounces.js --apply
 */
import prisma from '../server/db.js'
import { isBounce } from '../server/domain/support/mailbox.js'

const apply = process.argv.includes('--apply')
const threads = await prisma.supportThread.findMany({
  where: { channel: 'email', mergedIntoId: null, bouncedAt: null, lastInboundAt: { not: null } },
  select: { id: true, subject: true, customerEmail: true, status: true },
})
let n = 0
for (const t of threads) {
  const msgs = await prisma.supportMessage.findMany({ where: { threadId: t.id }, orderBy: { sentAt: 'desc' }, select: { direction: true, fromEmail: true, subject: true, sentAt: true } })
  const newestIn = msgs.find(m => m.direction === 'in')
  if (!newestIn || !isBounce(newestIn)) continue
  const lastOut = msgs.find(m => m.direction === 'out')
  if (lastOut && lastOut.sentAt > newestIn.sentAt) continue // we wrote again after the bounce
  const realIn = msgs.find(m => m.direction === 'in' && !isBounce(m))
  n++
  console.log(`${t.status.padEnd(8)} ${t.customerEmail} | "${t.subject}" | bounced ${newestIn.sentAt.toISOString().slice(0, 10)}`)
  if (apply) await prisma.supportThread.update({ where: { id: t.id }, data: { bouncedAt: newestIn.sentAt, lastInboundAt: realIn?.sentAt || null, ...(t.status === 'waiting' ? { status: 'open' } : {}) } })
}
console.log(`${n} bounced conversation(s) ${apply ? 'marked' : 'would be marked (dry run; --apply to write)'}`)
await prisma.$disconnect()
