/**
 * Moving a custom or partner order through design. One place for the rules
 * so the dashboard and the MCP server agree:
 *
 *   - sent_to_production also completes the order; leaving it reopens it.
 *   - back from approved to in_revision un-approves the proof, so the
 *     customer's portal does not stay on the "approved" screen.
 *   - in_progress mints the approval token, so the customer can be messaged
 *     before any proof exists.
 *   - sent_to_production writes an "order.complete" line in the Activity
 *     Log, the same line a standard order gets, so the handling-time stats
 *     have an exact timestamp. A partner order also pings Elí on the proofs
 *     Slack channel to send it through.
 *   - a custom order is fulfilled by Artelo like every order (Matt,
 *     2026-11-10). Its final PDF (customFinal.js) is sent through Artelo on
 *     its own after the change window, and a person choosing Sent to
 *     production sends it now: if Artelo does not have it in production yet,
 *     the final PDF is attached to the Artelo order and sent (arteloSend.js
 *     sendNow), and the order is marked sent once Artelo takes it.
 */
import prisma from '../../db.js'
import { ensureApprovalToken } from '../../../api/_lib/approvalToken.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { describeOrder, assertArteloHasIt, CompleteError } from './complete.js'
import { slackTo } from '../../lib/slack.js'

export const DESIGN_STATUSES = ['not_started', 'in_progress', 'awaiting_review', 'in_revision', 'approved_by_customer', 'final_pdf_uploaded', 'sent_to_production']

// completedById: the person making the change, credited on the payout counter
// when this sends it to production. Falls back to the assignee (system calls).
// actor: the person, for the Activity Log (null for system calls).
// checkArtelo: a person moving it to Sent to Production must have sent it in
// Artelo first; our own send passes false (Artelo just accepted it).
export async function setDesignStatus(existing, designStatus, completedById = null, actor = null, { checkArtelo = true } = {}) {
  if (!DESIGN_STATUSES.includes(designStatus)) throw new Error(`Invalid designStatus. Must be one of: ${DESIGN_STATUSES.join(', ')}`)
  if (existing.trackstarOrderType !== 'custom' && existing.trackstarOrderType !== 'race_partner') {
    throw new Error('Design status can only be updated for custom or race partner orders')
  }

  if (designStatus === 'sent_to_production' && existing.designStatus !== 'sent_to_production' && checkArtelo) {
    const withArtelo = existing.arteloOrderData !== undefined ? existing : await prisma.order.findUnique({ where: { id: existing.id }, select: { arteloOrderData: true } })
    try {
      await assertArteloHasIt(withArtelo)
    } catch (e) {
      // Not in production at Artelo yet: a custom order is sent there now, not refused.
      if (existing.trackstarOrderType !== 'custom' || e?.code !== 'not_in_production') throw e
      return sendCustomThroughArtelo(existing, actor)
    }
  }

  const updateData = { designStatus }
  if (designStatus === 'sent_to_production') {
    updateData.status = 'completed'
    updateData.researchedAt = new Date()
    if (existing.designStatus !== 'sent_to_production') {
      updateData.designCompletedAt = updateData.researchedAt
      updateData.designCompletedById = completedById || existing.assigneeId || null
    }
  }
  if (existing.designStatus === 'sent_to_production' && designStatus !== 'sent_to_production') {
    updateData.status = 'pending'
    updateData.researchedAt = null
    updateData.designCompletedAt = null
    updateData.designCompletedById = null
  }
  if (existing.designStatus === 'approved_by_customer' && designStatus === 'in_revision') {
    await prisma.proof.updateMany({ where: { orderId: existing.id, status: 'approved' }, data: { status: 'revision_requested' } })
  }

  const order = await prisma.order.update({ where: { id: existing.id }, data: updateData })
  if (designStatus === 'in_progress') await ensureApprovalToken(existing.id)
  if (designStatus === 'sent_to_production' && existing.designStatus !== 'sent_to_production') {
    await recordAudit({
      action: 'order.complete',
      summary: `Completed ${describeOrder(existing)} (sent to production)`,
      detail: { orderNumber: existing.orderNumber, orderType: existing.trackstarOrderType, runnerName: existing.runnerName, raceName: existing.raceName, via: 'sent_to_production' },
      actor: actor || (completedById ? { id: completedById } : null),
    })
  }

  if (designStatus === 'sent_to_production' && existing.trackstarOrderType === 'race_partner') {
    const shopifyData = existing.shopifyOrderData
    const displayNum = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
      ? String(shopifyData.name) : `#${existing.parentOrderNumber}`
    slackTo('alerts', `🖨️ <@U09UVEP1N3Y> Final PDF ready for order *${displayNum}* - ready for production!`)
  }
  return order
}

/**
 * Send a custom order's final PDF through Artelo now (the person chose Sent
 * to production). The same send a standard print gets: attach the file to the
 * order's Artelo item, send the order to production, and mark it sent here
 * (arteloSend.js markSent). Returns the order once it is marked; otherwise
 * says where it stands (a CompleteError the order screen shows).
 */
async function sendCustomThroughArtelo(existing, actor) {
  // Loaded here: arteloSend.js imports this file.
  const { sendNow, SendError } = await import('../render/arteloSend.js')
  try {
    await sendNow({ orderId: existing.id, actor })
  } catch (err) {
    if (!(err instanceof SendError)) throw err
    const why = /no approved print/i.test(err.message)
      ? 'There is no final PDF to send yet. Upload it first; it is attached to the Artelo order and sent to production from there.'
      : `It was not sent to Artelo: ${err.message.replace(/\.$/, '')}.`
    throw new CompleteError('not_sent', why)
  }
  const after = await prisma.order.findUnique({ where: { id: existing.id } })
  if (after?.designStatus === 'sent_to_production') return after
  const job = await prisma.renderJob.findFirst({ where: { orderId: existing.id, status: 'done', review: 'approved' }, orderBy: { version: 'desc' }, select: { sendError: true } })
  throw new CompleteError('sending', job?.sendError
    ? `Sent to Artelo, not in production yet: ${String(job.sendError).replace(/\.$/, '')}. The tool keeps trying and marks it sent to production once Artelo takes it.`
    : 'Sent to Artelo. It is marked sent to production as soon as Artelo takes it.')
}
