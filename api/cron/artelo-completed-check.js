/**
 * GET /api/cron/artelo-completed-check - daily, from Vercel cron. Slack hears
 * about orders complete in TrackstarOS that Artelo never sent to production
 * (server/domain/orders/arteloMismatch.js). Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { checkCompletedNotSent } from '../../server/domain/orders/arteloMismatch.js'
import { alertError } from '../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await checkCompletedNotSent()
    console.log(`[cron/artelo-completed-check] ${JSON.stringify(out)}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/artelo-completed-check]', error)
    await alertError('artelo-completed-check', error)
    return res.status(500).json({ error: 'Check failed' })
  }
}
