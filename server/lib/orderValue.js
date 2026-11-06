/**
 * Order value helpers — works across Shopify and Etsy raw order data.
 *
 * Used in:
 *   - api/_routes/orders/index.js      (expose to frontend for the big-spender badge)
 *   - server/processOrders.js  (Slack alert when a big-spender order is imported)
 */

// Customers who spend more than this on a single order get flagged with a
// "big spender" badge in the dashboard so fulfillment knows to prioritize.
export const BIG_SPENDER_THRESHOLD_USD = 300

/**
 * Returns the order's total price in USD, or null if not available.
 * Tries Shopify first, then Etsy. We use the order's "total" (post-discount,
 * pre-refund) rather than the line-item price, since one order may contain
 * multiple line items and shipping.
 */
export function getOrderTotalUsd(order) {
  if (!order || typeof order !== 'object') return null

  // Shopify: total_price is post-discount, includes shipping + tax
  const shopify = order.shopifyOrderData
  if (shopify && typeof shopify === 'object') {
    const total = parseFloat(shopify.total_price || shopify.current_total_price || '0')
    if (total > 0) return total
  }

  // Etsy: grandtotal field on receipt — Etsy uses a divisor (amount + divisor)
  const etsy = order.etsyOrderData
  if (etsy && typeof etsy === 'object') {
    // Etsy returns currency amounts as { amount, divisor, currency_code }
    const gt = etsy.grandtotal || etsy.total
    if (gt && typeof gt === 'object' && gt.amount != null && gt.divisor != null) {
      const total = parseFloat(gt.amount) / parseFloat(gt.divisor)
      if (total > 0) return total
    }
    // Some Etsy payloads have a flat price_sold field
    if (etsy.total_price && typeof etsy.total_price === 'string') {
      const total = parseFloat(etsy.total_price)
      if (total > 0) return total
    }
  }

  return null
}

/**
 * True if the order's total exceeds the big-spender threshold.
 */
export function isBigSpender(order) {
  const total = getOrderTotalUsd(order)
  return total != null && total >= BIG_SPENDER_THRESHOLD_USD
}
