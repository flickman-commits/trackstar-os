/**
 * API keys: how anything outside the app reaches it (the MCP server above
 * all). See prisma ApiKey.
 *
 * A key is minted once and shown once; only its sha256 is kept, so the
 * database cannot give a key away. It acts as a person: whatever it does is
 * audited as them and limited to their role, then narrowed by the key's
 * scopes. A key with no person is a service key for a routine (the nightly
 * sweep) and may only read or repair: anything that changes an order is done
 * as someone.
 *
 * The two env tokens from before keys existed (MCP_TOKEN, MCP_WRITE_TOKEN)
 * still work as service keys, so the nightly routine keeps running while it
 * is moved over. Delete them from Vercel once it has a real key.
 */
import crypto from 'crypto'
import prisma from './prisma.js'
import { safeEqual } from './auth.js'
import { normalizeRole } from './roles.js'

export const SCOPES = ['read', 'write', 'admin', 'repair', 'worker']
export const SCOPE_LABEL = {
  read: 'Read: orders, statuses, reports (approval and intake links only for admins and design approvers)',
  write: 'Write: assign, comment, design status, research, race checks, Support drafts, run an import',
  admin: 'Admin: help shifts, the order list, production files, samples (admins only)',
  repair: 'Repair: the nightly routine\'s scraper tools',
  worker: 'Render worker: the Illustrator Mac that renders designs (nothing else)',
}
const SERVICE_SCOPES = new Set(['read', 'repair', 'worker'])
const SECRET_PREFIX = 'tsk_'
const SHOWN_PREFIX = 12
const TOUCH_EVERY_MS = 5 * 60_000
const touched = new Map()

export function mintSecret() {
  return SECRET_PREFIX + crypto.randomBytes(30).toString('base64url')
}
export function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex')
}

const USER_SELECT = { id: true, email: true, firstName: true, lastName: true, role: true, extraRoles: true, extraCaps: true, deniedCaps: true, isActive: true }

/** The shape the Settings page shows. Never the hash. */
export function publicKey(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    userId: row.userId,
    actsAs: row.user ? { id: row.user.id, firstName: row.user.firstName, lastName: row.user.lastName, email: row.user.email, role: normalizeRole(row.user.role), isActive: row.user.isActive } : null,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }
}

export async function listApiKeys() {
  const rows = await prisma.apiKey.findMany({ orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }], include: { user: { select: USER_SELECT } } })
  return rows.map(publicKey)
}

/**
 * Mint a key. Returns the secret once; it is not kept. Throws a plain Error
 * with a message fit for the screen.
 */
export async function createApiKey({ name, userId, scopes, expiresInDays, actor }) {
  const cleanName = String(name || '').trim().slice(0, 60)
  if (!cleanName) throw new Error('Give the key a name, like "Matt\'s phone"')
  const wanted = [...new Set((Array.isArray(scopes) ? scopes : []).filter(s => SCOPES.includes(s)))]
  if (!wanted.length) throw new Error('Pick at least one scope')

  let user = null
  if (userId) {
    user = await prisma.user.findUnique({ where: { id: String(userId) }, select: USER_SELECT })
    if (!user?.isActive) throw new Error('Pick an active person for the key to act as')
    if (wanted.includes('admin') && normalizeRole(user.role) !== 'admin') throw new Error(`${user.firstName} is not an admin, so the key cannot have the admin scope`)
    if (wanted.includes('repair') && normalizeRole(user.role) !== 'admin') throw new Error('Repair is for admins and service keys')
  } else {
    const bad = wanted.filter(s => !SERVICE_SCOPES.has(s))
    if (bad.length) throw new Error(`A service key can only read, repair or run the render worker; ${bad.join(' and ')} needs a person behind it`)
  }

  let expiresAt = null
  if (expiresInDays != null && expiresInDays !== '') {
    const days = Number(expiresInDays)
    if (!Number.isFinite(days) || days < 1 || days > 730) throw new Error('Expiry is between 1 and 730 days')
    expiresAt = new Date(Date.now() + days * 86400000)
  }

  const secret = mintSecret()
  const row = await prisma.apiKey.create({
    data: {
      name: cleanName,
      prefix: secret.slice(0, SHOWN_PREFIX),
      hash: hashSecret(secret),
      scopes: wanted,
      userId: user?.id || null,
      createdById: actor?.id || null,
      expiresAt,
    },
    include: { user: { select: USER_SELECT } },
  })
  return { key: publicKey(row), secret }
}

export async function revokeApiKey(id) {
  const row = await prisma.apiKey.findUnique({ where: { id: String(id) }, include: { user: { select: USER_SELECT } } })
  if (!row) throw new Error('No such key')
  if (row.revokedAt) return publicKey(row)
  const updated = await prisma.apiKey.update({ where: { id: row.id }, data: { revokedAt: new Date() }, include: { user: { select: USER_SELECT } } })
  return publicKey(updated)
}

function legacyPrincipal(env, presented) {
  const write = env.MCP_WRITE_TOKEN
  const read = env.MCP_TOKEN
  if (write && safeEqual(presented, write)) {
    return { kind: 'service', keyId: 'env:MCP_WRITE_TOKEN', name: 'Nightly routine (MCP_WRITE_TOKEN)', scopes: new Set(['read', 'repair']), user: null, role: null, legacy: true }
  }
  if (read && safeEqual(presented, read)) {
    return { kind: 'service', keyId: 'env:MCP_TOKEN', name: 'Read token (MCP_TOKEN)', scopes: new Set(['read']), user: null, role: null, legacy: true }
  }
  return null
}

/**
 * Who is calling, from the secret they presented: a principal, or null when
 * the secret is unknown, revoked, expired, or its person is deactivated.
 *
 *   { kind: 'user' | 'service', keyId, name, scopes: Set, user | null, role }
 *
 * `db` and `env` are parameters so this can be tested without a database.
 */
export async function resolveApiKey(presented, { db = prisma, env = process.env, now = new Date() } = {}) {
  const secret = String(presented || '').trim()
  if (!secret) return null
  const legacy = legacyPrincipal(env, secret)
  if (legacy) return legacy
  if (!secret.startsWith(SECRET_PREFIX)) return null

  const row = await db.apiKey.findUnique({ where: { hash: hashSecret(secret) }, include: { user: { select: USER_SELECT } } })
  if (!row || row.revokedAt) return null
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null
  if (row.userId && !row.user?.isActive) return null

  const last = touched.get(row.id) || 0
  if (now.getTime() - last > TOUCH_EVERY_MS) {
    touched.set(row.id, now.getTime())
    db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {})
  }

  const user = row.user ? { id: row.user.id, email: row.user.email, firstName: row.user.firstName, lastName: row.user.lastName, role: normalizeRole(row.user.role), extraRoles: row.user.extraRoles || [], extraCaps: row.user.extraCaps || [], deniedCaps: row.user.deniedCaps || [] } : null
  return { kind: user ? 'user' : 'service', keyId: row.id, name: row.name, scopes: new Set(row.scopes), user, role: user?.role || null, extraRoles: user?.extraRoles || [], extraCaps: user?.extraCaps || [], deniedCaps: user?.deniedCaps || [], legacy: false }
}
