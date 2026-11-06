/**
 * GET /api/admin/photo-signed-url?path=2026-07-21/<uuid>.jpg[&ttl=900]
 *
 * Admin-only. Mints a short-lived signed URL for one personalization photo so
 * a designer can actually open it.
 *
 * WHY THIS EXISTS
 *   The bucket is PRIVATE on purpose: these are customers' personal photos and
 *   a guessable public URL is a privacy problem we cannot walk back once the
 *   links are out. The cart property stores the storage PATH, not a URL, which
 *   means nothing can read a photo without going through here. Without this
 *   endpoint an order with a photo is literally unfulfillable — the file is in
 *   the bucket and no one can see it.
 *
 * WHY SHORT TTL
 *   A signed URL is a bearer token. Anyone holding the link can open the photo
 *   until it expires, and links leak through screenshots, Slack and browser
 *   history. 15 minutes is long enough to open and download during fulfillment
 *   and short enough that a leaked link is worthless by the time it travels.
 *
 * WHY THE PATH IS VALIDATED
 *   `path` arrives from the caller. Supabase scopes signed URLs to the bucket,
 *   so this is not a filesystem traversal risk, but validating the exact shape
 *   we mint keeps this from being a general-purpose oracle for probing the
 *   bucket for other objects.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { storage } from '../../../server/lib/storage.js'

const BUCKET = 'personalization-photos'

/** Same shape photo-upload-url.js mints. Anything else is not ours. */
const PATH_RE = /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$/i

const DEFAULT_TTL_SECONDS = 15 * 60
const MAX_TTL_SECONDS = 60 * 60

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // A signed URL is a credential. Never let a cache hand it to someone else,
  // and never let it outlive its own expiry in a shared cache.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'server_misconfigured' })

  const path = String(req.query.path || '')
  if (!PATH_RE.test(path)) {
    return res.status(400).json({ error: 'bad_path', message: 'Not a personalization photo path.' })
  }

  const requested = parseInt(req.query.ttl, 10)
  const ttl = Number.isFinite(requested)
    ? Math.max(60, Math.min(MAX_TTL_SECONDS, requested))
    : DEFAULT_TTL_SECONDS

  try {
    const supabase = storage()
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttl)

    if (error || !data?.signedUrl) {
      // An orphaned cart property (photo purged, retention swept) is a normal
      // 404, not a server fault. Say so plainly so the dashboard can render
      // "photo no longer available" instead of an error state.
      console.warn(`[PHOTO_SIGNED_URL] miss path="${path}" err=${error?.message || 'no url'}`)
      return res.status(404).json({ error: 'not_found', message: 'Photo not found or no longer stored.' })
    }

    // Path, not the URL: the URL is a credential and does not belong in logs.
    console.log(`[PHOTO_SIGNED_URL] issued path="${path}" ttl=${ttl}s`)

    return res.status(200).json({
      ok: true,
      url: data.signedUrl,
      path,
      expiresInSeconds: ttl,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    })
  } catch (err) {
    console.error('[photo-signed-url] failed:', err.message)
    return res.status(500).json({ error: 'sign_failed' })
  }
}
