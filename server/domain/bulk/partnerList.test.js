// A partner can change their own list until a runner's print is in production.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inProduction } from './bulkOrders.js'

test('a rendered, approved print that has not gone to Artelo can still be changed', () => {
  assert.equal(inProduction({ status: 'ready', productionFileUrl: 'https://x/print.pdf', arteloOrderData: {} }), false)
  assert.equal(inProduction({ status: 'pending', arteloOrderData: null }), false)
  assert.equal(inProduction({}), false)
})

test('an order at Artelo, one being created there, a sent one or one closed by hand is locked', () => {
  assert.equal(inProduction({ arteloOrderData: { id: 'A123' } }), true)
  assert.equal(inProduction({ arteloOrderData: { creatingAt: '2026-11-18T00:00:00Z' } }), true)
  assert.equal(inProduction({ bulkSentAt: new Date() }), true)
  assert.equal(inProduction({ status: 'completed' }), true)
})
