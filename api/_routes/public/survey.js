/**
 * /api/public/survey - Design Survey, the voter side. The link is the only
 * credential: anyone with /vote/{token} can see the options and vote once.
 *
 *   GET  ?token=&voter=       the options, and this browser's vote if any
 *   POST { token, voterId, optionId, comment? }   cast or change a vote
 *
 * Counts are never returned here, so early votes do not steer later ones.
 * Never returns error.message.
 */
import { setCors } from '../../_lib/auth.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'
import { publicSurvey, castVote } from '../../../server/domain/surveys/surveys.js'

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0]).trim() || req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS', allowPublic: true })) return
  const ip = clientIp(req)
  const limit = await checkRateLimitDurable(ip, { bucket: req.method === 'POST' ? 'survey_vote' : 'survey_view', max: req.method === 'POST' ? 30 : 120 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'rate_limited' })
  }

  try {
    if (req.method === 'GET') {
      const token = String(req.query?.token || '')
      if (!token || token.length > 40) return res.status(404).json({ error: 'not_found' })
      const s = await publicSurvey(token, req.query?.voter)
      return s ? res.status(200).json(s) : res.status(404).json({ error: 'not_found' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const token = String(body.token || '')
    if (!token || token.length > 40) return res.status(404).json({ error: 'not_found' })
    await castVote(token, { voterId: body.voterId, optionId: body.optionId, comment: body.comment, ip })
    return res.status(200).json({ ok: true })
  } catch (error) {
    if (error?.code && ['not_found', 'closed', 'bad_option', 'bad_voter'].includes(error.message)) {
      return res.status(error.code).json({ error: error.message })
    }
    console.error('[API /public/survey]', error)
    return res.status(500).json({ error: 'server_error' })
  }
}
