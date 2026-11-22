import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pipelineFor, noPersonalization } from './pipeline.js'

// 9643: Buy again rebuilt the cart with no personalization; the email asked for name and bib, never the paid photo.
const order = { id: 'o1', status: 'pending', raceName: 'NYC Marathon', raceYear: 2026, runnerName: 'Unknown Runner', productSize: '12x18' }

test('a print with no runner name is No personalization, ahead of the lookup stages', () => {
  const p = pipelineFor({ order, research: { researchStatus: 'not_found' }, hasScraper: true, templates: new Set() })
  assert.equal(p.stage, 'action')
  assert.equal(p.reason, 'No personalization')
  assert.match(p.fix, /runner's name and the bib/)
})

test('the fix asks for the year when missing and the photo when paid for', () => {
  const p = pipelineFor({ order: { ...order, raceYear: null }, photoMissing: true, templates: new Set() })
  assert.equal(p.reason, 'No personalization')
  assert.match(p.fix, /the runner's name, the year, the bib and the photo they paid for/)
  assert.match(p.fix, /Add photo/)
})

test('a name typed in, or a result found, ends it', () => {
  assert.equal(noPersonalization({ ...order, runnerNameOverride: 'Alexander Denha' }, null), false)
  assert.equal(noPersonalization(order, { researchStatus: 'found' }), false)
  assert.equal(noPersonalization({ ...order, runnerName: 'Jane Doe' }, null), false)
  assert.equal(noPersonalization({ ...order, runnerName: '' }, null), true)
})

test('a completed order stays done', () => {
  assert.equal(pipelineFor({ order: { ...order, status: 'completed' } }).stage, 'done')
})
