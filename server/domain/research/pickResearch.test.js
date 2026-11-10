import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickResearch } from './pickResearch.js'

const chicago = { id: 2, researchStatus: 'found', officialTime: '3:10:00', race: { raceName: 'Chicago Marathon', year: 2026 } }
const nyc = { id: 3, researchStatus: 'not_found', officialTime: null, race: { raceName: 'NYC Marathon', year: 2026 } }

test('a result found for the race the order used to say is ignored', () => {
  assert.equal(pickResearch([nyc, chicago], 'NYC Marathon', 2026), nyc)
  assert.equal(pickResearch([chicago], 'NYC Marathon', 2026), null)
})

test('a result for another year of the same race is ignored', () => {
  assert.equal(pickResearch([chicago], 'Chicago Marathon', 2025), null)
})

test('the found row for the order race wins over a newer failed one', () => {
  const retry = { ...chicago, id: 9, researchStatus: 'not_found' }
  assert.equal(pickResearch([retry, chicago], 'Chicago Marathon', 2026), chicago)
})

test('race names match on their canonical spelling', () => {
  const canonical = n => (n === 'New York City Marathon' ? 'NYC Marathon' : n)
  const row = { ...nyc, researchStatus: 'found', race: { raceName: 'New York City Marathon', year: 2026 } }
  assert.equal(pickResearch([row], 'NYC Marathon', 2026, canonical), row)
})
