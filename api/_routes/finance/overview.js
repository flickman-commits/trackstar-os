/**
 * /api/finance/overview - admin only. The Overview page in one read
 * (server/domain/finance/overview.js), less the Needs you cards an admin
 * dismissed (server/domain/finance/needs.js).
 *
 *   GET ?period=today|yesterday|7d|30d|mtd|last_month|qtd|ytd|YYYY-MM-DD..YYYY-MM-DD
 *   POST { dismiss: key }   hide a Needs you card
 *   POST { restore: key }   show it again
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { overview } from '../../../server/domain/finance/overview.js'
import { dismissedNeeds, setNeedDismissed } from '../../../server/domain/finance/needs.js'
import { answerError } from '../../_lib/finance.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      await setNeedDismissed(body.dismiss || body.restore, !!body.dismiss)
      return res.status(200).json({ ok: true })
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const [o, dismissed] = await Promise.all([overview({ period: String(req.query?.period || 'today') }), dismissedNeeds()])
    return res.status(200).json({ ...o, needs: o.needs.filter(n => !dismissed[n.key]) })
  } catch (error) {
    if (error?.expose) return res.status(error.status || 400).json({ error: error.message })
    return answerError(res, error, '/finance/overview')
  }
}
