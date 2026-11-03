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
 * leaves its reason on the thread and an event in the timeline, and the
 * run's list goes to Slack. api/cron/support-triage.js runs it.
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured } from '../../lib/llm.js'
import { postSlack, slackText } from '../../lib/slack.js'
import { appBaseUrl } from '../../lib/links.js'
import { customerContext, linkedOrderNumbers, orderNumberWhere } from './threads.js'
import { ordersBrief, quotedOrderNumbers } from './draft.js'
import { stripQuoted } from './mailbox.js'

const MODEL = 'claude-sonnet-5-5'
const MAX_THREADS = 200
const CONCURRENCY = 5
// Stop starting new threads before the function's 300s runs out; the rest wait for the next pass.
const BUDGET_MS = 230_000

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
  return { urgent, category: urgent ? (category || 'upset') : null, reason: clip(String(j.reason || '').replace(/\s*[—–]\s*/g, ', '), 200) }
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
  let failed = 0, next = 0
  async function worker() {
    while (next < due.length && Date.now() - started < BUDGET_MS) {
      const t = due[next++]
      try {
        const d = await triageThread(t)
        results.push({ t, ...d })
        if (dryRun) continue
        if (d.urgent && !t.priority) {
          await prisma.supportThread.update({ where: { id: t.id }, data: { priority: true, priorityReason: d.reason, triagedAt: new Date() } })
          await prisma.supportNote.create({ data: { threadId: t.id, kind: 'event', body: `Claude marked this priority: ${d.reason || URGENT[d.category]}`, authorName: 'Claude' } })
        } else {
          await prisma.supportThread.update({ where: { id: t.id }, data: { triagedAt: new Date() } })
        }
      } catch (err) {
        failed++
        console.warn(`[support.triage] ${t.id}: ${err.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const urgent = results.filter(r => r.urgent)
  return {
    status: dryRun ? 'dry-run' : 'done',
    read: results.length,
    failed,
    left: due.length - next,
    starred: urgent.filter(r => !r.t.priority).length,
    urgent: urgent.map(r => ({ id: r.t.id, who: r.t.customerName || r.t.customerEmail || (r.t.igUsername ? `@${r.t.igUsername}` : 'Unknown'), subject: r.t.subject, category: r.category, reason: r.reason, alreadyStarred: r.t.priority })),
  }
}

const whoOf = t => slackText(t.customerName || t.customerEmail || (t.igUsername ? `@${t.igUsername}` : 'Unknown'), 60)

/**
 * The cron: triage, then say so in #trackstar-reports (SLACK_REPORTS_WEBHOOK_URL,
 * Matt's DM until that is set): that it ran, how many it read and how many it
 * marked urgent, by kind. With SLACK_SUPPORT_WEBHOOK_URL set, the support
 * channel also gets every starred open conversation, where to start.
 */
export async function scheduledTriage() {
  const out = await triagePending()
  if (out.status !== 'done') return out
  const starred = await prisma.supportThread.findMany({
    where: { status: 'open', priority: true, filtered: false, mergedIntoId: null },
    orderBy: { lastInboundAt: 'asc' },
    select: { id: true, customerName: true, customerEmail: true, igUsername: true, subject: true, priorityReason: true },
  })
  const base = appBaseUrl()
  const link = t => `<${base}/support?thread=${encodeURIComponent(t.id)}|${whoOf(t)}>`
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const fresh = out.urgent.filter(u => !u.alreadyStarred)
  const kinds = Object.entries(URGENT).map(([k, label]) => [label, fresh.filter(u => u.category === k).length]).filter(([, n]) => n)
  const report = [
    `_Support Triage_ · ${when} ET`,
    `Read ${out.read} new conversation${out.read === 1 ? '' : 's'}, marked *${out.starred} urgent*. ${starred.length} starred conversation${starred.length === 1 ? ' is' : 's are'} open in <${base}/support|Support>.${out.left ? ` ${out.left} more wait for the next pass.` : ''}${out.failed ? ` ${out.failed} could not be read.` : ''}`,
    kinds.length ? kinds.map(([label, n]) => `${label}: ${n}`).join(' · ') : null,
    ...fresh.slice(0, 15).map(u => `• ${link({ id: u.id, customerName: u.who })}: ${slackText(u.reason || URGENT[u.category], 200)}`),
    fresh.length > 15 ? `…and ${fresh.length - 15} more.` : null,
  ].filter(Boolean).join('\n')
  await postSlack(process.env.SLACK_REPORTS_WEBHOOK_URL || process.env.SLACK_DM_WEBHOOK_URL, report)

  if (process.env.SLACK_SUPPORT_WEBHOOK_URL && starred.length) {
    const lines = starred.slice(0, 40).map(t => `• ${link(t)}: ${slackText(t.priorityReason || t.subject || 'Marked priority', 200)}`)
    await postSlack(process.env.SLACK_SUPPORT_WEBHOOK_URL, `:rotating_light: *Start with these ${starred.length}* (Support, sort Priority first):\n${lines.join('\n')}${starred.length > 40 ? `\n…and ${starred.length - 40} more.` : ''}`)
  }
  return out
}
