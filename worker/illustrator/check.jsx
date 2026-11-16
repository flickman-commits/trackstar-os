// Template check: read a production file the way render.jsx will, and report what it finds,
// so a race can be mapped with its eyes open. Writes <this folder>/check-result.json.
// Input: <this folder>/check-input.json  { files: [{ key, path, race, artboard }] }
#target illustrator
#include "lib.jsx"

var HERE = new File($.fileName).parent;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
function readJson(f) { f.encoding = 'UTF-8'; f.open('r'); var s = f.read(); f.close(); return eval('(' + s + ')'); }
function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\x03]/g, '|') + '"'; }
function r1(n) { return Math.round(n * 10) / 10; }

var input = readJson(new File(HERE + '/check-input.json'));
var reports = [];
for (var i = 0; i < input.files.length; i++) {
  var f = input.files[i], doc = null, out = [];
  out.push('"key":' + q(f.key));
  try {
    doc = app.open(new File(f.path));
    out.push('"colorSpace":' + q(doc.documentColorSpace));
    var layerNames = [];
    for (var l = 0; l < doc.layers.length; l++) layerNames.push(q(doc.layers[l].name) + ':' + (doc.layers[l].locked ? '"locked"' : '"open"'));
    out.push('"layers":{' + layerNames.join(',') + '}');
    // images anywhere outside the locked artwork
    var stray = 0;
    function layerNameOf(item) { var p = item; while (p && p.typename != 'Layer') p = p.parent; while (p && p.parent && p.parent.typename == 'Layer') p = p.parent; return p ? p.name : ''; }
    for (var pi = 0; pi < doc.placedItems.length; pi++) { var ln = layerNameOf(doc.placedItems[pi]); if (ln != 'LOCKED ASSETS' && ln != 'GUIDES') stray++; }
    for (var ri = 0; ri < doc.rasterItems.length; ri++) { var ln2 = layerNameOf(doc.rasterItems[ri]); if (ln2 != 'LOCKED ASSETS' && ln2 != 'GUIDES') stray++; }
    out.push('"strayImages":' + stray);
    // Checked as an order with a time prints: the NO TIME layer off, as render.jsx does.
    var ntOff = noTimeLayerOf(doc);
    if (ntOff && ntOff.visible) { if (ntOff.locked) ntOff.locked = false; ntOff.visible = false; }
    var boards = [];
    for (var a = 0; a < doc.artboards.length; a++) {
      var abName = doc.artboards[a].name, size = sizeKey(abName), ab = doc.artboards[a].artboardRect;
      var rules = { artboard: f.artboard, artboardExclude: f.artboardExclude, photoArtboard: f.photoArtboard };
      var chosen = size && (pickArtboard(doc, size, rules, false) == a || (rules.photoArtboard && pickArtboard(doc, size, rules, true) == a));
      var b = ['"name":' + q(abName), '"size":' + q(size), '"inches":' + q(r1((ab[2]-ab[0])/72) + 'x' + r1((ab[1]-ab[3])/72)), '"chosen":' + chosen, '"photoVariant":' + (rules.photoArtboard ? (abName.toLowerCase().indexOf(String(rules.photoArtboard).toLowerCase()) >= 0) : false)];
      if (chosen && size) {
        var tri = f.triathlon ? triFrames(doc, ab) : null;
        if (tri) {
          var tt = []; for (var ti = 0; ti < tri.title.length; ti++) tt.push(q(tri.title[ti].contents));
          var tl = []; for (var lk in tri.legs) tl.push(q(lk) + ':{"time":' + q(tri.legs[lk].time.contents) + ',"dist":' + q(tri.legs[lk].dist.contents) + '}');
          var tm = []; for (var mi = 0; mi < tri.missing.length; mi++) tm.push(q(tri.missing[mi]));
          b.push('"triathlon":{"title":[' + tt.join(',') + '],"legs":{' + tl.join(',') + '},"missing":[' + tm.join(',') + ']}');
        }
        var got = collectFrames(doc, ab, f.race, tri ? tri.all : null);
        var kinds = [];
        for (var k in got.frames) {
          var fr = got.frames[k];
          kinds.push(q(k) + ':{"text":' + q(fr.contents) + ',"align":' + q(alignmentOf(fr)) + ',"placeholder":' + isPlaceholder(k, fr.contents) + ',"kind":' + q(fr.kind == TextType.AREATEXT ? 'area' : fr.kind == TextType.POINTTEXT ? 'point' : 'path') + ',"layer":' + q(layerNameOf(fr)) + '}');
        }
        b.push('"fields":{' + kinds.join(',') + '}');
        var lo = []; for (var x = 0; x < got.leftovers.length; x++) lo.push(q(got.leftovers[x].contents));
        b.push('"leftoverText":[' + lo.join(',') + ']');
        var du = []; for (var y = 0; y < got.dupes.length; y++) du.push(q(got.dupes[y]));
        b.push('"ambiguous":[' + du.join(',') + ']');
        b.push('"paceInRow":' + paceInRow(got.frames));
        var ntf = noTimeFrames(doc, ab), ntk = [];
        if (ntf) for (var nk in ntf.frames) ntk.push(q(nk));
        b.push('"noTimeLayout":[' + ntk.join(',') + ']');
        var m = marginsOf(doc, ab);
        b.push('"margins":{"left":' + (m.left === null ? 'null' : r1(m.left - ab[0])) + ',"right":' + (m.right === null ? 'null' : r1(ab[2] - m.right)) + '}');
        var pw = photoWindowOf(doc, ab);
        var pwRaster = 0; if (pw) { pwRaster = pw.group.rasterItems.length + pw.group.placedItems.length; }
        b.push('"photoWindow":' + (pw ? '{"present":true,"holdsImage":' + (pwRaster > 0) + '}' : '{"present":false}'));
      }
      boards.push('{' + b.join(',') + '}');
    }
    out.push('"artboards":[' + boards.join(',') + ']');
    doc.close(SaveOptions.DONOTSAVECHANGES);
  } catch (e) {
    out.push('"error":' + q(e.message));
    try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
  }
  reports.push('{' + out.join(',') + '}');
}
var res = new File(HERE + '/check-result.json'); res.encoding = 'UTF-8'; res.open('w'); res.write('[' + reports.join(',') + ']'); res.close();
