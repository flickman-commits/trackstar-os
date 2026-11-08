/**
 * Results saved without the runner's own page: matches picked from the list
 * and results entered by hand (both saved no link until resultsLink.js).
 * Builds the link from the race and bib where the platform keys a runner's
 * page by bib. Dry run by default.
 *
 *   node --env-file=.env.local scripts/backfill-results-links.js
 *   node --env-file=.env.local scripts/backfill-results-links.js --apply
 */
import prisma from '../server/db.js'
import { resultsLinkForBib } from '../server/domain/research/resultsLink.js'

const apply = process.argv.includes('--apply')
const rows = await prisma.runnerResearch.findMany({
  // Completed orders too: support still opens them when a customer writes in.
  where: { researchStatus: 'found', resultsUrl: null, bibNumber: { not: null } },
  select: { id: true, bibNumber: true, order: { select: { orderNumber: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true } } },
})
let n = 0
for (const r of rows) {
  const o = r.order
  const link = await resultsLinkForBib({ raceName: o.raceNameOverride ?? o.raceName, raceYear: o.yearOverride ?? o.raceYear, bib: r.bibNumber })
  if (!link) continue
  n++
  console.log(`${o.orderNumber}: bib ${r.bibNumber} -> ${link}`)
  if (apply) await prisma.runnerResearch.update({ where: { id: r.id }, data: { resultsUrl: link } })
}
console.log(`${n} of ${rows.length} results without a link ${apply ? 'linked' : 'would be linked (dry run; --apply to write)'}`)
await prisma.$disconnect()
