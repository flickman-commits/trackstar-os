/**
 * Christmas: the weeks from Thanksgiving to the shipping cutoff, when people
 * buy prints as gifts whatever race the runner ran, then the drop after the
 * last day an order can arrive by Christmas.
 *
 * The shape is last year's, from Shopify (the Order table starts in January
 * 2026, so it has no Christmas of its own yet). Orders a week, 2025:
 *
 *   Nov 10, Nov 17 (a normal week)   28, 27    = 27.5 a week
 *   Nov 24 (Thanksgiving week)       113       4.11x
 *   Dec 1                            93        3.38x
 *   Dec 8                            206       7.49x
 *   Dec 15                           105       3.82x
 *   Dec 22 (after the cutoff)        8         0.29x
 *   Dec 29                           6         0.22x
 *
 * Weeks are counted from the Monday of Thanksgiving week, so the shape moves
 * with the holiday. The lift (the forecast's Holiday lift driver) is the
 * average of the four gift weeks against a normal week: 4.7 last year. A
 * different lift scales every week's distance from 1 by the same amount, so
 * 1 means no Christmas at all and the after-cutoff dip shrinks with the rise.
 */
import { addDays, daysBetween } from './periods.js'

export const HOLIDAY_SHAPE = [4.11, 3.38, 7.49, 3.82, 0.29, 0.22]
const GIFT_WEEKS = 4
export const HOLIDAY_LIFT_LAST_YEAR = Math.round(HOLIDAY_SHAPE.slice(0, GIFT_WEEKS).reduce((a, b) => a + b, 0) / GIFT_WEEKS * 10) / 10

/** The Monday of Thanksgiving week (the fourth Thursday of November) in a year. */
export function thanksgivingMonday(year) {
  const nov1 = new Date(Date.UTC(year, 10, 1)).getUTCDay() // 0 Sunday
  const firstThursday = 1 + ((4 - nov1 + 7) % 7)
  return addDays(`${year}-11-${String(firstThursday + 21).padStart(2, '0')}`, -3)
}

/** How many times a normal day's orders this day expects, for a holiday lift. 1 outside the season. */
export function holidayIndex(day, lift = HOLIDAY_LIFT_LAST_YEAR) {
  const start = thanksgivingMonday(Number(day.slice(0, 4)))
  const off = daysBetween(start, day)
  if (off < 0 || off >= HOLIDAY_SHAPE.length * 7) return 1
  const scale = (lift - 1) / (HOLIDAY_LIFT_LAST_YEAR - 1)
  return Math.max(0, 1 + (HOLIDAY_SHAPE[Math.floor(off / 7)] - 1) * scale)
}
