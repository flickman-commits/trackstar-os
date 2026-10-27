---
name: add-race-scraper
description: >-
  Add a new race-results scraper (or a new race config / year to an existing
  platform) to the Trackstar fulfillment scraper system, with the verification
  gates that prevent wrong-time and wrong-pace regressions. Use whenever the
  task is "add a scraper for [race]", "support [race] [year]", "add a new
  timing platform", "wire up [race] results", or anything that touches
  server/scrapers/. ALWAYS use this skill before claiming a scraper works —
  scraped time and pace can look plausible while being wrong.
---

# Adding a race-results scraper

## Why this skill exists

Two bugs have shipped because a scraper returned a value that *looked* right but
wasn't:

- **Gun time vs chip time** — Boston returned the gun finish (2:38:18) instead of
  the chip finish (2:38:10). Both are valid-looking times.
- **Per-segment pace vs overall pace** — MTEC (Grandma's) returned the pace over
  the *final split segment* (e.g. 10:15/mi over the last 1.2 mi) instead of the
  overall average pace (9:24/mi). The scraped page column was literally labeled
  "Pace Between" — a per-segment value, not the overall.

- **Rounding the fraction** — on 2026-10-27 RTRT was switched from rounding
  (04:35:30.654 -> 4:35:31) to cutting (4:35:30) on a belief about what the
  official results show. Nobody read the page; the fixture's expected time was
  typed from the same belief, and the Illinois fixtures that disagreed were
  "corrected" to match. Every test passed. Marine Corps' official results show
  04:35:31: 23 orders moved a second low and 9 went to print that way.

Both bugs are invisible to a casual check. The MTEC bug was also invisible to a
fixture using an **even-splits runner**, because for them the final-segment pace
≈ the overall pace. It only showed on a runner who slowed down.

The rules below exist specifically to catch this class of bug. Do not skip them.

## The architecture (read first)

- Platform scrapers: `server/scrapers/platforms/<Platform>Scraper.js`, each
  extends `BaseScraper` and implements `searchRunner(name)`.
- Race configs: `server/scrapers/configs/<race>.js` (one per race; default
  export). Adding a race for an *existing* platform is config-only.
- Factory + registration: `server/scrapers/index.js` (`PLATFORM_MAP` and the
  config imports). A brand-new platform must be registered here.
- Fixtures: `server/scrapers/__tests__/chip-time-fixtures.js`.
- Gates: `scripts/lint-scrapers.js` (static) and
  `scripts/verify-scraper-chip-times.js` (live).
- Pace helper: `BaseScraper.calculatePace(time, distanceMiles)` — overall pace
  from time ÷ distance. **Prefer this over scraping a pace column.**

## Procedure

### 1. Determine scope
- New race on an existing platform → add a config file only.
- New timing platform → add a `<Platform>Scraper.js`, register it in
  `index.js` `PLATFORM_MAP`, then add the config.

### 1b. Cover the last 4 years by default — REQUIRED

**Never configure a year before 2020.** Orders for older races are too few to
justify a scraper; those runners are researched by hand (the order reads
"Research by hand", `SCRAPER_MIN_YEAR` in `server/domain/orders/pipeline.js`).
Customers order prints of races they ran years ago, not just the most recent
edition. A config wired up for only the current year sends every older order to
manual research.

So whenever you add or touch a race config, populate `eventIds` for **the last
4 completed years** (plus the current year if its results are published). Adding
a single year to an existing config is the moment to backfill the rest — you
already have the discovery method open.

Rules that matter more than the count:

- **Never guess or extrapolate an id.** Ids are not sequential and offsets are
  not stable. Dallas's per-distance child ids sit +127, +56 and +117 from their
  landing ids in consecutive years. Look each one up.
- **Verify each year resolves to that year.** Open the event and confirm the
  title/date is the year you think it is. A fallback id that pointed at "the
  most recent edition" is what stamped Philadelphia 2026 with a Nov 2025 date
  and turned a not-yet-run race into "runner not found".
- **Never add a `defaultEventId`-style catch-all.** An unconfigured year must
  fail loudly (`yearNotConfiguredResult`), never silently borrow another year.
- **Stop when the platform genuinely lacks the year.** If the timer only has
  2024+, say so in the config header and leave the older years out. Philadelphia
  pre-2024 is not on MyChipTime at all; inventing ids for it would be worse than
  no coverage.
- **A future year needs no ids.** If the race has not run, leave it out and let
  `calculateDate` drive the date. Which means:
- **Check `calculateDate` against real dates while you're here.** For any year
  with no scrapeable page, this computed date is the one that sticks, and race
  date drives the weather printed on the poster. Verify it against every edition
  you can confirm. Philadelphia's "third Sunday of November" rule was a week off
  for 2026; the real rule is the Sunday before Thanksgiving.

Record the discovery method in the config header (e.g. "read the per-distance
child ids off the per-year landing page") so the next person backfilling a year
does not have to rediscover it.

### 2. Pace: compute, don't scrape (default rule)
Always derive pace with `this.calculatePace(chipTime, distanceMiles)` unless you
have **proven** the page exposes a true *overall average* pace. Page pace columns
are frequently per-segment ("Pace Between"), per-km, or gun-based. If you do
scrape a pace, you must prove it equals `time ÷ distance` for a non-even-splits
runner (see step 4). When in doubt, compute.

For multi-distance platforms (marathon + half), make sure the distance passed to
`calculatePace` comes from the matched distance (`config.distances[distKey]`),
not a hardcoded 26.2.

### 3. Pull the chip Finish time, not gun/clock/segment
- Use the **chip / net** finish time, never gun time, never clock-of-day, never
  a split-interval time.
- If the page has both, document which selector is chip vs gun in a comment.

### 4. Add fixtures — REQUIRED, and pick the runners deliberately
Add to `chip-time-fixtures.js`. Every fixture needs `platform`, `race`, `year`,
`runner`, `expectedChipTime`, `expectedChipPace`, `expectedBib` (or null), and a
`notes` line citing the official page.

Choose runners that actually exercise the failure modes:
- **At least one runner with UNEVEN splits** (positive split / slowed at the
  end). This is the single most important rule — it is what catches the
  per-segment-pace bug. An even-splits elite will NOT catch it.
- For a platform with both gun and chip times, pick a runner whose gun ≠ chip
  and note both values, so a gun-time regression fails the fixture.
- For multi-distance platforms, add **one fixture per distance** (marathon AND
  half), so a wrong-distance pace (off by ~2x) is caught.

Sanity-check each fixture by hand BEFORE running anything:
`expectedChipPace` must ≈ `expectedChipTime ÷ distance`. Compute it:
`(H*3600 + M*60 + S) / distanceMiles / 60` → mm:ss. If your hand-typed pace
doesn't match, you copied the wrong number off the page — stop and re-read it.

### 5. Run the gates and read the output
```
npm run lint:scrapers      # config + fixture field validation
npm run test:scrapers      # live: fails on time OR pace mismatch
```
- `test:scrapers` must show your new fixture(s) PASS. Live sites occasionally
  WAF-block (e.g. Sydney 403) — distinguish a real failure from an upstream
  block by reading the log, don't just trust the summary count.
- If `lint:scrapers` only *warns* that your platform has no fixture, that is a
  failure of this procedure — add the fixture.

### 6. Read the official page — HARD GATE, no exceptions
The time we print must match the race's **official results page**: the one
the race's own website links to, because that is what the customer checks.
It is not always the timing vendor's own page, and the raw API value is not
it either.

- Find the official results link on the race's website. If it points at a
  different vendor than the scraper reads, stop and say so.
- For each fixture runner, read the finish time and pace **off that page**
  and record them in the fixture as
  `officialPage: { url, shows: '<exactly as printed>', readOn: 'YYYY-MM-DD' }`.
  `lint:scrapers` fails a fixture without it, or whose `shows` differs from
  `expectedChipTime`.
- Fractions: pick at least one runner whose raw time has a fraction past .5
  and one under it. Platforms differ (RTRT rounds to nearest, ChronoTrack
  rounds up); only the page tells you which.
- Never change how a platform rounds, cuts or picks a time without doing the
  above for that platform first, and never edit an existing fixture's expected
  time to make a new rule pass. If a fixture disagrees with your change, the
  page decides.
- If the page will not load (the RTRT embed renders blank; use
  `https://app.rtrt.me/<EVENT>?&oe=1&loadpage=%2Ftracker%2F<PID>&event=<EVENT>`),
  or is WAF-blocked, the scraper is **not verified**. Say so; do not
  substitute an assumption.

### 7. Resource hygiene (Puppeteer platforms only)
If the scraper launches a browser, close it in a `finally` block with
`.catch()` so a failed close can't mask the real error or leak Chromium on
Vercel. See `MultiSportAustraliaScraper.js` / `RunSignUpScraper.js`.

## Definition of done
- [ ] `eventIds` covers the last 4 completed years (or the config header
      explains which years the platform genuinely does not host).
- [ ] Every configured year was looked up, not extrapolated, and verified to
      resolve to that year. No `defaultEventId`-style catch-all.
- [ ] `calculateDate` checked against every edition whose real date you can
      confirm — it is the date of record for any year with no results page.
- [ ] Pace is computed from chip time ÷ matched distance (or scraped pace proven
      equal to it for an uneven-splits runner).
- [ ] ≥1 fixture per distance, including ≥1 uneven-splits runner.
- [ ] Hand-checked: each fixture's pace ≈ time ÷ distance.
- [ ] `npm run lint:scrapers` passes with NO missing-fixture warning for the
      new platform.
- [ ] `npm run test:scrapers` shows the new fixture(s) PASS (not WAF-blocked).
- [ ] Every new fixture has `officialPage` with the time read off the
      race's official results page (the one its own site links to), including
      a runner past .5 of a second; the page's pace is quoted in the commit.
