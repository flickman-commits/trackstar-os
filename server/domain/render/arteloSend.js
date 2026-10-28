/**
 * Approve sends the print to production. An approved standard render, or a
 * custom order's final PDF, waits a few minutes (sendAfter) so a wrong click
 * can be held, then the sender (api/cron/artelo-send.js, every minute) does
 * what a person used to do in Artelo:
 *
 *   1. the PDF is in the Artelo library (artelo.js uploads it on approve)
 *   2. POST orders/update-item-designs puts it on this print's order item
 *   3. once every item on the Artelo order has its design, POST
 *      orders/send-to-production sends the order (the same as approving it in Artelo)
 *   4. the order is completed here
 *
 * The item is found by the seller's line item id (the Shopify line item, or
 * the Etsy transaction) that the import saved with the order, and its size
 * must match the print. An order with several prints goes when the last one
 * is attached; until then it reads "waiting on the other prints".
 *
 * Artelo refusing (unpaid, address to review, already in production, a size
 * that does not match) is saved as sendError and the order shows under
 * Action with that reason. Things that sort themselves out (images still
 * processing, the order not imported yet, a payment) are tried again later;
 * the rest wait for a person, who can Send now once it is fixed.
 *
 * Expedited orders are not sent either: send-to-production always ships
 * Standard and the API has no way to pick a faster service, so the file goes
 * to the library and the order waits for a person to attach it and change the
 * shipping in Artelo (shown as "manual", under Action).
 *
 * Bulk and partner orders are not sent this way. Sending can be switched off
 * (Settings > Connections > Artelo, auto-send); approving then only uploads
 * to the library, as before.
 */
import prisma from '../../db.js'
import { call, uploadApprovedToArtelo } from './artelo.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { completeOrder, describeOrder } from '../orders/complete.js'
import { setDesignStatus } from '../orders/designStatus.js'
import { unpaidPhotoRows } from '../orders/photoPayment.js'
import { postSlack, slackText } from '../../lib/slack.js'
import { arteloOrderUrl } from '../../lib/links.js'
import { sendStateOf, WAITING, EXPEDITED } from './sendState.js'
import { isExpeditedShipping } from '../../lib/shipping.js'

export const SEND_TYPES = ['standard', 'custom']
const OFF_KEY = 'artelo_auto_send_off'
const MIN = 60_000
const holdMinutes = () => Math.max(0, Number(process.env.ARTELO_SEND_HOLD_MINUTES ?? 5) || 0)

export class SendError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

/** Whether Approve sends to production. On unless an admin switched it off. */
export async function autoSendOn() {
  const row = await prisma.systemConfig.findUnique({ where: { key: OFF_KEY } }).catch(() => null)
  return !row?.value
}

export async function setAutoSend(on, actor) {
  if (on) await prisma.systemConfig.deleteMany({ where: { key: OFF_KEY } })
  else await prisma.systemConfig.upsert({ where: { key: OFF_KEY }, update: { value: '1' }, create: { key: OFF_KEY, value: '1' } })
  await recordAudit({ action: 'artelo.auto_send', summary: on ? 'Turned on sending approved prints to Artelo production' : 'Turned off sending approved prints to Artelo production', actor })
  return { on: Boolean(on) }
}

function personName(actor) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || actor?.email || 'Someone'
}

function displayNumber(order) {
  const n = order.shopifyOrderData && typeof order.shopifyOrderData === 'object' && order.shopifyOrderData.name
  const base = String(n || order.parentOrderNumber || order.orderNumber).replace('#', '')
  return `#${base}`
}

/**
 * Queue an approved job to be sent after the hold. Called by Approve and by
 * the custom final PDF upload. Leaves the job alone when the order type is
 * not sent this way or sending is off. Never throws.
 */
export async function queueSend(job, { orderType } = {}) {
  try {
    // Held before it was approved (the mockup went to the customer to approve,
    // holdForCustomer): it stays held, and Send now releases it once they say yes.
    if (job.sendHeldAt) return job
    const type = orderType || (await prisma.order.findUnique({ where: { id: job.orderId }, select: { trackstarOrderType: true } }))?.trackstarOrderType
    if (!SEND_TYPES.includes(type) || !(await autoSendOn())) return job
    return await prisma.renderJob.update({
      where: { id: job.id },
      data: { sendAfter: new Date(Date.now() + holdMinutes() * MIN), sendHeldAt: null, sendHeldBy: null, sendError: null },
    })
  } catch (e) {
    console.error('[artelo.send] queue', job.id, e.message)
    return job
  }
}

/** The newest approved job on an order: the one that would be sent. */
async function sendableJob(orderId) {
  return prisma.renderJob.findFirst({ where: { orderId: String(orderId || ''), status: 'done', review: 'approved' }, orderBy: { version: 'desc' } })
}

/** Hold an order that is waiting to send. It stays approved; Send now releases it. */
export async function holdSend({ orderId, actor }) {
  const job = await sendableJob(orderId)
  if (!job) throw new SendError('This order has no approved print', 404)
  if (job.arteloSentAt) throw new SendError('This order was already sent to production')
  const out = await prisma.renderJob.update({ where: { id: job.id }, data: { sendHeldAt: new Date(), sendHeldBy: personName(actor), sendAfter: null } })
  const order = await prisma.order.findUnique({ where: { id: job.orderId } })
  await recordAudit({ action: 'artelo.hold', summary: `Held ${order ? describeOrder(order) : job.orderId} from going to production`, detail: { jobId: job.id, orderId: job.orderId }, actor })
  return out
}

/**
 * The design went to the customer to approve ("Email customer", Approve
 * mockup): hold its newest print, approved or still waiting for review, so
 * nothing sends to production until they answer. Approving it keeps the hold
 * (queueSend); Send now releases it. Returns the held job, or null when the
 * order has no print that could send.
 */
export async function holdForCustomer({ orderId, actor }) {
  const job = await prisma.renderJob.findFirst({ where: { orderId: String(orderId || ''), status: 'done', review: { in: ['pending', 'approved'] }, arteloSentAt: null }, orderBy: { version: 'desc' } })
  if (!job) return null
  return prisma.renderJob.update({ where: { id: job.id }, data: { sendHeldAt: new Date(), sendHeldBy: `${personName(actor)}, waiting on the customer's approval`, sendAfter: null } })
}

/**
 * Send now: for a held order, one approved before Approve sent things, or one
 * Artelo refused and a person has since fixed. Tries again from the start
 * (including the attach) on the sender's next pass, within a minute.
 */
export async function sendNow({ orderId, actor }) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { id: true, trackstarOrderType: true, status: true, orderNumber: true, runnerName: true, raceName: true, raceYear: true } })
  if (!order) throw new SendError('Order not found', 404)
  if (!SEND_TYPES.includes(order.trackstarOrderType)) throw new SendError('Only standard and custom orders are sent from here')
  if (order.status === 'completed') throw new SendError('This order is already complete')
  if (!(await autoSendOn())) throw new SendError('Sending to production is switched off (Settings > Connections > Artelo)')
  const job = await sendableJob(order.id)
  if (!job) throw new SendError('This order has no approved print')
  if (job.arteloSentAt) throw new SendError('This order was already sent to production')
  const out = await prisma.renderJob.update({ where: { id: job.id }, data: { sendAfter: new Date(), sendHeldAt: null, sendHeldBy: null, sendError: null, arteloAttachedAt: null } })
  await recordAudit({ action: 'artelo.send_now', summary: `Sent ${describeOrder(order)} to production`, detail: { jobId: job.id, orderId: order.id }, actor })
  return out
}

/** Where the job is, in words the order view shows (sendState.js). */
export const sendState = sendStateOf

// --- the sender ---

const ORDER_SELECT = {
  id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, status: true, trackstarOrderType: true,
  runnerName: true, raceName: true, raceYear: true, productSize: true, photoPath: true, photoAddedManually: true,
  shopifyOrderData: true, arteloOrderData: true, designStatus: true,
}

/** "x12x18" and "12x18" and "18x12" are the same print. */
function sameSize(a, b) {
  const dims = s => String(s || '').replace(/^x/i, '').split('x').map(Number).filter(Boolean).sort((p, q) => p - q).join('x')
  const x = dims(a), y = dims(b)
  return !x || !y || x === y
}

/**
 * Save the outcome on the job. retryIn: minutes to the next try, or null to
 * wait for a person (Send now).
 */
async function outcome(job, { error = null, retryIn = null, attachedItemId, notify = false }) {
  const data = { sendError: error, sendCheckedAt: new Date(), sendAfter: retryIn == null ? null : new Date(Date.now() + retryIn * MIN) }
  if (attachedItemId) { data.arteloItemId = attachedItemId; data.arteloAttachedAt = new Date() }
  const out = await prisma.renderJob.update({ where: { id: job.id }, data })
  // Tell Matt once when an order needs a person, not on every retry.
  if (notify && error && error !== job.sendError) await pingStuck(job, error)
  return out
}

async function pingStuck(job, error) {
  const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: ORDER_SELECT }).catch(() => null)
  if (!order) return
  const link = arteloOrderUrl(order.arteloOrderData?.id)
  await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL, [
    `⚠️ Approved order *${slackText(displayNumber(order))}*${order.runnerName ? ` (${slackText(order.runnerName)})` : ''} did not go to production: ${slackText(error, 300)}`,
    link ? `<${link}|Open the Artelo order>; once it is sorted, Send now on the order in the tool.` : null,
  ].filter(Boolean).join('\n')).catch(() => {})
}

/** Complete every order in our tool whose print went with this Artelo order. */
async function markSent(job, order, actorId) {
  const now = new Date()
  const actor = actorId ? await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, email: true, firstName: true, lastName: true } }) : null
  // This print and any other print of the same Artelo order that was attached and waiting.
  const siblings = await prisma.order.findMany({ where: { parentOrderNumber: order.parentOrderNumber, status: { not: 'completed' } }, select: ORDER_SELECT })
  const rows = [order, ...siblings.filter(s => s.id !== order.id && s.arteloOrderData?.id === order.arteloOrderData?.id)]
  const problems = []
  for (const row of rows) {
    const j = row.id === order.id ? job : await sendableJob(row.id)
    if (!j) continue
    if (row.id !== order.id && !j.arteloAttachedAt) continue
    await prisma.renderJob.update({ where: { id: j.id }, data: { arteloSentAt: now, sendAfter: null, sendError: null, sendCheckedAt: now } })
    try {
      if (row.trackstarOrderType === 'custom') await setDesignStatus(row, 'sent_to_production', j.reviewedById || null, actor, { checkArtelo: false })
      else await completeOrder({ orderId: row.id, actor, via: 'approve', renderJobId: j.id })
    } catch (e) {
      problems.push(e.message)
      await prisma.renderJob.update({ where: { id: j.id }, data: { sendError: `Sent to production; could not mark it complete here: ${String(e.message).slice(0, 200)}` } })
    }
  }
  await recordAudit({
    action: 'artelo.sent',
    summary: `Sent ${displayNumber(order)}${order.runnerName ? ` (${order.runnerName})` : ''} to production in Artelo`,
    detail: { jobId: job.id, orderId: order.id, arteloOrderId: order.arteloOrderData?.id, prints: rows.length, problems },
    actor,
  })
}

/**
 * One job, as far as it can go now. Never throws; the outcome is saved on the job.
 */
export async function sendOne(job) {
  try {
    const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: ORDER_SELECT })
    if (!order) return outcome(job, { error: 'The order is gone' })
    if (!SEND_TYPES.includes(order.trackstarOrderType)) return outcome(job, {})
    const newest = await sendableJob(order.id)
    if (newest && newest.id !== job.id) return outcome(job, {})
    if (order.status === 'completed') return outcome(job, { error: 'The order was marked done by hand, so it was not sent' })

    // A photo added after purchase is printed only once it is paid for.
    if (order.photoAddedManually) {
      const sibs = await prisma.order.findMany({ where: { parentOrderNumber: order.parentOrderNumber }, select: { id: true, photoPath: true, photoAddedManually: true, trackstarOrderType: true } })
      if (unpaidPhotoRows(sibs, order.shopifyOrderData).has(order.id)) return outcome(job, { error: 'The customer has not paid for the photo yet', retryIn: 30 })
    }

    // The file in the library first.
    if (!job.arteloUploadedAt || !job.arteloUploadId) {
      job = await uploadApprovedToArtelo(job)
      if (!job.arteloUploadId) return outcome(job, { error: `The print is not in the Artelo library yet${job.arteloError ? `: ${job.arteloError}` : ''}`, retryIn: 2 })
    }
    const upload = await call('uploads/files/get-by-id', { query: { id: job.arteloUploadId } })
    if (upload?.status === 'Pending') return outcome(job, { error: 'Artelo is still processing the file', retryIn: 1 })
    if (upload?.status === 'Deleted') return outcome(job, { error: 'Artelo rejected the file in its library', notify: true })

    // Artelo's API only sends Standard shipping: a person attaches it and picks the faster service.
    if (isExpeditedShipping(order.shopifyOrderData)) return outcome(job, { error: `${EXPEDITED}: manually attach and add expedited shipping to this order in Artelo, then mark it complete`, notify: true })

    const arteloId = order.arteloOrderData?.id
    if (!arteloId) return outcome(job, { error: 'Artelo has not imported this order yet', retryIn: 10 })
    const live = await call('orders/get-by-id', { query: { orderId: arteloId } })

    // Already gone: a print sent with another item of this order, or by hand.
    if (live?.status !== 'PendingFulfillmentAction') {
      const sentByUs = await prisma.renderJob.findFirst({ where: { arteloSentAt: { not: null }, order: { parentOrderNumber: order.parentOrderNumber } }, select: { reviewedById: true } })
      if (sentByUs && ['Received', 'InProduction'].includes(live?.status)) { await markSent(job, order, job.reviewedById); return }
      // Our design was on this very item before someone sent the order from
      // Artelo by hand (MCM 6144 and five others, 2026-10-27): what prints is ours.
      const ours = job.arteloAttachedAt && job.arteloItemId && (live?.orderItems || []).some(i => i.id === job.arteloItemId)
      if (ours && ['Received', 'InProduction'].includes(live?.status)) { await markSent(job, order, job.reviewedById); return }
      return outcome(job, { error: `Artelo already has this order as ${live?.productionStatus || live?.status}. Nothing was sent; a change now means a reprint.`, notify: true })
    }

    // This print's item on the Artelo order.
    const seller = order.arteloOrderData?.orderItems?.[order.lineItemIndex]?.orderItemId
    let item = seller ? (live.orderItems || []).find(i => String(i.orderItemId) === String(seller)) : null
    // Our copy of the Artelo order goes stale when the Shopify line is replaced
    // (an edited order: 4730's item came back with a new orderItemId). Then the
    // order's only item of this print's size is it; two or more stays a person's call.
    if (!item) {
      const wantSize = order.trackstarOrderType === 'standard' ? (job.spec?.size || order.productSize) : order.productSize
      const fits = (live.orderItems || []).filter(i => sameSize(i.product?.size, wantSize))
      if (fits.length === 1) item = fits[0]
    }
    if (!item?.id) return outcome(job, { error: 'Could not match this print to an item on the Artelo order', notify: true })
    const size = order.trackstarOrderType === 'standard' ? (job.spec?.size || order.productSize) : order.productSize
    if (!sameSize(item.product?.size, size)) return outcome(job, { error: `The Artelo item is ${String(item.product?.size || '').replace(/^x/, '')} but this print is ${size}`, notify: true })

    let status = live.productionStatus
    if (!job.arteloAttachedAt || job.arteloItemId !== item.id) {
      const attached = await call('orders/update-item-designs', { method: 'POST', body: { orderId: arteloId, orderItemId: item.id, designs: [{ imageId: job.arteloUploadId }] } })
      status = attached?.order?.productionStatus || status
      job = await outcome(job, { error: null, retryIn: 0, attachedItemId: item.id })
      console.log(`[artelo.send] Attached ${job.spec?.file || job.id} to ${displayNumber(order)} (${status})`)
    }

    // Attached; the order's other prints still need their designs. Not a
    // refusal: it waits (and can be marked complete) however long that takes.
    if (status === 'Missing Designs') {
      const minutes = job.arteloAttachedAt ? (Date.now() - new Date(job.arteloAttachedAt).getTime()) / MIN : 0
      return outcome(job, { error: `${WAITING} on this order`, retryIn: minutes > 60 ? 30 : 5 })
    }
    if (status && status !== 'Pending Approval') return outcome(job, { error: `Artelo: ${status}`, retryIn: 30, notify: true })

    try {
      await call('orders/send-to-production', { method: 'POST', body: { orderId: arteloId } })
    } catch (e) {
      if (e.status === 409 && /process/i.test(e.arteloMessage || '')) return outcome(job, { error: 'Artelo is still processing the image', retryIn: 1 })
      if (e.status === 409 || e.status === 400) return outcome(job, { error: `Artelo would not send it: ${e.arteloMessage || e.message}`, retryIn: 30, notify: true })
      throw e
    }
    console.log(`[artelo.send] Sent ${displayNumber(order)} to production`)
    await markSent(job, order, job.reviewedById)
  } catch (e) {
    console.error('[artelo.send]', job.id, e.message)
    // A refused key needs a person; anything else (a timeout, Artelo down) is tried again shortly.
    const auth = e.status === 401 || e.status === 403
    return outcome(job, { error: `Could not reach Artelo: ${String(e.arteloMessage || e.message).slice(0, 200)}`, retryIn: auth ? 30 : 2, notify: auth }).catch(() => {})
  }
}

/**
 * Every job whose time has come, oldest first, one at a time, within `budgetMs`.
 * Each is claimed first, so two runs at once never send the same print twice.
 */
export async function sendDue({ limit = 10, budgetMs = 45_000 } = {}) {
  if (!(await autoSendOn())) return { off: true, tried: 0 }
  const started = Date.now()
  const due = await prisma.renderJob.findMany({
    where: { status: 'done', review: 'approved', arteloSentAt: null, sendHeldAt: null, sendAfter: { lte: new Date() } },
    orderBy: { sendAfter: 'asc' }, take: limit,
  })
  let tried = 0
  for (const j of due) {
    if (Date.now() - started > budgetMs) break
    const claimed = await prisma.renderJob.updateMany({ where: { id: j.id, sendAfter: j.sendAfter, sendHeldAt: null, arteloSentAt: null }, data: { sendAfter: new Date(Date.now() + 3 * MIN) } })
    if (!claimed.count) continue
    tried++
    await sendOne(j)
  }
  return { off: false, tried }
}
