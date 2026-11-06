/**
 * Image validation from raw bytes.
 *
 * Two threats this defends against, neither of which the declared Content-Type
 * can protect us from (the client picks that value, so it is a claim, not a
 * fact):
 *
 *   1. TYPE SPOOFING — arbitrary bytes uploaded as "image/jpeg". Supabase's
 *      allowedMimeTypes checks the DECLARED type, so without a byte-level sniff
 *      the bucket happily stores anything.
 *
 *   2. DECOMPRESSION BOMBS — a ~5KB PNG can declare 50000x50000 pixels and
 *      expand to tens of GB when decoded, taking down whatever opens it (our
 *      pipeline, or a designer's machine). Dimensions live in the header, so we
 *      can reject these WITHOUT ever decoding the image.
 *
 * Everything here reads only the leading bytes of a file. Nothing decodes.
 */

/**
 * 100 megapixels. Well above any real camera or phone (a 48MP iPhone shot is
 * ~48M), and far below the gigapixel range where bombs live.
 */
export const MAX_PIXELS = 100_000_000

/**
 * Minimum on the SHORTER edge, and the only hard size rule.
 *
 * The photo prints in a square 10% of the poster's long side: 1in on an 8x10,
 * 1.8in on a 12x18, 2.4in on a 16x24. Print labs call 300 DPI ideal and 150
 * DPI acceptable, so even the 16x24 needs only 360-720px. The old floor of
 * 1200px was stricter than 500 DPI and turned away photos customers had paid
 * for (an official race-app photo, 2026-10-19). 500px is 200+ DPI at every
 * size we sell; below it a photo is a thumbnail or a heavy social copy.
 * Anything softer than ideal for a bigger size is a WARNING in the wizard
 * (see photoDpiAt), never a refusal. Mirrored in both storefront wizards.
 */
export const MIN_SHORT_EDGE = 500

/** The photo window is this share of the poster's long side. */
export const PHOTO_WINDOW_SHARE = 0.1

/**
 * Effective DPI of a square photo `px` wide printed on a poster of `size`
 * ("16x24", "8 x 10", '12"x18"'). Null when the size cannot be read.
 */
export function photoDpiAt(px, size) {
  const m = String(size || '').match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/)
  if (!m || !px) return null
  const inches = Math.max(Number(m[1]), Number(m[2])) * PHOTO_WINDOW_SHARE
  return inches > 0 ? Math.round(px / inches) : null
}

/*
 * There is deliberately NO file-size floor. Byte count is a poor proxy for
 * print quality: a sharp, high-resolution phone photo re-encodes to JPEG well
 * under 1MB (and iOS's HEIC->JPEG transcode routinely does), so a floor wrongly
 * refuses good photos. Print sharpness is gated by MIN_SHORT_EDGE against real
 * pixels in photo-verify; a corrupt/undecodable file is caught there too.
 */

const startsWith = (buf, bytes, offset = 0) =>
  bytes.every((b, i) => buf[offset + i] === b)

/**
 * Identify a real image type from its magic bytes.
 * @param {Buffer|Uint8Array} buf - at least the first ~16 bytes
 * @returns {'jpeg'|'png'|'webp'|'heic'|null}
 */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null

  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'

  // WEBP: "RIFF" .... "WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp'
  }

  // HEIC/HEIF: "ftyp" at offset 4, then a known brand.
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]).toLowerCase()
    if (['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].includes(brand)) return 'heic'
  }

  return null
}

/** PNG: IHDR is always first — width/height are big-endian u32 at 16 and 20. */
function pngDimensions(buf) {
  if (buf.length < 24) return null
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  }
}

/**
 * JPEG: walk the marker segments looking for a Start-Of-Frame (SOF), which
 * carries the real dimensions. SOF0-SOF15 are 0xFFC0-0xFFCF except C4 (Huffman
 * table), C8 (JPG extension) and CC (arithmetic coding) which are not frames.
 */
function jpegDimensions(buf) {
  let i = 2 // skip SOI
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue } // resync on padding
    const marker = buf[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }

    const len = buf.readUInt16BE(i + 2)
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSOF) {
      if (i + 9 > buf.length) return null
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      }
    }
    if (len <= 0) return null
    i += 2 + len
  }
  return null
}

/** WEBP: handles the VP8X (extended) and VP8L (lossless) chunk layouts. */
function webpDimensions(buf) {
  if (buf.length < 30) return null
  const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15])

  if (chunk === 'VP8X') {
    // Canvas size is stored minus one, as two 24-bit little-endian values.
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
    return { width, height }
  }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21)
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }
  }
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  return null
}

/**
 * Read dimensions from header bytes without decoding.
 *
 * Returns null for HEIC — its dimensions live inside nested ISOBMFF boxes and
 * parsing them properly is its own project. HEIC is instead bounded by the
 * 25MB file cap, and HEIC bombs are not a practical vector the way crafted PNGs
 * are. Callers must treat null as "unknown", not "valid".
 *
 * @returns {{width:number,height:number}|null}
 */
export function readImageDimensions(buf, type) {
  try {
    if (type === 'png') return pngDimensions(buf)
    if (type === 'jpeg') return jpegDimensions(buf)
    if (type === 'webp') return webpDimensions(buf)
    return null
  } catch {
    return null
  }
}

/**
 * Full verdict for an uploaded file's leading bytes.
 *
 * @param {Buffer} buf - leading bytes (64KB is plenty)
 * @param {string} declaredType - the Content-Type the client claimed
 * @returns {{ ok: boolean, reason?: string, message?: string, type?: string, width?: number, height?: number }}
 */
export function validateImageBytes(buf, declaredType) {
  const type = sniffImageType(buf)
  if (!type) {
    return {
      ok: false,
      reason: 'not_an_image',
      message: "That file doesn't look like an image. Please upload a JPG, PNG, WEBP, or HEIC.",
    }
  }

  // The declared type must agree with reality. Catches a file renamed or
  // mislabeled to slip past the bucket's allowedMimeTypes check.
  const declared = String(declaredType || '').toLowerCase()
  const declaredFamily = declared.includes('heif') ? 'heic' : declared.replace('image/', '').replace('jpg', 'jpeg')
  if (declaredFamily && declaredFamily !== type) {
    return {
      ok: false,
      reason: 'type_mismatch',
      message: "That file doesn't match its file type. Please re-save it and try again.",
      type,
    }
  }

  const dims = readImageDimensions(buf, type)

  // HEIC dimensions are unknown to us; the size cap is the backstop.
  if (!dims) return { ok: true, type }

  const { width, height } = dims
  if (!width || !height) return { ok: true, type }

  if (width * height > MAX_PIXELS) {
    return {
      ok: false,
      reason: 'too_many_pixels',
      message: 'That image is too large to process. Please upload a standard photo.',
      type, width, height,
    }
  }

  if (Math.min(width, height) < MIN_SHORT_EDGE) {
    return {
      ok: false,
      reason: 'too_small',
      message: 'That photo is too small to print clearly. Try the original from your phone or the photo site, not a screenshot or a copy sent by text.',
      type, width, height,
    }
  }

  return { ok: true, type, width, height }
}
