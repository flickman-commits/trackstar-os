import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siblingBlock } from './siblingGate.js'

const approved = (id, extra = {}) => ({ id, status: 'done', review: 'approved', arteloAttachedAt: new Date(), arteloSentAt: null, sendHeldAt: null, ...extra })

test('every other print approved and attached: the order may go', () => {
  assert.equal(siblingBlock([{ label: 'Print 2', jobs: [approved('b1')] }]), null)
  assert.equal(siblingBlock([]), null)
})

test('a held print whose design is attached stops the whole order', () => {
  const msg = siblingBlock([{ label: 'Print 2', jobs: [approved('b1', { sendHeldAt: new Date(), sendHeldBy: 'Matt' })] }])
  assert.match(msg, /Print 2 is held \(Matt\)/)
})

test('a print rejected after its design was attached stops the whole order', () => {
  const msg = siblingBlock([{ label: 'Print 2', jobs: [{ id: 'b1', status: 'done', review: 'rejected', arteloAttachedAt: new Date(), arteloSentAt: null }] }])
  assert.match(msg, /no longer its approved design \(rejected\)/)
})

test('a newer approved design that replaced an attached older one still holds until the older is replaced at Artelo', () => {
  const old = { id: 'b1', status: 'done', review: 'closed', arteloAttachedAt: new Date(), arteloSentAt: null }
  const now = approved('b2', { arteloAttachedAt: null })
  assert.match(siblingBlock([{ label: 'Print 2', jobs: [now, old] }]), /\(closed\)/)
})

test('a held print with nothing attached is left to Artelo, which still reads Missing Designs', () => {
  assert.equal(siblingBlock([{ label: 'Print 2', jobs: [approved('b1', { sendHeldAt: new Date(), arteloAttachedAt: null })] }]), null)
})

test('an older design is no longer attached once the approved one went onto the same item', () => {
  const old = { id: 'b1', status: 'done', review: 'closed', arteloAttachedAt: new Date(), arteloSentAt: null, arteloItemId: 'item-2' }
  const now = approved('b2', { arteloItemId: 'item-2' })
  assert.equal(siblingBlock([{ label: 'Print 2', jobs: [now, old] }]), null)
})
