/**
 * RaceResult Platform Scraper (my.raceresult.com)
 *
 * The public results page (my.raceresult.com/{eventId}/results) is a JS app
 * over three JSON calls, all plain fetch, no browser needed:
 *
 *   1. GET https://my.raceresult.com/{id}/results/config?lang=en
 *        -> { key, server, eventname, contests: {id: name},
 *             TabConfig: { StandardDetails, Lists: [{ Name, Contest }] } }
 *      `key` is a per-event read key the page itself uses; it is read fresh
 *      on every search, never stored. `server` is the data host
 *      (e.g. my-us-1.raceresult.com).
 *   2. GET https://{server}/{id}/results/list?key=&listname=&contest=0&r=search&term=
 *        -> { DataFields: [...], data: { "#1_<Contest>": { "#1_<Gender>": [row, ..., [count]] } } }
 *      Rows are arrays aligned to DataFields ("BIB", "ID", name field, ...).
 *      Grouping depth varies per event; the first group level is the contest
 *      (short) name, which is what `contests` regexes in the config match.
 *   3. GET https://{server}/{id}/{StandardDetails}/view?lang=en&pid={ID}
 *        -> per-runner detail. Chip and gun are labelled explicitly, either as
 *           fields titled "ChipTime" / "GunTime" (Ann Arbor) or as the
 *           SplitsAndLegs.Splits "Finish" row's Chip / Gun (Atlantic City).
 *
 * Chip vs gun: the finish time is ALWAYS taken from the detail view's
 * explicitly chip-labelled value. List columns are only used to find the
 * runner. If the detail view is unreachable, a list column is used only when
 * the config names one (`chipField`) that was verified to be chip.
 *
 * Pace: the list column the official page shows, named per config
 * (`paceField`). It is printed as shown even when it is gun-based: Atlantic
 * City's "Chip Pace" is ceil(gun / distance), and the printed pace matches
 * the official page (Matt, 2026-10-28). Never the detail view's Finish
 * "Speed", which is the last split's pace. Computed from chip time only when
 * the config names no pace column.
 *
 * Config (usually inside yearOverrides[year]):
 *   raceResult: {
 *     eventId: 425548,
 *     listName: 'Result Lists|Overall Results',
 *     chipField: 'Finish',            // optional, list column proven to be chip
 *     contests: { marathon: /^marathon$/i, half: /^half marathon$/i },
 *   }
 *   distances: { marathon: 26.2, half: 13.1 }, eventSearchOrder, eventLabels
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const DEFAULT_DISTANCES = { marathon: 26.2, half: 13.1, halfMarathon: 13.1 }
const NAME_FIELDS = ['DisplayName_Public', 'FLNAME', 'DisplayName', 'LFNAME', 'NAME']

export class RaceResultScraper extends BaseScraper {
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    this.rr = config.raceResult || null
  }

  pageUrl() {
    return this.rr?.eventId ? `https://my.raceresult.com/${this.rr.eventId}/results` : null
  }

  async getRaceInfo() {
    return {
      raceDate: this.resolveRaceDate(),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl: this.pageUrl(),
      resultsSiteType: 'raceresult',
    }
  }

  async fetchJson(url) {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Referer: 'https://my.raceresult.com/' },
    })
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return res.json()
  }

  async loadEventConfig() {
    const cfg = await this.fetchJson(`https://my.raceresult.com/${this.rr.eventId}/results/config?lang=en`)
    if (!cfg?.key) throw new Error('config has no key')
    const server = cfg.server || 'my.raceresult.com'
    const detailsTab = cfg.TabConfig?.StandardDetails || cfg.Tab?.Config?.StandardDetails || 'details'
    return { key: cfg.key, server, detailsTab, eventName: cfg.eventname || '' }
  }

  /** Flatten the grouped list payload into { row, groups: [labels] }. */
  flattenRows(data, width, groups = [], out = []) {
    if (Array.isArray(data)) {
      for (const row of data) {
        if (Array.isArray(row) && row.length >= width) out.push({ row, groups })
      }
    } else if (data && typeof data === 'object') {
      for (const [label, child] of Object.entries(data)) {
        this.flattenRows(child, width, [...groups, label.replace(/^#\d+_/, '').trim()], out)
      }
    }
    return out
  }

  contestKeyFor(groupLabel) {
    const order = this.config.eventSearchOrder || Object.keys(this.rr.contests || {})
    for (const key of order) {
      const re = this.rr.contests?.[key]
      if (re && re.test(groupLabel)) return key
    }
    return null
  }

  async searchList(ev, term) {
    const url = `https://${ev.server}/${this.rr.eventId}/results/list?key=${ev.key}` +
      `&listname=${encodeURIComponent(this.rr.listName)}&page=results&contest=0&r=search&l=0` +
      `&term=${encodeURIComponent(term)}`
    const json = await this.fetchJson(url)
    const fields = json?.DataFields || []
    const idx = (name) => fields.indexOf(name)
    const nameIdx = NAME_FIELDS.map(idx).find(i => i >= 0)
    const bibIdx = idx('BIB')
    const pidIdx = idx('ID')
    const chipIdx = this.rr.chipField ? idx(this.rr.chipField) : -1
    const paceIdx = this.rr.paceField ? idx(this.rr.paceField) : -1
    if (nameIdx == null || pidIdx < 0) throw new Error(`unexpected list fields: ${fields.join(',')}`)
    return this.flattenRows(json.data, fields.length).map(({ row, groups }) => ({
      name: row[nameIdx],
      bib: bibIdx >= 0 ? row[bibIdx] : null,
      pid: row[pidIdx],
      listChip: chipIdx >= 0 ? row[chipIdx] : null,
      listPace: paceIdx >= 0 ? row[paceIdx] : null,
      contestLabel: groups[0] || '',
    }))
  }

  /** Chip and gun from the per-runner detail view, by their own labels. */
  async fetchDetailTimes(ev, pid) {
    const json = await this.fetchJson(
      `https://${ev.server}/${this.rr.eventId}/${ev.detailsTab}/view?lang=en&mid=0&standalone=false&pid=${pid}`
    )
    let chip = null
    let gun = null
    const finish = (json?.Data?.Data?.SplitsAndLegs?.Splits || []).find(s => /^finish$/i.test(s.Name || ''))
    if (finish) {
      chip = finish.Chip || null
      gun = finish.Gun || null
    }
    const walk = (el) => {
      if (!el) return
      const c = el.Config || {}
      if (el.Type === 'field' && c.Field) {
        const title = String(c.Title || '')
        if (!chip && /^(chip ?time|chip|net ?time)$/i.test(title)) chip = c.Field
        if (!gun && /^(gun ?time|gun|clock ?time)$/i.test(title)) gun = c.Field
      }
      for (const ch of el.Children || []) walk(ch)
    }
    for (const el of json?.Data?.Elements || []) walk(el)
    return { chip, gun }
  }

  cleanTime(t) {
    if (!t || !/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(String(t).trim())) return null
    let s = this.roundTime(String(t).trim())
    if (/^\d{1,2}:\d{2}$/.test(s)) s = `0:${s}`
    return this.formatTime(s)
  }

  async searchRunner(runnerName) {
    console.log(`\n[${this.tag} ${this.year}] RaceResult search for: "${runnerName}"`)
    if (!this.rr?.eventId || !this.rr?.listName || !this.rr?.contests) {
      return this.yearNotConfiguredResult('missing raceResult eventId/listName/contests')
    }

    let ev
    let rows
    try {
      ev = await this.loadEventConfig()
      rows = await this.searchList(ev, runnerName)
      const last = String(runnerName).trim().split(/\s+/).pop()
      if (rows.length === 0 && last && last !== runnerName.trim()) rows = await this.searchList(ev, last)
    } catch (err) {
      console.error(`[${this.tag} ${this.year}] RaceResult error: ${err.message}`)
      return this.upstreamErrorResult(`RaceResult ${err.status ? `HTTP ${err.status}` : 'request failed'}`)
    }

    const inContests = rows
      .map(r => ({ ...r, eventKey: this.contestKeyFor(r.contestLabel) }))
      .filter(r => r.eventKey)
    const order = this.config.eventSearchOrder || Object.keys(this.rr.contests)

    // Every name match in a sold contest, pooled and deduped by bib (the same
    // bib twice is one person; a list without a BIB column falls back to the
    // participant id). One is the runner. Several are different people
    // sharing the name, and which contest they ran never settles it (Denver
    // Colfax 2026 had a Diego Garcia in the half and two in the marathon). A
    // person picks; earlier contests in eventSearchOrder are listed first.
    const people = new Map()
    for (const m of this.filterNameMatches(runnerName, inContests, r => r.name)) {
      const bib = String(m.bib ?? '').trim()
      const key = bib ? `bib ${bib}` : `pid ${m.pid}`
      if (!people.has(key)) people.set(key, m)
    }
    const rank = m => { const i = order.indexOf(m.eventKey); return i < 0 ? order.length : i }
    const found = [...people.values()].sort((a, b) => rank(a) - rank(b))
    const labelOf = m => this.config.eventLabels?.[m.eventKey] || m.eventKey
    if (found.length > 1) {
      return this.ambiguousResult(found.map(m => ({ name: m.name, bib: m.bib, eventType: labelOf(m) })))
    }
    if (found.length === 1) return this.buildResult(ev, found[0], found[0].eventKey, labelOf(found[0]))

    const candidates = this.filterNameMatches(runnerName, rows, r => r.name)
    return this.notFoundResult(
      candidates.length ? `Name found only outside the matched contests (${[...new Set(candidates.map(c => c.contestLabel))].join(', ')})` : null,
      candidates.slice(0, 10).map(c => ({ name: c.name, bib: c.bib, eventType: c.contestLabel }))
    )
  }

  /**
   * Bib lookup: the list's own search term matches bib numbers too. Only rows
   * whose BIB is exactly the bib and whose contest is a sold one are kept.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    console.log(`\n[${this.tag} ${this.year}] RaceResult bib lookup: ${wanted}`)
    if (!this.rr?.eventId || !this.rr?.listName || !this.rr?.contests) {
      return this.yearNotConfiguredResult('missing raceResult eventId/listName/contests')
    }
    let ev
    let rows
    try {
      ev = await this.loadEventConfig()
      rows = await this.searchList(ev, wanted)
    } catch (err) {
      console.error(`[${this.tag} ${this.year}] RaceResult error: ${err.message}`)
      return this.upstreamErrorResult(`RaceResult ${err.status ? `HTTP ${err.status}` : 'request failed'}`)
    }
    const hits = rows.filter(r => this.bibsEqual(r.bib, wanted))
    if (!hits.length) return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)
    const order = this.config.eventSearchOrder || Object.keys(this.rr.contests)
    for (const eventKey of order) {
      const match = hits.find(r => this.contestKeyFor(r.contestLabel) === eventKey)
      if (!match) continue
      const eventLabel = this.config.eventLabels?.[eventKey] || eventKey
      const result = await this.buildResult(ev, match, eventKey, eventLabel)
      return result?.found ? { ...result, runnerName: match.name } : result
    }
    return this.notFoundResult(`Bib ${wanted} is entered in ${[...new Set(hits.map(h => h.contestLabel))].join(', ')}, which this race does not sell`)
  }

  async buildResult(ev, match, eventKey, eventLabel) {
    let chip = null
    let gun = null
    try {
      const t = await this.fetchDetailTimes(ev, match.pid)
      chip = this.cleanTime(t.chip)
      gun = this.cleanTime(t.gun)
    } catch (err) {
      console.warn(`[${this.tag} ${this.year}] detail view failed for pid ${match.pid}: ${err.message}`)
    }
    if (!chip && this.rr.chipField) chip = this.cleanTime(match.listChip)
    if (!chip) {
      return this.identityOnlyResult(match.name, match.bib, 'the RaceResult detail view gave no chip time', this.pageUrl())
    }

    const distance = this.config.distances?.[eventKey] ?? DEFAULT_DISTANCES[eventKey]
    const pace = this.cleanPagePace(match.listPace) ?? (distance ? this.calculatePace(chip, distance) : null)
    console.log(`[${this.tag} ${this.year}] FOUND ${match.name} bib ${match.bib} ${eventLabel}: chip ${chip}, gun ${gun || '?'}, pace ${pace}`)

    return {
      found: true,
      bibNumber: match.bib ? String(match.bib) : null,
      officialTime: chip,
      officialPace: pace,
      eventType: eventLabel,
      yearFound: this.year,
      researchNotes: null,
      resultsUrl: `https://my.raceresult.com/${this.rr.eventId}/details?pid=${match.pid}`,
      rawData: {
        name: match.name,
        contest: match.contestLabel,
        chipTime: chip,
        gunTime: gun,
        pid: match.pid,
      },
    }
  }
}
