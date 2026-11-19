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

test('a customer with an order they can still change gets its own link in place of the general line', async () => {
  const { personalizeReply } = await import('./autoReply.js')
  const wording = 'Hey Jane,\n\nWe got it.\n\n- **Where is my order?** 10 to 12 days.\n- **Need to change something?** Use the "Manage your order" button in your confirmation email.\n\nThanks'
  const links = [{ number: '10245', url: 'https://fast.trackstar.art/order/123456789/abc', closesAt: new Date('2026-11-20T20:15:00Z') }]
  const out = personalizeReply(wording, links)
  assert.match(out, /- \*\*Need to change something on order #10245\?\*\* .* until Fri, Nov 20, 3:15 PM ET\. \[Manage your order\]\(https:\/\/fast\.trackstar\.art\/order\/123456789\/abc\)/)
  assert.doesNotMatch(out, /confirmation email/)
  assert.match(out, /Where is my order/)
  // No order found: the wording as written.
  assert.equal(personalizeReply(wording, []), wording)
  // Wording without the line: the links go after the first paragraph.
  assert.match(personalizeReply('Hey Jane,\n\nWe got it.', links), /^Hey Jane,\n\n- \*\*Need to change something on order #10245/)
})

test('the link is the one the confirmation email builds, and nothing without the secret', async () => {
  const { manageUrl, linkSignature, linkIsValid } = await import('../orders/changeWindow.js')
  const was = process.env.SELF_SERVE_LINK_SECRET
  try {
    delete process.env.SELF_SERVE_LINK_SECRET
    assert.equal(manageUrl('7594451894555'), null)
    process.env.SELF_SERVE_LINK_SECRET = 'test-secret'
    const url = manageUrl('7594451894555')
    const [, id, sig] = url.match(/\/order\/(\d+)\/([0-9a-f]+)$/)
    assert.equal(id, '7594451894555')
    assert.equal(sig, linkSignature('7594451894555'))
    assert.equal(linkIsValid(id, sig), true)
    assert.equal(manageUrl('not-an-id'), null)
  } finally {
    if (was === undefined) delete process.env.SELF_SERVE_LINK_SECRET; else process.env.SELF_SERVE_LINK_SECRET = was
  }
})
