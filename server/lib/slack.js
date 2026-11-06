/**
 * Posting to Slack: through the TrackstarOS bot (SLACK_BOT_TOKEN, one token
 * for every channel and DM), or an incoming webhook where a destination has
 * no channel yet or the bot cannot post.
 *
 * Code names a destination ('proofs', 'reports', a teammate), not a webhook:
 * slackTo('reports', text), slackDm(user, text). DESTINATIONS says where each
 * goes. A new channel is one line here and a /invite of the bot, never a new
 * webhook. The old per-channel webhooks stay as the fallback, so nothing
 * goes quiet while the bot is being set up.
 *
 * Fire-and-forget by intent (a ping must never break the request it rides
 * on), but bounded: a hung Slack request used to hold a serverless function
 * open until its time limit.
 */
import { fetchWithTimeout } from './fetchWithTimeout.js'
import { isConnectionOn } from './connections.js'

/**
 * Where each destination goes. `channel` is a Slack channel id (ids survive
 * a rename) or, for a channel made after this was written, its #name; the
 * bot posts there. `user` is a Slack user id for a DM.
 * `env` is the webhook used when there is no bot token, no channel, or the
 * bot's post fails. The bot must be invited to a private channel once.
 */
// Where a message goes (Matt, 2026-11-06):
//   alerts   a short ping the moment something happens or breaks, that
//            someone on the team may need to act on: errors and outages,
//            Artelo holds and refusals, customer changes, proofs sent,
//            comments, files ready, Instant Lookup down, results posted.
//   reports  a summary on a schedule, read when it lands: support triage,
//            bulk orders this week, the nightly sweep, the weekly health
//            check and playbook review.
//   matt     the TrackstarOS DM: only what is Matt's own to act on, a
//            conversation escalated to him or an @mention, a week of hours to
//            approve, a refund or fix only he can make.
export const DESTINATIONS = {
  // Customers approving a custom design, and nothing else.
  proofs: { label: '#proof-approvals', channel: 'C0AMW4YKY9L', env: 'SLACK_PROOF_WEBHOOK_URL' },
  alerts: { label: '#trackstar-alerts', channel: 'C0CELD9LGNM', env: 'SLACK_PROOF_WEBHOOK_URL' },
  reports: { label: '#trackstar-reports', channel: 'C0CD55QHYJU', env: 'SLACK_REPORTS_WEBHOOK_URL' },
  team: { label: '#all-hands', channel: 'C0A6NQD4PLH', env: 'SLACK_WEBHOOK_URL' },
  design: { label: '#all-hands (design standup)', channel: 'C0A6NQD4PLH', env: 'SLACK_DESIGN_WEBHOOK_URL' },
  creators: { label: '#trackstar-creators', channel: 'C0B5X29BLRE', env: 'SLACK_CREATORS_WEBHOOK_URL' },
  lookup: { label: '#trackstar-alerts (Instant Lookup)', channel: 'C0CELD9LGNM', env: 'SLACK_LOOKUP_WEBHOOK_URL' },
  support: { label: '#customer-support', channel: 'C0CEB1ANUJX', env: 'SLACK_SUPPORT_WEBHOOK_URL' },
  matt: { label: "Matt's DM", user: () => process.env.SLACK_USER_ID_MATT || 'U01CQFPL78E', env: 'SLACK_DM_WEBHOOK_URL' },
}

const botToken = () => String(process.env.SLACK_BOT_TOKEN || '').trim()

/** Call a Slack Web API method as the bot. Throws with Slack's error code. */
export async function slackApi(method, body = {}, { timeoutMs = 5000 } = {}) {
  const token = botToken()
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set')
  // chat.* take JSON (blocks are nested); Slack's read methods take only form fields.
  const json = method.startsWith('chat.')
  const res = await fetchWithTimeout(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': json ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` },
    body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  }, timeoutMs)
  const data = await res.json().catch(() => ({}))
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error || `HTTP ${res.status}`}`)
  return data
}

/** A message is text, or { text, blocks }. */
const payload = m => (typeof m === 'string' ? { text: m } : { text: m?.text || '', ...(m?.blocks ? { blocks: m.blocks } : {}) })

async function postWebhook(url, message, timeoutMs) {
  if (!url) return false
  try {
    const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(message)) }, timeoutMs)
    return res.ok
  } catch (err) {
    console.warn(`[slack] post failed: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`)
    return false
  }
}

async function postBot(channel, message, timeoutMs) {
  if (!channel || !botToken()) return false
  try {
    await slackApi('chat.postMessage', { channel, unfurl_links: false, ...payload(message) }, { timeoutMs })
    return true
  } catch (err) {
    console.warn(`[slack] bot post to ${channel} failed: ${err.message}`)
    return false
  }
}

/**
 * Post to a destination (a DESTINATIONS key), falling back through `or`
 * (more keys) when one is not set up. Never throws; returns whether
 * anything reached Slack.
 */
export async function slackTo(dest, message, { or = [], timeoutMs = 5000 } = {}) {
  if (!(await isConnectionOn('slack'))) return false
  for (const key of [dest, ...(Array.isArray(or) ? or : [or])]) {
    const d = DESTINATIONS[key]
    if (!d) continue
    const target = d.channel || (typeof d.user === 'function' ? d.user() : d.user)
    if (await postBot(target, message, timeoutMs)) return true
    if (await postWebhook(process.env[d.env], message, timeoutMs)) return true
  }
  return false
}

const slackIdByEmail = new Map()
/** A teammate's Slack user id, found by their email. Null when Slack does not know it. */
export async function slackUserId(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e || !botToken()) return null
  if (slackIdByEmail.has(e)) return slackIdByEmail.get(e)
  const id = await slackApi('users.lookupByEmail', { email: e }).then(d => d.user?.id || null).catch(() => null)
  if (id) slackIdByEmail.set(e, id)
  return id
}

/**
 * DM a teammate: by the bot, to their Slack id or the one their email finds,
 * else their own webhook (SLACK_<FIRSTNAME>_DM_WEBHOOK_URL, the old way).
 * `user` is { slackId?, email?, firstName? }. Never throws.
 */
export async function slackDm(user, message, { timeoutMs = 5000 } = {}) {
  if (!(await isConnectionOn('slack'))) return false
  const id = user?.slackId || await slackUserId(user?.email)
  if (id && await postBot(id, message, timeoutMs)) return true
  return postWebhook(process.env[dmWebhookEnv(user?.firstName)], message, timeoutMs)
}

/** The old per-person DM webhook's variable: SLACK_ELI_DM_WEBHOOK_URL for Elí. */
export function dmWebhookEnv(firstName) {
  return `SLACK_${String(firstName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')}_DM_WEBHOOK_URL`
}

/**
 * Text someone outside the team typed (a customer, a creator applicant).
 * Slack mrkdwn treats < > & as markup, so <!channel> or <https://x|label>
 * would otherwise render as a mention or a disguised link.
 */
export function slackText(value, max = 500) {
  return String(value ?? '').slice(0, max).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Post `text` to a webhook URL. Never throws; returns whether Slack accepted
 * it. For a URL that is not one of DESTINATIONS (a webhook someone pasted
 * into a setting); everything else uses slackTo or slackDm.
 */
export async function postSlack(webhookUrl, text, { timeoutMs = 5000 } = {}) {
  if (!webhookUrl) return false
  // Slack switched off in Settings > Connections: drop the ping quietly.
  if (!(await isConnectionOn('slack'))) return false
  return postWebhook(webhookUrl, text, timeoutMs)
}
