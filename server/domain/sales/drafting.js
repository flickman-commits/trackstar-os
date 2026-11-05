/**
 * Write the next email for a deal, and send the one the rep approves.
 *
 * draftVariants(): works out which touch in the cadence comes next from
 * Attio's touch count, gathers what Attio knows (the person, the company's
 * enrichment, the deal notes, the emails already sent from here), and either
 * fills in the template for that touch or, on a Rewrite, asks the model.
 * Nothing is stored; the variants are for the review screen.
 *
 * sendDraft(): the one act in Sales that reaches another person. Gmail
 * sends as the connected account, the send is logged (thread ids for the
 * next touch, the count for today), and Attio is told: touch count, next
 * action, Reached Out, and a note carrying the email.
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured } from '../../lib/llm.js'
import { cadenceFor, HOUSE_STYLE, CHARITY_RULES, DEFAULT_SOCIAL_PROOF, templateFor, fillTemplate, greetingName, RACE_ONE_LINERS } from './angles.js'
import { loadWorkspace } from './sequences.js'
import { sendMessage, gmailStatus, lineToHtml } from './gmail.js'
import { readAsset, isAssetStorageConfigured, isSalesAssetId } from './assets.js'
import { getSettings, getSenderFor, startOfToday } from './settings.js'
import { getTemplates } from './templates.js'
import { recordSend } from './attio.js'
import { dealForWork, nextStepFor, pipelineOf } from './queue.js'
import { draftProblems, basicProblems } from './guardrails.js'
import { UserError } from './errors.js'

const VARIANT_COUNT = 5

/**
 * The HTML that actually goes out: body, then the signature, then any P.S.,
 * in the reader's default font.
 *
 * A draft ends on the ask; the signature is the sign-off. But a template's
 * P.S. ("attached a co-branded example") belongs after the signature, the
 * way a person writes one, so the body is split there. A trailing bare
 * sign-off in the body is dropped rather than sent twice.
 */
export function composeHtml(body, { signature = '', senderName = 'Matt' } = {}) {
  const paragraphs = String(body || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const psAt = paragraphs.findIndex(p => /^p\.?s\.?[\s:.-]/i.test(p))
  const main = psAt >= 0 ? paragraphs.slice(0, psAt) : paragraphs
  const ps = psAt >= 0 ? paragraphs.slice(psAt) : []
  while (main.length) {
    const last = main[main.length - 1]
    const bare = last.replace(/[,.!]/g, '').trim().toLowerCase()
    const name = senderName.toLowerCase()
    if (bare === name || bare === `thanks\n${name}` || bare === `thanks ${name}` || bare === `best ${name}` || bare === `cheers ${name}`) { main.pop(); continue }
    break
  }
  // Written the way Apple Mail and Gmail write a message: a <div> per line
  // and an empty line between paragraphs, with no font set. The reader's own
  // mail app then shows it in its default font and size, like any email a
  // person typed. Only the signature carries styling, its own.
  const para = t => t.split('\n').map(line => `<div>${lineToHtml(line) || '<br>'}</div>`).join('\n')
  const blank = '<div><br></div>'
  const blocks = [
    ...main.map(para),
    signature ? `<div>${signature}</div>` : '',
    ...ps.map(para),
  ].filter(Boolean)
  return `<div>\n${blocks.join(`\n${blank}\n`)}\n</div>`
}

/** The deal as the template filler expects it (it predates Attio and reads company-ish fields). */
function templateCompany(deal) {
  return {
    name: deal.name || deal.company?.name || '',
    raceDate: deal.raceDate,
    courseLandmark: deal.courseLandmark,
    city: deal.company?.location || null,
  }
}

/**
 * The model-free draft for a step, with Attio's fields filled in.
 *
 * The templates are written in Matt's voice, founder story included. Another
 * rep's first touch keeps the structure and swaps the who-I-am sentence for
 * theirs: their name, their role, their story if they saved one.
 */
export function buildTemplate(deal, person, step, { socialProof, sender, templates, library, variables } = {}) {
  const pipeline = pipelineOf(deal)
  const identity = pipeline === 'RACE' && deal.identity && RACE_ONE_LINERS[deal.identity]
  const oneLiner = step.touch === 1 && identity ? RACE_ONE_LINERS[deal.identity](templateCompany(deal)) : null
  // The sequence step names a library template; that is the copy. Without one
  // (an old setup, a test) the coded copy for the touch applies.
  const chosen = step.templateId && (library || []).find(x => x.id === step.templateId)
  const ctx = { company: templateCompany(deal), contact: person, oneLiner, socialProof, variables: variables || [], senderName: sender?.name || '' }
  const t = chosen
    ? {
        subject: chosen.subject
          ? fillTemplate(chosen.subject, ctx)
          // No subject means "reply on the thread": keep the last one, marked as a reply.
          : `Re: ${String(deal.lastSubject || deal.name || '').replace(/^(re:\s*)+/i, '')}`,
        body: fillTemplate(chosen.body, ctx),
      }
    : templateFor({ pipeline, angle: step.angle, company: templateCompany(deal), contact: person, oneLiner, socialProof, templates })
  if (sender?.name && sender.name !== 'Matt') {
    const intro = `I'm ${sender.name}, ${sender.role || 'from Trackstar'}.${sender.story ? ` ${sender.story}` : ''}`
    t.body = t.body
      .replace(/I'm Matt, founder at Trackstar\. I ran the NYC Marathon[^.]*\./, intro)
      .replace(/I'm Matt, founder at Trackstar\./, intro)
  }
  return t
}

const RACE_CONTEXT = `Trackstar makes personalized race prints in partnership with iconic US marathons: the runner's name, finish time, pace, race-day weather and the course map, on archival paper. Race partners get a co-branded print for their finishers with no work on their side and a revenue share on every order.`

const CHARITY_CONTEXT = `Trackstar makes personalized marathon posters: the runner's name, finish time, pace, race-day weather and the course map, on archival paper, delivered to the runner 10 to 12 days after the race.

The charity program sells these to marathon charity teams, the nonprofits that hold guaranteed race entries and give them to runners in exchange for a fundraising commitment. The pitch is recognition: a way to honour someone who just raised several thousand dollars, and something with the charity's logo on it that keeps them fundraising next year. Trackstar handles the design, the orders and the fulfillment, so it is turnkey for the charity.

Two tiers exist, but a cold email never names either the numbers or the terms. Money never flows back to the charity: there is no revenue share, no commission and no donation-back, deliberately.`

const PR_CONTEXT = `Trackstar makes personalized marathon posters: the runner's name, finish time, pace, race-day weather and the course map, turned into a piece of art. Matt started it after running his first marathons and wanting posters that looked good on a shared wall.

This is press outreach: editors, writers, producers, podcast hosts and the people behind running Instagram pages. They get many pitches and have little time, so the email brings them a ready story. Tie it to something they are already covering (a race weekend, a gift guide, a trend), make it curious or human, and make the ask easy, such as sending them a complimentary poster. Never pad it; never oversell.`

function buildSystem(pipeline, sender) {
  const charity = pipeline === 'CHARITY'
  return `You write cold and follow-up emails for ${sender.name}, ${sender.role}.

${pipeline === 'PR' ? PR_CONTEXT : charity ? CHARITY_CONTEXT : RACE_CONTEXT}

House style, which overrides anything else:
${HOUSE_STYLE.replace(/Write as Matt, founder of Trackstar/, `Write as ${sender.name}, ${sender.role}`)}
${charity ? `\nRules specific to charity outreach, which override the house style where they disagree:\n${CHARITY_RULES}` : ''}

You will be told which touch in the sequence this is and the one point it must make. Every variant makes that point; they differ in angle, opening, and phrasing, not in purpose.`
}

function nextSeasonYear(raceDate) {
  const now = new Date()
  if (!raceDate) return now.getFullYear() + 1
  const d = new Date(raceDate)
  return d > now ? d.getFullYear() : d.getFullYear() + 1
}

/** What the model is told. Everything here comes from Attio or the send log. */
export function buildPrompt({ deal, person, touchNumber, step, previous, socialProof, sender }) {
  const pipeline = pipelineOf(deal)
  const firstName = greetingName(person)
  const org = deal.name || deal.company?.name || 'the organisation'
  const lines = []
  lines.push(`Touch ${touchNumber} of ${cadenceFor(pipeline).length}. Angle: ${step.angle}.`)
  lines.push(`Point this email must make: ${step.purpose}`)
  lines.push(`Subject line rule: ${step.subject.replace('[Race Name]', org).replace('[Org Name]', org).replace('[next season year]', String(nextSeasonYear(deal.raceDate)))}`)
  lines.push('')
  lines.push(`Recipient: ${firstName} ${person?.lastName || ''}`.trim() + (person?.title ? `, ${person.title}` : ''))
  if (firstName === 'there') lines.push('We do not know this person\'s name. Greet them as "Hey there," and never guess a name.')
  if (person?.description) lines.push(`About the person (from the CRM): ${person.description}`)
  if (person?.location) lines.push(`Their location: ${person.location}`)
  lines.push(`Organisation: ${org}${deal.company?.location ? ` (${deal.company.location})` : ''}`)
  if (deal.company?.description) lines.push(`About the organisation (from the CRM): ${deal.company.description}`)
  if (deal.company?.categories?.length) lines.push(`Categories: ${deal.company.categories.join(', ')}`)
  if (deal.company?.employeeRange) lines.push(`Size: ${deal.company.employeeRange} people`)
  if (pipeline === 'RACE') {
    if (deal.runners) lines.push(`Field size: about ${Number(deal.runners).toLocaleString()} runners`)
    if (deal.raceDate) lines.push(`Race date: ${new Date(deal.raceDate).toDateString()}`)
    if (deal.identity && RACE_ONE_LINERS[deal.identity] && touchNumber === 1) {
      lines.push(`Identity: ${deal.identity}. Open the body with this line, verbatim or lightly adapted: "${RACE_ONE_LINERS[deal.identity](templateCompany(deal))}"`)
    }
    if (deal.courseLandmark) lines.push(`Course landmark: ${deal.courseLandmark}`)
    else if (step.angle === 'course-landmark') lines.push('No course landmark is on file. Use the most distinctive thing about the course you can infer from the organisation description, or the finish line, and name it specifically.')
  } else {
    if (deal.sizeTier) lines.push(`Size tier: ${deal.sizeTier}`)
    if (deal.runners) lines.push(`Charity team size: about ${Number(deal.runners).toLocaleString()} runners`)
    if (deal.raceDate) lines.push(`Race date: ${new Date(deal.raceDate).toDateString()}`)
  }
  if (step.angle === 'social-proof') lines.push(`Social proof to use: ${socialProof}`)
  if (sender?.story && touchNumber === 1) lines.push(`Sender's story, for the who-I-am line: ${sender.story}`)
  if (deal.notes) lines.push(`Deal notes (written by the team; use what is relevant, never recite): ${deal.notes}`)
  if (previous.length) {
    lines.push('')
    lines.push('Emails already sent in this sequence (do not repeat their wording):')
    for (const t of previous) lines.push(`--- Touch ${t.touchNumber} · subject: ${t.subject}\n${(t.body || '').slice(0, 800)}`)
  }
  lines.push('')
  lines.push(`Write ${VARIANT_COUNT} variants. Return JSON: {"variants":[{"subject":"...","body":"..."}]} with exactly ${VARIANT_COUNT} items.`)
  return lines.join('\n')
}

/**
 * @returns {Promise<{ touchNumber, step, exhausted, variants, personId, dealId, model, source, warning? }>}
 */
export async function draftVariants({ dealId, personId, useTemplate = false, actor }) {
  // Everything a draft needs, read at once rather than one after another.
  const [deal, settings, sender, templates, workspace] = await Promise.all([
    dealForWork(dealId),
    getSettings(),
    getSenderFor(actor?.id, actor),
    getTemplates(),
    loadWorkspace(),
  ])
  const library = workspace.templates
  const variables = workspace.variables
  const person = (personId && deal.people.find(p => p.id === personId)) || deal.person
  if (!person) throw new UserError('This deal has nobody to write to. Add a person to it in Attio.')
  const { touchNumber, step, exhausted } = nextStepFor(deal)
  // Social Proof is a variable now; the old setting is only a fallback.
  const socialProof = variables.find(v => v.name.toLowerCase() === 'social proof')?.value || settings.socialProof || DEFAULT_SOCIAL_PROOF
  // Images the step's template carries, attached in the composer like a chip you added.
  const templateAssetIds = (step?.templateId && library.find(t => t.id === step.templateId)?.assetIds) || []
  const base = { touchNumber, step, exhausted, personId: person.id, dealId: deal.id, templateAssetIds }

  if (useTemplate || !isLlmConfigured()) {
    return { ...base, variants: [buildTemplate(deal, person, step, { socialProof, sender, templates, library, variables })], model: 'template', source: 'template' }
  }

  const previous = deal.sends.map(s => ({ touchNumber: s.touchNumber, subject: s.subject, body: s.body }))
  let json, model, provider
  try {
    ({ json, model, provider } = await complete({
      system: buildSystem(pipelineOf(deal), sender),
      prompt: buildPrompt({ deal, person, touchNumber, step, previous, socialProof, sender }),
      json: true,
      effort: 'low',
      maxTokens: 3000,
      cacheSystem: true,
      purpose: `sales.draft.t${touchNumber}`,
    }))
  } catch (err) {
    console.warn(`[sales.draft] model failed (${err.message}); falling back to the template`)
    return { ...base, variants: [buildTemplate(deal, person, step, { socialProof, sender, templates, library, variables })], model: 'template', source: 'template', warning: 'Wrote this from the template: the model did not answer.' }
  }

  const raw = Array.isArray(json?.variants) ? json.variants : Array.isArray(json) ? json : []
  const variants = raw
    .map(v => ({ subject: String(v.subject || '').trim(), body: String(v.body || '').trim() }))
    .filter(v => v.subject && v.body)
    .slice(0, VARIANT_COUNT)
  if (!variants.length) throw new UserError('The model returned no usable variants')
  return { ...base, variants, model: `${provider}/${model}`, source: 'model' }
}

/**
 * Rewrite one draft to an instruction ("shorter", "mention their Boston
 * team", "less salesy"). The house rules still apply; the server checks the
 * result the same as any other draft before it can go.
 */
export async function reviseDraft({ dealId, subject, body, instruction, actor }) {
  if (!isLlmConfigured()) throw new UserError('No model is configured. Edit the draft by hand.')
  const deal = await dealForWork(dealId)
  const { touchNumber, step } = nextStepFor(deal)
  const sender = await getSenderFor(actor?.id, actor)
  const { json, model, provider } = await complete({
    system: buildSystem(pipelineOf(deal), sender),
    prompt: [
      `Touch ${touchNumber}. Angle: ${step.angle}. Point it must make: ${step.purpose}`,
      `Recipient: ${greetingName(deal.person)} at ${deal.name}.`,
      '',
      'Current draft:',
      `Subject: ${subject}`,
      body,
      '',
      `Rewrite it to this instruction, keeping everything else that works: ${instruction}`,
      'Return JSON: {"subject":"...","body":"..."}',
    ].join('\n'),
    json: true,
    effort: 'low',
    maxTokens: 1200,
    cacheSystem: true,
    purpose: 'sales.revise',
  })
  const out = { subject: String(json?.subject || subject).trim(), body: String(json?.body || '').trim() }
  if (!out.body) throw new UserError('The model returned nothing usable')
  return { ...out, model: `${provider}/${model}` }
}

/**
 * Touches whose copy points at an attached example, so sending one without
 * an image would send a promise the message does not keep. The charity
 * runbook puts it plainly: no attachment, no send.
 */
export function requiresImage(pipeline, touchNumber) {
  return pipeline === 'CHARITY' && touchNumber === 1
}

/**
 * The attachment ids the page sent, each one checked to be a file in the
 * sales library. The ids come from the browser, and storage can read every
 * bucket the project has, so anything else is refused, not skipped.
 */
export function libraryIds(assetIds) {
  const ids = [...new Set((assetIds || []).map(String).filter(Boolean))]
  if (ids.some(id => !isSalesAssetId(id))) throw new UserError('One of the attachments is not in the sales library. Remove it and drag it in from the library again.')
  return ids
}

/**
 * The daily cap, held here and not only on the page: how many emails this
 * rep has sent today, against the workspace cap. Raise the cap in Settings
 * to send more.
 */
export async function assertUnderDailyCap(actor) {
  const settings = await getSettings()
  const sent = await prisma.salesSend.count({ where: { sentById: actor.id, sentAt: { gte: startOfToday(settings.timezone) } } })
  if (sent >= settings.dailyCap) {
    throw new UserError(`That is ${settings.dailyCap} for today, the workspace cap. Raise it in Settings if you mean to send more.`)
  }
}

/**
 * Send it. The house-rule checks, then Gmail, then the log,
 * then Attio. The undo window happens in the client; here the decision is
 * final.
 */
/**
 * `adhoc` is a rep writing to a deal outside the queue: any stage, any
 * point in the sequence. It still logs, still tells Attio, still moves Not
 * Contacted to Reached Out; it just does not stamp a next action, because
 * a person chose to write and knows what comes next.
 */
export async function sendDraft({ dealId, personId, subject, body, assetIds = [], actor, adhoc = false }) {
  if (!actor?.id) throw new UserError('Sending needs a signed-in person with a connected Gmail')
  if (!subject?.trim() || !body?.trim()) throw new UserError('Subject and body are required')
  const deal = await dealForWork(dealId, { fresh: true })
  const person = (personId && deal.people.find(p => p.id === personId)) || deal.person
  if (!person) throw new UserError('This deal has nobody to write to')
  if (!person.email) throw new UserError(`${person.fullName || 'This person'} has no email address in Attio`)
  if (!adhoc && !['Not Contacted', 'Needs Enrichment', 'Reached Out'].includes(deal.stage)) {
    throw new UserError(`${deal.name} is at ${deal.stage}. The sequence only runs up to Reached Out; use New email to write to them.`)
  }

  const status = await gmailStatus(actor.id)
  if (!status.connected) throw new UserError('Gmail is not connected. Open Settings and press Connect Gmail.')

  const { touchNumber: nextTouch, step, exhausted } = nextStepFor(deal)
  if (exhausted && !adhoc) throw new UserError(`${deal.name} has finished its sequence. Change its stage in Attio instead of sending another touch.`)
  // Past the cadence, an ad hoc email still counts as one more touch.
  const touchNumber = exhausted ? deal.touchCount + 1 : nextTouch
  const pipeline = pipelineOf(deal)

  const problems = draftProblems({ subject, body }, { pipeline, touchNumber, companyName: deal.name })
  if (problems.length) throw new UserError(problems[0], { problems })
  const ids = libraryIds(assetIds)
  // The cap is on starting conversations, as on the Sales page: the day's
  // sends fill it, but only a first touch is held back by it. Follow-ups and
  // one-off emails are never capped.
  if (touchNumber === 1 && !adhoc) await assertUnderDailyCap(actor)

  // Follow-ups reply in the thread of the first send when the step says so.
  let threadId = null
  let inReplyTo = null
  if (touchNumber > 1 && /reply in thread/i.test(step.subject)) {
    const firstSend = deal.sends.find(s => s.gmailThreadId)
    threadId = firstSend?.gmailThreadId || null
    inReplyTo = (await prisma.salesSend.findFirst({ where: { attioDealId: deal.id, rfcMessageId: { not: null } }, orderBy: { sentAt: 'asc' } }))?.rfcMessageId || null
  }

  // Attachments: exactly what the rep chose, nothing else. A touch whose copy
  // points at an example is blocked below rather than quietly given one, so
  // removing an attachment in the composer actually removes it.
  const attachments = []
  const attached = []
  if (isAssetStorageConfigured()) {
    for (const id of ids) {
      const a = await readAsset(id)
      attachments.push(a)
      attached.push(id)
    }
  }
  if (requiresImage(pipeline, touchNumber) && !attachments.some(a => a.inline)) {
    throw new UserError('A charity first touch has to carry a co-branded example. Drag one in from the library, then send again.')
  }
  const total = attachments.reduce((n, a) => n + a.bytes.length, 0)
  if (total > 18 * 1024 * 1024) throw new UserError('Attachments add up to more than 18 MB, which Gmail will bounce. Drop one.')

  const sender = await getSenderFor(actor.id, actor)
  const html = composeHtml(body, { signature: sender.signature, senderName: sender.name })
  const sent = await sendMessage({ userId: actor.id, to: person.email, subject: subject.trim(), html, threadId, inReplyTo, attachments })

  const now = new Date()
  const cadence = cadenceFor(pipeline)
  const nextActionDate = adhoc ? null : new Date(now.getTime() + step.nextActionDays * 86400000)
  const nextAction = adhoc ? null : touchNumber >= cadence.length
    ? (pipeline === 'PR' ? 'No reply after the follow-up: move to Revisit Next Year or pitch a new story' : 'Sequence complete: decide next year vs. lost')
    : `Send touch ${touchNumber + 1}: ${cadence[touchNumber].angle}`

  const sync = await recordSend(deal, {
    sentAt: now, touchNumber, nextAction, nextActionDate,
    subject: subject.trim(), body: body.trim(), toEmail: person.email, sentBy: actor.email,
  })

  const send = await prisma.salesSend.create({
    data: {
      attioDealId: deal.id,
      attioPersonId: person.id,
      toEmail: person.email,
      touchNumber,
      angle: adhoc ? 'adhoc' : step.angle,
      subject: subject.trim(),
      body: body.trim(),
      attachments: attached,
      gmailMessageId: sent.gmailMessageId,
      gmailThreadId: sent.threadId,
      rfcMessageId: sent.rfcMessageId,
      sentAt: now,
      sentById: actor.id,
      sentByEmail: actor.email || null,
      attioOk: Boolean(sync.ok),
      attioError: sync.ok ? null : (sync.error || sync.skipped || null),
    },
  })
  await prisma.salesSkip.deleteMany({ where: { attioDealId: deal.id } })

  return { send: { id: send.id, touchNumber, sentAt: now, gmailThreadId: sent.threadId }, attached, sync }
}

/**
 * A one-off email to an address with no deal behind it. Same mailbox, same
 * signature, same attachments and undo; logged so "sent today" is right;
 * nothing written to Attio because there is nothing to write it to. The
 * basic rules still hold (no dashes, no blank left from a template) and so
 * does the daily cap; the pipeline rules do not, since this is not a
 * cadence email.
 */
export async function sendFree({ to, subject, body, assetIds = [], actor }) {
  if (!actor?.id) throw new UserError('Sending needs a signed-in person with a connected Gmail')
  const address = String(to || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new UserError('That is not an email address')
  if (!subject?.trim() || !body?.trim()) throw new UserError('Subject and body are required')
  const problems = basicProblems({ subject, body })
  if (problems.length) throw new UserError(problems[0], { problems })
  const ids = libraryIds(assetIds)
  const status = await gmailStatus(actor.id)
  if (!status.connected) throw new UserError('Gmail is not connected. Open Settings and press Connect Gmail.')

  const attachments = []
  const attached = []
  for (const id of ids) {
    if (!isAssetStorageConfigured()) break
    attachments.push(await readAsset(id)); attached.push(id)
  }
  if (attachments.reduce((n, a) => n + a.bytes.length, 0) > 18 * 1024 * 1024) throw new UserError('Attachments add up to more than 18 MB, which Gmail will bounce. Drop one.')

  const sender = await getSenderFor(actor.id, actor)
  const html = composeHtml(body, { signature: sender.signature, senderName: sender.name })
  const sent = await sendMessage({ userId: actor.id, to: address, subject: subject.trim(), html, attachments })
  const now = new Date()
  const send = await prisma.salesSend.create({
    data: {
      attioDealId: null, attioPersonId: null, toEmail: address, touchNumber: 0, angle: 'free',
      subject: subject.trim(), body: body.trim(), attachments: attached,
      gmailMessageId: sent.gmailMessageId, gmailThreadId: sent.threadId, rfcMessageId: sent.rfcMessageId,
      sentAt: now, sentById: actor.id, sentByEmail: actor.email || null, attioOk: true,
    },
  })
  return { send: { id: send.id, touchNumber: 0, sentAt: now, gmailThreadId: sent.threadId }, attached, sync: { ok: true } }
}

/** What would stop this draft going, as plain reasons. Empty means it passes. */
export async function checkDraft({ dealId, subject, body }) {
  const deal = await dealForWork(dealId)
  const { touchNumber } = nextStepFor(deal)
  return { touchNumber, problems: draftProblems({ subject, body }, { pipeline: pipelineOf(deal), touchNumber, companyName: deal.name }) }
}
