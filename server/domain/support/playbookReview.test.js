import '../../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewWarnings } from './playbookReview.js'

const BEFORE = `## Voice
Short and warm.

## Escalate
Legal threats, press and race organizers go to Matt.

## Situations
Tracking: send the Artelo tracking link from the order (https://trackstar.art/pages/track).
Refunds: up to $25 without asking Matt.`

test('an edit to voice or a situation goes live on its own', () => {
  assert.deepEqual(reviewWarnings(BEFORE, BEFORE.replace('Short and warm.', 'Short, warm, no exclamation marks.')), [])
})

test('a new link is held for a person', () => {
  const after = BEFORE.replace('(https://trackstar.art/pages/track)', '(https://track-your-order.example)')
  assert.match(reviewWarnings(BEFORE, after).join(), /adds link.*track-your-order\.example/)
})

test('a change to Escalate or to a refund rule is held for a person', () => {
  assert.match(reviewWarnings(BEFORE, BEFORE.replace('Legal threats, press', 'Press')).join(), /Escalate/)
  assert.match(reviewWarnings(BEFORE, BEFORE.replace('up to $25', 'up to $250')).join(), /refunds/)
})

test('each change applies on its own, and one that no longer fits is refused', async () => {
  const { applyChange, checkChanges } = await import('./playbookReview.js')
  const voice = { what: 'Voice', why: 'x', edits: [{ old: 'Short and warm.', new: 'Short, warm, no exclamation marks.' }] }
  const refund = { what: 'Refunds', why: 'y', edits: [{ old: 'Refunds: up to $25 without asking Matt.', new: 'Refunds: up to $50 without asking Matt.' }] }
  const { changes, playbook } = checkChanges(BEFORE, [voice, refund, { what: 'Bad', why: 'z', edits: [{ old: 'not in the playbook', new: 'x' }] }])
  assert.deepEqual(changes.map(c => [c.id, c.what, c.warnings.length > 0]), [['c1', 'Voice', false], ['c2', 'Refunds', true]])
  assert.match(playbook, /no exclamation marks[\s\S]*up to \$50/)
  // Deny the first, approve the second: only the second lands.
  const only = applyChange(BEFORE, changes[1])
  assert.match(only, /Short and warm\.[\s\S]*up to \$50/)
  // A line the playbook no longer has cannot be applied.
  assert.equal(applyChange(only, changes[1]), null)
})

test('removing a line takes its line break with it', async () => {
  const { applyChange } = await import('./playbookReview.js')
  const after = applyChange(BEFORE, { edits: [{ old: 'Refunds: up to $25 without asking Matt.', new: '' }] })
  assert.ok(after.endsWith('(https://trackstar.art/pages/track).'))
})
