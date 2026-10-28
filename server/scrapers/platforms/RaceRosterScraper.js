/**
 * RaceRoster Platform Scraper
 * Uses RaceRoster's v2 JSON API (no browser/Puppeteer needed)
 *
 * API endpoints:
 *   - Event info:    GET /v2/api/events/{eventUniqueCode}
 *   - Search:        GET /v2/api/events/{eventUniqueCode}/participant-search?phrase={name}
 *   - Result detail: GET /v2/api/events/{eventUniqueCode}/detail/{resultId}
 *   - Sub-event:     GET /v2/api/events/{eventUniqueCode}/sub-events/{subEventId}
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

// Miles per event key, used when a config does not give its own distances.
const DEFAULT_DISTANCES = { marathon: 26.2, halfMarathon: 13.1, tenMile: 10 }

export class RaceRosterScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config - Race-specific configuration
   * @param {string} config.raceName - Display name
   * @param {string} config.location - City, State
   * @param {string[]} config.eventTypes - e.g. ['Marathon', 'Half Marathon', '10 Mile']
   * @param {Object} config.eventCodes - year -> eventUniqueCode
   * @param {Object} config.subEventIds - year -> { marathon: id, halfMarathon: id, ... }
   * @param {string[]} config.eventSearchOrder - e.g. ['marathon', 'halfMarathon']
   * @param {Object} config.eventLabels - e.g. { marathon: 'Marathon', halfMarathon: 'Half Marathon' }
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.baseUrl = 'https://results.raceroster.com'
    this.tag = config.tag || config.raceName
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    const eventCode = this.config.eventCodes?.[this.year]
    let raceDate = this.resolveRaceDate()

    // If we have an event code, try to fetch the actual date from the API
    if (eventCode) {
      try {
        const eventData = await this.fetchApi(`/v2/api/events/${eventCode}`)
        if (eventData?.data?.event?.eventDate) {
          raceDate = new Date(eventData.data.event.eventDate)
        }
      } catch (err) {
        console.log(`[${this.tag} ${this.year}] Could not fetch event date, using calculated: ${err.message}`)
      }
    }

    console.log(`[${this.tag} ${this.year}] Race date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)

    return {
      raceDate,
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl: eventCode
        ? `${this.baseUrl}/v3/events/${eventCode}`
        : null,
      resultsSiteType: 'raceroster',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const eventCode = this.config.eventCodes?.[this.year]
    if (!eventCode) {
      console.log(`[${this.tag} ${this.year}] No event code configured for this year`)
      return this.yearNotConfiguredResult('missing eventCodes entry')
    }

    const eventOrder = this.config.eventSearchOrder || ['marathon', 'halfMarathon']
    const yearSubEvents = this.config.subEventIds?.[this.year] || {}

    // If no sub-event IDs at all for this year, that's a year-not-configured case too
    if (Object.keys(yearSubEvents).length === 0) {
      console.log(`[${this.tag} ${this.year}] No sub-event IDs configured for this year`)
      return this.yearNotConfiguredResult('missing subEventIds entry')
    }

    // participant-search covers every sub-event of the event at once (each row
    // carries its resultSubEventId), so one request serves all of them. This
    // used to run once per configured sub-event: four identical requests per
    // Newport lookup. Accents need no handling here: the API folds them
    // ("José" and "Jose" return the same rows).
    let allMatches
    try {
      const searchData = await this.fetchApi(
        `/v2/api/events/${eventCode}/participant-search?phrase=${encodeURIComponent(runnerName)}`
      )
      const exactMatches = searchData?.data?.exact || []
      const otherMatches = searchData?.data?.other || []
      allMatches = [...exactMatches, ...otherMatches]
      console.log(`[${this.tag} ${this.year}] Search returned ${allMatches.length} results (${exactMatches.length} exact, ${otherMatches.length} fuzzy)`)
    } catch (error) {
      console.error(`[${this.tag} ${this.year}] Error searching for ${runnerName}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }

    // Every name match in a sold sub-event, pooled and deduped by bib (the
    // same bib twice is one person). One bib is the runner. Several bibs are
    // different people sharing the name, and which sub-event they ran never
    // settles it (Denver Colfax 2026 had a Diego Garcia in the half and two in
    // the marathon). A person picks; earlier sub-events in eventSearchOrder
    // are listed first. Rows in sub-events the race does not sell stay out.
    const rank = new Map()
    eventOrder.forEach((eventKey, i) => {
      const subEventId = yearSubEvents[eventKey]
      if (subEventId && !rank.has(String(subEventId))) rank.set(String(subEventId), { i, eventKey })
    })
    const sold = allMatches.filter(m => rank.has(String(m.resultSubEventId)))
    const nameMatches = this.filterNameMatches(runnerName, sold, m => m.name)
    const people = new Map()
    for (const m of nameMatches) {
      const bib = String(m.bib ?? '').trim()
      const key = bib ? `bib ${bib}` : `id ${m.id}`
      if (!people.has(key)) people.set(key, m)
    }
    const found = [...people.values()]
      .map(m => ({ m, ...rank.get(String(m.resultSubEventId)) }))
      .sort((a, b) => a.i - b.i)
    console.log(`[${this.tag} ${this.year}] Name matches in sold sub-events: ${found.length}`)

    if (found.length > 1) {
      found.forEach(({ m }) => console.log(`  - ${m.name}, Bib: ${m.bib}`))
      return this.ambiguousResult(found.map(({ m, eventKey }) => ({
        name: m.name,
        bib: m.bib,
        eventType: this.config.eventLabels?.[eventKey] || eventKey,
      })))
    }

    if (found.length === 1) {
      const { m: match, eventKey } = found[0]
      const eventLabel = this.config.eventLabels?.[eventKey] || eventKey
      console.log(`[${this.tag} ${this.year}] Found match: ${match.name} (bib ${match.bib}) in ${eventLabel}, fetching details...`)
      let detailData
      try {
        detailData = await this.fetchApi(`/v2/api/events/${eventCode}/detail/${match.id}`)
      } catch (error) {
        console.error(`[${this.tag} ${this.year}] Detail error for ${match.id}:`, error.message)
        return this.upstreamErrorResult(`could not load detail ${match.id} for ${match.name}: ${error.message}`)
      }
      const result = detailData?.data?.result
      if (!result) {
        console.log(`[${this.tag} ${this.year}] Could not fetch detail for result ${match.id}`)
        return this.upstreamErrorResult(`could not load detail ${match.id} for ${match.name}`)
      }
      return this.extractRunnerData(result, eventLabel, eventCode, eventKey)
    }

    console.log(`[${this.tag} ${this.year}] Runner not found in any event type`)
    return this.notFoundResult()
  }

  /**
   * Look a runner up by bib. participant-search's `phrase` matches bibs (its
   * "exact-exact-bib-bib" query), so the same endpoint is used; only an exact
   * bib in one of this year's configured sub-events (eventSearchOrder) is
   * kept, so a 5K or other unsold sub-event is never returned.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    console.log(`[${this.tag} ${this.year}] Bib lookup: ${wanted}`)

    const eventCode = this.config.eventCodes?.[this.year]
    if (!eventCode) return this.yearNotConfiguredResult('missing eventCodes entry')
    const yearSubEvents = this.config.subEventIds?.[this.year] || {}
    if (Object.keys(yearSubEvents).length === 0) return this.yearNotConfiguredResult('missing subEventIds entry')
    const eventOrder = this.config.eventSearchOrder || ['marathon', 'halfMarathon']

    try {
      const searchData = await this.fetchApi(
        `/v2/api/events/${eventCode}/participant-search?phrase=${encodeURIComponent(wanted)}`
      )
      const all = [...(searchData?.data?.exact || []), ...(searchData?.data?.other || [])]
      const hits = all.filter(m => this.bibsEqual(m.bib, wanted))
      if (!hits.length) return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)

      for (const eventKey of eventOrder) {
        const subEventId = yearSubEvents[eventKey]
        if (!subEventId) continue
        const match = hits.find(m => String(m.resultSubEventId) === String(subEventId))
        if (!match) continue
        const eventLabel = this.config.eventLabels?.[eventKey] || eventKey
        const detailData = await this.fetchApi(`/v2/api/events/${eventCode}/detail/${match.id}`)
        const result = detailData?.data?.result
        if (!result) return this.upstreamErrorResult(`could not load detail ${match.id} for bib ${wanted}`)
        if (!this.bibsEqual(result.bib, wanted)) {
          return this.notFoundResult(`Bib ${wanted} detail returned bib ${result.bib}`)
        }
        const out = this.extractRunnerData(result, eventLabel, eventCode, eventKey)
        return { ...out, runnerName: result.name || match.name, bibNumber: String(result.bib).trim() }
      }
      return this.notFoundResult(`Bib ${wanted} is entered in a ${this.raceName} ${this.year} event this race does not sell`)
    } catch (error) {
      console.error(`[${this.tag} ${this.year}] Bib lookup error for ${wanted}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }
  }

  /**
   * Extract standardized data from a RaceRoster detail result
   */
  extractRunnerData(result, eventType, eventCode, eventKey) {
    // Some events publish tenths (Charlotte: "3:22:15.8"). The print shows the
    // whole seconds the page shows, so the tenth is dropped, never rounded:
    // rounding printed 3:22:16, a time not on the page, for about half of
    // Charlotte's field. Athlinks lists the same runner as 3:22:15, and the
    // race's 2024 release gave "2:26:50.5" as 2:26:50.
    const chipTime = this.formatTime(String(result.chipTime ?? '').replace(/\.\d+$/, '') || null)
    // Pace is what the race's participant page shows: Race Roster renders
    // overallPace verbatim, and each timer computes it its own way (Oakland
    // floors, Pittsburgh rounds up, Newport rounds, all from fractional
    // seconds), so it is never recomputed. Computed only if the field is empty.
    const distance = this.config.distances?.[eventKey] ?? DEFAULT_DISTANCES[eventKey]
    const pace = this.cleanPagePace(result.overallPace) ?? ((chipTime && distance) ? this.calculatePace(chipTime, distance) : null)
    const bib = result.bib || null

    console.log(`\n[${this.tag} ${this.year}] FOUND RUNNER:`)
    console.log(`  Name: ${result.name}`)
    console.log(`  Bib: ${bib}`)
    console.log(`  Chip Time: ${chipTime}`)
    console.log(`  Pace: ${pace}`)
    console.log(`  Overall Place: ${result.overallPlace}`)
    console.log(`  Gender Place: ${result.genderPlaceLabel}`)
    console.log(`  Division: ${result.division}`)

    const resultsUrl = eventCode
      ? `${this.baseUrl}/v3/events/${eventCode}/race/${result.resultSubEventId}`
      : null

    return {
      found: true,
      bibNumber: bib ? String(bib) : null,
      officialTime: chipTime,
      officialPace: pace,
      eventType,
      yearFound: this.year,
      researchNotes: null,
      resultsUrl,
      rawData: {
        name: result.name,
        gender: result.gender,
        division: result.division,
        city: result.fromCity,
        state: result.fromProvState,
        overallPlace: result.overallPlace,
        genderPlace: result.genderPlaceLabel,
        divisionPlace: result.divisionPlaceLabel,
        chipTime: result.chipTime,
        chipTimeSec: result.chipTimeSec,
        pace: result.overallPace,
      }
    }
  }

  /**
   * Fetch from RaceRoster API
   */
  async fetchApi(path) {
    const url = `${this.baseUrl}${path}`
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; TrackstarBot/1.0)'
      }
    })

    if (!response.ok) {
      throw new Error(`RaceRoster API ${response.status}: ${response.statusText}`)
    }

    return response.json()
  }
}

export default RaceRosterScraper
