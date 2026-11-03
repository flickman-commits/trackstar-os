/**
 * GET /api/finance/overview?period=today|yesterday|7d|30d|mtd|last_month|qtd|ytd|YYYY-MM-DD..YYYY-MM-DD
 * Admin only. The Overview page in one read (server/domain/finance/overview.js).
 */
import { setCors } from '../_lib/auth.js'
import { requireAdminOnly } from '../_lib/users.js'
import { overview } from '../../server/domain/finance/overview.js'
import { answerError } from '../_lib/finance.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    return res.status(200).json(await overview({ period: String(req.query?.period || 'today') }))
  } catch (error) { return answerError(res, error, '/finance/overview') }
}
