import { isTriathlon } from '../../server/domain/orders/triathlon.js'
import prisma from '../_lib/prisma.js'
import { seesMoney } from '../_lib/money.js'
import { setCors, requireAdmin } from '../_lib/auth.js'
import { hasScraperForRace } from '../../server/scrapers/index.js'
import { isExpeditedShipping, getShippingMethod } from '../../server/lib/shipping.js'
import { getOrderTotalUsd, isBigSpender, BIG_SPENDER_THRESHOLD_USD } from '../../server/lib/orderValue.js'
import { getProductInfo, loadProductCatalog } from '../../server/lib/productCatalog.js'
import { isRushAddonLineItem, isRemovedLineItem } from '../../server/lib/lineItemMatching.js'
import { unpaidPhotoRows } from '../../server/domain/orders/photoPayment.js'
import { shopifyAdminUrl, arteloOrderUrl, etsyOrderUrl } from '../../server/lib/links.js'
import { getEtsyListingImageUrl } from '../../server/lib/etsyImageCache.js'
import { formatRaceDate, formatTemp, formatTime, formatPace } from '../../server/lib/printFormat.js'
import { resolveEvent } from '../../server/lib/raceEvent.js'
import { dateVerified } from '../../server/domain/races/verification.js'
import { pipelineFor } from '../../server/domain/orders/pipeline.js'
import { loadPipelineContext } from '../../server/domain/orders/pipelineStatus.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { waitingOnCustomers } from '../../server/domain/support/compose.js'


/**
 * Format date as MM.DD.YY (e.g., "12.02.18")
 */



/**
 * Just the keys of the raw order payloads this list reads, including what
 * getProductInfo (line items, Etsy transactions, Artelo item sizes) and
 * isBigSpender (order totals) read, built in Postgres
 * so only those bytes leave the database. Add a key here if the list starts
 * reading a new one.
 */
export async function rawSlice(ids) {
  if (!ids.length) return new Map()
  const rows = await prisma.$queryRaw`
    SELECT id,
      CASE WHEN "shopifyOrderData" IS NULL THEN NULL ELSE jsonb_build_object(
        'id', "shopifyOrderData"::jsonb->'id',
        'id', "shopifyOrderData"::jsonb->'id',
        'name', "shopifyOrderData"::jsonb->'name',
        'created_at', "shopifyOrderData"::jsonb->'created_at',
        'financial_status', "shopifyOrderData"::jsonb->'financial_status',
        'total_price', "shopifyOrderData"::jsonb->'total_price',
        'current_total_price', "shopifyOrderData"::jsonb->'current_total_price',
        'discount_codes', "shopifyOrderData"::jsonb->'discount_codes',
        'shipping_lines', (SELECT jsonb_agg(jsonb_build_object('title', l->'title', 'price', l->'price'))
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof("shopifyOrderData"::jsonb->'shipping_lines') = 'array'
            THEN "shopifyOrderData"::jsonb->'shipping_lines' ELSE '[]'::jsonb END) l),
        'line_items', (SELECT jsonb_agg(jsonb_build_object('id', l->'id', 'product_id', l->'product_id', 'variant_id', l->'variant_id',
            'title', l->'title', 'sku', l->'sku', 'variant_title', l->'variant_title', 'properties', l->'properties',
            'quantity', l->'quantity', 'current_quantity', l->'current_quantity') ORDER BY n)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof("shopifyOrderData"::jsonb->'line_items') = 'array'
            THEN "shopifyOrderData"::jsonb->'line_items' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(l, n))) END AS s,
      CASE WHEN "etsyOrderData" IS NULL THEN NULL ELSE jsonb_build_object(
        'create_timestamp', "etsyOrderData"::jsonb->'create_timestamp',
        'grandtotal', "etsyOrderData"::jsonb->'grandtotal',
        'total', "etsyOrderData"::jsonb->'total',
        'total_price', "etsyOrderData"::jsonb->'total_price',
        'transactions', (SELECT jsonb_agg(jsonb_build_object('listing_id', x->'listing_id', 'title', x->'title',
            'sku', x->'sku', 'variations', x->'variations') ORDER BY n)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof("etsyOrderData"::jsonb->'transactions') = 'array'
            THEN "etsyOrderData"::jsonb->'transactions' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, n))) END AS e,
      jsonb_build_object(
        'id', "arteloOrderData"::jsonb->'id',
        'shipping', "arteloOrderData"::jsonb->'shipping',
        'creatorId', "arteloOrderData"::jsonb->'creatorId',
        'createdAt', "arteloOrderData"::jsonb->'createdAt',
        'orderItems', (SELECT jsonb_agg(CASE WHEN jsonb_typeof(x->'product') = 'object'
            THEN jsonb_build_object('orderItemId', x->'orderItemId', 'product', jsonb_build_object('size', x->'product'->'size'))
            ELSE jsonb_build_object('orderItemId', x->'orderItemId', 'product', NULL) END ORDER BY n)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof("arteloOrderData"::jsonb->'orderItems') = 'array'
            THEN "arteloOrderData"::jsonb->'orderItems' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, n))) AS a
    FROM "Order" WHERE id = ANY(${ids})`
  return new Map(rows.map(r => [r.id, r]))
}

/**
 * Rush was asked for but is not paid: a print carries "Rush Order: Yes" or a
 * rush line was added by editing the order, and either there is no live rush
 * line or the order is still waiting on the customer's payment.
 */
function rushSelectedNotPaid(shopify) {
  const items = (Array.isArray(shopify?.line_items) ? shopify.line_items : []).filter(li => !isRemovedLineItem(li))
  const ticked = items.some(li => (li.properties || []).some(p =>
    p?.name === 'Rush Order' && String(p.value || '').toLowerCase().startsWith('yes')))
  const rushLine = items.some(isRushAddonLineItem)
  const paid = ['paid', 'partially_refunded'].includes(shopify?.financial_status)
  return (ticked || rushLine) && !(rushLine && paid)
}

/**
 * Discount codes applied to the Shopify order.
 *
 * Surfaced so a code can act as a fulfillment instruction, not just a price
 * change: a charity or race partner gets their own code, and its presence is
 * what tells Eli to print the co-branded version of that design. Nothing acts
 * on it yet, this only makes it visible.
 *
 * Shape from Shopify is [{ code, type, amount }] where type is percentage,
 * fixed_amount or shipping. All types are passed through rather than filtering
 * to line-item discounts, because a partner code could be set up any way and
 * silently hiding one would be worse than showing an uninteresting one.
 */
function extractDiscountCodes(order) {
  const codes = order?.shopifyOrderData?.discount_codes
  if (!Array.isArray(codes)) return []
  return codes
    .filter(c => c && typeof c.code === 'string' && c.code.trim())
    .map(c => ({
      code: c.code.trim(),
      type: c.type || null,
      amount: c.amount || null,
    }))
}



const AUSTIN_EVENT_IDS = {
  2026: { marathon: '17035', halfMarathon: '17034' }
}

function buildAustinFallbackUrl(runnerName, raceName, year, eventType) {
  if (!runnerName || !/austin/i.test(raceName)) return null
  const ids = AUSTIN_EVENT_IDS[year]
  if (!ids) return null
  const isHalf = /half/i.test(eventType || '')
  const eventId = isHalf ? ids.halfMarathon : ids.marathon
  const parts = runnerName.trim().split(/\s+/)
  const fname = parts[0] || ''
  const lname = parts.slice(1).join(' ') || ''
  const params = new URLSearchParams({ eID: eventId, fname, lname })
  return `https://www.mychiptime.com/searchResultGen.php?${params.toString()}`
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  const money = seesMoney(actor)

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Support listing races: ?list=races
    const { type, list } = req.query

    if (list === 'races') {
      const races = await prisma.race.findMany({
        orderBy: [{ year: 'desc' }, { raceName: 'asc' }],
        include: {
          _count: { select: { runnerResearch: true } }
        }
      })
      return res.status(200).json({ races })
    }

    // Support filtering by order type: ?type=standard | custom | race_partner
    const whereClause = {}
    if (type === 'standard' || type === 'custom' || type === 'race_partner' || type === 'bulk') {
      whereClause.trackstarOrderType = type
    } else {
      // No type specified: exclude partner design rows, bulk runners and
      // overseas sample designs from the default "all" query so they never
      // leak into customer-order analytics or list views.
      whereClause.trackstarOrderType = { notIn: ['race_partner', 'bulk', 'sample'] }
    }
    // ?scope=open: leave completed orders out. The dashboard refreshes every
    // minute and only needs them for the completed list and search, so they
    // load on demand. Most of the table's rows (and cost) were completed orders.
    // ?number=5038: the one order behind a URL like /orders/5038, whatever its
    // type or status, so a reload or a shared link opens it without the list.
    const number = String(req.query.number || '').trim().replace(/^#/, '')
    if (number) {
      delete whereClause.trackstarOrderType
      whereClause.OR = [
        { parentOrderNumber: number },
        { shopifyOrderData: { path: ['name'], equals: number } },
        { shopifyOrderData: { path: ['name'], equals: `#${number}` } },
      ]
    }
    const openOnly = req.query.scope === 'open' && !number
    let completedCount = null
    if (openOnly) {
      completedCount = await prisma.order.count({ where: { ...whereClause, status: 'completed' } })
      whereClause.status = { not: 'completed' }
    }
    // ?scope=completed&skip=100: completed orders a page at a time, newest
    // first, for the bottom of the standard queue's All (loaded as you scroll).
    const completedPage = req.query.scope === 'completed' && !number
    if (completedPage) whereClause.status = 'completed'
    // ?scope=completed&q=jane@example.com: the completed orders a search in the
    // queue matches, found here. Loading every completed order to search them
    // in the browser came to ~16MB, over Vercel's response limit, so the
    // search quietly showed open orders only.
    const q = completedPage ? String(req.query.q || '').trim().replace(/^#/, '').slice(0, 100) : ''
    if (q) {
      const text = { contains: q, mode: 'insensitive' }
      whereClause.OR = [
        { customerEmail: text }, { customerName: text },
        { runnerName: text }, { runnerNameOverride: text },
        { raceName: text }, { raceNameOverride: text },
        { parentOrderNumber: { contains: q } },
        // Reading the Shopify name opens every row's whole payload, so only
        // for a query that could be an order number.
        ...(/^\d+$/.test(q) ? [{ shopifyOrderData: { path: ['name'], string_contains: q } }] : []),
        { bibNumberCustomer: { equals: q, mode: 'insensitive' } },
        { runnerResearch: { some: { bibNumber: { equals: q, mode: 'insensitive' } } } },
      ]
    }
    const page = completedPage
      ? { take: Math.min(200, Math.max(1, Number(req.query.take) || 100)), skip: Math.max(0, Number(req.query.skip) || 0) }
      : {}

    // Fetch orders with their research data and race info. One query after
    // another on purpose: run side by side, one request held most of the
    // instance's five connections (server/db.js) for a ~10% gain.
    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: [{ createdAt: 'desc' }],
      ...page,
      include: {
        runnerResearch: {
          include: {
            race: true  // Include race data (date, weather, etc.)
          },
          orderBy: { createdAt: 'desc' }  // Get most recent first
        },
        _count: { select: { comments: true, proofs: true } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
        // The newest render, for the pipeline status.
        renderJobs: { orderBy: { version: 'desc' }, take: 1, select: { status: true, review: true, error: true, reviewNote: true, sendAfter: true, sendHeldAt: true, sendHeldBy: true, sendError: true, arteloSentAt: true } },
      },
      // The raw Shopify, Etsy and Artelo payloads are about 20MB across all
      // orders and the list reads a handful of keys from them. Pulling them
      // whole on every 30-second refresh blew through the Supabase egress
      // quota, so they are left out here and the few keys come from rawSlice.
      omit: { shopifyOrderData: true, etsyOrderData: true, arteloOrderData: true },
    })
    const slices = await rawSlice(orders.map(o => o.id))
    for (const o of orders) {
      const r = slices.get(o.id)
      o.shopifyOrderData = r?.s ?? null
      o.etsyOrderData = r?.e ?? null
      o.arteloOrderData = r?.a ?? null
    }

    // Product catalog is synced from Shopify and lives in the DB, so load it
    // once here rather than per order.
    const productCatalog = await loadProductCatalog()

    // Race rows by name and year, so an order that has not been researched
    // yet still gets its race date (and weather). Without this the page could
    // not tell a future race from a missing result, and new orders for a race
    // not yet run read "Needs research" until research happened to run. Also
    // what the render pipeline can do right now, for the pipeline status.
    const { raceFor, templateKeys, gaps, workerOnline } = await loadPipelineContext()

    // Transform orders to include flattened research data
    const transformedOrders = orders.map(order => {
      // Get the best research record: prefer 'found', then most recent
      const foundResearch = order.runnerResearch?.find(r => r.researchStatus === 'found')
      const research = foundResearch || order.runnerResearch?.[0]
      // Compute effective values (override if present, else original)
      const effectiveRaceYear = order.yearOverride ?? order.raceYear
      const effectiveRaceName = order.raceNameOverride ?? order.raceName
      const race = research?.race || raceFor(effectiveRaceName, effectiveRaceYear)
      const effectiveRunnerName = order.runnerNameOverride ?? order.runnerName

      // Check if any overrides are present
      const hasOverrides = order.yearOverride !== null ||
                          order.raceNameOverride !== null ||
                          order.runnerNameOverride !== null

      // Detect customer-provided time in runner name (e.g., "John Smith 4:32:15")
      // This catches cases where the time hasn't been stripped yet (existing orders)
      const nameToCheck = effectiveRunnerName || ''
      const timeInNameMatch = nameToCheck.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)
      const timeFromName = timeInNameMatch ? timeInNameMatch[1] : null

      return {
        ...order,
        // Effective values (what to display and use for research)
        effectiveRaceYear,
        effectiveRaceName,
        effectiveRunnerName,
        hasOverrides,
        // Alert flags for runner name field
        timeFromName,
        // The runner's result, from the research record only. A result the
        // customer verified or typed at checkout is a research record too
        // (source customer_verified / customer_supplied), written at import,
        // so there is nothing to fall back to and nothing to merge.
        // The code is the clue for fulfillment; its amount is money (admins only).
        discountCodes: money ? extractDiscountCodes(order) : extractDiscountCodes(order).map(d => ({ ...d, amount: null })),
        bibNumber: research?.bibNumber || null,
        officialTime: formatTime(research?.officialTime),
        officialPace: formatPace(research?.officialPace),
        // Triathlons: each leg as it prints, and whether this order is one.
        isTriathlon: isTriathlon(order),
        swimTime: research?.swimTime || null, swimDistance: research?.swimDistance || null,
        bikeTime: research?.bikeTime || null, bikeDistance: research?.bikeDistance || null,
        runTime: research?.runTime || null, runDistance: research?.runDistance || null,
        // The event: confirmed by research, or assumed from the customer or the product until then.
        ...resolveEvent(research, order, effectiveRaceName),
        researchStatus: research?.researchStatus || null,
        // How the result was obtained: "scraper" | "customer_verified". Drives
        // the dashboard's "Customer-verified" vs "Researched" badge.
        researchSource: research?.source || null,
        // Detailed outcome from the Instant Lookup widget — how the shopper
        // arrived at this result (auto_match, picked_from_list, manual_*).
        lookupOutcome: order.lookupOutcome || null,
        lookupMatchedName: order.lookupMatchedName || null,
        // Storage path only — the dashboard exchanges it for a short-lived
        // signed URL via /api/admin/photo-signed-url when a designer asks. The
        // bucket is private, so this path is not openable on its own.
        photoPath: order.photoPath || null,
        // When a designer confirmed the photo is on the artwork. Gates completion.
        photoPlacedAt: order.photoPlacedAt ? order.photoPlacedAt.toISOString() : null,
        researchNotes: research?.researchNotes || null,
        // Persisted candidate matches — populates the dashboard's accept-button
        // picker for ambiguous orders (so it shows even after page reload, not
        // just immediately after research runs).
        possibleMatches: Array.isArray(research?.possibleMatches) && research.possibleMatches.length > 0
          ? research.possibleMatches
          : null,
        // Race data (Tier 1) - formatted for direct copy to Illustrator
        raceDate: formatRaceDate(race?.raceDate),
        // Raw ISO date (YYYY-MM-DD) for editing — backs the date input in the
        // order detail panel's Race Data edit mode.
        raceDateIso: race?.raceDate ? new Date(race.raceDate).toISOString().slice(0, 10) : null,
        raceLocation: race?.location || null,
        // Where the date came from, for the source link and Verified badge beside it.
        raceDateVerified: race ? dateVerified(race) : false,
        raceDateConfirmedBy: race?.raceDateConfirmedByPerson || null,
        raceDateSourceUrl: race?.raceDateSourceUrl || null,
        raceDateEvidence: race?.raceDateEvidence || null,
        resultsUrl: research?.resultsUrl || buildAustinFallbackUrl(research?.runnerName || effectiveRunnerName, effectiveRaceName, effectiveRaceYear, research?.eventType),
        weatherTemp: formatTemp(race?.weatherTemp),
        weatherCondition: race?.weatherCondition ?
          race.weatherCondition.charAt(0).toUpperCase() + race.weatherCondition.slice(1) : null,
        weatherDetails: race?.weatherDetails || null,
        weatherConfirmedAt: race?.weatherConfirmedAt || null,
        weatherConfirmedBy: race?.weatherConfirmedBy || null,
        raceId: race?.id || null,
        // Scraper availability - use effective race name
        hasScraperAvailable: hasScraperForRace(effectiveRaceName),
        // Trackstar order type and custom order fields
        trackstarOrderType: order.trackstarOrderType,
        designStatus: order.designStatus,
        dueDate: order.dueDate,
        isRushOrder: order.isRushOrder,
        // Ticked "skip the line" but the rush charge is not on the order.
        rushOverride: order.rushOverride,
        rushUnpaid: !order.isRushOrder && rushSelectedNotPaid(order.shopifyOrderData),
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        bibNumberCustomer: order.bibNumberCustomer,
        timeCustomer: order.timeCustomer,
        creativeDirection: order.creativeDirection,
        isGift: order.isGift,
        // The order in Shopify admin, for the order modal's View in Shopify.
        shopifyAdminUrl: ['standard', 'custom'].includes(order.trackstarOrderType) ? shopifyAdminUrl(order.shopifyOrderData?.id) : null,
        etsyOrderUrl: order.source === 'etsy' ? etsyOrderUrl(order.parentOrderNumber) : null,
        arteloUrl: arteloOrderUrl(order.arteloOrderData?.id),
        // Race-partner virtual fields (aliases for existing columns — no schema change)
        partnerName: order.trackstarOrderType === 'race_partner' ? order.raceName : null,
        partnerContactName: order.trackstarOrderType === 'race_partner' ? order.customerName : null,
        // Creator-sample virtual fields — surface shipping so Elí can ship the print
        creatorShipping: order.source === 'creator_sample'
          ? (order.arteloOrderData?.shipping || null)
          : null,
        creatorSampleCreatorId: order.source === 'creator_sample'
          ? (order.arteloOrderData?.creatorId || null)
          : null,
        // Comment count for notes indicator
        commentCount: order._count?.comments || 0,
        assigneeId: order.assigneeId || null,
        assigneeName: order.assignee ? order.assignee.firstName : null,
        // Proof count. For a partner this is also the options-sent count:
        // their portal lists every proof on the order, and there is no
        // separate send step to distinguish (partners have email disabled and
        // get their link by hand, which is why proofSentAt is null on every
        // partner row).
        proofCount: order._count?.proofs || 0,
        // When proofs were last sent (for follow-up tracking)
        proofSentAt: order.proofSentAt,
        // Delay-notice tracking (custom orders) — drives the "delay notice sent" badge
        delayNoticeSentAt: order.delayNoticeSentAt,
        delayNoticeDaysLate: order.delayNoticeDaysLate,
        // Shopify display order number (e.g. "2855") and order date for sorting
        // Bulk runners are BULK-0001-17: the parent alone would name a hundred
        // files the same, so the line number stays in.
        displayOrderNumber: order.shopifyOrderData?.name
          ? String(order.shopifyOrderData.name).replace('#', '')
          : order.trackstarOrderType === 'bulk' ? order.orderNumber : order.parentOrderNumber,
        // Shipping info — expose for expedited badge + callout in dashboard
        shippingMethod: getShippingMethod(order.shopifyOrderData),
        isExpedited: isExpeditedShipping(order.shopifyOrderData),
        // Order total + big-spender flag — for the "💰 BIG SPENDER" prioritize callout
        orderTotalUsd: money ? getOrderTotalUsd(order) : null,
        isBigSpender: isBigSpender(order),
        // A sample: a creator's sample, or an order sent from Tools > Samples (Shopify tag "sample").
        isSample: order.source === 'creator_sample' || String(order.shopifyOrderData?.tags || '').split(',').some(t => t.trim().toLowerCase() === 'sample'),
        bigSpenderThresholdUsd: BIG_SPENDER_THRESHOLD_USD,
        // Which product/design variant Eli should use. Keyed off the stable
        // Shopify product_id (or Etsy listing_id), not the rename-able title.
        // See server/lib/productCatalog.js for the catalog.
        productInfo: getProductInfo(order, productCatalog),
        // Original order date from marketplace (for sorting by when customer placed order)
        orderPlacedAt: order.shopifyOrderData?.created_at
          || (order.etsyOrderData?.create_timestamp
            ? new Date(order.etsyOrderData.create_timestamp * 1000).toISOString()
            : null)
          || order.arteloOrderData?.createdAt
          || null,
        // Keep legacy field for backward compat
        shopifyCreatedAt: order.shopifyOrderData?.created_at || null,
        // Clean up - don't send nested objects to frontend
        runnerResearch: undefined,
        _count: undefined,
        shopifyOrderData: undefined,
        etsyOrderData: undefined,
        arteloOrderData: undefined
      }
    })

    // Sort by marketplace order date (when customer placed the order), not DB import time
    // Standard = newest first, Custom = oldest first (longest-waiting need attention)
    const getOrderDate = (o) => {
      return new Date(o.orderPlacedAt || o.createdAt).getTime()
    }
    if (type === 'custom') {
      transformedOrders.sort((a, b) => getOrderDate(a) - getOrderDate(b))
    } else if (type === 'race_partner') {
      // Race partners: newest first (matches how Matt adds them)
      transformedOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } else {
      transformedOrders.sort((a, b) => getOrderDate(b) - getOrderDate(a))
    }

    // Resolve hero images for Etsy orders (deduped by listing_id). Etsy
    // images live on a separate /listings/{id}/images endpoint — we fetch
    // once per unique listing and cache in-process (24h TTL).
    const etsyListingsNeedingImage = [...new Set(
      transformedOrders
        .filter(o => o.productInfo?.source === 'etsy' && !o.productInfo.heroImageUrl && o.productInfo.productId)
        .map(o => o.productInfo.productId)
    )]
    if (etsyListingsNeedingImage.length > 0) {
      const urlPairs = await Promise.all(
        etsyListingsNeedingImage.map(async id => [id, await getEtsyListingImageUrl(id)])
      )
      const urlMap = Object.fromEntries(urlPairs)
      for (const o of transformedOrders) {
        if (o.productInfo?.source === 'etsy' && !o.productInfo.heroImageUrl) {
          const url = urlMap[o.productInfo.productId]
          if (url) o.productInfo.heroImageUrl = url
        }
      }
    }

    // A photo attached by hand after purchase is unpaid until the Shopify
    // order carries a paid Photo Add-On for it.
    const byParent = new Map()
    for (const o of orders) if (o.photoAddedManually || o.photoPath) {
      if (!byParent.has(o.parentOrderNumber)) byParent.set(o.parentOrderNumber, [])
      byParent.get(o.parentOrderNumber).push(o)
    }
    const unpaid = new Set()
    for (const rows of byParent.values()) {
      if (!rows.some(r => r.photoAddedManually)) continue
      for (const id of unpaidPhotoRows(rows, rows[0].shopifyOrderData)) unpaid.add(id)
    }
    for (const o of transformedOrders) o.photoUnpaid = unpaid.has(o.id)

    // Waiting on a customer's reply to something we asked (Support, "waiting").
    try {
      const open = transformedOrders.filter(o => o.status !== 'completed' && o.customerEmail)
      const waiting = await waitingOnCustomers(open.map(o => o.customerEmail))
      for (const o of open) {
        const since = waiting.get(String(o.customerEmail).trim().toLowerCase())
        if (since) o.waitingOnCustomerSince = since
      }
    } catch (err) { console.warn('[orders] waiting-on-customer lookup failed:', err.message) }

    // One status per order, from everything above (server/domain/orders/pipeline.js).
    const byId = new Map(orders.map(o => [o.id, o]))
    for (const t of transformedOrders) {
      const o = byId.get(t.id)
      if (!o || o.trackstarOrderType !== 'standard') continue
      const research = o.runnerResearch?.find(r => r.researchStatus === 'found') || o.runnerResearch?.[0] || null
      const race = research?.race || raceFor(o.raceNameOverride ?? o.raceName, o.yearOverride ?? o.raceYear)
      t.pipeline = pipelineFor({ order: o, research, race, render: o.renderJobs?.[0] || null, hasScraper: t.hasScraperAvailable, templates: templateKeys, noTimeGaps: gaps, photoUnpaid: t.photoUnpaid, workerOnline })
    }

    return res.status(200).json({ orders: transformedOrders, ...(openOnly ? { completedCount } : {}) })
  } catch (error) {
    console.error('Error:', error)
    return sendPublicError(res, error)
  }
}
