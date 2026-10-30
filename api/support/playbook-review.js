/**
 * POST /api/support/playbook-review - the weekly playbook review, run by hand
 * from Support > Settings > Drafting playbook (admin).
 *
 *   { action: 'preview' }                       what this week's review would change; nothing is saved
 *   { action: 'apply', playbook, changes, line } save that proposal as a new version
 *
 * The Monday cron (api/cron/support-playbook.js) runs the same review and
 * saves it on its own. See server/domain/support/playbookReview.js.
 */
import { setCors } from '../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../_lib/users.js'
import { reviewPlaybook } from '../../server/domain/support/playbookReview.js'
import { savePlaybook, playbookVersions } from '../../server/domain/support/playbook.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireAdminOnly(req, res)
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (body.action === 'preview') {
      const out = await reviewPlaybook({ dryRun: true })
      return res.status(200).json({ status: out.status, reason: out.reason || null, line: out.line || null, changes: out.changes || [], playbook: out.playbook || null })
    }
    if (body.action === 'apply') {
      const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 25)
      const summary = [String(body.line || '').slice(0, 300), ...changes.map(c => `- ${String(c?.what || '').slice(0, 300)} (${String(c?.why || '').slice(0, 300)})`)].filter(Boolean).join('\n')
      const pb = await savePlaybook(body.playbook, { source: 'weekly', summary, actor: user })
      await recordAudit({ action: 'support.playbook', summary: `Applied the playbook review (${changes.length} change${changes.length === 1 ? '' : 's'})`, detail: { changes: changes.length }, actor: user })
      return res.status(200).json({ playbook: pb, playbookVersions: await playbookVersions() })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /support/playbook-review]', error)
    return sendPublicError(res, error)
  }
}
