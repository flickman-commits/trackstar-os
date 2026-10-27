/**
 * Base class for all race result scrapers
 * Provides common interface and shared utilities
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { firstNamesEquivalent } from './nicknames.js'

/** Generational suffixes, each mapped to one spelling so "Jnr" equals "Jr". */
const GENERATIONAL_SUFFIXES = new Map([
  ['jr', 'jr'], ['jnr', 'jr'],
  ['sr', 'sr'], ['snr', 'sr'],
  ['ii', 'ii'], ['iii', 'iii'], ['iv', 'iv'], ['v', 'v'],
])

/**
 * Surname particles. A run made only of these ("de", "van der") is not
 * evidence that two surnames are the same.
 */
const SURNAME_PARTICLES = new Set([
  'de', 'del', 'della', 'der', 'den', 'di', 'da', 'das', 'do', 'dos', 'du',
  'la', 'le', 'los', 'las', 'van', 'von', 'y', 'e', 'st', 'bin', 'al', 'el',
])

/**
 * Per-searchRunner record of which name tier filterNameMatches returned, so
 * a found result built on a tier-2 name can be held for a person to confirm.
 * AsyncLocalStorage so concurrent searches on one instance do not mix.
 */
const nameSearchContext = new AsyncLocalStorage()

/** True when `short` appears in `long` as consecutive whole words. */
function isWordRun(short, long) {
  if (short.length === 0 || short.length > long.length) return false
  for (let i = 0; i + short.length <= long.length; i++) {
    if (short.every((w, j) => long[i + j] === w)) return true
  }
  return false
}

/**
 * Do two surname word lists name the same family? `rest1`/`rest2` are the
 * words after the first name (they may include middle names). Hyphens split
 * words, initials are ignored, and the overlap has to be at least one word
 * that is not a particle. Tried both ways round, and also with each side's
 * last word alone (the customer's surname when they typed a middle name).
 */
function surnameVariant(rest1, rest2) {
  const words = rest => rest.flatMap(w => w.split('-')).filter(w => w.length > 1)
  const a = words(rest1)
  const b = words(rest2)
  if (a.length === 0 || b.length === 0) return false
  const meaningful = run => run.some(w => !SURNAME_PARTICLES.has(w))
  const tries = [[a, b], [b, a], [a.slice(-1), b], [b.slice(-1), a]]
  return tries.some(([short, long]) => meaningful(short) && isWordRun(short, long))
}

/**
 * "Peter Maiers" and "G. Peter Maiers": `listed` starts with an initial and
 * `typed`'s first name (exactly or by nickname) is one of `listed`'s middle
 * names. Surnames are already known to be equal.
 */
function middleNameUsedAsFirst(typed, listed) {
  if (listed.length < 3 || listed[0].length !== 1) return false
  const first = typed[0]
  if (first.length < 2) return false
  return listed.slice(1, -1).some(m => m === first || firstNamesEquivalent(m, first))
}

/** The runner name a scraper put on a found result, if it put one. */
function resultRunnerName(result) {
  const raw = result.rawData || {}
  const joined = `${raw.firstName || ''} ${raw.lastName || ''}`.trim()
  return result.runnerName || result.officialName || raw.name || raw.fullName ||
    raw.displayName || joined || null
}

export class BaseScraper {
  constructor(raceName, year) {
    this.raceName = raceName
    this.year = year

    // Every platform's searchRunner runs inside a name-tier record, so a
    // result found on a tier-2 ("possible") name is handed to a person to
    // confirm instead of being accepted. See _confirmPossibleNameMatch.
    const impl = this.searchRunner
    if (typeof impl === 'function' && impl !== BaseScraper.prototype.searchRunner) {
      this.searchRunner = (...args) => this._searchRunnerWithNameCheck(impl, args)
    }
  }

  /**
   * Get race-level info (date, location, event types) - must be implemented by subclass
   * This data is the same for ALL runners in a race and should be cached at the Race level
   * @returns {Promise<Object>} { raceDate, location, eventTypes, resultsUrl, resultsSiteType }
   */
  async getRaceInfo() {
    throw new Error('Must implement getRaceInfo()')
  }

  /**
   * Search for a runner's results - must be implemented by subclass
   * @param {string} runnerName - Full name to search for
   * @returns {Promise<Object>} Standardized result object
   */
  async searchRunner(runnerName) {
    throw new Error('Must implement searchRunner()')
  }

  /**
   * Look a runner up by bib number instead of name.
   *
   * Research falls back to this when the name on an order finds nobody (a
   * married name, a typo, a nickname) but a person has typed the bib in by
   * hand. Platforms that can search by bib override it and return the same
   * shape searchRunner does: found with chip time, chip pace, event type,
   * results URL and bib, or notFoundResult / upstreamErrorResult.
   *
   * Contract for implementations: only ever return a runner whose bib equals
   * the bib searched (exact, after trimming), and only from the event/race
   * ids searchRunner would use (never a 5K or relay entry).
   *
   * @param {string} _bib
   * @returns {Promise<Object|null>} null = this platform cannot search by bib
   */
  async searchRunnerByBib(_bib) {
    return null
  }

  /** Exact bib comparison used by every searchRunnerByBib. */
  bibsEqual(a, b) {
    const x = String(a ?? '').trim()
    const y = String(b ?? '').trim()
    return x !== '' && x === y
  }

  /**
   * Normalize time string to h:mm:ss format
   * Handles various input formats: "3:42:15", "03:42:15", "3h 42m 15s", etc.
   */
  normalizeTime(timeString) {
    if (!timeString) return null

    // Already in h:mm:ss or hh:mm:ss format
    const hhmmss = timeString.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
    if (hhmmss) {
      const [, h, m, s] = hhmmss
      return `${parseInt(h)}:${m}:${s}`
    }

    // Format: "3h 42m 15s" or similar
    const hms = timeString.match(/(\d+)h\s*(\d+)m\s*(\d+)s/i)
    if (hms) {
      const [, h, m, s] = hms
      return `${parseInt(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }

    // Just return cleaned up version
    return timeString.trim()
  }

  /**
   * Format time for display - removes leading zeros
   * "04:14:45" -> "4:14:45"
   * "00:45:30" -> "0:45:30" (keeps single digit hour)
   * @param {string} time - Time in hh:mm:ss or h:mm:ss format
   * @returns {string} Formatted time
   */
  formatTime(time) {
    if (!time) return null
    // Remove leading zero from hours (04:14:45 -> 4:14:45)
    return time.replace(/^0(\d):/, '$1:')
  }

  /**
   * Format pace for display - removes leading zero
   * "09:43" -> "9:43"
   * @param {string} pace - Pace in m:ss format
   * @returns {string} Formatted pace (numbers only, no unit)
   */
  formatPace(pace) {
    if (!pace) return null
    // Remove leading zero if present (09:43 -> 9:43)
    return pace.replace(/^0/, '')
  }

  /**
   * Round a time with milliseconds to the nearest second
   * e.g. "4:37:44.935" -> "4:37:45", "4:37:44.123" -> "4:37:44"
   * @param {string} time - Time string possibly ending in .milliseconds
   * @returns {string} Time rounded to nearest second
   */
  roundTime(time) {
    if (!time) return null
    const msMatch = time.match(/^(.+)\.(\d+)$/)
    if (!msMatch) return time
    const ms = parseInt(msMatch[2].padEnd(3, '0').slice(0, 3))
    let base = msMatch[1]
    if (ms >= 500) {
      const parts = base.split(':').map(Number)
      parts[parts.length - 1] += 1
      for (let i = parts.length - 1; i > 0; i--) {
        if (parts[i] >= 60) { parts[i] -= 60; parts[i - 1] += 1 }
      }
      base = parts.map((p, i) => i === 0 ? String(p) : String(p).padStart(2, '0')).join(':')
    }
    return base
  }

  /**
   * Calculate pace per mile from finish time and distance
   * @param {string} time - Finish time in h:mm:ss format
   * @param {number} distanceMiles - Distance in miles (26.2 for marathon, 13.1 for half)
   * @returns {string} Pace in m:ss format (without " / mi" suffix - use formatPace for display)
   */
  /**
   * The date this race was actually run, in order of trustworthiness:
   *
   *   1. A date scraped from the results page for THIS year.
   *   2. `config.raceDates[year]` — a date someone verified against a real
   *      source and wrote down.
   *
   * There is no third rule any more. Configs used to carry a recurrence rule
   * as a fallback and it has been removed everywhere: the race date drives the
   * weather printed on the poster, and a plausible wrong date is worse than an
   * obvious gap because nobody can see it. An unsupported year returns null.
   *
   * Two traps worth knowing, both real:
   *   - A scraped date from the WRONG year (a fallback event id pointing at the
   *     most recent edition) is rejected here by the year check.
   *   - A timer's own date field may be the event WEEKEND, not race day.
   *     Athlinks reports Detroit as the Saturday; the marathon is Sunday.
   *     Verify which day a source means before trusting it.
   *
   * @param {Date|null} scrapedDate - date read off the results page, if any
   * @returns {Date|null}
   */
  resolveRaceDate(scrapedDate = null) {
    if (scrapedDate instanceof Date && !isNaN(scrapedDate.valueOf())) {
      if (scrapedDate.getFullYear() === this.year) return scrapedDate
      console.warn(`[${this.tag || this.raceName} ${this.year}] Ignoring scraped date ${scrapedDate.toDateString()}: wrong year`)
    }

    const configured = this.config?.raceDates?.[this.year]
    if (configured) {
      // Build from parts. `new Date('2024-10-20')` is parsed as UTC midnight,
      // which renders as the 19th anywhere west of Greenwich.
      const [y, m, d] = String(configured).split('-').map(Number)
      if (y && m && d) return new Date(y, m - 1, d)
      console.warn(`[${this.tag || this.raceName} ${this.year}] Unparseable raceDates entry: ${configured}`)
    }

    // No computed fallback, by design.
    //
    // Configs used to carry a calculateDate rule - "first Sunday of December",
    // "last Sunday of September" - and the rules were wrong often enough to
    // matter while always looking right. CIM 2019 and 2024 came out a week
    // early because December 1st was itself a Sunday; Berlin 2025 came out a
    // week late. Nobody can spot a plausible wrong date, and it drives both the
    // date printed on the poster and the weather looked up for it.
    //
    // An unlisted year now returns null. That is visible, it gets fixed, and it
    // cannot quietly ship. Add the year to raceDates with a source.
    console.warn(`[${this.tag || this.raceName} ${this.year}] No verified date. Add a raceDates entry to the config.`)
    return null
  }

  /**
   * A race with more than one design for the same distance (Detroit's
   * International and Motor City halves) lists them in config.namedEvents as
   * { match: /course name/, label }. The label becomes the event type, and the
   * production file is picked by it (spec.js templateFor).
   */
  namedEvent(courseName, fallback) {
    const hit = (this.config?.namedEvents || []).find(e => e.match.test(String(courseName || '')))
    return hit ? hit.label : fallback
  }

  calculatePace(time, distanceMiles = 26.2) {
    if (!time) return null

    const parts = time.split(':')
    let totalSeconds

    if (parts.length === 3) {
      totalSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
    } else if (parts.length === 2) {
      totalSeconds = parseInt(parts[0]) * 60 + parseInt(parts[1])
    } else {
      return null
    }

    const paceSeconds = totalSeconds / distanceMiles
    let paceMinutes = Math.floor(paceSeconds / 60)
    let paceRemainderSeconds = Math.round(paceSeconds % 60)

    // Handle edge case where rounding gives 60 seconds
    if (paceRemainderSeconds === 60) {
      paceMinutes += 1
      paceRemainderSeconds = 0
    }

    return `${paceMinutes}:${String(paceRemainderSeconds).padStart(2, '0')}`
  }

  /**
   * Split a runner name into a comparable base and its generational suffix.
   *
   * Handles "John Smith", "Smith, John", "JOHN SMITH", accents ("José" is
   * "jose"), periods ("G. Peter" is "g peter") and generational suffixes in
   * every position results pages put them: "William COX IV", "John M. Bland,
   * Jr", "Bland Jr, John", "Cox, William IV". Sydney 2026 listed bib 22082 as
   * "William COX IV"; the order said "William Cox", and comparing last words
   * ("cox" with "iv") rejected the right runner.
   *
   * The suffix is kept apart rather than thrown away so that "William Cox Jr"
   * is never matched to "William Cox Sr": when both names carry a suffix and
   * they differ, they are different people (nameMatchTier checks this).
   *
   * A lone "V" after a first name in "Last, First V" form is read as a middle
   * initial, not "the fifth": that form puts the suffix after the surname.
   *
   * @param {string} name
   * @returns {{ base: string, suffix: string|null }}
   */
  parseRunnerName(name) {
    if (!name) return { base: '', suffix: null }

    let s = String(name).toLowerCase().trim()
    // Fold accents/diacritics so "José" matches "Jose", "Müller" matches
    // "Muller", etc. NFD splits an accented char into base + combining mark,
    // then we strip the combining marks (U+0300–U+036F).
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    s = s.replace(/\./g, ' ')

    let suffix = null
    const takeSuffix = token => {
      const canonical = GENERATIONAL_SUFFIXES.get(token)
      if (canonical && !suffix) suffix = canonical
      return Boolean(canonical)
    }
    const tokensOf = seg => seg.split(/\s+/).filter(Boolean)
    // Drop one trailing suffix token, keeping at least `keep` tokens.
    const dropTrailing = (tokens, keep, allowV = true) => {
      const last = tokens[tokens.length - 1]
      if (tokens.length > keep && (allowV || last !== 'v') && takeSuffix(last)) tokens.pop()
      return tokens
    }

    // A comma segment that is only a suffix ("..., Jr") is the suffix.
    let segments = s.split(',').map(tokensOf).filter(t => t.length > 0)
    if (segments.length > 1) segments = segments.filter(t => !(t.length === 1 && takeSuffix(t[0])))

    let tokens
    if (segments.length >= 2) {
      // "Last [Suffix], First [Middle] [Suffix]"
      const last = dropTrailing(segments[0], 1)
      const first = dropTrailing(segments.slice(1).flat(), 1, false)
      tokens = [...first, ...last]
    } else {
      // "First [Middle] Last [Suffix]": keep at least first + last.
      tokens = dropTrailing(segments[0] || [], 2)
    }

    return { base: tokens.join(' '), suffix }
  }

  /**
   * Normalize runner name for comparison (see parseRunnerName). Returns
   * "first [middle] last", lowercase, no accents, periods or generational
   * suffix.
   */
  normalizeName(name) {
    return this.parseRunnerName(name).base
  }

  /**
   * How strongly does a candidate name match the search query?
   *
   *   0 = STRONG. The first name matches outright (exact full string, or
   *       first+last exact ignoring middle names and generational suffixes,
   *       or the same words with a hyphen for a space: "Marks-Ball" and
   *       "Marks Ball").
   *   1 = WEAK. The last name matches exactly but the first name only matches
   *       as a SHORT FORM: either a curated nickname (Mike→Michael) or a
   *       plain prefix (Chris→Christopher, Chris→Christian). A sole weak
   *       match is still accepted by the scrapers, as before.
   *   2 = POSSIBLE. Probably the customer, but the names differ in a way only
   *       a person should accept. Never auto-accepted: a found result that
   *       rests on a tier-2 name is turned into a one-candidate confirmation
   *       (see _confirmPossibleNameMatch). Two shapes:
   *         a. Surname variant. First names agree (exactly or by nickname) and
   *            one surname is a run of consecutive words in the other, with
   *            hyphens read as word breaks: "Santiago Figueroa" and "Santiago
   *            Figueroa De Leon" (Des Moines 2026, bib 2116), "Jane Ball" and
   *            "Jane Marks-Ball". Whole words only, so "Ann Lee" never
   *            matches "Ann Leeds", and a run of particles alone ("de", "van")
   *            does not count.
   *         b. Middle name used as the first name. Same surname, one side's
   *            first token is an initial and the other's first name is one of
   *            its middle names: "Peter Maiers" and "G. Peter Maiers" (Chicago
   *            2003, bib 30212).
   *   null = no match. Different first names on the same surname ("Matt
   *       Murphy", "Paige Murphy") stay null, as do two different suffixes
   *       ("William Cox Jr", "William Cox Sr").
   *
   * The prefix rule is what stops a repeat of the London 2025 "Chris Baxter"
   * incident. That page listed both Christopher Baxter and Christian Baxter.
   * "chris"→"christopher" was in the nickname table, "chris"→"christian" was
   * not, so exactly one candidate survived the filter and the scraper
   * auto-accepted the wrong runner's finish time. A short first name that
   * prefixes a longer one is inherently ambiguous, and it is not the nickname
   * table's job to enumerate every long form; the ambiguity has to be visible
   * to the caller so a human can pick.
   *
   * Minimum 3 characters, so "Jo Smith" does not sweep in every Joseph,
   * Joanna and Jonathan in the field.
   *
   * @param {string} query - what the customer entered
   * @param {string} candidate - a name from the results page
   * @returns {0|1|2|null}
   */
  nameMatchTier(query, candidate) {
    const q = this.parseRunnerName(query)
    const c = this.parseRunnerName(candidate)
    const n1 = q.base
    const n2 = c.base
    if (!n1 || !n2) return null

    // "William Cox Jr" and "William Cox Sr" are father and son.
    if (q.suffix && c.suffix && q.suffix !== c.suffix) return null

    if (n1 === n2) return 0
    if (n1.replace(/-/g, ' ').replace(/\s+/g, ' ') === n2.replace(/-/g, ' ').replace(/\s+/g, ' ')) return 0

    const parts1 = n1.split(' ')
    const parts2 = n2.split(' ')
    if (parts1.length < 2 || parts2.length < 2) return null

    const first1 = parts1[0]
    const last1 = parts1[parts1.length - 1]
    const first2 = parts2[0]
    const last2 = parts2[parts2.length - 1]

    if (last1 === last2) {
      if (first1 === first2) return 0
      if (firstNamesEquivalent(first1, first2)) return 1
      if (first1.length >= 3 && first2.startsWith(first1)) return 1
      if (middleNameUsedAsFirst(parts1, parts2) || middleNameUsedAsFirst(parts2, parts1)) return 2
      return null
    }

    // Surnames differ as last words. Only a first-name agreement plus a
    // whole-word surname overlap makes this worth showing a person.
    const firstsAgree = first1 === first2 || firstNamesEquivalent(first1, first2)
    if (firstsAgree && surnameVariant(parts1.slice(1), parts2.slice(1))) return 2

    return null
  }

  /**
   * Check if two names match (fuzzy comparison).
   *
   * Kept as a boolean convenience over nameMatchTier. Prefer
   * filterNameMatches() when choosing among several candidates: this cannot
   * tell a confident match from an ambiguous short form.
   *
   * @param {string} name1 - the search query (what the customer entered)
   * @param {string} name2 - the candidate from the results page
   * @returns {boolean}
   */
  namesMatch(name1, name2) {
    return this.nameMatchTier(name1, name2) !== null
  }

  /**
   * Narrow a candidate list to the ones worth considering for a search query.
   *
   * Strong matches win outright: if the field contains a literal "Dan Smith"
   * then "Daniel Smith" is not a competing candidate and we should not make
   * the operator choose between them. Only when nothing matches strongly do
   * the short-form matches come back, and only when there are none of those
   * do the tier-2 "possible" matches (surname variant, middle name as first
   * name). If more than one survives, the caller's own "ambiguous" branch
   * fires and a human decides. If a single possible match survives and the
   * caller turns it into a found result, searchRunner's wrapper turns that
   * back into a one-candidate confirmation, so it is never auto-accepted.
   *
   * @param {string} query - what the customer entered
   * @param {Array} items - candidate rows from the results page
   * @param {(item: any) => string} nameOf - pulls the display name off a row
   * @returns {Array} the surviving candidates (possibly empty)
   */
  filterNameMatches(query, items, nameOf) {
    const byTier = [[], [], []]
    for (const item of items || []) {
      const tier = this.nameMatchTier(query, nameOf(item))
      if (tier !== null) byTier[tier].push(item)
    }
    const tier = byTier.findIndex(list => list.length > 0)
    if (tier === -1) return []

    const store = nameSearchContext.getStore()
    if (store) {
      store.bestTier = store.bestTier === null ? tier : Math.min(store.bestTier, tier)
      if (tier === 2) store.possibleNames.push(...byTier[2].map(nameOf))
    }
    return byTier[tier]
  }

  /**
   * Runs a subclass's searchRunner with a record of the name tiers its
   * filterNameMatches calls returned (installed by the constructor).
   */
  async _searchRunnerWithNameCheck(impl, args) {
    const store = { bestTier: null, possibleNames: [] }
    const result = await nameSearchContext.run(store, () => impl.apply(this, args))
    return this._confirmPossibleNameMatch(result, args[0], store)
  }

  /**
   * A found (or identity-only) result whose name is only a tier-2 match is
   * not accepted: it comes back as an ambiguous result with that one runner
   * as the candidate, so the picker shows it and a person confirms. Ambiguous
   * rather than not_found because ResearchService runs its surname-only
   * fallback on not_found, which would replace this one good candidate with a
   * list of everyone sharing the surname.
   */
  _confirmPossibleNameMatch(result, query, store) {
    if (!result || typeof result !== 'object') return result
    const accepted = result.found === true || result.researchStatus === 'time_unavailable'
    if (!accepted) return result

    const name = resultRunnerName(result)
    const tier = name ? this.nameMatchTier(query, name) : null
    // When the result does not carry a name we can read, fall back to what
    // the filter returned during this search.
    const possible = tier === 2 || (tier === null && store.bestTier === 2)
    if (!possible) return result

    const shownName = name || (store.possibleNames.length === 1 ? store.possibleNames[0] : null) || 'a runner'
    const bib = result.bibNumber ? String(result.bibNumber) : null
    const candidate = {
      name: shownName,
      bib,
      time: result.officialTime || null,
      pace: result.officialPace || null,
      eventType: result.eventType || null,
      resultsUrl: result.resultsUrl || null,
    }
    const out = this.ambiguousResult([candidate])
    out.nameMatch = 'possible'
    out.researchNotes = `Possible match for "${query}": ${shownName}${bib ? ` (bib ${bib})` : ''}. ` +
      'The names are close but not the same (a longer or hyphenated surname, or a middle name used as the first name), ' +
      'so confirm this is the customer before accepting.'
    return out
  }

  /**
   * Return standardized "not found" result.
   * @param {string} [reason] - Optional context (e.g. "Closest match: Bob Smith (3:10:42)")
   * @param {Array} [possibleMatches] - Optional list of candidate runners to surface
   *   to the dashboard so the user can pick one manually. Each entry should be
   *   `{ name, bib?, time?, pace?, city?, state?, eventType?, resultsUrl? }`.
   *   Use when the scraper found candidates that didn't pass namesMatch (e.g.
   *   last-name-only search → 50 Smiths to choose from).
   */
  notFoundResult(reason, possibleMatches) {
    return {
      found: false,
      bibNumber: null,
      officialTime: null,
      officialPace: null,
      eventType: null,
      yearFound: this.year,
      // 'not_found' = runner truly not in the results page
      researchStatus: 'not_found',
      researchNotes: reason || `Runner not found in ${this.raceName} ${this.year} results`,
      possibleMatches: Array.isArray(possibleMatches) && possibleMatches.length > 0
        ? possibleMatches
        : null
    }
  }

  /**
   * We know WHO ran, but not their time.
   *
   * The search page identified exactly one strong name match and handed us a
   * bib, then the per-runner detail page - the only place the finish time
   * lives - refused us. Sydney does this on every order: MultiSport Australia
   * fronts its result pages with a WAF that a headless browser does not clear.
   *
   * Reporting that as not_found or upstream_error throws away a confirmed
   * identity and sends the operator to a list of strangers who share a
   * surname. The identity is the hard part and we have it; the time is one
   * field to copy by hand.
   *
   * @param {string} name - the matched runner as the results page spells it
   * @param {string|null} bib - from the search row, the thing that proves identity
   * @param {string} reason - why the time is missing
   * @param {string|null} resultsUrl - this runner's own result page. We cannot
   *   read it, but a person in a real browser can, and it is where they have to
   *   go to copy the time. Handing it over saves them searching for it.
   */
  identityOnlyResult(name, bib, reason, resultsUrl = null) {
    return {
      found: false,
      bibNumber: bib ? String(bib) : null,
      officialTime: null,
      officialPace: null,
      eventType: this.config?.defaultEventType || null,
      yearFound: this.year,
      researchStatus: 'time_unavailable',
      researchNotes: `Matched ${name}${bib ? ` (bib ${bib})` : ''} in the ${this.raceName} ${this.year} results, but ${reason}.`,
      possibleMatches: null,
      resultsUrl: resultsUrl || null,
      rawData: { name, bib: bib || null }
    }
  }

  /**
   * Year exists in the scraper config space but no event/result IDs are wired
   * up for this specific year (typical case: race just happened and we haven't
   * added the new year yet). Distinct from "runner not found" — surfaces in the
   * dashboard as a config-needed alert, not a missing-runner.
   */
  yearNotConfiguredResult(extraNote) {
    const note = `${this.raceName} ${this.year} not configured yet - ` +
      `event/result IDs need to be added to the scraper config.` +
      (extraNote ? ` (${extraNote})` : '')
    return {
      found: false,
      bibNumber: null,
      officialTime: null,
      officialPace: null,
      eventType: null,
      yearFound: this.year,
      researchStatus: 'year_not_configured',
      researchNotes: note
    }
  }

  /**
   * Upstream timing site is unreachable / returning 5xx / taking too long.
   * Distinct from "runner not found" — surfaces in the dashboard as a
   * transient infrastructure issue, not a missing-runner. Suggests "try
   * again in a few minutes" rather than "check the spelling".
   */
  upstreamErrorResult(detail) {
    return {
      found: false,
      bibNumber: null,
      officialTime: null,
      officialPace: null,
      eventType: null,
      yearFound: this.year,
      researchStatus: 'upstream_error',
      researchNotes: `${this.raceName} ${this.year} timing site is unreachable or slow${detail ? ` (${detail})` : ''}. Try again in a few minutes.`
    }
  }

  /**
   * Return standardized "ambiguous" result (multiple matches)
   */
  ambiguousResult(matches) {
    const list = Array.isArray(matches) ? matches : []
    return {
      found: false,
      ambiguous: true,
      matches: list,
      // ResearchService persists `possibleMatches`, not `matches`, and that is
      // what the dashboard reads to render the picker. Populating only
      // `matches` produced an order flagged ambiguous with no candidates
      // attached — the operator was told to choose but shown nothing to
      // choose between. Both are set so either reader works.
      possibleMatches: list.length > 0 ? list : null,
      bibNumber: null,
      officialTime: null,
      officialPace: null,
      eventType: null,
      yearFound: this.year,
      researchStatus: 'ambiguous',
      researchNotes: list.length > 0
        ? `Multiple matches found: ${list.map(m => m.name).filter(Boolean).join(', ')} - please pick the right runner`
        : 'Multiple matches found - please pick the right runner'
    }
  }
}

export default BaseScraper
