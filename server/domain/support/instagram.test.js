import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { parseWebhook, bodyTextFor, replyWindow, splitForInstagram, MAX_MESSAGE_BYTES } from './instagram.js'
import { signatureOk } from '../../../api/_routes/support/instagram-webhook.js'

/** Meta's shape for one delivery, with the ids the docs use for a professional account and an Instagram-scoped user. */
function delivery(messaging, accountId = '17841400000000001') {
  return { object: 'instagram', entry: [{ id: accountId, time: 1760630400000, messaging }] }
}
const OURS = '17841400000000001'
const THEM = '5551234567890123'

test('a customer text DM becomes an inbound message on their thread', () => {
  const [m, ...rest] = parseWebhook(delivery([{
    sender: { id: THEM }, recipient: { id: OURS }, timestamp: 1760630400000,
    message: { mid: 'aWdfZAG1faXRlbTox', text: 'hey, I ordered the wrong frame' },
  }]))
  assert.equal(rest.length, 0)
  assert.equal(m.direction, 'in')
  assert.equal(m.customerId, THEM)
  assert.equal(m.igMessageId, 'aWdfZAG1faXRlbTox')
  assert.equal(m.text, 'hey, I ordered the wrong frame')
  assert.equal(m.sentAt.toISOString(), '2025-10-16T16:00:00.000Z'.replace('2025', '2025'))
  assert.equal(bodyTextFor(m), 'hey, I ordered the wrong frame')
})

test('an echo of our own message is outbound and still keyed to the customer', () => {
  const [m] = parseWebhook(delivery([{
    sender: { id: OURS }, recipient: { id: THEM }, timestamp: 1760630500000,
    message: { mid: 'echo1', text: 'On it!', is_echo: true },
  }]))
  assert.equal(m.direction, 'out')
  assert.equal(m.customerId, THEM)
  // Without the flag, a sender that is the account itself is still us.
  const [n] = parseWebhook(delivery([{ sender: { id: OURS }, recipient: { id: THEM }, message: { mid: 'echo2', text: 'x' } }]))
  assert.equal(n.direction, 'out')
})

test('attachments, story replies and unsupported messages read sensibly without text', () => {
  const events = parseWebhook(delivery([
    { sender: { id: THEM }, recipient: { id: OURS }, message: { mid: 'img', attachments: [{ type: 'image', payload: { url: 'https://cdn.example/x.jpg' } }] } },
    { sender: { id: THEM }, recipient: { id: OURS }, message: { mid: 'story', text: 'love this', reply_to: { story: { id: 's1', url: 'https://cdn.example/s.mp4' } } } },
    { sender: { id: THEM }, recipient: { id: OURS }, message: { mid: 'voice', is_unsupported: true } },
  ]))
  assert.equal(events.length, 3)
  assert.deepEqual(events[0].attachments, [{ filename: 'image', mimeType: 'instagram/image', size: 0, attachmentId: 'img:0', url: 'https://cdn.example/x.jpg' }])
  assert.equal(bodyTextFor(events[0]), '(Sent image)')
  assert.equal(bodyTextFor(events[1]), 'Replied to your story\nlove this')
  assert.match(bodyTextFor(events[2]), /voice note or a sticker/)
})

test('reads, reactions, deletions and other objects are not messages', () => {
  assert.deepEqual(parseWebhook(delivery([
    { sender: { id: THEM }, recipient: { id: OURS }, read: { mid: 'x' } },
    { sender: { id: THEM }, recipient: { id: OURS }, reaction: { mid: 'x', action: 'react', emoji: '❤️' } },
    { sender: { id: THEM }, recipient: { id: OURS }, message: { mid: 'gone', is_deleted: true } },
    { sender: { id: THEM }, recipient: { id: OURS }, message: { text: 'no mid' } },
  ])), [])
  assert.deepEqual(parseWebhook({ object: 'page', entry: [] }), [])
  assert.deepEqual(parseWebhook(null), [])
  assert.deepEqual(parseWebhook({}), [])
})

test('the signature check is Meta\'s sha256 HMAC over the raw bytes, and nothing else passes', () => {
  const secret = 'app-secret-for-the-test'
  const raw = Buffer.from(JSON.stringify(delivery([{ sender: { id: THEM }, recipient: { id: OURS }, message: { mid: 'm', text: 'héllo' } }])))
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  assert.equal(signatureOk(raw, good, secret), true)
  assert.equal(signatureOk(raw, ` ${good} `, secret), true, 'surrounding whitespace is tolerated')
  assert.equal(signatureOk(raw, good.replace(/.$/, c => (c === '0' ? '1' : '0')), secret), false, 'one hex digit off')
  assert.equal(signatureOk(raw, good, 'another-secret'), false)
  assert.equal(signatureOk(Buffer.concat([raw, Buffer.from(' ')]), good, secret), false, 'the body is signed byte for byte')
  assert.equal(signatureOk(raw, good.slice('sha256='.length), secret), false, 'the prefix is part of the header')
  assert.equal(signatureOk(raw, undefined, secret), false)
  assert.equal(signatureOk(raw, good, ''), false, 'an unset secret never verifies')
  assert.equal(signatureOk(raw, 'sha256=' + 'a'.repeat(63), secret), false, 'a different length does not throw')
})

test('the reply window follows Meta\'s 24-hour rule, and the human-agent tag only when approved', () => {
  const t0 = Date.parse('2026-10-16T12:00:00Z')
  const thread = { lastInboundAt: new Date(t0).toISOString() }
  const h = 3600 * 1000
  assert.equal(replyWindow(thread, { now: t0 + 1 * h, humanAgent: false }).mode, 'standard')
  assert.equal(replyWindow(thread, { now: t0 + 23.9 * h, humanAgent: false }).open, true)
  assert.equal(replyWindow(thread, { now: t0 + 1 * h, humanAgent: false }).closesAt, new Date(t0 + 24 * h).toISOString())

  const closed = replyWindow(thread, { now: t0 + 25 * h, humanAgent: false })
  assert.equal(closed.open, false)
  assert.equal(closed.mode, 'closed')
  assert.match(closed.reason, /24 hours/)

  const human = replyWindow(thread, { now: t0 + 25 * h, humanAgent: true })
  assert.equal(human.open, true)
  assert.equal(human.mode, 'human_agent')
  assert.equal(human.closesAt, new Date(t0 + 7 * 24 * h).toISOString())
  assert.equal(replyWindow(thread, { now: t0 + 8 * 24 * h, humanAgent: true }).open, false)

  const never = replyWindow({ lastInboundAt: null }, { now: t0 })
  assert.equal(never.open, false)
  assert.equal(never.mode, 'none')
})

test('a long reply is cut into DMs Meta accepts, at paragraph boundaries first', () => {
  const bytes = s => Buffer.byteLength(s, 'utf8')
  assert.deepEqual(splitForInstagram(''), [])
  assert.deepEqual(splitForInstagram('  short  '), ['short'])
  assert.deepEqual(splitForInstagram('one\r\ntwo'), ['one\ntwo'])

  const para = 'A paragraph of about sixty bytes, repeated to pass the limit. '.repeat(6).trim()
  const pieces = splitForInstagram(`${para}\n\n${para}\n\n${para}`)
  assert.equal(pieces.length, 2, 'two paragraphs fit in one DM, the third needs another')
  for (const p of pieces) assert.ok(bytes(p) <= MAX_MESSAGE_BYTES, `${bytes(p)} bytes`)
  assert.equal(pieces.join('\n\n'), `${para}\n\n${para}\n\n${para}`, 'nothing is lost or reordered')

  // Multi-byte text is measured in bytes, not characters.
  const emoji = '🏃'.repeat(300) // 1200 bytes
  const e = splitForInstagram(emoji)
  assert.ok(e.length >= 2)
  for (const p of e) assert.ok(bytes(p) <= MAX_MESSAGE_BYTES)
  assert.equal(e.join(''), emoji)

  // One unbroken word longer than the limit is cut by characters rather than refused.
  const word = 'x'.repeat(2500)
  assert.equal(splitForInstagram(word).join(''), word)
})

test('only the connected account\'s entries are read', () => {
  const ev = [{ sender: { id: THEM }, recipient: { id: OURS }, message: { mid: 'm1', text: 'hi' } }]
  assert.equal(parseWebhook(delivery(ev), { accountIds: new Set([OURS]) }).length, 1)
  assert.equal(parseWebhook(delivery(ev, '17841499999999999'), { accountIds: new Set([OURS]) }).length, 0)
  assert.equal(parseWebhook(delivery(ev), { accountIds: new Set() }).length, 0)
})
