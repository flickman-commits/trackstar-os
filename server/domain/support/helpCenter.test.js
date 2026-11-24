import '../../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTag, searchTerms, casesBlock } from './cases.js'
import { slugify, excerpt, cleanAnswer, answerText } from './helpCenter.js'
import { DEFAULT_TOPICS, parseCard, plainTitle } from './helpTopics.js'
import { notionToMarkdown, splitNotionPlaybook } from './notionImport.js'

test('a case tag is checked: known type and outcome, no order numbers or emails, whole cents', () => {
  const t = cleanTag({ type: 'damaged', outcome: 'replacement', summary: 'Glass broke on order #10245 — jane@x.com got a free replacement', costCents: 4210.4 })
  assert.equal(t.type, 'damaged'); assert.equal(t.outcome, 'replacement'); assert.equal(t.costCents, 4210)
  assert.doesNotMatch(t.summary, /10245|jane@|—/)
  const bad = cleanTag({ type: 'nope', outcome: 'maybe', summary: 'x', costCents: 'lots' })
  assert.deepEqual([bad.type, bad.outcome, bad.costCents], ['other', 'answered', null])
  assert.match(cleanTag({ summary: 'Ran the 2025 race' }).summary, /2025/)
})

test('search uses the meaningful words, once each', () => {
  assert.deepEqual(searchTerms('Hey! My frame arrived broken, the glass shattered. Order #10245 https://x.com'), ['frame', 'arrived', 'broken', 'glass', 'shattered'])
  assert.deepEqual(searchTerms('hi thanks'), [])
})

test('past cases read as a block with what we did and sent', () => {
  const b = casesBlock([{ typeLabel: 'Arrived damaged', outcomeLabel: 'Free replacement', costCents: 4200, summary: 'Glass broke in transit; replacement sent.', reply: 'So sorry! Sending a new one.' }])
  assert.match(b, /PAST CASE 1 \(Arrived damaged; we did: Free replacement; cost \$42\.00\)/)
  assert.match(b, /What we sent: So sorry/)
})

test('slugs and excerpts', () => {
  assert.equal(slugify('Scenario 2B: Broken Frame (Shattered in Transit) ⚠️'), 'scenario-2b-broken-frame-shattered-in-transit')
  assert.match(excerpt('Long intro text. '.repeat(20) + 'The frame swap works before production.', ['frame']), /frame swap/)
})

test('Notion markup becomes plain markdown', () => {
  assert.equal(notionToMarkdown('<b>Bold</b> and \\[First Name\\] cost \\$20 <code>REPRINT</code>'), '**Bold** and [First Name] cost $20 REPRINT')
  assert.equal(notionToMarkdown('<video source="https://loom.com/x" />'), '[Watch the recording](https://loom.com/x)')
})

test('the Notion page splits into articles: sections, Context toggles, Scenario toggles', () => {
  const page = `<content>
## Purpose
Why this exists, in a sentence or two.
## Who Handles What
- <b>Support rep (you):</b> owns the inbox.
## Working the Inbox
- Waiting on customer, not Closed, when we asked them something.
<toggle heading="h2">
Inbox Setup (Do This First)
Support runs through fast@trackstar.art in TrackstarOS.
</toggle>
## Context
<toggle>
Shipping
Delivery is 10 to 12 days from the order date.
</toggle>
## Scenarios
<toggle>
Scenario 1: Where is my order?
Check Artelo first, then reply with tracking.
</toggle>
</content>`
  const a = splitNotionPlaybook(page)
  assert.deepEqual(a.map(x => [x.group, x.title]), [
    ['Start here', 'Purpose and who handles what'],
    ['Start here', 'Working the Inbox'],
    ['Context', 'Shipping'],
    ['Scenarios', 'Scenario 1: Where is my order?'],
  ])
  assert.match(a[0].body, /\*\*Support rep \(you\):\*\*/)
  assert.match(a[1].body, /### Inbox Setup/)
})

test('an article says why it may be out of date', async () => {
  const { staleReasons } = await import('./helpCenter.js')
  const looked = new Date(Date.UTC(2026, 10, 21))
  const a = { slug: 'current', body: 'The Christmas cutoff is Dec 13. Delivery is 10 to 12 days since Nov 5, 2026.', reviewedAt: looked, reviewEveryDays: 30 }
  // A week later: nothing yet.
  assert.deepEqual(staleReasons(a, { now: Date.UTC(2026, 10, 28) }), [])
  // Dec 15: the cutoff has passed (Nov 5 was already past when someone last looked, so it is not news).
  assert.deepEqual(staleReasons(a, { now: Date.UTC(2026, 11, 15) }), ['mentions Dec 13, which has passed'])
  // Two months on: overdue too, and a Not right answer that cited it.
  const wrong = [{ createdAt: new Date(Date.UTC(2026, 11, 1)), sources: { articles: [{ slug: 'current' }] } }, { createdAt: new Date(Date.UTC(2026, 11, 2)), sources: { articles: [{ slug: 'other' }] } }]
  assert.deepEqual(staleReasons(a, { now: Date.UTC(2027, 0, 25), wrong }), ['not confirmed in 65 days', 'mentions Dec 13, which has passed', '1 "Not right" answer cited it'])
})

test('an answer is held to one line, a few steps and a reply signed by the rep', () => {
  const a = cleanAnswer({ headline: '**Yes.** Change the size — no need to cancel.', steps: ['1. Click Change size or frame.', '', 'b', 'c', 'd', 'e'], reply: 'Hey Bizzy,\n\nDone!\n\nThanks,\n{{rep}} from Trackstar' }, { repName: 'Carolina' })
  assert.equal(a.headline, 'Yes. Change the size, no need to cancel.')
  assert.deepEqual(a.steps, ['Click Change size or frame.', 'b', 'c', 'd'])
  assert.match(a.reply, /Thanks,\nCarolina from Trackstar$/)
  assert.match(answerText(a), /^Yes\.[^\n]*\n\n1\. Click Change/)
  assert.deepEqual(cleanAnswer(null), { headline: '', steps: [], reply: '', why: '' })
})

test('a playbook card reads into steps, exceptions, replies and details', () => {
  const c = parseCard('1. Do this.\n2. Then that.\n- Only the frame broke? Send Frame only.\n### Reply: First reply\nHey [First name],\n\n1. Not a step\n### Details\na-slug, b-slug')
  assert.deepEqual(c.steps, ['Do this.', 'Then that.'])
  assert.deepEqual(c.notes, ['Only the frame broke? Send Frame only.'])
  assert.equal(c.replies[0].label, 'First reply')
  assert.match(c.replies[0].text, /1\. Not a step$/)
  assert.deepEqual(c.details, ['a-slug', 'b-slug'])
})

test('every card stays one screen: short steps, short replies, nothing a customer should not see', () => {
  for (const t of DEFAULT_TOPICS) {
    const c = parseCard(t.body)
    assert.ok(c.steps.length >= 1 && c.steps.length <= 4, t.title)
    assert.ok(c.notes.length <= 5, t.title)
    assert.ok(c.replies.length >= 1 && c.details.length >= 1, t.title)
    for (const s of [...c.steps, ...c.notes]) assert.ok(s.split(/\s+/).length <= 22, `${t.title}: ${s}`)
    for (const r of c.replies) { assert.doesNotMatch(r.text, /artelo|[—–]/i, t.title); assert.ok(r.text.split(/\s+/).length <= 80, `${t.title}: ${r.label}`) }
  }
})

test('article titles lose their numbering and labels', () => {
  assert.equal(plainTitle('Scenario 2B: Broken Frame (Shattered in Transit) ⚠️ MOST COMMON'), 'Broken Frame')
  assert.equal(plainTitle('Scenario 12: Happy Customer: Ask for Review 🌟'), 'Happy Customer: Ask for Review')
  assert.equal(plainTitle('Shipping'), 'Shipping')
})
