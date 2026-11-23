/**
 * Everything that happened on a custom order, in order: for the Sent stage
 * of the order view, so an order looked at weeks later (a print that came
 * out wrong) shows what was made, who did what, and when.
 *
 * Built from what we already keep, with no table of its own: the order
 * (placed, and designCompletedAt: who moved it to Sent to production), the audit log (assigned, proofs emailed, final PDF
 * uploaded), the proofs (each round, the customer's change requests and the
 * approval), the final PDF's render job (held, sent to Artelo), and the
 * shipping Artelo posts back to Shopify (productionStatus.js). An event a
 * source does not have is left out, never guessed.
 */
import prisma from '../../db.js'
import { productionStatus } from './productionStatus.js'

const AUDIT_ACTIONS = ['order.assign', 'proof.send', 'order.final-pdf']

/** Pure: the events from the rows, oldest first. Exported for the tests. */
export function buildTimeline({ order, proofs = [], audits = [], finals = [], tracking = [] }) {
  const ev = []
  const add = (at, label, extra = {}) => { if (at) ev.push({ at: new Date(at).toISOString(), label, ...extra }) }
  const firstName = a => a?.user?.firstName || (a?.actorEmail ? a.actorEmail.split('@')[0] : null)

  // When the customer bought it (the shop's date), else when it reached us.
  const placed = order.orderPlacedAt || order.shopifyOrderData?.created_at || (order.etsyOrderData?.create_timestamp ? order.etsyOrderData.create_timestamp * 1000 : null) || order.createdAt
  add(placed, 'Ordered')

  // Each round of proofs, when it was first uploaded.
  const rounds = new Map()
  for (const p of proofs) {
    const r = rounds.get(p.batch) || { at: p.createdAt, n: 0 }
    if (new Date(p.createdAt) < new Date(r.at)) r.at = p.createdAt
    r.n++
    rounds.set(p.batch, r)
  }
  const roundList = [...rounds.entries()].sort((a, b) => a[0] - b[0])
  for (const [batch, r] of roundList) add(r.at, `Round ${batch}: ${r.n} proof${r.n === 1 ? '' : 's'} made`)
  // The round a send went out with: the newest one made by then. A second
  // send of the same round is a reminder or a resend, and says so.
  const roundAt = at => roundList.filter(([, r]) => new Date(r.at) <= new Date(at)).pop()?.[0] || null
  const sentRounds = new Set()

  for (const a of audits) {
    if (a.action === 'order.assign') {
      const to = String(a.summary || '').match(/ to (.+)$/)?.[1]
      add(a.createdAt, to && to !== 'nobody' ? `Assigned to ${to}` : 'Unassigned', { by: firstName(a) })
    } else if (a.action === 'proof.send') {
      const round = roundAt(a.createdAt)
      const again = round !== null && sentRounds.has(round)
      if (round !== null) sentRounds.add(round)
      add(a.createdAt, again ? 'Emailed the proofs again' : round ? `Emailed round ${round} to the customer` : 'Emailed proofs to the customer', { by: firstName(a) })
    } else if (a.action === 'order.final-pdf') {
      add(a.createdAt, 'Final PDF uploaded', { by: firstName(a), kind: 'final' })
    }
  }

  // What the customer said: one line per change request, and the approval.
  const asked = new Set()
  for (const p of proofs) {
    if (p.status === 'revision_requested' && p.customerFeedback && !asked.has(p.customerFeedback)) {
      asked.add(p.customerFeedback)
      add(p.updatedAt, `Customer asked for changes on v${p.version}`, { quote: p.customerFeedback })
    }
    if (p.status === 'approved') add(p.updatedAt, `Customer approved v${p.version}`, { quote: p.customerFeedback || null })
  }

  // The final file, when the audit log predates it, and its trip to Artelo.
  const auditedFinal = audits.some(a => a.action === 'order.final-pdf')
  for (const f of finals) {
    if (!auditedFinal) add(f.createdAt, 'Final PDF uploaded', { by: f.requester?.firstName || null, kind: 'final' })
    if (f.sendHeldAt) add(f.sendHeldAt, 'Held from production', { by: f.sendHeldBy || null })
    if (f.arteloSentAt) add(f.arteloSentAt, 'Sent to Artelo production', { kind: 'sent' })
  }
  if (order.designCompletedAt && !finals.some(f => f.arteloSentAt)) add(order.designCompletedAt, 'Marked sent to production', { kind: 'sent', by: order.designCompletedBy?.firstName || null })

  for (const t of tracking) {
    add(t.shippedAt, `Shipped${t.company ? `, ${t.company}` : ''}`, { url: t.url || null })
    add(t.deliveredAt, 'Delivered')
  }

  return ev.sort((a, b) => new Date(a.at) - new Date(b.at))
}

/**
 * The order's timeline, and where it is now (Artelo, shipping). Null when
 * there is no such order. Artelo or Shopify being down costs only the
 * shipping lines; `errors` says so.
 */
export async function orderTimeline(orderId) {
  const id = String(orderId || '')
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true, createdAt: true, shopifyOrderData: true, etsyOrderData: true, designCompletedAt: true, designCompletedBy: { select: { firstName: true } },
      proofs: { select: { version: true, batch: true, status: true, customerFeedback: true, createdAt: true, updatedAt: true } },
    },
  })
  if (!order) return null
  const [audits, finals, production] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { action: { in: AUDIT_ACTIONS }, detail: { path: ['orderId'], equals: id } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, summary: true, detail: true, actorEmail: true, createdAt: true, user: { select: { firstName: true } } },
    }),
    prisma.renderJob.findMany({
      where: { orderId: id, spec: { path: ['kind'], equals: 'custom_final' } },
      orderBy: { version: 'asc' },
      select: { createdAt: true, sendHeldAt: true, sendHeldBy: true, arteloSentAt: true, requester: { select: { firstName: true } } },
    }),
    productionStatus(id).catch(err => { console.warn(`[orders.timeline] production ${id}: ${err.message}`); return null }),
  ])
  return {
    events: buildTimeline({ order, proofs: order.proofs, audits, finals, tracking: production?.tracking || [] }),
    production: production ? { stage: production.stage, url: production.production?.url || null, tracking: production.tracking || [] } : null,
    errors: production?.errors || [],
  }
}
