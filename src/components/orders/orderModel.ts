/**
 * The order as the orders page holds it, and the one mapping from the API.
 * Shared by the Dashboard list and the order detail view.
 */

export type DesignStatus = 'not_started' | 'in_progress' | 'awaiting_review' | 'in_revision' | 'approved_by_customer' | 'final_pdf_uploaded' | 'sent_to_production'

export interface Order {
  id: string
  orderNumber: string        // Unique ID for this line item (parentOrderNumber-lineItemIndex)
  parentOrderNumber: string  // Original Shopify/Etsy order number
  lineItemIndex: number      // Which line item this is (0, 1, 2, etc.)
  displayOrderNumber: string // Friendly display number (Shopify order.name like "2585")
  source: 'shopify' | 'etsy' | 'creator_sample'
  raceName: string
  raceYear: number | null
  raceDate?: string
  raceDateIso?: string | null  // ISO YYYY-MM-DD, for the date input in edit mode
  raceDateVerified?: boolean
  raceDateConfirmedBy?: string | null
  weatherConfirmedAt?: string | null
  weatherConfirmedBy?: string | null
  raceDateSourceUrl?: string | null
  raceDateEvidence?: string | null
  raceLocation?: string
  resultsUrl?: string
  eventType?: string
  runnerName: string
  productSize: string
  notes?: string
  hadNoTime?: boolean         // Flag: customer entered "no time"
  timeFromName?: string | null // Time extracted from runner name (customer-provided)
  status: 'pending' | 'ready' | 'flagged' | 'completed' | 'missing_year'
  flagReason?: string
  completedAt?: string
  createdAt: string
  // Runner research data
  bibNumber?: string
  officialTime?: string
  officialPace?: string
  // Triathlons: entered by hand, each leg's time and distance as it prints.
  isTriathlon?: boolean
  swimTime?: string | null
  swimDistance?: string | null
  bikeTime?: string | null
  bikeDistance?: string | null
  runTime?: string | null
  runDistance?: string | null
  researchStatus?: 'found' | 'not_found' | 'ambiguous' | 'no_scraper' | 'year_not_configured' | 'upstream_error' | 'time_unavailable' | 'race_not_run' | null
  // How the result was obtained: scraper vs. customer-confirmed in the widget
  researchSource?: 'scraper' | 'customer_verified' | 'customer_supplied' | 'manual_entry' | 'research_agent' | null
  eventTypeSource?: 'research' | 'customer' | 'product' | null
  // Detailed Instant Lookup widget outcome — how the shopper arrived at their
  // result. See server schema Order.lookupOutcome for the enum.
  lookupOutcome?:
    | 'auto_match'
    | 'picked_from_list'
    | 'manual_no_match'
    | 'manual_lookup_error'
    | 'manual_rate_limited'
    | 'manual_timeout'
    | 'manual_user_choice'
    // Personalization wizard only: it turns a failed lookup into "we'll research
    // it for you" rather than a dead end, so these orders arrive with NO runner
    // data and always need research.
    | 'async_no_match'
    | 'async_timeout'
    | 'async_lookup_error'
    // No scraper exists for this race, so the wizard never searched — it took
    // the shopper's details and moved on. Always needs research.
    | 'no_lookup_available'
    // Shopper hand-edited time / pace / bib on the review screen, so the values
    // are theirs, not an official-results match.
    | 'edited_by_customer'
    // Verified match where the shopper changed only the NAME on the print.
    // Time, pace and bib are still official; the matched name is in
    // lookupMatchedName.
    | 'auto_match_name_edited'
    | 'picked_from_list_name_edited'
    | 'resolved_from_list_name_edited'
    | null
  // The name official results matched, when the shopper printed a different
  // one. Null otherwise.
  lookupMatchedName?: string | null
  // Supabase Storage path of the customer's uploaded photo, or null for the
  // overwhelming majority of orders. Not openable directly: the bucket is
  // private and the dashboard mints a signed URL on demand.
  photoPath?: string | null
  photoAddedManually?: boolean
  photoUnpaid?: boolean
  // When a designer confirmed the photo is on the artwork. Completing a photo
  // order is blocked until this is set.
  photoPlacedAt?: string | null
  // Instant Lookup widget signal: true = customer confirmed an official match,
  // false = customer typed it manually, null/undefined = no widget data
  lookupVerified?: boolean | null
  researchNotes?: string
  // Weather data
  weatherTemp?: string
  weatherCondition?: string
  weatherDetails?: string | null  // JSON breakdown of how weather was calculated
  raceId?: number | null
  // Scraper availability
  hasScraperAvailable?: boolean
  // One status from everything the server knows (server/domain/orders/pipeline.js).
  pipeline?: { stage: 'review' | 'attach' | 'action' | 'needs_research' | 'waiting' | 'done'; reason: string; kind?: 'data' | 'setup' | 'render' | 'artelo'; fix?: string }
  // Override fields
  yearOverride?: number | null
  raceNameOverride?: string | null
  runnerNameOverride?: string | null
  // Effective values (computed by API)
  effectiveRaceYear?: number | null
  effectiveRaceName?: string
  effectiveRunnerName?: string
  hasOverrides?: boolean
  // Trackstar order type and custom order fields
  trackstarOrderType?: 'standard' | 'custom' | 'race_partner' | 'bulk'
  // Partner fields (only populated when trackstarOrderType === 'race_partner').
  // The stored value keeps its 'race_partner' name; only the labels changed,
  // when charities and other co-branded partners joined the same view.
  partnerName?: string | null
  partnerContactName?: string | null
  // Creator sample fields (only populated when source === 'creator_sample')
  creatorShipping?: {
    name?: string | null
    address1?: string | null
    address2?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
    country?: string | null
  } | null
  creatorSampleCreatorId?: string | null
  frameType?: string | null  // Only surfaced for creator-sample callout — Artelo has it baked into other orders
  designStatus?: DesignStatus
  dueDate?: string
  isRushOrder?: boolean
  rushUnpaid?: boolean
  rushOverride?: boolean
  customerEmail?: string
  customerName?: string
  bibNumberCustomer?: string
  timeCustomer?: string
  creativeDirection?: string
  isGift?: boolean
  /** The order in Shopify admin; null for Etsy and hand-made orders. */
  shopifyAdminUrl?: string | null
  etsyOrderUrl?: string | null
  arteloUrl?: string | null
  commentCount?: number
  assigneeId?: string | null
  assigneeName?: string | null
  proofCount?: number
  proofSentAt?: string | null
  delayNoticeSentAt?: string | null
  delayNoticeDaysLate?: number | null
  shopifyCreatedAt?: string | null
  orderPlacedAt?: string | null
  /** Discount codes used at checkout. Intended to drive co-branded designs. */
  discountCodes?: { code: string; type: string | null; amount: string | null }[]
  // Shipping
  shippingMethod?: string | null
  isExpedited?: boolean
  // When we last wrote to this customer in Support and are still waiting on a reply.
  waitingOnCustomerSince?: string | null
  // Big-spender flag — true if order total > $300 (configurable on backend)
  orderTotalUsd?: number | null
  isBigSpender?: boolean
  isSample?: boolean
  bigSpenderThresholdUsd?: number
  // Which Shopify/Etsy product was ordered — drives which design template
  // Eli uses (e.g. regular Boston print vs Boston World Major poster).
  productInfo?: {
    source: 'shopify' | 'etsy'
    productId: string
    productIdLabel: string  // "Shopify product ID" or "Etsy listing ID"
    variantId: string | null
    rawTitle: string | null
    designVariant: string | null
    label: string | null
    heroImageUrl: string | null
    inCatalog: boolean
    catalogRequired: boolean
  } | null
}

export interface OrderComment {
  id: string
  orderId: string
  text: string | null
  imageUrl: string | null
  createdAt: string
  /** Denormalised at write time, so it survives the author's account being deleted. */
  authorName: string | null
  authorId: string | null
}

// Design status display config
export const DESIGN_STATUS_CONFIG: Record<DesignStatus, { dot: string; label: string; color: string; bgColor: string }> = {
  not_started: { dot: 'bg-off-black/30', label: 'Not Started', color: 'text-off-black/55', bgColor: 'bg-off-black/5' },
  in_progress: { dot: 'bg-blue-500', label: 'In Progress', color: 'text-blue-700', bgColor: 'bg-blue-50' },
  awaiting_review: { dot: 'bg-amber-500', label: 'Awaiting Review', color: 'text-amber-700', bgColor: 'bg-amber-50' },
  in_revision: { dot: 'bg-orange-500', label: 'In Revision', color: 'text-orange-700', bgColor: 'bg-orange-50' },
  approved_by_customer: { dot: 'bg-purple-500', label: 'Approved by Customer', color: 'text-purple-700', bgColor: 'bg-purple-50' },
  final_pdf_uploaded: { dot: 'bg-[#4600D6]', label: 'Attach in Artelo', color: 'text-[#4600D6]', bgColor: 'bg-[#4600D6]/[0.06]' },
  sent_to_production: { dot: 'bg-emerald-500', label: 'Sent to Production', color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
}

/** Partner orders are approved by the partner, not a customer. Same status, different word. */
export function designLabel(status: string | null | undefined, orderType?: string | null) {
  const cfg = DESIGN_STATUS_CONFIG[(status || 'not_started') as DesignStatus] || DESIGN_STATUS_CONFIG.not_started
  return orderType === 'race_partner' ? cfg.label.replace('Customer', 'Partner') : cfg.label
}

/**
 * The statuses a person may pick by hand.
 *
 * A partner order's design work ends at Approved by Partner. What follows,
 * Dan's production file and the handoff to Eli, is the checklist's job and
 * sets the last two itself, so offering them here only invites a status
 * nobody acted on. An order already past that keeps its own value listed.
 */
export function selectableDesignStatuses(orderType?: string | null, current?: string | null): DesignStatus[] {
  const all = Object.keys(DESIGN_STATUS_CONFIG) as DesignStatus[]
  if (orderType !== 'race_partner') return all
  const upToApproval = all.slice(0, all.indexOf('approved_by_customer') + 1)
  return upToApproval.includes(current as DesignStatus) || !current ? upToApproval : [...upToApproval, current as DesignStatus]
}

/** The address of an order: its display number, plus -2, -3 for later line items (the file-name convention). */
export function orderRefOf(o: Order): string {
  const n = String(o.displayOrderNumber || o.parentOrderNumber || '').replace(/^#/, '')
  return o.lineItemIndex ? `${n}-${o.lineItemIndex + 1}` : n
}

/**
 * Map one raw API order onto the Order shape.
 *
 * There is exactly one of these on purpose. This mapping used to be copy
 * pasted into fetchOrders and both research handlers, and the copies drifted:
 * the research ones silently dropped photoPath, productInfo, lookupOutcome,
 * raceId and 19 other fields, so finishing research wiped the photo callout,
 * the tags and half the product card off the open modal. Add new fields here
 * and every caller gets them.
 */
export function mapOrder(order: Record<string, unknown>): Order {
  return {
    id: order.id as string,
    orderNumber: order.orderNumber as string,
    parentOrderNumber: order.parentOrderNumber as string,
    lineItemIndex: order.lineItemIndex as number,
    displayOrderNumber: (order.displayOrderNumber as string) || (order.parentOrderNumber as string),
    source: order.source as 'shopify' | 'etsy',
    raceName: order.raceName as string,
    raceYear: order.raceYear as number | null,
    raceDate: order.raceDate as string | undefined,
    raceDateIso: order.raceDateIso as string | null | undefined,
    raceDateVerified: order.raceDateVerified as boolean | undefined,
    raceDateConfirmedBy: (order.raceDateConfirmedBy as string | null | undefined) ?? null,
    weatherConfirmedAt: order.weatherConfirmedAt as string | null | undefined,
    weatherConfirmedBy: order.weatherConfirmedBy as string | null | undefined,
    raceDateSourceUrl: order.raceDateSourceUrl as string | null | undefined,
    raceDateEvidence: order.raceDateEvidence as string | null | undefined,
    raceLocation: order.raceLocation as string | undefined,
    runnerName: order.runnerName as string,
    productSize: order.productSize as string,
    notes: order.notes as string | undefined,
    status: order.status as 'pending' | 'ready' | 'flagged' | 'completed' | 'missing_year',
    createdAt: order.createdAt as string,
    completedAt: order.researchedAt as string | undefined,
    // Research data
    bibNumber: order.bibNumber as string | undefined,
    officialTime: order.officialTime as string | undefined,
    officialPace: order.officialPace as string | undefined,
    isTriathlon: Boolean(order.isTriathlon),
    swimTime: (order.swimTime as string | null) ?? null, swimDistance: (order.swimDistance as string | null) ?? null,
    bikeTime: (order.bikeTime as string | null) ?? null, bikeDistance: (order.bikeDistance as string | null) ?? null,
    runTime: (order.runTime as string | null) ?? null, runDistance: (order.runDistance as string | null) ?? null,
    eventType: order.eventType as string | undefined,
    researchStatus: order.researchStatus as 'found' | 'not_found' | 'ambiguous' | 'no_scraper' | 'year_not_configured' | 'upstream_error' | 'time_unavailable' | 'race_not_run' | null,
    researchNotes: order.researchNotes as string | undefined,
    resultsUrl: order.resultsUrl as string | undefined,
    // Weather
    weatherTemp: order.weatherTemp as string | undefined,
    weatherCondition: order.weatherCondition as string | undefined,
    weatherDetails: order.weatherDetails as string | null | undefined,
    raceId: order.raceId as number | null | undefined,
    // Scraper
    hasScraperAvailable: order.hasScraperAvailable as boolean | undefined,
    pipeline: order.pipeline as Order['pipeline'],
    // Override fields
    yearOverride: order.yearOverride as number | null | undefined,
    raceNameOverride: order.raceNameOverride as string | null | undefined,
    runnerNameOverride: order.runnerNameOverride as string | null | undefined,
    // Effective values
    effectiveRaceYear: order.effectiveRaceYear as number | null | undefined,
    effectiveRaceName: order.effectiveRaceName as string | undefined,
    effectiveRunnerName: order.effectiveRunnerName as string | undefined,
    hasOverrides: order.hasOverrides as boolean | undefined,
    // Custom order fields
    trackstarOrderType: order.trackstarOrderType as 'standard' | 'custom' | 'race_partner' | 'bulk' | undefined,
    designStatus: order.designStatus as DesignStatus | undefined,
    dueDate: order.dueDate as string | undefined,
    isRushOrder: order.isRushOrder as boolean | undefined,
    rushUnpaid: order.rushUnpaid as boolean | undefined,
    rushOverride: order.rushOverride as boolean | undefined,
    customerEmail: order.customerEmail as string | undefined,
    customerName: order.customerName as string | undefined,
    bibNumberCustomer: order.bibNumberCustomer as string | undefined,
    timeCustomer: order.timeCustomer as string | undefined,
    creativeDirection: order.creativeDirection as string | undefined,
    isGift: order.isGift as boolean | undefined,
    shopifyAdminUrl: order.shopifyAdminUrl as string | null | undefined,
    etsyOrderUrl: order.etsyOrderUrl as string | null | undefined,
    arteloUrl: order.arteloUrl as string | null | undefined,
    partnerName: order.partnerName as string | null | undefined,
    partnerContactName: order.partnerContactName as string | null | undefined,
    creatorShipping: order.creatorShipping as Order['creatorShipping'],
    creatorSampleCreatorId: order.creatorSampleCreatorId as string | null | undefined,
    // Frame type — only surfaced in the creator-sample callout. For regular
    // orders Artelo has it baked in, so we don't show it elsewhere.
    frameType: order.frameType as string | null | undefined,
    // Alert flags
    hadNoTime: order.hadNoTime as boolean | undefined,
    timeFromName: order.timeFromName as string | null | undefined,
    // Marketplace order date for sorting
    shopifyCreatedAt: order.shopifyCreatedAt as string | null | undefined,
    orderPlacedAt: order.orderPlacedAt as string | null | undefined,
    discountCodes: order.discountCodes as Order['discountCodes'],
    // Shipping (for expedited badge / callout)
    shippingMethod: order.shippingMethod as string | null | undefined,
    isExpedited: order.isExpedited as boolean | undefined,
    waitingOnCustomerSince: order.waitingOnCustomerSince as string | null | undefined,
    // Big-spender (>= $300) badge + prioritize callout
    orderTotalUsd: order.orderTotalUsd as number | null | undefined,
    isBigSpender: order.isBigSpender as boolean | undefined,
    isSample: order.isSample as boolean | undefined,
    bigSpenderThresholdUsd: order.bigSpenderThresholdUsd as number | undefined,
    // Which product was ordered → drives design variant
    productInfo: order.productInfo as Order['productInfo'],
    // Custom-order delay notice — drives the "delay notice sent" badge
    delayNoticeSentAt: order.delayNoticeSentAt as string | null | undefined,
    delayNoticeDaysLate: order.delayNoticeDaysLate as number | null | undefined,
    // Instant Lookup / wizard provenance. This transform is a whitelist,
    // not a spread, so anything missing here is silently dropped no matter
    // what the API returns — these drive the "Customer-verified" badge and
    // the outcome chip, which is why neither had ever appeared.
    researchSource: order.researchSource as Order['researchSource'],
    eventTypeSource: order.eventTypeSource as Order['eventTypeSource'],
    lookupVerified: order.lookupVerified as boolean | null | undefined,
    lookupOutcome: order.lookupOutcome as Order['lookupOutcome'],
    lookupMatchedName: order.lookupMatchedName as string | null | undefined,
    // Personalization photo — drives the photo chip, View Photo and the
    // placement sign-off that gates completion.
    photoPath: order.photoPath as string | null | undefined,
    photoAddedManually: order.photoAddedManually as boolean | undefined,
    photoUnpaid: order.photoUnpaid as boolean | undefined,
    photoPlacedAt: order.photoPlacedAt as string | null | undefined,
    // Counts and send timestamps. The API has always returned these and this
    // whitelist has always dropped them, so everything downstream read
    // undefined: the partner list's options column, the notes-and-comments
    // icon, the proof count beside "Proofs & Approval", and the follow-up
    // warnings that count days since a send. None of them were broken; they
    // were never receiving a number.
    commentCount: order.commentCount as number | undefined,
    assigneeId: (order.assigneeId as string | null | undefined) ?? null,
    assigneeName: (order.assigneeName as string | null | undefined) ?? null,
    proofCount: order.proofCount as number | undefined,
    proofSentAt: order.proofSentAt as string | null | undefined,
  }
}

/** Which orders are on screen: ?view=custom | partners | bulk, standard by default. */
export type ActiveView = 'standard' | 'custom' | 'race_partner' | 'bulk'

/** A suggested runner for an ambiguous or not-found result (not persisted to the DB). */
export type PossibleMatch = { name: string; bib: string; time: string; pace?: string; city?: string; state?: string; eventType?: string; resultsUrl?: string }

/**
 * The runner edit: the name plus the result itself. Race name and year are
 * not editable: they come straight off the order.
 */
export type EditValues = {
  runnerNameOverride: string
  bibNumber: string
  officialTime: string
  officialPace: string
  // Triathlon legs; absent on every other order.
  swimTime?: string; swimDistance?: string; bikeTime?: string; bikeDistance?: string; runTime?: string; runDistance?: string
}
