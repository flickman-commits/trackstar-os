/**
 * MultiSport Australia Scraper
 *
 * Used by: Sydney Marathon (and potentially other Australian races).
 * Site: https://www.multisportaustralia.com.au
 *
 * Search:  GET /races/{slug}-{year}/search?search={name}
 *          → returns links of the form
 *            /races/{slug}-{year}/events/{eventId}/results/individuals/{ranking}
 *
 * Detail:  GET /races/{slug}-{year}/events/{eventId}/results/individuals/{ranking}
 *          → page contains a print-PDF link with `net_time=HH%3AMM%3ASS` in the
 *            query string. This is the cleanest source of the chip time.
 *
 * Sydney's race uses event_id=1 for the marathon. We filter to the right
 * event so we don't accidentally return 5K/10K/wheelchair results.
 */
import { BaseScraper } from '../BaseScraper.js'
import { launchBrowser } from '../browserLauncher.js'
import * as cheerio from 'cheerio'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

/**
 * Why a matched runner can still come back without a time.
 *
 * MultiSport Australia firewalls the per-runner result pages: with a valid
 * Cloudflare clearance cookie the search endpoint answers 200 while
 * /results/individuals/ returns "Request Blocked - matched a security rule".
 * That is a deliberate rule aimed at automated access, not a bot challenge we
 * are failing to solve, so the honest move is to report it and stop.
 */
/** Row-action link text that is a button, not a person. */
const GENERIC_LINK_TEXT = /^(view( result)?s?|result|details?|more)$/i

const DETAIL_BLOCKED_NOTE =
  'the timing site firewall blocks automated access to individual result pages'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Fetch with Cloudflare-aware fallback. MultiSport Australia is behind
 * Cloudflare. Plain `fetch` is now blocked at the edge on a TLS/header
 * fingerprint — the site returns a 403 ("Request Blocked" WAF page, or the
 * "Just a moment..." JS challenge). A real headless-browser fingerprint
 * clears both, so on ANY 403 we transparently retry via Puppeteer.
 */
/**
 * True when a 200-with-HTML response is actually Cloudflare, not the site.
 *
 * The browser fallback returns whatever page it landed on, so a challenge or a
 * WAF denial arrives as perfectly valid HTML with no results in it. Without
 * this check that reads as "the runner isn't in these results".
 */
export function isBlockPage(html) {
  if (!html) return false
  return /Just a moment\.\.\.|Checking your browser|Request Blocked|matched a security rule|Attention Required/i.test(html)
}

/** Thrown when the site refused us, so callers can tell it apart from a miss. */
export class BlockedError extends Error {
  constructor(url) {
    super('blocked by the site firewall')
    this.name = 'BlockedError'
    this.url = url
  }
}

async function smartFetch(url) {
  // First try a simple fetch — cheap when it works.
  const resp = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.multisportaustralia.com.au/'
    }
  })
  if (resp.ok) return await resp.text()

  // Cloudflare blocks plain fetch — both the "Just a moment" JS challenge and
  // the hard "Request Blocked" WAF page come back as 403. The headless browser
  // clears both (verified: same IP, real Chrome fingerprint -> HTTP 200).
  if (resp.status === 403) {
    const html = await fetchViaBrowser(url)
    // The browser hands back the challenge/denial page as ordinary HTML. Treat
    // that as the refusal it is rather than parsing it for results.
    if (isBlockPage(html)) throw new BlockedError(url)
    return html
  }
  throw new Error(`HTTP ${resp.status}`)
}

/**
 * One fresh browser per fetch. Deliberately not pooled.
 *
 * Sharing a browser across fetches is the obvious optimisation - launching
 * Chromium is two to three seconds and a missed lookup loads two pages - and
 * it does not work here. Measured: the first request through a reused browser
 * succeeds, and every request after it on that same browser comes back as the
 * WAF block page. Cloudflare is fingerprinting the session, so the clean
 * launch is the thing buying us access. Pay for it.
 */
async function fetchViaBrowser(url) {
  let browser = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setUserAgent(USER_AGENT)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    // Wait briefly in case Cloudflare is doing a JS challenge
    await new Promise(r => setTimeout(r, 1500))
    return await page.content()
  } finally {
    // .catch so a failed close can't mask the original error
    if (browser) await browser.close().catch(e => console.error('[MultiSportAustralia] Failed to close browser:', e.message))
  }
}

/** Generational suffixes that are not the surname to search on. */
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * The search terms to try, in order, for a typed name: the name as typed, the
 * name without accents (only if it had any), then the surname alone, with and
 * without accents. Duplicates are dropped.
 *
 * nicknames.js exposes only firstNamesEquivalent, not the names in a group, so
 * nickname variants cannot be queried directly. The surname-only query does
 * the same job the way Mika and SVE use the table: every runner with that
 * surname comes back and filterNameMatches applies the nickname table to them.
 *
 * The surname is the last word that is not a suffix ("William Cox IV" ->
 * "Cox"). The site matches substrings, so a multi-word surname is still found
 * by its last word ("PEREZ GARCIA" by "Garcia").
 */
export function searchQueries(runnerName) {
  const typed = String(runnerName || '').trim().replace(/\s+/g, ' ')
  if (!typed) return []
  const words = typed.split(' ').filter(w => !NAME_SUFFIX.test(w))
  const out = [typed, stripDiacritics(typed)]
  if (words.length > 1) {
    const surname = words[words.length - 1].replace(/[.,]+$/, '')
    if (surname.length >= 2) out.push(surname, stripDiacritics(surname))
  }
  return [...new Set(out)]
}

export class MultiSportAustraliaScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {string} config.raceSlug - e.g. 'sydney-marathon' (slug template, year appended)
   * @param {Object} [config.raceSlugs] - year -> full slug, for years whose URL
   *                  does not follow the {raceSlug}-{year} pattern
   * @param {Object} [config.eventIds] - year -> { marathon: 1 } event ID map
   * @param {number} [config.defaultMarathonEventId=1]
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.tag = config.tag || config.raceName
    this.baseUrl = 'https://www.multisportaustralia.com.au'
    // Most years follow {raceSlug}-{year}, but a race that was renamed keeps
    // its old slug for the editions run under the old name. Sydney 2022 is
    // still filed as blackmores-sydney-running-festival-2022; the computed
    // sydney-marathon-2022 is a hard 404.
    this.raceSlug = config.raceSlugs?.[year] || `${config.raceSlug}-${year}`
  }

  async getRaceInfo() {
    return {
      // resolveRaceDate prefers a verified raceDates entry and only computes
      // as a last resort. Sydney moved from mid-September to late August in
      // 2025, so the computed date is three weeks wrong for 2022-2024.
      raceDate: this.resolveRaceDate(),
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon'],
      resultsUrl: `${this.baseUrl}/races/${this.raceSlug}`,
      resultsSiteType: 'multisport-australia'
    }
  }

  /**
   * The runner's own result page, keyed by the marathon event and bib: the
   * address the site's search links each name to (Sydney 2026 bib 57497 ->
   * /races/sydney-marathon-2026/events/1/results/individuals/57497). Lets
   * Instant Lookup link the runner without launching a browser. The site puts
   * a Cloudflare browser check in front of these pages; a person passes it.
   */
  runnerResultsUrl(bib) {
    const b = String(bib ?? '').trim()
    if (!b) return null
    const eventId = this.config.eventIds?.[this.year]?.marathon ?? this.config.defaultMarathonEventId ?? 1
    return `${this.baseUrl}/races/${this.raceSlug}/events/${eventId}/results/individuals/${encodeURIComponent(b)}`
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    try {
      // Get marathon-specific event id (default to 1)
      const marathonEventId = this.config.eventIds?.[this.year]?.marathon
        ?? this.config.defaultMarathonEventId
        ?? 1

      // Step 1: Search by name. The site matches the typed text literally, so
      // "Bill Cox" finds nobody when he registered as William (Sydney 2026,
      // bib 22082), and accents must agree both ways: "García" returns only
      // rows stored as GARCÍA, "Garcia" only rows stored as GARCIA. So when a
      // query yields no usable match, try the next one (see searchQueries)
      // and let filterNameMatches, which knows nicknames and folds accents,
      // pick among the rows. The first query with a strong (full first name)
      // match wins. A query whose only matches are short forms keeps going to
      // the surname query, so a Christopher found by one search cannot hide a
      // Christian that only the surname search returns (London 2025).
      const seen = new Map()
      const weak = new Map()
      let matches = []
      for (const query of searchQueries(runnerName)) {
        const searchUrl = `${this.baseUrl}/races/${this.raceSlug}/search?search=${encodeURIComponent(query)}`
        console.log(`[${this.tag}] GET ${searchUrl}`)
        let searchHtml
        try {
          searchHtml = await this._fetchPage(searchUrl)
        } catch (err) {
          console.log(`[${this.tag}] Search fetch failed: ${err.message}`)
          if (err instanceof BlockedError) return this.upstreamErrorResult('search blocked by the site firewall')
          return this.upstreamErrorResult(err.message)
        }

        // Step 2: Extract candidate links, only those for the marathon event
        const candidates = this._parseSearchResults(searchHtml, marathonEventId)
        for (const c of candidates) if (!seen.has(c.url)) seen.set(c.url, c)
        const found = this.filterNameMatches(runnerName, candidates, c => c.name)
        console.log(`[${this.tag}] "${query}": ${candidates.length} marathon candidates, ${found.length} name matches`)
        if (found.length && this.nameMatchTier(runnerName, found[0].name) === 0) {
          matches = found
          break
        }
        for (const c of found) if (!weak.has(c.url)) weak.set(c.url, c)
      }
      // No strong match anywhere: re-rank every short-form or possible match
      // from all the queries together, so the best tier across them is kept.
      if (matches.length === 0) matches = this.filterNameMatches(runnerName, [...weak.values()], c => c.name)

      const candidates = [...seen.values()]
      if (candidates.length === 0) return this.notFoundResult()

      if (matches.length === 0) {
        console.log(`[${this.tag}] No name match. Surfacing ${Math.min(candidates.length, 10)} candidates.`)
        return this.notFoundResult(null, candidates.slice(0, 10).map(c => ({
          name: c.name,
          bib: c.bib || null,
          eventType: this.config.defaultEventType || 'Marathon',
        })))
      }
      if (matches.length > 1) {
        // Two runners can share a name - Sydney 2024 has two Shane Smiths - so
        // pass the bib through. It is the only thing that tells them apart, and
        // it is right there in the search row's "(#21037)" suffix. Time stays
        // absent because it lives behind the blocked detail page.
        return this.ambiguousResult(matches.map(m => ({ name: m.name, bib: m.bib || null })))
      }

      // Step 3: Fetch detail page for the matched runner
      const match = matches[0]

      // Unless we already know that page is walled off, in which case the
      // search row is all there is and asking again just costs five seconds.
      if (this.config.detailPagesBlocked) {
        console.log(`[${this.tag}] Detail pages known blocked - returning search-row match`)
        return this.identityOnlyResult(
          match.name, match.bib, DETAIL_BLOCKED_NOTE, `${this.baseUrl}${match.url}`
        )
      }

      const detailUrl = `${this.baseUrl}${match.url}`
      console.log(`[${this.tag}] Fetching detail: ${detailUrl}`)
      let detailHtml
      try {
        detailHtml = await this._fetchPage(detailUrl)
      } catch (err) {
        console.log(`[${this.tag}] Detail fetch failed: ${err.message}`)
        // We already matched this person by name on the search page and we
        // have their bib. Losing the detail page costs us the time, not the
        // identity, so do not throw the match away.
        if (err instanceof BlockedError) {
          return this.identityOnlyResult(match.name, match.bib, DETAIL_BLOCKED_NOTE, detailUrl)
        }
        return this.upstreamErrorResult(err.message)
      }

      const data = this._extractRunnerData(detailHtml)
      if (!data.netTime) {
        // We matched this person on the search page, so they ran. A missing
        // time here means the page did not give us one, which is our problem
        // to fix, not a fact about the runner.
        console.log(`[${this.tag}] No net time on detail page`)
        return this.identityOnlyResult(
          match.name,
          data.bib || match.bib,
          isBlockPage(detailHtml) ? DETAIL_BLOCKED_NOTE : 'the result page carried no net time',
          detailUrl
        )
      }

      const time = this.formatTime(data.netTime)
      const distanceMiles = this.config.distanceMiles || 26.2
      const pace = this.formatPace(this.calculatePace(data.netTime, distanceMiles))

      console.log(`\n[${this.tag}] FOUND RUNNER:`)
      console.log(`  Name: ${match.name}`)
      console.log(`  Bib: ${data.bib || 'N/A'}`)
      console.log(`  Net Time (chip): ${time}`)

      return {
        found: true,
        bibNumber: data.bib ? String(data.bib) : null,
        officialTime: time,
        officialPace: pace,
        eventType: this.config.defaultEventType || 'Marathon',
        yearFound: this.year,
        researchNotes: null,
        resultsUrl: detailUrl,
        rawData: { name: match.name, ...data }
      }
    } catch (error) {
      console.error(`[${this.tag}] Error: ${error.message}`)
      return { ...this.notFoundResult(), researchNotes: `Error: ${error.message}` }
    }
  }

  /** One page fetch; an instance method so tests can stand in for the site. */
  _fetchPage(url) {
    return smartFetch(url)
  }

  /**
   * Parse the search results page. Extracts only links matching the marathon
   * event_id (so we don't pull in 5K / 10K / mini-marathon results).
   *
   * Link format: /races/{slug}/events/{eventId}/results/individuals/{ranking}
   * Link text:   "Eliud KIPCHOGE (#1)" — strip the trailing "(#N)" ranking
   */
  _parseSearchResults(html, marathonEventId) {
    const $ = cheerio.load(html)
    // Keyed by detail URL: each result row links to the same runner TWICE, once
    // from their name and once from a "View Result" button. Collecting both
    // produced a phantom candidate literally named "View Result", doubled the
    // reported candidate count, and could turn one runner into a false
    // ambiguity. One row is one runner, so the URL is the identity.
    const byUrl = new Map()

    $('a[href*="/results/individuals/"]').each((_, a) => {
      const href = $(a).attr('href') || ''
      const text = $(a).text().trim()

      // Filter to the marathon event only
      const eventMatch = href.match(/\/events\/(\d+)\/results\/individuals\//)
      if (!eventMatch) return
      if (parseInt(eventMatch[1], 10) !== marathonEventId) return

      // Strip "(#N)" bib suffix
      const name = text.replace(/\s*\(#\d+\)\s*$/, '').trim()
      if (!name || GENERIC_LINK_TEXT.test(name)) return

      // The bib rides in the name link's suffix; the button link has none.
      const bibMatch = text.match(/\(#(\d+)\)/)
      const existing = byUrl.get(href)
      if (!existing) {
        byUrl.set(href, { name, url: href, bib: bibMatch ? bibMatch[1] : null })
      } else if (!existing.bib && bibMatch) {
        byUrl.set(href, { name, url: href, bib: bibMatch[1] })
      }
    })

    return [...byUrl.values()]
  }

  /**
   * Extract runner data from the detail page.
   * The cleanest source is the print-PDF link:
   *   .../official-...-print?first_name=X&last_name=Y&race_no=N&net_time=HH%3AMM%3ASS
   */
  _extractRunnerData(html) {
    const result = { netTime: null, bib: null }

    // Prefer the print URL — it has net_time explicitly labeled
    const printMatch = html.match(/[?&]net_time=([^&"'<>]+)/i)
    if (printMatch) {
      result.netTime = decodeURIComponent(printMatch[1])
    }

    const bibMatch = html.match(/[?&]race_no=(\d+)/i)
    if (bibMatch) result.bib = bibMatch[1]

    // Fallback: og:description ("...finished... in HH:MM:SS")
    if (!result.netTime) {
      const og = html.match(/og:description"\s+content="[^"]*\bin\s+(\d{1,2}:\d{2}:\d{2})/i)
      if (og) result.netTime = og[1]
    }

    return result
  }
}

export default MultiSportAustraliaScraper
