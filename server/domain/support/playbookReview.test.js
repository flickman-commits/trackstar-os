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
