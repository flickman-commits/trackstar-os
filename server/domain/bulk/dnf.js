/**
 * Runner DNF: a bulk runner who did not finish the race gets no print.
 *
 * Their order is closed (status completed, so every open queue, research and
 * the sender leave it alone), any render waiting for review is closed, a
 * queued send is called off, and the runner leaves the bulk order's runner
 * list and its count of prints we are making. The prints paid for and not
 * made are what a refund suggests (refunds.js), so a DNF counts toward it.
 *
 * A print already sent to Artelo is made: that runner cannot be marked DNF.
 * Undo puts them back as they were before research closed anything.
 */
import prisma from '../../db.js'
import { settleBulkStatus } from './send.js'

export class DnfError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

/** Why this runner cannot be marked DNF, or null. Pure. */
export function dnfBlocker(order) {
  if (!order) return 'Runner not found'
  if (order.trackstarOrderType !== 'bulk' || !order.bulkOrderId) return 'Only a runner on a bulk order can be marked DNF'
  if (order.bulkDnfAt) return 'Already marked DNF'
  if (order.bulkSentAt || order.status === 'completed') return 'Their print already went to production'
  return null
}

const FIND = { id: true, orderNumber: true, runnerName: true, runnerNameOverride: true, status: true, trackstarOrderType: true, bulkOrderId: true, bulkSentAt: true, bulkDnfAt: true, bulkDnfBy: true, researchedAt: true }

async function findRunner({ orderId, orderNumber }) {
  if (orderId) return prisma.order.findUnique({ where: { id: String(orderId) }, select: FIND })
  if (orderNumber) return prisma.order.findFirst({ where: { orderNumber: String(orderNumber), trackstarOrderType: 'bulk' }, select: FIND })
  return null
}

/** Mark the runner DNF and close their order. Returns what the audit and the toast say. */
export async function markDnf({ orderId, orderNumber }, actor) {
  const runner = await findRunner({ orderId, orderNumber })
  const why = dnfBlocker(runner)
  if (why) throw new DnfError(why, runner ? 400 : 404)
  const by = actor?.name || actor?.email || 'someone'
  await prisma.$transaction([
    prisma.order.update({
      where: { id: runner.id },
      data: { status: 'completed', bulkDnfAt: new Date(), bulkDnfBy: by, bulkSendAfter: null, bulkSendError: null },
    }),
    // A print waiting for review is not wanted any more.
    prisma.renderJob.updateMany({ where: { orderId: runner.id, review: 'pending' }, data: { review: 'closed' } }),
  ])
  // The last print the run was waiting on may have been this runner's.
  await settleBulkStatus(runner.bulkOrderId)
  const bulk = await prisma.bulkOrder.findUnique({ where: { id: runner.bulkOrderId }, select: { id: true, number: true, partnerName: true } })
  return { orderId: runner.id, orderNumber: runner.orderNumber, runnerName: runner.runnerNameOverride || runner.runnerName, bulk }
}

/** Put a DNF runner back on the list, open again (marked by mistake, or they did finish). */
export async function undoDnf({ orderId, orderNumber }) {
  const runner = await findRunner({ orderId, orderNumber })
  if (!runner?.bulkDnfAt) throw new DnfError('That runner is not marked DNF', runner ? 400 : 404)
  await prisma.order.update({ where: { id: runner.id }, data: { status: runner.researchedAt ? 'ready' : 'pending', bulkDnfAt: null, bulkDnfBy: null } })
  return { orderId: runner.id, orderNumber: runner.orderNumber, runnerName: runner.runnerNameOverride || runner.runnerName }
}
