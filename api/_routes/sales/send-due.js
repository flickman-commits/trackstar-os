/**
 * /api/sales/send-due — the Send later cron.
 *
 * Runs every 15 minutes (vercel.json). Sends each scheduled email whose time has
 * come, through the Gmail of the person who scheduled it, or holds it with
 * the reason when the deal moved since. See server/domain/sales/scheduled.js.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { recordCronSuccess } from '../../../server/lib/cronJobs.js'
import { alertCronFailure } from '../../_lib/alerts.js'
import { sendDue } from '../../../server/domain/sales/scheduled.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await sendDue()
    if (out.due) console.log(`[sales.send-due] due ${out.due}, sent ${out.sent}, held ${out.held}`)
    await recordCronSuccess(req.url)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[API /sales/send-due]', error)
    await alertCronFailure('send-due', error)
    return res.status(500).json({ error: 'Send later run failed' })
  }
}
