/**
 * /api/public/ship-address - the customer changes their own shipping address
 * from the link in the Shopify order confirmation
 * (server/domain/orders/selfServeAddress.js). The link is the credential:
 * the Shopify order id and its HMAC signature.
 *
 *   GET  ?order=&sig=                       what the page shows
 *   POST { order, sig, address }            save it, while the window is open
 *
 * Never returns error.message.
 */
import { setCors } from '../../_lib/auth.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { selfServeInfo, selfServeUpdate, SelfServeError } from '../../../server/domain/orders/selfServeAddress.js'

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0]).trim() || req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS', allowPublic: true })) return
  const post = req.method === 'POST'
  if (!post && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const limit = await checkRateLimitDurable(clientIp(req), { bucket: post ? 'ship_address_post' : 'ship_address_view', max: post ? 10 : 60 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'rate_limited' })
  }
  try {
    if (!post) return res.status(200).json(await selfServeInfo(req.query?.order, req.query?.sig))
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    return res.status(200).json(await selfServeUpdate(body.order, body.sig, body.address))
  } catch (error) {
    if (error instanceof SelfServeError) return res.status(error.status).json({ error: error.code, ...(error.detail ? { detail: String(error.detail).slice(0, 200) } : {}) })
    console.error('[ship-address]', error)
    return sendPublicError(res, error)
  }
}
