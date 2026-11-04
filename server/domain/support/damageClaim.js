/**
 * An Artelo ticket, from Support: an email from fast@ to Artelo support
 * about one order. A kind (damaged, lost, wrong print, missing, address
 * change, other) gives a draft subject and body with the order numbers on
 * both sides, the prints and the ship-to; the person edits either before
 * sending, and can attach the customer's photos from the conversation or
 * files from their computer. The subject always carries the order number so
 * Artelo can find it.
 *
 * Damage and loss are the common ones: Artelo replaces those free once it
 * has the ticket (a "-R" order, 4341-R), where a New Artelo order
 * (arteloOrder.js) is billed. The ticket starts its own Support conversation,
 * so Artelo's answer lands there.
 */
import prisma from '../../db.js'
import { UserError } from './errors.js'
import { sendNew, messageAttachment } from './mailbox.js'
import { replyToHtml, replyToPlain } from './format.js'
import { arteloOrderUrl } from '../../lib/links.js'
import { readUpload } from './uploads.js'

export const ARTELO_SUPPORT_EMAIL = 'support@artelo.com'
const IMAGE = /^image\/(jpe?g|png|gif|webp|heic|heif|avif)$/i
const MAX_PHOTOS = 8
const MAX_BYTES = 20 * 1024 * 1024 // Gmail takes 25 MB a message, encoding included

function actorFirst(actor) {
  return actor?.firstName || [actor?.email].filter(Boolean)[0]?.split('@')[0] || 'Trackstar'
}

/** The photos the customer sent in this conversation, newest first. */
export async function claimPhotos(threadId) {
  const messages = await prisma.supportMessage.findMany({
    where: { threadId, direction: 'in' },
    orderBy: { sentAt: 'desc' },
    select: { id: true, sentAt: true, attachments: true },
  })
  const out = []
  for (const m of messages) {
    const list = Array.isArray(m.attachments) ? m.attachments : []
    list.forEach((a, i) => { if (IMAGE.test(String(a?.mimeType || ''))) out.push({ messageId: m.id, index: i, filename: a.filename || `photo-${i + 1}`, at: m.sentAt }) })
  }
  return out
}

/** Our rows for the Shopify order, and what Artelo has for it. */
async function orderFor(shopifyOrderId) {
  const rows = await prisma.order.findMany({
    where: { source: 'shopify', parentOrderNumber: String(shopifyOrderId) },
    orderBy: { lineItemIndex: 'asc' },
    select: { id: true, runnerName: true, raceName: true, raceYear: true, productSize: true, frameType: true, arteloOrderData: true, shopifyOrderData: true },
  })
  if (!rows.length) throw new UserError('That order is not in TrackstarOS. Email Artelo support from Gmail for this one.')
  const number = String(rows[0].shopifyOrderData?.name || shopifyOrderId).replace(/^#/, '')
  return { rows, number, artelo: rows[0].arteloOrderData || null }
}

/** Everything the drafts and the email need about the order. */
async function orderFacts(shopifyOrderId) {
  const { rows, number, artelo } = await orderFor(shopifyOrderId)
  const addr = artelo?.customerAddress || {}
  const shipTo = [addr.name, addr.street1, addr.street2, [addr.city, addr.state, addr.zipcode].filter(Boolean).join(' '), addr.countryCode || addr.country].filter(Boolean).join(', ')
  const prints = rows.map(r => `- ${[r.raceName, r.raceYear].filter(Boolean).join(' ')}${r.runnerName ? `, ${r.runnerName}` : ''}${r.productSize ? `, ${r.productSize}` : ''}${r.frameType ? `, ${r.frameType}` : ''}`).join('\n')
  const ids = `${number}${artelo?.orderId ? ` (${artelo.orderId})` : ''}`
  const ref = `Order ${number}${artelo?.orderId ? ` (Artelo order ${artelo.orderId})` : ''}`
  return { rows, number, artelo, shipTo, prints, ids, ref, link: arteloOrderUrl(artelo?.id) }
}

/** The kinds of ticket, each with its draft. `tracking` is the order's newest tracking, if the form has it. */
export const TICKET_KINDS = [
  { value: 'damaged', label: 'Arrived damaged', sub: 'Photos of the damage and the box', photos: true,
    subject: f => `Damaged in shipping: order ${f.ids}`,
    body: f => [`${f.ref} arrived damaged.`, '', 'What is damaged: ', '', `Please file a report and send a replacement${f.shipTo ? ` to the same address: ${f.shipTo}` : ' to the same address'}.`] },
  { value: 'lost', label: 'Lost in transit', sub: 'Never arrived, waited long enough', photos: false,
    subject: f => `Lost in transit: order ${f.ids}`,
    body: f => [`${f.ref} has not arrived. The customer has waited long enough that it looks lost in transit.`, '', `Tracking: ${f.tracking || ''}`, '', `Please open a trace with the carrier and send a replacement${f.shipTo ? ` to the same address: ${f.shipTo}` : ' to the same address'}.`] },
  { value: 'wrong', label: 'Wrong print', sub: 'Not the design, size or frame ordered', photos: true,
    subject: f => `Wrong print received: order ${f.ids}`,
    body: f => [`${f.ref} arrived with the wrong print.`, '', 'What was received instead: ', '', `Please send the correct print${f.shipTo ? ` to the same address: ${f.shipTo}` : ''}.`] },
  { value: 'missing', label: 'Missing from the box', sub: 'An item or part did not come', photos: true,
    subject: f => `Missing item: order ${f.ids}`,
    body: f => [`${f.ref} arrived with something missing.`, '', 'What is missing: ', '', `Please send it${f.shipTo ? ` to the same address: ${f.shipTo}` : ''}.`] },
  { value: 'address', label: 'Address change', sub: 'Before it ships', photos: false,
    subject: f => `Address change: order ${f.ids}`,
    body: f => [`Please ship ${f.ref} to this address instead:`, '', '', f.shipTo ? `It was going to: ${f.shipTo}.` : ''] },
  { value: 'other', label: 'Something else', sub: 'Write it yourself', photos: true,
    subject: f => `Order ${f.ids}`,
    body: f => [`About ${f.ref}:`, '', ''] },
]
export const CLAIM_KINDS = TICKET_KINDS.map(k => k.value)

function draftFor(kind, f, actor) {
  const text = [
    'Hi Artelo team,',
    '',
    ...kind.body(f),
    '',
    `The print${f.rows.length > 1 ? 's' : ''}:`,
    f.prints,
    ...(f.link ? ['', f.link] : []),
    '',
    'Thanks,',
    `${actorFirst(actor)} from Trackstar`,
  ]
  return { subject: kind.subject(f), body: text.join('\n').replace(/\n{3,}/g, '\n\n') }
}

/** What the form starts from: the kinds with a draft each, and the customer's photos in this conversation. */
export async function claimPrep({ thread, shopifyOrderId, tracking, actor }) {
  const f = { ...(await orderFacts(shopifyOrderId)), tracking: String(tracking || '').trim() }
  return {
    number: f.number,
    arteloOrderId: f.artelo?.orderId || null,
    to: ARTELO_SUPPORT_EMAIL,
    kinds: TICKET_KINDS.map(k => ({ value: k.value, label: k.label, sub: k.sub, photos: k.photos, ...draftFor(k, f, actor) })),
    photos: (await claimPhotos(thread.id)).slice(0, 30),
  }
}

/**
 * Send it. `photos` are the customer's, from this conversation; `uploads`
 * are "upload:<path>" refs the person added from their computer.
 */
export async function sendArteloClaim({ thread, shopifyOrderId, kind = 'damaged', subject, body, photos, uploads, actor }) {
  const k = TICKET_KINDS.find(x => x.value === kind)
  if (!k) throw new UserError('What kind of ticket is this?')
  const f = await orderFacts(shopifyOrderId)
  const subj = String(subject || '').trim().slice(0, 200)
  const text = String(body || '').trim().slice(0, 6000)
  if (!subj) throw new UserError('Give the ticket a subject')
  if (!subj.includes(f.number)) throw new UserError(`The subject has to include the order number, ${f.number}, so Artelo can find it`)
  if (!text) throw new UserError('Say what the ticket is about')

  const files = []
  let total = 0
  const add = (bytes, contentType, filename) => {
    total += bytes.length
    if (total > MAX_BYTES) throw new UserError('Those attachments are too big for one email. Pick fewer.')
    files.push({ bytes, contentType, filename })
  }
  // Only photos from this conversation, by the same list the form showed.
  const picked = Array.isArray(photos) ? photos.slice(0, MAX_PHOTOS) : []
  const own = picked.length ? await claimPhotos(thread.id) : []
  for (const p of picked) {
    const hit = own.find(o => o.messageId === String(p?.messageId) && o.index === Number(p?.index))
    if (!hit) throw new UserError('One of those photos is not in this conversation')
    const a = await messageAttachment(hit.messageId, hit.index)
    if (!a?.bytes) throw new UserError(`Could not load ${hit.filename} from Gmail`)
    add(a.bytes, a.mimeType || 'image/jpeg', a.filename || hit.filename)
  }
  for (const ref of (Array.isArray(uploads) ? uploads : []).slice(0, MAX_PHOTOS)) {
    if (!String(ref).startsWith('upload:')) throw new UserError('That file was not uploaded here')
    const up = await readUpload(String(ref).slice('upload:'.length))
    add(up.bytes, up.contentType, up.filename)
  }

  const sent = await sendNew({ userId: actor?.id || null, to: ARTELO_SUPPORT_EMAIL, subject: subj, html: replyToHtml(text), text: replyToPlain(text), attachments: files })
  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
  const withFiles = files.length ? ` with ${files.length} attachment${files.length === 1 ? '' : 's'}` : ''
  const label = k.label.toLowerCase()
  await prisma.$transaction([
    prisma.supportNote.create({ data: { threadId: thread.id, kind: 'event', body: `${by} opened an Artelo ticket for #${f.number} (${label})${withFiles}: "${subj}". Artelo's answer comes into Support as its own conversation.`, authorId: actor?.id || null, authorName: by } }),
    ...f.rows.map(r => prisma.orderComment.create({ data: { orderId: r.id, text: `Artelo ticket (${label})${withFiles}: ${subj}`, authorId: actor?.id || null, authorName: by } })),
  ])
  return { number: f.number, kind, photos: files.length, claimThreadId: sent?.threadId || null, summary: `Opened an Artelo ticket for #${f.number} (${label})${withFiles}` }
}
