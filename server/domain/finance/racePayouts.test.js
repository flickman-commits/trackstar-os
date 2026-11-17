/**
 * What a race is owed: its own prints' lines in the window, net of discounts
 * and refunds, times its share.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tally, payoutCents, termsFor, reportFor } from './racePayouts.js'

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

test('0% is a race that forgoes its share, not an empty field', () => {
  const zero = termsFor({ revSharePct: 0 })
  assert.deepEqual([zero.pct, zero.assumed], [0, false])
  assert.equal(payoutCents(zero, { netSalesCents: 100_000, unitsSold: 10 }), 0)
  assert.equal(termsFor({ revSharePct: null }).pct, 15)
})

test('a race owed nothing gets the sales report without the payout line or the how-to-pay ask', () => {
  const r = { name: 'Test Marathon', poc: { name: 'Pat Lee' }, window: { start: '2026-10-01', end: '2026-11-15' }, terms: termsFor({ revSharePct: 0 }), termsUsed: null, payoutCents: 0, sales: { unitsSold: 4, netSalesCents: 30000 } }
  const rep = reportFor(r)
  assert.ok(!rep.report.includes('Race Payout'))
  assert.ok(!rep.email.includes('get you guys paid'))
  assert.equal(rep.subject, 'Test Marathon Sales Report | Trackstar')
})

test('the partner email gives net sales, the share and the payout, asks how to pay, and offers the gift', () => {
  const r = { name: 'Test Marathon', poc: { name: 'Pat Lee', email: 'pat@example.com' }, window: { start: '2026-09-11', end: '2026-10-26' }, terms: termsFor({ revSharePct: 15 }), termsUsed: null, payoutCents: 11400, sales: { unitsSold: 7, netSalesCents: 76000 } }
  const rep = reportFor(r)
  assert.ok(rep.email.startsWith('Hey Pat,'))
  assert.ok(rep.email.includes('Net Sales: $760.00'))
  assert.ok(rep.email.includes('Race Payout (15%): $114.00'))
  assert.ok(rep.email.includes('get you guys paid'))
  assert.ok(rep.email.includes('gift a free print to someone in your community who ran, or to you'))
  assert.ok(rep.email.indexOf('gift') < rep.email.indexOf('post-mortem'))
  assert.equal(rep.to, 'pat@example.com')
})

test('splits sales by the Eastern day each order was placed, refunds on the order\'s day', () => {
  const orders = [
    // 11:30pm Eastern on Oct 31 is already Nov 1 in UTC: it counts on Oct 31.
    { ...order(1, [line(11, 100, '80.00')]), created_at: '2026-11-01T03:30:00Z' },
    { ...order(2, [line(21, 100, '80.00', 2)], [{ refund_line_items: [{ line_item_id: 21, quantity: 1, subtotal: '80.00' }] }]), created_at: '2026-11-01T15:00:00Z' },
  ]
  const s = tally(['100'], orders)
  assert.deepEqual(s.byDay, { '2026-10-31': { netSalesCents: 8000, unitsSold: 1 }, '2026-11-01': { netSalesCents: 8000, unitsSold: 1 } })
  const days = Object.values(s.byDay)
  assert.equal(days.reduce((n, d) => n + d.netSalesCents, 0), s.netSalesCents)
  assert.equal(days.reduce((n, d) => n + d.unitsSold, 0), s.unitsSold)
  // Priced per day: 20% of each day, or $10 a print.
  assert.equal(payoutCents(termsFor({ revSharePct: 20 }), s.byDay['2026-11-01']), 1600)
  assert.equal(payoutCents(termsFor({ payoutPerOrder: 10 }), s.byDay['2026-10-31']), 1000)
})
