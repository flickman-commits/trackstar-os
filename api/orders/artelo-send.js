/**
 * /api/orders/artelo-send - an approved print on its way to Artelo production
 * (server/domain/render/arteloSend.js).
 *
 *   GET  ?setting=1                     whether Approve sends to production
 *   POST { action: 'hold', orderId }    keep it from sending; it stays approved
 *   POST { action: 'send-now', orderId } send it now (held, approved
 *                                       only, or fixed after Artelo refused it)
 *   POST { action: 'setting', on }      switch sending on or off (admins)
 *
 * Hold and Send now take what Approve takes: orders.render for a standard
 * order; anyone signed in for a custom one, who can upload its final PDF.
 */
import { setCors, requireAdmin } from '../_lib/auth.js'
import { loadActiveUser, requireAdminRole } from '../_lib/users.js'
import { can } from '../_lib/roles.js'
import prisma from '../_lib/prisma.js'
import { autoSendOn, setAutoSend, holdSend, sendNow } from '../../server/domain/render/arteloSend.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') return res.status(200).json({ on: await autoSendOn() })
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})

    if (body.action === 'setting') {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      return res.status(200).json(await setAutoSend(body.on === true, admin))
    }

    const user = await loadActiveUser(actor)
    if (!user) return res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
    const order = await prisma.order.findUnique({ where: { id: String(body.orderId || '') }, select: { id: true, trackstarOrderType: true } })
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (order.trackstarOrderType === 'standard' && !user.isSystem && !(await can(user, 'orders.render'))) {
      return res.status(403).json({ error: 'That is not part of your role. Ask Matt if you need it.', code: 'not_allowed' })
    }

    if (body.action === 'hold') { await holdSend({ orderId: order.id, actor: user }); return res.status(200).json({ ok: true }) }
    if (body.action === 'send-now') { await sendNow({ orderId: order.id, actor: user }); return res.status(200).json({ ok: true }) }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /orders/artelo-send]', error)
    return sendPublicError(res, error)
  }
}
