/**
 * /api/support/instagram-webhook - where Meta delivers Instagram DMs.
 *
 *   GET   hub.mode=subscribe&hub.verify_token=&hub.challenge=   Meta checking the URL once; answers the challenge
 *   POST  { object: "instagram", entry: [...] }                  a DM, an echo, a read, a reaction
 *
 * No session here: Meta is the caller. Every POST is checked against the
 * app secret with X-Hub-Signature-256 over the raw body, in constant time,
 * before anything is parsed. Meta retries a delivery it does not get a 200
 * for within seconds, so the handler stores what it can and always answers
 * 200 once the signature is good; a message that will not import is logged,
 * not surfaced, and the backfill can pick it up.
 *
 * Nothing in a response ever carries error.message: the caller is a
 * webhook, and a stranger probing the URL learns nothing.
 */
import crypto from 'crypto'
import { safeEqual } from '../../_lib/auth.js'
import { parseWebhook, importMessage, ourIds } from '../../../server/domain/support/instagram.js'

/** Vercel must hand us the raw bytes; the signature is over them, not over re-serialised JSON. */
export const config = { api: { bodyParser: false } }

/** True when `header` is Meta's sha256 HMAC of `rawBody` under `secret`. */
export function signatureOk(rawBody, header, secret) {
  if (!secret || !header || typeof header !== 'string') return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqual(header.trim(), expected)
}

/**
 * The body as bytes. The dev server (express.json with verify) leaves them
 * on req.rawBody; Vercel, with the parser off, leaves the stream unread.
 * An already-parsed object is a last resort that only works when the
 * serialisation happens to match, which is why both runtimes avoid it.
 */
async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody
  if (typeof req.body === 'string') return Buffer.from(req.body)
  if (Buffer.isBuffer(req.body)) return req.body
  if (req.body && typeof req.body === 'object' && req.readable === false) return Buffer.from(JSON.stringify(req.body))
  const chunks = []
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const verify = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
    const mode = String(req.query?.['hub.mode'] || '')
    const token = String(req.query?.['hub.verify_token'] || '')
    const challenge = String(req.query?.['hub.challenge'] || '')
    if (mode === 'subscribe' && verify && token && challenge && safeEqual(token, verify)) {
      res.setHeader('Content-Type', 'text/plain')
      return res.status(200).send(challenge)
    }
    return res.status(403).json({ error: 'Verification failed' })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let raw
  try { raw = await readRawBody(req) } catch { return res.status(400).json({ error: 'Unreadable body' }) }
  if (!signatureOk(raw, req.headers['x-hub-signature-256'], process.env.INSTAGRAM_APP_SECRET)) {
    return res.status(401).json({ error: 'Bad signature' })
  }
  let body
  try { body = JSON.parse(raw.toString('utf8')) } catch { return res.status(400).json({ error: 'Bad JSON' }) }

  // Entries for any account other than the connected one are dropped.
  let accountIds
  try { accountIds = await ourIds() } catch (err) { console.error('[API /support/instagram-webhook] could not read the connected account', err); return res.status(200).json({ received: 0, imported: 0 }) }
  const events = parseWebhook(body, { accountIds })
  let imported = 0
  for (const ev of events) {
    try {
      if (await importMessage(ev)) imported++
    } catch (err) {
      console.error(`[API /support/instagram-webhook] ${ev.igMessageId} not imported`, err)
    }
  }
  if (events.length) console.log(`[support.instagram] webhook: ${events.length} message${events.length === 1 ? '' : 's'}, ${imported} stored`)
  return res.status(200).json({ received: events.length, imported })
}
