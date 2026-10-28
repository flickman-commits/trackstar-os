/**
 * Shopify products that never enter the fulfillment tool: prints with
 * nothing to personalize (the Catch Me If You Can posters), which Artelo
 * fulfills from its own library. Chosen in Settings > Skipped Products and
 * kept in SystemConfig as [{ id, title }], `id` being Shopify's numeric
 * product id, the one an order's line_items carry as product_id.
 *
 * The import (processOrders) skips a line whose product is on the list.
 * Saving the list also completes any open order already made for one, so it
 * leaves the queue the moment the product is switched off.
 */
import prisma from '../../db.js'
import { completeOrder } from './complete.js'
import { recordAudit } from '../../../api/_lib/users.js'

const KEY = 'excluded_products'

/** "gid://shopify/Product/10462469882139" or 10462469882139 -> "10462469882139". */
export const productNumber = id => (String(id ?? '').match(/(\d+)\s*$/) || [])[1] || null

export async function listExcluded() {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } })
  try {
    const list = JSON.parse(row?.value || '[]')
    return Array.isArray(list) ? list.filter(p => productNumber(p?.id)) : []
  } catch {
    return []
  }
}

/** True when this Shopify line item is one of the skipped products. */
export function isExcludedLine(line, excluded) {
  const id = productNumber(line?.product_id)
  return Boolean(id) && (excluded || []).some(p => productNumber(p.id) === id)
}

/**
 * Open orders made for a skipped product: a Shopify row whose own line (its
 * title is the row's raceName, as the import stores it) is on the list.
 */
async function openExcludedOrders(excluded) {
  if (!excluded.length) return []
  const rows = await prisma.order.findMany({
    where: { status: { not: 'completed' }, source: 'shopify', shopifyOrderData: { not: null } },
    select: { id: true, orderNumber: true, raceName: true, shopifyOrderData: true },
  })
  return rows.filter(r => (r.shopifyOrderData?.line_items || []).some(l =>
    isExcludedLine(l, excluded) && String(l.title || '').trim().toLowerCase() === String(r.raceName || '').trim().toLowerCase()))
}

/**
 * Save the list and complete the open orders it now covers.
 * @returns {{ excluded: {id: string, title: string}[], cleared: string[], problems: string[] }}
 */
export async function saveExcluded(products, actor) {
  const seen = new Set()
  const excluded = []
  for (const p of Array.isArray(products) ? products : []) {
    const id = productNumber(p?.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    excluded.push({ id, title: String(p.title || '').slice(0, 200) })
  }
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value: JSON.stringify(excluded) }, create: { key: KEY, value: JSON.stringify(excluded) } })
  await recordAudit({ action: 'settings.excluded_products', summary: `Skipped products: ${excluded.map(p => p.title || p.id).join(', ') || 'none'}`, detail: { excluded }, actor })

  const cleared = []
  const problems = []
  for (const o of await openExcludedOrders(excluded)) {
    try {
      await completeOrder({ orderId: o.id, actor, via: 'excluded' })
      await prisma.orderComment.create({ data: { orderId: o.id, authorName: 'Trackstar', text: `Completed: ${o.raceName} is a skipped product (Settings > Skipped Products), fulfilled by Artelo without personalizing.` } })
      cleared.push(o.orderNumber)
    } catch (e) {
      problems.push(`${o.orderNumber}: ${e.message}`)
    }
  }
  return { excluded, cleared, problems }
}
