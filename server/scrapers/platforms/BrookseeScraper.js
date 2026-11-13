/**
 * Brooksee Platform Scraper
 * Used by Mesa Marathon (mesamarathon.com) and potentially other Brooksee-powered races.
 * Results are server-rendered HTML with form-based search (GET parameters).
 *
 * Search endpoint: GET {baseUrl}/results?race={raceId}&event={event}&search={name}
 * Individual:      GET {baseUrl}/results?pk={participantId}
 *
 * HTML structure per result row:
 *   td.placeoverall, td.placegender, td.placediv, td.bib,
 *   a.individual.lastname, a.individual.firstname,
 *   td.gender, td.age, td.chiptime, td.pace, td.guntime
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

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

export class BrookseeScraper extends BaseScraper {
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.baseUrl = config.baseUrl
    this.tag = config.tag || config.raceName
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    const raceDate = this.resolveRaceDate()
    console.log(`[${this.tag} ${this.year}] Race date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)

    return {
      raceDate,
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl: `${this.baseUrl}/results`,
      resultsSiteType: 'brooksee',
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    const raceId = this.config.raceIds?.[this.year]
    if (!raceId) {
      console.log(`[${this.tag} ${this.year}] No race ID configured for this year`)
      return {
        ...this.notFoundResult(),
        researchNotes: `Results not available for ${this.year}`
      }
    }

    const eventOrder = this.config.eventSearchOrder || ['Marathon', 'Half Marathon']

    // Every sold event is searched, even after one has a match: a namesake in
    // a later event makes it a pick, not the first event's runner. Name
    // matches (found or ambiguous) are decided together below; close but
    // inexact last-name candidates are collected across every event type for
    // the not-found picker.
    const answers = []
    let candidates = []

    for (const event of eventOrder) {
      const eventLabel = this.config.eventLabels?.[event] || event
      console.log(`[${this.tag} ${this.year}] Searching ${eventLabel}...`)

      const result = await this.searchEventType(runnerName, raceId, event, eventLabel)
      answers.push({ result, label: eventLabel })
      if (!result.found && !result.ambiguous && Array.isArray(result.possibleMatches)) {
        candidates = candidates.concat(result.possibleMatches)
      }
    }

    const pooled = poolEventAnswers(this, runnerName, answers)
    if (pooled) return pooled

    if (candidates.length > 0) {
      // De-dupe by name+bib and cap the list so the picker stays manageable.
      const seen = new Set()
      const unique = candidates.filter(c => {
        const key = `${(c.name || '').toLowerCase()}|${c.bib || ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      console.log(`[${this.tag} ${this.year}] No exact match; surfacing ${unique.length} candidate(s)`)
      const DISPLAY_CAP = 10
      const out = this.notFoundResult(null, unique.slice(0, DISPLAY_CAP))
      // Tell the caller the list was trimmed so the UI can prompt the shopper
      // to refine instead of silently hiding matches.
      if (unique.length > DISPLAY_CAP) out.possibleMatchesTruncated = true
      return out
    }

    console.log(`[${this.tag} ${this.year}] Runner not found in any event type`)
    return this.notFoundResult()
  }

  /**
   * Look a runner up by bib. The `search` param matches a bib number as well
   * as a last name (San Antonio 2025 "6278" returns only bib 6278), so it is
   * the same call per sold event, in eventSearchOrder, keeping only a row
   * whose bib is exactly the one searched.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    const raceId = this.config.raceIds?.[this.year]
    if (!raceId) return this.yearNotConfiguredResult('missing raceIds entry')
    console.log(`[${this.tag} ${this.year}] Bib lookup: ${wanted}`)

    for (const event of (this.config.eventSearchOrder || ['Marathon', 'Half Marathon'])) {
      const eventLabel = this.config.eventLabels?.[event] || event
      const url = `${this.baseUrl}/results?race=${raceId}&event=${encodeURIComponent(event)}&search=${encodeURIComponent(wanted)}`
      let html
      try {
        const response = await fetchWithTimeout(url, {
          headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; TrackstarBot/1.0)' }
        })
        if (!response.ok) return this.upstreamErrorResult(`Brooksee returned HTTP ${response.status}`)
        html = await response.text()
      } catch (error) {
        console.error(`[${this.tag} ${this.year}] Bib lookup error for ${wanted}:`, error.message)
        return this.upstreamErrorResult(error.message)
      }
      const match = this.parseResultRows(html).find(r => this.bibsEqual(r.bib, wanted))
      if (!match) continue
      return { ...this.extractRunnerData(match, eventLabel), runnerName: `${match.firstName} ${match.lastName}`.trim() }
    }
    return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)
  }

  async searchEventType(runnerName, raceId, event, eventLabel) {
    try {
      // Brooksee searches the `search` param as a substring against lastname
      // only. Passing the full "First Last" string returns zero matches.
      // Send just the last whitespace-separated token; we'll filter the
      // candidates by full-name match below via this.namesMatch().
      const lastNameToken = runnerName.trim().split(/\s+/).pop() || runnerName
      const url = `${this.baseUrl}/results?race=${raceId}&event=${encodeURIComponent(event)}&search=${encodeURIComponent(lastNameToken)}`

      const response = await fetchWithTimeout(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; TrackstarBot/1.0)'
        }
      })

      if (!response.ok) {
        throw new Error(`Brooksee ${response.status}: ${response.statusText}`)
      }

      let html = await response.text()
      // 25 rows a page; a common surname runs past it. Ask again with the
      // list size set to All, the param the site's Show All button sends
      // (same site as Laurel; St. George 2026 Andrea Anderson was on page 2).
      const pages = html.match(/<select name="page_(\d+)"[^>]*>([\s\S]*?)<\/select>/)
      if (pages && (pages[2].match(/<option/g) || []).length > 1) {
        const allResp = await fetchWithTimeout(`${url}&size_${pages[1]}=100000`, {
          headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; TrackstarBot/1.0)' }
        })
        if (!allResp.ok) throw new Error(`Brooksee ${allResp.status}: ${allResp.statusText}`)
        html = await allResp.text()
      }
      const rows = this.parseResultRows(html)

      console.log(`[${this.tag} ${this.year}] Found ${rows.length} results in ${eventLabel}`)

      if (rows.length === 0) {
        return this.notFoundResult()
      }

      // Filter to name matches
      const matches = this.filterNameMatches(runnerName, rows,
        r => `${r.firstName} ${r.lastName}`
      )

      console.log(`[${this.tag} ${this.year}] Name matches in ${eventLabel}: ${matches.length}`)

      if (matches.length === 0) {
        // Surface a generous slice here; searchRunner aggregates across events,
        // de-dupes, applies the final display cap, and flags truncation.
        console.log(`[${this.tag} ${this.year}] No name match. Surfacing ${Math.min(rows.length, 25)} candidates.`)
        return this.notFoundResult(null, rows.slice(0, 25).map(r => ({
          name: `${r.firstName} ${r.lastName}`.trim(),
          bib: r.bib,
          time: r.chipTime || r.finishTime,
          pace: r.pace,
          eventType: eventLabel,
        })))
      }

      if (matches.length > 1) {
        console.log(`[${this.tag} ${this.year}] Multiple matches:`)
        matches.forEach(r => console.log(`  - ${r.firstName} ${r.lastName}, Bib: ${r.bib}`))
        // Same fields the no-match branch above surfaces. Dropping them here
        // left the picker showing bare names, and any consumer that reads a
        // missing time as "no result" would mark real finishers as DNFs.
        return this.ambiguousResult(matches.map(r => ({
          name: `${r.firstName} ${r.lastName}`,
          bib: r.bib,
          time: r.chipTime || r.finishTime,
          pace: r.pace,
          eventType: eventLabel,
        })))
      }

      const match = matches[0]
      return this.extractRunnerData(match, eventLabel)

    } catch (error) {
      console.error(`[${this.tag} ${this.year}] Error searching for ${runnerName}:`, error.message)
      return {
        ...this.notFoundResult(),
        researchNotes: `Error: ${error.message}`
      }
    }
  }

  /**
   * Parse result rows from HTML response.
   * Each row has: placeoverall, placegender, placediv, bib, lastname, firstname,
   *               gender, age, chiptime, pace, guntime
   */
  parseResultRows(html) {
    const rows = []

    // Match each sequence of td cells that forms a result row
    // We look for the pattern starting with placeoverall td
    const rowPattern = /class="td_num placeoverall"[^>]*>\s*([\s\S]*?)<\/td>\s*<td class="td_num placegender"[^>]*>\s*([\s\S]*?)<\/td>\s*<td class="td_num placediv"[^>]*>\s*([\s\S]*?)<\/td>\s*<td class="bib"[^>]*>\s*([\s\S]*?)<\/td>\s*<td[^>]*>\s*(?:[\s\S]*?)<a class='individual lastname'[^>]*>([\s\S]*?)<\/a>\s*(?:[\s\S]*?)<\/td>\s*<td[^>]*>\s*(?:[\s\S]*?)<a class='individual firstname'[^>]*>([\s\S]*?)<\/a>\s*(?:[\s\S]*?)<\/td>\s*<td class="gender"[^>]*>\s*([\s\S]*?)<\/td>\s*<td class="age td_num"[^>]*>\s*([\s\S]*?)<\/td>\s*<td class="chiptime td_num"[^>]*>\s*([\s\S]*?)<\/td>\s*<td class="td_num pace"[^>]*>\s*([\s\S]*?)<\/td>\s*<td class="td_num guntime"[^>]*>\s*([\s\S]*?)<\/td>/g

    let match
    while ((match = rowPattern.exec(html)) !== null) {
      const clean = (s) => s.replace(/<[^>]*>/g, '').trim()
      // The name links to the runner's own page, {baseUrl}/results?pk={id}.
      const pk = (match[0].match(/class='individual lastname'[^>]*href='[^']*[?&]pk=(\d+)/) || [])[1] || null
      rows.push({
        participantId: pk,
        overallPlace: clean(match[1]),
        genderPlace: clean(match[2]),
        divisionPlace: clean(match[3]),
        bib: clean(match[4]),
        lastName: clean(match[5]),
        firstName: clean(match[6]),
        gender: clean(match[7]),
        age: clean(match[8]),
        chipTime: clean(match[9]),
        pace: clean(match[10]),
        gunTime: clean(match[11]),
      })
    }

    if (rows.length === 0) {
      const single = this.parseParticipantPage(html)
      if (single) rows.push(single)
    }

    return rows
  }

  /**
   * A search with exactly one hit skips the list and opens that runner's own
   * page (Eugene 2026 "Hickman" in the marathon: Matt Hickman #3726, 3:26:13,
   * 7:52/mi). It has no result table, so read its cards instead. The page
   * prints no gun time; pace is time over the card's distance.
   */
  parseParticipantPage(html) {
    const clean = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    const head = html.match(/<h3 class="participant-name">([\s\S]*?)<span class="participant-bib">\s*#?([^<]*)<\/span>/)
    if (!head) return null
    const card = (label) => {
      const re = new RegExp(`<p class="data-value">([^<]*)</p>\\s*<div class="label-container">\\s*<p class="data-label">${label}</p>`)
      return clean((html.match(re) || [])[1])
    }
    const chipTime = card('Chip Time')
    if (!chipTime) return null
    const parts = clean(head[1]).split(' ')
    const lastName = parts.length > 1 ? parts.pop() : ''
    const distance = parseFloat(card('Distance'))
    const pace = distance > 0 ? this.calculatePace(chipTime, distance) : card('Pace \\(min/miles\\)')
    const pk = (html.match(/name="_query" value="pk%3D(\d+)/) || [])[1] || null
    return {
      participantId: pk,
      overallPlace: '', genderPlace: '', divisionPlace: '',
      bib: clean(head[2]),
      lastName,
      firstName: parts.join(' '),
      gender: '', age: '',
      chipTime,
      pace,
      gunTime: '',
    }
  }

  extractRunnerData(result, eventType) {
    const chipTime = this.formatTime(result.chipTime)
    const pace = this.formatPace(result.pace)
    const name = `${result.firstName} ${result.lastName}`

    console.log(`\n[${this.tag} ${this.year}] FOUND RUNNER:`)
    console.log(`  Name: ${name}`)
    console.log(`  Bib: ${result.bib}`)
    console.log(`  Chip Time: ${chipTime}`)
    console.log(`  Pace: ${pace}`)
    console.log(`  Overall Place: ${result.overallPlace}`)
    console.log(`  Gender Place: ${result.genderPlace}`)
    console.log(`  Division Place: ${result.divisionPlace}`)

    return {
      found: true,
      bibNumber: result.bib || null,
      officialTime: chipTime,
      officialPace: pace,
      eventType,
      yearFound: this.year,
      researchNotes: null,
      // The runner's own page when the row linked one (checked: Las Vegas 2025
      // /results?pk=8382388 opens Jennifer Smith #1242, 2:42:50), else the list.
      resultsUrl: result.participantId ? `${this.baseUrl}/results?pk=${result.participantId}` : `${this.baseUrl}/results`,
      rawData: {
        name,
        gender: result.gender,
        age: result.age,
        overallPlace: result.overallPlace,
        genderPlace: result.genderPlace,
        divisionPlace: result.divisionPlace,
        chipTime: result.chipTime,
        gunTime: result.gunTime,
        pace: result.pace,
      }
    }
  }
}

export default BrookseeScraper
