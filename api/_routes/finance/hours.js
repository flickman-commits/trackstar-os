/**
 * A person's own hours. Needs the `hours` capability (Customer Support by
 * default; given to anyone paid by the hour in Settings > Roles).
 *
 * GET  /api/finance/hours?week=YYYY-MM-DD   the week (a Monday; default this week), recent weeks, the running timer
 * POST /api/finance/hours { action: 'add', day, minutes, note }   admin only (Manually add hours)
 *                        { action: 'update', id, minutes?, note? }   minutes: admin only
 *                        { action: 'delete', id }
 *                        { action: 'start', note? } | { action: 'stop' }
 *                        { action: 'pause' } | { action: 'resume' }   stop for now, then carry on with the same work
 *                        { action: 'end' }   finish a paused session without resuming
 *                        { action: 'submit', weekStart }
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import * as hours from '../../../server/domain/finance/timesheets.js'
import { todayET, mondayOf, dayLabel } from '../../../server/domain/finance/periods.js'
import { answerError, body } from '../../_lib/finance.js'

async function payload(userId, weekStart) {
  const [week, weeks, running, session] = await Promise.all([hours.getWeek(userId, weekStart), hours.myWeeks(userId), hours.runningTimer(userId), hours.timerSession(userId)])
  // A session whose timer is gone (stopped somewhere else, or deleted) is not paused or carried.
  const s = session && (session.pausedAt || running) ? session : null
  return { week, weeks, running, paused: s?.pausedAt && !running ? { note: s.note, carriedMinutes: s.carriedMinutes, since: s.pausedAt } : null, carriedMinutes: running && s ? s.carriedMinutes : 0, today: todayET() }
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'hours')
  if (!user) return
  try {
    if (req.method === 'GET') {
      const weekStart = String(req.query?.week || mondayOf(todayET()))
      return res.status(200).json(await payload(user.id, weekStart))
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const b = body(req)
    let weekStart = b.weekStart || mondayOf(todayET())
    switch (b.action) {
      // Time goes in by the timer. Adding hours by hand, or changing how long an
      // entry was, is an admin's (Manually add hours); anyone can fix a note.
      case 'add': {
        if (user.role !== 'admin') return res.status(403).json({ error: 'Hours are added with the timer. Ask Matt to add time by hand.' })
        const out = await hours.addEntry(user.id, { day: b.day, minutes: b.minutes, note: b.note }); weekStart = out.weekStart; break
      }
      case 'update': { const e = await hours.updateEntry(user.id, String(b.id || ''), { minutes: user.role === 'admin' ? b.minutes : undefined, note: b.note }); weekStart = mondayOf(e.day); break }
      case 'delete': { await hours.deleteEntry(user.id, String(b.id || '')); break }
      case 'start': { const out = await hours.startTimer(user.id, { note: b.note }); weekStart = out.weekStart; break }
      case 'stop': { const e = await hours.stopTimer(user.id); weekStart = mondayOf(e.day); break }
      case 'pause': { const e = await hours.pauseTimer(user.id); weekStart = mondayOf(e.day); break }
      case 'resume': { const out = await hours.resumeTimer(user.id); weekStart = out.weekStart; break }
      case 'end': { await hours.endSession(user.id); break }
      case 'submit': {
        const ts = await hours.submitWeek(user.id, String(b.weekStart || ''))
        await recordAudit({ action: 'hours.submit', summary: `Submitted ${hours.hoursText(ts.totalMinutes)} for the week of ${dayLabel(ts.weekStart)}`, detail: { timesheetId: ts.id, weekStart: ts.weekStart, minutes: ts.totalMinutes }, actor: user })
        weekStart = ts.weekStart
        break
      }
      default: return res.status(400).json({ error: 'Unknown action' })
    }
    return res.status(200).json(await payload(user.id, weekStart))
  } catch (error) { return answerError(res, error, '/finance/hours') }
}
