/**
 * POST /api/orders/queue { orderId, stage, note }
 *
 * Move a standard order to another queue by hand (review, action, waiting,
 * hold), with a reason; stage null puts it back in its own queue. The move
 * holds until the order changes (server/domain/orders/queueOverride.js).
 * Anyone on the team; commented on the order and audited.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { recordAudit } from '../../_lib/users.js'
import { setQueueOverride } from '../../../server/domain/orders/queueOverride.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const out = await setQueueOverride({ orderId: body.orderId, stage: body.stage || null, note: body.note, actor })
    await recordAudit({ action: 'order.queue', summary: out.stage ? `Moved order ${body.orderId} to ${out.stage} by hand` : `Put order ${body.orderId} back in its own queue`, detail: { orderId: body.orderId, stage: out.stage, note: body.note || null }, actor })
    return res.status(200).json(out)
  } catch (error) {
    if (error?.expose) return res.status(error.status || 400).json({ error: error.message })
    return sendPublicError(res, error)
  }
}
