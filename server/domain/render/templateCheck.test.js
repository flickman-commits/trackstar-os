import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCheck } from '../../../worker/lib/evaluateCheck.mjs'

// A file with a full and a half design at each size, as Kiawah Island's is.
const fields = { name: { text: 'Your Name Here', placeholder: true, layer: 'PERSONALIZE LAYER' }, bib: { text: 'BIB # HERE', placeholder: true, layer: 'PERSONALIZE LAYER' }, time: { text: '3:19:10', placeholder: true, layer: 'PERSONALIZE LAYER' } }
const board = (name, { chosen, candidate }) => ({ name, size: name.match(/\d+x\d+/)[0], chosen, candidate, photoVariant: false, fields, margins: {}, photoWindow: { present: false } })
const report = (key, pick) => ({ key, layers: { GUIDES: true }, images: [], artboards: ['8x10', '12x18', '16x24'].flatMap(s => [
  board(`Kiawah_Full_${s}`, pick('full')),
  board(`Kiawah_Half_${s}`, pick('half')),
]) })

test('two designs at one size with no rule to pick one is a problem, not a silent pick', () => {
  const v = evaluateCheck(report('Kiawah Island Marathon', d => ({ chosen: d === 'half', candidate: true })))
  assert.equal(v.ok, false)
  assert.match(v.problems.join('\n'), /12x18: 2 artboards match \(Kiawah_Full_12x18, Kiawah_Half_12x18\)/)
})

test('a marathon key that picks a half artboard is a problem', () => {
  const v = evaluateCheck(report('Kiawah Island Marathon', d => ({ chosen: d === 'half', candidate: d === 'half' })))
  assert.match(v.problems.join('\n'), /a half marathon design, for Kiawah Island Marathon/)
})

test('with rules, the marathon key prints the full design and the half key the half', () => {
  assert.deepEqual(evaluateCheck(report('Kiawah Island Marathon', d => ({ chosen: d === 'full', candidate: d === 'full' }))).problems, [])
  assert.deepEqual(evaluateCheck(report('Kiawah Island Marathon / Half Marathon', d => ({ chosen: d === 'half', candidate: d === 'half' }))).problems, [])
})
