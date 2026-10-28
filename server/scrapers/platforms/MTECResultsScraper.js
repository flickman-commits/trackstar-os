/**
 * MTEC Results Platform Scraper (mtecresults.com)
 *
 * Server-rendered HTML, no JSON API. Two endpoints:
 *   1) Name/bib search (returns an HTML <table> fragment):
 *        GET /event/participantSearch?nameorbib={query}&race={raceId}
 *      Columns: Name (link → /runner/show?race=...&rid=...), Bib, Age, Sex,
 *               City, State, Race (distance label e.g. "Marathon").
 *   2) Runner detail page (chip Finish time):
 *        GET /runner/show?rid={rid}&race={raceId}
 *
 * Each distance is a separate raceId (config: raceIds[year][distanceKey]).
 *
 * Chip vs gun: the detailed splits table has a row anchored on
 * <th class='pe-3'>Finish</th>; the 1st <td> in that row is the chip Finish
 * time (cumulative). The compact "Splits" card on the same page shows INTERVAL
 * times between splits — not cumulative — so do not extract finish time from it.
 *
 * PACE: the runner page's "Average Pace" block, its visible chip value
 * (.chipContainer; the gun one is hidden). That is ceil(chip / distance):
 * Grandma's 2026 6:22:32 shows 14:37 where rounding gave 14:36. Never the
 * splits table's "Pace Between" / "Pace" column, which is per SEGMENT (the
 * final segment's pace on the Finish row). If the block is missing, the same
 * ceil formula is used.
 */
import { BaseScraper } from '../BaseScraper.js'
import * as cheerio from 'cheerio'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const BASE = 'https://www.mtecresults.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class MTECResultsScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {Object} config.raceIds         - year → { marathon: id, half: id }
   * @param {string[]} config.eventSearchOrder - e.g. ['marathon', 'half']
   * @param {Object} config.eventLabels     - { marathon: 'Marathon', half: 'Half Marathon' }
   * @param {Object} config.distances       - { marathon: 26.2, half: 13.1 }
   * @param {Object} [config.raceSlugs]     - year → { marathon: 'url-slug', half: 'url-slug' } for resultsUrl
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
  }

  async getRaceInfo() {
    const yearRaceIds = this.config.raceIds?.[this.year] || {}
    const primaryRaceId = yearRaceIds.marathon ?? yearRaceIds.half ?? null
    const primarySlug = this.config.raceSlugs?.[this.year]?.marathon
      ?? this.config.raceSlugs?.[this.year]?.half
      ?? null
    const resultsUrl = primaryRaceId
      ? (primarySlug
        ? `${BASE}/race/leaderboard/${primaryRaceId}/${primarySlug}`
        : `${BASE}/race/leaderboard/${primaryRaceId}`)
      : null

    return {
      raceDate: this.resolveRaceDate(),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl,
      resultsSiteType: 'mtec',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const yearRaceIds = this.config.raceIds?.[this.year]
    if (!yearRaceIds || Object.keys(yearRaceIds).length === 0) {
      return this.yearNotConfiguredResult('missing MTEC raceIds entry')
    }

    const order = this.config.eventSearchOrder || ['marathon', 'half']
    const allCandidates = []
    // Every sold distance is searched before deciding: a namesake in a later
    // distance makes it a pick, not the first distance's runner.
    const pool = []

    for (const distKey of order) {
      const raceId = yearRaceIds[distKey]
      if (!raceId) continue
      const eventLabel = this.config.eventLabels?.[distKey] || distKey

      let searchRows
      try {
        searchRows = await this._participantSearch(runnerName, raceId)
      } catch (err) {
        console.log(`[${this.tag}] participantSearch failed for ${eventLabel}: ${err.message}`)
        return this.upstreamErrorResult(err.message)
      }

      // The search answers for the whole event, not just this race: a half
      // runner comes back when searching the marathon's raceId. Their detail
      // page under the wrong raceId has no Finish row, so keep only rows whose
      // link names this race; the half pass finds the others with its own id.
      searchRows = searchRows.filter(r => !r.race || r.race === String(raceId))

      console.log(`[${this.tag}] ${eventLabel} (race ${raceId}): ${searchRows.length} search row(s)`)

      const matches = this.filterNameMatches(runnerName, searchRows, r => r.name)
      console.log(`[${this.tag}] ${eventLabel}: ${matches.length} name-match(es)`)

      if (matches.length === 0) {
        // Stash candidates from this distance so we can surface them later if
        // no other distance yields an exact match either.
        for (const r of searchRows.slice(0, 10)) {
          allCandidates.push({
            name: r.name, bib: r.bib, city: r.city, state: r.state,
            eventType: r.eventLabel || eventLabel,
          })
        }
      }
      pool.push(...searchRows.map(r => ({ ...r, distKey, raceId, distLabel: eventLabel })))
    }

    // Name matches from every distance, deduped by bib (the same bib twice is
    // one person; a bib-less row falls back to its runner id). One is the
    // runner. Several are different people sharing the name, and which
    // distance they ran never settles it (Denver Colfax 2026 had a Diego
    // Garcia in the half and two in the marathon). A person picks, earlier
    // distances listed first.
    const people = new Map()
    for (const m of this.filterNameMatches(runnerName, pool, r => r.name)) {
      const bib = String(m.bib ?? '').trim()
      const key = bib ? `bib ${bib}` : `rid ${m.rid}`
      if (!people.has(key)) people.set(key, m)
    }
    const found = [...people.values()]
    if (found.length > 1) {
      return this.ambiguousResult(found.map(m => ({ name: m.name, bib: m.bib, eventType: m.distLabel })))
    }

    if (found.length === 1) {
      // Single match → fetch detail page for chip time + pace.
      const match = found[0]
      const { distKey, raceId, distLabel: eventLabel } = match
      let detail
      try {
        detail = await this._fetchRunnerDetail(match.rid, raceId)
      } catch (err) {
        console.log(`[${this.tag}] runner detail fetch failed: ${err.message}`)
        return this.upstreamErrorResult(err.message)
      }

      if (!detail || !detail.chipTime) {
        console.log(`[${this.tag}] Found row but couldn't parse Finish row chip time`)
        // Last-ditch: compute pace from distance + a possibly-found time.
        return this.notFoundResult('runner row found but Finish time missing')
      }

      const formattedTime = this.formatTime(detail.chipTime)
      const distanceMiles = this.config.distances?.[distKey] || 26.2
      // The page's "Average Pace" (see file header), else the same ceil formula.
      const pace = this.cleanPagePace(detail.avgPace) || this.paceWith(detail.chipTime, distanceMiles, 'ceil')

      console.log(`\n[${this.tag}] FOUND RUNNER:`)
      console.log(`  Name: ${match.name}`)
      console.log(`  Bib: ${match.bib}`)
      console.log(`  Chip Time: ${formattedTime}`)
      console.log(`  Pace: ${pace}`)

      return {
        found: true,
        bibNumber: match.bib ? String(match.bib) : null,
        officialTime: formattedTime,
        officialPace: pace,
        eventType: eventLabel,
        yearFound: this.year,
        researchNotes: null,
        resultsUrl: `${BASE}/runner/show?rid=${match.rid}&race=${raceId}`,
        rawData: {
          name: match.name,
          city: match.city,
          state: match.state,
          rid: match.rid,
          raceId,
        }
      }
    }

    console.log(`[${this.tag}] No name match across configured distances. Surfacing ${allCandidates.length} candidates.`)
    return this.notFoundResult(null, allCandidates.slice(0, 15))
  }

  /**
   * Bib lookup. participantSearch takes `nameorbib`, so the bib goes through
   * the same call per configured distance raceId; only rows linking to that
   * raceId with exactly the searched bib count. Time and pace come from the
   * same Finish-row detail page and chip/distance math as searchRunner.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    const yearRaceIds = this.config.raceIds?.[this.year]
    if (!yearRaceIds || Object.keys(yearRaceIds).length === 0) {
      return this.yearNotConfiguredResult('missing MTEC raceIds entry')
    }
    for (const distKey of (this.config.eventSearchOrder || ['marathon', 'half'])) {
      const raceId = yearRaceIds[distKey]
      if (!raceId) continue
      const eventLabel = this.config.eventLabels?.[distKey] || distKey
      let rows
      try {
        rows = await this._participantSearch(wanted, raceId)
      } catch (err) {
        return this.upstreamErrorResult(err.message)
      }
      const match = rows.find(r => r.race === String(raceId) && this.bibsEqual(r.bib, wanted))
      if (!match) continue
      let detail
      try {
        detail = await this._fetchRunnerDetail(match.rid, raceId)
      } catch (err) {
        return this.upstreamErrorResult(err.message)
      }
      if (!detail?.chipTime) return this.notFoundResult(`Bib ${wanted} found but Finish time missing`)
      const distanceMiles = this.config.distances?.[distKey] || 26.2
      return {
        found: true,
        runnerName: match.name,
        bibNumber: String(match.bib).trim(),
        officialTime: this.formatTime(detail.chipTime),
        officialPace: this.cleanPagePace(detail.avgPace) || this.paceWith(detail.chipTime, distanceMiles, 'ceil'),
        eventType: eventLabel,
        yearFound: this.year,
        researchNotes: null,
        resultsUrl: `${BASE}/runner/show?rid=${match.rid}&race=${raceId}`,
        rawData: { name: match.name, city: match.city, state: match.state, rid: match.rid, raceId },
      }
    }
    return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)
  }

  /**
   * GET /event/participantSearch?nameorbib=...&race=...
   * Returns parsed rows from the HTML table fragment.
   */
  async _participantSearch(query, raceId) {
    const url = `${BASE}/event/participantSearch?nameorbib=${encodeURIComponent(query)}&race=${encodeURIComponent(raceId)}`
    console.log(`[${this.tag}] GET ${url}`)
    const resp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()
    return this._parseSearchHtml(html)
  }

  _parseSearchHtml(html) {
    const $ = cheerio.load(html)
    const rows = []
    // The fragment may or may not be wrapped in a full document — just walk
    // every <tr> with cells in the expected order.
    $('tr').each((_, tr) => {
      const cells = $(tr).find('td')
      if (cells.length < 7) return
      const nameCell = $(cells[0])
      const a = nameCell.find('a').first()
      const name = (a.text() || nameCell.text()).trim()
      const href = a.attr('href') || ''
      // /runner/show?race=15918&rid=32 — rid is what we need.
      const rid = (href.match(/[?&]rid=(\d+)/) || [])[1]
      const race = (href.match(/[?&]race=(\d+)/) || [])[1] || null
      if (!name || !rid) return
      rows.push({
        name,
        rid,
        race,
        bib: $(cells[1]).text().trim(),
        age: $(cells[2]).text().trim(),
        sex: $(cells[3]).text().trim(),
        city: $(cells[4]).text().trim(),
        state: $(cells[5]).text().trim(),
        eventLabel: $(cells[6]).text().trim(),
      })
    })
    return rows
  }

  /**
   * GET /runner/show?rid=...&race=...
   * Pulls the chip Finish time + pace from the detailed splits table.
   */
  async _fetchRunnerDetail(rid, raceId) {
    const url = `${BASE}/runner/show?rid=${encodeURIComponent(rid)}&race=${encodeURIComponent(raceId)}`
    console.log(`[${this.tag}] GET ${url}`)
    const resp = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()
    return this._parseRunnerDetail(html)
  }

  _parseRunnerDetail(html) {
    const $ = cheerio.load(html)

    // Find the detailed splits table by walking every <tr> that has a
    // <th class='pe-3'>Finish</th> header — the first <td> next to it is the
    // cumulative chip Finish time. The splits table's pace column is
    // per-segment, never read; the overall pace is the "Average Pace" block.
    let chipTime = null
    $('tr').each((_, tr) => {
      const th = $(tr).find('th').first()
      if (!th.length) return
      if (th.text().trim().toLowerCase() !== 'finish') return
      const tds = $(tr).find('td')
      if (tds.length === 0) return
      const t = $(tds[0]).text().trim()
      if (/^\d{1,2}:\d{2}:\d{2}/.test(t)) chipTime = t
      return false // break each loop
    })

    // "Average Pace", the chip figure ("14:37 / mi"); the gun one sits hidden beside it.
    const avg = $('p.label-text').filter((_, el) => $(el).text().trim() === 'Average Pace').first()
      .closest('.d-md-flex').find('.chipContainer .pace-imperial strong').first().text().trim()
    const avgPace = (avg.match(/^(\d{1,2}:\d{2})/) || [])[1] || null

    return { chipTime, avgPace }
  }
}

export default MTECResultsScraper
