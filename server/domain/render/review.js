/**
 * A person's yes or no on a finished render, and what an approval sets off.
 * Used by api/_routes/render/jobs.js and the MCP design tools, so both do the same thing.
 */
import prisma from '../../db.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { reviewJob } from './jobs.js'
import { uploadApprovedToArtelo } from './artelo.js'
import { deliverApproved } from './deliver.js'
import { markRacePrinted } from '../races/verification.js'
import { needFromRejection } from './designNeeds.js'
import { queueRunnerSend } from '../bulk/send.js'
import { describeOrder } from '../orders/complete.js'
import { queueSend } from './arteloSend.js'

/** Copy an approved print to the Drive Orders folder, then upload it to the Artelo library. Never throws. */
export async function deliverEverywhere(job) {
  try {
    let j = job.deliveredAt ? job : await deliverApproved(job)
    if (!j.arteloUploadedAt) j = await uploadApprovedToArtelo(j)
    return j
  } catch (e) { console.error('[render/review] background delivery', job.id, e.message) }
}

/**
 * Approve or reject a finished render as `user`. On approve: the race year is
 * locked (printed), other renders of the order waiting for review are closed,
 * and `delivery` is the Drive + Artelo upload, already started, for the caller
 * to keep alive (inBackground) or await. A failed delivery shows on the order
 * and is retried by the import. Unless `send` is false (Approve only), the
 * print is queued to go to production after a short hold (arteloSend.js),
 * which also completes the order.
 * @returns {Promise<{ job: object, delivery: Promise|null }>}
 */
/**
 * designNeed: the reviewer says a rejection is a problem in the production
 * file, not in the order's data, so it goes on the designer's list
 * (designNeeds.js). A wrong bib or time stays off it.
 */
export async function reviewRender({ jobId, decision, note, user, designNeed = false, send = true }) {
  let job = await reviewJob({ jobId, decision, note, reviewerId: user?.id || null })
  if (job.review === 'rejected' && designNeed) {
    const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: { id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, shopifyOrderData: true } })
    await needFromRejection({ job, order: order ? { ...order, name: order.shopifyOrderData?.name || null } : null, note: job.reviewNote || note, actor: user })
  }
  let delivery = null
  if (job.review === 'approved') {
    if (job.spec?.raceId) await markRacePrinted(job.spec.raceId)
    if (send) job = await queueSend(job)
    delivery = deliverEverywhere(job)
    // A bulk runner goes to Artelo as their own order once approved (bulk/send.js).
    if (send) await queueRunnerSend(job.orderId).catch(e => console.error('[render/review] bulk queue', job.id, e.message))
    await prisma.renderJob.updateMany({ where: { orderId: job.orderId, review: 'pending', id: { not: job.id } }, data: { review: 'closed', reviewNote: 'Another version was approved', reviewedAt: new Date() } })
  }
  // Named by the order, not the template file, so the Activity Log finds it by order number.
  const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: { orderNumber: true, parentOrderNumber: true, runnerName: true, raceName: true, raceYear: true } }).catch(() => null)
  const what = order ? `the design of ${describeOrder(order)}` : `the render of ${job.spec?.file || job.orderId}`
  const verb = job.review === 'approved' ? (job.sendAfter ? 'Approved and queued for production' : job.sendHeldAt ? 'Approved (held, not sent)' : 'Approved') : 'Rejected'
  await recordAudit({ action: `render.${job.review}`, summary: `${verb} ${what} (v${job.version})${job.reviewNote ? `: ${job.reviewNote}` : ''}`, detail: { jobId: job.id, orderId: job.orderId, orderNumber: order?.orderNumber || null, parentOrderNumber: order?.parentOrderNumber || null, version: job.version, template: job.spec?.file || null, queuedForProduction: Boolean(job.sendAfter) }, actor: user })
  return { job, delivery }
}
