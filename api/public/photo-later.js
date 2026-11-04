/**
 * /api/public/photo-later - the customer side of "add photo after the race"
 * (server/domain/orders/photoLater.js). The link in their email is the only
 * credential: /photo/{token} names one print, and all it can do is put a
 * photo on that print, or say they want it without one.
 *
 *   GET  ?token=                         what the page shows
 *   POST { token, action: 'attach', path }   after photo-upload-url and photo-verify
 *   POST { token, action: 'skip' }           print without a photo, refund the add-on
 *
 * Never returns error.message.
 */
import { setCors } from '../_lib/auth.js'
import { checkRateLimitDurable } from '../../server/lib/publicRateLimit.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { photoLaterInfo, attachLaterPhoto, skipLaterPhoto, PhotoLaterError } from '../../server/domain/orders/photoLater.js'

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0]).trim() || req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS', allowPublic: true })) return
  const post = req.method === 'POST'
  if (!post && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const limit = await checkRateLimitDurable(clientIp(req), { bucket: post ? 'photo_later_post' : 'photo_later_view', max: post ? 20 : 120 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'rate_limited' })
  }

  try {
    if (!post) return res.status(200).json(await photoLaterInfo(req.query?.token))
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (body.action === 'attach') return res.status(200).json(await attachLaterPhoto(body.token, body.path))
    if (body.action === 'skip') return res.status(200).json(await skipLaterPhoto(body.token))
    return res.status(400).json({ error: 'bad_request' })
  } catch (error) {
    if (error instanceof PhotoLaterError) return res.status(error.status).json({ error: error.code })
    console.error('[photo-later]', error)
    return sendPublicError(res, error)
  }
}
