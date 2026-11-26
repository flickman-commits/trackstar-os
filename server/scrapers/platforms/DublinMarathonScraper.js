/**
 * Irish Life Dublin Marathon's own results site (raceresults.dublinmarathon.ie).
 *
 * The race's website links "Race Results" here; it is the page a Dublin
 * runner checks. A WordPress plugin ("dub-marathon-results") serves it: the
 * search form posts to admin-ajax.php with action dmr_process_search_form, a
 * race id (config.dublinRaceIds, one per year) and a name or race number, and
 * gets JSON back. The post needs the nonce the home page prints
 * (`var dmr = {"ajaxurl":..., "nonce":"..."}`), so we read that first and
 * read it again once if the site answers "Invalid nonce".
 *
 * Row fields: place_overall, name, race_number, from, category,
 * place_in_category, 10km_time, 1st_half_time, 30km_time, chip_time,
 * finish_time. chip_time is the CHIP finish; finish_time is the gun (clock)
 * finish. 2026 Luca Fogarty: chip 4:33:34, gun 4:33:58. Both are whole
 * seconds, as the page shows them, with or without a leading zero
 * ("4:33:34", "02:37:47"). There is no pace column, so pace is computed from
 * the chip time over 26.2 mi.
 *
 * The name search is a substring match on the full name, so we search the
 * surname and match first names here. The site writes "Mc Ginley" with a
 * space: for a Mc/Mac/O' surname we also search the part after the prefix.
 *
 * Marathon only. The 2024 and 2025 half marathons on this site have their
 * columns shifted (chip_time holds the gun time, finish_time a 10K split), so
 * a half must never be read with this as it stands. A row whose gun time is
 * under its chip time is refused for the same reason.
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SITE = 'https://raceresults.dublinmarathon.ie'
const AJAX = `${SITE}/wp-admin/admin-ajax.php`

let cachedNonce = null // { value, at }
const NONCE_TTL_MS = 30 * 60 * 1000

function seconds(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

export class DublinMarathonScraper extends BaseScraper {
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
  }

  get raceId() {
    return this.config.dublinRaceIds?.[this.year] || null
  }

  get resultsUrl() {
    const slug = this.config.dublinResultSlugs?.[this.year]
    return slug ? `${SITE}/results/${slug}/` : `${SITE}/`
  }

  async getRaceInfo() {
    return {
      raceDate: this.resolveRaceDate(null),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon'],
      resultsUrl: this.resultsUrl,
      resultsSiteType: 'dublinmarathon',
    }
  }

  async _nonce(fresh = false) {
    if (!fresh && cachedNonce && Date.now() - cachedNonce.at < NONCE_TTL_MS) return cachedNonce.value
    const res = await fetchWithTimeout(`${SITE}/`, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } }, 15000)
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${SITE}/`)
    const value = (await res.text()).match(/var dmr = \{[^}]*"nonce":"([^"]+)"/)?.[1]
    if (!value) throw new Error('The results page has no search nonce')
    cachedNonce = { value, at: Date.now() }
    return value
  }

  async _post(fields, retried = false) {
    const body = new URLSearchParams({
      action: 'dmr_process_search_form',
      nonce: await this._nonce(retried),
      race_name: String(this.raceId),
      race_number: '',
      name: '',
      entry_category: '',
      draw: '1',
      start: '0',
      length: '2000',
      ...fields,
    })
    const res = await fetchWithTimeout(AJAX, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Referer: `${SITE}/` },
      body: body.toString(),
    }, 15000)
    if (!res.ok) throw new Error(`HTTP ${res.status} from the results search`)
    const text = (await res.text()).trim()
    let json
    try { json = JSON.parse(text) } catch { throw new Error('The results search did not answer with JSON') }
    if (json?.success === false) {
      if (!retried && /nonce/i.test(String(json.data))) return this._post(fields, true)
      throw new Error(`The results search refused the request: ${String(json.data).slice(0, 80)}`)
    }
    return Array.isArray(json?.data) ? json.data : []
  }

  /** A row as a result, or null when its times are not a usable chip finish. */
  _row(r) {
    const chipTime = this.normalizeTime(String(r.chip_time || '').trim())
    const gunTime = this.normalizeTime(String(r.finish_time || '').trim()) || null
    const chip = seconds(chipTime)
    if (!chip) return null
    const gun = seconds(gunTime)
    if (gun !== null && gun < chip) return { bad: true, name: r.name }
    return { name: String(r.name || '').trim(), bib: String(r.race_number || '').trim() || null, chipTime, gunTime }
  }

  _found(runner) {
    const distanceMiles = this.config.distanceMiles || 26.2
    console.log(`\n[${this.tag}] FOUND RUNNER: ${runner.name}  Bib: ${runner.bib}`)
    console.log(`  Chip: ${runner.chipTime}  Gun: ${runner.gunTime}  <- chip is authoritative`)
    return {
      found: true,
      bibNumber: runner.bib,
      officialTime: runner.chipTime,
      officialPace: this.calculatePace(runner.chipTime, distanceMiles),
      eventType: 'Marathon',
      yearFound: this.year,
      researchStatus: 'found',
      researchNotes: null,
      resultsUrl: this.resultsUrl,
    }
  }

  _searchTerms(runnerName) {
    const terms = this.surnameSearchTerms(runnerName)
    for (const t of [...terms]) {
      const rest = t.match(/^(?:mc|mac|o['’])\s*(.{3,})$/i)?.[1]
      if (rest) terms.push(rest)
    }
    return [...new Set(terms)]
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)
    if (!this.raceId) return this.yearNotConfiguredResult()

    try {
      const byKey = new Map()
      for (const term of this._searchTerms(runnerName)) {
        for (const r of await this._post({ name: term })) byKey.set(`${r.race_number}|${r.name}`, r)
      }
      const rows = [...byKey.values()]
      console.log(`[${this.tag}] ${rows.length} entries share the surname`)

      const matches = this.filterNameMatches(runnerName, rows, r => r.name)
      console.log(`[${this.tag}] Name matches: ${matches.length}`)
      if (matches.length === 0) return this.notFoundResult()

      const parsed = matches.map(r => this._row(r))
      if (parsed.some(p => p?.bad)) return this.upstreamErrorResult('The results page shows a gun time under the chip time, so its columns cannot be trusted')
      const usable = parsed.filter(Boolean)
      if (!usable.length) return this.notFoundResult()
      if (usable.length > 1) {
        return this.ambiguousResult(usable.map(m => ({ name: m.name, bib: m.bib, time: m.chipTime, eventType: 'Marathon' })))
      }
      return this._found(usable[0])
    } catch (error) {
      console.error(`[${this.tag}] Error searching for ${runnerName}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }
  }

  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted || !this.raceId) return null
    try {
      const hit = (await this._post({ race_number: wanted })).find(r => this.bibsEqual(r.race_number, wanted))
      if (!hit) return this.notFoundResult()
      const runner = this._row(hit)
      if (!runner) return this.notFoundResult()
      if (runner.bad) return this.upstreamErrorResult('The results page shows a gun time under the chip time, so its columns cannot be trusted')
      return this._found(runner)
    } catch (error) {
      console.error(`[${this.tag}] Error searching bib ${wanted}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }
  }
}
