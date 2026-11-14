/**
 * Where an approved print is on its way to Artelo production, from its
 * RenderJob row (written by arteloSend.js). The one vocabulary: the order
 * pipeline (orders/pipeline.js) and the order view both read it.
 *
 *   queued   a short wait the sender gets past on its own (inHold: waiting out the
 *            customer's change window, orders/changeWindow.js)
 *   support  a Support conversation about the order is open (support/holdsPrint.js);
 *            closing it releases the print, Send anyway sends it now
 *   held     a person held it
 *   waiting  attached; the Artelo order has other prints still to come
 *   blocked  Artelo would not take it; under Action with the reason
 *   manual   expedited shipping: attached, but the API only sends Standard,
 *            so a person picks the faster shipping in Artelo and sends it
 *   sent     Artelo has it
 *   null     approved without sending (Approve only, or before Approve sent things)
 */
import { parseSupportOpen } from '../support/holdsPrint.js'

export const WAITING = 'Waiting on the other prints'
// What the sender wrote before 2026-10-26 when the other prints took over an hour.
const OLD_WAITING = /^Attached, but Artelo still says the order is missing designs/
export const EXPEDITED = 'Expedited shipping'
// Longer than the sender's own short buffer (ARTELO_SEND_HOLD_MINUTES, 5) and its retries: the change window.
const HOLD_AFTER_MS = 15 * 60_000

// Waits that clear on their own within minutes: still "Sending to production", not a problem.
const PASSING = /^(Artelo is still processing|Artelo has not imported this order yet|The print is not in the Artelo library yet|Could not reach Artelo: (?!.*\b40[13]\b))/

/** @returns {{ state: string, at?: Date|null, by?: string|null, reason?: string, next?: Date|null } | null} */
export function sendStateOf(job) {
  if (!job || job.review !== 'approved') return null
  if (job.arteloSentAt) return { state: 'sent', at: job.arteloSentAt }
  if (job.sendHeldAt) return { state: 'held', at: job.sendHeldAt, by: job.sendHeldBy || null }
  const support = parseSupportOpen(job.sendError)
  if (support) return { state: 'support', reason: support.reason, threadId: support.threadId, next: job.sendAfter }
  if (job.sendError && job.sendError.startsWith(EXPEDITED)) return { state: 'manual', reason: job.sendError }
  if (job.sendError && (job.sendError.startsWith(WAITING) || OLD_WAITING.test(job.sendError))) return { state: 'waiting', reason: job.sendError, next: job.sendAfter }
  if (job.sendError && job.sendAfter && PASSING.test(job.sendError)) return { state: 'queued', at: job.sendAfter, reason: job.sendError }
  if (job.sendError) return { state: 'blocked', reason: job.sendError, next: job.sendAfter }
  if (job.sendAfter) return { state: 'queued', at: job.sendAfter, inHold: new Date(job.sendAfter).getTime() - Date.now() > HOLD_AFTER_MS }
  return null
}
