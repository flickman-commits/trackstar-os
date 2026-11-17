/**
 * Race payouts -> the Daily Tracker's "Race Payouts" tab.
 *
 * One row per day (column A, the sheet's own dates): what partnered races
 * earned on that day's sales (racePayouts.js accruedDetail), and which races.
 * The scoreboard tab sums column B by date. TrackstarOS works the same number
 * out on its own (ledger.js), so this tab is only for the sheet; sheetSync
 * never reads it back.
 *
 * Every run rewrites the days whose figure changed, including days that drop
 * back to nothing, so a refund or a change of terms reaches the sheet. Only
 * complete days, through yesterday: the other raw tabs land a day behind, and
 * a part day here would run the month's totals ahead of its revenue.
 */
import prisma from '../../db.js'
import { readRanges, writeRanges } from '../../services/googleSheets.js'
import { accruedDetail } from './racePayouts.js'
import { SHEET_ID } from './sheetSync.js'
import { addDays, isValidDay, todayET } from './periods.js'

export const TAB = 'Race Payouts'
const FIRST_ROW = 4
const LAST_ROW = 1099
const STATUS_KEY = 'finance_race_payout_sheet'

/** "05/28/2026" -> "2026-05-28". */
function sheetDay(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim())
  if (!m) return null
  const day = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return isValidDay(day) ? day : null
}

const dollars = cents => Math.round(cents) / 100
const usd = cents => `$${dollars(cents).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** What each row should hold, against what it holds: the writes that differ. */
export function plan(grid, detail, { today }) {
  const data = []
  grid.forEach((cells, i) => {
    const day = sheetDay(cells?.[0])
    if (!day || day >= today) return
    const d = detail[day]
    const want = d ? [dollars(d.cents), d.races.map(r => `${r.name} ${usd(r.cents)}`).join('; ')] : ['', '']
    const haveAmount = String(cells?.[1] ?? '').replace(/[$,]/g, '').trim()
    const haveRaces = String(cells?.[2] ?? '').trim()
    const amountSame = want[0] === '' ? haveAmount === '' || haveAmount === '-' : Number(haveAmount) === want[0]
    if (!amountSame || haveRaces !== want[1]) data.push({ range: `'${TAB}'!B${FIRST_ROW + i}:C${FIRST_ROW + i}`, values: [want] })
  })
  return data
}

export async function syncRacePayoutSheet({ today = todayET() } = {}) {
  const [grid] = await readRanges([`'${TAB}'!A${FIRST_ROW}:C${LAST_ROW}`], { spreadsheetId: SHEET_ID })
  const days = grid.map(c => sheetDay(c?.[0])).filter(Boolean)
  if (!days.length) return { skipped: `The ${TAB} tab has no dates in column A` }
  const detail = await accruedDetail(days[0], addDays(today, -1))
  const data = plan(grid, detail, { today })
  const { updatedCells } = await writeRanges(data, { spreadsheetId: SHEET_ID })
  const result = { at: new Date().toISOString(), written: data.length, updatedCells }
  await prisma.systemConfig.upsert({ where: { key: STATUS_KEY }, update: { value: JSON.stringify(result) }, create: { key: STATUS_KEY, value: JSON.stringify(result) } })
  return result
}
