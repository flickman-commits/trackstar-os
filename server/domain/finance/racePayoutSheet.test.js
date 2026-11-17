import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plan } from './racePayoutSheet.js'

test('writes the complete days that changed, names each race, and clears a day that dropped to nothing', () => {
  const grid = [
    ['11/14/2026', '$100.00', 'Marine Corps Marathon $100.00'], // unchanged
    ['11/15/2026', '', ''], // new
    ['11/16/2026', '$50.00', 'Baltimore Running Festival $50.00'], // refunded away
    ['11/17/2026', '', ''], // today: not complete, left alone
  ]
  const detail = {
    '2026-11-14': { cents: 10000, races: [{ name: 'Marine Corps Marathon', cents: 10000 }] },
    '2026-11-15': { cents: 74806, races: [{ name: 'Marine Corps Marathon', cents: 41000 }, { name: 'Indianapolis Monumental Marathon', cents: 33806 }] },
  }
  detail['2026-11-17'] = { cents: 500, races: [{ name: 'Marine Corps Marathon', cents: 500 }] }
  assert.deepEqual(plan(grid, detail, { today: '2026-11-17' }), [
    { range: "'Race Payouts'!B5:C5", values: [[748.06, 'Marine Corps Marathon $410.00; Indianapolis Monumental Marathon $338.06']] },
    { range: "'Race Payouts'!B6:C6", values: [['', '']] },
  ])
})
