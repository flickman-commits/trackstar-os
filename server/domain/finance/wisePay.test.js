/** Paying through Wise: the blocks, the run's state, and a transfer's steps, against a fake Wise. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipientProblem, blockersFor, runStatusOf, statusFromWise, advance, TRANSFER_CAP_CENTS } from './wisePay.js'

test('a CRC recipient must be a Costa Rican IBAN', () => {
  assert.match(recipientProblem({ id: '1', active: true, currency: 'CRC', ibanPrefix: null }), /CRC IBAN/)
  assert.match(recipientProblem({ id: '1', active: true, currency: 'CRC', ibanPrefix: 'US' }), /CRC IBAN/)
  assert.equal(recipientProblem({ id: '1', active: true, currency: 'CRC', ibanPrefix: 'CR' }), null)
  assert.equal(recipientProblem({ id: '1', active: true, currency: 'COP', ibanPrefix: null }), null)
  assert.match(recipientProblem({ id: '1', active: false, currency: 'USD' }), /switched off/)
})

test('blocks: no recipient, no tax form, an open week, no rate, over the COP limit', () => {
  const ok = { recipientId: '9', taxFormOnFile: true, cents: 34080, currency: 'CRC' }
  assert.deepEqual(blockersFor(ok), [])
  assert.match(blockersFor({ ...ok, recipientId: null })[0], /No Wise recipient/)
  assert.match(blockersFor({ ...ok, taxFormOnFile: false })[0], /tax form/)
  assert.match(blockersFor({ ...ok, waiting: 'Their week of Nov 9 is not approved yet' })[0], /not approved/)
  assert.match(blockersFor({ ...ok, cents: 0, noRate: true })[0], /No hourly rate/)
  assert.deepEqual(blockersFor({ ...ok, currency: 'COP', cents: TRANSFER_CAP_CENTS.COP }), [])
  assert.match(blockersFor({ ...ok, currency: 'COP', cents: TRANSFER_CAP_CENTS.COP + 1 })[0], /per-transfer limit for COP/)
})

test("a run's status follows its transfers", () => {
  assert.equal(runStatusOf([{ status: 'funded' }, { status: 'sent' }]), 'paid')
  assert.equal(runStatusOf([{ status: 'funded' }, { status: 'created' }]), 'sending')
  assert.equal(runStatusOf([{ status: 'sent' }, { status: 'failed' }]), 'partial')
  assert.equal(runStatusOf([{ status: 'failed' }, { status: 'cancelled' }]), 'failed')
  assert.equal(runStatusOf([{ status: 'sent' }, { status: 'cancelled' }]), 'paid')
})

test("Wise's states map to ours", () => {
  assert.equal(statusFromWise('outgoing_payment_sent', 'funded'), 'sent')
  assert.equal(statusFromWise('processing', 'funded'), 'funded')
  assert.equal(statusFromWise('bounced_back', 'sent'), 'returned')
  assert.equal(statusFromWise('funds_refunded', 'funded'), 'returned')
  assert.equal(statusFromWise('cancelled', 'funded'), 'returned')
})

/** A fake Wise that records calls and dedupes on customerTransactionId, as Wise does. */
function fakeWise({ fundStatus = 'COMPLETED', failCreateOnce = false, failFundOnce = false } = {}) {
  const calls = []
  const byCtid = new Map()
  const state = new Map()
  let createFails = failCreateOnce, fundFails = failFundOnce
  return {
    calls, state,
    wiseEnv: () => 'sandbox',
    async createQuote(a) { calls.push(['quote', a.sourceCents]); return { quoteId: `q${calls.length}`, rate: '500.1', targetMinor: a.sourceCents * 500, feeCents: 120, traceId: 't' } },
    async createTransfer(a) {
      calls.push(['create', a.customerTransactionId])
      if (!byCtid.has(a.customerTransactionId)) { byCtid.set(a.customerTransactionId, `w${byCtid.size + 1}`); state.set(byCtid.get(a.customerTransactionId), 'incoming_payment_waiting') }
      if (createFails) { createFails = false; const e = new Error('timeout'); e.unsure = true; throw e }
      return { transferId: byCtid.get(a.customerTransactionId), state: 'incoming_payment_waiting', traceId: 't' }
    },
    async getTransfer(id) { calls.push(['get', id]); return { transferId: id, state: state.get(id), traceId: 't' } },
    async fundTransfer(id) {
      calls.push(['fund', id])
      if (fundStatus === 'COMPLETED') state.set(id, 'processing')
      if (fundFails) { fundFails = false; const e = new Error('timeout'); e.unsure = true; throw e }
      return { status: fundStatus, errorCode: fundStatus === 'REJECTED' ? 'balance.insufficient-funds' : null, traceId: 't' }
    },
  }
}
function fakeDb(t) {
  const lines = [{ id: 'l1', wiseTransferId: t.id, paidAt: null }]
  return {
    lines,
    wiseTransfer: { async update({ data }) { Object.assign(t, data); return { ...t } } },
    payoutLine: { async updateMany({ where, data }) { let n = 0; for (const l of lines) if (l.wiseTransferId === where.wiseTransferId) { Object.assign(l, data); n++ } return { count: n } } },
  }
}
const newTransfer = () => ({ id: 'x1', status: 'prepared', sourceCents: 34080, targetCurrency: 'CRC', wiseRecipientId: '9', customerTransactionId: 'ctid-1', wiseTransferId: null })

test('a transfer is quoted, created and funded, and its lines marked paid', async () => {
  const t = newTransfer(), api = fakeWise(), db = fakeDb(t)
  await advance(t, { api, db })
  assert.equal(t.status, 'funded')
  assert.equal(t.wiseTransferId, 'w1')
  assert.deepEqual(api.calls.map(c => c[0]), ['quote', 'create', 'get', 'fund'])
  assert.ok(db.lines[0].paidAt)
  assert.equal(db.lines[0].paidRef, 'Wise #w1')
})

test('a timeout on create leaves it open; the retry sends the same id and Wise makes one transfer', async () => {
  const t = newTransfer(), api = fakeWise({ failCreateOnce: true }), db = fakeDb(t)
  await advance(t, { api, db })
  assert.equal(t.status, 'prepared')
  assert.match(t.failureReason, /never a second one/)
  await advance(t, { api, db })
  assert.equal(t.status, 'funded')
  const creates = api.calls.filter(c => c[0] === 'create')
  assert.equal(creates.length, 2)
  assert.ok(creates.every(c => c[1] === 'ctid-1'))
  assert.equal(api.state.size, 1)
  assert.equal(api.calls.filter(c => c[0] === 'fund').length, 1)
})

test('a fund call that timed out but went through is not funded twice', async () => {
  const t = newTransfer(), api = fakeWise({ failFundOnce: true }), db = fakeDb(t)
  await advance(t, { api, db })
  assert.equal(t.status, 'created')
  await advance(t, { api, db })
  assert.equal(t.status, 'funded')
  assert.equal(api.calls.filter(c => c[0] === 'fund').length, 1)
})

test('a short balance at Wise fails the transfer and pays no lines', async () => {
  const t = newTransfer(), api = fakeWise({ fundStatus: 'REJECTED' }), db = fakeDb(t)
  await advance(t, { api, db })
  assert.equal(t.status, 'failed')
  assert.match(t.failureReason, /Not enough/)
  assert.equal(db.lines[0].paidAt, null)
})
