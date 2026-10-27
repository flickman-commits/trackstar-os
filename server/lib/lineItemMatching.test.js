import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShopifyMatchMap, carryEditedProperties, isRemovedLineItem } from './lineItemMatching.js'
import { reconcileEditedOrder } from '../processOrders.js'

// Order #4084: an 8x10 unframed print was swapped for 8x10 Black Oak after
// purchase. Shopify keeps the removed line at current_quantity 0 with the
// customer's answers; the added line is bare.
const PRODUCT = 10155040145691
const props = [
  { name: 'Runner Name (First & Last)', value: 'Arya Davachi' },
  { name: 'Race Year', value: '2026' },
  { name: '_lookup_verified', value: 'true' },
]
const lines = [
  { id: 1001, product_id: PRODUCT, title: 'St. George Marathon Personalized Race Print', variant_title: '8x10 / Unframed', sku: 'sgm-s1p-8x10-unf-am', current_quantity: 0, properties: props },
  { id: 1002, product_id: 1, title: 'Photo Add-On', variant_title: null, sku: null, current_quantity: 1, properties: [{ name: '_addon_for', value: 'x' }] },
  { id: 1003, product_id: PRODUCT, title: 'St. George Marathon Personalized Race Print', variant_title: '8x10 / Black Oak', sku: 'sgm-s1p-8x10-bl-pok-am', current_quantity: 1, properties: [] },
]
const before = [
  { orderItemId: '1001', product: { size: 'x8x10', frameColor: 'Unframed' } },
  { orderItemId: '1002', product: null },
]
const after = [
  { orderItemId: '1002', product: null },
  { orderItemId: '1003', product: { size: 'x8x10', frameColor: 'BlackPremiumOak' } },
]

test('a removed line is never matched; the Artelo id pairs exactly', () => {
  assert.equal(isRemovedLineItem(lines[0]), true)
  assert.deepEqual(buildShopifyMatchMap(after, lines), [-1, 2])
})

test('the added line takes the removed line\'s personalization', () => {
  const out = carryEditedProperties(lines)
  assert.equal(out[2].properties.find(p => p.name === 'Runner Name (First & Last)').value, 'Arya Davachi')
  assert.equal(out[2].properties.find(p => p.name === '_carried_from').value, '1001')
  assert.equal(out[0], lines[0])
  assert.equal(out[1], lines[1])
})

test('an unedited order is left as it is', () => {
  const plain = [{ ...lines[0], current_quantity: 1 }, lines[1]]
  assert.equal(carryEditedProperties(plain), plain)
  assert.deepEqual(buildShopifyMatchMap(before, plain), [0, -1])
})

function fakePrisma(rows) {
  const comments = []
  return {
    comments,
    rows,
    order: {
      findMany: async () => rows,
      update: async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id), data),
    },
    orderComment: { create: async ({ data }) => { comments.push(data); return data } },
  }
}

test('the old row moves onto the new item and keeps its work', async () => {
  const db = fakePrisma([{ id: 'r0', lineItemIndex: 0, status: 'ready', runnerName: 'Arya Davachi', productSize: '8x10', frameType: 'Unframed', arteloOrderData: { orderItems: before } }])
  const out = await reconcileEditedOrder(db, { orderId: '4084', orderItems: after }, { shopifyOrderData: { line_items: lines } })
  assert.deepEqual(out, { moved: 1, flagged: 0 })
  const r = db.rows[0]
  assert.equal(r.lineItemIndex, 1)
  assert.equal(r.orderNumber, '4084-1')
  assert.equal(r.frameType, 'BlackPremiumOak')
  assert.equal(r.runnerName, 'Arya Davachi')
  assert.equal(r.status, 'ready')
  assert.match(db.comments[0].text, /8x10 \/ Unframed became 8x10 \/ Black Oak/)
})

test('a print removed with nothing in its place is flagged, not deleted', async () => {
  const db = fakePrisma([{ id: 'r0', lineItemIndex: 0, status: 'pending', productSize: '8x10', frameType: 'Unframed', arteloOrderData: { orderItems: before } }])
  const out = await reconcileEditedOrder(db, { orderId: '4084', orderItems: [after[0]] }, { shopifyOrderData: { line_items: lines.slice(0, 2) } })
  assert.deepEqual(out, { moved: 0, flagged: 1 })
  assert.equal(db.rows[0].status, 'flagged')
})

test('a replacement that already has its own row is not flagged as removed', async () => {
  const db = fakePrisma([
    { id: 'r0', lineItemIndex: 0, status: 'ready', productSize: '8x10', frameType: 'Unframed', arteloOrderData: { orderItems: before } },
    { id: 'r1', lineItemIndex: 1, status: 'missing_year', runnerName: 'Unknown Runner', arteloOrderData: { orderItems: after } },
  ])
  const out = await reconcileEditedOrder(db, { orderId: '4084', orderItems: after }, { shopifyOrderData: { line_items: lines } })
  assert.deepEqual(out, { moved: 0, flagged: 0 })
  assert.equal(db.rows[0].status, 'ready')
})

test('a photo that is only on the add-on lands on the print it names (order 4053)', async () => {
  const { withAddonPhotos } = await import('./lineItemMatching.js')
  const print = { id: 1, product_id: 5, title: 'Berlin Marathon Personalized Race Print', current_quantity: 1, properties: [{ name: 'Runner Name (First & Last)', value: 'Charles Bunge' }] }
  const addon = { id: 2, product_id: 10329625723163, title: 'Photo Add-On', current_quantity: 1, properties: [{ name: '_photo_path', value: '2026-10-05/x.jpg' }, { name: '_addon_for', value: 'Berlin Marathon Personalized Race Print' }] }
  const out = withAddonPhotos([print, addon])
  assert.equal(out[0].properties.find(p => p.name === '_photo_path').value, '2026-10-05/x.jpg')
  assert.equal(withAddonPhotos([{ ...print, properties: [...print.properties, { name: '_photo_path', value: 'own.jpg' }] }, addon])[0].properties.find(p => p.name === '_photo_path').value, 'own.jpg')
})

test('a photo whose add-on was taken out of the cart or edited off comes off the print', async () => {
  const { normalizeShopifyLines } = await import('./lineItemMatching.js')
  const print = (id, path) => ({ id, product_id: 5, title: 'Boston Marathon Personalized Race Print', current_quantity: 1, properties: [{ name: 'Runner Name (First & Last)', value: 'Jane Doe' }, { name: '_photo_path', value: path }] })
  const addon = (id, path, qty = 1) => ({ id, product_id: 10329625723163, title: 'Photo Add-On', current_quantity: qty, properties: path ? [{ name: '_photo_path', value: path }] : [] })
  const photo = li => li.properties.find(p => p.name === '_photo_path')?.value || null
  // Removed in the cart: no add-on at all.
  const [gone] = normalizeShopifyLines([print(1, 'a.jpg')])
  assert.equal(photo(gone), null)
  assert.equal(gone.properties.find(p => p.name === '_photo_removed').value, 'a.jpg')
  // Paid: the add-on carries the same path, and one add-on covers two prints of one photo (order 4446).
  assert.deepEqual(normalizeShopifyLines([print(1, 'a.jpg'), print(2, 'a.jpg'), addon(3, 'a.jpg')]).slice(0, 2).map(photo), ['a.jpg', 'a.jpg'])
  // Edited off after purchase: the add-on line is at quantity 0.
  assert.equal(photo(normalizeShopifyLines([print(1, 'a.jpg'), addon(2, 'a.jpg', 0)])[0]), null)
  // Two photos, one add-on (order 5160): only the paid one stays.
  assert.deepEqual(normalizeShopifyLines([print(1, 'a.jpg'), print(2, 'b.jpg'), addon(3, 'b.jpg')]).slice(0, 2).map(photo), [null, 'b.jpg'])
  // An add-on with no path, or for a re-uploaded photo, still pays for one.
  assert.equal(photo(normalizeShopifyLines([print(1, 'a.jpg'), addon(2, null)])[0]), 'a.jpg')
  assert.equal(photo(normalizeShopifyLines([print(1, 'a.jpg'), addon(2, 'old.jpg')])[0]), 'a.jpg')
})
