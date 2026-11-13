/**
 * /api/bulk/refund - refunds on a bulk order (server/domain/bulk/refunds.js).
 *
 *   GET ?id=                     the prints paid for and being made, the refunds; what was paid and the suggestions for admins
 *   POST { action, ... }
 *     request  { id, kind: full|unfilled|custom, reason, amountCents?, paidCents? }   anyone on the order; amounts are admins'
 *     approve  { refundId, amountCents?, paidCents? }   admins: Shopify refunds now, Stripe waits to be done there
 *     refunded { refundId }                             admins: a Stripe refund done in Stripe
 *     decline  { refundId, note? }                      admins, or whoever asked while it waits
 */
import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import { seesMoney } from '../../_lib/money.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { refundState, requestRefund, approveRefund, markRefunded, closeRefund } from '../../../server/domain/bulk/refunds.js'

const dollars = c => (c == null ? 'amount for an admin to set' : `$${(c / 100).toFixed(2)}`)
const num = v => (v == null || v === '' ? undefined : Math.round(Number(v)))

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  // Amounts are admins' (api/_lib/money.js); anyone else asks by prints.
  const money = seesMoney(actor)
  try {
    if (req.method === 'GET') return res.status(200).json(await refundState(req.query?.id, { money }))
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    let r
    switch (body.action) {
      case 'request': {
        r = await requestRefund(body.id, { kind: body.kind, reason: body.reason, amountCents: money ? num(body.amountCents) : undefined, paidCents: money ? num(body.paidCents) : undefined }, actor, { money })
        await recordAudit({ action: 'bulk.refund_requested', summary: `Asked for a ${r.kind === 'unfilled' ? `${r.prints}-print` : r.kind} refund on a bulk order (${money ? dollars(r.amountCents) : 'amount for an admin to set'})`, detail: { bulkOrderId: r.bulkOrderId, refundId: r.id }, actor })
        break
      }
      case 'approve': {
        // Destructive and big: the role is read again from the database.
        const admin = await requireAdminRole(req, res, actor)
        if (!admin) return
        r = await approveRefund(body.refundId, { amountCents: num(body.amountCents), paidCents: num(body.paidCents) }, admin)
        await recordAudit({ action: 'bulk.refund_approved', summary: `Approved a ${dollars(r.amountCents)} bulk order refund${r.status === 'refunded' ? ', refunded through Shopify' : ', to refund in Stripe'}`, detail: { bulkOrderId: r.bulkOrderId, refundId: r.id }, actor: admin })
        break
      }
      case 'refunded': {
        const admin = await requireAdminRole(req, res, actor)
        if (!admin) return
        r = await markRefunded(body.refundId, admin)
        await recordAudit({ action: 'bulk.refund_done', summary: `Marked a ${dollars(r.amountCents)} bulk order refund done in Stripe`, detail: { bulkOrderId: r.bulkOrderId, refundId: r.id }, actor: admin })
        break
      }
      case 'decline': {
        r = await closeRefund(body.refundId, { note: body.note }, actor, { admin: actor.role === 'admin' })
        await recordAudit({ action: 'bulk.refund_declined', summary: 'Declined a bulk order refund', detail: { bulkOrderId: r.bulkOrderId, refundId: r.id }, actor })
        break
      }
      default: return res.status(400).json({ error: 'Unknown action' })
    }
    const bulkOrderId = r?.bulkOrderId || (await prisma.bulkRefund.findUnique({ where: { id: String(body.refundId || '') }, select: { bulkOrderId: true } }))?.bulkOrderId
    return res.status(200).json(await refundState(bulkOrderId, { money }))
  } catch (error) {
    if (error?.expose) return res.status(error.status || 400).json({ error: error.message })
    return sendPublicError(res, error)
  }
}
