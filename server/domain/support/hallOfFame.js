/**
 * Trackstar Hall of Fame: the five fastest men and women who ordered a print
 * get a $50 Trackstar gift card (official results from November 2025 on).
 * From "Email customer" on the order, the rep presses Create gift card: this
 * makes the card in Shopify, assigned to the customer's Shopify account when
 * they have one (Shopify emails it to them), and hands back the code for the
 * Hall of Fame email.
 *
 * One card per order, ever: the code is kept in SystemConfig
 * (hall_of_fame_card:<orderId>), so pressing it again returns the same card
 * instead of making a second $50. It is money, so every card goes in the
 * Activity Log (the route) and to #admin-alerts.
 *
 * Needs the Shopify app's write_gift_cards scope.
 */
import prisma from '../../db.js'
import { shopifyGraphql } from '../../services/shopifyProducts.js'
import { slackTo } from '../../lib/slack.js'
import { UserError } from './errors.js'

export const HALL_OF_FAME_CENTS = 5000
const KEY = orderId => `hall_of_fame_card:${orderId}`

const CUSTOMER = `query($q: String!) { customers(first: 1, query: $q) { nodes { id } } }`
const CREATE = `mutation($input: GiftCardCreateInput!) {
  giftCardCreate(input: $input) {
    giftCard { id lastCharacters }
    giftCardCode
    userErrors { field message code }
  }
}`

/** The card already made for this order, if any: { code, last4, giftCardId, customerAssigned, createdAt, by }. */
export async function existingCard(orderId) {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY(orderId) } }).catch(() => null)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return null }
}

export async function createHallOfFameCard({ orderId, actor }) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { id: true, orderNumber: true, parentOrderNumber: true, runnerName: true, raceName: true, raceYear: true, customerEmail: true, customerName: true } })
  if (!order) throw new UserError('No such order')
  const had = await existingCard(order.id)
  if (had) return { ...had, already: true }

  const email = String(order.customerEmail || '').trim().toLowerCase()
  let customerId = null
  if (email) {
    const found = await shopifyGraphql(CUSTOMER, { q: `email:${email}` }).catch(() => null)
    customerId = found?.customers?.nodes?.[0]?.id || null
  }
  const note = `Trackstar Hall of Fame: ${order.runnerName}, ${order.raceName} ${order.raceYear} (order ${order.parentOrderNumber})`
  const input = {
    initialValue: (HALL_OF_FAME_CENTS / 100).toFixed(2),
    note: note.slice(0, 255),
    // Assigned and with the customer as recipient, Shopify emails them the card.
    ...(customerId ? { customerId, recipientAttributes: { id: customerId } } : {}),
  }
  let data
  try { data = await shopifyGraphql(CREATE, { input }) }
  catch (e) {
    if (/ACCESS_DENIED|write_gift_cards|access/i.test(String(e?.message))) throw new UserError('Shopify is not letting TrackstarOS make gift cards yet. Matt adds the write_gift_cards permission to the Shopify app, then try again.')
    throw e
  }
  const out = data?.giftCardCreate
  if (out?.userErrors?.length) throw new UserError(`Shopify would not make the gift card: ${out.userErrors.map(u => u.message).join('; ')}`)
  if (!out?.giftCardCode) throw new Error('giftCardCreate returned no code')

  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
  const card = { code: out.giftCardCode, last4: out.giftCard?.lastCharacters || out.giftCardCode.slice(-4), giftCardId: out.giftCard?.id || null, customerAssigned: Boolean(customerId), amountCents: HALL_OF_FAME_CENTS, createdAt: new Date().toISOString(), by }
  await prisma.$transaction([
    prisma.systemConfig.create({ data: { key: KEY(order.id), value: JSON.stringify(card) } }),
    prisma.orderComment.create({ data: { orderId: order.id, text: `Hall of Fame: $50 gift card made in Shopify (ending ${card.last4})${customerId ? ', emailed to the customer by Shopify' : ''}.`, authorId: actor?.id || null, authorName: by } }),
  ])
  await slackTo('admin', `:trophy: *Hall of Fame gift card* $50 for ${order.runnerName} (${order.raceName} ${order.raceYear}, order ${order.parentOrderNumber}), made by ${by}. Ends ${card.last4}.`).catch(() => {})
  return { ...card, already: false }
}
