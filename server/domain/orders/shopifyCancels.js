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
 * Artelo has no cancel API. When the order already reached Artelo and is not
 * cancelled there, one alert lists it for a person to cancel by hand.
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { requireConnection } from '../../lib/connections.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { arteloOrderUrl } from '../../lib/links.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

/** Artelo's live status for an order; our stored copy goes stale (6810 read Received after Artelo cancelled it). Null when Artelo does not answer. */
async function arteloStatus(id) {
  try {
    const res = await fetchWithTimeout(`https://www.artelo.com/api/open/orders/get-by-id?orderId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${process.env.ARTELO_API_KEY}` } })
    if (!res.ok) return null
    const o = await res.json()
    return String(o?.status || o?.productionStatus || '')
  } catch { return null }
}

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

  const toCancelInArtelo = []
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
    const artelo = rows.map(r => r.arteloOrderData).find(a => a?.id)
    if (artelo && !/cancel/i.test((await arteloStatus(artelo.id)) ?? String(artelo.status || ''))) toCancelInArtelo.push({ name: n.name, url: arteloOrderUrl(artelo.id) })
  }

  if (toCancelInArtelo.length) {
    const lines = toCancelInArtelo.map(x => `• ${slackText(x.name)}${x.url ? `: ${x.url}` : ''}`).join('\n')
    await slackTo('alerts', `:x: Cancelled in Shopify and closed here, but already in Artelo. *Cancel ${toCancelInArtelo.length === 1 ? 'it' : 'them'} in Artelo too:*\n${lines}`, { or: 'matt' }).catch(() => {})
  }
  return { checked: ids.length, closed: cancelled.length, arteloToCancel: toCancelInArtelo.length }
}
