/**
 * Forecast: the next 13 weeks of orders, revenue and contribution margin,
 * and the cash that leaves the bank, from the race calendar and our own
 * order history. docs/finance-panel-plan.md, Phase 3.
 *
 * Revenue
 *   Trackstar's revenue is a calendar of races. Each race on the calendar
 *   (the Race table, with a date) expects last year's orders for that race
 *   times a growth factor, less what has already come in this year. Those
 *   orders are spread over the days around race day the way our orders
 *   actually arrive (an empirical curve from 30 days before to 60 after,
 *   built from the last year of orders). On top of that, a baseline: the
 *   orders per day that no race window explains. Orders times revenue per
 *   order is revenue; costs and ad spend follow the trailing ratios.
 *
 *   Order counts are distinct Shopify/Etsy orders in the Order table
 *   (standard and custom prints; bulk and samples are left out). Revenue per
 *   order is the ledger's revenue over those orders, so the two line up.
 *
 * Cash
 *   Opening balance is what Matt types per bank. Each week: revenue less
 *   fees, production and shipping, less ad spend, hours, customs and the
 *   designer fee (paid the first week after a month ends), race partner
 *   payouts on their due date, fixed costs and owner draws. The lowest week
 *   and any week under the buffer are called out.
 *
 * Drivers are computed from the data and can be overridden per scenario
 * (base, upside, downside); a single race's expected orders can be set by
 * hand. All of it is kept in SystemConfig `finance_forecast`. Money is cents.
 */
import prisma from '../../db.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { loadRules, ruleFor } from './rules.js'
import { summarize, computeDay } from './scoreboard.js'
import { rowsBetween } from './ledger.js'
import { todayET, addDays, daysBetween, mondayOf, monthOf, lastOfMonth, monthLabel, shiftMonth, isValidMonth } from './periods.js'

export class ForecastError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const HORIZON_WEEKS = 13
export const BEFORE = 30
export const AFTER = 60
const KEY = 'finance_forecast'
export const SCENARIOS = ['base', 'upside', 'downside']
const SCENARIO_GROWTH = { base: 1, upside: 1.2, downside: 0.8 }

/** The drivers, in the order the page shows them, with what each one means. */
export const DRIVERS = [
  { key: 'growth', label: 'Race demand vs last year', unit: 'x', help: 'Last year\'s orders for each race, times this' },
  { key: 'baselinePerDay', label: 'Baseline orders per day', unit: 'orders', help: 'Orders no race window explains' },
  { key: 'revenuePerOrderCents', label: 'Revenue per order', unit: 'cents', help: 'Ledger revenue over tracked orders, last 28 days' },
  { key: 'cogsPct', label: 'Fees, production and shipping', unit: '%', help: 'Share of revenue, last 28 days' },
  { key: 'adSpendPerWeekCents', label: 'Ad spend per week', unit: 'cents', help: 'Meta and Google, average of the last 4 weeks' },
  { key: 'hoursPerWeekCents', label: 'Hours per week', unit: 'cents', help: 'Logged hours at each person\'s rate, last 4 weeks' },
  { key: 'customsPerMonthCents', label: 'Customs per month', unit: 'cents', help: 'Paid to designers, last closed month' },
]

// ── settings ────────────────────────────────────────────────────────────────

const EMPTY = { scenarios: { base: {}, upside: {}, downside: {} }, raceOverrides: {}, banks: [], bufferCents: 0, fixedCosts: [], ownerDrawMonthlyCents: 0, targets: {} }

export async function loadSettings() {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } })
  let v = {}
  try { v = row?.value ? JSON.parse(row.value) : {} } catch { v = {} }
  return { ...EMPTY, ...v, scenarios: { ...EMPTY.scenarios, ...(v.scenarios || {}) } }
}
async function saveSettings(next) {
  const value = JSON.stringify(next)
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } })
  return next
}

const isCents = v => Number.isInteger(v) && Math.abs(v) < 1e12
const DRIVER_KEYS = new Set(DRIVERS.map(d => d.key))

/** Set or clear (null) one scenario's override of a driver. */
export async function setDriver(scenario, key, value) {
  if (!SCENARIOS.includes(scenario)) throw new ForecastError('Unknown scenario')
  if (!DRIVER_KEYS.has(key)) throw new ForecastError('Unknown driver')
  const s = await loadSettings()
  const sc = { ...(s.scenarios[scenario] || {}) }
  if (value === null || value === undefined || value === '') delete sc[key]
  else {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new ForecastError('That is not a usable number')
    sc[key] = key.endsWith('Cents') ? Math.round(n) : n
  }
  return saveSettings({ ...s, scenarios: { ...s.scenarios, [scenario]: sc } })
}

/** Expected orders for one race this year, typed by hand; null goes back to the calculation. */
export async function setRaceOverride(raceKey, orders) {
  const s = await loadSettings()
  const ov = { ...s.raceOverrides }
  if (orders === null || orders === undefined || orders === '') delete ov[raceKey]
  else {
    const n = Math.round(Number(orders))
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new ForecastError('Orders must be a whole number')
    ov[raceKey] = n
  }
  return saveSettings({ ...s, raceOverrides: ov })
}

/** The cash side: bank balances (typed), the buffer, fixed costs and owner draws. */
export async function setCash({ banks, bufferCents, fixedCosts, ownerDrawMonthlyCents }) {
  const s = await loadSettings()
  const next = { ...s }
  if (banks !== undefined) {
    if (!Array.isArray(banks) || banks.length > 20) throw new ForecastError('banks must be a list')
    next.banks = banks.map(b => ({ name: String(b.name || 'Bank').trim().slice(0, 60) || 'Bank', cents: Number(b.cents), asOf: /^\d{4}-\d{2}-\d{2}$/.test(String(b.asOf || '')) ? b.asOf : todayET() }))
    if (next.banks.some(b => !isCents(b.cents))) throw new ForecastError('Each balance must be whole cents')
  }
  if (bufferCents !== undefined) { if (!isCents(Number(bufferCents)) || bufferCents < 0) throw new ForecastError('The buffer must be whole cents'); next.bufferCents = Number(bufferCents) }
  if (fixedCosts !== undefined) {
    if (!Array.isArray(fixedCosts) || fixedCosts.length > 50) throw new ForecastError('fixedCosts must be a list')
    next.fixedCosts = fixedCosts.map(c => ({ name: String(c.name || 'Cost').trim().slice(0, 60) || 'Cost', cents: Number(c.cents), cadence: c.cadence === 'weekly' ? 'weekly' : 'monthly' }))
    if (next.fixedCosts.some(c => !isCents(c.cents) || c.cents < 0)) throw new ForecastError('Each cost must be whole cents')
  }
  if (ownerDrawMonthlyCents !== undefined) { if (!isCents(Number(ownerDrawMonthlyCents)) || ownerDrawMonthlyCents < 0) throw new ForecastError('Owner draws must be whole cents'); next.ownerDrawMonthlyCents = Number(ownerDrawMonthlyCents) }
  return saveSettings(next)
}

/** A month's targets (revenue, contribution margin, ad spend); all null clears it. */
export async function setTarget(month, { revenueCents = null, cmCents = null, adSpendCents = null } = {}) {
  if (!isValidMonth(month)) throw new ForecastError('month must be YYYY-MM')
  const vals = { revenueCents, cmCents, adSpendCents }
  for (const [k, v] of Object.entries(vals)) if (v !== null && (!isCents(Number(v)) || v < 0)) throw new ForecastError(`${k} must be whole cents`)
  const s = await loadSettings()
  const targets = { ...s.targets }
  if (Object.values(vals).every(v => v === null)) delete targets[month]
  else targets[month] = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v === null ? null : Number(v)]))
  return saveSettings({ ...s, targets })
}

// ── the history ─────────────────────────────────────────────────────────────

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** One key per race, whatever the product or Race row calls it. */
export function raceKey(name) {
  let canonical = null
  try { canonical = getCanonicalRaceName(name) } catch { canonical = null }
  return norm(canonical || name)
}
const etDay = d => todayET(new Date(d))
const dayOf = d => new Date(d).toISOString().slice(0, 10)

/**
 * Orders by race and year, the arrival curve and the baseline, from the
 * Order table and the race calendar. Pure over its inputs (tested).
 */
export function readHistory({ orders, races, today }) {
  const dateOf = new Map()
  for (const r of races) if (r.raceDate) dateOf.set(`${raceKey(r.raceName)}|${r.year}`, dayOf(r.raceDate))
  const byRaceYear = new Map()      // key|year -> Set of order numbers in the window
  const receivedSoFar = new Map()   // key|year -> Set, any time (for this year's count)
  const curveCounts = new Map()     // offset -> count, from complete windows
  const raceOrderDays = new Set()   // order number|day that a race window explains
  const seen = new Set()
  for (const o of orders) {
    const num = String(o.parentOrderNumber || o.orderNumber || '')
    if (!num) continue
    const day = etDay(o.createdAt)
    const k = raceKey(o.raceName)
    const ry = `${k}|${o.raceYear}`
    if (!receivedSoFar.has(ry)) receivedSoFar.set(ry, new Set())
    receivedSoFar.get(ry).add(num)
    const D = dateOf.get(ry)
    if (!D) continue
    const off = daysBetween(D, day)
    if (off < -BEFORE || off > AFTER) continue
    if (!byRaceYear.has(ry)) byRaceYear.set(ry, new Set())
    byRaceYear.get(ry).add(num)
    raceOrderDays.add(`${num}|${day}`)
    const once = `${num}|${ry}`
    if (!seen.has(once) && addDays(D, AFTER) < today) { seen.add(once); curveCounts.set(off, (curveCounts.get(off) || 0) + 1) }
  }
  // The arrival curve: share of a race's orders on each day from -30 to +60.
  const curve = new Map()
  const total = [...curveCounts.values()].reduce((a, b) => a + b, 0)
  for (let off = -BEFORE; off <= AFTER; off++) {
    curve.set(off, total >= 50 ? (curveCounts.get(off) || 0) / total : fallbackCurve(off))
  }
  // Baseline: orders per day over the last 56 days that no race window explains.
  const from = addDays(today, -56)
  const baseOrders = new Set()
  for (const o of orders) {
    const day = etDay(o.createdAt)
    if (day < from || day >= today) continue
    const num = String(o.parentOrderNumber || o.orderNumber || '')
    if (num && !raceOrderDays.has(`${num}|${day}`)) baseOrders.add(num)
  }
  return { dateOf, byRaceYear, receivedSoFar, curve, curveFromData: total >= 50, curveOrders: total, baselinePerDay: baseOrders.size / 56 }
}

/** Before there is enough history: a rise to race day, a peak in the week after, a long tail. */
function fallbackCurve(off) {
  const w = off < 0 ? Math.max(0.2, 1 + off / BEFORE) : off <= 10 ? 3 - off * 0.15 : Math.max(0.1, 1.5 * Math.exp(-(off - 10) / 15))
  // Normalised over the window; computed once is enough for a shape this smooth.
  let sum = 0
  for (let o = -BEFORE; o <= AFTER; o++) sum += o < 0 ? Math.max(0.2, 1 + o / BEFORE) : o <= 10 ? 3 - o * 0.15 : Math.max(0.1, 1.5 * Math.exp(-(o - 10) / 15))
  return w / sum
}

/** Last year's orders against this year's, for races whose window has closed: the growth to suggest. */
export function suggestedGrowth({ history, races, today }) {
  let thisYear = 0, lastYear = 0, n = 0
  for (const r of races) {
    if (!r.raceDate) continue
    const D = dayOf(r.raceDate)
    if (addDays(D, AFTER) >= today || D < addDays(today, -300)) continue
    const k = raceKey(r.raceName)
    const now = history.byRaceYear.get(`${k}|${r.year}`)?.size || 0
    const before = history.byRaceYear.get(`${k}|${r.year - 1}`)?.size || 0
    if (!before || !now) continue
    thisYear += now; lastYear += before; n++
  }
  if (!lastYear || n < 3) return { growth: 1, races: n }
  return { growth: Math.min(5, Math.max(0.3, Math.round((thisYear / lastYear) * 100) / 100)), races: n }
}

// ── the model ───────────────────────────────────────────────────────────────

export async function forecast({ scenario = 'base', today = todayET() } = {}) {
  if (!SCENARIOS.includes(scenario)) scenario = 'base'
  const horizonStart = mondayOf(today)
  const horizonEnd = addDays(horizonStart, HORIZON_WEEKS * 7 - 1)
  const historyFrom = addDays(today, -480)
  const [settings, rules, orders, races, ledgerRows, sheets] = await Promise.all([
    loadSettings(),
    loadRules(),
    prisma.order.findMany({
      where: { createdAt: { gte: new Date(`${historyFrom}T00:00:00Z`) }, trackstarOrderType: { in: ['standard', 'custom'] } },
      select: { orderNumber: true, parentOrderNumber: true, raceName: true, raceYear: true, createdAt: true },
    }),
    prisma.race.findMany({ where: { raceDate: { gte: new Date(`${historyFrom}T00:00:00Z`), lte: new Date(`${addDays(horizonEnd, 1)}T00:00:00Z`) } }, select: { raceName: true, year: true, raceDate: true } }),
    rowsBetween(addDays(today, -120), today),
    prisma.timesheet.findMany({ where: { weekStart: { gte: addDays(horizonStart, -28), lt: horizonStart } }, include: { user: { select: { hourlyRateCents: true } }, entries: { select: { minutes: true } } } }),
  ])

  const history = readHistory({ orders, races, today })
  const growthHint = suggestedGrowth({ history, races, today })

  // Computed drivers.
  const last28 = summarize(ledgerRows.filter(r => r.day >= addDays(today, -28) && r.day < today), rules)
  const tracked28 = new Set(orders.filter(o => { const d = etDay(o.createdAt); return d >= addDays(today, -28) && d < today }).map(o => String(o.parentOrderNumber || o.orderNumber))).size
  const hoursCents = sheets.reduce((n, t) => n + Math.round((t.entries.reduce((m, e) => m + e.minutes, 0) * (t.hourlyRateCents ?? t.user.hourlyRateCents ?? 0)) / 60), 0)
  const lastMonth = shiftMonth(monthOf(today), -1)
  const lastMonthCustoms = await prisma.payoutLine.findMany({ where: { sourceRef: { startsWith: `customs:${lastMonth}:` } }, select: { amountCents: true } })
  let customsGuess = lastMonthCustoms.reduce((n, l) => n + l.amountCents, 0)
  if (!customsGuess) {
    try { const { customCounter } = await import('../orders/customCounter.js'); customsGuess = (await customCounter(lastMonth)).payoutCents } catch { customsGuess = 0 }
  }
  const computed = {
    growth: Math.round(growthHint.growth * SCENARIO_GROWTH[scenario] * 100) / 100,
    baselinePerDay: Math.round(history.baselinePerDay * 10) / 10,
    revenuePerOrderCents: tracked28 ? Math.round(last28.revenue / tracked28) : (last28.aov || 0),
    cogsPct: last28.revenue ? Math.round((last28.cogs - (last28.designerFeeBase === 'gp' ? last28.designerFee : 0)) / last28.revenue * 1000) / 10 : 35,
    adSpendPerWeekCents: Math.round(last28.adSpend / 4),
    hoursPerWeekCents: Math.round(hoursCents / 4),
    customsPerMonthCents: customsGuess,
  }
  const overrides = settings.scenarios[scenario] || {}
  const d = { ...computed, ...overrides }

  // The races: last year's orders, this year's so far, what is still to come.
  const raceList = []
  const seenRace = new Set()
  for (const r of races) {
    if (!r.raceDate) continue
    const D = dayOf(r.raceDate)
    if (D < addDays(today, -AFTER) || D > horizonEnd) continue
    const k = raceKey(r.raceName)
    const id = `${k}|${r.year}`
    if (seenRace.has(id)) continue
    seenRace.add(id)
    const lastYear = history.byRaceYear.get(`${k}|${r.year - 1}`)?.size || 0
    const received = history.receivedSoFar.get(id)?.size || 0
    const override = settings.raceOverrides[k] ?? null
    const expected = override ?? Math.round(lastYear * d.growth)
    raceList.push({ key: k, name: r.raceName, year: r.year, date: D, lastYear, received, expected, override, remaining: Math.max(0, expected - received), noHistory: !lastYear && override == null })
  }
  raceList.sort((a, b) => a.date.localeCompare(b.date))

  // Day by day: the remaining orders of each race spread over its remaining days by the curve, plus the baseline.
  const tomorrow = addDays(today, 1)
  const daily = new Map()
  for (let day = horizonStart; day <= horizonEnd; day = addDays(day, 1)) daily.set(day, { base: day >= tomorrow ? d.baselinePerDay : 0, race: 0, byRace: {} })
  for (const r of raceList) {
    if (!r.remaining) continue
    const fromOff = Math.max(-BEFORE, daysBetween(r.date, tomorrow))
    let weight = 0
    for (let off = fromOff; off <= AFTER; off++) weight += history.curve.get(off) || 0
    if (!weight) continue
    let placed = 0
    for (let off = fromOff; off <= AFTER; off++) {
      const day = addDays(r.date, off)
      const slot = daily.get(day)
      if (!slot) continue
      const n = r.remaining * (history.curve.get(off) || 0) / weight
      slot.race += n; slot.byRace[r.key] = (slot.byRace[r.key] || 0) + n; placed += n
    }
    r.inHorizon = Math.round(placed)
  }

  // The weeks: actual for days that have landed, forecast for the rest.
  const actualDays = new Map(ledgerRows.filter(x => x.day >= horizonStart).map(x => [x.day, computeDay(x, rules)]))
  const weeks = []
  for (let w = 0; w < HORIZON_WEEKS; w++) {
    const start = addDays(horizonStart, w * 7)
    const wk = { weekStart: start, weekEnd: addDays(start, 6), actual: { revenue: 0, orders: 0, cogs: 0, adSpend: 0, cm: 0, designerFee: 0 }, forecast: { revenue: 0, orders: 0, cogs: 0, adSpend: 0, cm: 0, designerFee: 0, raceOrders: 0 }, races: [] }
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i)
      const a = actualDays.get(day)
      if (day <= today) {
        if (a?.landed) for (const k of ['revenue', 'orders', 'cogs', 'adSpend', 'cm', 'designerFee']) wk.actual[k] += a[k]
        continue
      }
      const slot = daily.get(day)
      const ordersN = slot.base + slot.race
      const revenue = Math.round(ordersN * d.revenuePerOrderCents)
      const cogs = Math.round(revenue * d.cogsPct / 100)
      const ads = Math.round(d.adSpendPerWeekCents / 7)
      const fee = ruleFor(rules, 'designer_fee', day) || { pct: 7.5, base: 'cm' }
      const gp = revenue - cogs
      const feeCents = fee.base === 'gp' ? Math.round(gp * fee.pct / 100) : Math.round((gp - ads) * fee.pct / 100)
      wk.forecast.orders += ordersN; wk.forecast.raceOrders += slot.race
      wk.forecast.revenue += revenue; wk.forecast.cogs += cogs; wk.forecast.adSpend += ads; wk.forecast.designerFee += feeCents
      wk.forecast.cm += gp - ads - feeCents
    }
    wk.forecast.orders = Math.round(wk.forecast.orders); wk.forecast.raceOrders = Math.round(wk.forecast.raceOrders)
    const total = k => wk.actual[k] + wk.forecast[k]
    wk.revenue = total('revenue'); wk.orders = total('orders'); wk.cm = total('cm'); wk.adSpend = total('adSpend'); wk.cogs = total('cogs'); wk.designerFee = total('designerFee')
    wk.partial = start <= today && addDays(start, 6) > today
    wk.past = addDays(start, 6) <= today
    wk.races = raceList.filter(r => r.date >= start && r.date <= wk.weekEnd).map(r => r.name)
    weeks.push(wk)
  }

  // Months the horizon touches: actual to date plus forecast, against the target.
  const monthsTouched = [...new Set(weeks.flatMap(w => [monthOf(w.weekStart), monthOf(w.weekEnd)]))].filter(m => m >= monthOf(today)).slice(0, 4)
  const months = []
  for (const m of monthsTouched) {
    const first = `${m}-01`, last = lastOfMonth(first)
    const toDate = summarize(await rowsBetween(first, last < today ? last : today), rules)
    let fRev = 0, fCm = 0, fAds = 0, fFee = 0
    for (let day = first > tomorrow ? first : tomorrow; day <= last && day <= horizonEnd; day = addDays(day, 1)) {
      const slot = daily.get(day)
      if (!slot) continue
      const rev = Math.round((slot.base + slot.race) * d.revenuePerOrderCents)
      const cogs = Math.round(rev * d.cogsPct / 100)
      const ads = Math.round(d.adSpendPerWeekCents / 7)
      const fee = ruleFor(rules, 'designer_fee', day) || { pct: 7.5, base: 'cm' }
      const feeCents = fee.base === 'gp' ? Math.round((rev - cogs) * fee.pct / 100) : Math.round((rev - cogs - ads) * fee.pct / 100)
      fRev += rev; fAds += ads; fFee += feeCents; fCm += rev - cogs - ads - feeCents
    }
    const target = settings.targets[m] || null
    months.push({
      month: m, label: monthLabel(m), target,
      toDate: { revenue: toDate.revenue, cm: toDate.cm, adSpend: toDate.adSpend, designerFee: toDate.designerFee },
      projected: { revenue: toDate.revenue + fRev, cm: toDate.cm + fCm, adSpend: toDate.adSpend + fAds, designerFee: toDate.designerFee + fFee },
    })
  }

  // Race partner payouts: known amounts on their due date; the rest estimated from the forecast.
  const partnerOut = new Map() // weekStart -> cents
  const partners = []
  try {
    const { listRacePayouts } = await import('./racePayouts.js')
    for (const p of await listRacePayouts({ today })) {
      if (p.status === 'paid' || !p.dueDate || p.dueDate > horizonEnd) continue
      let cents = p.payoutCents
      let estimated = false
      if (cents == null) {
        const match = raceList.find(r => r.key === raceKey(p.name) && Math.abs(daysBetween(r.date, p.raceDate || r.date)) < 40)
        if (match) {
          const rev = match.expected * d.revenuePerOrderCents
          cents = p.terms.structure === 'per_order' ? match.expected * p.terms.perOrderCents : Math.round(rev * (p.terms.pct || 15) / 100)
          estimated = true
        }
      }
      if (cents == null) continue
      const when = p.dueDate < horizonStart ? horizonStart : p.dueDate
      const wkStart = mondayOf(when)
      partnerOut.set(wkStart, (partnerOut.get(wkStart) || 0) + cents)
      partners.push({ name: p.name, dueDate: p.dueDate, cents, estimated })
    }
  } catch { /* Attio off: the cash flow goes on without partner payouts, and says so */ }

  // Cash, week by week.
  const opening = settings.banks.reduce((n, b) => n + b.cents, 0)
  let balance = opening
  const cashWeeks = []
  let lowest = { cents: opening, weekStart: horizonStart }
  for (const wk of weeks) {
    const cashIn = wk.forecast.revenue
    const days = wk.past ? 0 : wk.partial ? daysBetween(today, wk.weekEnd) : 7
    const share = days / 7
    const out = { costs: wk.forecast.cogs, ads: wk.forecast.adSpend, hours: Math.round(d.hoursPerWeekCents * share), customsAndFee: 0, partners: partnerOut.get(wk.weekStart) || 0, fixed: 0, draws: 0 }
    // A month that ends before this week starts is paid out in the first week after it.
    for (let i = 0; i < 7; i++) {
      const day = addDays(wk.weekStart, i)
      if (day <= today || day.slice(8) !== '01') continue
      const ended = shiftMonth(monthOf(day), -1)
      const m = months.find(x => x.month === ended)
      out.customsAndFee += d.customsPerMonthCents + (m ? m.projected.designerFee : 0)
      out.fixed += settings.fixedCosts.filter(c => c.cadence === 'monthly').reduce((n, c) => n + c.cents, 0)
      out.draws += settings.ownerDrawMonthlyCents
    }
    out.fixed += Math.round(settings.fixedCosts.filter(c => c.cadence === 'weekly').reduce((n, c) => n + c.cents, 0) * share)
    const totalOut = Object.values(out).reduce((n, v) => n + v, 0)
    const start = balance
    balance = start + cashIn - totalOut
    cashWeeks.push({ weekStart: wk.weekStart, start, in: cashIn, out, totalOut, net: cashIn - totalOut, end: balance })
    if (balance < lowest.cents) lowest = { cents: balance, weekStart: wk.weekStart }
  }

  return {
    asOf: today, scenario, scenarios: SCENARIOS, horizon: { start: horizonStart, end: horizonEnd, weeks: HORIZON_WEEKS },
    drivers: DRIVERS.map(x => ({ ...x, value: d[x.key], computed: computed[x.key], overridden: x.key in overrides })),
    growthHint, curve: { fromData: history.curveFromData, orders: history.curveOrders },
    weeks, races: raceList, months,
    totals: {
      revenue: weeks.reduce((n, w) => n + w.revenue, 0), forecastRevenue: weeks.reduce((n, w) => n + w.forecast.revenue, 0),
      cm: weeks.reduce((n, w) => n + w.cm, 0), orders: weeks.reduce((n, w) => n + w.orders, 0),
    },
    cash: {
      opening, banks: settings.banks, bufferCents: settings.bufferCents, fixedCosts: settings.fixedCosts, ownerDrawMonthlyCents: settings.ownerDrawMonthlyCents,
      weeks: cashWeeks, lowest, weeksBelowBuffer: cashWeeks.filter(w => w.end < settings.bufferCents).length, partners, hasBalance: settings.banks.length > 0,
    },
  }
}
