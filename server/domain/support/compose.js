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
 * production until they answer (holdForCustomer).
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
 * them. Same rule as the order list (api/orders/index.js).
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
  if (/\[[^\]\n]*what we need[^\]\n]*\]/i.test(body)) throw new UserError('Fill in what we need from them first')
  const number = customerOrderNumber(order)
  // A page loaded before the fix filled in our internal id; the customer only knows the display number.
  let subj = String(subject || '').trim().slice(0, 200) || defaultSubject(number)
  for (const internal of [order.parentOrderNumber, order.orderNumber].filter(v => v && String(v) !== number)) {
    subj = subj.split(`#${internal}`).join(number).split(String(internal)).join(number)
  }

  // Only one of this order's own mockups, by reference; never a file from the page.
  let attachments = []
  if (mockupRef) {
    const ours = await listMockups([order.id])
    if (!ours.some(m => m.ref === mockupRef)) throw new UserError('That mockup is not on this order')
    const f = await resolveMockup(mockupRef)
    attachments = [{ bytes: f.bytes, contentType: f.contentType, filename: f.filename }]
  }

  const stored = await sendNew({ userId: actor?.id || null, to, subject: subj, html: replyToHtml(body), text: body, attachments })
  const held = mockupRef ? await holdForCustomer({ orderId: order.id, actor }) : null
  const by = actorName(actor)
  await prisma.$transaction([
    prisma.supportThread.update({
      where: { id: stored.threadId },
      data: { assigneeId: actor?.id || undefined, ...(order.customerName ? { customerName: order.customerName } : {}) },
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
  const rows = await prisma.$queryRaw`
    SELECT lower("customerEmail") AS email, max("lastMessageAt") AS since
    FROM "SupportThread"
    WHERE status = 'waiting' AND "mergedIntoId" IS NULL AND filtered = false AND lower("customerEmail") = ANY(${list})
    GROUP BY lower("customerEmail")`
  for (const r of rows) out.set(r.email, r.since)
  return out
}

/**
 * The Support conversations still going with an order's customer (anything
 * not closed), for the order view in TrackstarOS. Matched on the
 * order's email; filtered and merged-away threads never show.
 */
export async function conversationsForOrder(orderId) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { customerEmail: true } })
  const email = String(order?.customerEmail || '').trim()
  if (!email) return []
  const rows = await prisma.supportThread.findMany({
    where: { customerEmail: { equals: email, mode: 'insensitive' }, mergedIntoId: null, filtered: false, status: { not: 'closed' } },
    orderBy: { lastMessageAt: 'desc' },
    take: 5,
    select: { id: true, subject: true, status: true, snippet: true, lastMessageAt: true, snoozedUntil: true, channel: true, assignee: { select: { firstName: true } } },
  })
  return rows.map(t => ({
    id: t.id, subject: t.subject || '(no subject)', status: t.status, snippet: t.snippet || '', lastMessageAt: t.lastMessageAt,
    snoozed: Boolean(t.snoozedUntil && t.snoozedUntil > new Date()), channel: t.channel, assignee: t.assignee?.firstName || null,
  }))
}
