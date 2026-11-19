/**
 * The automatic "we got your message" reply (Matt, Nov 18 2026): a customer
 * who writes to fast@ hears back within minutes, so they know a person will
 * answer and they have not reached a dead address.
 *
 * Runs after each mail sync (api/_routes/support/sync.js, every 5 minutes).
 * One reply per new email conversation, in the customer's own thread, and at
 * most one per customer a day. Never to: history the backfill found, filtered
 * senders, our own domain, a teammate's forward, a bounce, a no-reply or
 * vendor address (Artelo, Shopify, Etsy), anything whose headers say a
 * machine sent it (out-of-office, newsletters: that stops two auto-replies
 * writing to each other), a sender that failed the DMARC check, mail more
 * than 2 hours old, or a conversation a person already answered.
 *
 * The reply is stored with `auto` set, and nothing counts it as an answer:
 * the conversation stays Open, Claude still drafts, triage still runs, the
 * waiting badge keeps counting (mailbox.js refreshThread). Off until an admin
 * switches it on in Support > Settings > Auto-reply.
 *
 * A customer with an order they can still change gets its own Manage your
 * order link in place of the general line (personalizeReply), only when the
 * order's email is exactly theirs.
 */
import prisma from '../../db.js'
import { sendReply, isOurs, isBounce } from './mailbox.js'
import { replyToHtml, replyToPlain } from './format.js'
import { UserError } from './errors.js'
import { openManageLinks } from '../orders/selfServeOrder.js'

const KEY = 'support_autoreply'
export const DEFAULT_AUTO_REPLY = `Hey [First name],

Thanks for reaching out! We got your message, and a real person on our team will get back to you within 48 hours.

Thanks,
The Trackstar Team`

const FRESH_MS = 2 * 60 * 60 * 1000 // older mail (the sync was down) gets a person's reply, not a late "we got it"
const PER_CUSTOMER_MS = 24 * 60 * 60 * 1000
const NO_REPLY = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer|bounces?|alerts?|automated|system)([+._-]|@)/i
const VENDOR_DOMAINS = ['artelo.com', 'artelo.io', 'shopify.com', 'myshopify.com', 'etsy.com', 'paypal.com', 'stripe.com', 'klaviyo.com']

export async function getAutoReply() {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } }).catch(() => null)
  try {
    const v = JSON.parse(row?.value || '{}')
    return { enabled: v.enabled === true, text: String(v.text || '').trim() || DEFAULT_AUTO_REPLY }
  } catch { return { enabled: false, text: DEFAULT_AUTO_REPLY } }
}

export async function saveAutoReply({ enabled, text }) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim()
  if (t.length < 20) throw new UserError('Write the reply first (at least a sentence).')
  if (t.length > 2000) throw new UserError('Keep the reply under 2,000 characters.')
  const value = JSON.stringify({ enabled: Boolean(enabled), text: t })
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } })
  return getAutoReply()
}

/** "Hey [First name]," with the customer's first name, or "there" when we have no real name. Pure. */
export function fillReply(text, customerName) {
  const first = String(customerName || '').trim().split(/\s+/)[0] || ''
  const name = /^[\p{L}'-]{2,}$/u.test(first) ? first[0].toUpperCase() + first.slice(1).toLowerCase() : 'there'
  return String(text).replace(/\[first name\]/gi, name)
}

const untilLabel = d => `${new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`

/**
 * Their own Manage your order link(s) in the reply, when they have an order
 * they can still change (openManageLinks). The line in the wording that
 * mentions Manage your order is replaced by one line per order; wording with
 * no such line gets them after its first paragraph. No links: the wording
 * as written. Pure.
 */
export function personalizeReply(text, links = []) {
  if (!links.length) return text
  const lines = links.map(l => `- **Need to change something on ${l.number ? `order #${l.number}` : 'your order'}?** You can fix the name, change the frame or photo, update the address, or cancel yourself until ${untilLabel(l.closesAt)}. [Manage your order](${l.url})`)
  const parts = String(text).split('\n')
  const at = parts.findIndex(p => /manage your order/i.test(p))
  if (at >= 0) { parts.splice(at, 1, ...lines); return parts.join('\n') }
  const para = String(text).split('\n\n')
  para.splice(Math.min(1, para.length), 0, lines.join('\n'))
  return para.join('\n\n')
}

/**
 * Why a conversation gets no auto-reply, or null when it should. Pure.
 *   thread     the SupportThread
 *   first      its first message
 *   forwarded  a teammate forwarded it in
 *   recent     this customer already got an auto-reply in the last day
 */
export function skipReason({ thread, first, forwarded = false, recent = false, now = Date.now(), mailbox }) {
  const email = String(thread?.customerEmail || '').toLowerCase()
  if (!thread || thread.channel !== 'email') return 'not email'
  if (thread.autoRepliedAt) return 'already sent'
  if (thread.backfilled) return 'history'
  if (thread.filtered) return 'filtered sender'
  if (thread.mergedIntoId) return 'merged'
  if (thread.lastOutboundAt) return 'already answered'
  if (!first || first.direction !== 'in') return 'we started it'
  if (!email || isOurs(email, mailbox)) return 'our own address'
  if (forwarded) return 'forwarded by a teammate'
  if (first.auto) return 'sent by a machine'
  if (isBounce(first)) return 'bounce'
  if (first.senderCheck === 'fail') return 'failed the sender check'
  if (NO_REPLY.test(email)) return 'no-reply address'
  const domain = email.split('@')[1] || ''
  if (VENDOR_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) return 'vendor'
  if (now - new Date(first.sentAt).getTime() > FRESH_MS) return 'too old'
  if (recent) return 'replied to this customer today'
  return null
}

/** Send the auto-reply to every new conversation that should get one. Never throws for one bad thread. */
export async function sendAutoReplies({ limit = 25 } = {}) {
  const cfg = await getAutoReply()
  if (!cfg.enabled) return { enabled: false, sent: 0 }
  const now = Date.now()
  const since = new Date(now - FRESH_MS)
  const threads = await prisma.supportThread.findMany({
    where: { channel: 'email', status: 'open', autoRepliedAt: null, backfilled: false, filtered: false, mergedIntoId: null, lastOutboundAt: null, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: {
      messages: { orderBy: { sentAt: 'asc' }, take: 1 },
      notes: { where: { kind: 'event', body: { contains: ' forwarded this from ' } }, take: 1, select: { id: true } },
    },
  })
  let sent = 0, failed = 0
  const skipped = {}
  for (const t of threads) {
    const recent = t.customerEmail ? await prisma.supportThread.count({
      where: { id: { not: t.id }, customerEmail: { equals: t.customerEmail, mode: 'insensitive' }, autoRepliedAt: { gte: new Date(now - PER_CUSTOMER_MS) } },
    }) > 0 : false
    const why = skipReason({ thread: t, first: t.messages[0], forwarded: t.notes.length > 0, recent, now })
    if (why) {
      skipped[why] = (skipped[why] || 0) + 1
      // Mail that will never get one is marked, so it is not looked at again every five minutes.
      if (why !== 'already sent') await prisma.supportThread.updateMany({ where: { id: t.id, autoRepliedAt: null }, data: { autoRepliedAt: new Date(0) } })
      continue
    }
    // Claim it first: two syncs at once must not both send.
    const claimed = await prisma.supportThread.updateMany({ where: { id: t.id, autoRepliedAt: null, lastOutboundAt: null }, data: { autoRepliedAt: new Date() } })
    if (!claimed.count) continue
    // Their own Manage your order link when an order of theirs can still change; the plain wording if anything goes wrong.
    const links = await openManageLinks(t.customerEmail).catch(err => { console.warn(`[support.autoReply] links ${t.id}: ${err.message}`); return [] })
    const text = personalizeReply(fillReply(cfg.text, t.customerName), links)
    try {
      // Shown in the conversation as a grey "Auto-reply sent" line (Conversation.tsx), not a reply.
      await sendReply({ userId: null, thread: t, html: replyToHtml(text), text: replyToPlain(text), auto: true })
      sent++
    } catch (err) {
      // Not sent: free it for the next sync to try again.
      await prisma.supportThread.update({ where: { id: t.id }, data: { autoRepliedAt: null } }).catch(() => {})
      failed++
      console.warn(`[support.autoReply] ${t.id}: ${err.message}`)
    }
  }
  return { enabled: true, sent, failed, skipped }
}
