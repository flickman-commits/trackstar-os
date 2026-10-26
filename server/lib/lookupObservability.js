/**
 * Observability for the public Instant Lookup endpoint.
 *
 * Three knobs:
 *   1) logLookup()  — structured one-line `[LOOKUP] …` console log per request.
 *                     Grep it in Vercel logs to see every lookup attempt.
 *   2) maybeAlertLookupError() — Slack only when a race's lookup is down for
 *                     shoppers (an outage, not one slow search). Every single
 *                     error is a LookupLog row, and the nightly sweep agent
 *                     reads those and fixes what it can (nightlySweep.js,
 *                     alertedFailureCheck), so one-off errors never ping.
 *   3) recordLookup() / getRecentLookups() — persists each lookup to Postgres
 *                     (LookupLog table) and exposes the last 200 via
 *                     /api/admin/lookups-recent. Persists because Vercel runs
 *                     /api/public/results-lookup and /api/admin/lookups-recent
 *                     as SEPARATE serverless functions — an in-memory ring
 *                     buffer in one is invisible to the other.
 */
import prisma from '../../api/_lib/prisma.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'

// An outage: in the last hour, at least OUTAGE_MIN shopper lookups for one race
// failed and they were at least half of its lookups. One ping per race per 6 hours.
const OUTAGE_WINDOW_MS = 60 * 60 * 1000
const OUTAGE_MIN = 8
const ALERT_DEDUPE_MS = 6 * 60 * 60 * 1000
const lastAlertAt = new Map() // race -> ms timestamp

/** IPs are anonymized — useful to spot a single source spamming, but we never
 * need the raw value. Names are NOT anonymized: this is an internal dashboard
 * and the full name is what makes the log line actually debuggable.
 */
function anonIp(ip) {
  if (!ip) return ''
  // IPv4: keep first 2 octets. IPv6: keep first 2 groups. Privacy + still useful for spotting one source spamming.
  if (ip.includes('.')) return ip.split('.').slice(0, 2).join('.') + '.x.x'
  if (ip.includes(':')) return ip.split(':').slice(0, 2).join(':') + ':…'
  return ip
}

/**
 * Emit one structured log line. Always call this at the END of every lookup
 * request, success or failure.
 *
 * Outcomes:
 *   found              - returned a single confirmed match
 *   suggestions        - returned candidates (ambiguous-style)
 *   not_found          - lookup ran cleanly, runner not in results
 *   off                - PUBLIC_LOOKUP_ENABLED=false (master kill switch)
 *   no_scraper         - race lookup unsupported / not public-safe
 *   rate_limited       - 429 from rate limiter
 *   bad_request        - 400 (validation)
 *   upstream_error     - the scraper threw / 5xx'd
 *   cached             - served from in-process cache
 */
export function logLookup({ race, year, name, outcome, ms, status, ip, cached }) {
  const line =
    `[LOOKUP] race="${race || ''}" year=${year ?? ''} name="${name || ''}" ` +
    `outcome=${outcome || 'unknown'} status=${status ?? ''} ms=${ms ?? ''} ` +
    `ip=${anonIp(ip)}${cached ? ' cached=true' : ''}`
  // Plain console.log so it lands in Vercel's request logs and is easy to grep.
  console.log(line)
}

/**
 * Persist the lookup attempt to Postgres. Awaited so Vercel doesn't freeze
 * the serverless function with the write still in flight — fire-and-forget
 * Promises are silently dropped when the handler returns.
 *
 * Caller should `await` this before responding to the request. Returns the
 * created row's id on success, null on failure (we still log the error but
 * never throw — the user's request must not fail because observability did).
 */
export async function recordLookup({ race, year, name, outcome, ms, status, ip, cached }) {
  try {
    const row = await prisma.lookupLog.create({
      data: {
        race: race || null,
        year: year ?? null,
        // Store the actual search query — names are not anonymized so the
        // admin "Recent Lookups" panel is useful for real debugging.
        name: (name || '').slice(0, 80),
        outcome: outcome || 'unknown',
        status: status ?? null,
        ms: ms ?? null,
        ip: anonIp(ip),
        cached: !!cached,
      }
    })
    return row.id
  } catch (err) {
    console.warn('[lookupObservability] recordLookup write failed:', err.message)
    return null
  }
}

/**
 * Returns most-recent-first list of the last N lookups from the DB.
 * @param {number} limit
 * @param {string} [race] - optional canonical race filter
 * @param {number} [sinceMs] - optional lower bound (epoch ms); only lookups at
 *                             or after this time are returned
 */
export async function getRecentLookups(limit = 200, race = null, sinceMs = null) {
  const where = {}
  if (race) where.race = race
  if (sinceMs) where.createdAt = { gte: new Date(sinceMs) }
  const rows = await prisma.lookupLog.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(500, limit)),
  })
  // Shape matches the legacy in-memory ring buffer so the admin UI doesn't
  // need to change.
  return rows.map(r => ({
    at: r.createdAt.getTime(),
    race: r.race,
    year: r.year,
    name: r.name,
    outcome: r.outcome,
    status: r.status,
    ms: r.ms,
    ip: r.ip,
    cached: r.cached,
  }))
}

/**
 * Slack, but only for an outage: when a race's Instant Lookup is failing for
 * shoppers right now (OUTAGE_MIN failures in the last hour, at least half its
 * lookups), since that loses sales before the nightly sweep runs. A single
 * slow or failed search is not a ping: it is a LookupLog row the sweep agent
 * picks up and fixes.
 *
 * @param {Object} opts
 * @param {string} opts.race        - canonical race name
 * @param {number} opts.year
 * @param {string} opts.errorType   - 'upstream_error' | 'exception' | etc.
 * @param {string} [opts.detail]    - free-text detail
 */
export async function maybeAlertLookupError({ race, year, errorType, detail }) {
  if (!race) return
  const now = Date.now()
  if (now - (lastAlertAt.get(race) || 0) < ALERT_DEDUPE_MS) return

  const slackUrl =
    process.env.SLACK_LOOKUP_WEBHOOK_URL ||
    process.env.SLACK_DM_WEBHOOK_URL ||
    process.env.SLACK_PROOF_WEBHOOK_URL
  if (!slackUrl) return

  // Shoppers only, as in the sweep: local testing logs to the same table.
  const where = { race, createdAt: { gte: new Date(now - OUTAGE_WINDOW_MS) }, ip: { notIn: ['::…', '', 'unknown'] } }
  const [failed, total] = await Promise.all([
    prisma.lookupLog.count({ where: { ...where, outcome: 'upstream_error' } }),
    prisma.lookupLog.count({ where }),
  ]).catch(() => [0, 0])
  // This request's own row is written after this check, so count it here.
  if (failed + 1 < OUTAGE_MIN || (failed + 1) / (total + 1) < 0.5) return
  lastAlertAt.set(race, now)

  const text = [
    `🔴 *Instant Lookup is down for ${race}*`,
    `${failed + 1} of ${total + 1} shopper lookups failed in the last hour, so shoppers are not seeing their result before buying.`,
    detail ? `Latest (${errorType}, ${year}): ${detail}` : null,
    `_The nightly sweep looks into it either way. One ping per race every 6 hours._`,
  ].filter(Boolean).join('\n')

  try {
    await fetchWithTimeout(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.warn('[lookupObservability] Slack alert failed:', err.message)
  }
}
