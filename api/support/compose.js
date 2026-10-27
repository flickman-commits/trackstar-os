/**
 * /api/support/compose - Support, seen from an order in TrackstarOS.
 *
 *   GET  ?orderId=                    the customer's conversations that are not closed, and the order's mockups
 *   POST { orderId, subject, text, mockupRef? }   "Email customer": sends from fast@; returns { threadId, to, subject, held }
 *        With mockupRef, the mockup goes attached for the customer to approve and the print is held from production.
 *
 * The address comes from the order, never from the page.
 */
import { setCors } from '../_lib/auth.js'
import { requireCapability, recordAudit } from '../_lib/users.js'
import { emailCustomer, conversationsForOrder } from '../../server/domain/support/compose.js'
import { listMockups } from '../../server/domain/support/mockups.js'

const SAFE = /^(No such order|That mockup is not on this order|That design is not ready|That proof is gone|This order has no customer email to write to|Write the email first|Fill in what we need from them first|The support mailbox|Gmail is rate limiting us)/

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  if (req.method === 'GET') {
    try {
      const orderId = String(req.query?.orderId || '')
      const [threads, mockups] = await Promise.all([conversationsForOrder(orderId), orderId ? listMockups([orderId]).catch(() => []) : []])
      return res.status(200).json({ threads, mockups })
    } catch (error) {
      console.error('[API /support/compose GET]', error)
      return res.status(500).json({ error: 'Could not read Support conversations' })
    }
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const mockupRef = typeof body.mockupRef === 'string' && body.mockupRef ? body.mockupRef : null
    const out = await emailCustomer({ orderId: body.orderId, subject: body.subject, text: body.text, actor: user, mockupRef })
    await recordAudit({ action: 'support.compose', summary: `${mockupRef ? 'Sent the design to approve to' : 'Emailed'} ${out.to}: "${out.subject}"${out.held ? ', held from production' : ''}`, detail: { orderId: body.orderId, threadId: out.threadId, mockupRef, held: out.held }, actor: user })
    return res.status(200).json(out)
  } catch (error) {
    console.error('[API /support/compose]', error)
    const msg = String(error?.message || '')
    return res.status(SAFE.test(msg) ? 400 : 500).json({ error: SAFE.test(msg) ? msg : 'Could not send that email. Try again, or send it from Support.' })
  }
}
