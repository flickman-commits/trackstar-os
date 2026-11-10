/**
 * /api/support/compose - Support, seen from an order in TrackstarOS.
 *
 *   GET  ?orderId=&all=1              the customer's conversations (not closed; all=1 adds closed ones), the order's mockups and where it ships
 *   POST { orderId, subject, text, mockupRef? }   "Email customer": sends from fast@; returns { threadId, to, subject, held }
 *        With mockupRef (render:, proof: or upload: from /api/support/upload), the mockup goes attached for the customer
 *        to approve and the print is held from production. waiting: false (Hall of Fame) sends it without parking the order in Waiting on customer.
 *
 * The address comes from the order, never from the page.
 *
 * Designers (orders.message_customer, no Support access) may use it on a
 * custom order: the email goes out the same way and opens a Support
 * conversation, but it is not assigned to them and they are not shown the
 * customer's other conversations.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAnyCapability, recordAudit } from '../../_lib/users.js'
import prisma from '../../_lib/prisma.js'
import { emailCustomer, conversationsForOrder } from '../../../server/domain/support/compose.js'
import { listMockups } from '../../../server/domain/support/mockups.js'
import { shipToForOrder } from '../../../server/domain/support/threads.js'

const SAFE = /^(No such order|Unknown attachment|That attachment is gone|That mockup is not on this order|That design is not ready|That proof is gone|This order has no customer email to write to|Write the email first|Fill in what we need from them first|The support mailbox|Gmail is rate limiting us)/

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireAnyCapability(req, res, ['support', 'orders.message_customer'])
  if (!user) return
  const support = user.has.has('support')
  if (!support) {
    // A designer: custom orders only.
    const id = String((req.method === 'GET' ? req.query?.orderId : (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}).orderId) || '')
    const o = id ? await prisma.order.findUnique({ where: { id }, select: { trackstarOrderType: true } }) : null
    if (o?.trackstarOrderType !== 'custom') return res.status(403).json({ error: 'That is not part of your role. Ask Matt if you need it.', code: 'not_allowed' })
  }
  if (req.method === 'GET') {
    try {
      const orderId = String(req.query?.orderId || '')
      const [threads, mockups, shipTo] = await Promise.all([conversationsForOrder(orderId, { all: req.query?.all === '1' }), orderId ? listMockups([orderId]).catch(() => []) : [], shipToForOrder(orderId).catch(() => null)])
      return res.status(200).json({ threads: support ? threads : [], mockups, shipTo })
    } catch (error) {
      console.error('[API /support/compose GET]', error)
      return res.status(500).json({ error: 'Could not read Support conversations' })
    }
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const mockupRef = typeof body.mockupRef === 'string' && body.mockupRef ? body.mockupRef : null
    const out = await emailCustomer({ orderId: body.orderId, subject: body.subject, text: body.text, actor: user, mockupRef, waiting: body.waiting !== false })
    await recordAudit({ action: 'support.compose', summary: `${mockupRef ? 'Sent the design to approve to' : 'Emailed'} ${out.to}: "${out.subject}"${out.held ? ', held from production' : ''}`, detail: { orderId: body.orderId, threadId: out.threadId, mockupRef, held: out.held }, actor: user })
    return res.status(200).json(out)
  } catch (error) {
    console.error('[API /support/compose]', error)
    const msg = String(error?.message || '')
    return res.status(SAFE.test(msg) ? 400 : 500).json({ error: SAFE.test(msg) ? msg : 'Could not send that email. Try again, or send it from Support.' })
  }
}
