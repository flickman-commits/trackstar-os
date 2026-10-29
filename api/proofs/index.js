/**
 * /api/proofs — Consolidated proof & approval endpoint
 *
 * Proof CRUD (merchant):
 *   GET    ?orderId=xxx                     — List proofs for an order
 *   POST   { orderId, imageData, imageName } — Upload a new proof
 *   DELETE { proofId }                      — Delete a proof
 *
 * Approval token (merchant):
 *   GET    ?action=token&orderId=xxx        — Get existing approval token + URL
 *   POST   { action: "generate-token", orderId } — Generate or regenerate token
 *
 * Customer approval (public, token-based):
 *   GET    ?action=approve&token=xxx        — Get order info + proofs for customer portal
 *   POST   { action: "approve", token, proofId, approval, feedback? } — Customer approves/revises
 */

import { saveApprovedMockup } from '../../server/services/customGallery.js'
import prisma from '../_lib/prisma.js'
import { ensureApprovalToken, touchApprovalToken } from '../_lib/approvalToken.js'
import { setCors, requireAdmin } from '../_lib/auth.js'
import { alertError } from '../_lib/alerts.js'
import { recordAudit, requireAdminRole } from '../_lib/users.js'
import { checkRateLimitDurable } from '../../server/lib/publicRateLimit.js'
import { postSlack, slackText } from '../../server/lib/slack.js'
import crypto from 'crypto'
import formidable from 'formidable'
import fs from 'fs'
import { sendPublicError } from '../../server/lib/publicError.js'
import { storage } from '../../server/lib/storage.js'
import { sendEmail } from '../../server/lib/email.js'
// sharp loaded dynamically in processImage() — top-level import crashes Vercel cold start

// Disable Vercel's default body parser for multipart support
export const config = { api: { bodyParser: false } }



function parseBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || ''
    if (contentType.includes('multipart/form-data')) {
      // If Express already consumed the body, fall back to req.body
      if (req._body || req.readable === false) {
        console.log('[parseBody] Express already consumed body, using req.body')
        resolve({ fields: req.body || {}, file: null })
        return
      }
      const form = formidable({ maxFileSize: 20 * 1024 * 1024 })
      form.parse(req, (err, fields, files) => {
        if (err) {
          console.error('[parseBody] formidable error:', err.message)
          return reject(err)
        }
        // formidable v3 returns arrays for fields
        const flat = {}
        for (const [k, v] of Object.entries(fields)) {
          flat[k] = Array.isArray(v) ? v[0] : v
        }
        const file = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : null
        console.log('[parseBody] multipart parsed, fields:', Object.keys(flat), 'file:', !!file)
        resolve({ fields: flat, file })
      })
    } else {
      // JSON body — check if already parsed (by Express or pre-auth peek)
      if (req._preBody) {
        resolve({ fields: req._preBody, file: null })
        return
      }
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        resolve({ fields: req.body, file: null })
        return
      }
      let data = ''
      req.on('data', chunk => { data += chunk })
      req.on('end', () => {
        try {
          resolve({ fields: data ? JSON.parse(data) : {}, file: null })
        } catch {
          resolve({ fields: {}, file: null })
        }
      })
      req.on('error', reject)
    }
  })
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'tif'])

/**
 * Compress an image and generate a thumbnail.
 * Returns { compressed, thumbnail } buffers, or null values for non-image files (PDFs, SVGs).
 */
async function processImage(buffer, ext) {
  if (!IMAGE_EXTENSIONS.has(ext)) return { compressed: null, thumbnail: null }

  try {
    const sharp = (await import('sharp')).default
    // Compress: resize to max 1500px wide, JPEG quality 85
    const compressed = await sharp(buffer)
      .resize(1500, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    // Thumbnail: 300px wide for grid views
    const thumbnail = await sharp(buffer)
      .resize(300, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    console.log(`[proofs] Compressed: ${(buffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB, Thumb: ${(thumbnail.length / 1024).toFixed(0)}KB`)
    return { compressed, thumbnail }
  } catch (err) {
    console.warn(`[proofs] Image processing failed, using original:`, err.message)
    return { compressed: null, thumbnail: null }
  }
}

/**
 * What a proof may be. SVG is out: the bucket is public, and an SVG served
 * from it runs script.
 */
const PROOF_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'])

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The portal token as one string; a repeated ?token= arrives as an array. */
function publicToken(req, body) {
  const raw = req.query?.token ?? body?.token
  const token = Array.isArray(raw) ? raw[0] : raw
  return typeof token === 'string' && token.length <= 80 ? token : ''
}

/**
 * Per link, per hour. Generous for a customer going back and forth on a
 * design, and a ceiling on what a leaked link can do to Slack and the thread.
 */
const PORTAL_LIMITS = { view: 300, answer: 30, message: 30 }
async function withinPortalLimit(token, kind, res) {
  const limit = await checkRateLimitDurable(token, { bucket: `proof_${kind}`, max: PORTAL_LIMITS[kind] })
  if (limit.allowed) return true
  res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
  res.status(429).json({ error: 'Too many requests from this link. Try again in a little while.' })
  return false
}

function buildApprovalUrl(req, token) {
  // Use VERCEL_PROJECT_PRODUCTION_URL in prod, or origin header, or fallback
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/approve/${token}`
  }
  const origin = req.headers?.origin || (() => {
    const host = req.headers?.host || 'trackstar-fulfillment.vercel.app'
    const protocol = host.includes('localhost') ? 'http' : 'https'
    // In dev, API runs on :3001 but frontend is on :3000
    const frontendHost = host.replace(':3001', ':3000')
    return `${protocol}://${frontendHost}`
  })()
  return `${origin}/approve/${token}`
}

export default async function handler(req, res) {
  // Determine if this is a public (customer) request BEFORE parsing the full body.
  // Customer approval uses query param (GET) or JSON body (POST) — never multipart.
  // Multipart (file uploads) are always merchant actions requiring admin auth.
  const contentType = req.headers['content-type'] || ''
  const isMultipart = contentType.includes('multipart/form-data')
  const queryAction = req.query.action || null

  // For non-multipart POST, peek at JSON body to check action
  let preAction = queryAction
  if (!preAction && req.method === 'POST' && !isMultipart) {
    try {
      // Express dev server may have already parsed the body
      if (req.body && typeof req.body === 'object' && req.body.action) {
        preAction = req.body.action
      } else {
        // Vercel: bodyParser disabled, read raw body to peek at action
        const raw = await new Promise((resolve) => {
          let data = ''
          req.on('data', chunk => { data += chunk })
          req.on('end', () => resolve(data))
          req.on('error', () => resolve(''))
        })
        if (raw) {
          try {
            const parsed = JSON.parse(raw)
            preAction = parsed.action || null
            // Stash parsed body so parseBody() doesn't re-read the consumed stream
            req._preBody = parsed
          } catch {}
        }
      }
    } catch {}
  }

  // Public, token-gated customer actions: reviewing/approving proofs and
  // replying to a designer's question. Both authenticate via the order's
  // approval token (checked in their handlers), not the admin secret.
  const isPublicAction = preAction === 'approve' || preAction === 'customer-message'

  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS', allowPublic: isPublicAction })) return

  // Public routes use token-based auth (checked below), merchant routes need admin secret
  let actor = null
  if (!isPublicAction) {
    actor = (await requireAdmin(req, res))
    if (!actor) return
  }

  // Now parse the full body (safe — auth is verified for merchant routes)
  let body = {}
  let uploadedFile = null
  if (req.method !== 'GET') {
    try {
      const parsed = await parseBody(req)
      body = parsed.fields
      uploadedFile = parsed.file
    } catch (parseErr) {
      console.error('[proofs] Body parse error:', parseErr.message)
      return res.status(400).json({ error: 'Failed to parse request body' })
    }
  }

  const resolvedAction = queryAction || body.action || null

  try {
    // ─── Customer Approval (public, token-based) ───
    if (resolvedAction === 'approve') {
      const token = publicToken(req, body)
      if (!token) return res.status(400).json({ error: 'Token is required' })
      if (!(await withinPortalLimit(token, req.method === 'GET' ? 'view' : 'answer', res))) return

      const approvalToken = await prisma.approvalToken.findUnique({
        where: { token },
        include: {
          order: {
            select: {
              id: true, orderNumber: true, parentOrderNumber: true,
              customerName: true, customerEmail: true, raceName: true,
              designStatus: true, trackstarOrderType: true, shopifyOrderData: true,
              designerNote: true, runnerName: true, raceYear: true
            }
          }
        }
      })

      if (!approvalToken) {
        return res.status(404).json({ error: 'Invalid approval link. Please contact us for assistance.' })
      }
      if (new Date() > approvalToken.expiresAt) {
        return res.status(410).json({
          error: 'This approval link has expired. Reply to the email it came in and we will send you a new one.',
        })
      }

      // They are here and using it, so the order is live. Keep the link alive
      // for another full window rather than counting down from the send.
      touchApprovalToken(approvalToken.orderId)

      if (req.method === 'GET') {
        const proofs = await prisma.proof.findMany({
          where: { orderId: approvalToken.orderId },
          orderBy: { version: 'asc' }
        })
        // Designer ↔ customer Q&A thread, oldest first.
        const messages = await prisma.orderMessage.findMany({
          where: { orderId: approvalToken.orderId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, sender: true, body: true, createdAt: true },
        })
        const shopifyData = approvalToken.order.shopifyOrderData
        const displayOrderNumber = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
          ? String(shopifyData.name).replace('#', '')
          : approvalToken.order.parentOrderNumber

        return res.status(200).json({
          order: { ...approvalToken.order, displayOrderNumber, shopifyOrderData: undefined },
          proofs,
          messages
        })
      }

      if (req.method === 'POST') {
        const { proofId, approval } = body
        const feedback = body.feedback == null ? null : String(body.feedback).trim().slice(0, 2000) || null

        if (!proofId) return res.status(400).json({ error: 'proofId is required' })
        // Once a design is in production an answer from the portal cannot
        // move it back to revision; that conversation goes through support.
        if (['sent_to_production'].includes(approvalToken.order.designStatus)) {
          return res.status(409).json({ error: 'This design is already in production. Reply to your email and we will help.' })
        }
        if (!approval || !['approve', 'request_revision'].includes(approval)) {
          return res.status(400).json({ error: 'approval must be "approve" or "request_revision"' })
        }
        // Customs ask "Can we feature this design on our site?" with no
        // default (Settings > Site Gallery reads the answer).
        const askFeature = approval === 'approve' && approvalToken.order.trackstarOrderType === 'custom'
        if (askFeature && typeof body.featureOk !== 'boolean') {
          return res.status(400).json({ error: 'Please answer whether we can feature your design on our site.' })
        }

        const proof = await prisma.proof.findUnique({ where: { id: String(proofId) } })
        if (!proof || proof.orderId !== approvalToken.orderId) {
          return res.status(404).json({ error: 'Proof not found' })
        }

        const newStatus = approval === 'approve' ? 'approved' : 'revision_requested'

        // Answering one proof only settles the others it competes with.
        //
        // This used to reject every other pending proof on the order, which is
        // right when the order is one design with several options and wrong the
        // moment it is not. A partner sent two half-marathon designs and two
        // marathon designs is meant to pick one of each; under the old rule,
        // approving a half rejected both marathons, and - worse - asking for a
        // tweak on a half did the same, silently.
        //
        // Scoping to groupLabel fixes both. Orders with no labels have one
        // unnamed group, so this is still "reject all others" for every custom
        // and standard order, unchanged.
        const sameGroup = {
          orderId: approvalToken.orderId,
          status: 'pending',
          id: { not: proofId },
          groupLabel: proof.groupLabel ?? null,
        }

        if (approval === 'request_revision') {
          await prisma.proof.updateMany({ where: sameGroup, data: { status: 'rejected' } })
          await prisma.proof.update({
            where: { id: proofId },
            data: { status: 'revision_requested', customerFeedback: feedback || null }
          })
        }

        if (approval === 'approve') {
          await prisma.proof.updateMany({ where: sameGroup, data: { status: 'rejected' } })
        }

        const updatedProof = approval === 'approve'
          ? await prisma.proof.update({
              where: { id: proofId },
              data: { status: newStatus, customerFeedback: feedback || null }
            })
          : await prisma.proof.findUnique({ where: { id: proofId } })

        // The order moves on only once every group has been answered. With a
        // single unnamed group that is the first answer, as before; with four
        // proofs across two products the partner can approve one and come back
        // for the other without the order claiming to be finished.
        // Only the round being answered counts. An earlier round's revision
        // request was already acted on (that is why this round exists), and
        // counting it left every order approved in round two or later stuck at
        // "In Revision" until someone moved it by hand.
        const remaining = await prisma.proof.findMany({
          where: { orderId: approvalToken.orderId, batch: proof.batch },
          select: { status: true, groupLabel: true },
        })
        const groups = new Map()
        for (const p of remaining) {
          const key = p.groupLabel ?? ''
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(p.status)
        }
        const settled = [...groups.values()].every(
          statuses => statuses.some(st => st === 'approved' || st === 'revision_requested')
        )
        // A revision anywhere outranks an approval: the order is in revision
        // until the redraw comes back, whatever else was approved.
        const anyRevision = remaining.some(p => p.status === 'revision_requested')
        const newDesignStatus = !settled
          ? 'awaiting_review'
          : anyRevision ? 'in_revision' : 'approved_by_customer'

        await prisma.order.update({
          where: { id: approvalToken.orderId },
          data: { designStatus: newDesignStatus, ...(askFeature ? { featureConsent: body.featureOk } : {}) }
        })

        console.log(`[approve] Customer ${approval} proof v${proof.version} for order ${approvalToken.order.orderNumber}`)

        // Custom designs the customer approved go to the shared gallery folder.
        // Awaited so the serverless function does not end mid-upload; it never
        // throws, so the customer's approval is not affected by Drive.
        if (approval === 'approve' && approvalToken.order.trackstarOrderType === 'custom') {
          await saveApprovedMockup({ order: approvalToken.order, proof })
        }

        // Send Slack notification (fire and forget)
        if (process.env.SLACK_PROOF_WEBHOOK_URL) {
          const shopifyData = approvalToken.order.shopifyOrderData
          const displayNum = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
            ? String(shopifyData.name) : `#${approvalToken.order.parentOrderNumber}`
          const customerName = approvalToken.order.customerName || 'Customer'
          const emoji = approval === 'approve' ? '✅' : '🔄'
          const action_text = approval === 'approve'
            ? `approved Option ${proof.version}`
            : `requested revisions on Option ${proof.version}`
          const suffix = approval === 'approve' ? ' - the file is ready to upload to orders.' : ''
          await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL,
            `${emoji} <@U04KBDJH5C3> *${slackText(customerName)}* ${action_text} for order *${slackText(displayNum)}*${suffix}${feedback ? `\n> _"${slackText(feedback)}"_` : ''}`)
        }

        return res.status(200).json({ success: true, proof: updatedProof })
      }

      return res.status(405).json({ error: 'Method not allowed' })
    }

    // ─── Customer Reply to a Designer Question (public, token-based) ───
    if (resolvedAction === 'customer-message') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

      const token = publicToken(req, body)
      if (!token) return res.status(400).json({ error: 'Token is required' })
      if (!(await withinPortalLimit(token, 'message', res))) return

      const text = (body.body || '').toString().trim()
      if (!text) return res.status(400).json({ error: 'Message is required' })
      if (text.length > 2000) return res.status(400).json({ error: 'Message is too long (max 2000 chars)' })

      const approvalToken = await prisma.approvalToken.findUnique({
        where: { token },
        include: { order: { select: { id: true, customerName: true, parentOrderNumber: true, shopifyOrderData: true } } }
      })
      if (!approvalToken) return res.status(404).json({ error: 'Invalid link. Please contact us for assistance.' })
      if (new Date() > approvalToken.expiresAt) {
        return res.status(410).json({
          error: 'This link has expired. Reply to the email it came in and we will send you a new one.',
        })
      }
      touchApprovalToken(approvalToken.orderId)

      const message = await prisma.orderMessage.create({
        data: { orderId: approvalToken.orderId, sender: 'customer', body: text, readByDesigner: false }
      })

      console.log(`[customer-message] Customer replied on order ${approvalToken.order.parentOrderNumber}`)

      // Ping Dan so he sees the reply without checking the portal.
      if (process.env.SLACK_PROOF_WEBHOOK_URL) {
        const shopifyData = approvalToken.order.shopifyOrderData
        const displayNum = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
          ? String(shopifyData.name) : `#${approvalToken.order.parentOrderNumber}`
        const customerName = approvalToken.order.customerName || 'Customer'
        await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL,
          `💬 <@U04KBDJH5C3> *${slackText(customerName)}* replied to your question on order *${slackText(displayNum)}*:\n> _"${slackText(text)}"_`)
      }

      return res.status(200).json({ success: true, message })
    }

    // ─── Approval Token Management (merchant) ───
    if (resolvedAction === 'token' || resolvedAction === 'generate-token') {
      if (req.method === 'GET') {
        const { orderId } = req.query
        if (!orderId) return res.status(400).json({ error: 'orderId is required' })

        const approvalToken = await prisma.approvalToken.findUnique({ where: { orderId } })
        if (!approvalToken) return res.status(404).json({ error: 'No approval token found for this order' })

        return res.status(200).json({
          approvalToken,
          approvalUrl: buildApprovalUrl(req, approvalToken.token)
        })
      }

      if (req.method === 'POST') {
        const { orderId } = body
        if (!orderId) return res.status(400).json({ error: 'orderId is required' })

        const order = await prisma.order.findUnique({ where: { id: orderId } })
        if (!order) return res.status(404).json({ error: 'Order not found' })

        // Reuse, do not rotate. Rotating here is what left partners holding
        // links that had not just lapsed but had become permanently wrong.
        const approvalToken = await ensureApprovalToken(orderId)

        console.log(`[approval-token] Issued token for order ${order.orderNumber}`)
        await recordAudit({ action: 'proof.link', summary: `Got the approval link for ${order.orderNumber}`, detail: { orderId }, actor })
        return res.status(200).json({
          approvalToken,
          approvalUrl: buildApprovalUrl(req, approvalToken.token)
        })
      }

      return res.status(405).json({ error: 'Method not allowed' })
    }

    // ─── Send Proofs to Customer via Email ───
    if (resolvedAction === 'send-to-customer') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

      const { orderId, note } = body
      if (!orderId) return res.status(400).json({ error: 'orderId is required' })

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { proofs: { orderBy: { version: 'asc' } } }
      })
      if (!order) return res.status(404).json({ error: 'Order not found' })
      if (!order.customerEmail) return res.status(400).json({ error: 'Order has no customer email' })

      // Same token as every previous send for this order, with the clock
      // pushed out, so an earlier email keeps working alongside this one.
      const approvalToken = await ensureApprovalToken(orderId)
      const approvalUrl = buildApprovalUrl(req, approvalToken.token)

      // Detect if this is a revision re-send
      const hasRevisions = order.proofs.some(p => p.status === 'revision_requested')

      // When re-sending after revision, archive any old pending proofs that weren't part of the new batch
      // (New proofs uploaded after revision will be the only pending ones)
      // This is handled by the revision flow marking all pending as revision_requested

      const proofCount = order.proofs.filter(p => p.status === 'pending').length

      const shopifyData = order.shopifyOrderData
      const displayNum = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
        ? String(shopifyData.name) : `#${order.parentOrderNumber}`
      const customerName = order.customerName || 'there'

      // Build email — on-brand: dark bg, purple CTA, square buttons, Helvetica Neue, restrained voice
      const subject = hasRevisions
        ? `Your updated design is ready`
        : `Your Trackstar Order ${displayNum} (Action Required)`

      const headline = hasRevisions
        ? `Updated based on your feedback.`
        : `Your design${proofCount > 1 ? ' options are' : ' is'} ready.`

      const bodyText = hasRevisions
        ? `We've revised your design. Take a look and let us know what you think.`
        : `We've put together ${proofCount > 1 ? `${proofCount} options` : 'a custom design'} for your order ${displayNum}. Review below and pick your favorite.`

      const emailHtml = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F7F5F0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F5F0;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <!-- Logo -->
        <tr><td style="padding:0 0 32px;text-align:center;">
          <img src="https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png?height=28&v=1757377797" alt="Trackstar" height="28" style="height:28px;" />
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;background-color:#FFFFFF;border:1px solid #E8E6E1;">
          <h1 style="margin:0 0 16px;font-size:22px;color:#1A1A1A;font-weight:700;letter-spacing:0.02em;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${headline}</h1>
          <p style="margin:0 0 8px;font-size:15px;color:#666666;line-height:1.6;">Hi ${escapeHtml(customerName)},</p>
          <p style="margin:0 0 ${note ? '16px' : '24px'};font-size:15px;color:#666666;line-height:1.6;">${bodyText}</p>${note ? `
          <p style="margin:0 0 24px;font-size:14px;color:#1A1A1A;line-height:1.6;padding:12px 16px;background-color:#F7F5F0;border-left:3px solid #4600D6;font-style:italic;">${note.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>` : ''}

          <!-- How this works - head off the "I'll just reply to this email" instinct -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;"><tr><td style="background-color:#F7F5F0;padding:16px 20px;border-left:3px solid #4600D6;">
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#4600D6;letter-spacing:0.1em;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">HOW THIS WORKS</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1A1A1A;line-height:1.5;"><strong style="color:#4600D6;">1.</strong> &nbsp;Click below to see your design${proofCount > 1 ? ' options' : ''}.</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1A1A1A;line-height:1.5;"><strong style="color:#4600D6;">2.</strong> &nbsp;Either approve your favorite, or request changes - <strong>both happen right in the portal</strong>.</p>
            <p style="margin:0;font-size:14px;color:#1A1A1A;line-height:1.5;"><strong style="color:#4600D6;">3.</strong> &nbsp;We'll work on your revisions and send you updated mockups.</p>
          </td></tr></table>

          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${approvalUrl}" style="display:inline-block;background-color:#4600D6;color:#FFFFFF;font-size:14px;font-weight:700;padding:14px 40px;border-radius:0px;text-decoration:none;letter-spacing:0.5px;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
              REVIEW YOUR DESIGN${proofCount > 1 ? 'S' : ''}
            </a>
          </td></tr></table>

          <!-- Anti-reply line. Customers were emailing edits back instead of using the portal. -->
          <p style="margin:24px 0 0;font-size:13px;color:#666666;text-align:center;line-height:1.55;padding:0 12px;">
            ✋ &nbsp;Please don't reply to this email with edits - we can only process changes through the <strong style="color:#1A1A1A;">Request Changes</strong> button on the portal.
          </p>
          <p style="margin:16px 0 0;font-size:11px;color:#999999;text-align:center;">This link expires in 30 days.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 0 0;text-align:center;">
          <p style="margin:0;font-size:11px;color:#999999;letter-spacing:0.05em;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Trackstar - Celebrating athletic achievement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

      // Send email via Resend
      if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ error: 'Email service not configured (RESEND_API_KEY missing)' })
      }
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'Trackstar <proofs@orders.trackstar.art>'

      try {
        await sendEmail({
          from: fromEmail,
          to: [order.customerEmail],
          cc: ['fast@trackstar.art'],
          // Route replies to a real inbox so we can set up an auto-responder
          // that redirects customers back to the portal. Customers were
          // emailing edits to proofs@orders.trackstar.art (a Resend send-only
          // address) and the messages were vanishing.
          replyTo: process.env.PROOF_REPLY_TO_EMAIL || 'fast@trackstar.art',
          subject,
          html: emailHtml
        })
      } catch (emailErr) {
        console.error('[send-to-customer] Email send failed:', emailErr)
        await alertError('Proof Email Send', emailErr, { orderNumber: order.orderNumber })
        return res.status(500).json({ error: 'Failed to send email. Please try again.' })
      }

      // Update design status to awaiting_review, record when proofs were sent, and save designer note
      await prisma.order.update({
        where: { id: orderId },
        data: { designStatus: 'awaiting_review', proofSentAt: new Date(), designerNote: note || null }
      })

      console.log(`[send-to-customer] Proofs emailed for order ${order.orderNumber}`)
      await recordAudit({ action: 'proof.send', summary: `Emailed proofs for ${order.orderNumber} to the customer`, detail: { orderId, orderNumber: order.orderNumber, proofs: order.proofs.length }, actor })

      // Slack notification (fire and forget)
      if (process.env.SLACK_PROOF_WEBHOOK_URL) {
        await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL, `📧 Proofs sent to *${slackText(order.customerName || 'customer')}* for order *${slackText(displayNum)}*`)
      }

      return res.status(200).json({ success: true, approvalUrl })
    }

    // ─── Notify Eli: PDF uploaded and ready for production ───
    if (resolvedAction === 'notify-production') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

      const { orderId } = body
      if (!orderId) return res.status(400).json({ error: 'orderId is required' })

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (!order) return res.status(404).json({ error: 'Order not found' })

      const shopifyData = order.shopifyOrderData
      const displayNum = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
        ? String(shopifyData.name) : `#${order.parentOrderNumber}`

      // Send Slack notification to Eli. Partner orders carry a production
      // file and a photo, and are named by the partner, not an order number.
      const isPartner = order.trackstarOrderType === 'race_partner'
      const text = isPartner
        ? `📋 <@U09UVEP1N3Y> Production file + photo uploaded for *${slackText(order.raceName || displayNum)}* - ready for production.`
        : `📋 <@U09UVEP1N3Y> Final PDF uploaded for order *${displayNum}* - ready for production.`
      await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL, text)

      console.log(`[notify-production] Eli notified for order ${order.orderNumber}`)
      return res.status(200).json({ success: true })
    }

    // ─── Proof CRUD (merchant) ───
    if (req.method === 'GET') {
      const { orderId } = req.query
      if (!orderId) return res.status(400).json({ error: 'orderId is required' })

      const proofs = await prisma.proof.findMany({
        where: { orderId },
        orderBy: { version: 'asc' }
      })
      const messages = await prisma.orderMessage.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, sender: true, body: true, createdAt: true },
      })
      return res.status(200).json({ proofs, messages })
    }

    // Label (or relabel) an existing proof. Needed because proofs are often
    // uploaded before anyone decides how they group, and because the label is
    // the thing that decides what competes with what - getting it wrong after
    // the fact should not mean deleting and re-uploading the artwork.
    // An admin correcting which option the customer approved. Customers
    // sometimes click Approve on the wrong option and then email to say so;
    // this records the right one without sending them back through the
    // portal. The proof that was approved becomes rejected, the chosen one
    // approved, within the same round and group. Admins only, and audited.
    if (req.method === 'POST' && body.action === 'override-approval') {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      const proof = await prisma.proof.findUnique({ where: { id: String(body.proofId || '') }, include: { order: { select: { id: true, orderNumber: true, designStatus: true } } } })
      if (!proof) return res.status(404).json({ error: 'Proof not found' })
      if (proof.status === 'approved') return res.status(400).json({ error: 'That one is already the approved option.' })
      const sameGroup = { orderId: proof.orderId, batch: proof.batch, groupLabel: proof.groupLabel ?? null }
      const wasApproved = await prisma.proof.findMany({ where: { ...sameGroup, status: 'approved' }, select: { id: true, version: true } })
      await prisma.$transaction([
        prisma.proof.updateMany({ where: { ...sameGroup, status: 'approved' }, data: { status: 'rejected' } }),
        prisma.proof.update({ where: { id: proof.id }, data: { status: 'approved' } }),
        ...(proof.order.designStatus === 'sent_to_production' ? [] : [
          prisma.order.update({ where: { id: proof.orderId }, data: { designStatus: 'approved_by_customer' } }),
        ]),
      ])
      const from = wasApproved.map(p => `v${p.version}`).join(', ') || 'none'
      await recordAudit({
        action: 'proof.override',
        summary: `Changed the approved option on ${proof.order.orderNumber} from ${from} to v${proof.version}`,
        detail: { orderId: proof.orderId, proofId: proof.id, previouslyApproved: wasApproved.map(p => p.id) },
        actor: admin,
      })
      const proofs = await prisma.proof.findMany({ where: { orderId: proof.orderId }, orderBy: { version: 'asc' } })
      return res.status(200).json({ success: true, proofs, inProduction: proof.order.designStatus === 'sent_to_production' })
    }

    if (req.method === 'POST' && body.action === 'set-group-label') {
      const { proofId, groupLabel } = body
      if (!proofId) return res.status(400).json({ error: 'proofId is required' })

      const existing = await prisma.proof.findUnique({ where: { id: proofId } })
      if (!existing) return res.status(404).json({ error: 'Proof not found' })
      // Once a proof is answered its label has already decided which siblings
      // were rejected. Changing it now would rewrite that history.
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'Only pending proofs can be relabelled' })
      }

      const proof = await prisma.proof.update({
        where: { id: proofId },
        data: {
          groupLabel: typeof groupLabel === 'string' && groupLabel.trim() ? groupLabel.trim() : null,
        },
      })
      return res.status(200).json({ success: true, proof })
    }

    // A signed URL so the browser can put the file in storage itself. Vercel
    // caps a request body at 4.5 MB, which a PNG preview clears easily, and
    // the failure is a plain-text 413 the client cannot even read. The file
    // goes straight to the bucket; the record is created in a second call
    // with the resulting URL.
    if (req.method === 'POST' && body.action === 'upload-url') {
      const { orderId, filename, contentType } = body
      if (!orderId) return res.status(400).json({ error: 'orderId is required' })
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } })
      if (!order) return res.status(404).json({ error: 'Order not found' })
      const ext = String(filename || 'proof.png').split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      if (!PROOF_EXTS.has(ext)) return res.status(400).json({ error: 'Proofs are PNG, JPG, GIF, WebP or PDF.' })
      const path = `${orderId}/raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const supabase = storage()
      const { data, error } = await supabase.storage.from('order-proofs').createSignedUploadUrl(path)
      if (error) return res.status(500).json({ error: 'Could not start the upload. Try again.' })
      return res.status(200).json({
        path,
        uploadUrl: data.signedUrl,
        token: data.token,
        contentType: contentType || null,
        publicUrl: supabase.storage.from('order-proofs').getPublicUrl(path).data.publicUrl,
      })
    }

    if (req.method === 'POST') {
      const { orderId, imageData, imageUrl, imageName, groupLabel } = body

      if (!orderId) return res.status(400).json({ error: 'orderId is required' })

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (!order) return res.status(404).json({ error: 'Order not found' })

      const lastProof = await prisma.proof.findFirst({
        where: { orderId },
        orderBy: { version: 'desc' }
      })
      const version = (lastProof?.version || 0) + 1

      // Determine batch number: if there are no pending proofs (all previous were
      // resolved via approval/revision/rejection), start a new batch
      const existingProofs = await prisma.proof.findMany({
        where: { orderId },
        select: { batch: true, status: true }
      })
      let batch = 1
      if (existingProofs.length > 0) {
        const maxBatch = Math.max(...existingProofs.map(p => p.batch))
        const hasPending = existingProofs.some(p => p.status === 'pending')
        // If there are already pending proofs, they're in the current batch — join them
        // If all proofs are resolved, start a new batch
        batch = hasPending ? maxBatch : maxBatch + 1
      }

      const supabaseClient = storage()
      let publicUrl = imageUrl || null
      let thumbnailUrl = null

      // A file the browser already put in our bucket via upload-url. Pull it
      // back, make the web-size copy and the thumbnail the same way a direct
      // upload would, and drop the raw original.
      const rawMatch = imageUrl && !uploadedFile && !imageData
        ? String(imageUrl).match(/\/storage\/v1\/object\/public\/order-proofs\/(.+\/raw-[^/]+)$/)
        : null
      if (rawMatch && !decodeURIComponent(rawMatch[1]).startsWith(`${orderId}/`)) {
        return res.status(400).json({ error: 'That upload belongs to a different order.' })
      }
      if (rawMatch) {
        const rawPath = decodeURIComponent(rawMatch[1])
        const ext = rawPath.split('.').pop()?.toLowerCase() || 'png'
        const timestamp = Date.now()
        const { data: blob, error: dlErr } = await supabaseClient.storage.from('order-proofs').download(rawPath)
        if (dlErr || !blob) return res.status(400).json({ error: 'The uploaded file could not be read back. Upload it again.' })
        const buffer = Buffer.from(await blob.arrayBuffer())
        const { compressed, thumbnail } = await processImage(buffer, ext)
        if (compressed) {
          const filePath = `${orderId}/v${version}-${timestamp}.jpg`
          const { error: upErr } = await supabaseClient.storage.from('order-proofs').upload(filePath, compressed, { contentType: 'image/jpeg', upsert: false })
          if (upErr) return res.status(500).json({ error: 'The image did not upload. Try again.' })
          publicUrl = supabaseClient.storage.from('order-proofs').getPublicUrl(filePath).data.publicUrl
          await supabaseClient.storage.from('order-proofs').remove([rawPath]).catch(() => {})
        } else {
          // PDFs and anything sharp cannot read stay as uploaded, under a proper name.
          const filePath = `${orderId}/v${version}-${timestamp}.${ext}`
          const { error: mvErr } = await supabaseClient.storage.from('order-proofs').move(rawPath, filePath)
          publicUrl = supabaseClient.storage.from('order-proofs').getPublicUrl(mvErr ? rawPath : filePath).data.publicUrl
        }
        if (thumbnail) {
          const thumbPath = `${orderId}/v${version}-${timestamp}-thumb.jpg`
          const { error: thumbErr } = await supabaseClient.storage.from('order-proofs').upload(thumbPath, thumbnail, { contentType: 'image/jpeg', upsert: false })
          if (!thumbErr) thumbnailUrl = supabaseClient.storage.from('order-proofs').getPublicUrl(thumbPath).data.publicUrl
        }
      }

      // File upload via FormData (small files; large ones use upload-url)
      if (uploadedFile) {
        const ext = (uploadedFile.originalFilename || 'proof.png').split('.').pop()?.toLowerCase() || 'png'
        if (!PROOF_EXTS.has(ext)) return res.status(400).json({ error: 'Proofs are PNG, JPG, GIF, WebP or PDF.' })
        const timestamp = Date.now()
        const fileBuffer = fs.readFileSync(uploadedFile.filepath)

        // Clean up temp file
        try { fs.unlinkSync(uploadedFile.filepath) } catch {}

        // Compress image + generate thumbnail (non-images like PDFs pass through)
        const { compressed, thumbnail } = await processImage(fileBuffer, ext)
        const useCompressed = !!compressed
        const uploadBuffer = compressed || fileBuffer
        const uploadExt = useCompressed ? 'jpg' : ext
        const uploadContentType = useCompressed ? 'image/jpeg' : (uploadedFile.mimetype || 'application/octet-stream')
        const filePath = `${orderId}/v${version}-${timestamp}.${uploadExt}`

        const { error: uploadErr } = await supabaseClient.storage
          .from('order-proofs')
          .upload(filePath, uploadBuffer, { contentType: uploadContentType, upsert: false })

        if (uploadErr) {
          console.error('[proofs] File upload failed:', uploadErr.message)
          return res.status(500).json({ error: 'The file did not upload. Try again.' })
        }

        publicUrl = supabaseClient.storage.from('order-proofs').getPublicUrl(filePath).data.publicUrl

        // Upload thumbnail if generated
        if (thumbnail) {
          const thumbPath = `${orderId}/v${version}-${timestamp}-thumb.jpg`
          const { error: thumbErr } = await supabaseClient.storage
            .from('order-proofs')
            .upload(thumbPath, thumbnail, { contentType: 'image/jpeg', upsert: false })

          if (!thumbErr) {
            thumbnailUrl = supabaseClient.storage.from('order-proofs').getPublicUrl(thumbPath).data.publicUrl
          } else {
            console.warn('[proofs] Thumbnail upload failed:', thumbErr.message)
          }
        }
      }
      // Base64 upload (legacy fallback)
      else if (imageData && !imageUrl) {
        const ext = (imageName || 'proof.png').split('.').pop()?.toLowerCase() || 'png'
        if (!PROOF_EXTS.has(ext)) return res.status(400).json({ error: 'Proofs are PNG, JPG, GIF, WebP or PDF.' })
        const timestamp = Date.now()

        const buffer = Buffer.from(imageData, 'base64')

        // Compress image + generate thumbnail
        const { compressed, thumbnail } = await processImage(buffer, ext)
        const useCompressed = !!compressed
        const uploadBuffer = compressed || buffer
        const uploadExt = useCompressed ? 'jpg' : ext
        const mimeTypes = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          gif: 'image/gif', webp: 'image/webp',
          pdf: 'application/pdf'
        }
        const uploadContentType = useCompressed ? 'image/jpeg' : (mimeTypes[ext] || `image/${ext}`)
        const filePath = `${orderId}/v${version}-${timestamp}.${uploadExt}`

        const { error: uploadErr } = await supabaseClient.storage
          .from('order-proofs')
          .upload(filePath, uploadBuffer, { contentType: uploadContentType, upsert: false })

        if (uploadErr) {
          console.error('[proofs] Image upload failed:', uploadErr.message)
          return res.status(500).json({ error: 'The image did not upload. Try again.' })
        }

        publicUrl = supabaseClient.storage.from('order-proofs').getPublicUrl(filePath).data.publicUrl

        // Upload thumbnail if generated
        if (thumbnail) {
          const thumbPath = `${orderId}/v${version}-${timestamp}-thumb.jpg`
          const { error: thumbErr } = await supabaseClient.storage
            .from('order-proofs')
            .upload(thumbPath, thumbnail, { contentType: 'image/jpeg', upsert: false })

          if (!thumbErr) {
            thumbnailUrl = supabaseClient.storage.from('order-proofs').getPublicUrl(thumbPath).data.publicUrl
          } else {
            console.warn('[proofs] Thumbnail upload failed:', thumbErr.message)
          }
        }
      }

      if (!publicUrl) {
        return res.status(400).json({ error: 'No file or image data provided' })
      }

      const fileName = uploadedFile?.originalFilename || imageName || null
      const proof = await prisma.proof.create({
        data: {
          orderId, version, batch, imageUrl: publicUrl, thumbnailUrl, fileName, status: 'pending',
          // Trimmed to null so a stray space cannot create a second group that
          // looks identical to the first and waits forever for its own approval.
          groupLabel: typeof groupLabel === 'string' && groupLabel.trim() ? groupLabel.trim() : null,
        }
      })

      const approvalToken = await ensureApprovalToken(orderId)

      const approvalUrl = buildApprovalUrl(req, approvalToken.token)
      console.log(`[proofs] Uploaded v${version} for order ${order.orderNumber}`)
      await recordAudit({ action: 'proof.upload', summary: `Uploaded proof v${version} for ${order.orderNumber}`, detail: { orderId, proofId: proof.id, version }, actor })
      return res.status(201).json({ success: true, proof, approvalToken, approvalUrl })
    }

    if (req.method === 'DELETE') {
      const { proofId } = body

      if (!proofId) return res.status(400).json({ error: 'proofId is required' })

      const proof = await prisma.proof.findUnique({ where: { id: String(proofId) }, include: { order: { select: { orderNumber: true } } } })
      if (!proof) return res.status(404).json({ error: 'Proof not found' })
      // The approved proof is the record of what the customer signed off on.
      if (proof.status === 'approved') {
        return res.status(409).json({ error: 'That proof was approved by the customer, so it stays. Upload a new version instead.' })
      }

      if (proof.imageUrl) {
        try {
          const supabase = storage()
          const match = proof.imageUrl.match(/\/storage\/v1\/object\/public\/order-proofs\/(.+)$/)
          if (match?.[1]) {
            await supabase.storage.from('order-proofs').remove([decodeURIComponent(match[1])])
          }
        } catch (e) {
          console.warn('[proofs] Failed to delete image from storage:', e.message)
        }
      }

      await prisma.proof.delete({ where: { id: proof.id } })
      console.log(`[proofs] Deleted proof ${proof.id}`)
      await recordAudit({ action: 'proof.delete', summary: `Deleted proof v${proof.version} for ${proof.order?.orderNumber || 'an order'}`, detail: { orderId: proof.orderId, proofId: proof.id, version: proof.version }, actor })
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('[proofs] Error:', error)
    return sendPublicError(res, error)
  }
}
