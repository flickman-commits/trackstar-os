---
name: nightly-sweep
description: Run the nightly fulfillment-tool upkeep pass — sweep, repair broken scrapers (diagnose on the server, fix the code, prove it on a preview, merge to main, confirm in production), work the untested backlog, and file the morning report. Use when the scheduled nightly routine fires, or when Matt asks to "run the sweep" / "do the nightly check" by hand.
---

# Nightly sweep

## What this is

The nightly routine that keeps Trackstar's scrapers working without Matt. The
server establishes the facts with production credentials; you act on them. Since
2026-09-27 that includes **repairing scrapers**: you can see what a timing site
sends back, change the scraper code, prove the change against the live site on a
Vercel preview, and ship it to `main`.

Matt's morning report has three blocks — **Things fixed**, **Things that need
you**, and one line of scraper health — plus a **Coming up** line for the next
few races. The goal of every night is for the middle
block to say "Nothing, I handled everything" and mean it.

**You reach Trackstar only through the Trackstar_Ops MCP tools.** Your sandbox's
network refuses fast.trackstar.art and every timing site. Do not curl either;
`trace_scraper` and `fetch_timing_page` are how you see a timing site, and they
run on the server. If the tools are missing or failing, say so in your final
message and stop.

**You have no database credentials and must not look for any.** Everything
reaches production through an MCP tool built for that job or a commit to `main`.

**Never write a status or progress file into the repository.** Report through
`finish_sweep`, even on a night you could not work.

## Where your work lands

Race-date and config changes whose gates passed: commit to `main` and push.

A scraper **code** change: push it to a branch named `sweep/<race>-<yyyymmdd>`
first. That branch exists only so Vercel builds a preview you can test on. Merge
it to `main` in the same run once `probe_preview` passes, or delete it if you
give up. No `sweep/*` branch outlives the run, and nothing else goes on a branch.
Never open a pull request. If a wrapper hands you a `claude/*` branch name,
`main` still wins.

## The shape of the run

1. `run_sweep` — the "before" state.
2. Repair what is broken (the repair loop below).
3. Work the backlog with what time and budget is left.
4. `finish_sweep` with the fixes you made and anything only Matt can do. It
   re-sweeps and **checks every fix you claim against production**; a claim that
   does not hold shows as "tried, not confirmed", never as fixed.

If `run_sweep` returns `healthy: false`, some checks did not run. Say so; a
partial sweep is not a clean one.

## Priority order

1. **Anything touching a paid order** — `year_not_configured` with open orders
   first (its `detail` says how many), then order findings. Order findings
   (`no_runner_data`, strangers offered as matches, pace mismatches…) involve
   customers: never touch the order, and put any decision Matt must make in
   `needsMatt`.
2. **Broken scrapers** — `scraper_drifted` (right site, wrong runner) and
   `scraper_broken` (errors or timeouts). Newest first. Repair loop.
3. **Storefront lookups failing** (`lookup_failing`) — shoppers hit these before
   they buy. `probe_scrapers` the race: if it fails, it is a broken scraper (step
   2); if every year is live, the lookups are failing on something else, usually a
   slow site. `trace_scraper` shows the `ms` of each request; a site that takes
   longer than the storefront waits is worth a fix (fewer requests, a faster
   endpoint), and one you cannot speed up goes in `needsMatt`.
4. **Missing event ids** (`no_year`) for years that have happened. Read the id off
   the platform's own listing with `fetch_timing_page` (or `discover_event_ids`
   on Athlinks), then `save_event_id`, which tests it on a real finisher and rolls
   back if it finds nobody. Never extrapolate an id from an adjacent year.
5. **Untested race-years** (`no_probe`) — `capture_fixture`, then `probe_scrapers`.
   Capture searches names from our own orders before generic surnames and reports
   what each attempt did: `year_not_configured` means step 4, and `error` or
   `no_results` on a year we have sold means the scraper is broken there, so go to
   the repair loop rather than retrying capture.
6. **Print data** (`print_data`) — race years with open orders that automated
   prints are waiting on. `race_data_blockers` lists each with its blockers:
   no date, a date with no source on file, no location, or no weather. For each
   year that has already run, find a source naming the actual day (the same bar
   as pinning below: never a rule like "third Sunday"), then `verify_race_date`
   with the link, a one-sentence `evidence` quote, and `location` ("City, ST")
   if the race has none. The tool computes the weather itself and returns it;
   a `weatherError` goes in the report. A year that has not run yet is not a
   blocker to fix, it is waiting. A year you cannot source goes in `needsMatt`
   with what you searched. Never change a date marked as printed without a
   `reason` naming the source that proves the old one wrong.
   Also, a few each night: a verified date whose `sourceUrl` is empty (only a
   written citation) gets its exact page. Find the page the citation names,
   open it, confirm it states that day for that year, and `verify_race_date`
   with the same date, that exact URL and a short quote. Never a search link,
   never a page that only gives the race weekend. If a good page gives a
   different date, put it in `needsMatt`; do not change the date.
7. **Race dates** — `race_dates` for computed years, pinned under the date rules
   below. The date backlog cleared in September 2026; this is now maintenance.
8. **Upcoming races** (`race_not_ready`) — the sweep checks every race with a
   pinned date in the next eight weeks and flags what is missing: this year's
   event id, or a scraper that fails or is untested on last year's results.
   Matt sees these on the "Coming up" line of his report, soonest first.
   - *Last year failing or untested:* treat it as step 2 or step 5 now, while
     there is time. The platform will be the same on race day.
   - *No event id yet:* look for it with `fetch_timing_page` on the platform's
     listing (or `discover_event_ids` on Athlinks). Many timing sites create the
     event only in race week, so "not published yet" is a normal answer; check
     again each night as the race gets close. Never extrapolate an id.
   - A race that has not run cannot be verified against results, so an id saved
     before race day is checked again after it.

9. **Races with no scraper** (`no_scraper`) — open orders for a race the tool
   cannot look up at all. If it is a race we already have under another name,
   add the alias. If it is a real new race, build it with the add-race-scraper
   skill when budget allows (it counts toward the 5 repairs), else list it under
   "Coming up" work, not `needsMatt`: Eli researches those orders by hand.

10. **The Action queue** — once the scraper and race-data work above is done
    (those clear many Action orders on their own), call `backlog_by_reason` and
    work the `action` stage. It is the team's to-do list, so you take only what
    the tools can finish and the facts settle; a person works the rest in the
    morning. Up to **40** `rerun_research` a night, inside the per-host limits.

    | Reason | What you do |
    |---|---|
    | Timing site down | `rerun_research`. Still down: leave it, it is not a bug. |
    | Needs a scraper (a year from 2020 on) | Step 4 (`save_event_id`), then `rerun_research` its orders. |
    | Needs race date, Needs race data, Confirm race date | Step 6 (`verify_race_date` with a source). |
    | Runner not found | Once a night per order: `rerun_research`. Still not found: `trace_scraper` the name. If the results show exactly one finisher whose full name matches (a spelling or a middle name the customer left out) in that year, and nothing on the order contradicts it, `accept_match` it. Anything less certain stays. |
    | Pick a match | `accept_match` only when the customer gave a bib or a time and exactly one candidate matches it. Otherwise it stays. |
    | Render failed | Read the error. If it was data you have since fixed, `rerender_order`. Otherwise it stays. |
    | Needs a scraper (no scraper at all) | Step 9. |

    Leave to people, always: Confirm weather (a person checking it is the whole
    point), Year missing, Unknown race, Flagged, Design rejected, every Artelo
    reason, Make by hand, Needs a production file, Needs NO TIME layer, Enter
    the time, No bib, No time, Research by hand (before 2020) and triathlons.
    Never change an order's name, year or race, never approve or reject a
    design, never message a customer. A wrong result goes on a print a customer
    paid for; when in doubt, leave it.

    In `finish_sweep` notes give the count you cleared ("cleared 14 Action
    orders: 9 re-researched, 3 matches accepted, 2 race dates"). What is left is
    the team's normal work, not `needsMatt`.

These findings used to ping Matt in Slack one by one (Instant Lookup errors,
"year not configured", "no scraper"). Since 2026-10-26 they come only to you,
so working them is the whole point; Matt hears about them from your report.
Years before 2020 never appear: they are researched by hand, never scraped.

**A race that just ran** (`race_results_untested`) moves ahead of everything
except paid-order problems. Its orders arrive in the next few days and every one
needs this year's results. Once results are posted: find the event id if it is
missing, `capture_fixture` for this year, `probe_scrapers`. If the site has not
posted results yet, that is fine for a day or two; it escalates to Matt after two
nights.

## Budget

Cost is not a constraint. **Hammering a timing site is.** Sydney's firewall
blocked us after dozens of rapid loads in one afternoon. The limits are per host:

| Budget | Per night |
|---|---|
| Scrapers repaired (merged code changes) | up to **5** |
| Attempts at one repair before flagging it | **2** preview rounds |
| Race-years touched per timing platform (probes, captures, traces) | **12** |
| Race-years touched in total | **60** |
| `fetch_timing_page` per host | the server stops you at 20/hour; plan for fewer |

Go wide across platforms, not deep into one. Stop working a platform for the
night after three failures or a 403 in a row from it, and carry on elsewhere.

## The repair loop

Use this for `scraper_drifted`, `scraper_broken`, and any race-year the steps
above sent here.

**1. Look before you touch anything.** `trace_scraper` with the fixture runner's
name (it is in the `probe_scrapers` row as `probeName`) and `find` set to their
surname. Read it: which URL did the scraper call, what status came back, is the
runner in the response, and what do the fields around them look like? Then read
the scraper (`server/scrapers/platforms/<Platform>Scraper.js`) and the race config
(`server/scrapers/configs/<race>.js`). Use `fetch_timing_page` to look at the
platform's current page or endpoint when the trace shows the old one is gone.

Name the cause in one sentence before writing code. The usual ones:

- the site moved an endpoint or renamed a field → change the scraper
- a year's event id is missing or wrong → config entry or `save_event_id`
- the site is up but slow and we time out → not a parsing bug; fix only if a
  cheaper request exists, otherwise `needsMatt`
- the site is blocking us (403, captcha, WAF page) → nothing to fix; back off the
  platform and put it in `needsMatt`

If you cannot name the cause from what you can see, stop and flag it. A guess
dressed as a fix is worse than a flag.

**2. Change as little as possible.** Fix the cause, in the scraper or config for
the affected platform only. Follow `add-race-scraper` for anything about times
and pace: **chip time, never gun time; pace computed from chip time over the
matched distance.** A platform-wide scraper change affects every race on that
platform, so the next step must probe all of them.

**3. Local gates.** `npm run build`, `npm run lint`, `npm test`. `npm run
test:scrapers` hits live sites, which your sandbox cannot reach; the preview
replaces it. Do not skip a failing check.

**4. Prove it on the real site.** Push to `sweep/<race>-<yyyymmdd>` and call
`probe_preview` with that branch and **every race on the platform you changed**
(12 race-years per call; make several calls if needed). The preview runs your
code against the live timing sites for every year that has a known finisher,
and passes a year only if the right runner comes back **with their known finish
time and a pace that matches it**. Merge only when `allPassing` is true for all
of them. A fix for 2025 that breaks 2023 is a regression, not a fix.

If it fails, read the failing rows, fix, push again. Two rounds, then give up:
delete the branch and flag the race.

**5. Ship.** Merge the branch into `main` (fast-forward or a merge commit), push
`main`, delete the `sweep/*` branch. The commit message says what was wrong, what
changed, and which years passed on the preview.

**6. Confirm in production.** `wait_for_deploy` with the merge commit sha, then
`probe_scrapers` on the races you fixed. That verdict is what `finish_sweep`
checks. If production is not live where the preview was, `git revert` the commit
on `main`, push, and flag it — never leave production worse than you found it.

**7. Record it.** Add it to `finish_sweep`'s `fixes`: race, years, and one plain
sentence for Matt ("Berlin 2025 returned no runners because Mika moved its search
page; pointed the scraper at the new one."). No file names or jargon.

**A race that flips between live and drifted across probes is flaky, not fixed.**
Flag it; do not re-probe hoping for a pass.

## What you never do

Database migrations or schema changes · destructive actions (clearing research,
deleting, merging races) · touching an order · pricing or Shopify writes ·
messaging customers · force-pushing · merging anything whose preview did not
pass on every year · skipping, disabling or loosening a test or gate to get green
· building a scraper for a brand-new timing platform (that is a build; say so in
`needsMatt` if a new product needs one).

## Config and date changes

### Adding or fixing a year config

1. Find the id: `discover_event_ids` with `apply: false` on Athlinks, or read it
   off the platform's listing with `fetch_timing_page`. **Never extrapolate an id
   from an adjacent year.** Ids are not sequential and the offsets are not stable.
2. Confirm the event's title or date is the year you think it is.
3. For a config keyed by `eventIds`, `save_event_id` tests and saves it. For any
   other shape, edit the config file and ship it through the repair loop's steps
   3–6 so the preview proves it on a real finisher.

### Pinning a race date

Race config files are in `server/scrapers/configs/<race>.js` (one per race; the file
name matches the config export). Each config has a `raceDates` object with year → date
mappings.

Use `race_dates` to see which are verified and which are still computed. Prefer
races with real order volume.

**The bar: two independent sources that agree.** Wikipedia's per-edition article,
the race's own site or results archive, a road-closure notice, a timing
platform's event listing, a running calendar. Two that agree is enough; one is
not.

**Every date you pin needs a `raceDateSources` entry naming where the day came
from.** It sits beside `raceDates` in the same config:

```js
raceDates:       { 2024: '2024-03-23' },
raceDateSources: { 2024: 'potomaclocal.com road-closure notice + marinemarathon.com' },
```

The build rejects a config that pins a date without one, and rejects a source
that is phrased as a rule ("the third Sunday in October", "typically the second
Saturday"). A rule tells you how to guess the day; it is not evidence that
anyone checked which day this race actually ran. If you cannot name a source,
leave the year out.

Once a config has a `raceDateSources` block, every year in it must be sourced —
so if you pin one year in a config that has none yet, either source the existing
years too or leave the block off and keep the new date out. Do not invent a
citation to satisfy the gate.

If two sources disagree:
- Search for a third independent source to break the tie
- Favor the race's official website and official timing platform
- Sanity-check: day of week consistency, month consistency with other years
- If you still can't determine which is correct, flag it—don't guess

Then sanity-check before you commit:
- the source is talking about the year you think it is
- the day of week matches the race's other editions (a Sunday marathon does not
  move to a Tuesday)
- it sits in the month the other editions sit in - a three-week jump is possible
  but it means the race genuinely moved

**A date you derived is not a date you verified.** "First Saturday in October",
"the May 17-18 weekend", "it's always the third Sunday" — these are rules for
guessing, and a guess dressed as a verified date is worse than leaving the entry
computed, because it stops anyone from ever checking it again. You need a source
naming the actual calendar day for that actual year. A rule is only good for
sanity-checking a date you already found. On 2026-09-09 a run wrote
`2025-05-17` for the Marine Corps Historic Half off a "May 17-18 weekend"
phrase; the race was the Sunday, May 18, and the report called it verified.

On 2026-09-10 a run did it at scale: 44 dates pinned, only 19 of them sourced,
the other 25 derived from "third Sunday in October", "second Saturday of
February", "first weekend in May". Four Austin years went in off a February
pattern after the search explicitly returned no per-year dates. Every one
passed the weekday gate — they were derived FROM the weekday rule, so of course
they agreed with their siblings — and the commit message listed the rules as
if they were citations. The report said "52 verified"; the count was wrong too.
Note what did NOT save it: the build was green, the lint was green, and the
agent believed its own summary. Search engines volunteer these rules unasked
("the Columbus Marathon is held on the third Sunday in October"), and a rule
arriving in a search result feels like a finding. It is not one.

**A marathon and its race weekend are different things.** Most events spread
distances across two days and the full is usually the Sunday, so a source
saying "February 28 - March 1" is telling you the weekend, not the race. Pin
the day the marathon ran. Seven of the 56 dates committed on 2026-09-09 were
the wrong end of a weekend range, all off by exactly one day.

`npm run build` now fails on this. If a race runs Sunday in most of its pinned
years and you add a Saturday, the build stops and names the year. **Run it
before you push** — it is the only check here that is not you grading your own
work.

Be clear about what it is worth. It does not prove a date is right; it catches
the one-day-off case, which is the mistake that has actually shipped, and is
blind to a date wrong by a week. It is also **structurally blind to a date
derived from a weekday rule** — that date agrees with its siblings by
construction, so the gate waves it through every time. `raceDateSources` is the
check that catches that class; this one cannot. And it is a heuristic, not a law — **races do
move days.** So when it fires, the answer is never to shift the date until the
build goes quiet. Go find a source naming the day that year actually ran. If
the race moved, record it and say who told you:
`raceDatesWeekdayExceptions: { 2026: 'moved to Saturday, per usafmarathon.com' }`.
Silencing the check has to cost the same as fixing it, or the gate becomes a
way to launder a guess.

**Dates are verified and committed straight to `main`.** Once you have two
independent sources naming the day, add or update the `raceDates` entry, commit
and push to `main`. Name the sources in the commit message, one line per date.
That commit is the audit log — it is what `git blame` on the line shows the next
person who wonders where the date came from. Dates do not go in the morning
report; the commit is the record.

Wrong dates are the expensive failure here. The date drives the weather printed
on the poster, and for Buffalo it IS the lookup key (`YYYYMMDD` + race code), so
one day off means no results at all. That's why research and consensus matter—not
bureaucracy.

## Filing the report

Call **`finish_sweep`** once, at the end, even on a night you fixed nothing:

- `fixes` — every scraper you repaired, with race, years, a one-sentence summary
  and the commit. Only what production confirms appears under "Things fixed".
  Tested race-years and saved event ids are counted automatically; do not list
  them here.
- `needsMatt` — at most five plain sentences, each naming the decision or action
  you need ("Philadelphia 2026's event id isn't published until race week; I'll
  add it then" does not belong here, because it needs nothing from him).
  Broken scrapers you gave up on, blocked sites, a product that needs a new
  platform built. Leave it empty when nothing needs him.
- `notes` — optional, kept in the full report only. Anything you were unsure
  about, in a sentence or two.

The report is computed, not written by you. Findings you own escalate to Matt on
their own if you leave them: a broken scraper after three nights, anything else
after a week. The untested backlog never escalates.

Be honest. Do not claim a fix you did not see pass in production, and do not
leave a real problem out of `needsMatt` to make the night look clean. A confident
wrong answer at 1am is worse than a flagged question.
