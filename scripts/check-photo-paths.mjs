/**
 * check-photo-paths.mjs
 *
 * Read only. Lists open orders whose photo path is not the shape every upload
 * makes (server/lib/photoPath.js). Since 2026-11-10 such a path is never
 * signed, so a render for that order fails with "not an uploaded photo path"
 * instead of reading whatever the path points at. Run it once after deploying
 * that change: an empty list means nothing real was caught by it.
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-photo-paths.mjs
 */
import 'dotenv/config'
import prisma from '../server/db.js'
import { isStoredPhotoPath } from '../server/lib/photoPath.js'

const rows = await prisma.order.findMany({
  where: { photoPath: { not: null }, status: { not: 'completed' } },
  select: { orderNumber: true, photoPath: true, photoAddedManually: true },
})
const bad = rows.filter(r => !isStoredPhotoPath(r.photoPath))
for (const r of bad) console.log(`${r.orderNumber}\t${r.photoAddedManually ? 'added by staff' : 'from the cart'}\t${String(r.photoPath).slice(0, 120)}`)
console.log(`\n${rows.length} open orders with a photo; ${bad.length} with a path that is not an upload's shape.`)
await prisma.$disconnect()
