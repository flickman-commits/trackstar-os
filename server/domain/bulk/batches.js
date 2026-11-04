/**
 * Sending a bulk order to Artelo in batches, for a partner whose runner list
 * comes in pieces (Release Foundation, NYC 2026: 145 paid for, 82 names in).
 *
 * A batch is the runners ready right now (an address and a print file) that
 * have not gone yet. Download its sheet, upload it on Artelo's Orders page,
 * then mark it uploaded: those runners are completed here and the batch is
 * logged (number, when, who, which runners). The order shows what went in
 * each batch, who is ready for the next one, who is not ready and why, and
 * how many names the partner still owes against what they paid for.
 *
 * The log lives in SystemConfig (bulk_batches:<bulkOrderId>), so batches
 * needed no new columns. A runner is "sent" once it is completed, which is
 * also what the whole-order flow used to set.
 */
import prisma from '../../../api/_lib/prisma.js'
import { addressComplete } from './bulkOrders.js'

const key = id => `bulk_batches:${id}`

export class BatchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

/** The batches sent so far, oldest first: [{ n, sentAt, by, orderIds }]. */
export async function getBatches(bulkOrderId) {
  const row = await prisma.systemConfig.findUnique({ where: { key: key(bulkOrderId) } })
  try { return row?.value ? JSON.parse(row.value) : [] } catch { return [] }
}

/** Why a runner cannot go in a batch yet, or null when it can. */
export function notReadyReason(r) {
  if (r.status === 'completed') return null
  if (!addressComplete(r.shippingAddress)) return 'No complete address'
  if (!r.productionFileUrl) {
    const rs = r.runnerResearch?.[0]?.researchStatus
    if (!r.researchedAt) return 'Not researched yet'
    if (rs && rs !== 'found') return 'Result not found'
    return 'Print not approved yet'
  }
  return null
}

/** Where every runner stands, for the page. */
export async function batchState(bulk, runners) {
  const batches = await getBatches(bulk.id)
  const batchOf = new Map()
  for (const b of batches) for (const id of b.orderIds) batchOf.set(id, b.n)
  const sent = runners.filter(r => r.status === 'completed')
  const ready = runners.filter(r => r.status !== 'completed' && !notReadyReason(r))
  const waiting = runners.filter(r => r.status !== 'completed' && notReadyReason(r))
  const reasons = {}
  for (const r of waiting) { const why = notReadyReason(r); reasons[why] = (reasons[why] || 0) + 1 }
  return {
    batches: batches.map(b => ({ n: b.n, sentAt: b.sentAt, by: b.by, count: b.orderIds.length })),
    batchOf: Object.fromEntries(batchOf),
    sent: sent.length,
    ready: ready.map(r => r.orderNumber),
    readyCount: ready.length,
    waiting: waiting.length,
    waitingReasons: reasons,
    // Names the partner has not sent yet, against what they paid for.
    toCome: Math.max(0, (bulk.quantity || 0) - runners.length),
    nextBatch: (batches.at(-1)?.n || 0) + 1,
  }
}

/** The runners in the next batch (ready, not sent), in list order. */
export function nextBatchRunners(runners) {
  return runners.filter(r => r.status !== 'completed' && !notReadyReason(r))
}

/**
 * Log a batch as uploaded to Artelo: complete those runners and record it.
 * `orderNumbers` defaults to everyone ready. The whole order reads as sent to
 * Artelo once every paid-for print has gone.
 */
export async function markBatchSent(bulk, { orderNumbers, actor } = {}) {
  const runners = await prisma.order.findMany({ where: { bulkOrderId: bulk.id }, orderBy: { lineItemIndex: 'asc' }, select: { id: true, orderNumber: true, status: true, shippingAddress: true, productionFileUrl: true, researchedAt: true, runnerResearch: { select: { researchStatus: true }, take: 1, orderBy: { createdAt: 'desc' } } } })
  const wanted = Array.isArray(orderNumbers) && orderNumbers.length ? new Set(orderNumbers.map(String)) : null
  const pick = nextBatchRunners(runners).filter(r => !wanted || wanted.has(r.orderNumber))
  if (!pick.length) throw new BatchError('Nobody is ready to send: every runner in a batch needs an address and an approved print.')
  const batches = await getBatches(bulk.id)
  const n = (batches.at(-1)?.n || 0) + 1
  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
  const now = new Date()
  const entry = { n, sentAt: now.toISOString(), by, orderIds: pick.map(r => r.id) }
  await prisma.$transaction([
    prisma.order.updateMany({ where: { id: { in: entry.orderIds } }, data: { status: 'completed' } }),
    prisma.orderComment.createMany({ data: pick.map(r => ({ orderId: r.id, text: `Sent to Artelo in batch ${n} of ${bulk.number}.`, authorId: actor?.id || null, authorName: by })) }),
    prisma.systemConfig.upsert({ where: { key: key(bulk.id) }, update: { value: JSON.stringify([...batches, entry]) }, create: { key: key(bulk.id), value: JSON.stringify([...batches, entry]) } }),
  ])
  const sentNow = runners.filter(r => r.status === 'completed').length + pick.length
  const allGone = sentNow >= runners.length && runners.length >= (bulk.quantity || 0)
  await prisma.bulkOrder.update({ where: { id: bulk.id }, data: allGone ? { status: 'submitted', submittedAt: now } : { status: bulk.status === 'collecting' ? 'fulfillment' : bulk.status } })
  return { n, count: pick.length, allGone }
}

/** The runners of one past batch, for downloading its sheet again. */
export async function batchRunnerIds(bulkOrderId, n) {
  const b = (await getBatches(bulkOrderId)).find(x => x.n === Number(n))
  if (!b) throw new BatchError(`There is no batch ${n}`, 404)
  return b.orderIds
}
