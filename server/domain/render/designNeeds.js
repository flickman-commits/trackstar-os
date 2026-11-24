/**
 * Design Needs: what the designer has to fix in a production file so the
 * render script can make a print. Settings > Design Needs lists them, and
 * whoever fixes one checks it off.
 *
 * Four ways in:
 *   auto    found from the open standard orders the script is stuck on for a
 *           file reason: no production file for the race or event, no NO TIME
 *           layer, no photo window, a render that failed on the file. One
 *           need per file and size, with the orders waiting on it. A template
 *           whose last check failed is one too.
 *   reject  a design rejected as a file problem (the reviewer says so; a
 *           wrong bib or time is a data problem and never lands here).
 *           Checking one off renders that order again.
 *   manual  written by a person.
 *   support what a customer said about a design in Support, marked Customer
 *           suggestion (support/designFeedback.js): something to consider, not
 *           a to-do. Dismissing one keeps the row, hidden, so it does not come
 *           back when the next customer says the same.
 *
 * syncDesignNeeds keeps the auto ones current. An open auto need the tool no
 * longer sees closes itself. A checked-off one reopens only when the file was
 * checked again after it was checked off and still has the problem; until the
 * worker re-checks, the person's word stands. A missing production file that
 * was checked off waits on an admin adding it under Settings > Designs, so it
 * says that instead of going back on the designer's list.
 */
import prisma from '../../db.js'
import { loadPipelineContext, pipelinesFor } from '../orders/pipelineStatus.js'
import { resolveTemplate } from './spec.js'
import { ensureOverridesLoaded } from '../../scrapers/scraperOverrides.js'
import { createJob } from './jobs.js'

export class DesignNeedError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const KINDS = {
  production_file: 'Production file',
  no_time_layer: 'NO TIME layer',
  photo_window: 'Photo window',
  file_problem: 'File problem',
  rejected: 'Rejected design',
  customer_suggestion: 'Customer suggestion',
  other: 'Other',
}

const SYNC_KEY = 'design_needs_synced_at'
const SYNC_EVERY_MS = 2 * 60_000

// A render that failed on something in the file, not on the order's data or the machine.
const FILE_ERROR = /frame|artboard|photo window|name moved|runs into the photo|NO TIME layer/i

function number(o) {
  const n = o.name ? String(o.name).replace(/^#/, '') : String(o.parentOrderNumber || o.orderNumber)
  return o.lineItemIndex ? `${n}-${o.lineItemIndex + 1}` : n
}

/** What the open orders are stuck on, by need key. */
async function detect() {
  await ensureOverridesLoaded()
  const ctx = await loadPipelineContext()
  const open = await prisma.order.findMany({ where: { trackstarOrderType: 'standard', status: { notIn: ['completed', 'flagged'] } }, select: { id: true } })
  if (!open.length) return new Map()
  const pipelines = await pipelinesFor(open.map(o => o.id))
  const FILE_REASONS = new Set(['Needs a production file', 'Needs NO TIME layer', 'Make by hand', 'Render failed'])
  const stuck = [...pipelines].filter(([, p]) => p.stage === 'action' && FILE_REASONS.has(p.reason)).map(([id]) => id)
  // Only the stuck orders need the full rows (the edition is read off the Shopify line item).
  const orders = stuck.length ? await prisma.order.findMany({
    where: { id: { in: stuck } },
    select: {
      id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, raceName: true, raceNameOverride: true,
      productSize: true, hadNoTime: true, photoPath: true, shopifyOrderData: true, arteloOrderData: true,
      runnerResearch: { orderBy: { createdAt: 'desc' }, select: { researchStatus: true, eventType: true } },
      renderJobs: { orderBy: { version: 'desc' }, take: 1, select: { status: true, error: true, spec: true } },
    },
  }) : []
  const nameOf = new Map(orders.map(o => [o.id, o.shopifyOrderData?.name || null]))

  const found = new Map()
  const add = (key, need, o) => {
    const n = found.get(key) || { ...need, orders: [] }
    n.orders.push({ id: o.id, number: number({ ...o, name: nameOf.get(o.id) }) })
    found.set(key, n)
  }
  for (const o of orders) {
    const p = pipelines.get(o.id)
    if (!p || p.stage !== 'action') continue
    const raceName = o.raceNameOverride ?? o.raceName
    const research = o.runnerResearch.find(r => r.researchStatus === 'found') || o.runnerResearch[0] || null
    const template = resolveTemplate(o, raceName, research?.eventType, k => ctx.templateKeys.has(k))
    const size = o.productSize
    if (p.reason === 'Needs a production file') {
      add(`file|${template}`, { kind: 'production_file', title: `${template}: production file`, template, size: null, detail: `There is no production file for ${template}. Make it, put it in the race's Illustrator Files folder, and tell Matt so he adds it under Settings > Designs.` }, o)
    } else if (p.reason === 'Needs NO TIME layer') {
      add(`notime|${template}|${size}`, { kind: 'no_time_layer', title: `${template} ${size}: NO TIME layer`, template, size, detail: `Details sit to the right of pace on the ${size} artboard, so a print with no finish time cannot render. Add a hidden NO TIME layer with the details laid out without time and pace (worker/README.md).` }, o)
    } else if (p.reason === 'Make by hand' && o.photoPath && /no photo window/i.test(p.fix || '')) {
      add(`photo|${template}|${size}`, { kind: 'photo_window', title: `${template} ${size}: photo window`, template, size, detail: `The ${size} design has no photo window, so a print with a customer photo cannot render. Add the square photo window on PHOTO LAYER, as on the other photo designs.` }, o)
    } else if (p.reason === 'Render failed' && FILE_ERROR.test(o.renderJobs[0]?.error || '')) {
      const err = String(o.renderJobs[0].error).replace(/^\[\w+\]\s*/, '')
      const t = o.renderJobs[0].spec?.template || template
      add(`render|${t}|${size}|${err.slice(0, 80)}`, { kind: 'file_problem', title: `${t} ${size}: ${err.slice(0, 90)}`, template: t, size, detail: `The render stopped on the file: ${err}` }, o)
    }
  }

  // A production file whose last check failed stops every order of that race.
  const failed = await prisma.printTemplate.findMany({ where: { enabled: true, lastCheckOk: false }, select: { key: true, lastCheckReport: true } })
  for (const t of failed) {
    const problems = (t.lastCheckReport?.problems || []).join('; ') || 'the check failed'
    found.set(`check|${t.key}`, { kind: 'file_problem', title: `${t.key}: file check failed`, template: t.key, size: null, detail: `The worker checked the file and it cannot render: ${problems}.`, orders: found.get(`check|${t.key}`)?.orders || [] })
  }
  return found
}

async function templateCheckedAt(template) {
  if (!template) return null
  const t = await prisma.printTemplate.findUnique({ where: { key: template }, select: { lastCheckAt: true } })
  return t?.lastCheckAt || null
}

/** Bring the auto needs up to date with what the orders are stuck on. */
export async function syncDesignNeeds() {
  const found = await detect()
  const now = new Date()
  const existing = await prisma.designNeed.findMany({ where: { source: 'auto' } })
  const byKey = new Map(existing.map(n => [n.key, n]))

  for (const [key, n] of found) {
    const row = byKey.get(key)
    const data = { kind: n.kind, title: n.title, template: n.template, size: n.size, detail: n.detail, orders: n.orders, lastSeenAt: now }
    if (!row) {
      await prisma.designNeed.create({ data: { key, source: 'auto', ...data } })
      continue
    }
    if (row.status === 'open') { await prisma.designNeed.update({ where: { id: row.id }, data }); continue }
    // Checked off. Reopen only if the file was checked again since and still has it.
    const checkedAt = await templateCheckedAt(n.template)
    if (n.kind !== 'production_file' && checkedAt && row.doneAt && checkedAt > row.doneAt) {
      await prisma.designNeed.update({ where: { id: row.id }, data: { ...data, status: 'open', note: `Reopened: the file was checked again on ${checkedAt.toISOString().slice(0, 10)} and still has this problem.` } })
    } else if (n.kind === 'production_file') {
      await prisma.designNeed.update({ where: { id: row.id }, data: { ...data, note: 'Checked off. Waiting on Matt to add the file under Settings > Designs.' } })
    } else {
      await prisma.designNeed.update({ where: { id: row.id }, data })
    }
  }

  // Open auto needs the tool no longer sees close themselves.
  for (const row of existing) {
    if (row.status !== 'open' || found.has(row.key)) continue
    await prisma.designNeed.update({ where: { id: row.id }, data: { status: 'done', doneAt: now, doneByName: 'TrackstarOS', orders: [], note: 'Closed by the tool: no order is stuck on it any more.' } })
  }
  // A checked-off file need that is no longer seen has nothing left to wait on.
  for (const row of existing) {
    if (row.status === 'done' && !found.has(row.key) && row.note?.startsWith('Checked off. Waiting on Matt')) {
      await prisma.designNeed.update({ where: { id: row.id }, data: { note: 'Added under Settings > Designs.', orders: [] } })
    }
  }
  await prisma.systemConfig.upsert({ where: { key: SYNC_KEY }, update: { value: now.toISOString() }, create: { key: SYNC_KEY, value: now.toISOString() } })
  return { seen: found.size }
}

/** Sync when the last one is a couple of minutes old, so opening the list is current without a sync per view. */
export async function syncIfStale() {
  const row = await prisma.systemConfig.findUnique({ where: { key: SYNC_KEY } })
  if (row?.value && Date.now() - new Date(row.value).getTime() < SYNC_EVERY_MS) return null
  return syncDesignNeeds()
}

const SHOW = { id: true, kind: true, title: true, template: true, size: true, detail: true, orders: true, source: true, status: true, note: true, createdByName: true, doneAt: true, doneByName: true, createdAt: true, renderJobId: true }

export async function listDesignNeeds() {
  const [open, done] = await Promise.all([
    prisma.designNeed.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'asc' }, select: SHOW }),
    prisma.designNeed.findMany({ where: { status: 'done' }, orderBy: { doneAt: 'desc' }, take: 60, select: SHOW }),
  ])
  return { open, done, kinds: KINDS }
}

function personName(actor) {
  return actor?.firstName || actor?.name || actor?.email || 'Someone'
}

/**
 * Check a need off, or put it back. A rejected design that is checked off
 * renders its order again from the fixed file (the reviewer looks at the new one).
 */
export async function setDone({ id, done, actor }) {
  const row = await prisma.designNeed.findUnique({ where: { id: String(id || '') } })
  if (!row) throw new DesignNeedError('That design need is gone', 404)
  if (!done) {
    return prisma.designNeed.update({ where: { id: row.id }, data: { status: 'open', doneAt: null, doneById: null, doneByName: null, note: null }, select: SHOW })
  }
  let note = null
  if (row.kind === 'rejected') {
    const orderId = row.orders?.[0]?.id
    if (orderId) {
      try { await createJob({ orderId, requestedBy: 'admin', requestedById: actor?.id || null }); note = 'Checked off; the order is rendering again from the fixed file.' }
      catch (e) { note = `Checked off. Could not render the order again: ${String(e.message).slice(0, 160)}` }
    }
  }
  return prisma.designNeed.update({
    where: { id: row.id },
    data: { status: 'done', doneAt: new Date(), doneById: actor?.id || null, doneByName: personName(actor), note },
    select: SHOW,
  })
}

export async function addDesignNeed({ title, template, size, detail, actor }) {
  const t = String(title || '').trim()
  if (!t) throw new DesignNeedError('Say what needs doing')
  return prisma.designNeed.create({
    data: {
      key: `manual|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, kind: 'other', source: 'manual',
      title: t.slice(0, 200), template: String(template || '').trim().slice(0, 120) || null, size: String(size || '').trim().slice(0, 20) || null,
      detail: String(detail || '').trim().slice(0, 2000) || null, createdById: actor?.id || null, createdByName: personName(actor),
    },
    select: SHOW,
  })
}

export async function deleteDesignNeed({ id, actor }) {
  const row = await prisma.designNeed.findUnique({ where: { id: String(id || '') } })
  if (!row) throw new DesignNeedError('That design need is gone', 404)
  if (row.source === 'auto') throw new DesignNeedError('The tool found this one; it closes itself once no order is stuck on it. Check it off if it is fixed.')
  if (row.source === 'support') await prisma.designNeed.update({ where: { id: row.id }, data: { status: 'dismissed', doneAt: new Date(), doneByName: personName(actor), doneById: actor?.id || null } })
  else await prisma.designNeed.delete({ where: { id: row.id } })
  return { ok: true, title: row.title, dismissed: row.source === 'support' }
}

/** A design rejected as a file problem: the designer's list gets it, with the order and the note. */
export async function needFromRejection({ job, order, note, actor }) {
  const label = order ? number(order) : null
  return prisma.designNeed.upsert({
    where: { key: `reject|${job.id}` },
    update: { detail: note || null },
    create: {
      key: `reject|${job.id}`, kind: 'rejected', source: 'reject', renderJobId: job.id,
      title: `${job.spec?.template || job.spec?.race || 'Design'} ${job.spec?.size || ''}: ${String(note || 'rejected').slice(0, 90)}`.replace(/\s+/g, ' ').trim(),
      template: job.spec?.template || null, size: job.spec?.size || null,
      detail: `Rejected${label ? ` on order ${label}` : ''} (${job.spec?.file || 'v' + job.version}): ${note || 'no note'}. Fix the file; checking this off renders the order again.`,
      orders: order ? [{ id: order.id, number: label }] : [],
      createdById: actor?.id || null, createdByName: personName(actor),
    },
  })
}
