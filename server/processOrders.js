/**
 * processOrders.js - Core order processing logic
 *
 * This is the shared function that handles:
 * 1. Fetching orders from Artelo API
 * 2. Enriching with Shopify personalization data
 * 3. Saving/updating orders in the database
 * 4. Optionally running research for supported races
 *
 * Can be called from:
 * - API endpoint (manual "Import Now" button)
 * - Scheduled cron job (future)
 * - CLI scripts for testing
 */

import sharedPrisma from './db.js'
import { shopifyFetch } from './services/shopifyAuth.js'
import { etsyFetch } from './services/etsyAuth.js'
import { parseEtsyRaceName, parseEtsyPersonalization } from './services/etsyPersonalization.js'
import { researchService } from './services/ResearchService.js'
import { hasScraperForRace } from './scrapers/index.js'
import { parseRaceNameFromTitle } from './scrapers/raceNameNormalization.js'
import { incrementCustomersServed, syncCustomersServedToShopify, getCountedOrderIds, saveCountedOrderIds } from './services/customersServed.js'
import { isExpeditedShipping, getShippingMethod } from './lib/shipping.js'
import { fetchWithTimeout } from './lib/fetchWithTimeout.js'
import { buildShopifyMatchMap, buildEtsyMatchMap, isRushAddonLineItem, isRemovedLineItem, normalizeShopifyLines } from './lib/lineItemMatching.js'
import { isBulkShopifyOrder } from './domain/bulk/shopifyBulk.js'
import { assigneeForNewOrder, isAutoAssignee, endExpiredShifts } from './domain/orders/assignment.js'
import { requireConnection } from './lib/connections.js'
import { listExcluded, isExcludedLine } from './domain/orders/excludedProducts.js'

// Artelo API configuration
// artelo.com, not artelo.io: the old host now redirects across domains and
// the Authorization header is dropped on the hop, so every call came back 401.
const ARTELO_API_URL = 'https://www.artelo.com/api/open/orders/get'
const ARTELO_API_KEY = process.env.ARTELO_API_KEY

// Statuses that need design work
const ACTIONABLE_STATUSES = ['PendingFulfillmentAction', 'AwaitingPayment']

// Product titles that indicate a custom order (customer provides their own
// data and the design goes through the custom flow, not research). Shopify
// checks the product title; Etsy checks the name parseEtsyRaceName produces
// from the listing title, which is normalized to the same strings.
const CUSTOM_ORDER_RACE_NAMES = [
  'Custom Trackstar Print (Any Race)',
  'Custom Triathlon Print',
]

/**
 * Is a cart-property flag actually set? Blank means "not set" — the
 * personalization wizard writes its flag properties unconditionally and leaves
 * the value empty when the answer is no.
 */
function isTruthyFlag(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return false
  return v !== 'false' && v !== 'no' && v !== '0' && v !== 'off'
}


/**
 * Check if a race name indicates a custom order
 */
// Design turnaround promised to a custom-order customer, from the moment the
// order is placed. Rush ("skip the line") is the paid upgrade.
const CUSTOM_DUE_DAYS = 14
const RUSH_DUE_DAYS = 4
const DAY_MS = 24 * 60 * 60 * 1000

/** Due date for a custom order placed at `placedAt`. Calendar days, matching
 *  the 14-day rule this replaces. */
export function customDueDate(placedAt, isRush) {
  // new Date(null) is epoch 0, not Invalid Date, so a missing timestamp would
  // otherwise compute a due date in 1970 and sort to the top of the queue
  // forever. Reject empty input before parsing.
  if (placedAt === null || placedAt === undefined || placedAt === '') return null
  const t = placedAt instanceof Date ? placedAt.getTime() : new Date(placedAt).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t + (isRush ? RUSH_DUE_DAYS : CUSTOM_DUE_DAYS) * DAY_MS)
}

/**
 * Did this Shopify order buy the rush upgrade?
 *
 * Two independent signals, either one is enough:
 *   - the print carries the "Rush Order" property the wizard writes
 *   - a rush add-on line item is present anywhere in the order (this is the
 *     one the customer was actually charged for)
 *
 * Belt and braces on purpose: the property alone would miss an order placed
 * through a path that does not write it, and the line item alone would miss
 * one where the poster landed but the add-on call failed. Either way the
 * customer who paid gets the fast lane.
 */
export function shopifyOrderIsRush(shopifyOrderData, _printLineItemIsRush) {
  // Rush is what the customer PAID for: the rush add-on line item. The
  // "Rush Order: Yes" note on the print only says they ticked the box; the
  // charge can still be missing (they removed it in the cart, or the theme's
  // add to cart failed), and order 4074 got a free 4-day turnaround that way.
  // A ticked box with no charge shows as "Rush not paid" instead.
  // Paid, not just present: an order edited to add the rush product sits at
  // "partially_paid" until the customer settles the difference.
  if (!PAID_STATUSES.includes(shopifyOrderData?.financial_status)) return false
  const items = shopifyOrderData?.line_items
  return Array.isArray(items) && items.some(li => isRushAddonLineItem(li) && !isRemovedLineItem(li))
}

const PAID_STATUSES = ['paid', 'partially_refunded']

function isCustomOrder(raceName) {
  if (!raceName) return false
  return CUSTOM_ORDER_RACE_NAMES.some(keyword =>
    raceName.toLowerCase().trim() === keyword.toLowerCase()
  )
}

/**
 * Determine if an order is from Shopify or Etsy
 * Logic:
 * - channelName = "Online Store" → Shopify
 * - channelName contains "etsy" → Etsy
 * - channelName missing + order ID 13+ digits → Shopify
 * - channelName missing + order ID shorter → Etsy
 */
function determineOrderSource(order) {
  const channelName = order.channelName?.toLowerCase() || ''
  const orderId = order.orderId || ''

  // Explicit channel indicators
  if (channelName === 'online store') {
    return 'shopify'
  }
  if (channelName.includes('etsy')) {
    return 'etsy'
  }

  // Fallback to order ID length
  // Shopify order IDs are 13+ digits, Etsy are typically 10 digits
  if (orderId.length >= 13 && /^\d+$/.test(orderId)) {
    return 'shopify'
  }

  // Default to Etsy for shorter/different format IDs
  return 'etsy'
}

/**
 * Clean runner name by removing invalid entries like "no time" and customer-provided times
 * Returns { cleaned, hadNoTime, customerTime }
 * e.g., "Jennifer Samp no time" → { cleaned: "Jennifer Samp", hadNoTime: true, customerTime: null }
 * e.g., "no time" → { cleaned: null, hadNoTime: true, customerTime: null }
 * e.g., "Jennifer Samp 4:32:15" → { cleaned: "Jennifer Samp", hadNoTime: false, customerTime: "4:32:15" }
 * e.g., "Jennifer Samp" → { cleaned: "Jennifer Samp", hadNoTime: false, customerTime: null }
 */
function cleanRunnerName(runnerName) {
  if (!runnerName) return { cleaned: null, hadNoTime: false, customerTime: null }

  let cleaned = runnerName.trim()

  // Check if "no time" is present (case-insensitive)
  const hadNoTime = /\bno\s+time\b/i.test(cleaned)

  // Remove "no time" (case-insensitive)
  cleaned = cleaned.replace(/\bno\s+time\b/gi, '')

  // Detect customer-provided time patterns (e.g., "4:32:15", "04:32:15", "3:45", "12:34")
  // Match H:MM:SS, HH:MM:SS, M:MM, MM:SS patterns — but not years like "2024"
  let customerTime = null
  const timeMatch = cleaned.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)
  if (timeMatch) {
    customerTime = timeMatch[1]
    cleaned = cleaned.replace(timeMatch[0], '')
  }

  // Clean up multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  // If nothing left after cleaning, return null
  if (!cleaned || cleaned.length === 0) {
    return { cleaned: null, hadNoTime, customerTime }
  }

  return { cleaned, hadNoTime, customerTime }
}

/**
 * Extract personalization data from a single Shopify line item
 * NEW FORMAT (as of 2025): Separate properties for each field
 * Also extracts custom order fields (bib, time, creative direction, gift)
 */
function extractShopifyPersonalization(lineItem) {
  const result = {
    productTitle: null,  // Raw product title (used for custom order detection)
    raceName: null,
    runnerName: null,
    raceYear: null,
    hadNoTime: false,  // Flag to indicate "no time" was present
    customerTime: null, // Time extracted from runner name field (customer-provided)
    needsAttention: false,
    // Custom order fields
    bibNumberCustomer: null,
    timeCustomer: null,
    creativeDirection: null,
    isGift: false,
    // Instant Lookup widget result (standard orders). lookupVerified: null =
    // no widget data, true = confirmed official match, false = typed manually.
    lookupVerified: null,
    customerPace: null,
    customerEventType: null,
    lookupOutcome: null,
    lookupMatchedName: null,
    photoPath: null,
    isRush: false
  }

  if (!lineItem) {
    result.needsAttention = true
    return result
  }

  // Store the raw product title for custom order detection
  result.productTitle = lineItem.title || null

  // Parse race name from product title (default, may be overridden by Race Name property)
  result.raceName = parseRaceNameFromTitle(lineItem.title)

  // Extract from properties
  if (lineItem.properties && Array.isArray(lineItem.properties)) {
    for (const prop of lineItem.properties) {
      const name = (prop.name || '').trim()
      const value = (prop.value || '').trim()

      // "No time" checkbox.
      //
      // Presence is NOT the signal. The personalization wizard writes this
      // property on every order and leaves the VALUE blank when the shopper
      // did not tick the box, so treating presence as true flagged every
      // wizard order as "no time" even when a real finish time was captured
      // right alongside it. Only a meaningful value counts.
      if (name === 'No time' || name === 'no time' || name === 'no_time') {
        if (isTruthyFlag(value)) result.hadNoTime = true
      }
      // Standardized property name: "Runner Name" (works for both normal and custom orders)
      // Matches: "Runner Name (First & Last)", "Runner Name", "runner name", "runner_name"
      else if (name === 'Runner Name (First & Last)' ||
          name === 'Runner Name' ||
          name === 'runner name' ||
          name === 'runner_name') {
        // Clean the runner name (detect customer-provided times, legacy "no time" in name)
        const cleaned = cleanRunnerName(value)
        result.runnerName = cleaned.cleaned
        // Set hadNoTime from name parsing too (legacy orders that typed "no time" in the name)
        if (cleaned.hadNoTime) result.hadNoTime = true
        result.customerTime = cleaned.customerTime
      }
      // Race year
      else if (name === 'Race Year' || name === 'race year' || name === 'race_year') {
        const yearInt = parseInt(value, 10)
        result.raceYear = isNaN(yearInt) ? null : yearInt
      }
      // Race name (override product title if provided — e.g. custom orders provide the actual race)
      else if (name === 'Race Name' || name === 'race name' || name === 'race_name') {
        if (value) {
          // Run it through the same parser as the product title. The wizard
          // sometimes writes the full product title into this property
          // ("San Francisco Marathon Personalized Race Print"), and taking it
          // raw put the print suffix into the race name, which then failed to
          // match any scraper config. Parsing here strips the suffix either way
          // and leaves genuine custom race names untouched.
          result.raceName = parseRaceNameFromTitle(value) || value
        }
      }
      // Custom order fields
      else if (name === 'Bib #' || name === 'Bib #:' || name === 'bib_number') {
        result.bibNumberCustomer = value || null
      }
      else if (name === 'Time' || name === 'Time:' || name === 'time') {
        result.timeCustomer = value || null
      }
      else if (name === 'Creative Direction' || name === 'Creative Direction:' || name === 'creative_direction') {
        result.creativeDirection = value || null
      }
      // Rush upgrade. The wizard writes a readable "Rush Order" so it shows in
      // the Shopify admin and on the packing slip; the underscore form is
      // accepted too in case a future path writes a hidden property.
      else if (name === 'Rush Order' || name === 'Rush Order:' || name === 'rush_order' || name === '_rush') {
        result.isRush = isTruthyFlag(value) || value.toLowerCase() === 'yes'
      }
      else if (name === 'Gift' || name === 'Gift:' || name === 'gift') {
        // Easify (and the Instant Lookup widget mirroring it) sends the literal
        // value "This is a gift" when the box is checked; older paths used yes/true.
        const v = value.toLowerCase()
        result.isGift = v === 'this is a gift' || v === 'yes' || v === 'true'
      }
      // Instant Lookup widget: pace + event/distance (only present on a verified match)
      else if (name === 'Pace' || name === 'Pace:' || name === 'pace') {
        result.customerPace = value || null
      }
      else if (name === 'Event' || name === 'Event Type' || name === 'event' || name === 'event_type' || name === 'Distance' || name === 'distance') {
        result.customerEventType = value || null
      }
      // Instant Lookup widget: verified flag. Hidden property (leading underscore).
      // "true" = customer confirmed an official-results match; "false" = typed manually.
      else if (name === '_lookup_verified' || name === 'lookup_verified') {
        result.lookupVerified = value ? value.toLowerCase() === 'true' : false
      }
      // Instant Lookup widget: outcome — HOW the customer arrived here. See
      // Order.lookupOutcome in the schema for the enum values.
      else if (name === '_lookup_outcome' || name === 'lookup_outcome') {
        result.lookupOutcome = value || null
      }
      // Personalization wizard: the name official results matched, present
      // only when the customer printed a different name on a verified match.
      else if (name === '_matched_name') {
        result.lookupMatchedName = value || null
      }
      // Personalization wizard: storage path of the customer's uploaded photo.
      // Blank string means the wizard ran but they declined a photo, which is
      // not the same as the property being absent — both land as null here.
      else if (name === '_photo_path' || name === 'photo_path') {
        result.photoPath = value || null
      }
    }
  }

  // Flag if missing critical data
  if (!result.runnerName || !result.raceYear) {
    result.needsAttention = true
  }

  return result
}

/** Runs per hour at the 10-minute cron; each order is fully re-read once in that many. */
const FULL_REFRESH_EVERY = 6

function refreshSlot(orderId) {
  let h = 0
  for (const c of String(orderId)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % FULL_REFRESH_EVERY
}

/**
 * The stored Shopify data for orders that have not changed since we stored
 * it, keyed by Shopify order id: { shopifyOrderData, notes }. Anything not in
 * the map (new, changed, due its hourly re-read, or unknown) is fetched as before.
 * Never throws: on any failure it returns an empty map and the run fetches all.
 */
async function unchangedShopifyOrders(prisma, ids) {
  const out = new Map()
  if (!ids.length) return out
  try {
    const slot = Math.floor(Date.now() / (10 * 60_000)) % FULL_REFRESH_EVERY
    const candidates = ids.filter(id => refreshSlot(id) !== slot)
    if (!candidates.length) return out
    const live = new Map()
    for (let i = 0; i < candidates.length; i += 250) {
      const chunk = candidates.slice(i, i + 250)
      const data = await shopifyFetch(`/orders.json?ids=${chunk.join(',')}&status=any&limit=250&fields=id,updated_at`)
      for (const o of data.orders || []) live.set(String(o.id), o.updated_at)
    }
    const stored = await prisma.order.findMany({
      where: { parentOrderNumber: { in: candidates }, source: 'shopify' },
      select: { parentOrderNumber: true, shopifyOrderData: true, notes: true },
      distinct: ['parentOrderNumber'],
    })
    for (const row of stored) {
      const was = row.shopifyOrderData?.updated_at
      if (was && live.get(row.parentOrderNumber) === was && row.shopifyOrderData?.line_items?.length) {
        out.set(row.parentOrderNumber, { shopifyOrderData: row.shopifyOrderData, notes: row.notes || null })
      }
    }
  } catch (err) {
    console.warn(`[processOrders] could not check which Shopify orders changed, fetching all: ${err.message}`)
    return new Map()
  }
  return out
}

/**
 * Fetch Shopify order data including personalization
 * Returns the full order object with line_items array
 */
async function fetchShopifyOrderData(shopifyOrderId) {
  try {
    const data = await shopifyFetch(`/orders/${shopifyOrderId}.json`)
    if (!data.order?.line_items?.length) {
      return null
    }
    // Put scattered details back on their print: personalization left on a
    // line removed by an order edit, and a photo that is only on its add-on.
    // See normalizeShopifyLines.
    const order = { ...data.order, line_items: normalizeShopifyLines(data.order.line_items) }

    // Fetch timeline comments (internal notes) - shared across all line items
    const comments = await fetchShopifyComments(shopifyOrderId)

    return {
      shopifyOrderData: order,
      notes: comments
    }
  } catch (error) {
    console.error(`[processOrders] Failed to fetch Shopify data for order ${shopifyOrderId}:`, error.message)
    return null
  }
}

/**
 * An order edited in Shopify after it was imported.
 *
 * A customer who adds a frame or changes size after paying gets an order
 * edit: the print's line is removed and the new variant added. Artelo drops
 * the old item and lists the new one, often at a different position, while
 * our rows are keyed by position. Left alone, the old row keeps the runner
 * and the research for a print nobody will make, and the new item imports
 * as "Unknown Runner".
 *
 * Artelo's orderItemId is the Shopify line id, so a row whose item is no
 * longer in the order is known exactly. Such a row is moved onto the new
 * item (same product first): its position, size, frame and order data
 * change, and everything people did on it (research, design, assignee,
 * comments) stays. A row whose print was removed with nothing in its place
 * is flagged with a comment instead, never deleted. When the replacement
 * already has a row of its own, both are left as they are. Runs before the import
 * loop, so the loop then finds each row where it belongs.
 */
export async function reconcileEditedOrder(prisma, order, shopifyData, log = () => {}) {
  const out = { moved: 0, flagged: 0 }
  const items = order.orderItems || []
  const currentIds = new Set(items.map(i => i?.orderItemId).filter(Boolean).map(String))
  if (!currentIds.size) return out

  const rows = await prisma.order.findMany({ where: { parentOrderNumber: String(order.orderId) } })
  const itemIdOf = row => {
    const id = row.arteloOrderData?.orderItems?.[row.lineItemIndex]?.orderItemId
    return id ? String(id) : null
  }
  const orphans = rows.filter(r => r.status !== 'completed' && itemIdOf(r) && !currentIds.has(itemIdOf(r)))
  if (!orphans.length) return out

  const claimed = new Set(rows.filter(r => !orphans.includes(r)).map(itemIdOf).filter(Boolean))
  const lines = shopifyData?.shopifyOrderData?.line_items || []
  const lineOf = id => lines.find(l => String(l.id) === String(id))
  // The same product is still on the order as a live line: a swap (a frame
  // added), not a print taken away.
  const swappedIn = old => Boolean(old) && lines.some(l => l.id !== old.id && l.current_quantity !== 0
    && String(l.product_id) === String(old.product_id))

  for (const row of orphans) {
    const oldLine = lineOf(itemIdOf(row))
    const open = items
      .map((it, t) => ({ it, t }))
      .filter(({ it, t }) => it?.product && it.orderItemId && !claimed.has(String(it.orderItemId))
        && !rows.some(r => r.lineItemIndex === t && r.id !== row.id))
    const target = open.find(({ it }) => oldLine && String(lineOf(it.orderItemId)?.product_id) === String(oldLine.product_id))
      || open[0]

    if (target) {
      const rawSize = target.it.product.size || 'Unknown'
      const newLine = lineOf(target.it.orderItemId)
      await prisma.order.update({
        where: { id: row.id },
        data: {
          lineItemIndex: target.t,
          orderNumber: `${order.orderId}-${target.t}`,
          arteloOrderData: order,
          productSize: rawSize.startsWith('x') ? rawSize.slice(1) : rawSize,
          frameType: target.it.product.frameColor || 'Unknown',
          ...(shopifyData ? { shopifyOrderData: shopifyData.shopifyOrderData } : {}),
        },
      })
      const from = oldLine?.variant_title || `${row.productSize} / ${row.frameType}`
      const to = newLine?.variant_title || `${target.it.product.size} / ${target.it.product.frameColor}`
      await prisma.orderComment.create({
        data: { orderId: row.id, authorName: 'Trackstar', text: `Order edited in Shopify: ${from} became ${to}. This print's details moved to the new item.` },
      })
      claimed.add(String(target.it.orderItemId))
      row.lineItemIndex = target.t
      out.moved++
      log(`[processOrders] Order ${order.orderId} was edited: row ${row.id} moved to item ${target.t} (${from} -> ${to})`)
    } else if (row.status !== 'flagged' && !swappedIn(oldLine)) {
      // Flag only when nothing replaced it. A replacement that already has
      // its own row (imported before this ran) is left for a person: two
      // rows for one print is visible; a wrong "will not print" is not.
      await prisma.order.update({ where: { id: row.id }, data: { status: 'flagged' } })
      await prisma.orderComment.create({
        data: { orderId: row.id, authorName: 'Trackstar', text: `This print${oldLine?.variant_title ? ` (${oldLine.variant_title})` : ''} was removed from the order in Shopify and nothing replaced it. Artelo will not print it.` },
      })
      out.flagged++
      log(`[processOrders] Order ${order.orderId} was edited: row ${row.id} was removed, flagged`)
    }
  }
  return out
}

/**
 * Fetch Shopify order comments/notes
 */
async function fetchShopifyComments(shopifyOrderId) {
  try {
    const data = await shopifyFetch(`/orders/${shopifyOrderId}/events.json`)
    const events = data.events || []

    const comments = events
      .filter(e => e.verb === 'comment' && e.body)
      .map(e => ({
        body: e.body,
        author: e.author,
        createdAt: e.created_at
      }))

    if (comments.length === 0) return null

    return comments.map(c => c.body).join(' | ')
  } catch (error) {
    console.error(`[processOrders] Failed to fetch comments for order ${shopifyOrderId}:`, error.message)
    return null
  }
}

/**
 * Fetch Etsy receipt data for an order
 * The Artelo orderId for Etsy orders is the Etsy receipt_id
 * @param {string} receiptId - Etsy receipt ID
 * @returns {Object|null} - Receipt data with transactions
 */
async function fetchEtsyReceiptData(receiptId) {
  try {
    const shopId = process.env.ETSY_SHOP_ID
    if (!shopId) {
      console.error('[processOrders] ETSY_SHOP_ID not configured')
      return null
    }

    const receipt = await etsyFetch(`/shops/${shopId}/receipts/${receiptId}`)
    return receipt
  } catch (error) {
    console.error(`[processOrders] Failed to fetch Etsy receipt ${receiptId}:`, error.message)
    return null
  }
}

/**
 * Extract personalization from an Etsy transaction (line item)
 * @param {Object} transaction - Etsy transaction object
 * @returns {Object} - Extracted personalization data
 */
export function extractEtsyPersonalization(transaction) {
  const result = {
    raceName: null,
    runnerName: null,
    raceYear: null,
    hadNoTime: false,
    customerTime: null,
    needsAttention: false,
    rawPersonalization: null,
    productTitle: null,
    bibNumberCustomer: null,
    timeCustomer: null,
    creativeDirection: null
  }

  if (!transaction) {
    result.needsAttention = true
    return result
  }

  // Parse race name from listing title. productTitle keeps the normalized
  // listing name so custom detection works even when the customer's own
  // race name replaces raceName below (mirrors the Shopify path).
  result.raceName = parseEtsyRaceName(transaction.title) || parseRaceNameFromTitle(transaction.title)
  result.productTitle = result.raceName

  // Find personalization in variations
  const variations = transaction.variations || []
  const personalization = variations.find(
    v => v.formatted_name === 'Personalization' ||
         v.formatted_name?.toLowerCase() === 'personalization'
  )

  // Question-style listings (the custom triathlon print) ask for each field
  // separately instead of one Personalization box. Read those first; when
  // present they are the whole answer and the freeform parse never runs.
  const q = (label) => {
    const v = variations.find(x => String(x.formatted_name || '').trim().toLowerCase() === label)
    const val = String(v?.formatted_value || '').trim()
    return val || null
  }
  const qRunner = q('runner name')
  const qRace = q('race name')
  const qTotalTime = q('total time')
  const qSplits = q('run, swim, bike time') || q('swim, bike, run time') || q('splits')

  if (qRunner || qRace) {
    if (qRunner) {
      const cleaned = cleanRunnerName(qRunner)
      result.runnerName = cleaned.cleaned
      result.hadNoTime = cleaned.hadNoTime
      result.customerTime = cleaned.customerTime
    }
    if (qRace) {
      // Customers often add the date on a second line. Keep the first line as
      // the race and pull a 4-digit year from anywhere in the answer.
      const lines = qRace.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      result.raceName = lines[0] || result.raceName
      const yearMatch = qRace.match(/\b(20\d{2}|19\d{2})\b/)
      if (yearMatch) result.raceYear = parseInt(yearMatch[1], 10)
    }
    if (qTotalTime && /\d/.test(qTotalTime)) {
      result.timeCustomer = qTotalTime
      result.customerTime = result.customerTime || qTotalTime
    }
    const direction = []
    if (qTotalTime) direction.push(`Total time: ${qTotalTime}`)
    if (qSplits) direction.push(`Swim / bike / run: ${qSplits}`)
    result.creativeDirection = direction.join('\n') || null
    result.rawPersonalization = variations
      .filter(x => x.question_id)
      .map(x => `${x.formatted_name}: ${x.formatted_value}`)
      .join('\n') || null
    result.needsAttention = !result.raceYear
  } else if (personalization?.formatted_value) {
    result.rawPersonalization = personalization.formatted_value
    const parsed = parseEtsyPersonalization(personalization.formatted_value)
    result.raceYear = parsed.raceYear
    result.needsAttention = parsed.needsAttention
    // A bib the buyer typed ("Bib: 54772"), kept so a person can see it
    result.bibNumberCustomer = parsed.bib
    // "leave off the time" anywhere in the box, not only next to the name
    result.hadNoTime = parsed.hadNoTime
    // Clean the runner name (detect "no time" and customer-provided times)
    if (parsed.runnerName) {
      const cleaned = cleanRunnerName(parsed.runnerName)
      result.runnerName = cleaned.cleaned
      result.hadNoTime = parsed.hadNoTime || cleaned.hadNoTime
      result.customerTime = cleaned.customerTime
    }
  } else {
    result.needsAttention = true
  }

  return result
}

/**
 * Main order processing function
 *
 * @param {Object} options - Processing options
 * @param {boolean} options.runResearch - Whether to run research for supported races (default: false)
 * @param {boolean} options.verbose - Whether to log detailed output (default: true)
 * @param {import('@prisma/client').PrismaClient} options.prisma - Optional existing Prisma client
 * @returns {Promise<Object>} Processing results
 */
export async function processOrders(options = {}) {
  const {
    runResearch = false,
    verbose = true,
    prisma: externalPrisma = null
  } = options

  // Always the shared client: a fresh PrismaClient per run opened a whole
  // extra pool, and enough of them exhausted the database's connections.
  const prisma = externalPrisma || sharedPrisma

  const log = verbose ? console.log.bind(console) : () => {}
  // Products that never enter the tool (Settings > Skipped Products).
  const excludedProducts = await listExcluded().catch(() => [])

  const results = {
    success: true,
    imported: 0,
    updated: 0,
    skipped: 0,
    enriched: 0,
    needsAttention: 0,
    researched: 0,
    researchFailed: 0,
    total: 0,
    errors: [],
    orders: []  // Details of processed orders
  }

  // Help shifts that ended: their unfinished orders go back to the regular
  // before anything new is assigned. See endExpiredShifts.
  try {
    const ended = await endExpiredShifts()
    if (ended.handedBack) log(`[processOrders] Shift ended: ${ended.handedBack} order(s) back to the regular`)
  } catch (err) {
    console.error(`[processOrders] Could not end shifts: ${err.message}`)
  }

  // Load the user-defined race-name alias map once per import run. Maps
  // variant -> canonical, e.g. "Eugene Marathon (+ Half Marathon)" -> "Eugene
  // Marathon". Edited via the Race Database "Merge into…" action.
  let raceNameAliases = {}
  try {
    const aliasRow = await prisma.systemConfig.findUnique({
      where: { key: 'race_name_aliases' }
    })
    if (aliasRow?.value) raceNameAliases = JSON.parse(aliasRow.value)
  } catch {
    raceNameAliases = {}
  }
  const canonicalizeRaceName = (name) => {
    if (!name) return name
    return raceNameAliases[name] || name
  }

  try {
    // 1. Fetch orders from Artelo
    log('\n[processOrders] Fetching orders from Artelo...')

    if (!ARTELO_API_KEY) {
      throw new Error('ARTELO_API_KEY not configured')
    }

    await requireConnection('artelo')
    const params = new URLSearchParams({ limit: '100', allOrders: 'true' })
    const response = await fetchWithTimeout(`${ARTELO_API_URL}?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ARTELO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Artelo API error: ${response.status}`)
    }

    const data = await response.json()
    const allOrders = Array.isArray(data) ? data : (data.orders || [])

    // Count ALL new Artelo orders (regardless of status) for the "customers served" counter.
    // This catches manual orders that go straight to "received"/"in production" and never
    // enter the actionable import path.
    //
    // We check two sources to determine if an order is "new":
    //  1. The DB (orders table) — catches actionable orders we've imported
    //  2. A separate "counted IDs" set in SystemConfig — catches non-actionable orders
    //     that were counted but never imported to the DB
    let allNewOrderCount = 0
    let countedOrderIds = new Set()
    const allArteloIds = new Set(allOrders.map(o => o.orderId))

    if (allOrders.length > 0) {
      const uniqueParentOrderIds = [...new Set(allOrders.map(o => o.orderId))]

      // Check 1: Which orders already exist in the DB?
      const existingOrders = await prisma.order.findMany({
        where: { parentOrderNumber: { in: uniqueParentOrderIds } },
        select: { parentOrderNumber: true },
        distinct: ['parentOrderNumber']
      })
      const existingParentIds = new Set(existingOrders.map(o => o.parentOrderNumber))

      // Check 2: Which orders have we already counted (but may not be in DB)?
      countedOrderIds = await getCountedOrderIds(prisma)

      // An order is new only if it's NOT in the DB AND NOT already counted
      for (const order of allOrders) {
        if (!existingParentIds.has(order.orderId) && !countedOrderIds.has(order.orderId)) {
          const numItems = order.orderItems?.length || 1
          allNewOrderCount += numItems
          // Mark as counted so we don't recount on next import
          countedOrderIds.add(order.orderId)
        }
      }

      if (allNewOrderCount > 0) {
        log(`[processOrders] 📊 Found ${allNewOrderCount} total new order line items across all statuses (for customers served counter)`)
      }
    }

    // Separate actionable orders from completed ones
    const actionableOrders = allOrders.filter(order =>
      ACTIONABLE_STATUSES.includes(order.status)
    )
    const completedOrders = allOrders.filter(order =>
      !ACTIONABLE_STATUSES.includes(order.status)
    )

    results.total = actionableOrders.length
    log(`[processOrders] Found ${actionableOrders.length} actionable orders, ${completedOrders.length} completed/fulfilled`)

    // 2a. Orders Artelo shows as fulfilled: mark their rows completed. One
    // query for the lot rather than one per order (that was 50 to 90 queries
    // a run, nearly all finding nothing to do).
    try {
      const fulfilledIds = completedOrders.map(o => String(o.orderId))
      const stillOpen = fulfilledIds.length ? await prisma.order.findMany({
        where: { parentOrderNumber: { in: fulfilledIds }, status: { not: 'completed' } },
        select: { id: true, orderNumber: true },
      }) : []
      if (stillOpen.length) {
        for (const o of stillOpen) log(`[processOrders] Marking order ${o.orderNumber} as completed (fulfilled in Artelo)`)
        const { count } = await prisma.order.updateMany({
          where: { id: { in: stillOpen.map(o => o.id) } },
          data: { status: 'completed', researchedAt: new Date() },
        })
        results.updated += count
      }
    } catch (error) {
      log(`[processOrders] Error marking fulfilled orders completed: ${error.message}`)
    }

    // 2b. Mark any DB orders as completed if they no longer appear in Artelo at all
    // (Artelo stops returning orders once they're fully fulfilled and aged out of the 100-order window)
    // Only safe to run when we got back fewer than the 100-order limit — otherwise pending orders
    // past position 100 would be wrongly marked completed just because they fell out of the window.
    //
    // Fenced, because a short page is also what an Artelo outage looks like.
    // Only standard Shopify/Etsy orders are ever in Artelo, so custom, partner,
    // bulk and creator rows are never candidates. At most AGE_OUT_CAP orders
    // age out per run; more than that means the response is wrong, not that
    // a dozen orders shipped at once, so nothing is touched and we alert.
    const AGE_OUT_CAP = 10
    if (allOrders.length > 0 && allOrders.length < 100) {
      const allArteloOrderIds = new Set(allOrders.map(o => o.orderId))
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const pendingDbOrders = await prisma.order.findMany({
        where: {
          status: { notIn: ['completed'] },
          createdAt: { lt: threeDaysAgo },
          trackstarOrderType: 'standard',
          source: { in: ['shopify', 'etsy'] },
          bulkOrderId: null,
        },
        select: { id: true, orderNumber: true, parentOrderNumber: true }
      })
      const agedOut = pendingDbOrders.filter(o => !allArteloOrderIds.has(o.parentOrderNumber))
      if (agedOut.length > AGE_OUT_CAP) {
        log(`[processOrders] ${agedOut.length} open orders missing from a ${allOrders.length}-order Artelo page; over the cap of ${AGE_OUT_CAP}, so none were completed`)
        import('../api/_lib/alerts.js')
          .then(m => m.alertError('auto-import age-out', new Error(`${agedOut.length} open orders are missing from Artelo's response (${allOrders.length} orders returned). Nothing was marked completed. Check Artelo.`)))
          .catch(() => {})
      } else {
        for (const dbOrder of agedOut) {
          log(`[processOrders] Order ${dbOrder.orderNumber} not in Artelo and >3 days old - marking completed`)
          await prisma.order.update({
            where: { id: dbOrder.id },
            data: { status: 'completed', researchedAt: new Date() }
          })
          results.updated++
        }
      }
    }

    // 2c'. Which Shopify orders actually changed. Re-reading every open order
    // from Shopify every 10 minutes (two REST calls each) was most of this
    // job's cost, almost always to learn nothing. One call lists updated_at for
    // up to 250 orders; an order whose updated_at matches what we stored reuses
    // that copy. Each order still gets a full re-read about once an hour
    // (timeline notes do not always move updated_at).
    const shopifyFresh = await unchangedShopifyOrders(
      prisma,
      actionableOrders.filter(o => determineOrderSource(o) === 'shopify').map(o => String(o.orderId))
    )

    // 2c. Process actionable orders (new or needing updates)
    for (const order of actionableOrders) {
      try {
        const orderSource = determineOrderSource(order)
        const isShopify = orderSource === 'shopify'

        // Determine number of line items
        const numItems = order.orderItems?.length || 1

        const isEtsy = orderSource === 'etsy'

        // Fetch Shopify data once for the entire order (if Shopify)
        let shopifyData = null
        if (isShopify) {
          shopifyData = shopifyFresh.get(String(order.orderId)) || await fetchShopifyOrderData(order.orderId)
        }

        // Fetch Etsy receipt data once for the entire order (if Etsy)
        let etsyReceipt = null
        if (isEtsy) {
          etsyReceipt = await fetchEtsyReceiptData(order.orderId)
        }

        // Build Artelo-index → Shopify/Etsy-index maps once for this order.
        // CRITICAL: Artelo can return orderItems in a different order than the
        // upstream Shopify/Etsy line_items. Positional indexing would glue the
        // wrong runner name to the wrong print size. See buildShopifyMatchMap
        // and buildEtsyMatchMap above.
        const shopifyMatchMap = isShopify
          ? buildShopifyMatchMap(order.orderItems || [], shopifyData?.shopifyOrderData?.line_items || [])
          : null
        const etsyMatchMap = isEtsy
          ? buildEtsyMatchMap(order.orderItems || [], etsyReceipt?.transactions || [])
          : null

        // Edited after import (a frame added, a size changed): put each
        // existing row on the item it now describes before matching.
        if (isShopify && shopifyData) {
          await reconcileEditedOrder(prisma, order, shopifyData, log)
        }

        // Process each line item separately
        for (let lineItemIndex = 0; lineItemIndex < numItems; lineItemIndex++) {
          const orderResult = {
            orderNumber: `${order.orderId}-${lineItemIndex}`,
            action: null,
            raceName: null,
            runnerName: null,
            researchStatus: null
          }

          try {
            // Check if this line item exists
            const existing = await prisma.order.findUnique({
              where: {
                parentOrderNumber_lineItemIndex: {
                  parentOrderNumber: order.orderId,
                  lineItemIndex: lineItemIndex
                }
              }
            })

            // Get line item data from Artelo
            const arteloItem = order.orderItems?.[lineItemIndex]
            const rawSize = arteloItem?.product?.size || 'Unknown'
            const productSize = rawSize.startsWith('x') ? rawSize.slice(1) : rawSize
            const frameType = arteloItem?.product?.frameColor || 'Unknown'

            // The $15 photo upcharge is not a print, but Artelo still returns a
            // line item for it. buildShopifyMatchMap pairs Artelo items against
            // the PRINTS only, so an item left unmatched (-1) has no print to
            // describe: it is the add-on. Importing it would create a row with
            // no race, runner or size that reads as a broken order.
            //
            // Only skip when we have not already created a row for it — an
            // existing row is someone's real data and is not ours to drop.
            // A Shopify order whose Shopify data did not load is retried on the
            // next run (every 10 minutes) rather than imported blind: a row
            // made now would have no runner, race or matching, and is the
            // "Unknown Race" row Eli kept finding.
            // Only for a day: an order Shopify never returns (deleted, say)
            // still has to reach the dashboard, even blind.
            const placedAt = new Date(order.createdAt || order.created_at || Date.now()).getTime()
            if (!existing && isShopify && !shopifyData && Date.now() - placedAt < 24 * 3600 * 1000) {
              log(`[processOrders] Deferring line item ${lineItemIndex} on order ${order.orderId} (Shopify order did not load, will retry next run)`)
              results.skipped++
              orderResult.action = 'deferred'
              results.orders.push(orderResult)
              continue
            }

            // A bulk run paid through Shopify (a draft order tagged "bulk") is
            // not a print order. It belongs to the Bulk tab, where
            // syncShopifyBulkOrders links it to its run; never a standard row.
            if (!existing && isShopify && shopifyData?.shopifyOrderData && isBulkShopifyOrder(shopifyData.shopifyOrderData)) {
              log(`[processOrders] Skipping line item ${lineItemIndex} on order ${order.orderId} (Shopify order tagged bulk: handled in the Bulk tab)`)
              results.skipped++
              orderResult.action = 'skipped'
              results.orders.push(orderResult)
              continue
            }

            // Artelo itself marks the add-on: its item has no product (no size,
            // no frame). That holds whether or not the Shopify order loaded,
            // which the match below depends on. A run where the Shopify fetch
            // came back empty imported the add-on as "Unknown Race".
            if (!existing && arteloItem && !arteloItem.product) {
              log(`[processOrders] Skipping line item ${lineItemIndex} on order ${order.orderId} (Artelo item has no product: an add-on, not a print)`)
              results.skipped++
              orderResult.action = 'skipped'
              results.orders.push(orderResult)
              continue
            }

            if (!existing && isShopify && shopifyData?.shopifyOrderData?.line_items?.length) {
              if ((shopifyMatchMap?.[lineItemIndex] ?? -1) < 0) {
                log(`[processOrders] Skipping line item ${lineItemIndex} on order ${order.orderId} (no print to match, treating as photo add-on)`)
                results.skipped++
                orderResult.action = 'skipped'
                results.orders.push(orderResult)
                continue
              }
              // A product with nothing to personalize (Settings > Skipped
              // Products): Artelo fulfills it from its own library.
              const line = shopifyData.shopifyOrderData.line_items[shopifyMatchMap[lineItemIndex]]
              if (isExcludedLine(line, excludedProducts)) {
                log(`[processOrders] Skipping line item ${lineItemIndex} on order ${order.orderId} (${line.title}: a skipped product)`)
                results.skipped++
                orderResult.action = 'skipped'
                results.orders.push(orderResult)
                continue
              }
            }

            // If order exists, check for updates
            if (existing) {
              let needsUpdate = false
              const updateData = {}

              // Check if order has been fulfilled (status changed from actionable to non-actionable)
              const wasActionable = existing.status !== 'completed'
              const isNowFulfilled = !ACTIONABLE_STATUSES.includes(order.status)

              if (wasActionable && isNowFulfilled) {
                updateData.status = 'completed'
                updateData.researchedAt = new Date()
                needsUpdate = true
                log(`[processOrders] Marking order ${existing.orderNumber} as completed (fulfilled in Artelo)`)
              }

              // If missing Shopify data, fetch and update
              if (isShopify && !existing.shopifyOrderData && shopifyData) {
                log(`[processOrders] Updating order ${existing.orderNumber} with Shopify data...`)

                // Extract customer email and name
                updateData.customerEmail = shopifyData.shopifyOrderData?.email ||
                                           shopifyData.shopifyOrderData?.customer?.email || existing.customerEmail
                updateData.customerName = shopifyData.shopifyOrderData?.customer?.first_name || existing.customerName

                // Extract personalization for this specific line item.
                // IMPORTANT: use the matchMap (not lineItemIndex) — Artelo can
                // reorder items relative to Shopify. See buildShopifyMatchMap.
                const shopifyIdx = shopifyMatchMap?.[lineItemIndex] ?? -1
                const lineItem = shopifyIdx >= 0
                  ? shopifyData.shopifyOrderData?.line_items?.[shopifyIdx]
                  : null
                if (lineItem) {
                  const extracted = extractShopifyPersonalization(lineItem)

                  updateData.raceName = canonicalizeRaceName(extracted.raceName) || existing.raceName
                  updateData.runnerName = extracted.runnerName || existing.runnerName
                  updateData.raceYear = extracted.raceYear || existing.raceYear
                  updateData.hadNoTime = extracted.hadNoTime || false
                  updateData.shopifyOrderData = shopifyData.shopifyOrderData
                  updateData.notes = shopifyData.notes || existing.notes

                  // Capture the Instant Lookup widget result for ALL order types
                  // (backfill path for orders that were missing Shopify data).
                  updateData.lookupVerified = extracted.lookupVerified
                  updateData.customerBib = extracted.bibNumberCustomer
                  updateData.customerFinishTime = extracted.timeCustomer
                  updateData.customerPace = extracted.customerPace
                  updateData.customerEventType = extracted.customerEventType
                  updateData.lookupOutcome = extracted.lookupOutcome
                  updateData.lookupMatchedName = extracted.lookupMatchedName
                  updateData.photoPath = extracted.photoPath
                  // Gift flag applies to ALL orders (Easify + widget both set it).
                  updateData.isGift = extracted.isGift

                  // Classify and extract custom order fields
                  // Check product title for custom order detection, not the extracted raceName
                  if (isCustomOrder(extracted.productTitle)) {
                    updateData.trackstarOrderType = 'custom'
                    updateData.bibNumberCustomer = extracted.bibNumberCustomer
                    updateData.timeCustomer = extracted.timeCustomer
                    updateData.creativeDirection = extracted.creativeDirection

                    const isRush = existing.rushOverride || shopifyOrderIsRush(shopifyData.shopifyOrderData, extracted.isRush)
                    updateData.isRushOrder = isRush

                    // Compute due date from Shopify order created_at.
                    //
                    // The existing date is normally left alone (a human may
                    // have moved it). The exception is an order that turns out
                    // to be rush while still carrying the standard 14-day date:
                    // that date was computed before we knew, and leaving it
                    // would bury a paid rush order at the back of the queue.
                    const orderCreatedAt = shopifyData.shopifyOrderData?.created_at
                    if (orderCreatedAt) {
                      const computed = customDueDate(orderCreatedAt, isRush)
                      const standard = customDueDate(orderCreatedAt, false)
                      const stillStandard = existing.dueDate && standard &&
                        Math.abs(new Date(existing.dueDate).getTime() - standard.getTime()) < 60 * 1000
                      if (computed && (!existing.dueDate || (isRush && !existing.isRushOrder && stillStandard))) {
                        updateData.dueDate = computed
                      }
                    }
                  }

                  // A year a person set (the year chip) answers it; the order text never will.
                  if (extracted.needsAttention && existing.status === 'pending' && existing.yearOverride == null && !isCustomOrder(extracted.productTitle)) {
                    updateData.status = 'missing_year'
                    results.needsAttention++
                  }

                  needsUpdate = true
                  results.enriched++
                }
              }

              // If missing Etsy data, fetch and update
              if (isEtsy && !existing.etsyOrderData && etsyReceipt) {
                log(`[processOrders] Updating order ${existing.orderNumber} with Etsy data...`)

                // Extract customer email from receipt
                updateData.customerEmail = etsyReceipt.buyer_email || existing.customerEmail

                // Extract personalization for this specific line item.
                // IMPORTANT: use the matchMap (not lineItemIndex) — Artelo can
                // reorder items relative to Etsy. See buildEtsyMatchMap.
                const etsyIdx = etsyMatchMap?.[lineItemIndex] ?? -1
                const transaction = etsyIdx >= 0
                  ? etsyReceipt.transactions?.[etsyIdx]
                  : null
                if (transaction) {
                  const extracted = extractEtsyPersonalization(transaction)

                  updateData.raceName = canonicalizeRaceName(extracted.raceName) || existing.raceName
                  updateData.runnerName = extracted.runnerName || existing.runnerName
                  updateData.raceYear = extracted.raceYear || existing.raceYear
                  if (extracted.hadNoTime) updateData.hadNoTime = true
                  if (extracted.bibNumberCustomer && !existing.bibNumberCustomer) updateData.bibNumberCustomer = extracted.bibNumberCustomer
                  updateData.etsyOrderData = etsyReceipt

                  // Classify custom orders (e.g. "Any Race - Custom Trackstar Print")
                  if (isCustomOrder(extracted.productTitle)) {
                    updateData.trackstarOrderType = 'custom'
                    if (extracted.timeCustomer) updateData.timeCustomer = extracted.timeCustomer
                    if (extracted.creativeDirection) updateData.creativeDirection = extracted.creativeDirection

                    // Backfill due date if missing: Etsy create_timestamp (seconds) + 14 days
                    const etsyCreatedAt = etsyReceipt.create_timestamp
                    if (etsyCreatedAt && !existing.dueDate) {
                      updateData.dueDate = customDueDate(etsyCreatedAt * 1000, false)
                    }
                  }

                  // A year a person set (the year chip) answers it; the order text never will.
                  if (extracted.needsAttention && existing.status === 'pending' && existing.yearOverride == null && !isCustomOrder(extracted.productTitle)) {
                    updateData.status = 'missing_year'
                    results.needsAttention++
                  }

                  needsUpdate = true
                  results.enriched++
                }
              }

              // Rush decided after purchase. We edit the Shopify order to add the
              // rush product; Shopify keeps it "partially_paid" until the
              // customer pays the difference. Checked on every run, because the
              // edit comes long after the first import:
              //   - paid rush, not yet marked: rush, due 4 days from the
              //     original purchase, which also moves it up the queue;
              //   - marked rush with no paid rush (ticked the box, never paid):
              //     back to standard, unless it is already in production.
              if (
                existing.trackstarOrderType === 'custom' && shopifyData?.shopifyOrderData && !existing.rushOverride &&
                existing.designStatus !== 'sent_to_production' && updateData.isRushOrder === undefined
              ) {
                const paidRush = shopifyOrderIsRush(shopifyData.shopifyOrderData)
                const placed = shopifyData.shopifyOrderData.created_at
                if (paidRush !== !!existing.isRushOrder && placed) {
                  // Only move a date the tool set itself; a hand-moved date stays.
                  const before = customDueDate(placed, !!existing.isRushOrder)
                  const untouched = !existing.dueDate || (before && Math.abs(new Date(existing.dueDate).getTime() - before.getTime()) < 60 * 1000)
                  updateData.isRushOrder = paidRush
                  updateData.shopifyOrderData = shopifyData.shopifyOrderData
                  if (untouched) updateData.dueDate = customDueDate(placed, paidRush)
                  needsUpdate = true
                  log(`[processOrders] ${paidRush ? '⚡ Rush paid' : 'Rush not paid'} on ${existing.orderNumber}${untouched ? `, due ${updateData.dueDate.toISOString().slice(0, 10)}` : ' (due date was set by hand, left alone)'}`)
                }
              }

              // Keep the stored Shopify order current while it is open: an edit
              // after purchase (a Photo Add-On we billed for, a rush) changes
              // the line items, and the customer paying changes the payment
              // status. Both decide whether that extra is paid. Also written when
              // Shopify's updated_at moved, so the next run can tell the order
              // is unchanged and skip re-reading it. A quiet order costs nothing.
              if (shopifyData?.shopifyOrderData && existing.shopifyOrderData && updateData.shopifyOrderData === undefined) {
                const fresh = shopifyData.shopifyOrderData, stored = existing.shopifyOrderData
                const lines = o => JSON.stringify((o.line_items || []).map(l => [l.id, l.current_quantity ?? l.quantity]))
                if (fresh.financial_status !== stored.financial_status || lines(fresh) !== lines(stored) || fresh.updated_at !== stored.updated_at) {
                  updateData.shopifyOrderData = fresh
                  needsUpdate = true
                }
              }

              // The photo add-on came off (edited off the order, or never paid
              // for at checkout): the print loses the photo too, before it is
              // made. See withoutUnpaidPhotos. A photo attached by hand is ours.
              if (existing.photoPath && !existing.photoAddedManually && existing.status !== 'completed' && existing.designStatus !== 'sent_to_production' && shopifyData?.shopifyOrderData) {
                const idx = shopifyMatchMap?.[lineItemIndex] ?? -1
                const line = idx >= 0 ? shopifyData.shopifyOrderData.line_items?.[idx] : null
                if (line && (line.properties || []).some(p => p?.name === '_photo_removed' && p.value === existing.photoPath)) {
                  updateData.photoPath = null
                  if (updateData.shopifyOrderData === undefined) updateData.shopifyOrderData = shopifyData.shopifyOrderData
                  needsUpdate = true
                  // A design made with the photo is no longer the print: close it,
                  // and the next pass renders it again without (as a year change does).
                  await prisma.renderJob.updateMany({ where: { orderId: existing.id, review: { in: ['pending', 'approved'] }, arteloSentAt: null }, data: { review: 'closed', reviewNote: 'Photo add-on removed from the order', reviewedAt: new Date(), sendAfter: null } })
                  await prisma.orderComment.create({ data: { orderId: existing.id, text: 'Photo taken off: the Photo Add-On is no longer on the Shopify order, so this print is made without the customer photo.', authorName: 'Trackstar' } })
                  log(`[processOrders] Photo add-on gone on ${existing.orderNumber}: photo taken off the print`)
                }
              }

              if (needsUpdate) {
                // An order that turns out to be custom on a later pass moves to
                // the custom queue, unless someone already picked an assignee
                // by hand (anyone not taking that type's new orders today).
                const newType = updateData.trackstarOrderType
                if (newType && newType !== existing.trackstarOrderType) {
                  if (!existing.assigneeId || await isAutoAssignee(existing.trackstarOrderType, existing.assigneeId)) {
                    updateData.assigneeId = await assigneeForNewOrder(newType)
                  }
                }
                await prisma.order.update({
                  where: { id: existing.id },
                  data: updateData
                })

                results.updated++
                orderResult.action = 'updated'
                orderResult.raceName = updateData.raceName || existing.raceName
                orderResult.runnerName = updateData.runnerName || existing.runnerName
              } else {
                results.skipped++
                orderResult.action = 'skipped'
                orderResult.raceName = existing.raceName
                orderResult.runnerName = existing.runnerName
              }
            } else {
              // Create new order for this line item
              let raceName = 'Unknown Race'
              let raceYear = new Date().getFullYear()
              // Don't fall back to the shipping customer name — they're often
              // not the same person as the runner, and silently using it
              // hides the fact that personalization was bypassed. Leaving it
              // as "Unknown Runner" surfaces orders that need manual lookup.
              let runnerName = 'Unknown Runner'
              let status = 'pending'
              let lineItemShopifyData = null
              let lineItemEtsyData = null
              let notes = null
              let hadNoTime = false
              // Custom order fields
              let trackstarOrderType = 'standard'
              let bibNumberCustomer = null
              let timeCustomer = null
              let creativeDirection = null
              let isGiftOrder = false
              let customerEmail = null
              let customerName = null
              let dueDate = null
              let isRushOrder = false
              // Instant Lookup widget result (standard orders, Shopify only).
              // Captured for ALL order types; null when the widget wasn't used.
              let lookupVerified = null
              let customerBib = null
              let customerFinishTime = null
              let customerPace = null
              let customerEventType = null
              let lookupOutcome = null
              let lookupMatchedName = null
              let photoPath = null

              if (isShopify && shopifyData) {
                log(`[processOrders] Processing Shopify line item ${lineItemIndex} for order ${order.orderId}...`)

                // Extract customer email and name from Shopify order data
                customerEmail = shopifyData.shopifyOrderData?.email ||
                                shopifyData.shopifyOrderData?.customer?.email || null
                customerName = shopifyData.shopifyOrderData?.customer?.first_name || null

                // Extract personalization for this specific line item.
                // IMPORTANT: use the matchMap (not lineItemIndex) — Artelo can
                // reorder items relative to Shopify. See buildShopifyMatchMap.
                const shopifyIdx = shopifyMatchMap?.[lineItemIndex] ?? -1
                const lineItem = shopifyIdx >= 0
                  ? shopifyData.shopifyOrderData?.line_items?.[shopifyIdx]
                  : null
                if (lineItem) {
                  const extracted = extractShopifyPersonalization(lineItem)

                  raceName = canonicalizeRaceName(extracted.raceName) || raceName
                  runnerName = extracted.runnerName || runnerName
                  raceYear = extracted.raceYear || raceYear
                  hadNoTime = extracted.hadNoTime || false
                  lineItemShopifyData = shopifyData.shopifyOrderData
                  notes = shopifyData.notes

                  // Capture the Instant Lookup widget result for ALL order types.
                  // Phase 0 only persists these; Phase 1 will read lookupVerified
                  // to skip research when the customer confirmed an official match.
                  lookupVerified = extracted.lookupVerified
                  customerBib = extracted.bibNumberCustomer
                  customerFinishTime = extracted.timeCustomer
                  customerPace = extracted.customerPace
                  customerEventType = extracted.customerEventType
                  lookupOutcome = extracted.lookupOutcome
                  lookupMatchedName = extracted.lookupMatchedName
                  photoPath = extracted.photoPath
                  // Gift flag applies to ALL orders (Easify + widget both set it).
                  // hadNoTime is already captured above.
                  isGiftOrder = extracted.isGift

                  // Custom order classification — check product title, not extracted raceName
                  // (for custom orders, raceName is the customer-provided race, e.g. "Jfk 50",
                  //  but the product title is "Custom Trackstar Print (Any Race)")
                  if (isCustomOrder(extracted.productTitle)) {
                    trackstarOrderType = 'custom'
                    bibNumberCustomer = extracted.bibNumberCustomer
                    timeCustomer = extracted.timeCustomer
                    creativeDirection = extracted.creativeDirection
                    // isGiftOrder is captured above for all order types.

                    isRushOrder = shopifyOrderIsRush(shopifyData.shopifyOrderData, extracted.isRush)

                    // Compute due date: order created_at + 14 days, or 4 when
                    // the customer paid to skip the line.
                    const orderCreatedAt = shopifyData.shopifyOrderData?.created_at
                    if (orderCreatedAt) {
                      dueDate = customDueDate(orderCreatedAt, isRushOrder)
                    }

                    log(`[processOrders] 🎨 Custom order detected: ${order.orderId}-${lineItemIndex}${isRushOrder ? ' ⚡ RUSH' : ''}`)
                  }

                  if (extracted.needsAttention && trackstarOrderType !== 'custom') {
                    status = 'missing_year'
                    results.needsAttention++
                  }
                  results.enriched++
                }
              }

              // Etsy enrichment
              if (isEtsy && etsyReceipt) {
                log(`[processOrders] Processing Etsy line item ${lineItemIndex} for order ${order.orderId}...`)

                // Extract customer email from receipt
                customerEmail = etsyReceipt.buyer_email || null

                // Extract personalization for this specific line item.
                // IMPORTANT: use the matchMap (not lineItemIndex) — Artelo can
                // reorder items relative to Etsy. See buildEtsyMatchMap.
                const etsyIdx = etsyMatchMap?.[lineItemIndex] ?? -1
                const transaction = etsyIdx >= 0
                  ? etsyReceipt.transactions?.[etsyIdx]
                  : null
                if (transaction) {
                  const extracted = extractEtsyPersonalization(transaction)

                  raceName = canonicalizeRaceName(extracted.raceName) || raceName
                  runnerName = extracted.runnerName || runnerName
                  raceYear = extracted.raceYear || raceYear
                  hadNoTime = extracted.hadNoTime || false
                  // Display only: not customerBib, which would make the
                  // customer-results step record a bib-only "found" and skip research
                  bibNumberCustomer = extracted.bibNumberCustomer || bibNumberCustomer
                  lineItemEtsyData = etsyReceipt

                  // Classify custom orders (e.g. "Any Race - Custom Trackstar Print")
                  if (isCustomOrder(extracted.productTitle)) {
                    trackstarOrderType = 'custom'
                    timeCustomer = extracted.timeCustomer || timeCustomer
                    creativeDirection = extracted.creativeDirection || creativeDirection

                    // Compute due date: Etsy create_timestamp (seconds) + 14
                    // days. Rush is not sold on Etsy, so never the short date.
                    const etsyCreatedAt = etsyReceipt.create_timestamp
                    if (etsyCreatedAt) {
                      dueDate = customDueDate(etsyCreatedAt * 1000, false)
                    }

                    log(`[processOrders] 🎨 Custom Etsy order detected: ${order.orderId}-${lineItemIndex}`)
                  }

                  if (extracted.needsAttention && trackstarOrderType !== 'custom') {
                    status = 'missing_year'
                    results.needsAttention++
                  }
                  results.enriched++
                }
              }

              await prisma.order.create({
                data: {
                  orderNumber: `${order.orderId}-${lineItemIndex}`,
                  parentOrderNumber: order.orderId,
                  lineItemIndex: lineItemIndex,
                  source: orderSource,
                  arteloOrderData: order,
                  shopifyOrderData: lineItemShopifyData,
                  etsyOrderData: lineItemEtsyData,
                  raceName,
                  raceYear,
                  runnerName,
                  hadNoTime,
                  productSize,
                  frameType,
                  notes,
                  status,
                  // Custom order fields
                  trackstarOrderType,
                  // Straight into the right person's queue.
                  assigneeId: await assigneeForNewOrder(trackstarOrderType, raceName),
                  designStatus: trackstarOrderType === 'custom' ? 'not_started' : 'not_started',
                  dueDate,
                  isRushOrder,
                  customerEmail,
                  customerName,
                  bibNumberCustomer,
                  timeCustomer,
                  creativeDirection,
                  isGift: isGiftOrder,
                  // Instant Lookup widget result (Phase 0 capture)
                  lookupVerified,
                  customerBib,
                  customerFinishTime,
                  customerPace,
                  customerEventType,
                  lookupOutcome,
                  lookupMatchedName,
                  photoPath
                }
              })

              results.imported++
              orderResult.action = 'imported'
              orderResult.raceName = raceName
              orderResult.runnerName = runnerName

              log(`[processOrders] ✅ Imported: ${order.orderId}-${lineItemIndex} (${orderSource}${trackstarOrderType === 'custom' ? ', CUSTOM' : ''}) - ${raceName} - ${runnerName}`)

              // Notify Eli when a STANDARD order comes in with expedited shipping.
              // (Expedited shipping is only meaningful on standard orders — customs
              // have their own due-date workflow.)
              try {
                if (
                  trackstarOrderType === 'standard' &&
                  orderSource === 'shopify' &&
                  isExpeditedShipping(lineItemShopifyData)
                ) {
                  const shippingMethod = getShippingMethod(lineItemShopifyData)
                  const displayNum = lineItemShopifyData?.name || `#${order.orderId}`
                  const eliDmUrl = process.env.SLACK_ELI_DM_WEBHOOK_URL
                  const fallbackUrl = process.env.SLACK_PROOF_WEBHOOK_URL
                  const slackUrl = eliDmUrl || fallbackUrl
                  if (slackUrl) {
                    // Artelo lets us pick the shipping label on the order now, so
                    // nobody has to ask their support. The customer pays $40 for
                    // expedited, so the label has to come in under that.
                    const text = `🚀 <@U09UVEP1N3Y> *EXPEDITED ORDER* - *${displayNum}* (${raceName}, ${runnerName})\n` +
                      `Customer paid for *${shippingMethod || 'expedited'}* shipping. Put this one through right away:\n` +
                      `• Verify all personalization is complete\n` +
                      `• Send it to production now (no need to wait for Matt)\n` +
                      `• In the Artelo order, under Shipping, click *Change shipping method* and pick *UPS Next Day Air Saver*, as long as it is under $40 (what the customer paid). If it is $40 or more, pick the fastest option under $40, and tell Matt if there is none`
                    fetchWithTimeout(slackUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ text })
                    }).catch(e => log(`[processOrders] Expedited Slack notification failed: ${e.message}`))
                    log(`[processOrders] 🚀 Expedited shipping detected on ${order.orderId}-${lineItemIndex} - Slack sent`)
                  }
                }
              } catch (e) {
                log(`[processOrders] Error checking expedited shipping: ${e.message}`)
              }
            }

            // 3. Run research if enabled and we have a scraper for this race
            //    Skip research for custom orders (no race to scrape)
            if (runResearch && orderResult.action !== 'skipped') {
              const dbOrder = await prisma.order.findUnique({
                where: {
                  parentOrderNumber_lineItemIndex: {
                    parentOrderNumber: order.orderId,
                    lineItemIndex: lineItemIndex
                  }
                }
              })

              if (dbOrder && dbOrder.trackstarOrderType !== 'custom') {
                // Customer confirmed an official-results match in the storefront
                // Instant Lookup widget → trust it and skip the runner scrape.
                // applyVerifiedResult still fetches race-level data (weather/
                // location). Manual entry (lookupVerified === false) and orders
                // without the widget (null) fall through to the normal scrape.
                //
                // NOTE: we do NOT require customerFinishTime here. Shoppers who
                // tick "no time on poster" still verified bib + event against
                // official results — that's the data worth trusting. The
                // resulting RunnerResearch row simply has null time/pace, and
                // the order's hadNoTime flag drives the "No Time" badge.
                // Did the shopper hand us usable numbers, verified or not?
                // A time is enough on its own, and so is a bib: both are things
                // only they can tell us for a race we may not even be able to
                // scrape.
                const customerSupplied = Boolean(dbOrder.customerFinishTime || dbOrder.customerBib)

                if (dbOrder.lookupVerified === true) {
                  log(`[processOrders] ✅ Customer-verified result for ${dbOrder.orderNumber} - skipping runner scrape`)
                  try {
                    await researchService.applyVerifiedResult(dbOrder.orderNumber)
                    results.researched++
                    orderResult.researchStatus = 'customer_verified'
                  } catch (verifyError) {
                    results.researchFailed++
                    orderResult.researchStatus = 'error'
                    log(`[processOrders] ❌ Failed to apply customer-verified result: ${verifyError.message}`)
                  }
                } else if (dbOrder.lookupVerified === false && customerSupplied) {
                  // They typed or edited their own numbers. Those are the
                  // numbers going on the poster, so a scrape cannot improve
                  // them - it can only muddy them. On a common surname it comes
                  // back with a page of strangers and the order sits in the
                  // queue looking unresolved when nothing was ever missing.
                  // Race-level data (date, weather) is still fetched.
                  log(`[processOrders] ✍️  Customer-supplied result for ${dbOrder.orderNumber} - skipping runner scrape`)
                  try {
                    await researchService.applyVerifiedResult(dbOrder.orderNumber, { verified: false })
                    results.researched++
                    orderResult.researchStatus = 'customer_supplied'
                  } catch (supplyError) {
                    results.researchFailed++
                    orderResult.researchStatus = 'error'
                    log(`[processOrders] ❌ Failed to apply customer-supplied result: ${supplyError.message}`)
                  }
                } else if (hasScraperForRace(dbOrder.raceName)) {
                  log(`[processOrders] Running research for ${dbOrder.orderNumber}...`)
                  try {
                    const research = await researchService.researchOrder(dbOrder.orderNumber)
                    if (research.runnerResearch.researchStatus === 'found') {
                      results.researched++
                      orderResult.researchStatus = 'found'
                      log(`[processOrders] ✅ Research found: ${research.runnerResearch.bibNumber}`)
                    } else {
                      orderResult.researchStatus = research.runnerResearch.researchStatus
                    }
                  } catch (researchError) {
                    results.researchFailed++
                    orderResult.researchStatus = 'error'
                    log(`[processOrders] ❌ Research failed: ${researchError.message}`)
                  }
                }
              }
            }

            results.orders.push(orderResult)

          } catch (lineItemError) {
            results.errors.push({
              orderNumber: `${order.orderId}-${lineItemIndex}`,
              error: lineItemError.message
            })
            log(`[processOrders] ❌ Error processing line item ${order.orderId}-${lineItemIndex}: ${lineItemError.message}`)
          }
        }

      } catch (orderError) {
        results.errors.push({
          orderNumber: order.orderId,
          error: orderError.message
        })
        log(`[processOrders] ❌ Error processing ${order.orderId}: ${orderError.message}`)
      }
    }

    // 4. Update "customers served" counter for ALL new Artelo orders (any status)
    //    This uses allNewOrderCount (computed before the actionable/completed split)
    //    so manual orders that skip the actionable path still get counted.
    //    Also persists the "counted IDs" set to prevent double-counting on next run.
    if (allNewOrderCount > 0) {
      try {
        const newCount = await incrementCustomersServed(prisma, allNewOrderCount)
        log(`[processOrders] 📊 Customers served: ${newCount.toLocaleString('en-US')} (+${allNewOrderCount} from all new orders)`)

        // Save counted IDs (pruned to current Artelo window) to prevent double-counting
        await saveCountedOrderIds(prisma, countedOrderIds, allArteloIds)

        // Push updated count to Shopify metaobject
        const synced = await syncCustomersServedToShopify(prisma)
        if (synced) {
          log('[processOrders] ✅ Shopify metaobject updated')
        }
      } catch (counterError) {
        // Don't fail the import if counter update fails
        console.error('[processOrders] ⚠️ Counter update failed (non-fatal):', counterError.message)
      }
    } else if (allArteloIds.size > 0 && countedOrderIds.size > 0) {
      // Even if no new orders, prune the counted IDs set on each run
      try {
        await saveCountedOrderIds(prisma, countedOrderIds, allArteloIds)
      } catch (err) {
        // Non-fatal
      }
    }

    // 5. Summary
    log('\n[processOrders] === SUMMARY ===')
    log(`  Total orders: ${results.total}`)
    log(`  Imported: ${results.imported}`)
    log(`  Updated: ${results.updated}`)
    log(`  Skipped: ${results.skipped}`)
    log(`  Enriched with Shopify: ${results.enriched}`)
    log(`  Needs attention: ${results.needsAttention}`)
    if (runResearch) {
      log(`  Researched: ${results.researched}`)
      log(`  Research failed: ${results.researchFailed}`)
    }
    if (results.errors.length > 0) {
      log(`  Errors: ${results.errors.length}`)
    }

    return results

  } catch (error) {
    results.success = false
    results.errors.push({ error: error.message })
    console.error('[processOrders] Fatal error:', error)
    throw error
  } finally {
    // Also disconnect research service if we used it
    if (runResearch) {
      await researchService.disconnect()
    }
  }
}

export default processOrders
