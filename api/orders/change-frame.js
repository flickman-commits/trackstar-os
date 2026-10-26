/**
 * /api/orders/change-frame - admin only. Change the frame on a print the
 * customer already bought, by editing the Shopify order
 * (server/domain/orders/changeFrame.js).
 *
 *   POST { action: 'options', orderId }            the frames it can change to
 *   POST { action: 'change', orderId, variantId }  edit the Shopify order
 */
import { setCors, requireAdmin } from '../_lib/auth.js'
import { requireAdminRole } from '../_lib/users.js'
import { frameOptions, changeFrame } from '../../server/domain/orders/changeFrame.js'
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
    if (body.action === 'options') return res.status(200).json(await frameOptions(body.orderId))
    if (body.action === 'change') return res.status(200).json(await changeFrame({ orderId: body.orderId, variantId: String(body.variantId || ''), actor: admin }))
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /orders/change-frame]', error)
    return sendPublicError(res, error)
  }
}
