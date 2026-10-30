/**
 * Render jobs: the queue between TrackstarOS and the render workers.
 *
 * The tool creates a job; a worker claims it, renders, uploads and completes
 * it; a person reviews the result. Workers check in every 30 seconds with the
 * races they have templates for, which is how the tool knows which orders can
 * offer "Create Design" at all.
 */
import prisma from '../../db.js'
import { buildSpec, SPEC_SELECT } from './spec.js'
import { availableTemplateKeys, noTimeGaps, onlineWorkers as onlineWorkersList } from './templates.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { storage as sharedStorage } from '../../lib/storage.js'
import { isConnectionOn } from '../../lib/connections.js'

export const BUCKET = 'production-files'
const ONLINE_MS = 90_000
const STALE_CLAIM_MS = 10 * 60_000

function storage() {
  return sharedStorage()
}

/** Workers seen in the last minute and a half. */
export async function onlineWorkers() { return onlineWorkersList() }

/** Template keys a render can be queued for (enabled, check passed, a known worker has the file). */
export async function availableTemplates() { return availableTemplateKeys() }

export async function heartbeat({ workerId, name, templates, files }) {
  const id = String(workerId || '').slice(0, 80)
  if (!id) throw new Error('workerId is required')
  const list = (Array.isArray(templates) ? templates : []).map(String).slice(0, 500)
  const fileMap = files && typeof files === 'object' ? files : undefined
  return prisma.renderWorker.upsert({
    where: { id },
    update: { name: String(name || id).slice(0, 80), templates: list, ...(fileMap ? { files: fileMap } : {}), lastSeenAt: new Date() },
    create: { id, name: String(name || id).slice(0, 80), templates: list, files: fileMap || {}, lastSeenAt: new Date() },
  })
}

/**
 * Whether an order can be rendered now, and the spec if so.
 *
 * `ctx` lets a caller checking many orders load the shared parts once: the
 * order rows (selected with SPEC_SELECT), the templates, the no-time gaps,
 * and a cache of Race rows. Checked one by one, each order cost five or six
 * queries, every ten minutes, for every candidate.
 */
export async function checkOrder(orderId, ctx = {}) {
  const order = ctx.order || await prisma.order.findUnique({ where: { id: String(orderId) }, select: SPEC_SELECT })
  if (!order) throw new Error('Order not found')
  const templates = ctx.templates || await availableTemplates()
  const result = buildSpec(order, templates, await raceRowFor(order, ctx.raceCache), ctx.gaps || await noTimeGaps())
  if (!result.ok && !templates.length) result.reasons.unshift('No render worker has checked in for 30 days')
  return { order, ...result }
}

/** The Race row by name and year, trying the canonical name too. */
async function raceRowFor(order, cache) {
  const name = order.raceNameOverride ?? order.raceName, year = order.yearOverride ?? order.raceYear
  if (!name || !year) return null
  const key = `${name}|${year}`
  if (cache?.has(key)) return cache.get(key)
  const row = await raceRowLookup(name, year)
  cache?.set(key, row)
  return row
}

async function raceRowLookup(name, year) {
  const canonical = getCanonicalRaceName(name) || name
  return await prisma.race.findUnique({ where: { raceName_year: { raceName: name, year } } })
    || (canonical !== name ? prisma.race.findUnique({ where: { raceName_year: { raceName: canonical, year } } }) : null)
}

export async function createJob({ orderId, requestedBy = 'admin', requestedById = null }) {
  const { ok, reasons, spec } = await checkOrder(orderId)
  if (!ok) throw new Error(reasons.join('. '))
  const open = await prisma.renderJob.findFirst({ where: { orderId: String(orderId), status: { in: ['queued', 'rendering'] } } })
  if (open) return open
  const last = await prisma.renderJob.findFirst({ where: { orderId: String(orderId) }, orderBy: { version: 'desc' }, select: { version: true } })
  return prisma.renderJob.create({
    data: { orderId: String(orderId), version: (last?.version || 0) + 1, spec, requestedBy, requestedById },
  })
}

export async function latestJob(orderId) {
  return prisma.renderJob.findFirst({ where: { orderId: String(orderId) }, orderBy: { version: 'desc' }, include: { reviewer: { select: { firstName: true, lastName: true } } } })
}

/** The oldest queued job, now owned by this worker. A claim left hanging is handed out again. */
export async function claimNext(workerId) {
  // Paused in Settings > Connections: the worker keeps checking in, gets nothing.
  if (!(await isConnectionOn('render_worker'))) return null
  const stale = new Date(Date.now() - STALE_CLAIM_MS)
  await prisma.renderJob.updateMany({ where: { status: 'rendering', claimedAt: { lt: stale } }, data: { status: 'queued', workerId: null, claimedAt: null } })
  const worker = await prisma.renderWorker.findUnique({ where: { id: String(workerId) } })
  const templates = Array.isArray(worker?.templates) ? worker.templates.map(String) : []
  // The job carries the template rules it should render with, resolved here from the table.
  const candidates = await prisma.renderJob.findMany({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, take: 20 })
  for (const job of candidates) {
    if (!templates.includes(String(job.spec?.template || job.spec?.race))) continue
    const claimed = await prisma.renderJob.updateMany({ where: { id: job.id, status: 'queued' }, data: { status: 'rendering', workerId: String(workerId), claimedAt: new Date() } })
    if (claimed.count === 1) {
      const t = await prisma.printTemplate.findUnique({ where: { key: String(job.spec?.template || job.spec?.race) } })
      const fresh = await prisma.renderJob.findUnique({ where: { id: job.id } })
      return { ...fresh, template: t ? { key: t.key, file: t.file, rules: t.rules || {}, ...(t.storagePath ? { uploaded: true, version: t.fileVersion } : {}) } : null }
    }
  }
  return null
}

/** Where this job's files go. Versioned, so nothing is ever overwritten. */
export function pathsFor(job) {
  const base = `renders/${job.orderId}/v${job.version}`
  return { pdf: `${base}.pdf`, preview: `${base}.png` }
}

/** Signed upload slots for the worker, and a signed read of the photo if the order has one. */
export async function uploadSlots(job) {
  const sb = storage()
  const paths = pathsFor(job)
  const pdf = await sb.storage.from(BUCKET).createSignedUploadUrl(paths.pdf, { upsert: true })
  const preview = await sb.storage.from(BUCKET).createSignedUploadUrl(paths.preview, { upsert: true })
  if (pdf.error || preview.error) throw new Error(`Could not open upload slots: ${(pdf.error || preview.error).message}`)
  let photoUrl = null
  if (job.spec?.photoPath) {
    const { data, error } = await sb.storage.from('personalization-photos').createSignedUrl(job.spec.photoPath, 600)
    if (error) throw new Error(`Could not read the customer photo: ${error.message}`)
    photoUrl = data.signedUrl
  }
  return { pdfUploadUrl: pdf.data.signedUrl, previewUploadUrl: preview.data.signedUrl, pdfPath: paths.pdf, previewPath: paths.preview, photoUrl }
}

/** What is wrong with the PDF the worker measured, in plain words. Empty when it is print ready. */
export function outputProblems(output, size) {
  if (!output) return []
  const out = []
  if (output.trimIn && size && output.trimIn !== size) out.push(`trim is ${output.trimIn}, not ${size}`)
  const b = output.bleedIn
  if (b && [b.left, b.right, b.top, b.bottom].some(v => Math.abs(v - 0.25) > 0.01)) out.push('bleed is not 0.25" on every side')
  if (output.color && output.color !== 'CMYK') out.push(`color is ${output.color}, not CMYK`)
  return out
}

export async function completeJob({ jobId, workerId, notes, output }) {
  const job = await prisma.renderJob.findUnique({ where: { id: String(jobId) } })
  if (!job || job.workerId !== String(workerId) || job.status !== 'rendering') throw new Error('That job is not yours to complete')
  const paths = pathsFor(job)
  const measured = output && typeof output === 'object' ? {
    trimIn: output.trimIn ? String(output.trimIn).slice(0, 20) : null,
    bleedIn: output.bleedIn && typeof output.bleedIn === 'object' ? { left: Number(output.bleedIn.left), right: Number(output.bleedIn.right), top: Number(output.bleedIn.top), bottom: Number(output.bleedIn.bottom) } : null,
    color: ['CMYK', 'RGB', 'mixed'].includes(output.color) ? output.color : null,
  } : null
  // A print that is not print ready says so where the reviewer reads it.
  const problems = outputProblems(measured, job.spec?.size)
  const allNotes = [notes, problems.length ? `Check the PDF: ${problems.join('; ')}` : null].filter(Boolean).join('; ')
  return prisma.renderJob.update({ where: { id: job.id }, data: { status: 'done', finishedAt: new Date(), pdfPath: paths.pdf, previewPath: paths.preview, notes: allNotes ? allNotes.slice(0, 2000) : null, output: measured ?? undefined } })
}

export async function failJob({ jobId, workerId, error }) {
  const job = await prisma.renderJob.findUnique({ where: { id: String(jobId) } })
  if (!job || job.workerId !== String(workerId)) throw new Error('That job is not yours')
  return prisma.renderJob.update({ where: { id: job.id }, data: { status: 'failed', finishedAt: new Date(), error: String(error || 'Render failed').slice(0, 2000) } })
}

/** Short-lived links to the files, for the review panel and downloads. */
export async function signedFiles(job, ttl = 600) {
  if (job.status !== 'done') return { pdfUrl: null, previewUrl: null }
  const sb = storage()
  const [pdf, preview] = await Promise.all([
    sb.storage.from(BUCKET).createSignedUrl(job.pdfPath, ttl, { download: `${job.spec?.file || job.orderId}.pdf` }),
    sb.storage.from(BUCKET).createSignedUrl(job.previewPath, ttl),
  ])
  return { pdfUrl: pdf.data?.signedUrl || null, previewUrl: preview.data?.signedUrl || null }
}

export async function reviewJob({ jobId, decision, note, reviewerId }) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Decision must be approved or rejected')
  const job = await prisma.renderJob.findUnique({ where: { id: String(jobId) } })
  if (!job) throw new Error('Job not found')
  if (job.status !== 'done') throw new Error('Only a finished render can be reviewed')
  if (decision === 'rejected' && !String(note || '').trim()) throw new Error('Say what is wrong, so the designer knows')
  return prisma.renderJob.update({ where: { id: job.id }, data: { review: decision, reviewNote: note ? String(note).slice(0, 2000) : null, reviewedById: reviewerId || null, reviewedAt: new Date() } })
}


/**
 * Queue renders for open orders that have everything and no render yet.
 * Runs on every auto-import, so a print is usually waiting for review by
 * the time anyone looks at the order. Only orders a known worker has the
 * template for are queued (createJob refuses the rest); one queued while
 * every Mac is asleep renders when a Mac checks in. A person still approves
 * every render.
 */
export const AUTO_SINCE_KEY = 'render_auto_since'

export async function autoQueueRenders({ limit = 25 } = {}) {
  const templates = await availableTemplates()
  if (!templates.length) return { queued: 0, skipped: 0, reason: 'no render worker has checked in for 30 days' }
  // Only orders placed after the switch was turned on. The backlog is rendered
  // on purpose, later, once the automatic renders have earned trust.
  const since = await prisma.systemConfig.findUnique({ where: { key: AUTO_SINCE_KEY } })
  const from = since?.value ? new Date(since.value) : new Date()
  const candidates = await prisma.order.findMany({
    where: {
      // Shop orders since the switch, and runners in a paid bulk order
      // (billing.js): those render like shop orders.
      OR: [
        { trackstarOrderType: 'standard', createdAt: { gte: from } },
        // Co-branded lines too: spec.js only lets one through once its uploaded file is checked.
        { trackstarOrderType: 'bulk', bulkOrder: { paidAt: { not: null }, printKind: { in: ['standard', 'cobranded'] } } },
      ],
      status: { notIn: ['completed', 'flagged'] },
      raceName: { in: [...new Set(templates.map(t => t.split(' / ')[0]))] },
      renderJobs: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
    // Every candidate, not a window: many open orders cannot render yet (race
    // not run, data missing), and a capped window of the oldest ones starved
    // the ready orders behind them. Checking an order is a cheap read.
    take: 1000,
    select: SPEC_SELECT,
  })
  const ctx = { templates, gaps: await noTimeGaps(), raceCache: new Map() }
  let queued = 0, skipped = 0
  for (const o of candidates) {
    if (queued >= limit) break
    const { ok } = await checkOrder(o.id, { ...ctx, order: o })
    if (!ok) { skipped++; continue }
    await createJob({ orderId: o.id, requestedBy: 'system' })
    queued++
  }
  const again = await rerenderChanged({ limit })
  return { queued, skipped, rerendered: again.queued }
}

// What a print is made from. Two specs that agree on these would print the same.
const PRINTED = ['template', 'size', 'name', 'bib', 'time', 'pace', 'noTime', 'date', 'condition', 'temp', 'photoPath']
export function printedDiffers(a, b) {
  return PRINTED.some(k => (a?.[k] ?? null) !== (b?.[k] ?? null))
}

/**
 * A rejected or failed design renders again on its own once the data it was
 * made from has changed (a corrected name, a new time, a fixed race date),
 * and not before: the same data would only make the same print. This is the
 * path back from Reject, so the reviewer fixes the order and the next
 * import brings a new design to review.
 */
export async function rerenderChanged({ limit = 10 } = {}) {
  const rows = await prisma.order.findMany({
    where: { trackstarOrderType: { in: ['standard', 'bulk'] }, status: { notIn: ['completed', 'flagged'] }, renderJobs: { some: {} } },
    select: { id: true, renderJobs: { orderBy: { version: 'desc' }, take: 1, select: { status: true, review: true, spec: true } } },
  })
  let queued = 0
  for (const o of rows) {
    if (queued >= limit) break
    const last = o.renderJobs[0]
    // Failed, rejected, or closed because the weather changed under it (closed by
    // hand-completion never gets here: that order is completed).
    if (!last || !(last.status === 'failed' || (last.status === 'done' && (last.review === 'rejected' || last.review === 'closed')))) continue
    const { ok, spec } = await checkOrder(o.id).catch(() => ({ ok: false }))
    if (!ok || !printedDiffers(spec, last.spec)) continue
    await createJob({ orderId: o.id, requestedBy: 'system' })
    queued++
  }
  return { queued }
}
