import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFor, nameVariants, sameName, isSeveralRunners, checkRowOnPage, clockSeconds } from './agentRules.js'

test('pre-2020 years are never researched automatically', () => {
  assert.equal(planFor({ reason: 'Research by hand', year: 2019, runner: 'Jo Smith', hasScraper: true }).action, 'skip')
  assert.equal(planFor({ reason: 'Runner not found', year: 2012, runner: 'Jo Smith', hasScraper: true }).action, 'skip')
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
