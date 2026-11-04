/**
 * Gmail drafts in Matt's own account.
 *
 * Cold email lives or dies on deliverability, and mail from the account a
 * person actually replies from beats anything sent through a transactional
 * provider. So the tool never sends: it writes a draft into Gmail and Matt
 * presses Send there. That also keeps a human on every outbound message.
 *
 * Auth is a one-time Google OAuth consent (gmail.compose scope: create drafts
 * and send; the app only creates drafts). The refresh token is persisted in
 * SystemConfig the same way the Etsy token is, so it survives cold starts.
 *
 * This is NOT the GOOGLE_SERVICE_ACCOUNT_* pair that googleSheets.js uses. A
 * service account has no mailbox of its own and cannot write into a person's
 * Gmail without domain-wide delegation, which would let it impersonate every
 * user in the domain. A far bigger grant than "let this app draft as me", so
 * this uses an ordinary OAuth client instead.
 *
 * Setup, once, in Google Cloud Console (the same project is fine):
 *   1. Enable the Gmail API.
 *   2. Create an OAuth client, type "Web application". Authorized redirect URIs:
 *        https://fast.trackstar.art/api/sales/gmail-callback
 *        http://localhost:3000/api/sales/gmail-callback
 *      Google rejects a redirect URI containing a query string, which is why
 *      the callback has its own path rather than ?action=callback.
 *   3. Put the client id and secret in GOOGLE_OAUTH_CLIENT_ID and
 *      GOOGLE_OAUTH_CLIENT_SECRET.
 *   4. Open Sales, press Connect Gmail.
 */
import crypto from 'crypto'
import { google } from '../../lib/google.js'
import prisma from '../../db.js'
import { UserError } from './errors.js'
import { requireConnection } from '../../lib/connections.js'

/**
 * compose: create drafts and send. metadata: read message headers (From, Date)
 * on our own threads, which is all reply detection needs; never a body.
 * Adding metadata after the first connection means Google asks for consent
 * again, so the status reports whether the stored grant covers it.
 */
const SCOPE_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose'
const SCOPE_METADATA = 'https://www.googleapis.com/auth/gmail.metadata'
// Drive, so approved custom designs can be copied into a folder in this
// person's My Drive (server/services/customGallery.js). A service account
// cannot own files there. Added later, so older grants need a reconnect.
const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive'
const SCOPES = [SCOPE_COMPOSE, SCOPE_METADATA, SCOPE_DRIVE]

/**
 * One connection per person. Keys are scoped by user id so a second rep can
 * connect their own mailbox without touching Matt's. The unscoped keys are
 * what the first version wrote; the first per-user read migrates them across
 * and they are never written again.
 */
const LEGACY_REFRESH = 'gmail_refresh_token'
const LEGACY_EMAIL = 'gmail_account_email'
const keyRefresh = userId => `gmail_refresh_token:${userId}`
const keyEmail = userId => `gmail_account_email:${userId}`
const keyScopes = userId => `gmail_scopes:${userId}`

function requireUser(userId) {
  if (!userId) throw new UserError('A user id is required for Gmail: connections are per person.')
  return String(userId)
}

export function isGmailConfigured() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
}

/** Shared with the support mailbox (server/domain/support/mailbox.js). */
export function oauthClient(redirectUri) {
  if (!isGmailConfigured()) throw new UserError('Gmail is not configured: set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET')
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri,
  )
}

async function getConfig(key) {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  return row?.value || null
}

async function setConfig(key, value) {
  await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
}

/** The user's refresh token, adopting the legacy unscoped one on first read. */
async function refreshTokenFor(userId) {
  const own = await getConfig(keyRefresh(userId))
  if (own) return own
  const legacy = await getConfig(LEGACY_REFRESH)
  if (!legacy) return null
  const legacyEmail = await getConfig(LEGACY_EMAIL)
  await setConfig(keyRefresh(userId), legacy)
  if (legacyEmail) await setConfig(keyEmail(userId), legacyEmail)
  await prisma.systemConfig.deleteMany({ where: { key: { in: [LEGACY_REFRESH, LEGACY_EMAIL] } } })
  console.log(`[gmail] migrated the unscoped Gmail connection to user ${userId}`)
  return legacy
}

/**
 * The origin this deployment is reachable at.
 *
 * Local dev has to use its own host or the OAuth round trip would bounce to
 * production mid-flow. Everything else uses the canonical domain, so preview
 * deployments do not each need a registered redirect URI of their own.
 */
export function originFor(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || ''
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  if (isLocal) return `http://${host}`
  return (process.env.APP_BASE_URL || process.env.APP_URL || `https://${host}`).replace(/\/$/, '')
}

/**
 * Where Google sends the browser back. Its own path, no query string: Google
 * rejects a redirect URI that carries one. Must match a URI registered on the
 * OAuth client exactly, and must be identical on the consent request and the
 * token exchange.
 */
export function redirectUriFor(req) {
  return `${originFor(req)}/api/sales/gmail-callback`
}

/** `state` is the round trip's check value (server/domain/support/oauthState.js). */
export function getAuthUrl(redirectUri, state) {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: 'offline',
    // Force the consent screen so Google returns a refresh token even when
    // the account has approved this app before.
    prompt: 'consent',
    scope: SCOPES,
    state,
  })
}

/** Why a connection was refused, as a short code the Sales page turns into words. */
export class ConnectionRefused extends Error {
  constructor(reason, message) { super(message); this.reason = reason }
}

/**
 * Exchange the code Google sent back, check whose mailbox it is, then keep
 * the refresh token. A rep connects their own Gmail and nobody else's: sends
 * go out under that address and the replies it reads are that person's, so
 * the address has to be the one they sign in to this app with.
 */
export async function completeConnection(code, redirectUri, userId) {
  const uid = requireUser(userId)
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { email: true } })
  if (!user?.email) throw new ConnectionRefused('no_user', 'That person is not in the app')
  const client = oauthClient(redirectUri)
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new ConnectionRefused('no_refresh_token', 'Google did not return a refresh token. Remove the app under Google Account > Security > Third-party access and connect again.')
  }
  client.setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: client })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const email = String(profile.data.emailAddress || '')
  if (!email || email.trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
    // Not theirs: hand the grant back rather than keep a token we will not use.
    await client.revokeCredentials().catch(() => {})
    throw new ConnectionRefused('wrong_account', `That signed in as ${email || 'an unknown account'}, not ${user.email}`)
  }
  await setConfig(keyRefresh(uid), tokens.refresh_token)
  await setConfig(keyScopes(uid), String(tokens.scope || SCOPES.join(' ')))
  await setConfig(keyEmail(uid), email)
  return { email }
}

export async function disconnectGmail(userId) {
  const uid = requireUser(userId)
  await prisma.systemConfig.deleteMany({ where: { key: { in: [keyRefresh(uid), keyEmail(uid), keyScopes(uid)] } } })
}

export async function gmailStatus(userId) {
  const configured = isGmailConfigured()
  if (!configured || !userId) return { configured, connected: false, email: null, canReadReplies: false }
  const refresh = await refreshTokenFor(String(userId))
  const email = refresh ? await getConfig(keyEmail(String(userId))) : null
  const scopes = refresh ? (await getConfig(keyScopes(String(userId))) || '') : ''
  return {
    configured,
    connected: Boolean(refresh),
    email,
    // A connection made before the metadata scope existed can send but not
    // see replies. Reconnecting fixes it; the UI says so.
    canReadReplies: scopes.includes(SCOPE_METADATA),
    canUseDrive: scopes.includes(SCOPE_DRIVE),
  }
}

/**
 * A Google Drive client acting as the first person whose connection includes
 * Drive, or null when nobody's does. Used by the custom gallery upload.
 */
export async function driveClientForAnyone() {
  await requireConnection('sales_gmail')
  const rows = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'gmail_scopes:' } } })
  for (const row of rows) {
    if (!String(row.value).includes(SCOPE_DRIVE)) continue
    const uid = row.key.slice('gmail_scopes:'.length)
    const refresh = await getConfig(keyRefresh(uid))
    if (!refresh) continue
    const client = oauthClient()
    client.setCredentials({ refresh_token: refresh })
    return google.drive({ version: 'v3', auth: client })
  }
  return null
}

async function gmailClient(userId) {
  await requireConnection('sales_gmail')
  const refresh = await refreshTokenFor(requireUser(userId))
  if (!refresh) throw new UserError('Gmail is not connected. Open Sales and press Connect Gmail.')
  const client = oauthClient()
  client.setCredentials({ refresh_token: refresh })
  return { gmail: google.gmail({ version: 'v1', auth: client }), uid: String(userId) }
}

/**
 * Google revokes a refresh token for several ordinary reasons, and every one
 * of them surfaces as the same opaque `invalid_grant`: the consent was
 * withdrawn, the password changed, or - the one that bites here - the OAuth
 * app is still in "Testing", where Google expires refresh tokens after seven
 * days. Forget the dead token so the UI offers Connect again rather than
 * showing a broken button, and say what to do about it.
 */
export function isRevokedToken(err) {
  const text = `${err?.message || ''} ${err?.response?.data?.error || ''}`
  return /invalid_grant|invalid_token|unauthorized_client/i.test(text)
}

async function handleGmailError(err, uid) {
  if (!isRevokedToken(err)) throw err
  await prisma.systemConfig.deleteMany({ where: { key: keyRefresh(uid) } })
  throw new UserError(
    'Gmail disconnected: Google rejected the saved credential. Press Connect Gmail again. '
    + 'If this keeps happening weekly, the OAuth consent screen is still in Testing, which expires refresh tokens after 7 days - set it to Internal, or publish it.'
  )
}

/** RFC 2047 encode a header value when it is not plain ASCII. */
function headerValue(s) {
  const v = String(s || '')
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?utf-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`
}

/** base64, wrapped at 76 characters as the MIME spec requires. */
function base64Lines(buf) {
  return (buf.toString('base64').match(/.{1,76}/g) || []).join('\r\n')
}

/**
 * Build the message.
 *
 * No attachments: a plain text/html part. Images: multipart/related, each
 * image carried with a Content-ID and referenced from the HTML as
 * <img src="cid:..."> at the end of the email, after the signature and any
 * P.S., so it shows in the message instead of only as a file to open. Gmail still
 * lists it as an attachment, so the copy's "attached" stays true. Files that
 * are not images (a deck, a PDF) wrap the whole thing in multipart/mixed and
 * hang off the end as ordinary attachments.
 *
 * `attachment` (singular) is still accepted for the old callers and tests.
 */
export function buildMime({ to, subject, html, text, inReplyTo, attachment, attachments, messageId }) {
  const list = [...(attachments || []), ...(attachment ? [attachment] : [])]
    .map(a => ({ ...a, inline: a.inline ?? /^image\//.test(a.contentType || '') }))
  const headers = [
    `To: ${headerValue(to)}`,
    `Subject: ${headerValue(subject)}`,
    'MIME-Version: 1.0',
  ]
  // Gmail keeps a Message-ID we supply, which lets a follow-up carry
  // In-Reply-To without a read scope to look the id up afterwards.
  if (messageId) headers.push(`Message-ID: ${messageId}`)
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`)
    headers.push(`References: ${inReplyTo}`)
  }

  // With `text`, the body is multipart/alternative: the plain text first,
  // the HTML second. HTML with no text part is one of the oldest spam
  // signals there is, and these emails were landing in spam. Each part comes
  // with its own Content-Type line, so it drops into related or mixed as is.
  const htmlOnly = h => ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', base64Lines(Buffer.from(h, 'utf8'))].join('\r\n')
  const bodyPart = h => {
    if (!text) return htmlOnly(h)
    const alt = `ts_${crypto.randomBytes(16).toString('hex')}`
    const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', base64Lines(Buffer.from(text, 'utf8'))].join('\r\n')
    return [`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`, textPart, `--${alt}`, htmlOnly(h), `--${alt}--`].join('\r\n')
  }

  if (!list.length) return `${headers.join('\r\n')}\r\n${bodyPart(html)}\r\n`

  const inline = list.filter(a => a.inline)
  const files = list.filter(a => !a.inline)

  // The images go at the very end, after the signature and any P.S. The
  // wrapper's own closing tag is the last one; the first </div> can be deep
  // inside the signature, which is where they used to land.
  const cids = inline.map(() => `img_${crypto.randomBytes(8).toString('hex')}`)
  const imgTags = cids.map(cid => `<p><img src="cid:${cid}" alt="Trackstar example" width="600" style="max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0;" /></p>`).join('\n')
  const end = html.lastIndexOf('</div>')
  const body = !inline.length ? html
    : end >= 0 ? `${html.slice(0, end)}${imgTags}\n${html.slice(end)}`
    : `${html}\n${imgTags}`

  const htmlPart = bodyPart(body)

  let inner = htmlPart
  let innerType = 'text/html; charset=utf-8'
  if (inline.length) {
    const rel = `ts_${crypto.randomBytes(16).toString('hex')}`
    const parts = [htmlPart, ...inline.map((a, i) => {
      const filename = a.filename || `image_${i + 1}.png`
      return [
        `Content-Type: ${a.contentType || 'image/png'}; name="${filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-ID: <${cids[i]}>`,
        `Content-Disposition: inline; filename="${filename}"`,
        '',
        base64Lines(a.bytes),
      ].join('\r\n')
    })]
    inner = [...parts.map(p => `--${rel}\r\n${p}`), `--${rel}--`].join('\r\n')
    innerType = `multipart/related; boundary="${rel}"; type="text/html"`
  }

  if (!files.length) {
    if (inline.length) {
      headers.push(`Content-Type: ${innerType}`)
      return `${headers.join('\r\n')}\r\n\r\n${inner}\r\n`
    }
  }

  const mixed = `ts_${crypto.randomBytes(16).toString('hex')}`
  headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`)
  const innerWrapped = inline.length ? `Content-Type: ${innerType}\r\n\r\n${inner}` : inner
  const fileParts = files.map((a, i) => {
    const filename = a.filename || `attachment_${i + 1}`
    return [
      `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      base64Lines(a.bytes),
    ].join('\r\n')
  })
  return [
    headers.join('\r\n'),
    '',
    `--${mixed}`,
    innerWrapped,
    ...fileParts.flatMap(p => [`--${mixed}`, p]),
    `--${mixed}--`,
    '',
  ].join('\r\n')
}

/**
 * Gmail wants the whole RFC 822 message base64url encoded. The message is
 * built as a string with every binary part already base64'd inside it, so
 * latin1 round-trips it byte for byte; utf8 would re-encode the high bytes.
 */
export function base64url(s) {
  return Buffer.from(s, 'latin1').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Plain text to the HTML the cadence templates use: Arial, 14px, one <p> per
 * paragraph, <br> inside a paragraph. Keeps drafts looking like a person typed
 * them rather than a newsletter.
 */
/**
 * One line of a draft as HTML: escaped, with the composer's links,
 * written [text](https://...), turned into real ones. Only http(s) and
 * mailto addresses become links; anything else stays as typed.
 */
const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g
export function lineToHtml(line) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let out = ''
  let last = 0
  for (const m of String(line).matchAll(LINK)) {
    out += esc(line.slice(last, m.index))
    out += `<a href="${esc(m[2]).replace(/"/g, '&quot;')}">${esc(m[1])}</a>`
    last = m.index + m[0].length
  }
  return out + esc(line.slice(last))
}

export function textToHtml(text) {
  // Same shape as composeHtml: no font set, so the reader's default applies.
  const paragraphs = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const inner = paragraphs.map(p => p.split('\n').map(line => `<div>${lineToHtml(line) || '<br>'}</div>`).join('\n')).join('\n<div><br></div>\n')
  return `<div>\n${inner}\n</div>`
}

/**
 * Create a draft. Returns Gmail's draft id, the message id, and the thread id
 * so a follow-up can land in the same thread later.
 */
/** A Message-ID of our own making, on our own domain. */
export function newMessageId() {
  return `<ts-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}@trackstar.art>`
}

/**
 * Send, as the connected account. This is the one place the app sends
 * anything, and it is only ever reached by a person pressing Send on an
 * email they have read. The undo window lives in the client; by the time
 * this runs, the decision is made.
 */
export async function sendMessage({ userId, to, subject, html, threadId, inReplyTo, attachment, attachments }) {
  const { gmail, uid } = await gmailClient(userId)
  const messageId = newMessageId()
  const raw = base64url(buildMime({ to, subject, html, inReplyTo, attachment, attachments, messageId }))
  const requestBody = { raw }
  if (threadId) requestBody.threadId = threadId
  let res
  try {
    res = await gmail.users.messages.send({ userId: 'me', requestBody })
  } catch (err) {
    await handleGmailError(err, uid)
  }
  return { gmailMessageId: res.data.id, threadId: res.data.threadId || threadId || null, rfcMessageId: messageId }
}

/**
 * Who said what, and when, on one of our threads. Headers only: the metadata
 * scope never sees a body, and reply detection does not need one.
 */
export async function threadMessages({ userId, threadId }) {
  const { gmail, uid } = await gmailClient(userId)
  let res
  try {
    res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['From', 'Date'] })
  } catch (err) {
    if (err?.code === 404) return []
    await handleGmailError(err, uid)
  }
  return (res.data.messages || []).map(m => {
    const h = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]))
    return { id: m.id, from: h.from || '', date: m.internalDate ? new Date(Number(m.internalDate)) : (h.date ? new Date(h.date) : null), labelIds: m.labelIds || [] }
  })
}

export async function createDraft({ userId, to, subject, html, threadId, inReplyTo, attachment, attachments }) {
  const { gmail, uid } = await gmailClient(userId)
  const raw = base64url(buildMime({ to, subject, html, inReplyTo, attachment, attachments }))
  const message = { raw }
  if (threadId) message.threadId = threadId
  let res
  try {
    res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message } })
  } catch (err) {
    await handleGmailError(err, uid)
  }
  return {
    draftId: res.data.id,
    messageId: res.data.message?.id || null,
    threadId: res.data.message?.threadId || threadId || null,
  }
}
