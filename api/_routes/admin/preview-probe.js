/**
 * POST /api/admin/preview-probe
 *
 * Runs on a PREVIEW deployment, called by production's probe_preview tool.
 * Production sends the known finishers and its scraper overrides; this runs
 * the branch's own scraper code against the live timing sites and returns one
 * verdict per race-year. It reads and writes nothing in the database, so a
 * preview that does not share production's database still gives a real answer.
 *
 * Authenticated by PREVIEW_PROBE_SECRET only. It can do nothing but make
 * scraper requests and return what they found, so it takes a secret of its
 * own rather than borrowing an admin one.
 */
import { safeEqual } from '../../_lib/auth.js'
import { probeOne, sameTime } from '../../../server/lib/scraperHealth.js'
import { seedOverrides } from '../../../server/scrapers/scraperOverrides.js'

const MAX_TARGETS = 12
const CONCURRENCY = 3

/**
 * The stricter gate a code change has to clear.
 *
 * Production's probe matches on bib, which proves the right runner came back
 * but not that the right numbers did: a change that starts reading gun time or
 * a per-segment pace keeps the bib and passes. So on a preview a live row also
 * has to reproduce the fixture's known finish time, and its pace has to equal
 * that time over the distance run.
 */
function strictCheck(row, fixture) {
  if (row.status !== 'live') return row
  if (fixture.time && row.actualTime && !sameTime(row.actualTime, fixture.time)) {
    return { ...row, status: 'drifted', detail: `Right runner, wrong time: got ${row.actualTime}, known finish is ${fixture.time}. Gun time instead of chip?` }
  }
  if (fixture.time && !row.actualTime) {
    return { ...row, status: 'drifted', detail: `Right runner but no finish time came back; known finish is ${fixture.time}.` }
  }
  // Zero times and pace that does not fit the time are already drifted by
  // probeOne itself (numbersProblem), so production and preview agree on them.
  return row
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const secret = process.env.PREVIEW_PROBE_SECRET
  const presented = req.headers['x-preview-probe-secret']
  if (!secret || !presented || !safeEqual(presented, secret)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const targets = Array.isArray(body.targets) ? body.targets.slice(0, MAX_TARGETS) : []
    if (!targets.length) return res.status(400).json({ error: 'No targets' })

    seedOverrides(body.overrides)

    const rows = []
    const queue = [...targets]
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const t = queue.shift()
        rows.push(strictCheck(await probeOne(t.race, Number(t.year), t.fixture), t.fixture))
      }
    }))

    return res.status(200).json({ sha: process.env.VERCEL_GIT_COMMIT_SHA || null, rows })
  } catch (error) {
    console.error('[preview-probe]', error)
    return res.status(500).json({ error: 'Probe failed' })
  }
}
