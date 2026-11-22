#!/usr/bin/env node
/**
 * One-time import of the Notion "Trackstar Customer Support Playbook" into
 * Support > Help articles (server/domain/support/helpCenter.js), which is
 * where the playbook is edited from now on (Matt, 2026-11-21).
 *
 *   node --env-file=.env.local scripts/import-help-articles.js <notion-page.md>           dry run: lists the articles
 *   node --env-file=.env.local scripts/import-help-articles.js <notion-page.md> --write   saves them
 *
 * The input is the page as the Notion MCP fetch returns it (Notion-flavored
 * markdown). Each top-level section, each Context toggle and each Scenario
 * toggle becomes an article. An article that already exists (same slug) is
 * left alone, so running it twice changes nothing. It also adds the pinned
 * Current policies and numbers article (notionImport.js CURRENT_POLICIES).
 */
import fs from 'node:fs'
import { splitNotionPlaybook, CURRENT_POLICIES } from '../server/domain/support/notionImport.js'

const [file, flag] = process.argv.slice(2)
if (!file) { console.error('Give the Notion page text as the first argument.'); process.exit(1) }
// The pinned Current policies and numbers first, then the page's sections and toggles.
const articles = [CURRENT_POLICIES, ...splitNotionPlaybook(fs.readFileSync(file, 'utf8'))]
for (const a of articles) console.log(`${String(a.position).padStart(4)}  [${a.group}] ${a.title}  (${a.body.length} chars)`)
console.log(`\n${articles.length} articles.`)

if (flag === '--write') {
  const { default: prisma } = await import('../server/db.js')
  const { saveArticle, slugify } = await import('../server/domain/support/helpCenter.js')
  let made = 0, kept = 0
  for (const a of articles) {
    if (await prisma.supportArticle.findUnique({ where: { slug: slugify(a.title) }, select: { id: true } })) { kept++; continue }
    await saveArticle(a)
    made++
  }
  console.log(`Saved ${made}, already there ${kept}.`)
  await prisma.$disconnect()
} else {
  console.log('Dry run. Add --write to save them.')
}
