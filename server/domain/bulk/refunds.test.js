/**
 * Bulk refunds: the suggestion for the prints with no runner, the Shopify
 * payment to refund against, and who can be marked DNF.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestAmounts, refundableTransaction } from './refunds.js'
import { dnfBlocker } from './dnf.js'

test('the prints with no runner get their share of what was paid, discount and tax included', () => {
  // 145 paid for, 80 being made: 65 with no runner, 65/145 of $10,000.
  const s = suggestAmounts({ paidCents: 1000000, refundedCents: 0, quantity: 145, unfilled: 65 })
  assert.equal(s.unfilledCents, 448276)
  assert.equal(s.fullCents, 1000000)
  assert.equal(s.perPrintCents, 6897)
})

test('a suggestion never refunds more than is left', () => {
  const s = suggestAmounts({ paidCents: 100000, refundedCents: 90000, quantity: 10, unfilled: 5 })
  assert.equal(s.leftCents, 10000)
  assert.equal(s.unfilledCents, 10000)
  assert.equal(s.fullCents, 10000)
  assert.deepEqual(suggestAmounts({ paidCents: null, quantity: 10, unfilled: 5 }), { fullCents: null, unfilledCents: null, perPrintCents: null, leftCents: null })
})

test('a Shopify refund goes against the successful sale, not a failed try or an earlier refund', () => {
  const t = refundableTransaction([
    { id: 'a', kind: 'SALE', status: 'FAILURE', amountSet: { shopMoney: { amount: '500.00' } } },
    { id: 'b', kind: 'SALE', status: 'SUCCESS', amountSet: { shopMoney: { amount: '450.00' } } },
    { id: 'c', kind: 'REFUND', status: 'SUCCESS', amountSet: { shopMoney: { amount: '50.00' } } },
  ])
  assert.equal(t.id, 'b')
  assert.equal(refundableTransaction([{ id: 'x', kind: 'AUTHORIZATION', status: 'SUCCESS' }]), null)
})

test('a runner can be marked DNF only on a bulk order and only before their print went to production', () => {
  const runner = { trackstarOrderType: 'bulk', bulkOrderId: 'b1', status: 'ready', bulkSentAt: null, bulkDnfAt: null }
  assert.equal(dnfBlocker(runner), null)
  assert.match(dnfBlocker({ ...runner, bulkSentAt: new Date() }), /already went to production/)
  assert.match(dnfBlocker({ ...runner, status: 'completed' }), /already went to production/)
  assert.match(dnfBlocker({ ...runner, bulkDnfAt: new Date() }), /Already/)
  assert.match(dnfBlocker({ ...runner, trackstarOrderType: 'standard' }), /bulk order/)
  assert.equal(dnfBlocker(null), 'Runner not found')
})
