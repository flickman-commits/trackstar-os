/**
 * Every person's weeks, for review. Admin only.
 *
 * GET  /api/finance/timesheets?status=submitted|approved|rejected|draft|all&user=<id>
 * POST /api/finance/timesheets { action: 'approve' | 'reject' | 'withdraw', id, note? }
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { listTimesheets, review, hourlyPeople } from '../../../server/domain/finance/timesheets.js'
import { dayLabel } from '../../../server/domain/finance/periods.js'
import { answerError, body } from '../../_lib/finance.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'POST') {
      const b = body(req)
      const ts = await review(String(b.id || ''), b.action, { note: b.note, reviewer: actor })
      const who = [ts.user?.firstName, ts.user?.lastName].filter(Boolean).join(' ')
      const verb = { approve: 'Approved', reject: 'Sent back', withdraw: 'Withdrew approval of' }[b.action]
      await recordAudit({ action: `hours.${b.action}`, summary: `${verb} ${who}'s ${(ts.totalMinutes / 60).toFixed(2)}h for the week of ${dayLabel(ts.weekStart)}${b.note ? `: ${String(b.note).slice(0, 120)}` : ''}`, detail: { timesheetId: ts.id, weekStart: ts.weekStart, userId: ts.userId, minutes: ts.totalMinutes, rateCents: ts.hourlyRateCents }, actor })
      return res.status(200).json({ timesheet: ts })
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const status = String(req.query?.status || 'all')
    const userId = req.query?.user ? String(req.query.user) : null
    const [timesheets, people] = await Promise.all([listTimesheets({ status, userId }), hourlyPeople()])
    return res.status(200).json({ timesheets, people })
  } catch (error) { return answerError(res, error, '/finance/timesheets') }
}
