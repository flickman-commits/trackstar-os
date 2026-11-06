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
