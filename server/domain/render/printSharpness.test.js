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

test('a race template only warns about images (the check reads a copy, so its links can look missing)', () => {
  const v = evaluateCheck(report([{ kind: 'linked', layer: 'LOCKED ASSETS', name: '', missing: true, ppi: 300, widthIn: 1 }]), { sizes: ['8x10'] })
  assert.equal(v.ok, true)
  assert.equal(v.warnings.filter(w => /linked to a file/.test(w)).length, 1)
})

test('the rendered PDF: each image\'s pixels over its drawn width, and a blurry one is a problem', () => {
  const pdf = '30 0 obj\n<</BitsPerComponent 8/DecodeParms<</Predictor 15>>/Height 38/Subtype/Image/Width 56>>stream endstream\n/XObject<</Im0 30 0 R>>\nq\n56.6743679 0 0 38.5482376 75.04 92.65 cm\n/Im0 Do\nQ'
  const images = imagesOf(pdf)
  assert.deepEqual(images, [{ ppi: 71, widthIn: 0.79, heightIn: 0.54 }])
  assert.match(outputProblems({ images }, '8x10')[0], /prints at only 71 ppi/)
  assert.deepEqual(outputProblems({ images: [{ ppi: 300, widthIn: 1.66, heightIn: 1.66 }] }, '8x10'), [])
})
