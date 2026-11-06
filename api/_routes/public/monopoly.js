/**
 * Public, unauthenticated read for the Marathon Monopoly proposal page.
 *
 *   GET /api/public/monopoly              → ungated payload
 *   GET /api/public/monopoly?p=boston     → ungated + personalisation, auto-unlocked
 *   GET /api/public/monopoly?key=…        → auto-unlocked (Matt's direct link)
 *   GET /api/public/monopoly?refresh=1    → bypass the 5-minute sheet cache
 *
 * The gate is enforced here, not in the browser: without a valid unlock cookie
 * the response body contains no fee, unit-allocation or terms field at all.
 * There is nothing to reveal in devtools because nothing was sent.
 *
 * Cost and margin data is not reachable from this file. That lives behind
 * requireAdmin in api/_routes/admin/monopoly-model.js.
 *
 * Gated behind MONOPOLY_PAGE_ENABLED so the page stays dark until it's ready,
 * returning 404 rather than 403 — an endpoint that isn't on shouldn't announce
 * that it exists.
 */
import { setCors, safeEqual } from '../../_lib/auth.js'
import {
  getBoardData,
  resolvePersonalization,
} from '../../../server/services/monopolyBoard.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) return String(fwd).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS', allowPublic: true })) return

  // Personalisation and unlock state vary per visitor, so this must never be
  // cached by a CDN or shared proxy.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')

  if (process.env.MONOPOLY_PAGE_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' })
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // This is a 5-minute-cached read of a static payload, not a scrape, so it gets
  // its own generous budget. A race office behind one NAT IP passing the link
  // around must never hit a wall mid-pitch and silently drop to stale data.
  const limit = await checkRateLimitDurable(getClientIp(req), { bucket: 'monopoly_view', max: 300 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'Too many requests' })
  }

  try {
    // Only Matt can force a re-read — otherwise a refresh loop from any visitor
    // would hammer the Sheets quota and take the page down with it.
    const accessKey = typeof req.query.key === 'string' ? req.query.key : ''
    const hasAccessKey = Boolean(
      process.env.MONOPOLY_ACCESS_KEY && accessKey && safeEqual(accessKey, process.env.MONOPOLY_ACCESS_KEY),
    )
    const refresh = hasAccessKey && req.query.refresh === '1'

    const { publicPayload } = await getBoardData({ refresh })

    // Partnership pricing is shown to everyone, and it ships with the client
    // rather than riding on this response. Matt sends this link directly to
    // races he is already talking to, so an email wall only added friction in
    // front of people whose email he already had.
    //
    // Cost and margin are a different boundary entirely. Those live behind
    // requireAdmin on /api/admin/monopoly-model and still never appear here.
    const slug = typeof req.query.p === 'string' ? req.query.p : ''
    const personalizedFor = resolvePersonalization(publicPayload, slug)

    return res.status(200).json({ ...publicPayload, personalizedFor: personalizedFor || undefined })
  } catch (err) {
    console.error('[monopoly] request failed:', err)
    return res.status(500).json({ error: 'Unable to load board data' })
  }
}
