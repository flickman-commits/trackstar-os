/**
 * Samples: send prints to people (creators, partners, press, friends) as real
 * Shopify orders, so they get Shopify's confirmation and shipping emails and
 * Artelo picks the order up like any other. Two ways to price it:
 *
 *   free     every item and the shipping at $0; the order is marked paid.
 *   at cost  each item at Artelo's production cost and shipping at Artelo's
 *            shipping plus branding; the order is left unpaid and Shopify
 *            emails the invoice.
 *
 * The personalization goes on each line item with the same property names
 * the storefront wizard writes ("Runner Name", "Race Year", "Bib #", "Time"),
 * so the import reads a sample exactly like a customer's order. Orders are
 * tagged "sample" (and "sample-at-cost").
 */
import { createHash } from 'crypto'
import prisma from '../../db.js'
import { shopifyGraphQL, SHOPIFY_API_VERSION } from '../../services/shopifyAuth.js'
import { printCatalog } from '../catalog/printCatalog.js'
import { arteloPriceCheck } from '../../services/arteloPriceCheck.js'
import { recordSampleCostSafely } from './costs.js'

const round = n => Math.round(n * 100) / 100
// orderCreate needs 2024-07 or later; the rest of the app stays on 2024-01.
const API = SHOPIFY_API_VERSION

/** The store's race prints (the shared catalog, server/domain/catalog/printCatalog.js). */
export const sampleCatalog = () => printCatalog()

/**
 * The at-cost price of an order, from Artelo's price check for the whole
 * order: each item at its production cost, and shipping as Artelo's shipping
 * for the shipment plus branding. `address` prices shipping to where it goes.
 */
export async function quoteAtCost(items, address = null) {
  const p = await arteloPriceCheck({ items, address })
  return {
    lines: items.map((it, i) => ({ variantId: it.variantId, unit: (p.perItem[i]?.productionCents || 0) / 100 })),
    shipping: round((p.shippingCents + p.brandingCents) / 100),
  }
}

const ORDER_CREATE = `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) { order { id name legacyResourceId totalPriceSet { shopMoney { amount } } } userErrors { field message } }
}`

function cleanAddress(a = {}) {
  const t = k => String(a[k] || '').trim()
  const out = { firstName: t('firstName'), lastName: t('lastName'), address1: t('address1'), address2: t('address2') || null, city: t('city'), provinceCode: t('province').toUpperCase() || null, zip: t('zip'), countryCode: (t('country') || 'US').toUpperCase(), phone: t('phone') || null }
  for (const k of ['firstName', 'address1', 'city', 'zip']) if (!out[k]) throw Object.assign(new Error(`The address needs a ${k === 'address1' ? 'street' : k === 'firstName' ? 'name' : k}`), { status: 400 })
  return out
}

/**
 * Create the sample order in Shopify.
 * @param {{ email, address, source?, items: [{ variantId, quantity, title?, size?, frame?, runnerName, raceYear, bib, time, unitPrice? }], mode: 'free'|'cost', shipping?, note?, sendEmails? }} input
 */
const SEND_ONCE_MS = 10 * 60_000

export async function sendSample(input, actor) {
  const email = String(input.email || '').trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('Add their email, so Shopify can send the order emails'), { status: 400 })
  const items = (Array.isArray(input.items) ? input.items : []).filter(it => it?.variantId)
  if (!items.length) throw Object.assign(new Error('Add at least one print'), { status: 400 })
  const atCost = input.mode === 'cost'
  const address = cleanAddress(input.address)

  const lineItems = items.map(it => {
    const props = [
      ['Runner Name', it.runnerName],
      ['Race Year', it.raceYear],
      ['Bib #', it.bib],
      ['Time', it.time],
    ].filter(([, v]) => String(v || '').trim()).map(([name, value]) => ({ name, value: String(value).trim() }))
    const price = atCost ? round(Number(it.unitPrice) || 0) : 0
    return {
      variantId: it.variantId,
      quantity: Math.max(1, Math.min(10, Number(it.quantity) || 1)),
      priceSet: { shopMoney: { amount: price.toFixed(2), currencyCode: 'USD' } },
      properties: props,
    }
  })
  const shipping = atCost ? round(Number(input.shipping) || 0) : 0
  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'the team'
  const order = {
    email,
    shippingAddress: address,
    billingAddress: address,
    lineItems,
    shippingLines: [{ title: atCost ? 'Shipping (at cost)' : 'Free sample shipping', priceSet: { shopMoney: { amount: shipping.toFixed(2), currencyCode: 'USD' } } }],
    financialStatus: atCost ? 'PENDING' : 'PAID',
    tags: [...(atCost ? ['sample', 'sample-at-cost'] : ['sample']), ...(input.source === 'creator' ? ['creator-sample'] : [])],
    note: [`Sample sent by ${by} from TrackstarOS${atCost ? ', at cost' : ', free'}.`, String(input.note || '').trim()].filter(Boolean).join('\n'),
    sourceName: 'trackstar-samples',
  }
  // Send once. A timeout after Shopify accepted the order, a double click, or
  // a retried call would otherwise create a second order and a second set of
  // emails. The same recipient, prints and mode within ten minutes is refused;
  // the claim is released if Shopify refuses, so a fixed retry still works.
  const fingerprint = createHash('sha256').update(JSON.stringify({ email: email.toLowerCase(), mode: atCost, lineItems, shipping })).digest('hex').slice(0, 24)
  const claimKey = `sample_sent:${fingerprint}`
  await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'sample_sent:' }, updatedAt: { lt: new Date(Date.now() - SEND_ONCE_MS) } } }).catch(() => {})
  try {
    await prisma.systemConfig.create({ data: { key: claimKey, value: new Date().toISOString() } })
  } catch (err) {
    if (err.code === 'P2002') throw Object.assign(new Error('This exact sample was sent in the last 10 minutes. Check Shopify before sending it again.'), { status: 409 })
    throw err
  }
  let d
  try {
    d = await shopifyGraphQL(ORDER_CREATE, { order, options: { sendReceipt: input.sendEmails !== false, sendFulfillmentReceipt: input.sendEmails !== false } }, { version: API })
  } catch (err) {
    // A timeout may still have created the order, so the claim stays.
    if (err.name !== 'TimeoutError') await prisma.systemConfig.delete({ where: { key: claimKey } }).catch(() => {})
    throw err
  }
  const res = (d.data || d).orderCreate
  if (res.userErrors?.length) {
    await prisma.systemConfig.delete({ where: { key: claimKey } }).catch(() => {})
    throw Object.assign(new Error(`Shopify: ${res.userErrors.map(e => e.message).join('; ')}`), { status: 400 })
  }
  const created = res.order
  let invoiced = false
  if (atCost && Number(created.totalPriceSet.shopMoney.amount) > 0) {
    const inv = await shopifyGraphQL(`mutation($id: ID!) { orderInvoiceSend(id: $id) { order { id } userErrors { field message } } }`, { id: created.id }, { version: API })
    const errs = (inv.data || inv).orderInvoiceSend.userErrors
    if (errs?.length) throw Object.assign(new Error(`Order ${created.name} was created, but the invoice failed: ${errs.map(e => e.message).join('; ')}`), { status: 400 })
    invoiced = true
  }
  const totalPaid = Number(created.totalPriceSet.shopMoney.amount)
  // What it cost us, for the monthly sample spend. Never fails the send.
  const cost = await recordSampleCostSafely({
    source: input.source || 'samples_tool', creatorId: input.creatorId || null, orderName: created.name,
    recipient: [address.firstName, address.lastName].filter(Boolean).join(' '), email,
    chargedCents: Math.round(totalPaid * 100), createdById: actor?.id || null,
  }, items.map(it => ({ title: it.title, size: it.size, frame: it.frame, quantity: it.quantity })),
  { name: [address.firstName, address.lastName].filter(Boolean).join(' '), address1: address.address1, address2: address.address2, city: address.city, province: address.provinceCode, zip: address.zip, country: address.countryCode })
  return { name: created.name, id: created.legacyResourceId, total: totalPaid, invoiced, costCents: cost?.costCents ?? null, adminUrl: `https://admin.shopify.com/store/flickman-3247/orders/${created.legacyResourceId}` }
}
