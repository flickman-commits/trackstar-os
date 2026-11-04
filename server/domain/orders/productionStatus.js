/**
 * Where one order is after it leaves us: Artelo's production status, read
 * live, and Shopify's fulfillment with the tracking Artelo posts back to it
 * (the same data Support shows, server/domain/support/threads.js). For the
 * order view, so a completed order can still be checked on: printed yet,
 * shipped, delivered.
 *
 * Either service being down costs its half only; the answer says so.
 */
import { alignTracking } from '../../lib/tracking.js'
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { requireConnection } from '../../lib/connections.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import { arteloOrderUrl } from '../../lib/links.js'

const ORDER_BY_ID = `
  query order($id: ID!) {
    order(id: $id) {
      displayFinancialStatus displayFulfillmentStatus cancelledAt
      fulfillments { status createdAt displayStatus deliveredAt estimatedDeliveryAt inTransitAt trackingInfo { url number company } }
    }
  }
`

async function arteloOrder(id) {
  await requireConnection('artelo')
  const res = await fetchWithTimeout(`https://www.artelo.com/api/open/orders/get-by-id?orderId=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.ARTELO_API_KEY}` },
  })
  if (!res.ok) throw new Error(`Artelo answered ${res.status}`)
  return res.json()
}

/** Artelo's words for an order, said plainly. */
function arteloLabel(status) {
  const s = String(status || '')
  return {
    Received: 'Received, not printed yet',
    InProduction: 'Being printed',
    Produced: 'Printed',
    Shipped: 'Shipped',
    Delivered: 'Delivered',
    Cancelled: 'Cancelled',
    Ignored: 'Test order',
  }[s] || s.replace(/([a-z])([A-Z])/g, '$1 $2') || null
}

/**
 * @returns {{ stage: string|null, production: object|null, fulfillment: object|null, tracking: object[], errors: string[] }}
 */
export async function productionStatus(orderId) {
  const o = await prisma.order.findUnique({
    where: { id: String(orderId || '') },
    select: { source: true, lineItemIndex: true, shopifyOrderData: true, arteloOrderData: true, trackingNumber: true, trackingCarrier: true, shippedAt: true },
  })
  if (!o) return null
  const errors = []
  const arteloId = o.arteloOrderData?.id || null
  const shopifyId = o.source === 'shopify' ? (o.shopifyOrderData?.id || null) : null

  const [artelo, shopify] = await Promise.all([
    arteloId ? arteloOrder(arteloId).catch(err => { errors.push('Artelo did not answer'); console.warn(`[orders.production] Artelo ${arteloId}: ${err.message}`); return null }) : null,
    shopifyId && process.env.SHOPIFY_STORE
      ? shopifyGraphQL(ORDER_BY_ID, { id: `gid://shopify/Order/${shopifyId}` }).then(d => (d.data || d).order).catch(err => { errors.push('Shopify did not answer'); console.warn(`[orders.production] Shopify ${shopifyId}: ${err.message}`); return null })
      : null,
  ])

  // This print's own item in Artelo, matched the way the import stored it.
  const storedItem = o.arteloOrderData?.orderItems?.[o.lineItemIndex]
  const item = artelo?.orderItems?.find(i => i.orderItemId === storedItem?.orderItemId) || null
  const production = artelo ? {
    status: arteloLabel(artelo.status),
    itemStatus: item?.productionStatus ? arteloLabel(item.productionStatus) : null,
    url: arteloOrderUrl(arteloId),
  } : (arteloId ? { status: null, itemStatus: null, url: arteloOrderUrl(arteloId) } : null)

  const tracking = shopify
    ? (shopify.fulfillments || []).flatMap(f => (f.trackingInfo || []).map(t => alignTracking({
        url: t.url || null, number: t.number || null, company: t.company || null,
        shippedAt: f.createdAt, deliveredAt: f.deliveredAt || null, estimatedAt: f.estimatedDeliveryAt || null,
        status: f.displayStatus || null,
      })))
    : (o.trackingNumber ? [alignTracking({ url: null, number: o.trackingNumber, company: o.trackingCarrier, shippedAt: o.shippedAt, deliveredAt: null, estimatedAt: null, status: null })] : [])

  const fulfillment = shopify ? { status: shopify.displayFulfillmentStatus || null, financial: shopify.displayFinancialStatus || null, cancelled: Boolean(shopify.cancelledAt) } : null

  // One line for where it is now, furthest along first.
  const stage = fulfillment?.cancelled || fulfillment?.financial === 'REFUNDED' ? 'Refunded or cancelled'
    : tracking.some(t => t.deliveredAt || t.status === 'DELIVERED') ? 'Delivered'
    : tracking.some(t => t.status === 'OUT_FOR_DELIVERY') ? 'Out for delivery'
    : tracking.some(t => t.status === 'IN_TRANSIT') ? 'In transit'
    : tracking.length || fulfillment?.status === 'FULFILLED' ? 'Shipped'
    : production?.status ? `In production: ${production.itemStatus || production.status}`
    : arteloId ? 'Sent to Artelo'
    : 'Not sent to production yet'

  return { stage, production, fulfillment, tracking, errors }
}
