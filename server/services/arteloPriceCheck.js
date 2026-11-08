/**
 * Artelo's price check: the real cost of a whole order before it exists
 * (POST orders/price-check, https://www.artelo.io/artelo-api/documentation/orders/price-check).
 * It prices the order as Artelo would bill it, including what per-print
 * estimates get wrong: several prints share one shipment, and branding (the
 * package insert once per order, a sticker per print) is counted properly.
 * A 7-print 16x24 order came back $17.58 shipping and $2.00 branding, the
 * same as its invoice, where adding up per-print estimates said $79.76.
 *
 * Artelo wants a design per item even to price it, so any image already in
 * our Artelo uploads is used (nothing is uploaded or created). Branding is
 * copied from our most recent Artelo order, so it matches what we really use.
 */
import prisma from '../db.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'
import { requireConnection } from '../lib/connections.js'

const URL = 'https://www.artelo.com/api/open/orders/price-check'
const FRAME = { black: 'BlackPremiumOak', natural: 'NaturalPremiumOak' }
// Where to price shipping when there is no address yet.
const DEFAULT_ADDRESS = { name: 'Trackstar', street1: '350 5th Ave', city: 'New York', state: 'NY', zipcode: '10118', country: 'US' }

let setup = null
/** An image already in our Artelo uploads (Artelo wants a design to price a print) and our usual branding. */
export async function accountSetup() {
  if (setup && Date.now() - setup.at < 60 * 60 * 1000) return setup
  const [job, order] = await Promise.all([
    prisma.renderJob.findFirst({ where: { NOT: { arteloUploadId: null } }, orderBy: { createdAt: 'desc' }, select: { arteloUploadId: true } }),
    prisma.order.findFirst({ where: { source: 'shopify', arteloOrderData: { path: ['insertId'], not: null } }, orderBy: { createdAt: 'desc' }, select: { arteloOrderData: true } }),
  ])
  if (!job?.arteloUploadId) throw new Error('No Artelo upload to price with')
  const a = order?.arteloOrderData || {}
  setup = {
    at: Date.now(),
    imageId: job.arteloUploadId,
    branding: a.insertId || a.stickerId ? { insertId: a.insertId || undefined, stickerId: a.stickerId || undefined, insertPlacement: a.insertPlacement || undefined, stickerPlacement: a.stickerPlacement || undefined } : undefined,
  }
  return setup
}

function productInfo(size, frame, imageId) {
  const f = String(frame || '').toLowerCase()
  const framed = f && !/unframed/.test(f)
  return {
    catalogProductId: 'IndividualArtPrint',
    size: `x${String(size).replace(/^x/, '')}`,
    frameColor: framed ? (/natural/.test(f) ? FRAME.natural : FRAME.black) : 'Unframed',
    paperType: 'ArchivalMatteFineArt',
    orientation: 'Vertical',
    includeMats: false,
    includeHangingPins: framed,
    includeFramingService: framed,
    canvasDesignedFor: null,
    canvasBorderStyle: null,
    designs: [{ imageId }],
  }
}

const cents = n => Math.round(Number(n || 0) * 100)

/**
 * @param {{ items: [{ size, frame, quantity }], address?: { name, address1, address2, city, province, zip, country } }} input
 * @returns cents: { productionCents, shippingCents, brandingCents, totalCents, perItem: [{ productionCents }] }
 */
export async function arteloPriceCheck({ items, address }) {
  const key = process.env.ARTELO_API_KEY
  if (!key) throw new Error('Missing ARTELO_API_KEY')
  if (!items?.length) return { productionCents: 0, shippingCents: 0, brandingCents: 0, totalCents: 0, perItem: [] }
  const { imageId, branding } = await accountSetup()
  const a = address?.address1 && address?.city && address?.zip
    ? { name: address.name || 'Recipient', street1: address.address1, street2: address.address2 || undefined, city: address.city, state: address.province || '', zipcode: address.zip, country: (address.country || 'US').toUpperCase() }
    : DEFAULT_ADDRESS
  const body = {
    orderId: `PRICE-CHECK-${Date.now()}`,
    currency: 'USD',
    customerAddress: a,
    items: items.map((it, i) => ({ orderItemId: `pc-${i}`, productInfo: productInfo(it.size, it.frame, imageId), quantity: Math.max(1, Number(it.quantity) || 1), unitPrice: 0 })),
    ...(branding ? { branding } : {}),
  }
  await requireConnection('artelo')
  const res = await fetchWithTimeout(URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000)
  const text = await res.text()
  if (!res.ok) throw new Error(`Artelo price check ${res.status}: ${text.slice(0, 200)}`)
  const d = JSON.parse(text)
  const o = d.orderCosts || {}
  return {
    productionCents: cents(o.productionCost),
    shippingCents: cents(o.arteloShipping),
    brandingCents: cents(o.branding),
    totalCents: cents(o.total),
    perItem: (d.orderItemCosts || []).map(c => ({ productionCents: cents(c.productionCost) })),
  }
}
