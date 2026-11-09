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
 * Who owns a conversation a person starts: the sender, when they work Support
 * (a fulfillment teammate, Matt). A designer sending proofs is not, so that
 * thread keeps the routing rule's person. The bot (no id) never owns one.
 */
export async function senderOwnerId(actor) {
  if (!actor?.id) return null
  const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, isActive: true, role: true, extraRoles: true, extraCaps: true, deniedCaps: true } }).catch(() => null)
  return u?.isActive && await can(u, 'support').catch(() => false) ? u.id : null
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
 * What the customer did in the approval portal (answered the designer's
 * question, asked for changes, approved the design), written into the
 * Support conversation that asked them, so the order's Conversation panel
 * and Support show the whole exchange, not only our half. The portal does
 * not email us, so without this the customer's side was only in the portal.
 *
 * Goes on the customer's newest conversation about this order. A reply or a
 * change request reopens it (an open conversation also holds the print from
 * production until the designer acts). An approval closes it: the ball is
 * back with us, and leaving it open would hold the approved print. Nothing
 * happens when the customer has no conversation (the email went out through
 * the Resend fallback); Slack still carries the ping.
 */
export async function mirrorPortalReply({ orderId, kind, text }) {
  try {
    const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { customerEmail: true, customerName: true, shopifyOrderData: true, parentOrderNumber: true } })
    const email = String(order?.customerEmail || '').trim()
    if (!email) return null
    const threads = await prisma.supportThread.findMany({
      where: { customerEmail: { equals: email, mode: 'insensitive' }, mergedIntoId: null, filtered: false, channel: 'email' },
      orderBy: { lastMessageAt: 'desc' }, take: 10, select: { id: true, status: true },
    })
    // The one still going, else the newest.
    const thread = threads.find(t => t.status !== 'closed') || threads[0]
    if (!thread) return null
    const number = String(order.shopifyOrderData?.name || order.parentOrderNumber || '').replace(/^#/, '')
    const said = String(text || '').trim()
    const line = kind === 'approve' ? `Approved the design for #${number} in the portal${said ? `: "${said}"` : '.'}`
      : kind === 'revision' ? `Asked for changes to #${number} in the portal${said ? `: "${said}"` : '.'}`
      : `Replied in the portal about #${number}: "${said}"`
    const now = new Date()
    await prisma.$transaction([
      prisma.supportNote.create({ data: { threadId: thread.id, kind: 'note', body: line.slice(0, 2000), authorId: null, authorName: order.customerName || 'Customer' } }),
      prisma.supportThread.update({
        where: { id: thread.id },
        data: {
          status: kind === 'approve' ? 'closed' : 'open', snoozedUntil: null,
          snippet: line.slice(0, 160), lastMessageAt: now, lastInboundAt: now,
        },
      }),
    ])
    return thread.id
  } catch (err) {
    console.warn('[customerMail] portal reply not mirrored:', err.message)
    return null
  }
}
