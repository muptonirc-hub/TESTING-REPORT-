/* BASE Health Report: scoring engine.
   JavaScript port of engine.py, the report helpers in report_pdf.py and vald_import.py.
   Pure functions with no dependencies. Numbers are rounded and formatted exactly the
   way Python does it, so results match the original app.
   Browser: window.BHEngine   Node: require('./engine.js') */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BHEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- numbers
  // Python float(): None/'' -> null, numeric text -> number, anything else -> null.
  function num(v) {
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    var s = String(v).trim();
    if (!s) return null;
    var f = Number(s);
    return Number.isNaN(f) ? null : f;
  }

  // What the entry boxes accept: spaces and thousands commas are ignored.
  function parseInput(s) {
    var t = String(s == null ? '' : s).trim().replace(/,/g, '');
    return t ? num(t) : null;
  }

  // Exact binary value of a double: |x| = mant * 2^exp
  function decompose(x) {
    var view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, x);
    var hi = view.getUint32(0), lo = view.getUint32(4);
    var e = (hi >>> 20) & 0x7ff;
    var mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    var exp;
    if (e === 0) exp = -1074; else { mant = mant | (1n << 52n); exp = e - 1075; }
    return { neg: (hi >>> 31) === 1, mant: mant, exp: exp };
  }

  // Python f"{x:.{d}f}": correctly rounded, ties to even.
  function pyFixed(x, d) {
    if (!Number.isFinite(x)) return String(x);
    if (x === 0) return (Object.is(x, -0) ? '-' : '') + (0).toFixed(d);
    var p = decompose(x);
    var n = p.mant * (10n ** BigInt(d));
    var q, rem = 0n, den = 1n;
    if (p.exp >= 0) q = n << BigInt(p.exp);
    else { den = 1n << BigInt(-p.exp); q = n / den; rem = n % den; }
    var twice = rem * 2n;
    if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
    var s = q.toString();
    if (d > 0) { s = s.padStart(d + 1, '0'); s = s.slice(0, -d) + '.' + s.slice(-d); }
    return (p.neg ? '-' : '') + s;
  }
  // Python f"{x:+.{d}f}"
  function pySigned(x, d) {
    var s = pyFixed(x, d);
    return s.charAt(0) === '-' ? s : '+' + s;
  }
  // Python round(x, d)
  function pyRound(x, d) { return Number(pyFixed(x, d)); }
  // Python str() of a JSON number (whole numbers shown without ".0")
  function pyStr(v) { return v === null || v === undefined ? 'None' : String(v); }

  // report_pdf.fmt(): how a value is printed on the report
  function fmt(v) {
    var f = num(v);
    if (f === null) return (v === null || v === undefined || v === '') ? '—' : String(v);
    if (Number.isInteger(f)) return String(f);
    if (Math.abs(f) >= 100) return pyFixed(f, 0);
    if (Math.abs(f) >= 10) return pyFixed(f, 1);
    return pyFixed(f, 2);
  }

  function isEmptyObj(o) { return !o || typeof o !== 'object' || Object.keys(o).length === 0; }

  // ---------------------------------------------------------------- status words (screen, PDF and AI payload)
  // Statuses stay Green / Amber / Red inside the app and in saved records; what people read says what each
  // one means. Screening and LL Strength compare with a target, the rehab tabs with the typical case at the phase
  // (v11: the rehab tabs share On target and Close; their rule, up to 1 SD behind, is in the status key).
  // v28: 'Guide' = a measure that is never rated (the DSI: Matthew, "it should never be seen as good or bad it simply helps
  // with what to prescribe"); its chip names the training emphasis instead (guideLabel)
  var STATUS_WORDS = {
    target: { Green: 'On target', Amber: 'Close', Red: 'Off target', 'n/a': 'No target', Guide: 'Guides training' },
    rehab: { Green: 'On target', Amber: 'Close', Red: 'Behind', 'n/a': 'No target', Guide: 'Guides training' }
  };
  var TALLY_WORDS = { target: ['On target', 'Close', 'Off target'], rehab: ['On target', 'Close', 'Behind'] };
  function statusWord(status, kind) {
    var w = STATUS_WORDS[kind === 'rehab' ? 'rehab' : 'target'];
    return w[status] || String(status || '');
  }

  // ---------------------------------------------------------------- engine.py
  function status(result, norm) {
    var r = num(result);
    if (r === null) return '';
    if (isEmptyObj(norm)) return 'n/a';
    var d = norm.dir, g = num(norm.green), a = num(norm.amber), gm = num(norm.gmax), am = num(norm.amax);
    if (d === 'Higher') {
      if (g !== null && r >= g) return 'Green';
      if (a !== null && r >= a) return 'Amber';
      return 'Red';
    }
    if (d === 'Lower') {
      if (g !== null && r <= g) return 'Green';
      if (a !== null && r <= a) return 'Amber';
      return 'Red';
    }
    if (d === 'Band') {
      if (g !== null && gm !== null && g <= r && r <= gm) return 'Green';
      if (a !== null && am !== null && a <= r && r <= am) return 'Amber';
      return 'Red';
    }
    if (d === 'Guide') return 'Guide';                 // v28: not rated (no colour, no count, never a priority)
    return 'n/a';
  }
  // v28: a 'Guide' norm ({ dir: 'Guide', low, high, labels: [below low, between, above high] }) names the training
  // emphasis a result points to; the DSI's: ballistic below 0.60, both between, maximal strength above 0.80
  var GUIDE_LABELS = ['Ballistic emphasis', 'Mixed emphasis', 'Strength emphasis'], GUIDE_SHORT = ['ballistic', 'mixed', 'strength'];
  function guideLabels(norm, key, dflt) {
    var L = norm && Array.isArray(norm[key || 'labels']) && norm[key || 'labels'].length === 3 ? norm[key || 'labels'] : (dflt || GUIDE_LABELS);
    return L.map(function (x, i) { return typeof x === 'string' && x.trim() ? x.trim() : (dflt || GUIDE_LABELS)[i]; });
  }
  function guideNum(v) { var x = num(v); return x === null ? '' : x.toFixed(2); }
  function guideLabel(result, norm) {
    var r = num(result);
    if (r === null || isEmptyObj(norm) || norm.dir !== 'Guide') return '';
    var lo = num(norm.low), hi = num(norm.high), L = guideLabels(norm);
    if (lo === null || hi === null) return '';
    return r < lo ? L[0] : (r > hi ? L[2] : L[1]);
  }

  function targetStr(norm) {
    if (isEmptyObj(norm)) return 'n/a';
    if (typeof norm.label === 'string' && norm.label.trim()) return norm.label.trim();   // v36: the target as the clinic writes it ('≥ 1/3 × BW')
    var d = norm.dir;
    if (d === 'Higher') return '≥ ' + pyStr(norm.green);
    if (d === 'Lower') return '≤ ' + pyStr(norm.green);
    if (d === 'Band') return pyStr(norm.green) + ' – ' + pyStr(norm.gmax);
    if (d === 'Guide') {                               // v28: the emphasis bands, no target ("below 0.60 ballistic · 0.60–0.80 mixed · above 0.80 strength")
      var S = guideLabels(norm, 'short', GUIDE_SHORT), lo = guideNum(norm.low), hi = guideNum(norm.high);
      return 'below ' + lo + ' ' + S[0] + ' · ' + lo + '–' + hi + ' ' + S[1] + ' · above ' + hi + ' ' + S[2];
    }
    return 'n/a';
  }

  // Direction-aware change flag -> [text, kind]; kind is gain | drop | noise | shift | ''
  function change(result, previous, direction, thr) {
    var r = num(result), p = num(previous), t = num(thr);
    if (r === null || p === null) return ['', ''];
    var delta = r - p;
    var pct = p ? (delta / p * 100) : null;
    var disp = Math.abs(delta) < 10
      ? pySigned(delta, 2).replace(/0+$/, '').replace(/\.+$/, '')
      : pySigned(delta, 0);
    if (pct !== null) disp += ' (' + pySigned(pct, 0) + '%)';
    if (t !== null && Math.abs(delta) < t) return ['– within noise   ' + disp, 'noise'];
    var good;
    if (direction === 'Higher') good = delta > 0;
    else if (direction === 'Lower') good = delta < 0;
    else return ['● meaningful shift   ' + disp, 'shift'];
    return good ? ['▲ real gain   ' + disp, 'gain'] : ['▼ real drop   ' + disp, 'drop'];
  }
  // What people read for a change flag, on screen and in the PDFs (v11). change() keeps its own text: the parity
  // tests pin it and the AI payload reads its numbers. The word carries the direction, so a real change is unsigned:
  //   '▲ real gain   +1.3 (+4%)'      -> '▲ Improved 1.3 (4%)'       '▼ real drop   -0.6 (-1%)' -> '▼ Worse 0.6 (1%)'
  //   '– within noise   +1.3 (+4%)'   -> '+1.3 (+4%) · no real change'  '● meaningful shift   +2 (+5%)' -> '● Shifted +2 (+5%)'
  function changeLabel(text, kind) {
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    var m = /[+\-−]?\d[\d.]*(?: \([+\-−]?\d[\d.]*%\))?$/.exec(s);
    if (!m) return s;
    var amount = m[0];
    if (kind === 'gain' || kind === 'drop') return (kind === 'gain' ? '▲ Improved ' : '▼ Worse ') + amount.replace(/[+\-−](?=\d)/g, '');
    if (kind === 'noise') return amount + ' · no real change';   // v48: was 'within noise' (jargon on a client's report)
    if (kind === 'shift') return '● Shifted ' + amount;
    return s;
  }

  function blank(v) { return v === null || v === undefined || v === ''; }

  // inputs: { metricName: {result, previous, side} }  (result/previous already parsed to numbers)
  function buildRows(inputs, population, norms, ageBand, mass) {
    var popnorms = (norms.populations || {})[population] || {};
    var band = {};
    if (ageBand && ageBand !== 'All ages') {
      band = (((norms.age_norms || {})[population]) || {})[ageBand] || {};
    }
    var mkg = num(mass);
    var cmj = num((inputs['CMJ Peak Force'] || {}).result);
    var imtp = num((inputs['IMTP Peak Force'] || {}).result);
    var dsiVal = (cmj && imtp) ? pyRound(cmj / imtp, 2) : null;
    var groups = [];
    norms.groups.forEach(function (g) {
      var rows = [];
      g.metrics.forEach(function (m) {
        var name = m.name;
        var inp = inputs[name] || {};
        var prevForChange = inp.previous;
        var result;
        if (m.calc === 'DSI') {
          result = dsiVal;
        } else if (m.calc === 'PERKG' || m.calc === 'PERBW' || m.calc === 'XBW' || m.calc === 'PCTBW' || m.calc === 'NPCTBW') {
          // v36: XBW (a load in kg ÷ body mass) and PCTBW (the same × 100): the LL Strength tests inside a custom battery
          // v43: NPCTBW (a force in N as % of body weight: N ÷ (kg × 9.81) × 100), a battery builder test's target as % BW
          var div = mkg === null ? null : m.calc === 'PERBW' ? mkg * 9.81 : m.calc === 'NPCTBW' ? mkg * 9.81 / 100 : m.calc === 'PCTBW' ? mkg / 100 : mkg;
          var raw = num(inp.result);
          result = (raw && mkg) ? pyRound(raw / div, 2) : null;
          var pr = num(inp.previous);
          prevForChange = (pr && mkg) ? pyRound(pr / div, 2) : null;
        } else {
          result = inp.result;
        }
        if (blank(result)) return;
        var bn = band[name];
        var norm = !isEmptyObj(bn) ? bn : (popnorms[name] === undefined ? null : popnorms[name]);
        var ch = change(result, prevForChange, m.dir, m.thr);
        rows.push({
          name: name, unit: m.unit, result: result, status: status(result, norm), guide: guideLabel(result, norm),   // v28: guide
          target: targetStr(norm), source: (norm && norm.source) || '', norm: norm,
          change: ch[0], change_kind: ch[1], side: inp.side || '',
          prev: num(prevForChange)                   // the previous result in the scored unit (for the meter)
        });
      });
      if (rows.length) groups.push({ title: g.title, rows: rows });
    });
    return groups;
  }

  function flatten(groups) {
    var out = [];
    groups.forEach(function (g) { g.rows.forEach(function (r) { out.push(r); }); });
    return out;
  }

  function counts(groups) {
    var c = { Green: 0, Amber: 0, Red: 0 };
    flatten(groups).forEach(function (r) { if (r.status in c) c[r.status] += 1; });
    return c;
  }

  function priorities(groups, n) {
    n = n === undefined ? 5 : n;
    var order = { Red: 0, Amber: 1 };
    var flagged = flatten(groups).filter(function (r) { return r.status in order; });
    flagged.sort(function (a, b) { return order[a.status] - order[b.status]; });
    return flagged.slice(0, n);
  }

  // Hamstring / ACL rows: result vs the selected phase's targets
  function buildRehabRows(inputs, phaseKey, set) {
    var pnorms = (set.norms || {})[phaseKey] || {};
    var groups = [];
    set.groups.forEach(function (g) {
      var rows = [];
      g.metrics.forEach(function (m) {
        var name = m.name;
        var inp = inputs[name] || {};
        var result = inp.result;
        if (blank(result)) return;
        var norm = pnorms[name] === undefined ? null : pnorms[name];
        var ch = change(result, inp.previous, m.dir, m.thr);
        rows.push({
          name: name, unit: m.unit, result: result, status: status(result, norm), guide: guideLabel(result, norm),   // v28: guide
          target: targetStr(norm), source: (norm && norm.source) || '', norm: norm,
          side: '', change: ch[0], change_kind: ch[1], prev: num(inp.previous)
        });
      });
      if (rows.length) groups.push({ title: g.title, rows: rows });
    });
    return groups;
  }

  // ---------------------------------------------------------------- v42: Ankle-GO (Picot et al. 2024)
  // set = ankle_go.json; values = the page's boxes as typed ({ name: { left, right, result, appr } }); injured = 'Left' |
  // 'Right'. Each leg's value per row in the scored unit (a reach as % of that leg's length: the other leg's length when
  // only one is typed; the composite the mean of its three reaches), then each item's points on the injured side: its
  // steps (the first that holds), its bonus rows and the apprehension point ('No' = 1, 'Yes' = 0, '' = not answered).
  // The total, its maximum, and the band: once every item is in, or before that when the points still to come can't
  // move the total out of the band it is in.
  function agoTest(op, a, b) { return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : false; }
  function agoBand(set, total) {
    var hit = null;
    (set.bands || []).forEach(function (b) { if (!hit && total >= b.min && total <= b.max) hit = b; });
    return hit;
  }
  function ankleGo(set, values, injured) {
    values = values || {};
    var inj = injured === 'Left' ? 'left' : (injured === 'Right' ? 'right' : ''), oth = inj === 'left' ? 'right' : (inj === 'right' ? 'left' : '');
    var metrics = {}, order = [];
    (set.groups || []).forEach(function (g) { g.metrics.forEach(function (m) { metrics[m.name] = m; order.push(m); }); });
    function V(n) { return values[n] || {}; }
    var len = { left: null, right: null }, lenName = '';
    order.forEach(function (m) { if (m.role === 'len' && !lenName) lenName = m.name; });
    if (lenName) {
      var l0 = parseInput(V(lenName).left), r0 = parseInput(V(lenName).right);
      len.left = l0 > 0 ? l0 : (r0 > 0 ? r0 : null);
      len.right = r0 > 0 ? r0 : (l0 > 0 ? l0 : null);
    }
    var sides = { left: {}, right: {} }, raw = { left: {}, right: {} }, qs = {};
    order.forEach(function (m) {
      if (m.kind === 'q') { qs[m.name] = parseInput(V(m.name).result); return; }
      ['left', 'right'].forEach(function (sd) {
        if (m.kind === 'lr') {
          var x = parseInput(V(m.name)[sd]);
          raw[sd][m.name] = x;
          if (m.role === 'reach') sides[sd][m.name] = x !== null && len[sd] ? pyRound(x / len[sd] * 100, 1) : null;
          else sides[sd][m.name] = x;
        } else if (m.kind === 'comp') {
          var parts = (m.from || []).map(function (n) { var p = sides[sd][n]; return p === undefined ? null : p; });
          sides[sd][m.name] = parts.length && parts.every(function (p) { return p !== null; }) ? pyRound(parts.reduce(function (a, b) { return a + b; }, 0) / parts.length, 1) : null;
        }
      });
    });
    function onInj(n) { var m = metrics[n]; if (!m) return null; if (m.kind === 'q') return qs[n]; return inj ? sides[inj][n] : null; }
    function onOth(n) { var m = metrics[n]; if (!m || m.kind === 'q' || !oth) return null; return sides[oth][n]; }
    var total = 0, max = 0, hi = 0, done = 0, items = [], noAppr = [];
    (set.items || []).forEach(function (it) {
      var v = onInj(it.metric), o = onOth(it.metric), base = 0, bonus = [], appr = null, pts = 0;
      if (v !== null) for (var i = 0; i < (it.steps || []).length; i++) { if (agoTest(it.steps[i].op, v, it.steps[i].value)) { base = it.steps[i].pts; break; } }
      (it.bonus || []).forEach(function (b) {
        var bv = onInj(b.metric), got = bv !== null && agoTest(b.op, bv, b.value);
        bonus.push({ metric: b.metric, label: b.label || b.metric, value: bv, got: got, pts: got ? b.pts : 0 });
      });
      if (it.appr) { var a = V(it.metric).appr; appr = a === 'No' ? 'No' : (a === 'Yes' ? 'Yes' : ''); }
      if (v !== null) {
        pts = base + bonus.reduce(function (s, b) { return s + b.pts; }, 0) + (appr === 'No' ? 1 : 0);
      }
      var tested = v !== null, complete = tested && (!it.appr || appr !== '');
      if (tested && it.appr && appr === '') noAppr.push(it.label);
      total += pts; max += it.max;
      hi += complete ? pts : (tested ? pts + 1 : it.max);
      if (complete) done++;
      items.push({ id: it.id, label: it.label, metric: it.metric, unit: (metrics[it.metric] || {}).unit || '', dir: (metrics[it.metric] || {}).dir || '',
        value: v, other: o, base: base, bonus: bonus, appr: it.appr ? appr : null, pts: pts, max: it.max, tested: tested, complete: complete,
        status: !tested ? '' : (pts >= it.max ? 'Green' : (pts > 0 ? 'Amber' : 'Red')), rule: it.rule || '' });
    });
    var lo = agoBand(set, total), up = agoBand(set, hi);
    var complete = done === items.length && items.length > 0;
    return { injured: injured === 'Left' || injured === 'Right' ? injured : '', sides: sides, raw: raw, len: len, q: qs, items: items,
      total: total, max: max, hi: hi, done: done, complete: complete, tested: items.filter(function (x) { return x.tested; }).length,
      noAppr: noAppr, band: lo && up && lo === up && items.some(function (x) { return x.tested; }) ? lo : null };
  }

  // ACL: limb symmetry index, operated / non-operated x 100 (app.py rule)
  function lsi(left, right, injured) {
    var l = num(left), r = num(right);
    if (!(l && r) || (injured !== 'Left' && injured !== 'Right')) return null;
    var operated = injured === 'Left' ? l : r;
    var other = injured === 'Left' ? r : l;
    return other ? pyRound(operated / other * 100, 1) : null;
  }

  // ---------------------------------------------------------------- screening population (app.py)
  var GEN_M = 'General Clinical — Male (all ages)';
  var GEN_F = 'General Clinical — Female (all ages)';

  function ageToBand(age) {
    var a = num(age);
    if (a === null || !Number.isFinite(a)) return 'All ages';
    var base = Math.floor(Math.trunc(a) / 10) * 10;
    return [10, 20, 30, 40, 50].indexOf(base) >= 0 ? (base + '-' + (base + 10) + ' years') : 'All ages';
  }

  function sportPopulations(norms) {
    return norms.population_order.filter(function (p) { return p.indexOf('General Clinical') !== 0; });
  }

  // choice: 'general' or a sport population name. Returns what the report compares against.
  function resolvePopulation(choice, sex, age) {
    if (choice === 'general' || !choice) {
      var population = sex === 'Male' ? GEN_M : (sex === 'Female' ? GEN_F : null);
      var ageBand = ageToBand(age);
      if (!population) return { population: null, ageBand: ageBand, label: null, note: 'Choose Male or Female to compare against the general norms.', level: 'warn' };
      var base = sex === 'Male' ? 'Male' : 'Female';
      if (ageBand !== 'All ages') {
        var short = ageBand.replace(' years', '');
        return { population: population, ageBand: ageBand, label: 'General Clinical — ' + base + ' · ' + short + ' yr', note: 'Auto-selected: ' + base + ', ' + short + ' yr', level: 'ok' };
      }
      var why = String(age == null ? '' : age).trim() ? 'age outside 10–60' : 'no age entered';
      return { population: population, ageBand: 'All ages', label: 'General Clinical — ' + base + ' · all ages', note: 'Auto-selected: ' + base + ', all ages (' + why + ').', level: 'info' };
    }
    return { population: choice, ageBand: 'All ages', label: choice, note: 'Sport populations are single-band (no age split).', level: 'info' };
  }

  function isAsym(name) { return name.indexOf('Asymmetry') >= 0 || name.indexOf('Imbalance') >= 0; }

  // ---------------------------------------------------------------- radar (report_pdf.py)
  var NORDIC_L = 'Nordic Peak Force — Left', NORDIC_R = 'Nordic Peak Force — Right';
  var QUAD_L = 'Quad ISO @ 60° — Left', QUAD_R = 'Quad ISO @ 60° — Right';
  var RADAR_DEFAULT = ['Jump Height', 'IMTP Relative Force', '__NORDIC__', 'Adductor Peak Force', 'Abductor Peak Force', '__QUAD__'];
  var SHORT_LABEL = {
    'Jump Height': 'CMJ jump ht', 'Peak Power': 'Peak power', 'CMJ Peak Force': 'CMJ peak F',
    'RSI-modified': 'RSI-mod',
    'IMTP Peak Force': 'IMTP peak F', 'IMTP Relative Force': 'IMTP N/kg', 'IMTP RFD 0–200 ms': 'IMTP RFD',
    'Hop RSI (best)': 'Hop RSI', 'Hop Contact Time': 'Hop contact t', 'Hop Jump Height': 'Hop jump ht',
    'Nordic Relative Force': 'Nordic N/kg',
    'Adductor Peak Force': 'Hip ADD', 'Abductor Peak Force': 'Hip ABD',
    'Isometric Peak Force': 'Isometric F',
    '10 m sprint': '10 m sprint', '20 m sprint': '20 m sprint', '30 m sprint': '30 m sprint',
    '5-10-5 (pro-agility)': '5-10-5',
    '__NORDIC__': 'Nordic ecc', '__QUAD__': 'Quad ISO'
  };
  var WORST_RANK = { Green: 1, Amber: 2, Red: 3 };

  function rowMap(groups) {
    var m = {};
    flatten(groups).forEach(function (r) { m[r.name] = r; });
    return m;
  }
  function score(value, target, dirn) {
    if (!target) return null;
    if (dirn === 'Lower') return value ? target / value : null;
    return value / target;
  }
  function avgSpoke(rm, left, right, unit) {
    var L = rm[left], R = rm[right];
    var present = [L, R].filter(function (x) { return x && num(x.result) !== null; });
    var ref = L || R;
    if (!present.length || !ref || !(ref.norm || {}).green) return null;
    var g = num(ref.norm.green);
    if (!g) return null;
    var v = present.reduce(function (s, x) { return s + num(x.result); }, 0) / present.length;
    var worst = present.map(function (x) { return x.status; })
      .reduce(function (w, s) { return (WORST_RANK[s] || 0) > (WORST_RANK[w] || 0) ? s : w; });
    var sc = score(v, g, (ref.norm || {}).dir || 'Higher');
    if (sc === null) return null;
    return { value: v, target: g, status: worst, unit: unit, score: sc, dir: (ref.norm || {}).dir || 'Higher' };
  }
  function spoke(name, rm) {
    if (name === '__NORDIC__') return avgSpoke(rm, NORDIC_L, NORDIC_R, 'N');
    if (name === '__QUAD__') return avgSpoke(rm, QUAD_L, QUAD_R, '× BW');
    var r = rm[name];
    if (!r) return null;
    var v = num(r.result), nm = r.norm || {}, g = num(nm.green);
    if (v === null || !g) return null;
    var sc = score(v, g, nm.dir || 'Higher');
    if (sc === null) return null;
    return { value: v, target: g, status: r.status, unit: r.unit, score: sc, dir: nm.dir || 'Higher' };
  }
  function radarOptions(groups) {
    var rm = rowMap(groups), opts = [];
    if (avgSpoke(rm, NORDIC_L, NORDIC_R, 'N')) opts.push(['__NORDIC__', SHORT_LABEL.__NORDIC__]);
    if (avgSpoke(rm, QUAD_L, QUAD_R, '× BW')) opts.push(['__QUAD__', SHORT_LABEL.__QUAD__]);
    var seen = {}; [NORDIC_L, NORDIC_R, QUAD_L, QUAD_R].forEach(function (k) { seen[k] = 1; });
    groups.forEach(function (gp) {
      gp.rows.forEach(function (r) {
        if (seen[r.name] || isAsym(r.name)) return;
        var nm = r.norm || {};
        if ((nm.dir === 'Higher' || nm.dir === 'Lower') && num(nm.green) !== null && num(r.result) !== null) {
          opts.push([r.name, SHORT_LABEL[r.name] || r.name]);
        }
      });
    });
    return opts;
  }
  function radarDefault(options) {
    var keys = options.map(function (o) { return o[0]; });
    var picked = RADAR_DEFAULT.filter(function (k) { return keys.indexOf(k) >= 0; });
    return (picked.length ? picked : keys).slice(0, 6);
  }
  function radarSpokes(groups, keys) {
    var rm = rowMap(groups), out = [];
    keys.forEach(function (k) {
      var s = spoke(k[0], rm);
      if (s) { s.label = k[1]; out.push(s); }
    });
    return out;
  }

  // ---------------------------------------------------------------- return-to-sport criteria (acl_norms.json "rts")
  // The clinic's checklist, kept apart from the phase norms. Each criterion reads a list of metrics (the first one
  // with a result is used) or a meta value such as "months" since surgery, and has a min and/or max. Every row is
  // met, not yet or not tested. It is decision support: the app compares numbers, the clinician decides.
  // results = { metric: number }, meta = { months: number }, units = { metric: unit } for display.
  var RTS_WORDS = { met: 'Met', not: 'Not yet', untested: 'Not tested' };
  var META_UNITS = { months: 'months' };
  function rtsCheck(rts, results, meta, units) {
    var list = rts && Array.isArray(rts.criteria) ? rts.criteria : [];
    var rows = [], met = 0, not = 0, untested = 0;
    results = results || {}; meta = meta || {}; units = units || {};
    list.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var metrics = Array.isArray(c.metrics) ? c.metrics : (typeof c.metric === 'string' ? [c.metric] : []);
      var lo = num(c.min), hi = num(c.max);
      if ((!metrics.length && !c.meta) || (lo === null && hi === null)) return;     // nothing to read or no threshold
      var value = null, used = '', idx = -1;
      if (c.meta) { value = num(meta[c.meta]); used = String(c.meta); }
      else {
        for (var i = 0; i < metrics.length; i++) {
          var v = num(results[metrics[i]]);
          if (v !== null) { value = v; used = metrics[i]; idx = i; break; }
        }
        if (idx < 0) used = metrics[0];
      }
      var unit = typeof c.unit === 'string' ? c.unit : (c.meta ? (META_UNITS[c.meta] || '') : (units[used] || ''));
      if (unit === 'AU' || unit === '/100') unit = '';   // v48: a score's unit isn't printed ('IKDC ≥ 90')
      var u = unit ? (unit === '%' ? '%' : ' ' + unit) : '';
      var target = lo !== null && hi !== null ? pyStr(lo) + ' – ' + pyStr(hi) + u : (lo !== null ? '≥ ' + pyStr(lo) + u : '≤ ' + pyStr(hi) + u);
      var st = value === null ? 'untested' : ((lo === null || value >= lo) && (hi === null || value <= hi) ? 'met' : 'not');
      if (st === 'met') met++; else if (st === 'not') not++; else untested++;
      // shown the way the report prints numbers; a meta value such as months to one decimal at most (9.5, not 9.50)
      var text = value === null ? '—' : (c.meta ? String(pyRound(value, 1)) : fmt(value)) + u;
      rows.push({ label: String(c.label || used), metric: used, fallback: idx > 0, value: value, text: text, unit: unit, min: lo, max: hi, target: target, status: st });
    });
    return { title: String((rts && rts.title) || 'Return-to-sport criteria'), note: String((rts && rts.note) || ''), rows: rows,
      met: met, not: not, untested: untested, total: rows.length };
  }
  // "5 of 9 met · 2 not tested" (the screen, the report and the AI read the same count)
  function rtsSummary(r) {
    return r.met + ' of ' + r.total + ' met' + (r.untested ? ' · ' + r.untested + ' not tested' : '');
  }

  // ---------------------------------------------------------------- scorecard (report_pdf.py)
  var DOMAIN_MAP = [['HAMSTRING REHAB', 'Hamstring rehab'], ['ACL REHAB', 'ACL rehab'],   // v37: the Custom battery's rehab sections
    ['COUNTERMOVEMENT', 'Jump / power'], ['MID-THIGH', 'Max strength'], ['HOP', 'Reactive'],
    ['NORDIC', 'Hamstring'], ['HIP', 'Hip / groin'], ['DYNAMIC STRENGTH', 'DSI'], ['SPRINT', 'Speed'],
    ['SPEED', 'Speed'], ['DYNAMO', 'Isometric'], ['LOWER-LIMB', 'LL strength'], ['OWN TESTS', 'Own tests']];   // v36: the Custom battery's two groups
  function titleCase(s) {
    return s.replace(/[A-Za-z]+/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); });
  }
  // v38: the Custom battery's categories ('ISOMETRIC STRENGTH · LOWER LIMB'): the type's short name, and the region apart
  var CAT_SHORT = { 'ISOMETRIC STRENGTH': 'Isometric', 'ECCENTRIC STRENGTH': 'Eccentric', 'ISOKINETIC STRENGTH': 'Isokinetic', 'DYNAMIC STRENGTH (RM)': 'Dynamic (RM)',
    'JUMP & POWER': 'Jump & power', 'REACTIVE': 'Reactive', 'HOP & FUNCTIONAL': 'Hop & functional', 'SPEED & AGILITY': 'Speed & agility', 'RANGE OF MOTION': 'Range of motion',
    'BALANCE': 'Balance', 'QUESTIONNAIRES & CLINICAL': 'Questionnaires', 'OTHER TESTS': 'Other tests' };
  var CAT_REGION = { 'LOWER LIMB': 'Lower limb', 'UPPER LIMB': 'Upper limb', 'TRUNK': 'Trunk', 'WHOLE BODY': 'Whole body' };
  function catParts(title) {                         // [type, region] for a category's title, else null
    var p = String(title).split(' \u00b7 ');
    if (!CAT_SHORT[p[0]] || p.length > 2 || (p.length === 2 && !CAT_REGION[p[1]])) return null;
    return [CAT_SHORT[p[0]], p.length === 2 ? CAT_REGION[p[1]] : ''];
  }
  function shortDomain(title) {
    var cp = catParts(title);
    if (cp) return cp[0] + (cp[1] ? ' \u00b7 ' + cp[1] : '');
    for (var i = 0; i < DOMAIN_MAP.length; i++) if (title.indexOf(DOMAIN_MAP[i][0]) >= 0) return DOMAIN_MAP[i][1];
    return titleCase(title);
  }
  function scorecard(groups) {
    var cards = [];
    groups.forEach(function (gp) {
      var sts = gp.rows.map(function (r) { return r.status; }).filter(function (s) { return s in WORST_RANK; });
      if (!sts.length) return;
      var worst = sts.reduce(function (w, s) { return WORST_RANK[s] > WORST_RANK[w] ? s : w; });
      var green = sts.filter(function (s) { return s === 'Green'; }).length;
      var cp = catParts(gp.title), card = { domain: cp ? cp[0] : shortDomain(gp.title), worst: worst, green: green, total: sts.length };
      if (cp) card.sub = cp[1];                        // v38: a category's region, under its type on the card
      cards.push(card);
    });
    return cards;
  }

  // Meter geometry shared by the screen and the PDF (report_pdf.meter)
  function meter(result, n) {
    var r = num(result);
    if (r === null || isEmptyObj(n)) return null;
    var d = n.dir, g = num(n.green), a = num(n.amber), gm = num(n.gmax), am = num(n.amax);
    var lo, hi, pts;
    if ((d === 'Higher' || d === 'Lower') && g !== null && a !== null) {
      if (d === 'Higher') {
        lo = Math.max(0, Math.min(r, a) * 0.8); hi = Math.max(r, g) * 1.12; hi = Math.max(hi, g * 1.05);
        pts = [['Red', lo, a], ['Amber', a, g], ['Green', g, hi]];
      } else {
        hi = Math.max(r, a) * 1.12; lo = Math.max(0, Math.min(r, g) * 0.8);
        pts = [['Green', lo, g], ['Amber', g, a], ['Red', a, hi]];
      }
    } else if (d === 'Guide') {                       // v28: three neutral zones (ballistic / both / strength), no colours
      var gl = num(n.low), gh = num(n.high);
      if (gl === null || gh === null) return null;
      lo = Math.min(r, gl) * 0.8; hi = Math.max(r, gh) * 1.15;
      pts = [['Guide', lo, gl], ['Guide', gl, gh], ['Guide', gh, hi]];
    } else if (gm !== null && am !== null) {
      lo = Math.min(r, a) * 0.9; hi = Math.max(r, am) * 1.1;
      pts = [['Red', lo, a], ['Amber', a, g], ['Green', g, gm], ['Amber', gm, am], ['Red', am, hi]];
    } else {
      return null;
    }
    var span = (hi - lo) || 1;
    return {
      segments: pts.map(function (p) { return { color: p[0], width: Math.max(0, (p[2] - p[1]) / span * 100) }; }),
      marker: Math.min(100, Math.max(0, (r - lo) / span * 100)),
      lo: lo, hi: hi
    };
  }
  // Where another value (the previous result) sits on a meter's scale, 0-100, clamped to the bar ends.
  // The scale is today's: it isn't stretched to fit the previous value.
  function meterAt(m, v) {
    var x = num(v);
    if (!m || x === null) return null;
    var span = (m.hi - m.lo) || 1;
    return Math.min(100, Math.max(0, (x - m.lo) / span * 100));
  }

  // ---------------------------------------------------------------- typo guard
  // A typed value is worth a second look when it is outside the metric's usual range ("range" in the norms
  // files, in the unit typed) or when it differs from the previous result by more than TYPO_JUMP_PCT percent.
  // It is only a prompt: nothing is blocked. jump === false skips the second check (differences and asymmetries,
  // where a percentage change means little near zero).
  var TYPO_JUMP_PCT = 35;
  function typoCheck(value, range, previous, jump) {
    var v = num(value);
    if (v === null) return null;
    if (Array.isArray(range) && range.length === 2) {
      var lo = num(range[0]), hi = num(range[1]);
      if ((lo !== null && v < lo) || (hi !== null && v > hi)) return { kind: 'range', value: v };
    }
    var p = num(previous);
    if (jump !== false && p !== null && p !== 0) {
      var pct = (v - p) / Math.abs(p) * 100;
      if (Math.abs(pct) > TYPO_JUMP_PCT) return { kind: 'jump', value: v, previous: p, pct: pct };
    }
    return null;
  }

  // ---------------------------------------------------------------- strength battery (strength_norms.json)
  // Each test is entered per leg as a load (kg), a force (N) or reps, then scored relative to body mass.
  var SIDES = [['L', 'Left'], ['R', 'Right']];
  var SCORE_UNIT = { xBW: '× BW', xBWf: '× BW', pctBW: '% BW', Nkg: 'N/kg', reps: 'reps', ratio: '' };

  // Target with its amber zone: Amber is within amber_pct % of the target (outside the band for ratios)
  function strengthNorm(t, pct) {
    var p = (pct == null ? 5 : pct) / 100;
    if (t.dir === 'Band') return { dir: 'Band', green: t.green, gmax: t.gmax, amber: t.green * (1 - p), amax: t.gmax * (1 + p) };
    if (t.dir === 'Lower') return { dir: 'Lower', green: t.green, amber: t.green * (1 + p) };
    return { dir: 'Higher', green: t.green, amber: t.green * (1 - p) };
  }

  // What you enter -> what is scored (null until it can be scored)
  function strengthScore(kind, raw, mass) {
    if (raw === null || raw === undefined) return null;
    if (kind === 'reps') return raw;
    if (!mass) return null;
    if (kind === 'xBW' || kind === 'Nkg') return raw / mass;
    if (kind === 'pctBW') return raw / mass * 100;
    if (kind === 'xBWf') return raw / (mass * 9.81);
    return null;
  }

  // The target in the units you enter, for this person (e.g. 26.7 kg for someone who weighs 80 kg)
  function strengthRawTarget(t, mass) {
    if (!mass || t.dir === 'Band' || t.score === 'reps' || t.input === 'calc') return null;
    var v = t.score === 'xBW' || t.score === 'Nkg' ? t.green * mass
      : t.score === 'pctBW' ? t.green / 100 * mass
        : t.score === 'xBWf' ? t.green * mass * 9.81 : null;
    return v === null ? null : { value: v, unit: t.input === 'kg' ? 'kg' : 'N' };
  }

  function formatScore(v, score) {
    if (v === null || v === undefined) return '';
    if (score === 'pctBW') return fmt(v) + '% BW';
    return fmt(v) + (SCORE_UNIT[score] ? ' ' + SCORE_UNIT[score] : '');
  }

  // values: {testId: {left, right, prevLeft, prevRight, prevMass, prevDate}} as typed / loaded from the client's
  // record. Returns the tests with results, one row per scored leg, traffic-light counts and the flagged legs
  // (Red first, then Amber). A previous result gives a change flag: within noise_pct % is "within noise".
  function buildStrength(values, set, mass) {
    var m = num(mass);
    if (m !== null && m <= 0) m = null;
    var pct = set.amber_pct == null ? 5 : set.amber_pct;
    var noisePct = set.noise_pct == null ? 5 : set.noise_pct;
    var raw = {}, prev = {};
    set.tests.forEach(function (t) {
      var v = values[t.id] || {};
      raw[t.id] = { L: parseInput(v.left), R: parseInput(v.right) };
      var pm = num(v.prevMass);
      prev[t.id] = { L: parseInput(v.prevLeft), R: parseInput(v.prevRight), mass: pm && pm > 0 ? pm : m, date: v.prevDate || '' };
    });
    var tests = [], rows = [];
    set.tests.forEach(function (t) {
      var norm = strengthNorm(t, pct), sides = {}, any = false, waiting = false;
      SIDES.forEach(function (sd) {
        var k = sd[0], cell;
        if (t.input === 'calc') {
          var a = (raw[t.from[0]] || {})[k], b = (raw[t.from[1]] || {})[k];
          var r = (a && b) ? a / b : null;
          cell = { input: null, parts: [a === undefined ? null : a, b === undefined ? null : b], value: r, needsMass: false };
        } else {
          var input = raw[t.id][k], value = strengthScore(t.score, input, m);
          cell = { input: input, value: value, needsMass: value === null && input !== null };
          if (t.also && value !== null) cell.also = strengthScore(t.also, input, m);
        }
        cell.status = cell.value === null ? '' : status(cell.value, norm);
        cell.text = formatScore(cell.value, t.score);
        // change since the last time this leg was tested (scores compared, each with its own body mass)
        cell.prev = null; cell.change = ''; cell.change_kind = '';
        var pv = t.input === 'calc' ? null : prev[t.id][k];
        if (pv !== null && cell.value !== null) {
          var pscore = strengthScore(t.score, pv, prev[t.id].mass);
          if (pscore !== null) {
            var ch = change(cell.value, pscore, t.dir === 'Band' ? 'Band' : 'Higher', Math.abs(pscore) * noisePct / 100);
            cell.prev = { input: pv, value: pscore, text: formatScore(pscore, t.score), date: prev[t.id].date };
            cell.change = ch[0]; cell.change_kind = ch[1];
          }
        }
        sides[k] = cell;
        if (cell.needsMass) waiting = true;
        if (cell.value !== null) {
          any = true;
          rows.push({ id: t.id, test: t.name, side: sd[1], name: t.name + ' — ' + sd[1], status: cell.status, result: cell.value, text: cell.text, target: t.target_text });
        }
      });
      var diff = null;
      if (t.input !== 'calc' && sides.L.value !== null && sides.R.value !== null) {
        var hi = Math.max(sides.L.value, sides.R.value), lo = Math.min(sides.L.value, sides.R.value);
        if (hi > 0) diff = { pct: (hi - lo) / hi * 100, lower: sides.L.value < sides.R.value ? 'L' : (sides.R.value < sides.L.value ? 'R' : '') };
      }
      if (any || waiting) {
        tests.push({ id: t.id, name: t.name, detail: t.detail || '', target: t.target_text, score: t.score, input: t.input,
          norm: norm, sides: sides, diff: diff, rawTarget: strengthRawTarget(t, m), any: any, unit: SCORE_UNIT[t.score] || '' });
      }
    });
    var c = { Green: 0, Amber: 0, Red: 0 };
    rows.forEach(function (r) { if (r.status in c) c[r.status] += 1; });
    var order = { Red: 0, Amber: 1 };
    var prios = rows.filter(function (r) { return r.status in order; });
    prios.sort(function (a, b) { return order[a.status] - order[b.status]; });
    return { tests: tests, rows: rows, counts: c, prios: prios, mass: m };
  }

  function diffText(d) {
    if (!d) return '';
    var p = pyFixed(d.pct, 0);
    if (!d.lower || p === '0') return 'even';
    return (d.lower === 'L' ? 'Left' : 'Right') + ' ' + p + '% lower';
  }

  // ---------------------------------------------------------------- client records (history)
  // A session is { tool, date (Y-m-d), meta, values, results: {metric: number}, mass }.
  // Names match after trimming, collapsing spaces, lower-casing and dropping accents.
  function nameKey(name) {
    var s = String(name == null ? '' : name);
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function sortSessions(list) {
    return list.slice().sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : ((a.savedAt || '') < (b.savedAt || '') ? -1 : 1)); });
  }
  // The most recent earlier session (same tool, dated before `beforeDate`) where the metric was tested.
  function previousFor(sessions, tool, metric, beforeDate) {
    var best = null;
    sessions.forEach(function (s) {
      if (s.tool !== tool || !s.date || (beforeDate && s.date >= beforeDate)) return;
      var r = s.results && s.results[metric];
      if (r === null || r === undefined) return;
      if (!best || s.date > best.date) best = { value: r, date: s.date, mass: s.mass == null ? null : s.mass, session: s };
    });
    return best;
  }
  // Progress across sessions: columns are session dates (up to `max`, newest last, the current session included),
  // rows are metrics measured in at least two of them. `current` = { date, results }.
  function progress(sessions, tool, current, max) {
    max = max || 5;
    var list = sessions.filter(function (s) { return s.tool === tool && s.date && s.results && s.date !== current.date; });
    list = sortSessions(list).concat([{ date: current.date, results: current.results, current: true }]);
    if (list.length > max) list = list.slice(list.length - max);
    var order = [], seen = {};
    list.forEach(function (s) { Object.keys(s.results).forEach(function (k) { if (!seen[k]) { seen[k] = 1; order.push(k); } }); });
    var rows = [];
    order.forEach(function (metric) {
      var vals = list.map(function (s) { var v = s.results[metric]; return v === null || v === undefined ? null : v; });
      var n = vals.filter(function (v) { return v !== null; }).length;
      if (n < 2) return;
      var first = null, last = null;
      vals.forEach(function (v) { if (v !== null) { if (first === null) first = v; last = v; } });
      rows.push({ metric: metric, values: vals, first: first, last: last });
    });
    return { dates: list.map(function (s) { return s.date; }), rows: rows, sessions: list.length };
  }

  // ---------------------------------------------------------------- dates
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: m, d: d };
  }
  var DATE_FORMATS = {
    'd/m/Y': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, 'Y-m-d': /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    'm/d/Y': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, 'd-m-Y': /^(\d{1,2})-(\d{1,2})-(\d{4})$/
  };
  function tryDate(v, fmtName) {
    var m = DATE_FORMATS[fmtName].exec(v);
    if (!m) return null;
    var a = +m[1], b = +m[2], c = +m[3];
    if (fmtName === 'd/m/Y' || fmtName === 'd-m-Y') return validDate(c, b, a);
    if (fmtName === 'm/d/Y') return validDate(c, a, b);
    return validDate(a, b, c);
  }
  function parseDate(v, formats) {
    v = String(v == null ? '' : v).trim();
    for (var i = 0; i < formats.length; i++) { var r = tryDate(v, formats[i]); if (r) return r; }
    return null;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(dt) { return dt.y + '-' + pad2(dt.m) + '-' + pad2(dt.d); }
  function displayDate(dt) { return pad2(dt.d) + ' ' + MONTHS[dt.m - 1] + ' ' + dt.y; }
  // '2026-09-29' -> '29 Sep 2026' (the report's date style); anything else passes through
  function displayIso(iso) {
    var dt = parseDate(iso, ['Y-m-d']);
    return dt ? displayDate(dt) : String(iso || '');
  }

  // ---------------------------------------------------------------- VALD Hub CSV (vald_import.py)
  var TYPE_MAP = {
    CMJ: {
      'jump height (imp-mom)': 'Jump Height', 'jump height (flight time)': 'Jump Height', 'jump height': 'Jump Height',
      'peak power / bm': 'Peak Power', 'concentric peak force': 'CMJ Peak Force', 'peak force': 'CMJ Peak Force',
      'concentric force asymmetry': 'Concentric Asymmetry', 'force asymmetry': 'Concentric Asymmetry',
      'eccentric force asymmetry': 'Landing Asymmetry', 'landing force asymmetry': 'Landing Asymmetry'
    },
    IMTP: {
      'peak vertical force': 'IMTP Peak Force', 'peak force': 'IMTP Peak Force', 'net peak vertical force': 'IMTP Peak Force',
      'peak vertical force / bm': 'IMTP Relative Force', 'force at 200ms': 'IMTP RFD 0–200 ms',
      'rfd 0-200 ms': 'IMTP RFD 0–200 ms', 'rfd 0-200ms': 'IMTP RFD 0–200 ms'
    },
    DJ: {
      'rsi (flight/contact time)': 'Hop RSI (best)', 'rsi (jump height/contact time)': 'Hop RSI (best)',
      'rsi': 'Hop RSI (best)', 'contact time': 'Hop Contact Time', 'ground contact time': 'Hop Contact Time'
    },
    SPRINT: {
      '10m': '10 m sprint', '10 m': '10 m sprint', '10m time': '10 m sprint', '10m total': '10 m sprint', 'time 10m': '10 m sprint', 'split 10m': '10 m sprint',
      '20m': '20 m sprint', '20 m': '20 m sprint', '20m time': '20 m sprint', '20m total': '20 m sprint', 'time 20m': '20 m sprint', 'split 20m': '20 m sprint',
      '30m': '30 m sprint', '30 m': '30 m sprint', '30m time': '30 m sprint', '30m total': '30 m sprint', 'time 30m': '30 m sprint', 'split 30m': '30 m sprint'
    }
  };
  var IGNORE = { 'peak landing force': 1, 'rsi-modified': 1, 'additional load': 1, 'reps': 1, 'tags': 1, 'externalid': 1, 'time': 1 };
  var SKIP_COLS = { 'name': 1, 'externalid': 1, 'test type': 1, 'date': 1, 'time': 1, 'bw': 1, 'reps': 1, 'tags': 1, 'additional load': 1, 'sex': 1 };

  function normCol(col) {
    return String(col || '').trim().toLowerCase().replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
  }

  // CSV reader following Python's csv module ('excel' dialect): quoted fields, "" escapes,
  // commas and line breaks inside quotes, CRLF/LF/CR endings. Blank lines are dropped.
  function parseCsv(text) {
    text = String(text || '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [], row = [], field = '', state = 'START_RECORD';
    function saveField() { row.push(field); field = ''; }
    function saveRow() { saveField(); rows.push(row); row = []; }
    for (var i = 0; i <= text.length; i++) {
      var eof = i === text.length;
      var c = eof ? '' : text.charAt(i);
      var eol = !eof && (c === '\n' || c === '\r');
      var crlf = c === '\r' && text.charAt(i + 1) === '\n';
      if (crlf) i++; // CRLF counts as one line break
      switch (state) {
        case 'START_RECORD':
          if (eof || eol) break; // blank line
          state = 'START_FIELD';
        /* falls through */
        case 'START_FIELD':
          if (eof || eol) { saveRow(); state = 'START_RECORD'; }
          else if (c === '"') state = 'IN_QUOTED';
          else if (c === ',') saveField();
          else { field += c; state = 'IN_FIELD'; }
          break;
        case 'IN_FIELD':
          if (eof || eol) { saveRow(); state = 'START_RECORD'; }
          else if (c === ',') { saveField(); state = 'START_FIELD'; }
          else field += c;
          break;
        case 'IN_QUOTED':
          if (eof) { saveRow(); state = 'START_RECORD'; }
          else if (c === '"') state = 'QUOTE_IN_QUOTED';
          else field += crlf ? '\r\n' : c;
          break;
        case 'QUOTE_IN_QUOTED':
          if (c === '"') { field += '"'; state = 'IN_QUOTED'; }
          else if (eof || eol) { saveRow(); state = 'START_RECORD'; }
          else if (c === ',') { saveField(); state = 'START_FIELD'; }
          else { field += c; state = 'IN_FIELD'; }
          break;
      }
    }
    return rows;
  }

  // Python csv.DictReader: first row is the header, later rows become {header: value}
  function dictRows(text) {
    var rows = parseCsv(text);
    if (!rows.length) return [];
    var head = rows[0], keys = [];
    head.forEach(function (h) { if (keys.indexOf(h) < 0) keys.push(h); });
    return rows.slice(1).map(function (r) {
      var o = { _keys: keys };
      head.forEach(function (h, j) { o[h] = j < r.length ? r[j] : null; });
      return o;
    });
  }

  function pickRow(rows) {
    if (rows.length <= 1) return [rows[0] || null, rows.length];
    function key(r) {
      for (var i = 0; i < r._keys.length; i++) {
        var k = r._keys[i];
        if (normCol(k) === 'date') {
          var dt = parseDate(r[k], ['d/m/Y', 'Y-m-d', 'm/d/Y']);
          if (dt) return dt.y * 10000 + dt.m * 100 + dt.d;
        }
      }
      return -Infinity;
    }
    var best = rows[0], bestKey = key(rows[0]);
    for (var j = 1; j < rows.length; j++) { var kj = key(rows[j]); if (kj > bestKey) { best = rows[j]; bestKey = kj; } }
    return [best, rows.length];
  }

  // files: [{name, text}] -> {meta:{name,date,dateIso,mass,sex}, results:{metric:valueText}, messages:[...]}
  function parseValdFiles(files) {
    var meta = {}, results = {}, messages = [];
    files.forEach(function (f) {
      var rows;
      try { rows = dictRows(f.text); } catch (e) { messages.push('⚠ Could not read ' + f.name + ': ' + e.message); return; }
      if (!rows.length) { messages.push('⚠ ' + f.name + ' had no data rows.'); return; }
      var picked = pickRow(rows), row = picked[0], nrow = picked[1];
      var ttype = '';
      row._keys.forEach(function (k) { if (normCol(k) === 'test type') ttype = String(row[k] || '').trim().toUpperCase(); });
      var cmap = TYPE_MAP[ttype] || {};
      row._keys.forEach(function (k) {
        var n = normCol(k), v = String(row[k] || '').trim();
        if (!v) return;
        if (n === 'name' && !meta.name) meta.name = v;
        else if (n === 'date' && !meta.date) {
          var dt = parseDate(v, ['d/m/Y', 'Y-m-d', 'm/d/Y', 'd-m-Y']);
          meta.date = dt ? displayDate(dt) : v;
          if (dt) meta.dateIso = isoOf(dt);
        }
        else if ((n === 'bw' || n === 'body weight' || n === 'weight') && !meta.mass) meta.mass = v;
        else if (n === 'sex' && !meta.sex) meta.sex = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
      });
      var filled = [], ignored = [];
      row._keys.forEach(function (k) {
        var n = normCol(k), v = String(row[k] || '').trim();
        if (SKIP_COLS[n] || !v) return;
        var metric = cmap[n];
        if (metric && !(metric in results)) { results[metric] = v; filled.push(metric); }
        else if (!metric && !IGNORE[n]) ignored.push(String(k).trim());
      });
      var tag = (ttype || 'test') + ' · ' + f.name;
      if (nrow > 1) tag += ' (latest of ' + nrow + ' rows)';
      if (filled.length) messages.push('✓ ' + tag + ': filled ' + filled.join(', ') + '.');
      else messages.push('– ' + tag + ': no mappable metrics recognised.');
      if (ignored.length) messages.push('   (ignored columns: ' + ignored.join(', ') + ')');
    });
    return { meta: meta, results: results, messages: messages };
  }

  // ---------------------------------------------------------------- exercise library (v15)
  // Exercise names are compared by a key: accents dropped, lower case, '&' as 'and', anything but a-z / 0-9 as one space,
  // the clinic's shorthand written out (SL = single leg, DB = dumbbell, RDL = Romanian deadlift ...) and a plural s
  // dropped, so "SL RDLs", "Single-leg RDL" and "single leg Romanian deadlift" all agree.
  var LIB_SHORT = {
    sl: 'single leg', dl: 'double leg', db: 'dumbbell', kb: 'kettlebell', bb: 'barbell', bw: 'body weight', tb: 'theraband',
    iso: 'isometric', isom: 'isometric', ecc: 'eccentric', ext: 'extension', flex: 'flexion', abd: 'abduction', add: 'adduction',
    rdl: 'romanian deadlift', rfess: 'rear foot elevated split squat'
  };
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function libTokens(name, rewrite) {
    var s = String(name == null ? '' : name);
    if (s.normalize) s = s.normalize('NFKD');
    s = s.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ');
    var out = [];
    s.split(' ').forEach(function (t) {
      if (!t) return;
      // a plural s comes off a word of 4+ letters (raises -> raise; press stays); a shorthand stays as it is (rfess)
      if (!own(LIB_SHORT, t) && t.length > 3 && t.charAt(t.length - 1) === 's' && t.charAt(t.length - 2) !== 's') t = t.slice(0, -1);
      out.push(rewrite && own(LIB_SHORT, t) ? LIB_SHORT[t] : t);
    });
    return out.join(' ');
  }
  var libKeyMemo = {}, libKeyCount = 0;               // the same names are keyed again and again (every row, every keystroke)
  function libKeyed(name, rewrite) {
    var s = String(name == null ? '' : name), m = (rewrite ? '#' : '~') + s, k = libKeyMemo[m];
    if (k !== undefined) return k;
    k = libTokens(s, rewrite);
    if (++libKeyCount > 8000) { libKeyMemo = {}; libKeyCount = 1; }
    libKeyMemo[m] = k;
    return k;
  }
  function libKey(name) { return libKeyed(name, true); }
  function libByName(a, b) { return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }); }
  // the entry called exactly this (its name or one of its other names, by key); the first by name when several are
  function libMatch(name, list) {
    var k = libKey(name), best = null;
    if (!k) return null;
    (list || []).forEach(function (e) {
      if (!e || !e.name) return;
      var hit = libKey(e.name) === k || (Array.isArray(e.aliases) && e.aliases.some(function (a) { return libKey(a) === k; }));
      if (hit && (!best || libByName(e, best) < 0)) best = e;
    });
    return best;
  }
  // up to n entries for an autocomplete: every typed word must start a word of the entry's name, or of one of its other
  // names (by key). Words are also compared as written, without the shorthand written out, so a word still being typed
  // works: "ext rot" finds External rotation and "add" Adductor squeeze (as shorthand they would be "extension" and
  // "adduction"), and "SL RD" finds SL RDL. Ranked: names starting with what was typed, then names holding every word,
  // then other names; ties by name. Under 2 characters typed: nothing.
  function libSuggest(typed, list, n) {
    n = n == null ? 5 : n;
    var raw = String(typed == null ? '' : typed).replace(/\s+/g, ' ').trim();
    var keys = [libKey(raw), libKeyed(raw, false)].filter(function (k, i, a) { return k && a.indexOf(k) === i; });
    if (raw.length < 2 || !keys.length) return [];
    function forms(name) { return [libKey(name), libKeyed(name, false)]; }
    function covers(name) {
      return forms(name).some(function (key) {
        var toks = key.split(' ');
        return keys.some(function (k) { return k.split(' ').every(function (w) { return toks.some(function (t) { return t.indexOf(w) === 0; }); }); });
      });
    }
    function starts(name) { return forms(name).some(function (key) { return keys.some(function (k) { return key.indexOf(k) === 0; }); }); }
    var hits = [];
    (list || []).forEach(function (e) {
      if (!e || !e.name) return;
      var rank = -1;
      if (starts(e.name)) rank = 0;
      else if (covers(e.name)) rank = 1;
      else if (Array.isArray(e.aliases) && e.aliases.some(covers)) rank = 2;
      if (rank >= 0) hits.push({ e: e, r: rank });
    });
    hits.sort(function (a, b) { return a.r - b.r || libByName(a.e, b.e); });
    return hits.slice(0, Math.max(0, n)).map(function (h) { return h.e; });
  }
  // a video link -> how to show and print it: YouTube and Vimeo get an embeddable player address (youtube-nocookie, Vimeo
  // with do-not-track) and a short link; any other http(s) address is a plain link. null: blank, not http(s) or unreadable.
  function ytSeconds(v) {                             // t= / start=: '90', '90s', '1m30s', '1h2m3s'
    var m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i.exec(String(v == null ? '' : v).trim());
    if (!m || !(m[1] || m[2] || m[3])) return 0;
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }
  function urlParams(s) {
    var out = {};
    String(s || '').split('&').forEach(function (p) {
      var i = p.indexOf('='), k = i < 0 ? p : p.slice(0, i), v = i < 0 ? '' : p.slice(i + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return; }
      if (k && !own(out, k)) out[k] = v;
    });
    return out;
  }
  function videoInfo(url) {
    var s = String(url == null ? '' : url).trim();
    var m = /^(https?):\/\/([^\s\/?#]+)([^\s?#]*)(\?[^\s#]*)?(#\S*)?$/i.exec(s);
    if (!m) return null;
    var host = m[2].toLowerCase();
    if (host.indexOf('@') >= 0) host = host.slice(host.lastIndexOf('@') + 1);
    host = host.replace(/:\d*$/, '');
    if (host !== 'localhost' && !/^[^.:]+(\.[^.:]+)+$/.test(host)) return null;
    var h = host.replace(/^www\./, ''), segs = m[3].split('/').filter(Boolean);
    var q = urlParams(m[4] ? m[4].slice(1) : ''), frag = urlParams(m[5] ? m[5].slice(1) : '');
    var yt = '';
    if (h === 'youtube.com' || h === 'm.youtube.com') yt = segs[0] === 'watch' ? q.v : (segs[0] === 'shorts' || segs[0] === 'embed' ? segs[1] : '');
    else if (h === 'youtu.be') yt = segs[0];
    else if (h === 'youtube-nocookie.com' && segs[0] === 'embed') yt = segs[1];
    if (yt && /^[A-Za-z0-9_-]{11}$/.test(yt)) {
      var start = ytSeconds(q.t || q.start || frag.t || frag.start);
      return { kind: 'youtube', id: yt, start: start, label: 'YouTube',
        embed: 'https://www.youtube-nocookie.com/embed/' + yt + '?rel=0&playsinline=1' + (start ? '&start=' + start : ''),
        link: 'https://youtu.be/' + yt + (start ? '?t=' + start : '') };
    }
    if (h === 'vimeo.com' || h === 'player.vimeo.com') {
      var id = '', hash = '';
      if (h === 'player.vimeo.com') { if (segs[0] === 'video' && /^\d+$/.test(segs[1] || '')) id = segs[1]; }
      else if (/^\d+$/.test(segs[0] || '')) {          // vimeo.com/123 or, unlisted, vimeo.com/123/abcdef0123
        id = segs[0];
        if (segs[1] && /^[0-9a-f]{6,}$/i.test(segs[1])) hash = segs[1];
      } else {                                          // vimeo.com/channels/x/123, /groups/x/videos/123, /showcase/x/video/123
        segs.forEach(function (sg, i) { if (i > 0 && /^\d+$/.test(sg)) id = sg; });
      }
      if (!hash && q.h && /^[0-9a-z]+$/i.test(q.h)) hash = q.h;
      if (id) {
        return { kind: 'vimeo', id: id, hash: hash, label: 'Vimeo',
          embed: 'https://player.vimeo.com/video/' + id + '?dnt=1' + (hash ? '&h=' + hash : ''),
          link: 'https://vimeo.com/' + id + (hash ? '/' + hash : '') };
      }
    }
    return { kind: 'link', link: s, embed: '', label: h };
  }

  return {
    num: num, parseInput: parseInput, pyFixed: pyFixed, pySigned: pySigned, pyRound: pyRound, fmt: fmt,
    status: status, targetStr: targetStr, guideLabel: guideLabel, change: change, changeLabel: changeLabel,
    buildRows: buildRows, buildRehabRows: buildRehabRows, flatten: flatten, counts: counts, priorities: priorities,
    lsi: lsi, ageToBand: ageToBand, resolvePopulation: resolvePopulation, sportPopulations: sportPopulations,
    isAsym: isAsym, GEN_M: GEN_M, GEN_F: GEN_F,
    radarOptions: radarOptions, radarDefault: radarDefault, radarSpokes: radarSpokes, SHORT_LABEL: SHORT_LABEL,
    scorecard: scorecard, shortDomain: shortDomain, meter: meter, meterAt: meterAt,
    STATUS_WORDS: STATUS_WORDS, TALLY_WORDS: TALLY_WORDS, statusWord: statusWord,
    RTS_WORDS: RTS_WORDS, rtsCheck: rtsCheck, rtsSummary: rtsSummary, ankleGo: ankleGo, agoBand: agoBand,
    TYPO_JUMP_PCT: TYPO_JUMP_PCT, typoCheck: typoCheck,
    buildStrength: buildStrength, strengthNorm: strengthNorm, strengthScore: strengthScore,
    strengthRawTarget: strengthRawTarget, formatScore: formatScore, diffText: diffText,
    displayIso: displayIso, parseDate: parseDate, isoOf: isoOf, displayDate: displayDate,
    nameKey: nameKey, sortSessions: sortSessions, previousFor: previousFor, progress: progress,
    parseCsv: parseCsv, parseValdFiles: parseValdFiles, normCol: normCol,
    libKey: libKey, libMatch: libMatch, libSuggest: libSuggest, videoInfo: videoInfo
  };
});
