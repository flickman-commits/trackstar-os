import { test } from 'node:test'
import assert from 'node:assert/strict'
import { raceRun } from './pipeline.js'

test('a race counts as run unless it is clearly ahead', () => {
  const now = new Date('2026-11-12T12:00:00Z')
  // No date: only a later year waits.
  assert.equal(raceRun(null, 2026, now), true)
  assert.equal(raceRun(null, 2025, now), true)
  assert.equal(raceRun(null, 2027, now), false)
  // A date ahead in this year waits; behind does not.
  assert.equal(raceRun({ raceDate: new Date('2026-11-22') }, 2026, now), false)
  assert.equal(raceRun({ raceDate: new Date('2026-11-02') }, 2026, now), true)
  // A date that disagrees with an earlier year (a bad date): run.
  assert.equal(raceRun({ raceDate: new Date('2026-12-01') }, 2025, now), true)
})
