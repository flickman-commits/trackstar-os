/**
 * Order tools: how many, which, and one in full. Read only; the writes are
 * in team.js and design.js. Shapes are deliberate and small, so a phone can
 * read them: no raw Shopify or Artelo payloads leave the server.
 */
import { z } from 'zod'
import prisma from '../../../../api/_lib/prisma.js'
import { ToolError } from '../server.js'
import { can } from '../../../../api/_lib/roles.js'
import { approvalUrl, shopifyAdminUrl } from '../../../lib/links.js'
import { rosterFor } from '../../../domain/orders/assignment.js'
import { pipelinesFor } from '../../../domain/orders/pipelineStatus.js'

export const ORDER_TYPES = ['standard', 'custom', 'race_partner']
export const STATUSES = ['pending', 'missing_year', 'ready', 'flagged', 'completed']
export const DESIGN_STATUSES = ['not_started', 'in_progress', 'awaiting_review', 'in_revision', 'approved_by_customer', 'final_pdf_uploaded', 'sent_to_production']

/** Open means the dashboard still lists it. */
export function openWhere(type) {
  if (type === 'custom') return { trackstarOrderType: 'custom', designStatus: { not: 'sent_to_production' } }
  if (type === 'race_partner') return { trackstarOrderType: 'race_partner', designStatus: { notIn: ['sent_to_production', 'approved_by_customer'] } }
  return { trackstarOrderType: 'standard', status: { not: 'completed' } }
}

/** The number a person quotes: Shopify's display name, else the parent id. */
export function displayNumber(o) {
  const name = o.shopifyOrderData?.name
  return name ? String(name).replace(/^#/, '') : String(o.parentOrderNumber || o.orderNumber)
}

export function daysLate(dueDate, now = Date.now()) {
  if (!dueDate) return null
  const d = Math.floor((now - new Date(dueDate).getTime()) / 86400000)
  return d > 0 ? d : 0
}

const LIST_SELECT = {
  id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, trackstarOrderType: true,
  status: true, designStatus: true, runnerName: true, runnerNameOverride: true, raceName: true, raceNameOverride: true,
  raceYear: true, yearOverride: true, productSize: true, frameType: true, dueDate: true, createdAt: true, isRushOrder: true,
  lookupVerified: true, lookupOutcome: true, customerName: true, photoPath: true, proofSentAt: true,
  assignee: { select: { id: true, firstName: true } },
  shopifyOrderData: false,
}

/** One row as the list and status tools show it. */
export function row(o, shopifyName) {
  return {
    orderNumber: shopifyName ? String(shopifyName).replace(/^#/, '') : String(o.parentOrderNumber),
    item: o.lineItemIndex + 1,
    type: o.trackstarOrderType,
    status: o.status,
    designStatus: ['custom', 'race_partner'].includes(o.trackstarOrderType) ? o.designStatus : undefined,
    runner: o.runnerNameOverride || o.runnerName,
    race: o.raceNameOverride || o.raceName,
    year: o.yearOverride || o.raceYear,
    size: o.productSize,
    frame: o.frameType,
    assignee: o.assignee?.firstName || null,
    orderedAt: o.createdAt,
    dueDate: o.dueDate || undefined,
    daysLate: o.dueDate ? daysLate(o.dueDate) : undefined,
    rush: o.isRushOrder || undefined,
    photo: o.photoPath ? true : undefined,
    lookup: o.lookupVerified == null ? undefined : (o.lookupVerified ? 'verified' : 'not verified'),
  }
}

/** Shopify display names for a set of rows, one query, nothing else from the payload. */
export async function shopifyNames(ids) {
  if (!ids.length) return new Map()
  const rows = await prisma.$queryRaw`SELECT id, "shopifyOrderData"::jsonb->>'name' AS name, ("shopifyOrderData"::jsonb->>'id') AS sid FROM "Order" WHERE id = ANY(${ids})`
  return new Map(rows.map(r => [r.id, { name: r.name, shopifyId: r.sid }]))
}

/** Every row of an order, by the number a person quotes. */
export async function findOrdersByNumber(wanted) {
  const n = String(wanted || '').replace(/^#/, '').trim()
  if (!n) throw new ToolError('Give me an order number.')
  return prisma.order.findMany({
    where: {
      OR: [
        { shopifyOrderData: { path: ['name'], equals: n } },
        { shopifyOrderData: { path: ['name'], equals: `#${n}` } },
        { parentOrderNumber: n },
        { orderNumber: n },
        { orderNumber: { startsWith: `${n}-` } },
      ],
    },
    orderBy: { lineItemIndex: 'asc' },
    take: 10,
    include: {
      assignee: { select: { id: true, firstName: true } },
      runnerResearch: { orderBy: { id: 'desc' }, take: 1, select: { bibNumber: true, officialTime: true, officialPace: true, researchStatus: true, eventType: true, source: true } },
      comments: { orderBy: { createdAt: 'desc' }, take: 5, select: { text: true, authorName: true, createdAt: true } },
      proofs: { select: { status: true, batch: true, groupLabel: true, createdAt: true } },
      approvalToken: { select: { token: true, expiresAt: true } },
      bulkOrder: { select: { number: true, partnerName: true } },
    },
  })
}

/**
 * Approval and intake links are bearer credentials: whoever has one can
 * approve a proof or fill in a bulk run. A read key hands them out only when
 * it acts as an admin, or as someone whose role creates and approves designs.
 */
export async function mayHoldLinks(principal) {
  if (!principal?.user) return false
  return principal.role === 'admin' || await can(principal, 'orders.render')
}

/** The link itself for someone who may hold it, else only whether there is one. */
export function linkField(name, url, allowed) {
  const has = `has${name[0].toUpperCase()}${name.slice(1)}`
  return allowed ? { [name]: url || null } : { [has]: Boolean(url) }
}

/** The pipeline as a tool shows it: stage, the one-line reason, and what to do. */
export function pipelineShape(p) {
  return p ? { stage: p.stage, reason: p.reason, fix: p.fix || undefined } : undefined
}

/** One item of an order: the one asked for, else the first. */
export function pickItem(rows, item) {
  const o = item ? rows.find(r => r.lineItemIndex === item - 1) : rows[0]
  if (!o) throw new ToolError(`${displayNumber(rows[0])} has no item ${item}.`)
  return o
}

export function detail(o, { links = false } = {}) {
  const r = o.runnerResearch?.[0]
  const design = ['custom', 'race_partner'].includes(o.trackstarOrderType)
  const proofs = o.proofs || []
  return {
    ...row(o, o.shopifyOrderData?.name),
    internalId: o.id,
    customer: o.customerName || null,
    customerEmail: o.customerEmail || null,
    bib: r?.bibNumber || null,
    time: r?.officialTime || null,
    pace: r?.officialPace || o.customerPace || null,
    event: r?.eventType || o.customerEventType || null,
    research: r ? { status: r.researchStatus, source: r.source || null } : { status: 'never researched' },
    lookupOutcome: o.lookupOutcome || null,
    gift: o.isGift || undefined,
    creativeDirection: design && o.creativeDirection ? o.creativeDirection : undefined,
    proofs: design ? { total: proofs.length, approved: proofs.filter(p => p.status === 'approved').length, awaiting: proofs.filter(p => p.status === 'pending').length, lastSentAt: o.proofSentAt || null } : undefined,
    ...(design ? linkField('approvalLink', approvalUrl(o.approvalToken?.token), links) : {}),
    shopifyAdminUrl: shopifyAdminUrl(o.shopifyOrderData?.id) || undefined,
    bulkRun: o.bulkOrder ? `${o.bulkOrder.number} (${o.bulkOrder.partnerName})` : undefined,
    comments: (o.comments || []).map(c => ({ by: c.authorName || 'someone', at: c.createdAt, text: c.text })),
  }
}

async function teamSummary() {
  const out = {}
  for (const t of ['standard', 'custom', 'race_partner', 'bulk']) {
    const roster = await rosterFor(t)
    const users = roster.length ? await prisma.user.findMany({ where: { id: { in: roster.map(r => r.userId) } }, select: { id: true, firstName: true } }) : []
    out[t] = roster.map(r => ({ name: users.find(u => u.id === r.userId)?.firstName || '?', regular: r.regular, share: r.weight }))
  }
  return out
}

export const orderTools = [
  {
    name: 'orders_overview',
    title: 'Orders overview',
    description: 'How many orders are open right now, by type, status and assignee, plus who gets new orders today. The "how are we doing" tool.',
    scope: 'read',
    readOnly: true,
    input: {},
    async handler() {
      const [standard, custom, partners, bulk] = await Promise.all([
        prisma.order.groupBy({ by: ['status'], where: openWhere('standard'), _count: { _all: true } }),
        prisma.order.groupBy({ by: ['designStatus'], where: openWhere('custom'), _count: { _all: true } }),
        prisma.order.groupBy({ by: ['designStatus'], where: openWhere('race_partner'), _count: { _all: true } }),
        prisma.bulkOrder.groupBy({ by: ['status'], where: { status: { not: 'submitted' } }, _count: { _all: true } }),
      ])
      const byAssignee = await prisma.order.groupBy({
        by: ['trackstarOrderType', 'assigneeId'],
        where: { OR: [openWhere('standard'), openWhere('custom'), openWhere('race_partner')] },
        _count: { _all: true },
      })
      const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, firstName: true } })
      const name = id => users.find(u => u.id === id)?.firstName || 'Unassigned'
      const perPerson = {}
      for (const g of byAssignee) {
        const who = name(g.assigneeId)
        perPerson[who] = perPerson[who] || {}
        perPerson[who][g.trackstarOrderType] = g._count._all
      }
      const rushOpen = await prisma.order.count({ where: { ...openWhere('standard'), isRushOrder: true } })
      const lateCustom = await prisma.order.count({ where: { ...openWhere('custom'), dueDate: { lt: new Date() } } })
      const sum = rows => rows.reduce((a, r) => a + r._count._all, 0)
      return {
        standard: { open: sum(standard), byStatus: Object.fromEntries(standard.map(r => [r.status, r._count._all])), rush: rushOpen },
        custom: { open: sum(custom), byDesignStatus: Object.fromEntries(custom.map(r => [r.designStatus, r._count._all])), pastDue: lateCustom },
        partners: { open: sum(partners), byDesignStatus: Object.fromEntries(partners.map(r => [r.designStatus, r._count._all])) },
        bulk: { open: sum(bulk), byStatus: Object.fromEntries(bulk.map(r => [r.status, r._count._all])) },
        openByPerson: perPerson,
        currentTeam: await teamSummary(),
      }
    },
  },
  {
    name: 'list_orders',
    title: 'List orders',
    description: 'Open orders of one type, newest first, with filters. Standard orders are the personalized prints (each with its pipeline stage, reason and fix); custom and race_partner are design jobs. Up to 50 a page.',
    scope: 'read',
    readOnly: true,
    input: {
      type: z.enum(ORDER_TYPES).default('standard'),
      status: z.enum(STATUSES).optional().describe('Standard orders: pending, missing_year, ready, flagged, completed.'),
      designStatus: z.enum(DESIGN_STATUSES).optional().describe('Custom and partner orders.'),
      assignee: z.string().max(60).optional().describe('A first name, or "me", or "nobody".'),
      race: z.string().max(80).optional().describe('Part of a race name.'),
      includeCompleted: z.boolean().optional().describe('Also the finished ones (last 60 days).'),
      limit: z.number().int().min(1).max(50).default(25),
      page: z.number().int().min(1).max(40).default(1),
    },
    async handler({ type = 'standard', status, designStatus, assignee, race, includeCompleted = false, limit = 25, page = 1 }, { principal }) {
      const where = includeCompleted
        ? { trackstarOrderType: type, createdAt: { gte: new Date(Date.now() - 60 * 86400000) } }
        : openWhere(type)
      if (status) where.status = status
      if (designStatus) where.designStatus = designStatus
      if (race) where.OR = [{ raceName: { contains: race, mode: 'insensitive' } }, { raceNameOverride: { contains: race, mode: 'insensitive' } }]
      if (assignee) {
        const a = assignee.trim().toLowerCase()
        if (a === 'nobody' || a === 'unassigned') where.assigneeId = null
        else if (a === 'me') {
          if (!principal.user) throw new ToolError('"me" needs a key that acts as a person.')
          where.assigneeId = principal.user.id
        } else {
          const u = await prisma.user.findFirst({ where: { isActive: true, firstName: { equals: assignee.trim(), mode: 'insensitive' } }, select: { id: true } })
          if (!u) throw new ToolError(`Nobody on the team is called "${assignee}".`)
          where.assigneeId = u.id
        }
      }
      const [total, rows] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({ where, orderBy: type === 'custom' ? [{ dueDate: 'asc' }, { createdAt: 'desc' }] : { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: LIST_SELECT }),
      ])
      const [names, pipelines] = await Promise.all([shopifyNames(rows.map(r => r.id)), type === 'standard' ? pipelinesFor(rows.map(r => r.id)) : new Map()])
      return { total, page, pages: Math.max(1, Math.ceil(total / limit)), orders: rows.map(o => ({ ...row(o, names.get(o.id)?.name), pipeline: pipelineShape(pipelines.get(o.id)) })) }
    },
  },
  {
    name: 'get_order',
    title: 'Get order',
    description: 'One order in full by its number (e.g. "4053"): every item on it, the runner, race, what prints, research, the pipeline stage and fix, comments, proofs and, for design jobs, the approval link (only for admins and people who approve designs; others see hasApprovalLink).',
    scope: 'read',
    readOnly: true,
    input: { orderNumber: z.string().max(40).describe('The Shopify order number, with or without #.') },
    async handler({ orderNumber }, { principal }) {
      const rows = await findOrdersByNumber(orderNumber)
      if (!rows.length) throw new ToolError(`No order matching "${orderNumber}".`)
      const pipelines = await pipelinesFor(rows.filter(r => r.trackstarOrderType === 'standard').map(r => r.id))
      const links = await mayHoldLinks(principal)
      return { orderNumber: displayNumber(rows[0]), items: rows.map(o => ({ ...detail(o, { links }), pipeline: pipelineShape(pipelines.get(o.id)) })) }
    },
  },
  {
    name: 'search_orders',
    title: 'Search orders',
    description: 'Find orders by a runner\'s name, a customer\'s name or email, or a race. Open orders first.',
    scope: 'read',
    readOnly: true,
    input: { query: z.string().min(2).max(80), limit: z.number().int().min(1).max(30).default(15) },
    async handler({ query, limit = 15 }) {
      const q = query.trim()
      const where = {
        trackstarOrderType: { in: ORDER_TYPES },
        OR: [
          { runnerName: { contains: q, mode: 'insensitive' } },
          { runnerNameOverride: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { customerEmail: { contains: q, mode: 'insensitive' } },
          { raceName: { contains: q, mode: 'insensitive' } },
        ],
      }
      const rows = await prisma.order.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: limit, select: LIST_SELECT })
      const names = await shopifyNames(rows.map(r => r.id))
      return { matches: rows.map(o => row(o, names.get(o.id)?.name)) }
    },
  },
  {
    name: 'backlog_by_reason',
    title: 'Backlog by reason',
    description: 'Open standard orders grouped by pipeline stage and reason, with counts and order numbers. The dashboard\'s Action queue.',
    scope: 'read',
    readOnly: true,
    input: {},
    async handler() {
      const rows = await prisma.order.findMany({ where: openWhere('standard'), select: { id: true, parentOrderNumber: true, lineItemIndex: true } })
      const [names, pipelines] = await Promise.all([shopifyNames(rows.map(r => r.id)), pipelinesFor(rows.map(r => r.id))])
      const stages = {}
      for (const o of rows) {
        const p = pipelines.get(o.id)
        if (!p) continue
        const n = String(names.get(o.id)?.name || o.parentOrderNumber).replace(/^#/, '') + (o.lineItemIndex ? `-${o.lineItemIndex + 1}` : '')
        const st = (stages[p.stage] ||= { count: 0, reasons: {} })
        st.count++
        const r = (st.reasons[p.reason] ||= { count: 0, orders: [] })
        r.count++
        r.orders.push(n)
      }
      const ORDER = ['review', 'attach', 'action', 'needs_research', 'waiting', 'done']
      return {
        open: rows.length,
        stages: ORDER.filter(s => stages[s]).map(s => ({
          stage: s,
          count: stages[s].count,
          reasons: Object.entries(stages[s].reasons).sort((a, b) => b[1].count - a[1].count).map(([reason, v]) => ({ reason, count: v.count, orders: v.orders.sort() })),
        })),
      }
    },
  },
]
