/** Two-week pay periods: Monday to Sunday, paid the Monday after, from Nov 2, 2026, both ways. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { payPeriodOf } from './periods.js'

test('a week falls in its two-week period, paid the Monday after it ends', () => {
  assert.deepEqual(payPeriodOf('2026-11-02'), { start: '2026-11-02', end: '2026-11-15', payday: '2026-11-16' })
  assert.deepEqual(payPeriodOf('2026-11-09'), { start: '2026-11-02', end: '2026-11-15', payday: '2026-11-16' })
  assert.deepEqual(payPeriodOf('2026-11-15'), { start: '2026-11-02', end: '2026-11-15', payday: '2026-11-16' })
  assert.deepEqual(payPeriodOf('2026-11-16'), { start: '2026-11-16', end: '2026-11-29', payday: '2026-11-30' })
  assert.deepEqual(payPeriodOf('2026-10-26'), { start: '2026-10-19', end: '2026-11-01', payday: '2026-11-02' })
  assert.deepEqual(payPeriodOf('2026-11-30'), { start: '2026-11-30', end: '2026-12-13', payday: '2026-12-14' })
})
