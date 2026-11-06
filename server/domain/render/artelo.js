/**
 * The Artelo image library. An approved print goes there as well as to the
 * Drive Orders folder, so whoever builds the Artelo order finds the file in
 * Artelo already (and once Artelo lets us attach a file to an order item, it
 * is the same upload). Artelo fetches the file from a URL we give it: a
 * short-lived signed link to our own copy.
 *
 *   POST uploads/files/create { imageUrl, name, parentFolderId } -> { id, status }
 *   GET  uploads/files/get-by-id?id=                            -> { status: Pending | Success | Deleted, url, ... }
 *   GET  uploads/folders/get-subfolders / POST uploads/folders/create
 *
 * The folder is found by name (ARTELO_UPLOAD_FOLDER, default "Orders") and
 * created if missing; its id is remembered in SystemConfig.
 */
import prisma from '../../db.js'
import { signedFiles } from './jobs.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import { requireConnection } from '../../lib/connections.js'

const BASE = 'https://www.artelo.com/api/open/'
const FOLDER_KEY = 'artelo_orders_folder_id'
const folderName = () => process.env.ARTELO_UPLOAD_FOLDER || 'Orders'

/** One Open API call. A failure carries Artelo's status and message (error.status, error.arteloMessage). */
export async function call(path, { method = 'GET', body, query } = {}) {
  await requireConnection('artelo')
  const key = process.env.ARTELO_API_KEY
  if (!key) throw new Error('ARTELO_API_KEY is not set')
  const url = BASE + path + (query ? '?' + new URLSearchParams(query).toString() : '')
  const res = await fetchWithTimeout(url, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data = null; try { data = JSON.parse(text) } catch { /* html error page */ }
  if (!res.ok) {
    const error = new Error(`Artelo ${path} ${res.status}: ${data?.message || text.slice(0, 120)}`)
    error.status = res.status
    error.arteloMessage = data?.message || null
    throw error
  }
  return data
}

/** The library folder approved prints go in. Looked up once, then remembered. */
export async function uploadFolderId() {
  const saved = await prisma.systemConfig.findUnique({ where: { key: FOLDER_KEY } })
  if (saved?.value) return saved.value
  const name = folderName()
  const folders = await call('uploads/folders/get-subfolders')
  let folder = (Array.isArray(folders) ? folders : []).find(f => f.name === name)
  if (!folder) folder = await call('uploads/folders/create', { method: 'POST', body: { name } })
  const id = folder?.id
  if (!id) throw new Error(`Could not find or create the "${name}" folder in Artelo`)
  await prisma.systemConfig.upsert({ where: { key: FOLDER_KEY }, update: { value: id }, create: { key: FOLDER_KEY, value: id } })
  return id
}

/**
 * Upload a PDF the server can link to (a signed URL) into the library's
 * Orders folder and wait briefly for Artelo to fetch it. Returns the upload
 * id. Used for prints made by hand, whose PDF only exists in Drive.
 */
export async function uploadPdfToLibrary(pdfUrl, name) {
  const parentFolderId = await uploadFolderId()
  const created = await call('uploads/files/create', { method: 'POST', body: { imageUrl: pdfUrl, name, parentFolderId } })
  if (!created?.id) throw new Error('Artelo did not return an upload id')
  let status = created.status
  for (let i = 0; i < 6 && status === 'Pending'; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const got = await call('uploads/files/get-by-id', { query: { id: created.id } }).catch(() => null)
    if (got?.status) status = got.status
  }
  if (status === 'Deleted') throw new Error('Artelo rejected the file')
  return created.id
}

/**
 * Upload the job's PDF to the library. Records the upload on the job, or the
 * error. Safe to call again: a job already uploaded is left alone, and a
 * superseded version is skipped the same way Drive delivery skips it.
 */
export async function uploadApprovedToArtelo(job) {
  if (job.arteloUploadedAt) return job
  // Another size (render/jobs.js createJob) supersedes only the same size of itself, and never the print.
  const newer = (await prisma.renderJob.findMany({ where: { orderId: job.orderId, review: 'approved', version: { gt: job.version } }, orderBy: { version: 'desc' }, select: { version: true, spec: true } }))
    .find(j => Boolean(j.spec?.altSize) === Boolean(job.spec?.altSize) && (!job.spec?.altSize || j.spec?.size === job.spec?.size))
  if (newer) return prisma.renderJob.update({ where: { id: job.id }, data: { arteloError: `Superseded by v${newer.version}` } })
  try {
    const { pdfUrl } = await signedFiles(job, 900)
    if (!pdfUrl) throw new Error('No PDF on this render')
    const parentFolderId = await uploadFolderId()
    const name = `${job.spec?.file || job.orderId}.pdf`
    const created = await call('uploads/files/create', { method: 'POST', body: { imageUrl: pdfUrl, name, parentFolderId } })
    if (!created?.id) throw new Error('Artelo did not return an upload id')
    // Artelo fetches the file on its own time; wait a little for it to land.
    let status = created.status, url = null
    for (let i = 0; i < 6 && status === 'Pending'; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const got = await call('uploads/files/get-by-id', { query: { id: created.id } }).catch(() => null)
      if (got?.status) { status = got.status; url = got.url || null }
    }
    if (status === 'Deleted') throw new Error('Artelo rejected the file')
    console.log(`[render.artelo] Uploaded ${name} to the Artelo library (${created.id}, ${status})`)
    return prisma.renderJob.update({ where: { id: job.id }, data: { arteloUploadId: created.id, arteloUploadedAt: new Date(), arteloUrl: url, arteloError: status === 'Pending' ? null : null } })
  } catch (error) {
    console.error('[render.artelo]', error.message)
    return prisma.renderJob.update({ where: { id: job.id }, data: { arteloError: String(error.message).slice(0, 500) } })
  }
}

/** Approved renders not in the Artelo library yet, retried on every auto-import. */
export async function uploadPending({ limit = 20 } = {}) {
  const jobs = await prisma.renderJob.findMany({ where: { status: 'done', review: 'approved', arteloUploadedAt: null }, orderBy: { reviewedAt: 'asc' }, take: limit })
  let uploaded = 0, failed = 0
  for (const job of jobs) { const out = await uploadApprovedToArtelo(job); if (out.arteloUploadedAt) uploaded++; else failed++ }
  return { uploaded, failed }
}
