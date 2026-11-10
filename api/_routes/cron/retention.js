/**
 * GET /api/cron/retention - daily, from Vercel cron. Deletes old rows from the
 * log tables (server/lib/retention.js). Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { alertCronFailure } from '../../_lib/alerts.js'
import { pruneLogs } from '../../../server/lib/retention.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const removed = await pruneLogs()
    console.log(`[cron/retention] removed ${JSON.stringify(removed)}`)
    return res.status(200).json({ removed })
  } catch (error) {
    console.error('[cron/retention]', error)
    await alertCronFailure('retention', error)
    return res.status(500).json({ error: 'Retention failed' })
  }
}
