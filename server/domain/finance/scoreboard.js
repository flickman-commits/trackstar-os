/**
 * The scoreboard math: the Daily Tracker's derived numbers, computed from a
 * FinanceDay row and the rules in force that day. Nothing here is stored.
 *
 * Money is integer cents; ratios are plain numbers, null when there is no
 * denominator. A tab that has not landed for a day (its key column null)
 * leaves its numbers null, and a day with no tab landed is "not landed" and
 * left out of sums.
 *
 * The rules (rules.js) decide where the designer fee sits:
 *   base 'gp'  (to Oct 2026)   fee = pct x (revenue - fees - production - shipping);
 *                               fee is part of COGS; CM = gross profit - ad spend
 *   base 'cm'  (from Nov 2026) COGS = fees + production + shipping;
 *                               fee = pct x (gross profit - ad spend); CM = that - fee
 * Break-even CPA is gross profit per order in both. Organic orders are the
 * orders Meta and Google do not claim.
 *
 * Ad spend is Meta + Trybe + Google. Trybe is what its creators cost us
 * (commission, platform fee, card processing; see trybeSync.js). Its ads run
 * on our Meta account, so the spend on them is already in Meta and Trybe's
 * attributed sales are already in revenue: only the cost is added.
 */
import { ruleFor } from './rules.js'

const n0 = v => (v == null ? 0 : v)
const ratio = (a, b) => (b ? a / b : null)
const pct = (a, b) => (b ? (a / b) * 100 : null)

/** The row with Matt's overrides applied over the sheet's values. */
export function effective(row) {
  if (!row) return row
  const o = row.overrides && typeof row.overrides === 'object' ? row.overrides : {}
  const out = { ...row }
  for (const [k, v] of Object.entries(o)) if (k in row && typeof v === 'number') out[k] = v
  return out
}

/** Which feeds have landed for this day. */
export function landed(row) {
  return {
    shopify: row.shopifyNetCents != null || row.shopifyGrossCents != null,
    etsy: row.etsyNetCents != null || row.etsyGrossCents != null,
    printShop: row.productionCents != null,
    meta: row.metaSpendCents != null,
    google: row.googleSpendCents != null,
  }
}

/** Everything the scoreboard and the levers show for one day. */
export function computeDay(rawRow, rules) {
  const row = effective(rawRow)
  const has = landed(row)
  const any = Object.values(has).some(Boolean)
  const day = row.day
  const fee = ruleFor(rules, 'designer_fee', day) || { pct: 7.5, base: 'cm' }
  const shopFee = ruleFor(rules, 'shopify_fee', day) || { pct: 2.9, perOrderCents: 30 }

  const shopifyRevenue = n0(row.shopifyNetCents)
  const etsyRevenue = n0(row.etsyNetCents)
  const revenue = shopifyRevenue + etsyRevenue
  const shopifyOrders = n0(row.shopifyOrders)
  const etsyOrders = n0(row.etsyOrders)
  const orders = shopifyOrders + etsyOrders
  const shopifyFees = row.shopifyFeesCents != null ? row.shopifyFeesCents
    : has.shopify ? Math.round(shopifyRevenue * (shopFee.pct / 100) + shopifyOrders * shopFee.perOrderCents) : 0
  const etsyFees = n0(row.etsyFeesCents)
  const production = n0(row.productionCents)
  const shipping = n0(row.shippingCostCents)
  const units = n0(row.unitsProduced)
  const meta = n0(row.metaSpendCents)
  const google = n0(row.googleSpendCents)
  const trybe = n0(row.trybeCostCents)
  const adSpend = meta + trybe + google
  const direct = shopifyFees + etsyFees + production + shipping

  let designerFee, cogs, grossProfit, cm
  if (fee.base === 'gp') {
    designerFee = Math.round((revenue - direct) * (fee.pct / 100))
    cogs = direct + designerFee
    grossProfit = revenue - cogs
    cm = grossProfit - adSpend
  } else {
    cogs = direct
    grossProfit = revenue - cogs
    const before = grossProfit - adSpend
    designerFee = Math.round(before * (fee.pct / 100))
    cm = before - designerFee
  }
  const metaPurchases = n0(row.metaPurchases)
  const googleConversions = n0(row.googleConversions)
  const organicOrders = Math.max(0, orders - metaPurchases - googleConversions)

  return {
    day, landed: any, has,
    // money, cents
    shopifyRevenue, etsyRevenue, revenue, shopifyFees, etsyFees, production, shipping, designerFee, designerFeeBase: fee.base,
    cogs, adSpend, meta, trybe, google, grossProfit, cm, trybeSales: n0(row.trybeSalesCents), trybeEarnings: n0(row.trybeEarningsCents),
    // counts
    orders, shopifyOrders, etsyOrders, units, metaPurchases, googleConversions, organicOrders, trybeConversions: n0(row.trybeConversions),
    sessions: n0(row.shopifySessions), addToCart: n0(row.shopifyAddToCart), reachedCheckout: n0(row.shopifyReachedCheckout), completedCheckout: n0(row.shopifyCompletedCheckout),
    metaImpressions: n0(row.metaImpressions), metaClicks: n0(row.metaClicks), metaPurchaseValue: n0(row.metaPurchaseValueCents),
    googleImpressions: n0(row.googleImpressions), googleClicks: n0(row.googleClicks), googleConversionValue: n0(row.googleConversionValueCents),
    // ratios
    ...ratios({ trybe, trybeSales: n0(row.trybeSalesCents), revenue, grossProfit, cm, adSpend, orders, cogs, production, shipping, units, organicOrders, shopifyRevenue, etsyRevenue, shopifyOrders, etsyOrders,
      meta, metaPurchases, metaPurchaseValue: n0(row.metaPurchaseValueCents), metaClicks: n0(row.metaClicks), metaImpressions: n0(row.metaImpressions),
      google, googleConversions, googleConversionValue: n0(row.googleConversionValueCents), googleClicks: n0(row.googleClicks), googleImpressions: n0(row.googleImpressions),
      sessions: n0(row.shopifySessions), addToCart: n0(row.shopifyAddToCart), reachedCheckout: n0(row.shopifyReachedCheckout), completedCheckout: n0(row.shopifyCompletedCheckout) }),
  }
}

/** The ratios, from sums; shared by a day and a period. */
function ratios(s) {
  return {
    grossMarginPct: pct(s.grossProfit, s.revenue),
    cmPct: pct(s.cm, s.revenue),
    roas: ratio(s.revenue, s.adSpend),
    aov: s.orders ? Math.round(s.revenue / s.orders) : null,          // cents
    cpa: s.orders ? Math.round(s.adSpend / s.orders) : null,          // cents
    breakevenCpa: s.orders ? Math.round(s.grossProfit / s.orders) : null, // cents
    organicPct: pct(s.organicOrders, s.orders),
    costPerUnit: s.units ? Math.round((s.production + s.shipping) / s.units) : null, // cents
    cogsPct: pct(s.cogs, s.revenue),
    adSpendPct: pct(s.adSpend, s.revenue),
    // What Trybe costs us all in (earnings + platform fee + processing) per dollar of the sales it attributes.
    trybeAllInPct: pct(s.trybe, s.trybeSales),
    shopifyPct: pct(s.shopifyRevenue, s.revenue),
    etsyPct: pct(s.etsyRevenue, s.revenue),
    shopifyAov: s.shopifyOrders ? Math.round(s.shopifyRevenue / s.shopifyOrders) : null,
    etsyAov: s.etsyOrders ? Math.round(s.etsyRevenue / s.etsyOrders) : null,
    metaRoas: ratio(s.metaPurchaseValue, s.meta),
    metaCpa: s.metaPurchases ? Math.round(s.meta / s.metaPurchases) : null,
    metaCpc: s.metaClicks ? Math.round(s.meta / s.metaClicks) : null,
    metaCtr: pct(s.metaClicks, s.metaImpressions),
    googleRoas: ratio(s.googleConversionValue, s.google),
    googleCpa: s.googleConversions ? Math.round(s.google / s.googleConversions) : null,
    googleCpc: s.googleClicks ? Math.round(s.google / s.googleClicks) : null,
    googleCtr: pct(s.googleClicks, s.googleImpressions),
    atcPct: pct(s.addToCart, s.sessions),
    atcToCheckoutPct: pct(s.reachedCheckout, s.addToCart),
    checkoutToPurchasePct: pct(s.completedCheckout, s.reachedCheckout),
    cvr: pct(s.completedCheckout, s.sessions),
  }
}

const SUM_KEYS = ['shopifyRevenue', 'etsyRevenue', 'revenue', 'shopifyFees', 'etsyFees', 'production', 'shipping', 'designerFee', 'cogs', 'adSpend', 'meta', 'trybe', 'google', 'grossProfit', 'cm', 'trybeSales', 'trybeEarnings', 'trybeConversions',
  'orders', 'shopifyOrders', 'etsyOrders', 'units', 'metaPurchases', 'googleConversions', 'organicOrders', 'sessions', 'addToCart', 'reachedCheckout', 'completedCheckout',
  'metaImpressions', 'metaClicks', 'metaPurchaseValue', 'googleImpressions', 'googleClicks', 'googleConversionValue']

/**
 * A period: the computed days that landed, summed, with the ratios from the
 * sums. `days` is every computed day in order, landed or not, so a chart can
 * show the gaps.
 */
export function summarize(rows, rules) {
  const days = rows.map(r => computeDay(r, rules))
  const landedDays = days.filter(d => d.landed)
  const sums = Object.fromEntries(SUM_KEYS.map(k => [k, 0]))
  for (const d of landedDays) for (const k of SUM_KEYS) sums[k] += d[k]
  // Which rule the period ended under, for the label on a fee line.
  const designerFeeBase = landedDays.length ? landedDays[landedDays.length - 1].designerFeeBase : null
  return { ...sums, ...ratios(sums), designerFeeBase, dayCount: landedDays.length, days, first: rows[0]?.day || null, last: rows[rows.length - 1]?.day || null, lastLanded: landedDays[landedDays.length - 1]?.day || null }
}
