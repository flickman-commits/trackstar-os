/**
 * When orders were last pulled from Artelo, and a simple lock so the cron and
 * a manual run never import at the same time. Both live in SystemConfig.
 */
import prisma from '../db.js'

const LAST_KEY = 'orders_last_import'
const LOCK_KEY = 'orders_import_lock'
// Longer than a run can last (300 seconds), shorter than the ten minutes between
// runs: a lock left by a killed run never costs the next run.
const LOCK_MS = 6 * 60 * 1000

export async function getLastImport() {
  const row = await prisma.systemConfig.findUnique({ where: { key: LAST_KEY } })
  return row?.value || null
}

/**
 * Take the lock, or report that someone holds it. Atomic: creating the row
 * fails on the unique key if it exists, and a stale lock is taken over only
 * by the one caller whose update still matches the stale value. The old
 * read-then-write let a cron run and "Import now" both start.
 */
async function acquireLock() {
  const now = new Date().toISOString()
  try {
    await prisma.systemConfig.create({ data: { key: LOCK_KEY, value: now } })
    return true
  } catch (err) {
    if (err.code !== 'P2002') throw err
  }
  const held = await prisma.systemConfig.findUnique({ where: { key: LOCK_KEY } })
  if (!held) return acquireLock()
  if (Date.now() - new Date(held.value).getTime() < LOCK_MS) return false
  const { count } = await prisma.systemConfig.updateMany({ where: { key: LOCK_KEY, value: held.value }, data: { value: now } })
  return count === 1
}

export async function runLockedImport(fn) {
  if (!(await acquireLock())) return { skipped: 'already_running' }
  try {
    const out = await fn()
    const done = new Date().toISOString()
    await prisma.systemConfig.upsert({ where: { key: LAST_KEY }, update: { value: done }, create: { key: LAST_KEY, value: done } })
    return { ...out, lastImportedAt: done }
  } finally {
    await prisma.systemConfig.delete({ where: { key: LOCK_KEY } }).catch(() => {})
  }
}
