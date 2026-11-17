/**
 * GET /api/cron/wise-status - every 15 minutes: ask Wise how each paid-for
 * transfer is doing (sent, or money back) and record changes
 * (server/domain/finance/wisePay.js refreshStatuses). Reads Wise only; it
 * never sends or funds anything. Cron only.
 */
import { isCronRequest } from '../../_lib/auth.js'
import { recordAudit } from '../../_lib/users.js'
import { refreshStatuses } from '../../../server/domain/finance/wisePay.js'
import { isConnectionOn } from '../../../server/lib/connections.js'
import { alertError } from '../../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    if (!process.env.WISE_API_TOKEN || !(await isConnectionOn('wise'))) return res.status(200).json({ skipped: 'Wise is not connected' })
    const out = await refreshStatuses()
    if (out.changed.length) {
      await recordAudit({ action: 'wise.status', summary: `Wise states: ${out.changed.map(c => `${c.id} ${c.from} -> ${c.to} (${c.wiseState})`).join(', ')}`, detail: out, actor: null })
    }
    console.log(`[cron/wise-status] ${JSON.stringify({ checked: out.checked, changed: out.changed.length })}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/wise-status]', error)
    await alertError('wise-status', error)
    return res.status(500).json({ error: 'Wise status check failed' })
  }
}
