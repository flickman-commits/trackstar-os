// What each scraper sends to its timing site, with the site stood in for.
// No network: these pin the request shape behind three fixed bugs (2026-10-20).
import test from 'node:test'
import assert from 'node:assert/strict'
import { TrueTimeScraper, stripDiacritics } from './TrueTimeScraper.js'
import { MultiSportAustraliaScraper, searchQueries } from './MultiSportAustraliaScraper.js'
import { RaceRosterScraper } from './RaceRosterScraper.js'

const quiet = async fn => {
  const { log, warn, error } = console
  console.log = console.warn = console.error = () => {}
  try { return await fn() } finally { Object.assign(console, { log, warn, error }) }
}

// ── TrueTime ──────────────────────────────────────────────────────────────

const TT_PAGE = '<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="vs" />'
const TT_GRID = '<table id="ctl00_Content_Main_grdSearch"><tr><th>Event</th><th>No</th><th>Name</th><th>Gender</th><th>Category</th><th>Status</th><th>Time</th><th>Net Time</th></tr>' +
  '<tr><td>IMT DSM Marathon</td><td>7141</td><td><a href="myresults.aspx?CId=16535&amp;RId=1793&amp;EId=3&amp;AId=294035">Jesus Lizarraga</a></td><td>M</td><td>3539</td><td>Finished</td><td>04:19:29.19</td><td>04:19:29.19</td></tr></table>'
const TT_NONE = '<div>Sorry, your search returned no matches</div>'

/** A TrueTime site that, like the real one, matches only unaccented text. */
function trueTime() {
  const s = new TrueTimeScraper(2026, {
    raceName: 'Des Moines Marathon',
    trueTime: { cid: 16535, rid: 1793, events: { marathon: 3, half: 2 } },
    distances: { marathon: 26.2, half: 13.1 },
  })
  s.sent = []
  s.fetchText = async (url, init = {}) => {
    const res = { headers: { getSetCookie: () => [], get: () => null } }
    if (init.method !== 'POST') return { text: TT_PAGE, res }
    const term = new URLSearchParams(init.body).get('ctl00$edtSearch')
    s.sent.push(term)
    return { text: ['Jesus Lizarraga', 'Lizarraga'].includes(term) ? TT_GRID : TT_NONE, res }
  }
  return s
}

test('stripDiacritics folds accents and leaves plain text alone', () => {
  assert.equal(stripDiacritics('Jesús Lizárraga'), 'Jesus Lizarraga')
  assert.equal(stripDiacritics('Müller-Peña'), 'Muller-Pena')
  assert.equal(stripDiacritics('7141'), '7141')
})

test('TrueTime sends an accented name without accents (Des Moines 2026, Jesús Lizárraga)', async () => {
  const s = trueTime()
  const r = await quiet(() => s.searchRunner('Jesús Lizárraga'))
  assert.deepEqual(s.sent, ['Jesus Lizarraga'])
  assert.equal(r.found, true)
  assert.equal(r.bibNumber, '7141')
  assert.equal(r.officialTime, '4:19:29')
  assert.equal(r.officialPace, '9:54')
})

test('TrueTime surname-only retry is sent without accents too', async () => {
  const s = trueTime()
  await quiet(() => s.searchRunner('Jesse Lizárraga'))
  assert.deepEqual(s.sent, ['Jesse Lizarraga', 'Lizarraga'])
})

// ── MultiSport Australia ──────────────────────────────────────────────────

const msaRow = (name, bib) =>
  `<a href="/races/sydney-marathon-2026/events/1/results/individuals/${bib}/">${name} (#${bib})</a>` +
  `<a href="/races/sydney-marathon-2026/events/1/results/individuals/${bib}/">View Result</a>`

/** A MultiSport site that answers each literal query from `pages`, else nothing. */
function multiSport(pages) {
  const s = new MultiSportAustraliaScraper(2026, {
    raceName: 'Sydney Marathon',
    raceSlug: 'sydney-marathon',
    detailPagesBlocked: true,
    defaultMarathonEventId: 1,
    distanceMiles: 26.2,
  })
  s.queries = []
  s._fetchPage = async url => {
    const q = new URL(url).searchParams.get('search')
    s.queries.push(q)
    return `<html>${pages[q] || ''}</html>`
  }
  return s
}

test('searchQueries: as typed, unaccented, then surname (suffix dropped)', () => {
  assert.deepEqual(searchQueries('Bill Cox'), ['Bill Cox', 'Cox'])
  assert.deepEqual(searchQueries('William Cox IV'), ['William Cox IV', 'Cox'])
  assert.deepEqual(searchQueries('Adrián García'), ['Adrián García', 'Adrian Garcia', 'García', 'Garcia'])
  assert.deepEqual(searchQueries('Kipchoge'), ['Kipchoge'])
})

test('MultiSport: a nickname with no literal hit is found through the surname (Sydney 2026, Bill Cox)', async () => {
  const s = multiSport({ Cox: msaRow('James COX', '10365') + msaRow('William COX', '22082') + msaRow('Matthew COX', '166') })
  const r = await quiet(() => s.searchRunner('Bill Cox'))
  assert.deepEqual(s.queries, ['Bill Cox', 'Cox'])
  // Name and bib from the search row; the detail page is firewalled, so no time.
  assert.equal(r.found, false)
  assert.equal(r.researchStatus, 'time_unavailable')
  assert.equal(r.bibNumber, '22082')
  assert.equal(r.officialTime, null)
  assert.equal(r.officialPace, null)
})

test('MultiSport: an exact hit on the typed name costs one request', async () => {
  const s = multiSport({ 'William Cox': msaRow('William COX', '22082') })
  const r = await quiet(() => s.searchRunner('William Cox'))
  assert.deepEqual(s.queries, ['William Cox'])
  assert.equal(r.bibNumber, '22082')
  assert.equal(r.officialTime, null)
})

test('MultiSport: a short-form hit still checks the surname, so a second long form shows', async () => {
  const s = multiSport({
    'Chris Baxter': msaRow('Christopher BAXTER', '501'),
    Baxter: msaRow('Christopher BAXTER', '501') + msaRow('Christian BAXTER', '502'),
  })
  const r = await quiet(() => s.searchRunner('Chris Baxter'))
  assert.deepEqual(s.queries, ['Chris Baxter', 'Baxter'])
  assert.equal(r.ambiguous, true)
  assert.deepEqual(r.possibleMatches.map(m => m.bib).sort(), ['501', '502'])
})

test('MultiSport: accented typing falls back to the unaccented spelling', async () => {
  const s = multiSport({ 'Antonio Garcia': msaRow('Antonio GARCIA', '8432') })
  const r = await quiet(() => s.searchRunner('Antonio García'))
  assert.deepEqual(s.queries, ['Antonio García', 'Antonio Garcia'])
  assert.equal(r.bibNumber, '8432')
})

test('MultiSport: nobody anywhere is a plain not found after every query', async () => {
  const s = multiSport({})
  const r = await quiet(() => s.searchRunner('Bill Cox'))
  assert.deepEqual(s.queries, ['Bill Cox', 'Cox'])
  assert.equal(r.found, false)
  assert.equal(r.researchStatus, 'not_found')
})

// ── RaceRoster ────────────────────────────────────────────────────────────

const RR_SUB = { marathon: 379159, halfMarathon: 379160, marathonEarlyStart: 379161, halfMarathonEarlyStart: 379162 }

function raceRoster(rows) {
  const s = new RaceRosterScraper(2026, {
    raceName: 'Newport Marathon',
    eventCodes: { 2026: 'abx5kwqg2kkvv7s2' },
    subEventIds: { 2026: RR_SUB },
    eventSearchOrder: ['marathon', 'halfMarathon', 'marathonEarlyStart', 'halfMarathonEarlyStart'],
    eventLabels: { marathon: 'Marathon', halfMarathon: 'Half Marathon' },
    distances: { marathon: 26.2, halfMarathon: 13.1, marathonEarlyStart: 26.2, halfMarathonEarlyStart: 13.1 },
  })
  s.paths = []
  s.fetchApi = async path => {
    s.paths.push(path)
    if (path.includes('/participant-search')) return { data: { exact: rows, other: [] } }
    const id = path.split('/').pop()
    const row = rows.find(r => r.id === id)
    return { data: { result: { ...row, chipTime: row.chipTime, overallPace: '10:02' } } }
  }
  return s
}

test('RaceRoster searches once per lookup and filters rows by resultSubEventId (Newport 2026, Paige Murphy)', async () => {
  const s = raceRoster([
    { id: 'other', name: 'Paige Turner', bib: '900', resultSubEventId: 379159 },
    { id: 'early', name: 'Paige Murphy', bib: '5000', resultSubEventId: 999999 },
    { id: 'wbbx4b4k7nydjz79', name: 'Paige Murphy', bib: '2097', resultSubEventId: 379160, chipTime: '2:11:33' },
  ])
  const r = await quiet(() => s.searchRunner('Paige Murphy'))
  assert.equal(s.paths.filter(p => p.includes('/participant-search')).length, 1)
  assert.equal(r.found, true)
  assert.equal(r.bibNumber, '2097')
  assert.equal(r.eventType, 'Half Marathon')
  assert.equal(r.officialTime, '2:11:33')
  assert.equal(r.officialPace, '10:02') // the page's overallPace, printed as shown
})

test('RaceRoster: a miss is one request, not one per sub-event', async () => {
  const s = raceRoster([])
  const r = await quiet(() => s.searchRunner('Zzzq Nobodyxx'))
  assert.deepEqual(s.paths, ['/v2/api/events/abx5kwqg2kkvv7s2/participant-search?phrase=Zzzq%20Nobodyxx'])
  assert.equal(r.found, false)
})

test('RaceRoster: same-name runners in every sold distance are one pick, never a later distance\'s runner', async () => {
  const s = raceRoster([
    { id: 'a', name: 'Sam Lee', bib: '1', resultSubEventId: 379159 },
    { id: 'b', name: 'Sam Lee', bib: '2', resultSubEventId: 379159 },
    { id: 'c', name: 'Sam Lee', bib: '3', resultSubEventId: 379160, chipTime: '2:00:00' },
  ])
  const r = await quiet(() => s.searchRunner('Sam Lee'))
  assert.equal(r.ambiguous, true)
  assert.deepEqual(r.possibleMatches.map(m => m.bib), ['1', '2', '3'])
})

test('RaceRoster: one marathoner and one half runner with the same name are a pick (Denver Colfax 2026, Diego Garcia)', async () => {
  const s = raceRoster([
    { id: 'h', name: 'Diego Garcia', bib: '6840', resultSubEventId: 379160, chipTime: '2:00:00' },
    { id: 'm', name: 'Diego Garcia', bib: '13291', resultSubEventId: 379159, chipTime: '4:00:00' },
  ])
  const r = await quiet(() => s.searchRunner('Diego Garcia'))
  assert.equal(r.ambiguous, true)
  assert.deepEqual(r.possibleMatches.map(m => m.bib), ['13291', '6840'])
})

test('RaceRoster: the same bib twice is one runner', async () => {
  const s = raceRoster([
    { id: 'm', name: 'Diego Garcia', bib: '13291', resultSubEventId: 379159, chipTime: '4:00:00' },
    { id: 'm', name: 'Diego Garcia', bib: '13291', resultSubEventId: 379159, chipTime: '4:00:00' },
  ])
  const r = await quiet(() => s.searchRunner('Diego Garcia'))
  assert.equal(r.found, true)
  assert.equal(r.bibNumber, '13291')
})
