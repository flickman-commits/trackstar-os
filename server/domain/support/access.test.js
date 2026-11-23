import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOwnOnly, ownInboxWhere, OWN_THREAD_ACTIONS, assertThreadAccess, assertOwnAssign, narrowThreadForOwn, designerCustomers, isTheirConversation, NOT_YOURS } from './access.js'

const dan = { id: 'dan', supportScope: 'own' }
const dani = { id: 'dani', supportScope: 'all' }
const threads = {
  mine: { id: 'mine', assigneeId: 'dan', mergedIntoId: null },
  theirs: { id: 'theirs', assigneeId: 'dani', mergedIntoId: null },
  unassigned: { id: 'unassigned', assigneeId: null, mergedIntoId: null },
  foldedIntoMine: { id: 'foldedIntoMine', assigneeId: 'dani', mergedIntoId: 'mine' },
}
const load = id => threads[id] || null
// Dan has one custom order: buyer@x.com, placed Nov 1.
const customers = async () => [{ email: 'buyer@x.com', since: new Date('2026-11-01T00:00:00Z') }]
Object.assign(threads, {
  freshEmail: { id: 'freshEmail', assigneeId: 'dani', mergedIntoId: null, customerEmail: 'Buyer@X.com', lastMessageAt: new Date('2026-11-20T00:00:00Z') },
  beforeOrder: { id: 'beforeOrder', assigneeId: null, mergedIntoId: null, customerEmail: 'buyer@x.com', lastMessageAt: new Date('2026-09-20T00:00:00Z') },
  stranger: { id: 'stranger', assigneeId: null, mergedIntoId: null, customerEmail: 'other@x.com', lastMessageAt: new Date('2026-11-20T00:00:00Z') },
})

test("a designer opens the conversations assigned to them and their orders' customers'", async () => {
  await assertThreadAccess(dan, 'mine', { load, customers })
  await assertThreadAccess(dan, 'foldedIntoMine', { load, customers })
  // The case that failed for Creed: a customer wrote in fresh and Support has it.
  await assertThreadAccess(dan, 'freshEmail', { load, customers })
  for (const id of ['theirs', 'unassigned', 'missing', 'beforeOrder', 'stranger']) {
    await assert.rejects(assertThreadAccess(dan, id, { load, customers }), e => e.message === NOT_YOURS && e.status === 403, id)
  }
})

test("the customers a designer may talk to are their custom orders', by the order's email and any linked address", async () => {
  const out = await designerCustomers('dan', {
    orders: async () => [
      { customerEmail: 'Buyer@x.com', createdAt: '2026-11-05T00:00:00Z', shopifyOrderData: { name: '#4947' } },
      { customerEmail: 'buyer@x.com', createdAt: '2026-11-01T00:00:00Z', shopifyOrderData: { name: '#4900' } },
      { customerEmail: '', createdAt: '2026-11-02T00:00:00Z', parentOrderNumber: '77' },
    ],
    linked: async () => [{ customerKey: 'work@x.com', orderNumber: '4947' }, { customerKey: 'ig:123', orderNumber: '4900' }],
  })
  assert.deepEqual(out.map(c => c.email).sort(), ['buyer@x.com', 'work@x.com'])
  // The earliest order decides how far back their conversations count.
  assert.equal(out.find(c => c.email === 'buyer@x.com').since.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.equal(isTheirConversation({ assigneeId: null, customerEmail: 'buyer@x.com', lastMessageAt: '2026-11-10T00:00:00Z' }, 'dan', out), true)
})

test('Support opens every conversation, without a lookup', async () => {
  await assertThreadAccess(dani, 'theirs', { load: () => { throw new Error('should not look') } })
  assert.equal(isOwnOnly(dani), false)
  assert.equal(isOwnOnly(dan), true)
})

test("a designer's inbox is theirs, their customers' included, and not closed", () => {
  const since = new Date('2026-11-01T00:00:00Z')
  assert.deepEqual(ownInboxWhere('dan', [{ email: 'buyer@x.com', since }]), {
    mergedIntoId: null, status: { not: 'closed' },
    OR: [{ assigneeId: 'dan' }, { customerEmail: { equals: 'buyer@x.com', mode: 'insensitive' }, lastMessageAt: { gte: since } }],
  })
})

test('a designer can answer, note, close and send back, but not merge, link orders or approve refunds', () => {
  for (const a of ['assign', 'status', 'snooze', 'note', 'redraft', 'unread', 'notWaiting']) assert.ok(OWN_THREAD_ACTIONS.has(a), a)
  for (const a of ['merge', 'linkOrder', 'unlinkOrder', 'proposal', 'priority', 'damage']) assert.ok(!OWN_THREAD_ACTIONS.has(a), a)
})

test('a designer can send a conversation back to Support, not to a teammate', () => {
  assertOwnAssign(dan, null)
  assertOwnAssign(dan, 'dan')
  assert.throws(() => assertOwnAssign(dan, 'dani'), e => e.status === 403)
  // Nobody has it: they may take it. A teammate has it: they may not take it off them, or hand it back.
  assertOwnAssign(dan, 'dan', null)
  assertOwnAssign(dan, null, 'dan')
  assert.throws(() => assertOwnAssign(dan, 'dan', 'dani'), e => e.status === 403)
  assert.throws(() => assertOwnAssign(dan, null, 'dani'), e => e.status === 403)
  assertOwnAssign(dani, 'dan')
})

test("a designer sees only their own custom orders on the customer, and none of the customer's other conversations", async () => {
  const t = {
    id: 'mine',
    customer: { email: 'a@b.com', conversations: 4 },
    context: { orders: [{ number: '4947', items: [{ orderId: 'o1' }, { orderId: 'o2' }] }, { number: '5001', items: [{ orderId: 'o9' }] }], bigSpender: true, spentUsd: 900 },
    pastThreads: [{ id: 'x' }], suggestedOrders: [{ number: '6000' }],
    printHolds: [{ number: '4947' }, { number: '5001' }],
  }
  const out = await narrowThreadForOwn(t, 'dan', { mineOf: async ids => ids.filter(id => id === 'o2') })
  assert.deepEqual(out.context.orders.map(o => o.number), ['4947'])
  assert.deepEqual(out.pastThreads, [])
  assert.deepEqual(out.suggestedOrders, [])
  assert.deepEqual(out.printHolds.map(h => h.number), ['4947'])
  assert.equal(out.customer.conversations, 1)
  assert.equal(out.context.bigSpender, false)
  assert.equal(out.ownOnly, true)
})
