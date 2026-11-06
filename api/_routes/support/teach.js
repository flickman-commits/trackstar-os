/**
 * POST /api/support/teach
 *   { action: 'propose', noteId, feedback }  -> { lessons }   suggest playbook rules from a correction
 *   { action: 'save', lessons }              -> { playbook }  add them (admin; the playbook is admin's)
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { proposeLessons, addLessons } from '../../../server/domain/support/teach.js'
import { isUserError } from '../../../server/domain/support/errors.js'
import { systemProblem } from '../../../server/lib/systemProblem.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  try {
    if (b.action === 'propose') {
      const user = await requireCapability(req, res, 'support')
      if (!user) return
      return res.status(200).json(await proposeLessons({ noteId: b.noteId, feedback: b.feedback }))
    }
    if (b.action === 'save') {
      const user = await requireAdminOnly(req, res)
      if (!user) return
      const playbook = await addLessons(b.lessons, user)
      await recordAudit({ action: 'support.playbook', summary: `Taught Claude: ${(b.lessons || []).join(' / ').slice(0, 200)}`, detail: { lessons: b.lessons }, actor: user })
      return res.status(200).json({ playbook })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    const known = isUserError(error)
    if (!known) console.error('[API /support/teach]', error)
    // A database problem names itself (server/lib/systemProblem.js); anything else still says which step failed.
    const sys = known ? null : systemProblem(error)
    return res.status(known ? 400 : sys ? sys.status : 500).json({ error: known ? error.message : sys ? sys.message : `Could not ${b.action === 'save' ? 'save the rule to' : 'write a rule for'} the playbook. Try again, and tell Matt if it keeps happening.` })
  }
}
