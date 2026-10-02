/* BASE Health Report: screen logic.
   Four tools (screening, LL strength, hamstring rehab, ACL rehab). Everything runs on the device: results are
   scored as they are typed, the PDF is built locally, and a draft is kept in this browser only until
   "Clear all data" wipes it. Creating a PDF also saves the session to the client's record on this device,
   so the next test can load their previous results and the report can show progress. "Scan notes" reads a photo
   of handwritten results with Claude and fills the boxes for checking.
   A fifth tab, Exercises (v10), turns a photo of a handwritten exercise page into an editable table and a PDF
   handout (until v15 it was kept in the draft only).
   v13: with the clinic store configured (cloud-config.js), every device signs in once with the clinic login and the
   client records live in Firestore (cloud.js), cached on the device; the draft stays on the device as before.
   v15: the Exercises tab has three pages chosen from its heading (Program builder, Exercise library, Program templates);
   programs can be built from the clinic's exercise library (cues and video links print on the handout), saved as
   templates, and each handout created with a patient name is saved to that client's record.
   v16: the report view has Return home: the session is already in the client's record, so it makes sure it has reached
   the clinic store, empties the page for the next client and goes back to the Screening tab (Undo for a few seconds). */
(function () {
  'use strict';
  var E = window.BHEngine;
  var CLOUD = window.BHCloud && window.BHCloud.enabled ? window.BHCloud : null;   // v13: the clinic store, or null in local mode
  var DATA = { guides: {}, guideIndex: null };         // v24: the evidence guides land here at start
  var STORE = 'bh-athlete-report-draft-v1';
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var state = null;
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    entry: $('entry'), summary: $('summary'), dock: $('dock'), sheet: $('sheet'), pages: $('pages'),
    sheetTitle: $('sheetTitle'), share: $('sharePdf'), save: $('savePdf'), back: $('sheetBack'), sheetEx: $('sheetEx'), sheetExBtn: $('sheetExBtn'),
    // v16: Return home in the report view, and the check it asks when some entries aren't in a client record
    home: $('homeBtn'), homeLabel: $('homeLabel'), homeDialog: $('homeDialog'), homeList: $('homeList'), homeKeep: $('homeKeep'), homeClear: $('homeClear'),
    toast: $('toast'), clearAll: $('clearAll'), clearDialog: $('clearDialog'), clearList: $('clearList'),
    clearCancel: $('clearCancel'), clearConfirm: $('clearConfirm'),
    aiDialog: $('aiDialog'), aiKey: $('aiKey'), aiSave: $('aiSave'), aiCancel: $('aiCancel'), aiRemove: $('aiRemove'),
    aiKeyState: $('aiKeyState'), aiErr: $('aiErr'), aiLead: $('aiLead'),
    clientsBtn: $('clientsBtn'), clientsDialog: $('clientsDialog'), clientsList: $('clientsList'), clientsSummary: $('clientsSummary'),
    clientsBackup: $('clientsBackup'), clientsRestore: $('clientsRestore'), clientsClose: $('clientsClose'),
    clientsEdit: $('clientsEdit'), clientsTitle: $('clientsTitle'), clientsSearch: $('clientsSearch'), clientsSearchWrap: $('clientsSearchWrap'), clientsNew: $('clientsNew'), clientsFine: $('clientsFine'),
    moreBtn: $('moreBtn'), moreMenu: $('moreMenu'), restoreItem: $('restoreItem'), aiItem: $('aiItem'), appbar: document.querySelector('.appbar'),
    demoItem: $('demoItem'), demoSep: $('demoSep'),
    testsDialog: $('testsDialog'), testsLead: $('testsLead'), testsList: $('testsList'), testsAll: $('testsAll'), testsNone: $('testsNone'), testsDone: $('testsDone'),
    suggestDialog: $('suggestDialog'), suggestLead: $('suggestLead'), suggestPlan: $('suggestPlan'), suggestCancel: $('suggestCancel'), suggestGo: $('suggestGo'),   // v23
    // v13: the clinic store's sign-in card, status bar and dialogs
    cloudBar: $('cloudBar'), signin: $('signin'), signinForm: $('signinForm'), signinEmail: $('signinEmail'), signinPassword: $('signinPassword'), signinShow: $('signinShow'),
    signinName: $('signinName'), signinBtn: $('signinBtn'), signinErr: $('signinErr'), accountTpl: $('accountTpl'),
    nameDialog: $('nameDialog'), nameBox: $('nameBox'), nameErr: $('nameErr'), nameCancel: $('nameCancel'), nameSave: $('nameSave'),
    signOutDialog: $('signOutDialog'), signOutText: $('signOutText'), signOutCancel: $('signOutCancel'), signOutConfirm: $('signOutConfirm'),
    legacyDialog: $('legacyDialog'), legacyText: $('legacyText'), legacyLater: $('legacyLater'), legacyUpload: $('legacyUpload'), legacyNever: $('legacyNever'),
    // v15: the exercise library's editor, + From library, the video player and the template dialogs
    libDialog: $('libDialog'), libPickDialog: $('libPickDialog'), videoDialog: $('videoDialog'),
    tplSaveDialog: $('tplSaveDialog'), tplPickDialog: $('tplPickDialog'), tplRenameDialog: $('tplRenameDialog')
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
    followReport();                                    // v19: a linked program keeps the report's name and date
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE, draftJson()); } catch (e) { /* storage unavailable */ }
    }, 250);
  }
  function tidyState() {
    var H = DATA.ham, A = DATA.acl;
    // v18: the rehab phase and the ACL norm set are the clinician's choice, never assumed (until v17 a blank one became the
    // last phase and the first norm set, so results were scored against targets nobody had picked)
    if (H.phases.indexOf(state.ham.phase) < 0) state.ham.phase = null;
    if (A.phases.indexOf(state.acl.phase) < 0) state.acl.phase = null;
    if (A.sexes.indexOf(state.acl.sex) < 0) state.acl.sex = null;
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
      state[t].showPrev = state[t].showPrev === true;  // v18: + Add previous results was tapped
      // v8 batch B: the coach band (drafts from v7 and earlier have none)
      var co = state[t].coach;
      if (!co || typeof co !== 'object' || Array.isArray(co)) co = state[t].coach = freshCoach();
      co.status = COACH_STATUS.indexOf(co.status) >= 0 ? co.status : '';
      co.mods = typeof co.mods === 'string' ? co.mods : '';
      co.retest = typeof co.retest === 'string' && E.parseDate(co.retest, ['Y-m-d']) ? co.retest : '';
      state[t].cardOpen = state[t].cardOpen !== false;   // v11: drafts from before the strip have the card open
      if (typeof state[t].savedSig !== 'string') delete state[t].savedSig;   // v16: what the client record holds
    });
    tidyEx();                                          // v10: the exercise program (drafts from v9 and earlier have none)
    if (typeof state.ex.savedSig !== 'string') delete state.ex.savedSig;
    if (TOOLS.indexOf(state.tool) < 0 && state.tool !== 'ex') state.tool = 'screen';
    // v14: the screening tool the Screening tab returns to (the one in use, or the last one used before Exercises)
    if (TOOLS.indexOf(state.screenTool) < 0) state.screenTool = TOOLS.indexOf(state.tool) >= 0 ? state.tool : 'screen';
    // v15: the Exercises page the Exercises tab returns to (drafts from v14 and earlier: the builder)
    if (EX_PAGES.indexOf(state.exPage) < 0) state.exPage = 'builder';
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
  function rehabKey(tool) {                            // v18: '' until the phase (and for ACL the norm set) is chosen
    var s = state[tool];
    if (!s.phase || (tool === 'acl' && !s.sex)) return '';
    return tool === 'acl' ? s.phase + '|' + s.sex : s.phase;
  }
  // v18: what still has to be chosen before a rehab tool can score anything ('' when nothing)
  function rehabNeed(t) {
    if (t !== 'ham' && t !== 'acl') return '';
    var s = state[t], p = !s.phase, x = t === 'acl' && !s.sex;
    return p && x ? 'Choose the rehab phase and norm set' : p ? 'Choose the rehab phase' : x ? 'Choose the norm set' : '';
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
    var groups = key ? E.buildRehabRows(inputs, key, S) : [];   // v18: nothing is scored before the norms are chosen
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
  function compute() { return computeFor(state.tool); }
  function computeFor(t) {                             // v19: any report tool's results (the builder makes the linked report too)
    if (t === 'screen') return computeScreen();
    if (t === 'str') return computeStrength();
    return computeRehab(t);
  }

  // ------------------------------------------------------------------ rendering: entry column
  var HEAD = {
    screen: ['Performance & readiness screen', 'Leave a metric blank to skip it; add the previous result to see real change.'],
    str: ['Lower-limb strength & capacity', 'Enter each leg\u2019s load, force or reps. Blank tests are left out.'],
    ham: ['Hamstring rehab & return to play', 'Injured-limb results against the targets for the chosen phase.'],
    acl: ['ACL rehab & return to play', 'Injured-limb and symmetry results against ACLR norms for the chosen phase and sex.'],
    ex: ['Program builder', 'Add exercises from the library, type them, or scan a handwritten page (no patient name on it).']
  };
  // v15: the Exercises tab's three pages, chosen from its heading (the same picker as Screening's tools)
  var EX_PAGES = ['builder', 'library', 'templates'];
  var EX_PAGE_TITLE = { builder: 'Program builder', library: 'Exercise library', templates: 'Program templates' };
  function exPageBlurb(p) {
    if (p === 'builder') return 'Build a patient’s program from the library, by typing, or from a photo of a handwritten page.';
    if (p === 'library') return 'The clinic’s exercises: default dose, cues for the handout and a video link.';
    return 'Saved programs to start from, ' + (CLOUD ? 'shared by the whole clinic.' : 'saved on this device.');
  }
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
      (o.words ? ' autocapitalize="words"' : '') + (o.readonly ? ' readonly aria-readonly="true"' : '') + ' autocomplete="off" spellcheck="false" enterkeyhint="next"></label>';
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
  var DOC_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
  function scanLabel(t) { return t === 'ex' ? 'Scan exercise page' : t === 'screen' ? 'Photo of notes or a VALD screenshot' : 'Scan notes'; }
  // v18: the Import results menu (Performance screen): opened from its button; a tap elsewhere, Escape or a choice closes it
  function importMenu() { return $('importMenu'); }
  function setImportMenu(open, focusBtn) {
    var m = importMenu(), b = $('importBtn');
    if (!m || !b) return;
    m.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
    if (open) focusQuiet(m.querySelector('.menu-item input'));   // the item's own file input (Return opens its picker)
    else if (focusBtn) focusQuiet(b);
  }
  var PEOPLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';
  // the head of the details card: Choose client (report tabs), Scan, Import VALD CSV (Screening) and Done (v11)
  var IMPORT_LABEL = 'Import<span class="il-more"> results</span>';   // v18: just Import on a phone, so it shares a row with Choose client
  function cardHead(t, h2id) {
    var open = state[t].cardOpen !== false;
    var out = '<div class="card-head"><h2 id="' + h2id + '">' + (t === 'ex' ? 'Patient' : Person(t)) + '</h2><div class="head-actions">';
    out += '<button type="button" class="ghost choose-btn" data-action="choose-client" aria-haspopup="dialog">' + PEOPLE + 'Choose client</button>';   // v15: Exercises too
    if (t === 'screen') {
      // v18: one Import results menu: a photo of notes (or a VALD app screenshot), or a VALD CSV export. Each item is a
      // label with its file input laid over it, so a tap lands on the input itself (as the buttons did)
      out += '<div class="import-wrap"><button type="button" class="ghost import-btn" id="importBtn" data-action="import-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="importMenu">' +
        CAMERA + '<span data-label>' + IMPORT_LABEL + '</span><span class="chev-s" aria-hidden="true"></span></button>' +
        '<div class="menu import-menu" id="importMenu" role="menu" aria-label="Import results" hidden>' +
        '<label class="menu-item file-btn scan-btn" id="scanBtn" for="scanFiles" role="menuitem">' + CAMERA + '<span data-label>' + scanLabel(t) + '</span>' + (open ? scanInputHtml(t) : '') + '</label>' +
        '<label class="menu-item file-btn" for="valdFiles" role="menuitem">' + DOC_ICON + '<span>VALD CSV export</span><input id="valdFiles" type="file" accept=".csv,text/csv" multiple></label>' +
        '</div></div>';
    } else {
      out += '<label class="ghost file-btn scan-btn" id="scanBtn" for="scanFiles">' + CAMERA + '<span data-label>' + scanLabel(t) + '</span>' +
        (open ? scanInputHtml(t) : '') + '</label>';
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
      out += select('ham-phase', 'Rehab phase', [['', 'Choose the phase…']].concat(DATA.ham.phases.map(function (p) { return [p, p]; })), s.phase || '', 'data-choice="phase"', 'wide');
    } else {
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'injured', 'Injured side', ['Left', 'Right']) +
        field(t, 'dos', 'Date of surgery', { type: 'date' }) + field(t, 'months', 'Months since surgery', { mode: 'decimal' }) +
        field(t, 'graft', 'Graft type') + field(t, 'surgeon', 'Surgeon / clinician', { words: true }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'notes', 'Notes', { cls: 'span3' });
      out += select('acl-phase', 'Rehab phase', [['', 'Choose the phase…']].concat(DATA.acl.phases.map(function (p) { return [p, p]; })), s.phase || '', 'data-choice="phase"', 'wide');
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
    if (t === 'ham' || t === 'acl') return !!m.injured && !rehabNeed(t);   // v18: and the phase (and norm set) chosen
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
    var html = '<div class="metric' + (asym ? ' has-side' : '') + (labels ? ' has-bl' : '') + (m.calc === 'LSI' ? ' lsi' : '') + '" data-metric="' + nm + '" data-status="" id="' + id + '">' +
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
      return '<section class="group' + (collapsed ? ' collapsed' : '') + '" data-group="' + gi + '">' +
        '<button type="button" class="group-head" aria-expanded="' + !collapsed + '"><span class="gt">' + esc(groupTitle(g.title)) + '</span><span class="gc" data-count></span><span class="chev" aria-hidden="true"></span></button>' +
        // v18: Result and Previous only (a two-sided row labels its own Left and Right boxes)
        '<div class="cols" aria-hidden="true"><span class="c-result">' + (tool === 'ham' ? 'Injured' : 'Result') + '</span><span class="c-prev">Previous</span><span class="c-out">Status</span></div>' +
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
      (n ? '<span class="tests-hidden" id="testsHidden">' + n + ' ' + unit[n === 1 ? 0 : 1] + ' hidden</span>' : '') +
      (t !== 'str' ? '<button type="button" class="quiet add-prev" id="addPrev" data-action="add-prev"' + (prevShown(t) ? ' hidden' : '') + '>+ Add previous results</button>' : '') + '</div>';
  }
  // v18: the Previous column shows once there is a previous result on the page (a client's record loaded, or one typed),
  // or after + Add previous results; a first visit has no column of empty boxes. LL Strength has no Previous boxes.
  function prevShown(t) {
    var s = state[t];
    if (t === 'str' || s.showPrev === true) return true;
    return Object.keys(s.values).some(function (k) { var v = s.values[k]; return !!v && !blank(v.previous); });
  }
  function addPrevious() {
    var t = state.tool;
    state[t].showPrev = true;
    refresh();
    var first = els.entry.querySelector('.group:not(.collapsed):not([hidden]) .metric:not([hidden]) input[data-field="previous"]');
    if (first) first.focus();                          // the first Previous box, ready to type in
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
  // v15: the Exercises tab's heading is the same picker, listing its three pages (data-page on the button; the items
  // are #pick-ex-<page> with data-pick-page). Only one picker is ever on screen, so the ids are shared.
  function pickHtml(t) {
    var ex = t === 'ex', cur = ex ? state.exPage : t, keys = ex ? EX_PAGES : TOOLS;
    return '<div class="pick-wrap"><h1 class="pick-h"><button type="button" class="tool-pick" id="toolPick" data-tool="' + t + '"' + (ex ? ' data-page="' + cur + '"' : '') +
      ' aria-haspopup="menu" aria-expanded="false" aria-controls="toolMenu" title="' + (ex ? 'Choose an Exercises page' : 'Choose a screening tool') + '">' +
      '<span class="pick-text">' + esc(ex ? EX_PAGE_TITLE[cur] : HEAD[t][0]) + '</span>' +
      '<span class="pick-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span></button></h1>' +
      '<div class="menu tool-menu" id="toolMenu" role="menu" aria-label="' + (ex ? 'Exercises pages' : 'Screening tools') + '" hidden>' +
      keys.map(function (k) {
        return '<button type="button" class="menu-item tool-item" id="pick-' + (ex ? 'ex-' : '') + k + '" role="menuitemradio" aria-checked="' + (k === cur) + '" ' + (ex ? 'data-pick-page' : 'data-pick') + '="' + k + '" tabindex="-1">' +
          '<svg class="ti-tick" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' +
          '<span class="ti-text"><b>' + esc(ex ? EX_PAGE_TITLE[k] : HEAD[k][0]) + '</b><small>' + esc(ex ? exPageBlurb(k) : TOOL_BLURB[k]) + '</small></span></button>';
      }).join('') + '</div></div>';
  }
  function render() {
    var t = state.tool, section = t === 'ex' ? 'ex' : 'screening';
    document.querySelectorAll('.tools button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.section === section)); });
    followReport();                                    // v19: a linked program shows the report's name and date
    if (t === 'ex') { renderExPage(); return; }
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
    if (state.tool === 'ex') { if (state.exPage === 'builder') refreshEx(); return; }   // e.g. a late AI draft or a client restore while on the Exercises tab
    var t = state.tool, c = compute();
    applyRetest(false);
    refreshClientBar(c);
    syncCard(c);
    var showPrev = prevShown(t), ap = $('addPrev');   // v18: the Previous column, or + Add previous results
    els.entry.classList.toggle('no-prev', !showPrev);
    if (ap) ap.hidden = showPrev;
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
    } else if (rehabNeed(t)) {
      var since = sinceText(t), unit = t === 'ham' ? (since === '1' ? ' week since injury.' : ' weeks since injury.') : (since === '1' ? ' month since surgery.' : ' months since surgery.');
      note.hidden = false; note.className = 'note warn';
      note.textContent = rehabNeed(t) + ' to score the results.' + (since ? ' ' + since + unit : '');
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
        // v18: the target when there is one, else nothing (no 'choose sex for targets' / 'no norm' on every row: the
        // details card asks for sex or the phase once, and a result's 'No target' pill says the rest)
        target.textContent = norm && (t !== 'screen' || c.pop.population) ? (t === 'screen' ? 'target ' : 'phase target ') + E.targetStr(norm) : '';
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
        if (m.calc === 'LSI' && typed) {
          // the chip carries the status word. v18: worked out from the two boxes (c.inputs), so it shows before the
          // phase and norm set are chosen too
          var lv = c.inputs && c.inputs[m.name] ? c.inputs[m.name].result : null;
          calc.textContent = lv !== null && lv !== undefined ? '= ' + E.fmt(lv) + '%' : (state.acl.meta.injured ? 'enter both sides' : 'set the injured side');
        }
        var pn = el.querySelector('.m-prevnote');
        if (pn) pn.textContent = v.prevDate && !blank(v.previous) && (m.calc === 'LSI' || m.calc === 'DSI')
          ? 'prev ' + E.fmt(E.parseInput(v.previous)) + (m.calc === 'LSI' ? '%' : '') + ' (' + E.displayIso(v.prevDate) + ')'
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
          out.innerHTML = typed && E.parseInput(v.result) === null && m.calc !== 'LSI' && m.calc !== 'PERBW' ? '<span class="m-wait">not a number</span>' : '';
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
          // v18: from the two boxes (c.inputs), so it is checked before the phase and norm set are chosen too
          var lv = c.inputs && c.inputs[m.name] ? c.inputs[m.name].result : null;
          if (lv !== null && lv !== undefined) add(m.name, ['left', 'right'], E.typoCheck(lv, m.range, E.parseInput(v.previous), m.jump), E.fmt(lv), '%',
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
  // v18: the optional cards (this one and Interpretation) fold to one line until they're used: opened by hand (this
  // visit only), or holding something
  var coachOpen = {}, interpOpen = {};
  function coachShown(t) { return !!coachOpen[t] || coachSet(state[t].coach); }
  function coachCardHtml() {
    var t = state.tool, co = state[t].coach, open = coachShown(t);
    return '<section class="card coach' + (open ? '' : ' folded') + '" id="coachCard" aria-labelledby="coachTitle">' +
      '<div class="card-head"><div class="fold-t"><h2 id="coachTitle">' + (t === 'screen' ? 'For the coach' : 'Training status') + '</h2>' +
      '<p class="coach-help">Optional: ' + (t === 'screen' ? 'training status' : 'status') + ', modifications and next retest, printed as a band at the top of the report.</p></div>' +
      '<button type="button" class="ghost fold-add" data-action="coach-open" aria-expanded="' + open + '" aria-controls="coachFields">+ Add</button></div>' +
      '<div class="coach-fields" id="coachFields"><div class="f coach-status"><span id="coachStatusL">' + (state.tool === 'screen' ? 'Training status' : 'Status') + '</span>' +
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
  function openCoach() {                               // v18: + Add on the folded card; focus on the card (no keyboard)
    var t = state.tool, card = $('coachCard');
    coachOpen[t] = true;
    if (!card) return;
    card.classList.remove('folded');
    card.querySelector('.fold-add').setAttribute('aria-expanded', 'true');
    var first = card.querySelector('[data-coach-status]');
    focusQuiet(first);
  }
  function setCoachStatus(b) {
    coachOpen[state.tool] = true;                      // v18: open now, so clearing it again doesn't fold it under the finger
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
    if (!R || !Array.isArray(R.criteria) || !c || !c.inputs) return null;
    var results = {}, units = {};
    // v18: read from what was typed (c.inputs), not the scored rows: the criteria have their own thresholds, so they
    // are checked before the rehab phase and norm set are chosen too (the rows wait for those)
    Object.keys(c.inputs).forEach(function (name) { var n = E.num(c.inputs[name].result); if (n !== null) results[name] = n; });
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
  function blocker(c, tool) {                           // v19: tool (default the one on screen)
    var t = tool || state.tool;
    if (t === 'str') {
      if (c.rows.length) return '';
      return c.tests.length ? 'Add body mass (kg) to score these results.' : 'Enter at least one result to create the report.';
    }
    var none = t === 'screen' ? 'Enter at least one result to create the report.' : 'Enter at least one result to create the rehab report.';
    var need = t === 'screen' ? (c.pop.population ? '' : 'Choose Male or Female (or a sport population)') : rehabNeed(t);
    if (!hasResults(t)) return none;                  // v18: until then the details card's prompt is the only one
    if (need) return need + ' to score the results.';
    if (!c.groups.length) return none;
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
    // the same heading on every report tab (v11). v18: no 'Compared against …' line: the details card sets it and the
    // strip shows it
    var head = '<h2>Summary</h2>';
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
        list = '<p class="empty">Each leg is scored as you type.</p>';   // v18: example results are in the ⋯ menu
      } else if (!c.prios.length) {
        list = '<p class="ok">Nothing below target — every tested result is on target.</p>';
      } else {
        list = '<ol class="prio">' + c.prios.slice(0, 6).map(function (r) {
          return prioItem(r.id, r.name, r.status, r.text + ' · target ' + r.target);
        }).join('') + '</ol>' + (c.prios.length > 6 ? '<p class="fine">+ ' + (c.prios.length - 6) + ' more in the report</p>' : '');
      }
    } else if (!c.groups.length) {
      // v18: example results are in the ⋯ menu. Results typed before the norms are chosen wait (the reason is said
      // once, under Create report)
      list = '<p class="empty">' + (hasResults(t) ? 'Not scored yet.' : 'Results are scored as you type.') + '</p>';
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
    // v20: with its program linked (and exercises in it) the button says the PDF holds both, in the dock too
    var make = linkedTool() === t && exCounts().exercises > 0 ? 'Create report + exercises' : 'Create report';
    html += '</div><div class="sum-foot">' + checkFlagHtml() + interpFlagHtml(t, c) + exLinkHtml(t) + '<button type="button" class="primary make" data-action="report"' + (why ? ' disabled' : '') + '>' + make + '</button>' +
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
      '<button type="button" class="primary" data-action="report"' + (why ? ' disabled' : '') + '>' + dockMake(make) + '</button>';
    els.dock.classList.toggle('has-check', nCheck > 0);   // on a phone the check takes the tally's place (the tally stays in the summary)
    els.dock.classList.toggle('has-both', make !== 'Create report');   // v20: on the narrowest phones the button takes the tally's place
  }

  // ------------------------------------------------------------------ input handling
  function onInput(e) {
    var el = e.target, t = state.tool;
    if (t === 'ex') {
      if (el.id === 'libSearch') { libView.q = el.value; renderLibList(); return; }   // v15: the library and templates pages
      if (el.id === 'tplSearch') { tplView.q = el.value; renderTplList(); return; }
      onExInput(el);
      return;
    }
    if (el.id === 'interpText') { onInterpInput(el); return; }
    if (el.dataset.coach) { coachOpen[t] = true; state[t].coach[el.dataset.coach] = el.value; saveDraft(); keepAwake(); return; }
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
    else if (el.dataset.choice === 'phase') { state[t].phase = el.value || null; refresh(); }
    else if (el.id === 'valdFiles') importVald(el.files);
    else if (el.id === 'scanFiles') { var picked = Array.prototype.slice.call(el.files || []); el.value = ''; startScan(picked); }
    else if (el.dataset.coach) { coachOpen[t] = true; state[t].coach[el.dataset.coach] = el.value; saveDraft(); }
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
    if (b.dataset.pickPage) { pickPage(b.dataset.pickPage); return; }   // v15: an Exercises page
    if (b.dataset.action === 'edit-athlete') { openCard(); return; }
    if (b.dataset.action === 'done-athlete') { closeCard(); return; }
    if (b.dataset.action === 'choose-client') { openClientsDialog('pick'); return; }
    if (b.dataset.action === 'import-menu') { var im = importMenu(); setImportMenu(!!im && im.hidden, true); return; }   // v18
    if (b.dataset.action === 'tests-today') { openTestsDialog(); return; }
    if (b.dataset.action === 'add-program') { linkProgram(t); return; }          // v19: the report and the program together
    if (b.dataset.action === 'goto-program') { gotoProgram(); return; }
    if (b.dataset.action === 'back-to-report') { backToReport(); return; }
    if (b.dataset.action === 'unlink-program') { unlinkProgram(); return; }
    if (b.dataset.action === 'link-report') { linkFromBuilder(b.dataset.tool); return; }
    if (t === 'ex' && exPageButton(b)) return;         // v15: the library and templates pages, library links in the builder
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
    if (b.dataset.action === 'coach-open') { openCoach(); return; }      // v18: the folded cards
    if (b.dataset.action === 'interp-own') { openInterp(); return; }
    if (b.dataset.action === 'add-prev') { addPrevious(); return; }     // v18: the Previous column on a first visit
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
    } else if (b.dataset.action === 'ai-undo') {
      undoInterp();
    } else if (b.dataset.action === 'goto-interp') {
      gotoInterp();
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
  // v18: from the ⋯ menu, and only on an empty page (until v17 the summary offered it after a client was loaded, where it
  // renamed them Example Athlete and replaced their previous results)
  function demoAllowed() { return TOOLS.indexOf(state.tool) >= 0 && !clientContent(state.tool); }
  function fillExample() {
    if (!demoAllowed()) return;
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
      s.phase = 'Return to Play';                      // v18: chosen here, as the clinician would
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
      s.phase = '2 Years'; s.sex = 'Female';           // v18: chosen here, as the clinician would
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
  function fileName(suffix, tool) {
    var t = tool || state.tool, n = (state[t].meta.name || person(t)).trim() || person(t);
    return n.replace(/[\\/:*?"<>|]+/g, '-').replace(/ /g, '_') + suffix;
  }
  function buildReport(tool) {                         // v19: any report tool (the builder makes the linked report)
    var t = tool || state.tool, c = computeFor(t), m = state[t].meta;
    if (blocker(c, t)) return null;
    var it = state[t].interp, interp = blank(it.text) ? null : { text: String(it.text).trim(), ai: !!it.ai };
    var progress = progressData(t, c);
    // each priority carries its plain-English explainer (printed under it in smaller text)
    function explained(list, keyOf) {
      return list.map(function (r) { var x = explainer(keyOf(r)); return Object.assign({}, r, { what: x ? String(x.what).trim() : '' }); });
    }
    if (t === 'str') {
      return {
        file: fileName('_strength.pdf', t),
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
        file: fileName('_report.pdf', t),
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
        file: fileName('_hamstring.pdf', t),
        rep: window.BHReport.rehab({
          kind: 'ham', phase: state.ham.phase, groups: c.groups, counts: c.counts, disclaimer: DATA.ham.disclaimer || '', interp: interp, progress: progress, coach: coachData(t),
          meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, clinician: m.clinician, weeks: blank(m.weeks) ? auto(m.doi, 7) : m.weeks, sport: m.sport, notes: m.notes }
        })
      };
    }
    return {
      file: fileName('_acl.pdf', t),
      rep: window.BHReport.rehab({
        kind: 'acl', phase: state.acl.phase, sex: state.acl.sex, groups: c.groups, counts: c.counts, disclaimer: DATA.acl.disclaimer || '', interp: interp, progress: progress,
        coach: coachData(t), rts: rtsData(c),
        meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, graft: m.graft, surgeon: m.surgeon, months: blank(m.months) ? auto(m.dos, 30.4375) : m.months, sport: m.sport, notes: m.notes }
      })
    };
  }
  // ------------------------------------------------------------------ the report and the exercise program together (v19)
  // Matthew: testing, then the exercise prescription, both written on paper, should end in one document. A report's
  // summary offers "Add an exercise program": the Exercises builder opens with the patient's name and date (and a blank
  // Clinician box filled in) and the program is linked to that report. While linked, the program's name and date are the
  // report's (the builder shows them read-only), the report's summary says "Exercise program included", and Create report
  // (or "Create report + exercises" in the builder) makes ONE PDF: the report's pages, then the program's, and saves both to
  // the client's record. The link ends when the report's page is cleared for another client (New client, or another client
  // chosen while it holds entries), when another client is chosen in the builder, at Return home, at Clear all, or with
  // "Print on its own" in the builder. A name typed or chosen on a report page holding nothing else is a correction, so the
  // program follows it. The other way round, the builder offers to print a named program with that patient's report when
  // one of the Screening tools holds it.
  var EX_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/></svg>';
  function linkedTool() {                              // the Screening tool the program prints after, or ''
    var l = state.ex && state.ex.link;
    return TOOLS.indexOf(l) >= 0 ? l : '';
  }
  function followReport() {                            // while linked, the program's patient is the report's
    var lt = state && state.ex ? linkedTool() : '';
    if (!lt) return;
    var m = state[lt].meta, x = state.ex.meta;
    if (x.name !== (m.name || '')) x.name = m.name || '';
    if (x.date !== (m.date || '')) x.date = m.date || '';
  }
  // + Add an exercise program (a report's summary): link, carry the patient over, open the builder. A program already
  // there for this patient (or with no name yet) is kept; another patient's is cleared first, with Undo.
  function linkProgram(t) {
    if (TOOLS.indexOf(t) < 0) return;
    var m = state[t].meta, x = state.ex, was = clean1(x.meta.name), moved = x.link && x.link !== t ? x.link : '';
    var other = !blank(x.meta.name) && E.nameKey(x.meta.name) !== E.nameKey(m.name);
    var undo = other && clientContent('ex', true) ? clearForClient('ex') : null;
    if (other && !undo) x.meta.name = '';             // only a name there: nothing to keep
    x = state.ex;
    x.link = t;
    followReport();
    var who = NAME_FIELDS[t] ? m[NAME_FIELDS[t]] : '';   // the clinician (not on ACL: that box is the surgeon's)
    if (blank(x.meta.practitioner) && !blank(who)) x.meta.practitioner = clean1(who);
    state.exPage = 'builder';
    foldBeforeRender('ex');
    closePick(false);
    switchTool('ex');
    saveDraft();
    focusQuiet(pickBtn());                             // the page heading (no keyboard, no scroll)
    if (undo) toast('Cleared ' + (was || 'the last client') + '’s program for ' + (clean1(m.name) || 'this client'), { label: 'Undo', run: undo });
    else if (moved) toast('The program now prints after the ' + TOOL_NAMES[t] + ' report', { label: 'Undo', run: function () {
      if (state.ex !== x || x.link !== t) return;
      x.link = moved; followReport(); render(); saveDraft();
    } });
  }
  // v20: the dock's 'Create report + exercises' is 'Report + exercises' on a narrow phone (the tally keeps its room)
  function dockMake(label) {
    return label === 'Create report + exercises' ? '<span class="mk-full">' + label + '</span><span class="mk-short">Report + exercises</span>' : label;
  }
  function gotoProgram() {                             // ✓ Exercise program included: to the builder
    closePick(false);
    state.exPage = 'builder';
    switchTool('ex');
    saveDraft();
    focusQuiet(pickBtn());
  }
  function backToReport() {                            // the builder's ‹ Back to the report
    var lt = linkedTool();
    if (!lt) return;
    closePick(false);
    switchTool(lt);
    focusQuiet(pickBtn());
  }
  function unlinkProgram() {                           // the builder's Print on its own
    var lt = linkedTool(), x = state.ex;
    if (!lt) return;
    x.link = '';
    render();
    saveDraft();
    toast('The program will print on its own', { label: 'Undo', run: function () {
      if (state.ex !== x || x.link || E.nameKey(state[lt].meta.name) !== E.nameKey(x.meta.name)) return;
      x.link = lt; followReport(); render(); saveDraft();
    } });
  }
  // the other way round: a named program in the builder, and that patient's results on a Screening tool
  function reportFor() {
    var key = E.nameKey(state.ex.meta.name);
    if (!key || linkedTool()) return '';
    var list = TOOLS.filter(function (t) { return E.nameKey(state[t].meta.name) === key && hasResults(t); });
    return list.indexOf(state.screenTool) >= 0 ? state.screenTool : (list[0] || '');
  }
  function linkFromBuilder(t) {
    if (TOOLS.indexOf(t) < 0 || reportFor() !== t) return;
    state.ex.link = t;
    followReport();
    render();
    saveDraft();
    focusQuiet(els.summary.querySelector('[data-action="report"]'));
  }
  // one PDF: the report's pages, then the program's (each part keeps its own header and footer)
  function buildBoth(rt) {
    var r = buildReport(rt), h = buildHandout();
    if (!r || !h) return null;
    var parts = r.rep.title.split(' — '), base = parts.shift(), who = parts.join(' — ');
    return {
      file: r.file.replace(/\.pdf$/i, '') + '_and_exercises.pdf', program: h.program, both: rt,
      rep: { pages: r.rep.pages.concat(h.rep.pages), title: base + ' + Exercise Program' + (who ? ' — ' + who : '') }
    };
  }
  // the results and the program into the client's record (two sessions, as when they are made apart)
  function saveBoth(rt, program) {
    var a = saveSession(rt, computeFor(rt)), b = saveProgram(program);
    if (!a && !b) return null;                         // no name: nothing to save
    if (a && a.ok) markSaved(rt);
    if (b && b.ok) markSaved('ex');
    var ok = !!(a && a.ok) && !!(b && b.ok), name = (a || b).name;
    return { ok: ok, name: name, both: true, replaced: !!(a && a.replaced && b && b.replaced), count: ((b && b.ok) ? b : a).count };
  }
  function canShare(file) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }
  function openReport() {
    var ex = state.tool === 'ex', t = state.tool, lt = linkedTool();
    // v19: a report with its linked program (made from either side) is one PDF, the report's pages first
    var both = lt && (ex || lt === t) && exCounts().exercises > 0 ? lt : '';
    var built = both ? buildBoth(both) : ex ? buildHandout() : buildReport(t);
    if (!built) return;
    // v15: the exercise handout is saved to the client's record too (the program as printed)
    var saved = both ? saveBoth(both, built.program) : ex ? saveProgram(built.program) : saveSession(state.tool, compute());
    if (saved) {
      if (!saved.ok) toast('The session couldn’t be saved to the client record (storage is full or blocked).');
      else {
        if (!both) markSaved(t);                       // v16: what is in the record now (Return home compares with it)
        toast(both ? (saved.replaced ? 'Updated ' + saved.name + '’s record for this date' : 'Saved the report and the program to ' + saved.name + '’s record')
          : saved.replaced ? 'Updated ' + saved.name + '’s record for this date' : 'Saved to ' + saved.name + '’s record (' + saved.count + (saved.count === 1 ? ' session)' : ' sessions)'));
      }
      refresh();
    }
    homeFrom = { tool: both || t, name: saved && saved.ok ? saved.name : '', saved: !!(saved && saved.ok) };
    els.back.textContent = '‹ ' + (ex ? 'Back to the program' : 'Back to results');
    // v20: a Screening report made without a program: the report view offers one too (where Matthew looked for it once
    // the report was made); the program then prints after this report, in the same PDF
    var offer = !ex && !both ? t : '';
    els.sheetEx.hidden = !offer;
    els.sheetEx.dataset.tool = offer;
    if (offer) $('sheetExQ').textContent = 'Exercises for this ' + person(offer) + '?';   // athlete on the Performance screen (v9 wording)
    current = { file: null, blob: null, title: built.rep.title };
    els.sheetTitle.innerHTML = esc(built.rep.title) + '<small>' + esc(built.file) + '</small>';
    els.pages.innerHTML = '<p class="sheet-msg">Building the report…</p>';
    els.share.disabled = true; els.save.disabled = true; els.home.disabled = true;
    els.share.className = 'primary';                   // v16: Share leads until the PDF is out, then Return home does
    els.home.className = 'ghost home-btn'; els.homeLabel.textContent = 'Return home';
    els.sheet.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    var gen = ++reportGen;
    ensureFonts().then(function () {
      if (gen !== reportGen) return;                   // v16: the page was cleared (or another report opened) meanwhile
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
      els.share.disabled = false; els.save.disabled = false; els.home.disabled = false;
      (share ? els.share : els.save).focus();
    }).catch(function (err) {
      if (gen !== reportGen) return;
      els.pages.innerHTML = '<p class="sheet-msg">The PDF couldn’t be built: ' + esc(err && err.message) + '</p>';
      els.home.disabled = false;                       // the session was saved all the same
    });
  }
  function closeReport() {
    els.sheet.hidden = true;
    document.documentElement.style.overflow = '';
  }
  function addProgramFromReport() {                    // v20: the report view's Add exercise program
    var t = els.sheetEx.dataset.tool;
    if (TOOLS.indexOf(t) < 0 || els.sheet.hidden) return;
    closeReport();
    if (state.tool !== t) switchTool(t);
    linkProgram(t);
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
    homeFirst();
  }
  function sharePdf() {
    if (!current.file) return;
    navigator.share({ files: [current.file], title: current.title }).then(function () { homeFirst(); }, function (err) {
      if (err && err.name !== 'AbortError') { toast('Sharing didn’t work here, so the PDF was saved instead.'); savePdf(); }
    });
  }

  // ------------------------------------------------------------------ Return home (v16)
  // Finished with a client. Create report (or Create handout) has already put the session in their record; Return home,
  // in the report view, makes sure it has reached the clinic store, empties the page for the next client and goes back
  // to the Screening tab (on the tool last used there), at the top. The other tools and the program are emptied too, so
  // the next client starts clean, except entries that aren't in any client record (another tool's results not reported
  // yet, or a report made without a name): those are listed first, to keep for later or clear. The practitioner's name
  // stays and the dates become today. Undo (a few seconds) puts everything back as it was.
  var reportGen = 0;                                   // a report still being built when the page is cleared is dropped
  var homeFrom = null;                                 // the report on screen: { tool, name (as in the record), saved }
  // the PDF is out (shared, or saved as a file): Return home becomes the main button
  function homeFirst() {
    if (els.sheet.hidden) return;
    els.share.className = 'ghost';
    els.save.className = 'ghost';
    els.home.className = 'primary home-btn';
    focusQuiet(els.home);
  }
  // what a tool holds that goes into a client record, as one string: the same entries give the same string whatever
  // order they were typed in. Kept as savedSig when the record is saved; anything typed since makes them differ.
  function sortedPairs(o) {
    return Object.keys(o || {}).sort().filter(function (k) { var v = o[k]; return v != null && typeof v !== 'object' && !blank(v); })
      .map(function (k) { return [k, String(o[k]).trim()]; });
  }
  function contentSig(t) {
    if (t === 'ex') {
      var x = state.ex, rows = [];
      x.items.forEach(function (it) {
        if (it.kind === 'section') { if (!blank(it.heading)) rows.push(['s', clean1(it.heading)]); }
        else if (exFilled(it)) rows.push(['e', it.lib || ''].concat(EX_FIELDS.map(function (f) { return clean1(it[f]); })));
      });
      return JSON.stringify([sortedPairs(x.meta), clean1(x.title), String(x.instructions || '').trim(), rows]);
    }
    var s = state[t], vals = compactValues(t);
    return JSON.stringify([sortedPairs(s.meta), Object.keys(vals).sort().map(function (k) { return [k, sortedPairs(vals[k])]; }),
      String((s.interp && s.interp.text) || '').trim(), sortedPairs(s.coach), s.pop || '', s.phase || '', s.sex || '']);
  }
  function markSaved(t) {
    state[t].savedSig = contentSig(t);
    saveDraft();
  }
  // anything of a client's in a tool: a name, a result, a detail, a note, a summary or the coach's call (the
  // practitioner's own name and the date don't count); for the program, a name or anything in it.
  // butName (v18): the same, leaving the client's name out
  function clientContent(t, butName) {
    if (t === 'ex') return (!butName && !blank(state.ex.meta.name)) || exHasContent();
    var s = state[t], pf = NAME_FIELDS[t];
    if (Object.keys(compactValues(t)).length) return true;
    if (Object.keys(s.meta).some(function (k) { return k !== 'date' && k !== pf && !(butName && k === 'name') && !blank(s.meta[k]); })) return true;
    return !blank(s.interp && s.interp.text) || coachSet(s.coach);
  }
  // the tools (and the program) holding entries that aren't in a client record as they are now
  function unsavedTools() {
    return TOOLS.concat(['ex']).filter(function (t) {
      // v19: a linked program's name and date are the report's, so only exercises (or a title) count as its own
      var has = t === 'ex' && linkedTool() ? exHasContent() : clientContent(t);
      return has && state[t].savedSig !== contentSig(t);
    });
  }
  // a tool emptied for the next client: the practitioner's name stays (Tester / Clinician / Practitioner)
  function resetTool(t) {
    if (state.ex && state.ex.link === t) state.ex.link = '';   // v19: that report has gone, so the program prints on its own
    if (t === 'ex') {
      var p = state.ex.meta.practitioner;
      state.ex = freshEx();
      if (!blank(p)) state.ex.meta.practitioner = p;
      return;
    }
    var keep = {}, f = NAME_FIELDS[t];
    if (f && !blank(state[t].meta[f])) keep[f] = state[t].meta[f];
    state[t] = freshTool(t, keep);
  }
  // v18: a clean page on this tool for another client (New client, or a different client chosen while the page holds
  // someone's entries), as Return home does for every tool: the practitioner's name stays. Gives back the Undo.
  function clearForClient(t) {
    var snap = JSON.parse(JSON.stringify(state[t])), wasLoaded = exLoaded, link0 = state.ex.link;
    resetTool(t);
    tidyState();
    var fresh = state[t];
    if (t === 'ex') { exLoaded = null; fresh.seq = Math.max(fresh.seq, snap.seq || 1); }   // row ids are never reused
    dropPending(t);
    return function () {
      if (state[t] !== fresh) return;                // replaced again since (Return home, Clear all, another client)
      state[t] = snap;
      // v19: the program linked to this report goes with it again, if it is still this client's
      if (t !== 'ex' && link0 === t && !state.ex.link && E.nameKey(state.ex.meta.name) === E.nameKey(snap.meta.name)) state.ex.link = t;
      tidyState();
      if (t === 'ex') exLoaded = wasLoaded;
      dropPending(t);
      if (state.tool === t) render();
      saveDraft();
      toast('Back as it was');
    };
  }
  // an AI summary or a scan still on its way, and the optional cards opened by hand, belong to the client just cleared
  function dropPending(t) {
    delete cardPin[t];
    if (aiBusy === t) { aiGen++; aiBusy = null; }
    if (interpMsg.tool === t) interpMsg = { tool: null, kind: '', text: '' };
    if (interpUndo && interpUndo.tool === t) interpUndo = null;
    if (scanBusy === t) { scanGen++; scanBusy = null; }
    if (t === 'ex' && suggestBusy) { scanGen++; suggestBusy = false; }   // v21
    if (scanInfo && scanInfo.tool === t) scanInfo = null;
    delete coachOpen[t]; delete interpOpen[t];
    if (t === 'ex') exTopOpen = false;
    retest.tool = null;
  }
  function onHome() {
    if (els.home.disabled || els.sheet.hidden) return;
    var list = unsavedTools();
    if (!list.length) { goHome(false); return; }
    els.homeList.innerHTML = list.map(function (t) {
      return '<li class="has-data"><span class="cl-t">' + TOOL_NAMES[t] + '</span><span class="cl-d">' + esc(contentLine(t)) + '</span></li>';
    }).join('');
    openModal(els.homeDialog, els.homeKeep);
  }
  // the clinic store has the session, or can't take it now: at once when nothing is waiting, else after one sync (at most
  // 4 s; past that the queue carries on in the background and the bar at the top says what is waiting)
  function afterUpload(done) {
    if (!CLOUD || !CLOUD.signedIn()) { done(null); return; }
    if (!CLOUD.status().pending) { done(CLOUD.status()); return; }
    var over = false, timer = setTimeout(finish, 4000);
    function finish() { if (over) return; over = true; clearTimeout(timer); done(CLOUD.status()); }
    els.home.disabled = true; els.homeLabel.textContent = 'Uploading…';
    CLOUD.sync().then(finish, finish);
  }
  // clearUnsaved: Clear them (the entries listed as not in a record go too); else Keep them (they stay as they are)
  function goHome(clearUnsaved) {
    closeModal(false);
    var from = homeFrom || { tool: state.tool, name: '', saved: false };
    afterUpload(function (st) {
      els.home.disabled = false; els.homeLabel.textContent = 'Return home';
      if (els.sheet.hidden) return;                    // the report was closed meanwhile (Back, Escape, a sign-out)
      var unsaved = clearUnsaved ? [] : unsavedTools(), gone = {};
      var snap = JSON.parse(draftJson()), wasLoaded = exLoaded;
      TOOLS.concat(['ex']).forEach(function (t) { if (unsaved.indexOf(t) < 0) { gone[t] = 1; resetTool(t); } });
      tidyState();
      if (gone.ex) exLoaded = null;
      Object.keys(gone).forEach(function (t) { delete cardPin[t]; });
      // an AI summary or a scan still on its way belongs to the client just cleared: drop it when it arrives
      if (aiBusy && gone[aiBusy]) { aiGen++; aiBusy = null; }
      if (interpMsg.tool && gone[interpMsg.tool]) interpMsg = { tool: null, kind: '', text: '' };
      if (interpUndo && gone[interpUndo.tool]) interpUndo = null;
      if (scanBusy && gone[scanBusy]) { scanGen++; scanBusy = null; }
      if (suggestBusy && gone.ex) { scanGen++; suggestBusy = false; }   // v21
      if (scanInfo && gone[scanInfo.tool]) scanInfo = null;
      Object.keys(gone).forEach(function (t) { delete coachOpen[t]; delete interpOpen[t]; });   // v18: folded again
      if (gone.ex) exTopOpen = false;
      // the report and its preview go (they hold the client's details)
      reportGen++;
      homeFrom = null;
      current = { file: null, blob: null, title: '' };
      els.pages.innerHTML = '';
      els.sheetTitle.textContent = 'Report';
      closeReport();
      state.tool = TOOLS.indexOf(state.screenTool) >= 0 ? state.screenTool : 'screen';
      // saved straight away, so closing the app now can't bring the old entries back
      clearTimeout(saveTimer);
      try { localStorage.setItem(STORE, draftJson()); } catch (e) { /* storage unavailable */ }
      closePick(false);
      render();
      window.scrollTo(0, 0);
      keepAwake();                                     // nothing entered now: the screen may sleep again
      focusQuiet(pickBtn());
      toast(homeMessage(from, st, !gone[from.tool]), { label: 'Undo', run: function () { undoHome(snap, wasLoaded); } });
    });
  }
  // 'Uploaded to Jane Doe’s clinic record — ready for the next client' and the like
  function homeMessage(from, st, kept) {
    var who = from.name ? from.name + '’s' : 'the client’s', lead;
    if (!from.saved) lead = 'Not saved to a client record';
    else if (!CLOUD) lead = 'Saved to ' + who + ' record on this device';
    else if (st && !st.pending) lead = 'Uploaded to ' + who + ' clinic record';
    else if (st && st.denied) lead = 'Saved on this device, not uploaded (see the bar at the top)';
    else if (st && st.offline) lead = 'Saved on this device, uploads when back online';
    else lead = 'Saved, still uploading';
    return lead + (kept ? ' — kept on this device for later' : ' — ready for the next client');
  }
  function undoHome(snap, wasLoaded) {
    state = snap;
    tidyState();
    exLoaded = wasLoaded;
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE, draftJson()); } catch (e) { /* storage unavailable */ }
    closePick(false);
    render();
    window.scrollTo(0, 0);
    keepAwake();
    focusQuiet(pickBtn());
    toast('Back as it was');
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
  // v15: the Exercises tab works the same way: from Screening it returns to the Exercises page last in use; a second
  // tap, already there, scrolls to the top and opens its page picker
  function onSectionTab(section) {
    var here = section === 'ex' ? state.tool === 'ex' : state.tool !== 'ex';
    if (!here) {
      closePick(false);
      switchTool(section === 'ex' ? 'ex' : state.screenTool);
      if (section === 'ex') exPageOpened();
      return;
    }
    window.scrollTo(0, 0);
    openPick(false);
  }
  // an Exercises page chosen from the heading's menu (choosing the one showing just closes the menu)
  function pickPage(page) {
    closePick(false);
    if (page !== state.exPage && EX_PAGES.indexOf(page) >= 0) setExPage(page);
    focusQuiet(pickBtn());                             // the page's heading, for keyboard users (no scroll, no keyboard)
  }
  function setExPage(page) {
    state.exPage = page;
    saveDraft();
    if (state.tool !== 'ex') return;
    render();
    window.scrollTo(0, 0);
    exPageOpened();
  }
  // the library and the templates are shared in cloud mode: opening their page asks the store for changes (at most every 30 s)
  function exPageOpened() {
    if (CLOUD && state.tool === 'ex' && state.exPage !== 'builder') CLOUD.sync({ throttle: true });
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
  function menuItems() { return Array.prototype.slice.call(els.moreMenu.querySelectorAll('[role="menuitem"]')).filter(function (x) { return !x.hidden; }); }
  function openMenu(last) {
    closePick(false);
    var demo = demoAllowed();                          // v18: Show example results, on an empty page only
    els.demoItem.hidden = !demo; els.demoSep.hidden = !demo;
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
  // one tool's line in a list: 'Example Athlete · 14 results', 'no name · details only', 'nothing entered'
  // (Clear all data, and v16's Return home check)
  function contentLine(t) {
    var c = toolContent(t), u = c.unit || ['result', 'results'];
    return !c.any ? 'nothing entered'
      : (c.name || 'no name') + ' · ' + (c.results ? c.results + ' ' + (c.results === 1 ? u[0] : u[1]) : 'details only');
  }
  function openClearDialog() {
    var any = false;
    els.clearList.innerHTML = TOOLS.concat(['ex']).map(function (t) {
      var c = toolContent(t);
      if (c.any) any = true;
      return '<li' + (c.any ? ' class="has-data"' : '') + '><span class="cl-t">' + TOOL_NAMES[t] + '</span><span class="cl-d">' + esc(contentLine(t)) + '</span></li>';
    }).join('');
    if (!any) { toast('Nothing to clear — every section is already empty'); return; }
    openModal(els.clearDialog, els.clearCancel);
  }
  function clearAllData() {
    TOOLS.forEach(function (t) { state[t] = freshTool(t); });
    state.ex = freshEx();                              // v15: the draft program only; the library, templates and records stay
    tidyState();
    exLoaded = null;
    cardPin = {};                                      // every details card open again (v11); Tests today is kept
    coachOpen = {}; interpOpen = {}; exTopOpen = false; // v18: the optional cards fold again
    // an AI draft still on its way belongs to the athlete just cleared: drop it when it arrives
    aiGen++;
    aiBusy = null; interpMsg = { tool: null, kind: '', text: '' }; interpUndo = null;
    scanBusy = null; scanInfo = null; scanGen++; suggestBusy = false;
    releaseWake();                                     // nothing entered now: the screen may sleep again
    // drop the last report built (it holds the athlete's details) and its preview, and one still being built (v16)
    reportGen++;
    homeFrom = null;
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

  function interpShown(t) {                            // v18: open when it holds text, is being drafted, has a message, or was opened
    return !!interpOpen[t] || !blank(state[t].interp.text) || aiBusy === t || interpMsg.tool === t;
  }
  function interpCardHtml() {
    var t = state.tool, it = state[t].interp;
    return '<section class="card interp' + (interpShown(t) ? '' : ' folded') + '" id="interpCard" aria-labelledby="interpTitle">' +
      '<div class="card-head"><div class="fold-t"><h2 id="interpTitle">Interpretation</h2>' +
      '<p class="interp-help">Optional: a short summary for the ' + (t === 'screen' ? 'athlete and coach' : 'patient') + ', printed near the top of the report.</p></div>' +
      '<div class="interp-bar"><button type="button" class="ghost ai-draft" data-action="ai-draft">' + SPARKLE + '<span data-label>Draft with AI</span></button>' +
      '<button type="button" class="quiet interp-own" data-action="interp-own" aria-controls="interpText">Write my own</button></div></div>' +
      '<span class="interp-status" id="interpStatus" role="status" aria-live="polite"></span>' +
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
    var fold = !interpShown(t);                       // v18: folded to its one line until used
    if (card.classList.contains('folded') !== fold) { card.classList.toggle('folded', fold); if (!fold) fitInterp(); }
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
  // the summary's interpretation line. v18: 'Add an AI interpretation' drafts straight away (until v17 it scrolled down to
  // a second button); it shows once there is something to interpret, and says when a draft is under way or didn't work
  // v19: the exercise program on a report's summary: Add an exercise program (once the page has a name, v20: or
  // results), or while linked, Exercise program included (a tap opens it in the builder)
  function exLinkHtml(t) {
    if (linkedTool() === t) {
      var n = exCounts().exercises;
      // v20: '· 4 exercises' kept together when the line wraps on a narrow phone
      return n ? '<button type="button" class="quiet ex-flag ok" data-action="goto-program"><span>✓ Exercise program included <span class="nw">· ' + n + (n === 1 ? ' exercise' : ' exercises') + '</span></span></button>'
        : '<button type="button" class="quiet ex-flag stale" data-action="goto-program">' + EX_ICON + 'Exercise program: no exercises yet</button>';
    }
    if (blank(state[t].meta.name) && !hasResults(t)) return '';   // v20: results without a name yet count too
    return '<button type="button" class="quiet ex-flag" data-action="add-program">' + EX_ICON + 'Add an exercise program</button>';
  }
  function interpFlagHtml(t, c) {
    var it = state[t].interp;
    if (aiBusy === t) return '<p class="interp-flag busy" role="status">' + SPARKLE + 'Drafting the interpretation…</p>';
    if (interpMsg.tool === t && interpMsg.kind === 'error' && !interpMsg.blocker) return '<button type="button" class="quiet interp-flag stale" data-action="goto-interp">The AI draft didn’t work: see Interpretation</button>';
    if (blank(it.text)) return blocker(c) ? '' : '<button type="button" class="quiet interp-flag" data-action="ai-draft">' + SPARKLE + 'Add an AI interpretation</button>';
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
  function openInterp() {                              // v18: Write my own on the folded card: the box, ready to type in
    var t = state.tool, card = $('interpCard');
    interpOpen[t] = true;
    if (!card) return;
    card.classList.remove('folded');
    fitInterp();
    var ta = $('interpText');
    if (ta) ta.focus();
  }
  function onInterpInput(el) {
    interpOpen[state.tool] = true;                     // v18: emptied by hand, it stays open
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
  // v24: the evidence guide(s) that go with an interpretation request, by tool (interpretation.json › interp_guides, e.g.
  // {"ham": ["muscle-strains"], "acl": ["acl"]}; absent or empty = none). Without their sources lists, within a cap.
  function interpGuideText(t) {
    var cfg = DATA.ai || {}, map = cfg.interp_guides && typeof cfg.interp_guides === 'object' ? cfg.interp_guides : {};
    var ids = Array.isArray(map[t]) ? map[t].filter(function (id) { return typeof id === 'string'; }) : [], cap = cfg.interp_guide_max_chars || 36000, parts = [];
    ids.forEach(function (id) {
      var body = bodyOf(DATA.guides[id], cap), meta = DATA.guideIndex && DATA.guideIndex.guides ? DATA.guideIndex.guides[id] : null;
      if (body) parts.push('### Guide: ' + (clean1(meta && meta.title) || id) + '\n\n' + body);
    });
    return parts.length ? 'Evidence guide for this condition (a draft the clinic is reviewing; use it for what to focus on next and for the targets it names; never for a diagnosis or a clearance):\n\n' + parts.join('\n\n') : '';
  }
  function callClaude(key, payload, extra) {           // extra (v24): text sent after the payload but not part of the draft's basis
    var cfg = DATA.ai;
    var body = {
      model: cfg.model, max_tokens: cfg.max_tokens || 2000, system: [].concat(cfg.system || []).join('\n'),
      messages: [{ role: 'user', content: (cfg.request || 'Write the interpretation for these test results.') + '\n\n' + payload + (extra ? '\n\n' + extra : '') }]
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
    function fail(msg, extra) { interpMsg = Object.assign({ tool: t, kind: 'error', text: msg }, extra || {}); refresh(); }
    if (why) return fail(why, { blocker: true });
    if (!DATA.ai || !DATA.ai.model) return fail('The AI settings file (interpretation.json) didn’t load. Reopen the app while online.');
    var key = aiKey();
    if (!key) { openAiSettings(draftInterp, 'To draft interpretations, the app needs a Claude API key. ' + ONCE_NOTE()); return; }
    if (navigator.onLine === false) return fail('No internet connection. Connect to draft with AI, or type your own interpretation.', { offline: true });
    var payload = interpPayload(t, c), basis = hashStr(payload), gen = aiGen;
    aiBusy = t; interpUndo = null;
    refresh();                                       // v18: the card unfolds and the summary says it's drafting
    callClaude(key, payload, interpGuideText(t)).then(function (text) {   // v24: the condition's evidence guide on rehab reports
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
    if (!files.length || scanBusy || (exm && suggestBusy)) return;
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
      btn.querySelector('[data-label]').textContent = scanBusy ? 'Reading…' : scanLabel(t);
      var inp = $('scanFiles');
      if (inp) inp.disabled = !!scanBusy;
    }
    var ib = $('importBtn');                           // v18: the Import results button says it's reading too
    if (ib) { ib.classList.toggle('busy', !!scanBusy); ib.querySelector('[data-label]').innerHTML = scanBusy ? 'Reading…' : IMPORT_LABEL; }
    var sc = $('stripScan');                           // the strip's camera (v11) says the same
    if (sc) {
      sc.classList.toggle('busy', !!scanBusy);
      sc.setAttribute('aria-disabled', String(!!scanBusy));
      sc.title = scanBusy ? 'Reading…' : (t === 'ex' ? 'Scan exercise page' : 'Scan notes');
    }
    var sg = $('exSuggest');                           // v21: Suggest from the report says it's working
    if (sg) { sg.classList.toggle('busy', suggestBusy); sg.setAttribute('aria-disabled', String(suggestBusy)); sg.querySelector('[data-label]').textContent = suggestBusy ? 'Suggesting…' : 'Suggest from the report'; }
    if (!bar) return;
    var info = scanInfo && scanInfo.tool === t ? scanInfo : null;
    if (!info) { bar.hidden = true; bar.innerHTML = ''; bar.className = 'scan-bar'; return; }
    bar.hidden = false;
    bar.className = 'scan-bar ' + info.kind + (info.ai ? ' ai' : '');
    var close = '<button type="button" class="quiet scan-x" data-action="scan-close" aria-label="Close this message">×</button>';
    var ico = info.ai ? SPARKLE : CAMERA;              // v21: a suggestion from the report, not a photo
    if (info.kind === 'busy') { bar.innerHTML = '<span class="scan-ico">' + ico + '</span><span class="scan-msg">' + esc(info.text) + '</span>'; return; }
    if (info.kind === 'error') { bar.innerHTML = '<span class="scan-msg">' + esc(info.text) + '</span>' + close; return; }
    var extra = [info.date ? 'test date' : '', info.mass ? 'body mass' : ''].filter(Boolean);
    var html = '<span class="scan-ico">' + ico + '</span>' + (info.ai ? (info.kind === 'empty'
      ? '<span class="scan-msg">Claude didn’t find exercises in the library for the ' + esc(TOOL_NAMES[info.from]) + ' results. Nothing was changed.</span>'
      : '<span class="scan-msg"><b>Claude suggested ' + info.n + (info.n === 1 ? ' exercise' : ' exercises') + ' from the ' + esc(TOOL_NAMES[info.from]) + ' report' + (info.added ? ', after the ones already there' : '') +
        (info.own ? (info.own === info.n ? (info.n === 1 ? ', not in the library' : ', none in the library') : ', ' + info.own + ' not in the library') : '') + '.</b> Check each one, and its sets and reps, before creating the handout.' +
        (info.own ? ' More › Save to library keeps an exercise of Claude’s for next time.' : '') + '</span>')
      : t === 'ex' ? (info.kind === 'empty'
      ? '<span class="scan-msg">No exercises were found on the ' + (info.photos > 1 ? 'photos' : 'photo') + '. Check it’s a photo of the exercise page, or try a clearer photo. Nothing was changed.</span>'
      : '<span class="scan-msg"><b>Filled ' + info.n + (info.n === 1 ? ' exercise' : ' exercises') + ' from your notes.</b> Check them against the page before creating the handout.' +
        (info.matched ? ' ' + info.matched + ' matched your library.' : '') + '</span>')
      : info.kind === 'empty'
      ? '<span class="scan-msg">Nothing on the photo matched the ' + esc(TOOL_NAMES[t]) + ' tests' + (extra.length ? ' (only the ' + extra.join(' and ') + ')' : '') + '. Check you’re on the right tab, or try a clearer photo.</span>'
      : '<span class="scan-msg"><b>Filled ' + info.n + (info.n === 1 ? ' result' : ' results') + (extra.length ? ' and the ' + extra.join(' and ') : '') + ' from your notes.</b> Check the highlighted boxes against the paper or screenshot before creating the report.</span>');
    if (info.undo) html += '<button type="button" class="quiet scan-undo" data-action="scan-undo">Undo</button>';
    html += close;
    if (info.unclear && info.unclear.length) {
      html += '<div class="scan-unclear"><b>' + (info.ai ? 'From Claude:' : 'Worth a look:') + '</b><ul>' + info.unclear.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div>';
    }
    bar.innerHTML = html;
  }

  // ------------------------------------------------------------------ exercise program (v10)
  // A handwritten exercise page becomes an editable table and a branded PDF handout. The practitioner photographs the
  // page (Scan exercise page) or types the exercises; Claude only ever sees the photos and a fixed request. The table is
  // a flat list of section headings and exercise rows, so moving a row up or down past a heading moves it into that
  // section. Every value is free text ("8–12", "30 s", "AMRAP", "Red band"). Exercise, Sets, Reps and Load always show;
  // Rest, Tempo, Side and Notes are a row's details, shown when written (as columns only when used anywhere) or opened
  // with More. The program is kept in the draft (state.ex) until Clear all; from v15 Create handout with a patient name
  // also saves it to the client's record (an Exercises session holding the program as printed).
  var EX_FIELDS = ['name', 'sets', 'reps', 'load', 'rest', 'tempo', 'side', 'notes'];
  var EX_MAIN = ['sets', 'reps', 'load'];
  var EX_DETAIL = ['rest', 'tempo', 'side', 'notes'];
  var EX_LABEL = { name: 'Exercise', sets: 'Sets', reps: 'Reps', load: 'Load', rest: 'Rest', tempo: 'Tempo', side: 'Side', notes: 'Notes' };
  var EX_LEN = { name: 120, notes: 300, heading: 80, title: 120, instructions: 1000 };   // characters kept (other boxes: 60)
  var EX_WORDS = { name: 1, load: 1, side: 1, notes: 1 };                              // boxes that start with a capital
  // v17: delete is a bin (it shows on every row now, beside More, so it reads as delete rather than close)
  var ICON_TRASH = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.5h6V7"/></svg>';
  var GRIP = '<svg class="grip-dots" viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false" fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>';

  // link (v19): the Screening tool whose report this program prints after ('' when it prints on its own)
  function freshEx() { return { meta: { name: '', date: todayIso(), practitioner: userName() }, title: '', instructions: '', items: [], seq: 1, scanned: {}, cardOpen: true, link: '', plan: freshPlan() }; }
  // v23: what Suggest from the report asks before it suggests (the person and the setting); kept with the program and saved with it.
  // v24: plus a condition (an id from guides/index.json, 'none' for none) and its stage, which pick the evidence guides sent
  var PLAN = { sessions: ['2', '3', '4'], setting: ['Gym', 'Home', 'Both'], level: ['New', 'Trained'], weeks: ['4', '6', '8'] };
  var PLAN_LABEL = { sessions: 'Sessions a week', setting: 'Where', level: 'Experience (new to training, or trained)', weeks: 'Block (weeks)' };
  var STAGES_DEFAULT = ['Early', 'Middle', 'Late', 'Ongoing'];
  function stageList() { var g = DATA.guideIndex; return g && Array.isArray(g.stages) && g.stages.length ? g.stages.map(clean1).filter(Boolean) : STAGES_DEFAULT; }
  function freshPlan() { return { sessions: '3', setting: 'Gym', level: 'Trained', weeks: '6', condition: 'none', stage: '' }; }
  function tidyPlan(p) {
    var out = freshPlan();
    if (p && typeof p === 'object') {
      Object.keys(PLAN).forEach(function (k) { var v = k === 'level' && p[k] === 'New to training' ? 'New' : p[k]; if (PLAN[k].indexOf(v) >= 0) out[k] = v; });
      if (typeof p.condition === 'string' && /^[a-z0-9-]{1,32}$/.test(p.condition)) out.condition = p.condition;   // v24: checked against the index when used
      if (typeof p.stage === 'string' && stageList().indexOf(p.stage) >= 0) out.stage = p.stage;
    }
    if (out.condition === 'none') out.stage = '';
    return out;
  }
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
      o.open = it.open === true;                       // More open (v18: a section's too, for its Move up / Move down)
      if (it.kind === 'section') o.heading = exStr(it.heading);
      else {
        EX_FIELDS.forEach(function (f) { o[f] = exStr(it[f]); });
        o.lib = typeof it.lib === 'string' && LIB_ID.test(it.lib) ? it.lib : '';   // v15: the library exercise it came from
        if (!o.lib && typeof it.libWas === 'string' && LIB_ID.test(it.libWas)) o.libWas = it.libWas;   // v17: its link before the name was typed over
        if (!blank(it.why)) o.why = clean1(it.why).slice(0, 120);   // v21: the finding a suggested exercise is for
      }
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
    x.link = TOOLS.indexOf(x.link) >= 0 ? x.link : ''; // v19: the report it prints after (drafts from v18: none)
    x.plan = tidyPlan(x.plan);                         // v23
    delete x.editing;                                  // v18: no Edit mode (v11–v17 kept it off the draft anyway)
  }
  function newExRow(o) {
    var r = { kind: 'ex', id: 'r' + (state.ex.seq++), open: false };
    EX_FIELDS.forEach(function (f) { r[f] = o && o[f] ? o[f] : ''; });
    r.lib = o && typeof o.lib === 'string' && LIB_ID.test(o.lib) ? o.lib : '';
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
  function renderExPage() {                            // v15: whichever Exercises page is in use
    if (state.exPage === 'library') renderLibrary();
    else if (state.exPage === 'templates') renderTemplates();
    else renderEx();
  }
  function renderEx() {
    els.entry.innerHTML = '<div class="pagehead">' + pickHtml('ex') + '<p>' + esc(HEAD.ex[1]) + '</p></div>' + exPatientCard() + exProgramCard();
    fitExNotes();
    fitExWraps();
    applyExMarks();
    renderScanBar();
    refreshEx();
    showCard();
  }
  // v15: the patient card has Choose client and the name box offers saved clients, as on the report tools; picking one
  // loads that client's last saved program. The client bar under the card or strip says what the record holds.
  function exPatientCard() {
    var lt = linkedTool();                             // v19: while linked, the name and date are the report's
    return '<section class="card athlete ex-patient" id="athleteCard" tabindex="-1" aria-labelledby="exPatientH"' + (state.ex.cardOpen === false ? ' hidden' : '') + '>' + cardHead('ex', 'exPatientH') +
      '<div class="fields">' +
      field('ex', 'name', 'Patient name', { cls: 'wide', words: true, readonly: !!lt }) + field('ex', 'date', 'Date', { type: 'date', readonly: !!lt }) +
      field('ex', 'practitioner', 'Clinician', { words: true }) +
      '</div>' + (lt ? '<p class="note ex-linknote">The name and date come from the ' + TOOL_NAMES[lt] + ' report.</p>' : '') + '</section>' + stripHtml('ex') + '<div class="scan-bar" id="scanBar" role="status" aria-live="polite" hidden></div><div class="client-bar" id="clientBar" hidden></div>';
  }
  // v18: the exercises first. The title, general instructions and Save as template sit under them (folded to
  // "+ Title and instructions" while both are empty); Start from template sits with the add buttons while the program is
  // empty. No Edit mode: every row has More and its bin, and More holds Move up / Move down.
  var exTopOpen = false;                               // + Title and instructions tapped (this visit only)
  function exProgramCard() {
    var x = state.ex, rows = x.items.length > 0, top = exTopOpen || !blank(x.title) || !blank(x.instructions);
    return '<section class="card ex-prog" id="exCard" aria-labelledby="exProgH"><div class="card-head"><h2 id="exProgH">Program</h2><div class="ex-headr"><span class="ex-count" id="exCount"></span></div></div>' +
      '<div class="ex-table" id="exTable">' + exTableHtml() + '</div>' +
      // v16: what a row's handle does (read with it), and where a moved row landed (for screen readers)
      '<span class="vh" id="exGripHint">Drag up or down, or use the arrow keys.</span><span class="vh" id="exLive" role="status" aria-live="polite"></span>' +
      '<div class="ex-add"><button type="button" class="ghost" id="exAddLib" data-action="ex-lib" aria-haspopup="dialog">+ From library</button>' +
      '<button type="button" class="ghost" id="exAdd" data-action="ex-add">+ Exercise</button>' +
      '<button type="button" class="ghost" id="exAddSec" data-action="ex-add-sec">+ Section</button>' +
      // v15: templates (whole programs to start from)
      '<button type="button" class="ghost" id="tplStart" data-action="tpl-start" aria-haspopup="dialog"' + (rows ? ' hidden' : '') + '>Start from template</button>' +
      // v21: Claude picks exercises from the library for the linked report's results
      '<button type="button" class="ghost ex-suggest" id="exSuggest" data-action="ex-suggest"' + (suggestTool() ? '' : ' hidden') + '>' + SPARKLE + '<span data-label>Suggest from the report</span></button></div>' +
      '<div class="ex-top' + (top ? '' : ' folded') + '" id="exTop">' + exTopHtml(top, rows) + '</div></section>';
  }
  function exTopHtml(open, rows) {
    var x = state.ex;
    return (open ? '<label class="f" for="ex-title"><span>Title</span><input id="ex-title" data-ex="title" type="text" value="' + esc(x.title) + '" maxlength="' + EX_LEN.title + '"' +
      ' placeholder="Optional, e.g. Knee rehab – phase 2" autocapitalize="sentences" autocomplete="off" enterkeyhint="next"></label>' +
      '<label class="f" for="ex-instructions"><span>General instructions</span><textarea id="ex-instructions" data-ex="instructions" rows="2" maxlength="' + EX_LEN.instructions + '"' +
      ' placeholder="Optional, e.g. 3 × per week. Ice after if sore." autocapitalize="sentences">' + esc(x.instructions) + '</textarea></label>' : '') +
      '<div class="ex-tplbar">' + (open ? '' : '<button type="button" class="quiet" id="exTopOpen" data-action="ex-top-open" aria-controls="exTop">+ Title and instructions</button>') +
      '<button type="button" class="quiet" id="tplSave" data-action="tpl-save" aria-haspopup="dialog"' + (rows ? '' : ' hidden') + '>Save as template</button></div>';
  }
  // v15: an exercise row linked to a library exercise (the entry, or null when unlinked or the entry has gone)
  function exLinked(it) { return it && it.kind === 'ex' && it.lib ? libGet(it.lib) : null; }
  // under the name of a linked row: the cues (as printed on the handout) and ▶ when there is a video
  function exLibStripHtml(it) {
    var e = exLinked(it);
    if (!e || (!e.cues.length && !hasVideo(e))) return '';
    return '<span class="el-cues">' + esc(e.cues.join(' · ')) + '</span>' +   // v18: no Draft badge here (the library page shows it)
      (hasVideo(e) ? '<button type="button" class="el-play" data-action="ex-video" aria-label="Watch ' + esc(e.name) + ' video">' + PLAY + '</button>' : '');
  }
  // in the row's details (More) and in Edit mode: Unlink, or Link to an exercise of the same name, or Save to library
  function exLibActHtml(it) {
    // v17: Swap (any row with an exercise in it): another exercise from the library in this row's place, its dose kept
    var swap = blank(it.name) && !exLinked(it) ? '' : '<button type="button" class="quiet el-act" data-action="ex-swap" aria-haspopup="dialog">Swap for another exercise</button>';
    if (exLinked(it)) return swap + '<button type="button" class="quiet el-act" data-action="ex-unlink">Unlink<span class="vh"> from the library</span></button>';
    if (blank(it.name)) return '';
    var m = E.libMatch(it.name, libList());
    return swap + (m ? '<button type="button" class="quiet el-act" data-action="ex-linkto" data-lib="' + esc(m.id) + '">Link to “' + esc(m.name) + '”</button>'
      : '<button type="button" class="quiet el-act" data-action="ex-savelib" aria-haspopup="dialog">Save to library</button>');
  }
  // v17: the link follows the name. A linked row whose name is typed over keeps its exercise while the name still holds
  // that exercise's name (or one of its other names) as whole words, e.g. "Split squat (DB)", and isn't exactly another
  // library exercise ("Rear-foot elevated split squat"); otherwise the link goes, so the handout never prints another
  // exercise's cues or video, and it comes back if the name returns to it. Only typing does this: a library exercise
  // renamed later doesn't unlink its rows. (A suggestion, Link to, Unlink, Swap and Save to library are chosen by hand and
  // forget the old link.)
  function nameHolds(name, e) {
    var k = ' ' + E.libKey(name) + ' ';
    return [e.name].concat(Array.isArray(e.aliases) ? e.aliases : []).some(function (n) { var nk = E.libKey(n); return !!nk && k.indexOf(' ' + nk + ' ') >= 0; });
  }
  function exRelink(it) {
    var cur = it.lib ? libGet(it.lib) : null, was = !it.lib && it.libWas ? libGet(it.libWas) : null, e = cur || was;
    if (!e) return false;
    var m = E.libMatch(it.name, libList()), holds = nameHolds(it.name, e) && (!m || m.id === e.id);
    if (cur && !holds) { it.libWas = cur.id; it.lib = ''; return true; }
    if (was && holds) { it.lib = was.id; delete it.libWas; return true; }
    return false;
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
    if (!items.length) return '<p class="ex-empty">No exercises yet. Add them below, start from a template, ' + (suggestTool() ? 'scan the exercise page, or let Claude suggest them from the report.' : 'or scan the exercise page.') + '</p>';   // v21
    var used = exUsed(), n = 0, s = 0, last = items.length - 1;
    var html = '<div class="ex-cols" aria-hidden="true"><span class="c-name">Exercise</span><span class="c-sets">Sets</span><span class="c-reps">Reps</span><span class="c-load">Load</span></div>';
    // "+ Exercise" under the last row of each section (v11); the last section has the one under the table
    var groupEnd = null, groupName = '';
    items.forEach(function (it, i) {
      if (it.kind === 'section' && groupEnd) {
        var where = esc(groupName ? 'in ' + groupName : 'before the first section');
        html += '<div class="ex-add-in"><button type="button" class="quiet" data-action="ex-add-in" data-after="' + groupEnd + '">+ Exercise<span class="vh"> ' + where + '</span></button>' +
          '<button type="button" class="quiet" data-action="ex-lib-in" data-after="' + groupEnd + '" aria-haspopup="dialog">+ From library<span class="vh"> ' + where + '</span></button></div>';
      }
      if (it.kind === 'section') { groupName = clean1(it.heading) || 'section ' + (s + 1); }
      groupEnd = it.id;
      var sec = it.kind === 'section', who = sec ? 'Section ' + (++s) : 'Exercise ' + (++n), lower = who.toLowerCase(), id = 'ex-' + it.id;
      // More (exercises) and the bin; v18: Move up / Move down are in More (until v17 they needed Edit mode)
      // a section's More holds just its Move up / Move down (dragging its handle, or the arrow keys on it, move it too)
      var acts = '<div class="ex-acts"><button type="button" class="ex-btn ex-more" id="' + id + '-more" data-action="ex-more" aria-expanded="' + !!it.open + '" aria-controls="' + id + (sec ? '-libact' : '-det') + '">' +
          (it.open ? 'Less' : 'More') + '<span class="vh"> ' + (sec ? 'options' : 'details') + ', ' + lower + '</span></button>' +
        '<button type="button" class="ex-btn ex-del" id="' + id + '-del" data-action="ex-del" aria-label="Delete ' + lower + '">' + ICON_TRASH + '</button></div>';
      var moves = '<button type="button" class="quiet el-move" id="' + id + '-up" data-action="ex-up"' + (i === 0 ? ' disabled' : '') + '>Move up<span class="vh"> ' + lower + '</span></button>' +
        '<button type="button" class="quiet el-move" id="' + id + '-down" data-action="ex-down"' + (i === last ? ' disabled' : '') + '>Move down<span class="vh"> ' + lower + '</span></button>';
      if (sec) {
        html += '<div class="ex-row ex-sec' + (it.open ? ' open' : '') + '" id="' + id + '" data-id="' + it.id + '" role="group" aria-label="' + who + '">' + gripHtml(it, lower, '') +
          '<input class="ex-in ex-heading" id="' + id + '-heading" data-f="heading" type="text" value="' + esc(it.heading) + '" maxlength="' + EX_LEN.heading + '"' +
          ' placeholder="Section heading, e.g. Warm-up" aria-label="' + who + ' heading" autocapitalize="sentences" autocomplete="off" enterkeyhint="next">' + acts +
          (it.open ? '<div class="ex-libact on" id="' + id + '-libact">' + moves + '</div>' : '') + '</div>';
        return;
      }
      // v15: the name column also holds the library strip and the link actions (the name's suggestions open under its box)
      var strip = exLibStripHtml(it);
      html += '<div class="ex-row" id="' + id + '" data-id="' + it.id + '" role="group" aria-label="' + who + '">' + gripHtml(it, lower, n) +
        '<div class="ex-namecol"><div class="ex-nameb">' + exInput(it, 'name', who) + '</div>' +
        '<div class="ex-lib" id="' + id + '-lib"' + (strip ? '' : ' hidden') + '>' + strip + '</div>' +
        (blank(it.why) ? '' : '<div class="ex-why">' + SPARKLE + '<span>' + esc(it.why) + '</span></div>') +   // v21: the finding a suggested exercise is for (not printed)
        '<div class="ex-libact' + (it.open ? ' on' : '') + '" id="' + id + '-libact"><span class="el-links" id="' + id + '-links">' + exLibActHtml(it) + '</span>' + moves + '</div></div>' +
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
    var c = exCounts(), cnt = $('exCount'), rows = state.ex.items.length > 0, ts = $('tplStart'), tv = $('tplSave');
    if (cnt) cnt.textContent = c.exercises ? c.exercises + (c.exercises === 1 ? ' exercise' : ' exercises') + (c.sections ? ' · ' + c.sections + (c.sections === 1 ? ' section' : ' sections') : '') : '';
    if (ts) ts.hidden = rows;                          // v18: Start from template while the program is empty, Save as template once it isn't
    if (tv) tv.hidden = !rows;
    var sg = $('exSuggest');                           // v21: while linked to a Performance screen or LL Strength report with results
    if (sg) sg.hidden = !suggestTool();
    syncCard(null);
    refreshExClientBar();
    renderExSummary(c);
    saveDraft();
  }
  function andList(a) { return a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : (a[0] || ''); }
  function renderExSummary(c) {
    var why = c.exercises ? '' : 'Add at least one exercise to create the handout.';
    // v19: linked to a report: one PDF with both, so the report has to be ready too (else its reason shows)
    var lt = linkedTool(), cand = reportFor(), nm = clean1(state.ex.meta.name), whose = nm ? nm + '’s ' : 'the ';
    if (lt && !why) { var rb = blocker(computeFor(lt), lt); if (rb) why = TOOL_NAMES[lt] + ' report: ' + rb.charAt(0).toLowerCase() + rb.slice(1); }
    var make = lt ? 'Create report + exercises' : 'Create handout';
    var linkHtml = lt ? '<div class="ex-link"><p class="ex-linkline">' + EX_ICON + '<span>Prints after ' + esc(whose + TOOL_NAMES[lt]) + ' report</span></p>' +
        '<div class="ex-linkacts"><button type="button" class="quiet" data-action="back-to-report">‹ Back to the report</button>' +
        '<button type="button" class="quiet" data-action="unlink-program">Print on its own</button></div></div>'
      : cand ? '<button type="button" class="quiet ex-flag" data-action="link-report" data-tool="' + cand + '">' + EX_ICON + 'Print with ' + esc(whose + TOOL_NAMES[cand]) + ' report</button>' : '';
    var cols = exColumns(), later = EX_DETAIL.filter(function (f) { return cols.indexOf(f) < 0; }).map(function (f) { return EX_LABEL[f]; });
    var laterText = later.length ? (later.length > 1 ? later.slice(0, -1).join(', ') + ' and ' + later[later.length - 1] : later[0]) + (later.length > 1 ? ' are' : ' is') + ' added when used.' : '';
    // v15: how many filled rows are linked to the library, and how many of those print a video QR code
    var linked = 0, vids = 0;
    state.ex.items.forEach(function (it) { var e = exFilled(it) && exLinked(it); if (e) { linked++; if (hasVideo(e)) vids++; } });
    // v18: the panel says it in two short lines (until v17: tiles, a column list and notes)
    var counts = c.exercises + (c.exercises === 1 ? ' exercise' : ' exercises') + (c.sections ? ' · ' + c.sections + (c.sections === 1 ? ' section' : ' sections') : '') +
      (vids ? ' · ' + vids + (vids === 1 ? ' video' : ' videos') : '');
    var prints = 'Prints ' + andList(cols.slice(1).map(function (f) { return EX_LABEL[f]; })) + '.' + (laterText ? ' ' + laterText : '');
    els.summary.innerHTML = '<div class="sum ex-sum"><div class="sum-scroll"><h2>Exercise handout</h2>' +
      '<p class="ex-sumline">' + esc(counts) + '</p><p class="fine ex-prints">' + esc(prints) + '</p>' +
      '</div><div class="sum-foot">' + linkHtml + '<button type="button" class="primary make" data-action="report"' + (why ? ' disabled' : '') + '>' + make + '</button>' +
      (why ? '<p class="fine">' + esc(why) + '</p>' : '') +
      '<p class="fine client-line">' + esc(clientLine('ex')) + '</p></div></div>';
    els.dock.innerHTML = '<div class="dt"><span class="ex-dock"><b>' + c.exercises + '</b> ' + (c.exercises === 1 ? 'exercise' : 'exercises') +
      (c.sections ? ' · <b>' + c.sections + '</b> ' + (c.sections === 1 ? 'section' : 'sections') : '') + '</span></div>' +
      '<button type="button" class="primary" data-action="report"' + (why ? ' disabled' : '') + '>' + dockMake(make) + '</button>';
    els.dock.classList.remove('has-check', 'has-both');
  }

  // ---- editing
  function onExInput(el) {
    var x = state.ex;
    if (el.dataset.meta) {
      // v19: while linked the name and date are the report's (read-only; an iPad may still open the date wheel)
      if (linkedTool() && (el.dataset.meta === 'name' || el.dataset.meta === 'date')) { followReport(); el.value = x.meta[el.dataset.meta]; return; }
      x.meta[el.dataset.meta] = el.value;
      refreshEx();
      if (el.dataset.meta === 'name') suggestClients('ex', el.value);   // v15: saved clients, as on the report tools
      return;
    }
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
    if (it.kind === 'ex' && f === 'name') {             // v15: the library's suggestions, and Link to / Save to library follow the name
      var relinked = exRelink(it);                     // v17: and so does the link itself
      exSuggest(row, el, it);
      var act = $('ex-' + it.id + '-links'), ah = exLibActHtml(it);   // v18: the links only (Move up / down stay)
      if (act && act._h !== ah) { act.innerHTML = ah; act._h = ah; }
      var lst = relinked && $('ex-' + it.id + '-lib'), lsh = relinked ? exLibStripHtml(it) : '';
      if (lst) { lst.innerHTML = lsh; lst._h = lsh; lst.hidden = !lsh; }
    }
    refreshEx();
    if (it.kind === 'ex' && !blank(el.value)) foldNow('ex', true);   // the program under way: the patient card folds (v11)
  }
  // v15: typing an exercise name offers up to five library exercises under the box (as the client suggestions look); a
  // row already linked whose name is still the exercise's own offers nothing
  function exSuggest(row, el, it) {
    var e = exLinked(it), typed = clean1(el.value), box = row.querySelector('.ex-sugg');
    var list = typed.length >= 2 && !(e && typed === e.name) ? E.libSuggest(typed, libList(), 5) : [];
    if (!list.length) { if (box) { box.hidden = true; box.innerHTML = ''; } return; }
    if (!box) {
      box = document.createElement('div');
      box.className = 'suggest ex-sugg';
      el.parentNode.appendChild(box);
    }
    box.innerHTML = list.map(function (x) {
      var d = doseLine(x.dose);
      return '<button type="button" data-lib-sugg="' + esc(x.id) + '"><b>' + esc(x.name) + '</b>' + (d ? '<span>' + esc(d) + '</span>' : '') + '</button>';
    }).join('');
    box.hidden = false;
  }
  // a suggestion tapped: the exercise's name and link, and its default dose in every box still blank (typed values stay)
  function exTakeSuggestion(b) {
    var row = b.closest('.ex-row'), it = row && exItem(row.dataset.id), e = libGet(b.dataset.libSugg);
    if (!it || !e) return;
    it.name = e.name; it.lib = e.id;
    delete it.libWas;                                  // v17: a link chosen by hand
    DOSE.forEach(function (f) { if (blank(it[f])) it[f] = e.dose[f] || ''; });
    delete state.ex.scanned[it.id];
    hideSuggest();
    renderExTable();
    var nb = $('ex-' + it.id + '-name');
    if (nb) { focusEx(nb.id); try { nb.setSelectionRange(nb.value.length, nb.value.length); } catch (err) { /* not focused */ } }
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
    if (a === 'ex-top-open') {                         // v18: + Title and instructions: the two boxes, the title ready to type in
      exTopOpen = true;
      var top = $('exTop');
      if (top) { top.classList.remove('folded'); top.innerHTML = exTopHtml(true, x.items.length > 0); fitExNotes(); applyExMarks(); }
      focusEx('ex-title');
      return true;
    }
    if (a === 'ex-lib' || a === 'ex-lib-in') { openLibPick(b, a === 'ex-lib-in' ? b.dataset.after : ''); return true; }   // v15: + From library
    if (a === 'ex-suggest') { startExSuggest(); return true; }   // v21
    if (!a || a.indexOf('ex-') !== 0) return false;
    var row = b.closest('.ex-row'), i = row ? exIndex(row.dataset.id) : -1;
    if (i < 0) return true;
    var it = x.items[i];
    // v15: the row's library link
    if (a === 'ex-video') { var ve = exLinked(it); if (ve) openVideo(ve.name, ve.video); return true; }
    if (a === 'ex-unlink' || a === 'ex-linkto') {
      var to = a === 'ex-linkto' ? libGet(b.dataset.lib) : null;
      if (a === 'ex-linkto' && !to) return true;
      it.lib = to ? to.id : '';
      delete it.libWas;                                // v17: chosen by hand (a typed name won't bring the old link back)
      renderExTable();
      var back = $('ex-' + it.id + '-libact');           // keep the place: the row's new link action (no keyboard)
      focusQuiet(back && back.querySelector('button'));
      toast(to ? 'Linked to ' + to.name : 'Unlinked ' + (clean1(it.name) || 'the exercise') + ' from the library');
      return true;
    }
    if (a === 'ex-swap') { openLibPick(b, '', it.id); return true; }   // v17: another library exercise in this row's place
    if (a === 'ex-savelib') {
      var d = {};
      DOSE.forEach(function (f) { d[f] = it[f]; });
      openLibEditor(null, { name: clean1(it.name), dose: d, row: it.id });
      return true;
    }
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
    if (state.tool !== 'ex' || state.exPage !== 'builder') { saveDraft(); return; }
    renderExTable();
    var del = $('ex-' + it.id + '-del');               // keep the place without opening the keyboard
    if (del && del.getClientRects().length) focusEx(del.id);
    else if (it.kind === 'ex') focusEx('ex-' + it.id + '-more');
  }

  // ---- v16: reorder by sliding a row's handle (the dots beside its number) up or down; a line shows where it will land,
  // the page scrolls when the finger nears the top or bottom, Escape or a cancelled touch puts it back. With the handle
  // focused, the up and down arrow keys move the row one place. (Edit mode's up and down buttons still work too.)
  var exDrag = null;
  function gripHtml(it, lower, num) {
    return '<button type="button" class="ex-grip" id="ex-' + it.id + '-grip" aria-label="Reorder ' + lower + '" aria-describedby="exGripHint">' + GRIP +
      (num ? '<span class="ex-num">' + num + '</span>' : '') + '</button>';
  }
  function exMoved(it) {                               // after a move: the row flashes, its handle has focus, screen readers hear where
    var row = $('ex-' + it.id), i = exIndex(it.id), live = $('exLive');
    if (row) { row.classList.add('moved'); setTimeout(function () { row.classList.remove('moved'); }, 1200); }
    focusEx('ex-' + it.id + '-grip');
    if (live) live.textContent = 'Moved ' + exRowLabel(it, i) + ' to place ' + (i + 1) + ' of ' + state.ex.items.length + '.';
  }
  function onGripKey(e) {
    if (state.tool !== 'ex' || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !e.target.classList || !e.target.classList.contains('ex-grip')) return;
    e.preventDefault();
    var x = state.ex, row = e.target.closest('.ex-row'), i = row ? exIndex(row.dataset.id) : -1, j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= x.items.length) return;
    var it = x.items[i];
    x.items[i] = x.items[j]; x.items[j] = it;
    renderExTable();
    exMoved(it);
  }
  // the edges the page scrolls at: under the sticky bars at the top, above the dock (phones) at the bottom
  function dragEdges() {
    var top = 0, bottom = window.innerHeight;
    [els.appbar, els.cloudBar, $('athleteStrip')].forEach(function (el) {
      if (!el || el.hidden || !el.getClientRects().length) return;
      var r = el.getBoundingClientRect();
      if (r.top <= top + 2 && r.bottom > top) top = r.bottom;   // stuck at the top of the screen
    });
    if (els.dock && els.dock.getClientRects().length && getComputedStyle(els.dock).display !== 'none') bottom = Math.min(bottom, els.dock.getBoundingClientRect().top);
    return { top: top, bottom: bottom };
  }
  function onGripDown(e) {
    var g = e.target.closest && e.target.closest('.ex-grip');
    if (!g || exDrag || state.tool !== 'ex' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var tbl = $('exTable'), row = g.closest('.ex-row');
    if (!tbl || !row || !tbl.contains(row)) return;
    e.preventDefault();                                // no text selection or page scroll; focus stays where it was
    hideSuggest();
    exDrag = { g: g, row: row, tbl: tbl, id: row.dataset.id, pid: e.pointerId, y0: e.clientY, s0: window.scrollY, y: e.clientY, live: false, raf: 0 };
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* the window listeners follow the finger anyway */ }
    window.addEventListener('pointermove', onGripMove, true);
    window.addEventListener('pointerup', onGripUp, true);
    window.addEventListener('pointercancel', onGripCancel, true);
    window.addEventListener('keydown', onGripEsc, true);
  }
  function gripStart() {                               // the finger has moved: lift the row and measure the others
    var d = exDrag, rows = Array.prototype.slice.call(d.tbl.querySelectorAll('.ex-row[data-id]')), sy = window.scrollY;
    d.from = rows.indexOf(d.row);
    d.to = d.from;
    d.others = rows.filter(function (r) { return r !== d.row; }).map(function (r) {
      var b = r.getBoundingClientRect();
      return { top: b.top + sy, bottom: b.bottom + sy, mid: b.top + sy + b.height / 2 };
    });
    var tb = d.tbl.getBoundingClientRect();
    d.tblTop = tb.top + sy;                            // the table's extent: the row stays within it, and so does the scrolling
    d.tblBottom = tb.bottom + sy;
    d.line = document.createElement('div');
    d.line.className = 'ex-drop';
    d.line.hidden = true;
    d.line.setAttribute('aria-hidden', 'true');
    d.tbl.appendChild(d.line);
    d.row.classList.add('dragging');
    d.tbl.classList.add('sorting');
    document.documentElement.classList.add('row-dragging');
    d.live = true;
    d.raf = requestAnimationFrame(gripScroll);
  }
  function gripPlace() {                               // the row under the finger, and the line where it would land
    var d = exDrag, py = Math.max(d.tblTop, Math.min(d.tblBottom, d.y + window.scrollY)), k = 0;
    d.row.style.transform = 'translateY(' + Math.round(py - (d.y0 + d.s0)) + 'px)';
    d.others.forEach(function (o) { if (o.mid < py) k++; });
    d.to = k;
    if (k === d.from || !d.others.length) { d.line.hidden = true; return; }
    var y = k < d.others.length ? d.others[k].top : d.others[d.others.length - 1].bottom;
    d.line.style.top = Math.round(y - d.tblTop) + 'px';
    d.line.hidden = false;
  }
  function gripScroll() {                              // near an edge the page scrolls, faster the closer the finger
    var d = exDrag;
    if (!d || !d.live) return;
    var ed = dragEdges(), zone = 64, v = 0, sy = window.scrollY;
    // only while there is more of the table out of sight that way (the program's rows are all there is to reach)
    if (d.y < ed.top + zone && d.tblTop - sy < ed.top + 8) v = -Math.ceil((ed.top + zone - d.y) / 4);
    else if (d.y > ed.bottom - zone && d.tblBottom - sy > ed.bottom - 8) v = Math.ceil((d.y - (ed.bottom - zone)) / 4);
    if (v) {
      var was = window.scrollY;
      window.scrollBy(0, Math.max(-22, Math.min(22, v)));
      if (window.scrollY !== was) gripPlace();
    }
    d.raf = requestAnimationFrame(gripScroll);
  }
  function onGripMove(e) {
    var d = exDrag;
    if (!d || e.pointerId !== d.pid) return;
    e.preventDefault();
    if (!document.body.contains(d.row)) { endGrip(); return; }   // the table was redrawn under the finger: let it go
    d.y = e.clientY;
    if (!d.live) {
      if (Math.abs(d.y - d.y0) < 5) return;            // a tap, so far
      gripStart();
    }
    gripPlace();
  }
  function endGrip() {
    var d = exDrag;
    exDrag = null;
    if (!d) return;
    window.removeEventListener('pointermove', onGripMove, true);
    window.removeEventListener('pointerup', onGripUp, true);
    window.removeEventListener('pointercancel', onGripCancel, true);
    window.removeEventListener('keydown', onGripEsc, true);
    cancelAnimationFrame(d.raf);
    try { if (d.g.hasPointerCapture && d.g.hasPointerCapture(d.pid)) d.g.releasePointerCapture(d.pid); } catch (err) { /* gone */ }
    d.row.classList.remove('dragging');
    d.row.style.transform = '';
    d.tbl.classList.remove('sorting');
    document.documentElement.classList.remove('row-dragging');
    if (d.line && d.line.parentNode) d.line.parentNode.removeChild(d.line);
    return d;
  }
  function onGripUp(e) {
    if (!exDrag || e.pointerId !== exDrag.pid) return;
    var d = endGrip();
    if (!d.live) { focusQuiet(d.g); return; }          // a tap: the handle has focus (the arrow keys move the row)
    var x = state.ex, i = exIndex(d.id);
    if (d.to === d.from || i !== d.from || !document.body.contains(d.row)) { focusQuiet($('ex-' + d.id + '-grip')); return; }
    var it = x.items.splice(i, 1)[0];
    x.items.splice(d.to, 0, it);
    renderExTable();
    exMoved(it);
  }
  function onGripCancel(e) { if (exDrag && e.pointerId === exDrag.pid) endGrip(); }
  function onGripEsc(e) {
    if (e.key !== 'Escape' || !exDrag) return;
    e.preventDefault(); e.stopPropagation();
    endGrip();
  }

  // ---- the handout
  // v15: a row linked to a library exercise also prints the exercise's cues and, when it has a video, a QR code of its
  // link (rows without them lay out exactly as before). `program` is the same program as printed, for the client's record.
  function buildHandout() {
    var x = state.ex;
    if (!exCounts().exercises) return null;
    var groups = [], cur = null, items = [];
    x.items.forEach(function (it) {
      if (it.kind === 'section') {
        if (!blank(it.heading)) { cur = { heading: clean1(it.heading), rows: [] }; groups.push(cur); items.push({ kind: 'section', heading: cur.heading }); }
        return;
      }
      if (!exFilled(it)) return;
      if (!cur) { cur = { heading: '', rows: [] }; groups.push(cur); }
      var r = {}, keep = { kind: 'ex' }, e = exLinked(it), vi = e && E.videoInfo(e.video);
      EX_FIELDS.forEach(function (f) { r[f] = clean1(it[f]); keep[f] = r[f]; });
      keep.lib = it.lib || '';
      if (e && e.cues.length) { r.cues = e.cues.slice(); keep.cues = e.cues.slice(); }
      if (vi) { r.video = vi.link; keep.video = vi.link; }
      cur.rows.push(r);
      items.push(keep);
    });
    var m = x.meta, name = clean1(m.name), title = clean1(x.title), instructions = String(x.instructions || '').trim();
    return {
      file: name ? name.replace(/[\\/:*?"<>|]+/g, '-').replace(/ /g, '_') + '_exercises.pdf' : 'exercises.pdf',
      rep: window.BHReport.exercises({
        meta: { name: name, date: E.displayIso(m.date), practitioner: clean1(m.practitioner) },
        title: title, instructions: instructions,
        groups: groups.filter(function (g) { return g.rows.length; })
      }),
      program: { title: title, instructions: instructions, items: items, plan: tidyPlan(x.plan) }   // v23: the plan goes with the saved program
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
  // v15: with exercises in the library, a last paragraph lists their names (at most 300; names only, nothing about the
  // patient) so a clearly matching exercise comes back under the clinic's own name
  function exScanRequest(n) {
    var names = libList().slice(0, 300).map(function (e) { return e.name; });
    return 'Turn the handwritten exercise program in ' + (n > 1 ? 'these ' + n + ' photos (pages in order)' : 'this photo') +
      ' into the table format: the title and general instructions if written, then each section in the order written, with its exercises. Use an empty string for anything that isn’t written.' +
      (names.length ? '\n\nExercises in the clinic’s library (when a written exercise is clearly one of these, use this name exactly; keep any variation that is written, such as equipment, side or a hold time, in the name or notes): ' + names.join('; ') : '');
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
    var before = exSnap();
    var marks = {}, lib = libList(), matched = 0;
    x.items = found.map(function (f) {
      var it = f.heading ? newExSection(f.heading) : newExRow(f.row);
      if (!f.heading) { var e = E.libMatch(it.name, lib); if (e) { it.lib = e.id; matched++; } }   // v15: linked; the values stay as read
      marks[it.id] = true;
      return it;
    });
    var title = exTidy(out.title, 'title'), notes = exTidy(out.notes, 'instructions');
    if (title) { x.title = title; marks.title = true; } else if (x.scanned.title) marks.title = true;
    if (notes) { x.instructions = notes; marks.instructions = true; } else if (x.scanned.instructions) marks.instructions = true;
    x.scanned = marks;
    scanInfo = { tool: 'ex', kind: 'done', n: n, photos: photos, unclear: unclear, undo: before, matched: matched };
  }
  // the program as it is now (for an Undo), and putting it back unless Clear all replaced the program since
  function exSnap() {
    var x = state.ex;
    return { title: x.title, instructions: x.instructions, items: JSON.parse(JSON.stringify(x.items)), scanned: Object.assign({}, x.scanned), seq: x.seq };
  }
  function exRestore(u, prog) {
    if (state.ex !== prog) return false;
    prog.title = u.title; prog.instructions = u.instructions; prog.items = u.items; prog.scanned = u.scanned;
    prog.seq = Math.max(prog.seq, u.seq);              // ids are never reused
    if (state.tool === 'ex' && state.exPage === 'builder') render(); else saveDraft();
    return true;
  }
  function showExScan() {                              // redraw the program without touching the patient card (its keyboard stays put)
    var x = state.ex, ti = $('ex-title'), tx = $('ex-instructions');
    if (ti && ti.value !== x.title) ti.value = x.title;
    if (tx && tx.value !== x.instructions) { tx.value = x.instructions; fitExNotes(); }
    renderExTable();
  }
  function undoExScan() {
    var u = scanInfo && scanInfo.tool === 'ex' && scanInfo.undo, x = state.ex, ai = !!(scanInfo && scanInfo.ai);
    if (!u) return;
    x.title = u.title; x.instructions = u.instructions; x.items = u.items; x.scanned = u.scanned;
    x.seq = Math.max(x.seq, u.seq);                    // ids are never reused
    scanInfo = null;
    render();
    toast(ai ? 'Suggestions undone' : 'Scan undone');   // v21
  }

  // ---- Suggest from the report (v21): Claude picks exercises from the clinic's library for the linked report's results
  // Matthew: "an ai section to create a exercise list based on the findings in the screening report". The builder, linked
  // to a Performance screen or LL Strength report with scored results, offers "Suggest from the report". Claude gets the
  // same de-identified results text as the interpretation (no name, date or practitioner), the interpretation itself if
  // there is one (the clinician's emphasis; the patient's name taken out should it be in there), the exercises already in
  // the program, and the library as a menu (id, name, body areas, type, equipment, checked). It answers with library ids
  // where the library fits; v22 (Matthew, after trying it): where the library has nothing suitable, or something clearly
  // better exists, Claude gives an exercise of its own by name, with a short note for the handout. Library rows arrive
  // linked (cues and video as usual); Claude's own arrive unlinked, "Not in the library" on their why line, with Save to
  // library one tap away in More. Each row has sets and reps and a one-line "why" under it (shown in the app, never
  // printed), in the blue "check me" look of a scan, with Undo. A name of Claude's that is a library exercise after all is
  // linked to it. v24: Hamstring and ACL reports suggest too, with the evidence guides for the condition and the report's phase.
  var SUGGEST_TOOLS = ['screen', 'str', 'ham', 'acl'];
  var EX_SUGGEST_DEFAULT = {
    effort: 'medium', max_tokens: 4000, timeout_s: 90, max_exercises: 8,
    system: [
      'You suggest an exercise program for a sports physiotherapist at BASE Health Noosa, a clinic in Queensland, Australia, from the results of a testing report. Your suggestions fill a draft that the physiotherapist checks, edits and then prints as a handout for the person tested. The physiotherapist makes every clinical decision; you are saving them the first draft.',
      'Prefer the clinic’s library listed in the request: when it has a suitable exercise, give its id exactly as written there (and leave name empty). When the library has nothing suitable for a priority, or a clearly better exercise exists, give an exercise of your own instead: leave id empty and give its name (a clear, full name in sentence case, with the equipment or variation in the name) and one short note, under 100 characters, telling the person how to do it, which prints on their handout. Never use an id that isn’t in the list.',
      'Follow the clinic’s programming guide in the request for everything it covers: which exercise family fits each finding, one exercise per training quality (never two with the same effect, such as a box jump and a squat jump), how many exercises, the order of the session, the training variables by intent, the weekly structure for the sessions given, the setting, the experience level and the block length. Where the guide is silent, use standard strength and conditioning practice.',
      'Evidence guides may follow the clinic guide in the request, one per topic (training variables, rehabilitation principles, and the condition named). They are drafts the clinic is reviewing. Use them for the condition and stage given: take exercises and doses from the sections and stage-table rows that match that stage, never from a later stage; apply their pain and load rules in the notes and the instructions line; where an evidence guide and the clinic programming guide differ, the clinic guide wins.',
      'If the results or the stage hit a red line in a guide (for example a stage the guide says needs a medical review first), say so in notes and keep the program conservative rather than programming through it. Return-to-sport criteria may be quoted as training targets in why; never as a clearance.',
      'Pick 4 to 8 exercises in all (fewer when there are few findings), aimed at the main priorities: results marked Off target (Behind on a rehab report) first, then Close, then at most one exercise that keeps up a clear strength if there is room. Don’t repeat an exercise already in the program. When two library exercises fit equally well, prefer one marked checked by a clinician.',
      'Group them into 1 to 4 short sections in session order, each heading naming the intent of the block, for example "Power", "Strength" or "Hamstrings and hips"; one section with an empty heading is fine when they don’t split.',
      'For each exercise give every variable: sets and reps as plain numbers or ranges ("3", "8–10", or "30 s" for a hold); load as a short guide the person can act on ("Body weight", "Heavy, 2 reps in reserve", "A weight you could lift 8 times"); rest ("2 min", "60 s"); tempo only where it matters ("3 s down", "3-0-3", or empty); side ("Each side", "Left", "Right", or empty). Put the intent cue in note (under 100 characters), for example "Every rep as fast as you can on the way up"; for an exercise of your own the note also says how to do it.',
      'instructions: one line of general instructions for the handout from the plan, for example "3 sessions a week for 6 weeks, at least a day between sessions", or an empty string.',
      'why: one short line, under 80 characters, naming the finding the exercise is for, with its number and target, for example "Nordic L/R imbalance 12.9%, target ≤ 9" or "Right calf 22 reps, left 27". Plain Australian English, no jargon.',
      'title: a short title for the program from its focus, for example "Jump power and hamstring strength", or an empty string.',
      'notes: anything the physiotherapist should know, one sentence each: why an exercise of your own was chosen over the library, or a finding that needs their judgement. Leave notes empty when there is nothing to say.',
      'Use only the information given. Don’t diagnose, predict injury or give medical advice, and never say anything about being cleared to return to sport. Refer to the person as the athlete or the patient, never by a name.'
    ]
  };
  var suggestBusy = false;                             // one suggestion at a time (and never alongside a scan)
  var guidesReady = Promise.resolve();                 // v24: the guide library's load (set at start)
  function exSuggestCfg() {                            // same model, key and endpoint as the interpretation; "exercise_suggest" in interpretation.json overrides
    var cfg = Object.assign({}, EX_SUGGEST_DEFAULT), ai = DATA.ai || {};
    cfg.model = ai.model; cfg.endpoint = ai.endpoint;
    if (ai.exercise_suggest && typeof ai.exercise_suggest === 'object') Object.keys(ai.exercise_suggest).forEach(function (k) { cfg[k] = ai.exercise_suggest[k]; });
    return cfg;
  }
  function suggestTool() {                             // the linked report Claude can suggest from, or ''
    var lt = linkedTool();
    return SUGGEST_TOOLS.indexOf(lt) >= 0 && hasResults(lt) ? lt : '';
  }
  // the patient's name taken out of free text (the interpretation can be typed by hand)
  function withoutName(text, name, who) {
    var words = clean1(name).split(' ').filter(function (w) { return w.length >= 2; });
    if (!words.length) return text;
    var esc1 = function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var re = new RegExp('\\b(?:' + [words.map(esc1).join('\\s+')].concat(words.map(esc1)).join('|') + ')\\b([’\']s)?', 'gi');   // the whole name first, then each word
    return text.replace(re, function (m, poss) { return 'the ' + who + (poss ? '’s' : ''); });
  }
  function libLine(e) {
    return e.id + ' | ' + clean1(e.name) + ' | ' + (Array.isArray(e.areas) && e.areas.length ? e.areas.map(clean1).join(', ') : '—') + ' | ' + clean1(e.type || '—') +
      ' | ' + clean1(e.equipment || '—') + ' | ' + (e.checked ? 'checked' : 'not yet checked');
  }
  function bodyOf(text, cap) {                         // a guide without its sources list, within a size cap
    var g = String(text || ''), i = g.search(/^## Sources/m);
    if (i > 0) g = g.slice(0, i);
    return g.trim().slice(0, cap);
  }
  function guideCap(cfg) { return cfg && cfg.guide_max_chars ? cfg.guide_max_chars : 36000; }
  function guideText(cfg) { return bodyOf(DATA.guide, guideCap(cfg)); }
  // v24: the evidence guides. guides/index.json says which travel with a request: 'always' (training variables) with every
  // suggestion; 'rehab' (rehabilitation principles) plus the condition's own guide when a condition is chosen in the plan, or
  // when the report is a rehab report (by_tool). Each goes without its sources list, within the per-guide cap, and the whole
  // bundle within guides_max_chars. The physiotherapist sets the condition and the stage; the app never infers either.
  function conditionList() { var g = DATA.guideIndex; return g && Array.isArray(g.conditions) ? g.conditions.filter(function (c) { return c && typeof c === 'object' && /^[a-z0-9-]{1,32}$/.test(String(c.id || '')); }) : []; }
  function conditionFor(lt, plan) {                    // the condition a request is for: the report's (rehab reports) or the plan's; null for none
    var g = DATA.guideIndex, by = g && g.by_tool ? g.by_tool[lt] : null, fixed = typeof by === 'string' ? { condition: by, label: '' } : (by && typeof by === 'object' ? by : null);
    var id = fixed ? String(fixed.condition || '') : (plan && plan.condition) || 'none';
    if (!id || id === 'none') return null;
    var hit = conditionList().filter(function (c) { return c.id === id; })[0];
    if (!hit) return null;
    return fixed ? { id: id, label: clean1(fixed.label) || clean1(hit.label) || id, detail: '', guides: Array.isArray(hit.guides) ? hit.guides : [], fixed: true }
      : { id: id, label: clean1(hit.label) || id, detail: clean1(hit.detail), guides: Array.isArray(hit.guides) ? hit.guides : [], fixed: false };
  }
  function stageFor(lt, plan) {                        // the stage line for the request: a rehab report's phase, or the plan's stage
    if (lt === 'ham' || lt === 'acl') { var ph = clean1(state[lt].phase); return ph ? 'Rehab phase (set by the physiotherapist on the report): ' + ph + '.' : ''; }
    var s = plan && plan.stage, g = DATA.guideIndex, help = g && g.stage_help && typeof g.stage_help[s] === 'string' ? clean1(g.stage_help[s]) : '';
    return s ? 'Stage (set by the physiotherapist): ' + s.toLowerCase() + (help ? ' (' + help + ')' : '') + '.' : '';
  }
  function guideBundle(lt, plan, cfg) {                // { ids, titles, text, chars } of the evidence guides for this request
    var g = DATA.guideIndex, ids = [], out = { ids: [], titles: [], shorts: [], text: '', chars: 0 };
    if (!g) return out;
    var cond = conditionFor(lt, plan);
    [].concat(Array.isArray(g.always) ? g.always : []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    if (cond) [].concat(Array.isArray(g.rehab) ? g.rehab : [], cond.guides).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    var cap = guideCap(cfg), total = cfg && cfg.guides_max_chars ? cfg.guides_max_chars : 120000, parts = [];
    ids.forEach(function (id) {
      var body = bodyOf(DATA.guides[id], cap), meta = g.guides && g.guides[id];
      if (!body) return;
      var title = clean1(meta && meta.title) || id;
      out.ids.push(id); out.titles.push(title); out.shorts.push(clean1(meta && meta.short) || id);
      parts.push('### Guide: ' + title + '\n\n' + body);
    });
    out.text = parts.join('\n\n').slice(0, total);
    out.chars = out.text.length;
    return out;
  }
  function guidesMissing(lt, plan) {                   // ids the index names for this request that didn't load
    var g = DATA.guideIndex; if (!g) return [];
    var cond = conditionFor(lt, plan), ids = [].concat(Array.isArray(g.always) ? g.always : [], cond ? [].concat(Array.isArray(g.rehab) ? g.rehab : [], cond.guides) : []);
    return ids.filter(function (id, i) { return ids.indexOf(id) === i && !DATA.guides[id]; });
  }
  function exSuggestRequest(lt, c, max, cfg) {
    var plan = tidyPlan(state.ex.plan);
    var L = ['Suggest the exercise program for this report, choosing from the clinic’s library below (at most ' + max + ' exercises), following the clinic’s programming guide at the end for selection, order and the training variables.', '', interpPayload(lt, c)];
    L.push('', 'The program: ' + planLines(plan));   // v23
    var cond = conditionFor(lt, plan), stage = stageFor(lt, plan);   // v24
    if (cond) L.push('Condition (set by the physiotherapist): ' + cond.label + (cond.detail ? ' (' + cond.detail + ')' : '') + '.' + (stage ? ' ' + stage : ''));
    var it = state[lt].interp, who = person(lt);
    if (!blank(it.text)) L.push('', 'The physiotherapist’s interpretation of these results (their emphasis): ' + withoutName(clean1(it.text), state[lt].meta.name, who));
    var have = state.ex.items.filter(function (r) { return r.kind === 'ex' && !blank(r.name); }).map(function (r) { return clean1(r.name); });
    if (have.length) L.push('', 'Already in the program (don’t repeat these): ' + have.join('; '));
    L.push('', 'Library (id | name | body areas | type | equipment | checked by a clinician):');
    libList().slice(0, 300).forEach(function (e) { L.push(libLine(e)); });
    var g = guideText(cfg);
    if (g) L.push('', 'Clinic programming guide (follow it; it takes precedence over general knowledge):', '', g);
    var ev = guideBundle(lt, plan, cfg);
    if (ev.text) L.push('', 'Evidence guides (drafts the clinic is reviewing; use them for the condition and stage given; where they and the clinic programming guide differ, the clinic guide wins):', '', ev.text);
    return L.join('\n');
  }
  // v24: what a suggestion will cost, from the text about to be sent (about 4 characters a token) at the rates in
  // interpretation.json › exercise_suggest › cost (cents per 1,000 input tokens, and cents for the answer)
  function suggestCents(cfg, chars) {
    var cost = cfg && cfg.cost && typeof cfg.cost === 'object' ? cfg.cost : {};
    var inRate = isFinite(cost.per_1k_input_cents) ? +cost.per_1k_input_cents : 0.3, outCents = isFinite(cost.output_cents) ? +cost.output_cents : 2;
    return Math.max(1, Math.round(chars / 4 / 1000 * inRate + outCents));
  }
  function exSuggestSchema() {
    var str = { type: 'string' };
    var ex = { type: 'object', properties: { id: str, name: str, sets: str, reps: str, load: str, rest: str, tempo: str, side: str, note: str, why: str },
      required: ['id', 'name', 'sets', 'reps', 'load', 'rest', 'tempo', 'side', 'note', 'why'], additionalProperties: false };
    return {
      type: 'object',
      properties: {
        title: str, instructions: str,
        sections: { type: 'array', items: { type: 'object', properties: { heading: str, exercises: { type: 'array', items: ex } }, required: ['heading', 'exercises'], additionalProperties: false } },
        notes: { type: 'array', items: str }
      },
      required: ['title', 'instructions', 'sections', 'notes'],
      additionalProperties: false
    };
  }
  // v23: Suggest from the report asks about the person and the setting first (a small dialog; the choices are kept with the
  // program), then sends the request
  function startExSuggest() {
    if (suggestBusy || scanBusy) return;
    var lt = suggestTool();
    function fail(msg) { scanInfo = { tool: 'ex', kind: 'error', ai: true, text: msg }; renderScanBar(); }
    if (!lt) return;
    var cfg = exSuggestCfg(), c = computeFor(lt), why = blocker(c, lt);
    if (why) return fail(TOOL_NAMES[lt] + ' report: ' + why.charAt(0).toLowerCase() + why.slice(1) + ' Then suggest again.');
    if (!DATA.ai || !cfg.model) return fail('The AI settings file (interpretation.json) didn’t load. Reopen the app while online.');
    if (!aiKey()) { openAiSettings(function () { if (state.tool === 'ex') startExSuggest(); }, 'To suggest exercises from a report, the app needs a Claude API key. ' + ONCE_NOTE()); return; }
    if (navigator.onLine === false) return fail('No internet connection. Connect to suggest exercises, or add them from the library.');
    var gen = scanGen;
    guidesReady.then(function () {                     // v24: the guide library is usually long loaded; if not, the dialog waits for it
      if (gen !== scanGen || state.tool !== 'ex' || suggestBusy || scanBusy || suggestTool() !== lt) return;
      renderPlanDialog(lt);
      openModal(els.suggestDialog, els.suggestGo);
    });
  }
  // v24: the lead says what goes and what it costs; the condition row (a menu on a Performance screen or LL Strength
  // report; the report's own condition and phase on a rehab report) and the stage row (while a condition is chosen)
  function suggestLeadText(lt) {
    var plan = tidyPlan(state.ex.plan), cfg = exSuggestCfg(), cond = conditionFor(lt, plan), ev = guideBundle(lt, plan, cfg);
    var what = 'Claude gets the ' + TOOL_NAMES[lt] + ' results (no name or date), your interpretation, the exercises already here, the library, the clinic’s programming guide' +
      (DATA.guide ? '' : ' (not loaded: reopen the app online to fetch it)');
    if (ev.ids.length) what += ' and the evidence guide' + (ev.ids.length > 1 ? 's' : '') + ' (' + ev.shorts.join(', ') + ')';
    var missing = guidesMissing(lt, plan);
    if (missing.length) what += ' (' + missing.join(', ') + ' not loaded: reopen the app online to fetch ' + (missing.length > 1 ? 'them' : 'it') + ')';
    else if (!DATA.guideIndex) what += ' (evidence guides not loaded: reopen the app online to fetch them)';
    var chars = 0;
    try { var c = computeFor(lt); chars = exSuggestRequest(lt, c, cfg.max_exercises || 8, cfg).length + [].concat(cfg.system || []).join('\n').length; } catch (e) { chars = 40000; }
    return what + '. About ' + suggestCents(cfg, chars) + ' cents.';
  }
  function renderPlanDialog(lt) {
    var plan = state.ex.plan = tidyPlan(state.ex.plan);
    els.suggestLead.textContent = suggestLeadText(lt);
    var rows = Object.keys(PLAN).map(function (k) {
      return '<div class="f"><span id="plan-' + k + '-l">' + esc(PLAN_LABEL[k]) + '</span><div class="seg" role="group" aria-labelledby="plan-' + k + '-l">' +
        PLAN[k].map(function (o) { return '<button type="button" data-plan="' + k + '" data-value="' + esc(o) + '" aria-pressed="' + (plan[k] === o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>';
    });
    var cond = conditionFor(lt, plan), conds = conditionList();
    if (cond && cond.fixed) {                           // a rehab report: its condition and phase, shown, not chosen
      var ph = clean1(state[lt].phase);
      rows.push('<div class="f cond"><span>Condition and phase, from this report</span><p class="plan-fixed" id="planFixed">' + esc(cond.label) + (ph ? ' · ' + esc(ph) : '') + '</p></div>');
    } else if (conds.length) {
      rows.push('<div class="f cond"><label for="planCondition">Condition (optional: adds its evidence guide)</label><select id="planCondition" data-plan-select="condition">' +
        conds.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === plan.condition ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></div>');
      if (cond) {
        var st = stageList();
        rows.push('<div class="f"><span id="plan-stage-l">Stage (early, middle, late, or ongoing maintenance)</span><div class="seg stage" role="group" aria-labelledby="plan-stage-l">' +
          st.map(function (o) { return '<button type="button" data-plan="stage" data-value="' + esc(o) + '" aria-pressed="' + (plan.stage === o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>');
      }
    }
    els.suggestPlan.innerHTML = rows.join('');
    els.suggestPlan.dataset.tool = lt;
  }
  function onPlanClick(e) {
    var b = e.target.closest('button[data-plan]');
    if (!b) return;
    var k = b.dataset.plan;
    state.ex.plan[k] = b.dataset.value;
    b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.value === b.dataset.value)); });
    saveDraft();
  }
  function onPlanChange(e) {                           // v24: the condition menu
    var s = e.target.closest('select[data-plan-select]');
    if (!s) return;
    var plan = state.ex.plan, lt = els.suggestPlan.dataset.tool;
    plan.condition = s.value;
    if (plan.condition !== 'none' && stageList().indexOf(plan.stage) < 0) plan.stage = stageList()[0];
    if (plan.condition === 'none') plan.stage = '';
    saveDraft();
    if (lt) { renderPlanDialog(lt); var again = $('planCondition'); if (again) again.focus(); }
  }
  function planLines(plan) {
    return 'Sessions a week: ' + plan.sessions + '. Setting: ' + plan.setting.toLowerCase() + '. Training experience: ' + (plan.level === 'New' ? 'new to training' : 'trained') + '. Block length: ' + plan.weeks + ' weeks.';
  }
  function runExSuggest() {
    closeModal(false);
    if (suggestBusy || scanBusy) return;
    var lt = suggestTool(), x = state.ex;
    if (!lt || !aiKey()) return;
    var cfg = exSuggestCfg(), c = computeFor(lt);
    if (blocker(c, lt)) return;
    var gen = scanGen, max = cfg.max_exercises || 8;
    suggestBusy = true;
    scanInfo = { tool: 'ex', kind: 'busy', ai: true, text: 'Choosing exercises from the ' + TOOL_NAMES[lt] + ' report… this can take up to a minute.' };
    renderScanBar();
    var body = {
      model: cfg.model, max_tokens: cfg.max_tokens || 4000, system: [].concat(cfg.system || []).join('\n'),
      messages: [{ role: 'user', content: exSuggestRequest(lt, c, max, cfg) }],
      output_config: { format: { type: 'json_schema', schema: exSuggestSchema() } }
    };
    if (cfg.effort) body.output_config.effort = cfg.effort;
    focusQuiet($('exSuggest'));
    claudeRequest(aiKey(), body, cfg.endpoint, cfg.timeout_s || 90, 'suggest exercises').then(function (j) {
      if (gen !== scanGen || state.ex !== x) return;
      if (j.stop_reason === 'max_tokens') throw new Error('Claude’s answer was cut short. Try again.');
      if (j.stop_reason === 'refusal') throw new Error('Claude didn’t suggest exercises for these results. Add them from the library instead.');
      var out;
      try { out = JSON.parse(replyText(j)); } catch (e) { throw new Error('Claude’s answer couldn’t be read. Try again.'); }
      applyExSuggest(out, lt, max);
    }).catch(function (err) {
      if (gen !== scanGen || state.ex !== x) return;
      scanInfo = { tool: 'ex', kind: 'error', ai: true, text: err && err.message ? err.message : 'Something went wrong suggesting exercises. Try again.' };
    }).then(function () {
      if (gen !== scanGen) return;
      suggestBusy = false;
      if (state.tool === 'ex' && state.exPage === 'builder') {
        if (scanInfo && scanInfo.undo) { renderExTable(); foldNow('ex', false); }
        renderScanBar();
        var bar = $('scanBar');
        if (bar && !bar.hidden && bar.scrollIntoView) {
          var r = bar.getBoundingClientRect(), top = appbarH + (state.ex.cardOpen === false ? 48 : 0);
          if (r.top < top || r.bottom > window.innerHeight) bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } else if (scanInfo && scanInfo.undo) { foldBeforeRender('ex'); saveDraft(); }   // suggested while on another page: folded there for when it's opened
    });
  }
  // the suggested rows into the program: library rows linked, Claude's own unlinked (v22), all marked to check; after the
  // rows already there. An id not in the library with no name is dropped; each exercise once; Undo puts back exactly what
  // was there
  function applyExSuggest(out, lt, max) {
    var x = state.ex, found = [], n = 0, own = 0, seen = {}, dropped = 0, lib = libList();
    x.items.forEach(function (r) { if (r.kind !== 'ex') return; if (r.lib) seen[r.lib] = true; var k = E.libKey(r.name); if (k) seen['~' + k] = true; });
    (out && Array.isArray(out.sections) ? out.sections : []).forEach(function (sec) {
      if (!sec || typeof sec !== 'object') return;
      var rows = [];
      (Array.isArray(sec.exercises) ? sec.exercises : []).forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        var id = String(e.id || '').trim(), name = exTidy(e.name, 'name'), entry = libGet(id);
        if (entry && entry.deleted) entry = null;
        if (!entry && name) entry = E.libMatch(name, lib);        // Claude's own name that is a library exercise after all
        if (!entry && !name) { if (id) dropped++; return; }
        var key = entry ? entry.id : '~' + E.libKey(name);
        if (seen[key] || (entry && seen['~' + E.libKey(entry.name)]) || n >= max) return;
        seen[key] = true; n++;
        var why = clean1(e.why).slice(0, 100);
        var row = { sets: exTidy(e.sets, 'sets'), reps: exTidy(e.reps, 'reps'), load: exTidy(e.load, 'load'), rest: exTidy(e.rest, 'rest'), tempo: exTidy(e.tempo, 'tempo'), side: exTidy(e.side, 'side'),
          notes: exTidy(e.note, 'notes').slice(0, 160) };   // v23: every variable (the guide sets them), the intent cue in the notes
        if (entry) { row.name = entry.name; row.lib = entry.id; row.why = why; }
        else { own++; row.name = name; row.lib = ''; row.why = 'Not in the library' + (why ? ' · ' + why : ''); }
        rows.push(row);
      });
      if (!rows.length) return;
      var h = exTidy(sec.heading, 'heading');
      if (h) found.push({ heading: h });
      rows.forEach(function (r) { found.push({ row: r }); });
    });
    var notes = (out && Array.isArray(out.notes) ? out.notes : []).map(function (u) { return clean1(u); }).filter(Boolean).slice(0, 8);
    if (dropped) notes.push(dropped + (dropped === 1 ? ' suggestion wasn’t' : ' suggestions weren’t') + ' in the library and ' + (dropped === 1 ? 'was' : 'were') + ' left out.');
    if (!n) { scanInfo = { tool: 'ex', kind: 'empty', ai: true, from: lt, unclear: notes, undo: null }; return; }
    var before = exSnap(), added = x.items.some(function (r) { return r.kind === 'ex' && !blank(r.name); });
    found.forEach(function (f) {
      var it = f.heading ? newExSection(f.heading) : newExRow(f.row);
      if (!f.heading) it.why = f.row.why;
      x.scanned[it.id] = true;
      x.items.push(it);
    });
    var title = exTidy(out.title, 'title'), instr = exTidy(out.instructions, 'instructions');
    if (title && blank(x.title)) { x.title = title; x.scanned.title = true; }
    if (instr && blank(x.instructions)) { x.instructions = instr; x.scanned.instructions = true; }   // v23: e.g. "3 sessions a week for 6 weeks"
    scanInfo = { tool: 'ex', kind: 'done', ai: true, from: lt, n: n, own: own, added: added, unclear: notes, undo: before };
  }

  // ------------------------------------------------------------------ exercise library (v15)
  // The clinic's exercises: a default dose, up to three short cues printed under the exercise on the handout, and a video
  // link (printed as a QR code). The starter set comes with the app (exercise_library.json: drafts for a clinician to
  // check); what the clinic adds or changes is stored on top of it: on this device in local mode
  // (bh-athlete-report-library-v1), in the clinic store in cloud mode (Firestore `library`, cached by cloud.js). A stored
  // entry replaces the starter entry with its id, a tombstone { id, deleted: true } hides it, and new ids are added.
  // Program templates are kept the same way (bh-athlete-report-templates-v1 / `templates`).
  var LIB_STORE = 'bh-athlete-report-library-v1', TPL_STORE = 'bh-athlete-report-templates-v1';
  var LIB_AREAS = ['Hip & groin', 'Knee', 'Hamstring', 'Calf & Achilles', 'Ankle & foot', 'Trunk', 'Shoulder & arm', 'Whole body'];
  var LIB_TYPES = ['Strength', 'Isometric', 'Plyometric', 'Mobility', 'Balance & control', 'Running drill', 'Conditioning'];
  var LIB_ID = /^[sc]-[a-z0-9-]{1,80}$/, TPL_ID = /^t-[a-z0-9]{1,40}$/;
  var DOSE = ['sets', 'reps', 'load', 'rest', 'tempo', 'side'];
  var PLAY = '<svg class="play" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l10.1-6.4a.6.6 0 0 0 0-1L8.92 5.1A.6.6 0 0 0 8 5.6z"/></svg>';
  var SEARCH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>';
  var starterLib = [], localLib = { v: 1, items: {} }, localTpl = { v: 1, items: {} }, NONE = {};
  var libVer = 0, libMemo = null, tplMemo = null;      // the merged lists, rebuilt when libVer moves on or the store's cache object changes

  // ---- where entries are kept: the clinic store when cloud.js has the library calls, else this device
  function storeOn() { return !!(CLOUD && typeof CLOUD.putDoc === 'function' && typeof CLOUD.deleteDoc === 'function'); }
  function loadItems(key) {
    try { var o = JSON.parse(localStorage.getItem(key)); if (o && o.v === 1 && o.items && typeof o.items === 'object' && !Array.isArray(o.items)) return o; } catch (e) { /* none saved */ }
    return { v: 1, items: {} };
  }
  function storedItems(coll) {                         // { id: entry | { id, deleted: true } }
    if (storeOn()) { var c = CLOUD.cache, m = c && c[coll]; return m && typeof m === 'object' && !Array.isArray(m) ? m : NONE; }
    return (coll === 'library' ? localLib : localTpl).items;
  }
  // a full write of one entry or template, or (obj null) its tombstone; false when this device couldn't store it
  function writeItem(coll, id, obj) {
    var ok = true;
    if (storeOn()) {
      if (obj) CLOUD.putDoc(coll, id, obj); else CLOUD.deleteDoc(coll, id);
      CLOUD.sync();
    } else {
      var box = coll === 'library' ? localLib : localTpl;
      box.items[id] = obj || { id: id, deleted: true };
      try { localStorage.setItem(coll === 'library' ? LIB_STORE : TPL_STORE, JSON.stringify(box)); } catch (e) { ok = false; }
    }
    libVer++;
    return ok;
  }
  function newId(prefix) {                             // 'c-' or 't-' + base-36 time + 4 random base-36 characters
    var r = '';
    try { var a = new Uint32Array(1); crypto.getRandomValues(a); r = a[0].toString(36); } catch (e) { r = Math.random().toString(36).slice(2); }
    return prefix + Date.now().toString(36) + (r + '0000').slice(0, 4);
  }
  function cap(v, n) { var s = clean1(exStr(v)); return s.length > n ? s.slice(0, n).trim() : s; }
  function nameOrder(a, b) { return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }); }
  // an entry as stored or shipped, tidied (lengths, the known areas and types, up to 3 cues, a video only if it reads as
  // one); fromFile: a starter entry, which is an unchecked draft without a video
  function tidyEntry(o, fromFile) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.id !== 'string' || !LIB_ID.test(o.id)) return null;
    var name = cap(o.name, 120);
    if (!name) return null;
    var d = o.dose && typeof o.dose === 'object' ? o.dose : {}, dose = {}, aliases = [], seen = {};
    DOSE.forEach(function (f) { dose[f] = cap(d[f], 60); });
    (Array.isArray(o.aliases) ? o.aliases : []).forEach(function (a) {
      a = cap(a, 60);
      if (a && !seen[a.toLowerCase()] && aliases.length < 12) { seen[a.toLowerCase()] = 1; aliases.push(a); }
    });
    var video = String(exStr(o.video)).trim().slice(0, 500);
    return {
      id: o.id, name: name, aliases: aliases,         // the body areas in the entry's own order ('Knee · Hip & groin')
      areas: (Array.isArray(o.areas) ? o.areas : []).filter(function (a, i, all) { return LIB_AREAS.indexOf(a) >= 0 && all.indexOf(a) === i; }),
      type: LIB_TYPES.indexOf(o.type) >= 0 ? o.type : '', equipment: cap(o.equipment, 80), dose: dose,
      cues: (Array.isArray(o.cues) ? o.cues : []).map(function (c) { return cap(c, 90); }).filter(Boolean).slice(0, 3),
      instructions: exTidy(exStr(o.instructions), 'instructions'),
      video: !fromFile && E.videoInfo(video) ? video : '', checked: !fromFile && o.checked === true,
      updatedBy: fromFile ? '' : cap(o.updatedBy, 120), updatedAt: !fromFile && typeof o.updatedAt === 'string' ? o.updatedAt.slice(0, 40) : ''
    };
  }
  // the starter file (exercise_library.json): its lists of areas and types when it has them, and its entries
  function setStarter(file) {
    var f = file && typeof file === 'object' ? file : {};
    function strs(a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim(); }) : []; }
    if (strs(f.areas).length) LIB_AREAS = strs(f.areas);
    if (strs(f.types).length) LIB_TYPES = strs(f.types);
    var seen = {};
    starterLib = (Array.isArray(f.exercises) ? f.exercises : []).map(function (o) { return tidyEntry(o, true); }).filter(function (e) {
      if (!e || e.id.charAt(0) !== 's' || seen[e.id]) return false;
      seen[e.id] = 1;
      return true;
    });
    libVer++;
  }
  // the library every screen shows: the starter entries overlaid by the stored ones, sorted by name
  function libAll() {
    var src = storedItems('library');
    if (libMemo && libMemo.ver === libVer && libMemo.src === src) return libMemo;
    var byId = {};
    starterLib.forEach(function (e) { byId[e.id] = e; });
    Object.keys(src).forEach(function (id) {
      var o = src[id];
      if (!LIB_ID.test(id) || !o || typeof o !== 'object') return;
      if (o.deleted === true) { delete byId[id]; return; }
      var e = tidyEntry(o, false);
      if (e && e.id === id) byId[id] = e;
    });
    libMemo = { ver: libVer, src: src, byId: byId, list: Object.keys(byId).map(function (k) { return byId[k]; }).sort(nameOrder) };
    return libMemo;
  }
  function libList() { return libAll().list; }
  function libGet(id) { return id && LIB_ID.test(id) ? libAll().byId[id] || null : null; }
  function hasVideo(e) { return !!(e && e.video && E.videoInfo(e.video)); }
  function doseLine(d) {                               // '3 × 8–12 · Each side · 90 s rest' (only the parts set)
    d = d || {};
    var sets = clean1(d.sets), reps = clean1(d.reps);
    var sr = sets && reps ? sets + ' × ' + reps : sets ? sets + (/^\d+$/.test(sets) ? (sets === '1' ? ' set' : ' sets') : '') : reps;
    return [sr, clean1(d.load), clean1(d.side), blank(d.rest) ? '' : clean1(d.rest) + ' rest', blank(d.tempo) ? '' : 'tempo ' + clean1(d.tempo)].filter(Boolean).join(' · ');
  }
  function libCounts(list) {
    var c = { n: list.length, video: 0, drafts: 0 };
    list.forEach(function (e) { if (hasVideo(e)) c.video++; if (!e.checked) c.drafts++; });
    return c;
  }
  // search (name and other names, by key: 2 characters or more), one body area, Has video, Drafts to check
  function libFiltered(v) { return clean1(v.q).length >= 2 || !!v.area || !!v.video || !!v.drafts; }
  function libFilter(list, v) {
    var out = list;
    if (clean1(v.q).length >= 2) {
      var hit = {};
      E.libSuggest(v.q, list, list.length).forEach(function (e) { hit[e.id] = 1; });
      out = out.filter(function (e) { return hit[e.id]; });
    }
    if (v.area) out = out.filter(function (e) { return e.areas.indexOf(v.area) >= 0; });
    if (v.video) out = out.filter(hasVideo);
    if (v.drafts) out = out.filter(function (e) { return !e.checked; });
    return out;
  }
  function searchHtml(id, value, label) {
    return '<label class="client-search lib-search" for="' + id + '">' + SEARCH_ICON + '<span class="vh">' + esc(label) + '</span>' +
      '<input id="' + id + '" type="search" placeholder="' + esc(label) + '" value="' + esc(value) + '" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search"></label>';
  }
  function areaChipsHtml(cur, attr) {                  // All + the body areas, one at a time
    return [''].concat(LIB_AREAS).map(function (a) {
      return '<button type="button" class="chip-btn" ' + attr + '="' + esc(a) + '" aria-pressed="' + (cur === a) + '">' + esc(a || 'All') + '</button>';
    }).join('');
  }

  // ---- the library page (Exercises › Exercise library)
  var libView = { q: '', area: '', video: false, drafts: false };
  function libIntro(all) {
    var n = all.filter(function (e) { return e.id.charAt(0) === 's' && !e.checked; }).length;
    return (CLOUD ? 'Shared by every signed-in device.' : 'Saved on this device.') + ' Tap an exercise to edit it.' +
      (n ? ' ' + n + (n === 1 ? ' starter exercise is a draft' : ' starter exercises are drafts') + ' for a clinician to check.' : '');
  }
  function renderLibrary() {
    els.entry.innerHTML = '<div class="pagehead">' + pickHtml('ex') + '<p id="libIntro"></p></div>' +
      '<section class="card lib-tools" aria-label="Find exercises"><div class="lib-top">' + searchHtml('libSearch', libView.q, 'Search exercises') +
      '<button type="button" class="primary lib-new" data-action="lib-new" aria-haspopup="dialog">+ New exercise</button></div>' +
      '<div class="lib-chips" role="group" aria-label="Filter the exercises">' + areaChipsHtml(libView.area, 'data-lib-area') +
      '<span class="chip-sep" aria-hidden="true"></span>' +
      '<button type="button" class="chip-btn" data-lib-flag="video" aria-pressed="' + libView.video + '">' + PLAY + 'Has video</button>' +
      '<button type="button" class="chip-btn" data-lib-flag="drafts" aria-pressed="' + libView.drafts + '">Drafts to check <span class="chip-n" id="libDraftN"></span></button></div></section>' +
      '<p class="lib-count" id="libCount" role="status" aria-live="polite"></p><div class="lib-list" id="libList"></div>';
    document.documentElement.classList.remove('has-strip');
    renderLibList();
  }
  function libChipsSync() {
    els.entry.querySelectorAll('[data-lib-area]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.libArea === libView.area)); });
    els.entry.querySelectorAll('[data-lib-flag]').forEach(function (c) { c.setAttribute('aria-pressed', String(!!libView[c.dataset.libFlag])); });
  }
  function renderLibList() {
    var box = $('libList');
    if (!box) return;
    var all = libList(), c = libCounts(all), shown = libFilter(all, libView), q = clean1(libView.q);
    $('libIntro').textContent = libIntro(all);
    $('libDraftN').textContent = c.drafts;
    $('libCount').textContent = libFiltered(libView) ? 'Showing ' + shown.length + ' of ' + c.n
      : c.n + (c.n === 1 ? ' exercise' : ' exercises') + (c.video ? ' · ' + c.video + ' with video' : '') + (c.drafts ? ' · ' + c.drafts + (c.drafts === 1 ? ' draft' : ' drafts') + ' to check' : '');
    if (!all.length) box.innerHTML = '<div class="lib-empty"><p>The library is empty. Add your first exercise.</p></div>';
    else if (!shown.length) {
      box.innerHTML = '<div class="lib-empty"><p>' + (q.length >= 2 ? 'No exercises match “' + esc(q) + '”.' : 'No exercises match these filters.') + '</p>' +
        '<button type="button" class="ghost" data-action="lib-clear">Clear filters</button></div>';
    } else box.innerHTML = shown.map(libRowHtml).join('');
    renderLibSummary(c);
  }
  function libRowHtml(e) {
    var meta = e.areas.concat(e.type ? [e.type] : []).join(' · '), dose = doseLine(e.dose);
    return '<button type="button" class="lib-row" data-action="lib-open" data-lib="' + esc(e.id) + '" aria-haspopup="dialog"><span class="lr-main"><b class="lr-name">' + esc(e.name) + '</b>' +
      (meta ? '<span class="lr-meta">' + esc(meta) + '</span>' : '') + (dose ? '<span class="lr-dose">' + esc(dose) + '</span>' : '') + '</span>' +
      '<span class="lr-badges">' + (hasVideo(e) ? '<span class="badge vid">' + PLAY + 'Video</span>' : '') + (e.checked ? '' : '<span class="badge draft">Draft</span>') + '</span></button>';
  }
  function renderLibSummary(c) {
    if (state.tool !== 'ex' || state.exPage !== 'library') return;
    c = c || libCounts(libList());
    els.summary.innerHTML = '<div class="sum lib-sum"><div class="sum-scroll"><h2>Exercise library</h2>' +
      '<div class="tally ex-tally lib-tally"><div><b>' + c.n + '</b><span>' + (c.n === 1 ? 'Exercise' : 'Exercises') + '</span></div>' +
      '<div><b>' + c.video + '</b><span>With video</span></div><div><b>' + c.drafts + '</b><span>Drafts to check</span></div></div>' +
      '<p class="fine lib-how">Exercises you add here can be added to any program with + From library. Cues print under the exercise on the handout; a video link prints as a QR code.</p>' +
      '</div><div class="sum-foot"><button type="button" class="ghost make" data-action="lib-new" aria-haspopup="dialog">+ New exercise</button></div></div>';
    els.dock.innerHTML = '<div class="dt"><span class="ex-dock"><b>' + c.n + '</b> ' + (c.n === 1 ? 'exercise' : 'exercises') + '</span></div>' +
      '<button type="button" class="primary" data-action="lib-new" aria-haspopup="dialog">+ New exercise</button>';
    els.dock.classList.remove('has-check', 'has-both');
  }

  // ---- the editor (#libDialog): New exercise / Edit exercise
  var libEdit = null, libReturn = null, libReturnRow = '', libDelTimer = null;
  function libErr(msg) { var p = $('libNameErr'); p.textContent = msg || ''; p.hidden = !msg; }
  function fillLibForm(e) {
    $('libName').value = e.name || '';
    $('libAliases').value = (e.aliases || []).join(', ');
    $('libAreas').innerHTML = LIB_AREAS.map(function (a) {
      return '<button type="button" class="chip-btn" data-area="' + esc(a) + '" aria-pressed="' + ((e.areas || []).indexOf(a) >= 0) + '">' + esc(a) + '</button>';
    }).join('');
    $('libAreas')._was = (e.areas || []).slice();      // the entry's order is kept; areas ticked now go after it
    $('libType').innerHTML = '<option value="">—</option>' + LIB_TYPES.map(function (t) { return '<option value="' + esc(t) + '"' + (t === e.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    $('libEquip').value = e.equipment || '';
    DOSE.forEach(function (f) { $('libDose-' + f).value = (e.dose || {})[f] || ''; });
    [0, 1, 2].forEach(function (i) { $('libCue' + i).value = (e.cues || [])[i] || ''; });
    $('libInstr').value = e.instructions || '';
    $('libVideo').value = e.video || '';
    $('libChecked').checked = e.checked !== false;
    libErr('');
    libVideoState();
  }
  function readLibForm() {
    var dose = {}, aliases = [], seen = {}, areas = [];
    DOSE.forEach(function (f) { dose[f] = cap($('libDose-' + f).value, 60); });
    $('libAliases').value.split(/[,;\n]/).forEach(function (a) {
      a = cap(a, 60);
      if (a && !seen[a.toLowerCase()] && aliases.length < 12) { seen[a.toLowerCase()] = 1; aliases.push(a); }
    });
    els.libDialog.querySelectorAll('#libAreas [data-area][aria-pressed="true"]').forEach(function (b) { areas.push(b.dataset.area); });
    var was = $('libAreas')._was || [];
    areas = was.filter(function (a) { return areas.indexOf(a) >= 0; }).concat(areas.filter(function (a) { return was.indexOf(a) < 0; }));
    return {
      name: cap($('libName').value, 120), aliases: aliases, areas: areas, type: LIB_TYPES.indexOf($('libType').value) >= 0 ? $('libType').value : '',
      equipment: cap($('libEquip').value, 80), dose: dose,
      cues: [0, 1, 2].map(function (i) { return cap($('libCue' + i).value, 90); }).filter(Boolean),
      instructions: exTidy($('libInstr').value, 'instructions'), video: String($('libVideo').value || '').trim().slice(0, 500), checked: $('libChecked').checked
    };
  }
  // under the video box: what the link is (with Preview), or why it can't be used (which blocks Save)
  function libVideoState() {
    var box = $('libVideoState'), inp = $('libVideo'), v = String(inp.value || '').trim(), info = E.videoInfo(v);
    if (!v) { box.hidden = true; box.innerHTML = ''; inp.removeAttribute('aria-invalid'); return true; }
    box.hidden = false;
    if (!info) {
      box.className = 'lib-vstate bad';
      box.innerHTML = '<span>Use a full link starting with https://</span>';
      inp.setAttribute('aria-invalid', 'true');
      return false;
    }
    inp.removeAttribute('aria-invalid');
    box.className = 'lib-vstate';
    box.innerHTML = '<span>' + esc(info.kind === 'youtube' ? 'YouTube video' : info.kind === 'vimeo' ? 'Vimeo video' : 'Link to ' + info.label) + '</span>' +
      '<button type="button" class="quiet" id="libPreview">' + PLAY + 'Preview</button>';
    return true;
  }
  // opts (Save to library from a builder row): { name, dose, row }; the new exercise starts ticked as checked
  function openLibEditor(entry, opts) {
    opts = opts || {};
    libEdit = { id: entry ? entry.id : '', row: opts.row || '', armed: false, dirty: false };
    libReturn = document.activeElement;
    var r = libReturn && libReturn.closest ? libReturn.closest('.ex-row') : null;
    libReturnRow = r ? r.dataset.id : '';
    fillLibForm(entry || { name: opts.name || '', dose: opts.dose || {}, checked: true });
    $('libTitle').textContent = entry ? 'Edit exercise' : 'New exercise';
    $('libMore').hidden = !entry;
    $('libDraftNote').hidden = !(entry && entry.id.charAt(0) === 's' && !entry.checked);
    libDisarm();
    openModal(els.libDialog, entry ? $('libTitle') : $('libName'), libAfter);
  }
  // after the editor closes: back to what opened it (or, when that was redrawn, its replacement), never a box
  function libAfter(restore) {
    if (!restore) return false;
    var el = libReturn;
    if (!el || !document.body.contains(el)) {
      el = libReturn && libReturn.dataset && libReturn.dataset.lib ? els.entry.querySelector('.lib-row[data-lib="' + libReturn.dataset.lib + '"]') : null;
      if (!el && libReturnRow) { var act = $('ex-' + libReturnRow + '-libact'); el = act && act.querySelector('button'); }
      if (!el) el = els.entry.querySelector('#libList .lib-row');
    }
    if (el) focusQuiet(el);
    return true;
  }
  function libSave() {
    if (!libEdit) return;
    var v = readLibForm();
    if (!v.name) { libErr('Add a name.'); $('libName').focus(); return; }
    var k = E.libKey(v.name), id = libEdit.id;
    if (libList().some(function (e) { return e.id !== id && E.libKey(e.name) === k; })) { libErr('Another exercise is already called that.'); $('libName').focus(); return; }
    if (!libVideoState()) { $('libVideo').focus(); return; }
    var entry = tidyEntry({ id: id || newId('c-'), name: v.name, aliases: v.aliases, areas: v.areas, type: v.type, equipment: v.equipment, dose: v.dose, cues: v.cues,
      instructions: v.instructions, video: v.video, checked: v.checked, updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() }, false);
    if (!entry) return;
    var ok = writeItem('library', entry.id, entry), row = libEdit.row ? exItem(libEdit.row) : null;
    if (row) { row.lib = entry.id; delete row.libWas; saveDraft(); }   // Save to library: that row is linked to the new exercise
    libEdit = null;
    afterLibChange();
    closeModal();
    toast(ok ? 'Saved ' + entry.name : 'Saved ' + entry.name + ' for now, but this device wouldn’t store it (storage is full or blocked).');
  }
  function libDisarm() {
    var b = $('libDelete');
    clearTimeout(libDelTimer);
    b.classList.remove('armed');
    b.textContent = 'Delete';
    if (libEdit) libEdit.armed = false;
  }
  function libDeleteTap() {                            // two taps, as for a client; Undo in the message writes it back
    if (!libEdit || !libEdit.id) return;
    var b = $('libDelete');
    if (!libEdit.armed) {
      libEdit.armed = true;
      b.classList.add('armed');
      b.textContent = 'Tap again to delete';
      clearTimeout(libDelTimer);
      libDelTimer = setTimeout(libDisarm, 4000);
      return;
    }
    clearTimeout(libDelTimer);
    var e = libGet(libEdit.id);
    libEdit = null;
    if (!e) { closeModal(); return; }
    writeItem('library', e.id, null);
    afterLibChange();
    closeModal();
    toast('Deleted ' + e.name, { label: 'Undo', run: function () { writeItem('library', e.id, e); afterLibChange(); } });
  }
  function libDuplicate() {                            // "<name> (copy)", as a new exercise not saved yet
    if (!libEdit || !libEdit.id) return;
    var v = readLibForm();
    v.name = cap((v.name || 'Exercise') + ' (copy)', 120);
    libEdit = { id: '', row: '', armed: false, dirty: true };
    fillLibForm(v);
    $('libTitle').textContent = 'New exercise';
    $('libMore').hidden = true;
    $('libDraftNote').hidden = true;
    focusQuiet($('libTitle'));
    toast('A copy: change it, then Save');
  }
  // Preview: the video dialog over the editor; closing it brings the editor back as it was
  function libPreview() {
    var url = String($('libVideo').value || '').trim();
    if (!E.videoInfo(url)) return;
    openVideo(cap($('libName').value, 120) || 'Exercise', url, function () {
      openModal(els.libDialog, $('libPreview') || $('libVideo'), libAfter);
      return true;
    });
  }
  // the pages and dialogs showing library entries, after an entry changed here or on another device
  function afterLibChange() {
    if (state.tool === 'ex' && state.exPage === 'library') renderLibList();
    else if (state.tool === 'ex' && state.exPage === 'builder') refreshExLinks();
    if (openModalEl === els.libPickDialog) renderLibPickList();
  }
  // the builder's rows follow their library exercise (strip and link actions updated in place, so no box loses focus)
  function refreshExLinks() {
    els.entry.querySelectorAll('#exTable .ex-row[data-id]').forEach(function (row) {
      var it = exItem(row.dataset.id);
      if (!it || it.kind !== 'ex') return;
      var s = $('ex-' + it.id + '-lib'), a = $('ex-' + it.id + '-links'), sh = exLibStripHtml(it), ah = exLibActHtml(it);
      if (s && s._h !== sh) { s.innerHTML = sh; s._h = sh; s.hidden = !sh; }
      if (a && a._h !== ah) { a.innerHTML = ah; a._h = ah; }
    });
    refreshEx();
  }

  // ---- + From library (#libPickDialog): tick exercises, Add N exercises (to the end, or into the section it was opened from).
  // v17: opened from a row's Swap (pickSwap: that row's id), one exercise is chosen and Swap puts it in the row's place.
  var pickView = { q: '', area: '' }, pickOrder = [], pickAfter = '', pickFrom = null, pickSwap = '';
  function openLibPick(from, after, swap) {
    pickView = { q: '', area: '' };
    pickOrder = [];
    pickAfter = after || '';
    pickFrom = from || null;
    var sw = swap ? exItem(swap) : null, was = sw ? clean1(sw.name) || (exLinked(sw) || {}).name || '' : '';
    pickSwap = sw ? sw.id : '';
    $('libPickTitle').textContent = !sw ? 'Add from the library' : was ? 'Swap “' + was + '” for…' : 'Swap for…';
    $('libPickSearch').value = '';
    $('libPickChips').innerHTML = areaChipsHtml('', 'data-pick-area');
    renderLibPickList();
    openModal(els.libPickDialog, els.libPickDialog.querySelector('#libPickList input:not(:disabled)') || $('libPickCancel'), function (restore) {
      if (restore && pickFrom && document.body.contains(pickFrom)) focusQuiet(pickFrom);
      return true;
    });
  }
  function renderLibPickList() {
    var box = $('libPickList'), all = libList(), shown = libFilter(all, { q: pickView.q, area: pickView.area }), q = clean1(pickView.q);
    var cur = pickSwap ? (exItem(pickSwap) || {}).lib || '' : '';
    els.libPickDialog.querySelectorAll('[data-pick-area]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.pickArea === pickView.area)); });
    if (!all.length) box.innerHTML = '<p class="client-none">The library is empty. Add exercises on the Exercise library page.</p>';
    else if (!shown.length) box.innerHTML = '<p class="client-none" role="status">' + (q.length >= 2 ? 'No exercises match “' + esc(q) + '”.' : 'No exercises match this area.') + '</p>';
    else {
      box.innerHTML = '<ul class="lp-list">' + shown.map(function (e) {
        var d = doseLine(e.dose);
        // v17: a Swap chooses one (round buttons); the exercise already in that row can't be chosen
        var now = !!pickSwap && e.id === cur, input = pickSwap ? '<input type="radio" name="libPickOne"' : '<input type="checkbox"';
        return '<li><label class="lp-row' + (now ? ' lp-now' : '') + '">' + input + ' data-lib="' + esc(e.id) + '"' + (pickOrder.indexOf(e.id) >= 0 ? ' checked' : '') + (now ? ' disabled' : '') + '>' +
          '<span class="lp-main"><b>' + esc(e.name) + '</b>' + (now ? '<span>In this row now</span>' : d ? '<span>' + esc(d) + '</span>' : '') + '</span>' +
          (hasVideo(e) ? '<span class="lp-vid">' + PLAY + '<span class="vh">Has a video</span></span>' : '') + '</label></li>';
      }).join('') + '</ul>';
    }
    libPickCount();
  }
  function libPickCount() {
    var n = pickOrder.length, b = $('libPickAdd');
    b.textContent = pickSwap ? 'Swap' : 'Add ' + n + (n === 1 ? ' exercise' : ' exercises');
    b.disabled = !n;
  }
  function libPickAdd() {
    if (pickSwap) { libPickSwap(); return; }
    var x = state.ex, ids = pickOrder.filter(function (id) { return libGet(id); });
    if (!ids.length) return;
    var rows = ids.map(function (id) {                 // in the order ticked: the name, the default dose and the link; no notes
      var e = libGet(id), o = { name: e.name, lib: e.id };
      DOSE.forEach(function (f) { o[f] = e.dose[f] || ''; });
      return newExRow(o);
    });
    var at = pickAfter ? exIndex(pickAfter) : -1;
    if (at >= 0) Array.prototype.splice.apply(x.items, [at + 1, 0].concat(rows));
    else rows.forEach(function (r) { x.items.push(r); });
    closeModal();
    renderExTable();
    foldNow('ex', false);
    var first = $('ex-' + rows[0].id + '-name');       // scrolled into view, not focused (no keyboard)
    if (first) first.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    toast('Added ' + rows.length + (rows.length === 1 ? ' exercise' : ' exercises'));
  }
  // v17: Swap: the chosen exercise takes the row's place: its name and link (so its cues and video), and its default dose
  // in any box still blank. The row's own sets, reps, load, rest, tempo, side and notes stay. Undo puts the old one back.
  function libPickSwap() {
    var x = state.ex, it = exItem(pickSwap), e = libGet(pickOrder[0]);
    if (!it || !e) { closeModal(); return; }
    var before = { name: it.name, lib: it.lib, libWas: it.libWas, filled: [], scanned: !!x.scanned[it.id] };
    var old = clean1(it.name) || (exLinked(it) || {}).name || 'the exercise';
    it.name = e.name; it.lib = e.id;
    delete it.libWas;
    DOSE.forEach(function (f) { if (blank(it[f]) && !blank(e.dose[f])) { it[f] = e.dose[f]; before.filled.push(f); } });
    delete x.scanned[it.id];                           // the name was chosen here, not read from the page
    closeModal(false);
    renderExTable();
    focusSwapped(it);
    toast('Swapped ' + old + ' for ' + e.name, { label: 'Undo', run: function () { undoSwap(x, it, e.id, before); } });
  }
  function focusSwapped(it) {                          // the row's handle: no keyboard, and a tap on the arrows moves it
    var g = $('ex-' + it.id + '-grip'), row = $('ex-' + it.id);
    if (row) { row.classList.remove('moved'); void row.offsetWidth; row.classList.add('moved'); }
    if (g) { focusQuiet(g); var r = g.getBoundingClientRect(); if (r.top < 120 || r.bottom > window.innerHeight - 110) g.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
  }
  // Undo a Swap, unless Clear all replaced the program, the row has gone, or its name has been changed again since
  function undoSwap(prog, it, to, before) {
    if (state.ex !== prog || exIndex(it.id) < 0 || it.lib !== to) return;
    it.name = before.name; it.lib = before.lib;
    if (before.libWas) it.libWas = before.libWas; else delete it.libWas;
    var e = libGet(to);
    before.filled.forEach(function (f) { if (e && it[f] === e.dose[f]) it[f] = ''; });
    if (before.scanned) prog.scanned[it.id] = true;
    if (state.tool !== 'ex' || state.exPage !== 'builder') { saveDraft(); return; }
    renderExTable();
    focusSwapped(it);
    toast('Back as it was');
  }

  // ---- the video dialog (#videoDialog): the player for YouTube and Vimeo (youtube-nocookie / do-not-track), else or
  // offline a message and the link. The player (iframe #videoFrame) is made when the dialog opens with the video's
  // address, and swapped for a blank one (about:blank) when it closes, which stops playback without leaving the old
  // address in the browser's history.
  function freshFrame(src, title) {
    var box = $('videoBox'), old = $('videoFrame'), fr = document.createElement('iframe');
    fr.id = 'videoFrame';
    fr.title = title || 'Exercise video';
    fr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    fr.setAttribute('allowfullscreen', '');
    fr.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    fr.setAttribute('loading', 'lazy');
    fr.src = src || 'about:blank';
    if (old) old.parentNode.replaceChild(fr, old); else box.appendChild(fr);
    return fr;
  }
  function openVideo(name, url, after) {
    var info = E.videoInfo(url);
    if (!info) return;
    var off = navigator.onLine === false, embed = off ? '' : info.embed, msg = $('videoMsg'), open = $('videoOpen');
    $('videoTitle').textContent = name;
    $('videoBox').hidden = !embed;
    msg.hidden = !!embed;
    msg.textContent = off ? 'Videos need an internet connection.' : 'This video opens in the browser.';
    open.href = info.link;
    open.textContent = info.kind === 'youtube' ? 'Open in YouTube' : info.kind === 'vimeo' ? 'Open in Vimeo' : 'Open link';
    openModal(els.videoDialog, $('videoClose'), function (restore) {
      if ($('videoFrame')) freshFrame('about:blank');
      return after ? after(restore) : false;
    });
    if (embed) freshFrame(embed, name + ' video');
  }

  // ------------------------------------------------------------------ program templates (v15)
  // A template is a program to start from: { id: 't-…', title, instructions, items, updatedBy, updatedAt } where items are
  // the sections (with a heading) and the exercises with something written (the eight boxes and the library link).
  function progItems(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (it) {
      if (!it || typeof it !== 'object' || out.length >= 400) return;
      if (it.kind === 'section') { var h = cap(it.heading, EX_LEN.heading); if (h) out.push({ kind: 'section', heading: h }); return; }
      if (it.kind !== 'ex') return;
      var o = { kind: 'ex' }, any = false;
      EX_FIELDS.forEach(function (f) { o[f] = cap(it[f], EX_LEN[f] || 60); if (o[f]) any = true; });
      if (!any) return;
      o.lib = typeof it.lib === 'string' && LIB_ID.test(it.lib) ? it.lib : '';
      out.push(o);
    });
    return out;
  }
  function tidyTpl(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.id !== 'string' || !TPL_ID.test(o.id)) return null;
    var title = cap(o.title, 120);
    if (!title) return null;
    return { id: o.id, title: title, instructions: exTidy(exStr(o.instructions), 'instructions'), items: progItems(o.items),
      updatedBy: cap(o.updatedBy, 120), updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt.slice(0, 40) : '' };
  }
  function tplAll() {
    var src = storedItems('templates');
    if (tplMemo && tplMemo.ver === libVer && tplMemo.src === src) return tplMemo;
    var byId = {};
    Object.keys(src).forEach(function (id) {
      var o = src[id];
      if (!TPL_ID.test(id) || !o || typeof o !== 'object' || o.deleted === true) return;
      var t = tidyTpl(o);
      if (t && t.id === id) byId[id] = t;
    });
    tplMemo = { ver: libVer, src: src, byId: byId, list: Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }) };
    return tplMemo;
  }
  function tplList() { return tplAll().list; }
  function tplGet(id) { return id && TPL_ID.test(id) ? tplAll().byId[id] || null : null; }
  function tplCountLine(t) {                           // '6 exercises · 2 sections'
    var n = 0, s = 0;
    t.items.forEach(function (it) { if (it.kind === 'ex') n++; else s++; });
    return n + (n === 1 ? ' exercise' : ' exercises') + (s ? ' · ' + s + (s === 1 ? ' section' : ' sections') : '');
  }
  function localDay(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function tplUpdLine(t) {                             // 'Updated 01 Oct 2026 · Matthew' (what is known)
    var day = t.updatedAt ? localDay(t.updatedAt) : '', by = clean1(t.updatedBy);
    return day ? 'Updated ' + E.displayIso(day) + (by ? ' · ' + by : '') : (by ? 'Updated by ' + by : '');
  }
  function tplMatches(list, q) {                       // the search box (more than 8 templates): words starting the title's words
    q = clean1(q);
    if (list.length <= 8 || q.length < 2) return list;
    var hit = {};
    E.libSuggest(q, list.map(function (t) { return { id: t.id, name: t.title }; }), list.length).forEach(function (x) { hit[x.id] = 1; });
    return list.filter(function (t) { return hit[t.id]; });
  }

  // ---- the templates page (Exercises › Program templates)
  var tplView = { q: '' }, tplDelTimer = null;
  function renderTemplates() {
    els.entry.innerHTML = '<div class="pagehead">' + pickHtml('ex') + '<p>Start a patient’s program from a template in the builder (Start from template).</p></div>' +
      '<div class="tpl-searchbar" id="tplSearchBar" hidden>' + searchHtml('tplSearch', tplView.q, 'Search templates') + '</div>' +
      '<div class="tpl-list" id="tplList"></div>';
    document.documentElement.classList.remove('has-strip');
    renderTplList();
  }
  function renderTplList() {
    var box = $('tplList');
    if (!box) return;
    var all = tplList(), shown = tplMatches(all, tplView.q);
    $('tplSearchBar').hidden = all.length <= 8;
    if (!all.length) {
      box.innerHTML = '<div class="lib-empty"><p>No templates yet. Build a program, then tap Save as template.</p><button type="button" class="ghost" data-action="tpl-builder">Open the builder</button></div>';
    } else if (!shown.length) box.innerHTML = '<div class="lib-empty"><p>No templates match “' + esc(clean1(tplView.q)) + '”.</p></div>';
    else {
      box.innerHTML = shown.map(function (t) {
        var upd = tplUpdLine(t), nm = esc(t.title);
        return '<div class="tpl-row" data-tpl="' + esc(t.id) + '"><div class="tpl-main"><b>' + nm + '</b><span>' + esc(tplCountLine(t)) + '</span>' +
          (upd ? '<span class="tpl-upd">' + esc(upd) + '</span>' : '') + '</div><div class="tpl-acts">' +
          '<button type="button" class="ghost" data-action="tpl-use">Use<span class="vh"> ' + nm + '</span></button>' +
          '<button type="button" class="quiet" data-action="tpl-rename" aria-haspopup="dialog">Rename<span class="vh"> ' + nm + '</span></button>' +
          '<button type="button" class="quiet tpl-del" data-action="tpl-del">Delete<span class="vh"> ' + nm + '</span></button></div></div>';
      }).join('');
    }
    renderTplSummary();
  }
  function renderTplSummary() {
    if (state.tool !== 'ex' || state.exPage !== 'templates') return;
    var n = tplList().length;
    els.summary.innerHTML = '<div class="sum tpl-sum"><div class="sum-scroll"><h2>Program templates</h2>' +
      '<div class="tally ex-tally tpl-tally"><div><b>' + n + '</b><span>' + (n === 1 ? 'Template' : 'Templates') + '</span></div></div>' +
      '<p class="fine">' + (CLOUD ? 'Shared by every signed-in device.' : 'Saved on this device.') + '</p></div>' +
      '<div class="sum-foot"><button type="button" class="ghost make" data-action="tpl-builder">Open the builder</button></div></div>';
    els.dock.innerHTML = '<div class="dt"><span class="ex-dock"><b>' + n + '</b> ' + (n === 1 ? 'template' : 'templates') + '</span></div>' +
      '<button type="button" class="ghost" data-action="tpl-builder">Open the builder</button>';
    els.dock.classList.remove('has-check', 'has-both');
  }
  function afterTplChange() {
    if (state.tool === 'ex' && state.exPage === 'templates') renderTplList();
    if (openModalEl === els.tplPickDialog) renderTplPickList();
  }
  function tplDeleteTap(b, id) {                       // two taps; Undo in the message writes it back
    var t = tplGet(id);
    if (!t) return;
    if (!b.classList.contains('armed')) {
      els.entry.querySelectorAll('.tpl-del.armed').forEach(function (x) { x.classList.remove('armed'); if (x._html) x.innerHTML = x._html; });
      b._html = b.innerHTML;
      b.classList.add('armed');
      b.textContent = 'Tap again to delete';
      clearTimeout(tplDelTimer);
      tplDelTimer = setTimeout(function () { if (b.classList.contains('armed')) { b.classList.remove('armed'); b.innerHTML = b._html; } }, 4000);
      return;
    }
    clearTimeout(tplDelTimer);
    writeItem('templates', id, null);
    afterTplChange();
    toast('Deleted ' + t.title, { label: 'Undo', run: function () { writeItem('templates', id, t); afterTplChange(); } });
  }
  // Use (templates page): to the builder, then the template in (asking Replace / Add when the program has exercises)
  function tplUse(id) {
    var t = tplGet(id);
    if (!t) return;
    if (exCounts().exercises) { setExPage('builder'); openTplPick(id); return; }
    applyTemplate(t, 'replace');
  }
  // replace: title and instructions from the template, its rows in place of the program's; add: its rows at the end.
  // Rows get fresh ids and keep their library link. Undo puts back exactly what was there.
  function applyTemplate(t, mode) {
    var x = state.ex, before = exSnap();
    var rows = t.items.map(function (it) { return it.kind === 'section' ? newExSection(it.heading) : newExRow(it); });
    if (mode === 'add') rows.forEach(function (r) { x.items.push(r); });
    else {
      if (t.title) x.title = t.title;
      x.instructions = t.instructions || '';
      x.items = rows;
      x.scanned = {};
      if (scanInfo && scanInfo.tool === 'ex') scanInfo = null;   // a scan's Undo no longer applies
    }
    foldBeforeRender('ex');
    if (state.exPage !== 'builder') { state.exPage = 'builder'; window.scrollTo(0, 0); }
    render();
    focusQuiet($('tplStart'));
    toast((mode === 'add' ? 'Added ' : 'Started from ') + t.title, { label: 'Undo', run: function () { exRestore(before, x); } });
  }

  // ---- Save as template (#tplSaveDialog)
  var tplArmed = '';
  function tplSaveErr(msg) { var p = $('tplSaveErr'); p.textContent = msg || ''; p.hidden = !msg; }
  function openTplSave() {
    if (!exCounts().exercises) { toast('Add at least one exercise to save a template'); return; }
    tplArmed = '';
    $('tplName').value = clean1(state.ex.title);
    $('tplSaveHint').textContent = (CLOUD ? 'Shared with the whole clinic.' : 'Saved on this device.') + ' The patient’s name and the date aren’t saved.';
    $('tplSaveGo').textContent = 'Save';
    tplSaveErr('');
    openModal(els.tplSaveDialog, $('tplName'));
  }
  function tplSaveGo() {
    var x = state.ex, name = cap($('tplName').value, 120);
    if (!name) { tplSaveErr('Add a name.'); $('tplName').focus(); return; }
    if (!exCounts().exercises) { tplSaveErr('Add at least one exercise first.'); return; }
    var k = E.libKey(name), dup = tplList().filter(function (t) { return E.libKey(t.title) === k; })[0];
    if (dup && tplArmed !== dup.id) {                  // the same name: a second tap replaces that template (keeping its id)
      tplArmed = dup.id;
      $('tplSaveGo').textContent = 'Replace ' + dup.title;
      tplSaveErr('A template is already called that. Tap Replace to save over it.');
      return;
    }
    var tpl = { id: dup ? dup.id : newId('t-'), title: name, instructions: exTidy(x.instructions, 'instructions'), items: progItems(x.items),
      updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() };
    var ok = writeItem('templates', tpl.id, tpl);
    afterTplChange();
    closeModal();
    toast(ok ? 'Saved template ' + name : 'This device wouldn’t save the template (storage is full or blocked).');
  }

  // ---- Start from template (#tplPickDialog); with useId (Use on the templates page) only the Replace / Add choice
  var tplPickUse = '';
  function openTplPick(useId) {
    var t = useId ? tplGet(useId) : null, filled = exCounts().exercises > 0;
    tplPickUse = t ? t.id : '';
    $('tplPickTitle').textContent = t ? 'Use ' + t.title : 'Start from template';
    $('tplModeWrap').hidden = !filled;
    els.tplPickDialog.querySelector('input[name="tplMode"][value="replace"]').checked = true;
    $('tplPickSearch').value = '';
    $('tplPickSearchWrap').hidden = !!t || tplList().length <= 8;
    $('tplPickList').hidden = !!t;
    $('tplPickUse').hidden = !t;
    renderTplPickList();
    openModal(els.tplPickDialog, t ? $('tplPickUse') : (els.tplPickDialog.querySelector('#tplPickList .cl-pick') || $('tplPickCancel')));
  }
  function renderTplPickList() {
    var box = $('tplPickList'), all = tplList(), shown = tplMatches(all, $('tplPickSearch').value);
    $('tplPickSearchWrap').hidden = !!tplPickUse || all.length <= 8;
    if (!all.length) { box.innerHTML = '<p class="client-none">No templates yet. Build a program, then tap Save as template.</p>'; return; }
    if (!shown.length) { box.innerHTML = '<p class="client-none" role="status">No templates match “' + esc(clean1($('tplPickSearch').value)) + '”.</p>'; return; }
    box.innerHTML = '<ul class="client-list pick tpl-pick">' + shown.map(function (t) {
      return '<li><button type="button" class="cl-pick" data-tpl="' + esc(t.id) + '"><b>' + esc(t.title) + '</b><span>' + esc(tplCountLine(t)) + '</span></button></li>';
    }).join('') + '</ul>';
  }
  function tplPicked(id) {
    var t = tplGet(id), r = els.tplPickDialog.querySelector('input[name="tplMode"]:checked');
    if (!t) return;
    var mode = !$('tplModeWrap').hidden && r && r.value === 'add' ? 'add' : 'replace';
    closeModal(false);
    applyTemplate(t, mode);
  }

  // ---- Rename (#tplRenameDialog): another template may not have the same name
  var tplRenaming = '';
  function tplRenameErr(msg) { var p = $('tplRenameErr'); p.textContent = msg || ''; p.hidden = !msg; }
  function openTplRename(id) {
    var t = tplGet(id);
    if (!t) return;
    tplRenaming = id;
    $('tplRenameBox').value = t.title;
    tplRenameErr('');
    openModal(els.tplRenameDialog, $('tplRenameBox'), function (restore) {
      var b = els.entry.querySelector('.tpl-row[data-tpl="' + id + '"] [data-action="tpl-rename"]');
      if (restore && b) focusQuiet(b);
      return true;
    });
    try { $('tplRenameBox').select(); } catch (e) { /* not selectable */ }
  }
  function tplRenameGo() {
    var t = tplGet(tplRenaming), name = cap($('tplRenameBox').value, 120);
    if (!t) { closeModal(); return; }
    if (!name) { tplRenameErr('Add a name.'); $('tplRenameBox').focus(); return; }
    var k = E.libKey(name);
    if (tplList().some(function (o) { return o.id !== t.id && E.libKey(o.title) === k; })) { tplRenameErr('Another template is already called that.'); $('tplRenameBox').focus(); return; }
    if (name !== t.title) {
      writeItem('templates', t.id, { id: t.id, title: name, instructions: t.instructions, items: t.items, updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() });
      afterTplChange();
      toast('Renamed to ' + name);
    }
    closeModal();
  }

  // ---- the Exercises pages' own buttons (library, templates, library links and the client bar in the builder)
  function exPageButton(b) {
    var a = b.dataset.action;
    if (b.dataset.libSugg) { exTakeSuggestion(b); return true; }
    if (a === 'ex-loadprog') { loadProgramFor(b.dataset.client, false); return true; }
    if (a === 'tpl-start') { openTplPick(''); return true; }
    if (a === 'tpl-save') { openTplSave(); return true; }
    if (a === 'tpl-builder') { setExPage('builder'); focusQuiet(pickBtn()); return true; }
    if (a === 'lib-new') { openLibEditor(null); return true; }
    if (a === 'lib-open') { var e = libGet(b.dataset.lib); if (e) openLibEditor(e); return true; }
    if (a === 'lib-clear') { libView = { q: '', area: '', video: false, drafts: false }; renderLibrary(); return true; }
    if (b.dataset.libArea !== undefined) { libView.area = libView.area === b.dataset.libArea ? '' : b.dataset.libArea; libChipsSync(); renderLibList(); return true; }
    if (b.dataset.libFlag) { libView[b.dataset.libFlag] = !libView[b.dataset.libFlag]; libChipsSync(); renderLibList(); return true; }
    var row = b.closest('.tpl-row'), id = row && row.dataset.tpl;
    if (id && a === 'tpl-use') { tplUse(id); return true; }
    if (id && a === 'tpl-rename') { openTplRename(id); return true; }
    if (id && a === 'tpl-del') { tplDeleteTap(b, id); return true; }
    return false;
  }
  // the dialogs of the library and the templates (their markup is in index.html)
  function wireExDialogs() {
    var d = els.libDialog;
    d.addEventListener('click', function (e) {
      if (e.target === d) { if (!(libEdit && libEdit.dirty)) closeModal(); return; }   // a tap outside closes it unless something was changed
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.area) { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); if (libEdit) libEdit.dirty = true; return; }
      if (b.id === 'libPreview') libPreview();
      else if (b.id === 'libSave') libSave();
      else if (b.id === 'libCancel') closeModal();
      else if (b.id === 'libDuplicate') libDuplicate();
      else if (b.id === 'libDelete') libDeleteTap();
    });
    d.addEventListener('input', function (e) {
      if (libEdit) libEdit.dirty = true;
      if (e.target.id === 'libVideo') libVideoState();
      if (e.target.id === 'libName') libErr('');
    });
    d.addEventListener('change', function () { if (libEdit) libEdit.dirty = true; });
    d.addEventListener('keydown', function (e) {       // Return in a one-line box moves to the next box
      if (e.key !== 'Enter' || !e.target.matches('input:not([type=checkbox])')) return;
      e.preventDefault();
      var f = modalFocusables(d).filter(function (x) { return x.matches('input:not([type=checkbox]), select, textarea'); }), i = f.indexOf(e.target);
      if (i >= 0 && i < f.length - 1) f[i + 1].focus(); else e.target.blur();
    });
    var p = els.libPickDialog;
    p.addEventListener('click', function (e) {
      if (e.target === p) { closeModal(); return; }
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pickArea !== undefined) { pickView.area = pickView.area === b.dataset.pickArea ? '' : b.dataset.pickArea; renderLibPickList(); }
      else if (b.id === 'libPickAdd') libPickAdd();
      else if (b.id === 'libPickCancel') closeModal();
    });
    p.addEventListener('change', function (e) {
      var cb = e.target;
      if (cb.matches('input[type=radio][data-lib]')) { pickOrder = cb.checked ? [cb.dataset.lib] : []; libPickCount(); return; }   // v17: Swap
      if (!cb.matches('input[type=checkbox][data-lib]')) return;
      var i = pickOrder.indexOf(cb.dataset.lib);
      if (cb.checked && i < 0) pickOrder.push(cb.dataset.lib);
      else if (!cb.checked && i >= 0) pickOrder.splice(i, 1);
      libPickCount();
    });
    $('libPickSearch').addEventListener('input', function () { pickView.q = $('libPickSearch').value; renderLibPickList(); });
    var v = els.videoDialog;
    v.addEventListener('click', function (e) { if (e.target === v || e.target.closest('#videoClose')) closeModal(); });
    var s = els.tplSaveDialog;
    s.addEventListener('click', function (e) {
      if (e.target === s || e.target.closest('#tplSaveCancel')) closeModal();
      else if (e.target.closest('#tplSaveGo')) tplSaveGo();
    });
    $('tplName').addEventListener('input', function () { if (tplArmed) { tplArmed = ''; $('tplSaveGo').textContent = 'Save'; } tplSaveErr(''); });
    $('tplName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tplSaveGo(); } });
    var tp = els.tplPickDialog;
    tp.addEventListener('click', function (e) {
      if (e.target === tp) { closeModal(); return; }
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tpl) tplPicked(b.dataset.tpl);
      else if (b.id === 'tplPickUse') tplPicked(tplPickUse);
      else if (b.id === 'tplPickCancel') closeModal();
    });
    $('tplPickSearch').addEventListener('input', renderTplPickList);
    var r = els.tplRenameDialog;
    r.addEventListener('click', function (e) {
      if (e.target === r || e.target.closest('#tplRenameCancel')) closeModal();
      else if (e.target.closest('#tplRenameGo')) tplRenameGo();
    });
    $('tplRenameBox').addEventListener('input', function () { tplRenameErr(''); });
    $('tplRenameBox').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tplRenameGo(); } });
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
    } else if (c.inputs) {
      // hamstring and ACL (v18): what was typed (the LSI worked out), the same numbers as the scored rows, so the
      // trend lines show before the phase and norm set are chosen too
      Object.keys(c.inputs).forEach(function (name) { var n = E.num(c.inputs[name].result); if (n !== null) out[name] = n; });
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
    return storeSession(key, name, sess);
  }
  // a session into the client's record: the same tool and date replaces the earlier save (in the clinic store the
  // version being replaced goes to history first)
  function storeSession(key, name, sess) {
    var cl = clients.clients[key] || (clients.clients[key] = { name: name, sessions: [] });
    cl.name = name;
    var replaced = false, old = null;
    cl.sessions = cl.sessions.filter(function (x) { if (x.tool === sess.tool && x.date === sess.date) { replaced = true; old = x; return false; } return true; });
    cl.sessions.push(sess);
    cl.sessions = E.sortSessions(cl.sessions);
    var ok = saveClients();
    if (CLOUD) {
      if (old) CLOUD.historyCopy(key, name, old);
      CLOUD.putSession(key, name, sess);
      CLOUD.sync();
    }
    return { ok: ok, name: name, replaced: replaced, count: cl.sessions.length };
  }
  // v15: Create handout with a patient name saves the program as printed (the cues and video links of linked rows
  // included) as an Exercises session: no results, so nothing that reads results or previous values ever uses it
  function saveProgram(program) {
    var m = state.ex.meta, name = String(m.name || '').trim(), key = E.nameKey(name);
    if (!key || !program) return null;
    var sess = { tool: 'ex', date: m.date || todayIso(), savedAt: new Date().toISOString(), meta: {}, values: {}, results: {}, mass: null, interp: '', program: program };
    if (!blank(m.practitioner)) sess.meta.practitioner = clean1(m.practitioner);
    if (userName()) sess.savedBy = userName();
    return storeSession(key, name, sess);
  }
  // v15: a client's saved programs, oldest first (by date, then when saved)
  function exPrograms(cl) {
    return cl ? E.sortSessions(cl.sessions.filter(function (x) { return x && x.tool === 'ex' && x.program && typeof x.program === 'object'; })) : [];
  }
  function exHasContent() {
    var x = state.ex, c = exCounts();
    return c.exercises > 0 || c.sections > 0 || !blank(x.title) || !blank(x.instructions);
  }
  // v15: a client chosen on the Exercises tab: the name, and their last saved program in place of the one on screen
  // (title, instructions and rows with fresh ids; each row keeps its library link, dose and notes; the cues and video
  // come from the library). The date stays (a new visit). Undo puts back what was replaced.
  var exLoaded = null;                                 // { key, date }: the program loaded last (the client bar says so)
  function loadProgramFor(key, picked, undoClear, was) {
    var cl = clients.clients[key];
    if (!cl) return;
    var x = state.ex, last = exPrograms(cl).slice(-1)[0];
    x.meta.name = cl.name;
    hideSuggest();
    if (!last) {
      exLoaded = null;
      if (picked) foldBeforeRender('ex');
      render();
      // v18: the client bar says there are no programs yet; a message only for a page cleared for this client (Undo)
      if (undoClear) toast('Cleared ' + (was ? was + '’s' : 'the last') + ' program for ' + cl.name, { label: 'Undo', run: undoClear });
      return;
    }
    var had = exHasContent(), before = exSnap(), p = last.program;
    x.title = exTidy(exStr(p.title), 'title');
    x.instructions = exTidy(exStr(p.instructions), 'instructions');
    x.items = progItems(p.items).map(function (it) { return it.kind === 'section' ? newExSection(it.heading) : newExRow(it); });
    if (p.plan) x.plan = tidyPlan(p.plan);             // v23: the client's last plan (sessions a week, setting, experience, block)
    x.scanned = {};
    if (scanInfo && scanInfo.tool === 'ex') scanInfo = null;   // a scan's Undo no longer applies to this program
    exLoaded = { key: key, date: last.date };
    foldBeforeRender('ex');
    render();
    // v18: a message only when there is something to undo (the client bar says what was loaded)
    if (undoClear) toast('Loaded ' + cl.name + '’s program from ' + E.displayIso(last.date), { label: 'Undo', run: undoClear });
    else if (had) toast('Loaded ' + cl.name + '’s program from ' + E.displayIso(last.date), { label: 'Undo', run: function () {
      if (state.ex !== x) return;
      exLoaded = null;
      exRestore(before, x);
    } });
  }
  // the client bar on the Exercises tab: the record's programs, or that there are none yet
  function refreshExClientBar() {
    var bar = $('clientBar');
    if (!bar) return;
    var key = E.nameKey(state.ex.meta.name), cl = key ? clients.clients[key] : null;
    if (!cl) { bar.hidden = true; bar.innerHTML = ''; bar.className = 'client-bar'; return; }
    var progs = exPrograms(cl), n = progs.length, last = n ? progs[n - 1].date : '';
    bar.hidden = false;
    if (exLoaded && exLoaded.key === key) {
      bar.className = 'client-bar loaded';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> — program from ' + esc(E.displayIso(exLoaded.date)) + ' loaded.';
    } else if (n) {
      bar.className = 'client-bar';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> — ' + (n === 1 ? '1 saved program, from ' : n + ' saved programs, the last on ') + esc(E.displayIso(last)) + '. ' +
        '<button type="button" class="quiet" data-action="ex-loadprog" data-client="' + esc(key) + '">Load last program</button>';
    } else {
      bar.className = 'client-bar';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> has a ' + recordWord() + '; no programs yet.';
    }
  }
  function earlierCount(cl, t, date) {
    return cl ? cl.sessions.filter(function (x) { return x.tool === t && x.date < date; }).length : 0;
  }
  // fill Previous results (and unchanging details) from the client's record. picked: chosen in Choose client (v11), which
  // folds the details card once the essentials are in; otherwise it folds when earlier results were loaded (never under a
  // box being typed in, e.g. a name suggestion tapped)
  function loadHistory(t, key, picked, undo, was) {
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
        if (all[i].tool === 'ex') continue;            // v15: a saved exercise program holds no test details
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
    // v18: a returning client starts on "Only last time's tests" (one tap shows them all); the same client reloaded keeps the choice
    if (!s.hist || s.hist.key !== key) s.onlyPrev = n > 0;
    s.hist = { key: key, name: cl.name, n: n, dates: Object.keys(dates).sort(), date: date };
    hideSuggest();
    if (picked || n) foldBeforeRender(t);
    render();
    // v18: no 'Loaded …' message: the client bar says the same. Only a page cleared for this client has one (with Undo)
    if (undo) toast('Cleared ' + (was ? was + '’s' : 'the last client’s') + ' entries for ' + cl.name, { label: 'Undo', run: undo });
  }
  function pickClient(key) { if (state.tool === 'ex') loadProgramFor(key, false); else loadHistory(state.tool, key); }
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
  // v15: suggestion lists close when their box loses focus (the one whose box has it again stays: a client name and an
  // exercise name can each have a list)
  function hideSuggestExcept(a) {
    els.entry.querySelectorAll('.suggest').forEach(function (b) {
      var owner = b.parentNode && b.parentNode.querySelector('input, textarea');
      if (a && owner === a) return;
      b.hidden = true; b.innerHTML = '';
    });
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
    if (!name) return t === 'ex' ? 'Add a patient name to save this program to a ' + recordWord() + '.' : 'Add a name to save this session to a ' + recordWord() + '.';
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
  // button that loads that client, plus New client. manage (the header's Clients button): v18, the rows load a client
  // too (until v17 they could only be deleted), and Edit shows each row's two-tap Delete.
  // Back up and Restore are in the ⋯ menu.
  var clientsMode = 'manage', clientsEditing = false;
  function openClientsDialog(mode) {
    var pick = mode === 'pick' && (TOOLS.indexOf(state.tool) >= 0 || state.tool === 'ex');   // v15: Exercises picks a client too
    clientsMode = pick ? 'pick' : 'manage';
    clientsEditing = false;
    if (CLOUD) CLOUD.sync({ throttle: true });         // v13: another device may have saved something (the list redraws when it lands)
    els.clientsSearch.value = '';
    els.clientsTitle.textContent = pick ? 'Choose client' : 'Clients';
    els.clientsNew.hidden = !pick;
    els.clientsClose.textContent = pick ? 'Cancel' : 'Close';
    els.clientsClose.className = pick ? 'ghost' : 'primary';
    els.clientsFine.hidden = pick;
    syncClientsEdit();
    renderClientsList();
    // no box focused at first (the iPad keyboard would cover the list): the first client, else New client / Close
    openModal(els.clientsDialog, els.clientsList.querySelector('.cl-pick') || (pick ? els.clientsNew : els.clientsClose));
  }
  function syncClientsEdit() {                         // v18: Edit (manage mode, with clients to delete) ↔ Done
    els.clientsEdit.hidden = clientsMode !== 'manage' || !clientKeys().length;
    els.clientsEdit.textContent = clientsEditing ? 'Done' : 'Edit';
    els.clientsEdit.setAttribute('aria-pressed', String(clientsEditing));
  }
  function toggleClientsEdit() {
    clientsEditing = !clientsEditing;
    syncClientsEdit();
    renderClientsList();
    focusQuiet(els.clientsEdit);
  }
  function clientKeys() {
    return Object.keys(clients.clients).sort(function (a, b) { return clients.clients[a].name.localeCompare(clients.clients[b].name); });
  }
  // 'Last test 29 Sep 2026 · Performance screen, LL Strength · Program 01 Oct 2026' (v15: the last saved program, if any)
  function clientDetail(cl) {
    var last = '', used = {}, prog = '';
    cl.sessions.forEach(function (x) {
      if (x.tool === 'ex') { if (x.date > prog) prog = x.date; return; }
      if (x.date > last) last = x.date;
      used[x.tool] = 1;
    });
    var tools = TOOLS.filter(function (t) { return used[t]; }).map(function (t) { return TOOL_NAMES[t]; }).join(', ');
    return [last ? 'Last test ' + E.displayIso(last) : '', tools, prog ? 'Program ' + E.displayIso(prog) : ''].filter(Boolean).join(' · ') || 'No sessions';
  }
  function renderClientsList() {
    var keys = clientKeys(), total = 0, pick = clientsMode === 'pick', typed = els.clientsSearch.value.trim(), q = E.nameKey(typed);
    if (!keys.length) clientsEditing = false;          // v18: nothing left to delete
    syncClientsEdit();
    keys.forEach(function (k) { total += clients.clients[k].sessions.length; });
    var loads = state.tool === 'ex' ? 'Loading a client fills in their name and their last saved program.' : 'Loading a client fills in their details and their results from last time.';
    els.clientsSummary.textContent = !keys.length ? 'No saved clients yet. A record starts when you create a report with a name filled in.'
      : pick ? loads
        : keys.length + (keys.length === 1 ? ' client, ' : ' clients, ') + total + (total === 1 ? ' session' : ' sessions') + (CLOUD ? ', in the clinic store. ' : ', saved on this device. ') +
          (clientsEditing ? 'Tap Delete to remove a client.' : 'Tap a name to load it here.');
    els.clientsSearchWrap.hidden = !keys.length;
    var shown = q ? keys.filter(function (k) { return k.indexOf(q) >= 0; }) : keys;
    if (!keys.length) { els.clientsList.innerHTML = ''; return; }
    if (!shown.length) { els.clientsList.innerHTML = '<p class="client-none" role="status">No clients match “' + esc(typed) + '”.</p>'; return; }
    var del = !pick && clientsEditing;                 // v18: Delete only in Edit; otherwise every row loads its client
    els.clientsList.innerHTML = '<ul class="client-list' + (del ? '' : ' pick') + '">' + shown.map(function (k) {
      var cl = clients.clients[k], d = '<b>' + esc(cl.name) + '</b><span>' + esc(clientDetail(cl)) + '</span>';
      return !del ? '<li><button type="button" class="cl-pick" data-action="pick-client" data-key="' + esc(k) + '">' + d + '</button></li>'
        : '<li><div class="cl-main">' + d + '</div><button type="button" class="quiet cl-del" data-action="delete-client" data-key="' + esc(k) + '">Delete</button></li>';
    }).join('') + '</ul>';
  }
  // a client chosen (Choose client, or v18 a name tapped in Clients): the name and the existing load (details and
  // previous results), then the card folds if it can. v18: a page holding another client's entries starts clean first
  // (until v17 those results stayed and were saved under the client chosen); Undo in the message puts them back.
  function pickFromDialog(key) {
    var t = state.tool;
    closeModal(false);
    if ((TOOLS.indexOf(t) < 0 && t !== 'ex') || !clients.clients[key]) return;
    if (t === 'ex' && state.exPage !== 'builder') state.exPage = 'builder';   // v18: from the library or templates page
    var cur = E.nameKey(state[t].meta.name), was = clean1(state[t].meta.name);
    var undo = cur && cur !== key && clientContent(t, true) ? clearForClient(t) : null;
    // v19: another client chosen in the builder: the program no longer goes with that report (its name stops following)
    if (t === 'ex' && state.ex.link && key !== E.nameKey(state.ex.meta.name)) state.ex.link = '';
    if (t === 'ex') loadProgramFor(key, true, undo, was);   // v15: their last saved program
    else loadHistory(t, key, true, undo, was);
    focusQuiet(state[t].cardOpen === false ? document.querySelector('#athleteStrip [data-action="edit-athlete"]') : document.querySelector('#athleteCard [data-action="choose-client"]'));
  }
  // New client: a clean page, the name box ready to type in. v18: the page is cleared when it holds someone's entries
  // (until v17 only the name went, so the last client's details and results were saved under the new one); a page
  // with no name yet keeps what is on it (results typed before the client was named)
  function newClient() {
    var t = state.tool;
    closeModal(false);
    if (TOOLS.indexOf(t) < 0 && t !== 'ex') return;
    var named = !blank(state[t].meta.name), more = named && clientContent(t, true), undo = null;
    if (named) undo = clearForClient(t);
    if (t === 'ex') exLoaded = null;
    state[t].cardOpen = true;
    render();
    var box = $(t + '-name');
    if (box) box.focus();
    if (more) toast('Started a new client', { label: 'Undo', run: undo });
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
      libVer++;                                        // v15: the store's library and templates come with the new cache
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
    var n = CLOUD.pendingCount(), ch = +(CLOUD.status().changes || 0);   // v15: library and template changes wait too
    if (!n && !ch) { signOutNow(); return; }
    els.signOutText.textContent = (n && ch ? waitingWords(n, ch) + ' are' : n ? n + (n === 1 ? ' result is' : ' results are') : ch + (ch === 1 ? ' library change is' : ' library changes are')) +
      ' still waiting to upload — sign out anyway?';
    openModal(els.signOutDialog, els.signOutCancel);
  }
  // '2 results', '1 library change', '2 results and 1 library change' (library and template writes are "library changes")
  function waitingWords(n, ch) {
    var a = n + (n === 1 ? ' result' : ' results'), b = ch + (ch === 1 ? ' library change' : ' library changes');
    return n && ch ? a + ' and ' + b : (n ? a : b);
  }
  function signOutNow() {
    closeModal(false);
    CLOUD.signOut();                                   // cloud.js drops the login and the cache, then says so (onCloudChange)
  }
  // the slim bar under the app bar: waiting uploads while offline / after a failed push, or a permission refusal
  function renderCloudBar() {
    var bar = els.cloudBar;
    if (!bar) return;
    var s = CLOUD.status(), text = '', cls = 'cloud-bar', ch = +(s.changes || 0), any = s.pending || ch;
    var n = waitingWords(s.pending, ch);               // v15: queued library and template changes are counted too
    if (!CLOUD.signedIn()) text = '';
    else if (s.denied) {
      text = 'The clinic store refused this device (permission). ' + (s.pending && ch ? 'Results and library changes are' : ch && !s.pending ? (ch === 1 ? 'The library change is' : 'Library changes are') : 'Results are') +
        ' kept on this device until it is fixed.';
      cls += ' denied';
    } else if (any && s.offline) text = 'Offline — ' + n + ' will upload when you’re back online.';
    else if (any && s.failed) text = n + ' waiting to upload — the clinic store didn’t answer. The app will try again shortly.';
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
    } else if (evt.kind === 'library' || evt.kind === 'templates') {   // v15: another device changed the library or a template
      libVer++;
      if (!state) return;
      if (evt.kind === 'library') afterLibChange(); else afterTplChange();
    } else if (evt.kind === 'synced') {
      libVer++;                                        // (the merged library is rebuilt from the cache on next use)
      if (state) maybeLegacyPrompt();
    } else if (evt.kind === 'signout') {
      libVer++;                                        // the store's library and templates went with the cache
      showSignIn(evt.message || '');
    } else if (evt.kind === 'auth') {
      libVer++;
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
  function fetchText(url) {                            // v23: the programming guide (markdown)
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.text();
    });
  }
  function start() {
    // the AI settings are optional: the app works without them (the Draft button explains)
    var ai = fetchJson('interpretation.json').catch(function () { return null; });
    // so are the metric explainers: without them the names are plain text and the PDF has no explainer lines
    var explain = fetchJson('explainers.json').catch(function () { return null; });
    // v15: and the starter exercise library (without it the library holds only the clinic's own exercises)
    var starter = fetchJson('exercise_library.json').catch(function () { return null; });
    // v23: the clinic's programming guide, which Suggest from the report follows (without it Claude works from the prompt alone)
    var guide = fetchText('programming_guide.md').catch(function () { return ''; });
    // v24: the evidence guide library (about 300 KB): guides/index.json names the guides and says which go with which
    // request; each file is fetched on its own so one missing file costs only that guide (an HTML 404 page from an older
    // cache is not a guide). It loads alongside the app rather than before it: Suggest from the report waits for it.
    guidesReady = fetchJson('guides/index.json').then(function (ix) {
      if (!ix || typeof ix !== 'object' || !ix.guides || typeof ix.guides !== 'object') return;
      var ids = Object.keys(ix.guides).filter(function (id) { return /^[a-z0-9-]{1,40}$/.test(id) && ix.guides[id] && typeof ix.guides[id].file === 'string'; });
      return Promise.all(ids.map(function (id) { return fetchText(ix.guides[id].file).catch(function () { return ''; }); })).then(function (texts) {
        var texts2 = {};
        ids.forEach(function (id, i) { if (typeof texts[i] === 'string' && texts[i] && texts[i].indexOf('<') !== 0) texts2[id] = texts[i]; });
        DATA.guideIndex = ix; DATA.guides = texts2;
      });
    }).catch(function () { /* no guide library: Suggest says so */ });
    Promise.all([fetchJson('norms.json'), fetchJson('hamstring_norms.json'), fetchJson('acl_norms.json'), fetchJson('strength_norms.json'), ai, explain, starter, guide]).then(function (r) {
      DATA.screen = r[0]; DATA.ham = r[1]; DATA.acl = r[2]; DATA.str = r[3]; DATA.ai = r[4];
      DATA.guide = typeof r[7] === 'string' && r[7].indexOf('<') !== 0 ? r[7] : '';   // (an HTML 404 page from an older cache is not a guide)
      DATA.explain = r[5] && r[5].metrics && typeof r[5].metrics === 'object' ? r[5] : { metrics: {} };
      localLib = loadItems(LIB_STORE);                 // v15: local mode's library and templates (cloud mode reads the store's cache)
      localTpl = loadItems(TPL_STORE);
      setStarter(r[6]);
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
        var im = importMenu();                                         // v18
        if (im && !im.hidden && to && !im.contains(to) && to !== $('importBtn')) setImportMenu(false, false);
      });
      els.entry.addEventListener('keydown', function (e) {             // v18: Escape and the arrow keys in the Import results menu
        var im = importMenu();
        if (!im || im.hidden || !im.contains(e.target)) return;
        var items = Array.prototype.slice.call(im.querySelectorAll('.menu-item input')), i = items.indexOf(e.target);
        if (e.key === 'Escape') { e.preventDefault(); setImportMenu(false, true); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      });
      els.entry.addEventListener('click', function (e) {               // v18: a choice made: the menu closes once its picker is up
        if (e.target.closest && e.target.closest('#importMenu .menu-item')) setTimeout(function () { setImportMenu(false, false); }, 300);
      });
      // the ⋯ menu (v11)
      els.moreBtn.addEventListener('click', function () { if (menuOpen()) closeMenu(true); else openMenu(false); });
      els.moreBtn.addEventListener('keydown', function (e) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !menuOpen()) { e.preventDefault(); e.stopPropagation(); openMenu(e.key === 'ArrowUp'); }
      });
      document.addEventListener('pointerdown', function (e) {       // a tap anywhere else closes it
        if (menuOpen() && !els.moreMenu.contains(e.target) && !els.moreBtn.contains(e.target)) closeMenu(false);
        var im = importMenu(), ib = $('importBtn');                  // v18: and the Import results menu
        if (im && !im.hidden && !im.contains(e.target) && !(ib && ib.contains(e.target))) setImportMenu(false, false);
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
      els.demoItem.addEventListener('click', menuAction(fillExample));   // v18
      els.clearCancel.addEventListener('click', function () { closeModal(); });
      els.clearConfirm.addEventListener('click', clearAllData);
      els.aiSave.addEventListener('click', saveAiKey);
      els.aiCancel.addEventListener('click', function () { closeModal(); });
      els.aiRemove.addEventListener('click', removeAiKey);
      els.aiKey.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveAiKey(); } });
      els.clientsBtn.addEventListener('click', function () { openClientsDialog('manage'); });
      els.clientsClose.addEventListener('click', function () { closeModal(); });
      els.clientsNew.addEventListener('click', newClient);
      els.clientsEdit.addEventListener('click', toggleClientsEdit);   // v18
      els.clientsSearch.addEventListener('input', function () { renderClientsList(); });
      els.clientsRestore.addEventListener('change', function () { restoreClients(els.clientsRestore.files); els.clientsRestore.value = ''; });
      els.clientsList.addEventListener('click', onClientsClick);
      // Tests today (v11)
      els.testsList.addEventListener('change', function (e) { if (e.target.matches('input[data-part]')) saveTestsChoice(); });
      els.testsAll.addEventListener('click', function () { setAllTests(true); });
      els.testsNone.addEventListener('click', function () { setAllTests(false); });
      els.testsDone.addEventListener('click', function () { closeModal(); });
      [els.clearDialog, els.aiDialog, els.clientsDialog, els.testsDialog, els.homeDialog].forEach(function (d) {
        d.addEventListener('click', function (e) { if (e.target === d) closeModal(); });
      });
      // tapping a suggested client must not blur the name box before the tap lands
      els.entry.addEventListener('pointerdown', function (e) { if (e.target.closest('.suggest')) e.preventDefault(); });
      els.entry.addEventListener('pointerdown', onGripDown);   // v16: slide a program row up or down by its handle
      els.entry.addEventListener('keydown', onGripKey);        // (or move it with the arrow keys)
      els.entry.addEventListener('focusout', function (e) {
        var t = e.target, ds = t.dataset || {};
        // a client name box, or (v15) an exercise name box with the library's suggestions: its list closes with it
        if (ds.meta === 'name' || (ds.f === 'name' && t.closest('.ex-row'))) setTimeout(function () { hideSuggestExcept(document.activeElement); }, 200);
      });
      els.entry.addEventListener('keydown', function (e) {   // v15: Escape closes a suggestion list (Return still moves on)
        if (e.key !== 'Escape' || !e.target.matches('input, textarea')) return;
        var box = e.target.parentNode && e.target.parentNode.querySelector('.suggest:not([hidden])');
        if (!box && e.target.dataset.meta === 'name') box = $(state.tool + '-name-sugg');
        if (box && !box.hidden) { e.preventDefault(); e.stopPropagation(); box.hidden = true; box.innerHTML = ''; }
      });
      wireExDialogs();                                 // v15: the library editor, + From library, the video player, templates
      els.back.addEventListener('click', closeReport);
      els.sheetExBtn.addEventListener('click', addProgramFromReport);   // v20
      els.suggestPlan.addEventListener('click', onPlanClick);            // v23: the Suggest from the report dialog
      els.suggestPlan.addEventListener('change', onPlanChange);          // v24: its condition menu
      els.suggestCancel.addEventListener('click', function () { closeModal(); });
      els.suggestGo.addEventListener('click', runExSuggest);
      // v20: the version running, at the foot of the ⋯ menu (from app.js's own ?v= in index.html)
      var appScript = document.querySelector('script[src*="app.js"]'), appV = appScript && /[?&]v=(\d+)/.exec(appScript.getAttribute('src') || '');
      if ($('menuVer')) $('menuVer').textContent = 'BASE Health Report' + (appV ? ' · version ' + appV[1] : '');
      els.save.addEventListener('click', savePdf);
      els.share.addEventListener('click', sharePdf);
      els.home.addEventListener('click', onHome);      // v16: Return home, and its check when some entries aren't saved
      els.homeKeep.addEventListener('click', function () { goHome(false); });
      els.homeClear.addEventListener('click', function () { goHome(true); });
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
