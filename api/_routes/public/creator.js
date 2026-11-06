/**
 * /api/public/creator - the creator program's public side.
 *
 *   POST { action: 'apply' }                       Apply Now: mint a creator and its portal token
 *   GET  ?token=                                   the portal: their profile, briefs, sample, pickers
 *   POST { action: 'onboard', token, data }        submit or update the application
 *
 * These lived in api/_routes/orders/actions.js, outside api/public/, and missed the
 * public rules: no rate limit, raw Prisma errors, the token in the logs.
 * Here every request is durably rate limited per address, and nothing below
 * ever returns an error message it did not write itself.
 */
import { setCors } from '../../_lib/auth.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'
import { createPublicInvite, portalData, submitOnboarding, PortalError } from '../../../server/domain/creators/portal.js'

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0]).trim() || req.socket?.remoteAddress || 'unknown'
}

/** Per address, per hour. Applying is rare; reading the portal is not. */
const LIMITS = { apply: 5, onboard: 30, portal: 120 }

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS', allowPublic: true })) return
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body = {}
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return res.status(400).json({ error: 'Bad request' }) }
  }
  const action = req.method === 'GET' ? 'portal' : String(body.action || '')
  if (!LIMITS[action]) return res.status(400).json({ error: 'Unknown action' })

  const limit = await checkRateLimitDurable(clientIp(req), { bucket: `creator_${action}`, max: LIMITS[action] })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'Too many requests. Try again in a little while.' })
  }

  try {
    if (action === 'apply') {
      return res.status(201).json({ success: true, inviteToken: await createPublicInvite() })
    }
    const token = String((req.method === 'GET' ? req.query?.token : body.token) || '')
    if (!token || token.length > 80) return res.status(404).json({ error: 'Invite not found or revoked' })
    if (action === 'portal') {
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json(await portalData(token))
    }
    return res.status(200).json({ success: true, creator: await submitOnboarding(token, body.data) })
  } catch (error) {
    if (error instanceof PortalError) return res.status(error.status).json({ error: error.message })
    console.error(`[public/creator] ${action} failed:`, error)
    return res.status(500).json({ error: 'Something went wrong. Try again in a minute.' })
  }
}
