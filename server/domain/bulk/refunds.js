/**
 * Refunds on a bulk order: the whole order, the prints with no runner, or an
 * amount an admin types.
 *
 *   The prints with no runner are the prints paid for and not being made:
 *   the order's quantity less its runners, with a DNF runner (dnf.js) off
 *   the list. Their share of what was paid is the suggestion: paid x prints /
 *   quantity, so the discount and tax come off in proportion.
 *
 *   Anyone working the order can ask for a refund. Money is admins' (api/_lib/
 *   money.js), so someone who does not see it asks by prints and the amount is
 *   set by the admin who approves it. These are big amounts, so nothing moves
 *   without an admin's approval, and every request goes to #admin-alerts.
 *
 *   How it is paid back follows how the order was paid. Through Shopify (an
 *   invoice from the tool): approving refunds it in Shopify, which emails the
 *   customer. Through Stripe (the first orders, before Shopify invoicing):
 *   approving leaves it for the admin to refund in Stripe, then mark done.
 *
 * Money is integer cents with a currency (CLAUDE.md).
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { quote } from './billing.js'
import { settleBulkStatus } from './send.js'

export class RefundError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const KINDS = ['full', 'unfilled', 'custom']
const OPEN = ['requested', 'approved', 'failed']
const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** What each kind would refund, from what was paid and what is already back. Pure; cents. */
export function suggestAmounts({ paidCents, refundedCents = 0, quantity, unfilled }) {
  if (paidCents == null) return { fullCents: null, unfilledCents: null, perPrintCents: null, leftCents: null }
  const leftCents = Math.max(0, paidCents - refundedCents)
  const perPrintCents = quantity > 0 ? Math.round(paidCents / quantity) : null
  const unfilledCents = quantity > 0 ? Math.min(leftCents, Math.round(paidCents * unfilled / quantity)) : null
  return { fullCents: leftCents, unfilledCents, perPrintCents, leftCents }
}

/** The payment to refund against in a Shopify order: its successful sale or capture. Pure. */
export function refundableTransaction(transactions) {
  const ok = (transactions || []).filter(t => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS')
  return ok.sort((a, b) => Number(b.amountSet?.shopMoney?.amount || 0) - Number(a.amountSet?.shopMoney?.amount || 0))[0] || null
}

const cents = v => Math.round(Number(v || 0) * 100)

async function shopifyOrder(legacyId) {
  const d = await shopifyGraphQL(`query($id: ID!) { order(id: $id) {
    id name displayFinancialStatus
    totalReceivedSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount } }
    transactions { id kind status gateway amountSet { shopMoney { amount } } }
  } }`, { id: `gid://shopify/Order/${legacyId}` })
  const o = (d.data || d).order
  if (!o) throw new RefundError('Shopify does not have that order any more')
  return o
}

/**
 * The order's refund picture: how many prints were paid for and are being
 * made, the DNFs, what was paid and refunded (for admins), the suggestions,
 * and every refund asked for so far.
 */
export async function refundState(bulkOrderId, { money = false } = {}) {
  const bulk = await prisma.bulkOrder.findUnique({ where: { id: String(bulkOrderId || '') } })
  if (!bulk) throw new RefundError('Bulk order not found', 404)
  const [making, dnf, refunds] = await Promise.all([
    prisma.order.count({ where: { bulkOrderId: bulk.id, bulkDnfAt: null } }),
    prisma.order.count({ where: { bulkOrderId: bulk.id, bulkDnfAt: { not: null } } }),
    prisma.bulkRefund.findMany({ where: { bulkOrderId: bulk.id }, orderBy: { createdAt: 'desc' } }),
  ])
  const via = bulk.shopifyOrderId ? 'shopify' : 'stripe'
  const unfilled = Math.max(0, bulk.quantity - making)
  const out = { bulkOrderId: bulk.id, number: bulk.number, paid: Boolean(bulk.paidAt), via, quantity: bulk.quantity, making, dnf, unfilled, currency: bulk.currency, open: refunds.find(r => OPEN.includes(r.status)) || null, refunds }
  if (!money) {
    const hide = r => ({ ...r, amountCents: undefined, paidCents: undefined })
    return { ...out, open: out.open && hide(out.open), refunds: refunds.map(hide) }
  }
  // What was paid: Shopify's own figures; for Stripe, what an admin gave last time, else the invoice as quoted today.
  let paidCents = null, paidFrom = null, refundedCents = refunds.filter(r => r.status === 'refunded').reduce((n, r) => n + (r.amountCents || 0), 0)
  if (via === 'shopify') {
    try {
      const o = await shopifyOrder(bulk.shopifyOrderId)
      paidCents = cents(o.totalReceivedSet?.shopMoney?.amount); paidFrom = 'shopify'
      refundedCents = Math.max(refundedCents, cents(o.totalRefundedSet?.shopMoney?.amount))
    } catch (e) { console.warn('[bulk refund] Shopify order read failed:', e.message) }
  }
  if (paidCents == null) {
    const known = refunds.find(r => r.paidCents != null)
    if (known) { paidCents = known.paidCents; paidFrom = 'entered' }
    else {
      try { const q = await quote(bulk.id); if (q.totalCents) { paidCents = q.totalCents; paidFrom = 'estimate' } } catch { /* no price to go on */ }
    }
  }
  return { ...out, paidCents, paidFrom, refundedCents, ...suggestAmounts({ paidCents, refundedCents, quantity: bulk.quantity, unfilled }) }
}

/** Ask for a refund. Someone who does not see money asks by prints; an admin may set the amount. */
export async function requestRefund(bulkOrderId, input, actor, { money = false } = {}) {
  const kind = KINDS.includes(input?.kind) ? input.kind : null
  if (!kind) throw new RefundError('Pick a full refund, the prints with no runner, or an amount')
  const reason = String(input?.reason || '').trim().slice(0, 1000)
  if (!reason) throw new RefundError('Say why, for the record')
  if (kind === 'custom' && !money) throw new RefundError('An amount of your own is for admins')
  const st = await refundState(bulkOrderId, { money: true })
  if (!st.paid) throw new RefundError('This order is not paid, so there is nothing to refund')
  if (st.open) throw new RefundError('A refund on this order is already waiting. Approve or decline it first')
  if (kind === 'unfilled' && !st.unfilled) throw new RefundError('Every print paid for has a runner')
  // An admin may give what Stripe says was paid; it is kept for next time.
  const paidCents = money && Number.isInteger(input?.paidCents) && input.paidCents > 0 ? input.paidCents : st.paidCents
  const s = suggestAmounts({ paidCents, refundedCents: st.refundedCents, quantity: st.quantity, unfilled: st.unfilled })
  let amountCents = null
  if (money) {
    amountCents = kind === 'custom' || Number.isInteger(input?.amountCents) ? Math.round(Number(input.amountCents)) : kind === 'full' ? s.fullCents : s.unfilledCents
    checkAmount(amountCents, s.leftCents)
  }
  const by = actor?.name || actor?.email || 'someone'
  const refund = await prisma.bulkRefund.create({
    data: {
      bulkOrderId: st.bulkOrderId, kind, prints: kind === 'full' ? st.quantity : kind === 'unfilled' ? st.unfilled : null,
      amountCents, paidCents: money ? paidCents : null, currency: st.currency, reason, via: st.via, requestedBy: by,
    },
  })
  const what = kind === 'full' ? 'the whole order' : kind === 'unfilled' ? `${st.unfilled} prints with no runner` : 'an amount'
  await slackTo('admin', `:money_with_wings: *Refund to approve* on ${slackText(st.number)}: ${what}${amountCents != null ? `, ${usd(amountCents)}` : ''} (${st.via === 'shopify' ? 'Shopify' : 'Stripe'}). Asked by ${slackText(by)}: ${slackText(reason, 200)}`).catch(() => {})
  return refund
}

function checkAmount(amountCents, leftCents) {
  if (!Number.isInteger(amountCents) || amountCents < 100) throw new RefundError('The refund has to be at least $1')
  if (leftCents != null && amountCents > leftCents) throw new RefundError(`That is more than is left to refund (${usd(leftCents)})`)
}

async function openRefund(refundId, statuses = ['requested']) {
  const r = await prisma.bulkRefund.findUnique({ where: { id: String(refundId || '') }, include: { bulkOrder: { select: { id: true, number: true, shopifyOrderId: true, partnerName: true } } } })
  if (!r) throw new RefundError('Refund not found', 404)
  if (!statuses.includes(r.status)) throw new RefundError(`This refund is ${r.status}`)
  return r
}

const REFUND = `mutation($input: RefundInput!) { refundCreate(input: $input) { refund { id } userErrors { field message } } }`
const REFUND_KEYED = `mutation($input: RefundInput!, $key: String!) { refundCreate(input: $input) @idempotent(key: $key) { refund { id } userErrors { field message } } }`

/** Refund through Shopify against the order's payment; Shopify emails the customer. */
async function refundInShopify(refund, amountCents) {
  const o = await shopifyOrder(refund.bulkOrder.shopifyOrderId)
  const t = refundableTransaction(o.transactions)
  if (!t) throw new RefundError('Shopify has no payment on this order to refund against')
  const input = {
    orderId: o.id, notify: true, note: `Bulk order ${refund.bulkOrder.number}: ${refund.reason}`.slice(0, 500),
    transactions: [{ orderId: o.id, parentId: t.id, gateway: t.gateway, kind: 'REFUND', amount: (amountCents / 100).toFixed(2) }],
  }
  let d
  try { d = await shopifyGraphQL(REFUND, { input }) } catch (e) {
    // Newer Admin API versions want an idempotency key on refunds; the refund's id is one.
    if (!/idempoten/i.test(e.message)) throw e
    d = await shopifyGraphQL(REFUND_KEYED, { input, key: `bulk-refund-${refund.id}` })
  }
  const out = (d.data || d).refundCreate
  if (out?.userErrors?.length) throw new RefundError(`Shopify: ${out.userErrors.map(e => e.message).join('; ')}`)
  if (!out?.refund?.id) throw new RefundError('Shopify did not return the refund')
  return out.refund.id
}

/**
 * An admin approves, with the final amount. Shopify: refunded now. Stripe:
 * approved, waiting for the admin to refund it there and mark it done.
 */
export async function approveRefund(refundId, input, actor) {
  // A Shopify refund that failed can be tried again.
  const r = await openRefund(refundId, ['requested', 'failed'])
  const st = await refundState(r.bulkOrderId, { money: true })
  const paidCents = Number.isInteger(input?.paidCents) && input.paidCents > 0 ? input.paidCents : (r.paidCents ?? st.paidCents)
  const s = suggestAmounts({ paidCents, refundedCents: st.refundedCents, quantity: st.quantity, unfilled: st.unfilled })
  const amountCents = Number.isInteger(input?.amountCents) ? input.amountCents : r.amountCents ?? (r.kind === 'full' ? s.fullCents : s.unfilledCents)
  checkAmount(amountCents, s.leftCents)
  const by = actor?.name || actor?.email || 'an admin'
  const decided = { amountCents, paidCents, decidedBy: by, decidedAt: new Date() }
  if (r.via !== 'shopify') {
    return prisma.bulkRefund.update({ where: { id: r.id }, data: { ...decided, status: 'approved' } })
  }
  try {
    const shopifyRefundId = await refundInShopify(r, amountCents)
    const done = await prisma.bulkRefund.update({ where: { id: r.id }, data: { ...decided, status: 'refunded', refundedAt: new Date(), shopifyRefundId, error: null } })
    await settleBulkStatus(r.bulkOrderId)
    await slackTo('admin', `:white_check_mark: Refunded ${usd(amountCents)} on ${slackText(r.bulkOrder.number)} through Shopify (approved by ${slackText(by)}).`).catch(() => {})
    return done
  } catch (e) {
    const error = e instanceof RefundError ? e.message : 'Shopify did not take the refund'
    console.warn('[bulk refund] Shopify refund failed:', e.message)
    await prisma.bulkRefund.update({ where: { id: r.id }, data: { ...decided, status: 'failed', error } })
    throw new RefundError(`${error}. Nothing was refunded; try again or refund it in Shopify`, 502)
  }
}

/** A Stripe refund done by hand in Stripe: mark it refunded. */
export async function markRefunded(refundId, actor) {
  const r = await openRefund(refundId, ['approved'])
  const done = await prisma.bulkRefund.update({ where: { id: r.id }, data: { status: 'refunded', refundedAt: new Date() } })
  // Refunded prints are no longer owed: the run may be complete now.
  await settleBulkStatus(r.bulkOrderId)
  await slackTo('admin', `:white_check_mark: Refunded ${usd(r.amountCents || 0)} on ${slackText(r.bulkOrder.number)} in Stripe (marked by ${slackText(actor?.name || actor?.email || 'an admin')}).`).catch(() => {})
  return done
}

/** Decline (an admin), or call off (whoever asked, or an admin), a refund not yet paid back. A failed one can be closed too. */
export async function closeRefund(refundId, { note } = {}, actor, { admin = false } = {}) {
  const r = await prisma.bulkRefund.findUnique({ where: { id: String(refundId || '') } })
  if (!r) throw new RefundError('Refund not found', 404)
  if (!['requested', 'approved', 'failed'].includes(r.status)) throw new RefundError(`This refund is ${r.status}`)
  const by = actor?.name || actor?.email || 'someone'
  if (!admin && (r.status !== 'requested' || r.requestedBy !== by)) throw new RefundError('Only an admin, or whoever asked, can call it off', 403)
  return prisma.bulkRefund.update({ where: { id: r.id }, data: { status: 'declined', decidedBy: by, decidedAt: new Date(), error: String(note || '').trim().slice(0, 500) || r.error } })
}
