import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paidPhotoMissing } from './photoPayment.js'

const addon = (extra = {}) => ({ id: 2, title: 'Photo Add-On', quantity: 1, properties: [], ...extra })
const print = (props = []) => ({ id: 1, title: 'New York City Personalized Race Print', quantity: 1, properties: props })
const row = (line_items, extra = {}) => ({ source: 'shopify', photoPath: null, photoLater: false, shopifyOrderData: { financial_status: 'paid', line_items }, ...extra })

test('9643: a paid Photo Add-On and no photo on the order is a missing photo', () => {
  assert.equal(paidPhotoMissing(row([addon(), print()])), true)
})
test('a photo that came with the order at checkout covers the add-on', () => {
  assert.equal(paidPhotoMissing(row([print([{ name: '_photo_path', value: '2026-11-12/a.jpg' }]), addon({ properties: [{ name: '_photo_path', value: '2026-11-12/a.jpg' }] })])), false)
})
test('a row with its photo attached, a refunded add-on, an unpaid order or no add-on is not missing one', () => {
  assert.equal(paidPhotoMissing(row([addon(), print()], { photoPath: 'p.jpg' })), false)
  assert.equal(paidPhotoMissing(row([addon({ current_quantity: 0 }), print()])), false)
  assert.equal(paidPhotoMissing({ ...row([addon(), print()]), shopifyOrderData: { financial_status: 'pending', line_items: [addon(), print()] } }), false)
  assert.equal(paidPhotoMissing(row([print()])), false)
})
test('a photo the customer sends after the race and an Etsy order are left alone', () => {
  assert.equal(paidPhotoMissing(row([addon(), print()], { photoLater: true })), false)
  assert.equal(paidPhotoMissing(row([addon(), print()], { source: 'etsy' })), false)
})
test('two prints, one add-on, one photo at checkout: the other print is not short', () => {
  assert.equal(paidPhotoMissing(row([print([{ name: '_photo_path', value: 'a.jpg' }]), print(), addon()])), false)
})
