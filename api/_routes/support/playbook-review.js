/**
 * POST /api/support/playbook-review - the weekly playbook review in
 * Support > Settings > Drafting playbook (admin).
 *
 *   { action: 'held' }                       the changes waiting for a person, if any
 *   { action: 'preview' }                    the waiting changes, or run this week's review by hand and hold every change
 *   { action: 'decide', id, decision }       approve (apply to the live playbook) or deny one change
 *
 * The Monday cron (api/_routes/cron/support-playbook.js) runs the same review:
 * changes with no warning go live, the rest wait here. See
 * server/domain/support/playbookReview.js.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { reviewPlaybook, heldProposal, holdForReview, decideChange } from '../../../server/domain/support/playbookReview.js'
import { playbookVersions } from '../../../server/domain/support/playbook.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

const shape = (p, extra = {}) => ({ status: 'proposal', reason: null, at: p.at, line: p.line || null, changes: p.changes, ...extra })

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireAdminOnly(req, res)
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (body.action === 'held') {
      const held = await heldProposal()
      return res.status(200).json({ review: held ? shape(held) : null })
    }
    if (body.action === 'preview') {
      const held = await heldProposal()
      if (held?.changes.some(c => c.status === 'pending')) return res.status(200).json(shape(held))
      const out = await reviewPlaybook({ dryRun: true })
      if (out.status !== 'proposal') return res.status(200).json({ status: out.status, reason: out.reason || null, line: out.line || null, changes: [] })
      return res.status(200).json(shape(await holdForReview(out)))
    }
    if (body.action === 'decide') {
      const decision = body.decision === 'approve' ? 'approve' : body.decision === 'deny' ? 'deny' : null
      const out = await decideChange(String(body.id || ''), decision, { actor: user })
      await recordAudit({ action: 'support.playbook', summary: `${decision === 'approve' ? 'Approved' : 'Denied'} a playbook review change: ${out.change.what.slice(0, 200)}`, detail: { id: out.change.id, decision }, actor: user })
      return res.status(200).json({ review: shape(out.proposal), playbook: out.playbook, playbookVersions: out.playbook ? await playbookVersions() : undefined })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /support/playbook-review]', error)
    return sendPublicError(res, error)
  }
}
