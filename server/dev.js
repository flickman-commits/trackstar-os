/**
 * Local development API server
 *
 * Runs your Vercel serverless functions as a regular Express server.
 * Vite proxies /api/* requests here during local development.
 */
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
// Skip JSON parsing for multipart requests (proof uploads use formidable)
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || ''
  if (ct.includes('multipart/form-data')) return next()
  // Keep the bytes: the Instagram webhook checks Meta's signature over the raw body.
  express.json({ limit: '10mb', verify: (r, _res, buf) => { r.rawBody = buf } })(req, res, next)
})

// The same route tables the Vercel group functions use (scripts/gen-routes.js),
// so a route answers locally exactly when it answers in production.
import { makeRouter } from '../api/_lib/router.js'
const groups = ['app', 'admin', 'cron', 'mcp', 'public', 'sales', 'support']
const table = {}
for (const g of groups) Object.assign(table, (await import(`../api/_lib/routes/${g}.js`)).default)
const router = makeRouter(table)

// The vercel.json page rewrites that land on an API handler.
app.get('/approve/:token', (req, res, next) => { req.url = `/api/public/approval-preview?token=${encodeURIComponent(req.params.token)}`; next() })
app.get('/vote/:token', (req, res, next) => { req.url = `/api/public/survey-preview?token=${encodeURIComponent(req.params.token)}`; next() })

app.options('/api/*', (req, res) => {
  // Echo origin (not '*') + allow credentials so cookie-bearing requests
  // pass preflight when a developer points VITE_API_URL at this server.
  // Local origins only: this server holds production credentials.
  const origin = String(req.headers.origin || '')
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.status(204).end()
})
app.all('/api/*', (req, res) => router(req, res))

const PORT = process.env.API_PORT || 3001
// Loopback only unless HOST says otherwise: with production keys loaded, a
// server reachable from the coffee-shop wifi would run crons, imports and
// admin endpoints for anyone who found it.
const HOST = process.env.HOST || '127.0.0.1'
app.listen(PORT, HOST, () => {
  let dbHost = 'unknown'
  try { dbHost = new URL(process.env.DATABASE_URL || '').hostname || 'unset' } catch { /* not a URL */ }
  const prodLike = /supabase\.(com|co)$/.test(dbHost)
  console.log(`\n  ⚡ API server running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  console.log(`  Database: ${dbHost}${prodLike ? '  <-- this is the PRODUCTION database; writes here are live' : ''}\n`)
})
