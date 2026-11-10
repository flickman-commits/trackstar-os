/**
 * POST /api/orders/no-time { orderId, noTime }
 *
 * Make a print a NO TIME print (the customer asked for their time to be left
 * off), or put the time back. Sets hadNoTime, closes a design still waiting
 * for review, and renders again: the template prints NO TIME where the time
 * and pace go. Anyone who renders designs (orders.render). Commented on the
 * order and audited.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import prisma from '../../_lib/prisma.js'
import { checkOrder, createJob } from '../../../server/domain/render/jobs.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'orders.render')
  if (!user) return

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const noTime = body.noTime !== false
    const o = await prisma.order.findUnique({ where: { id: String(body.orderId || '') }, select: { id: true, orderNumber: true, hadNoTime: true, status: true, trackstarOrderType: true } })
    if (!o) return res.status(404).json({ error: 'Order not found' })
    if (o.trackstarOrderType !== 'standard') return res.status(400).json({ error: 'Only a standard print can be switched to NO TIME here' })
    if (o.status === 'completed') return res.status(400).json({ error: 'This order is complete. Reopen it first.' })
    if (o.hadNoTime === noTime) return res.status(400).json({ error: noTime ? 'This print is already NO TIME' : 'This print already has its time' })

    await prisma.order.update({ where: { id: o.id }, data: { hadNoTime: noTime } })
    const who = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Someone'
    await prisma.orderComment.create({ data: { orderId: o.id, text: noTime ? 'Converted to a NO TIME print: the design renders without the time and pace.' : 'Time put back on the print: the design renders with the time and pace.', authorId: user.id || null, authorName: who } })
    await recordAudit({ action: noTime ? 'order.no-time' : 'order.time-restored', summary: `${noTime ? 'Converted' : 'Put the time back on'} ${o.orderNumber}${noTime ? ' to NO TIME' : ''}`, detail: { orderId: o.id }, actor: user })

    // The design waiting for review was made the other way: close it and render again.
    const note = noTime ? 'Converted to NO TIME; a new design replaces it' : 'Time put back; a new design replaces it'
    await prisma.renderJob.updateMany({ where: { orderId: o.id, status: 'done', review: 'pending' }, data: { review: 'closed', reviewNote: note, reviewedAt: new Date() } })
    const { ok, reasons, spec } = await checkOrder(o.id, { allowUnpaidPhoto: true })
    if (!ok) return res.status(200).json({ ok: true, noTime, rendering: null, reasons })
    // A render already waiting would print the old way: give it the new spec.
    await prisma.renderJob.updateMany({ where: { orderId: o.id, status: 'queued' }, data: { spec } })
    if (await prisma.renderJob.findFirst({ where: { orderId: o.id, status: 'rendering' } })) {
      return res.status(200).json({ ok: true, noTime, rendering: null, reasons: ['A design was already rendering the old way. Press Re-render when it finishes.'] })
    }
    const job = await createJob({ orderId: o.id, requestedBy: 'admin', requestedById: user.id || null })
    return res.status(200).json({ ok: true, noTime, rendering: job.version, reasons: [] })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
