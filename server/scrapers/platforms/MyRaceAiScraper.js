/**
 * MyRace.ai Platform Scraper
 * Consolidates all races using the MyRace.ai API
 * Currently: CIM (California International Marathon)
 * Two-stage: search athletes -> fetch detailed analysis
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

export class MyRaceAiScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {string} config.raceIdPattern - e.g. 'cim_{year}'
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.baseUrl = 'https://myrace.ai/api'
    this.tag = config.tag || config.raceName
    this.raceId = config.raceIdPattern.replace('{year}', year)
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    // Can be null now that configs are allowed to have no date for a year
    // rather than guessing one, so do not assume a Date here.
    const raceDate = this.resolveRaceDate()
    console.log(`[${this.tag} ${this.year}] Race date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)

    return {
      raceDate,
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon'],
      resultsUrl: `https://myrace.ai/races/${this.raceId}/results`,
      resultsSiteType: 'myrace',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    try {
      // Step 1: Search by name
      const searchUrl = `${this.baseUrl}/search-athletes?raceId=${this.raceId}&type=name&value=${encodeURIComponent(runnerName)}`
      console.log(`[${this.tag} ${this.year}] Search URL: ${searchUrl}`)

      const searchResponse = await fetchWithTimeout(searchUrl)
      console.log(`[${this.tag} ${this.year}] Search response status: ${searchResponse.status}`)

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text()
        console.error(`[${this.tag} ${this.year}] Search API error: ${searchResponse.status}`)
        console.error(`[${this.tag} ${this.year}] Error body: ${errorText.slice(0, 500)}`)
        return this.notFoundResult()
      }

      const searchData = await searchResponse.json()
      const results = searchData.results || []

      console.log(`[${this.tag} ${this.year}] Found ${results.length} results (total: ${searchData.totalCount})`)

      if (results.length === 0) return this.notFoundResult()

      // Filter for exact name matches
      const matches = this.filterNameMatches(runnerName, results, r => r.name)
      console.log(`[${this.tag} ${this.year}] Exact matches after filtering: ${matches.length}`)

      if (matches.length === 0) {
        console.log(`[${this.tag} ${this.year}] No exact match. Surfacing ${Math.min(results.length, 10)} candidates.`)
        return this.notFoundResult(null, results.slice(0, 10).map(r => ({
          name: r.name,
          bib: r.bib,
          time: r.finishChipTime,
          eventType: this.config.defaultEventType || 'Marathon',
        })))
      }

      if (matches.length > 1) {
        return this.ambiguousResult(matches.map(m => ({
          name: m.name, bib: m.bib, time: m.finishChipTime
        })))
      }

      // Single match - get detailed data
      const match = matches[0]
      const pid = match.pid
      console.log(`[${this.tag} ${this.year}] Found unique match: ${match.name} (PID: ${pid})`)

      const resultsUrl = `https://myrace.ai/races/${this.raceId}/results`

      // Step 2: Fetch detailed athlete data
      const detailUrl = `${this.baseUrl}/athlete-analysis-official?raceId=${this.raceId}&pid=${pid}`
      console.log(`[${this.tag} ${this.year}] Fetching details: ${detailUrl}`)

      const detailResponse = await fetchWithTimeout(detailUrl)

      if (!detailResponse.ok || !(await detailResponse.clone().json()).athlete) {
        console.log(`[${this.tag} ${this.year}] Detail fetch failed, using search result data`)
        return { ...this._extractSearchResult(match), resultsUrl }
      }

      const detailData = await detailResponse.json()
      const athlete = detailData.athlete

      console.log(`\n[${this.tag} ${this.year}] FOUND RUNNER:`)
      console.log(`  Name: ${athlete.firstName} ${athlete.lastName}`)
      console.log(`  Bib: ${athlete.bib}`)
      console.log(`  Chip Time: ${athlete.finishChipTime}`)
      console.log(`  Pace: ${athlete.paceTime}`)
      console.log(`  Overall Rank: ${athlete.overallRank}/${athlete.totalAthletes}`)

      return { ...this._extractDetailedResult(athlete), resultsUrl }

    } catch (error) {
      console.error(`[${this.tag} ${this.year}] Error searching for ${runnerName}:`, error.message)
      return {
        ...this.notFoundResult(),
        researchNotes: `Error: ${error.message}`
      }
    }
  }

  /**
   * The pace MyRace's results list prints: round(chip / listPaceMiles), which
   * for CIM is 42.195 km in miles (2025 Colton Smith 12393s shows 7:53;
   * paceTime said 7:52, floor over 26.2 is 7:53 but misses others).
   */
  _listPace(chip) {
    const t = chip ? this.normalizeTime(chip) : null
    return t ? this.paceWith(t, this.config.listPaceMiles || this.config.distanceMiles || 26.2, 'round') : null
  }

  /**
   * Extract from search result (fallback)
   */
  _extractSearchResult(result) {
    const time = this.formatTime(result.finishChipTime)
    const bib = result.bib || null

    const pace = this._listPace(result.finishChipTime)

    return {
      found: true,
      bibNumber: bib ? String(bib) : null,
      officialTime: time,
      officialPace: pace,
      eventType: this.config.defaultEventType || 'Marathon',
      yearFound: this.year,
      researchNotes: null,
      rawData: {
        name: result.name,
        gender: result.gender,
        age: result.age,
        overallRank: result.overallRank,
        totalAthletes: result.totalAthletes,
        chipTime: result.finishChipTime
      }
    }
  }

  /**
   * Extract from detailed athlete analysis
   */
  _extractDetailedResult(athlete) {
    const time = this.formatTime(athlete.finishChipTime)

    // The pace the race's results list shows, never the record's paceTime
    // (null for CIM 2019, and a floor that disagrees with the list otherwise).
    const pace = this._listPace(athlete.finishChipTime)

    return {
      found: true,
      bibNumber: athlete.bib ? String(athlete.bib) : null,
      officialTime: time,
      officialPace: pace,
      eventType: this.config.defaultEventType || 'Marathon',
      yearFound: this.year,
      researchNotes: null,
      rawData: {
        firstName: athlete.firstName,
        lastName: athlete.lastName,
        gender: athlete.gender,
        age: athlete.age,
        city: athlete.city,
        state: athlete.state,
        country: athlete.country,
        overallRank: athlete.overallRank,
        genderRank: athlete.genderRank,
        ageGroupRank: athlete.ageGroupRank,
        ageGroup: athlete.ageGroupName,
        totalAthletes: athlete.totalAthletes,
        gunTime: athlete.finishGunTime,
        chipTime: athlete.finishChipTime,
        pace: athlete.paceTime
      }
    }
  }
}

export default MyRaceAiScraper
