import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quoteRows } from './pricing.js'

// One grid row as buildPricingGrid returns it (Artelo cost at the run's quantity, Shopify retail).
const row = { key: 'x12x18|Framed', sizeLabel: '12x18', frame: 'Framed', frameLabel: 'Premium Oak', productionCost: 36.34, orderShipping: 9.75, brandingCost: 0.8, retailPrice: 130 }

test('retail: one print per order, branding carried, Shopify fee, free shipping over $100', () => {
  const [r] = quoteRows([row], { channel: 'retail' })
  assert.equal(r.unitPrice, 130)
  assert.equal(r.shippingCharged, 0)
  assert.equal(r.unitCost, 46.89) // 36.34 + 9.75 + 0.80
  assert.equal(r.unitFee, 4.07) // 130 * 2.9% + 0.30
  assert.equal(r.grossProfit, 79.04)
})

test('retail under $100 counts the $7 the shopper pays for shipping', () => {
  const [r] = quoteRows([{ ...row, retailPrice: 60 }], { channel: 'retail' })
  assert.equal(r.shippingCharged, 7)
  assert.equal(r.revenue, 67)
})

test('wholesale: discount to whole dollars, shipping split across the run, no branding', () => {
  const [r] = quoteRows([{ ...row, orderShipping: 61.2 }], { channel: 'wholesale', quantity: 50, discountPct: 20 })
  assert.equal(r.unitPrice, 104)
  assert.equal(r.unitBranding, 0)
  assert.equal(r.unitShipping, 1.22)
  assert.equal(r.unitCost, 37.56)
})

test('wholesale: a freight quote or a parcel per runner replaces the consignment rate', () => {
  const [quoted] = quoteRows([row], { channel: 'wholesale', quantity: 10, shippingTotal: 50 })
  assert.equal(quoted.unitShipping, 5)
  const [each] = quoteRows([row], { channel: 'wholesale', quantity: 10, shipMode: 'individual', singleRows: { 'x12x18|Framed': 9.75 } })
  assert.equal(each.unitShipping, 9.75)
})

test('the Photo Add-On adds its price, and a row Artelo could not price is left out', () => {
  const out = quoteRows([row, { key: 'x8x10|Framed', sizeLabel: '8x10', frame: 'Framed', error: 'Artelo get-costs 500' }], { channel: 'retail', includePhoto: true })
  assert.equal(out.length, 1)
  assert.equal(out[0].unitPrice, 150)
})
