/**
 * Print templates: which production file renders which race design, and
 * whether it is ready. See the PrintTemplate model. The worker reads the
 * list from here, checks any file that changed, and reports back; the
 * Settings panel shows the same list with volume and worker presence.
 */
import prisma from '../../db.js'
import { storage } from '../../lib/storage.js'

const ONLINE_MS = 90_000
export async function onlineWorkers() {
  return prisma.renderWorker.findMany({ where: { lastSeenAt: { gte: new Date(Date.now() - ONLINE_MS) } }, orderBy: { name: 'asc' } })
}

export const RACES_FOLDER_URL = 'https://drive.google.com/drive/folders/105nWHD5sRlcLov7BexM2h5TTlpSPmlwq'

export function templateKey(raceName, edition) {
  return edition ? `${raceName} / ${edition}` : raceName
}

/** A Drive search for the file by name: there is no stable file id without an API round trip per file. */
export function driveSearchLink(file) {
  const name = String(file || '').split('/').pop()
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(`"${name}"`)}`
}

export async function listTemplates() {
  return prisma.printTemplate.findMany({ orderBy: [{ raceName: 'asc' }, { edition: 'asc' }] })
}

/**
 * What the worker needs to render and to check: enabled templates with their
 * files and rules. An uploaded file (storagePath) comes with a download link
 * and its version; the worker keeps a copy and fetches it again when the
 * version changes.
 */
export async function templatesForWorker() {
  const rows = await prisma.printTemplate.findMany({ where: { enabled: true }, orderBy: { key: 'asc' } })
  // A co-branded bulk file only has to cover its run's size (the worker's check reads rules.sizes).
  const runs = rows.filter(t => /^BULK-/.test(t.edition || ''))
  const sizeOf = new Map(runs.length ? (await prisma.bulkOrder.findMany({ where: { number: { in: runs.map(t => t.edition) } }, select: { number: true, productSize: true } })).map(b => [b.number, b.productSize]) : [])
  return Promise.all(rows.map(async t => ({
    key: t.key, file: t.file, rules: { ...(t.rules || {}), ...(sizeOf.get(t.edition) ? { sizes: [String(sizeOf.get(t.edition)).replace(/^x/, '')] } : {}) }, lastCheckMtime: t.lastCheckMtime, lastCheckOk: t.lastCheckOk,
    ...(t.storagePath ? { url: await templateDownloadUrl(t.storagePath), version: t.fileVersion } : {}),
  })))
}

// Production files uploaded in the tool: private, read by the worker through a signed link.
export const TEMPLATE_BUCKET = 'print-templates'

async function templateDownloadUrl(path) {
  const { data, error } = await storage().storage.from(TEMPLATE_BUCKET).createSignedUrl(path, 3600)
  if (error) return null
  return data.signedUrl
}

async function ensureTemplateBucket() {
  const sb = storage().storage
  const { data } = await sb.getBucket(TEMPLATE_BUCKET)
  if (!data) await sb.createBucket(TEMPLATE_BUCKET, { public: false })
}

/**
 * Where a co-branded line's production file goes: a signed upload link into
 * the private bucket. The template's key is the race and the line's run
 * number (e.g. "Philadelphia Marathon / BULK-0012"), which spec.js resolves
 * for that run's runners.
 */
export async function uploadTemplateUrl(runNumber, fileName) {
  if (!/\.ai$/i.test(String(fileName || ''))) throw Object.assign(new Error('Upload the Illustrator file (.ai)'), { expose: true, status: 400 })
  await ensureTemplateBucket()
  const path = `cobranded/${String(runNumber).replace(/[^A-Za-z0-9-]/g, '')}/${Date.now()}.ai`
  const { data, error } = await storage().storage.from(TEMPLATE_BUCKET).createSignedUploadUrl(path)
  if (error) throw new Error(error.message)
  return { path, uploadUrl: data.signedUrl }
}

/** The uploaded file is in place: point the run's template at it and have it checked again. */
export async function saveUploadedTemplate({ raceName, runNumber, path, notes }) {
  const key = templateKey(raceName, runNumber)
  const data = {
    raceName, edition: runNumber, file: `Uploaded / ${runNumber}.ai`, storagePath: String(path), fileVersion: new Date().toISOString(),
    lastCheckAt: null, lastCheckOk: null, lastCheckReport: null, lastCheckMtime: null, ...(notes ? { notes } : {}),
  }
  return prisma.printTemplate.upsert({ where: { key }, update: { ...data, enabled: true }, create: { key, ...data, enabled: true } })
}

// A Mac that checked in this recently still counts for queueing: it is
// asleep or closed, not gone, and its jobs wait in the queue until it is back.
const KNOWN_MS = 30 * 24 * 60 * 60_000
async function knownWorkers() {
  return prisma.renderWorker.findMany({ where: { lastSeenAt: { gte: new Date(Date.now() - KNOWN_MS) } } })
}

/**
 * Keys a render can be queued for: the template is enabled, its last check
 * passed, and a worker seen in the last 30 days reports the file present.
 * The worker does not have to be online now; a job queued while every Mac is
 * off waits and renders when one checks in (claimNext).
 */
export async function availableTemplateKeys() {
  const [workers, templates] = await Promise.all([knownWorkers(), prisma.printTemplate.findMany({ where: { enabled: true, lastCheckOk: true }, select: { key: true } })])
  const ok = new Set(templates.map(t => t.key))
  const out = new Set()
  for (const w of workers) {
    const files = w.files && typeof w.files === 'object' ? w.files : {}
    for (const key of ok) if (files[key]?.present) out.add(key)
  }
  return [...out]
}

/**
 * "key|size" for each template size where a no-time order cannot print yet:
 * details sit to the right of pace and the file has no NO TIME layer
 * (worker/lib/evaluateCheck.mjs).
 */
export async function noTimeGaps() {
  const rows = await prisma.printTemplate.findMany({ where: { enabled: true, lastCheckOk: true }, select: { key: true, lastCheckReport: true } })
  const out = new Set()
  for (const r of rows) for (const [size, v] of Object.entries(r.lastCheckReport?.sizes || {})) {
    if (v?.noTime === 'needs NO TIME layout') out.add(`${r.key}|${size}`)
    // The same set carries designs with no photo window, as "photo|template|size".
    if (v && v.photoWindow === false) out.add(`photo|${r.key}|${size}`)
  }
  return out
}

export async function upsertTemplate({ key, raceName, edition, file, rules, enabled, notes }) {
  const k = String(key || templateKey(raceName, edition)).trim()
  if (!k) throw new Error('A template needs a race')
  const data = {
    raceName: String(raceName || k.split(' / ')[0]).trim(),
    edition: edition ? String(edition).trim() : (k.includes(' / ') ? k.split(' / ')[1] : null),
    file: String(file || '').trim().replace(/^\/+/, ''),
    rules: rules && typeof rules === 'object' && Object.keys(rules).length ? rules : null,
    ...(enabled === undefined ? {} : { enabled: Boolean(enabled) }),
    ...(notes === undefined ? {} : { notes: notes ? String(notes).slice(0, 1000) : null }),
  }
  if (!data.file) throw new Error('Give the production file path, relative to the Races folder')
  const existing = await prisma.printTemplate.findUnique({ where: { key: k } })
  // A new file means the old check no longer applies.
  const fileChanged = existing && existing.file !== data.file
  return prisma.printTemplate.upsert({
    where: { key: k },
    update: { ...data, ...(fileChanged ? { lastCheckAt: null, lastCheckOk: null, lastCheckReport: null, lastCheckMtime: null } : {}) },
    create: { key: k, ...data, enabled: enabled === undefined ? true : Boolean(enabled) },
  })
}

export async function setTemplateEnabled(key, enabled) {
  return prisma.printTemplate.update({ where: { key: String(key) }, data: { enabled: Boolean(enabled) } })
}

export async function deleteTemplate(key) {
  return prisma.printTemplate.delete({ where: { key: String(key) } })
}

/** Forget the last check of a file, so the next worker to check in runs it again. */
export async function recheckTemplate(key) {
  return prisma.printTemplate.update({ where: { key: String(key) }, data: { lastCheckMtime: null, lastCheckOk: null, lastCheckAt: null } })
}

/** A worker checked a file. Keep the verdict and the mtime it applies to. */
export async function recordCheck({ key, mtime, ok, report, workerId }) {
  return prisma.printTemplate.update({
    where: { key: String(key) },
    data: { lastCheckAt: new Date(), lastCheckOk: Boolean(ok), lastCheckReport: report || null, lastCheckMtime: mtime ? String(mtime) : null, lastCheckWorker: workerId ? String(workerId) : null },
  })
}

/** One-time import of worker/templates.json into the table. Existing keys are left alone. */
export async function seedTemplates(map) {
  let added = 0
  for (const [key, v] of Object.entries(map)) {
    if (key.startsWith('_')) continue
    const t = typeof v === 'string' ? { file: v } : v
    const exists = await prisma.printTemplate.findUnique({ where: { key } })
    if (exists) continue
    const [raceName, edition] = key.split(' / ')
    const rules = {}
    for (const r of ['artboard', 'artboardExclude', 'photoArtboard']) if (t[r]) rules[r] = t[r]
    await prisma.printTemplate.create({ data: { key, raceName, edition: edition || null, file: t.file, rules: Object.keys(rules).length ? rules : null } })
    added++
  }
  return added
}

/**
 * The Settings panel's view: every template with its status, plus the
 * races with open orders that have no template yet, by volume.
 */
export async function templatesOverview() {
  const since = new Date(Date.now() - 180 * 86400000)
  const [templates, workers, openByRace, recentByRace, jobsByTemplate] = await Promise.all([
    listTemplates(),
    // A machine not seen for a month is gone (a renamed laptop leaves its old row behind).
    prisma.renderWorker.findMany({ where: { lastSeenAt: { gte: new Date(Date.now() - 30 * 86400000) } }, orderBy: { lastSeenAt: 'desc' } }),
    prisma.order.groupBy({ by: ['raceName'], where: { trackstarOrderType: 'standard', status: { notIn: ['completed'] } }, _count: true }),
    prisma.order.groupBy({ by: ['raceName'], where: { trackstarOrderType: 'standard', createdAt: { gte: since } }, _count: true }),
    prisma.renderJob.groupBy({ by: ['status'], _count: true }),
  ])
  const online = new Set(workers.filter(w => Date.now() - new Date(w.lastSeenAt).getTime() < 90_000).map(w => w.id))
  const open = Object.fromEntries(openByRace.map(r => [r.raceName, r._count]))
  const recent = Object.fromEntries(recentByRace.map(r => [r.raceName, r._count]))

  // Renders per template key, from the job specs (one query, counted here).
  const jobs = await prisma.renderJob.findMany({ select: { spec: true, status: true, review: true }, where: { createdAt: { gte: since } } })
  const perKey = {}
  for (const j of jobs) {
    const k = j.spec?.template || j.spec?.race
    if (!k) continue
    perKey[k] ||= { rendered: 0, approved: 0, rejected: 0, failed: 0 }
    if (j.status === 'done') perKey[k].rendered++
    if (j.status === 'failed') perKey[k].failed++
    if (j.review === 'approved') perKey[k].approved++
    if (j.review === 'rejected') perKey[k].rejected++
  }

  const rows = templates.map(t => {
    const presentOn = workers.filter(w => w.files && w.files[t.key]?.present).map(w => ({ id: w.id, name: w.name, online: online.has(w.id), mtime: w.files[t.key].mtime }))
    const onlineWith = presentOn.filter(w => w.online)
    const status = !t.enabled ? 'disabled'
      : t.lastCheckOk === false ? 'problems'
      : t.lastCheckOk == null ? (presentOn.length ? 'checking' : 'no_file')
      : onlineWith.length ? 'ready' : (presentOn.length ? 'offline' : 'no_file')
    return {
      key: t.key, raceName: t.raceName, edition: t.edition, file: t.file, rules: t.rules, enabled: t.enabled, notes: t.notes,
      driveLink: driveSearchLink(t.file), status,
      lastCheckAt: t.lastCheckAt, lastCheckOk: t.lastCheckOk, report: t.lastCheckReport, lastCheckWorker: t.lastCheckWorker,
      workers: presentOn, openOrders: open[t.raceName] || 0, orders180d: recent[t.raceName] || 0, renders: perKey[t.key] || { rendered: 0, approved: 0, rejected: 0, failed: 0 },
    }
  })
  const mapped = new Set(templates.map(t => t.raceName))
  const unmapped = Object.keys({ ...recent, ...open })
    .filter(r => !mapped.has(r))
    .map(r => ({ raceName: r, openOrders: open[r] || 0, orders180d: recent[r] || 0 }))
    .sort((a, b) => b.orders180d - a.orders180d)
  const queue = Object.fromEntries(jobsByTemplate.map(j => [j.status, j._count]))
  return {
    templates: rows,
    unmapped,
    workers: workers.map(w => ({ id: w.id, name: w.name, lastSeenAt: w.lastSeenAt, online: online.has(w.id), templates: Array.isArray(w.templates) ? w.templates.length : 0, files: w.files ? Object.values(w.files).filter(f => f?.present).length : 0 })),
    queue,
    racesFolder: RACES_FOLDER_URL,
  }
}
