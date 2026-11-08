/**
 * Replacements we pay for, for the P&L. Every one is made from Support's New
 * Artelo order (support/arteloOrder.js createReorder), which records it here
 * with the reason the rep picked. Artelo bills it like any order; the cost
 * stored is Artelo's own total for it (orders/get details), read back after
 * it is made and again while it is recent, since shipping and fees settle
 * after the order. Until Artelo answers, the price check from the form
 * stands in (quotedCents). Artelo's free replacements after a damage claim
 * ("4341-R") never come through here.
 *
 * Finance > Replacements shows a month: the count, the cost, by reason.
 * Money is integer cents.
 */
import prisma from '../../db.js'
import { call } from '../render/artelo.js'
import { arteloOrderUrl } from '../../lib/links.js'
import { todayET } from './periods.js'

export const REASONS = [
  { value: 'damaged', label: 'Damaged in transit' },
  { value: 'lost', label: 'Lost in the mail' },
  { value: 'our_mistake', label: 'Our mistake' },
  { value: 'customer_change', label: 'Customer changed their mind' },
  { value: 'other', label: 'Other' },
]
const REASON_VALUES = new Set(REASONS.map(r => r.value))
export const isReason = r => REASON_VALUES.has(String(r || ''))

export class ReplacementError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

const cents = n => Math.round(Number(n || 0) * 100)
/** "x12x18" -> "12x18" */
const sizeOf = s => String(s || '').replace(/^x/, '').replace(/dot/g, '.')

/** Save one, right after Artelo made it. Never throws: the order exists either way. */
export async function recordReplacement({ arteloOrderId, arteloId, orderNumber, shopifyOrderId, threadId, reason, note, items, quotedCents, actor, actorName }) {
  try {
    const row = await prisma.replacement.upsert({
      where: { arteloOrderId },
      create: {
        arteloOrderId, arteloId: arteloId || null, orderNumber: String(orderNumber || ''), shopifyOrderId: shopifyOrderId ? String(shopifyOrderId) : null,
        threadId: threadId || null, reason: isReason(reason) ? reason : 'other', note: String(note || '').slice(0, 500),
        items: items || [], quotedCents: Number.isInteger(quotedCents) && quotedCents >= 0 ? quotedCents : null,
        createdById: actor?.id || null, createdByName: actorName || '',
      },
      update: {},
    })
    await refreshCost(row).catch(err => console.warn(`[replacements] cost of ${arteloOrderId}:`, err.message))
  } catch (err) {
    console.error(`[replacements] could not record ${arteloOrderId}:`, err.message)
  }
}

/** Artelo's own order, found by our orderId ("4829-R1"). */
async function arteloOrder(arteloOrderId) {
  const found = await call('orders/get', { query: { limit: '10', allOrders: 'true', name: arteloOrderId } })
  return (Array.isArray(found) ? found : []).find(o => String(o.orderId) === arteloOrderId) || null
}

/** What Artelo billed: its total, else the parts it lists. */
function billedOf(d) {
  if (!d) return null
  if (d.total != null) return cents(d.total)
  const parts = ['productionCost', 'arteloShipping', 'branding', 'holidayFees', 'packaging', 'usSalesTax']
  return parts.some(k => d[k] != null) ? parts.reduce((s, k) => s + cents(d[k]), 0) : null
}

/** Read one back from Artelo: billed cost, its id, what it is making, and whether it was cancelled. */
export async function refreshCost(row) {
  const o = await arteloOrder(row.arteloOrderId)
  const data = { costCheckedAt: new Date() }
  if (o) {
    const billed = billedOf(o.details)
    if (billed != null) data.billedCents = billed
    if (o.id) data.arteloId = String(o.id)
    data.canceled = o.status === 'Canceled' || o.productionStatus === 'Canceled' || o.productionStatus === 'Ignored'
    const items = (o.orderItems || []).map(it => ({
      kind: it.product?.catalogProductId === 'PictureFrame' ? 'frame' : 'print',
      size: sizeOf(it.product?.size), frame: it.product?.frameColor || 'Unframed',
    }))
    if (items.length) {
      // Keep the labels the rep saw when it was made; Artelo knows only sizes and frames.
      const before = Array.isArray(row.items) ? row.items : []
      data.items = items.map((it, n) => ({ ...(before[n] || {}), ...it }))
    }
  }
  return prisma.replacement.update({ where: { id: row.id }, data })
}

/** Recent ones, read again: Artelo's bill settles in the days after an order. */
async function refreshRecent() {
  const since = new Date(Date.now() - 21 * 86_400_000)
  const stale = new Date(Date.now() - 6 * 3_600_000)
  const rows = await prisma.replacement.findMany({
    where: { OR: [{ costCheckedAt: null }, { billedCents: null }, { createdAt: { gte: since }, costCheckedAt: { lt: stale } }] },
    orderBy: { createdAt: 'desc' }, take: 25,
  })
  for (const r of rows) await refreshCost(r).catch(err => console.warn(`[replacements] cost of ${r.arteloOrderId}:`, err.message))
}

/** Midnight Eastern at the start of a YYYY-MM-DD, as an instant. */
function startOfDayET(day) {
  const [y, m, d] = day.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, 5))
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(guess))
  return new Date(guess.getTime() - hour * 3_600_000)
}

/**
 * A month's replacements (YYYY-MM, Eastern), newest first, with the total
 * that goes in the P&L: cancelled and reimbursed ones are listed but not counted.
 */
export async function monthReplacements(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new ReplacementError('month must be YYYY-MM')
  await refreshRecent().catch(err => console.warn('[replacements] refresh:', err.message))
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const rows = await prisma.replacement.findMany({
    where: { createdAt: { gte: startOfDayET(`${month}-01`), lt: startOfDayET(`${next}-01`) } },
    orderBy: { createdAt: 'desc' },
  })
  const costOf = r => r.billedCents ?? r.quotedCents ?? 0
  const counted = rows.filter(r => !r.canceled && !r.reimbursed)
  const byReason = REASONS.map(r => {
    const these = counted.filter(x => x.reason === r.value)
    return { reason: r.value, label: r.label, count: these.length, cents: these.reduce((s, x) => s + costOf(x), 0) }
  }).filter(r => r.count)
  return {
    month,
    today: todayET(),
    reasons: REASONS,
    count: counted.length,
    totalCents: counted.reduce((s, r) => s + costOf(r), 0),
    estimated: counted.some(r => r.billedCents == null),
    byReason,
    rows: rows.map(r => ({
      id: r.id, arteloOrderId: r.arteloOrderId, orderNumber: r.orderNumber, url: arteloOrderUrl(r.arteloId) || null,
      threadId: r.threadId, reason: r.reason, note: r.note, items: r.items,
      cents: costOf(r), billed: r.billedCents != null, canceled: r.canceled, reimbursed: r.reimbursed,
      by: r.createdByName || null, createdAt: r.createdAt,
    })),
  }
}

/** Change the reason, the note, or mark it paid back. */
export async function updateReplacement(id, { reason, note, reimbursed }) {
  const data = {}
  if (reason !== undefined) { if (!isReason(reason)) throw new ReplacementError('Pick a reason from the list'); data.reason = reason }
  if (note !== undefined) data.note = String(note || '').slice(0, 500)
  if (reimbursed !== undefined) data.reimbursed = reimbursed === true
  const row = await prisma.replacement.findUnique({ where: { id: String(id || '') } })
  if (!row) throw new ReplacementError('No such replacement', 404)
  return prisma.replacement.update({ where: { id: row.id }, data })
}
