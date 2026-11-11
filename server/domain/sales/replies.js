/**
 * Has the person answered since our last email?
 *
 * A prospect who replied, or asked us to stop, still showed as due for the
 * next touch until someone moved the stage in Attio, and the tool would send
 * it. The Gmail grant already includes reading message headers for this
 * (gmail.js threadMessages, metadata only, never a body); nothing called it.
 * Now a follow-up in a sequence is held when the thread of our first email
 * has a message from them after our last touch. A one-off "New email" is the
 * rep's choice and is not held.
 *
 * Covers replies in our thread, which is where nearly all of them land; a
 * reply sent as a new email to the rep is not seen.
 */
import prisma from '../../db.js'
import { threadMessages } from './gmail.js'

/** The newest message in the thread that we did not send, after `since`. Pure. */
export function replyAfter(messages, since) {
  const after = since ? new Date(since).getTime() : 0
  const theirs = (messages || [])
    .filter(m => !(m.labelIds || []).includes('SENT') && !(m.labelIds || []).includes('DRAFT'))
    .filter(m => m.date && new Date(m.date).getTime() > after)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  return theirs[0] || null
}

/**
 * The reply that should hold the next touch, or null. Never throws: if Gmail
 * cannot be read, the send goes ahead as before and the reason is logged.
 */
export async function replySinceLastTouch(dealId) {
  try {
    const sends = await prisma.salesSend.findMany({ where: { attioDealId: String(dealId) }, orderBy: { sentAt: 'asc' }, select: { gmailThreadId: true, sentById: true, sentAt: true } })
    const first = sends.find(s => s.gmailThreadId && s.sentById)
    if (!first) return null
    const last = sends[sends.length - 1]
    const messages = await threadMessages({ userId: first.sentById, threadId: first.gmailThreadId })
    return replyAfter(messages, last?.sentAt)
  } catch (err) {
    console.warn(`[sales.replies] could not check ${dealId} for a reply: ${err.message}`)
    return null
  }
}

export function replyHoldText(reply) {
  const when = new Date(reply.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `They replied on ${when}. Read it before sending another touch, and move the deal in Attio if it is settled (or use New email to answer them).`
}
