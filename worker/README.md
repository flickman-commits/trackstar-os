# Render worker

Turns TrackstarOS's render jobs into print files, using Illustrator
on the Mac it runs on. The tool queues a job when someone clicks Create Design
on an order; this script picks it up, fills the race's production template,
and uploads the PDF and a preview for review.

## What it needs

- A Mac with Adobe Illustrator installed. It can be open in the background.
- The Google Drive folder `3_Trackstar/Product/Races` synced to this Mac.
- Node 18 or newer.
- `worker/.env`, copied from `worker/.env.example`, with an API key from
  Settings > Admin > API Keys (scope: write).

## Running it

```bash
node worker/render-worker.mjs
```

Leave the terminal open. The first time, macOS asks whether the terminal may
control Illustrator; allow it. The tool shows "Renderer offline" on the Design
panel whenever no worker has checked in for a minute and a half.

## What it does, per job

1. Copies the race's production file (`worker/templates.json` says which) to
   a scratch folder. The live file is never opened.
2. Writes the order's details next to `illustrator/render.jsx` and runs the
   script through AppleScript.
3. The script fills the six fields for the order's size, widens the name box
   to the margin guide if the name is long, places the customer's photo (or
   hides the photo layer), hides time and pace on a no-time order, and
   exports with the `TRACKSTAR DEFAULT` preset and 1/4" bleed.
4. Uploads the PDF and preview to the private `production-files` bucket and
   marks the job done.

Nothing in the Races folder is ever written, moved or deleted.

## Adding a race

Add it in the tool: Settings > Admin > Designs, with the production file's
path relative to the Races folder. The next time a worker checks in it runs
the template check on the file and the panel shows whether it passed. A
template that fails is not rendered. (`worker/templates.json` is only the
seed the table was first filled from.) The template has to follow the Chicago
layout: artboards named with their size (8x10, 12x18, 16x24), a `PERSONALIZE
LAYER` with the six placeholder frames (Runner Name, BIB # HERE, a time, a
pace with "/ mi", a date like 10.11.26, and a weather line with a degree
sign), a `PHOTO LAYER` with a clipped square per size, and a `GUIDES` layer.
The script finds the frames itself from what they hold. Render a couple of
past orders with `node worker/render-local.mjs "<race>" <order numbers>`
and compare them with the designer's files before relying on it.

## No-time orders

A no-time order hides the time and the pace. That is clean when pace is the
last detail in its row (the standard going forward: put pace on the far
right). On a design where weather or the date sits to the right of pace,
hiding pace would leave a hole, and the script never moves text to close it.
Instead the designer adds a layer named `NO TIME`, hidden, holding a copy of
just the frames that change (weather, date) placed where they go on a no-time
print, one set per artboard. On a no-time order the script hides the normal
copies, shows that layer, and fills it. Until a file has the layer, the
template check marks that size "needs NO TIME layout" and no-time orders for
it are held with that reason instead of rendering.

The other way, which Dan uses: two whole personalize layers,
`PERSONALIZE LAYER WITH TIME` and `PERSONALIZE LAYER NO TIME` (any layer whose
name contains "NO TIME" counts). The NO TIME one is a full copy with name,
bib, date and weather laid out without time and pace. On a no-time order the
script shows it, hides the WITH TIME layer, and fills it like any print. On an
order with a time it is always hidden, even if the file was saved with it on.

## Checking a file by hand

```bash
node worker/check-template.mjs "Sydney Marathon"
node worker/check-template.mjs --file "Austin Marathon/Illustrator Files/Austin Marathon_Production.ai" --race "Austin Marathon"
```

Stop the worker first; both talk to the same Illustrator.

## Keep it running

`bash worker/install-launchd.sh` installs a launchd agent: the worker starts at
login, comes back within 30 seconds if it exits, and runs under `caffeinate -s`
so the Mac stays awake while plugged in. Log: `~/Library/Logs/trackstar-render-worker.log`
(`tail -f` it). `bash worker/install-launchd.sh uninstall` removes it. Rerun the
install after changing Node versions. Don't also run `npm run worker` in a terminal.

A render that times out (Illustrator hung) or loses the network gets one more
try, after Illustrator is quit and reopened, before it is marked Render failed.
