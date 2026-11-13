/**
 * The Overview page in one read: the period's headline numbers against the
 * compare window, where the money went, the daily trend with race days, the
 * levers, and what needs Matt.
 */
import prisma from '../../db.js'
import { loadRules, ruleFor } from './rules.js'
import { summarize } from './scoreboard.js'
import { rowsBetween } from './ledger.js'
import { lastSync } from './sheetSync.js'
import { resolvePeriod, todayET, addDays, PERIODS, monthOf, shiftMonth, lastOfMonth, firstOfMonth, dayLabel } from './periods.js'
import { moneyNeeds, needCard } from './needs.js'

const HEADLINE = ['revenue', 'shopifyRevenue', 'etsyRevenue', 'cm', 'cmPct', 'grossProfit', 'grossMarginPct', 'adSpend', 'meta', 'trybe', 'google', 'roas', 'orders', 'aov', 'cpa', 'breakevenCpa', 'cogs', 'designerFee', 'organicOrders', 'organicPct', 'units', 'dayCount', 'lastLanded', 'first', 'last']
const CM_ALERT_PCT = 10
const pick = (s, keys) => Object.fromEntries(keys.map(k => [k, s[k]]))

export async function overview({ period = 'today', now = new Date() } = {}) {
  const today = todayET(now)
  const rules = await loadRules()
  const p = resolvePeriod(period, today)
  const trendFirst = addDays(p.last, -89)
  const [rows, cmpRows, trendRows, syncInfo, money, races] = await Promise.all([
    rowsBetween(p.first, p.last),
    rowsBetween(p.compare.first, p.compare.last),
    rowsBetween(trendFirst < p.first ? trendFirst : p.first, p.last),
    lastSync(),
    moneyNeeds({ today }),
    prisma.race.findMany({ where: { raceDate: { gte: new Date(`${trendFirst}T00:00:00Z`), lte: new Date(`${p.last}T23:59:59Z`) } }, select: { raceName: true, raceDate: true, year: true } }),
  ])
  const s = summarize(rows, rules)
  const c = summarize(cmpRows, rules)
  const trend = summarize(trendRows, rules)
  const raceDays = {}
  for (const r of races) { const d = r.raceDate.toISOString().slice(0, 10); (raceDays[d] = raceDays[d] || []).push(r.raceName) }

  // Where the money went, in the order the scoreboard lists it.
  const feeBase = ruleFor(rules, 'designer_fee', p.last)?.base || 'cm'
  const waterfall = [
    { key: 'revenue', label: 'Revenue', cents: s.revenue, kind: 'total' },
    { key: 'shopifyFees', label: 'Shopify fees', cents: -s.shopifyFees },
    { key: 'etsyFees', label: 'Etsy fees', cents: -s.etsyFees },
    { key: 'production', label: 'Production', cents: -s.production },
    { key: 'shipping', label: 'Shipping', cents: -s.shipping },
    ...(feeBase === 'gp' ? [{ key: 'designerFee', label: 'Designer fee', cents: -s.designerFee }] : []),
    { key: 'grossProfit', label: 'Gross profit', cents: s.grossProfit, kind: 'subtotal' },
    { key: 'meta', label: 'Meta ads', cents: -s.meta },
    { key: 'trybe', label: 'Trybe creators', cents: -s.trybe },
    { key: 'google', label: 'Google ads', cents: -s.google },
    ...(feeBase === 'cm' ? [{ key: 'designerFee', label: 'Designer fee', cents: -s.designerFee }] : []),
    { key: 'cm', label: 'Contribution margin', cents: s.cm, kind: 'total' },
  ].map(w => ({ ...w, pctOfRevenue: s.revenue ? (Math.abs(w.cents) / s.revenue) * 100 : null }))

  // Pacing: this month so far against last month (same days, and whole) and the same month last year.
  const month = monthOf(p.last)
  const prevMonth = shiftMonth(month, -1), lastYear = shiftMonth(month, -12)
  const dayNo = Number(p.last.slice(8, 10))
  const [mtdRows, prevRows, lyRows] = await Promise.all([
    rowsBetween(firstOfMonth(p.last), p.last),
    rowsBetween(`${prevMonth}-01`, lastOfMonth(`${prevMonth}-01`)),
    rowsBetween(`${lastYear}-01`, lastOfMonth(`${lastYear}-01`)),
  ])
  const prevSameDays = prevRows.slice(0, Math.min(dayNo, prevRows.length))
  const pacing = {
    month, mtd: pick(summarize(mtdRows, rules), HEADLINE),
    lastMonth: pick(summarize(prevRows, rules), HEADLINE), lastMonthSameDays: pick(summarize(prevSameDays, rules), HEADLINE),
    lastYear: pick(summarize(lyRows, rules), HEADLINE), daysInMonth: Number(lastOfMonth(p.last).slice(8, 10)), dayNo,
  }

  // Needs you: the payments coming (needs.js), and one alert when the
  // period kept under 10 cents of each dollar.
  const breakeven = ruleFor(rules, 'breakeven_roas', p.last)?.value || 1.56
  const needs = [...money]
  if (s.dayCount && s.revenue > 0 && s.cmPct != null && s.cmPct < CM_ALERT_PCT) {
    const range = p.first === p.last ? dayLabel(p.first) : `${dayLabel(p.first)} to ${dayLabel(s.lastLanded || p.last)}`
    needs.push(needCard({
      key: `cm:${p.first}..${p.last}`, kind: 'cm', tone: 'alert',
      title: s.cmPct < 0 ? 'Losing money' : 'Margin under 10%',
      detail: `Contribution margin was ${s.cmPct.toFixed(1)}% of revenue for ${range}. Ad spend was ${Math.round(s.revenue ? (s.adSpend / s.revenue) * 100 : 0)}% of revenue.`,
      action: { label: 'Day by day', to: `/finance/daily?month=${monthOf(p.last)}` },
    }))
  }

  return {
    period: { key: p.key, first: p.first, last: p.last, label: p.label, compareLabel: p.compare.label, compareFirst: p.compare.first, compareLast: p.compare.last },
    periods: Object.entries(PERIODS).map(([key, label]) => ({ key, label })),
    today, through: s.lastLanded, partial: s.lastLanded !== p.last,
    totals: pick(s, HEADLINE), compare: pick(c, HEADLINE),
    waterfall, feeBase, breakevenRoas: breakeven,
    trend: trend.days.map(d => ({ day: d.day, landed: d.landed, revenue: d.revenue, cogs: d.cogs, adSpend: d.adSpend, cm: d.cm, designerFee: d.designerFee, orders: d.orders, roas: d.roas, races: raceDays[d.day] || [] })),
    levers: pick(s, ['metaRoas', 'metaCpa', 'metaCpc', 'metaCtr', 'googleRoas', 'googleCpa', 'googleCpc', 'googleCtr', 'cvr', 'atcPct', 'atcToCheckoutPct', 'checkoutToPurchasePct', 'costPerUnit', 'cogsPct', 'adSpendPct', 'shopifyPct', 'etsyPct', 'shopifyAov', 'etsyAov', 'sessions', 'metaPurchases', 'googleConversions']),
    pacing, needs, sync: syncInfo,
  }
}
