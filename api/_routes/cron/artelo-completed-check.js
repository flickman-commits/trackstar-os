/**
 * GET /api/cron/artelo-completed-check - daily, from Vercel cron. Slack hears
 * about orders complete in TrackstarOS that Artelo never sent to production
 * (server/domain/orders/arteloMismatch.js), and about paid shop orders that
 * never reached TrackstarOS at all (server/domain/orders/missingOrders.js).
 * Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { checkCompletedNotSent } from '../../../server/domain/orders/arteloMismatch.js'
import { checkMissingOrders } from '../../../server/domain/orders/missingOrders.js'
import { alertError } from '../../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  // Two checks; one failing does not stop the other.
  let missing = null
  try {
    missing = await checkMissingOrders()
    console.log(`[cron/artelo-completed-check] missing orders: ${JSON.stringify(missing)}`)
  } catch (error) {
    console.error('[cron/artelo-completed-check] missing orders', error)
    await alertError('missing-orders check', error)
  }
  try {
    const out = await checkCompletedNotSent()
    console.log(`[cron/artelo-completed-check] ${JSON.stringify(out)}`)
    return res.status(200).json({ ...out, missing })
  } catch (error) {
    console.error('[cron/artelo-completed-check]', error)
    await alertError('artelo-completed-check', error)
    return res.status(500).json({ error: 'Check failed' })
  }
}
