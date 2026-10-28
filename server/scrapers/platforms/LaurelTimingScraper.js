/**
 * Laurel Timing Platform Scraper (results.laurelt.com)
 *
 * Server-rendered HTML pages with an embedded JSON split-record array on the
 * individual runner page. No JSON API; no auth.
 *
 * Two endpoints:
 *   1) Listing/search:  GET /{slug}/results?search={lastname|bib}&event={Event}&race={raceId}
 *      Returns a results page with rows of:
 *        <a class='individual lastname' href='?pk={pk}'>SMITH</a>
 *        <a class='firstname'>TANNER</a>
 *      Search matches LAST NAME or BIB ONLY (not first name).
 *   2) Individual:      GET /{slug}/results?pk={pk}
 *      Embeds a JSON array of split records; the {"latest": true} record is
 *      the finish line — cum_time = chip, gun_time = gun, cum_pace = min/mile.
 *
 * Each year is a separate raceId; the event/distance is disambiguated by the
 * exact-case `event` param ("Marathon", "Half Marathon").
 */
import { BaseScraper } from '../BaseScraper.js'
import * as cheerio from 'cheerio'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const BASE = 'https://results.laurelt.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class LaurelTimingScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {string} config.slug             - URL slug, e.g. 'stg' for St. George
   * @param {Object} config.raceIds          - year → integer raceId
   * @param {Object} config.events           - { marathon: 'Marathon', half: 'Half Marathon' }
   * @param {string[]} config.eventSearchOrder - e.g. ['marathon', 'half']
   * @param {Object} config.distances        - { marathon: 26.2, half: 13.1 }
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
  }

  async getRaceInfo() {
    const raceId = this.config.raceIds?.[this.year] || null
    const slug = this.config.slug
    return {
      raceDate: this.resolveRaceDate(),
      location: this.config.location,
      eventTypes: this.config.eventTypes || Object.values(this.config.events || {}),
      resultsUrl: (slug && raceId)
        ? `${BASE}/${slug}/results?race=${raceId}`
        : (slug ? `${BASE}/${slug}/results` : null),
      resultsSiteType: 'laurel',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const raceId = this.config.raceIds?.[this.year]
    const slug = this.config.slug
    if (!slug || !raceId) {
      return this.yearNotConfiguredResult('missing Laurel slug or raceIds entry')
    }

    // Search by LAST name (the only field the endpoint indexes).
    const parts = runnerName.trim().split(/\s+/)
    const lastName = parts[parts.length - 1] || runnerName

    const order = this.config.eventSearchOrder || ['marathon', 'half']
    const allCandidates = []
    // Every sold distance is searched before deciding: a namesake in a later
    // distance makes it a pick, not the first distance's runner.
    const pool = []

    for (const distKey of order) {
      const eventLabel = this.config.events?.[distKey]
      if (!eventLabel) continue

      let rows
      try {
        rows = await this._search(lastName, slug, raceId, eventLabel)
      } catch (err) {
        console.log(`[${this.tag}] search failed for ${eventLabel}: ${err.message}`)
        return this.upstreamErrorResult(err.message)
      }
      console.log(`[${this.tag}] ${eventLabel} (race ${raceId}): ${rows.length} row(s)`)

      const matches = this.filterNameMatches(runnerName, rows, r => r.fullName)
      console.log(`[${this.tag}] ${eventLabel}: ${matches.length} name-match(es)`)

      if (matches.length === 0) {
        for (const r of rows.slice(0, 10)) {
          allCandidates.push({ name: r.fullName, bib: null, eventType: eventLabel })
        }
      }
      pool.push(...rows.map(r => ({ ...r, distKey, eventLabel })))
    }

    // Name matches from every distance. Search rows carry no bib, only the
    // result's pk, so they are deduped by pk first and then by the bib on
    // each one's individual page (the same bib twice is one person). One is
    // the runner. Several are different people sharing the name, and which
    // distance they ran never settles it (Denver Colfax 2026 had a Diego
    // Garcia in the half and two in the marathon). A person picks, earlier
    // distances listed first.
    const byPk = new Map()
    for (const m of this.filterNameMatches(runnerName, pool, r => r.fullName)) {
      if (!byPk.has(m.pk)) byPk.set(m.pk, m)
    }
    const matches = [...byPk.values()]

    if (matches.length > 10) {
      return this.ambiguousResult(matches.map(m => ({ name: m.fullName, eventType: m.eventLabel })))
    }

    if (matches.length > 1) {
      // Each one's page gives the bib and time the picker shows. A page that
      // fails to load still lists the runner, without them.
      const details = await Promise.all(matches.map(m => this._fetchIndividual(slug, m.pk).catch(err => {
        console.log(`[${this.tag}] individual fetch failed for pk ${m.pk}: ${err.message}`)
        return null
      })))
      const people = new Map()
      matches.forEach((m, i) => {
        const bib = details[i]?.bib ? String(details[i].bib) : null
        const key = bib ? `bib ${bib}` : `pk ${m.pk}`
        if (!people.has(key)) people.set(key, { match: m, detail: details[i] })
      })
      if (people.size > 1) {
        return this.ambiguousResult([...people.values()].map(({ match, detail }) => ({
          name: match.fullName,
          bib: detail?.bib ? String(detail.bib) : null,
          time: detail?.chipTime ? this.formatTime(detail.chipTime) : null,
          eventType: match.eventLabel,
        })))
      }
      const [only] = people.values()
      return this._foundResult(only.match, only.detail, slug)
    }

    if (matches.length === 1) {
      // Single match → fetch the individual page for chip time, pace, bib.
      const match = matches[0]
      let detail
      try {
        detail = await this._fetchIndividual(slug, match.pk)
      } catch (err) {
        console.log(`[${this.tag}] individual fetch failed: ${err.message}`)
        return this.upstreamErrorResult(err.message)
      }
      return this._foundResult(match, detail, slug)
    }

    console.log(`[${this.tag}] No name match across distances. Surfacing ${allCandidates.length} candidates.`)
    return this.notFoundResult(null, allCandidates.slice(0, 15))
  }

  /** The found result for one matched row and its individual page. */
  _foundResult(match, detail, slug) {
    if (!detail || !detail.chipTime) {
      console.log(`[${this.tag}] Found row but couldn't parse Finish record`)
      return this.notFoundResult('runner row found but Finish record missing')
    }

    const formattedTime = this.formatTime(detail.chipTime)
    const distanceMiles = this.config.distances?.[match.distKey] || 26.2
    // The page's own pace (the card's "Pace (min/miles)", cum_pace in the
    // data): floor(displayed time / distance), so 3:20:40 shows 7:39 where
    // rounding gave 7:40. The printed pace matches the page; computed the same
    // way only if the page had none.
    const pace = this.cleanPagePace(detail.pace) || this.paceWith(detail.chipTime, distanceMiles, 'floor')

    console.log(`\n[${this.tag}] FOUND RUNNER:`)
    console.log(`  Name: ${match.fullName}`)
    console.log(`  Bib: ${detail.bib || 'N/A'}`)
    console.log(`  Chip Time: ${formattedTime}`)
    console.log(`  Pace: ${pace}`)

    return {
      found: true,
      bibNumber: detail.bib ? String(detail.bib) : null,
      officialTime: formattedTime,
      officialPace: pace,
      eventType: match.eventLabel,
      yearFound: this.year,
      researchNotes: null,
      resultsUrl: `${BASE}/${slug}/results?pk=${match.pk}`,
      rawData: {
        name: match.fullName,
        pk: match.pk,
      }
    }
  }

  /**
   * GET /{slug}/results?search={lastname}&event={Event}&race={raceId}
   * Returns parsed rows: { fullName, pk }.
   */
  async _search(lastName, slug, raceId, eventLabel) {
    const url = `${BASE}/${slug}/results?search=${encodeURIComponent(lastName)}` +
      `&event=${encodeURIComponent(eventLabel)}&race=${raceId}`
    console.log(`[${this.tag}] GET ${url}`)
    const resp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()
    return this._parseSearchHtml(html)
  }

  _parseSearchHtml(html) {
    const $ = cheerio.load(html)
    const rows = []
    // Pair each `.individual.lastname` anchor with the closest `.firstname`
    // anchor. They are siblings inside the same row container; walk by
    // anchor index since DOM nesting can be deep.
    const lasts = $('a.individual.lastname').toArray()
    for (const lastEl of lasts) {
      const $last = $(lastEl)
      const href = $last.attr('href') || ''
      const pkMatch = href.match(/[?&]pk=(\d+)/)
      if (!pkMatch) continue
      const pk = pkMatch[1]
      const lastText = $last.text().trim()
      // Find the nearest firstname anchor — usually right after the lastname
      // anchor inside the same row, but be defensive about ordering.
      let $first = $last.parent().find('a.firstname').first()
      if (!$first.length) {
        // Search a wider container (results row may wrap them in different elements).
        $first = $last.closest('tr, li, div').find('a.firstname').first()
      }
      const firstText = $first.text().trim()
      const fullName = `${firstText} ${lastText}`.replace(/\s+/g, ' ').trim()
      if (!fullName) continue
      rows.push({ pk, fullName })
    }
    return rows
  }

  /**
   * GET /{slug}/results?pk={pk}
   * Parses the embedded JSON split-records to find the {"latest": true}
   * record (finish). Falls back to the `.data-value` summary cards when JSON
   * is missing.
   */
  async _fetchIndividual(slug, pk) {
    const url = `${BASE}/${slug}/results?pk=${encodeURIComponent(pk)}`
    console.log(`[${this.tag}] GET ${url}`)
    const resp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()
    return this._parseIndividualHtml(html)
  }

  _parseIndividualHtml(html) {
    // Walk the raw HTML for split-record objects with "latest": true. Each
    // record is delimited by braces and is too messy to JSON.parse — we
    // scan for the specific fields we need.
    const out = { chipTime: null, pace: null, bib: null }

    // 1) Try the embedded JSON record (preferred — exact values).
    const latestIdx = html.indexOf('"latest": true')
    if (latestIdx !== -1) {
      // Look for the chip cum_time, cum_pace, and bib within ~2KB after.
      const window = html.slice(Math.max(0, latestIdx - 200), latestIdx + 2000)
      const t = window.match(/"cum_time"\s*:\s*"([^"]+)"/)
      const p = window.match(/"cum_pace"\s*:\s*"([^"]+)"/)
      if (t) out.chipTime = t[1]
      if (p) out.pace = p[1]
    }

    // 2) Fallback: parse the visible summary cards.
    if (!out.chipTime || !out.pace) {
      // Each card is <div class="data"><p class="data-value">3:35:18</p>
      // <div class="label-container"><p class="data-label">Chip Time</p>…,
      // so the value is a sibling of the label's container, not of the label.
      // Older editions (Portland 2021-22) have no embedded split records and
      // only these cards. "Chip Time" wins over a generic "Finish" card, which
      // could be the gun time.
      const $ = cheerio.load(html)
      const cards = {}
      $('.data-label').each((_, el) => {
        const label = $(el).text().trim().toLowerCase()
        const val = $(el).closest('.data').find('.data-value').first().text().trim()
          || $(el).prev('.data-value').text().trim() || $(el).next('.data-value').text().trim()
        if (val && !(label in cards)) cards[label] = val
      })
      const timeLike = v => v && /^\d{1,2}:\d{2}:\d{2}/.test(v)
      if (!out.chipTime) {
        out.chipTime = [cards['chip time'], cards['finish time'], cards['finish']].find(timeLike) || null
      }
      if (!out.pace) {
        const paceKey = Object.keys(cards).find(k => k.startsWith('pace'))
        if (paceKey && /^\d{1,2}:\d{2}$/.test(cards[paceKey])) out.pace = cards[paceKey]
      }
    }

    // 3) Bib: pull from `.participant-bib` (e.g. "#407").
    const $ = cheerio.load(html)
    const bibEl = $('.participant-bib').first().text().trim()
    if (bibEl) {
      const m = bibEl.match(/(\d+)/)
      if (m) out.bib = m[1]
    }

    return out
  }
}

export default LaurelTimingScraper
