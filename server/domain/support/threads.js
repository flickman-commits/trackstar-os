/**
 * The inbox as the page reads it: the views, one conversation, and what we
 * know about the person writing in. Nothing here talks to Gmail; the mirror
 * does (mailbox.js). The order context comes from our own orders table and,
 * for what it cannot know, from Shopify: fulfillment, tracking, what was paid.
 *
 * The views are Intercom's: Your inbox (assigned to you), Mentions (a note
 * named you), Unassigned, All open, then Waiting, Escalated, Snoozed and
 * Closed, and one per teammate. Unread is per person: bold until you have
 * opened the thread since the customer last wrote.
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { approvalUrl, shopifyAdminUrl, arteloOrderUrl } from '../../lib/links.js'
import { getProductInfo, loadProductCatalog } from '../../lib/productCatalog.js'
import { listMockups } from './mockups.js'
import { stripQuoted } from './mailbox.js'
import { can } from '../../../api/_lib/roles.js'
import { replyWindow } from './instagram.js'
import { UserError } from './errors.js'
import { getOrderTotalUsd, BIG_SPENDER_THRESHOLD_USD } from '../../lib/orderValue.js'
import { replacementsFor } from './replacements.js'

export const STATUSES = ['open', 'waiting', 'escalated', 'closed']
export const SORTS = ['waiting', 'newest', 'oldest', 'priority']

/** The playbook's scenarios, offered when tagging. Free text is fine too. */
export const TAG_SUGGESTIONS = [
  'Where is my order', 'Damaged print', 'Broken frame', 'Wrong personalization', 'Race not available',
  'Refund', 'Product question', 'Custom print', 'Race organizer', 'Pre-race order', 'Order change',
  'Pre-race motivation', 'Happy customer', 'Missing detail', 'Wrong frame', 'Discount not applied',
  'Note from owner', 'Cart trouble', 'Add-on', 'Address change', 'We messed up', 'Results changed',
  'Preview request', 'Unsure of results', 'Press', 'Spam', 'Review requested',
]

const TEAM_SELECT = { id: true, firstName: true, lastName: true }
const notSnoozed = () => ({ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] })
const OPENISH = { status: { in: ['open', 'waiting', 'escalated'] } }

/** The where clause for a view. `teammate:<id>` is that person's open work. */
/**
 * An Instagram conversation where only we have spoken: the ManyChat
 * welcome to a new follower, with no reply. It is not support yet, so it
 * stays out of every list and count and sits under Filtered. The first
 * message from the person (lastInboundAt) brings it into the inbox.
 */
const AUTOMATION_ONLY = { channel: 'instagram', lastInboundAt: null }

export function viewWhere(view, userId) {
  if (view === 'filtered') return { mergedIntoId: null, OR: [{ filtered: true }, AUTOMATION_ONLY] }
  return { filtered: false, mergedIntoId: null, NOT: AUTOMATION_ONLY, ...baseView(view, userId) }
}

function baseView(view, userId) {
  if (view.startsWith('teammate:')) return { assigneeId: view.slice('teammate:'.length), ...OPENISH }
  switch (view) {
    case 'inbox': return { assigneeId: userId, ...OPENISH }
    case 'mentions': return { ...OPENISH, notes: { some: { kind: 'note', mentions: { has: userId } } } }
    case 'unassigned': return { assigneeId: null, status: 'open', ...notSnoozed() }
    case 'all': return { status: 'open', ...notSnoozed() }
    case 'waiting': return { status: 'waiting' }
    case 'escalated': return { status: 'escalated' }
    case 'snoozed': return { status: 'open', snoozedUntil: { gt: new Date() } }
    case 'closed': return { status: 'closed' }
    default: return { status: 'open', ...notSnoozed() }
  }
}

function searchWhere(q) {
  const s = String(q || '').trim()
  if (!s) return {}
  return {
    OR: [
      { subject: { contains: s, mode: 'insensitive' } },
      { customerEmail: { contains: s, mode: 'insensitive' } },
      { customerName: { contains: s, mode: 'insensitive' } },
      { snippet: { contains: s, mode: 'insensitive' } },
      { igUsername: { contains: s.replace(/^@/, ''), mode: 'insensitive' } },
      { tags: { has: s } },
    ],
  }
}

function orderBy(sort) {
  switch (sort) {
    case 'newest': return [{ lastMessageAt: 'desc' }]
    case 'oldest': return [{ lastMessageAt: 'asc' }]
    case 'priority': return [{ priority: 'desc' }, { lastInboundAt: 'asc' }, { lastMessageAt: 'asc' }]
    default: return [{ lastInboundAt: 'asc' }, { lastMessageAt: 'asc' }] // waiting longest first
  }
}

export async function listThreads({ view = 'all', userId, q = '', sort = 'waiting', limit = 150 } = {}) {
  const where = { AND: [viewWhere(view, userId), searchWhere(q)] }
  const [threads, inbox, mentions, unassigned, all, waiting, escalated, snoozed, perAssignee] = await Promise.all([
    prisma.supportThread.findMany({ where, orderBy: orderBy(SORTS.includes(sort) ? sort : 'waiting'), take: limit, include: { assignee: { select: TEAM_SELECT } } }),
    prisma.supportThread.count({ where: viewWhere('inbox', userId) }),
    prisma.supportThread.count({ where: viewWhere('mentions', userId) }),
    prisma.supportThread.count({ where: viewWhere('unassigned') }),
    prisma.supportThread.count({ where: viewWhere('all') }),
    prisma.supportThread.count({ where: viewWhere('waiting') }),
    prisma.supportThread.count({ where: viewWhere('escalated') }),
    prisma.supportThread.count({ where: viewWhere('snoozed') }),
    prisma.supportThread.groupBy({ by: ['assigneeId'], where: { ...OPENISH, filtered: false, mergedIntoId: null, NOT: AUTOMATION_ONLY }, _count: { _all: true } }),
  ])
  const reads = userId && threads.length
    ? await prisma.supportRead.findMany({ where: { userId, threadId: { in: threads.map(t => t.id) } } })
    : []
  const readAt = new Map(reads.map(r => [r.threadId, r.readAt]))
  const byAssignee = {}
  for (const g of perAssignee) if (g.assigneeId) byAssignee[g.assigneeId] = g._count._all
  return {
    threads: threads.map(t => row(t, readAt.get(t.id))),
    counts: { inbox, mentions, unassigned, all, waiting, escalated, snoozed, byAssignee },
  }
}

function row(t, readAt) {
  return {
    id: t.id,
    channel: t.channel || 'email',
    igUsername: t.igUsername || '',
    subject: t.subject,
    customerEmail: t.customerEmail,
    customerName: t.customerName,
    status: t.status,
    snoozedUntil: t.snoozedUntil,
    filtered: Boolean(t.filtered),
    assignee: t.assignee || null,
    priority: t.priority,
    tags: t.tags || [],
    snippet: t.snippet,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    lastInboundAt: t.lastInboundAt,
    lastOutboundAt: t.lastOutboundAt,
    backfilled: t.backfilled,
    unread: Boolean(t.lastInboundAt) && (!readAt || new Date(t.lastInboundAt) > new Date(readAt)),
  }
}

/** Who can work the inbox: active people whose role includes Support (admins always). */
export async function team() {
  const users = await prisma.user.findMany({ where: { isActive: true }, orderBy: { firstName: 'asc' }, select: { ...TEAM_SELECT, role: true } })
  const out = []
  for (const u of users) if (await can(u.role, 'support')) out.push({ id: u.id, firstName: u.firstName, lastName: u.lastName })
  return out
}

/** One thread: messages, notes and events, the customer's orders and other threads. */
/** `money` (admins only, api/_lib/money.js): keep what the customer spent; otherwise only the Big Spender flag goes out. */
export async function getThread(id, { userId, money = false } = {}) {
  const t = await prisma.supportThread.findUnique({
    where: { id },
    include: {
      assignee: { select: TEAM_SELECT },
      messages: { orderBy: { sentAt: 'asc' }, include: { sentBy: { select: TEAM_SELECT } } },
      notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: TEAM_SELECT } } },
      reads: userId ? { where: { userId } } : false,
    },
  })
  if (!t) return null
  if (t.mergedIntoId && t.mergedIntoId !== id) return getThread(t.mergedIntoId, { userId, money })
  const linked = await linkedOrderNumbers(t)
  const [context, pastThreads, customerSince, customerCount] = await Promise.all([
    customerContext(t.customerEmail, { linked }),
    t.customerEmail ? prisma.supportThread.findMany({
      where: { customerEmail: t.customerEmail, id: { not: t.id }, mergedIntoId: null },
      orderBy: { lastMessageAt: 'desc' }, take: 6,
      select: { id: true, subject: true, status: true, lastMessageAt: true, messageCount: true },
    }) : [],
    t.customerEmail ? prisma.supportThread.aggregate({ where: { customerEmail: t.customerEmail }, _min: { createdAt: true } }) : null,
    t.customerEmail ? prisma.supportThread.count({ where: { customerEmail: t.customerEmail, mergedIntoId: null } }) : 0,
  ])
  const readAt = userId ? t.reads?.[0]?.readAt : null
  const instagram = t.channel === 'instagram'
  return {
    ...row(t, readAt),
    gmailThreadId: t.gmailThreadId,
    createdAt: t.createdAt,
    // Meta's rule: a DM may be answered within 24 hours of the customer's last message. Null for email.
    replyWindow: instagram ? replyWindow(t) : null,
    messages: t.messages.map(m => {
      const text = instagram ? m.bodyText : stripQuoted(m.bodyText)
      return {
        id: m.id,
        channel: m.channel || 'email',
        gmailMessageId: m.gmailMessageId,
        igMessageId: m.igMessageId,
        direction: m.direction,
        fromEmail: m.fromEmail,
        // A DM stored before Meta told us who they are keeps saying "Instagram user"; show what we know now.
        fromName: instagram && m.direction === 'in' ? (t.customerName || (t.igUsername ? `@${t.igUsername}` : m.fromName)) : m.fromName,
        toEmails: m.toEmails,
        ccEmails: m.ccEmails,
        subject: m.subject,
        text,
        quoted: m.bodyText.length > text.length ? m.bodyText.slice(text.length).trim() : '',
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
        sentAt: m.sentAt,
        sentBy: m.sentBy || null,
      }
    }),
    notes: t.notes.map(noteRow),
    customer: {
      email: t.customerEmail,
      name: t.customerName,
      instagram: t.igUsername || null,
      firstSeen: customerSince?._min?.createdAt || t.createdAt,
      // An Instagram customer has one conversation, this one, for as long as the thread lives.
      conversations: t.customerEmail ? customerCount : 1,
    },
    context: money ? context : withoutSpend(context),
    suggestedOrders: await mentionedOrders(t, context),
    pastThreads,
  }
}

/**
 * Order numbers the customer wrote ("#4807", "order 4807", "order number: 4807")
 * that are real orders and not already in the panel: offered with a Link button,
 * so an Instagram DM or a message from another address finds its order.
 */
const MENTION = /(?:#\s?|\border\s*(?:number|no\.?|num|#)?\s*(?:is|:)?\s*#?)(\d{4,6})\b/gi
async function mentionedOrders(t, context) {
  const shown = new Set(context.orders.map(o => String(o.number)))
  const numbers = []
  for (const m of t.messages) {
    if (m.direction !== 'in') continue
    for (const hit of `${m.subject || ''} ${m.bodyText || ''}`.matchAll(MENTION)) {
      const n = normalizeOrderNumber(hit[1])
      if (n && !shown.has(n) && !numbers.includes(n)) numbers.push(n)
    }
  }
  if (!numbers.length) return []
  const out = []
  for (const n of numbers.slice(0, 5)) {
    const rows = await prisma.order.findMany({
      where: { OR: orderNumberWhere(n) },
      select: { raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true, runnerName: true, runnerNameOverride: true, createdAt: true },
      orderBy: { lineItemIndex: 'asc' },
    })
    if (!rows.length) continue
    out.push({
      number: n,
      orderedAt: rows[0].createdAt,
      items: rows.map(r => ({
        race: r.raceNameOverride || r.raceName || 'Print',
        year: r.yearOverride || r.raceYear || null,
        runner: r.runnerNameOverride || r.runnerName || null,
      })),
    })
  }
  return out
}

function withoutSpend(context) {
  const { spentUsd: _spent, ...rest } = context
  return { ...rest, orders: rest.orders.map(({ totalUsd: _total, ...o }) => o) }
}

export function noteRow(n) {
  return { id: n.id, kind: n.kind, body: n.body, data: n.data || null, author: n.author || null, authorName: n.authorName, mentions: n.mentions || [], createdAt: n.createdAt }
}

// ---------------------------------------------------------------------------
// Changing a thread. Each change leaves an event in the timeline.
// ---------------------------------------------------------------------------

function actorName(actor) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
}

async function event(threadId, body, actor) {
  return prisma.supportNote.create({ data: { threadId, kind: 'event', body, authorId: actor?.id || null, authorName: actorName(actor) } })
}

const withAssignee = { include: { assignee: { select: TEAM_SELECT } } }

export async function setStatus(id, status, actor) {
  if (!STATUSES.includes(status)) throw new UserError(`Unknown status: ${status}`)
  const before = await prisma.supportThread.findUnique({ where: { id }, select: { status: true } })
  const t = await prisma.supportThread.update({ where: { id }, data: { status, snoozedUntil: null }, ...withAssignee })
  if (before?.status !== status) {
    const verb = status === 'closed' ? 'closed this' : status === 'open' && before?.status === 'closed' ? 'reopened this'
      : status === 'escalated' ? 'escalated this' : status === 'waiting' ? 'marked this waiting on the customer'
      : before?.status === 'waiting' ? 'marked this open again' : 'reopened this'
    await event(id, `${actorName(actor)} ${verb}`, actor)
  }
  return row(t)
}

export async function assign(id, assigneeId, actor) {
  let who = null
  if (assigneeId) {
    who = await prisma.user.findUnique({ where: { id: assigneeId }, select: { ...TEAM_SELECT, isActive: true } })
    if (!who?.isActive) throw new UserError('That teammate is not active')
  }
  const t = await prisma.supportThread.update({ where: { id }, data: { assigneeId: assigneeId || null }, ...withAssignee })
  const target = !who ? 'unassigned this' : who.id === actor?.id ? 'took this' : `assigned this to ${who.firstName}`
  await event(id, `${actorName(actor)} ${target}`, actor)
  return row(t)
}

export async function snooze(id, until, actor) {
  const d = until ? new Date(until) : null
  if (d && Number.isNaN(d.getTime())) throw new UserError('Bad snooze time')
  const t = await prisma.supportThread.update({ where: { id }, data: { snoozedUntil: d, status: 'open' }, ...withAssignee })
  await event(id, d ? `${actorName(actor)} snoozed this until ${d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : `${actorName(actor)} unsnoozed this`, actor)
  return row(t)
}

export async function setPriority(id, priority, actor) {
  const t = await prisma.supportThread.update({ where: { id }, data: { priority: Boolean(priority) }, ...withAssignee })
  await event(id, `${actorName(actor)} ${priority ? 'marked this priority' : 'removed priority'}`, actor)
  return row(t)
}

export async function setTags(id, tags) {
  const clean = [...new Set((Array.isArray(tags) ? tags : []).map(s => String(s).trim()).filter(Boolean))].slice(0, 12)
  const t = await prisma.supportThread.update({ where: { id }, data: { tags: clean }, ...withAssignee })
  return row(t)
}

/** An internal note. Mentions are teammate ids the client resolved from @names; only active ones are kept. */
export async function addNote(id, { body, mentions = [] }, actor) {
  const text = String(body || '').trim()
  if (!text) throw new UserError('Write something first')
  const ids = [...new Set(mentions.map(String))]
  const valid = ids.length ? await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } }) : []
  const n = await prisma.supportNote.create({
    data: { threadId: id, kind: 'note', body: text, authorId: actor?.id || null, authorName: actorName(actor), mentions: valid.map(u => u.id) },
    include: { author: { select: TEAM_SELECT } },
  })
  return noteRow(n)
}

export async function deleteNote(noteId, actor) {
  const n = await prisma.supportNote.findUnique({ where: { id: noteId } })
  if (!n || n.kind !== 'note') throw new UserError('No such note')
  if (n.authorId !== actor?.id && actor?.role !== 'admin') throw new UserError('Only the author or an admin can delete a note')
  await prisma.supportNote.delete({ where: { id: noteId } })
  return { id: noteId }
}

/**
 * A suggested action on Claude's draft was approved (it ran) or dismissed:
 * recorded on the draft so it is not offered, or run, again.
 */
export async function setProposal(threadId, noteId, proposalId, status, actor) {
  if (!['done', 'dismissed'].includes(status)) throw new UserError('status is done or dismissed')
  const n = await prisma.supportNote.findUnique({ where: { id: noteId } })
  if (!n || n.kind !== 'draft' || n.threadId !== threadId) throw new UserError('No such draft')
  const data = n.data && typeof n.data === 'object' ? n.data : {}
  const proposals = (Array.isArray(data.proposals) ? data.proposals : []).map(p => p.id === proposalId ? { ...p, status, by: [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || null, at: new Date().toISOString() } : p)
  const row = await prisma.supportNote.update({ where: { id: noteId }, data: { data: { ...data, proposals } }, include: { author: { select: { id: true, firstName: true, lastName: true } } } })
  return noteRow(row)
}

/** This person has seen the thread as it stands now. */
export async function markRead(id, userId) {
  if (!userId) return
  await prisma.supportRead.upsert({ where: { threadId_userId: { threadId: id, userId } }, update: { readAt: new Date() }, create: { threadId: id, userId } })
}

export async function markUnread(id, userId) {
  if (!userId) return
  await prisma.supportRead.deleteMany({ where: { threadId: id, userId } })
}

// ---------------------------------------------------------------------------
// Who is writing in
// ---------------------------------------------------------------------------

const ORDERS_BY_EMAIL = `
  query($q: String!) {
    orders(first: 10, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id legacyResourceId name createdAt email
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        discountCodes
        shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 phone }
        fulfillments { status createdAt displayStatus deliveredAt service { handle } trackingInfo { url number company } }
        lineItems(first: 20) { nodes { title variantTitle quantity customAttributes { key value } } }
      }
    }
  }
`

function shipToLine(a) {
  if (!a) return ''
  return [a.name, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ')
}

/** One address shape for Shopify, Artelo and our own column. */
function fromShopifyAddress(a) {
  if (!a) return null
  return { name: a.name || '', address1: a.address1 || '', address2: a.address2 || '', city: a.city || '', province: a.provinceCode || '', zip: a.zip || '', country: a.countryCodeV2 || '', phone: a.phone || '' }
}
function fromArteloAddress(a) {
  if (!a || !(a.street1 || a.city)) return null
  return { name: a.name || '', address1: a.street1 || '', address2: a.street2 || '', city: a.city || '', province: a.state || '', zip: a.zipcode || '', country: a.countryCode || '', phone: a.phone || '' }
}
function fromOurAddress(a) {
  if (!a || !(a.line1 || a.address1 || a.city)) return null
  return { name: a.name || '', address1: a.line1 || a.address1 || '', address2: a.line2 || a.address2 || '', city: a.city || '', province: a.state || a.province || '', zip: a.zip || '', country: a.country || '', phone: a.phone || '' }
}

/** Our row for a line item, as the panel shows it: what was ordered, where it is, and its picture. */
function itemRow(o, catalog) {
  const info = getProductInfo(o, catalog)
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    item: o.lineItemIndex + 1,
    type: o.trackstarOrderType,
    status: o.status,
    designStatus: ['custom', 'race_partner'].includes(o.trackstarOrderType) ? o.designStatus : null,
    runner: o.runnerNameOverride || o.runnerName,
    race: o.raceNameOverride || o.raceName,
    year: o.yearOverride || o.raceYear,
    size: o.productSize,
    frame: o.frameType,
    isRush: o.isRushOrder || o.rushOverride,
    dueDate: o.dueDate,
    approvalUrl: approvalUrl(o.approvalToken?.token),
    hasPhoto: Boolean(o.photoPath),
    heroImageUrl: info?.heroImageUrl || null,
    productLabel: info?.label || null,
  }
}

/**
 * Everything about this customer's orders, in one shape: Shopify's view of
 * each order with our rows for its line items beside it, then any of our
 * rows Shopify did not return (Etsy, or an email that differs). Shopify
 * being down costs the live half, never the page.
 */
export async function customerContext(email, { linked = [] } = {}) {
  const e = String(email || '').trim().toLowerCase()
  if (!e && !linked.length) return { orders: [], shopifyError: null }

  // Orders under their email, plus any a teammate linked to them by number
  // because they bought under a different address.
  const linkedWhere = linked.flatMap(orderNumberWhere)
  const [ours, catalog] = await Promise.all([
    prisma.order.findMany({
      where: { OR: [...(e ? [{ customerEmail: { equals: e, mode: 'insensitive' } }] : []), ...linkedWhere] },
      orderBy: [{ createdAt: 'desc' }, { lineItemIndex: 'asc' }],
      take: 60,
      include: { approvalToken: { select: { token: true } } },
    }),
    loadProductCatalog().catch(() => null),
  ])
  // Our Shopify rows carry Shopify's numeric order id as parentOrderNumber
  // and the number a person reads (#4517) inside shopifyOrderData.name, so
  // a Shopify order is matched by its id first and its name second.
  const byKey = new Map()
  const keyOf = o => String(o.shopifyOrderData?.id || o.parentOrderNumber)
  const nameOf = o => String(o.shopifyOrderData?.name || o.parentOrderNumber).replace(/^#/, '')
  for (const o of ours) {
    const key = keyOf(o)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(o)
  }
  const byName = new Map()
  for (const [, rows] of byKey) byName.set(nameOf(rows[0]), rows)

  let shopify = []
  let shopifyError = null
  if (process.env.SHOPIFY_STORE) {
    try {
      // Two searches, not one OR'd query: ten orders under the email must not
      // crowd a linked order out of the results.
      const [byEmail, byNumber] = await Promise.all([
        e ? shopifyGraphQL(ORDERS_BY_EMAIL, { q: `email:${e}` }) : null,
        linked.length ? shopifyGraphQL(ORDERS_BY_EMAIL, { q: linked.map(n => `name:#${n}`).join(' OR ') }) : null,
      ])
      const seenIds = new Set()
      for (const node of [...(byEmail?.orders?.nodes || []), ...(byNumber?.orders?.nodes || [])]) {
        if (seenIds.has(node.legacyResourceId)) continue
        seenIds.add(node.legacyResourceId)
        shopify.push(node)
      }
    } catch (err) {
      // The page says Shopify did not answer; the detail stays in the log.
      shopifyError = 'Shopify did not answer, so payment, fulfillment and tracking may be missing.'
      console.warn(`[support] Shopify orders for ${e || linked.join(',')}: ${err.message}`)
    }
  }

  const fromRows = rows => {
    const first = rows[0]
    return {
      arteloUrl: arteloOrderUrl(first?.arteloOrderData?.id) || null,
      arteloAddress: fromArteloAddress(first?.arteloOrderData?.customerAddress),
      items: rows.map(o => itemRow(o, catalog)),
    }
  }

  const orders = []
  const seen = new Set()
  const shopifyEmailOf = new Map(shopify.map(n => [String(n.name || '').replace(/^#/, ''), String(n.email || '').toLowerCase()]))
  for (const s of shopify) {
    const number = String(s.name || '').replace(/^#/, '')
    const rows = byKey.get(String(s.legacyResourceId)) || byName.get(number) || []
    if (rows.length) seen.add(keyOf(rows[0]))
    const shipTo = fromShopifyAddress(s.shippingAddress)
    orders.push({
      number,
      source: 'shopify',
      shopifyOrderId: s.legacyResourceId,
      adminUrl: shopifyAdminUrl(s.legacyResourceId),
      createdAt: s.createdAt,
      financialStatus: s.displayFinancialStatus,
      fulfillmentStatus: s.displayFulfillmentStatus,
      totalUsd: s.totalPriceSet?.shopMoney?.currencyCode === 'USD' ? Number(s.totalPriceSet.shopMoney.amount) || 0 : null,
      discountCodes: s.discountCodes || [],
      shipTo,
      shipToLine: shipToLine(shipTo),
      // Artelo fulfills through Shopify: each fulfillment it creates carries
      // its tracking, so this is Artelo's tracking, read live.
      tracking: (s.fulfillments || []).flatMap(f => (f.trackingInfo || []).map(t => ({ url: t.url, number: t.number, company: t.company, at: f.createdAt, fromArtelo: f.service?.handle === 'artelo', deliveredAt: f.deliveredAt || (f.displayStatus === 'DELIVERED' ? f.createdAt : null) }))),
      // When none of our rows exist yet (not imported), what was bought, from Shopify.
      lineItems: rows.length ? [] : (s.lineItems?.nodes || []).filter(li => !/add-?on/i.test(li.title)).map(li => ({ title: li.title, variant: li.variantTitle, quantity: li.quantity })),
      imported: rows.length > 0,
      ...fromRows(rows),
    })
  }
  for (const [key, rows] of byKey) {
    if (seen.has(key)) continue
    const first = rows[0]
    const shipTo = fromOurAddress(first.shippingAddress) || fromArteloAddress(first.arteloOrderData?.customerAddress)
    orders.push({
      number: nameOf(first),
      source: first.source,
      shopifyOrderId: first.source === 'shopify' ? String(first.shopifyOrderData?.id || '') || null : null,
      adminUrl: first.source === 'shopify' ? shopifyAdminUrl(first.shopifyOrderData?.id) : null,
      createdAt: first.shopifyOrderData?.created_at || first.createdAt,
      financialStatus: null,
      fulfillmentStatus: null,
      totalUsd: getOrderTotalUsd(first),
      discountCodes: (first.shopifyOrderData?.discount_codes || []).map(d => d.code).filter(Boolean),
      shipTo,
      shipToLine: shipToLine(shipTo),
      tracking: first.trackingNumber ? [{ url: null, number: first.trackingNumber, company: first.trackingCarrier, at: first.shippedAt, fromArtelo: false, deliveredAt: null }] : [],
      lineItems: [],
      imported: true,
      ...fromRows(rows),
    })
  }
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  // Mark the ones that are here only because a teammate linked them, so the
  // panel can say so and offer to unlink. An order under their own email
  // needs no link, even if someone added one.
  const linkedSet = new Set(linked)
  for (const o of orders) {
    const underEmail = e && (
      o.items.some(it => ours.find(r => r.id === it.orderId && String(r.customerEmail || '').toLowerCase() === e)) ||
      shopifyEmailOf.get(o.number) === e
    )
    o.linked = linkedSet.has(o.number) && !underEmail
  }
  // The designs and proofs a rep can attach, per order.
  let mockups = []
  try { mockups = await listMockups(ours.map(o => o.id)) } catch (err) { console.warn(`[support] mockups: ${err.message}`) }
  for (const o of orders) {
    const ids = new Set(o.items.map(it => it.orderId))
    o.mockups = mockups.filter(m => ids.has(m.orderId))
  }
  // Replacements live only in Artelo: each goes just above the order it replaces.
  for (const r of await replacementsFor(orders).catch(() => [])) {
    const at = orders.findIndex(o => o.source !== 'replacement' && o.number === r.replacement.of)
    orders.splice(at < 0 ? orders.length : at, 0, r)
  }
  // What they have spent with us across these orders, refunds left out: the
  // same Big Spender line the order view uses.
  const spentUsd = Math.round(orders.filter(o => o.financialStatus !== 'REFUNDED').reduce((n, o) => n + (o.totalUsd || 0), 0) * 100) / 100
  return { orders, shopifyError, spentUsd, bigSpender: spentUsd >= BIG_SPENDER_THRESHOLD_USD }
}

// ---------------------------------------------------------------------------
// Orders linked by hand: the customer wrote in from a different email than
// the one they ordered under. Stored per customer, so it sticks.
// ---------------------------------------------------------------------------

/**
 * Our rows for an order number. Shopify's order name is stored as "5281" on
 * nearly every row but "#5281" on a few early ones, so both are matched; an
 * Etsy order's number is its receipt id.
 */
export function orderNumberWhere(n) {
  return [
    { shopifyOrderData: { path: ['name'], equals: n } },
    { shopifyOrderData: { path: ['name'], equals: `#${n}` } },
    { source: 'etsy', parentOrderNumber: n },
  ]
}

/** Who this conversation is with, as a stable key: their email, or their Instagram id. */
export function customerKeyOf(t) {
  const email = String(t?.customerEmail || '').trim().toLowerCase()
  if (email) return email
  return t?.igUserId ? `ig:${t.igUserId}` : ''
}

export async function linkedOrderNumbers(t) {
  const key = customerKeyOf(t)
  if (!key) return []
  const rows = await prisma.supportLinkedOrder.findMany({ where: { customerKey: key }, orderBy: { createdAt: 'asc' }, select: { orderNumber: true } })
  return rows.map(r => r.orderNumber)
}

function userError(message) {
  return new UserError(message)
}

/** "#4517", "4517" or "4517-2" (our per-item number) all mean order 4517. */
export function normalizeOrderNumber(raw) {
  const n = String(raw || '').trim().replace(/^#/, '').replace(/\s+/g, '').replace(/-\d+$/, '')
  return /^\d{3,12}$/.test(n) ? n : null
}

const ORDER_BY_NAME = `query($q: String!) { orders(first: 1, query: $q) { nodes { name email } } }`

export async function linkOrder(threadId, raw, actor) {
  const t = await prisma.supportThread.findUnique({ where: { id: threadId } })
  if (!t) throw userError('No such thread')
  const number = normalizeOrderNumber(raw)
  if (!number) throw userError('Enter an order number, like 4517')
  const key = customerKeyOf(t)
  if (!key) throw userError('This conversation has no email or Instagram id to link an order to')

  // It has to be a real order: ours first, then Shopify (not imported yet).
  const ours = await prisma.order.findFirst({
    where: { OR: orderNumberWhere(number) },
    select: { customerEmail: true },
  })
  let orderEmail = ours?.customerEmail || ''
  if (!ours) {
    const data = await shopifyGraphQL(ORDER_BY_NAME, { q: `name:#${number}` })
    const node = (data?.orders?.nodes || []).find(n => String(n.name).replace(/^#/, '') === number)
    if (!node) throw userError(`We can't find order #${number}`)
    orderEmail = node.email || ''
  }

  await prisma.supportLinkedOrder.upsert({
    where: { customerKey_orderNumber: { customerKey: key, orderNumber: number } },
    create: { customerKey: key, orderNumber: number, orderEmail: String(orderEmail).toLowerCase(), linkedById: actor?.id || null, linkedByName: actorName(actor) },
    update: {},
  })
  await event(threadId, `Linked order #${number}${orderEmail ? ` (ordered under ${orderEmail})` : ''}`, actor)
  return { number, orderEmail }
}

export async function unlinkOrder(threadId, raw, actor) {
  const t = await prisma.supportThread.findUnique({ where: { id: threadId } })
  if (!t) throw userError('No such thread')
  const number = normalizeOrderNumber(raw)
  const key = customerKeyOf(t)
  if (!number || !key) throw userError('Nothing to unlink')
  const { count } = await prisma.supportLinkedOrder.deleteMany({ where: { customerKey: key, orderNumber: number } })
  if (count) await event(threadId, `Unlinked order #${number}`, actor)
  return { number, removed: count }
}

// ---------------------------------------------------------------------------
// Whose order is it? The quick actions take an order id from the page; they
// may only act on an order this conversation is about.
// ---------------------------------------------------------------------------

const ORDER_OWNER = `query($id: ID!) { order(id: $id) { name email } }`

/**
 * Refuse unless the order is under the thread's email or is one a teammate
 * linked to this customer. `shopifyOrderId` is Shopify's numeric id;
 * `orderId` is one of our rows. Reads our table first and asks Shopify only
 * for an order we have not imported.
 */
export async function assertOrderInThread(thread, { shopifyOrderId, orderId } = {}) {
  const email = String(thread?.customerEmail || '').trim().toLowerCase()
  const linked = new Set(await linkedOrderNumbers(thread))
  const refuse = () => { throw userError('That order is not on this conversation. Link it to the customer first.') }
  const mine = (orderEmail, number) => (email && String(orderEmail || '').trim().toLowerCase() === email) || (number && linked.has(String(number).replace(/^#/, '')))
  const numberOf = r => String(r.shopifyOrderData?.name || r.parentOrderNumber || '').replace(/^#/, '')

  if (orderId) {
    const r = await prisma.order.findUnique({ where: { id: String(orderId) }, select: { customerEmail: true, parentOrderNumber: true, shopifyOrderData: true } })
    if (!r || !mine(r.customerEmail, numberOf(r))) refuse()
  }
  if (shopifyOrderId !== undefined && shopifyOrderId !== null && shopifyOrderId !== '') {
    const id = String(shopifyOrderId).trim().replace(/^gid:\/\/shopify\/Order\//, '')
    if (!/^\d+$/.test(id)) refuse()
    const rows = await prisma.order.findMany({ where: { source: 'shopify', parentOrderNumber: id }, select: { customerEmail: true, parentOrderNumber: true, shopifyOrderData: true } })
    // Our rows first; Shopify's own email on the order when ours do not say
    // (not imported yet, or imported without the address).
    if (!rows.some(r => mine(r.customerEmail, numberOf(r)))) {
      const data = await shopifyGraphQL(ORDER_OWNER, { id: `gid://shopify/Order/${id}` })
      const o = data?.order
      if (!o || !mine(o.email, o.name)) refuse()
    }
  }
}
