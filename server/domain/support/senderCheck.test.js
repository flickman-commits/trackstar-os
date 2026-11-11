import '../../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { senderCheck } from './mailbox.js'

const ar = value => [{ name: 'Authentication-Results', value }]

test('mail that passed DMARC is the sender it says', () => {
  assert.equal(senderCheck(ar('mx.google.com; dkim=pass header.i=@gmail.com; spf=pass; dmarc=pass (p=NONE) header.from=gmail.com'), 'jo@gmail.com'), 'pass')
})

test('DKIM signed by the From domain counts when there is no DMARC verdict', () => {
  assert.equal(senderCheck(ar('mx.google.com; dkim=pass header.i=@smallrace.org header.s=k1; spf=neutral'), 'rd@smallrace.org'), 'pass')
  assert.equal(senderCheck(ar('mx.google.com; dkim=pass header.i=@mailer.example; spf=pass'), 'rd@smallrace.org'), 'none')
})

test('a failed check, or none at all, is not proof', () => {
  assert.equal(senderCheck(ar('mx.google.com; dkim=none; spf=softfail; dmarc=fail (p=QUARANTINE) header.from=gmail.com'), 'victim@gmail.com'), 'fail')
  assert.equal(senderCheck([], 'jo@gmail.com'), 'none')
  // Only Google's own verdict counts, not one an earlier hop wrote.
  assert.equal(senderCheck(ar('evil.example; dmarc=pass'), 'jo@gmail.com'), 'none')
})
