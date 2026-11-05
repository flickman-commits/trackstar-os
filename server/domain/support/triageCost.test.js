import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costOf, costLine } from './triage.js'

test('triage cost prices plain input, cache writes, cache hits and output apart', () => {
  // 1M in total: 600k plain, 100k written to cache, 300k read from cache; 50k out.
  const u = { input: 1_000_000, cacheWrite: 100_000, cached: 300_000, output: 50_000 }
  // 0.6 * $2 + 0.1 * $2.50 + 0.3 * $0.10 + 0.05 * $10
  assert.equal(Math.round(costOf(u) * 1000) / 1000, 1.98)
  assert.equal(costLine(u), '~$1.98 (1.0M tokens in, 50k out)')
})

test('a pass that read nothing costs nothing', () => {
  assert.equal(costOf({ input: 0, cacheWrite: 0, cached: 0, output: 0 }), 0)
})
