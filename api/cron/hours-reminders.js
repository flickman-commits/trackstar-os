/**
 * GET /api/cron/hours-reminders - Monday morning: whoever has not submitted
 * last week's hours gets a Slack DM (server/domain/finance/timesheets.js).
 * Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { remindUnsubmitted } from '../../server/domain/finance/timesheets.js'
import { alertError } from '../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await remindUnsubmitted()
    console.log(`[cron/hours-reminders] ${JSON.stringify(out)}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/hours-reminders]', error)
    await alertError('hours-reminders', error)
    return res.status(500).json({ error: 'Reminders failed' })
  }
}
