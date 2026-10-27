// Runner-name matching (BaseScraper.nameMatchTier and friends). No network.
// Each case is a real order that was rejected, or a near miss that must stay
// rejected because accepting it would print a stranger's time.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BaseScraper } from './BaseScraper.js'

const s = new BaseScraper('Test Race', 2026)
const tier = (q, c) => s.nameMatchTier(q, c)

// 1. Generational suffixes

test('suffix: "William Cox" matches "William COX IV" (Sydney 2026, bib 22082)', () => {
  assert.equal(tier('William Cox', 'William COX IV'), 0)
  assert.equal(tier('William Cox', 'Cox, William IV'), 0)
  assert.equal(tier('William Cox IV', 'William Cox'), 0)
})

test('suffix: "John M. Bland, Jr" style, with or without period or comma', () => {
  for (const listed of ['John M. Bland, Jr', 'John M. Bland, Jr.', 'John Bland Jr.', 'John Bland Jr', 'Bland Jr, John', 'Bland, John Jr.', 'John Bland, Sr', 'John Bland III', 'John Bland II', 'John Bland V', 'John Bland Jnr']) {
    assert.equal(tier('John Bland', listed), 0, listed)
  }
  assert.equal(s.normalizeName('John M. Bland, Jr'), 'john m bland')
})

test('suffix: two different suffixes are two different people', () => {
  assert.equal(tier('William Cox Jr', 'William Cox Sr'), null)
  assert.equal(tier('William Cox III', 'William Cox IV'), null)
  assert.equal(tier('William Cox Jr', 'William Cox Jnr'), 0)
})

test('suffix: a trailing V in "Last, First V" is a middle initial, not a suffix', () => {
  assert.deepEqual(s.parseRunnerName('Smith, John V'), { base: 'john v smith', suffix: null })
  assert.equal(tier('John Smith Jr', 'Smith, John V'), 0)
})

// 2. Multi-word and hyphenated surnames

test('surname: "Santiago Figueroa" is a possible match for "Santiago Figueroa De Leon" (Des Moines 2026, bib 2116)', () => {
  assert.equal(tier('Santiago Figueroa', 'Santiago Figueroa De Leon'), 2)
  assert.equal(tier('Santiago Figueroa', 'Figueroa De Leon, Santiago'), 2)
  assert.equal(tier('Santiago Figueroa', 'Santiago De Leon Figueroa'), 0, 'last words equal: middle words ignored, as before')
})

test('surname: the reverse (customer typed the long form) is a possible match', () => {
  assert.equal(tier('Santiago Figueroa De Leon', 'Santiago Figueroa'), 2)
  assert.equal(tier('Santiago Figueroa De Leon', 'Santiago De Leon'), 0, 'last words equal')
})

test('surname: a run in the middle of the listed surname counts', () => {
  assert.equal(tier('Maria Garcia Lopez', 'Maria Elena Garcia Lopez Ruiz'), 2)
})

test('surname: hyphenated surname matches either half, weakly', () => {
  assert.equal(tier('Jane Ball', 'Jane Marks-Ball'), 2)
  assert.equal(tier('Jane Marks', 'Jane Marks-Ball'), 2)
  assert.equal(tier('Jane Marks-Ball', 'Jane Marks'), 2)
  assert.equal(tier('Jane Marks Ball', 'Jane Marks-Ball'), 0, 'same words, hyphen for a space')
})

test('surname: a nickname first name still allows the surname variant', () => {
  assert.equal(tier('Mike Figueroa', 'Michael Figueroa De Leon'), 2)
})

test('surname: whole words only, so "Ann Lee" never matches "Ann Leeds"', () => {
  assert.equal(tier('Ann Lee', 'Ann Leeds'), null)
  assert.equal(tier('Ann Leeds', 'Ann Lee'), null)
  assert.equal(tier('Ann Lee', 'Ann Marie Leeds-Smith'), null)
})

test('surname: a shared particle alone is not a match', () => {
  assert.equal(tier('Maria De Leon', 'Maria De La Cruz'), null)
  assert.equal(tier('Juan De', 'Juan De Leon'), null)
  assert.equal(tier('Ana Van Dyke', 'Ana Van Der Berg'), null)
})

test('surname: a variant surname needs the first name to agree', () => {
  assert.equal(tier('Jesus Figueroa', 'Santiago Figueroa De Leon'), null)
  assert.equal(tier('Paige Ball', 'Jane Marks-Ball'), null)
})

// 3. First name is the listed middle name

test('middle name: "Peter Maiers" is a possible match for "G. Peter Maiers" (Chicago 2003, bib 30212)', () => {
  assert.equal(tier('Peter Maiers', 'G. Peter Maiers'), 2)
  assert.equal(tier('Peter Maiers', 'Maiers, G. Peter'), 2)
  assert.equal(tier('Peter Maiers', 'G Peter Maiers'), 2)
  assert.equal(tier('G. Peter Maiers', 'Peter Maiers'), 2, 'reverse')
  assert.equal(tier('Pete Maiers', 'G. Peter Maiers'), 2, 'nickname of the middle name')
})

test('middle name: only when the listed first token is an initial', () => {
  assert.equal(tier('Peter Maiers', 'George Peter Maiers'), null)
  assert.equal(tier('John Smith', 'Michael John Smith'), null)
  assert.equal(tier('Peter Maiers', 'G. Paul Maiers'), null)
})

// 4. Accents

test('accents are still ignored', () => {
  assert.equal(tier('José Pérez', 'Jose Perez'), 0)
  assert.equal(tier('Jose Perez', 'PÉREZ, JOSÉ'), 0)
  assert.equal(tier('Zoë Müller-Brandt', 'Zoe Brandt'), 2)
})

// Regressions that must still fail, or keep their tier

test('different first names on the same surname never match', () => {
  assert.equal(tier('Matt Murphy', 'Paige Murphy'), null)
  assert.equal(tier('John Lynch', 'Charles Lynch'), null)
  assert.equal(tier('Jesus Perez', 'Oscar Perez Araujo'), null)
})

test('existing tiers are unchanged', () => {
  assert.equal(tier('John Smith', 'John Smith'), 0)
  assert.equal(tier('John Smith', 'Smith, John'), 0)
  assert.equal(tier('John Smith', 'John Q Smith'), 0)
  assert.equal(tier('Mike Smith', 'Michael Smith'), 1)
  assert.equal(tier('Chris Baxter', 'Christian Baxter'), 1)
  assert.equal(tier('Chris Baxter', 'Christopher Baxter'), 1)
  assert.equal(tier('Jo Smith', 'Joseph Smith'), null)
  assert.equal(tier('Smith', 'John Smith'), null)
  assert.equal(tier('', 'John Smith'), null)
})

// filterNameMatches and the confirmation hold

test('filterNameMatches: strong beats weak beats possible', () => {
  const rows = ['Santiago Figueroa De Leon', 'Santiago Figueroa', 'Paige Figueroa']
  assert.deepEqual(s.filterNameMatches('Santiago Figueroa', rows, r => r), ['Santiago Figueroa'])
  assert.deepEqual(s.filterNameMatches('Peter Maiers', ['G. Peter Maiers', 'Paul Maiers'], r => r), ['G. Peter Maiers'])
  assert.deepEqual(s.filterNameMatches('Matt Murphy', ['Paige Murphy'], r => r), [])
})

class FakeScraper extends BaseScraper {
  constructor(rows) { super('Fake Marathon', 2026); this.rows = rows }
  async searchRunner(runnerName) {
    const matches = this.filterNameMatches(runnerName, this.rows, r => r.name)
    if (matches.length === 0) return this.notFoundResult()
    if (matches.length > 1) return this.ambiguousResult(matches.map(m => ({ name: m.name, bib: m.bib })))
    const m = matches[0]
    return {
      found: true, bibNumber: m.bib, officialTime: m.time, officialPace: '9:10',
      eventType: 'Marathon', yearFound: 2026, researchNotes: null,
      resultsUrl: `https://example.test/${m.bib}`, rawData: { name: m.name },
    }
  }
}

test('a sole possible match is held for a person to confirm, never auto-accepted', async () => {
  const scraper = new FakeScraper([{ name: 'Santiago Figueroa De Leon', bib: '2116', time: '4:00:12' }])
  const r = await scraper.searchRunner('Santiago Figueroa')
  assert.equal(r.found, false)
  assert.equal(r.ambiguous, true)
  assert.equal(r.researchStatus, 'ambiguous')
  assert.equal(r.nameMatch, 'possible')
  assert.deepEqual(r.possibleMatches, [{
    name: 'Santiago Figueroa De Leon', bib: '2116', time: '4:00:12', pace: '9:10',
    eventType: 'Marathon', resultsUrl: 'https://example.test/2116',
  }])
  assert.match(r.researchNotes, /confirm/)
})

test('accepting the candidate re-searches by its listed name and is found', async () => {
  const scraper = new FakeScraper([{ name: 'Santiago Figueroa De Leon', bib: '2116', time: '4:00:12' }])
  const r = await scraper.searchRunner('Santiago Figueroa De Leon')
  assert.equal(r.found, true)
  assert.equal(r.officialTime, '4:00:12')
})

test('suffix and nickname matches are still accepted outright', async () => {
  const scraper = new FakeScraper([{ name: 'William COX IV', bib: '22082', time: '3:31:00' }])
  const r = await scraper.searchRunner('William Cox')
  assert.equal(r.found, true)
  assert.equal(r.bibNumber, '22082')
  const nick = new FakeScraper([{ name: 'Michael Smith', bib: '7', time: '3:00:00' }])
  assert.equal((await nick.searchRunner('Mike Smith')).found, true)
})

test('the middle-name case is held for confirmation too', async () => {
  const scraper = new FakeScraper([{ name: 'Maiers, G. Peter', bib: '30212', time: '3:45:00' }])
  const r = await scraper.searchRunner('Peter Maiers')
  assert.equal(r.found, false)
  assert.equal(r.researchStatus, 'ambiguous')
  assert.equal(r.possibleMatches[0].bib, '30212')
})

test('concurrent searches on one scraper do not share a name record', async () => {
  const scraper = new FakeScraper([
    { name: 'Santiago Figueroa De Leon', bib: '2116', time: '4:00:12' },
    { name: 'Jane Doe', bib: '1', time: '3:00:00' },
  ])
  const [a, b] = await Promise.all([scraper.searchRunner('Santiago Figueroa'), scraper.searchRunner('Jane Doe')])
  assert.equal(a.researchStatus, 'ambiguous')
  assert.equal(b.found, true)
})

test('apostrophes: O’Connor, O\'Connor and Oconnor are one name (MCM 2026, bib 8282)', () => {
  assert.equal(tier('Stephanie O’Connor', 'Stephanie Oconnor'), 0)
  assert.equal(tier('Stephanie O’Connor', "Stephanie O'Connor"), 0)
  assert.equal(tier('Kyle Vitale-O’Sullivan', "Kyle Vitale-O'Sullivan"), 0)
  assert.equal(tier('Stephanie O’Connor', 'Stephanie Connor'), null)
})
