/**
 * Payouts. Admin only.
 *
 * GET  /api/finance/payouts?month=YYYY-MM          one month: every payout, its state, the total (default this month)
 * GET  /api/finance/payouts?rates=1               everyone's rates
 * POST { action: 'approve_line' | 'unapprove_line', month, key }   customs or the designer fee for a month that is over
 * GET  /api/finance/payouts?user=<id>             one person's history
 * POST /api/finance/payouts { action: 'create_run', kind: 'hours', periodStart, periodEnd }
 *                          { action: 'create_run', kind: 'monthly', month }
 *                          { action: 'approve_run' | 'delete_run', id }
 *                          { action: 'mark_paid', id, paidRef?, paidAt? }
 *                          { action: 'add_line', runId, userId, kind, amountCents, note? }
 *                          { action: 'delete_line', lineId }
 *                          { action: 'set_hourly_rate', userId, cents | null }
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import * as payouts from '../../../server/domain/finance/payouts.js'
import { monthPayouts, approveMonthLine, unapproveMonthLine } from '../../../server/domain/finance/monthPayouts.js'
import { monthOf, todayET } from '../../../server/domain/finance/periods.js'
import { answerError, body } from '../../_lib/finance.js'

const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'GET') {
      if (req.query?.user) return res.status(200).json(await payouts.personHistory(String(req.query.user)))
      if (req.query?.rates) return res.status(200).json({ rates: await payouts.rates() })
      // The month view: everything paid out for one month, with its state and the total.
      return res.status(200).json(await monthPayouts(String(req.query?.month || monthOf(todayET()))))
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const b = body(req)
    let out, summary
    switch (b.action) {
      case 'approve_line': out = await approveMonthLine(String(b.month || ''), String(b.key || ''), { actor }); summary = `Approved ${out.name}'s ${out.kind === 'designer_fee' ? 'designer fee' : 'customs'} for ${b.month} (${usd(out.amountCents || 0)})`; break
      case 'unapprove_line': out = await unapproveMonthLine(String(b.month || ''), String(b.key || '')); summary = `Took back the approval of ${b.key}`; break
      case 'create_run': out = await payouts.createRun({ kind: b.kind, periodStart: b.periodStart, periodEnd: b.periodEnd, month: b.month, actor }); summary = `Created pay run "${out.label}" (${usd(out.totalCents)}, ${out.lines.length} lines)`; break
      case 'approve_run': out = await payouts.approveRun(String(b.id || '')); summary = `Approved pay run "${out.label}" (${usd(out.totalCents)})`; break
      case 'mark_paid': out = await payouts.markPaid(String(b.id || ''), { paidRef: b.paidRef, paidAt: b.paidAt }); summary = `Marked pay run "${out.label}" paid (${usd(out.totalCents)}${b.paidRef ? `, ${String(b.paidRef).slice(0, 60)}` : ''})`; break
      case 'delete_run': out = await payouts.deleteRun(String(b.id || '')); summary = `Deleted a draft pay run`; break
      case 'add_line': out = await payouts.addLine(String(b.runId || ''), { userId: String(b.userId || ''), kind: b.kind, amountCents: Number(b.amountCents), note: b.note }); summary = `Added a ${b.kind} line of ${usd(Number(b.amountCents))} to "${out.label}"`; break
      case 'delete_line': out = await payouts.deleteLine(String(b.lineId || '')); summary = `Removed a line from "${out.label}"`; break
      case 'set_hourly_rate': {
        const cents = b.cents === null || b.cents === undefined || b.cents === '' ? null : Number(b.cents)
        out = { rates: await payouts.setHourlyRate(String(b.userId || ''), cents) }
        summary = cents === null ? `Cleared an hourly rate` : `Set an hourly rate to ${usd(cents)}`
        break
      }
      default: return res.status(400).json({ error: 'Unknown action' })
    }
    await recordAudit({ action: `payouts.${b.action}`, summary, detail: { ...b }, actor })
    return res.status(200).json(out)
  } catch (error) { return answerError(res, error, '/finance/payouts') }
}
