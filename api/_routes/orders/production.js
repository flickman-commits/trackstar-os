/**
 * GET ?orderId=  Where an order is after it leaves us: Artelo's production
 * status and Shopify's shipping and tracking, read live
 * (server/domain/orders/productionStatus.js). For the order view's
 * Production & shipping section.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { productionStatus } from '../../../server/domain/orders/productionStatus.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const out = await productionStatus(req.query?.orderId)
    if (!out) return res.status(404).json({ error: 'Order not found' })
    return res.status(200).json(out)
  } catch (error) {
    return sendPublicError(res, error)
  }
}
