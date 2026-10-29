/**
 * Scraper Factory
 * Auto-builds the scraper registry from config files.
 * To add a new race, just add a config file in configs/ — no other changes needed.
 */

// --- Platform scraper classes ---
import { RunSignUpScraper } from './platforms/RunSignUpScraper.js'
import { MyChipTimeScraper } from './platforms/MyChipTimeScraper.js'
import { RTRTScraper } from './platforms/RTRTScraper.js'
import { NYRRScraper } from './platforms/NYRRScraper.js'
import { MyRaceAiScraper } from './platforms/MyRaceAiScraper.js'
import { MikaTimingScraper } from './platforms/MikaTimingScraper.js'
import { RaceRosterScraper } from './platforms/RaceRosterScraper.js'
import { XacteScraper } from './platforms/XacteScraper.js'
import { ScoreThisScraper } from './platforms/ScoreThisScraper.js'
import { BrookseeScraper } from './platforms/BrookseeScraper.js'
import { TokyoMarathonScraper } from './platforms/TokyoMarathonScraper.js'
import { MultiSportAustraliaScraper } from './platforms/MultiSportAustraliaScraper.js'
import { AthlinksScraper } from './platforms/AthlinksScraper.js'
import { ChronoTrackScraper } from './platforms/ChronoTrackScraper.js'
import { MTECResultsScraper } from './platforms/MTECResultsScraper.js'
import { LaurelTimingScraper } from './platforms/LaurelTimingScraper.js'
import { CompetitiveTimingScraper } from './platforms/CompetitiveTimingScraper.js'
import { SVETimingScraper } from './platforms/SVETimingScraper.js'
import { SportstatsScraper } from './platforms/SportstatsScraper.js'
import { RaceResultScraper } from './platforms/RaceResultScraper.js'
import { TrueTimeScraper } from './platforms/TrueTimeScraper.js'
import { UltraSignupScraper } from './platforms/UltraSignupScraper.js'
import { HuberTimingScraper } from './platforms/HuberTimingScraper.js'

// --- Race configs ---
import kiawahIslandConfig from './configs/kiawahIsland.js'
import louisianaConfig from './configs/louisiana.js'
import austinConfig from './configs/austin.js'
import philadelphiaConfig from './configs/philadelphia.js'
import marinecorpsConfig from './configs/marinecorps.js'
import nycConfig from './configs/nyc.js'
import cimConfig from './configs/cim.js'
import chicagoConfig from './configs/chicago.js'
import twinCitiesConfig from './configs/twinCities.js'
import losAngelesConfig from './configs/losAngeles.js'
import buffaloConfig from './configs/buffalo.js'
import oaklandConfig from './configs/oakland.js'
import marinecorps1775kConfig from './configs/marinecorps1775k.js'
import marinecorpsHistoricHalfConfig from './configs/marinecorpsHistoricHalf.js'
import cowtownConfig from './configs/cowtown.js'
import mesaConfig from './configs/mesa.js'
import londonConfig from './configs/london.js'
import eugeneConfig from './configs/eugene.js'
import jerseyCityConfig from './configs/jerseyCity.js'
import berlinConfig from './configs/berlin.js'
import tokyoConfig from './configs/tokyo.js'
import sydneyConfig from './configs/sydney.js'
import pittsburghConfig from './configs/pittsburgh.js'
import orangeCountyConfig from './configs/orangeCounty.js'
import houstonConfig from './configs/houston.js'
import bostonConfig from './configs/boston.js'
import illinoisConfig from './configs/illinois.js'
import denverColfaxConfig from './configs/denverColfax.js'
import vermontCityConfig from './configs/vermontCity.js'
import fortLauderdaleConfig from './configs/fortLauderdale.js'
import indianapolisMonumentalConfig from './configs/indianapolisMonumental.js'
import jacksonHoleConfig from './configs/jacksonHole.js'
import miamiConfig from './configs/miami.js'
import sanFranciscoConfig from './configs/sanFrancisco.js'
import airForceConfig from './configs/airForce.js'
import armyTenMilerConfig from './configs/armyTenMiler.js'
import surfCityConfig from './configs/surfCity.js'
import dallasConfig from './configs/dallas.js'
import detroitConfig from './configs/detroit.js'
import baltimoreConfig from './configs/baltimore.js'
import memphisConfig from './configs/memphis.js'
import grandmasConfig from './configs/grandmas.js'
import columbusConfig from './configs/columbus.js'
import stGeorgeConfig from './configs/stGeorge.js'
import portlandConfig from './configs/portland.js'
import missoulaConfig from './configs/missoula.js'
import newportConfig from './configs/newport.js'
import honoluluConfig from './configs/honolulu.js'
import bayshoreConfig from './configs/bayshore.js'
import sanAntonioConfig from './configs/sanAntonio.js'
import bigSurConfig from './configs/bigSur.js'
import annArborConfig from './configs/annArbor.js'
import charlotteConfig from './configs/charlotte.js'
import binationalConfig from './configs/binational.js'
import northshoreConfig from './configs/northshore.js'
import santaBarbaraConfig from './configs/santaBarbara.js'
import behindTheRocksConfig from './configs/behindTheRocks.js'
import gulfCoastConfig from './configs/gulfCoast.js'
import lasVegasConfig from './configs/lasVegas.js'
import bangorConfig from './configs/bangor.js'
import brooklynHalfConfig from './configs/brooklynHalf.js'
import capitalCityConfig from './configs/capitalCity.js'
import carmelConfig from './configs/carmel.js'
import coastGuardConfig from './configs/coastGuard.js'
import atlanticCityConfig from './configs/atlanticCity.js'
import desMoinesConfig from './configs/desMoines.js'
import coloradoSpringsConfig from './configs/coloradoSprings.js'
import humboldtRedwoodsConfig from './configs/humboldtRedwoods.js'
import { normalizeRaceName } from './raceNameNormalization.js'
import { applyOverride } from './scraperOverrides.js'

/**
 * Map platform identifier -> platform scraper class
 */
const PLATFORM_MAP = {
  runsignup: RunSignUpScraper,
  mychiptime: MyChipTimeScraper,
  rtrt: RTRTScraper,
  nyrr: NYRRScraper,
  myrace: MyRaceAiScraper,
  mika: MikaTimingScraper,
  raceroster: RaceRosterScraper,
  xacte: XacteScraper,
  scorethis: ScoreThisScraper,
  brooksee: BrookseeScraper,
  tokyo: TokyoMarathonScraper,
  'multisport-australia': MultiSportAustraliaScraper,
  athlinks: AthlinksScraper,
  chronotrack: ChronoTrackScraper,
  mtec: MTECResultsScraper,
  laurel: LaurelTimingScraper,
  competitivetiming: CompetitiveTimingScraper,
  svetiming: SVETimingScraper,
  sportstats: SportstatsScraper,
  raceresult: RaceResultScraper,
  truetime: TrueTimeScraper,
  ultrasignup: UltraSignupScraper,
  hubertiming: HuberTimingScraper,
}

/**
 * All race configs. To add a new race, import the config and add it here.
 */
const ALL_CONFIGS = [
  kiawahIslandConfig,
  louisianaConfig,
  austinConfig,
  philadelphiaConfig,
  marinecorpsConfig,
  nycConfig,
  cimConfig,
  chicagoConfig,
  twinCitiesConfig,
  losAngelesConfig,
  buffaloConfig,
  oaklandConfig,
  marinecorps1775kConfig,
  marinecorpsHistoricHalfConfig,
  cowtownConfig,
  mesaConfig,
  londonConfig,
  eugeneConfig,
  jerseyCityConfig,
  bostonConfig,
  illinoisConfig,
  berlinConfig,
  tokyoConfig,
  sydneyConfig,
  pittsburghConfig,
  orangeCountyConfig,
  houstonConfig,
  denverColfaxConfig,
  vermontCityConfig,
  fortLauderdaleConfig,
  indianapolisMonumentalConfig,
  jacksonHoleConfig,
  miamiConfig,
  sanFranciscoConfig,
  airForceConfig,
  armyTenMilerConfig,
  surfCityConfig,
  dallasConfig,
  detroitConfig,
  baltimoreConfig,
  memphisConfig,
  grandmasConfig,
  columbusConfig,
  stGeorgeConfig,
  portlandConfig,
  missoulaConfig,
  newportConfig,
  honoluluConfig,
  bayshoreConfig,
  sanAntonioConfig,
  bigSurConfig,
  annArborConfig,
  charlotteConfig,
  binationalConfig,
  northshoreConfig,
  santaBarbaraConfig,
  behindTheRocksConfig,
  gulfCoastConfig,
  lasVegasConfig,
  bangorConfig,
  brooklynHalfConfig,
  capitalCityConfig,
  carmelConfig,
  coastGuardConfig,
  atlanticCityConfig,
  desMoinesConfig,
  coloradoSpringsConfig,
  humboldtRedwoodsConfig,
]

/**
 * Build the alias -> config lookup map from all configs.
 * This runs once at module load time.
 */
function buildAliasMap(configs) {
  const map = {}
  for (const config of configs) {
    if (!config.aliases) continue
    for (const alias of config.aliases) {
      map[alias] = config
    }
  }
  return map
}

const ALIAS_MAP = buildAliasMap(ALL_CONFIGS)

/**
 * Create a scraper instance from a config object.
 *
 * Some races live on different platforms in different years (e.g. LA Marathon
 * is on Xacte for recent years but only on Athlinks for 2018). A config may
 * declare `yearOverrides: { <year>: { platform, eventIds, ... } }` whose fields
 * are shallow-merged over the base config for that year only.
 */
function createScraper(config, year) {
  const override = config.yearOverrides?.[year]
  const fileConfig = override ? { ...config, ...override } : config
  // DB-backed event ids from the dashboard, layered last so a human fixing a
  // gap in the UI beats whatever the file happens to say. Reads a cache, so
  // callers must have awaited ensureOverridesLoaded(); when they have not,
  // this is a no-op and the file config applies — old behavior, not a wrong
  // one.
  const effectiveConfig = applyOverride(fileConfig, year)

  const ScraperClass = PLATFORM_MAP[effectiveConfig.platform]
  if (!ScraperClass) {
    throw new Error(`Unknown platform: ${effectiveConfig.platform}`)
  }
  const primary = new ScraperClass(year, effectiveConfig)

  // Optional fallback platform, tried when the primary finds nothing.
  //
  // The case this exists for: a race is timed by one provider and MIRRORED to
  // another. The mirror lags. On race day — exactly when customers are
  // ordering — the timer's own site has results while the mirror still 404s,
  // 500s or returns an empty set. SF Marathon is Athlinks-mirrored but
  // ChronoTrack-timed, and on race day 2026 Athlinks was timing out for every
  // year while ChronoTrack served complete results.
  const fb = effectiveConfig.fallback
  if (!fb?.platform) return primary

  const FallbackClass = PLATFORM_MAP[fb.platform]
  if (!FallbackClass) {
    console.warn(`[scrapers] Unknown fallback platform "${fb.platform}" for ${config.raceName}; ignoring`)
    return primary
  }
  const fallback = new FallbackClass(year, { ...effectiveConfig, ...fb })
  return wrapWithFallback(primary, fallback, config.tag || config.raceName)
}

/**
 * Run `primary`, and fall back to `fallback` when the primary did not produce a
 * usable result.
 *
 * We only fall back on "no data" outcomes — not_found, upstream_error,
 * year_not_configured, or a thrown error. A found result, or a deliberate
 * `ambiguous` (the runner IS there, a human just needs to pick), is returned
 * as-is: retrying those on another source would risk answering a question the
 * primary already answered correctly.
 *
 * ORDER MATTERS ON THE PUBLIC ENDPOINT. Falling back is not free: the storefront
 * wizard aborts its own request at 12s, while a dead primary can burn ~26s
 * (12s timeout + 1.5s backoff + 12s retry) before the fallback even starts. The
 * shopper is long gone. So when a source is known to be down for a given year,
 * put the working one first with `fallback.preferFallback` rather than paying
 * the timeout on every single lookup.
 */
function wrapWithFallback(primary, fallback, tag) {
  const originalSearch = primary.searchRunner.bind(primary)

  primary.searchRunner = async (runnerName) => {
    let result
    try {
      result = await originalSearch(runnerName)
    } catch (err) {
      console.log(`[${tag}] Primary scraper threw (${err.message}) - trying fallback`)
      return fallback.searchRunner(runnerName)
    }

    if (result?.found || result?.ambiguous) return result

    console.log(`[${tag}] Primary returned "${result?.researchStatus || 'nothing'}" - trying fallback`)
    try {
      const fbResult = await fallback.searchRunner(runnerName)
      if (fbResult?.found || fbResult?.ambiguous) return fbResult

      // Neither found anything. Prefer whichever status is actually actionable.
      // `year_not_configured` from the primary is expected by design when a
      // year is deliberately served by the fallback — reporting it would send
      // someone off to add event IDs that are not the problem. The fallback's
      // status (e.g. upstream_error: "the timing site is down") describes what
      // really happened.
      if (result?.researchStatus === 'year_not_configured' && fbResult) return fbResult
      return result || fbResult
    } catch (err) {
      console.log(`[${tag}] Fallback scraper threw (${err.message}) - keeping primary result`)
      return result
    }
  }

  return primary
}

/**
 * Try to match a race name to a config using keyword-based fuzzy matching
 */
function findConfigByKeywords(normalizedName) {
  for (const config of ALL_CONFIGS) {
    if (!config.keywords) continue

    const hasKeyword = config.keywords.some(kw => normalizedName.includes(kw))
    if (!hasKeyword) continue

    // Some races require "marathon" in the name to avoid false positives
    // Others (like 'kiawah' or 'cim') are unique enough on their own
    if (config.keywordRequiresMarathon) {
      if (normalizedName.includes('marathon')) {
        return config
      }
    } else {
      // Check if the name includes 'marathon' OR is exactly the keyword
      if (normalizedName.includes('marathon') || config.keywords.some(kw => normalizedName === kw)) {
        return config
      }
    }
  }
  return null
}

/**
 * Match a race name to its config using alias + fuzzy matching.
 * @param {string} raceName - Name of the race
 * @returns {Object|null} The matched config, or null if none matches
 */
function findConfigForRace(raceName) {
  // Belt-and-suspenders: normalize bare names ("Boston" → "Boston Marathon")
  // so any orders that snuck through with a non-canonical raceName still match.
  const lookupName = normalizeRaceName(raceName) || raceName

  // 1. Try exact alias match
  let config = ALIAS_MAP[lookupName]

  // 2. Try case-insensitive alias match
  if (!config) {
    const normalizedName = lookupName.toLowerCase().trim()
    for (const [alias, cfg] of Object.entries(ALIAS_MAP)) {
      if (alias.toLowerCase() === normalizedName) {
        config = cfg
        break
      }
    }

    // 3. Try keyword-based fuzzy matching
    if (!config) {
      config = findConfigByKeywords(normalizedName)
    }
  }

  return config || null
}

/**
 * Get the appropriate scraper for a race
 * @param {string} raceName - Name of the race
 * @param {number} year - Year of the race
 * @returns {BaseScraper} Scraper instance
 * @throws {Error} If no scraper is available for the race
 */
export function getScraperForRace(raceName, year) {
  const config = findConfigForRace(raceName)

  if (!config) {
    throw new Error(`No scraper available for race: ${raceName}`)
  }

  return createScraper(config, year)
}

/**
 * Check if we have a scraper for a given race
 * @param {string} raceName - Name of the race
 * @returns {boolean}
 */
export function hasScraperForRace(raceName) {
  try {
    getScraperForRace(raceName, 2024) // Year doesn't matter for this check
    return true
  } catch {
    return false
  }
}

/**
 * Platforms excluded from the public, unauthenticated results-lookup endpoint.
 *
 * Speed is the smaller reason. multisport-australia is here because MultiSport
 * Australia rate-limits hard: about 25 browser launches from one IP during
 * testing got that IP blocked, and it had not cleared 90 seconds later. Public
 * lookups are shopper-driven, so the volume is uncapped in a way order research
 * is not, and every block comes back as "the timing site is down" plus an alert.
 *
 * The failure we are actually avoiding is the second-order one. Sustained
 * public traffic could get the Vercel egress IPs blocked, which would take out
 * Sydney research in TrackstarOS as well - a thing that works today,
 * spent to add a storefront lookup that could never return a finish time
 * anyway, because the detail pages are walled off.
 *
 * Order research is fine on the same platform: a handful of lookups a day, off
 * a different code path, nowhere near the limit.
 *
 * runsignup is here for the original reason, speed: it still needs a second
 * browser launch to get a time, which does not fit the endpoint's 9s budget.
 */
const PUPPETEER_PLATFORMS = new Set(['runsignup', 'multisport-australia'])

/** Every platform that drives a browser, fast enough for public use or not. */
const BROWSER_PLATFORMS = new Set(['runsignup', 'multisport-australia'])

/**
 * Whether a race is safe to expose via the public results-lookup endpoint.
 * True only when we have a scraper AND that scraper is HTTP-based (not Puppeteer).
 * @param {string} raceName - Name of the race
 * @returns {boolean}
 */
/**
 * Does this race's scraper drive a headless browser?
 *
 * Not a health signal - it is a cost one. A browser fetch is several seconds,
 * so a caller on a deadline uses this to decide how many of them it can afford.
 */
export function raceNeedsBrowser(raceName) {
  const config = findConfigForRace(raceName)
  return !!config && BROWSER_PLATFORMS.has(config.platform)
}

export function isRacePublicSafe(raceName) {
  const config = findConfigForRace(raceName)
  return !!config && !PUPPETEER_PLATFORMS.has(config.platform)
}

/**
 * Resolve any race name/alias to its canonical primary race name.
 * Lets callers compare two differently-spelled names (e.g. "boston" vs
 * "Boston Marathon") by resolving both to the same canonical string.
 * @param {string} raceName - Name of the race
 * @returns {string|null} Canonical config.raceName, or null if unmatched
 */
export function getCanonicalRaceName(raceName) {
  const config = findConfigForRace(raceName)
  return config ? config.raceName : null
}

// Platform-specific names for the "year -> id" map a config carries. A config
// that has any of these knows exactly which years it can look up.
const YEAR_ID_FIELDS = ['eventIds', 'raceIds', 'eventCodes']

function explicitYearsOf(obj) {
  if (!obj) return []
  const out = []
  for (const field of YEAR_ID_FIELDS) {
    if (obj[field]) out.push(...Object.keys(obj[field]).map(Number))
  }
  return out
}

/**
 * The set of years we can DEFINITELY look up for a race, or null when coverage
 * is not knowable without probing.
 *
 * Returns a year array only when the config resolves every year through an
 * explicit id map (eventIds/raceIds/eventCodes) at the base and, if present,
 * the fallback. In that case a year outside the union genuinely has no data, so
 * the storefront can skip the search for it. Returns null the moment anything
 * derives a URL from the year itself (a `{year}` pattern), because then any year
 * is derivable and only a real lookup can say whether results exist. Null is the
 * safe answer: it keeps the old "just search" behaviour.
 *
 * @param {string} raceName
 * @returns {number[]|null}
 */
/**
 * Whether a result's event is the one the race's print is designed for: a
 * marathon, or the race's own signature distance (the first of its config's
 * eventTypes, e.g. the Army Ten-Miler's 10 Miler). Halves and side races at a
 * marathon are not; their prints are made by hand.
 */
/** Events at a race that each have their own design (see BaseScraper.namedEvent). */
export function namedEventsFor(raceName) {
  return findConfigForRace(raceName)?.namedEvents || []
}

export function isMainEvent(raceName, eventType) {
  const e = String(eventType || '').trim().toLowerCase()
  if (!e || e === 'marathon') return true
  const main = findConfigForRace(raceName)?.eventTypes?.[0]
  if (main && String(main).trim().toLowerCase() === e) return true
  // A race named for its event ("Donna Half Marathon", "Semper Fred 5K").
  const words = e.replace(/marathon/, '').trim()
  return Boolean(words) && String(raceName || '').toLowerCase().includes(words)
}

export function getCoveredYears(raceName) {
  const config = findConfigForRace(raceName)
  if (!config) return null

  const baseYears = explicitYearsOf(config)
  if (baseYears.length === 0) return null // base derives from a {year} pattern
  // A fallback with no explicit ids also derives from a pattern, so we cannot
  // claim any year is uncovered.
  if (config.fallback && explicitYearsOf(config.fallback).length === 0) return null

  const years = new Set(baseYears)
  explicitYearsOf(config.fallback).forEach(y => years.add(y))
  if (config.yearOverrides) {
    for (const [year, override] of Object.entries(config.yearOverrides)) {
      years.add(Number(year))
      explicitYearsOf(override).forEach(y => years.add(y))
    }
  }
  return [...years].filter(Number.isFinite).sort((a, b) => a - b)
}

/**
 * List of primary race names safe to expose via the public lookup endpoint.
 * Used to render the "instant lookup available" badge on the storefront.
 * @returns {string[]}
 */
export function getPublicSafeRaces() {
  return ALL_CONFIGS
    .filter(config => !PUPPETEER_PLATFORMS.has(config.platform))
    .map(config => config.raceName)
}

/**
 * Get list of supported races
 * @returns {string[]} List of primary race names we can scrape
 */
export function getSupportedRaces() {
  return ALL_CONFIGS.map(config => config.raceName)
}

/**
 * Per-race config summary for the scraper-health view.
 *
 * The health dashboard needs to answer "is this race wired up for THIS year",
 * and the honest answer depends on how the config resolves a year. Two shapes:
 *
 *   - `eventIds: { 2026: … }` — an explicit per-year map. A year that is not a
 *     key genuinely does not work, and that is a config gap someone can go fix
 *     in about five minutes. 15 configs look like this.
 *   - a `{year}` URL/code pattern and no eventIds — any year is derivable, so
 *     coverage is unknown until something actually probes it. 27 look like this.
 *
 * Reporting those two as the same "supported" was what made the old Scraper
 * Status panel misleading: it tested `new Date().getFullYear()` against configs
 * that in several cases have no ids for the current year at all.
 *
 * @returns {Array<{raceName, platform, publicSafe, explicitYears, fallbackYears, hasYearPattern}>}
 */
/**
 * The VERIFIED (pinned) race dates per race, as opposed to computed ones.
 *
 * The nightly sweep needs to tell the two apart: a pinned date was looked up
 * from a source, a computed one is a rule guessing. getRaceConfigSummaries
 * deliberately returns the computed date because callers there want "when is
 * this race", not "do we actually know".
 */
/** The citation behind each pinned date, by race and year: where the config author confirmed it. */
export function getRaceDateCitations() {
  const out = {}
  for (const config of ALL_CONFIGS) out[config.raceName] = config.raceDateSources ? { ...config.raceDateSources } : {}
  return out
}

/**
 * One race's verified dates, year -> "YYYY-MM-DD", or null when the race has
 * no config or no pinned dates. Verified means looked up against an official
 * source; computed (rule-based) dates are deliberately not included, so the
 * storefront never promises a race day we have not confirmed.
 */
export function getRaceDatesForRace(raceName) {
  const config = findConfigForRace(raceName)
  if (!config || !config.raceDates) return null
  const out = {}
  for (const [year, date] of Object.entries(config.raceDates)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) out[year] = String(date)
  }
  return Object.keys(out).length ? out : null
}

export function getVerifiedRaceDates() {
  const out = {}
  for (const config of ALL_CONFIGS) {
    out[config.raceName] = config.raceDates ? { ...config.raceDates } : {}
  }
  return out
}

/** The distance a race's name states, for configs that do not set one. */
function distanceFromName(name) {
  if (/ten[- ]?miler|10[- ]?mile/i.test(name)) return 10
  if (/half/i.test(name)) return 13.1
  if (/marathon/i.test(name)) return 26.2
  return null
}

export function getRaceConfigSummaries(years = []) {
  return ALL_CONFIGS.map(config => {
    const explicitYears = config.eventIds ? Object.keys(config.eventIds).map(Number).sort() : []
    const fallbackYears = config.fallback?.eventIds
      ? Object.keys(config.fallback.eventIds).map(Number).sort()
      : []

    // When each covered year's race actually happens. A race that has not run
    // yet has no results to configure or scrape, so reporting it as a gap is
    // noise: Jackson Hole 2026 is in September and was being counted as work
    // to do.
    //
    // Verified dates only. Computed dates are gone from every config, so a
    // year we have not pinned is null - which the callers already handle as
    // "date unknown", and which the sweep should surface as work to do.
    const raceDates = {}
    for (const year of years) {
      try {
        const pinned = config.raceDates?.[year]
        if (!pinned) { raceDates[year] = null; continue }
        const [y, m, d] = String(pinned).split('-').map(Number)
        raceDates[year] = y && m && d ? new Date(y, m - 1, d).toISOString() : null
      } catch {
        raceDates[year] = null
      }
    }

    return {
      raceDates,
      raceName: config.raceName,
      platform: config.platform,
      fallbackPlatform: config.fallback?.platform || null,
      // Athlinks' MasterEvents API is keyed on this, and it is the only
      // platform we can enumerate, so it is what makes a race auto-fixable.
      masterEventId: config.masterEventId || null,
      fallbackMasterEventId: config.fallback?.masterEventId || null,
      publicSafe: !PUPPETEER_PLATFORMS.has(config.platform),
      explicitYears,
      fallbackYears,
      // No explicit ids means the scraper builds its URL from the year itself,
      // so there is no such thing as an unconfigured year for this race.
      hasYearPattern: explicitYears.length === 0,
      // Full-distance miles. Pace checks read this; without it every race was
      // checked as a marathon, which is wrong for the Army Ten-Miler.
      distanceMiles: config.distanceMiles || config.distances?.marathon || distanceFromName(config.raceName),
    }
  })
}

/**
 * Get race name → shorthand map from all configs.
 * Maps every alias to its tag so the frontend can generate filenames.
 * @returns {Object} e.g. { "Chicago Marathon": "Chicago", "London Marathon": "London", ... }
 */
export function getRaceShorthands() {
  const map = {}
  for (const config of ALL_CONFIGS) {
    const tag = config.tag || config.raceName
    // Map the primary race name
    map[config.raceName] = tag
    // Map all aliases
    if (config.aliases) {
      for (const alias of config.aliases) {
        map[alias] = tag
      }
    }
  }
  return map
}

export default {
  getScraperForRace,
  hasScraperForRace,
  getSupportedRaces,
  getRaceShorthands,
  isRacePublicSafe,
  raceNeedsBrowser,
  getPublicSafeRaces,
  getCanonicalRaceName
}
