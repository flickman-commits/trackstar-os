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
  // Local processes (dev server, render worker, scripts) talk to the same
  // database, so they get a small cap too: uncapped, each opened ~20.
  // Production was 5 until Oct 30 2026: approving ~20 prints in four minutes
  // (each approve uploads to Drive and Artelo while the sender runs) put
  // enough instances up to fill the pooler's 200 client connections, and
  // approves failed with EMAXCONN. 3 lets ~66 instances share it; a query
  // past the cap waits (pool_timeout) instead of failing.
  const limit = 3
  return `${url}${sep}connection_limit=${limit}&pool_timeout=30`
}

let prisma

if (process.env.NODE_ENV === 'production') {
  const url = datasourceUrl()
  prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined)
} else {
  // Reuse across dev hot-reloads instead of leaking a client per reload.
  if (!globalThis.__prisma) {
    const url = datasourceUrl()
    globalThis.__prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined)
  }
  prisma = globalThis.__prisma
}

export default prisma
