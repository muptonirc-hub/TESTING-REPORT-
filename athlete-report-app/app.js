/* BASE Health Report: screen logic.
   Four tools (screening, LL strength, hamstring rehab, ACL rehab). Everything runs on the device: results are
   scored as they are typed, the PDF is built locally, and a draft is kept in this browser only until
   "Clear all data" wipes it. Creating a PDF also saves the session to the client's record on this device,
   so the next test can load their previous results and the report can show progress. "Scan notes" reads a photo
   of handwritten results with Claude and fills the boxes for checking.
   A fifth tab, Exercises (v10), turns a photo of a handwritten exercise page into an editable table and a PDF
   handout. It is kept in the draft only (never in client records).
   v13: with the clinic store configured (cloud-config.js), every device signs in once with the clinic login and the
   client records live in Firestore (cloud.js), cached on the device; the draft stays on the device as before. */
(function () {
  'use strict';
  var E = window.BHEngine;
  var CLOUD = window.BHCloud && window.BHCloud.enabled ? window.BHCloud : null;   // v13: the clinic store, or null in local mode
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
    aiKeyState: $('aiKeyState'), aiErr: $('aiErr'), aiLead: $('aiLead'),
    clientsBtn: $('clientsBtn'), clientsDialog: $('clientsDialog'), clientsList: $('clientsList'), clientsSummary: $('clientsSummary'),
    clientsBackup: $('clientsBackup'), clientsRestore: $('clientsRestore'), clientsClose: $('clientsClose'),
    clientsTitle: $('clientsTitle'), clientsSearch: $('clientsSearch'), clientsSearchWrap: $('clientsSearchWrap'), clientsNew: $('clientsNew'), clientsFine: $('clientsFine'),
    moreBtn: $('moreBtn'), moreMenu: $('moreMenu'), restoreItem: $('restoreItem'), aiItem: $('aiItem'), appbar: document.querySelector('.appbar'),
    testsDialog: $('testsDialog'), testsLead: $('testsLead'), testsList: $('testsList'), testsAll: $('testsAll'), testsNone: $('testsNone'), testsDone: $('testsDone'),
    // v13: the clinic store's sign-in card, status bar and dialogs
    cloudBar: $('cloudBar'), signin: $('signin'), signinForm: $('signinForm'), signinEmail: $('signinEmail'), signinPassword: $('signinPassword'), signinShow: $('signinShow'),
    signinName: $('signinName'), signinBtn: $('signinBtn'), signinErr: $('signinErr'), accountTpl: $('accountTpl'),
    nameDialog: $('nameDialog'), nameBox: $('nameBox'), nameErr: $('nameErr'), nameCancel: $('nameCancel'), nameSave: $('nameSave'),
    signOutDialog: $('signOutDialog'), signOutText: $('signOutText'), signOutCancel: $('signOutCancel'), signOutConfirm: $('signOutConfirm'),
    legacyDialog: $('legacyDialog'), legacyText: $('legacyText'), legacyLater: $('legacyLater'), legacyUpload: $('legacyUpload'), legacyNever: $('legacyNever')
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
  // a short message at the foot of the screen; action (v11): { label, run } adds a button to it (e.g. Undo) and keeps it up longer
  function toast(msg, action) {
    els.toast.textContent = msg;
    els.toast.classList.toggle('has-act', !!action);
    if (action) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label;
      b.addEventListener('click', function () { clearTimeout(toast.t); els.toast.hidden = true; action.run(); });
      els.toast.appendChild(b);
    }
    els.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { els.toast.hidden = true; }, action ? 6000 : 3200);
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function focusQuiet(el) {                            // move focus without scrolling (and without opening the keyboard: never a box)
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }
  // Status chips say what they mean (On target / Close / Off target, or the rehab wording) and carry a symbol,
  // so they read without colour: tick, exclamation mark, cross, dash. The words live in engine.js (shared with the PDF).
  var STATUS_ICON = {
    Green: '<path d="M2.5 6.4l2.3 2.3 4.7-5.1"/>',
    Amber: '<path d="M6 2.3v4.5"/><circle cx="6" cy="9.4" r=".5"/>',
    Red: '<path d="M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6"/>',
    'n/a': '<path d="M3.2 6h5.6"/>'
  };
  function statusIcon(status) {
    var p = STATUS_ICON[status];
    return p ? '<svg class="si" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>' : '';
  }
  function wordKind(t) { return t === 'ham' || t === 'acl' ? 'rehab' : 'target'; }
  // Screening is for athletes; LL Strength and the rehab tabs are used with patients of all kinds (v9)
  function person(t) { return t === 'screen' ? 'athlete' : 'patient'; }
  function Person(t) { return t === 'screen' ? 'Athlete' : 'Patient'; }
  function statusWord(status, t) { return E.statusWord(status, wordKind(t || state.tool)); }
  function chip(status, text) {
    var cls = status === 'n/a' ? 'na' : status;
    return '<span class="chip ' + cls + '">' + statusIcon(status) + esc(text || statusWord(status)) + '</span>';
  }

  // ------------------------------------------------------------------ state
  var TOOLS = ['screen', 'str', 'ham', 'acl'];         // the four reports (the Exercises tab, 'ex', is handled on its own)
  var TOOL_NAMES = { screen: 'Performance screen', str: 'LL Strength', ham: 'Hamstring rehab', acl: 'ACL rehab', ex: 'Exercises' };   // v14: 'Screening' is the section
  function freshInterp() { return { text: '', ai: false, basis: '' }; }
  // For the coach (v8): the clinician's call on training, printed as a band on the report. Never worked out by the
  // app, never filled in from records and never sent to Claude.
  var COACH_STATUS = ['Full training', 'Modified', 'Rehab only'];
  var COACH_LOOK = { 'Full training': 'Green', 'Modified': 'Amber', 'Rehab only': 'Red' };
  function freshCoach() { return { status: '', mods: '', retest: '' }; }
  // v13, cloud mode: the practitioner's name on this device (bh-athlete-report-user-v1), typed on the sign-in card. It fills
  // the Clinician box (tester on Screening and LL Strength, clinician on Hamstring, practitioner on Exercises) whenever that
  // box is empty; never a typed value. The ACL box is the surgeon's, so it is left alone.
  function userName() { return CLOUD ? CLOUD.userName() : ''; }
  var NAME_FIELDS = { screen: 'tester', str: 'tester', ham: 'clinician', ex: 'practitioner' };
  // cardOpen (v11): the details card is open (true) or folded into the one-line strip (false)
  function freshTool(tool, keep) {
    keep = keep || {};
    if (tool === 'screen') return { meta: { name: '', date: todayIso(), sex: '', age: '', sport: '', tester: keep.tester || userName(), mass: '', notes: '' }, pop: 'general', values: {}, radar: null, collapsed: {}, importLog: null, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
    if (tool === 'ham') return { meta: { name: '', date: todayIso(), injured: '', clinician: keep.clinician || userName(), doi: '', weeks: '', sport: '', notes: '' }, phase: null, values: {}, collapsed: {}, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
    if (tool === 'str') return { meta: { name: '', date: todayIso(), mass: '', sport: '', tester: keep.tester || userName(), notes: '' }, values: {}, collapsed: {}, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
    return { meta: { name: '', date: todayIso(), injured: '', surgeon: keep.surgeon || '', graft: '', dos: '', months: '', sport: '', notes: '' }, phase: null, sex: null, values: {}, collapsed: {}, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
  }
  // blank Clinician boxes take the practitioner's name; boxes still holding the previous name (was) follow a name change
  function fillPractitioner(was) {
    var nm = userName(), changed = false;
    if (!nm || !state) return false;
    Object.keys(NAME_FIELDS).forEach(function (t) {
      var m = state[t] && state[t].meta;
      if (!m) return;
      var f = NAME_FIELDS[t], cur = String(m[f] == null ? '' : m[f]).trim();
      if ((cur === '' || (was && cur === was)) && m[f] !== nm) { m[f] = nm; changed = true; }
    });
    if (changed) saveDraft();
    return changed;
  }
  function loadDraft() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.v === 1 && s.screen && s.ham && s.acl) { if (!s.str) s.str = freshTool('str'); return s; }
    } catch (e) { /* no stored draft */ }
    return null;
  }
  var saveTimer = null;
  // the draft as saved: everything in state except the Exercises tab's Edit mode (state.ex.editing), which is for this visit only
  function draftJson() {
    return JSON.stringify(state, function (k, v) { return k === 'editing' && this === state.ex ? undefined : v; });
  }
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE, draftJson()); } catch (e) { /* storage unavailable */ }
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
      if (state[t].hist && typeof state[t].hist !== 'object') state[t].hist = null;
      // boxes filled from scanned notes and not yet checked (kept with the draft so the highlight survives a reload)
      var sc = state[t].scanned;
      if (!sc || typeof sc !== 'object' || Array.isArray(sc)) state[t].scanned = {};
      // v8: values confirmed with "Looks right" (metric|field -> value~previous), and "Only last time's tests"
      var ok = state[t].typoOk;
      if (!ok || typeof ok !== 'object' || Array.isArray(ok)) state[t].typoOk = {};
      state[t].onlyPrev = state[t].onlyPrev === true;
      // v8 batch B: the coach band (drafts from v7 and earlier have none)
      var co = state[t].coach;
      if (!co || typeof co !== 'object' || Array.isArray(co)) co = state[t].coach = freshCoach();
      co.status = COACH_STATUS.indexOf(co.status) >= 0 ? co.status : '';
      co.mods = typeof co.mods === 'string' ? co.mods : '';
      co.retest = typeof co.retest === 'string' && E.parseDate(co.retest, ['Y-m-d']) ? co.retest : '';
      state[t].cardOpen = state[t].cardOpen !== false;   // v11: drafts from before the strip have the card open
    });
    tidyEx();                                          // v10: the exercise program (drafts from v9 and earlier have none)
    if (TOOLS.indexOf(state.tool) < 0 && state.tool !== 'ex') state.tool = 'screen';
    // v14: the screening tool the Screening tab returns to (the one in use, or the last one used before Exercises)
    if (TOOLS.indexOf(state.screenTool) < 0) state.screenTool = TOOLS.indexOf(state.tool) >= 0 ? state.tool : 'screen';
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
        if (m.calc === 'LSI') inputs[m.name] = { result: E.lsi(E.parseInput(v.left), E.parseInput(v.right), s.meta.injured), previous: E.parseInput(v.previous) };
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
    screen: ['Performance & readiness screen', 'Leave a metric blank to skip it; add the previous result to see real change.'],
    str: ['Lower-limb strength & capacity', 'Enter each leg\u2019s load, force or reps. Blank tests are left out.'],
    ham: ['Hamstring rehab & return to play', 'Injured-limb results against the targets for the chosen phase.'],
    acl: ['ACL rehab & return to play', 'Injured-limb and symmetry results against ACLR norms for the chosen phase and sex.'],
    ex: ['Exercise program', 'Photograph the handwritten page (no patient name on it), then check the table.']
  };
  // v11: metric-group titles in sentence case on screen (the norms files, the PDFs and the AI keep the raw names)
  var GROUP_TITLES = {
    'FORCEDECKS - COUNTERMOVEMENT JUMP (CMJ)': 'ForceDecks · Countermovement jump (CMJ)',
    'FORCEDECKS - ISOMETRIC MID-THIGH PULL (IMTP)': 'ForceDecks · Isometric mid-thigh pull (IMTP)',
    'FORCEDECKS - HOP TEST / REACTIVE STRENGTH (RSI)': 'ForceDecks · Hop test / reactive strength (RSI)',
    'NORDBORD - NORDIC HAMSTRING': 'NordBord · Nordic hamstring',
    'FORCEFRAME - HIP / GROIN STRENGTH': 'ForceFrame · Hip / groin strength',
    'DSI - DYNAMIC STRENGTH INDEX (DERIVED)': 'Dynamic strength index (DSI)',
    'DYNAMO - ISOMETRIC STRENGTH (GENERIC SLOT)': 'DynaMo · Isometric strength',
    'SMARTSPEED - SPEED & AGILITY': 'SmartSpeed · Speed & agility',
    'LOWER-LIMB STRENGTH & CAPACITY': 'Lower-limb strength & capacity',
    'RANGE OF MOTION / LENGTH (DynaMo)': 'Range of motion / length (DynaMo)',
    'STRENGTH - HAND-HELD / FIXED DYNAMOMETRY (DynaMo)': 'Strength · Hand-held / fixed dynamometry (DynaMo)',
    'ECCENTRIC STRENGTH (NordBord)': 'Eccentric strength (NordBord)',
    'ISOKINETIC DYNAMOMETRY (if available)': 'Isokinetic dynamometry (if available)',
    'FUNCTION (SmartSpeed)': 'Function (SmartSpeed)',
    'CLINICAL / PATIENT-REPORTED': 'Clinical / patient-reported',
    'PATIENT-REPORTED OUTCOMES (PROMs)': 'Patient-reported outcomes (PROMs)',
    'STRENGTH — ISOKINETIC / ISOMETRIC DYNAMOMETRY': 'Strength · Isokinetic / isometric dynamometry',
    'JUMP — CMJ / SQUAT (ForceDecks)': 'Jump · CMJ / squat (ForceDecks)',
    'SINGLE-LEG JUMP / REACTIVE (ForceDecks)': 'Single-leg jump / reactive (ForceDecks)',
    'HOP TESTS (ForceDecks)': 'Hop tests (ForceDecks)',
    'BALANCE (Star Excursion / SEBT)': 'Balance (star excursion / SEBT)'
  };
  // names kept as written when a new group falls back to the generic rule (matched ignoring case)
  var TITLE_KEEP = {};
  ['CMJ', 'IMTP', 'RSI', 'DSI', 'RFD', 'ISO', 'LSI', 'ACL', 'ACLR', 'SEBT', 'PROMs', 'HHD', 'ROM', 'VALD', 'L/R', 'BW', 'RM',
    'ForceDecks', 'NordBord', 'ForceFrame', 'DynaMo', 'SmartSpeed'].forEach(function (w) { TITLE_KEEP[w.toUpperCase()] = w; });
  function groupTitle(raw) {
    var key = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (GROUP_TITLES[key]) return GROUP_TITLES[key];
    // any other name: lower case with the first word capitalised, a spaced dash as ' · ', the names above as written
    return key.split(/ [-–—] /).map(function (part) {
      return part.split(' ').map(function (w, i) {
        var core = w.replace(/^[(\[]+|[)\],.:;]+$/g, ''), keep = TITLE_KEEP[core.toUpperCase()];
        if (keep) return w.replace(core, keep);
        var low = w.toLowerCase();
        return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
      }).join(' ');
    }).join(' · ');
  }

  function field(tool, key, label, o) {
    o = o || {};
    var v = state[tool].meta[key] || '';
    var id = tool + '-' + key;
    var html = '<label class="f' + (o.cls ? ' ' + o.cls : '') + '" for="' + id + '"><span>' + esc(label) + '</span>' +
      '<input id="' + id + '" data-meta="' + key + '" value="' + esc(v) + '"' +
      (o.type ? ' type="' + o.type + '"' : ' type="text"') +
      (o.mode ? ' inputmode="' + o.mode + '"' : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
      (o.words ? ' autocapitalize="words"' : '') + ' autocomplete="off" spellcheck="false" enterkeyhint="next"></label>';
    // the name field offers saved clients as you type (o.plain: a name box without suggestions, on the Exercises tab)
    if (key === 'name' && !o.plain) html ='<div class="f' + (o.cls ? ' ' + o.cls : '') + ' name-wrap">' + html.replace(' ' + o.cls, '') + '<div class="suggest" id="' + id + '-sugg" hidden></div></div>';
    return html;
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

  // The scan photo input lives inside whichever Scan button shows: the card's, or the camera in the strip when it is folded
  // (both are <label for="scanFiles">, so a tap lands on the input itself)
  function scanInputHtml(t) {
    return '<input id="scanFiles" type="file" accept="image/*" multiple aria-label="' + (t === 'ex'
      ? 'Scan exercise page: photos or screenshots of a handwritten exercise program, several pages at once'
      : 'Scan notes: photo of handwritten results or a VALD app screenshot') + '">';
  }
  var PEOPLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';
  // the head of the details card: Choose client (report tabs), Scan, Import VALD CSV (Screening) and Done (v11)
  function cardHead(t, h2id) {
    var open = state[t].cardOpen !== false;
    var out = '<div class="card-head"><h2 id="' + h2id + '">' + (t === 'ex' ? 'Patient' : Person(t)) + '</h2><div class="head-actions">';
    if (t !== 'ex') out += '<button type="button" class="ghost choose-btn" data-action="choose-client" aria-haspopup="dialog">' + PEOPLE + 'Choose client</button>';
    out += '<label class="ghost file-btn scan-btn" id="scanBtn" for="scanFiles">' + CAMERA + '<span data-label>' + (t === 'ex' ? 'Scan exercise page' : 'Scan notes') + '</span>' +
      (open ? scanInputHtml(t) : '') + '</label>';
    if (t === 'screen') {
      out += '<label class="ghost file-btn" for="valdFiles">Import VALD CSV<input id="valdFiles" type="file" accept=".csv,text/csv" multiple></label>';
    }
    // Done last on the right (on a phone, beside the title)
    return out + '</div><button type="button" class="ghost done-btn" id="athleteDone" data-action="done-athlete"' + (essentials(t) ? '' : ' disabled') + '>Done</button></div>';
  }
  function athleteCard() {
    var t = state.tool, s = state[t];
    var out = '<section class="card athlete" id="athleteCard" tabindex="-1" aria-labelledby="athleteH"' + (s.cardOpen === false ? ' hidden' : '') + '>' + cardHead(t, 'athleteH');
    out += '<div class="fields">';
    if (t === 'screen') {
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'sex', 'Sex', ['Male', 'Female']) +
        field(t, 'age', 'Age (years)', { mode: 'decimal' }) + field(t, 'mass', 'Mass (kg)', { mode: 'decimal' }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'tester', 'Clinician', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'full' });
      var pops = [['general', 'General population (auto by age & sex)']].concat(E.sportPopulations(DATA.screen).map(function (p) { return [p, p]; }));
      out += select('screen-pop', 'Compare against', pops, s.pop, 'data-choice="pop"', 'wide');
    } else if (t === 'str') {
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        field(t, 'mass', 'Body mass (kg)', { mode: 'decimal' }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'tester', 'Clinician', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'wide' });
    } else if (t === 'ham') {
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'injured', 'Injured side', ['Left', 'Right']) +
        field(t, 'doi', 'Date of injury', { type: 'date' }) + field(t, 'weeks', 'Weeks since injury', { mode: 'decimal' }) +
        field(t, 'clinician', 'Clinician', { words: true }) + field(t, 'sport', 'Sport', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'full' });
      out += select('ham-phase', 'Rehab phase', DATA.ham.phases.map(function (p) { return [p, p]; }), s.phase, 'data-choice="phase"', 'wide');
    } else {
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'injured', 'Injured side', ['Left', 'Right']) +
        field(t, 'dos', 'Date of surgery', { type: 'date' }) + field(t, 'months', 'Months since surgery', { mode: 'decimal' }) +
        field(t, 'graft', 'Graft type') + field(t, 'surgeon', 'Surgeon / clinician', { words: true }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'notes', 'Notes', { cls: 'span3' });
      out += select('acl-phase', 'Rehab phase', DATA.acl.phases.map(function (p) { return [p, p]; }), s.phase, 'data-choice="phase"', 'wide');
      out += '<div class="f wide"><span id="acl-sex-l">Norm set</span><div class="seg" role="group" aria-labelledby="acl-sex-l">' +
        DATA.acl.sexes.map(function (x) { return '<button type="button" data-choice-seg="sex" data-value="' + esc(x) + '" aria-pressed="' + (s.sex === x) + '">' + esc(x) + '</button>'; }).join('') + '</div></div>';
    }
    out += '</div><p class="note" id="ctxNote" hidden></p>';
    // the strip in the card's place when it is folded; the scan and client bars and the VALD import log sit under either,
    // so they show both ways (v11)
    return out + '</section>' + stripHtml(t) + '<div class="scan-bar" id="scanBar" role="status" aria-live="polite" hidden></div><div class="client-bar" id="clientBar" hidden></div>' +
      (t === 'screen' ? '<div class="import-log" id="importLog" hidden></div>' : '');
  }

  // ------------------------------------------------------------------ the athlete strip (v11)
  // Once the essentials are in and results start arriving, the details card folds into one line that stays under the
  // app bar: whose results these are, the details that matter for the tab, a camera for Scan and Edit to open the card.
  // Essentials: Screening name + sex, LL Strength name + body mass, the rehab tabs name + injured side, Exercises the name.
  function essentials(t) {
    var m = state[t].meta;
    if (blank(m.name)) return false;
    if (t === 'screen') return !!m.sex;
    if (t === 'str') return !blank(m.mass);
    if (t === 'ham' || t === 'acl') return !!m.injured;
    return true;
  }
  function stripHtml(t) {
    var open = state[t].cardOpen !== false;
    return '<div class="strip" id="athleteStrip" role="group" aria-label="' + (t === 'screen' ? 'Athlete' : 'Patient') + '"' + (open ? ' hidden' : '') + '>' +
      '<div class="strip-text" id="stripText"></div>' +
      '<label class="strip-scan file-btn scan-btn" id="stripScan" for="scanFiles" title="' + (t === 'ex' ? 'Scan exercise page' : 'Scan notes') + '">' + CAMERA + (open ? '' : scanInputHtml(t)) + '</label>' +
      '<button type="button" class="ghost strip-edit" data-action="edit-athlete" aria-label="Edit ' + (t === 'screen' ? 'athlete' : 'patient') + ' details">Edit</button></div>';
  }
  // 'General Clinical — Male · 20-30 yr' -> 'General Clinical M 20–30' (sport populations as they are)
  function shortPop(label) {
    return String(label).replace(/ — (Male|Female)/, function (m, s) { return ' ' + s.charAt(0); })
      .replace(/ · (\d+)-(\d+) yr$/, ' $1–$2').replace(/ · all ages$/, ' all ages');
  }
  function stripBits(t, c) {
    var s = state[t], m = s.meta, out = [];
    function add(v) { v = clean1(v); if (v) out.push(v); }
    var date = m.date ? E.displayIso(m.date) : '';
    if (t === 'screen') {
      add(m.sex === 'Male' ? 'M' : (m.sex === 'Female' ? 'F' : ''));
      if (!blank(m.age)) add(clean1(m.age) + ' y');
      if (!blank(m.mass)) add(clean1(m.mass) + ' kg');
      add(m.sport); add(date);
      if (c && c.pop && c.pop.label) add('vs ' + shortPop(c.pop.label));
    } else if (t === 'str') {
      if (!blank(m.mass)) add(clean1(m.mass) + ' kg');
      add(m.sport); add(date);
    } else if (t === 'ham' || t === 'acl') {
      if (m.injured) add(m.injured + ' injured');
      var since = sinceText(t);
      if (since) add(since + (t === 'ham' ? ' wk' : ' mo post-op'));
      add(s.phase);
      if (t === 'acl') {
        if (s.sex) add(s.sex + ' norms');
        if (!blank(m.graft)) add(/graft/i.test(m.graft) ? m.graft : clean1(m.graft) + ' graft');
      }
      add(date);
    } else {
      add(date); add(m.practitioner);
    }
    return out;
  }
  // the strip's words, and the Done button (enabled once the essentials are in); kept up to date as details change
  function syncCard(c) {
    var t = state.tool, el = $('stripText'), done = $('athleteDone');
    if (done) done.disabled = !essentials(t);
    if (!el) return;
    var name = clean1(state[t].meta.name);
    var html = (name ? '<b class="strip-name">' + esc(name) + '</b>' : '<span class="strip-name none">No name</span>') +
      '<span class="strip-bits">' + stripBits(t, c).map(function (x) { return '<span class="sb"> · ' + esc(x) + '</span>'; }).join('') + '</span>';
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  }
  // the card or the strip on screen as state[t].cardOpen says; the scan input moves to the Scan button that shows.
  // Folding while a result is being typed keeps that box where it was on the screen (the content above it shrank).
  function showCard() {
    var t = state.tool, open = state[t].cardOpen !== false, card = $('athleteCard'), strip = $('athleteStrip');
    document.documentElement.classList.toggle('has-strip', !!strip && !open);
    if (!card || !strip) return;
    var a = document.activeElement, anchor = a && a !== document.body && !card.contains(a) && !strip.contains(a) && els.entry.contains(a) ? a : null;
    var y = anchor ? anchor.getBoundingClientRect().top : 0;
    if (card.hidden !== !open) card.hidden = !open;
    if (strip.hidden !== open) strip.hidden = open;
    var inp = $('scanFiles'), home = open ? $('scanBtn') : $('stripScan');
    if (inp && home && inp.parentNode !== home) home.appendChild(inp);
    if (anchor) {
      var d = anchor.getBoundingClientRect().top - y;
      if (Math.abs(d) > 1) window.scrollBy(0, d);
    }
    checkStuck();
  }
  var cardPin = {};                                    // tabs whose card was opened with Edit: typing leaves it open until Done
  function setCardOpen(t, open) {
    state[t].cardOpen = open;
    if (!open) delete cardPin[t];
    if (t === state.tool) showCard();
    saveDraft();
  }
  // a text box in the details card has focus (the card never folds away under someone typing in it)
  function cardFieldFocused() {
    var a = document.activeElement, card = $('athleteCard');
    return !!(a && card && card.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'file');
  }
  // results have arrived: fold the card when the essentials are in. typed: a result typed in (not after Edit opened the card)
  function shouldFold(t, typed) {
    return state[t].cardOpen !== false && essentials(t) && !(typed && cardPin[t]) && !(state.tool === t && cardFieldFocused());
  }
  function foldNow(t, typed) {                         // on the page as it is (no redraw)
    if (!shouldFold(t, typed)) return false;
    setCardOpen(t, false);
    return true;
  }
  function foldBeforeRender(t) {                       // for a change that redraws the tab anyway
    if (!shouldFold(t, false)) return;
    state[t].cardOpen = false;
    delete cardPin[t];
  }
  function openCard() {                                // Edit: the card, scrolled into view; focus on the card itself (no keyboard)
    var t = state.tool;
    cardPin[t] = true;
    setCardOpen(t, true);
    var card = $('athleteCard');
    if (!card) return;
    var r = card.getBoundingClientRect();
    if (r.top < appbarH || r.top > window.innerHeight - 120) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    focusQuiet(card);
  }
  function closeCard() {                               // Done: back to the strip, focus on its Edit button
    setCardOpen(state.tool, false);
    focusQuiet(document.querySelector('#athleteStrip [data-action="edit-athlete"]'));
  }
  // the strip loses its top corners and border while it sits under the app bar
  var appbarH = 0, stuckFrame = 0;
  function checkStuck() {
    var strip = $('athleteStrip');
    if (!strip || strip.hidden) return;
    strip.classList.toggle('stuck', window.pageYOffset > 0 && strip.getBoundingClientRect().top <= appbarH + 0.5);
  }
  function measureBar() {                              // --appbar-h: the app bar's height here (landscape, portrait and phone differ)
    var hb = Math.round(els.appbar.getBoundingClientRect().height);
    // v13: the store's status bar sticks under the app bar, so the strip and scroll padding sit under both
    var hc = els.cloudBar && !els.cloudBar.hidden ? Math.round(els.cloudBar.getBoundingClientRect().height) : 0, h = hb + hc;
    if (hc) document.documentElement.style.setProperty('--cloud-top', hb + 'px');
    if (h && h !== appbarH) { appbarH = h; document.documentElement.style.setProperty('--appbar-h', h + 'px'); }
    checkStuck();
  }

  // the metric name: a button that opens a plain-English explainer when explainers.json has one (A7)
  var INFO = '<svg class="m-i" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.3v3.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="4.8" r="1.05" fill="currentColor"/></svg>';
  var explainOpen = {};                               // which explainers are open (this visit only)
  function explainer(key) {
    var x = DATA.explain && DATA.explain.metrics && DATA.explain.metrics[key];
    return x && typeof x.what === 'string' && x.what.trim() ? x : null;
  }
  function nameHtml(tool, key, label, id) {
    var x = explainer(key);
    if (!x) return '<div class="m-name">' + esc(label) + '</div>';
    var open = !!explainOpen[tool + '|' + key];
    return '<button type="button" class="m-name m-namebtn" data-action="explain" aria-expanded="' + open + '" aria-controls="' + id + '-x" aria-describedby="explainHint">' + esc(label) + INFO + '</button>' +
      '<div class="m-explain" id="' + id + '-x"' + (open ? '' : ' hidden') + '><p>' + esc(x.what) + '</p>' + (x.how ? '<p class="m-how">' + esc(x.how) + '</p>' : '') + '</div>';
  }
  function metricInput(id, nm, v, fieldName, cls, ph, label) {
    return '<input class="' + cls + '" id="' + id + '-' + fieldName + '" data-field="' + fieldName + '" value="' + esc(v[fieldName]) + '" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="' + ph + '" aria-label="' + nm + ' ' + label + '">';
  }
  // A previous result loaded from the client's records shows as text with a pencil, so Result is the one box to type in.
  // Tapping the pencil (or a hand-typed previous) gives the normal box.
  var PENCIL = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  function fromRecord(v) { return !!(v && v.prevDate && !blank(v.previous) && !v.prevEdit); }
  function shortDate(iso, ref) {                       // '2026-03-12' -> '12 Mar' ('12 Mar 2025' when the year differs)
    var d = E.displayIso(iso), a = E.parseDate(iso, ['Y-m-d']), b = E.parseDate(ref || '', ['Y-m-d']);
    return a && (!b || a.y === b.y) ? d.replace(/ \d{4}$/, '') : d;
  }
  function prevHtml(tool, id, nm, v) {
    if (!fromRecord(v)) return metricInput(id, nm, v, 'previous', 'm-prev', 'Prev.', 'previous result');
    return '<div class="m-prev m-prevtext" id="' + id + '-previous" data-field="previous"><span class="pv"><span class="vh">Previous result </span><b>' + esc(String(v.previous).trim()) +
      '</b><span class="pv-d"><span class="vh">, </span>' + esc(shortDate(v.prevDate, state[tool].meta.date)) + '</span></span>' +
      '<button type="button" class="pv-edit" data-action="prev-edit" aria-label="Edit previous result">' + PENCIL + '</button></div>';
  }
  // the change line on screen (E.changeLabel's words, v11): when it wraps, the amount and 'within noise' stay whole
  function changeHtml(text, kind) {
    return esc(E.changeLabel(text, kind)).replace(/[▲▼●] \S+|[+\-]?\d[\d.]*(?: \([+\-]?\d[\d.]*%\))?|within noise/g, function (m) { return '<span class="nw">' + m + '</span>'; });
  }
  // v11: on a phone the column headings are hidden, so each box gets a small label above it (hidden on wider screens;
  // the boxes keep their own aria-labels)
  function boxLabels(a, b) {
    return '<span class="m-bl m-bl-a" aria-hidden="true">' + a + '</span><span class="m-bl m-bl-b" aria-hidden="true">' + b + '</span>';
  }
  function metricRow(tool, m, gi, mi) {
    var v = val(tool, m.name), id = tool + '-' + gi + '-' + mi, nm = esc(m.name);
    var asym = tool === 'screen' && E.isAsym(m.name);
    var hint = '<span class="m-unit">' + esc(m.unit) + '</span>';
    if (m.calc === 'PERKG' || m.calc === 'PERBW') hint = '<span class="m-unit">enter force in N · scored as ' + esc(m.unit) + ' using mass</span>';
    if (m.calc === 'LSI') hint = '<span class="m-unit">enter left & right · LSI = injured ÷ other side</span>';
    // the same words as the column headings: Result (Injured on the hamstring tab) and Previous; Left and Right for an LSI
    var labels = m.calc === 'DSI' ? '' : (m.calc === 'LSI' ? boxLabels('Left', 'Right') : boxLabels(tool === 'ham' ? 'Injured' : 'Result', 'Previous'));
    var html = '<div class="metric' + (asym ? ' has-side' : '') + (labels ? ' has-bl' : '') + '" data-metric="' + nm + '" data-status="" id="' + id + '">' +
      '<div class="m-label">' + nameHtml(tool, m.name, m.name, id) + '<div class="m-hint">' + hint +
      '<span class="m-target"></span><span class="m-calc"></span><span class="m-prevnote"></span><span class="m-spark"></span></div><div class="m-meter"></div></div>' + labels;
    function input(fieldName, cls, ph, label) { return metricInput(id, nm, v, fieldName, cls, ph, label); }
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
      html += prevHtml(tool, id, nm, v);
    }
    return html + '<div class="m-out" aria-live="off"></div><div class="m-check" id="' + id + '-check" hidden></div></div>';
  }

  function groupsHtml(tool) {
    var S = DATA[tool], s = state[tool], on = testsShown(tool);
    return S.groups.map(function (g, gi) {
      if (!on[gi]) return '';                          // left out under Tests today (v11): not drawn at all
      var collapsed = !!s.collapsed[gi];
      var hasLsi = g.metrics.some(function (m) { return m.calc === 'LSI'; });
      return '<section class="group' + (collapsed ? ' collapsed' : '') + '" data-group="' + gi + '">' +
        '<button type="button" class="group-head" aria-expanded="' + !collapsed + '"><span class="gt">' + esc(groupTitle(g.title)) + '</span><span class="gc" data-count></span><span class="chev" aria-hidden="true"></span></button>' +
        '<div class="cols" aria-hidden="true"><span class="c-result">' + (hasLsi ? 'Result / L' : (tool === 'ham' ? 'Injured' : 'Result')) + '</span><span class="c-prev">' + (hasLsi ? 'Previous / R' : 'Previous') + '</span><span class="c-out">Status</span></div>' +
        '<div class="group-body">' + g.metrics.map(function (m, mi) { return metricRow(tool, m, gi, mi); }).join('') + '</div></section>';
    }).join('');
  }

  var INPUT_WORD = { kg: 'load in kg', N: 'force in N', reps: 'reps' };
  function strengthRowHtml(t, i) {
    var v = val('str', t.id), id = 'str-' + i, nm = esc(t.name);
    var how = t.input === 'calc' ? 'adduction \u00f7 abduction, each leg' : ((t.detail ? t.detail + ' \u00b7 ' : '') + INPUT_WORD[t.input]);
    var calc = t.input === 'calc';
    var html = '<div class="metric lr' + (calc ? '' : ' has-bl') + '" data-metric="' + esc(t.id) + '" data-status="" id="' + id + '">' +
      '<div class="m-label">' + nameHtml('str', t.id, t.name, id) + '<div class="m-hint"><span class="m-unit">' + esc(how) + '</span>' +
      '<span class="m-target"></span><span class="m-prevnote"></span><span class="m-spark"></span></div></div>' + (calc ? '' : boxLabels('Left', 'Right'));
    if (calc) {
      html += '<div class="m-auto" data-auto>Worked out from the hip adduction and abduction results</div>';
    } else {
      var unit = t.input === 'reps' ? 'reps' : t.input;
      ['left', 'right'].forEach(function (f) {
        html += '<input class="m-in m-' + f + '" id="' + id + '-' + f + '" data-field="' + f + '" value="' + esc(v[f]) + '" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="' +
          (f === 'left' ? 'Left' : 'Right') + ' ' + unit + '" aria-label="' + nm + ', ' + f + ' leg, ' + INPUT_WORD[t.input] + '">';
      });
    }
    return html + '<div class="m-out" aria-live="off"></div><div class="m-check" id="' + id + '-check" hidden></div></div>';
  }
  function strengthGroupHtml() {
    var collapsed = !!state.str.collapsed[0], on = testsShown('str');
    return '<section class="group' + (collapsed ? ' collapsed' : '') + '" data-group="0">' +
      '<button type="button" class="group-head" aria-expanded="' + !collapsed + '"><span class="gt">' + esc(groupTitle(String(DATA.str.title || 'Strength battery').toUpperCase())) + '</span><span class="gc" data-count></span><span class="chev" aria-hidden="true"></span></button>' +
      '<div class="cols lr" aria-hidden="true"><span class="c-left">Left</span><span class="c-right">Right</span><span class="c-out">Result</span></div>' +
      '<div class="group-body">' + DATA.str.tests.map(function (tt, i) { return strShown(tt, on) ? strengthRowHtml(tt, i) : ''; }).join('') + '</div></section>';
  }
  // LL Strength under Tests today: a test is drawn when chosen (or it has values); the hip ratio comes with either hip test
  function strShown(tt, on) {
    if (tt.input !== 'calc') return !!on[DATA.str.tests.indexOf(tt)];
    return (tt.from || []).some(function (id) { for (var i = 0; i < DATA.str.tests.length; i++) if (DATA.str.tests[i].id === id) return !!on[i]; return false; });
  }

  // ------------------------------------------------------------------ tests today (v11)
  // A per-tab choice of the sections drawn in the entry column, kept on this device in its own key (not in the draft, so
  // Clear all leaves it). What is stored is the list of HIDDEN sections (by name; LL Strength: by test id), so a section
  // added to a norms file later shows up on its own; missing or empty = everything shown. A section with anything entered
  // in it (result, previous, left/right, side) is always drawn. LL Strength has one section holding every test, so there
  // the choice is per test.
  var TESTS_STORE = 'bh-athlete-report-tests-v1';
  var testsPref = {};
  function loadTestsPref() {
    try { var o = JSON.parse(localStorage.getItem(TESTS_STORE)); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch (e) { /* none saved */ }
    return {};
  }
  function saveTestsPref() { try { localStorage.setItem(TESTS_STORE, JSON.stringify(testsPref)); } catch (e) { /* storage unavailable */ } }
  // the choosable parts of a tab: { i: index, title, sub: the count (or the test's detail), has: anything entered }
  function testParts(t) {
    var v = state[t].values;
    function any(key, fs) { var x = v[key] || {}; return fs.some(function (f) { return !blank(x[f]); }); }
    if (t === 'str') {
      var out = [];
      DATA.str.tests.forEach(function (tt, i) {
        if (tt.input !== 'calc') out.push({ i: i, key: tt.id, title: tt.name, sub: tt.detail || INPUT_WORD[tt.input], has: any(tt.id, ['left', 'right', 'prevLeft', 'prevRight']) });
      });
      return out;
    }
    return DATA[t].groups.map(function (g, gi) {
      var has = g.metrics.some(function (m) {
        // the DSI is worked out, never typed: it counts once both its forces are in (or a previous DSI was loaded)
        if (m.calc === 'DSI') return (any('CMJ Peak Force', ['result']) && any('IMTP Peak Force', ['result'])) || any(m.name, ['previous']);
        return any(m.name, ['result', 'previous', 'side', 'left', 'right']);
      });
      return { i: gi, key: String(g.title || '').replace(/\s+/g, ' ').trim(), title: groupTitle(g.title), sub: g.metrics.length + (g.metrics.length === 1 ? ' metric' : ' metrics'), has: has };
    });
  }
  function testsChosen(t, key) { var p = testsPref[t]; return !(Array.isArray(p) && p.indexOf(key) >= 0); }
  function testsShown(t) {                             // index -> drawn
    var on = {};
    testParts(t).forEach(function (p) { on[p.i] = p.has || testsChosen(t, p.key); });
    return on;
  }
  function testsBarHtml(t) {
    var on = testsShown(t), n = testParts(t).filter(function (p) { return !on[p.i]; }).length;
    var unit = t === 'str' ? ['test', 'tests'] : ['section', 'sections'];
    return '<div class="tests-bar"><button type="button" class="ghost tests-btn" id="testsBtn" data-action="tests-today" aria-haspopup="dialog">Tests today<span class="chev-s" aria-hidden="true"></span></button>' +
      (n ? '<span class="tests-hidden" id="testsHidden">' + n + ' ' + unit[n === 1 ? 0 : 1] + ' hidden</span>' : '') + '</div>';
  }
  var testsDirty = false;
  function openTestsDialog() {
    var t = state.tool;
    if (TOOLS.indexOf(t) < 0) return;
    els.testsLead.textContent = t === 'str' ? 'The tests to show on LL Strength today. Tests with results always show.'
      : 'The sections to show on ' + TOOL_NAMES[t] + ' today. Sections with results always show.';
    renderTestsList();
    testsDirty = false;
    openModal(els.testsDialog, els.testsDone, function (restore) {   // redraw the tab once, on the way out
      if (!testsDirty) return false;
      testsDirty = false;
      render();
      if (restore) focusQuiet($('testsBtn'));
      return true;
    });
  }
  function renderTestsList() {
    var t = state.tool, on = testsShown(t);
    els.testsList.innerHTML = testParts(t).map(function (p) {
      return '<li><label class="tests-row' + (p.has ? ' locked' : '') + '"><input type="checkbox" data-part="' + p.i + '"' + (on[p.i] ? ' checked' : '') + (p.has ? ' disabled' : '') + '>' +
        '<span class="tr-main"><span class="tr-t">' + esc(p.title) + '</span><span class="tr-n">' + esc(p.sub) + (p.has ? ' · has results' : '') + '</span></span></label></li>';
    }).join('');
  }
  // the ticks -> the stored list of hidden parts (a part with results keeps what was chosen before; none hidden = nothing stored)
  function saveTestsChoice() {
    var t = state.tool, hidden = [];
    testParts(t).forEach(function (p) {
      var cb = els.testsList.querySelector('input[data-part="' + p.i + '"]');
      var chosen = cb && !cb.disabled ? cb.checked : testsChosen(t, p.key);
      if (!chosen) hidden.push(p.key);
    });
    if (hidden.length) testsPref[t] = hidden; else delete testsPref[t];
    saveTestsPref();
    testsDirty = true;
  }
  function setAllTests(on) {                           // All: nothing stored (everything shows); None: only sections with results
    els.testsList.querySelectorAll('input[data-part]:not(:disabled)').forEach(function (cb) { cb.checked = on; });
    if (on) delete testsPref[state.tool];
    else testsPref[state.tool] = testParts(state.tool).filter(function (p) { return !p.has; }).map(function (p) { return p.key; });
    saveTestsPref();
    testsDirty = true;
  }

  // v14: the two tabs in the bar (Screening holds the four tools, Exercises the program builder); inside Screening the
  // page heading is the tool picker: a menu button listing the tools, the current one ticked
  var TOOL_BLURB = {
    screen: 'ForceDecks, NordBord, ForceFrame, DynaMo and SmartSpeed results against the norms for age & sex or sport.',
    str: 'Each leg\u2019s load, force or reps: asymmetry and capacity against the targets.',
    ham: 'Injured-limb results against the targets for the chosen rehab phase.',
    acl: 'Injured-limb and symmetry results against ACLR norms for the phase and sex.'
  };
  function pickHtml(t) {
    return '<div class="pick-wrap"><h1 class="pick-h"><button type="button" class="tool-pick" id="toolPick" data-tool="' + t + '" aria-haspopup="menu" aria-expanded="false" aria-controls="toolMenu" title="Choose a screening tool">' +
      '<span class="pick-text">' + esc(HEAD[t][0]) + '</span>' +
      '<span class="pick-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span></button></h1>' +
      '<div class="menu tool-menu" id="toolMenu" role="menu" aria-label="Screening tools" hidden>' +
      TOOLS.map(function (k) {
        return '<button type="button" class="menu-item tool-item" id="pick-' + k + '" role="menuitemradio" aria-checked="' + (k === t) + '" data-pick="' + k + '" tabindex="-1">' +
          '<svg class="ti-tick" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' +
          '<span class="ti-text"><b>' + esc(HEAD[k][0]) + '</b><small>' + esc(TOOL_BLURB[k]) + '</small></span></button>';
      }).join('') + '</div></div>';
  }
  function render() {
    var t = state.tool, section = t === 'ex' ? 'ex' : 'screening';
    document.querySelectorAll('.tools button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.section === section)); });
    if (t === 'ex') { renderEx(); return; }
    els.entry.innerHTML = '<div class="pagehead">' + pickHtml(t) + '<p>' + esc(HEAD[t][1]) + '</p></div>' + athleteCard() + testsBarHtml(t) +
      (t === 'str' ? strengthGroupHtml() : groupsHtml(t)) + (t === 'acl' ? rtsCardHtml() : '') + coachCardHtml() + interpCardHtml() +
      '<span id="explainHint" hidden>Shows what this test measures.</span>';
    if (t === 'screen' && state.screen.importLog) showImportLog(state.screen.importLog);
    retest.tool = null;                                // work out afresh which rows "Only last time's tests" shows
    refresh();
    fitInterp();
    applyScanMarks();
    renderScanBar();
    showCard();
  }

  // ------------------------------------------------------------------ live updates
  // The meter: soft zones (v11: grey below, soft amber close, soft green on target; the status pill beside the row
  // carries the colour, the bar shows position), today's marker and, when there is a previous result, a hollow ring at
  // it (same scale, clamped to the ends) joined to today's marker by a line coloured by the app's own change call
  // (E.change): real gain = green, real drop = red, anything else (within noise, or a shift on a band) = grey.
  function meterHtml(result, norm, prev, kind) {
    var m = E.meter(result, norm);
    if (!m) return '';
    var colour = { Green: 'var(--zone-green)', Amber: 'var(--zone-amber)', Red: 'var(--zone-red)' };
    var html = '<span class="mm-bar">' + m.segments.map(function (sg) { return '<span style="width:' + sg.width.toFixed(2) + '%;background:' + colour[sg.color] + '"></span>'; }).join('') + '</span>';
    var p = prev == null ? null : E.meterAt(m, prev);
    if (p !== null) {
      var a = Math.min(p, m.marker), b = Math.max(p, m.marker), left = p <= m.marker;
      html += '<span class="mm-trail" style="left:' + a.toFixed(2) + '%;width:' + (b - a).toFixed(2) + '%"></span>' +
        '<span class="mm-link ' + (kind === 'gain' || kind === 'drop' ? kind : 'same') + '" style="left:calc(' + a.toFixed(2) + '% + ' + (left ? 5 : 0) + 'px);width:max(0px, calc(' + (b - a).toFixed(2) + '% - 5px))"></span>' +
        '<span class="mm-prev" style="left:' + p.toFixed(2) + '%" title="Previous result"></span>';
    }
    return html + '<i style="left:' + m.marker.toFixed(1) + '%"></i>';
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
      note.textContent = 'Close = within ' + pct + '% of the target.';
    }
    var tested = 0, tr = trends('str', c);
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
          if (cell.value !== null) {
            html += '<div class="lr-line"><span class="lr-sd">' + k + '</span><span class="lr-v">' + esc(cell.text) + '</span>' + chip(cell.status) + '</div>';
            if (cell.change) html += '<div class="lr-chg m-change ' + cell.change_kind + '">' + changeHtml(cell.change, cell.change_kind) + '</div>';
          } else if (cell.needsMass) html += '<div class="lr-line lr-wait"><span class="lr-sd">' + k + '</span>needs body mass</div>';
        });
        var d = E.diffText(res.diff);
        if (d) html += '<div class="lr-diff">' + esc(d) + '</div>';
        if (res.any) tested++;
      }
      var pv = state.str.values[id] || {}, pn = el.querySelector('.m-prevnote');
      if (pn) pn.textContent = (!blank(pv.prevLeft) || !blank(pv.prevRight)) && def.input !== 'calc'
        ? 'prev ' + [['L', pv.prevLeft], ['R', pv.prevRight]].filter(function (x) { return !blank(x[1]); }).map(function (x) { return x[0] + ' ' + E.fmt(E.parseInput(x[1])); }).join(' · ') + ' ' + (def.input === 'reps' ? 'reps' : def.input) + (pv.prevDate ? ' (' + E.displayIso(pv.prevDate) + ')' : '')
        : '';
      setSpark(el, def.input === 'calc' ? '' : ['L', 'R'].map(function (k) {       // one small line per leg
        var r = tr[id + '|' + k];
        return r ? '<span class="sp-leg" aria-hidden="true">' + k + '</span>' + sparkSvg(r, def.dir || 'Higher', (k === 'L' ? 'Left' : 'Right') + ' leg ') : '';
      }).join(''));
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
    if (state.tool === 'ex') { refreshEx(); return; }   // e.g. a late AI draft or a client restore while on the Exercises tab
    var t = state.tool, c = compute();
    applyRetest(false);
    refreshClientBar(c);
    syncCard(c);
    if (t === 'str') { refreshStrength(c); showTypo(typoFlags(t, c)); renderSummary(c); renderInterpState(c); saveDraft(); return; }
    var S = DATA[t];
    // context note under the athlete card
    var note = $('ctxNote');
    if (t === 'screen') {
      note.hidden = false;
      note.className = 'note' + (c.pop.level === 'warn' ? ' warn' : '');
      // one short line (v11): the general norms say which band was picked ('Norms: Male, 20–30 yr.'); IMTP and DSI have no bands
      var gen = !!c.pop.population && c.pop.population.indexOf('General Clinical') === 0;
      note.textContent = (gen ? c.pop.note.replace(/^Auto-selected: /, 'Norms: ').replace(/(\d)-(\d)/g, '$1–$2') : c.pop.note).replace(/([^.])$/, '$1.') +
        (gen && c.pop.ageBand !== 'All ages' ? ' IMTP and DSI use all-ages norms.' : '');
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
    var seen = {}, tr = trends(t, c);
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
        if (m.calc === 'LSI' && row) calc.textContent = '= ' + E.fmt(row.result) + '%';   // the chip carries the status word
        var pn = el.querySelector('.m-prevnote');
        if (pn) pn.textContent = v.prevDate && !blank(v.previous)
          ? (m.calc === 'LSI' || m.calc === 'DSI' ? 'prev ' + E.fmt(E.parseInput(v.previous)) + (m.calc === 'LSI' ? '%' : '') + ' ' : 'prev ') + '(' + E.displayIso(v.prevDate) + ')'
          : '';
        setSpark(el, tr[m.name] ? sparkSvg(tr[m.name], m.dir, '') : '');
        if (row) {
          entered++;
          el.dataset.status = row.status || '';
          out.innerHTML = chip(row.status) + (row.change ? '<span class="m-change ' + row.change_kind + '">' + changeHtml(row.change, row.change_kind) + '</span>' : '');
          meter.innerHTML = meterHtml(row.result, row.norm, row.prev, row.change_kind);
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
    if (t === 'acl') refreshRts(c);
    showTypo(typoFlags(t, c));
    renderSummary(c);
    renderInterpState(c);
    saveDraft();
  }

  // ------------------------------------------------------------------ typo guard
  // A value outside the metric's usual range ("range" in the norms files, in the unit typed) or more than
  // E.TYPO_JUMP_PCT % away from the previous result gets an amber outline and a "Check:" line with Looks right.
  // Nothing is blocked. Looks right is kept in the draft for that exact value (and previous), so any change re-checks.
  // Values filled by Scan notes are checked the same way.
  var typoList = [];
  function typedUnit(u) { return !u || u === 'AU' || u === 'ratio' || u === 'count' ? '' : (u === '%' || u === '°' ? u : ' ' + u); }
  function typoFlags(t, c) {
    var s = state[t], ok = s.typoOk || {}, out = [];
    // row: metric key; fields: the boxes to outline; shown: the value as typed; who: 'Left ' / 'LSI ' / ''
    // (per leg the jump line names the load typed, since the change line beside it compares × body weight)
    function add(row, fields, res, shown, unit, token, prevDate, who) {
      if (!res) return;
      var key = row + '|' + fields.join('+');
      if (ok[key] === token) return;
      out.push({ metric: row, fields: fields, key: key, token: token,
        text: res.kind === 'range' ? 'Check: ' + who + shown + typedUnit(unit) + ' is outside the usual range'
          : 'Check: ' + who + (t === 'str' ? shown + typedUnit(unit) + ', ' : '') + E.pySigned(res.pct, 0) + '% vs ' + (prevDate ? shortDate(prevDate, s.meta.date) : 'the previous result') });
    }
    function raw(x) { return String(x == null ? '' : x).trim(); }
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        if (tt.input === 'calc') return;
        var v = s.values[tt.id] || {};
        [['left', 'prevLeft', 'Left '], ['right', 'prevRight', 'Right ']].forEach(function (sd) {
          var cur = E.parseInput(v[sd[0]]);
          if (cur === null) return;
          add(tt.id, [sd[0]], E.typoCheck(cur, tt.range, E.parseInput(v[sd[1]]), tt.jump), raw(v[sd[0]]), tt.input,
            raw(v[sd[0]]) + '~' + raw(v[sd[1]]), v.prevDate, sd[2]);
        });
      });
      return out;
    }
    DATA[t].groups.forEach(function (g) {
      g.metrics.forEach(function (m) {
        var v = s.values[m.name] || {};
        if (m.calc === 'DSI') return;                   // worked out, never typed (its two inputs are checked)
        if (m.calc === 'LSI') {                         // the LSI worked out from left and right
          var row = c.byName[m.name];
          if (row) add(m.name, ['left', 'right'], E.typoCheck(row.result, m.range, E.parseInput(v.previous), m.jump), E.fmt(row.result), '%',
            raw(v.left) + '/' + raw(v.right) + '~' + raw(v.previous), v.prevDate, 'LSI ');
          return;
        }
        var cur = E.parseInput(v.result);
        if (cur === null) return;
        var unit = m.calc === 'PERBW' || m.calc === 'PERKG' ? 'N' : m.unit;   // force is typed in N
        add(m.name, ['result'], E.typoCheck(cur, m.range, E.parseInput(v.previous), m.jump), raw(v.result), unit,
          raw(v.result) + '~' + raw(v.previous), v.prevDate, '');
      });
    });
    return out;
  }
  function showTypo(flags) {
    typoList = flags;
    var byRow = {};
    flags.forEach(function (f) { (byRow[f.metric] = byRow[f.metric] || []).push(f); });
    els.entry.querySelectorAll('.metric').forEach(function (el) {
      var list = byRow[el.dataset.metric] || [], box = el.querySelector('.m-check'), want = {};
      list.forEach(function (f) { f.fields.forEach(function (fd) { want[fd] = true; }); });
      el.querySelectorAll('input[data-field]').forEach(function (inp) {
        var on = !!want[inp.dataset.field];
        inp.classList.toggle('typo', on);
        if (on && box) inp.setAttribute('aria-describedby', box.id); else inp.removeAttribute('aria-describedby');
      });
      if (!box) return;
      var html = list.map(function (f) {
        return '<div class="mc-line"><span class="mc-t">' + statusIcon('Amber') + esc(f.text) + '</span>' +
          '<button type="button" class="quiet mc-ok" data-action="typo-ok" data-key="' + esc(f.key) + '" data-token="' + esc(f.token) + '">Looks right</button></div>';
      }).join('');
      if (box._html !== html) { box.innerHTML = html; box._html = html; }
      box.hidden = !list.length;
    });
  }
  function typoOk(b) {
    var t = state.tool, row = b.closest('.metric');
    (state[t].typoOk || (state[t].typoOk = {}))[b.dataset.key] = b.dataset.token;
    refresh();
    // keep the place without opening the keyboard: the next check in the row, else the metric name
    var next = row && (row.querySelector('.mc-ok') || row.querySelector('.m-namebtn'));
    if (next) { try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); } }
  }
  function checkFlagHtml() {
    var n = typoList.length;
    return n ? '<button type="button" class="quiet check-flag" data-action="goto-check">' + statusIcon('Amber') + n + (n === 1 ? ' value to check' : ' values to check') + '</button>' : '';
  }
  // bring a metric row into view, opening its section first if it is collapsed
  function revealRow(row) {
    var g = row.closest('.group');
    if (g && g.classList.contains('collapsed')) {
      state[state.tool].collapsed[+g.dataset.group] = false;
      g.classList.remove('collapsed');
      g.querySelector('.group-head').setAttribute('aria-expanded', 'true');
      saveDraft();
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function gotoCheck() {
    var box = els.entry.querySelector('.metric:not([hidden]) .m-check:not([hidden])');
    if (!box) return;
    var row = box.closest('.metric');
    revealRow(row);
    var btn = row.querySelector('.mc-ok');
    if (btn) setTimeout(function () { try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); } }, 350);
  }
  // A priority in the summary panel (v11): scroll to its row and flash it. Focus goes to the row itself rather than a
  // box, so the iPad keyboard stays closed; the row is focusable only until it loses focus.
  var flashTimer = null;
  function gotoMetric(key) {
    var row = null;
    els.entry.querySelectorAll('.metric').forEach(function (el) { if (el.dataset.metric === key) row = el; });
    if (!row || row.hidden) return;
    revealRow(row);
    els.entry.querySelectorAll('.metric.flash').forEach(function (el) { el.classList.remove('flash'); });
    void row.offsetWidth;                              // restarts the flash when the same row is tapped again
    row.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { row.classList.remove('flash'); }, 2000);
    if (!row.hasAttribute('tabindex')) {
      row.setAttribute('tabindex', '-1');
      row.addEventListener('blur', function () { row.removeAttribute('tabindex'); }, { once: true });
    }
    setTimeout(function () { try { row.focus({ preventScroll: true }); } catch (e) { row.focus(); } }, 350);
  }

  // ------------------------------------------------------------------ retest the same tests
  // With a returning client's previous results loaded, "Only last time's tests" hides the rows with no previous
  // result (rows that already have a result stay), and groups left empty. The rows shown are worked out when the
  // switch is used or the page is drawn, not on every keystroke, so a row never vanishes while it is being typed in.
  var retest = { tool: null, on: false, keys: null, n: 0, total: 0 };
  function retestActive(t) {
    var s = state[t], h = s.hist;
    return !!(s.onlyPrev && h && h.n && h.key === E.nameKey(s.meta.name));
  }
  function retestKeys(t) {
    var s = state[t], keys = {}, total = 0;
    function has(v, f) { return !blank(v[f]); }
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        total++;
        var v = s.values[tt.id] || {};
        if (tt.input !== 'calc' && (has(v, 'prevLeft') || has(v, 'prevRight') || has(v, 'left') || has(v, 'right'))) keys[tt.id] = 1;
      });
      // the hip ratio comes with the hip tests it is worked out from
      DATA.str.tests.forEach(function (tt) { if (tt.input === 'calc' && (tt.from || []).some(function (f) { return keys[f]; })) keys[tt.id] = 1; });
    } else {
      var val0 = function (n) { return s.values[n] || {}; };
      DATA[t].groups.forEach(function (g) {
        g.metrics.forEach(function (m) {
          total++;
          var v = val0(m.name);
          var now = m.calc === 'LSI' ? has(v, 'left') || has(v, 'right')
            : m.calc === 'DSI' ? has(val0('CMJ Peak Force'), 'result') && has(val0('IMTP Peak Force'), 'result') : has(v, 'result');
          if (has(v, 'previous') || now) keys[m.name] = 1;
        });
      });
    }
    return { keys: keys, n: Object.keys(keys).length, total: total };
  }
  function applyRetest(force) {
    var t = state.tool, on = retestActive(t);
    if (!force && retest.tool === t && retest.on === on) return;
    var k = on ? retestKeys(t) : null;
    retest = { tool: t, on: on, keys: k ? k.keys : null, n: k ? k.n : 0, total: k ? k.total : 0 };
    els.entry.querySelectorAll('.metric').forEach(function (el) { el.hidden = !!(on && !retest.keys[el.dataset.metric]); });
    els.entry.querySelectorAll('.group').forEach(function (g) { g.hidden = on && !g.querySelector('.metric:not([hidden])'); });
  }
  function toggleRetest() {
    var t = state.tool;
    state[t].onlyPrev = !state[t].onlyPrev;
    retest.tool = null;
    refresh();
    if (state[t].onlyPrev) {
      var first = els.entry.querySelector('.group:not(.collapsed):not([hidden]) .metric:not([hidden]) input.m-in');
      if (first) first.focus();
    } else {
      var tb = els.entry.querySelector('[data-action="retest"]');
      if (tb) tb.focus();
    }
  }

  // ------------------------------------------------------------------ keep the screen awake while testing
  // While the athlete on screen has results entered, ask for a screen wake lock on each tap or keystroke, and again
  // when the app comes back to the front. Clear all lets it go. Silent: no UI, and any refusal is ignored.
  var wake = { lock: null, pending: false };
  function hasResults(t) {
    if (t === 'ex') return false;                      // writing up exercises isn't a testing session
    var v = state[t].values;
    return Object.keys(v).some(function (k) { return v[k] && (!blank(v[k].result) || !blank(v[k].left) || !blank(v[k].right)); });
  }
  function releaseWake() {
    var lock = wake.lock;
    wake.lock = null;
    if (!lock) return;
    try { var p = lock.release(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* already released */ }
  }
  function keepAwake() {
    try {
      var wl = navigator.wakeLock;
      if (!wl || typeof wl.request !== 'function' || !state) return;
      if (!hasResults(state.tool)) { releaseWake(); return; }
      if (wake.lock || wake.pending || document.visibilityState === 'hidden') return;
      wake.pending = true;
      Promise.resolve(wl.request('screen')).then(function (lock) {
        wake.pending = false;
        if (!lock) return;
        if (!hasResults(state.tool)) { wake.lock = lock; releaseWake(); return; }
        wake.lock = lock;
        if (lock.addEventListener) lock.addEventListener('release', function () { if (wake.lock === lock) wake.lock = null; });
      }, function () { wake.pending = false; });
    } catch (e) { wake.pending = false; }
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

  // ------------------------------------------------------------------ for the coach
  // Training status (Full training / Modified / Rehab only; tapping the chosen one again clears it), an optional line
  // of modifications and the next retest date. Printed as a band at the top of the report when any of them is set.
  // Kept with the session in the client's record, but never filled in from records and never sent to Claude.
  function coachCardHtml() {
    var co = state[state.tool].coach;
    return '<section class="card coach" id="coachCard" aria-labelledby="coachTitle">' +
      '<div class="card-head"><h2 id="coachTitle">' + (state.tool === 'screen' ? 'For the coach' : 'Training status') + '</h2></div>' +
      '<p class="coach-help">Optional: your call, printed as a band at the top of the report.</p>' +
      '<div class="coach-fields"><div class="f coach-status"><span id="coachStatusL">' + (state.tool === 'screen' ? 'Training status' : 'Status') + '</span>' +
      '<div class="seg coach-seg" role="group" aria-labelledby="coachStatusL">' + COACH_STATUS.map(function (o) {
        return '<button type="button" data-coach-status="' + esc(o) + '" data-look="' + COACH_LOOK[o] + '" aria-pressed="' + (co.status === o) + '">' + esc(o) + '</button>';
      }).join('') + '</div></div>' +
      '<label class="f coach-retest" for="coachRetest"><span>Next retest</span><input id="coachRetest" data-coach="retest" type="date" value="' + esc(co.retest) + '"></label>' +
      '<label class="f coach-mods" for="coachMods"><span>Modifications</span><input id="coachMods" data-coach="mods" type="text" maxlength="120" value="' + esc(co.mods) +
      '" placeholder="Optional, e.g. no max-velocity sprinting" autocapitalize="sentences" autocomplete="off" enterkeyhint="done"></label></div></section>';
  }
  function coachSet(co) { return !!(co && (co.status || !blank(co.mods) || co.retest)); }
  function coachData(t) {                             // what the report prints (the date in the report's style)
    var co = state[t].coach;
    if (!coachSet(co)) return null;
    return { status: co.status, mods: String(co.mods || '').replace(/\s+/g, ' ').trim(), retest: co.retest ? E.displayIso(co.retest) : '' };
  }
  function setCoachStatus(b) {
    var co = state[state.tool].coach, v = b.dataset.coachStatus;
    co.status = co.status === v ? '' : v;
    b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(co.status === x.dataset.coachStatus)); });
    saveDraft();
  }

  // ------------------------------------------------------------------ ACL return-to-sport criteria
  // The clinic's own checklist ("rts" in acl_norms.json), kept apart from the phase norms: each criterion is met,
  // not yet or not tested, with "X of Y met" on the card, in the summary panel, on the report and in the AI payload.
  // Decision support only: the app compares the numbers with the clinic's thresholds; the clinician decides.
  var RTS_CHIP = { met: 'Green', not: 'Red', untested: 'n/a' };
  function aclMonths() {                              // the months the report prints: typed, or from the two dates
    var m = state.acl.meta;
    if (!blank(m.months)) return E.parseInput(m.months);
    var d = daysBetween(m.dos, m.date);
    return d !== null && d >= 0 ? Math.floor(d / 30.4375) : null;
  }
  function rtsData(c) {
    var R = DATA.acl && DATA.acl.rts;
    if (!R || !Array.isArray(R.criteria) || !c || !c.groups) return null;
    var results = {}, units = {};
    E.flatten(c.groups).forEach(function (r) { var n = E.num(r.result); if (n !== null) results[r.name] = n; });
    DATA.acl.groups.forEach(function (g) { g.metrics.forEach(function (m) { units[m.name] = m.unit || ''; }); });
    var out = E.rtsCheck(R, results, { months: aclMonths() }, units);
    return out.total ? out : null;
  }
  function rtsCardHtml() {
    var R = DATA.acl && DATA.acl.rts;
    if (!R || !Array.isArray(R.criteria) || !R.criteria.length) return '';
    return '<section class="card rts" id="rtsCard" tabindex="-1" aria-labelledby="rtsTitle">' +
      '<div class="card-head"><h2 id="rtsTitle">' + esc(R.title || 'Return-to-sport criteria') + '</h2><span class="rts-count" id="rtsCount"></span></div>' +
      '<ul class="rts-list" id="rtsList"></ul>' + (R.note ? '<p class="fine rts-note">' + esc(R.note) + '</p>' : '') + '</section>';
  }
  function refreshRts(c) {
    var list = $('rtsList'), card = $('rtsCard');
    if (!list) return;
    var r = rtsData(c);
    card.hidden = !r;
    if (!r) return;
    $('rtsCount').textContent = E.rtsSummary(r);
    var html = r.rows.map(function (row) {
      return '<li class="rts-row" data-status="' + row.status + '"><div class="rts-l"><b>' + esc(row.label) + '</b><span class="rts-t">needs ' + esc(row.target) +
        (row.fallback ? ' · from ' + esc(row.metric) : '') + '</span></div><span class="rts-v">' + esc(row.text) + '</span>' + chip(RTS_CHIP[row.status], E.RTS_WORDS[row.status]) + '</li>';
    }).join('');
    if (list._html !== html) { list.innerHTML = html; list._html = html; }
  }
  function rtsSumHtml(c) {                            // in the summary panel: a small ring (green = met) and the count (taps through to the card)
    var r = rtsData(c);
    return r ? '<button type="button" class="quiet rts-sum" data-action="goto-rts"><span class="rts-ring">' + ringSvg(44, 6, [['g', r.met]], r.total) + '</span>' +
      '<span class="rts-sum-x"><span class="rts-sum-t">' + esc(r.title) + '</span><b>' + esc(E.rtsSummary(r)) + '</b></span></button>' : '';
  }
  function gotoRts() {
    var card = $('rtsCard');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); } }, 350);
  }
  function rtsLine(r) {                               // the AI payload's line (no dates, no names)
    var not = r.rows.filter(function (x) { return x.status === 'not'; }).map(function (x) { return x.label + ' ' + x.text + ' (needs ' + x.target + ')'; });
    var un = r.rows.filter(function (x) { return x.status === 'untested'; }).map(function (x) { return x.label; });
    return 'Return-to-sport criteria (set by the clinic; decision support only, the return-to-sport decision rests with the clinician): ' +
      r.met + ' of ' + r.total + ' met' + (not.length ? '; not yet: ' + not.join(', ') : '') + (un.length ? '; not tested: ' + un.join(', ') : '') + '.';
  }

  // ------------------------------------------------------------------ trend sparklines
  // With the client's record loaded, a metric tested today and in at least two earlier sessions (of the last five, as
  // on the report's Progress table) gets a tiny line beside its "prev" note: missing values skipped, the available
  // points joined, the last point coloured like the change since the first.
  function trends(t, c) {
    var s = state[t], h = s.hist, key = E.nameKey(s.meta.name);
    var cl = h && h.key === key ? clients.clients[key] : null, out = {};
    if (!cl) return out;
    E.progress(cl.sessions, t, { date: s.meta.date || todayIso(), results: currentResults(t, c) }, 5).rows.forEach(function (r) {
      var v = r.values;
      if (v[v.length - 1] === null) return;                                     // not tested today
      if (v.slice(0, -1).filter(function (x) { return x !== null; }).length >= 2) out[r.metric] = r;
    });
    return out;
  }
  function sparkSvg(r, dir, who) {
    var n = r.values.length, pts = [];
    r.values.forEach(function (v, i) { if (v !== null) pts.push([i, v]); });
    var ys = pts.map(function (q) { return q[1]; }), lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    var W = 46, H = 16, padX = 3.5, padY = 3.5;
    var xy = pts.map(function (q) { return [padX + (W - 2 * padX) * q[0] / (n - 1), hi === lo ? H / 2 : padY + (H - 2 * padY) * (hi - q[1]) / (hi - lo)]; });
    var d = r.last - r.first, good = dir === 'Higher' ? d > 0 : (dir === 'Lower' ? d < 0 : null);
    var f = function (v) { return String(Math.round(v * 10) / 10); }, e = xy[xy.length - 1];
    return '<svg class="spark ' + (d === 0 || good === null ? 'same' : (good ? 'gain' : 'drop')) + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="' + esc((who ? who + 'trend' : 'Trend') + ' over ' + pts.length + ' tests: ' + ys.map(E.fmt).join(', ')) + '">' +
      '<polyline points="' + xy.map(function (q) { return f(q[0]) + ',' + f(q[1]); }).join(' ') + '"/>' +
      xy.slice(0, -1).map(function (q) { return '<circle cx="' + f(q[0]) + '" cy="' + f(q[1]) + '" r="1.4"/>'; }).join('') +
      '<circle class="sp-last" cx="' + f(e[0]) + '" cy="' + f(e[1]) + '" r="2.7"/></svg>';
  }
  function setSpark(el, html) {
    var sk = el.querySelector('.m-spark');
    if (sk && sk._h !== html) { sk.innerHTML = html; sk._h = html; }
  }

  // ------------------------------------------------------------------ rendering: summary + dock
  var TALLY = { screen: E.TALLY_WORDS.target, rehab: E.TALLY_WORDS.rehab };
  function blocker(c) {
    if (state.tool === 'str') {
      if (c.rows.length) return '';
      return c.tests.length ? 'Add body mass (kg) to score these results.' : 'Enter at least one result to create the report.';
    }
    if (state.tool === 'screen' && !c.pop.population) return 'Choose Male or Female (or a sport population) to score the results.';
    if (!c.groups.length) return state.tool === 'screen' ? 'Enter at least one result to create the report.' : 'Enter at least one result to create the rehab report.';
    return '';
  }
  // one priority (v11): the name with its status on the right and the value and target underneath; the whole row is a
  // button that scrolls to the metric and flashes it
  function prioItem(key, name, status, detail) {
    return '<li><button type="button" class="prio-go" data-action="goto-metric" data-goto="' + esc(key) + '"><span class="pn">' + esc(name) + '</span>' +
      chip(status) + '<span class="pd">' + esc(detail) + '</span></button></li>';
  }
  var TALLY_KEYS = [['g', 'Green', 0], ['a', 'Amber', 1], ['r', 'Red', 2]];
  // a ring (v11): a grey track and one arc per [class, count], sized by the counts and drawn clockwise from 12 o'clock with
  // stroke-dasharray / stroke-dashoffset (butt ends, so neighbouring arcs meet cleanly)
  function ringSvg(size, width, parts, total) {
    var c = size / 2, r = (size - width) / 2, C = 2 * Math.PI * r, off = 0, fx = function (v) { return v.toFixed(2); };
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false"><g transform="rotate(-90 ' + c + ' ' + c + ')">' +
      '<circle class="ring-track" cx="' + c + '" cy="' + c + '" r="' + r + '" stroke-width="' + width + '"/>' +
      parts.map(function (p) {
        var len = total ? C * p[1] / total : 0, arc = '<circle class="ring-arc ' + p[0] + '" cx="' + c + '" cy="' + c + '" r="' + r + '" stroke-width="' + width +
          '" style="stroke-dasharray:' + fx(len) + 'px ' + fx(C) + 'px;stroke-dashoffset:' + fx(-off) + 'px"/>';
        off += len;
        return arc;
      }).join('') + '</g></svg>';
  }
  // the panel is redrawn as results change: each arc eases (250 ms) from where it was, unless reduced motion is asked for
  var ringWas = {};
  function animateRings(t) {
    var arcs = els.summary.querySelectorAll('.ring-arc'), now = [], was = ringWas[t];
    Array.prototype.forEach.call(arcs, function (a) { now.push([a.style.strokeDasharray, a.style.strokeDashoffset]); });
    ringWas[t] = now;
    if (!was || was.length !== now.length || reducedMotion()) return;
    Array.prototype.forEach.call(arcs, function (a, i) {
      if ((was[i][0] === now[i][0] && was[i][1] === now[i][1]) || !a.animate) return;
      try {
        a.animate([{ strokeDasharray: was[i][0], strokeDashoffset: was[i][1] }, { strokeDasharray: now[i][0], strokeDashoffset: now[i][1] }], { duration: 250, easing: 'ease-out' });
      } catch (e) { /* drawn without the movement */ }
    });
  }
  function renderSummary(c) {
    var t = state.tool, labels = (t === 'screen' || t === 'str') ? TALLY.screen : TALLY.rehab;
    // the same heading on every report tab (v11); the line under it says what the results are compared against
    var against = t === 'screen' ? (c.pop.label ? 'Compared against <b>' + esc(c.pop.label) + '</b>' : 'Choose sex to pick the norms')
      : t === 'str' ? 'Each leg against <b>BASE Health strength targets</b>'
        : 'Compared against <b>' + esc(state[t].phase) + (t === 'acl' ? ' · ' + esc(state.acl.sex) : '') + ' targets</b>';
    var head = '<h2>Summary</h2><p class="against">' + against + '</p>';
    // the headline ring (v11) with the counts beside it (the tiles' markup as a legend): a count takes its status colour
    // only when it is above 0 ('on')
    var tally = '<div class="tally ring-legend">' + TALLY_KEYS.map(function (x) {
      var n = c.counts[x[1]];
      return '<div class="' + x[0] + (n ? ' on' : '') + '"><b>' + n + '</b><span>' + statusIcon(x[1]) + esc(labels[x[2]]) + '</span></div>';
    }).join('') + '</div>';
    var g = c.counts.Green, total = c.counts.Green + c.counts.Amber + c.counts.Red;
    tally = '<div class="headline"><div class="ring-wrap"><div class="ring" role="img" aria-label="' + (total ? g + ' of ' + total + ' on target' : 'Nothing tested yet') + '">' +
      ringSvg(96, 10, [['g', g], ['a', c.counts.Amber], ['r', c.counts.Red]], total) +
      '<div class="ring-c" aria-hidden="true"><b>' + (total ? g : '–') + '</b>' + (total ? '<small>of ' + total + '</small>' : '') + '</div></div>' +
      '<div class="ring-cap" aria-hidden="true">on target</div></div>' + tally + '</div>';
    var list;
    if (t === 'str') {
      if (!c.rows.length) {
        list = '<p class="empty">Each leg is scored as you type.</p>' +
          '<button type="button" class="quiet demo" data-action="demo">Fill in example results</button>';
      } else if (!c.prios.length) {
        list = '<p class="ok">Nothing below target — every tested result is on target.</p>';
      } else {
        list = '<ol class="prio">' + c.prios.slice(0, 6).map(function (r) {
          return prioItem(r.id, r.name, r.status, r.text + ' · target ' + r.target);
        }).join('') + '</ol>' + (c.prios.length > 6 ? '<p class="fine">+ ' + (c.prios.length - 6) + ' more in the report</p>' : '');
      }
    } else if (!c.groups.length) {
      list = '<p class="empty">Results are scored as you type.</p>' +
        '<button type="button" class="quiet demo" data-action="demo">Fill in example results</button>';
    } else if (!c.prios.length) {
      list = '<p class="ok">Nothing flagged — every tested metric is on target.</p>';
    } else {
      list = '<ol class="prio">' + c.prios.map(function (r) {
        return prioItem(r.name, r.name, r.status, E.fmt(r.result) + ' ' + r.unit + (r.side ? ' (' + r.side + ' higher)' : '') + ' · target ' + r.target);
      }).join('') + '</ol>';
    }
    var html = '<div class="sum"><div class="sum-scroll">' + head + tally + (t === 'acl' ? rtsSumHtml(c) : '') + '<h3>Top priorities <small>worst first</small></h3>' + list;
    if (t === 'screen' && c.radarOptions.length) {
      var full = c.radarPicked.length >= 6;
      html += '<h3>Profile chart <small>pick 3–6 for page 1</small></h3><div class="picks">' + c.radarOptions.map(function (o) {
        var on = c.radarPicked.indexOf(o[0]) >= 0;
        return '<button type="button" data-radar="' + esc(o[0]) + '" aria-pressed="' + on + '"' + (!on && full ? ' disabled' : '') + '>' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
      html += '<p class="fine picks-note">' + (c.radarPicked.length < 3 ? 'Pick at least 3 for a profile on the report.'
        : c.radarPicked.length <= 4 ? 'Bars on the report; pick 5 or 6 for a radar.' : 'A radar on the report; pick 3 or 4 for bars.') + '</p>';
    }
    var why = blocker(c);
    html += '</div><div class="sum-foot">' + checkFlagHtml() + interpFlagHtml(t, c) + '<button type="button" class="primary make" data-action="report"' + (why ? ' disabled' : '') + '>Create report</button>' +
      '<p class="fine">' + esc(why || 'Preview, then share or save.') + '</p>' +
      '<p class="fine client-line">' + esc(clientLine(t)) + '</p></div></div>';
    els.summary.innerHTML = html;
    animateRings(t);
    var nCheck = typoList.length;
    els.dock.innerHTML = '<div class="dt">' + TALLY_KEYS.map(function (x) {
      var n = c.counts[x[1]];
      return '<a href="#summary" class="' + x[0] + (n ? ' on' : '') + '" aria-label="' + esc(labels[x[2]] + ': ' + n) + '">' + statusIcon(x[1]) + n + '</a>';
    }).join('') + '</div>' +
      (nCheck ? '<button type="button" class="dock-check" data-action="goto-check">' + statusIcon('Amber') + nCheck + (nCheck === 1 ? ' value to check' : ' values to check') + '</button>' : '') +
      '<button type="button" class="primary" data-action="report"' + (why ? ' disabled' : '') + '>Create report</button>';
    els.dock.classList.toggle('has-check', nCheck > 0);   // on a phone the check takes the tally's place (the tally stays in the summary)
  }

  // ------------------------------------------------------------------ input handling
  function onInput(e) {
    var el = e.target, t = state.tool;
    if (t === 'ex') { onExInput(el); return; }
    if (el.id === 'interpText') { onInterpInput(el); return; }
    if (el.dataset.coach) { state[t].coach[el.dataset.coach] = el.value; saveDraft(); keepAwake(); return; }
    unmarkScanned(el);
    if (el.dataset.meta) {
      state[t].meta[el.dataset.meta] = el.value;
      refresh();
      if (el.dataset.meta === 'name') suggestClients(t, el.value);
    } else if (el.dataset.field) {
      var row = el.closest('.metric'), v = val(t, row.dataset.metric);
      v[el.dataset.field] = el.value;
      if (el.dataset.field === 'previous') v.prevDate = '';     // typed by hand now, no longer the saved record's value
      refresh();
      if (!blank(el.value)) foldNow(t, true);          // results arriving: the details card folds into the strip (v11)
    }
    keepAwake();
  }
  function onChange(e) {
    var el = e.target, t = state.tool;
    if (el.dataset.choice === 'pop') { state.screen.pop = el.value; refresh(); }
    else if (el.dataset.choice === 'phase') { state[t].phase = el.value; refresh(); }
    else if (el.id === 'valdFiles') importVald(el.files);
    else if (el.id === 'scanFiles') { var picked = Array.prototype.slice.call(el.files || []); el.value = ''; startScan(picked); }
    else if (el.dataset.coach) { state[t].coach[el.dataset.coach] = el.value; saveDraft(); }
    keepAwake();
  }
  function onClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    onButton(b);
    keepAwake();
  }
  function onButton(b) {
    var t = state.tool;
    if (b.id === 'toolPick') { if (pickOpen()) closePick(true); else openPick(false); return; }   // v14
    if (b.dataset.pick) { pickTool(b.dataset.pick); return; }
    if (b.dataset.action === 'edit-athlete') { openCard(); return; }
    if (b.dataset.action === 'done-athlete') { closeCard(); return; }
    if (b.dataset.action === 'choose-client') { openClientsDialog('pick'); return; }
    if (b.dataset.action === 'tests-today') { openTestsDialog(); return; }
    if (t === 'ex' && exButton(b)) return;
    if (b.dataset.action === 'explain') {
      var box = document.getElementById(b.getAttribute('aria-controls')), open = b.getAttribute('aria-expanded') !== 'true';
      var mk = t + '|' + b.closest('.metric').dataset.metric;
      b.setAttribute('aria-expanded', String(open));
      if (box) box.hidden = !open;
      if (open) explainOpen[mk] = 1; else delete explainOpen[mk];
      return;
    }
    if (b.dataset.action === 'prev-edit') {
      var prow = b.closest('.metric'), pv = val(t, prow.dataset.metric);
      pv.prevEdit = true;
      b.closest('.m-prevtext').outerHTML = metricInput(prow.id, esc(prow.dataset.metric), pv, 'previous', 'm-prev', 'Prev.', 'previous result');
      var pin = document.getElementById(prow.id + '-previous');
      if (pin) { pin.focus(); try { pin.select(); } catch (e) { /* not selectable */ } }
      refresh();
      return;
    }
    if (b.dataset.coachStatus) { setCoachStatus(b); return; }
    if (b.dataset.action === 'goto-rts') { gotoRts(); return; }
    if (b.dataset.action === 'typo-ok') { typoOk(b); return; }
    if (b.dataset.action === 'goto-check') { gotoCheck(); return; }
    if (b.dataset.action === 'goto-metric') { gotoMetric(b.dataset.goto); return; }
    if (b.dataset.action === 'retest') { toggleRetest(); return; }
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
      unmarkScanned(b.parentNode);
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
    } else if (b.dataset.client !== undefined && b.closest('.suggest')) {
      pickClient(b.dataset.client);
    } else if (b.dataset.action === 'load-history' || b.dataset.action === 'reload-history') {
      loadHistory(t, b.dataset.client || E.nameKey(state[t].meta.name));
    } else if (b.dataset.action === 'scan-undo') {
      undoScan();
    } else if (b.dataset.action === 'scan-close') {
      scanInfo = null; renderScanBar();
    } else if (b.dataset.action === 'ai-draft') {
      draftInterp();
    } else if (b.dataset.action === 'ai-settings') {
      openAiSettings(null);
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
    if (e.key !== 'Enter' || !e.target.matches('input, textarea.ex-wrap')) return;
    e.preventDefault();
    var live = '.group:not(.collapsed):not([hidden]) .metric:not([hidden]) ';          // skips rows the retest filter hides
    var stops = state.tool === 'ex'
      // Exercises: patient details, title, general instructions, then each row's boxes in order (hidden details skipped)
      ? Array.prototype.filter.call(els.entry.querySelectorAll('.athlete input:not([type=file]):not([type=date]), #ex-title, #ex-instructions, .ex-row input, .ex-row textarea'),
        function (x) { return x.getClientRects().length > 0; })
      : els.entry.querySelectorAll('.athlete input:not([type=file]):not([type=date]), ' + live + 'input.m-result, ' + live + 'input.m-in');
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
        if (Object.keys(r.results).length && state.tool === 'screen') foldBeforeRender('screen');
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
      Object.assign(s.meta, { name: 'Example Patient', injured: 'Left', sport: 'Soccer', notes: 'Example data — not a real patient' });
      var hx = { 'AKET deficit vs uninjured': ['4', '9'], 'SLR % of uninjured side': ['96', '88'], 'HHD 90° knee-flex % of uninjured': ['91', '80'],
        'Nordic peak force — injured': ['290', '245'], 'Nordic peak-force imbalance': ['22', '41'], '10 m sprint time': ['1.86', '1.95'], 'HaOS score': ['84', '70'] };
      Object.keys(hx).forEach(function (k) { var v = val('ham', k); v.result = hx[k][0]; v.previous = hx[k][1]; });
    } else if (t === 'str') {
      Object.assign(s.meta, { name: 'Example Patient', mass: '80', sport: 'AFL', notes: 'Example data \u2014 not a real patient' });
      var sx = { split_squat: ['28', '25'], sl_seated_calf_vald: ['1650', '1540'], sl_seated_calf_smith: ['125', '118'],
        sl_knee_extension: ['820', '700'], sl_bridge: ['17', '16'], sl_calf_raise_reps: ['27', '22'],
        prone_hamstring_curl: ['420', '385'], hip_abduction: ['350', '372'], hip_adduction: ['395', '380'] };
      Object.keys(sx).forEach(function (k) { var v = val('str', k); v.left = sx[k][0]; v.right = sx[k][1]; });
    } else {
      Object.assign(s.meta, { name: 'Example Patient', injured: 'Right', graft: 'Hamstring', sport: 'Netball', notes: 'Example data — not a real patient' });
      var ax = { 'IKDC': ['78', '70'], 'ACL-RSI': ['61', '52'], 'KOOS — Sport & Rec': ['75', '65'], 'Knee extension LSI': ['84', '76'],
        'CMJ — Jump height': ['27.5', '25.9'], 'Single hop LSI': ['88', ''] };
      Object.keys(ax).forEach(function (k) { var v = val('acl', k); v.result = ax[k][0]; v.previous = ax[k][1]; });
      var q = val('acl', 'Quadriceps LSI'); q.left = '248'; q.right = '205';
    }
    foldBeforeRender(t);
    render();
    toast('Example results filled in — Clear all data in the ⋯ menu clears them');
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
    var n = (state[state.tool].meta.name || person(state.tool)).trim() || person(state.tool);
    return n.replace(/[\\/:*?"<>|]+/g, '-').replace(/ /g, '_') + suffix;
  }
  function buildReport() {
    var t = state.tool, c = compute(), m = state[t].meta;
    if (blocker(c)) return null;
    var it = state[t].interp, interp = blank(it.text) ? null : { text: String(it.text).trim(), ai: !!it.ai };
    var progress = progressData(t, c);
    // each priority carries its plain-English explainer (printed under it in smaller text)
    function explained(list, keyOf) {
      return list.map(function (r) { var x = explainer(keyOf(r)); return Object.assign({}, r, { what: x ? String(x.what).trim() : '' }); });
    }
    if (t === 'str') {
      return {
        file: fileName('_strength.pdf'),
        rep: window.BHReport.strength({
          meta: { name: m.name, date: E.displayIso(m.date), mass: m.mass, sport: m.sport, tester: m.tester, notes: m.notes },
          tests: c.tests, counts: c.counts, prios: explained(c.prios, function (r) { return r.id; }), amberPct: DATA.str.amber_pct, interp: interp, progress: progress,
          coach: coachData(t)
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
          popLabel: c.pop.label, groups: c.groups, counts: c.counts, prios: explained(c.prios, function (r) { return r.name; }),
          radarKeys: c.radarPicked.map(function (k) { return [k, labels[k]]; }), interp: interp, progress: progress, coach: coachData(t)
        })
      };
    }
    var auto = function (fromIso, div) { var d = daysBetween(fromIso, m.date); return d !== null && d >= 0 ? String(Math.floor(d / div)) : ''; };
    if (t === 'ham') {
      return {
        file: fileName('_hamstring.pdf'),
        rep: window.BHReport.rehab({
          kind: 'ham', phase: state.ham.phase, groups: c.groups, counts: c.counts, disclaimer: DATA.ham.disclaimer || '', interp: interp, progress: progress, coach: coachData(t),
          meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, clinician: m.clinician, weeks: blank(m.weeks) ? auto(m.doi, 7) : m.weeks, sport: m.sport, notes: m.notes }
        })
      };
    }
    return {
      file: fileName('_acl.pdf'),
      rep: window.BHReport.rehab({
        kind: 'acl', phase: state.acl.phase, sex: state.acl.sex, groups: c.groups, counts: c.counts, disclaimer: DATA.acl.disclaimer || '', interp: interp, progress: progress,
        coach: coachData(t), rts: rtsData(c),
        meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, graft: m.graft, surgeon: m.surgeon, months: blank(m.months) ? auto(m.dos, 30.4375) : m.months, sport: m.sport, notes: m.notes }
      })
    };
  }
  function canShare(file) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }
  function openReport() {
    var ex = state.tool === 'ex';
    var built = ex ? buildHandout() : buildReport();
    if (!built) return;
    // the exercise handout is never saved to the client's record
    var saved = ex ? null : saveSession(state.tool, compute());
    if (saved) {
      if (!saved.ok) toast('The session couldn’t be saved to the client record (storage is full or blocked).');
      else toast(saved.replaced ? 'Updated ' + saved.name + '’s record for this date' : 'Saved to ' + saved.name + '’s record (' + saved.count + (saved.count === 1 ? ' session)' : ' sessions)'));
      refresh();
    }
    els.back.textContent = '‹ ' + (ex ? 'Back to the program' : 'Back to results');
    current = { file: null, blob: null, title: built.rep.title };
    els.sheetTitle.innerHTML = esc(built.rep.title) + '<small>' + esc(built.file) + '</small>';
    els.pages.innerHTML = '<p class="sheet-msg">Building the report…</p>';
    els.share.disabled = true; els.save.disabled = true;
    els.sheet.hidden = false;
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
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function savePdf() {
    if (!current.blob) return;
    downloadBlob(current.blob, current.file.name);
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
    if (TOOLS.indexOf(tool) >= 0) state.screenTool = tool;   // v14: where the Screening tab comes back to
    render();
    window.scrollTo(0, 0);
  }
  // the Screening tab (v14): from Exercises it returns to the screening tool last in use; a second tap, already in
  // Screening, opens the tool picker so the other tools are one tap away
  function onSectionTab(section) {
    if (section === 'ex') { closePick(false); switchTool('ex'); return; }
    if (state.tool === 'ex') { switchTool(state.screenTool); return; }
    window.scrollTo(0, 0);
    openPick(false);
  }
  // the tool picker's menu (v14): the same manners as the ⋯ menu
  function pickBtn() { return $('toolPick'); }
  function pickMenu() { return $('toolMenu'); }
  function pickOpen() { var m = pickMenu(); return !!m && !m.hidden; }
  function pickItems() { var m = pickMenu(); return m ? Array.prototype.slice.call(m.querySelectorAll('[role="menuitemradio"]')) : []; }
  function openPick(last) {
    var m = pickMenu(), b = pickBtn();
    if (!m || !b) return;
    closeMenu(false);
    m.hidden = false;
    b.setAttribute('aria-expanded', 'true');
    var items = pickItems(), on = items.filter(function (x) { return x.getAttribute('aria-checked') === 'true'; })[0];
    focusQuiet(last ? items[items.length - 1] : (on || items[0]));
  }
  function closePick(focusButton) {
    var m = pickMenu(), b = pickBtn();
    if (!m || m.hidden) return;
    m.hidden = true;
    if (b) b.setAttribute('aria-expanded', 'false');
    if (focusButton) focusQuiet(b);
  }
  function onPickKey(e) {
    var items = pickItems(), n = items.length, i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closePick(true); return; }
    if (e.key === 'Tab') { closePick(false); return; }
    var to = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i < 0 ? n - 1 : (i + n - 1) % n) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to].focus();
  }
  function pickTool(tool) {
    closePick(false);
    if (tool === state.tool) { focusQuiet(pickBtn()); return; }
    switchTool(tool);
    focusQuiet(pickBtn());                             // the new page's heading, for keyboard users (no scroll, no keyboard)
  }
  // the ⋯ menu (v11): Clear all data…, Back up records…, Restore records…, AI settings…. Arrow keys move between the items;
  // a tap outside, Escape or choosing an item closes it. Items that open a pop-up hand focus back to ⋯ when it closes.
  function menuOpen() { return !els.moreMenu.hidden; }
  function menuItems() { return Array.prototype.slice.call(els.moreMenu.querySelectorAll('[role="menuitem"]')); }
  function openMenu(last) {
    closePick(false);
    els.moreMenu.hidden = false;
    els.moreBtn.setAttribute('aria-expanded', 'true');
    var items = menuItems();
    focusQuiet(last ? items[items.length - 1] : items[0]);
  }
  function closeMenu(focusButton) {
    if (!menuOpen()) return;
    els.moreMenu.hidden = true;
    els.moreBtn.setAttribute('aria-expanded', 'false');
    if (focusButton) focusQuiet(els.moreBtn);
  }
  function onMenuKey(e) {
    var items = menuItems(), n = items.length, i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
    if (e.key === 'Tab') { closeMenu(false); return; }
    var to = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i < 0 ? n - 1 : (i + n - 1) % n) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to].focus();
  }
  function menuAction(run) { return function () { closeMenu(true); run(); }; }
  // ------------------------------------------------------------------ clear all data
  // One button wipes every section (names, results, notes, tester details), the saved draft and
  // the last report built, after a check that lists what will go.
  function toolContent(t) {
    if (t === 'ex') {                                  // Exercises: the exercises count; any other text is a detail
      var x = state.ex, xc = exCounts();
      var more = xc.sections > 0 || !blank(x.meta.name) || !blank(x.meta.practitioner) || !blank(x.title) || !blank(x.instructions);
      return { results: xc.exercises, any: xc.exercises > 0 || more, name: String(x.meta.name || '').trim(), unit: ['exercise', 'exercises'] };
    }
    var s = state[t], n = 0, details = false;
    Object.keys(s.values || {}).forEach(function (k) {
      var v = s.values[k] || {};
      if (['result', 'previous', 'side', 'left', 'right'].some(function (f) { return !blank(v[f]); })) n++;
    });
    Object.keys(s.meta).forEach(function (k) { if (k !== 'date' && !blank(s.meta[k])) details = true; });
    if (s.interp && !blank(s.interp.text)) details = true;
    if (coachSet(s.coach)) details = true;
    return { results: n, any: n > 0 || details || !!s.importLog, name: String(s.meta.name || '').trim() };
  }
  function setBackgroundInert(on) {
    ['.appbar', '.workspace', '#dock', '#signin', '#cloudBar'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }
  // one pop-up at a time: focus stays inside it, Escape or a tap outside closes it
  var openModalEl = null, modalReturn = null, modalAfter = null;
  function modalFocusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll('button, input, textarea, select, a[href]'), function (x) {
      return !x.disabled && !x.hidden && x.getClientRects().length > 0;
    });
  }
  // after (v11): called once the pop-up has closed, with whether focus goes back; returning true means it placed focus itself
  function openModal(el, focusEl, after) {
    if (openModalEl) closeModal(false);
    modalReturn = document.activeElement;
    modalAfter = after || null;
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
    var after = modalAfter;
    modalAfter = null;
    openModalEl.hidden = true;
    openModalEl = null;
    setBackgroundInert(false);
    document.documentElement.style.overflow = '';
    if (after && after(restoreFocus !== false)) return;
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
    els.clearList.innerHTML = TOOLS.concat(['ex']).map(function (t) {
      var c = toolContent(t), u = c.unit || ['result', 'results'];
      if (c.any) any = true;
      var d = !c.any ? 'nothing entered'
        : (c.name || 'no name') + ' · ' + (c.results ? c.results + ' ' + (c.results === 1 ? u[0] : u[1]) : 'details only');
      return '<li' + (c.any ? ' class="has-data"' : '') + '><span class="cl-t">' + TOOL_NAMES[t] + '</span><span class="cl-d">' + esc(d) + '</span></li>';
    }).join('');
    if (!any) { toast('Nothing to clear — every section is already empty'); return; }
    openModal(els.clearDialog, els.clearCancel);
  }
  function clearAllData() {
    TOOLS.forEach(function (t) { state[t] = freshTool(t); });
    state.ex = freshEx();
    tidyState();
    cardPin = {};                                      // every details card open again (v11); Tests today is kept
    // an AI draft still on its way belongs to the athlete just cleared: drop it when it arrives
    aiGen++;
    aiBusy = null; interpMsg = { tool: null, kind: '', text: '' }; interpUndo = null;
    scanBusy = null; scanInfo = null; scanGen++;
    releaseWake();                                     // nothing entered now: the screen may sleep again
    // drop the last report built (it holds the athlete's details) and its preview
    current = { file: null, blob: null, title: '' };
    els.pages.innerHTML = '';
    els.sheetTitle.textContent = 'Report';
    // overwrite the saved draft straight away, so closing the app now can't bring the old data back
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE, draftJson()); } catch (e) { /* storage unavailable */ }
    closeModal(false);
    render();
    window.scrollTo(0, 0);
    els.moreBtn.focus();                               // Clear all data is in the ⋯ menu (v11), which has closed
    toast('All data cleared — ready for the next client');
  }

  // ------------------------------------------------------------------ AI interpretation
  // A short plain-English summary for the athlete and coach, drafted by Claude on request and
  // always editable. Claude is called straight from the device with the clinic's own API key.
  // What is sent: the results, targets and statuses plus basic context (age, sex, mass, sport,
  // rehab phase, time since injury). Never the athlete's name, notes, tester/clinician/surgeon or dates.
  var AI_KEY_STORE = 'bh-athlete-report-ai-key';
  var SPARKLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M10 2.5l1.8 5.2 5.2 1.8-5.2 1.8L10 16.5l-1.8-5.2L3 9.5l5.2-1.8zM18.5 13l.95 2.55 2.55.95-2.55.95-.95 2.55-.95-2.55L15 16.5l2.55-.95z"/></svg>';
  var aiBusy = null, aiGen = 0, aiThen = null;
  var interpMsg = { tool: null, kind: '', text: '' };
  var interpUndo = null;

  function aiKey() { try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) { return ''; } }
  function hashStr(s) {                              // FNV-1a, to notice when results change after drafting
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  // the AI reads the same status words as the chips (defined in the status key at the top of the payload)
  function STATUS_WORD(status, t) { return status === 'n/a' ? 'no target available' : E.statusWord(status, wordKind(t)); }
  var CHANGE_WORDS = { gain: 'real improvement', drop: 'real decline', noise: 'within normal test variation, not a real change', shift: 'meaningful change' };
  function changeWords(r) {
    if (!r.change) return '';
    // '▲ real gain   +1.3 (+4%)' -> '+1.3, +4%'
    var delta = String(r.change).replace(/^[^\d+\-−]*/, '').replace(/\s+/g, ' ').trim().replace(/\s*\(([^)]*)\)$/, ', $1');
    return 'vs previous test: ' + (CHANGE_WORDS[r.change_kind] || 'changed') + (delta ? ' (' + delta + ')' : '');
  }
  function rowLine(r, targetWord, t) {
    var v = E.fmt(r.result) + (r.unit ? ' ' + r.unit : '') + (r.side ? ' (' + (r.side === 'L' ? 'left' : 'right') + ' side higher)' : '');
    var scored = r.target && r.target !== 'n/a';
    var parts = [r.name + ': ' + v, scored ? targetWord + ' ' + r.target : 'no ' + targetWord + ' available'];
    if (scored) parts.push(r.status ? STATUS_WORD(r.status, t) : 'not scored');
    var ch = changeWords(r);
    if (ch) parts.push(ch);
    return '- ' + parts.join(' | ');
  }
  function groupLines(groups, targetWord, t) {
    var out = [];
    groups.forEach(function (g) {
      out.push(clean1(g.title));
      g.rows.forEach(function (r) { out.push(rowLine(r, targetWord, t)); });
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
  var READERS_PATIENT = 'Readers: the patient (and their coach or trainer, if they have one). Refer to the person as \u2018the patient\u2019.';
  function interpPayload(t, c) {
    var m = state[t].meta, L = [], rehab = t === 'ham' || t === 'acl';
    var totals = 'Totals: ' + (rehab
      ? c.counts.Green + ' on target, ' + c.counts.Amber + ' close, ' + c.counts.Red + ' behind.'
      : c.counts.Green + ' on target, ' + c.counts.Amber + ' close, ' + c.counts.Red + ' off target.');
    if (t === 'screen') {
      L.push('Readers: the athlete and their coach. Refer to the person as \u2018the athlete\u2019.');
      L.push('Report: athlete performance and readiness screen (VALD force plate and related tests).');
      L.push('Compared against: ' + clean1(c.pop.label) + '.');
      var who = joinBits([clean1(m.sex), blank(m.age) ? '' : clean1(m.age) + ' years', blank(m.mass) ? '' : clean1(m.mass) + ' kg', blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      if (who) L.push('Athlete: ' + who + '.');
      L.push('Status key: On target = meets the target; Close = close to the target; Off target = well short of the target.');
      L.push(totals);
      L.push('Results (metric: result | target | status | change since the previous test, if given):');
      L = L.concat(groupLines(c.groups, 'target', t));
    } else if (t === 'str') {
      var pct = DATA.str.amber_pct == null ? 5 : DATA.str.amber_pct;
      L.push(READERS_PATIENT);
      L.push('Report: lower-limb strength and capacity battery. Each leg is scored against a target relative to body weight (BW). RM = repetition maximum.');
      var who2 = joinBits([blank(m.mass) ? '' : 'body mass ' + clean1(m.mass) + ' kg', blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      if (who2) L.push('Patient: ' + who2 + '.');
      L.push('Status key: On target = at or above target; Close = up to ' + pct + '% below target; Off target = more than ' + pct + '% below target. For the hip ratio the target is a band, and Close is within ' + pct + '% outside it.');
      L.push(totals.replace('Totals:', 'Totals (each leg counted separately):'));
      L.push('Results (test: left leg | right leg | target | difference between legs):');
      c.tests.forEach(function (tt) {
        var sides = ['L', 'R'].map(function (k) {
          var cell = tt.sides[k], label = k === 'L' ? 'Left' : 'Right';
          if (!cell || cell.value === null) return label + ' ' + (cell && cell.needsMass ? 'not scored (needs body mass)' : 'not tested');
          var raw = tt.input === 'calc' ? 'adduction ' + E.fmt(cell.parts[0]) + ' N ÷ abduction ' + E.fmt(cell.parts[1]) + ' N'
            : E.fmt(cell.input) + ' ' + (tt.input === 'reps' ? 'reps' : tt.input);
          var cw = cell.change ? ', ' + changeWords({ change: cell.change, change_kind: cell.change_kind }) : '';
          return label + ' ' + cell.text + (cell.text.indexOf(raw) === 0 ? '' : ' (' + raw + ')') + ' ' + STATUS_WORD(cell.status, t) + cw;
        });
        var diff = E.diffText(tt.diff);
        L.push('- ' + tt.name + (tt.detail ? ' (' + tt.detail + ')' : '') + ': ' + sides.join(' | ') + ' | target ' + tt.target + (diff ? ' | ' + diff : ''));
      });
    } else {
      var S = DATA[t], acl = t === 'acl';
      L.push(READERS_PATIENT);
      L.push(acl ? 'Report: ACL reconstruction rehab. Results are compared with ACLR research norms for ' + clean1(state.acl.sex).toLowerCase() + ' patients at this rehab phase.'
        : 'Report: hamstring strain rehab. Injured-limb results are compared with research norms for the typical case at this rehab phase.');
      if (S.disclaimer) L.push('About the norms: ' + clean1(S.disclaimer));
      var since = sinceText(t);
      var ctx = joinBits(['rehab phase: ' + clean1(state[t].phase), blank(m.injured) ? '' : 'injured side: ' + clean1(m.injured).toLowerCase(),
        since ? (acl ? 'months since surgery: ' : 'weeks since injury: ') + since : '', acl && !blank(m.graft) ? 'graft: ' + clean1(m.graft) : '',
        blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      L.push('Context: ' + ctx + '.');
      L.push('Status key: On target = at or ahead of the typical case at this phase; Close = up to 1 SD behind; Behind = more than 1 SD behind.');
      L.push(totals);
      L.push('Results (metric: result | phase target | status | change since the previous test, if given):');
      L = L.concat(groupLines(c.groups, 'phase target', t));
      var rts = acl ? rtsData(c) : null;
      if (rts) L.push(rtsLine(rts));
    }
    return L.join('\n');
  }
  function interpBasis(t, c) { return hashStr(interpPayload(t, c)); }

  function interpCardHtml() {
    var it = state[state.tool].interp;
    return '<section class="card interp" id="interpCard" aria-labelledby="interpTitle">' +
      '<div class="card-head"><h2 id="interpTitle">Interpretation</h2><button type="button" class="quiet" data-action="ai-settings">AI settings</button></div>' +
      '<p class="interp-help">Optional summary for the ' + (state.tool === 'screen' ? 'athlete and coach' : 'patient') + ', printed near the top.</p>' +
      '<div class="interp-bar"><button type="button" class="ghost ai-draft" data-action="ai-draft">' + SPARKLE + '<span data-label>Draft with AI</span></button>' +
      '<span class="interp-status" id="interpStatus" role="status" aria-live="polite"></span></div>' +
      '<textarea id="interpText" rows="5" autocapitalize="sentences" placeholder="Tap Draft with AI, or type your own summary." aria-labelledby="interpTitle">' + esc(it.text) + '</textarea>' +
      '<p class="fine interp-privacy">Claude sees only the results and basic context. Never the ' + person(state.tool) + '’s name, notes or dates.</p>' +
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
  function aiErrorText(status, j, what) {
    var e = (j && j.error) || {}, msg = clean1(e.message), type = e.type || '';
    var code = e.details && e.details.error_code;
    if (status === 401 || type === 'authentication_error') return 'Claude didn’t accept the API key. Check it in AI settings.';
    if (status === 403 || type === 'permission_error') return 'This API key isn’t allowed to use Claude. Check it in the Claude Console.';
    if (/credit balance/i.test(msg)) return 'The Claude API account is out of credit. Add credit in the Claude Console (Settings › Billing).';
    if (code === 'enforced_spend_limit_reached' || /usage limits?/i.test(msg)) return 'The Claude API spend limit has been reached. It can be raised in the Claude Console (Settings › Billing).';
    if (status === 429 || type === 'rate_limit_error') return 'Too many requests just now. Wait a moment and try again.';
    if (status === 529 || status >= 500 || type === 'overloaded_error' || type === 'api_error') return 'Claude is busy right now. Try again in a moment.';
    if (status === 404 || type === 'not_found_error') return 'The AI model named in interpretation.json wasn’t found' + (msg ? ' (' + msg + ')' : '') + '.';
    if (status === 413 || type === 'request_too_large') return 'That’s too much to send in one go. Try fewer photos at a time.';
    return 'Claude couldn’t ' + (what || 'draft this') + (msg ? ': ' + msg : ' (error ' + status + ')') + '.';
  }
  // one request to the Messages API; resolves with the parsed reply, rejects with a plain-English message
  function claudeRequest(key, body, endpoint, timeoutS, what) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, (timeoutS || 60) * 1000);
    return fetch(endpoint || 'https://api.anthropic.com/v1/messages', {
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
        if (!res.ok) throw new Error(aiErrorText(res.status, j, what));
        return j || {};
      });
    }, function (err) {
      throw new Error(err && err.name === 'AbortError' ? 'Claude took too long to answer. Try again.' : 'Couldn’t reach Claude. Check the internet connection and try again.');
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function replyText(j) {
    return ((j && j.content) || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
  }
  function callClaude(key, payload) {
    var cfg = DATA.ai;
    var body = {
      model: cfg.model, max_tokens: cfg.max_tokens || 2000, system: [].concat(cfg.system || []).join('\n'),
      messages: [{ role: 'user', content: (cfg.request || 'Write the interpretation for these test results.') + '\n\n' + payload }]
    };
    if (cfg.effort) body.output_config = { effort: cfg.effort };
    return claudeRequest(key, body, cfg.endpoint, cfg.timeout_s || 60).then(function (j) {
      var text = tidyAiText(replyText(j));
      if (!text) throw new Error(j && j.stop_reason === 'refusal' ? 'Claude didn’t write an interpretation for these results. Try again, or write your own.' : 'Claude sent back an empty answer. Try again.');
      return text;
    });
  }
  function draftInterp() {
    if (aiBusy) return;
    var t = state.tool, c = compute(), why = blocker(c);
    interpMsg = { tool: null, kind: '', text: '' };
    function fail(msg, extra) { interpMsg = Object.assign({ tool: t, kind: 'error', text: msg }, extra || {}); renderInterpState(c); }
    if (why) return fail(why, { blocker: true });
    if (!DATA.ai || !DATA.ai.model) return fail('The AI settings file (interpretation.json) didn’t load. Reopen the app while online.');
    var key = aiKey();
    if (!key) { openAiSettings(draftInterp, 'To draft interpretations, the app needs a Claude API key. ' + ONCE_NOTE()); return; }
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
  var KEY_NOTE = 'The key is saved only on this device and is only sent to Anthropic when you use Draft with AI or Scan notes.';
  // v13, cloud mode: the key lives in the clinic store (meta/settings) and is cached on each device for offline use
  var KEY_NOTE_CLOUD = 'The key is shared by the clinic: saved once, it reaches every signed-in device. It is kept on this device too and is only sent to Anthropic when you use Draft with AI or Scan notes.';
  function ONCE_NOTE() { return CLOUD ? 'You only need to do this once for the clinic.' : 'You only need to do this once on each device.'; }
  // then: what to do once a key is saved (e.g. carry on drafting or scanning)
  function openAiSettings(then, lead) {
    aiThen = typeof then === 'function' ? then : null;
    var k = aiKey();
    els.aiKey.value = '';
    els.aiErr.hidden = true;
    els.aiRemove.hidden = !k;
    els.aiKeyState.textContent = k ? 'A key ending in ' + k.slice(-4) + ' is saved ' + (CLOUD ? 'for the clinic' : 'on this device') + '. Paste a new one to replace it.' : (CLOUD ? KEY_NOTE_CLOUD : KEY_NOTE);
    els.aiLead.textContent = lead || ('Drafting interpretations and reading scanned notes or VALD screenshots use Claude through the clinic’s own Claude API key.' +
      (CLOUD ? ' The key is shared by the clinic through the clinic store.' : ''));
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
    if (CLOUD) { CLOUD.setting(v); CLOUD.sync(); }      // shared through meta/settings (queued like any other write)
    els.aiKey.value = '';
    var then = aiThen;
    aiThen = null;
    closeModal();
    toast(CLOUD ? 'API key saved for the clinic' : 'API key saved on this device');
    if (then) then();
  }
  function removeAiKey() {
    try { localStorage.removeItem(AI_KEY_STORE); } catch (e) { /* storage unavailable */ }
    if (CLOUD) { CLOUD.setting(''); CLOUD.sync(); }
    els.aiRemove.hidden = true;
    els.aiKeyState.textContent = (CLOUD ? 'Key removed for the clinic. ' : 'Key removed. ') + (CLOUD ? KEY_NOTE_CLOUD : KEY_NOTE);
    els.aiKey.focus();
  }
  // the clinic's key as pulled from meta/settings: kept in the same place as a key pasted here, so it works offline
  function applyCloudKey(k) {
    if (k == null) return;                             // no settings document yet: whatever this device has stays
    var cur = aiKey();
    if (k === cur) return;
    try { if (k) localStorage.setItem(AI_KEY_STORE, k); else localStorage.removeItem(AI_KEY_STORE); } catch (e) { /* storage unavailable */ }
    if (openModalEl === els.aiDialog) {                // the dialog is open: its state line follows
      els.aiRemove.hidden = !k;
      els.aiKeyState.textContent = k ? 'A key ending in ' + k.slice(-4) + ' is saved for the clinic. Paste a new one to replace it.' : KEY_NOTE_CLOUD;
    }
  }

  // ------------------------------------------------------------------ scan notes (photo -> results)
  // A photo of the clinician's own handwritten notes is shrunk on the device and sent to Claude with this
  // tab's list of tests (plus the injured side on the rehab tabs). Claude answers in a fixed JSON shape and
  // only copies what is written: it never calculates. The readings go straight into the boxes, highlighted
  // until they are checked or edited, with an Undo. Names on the paper are never read back.
  var CAMERA = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  var scanBusy = null, scanGen = 0, scanInfo = null;
  var SCAN_DEFAULT = {
    effort: 'medium', max_tokens: 8000, timeout_s: 120, max_edge: 2000, max_photos: 6,
    system: [
      'You read test results from photos taken at BASE Health Noosa, a sports physiotherapy clinic in Queensland, Australia, and match them to the tests listed in the request. Each photo is either the clinician’s handwritten testing notes or a screenshot of a VALD app (ForceDecks, NordBord, ForceFrame, DynaMo, SmartSpeed or VALD Hub).',
      'Handwritten notes are on the clinician’s own paper, so labels may be abbreviated or shorthand (for example SS for split squat, KE for knee extension, CMJ for countermovement jump, JH for jump height, Add/Abd for hip adduction/abduction, L/R for left/right, Inj for injured). Match each written result to the listed test it clearly belongs to.',
      'Copy each number exactly as written, as a plain number without units, using a full stop for decimals. Never calculate anything: no averages, differences, percentages, ratios or LSIs. If a listed test is a calculated value that is not written on the paper, but the numbers it would come from are, leave the test out and put those numbers in unclear so the clinician can work it out.',
      'If several trials are written for one test and none is marked as the result, use the best one (the highest, or the lowest where lower is better) and say so in unclear.',
      'VALD screenshots: copy each value exactly as the app displays it (the same digits and decimal places), without units. A value VALD itself displays, such as an imbalance %, RSI-modified or a force per body mass, counts as written, so copy it; still never work anything out yourself.',
      'Match VALD labels to the listed tests by meaning. For example: "Jump Height (Imp-Mom)" or "Jump Height (Flight Time)" is Jump Height (cm); "Peak Power / BM" is Peak Power (W/kg); "RSI-modified" is RSI-modified; on an IMTP screen "Peak Vertical Force" is IMTP Peak Force and "Peak Vertical Force / BM" is IMTP Relative Force; NordBord left and right max force are Nordic Peak Force — Left and Nordic Peak Force — Right; the NordBord imbalance % is Nordic L/R Imbalance, with side = the stronger side VALD shows (L or R); ForceFrame adduction and abduction forces are Adductor Peak Force and Abductor Peak Force. On the other sections use the listed test that matches: for example CMJ — Jump height or Nordic peak force — injured on the rehab sections, and Hip adduction or Hip abduction, left and right, on LL Strength. If a side is not clear on the screen, leave it out and say so in unclear.',
      'Where a VALD screen shows several reps or trials and highlights a best or average result (for example in bold, starred, or labelled Best or Avg), use the highlighted result. If nothing is highlighted, use the best rep (the highest, or the lowest where lower is better) and say so in unclear.',
      'Only return a reading when you can tell both which test it belongs to and what the number is. If a number is hard to read, or you are unsure which test or side it belongs to, give your best reading and also describe the doubt in unclear (for example: "Nordic R: 318 or 348?"). Never invent values for tests that are not on the paper or screen.',
      'If a result is written or displayed in a different unit from the one listed (for example lb instead of kg, or N instead of N/kg), do not convert it: leave it out and mention it in unclear. This applies to handwriting and screenshots alike.',
      'Dates are written Australian style (day/month/year); on a screenshot read the date as the app shows it. Give the test date as YYYY-MM-DD if one is written, otherwise an empty string. Give body mass in kg if it is written or shown, otherwise an empty string.',
      'Keep each unclear note short and name the test it is about. Ignore names and any other personal details on the paper or screen, and never include them in your answer.'
    ]
  };
  function scanCfg() {
    var cfg = Object.assign({}, SCAN_DEFAULT), ai = DATA.ai || {};
    cfg.model = ai.model; cfg.endpoint = ai.endpoint;
    if (ai.scan && typeof ai.scan === 'object') Object.keys(ai.scan).forEach(function (k) { cfg[k] = ai.scan[k]; });
    return cfg;
  }
  var CALCULATED = /LSI|% of|deficit|imbalance|asymmetry|diff %|ratio|relative/i;
  // what Claude should look for on the paper for one app metric (screening and rehab tabs)
  function scanWhat(t, m) {
    var unit = m.unit && m.unit !== 'AU' ? m.unit : (m.unit === 'AU' ? 'score' : 'number');
    var w = m.calc === 'PERBW' || m.calc === 'PERKG' ? 'force in N (the app divides by body mass)' : 'in ' + unit;
    if (m.calc === 'LSI') return 'left and right values in the same unit (the app works out the LSI)';
    if (/(\u2014 injured|\(injured\))$/.test(m.name)) w += ', injured side only';
    else if (CALCULATED.test(m.name) && m.calc !== 'PERBW' && m.calc !== 'PERKG') w += ', only if this number itself is written';
    if (m.dir === 'Lower') w += ', lower is better';
    if (t === 'screen' && E.isAsym(m.name)) w += '; side = the higher side, L or R';
    return w;
  }
  // the tests Claude may fill on this tab: id t1..tN -> the app's own metric key and fields
  function scanList(t) {
    var list = [], n = 0;
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        if (tt.input === 'calc') return;
        list.push({ id: 't' + (++n), key: tt.id, name: tt.name, what: INPUT_WORD[tt.input] + (tt.detail ? ' (' + tt.detail + ')' : '') + ' for each leg', fields: ['left', 'right'] });
      });
    } else {
      DATA[t].groups.forEach(function (g) {
        g.metrics.forEach(function (m) {
          if (m.calc === 'DSI') return;
          var fields = m.calc === 'LSI' ? ['left', 'right'] : (t === 'screen' && E.isAsym(m.name) ? ['result', 'side'] : ['result']);
          list.push({ id: 't' + (++n), key: m.name, name: m.name, what: scanWhat(t, m), fields: fields });
        });
      });
    }
    return list;
  }
  function scanPrompt(t, list) {
    var L = ['Section of the app: ' + TOOL_NAMES[t] + '.'];
    if (t === 'ham' || t === 'acl') {
      var inj = state[t].meta.injured;
      L.push(inj ? 'Injured side: ' + inj + '. Where a test asks for the injured side and both sides are written, use the ' + inj.toLowerCase() + ' value.'
        : 'Injured side: not chosen in the app yet. Where a test asks for the injured side, use it only if the notes make the injured side clear; otherwise leave it out and mention it in unclear.');
    }
    L.push('Tests (id: name — what to look for — fields to return):');
    list.forEach(function (x) { L.push(x.id + ': ' + x.name + ' — ' + x.what + ' — ' + x.fields.join(', ')); });
    L.push('');
    L.push('Return every reading you can match. Use field "result" for a single value, "left" and "right" for each side, and "side" with the value L or R for the higher side (asymmetry tests only). Leave out tests that are not on the paper or screen.');
    return L.join('\n');
  }
  function scanSchema(list) {
    return {
      type: 'object',
      properties: {
        test_date: { type: 'string' },
        body_mass_kg: { type: 'string' },
        readings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              test: { type: 'string', enum: list.map(function (x) { return x.id; }) },
              field: { type: 'string', enum: ['result', 'left', 'right', 'side'] },
              value: { type: 'string' }
            },
            required: ['test', 'field', 'value'],
            additionalProperties: false
          }
        },
        unclear: { type: 'array', items: { type: 'string' } }
      },
      required: ['test_date', 'body_mass_kg', 'readings', 'unclear'],
      additionalProperties: false
    };
  }
  // shrink a photo on the device (JPEG, long edge <= maxEdge) and return it as base64
  function prepareImage(file, maxEdge) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, maxEdge / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          var data = cv.toDataURL('image/jpeg', 0.86);
          cv.width = cv.height = 1;   // hand the memory back straight away (iPad)
          URL.revokeObjectURL(url);
          if (data.indexOf('data:image/jpeg') !== 0) throw new Error('no jpeg');
          resolve({ data: data.slice(data.indexOf(',') + 1), media_type: 'image/jpeg', w: cw, h: ch });
        } catch (e) { URL.revokeObjectURL(url); reject(new Error('Couldn’t prepare that photo. Try taking it again.')); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Couldn’t open that photo. Try a JPEG or PNG photo.')); };
      img.src = url;
    });
  }
  function prepareAll(files, maxEdge) {   // one at a time, so big photos don't pile up in memory
    var out = [];
    return files.reduce(function (p, f) {
      return p.then(function () { return prepareImage(f, maxEdge).then(function (im) { out.push(im); }); });
    }, Promise.resolve()).then(function () { return out; });
  }
  function startScan(files) {
    var t = state.tool, exm = t === 'ex';                 // exm: the Exercises tab's own prompt, schema and apply step
    if (!files.length || scanBusy) return;
    var cfg = exm ? exScanCfg() : scanCfg();
    function fail(msg) { scanInfo = { tool: t, kind: 'error', text: msg }; renderScanBar(); }
    if (!DATA.ai || !cfg.model) return fail('The AI settings file (interpretation.json) didn’t load. Reopen the app while online.');
    var photos = files.filter(function (f) { return !f.type || f.type.indexOf('image/') === 0; });
    if (!photos.length) return fail(exm ? 'That file isn’t a photo. Choose a photo of the exercise page.' : 'That file isn’t a photo. Choose a photo of your notes.');
    if (!aiKey()) {
      openAiSettings(function () { if (state.tool === t) startScan(files); }, exm
        ? 'To read photos of a handwritten exercise page, the app needs a Claude API key. ' + ONCE_NOTE()
        : 'To read photos of your notes or VALD screenshots, the app needs a Claude API key. ' + ONCE_NOTE());
      return;
    }
    if (navigator.onLine === false) return fail(exm ? 'No internet connection. Connect to scan the exercise page, or type the exercises in.' : 'No internet connection. Connect to scan your notes, or type the results in.');
    var max = cfg.max_photos || 6, extra = photos.length > max ? photos.length - max : 0;
    photos = photos.slice(0, max);
    var gen = scanGen, list = exm ? null : scanList(t), nPhotos = photos.length;
    scanBusy = t;
    scanInfo = { tool: t, kind: 'busy', text: 'Reading ' + (nPhotos === 1 ? (exm ? 'the exercise page' : 'your notes') : nPhotos + ' photos') + '… this can take up to a minute.' };
    renderScanBar();
    prepareAll(photos, cfg.max_edge || 2000).then(function (images) {
      if (gen !== scanGen) throw null;
      var content = [];
      images.forEach(function (im, i) {
        if (images.length > 1) content.push({ type: 'text', text: 'Photo ' + (i + 1) + ':' });
        content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
      });
      // Exercises: only the photos and a fixed request go to Claude, never anything from the patient card or the program
      content.push({ type: 'text', text: exm ? exScanRequest(images.length) : scanPrompt(t, list) });
      var body = {
        model: cfg.model, max_tokens: cfg.max_tokens || 8000, system: [].concat(cfg.system || []).join('\n'),
        messages: [{ role: 'user', content: content }],
        output_config: { format: { type: 'json_schema', schema: exm ? exScanSchema() : scanSchema(list) } }
      };
      if (cfg.effort) body.output_config.effort = cfg.effort;
      return claudeRequest(aiKey(), body, cfg.endpoint, cfg.timeout_s || 120, 'read the photo');
    }).then(function (j) {
      if (gen !== scanGen) return;
      if (j.stop_reason === 'max_tokens') throw new Error('There was too much to read in one go. Try fewer photos at a time.');
      if (j.stop_reason === 'refusal') throw new Error('Claude couldn’t read these notes. Try a clearer photo.');
      var out;
      try { out = JSON.parse(replyText(j)); } catch (e) { throw new Error('Claude’s answer couldn’t be read. Try again.'); }
      if (exm) applyExScan(out, nPhotos); else applyScan(t, out, list);
      if (extra) scanInfo.unclear.unshift('Only the first ' + max + ' photos were read (' + extra + (extra === 1 ? ' more was' : ' more were') + ' left out). Scan the rest separately.');
    }).catch(function (err) {
      if (gen !== scanGen || err === null) return;
      scanInfo = { tool: t, kind: 'error', text: err && err.message ? err.message : 'Something went wrong reading the photo. Try again.' };
    }).then(function () {
      if (gen !== scanGen) return;
      scanBusy = null;
      // results filled in: the details card folds into the strip (v11), the scan's message showing under it
      var filled = !!(scanInfo && scanInfo.tool === t && scanInfo.undo && (exm || scanInfo.kind === 'done'));
      if (state.tool === t && scanInfo && scanInfo.undo) {
        if (exm) { showExScan(); if (filled) foldNow(t, false); }
        else if (scanOffPage(t)) { if (filled) foldBeforeRender(t); render(); }   // a value for a section left out under Tests today
        else { showFilled(t); retest.tool = null; refresh(); applyScanMarks(); if (filled) foldNow(t, false); }
      } else if (filled) foldBeforeRender(t);          // read while on another tab: folded there for when it's opened
      renderScanBar();
      var bar = $('scanBar');
      if (bar && !bar.hidden && bar.scrollIntoView && state.tool === t) {
        var r = bar.getBoundingClientRect(), top = appbarH + (state[t].cardOpen === false ? 48 : 0);
        if (r.top < top || r.bottom > window.innerHeight) bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }
  function scanOffPage(t) {                            // a box the scan filled isn't on the page (its section isn't drawn)
    return Object.keys(scanInfo.undo.put).some(function (mk) {
      var i = mk.lastIndexOf('|'), key = mk.slice(0, i);
      return key !== 'meta' && !markEl(t, key, mk.slice(i + 1));
    });
  }
  function fieldLabel(def, f) {
    if (f === 'left') return def.name + ' L';
    if (f === 'right') return def.name + ' R';
    if (f === 'side') return def.name + ' (higher side)';
    return def.name;
  }
  // put Claude's readings into the boxes; remember what each box held before, for Undo
  function applyScan(t, out, list) {
    var s = state[t], byId = {}, marks = s.scanned, notes = [];
    var undo = { was: {}, put: {}, had: {} };
    list.forEach(function (x) { byId[x.id] = x; });
    function put(key, f, v, label) {
      var mk = key + '|' + f, cur = key === 'meta' ? s.meta[f] : val(t, key)[f];
      cur = cur == null ? '' : String(cur);
      if (mk in undo.put) {
        if (undo.put[mk] !== v) notes.push(label + ': two different values on the paper (' + undo.put[mk] + ' and ' + v + '); ' + v + ' was used.');
      } else {
        undo.was[mk] = cur; undo.had[mk] = !!marks[mk];
        if (cur !== '' && cur !== v && !marks[mk] && key !== 'meta') notes.push(label + ': replaced ' + cur + ' with ' + v + ' from the photo.');
      }
      if (key === 'meta') s.meta[f] = v; else val(t, key)[f] = v;
      undo.put[mk] = v;
      marks[mk] = true;
    }
    (out && Array.isArray(out.readings) ? out.readings : []).forEach(function (r) {
      var def = r && byId[r.test];
      if (!def || def.fields.indexOf(r.field) < 0) return;
      var raw = String(r.value == null ? '' : r.value).trim(), v;
      if (r.field === 'side') {
        v = raw.toUpperCase().charAt(0);
        if (v !== 'L' && v !== 'R') return;
      } else {
        v = raw.replace(/,/g, '.').replace(/[^\d.\-]/g, '');
        if (E.parseInput(v) === null) { if (raw) notes.push(fieldLabel(def, r.field) + ': couldn’t use “' + raw.slice(0, 30) + '”.'); return; }
      }
      put(def.key, r.field, v, fieldLabel(def, r.field));
    });
    var d = String((out && out.test_date) || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && E.parseDate(d, ['Y-m-d'])) put('meta', 'date', d, 'Test date');
    var mass = String((out && out.body_mass_kg) || '').replace(/,/g, '.').replace(/[^\d.]/g, ''), mv = E.parseInput(mass);
    if ('mass' in s.meta && mv !== null && mv >= 20 && mv <= 300) put('meta', 'mass', mass, 'Body mass');
    var keys = Object.keys(undo.put), n = keys.filter(function (k) { return k.indexOf('meta|') !== 0; }).length;
    var unclear = (out && Array.isArray(out.unclear) ? out.unclear : []).map(function (x) { return String(x).trim(); }).filter(Boolean).concat(notes);
    scanInfo = {
      tool: t, kind: n ? 'done' : 'empty', n: n, unclear: unclear.slice(0, 12), undo: keys.length ? undo : null,
      date: 'meta|date' in undo.put, mass: 'meta|mass' in undo.put
    };
  }
  // Undo puts back what each box held before the scan, except boxes changed by hand since
  function undoScan() {
    if (state.tool === 'ex') { undoExScan(); return; }
    var t = state.tool, u = scanInfo && scanInfo.tool === t && scanInfo.undo;
    if (!u) return;
    var s = state[t], kept = 0;
    Object.keys(u.put).forEach(function (mk) {
      var i = mk.lastIndexOf('|'), key = mk.slice(0, i), f = mk.slice(i + 1);
      var cur = key === 'meta' ? s.meta[f] : val(t, key)[f];
      if (String(cur == null ? '' : cur) !== u.put[mk]) { kept++; return; }
      if (key === 'meta') s.meta[f] = u.was[mk]; else val(t, key)[f] = u.was[mk];
      if (u.had[mk]) s.scanned[mk] = true; else delete s.scanned[mk];
    });
    scanInfo = null;
    render();
    toast(kept ? 'Scan undone. ' + kept + (kept === 1 ? ' box you changed was' : ' boxes you changed were') + ' kept.' : 'Scan undone');
  }
  function markEl(t, key, field) {
    if (key === 'meta') return $(t + '-' + field);
    var row = null;
    els.entry.querySelectorAll('.metric').forEach(function (el) { if (el.dataset.metric === key) row = el; });
    if (!row) return null;
    return field === 'side' ? row.querySelector('.side') : row.querySelector('input[data-field="' + field + '"]');
  }
  // show the scanned values in the boxes on screen without rebuilding the page (keeps the keyboard where it is)
  function showFilled(t) {
    Object.keys(scanInfo.undo.put).forEach(function (mk) {
      var i = mk.lastIndexOf('|'), key = mk.slice(0, i), f = mk.slice(i + 1), el = markEl(t, key, f);
      if (!el) return;
      if (f === 'side') {
        var sd = val(t, key).side;
        el.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(sd === x.dataset.side)); });
      } else el.value = key === 'meta' ? state[t].meta[f] || '' : val(t, key)[f] || '';
    });
  }
  function applyScanMarks() {
    var t = state.tool;
    if (t === 'ex') { applyExMarks(); return; }
    els.entry.querySelectorAll('.scanned').forEach(function (el) { el.classList.remove('scanned'); });
    Object.keys(state[t].scanned || {}).forEach(function (k) {
      var i = k.lastIndexOf('|'), el = markEl(t, k.slice(0, i), k.slice(i + 1));
      if (el) el.classList.add('scanned');
    });
  }
  function unmarkScanned(el) {
    if (!el || !el.classList || !el.classList.contains('scanned')) return;
    el.classList.remove('scanned');
    var marks = state[state.tool].scanned, row = el.closest && el.closest('.metric');
    if (el.dataset && el.dataset.meta) delete marks['meta|' + el.dataset.meta];
    else if (row && el.classList.contains('side')) delete marks[row.dataset.metric + '|side'];
    else if (row && el.dataset && el.dataset.field) delete marks[row.dataset.metric + '|' + el.dataset.field];
  }
  function renderScanBar() {
    var bar = $('scanBar'), btn = $('scanBtn'), t = state.tool;
    if (btn) {
      btn.classList.toggle('busy', !!scanBusy);
      btn.setAttribute('aria-disabled', String(!!scanBusy));
      btn.querySelector('[data-label]').textContent = scanBusy ? 'Reading…' : (t === 'ex' ? 'Scan exercise page' : 'Scan notes');
      var inp = $('scanFiles');
      if (inp) inp.disabled = !!scanBusy;
    }
    var sc = $('stripScan');                           // the strip's camera (v11) says the same
    if (sc) {
      sc.classList.toggle('busy', !!scanBusy);
      sc.setAttribute('aria-disabled', String(!!scanBusy));
      sc.title = scanBusy ? 'Reading…' : (t === 'ex' ? 'Scan exercise page' : 'Scan notes');
    }
    if (!bar) return;
    var info = scanInfo && scanInfo.tool === t ? scanInfo : null;
    if (!info) { bar.hidden = true; bar.innerHTML = ''; bar.className = 'scan-bar'; return; }
    bar.hidden = false;
    bar.className = 'scan-bar ' + info.kind;
    var close = '<button type="button" class="quiet scan-x" data-action="scan-close" aria-label="Close this message">×</button>';
    if (info.kind === 'busy') { bar.innerHTML = '<span class="scan-ico">' + CAMERA + '</span><span class="scan-msg">' + esc(info.text) + '</span>'; return; }
    if (info.kind === 'error') { bar.innerHTML = '<span class="scan-msg">' + esc(info.text) + '</span>' + close; return; }
    var extra = [info.date ? 'test date' : '', info.mass ? 'body mass' : ''].filter(Boolean);
    var html = '<span class="scan-ico">' + CAMERA + '</span>' + (t === 'ex' ? (info.kind === 'empty'
      ? '<span class="scan-msg">No exercises were found on the ' + (info.photos > 1 ? 'photos' : 'photo') + '. Check it’s a photo of the exercise page, or try a clearer photo. Nothing was changed.</span>'
      : '<span class="scan-msg"><b>Filled ' + info.n + (info.n === 1 ? ' exercise' : ' exercises') + ' from your notes.</b> Check them against the page before creating the handout.</span>')
      : info.kind === 'empty'
      ? '<span class="scan-msg">Nothing on the photo matched the ' + esc(TOOL_NAMES[t]) + ' tests' + (extra.length ? ' (only the ' + extra.join(' and ') + ')' : '') + '. Check you’re on the right tab, or try a clearer photo.</span>'
      : '<span class="scan-msg"><b>Filled ' + info.n + (info.n === 1 ? ' result' : ' results') + (extra.length ? ' and the ' + extra.join(' and ') : '') + ' from your notes.</b> Check the highlighted boxes against the paper or screenshot before creating the report.</span>');
    if (info.undo) html += '<button type="button" class="quiet scan-undo" data-action="scan-undo">Undo</button>';
    html += close;
    if (info.unclear && info.unclear.length) {
      html += '<div class="scan-unclear"><b>Worth a look:</b><ul>' + info.unclear.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div>';
    }
    bar.innerHTML = html;
  }

  // ------------------------------------------------------------------ exercise program (v10)
  // A handwritten exercise page becomes an editable table and a branded PDF handout. The practitioner photographs the
  // page (Scan exercise page) or types the exercises; Claude only ever sees the photos and a fixed request. The table is
  // a flat list of section headings and exercise rows, so moving a row up or down past a heading moves it into that
  // section. Every value is free text ("8–12", "30 s", "AMRAP", "Red band"). Exercise, Sets, Reps and Load always show;
  // Rest, Tempo, Side and Notes are a row's details, shown when written (as columns only when used anywhere) or opened
  // with More. The program is kept in the draft only (state.ex) until Clear all: never in the client records.
  var EX_FIELDS = ['name', 'sets', 'reps', 'load', 'rest', 'tempo', 'side', 'notes'];
  var EX_MAIN = ['sets', 'reps', 'load'];
  var EX_DETAIL = ['rest', 'tempo', 'side', 'notes'];
  var EX_LABEL = { name: 'Exercise', sets: 'Sets', reps: 'Reps', load: 'Load', rest: 'Rest', tempo: 'Tempo', side: 'Side', notes: 'Notes' };
  var EX_LEN = { name: 120, notes: 300, heading: 80, title: 120, instructions: 1000 };   // characters kept (other boxes: 60)
  var EX_WORDS = { name: 1, load: 1, side: 1, notes: 1 };                              // boxes that start with a capital
  var ICON_UP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';

  function freshEx() { return { meta: { name: '', date: todayIso(), practitioner: userName() }, title: '', instructions: '', items: [], seq: 1, scanned: {}, cardOpen: true }; }
  function exStr(v) { return typeof v === 'string' ? v : (typeof v === 'number' && isFinite(v) ? String(v) : ''); }
  // drafts from v9 and earlier have no program; anything malformed in a stored one is tidied
  function tidyEx() {
    var x = state.ex;
    if (!x || typeof x !== 'object' || Array.isArray(x)) x = state.ex = freshEx();
    if (!x.meta || typeof x.meta !== 'object' || Array.isArray(x.meta)) x.meta = { name: '', date: todayIso(), practitioner: '' };
    var dt = x.meta.date;                              // a date cleared by hand stays cleared; anything unreadable becomes today
    x.meta = { name: exStr(x.meta.name), date: dt === '' || (typeof dt === 'string' && E.parseDate(dt, ['Y-m-d'])) ? dt : todayIso(), practitioner: exStr(x.meta.practitioner) };
    x.title = exStr(x.title); x.instructions = exStr(x.instructions);
    var seen = {}, top = 0, list = [];
    (Array.isArray(x.items) ? x.items : []).forEach(function (it) {
      if (!it || typeof it !== 'object' || (it.kind !== 'ex' && it.kind !== 'section')) return;
      var id = typeof it.id === 'string' && /^r\d{1,9}$/.test(it.id) && !seen[it.id] ? it.id : '';
      if (id) { seen[id] = 1; top = Math.max(top, +id.slice(1)); }
      var o = { kind: it.kind, id: id };
      if (it.kind === 'section') o.heading = exStr(it.heading);
      else { EX_FIELDS.forEach(function (f) { o[f] = exStr(it[f]); }); o.open = it.open === true; }
      list.push(o);
    });
    var seq = typeof x.seq === 'number' && x.seq % 1 === 0 && x.seq > 0 && x.seq < 1e9 ? x.seq : 1;
    x.seq = Math.max(seq, top + 1);
    list.forEach(function (o) { if (!o.id) o.id = 'r' + (x.seq++); });
    x.items = list;
    var sc = x.scanned && typeof x.scanned === 'object' && !Array.isArray(x.scanned) ? x.scanned : {}, keep = {};
    Object.keys(sc).forEach(function (k) { if (sc[k] === true && (k === 'title' || k === 'instructions' || seen[k])) keep[k] = true; });
    x.scanned = keep;
    x.cardOpen = x.cardOpen !== false;                 // v11: the patient card open unless folded into the strip
    x.editing = false;                                 // v11: Edit mode starts off on every visit (never saved)
  }
  function newExRow(o) {
    var r = { kind: 'ex', id: 'r' + (state.ex.seq++), open: false };
    EX_FIELDS.forEach(function (f) { r[f] = o && o[f] ? o[f] : ''; });
    return r;
  }
  function newExSection(h) { return { kind: 'section', id: 'r' + (state.ex.seq++), heading: h || '' }; }
  function exIndex(id) { for (var i = 0; i < state.ex.items.length; i++) if (state.ex.items[i].id === id) return i; return -1; }
  function exItem(id) { var i = exIndex(id); return i < 0 ? null : state.ex.items[i]; }
  function exFilled(it) { return it.kind === 'ex' && EX_FIELDS.some(function (f) { return !blank(it[f]); }); }
  function exHasDet(it) { return EX_DETAIL.some(function (f) { return !blank(it[f]); }); }
  function exUsed() {                                  // detail columns written for at least one exercise
    var u = {};
    state.ex.items.forEach(function (it) { if (it.kind === 'ex') EX_DETAIL.forEach(function (f) { if (!blank(it[f])) u[f] = true; }); });
    return u;
  }
  function exCounts() {                                // what the summary, the dock and Clear all count
    var n = 0, s = 0;
    state.ex.items.forEach(function (it) { if (it.kind === 'section') { if (!blank(it.heading)) s++; } else if (exFilled(it)) n++; });
    return { exercises: n, sections: s };
  }
  function exColumns() {
    var u = exUsed();
    return ['name'].concat(EX_MAIN, EX_DETAIL.filter(function (f) { return u[f]; }));
  }

  // ---- the screen: patient card (with the scan button), program card (title, instructions, the table)
  function renderEx() {
    els.entry.innerHTML = '<div class="pagehead"><h1>' + esc(HEAD.ex[0]) + '</h1><p>' + esc(HEAD.ex[1]) + '</p></div>' + exPatientCard() + exProgramCard();
    fitExNotes();
    fitExWraps();
    applyExMarks();
    renderScanBar();
    refreshEx();
    showCard();
  }
  function exPatientCard() {
    return '<section class="card athlete ex-patient" id="athleteCard" tabindex="-1" aria-labelledby="exPatientH"' + (state.ex.cardOpen === false ? ' hidden' : '') + '>' + cardHead('ex', 'exPatientH') +
      '<div class="fields">' +
      field('ex', 'name', 'Patient name', { cls: 'wide', words: true, plain: true }) + field('ex', 'date', 'Date', { type: 'date' }) +
      field('ex', 'practitioner', 'Clinician', { words: true }) +
      '</div></section>' + stripHtml('ex') + '<div class="scan-bar" id="scanBar" role="status" aria-live="polite" hidden></div>';
  }
  function exProgramCard() {
    var x = state.ex;
    // Edit (v11): shows the move and delete buttons on every row (Done hides them again); not kept in the draft
    return '<section class="card ex-prog" id="exCard" aria-labelledby="exProgH"><div class="card-head"><h2 id="exProgH">Program</h2><div class="ex-headr"><span class="ex-count" id="exCount"></span>' +
      '<button type="button" class="ghost ex-edit" id="exEdit" data-action="ex-edit"' + (x.items.length ? '' : ' hidden') + '>' + (x.editing ? 'Done' : 'Edit') + '</button></div></div>' +
      '<div class="ex-top"><label class="f" for="ex-title"><span>Title</span><input id="ex-title" data-ex="title" type="text" value="' + esc(x.title) + '" maxlength="' + EX_LEN.title + '"' +
      ' placeholder="Optional, e.g. Knee rehab – phase 2" autocapitalize="sentences" autocomplete="off" enterkeyhint="next"></label>' +
      '<label class="f" for="ex-instructions"><span>General instructions</span><textarea id="ex-instructions" data-ex="instructions" rows="2" maxlength="' + EX_LEN.instructions + '"' +
      ' placeholder="Optional, e.g. 3 × per week. Ice after if sore." autocapitalize="sentences">' + esc(x.instructions) + '</textarea></label></div>' +
      '<div class="ex-table' + (x.editing ? ' editing' : '') + '" id="exTable">' + exTableHtml() + '</div>' +
      '<div class="ex-add"><button type="button" class="ghost" id="exAdd" data-action="ex-add">+ Exercise</button>' +
      '<button type="button" class="ghost" id="exAddSec" data-action="ex-add-sec">+ Section</button></div></section>';
  }
  // The name and the notes wrap (a one-line box that grows, so a long name can be checked against the page in full);
  // Return still moves to the next box. The other boxes are ordinary one-line inputs.
  var EX_WRAP = { name: 1, notes: 1 };
  function exInput(it, f, who) {
    var words = EX_WORDS[f] ? ' autocapitalize="sentences"' : ' autocapitalize="none" autocorrect="off" spellcheck="false"';
    var attrs = ' id="ex-' + it.id + '-' + f + '" data-f="' + f + '" maxlength="' + (EX_LEN[f] || 60) + '" placeholder="' + EX_LABEL[f] + '" aria-label="' + who + ' ' + f + '"' +
      words + ' autocomplete="off" enterkeyhint="next"';
    if (EX_WRAP[f]) return '<textarea class="ex-in ex-wrap ex-' + f + '" rows="1"' + attrs + '>' + esc(it[f]) + '</textarea>';
    return '<input class="ex-in ex-' + f + '" type="text" value="' + esc(it[f]) + '"' + attrs + '>';
  }
  function fitExWraps() {                              // each wrapping box as tall as its text (hidden ones are fitted when shown)
    var list = Array.prototype.filter.call(els.entry.querySelectorAll('textarea.ex-wrap'), function (el) { return el.getClientRects().length > 0; });
    list.forEach(function (el) { el.style.height = 'auto'; });
    var hs = list.map(function (el) { return el.scrollHeight; });
    list.forEach(function (el, i) { el.style.height = (hs[i] + 2) + 'px'; });
  }
  function exTableHtml() {
    var items = state.ex.items;
    if (!items.length) return '<p class="ex-empty">No exercises yet. Scan the exercise page, or add them below.</p>';
    var used = exUsed(), n = 0, s = 0, last = items.length - 1;
    var html = '<div class="ex-cols" aria-hidden="true"><span class="c-name">Exercise</span><span class="c-sets">Sets</span><span class="c-reps">Reps</span><span class="c-load">Load</span></div>';
    // "+ Exercise" under the last row of each section (v11); the last section has the one under the table
    var groupEnd = null, groupName = '';
    items.forEach(function (it, i) {
      if (it.kind === 'section' && groupEnd) {
        html += '<div class="ex-add-in"><button type="button" class="quiet" data-action="ex-add-in" data-after="' + groupEnd + '">+ Exercise<span class="vh"> ' +
          esc(groupName ? 'in ' + groupName : 'before the first section') + '</span></button></div>';
      }
      if (it.kind === 'section') { groupName = clean1(it.heading) || 'section ' + (s + 1); }
      groupEnd = it.id;
      var sec = it.kind === 'section', who = sec ? 'Section ' + (++s) : 'Exercise ' + (++n), lower = who.toLowerCase(), id = 'ex-' + it.id;
      var acts = '<div class="ex-acts">' + (sec ? '<span></span>'
        : '<button type="button" class="ex-btn ex-more" id="' + id + '-more" data-action="ex-more" aria-expanded="' + it.open + '" aria-controls="' + id + '-det">' +
          (it.open ? 'Less' : 'More') + '<span class="vh"> details, ' + lower + '</span></button>') +
        '<button type="button" class="ex-btn" id="' + id + '-up" data-action="ex-up" aria-label="Move ' + lower + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ICON_UP + '</button>' +
        '<button type="button" class="ex-btn" id="' + id + '-down" data-action="ex-down" aria-label="Move ' + lower + ' down"' + (i === last ? ' disabled' : '') + '>' + ICON_DOWN + '</button>' +
        '<button type="button" class="ex-btn ex-del" id="' + id + '-del" data-action="ex-del" aria-label="Delete ' + lower + '">' + ICON_X + '</button></div>';
      if (sec) {
        html += '<div class="ex-row ex-sec" id="' + id + '" data-id="' + it.id + '" role="group" aria-label="' + who + '">' +
          '<input class="ex-in ex-heading" id="' + id + '-heading" data-f="heading" type="text" value="' + esc(it.heading) + '" maxlength="' + EX_LEN.heading + '"' +
          ' placeholder="Section heading, e.g. Warm-up" aria-label="' + who + ' heading" autocapitalize="sentences" autocomplete="off" enterkeyhint="next">' + acts + '</div>';
        return;
      }
      html += '<div class="ex-row" id="' + id + '" data-id="' + it.id + '" role="group" aria-label="' + who + '"><span class="ex-num" aria-hidden="true">' + n + '</span>' +
        exInput(it, 'name', who) +
        EX_MAIN.map(function (f) { return '<label class="ex-cell c-' + f + '"><span class="ex-cl">' + EX_LABEL[f] + '</span>' + exInput(it, f, who) + '</label>'; }).join('') + acts +
        '<div class="ex-det" id="' + id + '-det"' + (it.open || exHasDet(it) ? '' : ' hidden') + '>' + EX_DETAIL.map(function (f) {
          return '<label class="ex-cell c-' + f + '"' + (it.open || used[f] ? '' : ' hidden') + '><span class="ex-cl">' + EX_LABEL[f] + '</span>' + exInput(it, f, who) + '</label>';
        }).join('') + '</div></div>';
    });
    return html;
  }
  function renderExTable() {
    var tbl = $('exTable');
    if (!tbl) return;
    tbl.innerHTML = exTableHtml();
    fitExWraps();
    applyExMarks();
    refreshEx();
  }
  // A detail column comes and goes as it is first written or last cleared: the other rows show or hide that box. The row
  // being typed in is left alone (nothing moves under the finger); it is tidied at the next redraw.
  function syncExDetails(except) {
    var used = exUsed(), changed = false;
    els.entry.querySelectorAll('.ex-row[data-id]').forEach(function (row) {
      var it = row === except ? null : exItem(row.dataset.id);
      if (!it || it.kind !== 'ex') return;
      EX_DETAIL.forEach(function (f) {
        var c = row.querySelector('.ex-det .c-' + f), hide = !(it.open || used[f]);
        if (c && c.hidden !== hide) { c.hidden = hide; changed = true; }
      });
    });
    if (changed) fitExWraps();                         // a notes box just shown is fitted to its text
  }
  function applyExMarks() {                            // the blue "check me" look on rows (and title, instructions) filled by a scan
    var sc = state.ex.scanned;
    els.entry.querySelectorAll('.ex-row[data-id]').forEach(function (row) { row.classList.toggle('scanned', !!sc[row.dataset.id]); });
    ['title', 'instructions'].forEach(function (k) { var el = $('ex-' + k); if (el) el.classList.toggle('scanned', !!sc[k]); });
  }
  function fitExNotes() {                              // grow the instructions box to show all of it
    var ta = $('ex-instructions');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(76, ta.scrollHeight + 2) + 'px';
  }
  function focusEx(id) {
    var el = $(id);
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    var r = el.getBoundingClientRect();
    if (r.top < 120 || r.bottom > window.innerHeight - 110) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function refreshEx() {
    var c = exCounts(), cnt = $('exCount'), eb = $('exEdit');
    if (cnt) cnt.textContent = c.exercises ? c.exercises + (c.exercises === 1 ? ' exercise' : ' exercises') + (c.sections ? ' · ' + c.sections + (c.sections === 1 ? ' section' : ' sections') : '') : '';
    if (eb) eb.hidden = !state.ex.items.length;        // Edit only once there are rows
    syncCard(null);
    renderExSummary(c);
    saveDraft();
  }
  function renderExSummary(c) {
    var why = c.exercises ? '' : 'Add at least one exercise to create the handout.';
    var cols = exColumns(), later = EX_DETAIL.filter(function (f) { return cols.indexOf(f) < 0; }).map(function (f) { return EX_LABEL[f]; });
    var laterText = later.length ? (later.length > 1 ? later.slice(0, -1).join(', ') + ' and ' + later[later.length - 1] : later[0]) + (later.length > 1 ? ' are' : ' is') + ' added when used.' : '';
    els.summary.innerHTML = '<div class="sum ex-sum"><div class="sum-scroll"><h2>Exercise handout</h2><p class="against">A branded PDF for the patient to take home.</p>' +
      '<div class="tally ex-tally"><div><b>' + c.sections + '</b><span>' + (c.sections === 1 ? 'Section' : 'Sections') + '</span></div>' +
      '<div><b>' + c.exercises + '</b><span>' + (c.exercises === 1 ? 'Exercise' : 'Exercises') + '</span></div></div>' +
      '<h3>Handout columns</h3><p class="ex-colsline">' + esc(cols.map(function (f) { return EX_LABEL[f]; }).join(' · ')) + '</p>' +
      (laterText ? '<p class="fine">' + esc(laterText) + '</p>' : '') +
      '</div><div class="sum-foot"><button type="button" class="primary make" data-action="report"' + (why ? ' disabled' : '') + '>Create handout</button>' +
      '<p class="fine">' + esc(why || 'Preview, then share or save.') + '</p>' +
      '<p class="fine client-line">Kept until Clear all, not in client records.</p></div></div>';
    els.dock.innerHTML = '<div class="dt"><span class="ex-dock"><b>' + c.exercises + '</b> ' + (c.exercises === 1 ? 'exercise' : 'exercises') +
      (c.sections ? ' · <b>' + c.sections + '</b> ' + (c.sections === 1 ? 'section' : 'sections') : '') + '</span></div>' +
      '<button type="button" class="primary" data-action="report"' + (why ? ' disabled' : '') + '>Create handout</button>';
    els.dock.classList.remove('has-check');
  }

  // ---- editing
  function onExInput(el) {
    var x = state.ex;
    if (el.dataset.meta) { x.meta[el.dataset.meta] = el.value; refreshEx(); return; }
    if (el.dataset.ex) {                               // the title or the general instructions
      x[el.dataset.ex] = el.value;
      if (x.scanned[el.dataset.ex]) { delete x.scanned[el.dataset.ex]; el.classList.remove('scanned'); }
      if (el.id === 'ex-instructions') fitExNotes();
      refreshEx();
      return;
    }
    var row = el.closest('.ex-row'), it = row && exItem(row.dataset.id), f = el.dataset.f;
    if (!it || !f) return;
    if (el.tagName === 'TEXTAREA' && /[\r\n]/.test(el.value)) {    // one line: a pasted line break becomes a space
      var at = el.selectionStart;
      el.value = el.value.replace(/\s*[\r\n]+\s*/g, ' ');
      try { el.setSelectionRange(Math.min(at, el.value.length), Math.min(at, el.value.length)); } catch (e) { /* not focused */ }
    }
    if (el.tagName === 'TEXTAREA') { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }
    it[f] = el.value;
    if (x.scanned[it.id]) { delete x.scanned[it.id]; row.classList.remove('scanned'); }   // edited: checked
    if (EX_DETAIL.indexOf(f) >= 0) syncExDetails(row);
    refreshEx();
    if (it.kind === 'ex' && !blank(el.value)) foldNow('ex', true);   // the program under way: the patient card folds (v11)
  }
  function exButton(b) {
    var a = b.dataset.action, x = state.ex;
    if (a === 'ex-add' || a === 'ex-add-sec' || a === 'ex-add-in') {
      var add = a === 'ex-add-sec' ? newExSection() : newExRow(), after = a === 'ex-add-in' ? exIndex(b.dataset.after) : -1;
      if (after >= 0) x.items.splice(after + 1, 0, add); else x.items.push(add);   // into that section, or at the end
      renderExTable();
      focusEx('ex-' + add.id + '-' + (add.kind === 'ex' ? 'name' : 'heading'));
      return true;
    }
    if (a === 'ex-edit') {                             // Edit / Done (v11): the move and delete buttons on every row
      x.editing = !x.editing;
      b.textContent = x.editing ? 'Done' : 'Edit';
      var tbl = $('exTable');
      if (tbl) tbl.classList.toggle('editing', x.editing);
      fitExWraps();                                    // the name column is narrower while editing
      return true;
    }
    if (!a || a.indexOf('ex-') !== 0) return false;
    var row = b.closest('.ex-row'), i = row ? exIndex(row.dataset.id) : -1;
    if (i < 0) return true;
    var it = x.items[i];
    if (a === 'ex-up' || a === 'ex-down') {
      var j = a === 'ex-up' ? i - 1 : i + 1;
      if (j < 0 || j >= x.items.length) return true;
      x.items[i] = x.items[j]; x.items[j] = it;
      renderExTable();
      var same = $('ex-' + it.id + (a === 'ex-up' ? '-up' : '-down'));   // keep the place, so a second tap moves it again
      focusEx(same && !same.disabled ? same.id : 'ex-' + it.id + (a === 'ex-up' ? '-down' : '-up'));
      return true;
    }
    if (a === 'ex-del') {                              // no confirm: Undo in the message puts it back (v11)
      var label = exRowLabel(it, i), wasScanned = !!x.scanned[it.id], list = x.items;
      x.items.splice(i, 1);
      delete x.scanned[it.id];
      renderExTable();
      var next = x.items[i];                           // the row that took its place, else + Exercise
      focusEx(next ? 'ex-' + next.id + '-del' : 'exAdd');
      toast('Deleted ' + label, { label: 'Undo', run: function () { undoExDelete(x, list, it, i, wasScanned); } });
      return true;
    }
    if (a === 'ex-more') {
      it.open = !it.open;
      renderExTable();
      focusEx('ex-' + it.id + '-more');
      return true;
    }
    return false;
  }
  // what the Undo message calls a deleted row: its name or heading, else "exercise 3" / "section 2"
  function exRowLabel(it, i) {
    var own = clean1(it.kind === 'section' ? it.heading : it.name), n = 0;
    if (own) return own;
    for (var j = 0; j <= i; j++) if (state.ex.items[j].kind === it.kind) n++;
    return (it.kind === 'section' ? 'section ' : 'exercise ') + n;
  }
  // Undo a delete: the row back at its old place with the same id, unless Clear all, a scan or its Undo replaced the program since
  function undoExDelete(prog, list, it, at, wasScanned) {
    if (state.ex !== prog || prog.items !== list || exIndex(it.id) >= 0) return;
    list.splice(Math.min(at, list.length), 0, it);
    if (wasScanned) prog.scanned[it.id] = true;
    if (state.tool !== 'ex') { saveDraft(); return; }
    renderExTable();
    var del = $('ex-' + it.id + '-del');               // keep the place without opening the keyboard
    if (del && del.getClientRects().length) focusEx(del.id);
    else if (it.kind === 'ex') focusEx('ex-' + it.id + '-more');
  }

  // ---- the handout
  function buildHandout() {
    var x = state.ex;
    if (!exCounts().exercises) return null;
    var groups = [], cur = null;
    x.items.forEach(function (it) {
      if (it.kind === 'section') { if (!blank(it.heading)) { cur = { heading: clean1(it.heading), rows: [] }; groups.push(cur); } return; }
      if (!exFilled(it)) return;
      if (!cur) { cur = { heading: '', rows: [] }; groups.push(cur); }
      var r = {};
      EX_FIELDS.forEach(function (f) { r[f] = clean1(it[f]); });
      cur.rows.push(r);
    });
    var m = x.meta, name = clean1(m.name);
    return {
      file: name ? name.replace(/[\\/:*?"<>|]+/g, '-').replace(/ /g, '_') + '_exercises.pdf' : 'exercises.pdf',
      rep: window.BHReport.exercises({
        meta: { name: name, date: E.displayIso(m.date), practitioner: clean1(m.practitioner) },
        title: clean1(x.title), instructions: String(x.instructions || '').trim(),
        groups: groups.filter(function (g) { return g.rows.length; })
      })
    };
  }

  // ---- Scan exercise page: the photos go to Claude with this prompt and schema (and nothing from the patient card)
  var EX_SCAN_DEFAULT = {
    effort: 'medium', max_tokens: 8000, timeout_s: 120, max_edge: 2000, max_photos: 6,
    system: [
      'You read exercise programs from photos taken at BASE Health Noosa, a sports physiotherapy clinic in Queensland, Australia. The photos are a physiotherapist’s handwritten exercise program for a patient. Your answer fills a table that the practitioner checks and then prints as a handout for the patient.',
      'Do your best with what is written. Any of sets, reps, load, rest, tempo, side or notes may be missing for an exercise: leave those fields as empty strings. Never invent exercises or values, and never fill in anything that is not written on the page. Keep the exercises in the order they are written.',
      'Tidy each exercise name into a clear, full name in sentence case, expanding common shorthand: SL = single-leg, DL = deadlift, BW = body weight, DB = dumbbell, KB = kettlebell, BB = barbell, TB = TheraBand, ecc = eccentric, iso = isometric, ext = extension, flex = flexion, and other standard abbreviations like these. Well-known exercise names that are normally written as initials, such as RDL, stay as they are. Keep the equipment and variations that are written (for example "SL RDL" becomes "Single-leg RDL" and "KB swing" becomes "Kettlebell swing"). When you are not sure what a piece of shorthand means, keep it exactly as written and add a note to unclear.',
      'Read the usual notation: "3x10" is sets 3 and reps 10; "3 x 8-12" is reps "8–12" (with an en dash); "3 x 30s" is reps "30 s"; "@20kg" or "20kg" is load "20 kg"; "BW" as a load is "Body weight"; "e/s", "ea side" or "each leg" is side "Each side", and "L only" is side "Left" ("R only" is "Right"); "r 90s" or "90s rest" is rest "90 s"; a tempo such as "3-1-1" is tempo, copied as written. Other short cues for an exercise (for example "slow lowering" or "keep hips level") go in its notes.',
      'Copy numbers exactly as written: don’t round, total or convert them. Keep units as written (don’t convert lb to kg or minutes to seconds), with a space between a number and its unit (20 kg, 30 s, 2 min).',
      'Section headings on the page (for example Warm-up, Day A, Day B, Gym or Home) become sections, in order, each holding the exercises written under it. If the page has no headings, return one section with an empty heading holding every exercise.',
      'Instructions for the whole program rather than one exercise (for example "3x/week" or "ice after") go in the top-level notes, written out plainly (for example "3 times a week. Ice after."). A title for the whole program, if one is written, goes in title; otherwise title is an empty string.',
      'Ignore names and any other personal details on the page (the patient’s name, date of birth, phone number or address) and never include them in your answer.',
      'Put a short note in unclear for anything that is hard to read or ambiguous, naming the exercise it is about (for example "Step-up: 10 or 16 reps?"), and for any shorthand kept as written. Leave unclear empty when everything is clear.'
    ]
  };
  function exScanCfg() {                               // same model, key and endpoint as the interpretation; "exercise_scan" in interpretation.json overrides
    var cfg = Object.assign({}, EX_SCAN_DEFAULT), ai = DATA.ai || {};
    cfg.model = ai.model; cfg.endpoint = ai.endpoint;
    if (ai.exercise_scan && typeof ai.exercise_scan === 'object') Object.keys(ai.exercise_scan).forEach(function (k) { cfg[k] = ai.exercise_scan[k]; });
    return cfg;
  }
  function exScanRequest(n) {
    return 'Turn the handwritten exercise program in ' + (n > 1 ? 'these ' + n + ' photos (pages in order)' : 'this photo') +
      ' into the table format: the title and general instructions if written, then each section in the order written, with its exercises. Use an empty string for anything that isn’t written.';
  }
  function exScanSchema() {
    var str = { type: 'string' }, ex = { type: 'object', properties: {}, required: EX_FIELDS.slice(), additionalProperties: false };
    EX_FIELDS.forEach(function (f) { ex.properties[f] = str; });
    return {
      type: 'object',
      properties: {
        title: str, notes: str,
        sections: { type: 'array', items: { type: 'object', properties: { heading: str, exercises: { type: 'array', items: ex } }, required: ['heading', 'exercises'], additionalProperties: false } },
        unclear: { type: 'array', items: str }
      },
      required: ['title', 'notes', 'sections', 'unclear'],
      additionalProperties: false
    };
  }
  // a value from Claude, tidied: no emoji or invisible characters, one line (the instructions keep their line breaks),
  // a lone dash or "n/a" counts as not written, and nothing longer than the box allows
  function exTidy(v, f) {
    var s = String(v == null ? '' : v);
    if (s.normalize) s = s.normalize('NFC');
    s = s.replace(/[\uD800-\uDFFF]/g, '').replace(/[\uFE0F\u200B-\u200D\u2060\uFEFF]/g, '');
    s = f === 'instructions' ? s.replace(/\r\n?/g, '\n').replace(/[ \t\u00A0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      : s.replace(/\s+/g, ' ').trim();
    if (/^(?:[-–—]+|n\/?a)$/i.test(s)) return '';
    var max = EX_LEN[f] || 60;
    return s.length > max ? s.slice(0, max).trim() : s;
  }
  // replace the table with the scanned one (the title and instructions only when found); Undo puts back exactly what was there
  function applyExScan(out, photos) {
    var x = state.ex, found = [], n = 0;
    (out && Array.isArray(out.sections) ? out.sections : []).forEach(function (sec) {
      if (!sec || typeof sec !== 'object') return;
      var rows = (Array.isArray(sec.exercises) ? sec.exercises : []).map(function (e) {
        var r = {};
        EX_FIELDS.forEach(function (f) { r[f] = exTidy(e && typeof e === 'object' ? e[f] : '', f); });
        return r;
      }).filter(function (r) { return EX_FIELDS.some(function (f) { return r[f]; }); });
      if (!rows.length) return;
      var h = exTidy(sec.heading, 'heading');
      if (h) found.push({ heading: h });
      rows.forEach(function (r) { found.push({ row: r }); n++; });
    });
    var unclear = (out && Array.isArray(out.unclear) ? out.unclear : []).map(function (u) { return clean1(u); }).filter(Boolean).slice(0, 12);
    if (!n) { scanInfo = { tool: 'ex', kind: 'empty', n: 0, photos: photos, unclear: unclear, undo: null }; return; }
    var before = { title: x.title, instructions: x.instructions, items: JSON.parse(JSON.stringify(x.items)), scanned: Object.assign({}, x.scanned), seq: x.seq };
    var marks = {};
    x.items = found.map(function (f) { var it = f.heading ? newExSection(f.heading) : newExRow(f.row); marks[it.id] = true; return it; });
    var title = exTidy(out.title, 'title'), notes = exTidy(out.notes, 'instructions');
    if (title) { x.title = title; marks.title = true; } else if (x.scanned.title) marks.title = true;
    if (notes) { x.instructions = notes; marks.instructions = true; } else if (x.scanned.instructions) marks.instructions = true;
    x.scanned = marks;
    scanInfo = { tool: 'ex', kind: 'done', n: n, photos: photos, unclear: unclear, undo: before };
  }
  function showExScan() {                              // redraw the program without touching the patient card (its keyboard stays put)
    var x = state.ex, ti = $('ex-title'), tx = $('ex-instructions');
    if (ti && ti.value !== x.title) ti.value = x.title;
    if (tx && tx.value !== x.instructions) { tx.value = x.instructions; fitExNotes(); }
    renderExTable();
  }
  function undoExScan() {
    var u = scanInfo && scanInfo.tool === 'ex' && scanInfo.undo, x = state.ex;
    if (!u) return;
    x.title = u.title; x.instructions = u.instructions; x.items = u.items; x.scanned = u.scanned;
    x.seq = Math.max(x.seq, u.seq);                    // ids are never reused
    scanInfo = null;
    render();
    toast('Scan undone');
  }

  // ------------------------------------------------------------------ client records
  // Each PDF created saves that session under the client's name: on this device only (local mode), or in the clinic
  // store with a full copy cached on the device (v13, cloud mode: `clients` is then the cache from cloud.js, and every
  // save is queued for Firestore too). Next time the name is typed, the saved client is offered; loading fills the
  // Previous results per metric from the most recent earlier session where that metric was tested, and the report gets
  // a Progress table.
  var HIST = 'bh-athlete-report-clients-v1';
  var clients = { v: 1, clients: {} };
  var SCORE_UNITS = { xBW: '× BW', xBWf: '× BW', pctBW: '% BW', Nkg: 'N/kg', reps: 'reps', ratio: '' };
  var PREFILL = { screen: ['sex', 'age', 'sport', 'tester'], str: ['sport', 'tester'], ham: ['injured', 'doi', 'clinician', 'sport'], acl: ['injured', 'dos', 'graft', 'surgeon', 'sport'] };
  var SAME_TOOL_ONLY = { injured: true, doi: true, dos: true, graft: true, surgeon: true, clinician: true };
  function loadLocalClients() {                        // the records kept on this device (local mode; before v13 in cloud mode)
    try {
      var c = JSON.parse(localStorage.getItem(HIST));
      if (c && c.v === 1 && c.clients && typeof c.clients === 'object') return c;
    } catch (e) { /* none saved */ }
    return { v: 1, clients: {} };
  }
  function loadClients() { return CLOUD ? CLOUD.cache : loadLocalClients(); }
  function saveClients() {
    if (CLOUD) return CLOUD.saveCache();
    try { localStorage.setItem(HIST, JSON.stringify(clients)); } catch (e) { return false; }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e2) { /* optional */ }
    return true;
  }
  function recordWord() { return CLOUD ? 'clinic record' : 'client record'; }
  function clientFor(name) { var k = E.nameKey(name); return k ? clients.clients[k] || null : null; }
  function currentResults(t, c) {
    var out = {};
    if (t === 'str') {
      c.tests.forEach(function (tt) {
        ['L', 'R'].forEach(function (k) { var cell = tt.sides[k]; if (cell && cell.value !== null) out[tt.id + '|' + k] = cell.value; });
      });
    } else {
      E.flatten(c.groups).forEach(function (r) { var n = E.num(r.result); if (n !== null) out[r.name] = n; });
    }
    return out;
  }
  function compactValues(t) {
    var src = state[t].values, out = {};
    Object.keys(src).forEach(function (k) {
      var v = src[k] || {}, o = {};
      ['result', 'previous', 'side', 'left', 'right'].forEach(function (f) { if (!blank(v[f])) o[f] = String(v[f]).trim(); });
      if (Object.keys(o).length) out[k] = o;
    });
    return out;
  }
  function saveSession(t, c) {
    var m = state[t].meta, name = String(m.name || '').trim(), key = E.nameKey(name);
    if (!key) return null;
    var date = m.date || todayIso(), meta = {};
    Object.keys(m).forEach(function (k) { if (k !== 'name' && !blank(m[k])) meta[k] = String(m[k]).trim(); });
    if (t === 'screen') meta.pop = state.screen.pop;
    if (t === 'ham' || t === 'acl') meta.phase = state[t].phase;
    if (t === 'acl') meta.normSex = state.acl.sex;
    var co = state[t].coach;                          // kept with the session, never filled back in from records
    if (coachSet(co)) meta.coach = { status: co.status, mods: String(co.mods || '').trim(), retest: co.retest };
    var sess = { tool: t, date: date, savedAt: new Date().toISOString(), meta: meta, values: compactValues(t), results: currentResults(t, c),
      mass: E.parseInput(m.mass), interp: blank(state[t].interp.text) ? '' : String(state[t].interp.text).trim() };
    if (userName()) sess.savedBy = userName();         // v13: who saved it (the practitioner's name on this device)
    var cl = clients.clients[key] || (clients.clients[key] = { name: name, sessions: [] });
    cl.name = name;
    var replaced = false, old = null;
    cl.sessions = cl.sessions.filter(function (x) { if (x.tool === t && x.date === date) { replaced = true; old = x; return false; } return true; });
    cl.sessions.push(sess);
    cl.sessions = E.sortSessions(cl.sessions);
    var ok = saveClients();
    if (CLOUD) {                                       // to the clinic store: the version being replaced goes to history first
      if (old) CLOUD.historyCopy(key, name, old);
      CLOUD.putSession(key, name, sess);
      CLOUD.sync();
    }
    return { ok: ok, name: name, replaced: replaced, count: cl.sessions.length };
  }
  function earlierCount(cl, t, date) {
    return cl ? cl.sessions.filter(function (x) { return x.tool === t && x.date < date; }).length : 0;
  }
  // fill Previous results (and unchanging details) from the client's record. picked: chosen in Choose client (v11), which
  // folds the details card once the essentials are in; otherwise it folds when earlier results were loaded (never under a
  // box being typed in, e.g. a name suggestion tapped)
  function loadHistory(t, key, picked) {
    var cl = clients.clients[key];
    if (!cl) return;
    var s = state[t], m = s.meta, date = m.date || todayIso();
    m.name = cl.name;
    var all = E.sortSessions(cl.sessions);
    for (var j = all.length - 1; j >= 0; j--) {          // the comparison set used last time for this tool
      var ms = all[j].meta || {};
      if (all[j].tool !== t) continue;
      if (t === 'acl' && ms.normSex && DATA.acl.sexes.indexOf(ms.normSex) >= 0) s.sex = ms.normSex;
      if (t === 'screen' && ms.pop) s.pop = ms.pop;
      break;
    }
    PREFILL[t].forEach(function (f) {
      if (!blank(m[f])) return;
      for (var i = all.length - 1; i >= 0; i--) {
        // injury details belong to that injury: an ACL test never takes the injured side from a hamstring record
        if (SAME_TOOL_ONLY[f] && all[i].tool !== t) continue;
        var v = all[i].meta && all[i].meta[f];
        if (!blank(v)) { m[f] = v; break; }
      }
    });
    var n = 0, dates = {};
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        if (tt.input === 'calc') return;
        var v = val('str', tt.id), got = false;
        v.prevLeft = ''; v.prevRight = ''; v.prevMass = ''; v.prevDate = '';
        [['left', 'L', 'prevLeft'], ['right', 'R', 'prevRight']].forEach(function (sd) {
          var p = E.previousFor(cl.sessions, 'str', tt.id + '|' + sd[1], date);
          var raw = p && p.session.values && p.session.values[tt.id];
          if (!p || !raw || blank(raw[sd[0]])) return;
          v[sd[2]] = raw[sd[0]]; v.prevMass = p.mass == null ? '' : String(p.mass); v.prevDate = p.date;
          got = true; dates[p.date] = 1;
        });
        if (got) n++;
      });
    } else {
      DATA[t].groups.forEach(function (g) {
        g.metrics.forEach(function (mm) {
          var v = val(t, mm.name), p = E.previousFor(cl.sessions, t, mm.name, date);
          v.prevEdit = false;
          if (!p) {
            if (v.prevDate) v.previous = '';           // a value from an earlier load (e.g. another client) goes; typed ones stay
            v.prevDate = '';
            return;
          }
          var raw = p.session.values && p.session.values[mm.name];
          v.previous = raw && !blank(raw.result) ? raw.result : String(p.value);
          v.prevDate = p.date; n++; dates[p.date] = 1;
        });
      });
    }
    if (!s.hist || s.hist.key !== key) s.onlyPrev = false;   // "Only last time's tests" starts off for a different client
    s.hist = { key: key, name: cl.name, n: n, dates: Object.keys(dates).sort(), date: date };
    hideSuggest();
    if (picked || n) foldBeforeRender(t);
    render();
    toast(n ? 'Loaded ' + cl.name + ': previous results for ' + n + (n === 1 ? ' test' : ' tests') : cl.name + ': no earlier ' + TOOL_NAMES[t] + ' results; details filled in');
  }
  function pickClient(key) { loadHistory(state.tool, key); }
  function suggestClients(t, typed) {
    var box = $(t + '-name-sugg');
    if (!box) return;
    var k = E.nameKey(typed), list = [];
    if (k) Object.keys(clients.clients).forEach(function (key) { if (key !== k && key.indexOf(k) >= 0) list.push(key); });
    list.sort(function (a, b) { return clients.clients[a].name.localeCompare(clients.clients[b].name); });
    list = list.slice(0, 6);
    if (!list.length) { hideSuggest(); return; }
    box.innerHTML = list.map(function (key) {
      var cl = clients.clients[key], last = cl.sessions.length ? cl.sessions[cl.sessions.length - 1].date : '';
      return '<button type="button" data-client="' + esc(key) + '"><b>' + esc(cl.name) + '</b><span>' + cl.sessions.length + (cl.sessions.length === 1 ? ' session' : ' sessions') +
        (last ? ' · last ' + esc(E.displayIso(last)) : '') + '</span></button>';
    }).join('');
    box.hidden = false;
  }
  function hideSuggest() {
    els.entry.querySelectorAll('.suggest').forEach(function (b) { b.hidden = true; b.innerHTML = ''; });
  }
  function refreshClientBar(c) {
    var t = state.tool, s = state[t], bar = $('clientBar');
    if (!bar) return;
    var key = E.nameKey(s.meta.name), cl = key ? clients.clients[key] : null, date = s.meta.date || todayIso();
    var h = s.hist;
    if (cl && h && h.key === key) {
      bar.hidden = false; bar.className = 'client-bar loaded';
      var on = retest.on && retest.tool === t;
      bar.innerHTML = '<b>' + esc(cl.name) + '</b>' + (h.n
        ? ' — previous results loaded from ' + esc(h.dates.map(E.displayIso).join(', ')) + ' (' + h.n + (h.n === 1 ? ' test' : ' tests') + ')'
        : ' — no earlier ' + TOOL_NAMES[t] + ' sessions; details filled in') +
        (h.date !== date ? ' <button type="button" class="quiet" data-action="reload-history">Reload for this date</button>' : '') +
        (h.n ? ' <button type="button" class="quiet retest" data-action="retest">' + (on ? 'Show all tests' : 'Only last time’s tests') + '</button>' +
          (on ? '<span class="retest-n">Showing ' + retest.n + ' of ' + retest.total + ' tests</span>' : '') : '');
    } else if (cl) {
      var earlier = earlierCount(cl, t, date), total = cl.sessions.length;
      bar.hidden = false; bar.className = 'client-bar';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> has ' + total + (total === 1 ? ' saved session' : ' saved sessions') +
        (earlier ? ', ' + earlier + ' earlier ' + TOOL_NAMES[t] + '. ' : ', none earlier for ' + TOOL_NAMES[t] + '. ') +
        '<button type="button" class="quiet" data-action="load-history" data-client="' + esc(key) + '">' + (earlier ? 'Load previous results' : 'Fill in details') + '</button>';
    } else { bar.hidden = true; bar.innerHTML = ''; }
  }
  function clientLine(t) {
    var name = String(state[t].meta.name || '').trim(), cl = clientFor(name);
    if (!name) return 'Add a name to save this session to a ' + recordWord() + '.';
    var date = state[t].meta.date || todayIso();
    // one line each (v11); the client bar in the details card says how many sessions there are
    var where = CLOUD ? '’s clinic record.' : '’s client record on this device.';
    if (!cl) return 'Saves to ' + name + where;
    var same = cl.sessions.some(function (x) { return x.tool === t && x.date === date; });
    return same ? 'Updates ' + cl.name + '’s ' + recordWord() + ' for this date.' : 'Saves to ' + cl.name + where;
  }
  function progressData(t, c) {
    var m = state[t].meta, cl = clientFor(m.name);
    if (!cl) return null;
    var p = E.progress(cl.sessions, t, { date: m.date || todayIso(), results: currentResults(t, c) }, 5);
    if (!p.rows.length) return null;
    var label = {}, unit = {}, dir = {};
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        ['L', 'R'].forEach(function (k) { var id = tt.id + '|' + k; label[id] = tt.name + ' — ' + (k === 'L' ? 'Left' : 'Right'); unit[id] = SCORE_UNITS[tt.score] || ''; dir[id] = tt.dir || 'Higher'; });
      });
    } else {
      DATA[t].groups.forEach(function (g) { g.metrics.forEach(function (mm) { label[mm.name] = mm.name; unit[mm.name] = mm.unit || ''; dir[mm.name] = mm.dir || ''; }); });
    }
    return {
      dates: p.dates.map(E.displayIso), sessions: p.sessions,
      rows: p.rows.map(function (r) { return { name: label[r.metric] || r.metric, unit: unit[r.metric] || '', dir: dir[r.metric] || '', values: r.values, first: r.first, last: r.last }; })
    };
  }
  // The Clients dialog (v11), one searchable list in two modes. pick (Choose client, in the details card): each row is a
  // button that loads that client, plus New client. manage (the header's Clients button): the rows with a two-tap Delete.
  // Back up and Restore are in the ⋯ menu.
  var clientsMode = 'manage';
  function openClientsDialog(mode) {
    var pick = mode === 'pick' && TOOLS.indexOf(state.tool) >= 0;
    clientsMode = pick ? 'pick' : 'manage';
    if (CLOUD) CLOUD.sync({ throttle: true });         // v13: another device may have saved something (the list redraws when it lands)
    els.clientsSearch.value = '';
    els.clientsTitle.textContent = pick ? 'Choose client' : 'Clients';
    els.clientsNew.hidden = !pick;
    els.clientsClose.textContent = pick ? 'Cancel' : 'Done';
    els.clientsClose.className = pick ? 'ghost' : 'primary';
    els.clientsFine.hidden = pick;
    renderClientsList();
    // no box focused at first (the iPad keyboard would cover the list): the first client, else New client / Done
    openModal(els.clientsDialog, pick ? els.clientsList.querySelector('.cl-pick') || els.clientsNew : els.clientsClose);
  }
  function clientKeys() {
    return Object.keys(clients.clients).sort(function (a, b) { return clients.clients[a].name.localeCompare(clients.clients[b].name); });
  }
  function clientDetail(cl) {                          // 'Last test 29 Sep 2026 · Screening, LL Strength'
    var last = '', used = {};
    cl.sessions.forEach(function (x) { if (x.date > last) last = x.date; used[x.tool] = 1; });
    var tools = TOOLS.filter(function (t) { return used[t]; }).map(function (t) { return TOOL_NAMES[t]; }).join(', ');
    return [last ? 'Last test ' + E.displayIso(last) : '', tools].filter(Boolean).join(' · ') || 'No sessions';
  }
  function renderClientsList() {
    var keys = clientKeys(), total = 0, pick = clientsMode === 'pick', typed = els.clientsSearch.value.trim(), q = E.nameKey(typed);
    keys.forEach(function (k) { total += clients.clients[k].sessions.length; });
    els.clientsSummary.textContent = !keys.length ? 'No saved clients yet. A record starts when you create a report with a name filled in.'
      : pick ? 'Loading a client fills in their details and their results from last time.'
        : keys.length + (keys.length === 1 ? ' client, ' : ' clients, ') + total + (total === 1 ? ' session' : ' sessions') + (CLOUD ? ', in the clinic store.' : ', saved on this device.');
    els.clientsSearchWrap.hidden = !keys.length;
    var shown = q ? keys.filter(function (k) { return k.indexOf(q) >= 0; }) : keys;
    if (!keys.length) { els.clientsList.innerHTML = ''; return; }
    if (!shown.length) { els.clientsList.innerHTML = '<p class="client-none" role="status">No clients match “' + esc(typed) + '”.</p>'; return; }
    els.clientsList.innerHTML = '<ul class="client-list' + (pick ? ' pick' : '') + '">' + shown.map(function (k) {
      var cl = clients.clients[k], d = '<b>' + esc(cl.name) + '</b><span>' + esc(clientDetail(cl)) + '</span>';
      return pick ? '<li><button type="button" class="cl-pick" data-action="pick-client" data-key="' + esc(k) + '">' + d + '</button></li>'
        : '<li><div class="cl-main">' + d + '</div><button type="button" class="quiet cl-del" data-action="delete-client" data-key="' + esc(k) + '">Delete</button></li>';
    }).join('') + '</ul>';
  }
  // a client chosen: the name and the existing load (details and previous results), then the card folds if it can
  function pickFromDialog(key) {
    var t = state.tool;
    closeModal(false);
    if (TOOLS.indexOf(t) < 0 || !clients.clients[key]) return;
    loadHistory(t, key, true);
    focusQuiet(state[t].cardOpen === false ? document.querySelector('#athleteStrip [data-action="edit-athlete"]') : document.querySelector('#athleteCard [data-action="choose-client"]'));
  }
  function newClient() {                               // New client: the name box emptied and ready to type in
    var t = state.tool;
    closeModal(false);
    if (TOOLS.indexOf(t) < 0) return;
    state[t].meta.name = '';
    if (state[t].cardOpen === false) setCardOpen(t, true);
    var box = $(t + '-name');
    if (box) box.value = '';
    refresh();
    if (box) box.focus();
  }
  var delTimer = null;
  function onClientsClick(e) {
    var pk = e.target.closest('button[data-action="pick-client"]');
    if (pk) { pickFromDialog(pk.dataset.key); return; }
    var b = e.target.closest('button[data-action="delete-client"]');
    if (!b) return;
    var key = b.dataset.key;
    if (!b.classList.contains('armed')) {
      els.clientsList.querySelectorAll('.cl-del.armed').forEach(function (x) { x.classList.remove('armed'); x.textContent = 'Delete'; });
      b.classList.add('armed'); b.textContent = 'Tap again to delete';
      clearTimeout(delTimer);
      delTimer = setTimeout(function () { b.classList.remove('armed'); b.textContent = 'Delete'; }, 4000);
      return;
    }
    clearTimeout(delTimer);
    var cl = clients.clients[key], name = cl ? cl.name : key;
    delete clients.clients[key];
    saveClients();
    if (CLOUD && cl) {                                 // v13: a tombstone per session (the data stays in the store, hidden)
      cl.sessions.forEach(function (x) { CLOUD.tombstone(key, cl.name, x); });
      CLOUD.sync();
    }
    renderClientsList();
    refresh();
    toast('Deleted ' + name + '’s record');
  }
  function backupClients() {
    if (!Object.keys(clients.clients).length) { toast('No client records to back up yet'); return; }
    var name = 'BASE_Health_client_records_' + todayIso() + '.json';
    var blob = new Blob([JSON.stringify({ v: 1, clients: clients.clients }, null, 1)], { type: 'application/json' });   // the same file either mode
    var file = new File([blob], name, { type: 'application/json' });
    if (canShare(file)) {
      navigator.share({ files: [file], title: 'BASE Health client records' }).catch(function (err) { if (err && err.name !== 'AbortError') downloadBlob(blob, name); });
    } else downloadBlob(blob, name);
  }
  // records from elsewhere (a backup file, or this device's pre-v13 records) merged in: a session is added when the client
  // has none for that tool and date, replaced when the incoming one was saved later, skipped otherwise. In cloud mode
  // every session added or replaced is queued for the store (the replaced version goes to history first).
  function mergeRecords(data) {
    var added = 0, updated = 0, fresh = 0;
    Object.keys(data.clients).forEach(function (k) {
      var src = data.clients[k];
      if (!src || !Array.isArray(src.sessions)) return;
      var key = E.nameKey(src.name || k);
      if (!key) return;
      var cl = clients.clients[key];
      if (!cl) { cl = clients.clients[key] = { name: String(src.name || k), sessions: [] }; fresh++; }
      src.sessions.forEach(function (x) {
        if (!x || !x.tool || !x.date) return;
        var i = -1;
        cl.sessions.forEach(function (y, j) { if (y.tool === x.tool && y.date === x.date) i = j; });
        if (i < 0) { cl.sessions.push(x); added++; }
        else if ((x.savedAt || '') > (cl.sessions[i].savedAt || '')) { if (CLOUD) CLOUD.historyCopy(key, cl.name, cl.sessions[i]); cl.sessions[i] = x; updated++; }
        else return;
        if (CLOUD) CLOUD.putSession(key, cl.name, x);
      });
      cl.sessions = E.sortSessions(cl.sessions);
    });
    return { added: added, updated: updated, fresh: fresh };
  }
  function restoreClients(fileList) {
    var f = fileList && fileList[0];
    if (!f) return;
    f.text().then(function (text) {
      var data = JSON.parse(text);
      if (!data || data.v !== 1 || !data.clients || typeof data.clients !== 'object') throw new Error('that isn’t a BASE Health client backup');
      var r = mergeRecords(data), added = r.added, updated = r.updated, fresh = r.fresh;
      if (!saveClients()) throw new Error('this device wouldn’t save the records');
      if (CLOUD) CLOUD.sync();
      renderClientsList();
      refresh();
      toast('Restored: ' + added + (added === 1 ? ' session added' : ' sessions added') + (updated ? ', ' + updated + ' updated' : '') + (fresh ? ', ' + fresh + (fresh === 1 ? ' new client' : ' new clients') : ''));
    }).catch(function (err) { toast('Couldn’t restore: ' + (err && err.message ? err.message : 'unreadable file')); });
  }

  // ------------------------------------------------------------------ the clinic store (v13, cloud mode only)
  // One clinic login on every device (cloud.js does the talking). Signed out: the sign-in card in place of the workspace.
  // Signed in: the records are the cache, every save is queued and pushed, a pull brings the other devices' saves, the
  // slim bar under the app bar says when results are waiting to upload, and the ⋯ menu shows who is signed in.
  var signinBusy = false, legacyAsked = false;
  function signinError(msg) {
    els.signinErr.textContent = msg || '';
    els.signinErr.hidden = !msg;
  }
  function signinMessage(err) {
    var c = err && err.code ? String(err.code) : '';
    if (c === 'INVALID_LOGIN_CREDENTIALS' || c === 'EMAIL_NOT_FOUND' || c === 'INVALID_PASSWORD' || c === 'INVALID_EMAIL' || c === 'MISSING_PASSWORD') return 'That email or password isn’t right.';
    if (c === 'TOO_MANY_ATTEMPTS_TRY_LATER') return 'Too many attempts. Wait a few minutes and try again.';
    if (c === 'network') return 'You’re offline. Connect to the internet to sign in for the first time.';
    return 'Couldn’t sign in (' + (err && err.message ? err.message : (c || 'unknown error')) + ').';
  }
  function signinBusySet(on) {
    signinBusy = on;
    els.signinBtn.disabled = on;
    els.signinBtn.textContent = on ? 'Signing in…' : 'Sign in';
  }
  function showSignIn(msg) {
    closeMenu(false);
    closeModal(false);
    if (!els.sheet.hidden) closeReport();
    document.documentElement.classList.add('signed-out');
    els.signin.hidden = false;
    els.signinName.value = userName();
    els.signinPassword.value = '';
    signinBusySet(false);
    signinError(msg || '');
    renderCloudBar();
    measureBar();
    window.scrollTo(0, 0);
    focusQuiet(els.signinEmail.value ? els.signinPassword : els.signinEmail);
  }
  function showApp() {
    document.documentElement.classList.remove('signed-out');
    els.signin.hidden = true;
    signinError('');
    renderMenuAccount();
    renderCloudBar();
    measureBar();
  }
  function onSignIn(e) {
    if (e) e.preventDefault();
    if (signinBusy) return;
    var email = els.signinEmail.value.trim().toLowerCase(), pw = els.signinPassword.value, name = clean1(els.signinName.value);
    if (!email) { signinError('Type the clinic email.'); els.signinEmail.focus(); return; }
    if (!pw) { signinError('Type the password.'); els.signinPassword.focus(); return; }
    if (!name) { signinError('Add your name — it’s shown on the results you save.'); els.signinName.focus(); return; }
    if (navigator.onLine === false) { signinError(signinMessage({ code: 'network' })); return; }
    signinError('');
    signinBusySet(true);
    CLOUD.signIn(email, pw).then(function () {
      var was = userName();
      CLOUD.setUserName(name);
      els.signinPassword.value = '';
      clients = CLOUD.cache;
      legacyAsked = false;
      fillPractitioner(was);
      showApp();
      render();
      window.scrollTo(0, 0);
      CLOUD.sync();
    }, function (err) {
      signinBusySet(false);
      signinError(signinMessage(err));
      focusQuiet(err && err.code === 'network' ? els.signinBtn : els.signinPassword);
    });
  }
  function togglePassword() {
    var show = els.signinPassword.type === 'password';
    els.signinPassword.type = show ? 'text' : 'password';
    els.signinShow.textContent = show ? 'Hide' : 'Show';
    els.signinShow.setAttribute('aria-pressed', String(show));
    focusQuiet(els.signinPassword);
  }
  // the ⋯ menu's account line and items (stamped from the template in cloud mode)
  function renderMenuAccount() {
    var line = $('menuAccount'), a = CLOUD.account();
    if (!line) return;
    line.innerHTML = a ? 'Signed in as <b>' + esc(a.email) + '</b> · ' + esc(userName() || 'no name yet') : '';
  }
  function openNameDialog() {
    els.nameBox.value = userName();
    els.nameErr.hidden = true;
    openModal(els.nameDialog, els.nameBox);
    try { els.nameBox.select(); } catch (e) { /* not selectable */ }
  }
  function saveName() {
    var nm = clean1(els.nameBox.value);
    if (!nm) { els.nameErr.textContent = 'Add your name.'; els.nameErr.hidden = false; els.nameBox.focus(); return; }
    var was = userName();
    CLOUD.setUserName(nm);
    closeModal();
    renderMenuAccount();
    if (fillPractitioner(was)) render();
    toast(nm === was ? 'Name unchanged' : 'Your name is now ' + nm);
  }
  function askSignOut() {
    var n = CLOUD.pendingCount();
    if (!n) { signOutNow(); return; }
    els.signOutText.textContent = n + (n === 1 ? ' result is' : ' results are') + ' still waiting to upload — sign out anyway?';
    openModal(els.signOutDialog, els.signOutCancel);
  }
  function signOutNow() {
    closeModal(false);
    CLOUD.signOut();                                   // cloud.js drops the login and the cache, then says so (onCloudChange)
  }
  // the slim bar under the app bar: waiting uploads while offline / after a failed push, or a permission refusal
  function renderCloudBar() {
    var bar = els.cloudBar;
    if (!bar) return;
    var s = CLOUD.status(), text = '', cls = 'cloud-bar';
    var n = s.pending + (s.pending === 1 ? ' result' : ' results');
    if (!CLOUD.signedIn()) text = '';
    else if (s.denied) { text = 'The clinic store refused this device (permission). Results are kept on this device until it is fixed.'; cls += ' denied'; }
    else if (s.pending && s.offline) text = 'Offline — ' + n + ' will upload when you’re back online.';
    else if (s.pending && s.failed) text = n + ' waiting to upload — the clinic store didn’t answer. The app will try again shortly.';
    var was = bar.hidden;
    bar.textContent = text;
    bar.className = cls;
    bar.hidden = !text;
    if (was !== bar.hidden) measureBar();
  }
  // records saved on this device before the clinic store: offered for upload once the first pull is in
  function maybeLegacyPrompt() {
    if (legacyAsked || !CLOUD.signedIn() || openModalEl || !els.sheet.hidden) return;
    if (clients.legacy === 'never' || clients.legacy === 'uploaded') return;
    var old = loadLocalClients(), keys = Object.keys(old.clients), n = 0;
    keys.forEach(function (k) { n += Array.isArray(old.clients[k].sessions) ? old.clients[k].sessions.length : 0; });
    if (!keys.length) return;
    legacyAsked = true;
    els.legacyText.textContent = 'This device has ' + keys.length + (keys.length === 1 ? ' client (' : ' clients (') + n + (n === 1 ? ' session)' : ' sessions)') + ' saved before the clinic store. Upload them?';
    openModal(els.legacyDialog, els.legacyUpload);
  }
  function legacyUpload() {
    var old = loadLocalClients(), r = mergeRecords(old);
    if (!saveClients()) { toast('This device wouldn’t save the records'); return; }
    try {
      var raw = localStorage.getItem(HIST);
      if (raw != null) localStorage.setItem('bh-athlete-report-clients-legacy-v1', raw);
      localStorage.removeItem(HIST);
    } catch (e) { /* storage unavailable */ }
    clients.legacy = 'uploaded';
    saveClients();
    closeModal();
    refresh();
    CLOUD.sync();
    var n = r.added + r.updated;
    toast(n ? 'Uploading ' + n + (n === 1 ? ' session' : ' sessions') + ' to the clinic store' + (r.fresh ? ' (' + r.fresh + (r.fresh === 1 ? ' new client)' : ' new clients)') : '') : 'Those records are already in the clinic store');
  }
  function legacyNever() {
    clients.legacy = 'never';
    saveClients();
    closeModal();
  }
  function onCloudChange(evt) {
    clients = CLOUD.cache;                             // a new object after a sign-out or sign-in
    if (evt.kind === 'cache') {
      if (!state) return;
      if (openModalEl === els.clientsDialog) renderClientsList();
      refresh();
    } else if (evt.kind === 'status') {
      renderCloudBar();
    } else if (evt.kind === 'uploaded') {
      renderCloudBar();
      toast('Uploaded ' + evt.n + (evt.n === 1 ? ' waiting result' : ' waiting results'));
    } else if (evt.kind === 'settings') {
      applyCloudKey(evt.key);
    } else if (evt.kind === 'synced') {
      if (state) maybeLegacyPrompt();
    } else if (evt.kind === 'signout') {
      showSignIn(evt.message || '');
    }
  }
  function initCloud() {
    if (els.accountTpl && !$('menuAccount')) els.moreMenu.insertBefore(document.importNode(els.accountTpl.content, true), els.moreMenu.firstChild);
    els.clientsFine.textContent = 'Records are kept in the clinic store and shared by every signed-in device; this device keeps a copy for when the Wi‑Fi is poor. Back up records… in the ⋯ menu still saves a file.';
    CLOUD.onChange(onCloudChange);
    els.signinForm.addEventListener('submit', onSignIn);
    els.signinShow.addEventListener('click', togglePassword);
    var nameItem = $('nameItem'), signOutItem = $('signOutItem');
    if (nameItem) nameItem.addEventListener('click', menuAction(openNameDialog));
    if (signOutItem) signOutItem.addEventListener('click', menuAction(askSignOut));
    els.nameCancel.addEventListener('click', function () { closeModal(); });
    els.nameSave.addEventListener('click', saveName);
    els.nameBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveName(); } });
    els.signOutCancel.addEventListener('click', function () { closeModal(); });
    els.signOutConfirm.addEventListener('click', signOutNow);
    els.legacyLater.addEventListener('click', function () { closeModal(); });
    els.legacyUpload.addEventListener('click', legacyUpload);
    els.legacyNever.addEventListener('click', legacyNever);
    [els.nameDialog, els.signOutDialog].forEach(function (d) { d.addEventListener('click', function (e) { if (e.target === d) closeModal(); }); });
    if (CLOUD.signedIn()) { showApp(); CLOUD.sync(); }
    else showSignIn('');
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
    // so are the metric explainers: without them the names are plain text and the PDF has no explainer lines
    var explain = fetchJson('explainers.json').catch(function () { return null; });
    Promise.all([fetchJson('norms.json'), fetchJson('hamstring_norms.json'), fetchJson('acl_norms.json'), fetchJson('strength_norms.json'), ai, explain]).then(function (r) {
      DATA.screen = r[0]; DATA.ham = r[1]; DATA.acl = r[2]; DATA.str = r[3]; DATA.ai = r[4];
      DATA.explain = r[5] && r[5].metrics && typeof r[5].metrics === 'object' ? r[5] : { metrics: {} };
      clients = loadClients();
      testsPref = loadTestsPref();
      state = loadDraft() || { v: 1, tool: 'screen', screen: freshTool('screen'), str: freshTool('str'), ham: freshTool('ham'), acl: freshTool('acl'), ex: freshEx() };
      tidyState();
      if (CLOUD && CLOUD.signedIn()) fillPractitioner('');   // v13: blank Clinician boxes take this device's practitioner name
      els.entry.addEventListener('input', onInput);
      els.entry.addEventListener('change', onChange);
      els.entry.addEventListener('click', onClick);
      els.entry.addEventListener('keydown', onKey);
      els.summary.addEventListener('click', onClick);
      els.dock.addEventListener('click', onClick);
      document.querySelector('.tools').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-section]');
        if (b) { onSectionTab(b.dataset.section); keepAwake(); }
      });
      // the tool picker (v14): arrow keys from the heading open it, the arrows move within it, a tap elsewhere closes it
      els.entry.addEventListener('keydown', function (e) {
        if (e.target.id === 'toolPick' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !pickOpen()) { e.preventDefault(); openPick(e.key === 'ArrowUp'); return; }
        if (pickOpen() && e.target.closest('#toolMenu')) onPickKey(e);
      });
      els.entry.addEventListener('focusout', function (e) {
        var to = e.relatedTarget, m = pickMenu();
        if (pickOpen() && to && !m.contains(to) && to !== pickBtn()) closePick(false);
      });
      // the ⋯ menu (v11)
      els.moreBtn.addEventListener('click', function () { if (menuOpen()) closeMenu(true); else openMenu(false); });
      els.moreBtn.addEventListener('keydown', function (e) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !menuOpen()) { e.preventDefault(); e.stopPropagation(); openMenu(e.key === 'ArrowUp'); }
      });
      document.addEventListener('pointerdown', function (e) {       // a tap anywhere else closes it
        if (menuOpen() && !els.moreMenu.contains(e.target) && !els.moreBtn.contains(e.target)) closeMenu(false);
        var pm = pickMenu(), pb = pickBtn();                          // and the tool picker (v14)
        if (pickOpen() && !pm.contains(e.target) && !(pb && pb.contains(e.target))) closePick(false);
      }, true);
      els.moreMenu.addEventListener('focusout', function (e) {
        var to = e.relatedTarget;
        if (menuOpen() && to && !els.moreMenu.contains(to) && to !== els.moreBtn) closeMenu(false);
      });
      els.clearAll.addEventListener('click', menuAction(openClearDialog));
      els.clientsBackup.addEventListener('click', menuAction(backupClients));
      els.restoreItem.addEventListener('click', function () { els.clientsRestore.click(); closeMenu(true); });
      els.aiItem.addEventListener('click', menuAction(function () { openAiSettings(null); }));
      els.clearCancel.addEventListener('click', function () { closeModal(); });
      els.clearConfirm.addEventListener('click', clearAllData);
      els.aiSave.addEventListener('click', saveAiKey);
      els.aiCancel.addEventListener('click', function () { closeModal(); });
      els.aiRemove.addEventListener('click', removeAiKey);
      els.aiKey.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveAiKey(); } });
      els.clientsBtn.addEventListener('click', function () { openClientsDialog('manage'); });
      els.clientsClose.addEventListener('click', function () { closeModal(); });
      els.clientsNew.addEventListener('click', newClient);
      els.clientsSearch.addEventListener('input', function () { renderClientsList(); });
      els.clientsRestore.addEventListener('change', function () { restoreClients(els.clientsRestore.files); els.clientsRestore.value = ''; });
      els.clientsList.addEventListener('click', onClientsClick);
      // Tests today (v11)
      els.testsList.addEventListener('change', function (e) { if (e.target.matches('input[data-part]')) saveTestsChoice(); });
      els.testsAll.addEventListener('click', function () { setAllTests(true); });
      els.testsNone.addEventListener('click', function () { setAllTests(false); });
      els.testsDone.addEventListener('click', function () { closeModal(); });
      [els.clearDialog, els.aiDialog, els.clientsDialog, els.testsDialog].forEach(function (d) {
        d.addEventListener('click', function (e) { if (e.target === d) closeModal(); });
      });
      // tapping a suggested client must not blur the name box before the tap lands
      els.entry.addEventListener('pointerdown', function (e) { if (e.target.closest('.suggest')) e.preventDefault(); });
      els.entry.addEventListener('focusout', function (e) {
        if (e.target.dataset && e.target.dataset.meta === 'name') setTimeout(function () {
          var a = document.activeElement;                 // back in the name box by now: keep its fresh suggestions
          if (!(a && a.dataset && a.dataset.meta === 'name')) hideSuggest();
        }, 200);
      });
      els.back.addEventListener('click', closeReport);
      els.save.addEventListener('click', savePdf);
      els.share.addEventListener('click', sharePdf);
      document.addEventListener('keydown', function (e) {
        if (openModalEl) { onModalKey(e); return; }
        if (menuOpen()) { onMenuKey(e); return; }
        if (e.key === 'Escape' && !els.sheet.hidden) closeReport();
      });
      // the system lets a screen wake lock go when the app is hidden: ask again on coming back, if still needed
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') keepAwake(); });
      // turning the iPad changes how the exercise names and notes wrap, and the app bar's height (the strip sits under it)
      var fitTimer = null;
      window.addEventListener('resize', function () {
        measureBar();
        clearTimeout(fitTimer);
        fitTimer = setTimeout(function () { if (state.tool === 'ex') { fitExWraps(); fitExNotes(); } }, 120);
      });
      measureBar();
      if (window.ResizeObserver) new ResizeObserver(function () { measureBar(); }).observe(els.appbar);
      window.addEventListener('scroll', function () {
        if (!stuckFrame) stuckFrame = requestAnimationFrame(function () { stuckFrame = 0; checkStuck(); });
      }, { passive: true });
      render();
      if (CLOUD) initCloud();                          // v13: the sign-in card while signed out, else the first sync
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
