/**
 * The weekly playbook review: learn from what the team actually sent.
 *
 * Every Monday (api/cron/support-playbook.js) this reads the past week's
 * email replies from fast@ next to the draft Claude wrote for each, the
 * customer's message before it and the team's notes, and has Claude revise
 * the playbook (playbook.js) where the reps keep changing the drafts the
 * same way: tone, length, a fact, a policy, a situation the playbook did
 * not cover. The new version goes live on its own (Matt's call, Oct 30
 * 2026), is kept as a version with its changelog, and the changelog goes
 * to Slack; Support > Settings > Drafting playbook > History restores any
 * earlier version.
 *
 * Guards: nothing changes without evidence in the week's replies; the new
 * text must keep the playbook's sections, stay in size, and carry no em
 * dash; a week with too few replies is skipped.
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured } from '../../lib/llm.js'
import { postSlack, slackText } from '../../lib/slack.js'
import { stripQuoted } from './mailbox.js'
import { getPlaybook, savePlaybook } from './playbook.js'

const MAILBOX = 'fast@trackstar.art'
const MIN_REPLIES = 15
const MAX_CASES = 120
const MODEL = 'claude-opus-5-5'
const MUST_KEEP = ['## Voice', '## Product facts', '## Escalate', '## Situations', '## Lessons from the team']

const clip = (s, n) => {
  const t = String(s || '').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const words = s => new Set(String(s || '').toLowerCase().replace(/hey \w+,|thanks,[\s\S]*$/g, '').match(/[a-z0-9']+/g) || [])
/** How much of the draft survived into what was sent, 0 to 1. */
function kept(draft, sent) {
  const a = words(draft), b = words(sent)
  if (!a.size || !b.size) return 0
  let both = 0
  for (const w of a) if (b.has(w)) both++
  return both / new Set([...a, ...b]).size
}

/** The week's replies with their context, most rewritten first, plus some sent nearly as drafted. */
export async function weekCases({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400000)
  const sent = await prisma.supportMessage.findMany({
    where: { direction: 'out', channel: 'email', fromEmail: MAILBOX, sentAt: { gte: since } },
    orderBy: { sentAt: 'asc' },
    select: { threadId: true, sentAt: true, bodyText: true, sentBy: { select: { firstName: true } } },
  })
  const cases = []
  for (const m of sent) {
    const before = await prisma.supportMessage.findMany({ where: { threadId: m.threadId, sentAt: { lt: m.sentAt } }, orderBy: { sentAt: 'desc' }, take: 2, select: { direction: true, bodyText: true } })
    // Outreach we started (a note from the owner, a proof) is not a reply to anything.
    if (!before.some(b => b.direction === 'in')) continue
    const [draft, notes] = await Promise.all([
      prisma.supportNote.findFirst({ where: { threadId: m.threadId, kind: 'draft', createdAt: { lt: m.sentAt } }, orderBy: { createdAt: 'desc' }, select: { body: true } }),
      prisma.supportNote.findMany({ where: { threadId: m.threadId, kind: { in: ['note', 'event'] }, createdAt: { lt: m.sentAt } }, orderBy: { createdAt: 'desc' }, take: 3, select: { kind: true, body: true } }),
    ])
    const sentText = stripQuoted(m.bodyText)
    cases.push({
      rep: m.sentBy?.firstName || 'Gmail',
      before: before.reverse().map(b => `${b.direction === 'in' ? 'CUSTOMER' : 'US'}: ${clip(stripQuoted(b.bodyText), 700)}`),
      notes: notes.map(n => `${n.kind === 'event' ? 'DONE' : 'NOTE'}: ${clip(n.body, 200)}`),
      draft: draft ? clip(draft.body, 1000) : null,
      sent: clip(sentText, 1000),
      kept: draft ? kept(draft.body, sentText) : null,
    })
  }
  const drafted = cases.filter(c => c.draft)
  const rewritten = drafted.filter(c => c.kept < 0.6).sort((a, b) => a.kept - b.kept)
  const asDrafted = drafted.filter(c => c.kept >= 0.6)
  const picked = [...rewritten.slice(0, MAX_CASES - 20), ...asDrafted.slice(0, 20)]
  return {
    total: cases.length,
    drafted: drafted.length,
    asDrafted: asDrafted.length,
    rewritten: rewritten.length,
    cases: picked,
  }
}

const SYSTEM = `You maintain the playbook that Trackstar's support drafting model reads before it drafts every customer email. Trackstar sells personalized race prints. A rep (Matt, the founder, or Elí) reviews each draft, edits it and sends it, so the gap between Claude's draft and what was sent is the evidence of what the playbook gets wrong.

Revise the playbook so next week's drafts need fewer edits:
- Change only what the evidence supports: a pattern in at least two of the week's replies, or one clear statement of policy by Matt. Ignore one-offs.
- Fix voice and length where reps keep cutting or rewriting the same way, facts or policy where drafts were wrong, and add situations the reps keep handling that the playbook does not cover. Correct a rule that the reps consistently do the opposite of.
- Edit in place, in the playbook's plain voice: keep its headings and order, keep it as short as it can be, merge overlapping rules, never duplicate one. Write general rules, never about one customer: no customer names, emails, addresses or order numbers.
- Keep the "## Lessons from the team" section and its entries unless an entry is folded into the body or contradicted by the evidence.
- Do not loosen escalation for legal threats, press, race organizers, or the trademark rule, on one week's evidence.
- Never use an em dash or an en dash.
- If nothing is worth changing, return no changes and the playbook exactly as given.

Reply as JSON: {"changes": [{"what": "<the change, one line>", "why": "<the evidence, with how many replies showed it>"}], "playbook": "<the full revised playbook>"}`

/**
 * Run the review. `dryRun` returns the proposal without saving it.
 * Returns { status: 'saved' | 'unchanged' | 'skipped' | 'proposal', ... }.
 */
export async function reviewPlaybook({ days = 7, dryRun = false } = {}) {
  if (!isLlmConfigured()) return { status: 'skipped', reason: 'No model is configured (ANTHROPIC_API_KEY).' }
  const week = await weekCases({ days })
  if (week.drafted < MIN_REPLIES) return { status: 'skipped', reason: `Only ${week.drafted} drafted replies this week; waiting for more.`, ...stats(week) }
  const { text: playbook } = await getPlaybook()

  const evidence = week.cases.map((c, i) => [
    `### Reply ${i + 1} (${c.rep}${c.kept != null ? `, ${Math.round(c.kept * 100)}% of the draft kept` : ''})`,
    ...c.before,
    ...(c.notes.length ? ['Team notes:', ...c.notes] : []),
    `CLAUDE'S DRAFT: ${c.draft || '(none)'}`,
    `SENT: ${c.sent}`,
  ].join('\n')).join('\n\n')

  const out = await complete({
    system: SYSTEM,
    prompt: `The current playbook:\n<playbook>\n${playbook}\n</playbook>\n\nThis week: ${week.total} replies, ${week.drafted} with a draft, ${week.asDrafted} sent close to the draft, ${week.rewritten} rewritten. The most rewritten first, then some sent close to the draft:\n\n${evidence}`,
    json: true,
    maxTokens: 16000,
    effort: 'medium',
    model: MODEL,
    purpose: 'support.playbook_review',
  })
  const changes = (Array.isArray(out.json?.changes) ? out.json.changes : [])
    .map(c => ({ what: noDash(c?.what).slice(0, 300), why: noDash(c?.why).slice(0, 300) }))
    .filter(c => c.what)
    .slice(0, 25)
  const next = noDash(String(out.json?.playbook || '')).replace(/\r\n/g, '\n').trim()
  if (!changes.length || !next || next === playbook.trim()) return { status: 'unchanged', ...stats(week) }

  // A rewrite that lost a section, shrank by half or ran long is a bad answer, not a new policy.
  const missing = MUST_KEEP.filter(h => playbook.includes(h) && !next.includes(h))
  if (missing.length) throw new Error(`Review dropped sections: ${missing.join(', ')}`)
  if (next.length < playbook.length * 0.6) throw new Error(`Review shrank the playbook from ${playbook.length} to ${next.length} characters`)
  if (next.length > 40000) throw new Error(`Review grew the playbook to ${next.length} characters`)

  const summary = changes.map(c => `- ${c.what} (${c.why})`).join('\n')
  if (dryRun) return { status: 'proposal', changes, playbook: next, ...stats(week) }
  await savePlaybook(next, { source: 'weekly', summary: `${stats(week).line}\n${summary}` })
  return { status: 'saved', changes, ...stats(week) }
}

const noDash = s => String(s || '').replace(/\s*[—–]\s*/g, ', ')
function stats(w) {
  return { total: w.total, drafted: w.drafted, asDrafted: w.asDrafted, rewritten: w.rewritten, line: `${w.drafted} drafted replies: ${w.asDrafted} sent close to the draft, ${w.rewritten} rewritten.` }
}

/** The cron: run the review and tell Matt what changed. */
export async function weeklyPlaybookReview() {
  const out = await reviewPlaybook()
  const hook = process.env.SLACK_DM_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  if (out.status === 'saved') {
    const lines = out.changes.map(c => `• ${slackText(c.what, 300)} _(${slackText(c.why, 200)})_`).join('\n')
    await postSlack(hook, `:memo: *Support playbook, weekly review.* ${slackText(out.line)} Claude's drafts now follow these changes:\n${lines}\n\nUndo: Support > Settings > Drafting playbook > History > Restore.`)
  } else if (out.status === 'unchanged') {
    await postSlack(hook, `:memo: *Support playbook, weekly review.* ${slackText(out.line)} Nothing worth changing this week.`)
  }
  return out
}
