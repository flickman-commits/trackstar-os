/**
 * RTRT Platform Scraper
 * Consolidates all races using the RTRT tracker API (api.rtrt.me)
 * Currently: Marine Corps Marathon
 */
import { BaseScraper } from '../BaseScraper.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Shared RTRT web-tracker credentials.
 *
 * These are NOT per race. RTRT addresses a race by its event id (IL-2026,
 * MCM-2025); the appid/token pair only identifies the public web tracker
 * client, and one pair works across every event. Verified against Illinois
 * 2025/2026 and Marine Corps 2025 with the same values.
 *
 * They lived in each race config before, which is how they rotted: races
 * accumulated mismatched pairs (Illinois carried its own appId against the
 * Marine Corps token, which RTRT rejects because the pair must match), and a
 * pair that expired had to be fixed in as many places as it was copied. One
 * definition means one place to re-pull.
 *
 * TO RE-PULL when these expire: open https://app.rtrt.me/<EVENT-ID> directly
 * (not track.rtrt.me, which frames it cross-origin) and read appid and token
 * off any api.rtrt.me request in performance.getEntriesByType('resource').
 * The token is a device uuid the tracker mints on load.
 *
 * A config may still override via appId/appToken if a race ever needs its own.
 */
const WEBTRACKER_APP_ID = '52139b797871851e0800638e'
const WEBTRACKER_TOKEN  = '43AEB9E2E4D44BF7145A'

/**
 * RTRT reports failures as HTTP 200 with an {error:{type,msg}} body.
 *
 * That has to be unpacked explicitly, because the obvious reading of a
 * response — status is ok, `list` is missing, therefore zero results — turns
 * every outage, expired credential and bad event id into "runner not found".
 * That failure is invisible in exactly the way that matters: the shopper is
 * told their result does not exist, the dashboard logs not_found rather than
 * upstream_error, and no alert fires. Expired tokens sat undetected across
 * every RTRT race until someone checked by hand.
 *
 * Throwing instead routes these through the normal upstream-error path, which
 * is alerted on and visibly distinct from a genuine miss.
 *
 * @param {any} data Parsed JSON body
 * @param {string} tag Race tag, for the message
 * @param {string} what Which call failed, for the message
 */
function assertNoRtrtError(data, tag, what) {
  const err = data && data.error
  if (!err) return
  const type = err.type || 'unknown'
  const msg = err.msg || JSON.stringify(err)
  // Credential problems are the ones worth naming outright: they are silent,
  // permanent until someone re-pulls a token, and not self-healing.
  const hint = type === 'not_authorized'
    ? ' (appId/appToken pair is invalid or expired for this event - re-pull them from the tracker)'
    : ''
  const error = new Error(`RTRT ${what} failed for ${tag}: ${type} - ${msg}${hint}`)
  error.rtrtType = type
  throw error
}

export class RTRTScraper extends BaseScraper {
  /**
   * @param {number} year
   * @param {Object} config
   * @param {string} config.raceName
   * @param {string} config.location
   * @param {string} config.eventPrefix - e.g. 'MCM'
   * @param {string} config.appId
   * @param {string} config.appToken
   * @param {number} config.distanceMiles - for pace calculation (default 26.2)
   * @param {Function} [config.buildEventId] - optional custom event ID builder
   */
  constructor(year, config) {
    super(config.raceName, year)
    this.config = config
    this.baseUrl = 'https://api.rtrt.me'
    this.tag = config.tag || config.raceName

    // Build event ID dynamically (fixes the MCM-2025 hardcoding bug)
    this.eventId = config.buildEventId
      ? config.buildEventId(year)
      : `${config.eventPrefix}-${year}`

    this.appId = config.appId || WEBTRACKER_APP_ID
    this.token = config.appToken || WEBTRACKER_TOKEN
  }

  async getRaceInfo() {
    console.log(`[${this.tag} ${this.year}] Fetching race info...`)

    const raceDate = this.resolveRaceDate()
    console.log(`[${this.tag} ${this.year}] Approximate race date: ${raceDate ? raceDate.toDateString() : 'unknown'}`)

    return {
      raceDate,
      location: this.config.location,
      eventTypes: this.config.eventTypes || ['Marathon'],
      resultsUrl: `https://track.rtrt.me/e/${this.eventId}#/dashboard`,
      resultsSiteType: 'rtrt'
    }
  }

  /**
   * Does this race run more than one event on the weekend? Only then is there
   * anything to disambiguate — a single-distance race should keep the label
   * its config declares (Marine Corps 17.75K calls itself "17.75K", and no
   * amount of parsing a timing point improves on that).
   */
  get _isMultiEvent() {
    return (this.config.eventSearchOrder?.length || 0) > 1
      || Object.keys(this.config.courseMap || {}).length > 1
  }

  /**
   * Parse one distance token into a label and a length in miles.
   * Understands the vocabulary RTRT uses in both `course` values ("halfmarathon",
   * "5k", "1mile") and timing-point names ("HM", "MAR", "5K", "1M").
   *
   * @returns {{label: string, miles: number}|null} null when unrecognized.
   */
  _parseDistanceToken(token) {
    const t = String(token || '').trim().toLowerCase().replace(/[\s_-]/g, '')
    if (!t) return null
    if (/^(full)?marathon$|^mar$|^m$/.test(t)) {
      return { label: this.config.eventLabels?.marathon || 'Marathon', miles: 26.2 }
    }
    if (/^half(marathon)?$|^hm$/.test(t)) {
      return { label: this.config.eventLabels?.half || 'Half Marathon', miles: 13.1 }
    }
    const k = t.match(/^(\d+(?:\.\d+)?)k$/)
    if (k) return { label: `${k[1]}K`, miles: parseFloat(k[1]) * 0.621371 }
    const mi = t.match(/^(\d+(?:\.\d+)?)mi(?:le[rs]?)?$/) || t.match(/^(\d+(?:\.\d+)?)m$/)
    if (mi) {
      const n = parseFloat(mi[1])
      return { label: n === 1 ? '1 Mile' : `${n} Mile`, miles: n }
    }
    return null
  }

  /** Distances (miles) this race sells prints for. */
  _soldMiles() {
    const miles = Object.values(this.config.distances || {})
    if (this.config.distanceMiles) miles.push(this.config.distanceMiles)
    return miles
  }

  /** True when every course token parses to a distance, and none is sold. */
  _ranOnlyUnsoldDistances(course, soldMiles) {
    const tokens = String(course || '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean)
    if (!tokens.length) return false
    const parsed = tokens.map(t => this._parseDistanceToken(t))
    if (parsed.some(d => !d)) return false
    return !parsed.some(d => soldMiles.some(m => Math.abs(m - d.miles) < 0.2))
  }

  /**
   * Human label for a profile's `course` field.
   *
   * RTRT reports every event a runner is registered for as a comma list
   * ("5k", "1mile,5k,10k", "5k,halfmarathon"). A configured event wins, since
   * that is what this race sells posters for; otherwise we name the longest
   * distance rather than silently calling a 5K a marathon.
   */
  _labelForCourse(course) {
    const fallback = this.config.defaultEventType || 'Marathon'
    if (!course) return fallback

    const tokens = String(course).toLowerCase().split(',').map(t => t.trim()).filter(Boolean)
    if (!tokens.length) return fallback

    for (const key of (this.config.eventSearchOrder || [])) {
      const id = (this.config.courseMap?.[key] || '').toLowerCase()
      if (id && tokens.includes(id)) return this.config.eventLabels?.[key] || fallback
    }

    let best = null
    for (const t of tokens) {
      const parsed = this._parseDistanceToken(t)
      if (parsed && (!best || parsed.miles > best.miles)) best = parsed
    }
    return best ? best.label : fallback
  }

  /**
   * Which event does a finish split belong to? RTRT names the timing point
   * after the course ("FINISH-5K", "FINISH-HM", "FINISH-MAR", "FINISH-1M").
   *
   * This is the ONLY authoritative source for what a runner actually ran.
   * `course` on the profile lists everything they REGISTERED for, so a
   * 5K-plus-half entrant reports both and the poster ends up captioned with
   * the wrong distance next to a time from the other race.
   *
   * Order matters: HM has to be tested before the bare-M marathon pattern.
   */
  _labelForFinishPoint(point) {
    // Only the suffix carries the course: "FINISH-5K" -> "5K". A bare "FINISH"
    // says nothing, and neither does a race that only runs one distance.
    if (!this._isMultiEvent) return null
    const suffix = String(point || '').toUpperCase().match(/^FINISH[-_\s]+(.+)$/)
    return suffix ? this._parseDistanceToken(suffix[1]) : null
  }

  /**
   * Turn a profile id into a finish time, pace, and the event actually run.
   * The profile search payload carries none of them, so this second call is
   * the only way to get them.
   *
   * @returns {Promise<{time: string|null, pace: string|null, label: string|null}>}
   *   nulls when the runner has no finish split, or the call failed — never
   *   throws, because a missing time must not take down a lookup that
   *   otherwise succeeded.
   */
  async _resolveFinish(pid, distanceMiles) {
    const EMPTY = { time: null, pace: null, label: null }
    if (!pid) return EMPTY
    try {
      const splits = await this._fetchSplits(pid)
      const finishSplit = splits.find(s =>
        s.isFinish === '1' || (s.point || '').toUpperCase().includes('FINISH')
      )
      if (!finishSplit) return EMPTY

      // Pace the time against the distance actually finished, not the race's
      // headline distance, or a 5K gets a marathon's pace math.
      const actual = this._labelForFinishPoint(finishSplit.point)
      const miles = actual?.miles || distanceMiles

      // RTRT's tracker rounds the fraction to the nearest second (MCM 2026:
      // 04:35:30.654 shows 4:35:31, 05:34:55.963 shows 5:34:56). Cutting it
      // was tried on 2026-10-27 and printed 23 MCM orders a second low.
      const rawTime = finishSplit.netTime || finishSplit.time
      const cleanTime = rawTime ? this.roundTime(rawTime) : null
      const time = this.formatTime(cleanTime ? this.normalizeTime(cleanTime) : null)

      // RTRT's paceAvg is the overall average (chip time / distance; checked
      // on positive-split runners in MCM 2023/2025 and Illinois 2025/2026),
      // computed from the unrounded time, so it is kept over recomputing from
      // the rounded one (which drifts a second, e.g. 11:54 vs the page's 11:53).
      // It arrives zero-padded ("08:34 min/mile"); strip the pad so it reads
      // like every other platform's pace.
      const rawPace = finishSplit.paceAvg?.replace(/\s*min\/mile$/i, '').replace(/^0(\d:)/, '$1') || null
      const pace = rawPace || this.formatPace(
        cleanTime ? this.calculatePace(this.normalizeTime(cleanTime), miles) : null
      )
      return { time, pace, label: actual?.label || null, miles: actual?.miles || null }
    } catch (err) {
      console.log(`[${this.tag}] Could not fetch splits for ${pid}: ${err.message}`)
      return EMPTY
    }
  }

  async searchRunner(runnerName) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${this.tag} ${this.year}] Searching for: "${runnerName}"`)
    console.log(`${'='.repeat(50)}`)

    try {
      const searchResults = await this._searchProfiles(runnerName)

      if (!searchResults.length) {
        console.log(`[${this.tag}] No profiles returned for search "${runnerName}"`)
        return this.notFoundResult()
      }

      console.log(`[${this.tag}] Received ${searchResults.length} profiles from API`)
      searchResults.slice(0, 5).forEach((p, idx) => {
        console.log(`  ${idx + 1}. ${p.name || `${p.fname} ${p.lname}`} - Bib: ${p.bib || 'N/A'}`)
      })

      let matches = this.filterNameMatches(runnerName, searchResults,
        p => p.name || `${p.fname || ''} ${p.lname || ''}`.trim())

      console.log(`[${this.tag}] Exact matches after filtering: ${matches.length}`)

      if (matches.length === 0) {
        console.log(`[${this.tag}] No name match. Surfacing ${Math.min(searchResults.length, 10)} candidates.`)
        // No `time` on these: RTRT's profile search returns roster rows only
        // (name, bib, pid, course) and the finish lives behind a per-runner
        // splits call we are not going to make ten times. Consumers must treat
        // a missing time here as "not looked up", never as "did not finish" —
        // the storefront wizard re-runs the lookup on the row the shopper
        // picks, which goes down the matched path below and resolves it.
        return this.notFoundResult(null, searchResults.slice(0, 10).map(p => ({
          name: p.name || `${p.fname || ''} ${p.lname || ''}`.trim(),
          bib: p.bib,
          // The row states which course they actually ran. Stamping every
          // candidate with the race's default said "Marathon" next to 5K and
          // 1-mile entrants on Illinois 2026.
          eventType: this._labelForCourse(p.course),
          // Lets the fulfillment dashboard resolve a pick without re-searching.
          pid: p.pid || null,
        })))
      }

      // Drop entrants who only ran distances this race does not sell. Without
      // this a Marine Corps 10K finisher came back as a 1:42 "Marathon".
      // Only for configs that declare their courses, and only when every
      // course token is a distance we recognise; anything unfamiliar stays.
      if (this.config.courseMap) {
        const sold = this._soldMiles()
        const kept = matches.filter(p => !this._ranOnlyUnsoldDistances(p.course, sold))
        if (kept.length === 0) {
          console.log(`[${this.tag}] Name matched, but only in events this race does not sell`)
          return this.notFoundResult(null, matches.slice(0, 10).map(p => ({
            name: p.name || `${p.fname || ''} ${p.lname || ''}`.trim(),
            bib: p.bib,
            eventType: this._labelForCourse(p.course),
            pid: p.pid || null,
          })))
        }
        matches = kept
      }

      // For multi-course events (e.g. marathon + half at same race), each
      // entrant's event comes from their `course` field: the first course in
      // eventSearchOrder they are registered for.
      const defaultEvent = {
        key: null,
        eventType: this.config.defaultEventType || 'Marathon',
        distance: this.config.distanceMiles || 26.2,
      }
      const eventFor = (p) => {
        if (!this.config.courseMap || !this.config.eventSearchOrder) return defaultEvent
        // `course` is a comma list for anyone registered in more than one
        // event ("5k,halfmarathon"), so an equality test missed them and
        // silently fell through to the race's default distance.
        const courses = String(p.course || '').toLowerCase().split(',').map(t => t.trim())
        for (const eventKey of this.config.eventSearchOrder) {
          const courseId = (this.config.courseMap[eventKey] || '').toLowerCase()
          if (courseId && courses.includes(courseId)) {
            return {
              key: eventKey,
              eventType: this.config.eventLabels?.[eventKey] || eventKey,
              distance: this.config.distances?.[eventKey] || defaultEvent.distance,
            }
          }
        }
        return defaultEvent
      }
      // When some entrants are in a mapped course, the ones in none of them
      // (a course token the config does not map) stay out, as they did when
      // the first course with a hit decided.
      if (matches.some(p => eventFor(p).key)) matches = matches.filter(p => eventFor(p).key)
      const order = this.config.eventSearchOrder || []
      matches.sort((a, b) => order.indexOf(eventFor(a).key) - order.indexOf(eventFor(b).key))

      // The same bib twice is one person (a bib-less profile falls back to
      // its pid). Several bibs are different people sharing the name, and
      // which course they ran never settles it: Denver Colfax 2026 had a
      // Diego Garcia in the half and two in the marathon, and the half one
      // was printed for a marathon customer. A person picks.
      const people = new Map()
      for (const p of matches) {
        const bib = String(p.bib ?? '').trim()
        const key = bib ? `bib ${bib}` : `pid ${p.pid}`
        if (!people.has(key)) people.set(key, p)
      }
      matches = [...people.values()]

      if (matches.length > 1) {
        // Same name, several entrants. This list is what the shopper picks
        // from, so it has to carry real times — `time: null` here used to make
        // every one of them look like a DNF. There are only ever a handful of
        // exact-name collisions, so resolving them in parallel is cheap.
        const resolved = await Promise.all(matches.map(async m => {
          const { time, pace, label } = await this._resolveFinish(m.pid, eventFor(m).distance)
          return {
            name: m.name || `${m.fname || ''} ${m.lname || ''}`.trim(),
            bib: m.bib || null,
            time,
            pace,
            eventType: label || this._labelForCourse(m.course),
            pid: m.pid || null,
          }
        }))
        return this.ambiguousResult(resolved)
      }

      const resolvedEvent = eventFor(matches[0])
      let resolvedEventType = resolvedEvent.eventType
      const resolvedDistance = resolvedEvent.distance
      if (resolvedEvent.key) console.log(`[${this.tag}] Resolved to event: ${resolvedEventType}`)
      else if (this.config.courseMap && this.config.eventSearchOrder) console.log(`[${this.tag}] No matches in any configured course`)

      const profile = matches[0]
      const fullName = profile.name || `${profile.fname || ''} ${profile.lname || ''}`.trim()
      const pid = profile.pid

      const { time, pace, label } = await this._resolveFinish(pid, resolvedDistance)
      // The finish split names the course they actually crossed. It overrides
      // the registration-derived guess above, which is wrong for anyone signed
      // up for more than one event that weekend.
      if (label && label !== resolvedEventType) {
        console.log(`[${this.tag}] Finish split says ${label}, not ${resolvedEventType} - trusting the split`)
        resolvedEventType = label
      }

      console.log(`\n[${this.tag}] FOUND RUNNER:`)
      console.log(`  Name: ${fullName}`)
      console.log(`  Bib: ${profile.bib || 'N/A'}`)
      console.log(`  PID: ${pid || 'N/A'}`)
      console.log(`  Event: ${resolvedEventType}`)
      if (time) {
        console.log(`  Time: ${time}`)
        console.log(`  Pace: ${pace}`)
      }

      const resultsUrl = pid
        ? `https://track.rtrt.me/e/${this.eventId}#/tracker/${pid}`
        : `https://track.rtrt.me/e/${this.eventId}#/dashboard`

      return {
        found: true,
        bibNumber: profile.bib ? String(profile.bib) : null,
        officialTime: time,
        officialPace: pace,
        eventType: resolvedEventType,
        yearFound: this.year,
        researchNotes: null,
        resultsUrl,
        rawData: profile
      }
    } catch (error) {
      // RTRT answers no_roster until the tracker is loaded for an event, which
      // is every search before race day. That is not an outage: telling a
      // shopper the site is down and to try again later was wrong, and it
      // logged every pre-race lookup as a failure. Only before the race; an
      // empty roster after it is a real problem and stays an error.
      if (error.rtrtType === 'no_roster' && this._raceNotRunYet()) {
        console.log(`[${this.tag}] No roster yet; ${this.year} has not been run`)
        return this.notFoundResult(`${this.raceName} ${this.year} has not been run yet; results are posted after race day`)
      }
      // A year the config never listed, which RTRT also does not host ("Invalid
      // Event Name:MCM-1989"), is a coverage gap, not an outage: say so rather
      // than tell the queue to retry forever. A LISTED year with an invalid id
      // is a broken config and still falls through to upstream_error below.
      if (error.rtrtType === 'failed' && /invalid event name/i.test(error.message)
        && this.config.raceDates && !(this.year in this.config.raceDates)) {
        return this.yearNotConfiguredResult(`RTRT has no event ${this.eventId}`)
      }
      console.error(`[${this.tag}] Error searching for ${runnerName}:`, error.message)
      // An exception here means the lookup could not be completed — network,
      // auth, or a malformed response. It does NOT mean the runner is absent;
      // a genuine miss returns notFoundResult() from the path above. Reporting
      // it as not_found told shoppers their result did not exist and kept the
      // outcome out of the upstream_error bucket that gets alerted on.
      return this.upstreamErrorResult(error.message)
    }
  }

  /**
   * Bib lookup. RTRT's profile search matches the `search` string against the
   * bib as well as the name (IL-2026 "17006" returns exactly bib 17006), so
   * this is the same profiles call with the bib as the query, keeping only
   * rows whose bib is exactly the one searched. Event resolution, the
   * unsold-distance filter and the finish split are the same as searchRunner.
   */
  async searchRunnerByBib(bib) {
    const wanted = String(bib ?? '').trim()
    if (!wanted) return null
    console.log(`[${this.tag} ${this.year}] Bib lookup: ${wanted}`)
    try {
      const rows = await this._searchProfilesOnce(wanted)
      const hits = rows.filter(p => this.bibsEqual(p.bib, wanted))
      if (!hits.length) return this.notFoundResult(`No bib ${wanted} in ${this.raceName} ${this.year} results`)

      let profile = hits[0]
      let resolvedEventType = this.config.defaultEventType || 'Marathon'
      let resolvedDistance = this.config.distanceMiles || 26.2
      if (this.config.courseMap) {
        const sold = this._soldMiles()
        const kept = hits.filter(p => !this._ranOnlyUnsoldDistances(p.course, sold))
        if (!kept.length) {
          return this.notFoundResult(`Bib ${wanted} is entered in ${this._labelForCourse(hits[0].course)}, which this race does not sell`)
        }
        profile = kept[0]
        for (const key of (this.config.eventSearchOrder || [])) {
          const courseId = (this.config.courseMap[key] || '').toLowerCase()
          if (courseId && String(profile.course || '').toLowerCase().split(',').map(t => t.trim()).includes(courseId)) {
            resolvedEventType = this.config.eventLabels?.[key] || key
            resolvedDistance = this.config.distances?.[key] || resolvedDistance
            break
          }
        }
      }

      const { time, pace, label, miles: finishMiles } = await this._resolveFinish(profile.pid, resolvedDistance)
      if (label && label !== resolvedEventType) resolvedEventType = label
      // The finish split is what they actually ran: a half registrant who
      // crossed the 5K finish is still a 5K, and that print is not sold.
      const sold = this._soldMiles()
      if (finishMiles && sold.length && !sold.some(m => Math.abs(m - finishMiles) < 0.2)) {
        return this.notFoundResult(`Bib ${wanted} finished the ${label}, which this race does not sell`)
      }

      const fullName = profile.name || `${profile.fname || ''} ${profile.lname || ''}`.trim()
      console.log(`[${this.tag}] BIB MATCH: ${fullName} bib ${profile.bib} ${resolvedEventType} ${time || 'no time'}`)
      return {
        found: true,
        runnerName: fullName,
        bibNumber: String(profile.bib).trim(),
        officialTime: time,
        officialPace: pace,
        eventType: resolvedEventType,
        yearFound: this.year,
        researchNotes: null,
        resultsUrl: profile.pid
          ? `https://track.rtrt.me/e/${this.eventId}#/tracker/${profile.pid}`
          : `https://track.rtrt.me/e/${this.eventId}#/dashboard`,
        rawData: profile
      }
    } catch (error) {
      if (error.rtrtType === 'no_roster' && this._raceNotRunYet()) {
        return this.notFoundResult(`${this.raceName} ${this.year} has not been run yet; results are posted after race day`)
      }
      console.error(`[${this.tag}] Bib lookup error for ${wanted}:`, error.message)
      return this.upstreamErrorResult(error.message)
    }
  }

  /** True until the end of race day, by the configured date. */
  _raceNotRunYet(now = new Date()) {
    const raceDate = this.resolveRaceDate()
    if (!raceDate) return false
    const endOfRaceDay = new Date(raceDate.getFullYear(), raceDate.getMonth(), raceDate.getDate() + 1)
    return now < endOfRaceDay
  }

  /**
   * Search, tolerating how RTRT matches names.
   *
   * RTRT matches the whole search string against the entered name, so the
   * nickname a shopper types never finds the registered form: "Jake Deyton"
   * is no_results on MCM-2025 where "Deyton" returns Jacob Deyton, and
   * "Timothy Goodsell" misses Tim Goodsell on MCM-2023. When the full name
   * finds nobody, retry on the surname alone and let filterNameMatches (with
   * its nickname table) decide; a surname too common to list (too_many_results)
   * is left as a miss rather than guessed at.
   */
  async _searchProfiles(runnerName) {
    const full = await this._searchProfilesOnce(runnerName)
    if (full.length) return full
    const parts = String(runnerName || '').trim().split(/\s+/)
    if (parts.length < 2) return full
    const surname = parts[parts.length - 1]
    console.log(`[${this.tag}] No hit on full name; retrying on surname "${surname}"`)
    try {
      return await this._searchProfilesOnce(surname)
    } catch (err) {
      if (err.rtrtType === 'too_many_results') return []
      throw err
    }
  }

  /**
   * Confirm the event id itself is real, once per scraper instance.
   *
   * no_results only means "nobody by that name" when the event exists; an
   * invalid id answers type "failed" ("Invalid Event Name") and a bad
   * credential "not_authorized", both of which still throw and stay
   * upstream_error so a broken config is loud. This check is the belt to that
   * braces: a no_results is only downgraded to not_found after the event
   * record itself has loaded.
   */
  async _assertEventResolves() {
    if (this._eventVerified) return
    const response = await fetchWithTimeout(`${this.baseUrl}/events/${this.eventId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: new URLSearchParams({ appid: this.appId, token: this.token, source: 'webtracker' }).toString()
    })
    if (!response.ok) throw new Error(`RTRT event lookup error ${response.status} for ${this.eventId}`)
    const data = await response.json()
    assertNoRtrtError(data, this.tag, 'event lookup')
    if (data?.name !== this.eventId) {
      throw new Error(`RTRT event lookup for ${this.eventId} returned ${data?.name || 'no event'}`)
    }
    this._eventVerified = true
  }

  async _searchProfilesOnce(runnerName) {
    const url = `${this.baseUrl}/events/${this.eventId}/profiles`

    const form = new URLSearchParams({
      max: '100',
      total: '1',
      failonmax: '1',
      appid: this.appId,
      token: this.token,
      search: runnerName,
      module: '0',
      source: 'webtracker'
    })

    console.log(`[${this.tag}] POST ${url}`)

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT
      },
      body: form.toString()
    })

    console.log(`[${this.tag}] Response status: ${response.status}`)

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`RTRT profiles error ${response.status}: ${text.slice(0, 300)}`)
    }

    const data = await response.json()
    // HTTP 200 + no_results is RTRT's answer for "nobody by that name". On a
    // valid event that is a genuine miss (not_found), not an outage; it used
    // to throw and park orders in the "Timing site down" queue forever. Only
    // after the event itself resolves, so a wrong id can never hide here.
    if (data?.error?.type === 'no_results') {
      await this._assertEventResolves()
      return []
    }
    assertNoRtrtError(data, this.tag, 'profile search')
    return Array.isArray(data.list) ? data.list : []
  }

  async _fetchSplits(pid) {
    const url = `${this.baseUrl}/events/${this.eventId}/profiles/${pid}/splits`

    // RTRT default caps splits at 20 items, which truncates before FINISH-M
    // on races with many timing points (Jersey City has 22). Request more
    // so the finish split is always included.
    const form = new URLSearchParams({
      appid: this.appId,
      token: this.token,
      source: 'webtracker',
      max: '100'
    })

    console.log(`[${this.tag}] Fetching splits for PID ${pid}`)

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT
      },
      body: form.toString()
    })

    if (!response.ok) throw new Error(`RTRT splits error ${response.status}`)

    const data = await response.json()
    assertNoRtrtError(data, this.tag, 'splits fetch')
    return Array.isArray(data.list) ? data.list : []
  }
}

export default RTRTScraper
