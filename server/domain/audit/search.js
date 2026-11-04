/**
 * Searching the Activity Log.
 *
 * One box: words match the summary, the action, the person (name or email)
 * and anything in the entry's detail. An order number also finds the order's
 * own entries by its internal id, so a design approval logged before the
 * entries carried the number (render.approved named the template file) still
 * turns up for "4883". Filters narrow by kind of action (its prefix, e.g.
 * "render" or "artelo"), by person, and by day range (Eastern).
 */
import prisma from '../../db.js'
import { Prisma } from '@prisma/client'

const escapeLike = s => String(s).replace(/[\\%_]/g, m => `\\${m}`)
const like = s => `%${escapeLike(s)}%`

/** Internal ids of the orders an order number names: "4883", "#4883", or a line item "4883-2". */
async function orderIdsFor(q) {
  const n = String(q).trim().replace(/^#/, '')
  if (!/^[0-9]{3,}(-[0-9]+)?$/.test(n)) return []
  const parent = n.split('-')[0]
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Order"
    WHERE "orderNumber" = ${n} OR "parentOrderNumber" = ${parent} OR "shopifyOrderData"->>'name' = ${`#${parent}`}
    LIMIT 50`
  return rows.map(r => r.id)
}

const TZ = 'America/New_York'
/** Midnight at the start of a day, Eastern, as an instant. */
function etStart(day) {
  const probe = new Date(`${day}T12:00:00Z`)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(probe).find(p => p.type === 'timeZoneName')?.value
  return new Date(`${day}T${name === 'EDT' ? '04' : '05'}:00:00Z`)
}
const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)

/**
 * @returns {Promise<{ events: object[], nextBefore: string|null, orderIds: string[] }>}
 */
export async function searchAudit({ q = '', prefix = '', userId = '', from = '', to = '', before = '', limit = 100 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const conds = [Prisma.sql`TRUE`]
  const text = String(q || '').trim().slice(0, 200)
  let orderIds = []
  if (text) {
    orderIds = await orderIdsFor(text)
    const p = like(text)
    const parts = [
      Prisma.sql`a.summary ILIKE ${p}`,
      Prisma.sql`a.action ILIKE ${p}`,
      Prisma.sql`a."actorEmail" ILIKE ${p}`,
      Prisma.sql`COALESCE(a.detail::text, '') ILIKE ${p}`,
      Prisma.sql`(COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", '')) ILIKE ${p}`,
    ]
    for (const id of orderIds) parts.push(Prisma.sql`COALESCE(a.detail::text, '') LIKE ${`%${id}%`}`)
    conds.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  if (prefix) conds.push(Prisma.sql`(a.action = ${String(prefix)} OR a.action LIKE ${`${escapeLike(prefix)}.%`})`)
  if (userId) conds.push(Prisma.sql`a."userId" = ${String(userId)}`)
  if (isDay(from)) conds.push(Prisma.sql`a."createdAt" >= ${etStart(from)}`)
  if (isDay(to)) conds.push(Prisma.sql`a."createdAt" < ${new Date(etStart(to).getTime() + 24 * 3600e3)}`)
  const b = before ? new Date(before) : null
  if (b && !Number.isNaN(b.getTime())) conds.push(Prisma.sql`a."createdAt" < ${b}`)

  const rows = await prisma.$queryRaw`
    SELECT a.id, a.action, a.summary, a.detail, a."createdAt", a."actorEmail", a."userId",
           u."firstName", u."lastName", u.email AS "userEmail"
    FROM "AuditEvent" a LEFT JOIN "User" u ON u.id = a."userId"
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY a."createdAt" DESC
    LIMIT ${take + 1}`
  const more = rows.length > take
  const page = rows.slice(0, take)
  return {
    events: page.map(e => ({
      id: e.id, action: e.action, summary: e.summary, detail: e.detail, createdAt: e.createdAt,
      actor: e.firstName ? [e.firstName, e.lastName].filter(Boolean).join(' ') : e.actorEmail,
      actorEmail: e.userEmail || e.actorEmail, userId: e.userId,
    })),
    nextBefore: more ? new Date(page[page.length - 1].createdAt).toISOString() : null,
    orderIds,
  }
}

/** The kinds of action in the log (prefix before the first dot), most used first, and the people in it. */
export async function auditFacets() {
  const [kinds, people] = await Promise.all([
    prisma.$queryRaw`SELECT split_part(action, '.', 1) AS prefix, count(*)::int AS n FROM "AuditEvent" GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT u.id, u."firstName", u."lastName", count(*)::int AS n
      FROM "AuditEvent" a JOIN "User" u ON u.id = a."userId"
      GROUP BY u.id, u."firstName", u."lastName" ORDER BY 4 DESC`,
  ])
  return {
    kinds: kinds.map(k => ({ prefix: k.prefix, count: k.n })),
    people: people.map(p => ({ id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(' '), count: p.n })),
  }
}
