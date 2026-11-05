import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supportOpenError, parseSupportOpen, sentAnywayAt, sentAnywayMark } from './holdsPrint.js'
import { sendStateOf } from '../render/sendState.js'

test('the saved reason carries the thread and reads cleanly without it', () => {
  const e = supportOpenError({ id: 'abc123', who: 'Jane Doe' })
  assert.deepEqual(parseSupportOpen(e), { threadId: 'abc123', reason: 'Support conversation open with Jane Doe' })
  assert.equal(parseSupportOpen('Artelo is still processing the file'), null)
})

test('Send anyway is remembered until a new hold or approval clears it', () => {
  const at = new Date('2026-11-05T15:00:00Z')
  assert.equal(sentAnywayAt({ sendHeldBy: sentAnywayMark('Matt Flickman', at) })?.toISOString(), at.toISOString())
  assert.equal(sentAnywayAt({ sendHeldBy: 'Matt Flickman', sendHeldAt: new Date() }), null)
  assert.equal(sentAnywayAt({ sendHeldBy: null }), null)
})

test('a print waiting out the change window is in hold; one due in minutes is not', () => {
  const later = sendStateOf({ review: 'approved', sendAfter: new Date(Date.now() + 30 * 3600_000) })
  assert.equal(later.state, 'queued')
  assert.equal(later.inHold, true)
  assert.equal(sendStateOf({ review: 'approved', sendAfter: new Date(Date.now() + 4 * 60_000) }).inHold, false)
})

test('an open conversation shows as support, with the thread to open', () => {
  const s = sendStateOf({ review: 'approved', sendAfter: new Date(), sendError: supportOpenError({ id: 't1', who: 'Jane' }) })
  assert.equal(s.state, 'support')
  assert.equal(s.threadId, 't1')
})
