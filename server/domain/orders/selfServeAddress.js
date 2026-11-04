/**
 * The customer changes their own shipping address from the link in the
 * Shopify order confirmation ("Shipped it to the wrong place?"), within
 * CHANGE_WINDOW_HOURS of ordering and before any print on the order has gone
 * to production. The change is the one Support makes (actions.shippingAddress):
 * the Shopify order and our rows, and Artelo follows Shopify until the order
 * is sent. Shopify orders only; Etsy is winding down.
 *
 * After the window, or once a print has gone, the page only says it is too
 * late to change; nothing else happens.
 */
import prisma from '../../db.js'
import { shippingAddress } from '../support/actions.js'
import { CHANGE_WINDOW_HOURS, placedAt, windowEndsAt, linkIsValid } from './changeWindow.js'
import { slackTo, slackText } from '../../lib/slack.js'

export class SelfServeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}

async function load(shopifyOrderId, signature) {
  const id = String(shopifyOrderId || '').trim()
  if (!/^\d{6,20}$/.test(id) || !linkIsValid(id, signature)) throw new SelfServeError('bad_link', 404)
  const rows = await prisma.order.findMany({
    where: { source: 'shopify', parentOrderNumber: id },
    orderBy: { lineItemIndex: 'asc' },
    select: { id: true, status: true, designStatus: true, trackingNumber: true, runnerName: true, raceName: true, raceYear: true, productSize: true, frameType: true, shopifyOrderData: true, arteloOrderData: true, createdAt: true, renderJobs: { where: { arteloSentAt: { not: null } }, select: { id: true }, take: 1 } },
  })
  if (!rows.length) throw new SelfServeError('not_found', 404)
  return { id, rows }
}

/** Why it can no longer change, or null while it still can. */
function closedReason(rows, now = new Date()) {
  const first = rows[0]
  if (first.shopifyOrderData?.cancelled_at) return 'cancelled'
  if (rows.some(r => r.trackingNumber)) return 'shipped'
  if (rows.some(r => r.renderJobs.length || r.designStatus === 'sent_to_production')) return 'in_production'
  const ends = windowEndsAt(first)
  if (!ends || now >= ends) return 'window'
  return null
}

function shipToOf(row) {
  const s = row.shopifyOrderData?.shipping_address
  if (s) return { name: s.name || [s.first_name, s.last_name].filter(Boolean).join(' '), address1: s.address1 || '', address2: s.address2 || '', city: s.city || '', province: s.province_code || '', zip: s.zip || '', country: s.country_code || 'US', phone: s.phone || '' }
  const a = row.arteloOrderData?.customerAddress
  if (a) return { name: a.name || '', address1: a.street1 || '', address2: a.street2 || '', city: a.city || '', province: '', zip: a.zipcode || '', country: a.countryCode || 'US', phone: a.phone || '' }
  return null
}

/** What the page shows. */
export async function selfServeInfo(shopifyOrderId, signature) {
  const { rows } = await load(shopifyOrderId, signature)
  const first = rows[0]
  const reason = closedReason(rows)
  return {
    number: String(first.shopifyOrderData?.name || '').replace(/^#/, '') || null,
    prints: rows.map(r => [r.raceName, r.raceYear].filter(Boolean).join(' ') + (r.runnerName ? `, ${r.runnerName}` : '') + (r.productSize ? ` · ${r.productSize}` : '')),
    shipTo: shipToOf(first),
    canChange: !reason,
    reason,
    placedAt: placedAt(first),
    windowHours: CHANGE_WINDOW_HOURS,
    closesAt: windowEndsAt(first),
  }
}

/** Save the new address, if it is still allowed. */
export async function selfServeUpdate(shopifyOrderId, signature, address) {
  const { id, rows } = await load(shopifyOrderId, signature)
  const reason = closedReason(rows)
  if (reason) throw new SelfServeError(reason === 'window' ? 'too_late' : reason, 409)
  let out
  try {
    out = await shippingAddress({ thread: null, shopifyOrderId: id, address, actor: null, source: 'customer' })
  } catch (e) {
    // Shopify refusing the address (a bad zip) is the customer's to fix; say it.
    if (e?.expose || e?.name === 'UserError') { const err = new SelfServeError('bad_address', 400); err.detail = String(e.message || '').replace(/^Shopify would not take that address: /, ''); throw err }
    throw e
  }
  // The team hears about it, and about any tax Shopify recalculated.
  await slackTo('alerts', `:round_pushpin: Customer changed the ship-to on *#${slackText(out.number)}* from their confirmation email: ${slackText(out.pasted.replace(/\n/g, ', '), 300)}${out.taxNote ? `\n${slackText(out.taxNote, 300)}` : ''}`).catch(() => {})
  return { ok: true, number: out.number, shipTo: out.address }
}
