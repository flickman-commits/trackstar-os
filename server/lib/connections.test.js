import '../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONNECTIONS, ConnectionOffError, requireConnection, forcedOff, isConnectionOn, setConnectionOn } from './connections.js'
import { publicError } from './publicError.js'

test('every connection has a label and a plain description', () => {
  const ids = CONNECTIONS.map(c => c.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const c of CONNECTIONS) assert.ok(c.label && c.what, c.id)
})

test('a switched-off service reads as a sentence a person can act on', () => {
  const err = new ConnectionOffError('shopify')
  assert.equal(err.message, 'Shopify is switched off in Settings > Connections.')
  assert.deepEqual(publicError(err), { status: 503, body: { error: err.message } })
})

test('anything else stays generic', () => {
  const out = publicError(new Error('relation "Order" does not exist'))
  assert.equal(out.status, 500)
  assert.doesNotMatch(out.body.error, /relation/)
})

test('an unknown service is a programming error, not a quiet pass', async () => {
  await assert.rejects(requireConnection('nope'), /Unknown connection/)
})

test('CONNECTIONS_FORCE_OFF lists ids, "all" means every one, and unknown words are dropped', () => {
  assert.deepEqual([...forcedOff('artelo, resend')].sort(), ['artelo', 'resend'])
  assert.equal(forcedOff('all').size, CONNECTIONS.length)
  assert.deepEqual([...forcedOff('artelo,nope')], ['artelo'])
  assert.equal(forcedOff('').size, 0)
  assert.equal(forcedOff(undefined).size, 0)
})

test('a service forced off by this process is off whatever the shared switch says, and on again once cleared', async () => {
  const before = process.env.CONNECTIONS_FORCE_OFF
  try {
    process.env.CONNECTIONS_FORCE_OFF = 'artelo'
    assert.equal(await isConnectionOn('artelo'), false)
    assert.equal(await isConnectionOn('resend'), true)
    await assert.rejects(requireConnection('artelo'), err => err instanceof ConnectionOffError && err.forced === true && /CONNECTIONS_FORCE_OFF/.test(err.message))
    delete process.env.CONNECTIONS_FORCE_OFF
    assert.equal(await isConnectionOn('artelo'), true)
  } finally {
    if (before === undefined) delete process.env.CONNECTIONS_FORCE_OFF
    else process.env.CONNECTIONS_FORCE_OFF = before
  }
})

test('a forced-off service cannot be switched from this process, so a laptop never writes the shared row', async () => {
  const before = process.env.CONNECTIONS_FORCE_OFF
  try {
    process.env.CONNECTIONS_FORCE_OFF = 'slack'
    await assert.rejects(setConnectionOn('slack', true), err => err.status === 409 && err.expose === true)
  } finally {
    if (before === undefined) delete process.env.CONNECTIONS_FORCE_OFF
    else process.env.CONNECTIONS_FORCE_OFF = before
  }
})
