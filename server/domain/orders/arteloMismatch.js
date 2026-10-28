/**
 * Orders the tool calls done that Artelo never sent to production: completed
 * here while Artelo still has the order waiting (Missing Designs, Needs
 * Address Review, Customer Unpaid). 4725 sat like this for two weeks while
 * the customer emailed; an audit on 2026-10-28 found 21.
 *
 * Efficient by keeping our copy current. Each order's arteloOrderData was a
 * snapshot from import and always said "PendingFulfillmentAction", so the
 * only way to know was one Artelo lookup per completed order (2,362 for 90
 * days, which Artelo rate limits). Now every lookup writes Artelo's live
 * status back, and a check only asks about completed orders whose saved
 * status still says waiting: the real problems plus the last day's work.
 * Artelo's paged list does not help: it is every store's orders, newest
 * first, and each page further back is slower.
 */
import prisma from '../../db.js'
import { call } from '../render/artelo.js'
import { postSlack, slackText } from '../../lib/slack.js'

const DONE_AT_ARTELO = ['Received', 'InProduction', 'Shipped', 'Delivered', 'Canceled', 'Ignored']
const STATE_KEY = 'artelo_completed_not_sent'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function lookup(id) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await call('orders/get-by-id', { query: { orderId: id } })
    } catch (e) {
      if (e.status === 429) { await sleep(1500 * (attempt + 1)); continue }
      throw e
    }
  }
  throw new Error('Artelo kept rate limiting the check')
}

/**
 * @param {{ days?: number, budgetMs?: number }} opts
 * @returns {Promise<{ checked: number, remaining: number, orders: object[] }>}
 *   remaining > 0 when the time budget ran out first (the next run carries on)
 */
export async function completedButNotSent({ days = 90, budgetMs = 240_000 } = {}) {
  const started = Date.now()
  const rows = await prisma.order.findMany({
    where: { status: 'completed', createdAt: { gte: new Date(Date.now() - days * 864e5) }, arteloOrderData: { not: null } },
    select: { id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, trackstarOrderType: true, raceName: true, raceYear: true, runnerName: true, customerName: true, customerEmail: true, createdAt: true, shopifyOrderData: true, arteloOrderData: true },
  })
  // Artelo orders whose saved status does not yet say it went to production.
  const groups = new Map()
  for (const r of rows) {
    const id = r.arteloOrderData?.id
    if (!id || DONE_AT_ARTELO.includes(r.arteloOrderData?.status)) continue
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(r)
  }

  const orders = []
  let checked = 0
  const entries = [...groups]
  for (let k = 0; k < entries.length; k += 3) {
    if (Date.now() - started > budgetMs) break
    await Promise.all(entries.slice(k, k + 3).map(async ([id, group]) => {
      const live = await lookup(id).catch(() => null)
      if (!live?.status) return
      checked++
      // Keep our copy current, so this order is never asked about again once it moves.
      for (const r of group) {
        await prisma.order.update({ where: { id: r.id }, data: { arteloOrderData: { ...r.arteloOrderData, status: live.status, productionStatus: live.productionStatus || null } } })
      }
      if (live.status !== 'PendingFulfillmentAction') return
      const open = await prisma.order.findMany({ where: { parentOrderNumber: group[0].parentOrderNumber, status: { not: 'completed' } }, select: { orderNumber: true, lineItemIndex: true, status: true, raceName: true } })
      const first = group[0]
      orders.push({
        number: String(first.shopifyOrderData?.name || first.orderNumber).replace('#', ''),
        arteloId: id,
        artelo: live.productionStatus || live.status,
        // Every print done here: nothing in the queue will ever move it.
        kind: open.length ? 'waiting on another print' : 'stuck',
        completed: group.map(r => ({ orderNumber: r.orderNumber, item: r.lineItemIndex + 1, race: `${r.raceName || ''} ${r.raceYear || ''}`.trim(), runner: r.runnerName, type: r.trackstarOrderType })),
        open: open.map(r => ({ orderNumber: r.orderNumber, item: r.lineItemIndex + 1, status: r.status, race: r.raceName })),
        customer: first.customerName, email: first.customerEmail,
        ordered: first.createdAt.toISOString().slice(0, 10),
      })
    }))
    await sleep(300)
  }
  orders.sort((a, b) => (a.kind === b.kind ? a.ordered.localeCompare(b.ordered) : a.kind === 'stuck' ? -1 : 1))
  return { checked, remaining: Math.max(0, groups.size - checked), orders }
}

/** The daily check: Slack hears about stuck orders it has not been told about. */
export async function checkCompletedNotSent() {
  const out = await completedButNotSent()
  const stuck = out.orders.filter(o => o.kind === 'stuck')
  const row = await prisma.systemConfig.findUnique({ where: { key: STATE_KEY } })
  let told = []
  try { told = JSON.parse(row?.value || '[]') } catch { told = [] }
  const fresh = stuck.filter(o => !told.includes(o.arteloId))
  if (fresh.length) {
    const lines = fresh.slice(0, 20).map(o => `• #${slackText(o.number)} (${slackText(o.artelo)}, ordered ${o.ordered}): ${slackText(o.completed.map(c => `${c.race} / ${c.runner}`).join('; '))}`)
    if (fresh.length > 20) lines.push(`• and ${fresh.length - 20} more`)
    await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL, `:rotating_light: *${fresh.length === 1 ? 'An order is' : `${fresh.length} orders are`} complete in TrackstarOS but never sent to production in Artelo.* The customer is waiting:\n${lines.join('\n')}\nAttach the design in Artelo and send it to production.`)
  }
  await prisma.systemConfig.upsert({ where: { key: STATE_KEY }, update: { value: JSON.stringify(stuck.map(o => o.arteloId)) }, create: { key: STATE_KEY, value: JSON.stringify(stuck.map(o => o.arteloId)) } })
  return { checked: out.checked, remaining: out.remaining, stuck: stuck.length, waitingOnAnotherPrint: out.orders.length - stuck.length, newlyReported: fresh.length }
}

const HOLDS_KEY = 'artelo_holds_alerted'
// Waiting for its design, or for us to approve it: our own pipeline tracks those.
const OUR_STEP = ['Missing Designs', 'Pending Approval']

/**
 * Artelo holds an order for something only a person can clear there: an
 * address it could not verify ("Needs Address Review"), a payment
 * ("Customer Unpaid"). Nothing prints until someone acts, and nothing in
 * TrackstarOS said so (4078 and 4225 sat for weeks). The import reads
 * Artelo's newest orders every 10 minutes and Artelo flags these when an
 * order arrives, so each hold is caught within minutes and told once.
 * @param {object[]} arteloOrders - the import's page of Artelo orders
 */
export async function alertArteloHolds(arteloOrders, { link } = {}) {
  const holds = (arteloOrders || []).filter(o => o.status === 'PendingFulfillmentAction' && o.productionStatus && !OUR_STEP.includes(o.productionStatus))
  if (!holds.length) return { holds: 0, alerted: 0 }
  const row = await prisma.systemConfig.findUnique({ where: { key: HOLDS_KEY } })
  let told = []
  try { told = JSON.parse(row?.value || '[]') } catch { told = [] }
  const key = o => `${o.id}:${o.productionStatus}`
  const fresh = holds.filter(o => !told.includes(key(o)))
  if (fresh.length) {
    const ours = await prisma.order.findMany({ where: { parentOrderNumber: { in: fresh.map(o => String(o.orderId)) } }, select: { parentOrderNumber: true, shopifyOrderData: true, runnerName: true, raceName: true } })
    const lines = fresh.slice(0, 20).map(o => {
      const r = ours.find(x => x.parentOrderNumber === String(o.orderId))
      const name = r ? String(r.shopifyOrderData?.name || o.orderId).replace('#', '') : o.orderId
      const url = link ? link(o.id) : null
      return `• *${slackText(o.productionStatus)}*: #${slackText(name)}${r ? ` (${slackText(r.raceName || '')}${r.runnerName ? ` / ${slackText(r.runnerName)}` : ''})` : ''}${url ? ` <${url}|Open in Artelo>` : ''}`
    })
    await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL, `:octagonal_sign: *Artelo is holding ${fresh.length === 1 ? 'an order' : `${fresh.length} orders`}* and will not print until someone sorts it out in Artelo:\n${lines.join('\n')}`)
  }
  // Remember the newest 500, so a hold is told once even after it scrolls out of the page.
  const value = JSON.stringify([...new Set([...holds.map(key), ...told])].slice(0, 500))
  await prisma.systemConfig.upsert({ where: { key: HOLDS_KEY }, update: { value }, create: { key: HOLDS_KEY, value } })
  return { holds: holds.length, alerted: fresh.length }
}
