/**
 * Tokyo Marathon Scraper
 *
 * Custom PHP form on marathon.tokyo:
 *   - Search:  POST  /{year}/result/index.php   (form: name, sex[], page, etc.)
 *   - Detail:  POST  /{year}/result/detail.php  (form: d_number=<bib>)
 *
 * Search results don't include times — only the detail page does.
 * Detail page has both `タイム(ネット)／Time (net)` and `タイム(グロス)／Time (gross)`.
 * We always use the net time (chip time), never the gross (gun) time.
 */
import { BaseScraper } from '../BaseScraper.js'
import * as cheerio from 'cheerio'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

// The short race on the same results page: 10.7km since 2023, a 10km race on
// the 2021 edition's page ("10km Junior & Youth Men").
const SHORT_RACE = /\b10(?:\.7)?\s*km\b/i
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class TokyoMarathonScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    // Results live under the edition's year, which is not always the year it
    // ran (config.resultsPathYear).
    const pathYear = config.resultsPathYear?.[year] ?? year
    this.baseUrl = `https://www.marathon.tokyo/${pathYear}/result`
  }

  async getRaceInfo() {
    return {
      raceDate: this.resolveRaceDate(),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon'],
      resultsUrl: this.baseUrl,
      resultsSiteType: 'tokyo'
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    try {
      // Step 1: Search by name
      const formBody = new URLSearchParams({
        number: '',
        name: runnerName.trim(),
        'sex[]': '1',
        sort_key: 'place',
        sort_asc: '1',
        page: '1',
        d_number: ''
      })
      // Tokyo expects multiple sex[] values; URLSearchParams collapses them, so add manually
      const fullBody = formBody.toString() + '&sex%5B%5D=2&sex%5B%5D=0'

      console.log(`[${this.tag}] POST ${this.baseUrl}/index.php (name="${runnerName}")`)
      const searchResp = await fetchWithTimeout(`${this.baseUrl}/index.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Accept: 'text/html'
        },
        body: fullBody
      })

      if (!searchResp.ok) {
        console.log(`[${this.tag}] Search failed: ${searchResp.status}`)
        return this.notFoundResult()
      }

      const html = await searchResp.text()
      const parsed = this._parseSearchResults(html)
      // The same results page lists the 10.7km race, and its finishers came
      // back as "Marathon" with their 10.7km time (2025, bib 5301: 0:38:43).
      // We sell marathon prints, so a 10.7km (or 10km) runner is not a match.
      const candidates = parsed.filter(c => !SHORT_RACE.test(c.category))
      console.log(`[${this.tag}] Found ${parsed.length} candidate runners, ${parsed.length - candidates.length} in the short race`)
      if (candidates.length === 0 && parsed.length) {
        return this.notFoundResult(null, parsed.slice(0, 10).map(c => ({
          name: c.name, bib: c.bib, eventType: c.category || '10.7km Race',
        })))
      }

      if (candidates.length === 0) return this.notFoundResult()

      // Filter by name match
      const matches = this.filterNameMatches(runnerName, candidates, c => c.name)
      console.log(`[${this.tag}] Exact matches: ${matches.length}`)

      if (matches.length === 0) {
        console.log(`[${this.tag}] No name match. Surfacing ${Math.min(candidates.length, 10)} candidates.`)
        return this.notFoundResult(null, candidates.slice(0, 10).map(c => ({
          name: c.name,
          bib: c.bib,
          eventType: this.config.defaultEventType || 'Marathon',
        })))
      }
      if (matches.length > 1) {
        // No time: the search table carries place/bib/name only, and the net
        // time needs a detail.php POST per runner. Absent, not zero — consumers
        // must not render this as "no finish time recorded".
        return this.ambiguousResult(matches.map(m => ({ name: m.name, bib: m.bib })))
      }

      // Step 2: Fetch detail page for the matched runner using their bib number
      const match = matches[0]
      console.log(`[${this.tag}] Fetching detail for bib ${match.bib}`)
      const detailResp = await fetchWithTimeout(`${this.baseUrl}/detail.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT
        },
        body: `d_number=${encodeURIComponent(match.bib)}`
      })
      if (!detailResp.ok) {
        console.log(`[${this.tag}] Detail fetch failed: ${detailResp.status}`)
        return this.notFoundResult()
      }
      const detailHtml = await detailResp.text()
      const netTime = this._extractNetTime(detailHtml)

      if (!netTime) {
        console.log(`[${this.tag}] No net time on detail page`)
        return this.notFoundResult()
      }

      const time = this.formatTime(netTime)
      const distanceMiles = this.config.distanceMiles || 26.2
      const pace = this.formatPace(this.calculatePace(netTime, distanceMiles))

      console.log(`\n[${this.tag}] FOUND RUNNER:`)
      console.log(`  Name: ${match.name}`)
      console.log(`  Bib: ${match.bib}`)
      console.log(`  Net Time (chip): ${time}`)

      return {
        found: true,
        bibNumber: String(match.bib),
        officialTime: time,
        officialPace: pace,
        eventType: this.config.defaultEventType || 'Marathon',
        yearFound: this.year,
        researchNotes: null,
        resultsUrl: this.baseUrl,
        rawData: { name: match.name, bib: match.bib, place: match.place }
      }
    } catch (error) {
      console.error(`[${this.tag}] Error: ${error.message}`)
      return { ...this.notFoundResult(), researchNotes: `Error: ${error.message}` }
    }
  }

  /**
   * Parse the search results table.
   * Columns (per the form layout): Place, Race Category, Bib, Name, Age, Sex, Country, City
   */
  _parseSearchResults(html) {
    const $ = cheerio.load(html)
    const candidates = []

    $('tr').each((_, tr) => {
      const tds = $(tr).find('td')
      if (tds.length < 4) return

      const place = $(tds[0]).text().trim()
      const bib = $(tds[2]).text().trim()
      const fullName = $(tds[3]).text().trim()
      // The name cell holds two lines split by <br>: the registered form, then
      // the English one ("鈴木 朋樹<br/>TOMOKI SUZUKI"). For foreign runners
      // both are Latin ("HART ALANA<br/>ALANA HART"), and joining the text
      // gave "HART ALANAALANA HART", which matched nobody. Use the last line.
      const lines = ($(tds[3]).html() || '')
        .split(/<br\s*\/?>/i)
        .map(part => cheerio.load(part).text().trim())
        .filter(Boolean)
      const englishLine = lines.length > 1 ? lines[lines.length - 1] : fullName
      const latinName = (englishLine.match(/[A-Z][A-Z\s.\-']{2,}/g) || []).join(' ').trim()
      const finalName = latinName || fullName

      // Category cell, same two-line shape: "マラソン女子<br />Marathon Women",
      // "10.7km視覚障がい者男子<br />10.7km Race(Visually Impaired - Men)".
      const categoryLines = ($(tds[1]).html() || '')
        .split(/<br\s*\/?>/i)
        .map(part => cheerio.load(part).text().trim())
        .filter(Boolean)
      const category = categoryLines[categoryLines.length - 1] || ''

      if (bib && /^\d+$/.test(bib)) {
        candidates.push({
          name: finalName,
          bib: bib,
          place: place,
          category,
        })
      }
    })

    return candidates
  }

  /**
   * Extract the net (chip) time from the detail page.
   * Detail page has rows like:
   *   <th>タイム(ネット)／Time (net)</th>
   *   <td>02:38:10</td>
   *   <th>タイム(グロス)／Time (gross)</th>
   *   <td>02:38:18</td>
   * We always pick the net time, never gross.
   */
  _extractNetTime(html) {
    const $ = cheerio.load(html)
    let netTime = null

    // The official time is the one on the split table's Finish row. Tokyo
    // ranks elite, semi-elite and wheelchair runners on gross (gun) time and
    // everyone else on net, and that row shows whichever counts: 2025 winner
    // Takele net 02:03:22, Finish 02:03:23; general runner Miyazaki net and
    // Finish both 03:49:20. Net is only the fallback when the row is missing.
    $('td').each((_, td) => {
      if (!/フィニッシュ|^\s*Finish\s*$/i.test($(td).text().replace(/.*／/, ''))) return
      const m = $(td).next('td').text().trim().match(/^(\d{1,2}:\d{2}:\d{2})/)
      if (m) { netTime = m[1]; return false }
    })
    if (netTime) return netTime

    // Look for the row whose header includes "ネット" (net) — find sibling td
    $('th').each((_, th) => {
      const headerText = $(th).text().trim()
      if (/ネット|net\s*\)/i.test(headerText) && !/グロス|gross/i.test(headerText)) {
        // Try sibling <td> next, or look in same <tr>
        const $tr = $(th).closest('tr')
        const tds = $tr.find('td')
        for (let i = 0; i < tds.length; i++) {
          const text = $(tds[i]).text().trim()
          const m = text.match(/(\d{1,2}:\d{2}:\d{2})/)
          if (m) { netTime = m[1]; return false }
        }
      }
    })

    return netTime
  }
}

export default TokyoMarathonScraper
