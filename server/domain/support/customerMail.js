/**
 * One-to-one email to a customer about their order, from fast@trackstar.art
 * through the support mailbox (mailbox.js sendNew): the proofs-are-ready
 * email, a designer's question, a delay notice. Each one starts a Support
 * conversation linked to the order, so the customer's reply lands there,
 * threaded, instead of at a send-only address.
 *
 * These used to go through Resend from proofs@orders.trackstar.art and
 * landed in spam often: a subdomain the customer had never heard from, on
 * shared Amazon IPs, HTML with no plain-text part. fast@ is a real Google
 * Workspace mailbox the customer already has history with. Resend stays
 * configured as the fallback when the mailbox is not connected.
 */
import prisma from '../../db.js'
import { sendNew, isConnected } from './mailbox.js'
import { UserError } from './errors.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function actorName(actor) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
}

/** Whether these go from fast@ right now, or still need the Resend fallback. */
export async function customerMailReady() {
  return isConnected()
}

/**
 * Send it and link the conversation to the order. `waiting` says whether the
 * ball is in the customer's court (proofs, a question) or not (a notice): a
 * waiting thread shows under "Waiting on customer"; a reply opens either.
 */
export async function sendOrderEmail({ order, to, subject, html, text, actor, event, comment, waiting = true }) {
  const addr = String(to || order?.customerEmail || '').trim().toLowerCase()
  if (!EMAIL.test(addr)) throw new UserError('This order has no customer email to write to')
  if (!subject || !html) throw new UserError('An email needs a subject and a body')
  const stored = await sendNew({ userId: actor?.id || null, to: addr, subject, html, text: text || '', attachments: [] })
  const by = actorName(actor)
  await prisma.$transaction([
    prisma.supportThread.update({
      where: { id: stored.threadId },
      data: { status: waiting ? 'waiting' : 'closed', ...(order?.customerName ? { customerName: order.customerName } : {}) },
    }),
    ...(event ? [prisma.supportNote.create({ data: { threadId: stored.threadId, kind: 'event', body: event, authorId: actor?.id || null, authorName: by } })] : []),
    ...(comment && order?.id ? [prisma.orderComment.create({ data: { orderId: order.id, text: comment, authorId: actor?.id || null, authorName: by } })] : []),
  ])
  return { threadId: stored.threadId, to: addr, from: 'fast' }
}
