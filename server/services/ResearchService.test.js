import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { BaseScraper } from '../scrapers/BaseScraper.js'
import { ResearchService, isFailedSearch, bibNameAgrees } from './ResearchService.js'

// A results site that takes the connection and never answers, like the
// Athlinks search endpoint did for Miami 2025.
async function hangingSite() {
  const sockets = new Set()
  const server = http.createServer(() => { /* never respond */ })
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/Search`
  const close = () => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(resolve) })
  return { url, close }
}

/** Searches the hanging site and handles the timeout the way most scrapers do. */
class TimingOutScraper extends BaseScraper {
  constructor(url, { rethrow = false } = {}) {
    super('Miami Marathon', 2025)
    this.url = url
    this.rethrow = rethrow
    this.calls = []
  }
  async searchRunner(name) {
    this.calls.push(name)
    try {
      await fetch(`${this.url}?search=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(50) })
      return this.notFoundResult()
    } catch (error) {
      if (this.rethrow) throw error
      return { ...this.notFoundResult(), researchNotes: `Error: ${error.message}` }
    }
  }
}

/** Answers from a script: one result per search, in order. */
class ScriptedScraper extends BaseScraper {
  constructor(results) {
    super('Miami Marathon', 2025)
    this.results = results
    this.calls = []
  }
  async searchRunner(name) {
    this.calls.push(name)
    const next = this.results.shift()
    return typeof next === 'function' ? next.call(this) : next
  }
}

function serviceWith(scraper) {
  const service = new ResearchService()
  service.loadOverrides = async () => {}
  service.scraperFor = () => scraper
  return service
}

test('a search that times out is recorded as upstream_error, not runner not found', async () => {
  const site = await hangingSite()
  try {
    const scraper = new TimingOutScraper(site.url)
    const r = await serviceWith(scraper).findRunner('Miami Marathon', 2025, 'Pat Example')
    assert.equal(r.found, false)
    assert.equal(r.researchStatus, 'upstream_error')
    assert.match(r.researchNotes, /results site could not be reached/)
    assert.match(r.researchNotes, /Run research again/)
    assert.doesNotMatch(r.researchNotes, /not found/i)
    // A failed search is not a reason to go ask a worse question by surname
    assert.deepEqual(scraper.calls, ['Pat Example'])
  } finally {
    await site.close()
  }
})

test('a scraper that lets the timeout throw is recorded as upstream_error too', async () => {
  const site = await hangingSite()
  try {
    const r = await serviceWith(new TimingOutScraper(site.url, { rethrow: true })).findRunner('Miami Marathon', 2025, 'Pat Example')
    assert.equal(r.researchStatus, 'upstream_error')
  } finally {
    await site.close()
  }
})

test('a site that answers the name search and then times out on the surname search is upstream_error', async () => {
  const scraper = new ScriptedScraper([
    function () { return this.notFoundResult() },
    function () { return this.upstreamErrorResult('timed out after retry') },
  ])
  const r = await serviceWith(scraper).findRunner('Miami Marathon', 2025, 'Pat Example')
  assert.deepEqual(scraper.calls, ['Pat Example', 'Example'])
  assert.equal(r.researchStatus, 'upstream_error')
  assert.match(r.researchNotes, /unreachable or slow/)
})

test('a 5xx reported in a not_found note is upstream_error', async () => {
  const scraper = new ScriptedScraper([function () { return this.notFoundResult('Search returned HTTP 503') }])
  const r = await serviceWith(scraper).findRunner('Miami Marathon', 2025, 'Pat Example')
  assert.equal(r.researchStatus, 'upstream_error')
})

test('a clean no-match is still not_found', async () => {
  const scraper = new ScriptedScraper([
    function () { return this.notFoundResult() },
    function () { return this.notFoundResult() },
  ])
  const r = await serviceWith(scraper).findRunner('Miami Marathon', 2025, 'Pat Example')
  assert.equal(r.researchStatus, 'not_found')
  assert.match(r.researchNotes, /Runner not found/)
})

test('a 404 (wrong event id) stays not_found, and a bug in a scraper still throws', async () => {
  const notFound = new ScriptedScraper([
    function () { return this.notFoundResult('Search returned HTTP 404') },
    function () { return this.notFoundResult() },
  ])
  assert.equal((await serviceWith(notFound).findRunner('Miami Marathon', 2025, 'Pat Example')).researchStatus, 'not_found')
  const buggy = new ScriptedScraper([() => { throw new TypeError("Cannot read properties of undefined (reading 'courses')") }])
  await assert.rejects(serviceWith(buggy).findRunner('Miami Marathon', 2025, 'Pat Example'), TypeError)
})

test('isFailedSearch: candidates are an answer whatever the note says', () => {
  assert.equal(isFailedSearch({ found: false, researchStatus: 'not_found', researchNotes: 'Error: fetch failed' }), true)
  assert.equal(isFailedSearch({ found: false, researchStatus: 'not_found', researchNotes: 'Error: x', possibleMatches: [{ name: 'A' }] }), false)
  assert.equal(isFailedSearch({ found: true, researchNotes: 'Error: x' }), false)
  assert.equal(isFailedSearch({ found: false, researchStatus: 'year_not_configured', researchNotes: 'timed out' }), false)
  assert.equal(isFailedSearch({ found: false, researchStatus: 'not_found', researchNotes: 'Runner not found in Miami Marathon 2025 results' }), false)
})

test('a name with Jr. that the site cannot search is found without it (Indy 2026, 8945)', async () => {
  const found = function () { return { ...this.notFoundResult(), found: true, runnerName: 'Robert Pedersen', bibNumber: '37', officialTime: '3:00:00', researchStatus: 'found' } }
  const scraper = new ScriptedScraper([function () { return this.notFoundResult() }, found])
  const r = await serviceWith(scraper).findRunner('Miami Marathon', 2025, 'Robert Pedersen Jr.', { skipLastNameFallback: true })
  assert.equal(r.found, true)
  assert.equal(r.bibNumber, '37')
  assert.equal(scraper.calls.at(-1), 'Robert Pedersen')
})

test('a Sr is not taken for the Jr the customer typed', async () => {
  const sr = function () { return { ...this.notFoundResult(), found: true, runnerName: 'Robert Pedersen Sr', bibNumber: '38', officialTime: '3:00:00', researchStatus: 'found' } }
  const scraper = new ScriptedScraper([function () { return this.notFoundResult() }, sr, function () { return this.notFoundResult() }, function () { return this.notFoundResult() }])
  const r = await serviceWith(scraper).findRunner('Miami Marathon', 2025, 'Robert Pedersen Jr.', { skipLastNameFallback: true })
  assert.equal(r.found, false)
})

/** London: Emily Mackenroth ran 2025 with bib 14016; in 2024 that bib was Charlie Muddyman. */
class YearsScraper extends BaseScraper {
  constructor(year) { super('London Marathon', year) }
  async searchRunner(name) {
    return this.year === 2025 && name === 'Emily Mackenroth'
      ? { ...this.notFoundResult(), found: true, runnerName: 'Emily Mackenroth', bibNumber: '14016', officialTime: '4:07:12', researchStatus: 'found' }
      : this.notFoundResult()
  }
  async searchRunnerByBib(bib) {
    const name = this.year === 2024 ? 'Charlie Muddyman' : 'Emily Mackenroth'
    return { ...this.notFoundResult(), found: true, runnerName: name, bibNumber: bib, officialTime: this.year === 2024 ? '4:27:30' : '4:07:12', researchStatus: 'found' }
  }
}

test('a bib under another name is not used: wrong year (London 2024, 5408)', async () => {
  const service = new ResearchService()
  service.loadOverrides = async () => {}
  service.scraperFor = (_race, year) => new YearsScraper(year)
  const r = await service.findRunner('London Marathon', 2024, 'Emily Mackenroth', { bib: '14016', skipLastNameFallback: true })
  assert.equal(r.found, false)
  assert.equal(r.officialTime ?? null, null)
  assert.equal(r.possibleMatches[0].name, 'Charlie Muddyman')
  assert.match(r.researchNotes, /belongs to "Charlie Muddyman"/)
  assert.match(r.researchNotes, /in the 2025 results \(bib 14016\): check the race year/)
})

test('a bib under the same name, written another way, is used', async () => {
  assert.equal(bibNameAgrees('Emily Mackenroth', 'MACKENROTH, Emily'), true)
  assert.equal(bibNameAgrees('Mike Smith', 'Michael J Smith'), true)
  assert.equal(bibNameAgrees('Emily Mackenroth', 'Charlie Muddyman'), false)
  assert.equal(bibNameAgrees('Emily Mackenroth', 'Emily Smith'), false)
  assert.equal(bibNameAgrees('Emily Mackenroth', null), false)
  // Bib matches already printed, read against their order names.
  assert.equal(bibNameAgrees('Jack Karl', 'John Karl'), true)
  assert.equal(bibNameAgrees('Taylor Rogers Zelnio', 'Taylor Rogers'), true)
  assert.equal(bibNameAgrees('Amanda Devera', 'Amanda De Vera'), true)
  assert.equal(bibNameAgrees('Payton Romig', 'Payten Romig'), true)
  assert.equal(bibNameAgrees('Elizabeth Rhoad', 'Elizabeth Vollkommer'), false)
  assert.equal(bibNameAgrees('Matthew DeVenio', 'Anonymous Runner'), false)
  assert.equal(bibNameAgrees('Cori Rotsko', 'Scott Langenburg'), false)
})
