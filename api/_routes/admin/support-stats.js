/**
 * GET /api/admin/support-stats?range=today|yesterday|7d|30d|90d
 *
 * Admin only. Email tickets in and closed, the share of orders whose customer
 * wrote in, who closed what, and replacement spend, for the Stats page's
 * window (server/domain/support/supportStats.js). Same ranges as /api/admin/stats.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { supportStats } from '../../../server/domain/support/supportStats.js'
import { RANGES, rangeWindow } from '../../../server/services/shopifyStats.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const range = String(req.query?.range || '30d')
    if (!RANGES[range]) return res.status(400).json({ error: `Unknown range "${range}"` })
    return res.status(200).json(await supportStats(rangeWindow(range)))
  } catch (error) {
    return sendPublicError(res, error)
  }
}
