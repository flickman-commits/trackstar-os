/**
 * Connections: every outside service TrackstarOS talks to, in one place.
 *
 * The doorman. Each service has one entry here, and each one's client checks
 * in with `requireConnection(id)` before it calls out. That gives the team
 * one page (Settings > Connections) to see what is connected, as whom, when
 * it was last used, and to switch a service off: a broken integration, a
 * leaked key, or a vendor having a bad day stops at this door instead of in
 * twenty places.
 *
 * What lives where:
 *   - Secrets (API keys, client secrets) stay in the environment (Vercel).
 *     This module only says whether each one is set, never its value.
 *   - Tokens from a connect flow (Gmail, Instagram, Etsy) stay where their
 *     flows already put them, in SystemConfig; the status reads them.
 *   - The on/off switch is one SystemConfig row, `connections_off`, a JSON
 *     list of the ids switched off. Read through a 30-second cache, so a
 *     switch reaches every warm instance within half a minute.
 *
 * Turning a service off makes its client throw ConnectionOffError with a
 * plain sentence. Jobs that already catch per-order errors (the import, the
 * sweep) carry on with everything else.
 */
import prisma from '../db.js'

/** An environment value, trimmed: a pasted value often carries a newline. */
const env = k => String(process.env[k] || '').trim()

const OFF_KEY = 'connections_off'
const USED_PREFIX = 'connection_used:'
const CACHE_MS = 30_000
const TOUCH_EVERY_MS = 5 * 60_000

/**
 * The registry. `env` lists the variables the service needs; `token` names a
 * SystemConfig key a connect flow fills; `as` reads who it is connected as.
 * `critical` services get a second confirm before they are switched off.
 */
export const CONNECTIONS = [
  { id: 'shopify', label: 'Shopify', what: 'Orders, products, discount codes, refunds and samples', env: ['SHOPIFY_STORE', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'], as: () => env('SHOPIFY_STORE') || null, critical: true },
  { id: 'etsy', label: 'Etsy', what: 'Etsy orders and personalization', env: ['ETSY_API_KEY', 'ETSY_SHARED_SECRET', 'ETSY_SHOP_ID'], token: 'etsy_refresh_token', connect: '/api/etsy/auth', as: () => (env('ETSY_SHOP_ID') ? `Shop ${env('ETSY_SHOP_ID')}` : null) },
  { id: 'artelo', label: 'Artelo', what: 'Print orders, costs, price checks and the print library', env: ['ARTELO_API_KEY'], critical: true },
  { id: 'gelato', label: 'Gelato', what: 'Overseas samples, printed and shipped near the recipient', env: ['GELATO_API_KEY'] },
  { id: 'support_gmail', label: 'Support Gmail', what: 'The shared inbox (fast@)', env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'], token: 'support_gmail_refresh_token', asKey: 'support_gmail_email', connect: '/api/support/gmail?action=connect' },
  { id: 'sales_gmail', label: 'Sales Gmail', what: "Each rep's own Gmail, for sales email", env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'], perPerson: 'gmail_refresh_token:', connect: '/api/sales/gmail?action=connect' },
  { id: 'instagram', label: 'Instagram', what: 'DMs to @trackstar_art in the shared inbox', env: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'], token: 'support_ig_access_token', asKey: 'support_ig_username', connect: '/api/support/instagram?action=connect' },
  { id: 'google_drive', label: 'Google Drive and Sheets', what: 'Approved designs to Drive, the Monopoly sheet', env: ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'], as: () => env('GOOGLE_SERVICE_ACCOUNT_EMAIL') || null },
  { id: 'attio', label: 'Attio', what: 'The CRM behind Sales', env: ['ATTIO_API_KEY'] },
  { id: 'claude', label: 'Claude', what: 'Support drafts, sales drafts, teaching, the research agent', envAny: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'LLM_BASE_URL'] },
  { id: 'resend', label: 'Resend (email)', what: 'Proof emails and designer messages to customers', env: ['RESEND_API_KEY'] },
  { id: 'slack', label: 'Slack', what: 'Team pings and alerts', envAny: ['SLACK_PROOF_WEBHOOK_URL', 'SLACK_WEBHOOK_URL', 'SLACK_CREATORS_WEBHOOK_URL'] },
  // Not a vendor: the Illustrator Mac(s) running worker/render-worker.mjs. It
  // is started on the Mac (npm run worker); a web page cannot launch it. Off
  // pauses the queue: workers keep checking in but are handed no jobs, and
  // new renders wait in the queue until it is turned back on.
  { id: 'render_worker', label: 'Render worker', what: 'The Illustrator Mac that renders designs. Off pauses the queue.', live: renderWorkerStatus },
]

/** Which Macs are checking in, and how much is waiting for them. */
async function renderWorkerStatus() {
  const ONLINE_MS = 90_000
  const [workers, queued, rendering] = await Promise.all([
    prisma.renderWorker.findMany({ orderBy: { lastSeenAt: 'desc' }, select: { name: true, lastSeenAt: true }, take: 10 }),
    prisma.renderJob.count({ where: { status: 'queued' } }),
    prisma.renderJob.count({ where: { status: 'rendering' } }),
  ])
  const online = workers.filter(w => Date.now() - new Date(w.lastSeenAt).getTime() < ONLINE_MS)
  return {
    connected: online.length > 0,
    connectedAs: online.length ? online.map(w => w.name).join(', ') : null,
    lastUsedAt: workers[0]?.lastSeenAt?.toISOString?.() || null,
    note: `${queued} waiting, ${rendering} rendering${online.length ? '' : ' · no Mac online: start it with npm run worker'}`,
  }
}
const BY_ID = new Map(CONNECTIONS.map(c => [c.id, c]))

/** A call to a service someone switched off. The message is fit to show. */
export class ConnectionOffError extends Error {
  constructor(id) {
    super(`${BY_ID.get(id)?.label || id} is switched off in Settings > Connections.`)
    this.name = 'ConnectionOffError'
    this.connection = id
    this.status = 503
    this.expose = true
  }
}

let offCache = { at: 0, value: new Set() }

async function offSet({ fresh = false } = {}) {
  if (!fresh && Date.now() - offCache.at < CACHE_MS) return offCache.value
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: OFF_KEY } })
    const list = row?.value ? JSON.parse(row.value) : []
    offCache = { at: Date.now(), value: new Set(Array.isArray(list) ? list : []) }
  } catch (err) {
    // Fail open on a read error: an unreadable switch must not take every
    // integration down with it. The previous value stays in force.
    console.warn(`[connections] could not read the switches: ${err.message}`)
    offCache = { at: Date.now(), value: offCache.value }
  }
  return offCache.value
}

export async function isConnectionOn(id) {
  return !(await offSet()).has(id)
}

/**
 * The door. Call before every outbound call to a service: throws
 * ConnectionOffError when it is switched off, and notes the use.
 */
export async function requireConnection(id) {
  if (!BY_ID.has(id)) throw new Error(`Unknown connection "${id}"`)
  if ((await offSet()).has(id)) throw new ConnectionOffError(id)
  touch(id)
}

const touched = new Map()
function touch(id) {
  const now = Date.now()
  if (now - (touched.get(id) || 0) < TOUCH_EVERY_MS) return
  touched.set(id, now)
  const key = USED_PREFIX + id, value = new Date(now).toISOString()
  prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } }).catch(() => {})
}

/** Switch a service on or off. Returns the new list of ids that are off. */
export async function setConnectionOn(id, on) {
  if (!BY_ID.has(id)) throw new Error(`Unknown connection "${id}"`)
  const off = new Set(await offSet({ fresh: true }))
  if (on) off.delete(id); else off.add(id)
  const value = JSON.stringify([...off].sort())
  await prisma.systemConfig.upsert({ where: { key: OFF_KEY }, update: { value }, create: { key: OFF_KEY, value } })
  offCache = { at: Date.now(), value: off }
  return [...off]
}

/**
 * What Settings > Connections shows: one row per service. Never a secret or
 * a token, only whether each is set.
 */
export async function connectionStatus() {
  const off = await offSet({ fresh: true })
  const keys = CONNECTIONS.flatMap(c => [c.token, c.asKey].filter(Boolean)).concat(CONNECTIONS.map(c => USED_PREFIX + c.id))
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } })
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]))
  const people = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'gmail_account_email:' } }, select: { value: true } })

  const live = Object.fromEntries(await Promise.all(CONNECTIONS.filter(c => c.live).map(async c => [c.id, await c.live().catch(() => null)])))

  return CONNECTIONS.map(c => {
    if (c.live) {
      const l = live[c.id] || {}
      return {
        id: c.id, label: c.label, what: c.what, on: !off.has(c.id), configured: true, missing: [],
        connected: Boolean(l.connected), needsConnect: false, connectUrl: null,
        connectedAs: l.connectedAs || null, critical: Boolean(c.critical), lastUsedAt: l.lastUsedAt || null, note: l.note || null,
      }
    }
    const missing = (c.env || []).filter(k => !env(k))
    const envOk = c.envAny ? c.envAny.some(k => env(k)) : missing.length === 0
    const tokenOk = c.token ? Boolean(cfg[c.token]) : c.perPerson ? people.length > 0 : true
    const connectedAs = c.asKey ? cfg[c.asKey] || null
      : c.perPerson ? (people.length ? people.map(p => p.value).join(', ') : null)
        : c.as ? c.as() : null
    return {
      id: c.id,
      label: c.label,
      what: c.what,
      on: !off.has(c.id),
      configured: envOk,
      missing: c.envAny ? (envOk ? [] : [c.envAny.join(' or ')]) : missing,
      connected: envOk && tokenOk,
      needsConnect: Boolean(c.connect) && envOk && !tokenOk,
      connectUrl: c.connect || null,
      connectedAs,
      critical: Boolean(c.critical),
      lastUsedAt: cfg[USED_PREFIX + c.id] || null,
      note: null,
    }
  })
}
