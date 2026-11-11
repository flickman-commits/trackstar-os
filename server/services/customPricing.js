/**
 * customPricing.js - the custom design fee, and the custom prints' prices
 * that follow from it.
 *
 * A custom print costs exactly what the same size and frame costs as a
 * standard race print, plus the design fee. So the fee is the only real
 * input: change it here and every custom variant is repriced to match.
 *
 * The fee itself lives in ONE place, the shop metafield
 * trackstar.custom_design_fee (whole dollars, number_integer). The storefront
 * theme reads that same metafield wherever its copy mentions the fee ("*Price
 * includes the $125 design fee"), so a change made in the tool reaches both
 * the prices and the words.
 *
 * "Standard price" is not a hand-kept table. For each size and frame it is
 * the price most standard race prints in the catalog actually charge, read
 * fresh from Shopify. If the standard prices ever move, the next fee save
 * carries the custom prices along with them.
 */

import { getShopifyToken, SHOPIFY_API_VERSION } from './shopifyAuth.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'

const API_VERSION = SHOPIFY_API_VERSION
const NAMESPACE = 'trackstar'
const KEY = 'custom_design_fee'
// What the storefront has always said, used until the metafield is first set.
export const DEFAULT_FEE = 125

async function shopifyGraphql(query, variables) {
  const store = process.env.SHOPIFY_STORE
  if (!store) throw new Error('Missing SHOPIFY_STORE')
  const token = await getShopifyToken()
  const res = await fetchWithTimeout(
    `https://${store}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    20000
  )
  if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`)
  const json = await res.json()
  if (json.errors?.length) throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`)
  return json.data
}

/** The current design fee in whole dollars. */
export async function getCustomFee() {
  const data = await shopifyGraphql(
    `query { shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`
  )
  const n = Number(data.shop?.metafield?.value)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_FEE
}

/** Store a new design fee (whole dollars). */
export async function setCustomFee(fee) {
  const shop = await shopifyGraphql('query { shop { id } }')
  const data = await shopifyGraphql(
    `mutation Set($m: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $m) { userErrors { field message } }
    }`,
    { m: [{ ownerId: shop.shop.id, namespace: NAMESPACE, key: KEY, type: 'number_integer', value: String(fee) }] }
  )
  const errs = data.metafieldsSet?.userErrors || []
  if (errs.length) throw new Error(`Could not save the design fee: ${errs.map(e => e.message).join('; ')}`)
}

/** "Natural Premium Oak" and "Natural Oak" are the same frame for pricing. */
export function frameMaterial(frame) {
  const f = String(frame || '').toLowerCase()
  if (!f || /unframed|no frame|none/.test(f)) return 'unframed'
  if (f.includes('natural')) return 'natural'
  if (f.includes('black')) return 'black'
  return null
}

const toCents = price => Math.round(Number(price) * 100)
const fromCents = cents => (cents / 100).toFixed(2)

/**
 * Build the repricing plan for a given fee.
 *
 * `catalog` is fetchVariantCatalog() output. Returns:
 *   standard  { "8x10|unframed": { cents, products } ... } the reference prices
 *   rows      one per custom variant: current and planned price
 *   problems  custom variants that could not be priced, and why
 */
export function planCustomPrices(catalog, fee) {
  const feeCents = Math.round(Number(fee) * 100)

  // Tally what standard race prints charge for each size + frame.
  const tallies = new Map()
  const productsByKey = new Map()
  for (const v of catalog) {
    if (v.isCustom || v.productStatus !== 'ACTIVE') continue
    const material = frameMaterial(v.frame)
    if (!v.size || !material) continue
    const key = `${v.size}|${material}`
    const cents = toCents(v.price)
    if (!tallies.has(key)) { tallies.set(key, new Map()); productsByKey.set(key, new Set()) }
    const t = tallies.get(key)
    t.set(cents, (t.get(cents) || 0) + 1)
    productsByKey.get(key).add(v.productId)
  }
  // The most common price wins; a tie goes to the higher price so a one-off
  // sale product can never drag the custom price down.
  const standard = {}
  for (const [key, t] of tallies) {
    const [cents] = [...t.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    standard[key] = { cents, price: fromCents(cents), products: productsByKey.get(key).size }
  }

  const rows = []
  const problems = []
  for (const v of catalog) {
    if (!v.isCustom) continue
    const material = frameMaterial(v.frame)
    const key = `${v.size}|${material}`
    const base = standard[key]
    if (!v.size || !material || !base) {
      problems.push({ variantId: v.variantId, productTitle: v.productTitle, size: v.size, frame: v.frame,
        reason: 'No standard print price for this size and frame' })
      continue
    }
    const nextCents = base.cents + feeCents
    rows.push({
      variantId: v.variantId,
      productId: v.productId,
      productTitle: v.productTitle,
      productStatus: v.productStatus,
      size: v.size,
      frame: v.frame,
      standard: base.price,
      current: fromCents(toCents(v.price)),
      next: fromCents(nextCents),
      changes: toCents(v.price) !== nextCents,
    })
  }
  return { standard, rows, problems }
}
