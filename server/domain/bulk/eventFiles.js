/**
 * A co-branded run's production files: one for the race's main event, and one
 * for each other event its runners ran (render/spec.js templateFor). Keys are
 * "<race> / BULK-0005" and "<race> / BULK-0005 / Half Marathon".
 */
import prisma from '../../db.js'
import { templateKey } from '../render/templates.js'
import { eventLabel, eventPart } from '../render/spec.js'
import { isMainEvent } from '../../scrapers/index.js'

/** "Full 5, Half 5, 10K 3" -> ['Marathon', 'Half Marathon', '10K'] */
export function soldEvents(events) {
  return String(events || '').split(',').map(e => e.trim().replace(/\s+\d+$/, '')).filter(Boolean).map(e => (/^full/i.test(e) ? 'Marathon' : eventLabel(e)))
}

/**
 * The files a run needs: the main event (event null), then the others.
 * Once results are in, the runners say which events; before that, what was sold.
 * @param runnerEvents  the event of each runner with a result
 */
export function eventFilesNeeded({ raceName, events }, runnerEvents = [], uploaded = []) {
  const known = runnerEvents.length ? runnerEvents : soldEvents(events)
  const parts = known.map(e => eventPart(raceName, e))
  const others = [...new Set([...parts, ...uploaded].filter(Boolean))].sort()
  const count = ev => (runnerEvents.length ? runnerEvents.filter(e => eventPart(raceName, e) === ev).length : null)
  const main = { event: null, label: isMainEvent(raceName, 'Marathon') ? 'Marathon' : raceName, runners: count(null) }
  // The main file is listed unless nobody ran it.
  const list = others.map(ev => ({ event: ev, label: ev, runners: count(ev) }))
  return parts.length && !parts.includes(null) && !uploaded.includes(null) ? list : [main, ...list]
}

/** A run's files with each one's check. */
export async function eventFiles(run) {
  const base = templateKey(run.raceName, run.number)
  const [rows, runners] = await Promise.all([
    prisma.printTemplate.findMany({ where: { OR: [{ key: base }, { key: { startsWith: `${base} / ` } }] }, select: { key: true, fileVersion: true, lastCheckAt: true, lastCheckOk: true, lastCheckReport: true } }),
    prisma.order.findMany({ where: { bulkOrderId: run.id, bulkDnfAt: null }, select: { runnerResearch: { where: { researchStatus: 'found' }, select: { eventType: true }, take: 1, orderBy: { id: 'desc' } } } }),
  ])
  const eventOf = key => (key === base ? null : key.slice(base.length + 3))
  const ran = runners.map(r => r.runnerResearch[0]?.eventType).filter(Boolean)
  return eventFilesNeeded(run, ran, rows.map(r => eventOf(r.key))).map(f => {
    const t = rows.find(r => eventOf(r.key) === f.event)
    return { ...f, file: t ? { uploadedAt: t.fileVersion, checkedAt: t.lastCheckAt, ok: t.lastCheckOk, problems: t.lastCheckReport?.problems || [] } : null }
  })
}
