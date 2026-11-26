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
import { can } from '../../../api/_lib/roles.js'

/**
 * Who owns a conversation a person starts: the sender, when they work
 * Support (a fulfillment teammate, Matt) or answer their own customers there
 * (a designer with 'support.own': proofs and emails from their custom order
 * come back to them, in their My Inbox). Anyone else's thread keeps the
 * routing rule's person. The bot (no id) never owns one.
 */
export async function senderOwnerId(actor) {
  if (!actor?.id) return null
  const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, isActive: true, role: true, extraRoles: true, extraCaps: true, deniedCaps: true } }).catch(() => null)
  if (!u?.isActive) return null
  const works = await can(u, 'support').catch(() => false) || await can(u, 'support.own').catch(() => false)
  return works ? u.id : null
}

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
  const owner = await senderOwnerId(actor)
  await prisma.$transaction([
    prisma.supportThread.update({
      where: { id: stored.threadId },
      data: { status: waiting ? 'waiting' : 'closed', ...(owner ? { assigneeId: owner } : {}), ...(order?.customerName ? { customerName: order.customerName } : {}) },
    }),
    ...(event ? [prisma.supportNote.create({ data: { threadId: stored.threadId, kind: 'event', body: event, authorId: actor?.id || null, authorName: by } })] : []),
    ...(comment && order?.id ? [prisma.orderComment.create({ data: { orderId: order.id, text: comment, authorId: actor?.id || null, authorName: by } })] : []),
  ])
  return { threadId: stored.threadId, to: addr, from: 'fast' }
}

/**
 * What the customer did in the approval portal, as it touches Support.
 *
 * A change request or a reply in the portal goes straight to the design team
 * (the order's comments, Slack, the designer's queue), so Support writes
 * nothing and leaves the conversation as it is. It used to add the customer's
 * words as a note and reopen the conversation, and the support team took
 * those for questions they had to answer (Matt, 2026-11-26). The design
 * going back to the designer already keeps the print from production.
 *
 * Support shows the customer's side only when they email us. An approval
 * writes nothing either, but quietly closes the conversation the proofs went
 * out on and every other one waiting on this customer: an open
 * or waiting conversation holds the print (holdsPrint.js), and an approved
 * print was held that way (6748, 6821, 7190, 7649 in Nov 2026). Open and
 * escalated ones other than the newest stay: there we still owe the customer
 * something. Nothing happens when the customer has no conversation.
 */
export async function closeSupportOnApproval({ orderId }) {
  try {
    const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { customerEmail: true } })
    const email = String(order?.customerEmail || '').trim()
    if (!email) return null
    const threads = await prisma.supportThread.findMany({
      where: { customerEmail: { equals: email, mode: 'insensitive' }, mergedIntoId: null, filtered: false, channel: 'email' },
      orderBy: { lastMessageAt: 'desc' }, take: 10, select: { id: true, status: true },
    })
    // The one still going (else the newest), and every other one waiting on the customer.
    const thread = threads.find(t => t.status !== 'closed') || threads[0]
    if (!thread) return null
    const toClose = [thread.id, ...threads.filter(t => t.id !== thread.id && t.status === 'waiting').map(t => t.id)]
    await prisma.supportThread.updateMany({ where: { id: { in: toClose }, status: { not: 'closed' } }, data: { status: 'closed', snoozedUntil: null } })
    return thread.id
  } catch (err) {
    console.warn('[customerMail] conversations not closed on approval:', err.message)
    return null
  }
}
