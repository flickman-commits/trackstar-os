/**
 * SVE Timing Platform Scraper (results.svetiming.com — US Sports Timing)
 *
 * Server-rendered HTML, so fetch + cheerio; no browser needed.
 *
 * URL shape:
 *   https://results.svetiming.com/{organizer}/events/{year}/{eventSlug}/results
 *   https://results.svetiming.com/{organizer}/events/{year}/{eventSlug}/search/all?q=...
 *
 * Result rows are: Bib | Name | Division | Gun Elapsed | Chip Elapsed | City | Age
 * Gun and Chip sit in ADJACENT columns, which is exactly how a wrong-time bug
 * ships. Column 4 (Chip Elapsed) is the one we want; see _parseRows.
 *
 * SEARCHING. The site's `q` is a plain substring match over the entrant's
 * name, which is a trap for nicknames: querying "Chris Jones" returns nothing
 * when the entrant is registered as "CHRISTOPHER JONES", because the literal
 * string does not appear. Searching the full name alone would therefore report
 * not-found for exactly the orders our nickname/prefix matching exists to
 * catch. So we search the LAST NAME and match locally with
 * BaseScraper.filterNameMatches, which also lets a genuinely ambiguous field
 * (a Christopher and a Christian with the same surname) reach the ambiguous
 * branch instead of silently picking one.
 *
 * PAGINATION. The site caps a search at 50 rows and its pager is client-side
 * only — no GET or POST parameter reaches page 2 (verified against several).
 * A surname with more than 50 entrants is therefore truncated. Rather than let
 * that masquerade as "runner not found", _searchDivision reports the truncation
 * and searchRunner surfaces it as an upstream limitation the operator can act
 * on. Silent partial results are how you print the wrong person's time.
 */
import { BaseScraper } from '../BaseScraper.js'
import * as cheerio from 'cheerio'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BASE = 'https://results.svetiming.com'

export class SVETimingScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.organizer  - e.g. 'Corrigan-Sports-Enterprises'
   * @param {string} config.eventSlug  - e.g. 'baltimore-running-festival'
   * @param {Object} config.divisionMap - distance key -> division-name regex
   * @param {Object} config.distances   - distance key -> miles
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
  }

  get eventUrl() {
    return `${BASE}/${this.config.organizer}/events/${this.year}/${this.config.eventSlug}`
  }

  async getRaceInfo() {
    let scraped = null
    try {
      const res = await fetchWithTimeout(`${this.eventUrl}/results`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }
      }, 15000)
      if (res.ok) {
        const html = await res.text()
        // The page title carries the real race day, e.g.
        // "Race Results for October 18, 2025 Baltimore Running Festival"
        const title = cheerio.load(html)('title').text() || ''
        const m = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i)
        if (m) {
          const parsed = new Date(`${m[1]} ${m[2]}, ${m[3]}`)
          if (!isNaN(parsed.valueOf())) scraped = parsed
        }
      }
    } catch (error) {
      console.log(`[${this.tag} ${this.year}] Could not scrape race date: ${error.message}`)
    }

    return {
      // This event runs on a single day, so the page's date IS race day.
      raceDate: this.resolveRaceDate(scraped),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl: `${this.eventUrl}/results`,
      resultsSiteType: 'svetiming'
    }
  }

  /**
   * Parse the entrant table. Column order is fixed by the site:
   *   0 Bib | 1 Name | 2 Division | 3 Gun Elapsed | 4 Chip Elapsed | 5 City | 6 Age
   */
  _parseRows(html) {
    const $ = cheerio.load(html)
    const rows = []
    $('tr.clickable').each((_, el) => {
      const cells = $(el).find('td').map((__, td) => $(td).text().trim()).get()
      if (cells.length < 5) return
      rows.push({
        bib: cells[0] || null,
        name: cells[1] || '',
        division: cells[2] || '',
        gunTime: cells[3] || null,
        chipTime: cells[4] || null,
        city: cells[5] || null,
      })
    })

    // "Found 106 entrants" — how many the site says exist vs how many it gave us.
    const foundText = $.text().match(/Found\s+([\d,]+)/)
    const reported = foundText ? Number(foundText[1].replace(/,/g, '')) : rows.length
    return { rows, reported, truncated: reported > rows.length }
  }

  async _search(query) {
    const url = `${this.eventUrl}/search/all?q=${encodeURIComponent(query)}`
    console.log(`[${this.tag}] GET ${url}`)
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }
    }, 15000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return this._parseRows(await res.text())
  }

  /**
   * The site gave us fewer entrants than it says exist, so a miss is not
   * evidence of absence.
   *
   * Not upstreamErrorResult(): that one says the site is "unreachable or slow"
   * and advises trying again in a few minutes, both of which are false here.
   * The site answered fine, it just will not show more than a page, and
   * retrying will return the same 50 rows forever. The status is still
   * upstream_error because the honest summary is "we could not get a reliable
   * answer from the timer", but the note has to tell the operator the truth
   * about what to do next.
   */
  _truncatedResult(lastName, reported, shown) {
    return {
      found: false,
      bibNumber: null,
      officialTime: null,
      officialPace: null,
      eventType: null,
      yearFound: this.year,
      researchStatus: 'upstream_error',
      researchNotes: `"${lastName}" matches ${reported} entrants but this results site only returns ${shown} at a time and has no way to page past them, so the runner may simply not be in the batch we saw. Retrying will not help. Look them up by hand at ${this.eventUrl}/results`,
    }
  }

  /** Which configured distance does this row's division belong to? */
  _distanceKeyFor(division) {
    for (const [key, pattern] of Object.entries(this.config.divisionMap || {})) {
      if (pattern.test(division)) return key
    }
    return null
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    try {
      // Search the surname so nickname and prefix matching happen on our side.
      const parts = runnerName.trim().split(/\s+/)
      const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0]
      const { rows, reported, truncated } = await this._search(lastName)
      console.log(`[${this.tag}] ${rows.length} rows parsed (site reports ${reported})`)

      // Keep only divisions we actually sell prints for — this drops the
      // handcycle, wheelchair (RIM), 10K, 5K and novelty divisions. Also drop
      // entrants listed at 00:00:00: that is SVE's "no finish recorded", and
      // it went out as a real finish time (Baltimore 2022, bib 50074).
      const eligible = rows
        .map(r => ({ ...r, distanceKey: this._distanceKeyFor(r.division) }))
        .filter(r => r.distanceKey && !/^[0:.\s]*$/.test(r.chipTime || ''))

      if (eligible.length === 0) {
        if (truncated) return this._truncatedResult(lastName, reported, rows.length)
        return this.notFoundResult()
      }

      const matches = this.filterNameMatches(runnerName, eligible, r => r.name)
      console.log(`[${this.tag}] Name matches: ${matches.length}`)

      if (matches.length === 0) {
        if (truncated) return this._truncatedResult(lastName, reported, rows.length)
        return this.notFoundResult(null, eligible.slice(0, 10).map(r => ({
          name: r.name,
          bib: r.bib,
          time: r.chipTime,
          city: r.city,
          eventType: this.config.eventLabels?.[r.distanceKey] || r.division,
        })))
      }

      if (matches.length > 1) {
        return this.ambiguousResult(matches.map(m => ({
          name: m.name,
          bib: m.bib,
          time: m.chipTime,
          eventType: this.config.eventLabels?.[m.distanceKey] || m.division,
        })))
      }

      const runner = matches[0]
      const distanceMiles = this.config.distances?.[runner.distanceKey] || this.config.distanceMiles || 26.2

      console.log(`\n[${this.tag}] FOUND RUNNER:`)
      console.log(`  Name: ${runner.name}`)
      console.log(`  Bib: ${runner.bib}`)
      console.log(`  Division: ${runner.division} (${distanceMiles} mi)`)
      console.log(`  Gun: ${runner.gunTime}   Chip: ${runner.chipTime}  <- chip is authoritative`)

      return {
        found: true,
        bibNumber: runner.bib,
        officialTime: runner.chipTime,
        // The results page's Pace column is floor(chip / distance) (Baltimore
        // and Big Sur 2025, 400 of 400 rows each); our search view lacks it.
        officialPace: this.paceWith(runner.chipTime, distanceMiles, 'floor'),
        eventType: this.config.eventLabels?.[runner.distanceKey] || runner.division,
        yearFound: this.year,
        researchStatus: 'found',
        researchNotes: null,
        resultsUrl: `${this.eventUrl}/results`,
      }
    } catch (error) {
      console.error(`[${this.tag}] Error searching for ${runnerName}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }
  }
}
