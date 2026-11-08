/**
 * Put back the leading zero on bulk runners' zips (Excel saved 06477 as 6477).
 * Only for states whose zips start with 0 (normalizeZip). Runners already in
 * Artelo are listed: their Artelo order still has the short zip and is fixed
 * there by hand.
 *
 *   node --env-file=.env.local scripts/fix-bulk-zips.js            dry run
 *   node --env-file=.env.local scripts/fix-bulk-zips.js --apply
 */
import prisma from '../server/db.js'
import { normalizeZip, usZipProblem } from '../server/domain/bulk/bulkOrders.js'

const apply = process.argv.includes('--apply')
const rows = await prisma.order.findMany({
  where: { bulkOrderId: { not: null }, shippedAt: null },
  select: { id: true, orderNumber: true, runnerName: true, shippingAddress: true, bulkSentAt: true, arteloOrderData: true },
})
let fixed = 0
for (const r of rows) {
  const a = r.shippingAddress
  if (!a?.zip) continue
  const n = normalizeZip(a)
  const inArtelo = r.bulkSentAt || r.arteloOrderData?.id ? ` (in Artelo ${r.arteloOrderData?.id || ''}: fix there by hand)` : ''
  if (n.zip !== a.zip) {
    fixed++
    console.log(`${r.orderNumber} ${r.runnerName}: ${a.city}, ${a.state} ${a.zip} -> ${n.zip}${inArtelo}`)
    if (apply) await prisma.order.update({ where: { id: r.id }, data: { shippingAddress: n } })
  } else if (usZipProblem(a)) {
    console.log(`${r.orderNumber} ${r.runnerName}: ${a.city}, ${a.state} ${a.zip} NEEDS A PERSON: ${usZipProblem(a)}${inArtelo}`)
  }
}
console.log(`${fixed} zip(s) ${apply ? 'fixed' : 'would be fixed (dry run; --apply to write)'}`)
await prisma.$disconnect()
