/**
 * Public, unauthenticated "does this race have an instant lookup?" probe.
 *
 *   GET /api/public/race-status?race=Bayshore+Marathon+Personalized+Race+Print
 *   -> { hasLookup: false, raceCanonical: "Bayshore Marathon", raceDates: { "2026": "2026-05-23" } }
 *
 * The storefront wizard calls this once when it initialises, so it knows which
 * flow it is running BEFORE the shopper types anything. Without it the widget
 * had to submit a real lookup to discover a race has no scraper, which showed a
 * spinner and a pause on its way to a manual-entry flow that was never in doubt.
 *
 * Deliberately does no scraping and touches no upstream timing site: it reads
 * the deployed race configs and returns. That makes it far cheaper than
 * results-lookup, so it gets its own rate-limit bucket with a much higher
 * ceiling (sharing the scraper's 20/hour would let a few product-page views
 * exhaust a shopper's real lookup budget) and a CDN cache, since the answer
 * only changes when we deploy a new config.
 */
import { setCors } from '../_lib/auth.js'
import { isRacePublicSafe, getCanonicalRaceName, getCoveredYears, getRaceDatesForRace } from '../../server/scrapers/index.js'
import { parseRaceNameFromTitle } from '../../server/scrapers/raceNameNormalization.js'
import { checkRateLimitDurable } from '../../server/lib/publicRateLimit.js'

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) return String(fwd).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS', allowPublic: true })) return

  // Kill-switch shared with results-lookup: if lookups are dark, so is this.
  // The widget treats a failed probe as "unknown" and falls back to asking
  // results-lookup directly, which is the behaviour it had before this existed.
  if (process.env.PUBLIC_LOOKUP_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' })
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const race = String(req.query.race || '').trim()
  if (!race) {
    return res.status(400).json({ error: 'race is required' })
  }
  if (race.length > 80) {
    return res.status(400).json({ error: 'race must be under 80 characters' })
  }

  // One product page view per shopper is the normal case; the ceiling only has
  // to stop somebody scripting it.
  const limit = await checkRateLimitDurable(getClientIp(req), { bucket: 'race-status', max: 300 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'Too many requests' })
  }

  // Same resolution chain results-lookup uses, so both agree on what a product
  // title means. `raceCanonical` is useful even with no scraper: it is the
  // clean race name ("Bayshore Marathon") rather than the listing title
  // ("Bayshore Marathon Personalized Race Print"), which is what belongs on the
  // order and the poster.
  const resolvedRace = parseRaceNameFromTitle(race) || race
  const raceCanonical = getCanonicalRaceName(resolvedRace) || resolvedRace

  // Safe to cache: the answer is a function of the deployed config, not of the
  // shopper. A new race scraper ships with a deploy, which busts this anyway.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600')

  return res.status(200).json({
    hasLookup: isRacePublicSafe(resolvedRace),
    // The years we can definitely look up, or null when any year is derivable
    // (a {year}-pattern config). The storefront uses this to skip the search for
    // a year that is genuinely outside an explicit-id race's map.
    coveredYears: getCoveredYears(resolvedRace),
    raceCanonical,
    // Verified race days, year -> "YYYY-MM-DD", or null. The storefront shows
    // a pre-order message for a year whose race day is still ahead and drops
    // it on race day by comparing dates in the browser, so nothing here has
    // to change when a race happens. Public information (it is on every race's
    // own site), and it comes from the deployed config like everything else
    // in this response, so the CDN cache above still holds.
    raceDates: getRaceDatesForRace(resolvedRace),
  })
}
