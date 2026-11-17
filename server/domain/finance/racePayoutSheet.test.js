import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plan } from './dailyTab.js'
import { asRows } from './racePayoutSheet.js'
import { laborByDay } from './hourlyLaborSheet.js'

test('writes the complete days that changed, names each race, and clears a day that dropped to nothing', () => {
  const grid = [
    ['11/14/2026', '$100.00', 'Marine Corps Marathon $100.00'], // unchanged
    ['11/15/2026', '', ''], // new
    ['11/16/2026', '$50.00', 'Baltimore Running Festival $50.00'], // refunded away
    ['11/17/2026', '', ''], // today: not complete, left alone
  ]
  const detail = asRows({
    '2026-11-14': { cents: 10000, races: [{ name: 'Marine Corps Marathon', cents: 10000 }] },
    '2026-11-15': { cents: 74806, races: [{ name: 'Marine Corps Marathon', cents: 41000 }, { name: 'Indianapolis Monumental Marathon', cents: 33806 }] },
    '2026-11-17': { cents: 500, races: [{ name: 'Marine Corps Marathon', cents: 500 }] },
  })
  assert.deepEqual(plan('Race Payouts', grid, detail, { today: '2026-11-17' }), [
    { range: "'Race Payouts'!B5:C5", values: [[748.06, 'Marine Corps Marathon $410.00; Indianapolis Monumental Marathon $338.06']] },
    { range: "'Race Payouts'!B6:C6", values: [['', '']] },
  ])
})

test('hourly labor: each day\'s minutes at the frozen rate once approved, the current rate before', () => {
  const sheet = (status, frozen, firstName, current) => ({ status, hourlyRateCents: frozen, user: { firstName, hourlyRateCents: current } })
  const out = laborByDay([
    { day: '2026-11-04', minutes: 90, timesheet: sheet('approved', 1500, 'Elí', 1800) },
    { day: '2026-11-04', minutes: 30, timesheet: sheet('approved', 1500, 'Elí', 1800) },
    { day: '2026-11-04', minutes: 60, timesheet: sheet('draft', null, 'Dani', 1200) },
    { day: '2026-11-04', minutes: 45, startedAt: new Date(), endedAt: null, timesheet: sheet('draft', null, 'Dani', 1200) }, // still running
    { day: '2026-11-05', minutes: 30, timesheet: sheet('draft', null, 'Matt', null) }, // no rate
  ])
  assert.deepEqual(out, { '2026-11-04': { cents: 4200, text: 'Elí 2h $30.00; Dani 1h $12.00' } })
})
