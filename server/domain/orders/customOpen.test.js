import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OPEN_CUSTOM, isShopCanceled, shopCanceledAt } from './customOpen.js'

test('a custom needs designing only while it is neither sent nor completed', () => {
  // 10775: canceled from Support, so completed, with the design still not_started.
  assert.deepEqual(OPEN_CUSTOM, { trackstarOrderType: 'custom', designStatus: { not: 'sent_to_production' }, status: { not: 'completed' } })
})

test('canceled means the shop says so, not just that the order is completed', () => {
  assert.equal(isShopCanceled({ status: 'completed', shopifyOrderData: { cancelled_at: null } }), false)
  assert.equal(isShopCanceled({ status: 'completed', shopifyOrderData: { cancelled_at: '2026-11-23T22:48:19Z' } }), true)
  assert.equal(shopCanceledAt({ shopifyOrderData: { cancelled_at: '2026-11-23T22:48:19Z' } }), '2026-11-23T22:48:19Z')
  assert.equal(isShopCanceled({ etsyOrderData: { status: 'Canceled' } }), true)
  assert.equal(isShopCanceled({ etsyOrderData: { status: 'Completed' } }), false)
  assert.equal(isShopCanceled({}), false)
})
