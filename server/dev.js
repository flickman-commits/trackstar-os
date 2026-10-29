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

// Map each API route to its Vercel handler
const routes = [
  { method: 'get',  path: '/api/orders',                    handler: '../api/orders/index.js' },
  { method: 'post', path: '/api/orders/cancel-creator-sample', handler: '../api/orders/cancel-creator-sample.js' },
  { method: 'post', path: '/api/creators/sample',             handler: '../api/creators/sample.js' },
  { method: 'get',  path: '/api/samples', handler: '../api/samples.js' },
  { method: 'post', path: '/api/samples', handler: '../api/samples.js' },
  { method: 'get', path: '/api/creators/manage', handler: '../api/creators/manage.js' },
  { method: 'post', path: '/api/creators/manage', handler: '../api/creators/manage.js' },
  { method: 'get', path: '/api/creators/ads', handler: '../api/creators/ads.js' },
  { method: 'get', path: '/api/creators/catalog', handler: '../api/creators/catalog.js' },
  { method: 'get', path: '/api/creators/samples', handler: '../api/creators/samples.js' },
  { method: 'post', path: '/api/creators/ads', handler: '../api/creators/ads.js' },
  { method: 'delete', path: '/api/creators/ads', handler: '../api/creators/ads.js' },
  { method: 'post', path: '/api/orders/photo',               handler: '../api/orders/photo.js' },
  { method: 'get',  path: '/api/render/jobs',                handler: '../api/render/jobs.js' },
  { method: 'post', path: '/api/render/jobs',                handler: '../api/render/jobs.js' },
  { method: 'post', path: '/api/render/worker',              handler: '../api/render/worker.js' },
  { method: 'get',  path: '/api/render/templates',           handler: '../api/render/templates.js' },
  { method: 'get',  path: '/api/admin/race-data',            handler: '../api/admin/race-data.js' },
  { method: 'post', path: '/api/races/confirm-weather',      handler: '../api/races/confirm-weather.js' },
  { method: 'post', path: '/api/render/templates',           handler: '../api/render/templates.js' },
  { method: 'get',  path: '/api/render/needs',               handler: '../api/render/needs.js' },
  { method: 'get',  path: '/api/orders/production',          handler: '../api/orders/production.js' },
  { method: 'post', path: '/api/orders/convert-to-custom',   handler: '../api/orders/convert-to-custom.js' },
  { method: 'get',  path: '/api/bulk/deals',                 handler: '../api/bulk/deals.js' },
  { method: 'post', path: '/api/bulk/deals',                 handler: '../api/bulk/deals.js' },
  { method: 'get',  path: '/api/feature-requests',            handler: '../api/feature-requests.js' },
  { method: 'post', path: '/api/feature-requests',            handler: '../api/feature-requests.js' },
  { method: 'post', path: '/api/render/needs',               handler: '../api/render/needs.js' },
  { method: 'post', path: '/api/orders/rush',                handler: '../api/orders/rush.js' },
  { method: 'get',  path: '/api/search',                     handler: '../api/search.js' },
  { method: 'get',  path: '/api/orders/final-pdf',           handler: '../api/orders/final-pdf.js' },
  { method: 'post', path: '/api/orders/final-pdf',           handler: '../api/orders/final-pdf.js' },
  { method: 'get',  path: '/api/orders/artelo-send',         handler: '../api/orders/artelo-send.js' },
  { method: 'post', path: '/api/orders/artelo-send',         handler: '../api/orders/artelo-send.js' },
  { method: 'post', path: '/api/orders/change-frame',        handler: '../api/orders/change-frame.js' },
  { method: 'get',  path: '/api/surveys',                    handler: '../api/surveys/index.js' },
  { method: 'post', path: '/api/surveys',                    handler: '../api/surveys/index.js' },
  { method: 'get',  path: '/api/public/survey',              handler: '../api/public/survey.js' },
  { method: 'post', path: '/api/public/survey',              handler: '../api/public/survey.js' },
  { method: 'post', path: '/api/orders/import',              handler: '../api/orders/import.js' },
  { method: 'get',  path: '/api/orders/import',              handler: '../api/orders/import.js' },
  { method: 'get',  path: '/api/orders/auto-import',         handler: '../api/orders/auto-import.js' },
  { method: 'get',  path: '/api/orders/assign',              handler: '../api/orders/assign.js' },
  { method: 'post', path: '/api/orders/assign',              handler: '../api/orders/assign.js' },
  { method: 'get',  path: '/api/orders/excluded-products',   handler: '../api/orders/excluded-products.js' },
  { method: 'post', path: '/api/orders/excluded-products',   handler: '../api/orders/excluded-products.js' },
  { method: 'post', path: '/api/orders/research-runner',     handler: '../api/orders/research-runner.js' },
  { method: 'get',  path: '/api/orders/actions',              handler: '../api/orders/actions.js' },
  { method: 'post', path: '/api/orders/actions',              handler: '../api/orders/actions.js' },
  { method: 'post', path: '/api/orders/update',              handler: '../api/orders/update.js' },
  { method: 'post', path: '/api/orders/refresh-weather',     handler: '../api/orders/refresh-weather.js' },
  { method: 'post', path: '/api/orders/refresh-shopify-data', handler: '../api/orders/refresh-shopify-data.js' },
  { method: 'post', path: '/api/orders/refresh-etsy-data',  handler: '../api/orders/refresh-etsy-data.js' },
  { method: 'get',  path: '/api/orders/gift-stats',          handler: '../api/orders/gift-stats.js' },
  { method: 'get',  path: '/api/orders/comments',            handler: '../api/orders/comments.js' },
  { method: 'post', path: '/api/orders/comments',            handler: '../api/orders/comments.js' },
  { method: 'delete', path: '/api/orders/comments',          handler: '../api/orders/comments.js' },
  { method: 'get',  path: '/api/products/artelo-costs',    handler: '../api/products/artelo-costs.js' },
  { method: 'get',  path: '/api/products/pricing',          handler: '../api/products/pricing.js' },
  { method: 'get',  path: '/api/products/bulk-edit',       handler: '../api/products/bulk-edit.js' },
  { method: 'post', path: '/api/products/bulk-edit',       handler: '../api/products/bulk-edit.js' },
  { method: 'get',  path: '/api/products/custom-fee',      handler: '../api/products/custom-fee.js' },
  { method: 'post', path: '/api/products/custom-fee',      handler: '../api/products/custom-fee.js' },
  { method: 'get',  path: '/api/etsy/auth',                 handler: '../api/etsy/auth.js' },
  { method: 'get',  path: '/api/admin/lookups-recent',     handler: '../api/admin/lookups-recent.js' },
  // Consolidated Instant Lookup + scraper health (replaces the two panels).
  { method: 'get',  path: '/api/admin/lookup-health',      handler: '../api/admin/lookup-health.js' },
  { method: 'post', path: '/api/admin/lookup-health',      handler: '../api/admin/lookup-health.js' },
  { method: 'get',  path: '/api/admin/photo-signed-url',   handler: '../api/admin/photo-signed-url.js' },
  // Browser auth: login / session-check / logout
  { method: 'get',    path: '/api/auth/login',             handler: '../api/auth/login.js' },
  { method: 'post',   path: '/api/auth/login',             handler: '../api/auth/login.js' },
  { method: 'delete', path: '/api/auth/login',             handler: '../api/auth/login.js' },
  { method: 'get',    path: '/api/auth/accept-invite',     handler: '../api/auth/accept-invite.js' },
  { method: 'post',   path: '/api/auth/accept-invite',     handler: '../api/auth/accept-invite.js' },
  // People + the who-did-what log
  { method: 'get',    path: '/api/admin/users',            handler: '../api/admin/users.js' },
  { method: 'post',   path: '/api/admin/users',            handler: '../api/admin/users.js' },
  { method: 'delete', path: '/api/admin/users',            handler: '../api/admin/users.js' },
  { method: 'get',    path: '/api/admin/audit',            handler: '../api/admin/audit.js' },
  // Storefront stats panel (Shopify-derived)
  { method: 'get',    path: '/api/admin/stats',            handler: '../api/admin/stats.js' },
  { method: 'get',    path: '/api/admin/custom-counter',   handler: '../api/admin/custom-counter.js' },
  { method: 'get',    path: '/api/gallery',                handler: '../api/gallery/index.js' },
  { method: 'post',   path: '/api/gallery',                handler: '../api/gallery/index.js' },
  { method: 'post',   path: '/api/admin/custom-counter',   handler: '../api/admin/custom-counter.js' },
  { method: 'get',    path: '/api/admin/support-closes',   handler: '../api/admin/support-closes.js' },
  { method: 'get',    path: '/api/admin/roles',            handler: '../api/admin/roles.js' },
  { method: 'put',    path: '/api/admin/roles',            handler: '../api/admin/roles.js' },
  // Nightly health sweep (cron runs it; admins can pull the JSON any time)
  { method: 'get',    path: '/api/admin/nightly-sweep',    handler: '../api/admin/nightly-sweep.js' },
  // Trackstar MCP (API keys: Settings > Admin > API Keys).
  { method: 'get',    path: '/api/mcp',                    handler: '../api/mcp/index.js' },
  { method: 'post',   path: '/api/mcp',                    handler: '../api/mcp/index.js' },
  { method: 'get',    path: '/api/admin/api-keys',         handler: '../api/admin/api-keys.js' },
  { method: 'post',   path: '/api/admin/api-keys',         handler: '../api/admin/api-keys.js' },
  { method: 'delete', path: '/api/admin/api-keys',         handler: '../api/admin/api-keys.js' },
  { method: 'post',   path: '/api/admin/nightly-sweep',    handler: '../api/admin/nightly-sweep.js' },
  // Proofs & Approval
  { method: 'get',    path: '/api/proofs',                 handler: '../api/proofs/index.js' },
  { method: 'post',   path: '/api/proofs',                 handler: '../api/proofs/index.js' },
  { method: 'delete', path: '/api/proofs',                 handler: '../api/proofs/index.js' },
  // Public storefront results lookup (gated behind PUBLIC_LOOKUP_ENABLED).
  { method: 'get',    path: '/api/public/results-lookup',  handler: '../api/public/results-lookup.js' },
  { method: 'get',    path: '/api/public/approval-preview', handler: '../api/public/approval-preview.js' },
  // Bulk partner orders
  { method: 'get',    path: '/api/bulk',                   handler: '../api/bulk/index.js' },
  { method: 'post',   path: '/api/bulk',                   handler: '../api/bulk/index.js' },
  { method: 'post',   path: '/api/bulk/files',             handler: '../api/bulk/files.js' },
  { method: 'get',    path: '/api/bulk/sheet',             handler: '../api/bulk/sheet.js' },
  { method: 'get',    path: '/api/public/creator-preview', handler: '../api/public/creator-preview.js' },
  { method: 'get',    path: '/api/public/survey-preview',  handler: '../api/public/survey-preview.js' },
  { method: 'get',    path: '/api/public/race-status',     handler: '../api/public/race-status.js' },
  { method: 'post',   path: '/api/public/photo-upload-url', handler: '../api/public/photo-upload-url.js' },
  { method: 'post',   path: '/api/public/photo-verify',    handler: '../api/public/photo-verify.js' },
  { method: 'post',   path: '/api/admin/preview-probe',    handler: '../api/admin/preview-probe.js' },
  { method: 'get',    path: '/api/admin/connections',      handler: '../api/admin/connections.js' },
  { method: 'post',   path: '/api/admin/connections',      handler: '../api/admin/connections.js' },
  { method: 'get',    path: '/api/cron/retention',         handler: '../api/cron/retention.js' },
  { method: 'get',    path: '/api/cron/artelo-send',       handler: '../api/cron/artelo-send.js' },
  { method: 'get',    path: '/api/cron/fulfillment-check', handler: '../api/cron/fulfillment-check.js' },
  { method: 'get',    path: '/api/public/creator',         handler: '../api/public/creator.js' },
  { method: 'post',   path: '/api/public/creator',         handler: '../api/public/creator.js' },
  { method: 'get',    path: '/api/public/bulk-intake',     handler: '../api/public/bulk-intake.js' },
  { method: 'post',   path: '/api/public/bulk-intake',     handler: '../api/public/bulk-intake.js' },
  // Marathon Monopoly proposal page (gated behind MONOPOLY_PAGE_ENABLED).
  { method: 'get',    path: '/api/public/monopoly',        handler: '../api/public/monopoly.js' },
  { method: 'get',    path: '/api/admin/monopoly-model',   handler: '../api/admin/monopoly-model.js' },
  // Sales: a UI over Attio. The queue, drafting and sending, the library, settings, Gmail.
  { method: 'get',    path: '/api/sales/draft',            handler: '../api/sales/draft.js' },
  { method: 'post',   path: '/api/sales/draft',            handler: '../api/sales/draft.js' },
  { method: 'get',    path: '/api/sales/gmail',            handler: '../api/sales/gmail.js' },
  { method: 'get',    path: '/api/sales/gmail-callback',   handler: '../api/sales/gmail-callback.js' },
  { method: 'get',    path: '/api/sales/assets',           handler: '../api/sales/assets.js' },
  { method: 'post',   path: '/api/sales/assets',           handler: '../api/sales/assets.js' },
  { method: 'get',    path: '/api/sales/settings',         handler: '../api/sales/settings.js' },
  { method: 'post',   path: '/api/sales/settings',         handler: '../api/sales/settings.js' },
  { method: 'get',    path: '/api/sales/today',            handler: '../api/sales/today.js' },
  { method: 'get',    path: '/api/sales/templates',        handler: '../api/sales/templates.js' },
  { method: 'post',   path: '/api/sales/templates',        handler: '../api/sales/templates.js' },
  { method: 'get',    path: '/api/sales/workspace',        handler: '../api/sales/workspace.js' },
  { method: 'post',   path: '/api/sales/workspace',        handler: '../api/sales/workspace.js' },
  { method: 'get',    path: '/api/sales/scheduled',        handler: '../api/sales/scheduled.js' },
  { method: 'post',   path: '/api/sales/scheduled',        handler: '../api/sales/scheduled.js' },
  { method: 'get',    path: '/api/sales/send-due',         handler: '../api/sales/send-due.js' },
  { method: 'post',   path: '/api/sales/today',            handler: '../api/sales/today.js' },
  { method: 'post',   path: '/api/sales/gmail',            handler: '../api/sales/gmail.js' },
  { method: 'get',    path: '/api/support/gmail',          handler: '../api/support/gmail.js' },
  { method: 'post',   path: '/api/support/gmail',          handler: '../api/support/gmail.js' },
  { method: 'get',    path: '/api/support/gmail-callback', handler: '../api/support/gmail-callback.js' },
  { method: 'get',    path: '/api/support/sync',           handler: '../api/support/sync.js' },
  { method: 'post',   path: '/api/support/sync',           handler: '../api/support/sync.js' },
  { method: 'post',   path: '/api/support/backfill',       handler: '../api/support/backfill.js' },
  { method: 'get',    path: '/api/support/threads',        handler: '../api/support/threads.js' },
  { method: 'get',    path: '/api/support/thread',         handler: '../api/support/thread.js' },
  { method: 'post',   path: '/api/support/thread',         handler: '../api/support/thread.js' },
  { method: 'post',   path: '/api/support/reply',          handler: '../api/support/reply.js' },
  { method: 'get',    path: '/api/support/attachment',     handler: '../api/support/attachment.js' },
  { method: 'get',    path: '/api/support/compose',        handler: '../api/support/compose.js' },
  { method: 'post',   path: '/api/support/upload',         handler: '../api/support/upload.js' },
  { method: 'post',   path: '/api/support/artelo',         handler: '../api/support/artelo.js' },
  { method: 'post',   path: '/api/support/compose',        handler: '../api/support/compose.js' },
  { method: 'get',    path: '/api/support/macros',         handler: '../api/support/macros.js' },
  { method: 'post',   path: '/api/support/macros',         handler: '../api/support/macros.js' },
  // Support, Instagram channel: the connection, Meta's webhook.
  { method: 'get',    path: '/api/support/instagram',          handler: '../api/support/instagram.js' },
  { method: 'get',    path: '/api/support/settings',           handler: '../api/support/settings.js' },
  { method: 'post',   path: '/api/support/settings',           handler: '../api/support/settings.js' },
  { method: 'post',   path: '/api/support/teach',              handler: '../api/support/teach.js' },
  { method: 'post',   path: '/api/support/actions',            handler: '../api/support/actions.js' },
  { method: 'get',    path: '/api/support/filters',            handler: '../api/support/filters.js' },
  { method: 'post',   path: '/api/support/filters',            handler: '../api/support/filters.js' },
  { method: 'post',   path: '/api/support/instagram',          handler: '../api/support/instagram.js' },
  { method: 'get',    path: '/api/support/instagram-callback', handler: '../api/support/instagram-callback.js' },
  { method: 'get',    path: '/api/support/instagram-webhook',  handler: '../api/support/instagram-webhook.js' },
  { method: 'post',   path: '/api/support/instagram-webhook',  handler: '../api/support/instagram-webhook.js' },
]

// Load all handlers and register routes
for (const route of routes) {
  const mod = await import(route.handler)
  const handler = mod.default

  // Register for the specific method, plus OPTIONS for CORS preflight
  // For dynamic routes (e.g. /api/approve/:token), copy Express params to query
  // so the handler works identically in both Express and Vercel.
  // `route.query` injects static query params, mirroring vercel.json rewrites.
  const adapters = []
  if (route.paramAdapter) {
    adapters.push((req, res, next) => { Object.assign(req.query, req.params); next() })
  }
  if (route.query) {
    adapters.push((req, res, next) => { Object.assign(req.query, route.query); next() })
  }
  const middleware = [...adapters, handler]
  app[route.method](route.path, ...middleware)
  app.options(route.path, (req, res) => {
    // Echo origin (not '*') + allow credentials so cookie-bearing requests
    // pass preflight when a developer points VITE_API_URL at this server.
    // Local origins only: this server holds production credentials.
    const origin = String(req.headers.origin || '')
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret, Cookie')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.status(204).end()
  })
}

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
