# Trackstar MCP

TrackstarOS as an MCP server, so Claude (on a phone, on the web, in a
scheduled routine) and other tools can ask it questions and do a few things.

- **Endpoint:** `https://fast.trackstar.art/api/mcp` (Streamable HTTP, JSON responses, stateless)
- **Auth:** an API key in `Authorization: Bearer <key>`
- **Keys:** Settings → Admin → API Keys. Shown once. Each acts as a person and
  is limited to that person's role, then to the scopes ticked. Revoke any time.

## Connecting Claude

Settings → Connectors → Add custom connector:

- URL: `https://fast.trackstar.art/api/mcp`
- Authentication: None
- Advanced → additional headers: `Authorization: Bearer <key>`

The same connector is then available in the Claude apps on your phone.

## Scopes

| Scope | What it allows | Who can hold it |
|---|---|---|
| read | orders, statuses, bulk runs, team, reports | anyone, service keys too |
| write | assign, comment, design status, research, race checks, Support drafts, run an import | a person |
| admin | help shifts, the order list, production files, samples | an admin |
| repair | the nightly routine's scraper tools | an admin, or a service key |
| worker | the render worker (the Illustrator Mac), through `api/_routes/render/worker.js` | a service key, or a person |

A **service key** has no person behind it and can only read, repair or run the
render worker: anything that changes an order is done as someone, and shows in
the Activity Log as them. `worker` opens no MCP tools at all.

Scopes are a ceiling, not a grant. A tool is offered only when the key has its
scope **and** the person's current role allows it (read fresh on every
request): `admin` and `repair` tools need the person to be an admin today,
and a tool tied to a role capability (Settings > Admin > Roles) needs that
capability.

## Tools

The server has 49 tools.

**Read** (16): `connection_check`, `orders_overview`, `list_orders`,
`get_order`, `search_orders`, `backlog_by_reason`, `custom_orders_status`,
`partner_orders_status`, `approval_link`, `bulk_orders_status`,
`current_team`, `nightly_report`, `scraper_coverage`, `race_dates`,
`race_data_blockers`, `race_year_status`.

Read, with a role capability: `designs_to_review` (orders.render),
`handling_time` (settings.stats), `order_conversations` (support).

Approval links (customer and partner portals) and bulk intake links are
credentials: whoever holds one can approve a proof or fill in a run. The read
tools return them (`approvalLink`, `intakeLink`) only to a key that acts as an
admin or as someone whose role has `orders.render`. Any other key gets
`hasApprovalLink` / `hasIntakeLink` (true or false) instead.

**Write** (13): `assign_order`, `add_comment`, `set_design_status`,
`run_import`, `confirm_race_date`, `confirm_weather`, `verify_race_date`,
`rerun_research`, `accept_match`, plus, with a role capability,
`approve_design`, `reject_design`, `rerender_order` (orders.render) and
`draft_reply` (support).

- `assign_order` follows the app: custom and partner orders need the
  `orders.assign_custom` capability (Head of Design) or an admin.
- `verify_race_date` is for admins only, whatever the key's scopes.
- `rerun_research` and `accept_match` share a budget of 10 calls per race per
  hour, across every key, so an agent cannot hammer a timing site.
- `draft_reply` never sends; the draft carries the key holder's name.

**Admin** (6): `add_help_shift`, `end_help_shift`, `spread_order_list`,
`production_files`, `recheck_production_file`, `send_sample`.

`send_sample` is the one tool that creates an order and makes Shopify email
someone (a sample print, free or at cost, as in Tools > Samples). It is
two-step: called without `confirm` it only returns a preview and a random
`previewId`, kept on the server for ten minutes and tied to the key and to
exactly what the preview showed. It creates the order only when called again
with the same details, `confirm: true` and that `previewId`; the id is used up
by that call, so it cannot be replayed or used by another key.

**Repair** (11): `run_sweep`, `finish_sweep`, `probe_scrapers`,
`capture_fixture`, `discover_event_ids`, `trace_scraper`, `fetch_timing_page`,
`save_event_id`, `probe_preview`, `wait_for_deploy`, `sync_catalog`.

- `fetch_timing_page` reaches only known timing hosts, on ports 80 and 443,
  never an IP address or a private name (localhost, `*.internal`, `*.local`).
  It follows at most 3 redirects itself and checks every hop the same way.
- `probe_preview` tests only `sweep/*` branches (or the full sha of a commit
  Vercel built from one); anything else is refused.

## Safety

- Keys are stored as a hash; a wrong key is a 401 and counts toward a
  per-address limit (20 in 10 minutes). Each key may make 240 calls in 10 minutes.
- New keys expire in 90 days unless whoever mints them picks another length
  or "Never".
- Without a key, the server lists the read tools that need no role capability,
  with their titles, descriptions and input schemas, and every call says a key
  is needed. No data and nothing about the server's configuration is disclosed.
- Input is validated with zod before a handler runs. Results are small,
  explicit shapes; no raw Shopify, Etsy or Artelo payloads leave the server.
- A failing tool returns a short message and a reference id, never the error.
  Repair tools give short fixed reasons and log the detail on the server.
- Every call is logged with the key's name; every write is in the Activity
  Log. Its arguments are kept with it, except a sample recipient's email and
  street address (name and city stay) and all but the first 200 characters of
  a drafted reply.

## Adding a tool

Add it to the right file in `server/services/mcp/tools/` with `name`, `title`,
`description`, `scope`, `readOnly`, a zod `input` shape and a `handler` that
calls domain code and returns a plain object (with a `summary` for writes).
Optional: `cap` (a role capability) and `adminOnly`. Throw `ToolError` for
anything the caller should read as written. Then update the lists above.
