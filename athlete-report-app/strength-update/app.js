/* BASE Health Athlete Report: screen logic.
   Three tools (screening, hamstring rehab, ACL rehab). Everything runs on the device: results are
   scored as they are typed, the PDF is built locally, and a draft is kept in this browser only. */
(function () {
  'use strict';
  var E = window.BHEngine;
  var DATA = {};
  var STORE = 'bh-athlete-report-draft-v1';
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var state = null;
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    entry: $('entry'), summary: $('summary'), dock: $('dock'), sheet: $('sheet'), pages: $('pages'),
    sheetTitle: $('sheetTitle'), share: $('sharePdf'), save: $('savePdf'), back: $('sheetBack'),
    toast: $('toast'), newAthlete: $('newAthlete')
  };

  // ------------------------------------------------------------------ small helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function daysBetween(fromIso, toIso) {
    var a = E.parseDate(fromIso, ['Y-m-d']), b = E.parseDate(toIso, ['Y-m-d']);
    if (!a || !b) return null;
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  }
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { els.toast.hidden = true; }, 3200);
  }
  var STATUS_LABEL = { Green: 'Green', Amber: 'Amber', Red: 'Red', 'n/a': 'n/a' };
  function chip(status, text) {
    var cls = status === 'n/a' ? 'na' : status;
    return '<span class="chip ' + cls + '">' + esc(text || STATUS_LABEL[status] || status) + '</span>';
  }

  // ------------------------------------------------------------------ state
  function freshTool(tool, keep) {
    keep = keep || {};
    if (tool === 'screen') return { meta: { name: '', date: todayIso(), sex: '', age: '', sport: '', tester: keep.tester || '', mass: '', notes: '' }, pop: 'general', values: {}, radar: null, collapsed: {}, importLog: null };
    if (tool === 'ham') return { meta: { name: '', date: todayIso(), injured: '', clinician: keep.clinician || '', doi: '', weeks: '', sport: '', notes: '' }, phase: null, values: {}, collapsed: {} };
    if (tool === 'str') return { meta: { name: '', date: todayIso(), mass: '', sport: '', tester: keep.tester || '', notes: '' }, values: {}, collapsed: {} };
    return { meta: { name: '', date: todayIso(), injured: '', surgeon: keep.surgeon || '', graft: '', dos: '', months: '', sport: '', notes: '' }, phase: null, sex: null, values: {}, collapsed: {} };
  }
  function loadDraft() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.v === 1 && s.screen && s.ham && s.acl) { if (!s.str) s.str = freshTool('str'); return s; }
    } catch (e) { /* no stored draft */ }
    return null;
  }
  var saveTimer = null;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
    }, 250);
  }
  function tidyState() {
    var H = DATA.ham, A = DATA.acl;
    if (H.phases.indexOf(state.ham.phase) < 0) state.ham.phase = H.phases[H.phases.length - 1];
    if (A.phases.indexOf(state.acl.phase) < 0) state.acl.phase = A.phases[A.phases.length - 1];
    if (A.sexes.indexOf(state.acl.sex) < 0) state.acl.sex = A.sexes[0];
    var pops = E.sportPopulations(DATA.screen);
    if (state.screen.pop !== 'general' && pops.indexOf(state.screen.pop) < 0) state.screen.pop = 'general';
    if (!state.str) state.str = freshTool('str');
    if (['screen', 'str', 'ham', 'acl'].indexOf(state.tool) < 0) state.tool = 'screen';
  }
  function val(tool, name) {
    var v = state[tool].values;
    if (!v[name]) v[name] = { result: '', previous: '', side: '', left: '', right: '' };
    return v[name];
  }

  // ------------------------------------------------------------------ scoring
  function screenNorm(name, pop) {
    if (!pop.population) return null;
    var N = DATA.screen;
    var band = (pop.ageBand && pop.ageBand !== 'All ages') ? ((((N.age_norms || {})[pop.population]) || {})[pop.ageBand] || {}) : {};
    var b = band[name];
    if (b && Object.keys(b).length) return b;
    var p = (N.populations[pop.population] || {})[name];
    return p === undefined ? null : p;
  }
  function computeScreen() {
    var s = state.screen;
    var pop = E.resolvePopulation(s.pop, s.meta.sex, s.meta.age);
    var inputs = {};
    Object.keys(s.values).forEach(function (name) {
      var v = s.values[name];
      inputs[name] = { result: E.parseInput(v.result), previous: E.parseInput(v.previous), side: v.side || '' };
    });
    var groups = pop.population ? E.buildRows(inputs, pop.population, DATA.screen, pop.ageBand, E.parseInput(s.meta.mass)) : [];
    var byName = {};
    E.flatten(groups).forEach(function (r) { byName[r.name] = r; });
    var opts = E.radarOptions(groups);
    var keys = opts.map(function (o) { return o[0]; });
    var picked = (s.radar || E.radarDefault(opts)).filter(function (k) { return keys.indexOf(k) >= 0; }).slice(0, 6);
    return { pop: pop, groups: groups, byName: byName, counts: E.counts(groups), prios: E.priorities(groups), radarOptions: opts, radarPicked: picked };
  }
  function rehabKey(tool) {
    var s = state[tool];
    return tool === 'acl' ? s.phase + '|' + s.sex : s.phase;
  }
  function computeRehab(tool) {
    var s = state[tool], S = DATA[tool], key = rehabKey(tool), inputs = {};
    S.groups.forEach(function (g) {
      g.metrics.forEach(function (m) {
        var v = s.values[m.name] || {};
        if (m.calc === 'LSI') inputs[m.name] = { result: E.lsi(E.parseInput(v.left), E.parseInput(v.right), s.meta.injured), previous: null };
        else inputs[m.name] = { result: E.parseInput(v.result), previous: E.parseInput(v.previous) };
      });
    });
    var groups = E.buildRehabRows(inputs, key, S);
    var byName = {};
    E.flatten(groups).forEach(function (r) { byName[r.name] = r; });
    return { key: key, pnorms: S.norms[key] || {}, groups: groups, byName: byName, counts: E.counts(groups), prios: E.priorities(groups, 5), inputs: inputs };
  }
  function computeStrength() {
    var r = E.buildStrength(state.str.values, DATA.str, E.parseInput(state.str.meta.mass));
    r.byId = {};
    r.tests.forEach(function (t) { r.byId[t.id] = t; });
    return r;
  }
  function compute() {
    if (state.tool === 'screen') return computeScreen();
    if (state.tool === 'str') return computeStrength();
    return computeRehab(state.tool);
  }

  // ------------------------------------------------------------------ rendering: entry column
  var HEAD = {
    screen: ['Performance & readiness screen', 'Type this session’s results. Leave a metric blank to skip it; add the previous result to see real change versus noise.'],
    str: ['Lower-limb strength & capacity', 'Enter each leg\u2019s result as the load, force or reps you measured. Only the tests you fill in are scored and reported.'],
    ham: ['Hamstring rehab & return to play', 'Injured-limb results against the targets for the chosen rehab phase.'],
    acl: ['ACL rehab & return to play', 'Injured-limb and symmetry results against ACLR research norms for the chosen phase and sex.']
  };

  function field(tool, key, label, o) {
    o = o || {};
    var v = state[tool].meta[key] || '';
    var id = tool + '-' + key;
    return '<label class="f' + (o.cls ? ' ' + o.cls : '') + '" for="' + id + '"><span>' + esc(label) + '</span>' +
      '<input id="' + id + '" data-meta="' + key + '" value="' + esc(v) + '"' +
      (o.type ? ' type="' + o.type + '"' : ' type="text"') +
      (o.mode ? ' inputmode="' + o.mode + '"' : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
      (o.words ? ' autocapitalize="words"' : '') + ' autocomplete="off" spellcheck="false" enterkeyhint="next"></label>';
  }
  function seg(tool, key, label, options) {
    var cur = state[tool].meta[key] || '';
    return '<div class="f"><span id="' + tool + '-' + key + '-l">' + esc(label) + '</span><div class="seg" role="group" aria-labelledby="' + tool + '-' + key + '-l">' +
      options.map(function (o) { return '<button type="button" data-seg="' + key + '" data-value="' + esc(o) + '" aria-pressed="' + (cur === o) + '">' + esc(o) + '</button>'; }).join('') +
      '</div></div>';
  }
  function select(id, label, options, cur, attr, cls) {
    return '<label class="f' + (cls ? ' ' + cls : '') + '" for="' + id + '"><span>' + esc(label) + '</span><select id="' + id + '" ' + attr + '>' +
      options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></label>';
  }

  function athleteCard() {
    var t = state.tool, s = state[t];
    var out = '<section class="card athlete"><div class="card-head"><h2>Athlete</h2>';
    if (t === 'screen') {
      out += '<label class="ghost file-btn" for="valdFiles">Import VALD CSV<input id="valdFiles" type="file" accept=".csv,text/csv" multiple></label>';
    }
    out += '</div><div class="fields">';
    if (t === 'screen') {
      out += field(t, 'name', 'Athlete name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'sex', 'Sex', ['Male', 'Female']) +
        field(t, 'age', 'Age (years)', { mode: 'decimal' }) + field(t, 'mass', 'Mass (kg)', { mode: 'decimal' }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'tester', 'Tester', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'full' });
      var pops = [['general', 'General population (auto by age & sex)']].concat(E.sportPopulations(DATA.screen).map(function (p) { return [p, p]; }));
      out += select('screen-pop', 'Compare against', pops, s.pop, 'data-choice="pop"', 'wide');
    } else if (t === 'str') {
      out += field(t, 'name', 'Athlete name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        field(t, 'mass', 'Body mass (kg)', { mode: 'decimal' }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'tester', 'Tester', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'wide' });
    } else if (t === 'ham') {
      out += field(t, 'name', 'Athlete name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'injured', 'Injured side', ['Left', 'Right']) +
        field(t, 'doi', 'Date of injury', { type: 'date' }) + field(t, 'weeks', 'Weeks since injury', { mode: 'decimal' }) +
        field(t, 'clinician', 'Clinician', { words: true }) + field(t, 'sport', 'Sport', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'full' });
      out += select('ham-phase', 'Rehab phase', DATA.ham.phases.map(function (p) { return [p, p]; }), s.phase, 'data-choice="phase"', 'wide');
    } else {
      out += field(t, 'name', 'Athlete name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'injured', 'Injured side', ['Left', 'Right']) +
        field(t, 'dos', 'Date of surgery', { type: 'date' }) + field(t, 'months', 'Months since surgery', { mode: 'decimal' }) +
        field(t, 'graft', 'Graft type') + field(t, 'surgeon', 'Surgeon / clinician', { words: true }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'notes', 'Notes', { cls: 'span3' });
      out += select('acl-phase', 'Rehab phase', DATA.acl.phases.map(function (p) { return [p, p]; }), s.phase, 'data-choice="phase"', 'wide');
      out += '<div class="f wide"><span id="acl-sex-l">Norm set</span><div class="seg" role="group" aria-labelledby="acl-sex-l">' +
        DATA.acl.sexes.map(function (x) { return '<button type="button" data-choice-seg="sex" data-value="' + esc(x) + '" aria-pressed="' + (s.sex === x) + '">' + esc(x) + '</button>'; }).join('') + '</div></div>';
    }
    out += '</div><p class="note" id="ctxNote" hidden></p>';
    if (t === 'screen') out += '<div class="import-log" id="importLog" hidden></div>';
    return out + '</section>';
  }

  function metricRow(tool, m, gi, mi) {
    var v = val(tool, m.name), id = tool + '-' + gi + '-' + mi, nm = esc(m.name);
    var asym = tool === 'screen' && E.isAsym(m.name);
    var hint = '<span class="m-unit">' + esc(m.unit) + '</span>';
    if (m.calc === 'PERKG' || m.calc === 'PERBW') hint = '<span class="m-unit">enter force in N · scored as ' + esc(m.unit) + ' using mass</span>';
    if (m.calc === 'LSI') hint = '<span class="m-unit">enter left & right · LSI = injured ÷ other side</span>';
    var html = '<div class="metric' + (asym ? ' has-side' : '') + '" data-metric="' + nm + '" data-status="">' +
      '<div class="m-label"><div class="m-name">' + nm + '</div><div class="m-hint">' + hint +
      '<span class="m-target"></span><span class="m-calc"></span></div><div class="m-meter"></div></div>';
    function input(fieldName, cls, ph, label) {
      return '<input class="' + cls + '" id="' + id + '-' + fieldName + '" data-field="' + fieldName + '" value="' + esc(v[fieldName]) + '" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="' + ph + '" aria-label="' + nm + ' ' + label + '">';
    }
    if (m.calc === 'DSI') {
      html += '<div class="m-auto" data-auto>CMJ Peak Force ÷ IMTP Peak Force</div>';
    } else if (m.calc === 'LSI') {
      html += input('left', 'm-result m-in', 'Left', 'left') + input('right', 'm-prev m-in', 'Right', 'right');
    } else {
      html += input('result', 'm-result m-in', tool === 'ham' ? 'Injured' : 'Result', 'result');
      if (asym) {
        html += '<div class="side m-side" role="group" aria-label="' + nm + ' higher side">' +
          ['L', 'R'].map(function (sd) { return '<button type="button" data-side="' + sd + '" aria-pressed="' + (v.side === sd) + '" aria-label="' + (sd === 'L' ? 'Left' : 'Right') + ' higher">' + sd + '</button>'; }).join('') + '</div>';
      }
      html += input('previous', 'm-prev', 'Prev.', 'previous result');
    }
    return html + '<div class="m-out" aria-live="off"></div></div>';
  }

  function groupsHtml(tool) {
    var S = DATA[tool], s = state[tool];
    return S.groups.map(function (g, gi) {
      var collapsed = !!s.collapsed[gi];
      var hasLsi = g.metrics.some(function (m) { return m.calc === 'LSI'; });
      return '<section class="group' + (collapsed ? ' collapsed' : '') + '" data-group="' + gi + '">' +
        '<button type="button" class="group-head" aria-expanded="' + !collapsed + '"><span class="gt">' + esc(g.title) + '</span><span class="gc" data-count></span><span class="chev" aria-hidden="true"></span></button>' +
        '<div class="cols" aria-hidden="true"><span class="c-result">' + (hasLsi ? 'Result / L' : (tool === 'ham' ? 'Injured' : 'Result')) + '</span><span class="c-prev">' + (hasLsi ? 'Previous / R' : 'Previous') + '</span><span class="c-out">Status</span></div>' +
        '<div class="group-body">' + g.metrics.map(function (m, mi) { return metricRow(tool, m, gi, mi); }).join('') + '</div></section>';
    }).join('');
  }

  var INPUT_WORD = { kg: 'load in kg', N: 'force in N', reps: 'reps' };
  function strengthRowHtml(t, i) {
    var v = val('str', t.id), id = 'str-' + i, nm = esc(t.name);
    var how = t.input === 'calc' ? 'adduction \u00f7 abduction, each leg' : ((t.detail ? t.detail + ' \u00b7 ' : '') + INPUT_WORD[t.input]);
    var html = '<div class="metric lr" data-metric="' + esc(t.id) + '" data-status="">' +
      '<div class="m-label"><div class="m-name">' + nm + '</div><div class="m-hint"><span class="m-unit">' + esc(how) + '</span>' +
      '<span class="m-target"></span></div></div>';
    if (t.input === 'calc') {
      html += '<div class="m-auto" data-auto>Worked out from the hip adduction and abduction results</div>';
    } else {
      var unit = t.input === 'reps' ? 'reps' : t.input;
      ['left', 'right'].forEach(function (f) {
        html += '<input class="m-in m-' + f + '" id="' + id + '-' + f + '" data-field="' + f + '" value="' + esc(v[f]) + '" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="' +
          (f === 'left' ? 'Left' : 'Right') + ' ' + unit + '" aria-label="' + nm + ', ' + f + ' leg, ' + INPUT_WORD[t.input] + '">';
      });
    }
    return html + '<div class="m-out" aria-live="off"></div></div>';
  }
  function strengthGroupHtml() {
    var collapsed = !!state.str.collapsed[0];
    return '<section class="group' + (collapsed ? ' collapsed' : '') + '" data-group="0">' +
      '<button type="button" class="group-head" aria-expanded="' + !collapsed + '"><span class="gt">' + esc(String(DATA.str.title || 'Strength battery').toUpperCase()) + '</span><span class="gc" data-count></span><span class="chev" aria-hidden="true"></span></button>' +
      '<div class="cols lr" aria-hidden="true"><span class="c-left">Left</span><span class="c-right">Right</span><span class="c-out">Result</span></div>' +
      '<div class="group-body">' + DATA.str.tests.map(strengthRowHtml).join('') + '</div></section>';
  }

  function render() {
    var t = state.tool;
    document.querySelectorAll('.tools button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tool === t)); });
    els.entry.innerHTML = '<div class="pagehead"><h1>' + esc(HEAD[t][0]) + '</h1><p>' + esc(HEAD[t][1]) + '</p></div>' + athleteCard() + (t === 'str' ? strengthGroupHtml() : groupsHtml(t));
    if (t === 'screen' && state.screen.importLog) showImportLog(state.screen.importLog);
    refresh();
  }

  // ------------------------------------------------------------------ live updates
  function meterHtml(result, norm) {
    var m = E.meter(result, norm);
    if (!m) return '';
    var colour = { Green: 'var(--green)', Amber: 'var(--amber)', Red: 'var(--red)' };
    return m.segments.map(function (sg) { return '<span style="width:' + sg.width.toFixed(2) + '%;background:' + colour[sg.color] + '"></span>'; }).join('') +
      '<i style="left:' + m.marker.toFixed(1) + '%"></i>';
  }

  function refreshStrength(c) {
    var mass = E.parseInput(state.str.meta.mass), note = $('ctxNote');
    if (mass !== null && mass <= 0) mass = null;
    var waiting = c.tests.some(function (t) { return t.sides.L.needsMass || t.sides.R.needsMass; });
    var pct = DATA.str.amber_pct == null ? 5 : DATA.str.amber_pct;
    note.hidden = false;
    if (!mass) {
      note.className = 'note' + (waiting ? ' warn' : '');
      note.textContent = waiting ? 'Add body mass (kg) to score the load and force tests. Reps are scored straight away.'
        : 'Add body mass (kg) first: loads and forces are scored relative to it.';
    } else {
      note.className = 'note';
      note.textContent = 'Green = at or above target, Amber = within ' + pct + '%, Red = further away. Each target also shows what it means for this athlete.';
    }
    var tested = 0;
    els.entry.querySelectorAll('.metric.lr').forEach(function (el) {
      var id = el.dataset.metric, def = null;
      DATA.str.tests.forEach(function (x) { if (x.id === id) def = x; });
      if (!def) return;
      var res = c.byId[id], rt = E.strengthRawTarget(def, mass);
      el.querySelector('.m-target').textContent = 'target ' + def.target_text + (rt ? ' = ' + E.fmt(rt.value) + ' ' + rt.unit : '');
      var html = '';
      if (res) {
        ['L', 'R'].forEach(function (k) {
          var cell = res.sides[k];
          if (cell.value !== null) html += '<div class="lr-line"><span class="lr-sd">' + k + '</span><span class="lr-v">' + esc(cell.text) + '</span>' + chip(cell.status) + '</div>';
          else if (cell.needsMass) html += '<div class="lr-line lr-wait"><span class="lr-sd">' + k + '</span>needs body mass</div>';
        });
        var d = E.diffText(res.diff);
        if (d) html += '<div class="lr-diff">' + esc(d) + '</div>';
        if (res.any) tested++;
      }
      if (def.input === 'calc') {
        el.querySelector('[data-auto]').innerHTML = res && res.any
          ? 'ADD \u00f7 ABD \u2002' + ['L', 'R'].map(function (k) { return k + ' <b>' + (res.sides[k].value === null ? '\u2013' : esc(E.fmt(res.sides[k].value))) + '</b>'; }).join(' \u00b7 ')
          : 'Worked out from the hip adduction and abduction results';
      } else if (!html) {
        var v = state.str.values[id] || {};
        if (!blank(v.left) || !blank(v.right)) html = '<span class="m-wait">not a number</span>';
      }
      el.querySelector('.m-out').innerHTML = html;
      el.dataset.status = res && res.any ? 'set' : '';
    });
    var cnt = els.entry.querySelector('.group [data-count]');
    if (cnt) cnt.textContent = tested ? tested + ' of ' + DATA.str.tests.length + ' tested' : DATA.str.tests.length + ' tests';
  }

  function refresh() {
    var t = state.tool, c = compute();
    if (t === 'str') { refreshStrength(c); renderSummary(c); saveDraft(); return; }
    var S = DATA[t];
    // context note under the athlete card
    var note = $('ctxNote');
    if (t === 'screen') {
      note.hidden = false;
      note.className = 'note' + (c.pop.level === 'warn' ? ' warn' : '');
      var extra = c.pop.population && c.pop.population.indexOf('General Clinical') === 0 && c.pop.ageBand !== 'All ages'
        ? ' Jump, Nordic and hip metrics use the age band; IMTP and DSI stay all-ages, and anything without a band falls back to all-ages.' : '';
      note.textContent = c.pop.note.replace(/([^.])$/, '$1.') + extra;
    } else if (t === 'acl' && !Object.keys(c.pnorms).length) {
      note.hidden = false; note.className = 'note warn';
      note.textContent = 'The source report has no ' + state.acl.sex.toLowerCase() + ' norms for ' + state.acl.phase + ', so results will show n/a.';
    } else {
      var auto = autoTime(t);
      note.hidden = !auto;
      note.className = 'note';
      if (auto) note.textContent = auto;
    }
    // metric rows
    var seen = {};
    els.entry.querySelectorAll('.group').forEach(function (gel) {
      var gi = +gel.dataset.group, g = S.groups[gi], entered = 0;
      gel.querySelectorAll('.metric').forEach(function (el, mi) {
        var m = g.metrics[mi], row = c.byName[m.name], out = el.querySelector('.m-out');
        var norm = t === 'screen' ? screenNorm(m.name, c.pop) : (c.pnorms[m.name] || null);
        var target = el.querySelector('.m-target'), calc = el.querySelector('.m-calc'), meter = el.querySelector('.m-meter');
        if (t === 'screen' && !c.pop.population) target.textContent = 'choose sex for targets';
        else if (norm) target.textContent = (t === 'screen' ? 'target ' : 'phase target ') + E.targetStr(norm);
        else target.textContent = t === 'screen' ? 'no norm' : 'no target this phase';
        calc.textContent = '';
        var v = state[t].values[m.name] || {};
        var typed = m.calc === 'LSI' ? (!blank(v.left) || !blank(v.right)) : !blank(v.result);
        if (m.calc === 'DSI') {
          var auto = el.querySelector('[data-auto]');
          auto.innerHTML = row ? 'CMJ ÷ IMTP =<b>' + esc(E.fmt(row.result)) + '</b>' : 'Auto: CMJ Peak Force ÷ IMTP Peak Force';
        }
        if ((m.calc === 'PERBW' || m.calc === 'PERKG') && typed) {
          calc.textContent = row ? '= ' + E.fmt(row.result) + ' ' + m.unit : (E.parseInput(state.screen.meta.mass) ? '' : 'add mass to score');
        }
        if (m.calc === 'LSI' && typed && !row) {
          calc.textContent = (state.acl.meta.injured ? 'enter both sides' : 'set the injured side');
        }
        if (row) {
          entered++;
          el.dataset.status = row.status || '';
          var chipText = m.calc === 'LSI' ? E.fmt(row.result) + '%' : row.status;
          out.innerHTML = chip(row.status, chipText) + (row.change ? '<span class="m-change ' + row.change_kind + '">' + esc(row.change.replace(/\s+/g, ' ')) + '</span>' : '');
          meter.innerHTML = meterHtml(row.result, row.norm);
          if (!meter.innerHTML) el.dataset.status = '';
        } else {
          el.dataset.status = '';
          meter.innerHTML = '';
          out.innerHTML = typed && t === 'screen' && !c.pop.population ? '<span class="m-wait">needs sex</span>' : (typed && E.parseInput(v.result) === null && m.calc !== 'LSI' && m.calc !== 'PERBW' ? '<span class="m-wait">not a number</span>' : '');
        }
        seen[m.name] = 1;
      });
      var cnt = gel.querySelector('[data-count]');
      cnt.textContent = entered ? entered + ' of ' + g.metrics.length + ' entered' : g.metrics.length + ' metrics';
    });
    renderSummary(c);
    saveDraft();
  }

  function autoTime(t) {
    var m = state[t].meta;
    if (t === 'ham' && blank(m.weeks) && m.doi) {
      var d = daysBetween(m.doi, m.date);
      if (d !== null && d >= 0) return 'Weeks since injury will show as ' + Math.floor(d / 7) + ' on the report (from the injury and test dates).';
    }
    if (t === 'acl' && blank(m.months) && m.dos) {
      var d2 = daysBetween(m.dos, m.date);
      if (d2 !== null && d2 >= 0) return 'Months since surgery will show as ' + Math.floor(d2 / 30.4375) + ' on the report (from the surgery and test dates).';
    }
    return '';
  }

  // ------------------------------------------------------------------ rendering: summary + dock
  var TALLY = {
    screen: ['Green', 'Amber', 'Red'],
    rehab: ['On / ahead', 'Within 1 SD', '>1 SD behind']
  };
  function blocker(c) {
    if (state.tool === 'str') {
      if (c.rows.length) return '';
      return c.tests.length ? 'Add body mass (kg) to score these results.' : 'Enter at least one result to create the report.';
    }
    if (state.tool === 'screen' && !c.pop.population) return 'Choose Male or Female (or a sport population) to score the results.';
    if (!c.groups.length) return state.tool === 'screen' ? 'Enter at least one result to create the report.' : 'Enter at least one result to create the rehab report.';
    return '';
  }
  function renderSummary(c) {
    var t = state.tool, labels = (t === 'screen' || t === 'str') ? TALLY.screen : TALLY.rehab;
    var head = t === 'screen'
      ? '<h2>Live summary</h2><p class="against">' + (c.pop.label ? 'Compared against <b>' + esc(c.pop.label) + '</b>' : 'Choose sex to pick the norms') + '</p>'
      : t === 'str'
        ? '<h2>Strength summary</h2><p class="against">Each leg against <b>BASE Health strength targets</b></p>'
        : '<h2>Phase progress</h2><p class="against"><b>' + esc(state[t].phase) + (t === 'acl' ? ' · ' + esc(state.acl.sex) : '') + '</b> targets</p>';
    var tally = '<div class="tally"><div class="g"><b>' + c.counts.Green + '</b><span>' + labels[0] + '</span></div>' +
      '<div class="a"><b>' + c.counts.Amber + '</b><span>' + labels[1] + '</span></div>' +
      '<div class="r"><b>' + c.counts.Red + '</b><span>' + labels[2] + '</span></div></div>';
    var list;
    if (t === 'str') {
      if (!c.rows.length) {
        list = '<p class="empty">Each leg is scored against its target as you type. Only the tests you fill in appear in the report.</p>' +
          '<button type="button" class="quiet demo" data-action="demo">Fill in example results</button>';
      } else if (!c.prios.length) {
        list = '<p class="ok">Nothing below target \u2014 every tested result is on target.</p>';
      } else {
        list = '<ol class="prio">' + c.prios.slice(0, 6).map(function (r) {
          return '<li>' + chip(r.status) + '<span class="pn">' + esc(r.name) + '</span><span class="pd">= ' + esc(r.text) + ' \u00b7 needs ' + esc(r.target) + '</span></li>';
        }).join('') + '</ol>' + (c.prios.length > 6 ? '<p class="fine">+ ' + (c.prios.length - 6) + ' more in the report</p>' : '');
      }
    } else if (!c.groups.length) {
      list = '<p class="empty">Results are scored against the norms as you type. Blank metrics are left out.</p>' +
        '<button type="button" class="quiet demo" data-action="demo">Fill in example results</button>';
    } else if (!c.prios.length) {
      list = '<p class="ok">Nothing flagged — every tested metric is on target.</p>';
    } else {
      list = '<ol class="prio">' + c.prios.map(function (r) {
        var val = E.fmt(r.result) + ' ' + r.unit + (r.side ? ' (' + r.side + ' higher)' : '');
        return '<li>' + chip(r.status) + '<span class="pn">' + esc(r.name) + '</span><span class="pd">= ' + esc(val) + ' · needs ' + esc(r.target) + '</span></li>';
      }).join('') + '</ol>';
    }
    var html = '<div class="sum"><div class="sum-scroll">' + head + tally + '<h3>' + (t === 'screen' ? 'Top priorities <small>worst first</small>' : (t === 'str' ? 'Below target <small>worst first</small>' : 'Behind target <small>worst first</small>')) + '</h3>' + list;
    if (t === 'screen' && c.radarOptions.length) {
      var full = c.radarPicked.length >= 6;
      html += '<h3>Radar graph <small>pick 3–6 for page 1</small></h3><div class="picks">' + c.radarOptions.map(function (o) {
        var on = c.radarPicked.indexOf(o[0]) >= 0;
        return '<button type="button" data-radar="' + esc(o[0]) + '" aria-pressed="' + on + '"' + (!on && full ? ' disabled' : '') + '>' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
      if (c.radarPicked.length < 3) html += '<p class="fine">The radar needs at least 3 metrics; with fewer it is left off the report.</p>';
    }
    var why = blocker(c);
    html += '</div><div class="sum-foot"><button type="button" class="primary make" data-action="report"' + (why ? ' disabled' : '') + '>Create PDF report</button>' +
      '<p class="fine">' + esc(why || 'Opens a preview you can share by AirDrop, Mail or Messages, or save to Files.') + '</p></div></div>';
    els.summary.innerHTML = html;
    els.dock.innerHTML = '<div class="dt"><a href="#summary" class="g" aria-label="' + labels[0] + '">' + c.counts.Green + '</a><a href="#summary" class="a" aria-label="' + labels[1] + '">' + c.counts.Amber + '</a><a href="#summary" class="r" aria-label="' + labels[2] + '">' + c.counts.Red + '</a></div>' +
      '<button type="button" class="primary" data-action="report"' + (why ? ' disabled' : '') + '>Create report</button>';
  }

  // ------------------------------------------------------------------ input handling
  function onInput(e) {
    var el = e.target, t = state.tool;
    if (el.dataset.meta) {
      state[t].meta[el.dataset.meta] = el.value;
      refresh();
    } else if (el.dataset.field) {
      var row = el.closest('.metric');
      val(t, row.dataset.metric)[el.dataset.field] = el.value;
      refresh();
    }
  }
  function onChange(e) {
    var el = e.target, t = state.tool;
    if (el.dataset.choice === 'pop') { state.screen.pop = el.value; refresh(); }
    else if (el.dataset.choice === 'phase') { state[t].phase = el.value; refresh(); }
    else if (el.id === 'valdFiles') importVald(el.files);
  }
  function onClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var t = state.tool;
    if (b.dataset.seg) {
      var key = b.dataset.seg, cur = state[t].meta[key];
      state[t].meta[key] = cur === b.dataset.value ? '' : b.dataset.value;
      b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(state[t].meta[key] === x.dataset.value)); });
      refresh();
    } else if (b.dataset.choiceSeg === 'sex') {
      state.acl.sex = b.dataset.value;
      b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(state.acl.sex === x.dataset.value)); });
      refresh();
    } else if (b.dataset.side) {
      var v = val(t, b.closest('.metric').dataset.metric);
      v.side = v.side === b.dataset.side ? '' : b.dataset.side;
      b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(v.side === x.dataset.side)); });
      refresh();
    } else if (b.classList.contains('group-head')) {
      var g = b.closest('.group'), gi = +g.dataset.group, c = !state[t].collapsed[gi];
      state[t].collapsed[gi] = c;
      g.classList.toggle('collapsed', c);
      b.setAttribute('aria-expanded', String(!c));
      saveDraft();
    } else if (b.dataset.action === 'demo') {
      fillExample();
    } else if (b.dataset.action === 'report') {
      openReport();
    } else if (b.dataset.radar) {
      var c2 = computeScreen(), picked = c2.radarPicked.slice(), k = b.dataset.radar, i = picked.indexOf(k);
      if (i >= 0) picked.splice(i, 1); else if (picked.length < 6) picked.push(k);
      state.screen.radar = picked;
      refresh();
    }
  }
  // Return/Next on the iPad keyboard jumps to the next result box
  function onKey(e) {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    e.preventDefault();
    var stops = els.entry.querySelectorAll('.athlete input:not([type=file]):not([type=date]), .group:not(.collapsed) input.m-result, .group:not(.collapsed) input.m-in');
    var next = null;
    for (var i = 0; i < stops.length; i++) {
      if (e.target.compareDocumentPosition(stops[i]) & Node.DOCUMENT_POSITION_FOLLOWING) { next = stops[i]; break; }
    }
    if (next) { next.focus(); if (next.select) next.select(); } else e.target.blur();
  }

  // ------------------------------------------------------------------ VALD import
  function importVald(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    Promise.all(files.map(function (f) { return f.text().then(function (text) { return { name: f.name, text: text }; }); }))
      .then(function (list) {
        var r = E.parseValdFiles(list), s = state.screen;
        if (r.meta.name) s.meta.name = r.meta.name;
        if (r.meta.dateIso) s.meta.date = r.meta.dateIso;
        if (r.meta.mass) s.meta.mass = r.meta.mass;
        if (r.meta.sex === 'Male' || r.meta.sex === 'Female') s.meta.sex = r.meta.sex;
        Object.keys(r.results).forEach(function (metric) { val('screen', metric).result = String(r.results[metric]); });
        s.importLog = r.messages.concat(['Check the filled-in values, then set Sex and Age so the right age/sex norms are used.']);
        render();
        toast('Imported ' + Object.keys(r.results).length + ' result' + (Object.keys(r.results).length === 1 ? '' : 's') + ' from VALD');
      })
      .catch(function (err) { toast('Couldn’t read that file: ' + err.message); });
  }
  function showImportLog(lines) {
    var box = $('importLog');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
  }

  // ------------------------------------------------------------------ example data (clearly labelled)
  function fillExample() {
    var t = state.tool, s = state[t];
    if (t === 'screen') {
      Object.assign(s.meta, { name: 'Example Athlete', sex: 'Male', age: '24', mass: '82', sport: 'AFL', notes: 'Example data — not a real athlete' });
      var ex = { 'Jump Height': ['38.2', '36.9'], 'Peak Power': ['51.8', '52.4'], 'CMJ Peak Force': ['2140', ''], 'RSI-modified': ['0.52', '0.47'],
        'Concentric Asymmetry': ['7.5', '', 'R'], 'IMTP Peak Force': ['3050', ''], 'IMTP Relative Force': ['37.2', '35.0'],
        'Nordic Peak Force — Left': ['365', '340'], 'Nordic Peak Force — Right': ['318', '322'], 'Nordic L/R Imbalance': ['12.9', '', 'L'],
        'Adductor Peak Force': ['402', ''], 'Abductor Peak Force': ['371', ''], '10 m sprint': ['1.78', '1.81'], '20 m sprint': ['3.02', ''] };
      Object.keys(ex).forEach(function (k) { var v = val('screen', k); v.result = ex[k][0]; v.previous = ex[k][1]; v.side = ex[k][2] || ''; });
    } else if (t === 'ham') {
      Object.assign(s.meta, { name: 'Example Athlete', injured: 'Left', sport: 'Soccer', notes: 'Example data — not a real athlete' });
      var hx = { 'AKET deficit vs uninjured': ['4', '9'], 'SLR % of uninjured side': ['96', '88'], 'HHD 90° knee-flex % of uninjured': ['91', '80'],
        'Nordic peak force — injured': ['290', '245'], 'Nordic peak-force imbalance': ['22', '41'], '10 m sprint time': ['1.86', '1.95'], 'HaOS score': ['84', '70'] };
      Object.keys(hx).forEach(function (k) { var v = val('ham', k); v.result = hx[k][0]; v.previous = hx[k][1]; });
    } else if (t === 'str') {
      Object.assign(s.meta, { name: 'Example Athlete', mass: '80', sport: 'AFL', notes: 'Example data \u2014 not a real athlete' });
      var sx = { split_squat: ['28', '25'], sl_seated_calf_vald: ['1650', '1540'], sl_seated_calf_smith: ['125', '118'],
        sl_knee_extension: ['820', '700'], sl_bridge: ['17', '16'], sl_calf_raise_reps: ['27', '22'],
        prone_hamstring_curl: ['420', '385'], hip_abduction: ['350', '372'], hip_adduction: ['395', '380'] };
      Object.keys(sx).forEach(function (k) { var v = val('str', k); v.left = sx[k][0]; v.right = sx[k][1]; });
    } else {
      Object.assign(s.meta, { name: 'Example Athlete', injured: 'Right', graft: 'Hamstring', sport: 'Netball', notes: 'Example data — not a real athlete' });
      var ax = { 'IKDC': ['78', '70'], 'ACL-RSI': ['61', '52'], 'KOOS — Sport & Rec': ['75', '65'], 'Knee extension LSI': ['84', '76'],
        'CMJ — Jump height': ['27.5', '25.9'], 'Single hop LSI': ['88', ''] };
      Object.keys(ax).forEach(function (k) { var v = val('acl', k); v.result = ax[k][0]; v.previous = ax[k][1]; });
      var q = val('acl', 'Quadriceps LSI'); q.left = '248'; q.right = '205';
    }
    render();
    toast('Example results filled in — tap New athlete to clear them');
  }

  // ------------------------------------------------------------------ report
  var current = { file: null, blob: null, title: '' };
  var fontsReady = null;
  function ensureFonts() {
    if (!fontsReady) {
      fontsReady = (window.FontFace && document.fonts)
        ? Promise.all(window.BHReport.fontFaces().map(function (f) {
          var face = new FontFace(f.family, 'url(' + f.url + ')');
          document.fonts.add(face);
          return face.load();
        })).catch(function () { /* preview falls back to system fonts; the PDF is unaffected */ })
        : Promise.resolve();
    }
    return fontsReady;
  }
  function fileName(suffix) {
    var n = (state[state.tool].meta.name || 'athlete').trim() || 'athlete';
    return n.replace(/[\\/:*?"<>|]+/g, '-').replace(/ /g, '_') + suffix;
  }
  function buildReport() {
    var t = state.tool, c = compute(), m = state[t].meta;
    if (blocker(c)) return null;
    if (t === 'str') {
      return {
        file: fileName('_strength.pdf'),
        rep: window.BHReport.strength({
          meta: { name: m.name, date: E.displayIso(m.date), mass: m.mass, sport: m.sport, tester: m.tester, notes: m.notes },
          tests: c.tests, counts: c.counts, prios: c.prios, amberPct: DATA.str.amber_pct
        })
      };
    }
    if (t === 'screen') {
      var labels = {};
      c.radarOptions.forEach(function (o) { labels[o[0]] = o[1]; });
      return {
        file: fileName('_report.pdf'),
        rep: window.BHReport.screening({
          meta: { name: m.name, date: E.displayIso(m.date), sport: m.sport, tester: m.tester, age: m.age, sex: m.sex, mass: m.mass, notes: m.notes },
          popLabel: c.pop.label, groups: c.groups, counts: c.counts, prios: c.prios,
          radarKeys: c.radarPicked.map(function (k) { return [k, labels[k]]; })
        })
      };
    }
    var auto = function (fromIso, div) { var d = daysBetween(fromIso, m.date); return d !== null && d >= 0 ? String(Math.floor(d / div)) : ''; };
    if (t === 'ham') {
      return {
        file: fileName('_hamstring.pdf'),
        rep: window.BHReport.rehab({
          kind: 'ham', phase: state.ham.phase, groups: c.groups, counts: c.counts, disclaimer: DATA.ham.disclaimer || '',
          meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, clinician: m.clinician, weeks: blank(m.weeks) ? auto(m.doi, 7) : m.weeks, sport: m.sport, notes: m.notes }
        })
      };
    }
    return {
      file: fileName('_acl.pdf'),
      rep: window.BHReport.rehab({
        kind: 'acl', phase: state.acl.phase, sex: state.acl.sex, groups: c.groups, counts: c.counts, disclaimer: DATA.acl.disclaimer || '',
        meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, graft: m.graft, surgeon: m.surgeon, months: blank(m.months) ? auto(m.dos, 30.4375) : m.months, sport: m.sport, notes: m.notes }
      })
    };
  }
  function canShare(file) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }
  function openReport() {
    var built = buildReport();
    if (!built) return;
    current = { file: null, blob: null, title: built.rep.title };
    els.sheetTitle.innerHTML = esc(built.rep.title) + '<small>' + esc(built.file) + '</small>';
    els.pages.innerHTML = '<p class="sheet-msg">Building the report…</p>';
    els.share.disabled = true; els.save.disabled = true;
    els.sheet.hidden = false;
    els.toast.hidden = true;
    document.documentElement.style.overflow = 'hidden';
    ensureFonts().then(function () {
      var pdf = window.BHReport.toPdf(built.rep);
      var blob = pdf.output('blob');
      current.blob = blob;
      current.file = new File([blob], built.file, { type: 'application/pdf' });
      els.pages.innerHTML = window.BHReport.toSvg(built.rep).join('');
      var share = canShare(current.file);
      els.share.hidden = !share;
      // On iPad/iPhone the share sheet already has Save to Files, Print, AirDrop and Mail,
      // and plain downloads are unreliable in home-screen apps, so Share is the only button there.
      els.save.hidden = share && IS_IOS;
      els.save.className = share ? 'ghost' : 'primary';
      els.share.disabled = false; els.save.disabled = false;
      (share ? els.share : els.save).focus();
    }).catch(function (err) {
      els.pages.innerHTML = '<p class="sheet-msg">The PDF couldn’t be built: ' + esc(err && err.message) + '</p>';
    });
  }
  function closeReport() {
    els.sheet.hidden = true;
    document.documentElement.style.overflow = '';
  }
  function savePdf() {
    if (!current.blob) return;
    var url = URL.createObjectURL(current.blob);
    var a = document.createElement('a');
    a.href = url; a.download = current.file.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function sharePdf() {
    if (!current.file) return;
    navigator.share({ files: [current.file], title: current.title }).catch(function (err) {
      if (err && err.name !== 'AbortError') { toast('Sharing didn’t work here, so the PDF was saved instead.'); savePdf(); }
    });
  }

  // ------------------------------------------------------------------ top bar
  function switchTool(tool) {
    if (tool === state.tool) return;
    state.tool = tool;
    render();
    window.scrollTo(0, 0);
  }
  var armTimer = null;
  function newAthlete() {
    var b = els.newAthlete;
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = 'Tap again to clear';
      armTimer = setTimeout(function () { b.classList.remove('armed'); b.textContent = 'New athlete'; }, 3500);
      return;
    }
    clearTimeout(armTimer);
    b.classList.remove('armed'); b.textContent = 'New athlete';
    var t = state.tool, m = state[t].meta;
    state[t] = freshTool(t, { tester: m.tester, clinician: m.clinician, surgeon: m.surgeon });
    tidyState();
    render();
    window.scrollTo(0, 0);
    toast('Cleared — ready for the next athlete');
  }

  // ------------------------------------------------------------------ boot
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    });
  }
  function start() {
    Promise.all([fetchJson('norms.json'), fetchJson('hamstring_norms.json'), fetchJson('acl_norms.json'), fetchJson('strength_norms.json')]).then(function (r) {
      DATA.screen = r[0]; DATA.ham = r[1]; DATA.acl = r[2]; DATA.str = r[3];
      state = loadDraft() || { v: 1, tool: 'screen', screen: freshTool('screen'), str: freshTool('str'), ham: freshTool('ham'), acl: freshTool('acl') };
      tidyState();
      els.entry.addEventListener('input', onInput);
      els.entry.addEventListener('change', onChange);
      els.entry.addEventListener('click', onClick);
      els.entry.addEventListener('keydown', onKey);
      els.summary.addEventListener('click', onClick);
      els.dock.addEventListener('click', onClick);
      document.querySelector('.tools').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-tool]');
        if (b) switchTool(b.dataset.tool);
      });
      els.newAthlete.addEventListener('click', newAthlete);
      els.back.addEventListener('click', closeReport);
      els.save.addEventListener('click', savePdf);
      els.share.addEventListener('click', sharePdf);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !els.sheet.hidden) closeReport(); });
      render();
    }).catch(function (err) {
      els.entry.innerHTML = '<section class="card error-card"><div class="card-head"><h2>Norms not found</h2></div>' +
        '<p>The app couldn’t load its norms files (' + esc(err.message) + '). Check that norms.json, strength_norms.json, hamstring_norms.json and acl_norms.json sit next to index.html, then reload. ' +
        'If you are offline, open the app once while online so it can save a copy.</p></section>';
    });
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline copy unavailable */ }); });
  }
  start();
})();
