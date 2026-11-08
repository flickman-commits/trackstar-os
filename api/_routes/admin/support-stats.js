/**
 * GET /api/admin/support-stats?days=30&months=6
 *
 * Admin only. Email tickets in and closed per day, and the share of orders
 * whose customer wrote to support (server/domain/support/supportStats.js).
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { emailDaily, ticketRate } from '../../../server/domain/support/supportStats.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const [daily, rate] = await Promise.all([emailDaily(Number(req.query?.days) || 30), ticketRate(Number(req.query?.months) || 6)])
    return res.status(200).json({ daily, rate })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
