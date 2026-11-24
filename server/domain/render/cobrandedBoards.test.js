import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardsByEvent } from './cobrandedBoards.js'

const race = 'Philadelphia Marathon'
const aha = ['AHA_Philadelphia Marathon 8x10', 'AHA_Philadelphia Half Marathon 8x10', 'AHA_Philadelphia 8K 8x10']

test('every distance in one file: each artboard goes to its event', () => {
  assert.deepEqual(boardsByEvent(race, aha).map(b => b.event), [null, 'Half Marathon', '8K'])
  assert.deepEqual(boardsByEvent(race, aha).map(b => b.artboard), aha)
  assert.deepEqual(boardsByEvent(race, ['X_Philadelphia_8x10', 'X_Philadelphia_10K_8x10']).map(b => b.event), [null, '10K'])
})

test('names that do not say which is which are left for a person', () => {
  assert.equal(boardsByEvent(race, ['AHA 8x10', 'AHA copy 8x10']), null)
  assert.equal(boardsByEvent(race, ['AHA Half 8x10', 'AHA 8K 8x10']), null)
  assert.equal(boardsByEvent(race, ['AHA 8x10']), null)
})
