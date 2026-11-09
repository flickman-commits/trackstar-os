/** Shopify charges sales tax from the address on the draft, so the invoice needs a full one. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxAddressGap, provinceCode, draftInput } from './billing.js'

const addr = (o = {}) => ({ company: 'Club', name: 'Pat', address1: '1 Main St', address2: '', city: 'Duluth', province: 'MN', zip: '55802', country: 'US', phone: '', ...o })

test('prints to each runner: the billing address is the tax address', () => {
  assert.match(taxAddressGap({ shipping: 'runner', billingAddress: null }), /billing address/)
  assert.match(taxAddressGap({ shipping: 'runner', billingAddress: addr({ province: '' }) }), /state/)
  assert.equal(taxAddressGap({ shipping: 'runner', billingAddress: addr() }), null)
})

test('prints to the organization: the ship-to address is the tax address', () => {
  assert.match(taxAddressGap({ shipping: 'organization', billingAddress: addr(), shipToAddress: addr({ zip: '' }) }), /ship-to address/)
  assert.equal(taxAddressGap({ shipping: 'organization', billingAddress: null, shipToAddress: addr() }), null)
})

test('a state typed out becomes its code', () => {
  assert.equal(provinceCode(addr({ province: 'Minnesota' })), 'MN')
  assert.equal(provinceCode(addr({ province: 'new york' })), 'NY')
  assert.equal(provinceCode(addr({ province: 'ON', country: 'CA' })), 'ON')
  assert.equal(taxAddressGap({ shipping: 'runner', billingAddress: addr({ province: 'Minnesota' }) }), null)
})

test('the draft carries the address with the state code', () => {
  const order = { number: 'BULK-0009', partnerName: 'Club', contactName: 'Pat', shipping: 'runner', billingAddress: addr({ province: 'Minnesota' }), printKind: 'standard' }
  const input = draftInput({ order, lines: [{ variantId: 'gid://x', quantity: 3, raceName: 'R', raceYear: 2026, number: 'BULK-0009' }] })
  assert.equal(input.shippingAddress.provinceCode, 'MN')
  assert.equal(input.billingAddress.zip, '55802')
})
