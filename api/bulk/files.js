/**
 * /api/bulk/files - the finished print files for a bulk order.
 *
 *   POST multipart { id, file }            upload one file; matched to a runner by name
 *   POST multipart { id, file, orderNumber } upload for a specific runner
 *   POST json { action:'check', id }       fetch every attached URL from outside, like Artelo will
 *   POST json { action:'detach', id, orderNumber }
 *
 * Files land in the same public bucket the proofs use, under a path nobody
 * can guess. That is what Artelo needs: a plain GET with no login. The check
 * action proves it before the sheet is generated.
 */
import { queueRunnerSend } from '../../server/domain/bulk/send.js'
import fs from 'fs'
import { randomUUID } from 'crypto'
import formidable from 'formidable'
import prisma from '../_lib/prisma.js'
import { setCors, requireAdmin } from '../_lib/auth.js'
import { matchFileToRunner, checkUrl } from '../../server/domain/bulk/bulkOrders.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { storage } from '../../server/lib/storage.js'

export const config = { api: { bodyParser: false } }

const BUCKET = 'order-proofs'
const MAX_BYTES = 25 * 1024 * 1024

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || ''
    if (ct.includes('multipart/form-data')) {
      if (req._body || req.readable === false) return resolve({ fields: req.body || {}, file: null })
      const form = formidable({ maxFileSize: MAX_BYTES })
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err)
        const flat = {}
        for (const [k, v] of Object.entries(fields)) flat[k] = Array.isArray(v) ? v[0] : v
        const file = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : null
        resolve({ fields: flat, file })
      })
      return
    }
    if (req._preBody) return resolve({ fields: req._preBody, file: null })
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return resolve({ fields: req.body, file: null })
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => { try { resolve({ fields: data ? JSON.parse(data) : {}, file: null }) } catch { resolve({ fields: {}, file: null }) } })
  })
}

const RUNNER_SELECT = { id: true, orderNumber: true, runnerName: true, runnerNameOverride: true, productionFileUrl: true, bulkSentAt: true }

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { fields, file } = await parseBody(req)
    const id = String(fields.id || '')
    if (!id) return res.status(400).json({ error: 'id is required' })
    const bulk = await prisma.bulkOrder.findUnique({ where: { id } })
    if (!bulk) return res.status(404).json({ error: 'Bulk order not found' })
    const runners = (await prisma.order.findMany({ where: { bulkOrderId: id }, select: RUNNER_SELECT }))
      .map(r => ({ ...r, runnerName: r.runnerNameOverride || r.runnerName }))

    if (fields.action === 'check') {
      const results = []
      for (const r of runners) {
        if (!r.productionFileUrl) continue
        results.push({ orderNumber: r.orderNumber, runnerName: r.runnerName, url: r.productionFileUrl, ...(await checkUrl(r.productionFileUrl)) })
      }
      return res.status(200).json({ checked: results.length, unreachable: results.filter(x => !x.ok).length, results })
    }

    if (fields.action === 'detach') {
      const runner = runners.find(r => r.orderNumber === String(fields.orderNumber || ''))
      if (!runner) return res.status(404).json({ error: 'Runner not found' })
      await prisma.order.update({ where: { id: runner.id }, data: { productionFileUrl: null, ...(runner.bulkSentAt ? {} : { bulkSendAfter: null }) } })
      return res.status(200).json({ success: true })
    }

    if (!file) return res.status(400).json({ error: 'No file received' })
    const original = file.originalFilename || 'print.pdf'
    const ext = original.split('.').pop()?.toLowerCase() || 'pdf'
    if (!['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
      try { fs.unlinkSync(file.filepath) } catch { /* ignore */ }
      return res.status(400).json({ error: 'Artelo takes PDF, PNG, JPG or TIFF' })
    }

    // Which runner. An explicit target beats the filename.
    let runner = null
    let how = 'chosen'
    if (fields.orderNumber) {
      runner = runners.find(r => r.orderNumber === String(fields.orderNumber))
    } else {
      const m = matchFileToRunner(original, runners)
      runner = m.runner
      how = m.how
      if (!runner) {
        try { fs.unlinkSync(file.filepath) } catch { /* ignore */ }
        return res.status(200).json({
          matched: false, how, filename: original,
          candidates: (m.candidates || []).map(c => ({ orderNumber: c.orderNumber, runnerName: c.runnerName })),
        })
      }
    }
    if (!runner) {
      try { fs.unlinkSync(file.filepath) } catch { /* ignore */ }
      return res.status(404).json({ error: 'Runner not found' })
    }

    const buffer = fs.readFileSync(file.filepath)
    try { fs.unlinkSync(file.filepath) } catch { /* ignore */ }
    const contentType = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext.startsWith('ti') ? 'image/tiff' : 'image/jpeg'
    const safeName = original.replace(/[^A-Za-z0-9._-]/g, '_')
    const path = `bulk/${bulk.number}/${randomUUID()}/${safeName}`

    const supabase = storage()
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false })
    if (error) return res.status(500).json({ error: 'Upload failed. Try again.' })
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

    await prisma.order.update({ where: { id: runner.id }, data: { productionFileUrl: url } })
    // With a file and an address, the runner's Artelo order is queued (bulk/send.js).
    await queueRunnerSend(runner.id).catch(err => console.warn('[API /bulk/files] queue', runner.orderNumber, err.message))
    const reach = await checkUrl(url)
    return res.status(200).json({ matched: true, how, orderNumber: runner.orderNumber, runnerName: runner.runnerName, url, replaced: Boolean(runner.productionFileUrl), reachable: reach.ok })
  } catch (error) {
    console.error('[API /bulk/files]', error)
    return sendPublicError(res, error)
  }
}
