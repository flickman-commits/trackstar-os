/**
 * A bulk order's billing: who is paying, what we agreed, and its Shopify
 * invoice. All of it lives on the BulkOrder row itself, one race per order;
 * there is no separate deal record.
 *
 * The order holds the organization and contact, standard prints (our race
 * design, rendered by the worker) or co-branded (their design, from its own
 * production file), the discount, and where the prints ship. The invoice is a
 * Shopify draft order built from the race's real product in the order's size
 * and frame, at its quantity, with the discount applied, shipping free, and
 * tags "bulk" plus the order number. Once they pay, the draft becomes an
 * order carrying those tags, and shopifyBulk.js marks the bulk order paid by
 * its number (never by partner name). Prices are Shopify's, read live; money
 * here is integer cents (CLAUDE.md).
 */
import { templateKey, uploadTemplateUrl, saveUploadedTemplate } from '../render/templates.js'
import prisma from '../../db.js'
import { Prisma } from '@prisma/client'
import { shopifyAdminUrl, shopifyDraftAdminUrl } from '../../lib/links.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { nextNumber, dueDateFor, verifiedRaceDate, FRAME_OPTIONS, SIZE_OPTIONS } from './bulkOrders.js'
import { defaultAssigneeFor } from '../orders/assignment.js'

export class BulkError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const EVENT_OPTIONS = ['Marathon', 'Half Marathon', '10 Miler', '10K', '8K', '5K']
export const PRINT_KINDS = ['standard', 'cobranded']

/** Our frame value -> the Frame option on the storefront products. */
const SHOP_FRAME = { 'Unframed': 'Unframed', 'Natural Premium Oak': 'Natural Oak', 'Black Premium Oak': 'Black Oak' }

const cleanAddress = a => {
  if (!a || typeof a !== 'object') return null
  const out = {}
  for (const k of ['company', 'name', 'address1', 'address2', 'city', 'province', 'zip', 'country', 'phone']) out[k] = String(a[k] || '').trim()
  return out.address1 || out.city ? out : null
}

/** The race: one race and year per order. Which events were sold is a note for us; the lookup finds which race each runner ran. */
function cleanRace(l) {
  const raceName = String(l?.raceName || '').trim()
  const raceYear = Number(l?.raceYear)
  const quantity = parseInt(l?.quantity, 10)
  if (!raceName) throw new BulkError('Which race is it for?')
  if (!Number.isInteger(raceYear) || raceYear < 2000 || raceYear > 2100) throw new BulkError(`${raceName}: the year does not look right`)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5000) throw new BulkError(`${raceName}: how many prints?`)
  const events = String(l?.eventNote ?? l?.events ?? '').trim().slice(0, 300) || null
  const frameType = FRAME_OPTIONS.includes(l?.frameType) ? l.frameType : 'Unframed'
  const productSize = SIZE_OPTIONS.includes(l?.productSize) ? l.productSize : '8x10'
  return { raceName: getCanonicalRaceName(raceName) || raceName, raceYear, quantity, events, frameType, productSize }
}

/** The form sends the race as `lines[0]` or flat on the body. */
const raceInput = input => (Array.isArray(input?.lines) ? input.lines[0] : input?.raceName ? input : null)

function termFields(input) {
  const partnerName = String(input?.partnerName || '').trim()
  if (!partnerName) throw new BulkError('Which organization is this for?')
  const kind = input?.discountKind === 'percent' || input?.discountKind === 'amount' ? input.discountKind : null
  const pct = kind === 'percent' ? Math.round(Number(input.discountPercent)) : null
  const cents = kind === 'amount' ? Math.round(Number(input.discountDollars) * 100) : null
  if (kind === 'percent' && !(pct > 0 && pct <= 100)) throw new BulkError('The discount percent should be between 1 and 100')
  if (kind === 'amount' && !(cents > 0)) throw new BulkError('The discount amount should be more than $0')
  const shipping = input?.shipping === 'organization' ? 'organization' : 'runner'
  const shipToAddress = shipping === 'organization' ? cleanAddress(input.shipToAddress) : null
  if (shipping === 'organization' && !(shipToAddress?.address1 && shipToAddress?.city && shipToAddress?.zip)) throw new BulkError('Give the address the prints ship to')
  return {
    partnerName,
    contactName: String(input?.contactName || '').trim() || null,
    contactEmail: String(input?.contactEmail || '').trim().toLowerCase() || null,
    contactPhone: String(input?.contactPhone || '').trim() || null,
    billingAddress: cleanAddress(input?.billingAddress),
    printKind: PRINT_KINDS.includes(input?.printKind) ? input.printKind : 'standard',
    discountKind: kind, discountPercent: pct, discountCents: cents,
    discountNote: String(input?.discountNote || '').trim() || null,
    shipping, shipToAddress,
    notes: String(input?.notes || '').trim() || null,
  }
}

// Prisma wants JSON columns cleared with DbNull, not null.
const json = v => v ?? Prisma.DbNull

/**
 * When the prints ship, typed in by us: an order can be for a race day, or for
 * Christmas gifts months later (Grandma's sponsors), so it is not worked out
 * from the race date. "YYYY-MM-DD" -> noon UTC, so it reads as that day anywhere.
 */
function fulfillmentDate(raw, { required = false } = {}) {
  const v = String(raw || '').trim()
  if (!v) { if (required) throw new BulkError('When should the prints ship? Set the fulfillment date'); return null }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(v)
  if (Number.isNaN(d.getTime())) throw new BulkError('The fulfillment date does not look right')
  return d
}

/** A new bulk order: the organization, the terms, one race and year. */
export async function createBulkOrder(input, actor) {
  const fields = termFields(input)
  const race = cleanRace(raceInput(input))
  const due = fulfillmentDate(input?.fulfillmentDate, { required: true })
  const last = await prisma.bulkOrder.findFirst({ orderBy: { createdAt: 'desc' }, select: { number: true } })
  const raceDate = verifiedRaceDate(race.raceName, race.raceYear)
  const order = await prisma.bulkOrder.create({
    data: {
      ...fields, billingAddress: json(fields.billingAddress), shipToAddress: json(fields.shipToAddress),
      ...race, number: nextNumber(last?.number), raceDate, dueDate: due || dueDateFor(raceDate),
      assigneeId: await defaultAssigneeFor('bulk'), createdById: actor?.id || null,
    },
  })
  return loadBilling(order.id)
}

/**
 * Edit the order after intake: the terms and the race. Only until the invoice
 * goes out; after that the customer has a price, and a change is a new
 * conversation with them. The fulfillment date and the notes move any time.
 */
export async function updateBulkOrder(id, input) {
  const order = await prisma.bulkOrder.findUnique({ where: { id: String(id || '') } })
  if (!order) throw new BulkError('Bulk order not found', 404)
  const due = fulfillmentDate(input?.fulfillmentDate)
  if (order.paidAt || order.invoiceSentAt) {
    await prisma.bulkOrder.update({ where: { id: order.id }, data: { ...(due ? { dueDate: due } : {}), ...(input?.notes !== undefined ? { notes: String(input.notes || '').trim() || null } : {}) } })
    return loadBilling(order.id)
  }
  const fields = termFields({ ...order, discountDollars: order.discountCents != null ? order.discountCents / 100 : undefined, ...input })
  const r = raceInput(input)
  const race = r ? cleanRace(r) : null
  const moved = race && (race.raceName !== order.raceName || race.raceYear !== order.raceYear)
  await prisma.bulkOrder.update({
    where: { id: order.id },
    data: {
      ...fields, billingAddress: json(fields.billingAddress), shipToAddress: json(fields.shipToAddress),
      ...(race || {}), ...(moved ? { raceDate: verifiedRaceDate(race.raceName, race.raceYear) } : {}),
      ...(due ? { dueDate: due } : {}),
    },
  })
  return loadBilling(order.id)
}

const BILLING_SELECT = {
  id: true, number: true, partnerName: true, raceName: true, raceYear: true, events: true, quantity: true, productSize: true, frameType: true,
  dueDate: true, raceDate: true, status: true, notes: true,
  contactName: true, contactEmail: true, contactPhone: true, billingAddress: true, printKind: true,
  discountKind: true, discountPercent: true, discountCents: true, currency: true, discountNote: true, shipping: true, shipToAddress: true,
  shopifyDraftId: true, shopifyDraftName: true, invoiceUrl: true, invoiceSentAt: true, shopifyOrderId: true, shopifyOrderName: true, paidAt: true,
  _count: { select: { runners: true } },
}

/** The order's terms and invoice, and a co-branded order's production file and its check. */
export async function loadBilling(id) {
  const order = await prisma.bulkOrder.findUnique({ where: { id: String(id || '') }, select: BILLING_SELECT })
  if (!order) throw new BulkError('Bulk order not found', 404)
  // Where to see the invoice ourselves: the draft (or the paid order) in Shopify admin. invoiceUrl is the customer's checkout.
  order.adminUrl = order.shopifyOrderId ? shopifyAdminUrl(String(order.shopifyOrderId).split('/').pop()) : shopifyDraftAdminUrl(order.shopifyDraftId)
  if (order.printKind !== 'cobranded') return order
  const t = await prisma.printTemplate.findUnique({ where: { key: templateKey(order.raceName, order.number) }, select: { fileVersion: true, lastCheckAt: true, lastCheckOk: true, lastCheckReport: true } })
  return { ...order, template: t ? { uploadedAt: t.fileVersion, checkedAt: t.lastCheckAt, ok: t.lastCheckOk, problems: t.lastCheckReport?.problems || [] } : null }
}

/**
 * Earlier bulk orders' details, newest per organization, to start a new one
 * from: contact, billing, shipping, print kind and (for admins) the discount.
 */
export async function pastDetails() {
  const orders = await prisma.bulkOrder.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  const seen = new Set()
  const out = []
  for (const d of orders) {
    const k = d.partnerName.trim().toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({
      partnerName: d.partnerName, contactName: d.contactName, contactEmail: d.contactEmail, contactPhone: d.contactPhone,
      billingAddress: d.billingAddress, printKind: d.printKind, shipping: d.shipping, shipToAddress: d.shipToAddress,
      discountKind: d.discountKind, discountPercent: d.discountPercent, discountCents: d.discountCents, discountNote: d.discountNote,
    })
  }
  return out
}

/** A co-branded order's production file: a signed upload link, then record it as the order's template. */
export async function productionFileUpload(id, fileName) {
  const order = await prisma.bulkOrder.findUnique({ where: { id: String(id || '') }, select: { number: true, printKind: true } })
  if (!order) throw new BulkError('Bulk order not found', 404)
  if (order.printKind !== 'cobranded') throw new BulkError('Only a co-branded order takes its own production file')
  if (!/\.ai$/i.test(String(fileName || ''))) throw new BulkError('Upload the Illustrator file (.ai)')
  return uploadTemplateUrl(order.number, fileName)
}

export async function productionFileSaved(id, path) {
  const order = await prisma.bulkOrder.findUnique({ where: { id: String(id || '') }, select: { number: true, raceName: true } })
  if (!order) throw new BulkError('Bulk order not found', 404)
  if (!String(path || '').startsWith(`cobranded/${order.number}/`)) throw new BulkError('That upload is not for this order')
  return saveUploadedTemplate({ raceName: order.raceName, runNumber: order.number, path })
}

/** The race's storefront product, and the variant for a size and frame. */
export async function variantFor(raceName, productSize, frameType) {
  const canonical = getCanonicalRaceName(raceName) || raceName
  const products = await prisma.shopifyProduct.findMany({ where: { raceCanonical: canonical, status: 'ACTIVE' }, select: { productId: true, title: true } })
  // The plain race print, not a World Majors or other edition sold beside it.
  const product = products.find(p => !/world majors|custom|bulk/i.test(p.title)) || products[0]
  if (!product) return { missing: `No storefront product for ${canonical}` }
  const d = await shopifyGraphQL(`query($id: ID!) { product(id: $id) { title variants(first: 50) { nodes { id price selectedOptions { name value } } } } }`, { id: `gid://shopify/Product/${product.productId}` })
  const p = (d.data || d).product
  const want = { size: productSize, frame: SHOP_FRAME[frameType] || frameType }
  const v = p?.variants?.nodes?.find(x => {
    const o = Object.fromEntries((x.selectedOptions || []).map(s => [s.name.toLowerCase(), s.value]))
    return o.size === want.size && String(o.frame || '').toLowerCase() === want.frame.toLowerCase()
  })
  if (!v) return { missing: `${p?.title || canonical} has no ${productSize} ${want.frame} variant` }
  return { productTitle: p.title, variantId: v.id, unitCents: Math.round(Number(v.price) * 100) }
}

/** What the invoice will say: the print priced from Shopify, the discount, the total. */
export async function quote(id) {
  const order = await loadBilling(id)
  const v = await variantFor(order.raceName, order.productSize, order.frameType)
  const line = {
    number: order.number, raceName: order.raceName, raceYear: order.raceYear, events: order.events,
    quantity: order.quantity, productSize: order.productSize, frameType: order.frameType,
    ...v, subtotalCents: v.unitCents ? v.unitCents * order.quantity : null,
  }
  const subtotalCents = line.subtotalCents || 0
  const discountCents = order.discountKind === 'percent' ? Math.round(subtotalCents * order.discountPercent / 100)
    : order.discountKind === 'amount' ? Math.min(order.discountCents, subtotalCents) : 0
  return { order, lines: [line], subtotalCents, discountCents, totalCents: subtotalCents - discountCents, currency: order.currency, missing: line.missing ? [line.missing] : [] }
}

function shopifyAddress(a, fallbackName) {
  if (!a) return undefined
  return {
    company: a.company || undefined, firstName: undefined, lastName: a.name || fallbackName || undefined,
    address1: a.address1 || undefined, address2: a.address2 || undefined, city: a.city || undefined,
    provinceCode: a.province || undefined, zip: a.zip || undefined, countryCode: (a.country || 'US').length === 2 ? (a.country || 'US').toUpperCase() : 'US',
    phone: a.phone || undefined,
  }
}

export function draftInput(q) {
  const { order, lines } = q
  const kindLabel = order.printKind === 'cobranded' ? 'Co-branded' : 'Standard'
  const input = {
    email: order.contactEmail || undefined,
    // The discount note is ours: it stays in the tool, never on anything Shopify holds.
    note: [`Bulk order ${order.number} for ${order.partnerName}.`, order.notes].filter(Boolean).join(' '),
    tags: ['bulk', order.number],
    lineItems: lines.map(l => ({
      variantId: l.variantId, quantity: l.quantity,
      customAttributes: [
        { key: 'Event', value: `${l.raceName} ${l.raceYear}` },
        { key: 'Prints', value: kindLabel },
        { key: 'Bulk order', value: l.number },
      ],
    })),
    shippingLine: { title: 'Free shipping', price: '0.00' },
    billingAddress: shopifyAddress(order.billingAddress, order.contactName),
    shippingAddress: shopifyAddress(order.shipping === 'organization' ? order.shipToAddress : order.billingAddress, order.contactName),
  }
  if (order.discountKind === 'percent') input.appliedDiscount = { valueType: 'PERCENTAGE', value: order.discountPercent, title: 'Bulk discount' }
  if (order.discountKind === 'amount') input.appliedDiscount = { valueType: 'FIXED_AMOUNT', value: order.discountCents / 100, title: 'Bulk discount' }
  return input
}

/**
 * Build (or rebuild) the order's Shopify draft order and keep its invoice link.
 * A paid order is left alone.
 */
export async function buildInvoice(id) {
  const q = await quote(id)
  if (q.missing.length) throw new BulkError(`Cannot invoice yet: ${q.missing.join('; ')}`)
  if (q.order.paidAt) throw new BulkError('This order is paid; its invoice is final')
  const input = draftInput(q)
  const fields = 'draftOrder { id name invoiceUrl status totalPriceSet { shopMoney { amount } } } userErrors { field message }'
  const d = q.order.shopifyDraftId
    ? await shopifyGraphQL(`mutation($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { ${fields} } }`, { id: q.order.shopifyDraftId, input })
    : await shopifyGraphQL(`mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { ${fields} } }`, { input })
  const out = (d.data || d)[q.order.shopifyDraftId ? 'draftOrderUpdate' : 'draftOrderCreate']
  if (out?.userErrors?.length) throw new BulkError(`Shopify: ${out.userErrors.map(e => e.message).join('; ')}`)
  const draft = out?.draftOrder
  if (!draft?.id) throw new BulkError('Shopify did not return the draft order')
  await prisma.bulkOrder.update({ where: { id: q.order.id }, data: { shopifyDraftId: draft.id, shopifyDraftName: draft.name, invoiceUrl: draft.invoiceUrl } })
  return { draftName: draft.name, invoiceUrl: draft.invoiceUrl, totalShopify: draft.totalPriceSet?.shopMoney?.amount, quote: q }
}

/** Shopify emails the invoice to the contact. */
export async function sendInvoice(id, { message } = {}) {
  const order = await loadBilling(id)
  if (!order.shopifyDraftId) throw new BulkError('Build the invoice first')
  if (!order.contactEmail) throw new BulkError('Add the contact email first')
  const d = await shopifyGraphQL(`mutation($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id } userErrors { field message } } }`, {
    id: order.shopifyDraftId,
    email: { to: order.contactEmail, subject: `Invoice from Trackstar: ${order.partnerName}`, customMessage: String(message || '').trim() || undefined },
  })
  const out = (d.data || d).draftOrderInvoiceSend
  if (out?.userErrors?.length) throw new BulkError(`Shopify: ${out.userErrors.map(e => e.message).join('; ')}`)
  await prisma.bulkOrder.update({ where: { id: order.id }, data: { invoiceSentAt: new Date() } })
  return { sentTo: order.contactEmail }
}

/**
 * An order that fell through: its runners, their research, the order and its
 * unpaid Shopify draft go. A paid order is refused: set it back to not paid
 * first, so a paid order cannot vanish by a misclick.
 */
export async function deleteRun(id) {
  const order = await prisma.bulkOrder.findUnique({ where: { id: String(id || '') } })
  if (!order) throw new BulkError('Bulk order not found', 404)
  if (order.paidAt) throw new BulkError('This order is marked paid. Set it back to not paid first if it really is off.')
  const runners = await prisma.order.findMany({ where: { bulkOrderId: order.id }, select: { id: true } })
  await prisma.runnerResearch.deleteMany({ where: { orderId: { in: runners.map(r => r.id) } } })
  await prisma.order.deleteMany({ where: { bulkOrderId: order.id } })
  await prisma.bulkOrder.delete({ where: { id: order.id } })

  const out = { number: order.number, partnerName: order.partnerName, runners: runners.length, draftDeleted: null, draftLeft: null }
  if (order.shopifyDraftId) {
    try {
      const d = await shopifyGraphQL('mutation($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { message } } }', { input: { id: order.shopifyDraftId } })
      if ((d.data || d).draftOrderDelete?.deletedId) out.draftDeleted = order.shopifyDraftName
      else out.draftLeft = order.shopifyDraftName
    } catch (e) {
      console.warn('[bulk] draft delete failed:', e.message)
      out.draftLeft = order.shopifyDraftName
    }
  }
  return out
}

/**
 * Where the invoice stands: not_sent (no invoice out yet), sent (emailed,
 * waiting on them), paid.
 */
export function paymentStatus(order) {
  if (order?.paidAt) return 'paid'
  return order?.invoiceSentAt ? 'sent' : 'not_sent'
}

/**
 * Read the draft order back from Shopify so the status follows it: emailed
 * from Shopify itself counts as sent, and a paid order marks the bulk order
 * paid without waiting for the import. Quiet on any Shopify error.
 */
export async function syncDraftStatus(id) {
  const order = await prisma.bulkOrder.findUnique({ where: { id: String(id || '') }, select: { id: true, number: true, shopifyDraftId: true, paidAt: true, invoiceSentAt: true } })
  if (!order?.shopifyDraftId || order.paidAt) return
  try {
    const d = await shopifyGraphQL(`query($id: ID!) { draftOrder(id: $id) { status invoiceSentAt order { legacyResourceId name displayFinancialStatus } } }`, { id: order.shopifyDraftId })
    const draft = (d.data || d).draftOrder
    if (!draft) return
    if (draft.invoiceSentAt && !order.invoiceSentAt) await prisma.bulkOrder.update({ where: { id: order.id }, data: { invoiceSentAt: new Date(draft.invoiceSentAt) } })
    const paid = draft.order
    if (paid && ['PAID', 'PARTIALLY_REFUNDED'].includes(paid.displayFinancialStatus)) {
      await markPaid(order.number, { shopifyOrderId: String(paid.legacyResourceId), shopifyOrderName: paid.name })
    }
  } catch (e) { console.warn('[bulk] draft status sync failed:', e.message) }
}

/**
 * Set by hand (the status pill): not sent clears the sent date and paid,
 * sent marks it emailed, paid marks it paid.
 */
export async function setPaymentStatus(id, status) {
  const order = await prisma.bulkOrder.findUnique({ where: { id: String(id || '') } })
  if (!order) throw new BulkError('Bulk order not found', 404)
  const now = new Date()
  if (status === 'paid') {
    await prisma.bulkOrder.update({ where: { id: order.id }, data: { paidAt: order.paidAt || now, invoiceSentAt: order.invoiceSentAt || now } })
  } else if (status === 'sent' || status === 'not_sent') {
    await prisma.bulkOrder.update({ where: { id: order.id }, data: { paidAt: null, invoiceSentAt: status === 'sent' ? (order.invoiceSentAt || now) : null } })
  } else throw new BulkError('Pick not sent, sent or paid')
}

/** Shopify says the order's invoice is paid (found by its number tag). */
export async function markPaid(number, { shopifyOrderId, shopifyOrderName }) {
  const order = await prisma.bulkOrder.findUnique({ where: { number } })
  if (!order) return null
  const taken = shopifyOrderId && await prisma.bulkOrder.findFirst({ where: { shopifyOrderId, NOT: { id: order.id } }, select: { id: true } })
  await prisma.bulkOrder.update({
    where: { id: order.id },
    data: { paidAt: order.paidAt || new Date(), shopifyOrderName, ...(taken ? {} : { shopifyOrderId }) },
  })
  return order
}
