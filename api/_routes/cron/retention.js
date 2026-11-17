/**
 * GET /api/cron/retention - daily, from Vercel cron. Deletes old rows from the
 * log tables and trims Postgres's query statistics (server/lib/retention.js). Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { alertCronFailure } from '../../_lib/alerts.js'
import { pruneLogs, trimQueryStats } from '../../../server/lib/retention.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const removed = await pruneLogs()
    // Its own try: a failure here must not stop the log pruning above from being reported.
    let queryStats = null
    try { queryStats = await trimQueryStats() } catch (e) { queryStats = { error: 'could not trim' }; console.error('[cron/retention] query stats', e) }
    console.log(`[cron/retention] removed ${JSON.stringify(removed)}; query stats ${JSON.stringify(queryStats)}`)
    return res.status(200).json({ removed, queryStats })
  } catch (error) {
    console.error('[cron/retention]', error)
    await alertCronFailure('retention', error)
    return res.status(500).json({ error: 'Retention failed' })
  }
}
