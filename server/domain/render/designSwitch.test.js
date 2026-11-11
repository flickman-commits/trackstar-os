import { test } from 'node:test'
import assert from 'node:assert/strict'
import { originalKeyFor, usesOldDesign, sameDesign, placedAt } from './designSwitch.js'
import { changedPrintedFields } from './printed.js'

const at = (iso, extra = {}) => ({ source: 'shopify', trackstarOrderType: 'standard', shopifyOrderData: { created_at: iso }, ...extra })
const before = at('2026-11-11T10:59:00-05:00')
const after = at('2026-11-11T11:01:00-05:00')

test('bought before 11 AM ET gets the old design, after gets the new one', () => {
  assert.equal(originalKeyFor(before, 'Philadelphia Marathon'), 'Philadelphia Marathon / Original')
  assert.equal(originalKeyFor(after, 'Philadelphia Marathon'), null)
  assert.equal(originalKeyFor(before, 'NYC Marathon'), 'NYC Marathon / Original')
  assert.equal(originalKeyFor(before, 'Chicago Marathon'), 'Chicago Marathon / Original')
  assert.equal(originalKeyFor(after, 'NYC Marathon'), null)
  assert.equal(originalKeyFor(before, 'Philadelphia Marathon / Half Marathon'), 'Philadelphia Marathon / Half Marathon / Original')
})

test('races and editions that did not switch keep their file', () => {
  assert.equal(originalKeyFor(before, 'Boston Marathon'), null)
  assert.equal(originalKeyFor(before, 'Chicago Marathon / World Majors'), null)
  assert.equal(originalKeyFor(before, 'Philadelphia Marathon / 8K'), null)
})

test('the time that counts is when they bought, not when we imported it', () => {
  const lateImport = { ...before, createdAt: '2026-11-11T16:30:00Z' }
  assert.equal(placedAt(lateImport).toISOString(), '2026-11-11T15:59:00.000Z')
  assert.equal(originalKeyFor(lateImport, 'Philadelphia Marathon'), 'Philadelphia Marathon / Original')
})

test('Etsy orders all predate the switch', () => {
  assert.equal(originalKeyFor({ source: 'etsy', createdAt: '2026-11-12T00:00:00Z' }, 'Philadelphia Marathon'), 'Philadelphia Marathon / Original')
})

test('the banner flag follows the race, standard prints only', () => {
  assert.equal(usesOldDesign(before, 'Philadelphia Marathon'), true)
  assert.equal(usesOldDesign(after, 'Philadelphia Marathon'), false)
  assert.equal(usesOldDesign(before, 'NYC Marathon'), true)
  assert.equal(usesOldDesign(before, 'Chicago Marathon'), true)
  assert.equal(usesOldDesign(before, 'Boston Marathon'), false)
  assert.equal(usesOldDesign({ ...before, trackstarOrderType: 'custom' }, 'Chicago Marathon'), false)
})

test('a design made before the main file became the new design is the old design: it still sends', () => {
  assert.equal(sameDesign('Philadelphia Marathon / Original', 'Philadelphia Marathon', '2026-11-08T20:00:00Z'), true)
  assert.deepEqual(changedPrintedFields({ template: 'Philadelphia Marathon / Original', size: '12x18' }, { template: 'Philadelphia Marathon', size: '12x18' }, { renderedAt: '2026-11-09T12:00:00Z' }), [])
})

test('NYC and Chicago: designs made before 11 AM ET are the old design', () => {
  assert.equal(sameDesign('NYC Marathon / Original', 'NYC Marathon', '2026-11-10T20:00:00Z'), true)
  assert.equal(sameDesign('Chicago Marathon / Original', 'Chicago Marathon', '2026-11-11T15:30:00Z'), true)
  assert.equal(sameDesign('NYC Marathon / Original', 'NYC Marathon', '2026-11-11T16:05:00Z'), false)
})

test('a design made from the main file once it was the new design is not the old design', () => {
  // Philadelphia's main file has been the new design since Nov 9, 4:14 PM ET.
  assert.equal(sameDesign('Philadelphia Marathon / Original', 'Philadelphia Marathon', '2026-11-10T15:00:00Z'), false)
  assert.equal(sameDesign('Philadelphia Marathon / Original', 'Philadelphia Marathon', null), false)
  assert.deepEqual(changedPrintedFields({ template: 'Boston Marathon / Original' }, { template: 'Boston Marathon' }, { renderedAt: '2026-11-10T00:00:00Z' }), ['template'])
})
