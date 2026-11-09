/**
 * The one Prisma client.
 *
 * Domain code under server/ used to import the client from api/_lib, which
 * made the business layer depend on the HTTP layer, and several services
 * constructed their own PrismaClient on top of that. Serverless connection
 * limits are small; one client per process is the whole point.
 *
 * api/_lib/prisma.js re-exports this so existing handlers keep working.
 */
import { PrismaClient } from '@prisma/client'
import { slackTo } from './lib/slack.js'

/**
 * On Vercel every function instance has its own pool, and Prisma's default
 * size (cpus x 2 + 1) times a handful of warm instances is enough to exhaust
 * the Supabase pooler, which then fails every function at once, sign-in
 * included. A small explicit cap per instance and a longer wait for a
 * connection keeps a burst (bulk research alongside page loads) from
 * turning into 500s. Respects a limit already present in the URL.
 */
function datasourceUrl() {
  const url = process.env.DATABASE_URL
  if (!url) return undefined
  if (/connection_limit=/.test(url)) return url
  const sep = url.includes('?') ? '&' : '?'
  // Production was 5 until Oct 30 2026, then 3: approving ~20 prints in four
  // minutes put enough instances up to fill the pooler's 200 client
  // connections, and approves failed with EMAXCONN. Raising it to 8 after
  // turning on Vercel Fluid compute (Nov 2) filled the pooler within minutes:
  // there are still dozens of instances, more during a deploy. Keep it at 3.
  // A query past the cap waits (pool_timeout) instead of failing.
  // Local processes (dev server, render worker, scripts) share the same
  // pooler; they do one thing at a time, so 1 is enough.
  const limit = process.env.NODE_ENV === 'production' ? 3 : 1
  return `${url}${sep}connection_limit=${limit}&pool_timeout=30`
}

/**
 * The pooler turning a connection away (EMAXCONN: its client limit is full)
 * is a burst, not an outage: a second try a moment later usually gets in.
 * Each query gets one retry, and Slack hears about it (at most once every
 * ten minutes per instance, straight to the webhook: the usual alert reads
 * the Connections table, which is the database that just refused us).
 */
const POOL_FULL = /max client connections|EMAXCONN/i
const ALERT_EVERY_MS = 10 * 60_000
let lastAlertAt = 0
function alertPoolFull(err, retried) {
  const now = Date.now()
  if (now - lastAlertAt < ALERT_EVERY_MS) return
  lastAlertAt = now
  slackTo('admin', `:rotating_light: *Supabase pooler full (EMAXCONN)* ${retried ? 'The retry got through.' : 'The retry failed too, so someone saw an error.'} If this keeps up, bump the Supabase compute tier (client connections are 200 on Micro). \`${String(err?.message || err).split('\n').pop().trim().slice(0, 200)}\``).catch(() => {})
}
function withRetry(client) {
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        try { return await query(args) } catch (err) {
          if (!POOL_FULL.test(String(err?.message || ''))) throw err
          await new Promise(r => setTimeout(r, 750))
          try { const out = await query(args); alertPoolFull(err, true); return out } catch (again) { alertPoolFull(again, false); throw again }
        }
      },
    },
  })
}

let prisma

if (process.env.NODE_ENV === 'production') {
  const url = datasourceUrl()
  prisma = withRetry(new PrismaClient(url ? { datasources: { db: { url } } } : undefined))
} else {
  // Reuse across dev hot-reloads instead of leaking a client per reload.
  if (!globalThis.__prisma) {
    const url = datasourceUrl()
    globalThis.__prisma = withRetry(new PrismaClient(url ? { datasources: { db: { url } } } : undefined))
  }
  prisma = globalThis.__prisma
}

export default prisma
