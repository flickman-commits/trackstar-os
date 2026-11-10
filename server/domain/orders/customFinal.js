/**
 * The end of a custom order, the same as a standard one: once the customer
 * approves, the designer uploads the final PDF here. It is kept as an
 * approved RenderJob (spec.kind 'custom_final'), so the Drive Orders folder
 * save (deliver.js) and the Artelo library upload (artelo.js) are the same
 * code, with the same retries on every auto-import. The order then reads
 * Final PDF uploaded and, after a short hold, is attached to its Artelo
 * order item and sent to production, which completes it (sent_to_production;
 * server/domain/render/arteloSend.js). With sending switched off, Matt is
 * pinged on Slack to attach it by hand, as before.
 *
 * The file goes to the private production-files bucket, put there by the
 * browser through a signed upload URL (Vercel caps a request body at 4.5 MB).
 */
import prisma from '../../db.js'
import { storage } from '../../lib/storage.js'
import { BUCKET } from '../render/jobs.js'
import { deliverEverywhere } from '../render/review.js'
import { setDesignStatus } from './designStatus.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import { slackTo, slackText, slackLink } from '../../lib/slack.js'
import { arteloOrderUrl, orderAppUrl } from '../../lib/links.js'
import { queueSend, sendState } from '../render/arteloSend.js'

export class FinalPdfError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

const READY = ['approved_by_customer', 'final_pdf_uploaded']

function displayNumber(order) {
  const n = order.shopifyOrderData && typeof order.shopifyOrderData === 'object' && order.shopifyOrderData.name
  return String(n || order.parentOrderNumber || order.orderNumber).replace('#', '')
}

/** The shop's filename, from the client (it knows the race shorthands), cleaned; else a safe default. */
function baseName(order, name) {
  const clean = String(name || '').replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9 _.\-]+/g, '').trim().slice(0, 120)
  return clean || `${displayNumber(order)}_Custom`
}

async function loadOrder(orderId) {
  const order = await prisma.order.findUnique({ where: { id: String(orderId || '') } })
  if (!order) throw new FinalPdfError('Order not found', 404)
  if (order.trackstarOrderType !== 'custom') throw new FinalPdfError('The final PDF upload is for custom orders')
  return order
}

/** A signed URL the browser puts the PDF to. */
export async function finalPdfUploadUrl({ orderId }) {
  const order = await loadOrder(orderId)
  if (!READY.includes(order.designStatus)) throw new FinalPdfError('Upload the final PDF once the customer has approved the design')
  const path = `custom/${order.id}/final-${Date.now()}.pdf`
  const { data, error } = await storage().storage.from(BUCKET).createSignedUploadUrl(path)
  if (error) throw new Error(`Could not start the upload: ${error.message}`)
  return { path, uploadUrl: data.signedUrl, token: data.token }
}

/**
 * Record the uploaded PDF, move the order to Final PDF uploaded, and send it
 * to Drive and the Artelo library. A second upload supersedes the first (the
 * newest approved version is the one Drive and Artelo keep).
 */
export async function recordFinalPdf({ orderId, path, fileName, actor = null, send = true }) {
  const order = await loadOrder(orderId)
  if (!READY.includes(order.designStatus)) throw new FinalPdfError('Upload the final PDF once the customer has approved the design')
  const p = String(path || '')
  if (!p.startsWith(`custom/${order.id}/final-`) || !p.endsWith('.pdf')) throw new FinalPdfError('That upload belongs to a different order')

  // The browser said it uploaded; check the file is there and is a PDF.
  const { data: signed } = await storage().storage.from(BUCKET).createSignedUrl(p, 60)
  if (!signed?.signedUrl) throw new FinalPdfError('The upload did not arrive. Try again.')
  const head = await fetchWithTimeout(signed.signedUrl, { headers: { Range: 'bytes=0-4' } }).catch(() => null)
  const magic = head?.ok ? Buffer.from(await head.arrayBuffer()).toString('latin1') : ''
  if (!magic.startsWith('%PDF')) throw new FinalPdfError('That file is not a PDF. Export the final design as a PDF and upload it again.')

  const last = await prisma.renderJob.findFirst({ where: { orderId: order.id }, orderBy: { version: 'desc' }, select: { version: true } })
  const now = new Date()
  let job = await prisma.renderJob.create({
    data: {
      orderId: order.id,
      version: (last?.version || 0) + 1,
      status: 'done',
      requestedBy: 'admin',
      requestedById: actor?.id || null,
      spec: { kind: 'custom_final', file: baseName(order, fileName) },
      pdfPath: p,
      finishedAt: now,
      review: 'approved',
      reviewedById: actor?.id || null,
      reviewedAt: now,
    },
  })
  if (order.designStatus !== 'final_pdf_uploaded') await setDesignStatus(order, 'final_pdf_uploaded', null, actor)

  await deliverEverywhere(job)
  if (send) job = await queueSend(job, { orderType: order.trackstarOrderType })
  const status = await finalPdfStatus(order.id)
  if (!job.sendAfter) await pingToAttach(order, status.finalPdf, actor)
  return status
}

// Matt, who attaches custom prints in Artelo (Slack user id).
const ATTACHER_SLACK_ID = 'U01CQFPL78E'

/** Tell Matt the file is ready to attach in Artelo. Never throws. */
async function pingToAttach(order, fp, actor) {
  if (!fp) return
  const num = `#${displayNumber(order)}${order.lineItemIndex ? `-${order.lineItemIndex + 1}` : ''}`
  const person = actor?.id ? await prisma.user.findUnique({ where: { id: actor.id }, select: { firstName: true } }).catch(() => null) : null
  const who = person?.firstName ? ` ${slackText(person.firstName)} uploaded the` : ' The'
  const artelo = arteloOrderUrl(order.arteloOrderData?.id)
  const lines = [
    `📎 <@${ATTACHER_SLACK_ID}>${who} final PDF for custom order *${slackLink(orderAppUrl(num), num)}*${order.runnerName ? ` (${slackText(order.runnerName)})` : ''}. Attach \`${slackText(fp.fileName)}\` in Artelo, send it to production, then mark it complete in the tool.`,
    fp.inArtelo ? '• In the Artelo library (Orders folder)' : `• ⚠️ Not in the Artelo library yet${fp.arteloError ? `: ${slackText(fp.arteloError, 200)}` : ''}`,
    fp.driveUrl ? `• <${fp.driveUrl}|Saved to Drive>` : `• ⚠️ Not in Drive yet${fp.driveError ? `: ${slackText(fp.driveError, 200)}` : ''}`,
    artelo ? `• <${artelo}|Open the Artelo order>` : null,
  ].filter(Boolean)
  await slackTo('alerts', lines.join('\n'))
}

/** The newest final PDF for the order: where it went, and a link to open it. */
export async function finalPdfStatus(orderId) {
  const job = await prisma.renderJob.findFirst({
    where: { orderId: String(orderId), status: 'done', review: 'approved', spec: { path: ['kind'], equals: 'custom_final' } },
    orderBy: { version: 'desc' },
  })
  if (!job) return { finalPdf: null }
  const { data } = await storage().storage.from(BUCKET).createSignedUrl(job.pdfPath, 600, { download: `${job.spec?.file || 'final'}.pdf` })
  return {
    finalPdf: {
      id: job.id,
      fileName: `${job.spec?.file || 'final'}.pdf`,
      uploadedAt: job.finishedAt,
      pdfUrl: data?.signedUrl || null,
      driveUrl: job.deliveredPath || null,
      driveError: job.deliveredAt ? null : job.deliveryError || null,
      inArtelo: Boolean(job.arteloUploadedAt),
      arteloError: job.arteloUploadedAt ? null : job.arteloError || null,
      send: sendState(job),
    },
  }
}

/** Try Drive and Artelo again for the newest final PDF (the auto-import also retries). */
export async function retryFinalPdf({ orderId }) {
  const order = await loadOrder(orderId)
  const job = await prisma.renderJob.findFirst({
    where: { orderId: order.id, status: 'done', review: 'approved', spec: { path: ['kind'], equals: 'custom_final' } },
    orderBy: { version: 'desc' },
  })
  if (!job) throw new FinalPdfError('No final PDF on this order yet')
  await deliverEverywhere(job)
  return finalPdfStatus(order.id)
}
