/**
 * Storefront stats, computed from Shopify orders rather than our own database.
 *
 * Our Order rows are one per printed ITEM and only exist for orders we have
 * imported, so they are the wrong denominator for anything expressed as "what
 * share of orders". Shopify is the source of truth for what was actually
 * bought, so these read from it directly.
 *
 * ─── Adding a metric ───
 *
 * Add one object to METRICS. It gets the same already-fetched, already-filtered
 * order list every other metric sees and returns a numerator, a denominator and
 * a note. Nothing else needs touching - the endpoint and the dashboard both
 * iterate whatever is in the list.
 *
 * ─── Denominators ───
 *
 *   Gift rate. The order's Shopify TAG, over every order in the window. An
 *   earlier version read a line-item "Gift" property, which is how the store
 *   used to record this and is no longer the source of truth. The tag is set
 *   per order and needs no interpretation - a blank property once forced a
 *   choice between 66% and 84% depending on how you read a non-answer, and this
 *   has no such ambiguity.
 *
 *   Photo add-on. Orders containing the "Photo Add-On" product, over every
 *   order placed since the add-on went live. Matched by TITLE because that
 *   product carries no SKU.
 *
 *   There is deliberately no eligibility test. An earlier version tried to
 *   filter the denominator to "orders containing a print", first by SKU pattern
 *   and then by title. The SKU pattern was not reliable - prints are usually
 *   `...-s1p-...` but Personalized Chicago ships as plain `chi` - and in
 *   practice essentially every order contains a print anyway, so the filter
 *   excluded nothing while adding a way to be wrong. Every order counts.
 *
 *   The denominator IS clamped to the launch date, which is a different thing:
 *   orders placed before the add-on existed could not have bought it, and
 *   leaving them in makes the rate read low for no reason.
 */

import { shopifyFetch } from './shopifyAuth.js'

/** The business runs on Eastern time, so "today" means today in New York. */
const BUSINESS_TZ = 'America/New_York'

export const RANGES = {
  today: { label: 'Today', days: 0 },
  yesterday: { label: 'Yesterday', days: 0 },
  '7d': { label: 'Past 7 days', days: 7 },
  '30d': { label: 'Past 30 days', days: 30 },
  '90d': { label: 'Past 90 days', days: 90 },
}

/**
 * Midnight in the business timezone, N days ago, as a Date. Worked out from
 * the timezone's own offset on that date, so it is right whatever timezone
 * the server runs in (Vercel is UTC, a laptop is Eastern) and across a DST
 * change. It used to read the server's offset too, which put "today" at 7pm
 * the evening before on Vercel and 10am on an Eastern laptop.
 */
function businessMidnight(daysAgo = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = t => Number(parts.find(p => p.type === t).value)
  // That date's midnight read as if it were UTC, then moved by the zone's offset at that moment.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day') - daysAgo)
  const wall = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(asUtc))
  const w = t => Number(wall.find(p => p.type === t).value)
  const offset = Date.UTC(w('year'), w('month') - 1, w('day'), w('hour'), w('minute')) - asUtc
  return new Date(asUtc - offset)
}

export function rangeWindow(key) {
  const now = new Date()
  if (key === 'today') return { since: businessMidnight(0), until: now }
  if (key === 'yesterday') return { since: businessMidnight(1), until: businessMidnight(0) }
  const days = RANGES[key]?.days ?? 30
  return { since: new Date(now.getTime() - days * 86400000), until: now }
}

/* ── line-item helpers, derived from what the store actually sends ─────── */

/**
 * The paid photo add-on. Matched on title: when a shopper takes it, Shopify
 * adds a line item literally called "Photo Add-On", and that product carries no
 * SKU to match on instead.
 */
export const isPhotoAddon = li => /^photo\s*add-?on$/i.test(String(li?.title || '').trim())

/**
 * When the Photo Add-On went on sale publicly.
 *
 * Orders before this could not have bought it, so they are dropped from that
 * metric's denominator. Without the clamp a 90-day window reports 9% when the
 * real take-up since launch is roughly double.
 */
export const PHOTO_ADDON_LAUNCH = '2026-07-26'

/** The order's calendar date in the business timezone, as YYYY-MM-DD. */
const businessDate = iso =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))

/* ── the metrics ──────────────────────────────────────────────────────── */

export const METRICS = [
  {
    key: 'gift_rate',
    label: 'Gifting rate',
    unit: '%',
    describe: 'Share of orders tagged "gift" in Shopify.',
    compute(orders) {
      const gifts = orders.filter(o =>
        String(o.tags || '')
          .split(',')
          .some(t => t.trim().toLowerCase() === 'gift')
      ).length
      return {
        numerator: gifts,
        denominator: orders.length,
        detail: `${gifts} of ${orders.length} orders`,
        note: null,
      }
    },
  },
  {
    key: 'photo_addon_rate',
    label: 'Photo add-on take rate',
    unit: '%',
    describe: 'Share of orders that bought the Photo Add-On, counting only orders placed since it launched.',
    compute(orders) {
      // Every order counts, except those placed before the add-on existed.
      const since = orders.filter(o => businessDate(o.created_at) >= PHOTO_ADDON_LAUNCH)
      const took = since.filter(o => (o.line_items || []).some(isPhotoAddon)).length
      const excluded = orders.length - since.length
      return {
        numerator: took,
        denominator: since.length,
        detail: `${took} of ${since.length} orders`,
        note: excluded
          ? `${excluded} order${excluded === 1 ? '' : 's'} placed before the add-on launched on ${PHOTO_ADDON_LAUNCH} are left out, since they could not have bought it.`
          : null,
      }
    },
  },
]

/* ── fetching ─────────────────────────────────────────────────────────── */

/**
 * Every order in the window, following pagination.
 *
 * Cancelled and test orders are dropped: neither is a real purchase, and
 * leaving them in quietly moves every percentage on the page.
 */
async function fetchOrders({ since, until }) {
  const fields = 'id,name,created_at,cancelled_at,test,tags,line_items,financial_status'
  let endpoint =
    `/orders.json?status=any&limit=250&fields=${fields}` +
    `&created_at_min=${since.toISOString()}&created_at_max=${until.toISOString()}`

  const all = []
  // A hard page cap so a bad window can never walk the whole store.
  for (let page = 0; page < 10 && endpoint; page++) {
    const data = await shopifyFetch(endpoint)
    all.push(...(data.orders || []))
    endpoint = data.orders?.length === 250
      ? `/orders.json?status=any&limit=250&fields=${fields}` +
        `&created_at_min=${since.toISOString()}&created_at_max=${until.toISOString()}` +
        `&since_id=${data.orders[data.orders.length - 1].id}`
      : null
  }
  return all.filter(o => !o.cancelled_at && !o.test)
}

/** Short-lived cache: the dashboard re-asks on every range flip. */
const cache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function computeStats(rangeKey = '30d') {
  const key = RANGES[rangeKey] ? rangeKey : '30d'
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true }

  const window = rangeWindow(key)
  const orders = await fetchOrders(window)

  const value = {
    range: key,
    rangeLabel: RANGES[key].label,
    since: window.since.toISOString(),
    until: window.until.toISOString(),
    orderCount: orders.length,
    metrics: METRICS.map(m => {
      const r = m.compute(orders)
      return {
        key: m.key,
        label: m.label,
        unit: m.unit,
        describe: m.describe,
        // Null rather than 0 when there is nothing to divide by, so the UI can
        // stay quiet instead of printing a confident 0%.
        value: r.denominator > 0 ? Math.round((r.numerator / r.denominator) * 100) : null,
        numerator: r.numerator,
        denominator: r.denominator,
        detail: r.detail,
        note: r.note,
      }
    }),
    computedAt: new Date().toISOString(),
    cached: false,
  }
  cache.set(key, { at: Date.now(), value })
  return value
}
