import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asksCustomer, threadWaiting } from './compose.js'

test('a question or a request counts; thanks, review asks and links do not', () => {
  assert.equal(asksCustomer('Which race (and year) would you like instead?\n\nThanks, Matt'), true)
  assert.equal(asksCustomer('Just let us know which option works best for you, and we will take care of it!'), true)
  assert.equal(asksCustomer('Please send us her bib number from the race.'), true)
  assert.equal(asksCustomer('Done! Order #8552 will now ship to Ed. Stoked for Ed to get his print!'), false)
  assert.equal(asksCustomer('So glad you love it!! Would you mind leaving us a review? https://yotpo.com/go/x?y=1'), false)
  assert.equal(asksCustomer('Your print ships next week. Let us know if you have any questions!'), false)
  assert.equal(asksCustomer('All set!\n\nOn Mon, Nov 3, 2026 at 9:00 AM Kim <k@x.com> wrote:\n> Can you change it?'), false)
})

const at = d => new Date(Date.UTC(2026, 10, d, 12))
const now = at(9)
const base = { status: 'closed', lastInboundAt: at(1), lastOutboundAt: at(2), snoozedUntil: null, bouncedAt: null, notWaitingAt: null }

test('a closed conversation whose last email asked something keeps the order waiting', () => {
  assert.equal(threadWaiting(base, 'Do you have a better photo?', now), true)
  assert.equal(threadWaiting({ ...base, status: 'escalated' }, 'Which runner is yours?', now), true)
})

test('not when they replied, it bounced, it was marked not waiting, or it is old', () => {
  assert.equal(threadWaiting({ ...base, lastInboundAt: at(3) }, 'Better photo?', now), false)
  assert.equal(threadWaiting({ ...base, bouncedAt: at(3) }, 'Better photo?', now), false)
  assert.equal(threadWaiting({ ...base, notWaitingAt: at(3) }, 'Better photo?', now), false)
  assert.equal(threadWaiting({ ...base, lastOutboundAt: new Date('2026-09-01') , lastInboundAt: null }, 'Better photo?', now), false)
})

test('a later email from us undoes Not waiting; status waiting and a snooze still count', () => {
  assert.equal(threadWaiting({ ...base, notWaitingAt: at(2), lastOutboundAt: at(4) }, 'One more thing: which frame?', now), true)
  assert.equal(threadWaiting({ ...base, status: 'waiting' }, 'Thanks!', now), true)
  assert.equal(threadWaiting({ ...base, status: 'open', snoozedUntil: at(10) }, 'Thanks!', now), true)
  assert.equal(threadWaiting({ ...base, status: 'open' }, 'Thanks!', now), false)
})
