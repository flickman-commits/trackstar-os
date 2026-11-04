/**
 * /api/orders/assign - who fulfills which order.
 *
 *   GET                                   the team (active users), the per-type defaults and
 *                                         who each queue goes to today;
 *                                         for admins also the shifts and open counts
 *   POST { orderId, assigneeId }          reassign one order; null unassigns
 *   POST { action:'defaults', standard, custom }   change the import defaults (admins only)
 *   POST { action:'add-shift', type, userId, weight, from, until }   extra help for some days (admins)
 *   POST { action:'end-shift', id }                end a shift now (admins)
 *   POST { action:'spread', id }                   give a helper their share of the waiting queue (admins)
 *   POST { action:'move-open', type, fromUserId, toUserId }   hand all of one person's open orders to another (admins)
 *
 * Shifts, the share balance and the hand-back: server/domain/orders/assignment.js.
 *
 * Reassigning is open to the whole team: covering for someone is the point.
 * Changing the defaults changes where every future order lands, so it needs
 * the admin role. Both are written to the audit log.
 */
import prisma from '../_lib/prisma.js'
import { setCors, requireAdmin } from '../_lib/auth.js'
import { requireAdminRole, recordAudit, loadActiveUser } from '../_lib/users.js'
import {
  getAssignmentDefaults, setAssignmentDefaults, ASSIGNABLE_TYPES,
  getShifts, addShift, endShift, spreadQueue, openCounts, businessDate, rosterFor,
  getRaceRules, setRaceRules, applyRaceRule, moveOpenOrders } from '../../server/domain/orders/assignment.js'
import { can } from '../_lib/roles.js'
import { getCanonicalRaceName } from '../../server/scrapers/index.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return

  try {
    if (req.method === 'GET') {
      const users = await prisma.user.findMany({
        where: { isActive: true },
        orderBy: { firstName: 'asc' },
        select: { id: true, firstName: true, lastName: true },
      })
      // Who new orders of each type go to today, for "Current Team" on the
      // dashboard: names and a helper's last day for everyone; each one's
      // share and open count for admins. The team list also feeds everyone's
      // reassign menu; shifts and counts are the admin's planning view.
      const me = await loadActiveUser(actor)
      const isAdmin = Boolean(me && (me.role === 'admin' || me.isSystem))
      const shifts = await getShifts()
      const ids = users.map(u => u.id)
      const open = {}
      const queues = {}
      for (const t of ASSIGNABLE_TYPES) {
        // Counted for everyone so people holding orders by hand appear below;
        // the numbers themselves only go to admins.
        open[t] = await openCounts(t, ids)
        const roster = await rosterFor(t)
        const weightSum = roster.reduce((a, r) => a + r.weight, 0) || 1
        queues[t] = roster.map(r => ({
          userId: r.userId,
          regular: r.regular,
          until: r.shiftId ? shifts.find(x => x.id === r.shiftId)?.until || null : null,
          ...(isAdmin ? { share: Math.round((r.weight / weightSum) * 100), open: open[t][r.userId] || 0 } : {}),
        }))
        // Race routing (standard): people who get every order for some races
        // are on the team too, even when they are not the regular or on a shift.
        if (t === 'standard') {
          const rules = await getRaceRules()
          const byUser = new Map()
          for (const r of rules) {
            if (!ids.includes(r.userId)) continue
            if (!byUser.has(r.userId)) byUser.set(r.userId, [])
            byUser.get(r.userId).push(r.race)
          }
          for (const [userId, races] of byUser) {
            const existing = queues[t].find(q => q.userId === userId)
            if (existing) { existing.races = races; continue }
            const routedOpen = open[t][userId] || 0
            queues[t].push({ userId, regular: false, until: null, races, ...(isAdmin ? { open: routedOpen } : {}) })
          }
        }
      }
      // Anyone else still holding open orders of a type (handed to them by
      // hand, or left from a shift) is on that team too, so the chips add up
      // to the queue.
      for (const t of ASSIGNABLE_TYPES) {
        for (const userId of ids) {
          if ((open[t][userId] || 0) > 0 && !queues[t].some(q => q.userId === userId)) {
            queues[t].push({ userId, regular: false, until: null, holding: true, ...(isAdmin ? { open: open[t][userId] } : {}) })
          }
        }
      }
      if (!isAdmin) for (const t of ASSIGNABLE_TYPES) for (const q of queues[t]) { delete q.open; delete q.share }
      const base = { users, defaults: await getAssignmentDefaults({ force: true }), queues, me: actor.id || null }
      if (!isAdmin) return res.status(200).json(base)
      // Races with open standard orders, busiest first, for the race routing picker.
      const openStd = await prisma.order.findMany({ where: { trackstarOrderType: 'standard', status: { not: 'completed' } }, select: { raceName: true, raceNameOverride: true, assigneeId: true } })
      const byRace = new Map()
      for (const o of openStd) {
        const name = getCanonicalRaceName(o.raceNameOverride || o.raceName) || o.raceNameOverride || o.raceName
        if (!name || name === 'Unknown Race') continue
        byRace.set(name, (byRace.get(name) || 0) + 1)
      }
      const raceOptions = [...byRace.entries()].sort((a, b) => b[1] - a[1]).map(([race, open]) => ({ race, open }))
      return res.status(200).json({ ...base, shifts, open, today: businessDate(), raceRules: await getRaceRules(), raceOptions })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})

    if (body.action === 'defaults') {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      const map = {}
      for (const t of ASSIGNABLE_TYPES) {
        if (!body[t]) continue
        const u = await prisma.user.findUnique({ where: { id: String(body[t]) }, select: { isActive: true } })
        if (!u?.isActive) return res.status(400).json({ error: `No active teammate for ${t}` })
        map[t] = String(body[t])
      }
      const saved = await setAssignmentDefaults(map)
      await recordAudit({ action: 'order.assignment-defaults', summary: 'Changed default assignees', detail: saved, actor: admin })
      return res.status(200).json({ defaults: saved })
    }

    if (['add-shift', 'end-shift', 'spread'].includes(body.action)) {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      try {
        if (body.action === 'add-shift') {
          const shift = await addShift({ type: body.type, userId: body.userId, weight: body.weight, from: body.from, until: body.until })
          await recordAudit({ action: 'order.shift-add', summary: `Added ${body.type} help ${shift.from} to ${shift.until}`, detail: shift, actor: admin })
          return res.status(200).json({ shift })
        }
        if (body.action === 'end-shift') {
          const out = await endShift(String(body.id || ''))
          await recordAudit({ action: 'order.shift-end', summary: `Ended a help shift early; ${out.handedBack} order(s) back to the regular`, detail: { id: body.id, ...out }, actor: admin })
          return res.status(200).json(out)
        }
        const out = await spreadQueue(String(body.id || ''))
        await recordAudit({ action: 'order.shift-spread', summary: `Moved ${out.moved} waiting order(s) to a helper`, detail: { id: body.id, ...out }, actor: admin })
        return res.status(200).json(out)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }
    }

    if (body.action === 'move-open') {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      try {
        const out = await moveOpenOrders({ type: String(body.type || ''), fromUserId: body.fromUserId, toUserId: body.toUserId })
        await recordAudit({ action: 'order.move-open', summary: `Moved ${out.moved} open ${body.type} order(s) from one teammate to another`, detail: { ...body, ...out }, actor: admin })
        return res.status(200).json(out)
      } catch (err) { return res.status(400).json({ error: err.message }) }
    }

    // Race routing for standard orders (admins): every order for a race to one person.
    if (body.action === 'race-rules') {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      const rules = await setRaceRules(body.rules)
      await recordAudit({ action: 'order.race-rules', summary: `Race routing: ${rules.map(r => r.race).join(', ') || 'none'}`, detail: rules, actor: admin })
      return res.status(200).json({ raceRules: rules })
    }
    if (body.action === 'apply-race-rule') {
      const admin = await requireAdminRole(req, res, actor)
      if (!admin) return
      try {
        const out = await applyRaceRule(String(body.race || ''))
        await recordAudit({ action: 'order.race-rule-applied', summary: `Moved ${out.moved} open ${body.race} order(s) to its routed person`, detail: { race: body.race, ...out }, actor: admin })
        return res.status(200).json(out)
      } catch (err) { return res.status(400).json({ error: err.message }) }
    }

    const orderId = String(body.orderId || '')
    if (!orderId) return res.status(400).json({ error: 'orderId is required' })
    const assigneeId = body.assigneeId ? String(body.assigneeId) : null
    if (assigneeId) {
      const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { isActive: true } })
      if (!u?.isActive) return res.status(400).json({ error: 'That teammate is not active' })
    }
    // Custom orders are handed out by whoever runs design (Head of Design, or
    // an admin), not by anyone on the team.
    const target = await prisma.order.findUnique({ where: { id: orderId }, select: { trackstarOrderType: true } })
    if (!target) return res.status(404).json({ error: 'Order not found' })
    if (target.trackstarOrderType === 'custom') {
      const me = await loadActiveUser(actor)
      if (!me || !(me.isSystem || await can(me, 'orders.assign_custom'))) {
        return res.status(403).json({ error: 'Only the Head of Design or an admin can assign custom orders.', code: 'not_allowed' })
      }
    }
    const order = await prisma.order.update({
      where: { id: orderId },
      data: { assigneeId },
      select: { id: true, orderNumber: true, assigneeId: true, assignee: { select: { firstName: true } } },
    })
    await recordAudit({
      action: 'order.assign',
      summary: `Assigned ${order.orderNumber} to ${order.assignee?.firstName || 'nobody'}`,
      detail: { orderId, assigneeId },
      actor,
    })
    return res.status(200).json({ orderId: order.id, assigneeId: order.assigneeId, assigneeName: order.assignee?.firstName || null })
  } catch (error) {
    console.error('[API /orders/assign]', error)
    return sendPublicError(res, error)
  }
}
