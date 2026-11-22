/**
 * GET /api/cron/support-playbook - Mondays: revise the support drafting
 * playbook from the past week's replies next to Claude's drafts, save it as
 * a new version and post the changelog to Slack
 * (server/domain/support/playbookReview.js), and post the help center's
 * weekly look: articles that may be out of date, corrections waiting,
 * questions the playbook did not cover (helpCenter.js). Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { weeklyPlaybookReview } from '../../../server/domain/support/playbookReview.js'
import { helpDigest } from '../../../server/domain/support/helpCenter.js'
import { slackTo, slackText } from '../../../server/lib/slack.js'
import { alertError } from '../../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await weeklyPlaybookReview()
    console.log(`[cron/support-playbook] ${out.status} ${out.line || out.reason || ''}`)
    // The help center's weekly look (helpCenter.js): what may be out of date, corrections waiting, questions it could not answer.
    try {
      const d = await helpDigest()
      if (d.stale.length || d.pending || d.notCovered.length) {
        const lines = [`:books: *Support help center, weekly look.* ${d.asked} question${d.asked === 1 ? '' : 's'} asked this week.`]
        if (d.stale.length) lines.push(`*May be out of date* (open it in Support > Help, then Edit or Still right):\n${d.stale.slice(0, 12).map(a => `• ${a.pinned ? ':pushpin: ' : ''}${slackText(a.title, 120)}: ${slackText(a.reasons.join('; '), 200)}`).join('\n')}`)
        if (d.pending) lines.push(`*${d.pending} correction${d.pending === 1 ? '' : 's'} waiting* for you in Support > Help > Questions.`)
        if (d.notCovered.length) lines.push(`*Asked but not covered by the playbook:*\n${d.notCovered.map(q => `• ${slackText(q, 160)}`).join('\n')}`)
        await slackTo('reports', lines.join('\n\n'), { or: 'alerts' })
      }
    } catch (err) {
      console.warn(`[cron/support-playbook] help digest: ${err.message}`)
    }
    return res.status(200).json({ status: out.status, changes: out.changes?.length || 0, line: out.line || out.reason || null })
  } catch (error) {
    console.error('[cron/support-playbook]', error)
    await alertError('support-playbook', error)
    return res.status(500).json({ error: 'Playbook review failed' })
  }
}
