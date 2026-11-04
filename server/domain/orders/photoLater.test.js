import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awaitingLaterPhoto, photoLaterDue, photoLaterDeadline, DEADLINE_AFTER_MS } from './photoLaterState.js'
import { pipelineFor } from './pipeline.js'

const DAY = 24 * 60 * 60 * 1000
const race = new Date('2026-11-01T12:00:00Z')
const waiting = { photoLater: true, photoPath: null, photoLaterClosedAt: null, status: 'pending' }

test('a print waits for its photo only while it has none and nothing closed it', () => {
  assert.equal(awaitingLaterPhoto(waiting), true)
  assert.equal(awaitingLaterPhoto({ ...waiting, photoPath: '2026-11-02/x.jpg' }), false)
  assert.equal(awaitingLaterPhoto({ ...waiting, photoLaterClosedAt: new Date() }), false)
  assert.equal(awaitingLaterPhoto({ ...waiting, photoLater: false }), false)
})

test('the upload link goes out a day after race day, never before, and never without a race day', () => {
  assert.equal(photoLaterDue(waiting, race, race.getTime() + 23 * 60 * 60 * 1000), null)
  assert.equal(photoLaterDue(waiting, race, race.getTime() + DAY), 'request')
  assert.equal(photoLaterDue(waiting, null, race.getTime() + 10 * DAY), null)
})

test('one reminder after four days, then the deadline at seven', () => {
  const sent = { ...waiting, photoLaterEmailedAt: new Date(race.getTime() + DAY) }
  const t0 = sent.photoLaterEmailedAt.getTime()
  assert.equal(photoLaterDue(sent, race, t0 + 3 * DAY), null)
  assert.equal(photoLaterDue(sent, race, t0 + 4 * DAY), 'remind')
  assert.equal(photoLaterDue({ ...sent, photoLaterRemindedAt: new Date(t0 + 4 * DAY) }, race, t0 + 5 * DAY), null)
  assert.equal(photoLaterDue({ ...sent, photoLaterRemindedAt: new Date(t0 + 4 * DAY) }, race, t0 + 7 * DAY), 'deadline')
  // A missed reminder does not hold up the deadline.
  assert.equal(photoLaterDue(sent, race, t0 + 8 * DAY), 'deadline')
  assert.equal(photoLaterDeadline(sent).getTime(), t0 + DEADLINE_AFTER_MS)
})

test('nothing is owed once the photo is in, it closed, or the order is complete', () => {
  const late = race.getTime() + 30 * DAY
  assert.equal(photoLaterDue({ ...waiting, photoPath: 'p.jpg' }, race, late), null)
  assert.equal(photoLaterDue({ ...waiting, photoLaterClosedAt: new Date() }, race, late), null)
  assert.equal(photoLaterDue({ ...waiting, status: 'completed' }, race, late), null)
})

test('the pipeline holds a ready print as Waiting on photo, and lets it go once the photo is in', () => {
  const order = { ...waiting, raceName: 'Test Marathon', raceYear: 2026, productSize: '12x18', hadNoTime: false, trackstarOrderType: 'standard' }
  const research = { researchStatus: 'found', bibNumber: '123', officialTime: '3:30:00', officialPace: '8:00', eventType: 'Marathon' }
  const raceRow = { raceDate: race, raceDateSource: 'manual', raceDateVerifiedAt: race, raceDateSourceUrl: 'https://example.com', location: 'Test City', weatherCondition: 'Sunny', weatherTemp: 50, weatherConfirmedAt: race }
  const args = { research, race: raceRow, render: null, hasScraper: true, templates: new Set(['Test Marathon']), noTimeGaps: new Set(), photoUnpaid: false, workerOnline: true }
  const held = pipelineFor({ ...args, order })
  assert.equal(held.stage, 'waiting')
  assert.equal(held.reason, 'Waiting on photo')
  assert.equal(pipelineFor({ ...args, order: { ...order, photoPath: 'p.jpg' } }).reason, 'Render queued')
  assert.equal(pipelineFor({ ...args, order: { ...order, photoLaterClosedAt: new Date() } }).reason, 'Render queued')
})

test('customer emails: the link for every print, the deadline, and no dashes anywhere', async () => {
  process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test'
  const { compose } = await import('./photoLater.js')
  const row = (name, token) => ({ id: name, runnerName: name, customerName: 'Jane', parentOrderNumber: '555', shopifyOrderData: { name: '#7001' }, photoLaterToken: token })
  const deadline = new Date('2026-11-12T15:00:00Z')
  const one = compose('request', [row('Matt Hickman', 'tok1')], { deadline })
  assert.match(one.subject, /Matt Hickman's poster \| Trackstar Order #7001$/)
  assert.match(one.html, /\/photo\/tok1/)
  assert.match(one.text, /November 12/)
  const two = compose('request', [row('Matt Hickman', 'a'), row('Sue Hickman', 'b')], { deadline })
  assert.match(two.html, /\/photo\/a/)
  assert.match(two.html, /\/photo\/b/)
  assert.match(two.text, /the photos\./)
  const emails = [one, two, compose('remind', [row('Matt Hickman', 'tok1')], { deadline }), compose('closed', [row('Matt Hickman', 'x')], { refund: 'refunded' }), compose('closed', [row('Matt Hickman', 'x')], { refund: 'failed: x' })]
  for (const e of emails) assert.doesNotMatch(`${e.subject}\n${e.text}`, /[–—]/)
})
