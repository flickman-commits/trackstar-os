/**
 * Reading the ledger: rows for a span of days (gaps filled with empty days so
 * every chart and table has one slot per day), the Daily table for a month,
 * and Matt's overrides.
 */
import prisma from '../../db.js'
import { loadRules } from './rules.js'
import { computeDay, summarize, effective, landed } from './scoreboard.js'
import { FIELDS } from './sheetSync.js'
import { eachDay, todayET, isValidMonth, firstOfMonth, lastOfMonth, mondayOf, addDays, isValidDay } from './periods.js'

export class FinanceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

/** One row per day from first to last, empty where the ledger has none. */
export async function rowsBetween(first, last) {
  const found = await prisma.financeDay.findMany({ where: { day: { gte: first, lte: last } } })
  const byDay = new Map(found.map(r => [r.day, r]))
  return eachDay(first, last).map(d => byDay.get(d) || { day: d, overrides: null })
}

export async function summaryBetween(first, last, rules) {
  const r = rules || await loadRules()
  return summarize(await rowsBetween(first, last), r)
}

/** The raw inputs a day shows when opened: every field, the sheet's value and the override. */
export function inputsFor(row) {
  const o = row.overrides && typeof row.overrides === 'object' ? row.overrides : {}
  return FIELDS.map(f => ({ field: f, sheet: row[f] ?? null, override: typeof o[f] === 'number' ? o[f] : null, value: effective(row)[f] ?? null }))
}

/**
 * The Daily page: a month's days (to today), each computed, the month's
 * totals, and the Monday-to-Sunday weeks inside it.
 */
export async function dailyTable(month, { today = todayET() } = {}) {
  if (!isValidMonth(month)) throw new FinanceError('month must be YYYY-MM')
  const first = `${month}-01`
  const last = lastOfMonth(first) < today ? lastOfMonth(first) : today
  if (first > today) return { month, days: [], total: null, weeks: [], readAt: null }
  const rules = await loadRules()
  const rows = await rowsBetween(first, last)
  const total = summarize(rows, rules)
  const days = rows.map(r => ({ ...computeDay(r, rules), has: landed(effective(r)), readAt: r.readAt || null, overridden: Object.keys(r.overrides && typeof r.overrides === 'object' ? r.overrides : {}) }))
  // Weeks: group the month's days by their Monday; a week that starts in the month before still counts its days here.
  const weeks = []
  const byMonday = new Map()
  for (const r of rows) {
    const m = mondayOf(r.day)
    if (!byMonday.has(m)) byMonday.set(m, [])
    byMonday.get(m).push(r)
  }
  for (const [weekStart, wr] of byMonday) weeks.push({ weekStart, weekEnd: addDays(weekStart, 6), ...stripDays(summarize(wr, rules)) })
  const readAt = rows.reduce((a, r) => (r.readAt && (!a || r.readAt > a) ? r.readAt : a), null)
  return { month, days, total: stripDays(total), weeks, readAt }
}

const stripDays = s => { const { days: _d, ...rest } = s; return rest }

/** Matt types over a feed's value (cents or a count); null takes it back. */
export async function setOverride({ day, field, value }) {
  if (!isValidDay(day)) throw new FinanceError('day must be YYYY-MM-DD')
  if (!FIELDS.includes(field)) throw new FinanceError('That is not a column of the ledger')
  if (value !== null && !(Number.isInteger(value) && Math.abs(value) < 1e12)) throw new FinanceError('value must be a whole number of cents (or a count), or null')
  const row = await prisma.financeDay.findUnique({ where: { day } })
  const overrides = { ...(row?.overrides && typeof row.overrides === 'object' ? row.overrides : {}) }
  if (value === null) delete overrides[field]; else overrides[field] = value
  const data = { overrides: Object.keys(overrides).length ? overrides : null }
  const saved = row ? await prisma.financeDay.update({ where: { day }, data }) : await prisma.financeDay.create({ data: { day, ...data } })
  return { day, inputs: inputsFor(saved) }
}

export { firstOfMonth }
