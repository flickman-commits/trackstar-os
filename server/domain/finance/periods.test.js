/** Two-week pay periods: Monday to the Sunday they are paid, from Nov 2, 2026, both ways. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { payPeriodOf } from './periods.js'

test('a week falls in the two-week period that is paid the Sunday it ends', () => {
  assert.deepEqual(payPeriodOf('2026-11-02'), { start: '2026-11-02', end: '2026-11-15' })
  assert.deepEqual(payPeriodOf('2026-11-09'), { start: '2026-11-02', end: '2026-11-15' })
  assert.deepEqual(payPeriodOf('2026-11-15'), { start: '2026-11-02', end: '2026-11-15' })
  assert.deepEqual(payPeriodOf('2026-11-16'), { start: '2026-11-16', end: '2026-11-29' })
  assert.deepEqual(payPeriodOf('2026-10-26'), { start: '2026-10-19', end: '2026-11-01' })
  assert.deepEqual(payPeriodOf('2026-11-30'), { start: '2026-11-30', end: '2026-12-13' })
})
