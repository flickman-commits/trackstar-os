/**
 * GET ?orderId=  Everything that happened on a custom order, oldest first,
 * and where it is now (server/domain/orders/timeline.js). For the Sent
 * stage of the order view: what was made, who did what, and when.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { orderTimeline } from '../../../server/domain/orders/timeline.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const out = await orderTimeline(req.query?.orderId)
    if (!out) return res.status(404).json({ error: 'Order not found' })
    return res.status(200).json(out)
  } catch (error) {
    return sendPublicError(res, error)
  }
}
