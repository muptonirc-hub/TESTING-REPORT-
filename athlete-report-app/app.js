/* BASE Health Athlete Report: screen logic.
   Four tools (screening, LL strength, hamstring rehab, ACL rehab). Everything runs on the device: results are
   scored as they are typed, the PDF is built locally, and a draft is kept in this browser only until
   "Clear all data" wipes it. */
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
    toast: $('toast'), clearAll: $('clearAll'), clearDialog: $('clearDialog'), clearList: $('clearList'),
    clearCancel: $('clearCancel'), clearConfirm: $('clearConfirm'),
    aiDialog: $('aiDialog'), aiKey: $('aiKey'), aiSave: $('aiSave'), aiCancel: $('aiCancel'), aiRemove: $('aiRemove'),
    aiKeyState: $('aiKeyState'), aiErr: $('aiErr'), aiLead: $('aiLead')
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
  var TOOLS = ['screen', 'str', 'ham', 'acl'];
  var TOOL_NAMES = { screen: 'Screening', str: 'LL Strength', ham: 'Hamstring rehab', acl: 'ACL rehab' };
  function freshInterp() { return { text: '', ai: false, basis: '' }; }
  function freshTool(tool, keep) {
    keep = keep || {};
    if (tool === 'screen') return { meta: { name: '', date: todayIso(), sex: '', age: '', sport: '', tester: keep.tester || '', mass: '', notes: '' }, pop: 'general', values: {}, radar: null, collapsed: {}, importLog: null, interp: freshInterp() };
    if (tool === 'ham') return { meta: { name: '', date: todayIso(), injured: '', clinician: keep.clinician || '', doi: '', weeks: '', sport: '', notes: '' }, phase: null, values: {}, collapsed: {}, interp: freshInterp() };
    if (tool === 'str') return { meta: { name: '', date: todayIso(), mass: '', sport: '', tester: keep.tester || '', notes: '' }, values: {}, collapsed: {}, interp: freshInterp() };
    return { meta: { name: '', date: todayIso(), injured: '', surgeon: keep.surgeon || '', graft: '', dos: '', months: '', sport: '', notes: '' }, phase: null, sex: null, values: {}, collapsed: {}, interp: freshInterp() };
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
    TOOLS.forEach(function (t) {                     // drafts saved before the interpretation box existed
      var it = state[t].interp;
      if (!it || typeof it !== 'object') state[t].interp = freshInterp();
      else { it.text = String(it.text || ''); it.ai = !!it.ai; it.basis = String(it.basis || ''); }
    });
    if (TOOLS.indexOf(state.tool) < 0) state.tool = 'screen';
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
    els.entry.innerHTML = '<div class="pagehead"><h1>' + esc(HEAD[t][0]) + '</h1><p>' + esc(HEAD[t][1]) + '</p></div>' + athleteCard() +
      (t === 'str' ? strengthGroupHtml() : groupsHtml(t)) + interpCardHtml();
    if (t === 'screen' && state.screen.importLog) showImportLog(state.screen.importLog);
    refresh();
    fitInterp();
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
    if (t === 'str') { refreshStrength(c); renderSummary(c); renderInterpState(c); saveDraft(); return; }
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
    renderInterpState(c);
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
    html += '</div><div class="sum-foot">' + interpFlagHtml(t, c) + '<button type="button" class="primary make" data-action="report"' + (why ? ' disabled' : '') + '>Create PDF report</button>' +
      '<p class="fine">' + esc(why || 'Opens a preview you can share by AirDrop, Mail or Messages, or save to Files.') + '</p></div></div>';
    els.summary.innerHTML = html;
    els.dock.innerHTML = '<div class="dt"><a href="#summary" class="g" aria-label="' + labels[0] + '">' + c.counts.Green + '</a><a href="#summary" class="a" aria-label="' + labels[1] + '">' + c.counts.Amber + '</a><a href="#summary" class="r" aria-label="' + labels[2] + '">' + c.counts.Red + '</a></div>' +
      '<button type="button" class="primary" data-action="report"' + (why ? ' disabled' : '') + '>Create report</button>';
  }

  // ------------------------------------------------------------------ input handling
  function onInput(e) {
    var el = e.target, t = state.tool;
    if (el.id === 'interpText') { onInterpInput(el); return; }
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
    } else if (b.dataset.action === 'ai-draft') {
      draftInterp();
    } else if (b.dataset.action === 'ai-settings') {
      openAiSettings(false);
    } else if (b.dataset.action === 'ai-undo') {
      undoInterp();
    } else if (b.dataset.action === 'goto-interp') {
      gotoInterp();
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
    toast('Example results filled in — tap Clear all data to clear them');
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
    var it = state[t].interp, interp = blank(it.text) ? null : { text: String(it.text).trim(), ai: !!it.ai };
    if (t === 'str') {
      return {
        file: fileName('_strength.pdf'),
        rep: window.BHReport.strength({
          meta: { name: m.name, date: E.displayIso(m.date), mass: m.mass, sport: m.sport, tester: m.tester, notes: m.notes },
          tests: c.tests, counts: c.counts, prios: c.prios, amberPct: DATA.str.amber_pct, interp: interp
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
          radarKeys: c.radarPicked.map(function (k) { return [k, labels[k]]; }), interp: interp
        })
      };
    }
    var auto = function (fromIso, div) { var d = daysBetween(fromIso, m.date); return d !== null && d >= 0 ? String(Math.floor(d / div)) : ''; };
    if (t === 'ham') {
      return {
        file: fileName('_hamstring.pdf'),
        rep: window.BHReport.rehab({
          kind: 'ham', phase: state.ham.phase, groups: c.groups, counts: c.counts, disclaimer: DATA.ham.disclaimer || '', interp: interp,
          meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, clinician: m.clinician, weeks: blank(m.weeks) ? auto(m.doi, 7) : m.weeks, sport: m.sport, notes: m.notes }
        })
      };
    }
    return {
      file: fileName('_acl.pdf'),
      rep: window.BHReport.rehab({
        kind: 'acl', phase: state.acl.phase, sex: state.acl.sex, groups: c.groups, counts: c.counts, disclaimer: DATA.acl.disclaimer || '', interp: interp,
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
  // ------------------------------------------------------------------ clear all data
  // One button wipes every section (names, results, notes, tester details), the saved draft and
  // the last report built, after a check that lists what will go.
  function toolContent(t) {
    var s = state[t], n = 0, details = false;
    Object.keys(s.values || {}).forEach(function (k) {
      var v = s.values[k] || {};
      if (['result', 'previous', 'side', 'left', 'right'].some(function (f) { return !blank(v[f]); })) n++;
    });
    Object.keys(s.meta).forEach(function (k) { if (k !== 'date' && !blank(s.meta[k])) details = true; });
    if (s.interp && !blank(s.interp.text)) details = true;
    return { results: n, any: n > 0 || details || !!s.importLog, name: String(s.meta.name || '').trim() };
  }
  function setBackgroundInert(on) {
    ['.appbar', '.workspace', '#dock'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }
  // one pop-up at a time: focus stays inside it, Escape or a tap outside closes it
  var openModalEl = null, modalReturn = null;
  function modalFocusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll('button, input, textarea, select, a[href]'), function (x) {
      return !x.disabled && !x.hidden && x.getClientRects().length > 0;
    });
  }
  function openModal(el, focusEl) {
    if (openModalEl) closeModal(false);
    modalReturn = document.activeElement;
    openModalEl = el;
    els.toast.hidden = true;
    el.hidden = false;
    setBackgroundInert(true);
    document.documentElement.style.overflow = 'hidden';
    var f = focusEl || modalFocusables(el)[0];
    if (f) f.focus();
  }
  function closeModal(restoreFocus) {
    if (!openModalEl) return;
    openModalEl.hidden = true;
    openModalEl = null;
    setBackgroundInert(false);
    document.documentElement.style.overflow = '';
    if (restoreFocus !== false && modalReturn && modalReturn.focus) modalReturn.focus();
  }
  function onModalKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    var f = modalFocusables(openModalEl);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!openModalEl.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openClearDialog() {
    var any = false;
    els.clearList.innerHTML = TOOLS.map(function (t) {
      var c = toolContent(t);
      if (c.any) any = true;
      var d = !c.any ? 'nothing entered'
        : (c.name || 'no name') + ' · ' + (c.results ? c.results + (c.results === 1 ? ' result' : ' results') : 'details only');
      return '<li' + (c.any ? ' class="has-data"' : '') + '><span class="cl-t">' + TOOL_NAMES[t] + '</span><span class="cl-d">' + esc(d) + '</span></li>';
    }).join('');
    if (!any) { toast('Nothing to clear — every section is already empty'); return; }
    openModal(els.clearDialog, els.clearCancel);
  }
  function clearAllData() {
    TOOLS.forEach(function (t) { state[t] = freshTool(t); });
    tidyState();
    // an AI draft still on its way belongs to the athlete just cleared: drop it when it arrives
    aiGen++;
    aiBusy = null; interpMsg = { tool: null, kind: '', text: '' }; interpUndo = null;
    // drop the last report built (it holds the athlete's details) and its preview
    current = { file: null, blob: null, title: '' };
    els.pages.innerHTML = '';
    els.sheetTitle.textContent = 'Report';
    // overwrite the saved draft straight away, so closing the app now can't bring the old data back
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
    closeModal(false);
    render();
    window.scrollTo(0, 0);
    els.clearAll.focus();
    toast('All data cleared — ready for the next athlete');
  }

  // ------------------------------------------------------------------ AI interpretation
  // A short plain-English summary for the athlete and coach, drafted by Claude on request and
  // always editable. Claude is called straight from the device with the clinic's own API key.
  // What is sent: the results, targets and statuses plus basic context (age, sex, mass, sport,
  // rehab phase, time since injury). Never the athlete's name, notes, tester/clinician/surgeon or dates.
  var AI_KEY_STORE = 'bh-athlete-report-ai-key';
  var SPARKLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M10 2.5l1.8 5.2 5.2 1.8-5.2 1.8L10 16.5l-1.8-5.2L3 9.5l5.2-1.8zM18.5 13l.95 2.55 2.55.95-2.55.95-.95 2.55-.95-2.55L15 16.5l2.55-.95z"/></svg>';
  var aiBusy = null, aiGen = 0, aiThenDraft = false;
  var interpMsg = { tool: null, kind: '', text: '' };
  var interpUndo = null;

  function aiKey() { try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) { return ''; } }
  function hashStr(s) {                              // FNV-1a, to notice when results change after drafting
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  var STATUS_WORD = { Green: 'Green', Amber: 'Amber', Red: 'Red', 'n/a': 'no target available' };
  var CHANGE_WORDS = { gain: 'real improvement', drop: 'real decline', noise: 'within normal test variation, not a real change', shift: 'meaningful change' };
  function changeWords(r) {
    if (!r.change) return '';
    // '▲ real gain   +1.3 (+4%)' -> '+1.3, +4%'
    var delta = String(r.change).replace(/^[^\d+\-−]*/, '').replace(/\s+/g, ' ').trim().replace(/\s*\(([^)]*)\)$/, ', $1');
    return 'vs previous test: ' + (CHANGE_WORDS[r.change_kind] || 'changed') + (delta ? ' (' + delta + ')' : '');
  }
  function rowLine(r, targetWord) {
    var v = E.fmt(r.result) + (r.unit ? ' ' + r.unit : '') + (r.side ? ' (' + (r.side === 'L' ? 'left' : 'right') + ' side higher)' : '');
    var scored = r.target && r.target !== 'n/a';
    var parts = [r.name + ': ' + v, scored ? targetWord + ' ' + r.target : 'no ' + targetWord + ' available'];
    if (scored) parts.push(STATUS_WORD[r.status] || r.status || 'not scored');
    var ch = changeWords(r);
    if (ch) parts.push(ch);
    return '- ' + parts.join(' | ');
  }
  function groupLines(groups, targetWord) {
    var out = [];
    groups.forEach(function (g) {
      out.push(clean1(g.title));
      g.rows.forEach(function (r) { out.push(rowLine(r, targetWord)); });
    });
    return out;
  }
  function clean1(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function joinBits(bits) { return bits.filter(function (b) { return b && !/:\s*$/.test(b); }).join(' · '); }
  function sinceText(t) {
    var m = state[t].meta;
    if (t === 'ham') {
      if (!blank(m.weeks)) return clean1(m.weeks);
      var d = daysBetween(m.doi, m.date); return d !== null && d >= 0 ? String(Math.floor(d / 7)) : '';
    }
    if (!blank(m.months)) return clean1(m.months);
    var d2 = daysBetween(m.dos, m.date); return d2 !== null && d2 >= 0 ? String(Math.floor(d2 / 30.4375)) : '';
  }
  function interpPayload(t, c) {
    var m = state[t].meta, L = [];
    var totals = 'Totals: ' + c.counts.Green + ' Green, ' + c.counts.Amber + ' Amber, ' + c.counts.Red + ' Red.';
    if (t === 'screen') {
      L.push('Report: athlete performance and readiness screen (VALD force plate and related tests).');
      L.push('Compared against: ' + clean1(c.pop.label) + '.');
      var who = joinBits([clean1(m.sex), blank(m.age) ? '' : clean1(m.age) + ' years', blank(m.mass) ? '' : clean1(m.mass) + ' kg', blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      if (who) L.push('Athlete: ' + who + '.');
      L.push('Status key: Green = meets the target; Amber = close to the target; Red = well short of the target.');
      L.push(totals);
      L.push('Results (metric: result | target | status | change since the previous test, if given):');
      L = L.concat(groupLines(c.groups, 'target'));
    } else if (t === 'str') {
      var pct = DATA.str.amber_pct == null ? 5 : DATA.str.amber_pct;
      L.push('Report: lower-limb strength and capacity battery. Each leg is scored against a target relative to body weight (BW). RM = repetition maximum.');
      var who2 = joinBits([blank(m.mass) ? '' : 'body mass ' + clean1(m.mass) + ' kg', blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      if (who2) L.push('Athlete: ' + who2 + '.');
      L.push('Status key: Green = at or above target; Amber = up to ' + pct + '% below target; Red = more than ' + pct + '% below target. For the hip ratio the target is a band, and Amber is within ' + pct + '% outside it.');
      L.push(totals.replace('Totals:', 'Totals (each leg counted separately):'));
      L.push('Results (test: left leg | right leg | target | difference between legs):');
      c.tests.forEach(function (tt) {
        var sides = ['L', 'R'].map(function (k) {
          var cell = tt.sides[k], label = k === 'L' ? 'Left' : 'Right';
          if (!cell || cell.value === null) return label + ' ' + (cell && cell.needsMass ? 'not scored (needs body mass)' : 'not tested');
          var raw = tt.input === 'calc' ? 'adduction ' + E.fmt(cell.parts[0]) + ' N ÷ abduction ' + E.fmt(cell.parts[1]) + ' N'
            : E.fmt(cell.input) + ' ' + (tt.input === 'reps' ? 'reps' : tt.input);
          return label + ' ' + cell.text + (cell.text.indexOf(raw) === 0 ? '' : ' (' + raw + ')') + ' ' + (STATUS_WORD[cell.status] || cell.status);
        });
        var diff = E.diffText(tt.diff);
        L.push('- ' + tt.name + (tt.detail ? ' (' + tt.detail + ')' : '') + ': ' + sides.join(' | ') + ' | target ' + tt.target + (diff ? ' | ' + diff : ''));
      });
    } else {
      var S = DATA[t], acl = t === 'acl';
      L.push(acl ? 'Report: ACL reconstruction rehab. Results are compared with ACLR research norms for ' + clean1(state.acl.sex).toLowerCase() + ' patients at this rehab phase.'
        : 'Report: hamstring strain rehab. Injured-limb results are compared with research norms for the typical case at this rehab phase.');
      if (S.disclaimer) L.push('About the norms: ' + clean1(S.disclaimer));
      var since = sinceText(t);
      var ctx = joinBits(['rehab phase: ' + clean1(state[t].phase), blank(m.injured) ? '' : 'injured side: ' + clean1(m.injured).toLowerCase(),
        since ? (acl ? 'months since surgery: ' : 'weeks since injury: ') + since : '', acl && !blank(m.graft) ? 'graft: ' + clean1(m.graft) : '',
        blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      L.push('Context: ' + ctx + '.');
      L.push('Status key: Green = at or ahead of the typical case at this phase; Amber = within 1 SD behind; Red = more than 1 SD behind.');
      L.push(totals);
      L.push('Results (metric: result | phase target | status | change since the previous test, if given):');
      L = L.concat(groupLines(c.groups, 'phase target'));
    }
    return L.join('\n');
  }
  function interpBasis(t, c) { return hashStr(interpPayload(t, c)); }

  function interpCardHtml() {
    var it = state[state.tool].interp;
    return '<section class="card interp" id="interpCard" aria-labelledby="interpTitle">' +
      '<div class="card-head"><h2 id="interpTitle">Interpretation</h2><button type="button" class="quiet" data-action="ai-settings">AI settings</button></div>' +
      '<p class="interp-help">Optional. A short plain-English summary for the athlete and coach, printed near the top of the report. Draft it with AI, then check and edit it.</p>' +
      '<div class="interp-bar"><button type="button" class="ghost ai-draft" data-action="ai-draft">' + SPARKLE + '<span data-label>Draft with AI</span></button>' +
      '<span class="interp-status" id="interpStatus" role="status" aria-live="polite"></span></div>' +
      '<textarea id="interpText" rows="5" autocapitalize="sentences" placeholder="Tap Draft with AI, or type your own summary." aria-labelledby="interpTitle">' + esc(it.text) + '</textarea>' +
      '<p class="fine interp-privacy">Claude only sees the results and basic context such as age, sex, sport or rehab phase. Never the athlete’s name, notes or dates.</p>' +
      '</section>';
  }
  function fitInterp() {                             // grow the box to show the whole text
    var ta = $('interpText');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(136, ta.scrollHeight + 2) + 'px';
  }
  function isStale(t, c) {
    var it = state[t].interp;
    return !!(it.ai && !blank(it.text) && it.basis && c && it.basis !== interpBasis(t, c));
  }
  function renderInterpState(c) {
    var card = $('interpCard');
    if (!card) return;
    var t = state.tool, it = state[t].interp, st = $('interpStatus'), btn = card.querySelector('[data-action="ai-draft"]'), ta = $('interpText');
    var busy = aiBusy === t;
    // a "can't draft yet" message goes away once the reason has gone
    if (interpMsg.tool === t && ((interpMsg.blocker && c && !blocker(c)) || (interpMsg.offline && navigator.onLine !== false))) {
      interpMsg = { tool: null, kind: '', text: '' };
    }
    btn.disabled = !!aiBusy;
    btn.classList.toggle('busy', busy);
    btn.querySelector('[data-label]').textContent = busy ? 'Drafting…' : (blank(it.text) ? 'Draft with AI' : 'Redraft with AI');
    ta.readOnly = busy;
    var kind = '', html = '';
    if (busy) { kind = 'busy'; html = 'Claude is writing the interpretation…'; }
    else if (interpMsg.tool === t && interpMsg.kind === 'error') { kind = 'error'; html = esc(interpMsg.text); }
    else if (isStale(t, c)) { kind = 'stale'; html = 'Results have changed since this was drafted. Redraft or edit it.'; }
    else if (interpMsg.tool === t && interpMsg.kind === 'done') { kind = 'done'; html = 'Drafted by Claude. Check it before creating the report.'; }
    if (!busy && interpUndo && interpUndo.tool === t) html += (html ? ' ' : '') + '<button type="button" class="quiet undo" data-action="ai-undo">Undo</button>';
    st.className = 'interp-status' + (kind ? ' ' + kind : '');
    st.innerHTML = html;
  }
  function interpFlagHtml(t, c) {
    var it = state[t].interp;
    if (blank(it.text)) return '<button type="button" class="quiet interp-flag" data-action="goto-interp">' + SPARKLE + 'Add an AI interpretation</button>';
    if (isStale(t, c)) return '<button type="button" class="quiet interp-flag stale" data-action="goto-interp">Interpretation may be out of date</button>';
    return '<button type="button" class="quiet interp-flag ok" data-action="goto-interp">✓ Interpretation included</button>';
  }
  function gotoInterp() {
    var card = $('interpCard');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var target = blank(state[state.tool].interp.text) ? card.querySelector('[data-action="ai-draft"]') : $('interpText');
    setTimeout(function () { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }, 350);
  }
  function onInterpInput(el) {
    var it = state[state.tool].interp;
    it.text = el.value;
    fitInterp();
    if (blank(el.value)) { it.ai = false; it.basis = ''; }
    interpUndo = null;
    if (interpMsg.tool === state.tool && interpMsg.kind === 'error') interpMsg = { tool: null, kind: '', text: '' };
    refresh();
  }
  function undoInterp() {
    if (!interpUndo || interpUndo.tool !== state.tool) return;
    state[state.tool].interp = { text: interpUndo.text, ai: interpUndo.ai, basis: interpUndo.basis };
    interpUndo = null;
    interpMsg = { tool: null, kind: '', text: '' };
    var ta = $('interpText');
    if (ta) ta.value = state[state.tool].interp.text;
    fitInterp();
    refresh();
  }
  function tidyAiText(s) {
    s = String(s).replace(/\r\n?/g, '\n');
    s = s.replace(/[\uD800-\uDFFF]/g, '').replace(/[\uFE0F\u200D]/g, '');   // emoji
    s = s.replace(/\*\*|__|`/g, '').replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '').replace(/^[ \t]*[-*•][ \t]+/gm, '');
    s = s.replace(/^\s*interpretation\s*[:\-–]\s*/i, '');
    s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return s;
  }
  function aiErrorText(status, j) {
    var e = (j && j.error) || {}, msg = clean1(e.message), type = e.type || '';
    var code = e.details && e.details.error_code;
    if (status === 401 || type === 'authentication_error') return 'Claude didn’t accept the API key. Check it in AI settings.';
    if (status === 403 || type === 'permission_error') return 'This API key isn’t allowed to use Claude. Check it in the Claude Console.';
    if (/credit balance/i.test(msg)) return 'The Claude API account is out of credit. Add credit in the Claude Console (Settings › Billing).';
    if (code === 'enforced_spend_limit_reached' || /usage limits?/i.test(msg)) return 'The Claude API spend limit has been reached. It can be raised in the Claude Console (Settings › Billing).';
    if (status === 429 || type === 'rate_limit_error') return 'Too many requests just now. Wait a moment and try again.';
    if (status === 529 || status >= 500 || type === 'overloaded_error' || type === 'api_error') return 'Claude is busy right now. Try again in a moment.';
    if (status === 404 || type === 'not_found_error') return 'The AI model named in interpretation.json wasn’t found' + (msg ? ' (' + msg + ')' : '') + '.';
    return 'Claude couldn’t draft this' + (msg ? ': ' + msg : ' (error ' + status + ')') + '.';
  }
  function callClaude(key, payload) {
    var cfg = DATA.ai;
    var body = {
      model: cfg.model, max_tokens: cfg.max_tokens || 2000, system: [].concat(cfg.system || []).join('\n'),
      messages: [{ role: 'user', content: (cfg.request || 'Write the interpretation for these test results.') + '\n\n' + payload }]
    };
    if (cfg.effort) body.output_config = { effort: cfg.effort };
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, (cfg.timeout_s || 60) * 1000);
    return fetch(cfg.endpoint || 'https://api.anthropic.com/v1/messages', {
      method: 'POST', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined,
      headers: {
        'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (raw) {
        var j = null;
        try { j = JSON.parse(raw); } catch (e) { /* not JSON */ }
        if (!res.ok) throw new Error(aiErrorText(res.status, j));
        var text = ((j && j.content) || []).filter(function (b) { return b && b.type === 'text'; })
          .map(function (b) { return b.text; }).join('\n');
        text = tidyAiText(text);
        if (!text) throw new Error(j && j.stop_reason === 'refusal' ? 'Claude didn’t write an interpretation for these results. Try again, or write your own.' : 'Claude sent back an empty answer. Try again.');
        return text;
      });
    }, function (err) {
      throw new Error(err && err.name === 'AbortError' ? 'Claude took too long to answer. Try again.' : 'Couldn’t reach Claude. Check the internet connection and try again.');
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function draftInterp() {
    if (aiBusy) return;
    var t = state.tool, c = compute(), why = blocker(c);
    interpMsg = { tool: null, kind: '', text: '' };
    function fail(msg, extra) { interpMsg = Object.assign({ tool: t, kind: 'error', text: msg }, extra || {}); renderInterpState(c); }
    if (why) return fail(why, { blocker: true });
    if (!DATA.ai || !DATA.ai.model) return fail('The AI settings file (interpretation.json) didn’t load. Reopen the app while online.');
    var key = aiKey();
    if (!key) { openAiSettings(true); return; }
    if (navigator.onLine === false) return fail('No internet connection. Connect to draft with AI, or type your own interpretation.', { offline: true });
    var payload = interpPayload(t, c), basis = hashStr(payload), gen = aiGen;
    aiBusy = t; interpUndo = null;
    renderInterpState(c);
    callClaude(key, payload).then(function (text) {
      if (gen !== aiGen) return;                     // cleared while waiting
      var it = state[t].interp;
      if (!blank(it.text)) interpUndo = { tool: t, text: it.text, ai: it.ai, basis: it.basis };
      state[t].interp = { text: text, ai: true, basis: basis };
      interpMsg = { tool: t, kind: 'done', text: '' };
    }, function (err) {
      if (gen !== aiGen) return;
      interpMsg = { tool: t, kind: 'error', text: err.message };
    }).then(function () {
      if (gen !== aiGen) return;
      aiBusy = null;
      if (state.tool === t) {
        var ta = $('interpText');
        if (ta) ta.value = state[t].interp.text;
        fitInterp();
      }
      refresh();
    });
  }
  function openAiSettings(thenDraft) {
    aiThenDraft = !!thenDraft;
    var k = aiKey();
    els.aiKey.value = '';
    els.aiErr.hidden = true;
    els.aiRemove.hidden = !k;
    els.aiKeyState.textContent = k ? 'A key ending in ' + k.slice(-4) + ' is saved on this device. Paste a new one to replace it.'
      : 'The key is saved only on this device and is only sent to Anthropic when you tap Draft with AI.';
    els.aiLead.textContent = thenDraft ? 'To draft interpretations, the app needs a Claude API key. You only need to do this once on each device.'
      : 'Drafting uses Claude through the clinic’s own Claude API key.';
    openModal(els.aiDialog, els.aiKey);
  }
  function saveAiKey() {
    var v = els.aiKey.value.replace(/\s+/g, '');
    if (!v) {
      if (aiKey()) { closeModal(); return; }
      els.aiErr.textContent = 'Paste the API key first.'; els.aiErr.hidden = false; els.aiKey.focus(); return;
    }
    if (!/^sk-ant-[A-Za-z0-9_\-]{16,}$/.test(v)) {
      els.aiErr.textContent = 'That doesn’t look like a Claude API key. They start with sk-ant-.'; els.aiErr.hidden = false; els.aiKey.focus(); return;
    }
    try { localStorage.setItem(AI_KEY_STORE, v); } catch (e) {
      els.aiErr.textContent = 'This device wouldn’t save the key (storage is blocked).'; els.aiErr.hidden = false; return;
    }
    els.aiKey.value = '';
    var then = aiThenDraft;
    closeModal();
    toast('API key saved on this device');
    if (then) draftInterp();
  }
  function removeAiKey() {
    try { localStorage.removeItem(AI_KEY_STORE); } catch (e) { /* storage unavailable */ }
    els.aiRemove.hidden = true;
    els.aiKeyState.textContent = 'Key removed. The key is saved only on this device and is only sent to Anthropic when you tap Draft with AI.';
    els.aiKey.focus();
  }

  // ------------------------------------------------------------------ boot
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    });
  }
  function start() {
    // the AI settings are optional: the app works without them (the Draft button explains)
    var ai = fetchJson('interpretation.json').catch(function () { return null; });
    Promise.all([fetchJson('norms.json'), fetchJson('hamstring_norms.json'), fetchJson('acl_norms.json'), fetchJson('strength_norms.json'), ai]).then(function (r) {
      DATA.screen = r[0]; DATA.ham = r[1]; DATA.acl = r[2]; DATA.str = r[3]; DATA.ai = r[4];
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
      els.clearAll.addEventListener('click', openClearDialog);
      els.clearCancel.addEventListener('click', function () { closeModal(); });
      els.clearConfirm.addEventListener('click', clearAllData);
      els.aiSave.addEventListener('click', saveAiKey);
      els.aiCancel.addEventListener('click', function () { closeModal(); });
      els.aiRemove.addEventListener('click', removeAiKey);
      els.aiKey.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveAiKey(); } });
      [els.clearDialog, els.aiDialog].forEach(function (d) {
        d.addEventListener('click', function (e) { if (e.target === d) closeModal(); });
      });
      els.back.addEventListener('click', closeReport);
      els.save.addEventListener('click', savePdf);
      els.share.addEventListener('click', sharePdf);
      document.addEventListener('keydown', function (e) {
        if (openModalEl) { onModalKey(e); return; }
        if (e.key === 'Escape' && !els.sheet.hidden) closeReport();
      });
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
