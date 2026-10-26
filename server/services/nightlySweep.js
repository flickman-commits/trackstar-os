/**
 * The nightly sweep: everything about TrackstarOS's health that can
 * be established by code alone.
 *
 * This file deliberately contains NO judgment. It gathers facts and returns
 * them. Deciding what to do about a fact - look a race date up, write a
 * config, wake Matt - is the agent's job, and it reads this report over the
 * admin API. The split matters: this half runs with production credentials on
 * Vercel, the agent half never sees them and can only write code.
 *
 * Everything here is READ-ONLY except the catalog sync, which is idempotent
 * and already runs on its own staleness timer.
 *
 * Two rules that shape the whole file:
 *
 *   1. No invented problems. Every finding is a concrete fact with an order
 *      number or a race attached. "Looks unusual" is not a finding. A sweep
 *      that cries wolf gets ignored, and then the real one is missed too.
 *
 *   2. Failure is a finding. If a check throws, that is reported as a broken
 *      check rather than silently omitted. A clean report must mean "we
 *      looked", never "we could not look". The stale catalog sat unnoticed for
 *      eighteen days precisely because nothing said it had stopped moving.
 */

import prisma from '../../api/_lib/prisma.js'
import { buildCatalogCoverage, coveredYears, NEEDS_HELP, STATUS } from '../lib/scraperHealth.js'
import { repairPlan } from '../lib/scraperRepair.js'
import { syncProductCatalog } from './shopifyProducts.js'
import { getRaceConfigSummaries, getSupportedRaces, getVerifiedRaceDates, getScraperForRace, hasScraperForRace } from '../scrapers/index.js'
import { ensureOverridesLoaded } from '../scrapers/scraperOverrides.js'
import { verificationOverview } from '../domain/races/verification.js'

/** Run a check so that a thrown error becomes a reported fact, not a gap. */
async function check(name, fn) {
  const started = Date.now()
  try {
    const data = await fn()
    return { name, ok: true, ms: Date.now() - started, ...data }
  } catch (error) {
    console.error(`[nightlySweep] check "${name}" failed:`, error.message)
    return { name, ok: false, ms: Date.now() - started, error: error.message, findings: [] }
  }
}

const DAY = 24 * 60 * 60 * 1000
const days = n => n * DAY

/* ────────────────────────────────────────────────────────────────────────
   1. What we sell
   ──────────────────────────────────────────────────────────────────────── */

async function catalogCheck() {
  // Idempotent, and the only write in the sweep. Without it every downstream
  // count is measured against whenever someone last pressed the button.
  let synced = null
  try {
    synced = await syncProductCatalog()
  } catch (error) {
    console.warn('[nightlySweep] catalog sync failed, using stored snapshot:', error.message)
  }

  const catalog = await buildCatalogCoverage()
  return {
    synced,
    activeProducts: catalog.products,
    racesSold: catalog.racesSold.length,
    // Races on sale today with no scraper at all. This is the worst category:
    // a shopper on that page gets manual entry and we never see it.
    findings: catalog.needsScraper.map(p => ({
      severity: 'high',
      kind: 'selling_without_scraper',
      subject: p.title,
      detail: `On sale (${p.handle}) with no scraper. Shoppers get manual entry only.`,
      action: 'tier2_flag',
    })),
  }
}

/* ────────────────────────────────────────────────────────────────────────
   2. Scraper coverage and health
   ──────────────────────────────────────────────────────────────────────── */

async function scraperCheck() {
  const years = coveredYears()
  const plan = await repairPlan(years)
  const health = await prisma.scraperHealth.findMany()

  const tally = {}
  for (const h of health) tally[h.status] = (tally[h.status] || 0) + 1

  const findings = []
  for (const race of plan) {
    for (const y of race.years) {
      const drifted = y.status === STATUS.DRIFTED
      const broken = y.status === STATUS.BROKEN
      findings.push({
        severity: drifted || broken ? 'high' : 'medium',
        kind: drifted ? 'scraper_drifted' : broken ? 'scraper_broken' : y.status,
        subject: `${race.race} ${y.year}`,
        detail: drifted
          // Drift is the dangerous one: the site answers, so nothing errors,
          // but the runner coming back is not the one we asked for.
          ? 'Site responds but returns the wrong runner.'
          : broken
            ? 'Scraper errors or times out against the timing site.'
            : `${y.status} on ${race.platform}`,
        // Drift and errors are code repairs now: the agent can see the site
        // through trace_scraper and test a fix on a preview before it merges.
        // A manual id is still the one route with no tool behind it.
        action: y.route === 'manual-id' ? 'tier2_flag' : 'tier1_fixable',
        route: y.route,
        platform: race.platform,
      })
    }
  }

  // Per race, not per race-year: the morning report says "61 of 64 scrapers
  // working", and a race counts as working only when every year that has a
  // verdict is live. Untested races are counted apart, never as passing.
  const window = new Set(years)
  const byRace = {}
  for (const h of health) {
    if (!window.has(h.year)) continue
    const r = (byRace[h.race] ||= { live: 0, failing: 0 })
    if (h.status === STATUS.LIVE) r.live++
    if (h.status === STATUS.DRIFTED || h.status === STATUS.BROKEN) r.failing++
  }
  const raceHealth = { total: getSupportedRaces().length, passing: 0, failing: [], untested: 0 }
  for (const name of getSupportedRaces()) {
    const r = byRace[name]
    if (r?.failing) raceHealth.failing.push(name)
    else if (r?.live) raceHealth.passing++
    else raceHealth.untested++
  }

  return { years, statusTally: tally, racesConfigured: getSupportedRaces().length, raceHealth, findings }
}

/* ────────────────────────────────────────────────────────────────────────
   2b. Upcoming races: ready before race day, tested right after it
   ──────────────────────────────────────────────────────────────────────── */

/** How far ahead to look. Long enough to chase an id, short enough to matter. */
const UPCOMING_DAYS = 56
/** Orders for a race arrive in the days after it; results should be tested by then. */
const JUST_RAN_DAYS = 4

/** Config keys that hold dates, not scraper settings. */
const DATE_KEYS = new Set(['raceDates', 'raceDateSources', 'raceDatesWeekdayExceptions'])

/**
 * Does the config carry what the scraper needs for this year?
 *
 * Platforms key years differently - eventIds, eventCodes, subEventIds - and
 * some build the URL from the year and need nothing. So: every year-keyed
 * setting that last year's race had, this year's must have too. A config with
 * no year-keyed settings at all is a pattern config and is always ready.
 */
export function yearConfigured(config, year) {
  const yearKeyed = Object.entries(config || {}).filter(([key, value]) =>
    !DATE_KEYS.has(key) && value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).some(k => /^\d{4}$/.test(k)))
  const relevant = yearKeyed.filter(([, value]) => value[year - 1] !== undefined)
  const fields = relevant.length ? relevant : yearKeyed
  if (!fields.length) return true
  return fields.every(([, value]) => value[year] !== undefined)
}

const shortDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

async function upcomingRaceCheck() {
  await ensureOverridesLoaded()
  const now = new Date()
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  const thisYear = today.getUTCFullYear()
  const summaries = getRaceConfigSummaries([thisYear, thisYear + 1])
  const health = await prisma.scraperHealth.findMany()
  const statusOf = (race, year) => health.find(h => h.race === race && h.year === year)?.status || null

  const findings = []
  const upcoming = []

  for (const cfg of summaries) {
    for (const [yearKey, value] of Object.entries(cfg.raceDates || {})) {
      if (!value) continue
      // Summaries carry a Date or an ISO timestamp; only the calendar day matters.
      const iso = (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10)
      const year = Number(yearKey)
      const daysOut = Math.round((Date.parse(`${iso}T00:00:00Z`) - today.getTime()) / DAY)

      // Just ran: shoppers are ordering now, so the scraper has to find
      // this year's finishers, not just last year's.
      if (daysOut < 0 && daysOut >= -JUST_RAN_DAYS) {
        const status = statusOf(cfg.raceName, year)
        if (status !== STATUS.LIVE) {
          findings.push({
            severity: 'high',
            kind: 'race_results_untested',
            subject: `${cfg.raceName} ${year}`,
            detail: `Ran ${shortDate(iso)}. Orders are coming in and this year's results have not been tested yet (${status || 'never probed'}).`,
            action: 'tier1_fixable',
            platform: cfg.platform,
          })
        }
        continue
      }
      if (daysOut < 0 || daysOut > UPCOMING_DAYS) continue

      const problems = []
      let config = null
      try {
        config = getScraperForRace(cfg.raceName, year).config
      } catch (err) {
        problems.push(`scraper will not build for ${year}: ${err.message}`)
      }
      if (config && !yearConfigured(config, year)) problems.push(`no ${year} event id yet`)
      const last = statusOf(cfg.raceName, year - 1)
      if (last === STATUS.DRIFTED || last === STATUS.BROKEN) problems.push(`scraper failing on last year's results (${year - 1})`)
      else if (last !== STATUS.LIVE) problems.push(`scraper not yet tested on last year's results (${year - 1})`)

      upcoming.push({ race: cfg.raceName, year, date: iso, daysOut, ready: !problems.length, problems })
      if (!problems.length) continue
      findings.push({
        severity: daysOut <= 14 ? 'high' : 'medium',
        kind: 'race_not_ready',
        subject: `${cfg.raceName} ${year}`,
        detail: `Runs ${shortDate(iso)} (${daysOut} day${daysOut === 1 ? '' : 's'}): ${problems.join('; ')}.`,
        action: 'tier1_fixable',
        daysOut,
        problems,
        platform: cfg.platform,
      })
    }
  }

  upcoming.sort((a, b) => a.daysOut - b.daysOut)
  return { upcoming, findings }
}

/* ────────────────────────────────────────────────────────────────────────
   3. Race dates
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Race years with open orders whose date or weather is not fit to print. The
 * automated renderer waits on these, so each one is a print nobody is making.
 * The routine fixes dates itself with verify_race_date (with a source) and
 * reports what it could not settle.
 */
async function printDataCheck() {
  const { races, missingRaceRows } = await verificationOverview()
  const findings = []
  for (const r of races.filter(x => x.openOrders > 0 && x.blockers.length).sort((a, b) => b.openOrders - a.openOrders)) {
    const future = r.blockers.length === 1 && r.blockers[0] === 'Race has not happened yet'
    if (future) continue
    findings.push({
      severity: r.openOrders >= 5 ? 'high' : 'medium',
      kind: 'print_data_blocked',
      subject: `${r.raceName} ${r.year}`,
      detail: `${r.openOrders} open order${r.openOrders === 1 ? '' : 's'} cannot be rendered: ${r.blockers.join('; ')}.`,
      action: 'tier1_fixable',
      raceId: r.id,
    })
  }
  for (const m of missingRaceRows) {
    findings.push({ severity: 'medium', kind: 'print_data_blocked', subject: `${m.raceName} ${m.year}`, detail: `${m.openOrders} open order${m.openOrders === 1 ? '' : 's'} and no race row at all: no date, no weather.`, action: 'tier1_fixable' })
  }
  return findings
}

async function raceDateCheck() {
  const years = coveredYears()
  const configs = getRaceConfigSummaries(years)
  const findings = []

  // Which race-years have no verified date. There is no computed fallback any
  // more, so these now resolve to no date at all rather than to a rule's guess
  // - the rules moved with the races and were wrong silently (Sydney shifted
  // to late August in 2025 and its rule was three weeks off for years). A gap
  // here is real work: the order shows no date and no weather until it is
  // filled in.
  const verified = getVerifiedRaceDates()

  // A date somebody typed into the tool counts as settled.
  //
  // Nobody enters a race date on a hunch - they look it up on the results site
  // and copy it - so a manual entry is as good a source as a config pin, and
  // better than a scrape we cannot re-check. Asking again for a year Eli has
  // already answered is how a report trains people to ignore it.
  //
  // Deliberately keyed on raceDateSource rather than on "has a date at all":
  // rows written before the computed rules were removed still hold values
  // those rules produced, and those are exactly the ones worth re-asking about.
  const settledRows = await prisma.race.findMany({
    where: { raceDateSource: { in: ['manual', 'scraped'] } },
    select: { raceName: true, year: true },
  })
  const settled = new Set(settledRows.map(r => `${r.raceName}|${r.year}`))

  // A race-year somebody has actually ordered is blocking a print right now.
  // One nobody has ordered is backlog worth filling ahead of time, but it is
  // not the same job, and reporting them at the same volume buries the first
  // in the second.
  const withOrders = await prisma.race.findMany({
    where: { runnerResearch: { some: {} } },
    select: { raceName: true, year: true },
  })
  const ordered = new Set(withOrders.map(r => `${r.raceName}|${r.year}`))

  for (const cfg of configs) {
    const pinned = verified[cfg.raceName] || {}
    const missing = years.filter(y => !pinned[y] && !settled.has(`${cfg.raceName}|${y}`))
    if (!missing.length) continue

    const blocking = missing.filter(y => ordered.has(`${cfg.raceName}|${y}`))
    const ahead = missing.filter(y => !ordered.has(`${cfg.raceName}|${y}`))

    if (blocking.length) {
      findings.push({
        severity: 'high',
        kind: 'race_date_missing',
        subject: cfg.raceName,
        detail: `No verified date for ${blocking.join(', ')}, and there are orders on those years - they show no date and no weather until it is filled in.`,
        action: 'tier1_fixable',
        years: blocking,
      })
    }
    if (ahead.length) {
      findings.push({
        severity: 'medium',
        kind: 'race_date_missing',
        subject: cfg.raceName,
        detail: `No verified date for ${ahead.join(', ')}. No orders yet, so this is worth filling before one arrives.`,
        action: 'tier1_fixable',
        years: ahead,
      })
    }
  }

  // A race whose date has passed while its orders still say "not run yet".
  // Nothing re-researches these on its own, so they sit forever.
  const staleFuture = await prisma.runnerResearch.findMany({
    where: { researchStatus: 'race_not_run' },
    include: { race: { select: { raceName: true, year: true, raceDate: true } },
               order: { select: { orderNumber: true, status: true } } },
  })
  for (const r of staleFuture) {
    if (!r.race?.raceDate || r.order?.status === 'completed') continue
    if (r.race.raceDate.getTime() < Date.now() - days(2)) {
      findings.push({
        severity: 'high',
        kind: 'race_run_but_not_researched',
        subject: `${r.race.raceName} ${r.race.year}`,
        detail: `Order ${r.order.orderNumber} still says "race not run yet" but the race was ${r.race.raceDate.toISOString().slice(0, 10)}.`,
        action: 'tier0_auto',
      })
    }
  }

  // Past races with no weather. The poster needs it and nothing retries.
  const noWeather = await prisma.race.findMany({
    where: { weatherTemp: null, raceDate: { lt: new Date() } },
    select: { raceName: true, year: true, raceDate: true, location: true, _count: { select: { runnerResearch: true } } },
  })
  for (const race of noWeather.filter(r => r._count.runnerResearch > 0)) {
    findings.push({
      severity: 'medium',
      kind: 'missing_weather',
      subject: `${race.raceName} ${race.year}`,
      detail: `${race._count.runnerResearch} order(s) reference this race and it has no weather.`,
      action: 'tier0_auto',
    })
  }

  return { racesChecked: configs.length, findings }
}

/* ────────────────────────────────────────────────────────────────────────
   6. What already alerted
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The failures that have already pinged Slack.
 *
 * These used to ping Matt in real time; since 2026-10-26 they do not (only a
 * storefront outage does, lookupObservability.js), and this check is where
 * they land instead. Three kinds: the Instant Lookup error, when a shopper's lookup hits a timing site
 * that is down or too slow, and "year not configured", when a scraper exists
 * but that year's event IDs were never added. Both are exactly the kind of
 * thing this sweep is for, and both were invisible to it.
 *
 * Neither needs new plumbing. The lookup errors are already rows in LookupLog,
 * and the config gaps are already RunnerResearch rows with researchStatus
 * 'year_not_configured'. This check reads what is there rather than trying to
 * catch the alert as it goes past.
 *
 * A shopper-facing failure outranks an internal one. A lookup error happens on
 * the storefront, to somebody deciding whether to buy; a missing year stalls an
 * order Eli can still finish by hand.
 */
async function alertedFailureCheck() {
  const findings = []
  const since = new Date(Date.now() - days(7))

  // Shoppers only. Local and internal traffic is logged to the same table, and
  // counting it turns our own testing into a customer-facing incident: a run of
  // Sydney lookups from a dev machine showed up as "11 of 17 storefront lookups
  // failed (65%)" for a race that is not even in the public lookup. The whole
  // point of this finding is that a real person hit it before buying.
  //
  // anonIp keeps the first two IPv6 groups, so ::1 lands as "::…".
  const notLocal = { ip: { notIn: ['::…', '', 'unknown'] } }

  // ── Instant Lookup errors, from the log the endpoint already writes ──
  const lookupRows = await prisma.lookupLog.groupBy({
    by: ['race', 'outcome'],
    where: { createdAt: { gte: since }, outcome: { in: ['upstream_error'] }, ...notLocal },
    _count: { _all: true },
  })

  // Total lookups per race over the same window, so one failure inside a
  // hundred good ones does not read the same as five out of five.
  const totals = await prisma.lookupLog.groupBy({
    by: ['race'],
    where: { createdAt: { gte: since }, ...notLocal },
    _count: { _all: true },
  })
  const totalFor = race => totals.find(t => t.race === race)?._count._all || 0

  for (const row of lookupRows) {
    if (!row.race) continue
    const failed = row._count._all
    const total = totalFor(row.race)
    const pct = total ? Math.round((failed / total) * 100) : 100
    findings.push({
      severity: pct >= 50 || failed >= 5 ? 'high' : 'medium',
      kind: 'lookup_failing',
      subject: row.race,
      detail: `${failed} of ${total} storefront lookups failed in the last 7 days (${pct}%). Shoppers hit this before they buy.`,
      action: 'investigate',
    })
  }

  // ── Years a scraper covers in principle but not in practice ──
  const notConfigured = await prisma.runnerResearch.findMany({
    where: { researchStatus: 'year_not_configured' },
    include: {
      race: { select: { raceName: true, year: true } },
      order: { select: { orderNumber: true, status: true } },
    },
  })

  // One finding per race-year, not per stuck order: adding the event IDs once
  // clears every order behind it.
  const byRaceYear = new Map()
  for (const r of notConfigured) {
    // Before 2020 is researched by hand, never scraped (CLAUDE.md), so a gap there is not a finding.
    if (!r.race || r.race.year < 2020) continue
    const key = `${r.race.raceName}|${r.race.year}`
    if (!byRaceYear.has(key)) {
      byRaceYear.set(key, { raceName: r.race.raceName, year: r.race.year, open: 0 })
    }
    if (r.order && r.order.status !== 'completed') byRaceYear.get(key).open++
  }

  for (const entry of byRaceYear.values()) {
    const open = entry.open
    findings.push({
      severity: open > 0 ? 'high' : 'low',
      kind: 'year_not_configured',
      subject: `${entry.raceName} ${entry.year}`,
      detail: open > 0
        ? `The scraper exists but ${entry.year} event IDs are missing, and ${open} open order${open === 1 ? '' : 's'} cannot be looked up until they are added.`
        : `The scraper exists but ${entry.year} event IDs are missing. No open orders, so this is groundwork.`,
      action: 'tier1_fixable',
      years: [entry.year],
    })
  }

  // ── Open orders for a race with no scraper at all ──
  // Research throws before it writes anything for these, so they are read off
  // the open orders. One finding per race.
  await ensureOverridesLoaded()
  const open = await prisma.order.findMany({
    where: { status: { not: 'completed' }, trackstarOrderType: { notIn: ['custom', 'sample', 'race_partner'] }, raceYear: { gte: 2020 } },
    select: { raceName: true, raceNameOverride: true },
  })
  const noScraper = new Map()
  for (const o of open) {
    const name = o.raceNameOverride || o.raceName
    // Non-race products (the Catch Me If You Can apple posters) carry their product title as the race.
    if (!name || /framed poster/i.test(name) || hasScraperForRace(name)) continue
    noScraper.set(name, (noScraper.get(name) || 0) + 1)
  }
  for (const [race, n] of noScraper) {
    findings.push({
      severity: 'medium',
      kind: 'no_scraper',
      subject: race,
      detail: `${n} open order${n === 1 ? '' : 's'} for a race with no scraper. Add one (add-race-scraper) or an alias if it is a known race under another name; otherwise it is researched by hand.`,
      action: 'investigate',
    })
  }

  return {
    findings,
    stats: { lookupErrorRaces: lookupRows.length, unconfiguredYears: byRaceYear.size, racesWithoutScraper: noScraper.size },
  }
}


/* ────────────────────────────────────────────────────────────────────────
   4. Order red flags - concrete only
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Order red flags, restricted to things that are OUR system misbehaving.
 *
 * Not a workload report. A custom order running late is a real problem and it
 * belongs on a different screen - putting it here buries the technical
 * findings under things Dan already knows about. Everything below is a fact
 * about our data or our pipeline being wrong, and each one has an order number
 * attached. No heuristics, no "this looks unusual".
 */

/** Overall pace implied by a finish time over a distance, as "M:SS". */
function pacePerMile(timeStr, distanceMiles) {
  const parts = String(timeStr || '').split(':').map(Number)
  if (parts.some(Number.isNaN) || parts.length < 2 || !distanceMiles) return null
  const secs = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1]
  if (!secs) return null
  const perMile = secs / distanceMiles
  return `${Math.floor(perMile / 60)}:${String(Math.round(perMile % 60)).padStart(2, '0')}`
}

/** Seconds between two "M:SS" paces, for tolerance comparison. */
function paceGapSeconds(a, b) {
  const toSecs = p => { const [m, s] = String(p).split(':').map(Number); return (m * 60) + (s || 0) }
  if (!a || !b) return null
  return Math.abs(toSecs(a) - toSecs(b))
}

async function orderCheck() {
  const findings = []
  const open = await prisma.order.findMany({
    where: { status: { not: 'completed' } },
    include: {
      runnerResearch: { orderBy: { id: 'desc' }, take: 1 },
    },
  })

  const summaries = getRaceConfigSummaries([])
  const distanceFor = name => summaries.find(c => c.raceName === name)?.distanceMiles || 26.2

  for (const o of open) {
    const research = o.runnerResearch[0]
    const customerSupplied = Boolean(o.customerFinishTime || o.customerBib)

    // We scraped over data the customer already gave us. Wasted work at best,
    // and on a common surname it returns strangers and parks the order in the
    // queue looking unresolved when nothing was missing.
    if (customerSupplied && research && !['found'].includes(research.researchStatus)) {
      findings.push({ severity: 'high', kind: 'researched_over_customer_data', subject: o.orderNumber,
        detail: `Customer gave bib ${o.customerBib || '-'} / time ${o.customerFinishTime || '-'}, but research is "${research.researchStatus}". Their numbers should have been used as-is.`,
        action: 'tier0_auto' })
    }

    // Candidates offered under a "pick one" banner where none is actually this
    // runner. Accepting one prints a stranger's time on the poster.
    const matches = Array.isArray(research?.possibleMatches) ? research.possibleMatches : []
    if (matches.length) {
      const want = String(o.runnerName || '').toLowerCase().split(/\s+/).filter(Boolean)
      const anyReal = matches.some(m => {
        const got = String(m?.name || '').toLowerCase()
        return want.length > 1 && want.every(t => got.includes(t))
      })
      if (!anyReal) {
        findings.push({ severity: 'high', kind: 'suggestions_presented_as_matches', subject: o.orderNumber,
          detail: `${matches.length} candidate(s) offered for "${o.runnerName}" and none carries that name. These are near-name suggestions, not matches.`,
          action: 'tier2_flag' })
      }
    }

    // Stored pace that does not equal time over distance. This is the Army
    // Ten-Miler bug: a split distance in feet read as metres produced a
    // 2:54/mi pace on a ten-mile race. It looked like a number, so nothing
    // complained.
    if (research?.officialTime && research?.officialPace) {
      const expected = pacePerMile(research.officialTime, distanceFor(o.raceName))
      const gap = paceGapSeconds(expected, research.officialPace)
      if (gap !== null && gap > 20) {
        findings.push({ severity: 'high', kind: 'pace_inconsistent_with_time', subject: o.orderNumber,
          detail: `${o.raceName}: stored ${research.officialTime} @ ${research.officialPace}/mi, but that time over the configured distance is ${expected}/mi.`,
          action: 'tier2_flag' })
      }
    }

    // A photo order reaching production without the photo confirmed placed
    // means the completion gate was bypassed. Reprint and refund territory.
    if (o.photoPath && !o.photoPlacedAt && o.designStatus === 'sent_to_production') {
      findings.push({ severity: 'high', kind: 'photo_gate_bypassed', subject: o.orderNumber,
        detail: 'Sent to production carrying a customer photo that was never confirmed as placed.', action: 'tier2_flag' })
    }

    // Nothing will ever produce data for this order on its own.
    if (!research && !customerSupplied && o.trackstarOrderType === 'standard') {
      findings.push({ severity: 'medium', kind: 'no_runner_data', subject: o.orderNumber,
        detail: `${o.raceName} ${o.raceYear}: no research record and no customer-entered time or bib.`, action: 'tier2_flag' })
    }
  }

  return { openOrders: open.length, findings }
}

/* ────────────────────────────────────────────────────────────────────────
   5. Commercial signals
   ──────────────────────────────────────────────────────────────────────── */

async function commerceCheck() {
  const findings = []

  // A discount code we have not seen before is usually a new charity or race
  // partner, which usually means a co-branded design nobody has been told
  // about yet.
  // Codes ride inside shopifyOrderData rather than a column, so this reads the
  // JSON the same way the orders endpoint does.
  const codesOf = o => (o?.shopifyOrderData?.discount_codes || [])
    .map(c => (typeof c?.code === 'string' ? c.code.trim() : ''))
    .filter(Boolean)

  const since = new Date(Date.now() - days(2))
  const recent = await prisma.order.findMany({
    where: { createdAt: { gte: since } },
    select: { orderNumber: true, shopifyOrderData: true },
  })
  const older = await prisma.order.findMany({
    where: { createdAt: { lt: since } },
    select: { shopifyOrderData: true },
  })
  const known = new Set(older.flatMap(codesOf))
  const seen = new Set()
  for (const o of recent) {
    for (const code of codesOf(o)) {
      if (known.has(code) || seen.has(code)) continue
      seen.add(code)
      findings.push({ severity: 'medium', kind: 'new_discount_code', subject: code,
        detail: `First seen on order ${o.orderNumber}. If this is a partner, the print may need a co-branded version.`,
        action: 'tier2_flag' })
    }
  }

  return { newCodes: seen.size, findings }
}

/* ────────────────────────────────────────────────────────────────────────
   Report
   ──────────────────────────────────────────────────────────────────────── */

/**
 * A stable identity for a finding, so tonight's report can be compared with
 * last night's. Deliberately excludes the detail text: the same problem should
 * not read as "new" because a day count inside the sentence moved.
 */
function fingerprint(f) {
  return `${f.kind}::${f.subject}`
}

const LAST_REPORT_KEY = 'nightly_sweep_last'

/** Where the finished, human-readable report is parked for the morning email. */
export const NIGHTLY_REPORT_KEY = 'nightly_sweep_report'

/**
 * What changed since last night.
 *
 * A nightly report of 200 standing findings is a report nobody reads by the
 * third night. Almost all of that is backlog - 123 race-years that have never
 * been probed do not become news by being counted again. What deserves
 * attention is what appeared today and what disappeared today, so the report
 * leads with those and keeps the standing total as a number.
 */
async function withDelta(report, { persist = true } = {}) {
  let previous = null
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: LAST_REPORT_KEY } })
    previous = row?.value ? JSON.parse(row.value) : null
  } catch (error) {
    console.warn('[nightlySweep] could not read the previous report:', error.message)
  }

  const now = new Set(report.findings.map(fingerprint))

  // When each open finding was first seen, carried forward night to night.
  //
  // Age is the difference between "Tokyo 2025 drifted" and "Tokyo 2025 has
  // been drifted for six weeks and two attempts have failed". The first reads
  // the same on night 1 and night 40; the second tells you nobody is going to
  // fix this without a decision. Without it the report cannot tell a fresh
  // problem from a permanent one, and everything gets the same weight.
  //
  // Older snapshots stored a bare fingerprint array. Those get dated to the
  // snapshot itself, so ages start accruing from the last run rather than
  // resetting the whole board to "new tonight".
  const previousFirstSeen = previous?.firstSeen
    || Object.fromEntries((previous?.fingerprints || []).map(fp => [fp, previous?.finishedAt]))

  const firstSeen = {}
  for (const f of report.findings) {
    const fp = fingerprint(f)
    firstSeen[fp] = previousFirstSeen[fp] || report.finishedAt
    f.firstSeenAt = firstSeen[fp]
    f.nightsOpen = Math.max(
      0,
      Math.round((Date.parse(report.finishedAt) - Date.parse(firstSeen[fp])) / 86400000)
    )
  }

  const before = new Set(Object.keys(previousFirstSeen))

  report.delta = {
    hasBaseline: Boolean(previous),
    previousAt: previous?.finishedAt || null,
    new: report.findings.filter(f => !before.has(fingerprint(f))),
    // Gone since last night. Usually something got fixed, which is worth
    // saying out loud - a report that only ever grows teaches you to ignore it.
    resolved: [...before].filter(fp => !now.has(fp)),
    unchanged: report.findings.filter(f => before.has(fingerprint(f))).length,
  }

  if (!persist) return report

  try {
    const snapshot = JSON.stringify({
      finishedAt: report.finishedAt,
      firstSeen,
    })
    await prisma.systemConfig.upsert({
      where: { key: LAST_REPORT_KEY },
      create: { key: LAST_REPORT_KEY, value: snapshot },
      update: { value: snapshot },
    })
  } catch (error) {
    // Losing the snapshot costs tomorrow's delta, not tonight's report.
    console.warn('[nightlySweep] could not store tonight\'s snapshot:', error.message)
  }

  return report
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.persistBaseline=true] - false for a dry run: the
 *   delta is still COMPUTED against last night, it just does not become the
 *   new baseline. Skipping the computation instead made a dry run report
 *   "0 new" alongside "first run", which is two contradictory things at once.
 */
/**
 * Combine the before-fixes and after-fixes passes into one story.
 *
 * The agent runs the sweep, fixes what it may, then runs it again. Comparing
 * the two passes is how "what got fixed" is established, and it matters that
 * it works this way round: the agent does not get to TELL us what it fixed,
 * we check. A fix that did not actually clear the finding shows up as still
 * outstanding, which is exactly what you want at 1am with nobody watching.
 *
 * @param {Object} before - the sweep as it stood at the start of the run
 * @param {Object} after  - the sweep re-run once the fixes were applied
 */
export function combineSweepPasses(before, after) {
  const key = f => `${f.kind}::${f.subject}`
  const afterKeys = new Set(after.findings.map(key))

  // Present at the start, gone at the end: fixed during this run.
  const fixed = before.findings.filter(f => !afterKeys.has(key(f)))

  // Present at the end but not at the start. Usually a fix that exposed a
  // fresh problem, and always worth surfacing rather than quietly folding
  // into the backlog.
  const beforeKeys = new Set(before.findings.map(key))
  const introduced = after.findings.filter(f => !beforeKeys.has(key(f)))

  return {
    startedAt: before.startedAt,
    finishedAt: after.finishedAt,
    healthy: before.healthy && after.healthy,
    failedChecks: [...before.failedChecks, ...after.failedChecks],
    // What tonight's sweep turned up that yesterday's did not.
    found: before.delta?.new || [],
    fixed,
    introduced,
    // Still standing once the fixes were done. This is the "needs attention"
    // list, and the hope is that it is short. Each finding carries nightsOpen,
    // which is what lets the report separate a fresh problem from a permanent
    // one instead of printing both at the same volume.
    remaining: after.findings,
    // Night-over-night movement. Distinct from `fixed`, which is only what
    // this run's own repairs cleared: date commits deploy after the run ends,
    // so they show up here on the following night and nowhere else.
    delta: after.delta,
    stats: after.stats,
    counts: {
      found: (before.delta?.new || []).length,
      fixed: fixed.length,
      introduced: introduced.length,
      remaining: after.findings.length,
      remainingHigh: after.findings.filter(f => f.severity === 'high').length,
    },
  }
}

export async function runNightlySweep({ persistBaseline = true } = {}) {
  const startedAt = new Date()

  const checks = [
    await check('catalog', catalogCheck),
    await check('scrapers', scraperCheck),
    await check('upcoming', upcomingRaceCheck),
    await check('race_dates', raceDateCheck),
    await check('print_data', printDataCheck),
    await check('orders', orderCheck),
    await check('commerce', commerceCheck),
    await check('alerted_failures', alertedFailureCheck),
  ]

  const findings = checks.flatMap(c => (c.findings || []).map(f => ({ ...f, check: c.name })))
  const failed = checks.filter(c => !c.ok)

  const bySeverity = { high: 0, medium: 0, low: 0 }
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1

  const byAction = {}
  for (const f of findings) byAction[f.action] = (byAction[f.action] || 0) + 1

  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    // A sweep that could not complete every check is NOT a clean sweep, and
    // says so loudly rather than reporting the subset it managed.
    healthy: failed.length === 0,
    failedChecks: failed.map(c => ({ name: c.name, error: c.error })),
    summary: {
      findings: findings.length,
      bySeverity,
      byAction,
      ...Object.fromEntries(checks.map(c => [c.name, { ok: c.ok, ms: c.ms }])),
    },
    stats: Object.fromEntries(
      checks.map(c => {
        const { name, ok, ms, findings: _f, error: _e, ...rest } = c
        return [name, rest]
      })
    ),
    findings,
  }

  return await withDelta(report, { persist: persistBaseline })
}
