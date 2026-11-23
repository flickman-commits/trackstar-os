import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOwnOnly, ownInboxWhere, OWN_THREAD_ACTIONS, assertThreadAccess, assertOwnAssign, narrowThreadForOwn, NOT_YOURS } from './access.js'

const dan = { id: 'dan', supportScope: 'own' }
const dani = { id: 'dani', supportScope: 'all' }
const threads = {
  mine: { id: 'mine', assigneeId: 'dan', mergedIntoId: null },
  theirs: { id: 'theirs', assigneeId: 'dani', mergedIntoId: null },
  unassigned: { id: 'unassigned', assigneeId: null, mergedIntoId: null },
  foldedIntoMine: { id: 'foldedIntoMine', assigneeId: 'dani', mergedIntoId: 'mine' },
}
const load = id => threads[id] || null

test('a designer opens only the conversations assigned to them', async () => {
  await assertThreadAccess(dan, 'mine', { load })
  await assertThreadAccess(dan, 'foldedIntoMine', { load })
  for (const id of ['theirs', 'unassigned', 'missing']) {
    await assert.rejects(assertThreadAccess(dan, id, { load }), e => e.message === NOT_YOURS && e.status === 403)
  }
})

test('Support opens every conversation, without a lookup', async () => {
  await assertThreadAccess(dani, 'theirs', { load: () => { throw new Error('should not look') } })
  assert.equal(isOwnOnly(dani), false)
  assert.equal(isOwnOnly(dan), true)
})

test("a designer's inbox is theirs and not closed", () => {
  assert.deepEqual(ownInboxWhere('dan'), { assigneeId: 'dan', mergedIntoId: null, status: { not: 'closed' } })
})

test('a designer can answer, note, close and send back, but not merge, link orders or approve refunds', () => {
  for (const a of ['assign', 'status', 'snooze', 'note', 'redraft', 'unread', 'notWaiting']) assert.ok(OWN_THREAD_ACTIONS.has(a), a)
  for (const a of ['merge', 'linkOrder', 'unlinkOrder', 'proposal', 'priority', 'damage']) assert.ok(!OWN_THREAD_ACTIONS.has(a), a)
})

test('a designer can send a conversation back to Support, not to a teammate', () => {
  assertOwnAssign(dan, null)
  assertOwnAssign(dan, 'dan')
  assert.throws(() => assertOwnAssign(dan, 'dani'), e => e.status === 403)
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
