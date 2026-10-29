/**
 * Bulk deals: one organization's order across any races and events, and its
 * Shopify invoice.
 *
 * A deal is what was agreed with them: who they are, standard prints (our
 * race design, rendered by the worker) or co-branded (their design, made by
 * the designer), the discount, and where the prints ship. Each race and event
 * is a line, stored as a BulkOrder run, so the runner list, research, design
 * and Artelo sheet work per line exactly as before (bulkOrders.js).
 *
 * The invoice is a Shopify draft order built from the real products: each
 * line is the race's product in the line's size and frame, at its quantity,
 * with the event noted on the line, the discount applied, shipping free, and
 * tags "bulk" plus the deal and run numbers. Once they pay, the draft becomes
 * an order carrying those tags, and shopifyBulk.js marks the deal and its
 * runs paid by the deal number (never by partner name). Prices are Shopify's,
 * read live; money here is integer cents (CLAUDE.md).
 */
import { templateKey, uploadTemplateUrl, saveUploadedTemplate } from '../render/templates.js'
import prisma from '../../db.js'
import { shopifyAdminUrl, shopifyDraftAdminUrl } from '../../lib/links.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { nextNumber, dueDateFor, verifiedRaceDate, FRAME_OPTIONS, SIZE_OPTIONS } from './bulkOrders.js'
import { defaultAssigneeFor } from '../orders/assignment.js'

export class DealError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const EVENT_OPTIONS = ['Marathon', 'Half Marathon', '10 Miler', '10K', '8K', '5K']
export const PRINT_KINDS = ['standard', 'cobranded']

/** Our frame value -> the Frame option on the storefront products. */
const SHOP_FRAME = { 'Unframed': 'Unframed', 'Natural Premium Oak': 'Natural Oak', 'Black Premium Oak': 'Black Oak' }

function nextDealNumber(last) {
  const n = last ? parseInt(String(last).replace(/\D/g, ''), 10) || 0 : 0
  return `DEAL-${String(n + 1).padStart(4, '0')}`
}

const cleanAddress = a => {
  if (!a || typeof a !== 'object') return null
  const out = {}
  for (const k of ['company', 'name', 'address1', 'address2', 'city', 'province', 'zip', 'country', 'phone']) out[k] = String(a[k] || '').trim()
  return out.address1 || out.city ? out : null
}

function cleanLine(l) {
  const raceName = String(l?.raceName || '').trim()
  const raceYear = Number(l?.raceYear)
  const quantity = parseInt(l?.quantity, 10)
  if (!raceName) throw new DealError('Every line needs a race')
  if (!Number.isInteger(raceYear) || raceYear < 2000 || raceYear > 2100) throw new DealError(`${raceName}: the year does not look right`)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5000) throw new DealError(`${raceName}: how many prints?`)
  // One line per race and year, whatever the events: the lookup finds which
  // race each runner ran. Which events were sold is a note for us.
  const eventNote = String(l?.eventNote || '').trim().slice(0, 300) || null
  const frameType = FRAME_OPTIONS.includes(l?.frameType) ? l.frameType : 'Unframed'
  const productSize = SIZE_OPTIONS.includes(l?.productSize) ? l.productSize : '8x10'
  return { raceName: getCanonicalRaceName(raceName) || raceName, raceYear, quantity, eventNote, frameType, productSize }
}

/** The same print (race, year, size, frame) twice is one line with the quantities added. */
function oneLinePerPrint(lines) {
  const seen = new Set()
  for (const l of lines) {
    const k = [l.raceName, l.raceYear, l.productSize, l.frameType].join('|')
    if (seen.has(k)) throw new DealError(`${l.raceName} ${l.raceYear} ${l.productSize} ${l.frameType} is on two lines. Put it on one and note the events.`)
    seen.add(k)
  }
  return lines
}

function dealFields(input) {
  const partnerName = String(input?.partnerName || '').trim()
  if (!partnerName) throw new DealError('Which organization is this for?')
  const kind = input?.discountKind === 'percent' || input?.discountKind === 'amount' ? input.discountKind : null
  const pct = kind === 'percent' ? Math.round(Number(input.discountPercent)) : null
  const cents = kind === 'amount' ? Math.round(Number(input.discountDollars) * 100) : null
  if (kind === 'percent' && !(pct > 0 && pct <= 100)) throw new DealError('The discount percent should be between 1 and 100')
  if (kind === 'amount' && !(cents > 0)) throw new DealError('The discount amount should be more than $0')
  const shipping = input?.shipping === 'organization' ? 'organization' : 'runner'
  const shipToAddress = shipping === 'organization' ? cleanAddress(input.shipToAddress) : null
  if (shipping === 'organization' && !(shipToAddress?.address1 && shipToAddress?.city && shipToAddress?.zip)) throw new DealError('Give the address the prints ship to')
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

/**
 * When the prints ship, typed in by us: an order can be for a race day, or for
 * Christmas gifts months later (Grandma's sponsors), so it is not worked out
 * from the race date. "YYYY-MM-DD" -> noon UTC, so it reads as that day anywhere.
 */
function fulfillmentDate(raw, { required = false } = {}) {
  const v = String(raw || '').trim()
  if (!v) { if (required) throw new DealError('When should the prints ship? Set the fulfillment date'); return null }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(v)
  if (Number.isNaN(d.getTime())) throw new DealError('The fulfillment date does not look right')
  return d
}

/**
 * Create a bulk order: its billing record (BulkDeal; never shown as a deal,
 * one per order) and its run (BulkOrder), one race and year.
 */
export async function createDeal(input, actor) {
  const fields = dealFields(input)
  const lines = oneLinePerPrint((Array.isArray(input?.lines) ? input.lines : []).map(cleanLine))
  if (!lines.length) throw new DealError('Which race is it for?')
  const due = fulfillmentDate(input?.fulfillmentDate, { required: true })
  for (const l of lines) l.dueDate = due
  const lastDeal = await prisma.bulkDeal.findFirst({ orderBy: { createdAt: 'desc' }, select: { number: true } })
  const deal = await prisma.bulkDeal.create({ data: { ...fields, number: nextDealNumber(lastDeal?.number), createdById: actor?.id || null } })
  const assigneeId = await defaultAssigneeFor('bulk')
  for (const l of lines) await createRun(deal.id, fields.partnerName, l, assigneeId)
  return loadDeal(deal.id)
}

async function createRun(dealId, partnerName, l, assigneeId) {
  const last = await prisma.bulkOrder.findFirst({ orderBy: { createdAt: 'desc' }, select: { number: true } })
  const raceDate = verifiedRaceDate(l.raceName, l.raceYear)
  await prisma.bulkOrder.create({
    data: {
      number: nextNumber(last?.number), dealId, partnerName,
      raceName: l.raceName, raceYear: l.raceYear, eventType: null, notes: l.eventNote, quantity: l.quantity,
      frameType: l.frameType, productSize: l.productSize, raceDate, dueDate: l.dueDate || dueDateFor(raceDate), assigneeId,
    },
  })
}

/**
 * The lines as edited: a line with an id changes that run, one without adds a
 * run, and a run left out is removed, unless its list already has names.
 */
async function replaceLines(deal, input, partnerName) {
  const lines = oneLinePerPrint(input.map(l => ({ id: l?.id ? String(l.id) : null, ...cleanLine(l) })))
  if (!lines.length) throw new DealError('Add at least one race')
  const runs = await prisma.bulkOrder.findMany({ where: { dealId: deal.id }, select: { id: true, number: true, raceName: true, raceYear: true, _count: { select: { runners: true } } } })
  const keep = new Set(lines.map(l => l.id).filter(Boolean))
  const gone = runs.filter(r => !keep.has(r.id))
  const named = gone.find(r => r._count.runners > 0)
  if (named) throw new DealError(`${named.raceName} ${named.raceYear} (${named.number}) already has names on its list, so it cannot be removed here`)
  if (gone.length) await prisma.bulkOrder.deleteMany({ where: { id: { in: gone.map(r => r.id) } } })
  const assigneeId = await defaultAssigneeFor('bulk')
  for (const l of lines) {
    const run = l.id && runs.find(r => r.id === l.id)
    if (!run) { await createRun(deal.id, partnerName, l, assigneeId); continue }
    const moved = run.raceName !== l.raceName || run.raceYear !== l.raceYear
    const raceDate = moved ? verifiedRaceDate(l.raceName, l.raceYear) : undefined
    await prisma.bulkOrder.update({
      where: { id: run.id },
      data: {
        raceName: l.raceName, raceYear: l.raceYear, eventType: null, notes: l.eventNote, quantity: l.quantity,
        frameType: l.frameType, productSize: l.productSize,
        ...(moved ? { raceDate } : {}),
      },
    })
  }
}

/**
 * Edit the deal after intake: the terms and, when `lines` is sent, its lines.
 * Only until the invoice goes out; after that the customer has a price, and a
 * change is a new conversation with them.
 */
export async function updateDeal(id, input) {
  const deal = await prisma.bulkDeal.findUnique({ where: { id: String(id || '') } })
  if (!deal) throw new DealError('Bulk order not found', 404)
  // The fulfillment date and the notes can move at any time; what is on the invoice cannot once it is out.
  const due = fulfillmentDate(input?.fulfillmentDate)
  if (due) await prisma.bulkOrder.updateMany({ where: { dealId: deal.id }, data: { dueDate: due } })
  if (deal.paidAt || deal.invoiceSentAt) {
    if (input?.notes !== undefined) await prisma.bulkDeal.update({ where: { id: deal.id }, data: { notes: String(input.notes || '').trim() || null } })
    return loadDeal(deal.id)
  }
  const fields = dealFields({ ...deal, discountDollars: deal.discountCents != null ? deal.discountCents / 100 : undefined, ...input })
  if (Array.isArray(input?.lines)) await replaceLines(deal, input.lines, fields.partnerName)
  await prisma.bulkDeal.update({ where: { id: deal.id }, data: fields })
  await prisma.bulkOrder.updateMany({ where: { dealId: deal.id }, data: { partnerName: fields.partnerName } })
  return loadDeal(deal.id)
}

export async function loadDeal(id) {
  const deal = await prisma.bulkDeal.findUnique({
    where: { id: String(id || '') },
    include: { runs: { orderBy: { number: 'asc' }, select: { id: true, number: true, raceName: true, raceYear: true, eventType: true, notes: true, dueDate: true, raceDate: true, quantity: true, productSize: true, frameType: true, paidAt: true, status: true, _count: { select: { runners: true } } } } },
  })
  if (!deal) throw new DealError('Bulk order not found', 404)
  // Where to see the invoice ourselves: the draft (or the paid order) in Shopify admin. invoiceUrl is the customer's checkout.
  deal.adminUrl = deal.shopifyOrderId ? shopifyAdminUrl(String(deal.shopifyOrderId).split('/').pop()) : shopifyDraftAdminUrl(deal.shopifyDraftId)
  if (deal.printKind !== 'cobranded') return deal
  // Each co-branded line's own production file and its check (render/templates.js).
  const keys = deal.runs.map(r => templateKey(r.raceName, r.number))
  const templates = await prisma.printTemplate.findMany({ where: { key: { in: keys } }, select: { key: true, fileVersion: true, lastCheckAt: true, lastCheckOk: true, lastCheckReport: true } })
  return {
    ...deal,
    runs: deal.runs.map(r => {
      const t = templates.find(x => x.key === templateKey(r.raceName, r.number))
      return { ...r, template: t ? { uploadedAt: t.fileVersion, checkedAt: t.lastCheckAt, ok: t.lastCheckOk, problems: t.lastCheckReport?.problems || [] } : null }
    }),
  }
}

/**
 * A billing record for a bulk order made without one (from a Shopify order,
 * or before every order had one): the organization, co-branded, paid when the
 * run is. scripts/backfill-bulk-billing.js did the same for the old ones.
 */
export async function attachBilling(run) {
  if (!run || run.dealId) return run
  const last = await prisma.bulkDeal.findFirst({ orderBy: { createdAt: 'desc' }, select: { number: true } })
  const deal = await prisma.bulkDeal.create({
    data: { number: nextDealNumber(last?.number), partnerName: run.partnerName, printKind: 'cobranded', shipping: 'runner', paidAt: run.paidAt || null },
  })
  return prisma.bulkOrder.update({ where: { id: run.id }, data: { dealId: deal.id } })
}

/**
 * Earlier bulk orders' details, newest per organization, to start a new one
 * from: contact, billing, shipping, print kind and (for admins) the discount.
 */
export async function pastDetails() {
  const deals = await prisma.bulkDeal.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  const seen = new Set()
  const out = []
  for (const d of deals) {
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

/** A co-branded line's production file: a signed upload link, then record it as the line's template. */
export async function lineTemplateUpload(runId, fileName) {
  const run = await prisma.bulkOrder.findUnique({ where: { id: String(runId || '') }, select: { number: true, deal: { select: { printKind: true } } } })
  if (!run) throw new DealError('Line not found', 404)
  if (run.deal?.printKind !== 'cobranded') throw new DealError('Only a co-branded line takes its own production file')
  if (!/\.ai$/i.test(String(fileName || ''))) throw new DealError('Upload the Illustrator file (.ai)')
  return uploadTemplateUrl(run.number, fileName)
}

export async function lineTemplateSaved(runId, path) {
  const run = await prisma.bulkOrder.findUnique({ where: { id: String(runId || '') }, select: { number: true, raceName: true } })
  if (!run) throw new DealError('Line not found', 404)
  if (!String(path || '').startsWith(`cobranded/${run.number}/`)) throw new DealError('That upload is not for this line')
  return saveUploadedTemplate({ raceName: run.raceName, runNumber: run.number, path })
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

/** What the invoice will say: each line priced from Shopify, the discount, the total. */
export async function quoteDeal(id) {
  const deal = await loadDeal(id)
  const lines = []
  for (const r of deal.runs) {
    const v = await variantFor(r.raceName, r.productSize, r.frameType)
    lines.push({
      runId: r.id, number: r.number, raceName: r.raceName, raceYear: r.raceYear, eventType: r.eventType || null,
      quantity: r.quantity, productSize: r.productSize, frameType: r.frameType,
      ...v, subtotalCents: v.unitCents ? v.unitCents * r.quantity : null,
    })
  }
  const subtotalCents = lines.reduce((n, l) => n + (l.subtotalCents || 0), 0)
  const discountCents = deal.discountKind === 'percent' ? Math.round(subtotalCents * deal.discountPercent / 100)
    : deal.discountKind === 'amount' ? Math.min(deal.discountCents, subtotalCents) : 0
  return { deal, lines, subtotalCents, discountCents, totalCents: subtotalCents - discountCents, currency: deal.currency, missing: lines.filter(l => l.missing).map(l => l.missing) }
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
  const { deal, lines } = q
  const kindLabel = deal.printKind === 'cobranded' ? 'Co-branded' : 'Standard'
  const input = {
    email: deal.contactEmail || undefined,
    // The discount note is ours: it stays in the tool, never on anything Shopify holds.
    note: [`Bulk order ${deal.number} for ${deal.partnerName}.`, deal.notes].filter(Boolean).join(' '),
    tags: ['bulk', deal.number, ...lines.map(l => l.number)],
    lineItems: lines.map(l => ({
      variantId: l.variantId, quantity: l.quantity,
      customAttributes: [
        { key: 'Event', value: `${l.raceName} ${l.raceYear}${l.eventType ? `, ${l.eventType}` : ''}` },
        { key: 'Prints', value: kindLabel },
        { key: 'Bulk run', value: l.number },
      ],
    })),
    shippingLine: { title: 'Free shipping', price: '0.00' },
    billingAddress: shopifyAddress(deal.billingAddress, deal.contactName),
    shippingAddress: shopifyAddress(deal.shipping === 'organization' ? deal.shipToAddress : deal.billingAddress, deal.contactName),
  }
  if (deal.discountKind === 'percent') input.appliedDiscount = { valueType: 'PERCENTAGE', value: deal.discountPercent, title: 'Bulk discount' }
  if (deal.discountKind === 'amount') input.appliedDiscount = { valueType: 'FIXED_AMOUNT', value: deal.discountCents / 100, title: 'Bulk discount' }
  return input
}

/**
 * Build (or rebuild) the deal's Shopify draft order and keep its invoice link.
 * A draft that is already paid is left alone.
 */
export async function buildInvoice(id) {
  const q = await quoteDeal(id)
  if (q.missing.length) throw new DealError(`Cannot invoice yet: ${q.missing.join('; ')}`)
  if (q.deal.paidAt) throw new DealError('This order is paid; its invoice is final')
  const input = draftInput(q)
  const fields = 'draftOrder { id name invoiceUrl status totalPriceSet { shopMoney { amount } } } userErrors { field message }'
  const d = q.deal.shopifyDraftId
    ? await shopifyGraphQL(`mutation($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { ${fields} } }`, { id: q.deal.shopifyDraftId, input })
    : await shopifyGraphQL(`mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { ${fields} } }`, { input })
  const out = (d.data || d)[q.deal.shopifyDraftId ? 'draftOrderUpdate' : 'draftOrderCreate']
  if (out?.userErrors?.length) throw new DealError(`Shopify: ${out.userErrors.map(e => e.message).join('; ')}`)
  const draft = out?.draftOrder
  if (!draft?.id) throw new DealError('Shopify did not return the draft order')
  await prisma.bulkDeal.update({ where: { id: q.deal.id }, data: { shopifyDraftId: draft.id, shopifyDraftName: draft.name, invoiceUrl: draft.invoiceUrl } })
  return { draftName: draft.name, invoiceUrl: draft.invoiceUrl, totalShopify: draft.totalPriceSet?.shopMoney?.amount, quote: q }
}

/** Shopify emails the invoice to the contact. */
export async function sendInvoice(id, { message } = {}) {
  const deal = await loadDeal(id)
  if (!deal.shopifyDraftId) throw new DealError('Build the invoice first')
  if (!deal.contactEmail) throw new DealError('Add the contact email first')
  const d = await shopifyGraphQL(`mutation($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id } userErrors { field message } } }`, {
    id: deal.shopifyDraftId,
    email: { to: deal.contactEmail, subject: `Invoice from Trackstar: ${deal.partnerName}`, customMessage: String(message || '').trim() || undefined },
  })
  const out = (d.data || d).draftOrderInvoiceSend
  if (out?.userErrors?.length) throw new DealError(`Shopify: ${out.userErrors.map(e => e.message).join('; ')}`)
  await prisma.bulkDeal.update({ where: { id: deal.id }, data: { invoiceSentAt: new Date() } })
  return { sentTo: deal.contactEmail }
}

/**
 * A line that did not happen: its runners, their research, and the line go.
 * The last line takes its deal with it, and the deal's unpaid Shopify draft
 * is deleted too. A paid line is refused: set it back to not paid first, so a
 * paid order cannot vanish by a misclick.
 */
export async function deleteRun(runId) {
  const run = await prisma.bulkOrder.findUnique({ where: { id: String(runId || '') }, include: { deal: { include: { runs: { select: { id: true } } } } } })
  if (!run) throw new DealError('Bulk order not found', 404)
  if (run.paidAt || run.deal?.paidAt) throw new DealError('This order is marked paid. Set it back to not paid first if it really is off.')
  const runners = await prisma.order.findMany({ where: { bulkOrderId: run.id }, select: { id: true } })
  await prisma.runnerResearch.deleteMany({ where: { orderId: { in: runners.map(r => r.id) } } })
  await prisma.order.deleteMany({ where: { bulkOrderId: run.id } })
  await prisma.bulkOrder.delete({ where: { id: run.id } })

  const deal = run.deal
  const out = { number: run.number, partnerName: run.partnerName, runners: runners.length, dealDeleted: null, draftDeleted: null, draftLeft: null }
  if (!deal) return out
  if (deal.runs.length > 1) {
    // The other lines stay; the invoice still lists this one until it is rebuilt.
    if (deal.shopifyDraftId) out.draftLeft = deal.shopifyDraftName
    return out
  }
  if (deal.shopifyDraftId) {
    try {
      const d = await shopifyGraphQL('mutation($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { message } } }', { input: { id: deal.shopifyDraftId } })
      const del = (d.data || d).draftOrderDelete
      if (del?.deletedId) out.draftDeleted = deal.shopifyDraftName
      else out.draftLeft = deal.shopifyDraftName
    } catch (e) {
      console.warn('[bulk] draft delete failed:', e.message)
      out.draftLeft = deal.shopifyDraftName
    }
  }
  await prisma.bulkDeal.delete({ where: { id: deal.id } })
  out.dealDeleted = deal.number
  return out
}

/** Shopify says the deal's order is paid: the deal and every run are paid. */
/**
 * Where the invoice stands, from the order's billing record:
 * not_sent (no invoice out yet), sent (emailed, waiting on them), paid.
 */
export function paymentStatus(run, deal) {
  if (run?.paidAt || deal?.paidAt) return 'paid'
  return deal?.invoiceSentAt ? 'sent' : 'not_sent'
}

/**
 * Read the draft order back from Shopify so the status follows it: emailed
 * from Shopify itself counts as sent, and a paid order marks the bulk order
 * paid without waiting for the import. Quiet on any Shopify error.
 */
export async function syncDraftStatus(dealId) {
  const deal = await prisma.bulkDeal.findUnique({ where: { id: String(dealId || '') } })
  if (!deal?.shopifyDraftId || deal.paidAt) return deal
  try {
    const d = await shopifyGraphQL(`query($id: ID!) { draftOrder(id: $id) { status invoiceSentAt order { legacyResourceId name displayFinancialStatus } } }`, { id: deal.shopifyDraftId })
    const draft = (d.data || d).draftOrder
    if (!draft) return deal
    if (draft.invoiceSentAt && !deal.invoiceSentAt) await prisma.bulkDeal.update({ where: { id: deal.id }, data: { invoiceSentAt: new Date(draft.invoiceSentAt) } })
    const order = draft.order
    if (order && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.displayFinancialStatus)) {
      await markDealPaid(deal.number, { shopifyOrderId: String(order.legacyResourceId), shopifyOrderName: order.name })
    }
  } catch (e) { console.warn('[bulk] draft status sync failed:', e.message) }
  return prisma.bulkDeal.findUnique({ where: { id: deal.id } })
}

/**
 * Set by hand (the status pill): not sent clears the sent date and paid,
 * sent marks it emailed, paid marks the order and its runs paid.
 */
export async function setPaymentStatus(dealId, status) {
  const deal = await prisma.bulkDeal.findUnique({ where: { id: String(dealId || '') } })
  if (!deal) throw new DealError('Bulk order not found', 404)
  const now = new Date()
  if (status === 'paid') {
    await prisma.bulkDeal.update({ where: { id: deal.id }, data: { paidAt: deal.paidAt || now, invoiceSentAt: deal.invoiceSentAt || now } })
    await prisma.bulkOrder.updateMany({ where: { dealId: deal.id, paidAt: null }, data: { paidAt: now } })
  } else if (status === 'sent' || status === 'not_sent') {
    await prisma.bulkDeal.update({ where: { id: deal.id }, data: { paidAt: null, invoiceSentAt: status === 'sent' ? (deal.invoiceSentAt || now) : null } })
    await prisma.bulkOrder.updateMany({ where: { dealId: deal.id }, data: { paidAt: null } })
  } else throw new DealError('Pick not sent, sent or paid')
}

export async function markDealPaid(dealNumber, { shopifyOrderId, shopifyOrderName }) {
  const deal = await prisma.bulkDeal.findUnique({ where: { number: dealNumber } })
  if (!deal) return null
  const now = new Date()
  await prisma.bulkDeal.update({ where: { id: deal.id }, data: { shopifyOrderId, shopifyOrderName, paidAt: deal.paidAt || now } })
  await prisma.bulkOrder.updateMany({ where: { dealId: deal.id, paidAt: null }, data: { paidAt: now } })
  await prisma.bulkOrder.updateMany({ where: { dealId: deal.id, shopifyOrderId: null }, data: { shopifyOrderName } })
  return deal
}
