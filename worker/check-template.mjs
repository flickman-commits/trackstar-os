#!/usr/bin/env node
/**
 * Check production files before (and after) mapping them in templates.json.
 *
 *   node worker/check-template.mjs                      every template in the tool (Settings > Admin > Designs)
 *   node worker/check-template.mjs "Sydney Marathon"    one key
 *   node worker/check-template.mjs --file "Sydney Marathon/Illustrator Files/Sydney Marathon_Production.ai" --race "Sydney Marathon"
 *   node worker/check-template.mjs --file "Triathlon/Illustrator Files/Triathlon Generic_Production.ai" --race Triathlon --triathlon
 *
 * The worker runs this same check on its own whenever a file changes; this
 * is for trying a file before it is added, or looking closer at a problem.
 * Needs the repo's .env.local for the database.
 *
 * Opens each file in Illustrator exactly as the render script would and
 * reports, per size: whether the name, bib and time frames were found, how
 * the name is aligned (that decides which way a long name may grow), which
 * optional fields exist (pace, date, weather, year), whether the margin
 * guides and photo window are there, and anything left behind by a past
 * order (text or a photo). A FAIL means the render script would refuse the
 * file; a WARN is something to know.
 *
 * Stop the render worker first: both talk to the same Illustrator.
 */
import 'dotenv/config'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import prisma from '../server/db.js'
import { evaluateCheck } from './lib/evaluateCheck.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
for (const line of fs.existsSync(path.join(HERE, '.env')) ? fs.readFileSync(path.join(HERE, '.env'), 'utf8').split('\n') : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const RACES_DIR = process.env.RACES_DIR
const templates = Object.fromEntries((await prisma.printTemplate.findMany()).map(t => [t.key, { file: t.file, ...(t.rules || {}) }]))

const args = process.argv.slice(2)
let jobs = []
if (args[0] === '--file') {
  const opt = name => { const i = args.indexOf(name); return i > 0 ? args[i + 1] || null : null }
  jobs = [{ key: opt('--race') || args[1], path: args[1], race: opt('--race'), artboard: opt('--artboard'), triathlon: args.includes('--triathlon') }]
} else {
  const keys = args.length ? args : Object.keys(templates)
  for (const key of keys) {
    const t = templates[key]
    if (!t) { console.error(`No template key "${key}"`); process.exit(1) }
    const tpl = typeof t === 'string' ? { file: t } : t
    jobs.push({ key, path: tpl.file, race: key.split(' / ')[0], artboard: tpl.artboard || null, artboardExclude: tpl.artboardExclude || null, photoArtboard: tpl.photoArtboard || null, triathlon: Boolean(tpl.triathlon) })
  }
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'trackstar-check-'))
const files = jobs.map((j, i) => {
  const src = path.join(RACES_DIR, j.path)
  if (!fs.existsSync(src)) return { ...j, missing: true }
  const copy = path.join(WORK, `${i}.ai`)
  fs.copyFileSync(src, copy)
  return { ...j, path: copy }
})
const present = files.filter(f => !f.missing)
fs.writeFileSync(path.join(HERE, 'illustrator', 'check-input.json'), JSON.stringify({ files: present }))
fs.rmSync(path.join(HERE, 'illustrator', 'check-result.json'), { force: true })
if (present.length) execFileSync('osascript', ['-e', `tell application "Adobe Illustrator" to do javascript file "${path.join(HERE, 'illustrator', 'check.jsx')}"`], { timeout: 600000 })
const results = present.length ? JSON.parse(fs.readFileSync(path.join(HERE, 'illustrator', 'check-result.json'), 'utf8')) : []
fs.rmSync(WORK, { recursive: true, force: true })

let failures = 0
for (const f of files) {
  if (f.missing) { console.log(`\n${f.key}\n  FAIL  file not found: ${f.path}`); failures++; continue }
  const v = evaluateCheck(results.find(x => x.key === f.key))
  const lines = []
  for (const m of v.problems) lines.push(`  FAIL  ${m}`)
  for (const m of v.warnings) lines.push(`  WARN  ${m}`)
  for (const [size, s] of Object.entries(v.sizes)) lines.push(`  ok    ${size}: ${s.fields.join(', ')}; name ${s.nameAlign}-aligned, grows ${s.nameGrows}${s.photoWindow === 'variant' ? `; photo orders use "${s.photoArtboard}"` : s.photoWindow ? '; photo window' : ''}`)
  if (v.extraSizes?.length) lines.push(`  ok    also has ${v.extraSizes.join(', ')} (not sold through the tool)`)
  failures += v.problems.length
  console.log(`\n${f.key}  [${v.colorSpace}]\n${lines.join('\n')}`)
}
console.log(`\n${files.length} template${files.length === 1 ? '' : 's'} checked, ${failures} problem${failures === 1 ? '' : 's'}`)
await prisma.$disconnect()
process.exit(failures ? 1 : 0)
