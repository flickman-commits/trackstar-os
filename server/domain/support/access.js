/**
 * Support for people who see only their own conversations.
 *
 * Dan and Creed (designers) write to the customers on their custom orders
 * from Support without seeing the rest of the inbox: the 'support.own'
 * capability. They see one view, My Inbox, which is every conversation
 * assigned to them that is not closed, and can open, answer and act on only
 * those. An email they send from an order starts a new conversation assigned
 * to them (compose.js), so the customer's reply comes back to them.
 *
 * The endpoints call requireSupport (api/_lib/users.js), which sets
 * `user.supportScope` to 'all' or 'own'; everything an 'own' person reaches
 * goes through here. The screens hide the rest, but this is what holds.
 */
import prisma from '../../db.js'
import { UserError } from './errors.js'

export const NOT_YOURS = 'That conversation is not assigned to you'

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

/** Where clause for an 'own' person's inbox: assigned to them, not closed, not merged away. */
export function ownInboxWhere(userId) {
  return { assigneeId: userId, mergedIntoId: null, status: { not: 'closed' } }
}

/**
 * Throws unless this person may open this conversation: anyone with the
 * whole inbox may; an 'own' person only when it is assigned to them. A
 * conversation merged into another is judged by the one it went into.
 */
const loadThread = id => prisma.supportThread.findUnique({ where: { id: String(id || '') }, select: { id: true, assigneeId: true, mergedIntoId: true } })

export async function assertThreadAccess(user, threadId, { load = loadThread } = {}) {
  if (!isOwnOnly(user)) return
  let t = await load(threadId)
  for (let hop = 0; t?.mergedIntoId && hop < 5; hop++) {
    t = await load(t.mergedIntoId) || t
  }
  if (!t || t.assigneeId !== user.id) throw new UserError(NOT_YOURS, { status: 403, code: 'not_allowed' })
}

/** The same check for a stored message (attachments are fetched by message). */
export async function assertMessageAccess(user, messageId) {
  if (!isOwnOnly(user)) return
  const m = await prisma.supportMessage.findUnique({ where: { id: String(messageId || '') }, select: { threadId: true } })
  if (!m) throw new UserError(NOT_YOURS, { status: 403, code: 'not_allowed' })
  await assertThreadAccess(user, m.threadId)
}

/**
 * An 'own' person may hand a conversation back to Support (unassign it) or
 * keep it; giving it to someone else is Support's call.
 */
export function assertOwnAssign(user, assigneeId) {
  if (!isOwnOnly(user)) return
  if (assigneeId && assigneeId !== user.id) throw new UserError('You can send this back to Support, but only Support can give it to someone else', { status: 403, code: 'not_allowed' })
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
