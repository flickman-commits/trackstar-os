/**
 * Xacte Platform Scraper
 * REST API client for Xacte's results JSON API (results.xacte.com)
 * Currently: LA Marathon
 *
 * API endpoint: https://results.xacte.com/json/search?eventId={id}&search={term}
 * - search param matches partial first/last names (single term only, no spaces)
 * - Times are returned in milliseconds (chiptime, clocktime)
 * - Distance in meters (42195 = marathon, 21097 = half)
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

export class XacteScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {Object} config.eventIds - { 2026: 2626, 2025: ... }
   * @param {Object} config.subEvents - { 2026: { marathon: { id: 6584, distance: 42195 }, half: { id: 6585, distance: 21097 } } }
   * @param {string[]} config.eventSearchOrder - e.g. ['marathon', 'half']
   * @param {Object} config.eventLabels - e.g. { marathon: 'Marathon', half: 'Half Marathon' }
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    this.baseUrl = 'https://results.xacte.com/json/search'
    this.eventId = config.eventIds?.[year]
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    const raceDate = this.resolveRaceDate()
    const eventTypes = this.config.eventTypes || ['Marathon']
    const eventId = this.eventId || 'unknown'

    console.log(`[${this.tag} ${this.year}] Event ID: ${eventId}, Date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)

    return {
      raceDate,
      location: this.config.location,
      eventTypes,
      resultsUrl: `https://results2.xacte.com/#/e/${eventId}/searchable`,
      resultsSiteType: 'xacte',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    if (!this.eventId) {
      console.log(`[${this.tag}] No event ID configured for year ${this.year}`)
      return this.yearNotConfiguredResult('missing Xacte eventIds entry')
    }

    try {
      // Xacte search only supports single-term search (no spaces)
      // Strategy: search by last name, then filter by first name
      const nameParts = runnerName.trim().split(/\s+/)
      const lastName = nameParts[nameParts.length - 1]

      console.log(`[${this.tag}] Searching API by last name: "${lastName}"`)

      const url = `${this.baseUrl}?eventId=${this.eventId}&search=${encodeURIComponent(lastName)}`
      console.log(`[${this.tag}] API URL: ${url}`)

      const response = await fetchWithTimeout(url)
      console.log(`[${this.tag}] Response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[${this.tag}] API error: ${response.status}`)
        console.error(`[${this.tag}] Error body: ${errorText.slice(0, 500)}`)
        return this.notFoundResult()
      }

      const data = await response.json()
      const results = data.aaData || []

      console.log(`[${this.tag}] Total results for "${lastName}": ${data.iTotalDisplayRecords}`)

      if (!results.length) {
        console.log(`[${this.tag}] No results found`)
        return this.notFoundResult()
      }

      // Log first few results
      console.log(`[${this.tag}] First few results:`)
      results.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.firstname} ${r.lastname} - Bib: ${r.bib}, SubEvent: ${r.subevent}`)
      })

      // Filter for exact name matches
      const matches = this.filterNameMatches(runnerName, results,
        r => `${r.firstname} ${r.lastname}`)

      console.log(`[${this.tag}] Exact matches after filtering: ${matches.length}`)

      if (matches.length === 0) {
        console.log(`[${this.tag}] No exact match for: ${runnerName}. Surfacing ${Math.min(results.length, 10)} candidates.`)
        return this.notFoundResult(null, results.slice(0, 10).map(r => ({
          name: `${r.firstname || ''} ${r.lastname || ''}`.trim(),
          bib: r.bib,
          time: this._msToTime(r.chiptime),
          eventType: this.config.defaultEventType || 'Marathon',
        })))
      }

      // Several matches. The search lists a runner once per row it has (the
      // same bib can come back twice); different bibs are different people,
      // and a shared name is never settled by which event they ran: Denver
      // Colfax 2026 has a Diego Garcia in the half and two in the marathon,
      // and the half one was printed for the customer whose Diego ran the
      // marathon. A person picks.
      if (matches.length > 1) {
        const byBib = new Map()
        for (const m of matches) if (!byBib.has(String(m.bib))) byBib.set(String(m.bib), m)
        const people = [...byBib.values()]
        if (people.length === 1) return this._extractRunnerData(people[0])
        const order = this.config.eventSearchOrder || ['marathon']
        const subEvents = this.config.subEvents?.[this.year] || {}
        const rank = m => { const i = order.findIndex(k => subEvents[k]?.id === m.subeventId); return i < 0 ? order.length : i }
        people.sort((a, b) => rank(a) - rank(b))
        return this.ambiguousResult(people.map(m => ({
          name: `${m.firstname} ${m.lastname}`,
          bib: m.bib,
          time: this._msToTime(m.chiptime),
          event: m.subevent,
          eventType: this._getEventType(m),
        })))
      }

      // Single match
      return this._extractRunnerData(matches[0])

    } catch (error) {
      console.error(`[${this.tag}] Error searching for ${runnerName}:`, error.message)
      return {
        ...this.notFoundResult(),
        researchNotes: `Error: ${error.message}`
      }
    }
  }

  /**
   * Extract standardized runner data from an Xacte result record
   */
  _extractRunnerData(runner) {
    const chipTimeMs = runner.chiptime
    const time = this._msToTime(chipTimeMs)
    const formattedTime = this.formatTime(time)

    // Determine event type from subevent name or distance
    const eventType = this._getEventType(runner)

    // Calculate pace based on distance
    const distanceMiles = this._getDistanceMiles(runner)
    const pace = distanceMiles ? this.calculatePace(time, distanceMiles) : null
    const formattedPace = this.formatPace(pace)

    const eventId = this.eventId

    console.log(`\n[${this.tag}] FOUND RUNNER:`)
    console.log(`  Name: ${runner.firstname} ${runner.lastname}`)
    console.log(`  Bib: ${runner.bib}`)
    console.log(`  Event: ${runner.subevent}`)
    console.log(`  Chip Time: ${formattedTime}`)
    console.log(`  Pace: ${formattedPace}`)
    console.log(`  Overall: ${runner.overall}, Gender: ${runner.oversex}, Division: ${runner.overdiv}`)

    return {
      found: true,
      bibNumber: runner.bib ? String(runner.bib) : null,
      officialTime: formattedTime,
      officialPace: formattedPace,
      eventType,
      yearFound: this.year,
      researchNotes: null,
      resultsUrl: `https://results2.xacte.com/#/e/${eventId}/searchable`,
      rawData: {
        firstName: runner.firstname?.trim(),
        lastName: runner.lastname?.trim(),
        gender: runner.sex,
        age: runner.age,
        city: runner.city,
        state: runner.state,
        country: runner.country,
        overallPlace: runner.overall,
        genderPlace: runner.oversex,
        divisionPlace: runner.overdiv,
        chipTimeMs: runner.chiptime,
        clockTimeMs: runner.clocktime,
        subevent: runner.subevent,
        subeventId: runner.subeventId,
        dq: runner.dq,
      }
    }
  }

  /**
   * Convert milliseconds to h:mm:ss format
   * e.g. 15638600 -> "4:20:39"
   */
  _msToTime(ms) {
    if (!ms && ms !== 0) return null

    // Xacte's page rounds any fraction UP (Army Ten-Miler 2025: 4471430 ms
    // shows 1:14:32; LA 2025: 19503400 ms shows 5:25:04). Nearest printed
    // about half the field a second low.
    const totalSeconds = Math.ceil(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  /**
   * Determine the event type label from a result record
   */
  _getEventType(runner) {
    // Check if we have a mapping in the config
    const subEvents = this.config.subEvents?.[this.year] || {}
    for (const [key, subEvent] of Object.entries(subEvents)) {
      if (subEvent.id === runner.subeventId) {
        return this.config.eventLabels?.[key] || runner.subevent || 'Marathon'
      }
    }

    // Fallback: use the subevent name from the API
    return runner.subevent || this.config.defaultEventType || 'Marathon'
  }

  /**
   * Distance in miles for this result, or null if we cannot establish it.
   *
   * ONLY the curated config distances are trusted. Xacte's own split distance
   * is reported in INCONSISTENT UNITS and cannot be used:
   *
   *   Army Ten-Miler  6554: 52800  -> feet   (10 mi)
   *   Denver Colfax   6363: 42195  -> metres (marathon)
   *   Denver Colfax   6362: 69218  -> feet   (half)
   *   Surf City       6416:  5000  -> metres (5K)
   *   Surf City       6417:  5280  -> feet   (1 mi)
   *
   * Two different units inside a single event, with no field saying which.
   * Reading 52800 as metres is what put a 2:54/mi pace on a 1:35:02 ten-mile
   * finish: 52800/1609.344 = 32.8 "miles". The number looked like metres, and
   * the resulting pace looked like a number, so nothing complained.
   *
   * There is also deliberately no "assume marathon" fallback any more. That
   * default silently paced a 10-mile race against 26.2 whenever a sub-event
   * was missing from the config. Returning null yields no pace at all, which
   * shows up as a gap for someone to fill rather than a plausible wrong value
   * printed on a poster.
   */
  _getDistanceMiles(runner) {
    const subEvents = this.config.subEvents?.[this.year] || {}
    const entries = Object.values(subEvents).filter(s => s?.distance)

    const matched = entries.find(s => s.id === runner.subeventId)
    if (matched) return matched.distance / 1609.344

    // Single-distance races (e.g. Army Ten-Miler) have exactly one sub-event,
    // so an id mismatch is still unambiguous.
    if (entries.length === 1) {
      console.warn(`[${this.tag}] subeventId ${runner.subeventId} not in config; using the only configured distance`)
      return entries[0].distance / 1609.344
    }

    console.warn(`[${this.tag}] No configured distance for subeventId ${runner.subeventId} in ${this.year} - pace will be omitted. Add it to subEvents in the race config.`)
    return null
  }
}

export default XacteScraper
