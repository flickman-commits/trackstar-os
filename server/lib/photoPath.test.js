import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStoredPhotoPath } from './photoPath.js'

test('an uploaded photo path passes', () => {
  assert.ok(isStoredPhotoPath('2026-11-03/3f2a9c1e-4b7d-4e2a-9b1c-1234567890ab.jpg'))
  assert.ok(isStoredPhotoPath('2026-11-03/3f2a9c1e-4b7d-4e2a-9b1c-1234567890ab.heic'))
})

test('a path that leaves the folder, or is not an upload, is refused', () => {
  assert.ok(!isStoredPhotoPath('../production-files/renders/abc/v1.pdf'))
  assert.ok(!isStoredPhotoPath('2026-11-03/../../order-proofs/x.jpg'))
  assert.ok(!isStoredPhotoPath('2026-11-03/3f2a9c1e-4b7d-4e2a-9b1c-1234567890ab.svg'))
  assert.ok(!isStoredPhotoPath(''))
  assert.ok(!isStoredPhotoPath(null))
})
