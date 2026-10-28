/**
 * Keep the stored Shopify order current for prints waiting on a photo payment.
 *
 * A photo attached after purchase is billed by editing the Shopify order; the
 * customer pays later, and only then does the print read "photo paid". The
 * import refreshes an order's stored Shopify data while it is in the Artelo
 * pull, but an older order drops out of that pull and its copy goes stale,
 * so the payment never showed. This looks only at open orders with a photo
 * that still reads unpaid, re-reads those few orders from Shopify, and stores
 * the new line items and payment status when they changed.
 */
import prisma from '../../db.js'
import { shopifyFetch } from '../../services/shopifyAuth.js'
import { normalizeShopifyLines } from '../../lib/lineItemMatching.js'
import { unpaidPhotoRows } from './photoPayment.js'

export async function refreshUnpaidPhotoOrders({ limit = 30, log = () => {} } = {}) {
  const rows = await prisma.order.findMany({
    where: { source: 'shopify', status: { not: 'completed' }, photoPath: { not: null } },
    select: { id: true, orderNumber: true, parentOrderNumber: true, source: true, photoPath: true, photoAddedManually: true, photoFree: true, shopifyOrderData: true, trackstarOrderType: true },
  })
  const byParent = new Map()
  for (const r of rows) { if (!byParent.has(r.parentOrderNumber)) byParent.set(r.parentOrderNumber, []); byParent.get(r.parentOrderNumber).push(r) }

  let checked = 0, updated = 0
  for (const [parent, prints] of byParent) {
    if (checked >= limit) break
    const stored = prints[0].shopifyOrderData
    if (!stored || !unpaidPhotoRows(prints, stored).size) continue
    checked++
    try {
      const data = await shopifyFetch(`/orders/${parent}.json`)
      if (!data.order?.line_items?.length) continue
      const fresh = { ...stored, ...data.order, line_items: normalizeShopifyLines(data.order.line_items) }
      const lines = o => JSON.stringify((o.line_items || []).map(l => [l.id, l.current_quantity ?? l.quantity]))
      if (fresh.financial_status === stored.financial_status && lines(fresh) === lines(stored)) continue
      await prisma.order.updateMany({ where: { parentOrderNumber: parent, source: 'shopify' }, data: { shopifyOrderData: fresh } })
      updated++
      const stillUnpaid = unpaidPhotoRows(prints, fresh).size
      log(`${data.order.name}: ${fresh.financial_status}, ${stillUnpaid ? 'photo still unpaid' : 'photo now paid'}`)
    } catch (e) {
      log(`${parent}: refresh failed: ${e.message}`)
    }
  }
  return { checked, updated }
}
