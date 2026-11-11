/**
 * Once per click.
 *
 * The page sends a random key with every press of a button that moves money
 * or reaches a person (a refund, a cancel, a Send). The first request with a
 * key claims it; a second one inside ten minutes is refused instead of
 * refunding or sending twice, whether it came from a double click, a retry
 * after a slow response, or a replayed request.
 *
 * Claimed keys live in SystemConfig as "idem:<scope>:<key>" rows, so this
 * needs no table of its own. The row's primary key is what makes the claim
 * atomic: two requests with the same key cannot both create it. Old rows are
 * swept on the way in.
 */
import prisma from '../../db.js'
import { UserError } from './errors.js'

export const IDEMPOTENCY_TTL_MS = 10 * 60_000
const PREFIX = 'idem:'

/** A key the page made: letters, digits and dashes, 8 to 100 of them. */
export function cleanIdempotencyKey(raw) {
  const key = String(raw ?? '').trim()
  return /^[A-Za-z0-9_-]{8,100}$/.test(key) ? key : null
}

/**
 * Claim a key for a scope ("support.refund", "sales.send"). Throws a
 * UserError when the key is missing, malformed, or already used within the
 * window; returns quietly otherwise.
 */
export async function claimOnce(scope, rawKey, { ttlMs = IDEMPOTENCY_TTL_MS, now = Date.now(), repeated = 'That was already done a moment ago. Check the conversation before trying again.' } = {}) {
  const key = cleanIdempotencyKey(rawKey)
  if (!key) throw new UserError('This page is out of date. Reload it and try again.')
  const id = `${PREFIX}${scope}:${key}`
  const cutoff = new Date(now - ttlMs)
  await prisma.systemConfig.deleteMany({ where: { key: { startsWith: PREFIX }, updatedAt: { lt: cutoff } } }).catch(() => {})
  try {
    await prisma.systemConfig.create({ data: { key: id, value: new Date(now).toISOString() } })
  } catch (err) {
    if (err?.code !== 'P2002') throw err
    // Already there. Stale rows were just swept, but a sweep can lose a race,
    // so the age is checked rather than assumed.
    const row = await prisma.systemConfig.findUnique({ where: { key: id } })
    if (row && row.updatedAt >= cutoff) {
      throw new UserError(repeated, { status: 409 })
    }
    await prisma.systemConfig.update({ where: { key: id }, data: { value: new Date(now).toISOString() } })
  }
}

/** Give a claim back when the thing it guarded did not happen, so a retry is not refused. */
export async function releaseClaim(scope, rawKey) {
  const key = cleanIdempotencyKey(rawKey)
  if (!key) return
  await prisma.systemConfig.deleteMany({ where: { key: `${PREFIX}${scope}:${key}` } }).catch(() => {})
}
