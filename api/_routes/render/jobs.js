/**
 * Automated print renders, for the order panel. Anyone signed in can read
 * (the team sees an approved print); creating and reviewing need the
 * orders.render capability (admins, and fulfillment by default).
 *
 *   GET  ?orderId=                 can this order be rendered, the latest job, signed file links
 *   POST { action: 'create', orderId }                     queue a render
 *   POST { action: 'review', jobId, decision, note, send }  approve or reject a finished render;
 *                                                          an approval goes to production unless send is false
 *
 * The rendering itself happens on a Mac with Illustrator (worker/), which
 * talks to api/_routes/render/worker.js.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireCapability, recordAudit, loadActiveUser } from '../../_lib/users.js'
import { checkOrder, createJob, latestJob, signedFiles, onlineWorkers } from '../../../server/domain/render/jobs.js'
import { reviewRender, deliverEverywhere } from '../../../server/domain/render/review.js'
import { inBackground } from '../../../server/lib/background.js'
import { autoSendOn, sendState } from '../../../server/domain/render/arteloSend.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return

  try {
    if (req.method === 'GET') {
      const actor = (await requireAdmin(req, res))
      if (!actor) return
      if (!(await loadActiveUser(actor))) return res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
      const orderId = String(req.query?.orderId || '')
      if (!orderId) return res.status(400).json({ error: 'orderId is required' })
      let [{ ok, reasons }, job, workers, autoSend] = await Promise.all([checkOrder(orderId), latestJob(orderId), onlineWorkers(), autoSendOn()])
      // An approved render that did not reach Drive or Artelo is retried on
      // sight, in the background so opening the order never waits on it. The
      // first two minutes after an approval belong to that approval's own
      // upload, so the two never send the same file twice.
      const missing = job && job.review === 'approved' && (!job.deliveredAt || !job.arteloUploadedAt)
      if (missing && (!job.reviewedAt || Date.now() - new Date(job.reviewedAt).getTime() > 120000)) inBackground(deliverEverywhere(job))
      const files = job ? await signedFiles(job) : { pdfUrl: null, previewUrl: null }
      return res.status(200).json({ eligible: ok, reasons, job: job ? present(job, files) : null, workersOnline: workers.map(w => w.name), autoSend })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const user = await requireCapability(req, res, 'orders.render')
    if (!user) return
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})

    if (body.action === 'create') {
      const job = await createJob({ orderId: String(body.orderId || ''), requestedBy: 'admin', requestedById: user.id })
      await recordAudit({ action: 'render.create', summary: `Queued a render of ${job.spec?.file || job.orderId} (v${job.version})`, detail: { jobId: job.id, orderId: job.orderId }, actor: user })
      return res.status(200).json({ job: present(job, { pdfUrl: null, previewUrl: null }) })
    }

    if (body.action === 'review') {
      // Drive and the Artelo library take several seconds; the person
      // reviewing does not wait for them (server/domain/render/review.js).
      // send: false is Approve only; otherwise an approval goes to production after the hold.
      const { job, delivery } = await reviewRender({ jobId: String(body.jobId || ''), decision: String(body.decision || ''), note: body.note, user, designNeed: body.designNeed === true, send: body.send !== false })
      if (delivery) inBackground(delivery)
      const files = await signedFiles(job)
      return res.status(200).json({ job: present(job, files) })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /render/jobs]', error)
    return res.status(400).json({ error: error.message })
  }
}

function present(job, files) {
  return {
    id: job.id, orderId: job.orderId, version: job.version, status: job.status, requestedBy: job.requestedBy,
    spec: job.spec, notes: job.notes, error: job.error, createdAt: job.createdAt, finishedAt: job.finishedAt,
    review: job.review, reviewNote: job.reviewNote, reviewedAt: job.reviewedAt, deliveredAt: job.deliveredAt, deliveredPath: job.deliveredPath, deliveryError: job.deliveryError, arteloUploadedAt: job.arteloUploadedAt, arteloUrl: job.arteloUrl, arteloError: job.arteloError, output: job.output || null,
    reviewer: job.reviewer ? `${job.reviewer.firstName} ${job.reviewer.lastName}`.trim() : null,
    send: sendState(job),
    ...files,
  }
}
