/**
 * The scoreboard math against two days the Daily Tracker already shows:
 * Nov 1 2026 (designer fee under profit, 7.5% of contribution margin) and
 * Oct 1 2026 (designer fee inside COGS, 7.5% of gross profit).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDay, summarize } from './scoreboard.js'
import { parseCell, parseDate, parseTab, TABS } from './sheetSync.js'
import { resolvePeriod, mondayOf, addDays } from './periods.js'

const RULES = [
  { key: 'designer_fee', effectiveFrom: '2000-01-01', value: { pct: 7.5, base: 'gp' } },
  { key: 'designer_fee', effectiveFrom: '2026-11-01', value: { pct: 7.5, base: 'cm' } },
  { key: 'shopify_fee', effectiveFrom: '2000-01-01', value: { pct: 2.9, perOrderCents: 30 } },
]

test('Nov 1 2026 matches the sheet: fee under profit, 7.5% of CM', () => {
  const d = computeDay({
    day: '2026-11-01', shopifyNetCents: 4921912, shopifyOrders: 366, shopifyFeesCents: 153715, shopifySessions: 13213, shopifyAddToCart: 678, shopifyReachedCheckout: 432, shopifyCompletedCheckout: 362,
    etsyNetCents: 84500, etsyOrders: 8, etsyFeesCents: 9035, productionCents: 1238247, shippingCostCents: 335135, unitsProduced: 497,
    metaSpendCents: 1275400, metaPurchases: 331, metaPurchaseValueCents: 4386500, googleSpendCents: 112500, googleConversions: null,
  }, RULES)
  assert.equal(d.revenue, 5006412)
  assert.equal(d.cogs, 153715 + 9035 + 1238247 + 335135)          // $17,361 without the fee
  assert.equal(Math.round(d.grossProfit / 100), 32703)
  assert.equal(Math.round(d.designerFee / 100), 1412)
  assert.equal(Math.round(d.cm / 100), 17412)
  assert.equal(d.cmPct.toFixed(1), '34.8')
  assert.equal(d.roas.toFixed(2), '3.61')
  assert.equal(d.aov, 13386)
  assert.equal(d.cpa, 3711)
  assert.equal(d.breakevenCpa, 8744)
  assert.equal(d.organicOrders, 43)
  assert.equal(d.organicPct.toFixed(2), '11.50')
  assert.equal(d.costPerUnit, 3166)
  assert.equal(d.cvr.toFixed(1), '2.7')
})

test('Oct 1 2026 matches the sheet: fee inside COGS, 7.5% of gross profit', () => {
  const d = computeDay({ day: '2026-10-01', shopifyNetCents: 128900, shopifyOrders: 10, shopifyFeesCents: 4038, etsyNetCents: null, productionCents: 63600, shippingCostCents: 10300, metaSpendCents: 42200, googleSpendCents: 7200, metaPurchases: 8, googleConversions: 0 }, RULES)
  assert.equal(Math.round(d.designerFee / 100), 38)
  assert.equal(Math.round(d.cogs / 100), 818)
  assert.equal(Math.round(d.grossProfit / 100), 471)
  assert.equal(Math.round(d.cm / 100), -23)
  assert.equal(Math.round(d.breakevenCpa / 100), 47) // the sheet shows $47.10 from unrounded inputs; these are the rounded display values
  assert.equal(d.organicOrders, 2)
})

test('Shopify fees fall back to 2.9% + 30c when the sheet column is empty', () => {
  const d = computeDay({ day: '2026-11-01', shopifyNetCents: 4921912, shopifyOrders: 366, shopifyFeesCents: null }, RULES)
  assert.equal(d.shopifyFees, 153715)
})

test('a day with nothing landed is left out of a period', () => {
  const s = summarize([{ day: '2026-11-01', shopifyNetCents: 10000, shopifyOrders: 1 }, { day: '2026-11-02' }], RULES)
  assert.equal(s.dayCount, 1)
  assert.equal(s.revenue, 10000)
  assert.equal(s.lastLanded, '2026-11-01')
  assert.equal(s.days.length, 2)
})

test('the sheet is parsed as it is formatted', () => {
  assert.equal(parseCell('$16,840.00', 'money'), 1684000)
  assert.equal(parseCell('1171.5', 'money'), 117150)
  assert.equal(parseCell('35.394284', 'money'), 3539)
  assert.equal(parseCell('1,287', 'count'), 1287)
  assert.equal(parseCell('-', 'money'), null)
  assert.equal(parseCell('', 'count'), null)
  assert.equal(parseCell('($23)', 'money'), -2300)
  assert.equal(parseDate('11/03/2026'), '2026-11-03')
  assert.equal(parseDate('nope'), null)
  const shopify = TABS.find(t => t.id === 'shopify')
  const rows = parseTab(shopify, [
    ['Date', 'Gross Sales', 'Discounts', 'Returns', 'Shipping Charges', 'Taxes', 'Net Sales', 'Orders', 'Sessions', 'Add to Cart', 'Reached Checkout', 'Completed Checkout', 'Shopify Fees'],
    ['11/01/2026', '$51,340.00', '3052.5', '80', '$612.00', '399.62', '$49,219.12', '366', '13213', '678', '432', '362', '$1,537.15'],
    ['11/03/2026', '', '', '', '', '', '-', '', '', '', '', '', '-'],
  ])
  assert.equal(rows.get('2026-11-01').shopifyNetCents, 4921912)
  assert.equal(rows.get('2026-11-01').shopifyOrders, 366)
  assert.equal(rows.get('2026-11-03').shopifyNetCents, null)
})

test('periods and weeks', () => {
  assert.equal(mondayOf('2026-11-03'), '2026-11-02')
  assert.equal(mondayOf('2026-11-08'), '2026-11-02')
  assert.equal(addDays('2026-10-30', 3), '2026-11-02')
  const mtd = resolvePeriod('mtd', '2026-11-03')
  assert.deepEqual([mtd.first, mtd.last, mtd.compare.first, mtd.compare.last], ['2026-11-01', '2026-11-03', '2026-10-01', '2026-10-03'])
  const lm = resolvePeriod('last_month', '2026-11-03')
  assert.deepEqual([lm.first, lm.last], ['2026-10-01', '2026-10-31'])
  const custom = resolvePeriod('2026-10-01..2026-10-07', '2026-11-03')
  assert.deepEqual([custom.compare.first, custom.compare.last], ['2026-09-24', '2026-09-30'])
})
