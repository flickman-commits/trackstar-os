/**
 * Shop orders that never reached TrackstarOS.
 *
 * The import reads Artelo's 100 newest orders across every store, once a
 * run, with no paging (processOrders.js). An order pushed past position 100
 * between two runs (a big bulk run, an hour's outage at a busy time) is never
 * imported, and nothing else would notice. This asks Shopify instead: every
 * paid online-store order from the last two days that needs shipping, against
 * the orders here (Order.parentOrderNumber is the Shopify order id). Each
 * missing order is posted to #admin-alerts once.
 *
 * Etsy is not covered yet.
 */
import prisma from '../../db.js'
import { shopifyFetch } from '../../services/shopifyAuth.js'
import { slackTo, slackText } from '../../lib/slack.js'

const HOUR = 60 * 60_000
const REPORTED_KEY = 'missing_orders_reported'

/**
 * Should this Shopify order be in TrackstarOS by now? Pure.
 * Online store checkouts only (bulk orders are draft orders and live under
 * their BULK number), not cancelled, paid, and with something to ship.
 */
export function expectedInTool(o) {
  if (!o || o.cancelled_at) return false
  if (o.source_name !== 'web') return false
  if (!['paid', 'partially_refunded'].includes(o.financial_status)) return false
  return (o.line_items || []).some(li => li.requires_shipping && !li.gift_card)
}

/** Shopify orders created between `from` and `to`, paged by id (250 a page, at most 10 pages). */
async function shopifyOrdersBetween(from, to) {
  const out = []
  let since = 0
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ status: 'any', created_at_min: from.toISOString(), created_at_max: to.toISOString(), limit: '250', since_id: String(since), fields: 'id,name,created_at,source_name,cancelled_at,financial_status,line_items' })
    const data = await shopifyFetch(`/orders.json?${q}`)
    const orders = data?.orders || []
    out.push(...orders)
    if (orders.length < 250) break
    since = Math.max(...orders.map(o => Number(o.id)))
  }
  return out
}

/**
 * Check the last `days` days, leaving out the newest `settleHours` (Artelo
 * takes a while to pick an order up, and the import runs every ten minutes).
 */
export async function checkMissingOrders({ days = 2, settleHours = 2, now = new Date() } = {}) {
  const orders = await shopifyOrdersBetween(new Date(now.getTime() - days * 24 * HOUR), new Date(now.getTime() - settleHours * HOUR))
  const expected = orders.filter(expectedInTool)
  if (!expected.length) return { checked: orders.length, expected: 0, missing: 0, posted: 0 }
  const ids = expected.map(o => String(o.id))
  const here = await prisma.order.findMany({ where: { parentOrderNumber: { in: ids } }, select: { parentOrderNumber: true }, distinct: ['parentOrderNumber'] })
  const have = new Set(here.map(r => r.parentOrderNumber))
  const missing = expected.filter(o => !have.has(String(o.id)))

  const row = await prisma.systemConfig.findUnique({ where: { key: REPORTED_KEY } })
  let reported = []
  try { reported = JSON.parse(row?.value || '[]') } catch { reported = [] }
  const fresh = missing.filter(o => !reported.includes(String(o.id)))
  if (fresh.length) {
    const lines = fresh.slice(0, 20).map(o => `• ${slackText(o.name)} (${o.created_at.slice(0, 10)}): ${slackText((o.line_items || []).map(li => li.title).join(', '), 150)}`)
    await slackTo('admin', [
      `:mag: *${fresh.length} paid shop order${fresh.length === 1 ? ' is' : 's are'} not in TrackstarOS* (checked against Shopify for the last ${days} days).`,
      ...lines,
      fresh.length > 20 ? `…and ${fresh.length - 20} more.` : null,
      'Check each is in Artelo. If it is, Import now in TrackstarOS; if it was meant to be made outside Artelo, ignore it.',
    ].filter(Boolean).join('\n')).catch(() => {})
    const value = JSON.stringify([...reported, ...fresh.map(o => String(o.id))].slice(-500))
    await prisma.systemConfig.upsert({ where: { key: REPORTED_KEY }, update: { value }, create: { key: REPORTED_KEY, value } })
  }
  return { checked: orders.length, expected: expected.length, missing: missing.length, posted: fresh.length }
}
