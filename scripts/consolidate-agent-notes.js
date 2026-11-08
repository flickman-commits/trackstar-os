/**
 * One research-agent note per order. The agent used to add a note on every
 * pass, so an order it looked at three times carried three near-identical
 * paragraphs. Keeps the newest agent note on each order and deletes the
 * older ones; a person's notes are never touched.
 *
 *   node --env-file=.env.local scripts/consolidate-agent-notes.js          dry run
 *   node --env-file=.env.local scripts/consolidate-agent-notes.js --apply
 */
import prisma from '../server/db.js'
import { AGENT_NAME } from '../server/domain/research/researchAgent.js'

const apply = process.argv.includes('--apply')
const rows = await prisma.orderComment.findMany({ where: { authorName: AGENT_NAME }, select: { id: true, orderId: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
const seen = new Set(), drop = []
for (const r of rows) { if (seen.has(r.orderId)) drop.push(r.id); else seen.add(r.orderId) }
console.log(`${rows.length} agent notes on ${seen.size} orders; ${drop.length} older duplicates ${apply ? 'deleted' : 'would be deleted (dry run; --apply to write)'}`)
if (apply && drop.length) await prisma.orderComment.deleteMany({ where: { id: { in: drop } } })
await prisma.$disconnect()
