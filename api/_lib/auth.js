/**
 * Shared auth + CORS helpers for API endpoints.
 *
 * Auth: Merchant endpoints require either a valid `ts_session` cookie (set by
 *   the browser login flow in api/auth/login.js) or the `x-admin-secret` header
 *   (server-to-server callers: Vercel crons, internal tooling). The session
 *   token is a stateless HMAC-signed value — no DB lookup, no client-readable
 *   secret in the bundle.
 * CORS: Locked to known origins (Vercel + localhost for dev).
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { recordCronRun } from '../../server/lib/cronJobs.js'

export const SESSION_COOKIE = 'ts_session'
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** Signing key for session tokens — dedicated secret, falls back to ADMIN_SECRET. */
function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_SECRET || ''
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex')
}

/** Constant-time string compare that won't throw on length mismatch. */
export function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a))
  const bBuf = Buffer.from(String(b))
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

/**
 * Create a signed session token identifying WHO is signed in:
 *   "<userId>|<email>|<role>|<expiryEpochMs>.<hmac>"
 *
 * Identity rides inside the signed payload so an ordinary request still needs
 * no database lookup. The cost is that the token is briefly stale if someone
 * is demoted or deactivated mid-session; destructive endpoints therefore
 * re-check against the database via requireAdminRole rather than trusting it.
 *
 * Tokens issued by the old shared-password scheme carried only an expiry and
 * no longer verify. That is deliberate: everyone re-authenticates once as
 * their own account instead of inheriting an anonymous session.
 */
export function createSessionToken(user) {
  const expiry = Date.now() + SESSION_MAX_AGE_MS
  const payload = [user.id, user.email, user.role, String(user.sessionVersion || 0), String(expiry)].join('|')
  return `${payload}.${sign(payload)}`
}

/**
 * Verify a session token and return the actor it names, or null.
 * Signature must be valid, the token unexpired, and the payload well formed.
 */
export function readSessionToken(token) {
  if (!token || typeof token !== 'string') return null
  if (!sessionSecret()) return null
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  if (!safeEqual(mac, sign(payload))) return null

  const parts = payload.split('|')
  // Four parts is a token from before session versions: it reads as version
  // 0, so it keeps working until that person's version is first bumped.
  // Anything else is a pre-identity token; treat it as invalid.
  if (parts.length !== 4 && parts.length !== 5) return null
  const [id, email, role] = parts
  const version = parts.length === 5 ? Number(parts[3]) : 0
  const expiry = Number(parts[parts.length - 1])
  if (!Number.isFinite(expiry) || Date.now() >= expiry) return null
  if (!Number.isInteger(version)) return null
  if (!id || !email) return null
  return { id, email, role: role || 'staff', version }
}

// ---------------------------------------------------------------------------
// Live session state
// ---------------------------------------------------------------------------

/**
 * Whether a signed token still names a live session, and the person's
 * current role. The signature only proves we issued it; this is what makes
 * signing someone out, deactivating them or changing their password actually
 * end their sessions.
 *
 * Cached per instance for a minute, so an ordinary request costs nothing and
 * a cold one costs one indexed read. A bump therefore takes up to a minute to
 * reach every warm instance; the instance that bumped it forgets at once.
 */
const SESSION_CACHE_MS = 60_000
const sessionCache = new Map()

async function sessionState(userId) {
  const hit = sessionCache.get(userId)
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.value
  const value = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, sessionVersion: true },
  })
  sessionCache.set(userId, { at: Date.now(), value })
  if (sessionCache.size > 500) sessionCache.delete(sessionCache.keys().next().value)
  return value
}

/** The live actor behind a session token, or null when it no longer counts. */
export async function liveSession(token) {
  const claimed = readSessionToken(token)
  if (!claimed) return null
  const state = await sessionState(claimed.id)
  if (!state || !state.isActive || state.sessionVersion !== claimed.version) return null
  return { id: claimed.id, email: claimed.email, role: state.role, version: claimed.version }
}

/**
 * End every session this person has, on every device. Returns the new
 * version so the caller can re-issue a cookie for the session it wants to keep.
 */
export async function bumpSessionVersion(userId) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  })
  sessionCache.delete(userId)
  return user.sessionVersion
}

/** Back-compat boolean form, for callers that only need yes/no. */
export function verifySessionToken(token) {
  return readSessionToken(token) !== null
}

/** Parse a request's Cookie header into a plain object. */
export function parseCookies(req) {
  const header = req.headers?.cookie
  if (!header) return {}
  return header.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=')
    if (idx < 0) return acc
    const key = pair.slice(0, idx).trim()
    const val = pair.slice(idx + 1).trim()
    if (key) acc[key] = decodeURIComponent(val)
    return acc
  }, {})
}

/**
 * Build a Set-Cookie string for the session. `clear` issues an expired cookie
 * (logout). `Secure` is omitted on plain-http localhost so local dev works.
 */
export function buildSessionCookie(req, { clear = false, token = '' } = {}) {
  const proto = req.headers['x-forwarded-proto'] || ''
  const host = req.headers['x-forwarded-host'] || req.headers.host || ''
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  const secure = !isLocal && proto !== 'http'

  const value = clear ? '' : token
  const maxAge = clear ? 0 : Math.floor(SESSION_MAX_AGE_MS / 1000)
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

const ALLOWED_ORIGINS = [
  'https://fast.trackstar.art',
  'https://trackstar-fulfillment.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
]

/**
 * Set CORS headers. Returns true if this was a preflight OPTIONS request (caller should return).
 */
export function setCors(req, res, { methods = 'GET, POST, OPTIONS', allowPublic = false } = {}) {
  const origin = req.headers.origin || ''

  // For public endpoints (customer approval portal), allow any origin
  if (allowPublic) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  } else {
    // Match against allowed origins, plus this project's own Vercel preview
    // URLs. Not any *.vercel.app: anyone can deploy there.
    const isAllowed = ALLOWED_ORIGINS.includes(origin)
      || /^https:\/\/trackstar-fulfillment(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)
    res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : ALLOWED_ORIGINS[0])
  }

  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret, Cookie')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return true
  }

  return false
}

/**
 * Authorize a request. Returns true if authorized, sends 401/500 and returns
 * false otherwise. Accepts either:
 *   1. a valid `ts_session` cookie (browser users), or
 *   2. the `x-admin-secret` header matching ADMIN_SECRET (server-to-server).
 */
/**
 * Require an authenticated caller and return WHO they are.
 *
 * Async: it re-checks the session against the database (cached). Every call
 * site must await it; a forgotten await yields a Promise, which is truthy, so
 * scripts/check-auth-await.js fails the build on any bare call.
 *
 *   const actor = await requireAdmin(req, res)
 *   if (!actor) return
 *
 * The name is a misnomer - it means "authenticated", not "admin". The role it
 * returns is current, but enforcing it is the caller's job: requireAdminRole
 * and requireCapability in _lib/users.js.
 */
export async function requireAdmin(req, res) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) {
    console.error('[auth] ADMIN_SECRET not configured - blocking request')
    res.status(500).json({ error: 'Server misconfigured' })
    return false
  }

  // Browser path: signed session cookie naming a user, checked against the
  // database (cached for a minute) so a signed-out, deactivated or
  // password-changed session stops working.
  const cookies = parseCookies(req)
  if (cookies[SESSION_COOKIE]) {
    const actor = await liveSession(cookies[SESSION_COOKIE])
    if (actor) return actor
  }

  // Server-to-server path: shared admin secret header (constant-time compare).
  // It has no user row and acts as "system". It is deliberately NOT an admin:
  // loadActiveUser refuses it, so it reaches only endpoints that need nothing
  // more than a signed-in caller, never a role-gated or destructive one.
  const provided = req.headers['x-admin-secret']
  if (provided && safeEqual(provided, secret)) {
    return { id: null, email: 'system', name: 'System', role: 'system', isSystem: true }
  }

  res.status(401).json({ error: 'Unauthorized' })
  return false
}

/**
 * Is this request from the scheduler? Vercel cron today, an in-process
 * scheduler on a self-hosted server later. Crons present
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Fails closed: an unset CRON_SECRET means NO request is a cron request. The
 * inline checks this replaces compared against the template string
 * `Bearer ${process.env.CRON_SECRET}`, which an unset variable turned into the
 * literal "Bearer undefined" - a password anyone could type. Constant-time
 * compare, like every other secret in this file.
 */
export function isCronRequest(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers?.['authorization'] || ''
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const ok = safeEqual(header.slice('Bearer '.length), secret)
  // Stamp the run for Settings > Scheduled Jobs. Not awaited: the job's own
  // work outlasts this one write, and a failed stamp never stops the job.
  if (ok) recordCronRun(req.url)
  return ok
}
