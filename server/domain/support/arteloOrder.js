/**
 * A new Artelo order for a customer, from Support: the reprint or
 * replacement the team used to build by hand in Artelo (a cracked frame, a
 * lost package, the wrong year printed). Same product and same design as
 * the item on their order, shipped to the address and email on the form.
 *
 *   POST orders/create  (https://www.artelo.io/artelo-api/documentation/orders/create)
 *
 * The product (size, paper, frame, mats, pins) comes from the Artelo order
 * we stored at import. The design comes from, in order: the live Artelo
 * order (Artelo's API does not return attached designs today, so in practice
 * never), the approved render we uploaded to the Artelo library
 * (render/artelo.js), else the print's PDF in the Drive Orders folder, where
 * every hand-made print is saved as "<number>_..." ("<number>-2_..." for a
 * second item). That PDF is uploaded to the Artelo library when the order is
 * sent. An item with none of these cannot be copied; the form says so.
 * A rep can also upload a new design file for an item (the old one had a
 * mistake); it goes into the Artelo library and is used instead.
 *
 * Price and shipping are 0: this is a replacement, not a sale. The order id
 * reads "<number>-R1", "-R2", and so on. `test` makes an Artelo test order
 * (status Ignored, never produced, no charge) to try the flow.
 */
import prisma from '../../db.js'
import { arteloOrderUrl } from '../../lib/links.js'
import { UserError } from './errors.js'
import { requireConnection } from '../../lib/connections.js'
import { driveClients, ORDERS_FOLDER_ID } from '../render/deliver.js'
import { uploadPdfToLibrary } from '../render/artelo.js'
import { storage } from '../../lib/storage.js'
import { BUCKET } from '../render/jobs.js'
import { readUpload } from './uploads.js'

const BASE = 'https://www.artelo.com/api/open/'

async function artelo(path, { method = 'GET', body, query } = {}) {
  const key = process.env.ARTELO_API_KEY
  if (!key) throw new UserError('Artelo is not connected (ARTELO_API_KEY)')
  await requireConnection('artelo')
  const url = BASE + path + (query ? `?${new URLSearchParams(query)}` : '')
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* an HTML error page */ }
  if (!res.ok) {
    const msg = data?.message || data?.title || (data?.errors ? JSON.stringify(data.errors).slice(0, 200) : text.slice(0, 160))
    const err = new Error(`Artelo said no: ${msg}`)
    err.status = res.status
    throw err
  }
  return data
}

function actorName(actor) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
}

/** The product of an Artelo order item, as the create call wants it. */
export function productInfo(product, designs) {
  const p = product || {}
  return {
    catalogProductId: p.catalogProductId,
    size: p.size,
    frameColor: p.frameColor ?? null,
    paperType: p.paperType ?? null,
    orientation: p.orientation ?? null,
    includeMats: Boolean(p.includeMats),
    includeHangingPins: Boolean(p.includeHangingPins),
    includeFramingService: Boolean(p.includeFramingService),
    canvasDesignedFor: p.canvasDesignedFor ?? null,
    canvasBorderStyle: p.canvasBorderStyle ?? null,
    designs,
  }
}

/** Designs attached on the live Artelo item, placed where they were. */
export function designsFromArtelo(item) {
  const ds = item?.product?.designs || []
  return ds.filter(d => d?.image?.url).sort((a, b) => (a.order || 0) - (b.order || 0)).map(d => ({
    sourceImage: { url: d.image.url },
    overrides: { x: d.x || 0, y: d.y || 0, width: d.width, height: d.height, rotation: d.rotation || 0 },
  }))
}

/**
 * What a replacement can be changed to, and Trackstar's normal Artelo
 * settings for it (what nearly every order is made with): archival matte
 * fine art paper, vertical, no mats; framed in premium oak with hanging pins
 * and the framing service, unframed with neither.
 */
export const REPLACEMENT_SIZES = ['x8x10', 'x12x18', 'x16x24']
export const REPLACEMENT_FRAMES = ['Unframed', 'BlackPremiumOak', 'NaturalPremiumOak']

function standardProduct(size, frame) {
  const framed = frame !== 'Unframed'
  return {
    catalogProductId: 'IndividualArtPrint', size, frameColor: frame, frameStyle: framed ? 'PremiumOak' : 'Unframed',
    paperType: 'ArchivalMatteFineArt', paperStyle: 'FineArt', orientation: 'Vertical',
    includeMats: false, includeHangingPins: framed, includeFramingService: framed,
  }
}

/** The product a replacement is made as: the original, or the size and frame the customer asked for. */
function productWithChange(original, change) {
  const size = change?.size || original?.size
  const frame = change?.frame || original?.frameColor || 'Unframed'
  if (size === original?.size && frame === original?.frameColor) return original
  if (!REPLACEMENT_SIZES.includes(size)) throw new UserError(`${sizeLabel(size)} is not a size a replacement can be made in`)
  if (!REPLACEMENT_FRAMES.includes(frame)) throw new UserError(`${frame} is not a frame a replacement can be made with`)
  return standardProduct(size, frame)
}

/** "x12x18" -> [12, 18] */
function inches(size) {
  const m = /^x?(\d+(?:dot\d+)?)x(\d+(?:dot\d+)?)$/.exec(String(size || ''))
  return m ? [Number(m[1].replace('dot', '.')), Number(m[2].replace('dot', '.'))] : null
}

/**
 * The design file must be the shape of the print: a 12x18 file on an 8x10
 * would print stretched or cropped. Artelo reports each upload's pixel size;
 * its shape is compared with the size, with or without the 1/4" bleed. 12x18
 * and 16x24 share a shape, so one scales to the other.
 */
export async function checkDesignFits(design, size, label) {
  if (!design?.imageId) return
  const want = inches(size)
  const up = await artelo('uploads/files/get-by-id', { query: { id: design.imageId } }).catch(() => null)
  if (!want || !up?.width || !up?.height) return
  const ratio = up.width / up.height
  const shapes = [want[0] / want[1], (want[0] + 0.5) / (want[1] + 0.5)]
  if (shapes.some(r => Math.abs(ratio - r) / r < 0.02)) return
  const fileIn = `${Math.round((up.width / 300 - 0.5) * 2) / 2}x${Math.round((up.height / 300 - 0.5) * 2) / 2}`
  throw new UserError(`${label}: the design file is ${fileIn} (${up.width}x${up.height} px) and the replacement is ${sizeLabel(size)}, so it would print stretched. Make ${/^8/.test(sizeLabel(size)) ? 'an' : 'a'} ${sizeLabel(size)} file first, or keep the original size.`)
}

/** "x12x18" -> "12x18". */
const sizeLabel = s => String(s || '').replace(/^x/, '').replace(/dot/g, '.')
function describe(product) {
  const p = product || {}
  const frame = p.frameColor ? String(p.frameColor).replace(/([a-z])([A-Z])/g, '$1 $2') : 'Unframed'
  return [sizeLabel(p.size), frame].filter(Boolean).join(' · ')
}

const escapeQ = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/**
 * The newest PDF in the Drive Orders folder for this print: named
 * "<label>_..." where label is the order number, with "-2" etc. for a later
 * item. Returns { id, name, client } or null.
 */
export async function drivePdfFor(label) {
  const folder = ORDERS_FOLDER_ID()
  for (const { client } of await driveClients().catch(() => [])) {
    try {
      const { data } = await client.files.list({
        q: `'${folder}' in parents and name contains '${escapeQ(label)}_' and mimeType = 'application/pdf' and trashed = false`,
        fields: 'files(id, name, modifiedTime)', orderBy: 'modifiedTime desc', pageSize: 20, supportsAllDrives: true, includeItemsFromAllDrives: true,
      })
      // "contains" also matches 14341_...; keep names that start with the label.
      const hit = (data.files || []).find(f => f.name.startsWith(`${label}_`))
      return hit ? { id: hit.id, name: hit.name, client } : null
    } catch { /* try the next Google connection */ }
  }
  return null
}

/** Put a Drive PDF in the Artelo library: copied to our storage for a link Artelo can fetch, then uploaded. */
export async function libraryUploadFromDrive(file, orderId) {
  const res = await file.client.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
  const buf = Buffer.from(res.data)
  if (!buf.subarray(0, 4).toString('latin1').startsWith('%PDF')) throw new UserError(`${file.name} in Drive is not a PDF`)
  const path = `replacements/${orderId}/${Date.now()}.pdf`
  const sb = storage()
  const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw new Error(`Could not stage the PDF: ${up.error.message}`)
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 900)
  if (!data?.signedUrl) throw new Error('Could not link the staged PDF')
  return uploadPdfToLibrary(data.signedUrl, file.name)
}

/** Our rows for a Shopify order, each with what Artelo has for its item. */
async function itemsFor(shopifyOrderId) {
  const rows = await prisma.order.findMany({
    where: { source: 'shopify', parentOrderNumber: String(shopifyOrderId) },
    orderBy: { lineItemIndex: 'asc' },
    select: { id: true, lineItemIndex: true, runnerName: true, raceName: true, raceYear: true, arteloOrderData: true, shopifyOrderData: true,
      renderJobs: { where: { status: 'done', review: 'approved', arteloUploadId: { not: null } }, orderBy: { version: 'desc' }, take: 1, select: { arteloUploadId: true, version: true } } },
  })
  if (!rows.length) throw new UserError('That order is not in TrackstarOS, so there is nothing to copy. Build it in Artelo.')
  const stored = rows[0].arteloOrderData
  let live = null
  if (stored?.id) {
    try { live = await artelo('orders/get-by-id', { query: { orderId: stored.id } }) } catch (err) { console.warn(`[support.artelo] get-by-id ${stored.id}: ${err.message}`) }
  }
  const items = rows.map(r => {
    const storedItem = r.arteloOrderData?.orderItems?.[r.lineItemIndex] || null
    const liveItem = live?.orderItems?.find(i => i.orderItemId === storedItem?.orderItemId) || null
    const product = liveItem?.product || storedItem?.product || null
    const fromArtelo = designsFromArtelo(liveItem)
    const job = r.renderJobs[0]
    const designs = fromArtelo.length ? fromArtelo : job ? [{ imageId: job.arteloUploadId }] : []
    return {
      row: r,
      orderId: r.id,
      label: `${r.runnerName || 'Item'} · ${[r.raceName, r.raceYear].filter(Boolean).join(' ')}`,
      product,
      productLabel: describe(product),
      designs,
      designFrom: fromArtelo.length ? 'the Artelo order' : job ? `the approved design (v${job.version})` : null,
    }
  })
  const number = String(rows[0].shopifyOrderData?.name || shopifyOrderId).replace(/^#/, '')
  // A print made by hand: its PDF in the Drive Orders folder.
  await Promise.all(items.filter(i => !i.designs.length).map(async i => {
    const label = i.row.lineItemIndex ? `${number}-${i.row.lineItemIndex + 1}` : number
    const file = await drivePdfFor(label).catch(() => null)
    if (file) { i.driveFile = file; i.designFrom = `${file.name} in the Drive Orders folder` }
  }))
  return { rows, items, stored, live, number }
}

const copyable = i => Boolean(i.product?.catalogProductId && i.product?.size && (i.designs.length || i.driveFile))

/** What the form shows: each item, whether it can be copied, and the next order id. */
export async function reorderPrep({ shopifyOrderId }) {
  const id = String(shopifyOrderId || '').trim()
  if (!/^\d+$/.test(id)) throw new UserError('That order has no Shopify id')
  const { items, number, rows } = await itemsFor(id)
  return {
    number,
    nextOrderId: await nextOrderId(number, rows.map(r => r.id)),
    items: items.map(i => ({ orderId: i.orderId, label: i.label, productLabel: i.productLabel, designFrom: i.designFrom, copyable: copyable(i), size: i.product?.size || null, frame: i.product?.frameColor || null })),
    sizes: REPLACEMENT_SIZES.map(v => ({ value: v, label: sizeLabel(v) })),
    frames: REPLACEMENT_FRAMES.map(v => ({ value: v, label: v === 'Unframed' ? 'Unframed' : v.replace(/([a-z])([A-Z])/g, '$1 $2') })),
  }
}

/** "4985-R1", then -R2: one more than the reorders already noted on the order. */
async function nextOrderId(number, rowIds) {
  const notes = await prisma.orderComment.findMany({ where: { orderId: { in: rowIds }, text: { startsWith: 'New Artelo order ' } }, select: { text: true } })
  const made = new Set(notes.map(n => n.text.split(' ')[3]))
  return `${number}-R${made.size + 1}`
}

const US_STATES = /^[A-Z]{2}$/

export async function createReorder({ thread, shopifyOrderId, orderIds, changes, files, address, email, instructions, test, actor }) {
  const id = String(shopifyOrderId || '').trim()
  if (!/^\d+$/.test(id)) throw new UserError('That order has no Shopify id')
  const a = {}
  for (const k of ['name', 'address1', 'address2', 'city', 'province', 'zip', 'country', 'phone']) a[k] = String(address?.[k] || '').trim()
  a.country = (a.country || 'US').toUpperCase()
  for (const k of ['name', 'address1', 'city', 'province', 'zip']) if (!a[k]) throw new UserError(`The address needs a ${k === 'address1' ? 'street' : k === 'province' ? 'state' : k}`)
  if (a.country === 'US' && !US_STATES.test(a.province.toUpperCase())) throw new UserError('Use the two-letter state code, like NY')
  if (a.country !== 'US' && !a.phone) throw new UserError('Artelo needs a phone number for an order outside the US')
  const mail = String(email || '').trim()

  const { rows, items, stored, number } = await itemsFor(id)
  const picked = items.filter(i => (orderIds || []).includes(i.orderId))
  if (!picked.length) throw new UserError('Pick at least one item to send')
  // A new design file a rep uploaded for an item (the old one had a mistake) replaces its design.
  for (const i of picked) {
    const ref = String(files?.[i.orderId] || '')
    if (!ref) continue
    if (!ref.startsWith('upload:')) throw new UserError('That design file was not uploaded here')
    const up = await readUpload(ref.slice('upload:'.length))
    try { i.designs = [{ imageId: await uploadPdfToLibrary(up.url, `${i.orderId}_new_${up.filename}`) }] }
    catch (err) { throw new UserError(`Artelo did not take ${up.filename}: ${String(err.message).slice(0, 160)}`) }
    i.driveFile = null
    i.designFrom = `the new file ${up.filename}`
  }
  const blocked = picked.find(i => !copyable(i))
  if (blocked) throw new UserError(`${blocked.label} has no design to copy: no approved render and no PDF named for it in the Drive Orders folder. Build that one in Artelo.`)
  // The size and frame the customer asked for, else the original's.
  for (const i of picked) {
    i.product = productWithChange(i.product, changes?.[i.orderId])
    i.productLabel = describe(i.product)
  }
  // Hand-made prints: their Drive PDF goes into the Artelo library first.
  for (const i of picked) {
    if (i.designs.length || !i.driveFile) continue
    try { i.designs = [{ imageId: await libraryUploadFromDrive(i.driveFile, i.orderId) }] }
    catch (err) { throw new UserError(`Could not copy ${i.driveFile.name} from Drive into Artelo: ${String(err.message).slice(0, 160)}`) }
  }
  // Nothing goes to production on a file the wrong shape for its size.
  for (const i of picked) for (const d of i.designs) await checkDesignFits(d, i.product?.size, i.label)

  const orderId = await nextOrderId(number, rows.map(r => r.id))
  const body = {
    orderId,
    createdAt: new Date().toISOString(),
    currency: 'USD',
    channelName: 'Trackstar Support',
    customerAddress: {
      name: a.name, street1: a.address1, ...(a.address2 ? { street2: a.address2 } : {}), city: a.city,
      state: a.country === 'US' ? a.province.toUpperCase() : a.province, zipcode: a.zip, country: a.country,
      ...(mail ? { email: mail } : {}), ...(a.phone ? { phone: a.phone } : {}),
    },
    items: picked.map((i, n) => ({ orderItemId: `${orderId}-${n + 1}`, productInfo: productInfo(i.product, i.designs), quantity: 1, unitPrice: 0 })),
    shippingCost: 0,
    total: 0,
    ...(String(instructions || '').trim() ? { instructions: String(instructions).trim().slice(0, 1000) } : {}),
    // The same insert and sticker as the original, so the box looks like every other Trackstar order.
    ...(stored?.insertId || stored?.stickerId ? { branding: {
      ...(stored.insertId ? { insertId: stored.insertId, insertPlacement: stored.insertPlacement || 'PerOrder' } : {}),
      ...(stored.stickerId ? { stickerId: stored.stickerId, stickerPlacement: stored.stickerPlacement || 'PerOrder' } : {}),
    } } : {}),
    ...(test ? { isTestOrder: true } : {}),
  }
  const created = await artelo('orders/create', { method: 'POST', body })
  const url = arteloOrderUrl(created?.id) || null
  const by = actorName(actor)
  const what = `${test ? 'Test ' : ''}Artelo order ${orderId}: ${picked.map(i => `${i.label} (${i.productLabel})`).join('; ')} to ${a.name}, ${a.city} ${a.province}`
  await prisma.$transaction([
    prisma.supportNote.create({ data: { threadId: thread.id, kind: 'event', body: `${by} created ${what}`, authorId: actor?.id || null, authorName: by } }),
    // "New Artelo order" starts the comment so the next one is numbered -R2. A test order does not count.
    ...(test ? [] : picked.map(i => prisma.orderComment.create({ data: { orderId: i.orderId, text: `New Artelo order ${orderId} sent from Support${String(instructions || '').trim() ? `: ${String(instructions).trim().slice(0, 300)}` : ''}`, authorId: actor?.id || null, authorName: by } }))),
  ])
  return { orderId, arteloId: created?.id || null, url, test: Boolean(test), items: picked.length, summary: `Created ${what}` }
}
