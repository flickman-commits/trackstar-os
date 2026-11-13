/**
 * Bulk runners go to Artelo through the tool, one Artelo order per runner,
 * the way a reprint from Support does (support/arteloOrder.js). No more
 * spreadsheet: a runner is queued the moment they have an address and a
 * print, then the sender (every 2 minutes) creates their Artelo order with the design on it,
 * sends it to production, and completes them here. The Artelo order lands
 * in arteloOrderData, so the runner's row gets an Artelo link like any order.
 *
 * The print is the runner's approved render (standard-print runs, uploaded
 * to the library on approval, render/artelo.js) or the designer's uploaded
 * file (co-branded runs, a public URL on productionFileUrl).
 *
 * A refusal Artelo will not fix on its own (a bad address, a file the wrong
 * shape) waits for a person: the runner shows the reason, with Send now once
 * it is fixed. The partner's invoice has to be paid first. Prepaid orders
 * have no change window: the partner gave the addresses.
 */
import prisma from '../../db.js'
import { call, uploadPdfToLibrary, uploadApprovedToArtelo } from '../render/artelo.js'
import { standardProduct, checkDesignFits } from '../support/arteloOrder.js'
import { completeOrder } from '../orders/complete.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { slackTo, slackText, slackLink } from '../../lib/slack.js'
import { arteloOrderUrl, orderAppUrl } from '../../lib/links.js'
import { addressComplete, normalizeZip, usZipProblem } from './bulkOrders.js'

const MIN = 60_000
// No hold for a bulk runner: there is no customer to write in and ask for a
// change (the partner gave the list), so an approved print goes straight to
// production on the sender's next run (Matt, 2026-11-06).

export class BulkSendError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

const US_STATES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC' }
const COUNTRIES = { 'united states': 'US', usa: 'US', us: 'US', 'united states of america': 'US', canada: 'CA', 'united kingdom': 'GB', uk: 'GB', australia: 'AU' }

/** A runner's address as Artelo wants it, or the reason it cannot be sent. */
export function arteloAddress(order) {
  const a = order.shippingAddress || {}
  const country = COUNTRIES[String(a.country || 'US').trim().toLowerCase()] || (String(a.country || '').length === 2 ? String(a.country).toUpperCase() : null)
  if (!country) throw new BulkSendError(`Country "${a.country}" is not one Artelo ships to from here`)
  let state = String(a.state || '').trim()
  if (country === 'US') {
    state = US_STATES[state.toLowerCase()] || state.toUpperCase()
    if (!/^[A-Z]{2}$/.test(state)) throw new BulkSendError(`"${a.state || ''}" is not a state Artelo recognizes`)
  }
  // A short zip (a spreadsheet's dropped zero, or a typo) would go to Artelo as is.
  const fixed = normalizeZip({ ...a, state })
  const zipProblem = usZipProblem(fixed)
  if (zipProblem) throw new BulkSendError(`${zipProblem}. Fix the address before it goes to Artelo`)
  const name = order.runnerNameOverride || order.runnerName || a.name
  return {
    name, street1: a.line1, ...(a.line2 ? { street2: a.line2 } : {}), city: a.city, state, zipcode: fixed.zip, country,
    ...(order.customerEmail ? { email: order.customerEmail } : {}), ...(a.phone ? { phone: a.phone } : {}),
  }
}

/** "12x18" -> "x12x18"; "Natural Premium Oak" -> "NaturalPremiumOak". */
const arteloSize = s => `x${String(s || '').replace(/^x/, '')}`
const arteloFrame = f => String(f || 'Unframed').replace(/\s+/g, '')

/** The approved render for a runner, if any. */
async function approvedJob(orderId) {
  return prisma.renderJob.findFirst({ where: { orderId, status: 'done', review: 'approved' }, orderBy: { version: 'desc' } })
}

/** Why this runner cannot go yet, or null when they can. */
export async function notReadyReason(order, bulk) {
  if (order.status === 'completed' || order.bulkSentAt) return null
  if (!bulk?.paidAt) return 'Invoice not paid'
  if (!addressComplete(order.shippingAddress)) return 'No complete address'
  if (order.productionFileUrl) return null
  if (await approvedJob(order.id)) return null
  if (!order.researchedAt) return 'Not researched yet'
  return 'Print not approved yet'
}

/**
 * Queue a runner's send, if they are ready. Called when a print is approved,
 * a co-branded file is uploaded, an address is fixed, or the invoice is paid.
 * A runner with an error stays put until a person presses Send now.
 */
export async function queueRunnerSend(orderId, { force = false } = {}) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { bulkOrder: { select: { paidAt: true } } } })
  if (!order || order.trackstarOrderType !== 'bulk' || order.status === 'completed' || order.bulkSentAt) return null
  if (!force && order.bulkSendError) return order
  if (await notReadyReason(order, order.bulkOrder)) return order
  return prisma.order.update({ where: { id: orderId }, data: { bulkSendAfter: new Date(), bulkSendError: null } })
}

/** Everyone on a bulk order who is ready and not queued: after the invoice is paid, or a list was fixed. */
export async function queueReadyRunners(bulkOrderId) {
  const rows = await prisma.order.findMany({ where: { bulkOrderId, status: { not: 'completed' }, bulkSentAt: null, bulkSendAfter: null, bulkSendError: null }, select: { id: true } })
  let n = 0
  for (const r of rows) { const out = await queueRunnerSend(r.id); if (out?.bulkSendAfter) n++ }
  return n
}

export async function holdRunner(orderId, actor) {
  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
  return prisma.order.update({ where: { id: orderId, bulkSentAt: null }, data: { bulkSendAfter: null, bulkSendError: `Held by ${by}` } })
}

export async function sendRunnerNow(orderId, actor) {
  const out = await queueRunnerSend(orderId, { force: true })
  if (!out?.bulkSendAfter) {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { bulkOrder: { select: { paidAt: true } } } })
    throw new BulkSendError(order ? (await notReadyReason(order, order.bulkOrder)) || 'Already sent' : 'Runner not found')
  }
  await recordAudit({ action: 'bulk.send_now', summary: `Sent bulk runner ${out.orderNumber} to Artelo now`, detail: { orderId }, actor })
  return out
}

/** The design's library upload id, uploading the file if it is not there yet. */
async function libraryImage(order) {
  const job = await approvedJob(order.id)
  if (job) {
    let j = job
    if (!j.arteloUploadId) j = await uploadApprovedToArtelo(j)
    if (!j.arteloUploadId) throw Object.assign(new Error(`The print is not in the Artelo library yet${j.arteloError ? `: ${j.arteloError}` : ''}`), { retryIn: 2 })
    return { imageId: j.arteloUploadId, jobId: j.id }
  }
  if (!order.productionFileUrl) throw new BulkSendError('No print file')
  // The designer's upload, by its public URL. Remembered on the row so a retry does not upload it twice.
  const prior = order.arteloOrderData?.libraryUploadId
  if (prior && order.arteloOrderData?.libraryUploadFor === order.productionFileUrl) return { imageId: prior, jobId: null }
  if (!/\.pdf(\?|$)/i.test(order.productionFileUrl)) throw new BulkSendError('The print file has to be a PDF for Artelo')
  const imageId = await uploadPdfToLibrary(order.productionFileUrl, `${order.orderNumber}.pdf`)
  await prisma.order.update({ where: { id: order.id }, data: { arteloOrderData: { ...(order.arteloOrderData || {}), libraryUploadId: imageId, libraryUploadFor: order.productionFileUrl } } })
  return { imageId, jobId: null }
}

/** Create the runner's Artelo order with the design on it, send it to production, complete them here. Throws on a refusal. */
async function sendRunner(order) {
  const upload = await libraryImage(order)
  const got = await call('uploads/files/get-by-id', { query: { id: upload.imageId } })
  if (got?.status === 'Pending') throw Object.assign(new Error('Artelo is still processing the file'), { retryIn: 1 })
  if (got?.status === 'Deleted') throw new BulkSendError('Artelo rejected the file in its library')

  const size = arteloSize(order.productSize)
  const product = standardProduct(size, arteloFrame(order.frameType))
  const design = { imageId: upload.imageId }
  await checkDesignFits(design, size, order.orderNumber)
  const customerAddress = arteloAddress(order)
  const bulk = order.bulkOrder
  const body = {
    orderId: order.orderNumber,
    createdAt: new Date().toISOString(),
    currency: 'USD',
    channelName: 'Trackstar Bulk',
    customerAddress,
    items: [{ orderItemId: `${order.orderNumber}-1`, productInfo: { catalogProductId: product.catalogProductId, size: product.size, frameColor: product.frameColor, paperType: product.paperType, orientation: product.orientation, includeMats: product.includeMats, includeHangingPins: product.includeHangingPins, includeFramingService: product.includeFramingService, canvasDesignedFor: null, canvasBorderStyle: null, designs: [design] }, quantity: 1, unitPrice: 0 }],
    // Paid on the partner's invoice in Shopify; Artelo bills its own price per print.
    shippingCost: 0,
    total: 0,
    instructions: `${bulk.partnerName} bulk order ${bulk.number}: ${order.runnerNameOverride || order.runnerName}`.slice(0, 1000),
  }
  // An earlier try may have created this order at Artelo and lost the answer
  // (a timeout after Artelo accepted it, or a failed save here): that would
  // make a second order, a second print and a second charge. The marker below
  // is written before every create, so a retry looks first, by our order
  // number, and carries on with the order it finds.
  if (order.arteloOrderData?.creatingAt && !order.arteloOrderData?.createdByTool) {
    let found = null
    try {
      const list = await call('orders/get', { query: { limit: '5', allOrders: 'true', name: order.orderNumber } })
      found = (Array.isArray(list) ? list : []).find(r => String(r.orderId || '') === order.orderNumber) || null
    } catch (e) {
      throw new BulkSendError(`An earlier send may already have made ${order.orderNumber} at Artelo, and Artelo could not be asked (${e.message}). Check Artelo for ${order.orderNumber} before pressing Send now.`)
    }
    if (found?.id) {
      const arteloOrderData = { ...(order.arteloOrderData || {}), ...found, id: found.id, orderId: order.orderNumber, customerAddress, createdByTool: true }
      await prisma.order.update({ where: { id: order.id }, data: { arteloOrderData } })
      console.log(`[bulk.send] ${order.orderNumber} was already at Artelo (${found.id}); carrying on with that order`)
      return resumeSend({ ...order, arteloOrderData })
    }
  }
  await prisma.order.update({ where: { id: order.id }, data: { arteloOrderData: { ...(order.arteloOrderData || {}), creatingAt: new Date().toISOString() } } })
  const created = await call('orders/create', { method: 'POST', body })
  const arteloId = created?.id
  if (!arteloId) throw new Error('Artelo did not return an order id')
  // Ours now, whatever happens next: a failed send-to-production retries against this order, not a second one.
  await prisma.order.update({ where: { id: order.id }, data: { arteloOrderData: { ...(order.arteloOrderData || {}), ...created, id: arteloId, orderId: order.orderNumber, customerAddress, createdByTool: true } } })
  try {
    await call('orders/send-to-production', { method: 'POST', body: { orderId: arteloId } })
  } catch (e) {
    if (e.status === 409 && /process/i.test(e.arteloMessage || '')) throw Object.assign(new Error('Artelo is still processing the image'), { retryIn: 1 })
    // Artelo may take the order straight into production when it is created
    // ("Order can't be sent to production while it is Received"): that is
    // sent, not a failure. Only an order still waiting on us is one.
    const live = await call('orders/get-by-id', { query: { orderId: arteloId } }).catch(() => null)
    if (!live || live.status === 'PendingFulfillmentAction') throw new BulkSendError(`Artelo would not send it: ${e.arteloMessage || e.message}`)
  }
  const now = new Date()
  await prisma.order.update({ where: { id: order.id }, data: { bulkSentAt: now, bulkSendAfter: null, bulkSendError: null } })
  if (upload.jobId) await prisma.renderJob.update({ where: { id: upload.jobId }, data: { arteloSentAt: now, sendAfter: null, sendError: null } }).catch(() => {})
  await completeOrder({ orderId: order.id, via: 'approve', renderJobId: upload.jobId })
  await prisma.orderComment.create({ data: { orderId: order.id, text: `Sent to Artelo production as order ${order.orderNumber} (${bulk.number}).`, authorName: 'TrackstarOS' } })
  await recordAudit({ action: 'artelo.sent', summary: `Sent bulk runner ${order.orderNumber} (${order.runnerNameOverride || order.runnerName}) to production in Artelo`, detail: { orderId: order.id, orderNumber: order.orderNumber, bulk: bulk.number, arteloOrderId: arteloId }, actor: null })
  return { arteloId, url: arteloOrderUrl(arteloId) }
}

/** Once a sent order is in Artelo but the send failed, the retry picks up here instead of creating another. */
async function resumeSend(order) {
  const arteloId = order.arteloOrderData?.id
  if (!arteloId || !order.arteloOrderData?.createdByTool) return sendRunner(order)
  const live = await call('orders/get-by-id', { query: { orderId: arteloId } })
  if (live?.status === 'PendingFulfillmentAction') {
    try { await call('orders/send-to-production', { method: 'POST', body: { orderId: arteloId } }) }
    catch (e) {
      if (e.status === 409 && /process/i.test(e.arteloMessage || '')) throw Object.assign(new Error('Artelo is still processing the image'), { retryIn: 1 })
      throw new BulkSendError(`Artelo would not send it: ${e.arteloMessage || e.message}`)
    }
  }
  const now = new Date()
  await prisma.order.update({ where: { id: order.id }, data: { bulkSentAt: now, bulkSendAfter: null, bulkSendError: null } })
  await completeOrder({ orderId: order.id, via: 'approve' })
  return { arteloId, url: arteloOrderUrl(arteloId) }
}

/**
 * The whole run reads as sent once every paid-for print has gone. A DNF
 * runner (dnf.js) is not a print, and prints refunded (refunds.js) are no
 * longer paid for.
 */
export async function settleBulkStatus(bulkOrderId) {
  const bulk = await prisma.bulkOrder.findUnique({ where: { id: bulkOrderId }, select: { id: true, status: true, quantity: true } })
  if (!bulk || bulk.status === 'submitted') return
  const [total, sent, refunded] = await Promise.all([
    prisma.order.count({ where: { bulkOrderId, bulkDnfAt: null } }),
    prisma.order.count({ where: { bulkOrderId, bulkDnfAt: null, status: 'completed' } }),
    prisma.bulkRefund.aggregate({ where: { bulkOrderId, status: 'refunded', kind: { in: ['unfilled', 'full'] } }, _sum: { prints: true } }),
  ])
  const owed = Math.max(0, (bulk.quantity || 0) - (refunded._sum.prints || 0))
  if (total && sent >= total && total >= owed) await prisma.bulkOrder.update({ where: { id: bulkOrderId }, data: { status: 'submitted', submittedAt: new Date() } })
  else if (sent && bulk.status === 'collecting') await prisma.bulkOrder.update({ where: { id: bulkOrderId }, data: { status: 'fulfillment' } })
}

/**
 * Every runner whose time has come, oldest first, within `budgetMs`. Each is
 * claimed first, so two runs never send the same runner twice. Never throws.
 */
export async function sendBulkDue({ limit = 20, budgetMs = 60_000 } = {}) {
  const started = Date.now()
  const due = await prisma.order.findMany({
    where: { trackstarOrderType: 'bulk', status: { not: 'completed' }, bulkSentAt: null, bulkSendAfter: { lte: new Date() } },
    orderBy: { bulkSendAfter: 'asc' }, take: limit,
    include: { bulkOrder: { select: { id: true, number: true, partnerName: true, paidAt: true } } },
  })
  let sent = 0, failed = 0
  for (const o of due) {
    if (Date.now() - started > budgetMs) break
    const claimed = await prisma.order.updateMany({ where: { id: o.id, bulkSendAfter: o.bulkSendAfter, bulkSentAt: null }, data: { bulkSendAfter: new Date(Date.now() + 3 * MIN) } })
    if (!claimed.count) continue
    try {
      const out = o.arteloOrderData?.createdByTool ? await resumeSend(o) : await sendRunner(o)
      sent++
      console.log(`[bulk.send] Sent ${o.orderNumber} to production (${out.arteloId})`)
      await settleBulkStatus(o.bulkOrderId)
    } catch (e) {
      failed++
      const retryIn = Number.isFinite(e.retryIn) ? e.retryIn : null
      const message = String(e.message || e).slice(0, 300)
      await prisma.order.update({ where: { id: o.id }, data: { bulkSendError: message, bulkSendAfter: retryIn == null ? null : new Date(Date.now() + retryIn * MIN) } }).catch(() => {})
      console.error('[bulk.send]', o.orderNumber, message)
      if (retryIn == null) {
        await slackTo('alerts', `⚠️ Bulk runner *${slackLink(orderAppUrl(o.orderNumber), o.orderNumber)}* (${slackText(o.runnerNameOverride || o.runnerName || '')}, ${slackText(o.bulkOrder?.partnerName || '')}) did not go to Artelo: ${slackText(message, 300)}. Fix it on the bulk order and press Send now.`).catch(() => {})
      }
    }
  }
  return { tried: due.length, sent, failed }
}

/** Where a runner stands, for the bulk page. */
export function sendStateOf(order, notReady) {
  if (order.status === 'completed' || order.bulkSentAt) return { state: 'sent', at: order.bulkSentAt, url: arteloOrderUrl(order.arteloOrderData?.id) || null }
  if (order.bulkSendError && !order.bulkSendAfter) return { state: /^Held by /.test(order.bulkSendError) ? 'held' : 'error', reason: order.bulkSendError }
  if (order.bulkSendAfter) return { state: 'queued', at: order.bulkSendAfter, reason: order.bulkSendError || null }
  if (notReady) return { state: 'not_ready', reason: notReady }
  return { state: 'ready' }
}
