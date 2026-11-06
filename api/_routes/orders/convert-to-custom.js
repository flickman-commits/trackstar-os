/**
 * POST { orderId, raceName, raceYear?, bib?, time?, creativeDirection?, reason }
 * Turn a standard print into a custom one without touching Shopify
 * (server/domain/orders/convertToCustom.js). For anyone who handles
 * automated designs (admin, fulfillment).
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { convertToCustom } from '../../../server/domain/orders/convertToCustom.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'orders.render')
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const out = await convertToCustom({ ...body, actor: user })
    await recordAudit({ action: 'order.convert_custom', summary: `Converted ${out.order.orderNumber} from ${out.before} to a custom ${out.after} print: ${String(body.reason || '').slice(0, 200)}`, detail: { orderId: out.order.id, before: out.before, after: out.after }, actor: user })
    return res.status(200).json({ ok: true, orderId: out.order.id, dueDate: out.dueDate, matchedSiblings: out.matchedSiblings })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
