/**
 * GET /api/cron/fulfillment-check - hourly, from Vercel cron. Pings Slack when
 * a print variant comes unhooked from Artelo, and when it is back
 * (server/domain/catalog/fulfillmentHookup.js). Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { checkFulfillmentHookup } from '../../../server/domain/catalog/fulfillmentHookup.js'
import { alertError } from '../../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { list, ...out } = await checkFulfillmentHookup()
    console.log(`[cron/fulfillment-check] ${JSON.stringify(out)}`)
    return res.status(200).json({ ...out, skus: list.map(v => v.sku) })
  } catch (error) {
    console.error('[cron/fulfillment-check]', error)
    // A check that cannot run would otherwise look the same as a clean catalog.
    await alertError('fulfillment-check', error)
    return res.status(500).json({ error: 'Check failed' })
  }
}
