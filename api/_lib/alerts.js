/**
 * Real-time error alerting to Slack (#proof-approvals, where the team looks).
 * Call alertError() when a critical operation fails. Never throws: an alert
 * that cannot reach Slack is logged and the caller carries on.
 */
import { slackTo } from '../../server/lib/slack.js'

/**
 * Send an alert to Slack when something breaks in production.
 * @param {string} context - Where the error happened (e.g., "etsy-token-refresh", "proof-email")
 * @param {Error|string} error - The error object or message
 * @param {Object} [meta] - Optional metadata (orderId, etc.)
 */
export async function alertError(context, error, meta = {}) {
  const errorMsg = error instanceof Error ? error.message : String(error)
  const metaStr = Object.keys(meta).length
    ? '\n' + Object.entries(meta).map(([k, v]) => `• ${k}: ${v}`).join('\n')
    : ''
  const sent = await slackTo('proofs', `🚨 *System Alert - ${context}*\n\`${errorMsg}\`${metaStr}`).catch(() => false)
  if (!sent) console.error(`[alert] Could not reach Slack. Error in ${context}:`, error)
}
