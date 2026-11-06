/**
 * POST /api/support/teach - rules that teach Claude how to draft. Anyone on
 * Support can add them; they land in the playbook under "Lessons from the
 * team", every draft reads them, and each change is a playbook version an
 * admin can undo from Settings.
 *
 *   { action: 'propose', noteId, feedback }  -> { lessons }   suggest rules from a correction to a draft
 *   { action: 'save', lessons }              -> { playbook }  add them
 *   { action: 'list' }                       -> { rules }     every rule, with who wrote it and when
 *   { action: 'add', text }                  -> { rules }     one rule, written by hand
 *   { action: 'remove', line }               -> { rules }     your own rule (an admin: any)
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { proposeLessons, addLessons, listRules, addRule, removeRule } from '../../../server/domain/support/teach.js'
import { isUserError } from '../../../server/domain/support/errors.js'
import { systemProblem } from '../../../server/lib/systemProblem.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    if (b.action === 'propose') {
      return res.status(200).json(await proposeLessons({ noteId: b.noteId, feedback: b.feedback }))
    }
    if (b.action === 'save') {
      const playbook = await addLessons(b.lessons, user)
      await recordAudit({ action: 'support.playbook', summary: `Taught Claude: ${(b.lessons || []).join(' / ').slice(0, 200)}`, detail: { lessons: b.lessons }, actor: user })
      return res.status(200).json({ playbook })
    }
    if (b.action === 'list') return res.status(200).json({ rules: await listRules() })
    if (b.action === 'add') {
      await addRule(b.text, user)
      await recordAudit({ action: 'support.playbook', summary: `Added a rule for Claude: ${String(b.text || '').slice(0, 200)}`, detail: { text: b.text }, actor: user })
      return res.status(200).json({ rules: await listRules() })
    }
    if (b.action === 'remove') {
      await removeRule(b.line, user, { isAdmin: user.role === 'admin' })
      await recordAudit({ action: 'support.playbook', summary: `Removed a rule for Claude: ${String(b.line || '').slice(0, 200)}`, detail: { line: b.line }, actor: user })
      return res.status(200).json({ rules: await listRules() })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    const known = isUserError(error)
    if (!known) console.error('[API /support/teach]', error)
    // A database problem names itself (server/lib/systemProblem.js); anything else still says which step failed.
    const sys = known ? null : systemProblem(error)
    return res.status(known ? 400 : sys ? sys.status : 500).json({ error: known ? error.message : sys ? sys.message : 'Could not update the rules. Try again, and tell Matt if it keeps happening.' })
  }
}
