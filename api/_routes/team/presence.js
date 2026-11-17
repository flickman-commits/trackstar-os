/**
 * GET /api/team/presence - admins only: who used the app in the last few
 * minutes and who has an hours timer running (server/domain/people/presence.js).
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { presence } from '../../../server/domain/people/presence.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  if (actor.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ people: await presence() })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
