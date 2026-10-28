/**
 * TrueTime Racing Platform Scraper (results.truetimeracing.com)
 *
 * TrueTime runs RaceTec's ASP.NET WebForms results site. No browser needed:
 *
 *   1. GET  results.aspx?CId={cid}&RId={rid}
 *        -> the race page; we only need its hidden __VIEWSTATE fields and the
 *           ASP.NET session cookie.
 *   2. POST the same URL with those fields plus
 *        __EVENTTARGET=ctl00$edtSearch, ctl00$edtSearch={name or bib}
 *        -> the search grid (ctl00_Content_Main_grdSearch) across EVERY event
 *           of the race: Event | No | Name | Gender | Category | Status |
 *           Time | Net Time. Each name links to
 *           myresults.aspx?CId=&RId=&EId={event}&AId={athlete}.
 *   3. GET  myresults.aspx?CId=&RId=&EId=&AId=
 *        -> runner detail: splits with Time of Day, cumulative time
 *           "from Start" and a pace.
 *
 * Chip vs gun: the finish time is the grid's "Net Time" column (read by its
 * header, never by position). TrueTime's "Time" column and the detail's
 * "Finish Time" hero (CSS class rtv3-hero-gun, misleadingly) carry the same
 * net value for Des Moines 2026, e.g. Mya Sullivan 05:42:44.61 while her
 * finish time of day is 14:04:41 on an 8:00 gun (start 8:21:56). No gun time
 * is printed, so gun is derived as finish time-of-day minus the published gun
 * (`trueTime.gunStart`) and is reported in rawData only.
 *
 * Rounding: TrueTime shows hundredths. The official certificate
 * (cert.racetec.net) TRUNCATES to the second: Ryan Newstrom 05:18:31.50 is
 * printed 05:18:31. We truncate the same way (Athlinks' mirror agrees).
 *
 * Pace: the athlete page's finish-row Pace cell, which is floor(exact net time
 * with hundredths / distance): Mya Sullivan 05:42:44.61 shows 13:04 where
 * rounding gave 13:05. The printed pace matches the page; the same formula
 * is the fallback when the cell cannot be read.
 *
 * Events are matched by EId from the athlete link, not the event label, so
 * relays, 5K and 10K (other EIds) can never match.
 *
 * Config (usually inside yearOverrides[year]):
 *   trueTime: { cid: 16535, rid: 1793, gunStart: '08:00:00',
 *               events: { marathon: 3, half: 2 } }
 *   distances: { marathon: 26.2, half: 13.1 }, eventSearchOrder, eventLabels
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import { relayFetch, RelayUnavailableError } from '../../lib/fetchRelay.js'

const BASE = 'https://results.truetimeracing.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const DEFAULT_DISTANCES = { marathon: 26.2, half: 13.1 }

function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;?/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * TrueTime's search box matches accents literally against names stored without
 * them: "Jesús Lizárraga" (and "Lizárraga" alone) return "Sorry, your search
 * returned no matches" for Des Moines 2026 while "Jesus Lizarraga" finds bib
 * 7141. NFD splits an accented letter into base + combining mark; drop the marks.
 */
export function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function toSeconds(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2}):(\d{2})/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

function fromSeconds(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export class TrueTimeScraper extends BaseScraper {
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    this.tt = config.trueTime || null
  }

  pageUrl(eid = null) {
    if (!this.tt?.cid || !this.tt?.rid) return null
    return `${BASE}/results.aspx?CId=${this.tt.cid}&RId=${this.tt.rid}${eid ? `&EId=${eid}` : ''}`
  }

  async getRaceInfo() {
    return {
      raceDate: this.resolveRaceDate(),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon', 'Half Marathon'],
      resultsUrl: this.pageUrl(),
      resultsSiteType: 'truetime',
    }
  }

  /** A refused or failed request, as the order should read it. */
  failedLookup(err) {
    if (/blocks lookups from our server/.test(err?.message || '')) {
      return { ...this.upstreamErrorResult(), researchNotes: `${err.message}. Start the render worker on the Mac, then run research again.` }
    }
    return this.upstreamErrorResult(`TrueTime ${err.status ? `HTTP ${err.status}` : 'request failed'}`)
  }

  async fetchText(url, init = {}) {
    const headers = { 'User-Agent': USER_AGENT, Accept: 'text/html', ...(init.headers || {}) }
    // Once this run has been refused, every later request goes through the relay
    // too, so the page and its search postback come from the same address.
    if (!this.viaRelay) {
      const res = await fetchWithTimeout(url, { ...init, headers })
      if (res.ok) return { text: await res.text(), res }
      // TrueTime's Cloudflare refuses cloud addresses (403 from Vercel, 200 from a home
      // connection): hand the request to the render worker on Matt's Mac.
      if (res.status !== 403) {
        const err = new Error(`HTTP ${res.status}`)
        err.status = res.status
        throw err
      }
      this.viaRelay = true
    }
    let out
    try {
      out = await relayFetch(url, { ...init, headers })
    } catch (e) {
      const err = new Error(e instanceof RelayUnavailableError
        ? `TrueTime blocks lookups from our server; the render worker on Matt's Mac relays them, and ${e.message}`
        : e.message)
      err.status = 403
      throw err
    }
    if (out.status < 200 || out.status >= 300) {
      const err = new Error(`HTTP ${out.status} (through the Mac relay)`)
      err.status = out.status
      throw err
    }
    // Shaped like a fetch Response where search() reads it (the cookies).
    const res = { headers: { getSetCookie: () => out.setCookies, get: () => out.setCookies.join(', ') } }
    return { text: out.text, res }
  }

  /** Run the page's own search postback; returns grid rows across all events. */
  async search(term) {
    const url = this.pageUrl()
    const { text: page, res } = await this.fetchText(url)
    const cookies = (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')])
      .filter(Boolean)
      .map(c => c.split(';')[0])
      .join('; ')
    const form = new URLSearchParams()
    for (const m of page.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)) {
      form.set(m[1], m[2].replace(/&amp;/g, '&'))
    }
    form.set('__EVENTTARGET', 'ctl00$edtSearch')
    form.set('__EVENTARGUMENT', '')
    // Every search (full name, surname retry, bib) goes out without accents.
    form.set('ctl00$edtSearch', stripDiacritics(term))
    const { text } = await this.fetchText(url, {
      method: 'POST',
      body: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, ...(cookies ? { Cookie: cookies } : {}) },
    })
    const grid = text.match(/id="ctl00_Content_Main_grdSearch"[\s\S]*?<\/table>/)
    if (!grid) return []
    const headers = [...grid[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => decode(m[1]).toLowerCase())
    const col = (re) => headers.findIndex(h => re.test(h))
    const iEvent = col(/^event$/)
    const iNo = col(/^no$/)
    const iName = col(/^name$/)
    const iStatus = col(/^status$/)
    // The grid's chip column was "Net Time" until Des Moines 2026 renamed it
    // "Time" (the same number the athlete page prints as FINISH TIME).
    const iNet = col(/^net time$/) >= 0 ? col(/^net time$/) : col(/^time$/)
    if (iName < 0 || iNet < 0) throw new Error(`unexpected search grid headers: ${headers.join(',')}`)
    const rows = []
    for (const tr of grid[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1])
      if (cells.length <= iNet) continue
      const link = cells[iName].match(/href="([^"]*myresults\.aspx[^"]*)"/i)
      const href = link ? link[1].replace(/&amp;/g, '&') : null
      const eid = href ? Number(new URLSearchParams(href.split('?')[1]).get('EId')) : null
      rows.push({
        event: iEvent >= 0 ? decode(cells[iEvent]) : '',
        bib: iNo >= 0 ? decode(cells[iNo]) : null,
        name: decode(cells[iName]),
        status: iStatus >= 0 ? decode(cells[iStatus]) : '',
        net: decode(cells[iNet]),
        eid,
        href: href ? `${BASE}/${href}` : null,
      })
    }
    return rows
  }

  /** Finish time of day and the page's overall pace, from the runner detail's last split row. */
  async fetchFinishRow(href) {
    const { text } = await this.fetchText(href)
    const rows = [...text.matchAll(/<tr class="rtv3-splits-main[^"]*">([\s\S]*?)<\/tr>/g)]
    const last = rows[rows.length - 1]
    if (!last) return { tod: null, pace: null }
    const cells = [...last[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => decode(m[1]))
    return {
      tod: /^\d{1,2}:\d{2}:\d{2}$/.test(cells[1] || '') ? cells[1] : null,
      pace: (String(cells[3] || '').match(/^(\d{1,2}:\d{2})/) || [])[1] || null,
    }
  }

  /** Truncate hundredths to whole seconds, as the official certificate does. */
  cleanTime(t) {
    const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(\.\d+)?$/)
    if (!m) return null
    return `${Number(m[1])}:${m[2]}:${m[3]}`
  }

  eventKeyFor(eid) {
    for (const [key, id] of Object.entries(this.tt.events || {})) {
      if (Number(id) === eid) return key
    }
    return null
  }

  async searchRunner(runnerName) {
    console.log(`\n[${this.tag} ${this.year}] TrueTime search for: "${runnerName}"`)
    if (!this.tt?.cid || !this.tt?.rid || !this.tt?.events) {
      return this.yearNotConfiguredResult('missing trueTime cid/rid/events')
    }

    let rows
    try {
      rows = await this.search(runnerName.trim())
      const last = String(runnerName).trim().split(/\s+/).pop()
      if (rows.length === 0 && last && last !== runnerName.trim()) rows = await this.search(last)
    } catch (err) {
      console.error(`[${this.tag} ${this.year}] TrueTime error: ${err.message}`)
      return this.failedLookup(err)
    }

    const inEvents = rows.map(r => ({ ...r, eventKey: this.eventKeyFor(r.eid) })).filter(r => r.eventKey)
    const order = this.config.eventSearchOrder || Object.keys(this.tt.events)

    // Every name match in a sold event, pooled and deduped by bib (the same
    // bib twice is one person; a row without a bib falls back to name, net
    // time and event). One is the runner. Several are different people
    // sharing the name, and which event they ran never settles it (Denver
    // Colfax 2026 had a Diego Garcia in the half and two in the marathon). A
    // person picks; earlier events in eventSearchOrder are listed first.
    const people = new Map()
    const sold = inEvents.filter(r => order.includes(r.eventKey))
    for (const m of this.filterNameMatches(runnerName, sold, r => r.name)) {
      const bib = String(m.bib ?? '').trim()
      const key = bib ? `bib ${bib}` : `${m.name}|${m.net}|${m.eventKey}`
      if (!people.has(key)) people.set(key, m)
    }
    const found = [...people.values()].sort((a, b) => order.indexOf(a.eventKey) - order.indexOf(b.eventKey))
    const labelOf = m => this.config.eventLabels?.[m.eventKey] || m.eventKey
    if (found.length > 1) {
      return this.ambiguousResult(found.map(m => ({ name: m.name, bib: m.bib, time: this.cleanTime(m.net), eventType: labelOf(m) })))
    }
    if (found.length === 1) return this.buildResult(found[0], found[0].eventKey, labelOf(found[0]))

    const candidates = this.filterNameMatches(runnerName, rows, r => r.name)
    return this.notFoundResult(
      candidates.length ? `Name found only outside the matched events (${[...new Set(candidates.map(c => c.event))].join(', ')})` : null,
      candidates.slice(0, 10).map(c => ({ name: c.name, bib: c.bib, eventType: c.event }))
    )
  }

  /**
   * Bib lookup: the page's search box takes a bib as well as a name. Only rows
   * whose No is exactly the bib and whose EId is a sold event are kept.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    console.log(`\n[${this.tag} ${this.year}] TrueTime bib lookup: ${wanted}`)
    if (!this.tt?.cid || !this.tt?.rid || !this.tt?.events) {
      return this.yearNotConfiguredResult('missing trueTime cid/rid/events')
    }
    let rows
    try {
      rows = await this.search(wanted)
    } catch (err) {
      console.error(`[${this.tag} ${this.year}] TrueTime error: ${err.message}`)
      return this.failedLookup(err)
    }
    const hits = rows.filter(r => this.bibsEqual(r.bib, wanted))
    if (!hits.length) return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)
    const order = this.config.eventSearchOrder || Object.keys(this.tt.events)
    for (const eventKey of order) {
      const match = hits.find(r => this.eventKeyFor(r.eid) === eventKey)
      if (!match) continue
      const eventLabel = this.config.eventLabels?.[eventKey] || eventKey
      const result = await this.buildResult(match, eventKey, eventLabel)
      return result?.found ? { ...result, runnerName: match.name } : result
    }
    return this.notFoundResult(`Bib ${wanted} is entered in ${[...new Set(hits.map(h => h.event))].join(', ')}, which this race does not sell`)
  }

  async buildResult(match, eventKey, eventLabel) {
    const chip = this.cleanTime(match.net)
    if (!chip) {
      return this.identityOnlyResult(match.name, match.bib, `TrueTime shows no net time (status: ${match.status || 'unknown'})`, match.href || this.pageUrl())
    }

    // Gun is informational only: finish time of day minus the published gun.
    let gun = null
    let finishTimeOfDay = null
    let pagePace = null
    if (match.href) {
      try {
        const row = await this.fetchFinishRow(match.href)
        finishTimeOfDay = row.tod
        pagePace = row.pace
        const diff = this.tt.gunStart ? toSeconds(finishTimeOfDay) - toSeconds(this.tt.gunStart) : 0
        if (finishTimeOfDay && diff > 0) gun = fromSeconds(diff)
      } catch (err) {
        console.warn(`[${this.tag} ${this.year}] detail fetch failed for ${match.href}: ${err.message}`)
      }
    }

    const distance = this.config.distances?.[eventKey] ?? DEFAULT_DISTANCES[eventKey]
    const pace = this.cleanPagePace(pagePace) ?? (distance ? this.paceWith(match.net, distance, 'floor') : null)
    console.log(`[${this.tag} ${this.year}] FOUND ${match.name} bib ${match.bib} ${eventLabel}: chip ${chip} (net ${match.net}), gun ~${gun || '?'}, pace ${pace}`)

    return {
      found: true,
      bibNumber: match.bib ? String(match.bib) : null,
      officialTime: chip,
      officialPace: pace,
      eventType: eventLabel,
      yearFound: this.year,
      researchNotes: null,
      resultsUrl: match.href || this.pageUrl(),
      rawData: {
        name: match.name,
        event: match.event,
        netTime: match.net,
        chipTime: chip,
        gunTime: gun,
        finishTimeOfDay,
        status: match.status,
      },
    }
  }
}
