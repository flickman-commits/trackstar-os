/**
 * Moving an order to another queue by hand (Eli, 2026-11-15). The queue an
 * order sits in is worked out from what the tool knows (pipeline.js); this
 * puts it somewhere else for a reason a person gives, until the order changes
 * (pipeline.js pipelineFor drops the move once the worked-out stage is not
 * the one it was made from). Commented on the order.
 */
import prisma from '../../db.js'
import { pipelinesFor } from './pipelineStatus.js'
import { OVERRIDE_STAGES, overrideBasis } from './pipeline.js'

export class QueueError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

/** Move `orderId` to `stage` (a key of OVERRIDE_STAGES), or back to its own queue with stage null. */
export async function setQueueOverride({ orderId, stage, note, actor }) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { id: true, status: true, trackstarOrderType: true, queueOverride: true } })
  if (!order) throw new QueueError('Order not found', 404)
  if (order.trackstarOrderType !== 'standard') throw new QueueError('Only a standard print moves between queues')
  if (order.status === 'completed') throw new QueueError('This order is complete. Reopen it first.')
  const who = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
  const text = String(note || '').trim().slice(0, 300)

  if (!stage) {
    if (!order.queueOverride) throw new QueueError('This order is already in its own queue')
    await prisma.order.update({ where: { id: order.id }, data: { queueOverride: null } })
    await prisma.orderComment.create({ data: { orderId: order.id, text: 'Put back in its own queue.', authorId: actor?.id || null, authorName: who } })
    return { stage: null }
  }
  if (!OVERRIDE_STAGES[stage]) throw new QueueError('Pick Review, Action, Waiting or Approved')
  if (!text) throw new QueueError('Say why it is moving, so the next person knows')

  // What it would be on its own: the move holds while that stays the same.
  await prisma.order.update({ where: { id: order.id }, data: { queueOverride: null } })
  const base = (await pipelinesFor([order.id])).get(order.id)
  if (base?.stage === stage) throw new QueueError(`It is already in ${OVERRIDE_STAGES[stage]}`)
  const value = { stage, note: text, by: who, at: new Date().toISOString(), basis: overrideBasis(base) }
  await prisma.order.update({ where: { id: order.id }, data: { queueOverride: value } })
  await prisma.orderComment.create({ data: { orderId: order.id, text: `Moved to ${OVERRIDE_STAGES[stage]} by hand: ${text}. It goes back on its own when the order changes.`, authorId: actor?.id || null, authorName: who } })
  return { stage, from: base?.reason || null }
}
