// Trackstar render script. Runs inside Illustrator (ExtendScript, so old JavaScript: no const, no JSON).
//
// The worker writes <this folder>/current.json before running this, with:
//   { template, out, preset, artboard, spec: { size, name, bib, time, pace, noTime, date, condition, temp, photo } }
// template is a COPY of the race's production file (the live file is never opened here),
// out is a path without extension, artboard is an optional word the artboard's name must
// contain (a file with two colorways), photo is a local file path or null.
//
// It finds the six personalization frames on the order's artboard, fills them, places the
// photo, exports out.pdf (the shop's preset, 1/4" bleed) and out.png, writes result.json,
// and closes without saving.
//
// Production files are working files, not clean templates: designers leave the last
// order's name, bib and time in the frames, sometimes a customer photo, and a frame or
// two end up on the wrong layer. So frames are recognised by what kind of text they
// hold, on any layer of the artboard, and leftover images are removed first.
#target illustrator
#include "lib.jsx"

var HERE = new File($.fileName).parent;
var RESULT = new File(HERE + '/result.json');
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

function readJson(f) { f.encoding = 'UTF-8'; f.open('r'); var s = f.read(); f.close(); return eval('(' + s + ')'); }
function writeResult(obj) {
  var parts = [];
  for (var k in obj) parts.push('"' + k + '":' + (typeof obj[k] == 'string' ? '"' + obj[k].replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"' : obj[k]));
  RESULT.encoding = 'UTF-8'; RESULT.open('w'); RESULT.write('{' + parts.join(',') + '}'); RESULT.close();
}
var doc = null, stage = 'start';
try {
  var job = readJson(new File(HERE + '/current.json'));
  var spec = job.spec;
  doc = app.open(new File(job.template));

  stage = 'artboard';
  var abIndex = pickArtboard(doc, spec.size, { artboard: job.artboard, artboardExclude: job.artboardExclude, photoArtboard: job.photoArtboard }, !!spec.photo);
  if (abIndex < 0) throw new Error('No artboard for size ' + spec.size + (spec.photo && job.photoArtboard ? ' with a photo window' : ''));
  var ab = doc.artboards[abIndex].artboardRect;

  stage = 'frames';
  // Every text frame on this artboard that looks like a personalization field, whatever layer it is on
  // (lib.jsx collectFrames). A placeholder beats a past order's value; the loser is hidden, because a
  // leftover name or bib must never print.
  // A no-time order on a file whose NO TIME layer is a whole copy of the
  // personalization: show that layer, hide the one with time, and read the
  // frames from it. Everything below then fills it like any other print.
  var swappedNoTime = false;
  if (!spec.noTime) {
    // An order with a time never shows the NO TIME layer, even if the file was saved with it on.
    var ntOff = noTimeLayerOf(doc);
    if (ntOff && ntOff.visible) { if (ntOff.locked) ntOff.locked = false; ntOff.visible = false; }
  }
  if (spec.noTime) {
    var ntl = noTimeLayerOf(doc);
    if (ntl && noTimeLayerIsFull(doc, ntl, ab, spec.race)) {
      var before0 = collectFrames(doc, ab, spec.race).frames;
      for (var bk in before0) { var bl = layerOf(before0[bk]); if (bl && bl.name != ntl.name && bl.name != 'LOCKED ASSETS') { if (bl.locked) bl.locked = false; bl.visible = false; } }
      if (ntl.locked) ntl.locked = false;
      ntl.visible = true;
      swappedNoTime = true;
    }
  }
  // A triathlon (spec.triathlon): the title and the three legs are read first,
  // by where they sit (lib.jsx triFrames), and the usual reading skips them.
  var tri = null;
  if (spec.triathlon) {
    if (spec.noTime) throw new Error('A triathlon print always has its times');
    tri = triFrames(doc, ab);
    if (tri.missing.length) throw new Error('Triathlon ' + spec.size + ' artboard: could not find the ' + tri.missing.join(', '));
  }
  var got = collectFrames(doc, ab, spec.race, tri ? tri.all : null);
  var frames = got.frames, dupes = got.dupes, hiddenLeftovers = got.leftovers.length;
  for (var hl = 0; hl < got.leftovers.length; hl++) got.leftovers[hl].hidden = true;
  var missing = [];
  var need = swappedNoTime ? ['name', 'bib'] : ['name', 'bib', 'time'];
  for (var n = 0; n < need.length; n++) if (!frames[need[n]]) missing.push(need[n]);
  if (missing.length) throw new Error('Could not find the ' + missing.join(', ') + ' frame' + (missing.length > 1 ? 's' : '') + ' on the ' + spec.size + ' artboard');
  if (dupes.length) throw new Error('More than one ' + dupes.join(', ') + ' frame on the ' + spec.size + ' artboard');

  var notes = [];
  if (hiddenLeftovers) notes.push(hiddenLeftovers + ' leftover text frame' + (hiddenLeftovers > 1 ? 's' : '') + ' hidden');

  stage = 'leftovers';
  // Leftover images from a past order: a customer photo left inside the photo
  // window, or anywhere else outside the locked artwork. Document-wide, so an
  // image nested in a clipping group is found too; a leftover inside the
  // window would sit on top of the new photo and print another customer.
  var removed = 0;
  function layerNameOf(item) { var p = item; while (p && p.typename != 'Layer') p = p.parent; while (p && p.parent && p.parent.typename == 'Layer') p = p.parent; return p ? p.name : ''; }
  function strip(coll) {
    for (var i = coll.length - 1; i >= 0; i--) {
      var it = coll[i], ln = layerNameOf(it);
      if (ln == 'LOCKED ASSETS' || ln == 'GUIDES') continue;
      // A photo left in the photo window is replaced below, after the new one is
      // in: taking it out first leaves a one-item clipping group that Illustrator
      // releases, and the window with it.
      if (ln == 'PHOTO LAYER') continue;
      try { var L3 = doc.layers.getByName(ln); if (L3.locked) L3.locked = false; } catch (e) {}
      try { if (it.parent && it.parent.typename == 'GroupItem' && it.parent.locked) it.parent.locked = false; } catch (e) {}
      try { it.remove(); removed++; } catch (e) {}
    }
  }
  strip(doc.placedItems);
  strip(doc.rasterItems);
  if (removed) notes.push(removed + ' leftover image' + (removed > 1 ? 's' : '') + ' removed');

  stage = 'links';
  // A linked image whose file is not on this Mac exports as Illustrator's 72 ppi
  // preview: BULK-0001's logo printed blurry that way (2026-11-17). Refuse it.
  for (var li = 0; li < doc.placedItems.length; li++) {
    var lnk = doc.placedItems[li], lnkLayer = layerNameOf(lnk);
    if (lnkLayer == 'PHOTO LAYER') continue;
    var gone = false; try { gone = !lnk.file || !lnk.file.exists; } catch (e) { gone = true; }
    if (gone) throw new Error('an image on ' + lnkLayer + ' is linked to a file this Mac does not have and would print blurry; embed it in the production file and upload it again');
  }

  stage = 'margin';
  var margins = marginsOf(doc, ab), marginL = margins.left, marginR = margins.right;

  stage = 'name';
  // Name: a long name must not be clipped, and the name must not move. The box
  // grows away from its anchored edge, which depends on how the text is aligned:
  // right-aligned text (the standard prints) grows leftward to the left margin,
  // left-aligned text (World Majors) grows rightward to the right margin,
  // centered text is not widened at all. If it still does not fit, the size
  // steps down. Afterwards the anchored edge is checked and a moved name fails
  // the render rather than printing in the wrong place.
  var nameFrame = frames.name;
  var before = nameFrame.geometricBounds;
  var align = alignmentOf(nameFrame), anchorRight = align == 'right', anchorLeft = align == 'left';
  // With a photo, the photo window is a wall too: a long name grows only to
  // a gap short of it (Detroit's Motor City half ran "Vishnuchakravarthi"
  // over the photo, because the left margin guide is under the window).
  var NAME_GAP = 9; // 1/8"
  var photoRect = null;
  if (spec.photo) { var pwName = photoWindowOf(doc, ab); if (pwName) photoRect = pwName.clip.geometricBounds; }
  var photoInRow = photoRect && before[1] > photoRect[3] && before[3] < photoRect[1];
  if (photoInRow) {
    if (anchorRight && photoRect[2] <= before[2]) marginL = Math.max(marginL === null ? -1e9 : marginL, photoRect[2] + NAME_GAP);
    if (anchorLeft && photoRect[0] >= before[0]) marginR = Math.min(marginR === null ? 1e9 : marginR, photoRect[0] - NAME_GAP);
  }
  if (nameFrame.kind == TextType.AREATEXT) {
    var tp = nameFrame.textPath;
    if (anchorRight && marginL !== null && (tp.left > marginL || (photoInRow && tp.left < marginL))) { tp.width = tp.width + (tp.left - marginL); tp.left = marginL; }
    else if (anchorLeft && marginR !== null && (tp.left + tp.width < marginR || (photoInRow && tp.left + tp.width > marginR))) { tp.width = marginR - tp.left; }
  }
  nameFrame.contents = spec.name;
  if (nameFrame.kind == TextType.AREATEXT) {
    var orig = nameFrame.textRange.characterAttributes.size, tries = 0;
    while (tries < 8) {
      var laid = 0; for (var li = 0; li < nameFrame.lines.length; li++) laid += nameFrame.lines[li].characters.length;
      if (laid >= nameFrame.textRange.characters.length && nameFrame.lines.length <= 1) break;
      nameFrame.textRange.characterAttributes.size = nameFrame.textRange.characterAttributes.size - orig * 0.05; tries++;
    }
    if (tries) notes.push('name shrunk ' + tries + ' step' + (tries == 1 ? '' : 's'));
    var after = nameFrame.geometricBounds;
    if (anchorRight && Math.abs(after[2] - before[2]) > 0.5) throw new Error('The name moved: its right edge shifted ' + Math.round(after[2] - before[2]) + 'pt');
    if (anchorLeft && Math.abs(after[0] - before[0]) > 0.5) throw new Error('The name moved: its left edge shifted ' + Math.round(after[0] - before[0]) + 'pt');
    if (!anchorLeft && !anchorRight && Math.abs((after[0] + after[2]) - (before[0] + before[2])) > 1) throw new Error('The name moved: its center shifted');
    if (Math.abs(after[1] - before[1]) > 0.5) throw new Error('The name moved vertically by ' + Math.round(after[1] - before[1]) + 'pt');
  }
  // The letters themselves, not the box, must clear the photo window. Point
  // text has no box to narrow, so this is its only guard. Step down the same
  // 5% as above; a name that still touches the photo fails the render.
  if (photoInRow) {
    var size0 = nameFrame.textRange.characterAttributes.size, steps = 0;
    while (overlaps(inkBounds(nameFrame), photoRect, NAME_GAP) && steps < 10) {
      nameFrame.textRange.characterAttributes.size = nameFrame.textRange.characterAttributes.size - size0 * 0.05; steps++;
    }
    if (overlaps(inkBounds(nameFrame), photoRect, NAME_GAP)) throw new Error('The name runs into the photo even at ' + Math.round(nameFrame.textRange.characterAttributes.size) + 'pt');
    if (steps) notes.push('name shrunk ' + steps + ' more to clear the photo');
  }

  stage = 'fields';
  frames.bib.contents = String(spec.bib);
  if (frames.date) frames.date.contents = spec.date;
  if (frames.year) frames.year.contents = String(spec.raceYear);

  // Weather keeps the frame's own break between condition and temperature ("Sunny" / "63°",
  // or "Cloudy " / "45°" where the designer left a space before the break).
  function fillWeather(fr) {
    var w = String(fr.contents), wb = w.indexOf(BREAK);
    var wSep = wb >= 0 ? w.substring(0, wb).replace(/^\S.*?(\s*)$/, '$1') + BREAK : ' ';
    fr.contents = spec.condition + wSep + String(spec.temp).replace(/F$/, '');
  }
  if (frames.weather) fillWeather(frames.weather);

  if (spec.noTime && swappedNoTime) {
    if (frames.time) frames.time.hidden = true;
    if (frames.pace) frames.pace.hidden = true;
    notes.push('no time (NO TIME layer)');
  } else if (spec.noTime) {
    // Never shift text to close the gap. Either pace is last in its row and hides cleanly, or the
    // designer's NO TIME layer replaces the row (lib.jsx noTimeFrames), or the render stops.
    var nt = noTimeFrames(doc, ab);
    if (nt) {
      if (nt.layer.locked) nt.layer.locked = false;
      nt.layer.visible = true;
      for (var nk in nt.frames) {
        if (frames[nk]) frames[nk].hidden = true;
        if (nk == 'weather') fillWeather(nt.frames[nk]);
        else if (nk == 'date') nt.frames[nk].contents = spec.date;
        else if (nk == 'year') nt.frames[nk].contents = String(spec.raceYear);
        else if (nk == 'bib') nt.frames[nk].contents = String(spec.bib);
      }
      notes.push('no time (NO TIME layout)');
    } else if (paceInRow(frames)) {
      throw new Error('No-time order, and this design has details to the right of pace. Hiding pace would leave a gap and the script will not move text. Add a NO TIME layer to the template (see worker/README.md).');
    } else {
      notes.push('no time');
    }
    frames.time.hidden = true; if (frames.pace) frames.pace.hidden = true;
  } else {
    frames.time.contents = spec.time;
    if (frames.pace) {
      // Pace keeps whatever follows the number in this template: " / mi" on one line or a break then "/ mi".
      var pc = String(frames.pace.contents), tail = pc.replace(/^\s*\d{1,2}:\d{2}/, '');
      if (!/\/\s*mi/i.test(tail)) tail = ' / mi';
      frames.pace.contents = spec.pace + tail;
    }
  }

  if (tri) {
    stage = 'triathlon';
    for (var lg = 0; lg < TRI_LEGS.length; lg++) {
      var legName = TRI_LEGS[lg], legTime = spec[legName + 'Time'], legDist = spec[legName + 'Distance'];
      if (!legTime || !legDist) throw new Error('No ' + legName + ' time or distance on the order');
      tri.legs[legName].time.contents = legTime;
      tri.legs[legName].dist.contents = legDist;
    }
    // The title: one line per frame, top to bottom ("IRONMAN 70.3" / "North
    // Carolina"); a design with one title frame takes both on two lines.
    var lines = [spec.title1 || '', spec.title2 || ''];
    if (!lines[0]) throw new Error('No race title for the print');
    if (tri.title.length == 1) tri.title[0].contents = lines[1] ? lines[0] + BREAK + lines[1] : lines[0];
    else {
      tri.title[0].contents = lines[0];
      tri.title[1].contents = lines[1];
      for (var tx = 2; tx < tri.title.length; tx++) tri.title[tx].hidden = true;
    }
    // Text is never shrunk or moved to make a title fit: a title whose letters
    // run past the right margin guide (or a half inch from the edge) stops the
    // render, and the print is made by hand.
    var titleRight = marginsOf(doc, ab).right;
    if (titleRight === null) titleRight = ab[2] - 36;
    for (var w = 0; w < tri.title.length; w++) {
      if (!tri.title[w].hidden && inkBounds(tri.title[w])[2] > titleRight) throw new Error('The race title "' + String(tri.title[w].contents).replace(/\u0003/g, ' ') + '" runs past the margin on the ' + spec.size + ' artboard; make this print by hand');
    }
    notes.push('triathlon');
  }

  stage = 'photo';
  // Photo: the clipped square window on PHOTO LAYER (lib.jsx photoWindowOf). The customer cropped
  // the photo 1:1, so it goes in at the clipping path's exact bounds; anything else in the window is
  // a past order's photo and goes. No photo on the order: the whole layer is hidden.
  var photoLayer = null; try { photoLayer = doc.layers.getByName('PHOTO LAYER'); } catch (e) {}
  if (spec.photo) {
    if (!photoLayer) throw new Error('This design has no photo window, but the order has a photo');
    photoLayer.visible = true; photoLayer.locked = false;
    var pw = photoWindowOf(doc, ab);
    if (!pw) throw new Error('No photo window on the ' + spec.size + ' artboard');
    var group = pw.group, clip = pw.clip;
    // Everything in the window but the clipping path is placeholder art and is hidden, nested
    // groups and compound paths included: Ann Arbor's 8x10 keeps its orange square inside a
    // sub-group, which printed over the photo when only direct paths were hidden.
    for (var q2 = 0; q2 < group.pageItems.length; q2++) {
      var it2 = group.pageItems[q2];
      if (it2.typename == 'PathItem' && it2.clipping) continue;
      if (it2.typename == 'PlacedItem' || it2.typename == 'RasterItem') continue; // old photos, removed below
      it2.hidden = true;
    }
    var cb = clip.geometricBounds;
    doc.activeLayer = photoLayer; group.locked = false; group.hidden = false;
    var img = group.placedItems.add();
    img.file = new File(spec.photo);
    img.width = cb[2] - cb[0]; img.height = cb[1] - cb[3];
    img.position = [cb[0], cb[1]];
    img.move(group, ElementPlacement.PLACEATEND);
    var old = 0;
    for (var ri = group.rasterItems.length - 1; ri >= 0; ri--) { group.rasterItems[ri].remove(); old++; }
    for (var pi2 = group.placedItems.length - 1; pi2 >= 0; pi2--) {
      var ours = false;
      try { ours = group.placedItems[pi2].file.fsName == img.file.fsName; } catch (e) { ours = false; }
      if (!ours) { group.placedItems[pi2].remove(); old++; }
    }
    if (old) notes.push(old + ' old photo' + (old > 1 ? 's' : '') + ' removed');
    img.embed();
    notes.push('photo placed');
  } else if (photoLayer) {
    photoLayer.visible = false;
  }

  stage = 'export';
  doc.artboards.setActiveArtboardIndex(abIndex);
  var pdf = new PDFSaveOptions();
  pdf.pDFPreset = job.preset || 'TRACKSTAR DEFAULT';
  pdf.saveMultipleArtboards = true;
  pdf.artboardRange = String(abIndex + 1);
  pdf.preserveEditability = false;
  pdf.bleedLink = false;
  pdf.bleedOffsetRect = [18, 18, 18, 18];
  doc.saveAs(new File(job.out + '.pdf'), pdf);

  var png = new ExportOptionsPNG24();
  png.artBoardClipping = true; png.antiAliasing = true; png.horizontalScale = 100; png.verticalScale = 100;
  doc.exportFile(new File(job.out + '.png'), ExportType.PNG24, png);

  doc.close(SaveOptions.DONOTSAVECHANGES);
  writeResult({ ok: true, notes: notes.join('; ') });
} catch (err) {
  try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
  writeResult({ ok: false, error: '[' + stage + '] ' + String(err.message || err) });
}
