/**
 * The angle library: what Trackstar says to whom, and when.
 *
 * Ported from the outreach-batch-drafter skill so the tool and the runbook
 * agree. Everything here is content, not code: edit the strings freely.
 *
 * Race pipeline: a one-liner keyed on the race's identity tag opens the first
 * email, then a six-touch cadence with a fixed purpose per touch. The model
 * writes the words; this file decides the point each email has to make.
 *
 * Charity pipeline: the same shape with its own angles. The charity program
 * offers a co-branded print to an organisation's runners with a share of
 * every order going to the cause.
 */

/** Race identity tag -> opening line. Priority order matters when a race has several. */
export const RACE_IDENTITY_PRIORITY = [
  'Premium/Prestige', 'BQ Favorite', 'Scenic/Destination', 'Fast/Flat/PR',
  'Large Series', 'Non-profit/Mission', 'Community/Local', 'New/Growing',
]

export const RACE_ONE_LINERS = {
  'BQ Favorite': r => `${r.name} is one of the most iconic BQ courses in the country, and your finishers earn that.`,
  'Fast/Flat/PR': r => `Runners come to ${r.name} to chase PRs, and we help them remember the ones they catch.`,
  'Scenic/Destination': r => `From ${r.courseLandmark || 'the start'} to the finish line, ${r.name} is one of the most photogenic courses we've seen.`,
  'Non-profit/Mission': r => `${r.name} runners aren't just crossing a finish line, they're running for something bigger.`,
  'Large Series': r => `${r.name} is one of the marquee events in its series, and we'd love to be part of it.`,
  'Premium/Prestige': r => `${r.name} is a bucket-list race for a reason, and your finishers deserve something worth keeping.`,
  'Community/Local': r => `${r.name} is the heart of ${r.city || 'its city'}'s running community, and we want to help your finishers celebrate that.`,
  'New/Growing': r => `${r.name} is building something special, and we'd love to be part of the next chapter.`,
}

/** Pick the single strongest tag the race carries, or null. */
export function pickIdentityTag(tags = []) {
  for (const t of RACE_IDENTITY_PRIORITY) if (tags.includes(t)) return t
  return tags[0] || null
}

/**
 * Six touches. `days` is the gap after the previous touch; `subject` is a
 * rule for the model, not literal copy, except where it says so.
 */
export const RACE_CADENCE = [
  {
    touch: 1, days: 0, angle: 'first-touch',
    purpose: 'Introduce Trackstar in one breath: custom race prints in partnership with iconic US marathons. Open with the identity one-liner. Offer a mockup with their logo and course map. Ask for a quick chat.',
    subject: `Attached: custom race prints for [Race Name] finishers`,
    nextActionDays: 3,
  },
  {
    touch: 2, days: 3, angle: 'course-landmark',
    purpose: 'Name one specific course landmark and say it would make an incredible focal point for their race print. Reference recent work for CIM and Illinois. Ask for a quick chat.',
    subject: 'Re: the original subject (reply in thread)',
    nextActionDays: 4,
  },
  {
    touch: 3, days: 4, angle: 'do-you-have-this-covered',
    purpose: 'Two sentences. Quick check-in as their season ramps up: do they already have race print production handled this year?',
    subject: `Quick question for [Race Name] [next season year]`,
    nextActionDays: 7,
  },
  {
    touch: 4, days: 7, angle: 'social-proof',
    purpose: 'Lead with the social proof numbers provided. Say their runners would love these. Ask if a quick call is worth it.',
    subject: `What we're seeing this season`,
    nextActionDays: 7,
  },
  {
    touch: 5, days: 7, angle: 'marquee-feature',
    purpose: 'Offer to feature their race as the next marquee race on the Trackstar website, highlighting a print with their logo and course map. Ask for a quick call.',
    subject: `[Race Name] on Trackstar`,
    nextActionDays: 7,
  },
  {
    touch: 6, days: 7, angle: 'better-person',
    purpose: 'One line. Is there a better person on their team to talk to about a race print partnership?',
    subject: 'Re: the original subject (reply in thread)',
    nextActionDays: 7,
  },
]

/**
 * Charity: three touches, four days apart, then park it.
 *
 * Shorter and slower than the race cadence on purpose. The runbook is explicit:
 * follow up four days after each touch, and after three touches with no reply
 * move the org to Passed and move on. Charity staff are a small world and a
 * six-email sequence to someone who is not interested costs more than it wins.
 */
export const CHARITY_CADENCE = [
  {
    touch: 1, days: 0, angle: 'first-touch',
    purpose: [
      'Five short paragraphs, in this order.',
      '1. One line that is specific and true about THEIR team. Use the research. Never a generic opener and never a pitch.',
      '2. Who I am: I ran the NYC Marathon with New York Urban League two years ago, had a great experience, and that is what made me start Trackstar. We make personalized marathon posters and work with 20 race partners now.',
      '3. The offer in one sentence: we opened a charity program this year and I would like this team in it. It costs them nothing to get started, and there is a co-branded tier if they want their logo built into the design.',
      '4. One ask: any interest in being part of the pilot.',
      '5. A P.S. pointing at the attached co-branded example.',
    ].join('\n'),
    subject: '[Team Name] - personalized marathon posters',
    nextActionDays: 4,
  },
  {
    touch: 2, days: 4, angle: 'recognition',
    purpose: [
      'Short. Lead with what we learned from other charity teams: the runners who need something are the ones who already hit their fundraising minimum and have nothing left to chase.',
      'Say a few partners use these as a reward for their top fundraisers, which costs the charity nothing to set up.',
      'Say "a few partners", exactly that. NEVER name the recipient\'s own team or org as one of those partners: they are the prospect, not a partner, and "a few Team Fox partners use these" is a false claim to Team Fox.',
      'Recognition, not an incentive. Do not say "raise $X and get one".',
      'One ask: worth a quick call.',
    ].join('\n'),
    subject: 'Re: the original subject (reply in thread)',
    nextActionDays: 4,
  },
  {
    touch: 3, days: 4, angle: 'better-person',
    purpose: [
      'Two or three lines, and say plainly this is the last one.',
      'Ask whether someone else on their team handles runner rewards.',
      'Offer to leave it if the timing is wrong. No new pitch, no numbers.',
    ].join('\n'),
    subject: 'Re: the original subject (reply in thread)',
    nextActionDays: 4,
  },
]

/**
 * PR: a pitch and one follow-up, then stop. Editors and page owners get a lot
 * of these; a second nudge is polite, a third is noise. The story itself
 * comes from a saved template (Templates menu), not from here.
 */
export const PR_CADENCE = [
  {
    touch: 1, days: 0, angle: 'pitch',
    purpose: 'The pitch. One story, told for this outlet and its audience. Why it matters to their readers now. One easy ask, like sending a complimentary poster.',
    subject: 'A clear, specific subject about the story, not about Trackstar',
    nextActionDays: 4,
  },
  {
    touch: 2, days: 4, angle: 'follow-up',
    purpose: 'Two or three lines on the same thread. A short nudge in case it got buried, restate the easy ask. No new pitch.',
    subject: 'Re: the original subject (reply in thread)',
    nextActionDays: 14,
  },
]

/**
 * The saved sequences (sequences.js), once loaded. Until then, and for any
 * pipeline with none saved, the coded cadences above apply.
 */
let LIVE = null
export function setLiveCadences(cadences) { LIVE = cadences }

export function cadenceFor(pipeline) {
  if (LIVE?.[pipeline]?.length) return LIVE[pipeline]
  if (pipeline === 'PR') return PR_CADENCE
  return pipeline === 'CHARITY' ? CHARITY_CADENCE : RACE_CADENCE
}

/**
 * The same emails, written out longhand.
 *
 * A model turns these into something that sounds like it was written for one
 * person. Without a model they are still a real first draft - they are the
 * copy the outreach runbook used before any of this was automated - so the
 * tool keeps working when no model is configured or the account runs dry.
 * Fill in the blanks, edit in the composer, file it to Gmail.
 */

/**
 * What to write after "Hey".
 *
 * Names come from Attio's person record. When someone saved a mailbox as a
 * name ("usaf.marathon", "info") the greeting is worse than none, so anything
 * that reads like an address rather than a person becomes "there". A first
 * name that happens to match the local part ("sam@teamfox.org") is fine.
 */
export function greetingName(contact) {
  return looksLikeMailbox(contact) ? 'there' : (contact?.firstName || '').trim()
}

/**
 * Whether the "name" on a person is really their mailbox. Two tells: it is
 * the local part of their own address ("lmcelrath" for lmcelrath@akron...)
 * with no surname or no capital letter, or it is a role inbox word. "Sam"
 * at sam@teamfox.org, capitalised with a surname, is a person.
 */
export function looksLikeMailbox(contact) {
  const raw = (contact?.firstName || '').trim()
  if (!raw) return true
  const local = (contact?.email || '').split('@')[0].toLowerCase()
  const sameAsLocal = local && raw.toLowerCase() === local
  const hasSurname = Boolean((contact?.lastName || '').trim())
  const capitalised = /^[A-Z]/.test(raw)
  return /[.@_\d]/.test(raw)
    || /^(info|hello|contact|events|race|team|admin|office|marketing|press|sponsorship|development)$/i.test(raw)
    || (sameAsLocal && (!hasSurname || !capitalised))
    || raw.length < 2
    || raw.length > 20
}

/**
 * The unmissable placeholder for the one line a template can never write.
 * Square brackets and capitals so it cannot be mistaken for finished copy,
 * and so a draft carrying it is easy to spot in Gmail before sending.
 */
export const NEEDS_OPENER = '[WRITE YOUR FIRST LINE: something specific and true about them. Never send this generic.]'

/** `[Race Name]` and friends, filled in from the row; then any custom variables. */
function fill(text, { company, contact, socialProof, oneLiner, variables = [], senderName = '' }) {
  const seasonYear = (() => {
    const now = new Date()
    if (!company.raceDate) return now.getFullYear() + 1
    const d = new Date(company.raceDate)
    return d > now ? d.getFullYear() : d.getFullYear() + 1
  })()
  return text
    .replaceAll('[First Name]', greetingName(contact))
    .replaceAll('[Race Name]', company.name)
    .replaceAll('[Org Name]', company.name)
    .replaceAll('[Team Name]', company.name)
    .replaceAll('[Landmark]', company.courseLandmark || 'Your finish line')
    .replaceAll('[Season Year]', String(seasonYear))
    // Social Proof is a variable you set; the old setting and default are fallbacks.
    .replaceAll('[Social Proof]', variables.find(v => v.name.toLowerCase() === 'social proof')?.value || socialProof || DEFAULT_SOCIAL_PROOF)
    // "Never send a generic first line" is a hard rule, and a template cannot
    // know anything specific about this org. So when there is no real opener
    // to fill in, leave a blank that is obviously unfinished rather than a
    // plausible sentence someone might send by accident.
    .replaceAll('[One-liner]', oneLiner || NEEDS_OPENER)
    // The first line is always the person's to write.
    .replaceAll('[First line]', NEEDS_OPENER)
    .replace(/\[Your name\]/gi, senderName)
    .replace(/\[([A-Za-z][A-Za-z0-9 '-]*)\]/g, (whole, name) => {
      const v = variables.find(x => x.name.toLowerCase() === name.toLowerCase())
      return v ? v.value : whole
    })
}

/** fill(), for a template from the library. */
export function fillTemplate(text, ctx) { return fill(String(text || ''), ctx) }

export const RACE_TEMPLATES = {
  'first-touch': {
    subject: 'Custom race prints for [Race Name] finishers',
    body: `Hey [First Name],\n\n[One-liner]\n\nI'm Matt, founder at Trackstar. We make custom race prints in partnership with iconic US marathons: the runner's name, time and your course map, on something they actually hang up.\n\nHappy to put together a mockup with your logo and course so you can see it.\n\nWorth a quick chat?`,
  },
  'course-landmark': {
    subject: 'Re: [Race Name] prints',
    body: `Hey [First Name],\n\n[Landmark] would make an incredible focal point for a [Race Name] print. That is the bit finishers photograph, and it is the bit that makes a poster worth wall space.\n\nI can show you what that looks like on paper.\n\nOpen to a quick call?`,
  },
  'do-you-have-this-covered': {
    subject: 'Quick question for [Race Name] [Season Year]',
    body: `Hey [First Name],\n\nQuick one as your [Season Year] season ramps up: do you already have finisher prints handled?`,
  },
  'social-proof': {
    subject: "What we're seeing this season",
    body: `Hey [First Name],\n\n[Social Proof]\n\nI think [Race Name] runners would go for these too. Worth fifteen minutes?`,
  },
  'marquee-feature': {
    subject: '[Race Name] on Trackstar',
    body: `Hey [First Name],\n\nI'd like to feature [Race Name] as our next marquee race, with a print built around your logo and course map.\n\nCan we find time this week?`,
  },
  'better-person': {
    subject: 'Re: [Race Name] prints',
    body: `Hey [First Name],\n\nIs there a better person on your team to talk to about a finisher print partnership?`,
  },
}

export const CHARITY_TEMPLATES = {
  'first-touch': {
    subject: '[Org Name] - personalized marathon posters',
    body: `Hey [First Name],\n\n[One-liner]\n\nI'm Matt, founder at Trackstar. I ran the NYC Marathon with New York Urban League two years ago and had a wonderful experience, which is actually what made me start this company. We make personalized marathon posters, and we work with 20 race partners now.\n\nWe just opened up a charity program this year and I'd love to have [Org Name] in it. It costs you nothing to get started, and there's a co-branded tier if you want your logo built into the design like the one attached.\n\nAny interest in being part of the pilot? Happy to hop on a quick call.\n\nP.S. Attached a co-branded example so you can see what these look like with a charity logo built in.`,
  },
  'recognition': {
    subject: 'Re: [Org Name] posters',
    body: `Hey [First Name],\n\nOne thing we keep hearing from charity teams: the runners who need something are the ones who already hit their minimum and have nothing left to chase.\n\nA few partners are using these as a reward for their top fundraisers for exactly that reason. Costs nothing on your end to set up.\n\nWorth a quick call?`,
  },
  'better-person': {
    subject: 'Re: [Org Name] posters',
    body: `Hey [First Name],\n\nLast one from me. Is there someone else on your team who handles runner rewards for [Org Name]?\n\nHappy to leave it here if the timing isn't right.`,
  },
}

/**
 * PR sequence copy. The pitch is a blank on purpose: every PR email starts
 * from a story, picked from the Templates menu. The guardrails refuse to send
 * the blank.
 */
export const PR_TEMPLATES = {
  'pitch': {
    subject: '[Subject]',
    body: `Hey [First Name],\n\n[Pick a story from the Templates menu, or write the pitch here.]`,
  },
  'follow-up': {
    subject: 'Re: [Org Name]',
    body: `Hey [First Name],\n\nFollowing up on my note below in case it got buried. I would love to send you a complimentary poster so you can see it for yourself.\n\nJust let me know!`,
  },
}

/**
 * A ready-to-edit draft for one step, with no model involved.
 * Returns { subject, body } always, so the composer is never empty.
 */
/** The placeholders a template may use, for the editor's legend. */
export const TEMPLATE_PLACEHOLDERS = [
  ['[First Name]', 'the person\'s first name from Attio, or "there"'],
  ['[Race Name]', 'the deal name (races)'],
  ['[Org Name]', 'the deal name (charities, and the outlet for PR)'],
  ['[Team Name]', 'the same as [Org Name]'],
  ['[Landmark]', 'the course landmark if the deal has one, else "Your finish line"'],
  ['[Season Year]', 'the year of the next edition, from the race date'],
  ['[Social Proof]', 'the social proof line from Settings'],
  ['[One-liner]', 'the opening line: a race identity line if there is one, else a visible blank to fill in'],
]

/**
 * `templates` is the live table (defaults with any edits made in Settings);
 * without it the code defaults apply.
 */
export function templateFor({ pipeline, angle, company, contact, socialProof, oneLiner, templates }) {
  const table = (templates && templates[pipeline]) || (pipeline === 'PR' ? PR_TEMPLATES : pipeline === 'CHARITY' ? CHARITY_TEMPLATES : RACE_TEMPLATES)
  const t = table[angle] || table['first-touch']
  const ctx = { company, contact, socialProof, oneLiner }
  return { subject: fill(t.subject, ctx), body: fill(t.body, ctx) }
}

/** Rules every draft follows, regardless of touch. Read by the model verbatim. */
export const HOUSE_STYLE = `
- Write as Matt, founder of Trackstar. First person singular.
- Do NOT write a sign-off or a name at the end. The signature block ("Thanks, Matt Hickman...") is added automatically when the email is sent. End on the ask.
- A P.S., if the template has one, is the last paragraph and starts with "P.S.".
- Open with "Hey [First Name]," on its own line, then a blank line.
- NEVER use an em dash or an en dash. Not once, anywhere. Use a comma, a full stop, or rewrite the sentence.
- Under 120 words. Shorter is better on every follow-up.
- Short paragraphs, one idea each. No bullet points.
- Contractions, short sentences, slightly loose. If it reads like marketing copy, rewrite it.
- No "I hope you're well", no "I'd love to" as an opener, no "inspiring", no exclamation marks beyond one.
- The opening line must be something specific and true about THEM. Never a generic opener.
- Mention research only where it is relevant. Never recite facts back at them.
- ONE ask, at the end, phrased as a question.
- Say "the NYC Marathon" for the race and "NYC" only for a location.
- Turnaround, whenever it comes up, is 10 to 12 days after the race.
- Subject lines: seven words or fewer, lower case, no colons unless the template uses one.
- Return the body as plain text with blank lines between paragraphs. No HTML.
`.trim()

/**
 * Charity rules that do not apply to races. From the Trackstar Charity Program
 * Overview and the first-touch template in Notion; several of these are the
 * difference between a good email and one that has to be walked back on the
 * call.
 */
export const CHARITY_RULES = `
- Say "posters", not "prints", in cold outreach. A cold reader parses "poster" faster. Switch to "prints" once they reply.
- NO numbers in a first email. Never mention the unit minimum, the discount percentages, or any price. That is what the call is for.
- Do NOT promise a co-branded design. "There is a co-branded tier" is the ceiling of what we commit to before a conversation.
- There is NO revenue share, no commission and no donation-back. Never imply money flows back to the charity. Affiliate income can create taxable income for a 501(c)(3) and stalls their legal review, so we deliberately do not offer it.
- Lead with the co-branded tier. It is the visual we reach out with.
- Frame the product as recognition, not an incentive. "A reward for your top fundraisers" lands; "raise $X and get one" reads as a gift and comes out of a budget that is usually already spent.
- Use the team's own brand name for its running team, not the parent charity's legal name.
`.trim()

/** Default social-proof line, editable in Settings later. */
export const DEFAULT_SOCIAL_PROOF = 'Marine Corps Marathon finishers have ordered 1,000+ prints this season. CIM saw 300 orders in one week.'

