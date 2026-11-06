/**
 * A Shopify invoice for any amount, from Support: for a request that does not
 * make one on its own (a second size, an extra frame, rush shipping, a
 * reprint the customer pays for). One custom line, no shipping, emailed by
 * Shopify with its pay link; the paid draft becomes an ordinary Shopify order.
 *
 * Sending an invoice moves no money, but a typo ($350 for $35) lands in a
 * customer's inbox, so it is capped at INVOICE_LIMIT_CENTS for everyone but an
 * admin. The draft is tagged support-invoice and noted on the conversation.
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { requireConnection } from '../../lib/connections.js'
import { UserError } from './errors.js'

export const INVOICE_LIMIT_CENTS = 20000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const actorName = a => [a?.firstName, a?.lastName].filter(Boolean).join(' ') || 'Someone'

async function gql(query, variables, key) {
  const d = await shopifyGraphQL(query, variables)
  const out = (d.data || d)?.[key]
  if (!out) throw new UserError('Shopify did not answer. Try again in a minute.')
  if (out.userErrors?.length) throw new UserError(`Shopify: ${out.userErrors.map(e => e.message).join('; ')}`)
  return out
}

/**
 * @param cents      what to charge, in cents
 * @param title      what it is for, as the invoice's line ("Upgrade to 12x18")
 * @param email      who gets it (defaults to the conversation's customer)
 * @param orderName  the order it relates to, for the note ("6810"), optional
 * @param message    a line in Shopify's invoice email, optional
 */
export async function sendSupportInvoice({ thread, cents, title, email, orderName, message, actor, isAdmin }) {
  const amount = Math.round(Number(cents))
  if (!Number.isFinite(amount) || amount < 100) throw new UserError('The amount has to be at least $1')
  if (amount > INVOICE_LIMIT_CENTS && !isAdmin) throw new UserError(`Over $${INVOICE_LIMIT_CENTS / 100} needs an admin. Ask Matt.`)
  const what = String(title || '').trim().slice(0, 120)
  if (!what) throw new UserError('Say what the invoice is for')
  const to = String(email || thread?.customerEmail || '').trim().toLowerCase()
  if (!EMAIL.test(to)) throw new UserError('That email does not look right')
  const ref = String(orderName || '').trim().replace(/^#/, '')

  await requireConnection('shopify')
  const dollars = (amount / 100).toFixed(2)
  const created = await gql(`mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id name invoiceUrl } userErrors { field message } } }`, {
    input: {
      email: to,
      note: [`Support invoice: ${what}.`, ref ? `For order #${ref}.` : null, `Sent by ${actorName(actor)}.`].filter(Boolean).join(' '),
      tags: ['support-invoice', ...(ref ? [`for-${ref}`] : [])],
      lineItems: [{ title: what, originalUnitPriceWithCurrency: { amount: dollars, currencyCode: 'USD' }, quantity: 1, requiresShipping: false, taxable: false }],
    },
  }, 'draftOrderCreate')
  const draft = created.draftOrder
  await gql(`mutation($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id } userErrors { field message } } }`, {
    id: draft.id,
    email: { to, subject: `Invoice from Trackstar: ${what}`, customMessage: String(message || '').trim().slice(0, 1000) || undefined },
  }, 'draftOrderInvoiceSend')

  if (thread) {
    await prisma.supportNote.create({ data: { threadId: thread.id, kind: 'event', body: `${actorName(actor)} sent a Shopify invoice ${draft.name} for $${dollars} to ${to}: ${what}${ref ? ` (order #${ref})` : ''}`, authorId: actor?.id || null, authorName: actorName(actor) } })
  }
  return { draftName: draft.name, invoiceUrl: draft.invoiceUrl, dollars, to }
}
