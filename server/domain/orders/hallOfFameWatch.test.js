import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSeconds, placings, likelyMan } from './hallOfFameWatch.js'

const board = {
  Male: ['2:14', '2:19', '2:21', '2:23', '2:24'].map(t => ({ seconds: toSeconds(t) })),
  Female: ['2:29', '2:36', '2:37', '2:41', '2:44'].map(t => ({ seconds: toSeconds(t) })),
}

test('a time places on each list it would crack, counting the listed minute', () => {
  assert.deepEqual(placings(toSeconds('2:14:45'), board), { Male: 1, Female: 1 })
  assert.deepEqual(placings(toSeconds('2:24:59'), board), { Male: 5, Female: 1 })
  assert.deepEqual(placings(toSeconds('2:25:00'), board), { Female: 1 })
  assert.deepEqual(placings(toSeconds('2:33:21'), board), { Female: 2 })
  assert.deepEqual(placings(toSeconds('2:45:00'), board), {})
})

test('a common man\'s first name skips the women\'s list only', () => {
  assert.equal(likelyMan('Jack Rosencrans'), true)
  assert.equal(likelyMan('Monica Hebner'), false)
  assert.equal(likelyMan('Taylor Somers'), false)
})
