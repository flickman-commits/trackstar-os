/**
 * Change a print's size or frame on an order (scenario 18: "I ordered the
 * wrong size"). Only before production; after that it is a reprint.
 *
 * Shopify, the way the team does it by hand:
 *   1. Edit the order: the old line item to quantity 0, the new variant (same
 *      product, the new size and/or frame) added with the same quantity.
 *      Shopify's order editing cannot carry line-item properties onto the new
 *      item, so:
 *   2. Every personalization field from the old item goes into the order's
 *      note, so nothing is lost in the swap.
 *   3. If the new item costs more, Shopify's invoice for the balance is
 *      emailed to the customer.
 * The discount the customer had on the old item (a code, the second-print
 * deal) carries onto the new one, so they are billed only the price
 * difference: a same-price frame swap costs nothing. Without it, order 6021
 * was invoiced $37.32 for Black Oak to Natural Oak (2026-10-26).
 *
 * Artelo follows the Shopify order: it drops the old item and lists the new
 * one, and the next import moves the print's details onto it
 * (reconcileEditedOrder in processOrders.js). Our rows get the new size and
 * frame and a comment right away, so the dashboard and the render match. An
 * approved print still waiting to send is pushed back until that import.
 *
 * Used from Support (with a thread) and from the order view's frame chip
 * (with orderRowId, the print to change).
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { UserError } from './errors.js'
import { call as artelo } from '../render/artelo.js'

const VERSION = '2025-01'
const SEND_DELAY_MIN = 20

const ORDER = `query($id: ID!) { order(id: $id) {
  id name note displayFulfillmentStatus cancelledAt
  lineItems(first: 20) { nodes { id title quantity currentQuantity unfulfilledQuantity customAttributes { key value }
    originalUnitPriceSet { shopMoney { amount } } discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
    variant { id price selectedOptions { name value } product { id variants(first: 100) { nodes { id price availableForSale selectedOptions { name value } } } } } } }
} }`

const actorName = a => [a?.firstName, a?.lastName].filter(Boolean).join(' ') || 'Someone'
const opt = (v, name) => (v?.selectedOptions || []).find(o => o.name.toLowerCase() === name)?.value || null
const gid = id => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Order/${id}`)

async function gql(query, variables, path) {
  const d = await shopifyGraphQL(query, variables, { version: VERSION })
  const data = d.data || d
  const node = path.split('.').reduce((x, k) => x?.[k], data)
  const errs = node?.userErrors || []
  if (errs.length) throw new UserError(`Shopify: ${errs.map(e => e.message).join('; ')}`)
  return node
}

/** The Shopify line of one of our rows: Artelo's orderItemId is the Shopify line id. */
async function lineOfRow(orderRowId) {
  const row = await prisma.order.findUnique({ where: { id: String(orderRowId || '') }, select: { id: true, source: true, parentOrderNumber: true, lineItemIndex: true, arteloOrderData: true } })
  if (!row) throw new UserError('Order not found', { status: 404 })
  if (row.source !== 'shopify') throw new UserError('Only Shopify orders can be changed here. Change it in Etsy and Artelo by hand.')
  const line = row.arteloOrderData?.orderItems?.[row.lineItemIndex]?.orderItemId
  if (!line) throw new UserError('Could not find this print on the Shopify order')
  return { row, shopifyOrderId: row.parentOrderNumber, lineItemId: `gid://shopify/LineItem/${line}` }
}

/** The frames one of our prints can change to, at its size. */
export async function frameChoices({ orderRowId }) {
  const { lineItemId, shopifyOrderId } = await lineOfRow(orderRowId)
  const order = await gql(ORDER, { id: gid(shopifyOrderId) }, 'order')
  const li = order?.lineItems.nodes.find(l => l.id === lineItemId && l.currentQuantity > 0)
  if (!li?.variant) throw new UserError('This print is no longer on the Shopify order. Wait for the next import, then try again.')
  const size = opt(li.variant, 'size'), frame = opt(li.variant, 'frame')
  const frames = li.variant.product.variants.nodes
    .filter(v => opt(v, 'size') === size && opt(v, 'frame') && opt(v, 'frame') !== frame && v.availableForSale !== false)
    .map(v => ({ frame: opt(v, 'frame'), difference: Math.round((Number(v.price) - Number(li.variant.price)) * 100) / 100 }))
  return { size, current: frame, frames }
}

/** The print line items on an order, with their size and frame, for the form. */
export async function changeItemPrep({ shopifyOrderId }) {
  const order = await gql(ORDER, { id: gid(shopifyOrderId) }, 'order')
  if (!order) throw new UserError('No such Shopify order')
  const items = order.lineItems.nodes.filter(li => li.currentQuantity > 0 && opt(li.variant, 'size')).map(li => {
    const variants = li.variant.product.variants.nodes
    return {
      lineItemId: li.id,
      title: li.title,
      size: opt(li.variant, 'size'),
      frame: opt(li.variant, 'frame'),
      sizes: [...new Set(variants.map(v => opt(v, 'size')).filter(Boolean))],
      frames: [...new Set(variants.map(v => opt(v, 'frame')).filter(Boolean))],
    }
  })
  return { name: order.name, fulfilled: order.displayFulfillmentStatus === 'FULFILLED', items }
}

export async function changeItem({ thread = null, orderRowId = null, shopifyOrderId, lineItemId, size, frame, actor }) {
  let picked = null
  if (orderRowId) ({ row: picked, shopifyOrderId, lineItemId } = await lineOfRow(orderRowId))
  const id = gid(shopifyOrderId)
  const numericId = id.split('/').pop()

  // Before production only. Once it is made, it is a reprint (Matt's call).
  const rows = await prisma.order.findMany({ where: { source: 'shopify', parentOrderNumber: numericId }, select: { id: true, lineItemIndex: true, status: true, designStatus: true, trackingNumber: true, arteloOrderData: true } })
  const tooLate = 'That order has already gone to production, so the size or frame cannot be changed now. It would be a reprint.'
  if (rows.some(r => r.status === 'completed' || r.designStatus === 'sent_to_production' || r.trackingNumber)) throw new UserError(tooLate)
  if (await prisma.renderJob.findFirst({ where: { order: { source: 'shopify', parentOrderNumber: numericId }, arteloSentAt: { not: null } }, select: { id: true } })) throw new UserError(tooLate)
  // Artelo follows the edit only while the order is waiting on us.
  const arteloId = rows.find(r => r.arteloOrderData?.id)?.arteloOrderData.id
  if (arteloId) {
    const live = await artelo('orders/get-by-id', { query: { orderId: arteloId } }).catch(() => null)
    if (live?.status && live.status !== 'PendingFulfillmentAction') throw new UserError(tooLate)
  }

  const order = await gql(ORDER, { id }, 'order')
  if (!order) throw new UserError('No such Shopify order')
  if (order.cancelledAt) throw new UserError('That order is cancelled')
  if (order.displayFulfillmentStatus === 'FULFILLED') throw new UserError('Shopify says that order is fulfilled already')
  const prints = order.lineItems.nodes.filter(li => li.currentQuantity > 0 && opt(li.variant, 'size'))
  const old = lineItemId ? prints.find(li => li.id === lineItemId) : prints.length === 1 ? prints[0] : null
  if (!old) throw new UserError(prints.length ? 'Pick which print on the order to change' : 'No print on that order to change')
  if (old.unfulfilledQuantity < old.quantity) throw new UserError('That print has been fulfilled, so it cannot be changed')

  const fromSize = opt(old.variant, 'size'), fromFrame = opt(old.variant, 'frame')
  const toSize = String(size || fromSize).trim(), toFrame = String(frame || fromFrame || '').trim()
  if (toSize === fromSize && (toFrame || null) === (fromFrame || null)) throw new UserError('That is the size and frame it already is')
  const target = old.variant.product.variants.nodes.find(v => opt(v, 'size') === toSize && (opt(v, 'frame') || '') === toFrame)
  if (!target) throw new UserError(`This print does not come in ${[toSize, toFrame].filter(Boolean).join(' ')}`)

  const was = [fromSize, fromFrame].filter(Boolean).join(' ')
  const now = [toSize, toFrame].filter(Boolean).join(' ')
  const personalization = old.customAttributes.filter(a => a.value && !a.key.startsWith('_')).map(a => `${a.key}: ${a.value}`)

  // 1. The edit: the old item out, the new one in.
  const calc = await gql(`mutation($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 20) { nodes { id quantity variant { id } } } } userErrors { field message } } }`, { id }, 'orderEditBegin')
  const calcId = calc.calculatedOrder.id
  const calcLine = calc.calculatedOrder.lineItems.nodes.find(l => l.variant?.id === old.variant.id && l.quantity > 0)
  if (!calcLine) throw new UserError('Could not find that print in the order edit')
  await gql(`mutation($id: ID!, $line: ID!) { orderEditSetQuantity(id: $id, lineItemId: $line, quantity: 0) { calculatedOrder { id } userErrors { field message } } }`, { id: calcId, line: calcLine.id }, 'orderEditSetQuantity')
  const added = await gql(`mutation($id: ID!, $variant: ID!, $qty: Int!) { orderEditAddVariant(id: $id, variantId: $variant, quantity: $qty, allowDuplicates: true) { calculatedLineItem { id } userErrors { field message } } }`, { id: calcId, variant: target.id, qty: old.quantity }, 'orderEditAddVariant')
  // The old item's discount, in dollars a unit, onto the new one: only the price difference is billed.
  const off = Number(old.originalUnitPriceSet?.shopMoney?.amount) - Number(old.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount)
  const newPrice = Number(target.price)
  if (off > 0.004 && newPrice > 0) {
    const percentValue = Math.min(100, Math.round(off / newPrice * 1e6) / 1e4)
    await gql(`mutation($id: ID!, $line: ID!, $discount: OrderEditAppliedDiscountInput!) { orderEditAddLineItemDiscount(id: $id, lineItemId: $line, discount: $discount) { calculatedOrder { id } userErrors { field message } } }`,
      { id: calcId, line: added.calculatedLineItem.id, discount: { percentValue, description: 'Carried from the original item' } }, 'orderEditAddLineItemDiscount')
  }
  const committed = await gql(`mutation($id: ID!, $note: String) { orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) { order { id totalOutstandingSet { shopMoney { amount currencyCode } } } userErrors { field message } } }`, { id: calcId, note: `${old.title}: ${was} to ${now} (support)` }, 'orderEditCommit')

  // 2. The personalization, kept on the order where everyone can see it.
  const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  const block = `${day}: changed ${old.title} from ${was} to ${now} at the customer's request. Personalization from the original item:\n${personalization.join('\n') || '(none on the item)'}`
  await gql(`mutation($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`, { input: { id, note: [order.note, block].filter(Boolean).join('\n\n') } }, 'orderUpdate')

  // 3. The balance, if any, as Shopify's invoice.
  const owed = Number(committed.order.totalOutstandingSet?.shopMoney?.amount || 0)
  let invoiced = false
  if (owed > 0) {
    await gql(`mutation($id: ID!) { orderInvoiceSend(id: $id) { order { id } userErrors { field message } } }`, { id }, 'orderInvoiceSend')
    invoiced = true
  }

  // Our rows: the new size and frame now, so the render and dashboard match.
  const number = order.name.replace(/^#/, '')
  const idx = order.lineItems.nodes.filter(li => li.currentQuantity > 0).indexOf(old)
  const row = (picked && rows.find(r => r.id === picked.id)) || rows.find(r => r.lineItemIndex === idx) || (rows.length === 1 ? rows[0] : null)
  if (row) {
    await prisma.order.update({ where: { id: row.id }, data: { productSize: toSize, ...(toFrame ? { frameType: toFrame.replace(/\s+/g, '') } : {}) } })
    await prisma.orderComment.create({ data: { orderId: row.id, text: `${thread ? 'Support' : actorName(actor)} changed this print from ${was} to ${now}. Personalization copied to the Shopify order note.${invoiced ? ` Invoice sent for $${owed.toFixed(2)}.` : ''} Artelo picks it up on the next import, within about 10 minutes.`, authorId: actor?.id || null, authorName: actorName(actor) } })
    const later = new Date(Date.now() + SEND_DELAY_MIN * 60_000)
    await prisma.renderJob.updateMany({ where: { orderId: row.id, review: 'approved', arteloSentAt: null, sendAfter: { not: null, lt: later } }, data: { sendAfter: later } })
  }
  if (thread) await prisma.supportNote.create({ data: { threadId: thread.id, kind: 'event', body: `${actorName(actor)} changed #${number} from ${was} to ${now}${invoiced ? ` and sent Shopify's invoice for $${owed.toFixed(2)}` : ''}`, authorId: actor?.id || null, authorName: actorName(actor) } })
  return { number, was, now, owed, invoiced }
}
