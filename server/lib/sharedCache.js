/**
 * A value worked out once and shared by every Vercel instance, kept in
 * SystemConfig (key `cache:<key>`). Each instance's own memory cache did not
 * help: with dozens of instances nearly every page load recomputed the header
 * numbers from thousands of audit rows, and that load is what filled the
 * Supabase pooler on 2026-11-10.
 *
 * Fresh (younger than ttlMs): returned as is. Stale but recent (under
 * staleMs): returned at once, and one request recomputes it in the background;
 * the others keep serving the stale copy. Missing or too old: computed now.
 */
import prisma from '../db.js'
import { inBackground } from './background.js'

const REFRESH_LOCK_MS = 60_000

async function read(key) {
  const row = await prisma.systemConfig.findUnique({ where: { key } }).catch(() => null)
  if (!row) return null
  try { return { raw: row.value, ...JSON.parse(row.value) } } catch { return null }
}

async function write(key, value) {
  const v = JSON.stringify({ at: Date.now(), value })
  await prisma.systemConfig.upsert({ where: { key }, update: { value: v }, create: { key, value: v } })
}

/** One refresher at a time: claim the row by its current contents, so two requests cannot both win. */
async function claim(key, hit) {
  if (hit.refreshingAt && Date.now() - hit.refreshingAt < REFRESH_LOCK_MS) return false
  const v = JSON.stringify({ at: hit.at, value: hit.value, refreshingAt: Date.now() })
  const { count } = await prisma.systemConfig.updateMany({ where: { key, value: hit.raw }, data: { value: v } }).catch(() => ({ count: 0 }))
  return count === 1
}

export async function sharedCache(name, { ttlMs = 5 * 60_000, staleMs = 60 * 60_000 } = {}, compute) {
  const key = `cache:${name}`
  const hit = await read(key)
  const age = hit ? Date.now() - hit.at : Infinity
  if (hit && age < ttlMs) return hit.value
  if (hit && age < staleMs) {
    if (await claim(key, hit)) inBackground(compute().then(v => write(key, v)).catch(e => console.error('[sharedCache]', name, e.message)))
    return hit.value
  }
  const value = await compute()
  await write(key, value).catch(() => {})
  return value
}
