/**
 * Support for people who see only their own conversations.
 *
 * Dan and Creed (designers) write to the customers on their custom orders
 * from Support without seeing the rest of the inbox: the 'support.own'
 * capability. A conversation is theirs when it is assigned to them, or when
 * it is with a customer whose custom order is assigned to them (and it has
 * gone on since that order was placed): customers answer by writing in fresh
 * as often as by replying, and those land on Support, so a rule on the
 * assignee alone left a designer looking at "That conversation is not
 * assigned to you" on their own order (8306, Creed, 2026-11-23). My Inbox is
 * their not-closed conversations. An email they send from an order starts a
 * new conversation assigned to them (compose.js).
 *
 * The endpoints call requireSupport (api/_lib/users.js), which sets
 * `user.supportScope` to 'all' or 'own'; everything an 'own' person reaches
 * goes through here. The screens hide the rest, but this is what holds.
 */
import prisma from '../../db.js'
import { UserError } from './errors.js'

export const NOT_YOURS = 'That conversation is not about one of your orders'

/** 'all' for the whole inbox, 'own' for only theirs. */
export function isOwnOnly(user) {
  return user?.supportScope === 'own'
}

/**
 * The thread actions an 'own' person may take on a conversation of theirs.
 * Not here: merging (it reaches the customer's other conversations), linking
 * orders, star, damage, and approving Claude's suggested actions (refunds,
 * replacements), which stay with Support.
 */
export const OWN_THREAD_ACTIONS = new Set(['mockups', 'assign', 'status', 'snooze', 'tags', 'note', 'deleteNote', 'redraft', 'notWaiting', 'unread'])

/** How far back an order still makes its customer the designer's: a problem with a print can come months later. */
const CUSTOMER_DAYS = 180

const loadOwnOrders = userId => prisma.order.findMany({
  where: { assigneeId: userId, trackstarOrderType: 'custom', createdAt: { gte: new Date(Date.now() - CUSTOMER_DAYS * 86_400_000) } },
  select: { customerEmail: true, createdAt: true, shopifyOrderData: true, parentOrderNumber: true, orderNumber: true },
})
const loadLinkedEmails = numbers => prisma.supportLinkedOrder.findMany({ where: { orderNumber: { in: numbers } }, select: { customerKey: true, orderNumber: true } })
const numberOf = o => String(o.shopifyOrderData?.name || o.parentOrderNumber || o.orderNumber || '').replace(/^#/, '')

/**
 * The customers whose custom orders this designer has, with when the earliest
 * of those orders was placed: [{ email, since }]. The order's own email, and
 * any address a teammate linked to the order by hand (SupportLinkedOrder).
 */
export async function designerCustomers(userId, { orders = loadOwnOrders, linked = loadLinkedEmails } = {}) {
  const rows = await orders(userId)
  const since = new Map()
  const add = (email, at) => {
    const e = String(email || '').trim().toLowerCase()
    if (!e || e.startsWith('ig:')) return
    const t = new Date(at)
    if (!since.has(e) || since.get(e) > t) since.set(e, t)
  }
  for (const o of rows) add(o.customerEmail, o.createdAt)
  const byNumber = new Map(rows.map(o => [numberOf(o), o]))
  if (byNumber.size) {
    for (const l of await linked([...byNumber.keys()].filter(Boolean))) {
      const o = byNumber.get(l.orderNumber)
      if (o) add(l.customerKey, o.createdAt)
    }
  }
  return [...since.entries()].map(([email, at]) => ({ email, since: at }))
}

/** Whether a stored conversation is this designer's: assigned to them, or with one of their customers since that order. */
export function isTheirConversation(t, userId, customers) {
  if (!t) return false
  if (t.assigneeId === userId) return true
  const e = String(t.customerEmail || '').trim().toLowerCase()
  if (!e) return false
  return customers.some(c => c.email === e && new Date(t.lastMessageAt || 0) >= c.since)
}

/** Where clause for an 'own' person's inbox: theirs (see isTheirConversation), not closed, not merged away. */
export function ownInboxWhere(userId, customers = []) {
  return {
    mergedIntoId: null, status: { not: 'closed' },
    OR: [
      { assigneeId: userId },
      ...customers.map(c => ({ customerEmail: { equals: c.email, mode: 'insensitive' }, lastMessageAt: { gte: c.since } })),
    ],
  }
}

/**
 * Throws unless this person may open this conversation: anyone with the
 * whole inbox may; an 'own' person only when it is assigned to them. A
 * conversation merged into another is judged by the one it went into.
 */
const loadThread = id => prisma.supportThread.findUnique({ where: { id: String(id || '') }, select: { id: true, assigneeId: true, mergedIntoId: true, customerEmail: true, lastMessageAt: true } })

/** Returns the conversation (an 'own' person's check may need its assignee); undefined for anyone with the whole inbox. */
export async function assertThreadAccess(user, threadId, { load = loadThread, customers = designerCustomers } = {}) {
  if (!isOwnOnly(user)) return
  let t = await load(threadId)
  for (let hop = 0; t?.mergedIntoId && hop < 5; hop++) {
    t = await load(t.mergedIntoId) || t
  }
  // Assigned to them is the usual case and needs no second look at their orders.
  if (t && t.assigneeId === user.id) return t
  if (!t || !isTheirConversation(t, user.id, await customers(user.id))) throw new UserError(NOT_YOURS, { status: 403, code: 'not_allowed' })
  return t
}

/** The same check for a stored message (attachments are fetched by message). */
export async function assertMessageAccess(user, messageId) {
  if (!isOwnOnly(user)) return
  const m = await prisma.supportMessage.findUnique({ where: { id: String(messageId || '') }, select: { threadId: true } })
  if (!m) throw new UserError(NOT_YOURS, { status: 403, code: 'not_allowed' })
  await assertThreadAccess(user, m.threadId)
}

/**
 * An 'own' person may take a conversation, or hand back one they have to
 * Support (unassign it); giving it to someone else, or taking it off a
 * teammate who has it, is Support's call.
 */
export function assertOwnAssign(user, assigneeId, currentAssigneeId = null) {
  if (!isOwnOnly(user)) return
  if (assigneeId && assigneeId !== user.id) throw new UserError('You can send this back to Support, but only Support can give it to someone else', { status: 403, code: 'not_allowed' })
  if (currentAssigneeId && currentAssigneeId !== user.id) throw new UserError('A teammate has this conversation. You can answer it here; ask them to hand it to you if you need to own it.', { status: 403, code: 'not_allowed' })
}

/**
 * A conversation as an 'own' person sees it: the custom orders assigned to
 * them, and nothing about the customer's other conversations or orders.
 */
const loadMine = async (ids, userId) => (await prisma.order.findMany({ where: { id: { in: ids }, assigneeId: userId }, select: { id: true } })).map(o => o.id)

export async function narrowThreadForOwn(t, userId, { mineOf = loadMine } = {}) {
  const orders = t.context?.orders || []
  const ids = orders.flatMap(o => (o.items || []).map(it => it.orderId)).filter(Boolean)
  const mine = new Set(ids.length ? await mineOf(ids, userId) : [])
  const keep = orders.filter(o => (o.items || []).some(it => mine.has(it.orderId)))
  return {
    ...t,
    context: { ...t.context, orders: keep, bigSpender: false },
    suggestedOrders: [],
    pastThreads: [],
    printHolds: (t.printHolds || []).filter(h => keep.some(o => String(o.number) === String(h.number))),
    customer: { ...t.customer, conversations: 1 },
    ownOnly: true,
  }
}
