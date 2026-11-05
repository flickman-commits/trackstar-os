import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closesAtFor, closedReasonFor, isFullName, toTitleCase } from './selfServeWindow.js'
import { CHANGE_WINDOW_HOURS } from './changeWindow.js'

const HOUR = 3600_000
const placed = new Date('2026-11-05T15:00:00Z')
const order = { shopifyOrderData: { created_at: placed.toISOString() }, createdAt: placed }
const windowEnd = placed.getTime() + CHANGE_WINDOW_HOURS * HOUR

test('the window is the change window after the order', () => {
  assert.equal(closesAtFor(order, [], placed.getTime()).getTime(), windowEnd)
})

test('a pre-order stays open until race day, a past race day changes nothing', () => {
  const raceDay = new Date('2026-12-13T12:00:00Z')
  assert.equal(closesAtFor(order, [raceDay], placed.getTime()).getTime(), raceDay.getTime())
  assert.equal(closesAtFor(order, [new Date('2026-11-01T12:00:00Z')], placed.getTime()).getTime(), windowEnd)
  // Once race day has passed, only the window counts (a stale date never extends it).
  assert.equal(closesAtFor(order, [raceDay], raceDay.getTime() + HOUR).getTime(), windowEnd)
})

test('closed by the clock, by production, by shipping, by a cancel; open otherwise', () => {
  const row = { ...order, status: 'pending', designStatus: 'not_started', trackingNumber: null, renderJobs: [] }
  const closes = new Date(windowEnd)
  assert.equal(closedReasonFor([row], closes, placed.getTime() + HOUR), null)
  assert.equal(closedReasonFor([row], closes, windowEnd), 'window')
  assert.equal(closedReasonFor([row, { ...row, renderJobs: [{ id: 'sent' }] }], closes, placed.getTime()), 'in_production')
  assert.equal(closedReasonFor([{ ...row, designStatus: 'sent_to_production' }], closes, placed.getTime()), 'in_production')
  assert.equal(closedReasonFor([{ ...row, status: 'completed' }], closes, placed.getTime()), 'in_production')
  assert.equal(closedReasonFor([{ ...row, trackingNumber: '1Z' }], closes, placed.getTime()), 'shipped')
  assert.equal(closedReasonFor([{ ...row, shopifyOrderData: { ...row.shopifyOrderData, cancelled_at: '2026-11-05' } }], closes, placed.getTime()), 'cancelled')
  assert.equal(closedReasonFor([], closes), 'not_found')
})

test('a name needs two words and prints in title case', () => {
  assert.equal(isFullName('Matt'), false)
  assert.equal(isFullName('  Matt   Hickman '), true)
  assert.equal(toTitleCase('MATT HICKMAN'), 'Matt Hickman')
  assert.equal(toTitleCase("o'brien mcdonald iii"), "O'Brien McDonald III")
  assert.equal(toTitleCase('DeShawn'), 'DeShawn')
})
