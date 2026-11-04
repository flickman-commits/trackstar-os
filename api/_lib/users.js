/**
 * User accounts, password hashing and role checks.
 *
 * Passwords use scrypt from node's crypto - no new dependency, and it is a
 * memory-hard KDF rather than a bare hash, so a stolen database is not a
 * stolen password list.
 *
 * Roles are four (roles.js): `admin` does the irreversible things and manages
 * people; `sales`, `fulfillment` and `designer` each see the parts of the tool
 * their work needs. A stored "staff" from before roles reads as designer.
 * What a role may do is checked against the database on every request
 * (requireCapability), so a changed role applies without signing anyone out.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { requireAdmin } from './auth.js'
import { ROLE_LABEL, normalizeRole, can } from './roles.js'
import { inBackground } from '../../server/lib/background.js'

const SEEN_EVERY_MS = 5 * 60_000
const seenAt = new Map()

/**
 * Last seen: when this person last used the app, not when they last typed a
 * password (sessions last 30 days, so that was weeks stale). Written at most
 * every five minutes per person per instance, and never in the way of the
 * request it rides on.
 *
 * One plain UPDATE (autocommit, no transaction) kept alive with waitUntil.
 * It used to be a prisma.user.update nobody waited for: Vercel froze the
 * function mid-write, the transaction stayed open holding the user's row,
 * and every later write to that row queued behind it until the whole
 * database stalled (2026-10-21).
 */
export function touchLastSeen(userId) {
  if (!userId) return
  const now = Date.now()
  if (now - (seenAt.get(userId) || 0) < SEEN_EVERY_MS) return
  seenAt.set(userId, now)
  inBackground(
    prisma.$executeRaw`UPDATE "User" SET "lastSeenAt" = ${new Date(now)} WHERE id = ${userId}`
      .catch(err => console.warn(`[users] last seen not saved: ${err.message}`)),
  )
}

export { ROLES } from './roles.js'

/**
 * What a role is called in anything a person reads - audit summaries, errors.
 */
export function roleLabel(role) {
  return (ROLE_LABEL[normalizeRole(role)] || 'team member').toLowerCase()
}

/** "Matt Hickman", or just "Matt" when no last name is set. */
export function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
}
const SCRYPT_KEYLEN = 64

/** "scrypt:<saltHex>:<hashHex>" */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN)
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const [scheme, saltHex, hashHex] = stored.split(':')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  try {
    const expected = Buffer.from(hashHex, 'hex')
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length)
    return crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** Emails are identity, so they are compared lowercased and trimmed. */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
}

/**
 * Re-read the user behind a request and confirm they may still act.
 *
 * The session token carries id, email and role so ordinary reads need no
 * database round trip. That makes the token briefly stale if someone is
 * demoted or deactivated, which is fine for reading a page and NOT fine for
 * deleting variants - so anything destructive calls this instead and pays for
 * a lookup.
 */
export async function loadActiveUser(actor) {
  if (!actor) return null
  // The shared x-admin-secret header has no user row. It used to pass as an
  // admin here, which made one leaked env var a key to every destructive
  // action. Nothing in the app sends it any more (crons use CRON_SECRET, the
  // nightly agent its own token, people their own sign-in), so it is refused
  // for anything that needs a person or a role.
  if (actor.isSystem) return null
  if (!actor.id) return null
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return null
  // An admin viewing as someone is not that person being seen.
  if (actor.viewedBy) return { ...user, viewedBy: actor.viewedBy }
  touchLastSeen(user.id)
  return user
}

/**
 * Gate for irreversible actions. Verifies against the database rather than
 * trusting the token, then checks the role. Responds and returns null on
 * failure so callers can `if (!user) return`.
 */
export async function requireAdminRole(req, res, actor) {
  const user = await loadActiveUser(actor)
  if (!user) {
    res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
    return null
  }
  if (user.role !== 'admin') {
    res.status(403).json({
      error: 'This action is limited to admins. Ask an admin to run it, or to change your role.',
    })
    return null
  }
  return user
}

/**
 * Signed in, active, and allowed this part of the app by their role (see
 * roles.js). Reads the role from the database, so a change takes effect at
 * once rather than at the next sign-in. Responds 401/403 and returns null on
 * failure; returns the user otherwise.
 */
export async function requireCapability(req, res, capability) {
  const actor = (await requireAdmin(req, res))
  if (!actor) return null
  const user = await loadActiveUser(actor)
  if (!user) {
    res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
    return null
  }
  if (user.isSystem || await can(user.role, capability)) return user
  res.status(403).json({ error: 'That is not part of your role. Ask Matt if you need it.', code: 'not_allowed' })
  return null
}

/**
 * Authenticate AND require the admin role, in one call.
 *
 * `requireAdmin` is a misnomer inherited from when this app had one shared
 * password: it means "signed in". Endpoints that should be admin-only need
 * both, and forgetting the second half is an easy mistake to make, so this
 * pairs them. Returns the actor, or null after responding 401/403.
 *
 * The shared x-admin-secret header does not pass: loadActiveUser refuses it.
 */
export async function requireAdminOnly(req, res) {
  const actor = (await requireAdmin(req, res))
  if (!actor) return null
  return await requireAdminRole(req, res, actor)
}

/**
 * Gate for the Sales tool: signed in, active, and either an admin or a
 * member of the Attio workspace by email. Reps are added by adding them to
 * Attio, which is where their deals are anyway; the app keeps no second
 * list. Responds and returns null on failure. When Attio is not configured
 * only admins get in, so the page can say what is missing.
 */
export async function requireSalesRep(req, res) {
  const actor = (await requireAdmin(req, res))
  if (!actor) return null
  const user = await loadActiveUser(actor)
  if (!user) {
    res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
    return null
  }
  if (user.role === 'admin' || user.isSystem) return user
  if (!(await can(user.role, 'sales'))) {
    res.status(403).json({ error: 'Sales is not part of your role. Ask Matt if you need it.', code: 'not_a_rep' })
    return null
  }
  try {
    const { memberForEmail, isAttioConfigured } = await import('../../server/domain/sales/attio.js')
    if (isAttioConfigured() && await memberForEmail(user.email)) return user
  } catch (err) {
    console.warn(`[sales] could not check Attio membership for ${user.email}: ${err.message}`)
  }
  res.status(403).json({ error: 'Sales is for the people on the Attio workspace. Ask Matt to add you in Attio with this email.', code: 'not_a_rep' })
  return null
}

/** Append-only record of who did something consequential. */
export async function recordAudit({ action, summary, detail = null, actor }) {
  try {
    await prisma.auditEvent.create({
      data: {
        action,
        summary,
        detail: detail ?? undefined,
        userId: actor?.isSystem ? null : actor?.id ?? null,
        actorEmail: actor?.email || 'unknown',
      },
    })
  } catch (error) {
    // An audit failure must not take down the action it describes, but it must
    // be loud - a silent gap in the log is worse than no log at all.
    console.error('[audit] FAILED to record', action, error.message)
  }
}
