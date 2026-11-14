import test from 'node:test'
import assert from 'node:assert/strict'
import { listingDistances, listingPills, listingRace, hasDesignFor, distanceLabel } from './designs.js'

const KEYS = new Set([
  'Eugene Marathon', 'Eugene Marathon / Half Marathon',
  'Houston Marathon',
  'Philadelphia Marathon', 'Philadelphia Marathon / Half Marathon', 'Philadelphia Marathon / 8K', 'Philadelphia Marathon / Original', 'Philadelphia Marathon / Half Marathon / Original',
  'Chicago Marathon', 'Chicago Marathon / World Majors',
  'Detroit Marathon', 'Detroit Marathon / International Half Marathon', 'Detroit Marathon / Motor City Half Marathon',
  'Santa Barbara Half Marathon', 'Army Ten Miler', 'NYC Marathon', 'NYC Marathon / BULK-0001',
])

test('a listing shows the distances it has a design for', () => {
  assert.deepEqual(listingDistances('Eugene Marathon (+ Half Marathon) Personalized Poster', KEYS), ['Full Marathon', 'Half Marathon'])
  assert.deepEqual(listingDistances('Houston Marathon (+ Half Marathon) Personalized Race Print', KEYS), ['Full Marathon'])
  assert.deepEqual(listingDistances('Philadelphia Personalized Race Print', KEYS), ['Full Marathon', 'Half Marathon', '8K'])
  assert.deepEqual(listingDistances('Detroit Marathon Personalized Race Print', KEYS), ['Full Marathon', 'Half Marathon'])
  assert.deepEqual(listingDistances('Santa Barbara Half Marathon Personalized Race Print', KEYS), ['Half Marathon'])
  assert.deepEqual(listingDistances('Army Ten Miler Personalized Race Print', KEYS), ['10 Miler'])
})

test('old designs, bulk runs and the other edition do not count', () => {
  assert.deepEqual(listingDistances('New York City Personalized Race Print', KEYS), ['Full Marathon'])
  assert.deepEqual(listingDistances('Personalized Chicago World Major Race Poster', KEYS), ['Full Marathon'])
  assert.deepEqual(listingDistances('Personalized Boston World Major Race Poster', KEYS), [])
  assert.deepEqual(listingDistances('Trackstar Gift Card', KEYS), [])
})

test('the wizard check agrees with the pipeline', () => {
  assert.equal(hasDesignFor('Eugene Marathon (+ Half Marathon) Personalized Poster', 'Half Marathon', KEYS), true)
  assert.equal(hasDesignFor('Houston Marathon (+ Half Marathon) Personalized Race Print', 'Half Marathon', KEYS), false)
  assert.equal(hasDesignFor('Houston Marathon (+ Half Marathon) Personalized Race Print', 'Marathon', KEYS), true)
  assert.equal(hasDesignFor('Santa Barbara Half Marathon Personalized Race Print', 'Half Marathon', KEYS), true)
  assert.equal(hasDesignFor('Detroit Marathon Personalized Race Print', 'International Half Marathon', KEYS), true)
  assert.equal(hasDesignFor('Philadelphia Personalized Race Print', '8K', KEYS), true)
  assert.equal(hasDesignFor('Personalized Boston World Major Race Poster', 'Marathon', KEYS), false)
})

test('unknown is never a no', () => {
  assert.equal(hasDesignFor('Houston Marathon Personalized Race Print', '', KEYS), null)
  assert.equal(hasDesignFor('Houston Marathon Personalized Race Print', 'Half Marathon', new Set()), null)
})

test('labels', () => {
  assert.equal(distanceLabel('Marathon'), 'Full Marathon')
  assert.equal(distanceLabel('Motor City Half Marathon'), 'Half Marathon')
  assert.equal(distanceLabel('8k'), '8K')
  assert.equal(distanceLabel('10 Mile'), '10 Miler')
})

test('pills are short, and a one-event race has none', () => {
  assert.deepEqual(listingPills('Eugene Marathon Personalized Race Print', KEYS), ['Full', 'Half'])
  assert.deepEqual(listingPills('Philadelphia Personalized Race Print', KEYS), ['Full', 'Half', '8K'])
  assert.deepEqual(listingPills('New York City Personalized Race Print', KEYS), [])
  assert.deepEqual(listingPills('Army Ten Miler Personalized Race Print', KEYS), [])
  // Houston runs a half we have no design for: the lone tag is the warning.
  assert.deepEqual(listingPills('Houston Marathon Personalized Race Print', KEYS), ['Full'])
})

test('majors listings without the word Marathon still resolve', () => {
  for (const city of ['Berlin', 'London', 'Tokyo', 'Sydney', 'Boston', 'Chicago']) {
    assert.equal(listingRace(`${city} Personalized Race Print`).canonical, listingRace(`${city} Marathon Personalized Race Print`).canonical)
  }
})
