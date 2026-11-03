# Finance panel: plan

An admin-only hub for everything money inside TrackstarOS: where the money goes each day, what the team is owed, hours from the team with approval, and forecasts. Written 2026-11-03 from Matt's brief, the Daily Tracker sheet, the Custom Counter, and a pass over the finance products worth copying. Nothing here is built yet.

## What we have today

- **The Daily Tracker** (Google Sheet "Trackstar Daily Tracker (2026)"). Five raw tabs already fed automatically (Shopify, Etsy, Artelo print shop, Meta Ads, Google Ads: plain values written by the feeds, a day's numbers landing the next morning) and five derived tabs: Daily Scoreboard (revenue, fees, production, shipping, ad spend, gross profit, designer fee, contribution margin, ROAS, AOV, CPA, break-even CPA, organic share), The Levers (channel split, Meta and Google detail, the Shopify funnel, cost structure), Weekly and Monthly Roll-Ups, YTD. The app already reads this sheet through the service account (`server/services/googleSheets.js`, used by the Monopoly board), so reading it into the app is wiring, not integration.
- **The Custom Counter** (Settings > Team). Customs per designer per month, new or repeat, each designer's rate, the month-end Slack statement cron (`api/cron/custom-statements`). Money already in integer cents. This is the first piece of team pay the app does.
- **Rates and people.** Roles with capabilities (`api/_lib/roles.js`), a money gate that keeps prices and costs admin-only (`api/_lib/money.js`), per-person Slack DM webhooks (Dan, Creed, Frank, Eli), the audit log.
- **Costs the app already knows.** Artelo landed cost per size and frame, Artelo's whole-order price check, sample spend (`SampleCost`), bulk-order invoices as Shopify drafts, the Pricing Calculator (cost, retail, margin by channel).
- **Tickets Resolved** (Settings > Stats): closes per support person per day. Output, not hours.
- **A 13-week cash-flow template** Matt opened on 2026-11-02 (the Gusto build): opening balance, cash in by type, cash out by type, lowest projected cash and the week it happens.
- **Not in the app:** bank balances, QuickBooks (connected to Claude, not to the app), payroll, hours. The ad platforms and the print shop reach the app only through the sheet, and that is fine: the sheet already does that job.

## The rule the panel follows

Same rule as Sales (Attio) and Support (Gmail): the system of record stays where the money actually moves. Shopify, Etsy and Artelo hold the transactions; Meta holds the ad spend; the bank holds the cash; QuickBooks holds the books. Postgres holds a **daily finance ledger** (one row per day, every column integer cents, each column tagged with where it came from) plus the machinery nothing else owns: timesheets, the payouts ledger, targets, forecast drivers. Derived numbers (gross profit, contribution margin, ROAS, AOV, CPA) are computed in one domain module and never stored, so when a rule changes (the designer fee moved from 7.5% of gross profit to 7.5% of contribution margin in November) it changes in one place and history recomputes.

The sheet's raw tabs are the feed, and the app does not rebuild them. Those tabs are already filled automatically from Shopify, Etsy, Artelo, Meta and Google Ads, so the app reads them (never the derived tabs) into the ledger, does the scoreboard math itself, and checks its own numbers against the sheet's Daily Scoreboard. Rebuilding five integrations the sheet already has would be a second copy of the same data that can drift from the first. The app takes a feed over only if that feed breaks for good, or on the day the sheet is retired; the API notes at the end are the map for that day.

```
Shopify        Etsy       Artelo      Meta Ads     Google Ads       banks      QuickBooks
   \             \           |            |            /              |            |
    \    already automated into the Daily Tracker's raw tabs         /    typed     later
     \_________________________________|____________________________/   snapshot    (P&L)
                                           v
                     FinanceDay  (one row per day, cents, source per column)
                                           |
          +--------------------------------+--------------------------------+
          v                                v                                v
   Overview dashboard               Payouts ledger                     Forecast
   where the money went      customs, hours, designer fee,      race-driven revenue,
   today / MTD / period       bonuses; owed -> approved -> paid    13-week cash flow
                                           ^
                                   Timesheets (the team logs hours in Support or from the rail,
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
| A review queue that shows anomalies and never acts on them (a feed that did not land, ROAS under break-even, the app and the sheet disagreeing) | Puzzle, Ramp |
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

1. **Period bar.** Today with MTD beside it by default. Compare-to-previous on. "Through yesterday" shown plainly whenever today's columns are still empty, because the feeds land the next morning.
2. **Headline tiles.** Revenue (Shopify + Etsy), Contribution margin and CM %, Ad spend with blended ROAS, Orders with AOV, Cash in the bank (a manual snapshot until a bank connection exists) with days of cash at the period's net. Each tile: value, delta vs the compare period, sparkline, formula on hover.
3. **Where the money went.** A waterfall for the period: Revenue, less Shopify and Etsy fees, less Production, less Shipping, less Ad spend (Meta, Google), less Designer fee, equals Contribution margin. Beside it the same lines as rows with share-of-revenue bars. This is the "where is the money going" answer in one look.
4. **Daily trend.** Revenue line over stacked bars (COGS, ad spend, CM) for 30 or 90 days, race days marked from the Race table, because every spike is a race.
5. **Pacing.** MTD against the month's target and the forecast (solid actual, dashed forecast), with last month and the same month last year for scale.
6. **Levers strip.** Meta ROAS and CPA, Google, Shopify funnel CVR, cost per unit, COGS %, ad spend %, break-even CPA. The Levers tab as small cards, each clicking through to Daily.
7. **Needs you** (right column). Timesheets waiting for approval, payouts owed, days with missing data, anomalies (CM % under a floor, blended ROAS under the break-even rule, a feed that has not landed by noon, the app's scoreboard disagreeing with the sheet's). Shows, never acts.

### Daily: the tracker, in the app

The Daily Scoreboard and The Levers as one table, month picker, a day opens to its full row. Every cell knows its source (sheet, or manual when Matt overrides a value a feed got wrong) and shows a missing state rather than a dash. Weekly and monthly roll-ups as the sheet has them. Export CSV. A reconciliation view puts the app's scoreboard next to the sheet's for every day, so a disagreement is seen the day it happens, and the sheet's derived tabs can one day be retired on proof rather than trust.

### Payouts: who is owed what

- **Pay runs.** Hourly people are paid every two weeks, so hours runs cover two-week periods; designers are paid for customs at the end of the month, so customs and Dan's fee run monthly. Lines: person, kind (customs, hours, designer fee, bonus, reimbursement, other), quantity x rate, amount, note. Status draft -> approved -> paid; Mark paid records the date and a reference (Venmo, Wise, bank). Nothing moves money; this is the record Matt pays from, and the reason "did I pay Creed for October" has an answer.
- **Lines come from:** the Custom Counter (customs x rate, new and repeat), approved timesheets (hours x the person's hourly rate, frozen at approval), Dan's head-of-design fee (7.5% of the month's contribution margin, computed from the ledger when the month closes and posted to his month-end run beside his customs; the share and its base live in `FinanceRule`, so October and earlier recompute at 7.5% of gross profit), and anything else by hand.
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

- `FinanceDay`: `date` (unique, ET), the raw inputs as cents and counts: Shopify gross, discounts, returns, shipping charged, tax, net, orders, sessions, add-to-carts, checkouts, fees; Etsy revenue, orders, fees; production, shipping, units produced; Meta spend, impressions, clicks, purchases, purchase value; Google spend, conversions, conversion value; organic orders; `sources` JSON (which column came from the sheet and which Matt overrode by hand) and `updatedAt`.
- `FinanceRule`: effective-dated constants (designer fee share and its base, break-even ROAS, fee percentages), so the November rule change is a row, not a code edit.
- `Timesheet`: `userId`, `weekStart` (Monday, ET), status draft / submitted / approved / rejected, `submittedAt`, `reviewedById`, `reviewedAt`, `reviewNote`, `hourlyRateCents` frozen at approval. Unique per person per week.
- `TimeEntry`: `timesheetId`, `date`, `minutes`, optional `startedAt` and `endedAt` (timer), `note`.
- `PayRun`: period label, status draft / approved / paid, who created and approved it, note.
- `PayoutLine`: `payRunId`, `userId`, kind, `quantity`, `rateCents`, `amountCents`, `currency`, `sourceRef` (the month, the timesheet ids), note, `paidAt`, `paidRef`.
- `FinanceTarget`: month, revenue, CM, ad spend.
- `ForecastDriver`: scenario, key, value, effective from. `CashSnapshot`: date, cents, source.
- `User.hourlyRateCents` (nullable): the person's own hourly rate, set in Payouts > Rates next to the existing `customRateCents` and `customRepeatRateCents`. A changed rate applies from the next approval; approved weeks keep the rate they were approved at.
- Audit events for every approval, rejection, withdrawal, mark-paid, rate change and manual cell edit.

## Data sources: the sheet's raw tabs

The five raw tabs are already filled automatically (plain values written by the feeds; the Etsy tab says so in its own header, and a day's numbers land the next morning). The app reads them with the service account it already has, and never the derived tabs:

| Tab | What the app takes | Into |
|---|---|---|
| Shopify Data | gross sales, discounts, returns, shipping charged, taxes, net sales, orders, sessions, add to cart, reached checkout, completed checkout, Shopify fees | the Shopify columns of `FinanceDay` |
| Etsy Data | gross sales, discounts, returns, and the rest of its columns as the feed fills them | the Etsy columns |
| Print Shop | production costs, shipping costs, units produced | production, shipping, units |
| Meta Ads | spend, impressions, clicks, purchases, purchase value, add to carts | the Meta columns |
| Google Ads | spend, conversions, conversion value, clicks | the Google columns |

Each run reads the whole year back to January, so a feed that corrects an earlier day is picked up, and every cell is tagged `sheet` with the time it was read. A manual override (Matt fixing a value a feed got wrong) is tagged `manual`, audited, and survives the next read. Schedule: a cron each morning from 7am Eastern, hourly until every tab has yesterday, then done; a Refresh button for right now. If a tab still has no row for yesterday by noon, Needs you says which feed is late.

The derived tabs (Daily Scoreboard, The Levers, the roll-ups) are not read for numbers. They are read once a day for the reconciliation view, which puts the app's computed scoreboard beside the sheet's and flags any day that differs by more than rounding.

Cash and the books are not in the sheet. Cash is a balance typed in per bank when it changes (several banks; connecting them is for when Matt is ready). The full P&L with fixed costs comes from QuickBooks in Phase 4 (QuickBooks Online API, P&L by month, read-only).

### If a feed ever has to move into the app

Only if a feed breaks for good or the sheet is retired. Verified on 2026-11-03: Shopify's Admin GraphQL API (2026-10) has `shopifyqlQuery` behind the `read_reports` scope (`FROM sales SHOW ... TIMESERIES day`), and Shopify Payments exposes balance transactions and payout summaries behind `read_shopify_payments`, which gives the fees actually charged and the payout schedule. Etsy has the receipts client we already run plus a payment ledger for fees. Artelo costs can come from the order data the import already stores, cross-checked with the landed-cost lookup. Meta is the Marketing API insights endpoint with a system-user token. Google Ads needs a developer token on a manager account (a Basic-access application, which takes days). Each would be a Connection with a read-only test, proven against the sheet's copy before that copy is switched off.

## MCP tools

`server/services/mcp/tools/finance.js`: `finance_overview` (read, admin; the headline numbers for a period), `finance_day` (read, admin), `payouts_owed` (read, admin), `timesheet_week` and `timesheet_log` (own hours, for anyone with the capability), `timesheet_submit`, `timesheet_review` (admin). A key acts as a person and never exceeds their role, so "log two hours for today" from a phone is a write as that rep, and nobody else can read the numbers.

## Phases

Each one ships on its own and is useful without the next.

**Phase 0, prerequisites (Matt, about half an hour).** Add the live team members in Settings > People and, once Payouts > Rates exists, their rates (or send the rates and I set them). The end date of the current two-week hours period, so the runs line up with how people are paid today. Monthly targets for November and December. Nothing to set up on the Shopify, Meta or Google side: the sheet's feeds already cover them.

**Phase 1, the hub over the sheet.** The `/finance` route and tile, the sub-nav, `FinanceDay` filled from the sheet's raw tabs each morning and on Refresh, the scoreboard math in `server/domain/finance/`, Overview (tiles, waterfall, trend, levers, needs-you), Daily (table, roll-ups, CSV), the Custom Counter moved to Payouts > Customs with the redirect, the payouts ledger with two-week hours runs and month-end customs runs, Dan's 7.5% fee posted monthly, rates and Mark paid, Timesheets end to end (hours from Support and from the rail, drafts visible to admins, submit, Slack reminders, approval and locking in Finance, hours into payouts), per-person rates for customs and hours in Payouts > Rates, the `hours` capability, audit events, the MCP tools. Day one value: one place for the scoreboard, the first approved timesheet, and the first pay run.

**Phase 2, trust the feed.** The reconciliation view (the app's scoreboard beside the sheet's, every day), feed-freshness alerts in Needs you, manual overrides on Daily with an audit trail, the year's history read in from the raw tabs back to January, the Weekly and Monthly roll-ups. After this the sheet's derived tabs are a mirror of the app and nobody has to open the sheet to know the numbers.

**Phase 3, forecast.** The race-driven revenue forecast, the 13-week cash flow with scenarios, targets and pacing on Overview, the cash snapshot typed per bank.

**Phase 4, the rest of the money.** QuickBooks P&L and fixed costs for a full P&L view (QuickBooks is the books), partner payouts as a tab, the bank connections when Matt is ready for them (several banks, so one adapter per bank), and, only if the sheet is ever retired, the feeds moved into the app one at a time as the API notes describe, each proven against the sheet's copy first.

## Decisions this plan makes

- Finance is admin-only as a whole. The one non-admin surface is Hours: in Support for the reps, in the rail's Tools for anyone else with the capability.
- Everyone logs their own hours and submits them; admins see every week, draft or not, at any time.
- Rates are per person, for hours as well as customs, set in one place and audited.
- The sheet's raw tabs are the feed. The app reads them and owns the math; it does not rebuild the integrations the sheet already has.
- Hours are paid every two weeks, customs and Dan's fee at month end; pay runs follow those two cadences.
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
- The raw tabs of the Daily Tracker are already automated (Shopify, Etsy, Artelo, Meta, Google Ads), so the app reads them instead of rebuilding the feeds.
- Hourly workers are paid every two weeks; designers are paid for customs at the end of the month.
- Dan, head of design, gets 7.5% of contribution margin.
- No Slack ping for the daily scoreboard.
- The live team members will be added soon.

## Still open

1. The end date of the current two-week hours period, so the first hours run lines up with how people are paid today.
2. November and December targets for revenue, contribution margin and ad spend, so pacing has something to pace against from day one.

## Not in this plan

Paying people or vendors from the app. A general ledger or bookkeeping. Finance for non-admins. Rebuilding the sheet's formulas cell by cell: the app computes the same numbers from the same inputs, and the reconciliation view proves it before the sheet goes.
