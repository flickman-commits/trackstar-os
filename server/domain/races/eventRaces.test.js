import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weatherWindowClosesAt, weatherWindowClosed } from './weatherWindow.js'
import { weatherSetEarly, printBlockers, weatherReady, WEATHER_SET_EARLY } from './verification.js'
import { eventRaceName, raceForEvent } from './eventRaces.js'

test('the weather window closes at 1pm where the race is', () => {
  // Philadelphia, November (EST, UTC-5): 1pm is 18:00 UTC.
  assert.equal(weatherWindowClosesAt('2026-11-22', 'America/New_York').toISOString(), '2026-11-22T18:00:00.000Z')
  // Marine Corps, October (EDT, UTC-4): 17:00 UTC.
  assert.equal(weatherWindowClosesAt(new Date('2026-10-25T00:00:00Z'), 'America/New_York').toISOString(), '2026-10-25T17:00:00.000Z')
  // Honolulu (UTC-10): 23:00 UTC.
  assert.equal(weatherWindowClosesAt('2026-12-13', 'Pacific/Honolulu').toISOString(), '2026-12-13T23:00:00.000Z')
  // No timezone known: 13:00 UTC, the earliest 1pm anywhere we sell.
  assert.equal(weatherWindowClosesAt('2026-11-22').toISOString(), '2026-11-22T13:00:00.000Z')
  assert.equal(weatherWindowClosed('2026-11-22', 'America/New_York', Date.parse('2026-11-22T17:59:00Z')), false)
  assert.equal(weatherWindowClosed('2026-11-22', 'America/New_York', Date.parse('2026-11-22T18:00:00Z')), true)
})

const verifiedDate = { raceDate: new Date('2026-11-22T00:00:00Z'), raceDateSource: 'config', raceDateVerifiedAt: new Date('2026-10-16T00:00:00Z'), raceDateEvidence: 'official site', location: 'Philadelphia, PA' }

test('weather typed in ten days before the race never prints on a normal order', () => {
  // Philadelphia 2026 as it was: entered by hand on Nov 12 for a creator print, and confirmed.
  const race = { ...verifiedDate, weatherTemp: '64°F', weatherCondition: 'cloudy', weatherFetchedAt: new Date('2026-11-12T22:37:54Z'), weatherConfirmedAt: new Date('2026-11-12T22:37:54Z'), weatherDetails: JSON.stringify({ method: 'Entered by hand' }) }
  assert.equal(weatherSetEarly(race), true)
  assert.equal(weatherReady(race), false)
  assert.ok(printBlockers(race).includes(WEATHER_SET_EARLY))
})

test('weather calculated on race afternoon is fine', () => {
  // Marine Corps 2026: calculated 1:02pm ET on race day, confirmed ten seconds later.
  const race = { ...verifiedDate, raceDate: new Date('2026-10-25T00:00:00Z'), weatherTemp: '55°F', weatherCondition: 'sunny', weatherFetchedAt: new Date('2026-10-25T17:02:18Z'), weatherConfirmedAt: new Date('2026-10-25T17:02:28Z'), weatherDetails: JSON.stringify({ method: 'Average', timezone: 'America/New_York' }) }
  assert.equal(weatherSetEarly(race), false)
  assert.equal(weatherReady(race), true)
  assert.deepEqual(printBlockers(race), [])
})

test('Philadelphia half and 8K have their own race rows; the marathon keeps the main one', () => {
  assert.equal(eventRaceName('Philadelphia', 2026, 'Half Marathon'), 'Philadelphia Marathon / Half Marathon')
  assert.equal(eventRaceName('Philadelphia Marathon', 2026, '8K'), 'Philadelphia Marathon / 8K')
  assert.equal(eventRaceName('Philadelphia Marathon', 2026, 'Marathon'), null)
  assert.equal(eventRaceName('Philadelphia Marathon', 2026, null), null)
  // 2025 is not pinned (sources disagree), so it stays on the main row.
  assert.equal(eventRaceName('Philadelphia Marathon', 2025, 'Half Marathon'), null)
  // A race whose distances run the same day is untouched.
  assert.equal(eventRaceName('Chicago Marathon', 2026, 'Half Marathon'), null)
})

test('a half print reads the half row, and waits when that row is missing', () => {
  const main = { id: 8, raceName: 'Philadelphia Marathon', year: 2026, raceDate: new Date('2026-11-22T00:00:00Z'), location: 'Philadelphia, PA' }
  const half = { id: 900, raceName: 'Philadelphia Marathon / Half Marathon', year: 2026, raceDate: new Date('2026-11-21T12:00:00Z') }
  const lookup = (name, year) => (name === half.raceName && year === 2026 ? half : null)
  assert.equal(raceForEvent(main, 'Half Marathon', lookup), half)
  assert.equal(raceForEvent(main, 'Marathon', lookup), main)
  const missing = raceForEvent(main, '8K', lookup)
  assert.equal(missing.raceDate, null)
  assert.equal(missing.raceName, 'Philadelphia Marathon / 8K')
  assert.ok(printBlockers(missing).includes('Race has no date'))
})
