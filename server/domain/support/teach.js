/**
 * Teaching Claude from a bad draft. A person says what was wrong; the model
 * turns that into one to three short, general rules; the person edits and
 * approves them; they are added to the playbook under "Lessons from the
 * team", which every later draft reads. Nothing changes until approved.
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured } from '../../lib/llm.js'
import { getPlaybook, savePlaybook } from './playbook.js'
import { UserError } from './errors.js'

const HEADING = '## Lessons from the team'
const noDash = s => String(s || '').replace(/\s*[—–]\s*/g, ', ').trim()

/** What went wrong asking Claude, in words a person can act on. */
function claudeTrouble(err) {
  const status = Number(err?.status || err?.statusCode || 0)
  const msg = String(err?.message || '')
  if (status === 429) return 'Claude is rate limited for a minute. Try Write the rule again shortly.'
  if (status === 529 || /overloaded/i.test(msg)) return 'Claude is overloaded right now. Try again in a minute.'
  if (status === 401 || status === 403) return 'The Claude key was refused. Check ANTHROPIC_API_KEY in Settings > Connections.'
  if (status >= 500) return `Claude had an error on its side (${status}). Try again in a minute.`
  if (/JSON|empty response/i.test(msg)) return "Claude's answer came back unreadable twice. Try saying the correction a little shorter."
  if (/declined/i.test(msg)) return 'Claude declined to write a rule from that. Try wording the correction differently.'
  if (/connection|Connections/i.test(msg)) return msg
  return `Could not reach Claude to write the rule (${msg.slice(0, 120) || 'no detail'}).`
}

export async function proposeLessons({ noteId, feedback }) {
  if (!isLlmConfigured()) throw new UserError('No model is configured (ANTHROPIC_API_KEY).')
  const fb = String(feedback || '').trim().slice(0, 1500)
  if (!fb) throw new UserError('Say what was wrong with the draft.')
  const note = await prisma.supportNote.findUnique({ where: { id: String(noteId) }, select: { body: true, kind: true } })
  if (!note || note.kind !== 'draft') throw new UserError('That draft is gone.')
  const { text: playbook } = await getPlaybook()
  const ask = (maxTokens) => complete({
    system: `You maintain the support playbook Trackstar's drafting model reads. A teammate corrected a draft. Turn the correction into 1 to 3 short rules for the playbook: general (about how to handle this kind of message, not about this customer or order), concrete, one line each, in the playbook's plain voice. Do not repeat a rule the playbook already states clearly; if the playbook says the opposite, write the rule that replaces it. Never use an em dash. Reply as JSON: {"lessons": ["<rule>", ...]}`,
    prompt: `The playbook:\n${playbook.slice(0, 20000)}\n\nThe draft:\n${note.body.slice(0, 3000)}\n\nThe teammate's correction:\n${fb}`,
    json: true,
    maxTokens,
    effort: 'low',
    purpose: 'support.teach',
  })
  // Room to answer: the playbook is long, and 800 tokens cut the JSON off
  // mid-rule, which surfaced as "Could not update the playbook". One retry
  // with more room if the reply still comes back unreadable, then a reason a
  // person can act on instead of a shrug.
  let out
  try {
    out = await ask(3000).catch(err => (/JSON|empty response/i.test(err?.message || '') ? ask(6000) : Promise.reject(err)))
  } catch (err) {
    throw new UserError(claudeTrouble(err))
  }
  const lessons = (Array.isArray(out.json?.lessons) ? out.json.lessons : []).map(l => noDash(l).replace(/^[-*]\s*/, '')).filter(Boolean).slice(0, 3)
  if (!lessons.length) throw new UserError('Could not turn that into a rule. Try saying it another way.')
  return { lessons }
}

/** Add approved lessons to the playbook, under their own heading, dated and signed. */
export async function addLessons(lessons, user) {
  const list = (Array.isArray(lessons) ? lessons : []).map(l => noDash(l).slice(0, 400)).filter(Boolean).slice(0, 5)
  if (!list.length) throw new UserError('No lesson to save.')
  const { text } = await getPlaybook()
  const who = user?.firstName || 'team'
  const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  const lines = list.map(l => `- ${l} (${who}, ${day})`).join('\n')
  const next = text.includes(HEADING) ? text.replace(HEADING, `${HEADING}\n${lines}`) : `${text.trim()}\n\n${HEADING}\nThese come from corrections to real drafts and win over anything above that disagrees.\n${lines}\n`
  return savePlaybook(next, { source: 'lesson', summary: list.join(' | '), actor: user })
}

// ---------------------------------------------------------------------------
// Rules a rep writes directly (Support > Settings > Rules for Claude). They
// are the same lines as the lessons above: one "- rule (Name, date)" each
// under the Lessons heading, so every draft reads them and every change is a
// playbook version an admin can undo.
// ---------------------------------------------------------------------------

/** The section's lines: [start, end) of the rule lines in the playbook text. */
function lessonSpan(lines) {
  const at = lines.findIndex(l => l.trim() === HEADING)
  if (at < 0) return null
  let end = at + 1
  while (end < lines.length && !/^##\s/.test(lines[end])) end++
  return { at, end }
}

const RULE_LINE = /^-\s+(.*?)(?:\s+\(([^,()]+),\s*([A-Z][a-z]{2} \d{1,2}, \d{4})\))?\s*$/

/** Every rule under Lessons from the team, newest first as they are written. */
export async function listRules() {
  const { text } = await getPlaybook()
  const lines = text.split('\n')
  const span = lessonSpan(lines)
  if (!span) return []
  const out = []
  for (let i = span.at + 1; i < span.end; i++) {
    const m = lines[i].match(RULE_LINE)
    if (m && m[1].trim()) out.push({ line: lines[i], text: m[1].trim(), author: m[2]?.trim() || null, date: m[3] || null })
  }
  return out
}

/** One rule, written by a person, as is (no model in between). */
export async function addRule(text, user) {
  const rule = noDash(text).replace(/^[-*]\s*/, '').replace(/\s+/g, ' ').trim()
  if (rule.length < 8) throw new UserError('Write the rule as a full sentence, like "When a customer asks for a rush, offer expedited shipping first."')
  if (rule.length > 400) throw new UserError('Keep a rule under 400 characters. Split a long one into two.')
  return addLessons([rule], user)
}

/** Take a rule out. A rep removes their own; an admin removes any. */
export async function removeRule(line, user, { isAdmin = false } = {}) {
  const { text } = await getPlaybook()
  const lines = text.split('\n')
  const span = lessonSpan(lines)
  const i = span ? lines.findIndex((l, j) => j > span.at && j < span.end && l === String(line || '')) : -1
  if (i < 0) throw new UserError('That rule is already gone. Reload to see the current list.')
  const author = lines[i].match(RULE_LINE)?.[2]?.trim() || null
  if (!isAdmin && author !== (user?.firstName || 'team')) throw new UserError(`That rule is ${author ? `${author}'s` : 'from the playbook'}. Ask ${author || 'Matt'} or an admin to remove it.`)
  const removed = lines[i].match(RULE_LINE)?.[1]?.trim() || lines[i]
  lines.splice(i, 1)
  return savePlaybook(lines.join('\n'), { source: 'lesson', summary: `Removed: ${removed}`, actor: user })
}
