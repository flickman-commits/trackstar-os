/**
 * GET /api/orders/customer-order?orderId=<our row id>
 *
 * One order as Support sees it (server/domain/support/threads.js
 * customerContext), for Support's order actions on the Fulfillment order
 * view: Edit shipping address, Create Artelo ticket, New Artelo order
 * (Eli, 2026-11-20). Returns { order, customer: { name, email } }.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability } from '../../_lib/users.js'
import prisma from '../../_lib/prisma.js'
import { customerContext } from '../../../server/domain/support/threads.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    const row = await prisma.order.findUnique({ where: { id: String(req.query?.orderId || '') }, select: { id: true, customerEmail: true, customerName: true, parentOrderNumber: true, shopifyOrderData: true } })
    if (!row) return res.status(404).json({ error: 'No such order' })
    const number = String(row.shopifyOrderData?.name || row.parentOrderNumber || '').replace(/^#/, '')
    const { orders } = await customerContext(row.customerEmail, { linked: number ? [number] : [] })
    const order = orders.find(o => o.source !== 'replacement' && (o.items || []).some(it => it.orderId === row.id)) || null
    if (!order) return res.status(404).json({ error: 'This order is not in Shopify, so Support\'s actions do not apply to it' })
    return res.status(200).json({ order, customer: { name: row.customerName || '', email: row.customerEmail || '' } })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
