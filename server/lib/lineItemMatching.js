/**
 * lineItemMatching.js - Pairing Artelo line items with their upstream
 * Shopify / Etsy counterparts, and telling prints apart from add-ons.
 *
 * Two separate problems live here, and they interact:
 *
 * 1. ORDERING. Artelo's `orderItems[]` is NOT guaranteed to be in the same
 *    order as Shopify's `line_items[]`. We saw a real mix-up on order #3348
 *    where Artelo flipped the items — the customer ordered 12x18 (Victor) +
 *    8x10 (Hannah), and positional `[lineItemIndex]` lookup glued Victor's
 *    name onto the 8x10 print and Hannah's onto the 12x18.
 *
 * 2. ADD-ONS. The photo upcharge and the rush ("skip the line") fee are each
 *    their own Shopify product, so such an order arrives as TWO OR MORE line
 *    items: the poster and the add-ons. Only the poster is a print. Leaving the add-on in the candidate pool caused both
 *    of the bugs this module exists to prevent: a print row pairing with the
 *    add-on (so the dashboard showed "Photo Add-On" as the product), and an
 *    extra Artelo item importing as a second, bogus order row.
 *
 * The fix for (2) is to drop add-ons before matching. A print can then never
 * pair with one, and an Artelo item that ends up unmatched (map value -1) is
 * itself the add-on and should not become an order row.
 */

// Matched on product id first (exact, survives renaming), then the `_addon_for`
// cart property the storefront writes, then the title.
const PHOTO_ADDON_PRODUCT_ID = Number(process.env.PHOTO_ADDON_PRODUCT_ID || 10329625723163)
const PHOTO_ADDON_TITLE_RE = /^photo add-?on$/i

// Rush ("skip the line") is the second paid add-on and behaves exactly like
// the photo one: its own product, its own line item, never a print. Same three
// signals, so a renamed product or a missing property still gets caught.
const RUSH_ADDON_PRODUCT_ID = Number(process.env.RUSH_ADDON_PRODUCT_ID || 0)
const RUSH_ADDON_TITLE_RE = /rush\s*order|skip\s*the\s*line/i

export function isPhotoAddonLineItem(lineItem) {
  if (!lineItem) return false
  if (Number(lineItem.product_id) === PHOTO_ADDON_PRODUCT_ID) return true
  if ((lineItem.properties || []).some(p => p?.name === '_addon_for')) return true
  return PHOTO_ADDON_TITLE_RE.test(String(lineItem.title || '').trim())
}

export function isRushAddonLineItem(lineItem) {
  if (!lineItem) return false
  // Guard the id check: RUSH_ADDON_PRODUCT_ID is 0 until the env var is set,
  // and a line item with no product_id would otherwise match it.
  if (RUSH_ADDON_PRODUCT_ID && Number(lineItem.product_id) === RUSH_ADDON_PRODUCT_ID) return true
  if ((lineItem.properties || []).some(p => p?.name === '_rush_for')) return true
  return RUSH_ADDON_TITLE_RE.test(String(lineItem.title || '').trim())
}

/** Any paid add-on: a charge that rides along with a print but is not one. */
export function isAddonLineItem(lineItem) {
  return isPhotoAddonLineItem(lineItem) || isRushAddonLineItem(lineItem)
}

/** The line items that are actual prints, i.e. everything but the add-ons. */
export function printableLineItems(lineItems) {
  return (lineItems || []).filter(li => !isAddonLineItem(li))
}

/**
 * A line taken out by a Shopify order edit. Shopify keeps it in `line_items`
 * (with its properties) at current_quantity 0; it is not a print any more.
 * A line without the field (older payloads, Etsy) counts as live.
 */
export function isRemovedLineItem(lineItem) {
  return lineItem?.current_quantity === 0
}

/** The customer's own answers on a line: any property not starting with "_". */
function hasPersonalization(lineItem) {
  return (lineItem?.properties || []).some(p => p?.name && !String(p.name).startsWith('_') && String(p.value ?? '').trim())
}

/**
 * Order edits: when a customer changes their mind after paying (adds a frame,
 * changes size), the order is edited in Shopify by removing the print and
 * adding the new variant. The added line arrives bare: the personalization
 * (runner, year, bib, the lookup result) stayed on the removed line.
 *
 * This hands each bare live print the properties of a removed print, same
 * product first, each removed line used once, and marks it with
 * `_carried_from` so the hand-over is visible. Returns the same array when
 * there is nothing to carry, and never touches the removed lines themselves.
 */
export function carryEditedProperties(lineItems) {
  if (!Array.isArray(lineItems)) return lineItems
  const donors = lineItems.filter(li => isRemovedLineItem(li) && !isAddonLineItem(li) && hasPersonalization(li))
  if (!donors.length) return lineItems
  const used = new Set()
  return lineItems.map(li => {
    if (isRemovedLineItem(li) || isAddonLineItem(li) || hasPersonalization(li)) return li
    const donor = donors.find(d => !used.has(d) && String(d.product_id) === String(li.product_id))
      || donors.find(d => !used.has(d))
    if (!donor) return li
    used.add(donor)
    return { ...li, properties: [...(donor.properties || []), { name: '_carried_from', value: String(donor.id) }] }
  })
}

function normalizePrintSize(raw) {
  if (!raw) return ''
  // Artelo prefixes with "x" (e.g. "x8x10"); strip it. Lowercase + trim.
  return String(raw).replace(/^x/i, '').toLowerCase().trim()
}

function skuContainsSize(sku, size) {
  if (!sku || !size) return false
  // SKUs look like "eugene-s1p-12x18-bl-pok-am" — size is a hyphen-bounded token
  return new RegExp(`(^|[-_])${size}([-_]|$)`, 'i').test(sku)
}

/**
 * Score-based stable matching. We compute a score for every (artelo[i],
 * upstream[j]) pair, then greedily assign highest-scoring pairs first.
 * Positional alignment is a tiebreaker (small penalty for index distance) —
 * this means when sizes don't disambiguate (e.g. two 8x10s), positional
 * stays put. Swaps only happen when size info clearly points to a different
 * pairing.
 */
function buildMatchMapByScore(arteloItems, upstreamItems, scoreSizeMatchFns) {
  const n = arteloItems?.length || 0
  const result = new Array(n).fill(-1)
  if (!upstreamItems?.length || !n) return result

  const candidates = []
  for (let i = 0; i < n; i++) {
    const aSize = normalizePrintSize(arteloItems[i]?.product?.size)
    for (let j = 0; j < upstreamItems.length; j++) {
      let score = 0
      if (aSize) {
        for (const fn of scoreSizeMatchFns) {
          score += fn(upstreamItems[j], aSize)
        }
      }
      // Positional tiebreaker — small penalty for index distance. Keeps
      // positional matching when no size info disambiguates.
      score -= Math.abs(i - j)
      candidates.push({ i, j, score })
    }
  }
  // Highest score first; deterministic tiebreak by i then j
  candidates.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j)
  const usedI = new Set()
  const usedJ = new Set()
  for (const c of candidates) {
    if (usedI.has(c.i) || usedJ.has(c.j)) continue
    result[c.i] = c.j
    usedI.add(c.i)
    usedJ.add(c.j)
  }
  return result
}

const propOf = (li, name) => (li?.properties || []).find(p => p?.name === name)?.value

/**
 * The photo add-on names its print (`_addon_for`, the print's title) and
 * carries the photo path. Some storefront versions write `_photo_path` on
 * the print as well; others only on the add-on (order 4053), and reading the
 * print alone lost the photo. This copies the add-on's path onto the print
 * it names (or the only print, when it names none) when the print has none.
 * Returns the same array when there is nothing to copy.
 */
export function withAddonPhotos(lineItems) {
  if (!Array.isArray(lineItems)) return lineItems
  const addons = lineItems.filter(li => isPhotoAddonLineItem(li) && !isRemovedLineItem(li) && propOf(li, '_photo_path'))
  if (!addons.length) return lineItems
  const out = lineItems.map(li => li)
  const prints = () => out.map((li, i) => ({ li, i })).filter(({ li }) => !isAddonLineItem(li) && !isRemovedLineItem(li))
  for (const addon of addons) {
    const forTitle = String(propOf(addon, '_addon_for') || '').trim().toLowerCase()
    const open = prints().filter(({ li }) => !propOf(li, '_photo_path'))
    const target = forTitle
      ? open.find(({ li }) => String(li.title || '').trim().toLowerCase() === forTitle)
      : (prints().length === 1 ? open[0] : null)
    if (!target) continue
    out[target.i] = { ...target.li, properties: [...(target.li.properties || []), { name: '_photo_path', value: propOf(addon, '_photo_path') }] }
  }
  return out
}

/**
 * A photo the customer stopped paying for comes off its print. The storefront
 * writes `_photo_path` on the print and adds one Photo Add-On per photo,
 * carrying the same path. A shopper who takes the add-on out of the cart, or
 * an order edit that removes it, leaves the print still naming the photo, and
 * the photo was printed unpaid. A print's photo stays when a live add-on
 * carries its path; add-ons that name no print's photo (an older storefront,
 * a re-upload, or one we added by editing the order) cover the rest one each.
 * Otherwise the path moves to
 * `_photo_removed`, so the order still shows what was dropped.
 */
export function withoutUnpaidPhotos(lineItems) {
  if (!Array.isArray(lineItems)) return lineItems
  const live = lineItems.filter(li => isPhotoAddonLineItem(li) && !isRemovedLineItem(li))
  const paidPaths = new Set(live.map(li => propOf(li, '_photo_path')).filter(Boolean))
  const printPaths = new Set(lineItems.filter(li => !isAddonLineItem(li) && !isRemovedLineItem(li)).map(li => propOf(li, '_photo_path')).filter(Boolean))
  let loose = live.filter(li => !printPaths.has(propOf(li, '_photo_path'))).reduce((n, li) => n + Number(li.current_quantity ?? li.quantity ?? 1), 0)
  let changed = false
  const out = lineItems.map(li => {
    const path = propOf(li, '_photo_path')
    if (!path || isAddonLineItem(li) || isRemovedLineItem(li) || paidPaths.has(path)) return li
    if (loose > 0) { loose--; paidPaths.add(path); return li }
    changed = true
    return { ...li, properties: [...li.properties.filter(p => p?.name !== '_photo_path'), { name: '_photo_removed', value: path }] }
  })
  return changed ? out : lineItems
}

/**
 * Everything the storefront and order edits scatter across lines, put back
 * on the print it belongs to: personalization carried over an edit, then the
 * photo from its add-on, then any photo whose add-on is gone taken off.
 * Use on every Shopify order before reading it.
 */
export function normalizeShopifyLines(lineItems) {
  return withoutUnpaidPhotos(withAddonPhotos(carryEditedProperties(lineItems)))
}

/**
 * Build mapping from Artelo line-item index → Shopify line-item index.
 * Returns an array `map` where `map[arteloIdx] = shopifyIdx | -1`.
 *
 * Photo add-ons are removed from the candidate pool first, then the winning
 * indices are translated back to positions in the original `line_items` array
 * so callers can keep indexing the untouched Shopify payload. A -1 therefore
 * means "this Artelo item has no print to pair with" — which is exactly the
 * add-on's own Artelo row.
 */
export function buildShopifyMatchMap(arteloItems, shopifyLineItems) {
  const prints = []
  ;(shopifyLineItems || []).forEach((li, j) => {
    if (!isAddonLineItem(li) && !isRemovedLineItem(li)) prints.push({ li, originalIndex: j })
  })
  // Artelo's orderItemId is the Shopify line item id, so when both are there
  // the pairing is exact and nothing needs guessing. Only the items left
  // over (older Artelo payloads without the id) go to the score match.
  const n = arteloItems?.length || 0
  const exact = new Array(n).fill(-1)
  const taken = new Set()
  for (let i = 0; i < n; i++) {
    const id = arteloItems[i]?.orderItemId
    if (!id) continue
    const k = prints.findIndex((p, k) => !taken.has(k) && String(p.li?.id) === String(id))
    if (k >= 0) { exact[i] = k; taken.add(k) }
  }
  const restI = [...Array(n).keys()].filter(i => exact[i] < 0 && !(arteloItems[i]?.orderItemId && arteloItems[i]?.product === null))
  const restK = prints.map((_, k) => k).filter(k => !taken.has(k))
  const scored = buildMatchMapByScore(restI.map(i => arteloItems[i]), restK.map(k => prints[k].li), [
    // SKU containing the size token is the strongest signal (SKU encodes
    // the actual variant, while variant_title is display text that can be
    // misleading — e.g. "Black Oak" used as a label for "Black Premium Oak").
    (li, size) => skuContainsSize(li?.sku, size) ? 100 : 0,
    // variant_title is a weaker signal but still useful
    (li, size) => (li?.variant_title || '').toLowerCase().includes(size) ? 50 : 0,
  ])
  restI.forEach((i, r) => { if (scored[r] >= 0) exact[i] = restK[scored[r]] })
  return exact.map(k => (k >= 0 ? prints[k].originalIndex : -1))
}

/**
 * Same idea for Etsy transactions. SKU first, then variations text.
 * Etsy sells the photo upcharge as a listing variation rather than a separate
 * transaction, so there is nothing to filter out here.
 */
export function buildEtsyMatchMap(arteloItems, etsyTransactions) {
  return buildMatchMapByScore(arteloItems, etsyTransactions, [
    (t, size) => skuContainsSize(t?.sku, size) ? 100 : 0,
    (t, size) => {
      const haystacks = [
        t?.title || '',
        ...(t?.variations || []).map(v => `${v?.formatted_name || ''} ${v?.formatted_value || ''}`)
      ].join(' ').toLowerCase()
      return haystacks.includes(size) ? 50 : 0
    },
  ])
}

/**
 * Which Shopify line item does this saved order row describe?
 *
 * `order.lineItemIndex` is an index into ARTELO's items, not Shopify's, so it
 * cannot be used against `line_items` directly. Re-run the same matcher the
 * importer used. Returns -1 when there is no print to point at.
 */
export function resolveShopifyLineIndex(order) {
  const lineItems = order?.shopifyOrderData?.line_items
  if (!lineItems?.length) return -1
  const idx = order?.lineItemIndex || 0

  const arteloItems = order?.arteloOrderData?.orderItems
  if (arteloItems?.length) {
    const resolved = buildShopifyMatchMap(arteloItems, lineItems)[idx]
    if (resolved >= 0) return resolved
  }

  // No Artelo snapshot (or this row lost its match). Fall back to positional
  // over the prints only, so we still never land on an add-on.
  const prints = []
  lineItems.forEach((li, j) => { if (!isAddonLineItem(li)) prints.push(j) })
  if (!prints.length) return -1
  return prints[Math.min(idx, prints.length - 1)]
}

/**
 * Etsy counterpart of resolveShopifyLineIndex.
 */
export function resolveEtsyTxIndex(order) {
  const txs = order?.etsyOrderData?.transactions
  if (!txs?.length) return -1
  const idx = order?.lineItemIndex || 0

  const arteloItems = order?.arteloOrderData?.orderItems
  if (arteloItems?.length) {
    const resolved = buildEtsyMatchMap(arteloItems, txs)[idx]
    if (resolved >= 0) return resolved
  }
  return Math.min(idx, txs.length - 1)
}
