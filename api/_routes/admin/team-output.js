/**
 * GET /api/admin/team-output
 *
 * Admin only. What each person got done per day (prints, customs, tickets,
 * replies, logged hours) for the Team by day card on Settings > Stats
 * (server/domain/stats/teamOutput.js), for the past 90 days; the page slices
 * its periods out of them.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { teamOutput } from '../../../server/domain/stats/teamOutput.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    // A day over, as the first one is partial and dropped.
    const until = new Date()
    return res.status(200).json(await teamOutput({ since: new Date(until.getTime() - 91 * 86_400_000), until }))
  } catch (error) {
    return sendPublicError(res, error)
  }
}
