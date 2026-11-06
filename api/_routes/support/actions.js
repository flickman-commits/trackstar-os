/**
 * POST /api/support/actions { id, action, ... } - the quick actions beside a conversation.
 *
 *   discount15          { id, percent? }                        -> { code, percent, endsAt }  single use, 30 days
 *   lookupCode          { code }                               -> what Shopify says about it
 *   orderNote           { id, orderId, text }
 *   fixPersonalization  { id, orderId, runnerName?, year? }
 *   slackMatt           { id, text }
 *   changeItemPrep      { id, shopifyOrderId }  -> the prints on the order and their sizes/frames
 *   changeItem          { id, shopifyOrderId, lineItemId?, size, frame }  size/frame swap before production
 *   shippingAddress     { id, shopifyOrderId, address: { name, address1, address2, city, province, zip, country, phone } }
 *   refundable          { id, shopifyOrderId }                  -> what is left to refund, and the $150 line
 *   refund              { id, shopifyOrderId, cents, reason }   over $150 refused unless admin (re-read from the database)
 *   cancelOrder         { id, shopifyOrderId, reason, customerConfirmed: true }
 *   sendInvoice         { id, cents, title, email?, orderName?, message? }  a Shopify invoice for any amount; over $200 admin only
 *
 * Anyone on Support; a discount code also needs the Discount codes
 * capability, the same gate as the dashboard's discount tool. Every
 * action is audited. See server/domain/support/actions.js.
 *
 * An order named by shopifyOrderId or orderId has to be this conversation's:
 * under the customer's email, or linked to them by a teammate. refund,
 * cancelOrder and changeItem also carry an idempotencyKey the page makes per
 * press, so a double click or a retry cannot do it twice.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { can } from '../../_lib/roles.js'
import prisma from '../../_lib/prisma.js'
import { changeItemPrep, changeItem } from '../../../server/domain/support/changeItem.js'
import { discount15, lookupCode, orderNote, fixPersonalization, slackMatt, shippingAddress, refundable, refund, cancelOrder, REFUND_LIMIT_CENTS, DISCOUNT_LIMIT_PERCENT } from '../../../server/domain/support/actions.js'
import { sendSupportInvoice, INVOICE_LIMIT_CENTS } from '../../../server/domain/support/invoice.js'
import { assertOrderInThread } from '../../../server/domain/support/threads.js'
import { claimOnce } from '../../../server/domain/support/idempotency.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'

/** Actions that move money or change an order in Shopify: once per press. */
const ONCE = new Set(['refund', 'cancelOrder', 'changeItem', 'sendInvoice'])

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const action = String(body.action || '')

    if (action === 'lookupCode') return res.status(200).json(await lookupCode(body.code))

    const thread = await prisma.supportThread.findUnique({ where: { id: String(body.id || '') } })
    if (!thread) return res.status(404).json({ error: 'No such thread' })
    const audit = (summary, detail = {}) => recordAudit({ action: `support.${action}`, summary, detail: { threadId: thread.id, ...detail }, actor: user })

    // The page names the order; it has to be one this conversation is about.
    if (body.shopifyOrderId !== undefined || body.orderId !== undefined) {
      await assertOrderInThread(thread, { shopifyOrderId: body.shopifyOrderId, orderId: body.orderId })
    }
    if (ONCE.has(action)) await claimOnce(`support.${action}`, body.idempotencyKey)

    switch (action) {
      case 'discount15': {
        if (!(user.isSystem || user.role === 'admin' || await can(user, 'tools.discounts'))) {
          return res.status(403).json({ error: 'Discount codes are not part of your role. Ask Matt.', code: 'not_allowed' })
        }
        const out = await discount15({ thread, actor: user, percent: body.percent ?? 15, prefix: body.prefix })
        await audit(`Created ${out.code} for ${thread.customerEmail}`, out)
        return res.status(200).json(out)
      }
      case 'orderNote': {
        const out = await orderNote({ thread, orderId: body.orderId, text: body.text, actor: user })
        await audit(`Note on #${out.number} from support`, { orderId: body.orderId })
        return res.status(200).json(out)
      }
      case 'fixPersonalization': {
        const out = await fixPersonalization({ thread, orderId: body.orderId, runnerName: body.runnerName, year: body.year, actor: user })
        await audit(`Changed #${out.number}: ${out.what}`, { orderId: body.orderId })
        return res.status(200).json(out)
      }
      case 'changeItemPrep': return res.status(200).json(await changeItemPrep({ shopifyOrderId: body.shopifyOrderId }))
      case 'changeItem': {
        const out = await changeItem({ thread, shopifyOrderId: body.shopifyOrderId, lineItemId: body.lineItemId, size: body.size, frame: body.frame, actor: user })
        await audit(`Changed #${out.number} from ${out.was} to ${out.now}${out.invoiced ? `, invoiced $${out.owed.toFixed(2)}` : ''}`, { shopifyOrderId: body.shopifyOrderId })
        return res.status(200).json(out)
      }
      case 'shippingAddress': {
        const out = await shippingAddress({ thread, shopifyOrderId: body.shopifyOrderId, address: body.address, actor: user })
        await audit(`Changed #${out.number}'s ship-to`, { shopifyOrderId: body.shopifyOrderId })
        return res.status(200).json(out)
      }
      case 'refundable': {
        const o = await refundable(body.shopifyOrderId)
        return res.status(200).json({ number: o.name, availableCents: o.availableCents, refundedCents: o.refundedCents, currency: o.currency, cancelled: o.cancelled, fulfillment: o.fulfillment, limitCents: REFUND_LIMIT_CENTS, discountLimitPercent: DISCOUNT_LIMIT_PERCENT, isAdmin: user.role === 'admin' })
      }
      case 'refund': {
        const out = await refund({ thread, shopifyOrderId: body.shopifyOrderId, cents: body.cents, reason: body.reason, actor: user })
        await audit(`Refunded ${out.display} on #${out.number}`, { shopifyOrderId: body.shopifyOrderId, cents: out.cents, currency: 'USD', reason: body.reason || null })
        return res.status(200).json(out)
      }
      case 'cancelOrder': {
        const out = await cancelOrder({ thread, shopifyOrderId: body.shopifyOrderId, reason: body.reason, customerConfirmed: body.customerConfirmed === true, actor: user })
        await audit(`Cancelled #${out.number} and refunded ${out.display}`, { shopifyOrderId: body.shopifyOrderId, cents: out.cents, currency: 'USD', reason: body.reason || null })
        return res.status(200).json(out)
      }
      case 'invoiceLimit': return res.status(200).json({ limitCents: INVOICE_LIMIT_CENTS, isAdmin: user.role === 'admin', email: thread.customerEmail || '' })
      case 'sendInvoice': {
        const out = await sendSupportInvoice({ thread, cents: body.cents, title: body.title, email: body.email, orderName: body.orderName, message: body.message, actor: user, isAdmin: user.role === 'admin' })
        await audit(`Sent Shopify invoice ${out.draftName} for $${out.dollars} to ${out.to}`, { cents: Math.round(Number(body.cents)), currency: 'USD', title: body.title || null, orderName: body.orderName || null })
        return res.status(200).json(out)
      }
      case 'slackMatt': {
        const out = await slackMatt({ thread, text: body.text, actor: user })
        await audit(`Escalated "${thread.subject}" to Slack`, { text: body.text || null })
        return res.status(200).json(out)
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` })
    }
  } catch (error) {
    console.error('[API /support/actions]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'That did not go through. Check Shopify before trying again.') })
  }
}
