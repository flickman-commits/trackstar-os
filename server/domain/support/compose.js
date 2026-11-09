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
import { sendNew } from './mailbox.js'
import { replyToHtml } from './format.js'
import { UserError } from './errors.js'
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

export async function emailCustomer({ orderId, subject, text, actor, mockupRef = null }) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { id: true, orderNumber: true, parentOrderNumber: true, shopifyOrderData: true, customerEmail: true, customerName: true } })
  if (!order) throw new UserError('No such order')
  const to = String(order.customerEmail || '').trim().toLowerCase()
  if (!EMAIL.test(to)) throw new UserError('This order has no customer email to write to')
  const body = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!body) throw new UserError('Write the email first')
  if (/\[[^\]\n]*(what we need|the address on the order)[^\]\n]*\]/i.test(body)) throw new UserError('Fill in what we need from them first')
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
  await prisma.$transaction([
    prisma.supportThread.update({
      where: { id: stored.threadId },
      // Waiting on the customer from the start: the ball is in their court until they reply (a reply moves it to open).
      data: { status: 'waiting', assigneeId: actor?.id || undefined, ...(order.customerName ? { customerName: order.customerName } : {}) },
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
export async function waitingOnCustomers(emails) {
  const list = [...new Set(emails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
  const out = new Map()
  if (!list.length) return out
  // Waiting: the thread is marked waiting, or it is snoozed (a reminder to
  // chase them) and our message is the latest. Snoozing sets the status back
  // to open, which used to drop the order out of Waiting on customer the
  // moment a rep set a reminder on it. A closed thread never counts.
  const rows = await prisma.$queryRaw`
    SELECT lower("customerEmail") AS email, max("lastMessageAt") AS since
    FROM "SupportThread"
    WHERE "mergedIntoId" IS NULL AND filtered = false AND "bouncedAt" IS NULL AND lower("customerEmail") = ANY(${list})
      AND (status = 'waiting'
           OR (status = 'open' AND "snoozedUntil" > now() AND "lastOutboundAt" IS NOT NULL AND "lastOutboundAt" > coalesce("lastInboundAt", 'epoch'::timestamp)))
    GROUP BY lower("customerEmail")`
  for (const r of rows) out.set(r.email, r.since)
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
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { customerEmail: true } })
  const email = String(order?.customerEmail || '').trim()
  if (!email) return []
  // all: closed ones too, for the order's Conversation panel ("Show closed").
  const rows = await prisma.supportThread.findMany({
    where: { customerEmail: { equals: email, mode: 'insensitive' }, mergedIntoId: null, filtered: false, ...(all ? {} : { status: { not: 'closed' } }) },
    orderBy: { lastMessageAt: 'desc' },
    take: all ? 25 : 5,
    select: { id: true, subject: true, status: true, snippet: true, lastMessageAt: true, lastInboundAt: true, lastOutboundAt: true, bouncedAt: true, messageCount: true, snoozedUntil: true, channel: true, assignee: { select: { firstName: true } } },
  })
  return rows.map(t => ({
    id: t.id, subject: t.subject || '(no subject)', status: t.status, snippet: t.snippet || '', lastMessageAt: t.lastMessageAt,
    snoozed: Boolean(t.snoozedUntil && t.snoozedUntil > new Date()), channel: t.channel, assignee: t.assignee?.firstName || null,
    messageCount: t.messageCount,
    bounced: Boolean(t.bouncedAt),
    // Who spoke last: the customer (an answer is owed) or us (we are waiting on them).
    last: !t.lastInboundAt && !t.lastOutboundAt ? null : (t.lastOutboundAt || 0) > (t.lastInboundAt || 0) ? 'us' : 'customer',
  }))
}
