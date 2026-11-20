/**
 * Support's order actions from the Fulfillment order view (Eli, 2026-11-20:
 * "the same options in Fulfillment as in Support"). There the person starts
 * from an order, not a conversation: the action is about that order, and it
 * is logged on the customer's most recent conversation when there is one, so
 * Support still sees it. Only the actions about one order are allowed this
 * way; cancelling stays in Support (Matt, 2026-11-20).
 */
import prisma from '../../db.js'
import { UserError } from './errors.js'

/** Support actions (actions.js) and Artelo flows (artelo.js) that can start from an order. */
export const ORDER_ACTIONS = new Set(['shippingAddress', 'sendBalanceInvoice'])
export const ORDER_ARTELO_ACTIONS = new Set(['prep', 'quote', 'create', 'claimPrep', 'claim'])

const shopifyId = v => String(v ?? '').trim().replace(/^gid:\/\/shopify\/Order\//, '')

/**
 * The order (our row id) and the conversation to log on, or null. The Shopify
 * order the page names has to be this order's.
 */
export async function threadForOrder(orderRowId, shopifyOrderId) {
  const row = await prisma.order.findUnique({ where: { id: String(orderRowId || '') }, select: { id: true, source: true, parentOrderNumber: true, customerEmail: true } })
  if (!row) throw new UserError('No such order')
  if (shopifyOrderId !== undefined && shopifyOrderId !== null && shopifyOrderId !== '' && shopifyId(shopifyOrderId) !== String(row.parentOrderNumber)) {
    throw new UserError('That is not this order')
  }
  const email = String(row.customerEmail || '').trim()
  const thread = email
    ? await prisma.supportThread.findFirst({ where: { customerEmail: { equals: email, mode: 'insensitive' } }, orderBy: { lastMessageAt: 'desc' } })
    : null
  return { row, thread }
}
