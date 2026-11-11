// Shared by render.jsx and check.jsx: how a production file is read.
// ExtendScript (old JavaScript): no const, no JSON, no Array.indexOf.

var BREAK = '\u0003'; // Illustrator's forced line break

function trim(s) { return String(s).replace(/^\s+|\s+$/g, ''); }
function sizeKey(name) { var m = /(\d+)\s*x\s*(\d+)/i.exec(name); return m ? m[1] + 'x' + m[2] : null; }
function inside(bounds, rect) { var cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2; return cx >= rect[0] && cx <= rect[2] && cy <= rect[1] && cy >= rect[3]; }

// What kind of personalization a frame holds, from its current text (a placeholder or a past order).
function kindOf(contents) {
  var s = trim(String(contents).replace(/\u0003/g, ' '));
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) return 'time';
  if (/\d{1,2}:\d{2}\s*\/\s*mi/i.test(s)) return 'pace';
  if (/^\d{1,2}\.\d{2}\.\d{2}$/.test(s)) return 'date';
  if (/^(19|20)\d{2}$/.test(s)) return 'year';
  if (/\d\s*°\s*[NSEW]\b/i.test(s)) return null;   // coordinates on the artwork, not weather
  if (/°/.test(s)) return 'weather';
  if (/^\d{1,6}$/.test(s) || /\bBIB\b/i.test(s)) return 'bib';
  // A name: letters (accents too: Jesús, Zoë), spaces, periods, apostrophes, hyphens,
  // and a suffix ("John M. Bland, Jr", "Jr."); a comma only before that suffix, so "Burlington, VT" is not a name.
  var bare = s.replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, '');
  if (/^[A-Za-z\u00C0-\u017F][A-Za-z\u00C0-\u017F .'\-]*$/.test(bare) && s.length <= 40 && !/\.$/.test(bare) && bare.split(/\s+/).length <= 5) return 'name';
  return null;
}

// A text that is not a runner's name: an all-caps label (START, FINISH) or the race title.
// Short race names spelled out, so a title like "New York City" on the "NYC
// Marathon" design reads as the race and not a runner's name (Nov 11 2026: the
// new NYC design dropped "Marathon", and its title was hidden as a leftover).
var RACE_SPELLED = { nyc: 'new york city', la: 'los angeles', sf: 'san francisco', dc: 'washington dc', philly: 'philadelphia' };
function raceTitles(raceName) {
  var full = String(raceName || '').toLowerCase();
  var words = full.split(/\s+/), out = [full];
  var spelled = [];
  for (var i = 0; i < words.length; i++) spelled.push(RACE_SPELLED[words[i]] || words[i]);
  out.push(spelled.join(' '));
  return out;
}

function notAName(text, raceName) {
  var txt = trim(String(text).replace(/\u0003/g, ' '));
  if (/^[A-Z\s]+$/.test(txt) || /marathon|half|miler|ultra/i.test(txt)) return true;
  if (/^(start|finish)$/i.test(txt)) return true;
  if (txt.split(/\s+/).length < 2 && !/name/i.test(txt)) return true;   // a lone word is a label, not a runner
  if (raceName && txt.length >= 4) {
    var titles = raceTitles(raceName), low = txt.toLowerCase();
    for (var r = 0; r < titles.length; r++) if (titles[r].indexOf(low) >= 0) return true;
  }
  return false;
}

// A placeholder ("Runner Name", "BIB # HERE") beats a past order's value when a field appears twice.
function isPlaceholder(kind, text) {
  var t = trim(String(text));
  if (kind == 'name') return /name/i.test(t);
  if (kind == 'bib') return /BIB/i.test(t);
  return false;
}

function alignmentOf(frame) {
  var just = null; try { just = frame.textRange.paragraphAttributes.justification; } catch (e) { return 'unknown'; }
  if (just == Justification.RIGHT || just == Justification.FULLJUSTIFYLASTLINERIGHT) return 'right';
  if (just == Justification.LEFT || just == Justification.FULLJUSTIFYLASTLINELEFT || just == Justification.FULLJUSTIFY) return 'left';
  if (just == Justification.CENTER || just == Justification.FULLJUSTIFYLASTLINECENTER) return 'center';
  return 'unknown';
}

// The personalization frames on one artboard, by kind, with duplicates resolved toward
// placeholders. Returns { frames: {kind: frame}, leftovers: [frames to hide], dupes: [kinds] }.
// Illustrator hands out a fresh wrapper object each time, so === cannot tell two references to one
// frame apart. Compare what they point at instead.
function sameItem(a, b) {
  try {
    var ga = a.geometricBounds, gb = b.geometricBounds;
    return String(a.contents) == String(b.contents) && Math.abs(ga[0] - gb[0]) < 0.01 && Math.abs(ga[1] - gb[1]) < 0.01 && Math.abs(ga[2] - gb[2]) < 0.01;
  } catch (e) { return false; }
}

function layerOf(item) { var p = item; while (p && p.typename != 'Layer') p = p.parent; while (p && p.parent && p.parent.typename == 'Layer') p = p.parent; return p; }

function collectFrames(doc, ab, raceName) {
  var frames = {}, leftovers = [], dupes = [];
  // doc.textFrames reaches frames inside groups too, which layer.textFrames does not.
  for (var t = 0; t < doc.textFrames.length; t++) {
    var tf = doc.textFrames[t];
    var L = layerOf(tf);
    if (!L || L.name == 'GUIDES') continue;
    // A frame the designer hid, or a hidden layer, is not on the print and is not a field.
    var hiddenItem = false; try { hiddenItem = tf.hidden || !L.visible; } catch (e) {}
    if (hiddenItem) continue;
    if (!inside(tf.geometricBounds, ab)) continue;
    var kind = kindOf(tf.contents);
    if (!kind) continue;
    if (kind == 'name' && notAName(tf.contents, raceName)) continue;
    if (L.locked) L.locked = false;
    if (frames[kind]) {
      var keepNew = isPlaceholder(kind, tf.contents) && !isPlaceholder(kind, frames[kind].contents);
      var keepOld = isPlaceholder(kind, frames[kind].contents) && !isPlaceholder(kind, tf.contents);
      if (keepNew) { leftovers.push(frames[kind]); frames[kind] = tf; continue; }
      if (keepOld) { leftovers.push(tf); continue; }
      dupes.push(kind); continue;
    }
    frames[kind] = tf;
  }
  // A four-digit "year" on a design that carries a date is a bib number (2047 is a bib, not a year).
  if (frames.year && frames.date) {
    if (!frames.bib) { frames.bib = frames.year; } else { leftovers.push(frames.year); }
    delete frames.year;
  }
  // Two past orders' names and no placeholder: the name sits with the bib, so the nearer one is the
  // live frame and the other is a leftover.
  var ambiguousName = false;
  for (var d = 0; d < dupes.length; d++) if (dupes[d] == 'name') ambiguousName = true;
  if (ambiguousName && frames.bib) {
    var bibB = frames.bib.geometricBounds, best = null, bestDist = 1e9, candidates = [frames.name];
    for (var t2 = 0; t2 < doc.textFrames.length; t2++) {
      var c = doc.textFrames[t2];
      var cHidden = false; try { cHidden = c.hidden || !layerOf(c).visible; } catch (e) {}
      if (cHidden || sameItem(c, frames.name) || !inside(c.geometricBounds, ab) || kindOf(c.contents) != 'name' || notAName(c.contents, raceName)) continue;
      candidates.push(c);
    }
    for (var ci = 0; ci < candidates.length; ci++) {
      var gb = candidates[ci].geometricBounds;
      var dist = Math.abs(((gb[1] + gb[3]) / 2) - ((bibB[1] + bibB[3]) / 2)) + Math.abs(gb[2] - bibB[2]) * 0.25;
      if (dist < bestDist) { bestDist = dist; best = candidates[ci]; }
    }
    for (var cj = 0; cj < candidates.length; cj++) if (!sameItem(candidates[cj], best)) leftovers.push(candidates[cj]);
    frames.name = best;
    var kept = []; for (var dk = 0; dk < dupes.length; dk++) if (dupes[dk] != 'name') kept.push(dupes[dk]);
    dupes = kept;
  }
  return { frames: frames, leftovers: leftovers, dupes: dupes };
}

// No-time orders. Hiding time and pace is only safe when nothing sits to the right of pace in
// its row; otherwise the row is left with a hole where pace was. Nothing here moves text: a
// design that needs the row re-spaced carries a hidden "NO TIME" layer the designer laid out,
// with its own frames for whatever changes (weather, date...), and the render swaps to it.
function paceInRow(frames) {
  var p = frames.pace; if (!p) return false;
  var pb = p.geometricBounds;
  for (var k in frames) {
    if (k == 'pace' || k == 'time' || k == 'name') continue;
    var b = frames[k].geometricBounds;
    var overlap = Math.min(pb[1], b[1]) - Math.max(pb[3], b[3]);
    if (overlap > 0 && b[0] > pb[0] + 1) return true;
  }
  return false;
}

// The designer's no-time version of this artboard's details: a layer named "NO TIME" (hidden on
// the normal print), holding frames for the fields it re-lays out. Returns { layer, frames } or null.
// The layer is "NO TIME", or a whole second personalize layer named with it
// ("PERSONALIZE LAYER NO TIME" beside "PERSONALIZE LAYER WITH TIME"), which is
// how Dan lays them out: a full copy of the personalization with no time or pace.
function noTimeLayerOf(doc) {
  for (var i = 0; i < doc.layers.length; i++) if (/(^|[^a-z])no\s*time([^a-z]|$)/i.test(doc.layers[i].name)) return doc.layers[i];
  return null;
}

// Whether that layer is a whole copy (it has its own name frame on this artboard).
function noTimeLayerIsFull(doc, layer, ab, raceName) {
  for (var t = 0; t < doc.textFrames.length; t++) {
    var tf = doc.textFrames[t], L = layerOf(tf);
    if (!L || L.name != layer.name || !inside(tf.geometricBounds, ab)) continue;
    if (kindOf(tf.contents) == 'name' && !notAName(tf.contents, raceName)) return true;
  }
  return false;
}

function noTimeFrames(doc, ab) {
  var layer = noTimeLayerOf(doc);
  if (!layer) return null;
  var frames = {}, n = 0;
  for (var t = 0; t < doc.textFrames.length; t++) {
    var tf = doc.textFrames[t];
    var L = layerOf(tf); if (!L || L.name != layer.name) continue;
    if (!inside(tf.geometricBounds, ab)) continue;
    var kind = kindOf(tf.contents);
    if (!kind || kind == 'name' || kind == 'time' || kind == 'pace') continue;
    frames[kind] = tf; n++;
  }
  return n ? { layer: layer, frames: frames } : null;
}

// Which artboard renders this order: the right size, then the template's rules
// (templates.json): artboard = a word the name must contain (a colorway),
// artboardExclude = a word it must not ("copy"), photoArtboard = a word that
// marks the variant with a photo window, used only when the order has a photo.
function pickArtboard(doc, size, rules, hasPhoto) {
  var idx = -1;
  for (var a = 0; a < doc.artboards.length; a++) {
    var name = doc.artboards[a].name, lower = name.toLowerCase();
    if (sizeKey(name) != size) continue;
    if (rules.artboard && lower.indexOf(String(rules.artboard).toLowerCase()) < 0) continue;
    if (rules.artboardExclude && lower.indexOf(String(rules.artboardExclude).toLowerCase()) >= 0) continue;
    if (rules.photoArtboard) {
      var isPhotoBoard = lower.indexOf(String(rules.photoArtboard).toLowerCase()) >= 0;
      if (isPhotoBoard != !!hasPhoto) continue;
    }
    idx = a;
  }
  return idx;
}

// The margin guides on an artboard: the leftmost and rightmost vertical guides on the GUIDES layer.
function marginsOf(doc, ab) {
  var marginL = null, marginR = null;
  try {
    var guides = doc.layers.getByName('GUIDES');
    for (var gi = 0; gi < guides.groupItems.length; gi++) {
      var grp = guides.groupItems[gi];
      if (!inside(grp.geometricBounds, ab)) continue;
      for (var pi = 0; pi < grp.pathItems.length; pi++) {
        var pb = grp.pathItems[pi].geometricBounds;
        if (Math.abs(pb[0] - pb[2]) < 1) {
          if (marginL === null || pb[0] < marginL) marginL = pb[0];
          if (marginR === null || pb[0] > marginR) marginR = pb[0];
        }
      }
    }
  } catch (e) {}
  return { left: marginL, right: marginR };
}

// The photo window on an artboard: a clipped group on PHOTO LAYER whose clipping path is roughly square.
function photoWindowOf(doc, ab) {
  var photoLayer = null; try { photoLayer = doc.layers.getByName('PHOTO LAYER'); } catch (e) { return null; }
  var group = null;
  for (var g = 0; g < photoLayer.groupItems.length; g++) if (inside(photoLayer.groupItems[g].geometricBounds, ab)) group = photoLayer.groupItems[g];
  if (!group) return null;
  var clip = null;
  for (var q = 0; q < group.pathItems.length; q++) if (group.pathItems[q].clipping) clip = group.pathItems[q];
  return clip ? { layer: photoLayer, group: group, clip: clip } : null;
}

// Where the letters of a text frame actually are, as [left, top, right, bottom]. A frame's own
// bounds are its box, which for area text is wider than the words; outlining a copy and measuring
// it gives the ink. The copy is removed. Falls back to the frame's bounds if outlining fails.
function inkBounds(frame) {
  var copy = null;
  try {
    copy = frame.duplicate();
    var outlined = copy.createOutline();
    var b = outlined.geometricBounds;
    outlined.remove();
    return b;
  } catch (e) {
    try { if (copy) copy.remove(); } catch (e2) {}
    return frame.geometricBounds;
  }
}

// Whether two [left, top, right, bottom] rects overlap, the first grown by pad on every side.
function overlaps(a, b, pad) {
  return a[0] - pad < b[2] && a[2] + pad > b[0] && a[1] + pad > b[3] && a[3] - pad < b[1];
}
