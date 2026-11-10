import { test } from 'node:test'
import assert from 'node:assert/strict'
import { yearUnknown } from './yearUnknown.js'

test('an order the customer gave no year is not researched under the placeholder year', () => {
  assert.equal(yearUnknown({ status: 'missing_year', raceYear: 2026, yearOverride: null }), true)
})

test('once a person sets the year it is researched for that year', () => {
  assert.equal(yearUnknown({ status: 'missing_year', raceYear: 2026, yearOverride: 2023 }), false)
  assert.equal(yearUnknown({ status: 'pending', raceYear: 2023, yearOverride: null }), false)
})
