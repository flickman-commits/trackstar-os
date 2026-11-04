/**
 * Payouts: what each person is owed and what has been paid.
 *
 * A pay run is one period's payments. An hours run covers two weeks of
 * approved timesheets (hourly people are paid every two weeks); a monthly run
 * covers a closed month's customs per designer (the custom counter) and the
 * head designer's fee (the scoreboard's designer fee for the month). Lines
 * can also be typed by hand (bonus, reimbursement). A run goes draft ->
 * approved -> paid; Mark paid records when and how. Nothing moves money.
 *
 * A source (a timesheet, a designer's month) can be on one line only:
 * Timesheet.payoutLineId and PayoutLine.sourceRef are unique.
 */
import prisma from '../../db.js'
import { customCounter, ratesFor, designRole } from '../orders/customCounter.js'
import { summaryBetween } from './ledger.js'
import { loadRules } from './rules.js'
import { todayET, monthOf, shiftMonth, lastOfMonth, monthLabel, isValidMonth, isValidDay, dayLabel, mondayOf, addDays } from './periods.js'
import { summarizeEntries } from './timesheets.js'

export class PayoutError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const LINE_KINDS = ['customs', 'hours', 'designer_fee', 'bonus', 'reimbursement', 'other']
const USER_SELECT = { id: true, firstName: true, lastName: true, role: true, extraRoles: true, hourlyRateCents: true, customRateCents: true, customRepeatRateCents: true }
const name = u => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Someone'
export const hoursAmount = (minutes, rateCents) => Math.round((minutes * rateCents) / 60)

/** Everyone active, with their rates (per custom and per hour). */
export async function rates() {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: USER_SELECT, orderBy: [{ role: 'asc' }, { firstName: 'asc' }] })
  return users.map(u => {
    const r = ratesFor(u)
    const designer = Boolean(designRole(u))
    return { userId: u.id, name: name(u), role: u.role, hourlyRateCents: u.hourlyRateCents, customs: designer ? { newCents: r.newCents, repeatCents: r.repeatCents, custom: r.custom } : null }
  })
}

export async function setHourlyRate(userId, cents) {
  if (cents !== null && !(Number.isInteger(cents) && cents >= 0 && cents < 100_000_00)) throw new PayoutError('The rate must be whole cents')
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!u) throw new PayoutError('No such person', 404)
  await prisma.user.update({ where: { id: userId }, data: { hourlyRateCents: cents } })
  return rates()
}

/** Approved weeks not yet on a run, with what they come to. */
export async function unpaidWeeks({ periodStart = null, periodEnd = null } = {}) {
  const where = { status: 'approved', payoutLineId: null }
  if (periodStart || periodEnd) where.weekStart = { ...(periodStart ? { gte: periodStart } : {}), ...(periodEnd ? { lte: periodEnd } : {}) }
  const rows = await prisma.timesheet.findMany({ where, include: { user: { select: USER_SELECT }, entries: { select: { minutes: true, day: true, startedAt: true, endedAt: true } } }, orderBy: [{ userId: 'asc' }, { weekStart: 'asc' }] })
  return rows.map(t => {
    const minutes = summarizeEntries(t.entries).totalMinutes
    const rate = t.hourlyRateCents ?? t.user.hourlyRateCents ?? 0
    return { timesheetId: t.id, userId: t.userId, name: name(t.user), weekStart: t.weekStart, weekEnd: addDays(t.weekStart, 6), minutes, rateCents: rate, amountCents: hoursAmount(minutes, rate) }
  })
}

/** The closed months (before this one) whose customs or fee are not on a run yet. */
export async function unpaidMonths({ today = todayET(), back = 3 } = {}) {
  const current = monthOf(today)
  const months = Array.from({ length: back }, (_, i) => shiftMonth(current, -(i + 1)))
  const refs = new Set((await prisma.payoutLine.findMany({ where: { sourceRef: { not: null } }, select: { sourceRef: true } })).map(l => l.sourceRef))
  const rules = await loadRules()
  const heads = await prisma.user.findMany({ where: { isActive: true, role: 'head_designer' }, select: USER_SELECT })
  const out = []
  for (const month of months) {
    const items = []
    const counter = await customCounter(month)
    for (const d of counter.designers) {
      if (!d.userId || !d.payoutCents) continue
      const sourceRef = `customs:${month}:${d.userId}`
      if (refs.has(sourceRef)) continue
      items.push({ userId: d.userId, name: d.name, kind: 'customs', quantity: d.count, rateCents: d.rateCents, amountCents: d.payoutCents, sourceRef, note: `${d.count} custom${d.count === 1 ? '' : 's'} in ${monthLabel(month)}${d.repeats ? ` (${d.repeats} repeat${d.repeats === 1 ? '' : 's'})` : ''}` })
    }
    const s = await summaryBetween(`${month}-01`, lastOfMonth(`${month}-01`), rules)
    for (const h of heads) {
      const sourceRef = `fee:${month}:${h.id}`
      if (refs.has(sourceRef) || !s.dayCount) continue
      items.push({ userId: h.id, name: name(h), kind: 'designer_fee', quantity: null, rateCents: null, amountCents: s.designerFee, sourceRef, note: `7.5% of ${s.designerFeeBase === 'gp' ? 'gross profit' : 'contribution margin'} for ${monthLabel(month)} (${s.dayCount} of ${lastOfMonth(`${month}-01`).slice(8)} days landed)` })
    }
    if (items.length) out.push({ month, label: monthLabel(month), items, totalCents: items.reduce((a, i) => a + i.amountCents, 0) })
  }
  return out
}

/** The Owed view: hours by person, months by designer, and the total. */
export async function owed(opts = {}) {
  const [weeks, months] = await Promise.all([unpaidWeeks(), unpaidMonths(opts)])
  const byPerson = new Map()
  for (const w of weeks) {
    const p = byPerson.get(w.userId) || { userId: w.userId, name: w.name, weeks: [], minutes: 0, amountCents: 0 }
    p.weeks.push(w); p.minutes += w.minutes; p.amountCents += w.amountCents
    byPerson.set(w.userId, p)
  }
  const hours = [...byPerson.values()]
  const totalCents = hours.reduce((a, p) => a + p.amountCents, 0) + months.reduce((a, m) => a + m.totalCents, 0)
  return { hours, months, totalCents }
}

const RUN_INCLUDE = { lines: { include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }] } }
function shapeRun(r) {
  return { ...r, totalCents: r.lines.reduce((a, l) => a + l.amountCents, 0), lines: r.lines.map(l => ({ ...l, name: name(l.user), user: undefined })) }
}

/** A two-week hours run, or a month's run of customs and the fee. */
export async function createRun({ kind, periodStart, periodEnd, month, actor }) {
  if (kind === 'hours') {
    if (!isValidDay(periodStart) || !isValidDay(periodEnd) || periodEnd < periodStart) throw new PayoutError('Pick the first and last day of the period')
    const weeks = await unpaidWeeks({ periodStart: mondayOf(periodStart), periodEnd })
    if (!weeks.length) throw new PayoutError('No approved, unpaid weeks start in that period')
    return prisma.$transaction(async tx => {
      const run = await tx.payRun.create({ data: { kind, periodStart, periodEnd, label: `Hours ${dayLabel(periodStart)} to ${dayLabel(periodEnd)}`, createdById: actor?.id || null } })
      for (const w of weeks) {
        const line = await tx.payoutLine.create({ data: { payRunId: run.id, userId: w.userId, kind: 'hours', quantity: w.minutes, rateCents: w.rateCents, amountCents: w.amountCents, sourceRef: `timesheet:${w.timesheetId}`, note: `Week of ${dayLabel(w.weekStart)}` } })
        await tx.timesheet.update({ where: { id: w.timesheetId }, data: { payoutLineId: line.id } })
      }
      return shapeRun(await tx.payRun.findUnique({ where: { id: run.id }, include: RUN_INCLUDE }))
    })
  }
  if (kind === 'monthly') {
    if (!isValidMonth(month)) throw new PayoutError('month must be YYYY-MM')
    if (month >= monthOf(todayET())) throw new PayoutError('A month is paid once it is over')
    const found = (await unpaidMonths({ back: 24 })).find(m => m.month === month)
    if (!found) throw new PayoutError(`Nothing left to pay for ${monthLabel(month)}`)
    return prisma.$transaction(async tx => {
      const run = await tx.payRun.create({ data: { kind, periodStart: `${month}-01`, periodEnd: lastOfMonth(`${month}-01`), label: `${monthLabel(month)} customs and fee`, createdById: actor?.id || null } })
      for (const it of found.items) await tx.payoutLine.create({ data: { payRunId: run.id, userId: it.userId, kind: it.kind, quantity: it.quantity, rateCents: it.rateCents, amountCents: it.amountCents, sourceRef: it.sourceRef, note: it.note } })
      return shapeRun(await tx.payRun.findUnique({ where: { id: run.id }, include: RUN_INCLUDE }))
    })
  }
  throw new PayoutError('kind must be hours or monthly')
}

async function runOr404(id) {
  const r = await prisma.payRun.findUnique({ where: { id }, include: RUN_INCLUDE })
  if (!r) throw new PayoutError('No such pay run', 404)
  return r
}

export async function approveRun(id) {
  const r = await runOr404(id)
  if (r.status !== 'draft') throw new PayoutError(`This run is ${r.status}`)
  if (!r.lines.length) throw new PayoutError('Nothing on this run')
  return shapeRun(await prisma.payRun.update({ where: { id }, data: { status: 'approved', approvedAt: new Date() }, include: RUN_INCLUDE }))
}

export async function markPaid(id, { paidRef = '', paidAt = null } = {}) {
  const r = await runOr404(id)
  if (r.status === 'paid') throw new PayoutError('Already paid')
  const at = paidAt ? new Date(paidAt) : new Date()
  if (Number.isNaN(at.getTime())) throw new PayoutError('paidAt is not a date')
  const ref = String(paidRef || '').trim().slice(0, 120) || null
  await prisma.$transaction([
    prisma.payoutLine.updateMany({ where: { payRunId: id }, data: { paidAt: at, paidRef: ref } }),
    prisma.payRun.update({ where: { id }, data: { status: 'paid', paidAt: at, approvedAt: r.approvedAt || at, note: ref ? [r.note, `Paid: ${ref}`].filter(Boolean).join(' · ') : r.note } }),
  ])
  return shapeRun(await runOr404(id))
}

export async function deleteRun(id) {
  const r = await runOr404(id)
  if (r.status === 'paid') throw new PayoutError('A paid run stays on the record')
  await prisma.$transaction([
    prisma.timesheet.updateMany({ where: { payoutLineId: { in: r.lines.map(l => l.id) } }, data: { payoutLineId: null } }),
    prisma.payRun.delete({ where: { id } }),
  ])
  return { deleted: id }
}

export async function addLine(runId, { userId, kind, amountCents, note }) {
  const r = await runOr404(runId)
  if (r.status === 'paid') throw new PayoutError('A paid run cannot change')
  if (!LINE_KINDS.includes(kind) || kind === 'hours' || kind === 'customs') throw new PayoutError('kind must be designer_fee, bonus, reimbursement or other')
  if (!(Number.isInteger(amountCents) && amountCents !== 0 && Math.abs(amountCents) < 1e9)) throw new PayoutError('amount must be whole cents')
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!u) throw new PayoutError('No such person', 404)
  await prisma.payoutLine.create({ data: { payRunId: runId, userId, kind, amountCents, note: String(note || '').trim().slice(0, 300) || null } })
  return shapeRun(await runOr404(runId))
}

export async function deleteLine(lineId) {
  const l = await prisma.payoutLine.findUnique({ where: { id: lineId }, include: { payRun: true } })
  if (!l) throw new PayoutError('No such line', 404)
  if (l.payRun.status === 'paid') throw new PayoutError('A paid run cannot change')
  await prisma.$transaction([
    prisma.timesheet.updateMany({ where: { payoutLineId: lineId }, data: { payoutLineId: null } }),
    prisma.payoutLine.delete({ where: { id: lineId } }),
  ])
  return shapeRun(await runOr404(l.payRunId))
}

export async function listRuns({ limit = 24 } = {}) {
  const rows = await prisma.payRun.findMany({ include: RUN_INCLUDE, orderBy: [{ createdAt: 'desc' }], take: Math.min(100, Math.max(1, limit)) })
  return rows.map(shapeRun)
}

/** One person's lines, newest first, with the run each sits on. */
export async function personHistory(userId) {
  const lines = await prisma.payoutLine.findMany({ where: { userId }, include: { payRun: { select: { id: true, label: true, status: true, paidAt: true, periodStart: true, periodEnd: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })
  return { userId, lines, paidCents: lines.filter(l => l.paidAt).reduce((a, l) => a + l.amountCents, 0), owedCents: lines.filter(l => !l.paidAt).reduce((a, l) => a + l.amountCents, 0) }
}
