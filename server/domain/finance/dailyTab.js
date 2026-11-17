/**
 * A raw tab of the Daily Tracker that TrackstarOS fills, one row per day:
 * column A the sheet's own dates, B the day's amount in dollars, C what made
 * it up ("Marine Corps Marathon $410.00; Indianapolis ... $338.06").
 *
 * Every run rewrites the days whose figure changed, including days that drop
 * back to nothing, so a refund or a corrected entry reaches the sheet. Only
 * complete days, through yesterday: the other raw tabs land a day behind, and
 * a part day would run the month's totals ahead of its revenue.
 *
 * Used by the Race Payouts tab (racePayoutSheet.js) and the Hourly Labor tab
 * (hourlyLaborSheet.js). sheetSync never reads these back: the tool works the
 * same numbers out itself.
 */
import prisma from '../../db.js'
import { readRanges, writeRanges } from '../../services/googleSheets.js'
import { SHEET_ID } from './sheetSync.js'
import { addDays, isValidDay, todayET } from './periods.js'

const FIRST_ROW = 4
const LAST_ROW = 1099

/** "05/28/2026" -> "2026-05-28". */
export function sheetDay(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim())
  if (!m) return null
  const day = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return isValidDay(day) ? day : null
}

const dollars = cents => Math.round(cents) / 100

/**
 * What each row should hold, against what it holds: the writes that differ.
 * detail is { day: { cents, text } }.
 */
export function plan(tab, grid, detail, { today }) {
  const data = []
  grid.forEach((cells, i) => {
    const day = sheetDay(cells?.[0])
    if (!day || day >= today) return
    const d = detail[day]
    const want = d && d.cents ? [dollars(d.cents), d.text] : ['', '']
    const haveAmount = String(cells?.[1] ?? '').replace(/[$,]/g, '').trim()
    const haveText = String(cells?.[2] ?? '').trim()
    const amountSame = want[0] === '' ? haveAmount === '' || haveAmount === '-' : Number(haveAmount) === want[0]
    if (!amountSame || haveText !== want[1]) data.push({ range: `'${tab}'!B${FIRST_ROW + i}:C${FIRST_ROW + i}`, values: [want] })
  })
  return data
}

/** Read the tab, work out each complete day with detailFor(first, last), write what changed. */
export async function syncDailyTab(tab, detailFor, { today = todayET(), statusKey } = {}) {
  const [grid] = await readRanges([`'${tab}'!A${FIRST_ROW}:C${LAST_ROW}`], { spreadsheetId: SHEET_ID })
  const days = grid.map(c => sheetDay(c?.[0])).filter(Boolean)
  if (!days.length) return { skipped: `The ${tab} tab has no dates in column A` }
  const detail = await detailFor(days[0], addDays(today, -1))
  const data = plan(tab, grid, detail, { today })
  const { updatedCells } = await writeRanges(data, { spreadsheetId: SHEET_ID })
  const result = { at: new Date().toISOString(), written: data.length, updatedCells }
  if (statusKey) await prisma.systemConfig.upsert({ where: { key: statusKey }, update: { value: JSON.stringify(result) }, create: { key: statusKey, value: JSON.stringify(result) } })
  return result
}
