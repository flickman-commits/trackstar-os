/**
 * Huber Timing Platform Scraper (www.hubertiming.com/results/<cert>)
 *
 * Server-rendered HTML, so fetch + cheerio; no browser needed. Each distance
 * of an event is its own page, named by a "cert" id: Humboldt Redwoods 2026 is
 * 2026HRMMar (marathon) and 2026HRM (half). The whole field is on that one
 * page (no search, no paging), so we fetch it and match names locally.
 *
 * Columns, read by header name, not position:
 *   Place | Bib | Name | Gender | Age | City | State | Chip Pace | Time |
 *   Gender Place | Division | Division Place | <splits> | Gun Time | Time to Start
 * "Time" is the CHIP finish (Gun Time = Time + Time to Start). The split
 * columns each carry a "Pace" header too: those are per-segment paces, the
 * trap that shipped the MTEC bug. Only the "Chip Pace" column is the overall.
 *
 * Pace. Chip Pace is floor(raw chip seconds / distance), where the raw time
 * has a fraction the page does not show: Humboldt 2026 matches floor(Time /
 * distance) on 320 of 329 marathon rows and 890 of 930 half rows, and every
 * miss is a time just past a whole-second pace (3:42:42 / 26.2 = 510.0) shown
 * a second lower (8:29), i.e. the displayed Time is the raw time rounded up.
 * So we take the pace the page prints; floor(Time / distance) only if the
 * column is empty.
 */
import { BaseScraper } from '../BaseScraper.js'
import * as cheerio from 'cheerio'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BASE = 'https://www.hubertiming.com/results'

export class HuberTimingScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {Object} config.huberCerts - distance key -> cert id for this year, e.g. { marathon: '2026HRMMar', half: '2026HRM' }
   * @param {Object} config.distances  - distance key -> miles
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
  }

  get certs() {
    return this.config.huberCerts || {}
  }

  urlFor(cert) {
    return `${BASE}/${cert}`
  }

  get resultsUrl() {
    const first = this.certs.marathon || Object.values(this.certs)[0]
    return first ? this.urlFor(first) : BASE
  }

  async getRaceInfo() {
    return {
      raceDate: this.resolveRaceDate(null),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl: this.resultsUrl,
      resultsSiteType: 'hubertiming',
    }
  }

  /** The results table, one object per finisher, columns found by header text. */
  _parseRows(html) {
    const $ = cheerio.load(html)
    const table = $('table').filter((_, t) => /chip pace/i.test($(t).find('thead').text())).first()
    if (!table.length) return []
    const heads = table.find('thead tr').first().children('th, td').map((_, c) => $(c).text().trim()).get()
    const col = (label) => heads.findIndex(h => h.toLowerCase() === label)
    const iBib = col('bib'), iName = col('name'), iTime = col('time'), iPace = col('chip pace'), iGun = col('gun time'), iCity = col('city')
    if (iName < 0 || iTime < 0) throw new Error('Results table has no Name or Time column')
    const rows = []
    table.find('tbody tr').each((_, tr) => {
      const cells = $(tr).children('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get()
      const name = cells[iName]
      const time = cells[iTime]
      if (!name || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time || '')) return
      rows.push({
        bib: iBib >= 0 ? cells[iBib] || null : null,
        name,
        chipTime: time,
        chipPace: iPace >= 0 ? this.cleanPagePace(cells[iPace]) : null,
        gunTime: iGun >= 0 ? cells[iGun] || null : null,
        city: iCity >= 0 ? cells[iCity] || null : null,
      })
    })
    return rows
  }

  async _fetchDistance(key, cert) {
    const url = this.urlFor(cert)
    console.log(`[${this.tag}] GET ${url}`)
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } }, 15000)
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return this._parseRows(await res.text()).map(r => ({ ...r, distanceKey: key, url }))
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const entries = Object.entries(this.certs)
    if (!entries.length) return this.yearNotConfiguredResult()

    try {
      const order = this.config.eventSearchOrder || entries.map(([k]) => k)
      const lists = await Promise.all(order.filter(k => this.certs[k]).map(k => this._fetchDistance(k, this.certs[k])))
      const all = lists.flat()
      console.log(`[${this.tag}] ${all.length} finishers across ${lists.length} distance(s)`)
      if (!all.length) return this.upstreamErrorResult('The results page had no finishers')

      const matches = this.filterNameMatches(runnerName, all, r => r.name)
      console.log(`[${this.tag}] Name matches: ${matches.length}`)
      const label = (r) => this.config.eventLabels?.[r.distanceKey] || r.distanceKey

      if (matches.length === 0) return this.notFoundResult()
      if (matches.length > 1) {
        return this.ambiguousResult(matches.map(m => ({ name: m.name, bib: m.bib, time: m.chipTime, eventType: label(m) })))
      }

      const runner = matches[0]
      const distanceMiles = this.config.distances?.[runner.distanceKey] || this.config.distanceMiles || 26.2
      console.log(`\n[${this.tag}] FOUND RUNNER:`)
      console.log(`  Name: ${runner.name}  Bib: ${runner.bib}  (${label(runner)}, ${distanceMiles} mi)`)
      console.log(`  Chip: ${runner.chipTime}  Gun: ${runner.gunTime}  <- chip is authoritative`)
      console.log(`  Page Chip Pace: ${runner.chipPace}`)

      return {
        found: true,
        bibNumber: runner.bib,
        officialTime: runner.chipTime,
        // The page's own overall pace (see the header); never a split's Pace column.
        officialPace: runner.chipPace || this.paceWith(runner.chipTime, distanceMiles, 'floor'),
        eventType: label(runner),
        yearFound: this.year,
        researchStatus: 'found',
        researchNotes: null,
        resultsUrl: runner.url,
      }
    } catch (error) {
      console.error(`[${this.tag}] Error searching for ${runnerName}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }
  }
}
