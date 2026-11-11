# TrackstarOS

Internal operations app for [Trackstar](https://trackstar.art), personalized race-result prints. One place for order fulfillment and the tools around it, built to grow into the rest of the business over time.

## What it does today

- **Order fulfillment.** Imports orders from Artelo, enriches them from Shopify and Etsy, researches each runner's official chip time and pace across 26 timing platforms and 68 race configs (counted 2026-11-10), and tracks the order through proofing, approval, and shipping.
- **Proof approval.** Designers upload proofs; customers approve them on a token-gated public page; the tool records the outcome and emails the customer.
- **Instant Lookup.** A public results-lookup endpoint used by the storefront personalization widget, gated per race.
- **Creator program.** Invites, briefs, sample orders, and a creator portal.
- **Products and pricing.** Bulk Shopify product edits with undo, pricing calculators, Artelo cost sync.
- **Marathon Monopoly.** A partner-facing proposal page and an internal economics model.
- **Sales.** A UI over Attio for sending outreach. Reads each rep's queue live from Attio (new outreach up to a daily cap, follow-ups when due), drafts from the cadence templates or a model using Attio's enrichment, sends through the rep's own Gmail with decks and mockups from a shared library, and writes the touch back to the Attio deal. Attio is the source of truth; Postgres keeps only the send log, overnight drafts and skips.
- **Ops.** Nightly scraper health sweep, weekly ads debrief, Slack reports, an MCP server so Claude can read operational data.

## Stack

- Frontend: React 18, TypeScript, Vite, Tailwind. Entry in `src/main.tsx`; routes in `src/App.tsx`.
- API: Vercel serverless functions in `api/`. Shared domain code in `server/` (services, scrapers, libs).
- Database: PostgreSQL on Supabase via Prisma. Schema in `prisma/schema.prisma`.
- Storage: Supabase Storage for proofs and customer photos.
- Local dev: `server/dev.js` runs every `api/` handler under Express. Vite proxies `/api` to it.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev                  # starts the API on :3001 and Vite on :3000
```

`.env.local` points at whatever database you put in `DATABASE_URL`. Be careful: if that is the production database, local writes are live. While it is, put `CONNECTIONS_FORCE_OFF=all` in `.env.local` so a local session cannot send a print, an email or a Slack post (`server/lib/connections.js`).

## Useful commands

| Command | What it does |
|---|---|
| `npm run build` | Checks the route table and auth awaits, lints everything, lints scraper fixtures, generates the Prisma client, runs the tests, typechecks `src/`, builds the site |
| `npm test` | The server tests, against an offline database address (never the real one) |
| `npm run lint` | ESLint over `src/` |
| `npm run lint:server` | ESLint over `server/`, `api/`, `scripts/` and `worker/` for undefined names, duplicate keys and unreachable code |
| `npm run lint:scrapers` | Every scraper platform must ship a chip-time fixture |
| `npm run test:scrapers` | Verifies chip times against live results pages |
| `npx prisma db push` | Applies schema changes (interactive migrate does not work in this terminal) |

## Deploying

Push to `main`. Vercel builds and deploys. Cron schedules live in `vercel.json`.

A schema change goes to the database before the code that uses it: `npx prisma db push`, then push to `main`. Code that reaches production first fails every query on the changed table (the tool says so: `server/lib/systemProblem.js`).

## When production is broken

- **A deploy broke something.** In Vercel, Deployments, pick the last good one and Promote to Production (Instant Rollback). Then `git revert` the bad commit on `main` and push, so the next deploy does not bring it back.
- **What happened.** Vercel, the project, Logs (filter by the function: `app`, `cron`, `public`, `support`, `sales`, `admin`, `mcp`). #admin-alerts has the failures the tool reports itself; the hourly watchdog there says when a scheduled job is late or stopped finishing.
- **Stop one outside service** (a vendor having a bad day, a leaked key): Settings > Connections, switch it off. Every part of the tool that calls it stops within 30 seconds. Sending approved prints to Artelo has its own switch under Artelo.
- **Etsy orders arrive without personalization.** The Etsy token stopped working (#admin-alerts says so). Settings > Connections, Etsy, Reconnect, sign in as the shop.
- **The support mailbox or Instagram stopped.** Settings > Connections, Reconnect on that service.
- **Database backups.** (Matt: which Supabase backup tier the project is on, and how a restore is done.)

## Where to look

- `docs/` has the Monopoly briefs and the brand guidelines.
- `.claude/skills/` has the operational runbooks: adding a race scraper, running the nightly sweep, and the outreach phase of the nightly CRM upkeep.
- `CLAUDE.md` has the conventions an AI assistant should follow in this repo.
