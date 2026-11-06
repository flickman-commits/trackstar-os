import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateImageBytes, photoDpiAt, MIN_SHORT_EDGE } from './imageValidation.js'
import { photoRejectDetail } from './photoRejects.js'

/** The leading bytes of a PNG of the given size: enough for the header read. */
function png(w, h) {
  const b = Buffer.alloc(32)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12)
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}

test('the floor is 500px on the short side', () => {
  assert.equal(MIN_SHORT_EDGE, 500)
  // A 1080px race-app photo, refused under the old 1200px rule.
  assert.equal(validateImageBytes(png(1080, 1620), 'image/png').ok, true)
  assert.equal(validateImageBytes(png(500, 500), 'image/png').ok, true)
  const small = validateImageBytes(png(499, 900), 'image/png')
  assert.equal(small.ok, false)
  assert.equal(small.reason, 'too_small')
  assert.doesNotMatch(small.message, /px|—|–/)
})

test('photoDpiAt reads the poster size and uses 10% of the long side', () => {
  assert.equal(photoDpiAt(500, '16x24'), 208)
  assert.equal(photoDpiAt(500, '8 x 10'), 500)
  assert.equal(photoDpiAt(720, '24" x 36"'), 200)
  assert.equal(photoDpiAt(500, 'Large'), null)
})

test('reject records keep only known fields and values', () => {
  const d = photoRejectDetail({ reason: 'too_small', source: 'wizard', width: '900', height: 1600, race: 'NYC\nMarathon', evil: 1 })
  assert.deepEqual(d, { reason: 'too_small', source: 'wizard', width: 900, height: 1600, bytes: null, type: null, race: 'NYCMarathon', device: null })
  assert.equal(photoRejectDetail({ reason: 'drop table', source: 'x' }).reason, 'other')
})
