/**
 * check-duplicate-rows.mjs
 *
 * Read only. Counts the rows that would stop two new unique rules in
 * prisma/schema.prisma from being applied (2026-11-10):
 *   RenderJob       one version number per order    @@unique([orderId, version])
 *   RunnerResearch  one research row per order+race  @@unique([orderId, raceId])
 * `npx prisma db push` fails on either while duplicates exist. Run this first;
 * if both counts are 0, the push is safe. If not, the list shows which orders
 * to look at, and they are cleaned up before the push (no script does that yet).
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-duplicate-rows.mjs
 */
import 'dotenv/config'
import prisma from '../server/db.js'

const renders = await prisma.$queryRaw`SELECT "orderId", "version", COUNT(*)::int AS n FROM "RenderJob" GROUP BY "orderId", "version" HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 50`
const research = await prisma.$queryRaw`SELECT "orderId", "raceId", COUNT(*)::int AS n FROM "RunnerResearch" GROUP BY "orderId", "raceId" HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 50`

console.log(`RenderJob: ${renders.length} order+version pair(s) used more than once${renders.length === 50 ? ' (first 50)' : ''}`)
for (const r of renders) console.log(`  order ${r.orderId} v${r.version}: ${r.n} rows`)
console.log(`RunnerResearch: ${research.length} order+race pair(s) with more than one row${research.length === 50 ? ' (first 50)' : ''}`)
for (const r of research) console.log(`  order ${r.orderId} race ${r.raceId}: ${r.n} rows`)
console.log(renders.length || research.length ? '\nNot safe to push yet: clean these up first.' : '\nNo duplicates: npx prisma db push is safe for these two rules.')
await prisma.$disconnect()
