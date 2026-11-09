/**
 * /api/support/hall-of-fame - the Trackstar Hall of Fame gift card for an order.
 *
 *   GET  ?orderId=   the card already made for this order, or { card: null }
 *   POST { orderId } makes the $50 gift card in Shopify (once per order; again returns the same card)
 *
 * Returns { card: { code, last4, customerAssigned, already } } for the Hall of Fame email.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { createHallOfFameCard, existingCard } from '../../../server/domain/support/hallOfFame.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    if (req.method === 'GET') return res.status(200).json({ card: await existingCard(String(req.query?.orderId || '')) })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const card = await createHallOfFameCard({ orderId: body.orderId, actor: user })
    if (!card.already) await recordAudit({ action: 'support.hall_of_fame_card', summary: `Made a $50 Hall of Fame gift card (ending ${card.last4}) for order ${body.orderId}`, detail: { orderId: body.orderId, giftCardId: card.giftCardId, customerAssigned: card.customerAssigned }, actor: user })
    return res.status(200).json({ card })
  } catch (error) {
    console.error('[API /support/hall-of-fame]', error?.message)
    return sendPublicError(res, error)
  }
}
