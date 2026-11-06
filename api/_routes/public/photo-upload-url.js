/**
 * Public, unauthenticated: mint a one-shot signed upload URL for a
 * personalization photo.
 *
 *   POST /api/public/photo-upload-url
 *   body: { filename, contentType, size, width, height }
 *   -> { path, uploadUrl, token, maxBytes }
 *
 * WHY A SIGNED URL INSTEAD OF PROXYING THE BYTES
 *   Vercel caps a serverless request body at ~4.5MB. Photos straight off a
 *   phone are routinely 3-12MB, so proxying uploads through this function
 *   would fail for a large share of real customers. Instead we hand the
 *   browser a short-lived signed URL and it PUTs directly to Supabase
 *   Storage. This function only ever sees metadata.
 *
 * PRIVACY
 *   The bucket is PRIVATE. These are customers' personal photos, and a
 *   guessable public URL is a privacy problem we cannot walk back once the
 *   links are in the wild. The cart property stores the storage PATH, not a
 *   URL; the dashboard mints a short-lived signed URL when a designer opens
 *   the order. See api/_routes/admin/photo-signed-url.js.
 *
 * PRINT QUALITY
 *   Resolution is validated CLIENT-side (we cannot measure pixels without the
 *   bytes). The width/height reported here are recorded for support triage
 *   only — never trust them as a gate, since a caller can send anything.
 *
 * SAFETY
 *   Rate-limited per IP with the same limiter the results lookup uses, so a
 *   bored visitor cannot fill the bucket. Gated behind PHOTO_UPLOAD_ENABLED
 *   so it stays dark until we turn it on.
 */
import { setCors } from '../../_lib/auth.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'
import { storage } from '../../../server/lib/storage.js'

const BUCKET = 'personalization-photos'

/** 25MB. Comfortably fits a modern phone photo; rejects video-sized mistakes. */
const MAX_BYTES = 25 * 1024 * 1024

/**
 * HEIC is deliberately EXCLUDED, despite iPhones shooting it by default.
 *
 * sharp cannot decode it in this deployment: a real iPhone HEIC fails with
 * "Support for this compression format has not been built in", because the
 * prebuilt binaries omit the HEVC codec for patent reasons. sharp.format
 * reports heif input/output support, which is misleading — that only says the
 * format is compiled in, not that a codec plugin exists. Accepting HEIC here
 * would mean taking the upload and then purging it during verification, which
 * is a worse dead end than not offering it.
 *
 * The storefront's file input omits HEIC too, and iOS transcodes to JPEG when
 * the picker is not offered HEIC. So iPhone customers still get through; they
 * just arrive as JPEG.
 */
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * Storage path. Random per upload so paths are unguessable and two customers
 * uploading "IMG_1234.jpg" can never collide. Date prefix makes the retention
 * sweep a cheap prefix listing rather than a full-bucket scan.
 */
function buildPath(ext) {
  const now = new Date()
  const day = now.toISOString().slice(0, 10) // YYYY-MM-DD
  return `${day}/${crypto.randomUUID()}.${ext}`
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS', allowPublic: true })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Dark by default — same posture as the public results lookup.
  if (process.env.PHOTO_UPLOAD_ENABLED !== 'true') {
    return res.status(503).json({ error: 'unavailable', message: 'Photo upload is not enabled.' })
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('[photo-upload-url] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return res.status(500).json({ error: 'server_misconfigured' })
  }

  // Durable (DB-backed) on purpose: the in-memory limiter is per-instance, so
  // on Vercel it can be walked straight past. Minting upload URLs costs us
  // storage, so this one has to actually hold.
  const ip = clientIp(req)
  const limit = await checkRateLimitDurable(ip, { bucket: 'photo_upload', max: 20 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'rate_limited', retryAfterMs: limit.retryAfterMs })
  }

  const { contentType, size, width, height, filename } = req.body || {}

  const ext = ALLOWED_TYPES[String(contentType || '').toLowerCase()]
  if (!ext) {
    return res.status(400).json({
      error: 'unsupported_type',
      message: 'Please upload a JPG or PNG image.',
    })
  }

  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return res.status(400).json({ error: 'bad_request', message: 'Missing file size.' })
  }
  // No file-size FLOOR. Byte count is a poor proxy for print quality: a sharp,
  // high-resolution phone photo (including iOS's HEIC->JPEG transcode) often
  // lands under 1MB and was being wrongly rejected. Print sharpness is gated by
  // resolution against real pixels in photo-verify; only the max stays here to
  // reject video-sized mistakes.
  if (bytes > MAX_BYTES) {
    return res.status(413).json({
      error: 'too_large',
      maxBytes: MAX_BYTES,
      message: 'That photo is larger than 25MB. Please pick a smaller file.',
    })
  }

  const path = buildPath(ext)

  try {
    const supabase = storage()
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUploadUrl(path)

    if (error) throw error

    // Metadata only — helps support answer "why did this print look soft?"
    // without needing to open the file. Not a gate: these values are
    // client-supplied. Real enforcement happens in /api/public/photo-verify
    // against the actual bytes.
    //
    // Control characters are stripped from the filename so a crafted name
    // cannot inject newlines and forge additional log lines.
    const safeName = String(filename || '').replace(/[\r\n\t\x00-\x1f\x7f]/g, '').slice(0, 60)
    console.log(
      `[PHOTO_UPLOAD] path="${path}" type=${contentType} bytes=${bytes} ` +
      `dims=${width || '?'}x${height || '?'} name="${safeName}"`
    )

    return res.status(200).json({
      path,
      uploadUrl: data.signedUrl,
      token: data.token,
      maxBytes: MAX_BYTES,
    })
  } catch (err) {
    console.error('[photo-upload-url] Failed to mint signed URL:', err.message)
    return res.status(500).json({ error: 'upload_unavailable' })
  }
}
