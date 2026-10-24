/**
 * Completing a standard order: the print is in Artelo's hands. One path for
 * the Mark as Uploaded button, for an approved render (Approve completes the
 * order), and for anything else that finishes an order, so the rules live
 * once.
 *
 * A photo order completes only when the photo is on the artwork: an approved
 * render placed it (the approval is the check), otherwise a person ticks the box. A photo added
 * after purchase must be paid for first (photoPayment.js). Completing an
 * order closes any render still waiting for review, so the review queue
 * never holds work that is already done.
 */
import prisma from '../../db.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { unpaidPhotoRows } from './photoPayment.js'

export class CompleteError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export function describeOrder(order) {
  const who = order.runnerName ? ` for ${order.runnerName}` : ''
  const race = order.raceName ? ` (${order.raceName}${order.raceYear ? ` ${order.raceYear}` : ''})` : ''
  return `order ${order.orderNumber}${who}${race}`
}

/**
 * @param {object} opts
 * @param {string} [opts.orderId]        or orderNumber
 * @param {string} [opts.orderNumber]
 * @param {object} [opts.actor]          the person, for the Activity Log
 * @param {string} [opts.via]            'approve' when an approved render placed the photo
 * @param {string} [opts.renderJobId]    the approved render, when via === 'approve'
 */
export async function completeOrder({ orderId, orderNumber, actor = null, via = 'manual', renderJobId = null }) {
  const existing = orderId
    ? await prisma.order.findUnique({ where: { id: String(orderId) } })
    : await prisma.order.findFirst({ where: { orderNumber: String(orderNumber || '') } })
  if (!existing) throw new CompleteError('not_found', 'Order not found')
  if (existing.status === 'completed') return { order: existing, already: true }

  // The photo gate is for designs made by hand. When the script made the
  // design, it placed the photo and a person approved the result with the
  // photo on it: that approval is the confirmation, so no checkbox.
  let photoByRender = false
  if (existing.photoPath && !existing.photoPlacedAt) {
    const approved = await prisma.renderJob.findFirst({ where: { orderId: existing.id, review: 'approved', status: 'done' }, orderBy: { version: 'desc' }, select: { spec: true } })
    photoByRender = via === 'approve' || (approved?.spec?.photoPath && approved.spec.photoPath === existing.photoPath)
    if (!photoByRender) throw new CompleteError('photo_not_confirmed', 'This print includes a customer photo and was not made by the script. Confirm the photo is placed before completing the order.')
  }
  if (existing.photoAddedManually) {
    const siblings = await prisma.order.findMany({ where: { parentOrderNumber: existing.parentOrderNumber }, select: { id: true, photoPath: true, photoAddedManually: true, trackstarOrderType: true } })
    if (unpaidPhotoRows(siblings, existing.shopifyOrderData).has(existing.id)) {
      throw new CompleteError('photo_not_paid', 'The customer has not paid for the photo yet. Wait for the Shopify order to read paid before completing.')
    }
  }

  const order = await prisma.order.update({
    where: { id: existing.id },
    data: { status: 'completed', researchedAt: new Date(), ...(photoByRender && !existing.photoPlacedAt ? { photoPlacedAt: new Date() } : {}) },
  })
  // A render still waiting for review is moot now.
  const closed = await prisma.renderJob.updateMany({
    where: { orderId: existing.id, review: 'pending', ...(renderJobId ? { id: { not: renderJobId } } : {}) },
    data: { review: 'closed', reviewNote: via === 'approve' ? 'Another version was approved' : 'Order completed by hand', reviewedAt: new Date() },
  })

  await recordAudit({
    action: 'order.complete',
    summary: `Completed ${describeOrder(existing)}${via === 'approve' ? ' (design approved)' : ''}`,
    detail: { orderNumber: existing.orderNumber, orderType: existing.trackstarOrderType, runnerName: existing.runnerName, raceName: existing.raceName, via, closedRenders: closed.count },
    actor,
  })
  return { order, already: false, closedRenders: closed.count }
}
