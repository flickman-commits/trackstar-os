/**
 * POST /api/orders/rush - admin only. Move a custom order to the front of the
 * line by hand, or take it back out.
 *
 *   { orderId, rush: true, dueDate? }   rush: due 4 days from purchase, or the
 *                                       date given (YYYY-MM-DD)
 *   { orderId, rush: false }            back to standard: 14 days from purchase
 *
 * Marks the order rushOverride so the import's paid-rush check leaves it
 * alone. Written to the audit log.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import prisma from '../../_lib/prisma.js'
import { customDueDate } from '../../../server/processOrders.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  const admin = await requireAdminRole(req, res, actor)
  if (!admin) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const order = await prisma.order.findUnique({
      where: { id: String(body.orderId || '') },
      select: { id: true, orderNumber: true, trackstarOrderType: true, dueDate: true, createdAt: true, shopifyOrderData: true },
    })
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (order.trackstarOrderType !== 'custom') return res.status(400).json({ error: 'Rush is only for custom orders' })

    const placed = order.shopifyOrderData?.created_at || order.createdAt
    const rush = !!body.rush
    let dueDate
    if (rush && body.dueDate) {
      const d = new Date(`${String(body.dueDate).slice(0, 10)}T12:00:00`)
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'That due date is not a date' })
      dueDate = d
    } else {
      dueDate = customDueDate(placed, rush)
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { isRushOrder: rush, rushOverride: rush, dueDate },
      select: { id: true, isRushOrder: true, rushOverride: true, dueDate: true },
    })
    await recordAudit({
      action: rush ? 'order.rush-on' : 'order.rush-off',
      summary: `${rush ? 'Made rush' : 'Took off rush'}: ${order.orderNumber}, due ${dueDate.toISOString().slice(0, 10)}`,
      detail: { orderId: order.id, from: order.dueDate, to: dueDate },
      actor: admin,
    })
    return res.status(200).json({ order: updated })
  } catch (error) {
    console.error('[API /orders/rush]', error)
    return res.status(500).json({ error: 'Could not update rush' })
  }
}
