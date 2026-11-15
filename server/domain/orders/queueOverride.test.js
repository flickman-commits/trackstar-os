import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pipelineFor, overrideBasis } from './pipeline.js'

const order = { status: 'completed', raceName: 'NYC Marathon', raceYear: 2026 }

test('a manual move holds while the worked-out stage is the one it was made from', () => {
  const base = pipelineFor({ order: { ...order, status: 'completed' } })
  assert.equal(base.stage, 'done')
  // Completed orders are never moved.
  const moved = pipelineFor({ order: { ...order, queueOverride: { stage: 'review', basis: overrideBasis(base), by: 'Elí', note: 'x' } } })
  assert.equal(moved.stage, 'done')
})

test('a move is dropped once the order changes, and applies while it has not', () => {
  const flagged = { ...order, status: 'flagged', flagReason: 'Check the name' }
  const base = pipelineFor({ order: flagged })
  assert.equal(base.stage, 'action')
  const held = pipelineFor({ order: { ...flagged, queueOverride: { stage: 'waiting', basis: overrideBasis(base), by: 'Elí', note: 'Asked the customer', at: '2026-11-15T12:00:00Z' } } })
  assert.equal(held.stage, 'waiting')
  assert.equal(held.reason, 'Moved to Waiting')
  assert.equal(held.overridden.fromReason, 'Flagged')
  const stale = pipelineFor({ order: { ...flagged, queueOverride: { stage: 'waiting', basis: 'review|Ready for review', by: 'Elí' } } })
  assert.equal(stale.stage, 'action')
})
