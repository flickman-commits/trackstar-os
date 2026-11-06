/**
 * Manage your order: the customer changes their own order from the link in
 * the Shopify confirmation email, with nobody at Trackstar in between. The
 * link is the credential (changeWindow.linkSignature: the Shopify order id
 * and its HMAC), the same one the address page used.
 *
 * While the window is open (selfServeWindow.js), per print:
 *   name      the runner's name on the print (a typo, "Jonathan" not "Jon")
 *   frames    the frames this print can change to, at its size, and the cost
 *   frame     change it: Shopify order edit, invoice for any difference,
 *             Artelo follows (support/changeItem.js)
 *   photo     add a photo to a print that has none: the page uploads it the
 *             storefront's way (photo-upload-url, photo-verify), and this adds
 *             a $20 Photo Add-On to the Shopify order (Shopify emails the
 *             invoice). The photo counts as hand-added, so the print waits
 *             until Shopify reads paid (photoPayment.js), like one support adds
 * The time and pace are not offered: hiding them is rare and support does it.
 * and for the order:
 *   address   the ship-to (support/actions.shippingAddress)
 *   cancel    cancel and refund in Shopify (support/actions.cancelAndRefund);
 *             Artelo has no cancel API, so Slack asks a person to cancel it there
 *
 * Every change leaves a comment on the order, closes a design waiting for
 * review (it was made with the old details) and renders again when the print
 * can. After the window the page points the customer at support.
 */
import prisma from '../../db.js'
import { linkIsValid, placedAt, CHANGE_WINDOW_HOURS } from './changeWindow.js'
import { closesAtFor, closedReasonFor, isFullName, toTitleCase } from './selfServeWindow.js'
import { shippingAddress, cancellable, cancelAndRefund } from '../support/actions.js'
import { frameChoices, changeItem } from '../support/changeItem.js'
import { checkOrder, createJob } from '../render/jobs.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { shopifyAdminUrl } from '../../lib/links.js'
import { storage } from '../../lib/storage.js'
import { addVariantToOrder, PHOTO_ADDON_VARIANT_ID } from '../../services/shopifyOrderEdit.js'
import { PHOTO_ADDON_PRICE } from '../../services/pricing.js'
import { loadProductCatalog, getProductInfo } from '../../lib/productCatalog.js'
import { shopifyFetch } from '../../services/shopifyAuth.js'

const PHOTO_BUCKET = 'personalization-photos'
// What photo-verify hands back: a sanitized JPEG, PNG or WEBP.
const VERIFIED_PATH = /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/

export const SUPPORT_EMAIL = process.env.PROOF_REPLY_TO_EMAIL || 'fast@trackstar.art'
// Who the order comments and the Shopify notes name.
const CUSTOMER = { id: null, firstName: 'The customer' }

export class ManageError extends Error {
  constructor(code, status = 400, detail = null) { super(code); this.code = code; this.status = status; this.detail = detail }
}

const ROW = {
  id: true, orderNumber: true, lineItemIndex: true, source: true, status: true, designStatus: true, trackingNumber: true, trackstarOrderType: true,
  runnerName: true, runnerNameOverride: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true,
  productSize: true, frameType: true, hadNoTime: true, photoPath: true, photoLater: true, lookupOutcome: true,
  shopifyOrderData: true, arteloOrderData: true, createdAt: true,
  renderJobs: { where: { arteloSentAt: { not: null } }, select: { id: true }, take: 1 },
}

async function load(shopifyOrderId, signature) {
  const id = String(shopifyOrderId || '').trim()
  if (!/^\d{6,20}$/.test(id) || !linkIsValid(id, signature)) throw new ManageError('bad_link', 404)
  const rows = await prisma.order.findMany({ where: { source: 'shopify', parentOrderNumber: id }, orderBy: { lineItemIndex: 'asc' }, select: ROW })
  if (!rows.length) throw new ManageError(await justPlaced(id) ? 'not_ready' : 'not_found', 404)
  const closesAt = closesAtFor(rows[0], await raceDays(rows))
  return { id, rows, closesAt, reason: closedReasonFor(rows, closesAt) }
}

/**
 * The confirmation email goes out the moment the order is placed, and the
 * import picks the order up within about 10 minutes. A valid link in that gap
 * is "still setting it up", not a dead link: the page waits and tries again.
 */
async function justPlaced(id) {
  try {
    const o = (await shopifyFetch(`/orders/${id}.json?fields=id,created_at,cancelled_at`))?.order
    return Boolean(o?.created_at && !o.cancelled_at && Date.now() - new Date(o.created_at).getTime() < 2 * 3600e3)
  } catch { return false }
}

/** The verified race day of each print's race year, for the pre-order rule. */
async function raceDays(rows) {
  const keys = rows.map(r => ({ name: r.raceNameOverride ?? r.raceName, year: r.yearOverride ?? r.raceYear })).filter(k => k.name && k.year)
  if (!keys.length) return []
  const races = await prisma.race.findMany({ where: { OR: keys.flatMap(k => [k.name, getCanonicalRaceName(k.name)].filter(Boolean).map(n => ({ raceName: n, year: k.year }))) }, select: { raceDate: true } })
  return races.map(r => r.raceDate).filter(Boolean)
}

function open(ctx) {
  if (ctx.reason) throw new ManageError(ctx.reason === 'window' ? 'too_late' : ctx.reason, 409)
}

function printOf(ctx, printId) {
  const row = ctx.rows.find(r => r.id === String(printId || ''))
  if (!row) throw new ManageError('not_found', 404)
  return row
}

function shipToOf(row) {
  const s = row.shopifyOrderData?.shipping_address
  if (s) return { name: s.name || [s.first_name, s.last_name].filter(Boolean).join(' '), address1: s.address1 || '', address2: s.address2 || '', city: s.city || '', province: s.province_code || '', zip: s.zip || '', country: s.country_code || 'US', phone: s.phone || '' }
  const a = row.arteloOrderData?.customerAddress
  if (a) return { name: a.name || '', address1: a.street1 || '', address2: a.street2 || '', city: a.city || '', province: '', zip: a.zipcode || '', country: a.countryCode || 'US', phone: a.phone || '' }
  return null
}

const numberOf = row => String(row.shopifyOrderData?.name || '').replace(/^#/, '') || null
const frameLabel = f => f ? String(f).replace(/([a-z])([A-Z])/g, '$1 $2') : null

function printView(r, extra = {}) {
  return {
    id: r.id,
    raceName: r.raceNameOverride ?? r.raceName ?? '',
    year: r.yearOverride ?? r.raceYear ?? null,
    runnerName: r.runnerNameOverride ?? r.runnerName ?? '',
    size: r.productSize || null,
    frame: frameLabel(r.frameType),
    // Only a standard race print has a design that re-renders, so only it takes a photo here.
    standard: r.trackstarOrderType === 'standard',
    photo: r.photoPath ? 'on_print' : r.photoLater ? 'after_race' : 'none',
    preorder: r.lookupOutcome === 'race_not_yet_run',
    image: null,
    photoUrl: null,
    ...extra,
  }
}

/** A short-lived link to the customer's own photo, so the page can show it. */
async function photoUrlOf(path) {
  if (!path) return null
  try {
    const { data } = await storage().storage.from(PHOTO_BUCKET).createSignedUrl(String(path), 3600)
    return data?.signedUrl || null
  } catch { return null }
}

/** The product's own picture from the catalog, for the card. */
function imageOf(row, catalog) {
  if (!catalog) return null
  try { return getProductInfo(row, catalog)?.heroImageUrl || null } catch { return null }
}

/** What the page shows. */
export async function manageInfo(shopifyOrderId, signature) {
  const ctx = await load(shopifyOrderId, signature)
  const first = ctx.rows[0]
  const catalog = await loadProductCatalog().catch(() => null)
  return {
    number: numberOf(first),
    placedAt: placedAt(first),
    closesAt: ctx.closesAt,
    windowHours: CHANGE_WINDOW_HOURS,
    canChange: !ctx.reason,
    reason: ctx.reason,
    support: SUPPORT_EMAIL,
    photoPrice: PHOTO_ADDON_PRICE,
    prints: await Promise.all(ctx.rows.map(async r => printView(r, { image: imageOf(r, catalog), photoUrl: await photoUrlOf(r.photoPath) }))),
    shipTo: shipToOf(first),
  }
}

/** A design made with the old details is closed; a new one renders when the print can. */
async function rerender(row, note) {
  await prisma.renderJob.updateMany({ where: { orderId: row.id, status: 'done', review: 'pending' }, data: { review: 'closed', reviewNote: note, reviewedAt: new Date() } })
  try {
    const { ok, spec } = await checkOrder(row.id)
    if (!ok) return
    await prisma.renderJob.updateMany({ where: { orderId: row.id, status: 'queued' }, data: { spec } })
    if (await prisma.renderJob.findFirst({ where: { orderId: row.id, status: 'rendering' } })) return
    await createJob({ orderId: row.id, requestedBy: 'customer' })
  } catch (e) {
    // The change is saved; the next import renders it (jobs.rerenderChanged).
    console.error('[manage-order] render did not start', row.orderNumber, e.message)
  }
}

const comment = (row, text) => prisma.orderComment.create({ data: { orderId: row.id, text, authorId: null, authorName: 'Customer' } })

export async function manageChange(shopifyOrderId, signature, body = {}) {
  const ctx = await load(shopifyOrderId, signature)
  const action = String(body.action || '')

  if (action === 'frames') {
    open(ctx)
    const row = printOf(ctx, body.printId)
    const out = await frameChoices({ orderRowId: row.id }).catch(e => { throw new ManageError('unavailable', 409, friendly(e)) })
    return { size: out.size, current: out.current, frames: out.frames }
  }

  if (action === 'name') {
    open(ctx)
    const row = printOf(ctx, body.printId)
    const name = toTitleCase(String(body.name || '').trim().replace(/\s+/g, ' ')).slice(0, 80)
    if (!isFullName(name)) throw new ManageError('needs_full_name')
    const was = row.runnerNameOverride ?? row.runnerName ?? ''
    if (name === was) return { ok: true, print: printView(row) }
    await prisma.order.update({ where: { id: row.id }, data: { runnerNameOverride: name === row.runnerName ? null : name } })
    await comment(row, `The customer changed the name on the print from "${was}" to "${name}" (Manage your order).`)
    if (row.trackstarOrderType === 'standard') await rerender(row, 'The customer changed the runner name; a new design replaces it')
    return { ok: true, print: printView({ ...row, runnerNameOverride: name }) }
  }

  if (action === 'frame') {
    open(ctx)
    const row = printOf(ctx, body.printId)
    const frame = String(body.frame || '').trim()
    if (!frame) throw new ManageError('bad_request')
    let out
    try { out = await changeItem({ orderRowId: row.id, frame, actor: CUSTOMER }) } catch (e) { throw new ManageError('unavailable', 409, friendly(e)) }
    // Shopify's invoice email carries the balance; the order waits for it the way any order edit does.
    return { ok: true, was: out.was, now: out.now, owed: out.owed, invoiced: out.invoiced, print: printView({ ...row, frameType: frame.replace(/\s+/g, '') }) }
  }

  if (action === 'photo') {
    open(ctx)
    const row = printOf(ctx, body.printId)
    if (row.trackstarOrderType !== 'standard' || row.photoPath || row.photoLater) throw new ManageError('unavailable', 409, 'has_photo')
    const path = String(body.path || '')
    if (!VERIFIED_PATH.test(path)) throw new ManageError('photo_failed')
    // Only a file that is actually in the bucket (photo-verify replaced or purged everything else).
    const { error } = await storage().storage.from(PHOTO_BUCKET).createSignedUrl(path, 60)
    if (error) throw new ManageError('photo_failed')
    // Claim the print first, so a double tap cannot bill twice.
    const { count } = await prisma.order.updateMany({ where: { id: row.id, photoPath: null }, data: { photoPath: path, photoAddedManually: true, photoFree: false, photoPlacedAt: null } })
    if (!count) throw new ManageError('unavailable', 409, 'has_photo')
    try {
      await addVariantToOrder(ctx.id, PHOTO_ADDON_VARIANT_ID, 1, 'Photo Add-On added by the customer from Manage your order (TrackstarOS)')
    } catch (e) {
      // No charge, no photo: give the print back as it was.
      await prisma.order.update({ where: { id: row.id }, data: { photoPath: null, photoAddedManually: false } })
      console.error('[manage-order] photo add-on order edit failed', row.orderNumber, e.message)
      throw new ManageError('photo_failed')
    }
    await comment(row, `The customer added a photo from Manage your order. A $${PHOTO_ADDON_PRICE} Photo Add-On is on the Shopify order and Shopify emailed them the invoice; the print renders with the photo once it is paid.`)
    await rerender(row, 'The customer added a photo; a new design with it replaces this one')
    await slackTo('alerts', `:frame_with_picture: Customer added a photo to *#${slackText(numberOf(row) || row.orderNumber)}* from Manage your order; $${PHOTO_ADDON_PRICE} invoice sent by Shopify.`).catch(() => {})
    return { ok: true, invoiced: true, price: PHOTO_ADDON_PRICE, print: printView({ ...row, photoPath: path }, { photoUrl: await photoUrlOf(path) }) }
  }

  if (action === 'address') {
    open(ctx)
    let out
    try {
      out = await shippingAddress({ thread: null, shopifyOrderId: ctx.id, address: body.address, actor: null, source: 'customer', acceptTax: body.acceptTax === true })
    } catch (e) {
      // More sales tax at the new address: nothing saved yet, the page asks first.
      if (e?.taxDueCents > 0) throw new ManageError('tax_due', 409, (e.taxDueCents / 100).toFixed(2))
      if (e?.expose || e?.name === 'UserError') throw new ManageError('bad_address', 400, String(e.message || '').replace(/^Shopify would not take that address: /, ''))
      throw e
    }
    await slackTo('alerts', `:round_pushpin: Customer changed the ship-to on *#${slackText(out.number)}* from Manage your order: ${slackText(out.pasted.replace(/\n/g, ', '), 300)}${out.taxNote ? `\n${slackText(out.taxNote, 300)}` : ''}`).catch(() => {})
    return { ok: true, shipTo: out.address, invoiced: Boolean(out.invoiced), taxOwed: out.owedCents > 0 ? out.owedCents / 100 : 0 }
  }

  if (action === 'cancel') {
    open(ctx)
    let o
    try { o = await cancellable(ctx.id) } catch (e) { throw new ManageError('unavailable', 409, friendly(e)) }
    const out = await cancelAndRefund({ order: o, why: 'the customer cancelled from Manage your order', by: 'Cancelled by the customer from Manage your order' })
    // Artelo has the order too and only a person can cancel it there.
    await slackTo('alerts', `:x: Customer cancelled *#${slackText(out.number)}* from Manage your order; ${slackText(out.display)} refunded in Shopify. *Cancel it in Artelo too*${out.arteloUrl ? `: ${out.arteloUrl}` : ''}${shopifyAdminUrl(ctx.id) ? ` (Shopify: ${shopifyAdminUrl(ctx.id)})` : ''}`, { or: 'matt' }).catch(() => {})
    return { ok: true, refunded: out.display }
  }

  throw new ManageError('bad_request')
}

/** A support error's sentence for the customer, or nothing: support wording names reps, playbooks and Artelo. */
function friendly(e) {
  const m = String(e?.message || '')
  if (/already gone to production|has gone to production|fulfilled/i.test(m)) return 'in_production'
  if (/cancelled/i.test(m)) return 'cancelled'
  if (/does not come in/i.test(m)) return 'no_such_frame'
  if (/already is/i.test(m)) return 'same_frame'
  return null
}
