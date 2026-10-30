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

export async function proposeLessons({ noteId, feedback }) {
  if (!isLlmConfigured()) throw new UserError('No model is configured (ANTHROPIC_API_KEY).')
  const fb = String(feedback || '').trim().slice(0, 1500)
  if (!fb) throw new UserError('Say what was wrong with the draft.')
  const note = await prisma.supportNote.findUnique({ where: { id: String(noteId) }, select: { body: true, kind: true } })
  if (!note || note.kind !== 'draft') throw new UserError('That draft is gone.')
  const { text: playbook } = await getPlaybook()
  const out = await complete({
    system: `You maintain the support playbook Trackstar's drafting model reads. A teammate corrected a draft. Turn the correction into 1 to 3 short rules for the playbook: general (about how to handle this kind of message, not about this customer or order), concrete, one line each, in the playbook's plain voice. Do not repeat a rule the playbook already states clearly; if the playbook says the opposite, write the rule that replaces it. Never use an em dash. Reply as JSON: {"lessons": ["<rule>", ...]}`,
    prompt: `The playbook:\n${playbook.slice(0, 20000)}\n\nThe draft:\n${note.body.slice(0, 3000)}\n\nThe teammate's correction:\n${fb}`,
    json: true,
    maxTokens: 800,
    effort: 'low',
    purpose: 'support.teach',
  })
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
