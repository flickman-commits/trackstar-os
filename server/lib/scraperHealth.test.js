import test from 'node:test'
import assert from 'node:assert/strict'
import { numbersProblem, fixtureMismatch } from './scraperHealth.js'

const row = fields => ({ race: 'Tokyo Marathon', year: 2025, status: 'live', actualEventType: 'Marathon', ...fields })

test('a real finish passes', () => {
  assert.equal(numbersProblem(row({ actualTime: '3:58:33', actualPace: '9:06' })), null)
  assert.equal(numbersProblem(row({ actualTime: '2:02:16', actualPace: '4:40' })), null)
  // Wheelchair marathon, Tokyo 2024 (Johnboy Smith).
  assert.equal(numbersProblem(row({ actualTime: '1:34:32', actualPace: '3:36' })), null)
})

test('a zero time is not a finish', () => {
  assert.match(numbersProblem(row({ actualTime: '00:00:00', actualPace: '0:00' })), /00:00:00/)
})

test('a pace that does not fit the time is caught', () => {
  assert.match(numbersProblem(row({ actualTime: '3:28:41', actualPace: '16:31' })), /does not equal/)
})

test('a shorter race under a marathon label is caught even when its pace fits', () => {
  assert.match(numbersProblem(row({ actualTime: '0:38:43', actualPace: '1:29' })), /faster than any human/)
})

test('no time means nothing to judge', () => {
  assert.equal(numbersProblem(row({ actualTime: null })), null)
})

test('a scraper that returns the right runner with another time has drifted', () => {
  const fixture = { name: 'Jo Smith', bib: '1234', time: '3:58:33' }
  assert.equal(fixtureMismatch(fixture, { bib: '1234', time: '3:58:33' }), null)
  assert.equal(fixtureMismatch(fixture, { bib: '01234', time: '03:58:33' }), null)
  // Gun time instead of chip time: the bib still matches.
  assert.match(fixtureMismatch(fixture, { bib: '1234', time: '4:01:02' }), /time was 4:01:02/)
  assert.match(fixtureMismatch(fixture, { bib: '9999', time: '3:58:33' }), /bib was 9999/)
})

test('a candidate listed without a time is judged on its bib', () => {
  assert.equal(fixtureMismatch({ bib: '1234', time: '3:58:33' }, { bib: '1234', time: null }), null)
})

test('a fixture with no bib is judged on its time, as before', () => {
  assert.equal(fixtureMismatch({ time: '2:23:01' }, { bib: '', time: '02:23:01' }), null)
  assert.match(fixtureMismatch({ time: '2:23:01' }, { bib: '', time: '2:25:00' }), /time was/)
})
