/**
 * One-off (2026-11-24): two playbook articles disagreed about a size change
 * once a print is in production (Scenario 10 said cancel, refund and reorder).
 * Matt: if it is really made, it can't change; but "in production" often is
 * not printed yet, and then Hold in Artelo lets us change it.
 *
 * Dry run:  node --env-file=.env.local scripts/help-size-change-policy.mjs
 * Write:    node --env-file=.env.local scripts/help-size-change-policy.mjs --write
 */
import prisma from '../server/db.js'
import { saveArticle } from '../server/domain/support/helpCenter.js'

const write = process.argv.includes('--write')
const SLUG = 'scenario-10-order-modification-change-size-frame-or-details'
const a = await prisma.supportArticle.findUnique({ where: { slug: SLUG } })
const from = a.body.indexOf('**Already in Production (Size Change):**')
const to = a.body.indexOf('**Already in Production (Frame Change):**')
if (from < 0 || to < from) { console.log('The article no longer has that section; nothing changed.'); process.exit(1) }
const section = `**In production (size change):** open the order in Artelo first. TrackstarOS can say "in production" before anything is printed.

- **Not printed yet:** click **Hold** in Artelo. That takes it back out of production, and the change can usually be made.
- **Already printed:** it can't be changed. Tell them it has already been made and, unfortunately, we can't change it.

> Hey [First Name],

> Unfortunately [RUNNER]'s print has already been made, so we aren't able to change it at this point. Attaching a mockup so you can see what's coming!

> Thanks,

> [Your Name] from Trackstar

`
const body = a.body.slice(0, from) + section + a.body.slice(to)
console.log('--- now\n' + a.body.slice(from, to) + '--- becomes\n' + section)
if (write) { await saveArticle({ slug: SLUG, title: a.title, group: a.group, body, pinned: a.pinned, reviewEveryDays: a.reviewEveryDays }); console.log('Saved (the old version is in History).') }
process.exit(0)
