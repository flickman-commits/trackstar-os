/**
 * ResearchService - Two-Tier Caching for Race Data
 *
 * Tier 1: Race-level data (cached once per race/year)
 *   - Race date, location, weather, event types
 *   - Stored in Race table
 *
 * Tier 2: Runner-level data (cached per runner)
 *   - Bib number, finish time, pace
 *   - Stored in RunnerResearch table
 */
import { paceFromTypedTime } from '../domain/research/customerPace.js'
import prisma from '../db.js'
import { getScraperForRace, hasScraperForRace, getCanonicalRaceName, namedEventsFor } from '../scrapers/index.js'
import { ensureOverridesLoaded } from '../scrapers/scraperOverrides.js'
import WeatherService from './WeatherService.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'


/**
 * Race distance in miles for an event type, or null when we cannot be sure.
 *
 * Pace is just time over distance, so a missing pace is always recoverable -
 * but only if the distance is right. It cannot come from the race config:
 * plenty of these events run several distances off one results page (Austin
 * lists a marathon, a half and a 5K), so config.distanceMiles would hand a
 * half-marathoner a marathon pace, which is nearly double and looks perfectly
 * reasonable printed on a poster.
 *
 * The event type is the only thing that actually says how far this runner ran,
 * so that is what this keys on. Anything unrecognised returns null and the
 * pace stays empty, which is the honest answer and the one Eli can spot.
 */
const EVENT_DISTANCE_MILES = {
  'marathon': 26.2,
  'half marathon': 13.1,
  'half': 13.1,
  '10 miler': 10,
  '10k': 6.2137,
  '8k': 4.9710,
  '5k': 3.1069,
}

export function distanceForEventType(eventType) {
  if (!eventType) return null
  return EVENT_DISTANCE_MILES[String(eventType).trim().toLowerCase()] ?? null
}

/** Minutes-per-mile for a finish time, or null if we cannot say. */
export function derivePace(officialTime, eventType) {
  const miles = distanceForEventType(eventType)
  if (!officialTime || !miles) return null
  const parts = String(officialTime).split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  const seconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts.length === 2 ? parts[0] * 60 + parts[1] : null
  if (!seconds) return null
  const perMile = Math.round(seconds / miles)
  return `${Math.floor(perMile / 60)}:${String(perMile % 60).padStart(2, '0')}`
}

const weatherService = new WeatherService()

/** The marathon itself, which never has a named variant. */
const isMainEventType = (e) => /^marathon$/i.test(String(e || '').trim())

// What a timeout, a dropped connection or a sick server looks like in an error
// message or a scraper's note. A 4xx other than 408/429 is left alone: that is
// a config problem (wrong event id), which the scrapers already call not_found.
const NETWORK_FAILURE = /\b(?:timed?\s?out|timeout|aborted|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_\w+|fetch failed|socket hang up|network error|HTTP (?:5\d\d|408|429))\b/i

/**
 * Was this "not found" really a failed search?
 *
 * Several scrapers catch their own errors and hand back notFoundResult() with
 * the message in the notes ("Error: fetch failed"), and some report a 5xx or a
 * timeout in the notes of a not_found. Research used to store those as "Runner
 * not found", which sends a person off to check the spelling of a name that
 * was never searched. A real no-match has no error in its notes; a result with
 * candidates is an answer, whatever its notes say.
 * @param {Object} result - a scraper result
 * @returns {boolean}
 */
export function isFailedSearch(result) {
  if (!result || result.found || result.ambiguous) return false
  if (result.researchStatus === 'upstream_error') return true
  if (result.researchStatus && result.researchStatus !== 'not_found') return false
  if (Array.isArray(result.possibleMatches) && result.possibleMatches.length > 0) return false
  const notes = String(result.researchNotes || '')
  return /^Error:/i.test(notes) || NETWORK_FAILURE.test(notes)
}

/** A thrown error that means the site did not answer, not a bug in our code. */
function isNetworkError(err) {
  if (!err) return false
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  return NETWORK_FAILURE.test(`${err.message || ''} ${err.code || ''} ${err.cause?.code || ''} ${err.cause?.message || ''}`)
}

/**
 * The result research records when the results site could not be searched:
 * upstream_error, which the order shows as "Timing site down, run research
 * again", never "Runner not found".
 */
function upstreamError(raceName, year, detail) {
  return {
    found: false,
    bibNumber: null,
    officialTime: null,
    officialPace: null,
    eventType: null,
    yearFound: year,
    researchStatus: 'upstream_error',
    researchNotes: `The ${raceName} ${year} results site could not be reached${detail ? ` (${detail})` : ''}, so the runner was not looked up. Run research again.`,
    possibleMatches: null,
  }
}

/** A short reason from a scraper note or an error, for upstreamError(). */
function failureDetail(text) {
  const t = String(text || '').replace(/^Error:\s*/i, '').trim()
  const m = t.match(NETWORK_FAILURE)
  return (m ? m[0] : t).slice(0, 80) || null
}

export class ResearchService {

  /** The scraper for a race. A method so a test can hand in a stub. */
  scraperFor(raceName, year) {
    return getScraperForRace(raceName, year)
  }

  /** Load dashboard event-id overrides. A method so a test can skip the database. */
  loadOverrides() {
    return ensureOverridesLoaded()
  }

  /**
   * One scraper search that never reports a failed search as a no-match: a
   * thrown network error, or a not_found that is really an error, comes back
   * as upstream_error. Any other throw (a bug) still throws.
   */
  async searchOnce(scraper, raceName, year, query) {
    let result
    try {
      result = await scraper.searchRunner(query)
    } catch (err) {
      if (!isNetworkError(err)) throw err
      console.warn(`[ResearchService] ${raceName} ${year} search failed: ${err.message}`)
      return upstreamError(raceName, year, failureDetail(err.message || err.name))
    }
    if (isFailedSearch(result) && result.researchStatus !== 'upstream_error') {
      console.warn(`[ResearchService] ${raceName} ${year} search failed, not a no-match: ${result.researchNotes}`)
      return upstreamError(raceName, year, failureDetail(result.researchNotes))
    }
    return result
  }

  /**
   * Main entry point - research an order
   * Handles both race-level and runner-level data fetching with caching
   * Uses override values if present, otherwise falls back to original data
   * @param {string} orderNumber - The orderNumber (parentOrderNumber-lineItemIndex format)
   * @returns {Promise<Object>} Combined race and runner research results
   */
  /**
   * @param {string} orderNumber
   * @param {{ force?: boolean }} [opts]  force: search again even when a result
   *   is saved (a person clicked Research runner after editing the order).
   */
  async researchOrder(orderNumber, { force = false } = {}) {
    const order = await prisma.order.findFirst({
      where: { orderNumber }
    })

    if (!order) {
      throw new Error(`Order not found: ${orderNumber}`)
    }

    // Use effective values (override if present, else original)
    const effectiveRaceName = order.raceNameOverride ?? order.raceName
    const effectiveRaceYear = order.yearOverride ?? order.raceYear
    const effectiveRunnerName = order.runnerNameOverride ?? order.runnerName

    if (!effectiveRunnerName) {
      throw new Error('Order is missing runner name')
    }

    if (!effectiveRaceYear) {
      throw new Error('Order is missing race year')
    }

    // No scraper for this race → record it as a research record with status
    // 'no_scraper' so the dashboard can surface it clearly, AND fire a Slack
    // alert so we know to add scraper support.
    if (!hasScraperForRace(effectiveRaceName)) {
      await this._notifyMissingScraper({
        kind: 'no_scraper',
        race: effectiveRaceName,
        year: effectiveRaceYear,
        orderNumber,
        runner: effectiveRunnerName,
      })
      // Throw so the caller knows research couldn't run; the API endpoint
      // converts this into a 400 response with `supportedRaces`.
      throw new Error(`No scraper available for race: ${effectiveRaceName}`)
    }

    console.log(`[ResearchService] Starting research for order ${orderNumber}`)
    console.log(`[ResearchService] Race: ${effectiveRaceName} ${effectiveRaceYear}, Runner: ${effectiveRunnerName}`)
    if (order.yearOverride || order.raceNameOverride || order.runnerNameOverride) {
      console.log(`[ResearchService] Using overrides - Year: ${order.yearOverride}, Race: ${order.raceNameOverride}, Runner: ${order.runnerNameOverride}`)
    }

    // TIER 1: Get or fetch race-level data (use effective values)
    const race = await this.getOrFetchRaceData(effectiveRaceName, effectiveRaceYear)

    // The race has not been run yet, so no results can exist. Record that
    // plainly instead of scraping and coming back "not found", which reads like
    // a data problem and sends someone hunting for a result that cannot exist.
    if (race?.raceDate && new Date(race.raceDate) > new Date()) {
      const raceDay = new Date(race.raceDate).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      })
      console.log(`[ResearchService] ${effectiveRaceName} ${effectiveRaceYear} is on ${raceDay}, skipping runner scrape`)

      const notRunData = {
        orderId: order.id,
        raceId: race.id,
        runnerName: effectiveRunnerName,
        bibNumber: null, officialTime: null, officialPace: null,
        researchStatus: 'race_not_run',
        researchNotes: `${effectiveRaceName} ${effectiveRaceYear} takes place on ${raceDay}. Results will not exist until after race day.`,
        possibleMatches: null,
      }
      const existing = await prisma.runnerResearch.findFirst({
        where: { orderId: order.id, raceId: race.id }
      })
      const runnerResearch = existing
        ? await prisma.runnerResearch.update({ where: { id: existing.id }, data: notRunData })
        : await prisma.runnerResearch.create({ data: notRunData })

      return { race, runnerResearch, order }
    }

    // TIER 2: Get or fetch runner-level data (pass effective values)
    const runnerResearch = await this.getOrFetchRunnerData(order, race, {
      effectiveRaceName,
      effectiveRaceYear,
      effectiveRunnerName
    }, { force })

    return {
      race,
      runnerResearch,
      order
    }
  }

  /**
   * Use the CUSTOMER'S OWN runner data instead of scraping for it.
   *
   * Two cases arrive here, and the difference is only how much we trust the
   * numbers - not whether we use them:
   *
   *   verified: true  - the shopper confirmed an official-results match in the
   *                     Instant Lookup widget (Order.lookupVerified === true).
   *   verified: false - the shopper typed the numbers, or edited what the
   *                     widget found (lookupOutcome 'edited_by_customer' and
   *                     friends). Their numbers are still the ones going on the
   *                     poster, so scraping for a "better" answer is not just
   *                     wasted work, it is actively harmful: on a common
   *                     surname the scrape comes back with a list of strangers
   *                     and the order lands in the queue looking unresolved.
   *
   * Either way we STILL fetch race-level data (Tier 1: date, location,
   * weather) because the poster needs it and the customer does not supply it.
   * That fetch is best-effort, with a minimal Race fallback so the runner data
   * always lands.
   *
   * Produces a RunnerResearch row with researchStatus='found' and marks the
   * order 'ready'. `source` records which of the two it was, so the dashboard
   * can be honest about where the numbers came from.
   *
   * @param {string} orderNumber
   * @param {Object} [opts]
   * @param {boolean} [opts.verified=true] - false for typed/edited entries
   * @returns {Promise<Object>} { race, runnerResearch, order }
   */
  async applyVerifiedResult(orderNumber, { verified = true } = {}) {
    const order = await prisma.order.findFirst({ where: { orderNumber } })
    if (!order) throw new Error(`Order not found: ${orderNumber}`)

    const effectiveRaceName = order.raceNameOverride ?? order.raceName
    const effectiveRaceYear = order.yearOverride ?? order.raceYear
    const effectiveRunnerName = order.runnerNameOverride ?? order.runnerName

    if (!effectiveRunnerName) throw new Error('Order is missing runner name')
    if (!effectiveRaceYear) throw new Error('Order is missing race year')

    // TIER 1: race-level data (date/location/weather). Best-effort — a scrape
    // failure must not block the verified runner data from being recorded.
    let race = null
    try {
      if (hasScraperForRace(effectiveRaceName)) {
        race = await this.getOrFetchRaceData(effectiveRaceName, effectiveRaceYear)
      }
    } catch (err) {
      console.warn(`[ResearchService] Verified-path race fetch failed for ${orderNumber}: ${err.message}`)
    }
    if (!race) {
      // Minimal race row so RunnerResearch (which requires raceId) can be written.
      race = await this.findOrCreateRaceRow(effectiveRaceName, effectiveRaceYear, {
        eventTypes: order.customerEventType ? [order.customerEventType] : ['Marathon'],
      })
    }

    // A customer who typed a time but no pace gets the pace worked out from
    // their time and the event's distance (customerPace.js). Their time is
    // used exactly as given; only the missing pace is filled in.
    const derivedPace = order.customerPace ? null : paceFromTypedTime(order.customerFinishTime, order.customerEventType)

    // TIER 2 (replaced): write the customer-confirmed result.
    const researchData = {
      orderId: order.id,
      raceId: race.id,
      runnerName: effectiveRunnerName,
      bibNumber: order.customerBib || null,
      officialTime: order.customerFinishTime || null,
      officialPace: order.customerPace || derivedPace || null,
      eventType: order.customerEventType || null,
      yearFound: effectiveRaceYear,
      researchStatus: 'found',
      source: verified ? 'customer_verified' : 'customer_supplied',
      researchNotes: verified
        ? 'Customer-confirmed via Instant Lookup (matched official results)'
        : `Entered by the customer at checkout, not matched against official results. Their numbers, used as given.${derivedPace ? ` Pace ${derivedPace} calculated from their time.` : ''}`,
      resultsUrl: race.resultsUrl || null,
      possibleMatches: null,
    }

    const existing = await prisma.runnerResearch.findFirst({
      where: { orderId: order.id, raceId: race.id }
    })
    let runnerResearch
    if (existing) {
      runnerResearch = await prisma.runnerResearch.update({ where: { id: existing.id }, data: researchData })
    } else {
      runnerResearch = await prisma.runnerResearch.create({ data: researchData })
    }

    // A shipped order keeps its status; the record is still worth having so
    // it reads the same as every other order.
    await prisma.order.update({
      where: { id: order.id },
      data: order.status === 'completed' ? { researchedAt: order.researchedAt || new Date() } : { status: 'ready', researchedAt: new Date() }
    })

    console.log(`[ResearchService] Applied ${verified ? 'customer-verified' : 'customer-supplied'} result for ${orderNumber} (bib ${researchData.bibNumber}, ${researchData.officialTime})`)
    return { race, runnerResearch, order }
  }

  /**
   * TIER 1: Get race-level data from cache or fetch from scraper
   * @param {string} raceName
   * @param {number} year
   * @returns {Promise<Object>} Race record
   */
  /**
   * The race row for a race-year, found by either its exact name or its
   * canonical one, and created under the canonical one.
   *
   * Rows used to be keyed on whatever name the order carried, so "NYC
   * Marathon" and "New York City Marathon" became two rows for the same race,
   * with orders split between them. That is how Eli's NYC 2019 order landed on
   * a brand-new row with no date while the older row for the same race already
   * held the right one. Existing rows keep their names; only new ones are
   * canonical, so nothing already linked moves.
   *
   * No date is written when none is known. The old code stored January 1st as
   * a stand-in, which then got weather computed for it and printed on posters
   * as if it were real. A null date is visible; a fake one is not.
   */
  async findOrCreateRaceRow(raceName, year, extra = {}) {
    const canonical = getCanonicalRaceName(raceName) || raceName
    let race = await prisma.race.findUnique({ where: { raceName_year: { raceName, year } } })
    if (!race && canonical !== raceName) {
      race = await prisma.race.findUnique({ where: { raceName_year: { raceName: canonical, year } } })
    }
    if (!race) {
      race = await prisma.race.create({
        data: { raceName: canonical, year, raceDate: null, eventTypes: ['Marathon'], ...extra },
      })
    }
    return race
  }

  async getOrFetchRaceData(raceName, year) {
    // Check cache first, under either name for the reasons in findOrCreateRaceRow.
    const canonical = getCanonicalRaceName(raceName) || raceName
    let race = await prisma.race.findUnique({ where: { raceName_year: { raceName, year } } })
    if (!race && canonical !== raceName) {
      race = await prisma.race.findUnique({ where: { raceName_year: { raceName: canonical, year } } })
    }

    // If we have complete race data (including resultsUrl), return it
    if (race && race.raceDate && race.location && race.resultsUrl) {
      console.log(`[ResearchService] Race data found in cache: ${raceName} ${year}`)
      return race
    }

    // Fetch from scraper
    console.log(`[ResearchService] Fetching race data for: ${raceName} ${year}`)
    // Dashboard event-id overrides live in a cache that only applies if
    // someone loaded it. Until this call was here, only the repair tools
    // loaded it, so a fix made in the UI never reached order research or the
    // storefront lookup. Cached for 60s; cheap on a warm instance.
    await ensureOverridesLoaded()
    const scraper = getScraperForRace(raceName, year)
    const raceInfo = await scraper.getRaceInfo()

    // Prepare race data
    const raceData = {
      raceName: race ? race.raceName : canonical,
      year,
      // Null when unknown. Never a stand-in date - see findOrCreateRaceRow.
      raceDate: raceInfo.raceDate || null,
      // Provenance, so the sweep can tell a verified date from a leftover. A
      // scraper that reads the date off the results page is the best source we
      // have; a config pin is a date someone checked by hand and wrote down.
      raceDateSource: raceInfo.raceDate ? (raceInfo.raceDateScraped ? 'scraped' : 'config') : null,
      location: raceInfo.location || null,
      eventTypes: raceInfo.eventTypes || ['Marathon'],
      resultsUrl: raceInfo.resultsUrl || null,
      resultsSiteType: raceInfo.resultsSiteType || null,
    }

    if (race) {
      // Fill the gaps, never overwrite what is already there.
      //
      // This used to write raceData wholesale, which quietly undid manual
      // corrections. The cache check above needs raceDate AND location AND
      // resultsUrl to all be present, so a race missing any one of them - CIM
      // 2024, 2025 and 2026 all had no location - re-fetched on every single
      // research call and stamped the config's values back over the row. Eli
      // fixed a CIM date by hand, the next lookup on that race put the wrong
      // one back, and from the outside the tool looks like it is corrupting
      // its own data.
      //
      // A person editing a race date or a city is making a deliberate
      // correction to something we got wrong. It outranks anything the config
      // can tell us, so only absent fields get written.
      const gapFill = {}
      for (const [key, value] of Object.entries(raceData)) {
        const current = race[key]
        const isEmpty = current === null || current === undefined
          || (Array.isArray(current) && current.length === 0)
        if (isEmpty && value !== null && value !== undefined) gapFill[key] = value
      }

      if (Object.keys(gapFill).length > 0) {
        race = await prisma.race.update({ where: { id: race.id }, data: gapFill })
        console.log(`[ResearchService] Filled missing race fields (${Object.keys(gapFill).join(', ')}): ${race.id}`)
      } else {
        console.log(`[ResearchService] Race record already complete, left as is: ${race.id}`)
      }
    } else {
      // Create new race record
      race = await prisma.race.create({
        data: raceData
      })
      console.log(`[ResearchService] Created race record: ${race.id}`)
    }

    // Automatically fetch weather if not already cached
    if (!race.weatherFetchedAt && race.raceDate && race.location) {
      console.log(`[ResearchService] Auto-fetching weather for race ${race.id}`)
      race = await this.fetchWeatherForRace(race.id)
    }

    return race
  }

  /**
   * Fetch weather data for a race (if not already fetched)
   * Uses historical weather API based on race date and location
   * @param {number} raceId
   * @returns {Promise<Object>} Updated race with weather
   */
  async fetchWeatherForRace(raceId) {
    const race = await prisma.race.findUnique({
      where: { id: raceId }
    })

    if (!race) {
      throw new Error(`Race not found: ${raceId}`)
    }

    // Skip if weather already fetched
    if (race.weatherFetchedAt) {
      console.log(`[ResearchService] Weather already cached for race ${raceId}`)
      return race
    }

    // Skip if we don't have date/location
    if (!race.raceDate || !race.location) {
      console.log(`[ResearchService] Cannot fetch weather - missing date or location`)
      return race
    }

    console.log(`[ResearchService] Fetching weather for ${race.raceName} ${race.year}`)

    try {
      const weather = await this.getHistoricalWeather(race.raceDate, race.location)

      return await prisma.race.update({
        where: { id: raceId },
        data: {
          weatherTemp: weather.temp,
          weatherCondition: weather.condition,
          weatherFetchedAt: new Date()
        }
      })
    } catch (error) {
      console.error(`[ResearchService] Weather fetch failed:`, error.message)
      return race
    }
  }

  /**
   * Get historical weather for a date and location
   * Uses Open-Meteo API via WeatherService
   * @param {Date} date
   * @param {string} location
   * @returns {Promise<Object>} { temp, condition }
   */
  async getHistoricalWeather(date, location) {
    return await weatherService.getHistoricalWeather(date, location)
  }

  /**
   * Search for a runner's result — the shared, DB-free search core.
   *
   * Does NOT touch the database, so it's safe to call from any context (order
   * research, the public storefront lookup, ad-hoc scripts). Order research
   * wraps this with caching + persistence; the public endpoint calls it directly.
   *
   * Applies three layers of matching:
   *   1. Direct scraper search on the full name.
   *   2. Promote close-but-inexact candidates to 'ambiguous' (so a picker shows).
   *   3. Last-name-only fallback when the full name misses entirely.
   *
   * @param {string} raceName - Race name (alias/fuzzy names are resolved)
   * @param {number} year - Race year
   * @param {string} runnerName - Full name to search for
   * @param {Object} [opts]
   * @param {boolean} [opts.skipLastNameFallback] - Skip step 3. The fallback is
   *   a second full search, which on a browser-driven platform means a second
   *   Chromium launch and roughly doubles the wall clock. Callers on a deadline
   *   (the public endpoint, 9s) turn it off rather than blow the budget and
   *   report a timeout as if the timing site were down.
   * @param {string|null} [opts.bib] - A bib known for this order (typed in by
   *   a person on the research row, or the customer's). When the name search
   *   finds nobody, or several people none of whom wear this bib, the runner
   *   is looked up by bib instead (scraper.searchRunnerByBib). The official
   *   name it returns is recorded in the notes only; the order's name stays
   *   what gets printed.
   * @returns {Promise<Object>} Normalized scraper result (found, ambiguous,
   *   possibleMatches, bibNumber, officialTime, officialPace, eventType,
   *   researchStatus, researchNotes, rawData, ...)
   */
  async findRunner(raceName, year, runnerName, { skipLastNameFallback = false, bib = null } = {}) {
    console.log(`[ResearchService] Searching for runner: ${runnerName}`)
    // Dashboard event-id overrides live in a cache that only applies if
    // someone loaded it. Until this call was here, only the repair tools
    // loaded it, so a fix made in the UI never reached order research or the
    // storefront lookup. Cached for 60s; cheap on a warm instance.
    await this.loadOverrides()
    const scraper = this.scraperFor(raceName, year)
    let results = await this.searchOnce(scraper, raceName, year, runnerName)

    // Candidates that did not pass namesMatch are SUGGESTIONS, not matches.
    //
    // This used to relabel them 'ambiguous', which put "More than one match -
    // pick the right runner" above a list of people who are not the customer.
    // Sydney 2026 order 3858 searched for Jesus Perez and offered Oscar Perez
    // Araujo, Maria Elba Alvarez Perez and three other Perezes: the surname is
    // all they share. Telling someone to pick one of those is how a stranger's
    // name ends up printed on a poster, which is the same failure as the
    // Baxter mix-up, just routed through a person instead of an auto-accept.
    //
    // The status stays not_found, because that is what happened. The
    // candidates still ride along and the picker still renders - they are
    // genuinely useful when the customer typed "Jim" and the results say
    // "James" - but the screen now has to ask for a confirmation rather than a
    // choice. Real ambiguity, where several finishers truly share the name,
    // still comes back from the scraper as ambiguous and is untouched here.
    if (!results.found && !results.ambiguous && results.possibleMatches?.length > 0) {
      console.log(`[ResearchService] ${results.possibleMatches.length} near-name suggestions (not a match)`)
      results.researchStatus = 'not_found'
      results.researchNotes = `No match for "${runnerName}". ${results.possibleMatches.length} runner${results.possibleMatches.length > 1 ? 's' : ''} with a similar name - confirm before accepting.`
    }

    // Last-name fallback: if full name not found AND no candidates surfaced yet,
    // try searching by last name only. This catches the rare case where the
    // upstream search itself didn't even return the runner because the FIRST
    // name doesn't match what the upstream indexes.
    //
    // Only when the search genuinely came back empty. Any other status means
    // we already know something: 'time_unavailable' means we matched the
    // person and only the clock is missing, and 'upstream_error' means the
    // site failed rather than the runner being absent. Falling back in those
    // cases is how every Sydney order ended up showing a list of unrelated
    // people who happen to share a surname - the search had already found the
    // right runner, and we discarded them to go ask a worse question.
    if (!skipLastNameFallback && results.researchStatus === 'not_found' && !results.found && !results.ambiguous) {
      const nameParts = runnerName.trim().split(/\s+/)
      if (nameParts.length >= 2) {
        const lastName = nameParts[nameParts.length - 1]
        console.log(`[ResearchService] Full name not found, trying last name only: "${lastName}"`)
        const fallbackScraper = this.scraperFor(raceName, year)
        const fallbackResults = await this.searchOnce(fallbackScraper, raceName, year, lastName)

        if (fallbackResults.found) {
          // Single exact match found by last name — use it but note the fallback
          const foundName = fallbackResults.rawData?.name
            || `${fallbackResults.rawData?.firstName || ''} ${fallbackResults.rawData?.lastName || ''}`.trim()
            || lastName
          console.log(`[ResearchService] Found via last name fallback: ${foundName}`)
          fallbackResults.researchNotes = `Found as "${foundName}" (searched by last name "${lastName}")`
          results = fallbackResults
        } else if (fallbackResults.ambiguous || fallbackResults.possibleMatches?.length > 0) {
          // Surname-only hits are suggestions by construction: we deliberately
          // threw the first name away to get them. Same reasoning as above -
          // surface them, but never as "matches".
          console.log(`[ResearchService] Last-name fallback surfaced ${fallbackResults.possibleMatches?.length || 0} suggestions`)
          results = fallbackResults
          results.ambiguous = false
          results.researchStatus = 'not_found'
          results.researchNotes = `No match for "${runnerName}". Found ${fallbackResults.possibleMatches?.length || 'multiple'} runner(s) sharing the last name "${lastName}" - confirm before accepting.`
        } else if (fallbackResults.researchStatus === 'upstream_error') {
          // The site stopped answering partway through. The search is not
          // finished, so this is not a "not found": record the failure and
          // let research run again rather than settle on a half-done answer.
          console.log(`[ResearchService] Last name fallback could not reach the results site`)
          results = fallbackResults
        } else {
          console.log(`[ResearchService] Last name fallback also returned no results`)
        }
      }
    }

    // Bib fallback. A person who could not find the runner by name (a maiden
    // name, a typo, a nickname the timer does not know) can type the bib in
    // by hand, and the bib is the more reliable key anyway. Only when the name
    // search settled nothing: not after an upstream error, and not when one of
    // several same-name candidates already wears this bib.
    const wantedBib = bib != null ? String(bib).trim() : ''
    const candidates = results.possibleMatches || results.matches || []
    const bibAmongCandidates = candidates.some(m => m?.bib != null && String(m.bib).trim() === wantedBib)
    const nameSettledNothing = !results.found && (
      results.researchStatus === 'not_found' || (results.ambiguous && !bibAmongCandidates)
    )
    if (wantedBib && nameSettledNothing && typeof scraper.searchRunnerByBib === 'function') {
      try {
        const byBib = await scraper.searchRunnerByBib(wantedBib)
        // The scraper promises an exact bib match; check anyway, because a
        // wrong runner here prints a stranger's time on someone's poster.
        if (byBib?.found && String(byBib.bibNumber || '').trim() === wantedBib) {
          const officialName = byBib.runnerName || byBib.rawData?.name || null
          console.log(`[ResearchService] Matched by bib ${wantedBib}: ${officialName || 'unnamed'}`)
          byBib.researchNotes = [
            `Matched by bib ${wantedBib} because the name "${runnerName}" did not match`
              + (officialName ? `; the official results list this bib as "${officialName}".` : '.'),
            byBib.researchNotes,
          ].filter(Boolean).join(' ')
          byBib.matchedByBib = true
          byBib.officialName = officialName
          results = byBib
        } else if (byBib === null) {
          console.log(`[ResearchService] ${raceName} platform cannot search by bib`)
        } else {
          console.log(`[ResearchService] Bib ${wantedBib} lookup: ${byBib?.researchStatus || 'no match'}`)
          if (byBib?.researchStatus === 'not_found' && results.researchStatus === 'not_found') {
            results.researchNotes = `${results.researchNotes || ''} Bib ${wantedBib} was also looked up and is not in the results.`.trim()
          }
        }
      } catch (e) {
        console.warn(`[ResearchService] Bib lookup failed for ${wantedBib}: ${e.message}`)
      }
    }

    // Suggestions come straight from each platform's list page, and most
    // platforms send a name and a time with no pace. A shopper who picks one
    // then sees a card with a gap where the pace should be. Pace is chip time
    // over the event distance whoever computes it, so fill it here once for
    // every platform rather than in nineteen scrapers.
    // Distance comes from the row, else the race's own default event. Never a
    // blanket "Marathon": guessing wrong halves or doubles the pace, which is
    // worse than showing none.
    const defaultEvent = scraper?.config?.defaultEventType || null
    if (Array.isArray(results.possibleMatches)) {
      results.possibleMatches = results.possibleMatches.map(m => {
        if (!m || m.pace || !m.time) return m
        const pace = derivePace(m.time, m.eventType || defaultEvent)
        return pace ? { ...m, pace } : m
      })
    }
    if (results.found && !results.officialPace && results.officialTime) {
      results.officialPace = derivePace(results.officialTime, results.eventType || defaultEvent)
    }

    return results
  }

  /**
   * TIER 2: Get runner data from cache or fetch from scraper
   * @param {Object} order - Order with runnerName, raceName, raceYear
   * @param {Object} race - Race record
   * @param {Object} effectiveValues - Override values to use for search
   * @param {{ force?: boolean }} [opts] - force: skip the saved result and search again
   * @returns {Promise<Object>} RunnerResearch record
   */
  async getOrFetchRunnerData(order, race, effectiveValues = {}, { force = false } = {}) {
    // Use effective values if provided, otherwise fall back to order values
    const raceName = effectiveValues.effectiveRaceName ?? order.raceName
    const raceYear = effectiveValues.effectiveRaceYear ?? order.raceYear
    const runnerName = effectiveValues.effectiveRunnerName ?? order.runnerName

    // A race that has not been run has no results. researchOrder checks this
    // before it gets here; researchBatch (the Research queue, the import's
    // research step) did not, so those runs scraped a future race and stamped
    // it "not found" or "year not configured", undoing the right answer.
    if (race?.raceDate && new Date(race.raceDate) > new Date()) {
      const raceDay = new Date(race.raceDate).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      })
      const notRunData = {
        orderId: order.id,
        raceId: race.id,
        runnerName,
        bibNumber: null, officialTime: null, officialPace: null,
        researchStatus: 'race_not_run',
        researchNotes: `${raceName} ${raceYear} takes place on ${raceDay}. Results will not exist until after race day.`,
        possibleMatches: null,
      }
      const existing = await prisma.runnerResearch.findFirst({ where: { orderId: order.id, raceId: race.id } })
      return existing
        ? prisma.runnerResearch.update({ where: { id: existing.id }, data: notRunData })
        : prisma.runnerResearch.create({ data: notRunData })
    }

    // Check cache first
    let existingResearch = await prisma.runnerResearch.findFirst({
      where: {
        orderId: order.id,
        raceId: race.id
      }
    })

    // If we already found the runner, return cached data. Not when a person
    // asked for research again: they usually just corrected the name or bib.
    if (existingResearch && existingResearch.researchStatus === 'found' && !force) {
      // A result found before the finish time was posted (race morning: the
      // runner's bib is listed, the time is not yet) used to stay timeless
      // forever. Look again, and fill in only what is missing: the time, pace,
      // event and results link, and only when the bib still matches. Nothing
      // already on the record is overwritten, including what a person entered.
      if (!existingResearch.officialTime && !order.hadNoTime) {
        try {
          const wantBib = String(existingResearch.bibNumber || order.customerBib || '').trim()
          let fresh = await this.findRunner(raceName, raceYear, runnerName, { bib: wantBib || null })
          // Two finishers share the name (MCM 2026 had two Michael Andersons):
          // the search comes back ambiguous, but the bib on the record says which.
          if (fresh && !fresh.found && wantBib) {
            const m = (fresh.possibleMatches || []).find(c => String(c?.bib || '').trim() === wantBib)
            if (m) fresh = { found: true, bibNumber: m.bib, officialTime: m.time, officialPace: m.pace, eventType: m.eventType, resultsUrl: fresh.resultsUrl }
          }
          const sameRunner = !existingResearch.bibNumber || String(fresh?.bibNumber || '') === String(existingResearch.bibNumber)
          if (fresh?.found && fresh.officialTime && sameRunner) {
            console.log(`[ResearchService] Filled the missing time for order ${order.orderNumber}: ${fresh.officialTime}`)
            return prisma.runnerResearch.update({
              where: { id: existingResearch.id },
              data: {
                officialTime: fresh.officialTime,
                officialPace: existingResearch.officialPace || fresh.officialPace || null,
                bibNumber: existingResearch.bibNumber || fresh.bibNumber || null,
                eventType: existingResearch.eventType || fresh.eventType || null,
                resultsUrl: existingResearch.resultsUrl || fresh.resultsUrl || null,
                researchNotes: `${existingResearch.researchNotes || ''} Time filled from the official results once posted.`.trim(),
              },
            })
          }
        } catch (e) {
          console.warn(`[ResearchService] Could not refill the time for ${order.orderNumber}: ${e.message}`)
        }
      }
      // A race whose same-distance events have their own designs (Detroit's
      // International and Motor City halves): a result saved before that split
      // says only "Half Marathon". Look again for which one, same bib only.
      const named = namedEventsFor(raceName)
      if (existingResearch.bibNumber && named.length && !named.some(e => e.label === existingResearch.eventType) && existingResearch.eventType && !isMainEventType(existingResearch.eventType)) {
        try {
          const bib = String(existingResearch.bibNumber)
          const fresh = await this.findRunner(raceName, raceYear, runnerName, { bib })
          // Two runners can share a name; the saved bib says which one this is.
          const hit = fresh?.found ? { bib: fresh.bibNumber, eventType: fresh.eventType } : (fresh?.matches || []).find(m => String(m.bib || '') === bib)
          if (hit && String(hit.bib || '') === bib && named.some(e => e.label === hit.eventType)) {
            console.log(`[ResearchService] ${order.orderNumber}: ${existingResearch.eventType} is the ${hit.eventType}`)
            return prisma.runnerResearch.update({ where: { id: existingResearch.id }, data: { eventType: hit.eventType } })
          }
        } catch (e) {
          console.warn(`[ResearchService] Could not tell which event ${order.orderNumber} ran: ${e.message}`)
        }
      }
      console.log(`[ResearchService] Runner data found in cache for order ${order.orderNumber}`)
      return existingResearch
    }

    // A blocked detail page is a settled answer, not a retry.
    //
    // 'time_unavailable' means we matched the runner and got their bib, and the
    // only missing piece sits behind a firewall that will refuse us again.
    // Without this, every research pass relaunches a browser for each Sydney
    // order to rediscover the same bib and the same block. That is sixteen
    // Chromium launches against a site that rate-limited us at around
    // twenty-five, so the retries were a good way to lose the access we have.
    //
    // Unlike the 'found' branch above, this one re-checks the name. The stored
    // result is only settled for the runner it was looked up for, so correcting
    // a misspelling still triggers a fresh search.
    //
    // The resultsUrl condition also makes this self-healing. Rows written
    // before we started capturing the runner's result page have none, and
    // without that check they would be pinned in place forever, permanently
    // missing the one link that makes them actionable. Missing URL means
    // re-scrape once, capture it, and settle from then on.
    if (
      !force &&
      existingResearch &&
      existingResearch.researchStatus === 'time_unavailable' &&
      existingResearch.runnerName === runnerName &&
      existingResearch.resultsUrl
    ) {
      console.log(`[ResearchService] Cached match with no available time for order ${order.orderNumber}`)
      return existingResearch
    }

    // Fetch from scraper using effective values (shared, DB-free search core)
    // A bib a person typed onto the research row (or the customer gave) lets
    // research fall back to a bib lookup when the name finds nobody.
    // A time_unavailable row's bib came from a scrape of the name it was
    // searched under, which is being replaced here, so it does not count.
    // A bib scraped for a different name belongs to that other runner: it is
    // only a hint when a person typed it or it was found under this name.
    const handBib = existingResearch && existingResearch.researchStatus !== 'time_unavailable'
      && (existingResearch.source === 'manual_entry' || existingResearch.runnerName === runnerName)
      ? existingResearch.bibNumber || null
      : null
    const knownBib = handBib || order.customerBib || null
    const results = await this.findRunner(raceName, raceYear, runnerName, { bib: knownBib })

    // Prepare research data (store the effective name used for search)
    const researchData = {
      orderId: order.id,
      raceId: race.id,
      runnerName: runnerName, // Store the name actually used for search
      // Never blank a bib a person entered just because this search did not
      // return one.
      bibNumber: results.bibNumber || handBib || null,
      officialTime: results.officialTime,
      // Backstop for every scraper at once. MyRace hands back paceTime: null
      // for whole races - CIM 2019 for all of them - and the scraper passed
      // that straight through, so orders showed a finish time next to
      // "Pending research" where the pace goes. Rather than patch that race by
      // race, derive it here whenever we have a time and know the distance.
      // The scraper's own value always wins; this only fills a hole.
      officialPace: results.officialPace
        || derivePace(results.officialTime, results.eventType),
      eventType: results.eventType,
      yearFound: results.yearFound,
      // Pass through the scraper's specific status if it returned one (e.g.
      // 'year_not_configured'), otherwise derive from found/ambiguous flags.
      researchStatus: results.researchStatus
        || (results.found ? 'found' : (results.ambiguous ? 'ambiguous' : 'not_found')),
      researchNotes: results.researchNotes,
      resultsUrl: results.resultsUrl || null,
      // Persist candidate matches so the dashboard can show the picker on
      // future loads, not just immediately after research finishes.
      possibleMatches: Array.isArray(results.possibleMatches) && results.possibleMatches.length > 0
        ? results.possibleMatches
        : null,
    }

    // Fire a Slack alert if the scraper exists but the year isn't configured.
    // Don't await — fire-and-forget; we don't want notification failures to
    // block the research record from being saved.
    if (researchData.researchStatus === 'year_not_configured') {
      this._notifyMissingScraper({
        kind: 'year_not_configured',
        race: race.raceName,
        year: race.year,
        orderNumber: order.orderNumber,
        runner: runnerName,
      }).catch(err => console.warn('[ResearchService] Slack notify failed:', err.message))
    }

    // A search again that finds nothing does not wipe a result that still
    // describes this runner (same name, or typed in by a person): a timing
    // site having a bad day should not undo a good answer. The caller hears
    // what the search said; the saved result stays.
    if (force && existingResearch?.researchStatus === 'found' && researchData.researchStatus !== 'found'
      && (existingResearch.source === 'manual_entry' || existingResearch.runnerName === runnerName)) {
      console.log(`[ResearchService] ${order.orderNumber}: search again came back ${researchData.researchStatus}; kept the saved result`)
      return {
        ...existingResearch,
        researchStatus: researchData.researchStatus,
        researchNotes: `${researchData.researchNotes || 'No match this time.'} The result already on the order was kept.`,
        found: false,
        ambiguous: results.ambiguous || false,
        kept: true,
        possibleMatches: results.possibleMatches || null,
      }
    }

    let research
    if (existingResearch) {
      // Update existing research
      research = await prisma.runnerResearch.update({
        where: { id: existingResearch.id },
        data: researchData
      })
      console.log(`[ResearchService] Updated runner research: ${research.id}`)
    } else {
      // Create new research record
      research = await prisma.runnerResearch.create({
        data: researchData
      })
      console.log(`[ResearchService] Created runner research: ${research.id}`)
    }

    // Update order status if found
    if (results.found) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'ready',
          researchedAt: new Date()
        }
      })
    }

    return {
      ...research,
      found: results.found,
      ambiguous: results.ambiguous || false,
      rawData: results.rawData,
      possibleMatches: results.possibleMatches || null
    }
  }

  /**
   * Batch research multiple orders for the same race
   * Efficient because race data is fetched only once
   * @param {string[]} orderNumbers
   * @returns {Promise<Object[]>} Results for each order
   */
  async researchBatch(orderNumbers) {
    const results = []
    const raceCache = new Map() // raceName_year -> race record

    for (const orderNumber of orderNumbers) {
      try {
        const order = await prisma.order.findFirst({
          where: { orderNumber }
        })

        if (!order) {
          results.push({ orderNumber, error: 'Order not found' })
          continue
        }

        // What a person corrected on the order (race, year, runner) is what gets searched.
        const effectiveRaceName = order.raceNameOverride ?? order.raceName
        const effectiveRaceYear = order.yearOverride ?? order.raceYear
        const effectiveRunnerName = order.runnerNameOverride ?? order.runnerName
        const cacheKey = `${effectiveRaceName}_${effectiveRaceYear}`

        // Get race from cache or fetch
        let race = raceCache.get(cacheKey)
        if (!race) {
          race = await this.getOrFetchRaceData(effectiveRaceName, effectiveRaceYear)
          raceCache.set(cacheKey, race)
        }

        // Get runner data
        const runnerResearch = await this.getOrFetchRunnerData(order, race, { effectiveRaceName, effectiveRaceYear, effectiveRunnerName })

        results.push({
          orderNumber,
          success: true,
          race,
          runnerResearch
        })

      } catch (error) {
        results.push({
          orderNumber,
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * Check if race data is cached
   */
  async hasRaceData(raceName, year) {
    const race = await prisma.race.findUnique({
      where: {
        raceName_year: { raceName, year }
      }
    })
    return race && race.raceDate && race.location
  }

  /**
   * Check if runner data is cached
   */
  async hasRunnerData(orderId, raceId) {
    const research = await prisma.runnerResearch.findFirst({
      where: { orderId, raceId, researchStatus: 'found' }
    })
    return !!research
  }

  /**
   * Send a Slack alert when a scraper is missing or a year isn't configured.
   * De-duplicates by race+year+kind so we only notify once per missing config
   * per process (no point spamming when 30 orders for the same race come in).
   *
   * Goes to SLACK_DM_WEBHOOK_URL if set (Matt's DM), otherwise the proof
   * channel webhook so it doesn't get lost.
   */
  async _notifyMissingScraper({ kind, race, year, orderNumber, runner }) {
    const dedupeKey = `${kind}:${race}:${year}`
    if (!ResearchService._notifiedKeys) ResearchService._notifiedKeys = new Set()
    if (ResearchService._notifiedKeys.has(dedupeKey)) return
    ResearchService._notifiedKeys.add(dedupeKey)

    const slackUrl = process.env.SLACK_DM_WEBHOOK_URL || process.env.SLACK_PROOF_WEBHOOK_URL
    if (!slackUrl) return

    const heading = kind === 'no_scraper'
      ? `🚧 *No scraper for race:* \`${race}\``
      : `🗓️ *${race} ${year} not configured yet*`
    const detail = kind === 'no_scraper'
      ? `An order came in for *${race}* but we don't have a scraper for this race. Either add one (or add an alias if it should match an existing scraper).`
      : `The ${race} scraper exists but ${year} event/result IDs aren't in the config yet. Add them so this year's runners can be looked up.`
    const text = [
      heading,
      detail,
      `Order: \`${orderNumber}\` - runner: *${runner}*`,
    ].join('\n')

    try {
      await fetchWithTimeout(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      console.log(`[ResearchService] Slack alert sent: ${kind} for ${race} ${year}`)
    } catch (err) {
      console.warn('[ResearchService] Slack alert failed:', err.message)
    }
  }

  /**
   * Cleanup - disconnect from database
   */
  async disconnect() {
    await prisma.$disconnect()
  }
}

// Export singleton instance
export const researchService = new ResearchService()

export default ResearchService
