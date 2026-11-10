import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFor, nameVariants, sameName, isSeveralRunners, checkRowOnPage, clockSeconds, notesDoubt } from './agentRules.js'

test('pre-2020 years are researched on the web, never through a scraper', () => {
  assert.equal(planFor({ reason: 'Research by hand', year: 2019, runner: 'Jo Smith', hasScraper: true }).action, 'web')
  assert.equal(planFor({ reason: 'Runner not found', year: 2012, runner: 'Jo Smith', hasScraper: true }).action, 'web')
  assert.equal(planFor({ reason: 'Year missing', year: null, runner: 'Jo Smith', hasScraper: true }).action, 'skip')
  assert.equal(planFor({ reason: 'Runner not found', year: 2020, runner: 'Jo Smith', hasScraper: true }).action, 'rerun')
  assert.equal(planFor({ reason: 'Needs a scraper', year: 2025, runner: 'Jo Smith', hasScraper: false }).action, 'web')
})

test('two runners on one print and same-name picks go to a person', () => {
  assert.ok(isSeveralRunners('Owen And Bridget'))
  assert.ok(isSeveralRunners('Aaron & Tara Collins'))
  assert.ok(!isSeveralRunners('Andrea Anderson'))
  assert.equal(planFor({ reason: 'Pick a match', year: 2026, runner: 'Katherine Kelly', hasScraper: true }).action, 'person')
})

test('name variants and same-name', () => {
  assert.deepEqual(nameVariants('Arno James Babcock'), ['Arno Babcock'])
  assert.ok(nameVariants('Dave Churchman').includes('David Churchman'))
  assert.ok(nameVariants('Matthew Hickman').includes('Matt Hickman'))
  assert.ok(sameName('Katherine J Kelly', 'KATHERINE KELLY'))
  assert.ok(sameName('José Pérez', 'Jose Perez'))
  assert.ok(!sameName('Dave Churchman', 'David Churchman'))
})

test('clock readings', () => {
  assert.equal(clockSeconds('03:12:07'), clockSeconds('3:12:07'))
  assert.equal(clockSeconds('9:24'), 564)
  assert.equal(clockSeconds('03:12.07'), null)
})

const base = { url: 'https://results.example-timer.com/palm-beaches-2025', runner: 'Jaime Eyster', raceName: 'Palm Beaches Marathon', year: 2025, eventType: 'Marathon' }
// 4:00:00 over 26.2 miles is 9:10 a mile.
const PAGE = `Palm Beaches Marathon 2025 Results
 | Place | Name | Bib | Chip Time | Pace
 | 101 | Jaime Eyster | 2231 | 4:00:00 | 9:10
 | 102 | Someone Else | 2232 | 4:00:05 | 9:10`

test('a clean row on the page passes', () => {
  const r = checkRowOnPage({ ...base, text: PAGE, time: '4:00:00', pace: '9:10', bib: '2231' })
  assert.equal(r.ok, true, r.why)
})

test('anything doubtful goes to a person', () => {
  const no = p => { const r = checkRowOnPage({ ...base, text: PAGE, time: '4:00:00', pace: '9:10', bib: '2231', ...p }); assert.equal(r.ok, false); return r.why }
  assert.match(no({ text: PAGE.replace('Chip Time', 'Gun Time') }), /gun/i)
  assert.match(no({ year: 2024 }), /2024/)
  assert.match(no({ runner: 'Jamie Eyster' }), /not on the page/)
  assert.match(no({ time: '4:00:05' }), /not with the time/)
  assert.match(no({ bib: '9999' }), /Bib/)
  assert.match(no({ pace: '' }), /pace/)
  assert.match(no({ eventType: 'Ultra' }), /distance/)
  assert.match(no({ text: '' }), /empty/)
  assert.match(no({ runner: 'Jaime & Pat Eyster' }), /more than one runner/)
})

test('a per-km pace is refused even when the page shows it', () => {
  const km = PAGE.replace('| 4:00:00 | 9:10', '| 4:00:00 | 5:41')
  const r = checkRowOnPage({ ...base, text: km, time: '4:00:00', pace: '5:41', bib: '2231' })
  assert.equal(r.ok, false)
  assert.match(r.why, /per-km|per-segment/)
})

test('a split is not the finish, and two close times are refused', () => {
  const split = PAGE.replace('| 4:00:00 | 9:10', '| 1:55:00 | 4:00:00 | 9:10')
  assert.equal(checkRowOnPage({ ...base, text: split, time: '1:55:00', pace: '9:10', bib: '2231' }).ok, false)
  assert.equal(checkRowOnPage({ ...base, text: split, time: '4:00:00', pace: '9:10', bib: '2231' }).ok, true)
  const two = PAGE.replace('| 4:00:00 | 9:10', '| 4:02:10 | 4:00:00 | 9:10')
  assert.equal(checkRowOnPage({ ...base, text: two, time: '4:02:10', pace: '9:15', bib: '2231' }).ok, false)
  assert.equal(checkRowOnPage({ ...base, text: two, time: '4:00:00', pace: '9:10', bib: '2231' }).ok, false)
})

test('one unlabelled Time column is not proof of chip time, so it goes to a person', () => {
  const plain = PAGE.replace('Chip Time', 'Time')
  const r = checkRowOnPage({ ...base, text: plain, time: '4:00:00', pace: '9:10', bib: '2231' })
  assert.equal(r.ok, false)
  assert.match(r.why, /chip or net/)
  const net = PAGE.replace('Chip Time', 'Net')
  assert.equal(checkRowOnPage({ ...base, text: net, time: '4:00:00', pace: '9:10', bib: '2231' }).ok, true)
  const netTime = PAGE.replace('Chip Time', 'Net Time')
  assert.equal(checkRowOnPage({ ...base, text: netTime, time: '4:00:00', pace: '9:10', bib: '2231' }).ok, true)
  // A .net address is not a label.
  const domain = plain.replace('Results', 'Results from racetimers.net')
  assert.equal(checkRowOnPage({ ...base, text: domain, time: '4:00:00', pace: '9:10', bib: '2231' }).ok, false)
})

test('two finishers with the order name and different times need a bib', () => {
  const twins = `${PAGE}\n | 377 | Jaime Eyster | 5120 | 4:41:13 | 10:44`
  const r = checkRowOnPage({ ...base, text: twins, time: '4:00:00', pace: '9:10', bib: null })
  assert.equal(r.ok, false)
  assert.match(r.why, /2 finishers named Jaime Eyster/)
  assert.equal(checkRowOnPage({ ...base, text: twins, time: '4:00:00', pace: '9:10', bib: '2231' }).ok, true)
})

test('the year has to describe these results, not sit in a footer', () => {
  const lastYear = PAGE.replace('Palm Beaches Marathon 2025 Results', 'Palm Beaches Marathon 2024 Results') + '\n' + 'x '.repeat(400) + '\nSee also: 2025 results'
  const r = checkRowOnPage({ ...base, url: 'https://results.example-timer.com/palm-beaches', text: lastYear, time: '4:00:00', pace: '9:10', bib: '2231' })
  assert.equal(r.ok, false)
  assert.match(r.why, /2025 results/)
  // In the address is enough.
  assert.equal(checkRowOnPage({ ...base, url: 'https://results.example-timer.com/palm-beaches-2025', text: lastYear, time: '4:00:00', pace: '9:10', bib: '2231' }).ok, true)
})

test('a finder that says it was not sure is a no', () => {
  assert.ok(notesDoubt('The page shows only one time and does not say whether it is chip or gun.'))
  assert.ok(notesDoubt('Probably the same person, same city.'))
  assert.ok(!notesDoubt('Chip time from the official results page, bib matches.'))
  assert.ok(!notesDoubt(''))
})
