/**
 * An open Support conversation holds an order's print from production
 * (render/arteloSend.js checks before every send). Matt, 2026-11-05: support
 * tickets kept turning into reprints because the print went while the
 * customer was still asking for a change.
 *
 * A conversation counts when it is not closed (open, waiting, escalated or
 * snoozed), not filtered or merged away, and is about this order:
 *   - a person linked the order to the conversation's customer, or
 *   - it is with the order's email and the customer wrote in after ordering
 *     (an old thread about an earlier order does not hold a new one).
 * Closing the conversation releases the print on the sender's next look
 * (within 15 minutes). Send anyway on the order sends it regardless, and
 * from then on only a newer message from the customer holds it again.
 */
import prisma from '../../db.js'
import { placedAt } from '../orders/changeWindow.js'

export const SUPPORT_OPEN = 'Support conversation open'
// The person's override, kept in RenderJob.sendHeldBy while sendHeldAt is empty.
export const SENT_ANYWAY = 'Sent anyway by '

/** "Support conversation open with Jane Doe [thread:abc]": what the sender saves as the job's sendError. */
export const supportOpenError = t => `${SUPPORT_OPEN} with ${t.who} [thread:${t.id}]`

/** The thread id and the words to show, from a saved sendError. */
export function parseSupportOpen(error) {
  if (!String(error || '').startsWith(SUPPORT_OPEN)) return null
  const m = /\s*\[thread:([^\]]+)\]\s*$/.exec(error)
  return { threadId: m ? m[1] : null, reason: m ? error.slice(0, m.index) : error }
}

/** When a person pressed Send anyway on this job, or null. */
export function sentAnywayAt(job) {
  const s = String(job?.sendHeldBy || '')
  if (job?.sendHeldAt || !s.startsWith(SENT_ANYWAY)) return null
  const d = new Date(s.slice(s.lastIndexOf(' at ') + 4))
  return Number.isNaN(d.getTime()) ? null : d
}

export const sentAnywayMark = (name, at = new Date()) => `${SENT_ANYWAY}${name} at ${at.toISOString()}`

/**
 * For the conversation view: where the prints of these orders stand while the
 * team talks to the customer. 'hold' = waiting out the 48-hour window (goes on
 * its own at `until`); 'support' = held by an open conversation (this one or
 * another), released when it is closed.
 * @param {string[]} numbers order numbers as Support shows them ("4517")
 */
export async function printHolds(numbers) {
  const names = [...new Set(numbers.map(n => String(n || '').replace(/^#/, '').trim()).filter(Boolean))].slice(0, 10)
  if (!names.length) return []
  const orders = await prisma.order.findMany({
    where: { status: { not: 'completed' }, OR: names.map(n => ({ shopifyOrderData: { path: ['name'], equals: `#${n}` } })) },
    select: { shopifyOrderData: true, runnerName: true, renderJobs: { where: { status: 'done', review: 'approved' }, orderBy: { version: 'desc' }, take: 1, select: { sendAfter: true, sendHeldAt: true, sendError: true, arteloSentAt: true } } },
  })
  const out = []
  for (const o of orders) {
    const j = o.renderJobs[0]
    if (!j || j.arteloSentAt || j.sendHeldAt) continue
    const number = String(o.shopifyOrderData?.name || '').replace(/^#/, '')
    const support = parseSupportOpen(j.sendError)
    if (support) out.push({ number, runner: o.runnerName || null, state: 'support', threadId: support.threadId })
    else if (!j.sendError && j.sendAfter && new Date(j.sendAfter).getTime() - Date.now() > 15 * 60_000) out.push({ number, runner: o.runnerName || null, state: 'hold', until: j.sendAfter })
  }
  return out
}

const who = t => t.customerName || t.customerEmail || (t.igUsername ? `@${t.igUsername}` : 'the customer')

/**
 * The open conversation holding this order's print, or null.
 * @param {{ parentOrderNumber?: string, orderNumber?: string, customerEmail?: string, shopifyOrderData?: any, createdAt?: Date }} order
 * @param {{ after?: Date|null }} [opts] ignore conversations the customer has not written in since (Send anyway)
 */
export async function openConversationFor(order, { after = null } = {}) {
  // The number a person reads ("4517"), as Support links it: Shopify's name, not our parentOrderNumber (Shopify's id).
  const number = String(order.shopifyOrderData?.name || '').replace(/^#/, '').trim()
  const email = String(order.customerEmail || '').trim().toLowerCase()
  const keys = number ? (await prisma.supportLinkedOrder.findMany({ where: { orderNumber: number }, select: { customerKey: true } })).map(r => r.customerKey) : []
  const emailKeys = keys.filter(k => !k.startsWith('ig:'))
  const igKeys = keys.filter(k => k.startsWith('ig:')).map(k => k.slice(3))
  const placed = placedAt(order)

  const about = [
    ...emailKeys.map(k => ({ customerEmail: { equals: k, mode: 'insensitive' } })),
    ...(igKeys.length ? [{ igUserId: { in: igKeys } }] : []),
    ...(email ? [{ customerEmail: { equals: email, mode: 'insensitive' }, ...(placed ? { lastInboundAt: { gte: placed } } : {}) }] : []),
  ]
  if (!about.length) return null
  const t = await prisma.supportThread.findFirst({
    where: {
      status: { not: 'closed' }, filtered: false, mergedIntoId: null,
      OR: about,
      ...(after ? { lastInboundAt: { gt: after } } : {}),
    },
    orderBy: { lastInboundAt: 'desc' },
    select: { id: true, customerName: true, customerEmail: true, igUsername: true },
  })
  return t ? { id: t.id, who: who(t) } : null
}
