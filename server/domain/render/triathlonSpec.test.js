import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSpec, TRI_TEMPLATE } from './spec.js'
import { changedPrintedFields } from './printed.js'
import { pipelineFor } from '../orders/pipeline.js'

const race = { id: 347, raceName: 'IRONMAN California', year: 2026, raceDate: new Date('2026-10-18T00:00:00Z'), raceDateSource: 'researched', raceDateSourceUrl: 'https://labs-v2.competitor.com/results/event/x', raceDateEvidence: 'listed', raceDateVerifiedAt: new Date('2026-11-16'), raceDateConfirmedByPerson: false, location: 'Sacramento, CA', weatherCondition: 'sunny', weatherTemp: '71°F', weatherFetchedAt: new Date('2026-11-16'), weatherConfirmedAt: new Date('2026-11-16'), firstPrintedAt: null }
const legs = { swimTime: '00:50:52', swimDistance: '2.4 mi', bikeTime: '07:43:53', bikeDistance: '112 mi', runTime: '05:33:51', runDistance: '26.2 mi' }
const order = (over = {}, research = {}) => ({
  id: 'o1', orderNumber: '7584496845083-0', parentOrderNumber: '7584496845083', lineItemIndex: 0, trackstarOrderType: 'standard', status: 'ready',
  raceName: 'Ironman California', raceYear: 2026, runnerName: 'Lindsay Travelstead', productSize: '12x18', hadNoTime: false, noBib: false,
  shopifyOrderData: { name: '#9725', line_items: [{ title: 'Personalized Triathlon Print' }] },
  runnerResearch: [{ researchStatus: 'found', bibNumber: '2070', officialTime: '14:28:38', officialPace: null, eventType: 'IRONMAN', ...legs, race, ...research }],
  ...over,
})

test('an IRONMAN triathlon renders from the Triathlon design with its title and legs', () => {
  const r = buildSpec(order(), [TRI_TEMPLATE])
  assert.deepEqual(r.reasons, [])
  assert.equal(r.spec.template, 'Triathlon')
  assert.equal(r.spec.triathlon, true)
  assert.equal(r.spec.title1, 'Ironman')
  assert.equal(r.spec.title2, 'California')
  assert.equal(r.spec.pace, null)
  assert.equal(r.spec.swimTime, '00:50:52')
  assert.equal(r.spec.runDistance, '26.2 mi')
})

test('a triathlon waits for the file, a title and every leg', () => {
  assert.match(buildSpec(order(), []).reasons.join(), /No prepared template for Triathlon/)
  assert.match(buildSpec(order({ raceName: 'Chattanooga triathlon' }), [TRI_TEMPLATE]).reasons.join(), /only IRONMAN races/)
  assert.match(buildSpec(order({}, { swimTime: null, swimDistance: null }), [TRI_TEMPLATE]).reasons.join(), /No swim time, swim distance yet/)
})

test('a changed leg makes it a different print', () => {
  const a = buildSpec(order(), [TRI_TEMPLATE]).spec
  const b = buildSpec(order({}, { bikeTime: '07:43:54' }), [TRI_TEMPLATE]).spec
  assert.deepEqual(changedPrintedFields(a, b), ['bikeTime'])
})

test('pipeline: a complete IRONMAN triathlon waits on the renderer once the file is checked', () => {
  const o = order()
  const args = { order: o, research: o.runnerResearch[0], race, render: null, hasScraper: true, noTimeGaps: new Set(), photoUnpaid: false, workerOnline: true }
  assert.equal(pipelineFor({ ...args, templates: new Set() }).reason, 'Make by hand')
  assert.equal(pipelineFor({ ...args, templates: new Set([TRI_TEMPLATE]) }).reason, 'Render queued')
  assert.equal(pipelineFor({ ...args, templates: new Set([TRI_TEMPLATE]), render: { status: 'done', review: 'pending' } }).reason, 'Ready for review')
})
