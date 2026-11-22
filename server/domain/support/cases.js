/**
 * Cases: what each closed conversation was about and what we did (Matt,
 * 2026-11-21: "log all cases"). Claude tags a conversation once it closes,
 * with a type, an outcome, a one-line summary without names or order
 * numbers, and what it cost when the team's notes say; a person corrects
 * it with one click and their tag stands. A conversation that reopens is
 * tagged again on its next close.
 *
 * The tags make past cases findable: the Ask box (helpCenter.js) and
 * Claude's drafts (draft.js) are given the closed cases most like the one in
 * hand (similarCases), so they answer the way the team actually did.
 *
 * Runs in the support sync (api/_routes/support/sync.js), a few each time,
 * newest first, so the history fills in over a day or two.
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured, llmInfo } from '../../lib/llm.js'
import { stripQuoted } from './mailbox.js'
import { customerBlock, customerField, UNTRUSTED_RULE } from './untrusted.js'
import { UserError } from './errors.js'

export const CASE_TYPES = [
  ['where_is_order', "Where's my order"],
  ['not_received', 'Delivered but not received, or lost'],
  ['damaged', 'Arrived damaged'],
  ['wrong_info', 'Wrong or missing info on the print'],
  ['change_request', 'Change to an order (name, size, frame, photo, address)'],
  ['cancel_refund', 'Cancel or refund request'],
  ['custom_order', 'Custom order'],
  ['design_feedback', 'Mockup or design feedback'],
  ['product_question', 'Product question (sizes, frames, races, timing)'],
  ['discount_checkout', 'Discount or checkout'],
  ['artelo_ops', 'Artelo or printer thread'],
  ['partner', 'Race, charity, press or partner'],
  ['other', 'Other'],
]
export const CASE_OUTCOMES = [
  ['answered', 'Answered, nothing else needed'],
  ['replacement', 'Free replacement'],
  ['reprint', 'Corrected print'],
  ['refund', 'Full refund'],
  ['partial_refund', 'Partial refund'],
  ['discount', 'Discount code'],
  ['order_changed', 'Order changed'],
  ['cancelled', 'Cancelled'],
  ['escalated', 'Sent to Matt'],
  ['no_action', 'No reply needed'],
]
const TYPE_IDS = new Set(CASE_TYPES.map(t => t[0]))
const OUTCOME_IDS = new Set(CASE_OUTCOMES.map(t => t[0]))
const label = (list, id) => list.find(t => t[0] === id)?.[1] || id

const TAG_MODEL = 'claude-haiku-5-5'
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
const noDash = s => String(s || '').replace(/\s*[—–]\s*/g, ', ')

const SYSTEM = `You file closed customer support conversations for Trackstar, which sells personalized race prints (a runner's race, time and course map, printed and framed by our print partner Artelo).

For the conversation given, reply as JSON:
{"type": one of ${CASE_TYPES.map(t => `"${t[0]}"`).join(', ')},
 "outcome": one of ${CASE_OUTCOMES.map(t => `"${t[0]}"`).join(', ')},
 "summary": "<one line, under 200 characters: the problem and what we did, general enough to learn from; never a name, email, address or order number>",
 "costCents": <what it cost us in US cents, only when a team note or event states a dollar amount for a refund, replacement, reprint or discount; otherwise null>}

The outcome is what the team did, from their replies and the notes and events (a replacement order created, a refund, a code sent). "answered" when the reply alone settled it. "no_action" when nothing needed a reply (a thank-you, spam, a notification).

${UNTRUSTED_RULE}`

/** The conversation as Claude reads it: messages (not our auto-reply) and the team's notes and events, oldest first. */
async function caseText(threadId) {
  const [messages, notes] = await Promise.all([
    prisma.supportMessage.findMany({ where: { threadId, NOT: { direction: 'out', auto: true } }, orderBy: { sentAt: 'desc' }, take: 10, select: { direction: true, bodyText: true, sentAt: true } }),
    prisma.supportNote.findMany({ where: { threadId, kind: { in: ['note', 'event'] } }, orderBy: { createdAt: 'desc' }, take: 12, select: { kind: true, body: true, createdAt: true } }),
  ])
  const rows = [
    ...messages.map(m => ({ at: m.sentAt, text: m.direction === 'in' ? `CUSTOMER:\n${customerBlock(clip(stripQuoted(m.bodyText), 1200))}` : `TRACKSTAR:\n${clip(stripQuoted(m.bodyText), 1200)}` })),
    ...notes.map(n => ({ at: n.createdAt, text: `${n.kind === 'event' ? 'EVENT' : 'TEAM NOTE'}: ${clip(n.body, 300)}` })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))
  return rows.map(r => r.text).join('\n\n')
}

/** Claude's tag, checked: a known type and outcome, a short summary, a whole number of cents or null. Pure. */
export function cleanTag(json) {
  const type = TYPE_IDS.has(json?.type) ? json.type : 'other'
  const outcome = OUTCOME_IDS.has(json?.outcome) ? json.outcome : 'answered'
  const summary = noDash(clip(json?.summary, 240)).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\border\s+#?\d{3,6}\b/gi, 'the order').replace(/#\d{3,6}\b/g, 'the order')
  const c = Number(json?.costCents)
  const costCents = Number.isFinite(c) && c > 0 && c < 100000 ? Math.round(c) : null
  return { type, outcome, summary, costCents }
}

/** Tag one closed conversation. */
export async function tagCase(thread) {
  const text = await caseText(thread.id)
  if (!text.trim()) return null
  const out = await complete({
    system: SYSTEM,
    prompt: `Subject: ${customerField(thread.subject, 160)}\nChannel: ${thread.channel}\n\n${text}`,
    json: true,
    maxTokens: 400,
    effort: 'low',
    temperature: 0,
    model: llmInfo().provider === 'anthropic' ? TAG_MODEL : undefined,
    purpose: 'support.case_tag',
  })
  const tag = cleanTag(out.json)
  await prisma.supportThread.update({
    where: { id: thread.id },
    data: { caseType: tag.type, caseOutcome: tag.outcome, caseSummary: tag.summary, caseCostCents: tag.costCents, caseTaggedAt: new Date(), caseTaggedBy: 'claude' },
  })
  return tag
}

/**
 * Tag the closed conversations that need it, newest first: never tagged, or
 * written in again since. A person's tag stands until the conversation gets
 * a new message. Never throws for one conversation.
 */
export async function tagPendingCases({ limit = 10, budgetMs = 45_000 } = {}) {
  if (!isLlmConfigured()) return { tagged: 0, failed: 0, skipped: 'no model' }
  const started = Date.now()
  const rows = await prisma.$queryRaw`
    SELECT id, subject, channel FROM "SupportThread"
    WHERE status = 'closed' AND filtered = false AND "mergedIntoId" IS NULL AND "messageCount" > 0
      AND ("caseTaggedAt" IS NULL OR "caseTaggedAt" < "lastMessageAt")
    ORDER BY "lastMessageAt" DESC LIMIT ${limit}`
  let tagged = 0, failed = 0
  for (const t of rows) {
    if (Date.now() - started > budgetMs) break
    try { if (await tagCase(t)) tagged++ } catch (err) { failed++; console.warn(`[support.cases] ${t.id}: ${err.message}`) }
  }
  return { tagged, failed, left: rows.length - tagged - failed }
}

/** A person's correction: their tag stands until the conversation gets a new message. */
export async function setCase(threadId, { type, outcome, summary, costCents }, { actor } = {}) {
  if (type && !TYPE_IDS.has(type)) throw new UserError('Pick one of the listed types')
  if (outcome && !OUTCOME_IDS.has(outcome)) throw new UserError('Pick one of the listed outcomes')
  const data = { caseTaggedAt: new Date(), caseTaggedBy: actor?.firstName || 'person' }
  if (type) data.caseType = type
  if (outcome) data.caseOutcome = outcome
  if (summary !== undefined) data.caseSummary = noDash(clip(summary, 240)) || null
  if (costCents !== undefined) data.caseCostCents = Number.isInteger(costCents) && costCents >= 0 ? costCents : null
  return prisma.supportThread.update({ where: { id: String(threadId) }, data, select: CASE_SELECT })
}

export const CASE_SELECT = { id: true, caseType: true, caseOutcome: true, caseSummary: true, caseCostCents: true, caseTaggedAt: true, caseTaggedBy: true }

const STOP = new Set('the and for that this with have from your you our are was were what when will would could should there their about just they them been into than then also only some more very much here can not but how its it\'s i\'m we\'re don\'t dont did does get got had has her his she him who why any all one two out off over please thanks thank hey hello hi order orders print prints trackstar'.split(' '))

/** The words worth searching on, for Postgres full text: up to 14, OR'd. Pure. */
export function searchTerms(text) {
  const words = String(text || '').toLowerCase().replace(/https?:\S+/g, ' ').match(/[a-z]{4,}/g) || []
  const seen = []
  for (const w of words) if (!STOP.has(w) && !seen.includes(w)) seen.push(w)
  return seen.slice(0, 14)
}

/**
 * The closed, tagged cases most like `text` (a question or the customer's
 * message), best first: full-text over the summary, subject and type. Each
 * with what we last sent. `type` narrows to one case type when known.
 */
export async function similarCases(text, { limit = 3, excludeThreadId = null, type = null } = {}) {
  const terms = searchTerms(text)
  if (!terms.length) return []
  const query = terms.join(' | ')
  const rows = await prisma.$queryRaw`
    SELECT id, subject, "caseType", "caseOutcome", "caseSummary", "caseCostCents", "lastMessageAt",
      ts_rank(to_tsvector('english', coalesce("caseSummary", '') || ' ' || subject), to_tsquery('english', ${query})) AS rank
    FROM "SupportThread"
    WHERE "caseSummary" IS NOT NULL AND status = 'closed' AND "mergedIntoId" IS NULL
      AND id <> ${excludeThreadId || ''}
      AND (${type}::text IS NULL OR "caseType" = ${type})
      AND to_tsvector('english', coalesce("caseSummary", '') || ' ' || subject) @@ to_tsquery('english', ${query})
    ORDER BY rank DESC, "lastMessageAt" DESC
    LIMIT ${limit}`
  if (!rows.length) return []
  const sent = await prisma.supportMessage.findMany({
    where: { threadId: { in: rows.map(r => r.id) }, direction: 'out', auto: false },
    orderBy: { sentAt: 'desc' },
    select: { threadId: true, bodyText: true },
  })
  return rows.map(r => ({
    id: r.id,
    subject: r.subject,
    type: r.caseType, typeLabel: label(CASE_TYPES, r.caseType),
    outcome: r.caseOutcome, outcomeLabel: label(CASE_OUTCOMES, r.caseOutcome),
    summary: r.caseSummary,
    costCents: r.caseCostCents,
    at: r.lastMessageAt,
    reply: clip(stripQuoted(sent.find(s => s.threadId === r.id)?.bodyText || ''), 600),
  }))
}

/** Past cases as a block for a prompt: what each was and what we sent. Pure. */
export function casesBlock(cases) {
  return cases.map((c, i) => `PAST CASE ${i + 1} (${c.typeLabel}; we did: ${c.outcomeLabel}${c.costCents ? `; cost $${(c.costCents / 100).toFixed(2)}` : ''}):\n${c.summary}${c.reply ? `\nWhat we sent: ${c.reply}` : ''}`).join('\n\n')
}
