/**
 * Overseas samples through Gelato: printed near the recipient and shipped
 * from there, where Artelo ships from the US. Not a Shopify order: the order
 * goes straight to Gelato with a finished PDF, so there is no import, render
 * or Artelo step.
 *
 * The standard sample is the one Matt sent to Germany (Gelato order
 * G-260917144809): a 12x18 premium wooden mounted framed poster, black frame,
 * premium matte paper. The same frame comes in natural wood (Gelato's
 * natural-wood_wood, a little dearer: $44.18 against $41.78 to London).
 * Shipping defaults to the cheapest method Gelato quotes.
 */
import { createHash } from 'crypto'
import prisma from '../../db.js'
import { gelato, GelatoError } from '../../services/gelato.js'
import { storage } from '../../lib/storage.js'
import { recordSampleCostSafely } from './costs.js'

export const GELATO_PRODUCTS = [
  { uid: 'framed_poster_mounted_premium_300x450-mm-12x18-inch_black_wood_w20xt20-mm_plexiglass_300x450-mm-12x18-inch_200-gsm-80lb-uncoated_4-0_ver', label: '12x18, black wood frame, matte paper', size: '12x18', frame: 'Black Premium Oak' },
  { uid: 'framed_poster_mounted_premium_300x450-mm-12x18-inch_natural-wood_wood_w20xt20-mm_plexiglass_300x450-mm-12x18-inch_200-gsm-80lb-uncoated_4-0_ver', label: '12x18, natural wood frame, matte paper', size: '12x18', frame: 'Natural Premium Oak' },
]

// Public, because Gelato fetches the file by URL (the bulk print files live here too).
const BUCKET = 'order-proofs'
const SEND_ONCE_MS = 10 * 60_000
const cents = n => Math.round(Number(n || 0) * 100)

/** Where the sample's PDF goes: a signed upload link and the public URL Gelato reads. */
export async function gelatoUploadUrl(fileName) {
  if (!/\.pdf$/i.test(String(fileName || ''))) throw new GelatoError('Upload the print as a PDF', 400)
  const safe = String(fileName).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
  const path = `samples/gelato/${Date.now()}-${safe}`
  const sb = storage().storage.from(BUCKET)
  const { data, error } = await sb.createSignedUploadUrl(path)
  if (error) throw new Error(error.message)
  return { uploadUrl: data.signedUrl, fileUrl: sb.getPublicUrl(path).data.publicUrl }
}

function recipient(input) {
  const a = input.address || {}
  const t = k => String(a[k] || '').trim()
  const [firstName, ...rest] = String(input.name || '').trim().split(/\s+/)
  const out = {
    firstName: firstName || '', lastName: rest.join(' ') || firstName || '',
    addressLine1: t('address1'), addressLine2: t('address2') || undefined, city: t('city'),
    postCode: t('zip'), state: t('province') || undefined, country: (t('country') || '').toUpperCase(),
    email: String(input.email || '').trim(), phone: t('phone') || undefined,
  }
  if (!out.firstName) throw new GelatoError('Add their name', 400)
  if (!/^\S+@\S+\.\S+$/.test(out.email)) throw new GelatoError('Add their email', 400)
  if (!out.addressLine1 || !out.city || !out.postCode) throw new GelatoError('The address needs a street, city and postal code', 400)
  if (!/^[A-Z]{2}$/.test(out.country)) throw new GelatoError('Give the country as a two-letter code, like DE or GB', 400)
  return out
}

function product(uid) {
  const p = GELATO_PRODUCTS.find(x => x.uid === uid) || GELATO_PRODUCTS[0]
  return p
}

/** Gelato's price for the print and each way to ship it there. */
export async function quoteGelatoSample(input) {
  const p = product(input.productUid)
  const q = await gelato('order', '/v4/orders:quote', {
    method: 'POST',
    body: {
      orderReferenceId: 'sample-quote', customerReferenceId: 'samples', currency: 'USD', allowMultipleQuotes: false,
      recipient: recipient(input),
      products: [{ itemReferenceId: '1', productUid: p.uid, quantity: 1, files: [{ type: 'default', url: input.fileUrl || 'https://www.trackstar.art' }] }],
    },
  })
  const quote = q?.quotes?.[0]
  if (!quote) throw new GelatoError(`Gelato could not quote it${q?.errors?.length ? `: ${q.errors.map(e => e.message || e).join('; ')}` : ''}`, 400)
  return {
    product: p,
    printCents: cents(quote.products?.[0]?.price),
    country: quote.fulfillmentCountry,
    shipping: (quote.shipmentMethods || []).map(m => ({ uid: m.shipmentMethodUid, name: m.name, cents: cents(m.price), minDays: m.minDeliveryDays, maxDays: m.maxDeliveryDays })).sort((a, b) => a.cents - b.cents),
  }
}

/** Create the order in Gelato. Sends once: the same PDF to the same person within ten minutes is refused. */
export async function sendGelatoSample(input, actor) {
  const to = recipient(input)
  const fileUrl = String(input.fileUrl || '').trim()
  if (!/^https:\/\//.test(fileUrl)) throw new GelatoError('Upload the PDF first', 400)
  const p = product(input.productUid)
  const quote = await quoteGelatoSample({ ...input, fileUrl })
  const method = quote.shipping.find(m => m.uid === input.shipmentMethodUid) || quote.shipping[0]
  if (!method) throw new GelatoError('Gelato has no way to ship it there', 400)

  const fingerprint = createHash('sha256').update(JSON.stringify({ email: to.email.toLowerCase(), fileUrl, uid: p.uid })).digest('hex').slice(0, 24)
  const claimKey = `sample_sent:gelato:${fingerprint}`
  await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'sample_sent:' }, updatedAt: { lt: new Date(Date.now() - SEND_ONCE_MS) } } }).catch(() => {})
  try {
    await prisma.systemConfig.create({ data: { key: claimKey, value: new Date().toISOString() } })
  } catch (err) {
    if (err.code === 'P2002') throw new GelatoError('This exact sample was sent in the last 10 minutes. Check Gelato before sending it again.', 409)
    throw err
  }

  const reference = `S-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}${Date.now().toString().slice(-5)}`
  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'the team'
  let order
  try {
    order = await gelato('order', '/v4/orders', {
      method: 'POST',
      body: {
        orderType: 'order', orderReferenceId: reference, customerReferenceId: 'samples', currency: 'USD',
        items: [{ itemReferenceId: `${reference}-1`, productUid: p.uid, quantity: 1, files: [{ type: 'default', url: fileUrl }] }],
        shipmentMethodUid: method.uid,
        shippingAddress: to,
        metadata: [{ key: 'source', value: 'TrackstarOS samples' }, { key: 'sentBy', value: by }],
      },
    })
  } catch (err) {
    if (err.status === 400) await prisma.systemConfig.delete({ where: { key: claimKey } }).catch(() => {})
    throw err
  }

  const costCents = quote.printCents + method.cents
  const recorded = await recordSampleCostSafely({
    source: 'samples_gelato', orderName: `Gelato ${reference}`, recipient: `${to.firstName} ${to.lastName}`.trim(), email: to.email,
    costCents, chargedCents: 0, createdById: actor?.id || null,
  }, [{ title: String(input.title || 'Sample print').slice(0, 120), size: p.size, frame: p.frame, quantity: 1 }])
  return { id: order?.id, reference, costCents: recorded?.costCents ?? costCents, shipping: method, country: to.country }
}
