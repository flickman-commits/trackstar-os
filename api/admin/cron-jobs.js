/**
 * GET /api/admin/cron-jobs
 *
 * Admin only. Every scheduled job, when it runs (in Eastern time), when it
 * next runs and when it last ran (server/lib/cronJobs.js), for Settings >
 * System > Scheduled Jobs.
 */
import { setCors } from '../_lib/auth.js'
import { requireAdminOnly } from '../_lib/users.js'
import { listCronJobs } from '../../server/lib/cronJobs.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    return res.status(200).json(await listCronJobs())
  } catch (error) {
    return sendPublicError(res, error)
  }
}
