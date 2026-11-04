/**
 * "Add photo after the race": a pre-order shopper pays for the Photo Add-On
 * at checkout (the storefront wizard's photo step) without a photo, because
 * the race has not happened. The print carries `_photo_later`, the import
 * sets Order.photoLater, and the print waits (spec.js, pipeline.js) until:
 *
 *   uploaded   they upload it at /photo/<token> (src/pages/PhotoLater.tsx)
 *   skipped    they tell that page to print without one
 *   deadline   no photo DEADLINE_AFTER_MS after the first email
 *   unpaid     the order has no Photo Add-On for it (taken out of the cart)
 *
 * Every way out but "uploaded" refunds the add-on, and every way out lets the
 * print render on its own. Nobody has to chase a photo: the auto-import runs
 * runPhotoLater every 10 minutes, which sends the upload link the day after
 * the race, one reminder, and closes it at the deadline. Support only hears
 * about it when a refund fails (Slack) or the customer writes in.
 */
import prisma from '../../db.js'
import { randomBytes } from 'node:crypto'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { refundable } from '../support/actions.js'
import { sendOrderEmail, customerMailReady } from '../support/customerMail.js'
import { sendEmail } from '../../lib/email.js'
import { renderCustomerEmail, escapeHtml } from '../../lib/customerEmail.js'
import { photoLaterUrl } from '../../lib/links.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { storage } from '../../lib/storage.js'
import { isPhotoAddonLineItem, isRemovedLineItem } from '../../lib/lineItemMatching.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { awaitingLaterPhoto, photoLaterDeadline, photoLaterDue, DEADLINE_AFTER_MS } from './photoLaterState.js'

const BUCKET = 'personalization-photos'
// What photo-verify hands back: a sanitized JPEG, PNG or WEBP.
const VERIFIED_PATH = /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/
const BOT = { id: null, firstName: 'TrackstarOS' }

const ROW = {
  id: true, orderNumber: true, parentOrderNumber: true, source: true, status: true,
  runnerName: true, runnerNameOverride: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true,
  customerEmail: true, customerName: true, shopifyOrderData: true, photoPath: true,
  photoLater: true, photoLaterToken: true, photoLaterEmailedAt: true, photoLaterRemindedAt: true, photoLaterClosedAt: true, photoLaterOutcome: true,
}

const runnerOf = o => (o.runnerNameOverride ?? o.runnerName ?? '').trim() || 'your runner'
const numberOf = o => String(o.shopifyOrderData?.name || o.parentOrderNumber || o.orderNumber).replace(/^#/, '')
const longDay = d => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' })
const toCents = amount => Math.round(Number(amount || 0) * 100)
const money = cents => `$${(cents / 100).toFixed(2)}`
const propOf = (li, name) => (li?.properties || []).find(p => p?.name === name)?.value

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** The live "photo later" add-on lines on a Shopify order, and what one cost after discounts. */
function laterAddons(shopifyOrderData) {
  const lines = (shopifyOrderData?.line_items || []).filter(li => isPhotoAddonLineItem(li) && !isRemovedLineItem(li) && propOf(li, '_photo_later'))
  const units = lines.reduce((n, li) => n + Number(li.current_quantity ?? li.quantity ?? 1), 0)
  const li = lines[0]
  if (!li) return { units: 0, eachCents: 0 }
  const qty = Number(li.quantity || 1)
  const discount = (li.discount_allocations || []).reduce((n, d) => n + toCents(d.amount), 0)
  return { units, eachCents: Math.max(0, toCents(li.price) - Math.round(discount / qty)) }
}

const REFUND_CREATE = `
  mutation refundCreate($input: RefundInput!) {
    refundCreate(input: $input) {
      refund { id }
      userErrors { field message }
    }
  }`

/**
 * Give back the add-on for prints that closed without a photo. Never throws:
 * the print goes ahead either way, and a refund that did not happen is a
 * Slack message for a person, not a stuck order.
 * @returns {Promise<string>} "refunded" or "failed: <why>", stored on the rows
 */
async function refundAddons(rows, why) {
  const o = rows[0]
  const cents = laterAddons(o.shopifyOrderData).eachCents * rows.length
  let result
  try {
    if (o.source !== 'shopify') throw new Error('not a Shopify order')
    if (!cents) throw new Error('no paid photo add-on found on the order')
    const money0 = await refundable(o.parentOrderNumber)
    if (!money0.sale) throw new Error('no captured payment to refund against')
    if (cents > money0.availableCents) throw new Error(`only ${money(money0.availableCents)} left to refund`)
    const data = await shopifyGraphQL(REFUND_CREATE, {
      input: {
        orderId: money0.gid,
        note: `Photo Add-On refunded: ${why} (TrackstarOS)`,
        notify: false,
        transactions: [{ orderId: money0.gid, parentId: money0.sale.id, gateway: money0.sale.gateway, kind: 'REFUND', amount: (cents / 100).toFixed(2) }],
      },
    })
    const errs = data?.refundCreate?.userErrors || []
    if (errs.length) throw new Error(errs.map(e => e.message).join('; '))
    result = 'refunded'
  } catch (err) {
    result = `failed: ${String(err.message || err).slice(0, 160)}`
    await slackTo('matt', `⚠️ Photo after the race: could not refund the Photo Add-On on order *${slackText(numberOf(o))}* (${rows.length} print${rows.length === 1 ? '' : 's'}, ${why}). ${slackText(result)}. Refund it in Shopify by hand.`, { or: 'alerts' }).catch(() => {})
  }
  await prisma.order.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { photoLaterRefund: result } })
  await prisma.orderComment.createMany({
    data: rows.map(r => ({ orderId: r.id, authorId: null, authorName: 'TrackstarOS', text: result === 'refunded' ? `Photo Add-On refunded (${money(laterAddons(o.shopifyOrderData).eachCents)}): ${why}` : `Photo Add-On NOT refunded (${why}): ${result.replace(/^failed: /, '')}. Refund it in Shopify.` })),
  })
  return result
}

/**
 * Stop waiting on these prints without a photo: they render as plain
 * posters from the next run. Claimed row by row so two runs cannot both
 * refund the same print.
 */
async function closeWithoutPhoto(rows, outcome, why) {
  const claimed = []
  for (const r of rows) {
    const { count } = await prisma.order.updateMany({ where: { id: r.id, photoLaterClosedAt: null, photoPath: null }, data: { photoLaterClosedAt: new Date(), photoLaterOutcome: outcome } })
    if (count) claimed.push(r)
  }
  if (!claimed.length) return { closed: 0, refund: null }
  const refund = outcome === 'unpaid' ? null : await refundAddons(claimed, why)
  return { closed: claimed.length, refund }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function ensureTokens(rows) {
  for (const r of rows) {
    if (r.photoLaterToken) continue
    r.photoLaterToken = randomBytes(24).toString('base64url')
    await prisma.order.update({ where: { id: r.id }, data: { photoLaterToken: r.photoLaterToken } })
  }
}

/** One print gets the button; several get a link each, named by runner. */
function links(rows) {
  if (rows.length === 1) return { cta: { label: 'Upload your photo', url: photoLaterUrl(rows[0].photoLaterToken) }, list: [] }
  return {
    cta: null,
    list: rows.map(r => `<a href="${photoLaterUrl(r.photoLaterToken)}" style="color:#4600D6;font-weight:700;">Upload the photo for ${escapeHtml(runnerOf(r))}</a>`),
  }
}

export function compose(kind, rows, { deadline, refund } = {}) {
  const o = rows[0]
  const names = [...new Set(rows.map(runnerOf))]
  const who = names.length === 1 ? names[0] : 'your runners'
  const poster = names.length === 1 ? `${who}'s poster` : 'their posters'
  const greeting = o.customerName ? `Hi ${o.customerName},` : 'Hi there,'
  const number = numberOf(o)
  const { cta, list } = links(rows)
  const by = deadline ? longDay(deadline) : null

  if (kind === 'request' || kind === 'remind') {
    const subject = `${kind === 'remind' ? 'Reminder: add' : 'Add'} your photo to ${poster} | Trackstar Order #${number}`
    const lead = kind === 'remind'
      ? `Just a reminder that ${poster} ${names.length === 1 ? 'is' : 'are'} waiting on your photo. Upload it by ${by} and it goes straight to print.`
      : `Race day is done, and we're getting ${poster} ready. You chose to add ${names.length === 1 ? 'a photo' : 'photos'} after the race, so all we need now is ${names.length === 1 ? 'the photo' : 'the photos'}.`
    const after = [`${names.length === 1 ? 'The poster prints' : 'Each poster prints'} as soon as its photo is in. No photo by ${by}? We'll print it without one and refund the photo add-on.`]
    const html = renderCustomerEmail({ greeting, paragraphs: [escapeHtml(lead), ...list], cta, after: after.map(escapeHtml) })
    const text = [greeting, '', lead, '', ...rows.map(r => `${rows.length > 1 ? `${runnerOf(r)}: ` : ''}${photoLaterUrl(r.photoLaterToken)}`), '', after[0], '', 'Thanks,', 'Matt from Trackstar'].join('\n')
    return { subject, html, text }
  }

  // kind === 'closed': the deadline passed with no photo.
  const subject = `${names.length === 1 ? `${who}'s poster is` : 'Your posters are'} going to print | Trackstar Order #${number}`
  const lines = [
    `We didn't get a photo for ${poster}, so we're printing ${names.length === 1 ? 'it' : 'them'} without one.`,
    refund === 'refunded'
      ? "We've refunded the photo add-on. It can take a few days to show up on your card."
      : "We'll refund the photo add-on in the next few days.",
  ]
  const html = renderCustomerEmail({ greeting, paragraphs: lines.map(escapeHtml) })
  const text = [greeting, '', ...lines, '', 'Thanks,', 'Matt from Trackstar'].join('\n')
  return { subject, html, text }
}

async function send(rows, mail, event) {
  const o = rows[0]
  if (!o.customerEmail) throw new Error('no customer email on the order')
  if (await customerMailReady()) {
    // waiting: false. Support is not waiting on a reply; the upload page is the answer.
    await sendOrderEmail({ order: o, subject: mail.subject, html: mail.html, text: mail.text, actor: BOT, waiting: false, event, comment: event })
  } else {
    const from = process.env.RESEND_FROM_EMAIL || 'Trackstar <proofs@orders.trackstar.art>'
    await sendEmail({ from, to: [o.customerEmail], replyTo: process.env.PROOF_REPLY_TO_EMAIL || 'fast@trackstar.art', subject: mail.subject, html: mail.html, text: mail.text })
    await prisma.orderComment.createMany({ data: rows.map(r => ({ orderId: r.id, authorId: null, authorName: 'TrackstarOS', text: event })) })
  }
}

// ---------------------------------------------------------------------------
// The scheduler (api/orders/auto-import.js, every 10 minutes)
// ---------------------------------------------------------------------------

async function raceDays(rows) {
  const years = [...new Set(rows.map(r => r.yearOverride ?? r.raceYear).filter(Boolean))]
  if (!years.length) return () => null
  const races = await prisma.race.findMany({ where: { year: { in: years }, raceDate: { not: null } }, select: { raceName: true, year: true, raceDate: true } })
  const byKey = new Map(races.map(r => [`${r.raceName}|${r.year}`, r.raceDate]))
  return o => {
    const name = o.raceNameOverride ?? o.raceName
    const year = o.yearOverride ?? o.raceYear
    return byKey.get(`${name}|${year}`) || byKey.get(`${getCanonicalRaceName(name) || name}|${year}`) || null
  }
}

export async function runPhotoLater({ now = Date.now(), log = () => {} } = {}) {
  const out = { requested: 0, reminded: 0, closed: 0, unpaid: 0, failed: 0 }
  const rows = await prisma.order.findMany({
    where: { photoLater: true, photoPath: null, photoLaterClosedAt: null, status: { not: 'completed' } },
    select: ROW,
  })
  if (!rows.length) return out
  const raceDayOf = await raceDays(rows)

  // One email per Shopify order and step, covering every print on it.
  const groups = new Map()
  for (const r of rows) {
    const due = photoLaterDue(r, raceDayOf(r), now)
    if (!due) continue
    const key = `${r.parentOrderNumber}|${due}`
    if (!groups.has(key)) groups.set(key, { due, rows: [] })
    groups.get(key).rows.push(r)
  }

  for (const { due, rows: group } of groups.values()) {
    const o = group[0]
    try {
      // Paid for? An add-on taken out of the cart leaves the print saying
      // "photo later" with nothing paid. Print it plain; there is nothing to refund.
      if (o.source === 'shopify' && laterAddons(o.shopifyOrderData).units < group.length && due === 'request') {
        await closeWithoutPhoto(group, 'unpaid', 'no Photo Add-On on the order')
        out.unpaid += group.length
        log(`${numberOf(o)}: photo later with no paid add-on, printing without a photo`)
        continue
      }
      if (due === 'request' || due === 'remind') {
        await ensureTokens(group)
        const deadline = due === 'request' ? new Date(now + DEADLINE_AFTER_MS) : photoLaterDeadline(o)
        await send(group, compose(due, group, { deadline }), due === 'request'
          ? `Emailed the customer a link to add their photo after the race (deadline ${longDay(deadline)})`
          : 'Reminded the customer to add their photo after the race')
        await prisma.order.updateMany({ where: { id: { in: group.map(r => r.id) } }, data: due === 'request' ? { photoLaterEmailedAt: new Date(now) } : { photoLaterRemindedAt: new Date(now) } })
        if (due === 'request') out.requested += group.length
        else out.reminded += group.length
        log(`${numberOf(o)}: ${due === 'request' ? 'photo link emailed' : 'photo reminder emailed'}`)
        continue
      }
      // Deadline: print it plain and give the add-on back.
      const { closed, refund } = await closeWithoutPhoto(group, 'deadline', 'no photo by the deadline')
      if (!closed) continue
      out.closed += closed
      await send(group, compose('closed', group, { refund }), `No photo by the deadline: printing without one. Photo Add-On ${refund === 'refunded' ? 'refunded' : 'NOT refunded, see the comment'}`)
        .catch(err => log(`${numberOf(o)}: closed, but the email did not send: ${err.message}`))
      log(`${numberOf(o)}: no photo by the deadline, printing without one (${refund})`)
    } catch (err) {
      out.failed += group.length
      log(`${numberOf(o)}: photo later ${due} failed: ${err.message}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The upload page (api/public/photo-later.js)
// ---------------------------------------------------------------------------

export class PhotoLaterError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}

async function rowFor(token) {
  if (!TOKEN.test(String(token || ''))) throw new PhotoLaterError('not_found', 404)
  const o = await prisma.order.findUnique({ where: { photoLaterToken: String(token) }, select: { ...ROW, photoLaterRefund: true } })
  if (!o) throw new PhotoLaterError('not_found', 404)
  return o
}

function pageView(o) {
  const state = awaitingLaterPhoto(o) ? 'waiting'
    : o.photoLaterOutcome === 'uploaded' ? 'uploaded'
    : o.photoLaterOutcome === 'skipped' ? 'skipped'
    : 'closed'
  const deadline = photoLaterDeadline(o)
  return {
    state,
    runnerName: runnerOf(o),
    raceYear: o.yearOverride ?? o.raceYear,
    orderNumber: numberOf(o),
    firstName: o.customerName || null,
    deadline: deadline ? deadline.toISOString() : null,
    refunded: o.photoLaterRefund === 'refunded',
  }
}

export async function photoLaterInfo(token) {
  return pageView(await rowFor(token))
}

/** The customer's verified photo onto the print; it renders from the next run. */
export async function attachLaterPhoto(token, path) {
  const o = await rowFor(token)
  if (!awaitingLaterPhoto(o)) throw new PhotoLaterError('closed', 409)
  if (!VERIFIED_PATH.test(String(path || ''))) throw new PhotoLaterError('bad_path')
  // Only a file that is actually in the bucket (photo-verify replaced or purged everything else).
  const { error } = await storage().storage.from(BUCKET).createSignedUrl(String(path), 60)
  if (error) throw new PhotoLaterError('not_found', 404)
  // Paid at checkout, so it is a checkout photo, not a hand-attached one waiting on payment.
  const { count } = await prisma.order.updateMany({
    where: { id: o.id, photoPath: null, photoLaterClosedAt: null },
    data: { photoPath: String(path), photoAddedManually: false, photoFree: false, photoPlacedAt: null, photoLaterClosedAt: new Date(), photoLaterOutcome: 'uploaded' },
  })
  if (!count) throw new PhotoLaterError('closed', 409)
  await prisma.orderComment.create({ data: { orderId: o.id, authorId: null, authorName: 'TrackstarOS', text: 'The customer uploaded their photo after the race. The print renders with it on the next run.' } })
  return pageView({ ...o, photoPath: String(path), photoLaterClosedAt: new Date(), photoLaterOutcome: 'uploaded' })
}

/** The customer would rather have the poster without a photo: print it now and refund. */
export async function skipLaterPhoto(token) {
  const o = await rowFor(token)
  if (!awaitingLaterPhoto(o)) throw new PhotoLaterError('closed', 409)
  const { closed, refund } = await closeWithoutPhoto([o], 'skipped', 'the customer chose no photo')
  if (!closed) throw new PhotoLaterError('closed', 409)
  return pageView({ ...o, photoLaterClosedAt: new Date(), photoLaterOutcome: 'skipped', photoLaterRefund: refund })
}
