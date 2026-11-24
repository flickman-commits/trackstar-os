import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTeam, wholeDays } from './teamOutput.js'

test('only whole Eastern days: the one the window starts partway through is dropped', () => {
  assert.deepEqual(wholeDays({ since: new Date('2026-11-21T22:00:00Z'), until: new Date('2026-11-24T22:00:00Z') }), ['2026-11-24', '2026-11-23', '2026-11-22'])
  // Midnight Eastern to now: today, and today only.
  assert.deepEqual(wholeDays({ since: new Date('2026-11-24T05:00:00Z'), until: new Date('2026-11-24T22:00:00Z') }), ['2026-11-24'])
  // Yesterday ends at midnight, which is not a day of its own.
  assert.deepEqual(wholeDays({ since: new Date('2026-11-23T05:00:00Z'), until: new Date('2026-11-24T05:00:00Z') }), ['2026-11-23'])
  // Across the clock change on 2026-11-01, each day once.
  assert.deepEqual(wholeDays({ since: new Date('2026-10-31T04:00:00Z'), until: new Date('2026-11-02T05:00:00Z') }), ['2026-11-01', '2026-10-31'])
})

test('counts land on the person and the day, and outside days are left out', () => {
  const out = buildTeam({
    days: ['2026-11-24', '2026-11-23'],
    counts: {
      prints: [{ id: 'e', day: '2026-11-24', n: 60 }, { id: 'e', day: '2026-11-20', n: 9 }],
      tickets: [{ id: 'e', day: '2026-11-24', n: 6 }, { id: 'c', day: '2026-11-23', n: 48 }, { id: null, day: '2026-11-23', n: 2 }],
      minutes: [{ id: 'e', day: '2026-11-24', n: 60 }],
    },
    names: new Map([['e', 'Elí'], ['c', 'Carolina']]),
  })
  assert.deepEqual(out.people.map(p => p.name), ['Carolina', 'Elí'])
  assert.equal(out.people[1].byDay['2026-11-24'].prints, 60)
  assert.equal(out.people[1].byDay['2026-11-24'].minutes, 60)
  assert.equal(out.people[1].byDay['2026-11-20'], undefined)
  assert.equal(out.people[0].byDay['2026-11-23'].tickets, 48)
})
