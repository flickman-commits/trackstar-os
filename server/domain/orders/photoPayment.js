/**
 * Is a photo on this order paid for?
 *
 * Each print with a photo needs one paid Photo Add-On line on the Shopify
 * order. At checkout the theme adds them; after purchase we edit the order in
 * Shopify, add the add-on, and the customer pays the difference. Until Shopify
 * reads paid, a photo attached by hand is unpaid.
 */
import { isPhotoAddonLineItem, isRemovedLineItem } from '../../lib/lineItemMatching.js'

const PAID = ['paid', 'partially_refunded']

/** Paid Photo Add-On units on the order (0 while the order awaits payment). */
export function paidPhotoAddons(shopifyOrderData) {
  if (!PAID.includes(shopifyOrderData?.financial_status)) return 0
  const items = Array.isArray(shopifyOrderData?.line_items) ? shopifyOrderData.line_items : []
  return items
    .filter(li => isPhotoAddonLineItem(li) && !isRemovedLineItem(li))
    .reduce((n, li) => n + Number(li.current_quantity ?? li.quantity ?? 1), 0)
}

/**
 * For the prints of one Shopify order: which hand-attached photos are unpaid.
 * Photos from checkout are always treated as paid (the theme charged them).
 * A custom order's photo bought at checkout counts like any other; one the
 * customer emails afterwards is added free, so it is never unpaid. A photo
 * marked free (photoFree) is never unpaid either, and does not use up a paid
 * add-on another print needs.
 * @param {{ id: string, photoPath: string|null, photoAddedManually: boolean, photoFree?: boolean, trackstarOrderType?: string|null }[]} rows
 * @returns {Set<string>} ids of rows whose photo is not paid
 */
export function unpaidPhotoRows(rows, shopifyOrderData) {
  const withPhoto = rows.filter(r => r.photoPath && !r.photoFree && !(r.photoAddedManually && r.trackstarOrderType === 'custom'))
  const manual = withPhoto.filter(r => r.photoAddedManually)
  if (!manual.length) return new Set()
  const covered = Math.max(0, paidPhotoAddons(shopifyOrderData) - (withPhoto.length - manual.length))
  return new Set(manual.slice(covered).map(r => r.id))
}

const PHOTO_PROP = li => (li?.properties || []).some(p => p?.name === '_photo_path' && String(p.value || '').trim())

/**
 * The reverse of unpaidPhotoRows: the customer paid for a photo and this
 * print has none. Order 9643 (Nov 2026) came through Shopify with a paid
 * $20 Photo Add-On and none of the personalization, no photo included; it
 * printed and shipped without the photo the customer paid for. A print with
 * no photo of its own is short one when the order's paid add-ons outnumber
 * the photos that came with it at checkout. Cleared by attaching the photo
 * (Add photo) or by refunding the add-on in Shopify. A photo the customer
 * chose to send after the race (photoLater) is waited for elsewhere.
 */
export function paidPhotoMissing(order) {
  if (!order || order.photoPath || order.photoLater || order.source !== 'shopify') return false
  const data = order.shopifyOrderData
  const paid = paidPhotoAddons(data)
  if (!paid) return false
  const items = Array.isArray(data?.line_items) ? data.line_items : []
  const withPhoto = items.filter(li => !isPhotoAddonLineItem(li) && !isRemovedLineItem(li) && PHOTO_PROP(li))
    .reduce((n, li) => n + Number(li.current_quantity ?? li.quantity ?? 1), 0)
  return paid > withPhoto
}
