import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime } from './printFormat.js'

test('a time prints without a leading zero, and under an hour as minutes (Philadelphia 8K)', () => {
  assert.equal(formatTime('03:05:09'), '3:05:09')
  assert.equal(formatTime('1:02:22'), '1:02:22')
  assert.equal(formatTime('00:49:59'), '49:59')
  assert.equal(formatTime('0:09:30'), '9:30')
  assert.equal(formatTime('49:59'), '49:59')
  assert.equal(formatTime('0:49:59.6'), '50:00')
})
