/* BASE Health Report: the branded PDF, built on the device.
   Recreates the WeasyPrint designs from report_pdf.py (screening, hamstring, ACL), plus the strength
   battery, the optional interpretation box and (v10) the exercise program handout, as a list of
   vector drawing commands, which are then written two ways from the same layout:
     toPdf()  -> a real PDF file (jsPDF, embedded fonts, selectable text, link annotations)
     toSvg()  -> SVG pages for the on-screen preview
   v15: the handout prints library cues and a QR code per video link; the QR encoder (qrcode.js, qrcode-generator) is
   the fourth argument and optional (without it a video prints as a "Video link" text link).
   Browser: window.BHReport   Node (tests): require('./report.js')(engine, fonts, jsPDF, qrcode) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.BHReport = factory(root.BHEngine, root.BH_REPORT_FONTS, root.jspdf && root.jspdf.jsPDF, root.qrcode);
})(typeof self !== 'undefined' ? self : this, function (E, FONTS, JsPDF, QR) {
  'use strict';

  // ------------------------------------------------------------------ units & page
  var MM_PER_PX = 25.4 / 96;                       // CSS px -> mm (WeasyPrint's 96 dpi)
  function px(v) { return v * MM_PER_PX; }
  function fs(v) { return v * 0.75; }              // CSS px font size -> pt
  var PAGE_W = 210, PAGE_H = 297, ML = 12, MT = 13, MB = 13;
  var CW = PAGE_W - 2 * ML;                         // content width, 186 mm
  var CW_PX = CW / MM_PER_PX;

  // colours from report_pdf.py
  // v12: the BASE Health Noosa palette (basehealthnoosa.com.au): brand blue #448EEE, a deeper blue for small text on
  // white, the logo's near-black for the header band and the site's navy for the device bands
  var C = {
    BLUE: '#448EEE', BLUEINK: '#2760C8', DARK: '#202020', BLACK: '#111418', INK: '#22262B',
    MUTE: '#5F6672', LINE: '#E4E7EA', GBAND: '#1A2951', G: '#2E7D32', A: '#DD8800', R: '#C62828',
    WHITE: '#FFFFFF', NA: '#999999', GUIDE: '#4E6E97', GUIDEZONE: '#C9D5E6'
  };
  var COL = { Green: C.G, Amber: C.A, Red: C.R, Guide: C.GUIDE };   // v28: Guide = the DSI, never rated (a neutral blue-grey)
  var TEXT_COL = { Green: C.G, Amber: '#A35F00', Red: C.R, 'n/a': C.MUTE, Guide: C.GUIDE };   // status-coloured words on white (amber darkened to read)

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
  // greedy word wrap to maxW (mm); very long words are split. cs: letter spacing (mm), when the text is drawn with it
  function wrap(str, style, size, maxW, cs) {
    str = clean(str).trim();
    if (!str) return [''];
    if (width(str, style, size, cs) <= maxW) return [str];
    var lines = [], line = '';
    str.split(' ').forEach(function (word) {
      var cand = line ? line + ' ' + word : word;
      if (width(cand, style, size, cs) <= maxW) { line = cand; return; }
      if (line) lines.push(line);
      line = '';
      if (width(word, style, size, cs) <= maxW) { line = word; return; }
      var chunk = '';
      for (var ch of word) {
        if (chunk && width(chunk + ch, style, size, cs) > maxW) { lines.push(chunk); chunk = ch; }
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
  // a filled shape from SVG path data (M, m, l, c, z), placed with its own origin and scale (v12: the logo)
  Doc.prototype.path = function (d, x, y, k, o) {
    return this.add({ t: 'path', segs: svgSegs(d, x, y, k), fill: o.fill || null });
  };
  // a tappable area that opens a web address (v15: the handout's video links); nothing is drawn for it
  Doc.prototype.link = function (x, y, w, h, url) {
    return this.add({ t: 'link', x: x, y: y, w: w, h: h, url: url });
  };
  // v34: a JPEG picture (a data URL), drawn to fill the box (the handout's exercise photos, already cut to the box's shape)
  Doc.prototype.image = function (data, x, y, w, h) {
    return this.add({ t: 'img', data: data, x: x, y: y, w: w, h: h });
  };
  // SVG path data -> absolute segments [['M',x,y], ['L',x,y], ['C',x1,y1,x2,y2,x,y], ['Z']] scaled by k and moved to (x, y).
  // Enough of the SVG grammar for the logo: absolute M, relative m/l/c (with implicit repeats) and z.
  function svgSegs(d, ox, oy, k) {
    var out = [], cx = 0, cy = 0, sx = 0, sy = 0, cmd = '', i = 0, nums, n;
    var tokens = d.match(/[MmLlCcZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    function P(x, y) { return [ox + x * k, oy + y * k]; }
    while (i < tokens.length) {
      var t = tokens[i];
      if (/^[A-Za-z]$/.test(t)) { cmd = t; i++; if (cmd === 'z' || cmd === 'Z') { out.push(['Z']); cx = sx; cy = sy; } continue; }
      nums = [];
      n = cmd === 'c' || cmd === 'C' ? 6 : 2;
      while (nums.length < n && i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) nums.push(+tokens[i++]);
      if (nums.length < n) break;
      if (cmd === 'M' || cmd === 'm') {
        if (cmd === 'm') { cx += nums[0]; cy += nums[1]; } else { cx = nums[0]; cy = nums[1]; }
        sx = cx; sy = cy;
        out.push(['M'].concat(P(cx, cy)));
        cmd = cmd === 'm' ? 'l' : 'L';                   // further pairs after a move are lines
      } else if (cmd === 'L' || cmd === 'l') {
        if (cmd === 'l') { cx += nums[0]; cy += nums[1]; } else { cx = nums[0]; cy = nums[1]; }
        out.push(['L'].concat(P(cx, cy)));
      } else {
        var x1 = nums[0], y1 = nums[1], x2 = nums[2], y2 = nums[3], x = nums[4], y = nums[5];
        if (cmd === 'c') { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        out.push(['C'].concat(P(x1, y1), P(x2, y2), P(x, y)));
        cx = x; cy = y;
      }
    }
    return out;
  }

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
  // The BASE Health Noosa logo (v12), as vector paths from the website's SVG: BASE with the blue A, HEALTH under the A
  // and NOOSA set vertically on the right. Drawn in a 502.58 x 114.45 unit box; h = the height it is drawn at (mm).
  var LOGO = {
    ink: ['M23.52 25.02c0,1.42 0.11,2.53 0.32,3.32 0.2,0.79 0.51,1.4 0.93,1.81 0.34,0.34 0.9,0.65 1.69,0.94 0.79,0.29 2.02,0.44 3.69,0.44l53.8 0c2.59,0 4.36,-0.44 5.32,-1.32 0.96,-0.87 1.44,-2.6 1.44,-5.19 0,-1.42 -0.13,-2.52 -0.38,-3.31 -0.25,-0.79 -0.58,-1.4 -1,-1.82 -0.33,-0.41 -0.89,-0.77 -1.69,-1.06 -0.79,-0.29 -2.02,-0.44 -3.69,-0.44l-53.8 0c-2.67,0 -4.44,0.46 -5.32,1.38 -0.87,0.92 -1.31,2.67 -1.31,5.25zm-2.13 37.91c0,2.84 0.59,4.76 1.76,5.76 1.16,1 3.13,1.5 5.88,1.5l55.92 0c2.76,0 4.74,-0.48 5.95,-1.44 1.21,-0.96 1.81,-2.9 1.81,-5.82l0 -3.88c0,-1.75 -0.17,-3.1 -0.5,-4.06 -0.33,-0.96 -0.75,-1.65 -1.25,-2.07 -0.5,-0.5 -1.21,-0.91 -2.13,-1.25 -0.92,-0.33 -2.21,-0.5 -3.88,-0.5l-55.92 0c-2.84,0 -4.82,0.61 -5.95,1.82 -1.12,1.21 -1.69,3.23 -1.69,6.06l0 3.88zm-21.39 -57.3c0,-0.58 0.08,-1.19 0.25,-1.81 0.17,-0.63 0.54,-1.19 1.13,-1.69 0.58,-0.59 1.19,-0.96 1.81,-1.13 0.63,-0.17 1.19,-0.25 1.69,-0.25l24.4 -0.38 55.55 0c8.34,0 14.66,2.03 18.95,6.07 4.3,4.05 6.45,10.24 6.45,18.58 0,2.92 -0.44,5.74 -1.32,8.45 -0.87,2.71 -2.39,5.02 -4.56,6.94 3.17,2 5.4,4.67 6.69,8.01 1.29,3.34 1.94,6.88 1.94,10.63l0 3.88c0,8.6 -2.36,15.1 -7.07,19.52 -4.71,4.42 -11.36,6.63 -19.95,6.63l-57.68 0 -23.4 -0.75c-0.5,0 -1.06,-0.1 -1.69,-0.31 -0.62,-0.21 -1.23,-0.56 -1.81,-1.06 -0.59,-0.59 -0.96,-1.19 -1.13,-1.82 -0.17,-0.62 -0.25,-1.19 -0.25,-1.69l0 -77.82z', 'M336.55 0c2.59,0 5.01,0.48 7.27,1.44 2.25,0.96 4.21,2.27 5.88,3.94 1.67,1.67 2.99,3.63 3.95,5.88 0.96,2.25 1.44,4.67 1.44,7.26l0 0.12c0,0.34 -0.17,0.5 -0.5,0.5l-79.94 0c-1.75,0 -3.13,0.17 -4.13,0.5 -1,0.34 -1.72,0.71 -2.13,1.13 -0.42,0.42 -0.78,1.02 -1.07,1.81 -0.29,0.8 -0.44,1.9 -0.44,3.32 0,2.58 0.54,4.42 1.63,5.5 0.5,0.59 1.25,1.07 2.26,1.44 1,0.38 2.46,0.65 4.38,0.82l52.75 3c8.35,0.42 14.97,2.73 19.86,6.94 4.89,4.22 7.33,10.66 7.33,19.33 0,9.01 -2.4,15.52 -7.2,19.52 -4.8,4 -11.55,6.01 -20.23,6.01l-62.51 0c-2.5,0 -4.88,-0.48 -7.14,-1.44 -2.25,-0.96 -4.23,-2.25 -5.95,-3.88 -1.71,-1.63 -3.07,-3.57 -4.07,-5.82 -1,-2.25 -1.54,-4.63 -1.63,-7.13 0,-0.42 0.17,-0.63 0.5,-0.63l4.64 0c2.08,0 4.77,0 8.06,0 3.3,0 6.91,-0.02 10.83,-0.06 3.91,-0.04 8.02,-0.06 12.32,-0.06 4.29,0 8.53,0 12.7,0 5,0 10.07,0 15.2,0 5.13,0 10.45,-0.04 15.95,-0.13 2.67,0 4.63,-0.43 5.88,-1.31 1.25,-0.88 1.88,-2.69 1.88,-5.44 0,-2.59 -0.5,-4.46 -1.5,-5.63 -0.5,-0.5 -1.25,-0.96 -2.25,-1.38 -1,-0.42 -2.46,-0.67 -4.38,-0.75l-52.68 -3c-8.42,-0.5 -15.05,-2.84 -19.89,-7.01 -4.84,-4.17 -7.26,-10.63 -7.26,-19.39 0,-8.93 2.42,-15.39 7.27,-19.4 4.84,-4 11.56,-6 20.17,-6l62.75 0z', 'M464.12 0.87c1.41,0 2.58,0.47 3.5,1.38 0.92,0.92 1.38,2.09 1.38,3.51l0 9.38c0,0.58 -0.09,1.19 -0.25,1.81 -0.17,0.63 -0.55,1.23 -1.13,1.82 -0.59,0.5 -1.19,0.83 -1.82,1 -0.62,0.17 -1.18,0.25 -1.68,0.25l-66.57 0c-1.17,0 -2.42,0.02 -3.75,0.06 -1.33,0.04 -2.46,0.56 -3.38,1.55 -0.42,0.41 -0.69,0.93 -0.81,1.55 -0.13,0.62 -0.23,1.22 -0.31,1.8l0 5.09c0.16,1.82 0.73,3.1 1.69,3.85 0.95,0.74 2.31,1.11 4.06,1.11l67.82 0c1.5,0 2.69,0.44 3.56,1.33 0.88,0.88 1.31,2.07 1.31,3.58l0 9.32c0,1.51 -0.43,2.71 -1.31,3.59 -0.87,0.88 -2.06,1.32 -3.56,1.32l-66.82 0c-1.92,0 -3.48,0.3 -4.69,0.88 -1.21,0.59 -1.9,1.96 -2.06,4.13l0 5.13c0.08,0.92 0.25,1.65 0.5,2.19 0.25,0.54 0.54,0.98 0.87,1.31 0.59,0.75 1.88,1.25 3.88,1.5l70.07 0c1.5,0 2.69,0.44 3.56,1.32 0.88,0.87 1.32,2.06 1.32,3.56l0 9.39c0,0.5 -0.09,1.06 -0.25,1.69 -0.17,0.62 -0.5,1.23 -1.01,1.81 -0.58,0.58 -1.18,0.96 -1.81,1.13 -0.63,0.16 -1.23,0.25 -1.81,0.25l-71.45 0c-7.84,0 -13.9,-2.01 -18.2,-6.01 -4.3,-4 -6.44,-10.05 -6.44,-18.14l0 -39.29c0,-8.09 2.14,-14.13 6.44,-18.14 4.3,-4 10.36,-6.01 18.2,-6.01l70.95 0z'],
    blue: ['M117.06 83.95c0,-0.5 0.1,-0.96 0.31,-1.37 0.21,-0.42 0.4,-0.84 0.56,-1.25l50.17 -77.2c0.17,-0.33 0.46,-0.73 0.88,-1.19 0.42,-0.46 0.96,-0.9 1.63,-1.31 0.75,-0.51 1.62,-0.76 2.63,-0.76l12.01 0c1.16,0 2.19,0.32 3.06,0.94 0.88,0.63 1.61,1.44 2.19,2.44l50.05 77.2c0.42,0.67 0.71,1.5 0.87,2.5 0,1.59 -0.66,2.88 -2,3.88 -1.08,0.42 -1.96,0.63 -2.62,0.63l-12.89 0c-1,0 -1.84,-0.21 -2.51,-0.63 -0.75,-0.42 -1.33,-0.89 -1.75,-1.44 -0.41,-0.54 -0.71,-0.98 -0.87,-1.31l-2.63 -4.13 -4.25 -6.38 -32.16 -49.8c-0.33,-0.33 -0.67,-0.33 -1,0l-20.02 30.91 -12.01 18.89 -6.88 10.51c-0.25,0.42 -0.58,0.87 -1,1.37 -0.42,0.51 -0.96,0.96 -1.63,1.38 -1.42,0.42 -2.29,0.63 -2.63,0.63l-12.88 0c-0.67,0 -1.55,-0.21 -2.63,-0.63 -1.34,-1 -2,-2.29 -2,-3.88z', 'M117.06 100.29c0,-0.24 0.08,-0.44 0.23,-0.6 0.16,-0.16 0.36,-0.24 0.6,-0.24l1.89 0c0.1,0 0.2,0.02 0.31,0.05 0.11,0.02 0.2,0.09 0.29,0.19 0.1,0.1 0.16,0.2 0.19,0.31 0.03,0.1 0.04,0.2 0.04,0.29l0 5.01 11.08 0 0 -5.01c0,-0.25 0.08,-0.45 0.24,-0.6 0.15,-0.16 0.35,-0.24 0.59,-0.24l1.88 0c0.09,0 0.2,0.02 0.31,0.06 0.1,0.03 0.2,0.09 0.3,0.18 0.16,0.2 0.24,0.4 0.24,0.6l0 13.33c0,0.25 -0.08,0.46 -0.25,0.61 -0.16,0.15 -0.36,0.22 -0.6,0.22l-1.88 0c-0.24,0 -0.44,-0.08 -0.59,-0.23 -0.16,-0.16 -0.24,-0.36 -0.24,-0.6l0 -5.04 -11.08 0 0 5.04c0,0.08 -0.01,0.18 -0.04,0.29 -0.03,0.1 -0.09,0.21 -0.19,0.31 -0.09,0.1 -0.18,0.16 -0.29,0.19 -0.11,0.03 -0.21,0.04 -0.31,0.04l-1.89 0c-0.24,0 -0.44,-0.08 -0.6,-0.23 -0.15,-0.16 -0.23,-0.36 -0.23,-0.6l0 -13.33z', 'M139.89 112.22c0,-0.15 0,-0.24 0.02,-0.25 0,-0.19 0.05,-0.36 0.17,-0.52 0.1,-0.1 0.19,-0.17 0.28,-0.21 0.08,-0.05 0.2,-0.07 0.34,-0.07l15.64 0c0.19,0 0.36,0.05 0.53,0.15 0.16,0.1 0.26,0.25 0.28,0.45 0.02,0.02 0.03,0.1 0.03,0.24l0 1.61c0,0.08 -0.02,0.18 -0.05,0.29 -0.02,0.1 -0.08,0.21 -0.17,0.31l-0.06 0.06c-0.09,0.07 -0.18,0.12 -0.28,0.14 -0.1,0.02 -0.19,0.03 -0.28,0.03l-15.62 0c-0.2,0 -0.37,-0.05 -0.51,-0.15 -0.02,-0.01 -0.03,-0.02 -0.05,-0.03 -0.01,-0.01 -0.02,-0.03 -0.04,-0.05 -0.08,-0.09 -0.15,-0.19 -0.18,-0.29 -0.04,-0.11 -0.05,-0.21 -0.05,-0.29l0 -1.42zm0 -5.93l0.04 -0.25c0,-0.16 0.06,-0.32 0.19,-0.48l0.11 -0.08c0.1,-0.09 0.21,-0.14 0.32,-0.17 0.11,-0.02 0.22,-0.02 0.32,-0.01l15.19 0c0.07,0 0.15,0.01 0.25,0.02 0.09,0.02 0.17,0.06 0.25,0.13 0.07,0.03 0.13,0.1 0.19,0.2 0.05,0.1 0.09,0.18 0.11,0.26 0.01,0.01 0.02,0.09 0.02,0.23l0 1.6c0,0.26 -0.08,0.46 -0.23,0.61 -0.15,0.16 -0.35,0.23 -0.61,0.23l-15.32 0c-0.07,0 -0.15,-0.01 -0.24,-0.02 -0.1,-0.02 -0.19,-0.06 -0.27,-0.13 -0.02,-0.01 -0.03,-0.03 -0.05,-0.03 -0.01,-0.01 -0.02,-0.03 -0.04,-0.06 -0.14,-0.11 -0.22,-0.26 -0.23,-0.45l0 -1.6zm0.02 -6.06c0.01,-0.08 0.03,-0.16 0.05,-0.25 0.02,-0.09 0.07,-0.18 0.14,-0.25l0.11 -0.08c0.1,-0.09 0.2,-0.15 0.32,-0.17 0.11,-0.03 0.21,-0.04 0.3,-0.03l15.43 0c0.15,0 0.28,0.03 0.38,0.09 0.12,0.07 0.2,0.14 0.27,0.2 0.06,0.07 0.11,0.17 0.14,0.31 0.01,0.08 0.02,0.13 0.03,0.16 0.01,0.04 0.01,0.07 0.01,0.08l0 1.61c0,0.1 -0.01,0.2 -0.04,0.31 -0.03,0.1 -0.09,0.21 -0.19,0.31 -0.1,0.08 -0.21,0.14 -0.31,0.17 -0.11,0.03 -0.21,0.04 -0.29,0.04l-15.54 0c-0.07,0 -0.15,-0.01 -0.24,-0.02 -0.1,-0.01 -0.18,-0.06 -0.25,-0.13 -0.03,-0.01 -0.05,-0.02 -0.06,-0.03 0,-0.01 -0.02,-0.02 -0.05,-0.03 -0.1,-0.1 -0.16,-0.21 -0.19,-0.31 -0.03,-0.11 -0.04,-0.21 -0.04,-0.29l0 -1.44c0,-0.04 0,-0.08 0.01,-0.13 0,-0.04 0.01,-0.08 0.01,-0.12z', 'M160.03 113.68c0,-0.09 0.02,-0.16 0.05,-0.23 0.04,-0.08 0.07,-0.15 0.1,-0.22l8.59 -13.22c0.03,-0.06 0.08,-0.12 0.15,-0.2 0.07,-0.08 0.16,-0.16 0.28,-0.23 0.13,-0.08 0.28,-0.13 0.45,-0.13l2.06 0c0.2,0 0.37,0.06 0.52,0.16 0.15,0.11 0.27,0.25 0.38,0.42l8.57 13.22c0.07,0.12 0.12,0.26 0.15,0.43 0,0.27 -0.12,0.49 -0.35,0.66 -0.18,0.08 -0.33,0.11 -0.45,0.11l-2.2 0c-0.18,0 -0.32,-0.03 -0.43,-0.11 -0.13,-0.07 -0.23,-0.15 -0.3,-0.24 -0.07,-0.1 -0.12,-0.17 -0.15,-0.23l-0.45 -0.7 -0.73 -1.1 -5.51 -8.52c-0.05,-0.06 -0.11,-0.06 -0.17,0l-3.43 5.29 -2.05 3.23 -1.18 1.8c-0.04,0.07 -0.1,0.15 -0.17,0.24 -0.07,0.08 -0.17,0.16 -0.28,0.23 -0.24,0.08 -0.39,0.11 -0.45,0.11l-2.21 0c-0.11,0 -0.26,-0.03 -0.45,-0.11 -0.23,-0.17 -0.34,-0.39 -0.34,-0.66z', 'M184.23 100.29c0,-0.2 0.08,-0.4 0.23,-0.6 0.1,-0.09 0.21,-0.15 0.31,-0.18 0.11,-0.04 0.21,-0.06 0.31,-0.06l1.88 0c0.1,0 0.2,0.02 0.3,0.05 0.11,0.02 0.21,0.09 0.29,0.19 0.1,0.1 0.17,0.2 0.19,0.31 0.03,0.11 0.05,0.2 0.05,0.29l0 9.83c0,0.25 0.02,0.43 0.06,0.56 0.04,0.13 0.09,0.22 0.15,0.28 0.07,0.06 0.17,0.11 0.29,0.15 0.12,0.04 0.31,0.06 0.57,0.06l12.62 0c0.24,0 0.44,0.08 0.6,0.24 0.15,0.16 0.23,0.36 0.23,0.6l0 1.61c0,0.08 -0.01,0.18 -0.05,0.29 -0.04,0.1 -0.1,0.21 -0.18,0.31 -0.1,0.1 -0.21,0.16 -0.31,0.19 -0.11,0.03 -0.21,0.04 -0.29,0.04l-13.13 0c-1.34,0 -2.36,-0.35 -3.07,-1.06 -0.7,-0.71 -1.05,-1.73 -1.05,-3.07l0 -10.03z', 'M218.51 99.45c0.1,0 0.2,0.02 0.31,0.06 0.11,0.03 0.21,0.09 0.31,0.18 0.16,0.2 0.23,0.4 0.23,0.6l0 1.61c0,0.25 -0.08,0.46 -0.24,0.61 -0.17,0.15 -0.37,0.22 -0.61,0.22l-6.69 0 0 10.89c0,0.08 -0.01,0.18 -0.04,0.29 -0.03,0.1 -0.09,0.21 -0.19,0.31 -0.09,0.1 -0.19,0.16 -0.29,0.19 -0.11,0.03 -0.21,0.04 -0.31,0.04l-1.84 0c-0.1,0 -0.21,-0.01 -0.32,-0.04 -0.1,-0.03 -0.2,-0.09 -0.28,-0.19 -0.11,-0.1 -0.17,-0.21 -0.2,-0.31 -0.03,-0.11 -0.04,-0.21 -0.04,-0.29l0 -10.89 -6.71 0c-0.08,0 -0.18,-0.01 -0.29,-0.04 -0.1,-0.03 -0.21,-0.09 -0.31,-0.17 -0.1,-0.1 -0.16,-0.21 -0.19,-0.31 -0.03,-0.11 -0.04,-0.21 -0.04,-0.31l0 -1.61c0,-0.24 0.08,-0.44 0.23,-0.6 0.16,-0.16 0.36,-0.24 0.6,-0.24l16.91 0z', 'M223.23 100.29c0,-0.24 0.08,-0.44 0.24,-0.6 0.16,-0.16 0.36,-0.24 0.6,-0.24l1.88 0c0.1,0 0.21,0.02 0.31,0.05 0.11,0.02 0.21,0.09 0.29,0.19 0.1,0.1 0.17,0.2 0.2,0.31 0.02,0.1 0.04,0.2 0.04,0.29l0 5.01 11.08 0 0 -5.01c0,-0.25 0.07,-0.45 0.23,-0.6 0.16,-0.16 0.36,-0.24 0.6,-0.24l1.87 0c0.1,0 0.2,0.02 0.31,0.06 0.11,0.03 0.21,0.09 0.31,0.18 0.15,0.2 0.23,0.4 0.23,0.6l0 13.33c0,0.25 -0.08,0.46 -0.24,0.61 -0.17,0.15 -0.37,0.22 -0.61,0.22l-1.87 0c-0.24,0 -0.44,-0.08 -0.6,-0.23 -0.16,-0.16 -0.23,-0.36 -0.23,-0.6l0 -5.04 -11.08 0 0 5.04c0,0.08 -0.02,0.18 -0.04,0.29 -0.03,0.1 -0.1,0.21 -0.2,0.31 -0.08,0.1 -0.18,0.16 -0.29,0.19 -0.1,0.03 -0.21,0.04 -0.31,0.04l-1.88 0c-0.24,0 -0.44,-0.08 -0.6,-0.23 -0.16,-0.16 -0.24,-0.36 -0.24,-0.6l0 -13.33z'],
    noosa: ['M490.25 85.91c0,-0.16 0.03,-0.29 0.1,-0.39 0.06,-0.09 0.12,-0.17 0.18,-0.22 0,-0.02 0.01,-0.03 0.02,-0.04l8.32 -8.86 -7.94 0c-0.19,0 -0.36,-0.07 -0.49,-0.2 -0.13,-0.12 -0.19,-0.29 -0.19,-0.48l0 -1.54c0,-0.19 0.06,-0.36 0.19,-0.49 0.13,-0.14 0.3,-0.2 0.49,-0.2l10.9 0c0.08,0 0.17,0.01 0.25,0.03 0.09,0.03 0.17,0.08 0.24,0.16 0.08,0.07 0.14,0.15 0.16,0.24 0.02,0.1 0.03,0.19 0.03,0.27l0 1.9c0,0.17 -0.03,0.3 -0.09,0.39 -0.07,0.09 -0.12,0.17 -0.17,0.23l-0.03 0.03 -8.33 8.87 7.94 0c0.07,0 0.15,0.01 0.24,0.04 0.08,0.02 0.17,0.07 0.25,0.15 0.08,0.07 0.14,0.15 0.16,0.24 0.02,0.09 0.03,0.17 0.03,0.25l0 1.55c0,0.19 -0.06,0.36 -0.19,0.49 -0.13,0.13 -0.29,0.19 -0.49,0.19l-10.9 0c-0.19,0 -0.36,-0.06 -0.49,-0.19 -0.13,-0.13 -0.19,-0.3 -0.19,-0.49l0 -1.93z', 'M499.03 67.6c0.34,0 0.55,-0.06 0.65,-0.19 0.05,-0.06 0.11,-0.15 0.15,-0.27 0.05,-0.13 0.07,-0.3 0.07,-0.52l0 -7.74c0,-0.23 -0.02,-0.4 -0.06,-0.52 -0.04,-0.12 -0.09,-0.21 -0.15,-0.27 -0.05,-0.05 -0.13,-0.09 -0.23,-0.13 -0.09,-0.03 -0.23,-0.05 -0.43,-0.05l-5.29 0c-0.36,0 -0.58,0.08 -0.7,0.23 -0.11,0.15 -0.16,0.4 -0.16,0.74l0 7.74c0,0.22 0.02,0.39 0.06,0.52 0.04,0.12 0.09,0.21 0.15,0.27 0.09,0.13 0.31,0.19 0.65,0.19l5.29 0zm-5.45 2.91c-1.13,0 -1.98,-0.29 -2.54,-0.88 -0.56,-0.58 -0.84,-1.44 -0.84,-2.57l0 -8.62c0,-1.1 0.28,-1.95 0.84,-2.54 0.56,-0.6 1.41,-0.9 2.54,-0.9l5.62 0c1.1,0 1.94,0.3 2.52,0.9 0.58,0.59 0.86,1.44 0.86,2.54l0 8.62c0,1.1 -0.28,1.95 -0.84,2.55 -0.56,0.6 -1.4,0.9 -2.54,0.9l-5.62 0z', 'M499.03 49.45c0.34,0 0.55,-0.07 0.65,-0.19 0.05,-0.06 0.11,-0.15 0.15,-0.28 0.05,-0.12 0.07,-0.29 0.07,-0.51l0 -7.75c0,-0.22 -0.02,-0.39 -0.06,-0.51 -0.04,-0.13 -0.09,-0.22 -0.15,-0.27 -0.05,-0.05 -0.13,-0.09 -0.23,-0.13 -0.09,-0.03 -0.23,-0.05 -0.43,-0.05l-5.29 0c-0.36,0 -0.58,0.08 -0.7,0.23 -0.11,0.15 -0.16,0.39 -0.16,0.73l0 7.75c0,0.22 0.02,0.39 0.06,0.51 0.04,0.13 0.09,0.22 0.15,0.28 0.09,0.12 0.31,0.19 0.65,0.19l5.29 0zm-5.45 2.91c-1.13,0 -1.98,-0.3 -2.54,-0.88 -0.56,-0.58 -0.84,-1.44 -0.84,-2.57l0 -8.62c0,-1.1 0.28,-1.95 0.84,-2.55 0.56,-0.59 1.41,-0.89 2.54,-0.89l5.62 0c1.1,0 1.94,0.3 2.52,0.89 0.58,0.6 0.86,1.45 0.86,2.55l0 8.62c0,1.09 -0.28,1.94 -0.84,2.54 -0.56,0.61 -1.4,0.91 -2.54,0.91l-5.62 0z', 'M490.13 21.89c0,-0.37 0.06,-0.7 0.2,-1.02 0.13,-0.32 0.32,-0.59 0.55,-0.82 0.23,-0.24 0.51,-0.42 0.82,-0.56 0.32,-0.13 0.66,-0.2 1.02,-0.2l0.02 0c0.04,0 0.07,0.02 0.07,0.07l0 11.19c0,0.25 0.02,0.44 0.07,0.58 0.04,0.14 0.1,0.24 0.16,0.3 0.05,0.06 0.14,0.11 0.25,0.15 0.11,0.04 0.27,0.06 0.46,0.06 0.37,0 0.62,-0.07 0.77,-0.22 0.09,-0.08 0.15,-0.18 0.21,-0.32 0.05,-0.14 0.09,-0.35 0.11,-0.62l0.42 -7.38c0.06,-1.17 0.38,-2.1 0.97,-2.78 0.59,-0.69 1.49,-1.03 2.71,-1.03 1.26,0 2.17,0.34 2.73,1.01 0.56,0.67 0.84,1.62 0.84,2.83l0 8.76c0,0.35 -0.06,0.68 -0.2,0.99 -0.13,0.32 -0.31,0.6 -0.54,0.84 -0.23,0.24 -0.5,0.43 -0.82,0.57 -0.31,0.14 -0.64,0.21 -0.99,0.23 -0.06,0 -0.09,-0.03 -0.09,-0.07l0 -0.65c0,-0.29 0,-0.67 0,-1.13 0,-0.46 0,-0.97 -0.01,-1.52 -0.01,-0.55 -0.01,-1.12 -0.01,-1.72 0,-0.61 0,-1.2 0,-1.78 0,-0.7 0,-1.41 0,-2.13 0,-0.72 -0.01,-1.46 -0.02,-2.23 0,-0.38 -0.06,-0.65 -0.18,-0.83 -0.12,-0.17 -0.38,-0.26 -0.76,-0.26 -0.36,0 -0.63,0.07 -0.79,0.21 -0.07,0.07 -0.14,0.17 -0.19,0.31 -0.06,0.15 -0.1,0.35 -0.11,0.62l-0.42 7.37c-0.07,1.18 -0.4,2.11 -0.98,2.79 -0.58,0.68 -1.49,1.02 -2.72,1.02 -1.25,0 -2.15,-0.34 -2.71,-1.02 -0.56,-0.68 -0.84,-1.62 -0.84,-2.83l0 -8.78z', 'M501.88 18.29c-0.07,0 -0.13,-0.01 -0.19,-0.04 -0.06,-0.03 -0.12,-0.06 -0.17,-0.08l-10.81 -7.03c-0.05,-0.02 -0.11,-0.06 -0.17,-0.12 -0.06,-0.06 -0.13,-0.14 -0.19,-0.23 -0.06,-0.1 -0.1,-0.23 -0.1,-0.37l0 -1.68c0,-0.16 0.04,-0.31 0.13,-0.43 0.09,-0.12 0.2,-0.22 0.34,-0.31l10.81 -7c0.1,-0.06 0.21,-0.1 0.35,-0.13 0.22,0 0.41,0.1 0.55,0.28 0.05,0.16 0.08,0.28 0.08,0.37l0 1.81c0,0.14 -0.03,0.25 -0.08,0.35 -0.06,0.1 -0.13,0.19 -0.21,0.24 -0.07,0.06 -0.13,0.1 -0.18,0.13l-0.58 0.36 -0.89 0.6 -6.97 4.5c-0.05,0.05 -0.05,0.1 0,0.14l4.32 2.8 2.65 1.69 1.47 0.96c0.06,0.04 0.12,0.08 0.19,0.14 0.07,0.06 0.14,0.14 0.2,0.23 0.05,0.2 0.08,0.32 0.08,0.37l0 1.8c0,0.09 -0.03,0.22 -0.08,0.37 -0.14,0.19 -0.33,0.28 -0.55,0.28z']
  };
  var LOGO_W = 502.58, LOGO_H = 114.45;
  function logo(doc, x, y, h, ink, blue) {
    var k = h / LOGO_H;
    LOGO.ink.concat(LOGO.noosa).forEach(function (d) { doc.path(d, x, y, k, { fill: ink }); });
    LOGO.blue.forEach(function (d) { doc.path(d, x, y, k, { fill: blue }); });
    return LOGO_W * k;
  }

  // ------------------------------------------------------------------ report blocks
  function header(doc, title, sub) {
    var top = doc.y, H = px(66);
    doc.rect(ML, top, CW, H, { r: px(6), fill: C.BLUE });
    doc.rect(ML, top, CW, H - px(4), { r: [px(6), px(6), px(2.5), px(2.5)], fill: C.DARK });
    var inner = top + px(11);
    var lw = logo(doc, ML + px(16), inner + px(3), px(34), C.WHITE, C.BLUE);   // the white/blue lockup on the dark band
    var right = ML + CW - px(15), tTop = inner + px(5.2), room = CW - px(16) - lw - px(30);
    // v43: a clinic battery's name is the title: smaller type (down to 11) and then … so it never runs into the logo
    var ts = 15, tt = String(title);
    while (ts > 11 && width(tt, 'bold', fs(ts)) > room) ts -= 0.5;
    while (tt.length > 4 && width(tt, 'bold', fs(ts)) > room) tt = tt.slice(0, -2).replace(/\s+$/, '') + '\u2026';
    var st = String(sub);
    while (st.length > 4 && width(st, 'bold', fs(9)) > room) st = st.slice(0, -2).replace(/\s+$/, '') + '\u2026';
    doc.text(tt, right, baseline(tTop, 15), { style: 'bold', size: fs(ts), color: C.WHITE, align: 'right' });
    doc.text(st, right, baseline(tTop + px(19.25), 9), { style: 'bold', size: fs(9), color: C.BLUE, align: 'right' });
    doc.y = top + H;
  }

  function dash(v) { v = clean(v).trim(); return v ? v : '—'; }

  // label/value pairs that wrap like the .meta flex row; size = CSS px (10 unless a report asks for larger type)
  function meta(doc, pairs, size, tight) {           // v32: tight = less space above and below (a second row)
    var sz = size || 10, pad = tight ? px(3) : px(10);
    var x0 = ML + px(2), maxW = CW - px(4), gapX = px(22), gapY = px(4), lh = lineH(sz);
    var lines = [[]], x = 0;
    pairs.forEach(function (p) {
      var label = p[0], value = dash(p[1]);
      var lw = width(label + ' ', 'bold', fs(sz));
      var vw = width(value, 'regular', fs(sz));
      var item = { label: label, value: value, lw: lw, w: lw + vw, vlines: null };
      if (item.w > maxW) {                          // long notes: wrap inside the row
        item.vlines = wrap(value, 'regular', fs(sz), maxW - lw);
        item.w = maxW;
      }
      if (lines[lines.length - 1].length && x + gapX + item.w > maxW) { lines.push([]); x = 0; }
      var line = lines[lines.length - 1];
      item.x = line.length ? x + gapX : 0;
      x = item.x + item.w;
      line.push(item);
    });
    var y = doc.y + pad;
    lines.forEach(function (line) {
      var rows = 1;
      line.forEach(function (it) {
        var bl = baseline(y, sz);
        doc.text(it.label, x0 + it.x, bl, { style: 'bold', size: fs(sz), color: C.BLUEINK });   // v32: 5.8:1 (the lighter blue was 3.3:1)
        (it.vlines || [it.value]).forEach(function (v, i) {
          doc.text(v, x0 + it.x + it.lw, bl + i * lh, { style: 'regular', size: fs(sz), color: C.INK });
        });
        rows = Math.max(rows, (it.vlines || [1]).length);
      });
      y += rows * lh + gapY;
    });
    doc.y = y - gapY + pad;
  }

  // Status symbols (tick, exclamation mark, cross, dash) so a status reads without colour. Drawn as filled shapes,
  // not font glyphs, so the PDF and the preview match exactly. Coordinates in a unit box centred on 0,0.
  var ICONS = {
    Green: [[[-0.34, 0.02], [-0.1, 0.27], [0.36, -0.27]]],
    Amber: [[[0, -0.37], [0, 0.1]]],
    Red: [[[-0.26, -0.26], [0.26, 0.26]], [[0.26, -0.26], [-0.26, 0.26]]],
    'n/a': [[[-0.27, 0], [0.27, 0]]],
    Guide: [[[-0.34, 0], [0.34, 0]], [[-0.17, -0.17], [-0.34, 0], [-0.17, 0.17]], [[0.17, -0.17], [0.34, 0], [0.17, 0.17]]]   // v28: a two-way arrow
  };
  function strokeShape(pts, hw) {                 // outline of a polyline, half width hw, mitred joins, flat ends
    var n = pts.length, nrm = [], left = [], right = [], i;
    for (i = 0; i < n - 1; i++) {
      var dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], L = Math.sqrt(dx * dx + dy * dy) || 1;
      nrm.push([-dy / L, dx / L]);
    }
    for (i = 0; i < n; i++) {
      var a = nrm[Math.max(0, i - 1)], b = nrm[Math.min(n - 2, i)];
      var mx = a[0] + b[0], my = a[1] + b[1], ml = Math.sqrt(mx * mx + my * my) || 1;
      mx /= ml; my /= ml;
      var k = hw / Math.max(0.3, mx * b[0] + my * b[1]);
      left.push([pts[i][0] + mx * k, pts[i][1] + my * k]);
      right.push([pts[i][0] - mx * k, pts[i][1] - my * k]);
    }
    return left.concat(right.reverse());
  }
  function statusIcon(doc, status, cx, cy, s, color) {   // s = box size in mm
    var lines = ICONS[status];
    if (!lines) return;
    var hw = 0.105 * s;
    lines.forEach(function (ln) {
      var pts = ln.map(function (p) { return [cx + p[0] * s, cy + p[1] * s]; });
      doc.poly(strokeShape(pts, hw), { fill: color });
      doc.circle(pts[0][0], pts[0][1], hw, { fill: color });                          // round ends
      doc.circle(pts[pts.length - 1][0], pts[pts.length - 1][1], hw, { fill: color });
    });
    if (status === 'Amber') doc.circle(cx, cy + 0.3 * s, 0.12 * s, { fill: color });
  }
  function iconW(size) { return px(size) * 0.78; }  // room a symbol takes beside text of this size (CSS px)

  function chip(doc, text, x, midY, color, o) {   // x = left edge (or right edge when o.right); o.icon = status
    o = o || {};
    var size = o.size || 9, padX = o.padX == null ? 7 : o.padX, padY = o.padY == null ? 1 : o.padY;
    var tw = width(text, 'bold', fs(size));
    var iw = o.icon && ICONS[o.icon] ? iconW(size) : 0, ig = iw ? px(size * 0.34) : 0;
    var w = tw + iw + ig + px(2 * padX), h = lineH(size) + px(2 * padY);
    var left = o.right ? x - w : x;
    doc.rect(left, midY - h / 2, w, h, { r: px(o.radius || 3), fill: color });
    var ink = inkOn(color);                         // v32: white words where they read at 4.5:1, else near-black
    if (iw) statusIcon(doc, o.icon, left + px(padX) + iw / 2, midY, px(size), ink);
    doc.text(text, left + px(padX) + iw + ig, baseline(midY - h / 2 + px(padY), size), { style: 'bold', size: fs(size), color: ink });
    return w;
  }
  // v32: the colour for words on a filled shape: white when it gives at least 4.5:1 (WCAG 2.2 SC 1.4.3), else near-black
  function luminance(hex) {
    var h = String(hex || '').replace('#', ''), c = [0, 2, 4].map(function (i) { var v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function inkOn(fill) { return /^#[0-9A-Fa-f]{6}$/.test(fill || '') && 1.05 / (luminance(fill) + 0.05) < 4.5 ? C.BLACK : C.WHITE; }
  function chipW(text, o) {                       // the width chip() will use
    o = o || {};
    var size = o.size || 9, padX = o.padX == null ? 7 : o.padX;
    var iw = o.icon && ICONS[o.icon] ? iconW(size) : 0;
    return width(text, 'bold', fs(size)) + iw + (iw ? px(size * 0.34) : 0) + px(2 * padX);
  }
  // the words a report uses for each status (engine.js holds them, shared with the screen and the AI)
  function words(kind) { return kind === 'rehab' ? E.STATUS_WORDS.rehab : E.STATUS_WORDS.target; }
  function tallyChips(kind, counts) {
    var t = E.TALLY_WORDS[kind === 'rehab' ? 'rehab' : 'target'];
    return [[t[0] + ': ' + counts.Green, C.G, 'Green'], [t[1] + ': ' + counts.Amber, C.A, 'Amber'], [t[2] + ': ' + counts.Red, C.R, 'Red']];
  }

  // "Compared against [pill]"  ...  [✓ On target: n] [! Close: n] [✕ Off target: n]
  function band(doc, lead, pillText, counts, size) {
    var sz = size || 10, top = doc.y, h = px(19.5 * sz / 10), mid = top + h / 2;
    var x = ML;
    var lw = doc.text(lead + ' ', x, baseline(mid - lineH(sz) / 2, sz), { style: 'regular', size: fs(sz), color: C.INK });
    var ptw = width(pillText, 'bold', fs(sz));
    var pw = ptw + px(18 + 2), ph = lineH(sz) + px(6 + 2);
    doc.rect(x + lw, mid - ph / 2, pw, ph, { r: px(4), fill: '#EAF1F9', stroke: '#BBD3EA', lw: px(1) });
    doc.text(pillText, x + lw + px(10), baseline(mid - lineH(sz) / 2, sz), { style: 'bold', size: fs(sz), color: C.BLUEINK });
    var right = ML + CW;
    for (var i = counts.length - 1; i >= 0; i--) {
      var w = chip(doc, counts[i][0], right, mid, counts[i][1], { size: sz, padX: 9, padY: 2, right: true, icon: counts[i][2] });
      right -= w + px(5);
    }
    doc.y = top + h + px(4);
  }

  // a section heading with its teal rule. opts.keep = room the content after it needs on the same page;
  // opts.size = heading size in CSS px (11 unless a report asks for larger type); opts.right = a note at the right end
  function section(doc, title, opts) {
    opts = opts || {};
    var ts = opts.size || 11;
    var h = px(12) + lineH(ts) + px(3 + 2) + px(5);
    if (opts.newPage) { if (doc.y > MT + 0.5) doc.newPage(); }
    else doc.ensure(h + (opts.keep || 0));
    var top = doc.y + (doc.y > MT + 0.5 ? px(12) : 0);
    doc.text(title, ML + px(2), baseline(top, ts), { style: 'bold', size: fs(ts), color: C.BLACK, cs: px(0.5) });
    if (opts.right) {
      var rs = opts.rightSize || 10;
      doc.text(opts.right, ML + CW - px(2), baseline(top + (lineH(ts) - lineH(rs)) / 2, rs), { style: 'bold', size: fs(rs), color: opts.rightColor || C.INK, align: 'right' });
    }
    var ly = top + lineH(ts) + px(3) + px(1);
    doc.line(ML + px(2), ly, ML + CW - px(2), ly, { stroke: C.BLUE, lw: px(2) });
    doc.y = ly + px(1) + px(5);
  }

  var CARD_SZ = { domain: 9.5, status: 8.5, count: 8 };
  function scorecard(doc, cards, sz) {
    if (!cards.length) return;
    sz = sz || CARD_SZ;
    var gap = 6, minW = 108, perLine = Math.max(1, Math.floor((CW_PX + gap) / (minW + gap)));
    var lines = [];
    for (var i = 0; i < cards.length; i += perLine) lines.push(cards.slice(i, i + perLine));
    // domain, then the worst status in it (symbol and word), then how many of its metrics are on target
    var cardH = px(1 + 5 + 4 + 1 + 1 + 7) + lineH(sz.domain) + lineH(sz.status) + lineH(sz.count);
    var subH = cards.some(function (c) { return c.sub != null; }) ? lineH(sz.count) : 0;   // v38: a Custom battery's region line
    cardH += subH;
    doc.y += px(2);
    lines.forEach(function (line) {
      doc.ensure(cardH);
      var w = (CW_PX - (line.length - 1) * gap) / line.length, x = ML;
      line.forEach(function (c) {
        var col = COL[c.worst], ink = TEXT_COL[c.worst] || col, top = doc.y;
        doc.rect(x, top, px(w), cardH, { r: px(5), fill: C.WHITE, stroke: C.LINE, lw: px(1) });
        doc.rect(x + px(0.5), top + px(0.5), px(w - 1), px(5.5), { r: [px(4.5), px(4.5), 0, 0], fill: col });
        var bt = top + px(1 + 5 + 4), lx = x + px(1 + 8);
        doc.text(c.domain, lx, baseline(bt, sz.domain), { style: 'bold', size: fs(sz.domain), color: C.BLACK });
        if (c.sub) doc.text(c.sub, lx, baseline(bt + lineH(sz.domain), sz.count), { style: 'regular', size: fs(sz.count), color: C.MUTE });
        var st = bt + lineH(sz.domain) + subH + px(1), iw = iconW(sz.status);
        statusIcon(doc, c.worst, lx + iw / 2, st + lineH(sz.status) / 2, px(sz.status), ink);
        doc.text(E.statusWord(c.worst, 'target'), lx + iw + px(3), baseline(st, sz.status), { style: 'bold', size: fs(sz.status), color: ink });
        doc.text(c.green + '/' + c.total + ' on target', lx, baseline(st + lineH(sz.status) + px(1), sz.count), { style: 'regular', size: fs(sz.count), color: C.MUTE });
        x += px(w + gap);
      });
      doc.y += cardH + px(gap);
    });
    doc.y += px(2 - gap);
  }

  function radar(doc, spokes, quadNote, headSize) {
    if (spokes.length < 3) return false;
    var u = CW / 480, H = 300 * u, n = spokes.length;
    section(doc, 'Athlete profile — key components', { keep: H + px(14), size: headSize });
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
    doc.text('Each axis = result vs the athlete’s age/sex norm target (dashed green ring). Dots show status.',   // v48: the "placeholder norm" caption went (Quad ISO has a sourced norm)
      ML + CW / 2, baseline(doc.y, 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE, align: 'center' });
    doc.y += lineH(7.5);
    return true;
  }

  // With 3 or 4 picks the profile is drawn as bars: a radar with so few spokes is a thin shape over a lot of page.
  // Each bar is the result as a share of its norm target, normalised exactly as the radar does (E.radarSpokes:
  // result ÷ target, or target ÷ result where lower is better), so 100% is the target whatever the unit.
  // Same 0-150% scale as the radar; a result beyond 150% fills the bar and gets a small arrow at the end.
  var BAR_SZ = { label: 13.33, value: 13.33, sub: 11 };  // CSS px: 10 pt labels and values, 8.25 pt status line
  function profileBars(doc, spokes, quadNote, headSize) {
    var CAP = 1.5, S = BAR_SZ;
    var widest = Math.max.apply(null, spokes.map(function (sp) { return width(sp.label, 'bold', fs(S.label)); }));
    var pad = px(6), labW = Math.min(px(170), Math.max(px(90), widest)), valW = px(122), gap = px(16), barH = px(16);
    var x0 = ML + pad, tx = x0 + labW + gap, xr = ML + CW - pad, tw = xr - valW - gap - tx;
    function X(s) { return tx + tw * Math.min(Math.max(s, 0), CAP) / CAP; }
    var valH = lineH(S.value) + px(1) + lineH(S.sub);
    var rows = spokes.map(function (sp) {
      var ll = wrap(sp.label, 'bold', fs(S.label), labW);
      return { sp: sp, ll: ll, h: Math.max(ll.length * lineH(S.label), valH, barH) + px(12) };
    });
    var lower = spokes.some(function (sp) { return sp.dir === 'Lower'; });
    var cap = wrap('Bar length = result as a % of the athlete’s norm target (dashed line = target).' +
      (lower ? ' For times, a faster time gives a longer bar.' : ''), 'italic', fs(7.5), CW - px(4));   // v48: no placeholder caption
    var topH = lineH(7.5) + px(3), axH = px(4) + lineH(7.5), capH = px(6) + cap.length * lineH(7.5);
    var total = topH + rows.reduce(function (s, r) { return s + r.h; }, 0) + axH + capH;
    section(doc, 'Athlete profile — key components', { keep: total, size: headSize });
    var top = doc.y, ys = [], y = top + topH;
    rows.forEach(function (r) { ys.push(y); y += r.h; });
    var last = rows.length - 1;
    var gTop = ys[0] + (rows[0].h - barH) / 2 - px(5), gBot = ys[last] + (rows[last].h + barH) / 2 + px(5);
    doc.line(X(0.5), gTop, X(0.5), gBot, { stroke: '#D7DCE5', lw: px(1) });              // faint 50% guide
    rows.forEach(function (r, i) {
      var sp = r.sp, mid = ys[i] + r.h / 2, bt = mid - barH / 2;
      var ink = TEXT_COL[sp.status] || C.MUTE, fill = COL[sp.status] || C.NA;
      r.ll.forEach(function (l, k) {
        doc.text(l, x0, baseline(mid - r.ll.length * lineH(S.label) / 2 + k * lineH(S.label), S.label), { style: 'bold', size: fs(S.label), color: C.INK });
      });
      doc.rect(tx, bt, tw, barH, { r: px(3), fill: '#F0F2F5' });
      var fw = X(sp.score) - tx;
      if (fw > 0.05) doc.rect(tx, bt, fw, barH, { r: px(3), fill: fill });
      if (sp.score > CAP) {                                                                // off the scale: arrow at the end
        var ax = tx + tw - px(5), ah = px(4.5);
        doc.poly([[ax - ah, mid - ah], [ax, mid], [ax - ah, mid + ah]], { fill: C.WHITE });
      }
      var vTop = mid - valH / 2;
      doc.text(E.fmt(sp.value) + (sp.unit ? ' ' + sp.unit : ''), xr, baseline(vTop, S.value), { style: 'bold', size: fs(S.value), color: C.BLACK, align: 'right' });
      var sub = E.statusWord(sp.status, 'target') + ' · ' + E.pyFixed(sp.score * 100, 0) + '%';
      var sTop = vTop + lineH(S.value) + px(1), sw = width(sub, 'bold', fs(S.sub)), iw = iconW(S.sub);
      statusIcon(doc, sp.status, xr - sw - px(3) - iw / 2, sTop + lineH(S.sub) / 2, px(S.sub), ink);
      doc.text(sub, xr, baseline(sTop, S.sub), { style: 'bold', size: fs(S.sub), color: ink, align: 'right' });
    });
    // the target: a dashed line over the bars, named above and on the scale below
    doc.line(X(1), gTop, X(1), gBot, { stroke: C.DARK, lw: px(1.6), dash: [px(4), px(3)] });
    var lab = { style: 'bold', size: fs(7.5), color: C.MUTE, cs: px(0.5) };
    doc.text('TARGET', X(1), baseline(top, 7.5), Object.assign({}, lab, { color: C.DARK, align: 'center' }));
    var ay = gBot + px(4);
    [[0, '0', 'left'], [0.5, '50%', 'center'], [1, '100%', 'center'], [1.5, '150%', 'right']].forEach(function (t) {
      doc.text(t[1], X(t[0]), baseline(ay, 7.5), Object.assign({}, lab, { align: t[2] }));
    });
    doc.y = ay + lineH(7.5) + px(6);
    cap.forEach(function (l) {
      doc.text(l, ML + CW / 2, baseline(doc.y, 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE, align: 'center' });
      doc.y += lineH(7.5);
    });
    return true;
  }
  // the profile the clinician picked: bars for 3-4 metrics, the radar for 5-6, nothing with fewer than 3
  function profile(doc, spokes, quadNote, headSize) {
    if (spokes.length < 3) return false;
    return spokes.length <= 4 ? profileBars(doc, spokes, quadNote, headSize) : radar(doc, spokes, quadNote, headSize);
  }

  // The flagged metrics, worst first: status chip, name, "= value · needs target · source" and the explainer line.
  // sz = CSS px sizes { name, detail, what, chip }; the screening report's page 1 uses larger type than the others.
  var PRIO_SZ = { name: 10, detail: 9, what: 8, chip: 9 };
  function prioLayout(prios, kind, sz) {
    sz = sz || PRIO_SZ;
    var W = words(kind);
    // one column for the chips, so the names line up whatever the status
    var cw = prios.length ? Math.max.apply(null, prios.map(function (r) { return chipW(W[r.status] || r.status, { icon: r.status, size: sz.chip }); })) : 0;
    return prios.map(function (r) {
      var name = r.name, word = W[r.status] || r.status;
      var detail = r.detail || ('= ' + E.fmt(r.result) + unitWord(r.unit) + (r.side ? ' (' + r.side + ' higher)' : '') +
        ' · needs ' + r.target);                       // v48: the norm's source moved to the For clinicians note under the list
      var nameW = width(name, 'bold', fs(sz.name));
      var detW = CW - px(12) - cw - px(8) - nameW - px(8);
      var dl = wrap(detail, 'regular', fs(sz.detail), Math.max(detW, px(120)));
      var contentH = Math.max(lineH(sz.chip) + px(2), lineH(sz.name), dl.length * lineH(sz.detail));
      // what the test measures (explainers.json), under the name in smaller muted text
      var nx = ML + px(6) + cw + px(8);
      var wl = r.what ? wrap(r.what, 'regular', fs(sz.what), ML + CW - px(6) - nx) : [];
      var whatH = wl.length ? px(1) + wl.length * lineH(sz.what) : 0;
      return { r: r, name: name, word: word, dl: dl, wl: wl, nx: nx, contentH: contentH, h: contentH + whatH + px(8) + px(1) };
    });
  }
  // v48: units for a reader who isn't a clinician: none for a score or an index ('AU'), 'out of 100' for a questionnaire
  function unitTxt(u) { u = String(u || '').trim(); return u === 'AU' ? '' : u; }   // v48: 'AU' (a score or index) prints as nothing
  function unitWord(u) { u = String(u || '').trim(); return !u || u === 'AU' ? '' : u === '/100' ? ' out of 100' : (u === '%' ? '%' : ' ' + u); }
  // v48: the norm sources once, under the priorities (until v47 each line ended with its star rating and population, which
  // the client can't use); grouped by source, naming the tests each covers when there is more than one source
  function sourceNote(prios) {
    var by = {}, order = [];
    prios.forEach(function (r) {
      var src = clean(r.detail ? '' : r.source || '').trim();
      if (!src) return;
      if (!by[src]) { by[src] = []; order.push(src); }
      by[src].push(r.name);
    });
    if (!order.length) return '';
    return 'For clinicians — norm sources: ' + order.map(function (x) { return x + (order.length > 1 ? ' (' + by[x].join(', ') + ')' : ''); }).join('; ') + '.';
  }
  function emptyPrioH(sz) { return lineH((sz || PRIO_SZ).name) + px(9); }
  // the room the first n items need (so a heading is never left without them)
  function prioKeep(prios, kind, sz, n) {
    if (!prios.length) return emptyPrioH(sz);
    return prioLayout(prios.slice(0, n), kind, sz).reduce(function (s, L) { return s + L.h; }, 0);
  }
  function priorities(doc, prios, emptyText, kind, sz) {
    sz = sz || PRIO_SZ;
    if (!prios.length) {
      var h0 = emptyPrioH(sz);
      doc.ensure(h0);
      doc.text(emptyText || '✓ Nothing flagged — all tested metrics on target.', ML + px(6), baseline(doc.y + px(4), sz.name), { style: 'regular', size: fs(sz.name), color: C.G });
      doc.line(ML, doc.y + h0 - px(0.5), ML + CW, doc.y + h0 - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y += h0;
      return;
    }
    prioLayout(prios, kind, sz).forEach(function (L) {
      var r = L.r, h = L.h, contentH = L.contentH;
      doc.ensure(h);
      var top = doc.y, mid = top + px(4) + contentH / 2;
      chip(doc, L.word, ML + px(6), mid, COL[r.status] || C.NA, { icon: r.status, size: sz.chip });
      doc.text(L.name, L.nx, baseline(mid - lineH(sz.name) / 2, sz.name), { style: 'bold', size: fs(sz.name), color: C.INK });
      var dTop = mid - L.dl.length * lineH(sz.detail) / 2;
      L.dl.forEach(function (l, i) {
        doc.text(l, ML + CW - px(6), baseline(dTop + i * lineH(sz.detail), sz.detail), { style: 'regular', size: fs(sz.detail), color: C.MUTE, align: 'right' });
      });
      L.wl.forEach(function (l, i) {
        doc.text(l, L.nx, baseline(top + px(4) + contentH + px(1) + i * lineH(sz.what), sz.what), { style: 'regular', size: fs(sz.what), color: C.MUTE });
      });
      doc.line(ML, top + h - px(0.5), ML + CW, top + h - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y = top + h;
    });
    var note = sourceNote(prios);                      // v48
    if (note) {
      var nls = wrap(note, 'italic', fs(sz.what), CW - px(12)), nh = px(4) + nls.length * lineH(sz.what);
      doc.ensure(nh);
      nls.forEach(function (l, i) { doc.text(l, ML + px(6), baseline(doc.y + px(4) + i * lineH(sz.what), sz.what), { style: 'italic', size: fs(sz.what), color: C.MUTE }); });
      doc.y += nh;
    }
  }

  function asymmetry(doc, groups, headSize, legs) {   // v43: legs: the clinic's tests measured on each leg ({ name, pct, higher })
    var rows = E.flatten(groups).filter(function (r) { return E.isAsym(r.name) && E.num(r.result) !== null; });
    (legs || []).forEach(function (x) { rows.push({ name: x.name + ' (L vs R)', result: x.pct, side: x.higher, status: '', norm: null }); });
    if (!rows.length) return;
    var rowH = px(22);
    // the caption stays with the last bar (never alone at the top of a page)
    var note = wrap('Bar length = asymmetry magnitude; faint ticks mark the balanced (on-target) limit. Direction = higher/dominant side.', 'italic', fs(7.5), CW - px(4));
    var noteH = px(5) + note.length * lineH(7.5);
    section(doc, 'Limb symmetry — L vs R', { keep: px(16) + rowH + (rows.length === 1 ? noteH : 0), size: headSize });
    var hy = doc.y + px(3);
    var o = { style: 'bold', size: fs(7.5), color: C.MUTE, cs: px(0.5) };
    doc.text('◀ LEFT higher', ML + px(2), baseline(hy, 7.5), o);
    doc.text('balanced', ML + CW / 2, baseline(hy, 7.5), Object.assign({ align: 'center' }, o));
    doc.text('RIGHT higher ▶', ML + CW - px(2), baseline(hy, 7.5), Object.assign({ align: 'right' }, o));
    doc.y = hy + lineH(7.5) + px(3);
    var SCALE = 25.0;
    rows.forEach(function (r, ri) {
      var pct = E.num(r.result);
      doc.ensure(rowH + (ri === rows.length - 1 ? noteH : 0));
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
    note.forEach(function (l) {
      doc.ensure(lineH(7.5));
      doc.text(l, ML + px(2), baseline(doc.y, 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE });
      doc.y += lineH(7.5);
    });
  }

  // prev = { value, kind }: the previous result on the same scale (a hollow ring, clamped to the bar ends), joined to
  // today's marker by a line coloured for a real gain (green), a real drop (red) or change within noise (grey).
  var LINK_COL = { gain: C.G, drop: C.R };
  function meterBar(doc, x, y, w, result, norm, prev) {
    var h = px(9), r = px(5);
    var pill = pillPolygon(x, y, w, h, r);
    doc.poly(pill, { fill: '#EEEEEE' });
    var m = E.meter(result, norm);
    if (!m) return false;
    var at = 0;
    m.segments.forEach(function (s, i) {
      var x0 = x + w * at / 100, x1 = x + w * Math.min(100, at + s.width) / 100;
      at += s.width;
      if (x1 - x0 < 0.001 || x0 >= x + w) return;
      var clipped = clipX(pill, x0, x1);
      if (clipped.length > 2) doc.poly(clipped, { fill: s.color === 'Guide' ? C.GUIDEZONE : COL[s.color] });
      if (s.color === 'Guide' && i) doc.rect(x0 - px(0.6), y, px(1.2), h, { fill: C.WHITE });   // v28: the band edges (0.60, 0.80), no colours
    });
    var mx = x + w * m.marker / 100, cy = y + h / 2;
    var p = prev ? E.meterAt(m, prev.value) : null;
    if (p !== null) {
      var bx = x + w * p / 100, rr = px(4.2);
      var a0 = Math.min(bx, mx), a1 = Math.max(bx, mx);
      if (a1 - a0 > 0.05) {                            // a pale trail over the bar between the two, with the line on it
        var trail = clipX(pill, a0, a1);
        if (trail.length > 2) doc.poly(trail, { fill: C.WHITE, fillOpacity: 0.62 });
      }
      if (a1 - a0 > rr) {
        var from = bx < mx ? bx + rr : bx - rr;        // from the ring's edge to the marker
        doc.line(from, cy, mx, cy, { stroke: LINK_COL[prev.kind] || C.MUTE, lw: px(2.2) });
      }
      doc.circle(bx, cy, rr, { stroke: C.WHITE, lw: px(3.6) });
      doc.circle(bx, cy, rr, { stroke: C.INK, lw: px(1.6) });
    }
    doc.rect(mx - px(1.5), y - px(2) - px(1.5), px(3 + 3), px(13 + 3), { r: px(3), fill: C.WHITE });
    doc.rect(mx, y - px(2), px(3), px(13), { r: px(2), fill: C.BLACK });
    return p !== null;
  }

  // grouped result rows (Full results / rehab body); kind = 'target' (screening) or 'rehab' picks the status words;
  // head = { title, size }: a section heading kept with the first group band and its first row
  function results(doc, groups, cols, tgtPrefix, tailH, kind, head) {
    tailH = tailH || 0;                             // the footer: never leave it alone on a new page
    var W = words(kind);
    var c1 = px(cols[0]), c2 = px(cols[1]), c4 = px(cols[2]), gap = px(8), pad = px(6);
    var c3 = CW - 2 * pad - c1 - c2 - c4 - 3 * gap;
    function rowLayout(r) {
      // name, unit (5px after the name) and "· L higher" flow together inside column 1
      var parts = [{ s: r.name, style: 'bold', size: 10, color: C.INK, gap: 0 },
        { s: unitTxt(r.unit), style: 'regular', size: 8.5, color: C.MUTE, gap: px(5) }];   // v48: no 'AU'
      if (r.side) parts.push({ s: '· ' + r.side + ' higher', style: 'bold', size: 8.5, color: C.BLUEINK, gap: width(' ', 'bold', fs(10)) });   // v32: 5.8:1
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
      var chg = r.change ? wrap(E.changeLabel(r.change, r.change_kind), 'bold', fs(8.5), c4) : [];
      var h1 = lines.length * lineH(10);
      var h3 = px(9 + 2) + lineH(8);
      var h4 = lineH(9) + px(2) + (chg.length ? px(2) + chg.length * lineH(8.5) : 0);
      return { lines: lines, chg: chg, h: Math.max(h1, lineH(13), h3, h4) + px(10) + px(1), h1: h1, h4: h4 };
    }
    if (head && groups.length) {
      var r0 = rowLayout(groups[0].rows[0]), only = groups.length === 1 && groups[0].rows.length === 1;
      section(doc, head.title, { keep: px(7) + lineH(9.5) + px(6) + r0.h + (only ? tailH : 0), size: head.size });
    }
    groups.forEach(function (gp, gi) {
      var bandH = lineH(9.5) + px(6), lastGroup = gi === groups.length - 1;
      var first = rowLayout(gp.rows[0]);
      doc.ensure(px(7) + bandH + first.h + (lastGroup && gp.rows.length === 1 ? tailH : 0));
      doc.y += px(7);
      var top = doc.y;
      doc.rect(ML, top, CW, bandH, { r: px(3), fill: C.GBAND });
      var bl = baseline(top + px(3), 9.5);
      doc.rect(ML + px(8), bl - px(7), px(7), px(7), { r: px(2), fill: C.BLUE });
      doc.text(gp.title, ML + px(8 + 7 + 7), bl, { style: 'bold', size: fs(9.5), color: C.WHITE, cs: px(0.4) });
      doc.y = top + bandH;
      gp.rows.forEach(function (r, idx) {
        var L = idx === 0 ? first : rowLayout(r);
        doc.ensure(L.h + (lastGroup && idx === gp.rows.length - 1 ? tailH : 0));
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
        meterBar(doc, x3, mTop, c3, r.result, r.norm, r.prev != null ? { value: r.prev, kind: r.change_kind } : null);
        doc.text((r.status === 'Guide' ? 'Not rated · ' : tgtPrefix + ' ') + r.target, x3, baseline(mTop + px(11), 8), { style: 'regular', size: fs(8), color: C.MUTE });   // v28: the DSI's bands, no target
        var x4r = ML + CW - pad, sTop = mid - L.h4 / 2;
        if (r.status) chip(doc, r.status === 'Guide' && r.guide ? r.guide : (W[r.status] || r.status), x4r, sTop + (lineH(9) + px(2)) / 2, COL[r.status] || C.NA, { right: true, icon: r.status });
        var kcol = r.change_kind === 'gain' ? C.G : (r.change_kind === 'drop' ? C.R : C.MUTE);
        L.chg.forEach(function (l, i) {
          doc.text(l, x4r, baseline(sTop + lineH(9) + px(4) + i * lineH(8.5), 8.5), { style: 'bold', size: fs(8.5), color: kcol, align: 'right' });
        });
        doc.line(ML, rtop + L.h - px(0.5), ML + CW, rtop + L.h - px(0.5), { stroke: C.LINE, lw: px(1) });
        doc.y = rtop + L.h;
      });
    });
  }

  // The clinician's interpretation (optionally drafted with AI): a tinted box with a teal edge.
  // Keeps paragraph breaks and splits across pages if it has to.
  function interpretation(doc, it, o) {
    o = o || {};
    var raw = String((it && it.text) || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return;
    var size = o.size || 10, LH = 1.45, lh = lineH(size, LH), bar = px(3), padX = px(10), padY = px(7), paraGap = px(5);
    var maxW = CW - bar - 2 * padX;
    var lines = [];
    raw.split(/\n\s*\n|\n/).forEach(function (para) {
      if (!clean(para).trim()) return;
      wrap(para, 'regular', fs(size), maxW).forEach(function (l, i) { lines.push({ s: l, gap: i === 0 && lines.length ? paraGap : 0 }); });
    });
    if (!lines.length) return;
    // v48: "reviewed" only once the clinician edited the draft or passed it (until v47 every AI draft printed as reviewed)
    var note = it.ai ? (it.reviewed === false ? 'Drafted with AI assistance.' : 'Drafted with AI assistance and reviewed by the clinician.') : '';
    var noteH = note ? px(4) + lineH(7.5) : 0;
    section(doc, 'Interpretation', { keep: 2 * padY + Math.min(3, lines.length) * lh, size: o.head });
    var i = 0;
    while (i < lines.length) {
      var avail = PAGE_H - MB - doc.y - 2 * padY, n = 0, h = 0;
      while (i + n < lines.length && h + lines[i + n].gap + lh <= avail + 0.01) { h += lines[i + n].gap + lh; n++; }
      if (!n) {
        if (doc.y > MT + 0.5) { doc.newPage(); continue; }
        n = 1; h = lh;                                 // a single line always goes somewhere
      }
      var top = doc.y, boxH = h + 2 * padY;
      doc.rect(ML, top, CW, boxH, { r: [0, px(3), px(3), 0], fill: '#F1F7F6' });
      doc.rect(ML, top, bar, boxH, { fill: C.BLUE });
      var y = top + padY;
      for (var k = 0; k < n; k++) {
        if (k) y += lines[i + k].gap;
        doc.text(lines[i + k].s, ML + bar + padX, baseline(y, size, LH), { style: 'regular', size: fs(size), color: C.INK });
        y += lh;
      }
      doc.y = top + boxH;
      i += n;
      if (i < lines.length) doc.newPage();
    }
    if (note) {
      doc.ensure(noteH);
      doc.text(note, ML + CW, baseline(doc.y + px(4), 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE, align: 'right' });
      doc.y += noteH;
    }
  }

  // A small line through one row's values: points spaced like the date columns, missing values skipped and the
  // available points joined. The last point is larger and coloured like the change since the first (green better,
  // red worse, grey otherwise). Fewer than two points: nothing is drawn.
  var SPARK = '#9AA3AD';
  function sparkline(doc, values, x, midY, w, h, col) {
    var n = values.length, pts = [];
    values.forEach(function (v, i) { var f = E.num(v); if (f !== null) pts.push([i, f]); });
    if (pts.length < 2 || n < 2) return false;
    var lo = Math.min.apply(null, pts.map(function (q) { return q[1]; })), hi = Math.max.apply(null, pts.map(function (q) { return q[1]; }));
    var xy = pts.map(function (q) {
      return [x + w * q[0] / (n - 1), hi === lo ? midY : midY + h / 2 - (q[1] - lo) / (hi - lo) * h];
    });
    doc.poly(xy, { stroke: SPARK, lw: px(1.3), closed: false });
    xy.slice(0, -1).forEach(function (q) { doc.circle(q[0], q[1], px(1.5), { fill: SPARK }); });
    var e = xy[xy.length - 1];
    doc.circle(e[0], e[1], px(2.7), { fill: col, stroke: C.WHITE, lw: px(0.8) });
    return true;
  }
  // the colour the "since first" change uses: green for a change in the better direction, red for worse, else grey
  function changeCol(r) {
    var delta = (r.first === null || r.last === null) ? null : r.last - r.first;
    if (delta === null) return C.MUTE;
    var good = r.dir === 'Higher' ? delta > 0 : (r.dir === 'Lower' ? delta < 0 : null);
    return delta === 0 || good === null ? C.MUTE : (good ? C.G : C.R);
  }

  // Progress across the client's saved sessions: one column per test date (this test last), one row per
  // metric measured more than once, a trend line, and the change from the first of those sessions to this one.
  // tailH = the footer's height: the last row keeps the note and the footer company (never a page with only those).
  function progressTable(doc, p, headSize, tailH) {
    if (!p || !p.rows || !p.rows.length) return;
    tailH = tailH || 0;
    var pad = px(6), gap = px(6), nameW = px(150), chgW = px(78), spkW = px(64);
    var n = p.dates.length, colW = (CW - 2 * pad - nameW - chgW - spkW - (n + 2) * gap) / n;
    var bandH = lineH(9.5) + px(6), headH = px(4) + lineH(7.5) + px(3);
    var x0 = ML + pad, xc = x0 + nameW + gap, xChg = ML + CW - pad, xs = xc + n * (colW + gap);
    function head() {
      var top = doc.y;
      doc.rect(ML, top, CW, bandH, { r: px(3), fill: C.GBAND });
      var bl = baseline(top + px(3), 9.5);
      doc.rect(ML + px(8), bl - px(7), px(7), px(7), { r: px(2), fill: C.BLUE });
      doc.text(String(p.dates[0]).toUpperCase() + ' → ' + String(p.dates[n - 1]).toUpperCase() + ' · ' + p.sessions + ' SESSIONS', ML + px(8 + 7 + 7), bl, { style: 'bold', size: fs(9.5), color: C.WHITE, cs: px(0.4) });
      var hy = baseline(top + bandH + px(4), 7.5), o = { style: 'bold', size: fs(7.5), color: C.MUTE, cs: px(0.5) };
      doc.text('METRIC', x0, hy, o);
      p.dates.forEach(function (d, i) {
        doc.text(String(d).toUpperCase(), xc + i * (colW + gap) + colW, hy, Object.assign({ align: 'right' }, i === n - 1 ? { color: C.BLACK } : o, { style: 'bold', size: fs(7.5), cs: px(0.5) }));
      });
      doc.text('TREND', xs + spkW / 2, hy, Object.assign({ align: 'center' }, o));
      doc.text('SINCE FIRST', xChg, hy, Object.assign({ align: 'right' }, o));
      doc.y = top + bandH + headH;
    }
    var layout = p.rows.map(function (r) {
      var ru = unitTxt(r.unit), nl = wrap(r.name, 'bold', fs(9), nameW), unitW = ru ? width(ru, 'regular', fs(8)) : 0;   // v48: no 'AU'
      var lastW = width(nl[nl.length - 1], 'bold', fs(9));
      var unitOwnLine = !!ru && lastW + px(5) + unitW > nameW;
      var lines = nl.length + (unitOwnLine ? 1 : 0);
      return { r: r, nl: nl, lastW: lastW, unitOwnLine: unitOwnLine, lines: lines, h: Math.max(lines * lineH(9), lineH(10)) + px(9) };
    });
    var note = wrap('Values from this client’s saved sessions on this device, up to the last 5 tests. Only metrics measured more than once are listed. Trend: the values left to right, the last point coloured like the change since the first.', 'italic', fs(7.5), CW - px(4));
    var noteH = px(4) + note.length * lineH(7.5), lastI = layout.length - 1;
    var firstTwo = layout[0].h + (lastI >= 1 ? layout[1].h : 0);
    section(doc, 'Progress over time', { keep: px(7) + bandH + headH + firstTwo + (lastI <= 1 ? noteH + tailH : 0), size: headSize });
    doc.y += px(7);
    head();
    layout.forEach(function (L, ri) {
      var r = L.r, h = L.h, lines = L.lines, nl = L.nl;
      if (!doc.fits(h + (ri === lastI ? noteH + tailH : 0))) { doc.newPage(); head(); }
      var top = doc.y, mid = top + h / 2, nTop = mid - lines * lineH(9) / 2;
      nl.forEach(function (l, i) {
        doc.text(l, x0, baseline(nTop + i * lineH(9), 9), { style: 'bold', size: fs(9), color: C.INK });
      });
      if (unitTxt(r.unit)) {
        doc.text(unitTxt(r.unit), L.unitOwnLine ? x0 : x0 + L.lastW + px(5), baseline(nTop + (L.unitOwnLine ? nl.length : nl.length - 1) * lineH(9), 9), { style: 'regular', size: fs(8), color: C.MUTE });
      }
      r.values.forEach(function (v, i) {
        var last = i === n - 1;
        doc.text(v === null || v === undefined ? '—' : E.fmt(v), xc + i * (colW + gap) + colW, baseline(mid - lineH(10) / 2, 10),
          { style: last ? 'bold' : 'regular', size: fs(10), color: v === null || v === undefined ? C.MUTE : (last ? C.BLACK : C.INK), align: 'right' });   // v32: a missing value's dash in the muted grey (5.8:1)
      });
      var delta = (r.first === null || r.last === null) ? null : r.last - r.first, col = changeCol(r);
      sparkline(doc, r.values, xs + px(6), mid, spkW - px(12), px(13), col);
      if (delta !== null) {
        var txt = (Math.abs(delta) < 10 ? E.pySigned(delta, 2).replace(/0+$/, '').replace(/\.$/, '') : E.pySigned(delta, 0)) +
          (r.first ? ' (' + E.pySigned(delta / r.first * 100, 0) + '%)' : '');
        doc.text(txt, xChg, baseline(mid - lineH(9) / 2, 9), { style: 'bold', size: fs(9), color: col, align: 'right' });
      }
      doc.line(ML, top + h - px(0.5), ML + CW, top + h - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y = top + h;
    });
    doc.y += px(4);
    note.forEach(function (l) {
      doc.ensure(lineH(7.5));
      doc.text(l, ML + px(2), baseline(doc.y, 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE });
      doc.y += lineH(7.5);
    });
  }

  // Words in several styles flowing as one paragraph: parts = [{ s, style, size (CSS px), color, keep, join }]. Words are
  // separated by one space and lines wrap at maxW. keep: the part never breaks inside; join: it stays on the same line
  // as the word before it. Returns lines of positioned words [{ s, x, style, size, color }].
  function flow(parts, maxW) {
    var units = [];
    parts.forEach(function (p) {
      var t = clean(p.s).trim();
      if (!t) return;
      (p.keep ? [t] : t.split(' ')).forEach(function (w, i) {
        var run = { s: w, style: p.style, size: p.size, color: p.color };
        if (i === 0 && p.join && units.length) units[units.length - 1].push(run);
        else units.push([run]);
      });
    });
    function sp(r) { return width(' ', r.style, fs(r.size)); }
    var lines = [[]], lx = 0;
    units.forEach(function (u) {
      var ww = u.reduce(function (a, r, k) { return a + (k ? sp(r) : 0) + width(r.s, r.style, fs(r.size)); }, 0);
      var gap = lx > 0 ? sp(u[0]) : 0;
      if (lx > 0 && lx + gap + ww > maxW) { lines.push([]); lx = 0; gap = 0; }
      if (u.length === 1 && ww > maxW) {                               // a very long word: split it
        var r0 = u[0];
        wrap(r0.s, r0.style, fs(r0.size), maxW).forEach(function (piece, k) {
          if (k) lines.push([]);
          lines[lines.length - 1].push({ s: piece, x: 0, style: r0.style, size: r0.size, color: r0.color });
          lx = width(piece, r0.style, fs(r0.size));
        });
        return;
      }
      var x = lx + gap;
      u.forEach(function (r, k) {
        if (k) x += sp(r);
        lines[lines.length - 1].push({ s: r.s, x: x, style: r.style, size: r.size, color: r.color });
        x += width(r.s, r.style, fs(r.size));
      });
      lx = x;
    });
    return lines;
  }

  // For the coach: the clinician's call on training (the app never works it out), any modifications and the next
  // retest, in a tinted band under the athlete details: green for Full training, amber for Modified, red for Rehab
  // only, neutral when only modifications or a date are given. One or two lines; longer text is cut with an ellipsis.
  var COACH = {
    'Full training': { fill: '#E7F3E8', edge: C.G, ink: C.G },
    'Modified': { fill: '#FCF0DC', edge: C.A, ink: TEXT_COL.Amber },
    'Rehab only': { fill: '#FBE6E6', edge: C.R, ink: C.R }
  };
  var COACH_NEUTRAL = { fill: '#EEF1F4', edge: '#8A93A0', ink: C.INK };
  function coachBand(doc, co) {
    if (!co) return;
    var status = COACH[co.status] ? co.status : '', mods = clean(co.mods).trim(), retest = clean(co.retest).trim();
    if (!status && !mods && !retest) return;
    var look = COACH[status] || COACH_NEUTRAL, size = 12, bar = px(4), padX = px(10), padY = px(6), maxW = CW - bar - 2 * padX;
    var parts = [];
    function part(s, style, color, o) { parts.push(Object.assign({ s: s, style: style, size: size, color: color || C.INK }, o || {})); }
    var KEEP = { keep: true }, WITH = { keep: true, join: true };      // phrases that never break across lines
    if (status) { part('Training status:', 'bold', null, KEEP); part(status, 'bold', look.ink, WITH); }
    else if (mods) part('Modifications:', 'bold', null, KEEP);
    if (mods) { if (status) part('·', 'regular', C.MUTE); part(mods, 'regular'); }
    if (retest) {
      if (status || mods) { part('·', 'regular', C.MUTE); part('Next retest', 'regular', null, KEEP); } else part('Next retest:', 'bold', null, KEEP);
      part(retest, 'bold', null, WITH);
    }
    var lines = flow(parts, maxW);
    if (lines.length > 2) {                                  // two lines at most: end the second with an ellipsis
      lines = lines.slice(0, 2);
      var l2 = lines[1];
      var over = function (w) { return w.x + width(w.s + '…', w.style, fs(size)) > maxW; };
      while (l2.length > 1 && (over(l2[l2.length - 1]) || l2[l2.length - 1].s === '·')) l2.pop();
      l2[l2.length - 1].s += '…';
    }
    var lh = lineH(size), h = 2 * padY + lines.length * lh, top = doc.y + px(2);
    doc.rect(ML, top, CW, h, { r: [0, px(3), px(3), 0], fill: look.fill });
    doc.rect(ML, top, bar, h, { fill: look.edge });
    lines.forEach(function (line, i) {
      line.forEach(function (w) {
        doc.text(w.s, ML + bar + padX + w.x, baseline(top + padY + i * lh, size), { style: w.style, size: fs(w.size), color: w.color });
      });
    });
    doc.y = top + h + px(6);
  }

  // ACL: the clinic's return-to-sport criteria (acl_norms.json "rts", checked by E.rtsCheck), two columns of
  // met / not yet / not tested with the value and what is needed, then the decision-support note. Kept together on
  // one page. Left off when none of the criteria could be checked yet.
  var RTS_LOOK = { met: ['Green', C.G], not: ['Red', C.R], untested: ['n/a', C.NA] };
  function rtsSection(doc, rts, headSize) {
    if (!rts || !rts.rows || !rts.rows.length || rts.untested === rts.rows.length) return;
    var gapC = px(22), colW = (CW - gapC) / 2, chipO = { size: 9, padX: 6, padY: 1 };
    var cw = Math.max.apply(null, ['met', 'not', 'untested'].map(function (k) { return chipW(E.RTS_WORDS[k], Object.assign({ icon: RTS_LOOK[k][0] }, chipO)); }));
    var half = Math.ceil(rts.rows.length / 2), cols = [rts.rows.slice(0, half), rts.rows.slice(half)];
    function cell(r) {
      var val = r.text;
      var vw = width(val, 'bold', fs(10)), lx = cw + px(8);
      var ll = wrap(r.label, 'bold', fs(10), colW - lx - vw - px(8));
      var sub = 'needs ' + r.target + (r.fallback ? ' · from ' + r.metric : '');
      var sl = wrap(sub, 'regular', fs(8), colW - lx);
      return { r: r, val: val, ll: ll, sl: sl, lx: lx, h: Math.max(lineH(10) * ll.length, lineH(9) + px(2)) + px(1) + sl.length * lineH(8) + px(9) };
    }
    var grid = [];
    for (var i = 0; i < half; i++) {
      var a = cell(cols[0][i]), b = cols[1][i] ? cell(cols[1][i]) : null;
      grid.push({ cells: [a, b], h: Math.max(a.h, b ? b.h : 0) });
    }
    var note = rts.note ? wrap(rts.note, 'italic', fs(7.5), CW - px(4)) : [];
    var bodyH = grid.reduce(function (s, g) { return s + g.h; }, 0) + px(2) + (note.length ? px(5) + note.length * lineH(7.5) : 0);
    var head = E.rtsSummary(rts);
    section(doc, rts.title || 'Return-to-sport criteria', { keep: bodyH, size: headSize, right: head });
    doc.y += px(2);
    grid.forEach(function (g) {
      var top = doc.y;
      g.cells.forEach(function (c, k) {
        if (!c) return;
        var x = ML + k * (colW + gapC), look = RTS_LOOK[c.r.status] || RTS_LOOK.untested, t = top + px(4);
        chip(doc, E.RTS_WORDS[c.r.status], x + px(4), t + (lineH(9) + px(2)) / 2, look[1], Object.assign({ icon: look[0] }, chipO));
        c.ll.forEach(function (l, j) {
          doc.text(l, x + px(4) + c.lx, baseline(t + j * lineH(10), 10), { style: 'bold', size: fs(10), color: C.INK });
        });
        doc.text(c.val, x + colW - px(4), baseline(t, 10), { style: 'bold', size: fs(10), color: c.r.value === null ? C.MUTE : C.BLACK, align: 'right' });   // v32: as above
        var st = t + Math.max(lineH(10) * c.ll.length, lineH(9) + px(2)) + px(1);
        c.sl.forEach(function (l, j) {
          doc.text(l, x + px(4) + c.lx, baseline(st + j * lineH(8), 8), { style: 'regular', size: fs(8), color: C.MUTE });
        });
        doc.line(x, top + g.h - px(0.5), x + colW, top + g.h - px(0.5), { stroke: C.LINE, lw: px(1) });
      });
      doc.y = top + g.h;
    });
    doc.y += px(2);
    if (note.length) {
      doc.y += px(5);
      note.forEach(function (l) {
        doc.text(l, ML + px(2), baseline(doc.y, 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE });
        doc.y += lineH(7.5);
      });
    }
  }

  function footerH(text, size) { var z = size || 8; return px(12) + px(2 + 6) + wrap(text, 'italic', fs(z), CW).length * lineH(z); }
  function footer(doc, text, size) {                // size (v32): the handout's Large print
    var z = size || 8, lines = wrap(text, 'italic', fs(z), CW);
    var h = px(12) + px(2 + 6) + lines.length * lineH(z);
    doc.ensure(h);
    var top = doc.y + px(12);
    doc.line(ML, top + px(1), ML + CW, top + px(1), { stroke: C.BLUE, lw: px(2) });
    lines.forEach(function (l, i) {
      doc.text(l, ML, baseline(top + px(8) + i * lineH(z), z), { style: 'italic', size: fs(z), color: C.MUTE });
    });
    doc.y = top + px(8) + lines.length * lineH(z);
  }

  // ------------------------------------------------------------------ the three reports
  // a legend line for the footer when any meter shows a previous result
  var METER_NOTE = 'Meters: black bar = this test, ring = previous result; the joining line is green for a real improvement, red for a real decline and grey within normal test variation.';
  function rowsHavePrev(groups) {
    return E.flatten(groups || []).some(function (r) { return r.prev != null && !!E.meter(r.result, r.norm); });
  }
  function withNote(text, on) { return on ? (text ? text + ' ' : '') + METER_NOTE : text; }

  // The screening report's first page is the one coaches read, often on a phone, so the screening report uses larger
  // type for its headings, athlete details, interpretation and priorities (the other reports keep their sizes).
  var P1 = { head: 13, meta: 11.33, band: 11.33, interp: 13.33, cards: { domain: 11, status: 10, count: 9.5 },
    prio: { name: 13.33, detail: 11.33, what: 10.67, chip: 10 } };
  function screening(d) {
    var doc = new Doc(), m = d.meta || {}, P = P1, custom = d.kind === 'custom';   // v36: the Custom battery prints as this report, named for what it is
    var built = custom && clean(d.built).trim() ? clean(d.built).trim() : '';   // v43: one of the clinic's batteries: its name is the title
    var title = built || (custom ? 'Custom Screening Battery' : 'Athlete Performance & Readiness Report');
    header(doc, title, built ? 'The clinic’s battery • Norms and the clinic’s targets • Change-vs-previous'
      : custom ? (clean(d.battery).trim() ? clean(d.battery).trim() + ' • ' : '') + 'Tests chosen by the clinician • Normative screening with change-vs-previous'
      : 'VALD Testing • Normative screening with change-vs-previous');
    var rh = custom && d.rehab ? d.rehab : null;      // v37: a Custom battery with rehab tests: the injured side and the phases
    meta(doc, [['Athlete', m.name], ['Date', m.date], ['Sport', m.sport], ['Clinician', m.tester], ['Age', m.age],
      ['Sex', m.sex], ['Mass', clean(m.mass).trim() ? clean(m.mass).trim() + ' kg' : '']].concat(rh ? [['Injured side', rh.injured]] : [],
      rh && rh.ham != null ? [['Hamstring phase', rh.ham]] : [], rh && rh.acl != null ? [['ACL phase', rh.acl]] : [], [['Notes', m.notes]]), P.meta);
    coachBand(doc, d.coach);
    band(doc, 'Compared against', d.popLabel || '—', tallyChips('target', d.counts), P.band);
    if (d.ageNote) {                                   // v48: a client over 60 against the all-ages norms
      var al = wrap(clean(d.ageNote), 'italic', fs(P.meta), CW - px(4)), ah = al.length * lineH(P.meta) + px(4);
      doc.ensure(ah);
      al.forEach(function (l, i) { doc.text(l, ML + px(2), baseline(doc.y + i * lineH(P.meta), P.meta), { style: 'italic', size: fs(P.meta), color: C.INK }); });
      doc.y += ah;
    }
    interpretation(doc, d.interp, { size: P.interp, head: P.head });
    var cards = E.scorecard(d.groups);
    if (cards.length) { section(doc, 'Overview by area', { keep: px(45), size: P.head }); scorecard(doc, cards, P.cards); }
    var keys = d.radarKeys && d.radarKeys.length ? d.radarKeys : null;
    var spokes = keys ? E.radarSpokes(d.groups, keys) : [];
    var quad = keys ? keys.some(function (k) { return k[0] === '__QUAD__'; }) : false;
    profile(doc, spokes, quad, P.head);
    // no forced page break: the priorities follow on the same page when the heading and the first two fit
    section(doc, 'Top priorities — worst first', { keep: prioKeep(d.prios, 'target', P.prio, 2), size: P.head });
    priorities(doc, d.prios, null, 'target', P.prio);
    asymmetry(doc, d.groups, P.head, d.legs);
    var foot = withNote('Norm confidence, in the For clinicians note: ★★★ strong · ★★☆ moderate · ★☆☆ weak. ' +   // v48
      'Norms are population- and protocol-dependent; targets reflect the selected reference population only. ' +
      (custom ? 'Strength tests are scored relative to body weight against the clinic’s targets; the clinic’s own tests are rated only where a target was set. ' : '') +
      (custom && d.closePct != null ? 'Tests from the clinic’s battery builder are rated against the clinic’s target: Close = within ' + String(Math.round(d.closePct * 10) / 10) + '% of it' + (d.closeOwn ? ', or the test’s own % where one is set (shown with its result)' : '') + '. ' : '') +   // v43
      (rh ? 'Rehab tests are compared with research norms for the typical case at the chosen phase (Close = up to 1 SD behind) and support, not replace, the return-to-play decision. ' : '') +   // v37
      'This report organises and displays testing data and is not medical advice.', rowsHavePrev(d.groups));
    results(doc, d.groups, [150, 52, 120], 'target', d.progress ? 0 : footerH(foot), 'target', { title: 'Full results', size: P.head });
    progressTable(doc, d.progress, P.head, footerH(foot));
    footer(doc, foot);
    return finish(doc, title, m.name);
  }

  function rehab(d) {
    var doc = new Doc(), m = d.meta || {}, acl = d.kind === 'acl';
    if (acl) {
      header(doc, 'ACL Rehab & Return-to-Play', 'ACLR research norms • injured-limb / symmetry tracking');
      meta(doc, [['Patient', m.name], ['Date', m.date], ['Injured side', m.injured], ['Graft', m.graft],
        ['Surgeon', m.surgeon], ['Months post-op', m.months], ['Sport', m.sport], ['Notes', m.notes]]);
    } else {
      header(doc, 'Hamstring Rehab & Return-to-Play', 'Injured-limb tracking vs phase targets • change-vs-previous');
      meta(doc, [['Patient', m.name], ['Date', m.date], ['Injured side', m.injured], ['Clinician', m.clinician],
        ['Wks since injury', m.weeks], ['Sport', m.sport], ['Notes', m.notes]]);
    }
    coachBand(doc, d.coach);
    band(doc, 'Rehab phase', acl ? d.phase + ' · ' + d.sex : d.phase, tallyChips('rehab', d.counts));
    interpretation(doc, d.interp);
    if (acl) rtsSection(doc, d.rts);
    var foot = withNote(d.disclaimer || '', rowsHavePrev(d.groups));
    results(doc, d.groups, acl ? [210, 56, 118] : [188, 56, 118], 'phase target', d.progress ? 0 : footerH(foot), 'rehab');
    progressTable(doc, d.progress, null, footerH(foot));
    footer(doc, foot);
    return finish(doc, acl ? 'ACL Rehab & Return-to-Play' : 'Hamstring Rehab & Return-to-Play', m.name);
  }


  // ------------------------------------------------------------------ v42: Ankle-GO
  // The total out of 25 and its band (the developers' cut-offs, decision support), each item's points on the injured leg,
  // then both legs side by side (each reach as % of that leg's length) and the progress table. Sources in the footer.
  var AGO_COL = { Green: C.G, Amber: C.A, Red: C.R };
  function agoV(x, unit) {
    if (x === null || x === undefined) return '—';
    var n = String(Math.round(x * 100) / 100);       // as typed: 9.5 s (not 9.50)
    return unit === '%' ? n + '%' : (unit === 'errors' ? n + (x === 1 ? ' error' : ' errors') : n + (unit ? ' ' + unit : ''));
  }
  function agoPts(p, max) { return p + ' of ' + max + (max === 1 ? ' pt' : ' pts'); }
  function agoScore(doc, d) {
    var g = d.ago, b = g.band, padX = px(12), padY = px(10), numW = px(118), textX = ML + padX + numW, textW = CW - padX * 2 - numW;
    var chipO = { size: 10, padX: 8, padY: 2, icon: b ? b.look : null };
    var body = b ? b.text : (g.tested ? 'The band shows once every item is in (' + g.done + ' of ' + g.items.length + ' items complete so far).' : 'No items tested yet.');
    var lines = wrap(body, b ? 'regular' : 'italic', fs(9.5), textW);
    var extra = [];
    if (g.noAppr && g.noAppr.length) extra.push('Apprehension not recorded: ' + g.noAppr.join(', ') + '.');
    if (g.prev) extra.push('Previous score ' + E.fmt(g.prev.value) + ' of ' + g.max + ' on ' + E.displayIso(g.prev.date) + (g.change ? ' · ' + E.changeLabel(g.change, g.change_kind) + ' points' : '') + '.');
    var exL = [];
    extra.forEach(function (t) { exL = exL.concat(wrap(t, 'bold', fs(9), textW)); });
    var chipH = b ? lineH(10) + px(4) + px(6) : 0;
    var h = Math.max(px(70), padY * 2 + chipH + lines.length * lineH(9.5, 1.35) + (exL.length ? px(5) + exL.length * lineH(9) : 0));
    section(doc, 'Ankle-GO score', { keep: h + px(4), right: g.total + ' of ' + g.max + (g.complete ? '' : ' so far') });
    var top = doc.y + px(2), look = b ? AGO_COL[b.look] : C.NA;
    doc.rect(ML, top, CW, h, { r: px(6), fill: '#F5F7F9', stroke: C.LINE, lw: px(1) });
    doc.rect(ML, top, px(5), h, { r: [px(6), 0, 0, px(6)], fill: look });
    var nx = ML + padX + px(4);
    var tw = doc.text(g.tested ? String(g.total) : '–', nx, baseline(top + h / 2 - lineH(34) / 2 - px(4), 34), { style: 'bold', size: fs(34), color: C.BLACK });
    doc.text('of ' + g.max, nx + tw + px(4), baseline(top + h / 2 - lineH(34) / 2 - px(4) + lineH(34) - lineH(12) - px(4), 12), { style: 'bold', size: fs(12), color: C.MUTE });
    doc.text(g.complete ? 'Ankle-GO' : 'so far', nx, baseline(top + h / 2 + lineH(34) / 2 - px(4), 9), { style: 'bold', size: fs(9), color: C.MUTE, cs: px(0.4) });
    var y = top + padY;
    if (b) { chip(doc, b.label + ' · ' + b.short, textX, y + (lineH(10) + px(4)) / 2, look, chipO); y += chipH; }
    lines.forEach(function (l) { doc.text(l, textX, baseline(y, 9.5), { style: b ? 'regular' : 'italic', size: fs(9.5), color: C.INK }); y += lineH(9.5, 1.35); });
    if (exL.length) y += px(5);
    exL.forEach(function (l) { doc.text(l, textX, baseline(y, 9), { style: 'bold', size: fs(9), color: C.INK }); y += lineH(9); });
    doc.y = top + h + px(2);
  }
  function agoItems(doc, d, tailH) {                   // ITEM & RULE | INJURED LEG | POINTS
    var g = d.ago, pad = px(6), gap = px(12), c3 = px(96), c2 = px(150), c1 = CW - 2 * pad - c2 - c3 - 2 * gap;
    var x1 = ML + pad, x2 = x1 + c1 + gap, x3 = ML + CW - pad;
    var bandH = lineH(9.5) + px(6), headH = px(4) + lineH(7.5) + px(3);
    function head() {
      var top = doc.y;
      doc.rect(ML, top, CW, bandH, { r: px(3), fill: C.GBAND });
      var bl = baseline(top + px(3), 9.5);
      doc.rect(ML + px(8), bl - px(7), px(7), px(7), { r: px(2), fill: C.BLUE });
      doc.text('ANKLE-GO ITEMS' + (g.injured ? ' · ' + g.injured.toUpperCase() + ' LEG (INJURED)' : ''), ML + px(8 + 7 + 7), bl, { style: 'bold', size: fs(9.5), color: C.WHITE, cs: px(0.4) });
      var hy = baseline(top + bandH + px(4), 7.5), o = { style: 'bold', size: fs(7.5), color: C.MUTE, cs: px(0.5) };
      doc.text('ITEM & HOW IT SCORES', x1, hy, o);
      doc.text('RESULT', x2, hy, o);
      doc.text('POINTS', x3, hy, Object.assign({ align: 'right' }, o));
      doc.y = top + bandH + headH;
    }
    var rows = g.items.map(function (it) {
      var nl = wrap(it.label, 'bold', fs(10), c1), rl = wrap(it.rule, 'regular', fs(8), c1);
      var unit = it.unit === '%' || /^FAAM|ALR/.test(it.label) ? '%' : it.unit;
      var sub = it.tested ? [] : ['not tested'];
      if (it.tested) {
        it.bonus.forEach(function (b) { sub.push(b.label + ': ' + (b.value === null ? '—' : (b.got ? 'yes' : 'no') + ' (' + agoV(b.value, '%') + ')')); });
        if (it.appr !== null) sub.push(it.appr === 'No' ? 'No apprehension' : (it.appr === 'Yes' ? 'Apprehension' : 'Apprehension not recorded'));
      }
      var sl = [];
      sub.forEach(function (t) { sl = sl.concat(wrap(t, 'regular', fs(8), c2)); });
      var h = Math.max(nl.length * lineH(10) + px(2) + rl.length * lineH(8), lineH(11) + (sl.length ? px(2) + sl.length * lineH(8) : 0)) + px(10) + px(1);
      return { it: it, nl: nl, rl: rl, sl: sl, h: h, unit: unit };
    });
    doc.ensure(px(7) + bandH + headH + rows[0].h + px(11));
    doc.y += px(7);
    head();
    rows.forEach(function (R, ri) {
      if (!doc.fits(R.h + (ri === rows.length - 1 ? tailH : 0))) { doc.newPage(); head(); }
      var top = doc.y, inner = top + px(5), it = R.it;
      R.nl.forEach(function (l, i) { doc.text(l, x1, baseline(inner + i * lineH(10), 10), { style: 'bold', size: fs(10), color: C.INK }); });
      var ry = inner + R.nl.length * lineH(10) + px(2);
      R.rl.forEach(function (l, i) { doc.text(l, x1, baseline(ry + i * lineH(8), 8), { style: 'regular', size: fs(8), color: C.MUTE }); });
      if (it.tested) doc.text(agoV(it.value, R.unit), x2, baseline(inner, 11), { style: 'bold', size: fs(11), color: C.BLACK });
      var sy = inner + (it.tested ? lineH(11) + px(2) : 0);
      R.sl.forEach(function (l, i) { doc.text(l, x2, baseline(sy + i * lineH(8), 8), { style: 'regular', size: fs(8), color: C.MUTE }); });
      var midY = inner + lineH(11) / 2;
      chip(doc, it.tested ? agoPts(it.pts, it.max) : '– of ' + it.max, x3, midY, it.tested ? AGO_COL[it.status] : C.NA, { right: true, size: 9, padX: 7, padY: 1, icon: it.tested ? it.status : 'n/a' });
      doc.line(ML, top + R.h - px(0.5), ML + CW, top + R.h - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y = top + R.h;
    });
  }
  function agoLegs(doc, d, tailH) {                    // MEASURE | LEFT | RIGHT | INJURED VS OTHER
    var g = d.ago, inj = g.injured ? g.injured.toLowerCase() : '';
    var list = [];
    (d.rows || []).forEach(function (gr) {
      gr.rows.forEach(function (r) {
        if (r.kind === 'q') return;
        var L = r.kind === 'comp' ? r.left : r.rawLeft, Rr = r.kind === 'comp' ? r.right : r.rawRight;
        if ((L === null || L === undefined) && (Rr === null || Rr === undefined)) return;
        function cell(sd) {
          var rawv = sd === 'left' ? r.rawLeft : r.rawRight, sc = sd === 'left' ? r.left : r.right;
          if (r.kind === 'comp') return { v: agoV(sc, '%'), sub: '' };
          if (rawv === null || rawv === undefined) return { v: '—', sub: '' };
          if (r.role === 'reach') return { v: agoV(sc, '%'), sub: agoV(rawv, 'cm') };
          return { v: agoV(rawv, r.raw), sub: '' };
        }
        var diff = '';
        if (inj && r.role !== 'len') {
          var a = inj === 'left' ? r.left : r.right, b = inj === 'left' ? r.right : r.left;
          if (a !== null && a !== undefined && b !== null && b !== undefined) {
            if (r.raw === 'errors') { var dd = a - b; diff = dd === 0 ? 'same' : (dd > 0 ? '+' : '−') + Math.abs(dd) + (Math.abs(dd) === 1 ? ' error' : ' errors'); }
            else if (b) {
              var pct = (a - b) / Math.abs(b) * 100, p = E.pyFixed(Math.abs(pct), 0);
              diff = p === '0' ? 'level' : p + '% ' + (r.unit === 's' ? (pct > 0 ? 'slower' : 'faster') : (pct < 0 ? 'lower' : 'higher'));
            }
          }
        }
        list.push({ name: r.name, l: cell('left'), r: cell('right'), diff: diff, role: r.role });
      });
    });
    if (!list.length) return;
    var pad = px(6), gap = px(10), c2 = px(120), c3 = px(120), c4 = px(150), c1 = CW - 2 * pad - c2 - c3 - c4 - 3 * gap;
    var x1 = ML + pad, x2 = x1 + c1 + gap, x3 = x2 + c2 + gap, x4 = ML + CW - pad;
    var headH = px(4) + lineH(7.5) + px(3), rowH = lineH(10) + px(10) + px(1);
    function head() {
      var hy = baseline(doc.y + px(4), 7.5), o = { style: 'bold', size: fs(7.5), color: C.MUTE, cs: px(0.5) };
      doc.text('MEASURE', x1, hy, o);
      doc.text('LEFT' + (inj === 'left' ? ' (INJURED)' : ''), x2, hy, Object.assign({}, o, inj === 'left' ? { color: C.BLACK } : {}));
      doc.text('RIGHT' + (inj === 'right' ? ' (INJURED)' : ''), x3, hy, Object.assign({}, o, inj === 'right' ? { color: C.BLACK } : {}));
      doc.text('INJURED VS OTHER', x4, hy, Object.assign({ align: 'right' }, o));
      doc.y += headH;
      doc.line(ML, doc.y - px(0.5), ML + CW, doc.y - px(0.5), { stroke: C.LINE, lw: px(1) });
    }
    section(doc, 'Both legs', { keep: headH + rowH * Math.min(3, list.length) + (list.length <= 3 ? tailH : 0) });
    head();
    list.forEach(function (r, i) {
      if (!doc.fits(rowH + (i === list.length - 1 ? tailH : 0))) { doc.newPage(); head(); }
      var top = doc.y, bl = baseline(top + px(5), 10);
      doc.text(r.name, x1, bl, { style: 'bold', size: fs(10), color: C.INK });
      [[r.l, x2, 'left'], [r.r, x3, 'right']].forEach(function (cc) {
        var w = doc.text(cc[0].v, cc[1], bl, { style: inj === cc[2] ? 'bold' : 'regular', size: fs(10), color: cc[0].v === '—' ? C.MUTE : C.BLACK });
        if (cc[0].sub) doc.text(cc[0].sub, cc[1] + w + px(6), bl, { style: 'regular', size: fs(8), color: C.MUTE });
      });
      doc.text(r.diff || '—', x4, bl, { style: r.diff ? 'bold' : 'regular', size: fs(9), color: r.diff ? C.INK : C.MUTE, align: 'right' });
      doc.line(ML, top + rowH - px(0.5), ML + CW, top + rowH - px(0.5), { stroke: C.LINE, lw: px(1) });
      doc.y = top + rowH;
    });
    var qs = [];
    (d.rows || []).forEach(function (gr) { gr.rows.forEach(function (r) { if (r.kind === 'q' && r.total !== null && r.total !== undefined && r.of) qs.push(r.name + ' ' + E.fmt(r.total) + ' of ' + r.of); }); });
    var note = 'Star excursion reaches as % of leg length (the reach in cm beside it), standing on the leg named.' + (qs.length ? ' Questionnaire totals: ' + qs.join(', ') + '.' : '');
    wrap(note, 'italic', fs(7.5), CW - px(4)).forEach(function (l) {
      doc.ensure(lineH(7.5));
      doc.text(l, ML + px(2), baseline(doc.y + px(3), 7.5), { style: 'italic', size: fs(7.5), color: C.MUTE });
      doc.y += lineH(7.5);
    });
    doc.y += px(3);
  }
  function ankle(d) {
    var doc = new Doc(), m = d.meta || {}, g = d.ago, title = 'Ankle-GO Return-to-Sport Score';
    header(doc, title, 'Lateral ankle sprain • 4 tests + 3 questionnaires • injured leg, out of 25');
    meta(doc, [['Patient', m.name], ['Date', m.date], ['Injured side', m.injured], ['Wks since injury', m.weeks],
      ['Clinician', m.clinician], ['Sport', m.sport], ['Notes', m.notes]]);
    coachBand(doc, d.coach);
    band(doc, 'Ankle-GO', g.tested ? g.total + ' of ' + g.max + (g.band ? ' · ' + g.band.label + ': ' + g.band.short : (g.complete ? '' : ' so far')) : 'not scored yet', tallyChips('rehab', d.counts));
    interpretation(doc, d.interp);
    agoScore(doc, d);
    var foot = (d.disclaimer || '') + (d.sources && d.sources.length ? ' Sources: ' + d.sources.join('; ') + '.' : '');
    var tail = d.progress ? 0 : footerH(foot);
    agoItems(doc, d, 0);
    agoLegs(doc, d, tail);
    progressTable(doc, d.progress, null, footerH(foot));
    footer(doc, foot);
    return finish(doc, title, m.name);
  }

  // ------------------------------------------------------------------ strength battery: left vs right table
  function strengthTable(doc, tests, tailH) {
    tailH = tailH || 0;
    var pad = px(6), gap = px(10);
    var c1 = px(200), c2 = px(190), c3 = px(190);
    var c4 = CW - 2 * pad - c1 - c2 - c3 - 3 * gap;
    var x1 = ML + pad, x2 = x1 + c1 + gap, x3 = x2 + c2 + gap, x4 = x3 + c3 + gap;
    var bandH = lineH(9.5) + px(6), headH = px(4) + lineH(7.5) + px(3);
    var cellH = lineH(11) + px(4) + px(9) + px(4) + lineH(7.5), chgH = px(1) + lineH(7.5);
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
    tests.forEach(function (t, ti) {
      var nameLines = wrap(t.name, 'bold', fs(10), c1);
      var sub = 'target ' + t.target + (t.rawTarget ? ' = ' + E.fmt(t.rawTarget.value) + ' ' + t.rawTarget.unit : '') + (t.detail ? ' · ' + t.detail : '');
      var subLines = wrap(sub, 'regular', fs(8), c1);
      var h1 = nameLines.length * lineH(10) + px(2) + subLines.length * lineH(8);
      var hasChg = ['L', 'R'].some(function (k) { return t.sides[k] && t.sides[k].change; });
      var h = Math.max(h1, cellH + (hasChg ? chgH : 0)) + px(10) + px(1);
      if (!doc.fits(h + (ti === tests.length - 1 ? tailH : 0))) { doc.newPage(); head(); }
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
        chip(doc, E.statusWord(cell.status, 'target'), x + w, inner + lineH(11) / 2, COL[cell.status] || C.NA, { right: true, size: 8.5, padX: 6, padY: 1, icon: cell.status });
        var my = inner + lineH(11) + px(4);
        meterBar(doc, x, my, w, cell.value, t.norm, cell.prev ? { value: cell.prev.value, kind: cell.change_kind } : null);
        var raw;
        if (t.input === 'calc') raw = 'ADD ' + E.fmt(cell.parts[0]) + ' N ÷ ABD ' + E.fmt(cell.parts[1]) + ' N';
        else raw = E.fmt(cell.input) + ' ' + (t.input === 'reps' ? 'reps' : t.input) + (cell.also != null ? ' · ' + E.fmt(cell.also) + ' × BW' : '');
        doc.text(raw, x, baseline(my + px(9) + px(4), 7.5), { style: 'regular', size: fs(7.5), color: C.MUTE });
        if (cell.change) {
          var kcol = cell.change_kind === 'gain' ? C.G : (cell.change_kind === 'drop' ? C.R : C.MUTE);
          var ctext = E.changeLabel(cell.change, cell.change_kind) + (cell.prev ? ' · was ' + cell.prev.text : '');
          doc.text(wrap(ctext, 'bold', fs(7.5), w)[0], x, baseline(my + px(9) + px(4) + lineH(7.5) + px(1), 7.5), { style: 'bold', size: fs(7.5), color: kcol });
        }
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
    meta(doc, [['Patient', m.name], ['Date', m.date], ['Mass', clean(m.mass).trim() ? clean(m.mass).trim() + ' kg' : ''],
      ['Sport', m.sport], ['Clinician', m.tester], ['Notes', m.notes]]);
    coachBand(doc, d.coach);
    band(doc, 'Scored against', 'BASE Health strength targets', tallyChips('target', c));
    interpretation(doc, d.interp);
    section(doc, 'Below target — worst first', { keep: px(22) });
    priorities(doc, d.prios.map(function (r) {
      return { status: r.status, name: r.name, detail: '= ' + r.text + ' · needs ' + r.target, what: r.what };
    }), '✓ Nothing below target — every tested result is on target.', 'target');
    section(doc, 'Results — left vs right', { keep: px(90) });
    var pct = d.amberPct == null ? 5 : d.amberPct;
    var prevShown = d.tests.some(function (t) {
      return ['L', 'R'].some(function (k) { var cl = t.sides[k]; return cl && cl.prev && cl.value !== null && !!E.meter(cl.value, t.norm); });
    });
    var foot = withNote('On target = at or above target · Close = within ' + pct + '% of target · Off target = further away. ' +
      'Loads are divided by body mass; forces are converted to N/kg (N ÷ kg) or × body weight (N ÷ (kg × 9.81)). ' +
      'Hip ratio = adduction ÷ abduction. L/R diff = gap between legs as a % of the stronger leg. ' +
      'BW = body weight · RM = repetition maximum. This report organises and displays testing data and is not medical advice.', prevShown);
    strengthTable(doc, d.tests.filter(function (t) { return t.any || t.sides.L.needsMass || t.sides.R.needsMass; }), d.progress ? 0 : footerH(foot));
    progressTable(doc, d.progress, null, footerH(foot));
    footer(doc, foot);
    return finish(doc, 'Lower-Limb Strength & Capacity', m.name);
  }

  // ------------------------------------------------------------------ exercise program handout (v10)
  // The program the practitioner checked on screen, for the patient: the meta row, the title and a general instructions
  // box when given, then one table. Exercise always; Sets, Reps, Load, Rest, Tempo, Side and Notes only when something
  // is written for at least one exercise (v48: until v47 Sets, Reps and Load printed empty when no dose was given). A dark band per section heading. A row never splits across pages; after a page
  // break the section band (marked continued) and the column header repeat, and a band or header never ends a page.
  var EX_COLS = [['name', 'EXERCISE'], ['sets', 'SETS'], ['reps', 'REPS'], ['load', 'LOAD'], ['rest', 'REST'], ['tempo', 'TEMPO'], ['side', 'SIDE'], ['notes', 'NOTES']];
  var EX_CORE = { name: 1 };
  var EX_WMM = { sets: [9, 16], reps: [11, 26], load: [14, 30], rest: [10, 18], tempo: [11, 22], side: [12, 22] };   // short columns: narrowest, roomiest (mm)
  var EX_SZ = 13.33, EX_HEAD = 9.33, EX_BAND = 10.5, EX_MAXLINES = 40;           // CSS px: 10 pt cells, 7 pt column labels, 7.9 pt bands
  var EX_TINT = '#F2F5F7';
  // characters the fonts lack but notes often use: fractions spelt out; emoji and invisible characters dropped; an
  // accented letter the fonts lack prints as its base letter (e.g. Nguyễn as Nguyen) rather than '?'
  var FRACTIONS = { '⅐': '1/7', '⅑': '1/9', '⅒': '1/10', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
    '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '↉': '0/3' };
  function exText(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFC');
    s = s.replace(/[⅐-⅞↉]/g, function (c) { return FRACTIONS[c] || c; })
      .replace(/[\uD800-\uDFFF]/g, '').replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060\uFEFF]/g, '');
    var out = '';
    for (var ch of s) {
      var cp = ch.codePointAt(0);
      if (cp < 128 || faceFor('regular', cp) || !ch.normalize) { out += ch; continue; }
      var base = ch.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
      out += base && base !== ch && Array.from(base).every(function (b) { return !!faceFor('regular', b.codePointAt(0)); }) ? base : ch;
    }
    return out;
  }

  // v15: the clinic's exercise library adds two things to a row. Cues (up to three short lines for the patient) print
  // under the exercise name, small and muted, two lines each at most. A video link adds a last VIDEO column to the table
  // with a QR code of the link in that row (and a link annotation over it, so the code can also be tapped in the PDF),
  // plus one line above the first band saying how to use the codes. Rows without cues or a video lay out exactly as in
  // v14, and a handout with neither is the v14 handout to the byte.
  var EX_CUE_SZ = EX_SZ * 0.9, EX_CUE_MAX = 3, EX_CUE_MAXLINES = 2, EX_CUE_DASH = '– ';   // 9 pt cues (v32: from 8.5)
  var EX_LABEL_SZ = 10.5;                            // the notes box's labels (v32: a variable, for Large print)
  var EX_VIDEO_COL = ['video', 'VIDEO'], EX_VIDEO_W = 17;                                   // the VIDEO column (mm)
  var EX_QR_MM = 14, EX_QR_QUIET = 2, EX_QR_MAXV = 10;          // code size (mm), white margin (modules), largest version
  var EX_NOTE_SZ = 12, EX_NOTE = 'Scan a code with your phone camera to watch the exercise.', EX_LINK_TEXT = 'Video link';
  // v34: the library's photo of an exercise (its 4:3 thumbnail as a JPEG data URL, r.photo) in a first column of its own,
  // top-aligned with the row's text, with a hairline frame; the row grows to fit it. Rows without one leave the column
  // blank; a handout with no photos lays out exactly as before.
  var EX_PHOTO_COL = ['photo', ''], EX_PHOTO_W = 24, EX_PHOTO_H = 18;               // the picture (mm), 4:3
  function exPhotoOk(v) { return typeof v === 'string' && v.length < 3000000 && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(v); }
  // v35: the client's program on their phone: a box after the notes with the private link's code, what it is for and
  // until when it works, and a link over the whole box (a PDF opened on the phone itself can't be scanned). The code
  // stays 22 mm in Large print; the words grow. d.phone = { url (a web address), until (the date as printed) }
  var EX_PHONE_QR = 22, EX_PHONE_TITLE = 'Your program on your phone';
  var EX_PHONE_TEXT = 'Scan the code with your phone’s camera to open these exercises, with their photos and videos. Then add the page to your home screen to keep it handy.';
  function exCues(list) {                            // tidy text lines, none empty, at most three
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (typeof c !== 'string' || out.length >= EX_CUE_MAX) return;
      var s = clean(exText(c)).trim().replace(/^[-–—•·*]+\s*/, '');   // the handout adds its own dash
      if (s) out.push(s);
    });
    return out;
  }
  // a link the handout can print: http(s) only (never javascript: and the like); spaces and characters outside ASCII
  // are percent-encoded so the QR code, the PDF link and the preview all carry the same plain address
  function exVideo(v) {
    if (typeof v !== 'string') return '';
    var s = v.trim();
    if (!/^https?:\/\/[^\s\/?#]/i.test(s)) return '';
    s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\x21-\x7E]/g, function (ch) {
      try { return encodeURIComponent(ch); } catch (e) { return ''; }    // a lone surrogate is dropped
    });
    return s.length <= 2000 ? s : '';
  }
  // The QR code of a link as rows of booleans (true = dark): qrcode-generator, error correction M (L when M would need
  // more than version 10), the smallest version that holds the link's UTF-8 bytes. null when the encoder is missing, when the link would need more than version 10
  // (57 modules: anything denser is hard to scan at 14 mm) or when anything goes wrong; the row then prints "Video link".
  // v34: an uploaded video's address (about 200 characters) may need error correction L to stay within version 10
  function qrMatrix(url) {
    if (typeof QR !== 'function') return null;
    try {
      if (QR.stringToBytesFuncs && QR.stringToBytesFuncs['UTF-8']) QR.stringToBytes = QR.stringToBytesFuncs['UTF-8'];
      var q = QR(0, 'M');
      q.addData(url, 'Byte');
      q.make();
      var n = q.getModuleCount();
      if (n > 17 + 4 * EX_QR_MAXV) {
        q = QR(0, 'L');
        q.addData(url, 'Byte');
        q.make();
        n = q.getModuleCount();
      }
      if (!(n >= 21 && n <= 17 + 4 * EX_QR_MAXV)) return null;
      var m = [];
      for (var r = 0; r < n; r++) {
        var row = [];
        for (var c = 0; c < n; c++) row.push(!!q.isDark(r, c));
        m.push(row);
      }
      return m;
    } catch (e) {
      return null;
    }
  }
  // the dark modules as one filled path, a rectangle per horizontal run (absolute M/L/Z), k = module size (mm)
  function qrSegs(m, x0, y0, k) {
    var segs = [];
    m.forEach(function (row, r) {
      var c = 0;
      while (c < row.length) {
        if (!row[c]) { c++; continue; }
        var s = c;
        while (c < row.length && row[c]) c++;
        var xa = x0 + s * k, xb = x0 + c * k, ya = y0 + r * k, yb = y0 + (r + 1) * k;
        segs.push(['M', xa, ya], ['L', xb, ya], ['L', xb, yb], ['L', xa, yb], ['Z']);
      }
    });
    return segs;
  }
  // one cue's lines: "– " and the cue wrapped under itself (a hanging indent), two lines at most (the second ends in "…")
  function exCueLines(cue, maxW) {
    var size = fs(EX_CUE_SZ), dw = width(EX_CUE_DASH, 'regular', size), w = Math.max(maxW - dw, px(20));
    var lines = wrap(cue, 'regular', size, w);
    if (lines.length > EX_CUE_MAXLINES) {
      lines = lines.slice(0, EX_CUE_MAXLINES);
      var l = lines[EX_CUE_MAXLINES - 1];
      while (l.length > 1 && width(l + '…', 'regular', size) > w) l = l.slice(0, -1);
      lines[EX_CUE_MAXLINES - 1] = l.replace(/\s+$/, '') + '…';
    }
    return lines.map(function (l, i) { return { s: i ? l : EX_CUE_DASH + l, dx: i ? dw : 0 }; });
  }
  // Column widths (mm). A short column gets what its longest value (or label) needs, within its limits, and never less
  // than its longest word (so "AMRAP" never breaks); when space is short they squeeze towards that. Exercise and Notes
  // share the rest (the one needing less keeps just what it needs); with no Notes, Exercise takes it all, and spare room
  // widens the short columns so the values sit nearer the names.
  function exWidths(cols, groups, avail) {
    var need = {}, word = {}, W = {};
    cols.forEach(function (c) {
      var k = c[0], style = k === 'name' ? 'bold' : 'regular', n = width(c[1], 'bold', fs(EX_HEAD), px(0.5)), wd = n;
      groups.forEach(function (g) {
        g.rows.forEach(function (r) {
          if (!r[k]) return;
          n = Math.max(n, width(r[k], style, fs(EX_SZ)));
          r[k].split(' ').forEach(function (w) { wd = Math.max(wd, width(w, style, fs(EX_SZ))); });
        });
      });
      need[k] = n + 0.3; word[k] = wd + 0.3;
    });
    var short = cols.map(function (c) { return c[0]; }).filter(function (k) { return EX_WMM[k]; });
    var notes = !!need.notes, lo = {}, sum = 0, loSum = 0;
    short.forEach(function (k) {
      lo[k] = Math.min(Math.max(EX_WMM[k][0], word[k]), EX_WMM[k][1]);
      W[k] = Math.min(Math.max(need[k], lo[k]), EX_WMM[k][1]);
      sum += W[k]; loSum += lo[k];
    });
    var flexMin = notes ? 96 : 56;
    if (avail - sum < flexMin && sum > loSum) {
      var f = Math.max(0, Math.min(1, (avail - flexMin - loSum) / (sum - loSum)));
      sum = 0;
      short.forEach(function (k) { W[k] = lo[k] + (W[k] - lo[k]) * f; sum += W[k]; });
    }
    var flex = avail - sum;
    if (!notes) {
      var target = Math.max(need.name + 6, 64), grow = short.map(function (k) { return EX_WMM[k][1] - W[k]; });
      var gs = grow.reduce(function (s, v) { return s + v; }, 0);
      if (flex > target && gs > 0) {
        var take = Math.min(flex - target, gs);
        short.forEach(function (k, i) { W[k] += take * grow[i] / gs; });
        flex -= take;
      }
      W.name = flex;
      return W;
    }
    if (need.name + need.notes <= flex) {
      var extra = (flex - need.name - need.notes) / 2;
      W.name = need.name + extra; W.notes = need.notes + extra;
    } else if (need.notes < flex / 2) { W.notes = need.notes; W.name = flex - W.notes; }
    else if (need.name < flex / 2) { W.name = need.name; W.notes = flex - W.name; }
    else { W.name = W.notes = flex / 2; }
    if (W.notes < 30) { W.notes = 30; W.name = flex - 30; }
    return W;
  }
  function exCellLines(v, style, maxW) {             // wrapped, at most EX_MAXLINES lines (the last one ends in an ellipsis)
    if (!v) return [];
    var lines = wrap(v, style, fs(EX_SZ), maxW);
    if (lines.length <= EX_MAXLINES) return lines;
    lines = lines.slice(0, EX_MAXLINES);
    var l = lines[EX_MAXLINES - 1];
    while (l.length > 1 && width(l + '…', style, fs(EX_SZ)) > maxW) l = l.slice(0, -1);
    lines[EX_MAXLINES - 1] = l.replace(/\s+$/, '') + '…';
    return lines;
  }
  function exTable(doc, groups, tailH) {
    var used = {};
    groups.forEach(function (g) { g.rows.forEach(function (r) { EX_COLS.forEach(function (c) { if (r[c[0]]) used[c[0]] = true; }); }); });
    var cols = EX_COLS.filter(function (c) { return EX_CORE[c[0]] || used[c[0]]; });
    // v15: a VIDEO column (fixed width, last) when any row has a video; the text columns share what is left as before
    var video = groups.some(function (g) { return g.rows.some(function (r) { return !!r.video; }); }), tcols = cols;
    if (video) cols = cols.concat([EX_VIDEO_COL]);
    // v34: a first column for the photos when any row has one
    var photo = groups.some(function (g) { return g.rows.some(function (r) { return exPhotoOk(r.photo); }); });
    if (photo) cols = [EX_PHOTO_COL].concat(cols);
    var ni = photo ? 1 : 0;                          // the EXERCISE column (the cues go under it)
    var pad = px(8), gap = px(10), lh = lineH(EX_SZ), padY = px(6), clh = lineH(EX_CUE_SZ);
    var avail = CW - 2 * pad - gap * (cols.length - 1);
    var W = exWidths(tcols, groups, avail - (video ? EX_VIDEO_W : 0) - (photo ? EX_PHOTO_W : 0)), xs = [], x = ML + pad;
    if (video) W.video = EX_VIDEO_W;
    if (photo) W.photo = EX_PHOTO_W;
    cols.forEach(function (c) { xs.push(x); x += W[c[0]] + gap; });
    var qrs = {};                                    // one code per distinct link
    function qrFor(url) { if (!Object.prototype.hasOwnProperty.call(qrs, url)) qrs[url] = qrMatrix(url); return qrs[url]; }
    var headH = px(6) + lineH(EX_HEAD) + px(5);
    function bandLines(title, cont) { return wrap(title.toUpperCase() + (cont ? ' (CONTINUED)' : ''), 'bold', fs(EX_BAND), CW - px(8 + 7.5 + 7 + 10), px(0.4)); }
    function bandH(title, cont) { return title ? bandLines(title, cont).length * lineH(EX_BAND) + px(8) : 0; }
    function band(title, cont) {                     // the section heading: dark band, teal square, white capitals
      if (!title) return;
      var lines = bandLines(title, cont), top = doc.y, h = bandH(title, cont);
      doc.rect(ML, top, CW, h, { r: px(3), fill: C.GBAND });
      var bl = baseline(top + px(4), EX_BAND);
      doc.rect(ML + px(8), bl - px(7.5), px(7.5), px(7.5), { r: px(2), fill: C.BLUE });
      lines.forEach(function (l, i) {
        doc.text(l, ML + px(8 + 7.5 + 7), bl + i * lineH(EX_BAND), { style: 'bold', size: fs(EX_BAND), color: C.WHITE, cs: px(0.4) });
      });
      doc.y = top + h;
    }
    function colHead() {                             // the column labels, repeated after every page break
      var top = doc.y, hy = baseline(top + px(6), EX_HEAD);
      cols.forEach(function (c, i) { if (c[1]) doc.text(c[1], xs[i], hy, { style: 'bold', size: fs(EX_HEAD), color: C.MUTE, cs: px(0.5) }); });   // (the photo column has no label)
      doc.line(ML, top + headH - px(0.5), ML + CW, top + headH - px(0.5), { stroke: '#D5DBE0', lw: px(1) });
      doc.y = top + headH;
    }
    function layout(r) {
      var cells = cols.map(function (c, i) { return c[0] === 'video' || c[0] === 'photo' ? [] : exCellLines(r[c[0]], c[0] === 'name' ? 'bold' : 'regular', W[c[0]]); });
      var n = Math.max.apply(null, [1].concat(cells.map(function (l) { return l.length; })));
      var L = { cells: cells, h: n * lh + 2 * padY };
      if (r.cues && r.cues.length) {                 // v15: the cues under the name; the row grows to fit them
        L.cues = [];
        r.cues.forEach(function (c) { L.cues = L.cues.concat(exCueLines(c, W.name)); });
        L.cueTop = cells[ni].length ? cells[ni].length * lh + px(1) : 0;
        L.h = Math.max(L.h, L.cueTop + L.cues.length * clh + 2 * padY);
      }
      if (photo && exPhotoOk(r.photo)) {             // v34: the photo
        L.photo = r.photo;
        L.h = Math.max(L.h, EX_PHOTO_H + 2 * padY);
      }
      if (video && r.video) {                        // v15: the code (or "Video link" when there can't be one)
        L.video = { url: r.video, m: qrFor(r.video) };
        L.h = Math.max(L.h, (L.video.m ? EX_QR_MM : lh) + 2 * padY);
      }
      return L;
    }
    // the code, top-aligned with the row's text, on a white square two modules wider all round (so a tinted row never
    // touches it), the dark modules as one path and a link over the square; without a code, "Video link" as a text link
    function videoCell(v, x, y) {
      if (v.m) {
        var k = EX_QR_MM / v.m.length, q = EX_QR_QUIET * k, s = EX_QR_MM + 2 * q;
        doc.rect(x - q, y - q, s, s, { fill: C.WHITE });
        doc.add({ t: 'path', segs: qrSegs(v.m, x, y, k), fill: C.BLACK });
        doc.link(x - q, y - q, s, s, v.url);
      } else {
        var w = doc.text(EX_LINK_TEXT, x, baseline(y, EX_SZ), { style: 'regular', size: fs(EX_SZ), color: C.BLUEINK });
        doc.link(x, y, w, lh, v.url);
      }
    }
    // "Scan a code…" above the first band (kept with it), when at least one code is printed: a handout whose links all
    // print as "Video link" (no encoder, or every link too long for a code) has nothing to scan
    var codes = video && groups.some(function (g) { return g.rows.some(function (r) { return r.video && qrFor(r.video); }); });
    var noteH = codes ? lineH(EX_NOTE_SZ) + px(4) : 0;
    var lastG = groups.length - 1;
    groups.forEach(function (g, gi) {
      var rows = g.rows.map(layout), title = g.heading;
      var lead = doc.y > MT + 0.5 ? px(gi ? 16 : 8) : 0;
      // the band and the column labels only start where the first row (and, for a one-row end, the footer) fits too
      var first = rows[0].h + (gi === lastG && rows.length === 1 ? tailH : 0);
      var start = lead + bandH(title, false) + headH + first;
      if (gi === 0 && noteH) start += noteH;
      if (!doc.fits(start) && doc.y > MT + 0.5) { doc.newPage(); lead = 0; }
      doc.y += lead;
      if (gi === 0 && noteH) {
        doc.text(EX_NOTE, ML + px(2), baseline(doc.y, EX_NOTE_SZ), { style: 'regular', size: fs(EX_NOTE_SZ), color: C.MUTE });
        doc.y += noteH;
      }
      band(title, false);
      colHead();
      rows.forEach(function (L, ri) {
        var need = L.h + (gi === lastG && ri === rows.length - 1 ? tailH : 0);
        if (!doc.fits(need)) { doc.newPage(); band(title, true); colHead(); }
        var top = doc.y;
        if (ri % 2 === 1) doc.rect(ML, top, CW, L.h, { fill: EX_TINT });
        L.cells.forEach(function (lines, ci) {
          var bold = cols[ci][0] === 'name';
          lines.forEach(function (l, li) {
            doc.text(l, xs[ci], baseline(top + padY + li * lh, EX_SZ), { style: bold ? 'bold' : 'regular', size: fs(EX_SZ), color: bold ? C.BLACK : C.INK });
          });
        });
        if (L.cues) {
          L.cues.forEach(function (cl, i) {
            doc.text(cl.s, xs[ni] + cl.dx, baseline(top + padY + L.cueTop + i * clh, EX_CUE_SZ), { style: 'regular', size: fs(EX_CUE_SZ), color: C.MUTE });
          });
        }
        if (L.photo) {                                 // v34: the photo in its frame, top-aligned with the text
          doc.image(L.photo, xs[0], top + padY, EX_PHOTO_W, EX_PHOTO_H);
          doc.rect(xs[0], top + padY, EX_PHOTO_W, EX_PHOTO_H, { stroke: '#D5DBE0', lw: px(0.75) });
        }
        if (L.video) videoCell(L.video, xs[cols.length - 1], top + padY);
        doc.y = top + L.h;
      });
      doc.line(ML, doc.y, ML + CW, doc.y, { stroke: '#D5DBE0', lw: px(1) });
    });
  }
  // v35: the phone box (see EX_PHONE_QR); nothing when the link can't be a code
  function exPhone(doc, ph) {
    var url = exVideo(ph && ph.url), m = url ? qrMatrix(url) : null;
    if (!m) return;
    var pad = px(12), q = EX_PHONE_QR, tx = ML + pad + q + px(14), tw = ML + CW - pad - tx;
    var ls = EX_LABEL_SZ, size = EX_SZ, small = EX_NOTE_SZ, LH = 1.3;
    var body = wrap(EX_PHONE_TEXT, 'regular', fs(size), tw), until = clean(exText(ph.until)).trim();
    var fine = until ? wrap('Your private link works until ' + until + '.', 'regular', fs(small), tw) : [];
    var th = lineH(ls) + px(3) + body.length * lineH(size, LH) + (fine.length ? px(4) + fine.length * lineH(small) : 0);
    var h = Math.max(q, th) + 2 * pad;
    doc.y += px(8);
    if (!doc.fits(h) && doc.y > MT + 0.5) doc.newPage();
    var top = doc.y, k = q / m.length;
    doc.rect(ML, top, CW, h, { r: px(3), fill: C.WHITE, stroke: C.BLUE, lw: px(1) });
    doc.add({ t: 'path', segs: qrSegs(m, ML + pad, top + pad, k), fill: C.BLACK });
    var y = top + pad + Math.max(0, (q - th) / 2);   // the words centred beside the code
    doc.text(EX_PHONE_TITLE, tx, baseline(y, ls), { style: 'bold', size: fs(ls), color: C.BLUEINK });
    y += lineH(ls) + px(3);
    body.forEach(function (l) { doc.text(l, tx, baseline(y, size, LH), { style: 'regular', size: fs(size), color: C.INK }); y += lineH(size, LH); });
    if (fine.length) {
      y += px(4);
      fine.forEach(function (l) { doc.text(l, tx, baseline(y, small), { style: 'regular', size: fs(small), color: C.MUTE }); y += lineH(small); });
    }
    doc.link(ML, top, CW, h, url);
    doc.y = top + h;
  }
  // the notes box (v32: Why this plan, then the general instructions, each with its label; until v31 the instructions alone): a
  // tinted box with a blue edge that keeps line breaks and splits across pages if it has to (like the interpretation box); a
  // label never ends a page's part of the box
  function exNotes(doc, parts) {
    var size = EX_SZ, LH = 1.4, lh = lineH(size, LH), bar = px(3), padX = px(10), padY = px(7), paraGap = px(4), ls = EX_LABEL_SZ, labelH = lineH(ls) + px(3), partGap = px(9);
    var maxW = CW - bar - 2 * padX, lines = [];
    parts.forEach(function (part) {
      var raw = String(part[1] || '').replace(/\r\n?/g, '\n').trim(), body = [], gapNext = 0;
      if (!raw) return;
      raw.split('\n').forEach(function (para) {
        if (!clean(para).trim()) { gapNext = paraGap; return; }
        wrap(para, 'regular', fs(size), maxW).forEach(function (l, i) { body.push({ s: l, h: lh, gap: i === 0 && body.length ? gapNext : 0 }); });
        gapNext = 0;
      });
      if (!body.length) return;
      lines.push({ s: part[0], label: true, h: labelH, gap: lines.length ? partGap : 0 });
      lines = lines.concat(body);
    });
    if (!lines.length) return;
    doc.y += px(4);
    var i = 0;
    while (i < lines.length) {
      var avail = PAGE_H - MB - doc.y - 2 * padY, n = 0, h = 0;
      while (i + n < lines.length && h + (n ? lines[i + n].gap : 0) + lines[i + n].h <= avail + 0.01) { h += (n ? lines[i + n].gap : 0) + lines[i + n].h; n++; }
      if (n > 1 && lines[i + n - 1].label && i + n < lines.length) { n--; h -= lines[i + n].gap + lines[i + n].h; }   // the label goes over with its text
      if (!n || (n === 1 && lines[i].label && i + 1 < lines.length)) {
        if (doc.y > MT + 0.5) { doc.newPage(); continue; }
        n = 1; h = lines[i].h;
      }
      var top = doc.y, boxH = h + 2 * padY;
      doc.rect(ML, top, CW, boxH, { r: [0, px(3), px(3), 0], fill: '#F1F7F6' });
      doc.rect(ML, top, bar, boxH, { fill: C.BLUE });
      var y = top + padY;
      for (var k = 0; k < n; k++) {
        var L = lines[i + k];
        if (k) y += L.gap;
        if (L.label) doc.text(L.s, ML + bar + padX, baseline(y, ls), { style: 'bold', size: fs(ls), color: C.BLUEINK });
        else doc.text(L.s, ML + bar + padX, baseline(y, size, LH), { style: 'regular', size: fs(size), color: C.INK });
        y += L.h;
      }
      doc.y = top + boxH;
      i += n;
      if (i < lines.length) doc.newPage();
    }
  }
  // v32: the footer names the clinician who prepared the program (the brand-research review: a plan with a visible author), and
  // says "clinician" as the rest of the page does
  var EX_FOOT = 'Prepared by BASE Health Noosa. Follow your clinician’s instructions.';
  function exFoot(who) { return who ? 'Prepared by ' + who + ' · BASE Health Noosa. Follow your clinician’s instructions.' : EX_FOOT; }
  // v32: Large print, for a client who finds small text hard to read: every size on the handout a quarter larger (the short
  // columns with room to match); the header band and the QR codes stay as they are
  var EX_LARGE = 1.25;
  function exercises(d) {
    if (!d.large) return exercisesAt(d, 1);
    var keep = [EX_SZ, EX_HEAD, EX_BAND, EX_CUE_SZ, EX_NOTE_SZ, EX_LABEL_SZ, EX_WMM, EX_PHOTO_W, EX_PHOTO_H];
    EX_SZ *= EX_LARGE; EX_HEAD *= EX_LARGE; EX_BAND *= EX_LARGE; EX_CUE_SZ *= EX_LARGE; EX_NOTE_SZ *= EX_LARGE; EX_LABEL_SZ *= EX_LARGE;
    EX_PHOTO_W *= EX_LARGE; EX_PHOTO_H *= EX_LARGE;   // v34: the photos too
    EX_WMM = {};
    Object.keys(keep[6]).forEach(function (k) { EX_WMM[k] = keep[6][k].map(function (v) { return v * EX_LARGE; }); });
    try { return exercisesAt(d, EX_LARGE); }
    finally { EX_SZ = keep[0]; EX_HEAD = keep[1]; EX_BAND = keep[2]; EX_CUE_SZ = keep[3]; EX_NOTE_SZ = keep[4]; EX_LABEL_SZ = keep[5]; EX_WMM = keep[6]; EX_PHOTO_W = keep[7]; EX_PHOTO_H = keep[8]; }
  }
  function exercisesAt(d, k) {
    var doc = new Doc(), m = d.meta || {}, foot = exFoot(clean(exText(m.practitioner)).trim()), fsz = 8 * k;
    header(doc, 'Exercise Program', 'Prescribed exercises • sets, reps and load');
    meta(doc, [['Patient', exText(m.name)], ['Date', m.date], ['Clinician', exText(m.practitioner)]], 10 * k);
    var title = clean(exText(d.title)).trim(), ts = 18 * k;
    if (title) {
      doc.y += px(2);
      wrap(title, 'bold', fs(ts), CW - px(4)).forEach(function (l) {
        doc.text(l, ML + px(2), baseline(doc.y, ts), { style: 'bold', size: fs(ts), color: C.BLACK });
        doc.y += lineH(ts);
      });
      doc.y += px(4);
    }
    // v32: the block and the next review under the title, then Why this plan and the general instructions in one box
    var weeks = /^\d{1,2}$/.test(String(d.weeks || '')) && +d.weeks > 0 ? +d.weeks : 0, review = clean(exText(d.review)).trim(), cover = [];
    if (weeks) cover.push(['Program length', weeks + (weeks === 1 ? ' week' : ' weeks')]);   // v48: was 'Block'
    if (review) cover.push(['Next review', review]);
    if (cover.length) meta(doc, cover, 10 * k, !!title);
    exNotes(doc, [['Why this plan', exText(d.reason)], ['General instructions', exText(d.instructions)]]);
    if (d.phone) exPhone(doc, d.phone);              // v35
    var groups = (d.groups || []).map(function (g) {
      return {
        heading: clean(exText(g.heading)).trim(),
        rows: (g.rows || []).map(function (r) {
          var o = {};
          EX_COLS.forEach(function (c) { o[c[0]] = clean(exText(r[c[0]])).trim(); });
          var cues = exCues(r.cues), video = exVideo(r.video);         // v15: from the clinic's exercise library
          if (cues.length) o.cues = cues;
          if (video) o.video = video;
          if (exPhotoOk(r.photo)) o.photo = r.photo;                   // v34: its photo
          return o;
        }).filter(function (o) { return EX_COLS.some(function (c) { return o[c[0]]; }); })
      };
    }).filter(function (g) { return g.rows.length; });
    exTable(doc, groups, footerH(foot, fsz));
    footer(doc, foot, fsz);
    return finish(doc, 'Exercise Program', exText(m.name));
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
    pdf.setProperties({ title: report.title, author: (info && info.author) || 'BASE Health Noosa', creator: 'BASE Health Report' });
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
        } else if (it.t === 'path') {
          if (it.fill) pdf.setFillColor(it.fill);
          pathPdf(pdf, it.segs);
          paint(pdf, it.fill, null);
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
        } else if (it.t === 'link') {                  // v15: a link annotation (the video links on the handout)
          pdf.link(it.x, it.y, it.w, it.h, { url: it.url });
        } else if (it.t === 'img') {                   // v34: an exercise photo (a picture that can't be read is left out)
          try { pdf.addImage(it.data, 'JPEG', it.x, it.y, it.w, it.h, undefined, 'FAST'); } catch (e) { /* left out */ }
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
        } else if (it.t === 'path') {
          var dd = it.segs.map(function (sg) { return sg[0] + sg.slice(1).map(n2).join(' '); }).join('');
          out.push('<path d="' + dd + '" fill="' + (it.fill || 'none') + '" fill-rule="nonzero"/>');
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
        } else if (it.t === 'link') {                  // v15: a transparent tap target that opens the link
          out.push('<a href="' + escXml(it.url) + '" target="_blank" rel="noopener"><rect x="' + n2(it.x) + '" y="' + n2(it.y) + '" width="' + n2(it.w) + '" height="' + n2(it.h) + '" fill="transparent"/></a>');
        } else if (it.t === 'img' && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(it.data)) {   // v34: an exercise photo
          out.push('<image href="' + it.data + '" x="' + n2(it.x) + '" y="' + n2(it.y) + '" width="' + n2(it.w) + '" height="' + n2(it.h) + '" preserveAspectRatio="xMidYMid slice"/>');
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

  return { screening: screening, rehab: rehab, ankle: ankle, strength: strength, exercises: exercises, toPdf: toPdf, toSvg: toSvg, fontFaces: fontFaces, _width: width, _wrap: wrap,
    qr: qrMatrix };                                  // v35: the phone link's code, for the app's Show code
});
