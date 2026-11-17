/**
 * Turn the Illustrator checker's raw report for one template (check.jsx)
 * into a verdict: problems that would stop the render script, warnings worth
 * knowing, and a per-size summary. Used by the worker, which checks a
 * template whenever its file changes, and by the check-template CLI.
 */
export const SIZES = ['8x10', '12x18', '16x24']

/**
 * `sizes` is what the file has to cover: every size for a race template, and
 * only the run's own size for a co-branded bulk file (templates.js sends it
 * as rules.sizes), since a partner's run is one size.
 */
// Below this an image (a partner's logo above all) prints soft. 300 is the target; 250 leaves room for rounding.
export const MIN_IMAGE_PPI = 250

export function evaluateCheck(r, { sizes: need = SIZES, cobranded = false } = {}) {
  const problems = [], warnings = [], sizes = {}
  if (!r || r.error) return { ok: false, problems: [r?.error || 'no report'], warnings, sizes }
  // A linked image whose file is not on this Mac renders as Illustrator's low-res preview: never print that.
  for (const img of r.images || []) {
    const what = `${img.widthIn}" wide image on ${img.layer}${img.name ? ` (${img.name})` : ''}`
    // The render opens a copy of the file too (render-worker.mjs), so what is missing here is missing at render time.
    if (img.missing) { problems.push(`a ${what} is linked to a file this Mac does not have, so it would print as a blurry preview: embed it in Illustrator (Links panel > Embed Image) and upload the file again`); continue }
    if (img.kind === 'linked') warnings.push(`a ${what} is linked, not embedded: embed it so the file prints the same on any Mac`)
    if (img.ppi && img.ppi < MIN_IMAGE_PPI) (cobranded ? problems : warnings).push(`a ${what} is only ${img.ppi} ppi and will print soft (needs ${MIN_IMAGE_PPI}+): use a larger or vector version`)
  }
  if (r.strayImages) warnings.push(`${r.strayImages} image${r.strayImages > 1 ? 's' : ''} outside the locked artwork (a past order's photo; removed at render time)`)
  if (!r.layers?.['GUIDES']) warnings.push('no GUIDES layer: long names cannot grow to a margin, only shrink')
  const chosen = (r.artboards || []).filter(a => a.chosen && a.size)
  for (const size of need) {
    const boards = chosen.filter(a => a.size === size && !a.photoVariant)
    const photoBoards = chosen.filter(a => a.size === size && a.photoVariant)
    if (!boards.length) { problems.push(`${size}: no artboard`); continue }
    if (boards.length > 1) { problems.push(`${size}: ${boards.length} artboards match (${boards.map(b => b.name).join(', ')}); set "artboard" or "artboardExclude" to pick one`); continue }
    const b = boards[0], fields = b.fields || {}
    const have = Object.keys(fields)
    const missing = ['name', 'bib', 'time'].filter(k => !fields[k])
    if (missing.length) problems.push(`${size}: no ${missing.join(', ')} frame found`)
    // A triathlon design (rules.triathlon): the title and all three legs must be found too.
    if (b.triathlon?.missing?.length) problems.push(`${size}: triathlon ${b.triathlon.missing.join(', ')} not found`)
    if (b.ambiguous?.length) problems.push(`${size}: two ${b.ambiguous.join(', ')} frames and neither is a placeholder`)
    for (const k of have) if (!fields[k].placeholder && (k === 'name' || k === 'bib')) warnings.push(`${size}: ${k} frame holds a past order ("${fields[k].text}"); replaced at render time`)
    if (b.leftoverText?.length) warnings.push(`${size}: leftover text hidden at render time: ${b.leftoverText.map(t => `"${t}"`).join(', ')}`)
    for (const k of have) if (fields[k].layer !== 'PERSONALIZE LAYER') warnings.push(`${size}: ${k} frame is on "${fields[k].layer}", not PERSONALIZE LAYER`)
    const photoWindow = b.photoWindow?.present ? (photoBoards.length ? 'variant' : true) : (photoBoards.length === 1 ? 'variant' : false)
    if (b.photoWindow?.present && b.photoWindow.holdsImage) warnings.push(`${size}: photo window still holds a photo (replaced at render time)`)
    if (!photoWindow) warnings.push(`${size}: no photo window; an order with a photo cannot be rendered on this design`)
    // How a no-time order prints on this size (lib.jsx paceInRow / noTimeFrames).
    const noTime = b.noTimeLayout?.length ? 'NO TIME layout' : b.paceInRow ? 'needs NO TIME layout' : 'hides cleanly'
    if (noTime === 'needs NO TIME layout') warnings.push(`${size}: details sit to the right of pace, so a no-time order cannot print until the file has a NO TIME layer`)
    sizes[size] = {
      noTime,
      artboard: b.name,
      fields: have,
      nameAlign: fields.name?.align || null,
      nameGrows: fields.name ? (fields.name.align === 'right' ? (b.margins?.left !== null ? 'left to the margin guide' : 'cannot grow, shrinks') : fields.name.align === 'left' ? (b.margins?.right !== null ? 'right to the margin guide' : 'cannot grow, shrinks') : 'centered, shrinks only') : null,
      photoWindow,
      photoArtboard: photoBoards[0]?.name || null,
    }
  }
  const extra = [...new Set(chosen.filter(a => !SIZES.includes(a.size)).map(a => a.size))]
  return { ok: problems.length === 0, problems, warnings, sizes, extraSizes: extra, colorSpace: String(r.colorSpace || '').replace('DocumentColorSpace.', '') }
}
