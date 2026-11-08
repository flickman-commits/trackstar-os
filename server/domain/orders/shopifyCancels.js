/**
 * Orders cancelled in Shopify itself (not through Support or Manage your
 * order, which already close our rows: support/actions.cancelAndRefund) used
 * to sit open here forever with "Refunded or cancelled" on them and nothing
 * to do. Every import pass asks Shopify which open orders it has cancelled
 * and marks those complete with a note, so they leave the queue and can never
 * be sent to Artelo (arteloSend skips completed orders).
 *
 * Cancelled only, not refunded: a full refund without a cancel is sometimes a
 * goodwill refund on a print that still ships.
 *
 * The Shopify cancel carries over to Artelo on its own, so nothing is asked
 * of a person there.
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { requireConnection } from '../../lib/connections.js'

const CANCELLED = `
  query cancelled($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Order { id name cancelledAt cancelReason } }
  }
`
const CHUNK = 100

export async function closeShopifyCancels() {
  if (!process.env.SHOPIFY_STORE) return { checked: 0, closed: 0 }
  await requireConnection('shopify')
  const open = await prisma.order.findMany({
    where: { source: 'shopify', status: { not: 'completed' }, trackstarOrderType: { in: ['standard', 'custom'] } },
    select: { id: true, orderNumber: true, shopifyOrderData: true, arteloOrderData: true },
  })
  const byShopify = new Map()
  for (const o of open) {
    const sid = o.shopifyOrderData?.id
    if (!sid || o.shopifyOrderData?.cancelled_at) continue
    if (!byShopify.has(String(sid))) byShopify.set(String(sid), [])
    byShopify.get(String(sid)).push(o)
  }
  const ids = [...byShopify.keys()]
  const cancelled = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const gids = ids.slice(i, i + CHUNK).map(id => `gid://shopify/Order/${id}`)
    const data = await shopifyGraphQL(CANCELLED, { ids: gids })
    for (const n of (data?.data || data)?.nodes || []) {
      if (n?.cancelledAt) cancelled.push(n)
    }
  }

  for (const n of cancelled) {
    const sid = n.id.split('/').pop()
    const rows = byShopify.get(sid) || []
    if (!rows.length) continue
    const when = new Date(n.cancelledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
    const reason = n.cancelReason && n.cancelReason !== 'OTHER' ? ` (${n.cancelReason.toLowerCase()})` : ''
    for (const r of rows) {
      await prisma.order.update({
        where: { id: r.id },
        data: { status: 'completed', shopifyOrderData: { ...r.shopifyOrderData, cancelled_at: n.cancelledAt } },
      })
    }
    await prisma.orderComment.createMany({
      data: rows.map(r => ({ orderId: r.id, text: `Cancelled in Shopify on ${when}${reason}, so marked complete here.`, authorName: 'TrackstarOS' })),
    })
  }

  return { checked: ids.length, closed: cancelled.length }
}
