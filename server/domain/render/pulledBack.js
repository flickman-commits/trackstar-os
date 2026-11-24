/**
 * A print we sent that someone pulled back in Artelo (Hold there, usually
 * with the image disconnected), so it can still be changed (Matt, 2026-11-24:
 * "in production" often has not been printed yet). TrackstarOS used to go on
 * calling it sent: the order stayed complete, and a corrected design was
 * taken for a reprint and never sent (10862, 10873, 10920, 10926, 10932).
 *
 * Pulling back undoes our half. The sent mark comes off the design, which
 * becomes Held, and the order opens again. Held, not waiting for review, so
 * the old design is not approved and sent again before the change is made:
 * Send now releases it as it is, and an edit to the order closes it and
 * renders a new one, which sends like any other.
 *
 * Noticed two ways: the import, from the Artelo orders it already reads
 * (pullBackHeld), and Re-open Order, for right now (pullBackIfHeld). Artelo
 * is asked again before anything is undone, and only an order waiting there
 * counts: one that is being made is never touched. An address review or a
 * failed charge is Artelo's own hold, with its design still on it, and stays
 * with arteloMismatch.js. Standard orders only; a custom print is told to Slack.
 */
import prisma from '../../db.js'
import { call } from './artelo.js'
import { closeOutdatedDesigns } from './jobs.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { slackTo, slackText, slackLink } from '../../lib/slack.js'
import { orderAppUrl } from '../../lib/links.js'

/** Who holds the design, as the order reads it: "Held by a hold in Artelo". */
export const HELD_IN_ARTELO = 'a hold in Artelo'
// Our own send takes a moment to show at Artelo; a page read before it must not undo it.
const SETTLED_MS = 30 * 60_000
const TOLD_KEY = 'artelo_pulled_back_told'

/**
 * Whether Artelo has this order back with us. `sure`: only the states a
 * pull-back leaves (for the import, which acts on its own); without it, any
 * wait that is not Artelo's own. Pure.
 */
export function isPulledBack(live, { sure = false } = {}) {
  if (live?.status !== 'PendingFulfillmentAction') return false
  const why = String(live.productionStatus || '')
  if (/address|unpaid|payment|billing/i.test(why)) return false
  return sure ? /missing design|pending approval|hold/i.test(why) : true
}

/**
 * What to do with one print's designs. Pure. `jobs` newest first.
 * The sent design is held, unless a newer one is already waiting: then that
 * one carries on and the sent one is closed.
 */
export function planPullBack(jobs) {
  const prints = (jobs || []).filter(j => !j.spec?.altSize)
  const sent = prints.filter(j => j.arteloSentAt)
  if (!sent.length) return null
  const [newest, ...older] = sent
  const newer = prints.some(j => j.version > newest.version && j.status === 'done' && ['pending', 'approved'].includes(j.review))
  return { hold: newer ? null : newest, close: newer ? sent : older }
}

const rowsOf = async (db, parentOrderNumber, arteloId) => (await db.order.findMany({
  where: { parentOrderNumber, bulkOrderId: null },
  select: {
    id: true, orderNumber: true, lineItemIndex: true, status: true, trackstarOrderType: true, runnerName: true, shopifyOrderData: true, arteloOrderData: true,
    runnerResearch: { orderBy: { id: 'desc' }, take: 1, select: { researchStatus: true } },
    renderJobs: { orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, review: true, spec: true, arteloSentAt: true } },
  },
})).filter(r => r.arteloOrderData?.id === arteloId)

/**
 * Undo our send of every standard print on this Artelo order. The caller has
 * just seen it waiting in Artelo (`live`). Returns the prints pulled back.
 * (`db` is for the tests.)
 */
export async function pullBack({ parentOrderNumber, arteloId, live, actor = null, db = prisma }) {
  const now = new Date()
  const done = []
  const rows = await rowsOf(db, parentOrderNumber, arteloId)
  // On our own, never right after a send: Artelo may not show it yet. A person asking is looking at it.
  if (!actor && rows.some(r => r.renderJobs.some(j => j.arteloSentAt && now - new Date(j.arteloSentAt) < SETTLED_MS))) return []
  for (const row of rows) {
    if (row.trackstarOrderType !== 'standard') continue
    const plan = planPullBack(row.renderJobs)
    if (!plan) continue
    const sentJobs = [plan.hold, ...plan.close].filter(Boolean)
    const ok = await db.$transaction(async tx => {
      // Only the send we looked at: if it changed under us, leave this print alone.
      for (const j of sentJobs) {
        const out = await tx.renderJob.updateMany({
          where: { id: j.id, arteloSentAt: j.arteloSentAt },
          data: j === plan.hold
            ? { arteloSentAt: null, sendAfter: null, sendError: null, sendHeldAt: now, sendHeldBy: HELD_IN_ARTELO }
            : { arteloSentAt: null, sendAfter: null, sendError: null, review: 'closed', reviewNote: 'Pulled back in Artelo before it printed; a newer design replaces it', reviewedAt: now },
        })
        if (!out.count) return false
      }
      await tx.order.update({
        where: { id: row.id },
        data: {
          ...(row.status === 'completed' ? { status: row.runnerResearch[0]?.researchStatus === 'found' ? 'ready' : 'pending' } : {}),
          arteloHold: null,
          arteloOrderData: { ...row.arteloOrderData, status: live.status, productionStatus: live.productionStatus || null },
        },
      })
      return true
    })
    if (!ok) continue
    const number = `${String(row.shopifyOrderData?.name || row.orderNumber).replace('#', '')}${row.lineItemIndex ? `-${row.lineItemIndex + 1}` : ''}`
    await recordAudit({
      action: 'artelo.pulled_back',
      summary: `Order ${number}${row.runnerName ? ` (${row.runnerName})` : ''} is held in Artelo, so it is open again here and its design is held`,
      detail: { orderId: row.id, orderNumber: row.orderNumber, arteloOrderId: arteloId, artelo: live.productionStatus || live.status, wasSentAt: sentJobs.map(j => j.arteloSentAt), jobIds: sentJobs.map(j => j.id) },
      actor,
    })
    // Edited while it read complete (a corrected time): the old design goes now, and the import renders the new one.
    const outdated = await closeOutdatedDesigns(row.id, 'The order changed after this design was sent, and it was pulled back in Artelo; a new design replaces it').catch(e => { console.error('[pulledBack] closing outdated', row.id, e.message); return 0 })
    done.push({ id: row.id, number, runner: row.runnerName, outdated: outdated > 0 })
  }
  return done
}

/**
 * Re-open Order: when Artelo has the order back, undo our send. Null when it
 * does not (it is being made, or it was never sent by us), so the caller
 * reopens it the plain way. Artelo not answering is null too.
 */
export async function pullBackIfHeld(orderId, { actor = null } = {}) {
  const row = await prisma.order.findUnique({ where: { id: String(orderId || '') }, select: { parentOrderNumber: true, trackstarOrderType: true, bulkOrderId: true, arteloOrderData: true, renderJobs: { where: { arteloSentAt: { not: null } }, select: { id: true }, take: 1 } } })
  const arteloId = row?.arteloOrderData?.id
  if (!arteloId || row.trackstarOrderType !== 'standard' || row.bulkOrderId || !row.renderJobs.length) return null
  const live = await call('orders/get-by-id', { query: { orderId: arteloId } }).catch(e => { console.warn(`[pulledBack] Artelo ${arteloId}: ${e.message}`); return null })
  if (!isPulledBack(live)) return null
  const done = await pullBack({ parentOrderNumber: row.parentOrderNumber, arteloId, live, actor })
  return done.length ? done : null
}

/**
 * The import: of the Artelo orders it just read, those we sent that are back
 * with us. Each is looked up again before it is undone, and Slack hears.
 * @param {object[]} arteloOrders the import's page, and once an hour every order still waiting
 */
export async function pullBackHeld(arteloOrders, { now = Date.now() } = {}) {
  const ids = [...new Set((arteloOrders || []).filter(o => isPulledBack(o, { sure: true })).map(o => String(o.orderId)))]
  if (!ids.length) return { pulledBack: [] }
  const rows = await prisma.order.findMany({
    where: { parentOrderNumber: { in: ids }, bulkOrderId: null, trackstarOrderType: { in: ['standard', 'custom'] }, renderJobs: { some: { arteloSentAt: { not: null, lt: new Date(now - SETTLED_MS) } } } },
    select: { id: true, orderNumber: true, parentOrderNumber: true, trackstarOrderType: true, runnerName: true, shopifyOrderData: true, arteloOrderData: true, renderJobs: { where: { arteloSentAt: { gte: new Date(now - SETTLED_MS) } }, select: { id: true }, take: 1 } },
  })
  const groups = new Map()
  for (const r of rows) {
    const arteloId = r.arteloOrderData?.id
    // Another print of it went out just now: wait for that to settle.
    if (!arteloId || r.renderJobs.length) continue
    if (!groups.has(arteloId)) groups.set(arteloId, [])
    groups.get(arteloId).push(r)
  }
  const pulledBack = [], customs = []
  for (const [arteloId, group] of [...groups].slice(0, 20)) {
    const live = await call('orders/get-by-id', { query: { orderId: arteloId } }).catch(() => null)
    if (!isPulledBack(live, { sure: true })) continue
    if (group.some(r => r.trackstarOrderType === 'standard')) pulledBack.push(...await pullBack({ parentOrderNumber: group[0].parentOrderNumber, arteloId, live }))
    customs.push(...group.filter(r => r.trackstarOrderType === 'custom'))
  }
  await tellPulledBack(pulledBack, customs)
  return { pulledBack }
}

/** Slack, once per print: it is open again, and what to do. */
export async function tellPulledBack(pulledBack, customs = []) {
  const lines = pulledBack.map(p => `• ${slackLink(orderAppUrl(p.number), `#${p.number}`)}${p.runner ? ` (${slackText(p.runner)})` : ''}: ${p.outdated ? 'the order changed since, so a new design is on its way for review' : 'its design is Held. Make the change, or Send now to send it as it is'}`)
  // A custom print stays sent here until a person moves it, so say it once.
  let told = []
  try { told = JSON.parse((await prisma.systemConfig.findUnique({ where: { key: TOLD_KEY } }))?.value || '[]') } catch { told = [] }
  const fresh = customs.filter(c => !told.includes(c.id))
  for (const c of fresh) { const n = String(c.shopifyOrderData?.name || c.orderNumber).replace('#', ''); lines.push(`• ${slackLink(orderAppUrl(n), `#${n}`)}${c.runnerName ? ` (${slackText(c.runnerName)})` : ''}: a custom print. Reopen it on the order if its design should change`) }
  if (!lines.length) return
  await slackTo('alerts', `:rewind: *Held in Artelo after we sent ${lines.length === 1 ? 'it' : 'them'}.* ${lines.length === 1 ? 'It is' : 'They are'} open again in TrackstarOS:\n${lines.join('\n')}`).catch(e => console.error('[pulledBack] slack', e.message))
  if (fresh.length) {
    const value = JSON.stringify([...fresh.map(c => c.id), ...told].slice(0, 200))
    await prisma.systemConfig.upsert({ where: { key: TOLD_KEY }, update: { value }, create: { key: TOLD_KEY, value } }).catch(() => {})
  }
}

/** Sent from Artelo by hand after all (unheld there, nothing changed): the held design is what prints, so it is marked sent again. Not when another design went out. */
export async function markResent(orderId, db = prisma) {
  return db.renderJob.updateMany({
    where: { orderId: String(orderId), status: 'done', review: 'approved', arteloSentAt: null, sendHeldAt: { not: null }, sendHeldBy: HELD_IN_ARTELO, order: { renderJobs: { none: { arteloSentAt: { not: null } } } } },
    data: { arteloSentAt: new Date(), sendHeldAt: null, sendHeldBy: null, sendAfter: null },
  })
}
