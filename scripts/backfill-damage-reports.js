/**
 * Read every support conversation once for damage reports (a print that
 * arrived broken or damaged), the same pass the hourly cron runs on new
 * messages (server/domain/support/damage.js). Only conversations with a
 * damage word in what the customer wrote go to Claude.
 *
 *   node --env-file=.env.local scripts/backfill-damage-reports.js          dry run: reads and lists, saves nothing
 *   node --env-file=.env.local scripts/backfill-damage-reports.js --apply
 */
import prisma from '../server/db.js'
import { detectDamage } from '../server/domain/support/damage.js'

const apply = process.argv.includes('--apply')
let total = 0, rounds = 0
for (;;) {
  const out = await detectDamage({ limit: 5000, budgetMs: 30 * 60_000, dryRun: !apply, log: line => console.log(line) })
  if (out.status === 'skipped') { console.log(out.reason); break }
  rounds++
  total += out.found
  console.log(`${apply ? 'saved' : 'would save'}: read ${out.read} of ${out.due}, asked Claude about ${out.asked}, ${out.found} damaged, ${out.failed} failed${out.firstError ? ` (${out.firstError})` : ''}, ~${out.usage.input} tokens in / ${out.usage.output} out`)
  // A dry run saves nothing, so a second round would read the same ones again.
  if (!apply || !out.left || rounds > 3) break
}
console.log(`${total} damage report${total === 1 ? '' : 's'}${apply ? '' : ' (dry run, nothing saved)'}`)
await prisma.$disconnect()
