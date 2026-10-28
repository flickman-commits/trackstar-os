/**
 * POST /api/orders/photo - admin only. Attach a customer's photo after
 * purchase (they emailed it), to one print or every print on the order.
 *
 *   { action: 'upload-url', filename }        signed upload slot in the
 *                                             personalization-photos bucket
 *   { action: 'attach', orderIds, path }      set the photo on those prints
 *   { action: 'remove', orderId }             take a hand-attached photo off
 *   { action: 'free', orderId, free? }        we are not charging for this photo (default
 *                                             true): it counts as paid and the print renders
 *                                             again with it on; free: false undoes it
 *   { action: 'replace', orderId, path }      swap the photo on a print that has one
 *                                             (the customer emailed a different one);
 *                                             never bills, keeps how it was paid for
 *
 * With charge: true (Shopify orders) it also edits the Shopify order to add
 * one Photo Add-On per print, and Shopify emails the customer a link to pay
 * the difference. If that edit fails (say the app lacks write_order_edits),
 * the photo is still attached and the answer says so, so it can be added by
 * hand in Shopify. Either way the photo is "not paid" until Shopify reads
 * paid, and the print cannot be completed before then (photoPayment.js).
 */
import crypto from 'node:crypto'
import { setCors, requireAdmin } from '../_lib/auth.js'
import { requireAdminRole, requireCapability, recordAudit } from '../_lib/users.js'
import prisma from '../_lib/prisma.js'
import { addVariantToOrder, PHOTO_ADDON_VARIANT_ID } from '../../server/services/shopifyOrderEdit.js'
import { storage } from '../../server/lib/storage.js'
import { checkOrder, createJob } from '../../server/domain/render/jobs.js'

const BUCKET = 'personalization-photos'
const EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'])

const DESIGN_ROLES = ['head_designer', 'designer']

/** A designer adding or replacing the photo on custom orders only: the actor, else null. */
async function customPhotoByDesigner(body, actor) {
  if (!DESIGN_ROLES.includes(actor?.role) || !['upload-url', 'attach', 'replace'].includes(body.action)) return null
  const ids = (body.action === 'attach' ? (Array.isArray(body.orderIds) ? body.orderIds : []) : [body.orderId]).map(String).filter(Boolean).slice(0, 20)
  if (!ids.length) return null
  const rows = await prisma.order.findMany({ where: { id: { in: ids } }, select: { trackstarOrderType: true } })
  return rows.length === ids.length && rows.every(r => r.trackstarOrderType === 'custom') ? actor : null
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  // Re-cropping the photo already on a print (upload, then replace) is design
  // work, open to anyone who renders designs. Adding a photo bills the
  // customer, so attach stays with admins. The exception: a photo a customer
  // emails for a custom order is free, so designers add and replace those.
  const admin = await customPhotoByDesigner(body, actor)
    || (['upload-url', 'replace', 'remove'].includes(body.action)
      ? await requireCapability(req, res, 'orders.render')
      : await requireAdminRole(req, res, actor))
  if (!admin) return

  try {

    if (body.action === 'upload-url') {
      let ext = String(body.filename || 'photo.jpg').split('.').pop().toLowerCase()
      if (!EXTS.has(ext)) ext = 'jpg'
      if (ext === 'jpeg') ext = 'jpg'
      // Same shape as checkout uploads, so the viewer and retention sweep treat it alike.
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`
      const supabase = storage()
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) return res.status(500).json({ error: 'Could not start the upload. Try again.' })
      return res.status(200).json({ path, uploadUrl: data.signedUrl })
    }

    if (body.action === 'replace') {
      const path = String(body.path || '')
      if (!/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.[a-z]+$/.test(path)) return res.status(400).json({ error: 'Not an uploaded photo path' })
      const o = await prisma.order.findUnique({ where: { id: String(body.orderId || '') }, select: { id: true, orderNumber: true, photoPath: true } })
      if (!o) return res.status(404).json({ error: 'Order not found' })
      if (!o.photoPath) return res.status(400).json({ error: 'This print has no photo to replace. Add one instead.' })
      // The new photo has to be placed again, and any design made with the old one is out of date.
      await prisma.order.update({ where: { id: o.id }, data: { photoPath: path, photoPlacedAt: null } })
      await recordAudit({
        action: 'order.photo-replaced',
        summary: `Replaced the customer photo on ${o.orderNumber}`,
        detail: { orderId: o.id, from: o.photoPath, to: path },
        actor: admin,
      })
      return res.status(200).json({ ok: true, photoPath: path })
    }

    if (body.action === 'attach') {
      const path = String(body.path || '')
      if (!/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.[a-z]+$/.test(path)) return res.status(400).json({ error: 'Not an uploaded photo path' })
      const ids = (Array.isArray(body.orderIds) ? body.orderIds : []).map(String).slice(0, 20)
      if (!ids.length) return res.status(400).json({ error: 'Pick at least one print' })
      const rows = await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNumber: true, parentOrderNumber: true, source: true, trackstarOrderType: true } })
      if (rows.length !== ids.length || new Set(rows.map(r => r.parentOrderNumber)).size !== 1) {
        return res.status(400).json({ error: 'Those prints are not all on one order' })
      }
      await prisma.order.updateMany({ where: { id: { in: ids } }, data: { photoPath: path, photoAddedManually: true, photoPlacedAt: null } })

      // Bill for it: one Photo Add-On per print, on the same Shopify order.
      let charged = false, chargeError = null
      // A photo emailed after a custom order is added free (one bought at checkout was charged then).
      if (body.charge && rows[0].source === 'shopify' && !rows.some(r => r.trackstarOrderType === 'custom')) {
        try {
          await addVariantToOrder(rows[0].parentOrderNumber, PHOTO_ADDON_VARIANT_ID, ids.length,
            `Photo Add-On x${ids.length} added from TrackstarOS by ${admin.firstName || 'an admin'}`)
          charged = true
        } catch (error) {
          console.error('[API /orders/photo] Shopify order edit failed:', error.message)
          chargeError = /access|scope|permission|denied/i.test(error.message)
            ? 'Shopify did not let the tool edit the order (the app needs the write_order_edits permission). Add the Photo Add-On to the order in Shopify by hand.'
            : 'The photo is attached, but adding the Photo Add-On in Shopify failed. Add it to the order in Shopify by hand.'
        }
      }
      await recordAudit({
        action: 'order.photo-added',
        summary: `Added a customer photo to ${rows.map(r => r.orderNumber).join(', ')}`,
        detail: { orderIds: ids, path, charged, chargeError },
        actor: admin,
      })
      return res.status(200).json({ ok: true, photoPath: path, charged, chargeError })
    }

    if (body.action === 'free') {
      // A photo we add as a courtesy: no Photo Add-On to wait for. It renders
      // again with the photo (a render waiting for review shows it without).
      const o = await prisma.order.findUnique({ where: { id: String(body.orderId || '') }, select: { id: true, orderNumber: true, photoPath: true, photoFree: true } })
      if (!o) return res.status(404).json({ error: 'Order not found' })
      if (!o.photoPath) return res.status(400).json({ error: 'This print has no photo' })
      const free = body.free !== false
      await prisma.order.update({ where: { id: o.id }, data: { photoFree: free } })
      const who = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || 'Someone'
      await prisma.orderComment.create({ data: { orderId: o.id, text: free ? 'Photo marked free: no Photo Add-On charge for this print.' : 'Photo no longer free: it needs a paid Photo Add-On.', authorId: admin.id || null, authorName: who } })
      await recordAudit({ action: 'order.photo-free', summary: `${free ? 'Marked the photo free on' : 'Took the free photo off'} ${o.orderNumber}`, detail: { orderId: o.id, free }, actor: admin })
      let rendering = null
      if (free) {
        await prisma.renderJob.updateMany({ where: { orderId: o.id, status: 'done', review: 'pending' }, data: { review: 'closed', reviewNote: 'Photo marked free; a new design with the photo replaces it', reviewedAt: new Date() } })
        const { ok, reasons } = await checkOrder(o.id)
        rendering = ok ? (await createJob({ orderId: o.id, requestedBy: 'admin', requestedById: admin.id || null })).version : null
        if (!ok) return res.status(200).json({ ok: true, free, rendering: null, reasons })
      }
      return res.status(200).json({ ok: true, free, rendering })
    }

    if (body.action === 'remove') {
      // Any photo: one added here, or the one the customer uploaded at checkout
      // (a customer sometimes asks for the print without it). The design renders
      // again without a photo window. A paid Photo Add-On stays on the Shopify
      // order; refunding it is done there.
      const o = await prisma.order.findUnique({ where: { id: String(body.orderId || '') }, select: { id: true, orderNumber: true, photoPath: true, photoAddedManually: true } })
      if (!o) return res.status(404).json({ error: 'Order not found' })
      if (!o.photoPath) return res.status(400).json({ error: 'This print has no photo to remove' })
      await prisma.order.update({ where: { id: o.id }, data: { photoPath: null, photoAddedManually: false, photoPlacedAt: null } })
      await recordAudit({ action: 'order.photo-removed', summary: `Removed the customer photo from ${o.orderNumber}${o.photoAddedManually ? '' : ' (uploaded at checkout)'}`, detail: { orderId: o.id, removed: o.photoPath, addedHere: o.photoAddedManually }, actor: admin })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /orders/photo]', error)
    return res.status(500).json({ error: 'Photo update failed' })
  }
}
