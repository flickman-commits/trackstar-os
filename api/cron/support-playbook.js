/**
 * GET /api/cron/support-playbook - Mondays: revise the support drafting
 * playbook from the past week's replies next to Claude's drafts, save it as
 * a new version and post the changelog to Slack
 * (server/domain/support/playbookReview.js). Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { weeklyPlaybookReview } from '../../server/domain/support/playbookReview.js'
import { alertError } from '../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await weeklyPlaybookReview()
    console.log(`[cron/support-playbook] ${out.status} ${out.line || out.reason || ''}`)
    return res.status(200).json({ status: out.status, changes: out.changes?.length || 0, line: out.line || out.reason || null })
  } catch (error) {
    console.error('[cron/support-playbook]', error)
    await alertError('support-playbook', error)
    return res.status(500).json({ error: 'Playbook review failed' })
  }
}
