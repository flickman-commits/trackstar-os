import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legTime, finishTime, legsOf } from './IronmanScraper.js'
import { getCanonicalRaceName } from '../index.js'
import { pipelineFor } from '../../domain/orders/pipeline.js'

test('times: legs zero-padded, finish as the page prints it, zero is none', () => {
  assert.equal(legTime('0:55:17'), '00:55:17')
  assert.equal(legTime('5:42:56'), '05:42:56')
  assert.equal(legTime('0:00:00'), null)
  assert.equal(legTime(null), null)
  assert.equal(finishTime('11:14:01'), '11:14:01')
  assert.equal(finishTime('05:13:39'), '5:13:39')
  assert.equal(finishTime('0:00:00'), null)
})

test('legs: the format distance, unless that leg was cancelled or shortened', () => {
  const full = { wtc_swimtimeformatted: '0:49:23', wtc_swimdistancecompleted: 3.8624, wtc_biketimeformatted: '4:44:11', wtc_bikedistancecompleted: 181.663, wtc_runtimeformatted: '3:01:56', wtc_rundistancecompleted: 42.1004 }
  assert.deepEqual(legsOf(full, false), { swimTime: '00:49:23', swimDistance: '2.4 mi', bikeTime: '04:44:11', bikeDistance: '112 mi', runTime: '03:01:56', runDistance: '26.2 mi' })
  // Waco 2026: no swim for anyone.
  const noSwim = { wtc_swimtimeformatted: null, wtc_swimdistancecompleted: 0, wtc_biketimeformatted: '3:09:19', wtc_bikedistancecompleted: 89.8819, wtc_runtimeformatted: '1:59:53', wtc_rundistancecompleted: 21.1468 }
  assert.deepEqual(legsOf(noSwim, true), { swimTime: null, swimDistance: null, bikeTime: '03:09:19', bikeDistance: '56 mi', runTime: '01:59:53', runDistance: '13.1 mi' })
  // New York 2026: swim cut to 1.5 km. The time is real; the distance is not 1.2 mi.
  const shortSwim = { ...noSwim, wtc_swimtimeformatted: '0:28:26', wtc_swimdistancecompleted: 1.5 }
  assert.equal(legsOf(shortSwim, true).swimTime, '00:28:26')
  assert.equal(legsOf(shortSwim, true).swimDistance, null)
})

test('race names: place plus 70.3 or not; never a guess', () => {
  assert.equal(getCanonicalRaceName('Iron Man 70.3 Waco'), 'IRONMAN 70.3 Waco')
  assert.equal(getCanonicalRaceName('Augusta 70.3 Ironman'), 'IRONMAN 70.3 Augusta')
  assert.equal(getCanonicalRaceName('Ottawa Ironman'), 'IRONMAN Canada-Ottawa')
  assert.equal(getCanonicalRaceName('Ironman Wisconsin'), 'IRONMAN Wisconsin')
  assert.equal(getCanonicalRaceName('Ironman 70.3 Wisconsin'), 'IRONMAN 70.3 Wisconsin')
  assert.equal(getCanonicalRaceName('Zafiro Ironman - Alcudia-Mallorca'), 'IRONMAN 70.3 Alcúdia-Mallorca')
  // Only a 70.3 there: a name without 70.3 says a full IRONMAN, which does not exist.
  assert.equal(getCanonicalRaceName('Ironman Augusta'), null)
  // Not IRONMAN, and marathons in the same places, are untouched.
  assert.equal(getCanonicalRaceName('Chattanooga triathlon'), null)
  assert.equal(getCanonicalRaceName('Wisconsin Marathon'), null)
})

const tri = (research, extra = {}) => pipelineFor({
  order: { status: 'pending', runnerName: 'Jane Doe', raceName: 'Ironman 70.3 Wisconsin', raceYear: 2025, lineItemIndex: 0, shopifyOrderData: { line_items: [{ title: 'Personalized Triathlon Print' }] }, productSize: '12x18' },
  research, race: { raceDate: new Date('2025-09-06') }, render: null, hasScraper: true, templates: new Set(), noTimeGaps: new Set(), photoUnpaid: false, workerOnline: true, ...extra,
})

test('triathlon pipeline: what the IRONMAN lookup found', () => {
  assert.equal(tri(null).reason, 'Needs research')
  assert.equal(tri({ researchStatus: 'ambiguous' }).reason, 'Pick a match')
  assert.equal(tri({ researchStatus: 'not_found' }).reason, 'Runner not found')
  assert.equal(tri({ researchStatus: 'upstream_error' }).reason, 'Timing site down')
  const noSwim = tri({ researchStatus: 'found', bibNumber: '1406', officialTime: '5:13:39', bikeTime: '03:09:19', bikeDistance: '56 mi', runTime: '01:59:53', runDistance: '13.1 mi' })
  assert.equal(noSwim.reason, 'Needs manual research')
  assert.match(noSwim.fix, /swim time, swim distance/)
  // No scraper (a local triathlon): by hand, as before.
  assert.equal(tri(null, { hasScraper: false }).reason, 'Needs manual research')
})
