import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anthropicSystem } from './llm.js'

test('an uncached system prompt is one string, parts joined', () => {
  assert.equal(anthropicSystem(['a', 'b'], false), 'a\nb')
  assert.equal(anthropicSystem([], true), undefined)
})

test('a cached system prompt gets a breakpoint on each part', () => {
  assert.deepEqual(anthropicSystem(['playbook', 'email rules'], true), [
    { type: 'text', text: 'playbook', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'email rules', cache_control: { type: 'ephemeral' } },
  ])
})

test("'1h' keeps the cache an hour", () => {
  assert.deepEqual(anthropicSystem(['playbook'], '1h'), [{ type: 'text', text: 'playbook', cache_control: { type: 'ephemeral', ttl: '1h' } }])
})

test('never more than the four breakpoints the API allows', () => {
  const out = anthropicSystem(['1', '2', '3', '4', '5'], true)
  assert.equal(out.filter(b => b.cache_control).length, 4)
  assert.equal(out[0].cache_control, undefined)
})
