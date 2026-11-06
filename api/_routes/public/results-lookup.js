/**
 * Public, unauthenticated results lookup for the Shopify storefront.
 *
 *   GET /api/public/results-lookup?race=boston&year=2024&name=John+Smith
 *
 * Lets a shopper verify their race result before buying. Read-only — never
 * writes to the DB. Gated behind PUBLIC_LOOKUP_ENABLED so it stays dark until
 * we explicitly turn it on. Rate-limited per IP and cached per name+race+year.
 *
 * Every race backed by an HTTP scraper is searched live. Everything else —
 * unsupported race, no match, or any error — returns fallbackRequired:true so
 * the widget shows a manual-entry form. No dead ends.
 *
 * Shares the search core (researchService.findRunner) with admin order
 * research, so both paths get the same matching + last-name fallback quality.
 */
import { setCors } from '../../_lib/auth.js'
import { researchService } from '../../../server/services/ResearchService.js'
import { isRacePublicSafe, raceNeedsBrowser, getCanonicalRaceName } from '../../../server/scrapers/index.js'
import { parseRaceNameFromTitle } from '../../../server/scrapers/raceNameNormalization.js'
import {
  checkRateLimitDurable,
  buildCacheKey,
  getCached,
  setCached,
} from '../../../server/lib/publicRateLimit.js'
import {
  logLookup,
  recordLookup,
  maybeAlertLookupError,
} from '../../../server/lib/lookupObservability.js'

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) return String(fwd).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

// Manual-entry fallback response — always a valid, dead-end-free path.
function fallback(extra = {}) {
  return { found: false, fallbackRequired: true, instant: false, ...extra }
}

// Hard ceiling on a single lookup. Deliberately a second under the widget's
// 10s AbortController: we want to answer the shopper rather than have them
// hang up on us, because an answer gets logged and an abort doesn't.
const SERVER_LOOKUP_TIMEOUT_MS = 9000

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS', allowPublic: true })) return

  // Never cache lookup responses at the browser, CDN, or proxy layer. The
  // widget keeps its own UI state and the server has an in-process result
  // cache keyed by {race,year,name}; a separate HTTP-cached response could
  // otherwise serve a stale result when the shopper changes the year.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')

  // Kill-switch: 404 until explicitly enabled so the endpoint stays invisible.
  if (process.env.PUBLIC_LOOKUP_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' })
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const startMs = Date.now()
  const ip = getClientIp(req)
  const race = String(req.query.race || '').trim()
  const name = String(req.query.name || '').trim()
  const yearRaw = String(req.query.year || '').trim()
  const year = parseInt(yearRaw, 10)

  // Observability shorthand — emit one structured `[LOOKUP]` log line + a row
  // in the LookupLog table per request. Always `await` this before returning;
  // Vercel freezes the serverless function the moment the handler resolves, so
  // an un-awaited DB write would be silently dropped.
  const observe = async ({ outcome, status, cachedHit, raceForLog }) => {
    const ms = Date.now() - startMs
    const ent = { race: raceForLog || race, year, name, outcome, ms, status, ip, cached: !!cachedHit }
    logLookup(ent)
    await recordLookup(ent)
  }

  if (!race || !name || !yearRaw) {
    await observe({ outcome: 'bad_request', status: 400 })
    return res.status(400).json({ error: 'race, year, and name are required' })
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    await observe({ outcome: 'bad_request', status: 400 })
    return res.status(400).json({ error: 'year must be a valid 4-digit year' })
  }
  if (name.length > 80 || race.length > 80) {
    await observe({ outcome: 'bad_request', status: 400 })
    return res.status(400).json({ error: 'race and name must be under 80 characters' })
  }

  // The widget may send a raw product title/handle ("Personalized Vermont City
  // Marathon Poster") instead of a clean race name. Resolve it to the canonical
  // race so the scraper lookup matches. Idempotent on already-clean names.
  const resolvedRace = parseRaceNameFromTitle(race) || race
  // Canonical race name (e.g. "Personalized Boston Race Print" → "Boston
  // Marathon"). Used in logs so all observability rolls up by canonical name.
  const raceCanonical = getCanonicalRaceName(resolvedRace) || resolvedRace

  // Rate limit before doing any work. Durable: each lookup can be a live
  // scrape, and a per-instance counter resets on every cold start.
  const limit = await checkRateLimitDurable(ip, { bucket: 'lookup' })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    await observe({ outcome: 'rate_limited', status: 429, raceForLog: raceCanonical })
    return res.status(429).json({
      error: 'Too many lookups. Please try again later.',
      ...fallback(),
    })
  }

  // No HTTP scraper for this race → manual fallback. There used to be a second
  // gate here, a PUBLIC_LOOKUP_RACES allowlist, on the theory that a race
  // should be vetted before going live. It was removed: a race with a broken
  // scraper lands the shopper in manual entry, which is exactly where an
  // unlisted race starts, so the gate never protected an outcome. It only made
  // every rollout wait on an encrypted env var and a redeploy. Scraper health
  // is now a thing we measure and show, not a thing we gate on.
  if (!isRacePublicSafe(resolvedRace)) {
    await observe({ outcome: 'off', status: 200, raceForLog: raceCanonical })
    // Send raceCanonical even though we found no scraper. It is derived from
    // the title, not from a config, so it is the clean "Bayshore Marathon"
    // rather than the listing title the widget sent us. Omitting it left the
    // widget printing "Bayshore Marathon Personalized Race Print" on the review
    // screen and writing it to the order's Race Name property.
    return res.status(200).json(fallback({ reason: 'no_instant_lookup', raceCanonical }))
  }

  const cacheKey = buildCacheKey({ race: resolvedRace, year, name })
  const cached = getCached(cacheKey)
  if (cached) {
    await observe({ outcome: 'cached', status: 200, cachedHit: true, raceForLog: raceCanonical })
    return res.status(200).json({ ...cached, cached: true })
  }

  try {
    // The widget aborts at 10s (see the wizard block's AbortController), but
    // findRunner has its own retry budget and can run for a minute against a
    // sick timing site. Vercel keeps the function alive the whole time because
    // we're awaiting it, so we were paying for up to 300s of scraping that no
    // shopper was still waiting on — one logged run hit 64s.
    //
    // Cap just UNDER the widget's abort so the shopper gets a real JSON
    // response instead of a client-side abort, and so this lands in LookupLog
    // as a timeout we can see rather than a request that simply vanished.
    // Promise.race doesn't cancel the scrape, but returning does: Vercel
    // freezes the function the moment the handler resolves.
    const result = await Promise.race([
      // A browser-driven race gets one search and no last-name fallback. That
      // fallback is a second Chromium launch, and two of them is about ten
      // seconds against a nine second cap: the shopper would get a timeout
      // dressed up as "the timing site is down", plus an alert, on what is
      // usually just a typo. One search, then manual entry.
      researchService.findRunner(resolvedRace, year, name, {
        skipLastNameFallback: raceNeedsBrowser(resolvedRace),
      }),
      new Promise(resolve =>
        setTimeout(
          () => resolve({
            found: false,
            researchStatus: 'upstream_error',
            researchNotes: `Lookup exceeded ${SERVER_LOOKUP_TIMEOUT_MS}ms and was cut off server-side.`,
          }),
          SERVER_LOOKUP_TIMEOUT_MS
        )
      ),
    ])

    let payload, outcome
    if (result.found) {
      outcome = 'found'
      payload = {
        found: true,
        instant: true,
        raceCanonical,
        result: {
          name,
          bib: result.bibNumber,
          time: result.officialTime,
          pace: result.officialPace,
          eventType: result.eventType,
        },
      }
    } else if (result.ambiguous || (result.possibleMatches && result.possibleMatches.length > 0)) {
      outcome = 'suggestions'
      payload = {
        found: false,
        instant: true,
        raceCanonical,
        fallbackRequired: true,
        // The candidate list was trimmed upstream — let the widget prompt the
        // shopper to refine their search rather than hiding matches silently.
        truncated: result.possibleMatchesTruncated === true,
        suggestions: (result.possibleMatches || []).map(m => ({
          name: m.name,
          bib: m.bib ?? null,
          time: m.time ?? null,
          pace: m.pace ?? null,
          eventType: m.eventType ?? null,
        })),
      }
    } else if (result.researchStatus === 'time_unavailable') {
      // We know exactly who they are and we have their bib. We just cannot
      // reach the page holding the finish time, and for Sydney we never will.
      //
      // Routed through the suggestions state rather than the found state on
      // purpose. `found` promises a complete result and the widget prints the
      // time straight onto the review screen; handing it a null there would
      // show a confirmed-looking card with a blank where the time goes. The
      // suggestions card already treats bib and time as optional, so a single
      // entry reads as "this is you, now type your time" and the shopper lands
      // in manual entry with the identity settled.
      //
      // The widget has no first-class "confirmed runner, missing time" state.
      // It lives in the trackstar-theme repo. This is the honest use of what
      // is there today, not the ideal screen.
      outcome = 'time_unavailable'
      payload = {
        found: false,
        instant: true,
        raceCanonical,
        fallbackRequired: true,
        truncated: false,
        suggestions: [{
          name: result.rawData?.name || name,
          bib: result.bibNumber ?? null,
          time: null,
          pace: null,
          eventType: result.eventType ?? null,
        }],
      }
    } else if (result.researchStatus === 'upstream_error') {
      // Scraper reached its retries and the timing site is still down. Surface
      // this as an alert (throttled) — same UX as not_found for the shopper,
      // but we want to KNOW about it.
      outcome = 'upstream_error'
      maybeAlertLookupError({
        race: raceCanonical, year,
        errorType: 'upstream_error',
        detail: result.researchNotes || null,
      }).catch(() => {})
      payload = fallback({ reason: 'upstream_error', instant: true, raceCanonical })
    } else {
      outcome = 'not_found'
      payload = fallback({ reason: 'not_found', instant: true, raceCanonical })
    }

    // Never cache a failure. `found`, `suggestions` and `not_found` are facts
    // about the results themselves and hold for the hour; `upstream_error` is
    // a fact about the timing site being unwell right now. Caching it pinned
    // the error in place for an hour per name+race+year, so a site that
    // recovered in two minutes still looked broken to the next shopper who
    // searched the same runner. The 9s server cap above makes that much easier
    // to trip, since "slow" now lands here too.
    // "Not posted yet" changes the moment the timer posts (resultsWatch.js),
    // so it is not a fact to hold for the hour.
    const pending = /has not posted the official/.test(result.researchNotes || '')
    if (outcome !== 'upstream_error' && !pending) setCached(cacheKey, payload)
    await observe({ outcome, status: 200, raceForLog: raceCanonical })
    return res.status(200).json(payload)
  } catch (error) {
    console.error('[public/results-lookup] lookup failed:', error.message)
    // Unhandled exception — alert (throttled).
    maybeAlertLookupError({
      race: raceCanonical, year,
      errorType: 'exception',
      detail: error.message,
    }).catch(() => {})
    await observe({ outcome: 'upstream_error', status: 200, raceForLog: raceCanonical })
    return res.status(200).json(fallback({ reason: 'lookup_error' }))
  }
}
