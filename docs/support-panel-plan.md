# Support panel: plan

A shared inbox for fast@trackstar.art inside TrackstarOS, with Claude doing the investigation and the first draft on every ticket, and a person doing the send. Written 2026-10-16 from the call with Daniela Monroy (Wispr Flow, "Trackstar AI Support Integration") and the Notion playbook "How to Handle Trackstar Customer Service Inquiries". (The plan as written then; most of it is built and live now, so check the code before taking this as current.)

## What the call said, and what we take from it

Daniela's team (four people, about 100 tickets a day, cleared same day) runs Claude against Intercom. The parts that matter for us:

- Claude does not reply to customers. It investigates and drafts. A human sends, and a human makes any manual change to an account or order. That is deliberate, to prevent errors.
- The draft lands as a **note on the ticket**, not just a reply. The note has: the reply, the background of the investigation, the key facts, the steps the rep should take or check, and self-serve links so the customer does not have to write back next time.
- Drafts are right about 95% of the time. Support time dropped 30%.
- It works because they fed it the help center and their past answers up front. The first weeks are spent feeding it.
- Claude also reads past conversations on the ticket and Slack history for context.
- Connectors: Intercom, Customer.io, Slack, and an in-house agent.

Matt's own example from the call: "I ordered a print and forgot the frame, can you swap it?" Today that means finding the order in Shopify by email, editing it, and replying. The goal is that the draft arrives with the order already found, the fix already proposed, and the rep adds the human touch.

What we already have that Daniela's team had to build: the playbook (23 scenarios with decision trees, templates, escalation rules, tone), a year of Matt's real replies in fast@, Shopify and Etsy clients, the order database with research results, an LLM door that is provider-agnostic, an MCP server with per-person API keys, roles, and a Sales page whose shape (queue, composer, context pane, Gmail OAuth) is most of the UI.

## Shape of the thing

Mirror the Sales rule. Gmail is the system of record for mail, the same way Attio is for deals. Postgres holds the machinery: the mirror of threads for speed and search, the drafts, the investigation notes, assignment and status, and an audit of every action.

```
fast@trackstar.art (Gmail)
      │  sync every 5 min (history.list), one-time backfill
      ▼
SupportThread / SupportMessage  ◄──── reps read, assign, reply here
      │ new inbound
      ▼
investigate()  ── classify scenario ── gather facts ── draft
      │              (playbook)        (Shopify, DB,   (llm.js)
      ▼                                 Etsy, past
SupportDraft + SupportAction            threads)
      │
      ▼
rep edits, clicks proposed actions, sends as fast@ via Gmail API
```

### The mailbox connection

One shared OAuth grant, signed in as fast@trackstar.art, not per rep like Sales. Scope `gmail.modify` (read, label, draft, send). Stored in SystemConfig under support-specific keys. This reuses the OAuth client machinery in `server/domain/sales/gmail.js` with a new callback route, `/api/support/gmail-callback`.

Sync: a cron every 5 minutes calls `users.history.list` from the last stored historyId, which is one cheap call when nothing changed. A one-time backfill walks `messages.list` over the whole mailbox. Gmail push through Pub/Sub is a later upgrade, not needed at 20 to 30 emails a day.

Sends go through the Gmail API as fast@, in the same thread, so threading and deliverability are what Matt gets today. Each rep has a signature (the playbook signs "Eli from Trackstar"; this becomes a per-person setting).

### Historical context

Backfill every thread in fast@ since the account started, plus support threads that landed in matt@trackstar.art (the playbook says customers do that). Each historical thread gets classified once into a playbook scenario and stored with that tag. The drafter then pulls the customer's own past threads and the most recent handful of threads with the same scenario, so Matt's actual replies are the few-shot examples. Vector similarity (pgvector in Supabase) is a v2 improvement; scenario tags plus customer history get most of the value without a second AI vendor.

### Knowledge

The Notion playbook stays the source of truth, the way Notion is for the charity program. A nightly job pulls the page through the Notion API and stores it as the current playbook text with a version hash. The drafter is given: the Trackstar Way and the 8 habits, the product and shipping facts, the tone rules, the escalation rules, and the matching scenario's decision tree and templates. Editing Notion is how a rep changes what Claude says. No prompt lives in code that a rep would need to edit.

### The investigation

`server/domain/support/investigate.js`. Deterministic pipeline, not an agent loop, so it runs on a local model later and is easy to test:

1. **Classify and extract.** One LLM call over the inbound message and the thread so far. Output: scenario number, confidence, and any identifiers it found (order number, runner name, email, race, the specific ask).
2. **Gather facts.** Plain functions, no model: orders for this email or name from Postgres (with status, design status, due date, proof and approval link, research result), Shopify order detail (fulfillment and tracking, refunds, discounts applied, line items, ship-to), Etsy if it is an Etsy order, the customer's past threads, and the scenario's playbook section.
   Discount codes are part of this. A code the customer pastes ("my code isn't working") is looked up in Shopify by its string (`codeDiscountNodeByCode`), which returns status, start and end dates, usage limit and once-per-customer, and that covers Klaviyo's unique codes too: Klaviyo creates them in Shopify as batches (title "CELEBRATE (date)", 100 single-use codes, 5-day expiry), so "expired" is the usual answer. Klaviyo's own API is only needed to find which code was issued to a given person (coupon-codes filtered by profile), when they lost the email; a fresh FIRSTNAME-15 from the playbook usually settles that without it, so Klaviyo is optional and read-only if added.
3. **Draft.** One LLM call with the facts and the playbook. Output is the note Daniela described:
   - `reply`: the email, in the Trackstar voice (Hey First Name, 2 to 5 sentences, no em dashes, signature slot)
   - `keyFacts`: what was found (order 1234, 12x18 black oak, ordered Oct 9, not yet in production)
   - `steps`: what the rep should check or do
   - `proposedActions`: structured, see below
   - `selfServeLinks`: tracking, approval portal, custom product page, cart
   - `escalate`: true with a reason when the playbook says Slack Matt (refund over $150, race organizer, legal or press, unsure)

Runs on a cron right after sync, so a draft is waiting within about five minutes of the email arriving. Reps can also press Redraft with a note ("they already sent the photos").

### Proposed actions, one click, never automatic

Daniela's team makes manual changes by hand to prevent errors. We keep that rule but remove the clicking: each proposed action is a button on the thread that calls a domain function and writes an audit event. Nothing executes without a person pressing it.

| Action | Backed by | Guardrail |
|---|---|---|
| Change ship-to address | Shopify order edit | Blocked once fulfilled |
| Create FIRSTNAME-15 code | Shopify discounts (existing `tools.discounts` capability) | One-time, named after the customer |
| Refund the difference, or full | Shopify refund | Amount in integer cents; over $150 needs an admin (`requireAdminRole`) |
| Update personalization or year | Order update (existing) | Blocked once in production |
| Tag REPRINT with note | Order tags (existing) | |
| Resend approval link | Existing approval token | |
| Add order comment | Existing | |
| Slack Matt with the thread | Webhook (existing) | Always available |
| Log a race request | New table, counts per race, flags at 3 | |

Not possible yet: Artelo order status, reprints and support tickets. The repo has an Artelo client for the image library only. The "where's my order" and broken-frame flows will show a link to the Artelo dashboard until Artelo gives us an order API. Worth asking them.

### Connectors

Two different things, and the plan needs both.

**Integrations the app calls server-side** (the drafter and the action buttons):

| System | Status | Needed |
|---|---|---|
| Gmail, fast@ | OAuth client exists for Sales | Redirect URI added, one sign-in as fast@, `gmail.modify` scope |
| Shopify Admin | Client credentials exist | Scopes for orders, customers, fulfillments, order edits, refunds, discounts; check the app's current scope list |
| Etsy | Exists | Nothing new |
| Postgres orders and research | Exists | Nothing new |
| Notion | Not in the app | Integration token with read on the Playbooks database |
| Slack | Webhooks exist | A support channel webhook for escalations |
| Artelo | Library only | Order API, if they have one |
| Yotpo review link | Not in the app | One config value |

**MCP tools the app exposes** (`server/services/mcp/tools/support.js`), so Claude Code, the Claude app, and the nightly routine can work the inbox the same way they work orders:

- `support_inbox` (read): open threads, by status, scenario, assignee
- `support_thread` (read): one thread with its messages, draft, facts, actions
- `support_draft` (write): draft or redraft a thread with an optional note
- `support_apply_action` (write): press one proposed action, by id
- `support_send` (write, `support` capability): send the current draft as fast@
- `support_assign`, `support_set_status` (write)

A key acts as a person and never exceeds their role, so a rep's key can send and an admin's key can approve a big refund. This is also what makes "Matt clears the inbox from his phone in the Claude app" work with no extra build.

The Claude connectors Daniela showed (Intercom, Slack in the Claude desktop app) are not needed. We are building the inbox, so the app is the connector.

### The page

`/support`, a sidebar tile next to Sales, behind a new `support` capability in `api/_lib/roles.js` and a new `support` role with sensible defaults. Three panes, the Sales layout:

- **Left, the queue.** Tabs: Open, Mine, Waiting on customer, Escalated, Done. Each row: customer, subject, scenario chip, draft-ready dot, assignee, age. Sorted oldest unanswered first, because same-day reply is habit one.
- **Middle, the thread.** Messages in order, then the draft in an editor with the rep's signature, Send as fast@, Redraft, Snooze, Close. Send has the same undo window as Sales.
- **Right, the note.** Key facts with links to the order in the Dashboard and in Shopify, the steps, the proposed action buttons, the self-serve links, the escalation flag, and the customer's past threads.

Multi-rep from day one: assignment with the existing AssigneePicker, a soft "Sam is on this" lock when two people open the same thread, per-rep signatures, every send and action audited with who did it.

### Data model

- `SupportThread`: gmailThreadId (unique), subject, customerEmail, customerName, status (open, waiting, escalated, closed), scenario, confidence, assigneeId, lastInboundAt, lastOutboundAt, snoozedUntil, linked order ids
- `SupportMessage`: gmailMessageId (unique), threadId, direction (in, out), from, to, subject, bodyText, bodyHtml, sentAt, sentById (null for inbound and historical), attachment metadata
- `SupportDraft`: threadId, version, reply, note JSON (facts, steps, links, escalation), scenario, model and tokens, status (proposed, edited, sent, discarded), the text as sent when sent
- `SupportAction`: threadId, draftId, kind, payload JSON (money as integer cents plus currency), status (proposed, applied, rejected), appliedById, appliedAt
- `SupportRaceRequest`: raceName, count, lastRequestedAt, threadIds
- `SystemConfig` keys: the fast@ refresh token, email, historyId, the playbook text and hash, per-rep signatures

## Phases

Each one ships on its own and is useful without the next.

**Phase 0, prerequisites (Matt, about an hour).** Add the support callback URI to the Google OAuth client and confirm the app is published, not in testing (testing-mode refresh tokens die after a week). Sign in once as fast@. Check the Shopify app's scopes cover refunds, order edits, customers and discounts. Create a Notion integration and share the Playbooks database with it. Pick a Slack channel for escalations. Decide signatures: "Eli from Trackstar" for everyone, or real names.

**Phase 1, the shared inbox.** Built 2026-10-16. Mailbox connection (`server/domain/support/mailbox.js`), backfill, 5-minute sync, the three-pane page at `/support` with assignment, status, snooze, and reply by hand as fast@. Order context on the right from Postgres and Shopify, no AI yet. Value on day one: everyone works one inbox with the order already found. Still to do by hand: the Phase 0 items, then Connect and Import mailbox history from the page.

**Phase 1b, the Intercom shape.** Built 2026-10-16. The page now follows Intercom's inbox: a views column (Your inbox, Mentions, Unassigned, All open, the parked states, one row per teammate with their open count), the conversation list with avatars, unread dots and waiting time, the conversation with internal notes and @mentions in the timeline alongside the events (assigned, closed, snoozed), a Reply or Note composer with macros and Send and close, a details panel with collapsible Customer, Conversation (assignee, priority, tags), Orders and Other conversations sections, and keyboard shortcuts (press ?). Macros are seeded from the playbook's templates and edited in the app. In Phase 2 Claude's draft and investigation land in the timeline as a note, which is exactly where Daniela's team reads theirs.

**Phase 1c, Instagram DMs.** Built 2026-10-16. DMs to @trackstar_art are a second channel in the same inbox: Meta's webhook delivers each DM to `/api/support/instagram-webhook` and it becomes a conversation with the same notes, assignment, status, macros and details panel; the composer replies as the account, starts empty (no greeting or sign-off), and holds the reply when Meta's 24-hour window after the customer's last message has closed (7 days once the Human Agent permission is approved). One thread per customer, keyed by their Instagram-scoped id. Still to do by hand: the Meta app, in `docs/support-instagram-setup.md`.

**Phase 2, investigation and drafts.** Playbook sync from Notion, scenario classification of the backfilled history, the investigate pipeline, drafts on every new inbound, Redraft. Measure the Daniela number: what share of drafts go out unedited. Expect to spend a couple of weeks correcting drafts and editing the playbook; that is the feeding period she described.

**Phase 3, one-click actions.** The action table above, with guardrails and audit. Escalation posts to Slack with a link to the thread.

**Phase 4, MCP and the feedback loop.** The support tools on `/api/mcp`. A weekly summary of where reps changed the draft, grouped by scenario, as suggested playbook edits. Metrics: first-response time, volume by scenario, drafts accepted, per rep.

**Later, if wanted.** pgvector similarity over past replies. Gmail push. Etsy messages into the same queue. Auto-send for the lowest-risk scenario (the standard "note from owner" thank-you) once the unedited rate earns it. All of it stays provider-agnostic through `server/lib/llm.js`, so it moves to our own GPUs with the rest.

## Open questions and risks

- **Artelo.** No order status, reprint or ticket API in the repo. Until there is one, those flows link out.
- **Refunds are money.** The repo has no money model yet; actions store integer cents plus currency, and the $150 line is enforced in code with an admin re-check, not in the prompt.
- **Gmail app status.** If the Google OAuth app is still in testing, the shared grant expires weekly and the inbox goes stale silently. Phase 0 checks this.
- **Vercel budget.** Sync is 288 calls a day plus one drafting run per inbound email. Within what the recent usage cuts left room for.
- **Customer data in Postgres.** Email bodies are more sensitive than order rows. Support tables are admin and support role only, and the MCP tools return shaped objects, never raw messages to a read-only key.
- **Two senders.** Everyone sends as fast@. The signature is the only thing that says who. Fine for customers; the audit log says who for us.
- **Volume is seasonal.** The build has to be cheap to run at 3 emails a day in July, which is why it is crons and a mirror, not a long-running service.
