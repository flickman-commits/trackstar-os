/**
 * RunSignUp Platform Scraper
 * Consolidates all races hosted on RunSignUp (Kiawah Island, Louisiana, etc.)
 * Supports two modes:
 *   1. REST API (fast) — if config has eventIds, uses /Rest/race/.../results/get-results
 *   2. Puppeteer (fallback) — launches headless browser for client-side search;
 *      columns are found by header text, and only "Chip Time" is read
 */
import { BaseScraper } from '../BaseScraper.js'
import { launchBrowser } from '../browserLauncher.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Decide a name search from every sold event's own answer. Each event comes
 * back found, ambiguous or not found; the name matches from all of them are
 * pooled and deduped by bib (the same bib twice is one person). One bib is
 * the runner. Several bibs are different people sharing the name, and which
 * event they ran never settles it: Denver Colfax 2026 had a Diego Garcia in
 * the half and two in the marathon, and the half one was printed for a
 * marathon customer. A person picks. `answers` is in eventSearchOrder, so the
 * picker lists earlier events first. A strong name match in one event still
 * outranks a short form in another, as it does within one event. Returns
 * null when no event had a match.
 */
function poolEventAnswers(scraper, runnerName, answers) {
  const people = new Map()
  for (const { result, label } of answers) {
    const rows = result.found
      ? [{ candidate: { name: result.runnerName || result.rawData?.name || null, bib: result.bibNumber, time: result.officialTime, pace: result.officialPace, eventType: result.eventType || label }, result }]
      : result.ambiguous
        ? (result.matches || []).map(m => ({ candidate: { ...m, eventType: m.eventType || label } }))
        : []
    for (const row of rows) {
      const c = row.candidate
      const bib = String(c.bib ?? '').trim()
      const key = bib ? `bib ${bib}` : `${c.name}|${c.time}|${c.eventType}`
      if (!people.has(key)) people.set(key, row)
    }
  }
  if (people.size === 0) return null
  const all = [...people.values()]
  const kept = scraper.filterNameMatches(runnerName, all, p => p.candidate.name || runnerName)
  const list = kept.length ? kept : all
  if (list.length === 1 && list[0].result) return list[0].result
  return scraper.ambiguousResult(list.map(p => p.candidate))
}

export class RunSignUpScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config - Race-specific configuration
   * @param {string} config.raceName - Display name of the race
   * @param {number} config.raceId - RunSignUp race ID
   * @param {string} config.location - City, State
   * @param {string[]} config.eventTypes - e.g. ['Marathon', 'Half Marathon']
   * @param {Object} config.resultSets - year -> { marathon: id, half: id }
   * @param {Object} [config.eventIds] - year -> { marathon: id, half: id } (for REST API)
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.baseUrl = 'https://runsignup.com'
    this.raceId = config.raceId
    this.tag = config.tag || config.raceName
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    const raceDate = this.resolveRaceDate()
    console.log(`[${this.tag} ${this.year}] Calculated race date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)

    return {
      raceDate,
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl: `https://runsignup.com/Race/Results/${this.raceId}`,
      resultsSiteType: 'runsignup',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const yearSets = this.config.resultSets?.[this.year]
    if (!yearSets) {
      console.log(`[${this.tag} ${this.year}] No result sets configured for this year`)
      return this.yearNotConfiguredResult('missing resultSets entry')
    }

    // Try each event type in order (marathon first, then half, etc.)
    const eventOrder = this.config.eventSearchOrder || ['marathon', 'half']
    const yearEventIds = this.config.eventIds?.[this.year]
    const useApi = !!yearEventIds

    if (useApi) {
      console.log(`[${this.tag} ${this.year}] Using REST API (fast path)`)
    }

    // Every sold event is searched, even after one has a match: a namesake in
    // a later event makes it a pick, not the first event's runner.
    const answers = []
    for (const eventKey of eventOrder) {
      const resultSetId = yearSets[eventKey]
      if (!resultSetId) continue

      const eventLabel = this.config.eventLabels?.[eventKey] || eventKey
      console.log(`[${this.tag} ${this.year}] Searching ${eventLabel} results...`)

      let result
      if (useApi && yearEventIds[eventKey]) {
        result = await this.searchEventTypeViaApi(runnerName, eventLabel, resultSetId, yearEventIds[eventKey])
      } else {
        result = await this.searchEventType(runnerName, eventLabel, resultSetId)
      }
      answers.push({ result, label: eventLabel })
    }

    const pooled = poolEventAnswers(this, runnerName, answers)
    if (pooled) return pooled

    console.log(`[${this.tag} ${this.year}] Runner not found in any event type`)
    return this.notFoundResult()
  }

  /**
   * Look a runner up by bib through the REST API's bib_num filter (exact
   * match). Same result sets and event ids as searchRunner, in the same
   * order, so only sold distances are ever searched. Needs eventIds for the
   * year: get-results rejects a request without event_id, and the browser
   * fallback only filters by name, so a year without them cannot search by bib.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    const yearSets = this.config.resultSets?.[this.year]
    if (!yearSets) return this.yearNotConfiguredResult('missing resultSets entry')
    const yearEventIds = this.config.eventIds?.[this.year]
    if (!yearEventIds) return null

    console.log(`[${this.tag} ${this.year}] Bib lookup: ${wanted}`)
    const eventOrder = this.config.eventSearchOrder || ['marathon', 'half']
    for (const eventKey of eventOrder) {
      const resultSetId = yearSets[eventKey]
      const eventId = yearEventIds[eventKey]
      if (!resultSetId || !eventId) continue
      const eventLabel = this.config.eventLabels?.[eventKey] || eventKey

      const apiUrl = `https://runsignup.com/Rest/race/${this.raceId}/results/get-results` +
        `?format=json&resultSetId=${resultSetId}&individual_result_set_id=${resultSetId}&event_id=${eventId}` +
        `&bib_num=${encodeURIComponent(wanted)}&page=1&num=10`
      let data
      try {
        const response = await fetchWithTimeout(apiUrl, { headers: { 'User-Agent': USER_AGENT } })
        if (!response.ok) return this.upstreamErrorResult(`RunSignUp results API returned ${response.status}`)
        data = await response.json()
      } catch (error) {
        console.error(`[${this.tag} ${this.year}] Bib lookup error for ${wanted}:`, error.message)
        return this.upstreamErrorResult(error.message)
      }
      if (data?.error) return this.upstreamErrorResult(`RunSignUp results API error: ${data.error.error_msg || 'unknown'}`)

      const rows = data?.individual_results_sets?.[0]?.results || []
      const r = rows.find(row => this.bibsEqual(row.bib, wanted))
      if (!r) continue

      // Chip time only; clock_time is gun time and is never used.
      const chip = (r.chip_time && String(r.chip_time).trim()) || null
      const match = {
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        bib: String(r.bib).trim(),
        chipTime: chip,
        pace: r.pace || null,
        placeOverall: r.place != null ? String(r.place) : null,
        gender: r.gender || null,
        age: r.age != null ? String(r.age) : null,
        city: r.city || null,
        state: r.state || null
      }
      console.log(`[${this.tag} ${this.year}] BIB MATCH: ${match.name} bib ${match.bib} ${eventLabel} ${chip || 'no chip time'}`)
      const resultsUrl = `${this.baseUrl}/Race/Results/${this.raceId}/${resultSetId}#resultSetId-${resultSetId}`
      return { ...this.extractRunnerData(match, eventLabel), runnerName: match.name, resultsUrl }
    }
    return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)
  }

  /**
   * Search for a runner via RunSignUp REST API (fast, no browser needed)
   */
  async searchEventTypeViaApi(runnerName, eventType, resultSetId, eventId) {
    try {
      // Extract last name for the API query
      const nameParts = runnerName.trim().split(/\s+/)
      const lastName = nameParts[nameParts.length - 1]

      const apiUrl = `https://runsignup.com/Rest/race/${this.raceId}/results/get-results` +
        `?format=json&resultSetId=${resultSetId}&individual_result_set_id=${resultSetId}&event_id=${eventId}` +
        `&last_name=${encodeURIComponent(lastName)}&page=1&num=50`

      console.log(`[${this.tag} ${this.year}] API request: ${apiUrl}`)

      const response = await fetchWithTimeout(apiUrl, {
        headers: { 'User-Agent': USER_AGENT }
      })

      if (!response.ok) {
        console.log(`[${this.tag} ${this.year}] API returned ${response.status}, falling back to Puppeteer`)
        return await this.searchEventType(runnerName, eventType, resultSetId)
      }

      const data = await response.json()
      const resultSet = data?.individual_results_sets?.[0]
      const rawResults = resultSet?.results || []

      console.log(`[${this.tag} ${this.year}] API returned ${rawResults.length} results`)

      if (rawResults.length === 0) {
        return this.notFoundResult()
      }

      // Map API results to our standard format.
      // IMPORTANT: ONLY use chip_time. RunSignUp's `clock_time` is gun time —
      // never fall back to it. If chip_time is missing, we'd rather report
      // a missing time than the wrong (gun) time and have the order printed wrong.
      const results = rawResults.map(r => {
        const chip = (r.chip_time && String(r.chip_time).trim()) || null
        if (!chip && r.clock_time) {
          console.warn(`[${this.tag} ${this.year}] Runner ${r.first_name} ${r.last_name} has clock_time but no chip_time - refusing to use gun time`)
        }
        return {
          name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
          bib: r.bib != null ? String(r.bib) : null,
          chipTime: chip,
          pace: r.pace || null,
          placeOverall: r.place != null ? String(r.place) : null,
          gender: r.gender || null,
          age: r.age != null ? String(r.age) : null,
          city: r.city || null,
          state: r.state || null
        }
      })

      // Filter for exact name matches
      const matches = this.filterNameMatches(runnerName, results, r => r.name)
      console.log(`[${this.tag} ${this.year}] Exact matches: ${matches.length}`)

      if (matches.length === 0) {
        console.log(`[${this.tag} ${this.year}] No exact match. Surfacing ${Math.min(results.length, 10)} candidates as possibleMatches:`)
        results.slice(0, 10).forEach(r => console.log(`  - ${r.name} (${r.chipTime})`))
        return this.notFoundResult(null, results.slice(0, 10).map(r => ({
          name: r.name,
          bib: r.bib,
          time: r.chipTime,
          pace: r.pace,
          city: r.city,
          state: r.state,
          eventType
        })))
      }

      if (matches.length > 1) {
        console.log(`[${this.tag} ${this.year}] Multiple matches:`)
        matches.forEach(m => console.log(`  - ${m.name}, Bib: ${m.bib}, Time: ${m.chipTime}`))
        return this.ambiguousResult(matches.map(m => ({
          name: m.name,
          bib: m.bib,
          time: m.chipTime
        })))
      }

      const match = matches[0]
      console.log(`\n[${this.tag} ${this.year}] FOUND RUNNER (via API):`)
      console.log(`  Name: ${match.name}`)
      console.log(`  Bib: ${match.bib}`)
      console.log(`  Chip Time: ${match.chipTime}`)
      console.log(`  Pace: ${match.pace}`)
      console.log(`  Place: ${match.placeOverall}`)

      const resultsUrl = `${this.baseUrl}/Race/Results/${this.raceId}/${resultSetId}#resultSetId-${resultSetId}`
      return { ...this.extractRunnerData(match, eventType), resultsUrl }

    } catch (error) {
      console.error(`[${this.tag} ${this.year}] API error: ${error.message}, falling back to Puppeteer`)
      return await this.searchEventType(runnerName, eventType, resultSetId)
    }
  }

  /**
   * Search for a runner in a specific event type via Puppeteer (fallback)
   */
  async searchEventType(runnerName, eventType, resultSetId) {
    let browser = null

    try {
      console.log(`[${this.tag} ${this.year}] Launching browser...`)
      browser = await launchBrowser()
      const page = await browser.newPage()

      const resultsUrl = `${this.baseUrl}/Race/Results/${this.raceId}/${resultSetId}#resultSetId-${resultSetId}`
      console.log(`[${this.tag} ${this.year}] Loading results: ${resultsUrl}`)

      await page.goto(resultsUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      })

      // Wait for the page to render
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Wait for search input
      await page.waitForSelector('input#resultsSearch', { timeout: 15000 })
      console.log(`[${this.tag} ${this.year}] Search box loaded`)

      // Type the runner name
      await page.type('input#resultsSearch', runnerName)
      console.log(`[${this.tag} ${this.year}] Typed search query: ${runnerName}`)

      // Wait for client-side filtering
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Extract visible results. Columns differ per race (Louisiana puts
      // split columns before "Clock Time" and "Chip Time"), and a results
      // page can hold several tables, so every column is located by its own
      // table's header text, never by a fixed index. "Clock Time" is gun
      // time and is never read; a table with no chip column yields nothing.
      const { results, tablesWithoutChip } = await page.evaluate(() => {
        const text = el => (el?.innerText || '').trim()
        const out = []
        let tablesWithoutChip = 0
        for (const table of document.querySelectorAll('table')) {
          const headers = Array.from(table.querySelectorAll('thead th'))
            .map(th => text(th).replace(/\s+/g, ' ').toLowerCase())
          if (headers.length === 0) continue
          const col = (...patterns) => headers.findIndex(h => patterns.some(re => re.test(h)))
          const nameCol = col(/^name$/, /^participant$/)
          if (nameCol === -1) continue
          const chipCol = col(/^chip time$/, /^chip$/, /^net time$/)
          if (chipCol === -1) { tablesWithoutChip++; continue }
          const idx = {
            place: col(/^place$/, /^overall place$/),
            pace: col(/^pace$/),
            bib: col(/^bib$/),
            gender: col(/^gender$/, /^sex$/),
            age: col(/^age$/),
            city: col(/^city$/),
            state: col(/^state$/)
          }
          for (const row of table.querySelectorAll('tbody tr')) {
            if (window.getComputedStyle(row).display === 'none') continue
            const cells = row.querySelectorAll('td')
            if (cells.length <= Math.max(nameCol, chipCol)) continue
            const cell = i => (i >= 0 ? text(cells[i]) : '') || null
            // The name cell carries an avatar initial ("J John Barham");
            // the link holds just the name.
            const nameLink = cells[nameCol].querySelector('.participantName__nameLink, a')
            // The time cell can carry a "Video" link under the time.
            const chipTime = (text(cells[chipCol]).match(/\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?/) || [null])[0]
            out.push({
              placeOverall: cell(idx.place),
              pace: cell(idx.pace),
              bib: cell(idx.bib),
              name: text(nameLink || cells[nameCol]).replace(/\s+/g, ' '),
              gender: cell(idx.gender),
              city: cell(idx.city),
              state: cell(idx.state),
              chipTime,
              age: cell(idx.age)
            })
          }
        }
        return { results: out, tablesWithoutChip }
      })

      if (results.length === 0 && tablesWithoutChip > 0) {
        console.warn(`[${this.tag} ${this.year}] ${tablesWithoutChip} results table(s) have no Chip Time column - refusing to use clock (gun) time`)
      }
      console.log(`[${this.tag} ${this.year}] Found ${results.length} visible results after filtering`)

      if (results.length === 0) {
        return this.notFoundResult(tablesWithoutChip > 0 ? 'Results page shows no chip time column; clock (gun) time is not used' : undefined)
      }

      // Filter for exact name matches
      const matches = this.filterNameMatches(runnerName, results, r => r.name)
      console.log(`[${this.tag} ${this.year}] Exact matches after name filtering: ${matches.length}`)

      if (matches.length === 0) {
        console.log(`[${this.tag} ${this.year}] No exact match for: ${runnerName}. Surfacing ${Math.min(results.length, 10)} candidates.`)
        return this.notFoundResult(null, results.slice(0, 10).map(r => ({
          name: r.name,
          bib: r.bib,
          time: r.chipTime,
          pace: r.pace,
          city: r.city,
          state: r.state,
          eventType
        })))
      }

      if (matches.length > 1) {
        console.log(`[${this.tag} ${this.year}] Multiple exact matches found:`)
        matches.forEach(m => {
          console.log(`  - ${m.name}, Bib: ${m.bib}, Time: ${m.chipTime}`)
        })
        return this.ambiguousResult(matches.map(m => ({
          name: m.name,
          bib: m.bib,
          time: m.chipTime
        })))
      }

      // Single match found
      const match = matches[0]
      if (!match.chipTime) {
        return this.notFoundResult(`${match.name} has no chip time on the results page; clock (gun) time is not used`)
      }

      console.log(`\n[${this.tag} ${this.year}] FOUND RUNNER:`)
      console.log(`  Name: ${match.name}`)
      console.log(`  Bib: ${match.bib}`)
      console.log(`  Chip Time: ${match.chipTime}`)
      console.log(`  Pace: ${match.pace}`)
      console.log(`  Place: ${match.placeOverall}`)

      return { ...this.extractRunnerData(match, eventType), resultsUrl }

    } catch (error) {
      console.error(`[${this.tag} ${this.year}] Error searching for ${runnerName}:`, error.message)
      return {
        ...this.notFoundResult(),
        researchNotes: `Error: ${error.message}`
      }
    } finally {
      // Always release the browser — a leaked Chromium instance (~100MB+)
      // is an OOM risk on Vercel.
      if (browser) {
        await browser.close().catch(e =>
          console.error(`[${this.tag} ${this.year}] Failed to close browser:`, e.message))
      }
    }
  }

  /**
   * Extract standardized data from RunSignUp result object
   */
  extractRunnerData(result, eventType = 'Marathon') {
    // Some RunSignUp timers (e.g. Competitive Timing / Missoula) report chip
    // times with hundredths ("2:45:55.71") — round to the nearest second.
    const time = this.formatTime(this.roundTime(result.chipTime))
    const bib = result.bib || null
    // Pace is the "Pace" column the RunSignUp results page shows (the REST
    // row's `pace`; the browser path reads the same column). It is computed
    // from the hundredths, so recomputing from the rounded time is a second
    // off for ~2% of runners, and Bangor's is clock-based. Computed from chip
    // time over the matched distance only when the page has no pace.
    const key = Object.keys(this.config?.eventLabels || {}).find(k => this.config.eventLabels[k] === eventType)
    const distanceMiles = (key && this.config?.distances?.[key]) || (/half/i.test(eventType) ? 13.1 : 26.2)
    const pace = this.cleanPagePace(result.pace) ?? this.calculatePace(time, distanceMiles)

    return {
      found: true,
      bibNumber: bib ? String(bib) : null,
      officialTime: time,
      officialPace: pace,
      eventType: eventType,
      yearFound: this.year,
      researchNotes: null,
      rawData: {
        name: result.name,
        gender: result.gender,
        age: result.age,
        city: result.city,
        state: result.state,
        placeOverall: result.placeOverall,
        chipTime: result.chipTime,
        pace: result.pace
      }
    }
  }
}

export default RunSignUpScraper
