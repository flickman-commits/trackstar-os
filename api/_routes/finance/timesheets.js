/**
 * Every person's weeks, for review. Admin only.
 *
 * GET  /api/finance/timesheets?week=YYYY-MM-DD   every week of that week (a Monday; default this week), and everyone with Hours
 * GET  /api/finance/timesheets?status=submitted|approved|rejected|draft|all&user=<id>   (no week: across weeks)
 * POST /api/finance/timesheets { action: 'approve' | 'reject' | 'withdraw', id, note? }
 *                             { action: 'add', userId, day, minutes, note? }   add time to someone's week by hand
 *                             { action: 'remove', userId, entryId }            remove one of their entries
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { listTimesheets, review, hourlyPeople, hoursText, addEntry, deleteEntry } from '../../../server/domain/finance/timesheets.js'
import { dayLabel, mondayOf, todayET, isValidDay } from '../../../server/domain/finance/periods.js'
import { answerError, body } from '../../_lib/finance.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'POST') {
      const b = body(req)
      if (b.action === 'add' || b.action === 'remove') {
        const userId = String(b.userId || '')
        const person = (await hourlyPeople()).find(p => p.id === userId)
        if (!person) return res.status(400).json({ error: 'That person does not log hours' })
        const who = [person.firstName, person.lastName].filter(Boolean).join(' ')
        if (b.action === 'add') {
          const out = await addEntry(userId, { day: b.day, minutes: b.minutes, note: b.note }, { byAdmin: true })
          await recordAudit({ action: 'hours.add_for', summary: `Added ${hoursText(out.entry.minutes)} to ${who}'s hours on ${dayLabel(out.entry.day)}${out.entry.note ? `: ${out.entry.note.slice(0, 120)}` : ''}`, detail: { userId, entryId: out.entry.id, day: out.entry.day, minutes: out.entry.minutes }, actor })
          return res.status(200).json({ entry: out.entry })
        }
        const out = await deleteEntry(userId, String(b.entryId || ''), { byAdmin: true })
        await recordAudit({ action: 'hours.remove_for', summary: `Removed ${hoursText(out.minutes)} from ${who}'s hours on ${dayLabel(out.day)}`, detail: { userId, entryId: out.deleted, day: out.day, minutes: out.minutes }, actor })
        return res.status(200).json(out)
      }
      const ts = await review(String(b.id || ''), b.action, { note: b.note, reviewer: actor })
      const who = [ts.user?.firstName, ts.user?.lastName].filter(Boolean).join(' ')
      const verb = { approve: 'Approved', reject: 'Sent back', withdraw: 'Withdrew approval of' }[b.action]
      await recordAudit({ action: `hours.${b.action}`, summary: `${verb} ${who}'s ${hoursText(ts.totalMinutes)} for the week of ${dayLabel(ts.weekStart)}${b.note ? `: ${String(b.note).slice(0, 120)}` : ''}`, detail: { timesheetId: ts.id, weekStart: ts.weekStart, userId: ts.userId, minutes: ts.totalMinutes, rateCents: ts.hourlyRateCents }, actor })
      return res.status(200).json({ timesheet: ts })
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const status = String(req.query?.status || 'all')
    const userId = req.query?.user ? String(req.query.user) : null
    const week = req.query?.week ? String(req.query.week) : (req.query?.status ? null : mondayOf(todayET()))
    if (week && !isValidDay(week)) return res.status(400).json({ error: 'week must be YYYY-MM-DD' })
    const weekStart = week ? mondayOf(week) : null
    const [timesheets, people] = await Promise.all([listTimesheets({ status, userId, weekStart }), hourlyPeople()])
    return res.status(200).json({ timesheets, people, weekStart, thisWeek: mondayOf(todayET()) })
  } catch (error) { return answerError(res, error, '/finance/timesheets') }
}
