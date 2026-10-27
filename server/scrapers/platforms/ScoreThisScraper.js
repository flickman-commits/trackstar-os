/**
 * ScoreThis Platform Scraper
 * Fetches and parses semicolon-delimited CSV result files from scorethis-results.com
 * Currently: Buffalo Marathon
 *
 * Data source: https://scorethis-results.com/ResultFiles/{raceId}.txt
 * - raceId format: YYYYMMDD + raceCode (e.g. "20240526BFLM")
 * - CSV is semicolon-delimited with no header row
 * - File contains all event types (Marathon, Half, Relay) in one file
 *
 * Column layout (23 columns):
 *  [0] Bib number
 *  [1] Event type (e.g. "Marathon", "Half", "Half Marathon", "Relay")
 *  [2] Overall place
 *  [3] Chip time (h:mm:ss)
 *  [4] Last name
 *  [5] First name
 *  [6] Middle initial
 *  [7] Bib (repeated)
 *  [8] City
 *  [9] State
 * [10] Pace (0:mm:ss)
 * [11] Gender (M/F)
 * [12] Gender place
 * [13] Age group (e.g. "Men 30-34")
 * [14] Age group place
 * [15] Gun time
 * [16] Age grade %
 * [17] Chip time (repeated)
 * [18] Overall place (repeated)
 * [19-20] (empty)
 * [21] Certificate link
 * [22] Flag
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

// Column indices
const COL = {
  BIB: 0,
  EVENT_TYPE: 1,
  PLACE: 2,
  CHIP_TIME: 3,
  LAST_NAME: 4,
  FIRST_NAME: 5,
  MIDDLE_INITIAL: 6,
  CITY: 8,
  STATE: 9,
  PACE: 10,
  GENDER: 11,
  GENDER_PLACE: 12,
  AGE_GROUP: 13,
  AGE_GROUP_PLACE: 14,
  GUN_TIME: 15,
  AGE_GRADE: 16,
}

export class ScoreThisScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {string} config.raceCode - Suffix after date in raceId (e.g. "BFLM")
   * @param {Object} config.eventTypeMap - Maps internal keys to possible CSV values
   *   e.g. { marathon: ['Marathon'], half: ['Half', 'Half Marathon'] }
   * @param {string[]} config.eventSearchOrder - e.g. ['marathon', 'half']
   * @param {Object} config.eventLabels - e.g. { marathon: 'Marathon', half: 'Half Marathon' }
   * @param {Object} config.distances - e.g. { marathon: 26.2, half: 13.1 }
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    this.baseUrl = 'https://scorethis-results.com'
  }

  /**
   * Build the raceId string for a given year
   * Format: YYYYMMDD + raceCode (e.g. "20240526BFLM")
   */
  _buildRaceId() {
    // Use override if config provides explicit raceIds per year
    if (this.config.raceIds?.[this.year]) {
      return this.config.raceIds[this.year]
    }

    // Otherwise build dynamically from date + raceCode
    const date = this.resolveRaceDate()
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yyyy}${mm}${dd}${this.config.raceCode}`
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    const raceDate = this.resolveRaceDate()
    const raceId = this._buildRaceId()
    const eventTypes = this.config.eventTypes || ['Marathon']

    console.log(`[${this.tag} ${this.year}] Race ID: ${raceId}, Date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)

    return {
      raceDate,
      location: this.config.location,
      eventTypes,
      resultsUrl: `${this.baseUrl}/Results.php?raceid=${raceId}`,
      resultsSiteType: 'scorethis',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const raceId = this._buildRaceId()
    const csvUrl = `${this.baseUrl}/ResultFiles/${raceId}.txt`

    try {
      // Fetch the full CSV
      console.log(`[${this.tag}] Fetching CSV: ${csvUrl}`)
      const response = await fetchWithTimeout(csvUrl)

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[${this.tag}] No results file found for ${this.year} (404)`)
          return {
            ...this.notFoundResult(),
            researchNotes: `No results available for ${this.year}`
          }
        }
        throw new Error(`HTTP ${response.status}`)
      }

      const text = await response.text()
      const lines = text.split('\n').filter(l => l.trim())

      console.log(`[${this.tag}] Loaded ${lines.length} result rows`)

      // Parse all rows
      const allResults = lines.map(line => this._parseRow(line)).filter(Boolean)

      // Search by name - pre-filter by last name for efficiency
      const nameParts = runnerName.trim().split(/\s+/)
      const searchLastName = nameParts[nameParts.length - 1].toLowerCase()

      const lastNameMatches = allResults.filter(
        r => r.lastName.toLowerCase() === searchLastName
      )

      console.log(`[${this.tag}] Last name "${searchLastName}" matches: ${lastNameMatches.length}`)

      // Now filter for full name match
      const nameMatches = this.filterNameMatches(runnerName, lastNameMatches,
        r => `${r.firstName} ${r.lastName}`)

      console.log(`[${this.tag}] Full name matches: ${nameMatches.length}`)

      if (nameMatches.length === 0) {
        console.log(`[${this.tag}] No full-name match. Surfacing ${Math.min(lastNameMatches.length, 10)} last-name candidates.`)
        return this.notFoundResult(null, lastNameMatches.slice(0, 10).map(r => ({
          name: `${r.firstName} ${r.lastName}`.trim(),
          bib: r.bib,
          time: r.chipTime,
          eventType: r.eventType,
          city: r.city,
          state: r.state,
        })))
      }

      // Name matches are deduped by bib (the same bib twice is one person).
      // One bib is the runner. Several bibs are different people sharing the
      // name, and which event they ran never settles it: Denver Colfax 2026
      // had a Diego Garcia in the half and two in the marathon, and the half
      // one was printed for a marathon customer. A person picks. Matches in
      // the sold events (eventSearchOrder) are decided first, earlier events
      // listed first; only when there are none does a match in another event
      // (e.g. relay) count, as before.
      const eventSearchOrder = this.config.eventSearchOrder || ['marathon', 'half']
      const eventTypeMap = this.config.eventTypeMap || {}
      const soldKeyOf = r => eventSearchOrder.find(eventKey =>
        (eventTypeMap[eventKey] || []).some(v => r.eventType.toLowerCase() === v.toLowerCase())
      ) || null
      const byBib = (rows) => {
        const people = new Map()
        for (const r of rows) {
          const bib = String(r.bib ?? '').trim()
          const key = bib ? `bib ${bib}` : `${r.firstName} ${r.lastName}|${r.chipTime}|${r.eventType}`.toLowerCase()
          if (!people.has(key)) people.set(key, r)
        }
        return [...people.values()]
      }
      const toCandidate = r => ({
        name: `${r.firstName} ${r.lastName}`,
        bib: r.bib,
        time: r.chipTime,
        event: r.eventType,
        city: r.city,
        state: r.state,
      })

      const sold = byBib(nameMatches.filter(r => soldKeyOf(r))
        .sort((a, b) => eventSearchOrder.indexOf(soldKeyOf(a)) - eventSearchOrder.indexOf(soldKeyOf(b))))
      if (sold.length === 1) {
        const eventKey = soldKeyOf(sold[0])
        console.log(`[${this.tag}] Found single match in ${eventKey}`)
        return this._buildResult(sold[0], eventKey, raceId)
      }
      if (sold.length > 1) {
        console.log(`[${this.tag}] ${sold.length} different bibs share this name in the sold events`)
        return this.ambiguousResult(sold.map(toCandidate))
      }

      // No match in the sold events: a match in any other event.
      const others = byBib(nameMatches)
      if (others.length === 1) {
        const match = others[0]
        const eventKey = this._identifyEventKey(match.eventType)
        console.log(`[${this.tag}] Found single match in non-preferred event: ${match.eventType}`)
        return this._buildResult(match, eventKey, raceId)
      }
      if (others.length > 1) return this.ambiguousResult(others.map(toCandidate))

      return this.notFoundResult()

    } catch (error) {
      console.error(`[${this.tag}] Error searching for ${runnerName}:`, error.message)
      return {
        ...this.notFoundResult(),
        researchNotes: `Error: ${error.message}`
      }
    }
  }

  /**
   * Parse a single semicolon-delimited row into a structured object
   */
  _parseRow(line) {
    const cols = line.split(';')
    if (cols.length < 15) return null

    const lastName = cols[COL.LAST_NAME]?.trim()
    const firstName = cols[COL.FIRST_NAME]?.trim()

    // Skip rows without a name (e.g. relay teams with odd formatting)
    if (!lastName && !firstName) return null

    return {
      bib: cols[COL.BIB]?.trim(),
      eventType: cols[COL.EVENT_TYPE]?.trim(),
      place: cols[COL.PLACE]?.trim(),
      chipTime: cols[COL.CHIP_TIME]?.trim(),
      lastName,
      firstName,
      middleInitial: cols[COL.MIDDLE_INITIAL]?.trim(),
      city: cols[COL.CITY]?.trim(),
      state: cols[COL.STATE]?.trim(),
      pace: cols[COL.PACE]?.trim(),
      gender: cols[COL.GENDER]?.trim(),
      genderPlace: cols[COL.GENDER_PLACE]?.trim(),
      ageGroup: cols[COL.AGE_GROUP]?.trim(),
      ageGroupPlace: cols[COL.AGE_GROUP_PLACE]?.trim(),
      gunTime: cols[COL.GUN_TIME]?.trim(),
      ageGrade: cols[COL.AGE_GRADE]?.trim(),
    }
  }

  /**
   * Identify the internal event key from a CSV event type string
   */
  _identifyEventKey(csvEventType) {
    const eventTypeMap = this.config.eventTypeMap || {}
    for (const [key, values] of Object.entries(eventTypeMap)) {
      if (values.some(v => v.toLowerCase() === csvEventType.toLowerCase())) {
        return key
      }
    }
    return null
  }

  /**
   * Build a standardized result from a parsed row
   */
  _buildResult(row, eventKey, raceId) {
    // Buffalo 2026 is the first year with tenths ("3:51:25.5"). ScoreThis's own
    // whole-second view (the splits page) cuts them to 3:51:25, so do we;
    // passing them through put "3:51:25.5" on the print.
    const time = this.normalizeTime(String(row.chipTime ?? '').replace(/\.\d+$/, '') || null)
    const formattedTime = this.formatTime(time)

    // Get pace from CSV data, or calculate it
    let pace = null
    if (row.pace) {
      // ScoreThis pace format is "0:mm:ss" — strip leading "0:" to get "mm:ss"
      pace = row.pace.replace(/^0:/, '')
    }
    if (!pace && time && eventKey) {
      const distanceMiles = this.config.distances?.[eventKey]
      if (distanceMiles) {
        pace = this.calculatePace(time, distanceMiles)
      }
    }
    const formattedPace = this.formatPace(pace)

    // Event type label for display
    const eventLabel = eventKey
      ? (this.config.eventLabels?.[eventKey] || row.eventType)
      : row.eventType

    console.log(`\n[${this.tag}] FOUND RUNNER:`)
    console.log(`  Name: ${row.firstName} ${row.lastName}`)
    console.log(`  Bib: ${row.bib}`)
    console.log(`  Event: ${eventLabel}`)
    console.log(`  Chip Time: ${formattedTime}`)
    console.log(`  Pace: ${formattedPace}`)
    console.log(`  Place: ${row.place}, Gender: ${row.genderPlace}, AG: ${row.ageGroupPlace}`)

    return {
      found: true,
      bibNumber: row.bib || null,
      officialTime: formattedTime,
      officialPace: formattedPace,
      eventType: eventLabel,
      yearFound: this.year,
      researchNotes: null,
      resultsUrl: `${this.baseUrl}/Results.php?raceid=${raceId}`,
      rawData: {
        firstName: row.firstName,
        lastName: row.lastName,
        gender: row.gender,
        city: row.city,
        state: row.state,
        ageGroup: row.ageGroup,
        placeOverall: row.place,
        placeGender: row.genderPlace,
        placeAgeGroup: row.ageGroupPlace,
        chipTime: row.chipTime,
        gunTime: row.gunTime,
        pace: formattedPace,
        ageGrade: row.ageGrade,
      }
    }
  }
}

export default ScoreThisScraper
