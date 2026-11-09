/**
 * Is Trybe paying for itself? Week by week, the Meta ads running Trybe
 * creators' content against the rest of the Meta account.
 *
 * Both sides use Meta's own numbers (spend and purchase value), so they are
 * compared on the same basis: Trybe's API reports them per creator for the
 * ads tagged with that creator's content, and the Meta Ads tab has the
 * account. "Other ads" is the account minus the Trybe ads. Trybe's cost is
 * what the Trybe tab says it charged (creator earnings, platform fee,
 * processing), paid on top of the ad spend.
 *
 *   trybe ROAS          Meta purchase value / spend, for the Trybe ads
 *   other ROAS          the same for every other Meta ad
 *   after commission    purchase value / (spend + Trybe's cost)
 *   break-even ROAS     what the Trybe ads need to leave as much margin as
 *                       the same spend on other ads: other ROAS x GM /
 *                       (GM - cost / purchase value)
 *   vs other ads        (Trybe value - spend x other ROAS) x GM - cost: the
 *                       margin made or lost against putting that spend on the
 *                       other ads at their average. An upper bound on the loss,
 *                       since more spend there would earn a little less per
 *                       dollar; the commission alone is the lower bound.
 *
 * Weeks run Monday to Sunday. Trybe counts UTC days and the ledger Eastern
 * days, a few hours apart at each end of a week.
 */
import prisma from '../../db.js'
import { rangeTotals } from '../../services/trybe.js'
import { rowsBetween } from './ledger.js'
import { loadRules } from './rules.js'
import { summarize } from './scoreboard.js'
import { addDays, mondayOf, todayET } from './periods.js'

export const WEEKS = 8
export const FIRST_WEEK = '2026-10-05' // Trybe's first commissions were in the week of Oct 5
const CACHE_KEY = 'finance_trybe_check'
const CACHE_MS = 6 * 3600_000

const ratio = (a, b) => (b > 0 ? a / b : null)

/** One week's verdict from its sums. Pure; money in cents. */
export function weekVerdict({ trybe, meta, cost, gmPct }) {
  const otherSpend = Math.max(0, meta.spendCents - trybe.adSpendCents)
  const otherValue = Math.max(0, meta.purchaseValueCents - trybe.adPurchaseValueCents)
  const trybeRoas = ratio(trybe.adPurchaseValueCents, trybe.adSpendCents)
  const otherRoas = ratio(otherValue, otherSpend)
  const gm = gmPct != null ? gmPct / 100 : null
  const costShare = ratio(cost, trybe.adPurchaseValueCents) // commission per dollar of the ads' purchase value
  const afterRoas = ratio(trybe.adPurchaseValueCents, trybe.adSpendCents + cost)
  const breakEvenRoas = otherRoas != null && gm != null && costShare != null && gm > costShare ? (otherRoas * gm) / (gm - costShare) : null
  const vsOtherCents = otherRoas != null && gm != null && trybe.adSpendCents > 0
    ? Math.round((trybe.adPurchaseValueCents - trybe.adSpendCents * otherRoas) * gm - cost)
    : null
  const verdict = !trybe.adSpendCents && !cost ? 'quiet'
    : trybeRoas != null && breakEvenRoas != null ? (trybeRoas >= breakEvenRoas ? 'paying' : 'not_paying') : 'unknown'
  return { otherSpendCents: otherSpend, otherValueCents: otherValue, trybeRoas, otherRoas, afterRoas, breakEvenRoas, costShare, vsOtherCents, verdict }
}

async function compute(today) {
  const rules = await loadRules()
  const lastMonday = mondayOf(today)
  const weeks = []
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = addDays(lastMonday, -7 * i)
    if (start < FIRST_WEEK) continue
    weeks.push({ start, end: addDays(start, 6) })
  }
  const yesterday = addDays(today, -1)
  const out = []
  for (const w of weeks) {
    const last = w.end < yesterday ? w.end : yesterday
    if (last < w.start) continue
    const [trybe, rows] = await Promise.all([rangeTotals(w.start, last), rowsBetween(w.start, last)])
    const s = summarize(rows, rules)
    const meta = { spendCents: s.meta, purchaseValueCents: s.metaPurchaseValue }
    // The Trybe tab's own cost when it has the days; Trybe's earnings and its 1.5% fee when it does not yet.
    const cost = s.trybe || Math.round(trybe.earningsCents + trybe.gmvCents * 0.015)
    out.push({
      start: w.start, end: w.end, last, partial: last < w.end,
      trybe: { adSpendCents: trybe.adSpendCents, adPurchaseValueCents: trybe.adPurchaseValueCents, adPurchases: trybe.adPurchases, earningsCents: trybe.earningsCents, gmvCents: trybe.gmvCents, conversions: trybe.conversions, ads: trybe.ads, newSubmissions: trybe.newSubmissions, activeCreators: trybe.activeCreators },
      meta, costCents: cost, gmPct: s.grossMarginPct, metaShare: ratio(trybe.adSpendCents, meta.spendCents),
      ...weekVerdict({ trybe, meta, cost, gmPct: s.grossMarginPct }),
    })
  }
  const sum = k => out.reduce((t, w) => t + (k(w) || 0), 0)
  const full = out.filter(w => !w.partial)
  const totals = {
    costCents: sum(w => w.costCents), vsOtherCents: sum(w => w.vsOtherCents), newSubmissions: sum(w => w.trybe.newSubmissions),
    adSpendCents: sum(w => w.trybe.adSpendCents), weeksPaying: full.filter(w => w.verdict === 'paying').length, fullWeeks: full.length,
  }
  return { at: new Date().toISOString(), weeks: out, totals }
}

/** The check, cached for six hours (it reads Trybe once a week shown). */
export async function trybeCheck({ refresh = false, now = new Date() } = {}) {
  if (!process.env.TRYBE_API_KEY) return { configured: false, weeks: [], totals: null }
  const today = todayET(now)
  if (!refresh) {
    const row = await prisma.systemConfig.findUnique({ where: { key: CACHE_KEY } })
    try {
      const cached = row ? JSON.parse(row.value) : null
      if (cached?.today === today && Date.now() - new Date(cached.at).getTime() < CACHE_MS) return { configured: true, ...cached }
    } catch { /* recompute */ }
  }
  const result = { today, ...(await compute(today)) }
  await prisma.systemConfig.upsert({ where: { key: CACHE_KEY }, update: { value: JSON.stringify(result) }, create: { key: CACHE_KEY, value: JSON.stringify(result) } })
  return { configured: true, ...result }
}
