/**
 * GET /api/cron/support-triage - twice a day (7am and noon Eastern in winter,
 * 8am and 1pm in summer): Claude reads the open conversations the customer
 * wrote last, stars the urgent ones and reports the run in #trackstar-reports
 * (server/domain/support/triage.js). Every other hour from 13:00 to 22:00 UTC
 * it retries, only when a pass left conversations unread (the model was down),
 * and reads new messages for damage reports (support/damage.js) and for what
 * customers say about the designs (support/designFeedback.js). Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { scheduledTriage } from '../../../server/domain/support/triage.js'
import { detectDamage } from '../../../server/domain/support/damage.js'
import { collectDesignFeedback } from '../../../server/domain/support/designFeedback.js'
import { alertError } from '../../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    // 12:00 and 17:00 UTC are the passes; the other hours only retry a pass that could not read everything.
    const hour = new Date().getUTCHours()
    const out = await scheduledTriage({ retryOnly: hour !== 12 && hour !== 17 })
    console.log(`[cron/support-triage] ${out.status} read ${out.read ?? 0}, starred ${out.starred ?? 0}${out.reason ? ` (${out.reason})` : ''}`)
    // The other hours also look for damage reports (support/damage.js): the pass hours spend their time on triage.
    if (hour !== 12 && hour !== 17) {
      const d = await detectDamage({ budgetMs: 130_000 }).catch(e => ({ status: 'failed', firstError: e.message }))
      const f = await collectDesignFeedback({ budgetMs: 70_000 }).catch(e => ({ status: 'failed', firstError: e.message }))
      console.log(`[cron/support-triage] design feedback: ${f.status} read ${f.read ?? 0}, asked ${f.asked ?? 0}, found ${f.found ?? 0}, left ${f.left ?? 0}${f.firstError ? ` (${f.firstError})` : ''}`)
      console.log(`[cron/support-triage] damage: ${d.status} read ${d.read ?? 0}, asked ${d.asked ?? 0}, found ${d.found ?? 0}${d.firstError ? ` (${d.firstError})` : ''}`)
    }
    return res.status(200).json({ status: out.status, read: out.read ?? 0, starred: out.starred ?? 0, failed: out.failed ?? 0, left: out.left ?? 0 })
  } catch (error) {
    console.error('[cron/support-triage]', error)
    await alertError('support-triage', error)
    return res.status(500).json({ error: 'Support triage failed' })
  }
}
