import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMime } from './gmail.js'

const decode = raw => raw.split('\r\n\r\n').slice(1).join('\r\n\r\n')

test('html only, no attachments: a single text/html body, as before', () => {
  const raw = buildMime({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hello</p>' })
  assert.match(raw, /^To: jane@example.com\r\n/)
  assert.match(raw, /Content-Type: text\/html; charset=utf-8/)
  assert.doesNotMatch(raw, /multipart/)
})

test('html with text, no attachments: multipart/alternative with the text part first', () => {
  const raw = buildMime({ to: 'jane@example.com', subject: 'Your design is ready', html: '<p>Hello <b>Jane</b></p>', text: 'Hello Jane' })
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="ts_[0-9a-f]+"/)
  const body = decode(raw)
  const textAt = body.indexOf('Content-Type: text/plain; charset=utf-8')
  const htmlAt = body.indexOf('Content-Type: text/html; charset=utf-8')
  assert.ok(textAt > -1 && htmlAt > textAt, 'text/plain comes before text/html')
  assert.ok(body.includes(Buffer.from('Hello Jane', 'utf8').toString('base64')), 'the text part carries the plain text')
  assert.match(body, /--ts_[0-9a-f]+--\r\n$/)
})

test('html with text and a file: the alternative sits inside multipart/mixed', () => {
  const raw = buildMime({ to: 'jane@example.com', subject: 'Proof', html: '<p>See attached</p>', text: 'See attached', attachments: [{ bytes: Buffer.from('%PDF-1.4'), contentType: 'application/pdf', filename: 'proof.pdf' }] })
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="ts_[0-9a-f]+"/)
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="ts_[0-9a-f]+"/)
  assert.match(raw, /Content-Disposition: attachment; filename="proof.pdf"/)
})
