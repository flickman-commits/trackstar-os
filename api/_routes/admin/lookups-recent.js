/**
 * GET /api/admin/lookups-recent[?race=Boston Marathon&limit=200]
 *
 * Admin-only. Returns the most recent Instant Lookup attempts from the
 * LookupLog table — visible across every serverless instance (and durable
 * across cold starts).
 *
 * Notes:
 *   - Names are anonymized at write time (e.g. "M.H.(11)").
 *   - Filter ?race=… is case-sensitive against the canonical race name.
 *   - For permanent stdout records you can also grep `[LOOKUP]` in Vercel logs.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { getRecentLookups } from '../../../server/lib/lookupObservability.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Always serve fresh — without this Vercel's edge / the browser will hand
  // back a 304 on every Refresh click and the dashboard table never updates.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')

  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 500))
  const raceFilter = (req.query.race || '').toString().trim() || null
  // Default window: last 7 days. `days=0` disables the window (all-time, capped by limit).
  const days = req.query.days !== undefined ? parseInt(req.query.days, 10) : 7
  const sinceMs = Number.isFinite(days) && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : null

  // Read from Postgres so we see lookups across every serverless instance.
  const entries = await getRecentLookups(limit, raceFilter, sinceMs)

  // Quick summary so the user doesn't have to count by hand.
  const summary = entries.reduce((acc, e) => {
    acc.total += 1
    acc.byOutcome[e.outcome] = (acc.byOutcome[e.outcome] || 0) + 1
    if (e.race) acc.byRace[e.race] = (acc.byRace[e.race] || 0) + 1
    if (typeof e.ms === 'number') { acc._msSum += e.ms; acc._msCount += 1 }
    return acc
  }, { total: 0, byOutcome: {}, byRace: {}, _msSum: 0, _msCount: 0 })
  summary.avgMs = summary._msCount ? Math.round(summary._msSum / summary._msCount) : null
  delete summary._msSum; delete summary._msCount

  return res.status(200).json({
    summary,
    windowDays: sinceMs ? days : null,
    capped: entries.length >= limit,
    entries,
    note: 'From the LookupLog table - visible across every serverless instance. For stdout records, grep [LOOKUP] in Vercel logs.',
  })
}
