/**
 * Team tools: who has what, and moving orders between people. current_team
 * is read; assign_order and run_import are writes done as the person behind
 * the key; help shifts are admin.
 */
import { z } from 'zod'
import prisma from '../../../../api/_lib/prisma.js'
import { ToolError } from '../server.js'
import { can } from '../../../../api/_lib/roles.js'
import { findOrdersByNumber, displayNumber } from './orders.js'
import { rosterFor, getShifts, addShift, endShift, spreadQueue, openCounts, SHARE_WEIGHTS, businessDate } from '../../../domain/orders/assignment.js'
import { processOrders } from '../../../processOrders.js'
import { runLockedImport } from '../../../lib/importStamp.js'

/** "Dan", "dan currie", "me" or "nobody" -> a user row, null for nobody. */
export async function resolveTeammate(who, principal) {
  const w = String(who || '').trim().toLowerCase()
  if (!w) throw new ToolError('Say who: a first name, "me", or "nobody".')
  if (w === 'nobody' || w === 'unassigned') return null
  if (w === 'me') {
    if (!principal.user) throw new ToolError('"me" needs a key that acts as a person.')
    return principal.user
  }
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, firstName: true, lastName: true, email: true, role: true, extraRoles: true, extraCaps: true, deniedCaps: true } })
  const full = u => `${u.firstName} ${u.lastName || ''}`.trim().toLowerCase()
  const hits = users.filter(u => u.firstName.toLowerCase() === w || full(u) === w)
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) throw new ToolError(`More than one ${who}: ${hits.map(full).join(', ')}. Use the full name.`)
  throw new ToolError(`Nobody on the team is called "${who}". The team: ${users.map(u => u.firstName).join(', ')}.`)
}

const DESIGN_TYPES = new Set(['custom', 'race_partner'])

/**
 * The messages addShift, endShift and spreadQueue throw for a person to read
 * (server/domain/orders/assignment.js throws plain Errors). Anything else is
 * a server fault and goes out as the generic failure with a reference.
 */
const SHIFT_MESSAGES = [
  /^Help is for standard or custom orders$/, /^Pick the first and last day$/, /^The last day is before the first$/,
  /^Those dates are already over$/, /^Pick a share$/, /^Pick an active teammate$/, /^\S.* already gets every \w+ order$/,
  /^\S.* already has a shift on those days$/, /^No such shift$/, /^That shift is not on today$/,
]
function shiftError(err) {
  const msg = String(err?.message || '')
  if (err && !err.expose && err.constructor === Error && SHIFT_MESSAGES.some(re => re.test(msg))) return new ToolError(msg)
  return err
}

const TYPE_LABEL = { standard: 'Standard orders', custom: 'Custom orders', race_partner: 'Partner orders', bulk: 'Bulk orders' }

export const teamTools = [
  {
    name: 'current_team',
    title: 'Current team',
    description: 'Who new orders go to today for each type (the regular and any help on a shift, with shares and open counts), and the help shifts planned.',
    scope: 'read',
    readOnly: true,
    input: {},
    async handler() {
      const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, firstName: true } })
      const name = id => users.find(u => u.id === id)?.firstName || '?'
      const today = businessDate()
      const queues = {}
      for (const t of Object.keys(TYPE_LABEL)) {
        const roster = await rosterFor(t)
        const counts = await openCounts(t, roster.map(r => r.userId))
        const weightSum = roster.reduce((a, r) => a + r.weight, 0) || 1
        queues[TYPE_LABEL[t]] = roster.map(r => ({ name: name(r.userId), regular: r.regular, share: `${Math.round((r.weight / weightSum) * 100)}%`, open: counts[r.userId] || 0 }))
      }
      const shifts = (await getShifts()).filter(s => !s.handedBackAt && s.until >= today)
        .map(s => ({ id: s.id, type: TYPE_LABEL[s.type], who: name(s.userId), share: s.weight, from: s.from, until: s.until, on: s.from <= today }))
      return { today, queues, helpShifts: shifts }
    },
  },
  {
    name: 'assign_order',
    title: 'Assign order',
    description: 'Hand an order to someone: a first name, "me", or "nobody". Every item on the order moves.',
    scope: 'write',
    readOnly: false,
    input: { orderNumber: z.string().max(40), to: z.string().max(60).describe('A first name, "me", or "nobody".') },
    async handler({ orderNumber, to }, { principal }) {
      const rows = await findOrdersByNumber(orderNumber)
      if (!rows.length) throw new ToolError(`No order matching "${orderNumber}".`)
      // Design jobs are handed out by whoever runs design (Head of Design, or an
      // admin), the same rule as api/orders/assign.js.
      if (rows.some(r => DESIGN_TYPES.has(r.trackstarOrderType)) && !(principal.role === 'admin' || await can(principal, 'orders.assign_custom'))) {
        throw new ToolError('Only the Head of Design or an admin can assign custom and partner orders.')
      }
      const who = await resolveTeammate(to, principal)
      await prisma.order.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { assigneeId: who?.id || null } })
      const n = displayNumber(rows[0])
      return { summary: `Assigned ${n} to ${who ? who.firstName : 'nobody'}`, orderNumber: n, items: rows.length, assignee: who?.firstName || null }
    },
  },
  {
    name: 'run_import',
    title: 'Run import',
    description: 'Pull new orders from Artelo and Shopify now rather than waiting for the next 10-minute run. Says how many came in.',
    scope: 'write',
    readOnly: false,
    input: {},
    async handler() {
      const out = await runLockedImport(() => processOrders({ runResearch: false, verbose: false }))
      if (out.skipped === 'already_running') return { summary: 'Import already running', alreadyRunning: true }
      return { summary: `Imported ${out.imported || 0}, updated ${out.updated || 0}`, imported: out.imported || 0, updated: out.updated || 0, skipped: out.skipped || 0 }
    },
  },
  {
    name: 'add_help_shift',
    title: 'Add help shift',
    description: 'Bring in extra help on standard or custom orders for a run of days. Share: 0.5 (half the regular), 1 (even), 2 (double). New orders are balanced between them while it is on; unfinished work goes back to the regular when it ends.',
    scope: 'admin',
    readOnly: false,
    input: {
      type: z.enum(['standard', 'custom']),
      who: z.string().max(60).describe('A first name.'),
      share: z.number().refine(w => SHARE_WEIGHTS.includes(w), 'Share is 0.5, 1 or 2').default(1),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('First day, YYYY-MM-DD.'),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Last day, YYYY-MM-DD.'),
    },
    async handler({ type, who, share = 1, from, until }, { principal }) {
      const user = await resolveTeammate(who, principal)
      if (!user) throw new ToolError('Help has to be a person.')
      try {
        const shift = await addShift({ type, userId: user.id, weight: share, from, until })
        return { summary: `${user.firstName} helps on ${type} orders ${from} to ${until}`, shift }
      } catch (err) { throw shiftError(err) }
    },
  },
  {
    name: 'end_help_shift',
    title: 'End help shift',
    description: 'End a help shift now (its id is in current_team). The helper\'s unfinished orders go back to the regular.',
    scope: 'admin',
    readOnly: false,
    input: { id: z.string().max(40) },
    async handler({ id }) {
      try {
        const out = await endShift(id)
        return { summary: `Ended shift ${id}; ${out.handedBack} order(s) back to the regular`, ...out }
      } catch (err) { throw shiftError(err) }
    },
  },
  {
    name: 'spread_order_list',
    title: 'Spread the order list',
    description: 'Give a helper on a shift their share of the orders already waiting (only ones nobody has started).',
    scope: 'admin',
    readOnly: false,
    input: { shiftId: z.string().max(40) },
    async handler({ shiftId }) {
      try {
        const out = await spreadQueue(shiftId)
        return { summary: `Moved ${out.moved} waiting order(s) to the helper`, moved: out.moved }
      } catch (err) { throw shiftError(err) }
    },
  },
]
