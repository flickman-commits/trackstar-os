// The checks that stop a blurry logo reaching print (BULK-0001, 2026-11-17).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCheck } from '../../../worker/lib/evaluateCheck.mjs'
import { imagesOf } from '../../../worker/lib/inspectPdf.mjs'
import { outputProblems } from './jobs.js'

const board = { name: '8x10', size: '8x10', chosen: true, photoVariant: false, fields: { name: { placeholder: true, layer: 'PERSONALIZE LAYER' }, bib: { placeholder: true, layer: 'PERSONALIZE LAYER' }, time: { placeholder: true, layer: 'PERSONALIZE LAYER' } } }
const report = images => ({ key: 'k', layers: { GUIDES: 'locked' }, artboards: [board], images })

test('a co-branded file with a missing linked logo, or a low-res one, fails its check', () => {
  const missing = evaluateCheck(report([{ kind: 'linked', layer: 'LOCKED ASSETS', name: '', missing: true, ppi: 2383, widthIn: 0.8 }]), { sizes: ['8x10'], cobranded: true })
  assert.equal(missing.ok, false)
  assert.match(missing.problems[0], /linked to a file this Mac does not have/)
  const low = evaluateCheck(report([{ kind: 'embedded', layer: 'LOCKED ASSETS', name: '', missing: false, ppi: 120, widthIn: 2 }]), { sizes: ['8x10'], cobranded: true })
  assert.equal(low.ok, false)
  const sharp = evaluateCheck(report([{ kind: 'embedded', layer: 'LOCKED ASSETS', name: '', missing: false, ppi: 1260, widthIn: 1.6 }]), { sizes: ['8x10'], cobranded: true })
  assert.equal(sharp.ok, true)
})

test('a race template fails on a missing link too, but only warns on a low-res image', () => {
  const missing = evaluateCheck(report([{ kind: 'linked', layer: 'LOCKED ASSETS', name: '', missing: true, ppi: 300, widthIn: 1 }]), { sizes: ['8x10'] })
  assert.equal(missing.ok, false)
  const low = evaluateCheck(report([{ kind: 'embedded', layer: 'LOCKED ASSETS', name: '', missing: false, ppi: 120, widthIn: 2 }]), { sizes: ['8x10'] })
  assert.equal(low.ok, true)
  assert.equal(low.warnings.filter(w => /120 ppi/.test(w)).length, 1)
})

test('the rendered PDF: each image\'s pixels over its drawn width, and a blurry one is a problem', () => {
  const page = (n, contents, extra = '') => `${n} 0 obj\n<</Type/Page/Contents ${contents} 0 R/Resources<</XObject<</Im0 30 0 R>>>>${extra}>>\nendobj\n`
  const stream = (n, text, extra = '') => `${n} 0 obj\n<</Length ${text.length}${extra}>>stream\n${text}\nendstream\nendobj\n`
  const image = '30 0 obj\n<</BitsPerComponent 8/DecodeParms<</Predictor 15>>/Height 38/Subtype/Image/Width 56>>stream\nxx\nendstream\nendobj\n'
  const draw = 'q\n56.6743679 0 0 38.5482376 75.04 92.65 cm\n/Im0 Do\nQ'
  const images = imagesOf(image + page(1, 2) + stream(2, draw))
  // The same image on a hidden layer never prints.
  assert.deepEqual(imagesOf(image + `5 0 obj\n<</AIType/HiddenLayer/Contents 6 0 R/Resources<</XObject<</Im0 30 0 R>>>>>>\nendobj\n` + stream(6, draw)), [])
  assert.deepEqual(images, [{ ppi: 71, widthIn: 0.79, heightIn: 0.54 }])
  assert.match(outputProblems({ images }, '8x10')[0], /prints at only 71 ppi/)
  assert.deepEqual(outputProblems({ images: [{ ppi: 300, widthIn: 1.66, heightIn: 1.66 }] }, '8x10'), [])
})
