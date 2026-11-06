/**
 * Public, unauthenticated: the storefront reports a photo it turned away.
 *
 *   POST /api/public/photo-reject
 *   body: { reason, source, width, height, bytes, type, race, device }
 *   -> 204
 *
 * The wizards check size and type in the browser, so most refusals never
 * reach the server. This is how they get counted. Fire-and-forget from the
 * page; nothing here can block an order. See server/lib/photoRejects.js.
 */
import { setCors } from '../../_lib/auth.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'
import { logPhotoReject } from '../../../server/lib/photoRejects.js'

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS', allowPublic: true })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const limit = await checkRateLimitDurable(clientIp(req), { bucket: 'photo_reject', max: 30 })
  if (!limit.allowed) return res.status(204).end()

  let body = req.body || {}
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
  // The server's own refusals are logged where they happen (photo-verify).
  if (body.source === 'server') body.source = 'wizard'
  await logPhotoReject(body)
  return res.status(204).end()
}
