import '../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchProblems } from './cronWatchdog.js'

const now = new Date('2026-11-10T20:00:00Z')
const ago = min => new Date(now.getTime() - min * 60_000).toISOString()
const job = (path, extra = {}) => ({ path, name: path, when: 'Every 2 minutes', late: false, lastRunAt: ago(1), ...extra })

test('all quiet: no problems', () => {
  const finished = new Map([['/api/cron/artelo-send', ago(3)]])
  assert.deepEqual(watchProblems({ jobs: [job('/api/cron/artelo-send')], lastImportAt: ago(8), finished, now }), [])
})

test('a late job, and an import that has not finished in half an hour, are problems', () => {
  const out = watchProblems({ jobs: [job('/api/cron/retention', { late: true, when: 'Every day at 4:30 AM' })], lastImportAt: ago(45), finished: new Map(), now })
  assert.deepEqual(out.map(p => p.key), ['late:/api/cron/retention', 'import'])
})

test('a job that keeps starting but stopped finishing is a problem', () => {
  const finished = new Map([['/api/cron/artelo-send', ago(90)]])
  const out = watchProblems({ jobs: [job('/api/cron/artelo-send')], lastImportAt: ago(5), finished, now })
  assert.deepEqual(out.map(p => p.key), ['stuck:/api/cron/artelo-send'])
})

test('a job with no finish stamp yet is not called stuck', () => {
  assert.deepEqual(watchProblems({ jobs: [job('/api/cron/artelo-send')], lastImportAt: ago(5), finished: new Map(), now }), [])
})
