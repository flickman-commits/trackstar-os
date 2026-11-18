import '../../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skipReason, fillReply, DEFAULT_AUTO_REPLY } from './autoReply.js'
import { isAutomated } from './mailbox.js'

const now = Date.parse('2026-11-18T15:00:00Z')
const thread = (over = {}) => ({ channel: 'email', customerEmail: 'jane.doe@gmail.com', customerName: 'Jane Doe', autoRepliedAt: null, backfilled: false, filtered: false, mergedIntoId: null, lastOutboundAt: null, ...over })
const first = (over = {}) => ({ direction: 'in', fromEmail: 'jane.doe@gmail.com', subject: 'Where is my print?', auto: false, senderCheck: 'pass', sentAt: new Date(now - 5 * 60_000), ...over })
const why = (t = {}, m = {}, extra = {}) => skipReason({ thread: thread(t), first: first(m), now, mailbox: 'fast@trackstar.art', ...extra })

test('a new customer email gets the auto-reply', () => {
  assert.equal(why(), null)
})

test('who never gets one', () => {
  assert.equal(why({ backfilled: true }), 'history')
  assert.equal(why({ filtered: true }), 'filtered sender')
  assert.equal(why({ lastOutboundAt: new Date() }), 'already answered')
  assert.equal(why({}, { direction: 'out' }), 'we started it')
  assert.equal(why({ customerEmail: 'matt@trackstar.art' }), 'our own address')
  assert.equal(why({}, {}, { forwarded: true }), 'forwarded by a teammate')
  assert.equal(why({}, { auto: true }), 'sent by a machine')
  assert.equal(why({ customerEmail: 'mailer-daemon@googlemail.com' }, { fromEmail: 'mailer-daemon@googlemail.com' }), 'bounce')
  assert.equal(why({}, { subject: 'Delivery Status Notification (Failure)' }), 'bounce')
  assert.equal(why({}, { senderCheck: 'fail' }), 'failed the sender check')
  assert.equal(why({ customerEmail: 'no-reply@shop.com' }), 'no-reply address')
  assert.equal(why({ customerEmail: 'notifications@acme.com' }), 'no-reply address')
  assert.equal(why({ customerEmail: 'support@artelo.io' }), 'vendor')
  assert.equal(why({ customerEmail: 'mailer@shopify.com' }), 'no-reply address')
  assert.equal(why({ customerEmail: 'store+orders@shopify.com' }), 'vendor')
  assert.equal(why({}, { sentAt: new Date(now - 3 * 3600_000) }), 'too old')
  assert.equal(why({}, {}, { recent: true }), 'replied to this customer today')
  assert.equal(why({ channel: 'instagram' }), 'not email')
})

test('[First name] becomes their first name, or "there"', () => {
  assert.match(fillReply(DEFAULT_AUTO_REPLY, 'JANE DOE'), /^Hey Jane,/)
  assert.match(fillReply(DEFAULT_AUTO_REPLY, 'jane'), /^Hey Jane,/)
  assert.match(fillReply(DEFAULT_AUTO_REPLY, ''), /^Hey there,/)
  assert.match(fillReply(DEFAULT_AUTO_REPLY, 'j.doe1987'), /^Hey there,/)
  assert.match(DEFAULT_AUTO_REPLY, /within 48 hours/)
})

test('out-of-office replies and mailings are spotted by their headers', () => {
  assert.equal(isAutomated({ 'auto-submitted': 'auto-replied' }), true)
  assert.equal(isAutomated({ 'auto-submitted': 'no' }), false)
  assert.equal(isAutomated({ precedence: 'bulk' }), true)
  assert.equal(isAutomated({ 'list-unsubscribe': '<mailto:x@y.com>' }), true)
  assert.equal(isAutomated({ 'x-auto-response-suppress': 'All' }), true)
  assert.equal(isAutomated({ subject: 'Hi' }), false)
})
