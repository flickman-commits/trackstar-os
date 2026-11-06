/**
 * /api/sales/scheduled — Send later.
 *
 *   GET  ?scope=all                          open scheduled and held emails (yours, or everyone's)
 *   POST { action:'schedule', dealId?, personId?, to?, subject, body, assetIds?, adhoc?, sendAt }
 *   POST { action:'cancel', id }             take it back; returns it so the composer can reopen it
 *   POST { action:'send-now', id }           send a held email as it is, after a look
 *
 * The sending itself is the cron at /api/sales/send-due.
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep, recordAudit } from '../../_lib/users.js'
import { scheduleSend, listScheduled, cancelScheduled, sendHeldNow } from '../../../server/domain/sales/scheduled.js'
import { publicMessage, publicStatus } from '../../../server/domain/sales/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ scheduled: await listScheduled(actor, { all: req.query?.scope === 'all' }) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})

    if (body.action === 'schedule') {
      try {
        const scheduled = await scheduleSend({
          dealId: body.dealId ? String(body.dealId) : null,
          personId: body.personId ? String(body.personId) : null,
          to: body.to ? String(body.to) : null,
          subject: String(body.subject || ''), body: String(body.body || ''),
          assetIds: Array.isArray(body.assetIds) ? body.assetIds.map(String) : [],
          adhoc: Boolean(body.adhoc), sendAt: body.sendAt, actor,
        })
        await recordAudit({ actor, action: 'sales.schedule', summary: `Scheduled an email to ${scheduled.toEmail} for ${new Date(scheduled.sendAt).toISOString()}`, detail: { id: scheduled.id } })
        return res.status(200).json({ scheduled })
      } catch (e) {
        return res.status(publicStatus(e)).json({ error: publicMessage(e, 'Something went wrong with scheduled emails'), problems: e.problems })
      }
    }
    if (body.action === 'cancel') {
      try {
        return res.status(200).json({ scheduled: await cancelScheduled(String(body.id || ''), actor) })
      } catch (e) {
        return res.status(publicStatus(e)).json({ error: publicMessage(e, 'Something went wrong with scheduled emails') })
      }
    }
    if (body.action === 'send-now') {
      try {
        return res.status(200).json(await sendHeldNow(String(body.id || ''), actor))
      } catch (e) {
        return res.status(publicStatus(e)).json({ error: publicMessage(e, 'Something went wrong with scheduled emails') })
      }
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /sales/scheduled]', error)
    return res.status(500).json({ error: 'Something went wrong with scheduled emails' })
  }
}
