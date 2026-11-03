/**
 * Race payouts: what each partnered race is owed from its prints.
 *
 * Attio is the source of truth for the deal: the race date, the terms
 * (rev_share_pct, default 15; or payout_per_order for a flat fee), the
 * contact, the contract. The window is the race's own purchase cycle, 15
 * days before race day to 30 days after, and the payout is due 30 days
 * after the race (the race-payouts runbook). Sales come from Shopify: every
 * order in the window, the line items that are that race's products, net of
 * discounts and refunds.
 *
 * Postgres keeps machinery only, in SystemConfig under race_payout:<dealId>:
 * the last computed sales and the status (pending -> sent -> paid). Nothing
 * here duplicates an Attio field.
 */
import prisma from '../../db.js'
import { loadDeals, getDeal, patchDeal, isAttioConfigured } from '../sales/attio.js'
import { shopifyFetch } from '../../services/shopifyAuth.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { addDays, daysBetween, isValidDay, todayET, dayLabel } from './periods.js'

export class RacePayoutError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const DAYS_BEFORE = 15
export const DAYS_AFTER = 30
export const DUE_DAYS = 30
export const DEFAULT_PCT = 15
const KEY = id => `race_payout:${id}`
const TZ = 'America/New_York'

/** Midnight at the start of a day, Eastern, as an instant. */
function etStart(day) {
  const guess = new Date(`${day}T05:00:00Z`)
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(guess).find(p => p.type === 'timeZoneName')?.value
  return new Date(`${day}T${tzName === 'EDT' ? '04' : '05'}:00:00Z`)
}

function raceDay(d) {
  if (!d) return null
  const s = String(d).slice(0, 10)
  return isValidDay(s) ? s : null
}

/** The terms, from the deal. Flat fee wins when the workspace has one set. */
export function termsFor(deal) {
  const per = Number(deal.payoutPerOrder)
  if (deal.payoutPerOrder != null && Number.isFinite(per) && per > 0) return { structure: 'per_order', perOrderCents: Math.round(per * 100), pct: null, assumed: false }
  const pct = Number(deal.revSharePct)
  if (deal.revSharePct != null && Number.isFinite(pct) && pct > 0) return { structure: 'percent', pct, perOrderCents: null, assumed: false }
  return { structure: 'percent', pct: DEFAULT_PCT, perOrderCents: null, assumed: true }
}

export function payoutCents(terms, { netSalesCents, unitsSold }) {
  return terms.structure === 'per_order' ? unitsSold * terms.perOrderCents : Math.round(netSalesCents * (terms.pct / 100))
}

async function loadState(dealIds) {
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: dealIds.map(KEY) } } })
  const out = {}
  for (const r of rows) { try { out[r.key.slice('race_payout:'.length)] = JSON.parse(r.value) } catch { /* skip */ } }
  return out
}
async function saveState(dealId, state) {
  const value = JSON.stringify(state)
  await prisma.systemConfig.upsert({ where: { key: KEY(dealId) }, update: { value }, create: { key: KEY(dealId), value } })
  return state
}

function view(deal, state, today) {
  const date = raceDay(deal.raceDate)
  const terms = termsFor(deal)
  const poc = deal.people?.[0] || null
  const window = date ? { start: addDays(date, -DAYS_BEFORE), end: addDays(date, DAYS_AFTER) } : null
  const dueDate = date ? addDays(date, DUE_DAYS) : null
  const sales = state?.sales || null
  return {
    dealId: deal.id, name: deal.name, stage: deal.stage, raceDate: date, window, dueDate,
    daysToDue: dueDate ? daysBetween(today, dueDate) : null,
    windowClosed: window ? window.end < today : false,
    terms, poc: poc ? { name: [poc.firstName, poc.lastName].filter(Boolean).join(' ') || poc.name || null, email: poc.email || null } : null,
    contractUrl: deal.contractUrl || null, webUrl: deal.webUrl || null, runners: deal.runners || null,
    status: state?.status || 'pending', sales, payoutCents: sales ? payoutCents(state.termsUsed || terms, sales) : null, termsUsed: state?.termsUsed || null,
    sentAt: state?.sentAt || null, paidAt: state?.paidAt || null, paidRef: state?.paidRef || null, note: state?.note || null,
  }
}

/** Every won race deal, soonest due first, with its state. */
export async function listRacePayouts({ today = todayET() } = {}) {
  if (!isAttioConfigured()) throw new RacePayoutError('Attio is not connected, and the deals live there.', 503)
  const deals = (await loadDeals()).filter(d => d.motion === 'Race' && d.stage === 'Won')
  const state = await loadState(deals.map(d => d.id))
  const rows = deals.map(d => view(d, state[d.id], today))
  const order = r => (r.status === 'paid' ? 3 : r.status === 'sent' ? 2 : r.dueDate ? (r.dueDate <= today ? 0 : 1) : 1)
  rows.sort((a, b) => order(a) - order(b) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
  return rows
}

/** The Shopify products that are this race's prints. */
async function productsFor(deal) {
  const canonical = getCanonicalRaceName(deal.name)
  let products = canonical ? await prisma.shopifyProduct.findMany({ where: { raceCanonical: canonical }, select: { productId: true, title: true } }) : []
  if (!products.length) {
    // No scraper config for this race: match the product titles on the deal's words.
    const words = String(deal.name).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 2 && !['the', 'marathon', 'half', 'race', 'run', 'and'].includes(w))
    const all = await prisma.shopifyProduct.findMany({ select: { productId: true, title: true } })
    products = all.filter(p => { const t = p.title.toLowerCase(); return words.length && words.every(w => t.includes(w)) })
  }
  return { canonical, products }
}

/** Every order in the window, with line items and refunds, following the Link header page by page. */
export async function ordersIn(window) {
  const since = etStart(window.start), until = etStart(addDays(window.end, 1))
  const fields = 'id,name,created_at,cancelled_at,test,line_items,refunds,financial_status'
  let endpoint = `/orders.json?status=any&limit=250&fields=${fields}&created_at_min=${since.toISOString()}&created_at_max=${until.toISOString()}`
  const all = []
  for (let page = 0; page < 60 && endpoint; page++) {
    const { data, next } = await shopifyFetch(endpoint, { withLink: true })
    all.push(...(data.orders || []))
    endpoint = next
  }
  return all.filter(o => !o.cancelled_at && !o.test)
}

/** Pull the race's sales from Shopify and keep them. */
export async function computeRacePayout(dealId, { today = todayET() } = {}) {
  const deal = await getDeal(dealId, { fresh: true })
  if (!deal) throw new RacePayoutError('No such deal in Attio', 404)
  const date = raceDay(deal.raceDate)
  if (!date) throw new RacePayoutError(`${deal.name} has no race date in Attio. Set race_date on the deal first.`)
  const { canonical, products } = await productsFor(deal)
  if (!products.length) throw new RacePayoutError(`No Shopify product matches "${deal.name}". Sync the catalog, or check the product title against the deal name.`)
  // The catalog stores the GraphQL id (gid://shopify/Product/123); a REST line item carries the number.
  const ids = new Set(products.map(p => String(p.productId).split('/').pop()))
  const window = { start: addDays(date, -DAYS_BEFORE), end: addDays(date, DAYS_AFTER) }
  const orders = await ordersIn(window)
  let grossCents = 0, discountCents = 0, refundCents = 0, units = 0, refundedUnits = 0
  const orderIds = new Set()
  for (const o of orders) {
    const mine = (o.line_items || []).filter(li => ids.has(String(li.product_id)))
    if (!mine.length) continue
    orderIds.add(o.id)
    for (const li of mine) {
      grossCents += Math.round(Number(li.price || 0) * 100) * Number(li.quantity || 0)
      discountCents += Math.round(Number(li.total_discount || 0) * 100)
      units += Number(li.quantity || 0)
    }
    const mineIds = new Set(mine.map(li => li.id))
    for (const r of o.refunds || []) for (const rli of r.refund_line_items || []) {
      if (!mineIds.has(rli.line_item_id)) continue
      refundCents += Math.round(Number(rli.subtotal || 0) * 100)
      refundedUnits += Number(rli.quantity || 0)
    }
  }
  const sales = { grossCents, discountCents, refundCents, netSalesCents: grossCents - discountCents - refundCents, unitsSold: units - refundedUnits, orders: orderIds.size, computedAt: new Date().toISOString(), products: products.map(p => p.title), canonical }
  const prev = (await loadState([dealId]))[dealId] || {}
  const state = await saveState(dealId, { ...prev, status: prev.status || 'pending', sales, termsUsed: termsFor(deal) })
  return view(deal, state, today)
}

/** Pull sales for every race whose payout is due and not yet sent. */
export async function computeDue({ today = todayET() } = {}) {
  const rows = await listRacePayouts({ today })
  const due = rows.filter(r => r.status === 'pending' && r.dueDate && r.dueDate <= today)
  const out = [], failed = []
  for (const r of due) {
    try { out.push(await computeRacePayout(r.dealId, { today })) } catch (err) { failed.push({ name: r.name, error: err.expose ? err.message : 'Could not pull sales' }) }
  }
  return { computed: out.length, failed }
}

/** Report sent, paid (with how), or back to pending. Paid writes units and value to the deal, as the runbook does. */
export async function setRacePayoutStatus(dealId, action, { paidRef = '', note = '', today = todayET() } = {}) {
  const deal = await getDeal(dealId, { fresh: true })
  if (!deal) throw new RacePayoutError('No such deal in Attio', 404)
  const prev = (await loadState([dealId]))[dealId] || {}
  if ((action === 'sent' || action === 'paid') && !prev.sales) throw new RacePayoutError('Pull the sales first')
  const n = String(note || '').trim().slice(0, 300) || prev.note || null
  let state
  if (action === 'sent') state = { ...prev, status: 'sent', sentAt: new Date().toISOString(), note: n }
  else if (action === 'paid') state = { ...prev, status: 'paid', paidAt: new Date().toISOString(), paidRef: String(paidRef || '').trim().slice(0, 120) || null, note: n }
  else if (action === 'reopen') state = { ...prev, status: 'pending', sentAt: null, paidAt: null, paidRef: null, note: n }
  else throw new RacePayoutError('action must be sent, paid or reopen')
  await saveState(dealId, state)
  let attio = null
  if (action === 'paid') {
    try { await patchDeal(dealId, { units: state.sales.unitsSold, value: Math.round(state.sales.netSalesCents) / 100 }); attio = 'units and value written to the deal' }
    catch (err) { console.warn('[race-payouts] Attio write failed:', err?.message); attio = 'the Attio write failed; set units and value on the deal by hand' }
  }
  return { ...view(deal, state, today), attio }
}

const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The locked report block and email from the runbook. */
export function reportFor(r) {
  if (!r.sales) return null
  const t = r.termsUsed || r.terms
  const line = t.structure === 'per_order' ? `Race Payout (${usd(t.perOrderCents)}/order × ${r.sales.unitsSold}): ${usd(r.payoutCents)}` : `Race Payout (${t.pct}%): ${usd(r.payoutCents)}`
  const report = [`${r.name} Trackstar Sales Report`, `Units Sold: ${r.sales.unitsSold.toLocaleString('en-US')}`, `Net Sales: ${usd(r.sales.netSalesCents)}`, line].join('\n')
  const first = (r.poc?.name || '').split(' ')[0] || 'there'
  const email = [`Hey ${first},`, '', `Had a great time working with you guys. Here's our sales report for the ${r.name} prints:`, '', report, '', `What's the easiest way to get you guys paid? Do you want a check or do you want to send me an invoice?`, '', `Additionally, would love to hop on a quick post-mortem call and see what we can improve and talk about ideas for next year!`, '', 'Thanks,', 'Matt'].join('\n')
  return { report, subject: `${r.name} Sales Report + Payout | Trackstar`, to: r.poc?.email || null, email, window: `${dayLabel(r.window.start, 'long')} to ${dayLabel(r.window.end, 'long')}` }
}

/**
 * Type the terms here and they land on the Attio deal (rev_share_pct, or
 * payout_per_order for a flat fee), so Attio stays the one place terms live.
 * Sales already pulled are re-priced at the new terms.
 */
export async function setRaceTerms(dealId, { structure, pct, perOrder }, { today = todayET() } = {}) {
  const deal = await getDeal(dealId, { fresh: true })
  if (!deal) throw new RacePayoutError('No such deal in Attio', 404)
  let values
  if (structure === 'percent') {
    const n = Number(pct)
    if (!Number.isFinite(n) || n <= 0 || n > 100) throw new RacePayoutError('The share must be between 0 and 100 percent')
    values = { rev_share_pct: n, ...(deal.payoutPerOrder != null ? { payout_per_order: null } : {}) }
  } else if (structure === 'per_order') {
    const n = Number(perOrder)
    if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new RacePayoutError('The amount per order must be between $0 and $1,000')
    values = { payout_per_order: Math.round(n * 100) / 100 }
  } else throw new RacePayoutError('structure must be percent or per_order')
  try {
    await patchDeal(dealId, values)
  } catch (err) {
    const msg = String(err?.message || '')
    if (/payout_per_order/.test(msg) || err?.status === 400) throw new RacePayoutError(`Attio refused the write${/payout_per_order/.test(msg) || structure === 'per_order' ? ': add a "payout_per_order" number attribute to deals in Attio first' : ''}.`)
    throw err
  }
  const fresh = await getDeal(dealId, { fresh: true })
  const prev = (await loadState([dealId]))[dealId]
  const state = prev?.sales ? await saveState(dealId, { ...prev, termsUsed: termsFor(fresh) }) : prev
  return view(fresh, state, today)
}
