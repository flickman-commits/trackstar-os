import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTimeline } from './timeline.js'

test('a custom order reads start to finish, oldest first, with who did what', () => {
  const ev = buildTimeline({
    order: { orderPlacedAt: '2026-10-16T14:00:00Z', createdAt: '2026-10-16T14:05:00Z', designCompletedAt: '2026-11-23T19:00:00Z' },
    audits: [
      { action: 'order.assign', summary: 'Assigned 4947-2 to Dan', createdAt: '2026-10-17T10:00:00Z', user: { firstName: 'Matt' } },
      { action: 'proof.send', detail: { proofs: 3 }, createdAt: '2026-11-07T17:00:00Z', user: { firstName: 'Dan' } },
      { action: 'proof.send', detail: { proofs: 3 }, createdAt: '2026-11-09T17:00:00Z', user: { firstName: 'Dan' } },
      { action: 'proof.send', detail: { proofs: 1 }, createdAt: '2026-11-22T10:06:00Z', user: { firstName: 'Dan' } },
      { action: 'order.final-pdf', createdAt: '2026-11-23T14:14:00Z', user: { firstName: 'Dan' } },
    ],
    proofs: [
      { version: 1, batch: 1, status: 'rejected', createdAt: '2026-11-07T16:00:00Z', updatedAt: '2026-11-10T03:00:00Z' },
      { version: 2, batch: 1, status: 'revision_requested', customerFeedback: 'Darker street', createdAt: '2026-11-07T16:01:00Z', updatedAt: '2026-11-10T03:12:00Z' },
      { version: 4, batch: 2, status: 'approved', customerFeedback: null, createdAt: '2026-11-22T10:00:00Z', updatedAt: '2026-11-22T20:00:00Z' },
    ],
    finals: [{ createdAt: '2026-11-23T14:14:00Z', arteloSentAt: '2026-11-23T19:00:00Z', requester: { firstName: 'Dan' } }],
    tracking: [{ shippedAt: '2026-11-26T12:00:00Z', company: 'USPS', url: 'https://t.example/1', deliveredAt: null }],
  })
  assert.deepEqual(ev.map(e => e.label), [
    'Ordered',
    'Assigned to Dan',
    'Round 1: 2 proofs made',
    'Emailed round 1 to the customer',
    'Emailed the proofs again',
    'Customer asked for changes on v2',
    'Round 2: 1 proof made',
    'Emailed round 2 to the customer',
    'Customer approved v4',
    'Final PDF uploaded',
    'Sent to Artelo production',
    'Shipped, USPS',
  ])
  assert.equal(ev.find(e => e.label.startsWith('Customer asked')).quote, 'Darker street')
  assert.equal(ev.find(e => e.label === 'Final PDF uploaded').by, 'Dan')
  // The final PDF is listed once: the audit log has it, so the render job does not add it again.
  assert.equal(ev.filter(e => e.label === 'Final PDF uploaded').length, 1)
})

test('an order sent by hand, before the audit log, still says when it went', () => {
  const ev = buildTimeline({ order: { createdAt: '2026-01-02T00:00:00Z', designCompletedAt: '2026-01-20T00:00:00Z', designCompletedBy: { firstName: 'Matt' } }, finals: [{ createdAt: '2026-01-19T00:00:00Z', requester: { firstName: 'Dan' } }] })
  assert.deepEqual(ev.map(e => e.label), ['Ordered', 'Final PDF uploaded', 'Marked sent to production'])
})
