/**
 * The forecast's reading of history: orders tied to a race's window, the
 * arrival curve, the baseline, and the growth it suggests.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readHistory, suggestedGrowth, raceKey, BEFORE, AFTER } from './forecast.js'
import { addDays } from './periods.js'

const at = day => new Date(`${day}T16:00:00Z`)
const race = (name, year, day) => ({ raceName: name, year, raceDate: new Date(`${day}T00:00:00Z`) })

test('an order is tied to its race when it lands inside the window, by order number once', () => {
  const races = [race('Zzyzx Test Marathon', 2025, '2025-10-01')]
  const orders = [
    { parentOrderNumber: '100', raceName: 'Zzyzx Test Marathon', raceYear: 2025, createdAt: at('2025-10-03') },
    { parentOrderNumber: '100', raceName: 'Zzyzx Test Marathon', raceYear: 2025, createdAt: at('2025-10-03') }, // a second print on the same order
    { parentOrderNumber: '101', raceName: 'Zzyzx Test Marathon', raceYear: 2025, createdAt: at(addDays('2025-10-01', AFTER + 5)) }, // after the window
    { parentOrderNumber: '102', raceName: 'Zzyzx Test Marathon', raceYear: 2025, createdAt: at(addDays('2025-10-01', -BEFORE)) }, // first day of it
  ]
  const h = readHistory({ orders, races, today: '2026-11-06' })
  const k = `${raceKey('Zzyzx Test Marathon')}|2025`
  assert.equal(h.byRaceYear.get(k).size, 2)
  assert.equal(h.receivedSoFar.get(k).size, 3)
})

test('the curve sums to one over the window, from data or the fallback', () => {
  const h = readHistory({ orders: [], races: [], today: '2026-11-06' })
  let sum = 0
  for (const v of h.curve.values()) sum += v
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum ${sum}`)
  assert.equal(h.curveFromData, false)
  assert.ok(h.curve.get(3) > h.curve.get(-20), 'the week after the race outweighs three weeks before')
})

test('the baseline counts the last 56 days of orders no race explains', () => {
  const today = '2026-11-06'
  const orders = Array.from({ length: 112 }, (_, i) => ({ parentOrderNumber: `b${i}`, raceName: 'Some Unlisted Race', raceYear: 2026, createdAt: at(addDays(today, -1 - (i % 56))) }))
  const h = readHistory({ orders, races: [], today })
  assert.equal(h.baselinePerDay, 2)
})

test('growth compares closed windows this year with last year, and needs three races', () => {
  const today = '2026-11-06'
  const names = ['Alpha Test Run', 'Bravo Test Run', 'Charlie Test Run']
  const races = names.flatMap(n => [race(n, 2025, '2025-06-01'), race(n, 2026, '2026-06-01')])
  const orders = []
  names.forEach((n, i) => {
    for (let j = 0; j < 10; j++) orders.push({ parentOrderNumber: `${i}-a${j}`, raceName: n, raceYear: 2025, createdAt: at('2025-06-03') })
    for (let j = 0; j < 15; j++) orders.push({ parentOrderNumber: `${i}-b${j}`, raceName: n, raceYear: 2026, createdAt: at('2026-06-03') })
  })
  const h = readHistory({ orders, races, today })
  assert.deepEqual(suggestedGrowth({ history: h, races, today }), { growth: 1.5, races: 3 })
  assert.deepEqual(suggestedGrowth({ history: h, races: races.slice(0, 4), today }), { growth: 1, races: 2 })
})

test('Christmas: last year\'s shape from Thanksgiving week, scaled by the lift, 1 outside it', async () => {
  const { holidayIndex, thanksgivingMonday, HOLIDAY_LIFT_LAST_YEAR } = await import('./seasonality.js')
  assert.equal(thanksgivingMonday(2025), '2025-11-24')
  assert.equal(thanksgivingMonday(2026), '2026-11-23')
  assert.equal(HOLIDAY_LIFT_LAST_YEAR, 4.7)
  assert.equal(holidayIndex('2026-11-20'), 1)
  assert.equal(holidayIndex('2026-11-23'), 4.11)
  assert.ok(holidayIndex('2026-12-23') < 0.5, 'after the cutoff it drops')
  assert.equal(holidayIndex('2027-01-10'), 1)
  assert.equal(holidayIndex('2026-12-09', 1), 1, 'a lift of 1 is no Christmas')
  const half = holidayIndex('2026-12-09', 1 + (HOLIDAY_LIFT_LAST_YEAR - 1) / 2)
  assert.ok(Math.abs(half - (1 + (7.49 - 1) / 2)) < 1e-9)
})

test('a race with no last year is paced from what is in; one a week past race day from its last seven days', async () => {
  const { expectedOrders } = await import('./forecast.js')
  assert.deepEqual(expectedOrders({ lastYear: 0, received: 0, growth: 1, override: null, share: 0.1, run: false }), { expected: 0, basis: 'none' })
  // Before race day the share is floored at 15%: 30 orders in at 2% is not 1,500.
  assert.equal(expectedOrders({ lastYear: 0, received: 30, growth: 1, override: null, share: 0.02, run: false }).expected, 200)
  assert.equal(expectedOrders({ lastYear: 0, received: 600, growth: 1, override: null, share: 0.6, run: true }).expected, 1000)
  // 70 in the last week, which the curve says is 7% of a race's orders: 20% still to come is 200 more.
  assert.deepEqual(expectedOrders({ lastYear: 0, received: 800, growth: 1, override: null, share: 0.8, run: true, lastWeek: 70, weekShare: 0.07 }), { expected: 1000, basis: 'rate' })
  assert.deepEqual(expectedOrders({ lastYear: 500, received: 50, growth: 1.2, override: null, share: 0.1, run: false }), { expected: 600, basis: 'last_year' })
  assert.deepEqual(expectedOrders({ lastYear: 500, received: 50, growth: 1.2, override: 900, share: 0.1, run: false }), { expected: 900, basis: 'typed' })
})
