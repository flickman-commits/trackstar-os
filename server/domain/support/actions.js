/**
 * The quick actions beside a conversation: the things the playbook has a
 * rep do over and over, each one a button. Every one is pressed by a
 * person, leaves an event in the thread and a line in the audit log, and
 * does one thing:
 *
 *   discount15        a one-time FIRSTNAME-<percent> code in Shopify, any whole percent (the Make-It-Right toolkit)
 *   lookupCode        what Shopify says about a code the customer pasted
 *   orderNote         a comment on our order row, for whoever is fulfilling it
 *   fixPersonalization the runner's name or year on our order row, before production (scenario 3)
 *   shippingAddress   a new ship-to on the Shopify order and our rows (scenario 19); Artelo is changed by hand
 *   refund            money back on a Shopify order, all or part (scenarios 5, 15); over $150 is an admin's
 *   cancelOrder       cancel and fully refund an order not yet in production, once the customer said yes (scenario 14)
 *   slackMatt         the escalation rules: a line in Slack with a link to the thread
 *
 * Refunds, cancellations and order edits are money and stay in Shopify;
 * the panel links straight to the right Shopify page for them.
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { appBaseUrl, arteloOrderUrl } from '../../lib/links.js'
import { setStatus, assign } from './threads.js'
import { UserError } from './errors.js'
import { requireConnection } from '../../lib/connections.js'
import { slackTo, slackText } from '../../lib/slack.js'

function actorName(actor) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
}
async function event(threadId, body, actor) {
  await prisma.supportNote.create({ data: { threadId, kind: 'event', body, authorId: actor?.id || null, authorName: actorName(actor) } })
}

/** The link a Slack message or a note points at. */
export function threadUrl(threadId) {
  return `${appBaseUrl()}/support?thread=${encodeURIComponent(threadId)}`
}

// ---------------------------------------------------------------------------
// Discount codes
// ---------------------------------------------------------------------------

const CREATE_CODE = `
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`

/** A personal code named after the customer, one use, 30 days: JANE-15, then JANE-15-2 if she has had one. */
/** The most a rep can give without an admin: the playbook's Make-It-Right codes run 10 to 25. */
export const DISCOUNT_LIMIT_PERCENT = 25

export async function discount15({ thread, actor, percent = 15, prefix, days = 30 }) {
  // Whole percent, 1 to 100. Always one use, once per customer: a code is a gift to one person.
  percent = Number(percent)
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new UserError('The discount is a whole percent from 1 to 100.')
  if (percent > DISCOUNT_LIMIT_PERCENT && actor?.role !== 'admin') {
    throw new UserError(`Codes over ${DISCOUNT_LIMIT_PERCENT}% are Matt's call. Slack Matt with the details, or make it ${DISCOUNT_LIMIT_PERCENT}% or less.`)
  }
  // The code's name: the rep's own prefix if they typed one (VIP, BOSTON), else the customer's first name.
  const typed = String(prefix || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (prefix && String(prefix).trim() && typed.length < 2) throw new UserError('The prefix needs at least two letters or numbers.')
  const first = String(thread.customerName || '').trim().split(/\s+/)[0] || ''
  const stem = (typed || first.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TRACKSTAR').slice(0, 20)
  const endsAt = new Date(Date.now() + days * 86400000).toISOString()
  let lastError = ''
  for (let i = 1; i <= 5; i++) {
    const code = i === 1 ? `${stem}-${percent}` : `${stem}-${percent}-${i}`
    const data = await shopifyGraphQL(CREATE_CODE, {
      basicCodeDiscount: {
        title: code, code, startsAt: new Date().toISOString(), endsAt, usageLimit: 1, appliesOncePerCustomer: true,
        customerSelection: { all: true },
        customerGets: { value: { percentage: percent / 100 }, items: { all: true } },
      },
    })
    const errs = data?.discountCodeBasicCreate?.userErrors || []
    if (!errs.length) {
      await event(thread.id, `${actorName(actor)} created code ${code} (${percent}% off, one use, ${days} days)`, actor)
      return { code, percent, endsAt }
    }
    lastError = errs.map(e => e.message).join('; ')
    if (!/already|taken|exists|in use/i.test(lastError)) break
  }
  throw new UserError(`Shopify would not create the code: ${lastError || 'unknown error'}`)
}

const CODE_BY_STRING = `
  query($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        ... on DiscountCodeBasic { title status startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
          customerGets { value { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } } }
        ... on DiscountCodeBxgy { title status startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount }
        ... on DiscountCodeFreeShipping { title status startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount }
      }
    }
  }`

/** What Shopify knows about a code, with the plain-words reason it would fail. */
export async function lookupCode(code) {
  const c = String(code || '').trim().toUpperCase()
  if (!c) throw new UserError('Which code?')
  const data = await shopifyGraphQL(CODE_BY_STRING, { code: c })
  const node = data?.codeDiscountNodeByCode
  if (!node?.codeDiscount) return { code: c, found: false, verdict: 'No such code in Shopify. Check the spelling, or it was never created.' }
  const d = node.codeDiscount
  const v = d.customerGets?.value
  const value = v?.__typename === 'DiscountPercentage' ? `${Math.round(v.percentage * 100)}% off` : v?.amount ? `$${v.amount.amount} off` : d.title
  const now = Date.now()
  let verdict = 'Valid right now.'
  if (d.status === 'EXPIRED' || (d.endsAt && new Date(d.endsAt).getTime() < now)) verdict = `Expired ${d.endsAt ? new Date(d.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}.`
  else if (d.status === 'SCHEDULED' || (d.startsAt && new Date(d.startsAt).getTime() > now)) verdict = 'Not active yet.'
  else if (d.usageLimit && d.asyncUsageCount >= d.usageLimit) verdict = `Already used (${d.asyncUsageCount} of ${d.usageLimit}).`
  else if (d.status !== 'ACTIVE') verdict = `Status is ${String(d.status).toLowerCase()}.`
  return {
    code: c, found: true, title: d.title, value, status: d.status, startsAt: d.startsAt, endsAt: d.endsAt,
    usageLimit: d.usageLimit, used: d.asyncUsageCount, oncePerCustomer: d.appliesOncePerCustomer,
    // Klaviyo's unique codes live in Shopify as a batch named after the campaign.
    fromKlaviyo: /\(\d{4}-\d{2}-\d{2}/.test(d.title || ''),
    verdict,
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** A comment on our order row, where fulfillment reads it. */
export async function orderNote({ thread, orderId, text, actor }) {
  const t = String(text || '').trim()
  if (!t) throw new UserError('Write the note first')
  const o = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { id: true, parentOrderNumber: true, shopifyOrderData: true } })
  if (!o) throw new UserError('No such order')
  await prisma.orderComment.create({ data: { orderId: o.id, text: `${t} (from support: ${threadUrl(thread.id)})`, authorId: actor?.id || null, authorName: actorName(actor) } })
  const number = String(o.shopifyOrderData?.name || o.parentOrderNumber).replace(/^#/, '')
  await event(thread.id, `${actorName(actor)} left a note on #${number}: ${t}`, actor)
  return { number }
}

/** The runner's name or the race year on our row, before it is produced. */
export async function fixPersonalization({ thread, orderId, runnerName, year, actor }) {
  const o = await prisma.order.findUnique({ where: { id: String(orderId || '') } })
  if (!o) throw new UserError('No such order')
  if (o.status === 'completed' || o.designStatus === 'sent_to_production') throw new UserError('That one has gone to production. It is a reprint now, not an edit; ask Matt.')
  const data = {}
  const name = String(runnerName || '').trim()
  const y = Number(year)
  if (name && name !== (o.runnerNameOverride || o.runnerName)) data.runnerNameOverride = name
  if (Number.isFinite(y) && y >= 1990 && y <= 2100 && y !== (o.yearOverride || o.raceYear)) data.yearOverride = y
  if (!Object.keys(data).length) throw new UserError('Nothing changed')
  await prisma.order.update({ where: { id: o.id }, data })
  const what = [data.runnerNameOverride ? `name to ${data.runnerNameOverride}` : null, data.yearOverride ? `year to ${data.yearOverride}` : null].filter(Boolean).join(' and ')
  const number = String(o.shopifyOrderData?.name || o.parentOrderNumber).replace(/^#/, '')
  await prisma.orderComment.create({ data: { orderId: o.id, text: `Support changed ${what} (customer asked: ${threadUrl(thread.id)})`, authorId: actor?.id || null, authorName: actorName(actor) } })
  await event(thread.id, `${actorName(actor)} changed #${number}: ${what}`, actor)
  return { number, what }
}

/**
 * A new ship-to address (scenario 19, gifts going to the runner instead).
 *
 * Shopify's order takes it through the Admin API, and our rows keep it for
 * the dashboard. Artelo has no endpoint that edits an order (its open API
 * reads orders and manages uploads only), so the address is handed back
 * formatted for pasting, with the Artelo order's link, and the thread says
 * plainly that Artelo still needs it until someone confirms it there.
 *
 * Since API version 2026-10 Shopify recalculates an unfulfilled order's tax
 * when its ship-to changes (a new state can mean a new rate), so a paid order
 * can come out owing a little or owed a little. The balance is read before
 * and after, and any change is told to the rep and written on the thread.
 * From support nothing moves money here: settling it is the rep's call,
 * through Refund or a note to the customer.
 *
 * A customer changing it themselves (Manage your order) is quoted first: if
 * the new address costs more tax, nothing is saved until they agree
 * (acceptTax), and once saved Shopify emails them the invoice for the
 * difference. Less tax is still the rep's to refund.
 */
const ORDER_BALANCE = `query($id: ID!) { order(id: $id) { name displayFulfillmentStatus totalOutstandingSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } } }`
const ADDRESS_VERSION = '2026-10'
const ADDRESS_FIELDS = ['name', 'address1', 'address2', 'city', 'province', 'zip', 'country', 'phone']
const ORDER_FOR_QUOTE = `query($id: ID!) { order(id: $id) { currencyCode taxExempt
  shippingAddress { address1 address2 city provinceCode zip countryCodeV2 }
  lineItems(first: 50) { nodes { title currentQuantity taxable requiresShipping variant { id } discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } } } }
  shippingLines(first: 5) { nodes { title discountedPriceSet { shopMoney { amount } } } } } }`
const TAX_QUOTE = `mutation($input: DraftOrderInput!) { draftOrderCalculate(input: $input) { calculatedDraftOrder { totalTaxSet { shopMoney { amount } } } userErrors { field message } } }`

/**
 * How much the order's tax goes up (positive) or down in cents if it ships to
 * `a` instead of where it ships now. Shopify works out both with
 * draftOrderCalculate, which creates nothing, from what the customer actually
 * paid per item and for shipping. Null when Shopify cannot say.
 */
export async function taxChangeCents(gid, a) {
  try {
    const o = (await shopifyGraphQL(ORDER_FOR_QUOTE, { id: gid }, { version: ADDRESS_VERSION }))?.order
    if (!o) return null
    if (o.taxExempt) return 0
    const price = amount => ({ amount: String(Number(amount || 0).toFixed(2)), currencyCode: o.currencyCode || 'USD' })
    const lineItems = (o.lineItems?.nodes || []).filter(l => l.currentQuantity > 0 && l.taxable).map(l => {
      const unit = price(l.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount)
      return l.variant?.id
        ? { variantId: l.variant.id, quantity: l.currentQuantity, priceOverride: unit }
        : { title: l.title, quantity: l.currentQuantity, originalUnitPriceWithCurrency: unit, taxable: true, requiresShipping: l.requiresShipping }
    })
    if (!lineItems.length) return 0
    const ships = o.shippingLines?.nodes || []
    const shippingLine = ships.length ? { title: ships[0].title || 'Shipping', priceWithCurrency: price(ships.reduce((n, s) => n + Number(s.discountedPriceSet?.shopMoney?.amount || 0), 0)) } : null
    const taxAt = async address => {
      const r = (await shopifyGraphQL(TAX_QUOTE, { input: { lineItems, shippingLine, shippingAddress: address } }, { version: ADDRESS_VERSION }))?.draftOrderCalculate
      if (r?.userErrors?.length || !r?.calculatedDraftOrder) throw new Error(r?.userErrors?.map(e => e.message).join('; ') || 'no quote')
      return toCents(r.calculatedDraftOrder.totalTaxSet.shopMoney.amount)
    }
    const s = o.shippingAddress
    const [was, now] = await Promise.all([
      s ? taxAt({ address1: s.address1, address2: s.address2, city: s.city, provinceCode: s.provinceCode, zip: s.zip, countryCode: s.countryCodeV2 }) : 0,
      taxAt({ address1: a.address1, address2: a.address2 || null, city: a.city, provinceCode: a.province || null, zip: a.zip, countryCode: a.country }),
    ])
    return now - was
  } catch (e) {
    console.error('[shippingAddress] tax quote failed', e.message)
    return null
  }
}

export function formatAddress(a) {
  return [a.name, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join('\n')
}
export async function shippingAddress({ thread, shopifyOrderId, address, actor, source = 'support', acceptTax = false }) {
  const a = {}
  for (const k of ADDRESS_FIELDS) a[k] = String(address?.[k] || '').trim()
  a.country = a.country.toUpperCase()
  a.province = a.province.toUpperCase()
  for (const k of ['name', 'address1', 'city', 'zip', 'country']) if (!a[k]) throw new UserError(`The address needs a ${k === 'address1' ? 'street' : k}`)
  const id = String(shopifyOrderId || '').trim()
  if (!/^\d+$/.test(id)) throw new UserError('That order has no Shopify id')

  const rows = await prisma.order.findMany({ where: { source: 'shopify', parentOrderNumber: id }, select: { id: true, status: true, designStatus: true, trackingNumber: true, arteloOrderData: true, shopifyOrderData: true } })
  if (rows.some(r => r.trackingNumber)) throw new UserError('That order has shipped. Ask Matt; it is a reship now, not an address change.')

  const gid = `gid://shopify/Order/${id}`
  const before = (await shopifyGraphQL(ORDER_BALANCE, { id: gid }, { version: ADDRESS_VERSION }))?.order
  if (!before) throw new UserError('Shopify has no such order')
  if (before.displayFulfillmentStatus === 'FULFILLED') throw new UserError('Shopify says that order is fulfilled already. Ask Matt; it is a reship now.')
  // The customer hears about any extra sales tax before anything changes.
  const quoted = source === 'customer' ? await taxChangeCents(gid, a) : null
  if (quoted > 0 && !acceptTax) throw new UserError(`Shipping there adds ${money(quoted)} in sales tax. Save it again to accept, and we'll email you an invoice for it.`, { status: 409, taxDueCents: quoted })
  const [first, ...last] = a.name.split(/\s+/)
  const updated = await shopifyGraphQL(`mutation($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`, { input: { id: gid, shippingAddress: {
    firstName: first, lastName: last.join(' '), address1: a.address1, address2: a.address2 || null, city: a.city,
    provinceCode: a.province || null, zip: a.zip, countryCode: a.country, phone: a.phone || null,
  } } }, { version: ADDRESS_VERSION })
  const errors = updated?.orderUpdate?.userErrors || []
  if (errors.length) throw new UserError(`Shopify would not take that address: ${errors.map(e => e.message).join('; ')}`)
  const order = { name: before.name }
  const after = (await shopifyGraphQL(ORDER_BALANCE, { id: gid }, { version: ADDRESS_VERSION }).catch(() => null))?.order
  // Positive: the customer owes us; negative: we owe them.
  const owedCents = after ? toCents(after.totalOutstandingSet.shopMoney.amount) - toCents(before.totalOutstandingSet.shopMoney.amount) : 0
  // A customer who agreed to the extra tax gets Shopify's invoice for it now.
  let invoiced = false
  let invoiceFailed = false
  if (owedCents > 0 && source === 'customer' && quoted > 0) {
    try {
      const sent = await shopifyGraphQL(`mutation($id: ID!) { orderInvoiceSend(id: $id) { order { id } userErrors { field message } } }`, { id: gid }, { version: ADDRESS_VERSION })
      const errs = sent?.orderInvoiceSend?.userErrors || []
      if (errs.length) throw new Error(errs.map(e => e.message).join('; '))
      invoiced = true
    } catch (e) {
      console.error('[shippingAddress] tax invoice failed', e.message)
      invoiceFailed = true
    }
  }
  const taxNote = !owedCents ? null
    : invoiced ? `Shopify recalculated tax for the new address: the customer owes ${money(owedCents)} more, agreed to it, and Shopify emailed them the invoice.`
    : invoiceFailed ? `Shopify recalculated tax for the new address: the customer owes ${money(owedCents)} more and agreed to it, but sending Shopify's invoice failed. Send it from the Shopify order.`
    : owedCents > 0 ? `Shopify recalculated tax for the new address: the customer now owes ${money(owedCents)}. Decide whether to let it go or ask for it.`
    : `Shopify recalculated tax for the new address: the customer is owed ${money(-owedCents)}. Refund it from Refund below.`

  const ours = { name: a.name, line1: a.address1, line2: a.address2, city: a.city, state: a.province, zip: a.zip, country: a.country, phone: a.phone }
  const number = String(order.name || rows[0]?.shopifyOrderData?.name || id).replace(/^#/, '')
  const pasted = formatAddress(a)
  if (rows.length) {
    await prisma.order.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { shippingAddress: ours } })
    const comment = source === 'customer'
      ? `The customer changed the ship-to from their confirmation email to: ${pasted.replace(/\n/g, ', ')}.${taxNote ? ` ${taxNote}` : ''}`
      : `Ship-to changed by support to: ${pasted.replace(/\n/g, ', ')}. Change it in Artelo too.`
    await prisma.orderComment.createMany({ data: rows.map(r => ({ orderId: r.id, text: comment, authorId: actor?.id || null, authorName: source === 'customer' ? 'Customer' : actorName(actor) })) })
  }
  if (thread) await event(thread.id, `${actorName(actor)} changed #${number}'s ship-to in Shopify to ${pasted.replace(/\n/g, ', ')}. Artelo still needs it.${taxNote ? ` ${taxNote}` : ''}`, actor)
  return { number, address: a, pasted, taxNote, owedCents, invoiced, arteloUrl: arteloOrderUrl(rows[0]?.arteloOrderData?.id) || null }
}

// ---------------------------------------------------------------------------
// Money: refunds and cancellations
// ---------------------------------------------------------------------------
//
// Amounts travel as integer cents and become Shopify's decimal strings only
// at the call. The playbook's line is $150: under it a rep refunds on their
// own, over it the server refuses anyone but an admin, whatever the page
// says. Nothing here notifies the customer through Shopify; the rep's reply
// is the message.

export const REFUND_LIMIT_CENTS = 15000

const ORDER_MONEY = `
  query($id: ID!) {
    order(id: $id) {
      id name cancelledAt displayFinancialStatus displayFulfillmentStatus
      totalReceivedSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      transactions(first: 20) { id kind status gateway amountSet { shopMoney { amount currencyCode } } }
    }
  }`

const toCents = amount => Math.round(Number(amount || 0) * 100)
const toAmount = cents => (cents / 100).toFixed(2)
const money = cents => `$${toAmount(cents)}`

/** What can still be refunded on a Shopify order, and the payment to refund it against. */
export async function refundable(shopifyOrderId) {
  const id = String(shopifyOrderId || '').trim()
  if (!/^\d+$/.test(id)) throw new UserError('That order has no Shopify id')
  const data = await shopifyGraphQL(ORDER_MONEY, { id: `gid://shopify/Order/${id}` })
  const o = data?.order
  if (!o) throw new UserError('Shopify does not have that order')
  const received = toCents(o.totalReceivedSet?.shopMoney?.amount)
  const refunded = toCents(o.totalRefundedSet?.shopMoney?.amount)
  const sale = (o.transactions || []).find(t => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS') || null
  return {
    id, gid: o.id, name: String(o.name || '').replace(/^#/, ''),
    cancelled: Boolean(o.cancelledAt), financial: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus,
    currency: o.totalReceivedSet?.shopMoney?.currencyCode || 'USD',
    receivedCents: received, refundedCents: refunded, availableCents: Math.max(0, received - refunded),
    sale,
  }
}

const REFUND_CREATE = `
  mutation refundCreate($input: RefundInput!) {
    refundCreate(input: $input) {
      refund { id totalRefundedSet { shopMoney { amount currencyCode } } }
      userErrors { field message }
    }
  }`

const ORDER_CANCEL = `
  mutation orderCancel($orderId: ID!, $staffNote: String) {
    orderCancel(orderId: $orderId, reason: CUSTOMER, refund: true, restock: false, notifyCustomer: false, staffNote: $staffNote) {
      job { id done }
      orderCancelUserErrors { field message code }
      userErrors { field message }
    }
  }`

/** Shopify cancels in the background; true once the order reads cancelled (about ten seconds at most). */
async function waitForCancel(id) {
  for (let i = 0; i < 8; i++) {
    const o = await refundable(id)
    if (o.cancelled) return o
    await new Promise(r => setTimeout(r, 1250))
  }
  return null
}

/**
 * The $150 line is per order, not per press: what has already been refunded
 * on the order, by anyone, counts toward it, so three $100 refunds cannot
 * walk past it.
 */
export function guardLimit(cents, actor, { alreadyCents = 0 } = {}) {
  if (actor?.role === 'admin') return
  const total = cents + Math.max(0, alreadyCents)
  if (total <= REFUND_LIMIT_CENTS) return
  if (alreadyCents > 0) {
    throw new UserError(`${money(alreadyCents)} has already been refunded on this order, so ${money(cents)} more would make ${money(total)}, over the ${money(REFUND_LIMIT_CENTS)} line. That one is Matt's call: Slack Matt with the details.`)
  }
  throw new UserError(`${money(cents)} is over the ${money(REFUND_LIMIT_CENTS)} line. That one is Matt's call: Slack Matt with the details.`)
}

/** Money back, all or part, against the order's payment. The order itself stays as it is. */
export async function refund({ thread, shopifyOrderId, cents, reason, actor }) {
  const amount = Math.round(Number(cents))
  if (!Number.isFinite(amount) || amount <= 0) throw new UserError('How much? Enter an amount above zero.')
  const why = String(reason || '').trim()
  if (!why) throw new UserError('Say why, in a few words. It goes on the refund in Shopify.')
  const o = await refundable(shopifyOrderId)
  if (!o.sale) throw new UserError('No captured payment on that order to refund against.')
  if (amount > o.availableCents) throw new UserError(`Only ${money(o.availableCents)} is left to refund on #${o.name}.`)
  guardLimit(amount, actor, { alreadyCents: o.refundedCents })

  const data = await shopifyGraphQL(REFUND_CREATE, {
    input: {
      orderId: o.gid,
      note: `${why} (support, ${actor?.firstName || 'rep'})`,
      notify: false,
      transactions: [{ orderId: o.gid, parentId: o.sale.id, gateway: o.sale.gateway, kind: 'REFUND', amount: toAmount(amount) }],
    },
  })
  const errs = data?.refundCreate?.userErrors || []
  if (errs.length) throw new UserError(`Shopify refused the refund: ${errs.map(e => e.message).join('; ')}`)

  const rows = await prisma.order.findMany({ where: { source: 'shopify', parentOrderNumber: o.id }, select: { id: true } })
  if (rows.length) await prisma.orderComment.createMany({ data: rows.map(r => ({ orderId: r.id, text: `Refunded ${money(amount)} by support: ${why}`, authorId: actor?.id || null, authorName: actorName(actor) })) })
  await event(thread.id, `${actorName(actor)} refunded ${money(amount)} on #${o.name}: ${why}`, actor)
  return { number: o.name, cents: amount, display: money(amount), leftCents: o.availableCents - amount }
}

/**
 * Cancel and refund in full (scenario 14: wrong frame, changed their mind
 * before production). Only with the customer's yes, only while nothing has
 * been produced or shipped. Our rows leave the queue with a note; Artelo
 * has no API to cancel, so the thread says it still needs cancelling there.
 */
export async function cancelOrder({ thread, shopifyOrderId, reason, customerConfirmed, actor }) {
  if (!customerConfirmed) throw new UserError('Only after the customer says yes to cancelling. Ask them first.')
  const why = String(reason || '').trim() || 'Customer asked to cancel'
  const o = await cancellable(shopifyOrderId)
  guardLimit(o.availableCents, actor, { alreadyCents: o.refundedCents })
  const out = await cancelAndRefund({ order: o, why, by: `support: ${why}`, actor })
  await event(thread.id, `${actorName(actor)} cancelled #${o.name} and refunded ${money(o.availableCents)}: ${why}. Artelo still needs cancelling.`, actor)
  return out
}

/** The Shopify order, or why it cannot be cancelled (already cancelled, shipped, in production). */
export async function cancellable(shopifyOrderId) {
  const o = await refundable(shopifyOrderId)
  if (o.cancelled) throw new UserError(`#${o.name} is already cancelled in Shopify.`)
  if (o.fulfillment === 'FULFILLED' || o.fulfillment === 'PARTIALLY_FULFILLED') throw new UserError(`#${o.name} has shipped. It cannot be cancelled; a refund is Matt's call.`)
  const rows = await prisma.order.findMany({ where: { source: 'shopify', parentOrderNumber: o.id }, select: { id: true, status: true, designStatus: true, trackingNumber: true, arteloOrderData: true } })
  const produced = rows.find(r => r.status === 'completed' || r.designStatus === 'sent_to_production' || r.trackingNumber)
  if (produced) throw new UserError(`#${o.name} has gone to production. Too late to cancel; see the playbook's "too late" reply.`)
  if (await prisma.renderJob.findFirst({ where: { order: { source: 'shopify', parentOrderNumber: o.id }, arteloSentAt: { not: null } }, select: { id: true } })) throw new UserError(`#${o.name} has gone to production. Too late to cancel; see the playbook's "too late" reply.`)
  return { ...o, rows }
}

/**
 * Cancel in Shopify and refund what was paid to the original payment, in one
 * call, then close our rows with a note. Shared by Support (cancelOrder, after
 * its own checks) and the customer's own Manage your order page
 * (orders/selfServeOrder.js). No Shopify email; the caller says it. Shopify
 * runs the cancel as a job; this waits a few seconds for it so the caller
 * hears the truth, not just "accepted". Artelo has no cancel API: the note
 * says it still needs cancelling there.
 */
export async function cancelAndRefund({ order: o, why, by, actor = null }) {
  const data = await shopifyGraphQL(ORDER_CANCEL, { orderId: o.gid, staffNote: String(by || why).slice(0, 255) })
  const errs = data?.orderCancel?.orderCancelUserErrors?.length ? data.orderCancel.orderCancelUserErrors : data?.orderCancel?.userErrors || []
  if (errs.length) throw new UserError(`Shopify would not cancel #${o.name}: ${errs.map(e => e.message).join('; ')}`)
  const cancelled = await waitForCancel(o.id)
  if (!cancelled) throw new UserError(`Shopify accepted the cancel for #${o.name} but has not finished it yet. Check the order in Shopify in a minute before trying again.`)

  const rows = o.rows || []
  const note = `Cancelled and refunded ${money(o.availableCents)} ${actor ? 'by support' : 'by the customer from Manage your order'}: ${why}. Cancel it in Artelo too.`
  if (rows.length) {
    await prisma.order.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { status: 'completed' } })
    await prisma.orderComment.createMany({ data: rows.map(r => ({ orderId: r.id, text: note, authorId: actor?.id || null, authorName: actor ? actorName(actor) : 'Customer' })) })
  }
  return { number: o.name, cents: o.availableCents, display: money(o.availableCents), arteloUrl: arteloOrderUrl(rows[0]?.arteloOrderData?.id) || null }
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

/**
 * Who an escalation goes to: Matt, found by SUPPORT_ESCALATE_EMAIL (his
 * TrackstarOS login). Null when no active person has that email.
 */
export async function escalationOwner() {
  const email = String(process.env.SUPPORT_ESCALATE_EMAIL || 'matt@trackstar.art').trim()
  return prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, isActive: true }, select: { id: true, firstName: true, email: true } })
}

/** Escalated threads are Matt's: assigned to him unless they already are. */
async function assignToOwner(thread, owner, actor) {
  if (!owner || thread.assignee?.id === owner.id || thread.assigneeId === owner.id) return thread
  return assign(thread.id, owner.id, actor)
}

/**
 * The Escalate button: the thread marked escalated and assigned to Matt and,
 * when that is a change and someone else pressed it, a DM to Matt with the
 * link. Slack failing never blocks the escalation; the thread notes when he
 * was pinged.
 */
export async function escalate(id, actor) {
  const before = await prisma.supportThread.findUnique({ where: { id }, select: { status: true } })
  const owner = await escalationOwner()
  let t = await setStatus(id, 'escalated', actor)
  t = await assignToOwner(t, owner, actor)
  if (before?.status === 'escalated') return t
  if (owner && actor?.id === owner.id) return t
  const who = t.customerName || t.customerEmail || 'a customer'
  const msg = `:rotating_light: ${slackText(actorName(actor), 80)} escalated a support conversation to you\n*${slackText(who, 120)}*: ${slackText(t.subject || '(no subject)', 200)}\n<${threadUrl(id)}|Open the conversation>`
  const sent = await slackTo('matt', msg).catch(() => false)
  if (sent) await event(id, 'Matt was pinged in Slack', actor)
  return t
}

/** A line to Matt in Slack with the thread link, and the thread marked escalated. */
export async function slackMatt({ thread, text, actor }) {
  await requireConnection('slack')
  const who = thread.customerName || thread.customerEmail || 'a customer'
  const msg = `:rotating_light: *Support escalation* from ${actorName(actor)}\n*${who}*: ${thread.subject || '(no subject)'}\n${String(text || '').trim() || 'Needs your call.'}\n${threadUrl(thread.id)}`
  if (!(await slackTo('matt', msg, { or: 'alerts' }))) throw new UserError('Slack did not take the message. Check Settings > Connections > Slack.')
  if (thread.status !== 'escalated') await setStatus(thread.id, 'escalated', actor)
  await assignToOwner(thread, await escalationOwner(), actor)
  await event(thread.id, `${actorName(actor)} pinged Matt in Slack${text ? `: ${String(text).trim()}` : ''}`, actor)
  return { ok: true }
}
