# CLAUDE.md

Conventions for working in this repo. Read `README.md` first for what the app is. The product is called TrackstarOS; the repo and folder keep the old `trackstar-fulfillment` name.

## Layout

- `api/` — Vercel serverless handlers. Thin: parse the request, check auth, call into `server/`, shape the response. A handler lives in `api/_routes/` (`api/_routes/orders/update.js` answers `/api/orders/update`); after adding, moving or deleting one, run `npm run routes`. Only the seven group functions (`api/app.js`, `admin`, `cron`, `mcp`, `public`, `sales`, `support`) sit directly in `api/`: every file there is its own Vercel function, and 128 of them ran the production build out of memory. The build fails on a stale route table or a stray handler in `api/`. `api/_lib/` holds the shared auth, Prisma client, alerts, token helpers and the router.
- `server/` — domain code with no `req`/`res`. `services/` (orders, research, Shopify, Etsy, sweeps), `scrapers/` (platforms + per-race configs), `lib/` (matching, shipping, rate limits, health). `server/dev.js` is the local Express wrapper and the natural self-host entrypoint.
- `src/` — React app. `pages/` per route, `components/` shared UI, `lib/` client helpers. `src/lib/ui.ts` is the styling vocabulary.
- `prisma/` — schema and migrations. `scripts/` — one-off data fixes, dry-run by default.

## Rules

- Auth: every mutating `api/` handler calls `requireAdmin`. Destructive actions also call `requireAdminRole` (re-reads the database). Crons use `isCronRequest`. Never compare secrets with `===`; use `safeEqual`.
- Scrapers: never claim a scraper works without the `add-race-scraper` skill's verification gates. Gun time and chip time look alike and are not. Never build or wire up a scraper year before 2020; those orders are researched by hand.
- Overrides: call `await ensureOverridesLoaded()` before `getScraperForRace` in any new code path.
- Schema changes: `npx prisma db push`. Update `.env.example` when you add an env var.
- Money is not modeled yet. Do not add float price columns; when finance work starts, use integer cents plus a currency.
- Keep `api/_routes/orders/actions.js` from growing. New features go in their own handler file (the Hobby-plan function cap that created it no longer applies).
- No new template-style UI kits. Reuse `src/lib/ui.ts` and existing components.
- Public endpoints (`api/public/*`) must use `checkRateLimitDurable` and never return `error.message`.
- Outside services go through Connections (`server/lib/connections.js`): each service's client calls `await requireConnection('<id>')` before it calls out, so Settings > Connections can show it and switch it off. A new integration adds an entry to `CONNECTIONS` and a read-only test in `server/lib/connectionTests.js`; it does not mint its own client somewhere else. Endpoints answer unexpected errors with `sendPublicError(res, error)` (`server/lib/publicError.js`).
- Every auth helper is async and must be awaited (`await requireAdmin(req, res)`); `scripts/check-auth-await.js` fails the build otherwise.
- Sales: Attio is the CRM and the only source of truth for deals, people and stages. `server/domain/sales/attio.js` is the one file that talks to it. Never add a Postgres column that duplicates an Attio field; the `SalesSend`, `SalesSkip` and `SalesScheduled` tables hold machinery only. The tool moves a deal from Not Contacted to Reached Out on a send and never further; every other stage move is a person's. A `next_action` that does not start with `[auto]` was written by a human and is never overwritten. PR is worked from the people-based "PR Pipeline" list (`press_outreach`), not from deals: the tool moves an entry from To contact to Contacted on a send and never further. All email wording lives in the template library; a sequence (`sales_sequences`) is only the order of templates and the days between them, and custom variables live in `sales_variables` (see `server/domain/sales/sequences.js`). New templates start with a `[First line]` the person writes per email (the composer blocks sending until it is), and a template may leave it out; the tool never writes an opener itself.
- MCP: `api/_routes/mcp/index.js` is the only route, on the official SDK; tools live in `server/services/mcp/tools/`. Every tool calls domain code, validates input with zod, returns a small explicit shape (never a raw Shopify/Artelo payload), and a write returns a `summary` for the Activity Log. Callers authenticate with API keys (`api/_lib/apiKeys.js`); a key acts as a person and never exceeds their role. Never return `error.message` from a tool; throw `ToolError` for anything the caller should read.
- Where work lands: commit to `main` and push, in every session, including ones started with a `claude/*` branch name. No feature branches and no pull requests unless Matt asks for one; the branches were confusing and nobody reviews them. The only exception is the nightly routine's short-lived `sweep/*` preview branches below. Every change still has to pass the "Verify before you say it works" checks first.
- The nightly-sweep routine commits straight to `main` and pushes. This is standing authorization from the repo owner — no PR, no asking first — and it holds only for that routine and only for changes whose gates passed. A scraper code fix goes through a short-lived `sweep/*` branch first, only so Vercel builds a preview to test it on (`probe_preview`); the same run merges it to `main` once every year passes, or deletes the branch if not. No `sweep/*` branch outlives the run. If a run is handed a `claude/*` branch name anyway, merge to `main` and push `main` before finishing. Work parked on an unmerged branch never reaches production while the report claims it shipped, which is the failure this replaces.

## Verify before you say it works

- `npm run build` must pass (it runs the scraper fixture lint, Prisma generate, `tsc`, and Vite).
- `npm run lint` must pass.
- For scraper or lookup changes, run `npm run test:scrapers` or the relevant `server/scrapers/test-*.js` script.

## Etsy gotchas

- `ETSY_API_KEY` starts with `6l` (six, lowercase L), not `61`.
- The `x-api-key` header is `ETSY_API_KEY:ETSY_SHARED_SECRET`, colon-separated, or every call is a 403.
- Refresh tokens rotate; always persist the newest one to `SystemConfig` (key `etsy_refresh_token`).
