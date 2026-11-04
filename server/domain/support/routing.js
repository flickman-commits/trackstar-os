/**
 * Where a new conversation goes: a rule per channel, the way new orders
 * have one per order type (server/domain/orders/assignment.js).
 *
 *   { email:     { mode, people: [{ userId, weight }] },
 *     instagram: { mode, people: [{ userId, weight }] } }
 *
 *   mode 'none'    nobody; it waits in All open
 *   mode 'person'  everything to the first person
 *   mode 'split'   to whoever is furthest below their share of the open
 *                  conversations (open, waiting, escalated, any channel);
 *                  weight 0.5 is half a share, 2 a double share
 *
 * Kept in SystemConfig (support_routing). Before rules existed there was one
 * person for everything (support_default_assignee); that still reads as
 * "person" on both channels until the rules are saved once.
 *
 * The history import never assigns: a year of closed threads is not
 * anyone's work. Its own file, with no imports from the channels, because
 * both channels read it as they create a thread.
 */
import prisma from '../../db.js'
import { can } from '../../../api/_lib/roles.js'
import { UserError } from './errors.js'

const KEY = 'support_routing'
const LEGACY_KEY = 'support_default_assignee'
export const CHANNELS = ['email', 'instagram']
const MODES = ['none', 'person', 'split']
// An Instagram thread only our automation has written in is not work yet (threads.js AUTOMATION_ONLY): it neither counts toward a share nor gets handed out.
const OPENISH = { status: { in: ['open', 'waiting', 'escalated'] }, mergedIntoId: null, filtered: false, NOT: { channel: 'instagram', lastInboundAt: null } }

const emptyRule = () => ({ mode: 'none', people: [] })

/** The rules as saved, or as the old single setting implies. */
export async function getRouting() {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } })
  if (row?.value) {
    try {
      const saved = JSON.parse(row.value)
      return Object.fromEntries(CHANNELS.map(c => [c, normalizeRule(saved?.[c])]))
    } catch { /* fall through to the legacy setting */ }
  }
  const legacy = await prisma.systemConfig.findUnique({ where: { key: LEGACY_KEY } })
  const rule = legacy?.value ? { mode: 'person', people: [{ userId: legacy.value, weight: 1 }] } : emptyRule()
  return Object.fromEntries(CHANNELS.map(c => [c, rule]))
}

function normalizeRule(r) {
  const mode = MODES.includes(r?.mode) ? r.mode : 'none'
  const people = (Array.isArray(r?.people) ? r.people : [])
    .map(p => ({ userId: String(p?.userId || ''), weight: [0.5, 1, 2].includes(Number(p?.weight)) ? Number(p.weight) : 1 }))
    .filter((p, i, all) => p.userId && all.findIndex(x => x.userId === p.userId) === i)
  return { mode: people.length ? mode : 'none', people: mode === 'person' ? people.slice(0, 1) : people }
}

/**
 * Of the people in a split, the one furthest below their share: open
 * conversations divided by weight, lowest wins; a tie goes to whoever was
 * given one least recently (here: listed first). Pure, for the tests.
 */
export function pickByShare(people, loads) {
  let best = null
  for (const p of people) {
    const score = (loads[p.userId] || 0) / (p.weight || 1)
    if (!best || score < best.score) best = { userId: p.userId, score }
  }
  return best?.userId || null
}

/** Who can still receive: active, and their role includes Support. */
async function eligible(people) {
  if (!people.length) return []
  const users = await prisma.user.findMany({ where: { id: { in: people.map(p => p.userId) }, isActive: true }, select: { id: true, role: true, extraRoles: true } })
  const ok = new Set()
  for (const u of users) if (await can(u, 'support')) ok.add(u.id)
  return people.filter(p => ok.has(p.userId))
}

async function openLoads() {
  const rows = await prisma.supportThread.groupBy({ by: ['assigneeId'], where: { ...OPENISH, assigneeId: { not: null } }, _count: { _all: true } })
  return Object.fromEntries(rows.map(r => [r.assigneeId, r._count._all]))
}

/** The person a new conversation on this channel goes to, or null. */
export async function assigneeFor(channel = 'email') {
  const rules = await getRouting()
  const rule = rules[channel] || emptyRule()
  if (rule.mode === 'none') return null
  const people = await eligible(rule.people)
  if (!people.length) return null
  if (rule.mode === 'person') return people[0].userId
  return pickByShare(people, await openLoads())
}

/** Kept for the callers that predate channels. */
export const defaultAssigneeId = assigneeFor

/**
 * Save the rules. With applyToOpen, open conversations nobody has yet are
 * routed by them now, each with an event saying who did it.
 */
export async function saveRouting(input, { applyToOpen = false, actor } = {}) {
  const rules = Object.fromEntries(CHANNELS.map(c => [c, normalizeRule(input?.[c])]))
  const ids = [...new Set(CHANNELS.flatMap(c => rules[c].people.map(p => p.userId)))]
  if (ids.length) {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, isActive: true, role: true, extraRoles: true } })
    for (const id of ids) {
      const u = users.find(x => x.id === id)
      if (!u?.isActive) throw new UserError('One of those teammates is not active')
      if (!(await can(u, 'support'))) throw new UserError(`${u.firstName}'s role does not include Support`)
    }
  }
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value: JSON.stringify(rules) }, create: { key: KEY, value: JSON.stringify(rules) } })
  await prisma.systemConfig.deleteMany({ where: { key: LEGACY_KEY } })

  let assigned = 0
  if (applyToOpen) {
    const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
    const loads = await openLoads()
    const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true } })).map(u => [u.id, u.firstName]))
    for (const channel of CHANNELS) {
      const rule = rules[channel]
      if (rule.mode === 'none') continue
      const people = await eligible(rule.people)
      if (!people.length) continue
      const open = await prisma.supportThread.findMany({ where: { ...OPENISH, assigneeId: null, channel }, orderBy: { lastMessageAt: 'asc' }, select: { id: true } })
      for (const t of open) {
        const userId = rule.mode === 'person' ? people[0].userId : pickByShare(people, loads)
        loads[userId] = (loads[userId] || 0) + 1
        await prisma.$transaction([
          prisma.supportThread.update({ where: { id: t.id }, data: { assigneeId: userId } }),
          prisma.supportNote.create({ data: { threadId: t.id, kind: 'event', body: `${by} routed this to ${names[userId] || 'a teammate'}`, authorId: actor?.id || null, authorName: by } }),
        ])
        assigned++
      }
    }
  }
  return { routing: rules, assigned }
}

/** The old one-person setter, as a rule on both channels. */
export async function setDefaultAssignee(userId, opts = {}) {
  const rule = userId ? { mode: 'person', people: [{ userId, weight: 1 }] } : emptyRule()
  const out = await saveRouting({ email: rule, instagram: rule }, opts)
  return { defaultAssigneeId: userId || null, assigned: out.assigned }
}
