# Hardening build: progress

The build plan from the 2026-11-10 audit (commit `77e6039`). One phase per session. Marks: `[x]` done, `[~]` partly done, `[!]` not done (reason given), `[ ]` not started. Commits stay local until Matt pushes.

## Phase 1: Make the build itself safe
- [x] 1.1 Run tests against an offline database address. `npm test` sets the address itself; a throwaway Prisma query was shown to fail to connect. Run the build locally with the same two variables in front.
- [x] 1.2 `CONNECTIONS_FORCE_OFF` switch for local sessions. Also blocks switching a forced service from Settings, and skips the two Etsy token refreshes in the health check and Test connections. Not gated: read-only pings to Artelo, Shopify and Resend in those two diagnostic flows in `orders/actions.js` (they write nothing).
- [x] 1.3 Lint server code; lint in the build. `npm run lint:server`. Fixed: duplicate `lineItemIndex` in `SPEC_SELECT`, dead `disconnectEtsyAuth`. `server/lib/cronJobs.js` is ignored until ESLint 9 (import attribute). Frontend lint is at its cap (5 of 5 warnings) and now in the build, so one new warning fails a deploy.
- [x] 1.4 Keep stray business files out of git. Root `*.csv` and `*.txt` ignored.
- [x] 1.5 Pin the Node version. `engines` 22.x, `.nvmrc`, CI on 22. Vercel follows `engines`.

## Phase 2: Stop a wrong print reaching production
- [x] 2.1 Re-check an approved design against the order when it is sent. `server/domain/render/printed.js` decides; stale designs are closed, re-rendered, and posted to #alerts with old and new values. If the order cannot be checked (template, date evidence), it is held and #alerts told once. Custom final PDFs are not compared.
- [x] 2.2 Close stale approved designs when the order is edited. Manage-your-order name and photo changes; staff edits to runner, race, bib, time, pace, event (`closeOutdatedDesigns`). Race-wide date and weather corrections are left to the 2.1 send check, which closes them at send time.
- [x] 2.3 Only a design waiting for review can be approved (or rejected); claimed on the pending row.
- [x] 2.4 No research under a guessed year (`server/domain/orders/yearUnknown.js`). Every research path. Orders already flipped to ready by this bug before the fix are not detectable from the data and were not looked for.
- [~] 2.5 A result found for a different race must not print. Done for race and year (`pickResearch.js`, used by the render, pipeline status and order list). Not done for a changed runner name: research rows store the order's name at research time, but invalidating them on every name change would strip valid results when a customer only fixes spelling. Matt, 2026-11-10: leave the runner-name half as it is for now.
- [x] 2.6 Hold or Reject stops an attached print on a multi-print order (`siblingGate.js`). The code has no Artelo call that detaches a design; whether the API has one was not checked against Artelo's docs.
- [x] 2.7 Customer approval page refuses a second answer (409), and keeps the loaded page when a reload fails.
- [x] 2.8 The "A" shortcut does not approve from behind a dialog (`src/lib/shortcuts.ts`); A waits for the preview image; expired confirm removed.
- [x] 2.9 State from one order does not carry into the next. Reset effect, ProofManager keyed by order, late answers guarded by order id, useDesign failures kept on their order.

## Phase 3: Tighten the research gate
- [ ] 3.1 A single unlabelled time is not proof of chip time
- [ ] 3.2 Same-name finishers and the wrong year
- [ ] 3.3 Never overwrite a customer-typed time on the web path
- [ ] 3.4 MCP `accept_match` does not accept an unchecked result
- [ ] 3.5 Scraper health probe compares the time, not only the bib

## Phase 4: Security
- [ ] 4.1 Remove the legacy `x-admin-secret` door; `SESSION_SECRET` required
- [ ] 4.2 Validate the cart photo path
- [ ] 4.3 Cap discount codes non-admins can create
- [ ] 4.4 Signing out ends the session
- [ ] 4.5 Refuse cross-site requests that change things
- [ ] 4.6 No session recording on pages with an access token
- [ ] 4.7 Smaller items (Etsy OAuth state, Slack escaping, bulk tokens, proof image URLs, worker redirects)
- [ ] 4.8 Retire `MCP_TOKEN` / `MCP_WRITE_TOKEN`

## Phase 5: Reliability and alerting
- [ ] 5.1 Alert when a cron fails
- [ ] 5.2 Watchdog for crons that stop
- [ ] 5.3 Import paging and a daily Shopify/Etsy reconciliation
- [ ] 5.4 Auto-import time budget
- [ ] 5.5 Bulk-runner order creation cannot double-create (suspected)
- [ ] 5.6 Photo-later emails and refunds
- [ ] 5.7 Etsy token refresh
- [ ] 5.8 Unique (orderId, version) and (orderId, raceId)
- [ ] 5.9 Import-side completion goes through `completeOrder`
- [ ] 5.10 Photo add-on charge without a photo (suspected)
- [ ] 5.11 "When production is broken" notes in the README

## Phase 6: AI and outbound email
- [ ] 6.1 Weekly playbook review proposes, does not publish
- [ ] 6.2 Mark untrusted text in drafting and triage prompts
- [ ] 6.3 LLM plumbing (timeouts, max_tokens, model ids, retry backoff)
- [ ] 6.4 Sales suppression, reply detection, `[First line]` in AI Rewrite
- [ ] 6.5 Do not trust the From address without authentication
- [ ] 6.6 Support reply idempotency
- [ ] 6.7 Guard rails for the nightly routine

## Phase 7: Customer pages and the operator's screen
- [ ] 7.1 A failed load is not a dead link
- [ ] 7.2 Session handling does not throw away work
- [ ] 7.3 A refresh after a save does not show old data
- [ ] 7.4 Support inbox ordering and unsent drafts
- [ ] 7.5 Errors people can read
- [ ] 7.6 Confirm and pending guards
- [ ] 7.7 Smaller items

## Phase 8: Housekeeping
- [ ] 8.1 Dependencies
- [ ] 8.2 Environment file drift
- [ ] 8.3 One Shopify API version
- [ ] 8.4 Stale documentation
- [ ] 8.5 Dead code
- [ ] 8.6 List of unused public files

## Waiting on Matt
- Phase 1: add `CONNECTIONS_FORCE_OFF=all` (or the explicit list in `.env.example`) to `.env.local`. Never in Vercel.
- Phases 1 and 2: commits are local, not pushed.
- Phase 2: click through in the app after deploy (listed in the Phase 2 report).
