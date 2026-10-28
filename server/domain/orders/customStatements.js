/**
 * The month-end custom statement: on the last day of the month (Eastern),
 * each designer gets a Slack DM listing the customs the counter has for them
 * (customCounter.js), the rate for each, and the total, and is asked to check
 * it; Matt pays. One message per designer per month (SystemConfig records it).
 *
 * Each designer's DM is an incoming webhook, the same as Eli's:
 * SLACK_<FIRSTNAME>_DM_WEBHOOK_URL (SLACK_DAN_DM_WEBHOOK_URL,
 * SLACK_CREED_DM_WEBHOOK_URL, ...). A designer without one is listed in a
 * note to Matt (SLACK_DM_WEBHOOK_URL) so nobody is skipped quietly.
 */
import prisma from '../../db.js'
import { customCounter } from './customCounter.js'
import { postSlack, slackText } from '../../lib/slack.js'

const TZ = 'America/New_York'
const usd = cents => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const etParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]))

/** True on the last calendar day of the month, Eastern. */
export function isLastDayOfMonth(now = new Date()) {
  const today = etParts(now)
  const tomorrow = etParts(new Date(now.getTime() + 24 * 3600e3))
  return today.month !== tomorrow.month
}

export function statementText(designer, monthLabel) {
  const first = designer.name.split(' ')[0]
  const lines = designer.orders.map(o => {
    const day = new Date(o.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
    return `• ${day} · ${slackText(o.display)}${o.item > 1 ? ` (item ${o.item})` : ''} · ${slackText(o.race)}${o.runnerName ? ` · ${slackText(o.runnerName)}` : ''} · ${usd(o.rateCents)}${o.repeat ? ' (repeat)' : ''}`
  })
  const fresh = designer.count - designer.repeats
  return [
    `Hey ${slackText(first)}! Here's what we've got for your customs for ${monthLabel}:`,
    '',
    ...lines,
    '',
    `*${designer.count} design${designer.count === 1 ? '' : 's'}*: ${fresh} new at ${usd(designer.rateCents)}${designer.repeats ? ` and ${designer.repeats} repeat${designer.repeats === 1 ? '' : 's'} at ${usd(designer.rateCents / 2)}` : ''}. *Total ${usd(designer.payoutCents)}*`,
    '',
    `Can you look it over and make sure everything looks good? If anything's missing or off, just reply here. You'll receive payment from Matt.`,
  ].join('\n')
}

/**
 * Send this month's statements. `force` sends even if not the last day (or
 * already sent), for a test or a resend.
 * @returns {Promise<{ month: string, sent: string[], missingWebhook: string[], skipped?: string }>}
 */
export async function sendCustomStatements({ now = new Date(), force = false } = {}) {
  const p = etParts(now)
  const month = `${p.year}-${p.month}`
  if (!force && !isLastDayOfMonth(now)) return { month, sent: [], missingWebhook: [], skipped: 'not the last day of the month' }
  const key = `custom_statements_sent:${month}`
  if (!force && await prisma.systemConfig.findUnique({ where: { key } })) return { month, sent: [], missingWebhook: [], skipped: 'already sent' }

  const monthLabel = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const data = await customCounter(month)
  const sent = []
  const missingWebhook = []
  for (const d of data.designers) {
    if (!d.userId || !d.rateCents || !d.count) continue
    const first = d.name.split(' ')[0]
    const url = process.env[`SLACK_${first.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()}_DM_WEBHOOK_URL`]
    if (!url) { missingWebhook.push(d.name); continue }
    if (await postSlack(url, statementText(d, monthLabel))) sent.push(d.name)
    else missingWebhook.push(`${d.name} (Slack refused)`)
  }
  if (missingWebhook.length && process.env.SLACK_DM_WEBHOOK_URL) {
    await postSlack(process.env.SLACK_DM_WEBHOOK_URL, `The ${monthLabel} custom statements could not reach ${missingWebhook.join(', ')}: add SLACK_<FIRSTNAME>_DM_WEBHOOK_URL for each (a Slack incoming webhook to their DM). Settings > Custom Counter has their totals.`)
  }
  await prisma.systemConfig.upsert({ where: { key }, update: { value: JSON.stringify({ sent, missingWebhook, at: new Date().toISOString() }) }, create: { key, value: JSON.stringify({ sent, missingWebhook, at: new Date().toISOString() }) } })
  return { month, sent, missingWebhook }
}
