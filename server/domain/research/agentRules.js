/**
 * The research agent's rules, with no database and no network, so they can be
 * tested on their own (agentRules.test.js). researchAgent.js does the work.
 *
 * The hard rule these exist for: a time is only written when it was read off
 * the race's official results page, chip time (never gun), and pace as that
 * page shows it. `checkRowOnPage` is the gate. It reads the page text the
 * server fetched itself, not what a model says the page said, and says no
 * whenever the page leaves any doubt: gun or clock times on the page, more
 * than one finish-like time in the row, a pace that is not the overall pace,
 * or a name that is not the order's name. A "no" is never a dead end: the
 * reason goes to a person with the evidence beside it.
 */
import { distanceForEventType } from '../../services/ResearchService.js'
import { SCRAPER_MIN_YEAR } from '../orders/pipeline.js'

/** The Action queue reasons that are a runner result to look up. */
export const RESEARCH_REASONS = new Set([
  'Runner not found', 'Research by hand', 'Timing site down', 'No time', 'No bib',
  'Needs a scraper', 'Results not online', 'Pick a match', 'Enter the time',
])

/**
 * What the agent does with one queue item, before any lookup:
 *   skip    no year to look in
 *   person  only a person can settle it (several runners on one print, a real pick between same-name finishers)
 *   rerun   the race has a scraper for the year: run research again, then try name variants
 *   web     no scraper, or a year before 2020: look for the official page on the web, then check it here.
 *           No scraper is ever built for those years (Matt, 2026-10-21), but their
 *           orders still need their result found (Matt, 2026-10-28).
 */
export function planFor({ reason, year, runner, hasScraper }) {
  if (!year) return { action: 'skip', why: 'The order has no race year.' }
  if (isSeveralRunners(runner)) return { action: 'person', why: `"${runner}" names more than one runner. A person decides whose result prints.` }
  if (reason === 'Pick a match') return { action: 'person', why: 'Several finishers share this name. A person picks one on the results site.' }
  return hasScraper && year >= SCRAPER_MIN_YEAR ? { action: 'rerun' } : { action: 'web' }
}

/** "Owen And Bridget", "Aaron & Tara Collins": one print, two runners. */
export function isSeveralRunners(name) {
  return /\s(and|&|\+)\s/i.test(String(name || ''))
}

/** Lower case, accents off, punctuation to spaces. */
export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Same person by name: first and last the same, middle names and initials ignored. */
export function sameName(a, b) {
  const x = fold(a).split(' ').filter(Boolean), y = fold(b).split(' ').filter(Boolean)
  if (x.length < 2 || y.length < 2) return x.join(' ') === y.join(' ')
  return x[0] === y[0] && x[x.length - 1] === y[y.length - 1]
}

const NICKNAMES = {
  dave: 'david', dan: 'daniel', danny: 'daniel', mike: 'michael', matt: 'matthew', chris: 'christopher',
  jim: 'james', jimmy: 'james', bob: 'robert', rob: 'robert', bill: 'william', will: 'william', liz: 'elizabeth',
  beth: 'elizabeth', kate: 'katherine', katie: 'katherine', kathy: 'katherine', jen: 'jennifer', jenny: 'jennifer',
  steve: 'steven', tom: 'thomas', tony: 'anthony', joe: 'joseph', nick: 'nicholas', sam: 'samuel', alex: 'alexander',
  ben: 'benjamin', andy: 'andrew', drew: 'andrew', greg: 'gregory', jon: 'jonathan', josh: 'joshua', pat: 'patrick',
  rick: 'richard', rich: 'richard', dick: 'richard', ted: 'edward', ed: 'edward', sue: 'susan', deb: 'deborah',
  debbie: 'deborah', abby: 'abigail', maddie: 'madeline', meg: 'megan', zach: 'zachary', jake: 'jacob', tim: 'timothy',
}

/**
 * Other ways the results may spell the order's name: without middle names,
 * the nickname's long form and the long form's nickname. A hit on one of
 * these is a suggestion for a person, never a result (it is not the name the
 * customer gave).
 */
export function nameVariants(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return []
  const first = parts[0], last = parts[parts.length - 1]
  const out = new Set()
  if (parts.length > 2) out.add(`${first} ${last}`)
  const f = first.toLowerCase()
  if (NICKNAMES[f]) out.add(`${cap(NICKNAMES[f])} ${last}`)
  for (const [nick, full] of Object.entries(NICKNAMES)) if (full === f) out.add(`${cap(nick)} ${last}`)
  out.delete(parts.join(' '))
  return [...out]
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

/** "03:12:07" and "3:12:07" are the same clock reading; seconds, or null. */
export function clockSeconds(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/)
  if (!m) return null
  return m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
}

const TIME_TOKEN = /\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g
const PACE_TOKEN = /(?<![:\d])\d{1,2}:\d{2}(?![:\d])/g

/** The lines of page text where the order's runner appears, with what is next to them. */
function rowsFor(text, runner) {
  const want = fold(runner).split(' ').filter(Boolean)
  const first = want[0], last = want[want.length - 1]
  const lines = String(text || '').split('\n')
  const rows = []
  lines.forEach((line, i) => {
    const words = fold(line).split(' ')
    if (!words.includes(last) || !words.includes(first)) return
    // A JSON result spreads one runner over several lines; an HTML row is one line.
    const row = line.length > 40 ? line : lines.slice(Math.max(0, i - 6), i + 10).join(' ')
    rows.push(row)
  })
  return rows
}

/**
 * Does the page the server fetched carry this runner's result, plainly enough
 * to print without a person? Returns { ok: true, row } or { ok: false, why, row? }.
 *
 * @param {object} p
 * @param {string} p.text        the page as text (scraperTrace.readableBody)
 * @param {string} p.url         where it came from
 * @param {string} p.runner      the order's runner name
 * @param {string} p.raceName
 * @param {number} p.year
 * @param {string} p.time        the claimed chip time, as the page shows it
 * @param {string} p.pace        the claimed pace, as the page shows it
 * @param {string} [p.bib]
 * @param {string} p.eventType   Marathon, Half Marathon, 10K...
 */
export function checkRowOnPage({ text, url, runner, raceName, year, time, pace, bib, eventType }) {
  if (!text) return { ok: false, why: 'The page came back empty to our server (it probably draws its results with JavaScript).' }
  if (isSeveralRunners(runner)) return { ok: false, why: `"${runner}" is more than one runner; a person decides whose result prints.` }
  const rows = rowsFor(text, runner)
  if (!rows.length) return { ok: false, why: `"${runner}" is not on the page as our server read it (the site may draw its results with JavaScript).` }
  const hay = `${url || ''}\n${text}`
  if (!new RegExp(`\\b${year}\\b`).test(hay)) return { ok: false, why: `The page does not mention ${year}, so it may be another year's results.` }
  const raceWords = fold(raceName).split(' ').filter(w => w.length > 2 && !/^(marathon|half|the|and|race|run|runs|international|annual)$/.test(w))
  if (raceWords.length && !raceWords.some(w => fold(hay).split(' ').includes(w))) return { ok: false, why: `The page does not mention ${raceName}.` }
  if (/\b(gun|clock)\s*(time)?\b/i.test(text)) return { ok: false, why: 'The page lists gun or clock times as well as chip times. A person checks which column is chip.' }

  const timeS = clockSeconds(time)
  if (timeS == null) return { ok: false, why: `"${time}" is not a finish time.` }
  const withTime = rows.filter(r => (r.match(TIME_TOKEN) || []).some(t => clockSeconds(t) === timeS))
  if (!withTime.length) return { ok: false, why: `The page has ${runner}, but not with the time ${time}.`, row: rows[0].slice(0, 300) }
  if (withTime.length > 1) return { ok: false, why: `${runner} appears more than once on the page with that time. A person checks which one.`, row: withTime[0].slice(0, 300) }
  const row = withTime[0]
  const clean = row.slice(0, 400)

  // Splits are fine when the finish is the largest time in the row; two
  // different finish-like times are not (gun and chip under other labels).
  const times = [...new Set((row.match(TIME_TOKEN) || []).map(clockSeconds))]
  if (Math.max(...times) !== timeS) return { ok: false, why: `${time} is not the last time in the row, so it may be a split.`, row: clean }
  if (times.filter(t => Math.abs(t - timeS) < 15 * 60 && t !== timeS).length) return { ok: false, why: 'The row has another time close to the finish (a gun time under another label?). A person checks.', row: clean }

  if (bib && !new RegExp(`(^|[^\\d])${String(bib).replace(/\D/g, '')}([^\\d]|$)`).test(row)) return { ok: false, why: `Bib ${bib} is not in the runner's row.`, row: clean }

  const miles = distanceForEventType(eventType)
  if (!miles) return { ok: false, why: `"${eventType || 'no event'}" is not a distance the tool knows, so the pace cannot be checked.`, row: clean }
  const paceS = clockSeconds(pace)
  if (paceS == null || !(row.match(PACE_TOKEN) || []).some(p => clockSeconds(p) === paceS)) return { ok: false, why: `The pace ${pace || '(none)'} is not shown in the runner's row. A person computes it from the chip time.`, row: clean }
  // A page pace has to be the overall pace per mile: per-km and per-segment
  // paces print wrong (Grandma's "Pace Between"). Rounding differs by site,
  // so within two seconds either way.
  if (Math.abs(paceS - timeS / miles) > 2) return { ok: false, why: `The page's pace ${pace} is not ${time} over ${miles} miles (a per-km or per-segment pace?).`, row: clean }
  return { ok: true, row: clean }
}
