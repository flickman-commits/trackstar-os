#!/usr/bin/env node
/**
 * Render worker. Runs on a Mac with Illustrator open and turns the tool's
 * render jobs into print files.
 *
 *   node worker/render-worker.mjs      (or: npm run worker)
 *
 * Every few seconds it asks TrackstarOS for a job. For each one it
 * copies the race's production file to a scratch folder (the live file is
 * never opened), writes the order's details next to the Illustrator script,
 * runs the script through AppleScript, uploads the PDF and preview straight
 * to storage, and reports back.
 *
 * The list of templates (which production file renders which race) comes
 * from the tool, not from this machine. Every 30 seconds the worker checks
 * in with which of those files it has on disk and when each was last
 * modified. A file that changed since it was last checked is run through
 * the template check (illustrator/check.jsx) and the verdict is sent back,
 * so a template that a designer broke stops being rendered on its own, and
 * one they fixed comes back without anyone touching the tool.
 *
 * Settings come from worker/.env (see worker/.env.example):
 *   FULFILLMENT_URL   https://fast.trackstar.art or http://localhost:3001
 *   RENDER_API_KEY    an API key with the write scope (Settings > Admin > API Keys)
 *   RACES_DIR         the synced Drive folder holding <Race>/Illustrator Files/...
 *   WORKER_NAME       how this machine shows up in the tool (default: the hostname)
 *
 * Nothing here deletes or moves anything in RACES_DIR.
 *
 * A template uploaded in the tool (a co-branded bulk design) is not in
 * RACES_DIR: it comes with a download link and a version, and is kept in
 * worker/template-cache, fetched again when the version changes. Its copy's
 * modification time is set to the upload time, so the check runs once per
 * upload, like a Drive file that changed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluateCheck } from './lib/evaluateCheck.mjs'
import { inspectPdf } from './lib/inspectPdf.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
loadEnv(path.join(HERE, '.env'))

const URL_BASE = (process.env.FULFILLMENT_URL || '').replace(/\/$/, '')
const KEY = process.env.RENDER_API_KEY || ''
const RACES_DIR = process.env.RACES_DIR || ''
const NAME = process.env.WORKER_NAME || os.hostname()
const WORKER_ID = `${os.hostname()}-${NAME}`.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 80)
const PRESET = process.env.PDF_PRESET || 'TRACKSTAR DEFAULT'
// Asking for work is a server call each time (Vercel bills it). Fast while
// there is work, backing off to a minute when the queue is empty.
const POLL_MS = 5000
const IDLE_POLL_MAX_MS = 60000
const HEARTBEAT_MS = 30000
const ILLUSTRATOR_TIMEOUT_MS = 180000
const CHECK_TIMEOUT_MS = 600000
const CHECK_BATCH = 12
const SCRIPT = path.join(HERE, 'illustrator', 'render.jsx')
const CHECK_SCRIPT = path.join(HERE, 'illustrator', 'check.jsx')
const WORK = path.join(os.tmpdir(), 'trackstar-render')
const CACHE = path.join(HERE, 'template-cache')

if (!URL_BASE || !KEY || !RACES_DIR) { console.error('Set FULFILLMENT_URL, RENDER_API_KEY and RACES_DIR in worker/.env'); process.exit(1) }
if (!fs.existsSync(RACES_DIR)) { console.error(`RACES_DIR does not exist: ${RACES_DIR}`); process.exit(1) }
fs.mkdirSync(WORK, { recursive: true })
fs.mkdirSync(CACHE, { recursive: true })

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function log(...args) { console.log(new Date().toISOString().slice(11, 19), ...args) }

async function api(action, body) {
  const res = await fetch(`${URL_BASE}/api/render/worker`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ action, workerId: WORKER_ID, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `${action} failed (${res.status})`)
  return data
}

/** Where a template's file is on this machine: the Races folder, or the cache for an uploaded one. */
function localFile(t) {
  if (t.url || t.uploaded) return path.join(CACHE, `${t.key.replace(/[^A-Za-z0-9-]+/g, '_')}.ai`)
  return path.join(RACES_DIR, t.file)
}

/** Fetch an uploaded template when this machine has no copy of its current version. */
async function syncUploaded(templates) {
  for (const t of templates) {
    if (!t.url || !t.version) continue
    const file = localFile(t)
    const at = new Date(t.version)
    try { if (fs.statSync(file).mtime.getTime() === at.getTime()) continue } catch { /* not here yet */ }
    try {
      const res = await fetch(t.url)
      if (!res.ok) throw new Error(`download failed (${res.status})`)
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      fs.utimesSync(file, at, at)
      log(`Fetched the uploaded template ${t.key}`)
    } catch (e) { log(`Could not fetch ${t.key}: ${e.message}`) }
  }
}

/** What is on this disk for each template the tool knows about. */
function fileState(templates) {
  const files = {}
  for (const t of templates) {
    const p = localFile(t)
    try { const st = fs.statSync(p); files[t.key] = { present: true, mtime: st.mtime.toISOString() } }
    catch { files[t.key] = { present: false, mtime: null } }
  }
  return files
}

function runIllustrator(script, timeout) {
  return new Promise((resolve, reject) => {
    // AppleScript gives up on an app after two minutes unless told otherwise,
    // which is shorter than a long check run; the timeout here is the real one.
    const osa = `with timeout of ${Math.ceil(timeout / 1000)} seconds\ntell application "Adobe Illustrator" to do javascript file "${script}"\nend timeout`
    execFile('osascript', ['-e', osa], { timeout }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(err.killed ? 'Illustrator did not finish in time' : (stderr || err.message).trim()))
      resolve()
    })
  })
}

/**
 * Check the templates whose file changed since they were last checked,
 * CHECK_BATCH per Illustrator run, and report each verdict.
 */
async function checkChanged(templates, files) {
  // A few at a time: each heartbeat checks the next batch, so jobs keep
  // flowing between batches and one run never outlasts the timeout.
  const due = templates.filter(t => files[t.key]?.present && files[t.key].mtime !== t.lastCheckMtime).slice(0, CHECK_BATCH)
  if (!due.length) return
  const dir = path.join(WORK, 'check')
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  const input = due.map((t, i) => {
    const copy = path.join(dir, `${i}.ai`)
    fs.copyFileSync(localFile(t), copy)
    return { key: t.key, path: copy, race: t.key.split(' / ')[0], artboard: t.rules?.artboard || null, artboardExclude: t.rules?.artboardExclude || null, photoArtboard: t.rules?.photoArtboard || null }
  })
  log(`Checking ${due.length} template${due.length > 1 ? 's' : ''}: ${due.map(t => t.key).join(', ')}`)
  fs.writeFileSync(path.join(HERE, 'illustrator', 'check-input.json'), JSON.stringify({ files: input }))
  fs.rmSync(path.join(HERE, 'illustrator', 'check-result.json'), { force: true })
  await runIllustrator(CHECK_SCRIPT, CHECK_TIMEOUT_MS)
  const results = JSON.parse(fs.readFileSync(path.join(HERE, 'illustrator', 'check-result.json'), 'utf8'))
  for (const t of due) {
    const verdict = evaluateCheck(results.find(r => r.key === t.key), { sizes: Array.isArray(t.rules?.sizes) && t.rules.sizes.length ? t.rules.sizes : undefined })
    await api('check', { key: t.key, mtime: files[t.key].mtime, ok: verdict.ok, report: verdict })
    t.lastCheckMtime = files[t.key].mtime; t.lastCheckOk = verdict.ok
    log(`  ${verdict.ok ? 'ok  ' : 'FAIL'} ${t.key}${verdict.problems.length ? ': ' + verdict.problems.join('; ') : ''}`)
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Fetch templates, check what changed, tell the tool what this machine can render. */
async function heartbeat() {
  const { templates } = await api('templates', {})
  await syncUploaded(templates)
  const files = fileState(templates)
  try { await checkChanged(templates, files) } catch (e) { log(`Template check failed: ${e.message}`) }
  const renderable = templates.filter(t => files[t.key]?.present && t.lastCheckOk).map(t => t.key)
  await api('heartbeat', { name: NAME, templates: renderable, files })
  return renderable
}

async function download(url, to) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download (${res.status})`)
  fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()))
}

// Supabase Storage has saved a file and then never answered (a 504 after
// 60s, 2026-11-02). That is not a failure here: the tool checks the files are
// really there when the job is completed (completeJob), and fails it if not.
async function upload(url, file, contentType) {
  let res
  try {
    res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: fs.readFileSync(file), signal: AbortSignal.timeout(90000) })
  } catch (e) {
    if (e.name !== 'TimeoutError') throw e
    log(`  no answer from storage for ${path.basename(file)}; the tool will check it landed`)
    return
  }
  if (res.status === 504) { log(`  storage timed out on ${path.basename(file)}; the tool will check it landed`); return }
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
}

async function render(job) {
  const { spec, template: tpl } = job
  if (!tpl) throw new Error(`No template for ${spec.template || spec.race}`)
  const src = localFile(tpl)
  const dir = path.join(WORK, job.id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  // A copy of the production file, so the live one is never opened or touched.
  const template = path.join(dir, 'template.ai')
  fs.copyFileSync(src, template)

  let photo = null
  if (job.photoUrl) { photo = path.join(dir, 'photo' + (path.extname(spec.photoPath || '') || '.jpg')); await download(job.photoUrl, photo) }

  const out = path.join(dir, spec.file)
  const rules = tpl.rules || {}
  const current = { template, out, preset: PRESET, artboard: rules.artboard || null, artboardExclude: rules.artboardExclude || null, photoArtboard: rules.photoArtboard || null, spec: { ...spec, photo } }
  fs.writeFileSync(path.join(HERE, 'illustrator', 'current.json'), JSON.stringify(current))
  fs.rmSync(path.join(HERE, 'illustrator', 'result.json'), { force: true })

  await runIllustrator(SCRIPT, ILLUSTRATOR_TIMEOUT_MS)
  const resultFile = path.join(HERE, 'illustrator', 'result.json')
  if (!fs.existsSync(resultFile)) throw new Error('Illustrator ran but wrote no result')
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
  if (!result.ok) throw new Error(result.error || 'Illustrator reported a failure')
  if (!fs.existsSync(out + '.pdf') || !fs.existsSync(out + '.png')) throw new Error('Illustrator finished but the files are missing')

  // Measure the PDF itself: trim, bleed on each side, CMYK or not.
  let output = null
  try { output = inspectPdf(out + '.pdf') } catch (e) { log(`  could not inspect the PDF: ${e.message}`) }
  await upload(job.pdfUploadUrl, out + '.pdf', 'application/pdf')
  await upload(job.previewUploadUrl, out + '.png', 'image/png')
  fs.rmSync(dir, { recursive: true, force: true })
  return { notes: result.notes || '', output }
}

async function main() {
  log(`Render worker "${NAME}" (${WORKER_ID}) -> ${URL_BASE}`)
  // The tool may be mid-deploy or the Mac may be offline; keep trying rather than exiting.
  let list
  for (;;) {
    try { list = await heartbeat(); break } catch (e) { log(`Cannot reach the tool yet (${e.message}); retrying`); await sleep(15000) }
  }
  log(`Renderable on this machine: ${list.length ? list.join(', ') : 'none'}`)
  // Alongside the render queue: page fetches the tool cannot make itself.
  relayLoop().catch(e => log(`Relay loop stopped: ${e.message}`))
  let lastBeat = Date.now(), idle = POLL_MS
  for (;;) {
    try {
      if (Date.now() - lastBeat > HEARTBEAT_MS) { list = await heartbeat(); lastBeat = Date.now() }
      const { job } = await api('claim', {})
      if (!job) { await sleep(idle); idle = Math.min(idle * 2, IDLE_POLL_MAX_MS); continue }
      idle = POLL_MS
      log(`Job ${job.id}: ${job.spec.file} (${job.spec.size}${job.spec.photoPath ? ', photo' : ''}${job.spec.noTime ? ', no time' : ''})`)
      try {
        const { notes, output } = await render(job)
        await api('complete', { jobId: job.id, notes, output })
        log(`  done${notes ? `: ${notes}` : ''}${output ? ` [${output.trimIn}, bleed ${output.bleedIn?.left}", ${output.color}]` : ''}`)
      } catch (e) {
        log(`  FAILED: ${e.message}`)
        await api('fail', { jobId: job.id, error: e.message }).catch(err => log(`  (could not report failure: ${err.message})`))
      }
    } catch (e) {
      log(`Error: ${e.message}`)
      await sleep(POLL_MS * 2)
    }
  }
}

/**
 * Page fetches the tool cannot make itself: some timing sites refuse cloud
 * addresses but serve this Mac fine (TrueTime). The tool queues the request,
 * this loop fetches it and posts the page back. Only the hosts listed here,
 * whatever the tool asks for.
 */
const RELAY_HOSTS = (process.env.RELAY_HOSTS || 'results.truetimeracing.com').split(',').map(h => h.trim()).filter(Boolean)
const RELAY_POLL_MS = 3000
async function relayLoop() {
  for (;;) {
    let relays = []
    try { ({ relays = [] } = await api('relayClaim', {})) } catch { await sleep(15000); continue }
    for (const r of relays) {
      let host = ''
      try { host = new URL(r.url).host } catch { /* refused below */ }
      if (!RELAY_HOSTS.includes(host)) { await api('relayDone', { id: r.id, error: `not a relay host: ${host}` }).catch(() => {}); continue }
      try {
        const res = await fetch(r.url, { method: r.method || 'GET', headers: r.headers || {}, body: r.body || undefined, redirect: 'follow' })
        const body = await res.text()
        const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
        await api('relayDone', { id: r.id, status: res.status, body, setCookies })
        log(`Relayed ${r.method || 'GET'} ${host}: ${res.status}`)
      } catch (e) {
        await api('relayDone', { id: r.id, error: e.message }).catch(() => {})
        log(`Relay failed for ${host}: ${e.message}`)
      }
    }
    await sleep(relays.length ? 300 : RELAY_POLL_MS)
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

main()
