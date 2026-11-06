import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeRequest, makeRouter } from '../api/_lib/router.js'
import { tables } from '../scripts/gen-routes.js'

test('a rewritten request is put back the way the handler expects it', () => {
  const r = routeRequest({ url: '/api/app?__route=orders/actions&action=monday-pipeline&id=1&id=2' })
  assert.equal(r.route, 'orders/actions')
  assert.equal(r.url, '/api/orders/actions?action=monday-pipeline&id=1&id=2')
  assert.deepEqual(r.query, { action: 'monday-pipeline', id: ['1', '2'] })
})

test('without __route the path names the route (no rewrite, or local dev)', () => {
  assert.equal(routeRequest({ url: '/api/support/thread?id=5' }).route, 'support/thread')
  assert.equal(routeRequest({ url: '/api/mcp' }).route, 'mcp')
})

test('page rewrites keep their own parameters', () => {
  const r = routeRequest({ url: '/api/public?__route=public/approval-preview&token=abc' })
  assert.equal(r.url, '/api/public/approval-preview?token=abc')
  assert.deepEqual(r.query, { token: 'abc' })
})

function fakeRes() {
  const res = { code: 200, body: null }
  res.status = c => { res.code = c; return res }
  res.json = b => { res.body = b; return res }
  return res
}

test('the router calls the handler with the original url and query', async () => {
  let seen
  const router = makeRouter({ 'orders/update': async () => ({ default: (req, res) => { seen = { url: req.url, query: req.query }; res.status(200).json({ ok: true }) } }) })
  const res = fakeRes()
  await router({ url: '/api/app?__route=orders/update&x=1', query: { __route: 'orders/update', x: '1' } }, res)
  assert.deepEqual(seen, { url: '/api/orders/update?x=1', query: { x: '1' } })
})

test('an unknown route is a 404, and no prototype key counts as a route', async () => {
  const router = makeRouter({})
  for (const url of ['/api/nope', '/api/app?__route=constructor', '/api/app?__route=__proto__']) {
    const res = fakeRes()
    await router({ url }, res)
    assert.equal(res.code, 404, url)
  }
})

test('every handler is in exactly one group and the URLs did not change', () => {
  const routes = Object.values(tables()).flatMap(t => [...t.matchAll(/^ {2}'([^']+)'/gm)].map(m => m[1]))
  assert.equal(new Set(routes).size, routes.length)
  for (const r of ['orders', 'orders/actions', 'cron/artelo-send', 'public/results-lookup', 'support/thread', 'mcp', 'auth/login', 'search', 'feature-requests']) {
    assert.ok(routes.includes(r), r)
  }
})
