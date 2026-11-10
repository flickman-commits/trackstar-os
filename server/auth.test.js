// api/_lib/auth.js, tested here so npm test (server/**) runs it and nothing extra sits in api/.
import './services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SESSION_SECRET = 'test-session-secret'
const { createSessionToken, readSessionToken, isCronRequest, requireAdmin, safeEqual } = await import('../api/_lib/auth.js')

const user = { id: 'u1', email: 'a@example.com', role: 'admin', sessionVersion: 2 }

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, setHeader() {} }
}

test('a session token reads back as the person it names', () => {
  const actor = readSessionToken(createSessionToken(user))
  assert.equal(actor.id, 'u1')
  assert.equal(actor.role, 'admin')
})

test('a tampered or expired token is refused', () => {
  const token = createSessionToken(user)
  const [payload, mac] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)]
  assert.equal(readSessionToken(`${payload.replace('admin', 'owner')}.${mac}`), null)
  assert.equal(readSessionToken(`${payload}.${'0'.repeat(mac.length)}`), null)
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 31 * 24 * 60 * 60 * 1000
    assert.equal(readSessionToken(token), null)
  } finally { Date.now = realNow }
})

test('with no SESSION_SECRET no session verifies and none is signed, and ADMIN_SECRET is not used instead', () => {
  const token = createSessionToken(user)
  const before = process.env.SESSION_SECRET
  try {
    delete process.env.SESSION_SECRET
    process.env.ADMIN_SECRET = 'leaked-value'
    assert.equal(readSessionToken(token), null)
    assert.throws(() => createSessionToken(user), /SESSION_SECRET/)
  } finally {
    process.env.SESSION_SECRET = before
    delete process.env.ADMIN_SECRET
  }
})

test('the old x-admin-secret header no longer lets anyone in', async () => {
  process.env.ADMIN_SECRET = 'leaked-value'
  try {
    const res = fakeRes()
    const actor = await requireAdmin({ method: 'GET', headers: { 'x-admin-secret': 'leaked-value' } }, res)
    assert.equal(actor, false)
    assert.equal(res.statusCode, 401)
  } finally { delete process.env.ADMIN_SECRET }
})

test('a cron request needs CRON_SECRET set and matched', () => {
  const before = process.env.CRON_SECRET
  try {
    delete process.env.CRON_SECRET
    assert.equal(isCronRequest({ url: '/api/cron/x', headers: { authorization: 'Bearer undefined' } }), false)
    process.env.CRON_SECRET = 'cron-secret'
    assert.equal(isCronRequest({ url: '/api/cron/x', headers: { authorization: 'Bearer nope' } }), false)
    assert.equal(isCronRequest({ url: '/api/cron/x', headers: { authorization: 'Bearer cron-secret' } }), true)
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = before
  }
})

test('safeEqual compares without throwing on different lengths', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abcd'), false)
})
