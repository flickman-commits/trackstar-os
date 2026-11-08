/**
 * Record the replacements sent from Support before Replacement rows existed.
 * Each one left a comment on the order it replaced: "New Artelo order
 * 4829-R1 sent from Support[: note for Artelo]" (the first few: "... 4018-R1
 * created: <what>"). Test orders left none.
 * Reasons were not asked then, so they come in as "other" for Matt to set in
 * Finance > Replacements. Cost is not known here (the local Artelo key may be
 * stale); the Finance tab reads each one's bill from Artelo when it loads.
 *
 *   node --env-file=.env.local scripts/backfill-replacements.js          dry run
 *   node --env-file=.env.local scripts/backfill-replacements.js --apply
 */
import prisma from '../server/db.js'

const apply = process.argv.includes('--apply')
const comments = await prisma.orderComment.findMany({
  where: { text: { startsWith: 'New Artelo order ' } },
  orderBy: { createdAt: 'asc' },
  select: { orderId: true, text: true, authorId: true, authorName: true, createdAt: true },
})

// One replacement can carry several prints, so several comments share an id.
const byId = new Map()
for (const c of comments) {
  // Today's wording, and the first few ("New Artelo order 4018-R1 created: replacement ...").
  const m = /^New Artelo order (\S+-R\d+) (?:sent from Support(?:: (.*))?|created: (.*))$/s.exec(c.text)
  if (!m) { console.log(`skip, not understood: ${c.text.slice(0, 80)}`); continue }
  const r = byId.get(m[1]) || { arteloOrderId: m[1], orderIds: [], note: (m[2] || m[3] || '').trim(), authorId: c.authorId, authorName: c.authorName, createdAt: c.createdAt }
  r.orderIds.push(c.orderId)
  byId.set(m[1], r)
}

let made = 0
for (const r of byId.values()) {
  const exists = await prisma.replacement.findUnique({ where: { arteloOrderId: r.arteloOrderId }, select: { id: true } })
  if (exists) { console.log(`${r.arteloOrderId}: already recorded`); continue }
  const orders = await prisma.order.findMany({
    where: { id: { in: r.orderIds } },
    select: { parentOrderNumber: true, runnerName: true, runnerNameOverride: true, raceName: true, raceNameOverride: true, raceYear: true, shopifyOrderData: true },
  })
  const first = orders[0]
  const orderNumber = String(first?.shopifyOrderData?.name || '').replace(/^#/, '') || r.arteloOrderId.replace(/-R\d+$/, '')
  const shopifyOrderId = first?.parentOrderNumber || null
  const note = await prisma.supportNote.findFirst({ where: { kind: 'event', body: { contains: `Artelo order ${r.arteloOrderId}:` } }, select: { threadId: true, body: true } })
  const items = orders.map(o => ({ label: `${o.runnerNameOverride || o.runnerName || 'Runner'} · ${o.raceNameOverride || o.raceName || ''} ${o.raceYear || ''}`.trim(), kind: 'print', size: '', frame: '' }))
  // The Support event names an empty frame when one went too ("Empty frame (Frame only · ...)").
  if (note?.body?.includes('Empty frame')) items.push({ label: 'Empty frame', kind: 'frame', size: '', frame: '' })
  console.log(`${r.arteloOrderId}: #${orderNumber}, ${items.length} item(s), by ${r.authorName || '?'} on ${r.createdAt.toISOString().slice(0, 10)}${r.note ? `, note "${r.note}"` : ''}${note ? '' : ', no Support conversation found'}`)
  if (apply) {
    await prisma.replacement.create({
      data: {
        arteloOrderId: r.arteloOrderId, orderNumber, shopifyOrderId, threadId: note?.threadId || null,
        // A reprint with corrected results was our data error.
        reason: /corrected/i.test(r.note) ? 'our_mistake' : 'other', note: r.note ? `${r.note.slice(0, 400)} (recorded before reasons were asked)` : 'Recorded before reasons were asked',
        items, createdById: r.authorId || null, createdByName: r.authorName || '', createdAt: r.createdAt,
      },
    })
  }
  made++
}
console.log(`${made} replacement(s) ${apply ? 'recorded' : 'to record (dry run; --apply to write)'}`)
await prisma.$disconnect()
