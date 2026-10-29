/**
 * /api/bulk - bulk partner orders.
 *
 *   GET                         list, newest due first, with progress counts
 *   GET ?id=                    one order with its runners and readiness
 *   GET ?options=1              frame and size choices for the form
 *   POST { action, ... }
 *     create      { partnerName, raceName, raceYear, quantity, frameType, productSize, partnerOrderId?, stripeInvoiceUrl? }
 *     update      { id, ...fields }          any editable field, assigneeId included
 *     paid        { id, paid: bool }
 *     intake      { id, text }               paste or CSV; returns what was added and any problems
 *     remove-runner { id, orderNumber }
 *     update-runner { id, orderNumber, runnerName?, address? }
 *     research    { id, limit? }             research the next batch of unresearched runners
 *     submitted   { id }                     the sheet went to Artelo
 *     new-intake-link { id }                 rotate the partner's intake token
 *     delete      { id }                     admins only; removes the runners too
 */
import { syncShopifyBulkOrders } from '../../server/domain/bulk/shopifyBulk.js'
import { paymentStatus, syncDraftStatus, setPaymentStatus, attachBilling } from '../../server/domain/bulk/deals.js'
import { shopifyAdminUrl } from '../../server/lib/links.js'
import prisma from '../_lib/prisma.js'
import { setCors, requireAdmin } from '../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../_lib/users.js'
import {
  nextNumber, dueDateFor, verifiedRaceDate, parseRunnerList, addRunners, readiness, researchPending,
  addressComplete, FRAME_OPTIONS, SIZE_OPTIONS, sheetProblems, isAllowedFileUrl,
} from '../../server/domain/bulk/bulkOrders.js'
import { getCanonicalRaceName } from '../../server/scrapers/index.js'
import { defaultAssigneeFor } from '../../server/domain/orders/assignment.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { seesMoney } from '../_lib/money.js'

const RUNNER_SELECT = {
  id: true, orderNumber: true, lineItemIndex: true, runnerName: true, runnerNameOverride: true, customerEmail: true,
  shippingAddress: true, productionFileUrl: true, researchedAt: true, status: true, dueDate: true,
  runnerResearch: { select: { bibNumber: true, officialTime: true, officialPace: true, researchStatus: true, eventType: true }, take: 1, orderBy: { createdAt: 'desc' } },
}

function shapeRunner(r) {
  const rr = r.runnerResearch?.[0] || null
  return {
    id: r.id,
    orderNumber: r.orderNumber,
    lineItemIndex: r.lineItemIndex,
    runnerName: r.runnerNameOverride || r.runnerName,
    email: r.customerEmail,
    address: r.shippingAddress || null,
    addressComplete: addressComplete(r.shippingAddress),
    fileUrl: r.productionFileUrl,
    researched: Boolean(r.researchedAt),
    researchStatus: rr?.researchStatus || null,
    bib: rr?.bibNumber || null,
    time: rr?.officialTime || null,
    pace: rr?.officialPace || null,
    eventType: rr?.eventType || null,
    completed: r.status === 'completed',
  }
}

async function loadOne(id) {
  const bulk = await prisma.bulkOrder.findUnique({ where: { id }, include: { deal: { select: { id: true, number: true, printKind: true, invoiceSentAt: true, paidAt: true } } } })
  if (!bulk) return null
  const runners = await prisma.order.findMany({ where: { bulkOrderId: id }, orderBy: { lineItemIndex: 'asc' }, select: RUNNER_SELECT })
  const ready = await readiness(bulk, runners)
  return {
    ...bulk,
    paymentStatus: paymentStatus(bulk, bulk.deal),
    shopifyOrderUrl: shopifyAdminUrl(bulk.shopifyOrderId),
    runners: runners.map(shapeRunner),
    readiness: ready,
    progress: progressOf(runners),
    sheetProblems: sheetProblems(runners),
  }
}

function progressOf(runners) {
  return {
    total: runners.length,
    withAddress: runners.filter(r => addressComplete(r.shippingAddress)).length,
    researched: runners.filter(r => r.researchedAt).length,
    found: runners.filter(r => r.runnerResearch?.[0]?.researchStatus === 'found').length,
    files: runners.filter(r => r.productionFileUrl).length,
    completed: runners.filter(r => r.status === 'completed').length,
  }
}

const EDITABLE = ['partnerName', 'raceName', 'raceYear', 'quantity', 'frameType', 'productSize', 'stripeInvoiceUrl', 'productionFileUrl', 'previewImageUrl', 'raceDate', 'dueDate', 'status', 'intakeNote', 'notes', 'partnerOrderId', 'assigneeId']

let lastBulkSync = 0

function isHttpsUrl(v) {
  try { return new URL(v).protocol === 'https:' } catch { return false }
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return

  // The old Stripe invoice link shows what the partner paid: admins only, like every price.
  const noMoney = b => (b && !seesMoney(actor) ? { ...b, stripeInvoiceUrl: null } : b)
  try {
    if (req.method === 'GET') {
      if (req.query?.options) return res.status(200).json({ frames: FRAME_OPTIONS, sizes: SIZE_OPTIONS })
      if (req.query?.id) {
        // The invoice's state, read back from Shopify each time the order is opened.
        const run = await prisma.bulkOrder.findUnique({ where: { id: String(req.query.id) }, select: { dealId: true } })
        if (run?.dealId) await syncDraftStatus(run.dealId)
        const one = await loadOne(String(req.query.id))
        if (!one) return res.status(404).json({ error: 'Bulk order not found' })
        return res.status(200).json({ bulkOrder: noMoney(one) })
      }
      // Pick up bulk runs paid in Shopify since the last import, at most once a
      // minute per instance; a Shopify hiccup never blocks the list.
      if (Date.now() - lastBulkSync > 60_000) {
        lastBulkSync = Date.now()
        await syncShopifyBulkOrders().catch(err => console.warn('[API /bulk] Shopify bulk sync failed:', err.message))
      }
      // One round trip for the list and one for every runner, then group in
      // memory. A query per order is what exhausts the pool on a busy morning.
      const list = await prisma.bulkOrder.findMany({ orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], include: { deal: { select: { id: true, number: true, printKind: true, invoiceSentAt: true, paidAt: true } } } })
      const all = list.length
        ? await prisma.order.findMany({ where: { bulkOrderId: { in: list.map(b => b.id) } }, select: { bulkOrderId: true, shippingAddress: true, researchedAt: true, productionFileUrl: true, status: true, runnerResearch: { select: { researchStatus: true }, take: 1, orderBy: { createdAt: 'desc' } } } })
        : []
      const byBulk = new Map()
      for (const r of all) { if (!byBulk.has(r.bulkOrderId)) byBulk.set(r.bulkOrderId, []); byBulk.get(r.bulkOrderId).push(r) }
      return res.status(200).json({ bulkOrders: list.map(b => ({ ...noMoney(b), paymentStatus: paymentStatus(b, b.deal), shopifyOrderUrl: shopifyAdminUrl(b.shopifyOrderId), progress: progressOf(byBulk.get(b.id) || []) })) })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const action = String(body.action || '')

    if (action === 'create') {
      const partnerName = String(body.partnerName || '').trim()
      const raceName = String(body.raceName || '').trim()
      const raceYear = Number(body.raceYear)
      if (!partnerName || !raceName || !Number.isFinite(raceYear)) return res.status(400).json({ error: 'partnerName, raceName and raceYear are required' })
      const frameType = FRAME_OPTIONS.includes(body.frameType) ? body.frameType : 'Natural Premium Oak'
      const productSize = SIZE_OPTIONS.includes(body.productSize) ? body.productSize : (frameType === 'Unframed' ? '8x10' : '12x18')
      const last = await prisma.bulkOrder.findFirst({ orderBy: { createdAt: 'desc' }, select: { number: true } })
      const canonical = getCanonicalRaceName(raceName) || raceName
      const raceDate = verifiedRaceDate(canonical, raceYear)
      const bulk = await prisma.bulkOrder.create({
        data: {
          number: nextNumber(last?.number),
          partnerName, raceName: canonical, raceYear,
          quantity: Math.max(0, parseInt(body.quantity, 10) || 0),
          frameType, productSize,
          stripeInvoiceUrl: body.stripeInvoiceUrl ? String(body.stripeInvoiceUrl) : null,
          partnerOrderId: body.partnerOrderId ? String(body.partnerOrderId) : null,
          raceDate, dueDate: dueDateFor(raceDate),
          assigneeId: await defaultAssigneeFor('bulk'),
        },
      })
      return res.status(200).json({ bulkOrder: await loadOne(bulk.id) })
    }

    if (!body.id) return res.status(400).json({ error: 'id is required' })
    const bulk = await prisma.bulkOrder.findUnique({ where: { id: String(body.id) } })
    if (!bulk) return res.status(404).json({ error: 'Bulk order not found' })
    const audit = (summary, detail = {}) => recordAudit({ action: `bulk.${action}`, summary, detail: { bulkOrderId: bulk.id, ...detail }, actor })

    if (action === 'update') {
      const data = {}
      for (const k of EDITABLE) {
        if (!(k in body)) continue
        let v = body[k]
        if (k === 'raceYear' || k === 'quantity') v = v === null || v === '' ? null : Number(v)
        if (k === 'raceDate' || k === 'dueDate') v = v ? new Date(v) : null
        if (k === 'frameType' && !FRAME_OPTIONS.includes(v)) continue
        if (k === 'productSize' && !SIZE_OPTIONS.includes(v)) continue
        if (k === 'status' && !['collecting', 'fulfillment', 'submitted'].includes(v)) continue
        if (typeof v === 'string') v = v.trim() || null
        if (k === 'productionFileUrl' && v && !isAllowedFileUrl(v)) return res.status(400).json({ error: 'Use a Google Drive link or upload the file here.' })
        if ((k === 'previewImageUrl' || k === 'stripeInvoiceUrl') && v && !isHttpsUrl(v)) return res.status(400).json({ error: 'Links must start with https://' })
        if (k === 'partnerName' && !v) continue
        if (k === 'raceName' && v) v = getCanonicalRaceName(v) || v
        if (k === 'assigneeId' && v) {
          const u = await prisma.user.findUnique({ where: { id: v }, select: { isActive: true } })
          if (!u?.isActive) return res.status(400).json({ error: 'That teammate is not active' })
        }
        data[k] = v
      }
      // A race date set by hand resets the due date unless one was also given.
      if ('raceDate' in data && !('dueDate' in data)) data.dueDate = dueDateFor(data.raceDate)
      const updated = await prisma.bulkOrder.update({ where: { id: bulk.id }, data })
      // Runners follow the order's race, year, product and due date.
      const follow = {}
      if (data.raceName) follow.raceName = data.raceName
      if (data.raceYear) follow.raceYear = data.raceYear
      if (data.frameType) follow.frameType = data.frameType
      if (data.productSize) follow.productSize = data.productSize
      if ('dueDate' in data) follow.dueDate = data.dueDate
      if (Object.keys(follow).length) await prisma.order.updateMany({ where: { bulkOrderId: bulk.id }, data: follow })
      await audit(`Edited bulk order ${bulk.number} (${Object.keys(data).join(', ') || 'nothing'})`, { fields: Object.keys(data) })
      return res.status(200).json({ bulkOrder: await loadOne(updated.id) })
    }

    // Invoice not sent / sent / paid. Shopify moves it on its own (syncDraftStatus, the import); this is the hand override.
    if (action === 'payment') {
      if (!(await requireAdminRole(req, res, actor))) return
      if (!bulk.dealId) bulk.dealId = (await attachBilling(bulk)).dealId
      await setPaymentStatus(bulk.dealId, String(body.status || ''))
      await audit(`Set bulk order ${bulk.number} payment to ${body.status}`)
      return res.status(200).json({ bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'paid') {
      // Paid is what lets research and fulfillment start, so it is an admin's call.
      if (!(await requireAdminRole(req, res, actor))) return
      await prisma.bulkOrder.update({ where: { id: bulk.id }, data: { paidAt: body.paid ? new Date() : null } })
      await audit(`Marked bulk order ${bulk.number} ${body.paid ? 'paid' : 'unpaid'}`)
      return res.status(200).json({ bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'intake') {
      const { rows, problems } = parseRunnerList(body.text)
      const created = await addRunners(bulk, rows)
      if (created.length) await audit(`Added ${created.length} runner${created.length === 1 ? '' : 's'} to bulk order ${bulk.number}`)
      if (created.length && bulk.status === 'collecting' && rows.every(r => addressComplete(r.address))) {
        // Leave status alone; "collecting" ends when the person says so.
      }
      return res.status(200).json({ added: created.length, skipped: rows.length - created.length, problems, bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'update-runner') {
      const runner = await prisma.order.findFirst({ where: { bulkOrderId: bulk.id, orderNumber: String(body.orderNumber || '') } })
      if (!runner) return res.status(404).json({ error: 'Runner not found' })
      const data = {}
      if (body.runnerName && String(body.runnerName).trim()) data.runnerName = String(body.runnerName).trim()
      if (body.address && typeof body.address === 'object') {
        const a = body.address
        data.shippingAddress = { line1: String(a.line1 || '').trim(), line2: String(a.line2 || '').trim(), city: String(a.city || '').trim(), state: String(a.state || '').trim(), zip: String(a.zip || '').trim(), country: String(a.country || 'United States').trim() }
      }
      if ('fileUrl' in body) {
        if (body.fileUrl && !isAllowedFileUrl(String(body.fileUrl))) return res.status(400).json({ error: 'Use a Google Drive link or upload the file here.' })
        data.productionFileUrl = body.fileUrl ? String(body.fileUrl) : null
      }
      await prisma.order.update({ where: { id: runner.id }, data })
      await audit(`Edited runner ${runner.orderNumber} on bulk order ${bulk.number}`, { orderNumber: runner.orderNumber, fields: Object.keys(data) })
      return res.status(200).json({ bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'remove-runner') {
      const runner = await prisma.order.findFirst({ where: { bulkOrderId: bulk.id, orderNumber: String(body.orderNumber || '') } })
      if (!runner) return res.status(404).json({ error: 'Runner not found' })
      await prisma.$transaction([
        prisma.runnerResearch.deleteMany({ where: { orderId: runner.id } }),
        prisma.order.delete({ where: { id: runner.id } }),
      ])
      await audit(`Removed runner ${runner.runnerName || runner.orderNumber} from bulk order ${bulk.number}`, { orderNumber: runner.orderNumber, runnerName: runner.runnerName })
      return res.status(200).json({ bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'research') {
      if (!bulk.paidAt) return res.status(400).json({ error: 'Mark the invoice paid before researching. Nothing ships until it is.' })
      // Small batches: each runner is a live scrape, and the request has to
      // finish well inside the function's time limit.
      const out = await researchPending(bulk, { limit: Math.min(5, Math.max(1, parseInt(body.limit, 10) || 3)) })
      if (bulk.status === 'collecting') await prisma.bulkOrder.update({ where: { id: bulk.id }, data: { status: 'fulfillment' } })
      return res.status(200).json({ ...out, bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'submitted') {
      await prisma.bulkOrder.update({ where: { id: bulk.id }, data: { status: 'submitted', submittedAt: new Date() } })
      await audit(`Marked bulk order ${bulk.number} submitted`)
      return res.status(200).json({ bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'new-intake-link') {
      // Kills the link the partner already has, so it is an admin's call.
      if (!(await requireAdminRole(req, res, actor))) return
      const { randomUUID } = await import('crypto')
      await prisma.bulkOrder.update({ where: { id: bulk.id }, data: { intakeToken: randomUUID() } })
      await audit(`Replaced the partner intake link for bulk order ${bulk.number}`)
      return res.status(200).json({ bulkOrder: await loadOne(bulk.id) })
    }

    if (action === 'delete') {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      const runners = await prisma.order.findMany({ where: { bulkOrderId: bulk.id }, select: { id: true } })
      await prisma.runnerResearch.deleteMany({ where: { orderId: { in: runners.map(r => r.id) } } })
      await prisma.order.deleteMany({ where: { bulkOrderId: bulk.id } })
      await prisma.bulkOrder.delete({ where: { id: bulk.id } })
      await audit(`Deleted bulk order ${bulk.number} (${bulk.partnerName}, ${runners.length} runners)`, { partnerName: bulk.partnerName, runners: runners.length })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /bulk]', error)
    return sendPublicError(res, error)
  }
}
