/**
 * Which Trybe days a run pulls, and Trybe as ad spend on the scoreboard.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readTab, planDays } from './trybeSync.js'
import { computeDay } from './scoreboard.js'
import { addDays } from './periods.js'

const tabOf = (first, last, filled = new Set()) => {
  const grid = []
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const [y, m, day] = d.split('-')
    grid.push([`${m}/${day}/${y}`, filled.has(d) ? '$120.00' : ''])
  }
  return readTab(grid)
}

test('reads the tab: row numbers from row 4, filled when Attributed Sales has a value', () => {
  const tab = tabOf('2026-01-01', '2026-01-03', new Set(['2026-01-02']))
  assert.deepEqual(tab.get('2026-01-01'), { row: 4, filled: false })
  assert.deepEqual(tab.get('2026-01-02'), { row: 5, filled: true })
  assert.equal(tab.get('2026-01-03').row, 6)
})

test('re-reads the last two weeks, then backfills the oldest empty days, never past yesterday or before the first day', () => {
  const filled = new Set()
  for (let d = '2026-06-10'; d <= '2026-11-07'; d = addDays(d, 1)) filled.add(d)
  const tab = tabOf('2026-01-01', '2026-12-31', filled)
  const days = planDays(tab, { yesterday: '2026-11-07', first: '2026-06-01', max: 20 })
  assert.equal(days.length, 20)
  assert.equal(days[0], '2026-10-25')       // 14 refresh days end at yesterday
  assert.equal(days[13], '2026-11-07')
  assert.deepEqual(days.slice(14), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06'])
  assert.ok(days.every(d => d >= '2026-06-01' && d <= '2026-11-07'))
})

test('Trybe cost counts as ad spend next to Meta and Google, so it lowers CM and the designer fee base', () => {
  const rules = [{ key: 'designer_fee', effectiveFrom: '2026-11-01', value: { pct: 7.5, base: 'cm' } }]
  const row = { day: '2026-11-05', shopifyNetCents: 100000, shopifyOrders: 10, shopifyFeesCents: 3000, productionCents: 20000, shippingCostCents: 5000, metaSpendCents: 30000, googleSpendCents: 2000, trybeCostCents: 4000 }
  const withTrybe = computeDay(row, rules)
  const without = computeDay({ ...row, trybeCostCents: null }, rules)
  assert.equal(withTrybe.trybe, 4000)
  assert.equal(withTrybe.adSpend, 36000)
  assert.equal(without.adSpend - withTrybe.adSpend, -4000)
  assert.equal(withTrybe.designerFee, Math.round((100000 - 28000 - 36000) * 0.075))
  assert.equal(withTrybe.cm, 100000 - 28000 - 36000 - withTrybe.designerFee)
})

test('Trybe all-in is its cost over the sales it attributed', () => {
  const d = computeDay({ day: '2026-11-03', shopifyNetCents: 4942100, trybeSalesCents: 381508, trybeCostCents: 64775 }, [])
  assert.equal(Math.round(d.trybeAllInPct * 100) / 100, 16.98)
  assert.equal(computeDay({ day: '2026-11-03', shopifyNetCents: 100 }, []).trybeAllInPct, null)
})

test('the weekly Trybe check: ROAS on Meta basis both sides, the break-even after commission, and the margin against other ads', async () => {
  const { weekVerdict } = await import('./trybeCheck.js')
  // The 30 days to Nov 8: Trybe ads $24,574 spend, $51,594 value; account $264,410 / $624,113; Trybe cost $5,523; GM 64.5%.
  const v = weekVerdict({ trybe: { adSpendCents: 2457400, adPurchaseValueCents: 5159400 }, meta: { spendCents: 26441000, purchaseValueCents: 62411300 }, cost: 552300, gmPct: 64.5 })
  assert.equal(v.trybeRoas.toFixed(2), '2.10')
  assert.equal(v.otherRoas.toFixed(2), '2.39')
  assert.equal(v.breakEvenRoas.toFixed(2), '2.86')
  assert.equal(v.afterRoas.toFixed(2), '1.71')
  assert.equal(v.verdict, 'not_paying')
  assert.ok(Math.abs(v.vsOtherCents / 100 - -10080) < 20)
  assert.equal(weekVerdict({ trybe: { adSpendCents: 0, adPurchaseValueCents: 0 }, meta: { spendCents: 100, purchaseValueCents: 200 }, cost: 0, gmPct: 60 }).verdict, 'quiet')
})
