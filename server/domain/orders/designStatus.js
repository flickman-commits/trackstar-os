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
 *     Slack channel to send it through. A custom order does not: its
 *     designer uploads the final PDF here (customFinal.js), attaches it in
 *     Artelo and sends it through themselves.
 */
import prisma from '../../db.js'
import { ensureApprovalToken } from '../../../api/_lib/approvalToken.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { describeOrder, assertArteloHasIt } from './complete.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

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
    await assertArteloHasIt(withArtelo)
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

  if (designStatus === 'sent_to_production' && existing.trackstarOrderType === 'race_partner' && process.env.SLACK_PROOF_WEBHOOK_URL) {
    const shopifyData = existing.shopifyOrderData
    const displayNum = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
      ? String(shopifyData.name) : `#${existing.parentOrderNumber}`
    fetchWithTimeout(process.env.SLACK_PROOF_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🖨️ <@U09UVEP1N3Y> Final PDF ready for order *${displayNum}* - ready for production!` }),
    }).catch(e => console.warn('[designStatus] Slack failed:', e.message))
  }
  return order
}
