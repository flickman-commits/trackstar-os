/**
 * Measure the PDF the render made, so the tool shows what was printed rather
 * than what the export settings asked for: the trim size, the bleed on each
 * side, and whether anything in it is RGB. Reads the page boxes and the
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
    trimIn: trim ? `${inches(trim[2] - trim[0])}x${inches(trim[3] - trim[1])}` : null,
    bleedIn: trim && bleed ? {
      left: inches(trim[0] - bleed[0]), bottom: inches(trim[1] - bleed[1]),
      right: inches(bleed[2] - trim[2]), top: inches(bleed[3] - trim[3]),
    } : null,
    color: rgbOps || rgbSpaces ? (cmykOps ? 'mixed' : 'RGB') : 'CMYK',
    rgbOps, rgbSpaces, cmykOps,
  }
}
