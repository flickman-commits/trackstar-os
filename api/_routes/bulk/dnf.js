/**
 * /api/bulk/dnf - a bulk runner who did not finish (server/domain/bulk/dnf.js):
 * their order closes, nothing prints, and they leave the runner list and the
 * print count.
 *
 *   POST { orderId | orderNumber }              mark DNF
 *   POST { orderId | orderNumber, undo: true }  put them back
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { recordAudit } from '../../_lib/users.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { markDnf, undoDnf } from '../../../server/domain/bulk/dnf.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const who = { orderId: body.orderId, orderNumber: body.orderNumber }
    if (body.undo) {
      const r = await undoDnf(who)
      await recordAudit({ action: 'bulk.runner_dnf_undone', summary: `Put ${r.runnerName} (${r.orderNumber}) back on their bulk order`, detail: r, actor })
      return res.status(200).json({ ok: true, ...r })
    }
    const r = await markDnf(who, actor)
    await recordAudit({ action: 'bulk.runner_dnf', summary: `Marked ${r.runnerName} (${r.orderNumber}) DNF on bulk order ${r.bulk?.number}: order closed, one print fewer`, detail: { orderId: r.orderId, orderNumber: r.orderNumber, bulkOrderId: r.bulk?.id }, actor })
    return res.status(200).json({ ok: true, ...r })
  } catch (error) {
    if (error?.expose) return res.status(error.status || 400).json({ error: error.message })
    return sendPublicError(res, error)
  }
}
