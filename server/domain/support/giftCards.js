/**
 * Shopify gift cards, made from TrackstarOS: Send gift card in the support
 * tool (any amount, to make something right), and the Hall of Fame card
 * (hallOfFame.js).
 *
 * The card is assigned to the customer's Shopify account, with them as the
 * recipient, so Shopify emails it to them with our message. Someone with no
 * account (an Etsy buyer) gets one made from their email first. The full code
 * is only readable when the card is made, so it comes back here for the rep
 * to paste if they want; Shopify shows only the last 4 after that.
 *
 * Over GIFT_CARD_LIMIT_CENTS (support's money line, the same as refunds and
 * invoices) only an admin can send one. Every card is noted on the
 * conversation, audited by the route, and posted to #admin-alerts.
 *
 * Needs the Shopify app's write_gift_cards scope.
 */
import prisma from '../../db.js'
import { shopifyGraphql } from '../../services/shopifyProducts.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { UserError } from './errors.js'

export const GIFT_CARD_LIMIT_CENTS = 25000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIND_CUSTOMER = `query($q: String!) { customers(first: 1, query: $q) { nodes { id } } }`
const CREATE_CUSTOMER = `mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }`
const CREATE_CARD = `mutation($input: GiftCardCreateInput!) {
  giftCardCreate(input: $input) {
    giftCard { id lastCharacters }
    giftCardCode
    userErrors { field message code }
  }
}`

const NO_SCOPE = 'Shopify is not letting TrackstarOS make gift cards yet. Matt adds the write_gift_cards permission to the Shopify app, then try again.'

/** The customer's Shopify id by email, made from the email (and name) when they have no account. */
async function customerFor(email, name) {
  const found = await shopifyGraphql(FIND_CUSTOMER, { q: `email:${email}` })
  const id = found?.customers?.nodes?.[0]?.id
  if (id) return id
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/).filter(Boolean)
  const made = await shopifyGraphql(CREATE_CUSTOMER, { input: { email, ...(firstName ? { firstName, lastName: rest.join(' ') || undefined } : {}) } }).catch(() => null)
  return made?.customerCreate?.customer?.id || null
}

/**
 * Make the card. Returns { code, last4, giftCardId, emailed, dollars, to }.
 * `emailed` says Shopify has the customer to email it to; when false the code
 * is the only way they get it.
 */
export async function createGiftCard({ cents, email, name, note, message }) {
  const amount = Math.round(Number(cents))
  if (!Number.isFinite(amount) || amount < 100) throw new UserError('A gift card has to be at least $1')
  const to = String(email || '').trim().toLowerCase()
  if (!EMAIL.test(to)) throw new UserError('That email does not look right')
  const dollars = (amount / 100).toFixed(2)

  let data
  try {
    const customerId = await customerFor(to, name)
    data = await shopifyGraphql(CREATE_CARD, { input: {
      initialValue: dollars,
      note: String(note || '').slice(0, 255) || undefined,
      ...(customerId ? { customerId, recipientAttributes: { id: customerId, ...(message ? { message: String(message).slice(0, 200) } : {}) } } : {}),
    } })
    const out = data?.giftCardCreate
    if (out?.userErrors?.length) throw new UserError(`Shopify would not make the gift card: ${out.userErrors.map(u => u.message).join('; ')}`)
    if (!out?.giftCardCode) throw new Error('giftCardCreate returned no code')
    return { code: out.giftCardCode, last4: out.giftCard?.lastCharacters || out.giftCardCode.slice(-4), giftCardId: out.giftCard?.id || null, emailed: Boolean(customerId), dollars, to }
  } catch (e) {
    if (e instanceof UserError) throw e
    if (/ACCESS_DENIED|write_gift_cards|access denied/i.test(String(e?.message))) throw new UserError(NO_SCOPE)
    throw e
  }
}

const actorName = a => [a?.firstName, a?.lastName].filter(Boolean).join(' ') || 'Someone'

/** Send gift card from a support conversation. */
export async function sendSupportGiftCard({ thread, cents, email, reason, message, orderName, actor, isAdmin }) {
  const amount = Math.round(Number(cents))
  if (amount > GIFT_CARD_LIMIT_CENTS && !isAdmin) throw new UserError(`Over $${GIFT_CARD_LIMIT_CENTS / 100} needs an admin. Ask Matt.`)
  const why = String(reason || '').trim().slice(0, 160)
  if (!why) throw new UserError('Say what the gift card is for')
  const ref = String(orderName || '').trim().replace(/^#/, '')
  const by = actorName(actor)
  const card = await createGiftCard({
    cents: amount,
    email: email || thread?.customerEmail,
    name: thread?.customerName,
    note: `Support gift card: ${why}.${ref ? ` Order #${ref}.` : ''} Sent by ${by}.`,
    message,
  })
  if (thread) {
    await prisma.supportNote.create({ data: { threadId: thread.id, kind: 'event', body: `${by} sent a $${card.dollars} gift card (ending ${card.last4}) to ${card.to}: ${why}${ref ? ` (order #${ref})` : ''}${card.emailed ? '' : '. Shopify could not email it, so send them the code.'}`, authorId: actor?.id || null, authorName: by } })
  }
  await slackTo('admin', `:gift: *$${card.dollars} gift card* to ${slackText(card.to)} by ${slackText(by)}: ${slackText(why, 200)}${ref ? ` (order #${slackText(ref)})` : ''}. Ends ${card.last4}.`).catch(() => {})
  return card
}
