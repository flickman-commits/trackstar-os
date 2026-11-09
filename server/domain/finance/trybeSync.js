/**
 * Trybe -> the Daily Tracker's "Trybe" tab.
 *
 * Trybe (creator content paid as a share of the sales it drives) bills us
 * weekly: what creators earned, its platform fee (1.5% of the sales it
 * attributed) and card processing (2.9% of the charge). The tab holds one
 * row per day: this fills Attributed Sales, Conversions and Creator Earnings
 * from the Trybe API, and the sheet's own formulas work out the fees and the
 * Total Cost that the scoreboard counts as ad spend next to Meta. The rates
 * live in labeled cells on the tab (J4, J5), so a change in Trybe's terms is
 * one cell, not a deploy.
 *
 * Days are Trybe's UTC days, complete ones only (yesterday at the latest).
 * Earnings settle for a while after the day, so each run re-reads the last
 * two weeks; days never filled are backfilled oldest first, a batch a run,
 * paced under the API's 60 requests a minute. sheetSync then reads the tab
 * into FinanceDay like the other raw tabs.
 */
import prisma from '../../db.js'
import { readRanges, writeRanges } from '../../services/googleSheets.js'
import { dayTotals } from '../../services/trybe.js'
import { SHEET_ID } from './sheetSync.js'
import { addDays, isValidDay } from './periods.js'

export const TAB = 'Trybe'
export const FIRST_DAY = '2026-05-28' // the first creator joined Trybe that day
export const REFRESH_DAYS = 14
export const MAX_PER_RUN = 45
const FIRST_ROW = 4
const STATUS_KEY = 'finance_trybe_sync'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const utcYesterday = (now = new Date()) => addDays(now.toISOString().slice(0, 10), -1)

/** "05/28/2026" -> "2026-05-28". */
function sheetDay(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim())
  if (!m) return null
  const day = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return isValidDay(day) ? day : null
}

/** The tab's rows -> { day: { row, filled } }. */
export function readTab(grid) {
  const out = new Map()
  grid.forEach((cells, i) => {
    const day = sheetDay(cells?.[0])
    if (day) out.set(day, { row: FIRST_ROW + i, filled: String(cells?.[1] ?? '').trim() !== '' })
  })
  return out
}

/** Which days to pull this run: the last two weeks again, then the oldest never filled. */
export function planDays(tab, { yesterday, first = FIRST_DAY, refreshDays = REFRESH_DAYS, max = MAX_PER_RUN }) {
  const refresh = []
  for (let i = refreshDays - 1; i >= 0; i--) {
    const day = addDays(yesterday, -i)
    if (day >= first && tab.has(day)) refresh.push(day)
  }
  const recent = new Set(refresh)
  const backfill = [...tab.entries()].filter(([day, r]) => day >= first && day <= yesterday && !r.filled && !recent.has(day)).map(([day]) => day).sort()
  return [...refresh, ...backfill].slice(0, max)
}

export async function syncTrybe({ now = new Date(), max = MAX_PER_RUN } = {}) {
  if (!process.env.TRYBE_API_KEY) return { skipped: 'TRYBE_API_KEY is not set' }
  const [grid] = await readRanges([`'${TAB}'!A${FIRST_ROW}:B1099`], { spreadsheetId: SHEET_ID })
  const tab = readTab(grid)
  if (!tab.size) return { skipped: `The ${TAB} tab has no dates in column A` }
  const days = planDays(tab, { yesterday: utcYesterday(now), max })
  const data = [], failed = []
  for (const [i, day] of days.entries()) {
    if (i) await sleep(1100) // 60 a minute is the limit; stay under it
    try {
      const t = await dayTotals(day)
      data.push({ range: `'${TAB}'!B${tab.get(day).row}:D${tab.get(day).row}`, values: [[t.gmvCents / 100, t.conversions, t.earningsCents / 100]] })
    } catch (err) {
      failed.push({ day, error: err?.message || 'failed' })
      if (err?.status === 401 || err?.status === 403) break // a bad key fails every day the same way
    }
  }
  const { updatedCells } = await writeRanges(data, { spreadsheetId: SHEET_ID })
  const result = { at: now.toISOString(), written: data.length, updatedCells, from: days[0] || null, to: days[days.length - 1] || null, failed }
  await prisma.systemConfig.upsert({ where: { key: STATUS_KEY }, update: { value: JSON.stringify(result) }, create: { key: STATUS_KEY, value: JSON.stringify(result) } })
  return result
}
