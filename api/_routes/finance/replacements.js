/**
 * /api/finance/replacements
 *   GET  ?month=YYYY-MM                      a month's replacements and their cost (server/domain/finance/replacements.js)
 *   POST { id, reason?, note?, reimbursed? } change the reason or note, or mark one paid back
 * Admin only.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { monthReplacements, updateReplacement } from '../../../server/domain/finance/replacements.js'
import { answerError } from '../../_lib/finance.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireAdminOnly(req, res)
  if (!user) return
  try {
    if (req.method === 'GET') return res.status(200).json(await monthReplacements(String(req.query?.month || '')))
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
      const row = await updateReplacement(body.id, { reason: body.reason, note: body.note, reimbursed: body.reimbursed })
      await recordAudit({ action: 'finance.replacement_update', summary: `Updated replacement ${row.arteloOrderId}${body.reimbursed !== undefined ? (row.reimbursed ? ': paid back' : ': not paid back') : ''}`, detail: { id: row.id, reason: body.reason, reimbursed: body.reimbursed }, actor: user })
      return res.status(200).json({ ok: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) { return answerError(res, error, '/finance/replacements') }
}
