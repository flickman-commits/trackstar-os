/**
 * Real-time error alerting to Slack (#trackstar-alerts).
 * Call alertError() when a critical operation fails. Never throws: an alert
 * that cannot reach Slack is logged and the caller carries on.
 */
import { slackTo } from '../../server/lib/slack.js'
import prisma from './prisma.js'

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
  const sent = await slackTo('admin', `🚨 *System Alert - ${context}*\n\`${errorMsg}\`${metaStr}`).catch(() => false)
  if (!sent) console.error(`[alert] Could not reach Slack. Error in ${context}:`, error)
}

const ALERT_EVERY_MS = 60 * 60_000

/**
 * A scheduled job failed. Posts to #admin-alerts at most once an hour per job,
 * so a job that fails every two minutes is one message, not thirty. The last
 * post time is kept in SystemConfig (alert_last:<job>), shared by every
 * server instance; an in-memory timer would be one per instance. Never throws.
 */
export async function alertCronFailure(job, error, meta = {}) {
  const key = `alert_last:${job}`
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key } })
    if (row?.value && Date.now() - new Date(row.value).getTime() < ALERT_EVERY_MS) return
    const value = new Date().toISOString()
    await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
  } catch (e) {
    // The database is part of what may be failing: alert anyway rather than stay quiet.
    console.error(`[alert] could not read the last alert time for ${job}:`, e.message)
  }
  await alertError(`${job} failed`, error, meta)
}
