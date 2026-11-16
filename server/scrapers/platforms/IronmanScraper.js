/**
 * IRONMAN: every IRONMAN and IRONMAN 70.3 race, read from the results service
 * ironman.com's own results pages embed (labs-v2.competitor.com).
 *
 * A race has one parent event id, and each year is its own "subevent". The
 * parent's page lists the subevents with their dates (that is where config
 * eventIds and raceDates come from), and one year's whole field is
 *   https://labs-v2.competitor.com/api/results?wtc_eventid=<subevent id>
 * as JSON (about 0.5 MB gzipped for a full IRONMAN), one row per athlete:
 * athlete, wtc_bibnumber, wtc_finishtimeformatted, wtc_swimtimeformatted,
 * wtc_biketimeformatted, wtc_runtimeformatted, the leg distances completed in
 * km, and wtc_finisher / wtc_dnf / wtc_dns / wtc_dq. Times are whole seconds,
 * so there is no fraction to round, and there is one clock per athlete: the
 * time from their own start (age-groupers rolling-start), which is what the
 * race's results page shows as Finish.
 *
 * Triathlon prints show the overall time, the bib and each leg's time and
 * distance (server/domain/orders/triathlon.js), so a found result carries
 * `legs`. Leg distances are the format's (2.4 / 112 / 26.2 mi, half that for a
 * 70.3), unless the athlete's completed distance says that leg was shortened
 * or cancelled that year; then the distance is left for a person. There is no
 * pace on a triathlon print, so none is computed.
 *
 * Config: `ironman: { slug, eventId, half, places }` and eventIds { year:
 * subevent id }. `slug` is the ironman.com race (im-wisconsin), whose
 * /results page is the official results page for every year.
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const API = 'https://labs-v2.competitor.com/api/results'
const KM_PER_MILE = 1.609344

/** Each leg's official distance in miles, by format. */
export const IRONMAN_LEGS = {
  full: { swim: 2.4, bike: 112, run: 26.2 },
  half: { swim: 1.2, bike: 56, run: 13.1 },
}

// One year's field, shared by every search on this instance for ten minutes:
// an import researches several orders of the same race back to back.
const cache = new Map()
const CACHE_MS = 10 * 60 * 1000

/** "0:55:17" -> "00:55:17"; null for a missing or zero time. */
export function legTime(t) {
  const parts = String(t || '').trim().split(':').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null
  if (parts.every(n => n === 0)) return null
  return parts.map(n => String(n).padStart(2, '0')).join(':')
}

/** "11:14:01" (no leading zero on the hours), or null. */
export function finishTime(t) {
  const parts = String(t || '').trim().split(':').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n)) || parts.every(n => n === 0)) return null
  return `${parts[0]}:${String(parts[1]).padStart(2, '0')}:${String(parts[2]).padStart(2, '0')}`
}

/** "2.4 mi", "112 mi". */
const miles = n => `${n} mi`

/**
 * The print's legs for one row. A leg's distance is the format's unless the
 * athlete's completed distance is more than 10% off it (a swim cancelled for
 * weather, a shortened bike); then it is null, and so is a missing time.
 */
export function legsOf(row, half) {
  const std = IRONMAN_LEGS[half ? 'half' : 'full']
  const out = {}
  for (const [leg, timeKey, kmKey] of [['swim', 'wtc_swimtimeformatted', 'wtc_swimdistancecompleted'], ['bike', 'wtc_biketimeformatted', 'wtc_bikedistancecompleted'], ['run', 'wtc_runtimeformatted', 'wtc_rundistancecompleted']]) {
    const time = legTime(row[timeKey])
    const km = Number(row[kmKey])
    const done = Number.isFinite(km) && km > 0 ? km / KM_PER_MILE : null
    const standard = done != null && Math.abs(done - std[leg]) / std[leg] <= 0.1
    out[`${leg}Time`] = time
    out[`${leg}Distance`] = time && standard ? miles(std[leg]) : null
  }
  return out
}

export class IronmanScraper extends BaseScraper {
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    this.subevent = config.eventIds?.[year] || null
    this.half = Boolean(config.ironman?.half)
    this.eventLabel = this.half ? 'IRONMAN 70.3' : 'IRONMAN'
  }

  /** The race's results page on ironman.com: the official one, every year. */
  officialUrl() { return `https://www.ironman.com/races/${this.config.ironman.slug}/results` }

  async getRaceInfo() {
    return {
      raceDate: this.resolveRaceDate(),
      location: this.config.location,
      eventTypes: this.config.eventTypes,
      resultsUrl: this.officialUrl(),
      resultsSiteType: 'ironman',
    }
  }

  /** Every athlete in this year's results (finishers and not). */
  async field() {
    const hit = cache.get(this.subevent)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows
    const res = await fetchWithTimeout(`${API}?wtc_eventid=${encodeURIComponent(this.subevent)}`, { headers: { 'user-agent': 'Mozilla/5.0 (Trackstar results lookup)', accept: 'application/json' } }, 25000)
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
    const data = await res.json()
    const raw = data?.resultsJson?.value
    if (!Array.isArray(raw)) throw new Error('unexpected response shape')
    const rows = raw.map(r => ({
      name: String(r.athlete || r.wtc_ContactId?.fullname || '').trim(),
      bib: r.wtc_bibnumber != null ? String(r.wtc_bibnumber) : null,
      finisher: r.wtc_finisher === true,
      status: r.wtc_dnf ? 'DNF' : r.wtc_dns ? 'DNS' : r.wtc_dq ? 'DQ' : null,
      raw: r,
    }))
    cache.set(this.subevent, { at: Date.now(), rows })
    return rows
  }

  candidate(row) {
    return { name: row.name, bib: row.bib, time: finishTime(row.raw.wtc_finishtimeformatted), pace: null, eventType: this.eventLabel, resultsUrl: this.officialUrl(), legs: legsOf(row.raw, this.half) }
  }

  async searchRunner(runnerName) {
    console.log(`\n[${this.tag} ${this.year}] IRONMAN search for: "${runnerName}"`)
    if (!this.subevent) return this.yearNotConfiguredResult('missing IRONMAN subevent id')
    let rows
    try { rows = await this.field() } catch (err) {
      console.error(`[${this.tag} ${this.year}] IRONMAN error: ${err.message}`)
      return this.upstreamErrorResult(`IRONMAN results ${err.status ? `HTTP ${err.status}` : 'request failed'}`)
    }
    const finishers = rows.filter(r => r.finisher && finishTime(r.raw.wtc_finishtimeformatted))
    const found = this.filterNameMatches(runnerName, finishers, r => r.name)
    const people = new Map(found.map(r => [r.bib || `${r.name}|${r.raw.wtc_resultid}`, r]))
    if (people.size > 1) return this.ambiguousResult([...people.values()].map(r => this.candidate(r)))
    if (people.size === 1) return this.buildResult([...people.values()][0])

    // Not a finisher: say so when the name is there with a DNF or DNS, so a
    // person does not go looking for a result that does not exist.
    const unfinished = this.filterNameMatches(runnerName, rows.filter(r => !r.finisher), r => r.name)
    if (unfinished.length) {
      const r = unfinished[0]
      return this.notFoundResult(`${r.name}${r.bib ? ` (bib ${r.bib})` : ''} is in the ${this.raceName} ${this.year} results as ${r.status || 'not finished'}, with no finish time.`)
    }
    const last = String(runnerName).trim().split(/\s+/).pop().toLowerCase()
    const same = finishers.filter(r => r.name.toLowerCase().split(/\s+/).pop() === last).slice(0, 10)
    return this.notFoundResult(null, same.length ? same.map(r => this.candidate(r)) : null)
  }

  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    if (!this.subevent) return this.yearNotConfiguredResult('missing IRONMAN subevent id')
    let rows
    try { rows = await this.field() } catch (err) { return this.upstreamErrorResult(`IRONMAN results ${err.status ? `HTTP ${err.status}` : 'request failed'}`) }
    const hit = rows.find(r => r.finisher && this.bibsEqual(r.bib, wanted))
    if (hit) return { ...this.buildResult(hit), runnerName: hit.name }
    return this.notFoundResult(`No finisher with bib ${wanted} in ${this.raceName} ${this.year} results`)
  }

  buildResult(row) {
    const time = finishTime(row.raw.wtc_finishtimeformatted)
    const legs = legsOf(row.raw, this.half)
    console.log(`[${this.tag} ${this.year}] FOUND ${row.name} bib ${row.bib}: ${time} (swim ${legs.swimTime}, bike ${legs.bikeTime}, run ${legs.runTime})`)
    return {
      found: true,
      bibNumber: row.bib,
      officialTime: time,
      officialPace: null,
      eventType: this.eventLabel,
      yearFound: this.year,
      researchNotes: null,
      resultsUrl: this.officialUrl(),
      legs,
      rawData: { name: row.name, resultId: row.raw.wtc_resultid, ageGroup: row.raw._wtc_agegroupid_value_formatted || null },
    }
  }
}

export default IronmanScraper
