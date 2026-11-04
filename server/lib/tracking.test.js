import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carrierOf, alignTracking } from './tracking.js'

test('UPS numbers link to UPS even when labelled USPS', () => {
  const t = alignTracking({ number: '1Z02685D0323164955', company: 'USPS', url: 'https://tools.usps.com/go/TrackConfirmAction.action?tLabels=1Z02685D0323164955' })
  assert.equal(t.company, 'UPS')
  assert.match(t.url, /ups\.com\/track\?tracknum=1Z02685D0323164955$/)
})

test('a USPS number on a DHL link goes to USPS without the routing prefix', () => {
  const t = alignTracking({ number: '420782099261290422834300291357', company: 'USPS', url: 'https://www.dhl.com/x?tracking-id=420782099261290422834300291357' })
  assert.equal(t.company, 'USPS')
  assert.match(t.url, /tools\.usps\.com.*tLabels=9261290422834300291357$/)
})

test('a USPS number on an Amazon link goes to USPS', () => {
  assert.equal(alignTracking({ number: '9361289768770010764243', company: 'USPS', url: 'https://track.amazon.com/tracking/9361289768770010764243' }).url, 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9361289768770010764243')
})

test('Amazon and FedEx are recognised', () => {
  assert.equal(carrierOf('TBA336140107363').company, 'Amazon Logistics')
  assert.equal(carrierOf('771234567890').company, 'FedEx')
})

test('an unknown number keeps what came with it', () => {
  const t = { number: 'XYZ123', company: 'Canada Post', url: 'https://example.com/XYZ123' }
  assert.deepEqual(alignTracking(t), t)
})
