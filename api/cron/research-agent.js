/**
 * GET /api/cron/research-agent - daily, from Vercel cron. Works the Action
 * queue's research items (server/domain/research/researchAgent.js): fills in
 * results read off the official page, leaves a note for a person on the rest.
 * Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { runResearchAgent } from '../../server/domain/research/researchAgent.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await runResearchAgent({ limit: 12 })
    console.log(`[cron/research-agent] ${out.summary}`)
    return res.status(200).json({ summary: out.summary, cleared: out.cleared.length, suggested: out.suggested.length, person: out.person.length })
  } catch (error) {
    console.error('[cron/research-agent]', error)
    return res.status(500).json({ error: 'Research agent failed' })
  }
}
