/**
 * Race payouts -> the Daily Tracker's "Race Payouts" tab (dailyTab.js): what
 * partnered races earned on each day's sales (racePayouts.js accruedDetail),
 * and which races. The scoreboard tab sums column B by date.
 */
import { accruedDetail } from './racePayouts.js'
import { syncDailyTab } from './dailyTab.js'

export const TAB = 'Race Payouts'

const usd = cents => `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** accruedDetail's days -> { day: { cents, text } }. */
export function asRows(detail) {
  return Object.fromEntries(Object.entries(detail).map(([day, d]) => [day, { cents: d.cents, text: d.races.map(r => `${r.name} ${usd(r.cents)}`).join('; ') }]))
}

export const syncRacePayoutSheet = ({ today } = {}) =>
  syncDailyTab(TAB, async (first, last) => asRows(await accruedDetail(first, last)), { today, statusKey: 'finance_race_payout_sheet' })
