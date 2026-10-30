/**
 * /api/support/artelo - a new Artelo order for a customer (a reprint or replacement).
 *
 *   POST { action: 'prep', id, shopifyOrderId }      the items, whether each can be copied, the next order id
 *   POST { action: 'create', id, shopifyOrderId, orderIds, changes?, files?: { [orderId]: 'upload:<path>' }, address, email, instructions, test }
 *   POST { action: 'claimPrep', id, shopifyOrderId }  the customer's photos in this conversation, for a claim
 *   POST { action: 'claim', id, shopifyOrderId, kind: 'damaged' | 'lost', photos?: [{ messageId, index }], note?, tracking? }
 *                                                    emails Artelo support for a free replacement (damageClaim.js)
 *
 * id is the Support conversation, and the order has to be its customer's
 * (under their email, or linked to them). `create` carries an idempotencyKey
 * made per press, and `test` is for admins only. See
 * server/domain/support/arteloOrder.js.
 */
import { setCors } from '../_lib/auth.js'
import { requireCapability, recordAudit } from '../_lib/users.js'
import prisma from '../_lib/prisma.js'
import { reorderPrep, createReorder } from '../../server/domain/support/arteloOrder.js'
import { claimPrep, sendArteloClaim } from '../../server/domain/support/damageClaim.js'
import { assertOrderInThread } from '../../server/domain/support/threads.js'
import { claimOnce } from '../../server/domain/support/idempotency.js'
import { publicMessage, publicStatus } from '../../server/domain/support/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const thread = await prisma.supportThread.findUnique({ where: { id: String(body.id || '') } })
    if (!thread) return res.status(404).json({ error: 'No such conversation' })
    if (!body.shopifyOrderId) return res.status(400).json({ error: 'Which order?' })
    await assertOrderInThread(thread, { shopifyOrderId: body.shopifyOrderId })
    if (body.action === 'prep') return res.status(200).json(await reorderPrep({ shopifyOrderId: body.shopifyOrderId }))
    if (body.action === 'create') {
      // A test order is never produced, but it is still an order in our
      // Artelo account; trying the flow is an admin's job.
      if (body.test === true && user.role !== 'admin') return res.status(403).json({ error: 'Test orders are for admins. Leave Test off to send the real one.' })
      await claimOnce('support.artelo_order', body.idempotencyKey)
      const out = await createReorder({ thread, shopifyOrderId: body.shopifyOrderId, orderIds: Array.isArray(body.orderIds) ? body.orderIds.map(String) : [], changes: body.changes && typeof body.changes === 'object' ? body.changes : null, files: body.files && typeof body.files === 'object' ? body.files : null, address: body.address, email: body.email, instructions: body.instructions, test: body.test === true, actor: user })
      await recordAudit({ action: 'support.artelo_order', summary: out.summary, detail: { threadId: thread.id, shopifyOrderId: body.shopifyOrderId, arteloOrderId: out.orderId, test: out.test }, actor: user })
      return res.status(200).json(out)
    }
    if (body.action === 'claimPrep') return res.status(200).json(await claimPrep({ thread, shopifyOrderId: body.shopifyOrderId }))
    if (body.action === 'claim') {
      await claimOnce('support.artelo_claim', body.idempotencyKey)
      const out = await sendArteloClaim({ thread, shopifyOrderId: body.shopifyOrderId, kind: body.kind === 'lost' ? 'lost' : 'damaged', photos: body.photos, note: body.note, tracking: body.tracking, actor: user })
      await recordAudit({ action: 'support.artelo_claim', summary: out.summary, detail: { threadId: thread.id, shopifyOrderId: body.shopifyOrderId, kind: out.kind, photos: out.photos, claimThreadId: out.claimThreadId }, actor: user })
      return res.status(200).json(out)
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /support/artelo]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Artelo did not take that. Check Artelo before trying again.') })
  }
}
