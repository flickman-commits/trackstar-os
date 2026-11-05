/**
 * POST /api/support/mockups { orderIds }
 *
 * The newest mockups for these order rows, the same list the conversation
 * shows (server/domain/support/mockups.js). The Refresh beside "Attach
 * mockup" calls it after a re-render, so the rep attaches v2, not the v1 the
 * page loaded with. Returns { mockups }.
 */
import { setCors } from '../_lib/auth.js'
import { requireCapability } from '../_lib/users.js'
import { listMockups } from '../../server/domain/support/mockups.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const ids = (Array.isArray(body.orderIds) ? body.orderIds : []).map(String).filter(Boolean).slice(0, 20)
    return res.status(200).json({ mockups: ids.length ? await listMockups(ids) : [] })
  } catch (error) {
    console.error('[API /support/mockups]', error)
    return sendPublicError(res, error)
  }
}
