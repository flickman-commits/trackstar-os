/**
 * GET /api/cron/artelo-send - every two minutes, from Vercel cron. Sends
 * approved prints whose hold is over to Artelo production, one at a time
 * (server/domain/render/arteloSend.js). Cron only.
 *
 * Each send is about six seconds of Artelo calls. A run starts new sends for 90
 * of its 120 seconds (a slow send can take 30), about 14 prints, some 400 an hour; at 45 seconds the
 * queue fell behind on the NYC Marathon days (305 approved in an hour, 204
 * sent, 2026-11-03). The next run starts before this one ends only if Artelo
 * is slow, and each job is claimed before it is sent, so nothing goes twice.
 */
import { isCronRequest } from '../_lib/auth.js'
import { sendDue } from '../../server/domain/render/arteloSend.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await sendDue({ limit: 30, budgetMs: 90_000 })
    if (out.tried) console.log(`[cron/artelo-send] ${JSON.stringify(out)}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/artelo-send]', error)
    return res.status(500).json({ error: 'Send failed' })
  }
}
