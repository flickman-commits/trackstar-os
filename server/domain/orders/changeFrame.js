/**
 * Change the frame on a print a customer already bought (they asked for
 * Natural Oak instead of Black Oak), by editing the Shopify order.
 *
 * Artelo has no way to change an item's product, but it follows Shopify order
 * edits: the edit adds the same product in the new frame and takes the old
 * line to zero, Artelo drops the old item and lists the new one, and the next
 * import moves this print's details onto it (reconcileEditedOrder in
 * processOrders.js). Tested on order 6104, 2026-10-26.
 *
 * Only a frame of the same size and price is offered, so nobody is billed or
 * owed anything; the new line gets a discount that brings it to what the
 * customer paid for the old one. Shopify does not email the customer. It is
 * refused once Artelo has the order in production, and an approved print still
 * waiting to send is pushed back so it is not sent to the item being replaced.
 */
import prisma from '../../db.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { call as artelo } from '../render/artelo.js'

const VERSION = '2025-01'
const SEND_DELAY_MIN = 20

export class FrameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

const optionOf = (variant, name) => variant?.selectedOptions?.find(o => o.name.toLowerCase() === name)?.value || null
const money = s => Number(s?.shopMoney?.amount ?? NaN)

/** The print's row, its Shopify line and the product's variants. */
async function load(orderId) {
  const row = await prisma.order.findUnique({ where: { id: String(orderId || '') } })
  if (!row) throw new FrameError('Order not found', 404)
  if (row.source !== 'shopify') throw new FrameError('Only Shopify orders can change frame here. Change it in Etsy and Artelo by hand.')
  if (row.status === 'completed') throw new FrameError('This print has gone to production. A different frame now means a reprint.')
  const lineId = row.arteloOrderData?.orderItems?.[row.lineItemIndex]?.orderItemId
  if (!lineId) throw new FrameError('Could not find this print\'s line on the Shopify order')

  const data = await shopifyGraphQL(`query($id: ID!) {
    order(id: $id) {
      id name cancelledAt
      lineItems(first: 50) { nodes {
        id currentQuantity
        discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount currencyCode } }
        variant { id price selectedOptions { name value }
          product { id variants(first: 50) { nodes { id price availableForSale selectedOptions { name value } } } } }
      } }
    }
  }`, { id: `gid://shopify/Order/${row.parentOrderNumber}` }, { version: VERSION })
  const order = data?.order
  if (!order) throw new FrameError('Shopify does not have this order')
  if (order.cancelledAt) throw new FrameError('This order is cancelled in Shopify')
  const line = order.lineItems.nodes.find(l => l.id === `gid://shopify/LineItem/${lineId}`)
  if (!line?.variant || !line.currentQuantity) throw new FrameError('This print\'s line is no longer on the Shopify order. Wait for the next import, then try again.')

  const size = optionOf(line.variant, 'size'), frame = optionOf(line.variant, 'frame')
  const options = line.variant.product.variants.nodes
    .filter(v => v.id !== line.variant.id && v.availableForSale !== false
      && optionOf(v, 'size') === size && optionOf(v, 'frame') && Number(v.price) === Number(line.variant.price))
    .map(v => ({ variantId: v.id, frame: optionOf(v, 'frame') }))
  return { row, order, line, size, frame, options }
}

/** The frames this print can change to: same size, same price. */
export async function frameOptions(orderId) {
  const { size, frame, options } = await load(orderId)
  return { size, current: frame, options }
}

/** Swap the print's Shopify line for the same product in another frame. */
export async function changeFrame({ orderId, variantId, actor }) {
  const { row, order, line, size, frame, options } = await load(orderId)
  const pick = options.find(o => o.variantId === variantId)
  if (!pick) throw new FrameError('That frame is not available for this print')

  // Artelo follows the edit only while the order is waiting on us.
  const arteloId = row.arteloOrderData?.id
  if (arteloId) {
    const live = await artelo('orders/get-by-id', { query: { orderId: arteloId } }).catch(() => null)
    const status = live?.status || row.arteloOrderData?.status
    if (status && status !== 'PendingFulfillmentAction') throw new FrameError(`Artelo already has this order as ${live?.productionStatus || status}. A different frame now means a reprint.`)
  }
  const sent = await prisma.renderJob.findFirst({ where: { orderId: row.id, arteloSentAt: { not: null } }, select: { id: true } })
  if (sent) throw new FrameError('This print has been sent to production. A different frame now means a reprint.')

  const begin = await shopifyGraphQL(`mutation($id: ID!) {
    orderEditBegin(id: $id) { calculatedOrder { id } userErrors { field message } }
  }`, { id: order.id }, { version: VERSION })
  const calcId = begin.orderEditBegin.calculatedOrder?.id
  if (!calcId) throw new Error(`Shopify edit begin failed: ${JSON.stringify(begin.orderEditBegin.userErrors)}`)

  const add = await shopifyGraphQL(`mutation($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: true) { calculatedLineItem { id } userErrors { field message } }
  }`, { id: calcId, variantId: pick.variantId, quantity: line.currentQuantity }, { version: VERSION })
  const newLine = add.orderEditAddVariant.calculatedLineItem?.id
  if (!newLine) throw new Error(`Shopify add item failed: ${JSON.stringify(add.orderEditAddVariant.userErrors)}`)

  // The customer pays what they paid for the old line, discount codes included.
  const paid = money(line.discountedUnitPriceAfterAllDiscountsSet)
  const price = Number(line.variant.price)
  if (Number.isFinite(paid) && paid < price) {
    const pct = Math.round((1 - paid / price) * 1e6) / 1e4
    const disc = await shopifyGraphQL(`mutation($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
      orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) { userErrors { field message } }
    }`, { id: calcId, lineItemId: newLine, discount: { percentValue: pct, description: 'Frame change: same price as the original' } }, { version: VERSION })
    if (disc.orderEditAddLineItemDiscount.userErrors?.length) throw new Error(`Shopify discount failed: ${JSON.stringify(disc.orderEditAddLineItemDiscount.userErrors)}`)
  }

  const drop = await shopifyGraphQL(`mutation($id: ID!, $lineItemId: ID!) {
    orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: 0, restock: false) { userErrors { field message } }
  }`, { id: calcId, lineItemId: line.id.replace('LineItem', 'CalculatedLineItem') }, { version: VERSION })
  if (drop.orderEditSetQuantity.userErrors?.length) throw new Error(`Shopify remove item failed: ${JSON.stringify(drop.orderEditSetQuantity.userErrors)}`)

  const who = actor?.firstName || 'TrackstarOS'
  const commit = await shopifyGraphQL(`mutation($id: ID!, $note: String) {
    orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) { order { totalOutstandingSet { shopMoney { amount } } } userErrors { field message } }
  }`, { id: calcId, note: `Frame changed from ${frame} to ${pick.frame} by ${who} in TrackstarOS` }, { version: VERSION })
  if (commit.orderEditCommit.userErrors?.length) throw new Error(`Shopify commit failed: ${JSON.stringify(commit.orderEditCommit.userErrors)}`)
  const outstanding = money(commit.orderEditCommit.order?.totalOutstandingSet) || 0

  // An approved print still to send waits until the import has moved it to the new item.
  const later = new Date(Date.now() + SEND_DELAY_MIN * 60_000)
  await prisma.renderJob.updateMany({ where: { orderId: row.id, review: 'approved', arteloSentAt: null, sendAfter: { not: null, lt: later } }, data: { sendAfter: later } })

  await prisma.orderComment.create({
    data: { orderId: row.id, authorName: 'Trackstar', text: `${who} changed the frame from ${frame} to ${pick.frame} (${size}) in Shopify. Artelo and this order pick it up on the next import, within about 10 minutes.` },
  })
  await recordAudit({
    action: 'order.frame-changed',
    summary: `Changed the frame on ${row.orderNumber} from ${frame} to ${pick.frame}`,
    detail: { orderId: row.id, shopifyOrderId: row.parentOrderNumber, from: line.variant.id, to: pick.variantId, outstanding },
    actor,
  })
  return { ok: true, from: frame, to: pick.frame, outstanding }
}
