/**
 * When a customer can still change their own order from Manage your order
 * (selfServeOrder.js), worked out from the rows alone so the page, the
 * endpoint and the tests agree.
 *
 * The window is CHANGE_WINDOW_HOURS after the order (changeWindow.js, which
 * the production sender also waits out). A pre-order stays open until race
 * day: nothing can print before the results are in anyway, and the runner's
 * name or frame may change in the months between. Whatever the clock says,
 * it closes the moment any print on the order goes to production, ships, or
 * is cancelled.
 */
import { windowEndsAt } from './changeWindow.js'

/**
 * @param {object} first   any row of the order (placedAt reads its Shopify data)
 * @param {Date[]} raceDays the verified race day of each print's race year, where known
 */
export function closesAtFor(first, raceDays = [], now = Date.now()) {
  const base = windowEndsAt(first)
  if (!base) return null
  const ahead = raceDays.filter(d => d && new Date(d).getTime() > now).map(d => new Date(d).getTime())
  return ahead.length ? new Date(Math.max(base.getTime(), ...ahead)) : base
}

/** Why the order can no longer change, or null while it still can. */
export function closedReasonFor(rows, closesAt, now = Date.now()) {
  const first = rows[0]
  if (!first) return 'not_found'
  if (first.shopifyOrderData?.cancelled_at) return 'cancelled'
  if (rows.some(r => r.trackingNumber)) return 'shipped'
  if (rows.some(r => r.renderJobs?.length || r.designStatus === 'sent_to_production' || r.status === 'completed')) return 'in_production'
  if (!closesAt || now >= new Date(closesAt).getTime()) return 'window'
  return null
}

/** Two words at least, the way the wizard asks for it. */
export function isFullName(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).length >= 2
}

/** The storefront wizard's title case, so "MATT HICKMAN" prints as Matt Hickman. */
export function toTitleCase(s) {
  return String(s || '').replace(/[^\s'-]+/g, w => {
    if (w !== w.toLowerCase() && w !== w.toUpperCase()) return w
    if (/^(ii|iii|iv|vi|vii|viii)$/i.test(w)) return w.toUpperCase()
    const t = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    return t.replace(/^Mc(\w)/, (_, c) => 'Mc' + c.toUpperCase())
  })
}
