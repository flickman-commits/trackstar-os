import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventFilesNeeded, soldEvents } from './eventFiles.js'
import { templateFor, wrongEventFile } from '../render/spec.js'

const race = 'Philadelphia Marathon'
const order = { trackstarOrderType: 'bulk', raceName: race, raceYear: 2026, bulkOrder: { number: 'BULK-0005', printKind: 'cobranded' } }

test('a co-branded runner prints from the file for the distance they ran', () => {
  assert.equal(templateFor(order, race, 'Marathon'), 'Philadelphia Marathon / BULK-0005')
  assert.equal(templateFor(order, race, null), 'Philadelphia Marathon / BULK-0005')
  assert.equal(templateFor(order, race, 'Half Marathon'), 'Philadelphia Marathon / BULK-0005 / Half Marathon')
  assert.equal(templateFor(order, race, '8K'), 'Philadelphia Marathon / BULK-0005 / 8K')
})

test("a half runner's design made from the marathon file is wrong; a marathoner's is not", () => {
  const ran = eventType => ({ ...order, runnerResearch: [{ researchStatus: 'found', eventType, race: { raceName: race, year: 2026 } }] })
  assert.equal(wrongEventFile(ran('Half Marathon'), 'Philadelphia Marathon / BULK-0005'), true)
  assert.equal(wrongEventFile(ran('Half Marathon'), 'Philadelphia Marathon / BULK-0005 / Half Marathon'), false)
  assert.equal(wrongEventFile(ran('Marathon'), 'Philadelphia Marathon / BULK-0005'), false)
  assert.equal(wrongEventFile({ ...order, runnerResearch: [] }, 'Philadelphia Marathon / BULK-0005'), false)
})

test('the files a run needs: what was sold, then what the runners really ran', () => {
  assert.deepEqual(soldEvents('Full 5, Half 5, 10K 3'), ['Marathon', 'Half Marathon', '10K'])
  const run = { raceName: race, events: 'Full 5, Half 5, 10K 3' }
  assert.deepEqual(eventFilesNeeded(run).map(f => f.event), [null, '10K', 'Half Marathon'])
  const ran = eventFilesNeeded(run, ['Marathon', 'Half Marathon', '8K', '8K'])
  assert.deepEqual(ran.map(f => [f.label, f.runners]), [['Marathon', 1], ['8K', 2], ['Half Marathon', 1]])
  assert.deepEqual(eventFilesNeeded({ raceName: race, events: null }).map(f => f.event), [null])
  assert.deepEqual(eventFilesNeeded({ raceName: race }, ['Half Marathon']).map(f => f.event), ['Half Marathon'])
})
