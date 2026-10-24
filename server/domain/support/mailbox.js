/**
 * The support mailbox: fast@trackstar.art, mirrored into Postgres.
 *
 * One Gmail account, one grant, shared by everyone who works the inbox. That
 * is the difference from Sales, where each rep connects their own Gmail: a
 * customer writes to fast@ and the reply has to come from fast@, whoever
 * presses Send. The grant is made once, by an admin signed in to Google as
 * that account, and the refresh token lives in SystemConfig under keys of
 * its own. The OAuth client, the error handling and the MIME builder are the
 * Sales ones (server/domain/sales/gmail.js); only the scope and the keys
 * differ.
 *
 * Scope is gmail.modify: read the mailbox, send from it, and clear UNREAD on
 * a thread once someone here has answered it, so a person who still opens
 * Gmail sees the same state. Never gmail full access, which would allow
 * permanent deletion.
 *
 * Two ways mail gets in:
 *
 *   backfill  Once, in chunks of a few hundred messages per call, oldest
 *             threads and all, so the page has the history on day one and
 *             the drafting that comes later can learn from Matt's replies.
 *             Threads that were already over are marked backfilled and
 *             closed.
 *   sync      Every few minutes from a cron. Gmail's history.list from the
 *             last history id is one cheap call when nothing has changed,
 *             which it mostly has not at 3 emails a day in July.
 *
 * A message is stored once, by its Gmail id, so running either twice is
 * harmless. Sending from here goes through the API with the Gmail thread id,
 * and the sent message is read back and stored like any other, tagged with
 * who pressed Send.
 */
import { google } from '../../lib/google.js'
import prisma from '../../db.js'
import { unwrapForward } from './forwards.js'
import { isForwarder } from './forwarders.js'
import { oauthClient, originFor, isRevokedToken, buildMime, base64url, newMessageId } from '../sales/gmail.js'
import { defaultAssigneeId } from './routing.js'
import { isFiltered } from './filters.js'
import { UserError } from './errors.js'
import { requireConnection } from '../../lib/connections.js'

const SCOPE_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
const SCOPES = [SCOPE_MODIFY]

const KEY_REFRESH = 'support_gmail_refresh_token'
const KEY_EMAIL = 'support_gmail_email'
const KEY_SCOPES = 'support_gmail_scopes'
const KEY_HISTORY = 'support_gmail_history_id'
const KEY_BACKFILL_PAGE = 'support_backfill_page'
const KEY_BACKFILL_DONE = 'support_backfill_done'
const KEY_BACKFILL_COUNT = 'support_backfill_count'

/** Mail that is not support: Gmail's own buckets, drafts, chats. */
const MAIL_QUERY = '-in:spam -in:trash -in:draft -in:chats -category:promotions -category:social'

/** A thread whose last message is older than this is history when backfilled, not work. */
const BACKFILL_CLOSE_AFTER_DAYS = 14

/** The address the grant must be for. Connecting as anyone else is refused. */
export function mailboxEmail() {
  return String(process.env.SUPPORT_MAILBOX_EMAIL || 'fast@trackstar.art').trim().toLowerCase()
}

async function getConfig(key) {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  return row?.value || null
}
async function setConfig(key, value) {
  await prisma.systemConfig.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } })
}
async function delConfig(...keys) {
  await prisma.systemConfig.deleteMany({ where: { key: { in: keys } } })
}

// ---------------------------------------------------------------------------
// The grant
// ---------------------------------------------------------------------------

export function redirectUriFor(req) {
  return `${originFor(req)}/api/support/gmail-callback`
}

/** `state` is the round trip's check value (oauthState.js). */
export function getAuthUrl(redirectUri, state) {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    // Pre-fills the account chooser; Google still lets the person pick another, which completeConnection refuses.
    login_hint: mailboxEmail(),
  })
}

/**
 * Exchange the code, check it is the support account, keep the refresh token
 * and record where the mailbox's history stands so the first sync starts
 * from now rather than from the beginning of time.
 */
export async function completeConnection(code, redirectUri) {
  const client = oauthClient(redirectUri)
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new UserError('Google did not return a refresh token. Remove the app under Google Account > Security > Third-party access for the support account and connect again.', { reason: 'no_refresh_token' })
  }
  client.setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: client })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const email = String(profile.data.emailAddress || '').toLowerCase()
  if (email !== mailboxEmail()) {
    await client.revokeCredentials().catch(() => {})
    throw new UserError(`That signed in as ${email}, not ${mailboxEmail()}. Sign in to Google as the support account and connect again.`, { reason: 'wrong_account' })
  }
  await setConfig(KEY_REFRESH, tokens.refresh_token)
  await setConfig(KEY_SCOPES, String(tokens.scope || SCOPES.join(' ')))
  await setConfig(KEY_EMAIL, email)
  if (profile.data.historyId) await setConfig(KEY_HISTORY, profile.data.historyId)
  return { email }
}

export async function disconnect() {
  await delConfig(KEY_REFRESH, KEY_EMAIL, KEY_SCOPES, KEY_HISTORY)
}

/** For Settings > Connections: one real Gmail call, returning the address. */
export async function ping() {
  const gmail = await client()
  const profile = await gmail.users.getProfile({ userId: 'me' })
  return String(profile.data.emailAddress || '')
}

export async function status() {
  const configured = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
  const refresh = configured ? await getConfig(KEY_REFRESH) : null
  const [email, done, count, page] = await Promise.all([
    getConfig(KEY_EMAIL), getConfig(KEY_BACKFILL_DONE), getConfig(KEY_BACKFILL_COUNT), getConfig(KEY_BACKFILL_PAGE),
  ])
  const lastSync = await prisma.supportMessage.aggregate({ where: { channel: 'email' }, _max: { createdAt: true } })
  return {
    configured,
    connected: Boolean(refresh),
    email,
    expectedEmail: mailboxEmail(),
    backfill: { done: done === 'true', count: Number(count || 0), inProgress: Boolean(page) && done !== 'true' },
    lastImportedAt: lastSync._max.createdAt,
  }
}

// Kept for the life of a warm instance: a new OAuth client per run meant a
// fresh token exchange with Google every five minutes. googleapis refreshes
// the access token itself when it expires.
let cachedClient = null

async function client() {
  await requireConnection('support_gmail')
  const refresh = await getConfig(KEY_REFRESH)
  if (!refresh) throw new UserError('The support mailbox is not connected. An admin connects it from the Support page.')
  if (cachedClient?.refresh === refresh) return cachedClient.gmail
  const auth = oauthClient()
  auth.setCredentials({ refresh_token: refresh })
  cachedClient = { refresh, gmail: google.gmail({ version: 'v1', auth }) }
  return cachedClient.gmail
}

/** One read: whether the mailbox is connected. What the sync cron needs; status() is for the page. */
export async function isConnected() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) && Boolean(await getConfig(KEY_REFRESH))
}

/**
 * Gmail's per-user quota is a per-minute budget, and a burst of reads
 * (the history import, or Refresh pressed twice) can spend it. Google says
 * so with a 429, or a 403 naming the quota. Wait and try again, longer each
 * time, for about a minute in all; past that the caller's error stands.
 */
function isQuotaError(err) {
  const text = `${err?.message || ''} ${JSON.stringify(err?.response?.data?.error || '')}`
  return err?.code === 429 || /quota|rateLimitExceeded|userRateLimitExceeded|Too Many Requests/i.test(text)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function withRetry(fn, { tries = 5, label = 'gmail' } = {}) {
  let wait = 3000
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isQuotaError(err) || attempt >= tries) throw err
      const retryAfter = Number(err?.response?.headers?.['retry-after']) * 1000
      const ms = Math.min(retryAfter || wait, 30_000)
      console.warn(`[support] ${label}: Gmail quota, waiting ${Math.round(ms / 1000)}s (try ${attempt} of ${tries})`)
      await sleep(ms)
      wait *= 2
    }
  }
}

/** A revoked grant is forgotten so the page offers Connect again, with the usual advice. */
async function onGmailError(err) {
  if (isQuotaError(err)) {
    throw new UserError('Gmail is rate limiting us for a minute. The import picks up where it left off; press it again shortly, or just wait, it retries on its own.')
  }
  if (!isRevokedToken(err)) throw err
  await delConfig(KEY_REFRESH)
  throw new UserError(
    'The support mailbox disconnected: Google rejected the saved credential. An admin has to press Connect again. '
    + 'If this keeps happening weekly, the OAuth consent screen is still in Testing, which expires refresh tokens after 7 days.'
  )
}

// ---------------------------------------------------------------------------
// Reading a message
// ---------------------------------------------------------------------------

function decodeBody(data) {
  if (!data) return ''
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** "Jane Doe <jane@x.com>" -> { name: 'Jane Doe', email: 'jane@x.com' }. */
export function parseAddress(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() }
  const bare = s.replace(/^<|>$/g, '').trim()
  return { name: '', email: bare.toLowerCase() }
}

/** Every address in a To/Cc header, lowercased, comma-joined. */
function addressList(raw) {
  return String(raw || '').split(',').map(a => parseAddress(a).email).filter(Boolean).join(', ')
}

/** HTML to readable text, for mail that came with no text/plain part. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // A line break in the HTML source is only a space; the tags say where lines end.
    // Without this, "<div>a</div>\n<div>b</div>" read as a blank line between every line.
    .replace(/[ \t]*[\r\n]+[ \t]*/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The part of a reply the person actually wrote, before the quoted thread
 * underneath. Mail clients mark the quote a dozen ways; these cover Gmail,
 * Apple Mail, Outlook and plain ">" quoting.
 */
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const markers = [
    /^On .{3,200}wrote:\s*$/,
    /^On .{3,200}wrote:$/,
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^-{2,}\s*Forwarded message\s*-{2,}/i,
    /^From:\s.*$/,
    /^Sent from my (iPhone|iPad|Galaxy|Android)/i,
    /^_{5,}$/,
  ]
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (l.startsWith('>')) { cut = i; break }
    // "On Mon, Oct 6, 2026 at 3:12 PM Trackstar <fast@trackstar.art>" sometimes wraps onto a second line ending in "wrote:".
    if (markers.some(m => m.test(l)) || (l.startsWith('On ') && i + 1 < lines.length && /wrote:\s*$/.test(lines[i + 1].trim()))) { cut = i; break }
  }
  return lines.slice(0, cut).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Walk the MIME tree once and keep the three things that matter. */
function collectParts(payload, out) {
  if (!payload) return
  const mime = String(payload.mimeType || '')
  const filename = payload.filename || ''
  if (filename && payload.body?.attachmentId) {
    out.attachments.push({ filename, mimeType: mime, size: payload.body.size || 0, attachmentId: payload.body.attachmentId })
  } else if (mime === 'text/plain' && payload.body?.data && !out.text) {
    out.text = decodeBody(payload.body.data)
  } else if (mime === 'text/html' && payload.body?.data && !out.html) {
    out.html = decodeBody(payload.body.data)
  }
  for (const p of payload.parts || []) collectParts(p, out)
}

/** One Gmail message (format=full) as the row it becomes. */
export function parseMessage(msg, mailbox) {
  const h = Object.fromEntries((msg.payload?.headers || []).map(x => [String(x.name).toLowerCase(), x.value]))
  const parts = { text: '', html: '', attachments: [] }
  collectParts(msg.payload, parts)
  const from = parseAddress(h.from)
  const labels = msg.labelIds || []
  const direction = isOurs(from.email, mailbox) || labels.includes('SENT') ? 'out' : 'in'
  const bodyText = (parts.text || htmlToText(parts.html)).replace(/\r/g, '').trim()
  const parsed = {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    rfcMessageId: h['message-id'] || null,
    inReplyTo: h['in-reply-to'] || null,
    direction,
    fromEmail: from.email,
    fromName: from.name,
    toEmails: addressList(h.to),
    ccEmails: addressList(h.cc),
    subject: String(h.subject || '').trim(),
    bodyText,
    bodyHtml: parts.html || null,
    attachments: parts.attachments,
    sentAt: msg.internalDate ? new Date(Number(msg.internalDate)) : (h.date ? new Date(h.date) : new Date()),
    labels,
  }
  // A teammate forwarding a customer's email to fast@: it becomes the customer's message (forwards.js).
  const fwd = unwrapForward(parsed, { isOurs: e => isOurs(e, mailbox || mailboxEmail()) })
  return fwd ? { ...fwd.message, forward: { note: fwd.note, by: fwd.forwardedBy } } : parsed
}

/**
 * Whether an address is one of ours: the mailbox itself, or anyone on its
 * domain. Matt writes to customers from matt@trackstar.art with fast@ in
 * the thread, and those are our replies, not a customer called Matt.
 */
export function isOurs(email, mailbox = mailboxEmail()) {
  const e = String(email || '').toLowerCase()
  if (!e) return false
  if (e === mailbox) return true
  const domain = mailbox.split('@')[1]
  return Boolean(domain) && e.endsWith(`@${domain}`)
}

/** A thread's subject without the Re: / Fwd: pile-up. */
function cleanSubject(s) {
  return String(s || '').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').trim()
}

/** The other party on a message: the sender when inbound, the first recipient that is not us when outbound. */
function counterpart(m, mailbox) {
  if (m.direction === 'in') return { email: m.fromEmail, name: m.fromName }
  const to = m.toEmails.split(',').map(s => s.trim()).filter(e => e && !isOurs(e, mailbox))
  return { email: to[0] || '', name: '' }
}

/**
 * Store one message and bring its thread up to date. Safe to call again for
 * the same message: the row is keyed by Gmail's id and `sentById` is only
 * ever set, never cleared, so the sync re-reading a message we sent keeps
 * the name of who sent it.
 */
export async function importMessage(parsed, { sentById = null, backfill = false, mailbox, threadId = null } = {}) {
  const mb = mailbox || mailboxEmail()
  // Drafts show up in history as they are typed; they are not mail yet.
  if (parsed.labels?.includes('DRAFT')) return null
  // A forward from a teammate's other inbox (not our domain, which parseMessage
  // already handles): listed in Settings, or a teammate's sign-in address.
  if (!parsed.forward && parsed.direction === 'in' && !parsed.labels?.includes('SENT') && await isForwarder(parsed.fromEmail)) {
    const sender = String(parsed.fromEmail || '').toLowerCase()
    const fwd = unwrapForward(parsed, { isOurs: e => isOurs(e, mb) || String(e || '').toLowerCase() === sender })
    if (fwd) parsed = { ...fwd.message, forward: { note: fwd.note, by: fwd.forwardedBy } }
  }

  // A reply we just sent belongs to the conversation it was sent from, even if Gmail filed it on a thread of its own.
  let thread = threadId ? await prisma.supportThread.findUnique({ where: { id: threadId } }) : null
  if (!thread) thread = await prisma.supportThread.findUnique({ where: { gmailThreadId: parsed.gmailThreadId } })
  // A new Gmail thread that answers one of our messages (a forwarded customer writing back) joins that conversation.
  if (!thread && parsed.inReplyTo) {
    const parent = await prisma.supportMessage.findFirst({ where: { rfcMessageId: parsed.inReplyTo }, select: { threadId: true } })
    if (parent) thread = await prisma.supportThread.findUnique({ where: { id: parent.threadId } })
  }
  // Merged away: the message belongs to the conversation it was folded into.
  for (let hop = 0; thread?.mergedIntoId && hop < 5; hop++) {
    thread = await prisma.supportThread.findUnique({ where: { id: thread.mergedIntoId } }) || thread
  }
  const who = counterpart(parsed, mb)
  if (!thread) {
    thread = await prisma.supportThread.create({
      data: {
        channel: 'email',
        gmailThreadId: parsed.gmailThreadId,
        subject: cleanSubject(parsed.subject),
        customerEmail: who.email,
        customerName: who.name,
        status: parsed.direction === 'in' ? 'open' : 'waiting',
        lastMessageAt: parsed.sentAt,
        backfilled: backfill,
        // A sender the team filtered out (vendors, alerts) is filed, not routed.
        filtered: await isFiltered(who.email),
        // New conversations go to the person set under Routing; history and filtered mail go to nobody.
        assigneeId: backfill || await isFiltered(who.email) ? null : await defaultAssigneeId('email'),
      },
    })
  }

  const row = {
    threadId: thread.id,
    channel: 'email',
    rfcMessageId: parsed.rfcMessageId,
    inReplyTo: parsed.inReplyTo,
    direction: parsed.direction,
    fromEmail: parsed.fromEmail,
    fromName: parsed.fromName,
    toEmails: parsed.toEmails,
    ccEmails: parsed.ccEmails,
    subject: parsed.subject,
    bodyText: parsed.bodyText,
    bodyHtml: parsed.bodyHtml,
    attachments: parsed.attachments,
    sentAt: parsed.sentAt,
  }
  const existed = await prisma.supportMessage.findUnique({ where: { gmailMessageId: parsed.gmailMessageId }, select: { id: true, direction: true, fromEmail: true } })
  // A forward already unwrapped into the customer's message stays unwrapped: a later read
  // that sees only "our teammate's email" (code from before a forward format was understood,
  // still running in a tab opened earlier) must not turn it back.
  const keepForward = existed?.direction === 'in' && !parsed.forward && !parsed.labels?.includes('SENT')
    && String(existed.fromEmail || '').toLowerCase() !== String(parsed.fromEmail || '').toLowerCase()
    && (isOurs(parsed.fromEmail, mb) || await isForwarder(parsed.fromEmail))
  const message = await prisma.supportMessage.upsert({
    where: { gmailMessageId: parsed.gmailMessageId },
    create: { ...row, gmailMessageId: parsed.gmailMessageId, sentById },
    update: keepForward ? {} : sentById ? { ...row, sentById } : row,
  })

  if (parsed.forward && !existed) await noteForward(thread.id, parsed.forward)

  await refreshThread(thread, message, { backfill, mailbox: mb })
  return message
}

/** Who forwarded it, and what they wrote above the forward, as the team's own lines on the conversation. */
async function noteForward(threadId, { note, by }) {
  const user = by?.email ? await prisma.user.findFirst({ where: { email: { equals: by.email, mode: 'insensitive' } }, select: { id: true, firstName: true, lastName: true } }) : null
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : (by?.name || by?.email || 'Someone')
  const data = [{ threadId, kind: 'event', body: `${name} forwarded this from ${by?.email || 'their email'}`, authorId: user?.id || null, authorName: name }]
  if (note) data.push({ threadId, kind: 'note', body: note.slice(0, 4000), authorId: user?.id || null, authorName: name })
  await prisma.supportNote.createMany({ data })
}

/**
 * Recompute what the list shows from the thread's messages, and move the
 * status when the message just stored is the newest one. Aggregating rather
 * than incrementing means the backfill, which reads newest first, lands on
 * the same answer as the sync, which reads oldest first. Shared with the
 * Instagram channel (instagram.js), which stores rows of the same shape:
 * `stored` is the SupportMessage row just written, whatever channel.
 */
export async function refreshThread(thread, stored, { backfill = false, mailbox = '', replay = false } = {}) {
  const [agg, newest, oldest, lastIn, lastOut] = await Promise.all([
    prisma.supportMessage.aggregate({ where: { threadId: thread.id }, _count: { _all: true }, _max: { sentAt: true } }),
    prisma.supportMessage.findFirst({ where: { threadId: thread.id }, orderBy: { sentAt: 'desc' }, select: { id: true, direction: true, bodyText: true, sentAt: true } }),
    prisma.supportMessage.findFirst({ where: { threadId: thread.id }, orderBy: { sentAt: 'asc' }, select: { subject: true, direction: true, fromEmail: true, fromName: true, toEmails: true } }),
    prisma.supportMessage.findFirst({ where: { threadId: thread.id, direction: 'in' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
    prisma.supportMessage.findFirst({ where: { threadId: thread.id, direction: 'out' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
  ])
  const data = {
    messageCount: agg._count._all,
    lastMessageAt: agg._max.sentAt || thread.lastMessageAt,
    lastInboundAt: lastIn?.sentAt || null,
    lastOutboundAt: lastOut?.sentAt || null,
    snippet: stripQuoted(newest?.bodyText || '').replace(/\s+/g, ' ').slice(0, 160),
  }
  // The subject and the customer come from the first message of the thread.
  if (oldest) {
    const subj = cleanSubject(oldest.subject)
    if (subj && (!thread.subject || thread.subject !== subj)) data.subject = subj
    const who = counterpart(oldest, mailbox)
    if (who.email && thread.customerEmail !== who.email) { data.customerEmail = who.email; data.customerName = who.name }
    else if (who.name && !thread.customerName) data.customerName = who.name
  }

  // Status moves only on the newest message, and only on the sync's rules:
  // in -> open (unless escalated), out -> waiting (only from open). A
  // message we already had (a replayed webhook, a backfill re-read) is not
  // news, so it never reopens a closed thread.
  const isNewest = newest && newest.id === stored.id
  const isNewer = !replay && isNewest && (!thread.lastMessageAt || new Date(stored.sentAt) >= new Date(thread.lastMessageAt))
  if (isNewer) {
    if (stored.direction === 'in' && thread.status !== 'escalated' && thread.status !== 'open') data.status = 'open'
    if (stored.direction === 'out' && thread.status === 'open') data.status = 'waiting'
    if (stored.direction === 'in' && thread.snoozedUntil) data.snoozedUntil = null
  }
  if (backfill) {
    const ageDays = (Date.now() - new Date(data.lastMessageAt).getTime()) / 86400000
    if (ageDays > BACKFILL_CLOSE_AFTER_DAYS) data.status = 'closed'
    data.backfilled = true
  }
  await prisma.supportThread.update({ where: { id: thread.id }, data })
}

// ---------------------------------------------------------------------------
// Getting mail in
// ---------------------------------------------------------------------------

/** The ids in this list the mirror does not have yet. Re-reading what is stored costs Gmail quota for nothing. */
export async function missingIds(ids) {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const have = await prisma.supportMessage.findMany({ where: { gmailMessageId: { in: unique } }, select: { gmailMessageId: true } })
  const known = new Set(have.map(m => m.gmailMessageId))
  return unique.filter(id => !known.has(id))
}

/**
 * Fetch and store the messages the mirror is missing, a few at a time.
 * Returns how many failed: a caller must not move past a list with
 * failures in it, or those messages are lost for good. That is what
 * happened on the first import, when Gmail's quota bit and the page was
 * marked done anyway.
 */
async function importIds(gmail, ids, opts) {
  const mailbox = mailboxEmail()
  let imported = 0
  let failed = 0
  const queue = await missingIds(ids)
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()
      try {
        const res = await withRetry(() => gmail.users.messages.get({ userId: 'me', id, format: 'full' }), { label: `message ${id}` })
        const parsed = parseMessage(res.data, mailbox)
        if (await importMessage(parsed, { ...opts, mailbox })) imported++
      } catch (err) {
        // A message deleted between list and get is a 404, gone for good; anything else is retried next time.
        if (err?.code !== 404) { failed++; console.warn(`[support] message ${id} not imported: ${err.message}`) }
      }
    }
  }
  // Three at a time: six tripped Gmail's per-minute quota on the first real import.
  await Promise.all(Array.from({ length: 3 }, worker))
  return { imported, failed }
}

/**
 * One chunk of the one-time import. Call until `done`. Progress is kept in
 * SystemConfig so a run that hits the function limit picks up where it left.
 * A page with any failure is not passed: the next call reads it again, and
 * what is already stored is skipped.
 */
export async function backfill({ pages = 2, pageSize = 100 } = {}) {
  const gmail = await client()
  if ((await getConfig(KEY_BACKFILL_DONE)) === 'true') {
    return { done: true, imported: 0, failed: 0, total: Number(await getConfig(KEY_BACKFILL_COUNT) || 0) }
  }
  let pageToken = (await getConfig(KEY_BACKFILL_PAGE)) || undefined
  let imported = 0
  let failed = 0
  let done = false
  try {
    for (let i = 0; i < pages; i++) {
      const res = await withRetry(() => gmail.users.messages.list({ userId: 'me', q: MAIL_QUERY, maxResults: pageSize, pageToken }), { label: 'backfill list' })
      const ids = (res.data.messages || []).map(m => m.id)
      const out = await importIds(gmail, ids, { backfill: true })
      imported += out.imported
      failed += out.failed
      if (out.failed) break // stay on this page; the next call retries what failed
      pageToken = res.data.nextPageToken || undefined
      if (!pageToken) { done = true; break }
      await setConfig(KEY_BACKFILL_PAGE, pageToken)
    }
  } catch (err) {
    await onGmailError(err)
  }
  const total = Number(await getConfig(KEY_BACKFILL_COUNT) || 0) + imported
  await setConfig(KEY_BACKFILL_COUNT, total)
  if (done) {
    await setConfig(KEY_BACKFILL_DONE, 'true')
    await delConfig(KEY_BACKFILL_PAGE)
  }
  if (failed) throw new UserError(`Gmail is rate limiting us for a minute (${failed} message${failed === 1 ? '' : 's'} waiting). The import picks up where it left off.`)
  return { done, imported, failed, total }
}

/** How far back the sweep double-checks that nothing was missed. */
const SWEEP_DAYS = 7
/** The sweep runs hourly, or at once when history could not be read. */
const SWEEP_EVERY_MS = 60 * 60_000
const KEY_LAST_SWEEP = 'support_gmail_last_sweep'

/**
 * Catch up with whatever changed since the last sync. history.list from the
 * saved id is one call when nothing happened. Gmail only keeps history for a
 * week or so; when the id is too old (404) it starts fresh from now.
 *
 * Once an hour (and whenever history could not be read) it also lists the
 * last week of mail and fetches anything the mirror does not have: what heals
 * a message lost to a quota error or a failed run. Every five minutes was
 * twelve times the Gmail reads for a mailbox that gets a few emails a day. The history id only moves forward
 * when every message was stored, so a failure is retried on the next run.
 */
export async function sync() {
  const gmail = await client()
  const mailbox = mailboxEmail()
  const startHistoryId = await getConfig(KEY_HISTORY)
  const profile = await gmail.users.getProfile({ userId: 'me' }).catch(onGmailError)
  const current = profile.data.historyId

  const ids = new Set()
  let mode = startHistoryId ? 'history' : 'initialised'
  if (startHistoryId) {
    let pageToken
    try {
      do {
        const res = await withRetry(() => gmail.users.history.list({
          userId: 'me', startHistoryId, historyTypes: ['messageAdded'], maxResults: 500, pageToken,
        }), { label: 'history' })
        for (const h of res.data.history || []) {
          for (const a of h.messagesAdded || []) {
            const labels = a.message?.labelIds || []
            if (labels.includes('DRAFT') || labels.includes('SPAM') || labels.includes('TRASH') || labels.includes('CHAT')) continue
            ids.add(a.message.id)
          }
        }
        pageToken = res.data.nextPageToken
      } while (pageToken)
    } catch (err) {
      if (err?.code !== 404) await onGmailError(err)
      mode = 'fallback' // history too old; the sweep below covers the gap
    }
  }

  // The sweep: the last week, whatever history said. Hourly, or now when
  // history did not cover the gap.
  const lastSweep = Number(await getConfig(KEY_LAST_SWEEP) || 0)
  const sweep = mode !== 'history' || Date.now() - lastSweep > SWEEP_EVERY_MS
  if (sweep) {
    let sweepToken
    let swept = 0
    do {
      const res = await withRetry(() => gmail.users.messages.list({ userId: 'me', q: `${MAIL_QUERY} newer_than:${SWEEP_DAYS}d`, maxResults: 500, pageToken: sweepToken }), { label: 'sweep list' })
      for (const m of res.data.messages || []) { ids.add(m.id); swept++ }
      sweepToken = res.data.nextPageToken
    } while (sweepToken && swept < 2000)
  }

  const out = await importIds(gmail, [...ids], { mailbox })
  if (!out.failed) {
    await setConfig(KEY_HISTORY, current)
    if (sweep) await setConfig(KEY_LAST_SWEEP, String(Date.now()))
  }
  return { ...out, mode, seen: ids.size, swept: sweep }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Reply on a thread, as the mailbox. Threads in Gmail by the thread id and in
 * the customer's client by In-Reply-To. The sent message is read back and
 * stored at once, with who sent it, so the page shows it without waiting
 * for the next sync. UNREAD comes off the thread in Gmail too.
 */
export async function sendReply({ userId, thread, html, text, attachments = [] }) {
  const gmail = await client()
  const mailbox = mailboxEmail()
  const last = await prisma.supportMessage.findFirst({ where: { threadId: thread.id }, orderBy: { sentAt: 'desc' } })
  const lastIn = await prisma.supportMessage.findFirst({ where: { threadId: thread.id, direction: 'in' }, orderBy: { sentAt: 'desc' } })
  const to = thread.customerEmail
  if (!to) throw new UserError('This thread has no customer address to reply to.')
  const subject = last?.subject && /^\s*re:/i.test(last.subject) ? last.subject : `Re: ${thread.subject || last?.subject || ''}`.trim()
  const messageId = newMessageId()
  const raw = base64url(buildMime({ to, subject, html, inReplyTo: lastIn?.rfcMessageId || last?.rfcMessageId || undefined, messageId, attachments }))
  let sent
  try {
    sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: thread.gmailThreadId } })
  } catch (err) {
    await onGmailError(err)
  }
  // Read it back so the row has Gmail's own headers and date.
  let stored = null
  try {
    const full = await gmail.users.messages.get({ userId: 'me', id: sent.data.id, format: 'full' })
    stored = await importMessage(parseMessage(full.data, mailbox), { sentById: userId, mailbox, threadId: thread.id })
  } catch (err) {
    console.warn(`[support] sent ${sent.data.id} but could not read it back: ${err.message}`)
    stored = await importMessage({
      gmailMessageId: sent.data.id, gmailThreadId: thread.gmailThreadId, rfcMessageId: messageId, inReplyTo: lastIn?.rfcMessageId || null,
      direction: 'out', fromEmail: mailbox, fromName: 'Trackstar', toEmails: to, ccEmails: '', subject, bodyText: text, bodyHtml: html,
      attachments: [], sentAt: new Date(), labels: ['SENT'],
    }, { sentById: userId, mailbox, threadId: thread.id })
  }
  try {
    await gmail.users.threads.modify({ userId: 'me', id: thread.gmailThreadId, requestBody: { removeLabelIds: ['UNREAD'] } })
  } catch (err) {
    console.warn(`[support] could not clear UNREAD on ${thread.gmailThreadId}: ${err.message}`)
  }
  return stored
}

/**
 * A new email from fast@ that starts its own conversation: the fulfillment
 * tool's "Email customer" (we need a bib number, a last name). Read back
 * and stored like any sent mail, so the conversation is in Support at once,
 * waiting on the customer, and their reply lands in it.
 */
export async function sendNew({ userId, to, subject, html, text, attachments = [] }) {
  const gmail = await client()
  const mailbox = mailboxEmail()
  const messageId = newMessageId()
  const raw = base64url(buildMime({ to, subject, html, messageId, attachments }))
  let sent
  try {
    sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
  } catch (err) {
    await onGmailError(err)
  }
  try {
    const full = await gmail.users.messages.get({ userId: 'me', id: sent.data.id, format: 'full' })
    return await importMessage(parseMessage(full.data, mailbox), { sentById: userId, mailbox })
  } catch (err) {
    console.warn(`[support] sent ${sent.data.id} but could not read it back: ${err.message}`)
    return importMessage({
      gmailMessageId: sent.data.id, gmailThreadId: sent.data.threadId, rfcMessageId: messageId, inReplyTo: null,
      direction: 'out', fromEmail: mailbox, fromName: 'Trackstar', toEmails: to, ccEmails: '', subject, bodyText: text, bodyHtml: html,
      attachments: [], sentAt: new Date(), labels: ['SENT'],
    }, { sentById: userId, mailbox })
  }
}

/** Bytes of one attachment, for the page to show or save. */
export async function attachmentBytes({ gmailMessageId, attachmentId }) {
  const gmail = await client()
  const res = await withRetry(() => gmail.users.messages.attachments.get({ userId: 'me', messageId: gmailMessageId, id: attachmentId }), { label: 'attachment' }).catch(onGmailError)
  return Buffer.from(String(res.data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * One stored message's attachment, by its place in the list, so the page
 * never names a Gmail id it did not get from us. Gmail can hand out a new
 * attachment id each time a message is read; when the stored one no longer
 * works, the message is read again and the same file (by name, else by
 * position) is fetched with the fresh id.
 */
export async function messageAttachment(messageId, index) {
  const m = await prisma.supportMessage.findUnique({ where: { id: messageId }, select: { gmailMessageId: true, attachments: true } })
  const list = Array.isArray(m?.attachments) ? m.attachments : []
  const a = list[index]
  if (!m?.gmailMessageId || !a?.attachmentId) return null
  try {
    return { ...a, bytes: await attachmentBytes({ gmailMessageId: m.gmailMessageId, attachmentId: a.attachmentId }) }
  } catch (err) {
    if (![400, 404].includes(err?.code)) throw err
    const gmail = await client()
    const full = await withRetry(() => gmail.users.messages.get({ userId: 'me', id: m.gmailMessageId, format: 'full' }), { label: 'attachment' }).catch(onGmailError)
    const parts = { text: '', html: '', attachments: [] }
    collectParts(full.data.payload, parts)
    const fresh = parts.attachments.find(p => p.filename === a.filename) || parts.attachments[index]
    if (!fresh) return null
    return { ...a, bytes: await attachmentBytes({ gmailMessageId: m.gmailMessageId, attachmentId: fresh.attachmentId }) }
  }
}
