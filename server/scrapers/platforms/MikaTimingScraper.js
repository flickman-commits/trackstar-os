/**
 * Mika Timing Platform Scraper
 * Consolidates all races using Mika Timing results sites
 * (Boston, Chicago, Berlin, London).
 * Uses fetch + cheerio. Two list layouts exist:
 *   - <li class="list-group-item row"> rows (Boston 2018+, Chicago, Berlin)
 *   - <table class="list-table"> rows (Boston 2010-2017, London 2015):
 *     columns are read by their <th> label, so "Finish Net" (chip) is taken
 *     and "Finish Gun" is never used.
 *
 * Years a site does not host: Mika answers /{year}/ for a missing year by
 * redirecting to the live edition (boston.r.mikatiming.com/1999/ ends up on
 * /1999/2026/), and the chicago-history archive answers an unknown
 * event_main_group with the 2025 list. Both used to read as "runner not
 * found". _shownEdition() catches them and the result is year_not_configured
 * with a "results for that year are not available" note.
 */
import { BaseScraper } from '../BaseScraper.js'
import * as cheerio from 'cheerio'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class MikaTimingScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {string} config.baseUrlPattern - e.g. 'https://results.chicagomarathon.com/{year}'
   * @param {string} config.eventCode - e.g. 'MAR'
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    // An archive instance (Chicago's chicago-history site) serves many
    // editions from one base URL, picked by event_main_group.
    const archive = config.archive
    this.baseUrl = archive && year >= archive.fromYear && year <= archive.toYear
      ? archive.baseUrl
      : config.baseUrlPattern.replace('{year}', year)
  }

  /** The edition folder in the base URL (/2015, /2025), or null. */
  _siteYear() {
    const m = this.baseUrl.match(/\/(\d{4})\/?$/)
    return m ? parseInt(m[1], 10) : null
  }

  /**
   * The results site does not have this year. Same status as an unwired year
   * (year_not_configured) so the order shows as a scraper/year problem, not a
   * missing runner, with a note saying the results are not available.
   */
  yearNotAvailableResult(detail) {
    return {
      ...this.yearNotConfiguredResult(),
      researchNotes: `Results for ${this.raceName} ${this.year} are not available on the results site` +
        (detail ? ` (${detail})` : '') + '. Research the runner by hand from another source.',
    }
  }

  /** A year the config says the site does not host, checked before any request. */
  _configuredUnavailable() {
    const first = this.config.firstResultsYear
    if (first && this.year < first) return `${this.raceName} results on this site start in ${first}`
    if ((this.config.missingYears || []).includes(this.year)) return `no ${this.year} edition on the results site`
    return null
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    let raceDate = null

    // Try to scrape the actual race date from the results page
    try {
      const resultsUrl = `${this.baseUrl}/?pid=list&event_main_group=${this.year}`
      const response = await fetchWithTimeout(resultsUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }
      })

      if (response.ok) {
        const html = await response.text()
        const scraped = this._extractRaceDateFromHtml(html)
        // A date outside the requested year means we read the wrong edition.
        if (scraped && scraped.getFullYear() !== this.year) {
          console.warn(`[${this.tag} ${this.year}] Ignoring scraped date ${scraped.toDateString()}: wrong year`)
        } else {
          raceDate = scraped
        }
      }
    } catch (error) {
      console.log(`[${this.tag} ${this.year}] Failed to scrape race date:`, error.message)
    }

    if (!raceDate) {
      raceDate = this.resolveRaceDate()
      console.log(`[${this.tag} ${this.year}] Using fallback date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)
    } else {
      console.log(`[${this.tag} ${this.year}] Parsed date from HTML: ${raceDate ? raceDate.toDateString() : 'unknown'}`)
    }

    return {
      raceDate,
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon'],
      resultsUrl: `${this.baseUrl}/?pid=list&event_main_group=${this.year}`,
      resultsSiteType: 'mika',
    }
  }

  /**
   * Resolve the event code for the current year. Tries (in order):
   *   1. config.eventCodes[year] — hardcoded per-year mapping
   *   2. config.eventCode — single static code (e.g. 'R', 'MAR')
   *   3. Auto-discovery — fetch the year's listing page and extract `event=XXX`
   */
  async resolveEventCode() {
    if (this.config.eventCodes?.[this.year]) return this.config.eventCodes[this.year]
    if (this.config.eventCode) return this.config.eventCode
    // Fallback: discover from listing page
    try {
      const url = `${this.baseUrl}/?pid=list&event_main_group=${this.year}`
      const resp = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
      if (!resp.ok) return null
      const html = await resp.text()
      const match = html.match(/event=([A-Z][A-Z0-9_]+)/)
      if (match) {
        console.log(`[${this.tag} ${this.year}] Auto-discovered event code: ${match[1]}`)
        return match[1]
      }
    } catch (err) {
      console.warn(`[${this.tag} ${this.year}] Event code discovery failed: ${err.message}`)
    }
    return 'MAR' // last-resort default
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const unavailable = this._configuredUnavailable()
    if (unavailable) return this.yearNotAvailableResult(unavailable)

    try {
      // A middle initial is not part of the surname: "Bill G. Schuette" sent
      // search[name]=G. Schuette and Mika found nobody. Drop initials between
      // the first name and the surname; multi-word surnames are kept whole.
      // A leading initial ("G. Peter Maiers") is not a first name Mika can
      // search on either: search[firstname]=G. finds nobody. Search on the
      // next word; the full name still goes to filterNameMatches.
      const isInitial = w => /^[A-Za-z]\.?$/.test(w)
      let words = runnerName.trim().split(/\s+/)
      if (words.length > 2 && isInitial(words[0])) words = words.slice(1)
      const nameParts = words.length > 2
        ? [words[0], ...words.slice(1, -1).filter(w => !isInitial(w)), words[words.length - 1]]
        : words
      const firstName = nameParts.length > 1 ? nameParts[0] : ''
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0]

      const eventCode = await this.resolveEventCode()

      let page = await this._searchPage(eventCode, lastName, firstName)
      // Mika matches the first name literally, so "Bill Schuette" finds nobody
      // when he registered as William. Retry on the surname alone and let
      // filterNameMatches (which knows nicknames) choose among the results.
      if (page.ok && !page.yearMismatch && !page.results.length && firstName) {
        console.log(`[${this.tag}] No results for first name "${firstName}"; retrying on surname only`)
        page = await this._searchPage(eventCode, lastName, '')
      }
      // A refused search is the site, not the runner: Chicago's results answered
      // 403 with a "temporarily unavailable" page for days in October 2026 and
      // nine orders sat as "Runner not found" instead of being retried.
      if (!page.ok) return page.status === 404 ? this.notFoundResult() : this.upstreamErrorResult(`Results site returned ${page.status}`)

      const { searchUrl, results, yearMismatch } = page

      // Safety check: the site answered with another edition (a redirect to
      // the live year, or an archive falling back to its newest year).
      if (yearMismatch) {
        console.error(`[${this.tag}] YEAR MISMATCH: Expected ${this.year}, got ${yearMismatch}`)
        return this.yearNotAvailableResult(`requested ${this.year}, the site answered with ${yearMismatch}`)
      }

      console.log(`[${this.tag}] Found ${results.length} results in HTML`)

      if (!results.length) return this.notFoundResult()

      // Log results
      console.log(`[${this.tag}] Results found:`)
      results.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.name} - Bib: ${r.bib}, Time: ${r.finishTime}`)
      })

      // Filter for name matches
      const matches = this.filterNameMatches(runnerName, results, r => r.name)
      console.log(`[${this.tag}] Exact matches after filtering: ${matches.length}`)

      if (matches.length === 0) {
        console.log(`[${this.tag}] No exact match for: ${runnerName}. Surfacing ${Math.min(results.length, 10)} candidates.`)
        return this.notFoundResult(null, results.slice(0, 10).map(r => this._candidate(r)))
      }

      if (matches.length > 1) {
        return this.ambiguousResult(matches.map(m => this._candidate(m)))
      }

      // Single match
      const runner = matches[0]
      console.log(`\n[${this.tag}] FOUND RUNNER:`)
      console.log(`  Name: ${runner.name}`)
      console.log(`  Bib: ${runner.bib}`)
      console.log(`  Time: ${runner.finishTime}`)

      return { ...(await this._withDetailPace(this._extractRunnerData(runner), runner)), resultsUrl: searchUrl }

    } catch (error) {
      console.error(`[${this.tag}] Error searching for ${runnerName}:`, error.message)
      return {
        ...this.notFoundResult(),
        researchNotes: `Error: ${error.message}`
      }
    }
  }

  /**
   * Look a runner up by bib. Mika list pages take search[start_no]; the
   * listing is filtered to the same event code searchRunner uses, so only the
   * sold race (the marathon) is searched. The row is parsed and shaped by the
   * same helpers as a name match, so time and pace are identical.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    const unavailable = this._configuredUnavailable()
    if (unavailable) return this.yearNotAvailableResult(unavailable)
    console.log(`[${this.tag} ${this.year}] Bib lookup: ${wanted}`)
    try {
      const eventCode = await this.resolveEventCode()
      const page = await this._fetchListPage({
        pid: 'list',
        event_main_group: String(this.year),
        'search[start_no]': wanted,
        event: eventCode,
        num_results: '50',
      })
      if (!page.ok) return this.upstreamErrorResult(`Results site returned ${page.status}`)
      if (page.yearMismatch) {
        return this.yearNotAvailableResult(`requested ${this.year}, the site answered with ${page.yearMismatch}`)
      }
      const hits = page.results.filter(r => this.bibsEqual(r.bib, wanted))
      if (!hits.length) return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)
      const runner = hits[0]
      console.log(`[${this.tag}] BIB MATCH: ${runner.name} bib ${runner.bib} ${runner.finishTime || 'no time'}`)
      return { ...(await this._withDetailPace(this._extractRunnerData(runner), runner)), runnerName: runner.name, resultsUrl: page.searchUrl }
    } catch (error) {
      console.error(`[${this.tag}] Bib lookup error for ${wanted}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }
  }

  /** Fetch and parse one list page with the given query params. */
  async _fetchListPage(params) {
    const searchUrl = `${this.baseUrl}/?${new URLSearchParams(params).toString()}`
    console.log(`[${this.tag}] Search URL: ${searchUrl}`)
    const response = await fetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    })
    console.log(`[${this.tag}] Response status: ${response.status}`)
    if (!response.ok) return { ok: false, status: response.status, searchUrl, results: [] }
    const html = await response.text()
    // Down for maintenance, Mika redirects to a static "Temporarily
    // Unavailable" page that answers 200 (Chicago, October 2026).
    if (/\/unavailable\.html/i.test(response.url || '') || /<title>\s*Temporarily Unavailable/i.test(html)) {
      return { ok: false, status: 503, searchUrl, results: [] }
    }
    const yearMismatch = this._shownEdition(html, response.url)
    return { ok: true, searchUrl, yearMismatch, results: yearMismatch ? [] : this._parseResultsHtml(html, params.event) }
  }

  /** One list-page search. firstName may be empty for a surname-only search. */
  async _searchPage(eventCode, lastName, firstName) {
    const params = {
      pid: 'list',
      event_main_group: String(this.year),
      'search[name]': lastName,
    }
    if (firstName) params['search[firstname]'] = firstName
    Object.assign(params, { event: eventCode, num_results: '50', search_sort: 'name' })
    return this._fetchListPage(params)
  }

  /**
   * Parse Mika Timing HTML results
   * Each result row is an <li> with class "list-group-item row"
   */
  _parseResultsHtml(html, eventCode = null) {
    const $ = cheerio.load(html)
    const runners = []
    // The chicago-history archive does not filter on event=MAR: wheelchair
    // rows (class event-WHL_...) come back mixed in. Rows carry their event in
    // a class, so drop any whose event family differs from the one searched.
    const family = code => String(code || '').split('_')[0]

    $('li.list-group-item.row').not('.list-group-header').each((_, el) => {
      try {
        const $row = $(el)

        // Skip no-results alerts
        if ($row.find('.alert').length > 0) return

        const rowEvent = (($row.attr('class') || '').match(/\bevent-([A-Za-z0-9_]+)/) || [])[1]
        if (eventCode && rowEvent && family(rowEvent) !== family(eventCode)) return

        // Extract name from h4.type-fullname a
        const nameLink = $row.find('h4.type-fullname a, .type-fullname a')
        let fullName = nameLink.text().trim()
        if (!fullName) return

        // Remove country code in parentheses
        fullName = fullName.replace(/\s*\([A-Z]{2,3}\)\s*$/, '').trim()

        // Convert "LastName, FirstName" to "FirstName LastName"
        if (fullName.includes(',')) {
          const [last, first] = fullName.split(',').map(s => s.trim())
          fullName = `${first} ${last}`
        }

        // Extract places
        const overallPlace = $row.find('.type-place.place-secondary').first().text().trim()
        const genderPlace = $row.find('.type-place.place-primary').first().text().trim()

        // Extract BIB / Runner Number
        // The label differs by instance: Boston/Chicago print "BIB" or
        // "Runner Number", Berlin prints "Bib Number" in mixed case. The
        // uppercase-only match missed Berlin entirely, so every Berlin year
        // came back with no bib. Elite bibs can be alphanumeric ("F2").
        let bib = ''
        $row.find('.type-field').each((_, field) => {
          const text = $(field).text().trim()
          // No word boundaries: Boston/Chicago glue the label to the value ("BIB2").
          if (/bib|runner\s*number/i.test(text)) {
            bib = text.replace(/bib(\s*number)?|runner\s*number/gi, '').trim()
          } else if (/^\d{4,6}$/.test(text)) {
            bib = text
          }
        })

        // Extract division
        const divisionText = $row.find('.type-age_class').text().trim()
        const division = divisionText.replace(/Division/gi, '').trim()

        // Extract times
        // Boston Marathon shows BOTH "Finish Net" (chip time) and "Finish Gun" (gun time).
        // We always prefer chip time. Fall back to plain "Finish" (Chicago, etc.)
        // and explicitly skip gun time.
        let halfTime = ''
        let finishTime = ''
        let finishTimeIsChip = false
        $row.find('.type-time').each((_, field) => {
          const $field = $(field)
          const label = $field.find('.list-label').text().trim()
          const labelUpper = label.toUpperCase()
          const timeMatch = $field.text().match(/(\d{1,2}:\d{2}:\d{2})/)
          const time = timeMatch ? timeMatch[1] : ''
          if (!time) return

          if (labelUpper.includes('HALF')) {
            halfTime = time
          } else if (labelUpper.includes('NET') || labelUpper === 'CHIP' || labelUpper.includes('CHIP')) {
            // Chip / net time — preferred (Boston: "Finish Net")
            finishTime = time
            finishTimeIsChip = true
          } else if (labelUpper.includes('GUN')) {
            // Explicitly skip gun time — never use it as the finish time
            return
          } else if (labelUpper.includes('FINISH')) {
            // Plain "Finish" (Chicago, etc.) — only use if no chip time has been set yet
            if (!finishTimeIsChip) finishTime = time
          }
        })

        if (fullName && (bib || finishTime)) {
          runners.push({
            name: fullName,
            bib,
            finishTime,
            halfTime,
            detailHref: $row.find('a[href*="content=detail"]').attr('href') || null,
            overallPlace,
            genderPlace,
            division
          })
        }
      } catch (err) {
        console.error(`[${this.tag}] Error parsing row:`, err.message)
      }
    })

    if (!runners.length) runners.push(...this._parseTableHtml($))
    return runners
  }

  /**
   * Older Mika list layout (Boston 2010-2017): a <table class="list-table">
   * whose header cells name each column, e.g. Boston 2015:
   *   Place Overall | Place Gender | Place Division | Name | BIB | HALF |
   *   Finish Net | Finish Gun
   * Boston 2010-2013 add "Prj. Finish" (a projection, never a result) and
   * label the name column "Lastname". Columns are found by label, so
   * "Finish Net" is the chip time and "Finish Gun" is skipped.
   */
  _parseTableHtml($) {
    const runners = []
    $('table.list-table').each((_, table) => {
      const $table = $(table)
      // Mika prefixes these labels with a hidden "aa " sort marker.
      const headers = $table.find('thead th').map((_, th) =>
        $(th).text().replace(/^\s*aa\s+/i, '').trim().toUpperCase()).get()
      if (!headers.length) return
      const col = test => headers.findIndex(test)
      const nameCol = col(h => /NAME/.test(h))
      const bibCol = col(h => /^BIB$|RUNNER\s*NO|START\s*NO/.test(h))
      const halfCol = col(h => /HALF/.test(h))
      const netCol = col(h => /FINISH/.test(h) && /NET|CHIP/.test(h))
      // Plain "Finish" only; never gun, never a projected finish.
      const plainFinishCol = col(h => /FINISH/.test(h) && !/NET|CHIP|GUN|PRJ|PROJ/.test(h))
      const overallCol = col(h => /PLACE\s*OVERALL/.test(h))
      const genderCol = col(h => /PLACE\s*GENDER/.test(h))
      // The age group itself ("Category" on London 2015), not "Place Division"
      // (Boston), which is a place.
      const divisionCol = col(h => /^(DIVISION|CATEGORY|AGE\s*GROUP)$/.test(h))
      const finishCol = netCol >= 0 ? netCol : plainFinishCol

      $table.find('tbody tr').each((_, tr) => {
        try {
          const cells = $(tr).children('td').map((_, td) => $(td).text().replace(/\u00bb/g, '').trim()).get()
          const cell = i => (i >= 0 && i < cells.length ? cells[i] : '')
          const timeOf = i => (cell(i).match(/(\d{1,2}:\d{2}:\d{2})/) || [])[1] || ''
          // Prefer the linked name; fall back to the header-indexed cell.
          let fullName = $(tr).find('td a[href*="content=detail"]').first().text().trim() || cell(nameCol)
          fullName = fullName.replace(/\s*\([A-Z]{2,3}\)\s*$/, '').trim()
          if (!fullName) return
          if (fullName.includes(',')) {
            const [last, first] = fullName.split(',').map(x => x.trim())
            fullName = `${first} ${last}`
          }
          const bib = cell(bibCol)
          const finishTime = timeOf(finishCol)
          if (!bib && !finishTime) return
          runners.push({
            name: fullName,
            bib,
            finishTime,
            halfTime: timeOf(halfCol),
            overallPlace: cell(overallCol),
            genderPlace: cell(genderCol),
            division: cell(divisionCol),
          })
        } catch (err) {
          console.error(`[${this.tag}] Error parsing table row:`, err.message)
        }
      })
    })
    return runners
  }

  /**
   * A suggestion or ambiguous-match row. Built from the same numbers as a
   * direct match, so a runner picked from the list gets the same chip time,
   * computed pace and bib as one found outright. Suggestions used to carry
   * the raw time and no pace, and the shopper's card came back half empty.
   */
  _candidate(r) {
    const d = this._extractRunnerData(r)
    return {
      name: r.name,
      bib: d.bibNumber,
      time: d.officialTime,
      pace: d.officialPace,
      city: r.city,
      state: r.state,
      eventType: d.eventType,
    }
  }

  /**
   * Boston prints pace only on the runner's detail page ("min/mile 06:21",
   * net-based), worked out from fractional seconds the list hides, so no
   * formula over the shown time matches it (round over 26.2 missed 6 of 74).
   * Configs set detailPace: true to read it; the computed pace stays if the
   * page cannot be read. Berlin's detail page has no per-mile pace.
   */
  async _withDetailPace(result, runner) {
    if (!this.config.detailPace || !runner.detailHref) return result
    try {
      const res = await fetchWithTimeout(new URL(runner.detailHref, `${this.baseUrl}/`).toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
      if (!res.ok) return result
      const $ = cheerio.load(await res.text())
      // Exactly "min/mile": the splits table's "Min/mile" header is a <th> too.
      const th = $('th').filter((_, el) => $(el).text().trim() === 'min/mile' && $(el).next().is('td')).first()
      const pace = this.cleanPagePace(th.next('td').text().trim())
      return pace ? { ...result, officialPace: pace } : result
    } catch (err) {
      console.log(`[${this.tag}] Detail pace not read: ${err.message}`)
      return result
    }
  }

  _extractRunnerData(runner) {
    const rawTime = runner.finishTime || null
    const time = this.formatTime(rawTime)
    const distanceMiles = this.config.distanceMiles || 26.2
    const rawPace = rawTime ? this.calculatePace(rawTime, distanceMiles) : null
    const pace = this.formatPace(rawPace)

    return {
      found: true,
      bibNumber: runner.bib ? String(runner.bib) : null,
      officialTime: time,
      officialPace: pace,
      eventType: this.config.defaultEventType || 'Marathon',
      yearFound: this.year,
      researchNotes: null,
      rawData: {
        name: runner.name,
        halfTime: runner.halfTime,
        overallPlace: runner.overallPlace,
        genderPlace: runner.genderPlace,
        division: runner.division
      }
    }
  }

  /**
   * Which edition the page actually shows, when it is not the one asked for.
   * Returns that year (as a string) or null when the page is the right one.
   *
   *   1. Redirect: Mika sends a missing /{year}/ to the live edition, e.g.
   *      boston.r.mikatiming.com/1999/ -> /1999/2026/ and
   *      results.chicagomarathon.com/2003/ -> /2003/2026/.
   *   2. Site edition: every Mika page carries "meeting_year":"YYYY" for the
   *      instance it is. It must match the base URL's folder (/2015 for
   *      Boston 2015, /2025 for the chicago-history archive).
   *   3. Heading: "Results: YYYY / All" names the edition listed. The archive
   *      falls back to 2025 for a year it lacks (1970, 2020) and says so here.
   */
  _shownEdition(html, finalUrl) {
    const siteYear = this._siteYear()
    if (siteYear && finalUrl) {
      try {
        const folders = [...new URL(finalUrl).pathname.matchAll(/\/(\d{4})(?=\/|$)/g)].map(m => parseInt(m[1], 10))
        const last = folders[folders.length - 1]
        if (last && last !== siteYear) return String(last)
      } catch { /* unparseable URL: fall through to the page checks */ }
    }
    const meeting = String(html).match(/"meeting_year":"(\d{4})"/)
    if (siteYear && meeting && parseInt(meeting[1], 10) !== siteYear) return meeting[1]
    return this._checkYearMismatch(html)
  }

  /**
   * Check if the results page heading names a different year than requested.
   * Returns the mismatched year string if found, or null if OK.
   */
  _checkYearMismatch(html) {
    const $ = cheerio.load(html)
    // Mika Timing pages show "Results: YYYY / All" in the heading
    const headingText = $('h3, h2, .page-heading, .results-heading').text()
    const match = headingText.match(/Results:\s*(\d{4})\s*\//)
    if (match) {
      const pageYear = parseInt(match[1], 10)
      if (pageYear !== this.year) {
        return match[1]
      }
    }
    return null
  }

  /**
   * Extract race date from Mika Timing HTML
   */
  _extractRaceDateFromHtml(html) {
    const $ = cheerio.load(html)

    const candidates = []
    $('h1, h2, h3, .header, .headline, .content, .intro, #content').each((_, el) => {
      const text = $(el).text().trim()
      if (text) candidates.push(text)
    })
    if (candidates.length === 0) candidates.push($.text())

    const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December'
    const dateRegex = new RegExp(`(${monthNames})\\s+\\d{1,2},\\s+${this.year}`, 'i')

    for (const text of candidates) {
      const match = text.match(dateRegex)
      if (match) {
        const parsed = new Date(match[0])
        if (!isNaN(parsed.getTime())) return parsed
      }
    }

    return null
  }
}

export default MikaTimingScraper
