/**
 * Orders cancelled on Etsy leave the queue, the way Shopify cancellations do
 * (shopifyCancels.js). Etsy order 4215477029 was cancelled on Oct 31 and sat
 * in Action for a week: nothing asked Etsy. Every import pass asks Etsy for
 * receipts cancelled in the last 90 days and marks any open order on one of
 * them complete, with a note saying so.
 *
 * Only Etsy's own status counts. An Artelo order cancelled to send something
 * else (a replacement, a different size) is not the customer's order being
 * cancelled, so Artelo's status is never read here.
 */
import prisma from '../../db.js'
import { etsyFetch } from '../../services/etsyAuth.js'
import { requireConnection } from '../../lib/connections.js'

const LOOKBACK_DAYS = 90

/** Etsy receipts cancelled since the lookback, by receipt id. */
async function cancelledReceipts(shopId) {
  const since = Math.floor((Date.now() - LOOKBACK_DAYS * 86_400_000) / 1000)
  const out = new Map()
  for (let offset = 0; offset < 1000; offset += 100) {
    const res = await etsyFetch(`/shops/${shopId}/receipts?was_canceled=true&min_last_modified=${since}&limit=100&offset=${offset}`)
    const data = typeof res?.json === 'function' ? await res.json() : res
    const rows = data?.results || []
    for (const r of rows) if (String(r.status || '').toLowerCase() === 'canceled') out.set(String(r.receipt_id), r)
    if (rows.length < 100) break
  }
  return out
}

export async function closeEtsyCancels() {
  const shopId = String(process.env.ETSY_SHOP_ID || '').trim()
  if (!shopId) return { checked: 0, closed: 0 }
  await requireConnection('etsy')
  const open = await prisma.order.findMany({
    where: { source: 'etsy', status: { not: 'completed' }, trackstarOrderType: { in: ['standard', 'custom'] } },
    select: { id: true, parentOrderNumber: true, etsyOrderData: true },
  })
  if (!open.length) return { checked: 0, closed: 0 }
  const cancelled = await cancelledReceipts(shopId)
  let closed = 0
  const done = new Set()
  for (const o of open) {
    const rid = String(o.etsyOrderData?.receipt_id || o.parentOrderNumber)
    const r = cancelled.get(rid)
    if (!r) continue
    const when = new Date((r.updated_timestamp || r.update_timestamp || Date.now() / 1000) * 1000)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
    await prisma.$transaction([
      prisma.order.update({ where: { id: o.id }, data: { status: 'completed', etsyOrderData: { ...(o.etsyOrderData || {}), status: r.status } } }),
      prisma.orderComment.create({ data: { orderId: o.id, text: `Cancelled on Etsy (${when}), so marked complete here.`, authorName: 'TrackstarOS' } }),
    ])
    done.add(rid)
    closed++
  }
  return { checked: open.length, closed, receipts: done.size }
}
