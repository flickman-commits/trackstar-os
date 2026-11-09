/**
 * The month-end custom statement: at 10am Eastern on the last day of the month,
 * each designer gets a Slack DM listing the customs the counter has for them
 * (customCounter.js), the rate for each, and the total, and is asked to check
 * it; Matt pays. One message per designer per month (SystemConfig records it).
 *
 * The Slack bot DMs each designer, found by their email (slackDm); their old
 * SLACK_<FIRSTNAME>_DM_WEBHOOK_URL still works if the bot cannot. A designer
 * it cannot reach is listed in a note to Matt so nobody is skipped quietly.
 */
import prisma from '../../db.js'
import { customCounter } from './customCounter.js'
import { slackTo, slackDm, slackText } from '../../lib/slack.js'

const TZ = 'America/New_York'
const usd = cents => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const etParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]))

/** 10am Eastern (the cron runs hourly on the 28th-31st; UTC moves with daylight saving). */
export function isTenAmEastern(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(now)) === 10
}

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
    `*${designer.count} design${designer.count === 1 ? '' : 's'}*: ${fresh} new at ${usd(designer.rateCents)}${designer.repeats ? ` and ${designer.repeats} repeat${designer.repeats === 1 ? '' : 's'} at ${usd(designer.repeatRateCents)}` : ''}. *Total ${usd(designer.payoutCents)}*`,
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
  if (!force && !isTenAmEastern(now)) return { month, sent: [], missingWebhook: [], skipped: 'not 10am Eastern yet' }
  const key = `custom_statements_sent:${month}`
  if (!force && await prisma.systemConfig.findUnique({ where: { key } })) return { month, sent: [], missingWebhook: [], skipped: 'already sent' }

  const monthLabel = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const data = await customCounter(month)
  const sent = []
  const missingWebhook = []
  for (const d of data.designers) {
    if (!d.userId || !d.rateCents || !d.count) continue
    const user = await prisma.user.findUnique({ where: { id: d.userId }, select: { email: true, firstName: true } })
    if (await slackDm(user, statementText(d, monthLabel))) sent.push(d.name)
    else missingWebhook.push(d.name)
  }
  if (missingWebhook.length) {
    await slackTo('admin', `The ${monthLabel} custom statements could not reach ${missingWebhook.join(', ')} in Slack: their TrackstarOS email must match their Slack email for the bot to find them. Settings > Custom Counter has their totals.`)
  }
  await prisma.systemConfig.upsert({ where: { key }, update: { value: JSON.stringify({ sent, missingWebhook, at: new Date().toISOString() }) }, create: { key, value: JSON.stringify({ sent, missingWebhook, at: new Date().toISOString() }) } })
  return { month, sent, missingWebhook }
}
