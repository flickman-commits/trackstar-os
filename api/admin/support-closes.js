/**
 * GET /api/admin/support-closes?days=30
 *
 * Admin only. Support conversations each person closed per day (Eastern
 * time), credited to the account that clicked Close, not the assignee.
 * See server/domain/support/closeCounter.js.
 */
import { setCors } from '../_lib/auth.js'
import { requireAdminOnly } from '../_lib/users.js'
import { closeCounter } from '../../server/domain/support/closeCounter.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    return res.status(200).json(await closeCounter(Number(req.query?.days) || 30))
  } catch (error) {
    return sendPublicError(res, error)
  }
}
