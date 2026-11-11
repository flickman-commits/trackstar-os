import test from 'node:test'
import assert from 'node:assert/strict'
import { extractJson } from '../../lib/llm.js'
import { cadenceFor, pickIdentityTag } from './angles.js'

test('identity tags pick the strongest angle available', () => {
  assert.equal(pickIdentityTag(['Community/Local', 'Premium/Prestige']), 'Premium/Prestige')
  assert.equal(pickIdentityTag(['BQ Favorite', 'Fast/Flat/PR']), 'BQ Favorite')
  assert.equal(pickIdentityTag([]), null)
})

test('each cadence step states its purpose and its follow-up gap', () => {
  for (const pipeline of ['RACE', 'CHARITY']) {
    const cadence = cadenceFor(pipeline)
    // Length is a business decision per pipeline (races run six touches,
    // charities three), so assert the shape rather than a number.
    assert.ok(cadence.length >= 1, `${pipeline} cadence is empty`)
    cadence.forEach((step, i) => {
      assert.equal(step.touch, i + 1, `${pipeline} touch numbers must be sequential`)
      assert.ok(step.purpose.length > 20, `${pipeline} touch ${step.touch} has no purpose`)
      assert.ok(step.nextActionDays > 0, `${pipeline} touch ${step.touch} has no follow-up gap`)
    })
  }
})

test('extractJson survives the ways models wrap JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.'), { a: 1 })
  assert.deepEqual(extractJson('[{"a":1}]'), [{ a: 1 }])
  assert.throws(() => extractJson(''), /empty/)
  assert.throws(() => extractJson('no json at all'), /no JSON/)
})

test('the web search tool version matches what the model can do', async () => {
  const { webSearchToolFor } = await import('../../lib/llm.js')

  // Claude 4.6 and later get dynamic filtering, which keeps irrelevant search
  // results out of the context window.
  for (const m of ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-fable-5-1']) {
    assert.equal(webSearchToolFor(m, 5).type, 'web_search_20260209', m)
  }

  // Older models must use the basic tool called directly. The newer tool
  // defaults to being called from code execution, which they cannot do, and
  // the API answers that with a 400.
  for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5']) {
    const tool = webSearchToolFor(m, 5)
    assert.equal(tool.type, 'web_search_20250305', m)
    assert.deepEqual(tool.allowed_callers, ['direct'], m)
  }

  assert.equal(webSearchToolFor('claude-haiku-4-5', 3).max_uses, 3)
  // An unknown model gets the conservative choice, not the one that 400s.
  assert.equal(webSearchToolFor('some-future-model', 5).type, 'web_search_20250305')
})

test('a mailbox is never used as a first name in a greeting', async () => {
  {
    const { greetingName } = await import('./angles.js')
    assert.equal(greetingName({ firstName: 'lmcelrath', lastName: '', email: 'lmcelrath@akronmarathon.org' }), 'there', 'the local part imported as a name')
    assert.equal(greetingName({ firstName: 'Sam', lastName: 'Lee', email: 'sam@teamfox.org' }), 'Sam', 'a real first name that happens to match the address')
    assert.equal(greetingName({ firstName: 'ellen', lastName: '', email: 'ellen@inmotionevents.com' }), 'there', 'lower case, no surname, same as the address: not trusted')
    assert.equal(greetingName({ firstName: 'Carolyn', lastName: 'Draayer', email: 'cdraayer@brooks.com' }), 'Carolyn')
  }
  const { greetingName } = await import('./angles.js')
  // Real names pass through.
  assert.equal(greetingName({ firstName: 'Kerri', email: 'kerri.powell@themmrf.org' }), 'Kerri')
  assert.equal(greetingName({ firstName: 'Jean-Luc', email: 'jl@x.org' }), 'Jean-Luc')
  // The importer's email-prefix fallback must not reach an email.
  assert.equal(greetingName({ firstName: 'usaf.marathon', email: 'usaf.marathon@us.af.mil' }), 'there')
  assert.equal(greetingName({ firstName: 'info', email: 'info@race.org' }), 'there')
  assert.equal(greetingName({ firstName: 'runner2026', email: 'x@y.org' }), 'there')
  assert.equal(greetingName({ firstName: '', email: 'a@b.org' }), 'there')
  assert.equal(greetingName(null), 'there')
})

// ── Copy rules from the Trackstar Charity Program docs in Notion ─────────────
// These are the mistakes that are expensive and invisible: they read fine and
// have to be walked back on the call, or worse, create a tax problem for the
// charity. Locked down here so an edit to the copy cannot reintroduce them.

const allCopy = async () => {
  const a = await import('./angles.js')
  const strings = []
  for (const pipeline of ['RACE', 'CHARITY']) {
    for (const step of a.cadenceFor(pipeline)) {
      const t = a.templateFor({
        pipeline, angle: step.angle,
        company: { name: 'Test Org', pipeline, identityTags: [], raceDate: null },
        contact: { firstName: 'Sam', email: 'sam@test.org' },
      })
      strings.push({ pipeline, angle: step.angle, ...t })
    }
  }
  return { a, strings }
}

test('no dashes of any kind in copy that goes to a person', async () => {
  const { a, strings } = await allCopy()
  for (const s of strings) {
    assert.ok(!/[—–]/.test(s.subject), `em/en dash in ${s.pipeline} ${s.angle} subject`)
    assert.ok(!/[—–]/.test(s.body), `em/en dash in ${s.pipeline} ${s.angle} body`)
  }
  for (const [tag, fn] of Object.entries(a.RACE_ONE_LINERS)) {
    const line = fn({ name: 'Test Race', city: 'Testville', courseLandmark: 'the bridge' })
    assert.ok(!/[—–]/.test(line), `em/en dash in the "${tag}" one-liner`)
  }
})

test('charity copy never implies money flows back to the charity', async () => {
  const { strings } = await allCopy()
  for (const s of strings.filter(x => x.pipeline === 'CHARITY')) {
    const text = `${s.subject} ${s.body}`.toLowerCase()
    for (const banned of ['revenue share', 'rev share', 'donation back', 'donate back', 'commission', 'share of every', 'percentage of']) {
      assert.ok(!text.includes(banned), `"${banned}" appears in the charity ${s.angle} email. The program deliberately offers none of these.`)
    }
  }
})

test('a charity cold email quotes no price, percentage or minimum', async () => {
  const { strings } = await allCopy()
  for (const s of strings.filter(x => x.pipeline === 'CHARITY')) {
    const text = `${s.subject} ${s.body}`
    assert.ok(!text.includes('$'), `a price appears in the charity ${s.angle} email`)
    assert.ok(!text.includes('%'), `a percentage appears in the charity ${s.angle} email`)
    assert.ok(!/\b50[ -]?unit/i.test(text), `the unit minimum appears in the charity ${s.angle} email`)
  }
})

test('charity outreach says posters, not prints', async () => {
  const { strings } = await allCopy()
  const first = strings.find(s => s.pipeline === 'CHARITY' && s.angle === 'first-touch')
  assert.match(`${first.subject} ${first.body}`, /poster/i)
})

test('the charity cadence is three touches, four days apart', async () => {
  const { a } = await allCopy()
  const cadence = a.cadenceFor('CHARITY')
  assert.equal(cadence.length, 3, 'three touches, then the org is parked')
  for (const step of cadence) assert.equal(step.nextActionDays, 4, `touch ${step.touch} follows up after 4 days`)
})

test('a template with nothing specific to say leaves an obvious blank', async () => {
  const a = await import('./angles.js')
  // No identity tag and no research: there is no honest opening line, so the
  // draft must not look finished.
  const t = a.templateFor({
    pipeline: 'CHARITY', angle: 'first-touch',
    company: { name: 'Test Org', pipeline: 'CHARITY', identityTags: [], raceDate: null },
    contact: { firstName: 'Sam', email: 'sam@test.org' },
  })
  assert.ok(t.body.includes(a.NEEDS_OPENER), 'the opener must be left as a visible placeholder')

  // A real one-liner is used as given.
  const withLine = a.templateFor({
    pipeline: 'RACE', angle: 'first-touch', oneLiner: 'Something true about them.',
    company: { name: 'Test Race', pipeline: 'RACE', identityTags: [], raceDate: null },
    contact: { firstName: 'Sam', email: 'sam@test.org' },
  })
  assert.ok(withLine.body.includes('Something true about them.'))
  assert.ok(!withLine.body.includes(a.NEEDS_OPENER))
})

// ── The message Gmail actually receives ──────────────────────────────────────
// A malformed multipart does not throw, it just renders wrong in someone's
// inbox, so the structure is asserted here rather than discovered later.

test('a message with no attachment is a plain html part', async () => {
  const { buildMime } = await import('./gmail.js')
  const mime = buildMime({ to: 'a@b.org', subject: 'hello', html: '<div>hi</div>' })
  assert.match(mime, /^To: a@b\.org\r\n/)
  assert.match(mime, /Content-Type: text\/html; charset=utf-8/)
  assert.ok(!mime.includes('multipart'), 'no attachment means no multipart wrapper')
})

test('an attached mockup is embedded inline and survives the encoding', async () => {
  const { buildMime } = await import('./gmail.js')
  // A one-pixel PNG: real binary, including bytes that a utf8 round trip would mangle.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const mime = buildMime({
    to: 'a@b.org', subject: 'hello', html: '<div>hi</div>',
    attachment: { filename: 'Berlin_SIR_Mockup.png', contentType: 'image/png', bytes: png },
  })

  const boundary = mime.match(/boundary="([^"]+)"/)?.[1]
  assert.ok(boundary, 'a multipart message needs a boundary')
  assert.match(mime, /Content-Type: multipart\/related;/)
  assert.ok(mime.includes(`--${boundary}--`), 'the multipart must be closed')

  // The html references the image by the same Content-ID the part declares.
  const cid = mime.match(/Content-ID: <([^>]+)>/)?.[1]
  assert.ok(cid, 'the image part needs a Content-ID')
  // The html part is base64 too, so decode it before looking for the reference.
  const htmlPart = mime.split(`--${boundary}`)[1]
  const htmlBody = htmlPart.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim()
  const html = Buffer.from(htmlBody, 'base64').toString('utf8')
  assert.ok(html.includes(`cid:${cid}`), 'the html must reference the image by cid')
  assert.match(html, /<img[^>]+width="600"/, 'the image should be sized for email')
  assert.ok(html.trim().endsWith('</div>'), 'the image goes inside the body wrapper')
  assert.match(mime, /Content-Disposition: inline; filename="Berlin_SIR_Mockup\.png"/)

  // The image bytes come back byte for byte.
  const imagePart = mime.split(`--${boundary}`)[2]
  const payload = imagePart.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n--$/, '').trim()
  assert.deepEqual(Buffer.from(payload, 'base64'), png, 'the attachment must decode back to the original bytes')

  // Every base64 line stays within the 76-character limit MIME requires.
  for (const line of payload.split('\r\n')) {
    assert.ok(line.length <= 76, `base64 line too long: ${line.length}`)
  }
})

// ── What the app refuses to hold, whoever wrote it ───────────────────────────

test('draft guardrails catch the runbook violations', async () => {
  const { draftProblems } = await import('./guardrails.js')
  const ok = { subject: 'Team Fox - personalized marathon posters', body: 'Hey Sam,\n\nSaw your NYC team. Any interest?\n\nMatt' }
  assert.deepEqual(draftProblems(ok, { pipeline: 'CHARITY', touchNumber: 1 }), [])

  const dash = { ...ok, body: 'Hey Sam — quick one.' }
  assert.match(draftProblems(dash, { pipeline: 'RACE', touchNumber: 1 }).join(' '), /dash/)

  const money = { ...ok, body: 'Hey Sam,\n\nWe send a revenue share back to you.\n\nMatt' }
  assert.match(draftProblems(money, { pipeline: 'CHARITY', touchNumber: 2 }).join(' '), /revenue share/)

  const priced = { ...ok, body: 'Hey Sam,\n\nPosters are $64 each at 20% off, 50 unit minimum.\n\nMatt' }
  const p = draftProblems(priced, { pipeline: 'CHARITY', touchNumber: 1 })
  assert.ok(p.some(x => /price/.test(x)) && p.some(x => /percentage/.test(x)) && p.some(x => /minimum/.test(x)))
  // The same numbers are fine on a race email, and fine on a later charity touch.
  assert.deepEqual(draftProblems(priced, { pipeline: 'RACE', touchNumber: 1 }), [])

  const prints = { subject: 'Quick question', body: 'Hey Sam,\n\nWe make marathon prints.\n\nMatt' }
  assert.match(draftProblems(prints, { pipeline: 'CHARITY', touchNumber: 1 }).join(' '), /poster/)

  assert.ok(draftProblems({ subject: '', body: '' }, { pipeline: 'RACE', touchNumber: 1 }).length >= 2)
})

test('generic inboxes are recognised', async () => {
  const { isGenericInbox } = await import('./guardrails.js')
  for (const e of ['info@race.org', 'events@charity.org', 'race@robinhood.org', 'no-reply@x.com']) assert.ok(isGenericInbox(e), e)
  for (const e of ['kerri.powell@themmrf.org', 'jane@acme.org', 'm.hickman@trackstar.art']) assert.ok(!isGenericInbox(e), e)
})

test('the recipient is never presented as an existing partner', async () => {
  const { draftProblems } = await import('./guardrails.js')
  const ctx = { pipeline: 'CHARITY', touchNumber: 2, companyName: 'Michael J. Fox Foundation - Team Fox' }
  const ok = { subject: 'Re: posters', body: 'Hey Jane,\n\nA few partners are using these as a reward for their top fundraisers.\n\nMatt' }
  assert.deepEqual(draftProblems(ok, ctx), [])
  const named = { subject: 'Re: posters', body: 'Hey Jane,\n\nA few Team Fox partners are using these as a reward.\n\nMatt' }
  assert.match(draftProblems(named, ctx).join(' '), /existing partner/)
  const nowUse = { subject: 'Re: posters', body: 'Hey Kelly,\n\nA few Team In Training partners now use these.\n\nMatt' }
  assert.match(draftProblems(nowUse, { ...ctx, companyName: 'Team In Training' }).join(' '), /partner/)
  // Naming a genuine partner in the social proof is fine.
  const real = { subject: 'Re: posters', body: 'Hey Jane,\n\nA few of our partners use these. Marine Corps Marathon finishers ordered 1,000 this season.\n\nMatt' }
  assert.deepEqual(draftProblems(real, ctx), [])
})

// ── What actually leaves the building ────────────────────────────────────────

test('composeHtml puts the signature after the body and before the P.S., and drops a bare sign-off', async () => {
  const { composeHtml } = await import('./drafting.js')
  const sig = '<p>Thanks,</p><p><b>Matt Hickman</b></p>'
  const html = composeHtml('Hey Jane,\n\nQuick one.\n\nWorth a call?\n\nMatt\n\nP.S. Attached an example.', { signature: sig, senderName: 'Matt' })
  const iBody = html.indexOf('Worth a call?')
  const iSig = html.indexOf('Matt Hickman')
  const iPs = html.indexOf('P.S. Attached')
  assert.ok(iBody < iSig && iSig < iPs, 'order must be body, signature, P.S.')
  assert.ok(!/<p>Matt<\/p>/.test(html), 'the bare "Matt" line must not be sent on top of the signature')
  assert.ok(html.includes('Hey Jane,'))
  // No signature configured: nothing is appended, nothing breaks.
  const plain = composeHtml('Hey Jane,\n\nQuick one.', { signature: '' })
  assert.ok(plain.includes('Quick one.') && !plain.includes('margin-top:14px'))
  // Escapes user text but leaves the signature's HTML alone.
  const esc = composeHtml('Hey,\n\n<b>not bold</b>', { signature: '<b>bold</b>' })
  assert.ok(esc.includes('&lt;b&gt;not bold&lt;/b&gt;') && esc.includes('<b>bold</b>'))
})

test('startOfToday respects the business timezone', async () => {
  const { startOfToday } = await import('./settings.js')
  // 03:00 UTC on Sep 11 is still Sep 10 in New York, so "today" starts at Sep 10 04:00 UTC.
  const at = new Date('2026-09-11T03:00:00Z')
  assert.equal(startOfToday('America/New_York', at).toISOString(), '2026-09-10T04:00:00.000Z')
  assert.equal(startOfToday('UTC', at).toISOString(), '2026-09-11T00:00:00.000Z')
})

// ── Attio: reading records and deciding what to write ────────────────────────

test('Attio record values are read whatever their type', async () => {
  const { dealView, personView, companyView } = await import('./attio.js')
  const deal = dealView({
    id: { record_id: 'd1' }, web_url: 'https://app.attio.com/x/deals/d1',
    values: {
      name: [{ value: 'Chicago Marathon' }],
      stage: [{ status: { title: 'Reached Out' } }],
      motion: [{ option: { title: 'Race' } }],
      owner: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: 'm1' }],
      associated_company: [{ target_object: 'companies', target_record_id: 'c1' }],
      associated_people: [{ target_object: 'people', target_record_id: 'p1' }, { target_object: 'people', target_record_id: 'p2' }],
      touch_count: [{ value: 2 }],
      next_action_date: [{ value: '2026-09-20' }],
      value: [{ currency_value: 5000, currency_code: 'USD' }],
    },
  })
  assert.equal(deal.stage, 'Reached Out')
  assert.equal(deal.motion, 'Race')
  assert.equal(deal.ownerId, 'm1')
  assert.equal(deal.companyId, 'c1')
  assert.deepEqual(deal.personIds, ['p1', 'p2'])
  assert.equal(deal.touchCount, 2)
  assert.equal(deal.value, 5000)
  assert.equal(deal.webUrl, 'https://app.attio.com/x/deals/d1')

  const person = personView({
    id: { record_id: 'p1' },
    values: {
      name: [{ first_name: 'Sam', last_name: 'Lee', full_name: 'Sam Lee' }],
      email_addresses: [{ email_address: 'sam@race.org' }, { email_address: 'sam@gmail.com' }],
      job_title: [{ value: 'Race Director' }],
      description: [{ value: 'Runs the marathon since 2019.' }],
      primary_location: [{ locality: 'Chicago', region: 'IL', country_code: 'US' }],
    },
  })
  assert.equal(person.email, 'sam@race.org')
  assert.equal(person.title, 'Race Director')
  assert.equal(person.location, 'Chicago, IL')

  const company = companyView({
    id: { record_id: 'c1' },
    values: {
      name: [{ value: 'Chicago Event Management' }],
      domains: [{ domain: 'www.chicagomarathon.com', root_domain: 'chicagomarathon.com' }],
      categories: [{ option: { title: 'Sports' } }, { option: { title: 'Events' } }],
      last_email_interaction: [{ interaction_type: 'email', interacted_at: '2026-09-10T12:00:00Z' }],
    },
  })
  assert.equal(company.domain, 'chicagomarathon.com')
  assert.deepEqual(company.categories, ['Sports', 'Events'])
  assert.equal(company.lastEmailAt, '2026-09-10T12:00:00Z')
})

test('the next touch comes from Attio\'s touch count and the motion picks the cadence', async () => {
  const { nextStepFor, pipelineOf } = await import('./queue.js')
  assert.equal(pipelineOf({ motion: 'Charity' }), 'CHARITY')
  assert.equal(pipelineOf({ motion: 'Race' }), 'RACE')
  assert.equal(pipelineOf({ motion: 'Corporate' }), 'RACE', 'corporate follows the race cadence until it has its own')
  const t1 = nextStepFor({ motion: 'Charity', touchCount: 0, people: [] })
  assert.equal(t1.touchNumber, 1)
  assert.equal(t1.step.angle, 'first-touch')
  const t3 = nextStepFor({ motion: 'Charity', touchCount: 2, people: [] })
  assert.equal(t3.touchNumber, 3)
  assert.equal(t3.exhausted, false)
  const done = nextStepFor({ motion: 'Charity', touchCount: 3, people: [] })
  assert.equal(done.exhausted, true, 'three charity touches is the whole sequence')
  const race = nextStepFor({ motion: 'Race', touchCount: 5, people: [] })
  assert.equal(race.touchNumber, 6)
  assert.equal(race.exhausted, false)
})

test('a template fills in from the Attio deal and reads in the sender\'s voice', async () => {
  const { buildTemplate } = await import('./drafting.js')
  const { CHARITY_CADENCE, RACE_CADENCE } = await import('./angles.js')
  const deal = { motion: 'Charity', name: 'Team Fox', raceDate: '2026-11-01', company: { name: 'Michael J. Fox Foundation', location: 'New York, NY' }, people: [] }
  const person = { firstName: 'Sam', lastName: 'Lee', email: 'sam@teamfox.org' }
  const t = buildTemplate(deal, person, CHARITY_CADENCE[0], { sender: { name: 'Jimmy', role: 'from Trackstar', story: '' } })
  assert.match(t.body, /^Hey Sam,/)
  assert.ok(t.body.includes("I'm Jimmy, from Trackstar."), 'the who-I-am line carries the rep\'s name')
  assert.ok(!t.body.includes('I ran the NYC Marathon'), 'Matt\'s founder story is not put in another rep\'s mouth')
  assert.ok(t.body.includes('We make personalized marathon posters'), 'the product line stays')
  assert.ok(t.body.includes('Team Fox'))
  assert.ok(t.subject.includes('Team Fox'))
  const r = buildTemplate({ motion: 'Race', name: 'Big Sur Marathon', raceDate: '2027-04-25', people: [] }, person, RACE_CADENCE[2], {})
  assert.ok(r.subject.includes('2027'), 'season year comes from the race date')
})

test('a deck attaches as a file while an image stays inline', async () => {
  const { buildMime } = await import('./gmail.js')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const pdf = Buffer.from('%PDF-1.4 fake', 'latin1')
  const mime = buildMime({
    to: 'a@b.org', subject: 'deck', html: '<div><p>see attached</p>\n</div>',
    attachments: [
      { filename: 'Berlin_Mockup.png', contentType: 'image/png', bytes: png },
      { filename: 'Trackstar_Deck.pdf', contentType: 'application/pdf', bytes: pdf, inline: false },
    ],
  })
  assert.match(mime, /^To: a@b\.org\r\n/)
  assert.match(mime, /Content-Type: multipart\/mixed; boundary="/, 'a file attachment wraps everything in mixed')
  assert.match(mime, /Content-Type: multipart\/related; boundary="/, 'the image still rides inline with the html')
  assert.match(mime, /Content-Disposition: attachment; filename="Trackstar_Deck\.pdf"/)
  assert.match(mime, /Content-Disposition: inline; filename="Berlin_Mockup\.png"/)
  const cid = mime.match(/Content-ID: <([^>]+)>/)[1]
  const htmlB64 = mime.split('Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0]
  assert.ok(Buffer.from(htmlB64.replace(/\r\n/g, ''), 'base64').toString('utf8').includes(`cid:${cid}`), 'the html references the inline image')
  const pdfB64 = mime.split('Content-Disposition: attachment; filename="Trackstar_Deck.pdf"\r\n\r\n')[1].split('\r\n--')[0]
  assert.deepEqual(Buffer.from(pdfB64.replace(/\r\n/g, ''), 'base64'), pdf)
})

test('the library reads the file kind from the type', async () => {
  const { KINDS } = await import('./assets.js')
  assert.equal(KINDS['image/png'], 'image')
  assert.equal(KINDS['application/pdf'], 'deck')
  assert.equal(KINDS['application/vnd.openxmlformats-officedocument.presentationml.presentation'], 'deck')
  assert.equal(KINDS['text/csv'], undefined, 'a spreadsheet is not a sales asset')
})

test('a model-written email gets the first-line blank after the greeting, so it cannot be sent as written', async () => {
  const { withOpenerBlank } = await import('./drafting.js')
  const { NEEDS_OPENER } = await import('./angles.js')
  const out = withOpenerBlank('Hey Sam,\n\nYour course past the river is one of the best in the state.\n\nWe make prints...')
  assert.equal(out.split('\n\n')[1], NEEDS_OPENER)
  assert.equal(withOpenerBlank(out), out)
  assert.ok(withOpenerBlank('We make prints.').startsWith(NEEDS_OPENER))
})

test('a reply from them after our last touch holds the follow-up; our own messages do not', async () => {
  const { replyAfter } = await import('./replies.js')
  const lastTouch = new Date('2026-11-01T15:00:00Z')
  const ours = { id: 'a', labelIds: ['SENT'], date: new Date('2026-11-01T15:00:00Z') }
  const theirsBefore = { id: 'b', labelIds: ['INBOX'], date: new Date('2026-10-28T10:00:00Z') }
  const theirsAfter = { id: 'c', labelIds: ['INBOX'], date: new Date('2026-11-03T09:00:00Z') }
  assert.equal(replyAfter([ours, theirsBefore], lastTouch), null)
  assert.equal(replyAfter([ours, theirsBefore, theirsAfter], lastTouch).id, 'c')
})
