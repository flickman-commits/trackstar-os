/**
 * /api/public/order-photo - the customer's own uploaded photo, for the order
 * confirmation email (shopify/order-confirmation/README.md). Shopify never
 * has the photo, only its path in our private bucket, so the email points
 * an <img> here and this answers with a short-lived signed URL.
 *
 *   GET ?order=<shopify order id>&sig=<hmac>&line=<index into the order's line items>
 *   -> 302 to the photo, or 404
 *
 * The link is the credential, the same signature as Manage your order
 * (changeWindow.linkSignature), so only someone holding the email can load
 * it. Read straight from Shopify: the email goes out the moment the order is
 * placed, minutes before the import has it. Never returns error.message.
 */
import { setCors } from '../_lib/auth.js'
import { checkRateLimitDurable } from '../../server/lib/publicRateLimit.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { linkIsValid } from '../../server/domain/orders/changeWindow.js'
import { shopifyFetch } from '../../server/services/shopifyAuth.js'
import { withAddonPhotos } from '../../server/lib/lineItemMatching.js'
import { storage } from '../../server/lib/storage.js'

const BUCKET = 'personalization-photos'
// What photo-verify stores: a sanitized JPEG, PNG or WEBP under a date prefix.
const PATH = /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0]).trim() || req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS', allowPublic: true })) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const limit = await checkRateLimitDurable(clientIp(req), { bucket: 'order_photo', max: 60 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'rate_limited' })
  }
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    const id = String(req.query?.order || '').trim()
    const line = Number(req.query?.line)
    if (!/^\d{6,20}$/.test(id) || !linkIsValid(id, req.query?.sig) || !Number.isInteger(line) || line < 0 || line > 50) return res.status(404).json({ error: 'not_found' })
    const data = await shopifyFetch(`/orders/${id}.json`)
    const items = withAddonPhotos(data?.order?.line_items || [])
    const path = (items[line]?.properties || []).find(p => p?.name === '_photo_path')?.value
    if (!PATH.test(String(path || ''))) return res.status(404).json({ error: 'not_found' })
    const { data: signed, error } = await storage().storage.from(BUCKET).createSignedUrl(path, 600)
    if (error || !signed?.signedUrl) return res.status(404).json({ error: 'not_found' })
    res.setHeader('Location', signed.signedUrl)
    return res.status(302).end()
  } catch (error) {
    console.error('[order-photo]', error)
    return sendPublicError(res, error)
  }
}
