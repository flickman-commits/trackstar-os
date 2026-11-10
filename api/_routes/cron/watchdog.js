/**
 * GET /api/cron/watchdog - hourly, from Vercel cron. Posts to #admin-alerts
 * when another scheduled job is late, the order import has not finished in
 * 30 minutes, or a frequent job keeps starting without finishing
 * (server/lib/cronWatchdog.js). Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { runWatchdog } from '../../../server/lib/cronWatchdog.js'
import { alertCronFailure } from '../../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await runWatchdog()
    if (out.problems) console.log(`[cron/watchdog] ${JSON.stringify(out)}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/watchdog]', error)
    await alertCronFailure('watchdog', error)
    return res.status(500).json({ error: 'Watchdog failed' })
  }
}
