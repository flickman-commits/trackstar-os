/**
 * /api/orders/change-frame - admin only. Change the frame on a print the
 * customer already bought, from the order view's frame chip. The same Shopify
 * order edit as Support's Change size or frame (server/domain/support/changeItem.js).
 *
 *   POST { action: 'options', orderId }        the frames it can change to, at its size
 *   POST { action: 'change', orderId, frame }  edit the Shopify order
 */
import { setCors, requireAdmin } from '../_lib/auth.js'
import { requireAdminRole } from '../_lib/users.js'
import { frameChoices, changeItem } from '../../server/domain/support/changeItem.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = await requireAdminRole(req, res, actor)
  if (!admin) return

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (body.action === 'options') return res.status(200).json(await frameChoices({ orderRowId: body.orderId }))
    if (body.action === 'change') {
      const frame = String(body.frame || '').trim()
      if (!frame) return res.status(400).json({ error: 'Pick a frame' })
      return res.status(200).json(await changeItem({ orderRowId: body.orderId, frame, actor: admin }))
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /orders/change-frame]', error)
    return sendPublicError(res, error)
  }
}
