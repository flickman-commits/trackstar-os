/**
 * Support > Help > Playbook: the short cards a rep reads mid-conversation
 * (Matt, 2026-11-24: "if it's too long and wordy, people won't read it").
 * The kinds of message customers send, most common first, each one screen:
 * what to do, what to say, the exceptions. The long articles stay underneath
 * as full details, and Ask and the drafts keep reading those too.
 *
 * A card is a help article in the group "Topics" with a fixed shape, so it
 * is edited, versioned and checked like any other:
 *
 *   1. A step                          what to do, at most four
 *   - An exception                     "Only the frame broke? Send Frame only."
 *   ### Reply: First reply             a reply to copy; more than one is fine
 *   Hey [First name], ...
 *   ### Details                        the articles folded underneath, by slug
 *   scenario-10-..., scenario-18-...
 *
 * The text below is what a card says until an admin edits it in Help; then
 * the saved article wins. Numbers that change belong in the pinned article
 * (Current policies and numbers), not here.
 */
import prisma from '../../db.js'

export const TOPIC_GROUP = 'Topics'
export const PINNED_TOPIC = 'current-policies-and-numbers'
const SIGN = 'Thanks,\n[Your name] from Trackstar'

export const DEFAULT_TOPICS = [
  {
    slug: 'topic-change-an-order', title: 'Change an order',
    body: `1. Open the order in Artelo first. "In production" here doesn't always mean printed.
2. Not in production: Change size or frame, Fix name or year, or Edit shipping address.
3. In production but not printed: click Hold in Artelo, Re-Open Order in TrackstarOS, then make the change.
4. Already printed: we can't change it. Say so and attach the mockup.
- Frame color, already in production? Create Artelo ticket. It often still works, but don't promise it.
- Adding a photo? It's a paid add-on. Send the invoice first.
- New address in another state? Sales tax can be added. Tell them the invoice is coming.
- Photo too blurry to print? Ask for a better one and hold the order 4 business days.
### Reply: Changed
Hey [First name],

No problem! I've updated your order to [CHANGE]. You're all set.

${SIGN}
### Reply: Already printed
Hey [First name],

Unfortunately [RUNNER]'s print has already been made, so we aren't able to change it at this point. Attaching a mockup so you can see what's coming!

${SIGN}
### Reply: Asked production
Hey [First name],

I've reached out to our production team to request the change. Usually they're able to, but I can't 100% guarantee it. I'll let you know!

${SIGN}
### Details
before-vs-after-production, scenario-10-order-modification-change-size-frame-or-details, scenario-14-wrong-frame-ordered-or-no-frame-at-all, scenario-18-add-on-or-change-after-ordering-photo-frame-name, scenario-19-ship-to-a-different-address, scenario-24-bad-photo-photo-add-on-wont-print-well`,
  },
  {
    slug: 'topic-feedback-and-reviews', title: 'Feedback and reviews',
    body: `1. Reply to every one. Customers answer Matt's note, so they expect an answer.
2. Look for a question hiding in it and answer that first.
3. Want another print? Send a personal code (Discounts & Gift Cards).
4. Happy and already have the print? Click Ask for a review.
- Suggest an idea or say why they hesitated? Post it in Slack for Matt.
- Disappointed? Ask exactly what fell short, then offer a new photo or a bigger size.
### Reply: Thank you
Hey [First name],

Thanks so much for the feedback!! So stoked for [RUNNER] to get it.

${SIGN}
### Reply: Ask for a review
Hey [First name],

So glad you love it!! If you have 2 seconds, would you mind leaving us a review? It really helps us as a young brand: https://yotpo.com/go/mgtsCHbm

And send me a pic once it's on the wall!

${SIGN}
### Reply: Disappointed
Hey [First name],

I'm really sorry it didn't live up to what you were hoping for. Could you tell me a bit more about what felt off? We'd love to make it right.

${SIGN}
### Details
scenario-16-note-from-owner-replies-post-purchase-feedback-highest-volume, scenario-12-happy-customer-ask-for-review, scenario-25-disappointed-with-the-print`,
  },
  {
    slug: 'topic-product-questions', title: 'Product questions',
    body: `1. Check Prices and policies for sizes, prices, shipping and dates.
2. Standard prints are fixed per race. Only the runner's details and the photo change.
3. Want anything else (extra text, two races, two runners)? That's a custom print.
- A race we don't carry? Custom. Don't promise a new design.
- Ran the half but only the marathon is listed? Order the marathon. Their results tell us which one they ran.
- Triathlon? Send trackstar.art/pages/triathlon.
- Ordering before the race? We hold it until results are posted.
- Want to see it first? Attach a mockup once they've ordered.
### Reply: Race we don't carry
Hey [First name],

Congrats on [RACE]! We don't have a design for that race yet, but we make custom prints for any race in the same style: https://www.trackstar.art/products/custom

${SIGN}
### Reply: Ran the half
Hey [First name],

Totally understand the confusion! We can tell from the official results which race you ran, so just order the [RACE] Marathon print and we'll use the half-marathon design once we find your results.

${SIGN}
### Details
scenario-6-general-product-questions-qa, scenario-4-my-race-isnt-available, scenario-9-pre-race-order-questions, scenario-22-can-i-see-it-first-nervous-buyer, product-details-know-this-cold`,
  },
  {
    slug: 'topic-custom-prints', title: 'Custom prints',
    body: `1. Open the order. Check if the options were sent and if they already approved.
2. Options sent: use Insert approval link.
3. Not sent yet: give the date. It's 2 weeks from the order date.
4. Want a change? Add comment on the order so the designer sees it.
- Past the due date? Apologize, then Slack Matt and the designer.
- Need it by a date? Ask Matt before you promise a rush.
### Reply: Not ready yet
Hey [First name],

We'll send you design options 2 weeks after your order date, so for you that'll be [DATE]. Excited for you to see them!

${SIGN}
### Reply: Options are ready
Hey [First name],

Your design options are ready! You can view them here: [APPROVAL LINK]

Approve your favorite or request any changes right on that page, and we'll take it from there.

${SIGN}
### Reply: How it works
Hey [First name],

We can absolutely do a custom print for [RACE]! Fill out the details here: https://www.trackstar.art/products/custom

Within 2 weeks you'll get 3 to 5 design options by email. Approve your favorite or ask for changes, then we print, frame and ship it.

${SIGN}
### Details
scenario-7-custom-print-questions`,
  },
  {
    slug: 'topic-wheres-my-order', title: "Where's my order?",
    body: `1. Open the order in Artelo for the real status.
2. Not shipped: say where it is and attach the mockup.
3. Shipped: use Insert Artelo tracking link.
4. Stuck more than a week? Bump Artelo with Create Artelo ticket.
- "In transit" while Artelo says Printing? It hasn't shipped. That's only the label.
- Tracking not moving for days? See Not received.
- Don't give a date you haven't checked.
### Reply: In production
Hey [First name],

[RUNNER]'s print is in production. You'll get a tracking email as soon as it ships. Attaching a mockup below so you can see what's coming!

${SIGN}
### Reply: Shipped
Hey [First name],

Your order has shipped! Here's your tracking: [TRACKING LINK]

${SIGN}
### Details
scenario-1-wheres-my-order-tracking-questions, before-vs-after-production, shipping`,
  },
  {
    slug: 'topic-arrived-damaged', title: 'Arrived damaged',
    body: `1. Create Artelo ticket, Arrived damaged. Attach their photos, ask for double wrap.
2. Reply right away. The replacement doesn't wait for photos.
3. No tracking after a week? Bump the ticket.
- More photos or the label came later? Create Artelo ticket, More photos.
- Only the frame broke? New Artelo order, Frame only. They keep the print.
- No photos or label? Don't chase it. Tell Artelo to go ahead.
- Wants a refund, or more than 30 days since delivery? Ask Matt.
### Reply: First reply
Hey [First name],

I'm so sorry it arrived broken! I'm sending a free replacement right away, no need to return the broken one. It should be there in the next 7 days or so (we'll double wrap it).

Could you send a photo of the shipping label on the box? We need it to file the carrier claim, but the replacement won't wait on it.

${SIGN}
### Reply: Replacement shipped
Hey [First name],

Good news, your replacement has shipped! Here's the tracking: [LINK]

Sorry again for the trouble, and thanks for your patience!

${SIGN}
### Details
scenario-2b-broken-frame-shattered-in-transit-most-common, scenario-2a-damaged-print-quality-issue`,
  },
  {
    slug: 'topic-wrong-name-or-time', title: 'Wrong name or time',
    body: `1. Compare the print with what they typed at checkout.
2. Not printed: Fix name or year, free.
3. Printed and our mistake: free corrected print.
4. Printed and their typo: a small fix is still free, print only. They keep the frame.
- Time looks wrong but matches the results? Send the results link and ask if they still want it changed.
- A time the customer typed always prints as typed.
- Bigger redo (new frame or size), or they dispute it? Ask Matt.
### Reply: Fixed before printing
Hey [First name],

Yes, no problem! We've updated it to [CORRECT INFO]. You're all set.

${SIGN}
### Reply: Our mistake
Hey [First name],

That's on us. We're making a corrected print right away, and you'll get tracking as soon as it ships. No need to return the other one.

${SIGN}
### Reply: Their typo
Hey [First name],

No problem! We'll get an updated print out to you right away at no cost. Keep the frame, the new print slides right in.

${SIGN}
### Details
scenario-3-wrong-personalization-data, scenario-13-missing-detail-on-print-production-error, scenario-21-race-results-changed-after-ordering, scenario-23-customer-isnt-sure-of-their-results-or-its-an-older-race`,
  },
  {
    slug: 'topic-cancel-or-refund', title: 'Cancel or refund',
    body: `1. Open the order in Artelo. Is it printed?
2. Not in production: Cancel and refund. No questions.
3. In production, not printed: cancel it in Artelo, then Refund 100%.
4. Printed and correct: no refund for a change of mind.
- Our mistake or damaged? Offer a free replacement first.
- Wrong item or size? Offer Change size or frame instead of canceling.
- Over $250, a chargeback or a legal threat? Slack Matt.
### Reply: Canceled
Hey [First name],

No problem! I've canceled your order and refunded you in full. The money will be back on your original payment method in 5 to 10 business days.

${SIGN}
### Reply: Already printed
Hey [First name],

I understand. Because every print is made to order with your race details, we're unable to refund one that's already been made correctly. If anything is wrong with the print itself, let me know and I'll make it right.

${SIGN}
### Details
scenario-5-refund-request, return-refund-policy`,
  },
  {
    slug: 'topic-discounts-and-checkout', title: 'Discounts and checkout',
    body: `1. Check in Shopify that the discount should have applied.
2. It should have: refund the difference with Refund.
3. Stuck at checkout: send the cart link and a personal code.
- Not sure they qualified? Ask Matt.
- Want a bigger code than usual? Over 25% is Matt's call.
### Reply: Missed discount
Hey [First name],

You're right, that should've been applied. I've refunded the [AMOUNT] difference to your original payment method (5 to 10 business days). Sorry for the mix-up!

${SIGN}
### Reply: Stuck at checkout
Hey [First name],

You can go to your cart here: https://www.trackstar.art/cart and click the little trash icon next to any print you don't want.

You can also use code [CODE] at checkout. Let me know if that helps!

${SIGN}
### Details
scenario-15-discount-didnt-get-applied-retroactive-discount, scenario-17-cart-or-checkout-trouble`,
  },
  {
    slug: 'topic-not-received', title: 'Not received',
    body: `1. Carrier says delivered: send the delivery photo and ask them to check around.
2. They confirm it's missing: Create Artelo ticket, Lost in transit. A replacement goes out free.
3. Tracking stopped with no delivery scan: replace it now, don't wait.
- Give a date in your first reply: "If it hasn't turned up by Thursday, we'll send a replacement."
- New address for the replacement? Read it back to them before it goes.
- The replacement goes missing too? Refund 100%. Over $250, Slack Matt.
### Reply: Marked delivered
Hey [First name],

Just looked into this. The carrier marked it delivered on [DATE], and here's the delivery photo. Does that spot look familiar? It's also worth checking with neighbors or the front desk.

If it hasn't turned up by [DAY], let me know and we'll send a replacement right away.

${SIGN}
### Reply: Sending a replacement
Hey [First name],

So sorry about this! We're sending a replacement right away, and I'll send you the tracking as soon as it ships.

${SIGN}
### Details
scenario-1-wheres-my-order-tracking-questions`,
  },
  {
    slug: 'topic-send-to-matt', title: 'Send to Matt',
    body: `1. Use Slack Matt for anything below. Don't decide it yourself.
2. Race organizers and partners: send the reply below, then Slack Matt.
- A refund, invoice or gift card over $250.
- Legal threats, a chargeback, a PayPal claim, a social media callout.
- Press or media.
- A problem hitting more than one customer.
- You're not sure and it isn't in the playbook.
### Reply: Race or partner
Hey [First name],

Thanks for reaching out! I'm looping in Matt, our founder, who handles all race partnerships directly. He'll be in touch shortly.

${SIGN}
### Details
escalation-rules-when-to-slack-matt, scenario-8-race-organizer-or-partner-inquiry-always-escalate, scenario-20-we-messed-up-proactive-heads-up-recovery`,
  },
]

const BY_SLUG = new Map(DEFAULT_TOPICS.map((t, i) => [t.slug, { ...t, position: i }]))
export const isTopicSlug = slug => BY_SLUG.has(String(slug || ''))
export const topicDefault = slug => BY_SLUG.get(String(slug || '')) || null

/** A card's markdown as its parts. Pure. */
export function parseCard(body) {
  const card = { steps: [], notes: [], replies: [], details: [] }
  let section = null
  for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    const reply = /^###\s*Reply:\s*(.+)$/i.exec(line)
    if (reply) { section = { label: reply[1].trim(), text: '' }; card.replies.push(section); continue }
    if (/^###\s*Details\s*$/i.test(line)) { section = 'details'; continue }
    if (section === 'details') { card.details.push(...line.split(',').map(s => s.trim()).filter(Boolean)); continue }
    if (section) { section.text += `${line}\n`; continue }
    const step = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    const note = /^\s*[-*]\s+(.+)$/.exec(line)
    if (step) card.steps.push(step[1].trim())
    else if (note) card.notes.push(note[1].trim())
  }
  card.replies = card.replies.map(r => ({ ...r, text: r.text.trim() })).filter(r => r.text)
  return card
}

/** Every card in order, as an admin last saved it, with the titles of its details. */
export async function listTopics() {
  const saved = new Map((await prisma.supportArticle.findMany({ where: { group: TOPIC_GROUP }, select: { slug: true, title: true, body: true, position: true } })).map(a => [a.slug, a]))
  const rows = [
    ...DEFAULT_TOPICS.map(t => saved.get(t.slug) || t),
    ...[...saved.values()].filter(a => !isTopicSlug(a.slug)),
  ]
  const cards = rows.map(t => ({ slug: t.slug, title: t.title, body: t.body, ...parseCard(t.body) }))
  const wanted = [...new Set(cards.flatMap(c => c.details))]
  const titles = new Map((await prisma.supportArticle.findMany({ where: { slug: { in: wanted } }, select: { slug: true, title: true } })).map(a => [a.slug, plainTitle(a.title)]))
  return cards.map(c => ({ ...c, details: c.details.filter(s => titles.has(s)).map(s => ({ slug: s, title: titles.get(s) })) }))
}

/** "Scenario 2B: Broken Frame (Shattered in Transit) ⚠️ MOST COMMON" reads "Broken Frame". Pure. */
export function plainTitle(title) {
  return String(title || '')
    .replace(/^Scenario\s+\w+:\s*/i, '')
    .replace(/\s*[☀-➿⭐\u{1F300}-\u{1FAFF}️].*$/u, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || String(title || '')
}

/** The cards as text for Ask: how we handle each kind of message, in the team's own short form. */
export async function topicsText() {
  return (await listTopics()).map(t => `### ${t.title}\n${[...t.steps.map((s, i) => `${i + 1}. ${s}`), ...t.notes.map(n => `- ${n}`)].join('\n')}`).join('\n\n')
}
