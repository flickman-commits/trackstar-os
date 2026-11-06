/**
 * GET /api/orders/gift-stats?days=30
 *
 * What share of recent orders were bought as gifts.
 *
 * The signal is already in our database: the personalization wizard asks the
 * shopper outright and we store the answer as Order.isGift, so this needs no
 * Shopify call. Shopify separately tags some orders "gift" and the two agree
 * on 96% of orders, but isGift is the customer's own explicit answer, which is
 * the thing actually being measured here.
 *
 * Two counting decisions that change the number:
 *
 * 1. PER ORDER, not per line item. Our Order rows are one per printed item, so
 *    a three-print order would otherwise count three times and a customer who
 *    buys more prints would weigh more than one who buys one.
 *
 * 2. The denominator is orders that were ASKED. The wizard writes a "Gift"
 *    property on every order it handles, so its absence means the question was
 *    never put to that shopper (older orders, Etsy, some custom flows).
 *    Counting those as "not a gift" would understate the rate - 58% against
 *    69% on the current window - by treating "we never asked" as a no.
 */

import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

/** Did the wizard put the gift question to this shopper? */
function wasAsked(order) {
  const items = order?.shopifyOrderData?.line_items
  if (!Array.isArray(items)) return false
  return items.some(li =>
    Array.isArray(li?.properties) &&
    li.properties.some(p => typeof p?.name === 'string' && p.name.trim().toLowerCase() === 'gift')
  )
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const rows = await prisma.order.findMany({
      where: { createdAt: { gte: since } },
      select: { parentOrderNumber: true, isGift: true, shopifyOrderData: true },
    })

    // Collapse line items to orders. An order counts as a gift if any of its
    // items was flagged, which is how a shopper ticking the box on a
    // multi-print order actually behaves.
    const byOrder = new Map()
    let notAsked = 0
    for (const r of rows) {
      if (!wasAsked(r)) { notAsked++; continue }
      const key = r.parentOrderNumber || r.orderNumber
      byOrder.set(key, (byOrder.get(key) || false) || !!r.isGift)
    }

    const total = byOrder.size
    const gifts = [...byOrder.values()].filter(Boolean).length

    return res.status(200).json({
      days,
      since: since.toISOString(),
      total,
      gifts,
      // Null rather than 0 when nothing was asked, so the UI can stay quiet
      // instead of claiming a confident 0%.
      percent: total > 0 ? Math.round((gifts / total) * 100) : null,
      notAsked,
    })
  } catch (error) {
    console.error('[API /orders/gift-stats] Error:', error)
    return sendPublicError(res, error)
  }
}
