/**
 * GET /api/cron/bulk-runs - every morning (9am Eastern in summer, 8am in
 * winter): research the runners of bulk runs whose race is over, then post
 * every bulk run within a week of its race, with what is in its way, to
 * Slack (server/domain/bulk/attention.js). Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { bulkMorning } from '../../server/domain/bulk/attention.js'
import { alertError } from '../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await bulkMorning()
    console.log(`[cron/bulk-runs] ${JSON.stringify(out)}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/bulk-runs]', error)
    await alertError('bulk-runs', error)
    return res.status(500).json({ error: 'Bulk check failed' })
  }
}
