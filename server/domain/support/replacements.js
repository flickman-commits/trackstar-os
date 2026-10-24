/**
 * Replacement orders, for the Support Orders panel. A replacement never goes
 * through Shopify: it exists only in Artelo, made one of two ways.
 *
 *   - by Artelo, when its support accepts a damage or loss claim (or someone
 *     uses Replace in the Artelo app). Its orderId is the Shopify id plus
 *     "-R" (7514822312219-R) and its name is "4341-R". Artelo pays for it.
 *   - by us, from Support's New Artelo order (arteloOrder.js): "4874-R1",
 *     "-R2". We pay for it like any order.
 *
 * Artelo's orders/get filters on name or orderId as a substring, so one
 * lookup per order finds both; the match below keeps only true replacements
 * of that order. Each comes back in the panel's order shape, marked with
 * `replacement`, beside the order it replaces. Artelo being slow or down
 * costs the replacements, never the page.
 */
import { call } from '../render/artelo.js'
import { arteloOrderUrl } from '../../lib/links.js'

const MAX_ORDERS = 10
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where a replacement is, in Artelo's words made plain. */
function stageOf(o) {
  if (o.status === 'Canceled' || o.productionStatus === 'Canceled') return 'Canceled'
  if (o.status === 'Delivered' || o.shippingStatus === 'Delivered') return 'Delivered'
  if (o.status === 'Shipped' || /transit|shipped/i.test(o.shippingStatus || '')) return 'Shipped'
  if (o.status === 'PendingFulfillmentAction') return 'Waiting in Artelo'
  return 'In production'
}

/** "x12x18" -> "12x18" */
const sizeOf = p => String(p?.size || '').replace(/^x/, '').replace(/dot/g, '.')

async function lookup(order) {
  const number = String(order.number || '').replace(/^#/, '')
  if (!number) return []
  const ids = [number, order.shopifyOrderId].filter(Boolean).map(esc).join('|')
  const own = new RegExp(`^(${ids})-R\\d*$`)
  const found = await call('orders/get', { query: { limit: '20', allOrders: 'true', name: `${number}-R` } })
  return (Array.isArray(found) ? found : [])
    .filter(r => own.test(String(r.orderId || '')) && r.productionStatus !== 'Ignored')
    .map(r => {
      const orderId = String(r.orderId)
      const suffix = orderId.slice(orderId.lastIndexOf('-R'))
      const free = !(r.details?.productionCost > 0 || r.details?.arteloShipping > 0)
      // The same prints as the original, at the size and frame Artelo is making.
      const items = (r.orderItems || []).map((it, n) => {
        const base = order.items[n] || order.items[0]
        return base ? { ...base, size: sizeOf(it.product) || base.size, frame: it.product?.frameColor || base.frame } : null
      }).filter(Boolean)
      return {
        number: `${number}${suffix}`,
        source: 'replacement',
        shopifyOrderId: null,
        adminUrl: null,
        arteloUrl: arteloOrderUrl(r.id) || null,
        createdAt: new Date(String(r.createdAt).replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString(),
        financialStatus: null,
        fulfillmentStatus: null,
        totalUsd: null,
        discountCodes: [],
        shipTo: order.shipTo,
        shipToLine: order.shipToLine,
        arteloAddress: order.arteloAddress,
        tracking: (r.shipments || []).filter(s => s.trackingNumber).map(s => ({ url: s.trackingUrl || null, number: s.trackingNumber, company: s.carrierCode || null, at: null, fromArtelo: true, deliveredAt: null })),
        lineItems: [],
        items,
        imported: false,
        mockups: [],
        linked: false,
        replacement: { of: number, stage: stageOf(r), free, by: r.channelName === 'Trackstar Support' ? 'us' : 'artelo', instructions: r.instructions || null },
      }
    })
}

/** The replacements of these orders (the newest ten), in the panel's order shape. */
export async function replacementsFor(orders) {
  const results = await Promise.allSettled(orders.filter(o => o.source !== 'replacement').slice(0, MAX_ORDERS).map(lookup))
  const out = []
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value)
    else console.warn(`[support] Artelo replacements: ${r.reason?.message}`)
  }
  return out
}
