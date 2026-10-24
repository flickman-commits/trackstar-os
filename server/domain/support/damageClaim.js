/**
 * A damage claim to Artelo support, from Support. When a print arrives
 * damaged, Artelo replaces it for free once its support has the customer's
 * photos: they file a report with the carrier and make a "-R" replacement
 * (4341-R, 3013-R) at no charge. A New Artelo order (arteloOrder.js) is
 * billed like any order, so damage goes this way instead.
 *
 * The claim is an email from fast@ to Artelo support with the photos the
 * customer sent in this conversation attached, the order numbers on both
 * sides, the prints, and where the replacement goes. It starts its own
 * Support conversation, so Artelo's answer lands there. The replacement
 * Artelo makes shows in the Orders panel on its own (replacements.js).
 */
import prisma from '../../db.js'
import { UserError } from './errors.js'
import { sendNew, messageAttachment } from './mailbox.js'
import { replyToHtml, replyToPlain } from './format.js'
import { arteloOrderUrl } from '../../lib/links.js'

export const ARTELO_SUPPORT_EMAIL = 'support@artelo.io'
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

export async function claimPrep({ thread, shopifyOrderId }) {
  const { number, artelo } = await orderFor(shopifyOrderId)
  return { number, arteloOrderId: artelo?.orderId || null, to: ARTELO_SUPPORT_EMAIL, photos: (await claimPhotos(thread.id)).slice(0, 30) }
}

export async function sendDamageClaim({ thread, shopifyOrderId, photos, note, actor }) {
  const what = String(note || '').trim()
  if (!what) throw new UserError('Say what is damaged, for example "Frame cracked at the corner, glass shattered"')
  const picked = Array.isArray(photos) ? photos.slice(0, MAX_PHOTOS) : []
  if (!picked.length) throw new UserError('Pick at least one photo of the damage. Artelo needs them to file the report.')

  // Only photos from this conversation, by the same list the form showed.
  const own = await claimPhotos(thread.id)
  const files = []
  let total = 0
  for (const p of picked) {
    const hit = own.find(o => o.messageId === String(p?.messageId) && o.index === Number(p?.index))
    if (!hit) throw new UserError('One of those photos is not in this conversation')
    const a = await messageAttachment(hit.messageId, hit.index)
    if (!a?.bytes) throw new UserError(`Could not load ${hit.filename} from Gmail`)
    total += a.bytes.length
    if (total > MAX_BYTES) throw new UserError('Those photos are too big for one email. Pick fewer.')
    files.push({ bytes: a.bytes, contentType: a.mimeType || 'image/jpeg', filename: a.filename || hit.filename })
  }

  const { rows, number, artelo } = await orderFor(shopifyOrderId)
  const addr = artelo?.customerAddress || {}
  const shipTo = [addr.name, addr.street1, addr.street2, [addr.city, addr.state, addr.zipcode].filter(Boolean).join(' '), addr.countryCode || addr.country].filter(Boolean).join(', ')
  const prints = rows.map(r => `- ${[r.raceName, r.raceYear].filter(Boolean).join(' ')}${r.runnerName ? `, ${r.runnerName}` : ''}${r.productSize ? `, ${r.productSize}` : ''}${r.frameType ? `, ${r.frameType}` : ''}`).join('\n')
  const link = arteloOrderUrl(artelo?.id)
  const subject = `Damaged in shipping: order ${number}${artelo?.orderId ? ` (${artelo.orderId})` : ''}`
  const text = [
    'Hi Artelo team,',
    '',
    `Order ${number}${artelo?.orderId ? ` (Artelo order ${artelo.orderId})` : ''} arrived damaged. The customer's photos are attached.`,
    '',
    `What is damaged: ${what}`,
    '',
    `The print${rows.length > 1 ? 's' : ''}:`,
    prints,
    '',
    shipTo ? `Please file a report and send a replacement to the same address: ${shipTo}.` : 'Please file a report and send a replacement to the same address.',
    ...(link ? ['', link] : []),
    '',
    'Thanks,',
    `${actorFirst(actor)} from Trackstar`,
  ].join('\n')

  const sent = await sendNew({ userId: actor?.id || null, to: ARTELO_SUPPORT_EMAIL, subject, html: replyToHtml(text), text: replyToPlain(text), attachments: files })
  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
  await prisma.$transaction([
    prisma.supportNote.create({ data: { threadId: thread.id, kind: 'event', body: `${by} sent a damage claim for #${number} to Artelo support with ${files.length} photo${files.length === 1 ? '' : 's'}. Artelo's free replacement shows under Orders once they make it.`, authorId: actor?.id || null, authorName: by } }),
    ...rows.map(r => prisma.orderComment.create({ data: { orderId: r.id, text: `Damage claim sent to Artelo support (${files.length} photo${files.length === 1 ? '' : 's'}): ${what.slice(0, 300)}`, authorId: actor?.id || null, authorName: by } })),
  ])
  return { number, photos: files.length, claimThreadId: sent?.threadId || null, summary: `Sent a damage claim for #${number} to Artelo support with ${files.length} photo${files.length === 1 ? '' : 's'}` }
}
