# Finance panel: plan

An admin-only hub for everything money inside TrackstarOS: where the money goes each day, what the team is owed, hours from the support team with approval, and forecasts. Written 2026-11-03 from Matt's brief, the Daily Tracker sheet, the Custom Counter, and a pass over the finance products worth copying. Nothing here is built yet.

## What we have today

- **The Daily Tracker** (Google Sheet "Trackstar Daily Tracker (2026)"). Five raw tabs pasted by hand each day (Shopify Analytics, Etsy, Artelo print shop, Meta Ads, Google Ads) and five derived tabs: Daily Scoreboard (revenue, fees, production, shipping, ad spend, gross profit, designer fee, contribution margin, ROAS, AOV, CPA, break-even CPA, organic share), The Levers (channel split, Meta and Google detail, the Shopify funnel, cost structure), Weekly and Monthly Roll-Ups, YTD. The app already reads this sheet through the service account (`server/services/googleSheets.js`, used by the Monopoly board), so reading it into the app is wiring, not integration.
- **The Custom Counter** (Settings > Team). Customs per designer per month, new or repeat, each designer's rate, the month-end Slack statement cron (`api/cron/custom-statements`). Money already in integer cents. This is the first piece of team pay the app does.
- **Rates and people.** Roles with capabilities (`api/_lib/roles.js`), a money gate that keeps prices and costs admin-only (`api/_lib/money.js`), per-person Slack DM webhooks (Dan, Creed, Frank, Eli), the audit log.
- **Costs the app already knows.** Artelo landed cost per size and frame, Artelo's whole-order price check, sample spend (`SampleCost`), bulk-order invoices as Shopify drafts, the Pricing Calculator (cost, retail, margin by channel).
- **Tickets Resolved** (Settings > Stats): closes per support person per day. Output, not hours.
- **A 13-week cash-flow template** Matt opened on 2026-11-02 (the Gusto build): opening balance, cash in by type, cash out by type, lowest projected cash and the week it happens.
- **Not in the app:** bank balance, Meta and Google Ads, QuickBooks (connected to Claude, not to the app), payroll, hours.

## The rule the panel follows

Same rule as Sales (Attio) and Support (Gmail): the system of record stays where the money actually moves. Shopify, Etsy and Artelo hold the transactions; Meta holds the ad spend; the bank holds the cash; QuickBooks holds the books. Postgres holds a **daily finance ledger** (one row per day, every column integer cents, each column tagged with where it came from) plus the machinery nothing else owns: timesheets, the payouts ledger, targets, forecast drivers. Derived numbers (gross profit, contribution margin, ROAS, AOV, CPA) are computed in one domain module and never stored, so when a rule changes (the designer fee moved from 7.5% of gross profit to 7.5% of contribution margin in November) it changes in one place and history recomputes.

The sheet stays the entry point for now. The app reads the sheet's raw tabs into the ledger nightly, then each source gets automated one at a time (Shopify first), and each column flips from "sheet" to "api". When every column is automated the sheet is a mirror and can be retired, with its history already in the ledger.

```
Shopify (ShopifyQL, Payments)   Etsy   Artelo   Meta Ads   Google Ads   bank   QuickBooks
         \              \         |       |          |          /        /
          \      today: pasted into the Daily Tracker sheet by hand     /
           \_______________________________|___________________________/
                                           v
                     FinanceDay  (one row per day, cents, source per column)
                                           |
          +--------------------------------+--------------------------------+
          v                                v                                v
   Overview dashboard               Payouts ledger                     Forecast
   where the money went      customs, hours, designer fee,      race-driven revenue,
   today / MTD / period       bonuses; owed -> approved -> paid    13-week cash flow
                                           ^
                                   Timesheets (support reps log hours in Support,
                                   submit the week, Matt approves in Finance)
```

## What we copy, and from where

| Element | Where it comes from |
|---|---|
| Three big numbers on top, no chart needed: Cash, Burn, Runway | Puzzle |
| Metric tile = value, delta vs the compare period, 30-day sparkline, and a plain-English "how this is computed" on hover | Stripe (today over yesterday), Runway (readable formulas) |
| Period bar: Today, Yesterday, 7d, MTD, QTD, YTD, custom, with compare-to-previous | Stripe, Mercury |
| "Where the money went": revenue down to contribution margin as a waterfall, with category rows showing share of revenue | Ramp (budget rows with utilization), Mercury (spend by category) |
| Money in vs money out by day, actual solid and forecast dashed, split at today | Mercury, Causal |
| A review queue that shows anomalies and never acts on them (fee mismatch, ROAS under break-even, a day with no data) | Puzzle, Ramp |
| Week grid for hours: rows of entries, seven day columns, a daily totals bar, Submit week with a confirm step | Harvest |
| Submitted = locked, approved = locked, "withdraw approval" is the only way back; reject carries a note | Harvest, Toggl |
| Team timesheets list with status and approver filters, Approve and Reject per row, Approve all for the period | Toggl, Homebase |
| Errors flagged before approval: a day over 12 hours, a missing day, overlapping entries | Homebase |
| A pay run as an object: period, people, lines (qty x rate or hours x rate), note per line, draft -> approved -> paid; per-person history and a statement | Gusto |
| Keyboard shortcuts behind `?` | Stripe, and our own Support page |

Puzzle's cash / burn / runway triad is the one to be careful with: Trackstar is profitable and event-driven, so "burn" is not the headline. The three numbers here are **Revenue, Contribution margin, Cash** for the chosen period, with ad spend and ROAS right behind them.

## The page: `/finance`

A sidebar tile, admin only, the way Creators is. A sub-nav like Sales (Outreach, Templates, Sequences): **Overview, Daily, Payouts, Timesheets, Forecast**, each with its own address. Everything in Eastern time, like the rest of the app. Built from `src/lib/ui.ts` and the existing components; one chart dependency (Recharts) styled with the app's tokens and the `dataviz` skill's rules, no dashboard kit.

### Overview: where the money is going

Top to bottom:

1. **Period bar.** Today with MTD beside it by default. Compare-to-previous on. "Through yesterday" shown plainly whenever today's columns are still empty, because the sheet is filled in the morning for the day before.
2. **Headline tiles.** Revenue (Shopify + Etsy), Contribution margin and CM %, Ad spend with blended ROAS, Orders with AOV, Cash in the bank (a manual snapshot until a bank connection exists) with days of cash at the period's net. Each tile: value, delta vs the compare period, sparkline, formula on hover.
3. **Where the money went.** A waterfall for the period: Revenue, less Shopify and Etsy fees, less Production, less Shipping, less Ad spend (Meta, Google), less Designer fee, equals Contribution margin. Beside it the same lines as rows with share-of-revenue bars. This is the "where is the money going" answer in one look.
4. **Daily trend.** Revenue line over stacked bars (COGS, ad spend, CM) for 30 or 90 days, race days marked from the Race table, because every spike is a race.
5. **Pacing.** MTD against the month's target and the forecast (solid actual, dashed forecast), with last month and the same month last year for scale.
6. **Levers strip.** Meta ROAS and CPA, Google, Shopify funnel CVR, cost per unit, COGS %, ad spend %, break-even CPA. The Levers tab as small cards, each clicking through to Daily.
7. **Needs you** (right column). Timesheets waiting for approval, payouts owed, days with missing data, anomalies (CM % under a floor, blended ROAS under the break-even rule, Shopify fees off from what Shopify Payments actually charged). Shows, never acts.

### Daily: the tracker, in the app

The Daily Scoreboard and The Levers as one table, month picker, a day opens to its full row. Every cell knows its source (sheet, api, manual) and shows a missing state rather than a dash. Hand-entered columns are editable here (that becomes the entry point once the sheet retires). Weekly and monthly roll-ups as the sheet has them. Export CSV. In phase 2 a reconciliation view puts the app's number next to the sheet's for every day, so the sheet can be retired on proof rather than trust.

### Payouts: who is owed what

- **Pay runs.** One per period (a month for customs and the designer fee, a week or two for hours, whatever the cadence is). Lines: person, kind (customs, hours, designer fee, bonus, reimbursement, other), quantity x rate, amount, note. Status draft -> approved -> paid; Mark paid records the date and a reference (Venmo, Wise, bank). Nothing moves money; this is the record Matt pays from, and the reason "did I pay Creed for October" has an answer.
- **Lines come from:** the Custom Counter (customs x rate, new and repeat), approved timesheets (hours x the person's hourly rate, frozen at approval), the designer fee (7.5% of the month's contribution margin, computed from the ledger once Daily has the month; typed until then), and anything else by hand.
- **Customs** is the Custom Counter moved here wholesale: same UI, same rates editor, same month-end Slack statement cron. `/settings/counter` redirects. The rates editor becomes **Payouts > Rates**: every person's custom rates (new and repeat) and hourly rate side by side, because the rates differ person to person. A change is audited and never touches a week already approved.
- **Per person:** history of every line and payment, a statement for a period (what the Slack DM already says, as a page), CSV export.
- **Partner payouts** (race revenue share, the 30/45-day payout the `race-payouts` skill runs from Attio and ClickUp today) belong here too, as a later tab: deal terms from Attio, sales in the race window from the ledger, the report and the email draft. Phase 4.

### Timesheets: everyone logs their own hours, Matt sees them all

**The team's side.** Every team member with the capability logs their own hours and submits them. Support reps get an "Hours" row at the bottom of the Support views column, next to Macros and Settings, and a small running-timer mark in the header when one is going; everyone else reaches the same week from Hours in the rail's Tools popup, beside Discounts and Pace Converter. Either way it opens the week: seven day columns, each entry a duration and a note (what they were on), typed or from a start/stop timer, a daily totals bar and the week total. "Submit week" asks once, then the week is locked and Matt is pinged. A rejected week comes back unlocked with his note on it. Works on a phone, since that is where a rep may be. Reminders by Slack DM through the per-person webhooks: Monday morning if last week is not submitted; on reject.

**Matt's side, Finance > Timesheets.** Every person's weeks with status and filters (draft, submitted, approved, rejected, by person), per-row Approve or Reject with a note, Approve all for the period. Draft weeks are in the list with the hours logged so far, so Matt sees anyone's hours at any time, not only once they are submitted. Before approval the row flags what Homebase flags: a day over 12 hours, a working day with nothing, overlapping entries. Approved is locked for everyone; "withdraw approval" is the only way to reopen, and it is audited. Hours x rate land as a payout line the moment a week is approved. A report: hours by person by week, and cost.

**Who can log hours** is a capability (`hours`) in the Roles panel, on by default for Customer Support and given to anyone else paid by the hour from the Roles panel, no code. A person sees only their own hours; admins see everyone's, drafts included. Matt will add the live team members in Settings > People; their rates go in Payouts > Rates. Help shifts (Order Assignment) are a different thing and stay where they are.

### Forecast

Two models, both driver-based, both with scenarios as toggles and drivers editable inline (the Runway shape):

1. **Race-driven revenue.** Trackstar's revenue is a calendar of races. For the next 90 days: each race from the Race table x last year's orders for that race (the Order table has them) x a growth factor x AOV, plus a baseline for days with no race. Expected orders and revenue by week; actuals fill in as days pass; variance shown. This is the forecast nobody else can give Matt, because it needs our order history.
2. **13-week cash flow.** The template Matt opened, in the app: opening balance (a snapshot typed in per bank; Trackstar uses several banks and connecting them is for later, when Matt is ready), cash in from the revenue forecast net of fees with Shopify's payout lag, cash out from Artelo as a share of revenue, the ad spend plan, payouts due, subscriptions and fixed costs, taxes, owner draws. Lowest projected cash and the week it happens. Scenarios: base, push ads, pull back.

Targets (monthly revenue, CM, ad spend) live here and drive the pacing on Overview.

## Data model

Money is integer cents with a currency (CLAUDE.md). Nothing derived is stored.

- `FinanceDay`: `date` (unique, ET), the raw inputs as cents and counts: Shopify gross, discounts, returns, shipping charged, tax, net, orders, sessions, add-to-carts, checkouts, fees; Etsy revenue, orders, fees; production, shipping, units produced; Meta spend, impressions, clicks, purchases, purchase value; Google spend, conversions, conversion value; organic orders; `sources` JSON (which column came from sheet, api or manual) and `updatedAt`.
- `FinanceRule`: effective-dated constants (designer fee share and its base, break-even ROAS, fee percentages), so the November rule change is a row, not a code edit.
- `Timesheet`: `userId`, `weekStart` (Monday, ET), status draft / submitted / approved / rejected, `submittedAt`, `reviewedById`, `reviewedAt`, `reviewNote`, `hourlyRateCents` frozen at approval. Unique per person per week.
- `TimeEntry`: `timesheetId`, `date`, `minutes`, optional `startedAt` and `endedAt` (timer), `note`.
- `PayRun`: period label, status draft / approved / paid, who created and approved it, note.
- `PayoutLine`: `payRunId`, `userId`, kind, `quantity`, `rateCents`, `amountCents`, `currency`, `sourceRef` (the month, the timesheet ids), note, `paidAt`, `paidRef`.
- `FinanceTarget`: month, revenue, CM, ad spend.
- `ForecastDriver`: scenario, key, value, effective from. `CashSnapshot`: date, cents, source.
- `User.hourlyRateCents` (nullable): the person's own hourly rate, set in Payouts > Rates next to the existing `customRateCents` and `customRepeatRateCents`. A changed rate applies from the next approval; approved weeks keep the rate they were approved at.
- Audit events for every approval, rejection, withdrawal, mark-paid, rate change and manual cell edit.

## Data sources, and when each one leaves the sheet

| Column | Today | Phase | How |
|---|---|---|---|
| Shopify sales, discounts, returns, shipping, tax, orders, funnel | pasted daily from Analytics | 2 | ShopifyQL through the Admin GraphQL API (`shopifyqlQuery`, in 2026-10, `read_reports` scope): `FROM sales SHOW ... TIMESERIES day`; sessions and funnel from the sessions source (confirm it exposes add-to-cart and checkout) |
| Shopify fees | a formula | 2 | Shopify Payments balance transactions and payout summaries (`read_shopify_payments`): the fees actually charged, and the payout schedule for cash timing |
| Etsy revenue, orders, fees | pasted | 2 | the Etsy client we have (receipts) plus the payment ledger for fees |
| Production and shipping (Artelo) | pasted | 2 | per order from the order data the import already stores, cross-checked with the landed-cost lookup; Artelo's invoice stays the reference |
| Meta spend, purchases, value | pasted | 2 | Marketing API insights with a system-user token; a new `meta_ads` Connection with a read-only test |
| Google Ads spend, conversions, value | pasted | 2 | the Google Ads API: OAuth through the existing Google client plus a developer token (apply for Basic access in Phase 0; the token lives on a manager account); a `google_ads` Connection with a read-only test |
| Cash in the bank | nowhere | 3 (snapshot) | a balance typed in when it changes, one line per bank; connecting the banks is deliberately later, when Matt is ready |
| Fixed costs, software, the full P&L | QuickBooks (the books) | 4 | QuickBooks Online API, P&L by month, read-only |

While any column is still manual, the nightly sync reads the sheet's raw tabs into `FinanceDay`. A Refresh button runs it on demand. Automated columns are also written back to the sheet during the transition so the sheet keeps working for anyone used to it; when nothing is manual any more, the write-back stops and the sheet is archived.

## MCP tools

`server/services/mcp/tools/finance.js`: `finance_overview` (read, admin; the headline numbers for a period), `finance_day` (read, admin), `payouts_owed` (read, admin), `timesheet_week` and `timesheet_log` (own hours, for anyone with the capability), `timesheet_submit`, `timesheet_review` (admin). A key acts as a person and never exceeds their role, so "log two hours for today" from a phone is a write as that rep, and nobody else can read the numbers. The nightly routine can post yesterday's scoreboard to Slack from `finance_overview` (phase 2, optional).

## Phases

Each one ships on its own and is useful without the next.

**Phase 0, prerequisites (Matt, about an hour).** Add the live team members in Settings > People and, once Payouts > Rates exists, their rates (or send the rates and I set them). The pay cadence for hours. Who the designer fee goes to and whether the app should compute it. Add `read_reports` and `read_shopify_payments` to the Shopify app's scopes. A Meta system-user token with ads_read. Apply for a Google Ads developer token (Basic access) on the manager account, because approval takes days and Phase 2 needs it. Monthly targets for November and December.

**Phase 1, the hub over the sheet.** The `/finance` route and tile, the sub-nav, `FinanceDay` filled from the sheet nightly and on Refresh, the scoreboard math in `server/domain/finance/`, Overview (tiles, waterfall, trend, levers, needs-you), Daily (table, roll-ups, CSV), the Custom Counter moved to Payouts > Customs with the redirect, the payouts ledger with rates and Mark paid, Timesheets end to end (hours from Support and from the rail, drafts visible to admins, submit, Slack reminders, approval and locking in Finance, hours into payouts), per-person rates for customs and hours in Payouts > Rates, the `hours` capability, audit events, the MCP tools. Day one value: one place for the scoreboard, the first approved timesheet, and the first pay run.

**Phase 2, automate the inputs.** Shopify (ShopifyQL and Payments fees), Etsy, Artelo, Meta and Google Ads, each as a Connection with a test; source flags flip from sheet to api; the reconciliation view; mismatch alerts in Needs you; the sheet write-back; the daily Slack scoreboard.

**Phase 3, forecast.** The race-driven revenue forecast, the 13-week cash flow with scenarios, targets and pacing on Overview, the cash snapshot typed per bank.

**Phase 4, the rest of the money.** QuickBooks P&L and fixed costs for a full P&L view (QuickBooks is the books), partner payouts as a tab, the bank connections when Matt is ready for them (several banks, so one adapter per bank), and retiring the sheet once every column is automated and the history is in the ledger.

## Decisions this plan makes

- Finance is admin-only as a whole. The one non-admin surface is Hours: in Support for the reps, in the rail's Tools for anyone else with the capability.
- Everyone logs their own hours and submits them; admins see every week, draft or not, at any time.
- Rates are per person, for hours as well as customs, set in one place and audited.
- Hours are weeks of durations with notes and an optional timer, not clock-in and clock-out punches: the reps work remotely and asynchronously, and Matt approves a week, not a shift.
- Approval locks. The only way to change an approved week is to withdraw the approval, and that is audited.
- The Custom Counter moves as it is. Same rules, same month-end statement; it gains a home and a pay-run line, not a rewrite.
- The app records payments; it does not make them. No payroll or bank transfers.
- One chart dependency (Recharts), styled from the app's tokens.

## Answered by Matt, 2026-11-03

- Team members log their own hours in the tracker and submit them; admins can see everyone's hours as well, at any time.
- Rates differ by person, so rates are assigned per team member.
- QuickBooks is the books.
- Several banks, and not ready to connect them yet. Cash stays a typed snapshot until then.
- Google Ads gets automated, not typed.
- The live team members will be added soon.

## Still open

1. Pay cadence for hours: weekly, every two weeks, or monthly?
2. The designer fee, 7.5% of contribution margin: who receives it, and should the app compute and post it to the pay run, or stay a line Matt types?
3. November and December targets for revenue, contribution margin and ad spend, so pacing has something to pace against from day one.
4. Should the daily scoreboard also go to Slack each morning?

## Not in this plan

Paying people or vendors from the app. A general ledger or bookkeeping. Finance for non-admins. Rebuilding the sheet's formulas cell by cell: the app computes the same numbers from the same inputs, and the reconciliation view proves it before the sheet goes.
