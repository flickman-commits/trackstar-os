/**
 * Log tables that only ever grew. Run daily by api/_routes/cron/retention.js.
 *
 * Not here on purpose: the Activity Log (AuditEvent), which is the record of
 * who did what, and ScraperHealth, which is one row per race and year
 * overwritten on each probe rather than a growing history.
 */
import prisma from '../db.js'

const DAY = 24 * 60 * 60 * 1000

export const RETENTION = {
  lookupLogDays: 180,   // Instant Lookup searches: enough for season-over-season comparisons
  rateLimitHitDays: 2,   // windows are at most an hour
}

/**
 * Postgres's query statistics (pg_stat_statements), trimmed when they grow.
 * Prisma loads related rows with "id IN ($1, ... $N)", and every N is its own
 * entry, so the table filled to its 5,000-entry cap with 13MB of query text.
 * Supabase's monitoring rereads and sorts all of it every minute, which
 * spilled to disk (~40MB of temp files a minute) and drained the Disk IO
 * budget (2026-11-17). Only statistics are cleared, never data.
 */
export const QUERY_STATS_MAX = 1500

export async function trimQueryStats(max = QUERY_STATS_MAX) {
  const [{ n }] = await prisma.$queryRawUnsafe('select count(*)::int as n from pg_stat_statements')
  if (n <= max) return { entries: n, reset: false }
  await prisma.$queryRawUnsafe('select pg_stat_statements_reset()')
  return { entries: n, reset: true }
}

export async function pruneLogs(now = Date.now()) {
  const before = days => new Date(now - days * DAY)
  const [lookups, hits] = await Promise.all([
    prisma.lookupLog.deleteMany({ where: { createdAt: { lt: before(RETENTION.lookupLogDays) } } }),
    prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: before(RETENTION.rateLimitHitDays) } } }),
  ])
  return { lookupLog: lookups.count, rateLimitHit: hits.count }
}
