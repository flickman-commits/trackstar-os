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

export async function pruneLogs(now = Date.now()) {
  const before = days => new Date(now - days * DAY)
  const [lookups, hits] = await Promise.all([
    prisma.lookupLog.deleteMany({ where: { createdAt: { lt: before(RETENTION.lookupLogDays) } } }),
    prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: before(RETENTION.rateLimitHitDays) } } }),
  ])
  return { lookupLog: lookups.count, rateLimitHit: hits.count }
}
