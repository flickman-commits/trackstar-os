/**
 * Which custom orders still need designing. Not only the design status: a
 * canceled order is marked completed here and its design never moves, so
 * "not sent to production" alone kept 10775 and 10420 in the queue, the
 * standup and the counts after they were canceled and refunded.
 */
export const OPEN_CUSTOM = { trackstarOrderType: 'custom', designStatus: { not: 'sent_to_production' }, status: { not: 'completed' } }

/**
 * Canceled at the shop: Shopify's cancel date (written by the hourly check,
 * shopifyCancels.js, and by a cancel from Support or Manage your order), or
 * an Etsy receipt closed as canceled (etsyCancels.js). A completed custom
 * without this was closed by hand, which is not the same thing.
 */
export function shopCanceledAt(o) {
  if (o?.shopifyOrderData?.cancelled_at) return String(o.shopifyOrderData.cancelled_at)
  return null
}
export function isShopCanceled(o) {
  return Boolean(shopCanceledAt(o)) || /cancel/i.test(String(o?.etsyOrderData?.status || ''))
}
