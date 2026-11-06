/**
 * The render worker's side of the queue (worker/render-worker.mjs).
 *
 * Authenticates with an API key (Authorization: Bearer ...) that has the
 * worker scope. A worker can put any file in front of a reviewer as a
 * finished design, so this is not open to write or repair keys in general:
 * the one exception, kept so the Mac already running does not stop, is a
 * write key acting as an admin. Mint a worker key and move it over. Every
 * call is a POST with an action:
 *
 *   templates  { workerId }                   the enabled templates: key, file, rules, last check
 *   heartbeat  { workerId, name, templates, files }  I am here; files I have and keys I can render
 *   check      { workerId, key, mtime, ok, report }  I checked this template's file
 *   claim      { workerId }                   give me the next job, with upload slots and its template
 *   complete   { workerId, jobId, notes }     files are uploaded
 *   fail       { workerId, jobId, error }     could not render
 *   relayClaim { workerId }                   page fetches the server cannot make (a timing site blocks it)
 *   relayDone  { workerId, id, status, body, setCookies } or { id, error }   the page, fetched from this Mac
 *
 * Files go straight from the Mac to storage through signed upload URLs, so
 * the PDF never passes through this function.
 */
import { setCors } from '../../_lib/auth.js'
import { resolveApiKey } from '../../_lib/apiKeys.js'
import { claimRelays, finishRelay } from '../../../server/lib/fetchRelay.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'
import { heartbeat, claimNext, uploadSlots, completeJob, failJob } from '../../../server/domain/render/jobs.js'
import { templatesForWorker, recordCheck } from '../../../server/domain/render/templates.js'

function bearer(h) {
  const m = /^Bearer\s+(.+)$/i.exec(String(h || ''))
  return m ? m[1].trim() : null
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const presented = bearer(req.headers['authorization'])
  const principal = presented ? await resolveApiKey(presented) : null
  const isWorker = principal && !principal.legacy && (
    principal.scopes.has('worker') ||
    (principal.scopes.has('write') && principal.role === 'admin')
  )
  if (!isWorker) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
    const limit = await checkRateLimitDurable(ip, { bucket: 'render-worker-auth', max: 20, windowMs: 10 * 60_000 })
    if (!limit.allowed) return res.status(429).json({ error: 'Too many bad keys from this address' })
    return res.status(401).json({ error: 'A valid API key with the worker scope is required' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const workerId = String(body.workerId || '')
    if (!workerId) return res.status(400).json({ error: 'workerId is required' })

    switch (body.action) {
      case 'relayClaim': {
        // Page fetches the server cannot make itself (server/lib/fetchRelay.js).
        return res.status(200).json({ relays: await claimRelays(workerId) })
      }
      case 'relayDone': {
        return res.status(200).json(await finishRelay({ id: body.id, workerId, status: body.status, body: body.body, setCookies: body.setCookies, error: body.error }))
      }
      case 'templates': {
        return res.status(200).json({ templates: await templatesForWorker() })
      }
      case 'heartbeat': {
        const w = await heartbeat({ workerId, name: body.name, templates: body.templates, files: body.files })
        return res.status(200).json({ ok: true, worker: w.name, templates: w.templates.length })
      }
      case 'check': {
        const t = await recordCheck({ key: body.key, mtime: body.mtime, ok: body.ok, report: body.report, workerId })
        return res.status(200).json({ ok: true, key: t.key, passed: t.lastCheckOk })
      }
      case 'claim': {
        const job = await claimNext(workerId)
        if (!job) return res.status(200).json({ job: null })
        const slots = await uploadSlots(job)
        return res.status(200).json({ job: { id: job.id, version: job.version, spec: job.spec, template: job.template, ...slots } })
      }
      case 'complete': {
        const job = await completeJob({ jobId: body.jobId, workerId, notes: body.notes, output: body.output })
        return res.status(200).json({ ok: true, jobId: job.id })
      }
      case 'fail': {
        const job = await failJob({ jobId: body.jobId, workerId, error: body.error })
        return res.status(200).json({ ok: true, jobId: job.id })
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[API /render/worker]', error)
    return res.status(400).json({ error: 'That did not work. Check the server log.' })
  }
}
