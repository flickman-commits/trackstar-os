/**
 * GET /api/admin/race-data
 *
 * Every race year with whether its date and weather are fit to print, the
 * evidence behind the date, how the weather was computed, and the open
 * orders waiting on it. Backs the Race Database panel's provenance and its
 * "blocked" list. Same capability as the Race Database itself.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability } from '../../_lib/users.js'
import { verificationOverview } from '../../../server/domain/races/verification.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireCapability(req, res, 'settings.data'))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    return res.status(200).json(await verificationOverview())
  } catch (error) {
    console.error('[API /admin/race-data]', error)
    return res.status(500).json({ error: 'Could not load race data' })
  }
}
