/**
 * pricing.js - Landed cost, price and margin for every size/frame we sell,
 * across sales channels.
 *
 * Two live sources, no hardcoded money:
 *   - Artelo's pricing API for production + shipping (see arteloCosts.js)
 *   - Shopify for the current retail price of each size/frame
 *
 * Costs reconcile to ARTELO, which is who actually fulfills our orders. If a
 * second print partner is ever adopted, its costs belong behind the same
 * fetchArteloCost seam rather than being pasted in as constants — the point of
 * this file is that no money is typed by hand except a negotiated discount.
 *
 * WHAT SCALES WITH QUANTITY AND WHAT DOES NOT is the whole point of the bulk
 * view, and Artelo does not make it obvious:
 *
 *   production  PER UNIT   — flat, no volume break (36.34 at qty 1 and at 50)
 *   shipping    PER ORDER  — 9.75 for one 12x18, 61.20 for fifty, so per-unit
 *                            shipping falls from $9.75 to $1.22
 *   branding    PER ORDER  — $0.80 once, however many prints are in the box
 *
 * So bulk economics come almost entirely from shipping and branding being
 * amortized, not from a production discount. Quoting a bulk order off the
 * qty-1 numbers overstates cost badly at volume.
 */

import { fetchArteloCost, SIZES, COLUMNS, BRANDING_COST_PER_ORDER } from './arteloCosts.js'
import { fetchVariantCatalog } from './shopifyProducts.js'

export { SIZES, COLUMNS }

/**
 * Payment processing, by channel. Both are card rates and both are a cost WE
 * absorb — on bulk we eat the fee rather than passing it to the partner, so it
 * comes straight out of margin and belongs in this model.
 *
 *   Retail DTC  Shopify Payments, 2.9% + $0.30 — $3.20 on a $100 order.
 *   Bulk        Stripe, same published card rate, one charge per consignment,
 *               so the flat 30c amortizes across the run.
 *
 * The two rates being identical is a fact about card pricing today, not an
 * assumption worth collapsing: they are separate constants so that a move to
 * ACH or Stripe invoicing (materially cheaper on large amounts) is a one-line
 * change here rather than an archaeology exercise.
 */
export const SHOPIFY_FEE_PERCENT = 0.029
export const SHOPIFY_FEE_FIXED = 0.30
export const STRIPE_FEE_PERCENT = 0.029
export const STRIPE_FEE_FIXED = 0.30

/**
 * The photo add-on is sold as a separate $20 line item on DTC orders. It costs
 * us nothing extra at Artelo — the photo is composited into the same print, so
 * there is no additional production or shipping — which makes it effectively
 * pure margin minus the payment fee. `photoCost` is still a parameter rather
 * than a constant so that stops being an assumption the day it changes.
 */
export const PHOTO_ADDON_PRICE = 20
export const PHOTO_ADDON_COST = 0

/**
 * The storefront charges flat shipping on a retail order under the
 * free-shipping line. The shopper pays it, so on those units it is revenue
 * set against the shipping we pay Artelo.
 */
export const RETAIL_SHIPPING_CHARGE = 7
export const FREE_SHIPPING_OVER = 100

/**
 * Published wholesale tiers, by units in the shipment.
 *
 * Below 10 units there is no wholesale price — the sheet starts at 10, so a
 * smaller order pays retail.
 *
 * 24x36 is not sold wholesale at all — confirmed, not merely missing from the
 * sheet. A size listed here renders as "not offered" and is excluded from the
 * order roll-up rather than being extrapolated from its retail price.
 *
 * 24x36 was discontinued at retail on 2026-08-14, so it no longer reaches this
 * rule: buildPricingGrid drops any size with no live Shopify price before the
 * wholesale layer sees it. The entry stays because the statement is still true
 * and would apply again the day the size comes back.
 */
export const WHOLESALE_TIERS = [
  { min: 10, max: 24, discount: 0.15, label: '10-24 units' },
  { min: 25, max: 74, discount: 0.20, label: '25-74 units' },
  { min: 75, max: null, discount: 0.25, label: '75+ units' },
]

/** Sizes absent from the published wholesale sheet. */
export const WHOLESALE_EXCLUDED_SIZES = ['24x36']

export function wholesaleTierFor(quantity) {
  return WHOLESALE_TIERS.find(t => quantity >= t.min && (t.max === null || quantity <= t.max)) || null
}

/**
 * Round wholesale prices to whole dollars, halves UP.
 *
 * Note this diverges from the printed sheet in exactly one cell: 16x24 framed
 * at 25% off is 142.5, which the sheet shows as $142 and this shows as $143.
 * Every other cell agrees. The sheet's $142 looks like a half-to-even artifact
 * rather than an intended price, and rounding halves up is the rule we want
 * going forward, so the tool rounds up and the sheet is the thing to reprint.
 */
export function roundHalfUp(n) {
  return Math.round(n)
}

/** Current retail price per size + frame, straight from Shopify. */
export async function fetchRetailPrices() {
  const rows = await fetchVariantCatalog()
  const groups = {}
  for (const v of rows) {
    if (!v.size || !v.frame || v.isCustom || v.productStatus !== 'ACTIVE') continue
    const key = `${v.size}|${/unframed/i.test(v.frame) ? 'Unframed' : 'Framed'}`
    ;(groups[key] ||= []).push(Number(v.price))
  }

  const out = {}
  for (const [key, prices] of Object.entries(groups)) {
    // The catalog is meant to be uniform per size/frame. Where it is not, the
    // most common price is the real one and the outliers are stragglers from a
    // half-finished repricing. Deliberately the mode and NOT the mean: an
    // average would invent a price nobody actually charges. Outliers are
    // returned alongside so a caller can inspect them; the calculator itself
    // just prices off the common value.
    const counts = {}
    for (const p of prices) counts[p] = (counts[p] || 0) + 1
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    out[key] = {
      price: Number(sorted[0][0]),
      variantCount: prices.length,
      outliers: sorted.slice(1).map(([p, n]) => ({ price: Number(p), count: n })),
    }
  }
  return out
}

/**
 * Per-unit economics for one size/frame at a given order quantity.
 *
 * `price` is the per-unit selling price for whichever channel the caller is
 * modeling; this function does no channel math of its own, it just tells you
 * what a unit costs and what is left over.
 */
export function unitEconomics({ price, productionCost, orderShipping, quantity, includePhoto, photoPrice, photoCost, feePercent, feeFixed }) {
  const qty = Math.max(1, quantity || 1)

  const unitShipping = orderShipping / qty
  const unitBranding = BRANDING_COST_PER_ORDER / qty
  const unitCost = productionCost + unitShipping + unitBranding + (includePhoto ? photoCost : 0)

  const unitPrice = price + (includePhoto ? photoPrice : 0)
  // Percentage is per-unit; the flat 30c is per order, so it amortizes.
  const unitFee = unitPrice * feePercent + feeFixed / qty

  const grossProfit = unitPrice - unitCost - unitFee
  return {
    unitPrice: round(unitPrice),
    productionCost: round(productionCost),
    unitShipping: round(unitShipping),
    unitBranding: round(unitBranding),
    photoCost: includePhoto ? round(photoCost) : 0,
    unitCost: round(unitCost),
    unitFee: round(unitFee),
    grossProfit: round(grossProfit),
    // Margin on revenue. Null rather than Infinity when a channel gives the
    // product away, so the UI can show a dash instead of a nonsense percentage.
    grossMarginPct: unitPrice > 0 ? round((grossProfit / unitPrice) * 100, 1) : null,
    orderShipping: round(orderShipping),
    quantity: qty,
  }
}

function round(n, dp = 2) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * The grid: every size x (unframed, framed) WE ACTUALLY SELL, costed at
 * `quantity` and priced at retail. Channel pricing is applied by the caller on
 * top of the `retailPrice` returned here.
 *
 * A size/frame with no live retail price is skipped rather than rendered.
 * Discontinuing 24x36 took its variants out of Shopify but left it in SIZES,
 * and the grid dutifully showed it at $0.00 with a $27 loss — a number that
 * described nothing, because we no longer sell the thing. Skipping also saves
 * an Artelo call per dead row.
 *
 * SIZES keeps the discontinued entry on purpose: it is the Artelo id and frame
 * mapping, not a statement that we sell it. If 24x36 ever comes back in
 * Shopify the row reappears here on its own, with no code change.
 */
export async function buildPricingGrid({ quantity = 1, shippingDestination = 'US' } = {}) {
  const retail = await fetchRetailPrices()

  // An empty catalog means the Shopify read failed or returned nothing, not
  // that we sell nothing. Rendering an empty grid would look like a real
  // answer, so say what happened instead.
  if (!Object.keys(retail).length) {
    throw new Error('No retail prices came back from Shopify, so the grid would be empty. Check the catalog read.')
  }

  const rows = []

  for (const size of SIZES) {
    for (const column of COLUMNS) {
      if (!retail[`${size.label}|${column.id}`]) continue
      const frameStyle = column.id === 'Framed' ? size.framedStyle : 'Unframed'
      const key = `${size.id}|${column.id}`
      try {
        const cost = await fetchArteloCost({
          size: size.id,
          frameStyle,
          shippingDestination,
          quantity,
        })
        const r = retail[`${size.label}|${column.id}`] || null
        rows.push({
          key,
          sizeId: size.id,
          sizeLabel: size.label,
          frame: column.id,
          frameLabel: column.id === 'Framed' ? size.framedLabel : 'Unframed',
          productionCost: cost.productionCost,
          orderShipping: cost.shippingCost,
          brandingCost: BRANDING_COST_PER_ORDER,
          retailPrice: r?.price ?? null,
          retailVariantCount: r?.variantCount ?? 0,
          retailOutliers: r?.outliers ?? [],
        })
      } catch (error) {
        rows.push({ key, sizeId: size.id, sizeLabel: size.label, frame: column.id, error: error.message })
      }
    }
  }

  return rows
}

/**
 * A channel quote off grid rows, the same arithmetic as the Pricing
 * Calculator (src/components/PricingCalculator.tsx), for callers with no
 * screen (the MCP's pricing_quote). Keep the two in step.
 *
 *   retail     one print per order: the shopper's flat shipping under the
 *              free-shipping line counts as ours, branding is carried, Shopify fee.
 *   wholesale  one consignment of `quantity` (or a parcel to each runner):
 *              retail less the discount, whole dollars, no branding, Stripe fee.
 *
 * `rows` come from buildPricingGrid at `quantity`; `singleRows` (key ->
 * qty-1 order shipping) only for individual shipping. Dollars in, dollars out.
 */
export function quoteRows(rows, { channel = 'retail', quantity = 1, discountPct = 0, includePhoto = false, shipMode = 'consignment', shippingTotal = null, singleRows = null } = {}) {
  const qty = channel === 'retail' ? 1 : Math.max(1, quantity)
  const feePercent = channel === 'retail' ? SHOPIFY_FEE_PERCENT : STRIPE_FEE_PERCENT
  const feeFixed = channel === 'retail' ? SHOPIFY_FEE_FIXED : STRIPE_FEE_FIXED
  return rows.filter(r => !r.error).map(r => {
    const base = r.retailPrice ?? 0
    const offSheet = channel === 'wholesale' && WHOLESALE_EXCLUDED_SIZES.includes(r.sizeLabel)
    const price = channel === 'retail' ? base : roundHalfUp(base * (1 - discountPct / 100))
    const unitShipping = channel === 'retail' ? r.orderShipping / qty
      : shipMode === 'individual' ? (singleRows?.[r.key] ?? r.orderShipping / qty)
      : (shippingTotal != null ? shippingTotal : r.orderShipping) / qty
    const unitBranding = channel === 'retail' ? r.brandingCost / qty : 0
    const unitCost = r.productionCost + unitShipping + unitBranding + (includePhoto ? PHOTO_ADDON_COST : 0)
    const unitPrice = price + (includePhoto ? PHOTO_ADDON_PRICE : 0)
    const shippingCharged = channel === 'retail' && FREE_SHIPPING_OVER > 0 && unitPrice < FREE_SHIPPING_OVER ? RETAIL_SHIPPING_CHARGE : 0
    const revenue = unitPrice + shippingCharged
    const unitFee = revenue * feePercent + feeFixed / qty
    const gp = revenue - unitCost - unitFee
    return {
      key: r.key, sizeLabel: r.sizeLabel, frame: r.frame, frameLabel: r.frameLabel, offSheet,
      listPrice: round(base + (includePhoto ? PHOTO_ADDON_PRICE : 0)), unitPrice: round(unitPrice), shippingCharged, revenue: round(revenue),
      productionCost: round(r.productionCost), unitShipping: round(unitShipping), unitBranding: round(unitBranding), unitCost: round(unitCost), unitFee: round(unitFee),
      grossProfit: round(gp), grossMarginPct: revenue > 0 ? round((gp / revenue) * 100, 1) : null,
    }
  })
}
