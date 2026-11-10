/**
 * "Email customer" from TrackstarOS: one email from fast@ about one
 * order, usually asking for what we cannot find (a bib number, a last name,
 * a finish time). It goes out through the support mailbox, so it is a
 * Support conversation from the start: assigned to whoever sent it, waiting
 * on the customer, with the order linked. The order gets a comment saying
 * it was sent, so the fulfillment side sees it too.
 *
 * Or it sends the design for the customer to approve (an odd name, a race we
 * are not sure of): the mockup goes attached and the print is held from
 * production until they answer (holdForCustomer). The mockup is the newest
 * render or proof, or a file made by hand and uploaded from the modal.
 */
import prisma from '../../db.js'
import { sendNew, stripQuoted } from './mailbox.js'
import { replyToHtml } from './format.js'
import { UserError } from './errors.js'
import { senderOwnerId } from './customerMail.js'
import { listMockups, resolveMockup } from './mockups.js'
import { holdForCustomer } from '../render/arteloSend.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The number the customer knows: Shopify's order name ("4985"). Our row's
 * orderNumber is Shopify's internal id plus the line, which means nothing to
 * them. Same rule as the order list (api/_routes/orders/index.js).
 */
export function customerOrderNumber(order) {
  const name = order?.shopifyOrderData?.name
  return String(name || order?.parentOrderNumber || order?.orderNumber || '').replace(/^#/, '')
}

export function defaultSubject(number) {
  return `Trackstar Order ${number} (Action Required)`
}

function actorName(actor) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
}

// waiting: false for a note that asks nothing (the Hall of Fame card): the thread is closed and the order never parks in Waiting on customer; a reply opens it.
export async function emailCustomer({ orderId, subject, text, actor, mockupRef = null, waiting = true }) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { id: true, orderNumber: true, parentOrderNumber: true, shopifyOrderData: true, customerEmail: true, customerName: true } })
  if (!order) throw new UserError('No such order')
  const to = String(order.customerEmail || '').trim().toLowerCase()
  if (!EMAIL.test(to)) throw new UserError('This order has no customer email to write to')
  const body = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!body) throw new UserError('Write the email first')
  if (/\[[^\]\n]*(what we need|the address on the order|gift card code)[^\]\n]*\]/i.test(body)) throw new UserError('Fill in what we need from them first')
  const number = customerOrderNumber(order)
  // A page loaded before the fix filled in our internal id; the customer only knows the display number.
  let subj = String(subject || '').trim().slice(0, 200) || defaultSubject(number)
  for (const internal of [order.parentOrderNumber, order.orderNumber].filter(v => v && String(v) !== number)) {
    subj = subj.split(`#${internal}`).join(number).split(String(internal)).join(number)
  }

  // One of this order's own mockups, or a design made by hand that the rep
  // uploaded through the support uploader (upload:<path>, read from our own
  // bucket); never a URL from the page.
  let attachments = []
  if (mockupRef) {
    if (!String(mockupRef).startsWith('upload:')) {
      const ours = await listMockups([order.id])
      if (!ours.some(m => m.ref === mockupRef)) throw new UserError('That mockup is not on this order')
    }
    const f = await resolveMockup(mockupRef)
    attachments = [{ bytes: f.bytes, contentType: f.contentType, filename: f.filename }]
  }

  const stored = await sendNew({ userId: actor?.id || null, to, subject: subj, html: replyToHtml(body), text: body, attachments })
  const held = mockupRef ? await holdForCustomer({ orderId: order.id, actor }) : null
  const by = actorName(actor)
  // The sender owns the conversation only if they work in Support (a designer does not).
  const owner = await senderOwnerId(actor)
  await prisma.$transaction([
    prisma.supportThread.update({
      where: { id: stored.threadId },
      // Waiting on the customer from the start: the ball is in their court until they reply (a reply moves it to open).
      data: { status: waiting ? 'waiting' : 'closed', ...(waiting ? {} : { notWaitingAt: new Date() }), assigneeId: owner || undefined, ...(order.customerName ? { customerName: order.customerName } : {}) },
    }),
    prisma.supportNote.create({ data: { threadId: stored.threadId, kind: 'event', body: `${by} emailed from Fulfillment about #${number}`, authorId: actor?.id || null, authorName: by } }),
    prisma.orderComment.create({ data: { orderId: order.id, text: mockupRef
      ? `Sent the design to the customer to approve: "${subj}".${held ? ' Held from production until they answer; Send now once they approve.' : ''}`
      : `Emailed the customer from Support: "${subj}"`, authorId: actor?.id || null, authorName: by } }),
  ])
  return { threadId: stored.threadId, to, subject: subj, held: Boolean(held) }
}

/**
 * When we last wrote to each of these customers and are still waiting on a
 * reply: the newest Support conversation in "waiting" (we sent the last
 * message; a reply moves it to open, closing it ends the wait). Keyed by the
 * lower-cased email, for the orders list's "Waiting on customer" tag.
 * @param {string[]} emails
 * @returns {Promise<Map<string, Date>>}
 */
/**
 * Whether the part of our email we wrote asks the customer something: a "?"
 * outside links and the quoted thread underneath. "Which race instead?", "Do
 * you have a better photo?" count; "Done! It ships to Ed." does not.
 */
export function asksCustomer(text) {
  const own = stripQuoted(text).replace(/https?:\/\/\S+/g, '').replace(/\b\S+@\S+\.\S+\b/g, '')
  // Each question, minus the ones nobody waits on: a review ask ("would you
  // mind leaving us a review?", 8769) or "any other questions?".
  const questions = own.match(/[^.!?\n]*\?/g) || []
  if (questions.some(q => !/\breview\b|\bany (other )?questions\b|\banything else\b/i.test(q))) return true
  // A request with no question mark: "Just let us know which option works
  // best for you" (8475), "Please send us her bib", "Reply with the address".
  return /\blet (us|me) know (which|what|whether|how|when|where|who|if you'?d|if you would|your)\b|\bplease (send|reply|confirm|share|upload|attach|choose|pick)\b|\b(send|email|reply to) (us|me)\b|\breply with\b/i.test(own)
}

/** How long a question keeps an order waiting with no reply. After that it is Action again. */
const QUESTION_DAYS = 30

/**
 * Is this conversation waiting on the customer? Marked waiting by a person,
 * or our message is the last one and it either asked them something or the
 * thread is snoozed for a follow-up. The thread's status does not decide it:
 * Send and close, closing by hand and escalating all used to drop an order
 * out of Waiting while its question was still unanswered (7735's photo,
 * 7294's which-runner, 6457's bib, Nov 2026). "Not waiting" on the order
 * (notWaitingAt) overrides it until we write again.
 */
export function threadWaiting(t, lastOutText, now = new Date()) {
  if (t.bouncedAt) return false
  const weSpokeLast = Boolean(t.lastOutboundAt) && (!t.lastInboundAt || t.lastOutboundAt > t.lastInboundAt)
  if (t.notWaitingAt && (!t.lastOutboundAt || t.notWaitingAt >= t.lastOutboundAt)) return false
  if (t.status === 'waiting') return true
  if (!weSpokeLast) return false
  if (t.status !== 'closed' && t.snoozedUntil && t.snoozedUntil > now) return true
  if (now - new Date(t.lastOutboundAt) > QUESTION_DAYS * 86_400_000) return false
  return asksCustomer(lastOutText)
}

/** The newest message we sent on each of these threads, by thread id. */
async function lastOutboundText(ids) {
  if (!ids.length) return new Map()
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON ("threadId") "threadId" AS id, "bodyText" AS body
    FROM "SupportMessage" WHERE "threadId" = ANY(${ids}) AND direction = 'out'
    ORDER BY "threadId", "sentAt" DESC`
  return new Map(rows.map(r => [r.id, r.body || '']))
}

/**
 * The conversations to read for these order emails: the customer's own
 * address, plus any address an order was linked to by hand (they wrote in
 * from another email). Thread email -> the order emails it speaks for.
 */
async function threadEmailsFor(list) {
  const map = new Map(list.map(e => [e, new Set([e])]))
  const links = await prisma.supportLinkedOrder.findMany({ where: { orderEmail: { in: list } }, select: { customerKey: true, orderEmail: true } })
  for (const l of links) {
    if (!l.customerKey || l.customerKey.startsWith('ig:')) continue
    if (!map.has(l.customerKey)) map.set(l.customerKey, new Set())
    map.get(l.customerKey).add(l.orderEmail)
  }
  return map
}

export async function waitingOnCustomers(emails) {
  const list = [...new Set(emails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
  const out = new Map()
  if (!list.length) return out
  const speaksFor = await threadEmailsFor(list)
  const since = new Date(Date.now() - QUESTION_DAYS * 86_400_000)
  const threads = await prisma.supportThread.findMany({
    where: {
      customerEmail: { in: [...speaksFor.keys()], mode: 'insensitive' }, mergedIntoId: null, filtered: false, bouncedAt: null,
      OR: [{ status: 'waiting' }, { lastOutboundAt: { gte: since } }, { snoozedUntil: { gt: new Date() } }],
    },
    select: { id: true, customerEmail: true, status: true, snoozedUntil: true, lastInboundAt: true, lastOutboundAt: true, lastMessageAt: true, bouncedAt: true, notWaitingAt: true },
  })
  const texts = await lastOutboundText(threads.map(t => t.id))
  for (const t of threads) {
    if (!threadWaiting(t, texts.get(t.id) || '')) continue
    const sinceAt = t.lastOutboundAt || t.lastMessageAt
    for (const e of speaksFor.get(t.customerEmail.toLowerCase()) || []) {
      if (!out.has(e) || out.get(e) < sinceAt) out.set(e, sinceAt)
    }
  }
  return out
}

/**
 * Customers whose last email from us bounced (the conversation is still
 * going): the order shows "Email bounced" under Action, since nobody is
 * waiting on an email that never arrived. By lowercased email -> when.
 */
export async function bouncedCustomers(emails) {
  const list = [...new Set(emails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
  const out = new Map()
  if (!list.length) return out
  const rows = await prisma.$queryRaw`
    SELECT lower("customerEmail") AS email, max("bouncedAt") AS at
    FROM "SupportThread"
    WHERE "bouncedAt" IS NOT NULL AND status <> 'closed' AND "mergedIntoId" IS NULL AND filtered = false AND lower("customerEmail") = ANY(${list})
    GROUP BY lower("customerEmail")`
  for (const r of rows) out.set(r.email, r.at)
  return out
}

/**
 * The Support conversations still going with an order's customer (anything
 * not closed), for the order view in TrackstarOS. Matched on the
 * order's email; filtered and merged-away threads never show.
 */
export async function conversationsForOrder(orderId, { all = false } = {}) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { customerEmail: true, shopifyOrderData: true, parentOrderNumber: true, orderNumber: true } })
  const email = String(order?.customerEmail || '').trim().toLowerCase()
  // Addresses this order was linked to by hand (they wrote in from another email).
  const linked = order ? await prisma.supportLinkedOrder.findMany({ where: { orderNumber: customerOrderNumber(order) }, select: { customerKey: true } }) : []
  const emails = [...new Set([email, ...linked.map(l => l.customerKey).filter(k => k && !k.startsWith('ig:'))].filter(Boolean))]
  if (!emails.length) return []
  // all: closed ones too, for the order's Conversation panel ("Show closed").
  const rows = await prisma.supportThread.findMany({
    where: { customerEmail: { in: emails, mode: 'insensitive' }, mergedIntoId: null, filtered: false, ...(all ? {} : { status: { not: 'closed' } }) },
    orderBy: { lastMessageAt: 'desc' },
    take: all ? 25 : 5,
    select: { id: true, subject: true, status: true, snippet: true, lastMessageAt: true, lastInboundAt: true, lastOutboundAt: true, bouncedAt: true, messageCount: true, snoozedUntil: true, notWaitingAt: true, channel: true, assignee: { select: { firstName: true } } },
  })
  const texts = await lastOutboundText(rows.map(t => t.id))
  return rows.map(t => ({
    // This conversation keeps the order under Waiting (threadWaiting).
    waiting: threadWaiting(t, texts.get(t.id) || ''),
    id: t.id, subject: t.subject || '(no subject)', status: t.status, snippet: t.snippet || '', lastMessageAt: t.lastMessageAt,
    snoozed: Boolean(t.snoozedUntil && t.snoozedUntil > new Date()), channel: t.channel, assignee: t.assignee?.firstName || null,
    messageCount: t.messageCount,
    bounced: Boolean(t.bouncedAt),
    // Who spoke last: the customer (an answer is owed) or us (we are waiting on them).
    last: !t.lastInboundAt && !t.lastOutboundAt ? null : (t.lastOutboundAt || 0) > (t.lastInboundAt || 0) ? 'us' : 'customer',
  }))
}
