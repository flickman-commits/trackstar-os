/**
 * What a race is owed: its own prints' lines in the window, net of discounts
 * and refunds, times its share.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tally, payoutCents, termsFor } from './racePayouts.js'

const order = (id, lines, refunds = []) => ({ id, created_at: '2026-10-01T16:00:00Z', line_items: lines, refunds })
const line = (id, productId, price, qty = 1, discount = '0.00') => ({ id, product_id: productId, price, quantity: qty, total_discount: discount })

test('counts only the race\'s own products, matching the catalog gid to the REST number', () => {
  const orders = [
    order(1, [line(11, 100, '75.00'), line(12, 999, '40.00')]),
    order(2, [line(21, 999, '75.00')]),
  ]
  const s = tally(['gid://shopify/Product/100'], orders)
  assert.equal(s.grossCents, 7500)
  assert.equal(s.unitsSold, 1)
  assert.equal(s.orders, 1)
})

test('net of discounts and refunds on those lines only', () => {
  const orders = [
    order(1, [line(11, 100, '75.00', 2, '15.00'), line(12, 999, '40.00')], [
      { refund_line_items: [{ line_item_id: 11, quantity: 1, subtotal: '67.50' }, { line_item_id: 12, quantity: 1, subtotal: '40.00' }] },
    ]),
  ]
  const s = tally(['100'], orders)
  assert.equal(s.grossCents, 15000)
  assert.equal(s.discountCents, 1500)
  assert.equal(s.refundCents, 6750)
  assert.equal(s.netSalesCents, 6750)
  assert.equal(s.unitsSold, 1)
})

test('rev share times net sales, rounded to the cent', () => {
  const terms = termsFor({ revSharePct: 15 })
  assert.equal(payoutCents(terms, { netSalesCents: 123_45, unitsSold: 3 }), 1852)
  assert.equal(termsFor({}).assumed, true)
})
