/**
 * Shipping helpers — works with raw Shopify order data.
 *
 * Used in:
 *   - server/processOrders.js  (import-time Slack notification)
 *   - api/_routes/orders/index.js      (expose to frontend)
 */

/**
 * Returns the Shopify shipping line title for the order, or null.
 * Picks the highest-priced line if multiple are present.
 */
export function getShippingMethod(shopifyOrderData) {
  if (!shopifyOrderData || typeof shopifyOrderData !== 'object') return null
  const lines = shopifyOrderData.shipping_lines
  if (!Array.isArray(lines) || lines.length === 0) return null

  // If multiple lines, the customer-paid one is the most relevant — pick highest price
  const sorted = [...lines].sort((a, b) =>
    parseFloat(b?.price || '0') - parseFloat(a?.price || '0'))
  return sorted[0]?.title || null
}

/**
 * Returns true if the order has expedited shipping.
 * Detects "Expedited", "Express", "Rush", "Priority", "Overnight", "Next Day", "2-Day".
 */
export function isExpeditedShipping(shopifyOrderData) {
  const method = getShippingMethod(shopifyOrderData)
  if (!method) return false
  const m = method.toLowerCase()
  return /(expedit|express|\brush\b|priority|overnight|next.?day|2.?day)/i.test(m)
}
