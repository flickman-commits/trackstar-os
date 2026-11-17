/**
 * Paying the team through Wise: one transfer per person, from the Wise USD
 * balance, after Matt clicks Send on Finance > Payouts. Admin only, browser
 * session only: no cron and no MCP tool calls send() or retry(). The cron
 * only reads transfer states (refreshStatuses).
 *
 * What gets paid is what Payouts already says is due:
 *   - a two-week hours period, on its payday (the Monday after it ends):
 *     each person's approved, unpaid weeks (payouts.js unpaidWeeks);
 *   - a design month, on its last day: each designer's customs and fee
 *     (monthPayouts.js).
 *
 * Never twice:
 *   1. Before Wise is called, the run, its lines and one WiseTransfer per
 *      person are saved, each with its own customerTransactionId. The lines
 *      claim their source (a timesheet, a "customs:<month>:<user>" line) in
 *      the same transaction, only if it is still free, so a second click, a
 *      second tab or a manual Mark paid finds nothing left to pay.
 *   2. Each transfer then steps prepared -> created -> funded, saving after
 *      every step. A retry picks up where it stopped and sends the same
 *      customerTransactionId, which Wise never turns into a second transfer;
 *      before funding it asks Wise whether the transfer is already paid for.
 *   3. A transfer that fails before money moved can be retried, or released
 *      (cancelled at Wise, its lines freed to pay another way).
 *
 * Blocks: no Wise recipient linked, no tax form on file, a CRC recipient that
 * is not a Costa Rican IBAN, a COP payment over the per-transfer limit, an
 * unapproved week in the period, no hourly rate, and a USD balance short of
 * the total (Send says by how much).
 */
import crypto from 'crypto'
import prisma from '../../db.js'
import * as wiseApi from '../../services/wise.js'
import { todayET, payPeriodOf, isValidDay, isValidMonth, dayLabel, monthLabel, lastOfMonth } from './periods.js'
import { unpaidWeeks } from './payouts.js'
import { monthPayouts } from './monthPayouts.js'
import { summarizeEntries } from './timesheets.js'

export class WisePayError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

/**
 * Per-transfer limits, in USD cents, by the recipient's currency. The brief
 * set COP at $2,900; Wise's help page (Nov 2026) says up to $24,000 per COP
 * transfer, so this is the cautious number. A payment over it is blocked
 * with a note, not split.
 */
export const TRANSFER_CAP_CENTS = { COP: 2_900_00 }
export const TAX_FORMS = ['W-9', 'W-8BEN']
const OPEN = ['prepared', 'created']
const MONEY_LEFT = ['funded', 'sent']

const name = u => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Someone'
const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const PAYEE_SELECT = { id: true, firstName: true, lastName: true, role: true, isActive: true, payoutMethod: true, wiseRecipientId: true, wiseRecipientName: true, payoutCurrency: true, payoutCountry: true, taxFormType: true, taxFormOnFile: true }

/** Why a Wise recipient cannot be used, or null. */
export function recipientProblem(r) {
  if (!r?.id) return 'Wise has no such recipient'
  if (!r.active) return 'That recipient is switched off in Wise'
  if (r.own) return "That is the business's own Wise account, not a person's"
  if (!r.currency) return 'Wise did not say which currency that recipient takes'
  if (r.currency === 'CRC' && r.ibanPrefix !== 'CR') return 'A Costa Rica (CRC) recipient needs a CRC IBAN starting with CR, not a USD account. Add it again in Wise.'
  return null
}

/** What stops paying this person through Wise, in plain words. */
export function blockersFor(p) {
  const out = []
  if (!p.recipientId) out.push('No Wise recipient linked (Payouts > Rates)')
  if (!p.taxFormOnFile) out.push('No tax form on file (Payouts > Rates)')
  if (p.waiting) out.push(p.waiting)
  if (!(p.cents > 0)) out.push(p.noRate ? 'No hourly rate set' : 'Nothing to pay')
  const cap = TRANSFER_CAP_CENTS[p.currency]
  if (cap && p.cents > cap) out.push(`Over the ${usd(cap)} per-transfer limit for ${p.currency}: pay part of it another way`)
  return out
}

/** A run's state from its transfers. */
export function runStatusOf(transfers) {
  const live = transfers.filter(t => t.status !== 'cancelled')
  if (!live.length) return 'failed'
  if (live.some(t => OPEN.includes(t.status))) return 'sending'
  if (live.every(t => MONEY_LEFT.includes(t.status))) return 'paid'
  if (live.some(t => MONEY_LEFT.includes(t.status))) return 'partial'
  return 'failed'
}

/** Our status for a transfer from Wise's state, once it is funded. */
export function statusFromWise(state, current) {
  if (state === 'outgoing_payment_sent') return 'sent'
  if (['funds_refunded', 'bounced_back', 'charged_back'].includes(state)) return 'returned'
  if (state === 'cancelled') return MONEY_LEFT.includes(current) ? 'returned' : 'cancelled'
  return current
}

// ── Who is due ────────────────────────────────────────────────────────────

/** Everyone due in a period or a design month, with their lines and what blocks them. */
async function due({ kind, periodStart, month, today }) {
  if (kind === 'period') {
    if (!isValidDay(periodStart)) throw new WisePayError('Which pay period?')
    const { start, end, payday } = payPeriodOf(periodStart)
    if (start !== periodStart) throw new WisePayError('That is not the first day of a pay period')
    if (today < payday) throw new WisePayError(`Payday for this period is ${dayLabel(payday)}`)
    const weeks = await unpaidWeeks({ periodStart: start, periodEnd: end })
    const ids = [...new Set(weeks.map(w => w.userId))]
    const [users, sheets] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: PAYEE_SELECT }),
      prisma.timesheet.findMany({ where: { userId: { in: ids }, weekStart: { gte: start, lte: end }, status: { not: 'approved' } }, include: { entries: { select: { minutes: true, day: true, startedAt: true, endedAt: true } } } }),
    ])
    const people = users.map(u => {
      const mine = weeks.filter(w => w.userId === u.id)
      const open = sheets.find(t => t.userId === u.id && summarizeEntries(t.entries).totalMinutes > 0)
      return person(u, {
        items: mine.map(w => ({ kind: 'hours', timesheetId: w.timesheetId, minutes: w.minutes, rateCents: w.rateCents, amountCents: w.amountCents, label: `Week of ${dayLabel(w.weekStart)}` })),
        waiting: open ? `Their week of ${dayLabel(open.weekStart)} is not approved yet` : null,
        noRate: mine.some(w => !w.rateCents),
      })
    })
    return { kind, key: start, runKind: 'hours', periodStart: start, periodEnd: end, label: `Hours ${dayLabel(start)} to ${dayLabel(end)}`, people }
  }
  if (kind === 'month') {
    if (!isValidMonth(month)) throw new WisePayError('Which month?')
    const view = await monthPayouts(month, { today })
    if (today < view.designPayday) throw new WisePayError(`Design payday for ${view.label} is ${dayLabel(view.designPayday)}`)
    const lines = view.lines.filter(l => (l.kind === 'customs' || l.kind === 'designer_fee') && l.userId && !l.paid && l.amountCents)
    const ids = [...new Set(lines.map(l => l.userId))]
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: PAYEE_SELECT })
    const people = users.map(u => person(u, {
      items: lines.filter(l => l.userId === u.id).map(l => ({ kind: l.kind, sourceRef: l.key, approved: l.status === 'approved', amountCents: l.amountCents, label: l.kind === 'designer_fee' ? `Fee: ${l.detail}` : `Customs: ${l.detail}` })),
    }))
    return { kind, key: month, runKind: 'monthly', periodStart: `${month}-01`, periodEnd: lastOfMonth(`${month}-01`), label: `Design ${monthLabel(month)}`, people }
  }
  throw new WisePayError('kind must be period or month')
}

function person(u, { items, waiting = null, noRate = false }) {
  const p = {
    userId: u.id, name: name(u), items, cents: items.reduce((n, i) => n + (i.amountCents || 0), 0),
    recipientId: u.wiseRecipientId || null, recipientName: u.wiseRecipientName || null, currency: u.payoutCurrency || null, country: u.payoutCountry || null,
    taxFormType: u.taxFormType || null, taxFormOnFile: Boolean(u.taxFormOnFile), waiting, noRate,
  }
  return { ...p, blockers: blockersFor(p) }
}

// ── Preview ───────────────────────────────────────────────────────────────

/**
 * What Send would do: each person, their amount in USD, a live quote (rate,
 * fee, what they receive), what blocks them, and the USD balance against the
 * total. Quotes made here are not used to send; Send quotes again.
 */
export async function preview({ kind, periodStart, month, today = todayET(), api = wiseApi }) {
  const d = await due({ kind, periodStart, month, today })
  let balanceCents = null, balanceError = null
  try { balanceCents = await api.usdBalanceCents() } catch (e) { balanceError = e.expose ? e.message : 'Could not read the Wise balance' }
  const people = []
  for (const p of d.people.sort((a, b) => a.name.localeCompare(b.name))) {
    let quote = null
    if (!p.blockers.length) {
      try {
        const q = await api.createQuote({ sourceCents: p.cents, targetCurrency: p.currency, recipientId: p.recipientId })
        quote = { rate: q.rate, targetMinor: q.targetMinor, feeCents: q.feeCents, expiresAt: q.expiresAt }
        if (q.disabled) p.blockers.push(q.disabled)
      } catch (e) { p.blockers.push(e.expose ? `Quote failed: ${e.message}` : 'Wise could not quote this payment') }
    }
    people.push({ ...p, quote })
  }
  const totalCents = people.filter(p => !p.blockers.length).reduce((n, p) => n + p.cents, 0)
  return {
    kind: d.kind, key: d.key, label: d.label, env: api.wiseEnv(), balanceCents, balanceError, totalCents,
    shortfallCents: balanceCents == null ? null : Math.max(0, totalCents - balanceCents), people,
  }
}

// ── Send ──────────────────────────────────────────────────────────────────

/**
 * Pay the chosen people. Everything is checked again here (the page may be
 * stale), the balance is checked against the total, then the run is saved
 * and each transfer is pushed through Wise. Returns the run with each
 * transfer's outcome; a failure on one person does not stop the others.
 */
export async function send({ kind, periodStart, month, userIds, actor, today = todayET(), api = wiseApi }) {
  const d = await due({ kind, periodStart, month, today })
  const want = new Set((Array.isArray(userIds) ? userIds : []).map(String))
  const chosen = d.people.filter(p => want.has(p.userId))
  if (!chosen.length) throw new WisePayError('Nobody to pay: they may have been paid already. Refresh the page.')
  const blocked = chosen.find(p => p.blockers.length)
  if (blocked) throw new WisePayError(`${blocked.name}: ${blocked.blockers[0]}`)
  const totalCents = chosen.reduce((n, p) => n + p.cents, 0)
  const balance = await api.usdBalanceCents()
  if (balance == null) throw new WisePayError('The Wise profile has no USD balance to pay from')
  if (balance < totalCents) throw new WisePayError(`The Wise USD balance is ${usd(balance)}, ${usd(totalCents - balance)} short of the ${usd(totalCents)} to send. Add money in Wise, then send.`)

  const at = new Date()
  let runId
  try {
    runId = await prisma.$transaction(async tx => {
      const run = await tx.payRun.create({ data: { kind: d.runKind, periodStart: d.periodStart, periodEnd: d.periodEnd, label: d.label, status: 'sending', via: 'wise', approvedAt: at, createdById: actor?.id || null, note: `Sent through Wise (${api.wiseEnv()}) by ${actor?.email || 'an admin'}` } })
      for (const p of chosen) {
        const t = await tx.wiseTransfer.create({ data: { payRunId: run.id, userId: p.userId, customerTransactionId: crypto.randomUUID(), sourceCents: p.cents, targetCurrency: p.currency, wiseRecipientId: p.recipientId } })
        for (const i of p.items) {
          if (i.kind === 'hours') {
            const line = await tx.payoutLine.create({ data: { payRunId: run.id, userId: p.userId, kind: 'hours', quantity: i.minutes, rateCents: i.rateCents, amountCents: i.amountCents, sourceRef: `timesheet:${i.timesheetId}`, note: i.label, wiseTransferId: t.id } })
            const claimed = await tx.timesheet.updateMany({ where: { id: i.timesheetId, status: 'approved', payoutLineId: null }, data: { payoutLineId: line.id } })
            if (claimed.count !== 1) throw new WisePayError(`${p.name}'s ${i.label.toLowerCase()} is already paid or no longer approved. Refresh the page.`, 409)
          } else if (i.approved) {
            const claimed = await tx.payoutLine.updateMany({ where: { sourceRef: i.sourceRef, paidAt: null, wiseTransferId: null }, data: { wiseTransferId: t.id } })
            if (claimed.count !== 1) throw new WisePayError(`${p.name}'s ${i.kind === 'customs' ? 'customs' : 'fee'} is already paid. Refresh the page.`, 409)
          } else {
            await tx.payoutLine.create({ data: { payRunId: run.id, userId: p.userId, kind: i.kind, amountCents: i.amountCents, sourceRef: i.sourceRef, note: i.label, wiseTransferId: t.id } })
          }
        }
        await tx.user.update({ where: { id: p.userId }, data: { payoutMethod: 'wise' } })
      }
      return run.id
    })
  } catch (e) {
    // A unique sourceRef already taken: another send or a Mark paid got there first.
    if (e?.code === 'P2002') throw new WisePayError('Some of this was paid a moment ago. Refresh the page.', 409)
    throw e
  }
  const transfers = await prisma.wiseTransfer.findMany({ where: { payRunId: runId }, orderBy: { createdAt: 'asc' } })
  for (const t of transfers) await advance(t, { api })
  return runSummary(runId)
}

/**
 * Take one transfer as far as it will go: quote and create it, then fund it
 * from the balance. Saves after every step. Never throws: a failure is
 * written on the transfer. `unsure` failures (a timeout) leave the step
 * open, so Retry asks Wise and carries on with the same ids.
 */
export async function advance(t, { api = wiseApi, db = prisma } = {}) {
  const save = data => db.wiseTransfer.update({ where: { id: t.id }, data }).then(r => { t = r; return r })
  try {
    if (t.status === 'prepared') {
      const q = await api.createQuote({ sourceCents: t.sourceCents, targetCurrency: t.targetCurrency, recipientId: t.wiseRecipientId })
      if (q.disabled) { await save({ status: 'failed', failureReason: q.disabled, traceId: q.traceId }); return t }
      await save({ quoteId: q.quoteId, rate: q.rate, targetMinor: q.targetMinor, feeCents: q.feeCents, traceId: q.traceId })
      const tr = await api.createTransfer({ recipientId: t.wiseRecipientId, quoteId: q.quoteId, customerTransactionId: t.customerTransactionId, reference: 'Trackstar' })
      if (!tr.transferId) throw new wiseApi.WiseError('Wise did not return a transfer', { unsure: true })
      await save({ wiseTransferId: tr.transferId, wiseState: tr.state, status: 'created', failureReason: null, traceId: tr.traceId })
    }
    if (t.status === 'created') {
      // Paid for already? (The fund call timed out last time but went through.)
      const now = await api.getTransfer(t.wiseTransferId)
      if (now.state && now.state !== 'incoming_payment_waiting') {
        if (['cancelled', 'funds_refunded'].includes(now.state)) { await save({ status: 'failed', wiseState: now.state, failureReason: `Wise shows this transfer as ${now.state.replace(/_/g, ' ')}` }); return t }
        await markFunded(t, now.state, now.traceId, db)
        return t
      }
      const f = await api.fundTransfer(t.wiseTransferId)
      if (f.status === 'REJECTED') {
        const why = f.errorCode === 'balance.insufficient-funds' ? 'Not enough in the Wise USD balance' : `Wise turned down the payment${f.errorCode ? ` (${f.errorCode})` : ''}`
        await save({ status: 'failed', failureReason: why, traceId: f.traceId })
        return t
      }
      await markFunded(t, 'processing', f.traceId, db)
    }
  } catch (e) {
    const reason = e?.unsure ? 'Wise did not answer. Retry sends the same payment again, never a second one.' : (e?.expose ? e.message : 'Something went wrong talking to Wise')
    await save({ status: e?.unsure ? t.status : 'failed', failureReason: reason, traceId: e?.traceId || t.traceId }).catch(() => {})
  }
  return t
}

async function markFunded(t, state, traceId, db) {
  const at = new Date()
  await db.wiseTransfer.update({ where: { id: t.id }, data: { status: 'funded', wiseState: state, fundedAt: at, failureReason: null, traceId } })
  await db.payoutLine.updateMany({ where: { wiseTransferId: t.id }, data: { paidAt: at, paidRef: `Wise #${t.wiseTransferId}` } })
  t.status = 'funded'
}

/** The run's status from its transfers, and paidAt once every live one has gone out. */
async function settleRun(runId) {
  const ts = await prisma.wiseTransfer.findMany({ where: { payRunId: runId }, select: { status: true, fundedAt: true } })
  const status = runStatusOf(ts)
  const paidAt = status === 'paid' ? ts.map(t => t.fundedAt).filter(Boolean).sort((a, b) => b - a)[0] || new Date() : null
  await prisma.payRun.update({ where: { id: runId }, data: { status, paidAt } })
  return status
}

async function runSummary(runId) {
  const status = await settleRun(runId)
  const run = await prisma.payRun.findUnique({ where: { id: runId }, include: { transfers: { orderBy: { createdAt: 'asc' } } } })
  const users = new Map((await prisma.user.findMany({ where: { id: { in: run.transfers.map(t => t.userId) } }, select: { id: true, firstName: true, lastName: true } })).map(u => [u.id, name(u)]))
  return {
    runId, label: run.label, status,
    totalCents: run.transfers.reduce((n, t) => n + t.sourceCents, 0),
    transfers: run.transfers.map(t => shapeTransfer(t, users.get(t.userId))),
  }
}

export function shapeTransfer(t, personName = null) {
  return {
    id: t.id, userId: t.userId, name: personName, status: t.status, wiseState: t.wiseState, cents: t.sourceCents, currency: t.targetCurrency,
    targetMinor: t.targetMinor, rate: t.rate, feeCents: t.feeCents, wiseTransferId: t.wiseTransferId, failureReason: t.failureReason,
    traceId: t.traceId, fundedAt: t.fundedAt, sentAt: t.sentAt, createdAt: t.createdAt,
  }
}

// ── Retry, release ────────────────────────────────────────────────────────

async function transferOr404(id) {
  const t = await prisma.wiseTransfer.findUnique({ where: { id: String(id || '') } })
  if (!t) throw new WisePayError('No such Wise payment', 404)
  return t
}

/** Try a stuck or failed transfer again, from where it stopped, with the same ids. */
export async function retry(id, { api = wiseApi } = {}) {
  let t = await transferOr404(id)
  if (MONEY_LEFT.includes(t.status)) throw new WisePayError('This one is already paid')
  if (['cancelled', 'returned'].includes(t.status)) throw new WisePayError('This one was released or returned; pay it again from Payouts')
  if (t.status === 'failed') t = await prisma.wiseTransfer.update({ where: { id: t.id }, data: { status: t.wiseTransferId ? 'created' : 'prepared', failureReason: null } })
  await advance(t, { api })
  return runSummary(t.payRunId)
}

/**
 * Give up on a transfer that sent no money (or whose money came back): cancel
 * it at Wise if it was made, and free its lines, so the hours or the month
 * can be paid again (by Wise or by hand).
 */
export async function release(id, { api = wiseApi } = {}) {
  const t = await transferOr404(id)
  if (MONEY_LEFT.includes(t.status)) throw new WisePayError('Money already went out on this one; it cannot be released')
  if (t.status === 'cancelled') throw new WisePayError('Already released')
  if (t.wiseTransferId && t.status !== 'returned') {
    const now = await api.getTransfer(t.wiseTransferId)
    if (now.state && !['incoming_payment_waiting', 'cancelled'].includes(now.state)) {
      throw new WisePayError(`Wise shows this as ${now.state.replace(/_/g, ' ')}, so it may have been paid. Check Wise before releasing.`, 409)
    }
    if (now.state === 'incoming_payment_waiting') await api.cancelTransfer(t.wiseTransferId)
  }
  await prisma.$transaction(async tx => {
    const lines = await tx.payoutLine.findMany({ where: { wiseTransferId: t.id }, select: { id: true, payRunId: true } })
    const ours = lines.filter(l => l.payRunId === t.payRunId).map(l => l.id)
    await tx.timesheet.updateMany({ where: { payoutLineId: { in: ours } }, data: { payoutLineId: null } })
    await tx.payoutLine.deleteMany({ where: { id: { in: ours } } })
    // Approved design lines live on the month's run: unhook them, keep the approval.
    await tx.payoutLine.updateMany({ where: { wiseTransferId: t.id }, data: { wiseTransferId: null, paidAt: null, paidRef: null } })
    await tx.wiseTransfer.update({ where: { id: t.id }, data: { status: 'cancelled' } })
  })
  return runSummary(t.payRunId)
}

// ── Status ────────────────────────────────────────────────────────────────

/**
 * Ask Wise about every transfer that has gone out and is not settled: funded
 * ones until they are sent, sent ones for 45 days (a bounce can come weeks
 * later). Money that comes back frees nothing by itself: the lines are marked
 * unpaid and the transfer shows Returned, for Matt to release and pay again.
 * Read only at Wise. Returns what changed.
 */
export async function refreshStatuses({ api = wiseApi, limit = 40 } = {}) {
  const since = new Date(Date.now() - 45 * 86400000)
  const open = await prisma.wiseTransfer.findMany({
    where: { wiseTransferId: { not: null }, OR: [{ status: 'funded' }, { status: 'sent', sentAt: { gte: since } }] },
    orderBy: { checkedAt: { sort: 'asc', nulls: 'first' } }, take: limit,
  })
  const changed = []
  const runs = new Set()
  for (const t of open) {
    try {
      const now = await api.getTransfer(t.wiseTransferId)
      const status = statusFromWise(now.state, t.status)
      const data = { wiseState: now.state, checkedAt: new Date(), traceId: now.traceId || t.traceId }
      if (status !== t.status) {
        data.status = status
        if (status === 'sent') data.sentAt = new Date()
        if (status === 'returned') {
          data.failureReason = `Wise: ${String(now.state).replace(/_/g, ' ')}. The money is back in the balance.`
          await prisma.payoutLine.updateMany({ where: { wiseTransferId: t.id }, data: { paidAt: null, paidRef: `Wise #${t.wiseTransferId} returned` } })
        }
        changed.push({ id: t.id, userId: t.userId, from: t.status, to: status, wiseState: now.state, cents: t.sourceCents })
        runs.add(t.payRunId)
      }
      await prisma.wiseTransfer.update({ where: { id: t.id }, data })
    } catch (e) {
      console.warn('[wisePay] status check failed', t.id, e?.code || e?.message)
      await prisma.wiseTransfer.update({ where: { id: t.id }, data: { checkedAt: new Date() } }).catch(() => {})
    }
  }
  for (const r of runs) await settleRun(r)
  return { checked: open.length, changed }
}

// ── Recipients and tax forms ──────────────────────────────────────────────

/** Everyone active with how they are paid, for Payouts > Rates. */
export async function payees() {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: PAYEE_SELECT, orderBy: [{ role: 'asc' }, { firstName: 'asc' }] })
  return users.map(u => ({ userId: u.id, name: name(u), role: u.role, recipientId: u.wiseRecipientId, recipientName: u.wiseRecipientName, currency: u.payoutCurrency, country: u.payoutCountry, taxFormType: u.taxFormType, taxFormOnFile: u.taxFormOnFile }))
}

/** The recipients on the Wise profile, to pick from (masked account summaries, never stored). */
export async function recipients({ api = wiseApi } = {}) {
  const list = await api.listRecipients()
  // own: the business's own accounts (Wise lists them as recipients); never a person's pay.
  return list.filter(r => r.active && !r.own).map(r => ({ ...r, problem: recipientProblem(r) }))
}

/** Link a person to a Wise recipient (checked against Wise), or unlink with null. */
export async function linkRecipient(userId, recipientId, { api = wiseApi } = {}) {
  const u = await prisma.user.findUnique({ where: { id: String(userId || '') }, select: { id: true } })
  if (!u) throw new WisePayError('No such person', 404)
  if (!recipientId) {
    await prisma.user.update({ where: { id: u.id }, data: { wiseRecipientId: null, wiseRecipientName: null, payoutCurrency: null, payoutCountry: null } })
    return payees()
  }
  const r = await api.getRecipient(String(recipientId))
  const problem = recipientProblem(r)
  if (problem) throw new WisePayError(problem)
  await prisma.user.update({ where: { id: u.id }, data: { wiseRecipientId: r.id, wiseRecipientName: r.name || null, payoutCurrency: r.currency, payoutCountry: r.country } })
  return payees()
}

export async function setTaxForm(userId, { type, onFile }) {
  const u = await prisma.user.findUnique({ where: { id: String(userId || '') }, select: { id: true } })
  if (!u) throw new WisePayError('No such person', 404)
  if (type != null && !TAX_FORMS.includes(type)) throw new WisePayError('Tax form is W-9 or W-8BEN')
  await prisma.user.update({ where: { id: u.id }, data: { taxFormType: type ?? null, taxFormOnFile: Boolean(onFile) && type != null } })
  return payees()
}

// ── Read only, for Payouts and the MCP ────────────────────────────────────

/** The latest Wise runs with each transfer's state. */
export async function latestRuns({ take = 5 } = {}) {
  const runs = await prisma.payRun.findMany({ where: { via: 'wise' }, orderBy: { createdAt: 'desc' }, take, include: { transfers: { orderBy: { createdAt: 'asc' } } } })
  const ids = [...new Set(runs.flatMap(r => r.transfers.map(t => t.userId)))]
  const users = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })).map(u => [u.id, name(u)]))
  return runs.map(r => ({ runId: r.id, label: r.label, status: r.status, createdAt: r.createdAt, paidAt: r.paidAt, totalCents: r.transfers.reduce((n, t) => n + t.sourceCents, 0), transfers: r.transfers.map(t => shapeTransfer(t, users.get(t.userId))) }))
}
