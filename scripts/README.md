# Scripts

Utilities that run against the database from a terminal. All of them read
`.env.local`, which points at production, so a write here is live. Scripts
that change data are dry-run by default and take `--apply`.

| Script | What it does |
|---|---|
| `lint-scrapers.js` | Static checks on every race scraper config. Part of `npm run build`. |
| `verify-scraper-chip-times.js` | Runs every scraper against a known finisher and checks chip time, not gun time. `npm run test:scrapers`. |
| `verify-config.mjs` | Prints the active race configs and their event ids. |
| `verify-race-dates.mjs` | Lists race years whose date is computed or unsourced. |
| `apply-customer-results.mjs` | Records Instant Lookup results as research records for orders that have none. The import does this on its own; this is the by-hand run. |
| `import-races-from-csv.mjs` | Loads race rows from a CSV. |
| `explore-scraper.mjs` | Fetches a timing page the way a scraper would, for debugging. |
| `mark-order-rush.mjs` | Flags an order as rush. |
| `seed-fake-order.mjs` | Creates a fake order for local testing. |
| `setup-photo-bucket.mjs` | Creates the private Supabase bucket for customer photos. |
| `check-storage.mjs` | Reports what is in the storage buckets. |
| `check-photo-paths.mjs` | Read only. Open orders whose photo path is not an upload's shape (the 2026-11-10 photo path rule). |
| `check-duplicate-rows.mjs` | Read only. Rows that would block the RenderJob and RunnerResearch unique rules; run before `npx prisma db push`. |
| `gelato-orders.js` | Read only. The newest Gelato orders, and one in full, to see what a sample should copy. |
| `research-agent.js` | Runs the research agent against the real queue. Dry run unless `--apply`. |
| `seed-support-link-macros.mjs` | Adds the Support macros that drop in a link to a race's print. Dry run unless `--apply`. |

Build checks, run by `npm run build`, not by hand: `check-vercel-config.js`
(the Vercel function and cron limits), `gen-routes.js` (the route table;
`npm run routes` rewrites it after adding or moving a handler) and
`check-auth-await.js` (every auth helper is awaited).

One-off data fixes, kept until their run is confirmed and then removed
(their commits are the record): `backfill-bounces.js`,
`backfill-replacements.js`, `backfill-results-links.js`,
`consolidate-agent-notes.js`, `extend-change-window.mjs` (2026-11-05),
`fix-bulk-zips.js`, `reopen-unanswered-closes.js`. Each says at its top what
it fixes, and is a dry run unless `--apply`. The earlier ones (the 2025 and
2026 Boston, Etsy and line-item repairs) were removed in October 2026.
