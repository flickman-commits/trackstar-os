/**
 * Eyes for the nightly agent: see what a scraper actually sends and gets back.
 *
 * The agent runs in a cloud sandbox whose network refuses every timing site,
 * so before this it could only learn "live" or "drifted" and had nothing to
 * debug with. A scraper cannot be fixed by someone who cannot see the page.
 * These run on the server, which can reach the sites, and hand back what came
 * over the wire, trimmed to something a model can read.
 *
 *   traceScraper    — run one search and record every HTTP exchange it made
 *   fetchTimingPage — fetch one URL on a known timing host, optionally
 *                     returning only the text around a search string
 *
 * Both are read-only toward production data. The only cost is requests to
 * third-party sites, so both go through a durable per-host rate limit: Sydney's
 * firewall blocked us after dozens of rapid loads, and an agent debugging a
 * parser in a loop is exactly how that happens again.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { isIP } from 'node:net'
import { getScraperForRace } from '../scrapers/index.js'
import { ensureOverridesLoaded } from '../scrapers/scraperOverrides.js'
import { checkRateLimitDurable } from './publicRateLimit.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'

/**
 * Hosts fetchTimingPage may reach, matched as a suffix. Taken from the URLs the
 * scrapers and configs already call; TIMING_HOSTS_EXTRA (comma-separated) adds
 * a new platform without a deploy. Anything else is refused, so this can never
 * be pointed at an internal address or an arbitrary site.
 */
const TIMING_HOSTS = [
  'athlinks.com', 'rtrt.me', 'runsignup.com', 'xacte.com', 'raceroster.com',
  'mychiptime.com', 'scorethis-results.com', 'nyrr.org', 'laurelt.com',
  'multisportaustralia.com.au', 'sportstats.one', 'svetiming.com', 'myrace.ai',
  'chicagomarathon.com', 'chronotrack.com', 'marathon.tokyo',
  'tcslondonmarathon.com', 'mesamarathon.com', 'competitivetiming.com',
  'mikatiming.com', 'mikatiming.de', 'mtecresults.com', 'raceresult.com',
  'liveplanit-api-461759013131.us-central1.run.app', 'hubertiming.com',
]

const PER_HOST_PER_HOUR = 20
const TRACES_PER_RACE_PER_HOUR = 6
const HOUR = 60 * 60 * 1000
const TRACE_TIMEOUT_MS = 60_000
const BODY_LIMIT = 6000
const FIND_WINDOW = 800
const MAX_FIND_HITS = 5
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 20_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function allowedHost(hostname) {
  const extra = String(process.env.TIMING_HOSTS_EXTRA || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
  const host = hostname.toLowerCase()
  return [...TIMING_HOSTS, ...extra].some(h => host === h || host.endsWith(`.${h}`))
}

/** Names that only ever mean a machine on our side of the network. */
function privateName(host) {
  return host === 'localhost' || /\.(localhost|internal|local|lan|home|corp)$/.test(host) || !host.includes('.')
}

/**
 * Why a URL may not be fetched, or null when it may. Checked on the first URL
 * and again on every redirect, so an allowed host cannot bounce the request
 * somewhere else.
 */
export function urlRefusal(parsed) {
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'Only http(s) URLs.'
  if (parsed.username || parsed.password) return 'URLs with credentials in them are refused.'
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return 'Only the standard ports (80 and 443).'
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isIP(host)) return 'IP addresses are refused; use the timing site\'s host name.'
  if (privateName(host)) return `${host} is a private name, not a timing site.`
  if (!allowedHost(host)) return `${host} is not a known timing host. Add it to TIMING_HOSTS_EXTRA in Vercel if it is a new platform.`
  return null
}

/** A short, fixed reason for a failed request. The error itself goes to the log. */
function fetchFailure(err) {
  if (err?.name === 'TimeoutError') return 'The request timed out.'
  const code = err?.cause?.code || err?.code
  return code && /^[A-Z_]{3,30}$/.test(code) ? `The request failed (${code}).` : 'The request failed.'
}

/** Shorten JSON by keeping the first few items of every array. */
function trimJson(value, depth = 0) {
  if (Array.isArray(value)) {
    const head = value.slice(0, 3).map(v => trimJson(v, depth + 1))
    return value.length > 3 ? [...head, `…${value.length - 3} more items`] : head
  }
  if (value && typeof value === 'object') {
    if (depth > 6) return '{…}'
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimJson(v, depth + 1)]))
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`
  return value
}

/** HTML reduced to its visible text and table structure. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(tr|p|div|li|h\d)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/**
 * A body the model can read. With `find`, only the text around each hit, which
 * is what you want from a 300KB results page: where is this runner, and what
 * do the cells next to them look like.
 */
export function readableBody(text, contentType = '', { find = null, limit = BODY_LIMIT } = {}) {
  if (!text) return { bytes: 0, body: '' }
  const bytes = text.length

  if (find) {
    const hay = text.toLowerCase()
    const needle = String(find).toLowerCase()
    const hits = []
    let at = hay.indexOf(needle)
    while (at !== -1 && hits.length < MAX_FIND_HITS) {
      hits.push(text.slice(Math.max(0, at - FIND_WINDOW), at + needle.length + FIND_WINDOW))
      at = hay.indexOf(needle, at + needle.length + FIND_WINDOW)
    }
    return { bytes, matches: hits.length, body: hits.length ? hits.join('\n\n----\n\n') : `"${find}" does not appear in the response.` }
  }

  let body = text
  if (/json/i.test(contentType) || /^\s*[[{]/.test(text)) {
    try { body = JSON.stringify(trimJson(JSON.parse(text)), null, 1) } catch { /* not JSON after all */ }
  } else if (/html/i.test(contentType) || /^\s*</.test(text)) {
    body = htmlToText(text)
  }
  return { bytes, body: body.length > limit ? `${body.slice(0, limit)}\n…[${body.length - limit} more characters; pass find to see a specific part]` : body }
}

/* ── Recording ──────────────────────────────────────────────────────────── */

const recorder = new AsyncLocalStorage()
let installed = false

/**
 * Wrap global fetch once. Outside a trace the wrapper is a pass-through; inside
 * one it records each exchange for that trace only, so concurrent requests on a
 * warm instance never land in each other's recordings.
 */
function installRecorder() {
  if (installed) return
  installed = true
  const realFetch = globalThis.fetch
  globalThis.fetch = async function recordingFetch(input, init = {}) {
    const log = recorder.getStore()
    if (!log) return realFetch(input, init)
    const url = typeof input === 'string' ? input : input?.url
    const method = init.method || input?.method || 'GET'
    const started = Date.now()
    try {
      const resp = await realFetch(input, init)
      const text = await resp.clone().text().catch(() => '')
      log.push({
        method, url, status: resp.status, ms: Date.now() - started,
        contentType: resp.headers.get('content-type') || '',
        requestBody: typeof init.body === 'string' ? init.body.slice(0, 1000) : undefined,
        text,
      })
      return resp
    } catch (err) {
      log.push({ method, url, ms: Date.now() - started, error: fetchFailure(err) })
      throw err
    }
  }
}

/** The config values that apply to one year: event ids, codes, sub-events. */
function yearConfig(config, year) {
  const out = { platform: config.platform }
  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value[year] !== undefined) {
      out[key] = value[year]
    }
  }
  return out
}

/**
 * Run one scraper search and return what it did on the wire.
 *
 * Browser-driven scrapers (RunSignUp, MultiSport) fetch inside Chromium, which
 * this cannot see; the result says so rather than returning an empty list that
 * reads like "no requests were needed".
 */
export async function traceScraper({ race, year, name, find = null }) {
  const limit = await checkRateLimitDurable(`${race}:${year}`, {
    bucket: 'scraper-trace', max: TRACES_PER_RACE_PER_HOUR, windowMs: HOUR,
  })
  if (!limit.allowed) {
    return { ok: false, error: `Traced ${race} ${year} ${TRACES_PER_RACE_PER_HOUR} times this hour already. Work from the traces you have; retry in ${Math.ceil(limit.retryAfterMs / 60000)} min.` }
  }

  await ensureOverridesLoaded()
  installRecorder()

  let scraper
  try {
    scraper = getScraperForRace(race, year)
  } catch (err) {
    console.warn(`[scraperTrace] no scraper for ${race} ${year}:`, err?.message)
    return { ok: false, error: `No scraper is configured for ${race} ${year}.` }
  }

  const log = []
  let result = null
  let error = null
  await recorder.run(log, async () => {
    try {
      result = await Promise.race([
        scraper.searchRunner(name),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`search exceeded ${TRACE_TIMEOUT_MS}ms`)), TRACE_TIMEOUT_MS)),
      ])
    } catch (err) {
      console.error(`[scraperTrace] ${race} ${year} search failed:`, err)
      error = err?.name === 'TimeoutError' || /exceeded \d+ms/.test(String(err?.message))
        ? `The search took longer than ${TRACE_TIMEOUT_MS / 1000}s.`
        : `The scraper threw an error${err?.name && /^[A-Za-z]{1,40}$/.test(err.name) ? ` (${err.name})` : ''}; the details are in the server log. Read the exchanges for what the site sent back.`
    }
  })

  return {
    ok: !error,
    race, year, name,
    config: yearConfig(scraper.config || {}, year),
    error,
    result: result && {
      found: result.found ?? null,
      runnerName: result.runnerName ?? null,
      bibNumber: result.bibNumber ?? null,
      officialTime: result.officialTime ?? null,
      officialPace: result.officialPace ?? null,
      eventType: result.eventType ?? null,
      researchStatus: result.researchStatus ?? null,
      researchNotes: result.researchNotes ?? null,
      possibleMatches: (result.possibleMatches || []).slice(0, 5),
    },
    exchanges: log.map(x => ({
      method: x.method, url: x.url, status: x.status, ms: x.ms, error: x.error,
      requestBody: x.requestBody,
      ...readableBody(x.text || '', x.contentType, { find, limit: 4000 }),
    })),
    note: log.length
      ? undefined
      : 'No HTTP requests were recorded. Either the scraper returned before fetching (check config and error) or it fetches through a headless browser, which a trace cannot see - use fetch_timing_page on the URL it loads.',
  }
}

/**
 * Fetch one URL on a timing host and return a readable version of it.
 * Redirects are followed by hand, at most MAX_REDIRECTS, and each hop is held
 * to the same rules as the first URL. The second argument is for tests.
 */
export async function fetchTimingPage({ url, find = null, method = 'GET', body = null, contentType = null, limit = BODY_LIMIT }, { fetchImpl = fetchWithTimeout, rateLimit = checkRateLimitDurable } = {}) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Not a valid URL.' }
  }
  const refused = urlRefusal(parsed)
  if (refused) return { ok: false, error: refused }
  let verb = String(method).toUpperCase()
  if (verb !== 'GET' && verb !== 'POST') return { ok: false, error: 'Only GET and POST.' }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  }
  if (contentType) headers['Content-Type'] = contentType

  const budgeted = new Set()
  const started = Date.now()
  let sendBody = verb === 'POST' && body ? String(body) : undefined
  for (let hop = 0; ; hop++) {
    const host = parsed.hostname.toLowerCase()
    if (!budgeted.has(host)) {
      const limit = await rateLimit(host, { bucket: 'timing-fetch', max: PER_HOST_PER_HOUR, windowMs: HOUR })
      if (!limit.allowed) {
        return { ok: false, error: `${PER_HOST_PER_HOUR} fetches to ${host} this hour already. Back off this host; retry in ${Math.ceil(limit.retryAfterMs / 60000)} min.` }
      }
      budgeted.add(host)
    }

    let resp
    try {
      resp = await fetchImpl(parsed.href, { method: verb, headers, body: sendBody, redirect: 'manual' }, FETCH_TIMEOUT_MS)
    } catch (err) {
      console.warn(`[scraperTrace] fetch ${parsed.href} failed:`, err?.message)
      return { ok: false, ms: Date.now() - started, error: fetchFailure(err) }
    }

    const location = REDIRECT_STATUSES.has(resp.status) ? resp.headers.get('location') : null
    if (location) {
      if (hop >= MAX_REDIRECTS) return { ok: false, status: resp.status, error: `More than ${MAX_REDIRECTS} redirects; stopped at ${parsed.href}.` }
      let next
      try { next = new URL(location, parsed) } catch { return { ok: false, status: resp.status, error: 'The site redirected to an invalid URL.' } }
      const why = urlRefusal(next)
      if (why) return { ok: false, status: resp.status, error: `The site redirected somewhere this will not follow: ${why}` }
      // As browsers do: 303, and a 301 or 302 after a POST, become a GET with no body.
      if (resp.status === 303 || ((resp.status === 301 || resp.status === 302) && verb === 'POST')) {
        verb = 'GET'
        sendBody = undefined
        delete headers['Content-Type']
      }
      parsed = next
      continue
    }

    try {
      const text = await resp.text()
      const type = resp.headers.get('content-type') || ''
      return {
        ok: resp.ok, status: resp.status, finalUrl: parsed.href, redirects: hop || undefined, contentType: type,
        ms: Date.now() - started, ...readableBody(text, type, { find, limit }),
      }
    } catch (err) {
      console.warn(`[scraperTrace] reading ${parsed.href} failed:`, err?.message)
      return { ok: false, status: resp.status, ms: Date.now() - started, error: fetchFailure(err) }
    }
  }
}
