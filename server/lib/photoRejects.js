/**
 * A record of every customer photo we turn away, and why.
 *
 * The wizards refuse most photos in the browser, before any upload, so
 * without this nobody could see how often it happens or which rule did it.
 * Kept in AuditEvent (action "photo.reject") so it needs no table of its own:
 *
 *   select created_at, detail from "AuditEvent"
 *   where action = 'photo.reject' order by created_at desc;
 *
 * Never throws: a failed log must not turn into a failed upload.
 */
import prisma from '../../api/_lib/prisma.js'

const REASONS = new Set([
  'too_small', 'too_large_file', 'too_many_pixels', 'not_an_image', 'type_mismatch',
  'unsupported_type', 'decode_failed', 'open_failed', 'prepare_failed', 'verify_failed', 'upload_failed', 'other',
])
const SOURCES = new Set(['wizard', 'custom-wizard', 'photo-later', 'manage-order', 'server'])

const num = v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null)
const text = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, n) || null

/** Shape whatever a caller sends into a small, safe record. */
export function photoRejectDetail(input = {}) {
  const reason = REASONS.has(input.reason) ? input.reason : 'other'
  return {
    reason,
    source: SOURCES.has(input.source) ? input.source : 'server',
    width: num(input.width),
    height: num(input.height),
    bytes: num(input.bytes),
    type: text(input.type, 40),
    race: text(input.race, 80),
    device: text(input.device, 20),
  }
}

export async function logPhotoReject(input) {
  const d = photoRejectDetail(input)
  const dims = d.width && d.height ? ` ${d.width}x${d.height}` : ''
  console.warn(`[PHOTO_REJECT] reason=${d.reason} source=${d.source}${dims} type=${d.type || '?'}`)
  try {
    await prisma.auditEvent.create({
      data: {
        action: 'photo.reject',
        summary: `Photo turned away (${d.reason})${dims}`,
        detail: d,
        actorEmail: 'storefront',
      },
    })
  } catch (err) {
    console.error('[PHOTO_REJECT] could not record:', err.message)
  }
  return d
}
