/**
 * One-off, 2026-11-05: the change window went from 24 to 48 hours
 * (server/domain/orders/changeWindow.js). Prints approved before that were
 * queued for 24 hours after the order; this moves each one still waiting to
 * 48, so nothing goes early. Only prints that are queued (not sent, not held,
 * no error) and whose new time is later than the old one are touched.
 *
 *   node scripts/extend-change-window.mjs           # dry run: list what would change
 *   node scripts/extend-change-window.mjs --apply   # write it
 */
import prisma from '../server/db.js'
import { windowEndsAt } from '../server/domain/orders/changeWindow.js'

const apply = process.argv.includes('--apply')
const jobs = await prisma.renderJob.findMany({
  where: { status: 'done', review: 'approved', arteloSentAt: null, sendHeldAt: null, sendError: null, sendAfter: { not: null } },
  select: { id: true, sendAfter: true, order: { select: { shopifyOrderData: true, createdAt: true, runnerName: true } } },
})
let moved = 0
for (const j of jobs) {
  const end = windowEndsAt(j.order)
  if (!end || end <= j.sendAfter) continue
  moved++
  console.log(`${j.order.shopifyOrderData?.name || j.id} ${j.order.runnerName || ''}: ${j.sendAfter.toISOString()} -> ${end.toISOString()}`)
  if (apply) await prisma.renderJob.update({ where: { id: j.id }, data: { sendAfter: end } })
}
console.log(`${jobs.length} queued, ${moved} ${apply ? 'moved' : 'would move'} to 48 hours after the order.${apply ? '' : ' Dry run; pass --apply to write.'}`)
await prisma.$disconnect()
