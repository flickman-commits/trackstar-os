/**
 * "Test" on Settings > Connections: one small, read-only call per service,
 * through the same client the rest of TrackstarOS uses (so a service that is
 * switched off says so). Nothing here writes, sends or posts; Slack is only
 * checked for configured webhooks, because a test ping would land in a
 * channel.
 *
 * Every test returns { ok, detail }. The detail is a short sentence for an
 * admin; an upstream error is trimmed to its first line, never a stack.
 */
import { google } from './google.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'
import { requireConnection } from './connections.js'
import { slackApi, DESTINATIONS } from './slack.js'

const short = err => String(err?.message || err || 'failed').split('\n')[0].slice(0, 160)

const TESTS = {
  async shopify() {
    const { shopifyGraphQL } = await import('../services/shopifyAuth.js')
    const d = await shopifyGraphQL('{ shop { name } }')
    return `Store: ${(d.data || d).shop?.name || 'connected'}`
  },
  async etsy() {
    const { etsyFetch } = await import('../services/etsyAuth.js')
    const shop = await etsyFetch(`/shops/${process.env.ETSY_SHOP_ID}`)
    return `Shop: ${shop?.shop_name || process.env.ETSY_SHOP_ID}`
  },
  async artelo() {
    await requireConnection('artelo')
    const res = await fetchWithTimeout('https://www.artelo.com/api/open/orders/get?limit=1', {
      headers: { Authorization: `Bearer ${process.env.ARTELO_API_KEY}` },
    })
    if (!res.ok) throw new Error(`Artelo answered ${res.status}`)
    return 'Orders API answering'
  },
  async gelato() {
    const { gelatoOrders } = await import('../services/gelato.js')
    const orders = await gelatoOrders({ limit: 1 })
    return orders.length ? `Order API answering (latest ${orders[0].orderReferenceId || orders[0].id})` : 'Order API answering, no orders yet'
  },
  async support_gmail() {
    const { ping } = await import('../domain/support/mailbox.js')
    return `Signed in as ${await ping()}`
  },
  async sales_gmail() {
    await requireConnection('sales_gmail')
    const prisma = (await import('../db.js')).default
    const rows = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'gmail_account_email:' } }, select: { value: true } })
    return rows.length ? `Connected: ${rows.map(r => r.value).join(', ')}` : 'No rep has connected Gmail yet'
  },
  async instagram() {
    const { ping } = await import('../domain/support/instagram.js')
    return `Signed in as @${await ping()}`
  },
  async google_drive() {
    await requireConnection('google_drive')
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
    })
    const about = await google.drive({ version: 'v3', auth }).about.get({ fields: 'user(emailAddress)' })
    return `Service account ${about.data.user?.emailAddress || 'answering'}`
  },
  async attio() {
    const { workspaceMembers } = await import('../domain/sales/attio.js')
    const members = await workspaceMembers()
    return `${members.length} workspace member${members.length === 1 ? '' : 's'}`
  },
  async claude() {
    const { complete } = await import('./llm.js')
    const out = await complete({ prompt: 'Reply with the single word OK.', maxTokens: 5, effort: 'low', purpose: 'connections.test' })
    return `Answering (${out.model})`
  },
  async resend() {
    await requireConnection('resend')
    const res = await fetchWithTimeout('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })
    if (!res.ok) throw new Error(`Resend answered ${res.status}`)
    const data = await res.json()
    const verified = (data.data || []).filter(d => d.status === 'verified').map(d => d.name)
    return verified.length ? `Sending domains: ${verified.join(', ')}` : 'No verified sending domain'
  },
  async render_worker() {
    const { connectionStatus } = await import('./connections.js')
    const row = (await connectionStatus()).find(c => c.id === 'render_worker')
    if (!row?.connected) throw new Error(`No Mac is checking in (${row?.note || 'queue unknown'})`)
    return `${row.connectedAs} online · ${row.note}`
  },
  async slack() {
    await requireConnection('slack')
    const hooks = Object.keys(process.env).filter(k => /^SLACK_.*WEBHOOK_URL$/.test(k) && process.env[k]).length
    if (!process.env.SLACK_BOT_TOKEN) return `No bot token; ${hooks} webhook${hooks === 1 ? '' : 's'} set (not pinged, to keep channels quiet)`
    // Who the token is, and whether the bot is in each channel it posts to (read-only, nothing is posted).
    const me = await slackApi('auth.test')
    const notIn = []
    let unchecked = false
    for (const d of new Map(Object.values(DESTINATIONS).filter(d => d.channel).map(d => [d.channel, d])).values()) {
      // A channel routed by #name cannot be looked up without its id; posting finds it.
      if (d.channel.startsWith('#')) continue
      try {
        const info = await slackApi('conversations.info', { channel: d.channel })
        if (!info.channel?.is_member) notIn.push(d.label)
      } catch (err) {
        // Reading channel membership needs channels:read and groups:read; posting does not.
        if (/missing_scope/.test(err.message)) { unchecked = true; break }
        notIn.push(d.label)
      }
    }
    const where = unchecked ? ' (add the channels:read and groups:read scopes to see which channels it is in)'
      : notIn.length ? `. Not in ${notIn.join(', ')}: /invite it there` : ', in every channel it posts to'
    return `Bot @${me.user} in ${me.team}${where}`
  },
}

export async function testConnection(id) {
  const run = TESTS[id]
  if (!run) return { ok: false, detail: 'No test for that service' }
  const started = Date.now()
  try {
    const detail = await run()
    return { ok: true, detail, ms: Date.now() - started }
  } catch (err) {
    console.warn(`[connections] test ${id} failed:`, err)
    return { ok: false, detail: short(err), ms: Date.now() - started }
  }
}
