/**
 * The app's public links, built one way everywhere: the customer approval
 * portal, a partner's bulk intake page, an order in Shopify admin.
 */

/** The app's own origin, with no trailing slash. */
export function appBaseUrl() {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : (process.env.APP_BASE_URL || 'https://fast.trackstar.art')
  return base.replace(/\/$/, '')
}

/** The approval portal for an order's proofs, from its ApprovalToken. */
export function approvalUrl(token) {
  return token ? `${appBaseUrl()}/approve/${token}` : null
}

/** Where a pre-order customer uploads the photo they chose to add after the race. */
export function photoLaterUrl(token) {
  return token ? `${appBaseUrl()}/photo/${token}` : null
}

/** A partner's intake page for a bulk run. */
export function bulkIntakeUrl(token) {
  return token ? `${appBaseUrl()}/intake/${token}` : null
}

/** The order's page in the Etsy shop manager, from its receipt id, or null. */
export function etsyOrderUrl(receiptId) {
  return receiptId ? `https://www.etsy.com/your/orders/sold?order_id=${encodeURIComponent(String(receiptId))}` : null
}

/** The order's page in Shopify admin, or null when it is not a Shopify order. */
export function shopifyAdminUrl(shopifyOrderId) {
  const handle = String(process.env.SHOPIFY_STORE || '').replace(/\.myshopify\.com$/, '').trim()
  if (!shopifyOrderId || !handle) return null
  return `https://admin.shopify.com/store/${handle}/orders/${shopifyOrderId}`
}

/** A draft order's page in Shopify admin, from its id or gid, or null. */
export function shopifyDraftAdminUrl(draftId) {
  const handle = String(process.env.SHOPIFY_STORE || '').replace(/\.myshopify\.com$/, '').trim()
  const id = String(draftId || '').split('/').pop()
  if (!id || !handle) return null
  return `https://admin.shopify.com/store/${handle}/draft_orders/${id}`
}

/** The order's page in Artelo's dashboard, from the Artelo order id (a UUID). */
export function arteloOrderUrl(arteloId) {
  return arteloId && /^[0-9a-f-]{36}$/i.test(String(arteloId)) ? `https://www.artelo.com/app/orders/${arteloId}` : null
}
