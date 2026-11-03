/**
 * GET /api/cron/support-triage - twice a day (7am and noon Eastern in winter,
 * 8am and 1pm in summer): Claude reads the open conversations the customer
 * wrote last, stars the urgent ones and reports the run in #trackstar-reports
 * (server/domain/support/triage.js). Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { scheduledTriage } from '../../server/domain/support/triage.js'
import { alertError } from '../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await scheduledTriage()
    console.log(`[cron/support-triage] ${out.status} read ${out.read ?? 0}, starred ${out.starred ?? 0}${out.reason ? ` (${out.reason})` : ''}`)
    return res.status(200).json({ status: out.status, read: out.read ?? 0, starred: out.starred ?? 0, failed: out.failed ?? 0, left: out.left ?? 0 })
  } catch (error) {
    console.error('[cron/support-triage]', error)
    await alertError('support-triage', error)
    return res.status(500).json({ error: 'Support triage failed' })
  }
}
