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
- [x] 3.1 A single unlabelled time is not proof of chip time. The page must say chip or net; a finder note that shows doubt goes to a person. Both leave a suggestion to Accept.
- [x] 3.2 Same-name finishers and the wrong year. Two same-name rows with different times need a bib; the year must be in the address, page heading or the runner's row. Race-word check left as it was.
- [x] 3.3 Never overwrite a customer-typed time on the web path (`timeReading.js`). Web step hands off when times differ; Accept match keeps the typed time and pace and fills bib, event, link.
- [x] 3.4 MCP `accept_match` does not accept an unchecked result. Free-form match goes through the page check; findings that failed the check are marked and cannot be accepted by an agent. Skill and docs updated.
- [x] 3.5 Scraper health probe compares the time, not only the bib. `npm run test:scrapers` was not run (it calls live timing sites); the first nightly probe after deploy may flag fixtures whose stored time is written differently from what the scraper returns now.

## Phase 4: Security
- [x] 4.1 Remove the legacy `x-admin-secret` door; `SESSION_SECRET` required. Matt confirmed SESSION_SECRET is set (2026-11-10). ADMIN_SECRET (set 2026-05-22, the value in the public bundle until 2026-06-10) is no longer read: delete it in Vercel. First tests for auth.js in `server/auth.test.js`.
- [~] 4.2 Validate the cart photo path. Shape checked at import, refresh and every signing point (`server/lib/photoPath.js`); a refused path imports with no photo and a note. Not done: recording which paths photo-verify checked, so a shopper who skips verify can still attach unchecked bytes of the right name (needs a table). `scripts/check-photo-paths.mjs`: Matt ran it 2026-11-10, 209 open orders with a photo, 0 refused.
- [x] 4.3 Cap discount codes non-admins can create: 25% or $25, one use, 30 days (Support's existing 25% line; $25 and 30 days are my defaults, Matt can change them). Codes over the line, unlimited or never expiring post to #admin-alerts.
- [x] 4.4 Signing out ends the session. It signs that person out on every device (sessions are versioned per person).
- [x] 4.5 Refuse cross-site requests that change things (Sec-Fetch-Site / Origin, in requireAdmin). Reads are left open (OAuth callbacks). The four state-changing GETs refuse cross-site links. Not done: requiring application/json.
- [x] 4.6 Clarity on public pages only (Matt, 2026-11-10): Creator landing and Monopoly page, as an allowlist in index.html and monopoly.html.
- [x] 4.7 Smaller items: Slack escaping (4 posts), Etsy OAuth constant-time state and Secure cookies (not the full oauthState.js double check), bulk tokens uuid and runner-link cap, gallery fetch only from our storage, worker relay redirects only to relay hosts.
- [!] 4.8 Retire `MCP_TOKEN` / `MCP_WRITE_TOKEN`. Matt is not sure the nightly routine has moved off them (2026-11-10), so they stay. To check: search the Activity Log for "MCP_WRITE_TOKEN" (calls with it are logged as key:Nightly routine (MCP_WRITE_TOKEN)); none in the last few weeks means it is safe to retire.

## Phase 5: Reliability and alerting
- [x] 5.1 Alert when a cron fails: auto-import (and its 14 steps in one message), artelo-send, sales send-due, support sync, research agent, retention. `alertCronFailure` posts at most hourly per job, timed in SystemConfig.
- [x] 5.2 Watchdog for crons that stop: `/api/cron/watchdog` hourly at :20 (`server/lib/cronWatchdog.js`). Late jobs, import not finished in 30 min, artelo-send / send-due / support sync starting without finishing (new `cron_ok:` stamps). Posts once per problem and once when it clears. Not done: moving the per-instance 10-minute dedupe in `server/db.js` and `server/lib/systemProblem.js` to SystemConfig.
- [~] 5.3 Daily Shopify reconciliation done (`server/domain/orders/missingOrders.js`, run by the daily artelo-completed-check): paid online-store orders from the last 2 days missing here go to #admin-alerts once. Not done: paging Artelo's list (no paging parameter in the code to go on), and Etsy. The first run may flag orders made outside Artelo; it lists the products so they are easy to tell apart.
- [x] 5.4 Auto-import time budget: 240 s deadline between steps, cancellations first, lock 6 min. A step that starts just before the deadline can still run past it (its own budgets are unchanged).
- [x] 5.5 Bulk-runner order creation cannot double-create: a `creatingAt` mark before the create, and a lookup by order number at Artelo on retry (relies on `orders/get`'s `name` filter, used the same way in support/replacements.js). Not verified against Artelo.
- [x] 5.6 Photo-later emails stamped before sending, cleared on failure; refunds interrupted after closing are flagged to #admin-alerts (not refunded automatically).
- [x] 5.7 Etsy token refresh: compare-and-swap save, one re-read after a refusal, failures to #admin-alerts hourly; health check and Test connections use the shared client.
- [x] 5.8 Unique (orderId, version) on RenderJob and (orderId, raceId) on RunnerResearch are in the schema, and render creation retries a taken number. Applied to the database by Matt on 2026-11-10 (duplicate check 0 and 0, then `npx prisma db push`). Research writes were not converted to upsert (a rare race now errors instead of duplicating). Order.orderNumber unique not added.
- [~] 5.9 Import-side completion goes through `completeOrder` (via 'artelo'). Not done: setting a custom order's design status to sent_to_production on the way, which changes what counts for designer pay. Matt's call.
- [x] 5.10 Photo add-on: the photo is kept when Shopify added the paid line despite an error answer.
- [x] 5.11 "When production is broken" in the README. Backup line left for Matt.

## Phase 6: AI and outbound email
- [~] 6.1 Weekly playbook review: kept auto-publishing (Matt's call, Oct 30, recorded in playbookReview.js) but holds a revision that adds a link or changes Escalate or a refund rule; Review in Settings applies the held one. Evidence fenced and marked as data. Fully proposal-only is one line away if Matt wants it.
- [x] 6.2 Customer text fenced in draft and triage prompts (`server/domain/support/untrusted.js`); unauthored notes (portal replies, triage) shown apart from the team's.
- [x] 6.3 LLM plumbing: per-call timeout (2 min default, 4 research agent, 280 s playbook), max_tokens cut-off reported, Claude ids only to Anthropic, failing drafts back off (SystemConfig draft_fail:*). Not done: a spend ledger. Default model is still claude-opus-5 ($5/$25); claude-opus-5-5 is $4/$20 but defaults to effort medium, so switching is Matt's call.
- [~] 6.4 Sales: AI variants and Rewrite keep the first-line blank; follow-ups held when they replied in our thread (`server/domain/sales/replies.js`); Attio next_action_date left alone under a person's next action. NOT done, needs Matt: a suppression (do-not-contact) list and where people add to it, and the opt-out wording and postal address line for first touches.
- [~] 6.5 Inbound email stores Gmail's sender check (SupportMessage.senderCheck); a conversation whose latest email did not pass is drafted as unverified. Column pushed to the database by Matt on 2026-11-10. Not done: requiring a pass before mail from our domain or a forwarder counts as the team's (could misfile internal mail if Google leaves the header off it; not checkable here).
- [x] 6.6 Support reply: same content to the same conversation refused within 10 minutes (released if the send failed); attachments must belong to the conversation's orders.
- [~] 6.7 Nightly: capture_fixture will not overwrite a known finisher without replace + reason, and a replaced one blocks a fixed claim; event ids proved against real customers' runners; timing-page output marked untrusted and the skill says so; GitHub Action for sensitive paths (needs SLACK_SENSITIVE_WEBHOOK_URL secret). Not done: save_event_id comparing the event's year and title (platform-specific); limiting the routine's key scopes (Matt's settings).

## Phase 7: Customer pages and the operator's screen
- [x] 7.1 A failed load is not a dead link (`src/lib/publicLoad.ts`): Manage your order, photo upload, runner and partner intake, survey. Manage your order polling backs off and stops after ~30 min. Network failures on buttons and uploads read as sentences.
- [x] 7.2 A 401 shows one message with Reload instead of reloading; the session check signs out only on a real 401. Not done: a sign-in dialog over the page.
- [x] 7.3 A list request started before this tab's last write is not shared (`lastWriteAt` in src/lib/api.ts). The open order is still a copy of a list row (not changed).
- [x] 7.4 Support: only the latest inbox and thread answers land; Send and close no longer clears another conversation; unsent replies kept per conversation for the visit.
- [x] 7.5 Order toast: errors 8 s, above dialogs, click to close; server reasons shown (Mark as completed, runner edit, photo calls); proof load and approval-link failures shown. Not done: one shared fetch wrapper and error shape.
- [x] 7.6 One press at a time: render at size, Accept match, Add comment (and Cmd+Enter), Mark as completed. Confirm on deleting a note and reopening a custom in production. Timesheets uses the in-page confirm.
- [x] 7.7 Weather and race-data saves reload one order; copy tick only on success; Attio links http(s) only.

## Phase 8: Housekeeping
- [ ] 8.1 Dependencies
- [ ] 8.2 Environment file drift
- [ ] 8.3 One Shopify API version
- [ ] 8.4 Stale documentation
- [ ] 8.5 Dead code
- [ ] 8.6 List of unused public files

## Checked by Matt
- 2026-11-10, Supabase: RLS is off on every public table, but the Data API is disabled for them ("cannot be accessed via the Data API"), so the anon key cannot read them. Nothing to do; enabling RLS too is optional.
- 2026-11-10, Supabase Storage: personalization-photos is private (25 MB, image types only). order-proofs and order-comments are PUBLIC with no size or type limit. Making them private needs signed links in code first (proof links are stored and already emailed), so it stays on the later list. Do not flip them private in the dashboard.

## Also done in this build
- 2026-11-10: default model switched to claude-opus-5-5 (Matt's call), with server-side refusal fallbacks (LLM_FALLBACKS=off turns them off).

## Waiting on Matt
- Phase 1: add `CONNECTIONS_FORCE_OFF=all` (or the explicit list in `.env.example`) to `.env.local`. Never in Vercel.
- Phases 1 to 7: commits are local, not pushed.
- Phase 7: click through the customer pages and order screen after deploy (listed in the Phase 7 report).
- Phase 6, 6.4: suppression list and opt-out wording.
- Phase 6, 6.7: add the GitHub secret SLACK_SENSITIVE_WEBHOOK_URL; delete the stale remote branches (15 sweep/*, 5 claude/*, listed in the Phase 6 report); check the nightly routine's API key scopes.
- Phase 5, 5.9: should a custom order completed by the import (fulfilled in Artelo) also be marked sent_to_production, which counts it for designer pay?
- Phase 5, 5.11: fill in the README's backup line (Supabase backup tier, how to restore).
- Phase 4: after deploying, delete ADMIN_SECRET from Vercel.
- Phase 4, 4.8: check the Activity Log for MCP_WRITE_TOKEN use (see 4.8).
- Phase 2: click through in the app after deploy (listed in the Phase 2 report).
