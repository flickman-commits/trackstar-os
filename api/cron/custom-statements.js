/**
 * GET /api/cron/custom-statements - hourly on the 28th to the 31st; at 10am
 * Eastern on the last day of the month each designer gets their custom statement in a
 * Slack DM (server/domain/orders/customStatements.js). Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { sendCustomStatements } from '../../server/domain/orders/customStatements.js'
import { alertError } from '../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await sendCustomStatements()
    console.log(`[cron/custom-statements] ${JSON.stringify(out)}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/custom-statements]', error)
    await alertError('custom-statements', error)
    return res.status(500).json({ error: 'Statements failed' })
  }
}
