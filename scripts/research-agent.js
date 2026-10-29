/**
 * Run the research agent (server/domain/research/researchAgent.js) from a
 * terminal against the real queue. .env.local is the production database,
 * so --apply writes live results and notes.
 *
 *   node --env-file=.env.local --env-file=.env scripts/research-agent.js                 (dry run)
 *   node --env-file=.env.local --env-file=.env scripts/research-agent.js --apply
 *   node --env-file=.env.local --env-file=.env scripts/research-agent.js --apply 6233 6325 (only these)
 *
 * The web step needs a model with web search (ANTHROPIC_API_KEY); without one
 * those orders are reported untouched. Findings made elsewhere (by a person or
 * a Claude session) go in with --submit=<file.json>, a list of
 * { orderNumber, resultsUrl, nameOnPage, bib, chipTime, pace, eventType, notes }:
 * each is checked on our own fetch of the page, then entered or noted.
 */
import prisma from '../server/db.js'
import { readFileSync } from 'node:fs'
import { runResearchAgent, submitFinding } from '../server/domain/research/researchAgent.js'

const apply = process.argv.includes('--apply')
const submit = process.argv.find(a => a.startsWith('--submit='))
if (submit) {
  for (const { orderNumber, ...claim } of JSON.parse(readFileSync(submit.split('=')[1], 'utf8'))) {
    const r = await submitFinding(orderNumber, claim, { dryRun: !apply, by: 'Finder' })
    console.log(r ? `${r.order}  ${r.runner} - ${r.race}: ${r.outcome}\n    ${r.detail}` : `${orderNumber}: not in the research queue`)
  }
  await prisma.$disconnect()
  process.exit(0)
}
const orderNumbers = process.argv.slice(2).filter(a => !a.startsWith('--'))
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const out = await runResearchAgent({ dryRun: !apply, orderNumbers, limit: limitArg ? Number(limitArg.split('=')[1]) : 15, actor: { isSystem: true, email: 'research-agent-script' } })
for (const k of ['cleared', 'suggested', 'person', 'untouched', 'skipped']) {
  if (!out[k].length) continue
  console.log(`\n${k.toUpperCase()} (${out[k].length})`)
  for (const i of out[k]) console.log(`  ${i.order}  ${i.runner} - ${i.race} [${i.reason}]\n      ${i.result || i.why}`)
}
console.log(`\n${out.summary}`)
await prisma.$disconnect()
