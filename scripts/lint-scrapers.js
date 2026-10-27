/**
 * Static lint for scraper fixtures.
 *
 * Runs as part of `npm run build` to catch the case where a developer
 * adds a new scraper platform but forgets to add a chip-time fixture.
 *
 * Fast (no network calls) — just file reads + import checks.
 *
 * Fails the build if:
 *   - A platform under server/scrapers/platforms/ has no fixture
 *   - A scraper config file fails to import
 *
 * The actual chip-time correctness is verified by:
 *   - scripts/verify-scraper-chip-times.js (manual, network-dependent)
 *   - the weekly health-check cron
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLATFORMS_DIR = path.resolve(__dirname, '../server/scrapers/platforms')
const FIXTURES_PATH = path.resolve(__dirname, '../server/scrapers/__tests__/chip-time-fixtures.js')

const errors = []
const warnings = []

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dayOf = iso => new Date(`${iso}T12:00:00Z`).getUTCDay()

// 1. Read all platform files
const platformFiles = fs.readdirSync(PLATFORMS_DIR)
  .filter(f => f.endsWith('Scraper.js') && f !== 'BaseScraper.js')
  .map(f => f.replace('Scraper.js', '').toLowerCase())

console.log(`\nLinting ${platformFiles.length} scraper platforms...\n`)

// 2. Read fixtures and extract platform identifiers
let fixtures
try {
  const mod = await import(FIXTURES_PATH)
  fixtures = mod.CHIP_TIME_FIXTURES
} catch (e) {
  errors.push(`Failed to load fixtures: ${e.message}`)
  fixtures = []
}

const fixturePlatforms = new Set(fixtures.map(f => f.platform.toLowerCase()))

// Map known platform name aliases (file name → fixture identifier)
const PLATFORM_NAME_ALIASES = {
  'mikatiming': 'mika',
  'myraceai': 'myrace',
  'racerosters': 'raceroster',
  'tokyomarathon': 'tokyo',
  'multisportaustralia': 'multisport-australia',
}

// Platforms that predate the fixture requirement. These are grandfathered:
// they only WARN. Every NEW platform must ship with a fixture or the build
// fails (see the add-race-scraper skill). Backfilling these removes them here.
// Do NOT add to this list — the whole point is that new scrapers get a fixture.
const FIXTURE_GRANDFATHERED = new Set([
  'brooksee', 'laureltiming', 'mtecresults', 'mychiptime', 'myrace',
  'nyrr', 'runsignup', 'scorethis', 'xacte',
])

// 3. Verify every platform has at least one fixture.
// Missing fixture is a hard error for new platforms, a warning for
// grandfathered ones.
for (const platformFile of platformFiles) {
  const expectedKey = PLATFORM_NAME_ALIASES[platformFile] || platformFile
  if (!fixturePlatforms.has(expectedKey)) {
    const msg =
      `Platform "${platformFile}Scraper.js" has no chip-time fixture. ` +
      `Add one to server/scrapers/__tests__/chip-time-fixtures.js with platform: "${expectedKey}" ` +
      `(include an uneven-splits runner - see the add-race-scraper skill).`
    if (FIXTURE_GRANDFATHERED.has(platformFile) || FIXTURE_GRANDFATHERED.has(expectedKey)) {
      warnings.push(msg + ' [grandfathered - backfill when possible]')
    } else {
      errors.push(msg)
    }
  } else {
    console.log(`  ✓ ${platformFile.padEnd(15)} has fixture(s)`)
  }
}

// 4. Verify every fixture has the required fields.
// Both expectedChipTime AND expectedChipPace are required — two sources of
// gun/chip drift, so we lock both down. Boston bug (April 2026) is why.
for (const fx of fixtures) {
  const required = ['platform', 'race', 'year', 'runner', 'expectedChipTime', 'expectedChipPace']
  const missing = required.filter(k => !fx[k])
  if (missing.length > 0) {
    errors.push(`Fixture for ${fx.race || '?'}: missing fields ${missing.join(', ')}`)
  }
  if (fx.expectedChipTime && !/^\d{1,2}:\d{2}:\d{2}/.test(fx.expectedChipTime)) {
    errors.push(`Fixture for ${fx.race}: expectedChipTime "${fx.expectedChipTime}" doesn't look like HH:MM:SS`)
  }
  if (fx.expectedChipPace && !/^\d{1,2}:\d{2}$/.test(fx.expectedChipPace)) {
    errors.push(`Fixture for ${fx.race}: expectedChipPace "${fx.expectedChipPace}" doesn't look like MM:SS`)
  }
}

// 4b. Every fixture's expected time is read off the race's official results
// page, and says so. A hand-typed expectation is how a wrong rounding change
// passed every test on 2026-10-27 (RTRT cut 04:35:30.654 to 4:35:30; MCM's
// official results show 04:35:31). Fixtures from before then are listed in
// fixtures-unproven.js until somebody reads their page.
const { UNPROVEN_FIXTURES } = await import(path.resolve(__dirname, '../server/scrapers/__tests__/fixtures-unproven.js'))
const asSeconds = t => String(t || '').trim().split(':').map(Number).reduce((a, n) => a * 60 + n, 0)
let unproven = 0
for (const fx of fixtures) {
  const key = `${fx.platform}|${fx.race}|${fx.year}|${fx.runner}`
  const op = fx.officialPage
  if (!op) {
    if (UNPROVEN_FIXTURES.has(key)) unproven++
    else errors.push(`Fixture ${key}: no officialPage. Read the time off the official results page (the one the race's site links to) and add officialPage: { url, shows, readOn }.`)
    continue
  }
  if (UNPROVEN_FIXTURES.has(key)) errors.push(`Fixture ${key} has officialPage: take it out of fixtures-unproven.js.`)
  if (!/^https:\/\//.test(op.url || '')) errors.push(`Fixture ${key}: officialPage.url must be the https results page.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(op.readOn || '')) errors.push(`Fixture ${key}: officialPage.readOn must be the date it was read, YYYY-MM-DD.`)
  // A page that prints tenths ("3:22:15.8") is quoted as printed; the print
  // carries its whole seconds.
  if (!/^\d{1,2}:\d{2}:\d{2}(\.\d+)?$/.test(op.shows || '')) errors.push(`Fixture ${key}: officialPage.shows must be the time exactly as the page prints it (HH:MM:SS, with any tenths).`)
  else if (fx.expectedChipTime && asSeconds(op.shows.replace(/\.\d+$/, '')) !== asSeconds(fx.expectedChipTime)) {
    errors.push(`Fixture ${key}: expectedChipTime ${fx.expectedChipTime} is not what the official page shows (${op.shows}).`)
  }
}
if (unproven) warnings.push(`${unproven} fixtures predate officialPage and have not been checked against the official results page (fixtures-unproven.js).`)

// Borrowed from the coverage grid rather than recomputed. Hand-rolling the
// window here made this gate disagree with the nightly sweep: lint called
// Boston's dates verified while the sweep correctly reported 2022 missing,
// because the grid covers five years and this counted four. Two definitions of
// "covered" is one too many.
const { coveredYears } = await import('../server/lib/scraperHealth.js')
const COVERED_YEARS = coveredYears()

// 5. Verify every config file imports cleanly
const CONFIGS_DIR = path.resolve(__dirname, '../server/scrapers/configs')
const configFiles = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.js'))
console.log(`\nValidating ${configFiles.length} race configs...\n`)

for (const file of configFiles) {
  try {
    const mod = await import(path.join(CONFIGS_DIR, file))
    const cfg = mod.default
    if (!cfg) { errors.push(`${file}: no default export`); continue }
    if (!cfg.platform) errors.push(`${file}: missing 'platform'`)
    if (!cfg.raceName) errors.push(`${file}: missing 'raceName'`)
    if (!cfg.aliases || !Array.isArray(cfg.aliases) || cfg.aliases.length === 0) {
      errors.push(`${file}: missing or empty 'aliases'`)
    }
    // Race dates must be VERIFIED, not computed.
    //
    // calculateDate encodes a rule like "third Sunday of August", and races
    // move. Sydney switched from mid-September to late August in 2025 and the
    // rule silently returned a date three weeks wrong for every earlier
    // edition. The date is printed on the poster, so a wrong one ships.
    //
    // resolveRaceDate prefers a scraped date, then a raceDates entry, and only
    // computes as a last resort. This warns for every year that would still
    // land on that last resort, so the remaining gap is visible and countable
    // rather than invisible.
    const missing = COVERED_YEARS.filter(y => !cfg.raceDates?.[y])
    if (missing.length) {
      warnings.push(
        `${file}: no verified raceDates for ${missing.join(', ')} - ` +
        `these fall back to a computed date. Look the real dates up and pin them.`
      )
    }

    // Every pinned date needs a source, and a rule is not a source.
    //
    // The weekday gate below cannot catch a date derived FROM a weekday rule,
    // because such a date agrees with its siblings by construction. On
    // 2026-09-10 a run pinned 25 dates off "third Sunday in October", "second
    // Saturday of February" and similar, every one of them sailed through the
    // gate, and the commit message recorded the rules as if they were
    // citations. A guess that passes the check is worse than no check.
    //
    // So provenance is data, not prose: raceDateSources[year] names where the
    // day came from. A config that has opted in must be complete — that makes
    // the requirement ratchet forward file by file without a grandfather list,
    // and makes a missing source a build failure rather than a warning nobody
    // reads at 1am.
    const RULE_SHAPED = /\b(first|second|third|fourth|fifth|last)\s+\w*\s*(sun|mon|tues?|wed(nes)?|thurs?|fri|satur)day\b|\btypically\b|\balways\b/i
    const sources = cfg.raceDateSources
    if (sources !== undefined) {
      if (typeof sources !== 'object' || Array.isArray(sources)) {
        errors.push(`${file}: raceDateSources must be an object of year -> source.`)
      } else {
        for (const [year] of Object.entries(cfg.raceDates || {})) {
          const src = sources[year]
          if (typeof src !== 'string' || src.trim().length < 8) {
            errors.push(
              `${file}: raceDates.${year} has no raceDateSources.${year}. Name where the ` +
              `calendar day came from, e.g. 'marinemarathon.com results + DVIDS coverage'. ` +
              `If you could not find one, leave the year out — a computed date shows as a ` +
              `warning until somebody fixes it, a guessed one looks finished forever.`
            )
          } else if (RULE_SHAPED.test(src)) {
            errors.push(
              `${file}: raceDateSources.${year} = "${src}" is a rule, not a source. ` +
              `"Third Sunday in October" tells you how to guess the day, not that anyone ` +
              `checked which day this race actually ran. Cite something that names the date ` +
              `for ${year} specifically, or drop the year.`
            )
          }
        }
      }
    } else if (Object.keys(cfg.raceDates || {}).length) {
      warnings.push(
        `${file}: ${Object.keys(cfg.raceDates).length} pinned date(s) with no raceDateSources. ` +
        `[grandfathered - backfill when possible]`
      )
    }

    // Race WEEKEND is not race DAY.
    //
    // Every wrong date this repo has shipped came from the same move: a source
    // says "February 28 - March 1" or "the May 17-18 weekend", and the first
    // day gets pinned when the marathon was actually the second. Seven such
    // dates went in on 2026-09-09, and denverColfax 2023 had been sitting wrong
    // before that. It is one day off, which is exactly small enough that
    // nobody notices until the poster prints the wrong weather.
    //
    // This is a heuristic and not a truth. Races do move days — Sydney went
    // from mid-September to late August, and a Sunday race can become a
    // Saturday one. So the check deliberately does NOT claim the date is
    // wrong. It says the date disagrees with its siblings, and asks for a
    // source either way. Recording a genuine move costs one line with a
    // reason, which is the whole design: an intentional move leaves a record,
    // an accident gets stopped. Anything that made "just shift it a day" the
    // cheaper response would turn this gate into a source of wrong dates.
    const dated = Object.entries(cfg.raceDates || {})
      .filter(([, d]) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    const rawExempt = cfg.raceDatesWeekdayExceptions || {}
    if (Array.isArray(rawExempt)) {
      errors.push(
        `${file}: raceDatesWeekdayExceptions must be an object of year -> reason, not an ` +
        `array. A bare year records that someone silenced the check but not why.`
      )
    }
    const exempt = new Map(Object.entries(Array.isArray(rawExempt) ? {} : rawExempt))
    if (dated.length >= 3) {
      const tally = {}
      for (const [, d] of dated) tally[dayOf(d)] = (tally[dayOf(d)] || 0) + 1
      const [modal, modalCount] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
      // No majority means no expectation to violate — say nothing rather than
      // picking a winner out of a 2-2 split.
      if (modalCount > dated.length / 2) {
        for (const [year, d] of dated) {
          if (String(dayOf(d)) === modal) continue
          const reason = exempt.get(String(year))
          if (reason !== undefined) {
            if (typeof reason !== 'string' || reason.trim().length < 10) {
              errors.push(
                `${file}: raceDatesWeekdayExceptions.${year} needs a reason naming a source, ` +
                `e.g. 'moved to Saturday, per usafmarathon.com'. An empty exemption is just ` +
                `a silenced check.`
              )
            }
            continue
          }
          errors.push(
            `${file}: raceDates.${year} = ${d} is a ${DAYS[dayOf(d)]}, but this race runs ` +
            `${DAYS[modal]} in ${modalCount} of ${dated.length} pinned years. Either the date ` +
            `is a day off — the usual cause is a race-weekend range with the wrong end pinned ` +
            `— or the race genuinely moved. Both answers need a source naming the day ${year} ` +
            `actually ran. Do not resolve this by shifting the date to match its neighbours. ` +
            `If it moved, record raceDatesWeekdayExceptions: { ${year}: 'moved to ` +
            `${DAYS[dayOf(d)]}, per <source>' }.`
          )
        }
      }
    }

    console.log(`  ✓ ${file.padEnd(25)} (${cfg.platform})${missing.length ? `  [${missing.length} computed year(s)]` : '  [dates verified]'}`)
  } catch (e) {
    errors.push(`${file}: failed to import - ${e.message}`)
  }
}

// 6. Report
console.log()
if (warnings.length > 0) {
  console.log('=== WARNINGS ===')
  warnings.forEach(w => console.log(`  ⚠️  ${w}`))
  console.log()
}
if (errors.length > 0) {
  console.log('=== ERRORS ===')
  errors.forEach(e => console.log(`  ❌ ${e}`))
  console.log(`\nLint FAILED with ${errors.length} error(s).`)
  process.exit(1)
}

console.log(`Lint PASSED. ${warnings.length} warning(s).`)
