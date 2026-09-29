/* BASE Health Athlete Report: the branded PDF, built on the device.
   Recreates the WeasyPrint designs from report_pdf.py (screening, hamstring, ACL) as a list of
   vector drawing commands, which are then written two ways from the same layout:
     toPdf()  -> a real PDF file (jsPDF, embedded fonts, selectable text)
     toSvg()  -> SVG pages for the on-screen preview
   Browser: window.BHReport   Node (tests): require('./report.js')(engine, fonts, jsPDF) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.BHReport = factory(root.BHEngine, root.BH_REPORT_FONTS, root.jspdf && root.jspdf.jsPDF);
})(typeof self !== 'undefined' ? self : this, function (E, FONTS, JsPDF) {
  'use strict';

  // ------------------------------------------------------------------ units & page
  var MM_PER_PX = 25.4 / 96;                       // CSS px -> mm (WeasyPrint's 96 dpi)
  function px(v) { return v * MM_PER_PX; }
  function fs(v) { return v * 0.75; }              // CSS px font size -> pt
  var PAGE_W = 210, PAGE_H = 297, ML = 12, MT = 13, MB = 13;
  var CW = PAGE_W - 2 * ML;                         // content width, 186 mm
  var CW_PX = CW / MM_PER_PX;

  // colours from report_pdf.py
  var C = {
    BLUE: '#2FA8A0', BLUEINK: '#1D6E68', DARK: '#1B2430', BLACK: '#111418', INK: '#22262B',
    MUTE: '#6B7280', LINE: '#E4E7EA', GBAND: '#374957', G: '#2E7D32', A: '#DD8800', R: '#C62828',
    WHITE: '#FFFFFF', NA: '#999999'
  };
  var COL = { Green: C.G, Amber: C.A, Red: C.R };

  // ------------------------------------------------------------------ fonts & text measuring
  var ASC = 1854 / 2048, DESC = 434 / 2048, LH_NORMAL = (1854 + 434 + 67) / 2048;
  var MET = {}, FAMILY = {};
  Object.keys(FONTS.metrics).forEach(function (k) {
    var map = new Map();
    FONTS.metrics[k].w.split(',').forEach(function (p) {
      var i = p.indexOf(':');
      map.set(parseInt(p.slice(0, i), 16), +p.slice(i + 1));
    });
    MET[k] = { upm: FONTS.metrics[k].upm, w: map };
    FAMILY[k] = FONTS.faces[k].family;
  });

  function faceFor(style, cp) {
    if (MET[style].w.has(cp)) return style;
    var sym = style === 'bold' ? 'symBold' : 'sym';
    if (MET[sym].w.has(cp)) return sym;
    return null;
  }
  function clean(s) {                              // HTML-style whitespace collapsing
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFC');
    return s.replace(/\s+/g, ' ');
  }
  // split text into runs that share a font; unsupported characters become '?'
  function runs(str, style) {
    var out = [], cur = null;
    for (var ch of str) {
      var cp = ch.codePointAt(0), f = faceFor(style, cp);
      if (!f) { ch = '?'; f = style; }
      if (cur && cur.face === f) cur.text += ch;
      else { cur = { face: f, text: ch }; out.push(cur); }
    }
    return out;
  }
  function charW(face, ch, size) {                 // mm
    return MET[face].w.get(ch.codePointAt(0)) / MET[face].upm * size * 25.4 / 72;
  }
  function width(str, style, size, cs) {
    cs = cs || 0;
    var w = 0;
    runs(str, style).forEach(function (r) {
      for (var ch of r.text) w += charW(r.face, ch, size) + cs;
    });
    return w;
  }
  // greedy word wrap to maxW (mm); very long words are split
  function wrap(str, style, size, maxW) {
    str = clean(str).trim();
    if (!str) return [''];
    if (width(str, style, size) <= maxW) return [str];
    var lines = [], line = '';
    str.split(' ').forEach(function (word) {
      var cand = line ? line + ' ' + word : word;
      if (width(cand, style, size) <= maxW) { line = cand; return; }
      if (line) lines.push(line);
      line = '';
      if (width(word, style, size) <= maxW) { line = word; return; }
      var chunk = '';
      for (var ch of word) {
        if (chunk && width(chunk + ch, style, size) > maxW) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    });
    if (line) lines.push(line);
    return lines;
  }
  // baseline of a line box that starts at top (mm) for a CSS font size in px and line-height factor
  function baseline(top, fontPx, lh) {
    return top + px(((lh || LH_NORMAL) - (ASC + DESC)) / 2 * fontPx + ASC * fontPx);
  }
  function lineH(fontPx, lh) { return px(fontPx * (lh || LH_NORMAL)); }

  // ------------------------------------------------------------------ drawing list
  function Doc() { this.pages = []; this.newPage(); }
  Doc.prototype.newPage = function () { this.page = { items: [] }; this.pages.push(this.page); this.y = MT; };
  Doc.prototype.add = function (it) { this.page.items.push(it); return it; };
  Doc.prototype.fits = function (h) { return this.y + h <= PAGE_H - MB + 0.01; };
  Doc.prototype.ensure = function (h) { if (!this.fits(h) && this.y > MT + 0.5) this.newPage(); };
  Doc.prototype.text = function (s, x, y, o) {
    s = clean(s);
    var cs = o.cs || 0, w = width(s, o.style, o.size, cs);
    var x0 = o.align === 'right' ? x - w : (o.align === 'center' ? x - w / 2 : x);
    this.add({ t: 'text', s: s, x: x0, y: y, style: o.style, size: o.size, color: o.color, cs: cs });
    return w;
  };
  Doc.prototype.rect = function (x, y, w, h, o) {
    return this.add({ t: 'rect', x: x, y: y, w: w, h: h, r: o.r || 0, fill: o.fill || null, stroke: o.stroke || null, lw: o.lw || 0 });
  };
  Doc.prototype.poly = function (pts, o) {
    return this.add({ t: 'poly', pts: pts, fill: o.fill || null, stroke: o.stroke || null, lw: o.lw || 0, dash: o.dash || null, fillOpacity: o.fillOpacity == null ? 1 : o.fillOpacity, closed: o.closed !== false });
  };
  Doc.prototype.line = function (x1, y1, x2, y2, o) {
    return this.add({ t: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: o.stroke, lw: o.lw, dash: o.dash || null });
  };
  Doc.prototype.circle = function (cx, cy, r, o) {
    return this.add({ t: 'circle', cx: cx, cy: cy, r: r, fill: o.fill || null, stroke: o.stroke || null, lw: o.lw || 0 });
  };

  // pill shape as a polygon, clipped to [x0, x1] (used for the traffic-light meters)
  function pillPolygon(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    var pts = [], i, a, N = 10;
    for (i = 0; i <= N; i++) { a = -Math.PI / 2 + Math.PI * i / N; pts.push([x + w - r + r * Math.cos(a), y + r + r * Math.sin(a) + (i > N / 2 ? h - 2 * r : 0)]); }
    for (i = 0; i <= N; i++) { a = Math.PI / 2 + Math.PI * i / N; pts.push([x + r + r * Math.cos(a), y + h - r + r * Math.sin(a) - (i > N / 2 ? h - 2 * r : 0)]); }
    return pts;
  }
  function clipX(poly, xmin, xmax) {
    function clip(pts, keep, cut) {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], q = pts[(i + 1) % pts.length], pin = keep(p), qin = keep(q);
        if (pin) out.push(p);
        if (pin !== qin) { var t = (cut - p[0]) / (q[0] - p[0]); out.push([cut, p[1] + t * (q[1] - p[1])]); }
      }
      return out;
    }
    var a = clip(poly, function (p) { return p[0] >= xmin; }, xmin);
    return a.length ? clip(a, function (p) { return p[0] <= xmax; }, xmax) : a;
  }

  // BASE Health logo on a dark ground: light disc with the chevron cut in the ground colour
  function logo(doc, x, y, size, disc, ground) {
    var u = size / 96;
    doc.circle(x + 48 * u, y + 48 * u, 39 * u, { fill: disc });
    var pts = [[25, 61.5], [44.3, 29.6]];
    for (var i = 1; i < 8; i++) {                  // rounded apex (quadratic curve)
      var t = i / 8, mt = 1 - t;
      pts.push([mt * mt * 44.3 + 2 * mt * t * 48 + t * t * 51.7, mt * mt * 29.6 + 2 * mt * t * 26 + t * t * 29.6]);
    }
    pts.push([51.7, 29.6], [71, 61.5], [64, 61.5], [48, 37.2], [32, 61.5]);
    doc.poly(pts.map(function (p) { return [x + p[0] * u, y + p[1] * u]; }), { fill: ground });
  }

  // ------------------------------------------------------------------ report blocks
  function header(doc, title, sub) {
    var top = doc.y, H = px(66);
    doc.rect(ML, top, CW, H, { r: px(6), fill: C.BLUE });
    doc.rect(ML, top, CW, H - px(4), { r: [px(6), px(6), px(2.5), px(2.5)], fill: C.DARK });
    var inner = top + px(11);
    logo(doc, ML + px(15), inner, px(40), '#F2F4F5', C.DARK);
    var nameX = ML + px(15 + 40 + 11), nameTop = inner + px(5.75);
    var bl = baseline(nameTop, 18, 1);
    var w = doc.text('BASE ', nameX, bl, { style: 'bold', size: fs(18), color: C.WHITE, cs: px(1.5) });
    doc.text('HEALTH', nameX + w, bl, { style: 'bold', size: fs(18), color: C.BLUE, cs: px(1.5) });
    doc.text('NOOSA', nameX, baseline(nameTop + px(21), 7.5, 1), { style: 'bold', size: fs(7.5), color: '#9AA3AD', cs: px(3) });
    var right = ML + CW - px(15), tTop = inner + px(5.2);
    doc.text(title, right, baseline(tTop, 15), { style: 'bold', size: fs(15), color: C.WHITE, align: 'right' });
    doc.text(sub, right, baseline(tTop + px(19.25), 9), { style: 'bold', size: fs(9), color: C.BLUE, align: 'right' });
    doc.y = top + H;
  }

  function dash(v) { v = clean(v).trim(); return v ? v : '—'; }

  // label/value pairs that wrap like the .meta flex row
  function meta(doc, pairs) {
    var x0 = ML + px(2), maxW = CW - px(4), gapX = px(22), gapY = px(4), lh = lineH(10);
    var lines = [[]], x = 0;
    pairs.forEach(function (p) {
      var label = p[0], value = dash(p[1]);
      var lw = width(label + ' ', 'bold', fs(10));
      var vw = width(value, 'regular', fs(10));
      var item = { label: label, value: value, lw: lw, w: lw + vw, vlines: null };
      if (item.w > maxW) {                          // long notes: wrap inside the row
        item.vlines = wrap(value, 'regular', fs(10), maxW - lw);
        item.w = maxW;
      }
      if (lines[lines.length - 1].length && x + gapX + item.w > maxW) { lines.push([]); x = 0; }
      var line = lines[lines.length - 1];
      item.x = line.length ? x + gapX : 0;
      x = item.x + item.w;
      line.push(item);
    });
    var y = doc.y + px(10);
    lines.forEach(function (line) {
      var rows = 1;
      line.forEach(function (it) {
        var bl = baseline(y, 10);
        doc.text(it.label, x0 + it.x, bl, { style: 'bold', size: fs(10), color: C.BLUE });
        (it.vlines || [it.value]).forEach(function (v, i) {
          doc.text(v, x0 + it.x + it.lw, bl + i * lh, { style: 'regular', size: fs(10), color: C.INK });
        });
        rows = Math.max(rows, (it.vlines || [1]).length);
      });
      y += rows * lh + gapY;
    });
    doc.y = y - gapY + px(10);
  }

  function chip(doc, text, x, midY, color, o) {   // x = left edge (or right edge when o.right)
    o = o || {};
    var size = o.size || 9, padX = o.padX == null ? 7 : o.padX, padY = o.padY == null ? 1 : o.padY;
    var tw = width(text, 'bold', fs(size));
    var w = tw + px(2 * padX), h = lineH(size) + px(2 * padY);
    var left = o.right ? x - w : x;
    doc.rect(left, midY - h / 2, w, h, { r: px(o.radius || 3), fill: color });
    doc.text(text, left + px(padX), baseline(midY - h / 2 + px(padY), size), { style: 'bold', size: fs(size), color: C.WHITE });
    return w;
  }

  // "Compared against [pill]"  ...  [Green: n] [Amber: n] [Red: n]
  function band(doc, lead, pillText, counts) {
    var top = doc.y, h = px(19.5), mid = top + h / 2;
    var x = ML;
    var lw = doc.text(lead + ' ', x, baseline(mid - lineH(10) / 2, 10), { style: 'regular', size: fs(10), color: C.INK });
    var ptw = width(pillText, 'bold', fs(10));
    var pw = ptw + px(18 + 2), ph = lineH(10) + px(6 + 2);
    doc.rect(x + lw, mid - ph / 2, pw, ph, { r: px(4), fill: '#EAF1F9', stroke: '#BBD3EA', lw: px(1) });
    doc.text(pillText, x + lw + px(10), baseline(mid - lineH(10) / 2, 10), { style: 'bold', size: fs(10), color: C.BLUEINK });
    var right = ML + CW;
    for (var i = counts.length - 1; i >= 0; i--) {
      var w = chip(doc, counts[i][0], right, mid, counts[i][1], { size: 10, padX: 9, padY: 2, right: true });
      right -= w + px(5);
    }
    doc.y = top + h + px(4);
  }

  function section(doc, title, opts) {
    opts = opts || {};
    var h = px(12) + lineH(11) + px(3 + 2) + px(5);
    if (opts.newPage) { if (doc.y > MT + 0.5) doc.newPage(); }
    else doc.ensure(h + (opts.keep || 0));
    var top = doc.y + (doc.y > MT + 0.5 ? px(12) : 0);
    doc.text(title, ML + px(2), baseline(top, 11), { style: 'bold', size: fs(11), color: C.BLACK, cs: px(0.5) });
    var ly = top + lineH(11) + px(3) + px(1);
    doc.line(ML + px(2), ly, ML + CW - px(2), ly, { stroke: C.BLUE, lw: px(2) });
    doc.y = ly + px(1) + px(5);
  }

  function scorecard(doc, cards) {
    if (!cards.length) return;
    var gap = 6, minW = 108, perLine = Math.max(1, Math.floor((CW_PX + gap) / (minW + gap)));
    var lines = [];
    for (var i = 0; i < cards.length; i += perLine) lines.push(cards.slice(i, i + perLine));
    var cardH = px(38.1);
    doc.y += px(2);
    lines.forEach(function (line) {
      doc.ensure(cardH);
      var w = (CW_PX - (line.length - 1) * gap) / line.length, x = ML;
      line.forEach(function (c) {
        var col = COL[c.worst], top = doc.y;
        doc.rect(x, top, px(w), cardH, { r: px(5), fill: C.WHITE, stroke: C.LINE, lw: px(1) });
        doc.rect(x + px(0.5), top + px(0.5), px(w - 1), px(5.5), { r: [px(4.5), px(4.5), 0, 0], fill: col });
        var bt = top + px(1 + 5 + 4);
        doc.text(c.worst, x + px(w - 1 - 8), baseline(bt, 9), { style: 'bold', size: fs(9), color: col, align: 'right' });
        doc.text(c.domain, x + px(1 + 8), baseline(bt, 9.5), { style: 'bold', size: fs(9.5), color: C.BLACK });
        doc.text(c.green + '/' + c.total + ' on target', x + px(1 + 8), baseline(bt + lineH(9.5) + px(1), 8), { style: 'regular', size: fs(8), color: C.MUTE });
        x += px(w + gap);
      });
      doc.y += cardH + px(gap);
    });
    doc.y += px(2 - gap);
  }

  function radar(doc, spokes, quadNote) {
    if (spokes.length < 3) return false;
    var u = CW / 480, H = 300 * u, n = spokes.length;
    section(doc, 'Athlete profile — key components', { keep: H + px(14) });
    var ox = ML, oy = doc.y, cx = 240, cy = 150, Rmax = 98, CAP = 1.5;
    function pt(score, i) {
      var ang = (-90 + i * 360 / n) * Math.PI / 180, rr = Math.min(score, CAP) / CAP * Rmax;
      return [ox + (cx + rr * Math.cos(ang)) * u, oy + (cy + rr * Math.sin(ang)) * u];
    }
    function ring(s) { var a = []; for (var i = 0; i < n; i++) a.push(pt(s, i)); return a; }
    [0.5, 1.0, 1.5].forEach(function (s) {
      if (s === 1.0) doc.poly(ring(s), { stroke: C.G, lw: 1.4 * u, dash: [4 * u, 3 * u] });
      else doc.poly(ring(s), { stroke: '#D7DCE5', lw: 1 * u });
    });
    spokes.forEach(function (sp, i) {
      var e = pt(CAP, i);
      doc.line(ox + cx * u, oy + cy * u, e[0], e[1], { stroke: '#D7DCE5', lw: 1 * u });
      var l = pt(CAP + 0.30, i);
      var ca = Math.cos((-90 + i * 360 / n) * Math.PI / 180);
      var anchor = Math.abs(ca) < 0.3 ? 'center' : (ca > 0 ? 'left' : 'right');
      var vtxt = E.fmt(sp.value) + (sp.unit ? ' ' + sp.unit : '');
      var size = 9 * u * 72 / 25.4;               // SVG user units -> pt
      doc.text(sp.label, l[0], l[1], { style: 'bold', size: size, color: C.BLACK, align: anchor });
      doc.text(vtxt, l[0], l[1] + 11 * u, { style: 'regular', size: 8 * u * 72 / 25.4, color: C.MUTE, align: anchor });
    });
    var poly = spokes.map(function (sp, i) { return pt(sp.score, i); });
    doc.poly(poly, { fill: C.BLUE, fillOpacity: 0.18 });
    doc.poly(poly, { stroke: C.BLUE, lw: 2 * u });
    spokes.forEach(function (sp, i) {
      var p = pt(sp.score, i);
      doc.circle(p[0], p[1], 3.2 * u, { fill: COL[sp.status] || C.NA, stroke: C.WHITE, lw: 1 * u });
    });
    doc.y = oy + H + px(2);
    doc.text('Each axis = result vs the athlete’s age/sex norm target (dashed green ring). Dots show status.' + (quadNote ? ' Quad ISO @ 60° uses a placeholder norm.' : ''),
      ML + CW / 2, baseline(doc.y, 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE, align: 'center' });
    doc.y += lineH(7.5);
    return true;
  }

  function priorities(doc, prios, emptyText) {
    if (!prios.length) {
      var h0 = lineH(10) + px(9);
      doc.ensure(h0);
      doc.text(emptyText || '✓ Nothing flagged — all tested metrics on target.', ML + px(6), baseline(doc.y + px(4), 10), { style: 'regular', size: fs(10), color: C.G });
      doc.line(ML, doc.y + h0 - px(0.5), ML + CW, doc.y + h0 - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y += h0;
      return;
    }
    prios.forEach(function (r) {
      var name = r.name;
      var detail = r.detail || ('= ' + E.fmt(r.result) + ' ' + r.unit + (r.side ? ' (' + r.side + ' higher)' : '') +
        ' · needs ' + r.target + ' · ' + (r.source || '—'));
      var chipW = width(r.status, 'bold', fs(9)) + px(14);
      var nameW = width(name, 'bold', fs(10));
      var detW = CW - px(12) - chipW - px(8) - nameW - px(8);
      var dl = wrap(detail, 'regular', fs(9), Math.max(detW, px(120)));
      var contentH = Math.max(lineH(9) + px(2), lineH(10), dl.length * lineH(9));
      var h = contentH + px(8) + px(1);
      doc.ensure(h);
      var top = doc.y, mid = top + px(4) + contentH / 2;
      chip(doc, r.status, ML + px(6), mid, COL[r.status] || C.NA);
      doc.text(name, ML + px(6) + chipW + px(8), baseline(mid - lineH(10) / 2, 10), { style: 'bold', size: fs(10), color: C.INK });
      var dTop = mid - dl.length * lineH(9) / 2;
      dl.forEach(function (l, i) {
        doc.text(l, ML + CW - px(6), baseline(dTop + i * lineH(9), 9), { style: 'regular', size: fs(9), color: C.MUTE, align: 'right' });
      });
      doc.line(ML, top + h - px(0.5), ML + CW, top + h - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y = top + h;
    });
  }

  function asymmetry(doc, groups) {
    var rows = E.flatten(groups).filter(function (r) { return E.isAsym(r.name); });
    if (!rows.length) return;
    var rowH = px(22);
    section(doc, 'Limb symmetry — L vs R', { keep: px(16) + rowH });
    var hy = doc.y + px(3);
    var o = { style: 'bold', size: fs(7.5), color: C.MUTE, cs: px(0.5) };
    doc.text('◀ LEFT higher', ML + px(2), baseline(hy, 7.5), o);
    doc.text('balanced', ML + CW / 2, baseline(hy, 7.5), Object.assign({ align: 'center' }, o));
    doc.text('RIGHT higher ▶', ML + CW - px(2), baseline(hy, 7.5), Object.assign({ align: 'right' }, o));
    doc.y = hy + lineH(7.5) + px(3);
    var SCALE = 25.0;
    rows.forEach(function (r) {
      var pct = E.num(r.result);
      if (pct === null) return;
      doc.ensure(rowH);
      var top = doc.y, mid = top + rowH / 2 - px(0.5);
      var nameW = px(150), valW = px(96), gap = px(8);
      var nl = wrap(r.name, 'bold', fs(9.5), nameW);
      nl.forEach(function (l, i) {
        doc.text(l, ML + px(6), baseline(mid - nl.length * lineH(9.5) / 2 + i * lineH(9.5), 9.5), { style: 'bold', size: fs(9.5), color: C.INK });
      });
      var tx = ML + px(6) + nameW + gap, tw = CW - px(12) - nameW - valW - 2 * gap, th = px(13), ty = mid - th / 2;
      doc.rect(tx, ty, tw, th, { r: px(3), fill: '#F0F2F5' });
      var g = E.num((r.norm || {}).green);
      if (g !== null) {
        var tk = Math.min(50, g / SCALE * 50);
        doc.rect(tx + tw * (50 - tk) / 100, ty, px(1), th, { fill: '#C2C9D2' });
        doc.rect(tx + tw * (50 + tk) / 100, ty, px(1), th, { fill: '#C2C9D2' });
      }
      doc.rect(tx + tw / 2 - px(1), ty, px(2), th, { fill: '#8A93A0' });
      var w = Math.min(50, pct / SCALE * 50), side = r.side || '';
      var fl, fw;
      if (side === 'L') { fl = 50 - w; fw = w; } else if (side === 'R') { fl = 50; fw = w; } else { fl = 49; fw = 2; }
      if (fw > 0) doc.rect(tx + tw * fl / 100, ty + px(2), tw * fw / 100, th - px(4), { r: px(2), fill: COL[r.status] || C.NA });
      doc.text(E.fmt(pct) + '%' + (side ? ' (' + side + ' higher)' : ''), ML + CW - px(6), baseline(mid - lineH(9) / 2, 9), { style: 'bold', size: fs(9), color: C.BLACK, align: 'right' });
      doc.line(ML, top + rowH - px(0.5), ML + CW, top + rowH - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y = top + rowH;
    });
    doc.y += px(5);
    var note = wrap('Bar length = asymmetry magnitude; faint ticks mark the balanced (green) limit. Direction = higher/dominant side.', 'italic', fs(7.5), CW - px(4));
    note.forEach(function (l) {
      doc.ensure(lineH(7.5));
      doc.text(l, ML + px(2), baseline(doc.y, 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE });
      doc.y += lineH(7.5);
    });
  }

  function meterBar(doc, x, y, w, result, norm) {
    var h = px(9), r = px(5);
    var pill = pillPolygon(x, y, w, h, r);
    doc.poly(pill, { fill: '#EEEEEE' });
    var m = E.meter(result, norm);
    if (!m) return;
    var at = 0;
    m.segments.forEach(function (s) {
      var x0 = x + w * at / 100, x1 = x + w * Math.min(100, at + s.width) / 100;
      at += s.width;
      if (x1 - x0 < 0.001 || x0 >= x + w) return;
      var clipped = clipX(pill, x0, x1);
      if (clipped.length > 2) doc.poly(clipped, { fill: COL[s.color] });
    });
    var mx = x + w * m.marker / 100;
    doc.rect(mx - px(1.5), y - px(2) - px(1.5), px(3 + 3), px(13 + 3), { r: px(3), fill: C.WHITE });
    doc.rect(mx, y - px(2), px(3), px(13), { r: px(2), fill: C.BLACK });
  }

  // grouped result rows (Full results / rehab body)
  function results(doc, groups, cols, tgtPrefix) {
    var c1 = px(cols[0]), c2 = px(cols[1]), c4 = px(cols[2]), gap = px(8), pad = px(6);
    var c3 = CW - 2 * pad - c1 - c2 - c4 - 3 * gap;
    function rowLayout(r) {
      // name, unit (5px after the name) and "· L higher" flow together inside column 1
      var parts = [{ s: r.name, style: 'bold', size: 10, color: C.INK, gap: 0 },
        { s: r.unit, style: 'regular', size: 8.5, color: C.MUTE, gap: px(5) }];
      if (r.side) parts.push({ s: '· ' + r.side + ' higher', style: 'bold', size: 8.5, color: C.BLUE, gap: width(' ', 'bold', fs(10)) });
      var lines = [[]], lx = 0;
      parts.forEach(function (p) {
        var words = clean(p.s).trim().split(' ').filter(Boolean);
        words.forEach(function (word, wi) {
          var lead = wi === 0 ? p.gap : width(' ', p.style, fs(p.size));
          var ww = width(word, p.style, fs(p.size));
          if (lx > 0 && lx + lead + ww > c1) { lines.push([]); lx = 0; lead = 0; }
          else if (lx === 0) lead = 0;
          lines[lines.length - 1].push({ s: word, x: lx + lead, style: p.style, size: p.size, color: p.color });
          lx += lead + ww;
        });
      });
      var chg = r.change ? wrap(r.change, 'bold', fs(8.5), c4) : [];
      var h1 = lines.length * lineH(10);
      var h3 = px(9 + 2) + lineH(8);
      var h4 = lineH(9) + px(2) + (chg.length ? px(2) + chg.length * lineH(8.5) : 0);
      return { lines: lines, chg: chg, h: Math.max(h1, lineH(13), h3, h4) + px(10) + px(1), h1: h1, h4: h4 };
    }
    groups.forEach(function (gp) {
      var bandH = lineH(9.5) + px(6);
      var first = rowLayout(gp.rows[0]);
      doc.ensure(px(7) + bandH + first.h);
      doc.y += px(7);
      var top = doc.y;
      doc.rect(ML, top, CW, bandH, { r: px(3), fill: C.GBAND });
      var bl = baseline(top + px(3), 9.5);
      doc.rect(ML + px(8), bl - px(7), px(7), px(7), { r: px(2), fill: C.BLUE });
      doc.text(gp.title, ML + px(8 + 7 + 7), bl, { style: 'bold', size: fs(9.5), color: C.WHITE, cs: px(0.4) });
      doc.y = top + bandH;
      gp.rows.forEach(function (r, idx) {
        var L = idx === 0 ? first : rowLayout(r);
        doc.ensure(L.h);
        var rtop = doc.y, mid = rtop + px(5) + (L.h - px(11)) / 2;
        var x1 = ML + pad;
        var nTop = mid - L.h1 / 2;
        L.lines.forEach(function (line, i) {
          line.forEach(function (w) {
            doc.text(w.s, x1 + w.x, baseline(nTop + i * lineH(10), 10), { style: w.style, size: fs(w.size), color: w.color });
          });
        });
        var x2 = x1 + c1 + gap;
        doc.text(E.fmt(r.result), x2 + c2 / 2, baseline(mid - lineH(13) / 2, 13), { style: 'bold', size: fs(13), color: C.BLACK, align: 'center' });
        var x3 = x2 + c2 + gap, mTop = mid - (px(11) + lineH(8)) / 2;
        meterBar(doc, x3, mTop, c3, r.result, r.norm);
        doc.text(tgtPrefix + ' ' + r.target, x3, baseline(mTop + px(11), 8), { style: 'regular', size: fs(8), color: C.MUTE });
        var x4r = ML + CW - pad, sTop = mid - L.h4 / 2;
        if (r.status) chip(doc, r.status, x4r, sTop + (lineH(9) + px(2)) / 2, COL[r.status] || C.NA, { right: true });
        var kcol = r.change_kind === 'gain' ? C.G : (r.change_kind === 'drop' ? C.R : C.MUTE);
        L.chg.forEach(function (l, i) {
          doc.text(l, x4r, baseline(sTop + lineH(9) + px(4) + i * lineH(8.5), 8.5), { style: 'bold', size: fs(8.5), color: kcol, align: 'right' });
        });
        doc.line(ML, rtop + L.h - px(0.5), ML + CW, rtop + L.h - px(0.5), { stroke: C.LINE, lw: px(1) });
        doc.y = rtop + L.h;
      });
    });
  }

  function footer(doc, text) {
    var lines = wrap(text, 'italic', fs(8), CW);
    var h = px(12) + px(2 + 6) + lines.length * lineH(8);
    doc.ensure(h);
    var top = doc.y + px(12);
    doc.line(ML, top + px(1), ML + CW, top + px(1), { stroke: C.BLUE, lw: px(2) });
    lines.forEach(function (l, i) {
      doc.text(l, ML, baseline(top + px(8) + i * lineH(8), 8), { style: 'italic', size: fs(8), color: C.MUTE });
    });
    doc.y = top + px(8) + lines.length * lineH(8);
  }

  // ------------------------------------------------------------------ the three reports
  function screening(d) {
    var doc = new Doc(), m = d.meta || {};
    header(doc, 'Athlete Performance & Readiness Report', 'VALD Testing • Normative screening with change-vs-previous');
    meta(doc, [['Athlete', m.name], ['Date', m.date], ['Sport', m.sport], ['Tester', m.tester], ['Age', m.age],
      ['Sex', m.sex], ['Mass', clean(m.mass).trim() ? clean(m.mass).trim() + ' kg' : ''], ['Notes', m.notes]]);
    band(doc, 'Compared against', d.popLabel || '—', [['Green: ' + d.counts.Green, C.G], ['Amber: ' + d.counts.Amber, C.A], ['Red: ' + d.counts.Red, C.R]]);
    var cards = E.scorecard(d.groups);
    if (cards.length) { section(doc, 'Overview by area', { keep: px(40) }); scorecard(doc, cards); }
    var keys = d.radarKeys && d.radarKeys.length ? d.radarKeys : null;
    var spokes = keys ? E.radarSpokes(d.groups, keys) : [];
    var quad = keys ? keys.some(function (k) { return k[0] === '__QUAD__'; }) : false;
    var drewRadar = radar(doc, spokes, quad);
    section(doc, 'Top priorities — worst first', { newPage: drewRadar, keep: px(22) });
    priorities(doc, d.prios);
    asymmetry(doc, d.groups);
    section(doc, 'Full results', { keep: px(60) });
    results(doc, d.groups, [150, 52, 120], 'target');
    footer(doc, 'Confidence shown in grey (★★★ strong · ★★☆ moderate · ★☆☆ weak). ' +
      'Norms are population- and protocol-dependent; targets reflect the selected reference population only. ' +
      'This report organises and displays testing data and is not medical advice.');
    return finish(doc, 'Athlete Performance & Readiness Report', m.name);
  }

  function rehab(d) {
    var doc = new Doc(), m = d.meta || {}, acl = d.kind === 'acl';
    if (acl) {
      header(doc, 'ACL Rehab & Return-to-Play', 'ACLR research norms • injured-limb / symmetry tracking');
      meta(doc, [['Athlete', m.name], ['Date', m.date], ['Injured side', m.injured], ['Graft', m.graft],
        ['Surgeon', m.surgeon], ['Months post-op', m.months], ['Sport', m.sport], ['Notes', m.notes]]);
    } else {
      header(doc, 'Hamstring Rehab & Return-to-Play', 'Injured-limb tracking vs phase targets • change-vs-previous');
      meta(doc, [['Athlete', m.name], ['Date', m.date], ['Injured side', m.injured], ['Clinician', m.clinician],
        ['Wks since injury', m.weeks], ['Sport', m.sport], ['Notes', m.notes]]);
    }
    band(doc, 'Rehab phase', acl ? d.phase + ' · ' + d.sex : d.phase,
      [['On/ahead: ' + d.counts.Green, C.G], ['Within 1 SD: ' + d.counts.Amber, C.A], ['>1 SD behind: ' + d.counts.Red, C.R]]);
    results(doc, d.groups, acl ? [210, 56, 118] : [188, 56, 118], 'phase target');
    footer(doc, d.disclaimer || '');
    return finish(doc, acl ? 'ACL Rehab & Return-to-Play' : 'Hamstring Rehab & Return-to-Play', m.name);
  }


  // ------------------------------------------------------------------ strength battery: left vs right table
  function strengthTable(doc, tests) {
    var pad = px(6), gap = px(10);
    var c1 = px(200), c2 = px(190), c3 = px(190);
    var c4 = CW - 2 * pad - c1 - c2 - c3 - 3 * gap;
    var x1 = ML + pad, x2 = x1 + c1 + gap, x3 = x2 + c2 + gap, x4 = x3 + c3 + gap;
    var bandH = lineH(9.5) + px(6), headH = px(4) + lineH(7.5) + px(3);
    var cellH = lineH(11) + px(4) + px(9) + px(4) + lineH(7.5);
    function head() {
      var top = doc.y;
      doc.rect(ML, top, CW, bandH, { r: px(3), fill: C.GBAND });
      var bl = baseline(top + px(3), 9.5);
      doc.rect(ML + px(8), bl - px(7), px(7), px(7), { r: px(2), fill: C.BLUE });
      doc.text('LOWER-LIMB STRENGTH & CAPACITY', ML + px(8 + 7 + 7), bl, { style: 'bold', size: fs(9.5), color: C.WHITE, cs: px(0.4) });
      var hy = baseline(top + bandH + px(4), 7.5), o = { style: 'bold', size: fs(7.5), color: C.MUTE, cs: px(0.5) };
      doc.text('TEST & TARGET', x1, hy, o);
      doc.text('LEFT', x2, hy, o);
      doc.text('RIGHT', x3, hy, o);
      doc.text('L/R DIFF', x4 + c4, hy, Object.assign({ align: 'right' }, o));
      doc.y = top + bandH + headH;
    }
    doc.ensure(px(7) + bandH + headH + cellH + px(11));
    doc.y += px(7);
    head();
    tests.forEach(function (t) {
      var nameLines = wrap(t.name, 'bold', fs(10), c1);
      var sub = 'target ' + t.target + (t.rawTarget ? ' = ' + E.fmt(t.rawTarget.value) + ' ' + t.rawTarget.unit : '') + (t.detail ? ' · ' + t.detail : '');
      var subLines = wrap(sub, 'regular', fs(8), c1);
      var h1 = nameLines.length * lineH(10) + px(2) + subLines.length * lineH(8);
      var h = Math.max(h1, cellH) + px(10) + px(1);
      if (!doc.fits(h)) { doc.newPage(); head(); }
      var top = doc.y, inner = top + px(5);
      nameLines.forEach(function (l, i) {
        doc.text(l, x1, baseline(inner + i * lineH(10), 10), { style: 'bold', size: fs(10), color: C.INK });
      });
      var sy = inner + nameLines.length * lineH(10) + px(2);
      subLines.forEach(function (l, i) {
        doc.text(l, x1, baseline(sy + i * lineH(8), 8), { style: 'regular', size: fs(8), color: C.MUTE });
      });
      [['L', x2, c2], ['R', x3, c3]].forEach(function (s) {
        var cell = t.sides[s[0]], x = s[1], w = s[2];
        if (!cell || cell.value === null) {
          doc.text(cell && cell.needsMass ? 'needs body mass' : '—', x, baseline(inner, 11), { style: 'regular', size: fs(9), color: C.MUTE });
          return;
        }
        doc.text(cell.text, x, baseline(inner, 11), { style: 'bold', size: fs(11), color: C.BLACK });
        chip(doc, cell.status, x + w, inner + lineH(11) / 2, COL[cell.status] || C.NA, { right: true, size: 8.5, padX: 6, padY: 1 });
        var my = inner + lineH(11) + px(4);
        meterBar(doc, x, my, w, cell.value, t.norm);
        var raw;
        if (t.input === 'calc') raw = 'ADD ' + E.fmt(cell.parts[0]) + ' N ÷ ABD ' + E.fmt(cell.parts[1]) + ' N';
        else raw = E.fmt(cell.input) + ' ' + (t.input === 'reps' ? 'reps' : t.input) + (cell.also != null ? ' · ' + E.fmt(cell.also) + ' × BW' : '');
        doc.text(raw, x, baseline(my + px(9) + px(4), 7.5), { style: 'regular', size: fs(7.5), color: C.MUTE });
      });
      var mid = inner + (h - px(11)) / 2;
      var dt = E.diffText(t.diff);
      doc.text(dt || '—', x4 + c4, baseline(mid - lineH(9) / 2, 9), { style: dt ? 'bold' : 'regular', size: fs(9), color: dt ? C.INK : C.MUTE, align: 'right' });
      doc.line(ML, top + h - px(0.5), ML + CW, top + h - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y = top + h;
    });
  }

  function strength(d) {
    var doc = new Doc(), m = d.meta || {}, c = d.counts;
    header(doc, 'Lower-Limb Strength & Capacity', 'Strength battery • targets relative to body weight');
    meta(doc, [['Athlete', m.name], ['Date', m.date], ['Mass', clean(m.mass).trim() ? clean(m.mass).trim() + ' kg' : ''],
      ['Sport', m.sport], ['Tester', m.tester], ['Notes', m.notes]]);
    band(doc, 'Scored against', 'BASE Health strength targets', [['Green: ' + c.Green, C.G], ['Amber: ' + c.Amber, C.A], ['Red: ' + c.Red, C.R]]);
    section(doc, 'Below target — worst first', { keep: px(22) });
    priorities(doc, d.prios.map(function (r) {
      return { status: r.status, name: r.name, detail: '= ' + r.text + ' · needs ' + r.target };
    }), '✓ Nothing below target — every tested result is on target.');
    section(doc, 'Results — left vs right', { keep: px(90) });
    strengthTable(doc, d.tests.filter(function (t) { return t.any || t.sides.L.needsMass || t.sides.R.needsMass; }));
    var pct = d.amberPct == null ? 5 : d.amberPct;
    footer(doc, 'Green = at or above target · Amber = within ' + pct + '% of target · Red = further away. ' +
      'Loads are divided by body mass; forces are converted to N/kg (N ÷ kg) or × body weight (N ÷ (kg × 9.81)). ' +
      'Hip ratio = adduction ÷ abduction. L/R diff = gap between legs as a % of the stronger leg. ' +
      'BW = body weight · RM = repetition maximum. This report organises and displays testing data and is not medical advice.');
    return finish(doc, 'Lower-Limb Strength & Capacity', m.name);
  }

  function finish(doc, title, name) {
    return { pages: doc.pages, title: title + (clean(name).trim() ? ' — ' + clean(name).trim() : '') };
  }

  // ------------------------------------------------------------------ writers
  function roundedPath(x, y, w, h, r) {           // r: number or [tl, tr, br, bl]
    var rr = Array.isArray(r) ? r : [r, r, r, r];
    rr = rr.map(function (v) { return Math.max(0, Math.min(v || 0, w / 2, h / 2)); });
    var k = 0.5523, P = [];
    P.push(['M', x + rr[0], y], ['L', x + w - rr[1], y]);
    if (rr[1]) P.push(['C', x + w - rr[1] + k * rr[1], y, x + w, y + rr[1] - k * rr[1], x + w, y + rr[1]]);
    P.push(['L', x + w, y + h - rr[2]]);
    if (rr[2]) P.push(['C', x + w, y + h - rr[2] + k * rr[2], x + w - rr[2] + k * rr[2], y + h, x + w - rr[2], y + h]);
    P.push(['L', x + rr[3], y + h]);
    if (rr[3]) P.push(['C', x + rr[3] - k * rr[3], y + h, x, y + h - rr[3] + k * rr[3], x, y + h - rr[3]]);
    P.push(['L', x, y + rr[0]]);
    if (rr[0]) P.push(['C', x, y + rr[0] - k * rr[0], x + rr[0] - k * rr[0], y, x + rr[0], y]);
    P.push(['Z']);
    return P;
  }

  function toPdf(report, info) {
    if (!JsPDF) throw new Error('The PDF library did not load.');
    var pdf = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
    Object.keys(FONTS.faces).forEach(function (k) {
      var f = FONTS.faces[k];
      pdf.addFileToVFS(f.file, f.data);
      pdf.addFont(f.file, f.family, 'normal');
    });
    pdf.setProperties({ title: report.title, author: (info && info.author) || 'BASE Health Noosa', creator: 'BASE Health Athlete Report' });
    var gsFull = new pdf.GState({ opacity: 1 });
    report.pages.forEach(function (page, pi) {
      if (pi) pdf.addPage('a4');
      page.items.forEach(function (it) {
        if (it.t === 'rect') {
          if (it.fill) pdf.setFillColor(it.fill);
          if (it.stroke) { pdf.setDrawColor(it.stroke); pdf.setLineWidth(it.lw); }
          var style = it.fill && it.stroke ? 'FD' : (it.fill ? 'F' : 'S');
          if (!it.r) pdf.rect(it.x, it.y, it.w, it.h, style);
          else if (!Array.isArray(it.r)) pdf.roundedRect(it.x, it.y, it.w, it.h, Math.min(it.r, it.w / 2, it.h / 2), Math.min(it.r, it.w / 2, it.h / 2), style);
          else { pathPdf(pdf, roundedPath(it.x, it.y, it.w, it.h, it.r)); paint(pdf, it.fill, it.stroke); }
        } else if (it.t === 'poly') {
          var P = it.pts.map(function (p, i) { return [i ? 'L' : 'M', p[0], p[1]]; });
          if (it.closed) P.push(['Z']);
          if (it.fill && it.fillOpacity < 1) pdf.setGState(new pdf.GState({ opacity: it.fillOpacity }));
          if (it.fill) pdf.setFillColor(it.fill);
          if (it.stroke) { pdf.setDrawColor(it.stroke); pdf.setLineWidth(it.lw); }
          if (it.dash) pdf.setLineDashPattern(it.dash, 0);
          pathPdf(pdf, P);
          paint(pdf, it.fill, it.stroke);
          if (it.dash) pdf.setLineDashPattern([], 0);
          if (it.fill && it.fillOpacity < 1) pdf.setGState(gsFull);
        } else if (it.t === 'line') {
          pdf.setDrawColor(it.stroke); pdf.setLineWidth(it.lw);
          if (it.dash) pdf.setLineDashPattern(it.dash, 0);
          pdf.line(it.x1, it.y1, it.x2, it.y2);
          if (it.dash) pdf.setLineDashPattern([], 0);
        } else if (it.t === 'circle') {
          if (it.fill) pdf.setFillColor(it.fill);
          if (it.stroke) { pdf.setDrawColor(it.stroke); pdf.setLineWidth(it.lw); }
          pdf.circle(it.cx, it.cy, it.r, it.fill && it.stroke ? 'FD' : (it.fill ? 'F' : 'S'));
        } else if (it.t === 'text') {
          pdf.setFontSize(it.size);
          pdf.setTextColor(it.color);
          var x = it.x;
          runs(it.s, it.style).forEach(function (r) {
            pdf.setFont(FAMILY[r.face], 'normal');
            if (it.cs) {
              for (var ch of r.text) { if (ch !== ' ') pdf.text(ch, x, it.y); x += charW(r.face, ch, it.size) + it.cs; }
            } else {
              pdf.text(r.text, x, it.y);
              for (var ch2 of r.text) x += charW(r.face, ch2, it.size);
            }
          });
        }
      });
    });
    return pdf;
  }
  function pathPdf(pdf, P) {
    P.forEach(function (s) {
      if (s[0] === 'M') pdf.moveTo(s[1], s[2]);
      else if (s[0] === 'L') pdf.lineTo(s[1], s[2]);
      else if (s[0] === 'C') pdf.curveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
      else pdf.close();
    });
  }
  function paint(pdf, fill, stroke) {
    if (fill && stroke) pdf.fillStroke(); else if (fill) pdf.fill(); else pdf.stroke();
  }

  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // The preview SVG works in 0.1 mm units: browsers lay out tiny SVG font sizes imprecisely,
  // so coordinates are scaled up and every character gets the exact x position the PDF uses.
  var SVG_SCALE = 10;
  function n2(v) { return (Math.round(v * SVG_SCALE * 100) / 100).toString(); }
  function toSvg(report) {
    return report.pages.map(function (page) {
      var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n2(PAGE_W) + ' ' + n2(PAGE_H) + '" class="rpt-page" role="img" aria-label="Report page" text-rendering="geometricPrecision">',
        '<rect width="' + n2(PAGE_W) + '" height="' + n2(PAGE_H) + '" fill="#ffffff"/>'];
      page.items.forEach(function (it) {
        if (it.t === 'rect') {
          var d = roundedPath(it.x, it.y, it.w, it.h, it.r || 0).map(function (s) { return s[0] + s.slice(1).map(n2).join(' '); }).join('');
          out.push('<path d="' + d + '" fill="' + (it.fill || 'none') + '"' + (it.stroke ? ' stroke="' + it.stroke + '" stroke-width="' + n2(it.lw) + '"' : '') + '/>');
        } else if (it.t === 'poly') {
          var pts = it.pts.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join(' ');
          out.push('<' + (it.closed ? 'polygon' : 'polyline') + ' points="' + pts + '" fill="' + (it.fill || 'none') + '"' +
            (it.fill && it.fillOpacity < 1 ? ' fill-opacity="' + it.fillOpacity + '"' : '') +
            (it.stroke ? ' stroke="' + it.stroke + '" stroke-width="' + n2(it.lw) + '" stroke-linejoin="miter"' : '') +
            (it.dash ? ' stroke-dasharray="' + it.dash.map(n2).join(' ') + '"' : '') + '/>');
        } else if (it.t === 'line') {
          out.push('<line x1="' + n2(it.x1) + '" y1="' + n2(it.y1) + '" x2="' + n2(it.x2) + '" y2="' + n2(it.y2) + '" stroke="' + it.stroke + '" stroke-width="' + n2(it.lw) + '"' +
            (it.dash ? ' stroke-dasharray="' + it.dash.map(n2).join(' ') + '"' : '') + '/>');
        } else if (it.t === 'circle') {
          out.push('<circle cx="' + n2(it.cx) + '" cy="' + n2(it.cy) + '" r="' + n2(it.r) + '" fill="' + (it.fill || 'none') + '"' + (it.stroke ? ' stroke="' + it.stroke + '" stroke-width="' + n2(it.lw) + '"' : '') + '/>');
        } else if (it.t === 'text') {
          var x = it.x, size = n2(it.size * 25.4 / 72);
          runs(it.s, it.style).forEach(function (r) {
            var xs = [], s = '';
            for (var ch of r.text) { xs.push(n2(x)); s += ch; x += charW(r.face, ch, it.size) + it.cs; }
            out.push('<text x="' + xs.join(' ') + '" y="' + n2(it.y) + '" font-family="' + FAMILY[r.face] + '" font-size="' + size + '" fill="' + it.color + '" xml:space="preserve">' + escXml(s) + '</text>');
          });
        }
      });
      out.push('</svg>');
      return out.join('');
    });
  }

  // FontFace sources so the on-screen preview uses exactly the PDF's fonts
  function fontFaces() {
    return Object.keys(FONTS.faces).map(function (k) {
      return { family: FONTS.faces[k].family, url: 'data:font/ttf;base64,' + FONTS.faces[k].data };
    });
  }

  return { screening: screening, rehab: rehab, strength: strength, toPdf: toPdf, toSvg: toSvg, fontFaces: fontFaces, _width: width, _wrap: wrap };
});
