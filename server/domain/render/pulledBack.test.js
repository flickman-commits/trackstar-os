import '../../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPulledBack, planPullBack, pullBack, HELD_IN_ARTELO } from './pulledBack.js'
import { sendStateOf } from './sendState.js'
import { siblingBlock } from './siblingGate.js'

const HOUR = 3600_000
const ago = h => new Date(Date.now() - h * HOUR)
const job = (id, version, extra = {}) => ({ id, version, status: 'done', review: 'approved', spec: {}, arteloSentAt: null, ...extra })

test('only an order waiting on us counts, and never one Artelo is holding for its own reasons', () => {
  const live = (status, productionStatus) => ({ status, productionStatus })
  assert.equal(isPulledBack(live('PendingFulfillmentAction', 'Missing Designs'), { sure: true }), true)
  assert.equal(isPulledBack(live('PendingFulfillmentAction', 'Pending Approval'), { sure: true }), true)
  assert.equal(isPulledBack(live('PendingFulfillmentAction', 'On Hold'), { sure: true }), true)
  for (const why of ['Needs Address Review', 'Customer Unpaid']) {
    assert.equal(isPulledBack(live('PendingFulfillmentAction', why)), false)
    assert.equal(isPulledBack(live('PendingFulfillmentAction', why), { sure: true }), false)
  }
  // Something we have no name for: a person may act on it, the import may not.
  assert.equal(isPulledBack(live('PendingFulfillmentAction', null)), true)
  assert.equal(isPulledBack(live('PendingFulfillmentAction', null), { sure: true }), false)
  for (const s of ['Received', 'InProduction', 'Produced', 'Shipped', 'Canceled', 'AwaitingPayment']) assert.equal(isPulledBack(live(s, s)), false)
  assert.equal(isPulledBack(null), false)
})

test('the sent design is held, unless a newer one is already waiting', () => {
  const sent = job('a', 2, { arteloSentAt: ago(3) })
  assert.deepEqual(planPullBack([sent, job('old', 1, { review: 'closed' })]), { hold: sent, close: [] })
  assert.deepEqual(planPullBack([job('b', 3, { review: 'pending' }), sent]), { hold: null, close: [sent] })
  // A newer one that was rejected, or another size, is not what prints next.
  assert.equal(planPullBack([job('b', 3, { review: 'rejected' }), sent]).hold, sent)
  assert.equal(planPullBack([job('b', 3, { spec: { altSize: true } }), sent]).hold, sent)
  assert.equal(planPullBack([job('c', 1)]), null)
})

test('a held design waits for a person, and its siblings wait for it', () => {
  const held = job('a', 2, { sendHeldAt: new Date(), sendHeldBy: HELD_IN_ARTELO, arteloAttachedAt: ago(3), arteloItemId: 'i1' })
  assert.deepEqual(sendStateOf(held), { state: 'held', at: held.sendHeldAt, by: HELD_IN_ARTELO })
  assert.match(siblingBlock([{ label: 'Print 2', jobs: [held] }]), /held/)
})

/** The rows of one Artelo order, with every write recorded. */
function fakeDb(rows) {
  const writes = []
  const db = {
    order: { findMany: async () => rows },
    $transaction: async fn => fn({
      renderJob: { updateMany: async a => { writes.push(['job', a.where.id, a.data]); return { count: a.where.id === 'moved' ? 0 : 1 } } },
      order: { update: async a => { writes.push(['order', a.where.id, a.data]); return {} } },
    }),
  }
  return { writes, db }
}
const row = (id, jobs, extra = {}) => ({ id, orderNumber: `${id}-0`, lineItemIndex: 0, status: 'completed', trackstarOrderType: 'standard', runnerName: 'Ann', shopifyOrderData: { name: '10920' }, arteloOrderData: { id: 'art', status: 'Received' }, runnerResearch: [{ researchStatus: 'found' }], renderJobs: jobs, ...extra })
const LIVE = { status: 'PendingFulfillmentAction', productionStatus: 'Missing Designs' }

test('every standard print of the order is opened and held; a custom print and another Artelo order are left alone', async () => {
  const { writes, db } = fakeDb([
    row('o1', [job('j1', 2, { arteloSentAt: ago(5) })]),
    row('o2', [job('j2', 1, { arteloSentAt: ago(5) })], { lineItemIndex: 1 }),
    row('cust', [job('j3', 1, { arteloSentAt: ago(5) })], { trackstarOrderType: 'custom' }),
    row('else', [job('j4', 1, { arteloSentAt: ago(5) })], { arteloOrderData: { id: 'other' } }),
  ])
  const done = await pullBack({ parentOrderNumber: 'p', arteloId: 'art', live: LIVE, db })
  assert.deepEqual(done.map(d => d.number), ['10920', '10920-2'])
  const jobs = writes.filter(w => w[0] === 'job'), orders = writes.filter(w => w[0] === 'order')
  assert.deepEqual(jobs.map(w => w[1]), ['j1', 'j2'])
  assert.equal(jobs[0][2].arteloSentAt, null)
  assert.equal(jobs[0][2].sendHeldBy, HELD_IN_ARTELO)
  // Still attached as far as we know, so the other print cannot take it along (siblingGate.js).
  assert.equal('arteloAttachedAt' in jobs[0][2], false)
  assert.equal(orders[0][2].status, 'ready')
  assert.deepEqual([orders[0][2].arteloOrderData.status, orders[0][2].arteloOrderData.productionStatus], ['PendingFulfillmentAction', 'Missing Designs'])
})

test('nothing is undone right after a send, unless a person asks', async () => {
  const { writes, db } = fakeDb([row('o1', [job('j1', 1, { arteloSentAt: new Date(Date.now() - 5 * 60_000) })])])
  assert.deepEqual(await pullBack({ parentOrderNumber: 'p', arteloId: 'art', live: LIVE, db }), [])
  assert.equal(writes.length, 0)
  assert.equal((await pullBack({ parentOrderNumber: 'p', arteloId: 'art', live: LIVE, db, actor: { id: 'u1', email: 'a@b.c' } })).length, 1)
})

test('a send that changed while we looked leaves the order as it was', async () => {
  const { writes, db } = fakeDb([row('o1', [job('moved', 1, { arteloSentAt: ago(5) })])])
  assert.deepEqual(await pullBack({ parentOrderNumber: 'p', arteloId: 'art', live: LIVE, db }), [])
  assert.equal(writes.some(w => w[0] === 'order'), false)
})

test('an order someone already reopened keeps its status', async () => {
  const { writes, db } = fakeDb([row('o1', [job('j1', 1, { arteloSentAt: ago(5) })], { status: 'pending' })])
  await pullBack({ parentOrderNumber: 'p', arteloId: 'art', live: LIVE, db })
  assert.equal('status' in writes.find(w => w[0] === 'order')[2], false)
})
