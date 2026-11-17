/**
 * Measure the PDF the render made, so the tool shows what was printed rather
 * than what the export settings asked for: the trim size, the bleed on each
 * side, whether anything in it is RGB, and how sharp each image prints (its
 * pixels over the size it is drawn at). Reads the page boxes and the
 * (inflated) content and object streams; no PDF library needed for this.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

const box = (s, name) => {
  const m = new RegExp(`/${name}\\s*\\[\\s*([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s*\\]`).exec(s)
  return m ? m.slice(1).map(Number) : null
}
const inches = pt => Math.round(pt / 72 * 1000) / 1000

export function inspectPdf(file) {
  const buf = fs.readFileSync(file)
  const raw = buf.toString('latin1')
  let inflated = ''
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length, end = raw.indexOf('endstream', start)
    if (end < 0) break
    try { inflated += zlib.inflateSync(buf.subarray(start, end)).toString('latin1') } catch { /* not deflated, or an image */ }
  }
  // Stream bodies (compressed images above all) are binary: by chance they
  // contain text like "1\rRG", which read as an RGB colour and flagged CMYK
  // prints with a customer photo as mixed. Only the PDF's own text and the
  // inflated streams are searched, and an operator needs its full operands.
  const all = raw.replace(/stream\r?\n[\s\S]*?endstream/g, 'stream endstream') + '\n' + inflated
  const media = box(all, 'MediaBox'), trim = box(all, 'TrimBox') || media, bleed = box(all, 'BleedBox') || media
  const count = re2 => (all.match(re2) || []).length
  const num = String.raw`-?(?:\d+\.?\d*|\.\d+)`
  const rgbOps = count(new RegExp(String.raw`(?<![\w.-])${num}\s+${num}\s+${num}\s+(?:rg|RG)(?![\w.])`, 'g'))
  const cmykOps = count(new RegExp(String.raw`(?<![\w.-])${num}\s+${num}\s+${num}\s+${num}\s+(?:k|K)(?![\w.])`, 'g'))
  const rgbSpaces = count(/\/DeviceRGB|\/ICCBased[^>]*\/N\s+3|\/N\s+3\b[^>]*\/ICCBased/g)
  return {
    images: imagesOf(buf),
    trimIn: trim ? `${inches(trim[2] - trim[0])}x${inches(trim[3] - trim[1])}` : null,
    bleedIn: trim && bleed ? {
      left: inches(trim[0] - bleed[0]), bottom: inches(trim[1] - bleed[1]),
      right: inches(bleed[2] - trim[2]), top: inches(bleed[3] - trim[3]),
    } : null,
    color: rgbOps || rgbSpaces ? (cmykOps ? 'mixed' : 'RGB') : 'CMYK',
    rgbOps, rgbSpaces, cmykOps,
  }
}

/**
 * Each image as printed: its pixel width over the width it is drawn at, in
 * ppi. Illustrator draws an image as "a b c d e f cm /Im0 Do"; the name maps
 * to an object through the /XObject resources. Content on a hidden layer
 * (/AIType /HiddenLayer) never prints and is left out. A blurry logo shows up
 * here as a low number (BULK-0001's printed at 71 ppi, 2026-11-17).
 */
export function imagesOf(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'latin1')
  const raw = buf.toString('latin1')
  const objs = []
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b/g)) {
    const from = m.index + m[0].length
    const end = raw.indexOf('endobj', from)
    const s = raw.indexOf('stream', from)
    const hasStream = s >= 0 && (end < 0 || s < end) && raw.slice(s - 3, s) !== 'end'
    const dict = raw.slice(from, hasStream ? s : end < 0 ? raw.length : end)
    let body = null
    if (hasStream) {
      const at = s + (raw[s + 6] === '\r' ? 8 : 7)
      const stop = raw.indexOf('endstream', at)
      const bytes = buf.subarray(at, stop < 0 ? buf.length : stop)
      if (/FlateDecode/.test(dict)) { try { body = zlib.inflateSync(bytes).toString('latin1') } catch { body = null } }
      else if (!/\/Subtype\s*\/Image/.test(dict)) body = bytes.toString('latin1')
    }
    objs.push({ num: m[1], dict, body })
  }
  const hidden = new Set()
  for (const o of objs) if (/\/AIType\s*\/HiddenLayer/.test(o.dict)) {
    hidden.add(o.num)
    for (const c of o.dict.matchAll(/\/Contents\s+(\d+)\s+0\s+R/g)) hidden.add(c[1])
  }
  const size = new Map(), named = new Map()
  for (const o of objs) {
    if (/\/Subtype\s*\/Image/.test(o.dict)) {
      const w = /\/Width\s+(\d+)/.exec(o.dict), h = /\/Height\s+(\d+)/.exec(o.dict)
      if (w && h) size.set(o.num, { w: Number(w[1]), h: Number(h[1]) })
    }
    if (hidden.has(o.num)) continue
    for (const block of o.dict.matchAll(/\/XObject\s*<<([^>]*)>>/g)) for (const r of block[1].matchAll(/\/([^\s/<>]+)\s+(\d+)\s+0\s+R/g)) named.set(r[1], r[2])
  }
  const n = String.raw`(-?(?:\d+\.?\d*|\.\d+))`
  const draw = new RegExp(String.raw`${n}\s+${n}\s+${n}\s+${n}\s+${n}\s+${n}\s+cm\s*\/([^\s/<>\[\]()]+)\s+Do`, 'g')
  const out = []
  for (const o of objs) {
    if (!o.body || hidden.has(o.num)) continue
    for (const m of o.body.matchAll(draw)) {
      const px = size.get(named.get(m[7]))
      if (!px) continue
      const [a, b, c, d] = m.slice(1, 5).map(Number)
      const wIn = Math.hypot(a, b) / 72, hIn = Math.hypot(c, d) / 72
      if (wIn < 0.05 || hIn < 0.05) continue
      out.push({ ppi: Math.round(Math.min(px.w / wIn, px.h / hIn)), widthIn: Math.round(wIn * 100) / 100, heightIn: Math.round(hIn * 100) / 100 })
    }
  }
  return out
}
