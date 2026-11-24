import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickClaim, TICKET_KINDS } from './damageClaim.js'

const a = (kind, id) => ({ detail: { kind, claimThreadId: id } })

test('more photos go on the newest claim, not an address change or an earlier batch of photos', () => {
  assert.equal(pickClaim([a('photos', 'p'), a('address', 'x'), a('wrong', 'w'), a('damaged', 'd')]).detail.claimThreadId, 'w')
  assert.equal(pickClaim([a('other', 'o'), a('damaged', 'd')]).detail.claimThreadId, 'd')
  assert.equal(pickClaim([a('other', 'o')]).detail.claimThreadId, 'o')
  assert.equal(pickClaim([a(undefined, 'old')]).detail.claimThreadId, 'old')
  assert.equal(pickClaim([a('address', 'x'), a('photos', 'p')]), null)
  assert.equal(pickClaim([a('damaged', null)]), null)
  assert.equal(pickClaim([]), null)
})

test('more photos answers the ticket we sent, and says so when there is none', () => {
  const k = TICKET_KINDS.find(x => x.value === 'photos')
  const f = { ids: '9545 (758)', ref: 'Order 9545 (Artelo order 758)' }
  assert.equal(k.subject({ ...f, claim: { subject: 'Damaged in shipping: order 9545 (758)' } }), 'Re: Damaged in shipping: order 9545 (758)')
  assert.equal(k.subject({ ...f, claim: null }), 'Photos for an existing claim: order 9545 (758)')
  assert.match(k.body(f).join('\n'), /not a new claim/)
})
