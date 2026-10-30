/**
 * Money is for admins: prices, totals, costs, discounts, margins and
 * commission never reach another role, in the UI or in an API response.
 * The x-admin-secret system caller (server to server) counts as an admin here.
 */
export function seesMoney(actor) {
  return actor?.role === 'admin' || actor?.isSystem === true
}

/**
 * An order row without the raw Shopify, Etsy and Artelo payloads, which carry
 * line prices, totals, tax, discounts and Artelo's production cost. The app
 * reads none of them from a response.
 */
export function withoutRawOrderData(order) {
  if (!order) return order
  const { shopifyOrderData: _s, etsyOrderData: _e, arteloOrderData: _a, ...rest } = order
  return rest
}

/** A bulk order's discount and invoice: admins only, like every price. */
const BULK_MONEY = ['discountKind', 'discountPercent', 'discountCents', 'discountDollars', 'discountNote', 'currency', 'invoiceUrl', 'stripeInvoiceUrl', 'shopifyDraftId', 'shopifyDraftName', 'adminUrl']
export function withoutBulkMoney(order) {
  if (!order) return order
  const out = { ...order }
  for (const k of BULK_MONEY) delete out[k]
  return out
}
