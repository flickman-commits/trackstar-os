/**
 * Payouts, one month at a time: everything the business pays out for that
 * month, in three states, and the month's total.
 *
 *   Customs       per designer, from the custom counter. In progress while
 *                 the month runs; Submitted once it is over (the statement
 *                 went to the designer); Approved when Matt approves it.
 *   Designer fee  the head designer's share of the month (7.5% of
 *                 contribution margin from Nov 2026), from the scoreboard;
 *                 the same three states as customs.
 *   Hours         per person per week, for weeks that start in the month,
 *                 at the person's rate (frozen on approval). The week's own
 *                 state: In progress (being filled in, or sent back),
 *                 Submitted, Approved.
 *   Race payouts  partner races whose payout falls due in the month: In
 *                 progress until the report goes out, Submitted when it has,
 *                 Approved once paid (Payouts > Races).
 *
 * Approving customs or the fee freezes the amount as a PayoutLine on the
 * month's run (the same rows the earlier pay runs used, so months approved
 * there read as approved here). Approving hours is approving the week.
 */
import prisma from '../../db.js'
import { customCounter } from '../orders/customCounter.js'
import { summaryBetween } from './ledger.js'
import { loadRules } from './rules.js'
import { summarizeEntries, hoursText } from './timesheets.js'
import { listRacePayouts } from './racePayouts.js'
import { todayET, monthOf, lastOfMonth, monthLabel, isValidMonth, dayLabel, shiftMonth } from './periods.js'

export class MonthPayoutError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

const name = u => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Someone'
const usdText = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/** The month's run: where approved customs and fee lines are kept. */
async function monthRun(month, { create = false, actor = null } = {}) {
  const periodStart = `${month}-01`
  const found = await prisma.payRun.findFirst({ where: { kind: 'monthly', periodStart }, orderBy: { createdAt: 'asc' } })
  if (found || !create) return found
  return prisma.payRun.create({ data: { kind: 'monthly', periodStart, periodEnd: lastOfMonth(periodStart), label: monthLabel(month), status: 'approved', approvedAt: new Date(), createdById: actor?.id || null } })
}

/** Everything due for a month (YYYY-MM), with each line's state and the totals. */
export async function monthPayouts(month, { today = todayET() } = {}) {
  if (!isValidMonth(month)) throw new MonthPayoutError('month must be YYYY-MM')
  const current = monthOf(today)
  if (month > current) throw new MonthPayoutError('That month has not started yet')
  const closed = month < current
  const first = `${month}-01`, last = lastOfMonth(first)
  const prefixes = ['customs', 'fee'].map(k => `${k}:${month}:`)

  const [counter, rules, heads, approvedLines, sheets] = await Promise.all([
    customCounter(month),
    loadRules(),
    prisma.user.findMany({ where: { isActive: true, OR: [{ role: 'head_designer' }, { extraRoles: { has: 'head_designer' } }] }, select: { id: true, firstName: true, lastName: true } }),
    prisma.payoutLine.findMany({ where: { OR: prefixes.map(p => ({ sourceRef: { startsWith: p } })) }, select: { id: true, sourceRef: true, amountCents: true, paidAt: true } }),
    prisma.timesheet.findMany({ where: { weekStart: { gte: first, lte: last } }, include: { user: { select: { id: true, firstName: true, lastName: true, hourlyRateCents: true } }, entries: { select: { minutes: true, day: true, startedAt: true, endedAt: true } } }, orderBy: { weekStart: 'asc' } }),
  ])
  const approvedBy = new Map(approvedLines.map(l => [l.sourceRef, l]))
  const stateFor = ref => (approvedBy.has(ref) ? 'approved' : closed ? 'submitted' : 'in_progress')
  const lines = []

  for (const d of counter.designers) {
    if (!d.userId || !d.payoutCents) continue
    const ref = `customs:${month}:${d.userId}`
    const done = approvedBy.get(ref)
    lines.push({
      key: ref, kind: 'customs', userId: d.userId, name: d.name, status: stateFor(ref), paid: Boolean(done?.paidAt),
      amountCents: done ? done.amountCents : d.payoutCents,
      detail: `${d.count} custom${d.count === 1 ? '' : 's'}${d.repeats ? ` (${d.repeats} repeat${d.repeats === 1 ? '' : 's'})` : ''}`,
    })
  }

  const s = await summaryBetween(first, last < today ? last : today, rules)
  for (const h of heads) {
    const ref = `fee:${month}:${h.id}`
    const done = approvedBy.get(ref)
    if (!done && !s.dayCount) continue
    const base = s.designerFeeBase === 'gp' ? 'gross profit' : 'contribution margin'
    lines.push({
      key: ref, kind: 'designer_fee', userId: h.id, name: name(h), status: stateFor(ref), paid: Boolean(done?.paidAt),
      amountCents: done ? done.amountCents : s.designerFee,
      detail: `7.5% of ${base}${closed ? '' : `, ${s.dayCount} day${s.dayCount === 1 ? '' : 's'} so far`}`,
    })
  }

  for (const t of sheets) {
    const minutes = summarizeEntries(t.entries).totalMinutes
    if (!minutes && t.status === 'draft') continue
    const rate = t.hourlyRateCents ?? t.user.hourlyRateCents ?? null
    lines.push({
      key: `timesheet:${t.id}`, kind: 'hours', userId: t.userId, name: name(t.user), timesheetId: t.id,
      status: t.status === 'submitted' ? 'submitted' : t.status === 'approved' ? 'approved' : 'in_progress',
      sentBack: t.status === 'rejected', paid: Boolean(t.payoutLineId),
      amountCents: rate == null ? null : Math.round((minutes * rate) / 60),
      detail: `Week of ${dayLabel(t.weekStart)}: ${hoursText(minutes)}${rate == null ? ', no rate set' : ` at ${usdText(rate)}/h`}`,
    })
  }

  // Partner races whose payout falls due this month. Attio may be off; the month still shows.
  let racesError = null
  try {
    const races = await listRacePayouts({ today })
    for (const r of races) {
      if (!r.dueDate || r.dueDate < first || r.dueDate > last) continue
      if (r.terms.structure === 'percent' && r.terms.pct === 0) continue // forgoes its share: nothing to pay
      lines.push({
        key: `race:${r.dealId}`, kind: 'race', dealId: r.dealId, name: r.name,
        status: r.status === 'paid' ? 'approved' : r.status === 'sent' ? 'submitted' : 'in_progress', paid: r.status === 'paid',
        amountCents: r.payoutCents,
        detail: `${r.terms.structure === 'per_order' ? `${usdText(r.terms.perOrderCents)} per order` : `${r.terms.pct}% of net sales`}, due ${dayLabel(r.dueDate)}${r.sales ? `: ${r.sales.unitsSold} units` : ', sales not pulled yet'}`,
      })
    }
  } catch (err) {
    racesError = err?.expose ? err.message : 'Could not read the race deals'
  }

  const KIND_ORDER = { customs: 0, designer_fee: 1, hours: 2, race: 3 }
  lines.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
  const sum = list => list.reduce((n, l) => n + (l.amountCents || 0), 0)
  const byStatus = st => sum(lines.filter(l => l.status === st))
  const byKind = k => sum(lines.filter(l => l.kind === k))
  return {
    month, label: monthLabel(month), closed, current: month === current,
    previous: shiftMonth(month, -1), next: month < current ? shiftMonth(month, 1) : null,
    lines,
    totals: {
      totalCents: sum(lines), inProgressCents: byStatus('in_progress'), submittedCents: byStatus('submitted'), approvedCents: byStatus('approved'),
      customsCents: byKind('customs'), designerFeeCents: byKind('designer_fee'), hoursCents: byKind('hours'), racesCents: byKind('race'),
      unpriced: lines.filter(l => l.amountCents == null).length,
    },
    racesError,
  }
}

/** Approve a month's customs or designer fee line: the amount is frozen on the month's run. */
export async function approveMonthLine(month, key, { actor = null, today = todayET() } = {}) {
  if (!/^(customs|fee):\d{4}-\d{2}:[A-Za-z0-9_-]+$/.test(String(key || '')) || !String(key).includes(`:${month}:`)) throw new MonthPayoutError('Only customs and the designer fee are approved here; hours are approved by the week')
  const view = await monthPayouts(month, { today })
  if (!view.closed) throw new MonthPayoutError(`${view.label} is not over yet`)
  const line = view.lines.find(l => l.key === key)
  if (!line) throw new MonthPayoutError('Nothing to approve there')
  if (line.status === 'approved') return line
  const run = await monthRun(month, { create: true, actor })
  await prisma.payoutLine.create({ data: { payRunId: run.id, userId: line.userId, kind: line.kind, quantity: null, rateCents: null, amountCents: line.amountCents, sourceRef: key, note: `${line.detail}, ${view.label}` } })
  return { ...line, status: 'approved' }
}

/** Take back an approval of customs or the fee (not once it is paid). */
export async function unapproveMonthLine(month, key) {
  const l = await prisma.payoutLine.findUnique({ where: { sourceRef: String(key || '') } })
  if (!l || !String(key).includes(`:${month}:`)) throw new MonthPayoutError('That line is not approved')
  if (l.paidAt) throw new MonthPayoutError('That one is marked paid')
  await prisma.payoutLine.delete({ where: { id: l.id } })
  return { key, status: 'submitted' }
}
