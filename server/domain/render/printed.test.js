import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendDecision, changedPrintedFields, describeFields } from './printed.js'

const approved = { spec: { template: 'Chicago', size: '12x18', name: 'Jon Smith', bib: '1234', time: '3:59:59', pace: '9:09', noTime: false, date: 'October 12, 2026', condition: 'Sunny', temp: '61°F', photoPath: null, file: '4551_Chicago_Smith' } }
const now = spec => ({ ok: true, reasons: [], spec: { ...approved.spec, ...spec } })

test('a name the customer fixed after approval is not sent', () => {
  const d = sendDecision(approved, now({ name: 'John Smith' }))
  assert.deepEqual(d, { action: 'stale', fields: ['name'] })
})

test('a corrected time or race date after approval is not sent', () => {
  assert.deepEqual(sendDecision(approved, now({ time: '3:58:12', pace: '9:06' })).fields, ['time', 'pace'])
  assert.deepEqual(sendDecision(approved, now({ date: 'October 11, 2026' })).fields, ['date'])
})

test('an unchanged order sends, whatever else is on the spec', () => {
  assert.deepEqual(sendDecision(approved, now({ file: 'renamed', dateSource: 'race site' })), { action: 'send' })
})

test('an order that cannot be checked right now is held, not closed', () => {
  const d = sendDecision(approved, { ok: false, reasons: ['No prepared template for Chicago'], spec: null })
  assert.equal(d.action, 'wait')
  assert.deepEqual(d.reasons, ['No prepared template for Chicago'])
  assert.equal(sendDecision(approved, null).action, 'wait')
})

test('a custom final PDF is not a rendered design and is sent as approved', () => {
  assert.deepEqual(sendDecision({ spec: { kind: 'custom_final', file: 'x.pdf' } }, null), { action: 'send' })
})

test('missing and null printed fields count as the same', () => {
  assert.deepEqual(changedPrintedFields({ template: 'A', photoPath: null }, { template: 'A' }), [])
})

test('changed fields read as words', () => {
  assert.equal(describeFields(['name', 'date', 'condition']), 'name, race date, weather')
})
