/**
 * The triage pass: twice a day, before each stretch of support work, Claude
 * reads every open conversation the customer wrote last and stars the urgent
 * ones, so the team starts with those (Support's "Priority first" sort).
 *
 * Urgent means one of URGENT below: an order that did not arrive, arrived
 * broken or wrong, a customer who is upset, a dispute, a date they need it
 * by, or anything that has to happen before an order goes out (an address,
 * a name, a size, a cancel, an answer we are waiting on). Orders move fast,
 * so the last kind is the one most worth catching.
 *
 * It only adds stars: a star a person set or removed is theirs, and a thread
 * is read again only after the customer writes something new. Each star
 * leaves its reason as a note from Claude in the timeline, and the
 * run's list goes to Slack. api/cron/support-triage.js runs it.
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured } from '../../lib/llm.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { appBaseUrl } from '../../lib/links.js'
import { customerContext, linkedOrderNumbers, orderNumberWhere } from './threads.js'
import { ordersBrief, quotedOrderNumbers } from './draft.js'
import { stripQuoted } from './mailbox.js'

const MODEL = 'claude-sonnet-5-5'
// Sonnet 5.5 list prices, USD per million tokens (platform.claude.com pricing, Nov 2026). Only for the cost line in Slack.
const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 }

/** What a pass's tokens cost, in dollars. `usage.input` includes cached tokens (server/lib/llm.js). */
export function costOf(u) {
  const plain = Math.max(0, u.input - u.cached - u.cacheWrite)
  return (plain * PRICE.input + u.cacheWrite * PRICE.cacheWrite + u.cached * PRICE.cacheRead + u.output * PRICE.output) / 1e6
}
const fmtTokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
/** "~$0.42 (310k in, 12k out)" for Slack. */
export const costLine = u => `~$${costOf(u).toFixed(2)} (${fmtTokens(u.input)} tokens in, ${fmtTokens(u.output)} out)`
const MAX_THREADS = 200
const CONCURRENCY = 5
// Stop starting new threads before the function's 300s runs out; the rest wait for the next pass.
const BUDGET_MS = 230_000
// This many failures in a row before anything is read means the model is down: stop and say so.
const DOWN_AFTER = 5
// Set while a pass left conversations unread because of errors; the hourly retry runs only then.
const RETRY_KEY = 'support_triage_retry'

/** What counts as urgent, in the order the Slack list groups them. */
export const URGENT = {
  before_ship: 'Has to happen before the order goes out',
  not_arrived: 'Order has not arrived',
  damaged: 'Arrived broken, damaged or wrong',
  upset: 'Customer is upset',
  dispute: 'Chargeback, dispute or refund demand',
  deadline: 'Needed by a date',
}

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }

const SYSTEM = `You triage the customer support inbox for Trackstar, which sells personalized race prints (a runner's name, time and race, printed and framed by our print partner and shipped from there). Orders go to production within a day or two of being placed, so anything that must change before then is a race against the clock.

Decide whether this conversation is URGENT: the team should handle it first thing. It is urgent when any of these is true:
- before_ship: something must happen before the order prints or ships. A new shipping address, a name, time, year or race to correct, a size or frame change, a cancellation, a photo or detail they are sending, an answer to a question we asked, approving or fixing a design. Urgent whenever the order may not have shipped yet. An address change on an order already shipped is still urgent (the carrier can sometimes redirect it).
- not_arrived: the order has not arrived, is late, tracking is stuck, it says delivered but they do not have it, or they ask where it is after more than two weeks.
- damaged: it arrived broken, cracked, bent, damaged, or wrong (wrong print, name, time, size or frame).
- upset: the customer is angry, frustrated or upset: harsh words, all caps, repeated follow-ups with no answer, "this is ridiculous", threats of a bad review, a chargeback, the BBB or a lawyer.
- dispute: a chargeback or payment dispute, or a demand for a refund.
- deadline: they need it by a date that is close (a gift for a birthday or holiday, an event), or the order was paid as expedited or rush.

Not urgent: questions before buying (do you have my race, sizes, prices, custom quotes), a "where is my order" inside the normal two to three weeks with nothing else wrong, thanks and reviews, partnership or wholesale pitches, press, newsletters, and anything already settled in the conversation.

When unsure between urgent and not, pick urgent only if waiting a day could cost the customer something (a print made wrong, a missed date, a lost package, a customer lost).

Reply as JSON: {"urgent": true or false, "category": one of "before_ship", "not_arrived", "damaged", "upset", "dispute", "deadline", or null when not urgent, "reason": "<one short line for the team saying what is needed, with the order number if there is one; no em dashes>"}`

/** The conversation and where their orders stand, in as few lines as the decision needs. */
export async function triageFacts(t) {
  const messages = await prisma.supportMessage.findMany({ where: { threadId: t.id }, orderBy: { sentAt: 'desc' }, take: 5, select: { direction: true, bodyText: true, sentAt: true, attachments: true } })
  const conversation = messages.reverse().map(m => `${m.direction === 'in' ? 'CUSTOMER' : 'TRACKSTAR'} on ${new Date(m.sentAt).toDateString()}:\n${clip(stripQuoted(m.bodyText) || '(no text)', 1500)}${Array.isArray(m.attachments) && m.attachments.length ? `\n[attached: ${m.attachments.length} file(s)]` : ''}`).join('\n\n')

  const linked = await linkedOrderNumbers(t)
  let context = (t.customerEmail || linked.length) ? await customerContext(t.customerEmail, { linked }) : { orders: [] }
  // Internal only, never shown to the customer: an order number they quoted is enough to tell whether it has shipped.
  if (!context.orders.length) {
    for (const n of quotedOrderNumbers(messages.filter(m => m.direction === 'in').map(m => m.bodyText).join('\n'))) {
      const row = await prisma.order.findFirst({ where: { OR: orderNumberWhere(n) }, select: { customerEmail: true } })
      if (row?.customerEmail) { context = await customerContext(row.customerEmail); if (context.orders.length) break }
    }
  }
  return [
    `Today is ${new Date().toDateString()}.`,
    `Subject: ${t.subject || '(none)'}. Channel: ${t.channel === 'instagram' ? 'Instagram DM' : 'email'}.`,
    '',
    'Their orders:',
    ordersBrief(context.orders),
    '',
    'The conversation, oldest first:',
    conversation,
  ].join('\n')
}

/** Read one conversation and decide. Returns { urgent, category, reason }. */
export async function triageThread(t) {
  const out = await complete({
    system: SYSTEM,
    prompt: `${await triageFacts(t)}\n\nIs this conversation urgent?`,
    json: true,
    maxTokens: 2000,
    effort: 'low',
    model: MODEL,
    cacheSystem: true,
    purpose: 'support.triage',
  })
  const j = out.json || {}
  const category = Object.hasOwn(URGENT, j.category) ? j.category : null
  const urgent = j.urgent === true
  return { usage: out.usage, urgent, category: urgent ? (category || 'upset') : null, reason: clip(String(j.reason || '').replace(/\s*[—–]\s*/g, ', '), 200) }
}

/**
 * The pass. Open, not snoozed, the customer wrote last, and nothing new
 * from them since the last pass read it. `dryRun` decides without saving.
 */
export async function triagePending({ dryRun = false } = {}) {
  if (!isLlmConfigured()) return { status: 'skipped', reason: 'No model is configured (ANTHROPIC_API_KEY).' }
  const now = new Date()
  const candidates = await prisma.supportThread.findMany({
    where: {
      status: 'open', filtered: false, mergedIntoId: null, lastInboundAt: { not: null },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    orderBy: { lastInboundAt: 'asc' },
    take: 500,
  })
  const due = candidates.filter(t =>
    (!t.lastOutboundAt || t.lastOutboundAt < t.lastInboundAt) &&
    (!t.triagedAt || t.triagedAt < t.lastInboundAt)).slice(0, MAX_THREADS)

  const started = Date.now()
  const results = []
  let failed = 0, next = 0, firstError = null
  const usage = { input: 0, cached: 0, cacheWrite: 0, output: 0 }
  const down = () => failed >= DOWN_AFTER && results.length === 0
  async function worker() {
    while (next < due.length && Date.now() - started < BUDGET_MS && !down()) {
      const t = due[next++]
      try {
        const d = await triageThread(t)
        for (const k of Object.keys(usage)) usage[k] += d.usage?.[k] || 0
        results.push({ t, ...d })
        if (dryRun) continue
        if (d.urgent && !t.priority) {
          await prisma.supportThread.update({ where: { id: t.id }, data: { priority: true, priorityReason: d.reason, triagedAt: new Date() } })
          // A note in the timeline, where the team reads what is going on, not a line under the header.
          await prisma.supportNote.create({ data: { threadId: t.id, kind: 'note', body: `Marked this priority (${URGENT[d.category]}): ${d.reason || URGENT[d.category]}`, authorName: 'Claude' } })
        } else {
          await prisma.supportThread.update({ where: { id: t.id }, data: { triagedAt: new Date() } })
        }
      } catch (err) {
        failed++
        firstError ||= String(err?.message || err).slice(0, 300)
        console.warn(`[support.triage] ${t.id}: ${err.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const urgent = results.filter(r => r.urgent)
  return {
    status: dryRun ? 'dry-run' : down() ? 'down' : 'done',
    read: results.length,
    failed,
    firstError,
    usage,
    cost: Math.round(costOf(usage) * 100) / 100,
    due: due.length,
    left: due.length - next,
    starred: urgent.filter(r => !r.t.priority).length,
    urgent: urgent.map(r => ({ id: r.t.id, who: r.t.customerName || r.t.customerEmail || (r.t.igUsername ? `@${r.t.igUsername}` : 'Unknown'), subject: r.t.subject, category: r.category, reason: r.reason, alreadyStarred: r.t.priority })),
  }
}

const whoOf = t => slackText(t.customerName || t.customerEmail || (t.igUsername ? `@${t.igUsername}` : 'Unknown'), 60)

/**
 * The cron: triage, then say so in #trackstar-reports: that it ran, how many
 * it read and how many it marked urgent, in two lines. Once the 'support'
 * destination has a channel (server/lib/slack.js), the support team also
 * gets a short summary there: how many are open, how many urgent, and the
 * three oldest urgent ones to start with. Why each is urgent is a note in
 * the conversation, not in Slack.
 */
export async function scheduledTriage({ retryOnly = false } = {}) {
  // The hourly retry only runs after a pass that could not read everything.
  if (retryOnly && !(await prisma.systemConfig.findUnique({ where: { key: RETRY_KEY } }))) return { status: 'skipped', reason: 'Nothing to retry.' }
  const out = await triagePending()
  if (out.status === 'skipped') return out
  const unread = out.failed > 0 || out.status === 'down'
  if (unread) await prisma.systemConfig.upsert({ where: { key: RETRY_KEY }, create: { key: RETRY_KEY, value: new Date().toISOString() }, update: { value: new Date().toISOString() } })
  else await prisma.systemConfig.deleteMany({ where: { key: RETRY_KEY } })

  // Could not reach the model: say so loudly, once, and do not tell the team "nothing urgent".
  if (out.status === 'down') {
    if (!retryOnly) await slackTo('alerts', `:warning: *Support triage could not reach Claude*, so none of the ${out.due} waiting conversations were read and nothing was marked urgent. It tries again every hour until it works.\nError: ${slackText(out.firstError || 'unknown', 300)}`, { or: 'matt' })
    return out
  }
  // A retry that did nothing new stays quiet.
  if (retryOnly && !out.read) return out
  const starred = await prisma.supportThread.findMany({
    where: { status: 'open', priority: true, filtered: false, mergedIntoId: null },
    orderBy: { lastInboundAt: 'asc' },
    select: { id: true, customerName: true, customerEmail: true, igUsername: true, subject: true, priorityReason: true },
  })
  const base = appBaseUrl()
  const link = t => `<${base}/support?thread=${encodeURIComponent(t.id)}|${whoOf(t)}>`
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  // Short: that it ran and the counts. Who and why are in Support and in each conversation's note.
  const report = [
    `_Support Triage_ · ${when} ET`,
    `Read ${out.read} new conversation${out.read === 1 ? '' : 's'}, marked *${out.starred} urgent*. ${starred.length} urgent open in <${base}/support|Support>.${out.left ? ` ${out.left} wait for the next pass.` : ''}${out.failed ? ` *${out.failed} could not be read* (${slackText(out.firstError || 'unknown error', 160)}); it tries them again within the hour.` : ''}`,
    `Cost ${costLine(out.usage)}.`,
  ].join('\n')
  await slackTo('reports', report, { or: 'matt' })

  // The support team's summary: how many are open, how many are urgent, and the three to start with.
  const open = await prisma.supportThread.count({ where: { status: 'open', filtered: false, mergedIntoId: null } })
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }))
  const greeting = hour < 12 ? 'Good morning' : 'Good afternoon'
  const summary = [
    `${greeting}. *${open}* open conversation${open === 1 ? '' : 's'}, *${starred.length}* urgent.`,
    starred.length ? `Start with ${starred.length === 1 ? 'this one' : `these ${Math.min(3, starred.length)}`}:` : 'Nothing urgent. Work the inbox oldest first.',
    ...starred.slice(0, 3).map(t => `• ${link(t)}`),
    starred.length > 3 ? `The rest are in <${base}/support|Support>, sorted Priority first.` : null,
  ].filter(Boolean).join('\n')
  // The team's summary goes with the two scheduled passes, not with retries.
  if (!retryOnly) await slackTo('support', summary)
  return out
}
