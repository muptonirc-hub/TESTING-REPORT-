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
   templates, and each handout created with a client name is saved to that client's record.
   v16: the report view has Return home: the session is already in the client's record, so it makes sure it has reached
   the clinic store, empties the page for the next client and goes back to the Screening tab (Undo for a few seconds). */
(function () {
  'use strict';
  var E = window.BHEngine;
  var CLOUD = window.BHCloud && window.BHCloud.enabled ? window.BHCloud : null;   // v13: the clinic store, or null in local mode
  var DATA = { guides: {}, guideIndex: null };         // v24: the evidence guides land here at start
  var STORE = 'bh-athlete-report-draft-v1';
  // v46: each practitioner's work in progress is their own: a staff login keeps its draft under its own key; the shared
  // clinic login (and local mode) keep the plain key as before
  function draftKey() {
    var a = CLOUD && CLOUD.account();
    return a && a.staff ? STORE + ':' + a.uid : STORE;
  }
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var state = null;
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    entry: $('entry'), summary: $('summary'), dock: $('dock'), sheet: $('sheet'), pages: $('pages'),
    sheetTitle: $('sheetTitle'), share: $('sharePdf'), save: $('savePdf'), back: $('sheetBack'), sheetEx: $('sheetEx'), sheetExBtn: $('sheetExBtn'),
    // v16: Return home in the report view, and the check it asks when some entries aren't in a client record
    home: $('homeBtn'), homeLabel: $('homeLabel'), homeDialog: $('homeDialog'), homeList: $('homeList'), homeKeep: $('homeKeep'), homeClear: $('homeClear'),
    toast: $('toast'), clearAll: $('clearAll'), clearDialog: $('clearDialog'), clearList: $('clearList'),
    checkDialog: $('checkDialog'), checkList: $('checkList'), checkBack: $('checkBack'), checkGo: $('checkGo'),   // v48
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
    photoAsk: $('photoAsk'), photoAskTitle: $('photoAskTitle'), photoAskFields: $('photoAskFields'), photoAskCancel: $('photoAskCancel'), photoAskSkip: $('photoAskSkip'), photoAskGo: $('photoAskGo'),   // v33
    // v13: the clinic store's sign-in card, status bar and dialogs
    cloudBar: $('cloudBar'), updBar: $('updBar'), signin: $('signin'), signinForm: $('signinForm'), signinEmail: $('signinEmail'), signinPassword: $('signinPassword'), signinShow: $('signinShow'),
    signinName: $('signinName'), signinBtn: $('signinBtn'), signinErr: $('signinErr'), accountTpl: $('accountTpl'),
    nameDialog: $('nameDialog'), nameBox: $('nameBox'), nameErr: $('nameErr'), nameCancel: $('nameCancel'), nameSave: $('nameSave'),
    signOutDialog: $('signOutDialog'), signOutText: $('signOutText'), signOutCancel: $('signOutCancel'), signOutConfirm: $('signOutConfirm'),
    legacyDialog: $('legacyDialog'), legacyText: $('legacyText'), legacyLater: $('legacyLater'), legacyUpload: $('legacyUpload'), legacyNever: $('legacyNever'),
    // v15: the exercise library's editor, + From library, the video player and the template dialogs
    libDialog: $('libDialog'), libPickDialog: $('libPickDialog'), videoDialog: $('videoDialog'),
    tplSaveDialog: $('tplSaveDialog'), tplPickDialog: $('tplPickDialog'), tplRenameDialog: $('tplRenameDialog'),
    // v30: the home screen, the logo that leads to it, its in-progress question and its client chooser
    homeSec: $('home'), brandHome: $('brandHome'), homeAsk: $('homeAsk'), homeAskTitle: $('homeAskTitle'), homeAskText: $('homeAskText'), homeAskActions: $('homeAskActions'),
    homeClientDialog: $('homeClientDialog'), homeClientTitle: $('homeClientTitle'), homeClientDetail: $('homeClientDetail'), homeClientList: $('homeClientList'), homeClientCancel: $('homeClientCancel')
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
    'n/a': '<path d="M3.2 6h5.6"/>',
    Guide: '<path d="M2.4 6h7.2M4.2 4.2L2.4 6l1.8 1.8M7.8 4.2L9.6 6 7.8 7.8"/>'   // v28: a two-way arrow (an emphasis, not a rating)
  };
  function statusIcon(status) {
    var p = STATUS_ICON[status];
    return p ? '<svg class="si" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>' : '';
  }
  function wordKind(t) { return t === 'ham' || t === 'acl' || t === 'ankle' ? 'rehab' : 'target'; }   // v42: + Ankle-GO
  // v36: the Custom battery is scored like the Performance screen (population norms), so most of its code is the screen's
  function SL(t) { return t === 'screen' || t === 'custom'; }
  // Screening is for athletes; LL Strength and the rehab tabs are used with patients of all kinds (v9)
  // v49 (the usability review's C2: physios, exercise physiologists and exercise scientists, and all their clients): the
  // person is the client, and an athlete only on the Performance screen or a Custom battery with a sport population chosen
  // or a sport filled in (until v48 always the athlete there, the patient everywhere else)
  function sportCtx(t) {
    var s = state && state[t];
    if (!s || (t !== 'screen' && t !== 'custom')) return false;
    return !!((s.pop && s.pop !== 'general' && s.pop !== 'none') || !blank(s.meta && s.meta.sport));
  }
  function person(t) { return sportCtx(t) ? 'athlete' : 'client'; }
  function Person(t) { return sportCtx(t) ? 'Athlete' : 'Client'; }
  // the words already on the page follow a sport typed or a population chosen (the details card, the strip, the
  // interpretation's help line) without drawing the page again
  function personWords(t) {
    if (t !== 'screen' && t !== 'custom') return;
    var P = Person(t), p = person(t), h = $('athleteH'), lab = document.querySelector('label[for="' + t + '-name"] > span'), strip = $('athleteStrip'), help = document.querySelector('#interpCard .interp-help');
    if (h && h.textContent !== P) h.textContent = P;
    if (lab && lab.textContent !== P + ' name') lab.textContent = P + ' name';
    if (strip) {
      strip.setAttribute('aria-label', P);
      var ed = strip.querySelector('.strip-edit'); if (ed) ed.setAttribute('aria-label', 'Edit ' + p + ' details');
    }
    if (help) help.textContent = 'Optional: a short summary for the ' + (sportCtx(t) ? 'athlete and coach' : 'client') + ', printed near the top of the report.';
  }
  function statusWord(status, t) { return E.statusWord(status, wordKind(t || state.tool)); }
  function chip(status, text) {                        // v28: a 'Guide' chip (the DSI) names the training emphasis, in a neutral look
    var cls = status === 'n/a' ? 'na' : status;
    return '<span class="chip ' + cls + '">' + statusIcon(status) + esc(text || statusWord(status)) + '</span>';
  }

  // ------------------------------------------------------------------ state
  var TOOLS = ['screen', 'str', 'ham', 'acl', 'ankle', 'custom'];   // the six reports (the Exercises tab, 'ex', is handled on its own); v36: + the Custom battery; v42: + Ankle-GO
  var TOOL_NAMES = { screen: 'Performance screen', str: 'LL Strength', ham: 'Hamstring rehab', acl: 'ACL rehab', ankle: 'Ankle-GO', custom: 'Custom battery', ex: 'Exercises' };   // v14: 'Screening' is the section
  function freshInterp() { return { text: '', ai: false, basis: '', reviewed: true }; }   // v48: reviewed is false only for an AI draft nobody has edited or passed yet
  // For the coach (v8): the clinician's call on training, printed as a band on the report. Never worked out by the
  // app, never filled in from records and never sent to Claude.
  var COACH_STATUS = ['Full training', 'Modified', 'Rehab only'];
  var COACH_LOOK = { 'Full training': 'Green', 'Modified': 'Amber', 'Rehab only': 'Red' };
  function freshCoach() { return { status: '', mods: '', retest: '' }; }
  // v13, cloud mode: the practitioner's name on this device (bh-athlete-report-user-v1), typed on the sign-in card. It fills
  // the Clinician box (tester on Screening and LL Strength, clinician on Hamstring, practitioner on Exercises) whenever that
  // box is empty; never a typed value. The ACL box is the surgeon's, so it is left alone.
  function userName() { return CLOUD ? CLOUD.userName() : ''; }
  var NAME_FIELDS = { screen: 'tester', str: 'tester', ham: 'clinician', ankle: 'clinician', custom: 'tester', ex: 'practitioner' };
  // cardOpen (v11): the details card is open (true) or folded into the one-line strip (false)
  function freshTool(tool, keep) {
    keep = keep || {};
    if (tool === 'screen') return { meta: { name: '', date: todayIso(), sex: '', age: '', sport: '', tester: keep.tester || userName(), mass: '', notes: '' }, pop: 'general', values: {}, radar: null, collapsed: {}, importLog: null, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
    // v36: the Custom battery: the population is chosen first (pop null until then), the tests are the battery's items
    // v37: + the injured side and the hamstring and ACL phases, for rehab tests in the battery (the client's, so never kept)
    if (tool === 'custom') return { meta: { name: '', date: todayIso(), sex: '', age: '', sport: '', tester: keep.tester || userName(), mass: '', notes: '', injured: '' }, pop: null, battery: [], batName: '', batId: '', spot: null, hamPhase: null, aclPhase: null, values: {}, radar: null, collapsed: {}, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
    if (tool === 'ham') return { meta: { name: '', date: todayIso(), injured: '', clinician: keep.clinician || userName(), doi: '', weeks: '', sport: '', notes: '' }, phase: null, values: {}, collapsed: {}, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
    if (tool === 'str') return { meta: { name: '', date: todayIso(), mass: '', sport: '', tester: keep.tester || userName(), notes: '' }, values: {}, collapsed: {}, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
    // v42: Ankle-GO: the injured side (the score is the injured leg's), the injury date or weeks since it
    if (tool === 'ankle') return { meta: { name: '', date: todayIso(), injured: '', clinician: keep.clinician || userName(), doi: '', weeks: '', sport: '', notes: '' }, values: {}, collapsed: {}, interp: freshInterp(), coach: freshCoach(), cardOpen: true };
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
      var s = JSON.parse(localStorage.getItem(draftKey()));
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
      try { localStorage.setItem(draftKey(), draftJson()); } catch (e) { /* storage unavailable */ }
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
    if (!state.custom) state.custom = freshTool('custom');   // v36: drafts from v35 and earlier
    if (!state.ankle || typeof state.ankle !== 'object' || !state.ankle.meta) state.ankle = freshTool('ankle');   // v42: drafts from v41 and earlier
    if (state.ankle.meta.injured !== 'Left' && state.ankle.meta.injured !== 'Right') state.ankle.meta.injured = '';
    var cu = state.custom;
    if (cu.pop !== null && cu.pop !== 'general' && cu.pop !== 'none' && pops.indexOf(cu.pop) < 0) cu.pop = null;   // v43: + 'none' (the clinic's targets only)
    cu.battery = tidyBattery(cu.battery);
    cu.batName = typeof cu.batName === 'string' ? cu.batName : '';
    // v43: the clinic's battery the page runs ('' : Custom on the spot) and, while one runs, the on-the-spot set-up to come back to
    cu.batId = typeof cu.batId === 'string' && BAT_ID.test(cu.batId) ? cu.batId : '';
    var sp = cu.spot;
    cu.spot = cu.batId && sp && typeof sp === 'object' && !Array.isArray(sp) ? { pop: sp.pop === 'general' || sp.pop === 'none' || pops.indexOf(sp.pop) >= 0 ? sp.pop : null, battery: tidyBattery(sp.battery), batName: typeof sp.batName === 'string' ? sp.batName : '' } : null;
    delete cu.libSnap;                                 // (only a report made again from a record has one)
    // v37: the rehab tests' phases and the injured side (drafts from v36 have none); chosen, never assumed
    if (H.phases.indexOf(cu.hamPhase) < 0) cu.hamPhase = null;
    if (A.phases.indexOf(cu.aclPhase) < 0) cu.aclPhase = null;
    if (cu.meta.injured !== 'Left' && cu.meta.injured !== 'Right') cu.meta.injured = '';
    TOOLS.forEach(function (t) {                     // drafts saved before the interpretation box existed
      var it = state[t].interp;
      if (!it || typeof it !== 'object') state[t].interp = freshInterp();
      else { it.text = String(it.text || ''); it.ai = !!it.ai; it.basis = String(it.basis || ''); it.reviewed = it.reviewed !== false; }   // v48: reviewed (edited, or Looks right) unless marked not yet
      if (state[t].hist && typeof state[t].hist !== 'object') state[t].hist = null;
      state[t].example = state[t].example === true;   // v48: Show example results filled this page: nothing on it is ever saved
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
  function screenNorm(name, pop, t) {                  // v36: t (default the Performance screen): the Custom battery's set
    if (!pop.population) return null;
    var N = setOf(t || 'screen');
    var band = (pop.ageBand && pop.ageBand !== 'All ages') ? ((((N.age_norms || {})[pop.population]) || {})[pop.ageBand] || {}) : {};
    var b = band[name];
    if (b && Object.keys(b).length) return b;
    var p = (N.populations[pop.population] || {})[name];
    return p === undefined ? null : p;
  }
  function computeScreen(t) {                          // v36: t = 'screen' (default) or 'custom'
    t = t || 'screen';
    var s = state[t], N = setOf(t);
    // v36: the Custom battery scores nothing until its population is chosen (null); the Performance screen defaults to general
    var pop = t === 'custom' && s.pop === null ? { population: null, ageBand: 'All ages', label: null, note: 'Choose the population to compare against.', level: 'warn' }
      : t === 'custom' && s.pop === 'none' ? { population: POP_NONE, ageBand: 'All ages', label: POP_NONE, note: 'Rated against the clinic\u2019s targets (no population norms).', level: 'info' }   // v43
      : E.resolvePopulation(s.pop, s.meta.sex, s.meta.age);
    var inputs = {}, perMass = {}, massNow = E.parseInput(s.meta.mass);
    // v36: a previous load or force from the client's record was scored with that day's body mass: rescaled so that
    // dividing by today's mass gives the score it had then
    if (t === 'custom') N.groups.forEach(function (g) { g.metrics.forEach(function (m) { if (/^(XBW|PCTBW|PERKG|PERBW|NPCTBW)$/.test(m.calc || '')) perMass[m.name] = 1; }); });
    Object.keys(s.values).forEach(function (name) {
      var v = s.values[name], prev = E.parseInput(v.previous), pm = perMass[name] ? E.parseInput(v.prevMass) : null;
      if (prev !== null && pm && massNow && pm > 0 && massNow > 0) prev = prev * massNow / pm;
      inputs[name] = { result: E.parseInput(v.result), previous: prev, side: v.side || '' };
    });
    // v37: the Custom battery's worked-out rows: an ACL LSI from its Left and Right boxes and the injured side; the hip ratio,
    // each leg, from that leg's adduction and abduction (the previous ratio from their previous results, as typed)
    var lsiIn = {};
    if (t === 'custom') N.groups.forEach(function (g) {
      g.metrics.forEach(function (m) {
        var v = s.values[m.name] || {};
        if (m.calc === 'LSI') lsiIn[m.name] = inputs[m.name] = { result: E.lsi(E.parseInput(v.left), E.parseInput(v.right), s.meta.injured), previous: E.parseInput(v.previous), side: '' };
        else if (m.calc === 'RATIO') {
          var a = s.values[m.from[0]] || {}, b = s.values[m.from[1]] || {};
          var ra = E.parseInput(a.result), rb = E.parseInput(b.result), pa = E.parseInput(a.previous), pb = E.parseInput(b.previous);
          inputs[m.name] = { result: ra && rb ? E.pyRound(ra / rb, 2) : null, previous: pa && pb ? E.pyRound(pa / pb, 2) : null, side: '' };
        }
      });
    });
    var groups = pop.population ? E.buildRows(inputs, pop.population, N, pop.ageBand, massNow) : [];
    var byName = {};
    E.flatten(groups).forEach(function (r) { byName[r.name] = r; });
    var opts = E.radarOptions(groups);
    var keys = opts.map(function (o) { return o[0]; });
    var picked = (s.radar || E.radarDefault(opts)).filter(function (k) { return keys.indexOf(k) >= 0; }).slice(0, 6);
    return { pop: pop, groups: groups, byName: byName, counts: E.counts(groups), prios: E.priorities(groups), radarOptions: opts, radarPicked: picked, lsiIn: lsiIn };
  }
  function rehabKey(tool) {                            // v18: '' until the phase (and for ACL the norm set) is chosen
    var s = state[tool];
    if (!s.phase || (tool === 'acl' && !s.sex)) return '';
    return tool === 'acl' ? s.phase + '|' + s.sex : s.phase;
  }
  // v18: what still has to be chosen before a rehab tool can score anything ('' when nothing)
  function rehabNeed(t) {
    if (t === 'ankle') return state.ankle.meta.injured ? '' : 'Choose the injured side';   // v42: the score is the injured leg's
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
    if (SL(t)) return computeScreen(t);
    if (t === 'str') return computeStrength();
    if (t === 'ankle') return computeAnkle();          // v42
    return computeRehab(t);
  }

  // ------------------------------------------------------------------ v36: the Custom battery
  // Matthew (5 Oct): "a CUSTOM option - this is where we can quickly build a custom screening battery. It would also need to
  // link with the photo mode where the practitioner can write down what they have done - take a pic - then like the exercise
  // builder it links to the tests and norms that are available (it would ask the practitioner to select the population
  // before beginning)." A battery is a list of items: { k: 'screen', key } (a Performance screen metric), { k: 'str', id }
  // (an LL Strength test, each leg scored against its body-weight target) or { k: 'own', id, name, unit, dir, green, amber }
  // (one of the clinic's own tests, rated only when a target is typed). customSet() turns the battery into a norms set in the
  // Performance screen's shape, so E.buildRows, the rows, the summary, the report, the records and the AI work as they do
  // there. setOf(t) is the norms set any report tool scores against.
  var OWN_ID = /^o-[a-z0-9]{1,40}$/;
  var STR_CALC = { xBW: 'XBW', pctBW: 'PCTBW', Nkg: 'PERKG', xBWf: 'PERBW' };
  var STR_UNIT = { xBW: '× BW', xBWf: '× BW', pctBW: '% BW', Nkg: 'N/kg', reps: 'reps' };
  var STR_GROUP = 'LOWER-LIMB STRENGTH & CAPACITY', OWN_GROUP = 'THE CLINIC\u2019S OWN TESTS';
  var customMemo = null;                                // the set for the battery as last built (keyed by its JSON)
  function setOf(t) { return t === 'custom' ? customSet() : DATA[t]; }
  function screenMetric(key) {                         // a Performance screen metric by name (never the DSI, which is worked out)
    var hit = null;
    DATA.screen.groups.forEach(function (g) { g.metrics.forEach(function (m) { if (!hit && m.calc !== 'DSI' && m.name === key) hit = m; }); });
    return hit;
  }
  function strTest(id) {                               // an LL Strength test by id (never the hip ratio, which is worked out)
    var hit = null;
    DATA.str.tests.forEach(function (tt) { if (!hit && tt.input !== 'calc' && tt.id === id) hit = tt; });
    return hit;
  }
  // v37: the hip adduction : abduction ratio can be in a battery: worked out for each leg from the two hip tests, which come with it
  var RATIO_ID = 'hip_add_abd_ratio';
  function ratioTest() {
    var hit = null;
    DATA.str.tests.forEach(function (tt) { if (!hit && tt.id === RATIO_ID && tt.input === 'calc' && Array.isArray(tt.from) && tt.from.length === 2 && strTest(tt.from[0]) && strTest(tt.from[1])) hit = tt; });
    return hit;
  }
  // v37: the Hamstring and ACL rehab tests can be in a battery: { k: 'ham' | 'acl', key: the metric's name }, each scored against
  // the typical case at the phase chosen on the page (the ACL norms also by sex)
  var REHAB_TOOLS = ['ham', 'acl'], REHAB_GROUP = { ham: 'HAMSTRING REHAB', acl: 'ACL REHAB' }, REHAB_LABEL = { ham: 'Hamstring rehab', acl: 'ACL rehab' };
  function rehabMetric(tool, name) {
    var hit = null;
    if (REHAB_TOOLS.indexOf(tool) < 0 || typeof name !== 'string') return null;
    DATA[tool].groups.forEach(function (g) { g.metrics.forEach(function (m) { if (!hit && m.name === name) hit = m; }); });
    return hit;
  }
  function rehabIn(b) {                                // which rehab tools a battery has tests from: { ham: true, acl: true }
    var has = {};
    (b || state.custom.battery).forEach(function (it) { if (it.k === 'ham' || it.k === 'acl') has[it.k] = true; });
    return has;
  }
  function rehabKeyFor(tool) {                         // the norms set the battery's rehab tests use ('' until chosen)
    var s = state.custom, ph = tool === 'ham' ? s.hamPhase : s.aclPhase;
    if (!ph) return '';
    if (tool === 'acl') return DATA.acl.sexes.indexOf(s.meta.sex) >= 0 ? ph + '|' + s.meta.sex : '';
    return ph;
  }
  function andList(a) { return a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : (a[0] || ''); }
  // what the battery's rehab tests still need before they can be scored ('' when nothing, or there are none)
  function customRehabNeed() {
    var s = state.custom, has = rehabIn(), need = [], sexNeed = s.pop !== 'general' ? customSexNeed() : '';   // v43: + a builder test's targets by sex
    if (!has.ham && !has.acl && !sexNeed) return '';
    if ((has.ham || has.acl) && !s.meta.injured) need.push('the injured side');
    if (has.ham && !s.hamPhase) need.push('the hamstring phase');
    if (has.acl && !s.aclPhase) need.push('the ACL phase');
    if (has.acl && DATA.acl.sexes.indexOf(s.meta.sex) < 0) need.push('Male or Female (the ACL norms are by sex)');
    else if (sexNeed) need.push(sexNeed);
    return need.length ? 'Choose ' + andList(need) : '';
  }
  // the rehab context for the report, the strip and Claude (null without rehab tests)
  function customRehabInfo() {
    var s = state.custom, has = rehabIn();
    if (!has.ham && !has.acl) return null;
    var notes = [];
    if (has.ham && DATA.ham.disclaimer) notes.push(clean1(DATA.ham.disclaimer));
    if (has.acl && DATA.acl.disclaimer) notes.push(clean1(DATA.acl.disclaimer));
    return { injured: s.meta.injured || '', ham: has.ham ? s.hamPhase || '' : null, acl: has.acl ? (s.aclPhase ? s.aclPhase + (DATA.acl.sexes.indexOf(s.meta.sex) >= 0 ? ' (' + s.meta.sex.toLowerCase() + ' norms)' : '') : '') : null, notes: notes };
  }
  function strSideName(tt, side) { return tt.name + ' \u2014 ' + side; }
  // v38: the Custom battery's categories (Matthew, 5 Oct: "I don't like how we list the battery exercises. They are simply
  // categories based on pre existing batteries. They need to be put in new categories. For example. ISOMETRIC, FUNCTIONAL -
  // then into region, e.g. lower limb, upper limb etc."; his choices: the detailed types, the same categories on the page and
  // in the report, and a type and region for the clinic's own tests). The type first, then the body region; in a category
  // the tests run in CAT_DEF's order (hip, knee, then ankle; the Performance screen's, LL Strength's, then the rehab tools').
  // A test missing here (a metric added to a norms file later) goes under Other tests.
  var CAT_TYPES = [['iso', 'Isometric strength'], ['ecc', 'Eccentric strength'], ['isok', 'Isokinetic strength'], ['dyn', 'Dynamic strength (RM)'],
    ['jump', 'Jump & power'], ['react', 'Reactive'], ['hop', 'Hop & functional'], ['speed', 'Speed & agility'], ['rom', 'Range of motion'],
    ['bal', 'Balance'], ['pro', 'Questionnaires & clinical']];
  var CAT_REGIONS = [['ll', 'Lower limb'], ['ul', 'Upper limb'], ['trunk', 'Trunk'], ['wb', 'Whole body']];
  var CAT_DEF = [
    ["iso", "ll", ["screen|Adductor Peak Force", "screen|Abductor Peak Force", "screen|Adduction Asymmetry", "screen|Add : Abd Ratio", "str|hip_abduction", "str|hip_adduction", "str|hip_add_abd_ratio", "screen|Quad ISO @ 60\u00b0 \u2014 Left", "screen|Quad ISO @ 60\u00b0 \u2014 Right", "str|sl_knee_extension", "str|prone_hamstring_curl", "ham|HHD 90\u00b0 knee-flex force \u2014 injured", "ham|HHD 90\u00b0 knee-flex % of uninjured", "ham|HHD 15\u00b0 knee-flex force \u2014 injured", "ham|HHD 45\u00b0 force \u2014 injured", "acl|Knee extension torque \u2014 injured", "acl|Knee flexion torque \u2014 injured", "acl|Knee extension LSI", "acl|Knee flexion LSI", "acl|Quadriceps LSI", "acl|Hamstring LSI", "acl|Quadriceps strength index (90\u00b0 ISO)", "str|sl_seated_calf_vald"]],
    ["iso", "wb", ["screen|IMTP Peak Force", "screen|IMTP Relative Force", "screen|IMTP RFD 0\u2013200 ms"]],
    ["iso", "", ["screen|Isometric Peak Force"]],
    ["ecc", "ll", ["screen|Nordic Peak Force \u2014 Left", "screen|Nordic Peak Force \u2014 Right", "screen|Nordic L/R Imbalance", "screen|Nordic Relative Force", "ham|Nordic peak force \u2014 injured", "ham|Nordic peak-force imbalance"]],
    ["isok", "ll", ["ham|Knee-flexor ECC peak torque @60\u00b0/s \u2014 injured", "ham|Knee-flexor CONC peak torque @60\u00b0/s diff %"]],
    ["dyn", "ll", ["str|sl_bridge", "str|split_squat", "str|sl_seated_calf_smith", "str|sl_calf_raise_reps", "str|sl_calf_raise_loaded"]],
    ["jump", "ll", ["screen|Jump Height", "screen|Peak Power", "screen|CMJ Peak Force", "screen|RSI-modified", "screen|Concentric Asymmetry", "screen|Landing Asymmetry", "screen|DSI (CMJ \u00f7 IMTP)", "acl|CMJ \u2014 Jump height", "acl|CMJ \u2014 Peak power", "acl|CMJ \u2014 Concentric impulse", "acl|CMJ \u2014 Concentric peak force", "acl|CMJ \u2014 Eccentric impulse", "acl|CMJ \u2014 Take-off impulse", "acl|SJ \u2014 P1 concentric impulse", "acl|SJ \u2014 P2 concentric impulse", "acl|SJ \u2014 Peak power", "acl|SLCMJ \u2014 Jump height (injured)", "acl|SLCMJ \u2014 Power/BW (injured)"]],
    ["react", "ll", ["screen|Hop RSI (best)", "screen|Hop Contact Time", "screen|Hop Jump Height", "screen|Reactive Asymmetry", "acl|SL Drop Jump 15cm \u2014 RSI (injured)", "acl|SL Drop Jump 15cm \u2014 Jump height (injured)", "acl|SL Drop Jump 15cm \u2014 Ground contact time (injured)"]],
    ["hop", "ll", ["acl|Single hop LSI", "acl|Triple hop LSI", "acl|Crossover hop LSI", "acl|6 m timed hop LSI", "acl|Single-leg hop for distance (injured)", "acl|Side hop (injured)"]],
    ["speed", "wb", ["screen|10 m sprint", "screen|20 m sprint", "screen|30 m sprint", "screen|5-10-5 (pro-agility)", "ham|5 m sprint time", "ham|10 m sprint time"]],
    ["rom", "ll", ["ham|SLR % of uninjured side", "ham|MHFAKE % of uninjured side", "ham|AKET deficit vs uninjured", "ham|PKET deficit vs uninjured"]],
    ["bal", "ll", ["acl|SEBT anterior reach composite (injured)"]],
    ["pro", "ll", ["acl|IKDC", "acl|KOOS \u2014 ADL", "acl|KOOS \u2014 Pain", "acl|KOOS \u2014 QOL", "acl|KOOS \u2014 Sport & Rec", "acl|KOOS \u2014 Symptoms", "acl|ACL-RSI", "acl|Cincinnati Knee Score", "acl|GRS Perceived Function", "acl|Pedi-IKDC", "ham|HaOS score", "ham|Pain on palpation \u2014 length"]]
  ];
  var catIndex = null;
  function catOf(key) {                                // { type, region, ord } for a catalogue key ('screen|…', 'str|…', 'ham|…', 'acl|…')
    if (!catIndex) {
      catIndex = {};
      var o = 0;
      CAT_DEF.forEach(function (d) { d[2].forEach(function (k) { catIndex[k] = { type: d[0], region: d[1], ord: ++o }; }); });
    }
    return catIndex[key] || { type: '', region: '', ord: 90000 };
  }
  function catKeyIndex(list, k) { for (var i = 0; i < list.length; i++) if (list[i][0] === k) return i; return -1; }
  function catTypeLabel(t) { var i = catKeyIndex(CAT_TYPES, t); return i < 0 ? '' : CAT_TYPES[i][1]; }
  function catRegionLabel(r) { var i = catKeyIndex(CAT_REGIONS, r); return i < 0 ? '' : CAT_REGIONS[i][1]; }
  function catLabel(type, region) { return (catTypeLabel(type) || 'Other tests') + (catRegionLabel(region) ? ' \u00b7 ' + catRegionLabel(region) : ''); }
  function catTitle(type, region) { return catLabel(type, region).toUpperCase(); }   // the section's name in the norms set, the PDF and for Claude
  function catRank(type, region) {                     // the categories' order: by type, then region (Other tests and no region last)
    var ti = catKeyIndex(CAT_TYPES, type), ri = catKeyIndex(CAT_REGIONS, region);
    return (ti < 0 ? 99 : ti) * 10 + (ri < 0 ? 9 : ri);
  }
  function ownNum(v) { var n = E.parseInput(v == null ? '' : String(v)); return n === null ? null : n; }
  function tidyOwn(o) {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !OWN_ID.test(o.id)) return null;
    var name = cap(o.name, 80);
    if (!name) return null;
    var green = ownNum(o.green), amber = ownNum(o.amber), dir = o.dir === 'Lower' ? 'Lower' : 'Higher';
    if (green === null) amber = null;
    if (amber !== null && (dir === 'Higher' ? amber > green : amber < green)) amber = green;   // Close can't sit beyond the target
    var out = { k: 'own', id: o.id, name: name, unit: cap(o.unit, 12), dir: dir, green: green, amber: amber };
    if (catKeyIndex(CAT_TYPES, o.type) >= 0) out.type = o.type;             // v38: its category (none: Other tests)
    if (catKeyIndex(CAT_REGIONS, o.region) >= 0) out.region = o.region;
    return out;
  }
  // a battery as stored or shipped: known items only, each once; an own test may not take a catalogue test's name
  function tidyBattery(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var key;
      if (it.k === 'screen') { if (!screenMetric(it.key)) return; key = 'screen|' + it.key; it = { k: 'screen', key: it.key }; }
      else if (it.k === 'str') { if (!strTest(it.id) && !(it.id === RATIO_ID && ratioTest())) return; key = 'str|' + it.id; it = { k: 'str', id: it.id }; }
      else if (it.k === 'ham' || it.k === 'acl') { if (!rehabMetric(it.k, it.key)) return; key = it.k + '|' + it.key; it = { k: it.k, key: it.key }; }   // v37
      else if (it.k === 'lib') { if (typeof it.id !== 'string' || !TEST_ID.test(it.id)) return; key = 'lib|' + it.id; it = { k: 'lib', id: it.id }; }   // v43: one of the clinic's tests (kept while not synced yet)
      else if (it.k === 'own') {
        it = tidyOwn(it);
        if (!it) return;
        // an own test may not take a catalogue test's name: it becomes that test (v37: so an own test saved in v36 under a
        // name the catalogue has since gained, e.g. IKDC, is kept as the catalogue's, its results under the same name)
        var hit = catalogueByName(it.name);
        it = !hit ? it : hit.k === 'screen' ? { k: 'screen', key: hit.name } : hit.k === 'str' ? { k: 'str', id: hit.def.id } : hit.k === 'lib' ? { k: 'lib', id: hit.def.id } : { k: hit.k, key: hit.name };   // v43: or one of the clinic's tests
        key = batteryKey(it);
      }
      else return;
      if (seen[key]) return;
      seen[key] = 1;
      out.push(it);
    });
    // v37: the hip ratio brings the two hip tests it is worked out from (just before it) when they aren't there
    var ri = -1;
    out.forEach(function (it, i) { if (it.k === 'str' && it.id === RATIO_ID) ri = i; });
    if (ri >= 0) {
      var need = ratioTest().from.filter(function (id) { return !seen['str|' + id]; }).map(function (id) { return { k: 'str', id: id }; });
      if (need.length) out.splice.apply(out, [ri, 0].concat(need));
    }
    return out;
  }
  function batteryKey(it) { return it.k === 'screen' ? 'screen|' + it.key : it.k === 'str' ? 'str|' + it.id : (it.k === 'ham' || it.k === 'acl') ? it.k + '|' + it.key : it.k === 'lib' ? 'lib|' + it.id : 'own|' + it.id; }
  function batteryHas(key) { return state.custom.battery.some(function (it) { return batteryKey(it) === key; }); }
  // the tests a battery can hold, in the order the Choose tests list shows them (v38: by category, type then region); each
  // { key, k, name, unit, group (the category's title), glabel (its name on screen), type, region, rank, ord, def }
  var catMemo = null;
  function catalogue() {
    var lt = ltAll();                                  // v43: + the clinic's own tests (the battery builder's)
    if (catMemo && catMemo.screen === DATA.screen && catMemo.str === DATA.str && catMemo.ham === DATA.ham && catMemo.acl === DATA.acl && catMemo.lt === lt) return catMemo.list;
    var out = [];
    DATA.screen.groups.forEach(function (g) {
      g.metrics.forEach(function (m) { if (m.calc !== 'DSI') out.push({ key: 'screen|' + m.name, k: 'screen', name: m.name, unit: m.unit, group: g.title, def: m }); });
    });
    DATA.str.tests.forEach(function (tt) {
      if (tt.input !== 'calc') out.push({ key: 'str|' + tt.id, k: 'str', name: tt.name, unit: INPUT_WORD[tt.input], group: STR_GROUP, def: tt, detail: tt.detail || '' });
      else if (tt.id === RATIO_ID && ratioTest()) out.push({ key: 'str|' + tt.id, k: 'str', name: tt.name, unit: 'ratio', group: STR_GROUP, def: tt, detail: '', ratio: true });   // v37
    });
    REHAB_TOOLS.forEach(function (rt) {                // v37: the Hamstring and ACL rehab tests, by their device groups
      DATA[rt].groups.forEach(function (g) {
        var label = REHAB_LABEL[rt] + ' \u00b7 ' + groupTitle(g.title).replace(/\s*\([^)]*\)/g, '');   // the device in brackets left out (the line stays short)
        g.metrics.forEach(function (m) { out.push({ key: rt + '|' + m.name, k: rt, name: m.name, unit: m.unit, group: REHAB_GROUP[rt] + ' \u2014 ' + g.title, glabel: label, def: m }); });
      });
    });
    lt.list.forEach(function (tt) { out.push({ key: 'lib|' + tt.id, k: 'lib', name: tt.name, unit: ltUnit(tt), def: tt }); });
    out.forEach(function (c, i) {                      // v38: each test's category
      var cat = c.k === 'lib' ? { type: c.def.type || '', region: c.def.region || '', ord: 150000 } : catOf(c.key);   // v43: a clinic test's own, after the app's
      c.type = cat.type; c.region = cat.region; c.ord = cat.ord + i / 1000; c.rank = catRank(cat.type, cat.region);
      c.group = catTitle(cat.type, cat.region); c.glabel = catLabel(cat.type, cat.region);
    });
    out.sort(function (a, b) { return a.rank - b.rank || a.ord - b.ord; });
    catMemo = { screen: DATA.screen, str: DATA.str, ham: DATA.ham, acl: DATA.acl, lt: lt, list: out };
    return out;
  }
  // a catalogue test (or an LL Strength test's side) with this name, matched ignoring case and spaces; failing that, the
  // name without its bracketed detail ('Split squat' for 'Split squat (rear leg)') when only one test has it
  function catalogueByName(name) {
    var k = E.libKey(name), hit = null, loose = [];
    if (!k) return null;
    function bare(s) { return E.libKey(String(s).replace(/\s*\([^)]*\)/g, ' ')); }
    var kb = bare(name);
    catalogue().forEach(function (c) {
      if (hit) return;
      if (E.libKey(c.name) === k) hit = c;
      else if ((c.k === 'str' || (c.k === 'lib' && c.def.legs)) && (E.libKey(strSideName(c.def, 'Left')) === k || E.libKey(strSideName(c.def, 'Right')) === k)) hit = c;   // v43: + a clinic test's leg
      else if (kb && (bare(c.name) === kb || ((c.k === 'str' || (c.k === 'lib' && c.def.legs)) && (bare(strSideName(c.def, 'Left')) === kb || bare(strSideName(c.def, 'Right')) === kb)))) loose.push(c);
    });
    return hit || (loose.length === 1 ? loose[0] : null);
  }
  // the battery's items as a norms set: the Performance screen's metrics in the battery (the DSI once both its forces are
  // in), the LL Strength tests (a metric per leg, scored like the screen's force-per-mass metrics, the target as the clinic
  // writes it, Close within amber_pct of it), the rehab tests (the phase's targets) and the clinic's own tests; the screen's
  // populations and age bands. v38: in sections by category (type, then region), as Choose tests lists them.
  function customSet() {
    var s = state && state.custom, b = s ? s.battery : [];
    // v37: the rehab tests' targets follow the phases chosen (and the ACL norms the sex)
    // v43: and the clinic's tests in it (as they are now, or as a record kept them) with the Close %
    var libs = b.filter(function (it) { return it.k === 'lib'; }).map(function (it) { return ltFor(it.id); }), pctNow = closePct();
    var sig = JSON.stringify([b, s ? s.hamPhase || '' : '', s ? s.aclPhase || '' : '', s ? s.meta.sex || '' : '', libs, pctNow]);
    if (customMemo && customMemo.sig === sig) return customMemo.set;
    var keys = {}, strIds = [], own = [], reh = { ham: {}, acl: {} };
    b.forEach(function (it) { if (it.k === 'screen') keys[it.key] = 1; else if (it.k === 'str') strIds.push(it.id); else if (it.k === 'ham' || it.k === 'acl') reh[it.k][it.key] = 1; else if (it.k === 'own') own.push(it); });
    var items = [];                                    // v38: { m: the metric, type, region, ord }, sorted into the categories below
    function put(m, key, sub) { var c = catOf(key); items.push({ m: m, type: c.type, region: c.region, ord: c.ord + (sub || 0) }); }
    DATA.screen.groups.forEach(function (g) {
      g.metrics.forEach(function (m) { if (m.calc === 'DSI' ? !!(keys['CMJ Peak Force'] && keys['IMTP Peak Force']) : !!keys[m.name]) put(m, 'screen|' + m.name); });
    });
    var strMetrics = { push: function (m) { put(m, 'str|' + (m.str || m.ratio), m.side === 'Right' ? 0.2 : 0.1); } }, extra = {}, pct = DATA.str.amber_pct == null ? 5 : DATA.str.amber_pct;
    strIds.forEach(function (id) {
      if (id === RATIO_ID) {                           // v37: the hip ratio, each leg worked out from that leg's two hip tests
        var rt = ratioTest();
        if (!rt) return;
        var rn = E.strengthNorm(rt, pct);
        rn.label = rt.target_text || ''; rn.source = '\u2605\u2605\u2606 Clinic target (LL Strength) \u00b7 adduction \u00f7 abduction, each leg';
        ['Left', 'Right'].forEach(function (side) {
          var name = strSideName(rt, side);
          strMetrics.push({ name: name, unit: 'ratio', calc: 'RATIO', dir: 'Band', thr: 0.05, range: null, jump: false, xkey: rt.id, ratio: rt.id, side: side,
            from: [strSideName(strTest(rt.from[0]), side), strSideName(strTest(rt.from[1]), side)] });
          extra[name] = rn;
        });
        return;
      }
      var tt = strTest(id);
      if (!tt) return;
      var norm = E.strengthNorm(tt, pct);
      norm.label = tt.target_text || ''; norm.source = '\u2605\u2605\u2606 Clinic target (LL Strength) \u00b7 relative to body weight';
      ['Left', 'Right'].forEach(function (side) {
        var name = strSideName(tt, side);
        strMetrics.push({ name: name, unit: STR_UNIT[tt.score] || '', calc: STR_CALC[tt.score] || null, dir: 'Higher', thr: tt.green ? tt.green * 0.05 : null,
          range: tt.range || null, xkey: tt.id, input: tt.input, detail: tt.detail || '', str: id, side: side });
        extra[name] = norm;
      });
    });
    REHAB_TOOLS.forEach(function (rt) {                // v37: the rehab tests, against the phase's targets
      var pn = s ? (DATA[rt].norms || {})[rehabKeyFor(rt)] || {} : {};
      DATA[rt].groups.forEach(function (g) {
        g.metrics.forEach(function (m) {
          if (!reh[rt][m.name]) return;
          put(Object.assign({}, m, { rehab: rt }), rt + '|' + m.name);
          if (pn[m.name]) extra[m.name] = pn[m.name];
        });
      });
    });
    libs.forEach(function (tt, i) {                    // v43: the battery builder's tests: a metric each (each leg), the clinic's target, Close from its %
      if (!tt) return;                                 // (not synced to this device yet, or deleted since)
      var norm = ltNorm(tt, s ? s.meta.sex : '', ltPct(tt));
      var base = { unit: ltUnit(tt), calc: ltCalc(tt), dir: tt.dir, thr: norm && norm.green ? Math.abs(norm.green) * 0.05 : null, range: null, lib: tt.id, xkey: tt.id, input: tt.unit };
      (tt.legs ? ['Left', 'Right'] : ['']).forEach(function (side, j) {
        var name = side ? ltSideName(tt, side) : tt.name;
        items.push({ m: Object.assign({ name: name, side: side }, base), type: tt.type || '', region: tt.region || '', ord: 150000 + i + j * 0.1 });
        if (norm) extra[name] = norm;
      });
    });
    own.forEach(function (o, i) {                      // the clinic's own tests, in their own category (v38; none: Other tests)
      items.push({ m: { name: o.name, unit: o.unit, calc: null, dir: o.dir, thr: null, range: null, own: o.id, xkey: o.id }, type: o.type || '', region: o.region || '', ord: 100000 + i });
      if (o.green !== null) extra[o.name] = { dir: o.dir, green: o.green, amber: o.amber === null ? o.green : o.amber, source: '\u2605\u2606\u2606 Clinic target, typed with the test' };
    });
    items.sort(function (a, b) { return catRank(a.type, a.region) - catRank(b.type, b.region) || a.ord - b.ord; });
    var groups = [], byTitle = {};
    items.forEach(function (it) {
      var t = catTitle(it.type, it.region);
      if (!byTitle[t]) { byTitle[t] = { title: t, metrics: [] }; groups.push(byTitle[t]); }
      byTitle[t].metrics.push(it.m);
    });
    var pops = {}, N = DATA.screen;
    Object.keys(N.populations || {}).forEach(function (p) { pops[p] = Object.assign({}, N.populations[p], extra); });
    pops[POP_NONE] = Object.assign({}, extra);         // v43: the clinic's targets only (no population norms)
    var set = { population_order: N.population_order, groups: groups, populations: pops, age_bands: N.age_bands, age_norms: N.age_norms };
    customMemo = { sig: sig, set: set };
    return set;
  }
  function explainKey(t, name) {                       // the explainer key for a row: an LL Strength test's id inside a custom battery, else the metric's name
    var hit = name;
    if (t === 'custom') customSet().groups.forEach(function (g) { g.metrics.forEach(function (m) { if (m.name === name && m.xkey) hit = m.xkey; }); });
    return hit;
  }
  function batteryCount() { return state.custom.battery.length; }   // tests (a strength test counts once, though it draws a row per leg)

  // ------------------------------------------------------------------ rendering: entry column
  var HEAD = {
    screen: ['Performance & readiness screen', 'Leave a metric blank to skip it; add the previous result to see real change.'],
    str: ['Lower-limb strength & capacity', 'Enter each leg\u2019s load, force or reps. Blank tests are left out.'],
    ham: ['Hamstring rehab & return to play', 'Injured-limb results against the targets for the chosen phase.'],
    acl: ['ACL rehab & return to play', 'Injured-limb and symmetry results against ACLR norms for the chosen phase and sex.'],
    ankle: ['Ankle-GO return-to-sport score', 'Lateral ankle sprain (no surgery): four tests and three questionnaires, scored out of 25 on the injured leg.'],   // v42
    custom: ['Custom screening battery', 'Choose the population, then pick the tests or photograph your notes. Results are scored against the norms available.'],   // v36
    ex: ['Program builder', 'Add exercises from the library, type them, or scan a handwritten page (no client name on it).']
  };
  // v15: the Exercises tab's three pages, chosen from its heading (the same picker as Screening's tools)
  var EX_PAGES = ['builder', 'library', 'templates'];
  var EX_PAGE_TITLE = { builder: 'Program builder', library: 'Exercise library', templates: 'Program templates' };
  function exPageBlurb(p) {
    if (p === 'builder') return 'Build a client’s program from the library, by typing, or from a photo of a handwritten page.';
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
    'HAMSTRING REHAB': 'Hamstring rehab', 'ACL REHAB': 'ACL rehab',   // v37: the Custom battery's rehab sections
    'STAR EXCURSION BALANCE TEST (mSEBT)': 'Star excursion balance test (mSEBT)',   // v42: Ankle-GO
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
  // v38: the Custom battery's categories as they read on screen ('ISOMETRIC STRENGTH · LOWER LIMB' -> 'Isometric strength · Lower limb')
  [['', '']].concat(CAT_TYPES).forEach(function (ty) { [['', '']].concat(CAT_REGIONS).forEach(function (re) { GROUP_TITLES[catTitle(ty[0], re[0])] = catLabel(ty[0], re[0]); }); });
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
  // v48 word list: one name for reading a photo on every page, "Scan photo" (until v47 Import results / Scan notes / Scan
  // exercise page); on the Performance screen the menu's first item says what the photo can be
  function scanLabel(t) { return t === 'screen' ? 'Photo of notes or a VALD screenshot' : 'Scan photo'; }
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
  var IMPORT_LABEL = 'Scan<span class="il-more"> photo</span>';   // v18: just Scan on a phone, so it shares a row with Choose client; v48: was Import results
  function cardHead(t, h2id) {
    var open = state[t].cardOpen !== false;
    var out = '<div class="card-head"><h2 id="' + h2id + '">' + (t === 'ex' ? 'Client' : Person(t)) + '</h2><div class="head-actions">';   // v49: Client (was Patient)
    out += '<button type="button" class="ghost choose-btn" data-action="choose-client" aria-haspopup="dialog">' + PEOPLE + 'Choose client</button>';   // v15: Exercises too
    if (t === 'screen') {
      // v18: one Import results menu: a photo of notes (or a VALD app screenshot), or a VALD CSV export. Each item is a
      // label with its file input laid over it, so a tap lands on the input itself (as the buttons did)
      out += '<div class="import-wrap"><button type="button" class="ghost import-btn" id="importBtn" data-action="import-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="importMenu">' +
        CAMERA + '<span data-label>' + IMPORT_LABEL + '</span><span class="chev-s" aria-hidden="true"></span></button>' +
        '<div class="menu import-menu" id="importMenu" role="menu" aria-label="Scan photo or import a file" hidden>' +
        '<label class="menu-item file-btn scan-btn" id="scanBtn" for="scanFiles" role="menuitem">' + CAMERA + '<span data-label>' + scanLabel(t) + '</span>' + (open ? scanInputHtml(t) : '') + '</label>' +
        '<label class="menu-item file-btn" for="valdFiles" role="menuitem">' + DOC_ICON + '<span>VALD CSV export</span><input id="valdFiles" type="file" accept=".csv,text/csv" multiple></label>' +
        '</div></div>';
    } else {
      out += '<label class="ghost file-btn scan-btn" id="scanBtn" for="scanFiles">' + CAMERA + '<span data-label>' + scanLabel(t) + '</span>' +
        (open ? scanInputHtml(t) : '') + '</label>';
    }
    // Done last on the right (on a phone, beside the title)
    return out + '</div><button type="button" class="ghost done-btn" id="athleteDone" data-action="done-athlete"' + (essentials(t) ? '' : ' disabled') + '>Hide<span class="il-more"> details</span></button></div>';   // v48: was Done (read as "finished")
  }
  function athleteCard() {
    var t = state.tool, s = state[t];
    var out = '<section class="card athlete" id="athleteCard" tabindex="-1" aria-labelledby="athleteH"' + (s.cardOpen === false ? ' hidden' : '') + '>' + cardHead(t, 'athleteH');
    out += '<div class="fields">';
    if (t === 'screen') {
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'sex', 'Sex', ['Female', 'Male']) +   // v48: Female | Male on every page (ACL's order)
        field(t, 'age', 'Age (years)', { mode: 'decimal' }) + field(t, 'mass', 'Mass (kg)', { mode: 'decimal' }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'tester', 'Clinician', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'full' });
      var pops = [['general', 'General population (auto by age & sex)']].concat(E.sportPopulations(DATA.screen).map(function (p) { return [p, p]; }));
      out += select('screen-pop', 'Compare against', pops, s.pop, 'data-choice="pop"', 'wide');
    } else if (t === 'custom') {                       // v36: the screen's details; the population was chosen first (changeable here)
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'sex', 'Sex', ['Female', 'Male']) +   // v48: Female | Male on every page (ACL's order)
        field(t, 'age', 'Age (years)', { mode: 'decimal' }) + field(t, 'mass', 'Mass (kg)', { mode: 'decimal' }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'tester', 'Clinician', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'full' });
      var cpops = [['general', 'General population (auto by age & sex)']].concat(E.sportPopulations(DATA.screen).map(function (p) { return [p, p]; }), [['none', 'The clinic\u2019s targets only']]);   // v43: + none (no population norms)
      out += select('custom-pop', 'Compare against', cpops, s.pop || 'general', 'data-choice="pop"', 'wide');
      var rh = rehabIn();                              // v37: what the battery's rehab tests are scored against
      if (rh.ham || rh.acl) out += seg(t, 'injured', 'Injured side', ['Left', 'Right']);
      if (rh.ham) out += select('custom-hamPhase', 'Hamstring rehab phase', [['', 'Choose the phase\u2026']].concat(DATA.ham.phases.map(function (p) { return [p, p]; })), s.hamPhase || '', 'data-choice="hamPhase"', 'wide');
      if (rh.acl) out += select('custom-aclPhase', 'ACL rehab phase', [['', 'Choose the phase\u2026']].concat(DATA.acl.phases.map(function (p) { return [p, p]; })), s.aclPhase || '', 'data-choice="aclPhase"', 'wide');
    } else if (t === 'str') {
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        field(t, 'mass', 'Body mass (kg)', { mode: 'decimal' }) +
        field(t, 'sport', 'Sport', { words: true }) + field(t, 'tester', 'Clinician', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'wide' });
    } else if (t === 'ankle') {                        // v42: Ankle-GO: no phase to choose, the score has its own cut-offs
      out += field(t, 'name', Person(t) + ' name', { cls: 'wide', words: true }) + field(t, 'date', 'Test date', { type: 'date' }) +
        seg(t, 'injured', 'Injured side', ['Left', 'Right']) +
        field(t, 'doi', 'Date of injury', { type: 'date' }) + field(t, 'weeks', 'Weeks since injury', { mode: 'decimal' }) +
        field(t, 'clinician', 'Clinician', { words: true }) + field(t, 'sport', 'Sport', { words: true }) +
        field(t, 'notes', 'Notes', { cls: 'full' });
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
    if (t === 'custom') return state.custom.pop !== null && (state.custom.pop !== 'general' || !!m.sex) && !customRehabNeed();   // v36: the population, and sex for the general norms; v37: what rehab tests need
    if (t === 'str') return !blank(m.mass);
    if (t === 'ham' || t === 'acl' || t === 'ankle') return !!m.injured && !rehabNeed(t);   // v18: and the phase (and norm set) chosen; v42: Ankle-GO the injured side
    return true;
  }
  function stripHtml(t) {
    var open = state[t].cardOpen !== false;
    return '<div class="strip" id="athleteStrip" role="group" aria-label="' + Person(t) + '"' + (open ? ' hidden' : '') + '>' +
      '<div class="strip-text" id="stripText"></div>' +
      '<label class="strip-scan file-btn scan-btn" id="stripScan" for="scanFiles" title="Scan photo">' + CAMERA + (open ? '' : scanInputHtml(t)) + '</label>' +
      '<button type="button" class="ghost strip-edit" data-action="edit-athlete" aria-label="Edit ' + person(t) + ' details">Edit</button></div>';
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
    if (SL(t)) {                                       // v36: the Custom battery shows the same, and the battery it came from
      add(m.sex === 'Male' ? 'M' : (m.sex === 'Female' ? 'F' : ''));
      if (!blank(m.age)) add(clean1(m.age) + ' y');
      if (!blank(m.mass)) add(clean1(m.mass) + ' kg');
      add(m.sport); add(date);
      if (c && c.pop && c.pop.label) add('vs ' + shortPop(c.pop.label));
      if (t === 'custom') {                            // v37: the rehab context while the battery has rehab tests
        var ri = customRehabInfo();
        if (ri) { if (ri.injured) add(ri.injured + ' injured'); if (ri.ham) add('Hamstring ' + ri.ham); if (ri.acl) add('ACL ' + s.aclPhase); }
      }
      if (t === 'custom' && s.batName) add(s.batName);
    } else if (t === 'str') {
      if (!blank(m.mass)) add(clean1(m.mass) + ' kg');
      add(m.sport); add(date);
    } else if (t === 'ankle') {                        // v42
      if (m.injured) add(m.injured + ' injured');
      var wk = sinceText(t);
      if (wk) add(wk + ' wk');
      if (c && c.ago && c.ago.tested) add('Ankle-GO ' + c.ago.total + (c.ago.complete ? '/' + c.ago.max : ' so far'));
      add(date);
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
    var hc = els.cloudBar && !els.cloudBar.hidden ? Math.round(els.cloudBar.getBoundingClientRect().height) : 0;
    // v44: the new-version bar sticks under both
    var hu = els.updBar && !els.updBar.hidden ? Math.round(els.updBar.getBoundingClientRect().height) : 0, h = hb + hc + hu;
    if (hc) document.documentElement.style.setProperty('--cloud-top', hb + 'px');
    if (hu) document.documentElement.style.setProperty('--upd-top', (hb + hc) + 'px');
    if (h && h !== appbarH) { appbarH = h; document.documentElement.style.setProperty('--appbar-h', h + 'px'); }
    checkStuck();
  }

  // the metric name: a button that opens a plain-English explainer when explainers.json has one (A7)
  var INFO = '<svg class="m-i" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.3v3.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="4.8" r="1.05" fill="currentColor"/></svg>';
  var explainOpen = {};                               // which explainers are open (this visit only)
  function explainer(key) {
    var x = DATA.explain && DATA.explain.metrics && DATA.explain.metrics[key];
    if (!x && typeof key === 'string' && TEST_ID.test(key)) { var tt = ltFor(key); if (tt && tt.what) x = { what: tt.what, how: tt.how }; }   // v43: a clinic test's own words
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
  // the change line on screen (E.changeLabel's words, v11): when it wraps, the amount and 'no real change' stay whole
  function changeHtml(text, kind) {
    return esc(E.changeLabel(text, kind)).replace(/[▲▼●] \S+|[+\-]?\d[\d.]*(?: \([+\-]?\d[\d.]*%\))?|no real change/g, function (m) { return '<span class="nw">' + m + '</span>'; });
  }
  // v11: on a phone the column headings are hidden, so each box gets a small label above it (hidden on wider screens;
  // the boxes keep their own aria-labels)
  function boxLabels(a, b) {
    return '<span class="m-bl m-bl-a" aria-hidden="true">' + a + '</span><span class="m-bl m-bl-b" aria-hidden="true">' + b + '</span>';
  }
  function metricRow(tool, m, gi, mi) {
    var v = val(tool, m.name), id = tool + '-' + gi + '-' + mi, nm = esc(m.name);
    var asym = SL(tool) && E.isAsym(m.name);
    var hint = '<span class="m-unit">' + esc(m.unit === '/100' ? 'score out of 100' : m.unit === 'AU' ? 'score' : m.unit) + '</span>';   // v48: KOOS, IKDC and the like are out of 100 (was 'AU')
    if (m.calc === 'PERKG' || m.calc === 'PERBW' || m.calc === 'NPCTBW') hint = '<span class="m-unit">enter force in N · scored as ' + esc(m.unit) + ' using mass</span>';   // v43: + a builder test as % BW
    if (m.calc === 'XBW' || m.calc === 'PCTBW') hint = '<span class="m-unit">' + esc((m.detail ? m.detail + ' · ' : '') + 'enter load in kg · scored as ' + m.unit + ' using mass') + '</span>';   // v36: LL Strength tests in a custom battery
    else if (m.str && m.input === 'N') hint = '<span class="m-unit">' + esc((m.detail ? m.detail + ' · ' : '') + 'enter force in N · scored as ' + m.unit + ' using mass') + '</span>';
    else if (m.str) hint = '<span class="m-unit">' + esc((m.detail ? m.detail + ' · ' : '') + 'reps') + '</span>';
    else if (m.own) hint = '<span class="m-unit">' + esc(m.unit || 'your own test') + '</span>';
    else if (m.lib && !m.calc) hint = '<span class="m-unit">' + esc((m.unit && m.unit !== 'score' ? m.unit : 'score') + (m.side ? ', ' + m.side.toLowerCase() + ' leg' : '')) + '</span>';   // v43: a clinic test
    else if (m.ratio) hint = '<span class="m-unit">adduction \u00f7 abduction, ' + esc(String(m.side).toLowerCase()) + ' leg</span>';   // v37
    if (m.calc === 'LSI') hint = '<span class="m-unit">enter left & right · LSI = injured ÷ other side</span>';
    // the same words as the column headings: Result (Injured on the hamstring tab) and Previous; Left and Right for an LSI
    var labels = m.calc === 'DSI' || m.calc === 'RATIO' ? '' : (m.calc === 'LSI' ? boxLabels('Left', 'Right') : boxLabels(tool === 'ham' ? 'Injured' : 'Result', 'Previous'));
    var html = '<div class="metric' + (asym ? ' has-side' : '') + (labels ? ' has-bl' : '') + (m.calc === 'LSI' ? ' lsi' : '') + '" data-metric="' + nm + '" data-status="" id="' + id + '">' +
      '<div class="m-label">' + nameHtml(tool, m.xkey || m.name, m.name, id) + '<div class="m-hint">' + hint +
      '<span class="m-target"></span><span class="m-calc"></span><span class="m-prevnote"></span><span class="m-spark"></span></div><div class="m-meter"></div></div>' + labels;
    function input(fieldName, cls, ph, label) { return metricInput(id, nm, v, fieldName, cls, ph, label); }
    if (m.calc === 'DSI') {
      html += '<div class="m-auto" data-auto>CMJ Peak Force ÷ IMTP Peak Force</div>';
    } else if (m.calc === 'RATIO') {                   // v37: the hip ratio in a custom battery
      html += '<div class="m-auto" data-auto>Worked out: adduction \u00f7 abduction</div>';
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
    var S = setOf(tool), s = state[tool], on = testsShown(tool);
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
    return setOf(t).groups.map(function (g, gi) {
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
      (t !== 'str' && t !== 'ankle' ? '<button type="button" class="quiet add-prev" id="addPrev" data-action="add-prev"' + (prevShown(t) ? ' hidden' : '') + '>+ Add previous results</button>' : '') + '</div>';   // v42: Ankle-GO's previous results come from the record
  }
  // v18: the Previous column shows once there is a previous result on the page (a client's record loaded, or one typed),
  // or after + Add previous results; a first visit has no column of empty boxes. LL Strength has no Previous boxes.
  function prevShown(t) {
    var s = state[t];
    if (t === 'str' || t === 'ankle' || s.showPrev === true) return true;   // v42: Ankle-GO has no Previous boxes either
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

  // ------------------------------------------------------------------ v36: the Custom battery's page
  // The population comes first (Matthew: "it would ask the practitioner to select the population before beginning"): a card
  // of choices and nothing else until one is tapped. Then the details card (as the Performance screen's, with Compare against
  // to change the choice), the battery bar (Choose tests, Saved batteries, the count, + Add previous results), the battery's
  // rows by group, and the empty state while the battery has nothing in it.
  function popStepHtml() {
    var N = DATA.screen, sports = E.sportPopulations(N);
    function choice(key, title, sub) {
      return '<button type="button" class="pop-choice" data-pop="' + esc(key) + '"><span class="pc-text"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' + HOME_ICON.go + '</button>';
    }
    var html = '<section class="card pop-step" id="popStep" aria-labelledby="popStepH"><h2 id="popStepH">Compare against</h2>' +
      '<p class="pop-lead">The norms this battery is scored against. Pick first; the tests come next. It can be changed later in the details card.</p><div class="pop-choices">' +
      choice('general', 'General population', 'By sex and age band (VALD norms and the clinic’s own). Sex is asked for next.');
    sports.forEach(function (p) { html += choice(p, p, Object.keys(N.populations[p] || {}).length + ' metrics with norms · all ages'); });
    html += choice('none', 'The clinic\u2019s targets only', 'No population norms: LL Strength, rehab and your own tests against their targets. Sex only if a target needs it.');   // v43
    return html + '</div></section>';
  }
  function choosePopulation(p) {
    var s = state.custom, pops = E.sportPopulations(DATA.screen);
    if (p !== 'general' && p !== 'none' && pops.indexOf(p) < 0) return;   // v43: + the clinic's targets only
    s.pop = p;
    render();
    var first = els.entry.querySelector('#custom-name');
    if (first) focusQuiet(first);                      // the name box next (no keyboard until it is tapped)
  }
  function batteryLine() {
    var n = batteryCount(), s = state.custom;
    return (n ? n + (n === 1 ? ' test' : ' tests') : 'No tests yet') + (s.batName ? ' · ' + s.batName : '');
  }
  // v43: a clinic battery's page has Edit battery (the builder) in place of Saved batteries
  function batSecondBtn(cls) {
    return runBat() ? '<button type="button" class="ghost' + cls + '" data-action="bat-edit">Edit battery</button>'
      : '<button type="button" class="ghost' + cls + '" data-action="bat-saved" aria-haspopup="dialog">Saved batteries</button>';
  }
  function batteryBarHtml() {
    return '<div class="tests-bar bat-bar" id="batBar">' +
      '<button type="button" class="ghost tests-btn" data-action="bat-choose" aria-haspopup="dialog">Choose tests<span class="chev-s" aria-hidden="true"></span></button>' +
      batSecondBtn(' bat-saved') +
      '<span class="tests-hidden bat-count" id="batCount">' + esc(batteryLine()) + '</span>' +
      '<button type="button" class="quiet add-prev" id="addPrev" data-action="add-prev"' + (prevShown('custom') ? ' hidden' : '') + '>+ Add previous results</button></div>';
  }
  function batteryEmptyHtml() {
    return '<section class="card bat-empty" id="batEmpty" aria-labelledby="batEmptyH"' + (state.custom.battery.length ? ' hidden' : '') + '>' +
      '<h2 id="batEmptyH">Build the battery</h2>' +
      '<p>Choose tests from the catalogue (the Performance screen’s, LL Strength’s and the Hamstring and ACL rehab tests, or your own), start from a saved battery, or photograph your handwritten results with <b>Scan photo</b> in the client card: the app matches what you wrote to the tests it knows and fills the results in.</p>' +
      '<div class="bat-empty-acts"><button type="button" class="primary" data-action="bat-choose" aria-haspopup="dialog">Choose tests</button>' +
      batSecondBtn('') + '</div></section>';
  }
  function refreshBattery() {
    var cnt = $('batCount'), empty = $('batEmpty');
    if (cnt) cnt.textContent = batteryLine();
    if (empty) empty.hidden = state.custom.battery.length > 0;
  }
  // the battery replaced (Choose tests' Done, a saved battery, a client's last battery): values of tests no longer in it go;
  // Undo puts back the battery, its name and the values
  function setBattery(items, name, msg) {
    var s = state.custom, before = { battery: JSON.parse(JSON.stringify(s.battery)), batName: s.batName, values: JSON.parse(JSON.stringify(s.values)) };
    s.battery = tidyBattery(items);
    s.batName = name == null ? s.batName : name;
    var keep = {};
    customSet().groups.forEach(function (g) { g.metrics.forEach(function (m) { keep[m.name] = 1; }); });
    Object.keys(s.values).forEach(function (k) { if (!keep[k]) delete s.values[k]; });
    Object.keys(s.scanned || {}).forEach(function (mk) { if (!keep[mk.slice(0, mk.lastIndexOf('|'))] && mk.indexOf('meta|') !== 0) delete s.scanned[mk]; });
    fillCustomPrevious();                              // a loaded client's earlier results for the tests now in the battery
    retest.tool = null;
    if (state.tool === 'custom') render();
    saveDraft();
    if (msg) toast(msg, { label: 'Undo', run: function () {
      if (state.custom !== s) return;
      s.battery = before.battery; s.batName = before.batName; s.values = before.values;
      retest.tool = null;
      if (state.tool === 'custom') render();
      saveDraft();
    } });
  }
  // a test the scan matched (or the clinician's own test it read): into the battery if it isn't there, without a redraw
  function batteryAdd(item) {
    var it = tidyBattery([item])[0];
    if (!it || batteryHas(batteryKey(it))) return false;
    state.custom.battery.push(it);
    return true;
  }

  // ---- Choose tests (#catDialog): the catalogue by device group with a tick per test, a search box, and a form for one of
  // the clinic's own tests (name, unit, which way is better, an optional target and Close value). Done applies the ticks.
  var catPick = null;                                  // { on: { key: true }, own: [own items] } while the dialog is open
  var ownDir = 'Higher';
  function catErr(msg) { var p = $('ownErr'); p.textContent = msg || ''; p.hidden = !msg; }
  function openCatDialog() {
    if (state.tool !== 'custom') return;
    var s = state.custom;
    catPick = { on: {}, own: [] };
    s.battery.forEach(function (it) { catPick.on[batteryKey(it)] = true; if (it.k === 'own') catPick.own.push(JSON.parse(JSON.stringify(it))); });
    $('catSearch').value = '';
    ['ownName', 'ownUnit', 'ownGreen', 'ownAmber', 'ownType', 'ownRegion'].forEach(function (id) { $(id).value = ''; });   // v38: + the type and region
    setOwnDir('Higher');
    setOwnOpen(false);
    $('ownOk').textContent = '';
    catErr('');
    var c = computeScreen('custom');
    $('catLead').textContent = (c.pop.label ? (c.pop.label === POP_NONE ? 'Compared against the clinic’s targets only (no population norms).' : 'Targets shown are for ' + c.pop.label + '.') + ' Tests with results stay ticked unless you untick them (their results go).'   // v43
      : 'Tick the tests in this battery. Targets show once the sex (or a sport population) is chosen.') + ' Rehab tests are rated for the phase chosen in the details card.';   // v37
    renderCatList();
    openModal(els.catDialog, $('catSearch'), function (restore) { catPick = null; if (restore) focusQuiet(els.entry.querySelector('[data-action="bat-choose"]')); return true; });
  }
  function catMatches(name, q) {
    var k = E.libKey(q);
    if (!k) return true;
    var nk = E.libKey(name);
    return nk.indexOf(k) >= 0 || nk.split(' ').some(function (w) { return k.split(' ').every(function (qw) { return nk.indexOf(qw) >= 0; }) && w.indexOf(k.split(' ')[0]) === 0; });
  }
  function catTargetText(c, pop) {                     // what the row says under the name: the unit and the target for this population
    if (c.k === 'lib') return 'Clinic test \u00b7 ' + ltHow(c.def) + ' \u00b7 ' + ltTargetLine(c.def);   // v43: the battery builder's
    if (c.ratio) return 'worked out from Hip adduction and Hip abduction (ticked with it) \u00b7 each leg \u00b7 target ' + (c.def.target_text || '');   // v37
    if (c.k === 'ham' || c.k === 'acl') return REHAB_LABEL[c.k] + ' \u00b7 ' + rehabTargetText(c);   // v37; v38: whose test it is (the categories mix them)
    if (c.k === 'str') return (c.detail ? c.detail + ' · ' : '') + c.unit + ' each leg · target ' + (c.def.target_text || '');
    var norm = pop.population ? screenNorm(c.name, pop, 'screen') : null;
    var unit = scoreUnit(c.unit);
    if (!pop.population) return unit;
    return (unit ? unit + ' · ' : '') + (norm ? (norm.dir === 'Guide' ? 'guides training' : 'target ' + E.targetStr(norm)) : 'no target for this population');
  }
  function renderCatList() {
    if (!catPick) return;
    var q = $('catSearch').value, s = state.custom, pop = computeScreen('custom').pop, html = '', lastGroup = null, shown = 0;
    var has = {};
    Object.keys(s.values).forEach(function (k) { var v = s.values[k]; if (v && ['result', 'previous', 'side', 'left', 'right'].some(function (f) { return !blank(v[f]); })) has[k] = 1; });
    function row(key, name, sub, hasRes) {
      var on = !!catPick.on[key];
      return '<li><label class="tests-row cat-row"><input type="checkbox" data-cat="' + esc(key) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="tr-main"><span class="tr-t">' + esc(name) + '</span><span class="tr-n">' + esc(sub) + (hasRes ? ' · has results' : '') + '</span></span></label></li>';
    }
    // v38: the clinic's own tests sit in their category among the catalogue's (Other tests when they have none)
    var list = catalogue().filter(function (c) { return catMatches(c.name, q); });
    catPick.own.forEach(function (o, i) {
      if (!catMatches(o.name, q)) return;
      list.push({ key: 'own|' + o.id, k: 'own', name: o.name, own: o, group: catTitle(o.type, o.region), glabel: catLabel(o.type, o.region), rank: catRank(o.type, o.region), ord: 100000 + i });
    });
    list.sort(function (a, b) { return a.rank - b.rank || a.ord - b.ord; });
    list.forEach(function (c) {
      if (c.group !== lastGroup) { html += '<li class="cat-group" aria-hidden="true">' + esc(c.glabel || groupTitle(c.group)) + '</li>'; lastGroup = c.group; }
      var o = c.own;
      if (o) {
        var sub = 'Your own test · ' + (o.unit ? o.unit + ' · ' : '') + (o.green === null ? 'no target' : 'target ' + (o.dir === 'Lower' ? '≤ ' : '≥ ') + E.fmt(o.green) + (o.amber !== null && o.amber !== o.green ? ' · close ' + (o.dir === 'Lower' ? '≤ ' : '≥ ') + E.fmt(o.amber) : ''));
        html += row(c.key, o.name, sub, !!has[o.name]);
      } else {
        var hasRes = c.k === 'str' || (c.k === 'lib' && c.def.legs) ? !!(has[strSideName(c.def, 'Left')] || has[strSideName(c.def, 'Right')]) : !!has[c.name];
        html += row(c.key, c.name, catTargetText(c, pop), hasRes);
      }
      shown++;
    });
    if (!shown) html = '<li class="cat-none">No tests match “' + esc(clean1(q)) + '”. Add it below as your own test.</li>';
    $('catList').innerHTML = html;
    var n = Object.keys(catPick.on).filter(function (k) { return catPick.on[k]; }).length;
    $('catDone').textContent = n ? 'Done · ' + n + (n === 1 ? ' test' : ' tests') : 'Done';
  }
  // v37: a rehab test's line in Choose tests: its unit and its target at the phase chosen (or how it will be rated)
  function rehabTargetText(c) {
    var unit = c.def.calc === 'LSI' ? 'left & right \u2192 LSI %' : scoreUnit(c.unit);
    var ph = c.k === 'ham' ? state.custom.hamPhase : state.custom.aclPhase, key = rehabKeyFor(c.k);
    var norm = key ? ((DATA[c.k].norms || {})[key] || {})[c.name] : null;
    var where = !ph ? 'targets by rehab phase' : !key ? 'targets by phase and sex' : norm ? 'phase target ' + E.targetStr(norm) + ' (' + ph + ')' : 'no target at ' + ph;
    return (unit ? unit + ' \u00b7 ' : '') + where;
  }
  function catToggle(key, on) {
    if (!catPick) return;
    var rt = ratioTest(), rk = 'str|' + RATIO_ID;
    if (on) {
      catPick.on[key] = true;
      if (key === rk && rt) rt.from.forEach(function (id) { catPick.on['str|' + id] = true; });   // v37: the hip ratio ticks the two hip tests
    } else {
      delete catPick.on[key];
      if (rt && rt.from.some(function (id) { return key === 'str|' + id; })) delete catPick.on[rk];   // and goes without either of them
    }
    renderCatList();
  }
  function catClear() { if (catPick) { catPick.on = {}; renderCatList(); } }
  function setOwnOpen(open) {                        // the own-test form, folded behind + Your own test
    $('catOwnForm').hidden = !open;
    $('ownOpen').setAttribute('aria-expanded', String(open));
    if (open) { $('ownOk').textContent = ''; $('ownName').focus(); }
  }
  function setOwnDir(d) {
    ownDir = d === 'Lower' ? 'Lower' : 'Higher';
    els.catDialog.querySelectorAll('[data-own-dir]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.ownDir === ownDir)); });
  }
  function ownAdd() {
    if (!catPick) return;
    var name = cap($('ownName').value, 80), unit = cap($('ownUnit').value, 12);
    var green = ownNum($('ownGreen').value), amber = ownNum($('ownAmber').value);
    if (!name) { catErr('Give the test a name.'); $('ownName').focus(); return; }
    var inCat = catalogueByName(name);
    if (inCat) { catPick.on[inCat.key] = true; renderCatList(); catErr(''); setOwnOpen(false); $('ownOk').textContent = inCat.name + (inCat.k === 'lib' ? ' is one of the clinic\u2019s tests: ticked above.' : ' is in the catalogue: ticked above.'); $('ownName').value = ''; focusQuiet($('ownOpen')); return; }
    var k = E.libKey(name);
    if (catPick.own.some(function (o) { return E.libKey(o.name) === k; })) { catErr('There is already an own test called that.'); $('ownName').focus(); return; }
    if (!blank($('ownGreen').value) && green === null) { catErr('The target should be a number.'); $('ownGreen').focus(); return; }
    if (!blank($('ownAmber').value) && amber === null) { catErr('The Close value should be a number.'); $('ownAmber').focus(); return; }
    if (green === null && amber !== null) { catErr('Add the target too, or leave both blank.'); $('ownGreen').focus(); return; }
    var o = tidyOwn({ id: newId('o-'), name: name, unit: unit, dir: ownDir, green: green, amber: amber, type: $('ownType').value, region: $('ownRegion').value });   // v38: + its category
    if (!o) { catErr('That test couldn’t be added.'); return; }
    catPick.own.push(o);
    catPick.on['own|' + o.id] = true;
    ['ownName', 'ownUnit', 'ownGreen', 'ownAmber', 'ownType', 'ownRegion'].forEach(function (id) { $(id).value = ''; });
    setOwnDir('Higher');
    catErr('');
    renderCatList();
    setOwnOpen(false);
    $('ownOk').textContent = 'Added ' + o.name + ' under ' + catLabel(o.type, o.region) + ' (ticked above).';
    focusQuiet($('ownOpen'));
  }
  function catApply() {
    if (!catPick) return;
    var on = catPick.on, items = [];
    catalogue().forEach(function (c) { if (on[c.key]) items.push(c.k === 'screen' ? { k: 'screen', key: c.name } : c.k === 'str' ? { k: 'str', id: c.def.id } : c.k === 'lib' ? { k: 'lib', id: c.def.id } : { k: c.k, key: c.name }); });   // v37: + rehab tests; v43: + the clinic's
    catPick.own.forEach(function (o) { if (on['own|' + o.id]) items.push(o); });
    var was = JSON.stringify(state.custom.battery), old = {};
    state.custom.battery.forEach(function (it) { old[batteryKey(it)] = 1; });
    closeModal();
    if (JSON.stringify(tidyBattery(items)) === was) return;
    // a saved battery's name stays while some of its tests do (a tweak); a battery with none of them left has no name
    var keepName = tidyBattery(items).some(function (it) { return old[batteryKey(it)]; });
    setBattery(items, keepName ? null : '', 'Battery: ' + (items.length ? batteryLineFor(items) : 'no tests'));
  }
  function batteryLineFor(items) { var n = items.length; return n + (n === 1 ? ' test' : ' tests'); }

  // ---- Saved batteries (#batDialog): the clinic's named batteries (the clinic store's `batteries` collection in cloud mode,
  // this device in local mode), as program templates are kept. Save this battery as (the same name replaces, second tap),
  // Use (replaces the battery on the page, Undo), Delete (two taps, Undo).
  var BAT_STORE = 'bh-athlete-report-batteries-v1', BAT_ID = /^b-[a-z0-9]{1,40}$/, localBat = { v: 1, items: {} }, batMemo = null, batArmed = '', batDelTimer = null;
  function tidyBat(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.id !== 'string' || !BAT_ID.test(o.id)) return null;
    var name = cap(o.name, 80);
    if (!name) return null;
    var items = tidyBattery(o.items);
    if (!items.length) return null;
    // v43: + its tile on the Screening page (shown unless hidden in the builder) and the line on it
    return { id: o.id, name: name, items: items, pop: typeof o.pop === 'string' ? o.pop.slice(0, 80) : '', tile: o.tile !== false, about: cap(o.about, 140),
      updatedBy: cap(o.updatedBy, 120), updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt.slice(0, 40) : '' };
  }
  function batAll() {
    var src = storedItems('batteries');
    if (batMemo && batMemo.ver === libVer && batMemo.src === src) return batMemo;
    var byId = {};
    Object.keys(src).forEach(function (id) {
      var o = src[id];
      if (!BAT_ID.test(id) || !o || typeof o !== 'object' || o.deleted === true) return;
      var b = tidyBat(o);
      if (b && b.id === id) byId[id] = b;
    });
    batMemo = { ver: libVer, src: src, byId: byId, list: Object.keys(byId).map(function (k) { return byId[k]; }).sort(nameOrder) };
    return batMemo;
  }
  function batList() { return batAll().list; }
  function batGet(id) { return id && BAT_ID.test(id) ? batAll().byId[id] || null : null; }
  function batErr(msg) { var p = $('batErr'); p.textContent = msg || ''; p.hidden = !msg; }
  function openBatDialog() {
    if (state.tool !== 'custom') return;
    if (CLOUD) CLOUD.sync({ throttle: true });         // another device may have saved one
    batArmed = '';
    $('batName').value = state.custom.batName || '';
    $('batSaveGo').textContent = 'Save';
    $('batSaveRow').hidden = !state.custom.battery.length;
    batErr('');
    $('batLead').textContent = (CLOUD ? 'Shared by every signed-in device. ' : 'Saved on this device. ') + (state.custom.battery.length ? 'Save the tests on the page as a battery (it gets its own tile on the Screening page), or use a saved one.' : 'Use a saved battery to fill the page with its tests.');   // v43
    renderBatList();
    openModal(els.batDialog, state.custom.battery.length ? $('batName') : (els.batDialog.querySelector('[data-action="bat-use"]') || $('batClose')),
      function (restore) { if (restore) focusQuiet(els.entry.querySelector('[data-action="bat-saved"]')); return true; });
  }
  function renderBatList() {
    var box = $('batList'), list = batList();
    if (!box) return;
    if (!list.length) { box.innerHTML = '<p class="client-none">No saved batteries yet. Choose tests, then save them here with a name.</p>'; return; }
    box.innerHTML = '<div class="tpl-list bat-list">' + list.map(function (b) {
      var nm = esc(b.name), upd = tplUpdLine(b), sub = batteryLineFor(b.items) + (b.pop ? ' · ' + (b.pop === 'general' ? 'general population' : b.pop) : '');
      return '<div class="tpl-row" data-bat="' + esc(b.id) + '"><div class="tpl-main"><b>' + nm + '</b><span>' + esc(sub) + '</span>' + (upd ? '<span class="tpl-upd">' + esc(upd) + '</span>' : '') + '</div>' +
        '<div class="tpl-acts"><button type="button" class="ghost" data-action="bat-use">Use<span class="vh"> ' + nm + '</span></button>' +
        '<button type="button" class="quiet tpl-del bat-del" data-action="bat-del">Delete<span class="vh"> ' + nm + '</span></button></div></div>';
    }).join('') + '</div>';
  }
  function afterBatChange() {
    if (openModalEl === els.batDialog) renderBatList();
    if (!state) return;
    // v43: the Screening page's tiles and the builder; the Custom page when its battery's tests changed (a test renamed, the Close %)
    if (homeView && (homeSub === 'screening' || homeSub === 'builder')) renderHome();
    if (state.tool === 'custom' && state.custom.pop !== null) { if (customShape() !== pageShape) renderPage(); else refresh(); }
  }
  function batSaveGo() {
    var s = state.custom, name = cap($('batName').value, 80);
    if (!name) { batErr('Give the battery a name.'); $('batName').focus(); return; }
    if (!s.battery.length) { batErr('Choose some tests first.'); return; }
    var k = E.libKey(name), dup = batList().filter(function (b) { return E.libKey(b.name) === k; })[0];
    if (dup && batArmed !== dup.id) {
      batArmed = dup.id;
      $('batSaveGo').textContent = 'Replace ' + dup.name;
      batErr('A battery is already called that. Tap Replace to save over it.');
      return;
    }
    var b = { id: dup ? dup.id : newId('b-'), name: name, items: tidyBattery(s.battery), pop: s.pop || '', tile: dup ? dup.tile : true, about: dup ? dup.about : '', updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() };   // v43: its tile and line kept
    var ok = writeItem('batteries', b.id, b);
    s.batName = name;
    saveDraft();
    refreshBattery();
    syncCard(compute());
    closeModal();
    toast(ok ? 'Saved battery ' + name + (dup ? '' : ': it has its own tile on the Screening page') : 'This device wouldn’t save the battery (storage is full or blocked).');
  }
  function batUse(id) {
    var b = batGet(id);
    if (!b) return;
    closeModal(false);
    setBattery(b.items, b.name, 'Started from ' + b.name);
    focusQuiet(els.entry.querySelector('[data-action="bat-saved"]'));
  }
  function batDeleteTap(btn, id) {
    var b = batGet(id);
    if (!b) return;
    if (!btn.classList.contains('armed')) {
      els.batDialog.querySelectorAll('.bat-del.armed').forEach(function (x) { x.classList.remove('armed'); if (x._html) x.innerHTML = x._html; });
      btn._html = btn.innerHTML;
      btn.classList.add('armed');
      btn.textContent = 'Tap again to delete';
      clearTimeout(batDelTimer);
      batDelTimer = setTimeout(function () { if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.innerHTML = btn._html; } }, 4000);
      return;
    }
    clearTimeout(batDelTimer);
    writeItem('batteries', id, null);
    afterBatChange();
    toast('Deleted ' + b.name, { label: 'Undo', run: function () { writeItem('batteries', id, b); afterBatChange(); } });
  }
  function wireCustomDialogs() {
    els.catDialog = $('catDialog'); els.batDialog = $('batDialog');
    wireBuilder();                                     // v43: the test editor
    // v38: the own-test form's Type and Region menus (blank: Other tests, no region)
    $('ownType').innerHTML = '<option value="">Other</option>' + CAT_TYPES.map(function (t) { return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('');
    $('ownRegion').innerHTML = '<option value="">Not set</option>' + CAT_REGIONS.map(function (r) { return '<option value="' + r[0] + '">' + esc(r[1]) + '</option>'; }).join('');
    $('catSearch').addEventListener('input', renderCatList);
    $('catList').addEventListener('change', function (e) { if (e.target.matches('input[data-cat]')) catToggle(e.target.dataset.cat, e.target.checked); });
    $('catNone').addEventListener('click', catClear);
    els.catDialog.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (e.target === els.catDialog) { closeModal(); return; }
      if (!b) return;
      if (b.dataset.ownDir) setOwnDir(b.dataset.ownDir);
      else if (b.id === 'ownOpen') setOwnOpen($('catOwnForm').hidden);
      else if (b.id === 'ownAdd') ownAdd();
      else if (b.id === 'catDone') catApply();
      else if (b.id === 'catCancel') closeModal();
    });
    ['ownName', 'ownUnit', 'ownGreen', 'ownAmber'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ownAdd(); } });
      $(id).addEventListener('input', function () { catErr(''); });
    });
    els.batDialog.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (e.target === els.batDialog) { closeModal(); return; }
      if (!b) return;
      var row = b.closest('[data-bat]');
      if (b.id === 'batSaveGo') batSaveGo();
      else if (b.id === 'batClose') closeModal();
      else if (b.dataset.action === 'bat-use' && row) batUse(row.dataset.bat);
      else if (b.dataset.action === 'bat-del' && row) batDeleteTap(b, row.dataset.bat);
    });
    $('batName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); batSaveGo(); } });
    $('batName').addEventListener('input', function () { batErr(''); batArmed = ''; $('batSaveGo').textContent = 'Save'; });
  }

  // ------------------------------------------------------------------ v43: the battery builder
  // Matthew (8 Oct): "I want to create a testing battery builder - this is where we would create new testing batteries - add
  // new tests (ones that are not currently saved) and add the norm we want for each of those tests - it the once having the
  // norms would use the traffic light system based on the % rule we have." and "Also the measurement for the norms for
  // example if its a gross number in newtons or a % of body weight". His choices: each battery its own tile on the
  // Screening page (a Battery builder tile makes and changes them; Custom stays for working on the spot); one target for
  // everyone or one by sex; Close within 10% of the target, one setting for the clinic; one value or each leg (each leg
  // rated, the difference shown), the target as measured (gross N, kg, s…) or relative to body weight.
  // The clinic's tests ('bt-…') and the Close setting ('bx-close') are kept in the store's `batteries` collection beside the
  // batteries ('b-…'): no new Firestore rule, and v42 apps skip them (BAT_ID). A battery's item { k: 'lib', id } is one of
  // these tests; customSet() turns it into a metric (one per leg) rated against its target, Close from the clinic's %.
  var TEST_ID = /^bt-[a-z0-9]{1,40}$/, CLOSE_ID = 'bx-close', CLOSE_DEF = 10, POP_NONE = 'Clinic targets';
  var LT_UNITS = [['N', 'N (force)'], ['kg', 'kg (load)'], ['s', 's (time)'], ['ms', 'ms (time)'], ['cm', 'cm'], ['m', 'm'], ['reps', 'reps'], ['%', '%'], ['°', '° (angle)'], ['score', 'score / points'], ['other', 'Other…']];
  var LT_SCORE = { pctbw: '% BW', xbw: '× BW', perkg: 'N/kg' };
  function ltScoreOk(unit, score) {
    return score === '' || ((unit === 'N' || unit === 'kg') && (score === 'pctbw' || score === 'xbw')) || (unit === 'N' && score === 'perkg');
  }
  // how it is scored: a force in N as % BW (NPCTBW), × BW (PERBW) or N/kg (PERKG); a load in kg as % BW (PCTBW) or × BW (XBW)
  function ltCalc(tt) { return tt.score === 'pctbw' ? (tt.unit === 'N' ? 'NPCTBW' : 'PCTBW') : tt.score === 'xbw' ? (tt.unit === 'N' ? 'PERBW' : 'XBW') : tt.score === 'perkg' ? 'PERKG' : null; }
  function ltUnit(tt) { return tt.score ? LT_SCORE[tt.score] : tt.unit; }   // the unit it is scored (and its target set) in
  function closeClamp(p) { return Math.min(50, Math.max(1, Math.round(p * 10) / 10)); }
  function ownPctClamp(p) { return Math.min(90, Math.max(1, Math.round(p * 10) / 10)); }   // a test's own Close: 1 to 90%
  // the Close % a test is rated with: as kept with a session, else its own rule, else the clinic's
  function ltPct(tt) { return tt.pct != null ? tt.pct : tt.closePct != null ? tt.closePct : closePct(); }
  // the clinic's Close % for a battery's tests: as a record kept it (a test without its own rule), else now
  function libBasePct(tests) { var base = tests.filter(function (tt) { return tt.pct != null && tt.closePct == null; })[0]; return base ? base.pct : closePct(); }
  function batLibTests() { return state.custom.battery.map(function (it) { return it.k === 'lib' ? ltFor(it.id) : null; }).filter(Boolean); }
  function closePct() {                                // the clinic's Close: within this % of the target (10 until changed)
    var o = storedItems('batteries')[CLOSE_ID], p = o && typeof o === 'object' && o.deleted !== true ? Number(o.pct) : NaN;
    return isFinite(p) && p > 0 ? closeClamp(p) : CLOSE_DEF;
  }
  function ltFmt(n) { return String(Math.round(n * 100) / 100); }
  function ltWithUnit(n, unit) {                       // '250% BW', '2.5 × BW', '12.4 s', '35°', '7'
    var v = ltFmt(n);
    if (!unit || unit === 'score') return v;
    return unit === '%' || unit === '°' || unit === '% BW' ? v + unit : v + ' ' + unit;
  }
  function tidyLibTest(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.id !== 'string' || !TEST_ID.test(o.id)) return null;
    var name = cap(o.name, 80);
    if (!name) return null;
    var unit = cap(o.unit, 12), score = typeof o.score === 'string' ? o.score : '';
    if (!ltScoreOk(unit, score)) score = '';
    function n(v) { var x = ownNum(v); return x === null || !isFinite(x) ? null : x; }
    var t = { id: o.id, kind: 'test', name: name, unit: unit, score: score, dir: o.dir === 'Lower' ? 'Lower' : 'Higher', legs: o.legs === true, bySex: o.bySex === true,
      target: n(o.target), targetM: n(o.targetM), targetF: n(o.targetF), what: cap(o.what, 400), how: cap(o.how, 400) };
    if (t.bySex) t.target = null; else { t.targetM = null; t.targetF = null; }
    if (catKeyIndex(CAT_TYPES, o.type) >= 0) t.type = o.type;
    if (catKeyIndex(CAT_REGIONS, o.region) >= 0) t.region = o.region;
    var was = Array.isArray(o.was) ? o.was.map(function (x) { return cap(x, 80); }).filter(Boolean).slice(0, 10) : [];
    if (was.length) t.was = was;                       // its earlier names: results saved under them still count as previous
    // Matthew (9 Oct): "we should be able to make our own rules for each custom test too": its own Close % (null: the clinic's)
    var own = n(o.closePct);
    t.closePct = own !== null && own > 0 ? ownPctClamp(own) : null;
    if (typeof o.pct === 'number' && isFinite(o.pct) && o.pct > 0) t.pct = ownPctClamp(o.pct);   // a copy kept with a session: the Close it was rated with
    t.updatedBy = cap(o.updatedBy, 120);
    t.updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt.slice(0, 40) : '';
    return t;
  }
  var ltMemo = null;
  function ltAll() {
    var src = storedItems('batteries');
    if (ltMemo && ltMemo.ver === libVer && ltMemo.src === src) return ltMemo;
    var byId = {};
    Object.keys(src).forEach(function (id) {
      var o = src[id];
      if (!TEST_ID.test(id) || !o || typeof o !== 'object' || o.deleted === true) return;
      var t = tidyLibTest(o);
      if (t && t.id === id) byId[id] = t;
    });
    ltMemo = { ver: libVer, src: src, byId: byId, list: Object.keys(byId).map(function (k) { return byId[k]; }).sort(nameOrder) };
    return ltMemo;
  }
  function ltList() { return ltAll().list; }
  function ltGet(id) { return typeof id === 'string' && TEST_ID.test(id) ? ltAll().byId[id] || null : null; }
  function ltByName(name, butId) {
    var k = E.libKey(name);
    return k ? ltList().filter(function (t) { return t.id !== butId && E.libKey(t.name) === k; })[0] || null : null;
  }
  // the test as the page scores it: a report made again from a record uses the copy kept with that session (its target and
  // Close then), anything else the clinic's tests as they are now
  function ltFor(id) {
    var snap = state && state.custom && state.custom.libSnap, o = snap && typeof snap === 'object' && !Array.isArray(snap) ? snap[id] : null;
    return (o && typeof o === 'object' ? tidyLibTest(Object.assign({}, o, { id: id })) : null) || ltGet(id);
  }
  function ltSnapshot(tt) {                            // what a session keeps of a test it used
    var o = JSON.parse(JSON.stringify(tt));
    delete o.updatedBy; delete o.updatedAt; delete o.was;
    o.pct = ltPct(tt);
    return o;
  }
  function ltTarget(tt, sex) { return !tt.bySex ? tt.target : sex === 'Male' ? tt.targetM : sex === 'Female' ? tt.targetF : null; }
  function ltClose(tt, g, p) { var d = Math.abs(g) * p / 100; return Math.round((tt.dir === 'Lower' ? g + d : g - d) * 10000) / 10000; }
  function ltNorm(tt, sex, pct) {                      // null: no target (for this sex)
    var g = ltTarget(tt, sex);
    if (g === null) return null;
    var p = pct == null ? ltPct(tt) : pct;
    return { dir: tt.dir, green: g, amber: ltClose(tt, g, p),
      label: (tt.dir === 'Lower' ? '≤ ' : '≥ ') + ltWithUnit(g, ltUnit(tt)) + (tt.bySex ? ' (' + String(sex).toLowerCase() + ')' : '') + (tt.closePct != null ? ' · Close within ' + ltFmt(p) + '%' : ''),   // v43: its own rule shown
      source: '★☆☆ Clinic target (battery builder) · Close within ' + ltFmt(p) + '%' };
  }
  function ltTargetLine(tt, pct) {                     // 'target ≥ 250% BW · Close from 225', 'targets by sex: M ≥ 250 · F ≥ 200', 'no target'
    var u = ltUnit(tt), op = tt.dir === 'Lower' ? '≤ ' : '≥ ', own = tt.closePct != null && tt.pct == null ? ' (its own ' + ltFmt(tt.closePct) + '%)' : '';   // v43: a test's own Close rule
    if (tt.bySex) {
      var bits = [];
      if (tt.targetM !== null) bits.push('M ' + op + ltWithUnit(tt.targetM, u));
      if (tt.targetF !== null) bits.push('F ' + op + ltWithUnit(tt.targetF, u));
      return bits.length ? 'targets by sex: ' + bits.join(' · ') + own : 'no target yet (tracked, not rated)';
    }
    if (tt.target === null) return 'no target (tracked, not rated)';
    return 'target ' + op + ltWithUnit(tt.target, u) + ' · Close ' + (tt.dir === 'Lower' ? 'up to ' : 'from ') + ltFmt(ltClose(tt, tt.target, pct == null ? ltPct(tt) : pct)) + own;
  }
  function ltHow(tt) {                                 // 'force in N, scored as % BW · each leg', 's · one value · lower is better'
    var bits = [];
    if (tt.score) bits.push((tt.unit === 'N' ? 'force in N' : 'load in kg') + ', scored as ' + LT_SCORE[tt.score]);
    else if (tt.unit) bits.push(tt.unit === 'score' ? 'a score' : tt.unit);
    bits.push(tt.legs ? 'each leg' : 'one value');
    if (tt.dir === 'Lower') bits.push('lower is better');
    return bits.join(' · ');
  }
  function ltSideName(tt, side) { return tt.name + ' — ' + side; }
  function ltScanWhat(tt) {
    return (tt.score ? (tt.unit === 'N' ? 'force in N (the app scales it by body mass)' : 'load in kg (the app scales it by body mass)') : tt.unit && tt.unit !== 'score' ? 'in ' + tt.unit : 'number') +
      (tt.legs ? ' for each leg' : '') + (tt.dir === 'Lower' ? ', lower is better' : '');
  }
  // a test made on the Custom page (+ Your own test) as one of the clinic's tests: its target stays, Close follows the %
  function ownToLib(o) {                               // (the Close typed with it becomes its own %)
    var own = o.green !== null && o.amber !== null && o.amber !== o.green && o.green !== 0 ? Math.abs(o.green - o.amber) / Math.abs(o.green) * 100 : null;
    return tidyLibTest({ id: newId('bt-'), name: o.name, unit: o.unit, score: '', dir: o.dir, legs: false, bySex: false, target: o.green, closePct: own, type: o.type, region: o.region,
      updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() });
  }
  // the metric a battery item draws, as its key in a battery ('lib|bt-…', 'str|…', …)
  function metricItemKey(m) {
    return m.str ? 'str|' + m.str : m.ratio ? 'str|' + m.ratio : m.own ? 'own|' + m.own : m.lib ? 'lib|' + m.lib : m.rehab ? m.rehab + '|' + m.name : 'screen|' + m.name;
  }
  // v43: tests with targets by sex while no sex is chosen ('' otherwise; the general population asks for sex anyway)
  function customSexNeed() {
    var s = state.custom;
    if (s.meta.sex === 'Male' || s.meta.sex === 'Female') return '';
    return s.battery.some(function (it) { var tt = it.k === 'lib' ? ltFor(it.id) : null; return !!(tt && tt.bySex); }) ? 'Male or Female (some targets are by sex)' : '';
  }
  // a builder test measured on each leg, both legs typed: how far apart they are (% of the higher leg) and which leg is behind
  function legDiff(t, base, dir) {
    var vs = state[t].values, L = E.parseInput((vs[base + ' — Left'] || {}).result), R = E.parseInput((vs[base + ' — Right'] || {}).result);
    if (L === null || R === null || L <= 0 || R <= 0) return null;
    var pct = E.pyRound(Math.abs(L - R) / Math.max(L, R) * 100, 1);
    return { name: base, L: L, R: R, pct: pct, higher: L === R ? '' : L > R ? 'L' : 'R', behind: L === R ? '' : (dir === 'Lower' ? (L > R ? 'Left' : 'Right') : (L < R ? 'Left' : 'Right')) };
  }
  function legDiffs(t) {                               // every such test in the battery (for the report and Claude)
    var out = [], seen = {};
    setOf(t).groups.forEach(function (g) {
      g.metrics.forEach(function (m) {
        if (!m.lib || !m.side || seen[m.lib]) return;
        seen[m.lib] = 1;
        var tt = ltFor(m.lib), d = tt ? legDiff(t, tt.name, tt.dir) : null;
        if (d) { d.unit = tt.unit; d.dir = tt.dir; out.push(d); }
      });
    });
    return out;
  }
  function legDiffText(d, side) {                      // on the leg behind: '12% below the right leg' ('' on the other leg)
    if (!d || !d.behind || d.behind !== side || Math.round(d.pct) < 1) return '';
    var other = side === 'Left' ? 'right' : 'left';
    return E.fmt(Math.round(d.pct)) + '% ' + (d.higher === (side === 'Left' ? 'L' : 'R') ? 'above' : 'below') + ' the ' + other + ' leg';
  }

  // ---- the clinic's batteries as their own pages: the Custom page runs a battery (state.custom.batId) or the on-the-spot
  // set-up ('' ; kept in state.custom.spot while a battery runs, so Custom comes back as it was left)
  function builtPop(b) {                               // who a battery compares against: null = asked when it starts
    var hasScreen = b.items.some(function (it) { return it.k === 'screen'; }), pops = E.sportPopulations(DATA.screen);
    if (b.pop === 'general' || pops.indexOf(b.pop) >= 0) return b.pop;
    if (b.pop === 'none' || !hasScreen) return 'none';
    return null;
  }
  function batPopLabel(b) { var p = builtPop(b); return p === null ? 'population chosen each time' : p === 'none' ? 'the clinic’s targets' : p === 'general' ? 'general population' : p; }
  function tileBats() { return batList().filter(function (b) { return b.tile; }); }
  function runBat() { var id = state.custom.batId; return id ? batGet(id) : null; }   // the battery on the Custom page (null: on the spot, or deleted since)
  function toolName(t) { return t === 'custom' && state.custom.batId && state.custom.batName ? state.custom.batName : TOOL_NAMES[t]; }
  function toolHead(t) { return t === 'custom' && state.custom.batId && state.custom.batName ? state.custom.batName : HEAD[t][0]; }
  function toolBlurb(t) {
    if (t !== 'custom' || !state.custom.batId) return HEAD[t][1];
    var b = runBat();
    return b && b.about ? b.about : 'The clinic’s battery. Enter the results: each test is rated against its norms or the clinic’s target.';
  }
  function customSetup() { var c = state.custom; return { pop: c.pop, battery: c.battery, batName: c.batName, batId: c.batId || '', spot: c.spot || null }; }
  // the page set up for a battery ('' : the on-the-spot set-up); the page is empty or was just cleared
  function switchBattery(id) {
    var s = state.custom, b = id ? batGet(id) : null;
    if (id && !b) return false;
    if (!id && !s.batId) return true;                  // on the spot already
    if (b) {
      if (!s.batId) s.spot = { pop: s.pop, battery: s.battery, batName: s.batName };
      s.batId = b.id; s.batName = b.name; s.battery = tidyBattery(b.items); s.pop = builtPop(b);
    } else {
      var sp = s.spot || { pop: null, battery: [], batName: '' };
      s.batId = ''; s.pop = sp.pop; s.battery = tidyBattery(sp.battery); s.batName = sp.batName || ''; s.spot = null;
    }
    customMemo = null;
    var keep = {};
    customSet().groups.forEach(function (g) { g.metrics.forEach(function (m) { keep[m.name] = 1; }); });
    Object.keys(s.values).forEach(function (k) { if (!keep[k]) delete s.values[k]; });
    retest.tool = null;
    saveDraft();
    return true;
  }
  // a battery's tile (id) or Custom's ('' ): straight in when the page is free, else ask first (Continue / Start new)
  function openBattery(id) {
    if (id && !batGet(id)) return;
    var same = (state.custom.batId || '') === id;
    if (homeBusy('custom')) { askHalfDone(same ? { tool: 'custom', page: null, bat: id } : { tool: 'custom', bat: id, swap: true }); return; }
    switchBattery(id);                                 // (a battery: as saved now, should it have changed)
    openTool('custom', null);
  }
  function batStartNew(id) {                           // Start new on a battery's question: the page cleared, then set up for it
    var undo = clearForClient('custom');
    switchBattery(id);
    openTool('custom', null);
    toast('New ' + toolName('custom') + ' started', { label: 'Undo', run: undo });
  }
  // a battery from the page's heading menu ('' : Custom on the spot)
  function pickBattery(id) {
    if (id && !batGet(id)) return;
    if ((state.custom.batId || '') !== id && homeBusy('custom')) { askHalfDone({ tool: 'custom', bat: id, swap: true }); return; }
    switchBattery(id);
    state.tool = 'custom'; state.screenTool = 'custom';
    render();
    window.scrollTo(0, 0);
    focusQuiet(pickBtn());
  }
  // a client chosen with a battery (+ New test, the Choose a test list): theirs carries on; anyone else's asks first
  function clientGoBattery(id, c) {
    if (id && !batGet(id)) return;
    var want = c.key || E.nameKey(c.name), cur = E.nameKey(state.custom.meta.name), same = (state.custom.batId || '') === id;
    if (homeBusy('custom')) {
      if (same && cur && cur === want) { openTool('custom', null); return; }
      askHalfDone({ tool: 'custom', client: c, bat: id, swap: !same });
      return;
    }
    switchBattery(id);
    homeClientOpen('custom', c, false);
  }
  // a battery saved in the builder while the page runs it: its tests and name follow (tests holding results stay for now)
  function bldApplyToPage(b) {
    var s = state.custom;
    if (s.batId !== b.id) return;
    var held = {}, now = {};
    customSet().groups.forEach(function (g) { g.metrics.forEach(function (m) {
      var v = s.values[m.name]; if (v && ['result', 'previous', 'side', 'left', 'right'].some(function (f) { return !blank(v[f]); })) held[metricItemKey(m)] = 1;
    }); });
    b.items.forEach(function (it) { now[batteryKey(it)] = 1; });
    var stay = s.battery.filter(function (it) { var k = batteryKey(it); return held[k] && !now[k]; });
    s.batName = b.name;
    s.battery = tidyBattery(b.items.concat(stay));
    if (!homeBusy('custom')) s.pop = builtPop(b);
    customMemo = null;
    saveDraft();
    render();
  }
  var pageShape = '';                                  // the Custom page's rows as drawn (a test renamed elsewhere redraws them)
  function customShape() { return customSet().groups.map(function (g) { return g.title + ':' + g.metrics.map(function (m) { return m.name; }).join('|'); }).join('/'); }

  // ---- the Battery builder (Home › Screening › Battery builder; homeSub 'builder'): the clinic's batteries, its own tests
  // and the Close %. bld.view 'list', or 'bat' with bld.edit (a battery being made or changed: { id ('' new), name, about,
  // pop, tile, on: { catalogue key: true }, own: [tests made on the Custom page], dirty }); bld.from 'page' when it came
  // from Edit battery on the battery's page (Save and Cancel go back there). The test editor is a pop-up (#testDialog).
  function freshBld() { return { view: 'list', edit: null, q: '', from: '', err: '', delArmed: false }; }
  var bld = freshBld(), bldDelTimer = null;
  function bldStartEdit(id, from) {
    var b = id ? batGet(id) : null;
    if (id && !b) return;
    var on = {}, own = [];
    (b ? b.items : []).forEach(function (it) { on[batteryKey(it)] = true; if (it.k === 'own') own.push(JSON.parse(JSON.stringify(it))); });
    bld = freshBld();
    bld.view = 'bat';
    bld.from = from || '';
    bld.edit = { id: b ? b.id : '', name: b ? b.name : '', about: b ? b.about : '', pop: b && (b.pop === 'general' || E.sportPopulations(DATA.screen).indexOf(b.pop) >= 0) ? b.pop : '',
      tile: b ? b.tile : true, on: on, own: own, dirty: false, isNew: !b };
  }
  // the catalogue (with the clinic's tests) and the battery's tests made on the Custom page, in Choose tests' order
  function bldEntries() {
    var e = bld.edit, list = catalogue().slice();
    e.own.forEach(function (o, i) {
      list.push({ key: 'own|' + o.id, k: 'own', name: o.name, own: o, group: catTitle(o.type, o.region), glabel: catLabel(o.type, o.region), rank: catRank(o.type, o.region), ord: 100000 + i });
    });
    list.sort(function (a, b) { return a.rank - b.rank || a.ord - b.ord; });
    return list;
  }
  function bldSub(c) {                                 // a test's line in the builder: its unit and how it is rated
    if (c.k === 'lib') return 'Clinic test · ' + ltHow(c.def) + ' · ' + ltTargetLine(c.def);
    if (c.k === 'own') { var o = c.own; return 'Made on the Custom page · ' + (o.unit ? o.unit + ' · ' : '') + (o.green === null ? 'no target' : 'target ' + (o.dir === 'Lower' ? '≤ ' : '≥ ') + E.fmt(o.green)); }
    if (c.ratio || c.k === 'str') return catTargetText(c, { population: null });
    if (c.k === 'ham' || c.k === 'acl') return REHAB_LABEL[c.k] + ' · ' + (c.def.calc === 'LSI' ? 'left & right → LSI %' : scoreUnit(c.unit) || 'score') + ' · targets by rehab phase';
    var p = bld.edit.pop;
    if (p && p !== 'general' && E.sportPopulations(DATA.screen).indexOf(p) >= 0) return catTargetText(c, { population: p, ageBand: 'All ages', label: p });
    var unit = scoreUnit(c.unit);
    return (unit ? unit + ' · ' : '') + (p === 'general' ? 'general norms by sex and age' : 'norms for the population chosen');
  }
  function bldOnKeys() { var e = bld.edit; return bldEntries().filter(function (c) { return e.on[c.key]; }); }
  function bldHasScreen() { return bldOnKeys().some(function (c) { return c.k === 'screen'; }); }
  function bldCountText() { var n = bldOnKeys().length; return n ? '(' + n + (n === 1 ? ' test)' : ' tests)') : ''; }
  function bldCatHtml() {
    var q = bld.q, e = bld.edit, html = '', last = null, shown = 0;
    bldEntries().forEach(function (c) {
      if (!catMatches(c.name, q)) return;
      if (c.group !== last) { html += '<li class="cat-group" aria-hidden="true">' + esc(c.glabel || groupTitle(c.group)) + '</li>'; last = c.group; }
      html += '<li><label class="tests-row cat-row"><input type="checkbox" data-bcat="' + esc(c.key) + '"' + (e.on[c.key] ? ' checked' : '') + '>' +
        '<span class="tr-main"><span class="tr-t">' + esc(c.name) + '</span><span class="tr-n">' + esc(bldSub(c)) + '</span></span></label></li>';
      shown++;
    });
    return shown ? html : '<li class="cat-none">No tests match “' + esc(clean1(q)) + '”. + New test adds it, with your target.</li>';
  }
  function bldChosenHtml() {
    var rows = bldOnKeys(), html = '', last = null;
    if (!rows.length) return '<li class="bld-empty">No tests yet. Tick them in the list above, or make a new one with + New test.</li>';
    rows.forEach(function (c) {
      if (c.group !== last) { html += '<li class="bc-group" aria-hidden="true">' + esc(c.glabel || groupTitle(c.group)) + '</li>'; last = c.group; }
      html += '<li class="bc-row"><span class="bc-t"><b>' + esc(c.name) + '</b><small>' + esc(bldSub(c)) + '</small></span>' +
        '<button type="button" class="quiet bc-rm" data-bld="rm:' + esc(c.key) + '">Remove<span class="vh"> ' + esc(c.name) + '</span></button></li>';
    });
    if (rows.some(function (c) { return c.k === 'own'; })) html += '<li class="bld-note">Saving makes the tests made on the Custom page the clinic’s own tests: the target stays, and so does the Close typed with it (as a % of the target; none typed: the clinic’s ' + ltFmt(closePct()) + '%).</li>';
    return html;
  }
  function builderHtml() {
    if (bld.view === 'bat' && bld.edit) return bldEditHtml();
    var bats = batList(), tests = ltList(), pct = closePct(), strPct = DATA.str.amber_pct == null ? 5 : DATA.str.amber_pct;
    var html = subHeadHtml('Battery builder', 'The clinic’s own batteries, each with its own tile on the Screening page, and tests the app doesn’t have, each rated against the target you set.', 'data-home="hub:screening"', 'Screening');
    html += '<section class="bld-sec" aria-labelledby="bldBatsH"><div class="bld-head"><h2 id="bldBatsH">Batteries</h2><button type="button" class="primary" data-bld="newbat">+ New battery</button></div>' +
      (bats.length ? '<div class="tpl-list bld-list">' + bats.map(function (b) {
        var nm = esc(b.name), upd = tplUpdLine(b), sub = batteryLineFor(b.items) + ' · ' + batPopLabel(b) + (b.tile ? '' : ' · not on the Screening page');
        return '<div class="tpl-row" data-bat="' + esc(b.id) + '"><div class="tpl-main"><b>' + nm + '</b><span>' + esc(sub) + '</span>' + (b.about ? '<span class="tpl-upd">' + esc(b.about) + '</span>' : '') +
          (upd ? '<span class="tpl-upd">' + esc(upd) + '</span>' : '') + '</div>' +
          '<div class="tpl-acts"><button type="button" class="ghost" data-bld="edit:' + esc(b.id) + '">Edit<span class="vh"> ' + nm + '</span></button></div></div>';
      }).join('') + '</div>' : '<p class="client-none bld-none">No batteries yet. + New battery picks its tests (any of the app’s, or tests of your own) and gives it a tile on the Screening page.</p>') + '</section>';
    html += '<section class="bld-sec" aria-labelledby="bldTestsH"><div class="bld-head"><h2 id="bldTestsH">The clinic’s tests</h2><button type="button" class="ghost" data-bld="newtest">+ New test</button></div>' +
      (tests.length ? '<div class="tpl-list bld-list">' + tests.map(function (tt) {
        var nm = esc(tt.name), cat = catLabel(tt.type || '', tt.region || '');
        return '<div class="tpl-row" data-test="' + esc(tt.id) + '"><div class="tpl-main"><b>' + nm + '</b><span>' + esc(ltHow(tt)) + '</span><span>' + esc(ltTargetLine(tt)) + '</span><span class="tpl-upd">' + esc(cat) + '</span></div>' +
          '<div class="tpl-acts"><button type="button" class="ghost" data-bld="test:' + esc(tt.id) + '">Edit<span class="vh"> ' + nm + '</span></button></div></div>';
      }).join('') + '</div>' : '<p class="client-none bld-none">No tests of your own yet. + New test adds one: what it is measured in, whether higher or lower is better, one value or each leg, and its target (as measured, or relative to body weight).</p>') + '</section>';
    var eg = 'With a target of 100 (higher is better): On target 100 or more · Close ' + ltFmt(100 - pct) + ' to 100 · Off target below ' + ltFmt(100 - pct) + '.';
    html += '<section class="bld-sec bld-close" aria-labelledby="bldCloseH"><h2 id="bldCloseH" class="bld-h">Traffic lights</h2>' +
      '<p class="bld-lead">For every test made here: <b>On target</b> at or beyond its target, <b>Close</b> within this % of it, <b>Off target</b> further away. One setting for the clinic; a test can have its own % instead (set in the test), and LL Strength keeps its own ' + esc(ltFmt(strPct)) + '%.</p>' +
      '<div class="bld-pct"><label class="f" for="bldPct"><span>Close is within (% of the target)</span><input id="bldPct" type="text" inputmode="decimal" autocomplete="off" value="' + esc(ltFmt(pct)) + '" enterkeyhint="done"></label>' +
      '<button type="button" class="ghost" data-bld="pct">Save</button></div>' +
      '<p class="bld-eg" id="bldEg">' + esc(eg) + '</p><p class="ai-err" id="bldPctErr" role="alert" hidden></p></section>';
    return html;
  }
  function bldEditHtml() {
    var e = bld.edit, hasScreen = bldHasScreen();
    var pops = [['', 'Ask each time it starts'], ['general', 'General population (by sex and age)']].concat(E.sportPopulations(DATA.screen).map(function (p) { return [p, p]; }));
    var html = subHeadHtml(e.isNew ? 'New battery' : 'Edit battery', e.isNew ? 'Name it, tick its tests (or make new ones), then save. It gets its own tile on the Screening page.' : '', 'data-bld="cancel"', bld.from === 'page' ? 'Back' : 'Battery builder');
    html += '<section class="card bld-card" aria-labelledby="bldDetH"><h2 id="bldDetH" class="bld-h">The battery</h2><div class="bld-fields">' +
      '<label class="f wide" for="bldName"><span>Name</span><input id="bldName" type="text" maxlength="80" autocapitalize="sentences" autocomplete="off" placeholder="e.g. Netball pre-season" value="' + esc(e.name) + '" enterkeyhint="next"></label>' +
      '<label class="f wide" for="bldAbout"><span>About (optional: the line on its tile)</span><input id="bldAbout" type="text" maxlength="140" autocapitalize="sentences" autocomplete="off" placeholder="e.g. The squad’s pre-season screen" value="' + esc(e.about) + '" enterkeyhint="done"></label>' +
      '<label class="f wide" for="bldPop" id="bldPopF"' + (hasScreen ? '' : ' hidden') + '><span>Compare the Performance screen tests against</span><select id="bldPop">' +
      pops.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (e.pop === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="bld-tick" for="bldTile"><input id="bldTile" type="checkbox"' + (e.tile ? ' checked' : '') + '><span>Show it on the Screening page</span></label></div></section>';
    html += '<section class="card bld-card" aria-labelledby="bldAddH"><div class="bld-head"><h2 id="bldAddH" class="bld-h">Add tests</h2><button type="button" class="ghost" data-bld="newtest">+ New test</button></div>' +
      '<p class="bld-lead">The app’s tests by type and region, and the clinic’s own. A test the app doesn’t have: + New test, with its target.</p>' +
      '<label class="client-search" for="bldFind">' + HOME_ICON.search + '<span class="vh">Search tests</span><input id="bldFind" type="search" placeholder="Search tests" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" value="' + esc(bld.q) + '"></label>' +
      '<ul class="tests-list cat-list bld-cat" id="bldCat">' + bldCatHtml() + '</ul></section>';
    html += '<section class="card bld-card" aria-labelledby="bldInH"><h2 id="bldInH" class="bld-h">In this battery <span class="bld-n" id="bldCount">' + esc(bldCountText()) + '</span></h2>' +
      '<ul class="bld-chosen" id="bldChosen">' + bldChosenHtml() + '</ul></section>';
    html += '<p class="ai-err bld-err" id="bldErr" role="alert"' + (bld.err ? '' : ' hidden') + '>' + esc(bld.err) + '</p>' +
      '<div class="bld-acts"><button type="button" class="primary" data-bld="save">Save battery</button><button type="button" class="ghost" data-bld="cancel">Cancel</button>' +
      (e.isNew ? '' : '<button type="button" class="quiet tpl-del bld-del' + (bld.delArmed ? ' armed' : '') + '" data-bld="delbat">' + (bld.delArmed ? 'Tap again to delete' : 'Delete battery') + '</button>') + '</div>';
    return html;
  }
  // the parts of the editor that follow a tick, drawn in place (the list stays where it is under the finger)
  function bldRefreshParts() {
    var cnt = $('bldCount'), ch = $('bldChosen'), pf = $('bldPopF');
    if (cnt) cnt.textContent = bldCountText();
    if (ch) ch.innerHTML = bldChosenHtml();
    if (pf) pf.hidden = !bldHasScreen();
    hsubDrawn = builderHtml();
  }
  function bldToggle(key, on) {                        // as Choose tests: the hip ratio comes with its two hip tests
    var e = bld.edit;
    if (!e) return;
    var rt = ratioTest(), rk = 'str|' + RATIO_ID;
    if (on) {
      e.on[key] = true;
      if (key === rk && rt) rt.from.forEach(function (id) { e.on['str|' + id] = true; });
    } else {
      delete e.on[key];
      if (rt && rt.from.some(function (id) { return key === 'str|' + id; })) delete e.on[rk];
    }
    e.dirty = true;
    bld.err = '';
    var err = $('bldErr');
    if (err) err.hidden = true;
    document.querySelectorAll('#bldCat input[data-bcat]').forEach(function (x) { x.checked = !!e.on[x.dataset.bcat]; });
    bldRefreshParts();
  }
  function bldFail(msg, focusId) {
    bld.err = msg;
    var p = $('bldErr');
    if (p) { p.textContent = msg; p.hidden = false; }
    hsubDrawn = builderHtml();
    focusQuiet((focusId && $(focusId)) || p);
    return false;
  }
  function bldSave() {
    var e = bld.edit;
    if (!e) return;
    var name = cap(e.name, 80);
    if (!name) return bldFail('Give the battery a name.', 'bldName');
    var k = E.libKey(name), dup = batList().filter(function (b) { return b.id !== e.id && E.libKey(b.name) === k; })[0];
    if (dup) return bldFail('There is already a battery called ' + dup.name + '. Give this one another name.', 'bldName');
    var items = [], made = [];
    bldOnKeys().forEach(function (c) {
      if (c.k === 'screen') items.push({ k: 'screen', key: c.name });
      else if (c.k === 'str') items.push({ k: 'str', id: c.def.id });
      else if (c.k === 'ham' || c.k === 'acl') items.push({ k: c.k, key: c.name });
      else if (c.k === 'lib') items.push({ k: 'lib', id: c.def.id });
      else if (c.k === 'own') {                        // made on the Custom page: one of the clinic's tests from now on
        var tt = ltByName(c.own.name) || made.filter(function (x) { return E.libKey(x.name) === E.libKey(c.own.name); })[0] || ownToLib(c.own);
        if (!tt) return;
        if (!ltGet(tt.id) && made.indexOf(tt) < 0) made.push(tt);
        items.push({ k: 'lib', id: tt.id });
      }
    });
    if (!items.length) return bldFail('Tick at least one test.', 'bldFind');
    made.forEach(function (tt) { writeItem('batteries', tt.id, tt); });
    items = tidyBattery(items);
    var hasScreen = items.some(function (it) { return it.k === 'screen'; });
    var b = { id: e.id || newId('b-'), name: name, items: items, pop: hasScreen ? e.pop : 'none', tile: !!e.tile, about: cap(e.about, 140), updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() };
    var was = e.id ? batGet(e.id) : null, ok = writeItem('batteries', b.id, b);
    bldApplyToPage(b);
    var from = bld.from;
    bld = freshBld();
    toast(ok ? 'Saved ' + b.name + (b.tile ? (was && was.tile ? '' : ': its tile is on the Screening page') : '') : 'This device wouldn’t save the battery (storage is full or blocked).');
    bldLeave(from, '[data-bld="edit:' + b.id + '"]');
  }
  function bldLeave(from, focusSel) {                  // back from the editor: to the battery's page, or the builder's list
    if (from === 'page') { setHomeSub(''); openTool('custom', null); return; }
    renderHome();
    window.scrollTo(0, 0);
    focusQuiet((focusSel && els.homeSec.querySelector(focusSel)) || $('hsubH'));
  }
  function bldCancel() {
    var keep = bld, e = bld.edit;
    bld = freshBld();
    if (e && e.dirty) toast('Changes to ' + (clean1(e.name) || 'the new battery') + ' not saved', { label: 'Undo', run: function () {
      bld = keep; keep.from = '';
      openHomeSub('builder');
    } });
    bldLeave(keep.from, e && e.id ? '[data-bld="edit:' + e.id + '"]' : '[data-bld="newbat"]');
  }
  function bldDeleteTap() {
    var e = bld.edit, b = e && e.id ? batGet(e.id) : null;
    if (!b) return;
    if (!bld.delArmed) {
      bld.delArmed = true;
      renderHome();
      focusQuiet(els.homeSec.querySelector('[data-bld="delbat"]'));
      clearTimeout(bldDelTimer);
      bldDelTimer = setTimeout(function () { if (bld.delArmed) { bld.delArmed = false; if (homeView && homeSub === 'builder') renderHome(); } }, 4000);
      return;
    }
    clearTimeout(bldDelTimer);
    writeItem('batteries', b.id, null);
    var from = bld.from;
    bld = freshBld();
    toast('Deleted ' + b.name, { label: 'Undo', run: function () { writeItem('batteries', b.id, b); afterBatChange(); } });
    bldLeave(from === 'page' ? '' : from, '[data-bld="newbat"]');
  }
  function bldPctSave() {
    var inp = $('bldPct'), err = $('bldPctErr'), p = inp ? E.parseInput(inp.value) : null;
    if (p === null || p < 1 || p > 50) { if (err) { err.textContent = 'Type a % from 1 to 50.'; err.hidden = false; } if (inp) inp.focus(); return; }
    p = closeClamp(p);
    var was = closePct();
    if (err) err.hidden = true;
    if (p !== was) writeItem('batteries', CLOSE_ID, { id: CLOSE_ID, name: 'Traffic lights', pct: p, updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() });
    afterBatChange();
    toast('Close is within ' + ltFmt(p) + '% of the target for every test made here without its own %', p !== was ? { label: 'Undo', run: function () {
      writeItem('batteries', CLOSE_ID, { id: CLOSE_ID, name: 'Traffic lights', pct: was, updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() });
      afterBatChange();
    } } : null);
  }
  function onBuilderClick(k) {
    var i = k.indexOf(':'), kind = i < 0 ? k : k.slice(0, i), arg = i < 0 ? '' : k.slice(i + 1);
    if (kind === 'newbat' || kind === 'edit') { bldStartEdit(kind === 'edit' ? arg : '', ''); renderHome(); window.scrollTo(0, 0); focusQuiet($('hsubH')); return; }
    if (kind === 'newtest') { openTestDialog(''); return; }
    if (kind === 'test') { openTestDialog(arg); return; }
    if (kind === 'pct') { bldPctSave(); return; }
    if (!bld.edit) return;
    if (kind === 'rm') { bldToggle(arg, false); focusQuiet(els.homeSec.querySelector('#bldChosen .bc-rm') || $('bldInH')); return; }
    if (kind === 'save') { bldSave(); return; }
    if (kind === 'cancel') { bldCancel(); return; }
    if (kind === 'delbat') bldDeleteTap();
  }
  function onBuilderInput(el) {
    var e = bld.edit;
    if (el.id === 'bldFind') { bld.q = el.value.slice(0, 80); var box = $('bldCat'); if (box) box.innerHTML = bldCatHtml(); hsubDrawn = builderHtml(); return; }
    if (!e) return;
    if (el.id === 'bldName' || el.id === 'bldAbout') {
      e[el.id === 'bldName' ? 'name' : 'about'] = el.value.slice(0, el.id === 'bldName' ? 80 : 140);
      e.dirty = true;
      if (bld.err) { bld.err = ''; var p = $('bldErr'); if (p) p.hidden = true; }
      hsubDrawn = builderHtml();
    }
  }
  function onBuilderChange(el) {
    var e = bld.edit;
    if (!e) return false;
    if (el.matches('input[data-bcat]')) { bldToggle(el.dataset.bcat, el.checked); return true; }
    if (el.id === 'bldTile') { e.tile = el.checked; e.dirty = true; hsubDrawn = builderHtml(); return true; }
    if (el.id === 'bldPop') {                          // the screen tests' targets follow the population chosen
      e.pop = el.value; e.dirty = true;
      var box = $('bldCat'); if (box) box.innerHTML = bldCatHtml();
      bldRefreshParts();
      return true;
    }
    return false;
  }

  // ---- the test editor (#testDialog): a test the app doesn't have, with its target
  var ltEdit = null;                                   // { id ('' new), was: the test as it was, dir, legs, bySex, armed }
  function ltErr(msg) { var p = $('ltErr'); p.textContent = msg || ''; p.hidden = !msg; }
  function ltFail(msg, id) { ltErr(msg); if (id && $(id)) $(id).focus(); return false; }
  function ltReadUnit() { var u = $('ltUnit').value; return u === 'other' ? cap($('ltUnitOther').value, 12) : u; }
  function ltScoreOptions(cur) {
    var u = $('ltUnit').value, sel = $('ltScore'), opts = null;
    if (u === 'N') opts = [['', 'N, as measured (gross force)'], ['pctbw', '% of body weight'], ['xbw', '× body weight'], ['perkg', 'N per kg of body mass']];
    else if (u === 'kg') opts = [['', 'kg, as measured (gross load)'], ['pctbw', '% of body weight'], ['xbw', '× body weight']];
    $('ltScoreF').hidden = !opts;
    sel.dataset.for = u;
    sel.innerHTML = opts ? opts.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') : '';
    if (opts) sel.value = opts.some(function (o) { return o[0] === cur; }) ? cur : '';
  }
  function ltDraft() {                                 // the form as a test (unchecked)
    var unit = ltReadUnit(), score = $('ltScoreF').hidden ? '' : $('ltScore').value;
    var own = ownNum($('ltPct').value);
    return { unit: unit, score: ltScoreOk(unit, score) ? score : '', dir: ltEdit.dir, legs: ltEdit.legs, bySex: ltEdit.bySex,
      target: ownNum($('ltTarget').value), targetM: ownNum($('ltTargetM').value), targetF: ownNum($('ltTargetFe').value),
      closePct: own !== null && own >= 1 && own <= 90 ? own : null };   // v43: its own Close % (blank: the clinic's)
  }
  function ltBandsHtml(d) {
    var p = ltPct(d), su = ltUnit(d), low = d.dir === 'Lower';
    function one(g, who) {
      if (g === null) return '';
      var c = ltClose(d, g, p);
      return '<span class="lt-line">' + (who ? '<b>' + who + '</b> ' : '') + '<span class="lt-g">On target ' + (low ? '≤ ' : '≥ ') + esc(ltWithUnit(g, su)) + '</span> · ' +
        '<span class="lt-a">Close ' + esc(low ? ltFmt(g) + ' to ' + ltFmt(c) : ltFmt(c) + ' to ' + ltFmt(g)) + '</span> · <span class="lt-r">Off target ' + (low ? 'above ' : 'below ') + esc(ltFmt(c)) + '</span></span>';
    }
    var lines = d.bySex ? [one(d.targetM, 'Male'), one(d.targetF, 'Female')].filter(Boolean) : [one(d.target, '')].filter(Boolean);
    var html = lines.length ? lines.join('') : '<span class="lt-line">No target: the results are kept and compared over time, not rated.</span>';
    if (d.score) html += '<span class="lt-line lt-how">You type the ' + (d.unit === 'N' ? 'force in N' : 'load in kg') + '; the app works it out as ' + esc(LT_SCORE[d.score]) + ' from the body mass on the page.</span>';
    if (d.legs) html += '<span class="lt-line lt-how">Each leg is rated, and the difference between the legs is shown.</span>';
    return html + '<span class="lt-line lt-how">' + (d.closePct != null ? 'Close = within ' + esc(ltFmt(p)) + '% of the target: this test’s own rule (blank it for the clinic’s ' + esc(ltFmt(closePct())) + '%).'
      : 'Close = within ' + esc(ltFmt(p)) + '% of the target: the clinic’s rule (Traffic lights, in the Battery builder), unless you give this test its own %.') + '</span>';
  }
  function ltSync() {
    if (!ltEdit) return;
    var u = $('ltUnit').value;
    $('ltUnitOtherF').hidden = u !== 'other';
    if (($('ltScore').dataset.for || '') !== u) ltScoreOptions($('ltScore').value);
    els.testDialog.querySelectorAll('[data-lt-dir]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.ltDir === ltEdit.dir)); });
    els.testDialog.querySelectorAll('[data-lt-legs]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.ltLegs === 'each') === ltEdit.legs)); });
    els.testDialog.querySelectorAll('[data-lt-sex]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.ltSex === 'sex') === ltEdit.bySex)); });
    var d = ltDraft(), su = ltUnit(d), w = su && su !== 'score' ? ' (' + su + ')' : '';
    $('ltTargetF').hidden = d.bySex; $('ltTargetMF').hidden = !d.bySex; $('ltTargetFF').hidden = !d.bySex;
    $('ltTargetW').textContent = 'Target' + w + ', optional';
    $('ltTargetMW').textContent = 'Male target' + w;
    $('ltTargetFW').textContent = 'Female target' + w;
    $('ltBands').innerHTML = ltBandsHtml(d);
  }
  function openTestDialog(id) {
    var tt = id ? ltGet(id) : null;
    if (id && !tt) return;
    ltEdit = { id: tt ? tt.id : '', was: tt, dir: tt ? tt.dir : 'Higher', legs: tt ? tt.legs : false, bySex: tt ? tt.bySex : false, armed: false };
    $('testTitle').textContent = tt ? 'Edit test' : 'New test';
    $('testLead').textContent = tt ? 'Changes apply wherever it is used. Results already saved keep their values.'
      : 'A test the app doesn’t have. It can go in any battery and in Custom’s Choose tests, rated against your target.';
    $('ltName').value = tt ? tt.name : (bld.view === 'bat' && bld.edit ? clean1(bld.q) : '');   // what was searched for, as its name
    var known = tt ? LT_UNITS.some(function (u) { return u[0] !== 'other' && u[0] === tt.unit; }) : false;
    $('ltUnit').value = tt ? (known ? tt.unit : 'other') : '';
    $('ltUnitOther').value = tt && !known ? tt.unit : '';
    ltScoreOptions(tt ? tt.score : '');
    $('ltType').value = tt && tt.type ? tt.type : '';
    $('ltRegion').value = tt && tt.region ? tt.region : '';
    $('ltTarget').value = tt && tt.target !== null ? ltFmt(tt.target) : '';
    $('ltTargetM').value = tt && tt.targetM !== null ? ltFmt(tt.targetM) : '';
    $('ltTargetFe').value = tt && tt.targetF !== null ? ltFmt(tt.targetF) : '';
    $('ltPct').value = tt && tt.closePct != null ? ltFmt(tt.closePct) : '';   // v43: its own Close % (blank: the clinic's)
    $('ltPct').placeholder = ltFmt(closePct()) + ' (the clinic’s)';
    $('ltWhat').value = tt ? tt.what : '';
    $('ltHow').value = tt ? tt.how : '';
    var del = $('ltDelete');
    del.hidden = !tt; del.classList.remove('armed'); del.textContent = 'Delete test';
    ltErr('');
    ltSync();
    var back = tt ? '[data-bld="test:' + tt.id + '"]' : '[data-bld="newtest"]';
    openModal(els.testDialog, tt ? $('ltName') : ($('ltName').value ? $('ltUnit') : $('ltName')), function (restore) {
      ltEdit = null;
      if (restore) focusQuiet(els.homeSec.querySelector(back) || $('hsubH'));
      return true;
    });
  }
  function ltSave() {
    if (!ltEdit) return;
    var name = cap($('ltName').value, 80);
    if (!name) return ltFail('Give the test a name.', 'ltName');
    var inCat = catalogueByName(name);
    if (inCat && inCat.k !== 'lib') return ltFail(inCat.name + ' is already one of the app’s tests: tick it in the list instead.', 'ltName');
    var dup = ltByName(name, ltEdit.id);
    if (dup) return ltFail('There is already a test called ' + dup.name + '.', 'ltName');
    if (!$('ltUnit').value) return ltFail('Choose what it is measured in.', 'ltUnit');
    var d = ltDraft(), boxes = d.bySex ? [['ltTargetM', 'The male target'], ['ltTargetFe', 'The female target']] : [['ltTarget', 'The target']];
    for (var i = 0; i < boxes.length; i++) if (!blank($(boxes[i][0]).value) && ownNum($(boxes[i][0]).value) === null) return ltFail(boxes[i][1] + ' should be a number.', boxes[i][0]);
    var ownP = ownNum($('ltPct').value);
    if (!blank($('ltPct').value) && (ownP === null || ownP < 1 || ownP > 90)) return ltFail('Close should be a % from 1 to 90, or blank for the clinic’s ' + ltFmt(closePct()) + '%.', 'ltPct');
    // renamed (letter for letter: the results are kept under the name as it was): results under the old name still count
    var was = ltEdit.was, names = was ? (was.was || []).slice() : [];
    if (was && was.name !== name) names.unshift(was.name);
    var tt = tidyLibTest(Object.assign({ id: ltEdit.id || newId('bt-'), kind: 'test', name: name, type: $('ltType').value, region: $('ltRegion').value, what: $('ltWhat').value, how: $('ltHow').value,
      was: names.filter(function (x, i) { return x !== name && names.indexOf(x) === i; }), updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() }, d));
    if (!tt) return ltFail('That test couldn’t be saved.', null);
    var isNew = !ltEdit.id, inEditor = isNew && bld.view === 'bat' && !!bld.edit;
    var ok = writeItem('batteries', tt.id, tt);
    if (inEditor) { bld.edit.on['lib|' + tt.id] = true; bld.edit.dirty = true; bld.q = ''; }
    closeModal(false);
    afterBatChange();
    toast(!ok ? 'This device wouldn’t save the test (storage is full or blocked).' : (isNew ? 'Added ' + tt.name + (inEditor ? ', ticked in this battery' : '') : 'Saved ' + tt.name));
    focusQuiet(els.homeSec.querySelector(inEditor ? '#bldInH' : '[data-bld="test:' + tt.id + '"]') || $('hsubH'));
  }
  function ltDeleteTap() {
    var tt = ltEdit && ltEdit.was, btn = $('ltDelete');
    if (!tt) return;
    var users = batList().filter(function (b) { return b.items.some(function (it) { return it.k === 'lib' && it.id === tt.id; }); });
    if (!ltEdit.armed) {
      ltEdit.armed = true;
      btn.classList.add('armed');
      btn.textContent = 'Tap again to delete';
      ltErr(users.length ? 'It is in ' + andList(users.map(function (b) { return b.name; })) + ': deleting it takes it out of ' + (users.length === 1 ? 'that battery' : 'those batteries') + ' too. Results already saved stay in the records.' : '');
      return;
    }
    var restore = users.map(function (b) { return JSON.parse(JSON.stringify(b)); });
    writeItem('batteries', tt.id, null);
    users.forEach(function (b) { writeItem('batteries', b.id, Object.assign({}, b, { items: b.items.filter(function (it) { return !(it.k === 'lib' && it.id === tt.id); }) })); });
    if (bld.edit) delete bld.edit.on['lib|' + tt.id];
    closeModal(false);
    afterBatChange();
    toast('Deleted ' + tt.name, { label: 'Undo', run: function () {
      writeItem('batteries', tt.id, tt);
      restore.forEach(function (b) { writeItem('batteries', b.id, b); });
      afterBatChange();
    } });
    focusQuiet(els.homeSec.querySelector('[data-bld="newtest"]') || $('hsubH'));
  }
  function wireBuilder() {
    els.testDialog = $('testDialog');
    $('ltUnit').innerHTML = '<option value="">Choose…</option>' + LT_UNITS.map(function (u) { return '<option value="' + esc(u[0]) + '">' + esc(u[1]) + '</option>'; }).join('');
    $('ltType').innerHTML = '<option value="">Other</option>' + CAT_TYPES.map(function (t) { return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('');
    $('ltRegion').innerHTML = '<option value="">Not set</option>' + CAT_REGIONS.map(function (r) { return '<option value="' + r[0] + '">' + esc(r[1]) + '</option>'; }).join('');
    els.testDialog.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (e.target === els.testDialog) { closeModal(); return; }
      if (!b || !ltEdit) return;
      if (b.dataset.ltDir) { ltEdit.dir = b.dataset.ltDir === 'Lower' ? 'Lower' : 'Higher'; ltSync(); }
      else if (b.dataset.ltLegs) { ltEdit.legs = b.dataset.ltLegs === 'each'; ltSync(); }
      else if (b.dataset.ltSex) { ltEdit.bySex = b.dataset.ltSex === 'sex'; ltSync(); }
      else if (b.id === 'ltSave') ltSave();
      else if (b.id === 'ltCancel') closeModal();
      else if (b.id === 'ltDelete') ltDeleteTap();
    });
    ['ltUnit', 'ltScore', 'ltType', 'ltRegion'].forEach(function (id) { $(id).addEventListener('change', function () { ltErr(''); ltSync(); }); });
    ['ltName', 'ltUnitOther', 'ltTarget', 'ltTargetM', 'ltTargetFe', 'ltPct', 'ltWhat', 'ltHow'].forEach(function (id) {
      $(id).addEventListener('input', function () { ltErr(''); if (ltEdit && ltEdit.armed) { ltEdit.armed = false; $('ltDelete').classList.remove('armed'); $('ltDelete').textContent = 'Delete test'; } ltSync(); });
    });
    ['ltName', 'ltUnitOther', 'ltTarget', 'ltTargetM', 'ltTargetFe', 'ltPct'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ltSave(); } });
    });
  }

  // v14: the two tabs in the bar (Screening holds the four tools, Exercises the program builder); inside Screening the
  // page heading is the tool picker: a menu button listing the tools, the current one ticked
  var TOOL_BLURB = {
    screen: 'ForceDecks, NordBord, ForceFrame, DynaMo and SmartSpeed results against the norms for age & sex or sport.',
    str: 'Each leg\u2019s load, force or reps: asymmetry and capacity against the targets.',
    ham: 'Injured-limb results against the targets for the chosen rehab phase.',
    acl: 'Injured-limb and symmetry results against ACLR norms for the phase and sex.',
    ankle: 'Lateral ankle sprain: four tests and three questionnaires, scored out of 25 on the injured leg.',   // v42
    custom: 'Any mix of the screen, LL Strength and rehab tests (or your own), built by hand or from a photo of your notes.'   // v36; v37: the rehab tests too
  };
  // v15: the Exercises tab's heading is the same picker, listing its three pages (data-page on the button; the items
  // are #pick-ex-<page> with data-pick-page). Only one picker is ever on screen, so the ids are shared.
  function pickHtml(t) {
    var ex = t === 'ex', cur = ex ? state.exPage : t, keys = ex ? EX_PAGES : TOOLS;
    // v43: the clinic's batteries (their tiles) after Custom: 'bat:<id>'; Custom is ticked only on the spot
    var run = ex ? '' : state.custom.batId || '', bats = ex ? [] : tileBats();
    if (!ex && run && !bats.some(function (b) { return b.id === run; }) && runBat()) bats.push(runBat());
    if (!ex && bats.length) keys = keys.concat(bats.map(function (b) { return 'bat:' + b.id; }));
    var curKey = ex ? cur : t === 'custom' && run ? 'bat:' + run : t;
    return '<div class="pick-wrap"><h1 class="pick-h"><button type="button" class="tool-pick" id="toolPick" data-tool="' + t + '"' + (ex ? ' data-page="' + cur + '"' : '') +
      ' aria-haspopup="menu" aria-expanded="false" aria-controls="toolMenu" title="' + (ex ? 'Choose an Exercises page' : 'Choose a screening tool') + '">' +
      '<span class="pick-text">' + esc(ex ? EX_PAGE_TITLE[cur] : toolHead(t)) + '</span>' +
      '<span class="pick-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span></button></h1>' +
      '<div class="menu tool-menu" id="toolMenu" role="menu" aria-label="' + (ex ? 'Exercises pages' : 'Screening tools') + '" hidden>' +
      keys.map(function (k) {
        var b = k.indexOf('bat:') === 0 ? batGet(k.slice(4)) : null;
        return '<button type="button" class="menu-item tool-item" id="pick-' + (ex ? 'ex-' : '') + (b ? b.id : k) + '" role="menuitemradio" aria-checked="' + (k === curKey) + '" ' + (ex ? 'data-pick-page' : 'data-pick') + '="' + esc(k) + '" tabindex="-1">' +
          '<svg class="ti-tick" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' +
          '<span class="ti-text"><b>' + esc(ex ? EX_PAGE_TITLE[k] : b ? b.name : HEAD[k][0]) + '</b><small>' + esc(ex ? exPageBlurb(k) : b ? batTileLine(b) : TOOL_BLURB[k]) + '</small></span></button>';
      }).join('') + '</div></div>';
  }
  // v30: the page in use is drawn even while Home shows (hidden underneath), so every refresh keeps working; Home redraws too
  function render() {
    renderPage();
    if (homeView) renderHome();
  }
  function renderPage() {
    var t = state.tool;
    syncTabs();
    followReport();                                    // v19: a linked program shows the report's name and date
    if (t === 'ex') { renderExPage(); return; }
    if (t === 'custom' && state.custom.pop === null) {   // v36: the population first, nothing else until it is chosen
      els.entry.innerHTML = '<div class="pagehead">' + pickHtml(t) + '<p>' + esc(toolBlurb(t)) + '</p></div>' + popStepHtml();
      document.documentElement.classList.remove('has-strip');
      renderSummary(compute());
      saveDraft();
      return;
    }
    if (t === 'custom') pageShape = customShape();     // v43
    els.entry.innerHTML = '<div class="pagehead">' + pickHtml(t) + '<p>' + esc(toolBlurb(t)) + '</p></div>' + athleteCard() + (t === 'custom' ? batteryBarHtml() : testsBarHtml(t)) +
      (t === 'str' ? strengthGroupHtml() : t === 'ankle' ? agoGroupsHtml() : groupsHtml(t)) + (t === 'custom' ? batteryEmptyHtml() : '') + (t === 'acl' ? rtsCardHtml() : '') + (t === 'ankle' ? agoCardHtml() : '') + coachCardHtml() + interpCardHtml() +
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
    var colour = { Green: 'var(--zone-green)', Amber: 'var(--zone-amber)', Red: 'var(--zone-red)', Guide: 'var(--zone-guide)' };   // v28: Guide (the DSI), neutral
    var html = '<span class="mm-bar">' + m.segments.map(function (sg, i) { return '<span style="width:' + sg.width.toFixed(2) + '%;background:' + colour[sg.color] + (sg.color === 'Guide' && i ? ';box-shadow:inset 2px 0 0 var(--surface)' : '') + '"></span>'; }).join('') + '</span>';
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
    if (state.tool === 'custom' && state.custom.pop === null) { renderSummary(compute()); return; }   // v41: only the population step is drawn (a sync or a photo read meanwhile)
    var t = state.tool, c = compute();
    applyRetest(false);
    refreshClientBar(c);
    personWords(t);                                    // v49: Athlete as soon as a sport is typed or a sport population chosen
    syncCard(c);
    var showPrev = prevShown(t), ap = $('addPrev');   // v18: the Previous column, or + Add previous results
    els.entry.classList.toggle('no-prev', !showPrev);
    if (ap) ap.hidden = showPrev;
    if (t === 'str') { refreshStrength(c); showTypo(typoFlags(t, c)); renderSummary(c); renderInterpState(c); saveDraft(); return; }
    if (t === 'ankle') { refreshAnkle(c); showTypo(typoFlags(t, c)); renderSummary(c); renderInterpState(c); saveDraft(); return; }   // v42
    var S = setOf(t);
    if (t === 'custom') refreshBattery(c);              // v36: the battery bar's count and the empty state
    // context note under the athlete card
    var note = $('ctxNote');
    if (SL(t)) {
      note.hidden = false;
      note.className = 'note' + (c.pop.level === 'warn' ? ' warn' : '');
      // one short line (v11): the general norms say which band was picked ('Norms: Male, 20–30 yr.'); IMTP and DSI have no bands
      var gen = !!c.pop.population && c.pop.population.indexOf('General Clinical') === 0;
      note.textContent = (gen ? c.pop.note.replace(/^Auto-selected: /, 'Norms: ').replace(/(\d)-(\d)/g, '$1–$2') : c.pop.note).replace(/([^.])$/, '$1.') +
        (gen && c.pop.ageBand !== 'All ages' ? ' IMTP and DSI use all-ages norms.' : '') +
        (t === 'custom' && c.pop.population && S.groups.some(function (g) { return g.metrics.some(function (m) { return m.str; }); }) ? ' Strength tests are scored relative to body mass.' : '');   // v38: wherever they sit
      var rneed = t === 'custom' ? customRehabNeed() : '', rinfo = t === 'custom' ? customRehabInfo() : null;   // v37: the rehab tests
      if (rneed) { note.className = 'note warn'; note.textContent += ' ' + rneed + ' to score ' + (t === 'custom' && customSexNeed() && state.custom.pop !== 'general' ? 'every test' : 'the rehab tests') + '.'; }
      else if (rinfo) note.textContent += ' Rehab tests against the typical case at ' + andList([rinfo.ham ? 'the hamstring phase ' + rinfo.ham : '', rinfo.acl ? 'the ACL phase ' + rinfo.acl : ''].filter(Boolean)) + '.';
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
        var norm = SL(t) ? screenNorm(m.name, c.pop, t) : (c.pnorms[m.name] || null);
        var target = el.querySelector('.m-target'), calc = el.querySelector('.m-calc'), meter = el.querySelector('.m-meter');
        // v18: the target when there is one, else nothing (no 'choose sex for targets' / 'no norm' on every row: the
        // details card asks for sex or the phase once, and a result's 'No target' pill says the rest)
        target.textContent = norm && (!SL(t) || c.pop.population) ? (norm.dir === 'Guide' ? 'not rated · guides training: ' : SL(t) && !m.rehab ? 'target ' : 'phase target ') + E.targetStr(norm) : '';   // v37: a rehab test's is its phase's   // v28: the DSI's bands
        calc.textContent = '';
        var v = state[t].values[m.name] || {};
        var typed = m.calc === 'LSI' ? (!blank(v.left) || !blank(v.right)) : !blank(v.result);
        if (m.calc === 'DSI') {
          var auto = el.querySelector('[data-auto]');
          auto.innerHTML = row ? 'CMJ ÷ IMTP =<b>' + esc(E.fmt(row.result)) + '</b>' : 'Auto: CMJ Peak Force ÷ IMTP Peak Force';
        }
        if (m.calc === 'RATIO') {                      // v37: the hip ratio, this leg
          el.querySelector('[data-auto]').innerHTML = row ? 'ADD ÷ ABD =<b>' + esc(E.fmt(row.result)) + '</b>' : 'Worked out: adduction \u00f7 abduction';
        }
        if ((m.calc === 'PERBW' || m.calc === 'PERKG' || m.calc === 'XBW' || m.calc === 'PCTBW' || m.calc === 'NPCTBW') && typed) {   // v36: + the strength kinds; v43: + NPCTBW
          calc.textContent = row ? '= ' + E.fmt(row.result) + ' ' + m.unit : (E.parseInput(state[t].meta.mass) ? '' : 'add mass to score');
        }
        if (m.lib && m.side) {                         // v43: a clinic test on each leg: the leg behind says by how much
          var dt = legDiffText(legDiff(t, m.name.slice(0, -(' \u2014 ' + m.side).length), m.dir), m.side);
          if (dt) calc.textContent = (calc.textContent ? calc.textContent + ' \u00b7 ' : '') + dt;
        }
        if (m.calc === 'LSI' && typed) {
          // the chip carries the status word. v18: worked out from the two boxes (c.inputs), so it shows before the
          // phase and norm set are chosen too
          var lsrc = c.inputs || c.lsiIn, lv = lsrc && lsrc[m.name] ? lsrc[m.name].result : null;   // v37: the Custom battery's LSI too
          calc.textContent = lv !== null && lv !== undefined ? '= ' + E.fmt(lv) + '%' : (state[t].meta.injured ? 'enter both sides' : 'set the injured side');
        }
        var pn = el.querySelector('.m-prevnote');
        if (pn) pn.textContent = v.prevDate && !blank(v.previous) && (m.calc === 'LSI' || m.calc === 'DSI')
          ? 'prev ' + E.fmt(E.parseInput(v.previous)) + (m.calc === 'LSI' ? '%' : '') + ' (' + E.displayIso(v.prevDate) + ')'
          : '';
        if (pn && m.calc === 'RATIO') pn.textContent = row && row.prev != null ? 'prev ' + E.fmt(row.prev) : '';   // v37: from the hip tests' previous results
        setSpark(el, tr[m.name] ? sparkSvg(tr[m.name], m.dir, '') : '');
        if (row) {
          entered++;
          el.dataset.status = row.status || '';
          out.innerHTML = chip(row.status, row.status === 'Guide' ? row.guide : '') + (row.change ? '<span class="m-change ' + row.change_kind + '">' + changeHtml(row.change, row.change_kind) + '</span>' : '');
          meter.innerHTML = meterHtml(row.result, row.norm, row.prev, row.change_kind);
          if (!meter.innerHTML) el.dataset.status = '';
        } else {
          el.dataset.status = '';
          meter.innerHTML = '';
          out.innerHTML = typed && E.parseInput(v.result) === null && m.calc !== 'LSI' && m.calc !== 'PERBW' && m.calc !== 'XBW' && m.calc !== 'PCTBW' && m.calc !== 'NPCTBW' ? '<span class="m-wait">not a number</span>' : '';
        }
        seen[m.name] = 1;
      });
      var cnt = gel.querySelector('[data-count]');
      cnt.textContent = entered ? entered + ' of ' + g.metrics.length + ' entered' : g.metrics.length + (g.metrics.length === 1 ? ' metric' : ' metrics');   // v37: 1 metric
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
  // v48: a unit as said to the clinician: 'AU' is a score, '/100' a score out of 100 (KOOS, IKDC, HaOS, ACL-RSI…)
  function scoreUnit(u) { return !u ? '' : u === 'AU' ? 'score' : u === '/100' ? 'score out of 100' : u; }
  function typedUnit(u) { return !u || u === 'AU' || u === '/100' || u === 'ratio' || u === 'count' ? '' : (u === '%' || u === '°' ? u : ' ' + u); }   // v48: + /100
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
    if (t === 'ankle') {                               // v42: each leg's box against the usual range; the injured leg's against its previous result too
      var inj0 = s.meta.injured === 'Left' ? 'left' : (s.meta.injured === 'Right' ? 'right' : '');
      DATA.ankle.groups.forEach(function (g) {
        g.metrics.forEach(function (m) {
          var v = s.values[m.name] || {};
          if (m.kind === 'lr') {
            [['left', 'Left '], ['right', 'Right ']].forEach(function (sd) {
              var cur = E.parseInput(v[sd[0]]);
              if (cur === null) return;
              var pv = sd[0] === inj0 && m.role !== 'reach' && m.role !== 'len' ? E.parseInput(v.previous) : null;   // (a reach's previous is a %, the box takes cm)
              add(m.name, [sd[0]], E.typoCheck(cur, m.range, pv, m.jump), raw(v[sd[0]]), m.unit === 'errors' ? '' : m.unit, raw(v[sd[0]]) + '~' + (pv === null ? '' : raw(v.previous)), v.prevDate, sd[1]);
            });
          } else if (m.kind === 'q') {
            var r0 = E.parseInput(v.result), t0 = E.parseInput(v.total);
            if (t0 !== null) add(m.name, ['total'], E.typoCheck(t0, [0, m.of], null, false), raw(v.total), '', raw(v.total), '', 'Total ');
            else if (r0 !== null) add(m.name, ['result'], E.typoCheck(r0, m.range, E.parseInput(v.previous), m.jump), raw(v.result), '%', raw(v.result) + '~' + raw(v.previous), v.prevDate, '');
          }
        });
      });
      return out;
    }
    setOf(t).groups.forEach(function (g) {
      g.metrics.forEach(function (m) {
        var v = s.values[m.name] || {};
        if (m.calc === 'DSI' || m.calc === 'RATIO') return;   // worked out, never typed (its two inputs are checked; v37: the hip ratio too)
        if (m.calc === 'LSI') {                         // the LSI worked out from left and right
          // v18: from the two boxes (c.inputs), so it is checked before the phase and norm set are chosen too
          var lsrc = c.inputs || c.lsiIn, lv = lsrc && lsrc[m.name] ? lsrc[m.name].result : null;   // v37: the Custom battery's LSI too
          if (lv !== null && lv !== undefined) add(m.name, ['left', 'right'], E.typoCheck(lv, m.range, E.parseInput(v.previous), m.jump), E.fmt(lv), '%',
            raw(v.left) + '/' + raw(v.right) + '~' + raw(v.previous), v.prevDate, 'LSI ');
          return;
        }
        var cur = E.parseInput(v.result);
        if (cur === null) return;
        var unit = m.calc === 'PERBW' || m.calc === 'PERKG' || m.calc === 'NPCTBW' ? 'N' : (m.calc === 'XBW' || m.calc === 'PCTBW' ? 'kg' : (m.str ? 'reps' : m.unit));   // force is typed in N, a load in kg (v36)
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
      setOf(t).groups.forEach(function (g) {
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

  // ------------------------------------------------------------------ v44: a new version of the app
  // An open app keeps running the code it opened with until it is closed. So when it comes back to the front, when it comes
  // back online, and every 30 minutes while it is open, it asks the server which version is live (index.html's app.js?v=).
  // When that is newer: on Home itself, with nothing open or in progress and nobody using it (just brought to the front and
  // not touched since, or left alone for 2 minutes), it reloads by itself; anywhere else a bar under the app bar offers
  // Update (entries are saved first; it waits for Claude or an upload to finish) or Later (back the next time the app comes
  // to the front). After an update the app says which version it now is.
  var APP_V = (function () { var s = document.querySelector('script[src*="app.js"]'), m = s && /[?&]v=(\d+)/.exec(s.getAttribute('src') || ''); return m ? +m[1] : 0; })();
  var UPD_STORE = 'bh-athlete-report-update-v1';      // { v, at }: the last reload made for version v (a slow server can't loop it)
  var UPD_EVERY = 30 * 60000, UPD_IDLE = 2 * 60000, UPD_RETRY = 15 * 60000;
  var upd = { v: 0, later: false, want: false, msg: '', key: '', checkAt: 0, frontAt: Date.now(), inputAt: 0, wait: null, busy: false };
  function updTried() { try { var t = JSON.parse(localStorage.getItem(UPD_STORE) || 'null'); return t && typeof t === 'object' ? t : null; } catch (e) { return null; } }
  function updCheck(front) {
    var now = Date.now();
    if (front) { upd.frontAt = now; upd.later = false; }   // Later lasts until the app next comes to the front
    if (!APP_V || !window.fetch || navigator.onLine === false || document.visibilityState === 'hidden') { updMaybe(); return; }
    if (upd.busy || now - upd.checkAt < 60000) { updMaybe(); return; }   // asked within the last minute
    upd.checkAt = now; upd.busy = true;
    try {   // the offline copy follows too: a new sw.js saves the new files and takes over (the page itself still needs a reload)
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(function (r) { if (r && r.update) r.update().catch(function () {}); }).catch(function () {});
    } catch (e) { /* no service worker here */ }
    fetch('index.html', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      upd.busy = false;
      var m = /app\.js\?v=(\d+)/.exec(t || ''), v = m ? +m[1] : 0;
      if (v > APP_V && v > upd.v) { upd.v = v; upd.later = false; }
      updMaybe();
    }, function () { upd.busy = false; updMaybe(); });   // offline, or the server didn't answer: next time
  }
  // what the app is doing that a reload would cut short (the quiet update waits; Update waits for it, then reloads)
  function updBusy() {
    if (aiBusy) return 'Claude has finished the interpretation';
    if (suggestBusy) return 'Claude has finished choosing exercises';
    if (Object.keys(scanBusy).some(function (k) { return scanBusy[k]; })) return 'Claude has finished reading the photos';
    if (libMediaBusy()) return 'the photo or video has uploaded';
    if (signinBusy) return 'you are signed in';
    return '';
  }
  function updBlock() {                                // + what only the clinician can finish
    var b = updBusy();
    if (b) return b;
    if (homeView && homeSub === 'photo' && pm && (pm.r.length || pm.x.length)) return 'you have finished in Photo mode';
    if (bld.edit && bld.edit.dirty) return 'the battery you are editing is saved or cancelled';
    if (openModalEl) return 'the open window is closed';
    if (!els.sheet.hidden) return 'the report is closed';
    return '';
  }
  function updQuietOk() {
    if (locked) return true;                           // v46: the switcher is up: nobody is mid-task, and it comes straight back
    if (!homeView || homeSub || openModalEl || menuOpen() || !els.sheet.hidden || updBusy()) return false;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;   // someone is typing (the client search, the sign-in)
    var now = Date.now();                              // just brought to the front and not touched since, or left alone
    return (upd.inputAt < upd.frontAt && now - upd.frontAt < 30000) || now - upd.inputAt > UPD_IDLE;
  }
  function updMaybe() {
    if (!upd.v || upd.v <= APP_V) return;
    if (upd.want) { updTry(); return; }
    if (updQuietOk() && updReload(true)) return;
    updBar();
  }
  function updReload(quiet) {
    var t = updTried();
    if (quiet && t && t.v === upd.v && Date.now() - (+t.at || 0) < UPD_RETRY) return false;   // tried lately and still old here: the bar
    try { localStorage.setItem(UPD_STORE, JSON.stringify({ v: upd.v, at: Date.now() })); } catch (e) { /* storage unavailable */ }
    clearTimeout(saveTimer);                           // the entries as they are now, so the new version opens with them
    try { followReport(); localStorage.setItem(draftKey(), draftJson()); } catch (e) { /* storage unavailable */ }
    try { history.replaceState(null, '', location.pathname + location.search + (homeView ? '' : '#continue')); } catch (e) { /* keep the address */ }
    location.reload();
    return true;
  }
  function updTry() {                                  // Update tapped: now, or as soon as what is under way has finished
    clearTimeout(upd.wait);
    var why = updBlock();
    if (!why) { upd.want = false; updReload(false); return; }
    upd.want = true; upd.msg = why;
    updBar();
    upd.wait = setTimeout(updTry, 1500);
  }
  function updBar() {
    var bar = els.updBar;
    if (!bar) return;
    var show = !!upd.v && upd.v > APP_V && !upd.later, key = show ? upd.v + '|' + (upd.want ? upd.msg : '') : '';
    if (show && key !== upd.key) {
      var had = bar.contains(document.activeElement);
      bar.innerHTML = '<span class="upd-dot" aria-hidden="true"></span>' + (upd.want
        ? '<span class="upd-t">Version\u00a0' + upd.v + ' will load as soon as ' + esc(upd.msg) + '.</span>' +
          '<button type="button" class="ghost upd-b" data-upd="later">Not now</button>'
        : '<span class="upd-t">A new version of the app is ready (version\u00a0' + upd.v + ').</span>' +
          '<button type="button" class="primary upd-b" data-upd="go">Update</button><button type="button" class="ghost upd-b" data-upd="later">Later</button>');
      if (had) focusQuiet(bar.querySelector('button'));
    }
    upd.key = key;
    var was = bar.hidden;
    bar.hidden = !show;
    if (was !== bar.hidden) measureBar();
  }
  function updLater() {
    clearTimeout(upd.wait);
    upd.want = false; upd.later = true;
    updBar();
  }
  function wireUpdate() {
    if (wireUpdate.done) return;
    wireUpdate.done = true;
    var t = updTried();                                // the reload made for this version worked: say so once
    if (t && +t.v <= APP_V) {
      try { localStorage.removeItem(UPD_STORE); } catch (e) { /* storage unavailable */ }
      if (+t.v === APP_V) toast('Updated to version ' + APP_V);
    }
    if (els.updBar) els.updBar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-upd]');
      if (!b) return;
      if (b.dataset.upd === 'go') updTry(); else updLater();
    });
    ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { upd.inputAt = Date.now(); }, { capture: true, passive: true }); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') updCheck(true); });
    window.addEventListener('online', function () { updCheck(false); });
    setInterval(function () {                          // every 30 minutes a check; meanwhile, a waiting version tries the quiet way
      if (Date.now() - upd.checkAt >= UPD_EVERY) updCheck(false); else if (upd.v && !upd.want) updMaybe();
    }, 30000);
    setTimeout(function () { updCheck(false); }, 4000);   // opened from the offline copy and online now: the live version
  }

  function autoTime(t) {
    var m = state[t].meta;
    if ((t === 'ham' || t === 'ankle') && blank(m.weeks) && m.doi) {   // v42: + Ankle-GO
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
      '<div class="card-head"><div class="fold-t"><h2 id="coachTitle">Training status</h2>' +   // v48: one name on every page (was For the coach on the sport pages)
      '<p class="coach-help">Optional: ' + (SL(t) ? 'training status' : 'status') + ', modifications and next retest, printed as a band at the top of the report.</p></div>' +
      '<button type="button" class="ghost fold-add" data-action="coach-open" aria-expanded="' + open + '" aria-controls="coachFields">+ Add</button></div>' +
      '<div class="coach-fields" id="coachFields"><div class="f coach-status"><span id="coachStatusL">' + (SL(state.tool) ? 'Training status' : 'Status') + '</span>' +
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

  // ------------------------------------------------------------------ v42: Ankle-GO
  // Matthew (6 Oct): "The next screening battery I want to get into the app is the ANKLE-GO". His choices: the scores are typed
  // (a questionnaire as its %, or its total, which the app turns into the %); both legs are entered, the score is the injured
  // leg's and the other leg is shown beside it with the difference; read for a lateral ankle sprain managed without surgery;
  // its own battery (not in the Custom catalogue). ankle_go.json holds the rows, the points and the cut-offs (Picot et al.
  // 2024); E.ankleGo scores them. The items are the scored rows (status from their points: all = On target, some = Close,
  // none = Behind); the reaches and the leg length feed the composite. The score card and the summary's ring show the total
  // out of 25 and its band; the band is decision support, the clinician decides.
  var AGO_LOOK = { Green: 'g', Amber: 'a', Red: 'r' };
  function agoItemOf(name) {                          // the item a row is scored as (null for the reaches and the leg length)
    var hit = null;
    (DATA.ankle.items || []).forEach(function (it) { if (!hit && it.metric === name) hit = it; });
    return hit;
  }
  function agoBonusOf(name) {                         // a reach that earns a bonus point: { item, bonus } (or null)
    var hit = null;
    (DATA.ankle.items || []).forEach(function (it) { (it.bonus || []).forEach(function (b) { if (!hit && b.metric === name) hit = { item: it, bonus: b }; }); });
    return hit;
  }
  function agoUnit(m) { return m.role === 'reach' ? '%' : m.unit; }   // the unit a row is scored (and recorded) in
  function agoNum(x) { return String(Math.round(x * 100) / 100); }   // as typed: 9.5 (not 9.50), 91.7, 12
  function agoVal(x, unit) {                           // '12.4 s', '2 errors', '91.7%'
    if (x === null || x === undefined) return '';
    var u = unit || '', n = agoNum(x);
    return u === '%' ? n + '%' : (u === 'errors' ? n + (x === 1 ? ' error' : ' errors') : n + (u ? ' ' + u : ''));
  }
  function ptsText(p, max) { return p + ' of ' + max + (max === 1 ? ' pt' : ' pts'); }
  // the other leg beside the injured one: '21% slower than the other leg', '2 more errors', '4% below the other leg'
  function agoDiff(m, inj, oth) {
    if (inj === null || oth === null || inj === undefined || oth === undefined) return '';
    if (m.unit === 'errors') {
      var d = inj - oth;
      return d === 0 ? 'Same errors as the other leg' : Math.abs(d) + (Math.abs(d) === 1 ? ' error ' : ' errors ') + (d > 0 ? 'more' : 'fewer') + ' than the other leg';
    }
    if (!oth) return '';
    var pct = (inj - oth) / Math.abs(oth) * 100, p = E.pyFixed(Math.abs(pct), 0);
    if (p === '0') return 'Level with the other leg';
    if (m.dir === 'Lower') return p + '% ' + (pct > 0 ? 'slower' : 'faster') + ' than the other leg';
    return p + '% ' + (pct < 0 ? 'below' : 'above') + ' the other leg';
  }
  function computeAnkle() {
    var s = state.ankle, S = DATA.ankle, g = E.ankleGo(S, s.values, s.meta.injured), inj = g.injured ? g.injured.toLowerCase() : '';
    var items = {}, inputs = {}, groups = [];
    g.items.forEach(function (it) { items[it.metric] = it; });
    S.groups.forEach(function (gr) {
      var rows = [];
      gr.metrics.forEach(function (m) {
        if (m.role === 'len') return;                  // the leg length is a means to the reaches, never a result
        var v = s.values[m.name] || {}, prev = E.parseInput(v.previous);
        var res = m.kind === 'q' ? g.q[m.name] : (inj ? g.sides[inj][m.name] : null);
        if (res === null || res === undefined) return;
        inputs[m.name] = { result: res, previous: prev };
        var it = items[m.name];
        if (!it) return;                               // a reach: its points are the composite's
        var ch = E.change(res, prev, m.dir, m.thr);
        rows.push({ name: m.name, unit: m.unit, result: res, status: it.status, guide: '', target: it.rule, source: '', norm: null, side: '',
          change: ch[0], change_kind: ch[1], prev: E.num(prev), pts: it.pts, max: it.max, other: it.other, label: it.label, item: it });
      });
      if (rows.length) groups.push({ title: gr.title, rows: rows });
    });
    if (g.complete) inputs[S.score.name] = { result: g.total, previous: null };   // the total goes in the record (once every item is in)
    // the previous total from the client's record, for the card and the AI
    var cl = clientFor(s.meta.name), date = s.meta.date || todayIso();
    var pv = cl ? E.previousFor(cl.sessions, 'ankle', S.score.name, date) : null;
    if (pastAsOf && pv && pv.date >= pastAsOf) pv = null;
    g.prev = pv ? { value: pv.value, date: pv.date } : null;
    if (g.prev && g.complete) { var sc = E.change(g.total, g.prev.value, 'Higher', S.score.thr); g.change = sc[0]; g.change_kind = sc[1]; }
    var byName = {};
    E.flatten(groups).forEach(function (r) { byName[r.name] = r; });
    return { key: 'ankle', ago: g, pnorms: {}, groups: groups, byName: byName, counts: E.counts(groups), prios: E.priorities(groups, 7), inputs: inputs };
  }
  // the page: one section per group, each row with the left and right boxes (a questionnaire: its % and its total)
  function apprHtml(id, m, v) {
    var a = v.appr === 'No' || v.appr === 'Yes' ? v.appr : '';
    return '<div class="ago-appr"><span class="aa-l" id="' + id + '-al">Apprehension</span><div class="seg aa-seg" role="group" aria-labelledby="' + id + '-al" aria-describedby="' + id + '-ad">' +
      ['No', 'Yes'].map(function (o) { return '<button type="button" data-appr="' + o + '" aria-pressed="' + (a === o) + '">' + o + '</button>'; }).join('') +
      '</div><span class="vh" id="' + id + '-ad">Did the client feel apprehension, a fear of the ankle giving way, during this test? No earns a point.</span></div>';
  }
  function agoRowHtml(m, gi, mi) {
    var v = val('ankle', m.name), id = 'ankle-' + gi + '-' + mi, nm = esc(m.name), it = agoItemOf(m.name), q = m.kind === 'q', comp = m.kind === 'comp';
    var uw = { s: 'seconds', cm: 'cm' }[m.unit] || '';
    var hint = q ? m.hint + ' · % or the total of ' + m.of : (m.hint || '') + (uw && !comp ? ' · ' + uw : '');
    var html = '<div class="metric lr ago' + (comp ? '' : ' has-bl') + (q ? ' ago-q' : '') + (it ? ' ago-item' : '') + '" data-metric="' + nm + '" data-status="" id="' + id + '">' +
      '<div class="m-label">' + nameHtml('ankle', m.name, m.name, id) + '<div class="m-hint"><span class="m-unit">' + esc(hint) + '</span>' +
      '<span class="m-target"></span><span class="m-calc"></span><span class="m-prevnote"></span><span class="m-spark"></span></div>' +
      (it && it.appr ? apprHtml(id, m, v) : '') + '</div>' + (comp ? '' : boxLabels(q ? 'Score %' : 'Left', q ? 'Total' : 'Right'));
    function box(f, cls, ph, label) {
      return '<input class="m-in ' + cls + '" id="' + id + '-' + f + '" data-field="' + f + '" value="' + esc(v[f] == null ? '' : v[f]) + '" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="' +
        esc(ph) + '" aria-label="' + nm + ', ' + esc(label) + '">';
    }
    if (comp) html += '<div class="m-auto" data-auto>Worked out from the three reaches</div>';
    else if (q) html += box('result', 'm-left', '%', 'score as a percentage') + box('total', 'm-right', 'of ' + m.of, 'total score out of ' + m.of + ' (fills the percentage)');
    else html += box('left', 'm-left', 'Left' + (m.unit === 'errors' ? '' : ' ' + m.unit), 'left ' + (m.role === 'reach' ? 'stance leg' : 'leg') + ', ' + m.unit) +
      box('right', 'm-right', 'Right' + (m.unit === 'errors' ? '' : ' ' + m.unit), 'right ' + (m.role === 'reach' ? 'stance leg' : 'leg') + ', ' + m.unit);
    return html + '<div class="m-out" aria-live="off"></div><div class="m-check" id="' + id + '-check" hidden></div></div>';
  }
  function agoGroupsHtml() {
    var s = state.ankle, on = testsShown('ankle');
    return DATA.ankle.groups.map(function (g, gi) {
      if (!on[gi]) return '';
      var collapsed = !!s.collapsed[gi], q = g.metrics.every(function (m) { return m.kind === 'q'; });
      return '<section class="group' + (collapsed ? ' collapsed' : '') + '" data-group="' + gi + '">' +
        '<button type="button" class="group-head" aria-expanded="' + !collapsed + '"><span class="gt">' + esc(groupTitle(g.title)) + '</span><span class="gc" data-count></span><span class="chev" aria-hidden="true"></span></button>' +
        '<div class="cols lr" aria-hidden="true"><span class="c-left">' + (q ? 'Score %' : 'Left') + '</span><span class="c-right">' + (q ? 'Total' : 'Right') + '</span><span class="c-out">Points</span></div>' +
        '<div class="group-body">' + g.metrics.map(function (m, mi) { return agoRowHtml(m, gi, mi); }).join('') + '</div></section>';
    }).join('');
  }
  // a questionnaire's total typed: its % worked out into the % box (the box typed last wins: a % typed by hand clears the total)
  function agoTotal(row, el) {
    var m = agoMetricByName(row.dataset.metric);
    if (!m || m.kind !== 'q') return;
    var v = val('ankle', m.name);
    if (el.dataset.field === 'total') {
      var tot = E.parseInput(v.total);
      v.result = tot !== null && m.of ? String(E.pyRound(tot / m.of * 100, 1)) : '';
      var pc = row.querySelector('input[data-field="result"]');
      if (pc && pc.value !== v.result) pc.value = v.result;
    } else if (el.dataset.field === 'result' && !blank(v.total)) {
      v.total = '';
      var tb = row.querySelector('input[data-field="total"]');
      if (tb) tb.value = '';
    }
  }
  function agoMetricByName(name) {
    var hit = null;
    DATA.ankle.groups.forEach(function (g) { g.metrics.forEach(function (m) { if (!hit && m.name === name) hit = m; }); });
    return hit;
  }
  function setAppr(b) {
    var row = b.closest('.metric'), v = val('ankle', row.dataset.metric);
    unmarkScanned(b.parentNode);
    v.appr = v.appr === b.dataset.appr ? '' : b.dataset.appr;   // tapping the chosen one again clears it
    b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(v.appr === x.dataset.appr)); });
    refresh();
    if (!blank(v.appr)) foldNow('ankle', true);
  }
  function refreshAnkle(c) {
    var s = state.ankle, g = c.ago, inj = g.injured ? g.injured.toLowerCase() : '', note = $('ctxNote'), tr = trends('ankle', c);
    note.hidden = false;
    if (!inj) { note.className = 'note warn'; note.textContent = 'Choose the injured side: the score is the injured leg’s.'; }
    else {
      var auto = autoTime('ankle');
      note.className = 'note';
      note.textContent = 'Scored on the ' + inj + ' leg (injured); the other leg is shown beside it. Reaches are % of leg length.' + (auto ? ' ' + auto : '');
    }
    var items = {};
    g.items.forEach(function (it) { items[it.metric] = it; });
    els.entry.querySelectorAll('.group').forEach(function (gel) {
      var gi = +gel.dataset.group, grp = DATA.ankle.groups[gi], entered = 0;
      gel.querySelectorAll('.metric').forEach(function (el, mi) {
        var m = grp.metrics[mi], v = s.values[m.name] || {}, it = items[m.name], out = el.querySelector('.m-out');
        var target = el.querySelector('.m-target'), calc = el.querySelector('.m-calc'), html = '', status = '';
        var bo = agoBonusOf(m.name);
        target.textContent = it ? it.rule : (bo ? '+' + bo.bonus.pts + ' pt ' + bo.bonus.label.replace(/^\S+ /, '') : '');   // '+1 pt over 60%'
        calc.textContent = '';
        var typed = m.kind === 'q' ? !blank(v.result) || !blank(v.total) : (m.kind === 'lr' ? !blank(v.left) || !blank(v.right) : false);
        if (m.kind === 'comp') {
          var L = g.sides.left[m.name], R = g.sides.right[m.name];
          el.querySelector('[data-auto]').innerHTML = L !== null || R !== null
            ? '<span>' + [['L', L], ['R', R]].map(function (x) { return x[0] + ' <b>' + (x[1] === null ? '–' : esc(agoVal(x[1], '%'))) + '</b>'; }).join(' · ') + '</span>'   // (one span: a flex box drops the spaces round the dot)
            : 'Worked out from the three reaches';
        }
        if (it) {                                      // a scored item: its points on the injured leg
          if (it.tested) {
            if (m.kind !== 'comp') entered++;          // (the composite is worked out, not entered)
            status = it.status;
            html += '<div class="lr-line ago-pts">' + (m.kind === 'q' ? '' : '<span class="lr-sd">' + g.injured.charAt(0) + '</span><span class="lr-v">' + esc(agoVal(it.value, m.unit)) + '</span>') + chip(it.status, ptsText(it.pts, it.max)) + '</div>';
            var d = m.kind === 'q' ? '' : agoDiff(m, it.value, it.other);
            if (d) html += '<div class="lr-diff">' + esc(d) + '</div>';
            if (it.appr === '') html += '<div class="lr-wait">Apprehension? +1 if none</div>';
            var row = c.byName[m.name];
            if (row && row.change) html += '<div class="lr-chg m-change ' + row.change_kind + '">' + changeHtml(row.change, row.change_kind) + '</div>';
            if (m.kind === 'q' && !blank(v.total)) calc.textContent = '= ' + agoVal(it.value, '%') + ' from ' + clean1(v.total) + ' of ' + m.of;
          } else if (typed && !inj && m.kind !== 'q') html = '<div class="lr-wait">set the injured side</div>';
          else if (typed && m.kind === 'q') html = '<span class="m-wait">not a number</span>';
          else if (m.kind === 'comp' && inj && (g.sides.left[m.name] !== null || g.sides.right[m.name] !== null)) html = '<div class="lr-wait">' + g.injured + ' leg not complete</div>';
          else if (typed) html = '<span class="m-wait">' + (inj ? 'not a number' : 'set the injured side') + '</span>';
        } else if (m.role === 'reach') {               // each leg as % of its leg length; the bonus point on the injured leg
          if (typed) entered++;
          ['left', 'right'].forEach(function (sd) {
            var x = g.sides[sd][m.name], rawx = E.parseInput(v[sd]);
            if (rawx === null) return;
            var mine = sd === inj;
            html += '<div class="lr-line"><span class="lr-sd">' + sd.charAt(0).toUpperCase() + '</span><span class="lr-v">' + (x === null ? '<span class="lr-wait">needs leg length</span>' : esc(agoVal(x, '%'))) + '</span>' +
              (bo && mine && x !== null ? chip(agoTest(bo.bonus, x) ? 'Green' : 'n/a', agoTest(bo.bonus, x) ? '+' + bo.bonus.pts + ' pt' : 'no pt') : '') + '</div>';
          });
        } else if (m.role === 'len') {
          if (typed) entered++;
          var l0 = E.parseInput(v.left), r0 = E.parseInput(v.right);
          if ((l0 === null) !== (r0 === null) && (l0 > 0 || r0 > 0)) html = '<div class="lr-diff">Used for both legs</div>';
        }
        if (!html && typed && m.kind === 'lr' && E.parseInput(v.left) === null && E.parseInput(v.right) === null) html = '<span class="m-wait">not a number</span>';
        out.innerHTML = html;
        el.dataset.status = status;
        var pn = el.querySelector('.m-prevnote');
        if (pn) pn.textContent = v.prevDate && !blank(v.previous) && m.role !== 'len'
          ? 'prev ' + agoVal(E.parseInput(v.previous), agoUnit(m)) + (m.kind === 'q' ? '' : ' injured') + ' (' + shortDate(v.prevDate, s.meta.date) + ')'
          : '';
        setSpark(el, tr[m.name] ? sparkSvg(tr[m.name], m.dir, '') : '');
      });
      var cnt = gel.querySelector('[data-count]'), ny = grp.metrics.filter(function (m) { return m.kind !== 'comp'; }).length;
      var noun = grp.metrics.some(function (m) { return m.kind === 'q'; }) ? ['questionnaire', 'questionnaires'] : (grp.metrics.some(function (m) { return m.role === 'len'; }) ? ['measure', 'measures'] : ['test', 'tests']);
      cnt.textContent = entered ? entered + ' of ' + ny + ' entered' : ny + ' ' + noun[ny === 1 ? 0 : 1];
    });
    refreshAgoCard(c);
  }
  function agoTest(b, x) { return b.op === '>' ? x > b.value : b.op === '>=' ? x >= b.value : b.op === '<' ? x < b.value : b.op === '<=' ? x <= b.value : false; }
  // the score card under the tests: the total, its band, the previous total and each item's points
  function agoCardHtml() {
    return '<section class="card ago-card" id="agoCard" tabindex="-1" aria-labelledby="agoTitle">' +
      '<div class="card-head"><h2 id="agoTitle">Ankle-GO score</h2><span class="ago-total" id="agoTotal"></span></div>' +
      '<div class="ago-body" id="agoBody"></div><ul class="rts-list ago-list" id="agoList"></ul>' +
      '<p class="fine rts-note">' + esc(DATA.ankle.note || '') + '</p></section>';
  }
  function agoBandHtml(g) {                            // the band (or why there is none yet), the apprehension still to answer, the previous total
    var out = '';
    if (g.band) out += '<div class="ago-band" data-look="' + g.band.look + '">' + chip(g.band.look, g.band.label + ' · ' + g.band.short) + '<p>' + esc(g.band.text) + '</p></div>';
    else if (!g.injured) out += '<p class="ago-wait">Choose the injured side to score the tests.</p>';
    else out += '<p class="ago-wait">' + (g.tested ? g.done + ' of ' + g.items.length + ' items complete. The band shows once the rest can’t change it.' : 'Enter the results to score them.') + '</p>';
    if (g.noAppr.length) out += '<p class="ago-wait">Apprehension not answered: ' + esc(andList(g.noAppr.map(function (x) { return x.charAt(0).toLowerCase() + x.slice(1); }))) + '.</p>';
    if (g.prev) out += '<p class="ago-prev">Previous: <b>' + esc(E.fmt(g.prev.value)) + ' of ' + g.max + '</b> on ' + esc(E.displayIso(g.prev.date)) +
      (g.change ? ' <span class="m-change ' + g.change_kind + '">' + changeHtml(g.change, g.change_kind) + '</span>' : '') + '</p>';
    return out;
  }
  function refreshAgoCard(c) {
    var body = $('agoBody'), list = $('agoList');
    if (!body) return;
    var g = c.ago;
    $('agoTotal').textContent = g.tested ? g.total + ' of ' + g.max + (g.complete ? '' : ' so far') : '';
    var bh = agoBandHtml(g);
    if (body._h !== bh) { body.innerHTML = bh; body._h = bh; }
    var html = g.items.map(function (it) {
      var m = agoMetricByName(it.metric) || {};
      var sub = it.rule;
      return '<li class="rts-row" data-status="' + (it.tested ? (it.status === 'Green' ? 'met' : 'not') : 'untested') + '"><div class="rts-l"><b>' + esc(it.label) + '</b><span class="rts-t">' + esc(sub) + '</span></div>' +
        '<span class="rts-v">' + (it.tested ? esc(agoVal(it.value, m.kind === 'q' ? '%' : it.unit)) : 'up to ' + it.max) + '</span>' +
        (it.tested ? chip(it.status, ptsText(it.pts, it.max)) : chip('n/a', 'Not tested')) + '</li>';
    }).join('');
    if (list._html !== html) { list.innerHTML = html; list._html = html; }
  }
  function agoSumHtml(c) {                             // in the summary panel: the band (taps through to the card)
    var g = c.ago;
    if (!g.tested) return '';
    var word = g.band ? g.band.label + ' · ' + g.band.short : (g.complete ? '' : g.done + ' of ' + g.items.length + ' items complete');
    return '<button type="button" class="quiet rts-sum ago-sum" data-action="goto-ago">' + (g.band ? chip(g.band.look, g.band.label) : '') +
      '<span class="rts-sum-x"><span class="rts-sum-t">Ankle-GO' + (g.band ? '' : ' so far') + '</span><b>' + esc(g.band ? g.band.short.charAt(0).toUpperCase() + g.band.short.slice(1) : word) + '</b></span></button>';
  }
  function gotoAgo() {
    var card = $('agoCard');
    if (!card) return;
    card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setTimeout(function () { try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); } }, 350);
  }
  function agoLines(c) {                               // what Claude is told (no names, no dates)
    var g = c.ago, S = DATA.ankle, L = [];
    L.push('Ankle-GO items (test: injured leg | other leg | points | rule):');
    g.items.forEach(function (it) {
      var m = agoMetricByName(it.metric) || {}, u = m.kind === 'q' ? '%' : it.unit;
      if (!it.tested) { L.push('- ' + it.label + ': not tested (up to ' + it.max + ' points)'); return; }
      var bits = [it.label + ': ' + agoVal(it.value, u)];
      if (m.kind !== 'q') bits.push(it.other === null ? 'other leg not tested' : 'other leg ' + agoVal(it.other, u) + (agoDiff(m, it.value, it.other) ? ' (' + agoDiff(m, it.value, it.other).toLowerCase() + ')' : ''));
      bits.push(it.pts + ' of ' + it.max + ' points');
      if (it.bonus.length) bits.push(it.bonus.map(function (b) { return b.label + ' ' + (b.value === null ? 'not tested' : (b.got ? 'yes (' + agoVal(b.value, '%') + ')' : 'no (' + agoVal(b.value, '%') + ')')); }).join(', '));
      if (it.appr !== null) bits.push(it.appr === 'No' ? 'no apprehension' : (it.appr === 'Yes' ? 'apprehension reported' : 'apprehension not recorded'));
      var row = c.byName[it.metric], cw = row ? changeWords(row) : '';
      if (cw) bits.push(cw);
      L.push('- ' + bits.join(' | ') + ' | ' + it.rule);
    });
    L.push('Ankle-GO score: ' + g.total + ' of ' + g.max + (g.complete ? '' : ' so far (' + g.done + ' of ' + g.items.length + ' items complete)') + '.' +
      (g.band ? ' Band: ' + g.band.label.toLowerCase() + ' (' + g.band.short + ').' : '') +
      (g.prev && g.complete ? ' Previous score ' + E.fmt(g.prev.value) + (g.change ? ', ' + changeWords({ change: g.change, change_kind: g.change_kind }) : '') + '.' : ''));
    L.push('The developers’ reference points for a lateral ankle sprain managed without surgery (decision support only): under 8 = not yet ready to return to sport; 8 to 10 = further rehabilitation advised; 11 or more = on track for a full return to sport. A change of 2 points or more between tests is beyond measurement error.');
    return L;
  }

  // ------------------------------------------------------------------ trend sparklines
  // With the client's record loaded, a metric tested today and in at least two earlier sessions (of the last five, as
  // on the report's Progress table) gets a tiny line beside its "prev" note: missing values skipped, the available
  // points joined, the last point coloured like the change since the first.
  function trends(t, c) {
    var s = state[t], h = s.hist, key = E.nameKey(s.meta.name);
    var cl = h && h.key === key ? clients.clients[key] : null, out = {};
    if (!cl) return out;
    E.progress(historySessions(t, cl), t, { date: s.meta.date || todayIso(), results: currentResults(t, c) }, 5).rows.forEach(function (r) {
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
    var none = SL(t) ? 'Enter at least one result to create the report.' : 'Enter at least one result to create the rehab report.';
    var need = SL(t) ? (c.pop.population ? (t === 'custom' ? customRehabNeed() : '') : (t === 'custom' && state.custom.pop === null ? 'Choose the population' : 'Choose Male or Female (or a sport population)')) : rehabNeed(t);   // v37: + what rehab tests need
    if (t === 'custom' && state.custom.pop === null) return 'Choose the population to start.';   // v36
    if (t === 'custom' && !state.custom.battery.length && !hasResults(t)) return 'Choose the tests (or scan your notes) to start.';
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
    var t = state.tool, labels = (SL(t) || t === 'str') ? TALLY.screen : TALLY.rehab;
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
    if (t === 'ankle') {                               // v42: the ring is the Ankle-GO total out of 25, coloured by its band once there is one
      var ag = c.ago, look = ag.band ? AGO_LOOK[ag.band.look] : 'g';
      tally = '<div class="headline"><div class="ring-wrap"><div class="ring" role="img" aria-label="' + (ag.tested ? 'Ankle-GO score ' + ag.total + ' of ' + ag.max + (ag.complete ? '' : ' so far') : 'Nothing tested yet') + '">' +
        ringSvg(96, 10, [[look, ag.total]], ag.max) +
        '<div class="ring-c" aria-hidden="true"><b>' + (ag.tested ? ag.total : '–') + '</b><small>of ' + ag.max + '</small></div></div>' +
        '<div class="ring-cap" aria-hidden="true">' + (ag.tested && !ag.complete ? 'so far' : 'Ankle-GO') + '</div></div>' + tally + '</div>';
    } else {
      tally = '<div class="headline"><div class="ring-wrap"><div class="ring" role="img" aria-label="' + (total ? g + ' of ' + total + ' on target' : 'Nothing tested yet') + '">' +
        ringSvg(96, 10, [['g', g], ['a', c.counts.Amber], ['r', c.counts.Red]], total) +
        '<div class="ring-c" aria-hidden="true"><b>' + (total ? g : '–') + '</b>' + (total ? '<small>of ' + total + '</small>' : '') + '</div></div>' +
        '<div class="ring-cap" aria-hidden="true">on target</div></div>' + tally + '</div>';
    }
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
    } else if (t === 'ankle' && c.groups.length) {     // v42: the items short of full points, fewest points first
      list = !c.prios.length ? '<p class="ok">Full points on every item tested.</p>' : '<ol class="prio">' + c.prios.map(function (r) {
        return prioItem(r.name, r.label, r.status, agoVal(r.result, r.unit) + ' \u00b7 ' + ptsText(r.pts, r.max));
      }).join('') + '</ol>';
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
    var html = '<div class="sum"><div class="sum-scroll">' + head + tally + (t === 'acl' ? rtsSumHtml(c) : '') + (t === 'ankle' ? agoSumHtml(c) : '') + '<h3>Top priorities <small>' + (t === 'ankle' ? 'fewest points first' : 'worst first') + '</small></h3>' + list;
    if (SL(t) && c.radarOptions.length) {              // v36: the Custom battery's profile chart too
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
      if (el.dataset.field === 'previous') { v.prevDate = ''; v.prevMass = ''; }   // typed by hand now, no longer the saved record's value (v36: nor its body mass)
      if (t === 'ankle') agoTotal(row, el);            // v42: a questionnaire's total fills its %
      refresh();
      if (!blank(el.value)) foldNow(t, true);          // results arriving: the details card folds into the strip (v11)
    }
    keepAwake();
  }
  function onChange(e) {
    var el = e.target, t = state.tool;
    if (el.dataset.choice === 'pop') { state[SL(t) ? t : 'screen'].pop = el.value; refresh(); }   // v36: the Custom battery's too
    else if (el.dataset.choice === 'phase') { state[t].phase = el.value || null; refresh(); }
    else if (el.dataset.choice === 'hamPhase' || el.dataset.choice === 'aclPhase') { state.custom[el.dataset.choice] = el.value || null; refresh(); }   // v37
    else if (el.id === 'valdFiles') importVald(el.files);
    else if (el.id === 'scanFiles') {
      var picked = Array.prototype.slice.call(el.files || []);
      el.value = '';
      if (state.tool === 'ex') exPhotoScan(picked); else startScan(picked);   // v33: the exercise page asks first
    }
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
    if (b.dataset.pop) { choosePopulation(b.dataset.pop); return; }          // v36: the Custom battery's population step
    if (b.dataset.action === 'bat-choose') { openCatDialog(); return; }
    if (b.dataset.action === 'bat-saved') { openBatDialog(); return; }
    if (b.dataset.action === 'bat-edit') { var rb = runBat(); if (rb) { bldStartEdit(rb.id, 'page'); openHomeSub('builder'); } return; }   // v43
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
    if (b.dataset.action === 'goto-ago') { gotoAgo(); return; }   // v42
    if (b.dataset.appr && t === 'ankle') { setAppr(b); return; }
    if (b.dataset.action === 'typo-ok') { typoOk(b); return; }
    if (b.dataset.action === 'goto-check') { gotoCheck(); return; }
    if (b.dataset.action === 'example-remove') { removeExample(); return; }   // v48
    if (b.dataset.action === 'interp-ok') { interpOk(); return; }           // v48: the AI draft read and passed
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
      delete scanInfo[state.tool]; renderScanBar();
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
  function demoAllowed() { return !homeView && TOOLS.indexOf(state.tool) >= 0 && !clientContent(state.tool) && !(state.tool === 'custom' && state.custom.batId); }   // v30: not on Home; v43: nor on a clinic battery (its own tests)
  // v48: the example is marked on the page and never saved: until v47 Create report saved "Example Athlete" into the clinic's
  // records like any client, so every practitioner saw a fake client in Clients
  function isExample(t) { return !!(state[t] && state[t].example === true); }
  // the page about to be saved holds the example: this tool, or a program linked to an example report
  function exampleOnPage() { var lt = linkedTool(); return isExample(state.tool) || (state.tool === 'ex' && !!lt && isExample(lt)); }
  function removeExample() {
    var t = state.tool;
    if (!isExample(t)) return;
    var undo = clearForClient(t);
    render();
    window.scrollTo(0, 0);
    toast('Example results removed', { label: 'Undo', run: undo });
  }
  function fillExample() {
    if (!demoAllowed()) return;
    var t = state.tool, s = state[t];
    s.example = window.BH_EXAMPLE_SAVES !== true;      // (the suites' switch: the example as if typed, for the flows that save records)
    if (t === 'screen') {
      Object.assign(s.meta, { name: 'Example Athlete', sex: 'Male', age: '24', mass: '82', sport: 'AFL', notes: 'Example data — not a real athlete' });
      var ex = { 'Jump Height': ['38.2', '36.9'], 'Peak Power': ['51.8', '52.4'], 'CMJ Peak Force': ['2140', ''], 'RSI-modified': ['0.52', '0.47'],
        'Concentric Asymmetry': ['7.5', '', 'R'], 'IMTP Peak Force': ['3050', ''], 'IMTP Relative Force': ['37.2', '35.0'],
        'Nordic Peak Force — Left': ['365', '340'], 'Nordic Peak Force — Right': ['318', '322'], 'Nordic L/R Imbalance': ['12.9', '', 'L'],
        'Adductor Peak Force': ['402', ''], 'Abductor Peak Force': ['371', ''], '10 m sprint': ['1.78', '1.81'], '20 m sprint': ['3.02', ''] };
      Object.keys(ex).forEach(function (k) { var v = val('screen', k); v.result = ex[k][0]; v.previous = ex[k][1]; v.side = ex[k][2] || ''; });
    } else if (t === 'custom') {                       // v36: a short pre-season battery
      Object.assign(s.meta, { name: 'Example Athlete', sex: 'Female', age: '21', mass: '64', sport: 'Netball', notes: 'Example data — not a real athlete' });
      s.pop = 'general';
      s.battery = tidyBattery([{ k: 'screen', key: 'Jump Height' }, { k: 'screen', key: 'RSI-modified' }, { k: 'screen', key: 'IMTP Relative Force' },
        { k: 'screen', key: 'Nordic Peak Force — Left' }, { k: 'screen', key: 'Nordic Peak Force — Right' }, { k: 'str', id: 'split_squat' }, { k: 'str', id: 'sl_calf_raise_reps' },
        { k: 'own', id: 'o-example1', name: 'Y-balance anterior reach', unit: 'cm', dir: 'Higher', green: 65, amber: 60, type: 'bal', region: 'll' }]);
      s.batName = '';
      var cx = { 'Jump Height': ['27.4', '26.1'], 'RSI-modified': ['0.41', ''], 'IMTP Relative Force': ['31.5', '29.8'], 'Nordic Peak Force — Left': ['262', '241'], 'Nordic Peak Force — Right': ['288', ''],
        'Split squat (rear leg) — Left': ['22', ''], 'Split squat (rear leg) — Right': ['20', ''], 'Single-leg calf raise — Left': ['27', '24'], 'Single-leg calf raise — Right': ['22', ''], 'Y-balance anterior reach': ['63', '61'] };
      Object.keys(cx).forEach(function (k) { var v = val('custom', k); v.result = cx[k][0]; v.previous = cx[k][1]; });
    } else if (t === 'ham') {
      Object.assign(s.meta, { name: 'Example Client', injured: 'Left', sport: 'Soccer', notes: 'Example data — not a real client' });
      s.phase = 'Return to Play';                      // v18: chosen here, as the clinician would
      var hx = { 'AKET deficit vs uninjured': ['4', '9'], 'SLR % of uninjured side': ['96', '88'], 'HHD 90° knee-flex % of uninjured': ['91', '80'],
        'Nordic peak force — injured': ['290', '245'], 'Nordic peak-force imbalance': ['22', '41'], '10 m sprint time': ['1.86', '1.95'], 'HaOS score': ['84', '70'] };
      Object.keys(hx).forEach(function (k) { var v = val('ham', k); v.result = hx[k][0]; v.previous = hx[k][1]; });
    } else if (t === 'ankle') {                        // v42: about two months after a sprain, nearly there
      Object.assign(s.meta, { name: 'Example Client', injured: 'Right', weeks: '8', sport: 'Basketball', notes: 'Example data \u2014 not a real client' });
      var gx = { 'Single-leg stance': ['1', '0', 'No'], 'Leg length': ['91', '91'], 'SEBT anterior': ['58', '55'], 'SEBT posteromedial': ['88', '80'],
        'SEBT posterolateral': ['84', '77'], 'SEBT composite': ['', '', 'No'], 'Side hop': ['9.8', '13.8', 'Yes'], 'Figure-of-8 hop': ['11.9', '13.6', 'No'] };
      Object.keys(gx).forEach(function (k) { var v = val('ankle', k); v.left = gx[k][0]; v.right = gx[k][1]; if (gx[k][2]) v.appr = gx[k][2]; });
      val('ankle', 'FAAM ADL').result = '94';
      var fs = val('ankle', 'FAAM Sport'); fs.total = '26'; fs.result = '81.3';
      val('ankle', 'ALR-RSI').result = '58';
    } else if (t === 'str') {
      Object.assign(s.meta, { name: 'Example Client', mass: '80', sport: 'AFL', notes: 'Example data \u2014 not a real client' });
      var sx = { split_squat: ['28', '25'], sl_seated_calf_vald: ['1650', '1540'], sl_seated_calf_smith: ['125', '118'],
        sl_knee_extension: ['820', '700'], sl_bridge: ['17', '16'], sl_calf_raise_reps: ['27', '22'],
        prone_hamstring_curl: ['420', '385'], hip_abduction: ['350', '372'], hip_adduction: ['395', '380'] };
      Object.keys(sx).forEach(function (k) { var v = val('str', k); v.left = sx[k][0]; v.right = sx[k][1]; });
    } else {
      Object.assign(s.meta, { name: 'Example Client', injured: 'Right', graft: 'Hamstring', sport: 'Netball', notes: 'Example data — not a real client' });
      s.phase = '2 Years'; s.sex = 'Female';           // v18: chosen here, as the clinician would
      var ax = { 'IKDC': ['78', '70'], 'ACL-RSI': ['61', '52'], 'KOOS — Sport & Rec': ['75', '65'], 'Knee extension LSI': ['84', '76'],
        'CMJ — Jump height': ['27.5', '25.9'], 'Single hop LSI': ['88', ''] };
      Object.keys(ax).forEach(function (k) { var v = val('acl', k); v.result = ax[k][0]; v.previous = ax[k][1]; });
      var q = val('acl', 'Quadriceps LSI'); q.left = '248'; q.right = '205';
    }
    foldBeforeRender(t);
    render();
    toast('Example results filled in — nothing on this page is saved to a record');
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
    var it = state[t].interp, interp = blank(it.text) ? null : { text: String(it.text).trim(), ai: !!it.ai, reviewed: it.reviewed !== false };   // v48: the PDF's AI line says whether it was checked
    var progress = progressData(t, c);
    // each priority carries its plain-English explainer (printed under it in smaller text)
    function explained(list, keyOf) {
      return list.map(function (r) { var x = explainer(keyOf(r)); return Object.assign({}, r, { what: x ? String(x.what).trim() : '' }); });
    }
    if (t === 'str') {
      return {
        file: fileName('_strength.pdf', t),
        rep: window.BHReport.strength({
          meta: { name: m.name, date: E.displayIso(m.date), mass: m.mass, sport: m.sport, tester: withProf(m.tester), notes: m.notes },   // v49: + profession
          tests: c.tests, counts: c.counts, prios: explained(c.prios, function (r) { return r.id; }), amberPct: DATA.str.amber_pct, interp: interp, progress: progress,
          coach: coachData(t)
        })
      };
    }
    if (SL(t)) {
      var labels = {};
      c.radarOptions.forEach(function (o) { labels[o[0]] = o[1]; });
      return {
        file: fileName(t === 'custom' ? '_battery.pdf' : '_report.pdf', t),
        rep: window.BHReport.screening({
          kind: t, battery: t === 'custom' ? (state.custom.batName || '') : '',   // v36: the Custom battery (its saved name, if any)
          built: t === 'custom' && state.custom.batId ? state.custom.batName || '' : '',   // v43: a clinic battery: the report goes by its name
          legs: t === 'custom' ? legDiffs(t).map(function (x) { return Object.assign({}, x, { pct: Math.round(x.pct) }); }) : [],   // v43: the clinic's tests measured on each leg: left vs right (whole %)
          closePct: t === 'custom' && batLibTests().length ? libBasePct(batLibTests()) : null,
          closeOwn: t === 'custom' && batLibTests().some(function (tt) { return ltPct(tt) !== libBasePct(batLibTests()); }),   // v43: a test with its own Close %
          rehab: t === 'custom' ? customRehabInfo() : null,   // v37: the injured side and the phases, while it has rehab tests
          person: Person(t),                           // v49: Athlete with a sport, else Client (the title and the details row)
          meta: { name: m.name, date: E.displayIso(m.date), sport: m.sport, tester: withProf(m.tester), age: m.age, sex: m.sex, mass: m.mass, notes: m.notes },
          popLabel: c.pop.label, groups: c.groups, counts: c.counts, prios: explained(c.prios, function (r) { return explainKey(t, r.name); }),
          ageNote: over60Note(t),                      // v48: a client over 60 against the all-ages norms (until age-matched norms are added)
          radarKeys: c.radarPicked.map(function (k) { return [k, labels[k]]; }), interp: interp, progress: progress, coach: coachData(t)
        })
      };
    }
    var auto = function (fromIso, div) { var d = daysBetween(fromIso, m.date); return d !== null && d >= 0 ? String(Math.floor(d / div)) : ''; };
    if (t === 'ankle') {                               // v42
      var A0 = DATA.ankle, metr = {};
      A0.groups.forEach(function (gr) { gr.metrics.forEach(function (mm) { metr[mm.name] = mm; }); });
      return {
        file: fileName('_ankle-go.pdf', t),
        rep: window.BHReport.ankle({
          ago: c.ago, counts: c.counts, groups: c.groups, interp: interp, progress: progress, coach: coachData(t),
          rows: A0.groups.map(function (gr) {           // every row as typed, each leg in the scored unit, for the results table
            return { title: gr.title, rows: gr.metrics.map(function (mm) {
              var v = state.ankle.values[mm.name] || {};
              return { name: mm.name, kind: mm.kind, role: mm.role || '', unit: agoUnit(mm), raw: mm.unit, left: c.ago.sides.left[mm.name], right: c.ago.sides.right[mm.name],
                rawLeft: E.parseInput(v.left), rawRight: E.parseInput(v.right), q: mm.kind === 'q' ? c.ago.q[mm.name] : null, total: E.parseInput(v.total), of: mm.of || null };
            }) };
          }),
          bands: A0.bands, note: A0.note || '', sources: A0.sources || [], disclaimer: A0.disclaimer || '', title: A0.title || 'Ankle-GO',
          meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, clinician: withProf(m.clinician), weeks: blank(m.weeks) ? auto(m.doi, 7) : m.weeks, sport: m.sport, notes: m.notes }
        })
      };
    }
    if (t === 'ham') {
      return {
        file: fileName('_hamstring.pdf', t),
        rep: window.BHReport.rehab({
          kind: 'ham', phase: state.ham.phase, groups: c.groups, counts: c.counts, disclaimer: DATA.ham.disclaimer || '', interp: interp, progress: progress, coach: coachData(t),
          meta: { name: m.name, date: E.displayIso(m.date), injured: m.injured, clinician: withProf(m.clinician), weeks: blank(m.weeks) ? auto(m.doi, 7) : m.weeks, sport: m.sport, notes: m.notes }
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
    if (x.date !== (m.date || '')) { x.date = m.date || ''; autoReview(); }   // v32: and an automatic review date with it
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
    else if (moved) toast('The program now prints after the ' + toolName(t) + ' report', { label: 'Undo', run: function () {
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
      file: r.file.replace(/\.pdf$/i, '') + '_and_exercises.pdf', program: h.program, both: rt, share: h.share,   // v35: + the phone link
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
  // v34: a handout with the library's photos loads them first (a few seconds at most; one that can't be had prints without)
  var photoWait = false;
  // v48: the general norms stop at 60 (Matthew is finding 60+ reference values): a client over 60 is scored against all ages,
  // and the report and the check before Create report both say so
  function over60Note(t) {
    var age = E.parseInput(state[t].meta.age);
    if ((t !== 'screen' && t !== 'custom') || state[t].pop !== 'general' || age === null || age <= 60) return '';
    return 'There are no age-matched reference values over 60, so these results are compared with adults of all ages: treat the colours as a rough guide, and the change from last time as the better measure.';
  }
  // ------------------------------------------------------------------ v48: the check before Create report / Create handout
  // One step listing what is still open on the page: values the typo guard flagged, boxes filled from a photo and not
  // checked since, an AI interpretation nobody has read, an age the norms don't cover, exercises with no sets or reps.
  // Each has its own way through; Create anyway goes ahead. (Until v47 nothing paused: the counts were shown, that's all.)
  function exNoDose() { return state.ex.items.filter(function (it) { return exFilled(it) && blank(it.sets) && blank(it.reps); }); }
  function scannedOpen(t) { var sc = state[t].scanned || {}; return Object.keys(sc).filter(function (k) { return sc[k] === true; }).length; }
  function preflightItems() {
    var t = state.tool, ex = t === 'ex', lt = linkedTool(), rt = ex ? '' : t, items = [];
    var withEx = ex || (lt && lt === t && exCounts().exercises > 0);
    if (rt) {
      var n1 = typoList.length;
      if (n1) items.push({ k: 'typo', text: n1 + (n1 === 1 ? ' value is' : ' values are') + ' outside the usual range or far from last time', acts: [['Check now', 'typo']] });
      var n2 = scannedOpen(rt);
      if (n2) items.push({ k: 'scan', text: n2 + (n2 === 1 ? ' box was' : ' boxes were') + ' filled from a photo and not checked since', acts: [['Show me', 'scan'], ['All correct', 'scan-ok']] });
      var it = state[rt].interp;
      if (it.ai && !blank(it.text) && !it.reviewed) items.push({ k: 'ai', text: 'The AI interpretation hasn’t been checked', acts: [['Read it', 'interp'], ['Looks right', 'interp-ok']] });
      var age = E.parseInput(state[rt].meta.age);
      if ((rt === 'screen' || rt === 'custom') && state[rt].pop === 'general' && age !== null && age > 60) {
        items.push({ k: 'age', text: 'Age ' + E.fmt(age) + ': there are no age-matched norms over 60, so the results are compared with all adults (the report says so)', acts: [] });
      }
    }
    if (withEx) {
      var nd = exNoDose().length;
      if (nd) items.push({ k: 'dose', text: nd + (nd === 1 ? ' exercise has' : ' exercises have') + ' no sets or reps', acts: [[ex ? 'Show me' : 'Open the program', 'dose']] });
    }
    return items;
  }
  var checkOpts = null;
  function openCheck(items, opts) {
    checkOpts = opts || {};
    $('checkTitle').textContent = 'Before you create the ' + (state.tool === 'ex' ? 'handout' : 'report');
    renderCheckList(items);
    openModal(els.checkDialog, els.checkBack);
  }
  function renderCheckList(items) {
    els.checkList.innerHTML = items.map(function (x) {
      return '<li class="ck-item"><span class="ck-t">' + statusIcon('Amber') + esc(x.text) + '</span>' +
        (x.acts.length ? '<span class="ck-acts">' + x.acts.map(function (a) { return '<button type="button" class="quiet" data-check="' + a[1] + '">' + esc(a[0]) + '</button>'; }).join('') + '</span>' : '') + '</li>';
    }).join('');
    $('checkIntro').textContent = items.length ? 'Worth a look first:' : 'All checked.';
    els.checkGo.textContent = items.length ? 'Create anyway' : (state.tool === 'ex' ? 'Create handout' : 'Create report');
  }
  function onCheckClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b === els.checkBack) { closeModal(); return; }
    if (b === els.checkGo) { var o = checkOpts || {}; closeModal(false); openReport(Object.assign({}, o, { checked: true })); return; }
    var a = b.dataset.check;
    if (!a) return;
    if (a === 'scan-ok') { state[state.tool].scanned = {}; applyScanMarks(); saveDraft(); renderCheckList(preflightItems()); return; }
    if (a === 'interp-ok') { interpOk(true); renderCheckList(preflightItems()); return; }
    closeModal(false);
    if (a === 'typo') gotoCheck();
    else if (a === 'scan') gotoScanned();
    else if (a === 'interp') gotoInterp();
    else if (a === 'dose') gotoNoDose();
  }
  function gotoScanned() {                             // the first box still carrying a scan's highlight
    var el = els.entry.querySelector('.scanned');
    if (!el) return;
    var row = el.closest('.metric');
    if (row) revealRow(row); else el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }, 350);
  }
  function gotoNoDose() {                              // the first exercise with no sets or reps (opening the builder first from a report)
    var first = exNoDose()[0];
    if (!first) return;
    var away = state.tool !== 'ex';
    if (away) gotoProgram();
    setTimeout(function () {
      var row = $('ex-' + first.id), inp = $('ex-' + first.id + '-sets');
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (inp) setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }, 350);
    }, away ? 300 : 0);
  }
  // the rows with no sets or reps are outlined as the program is built (the check before Create handout counts them)
  function applyExDose() {
    els.entry.querySelectorAll('.ex-row[data-id]').forEach(function (row) {
      var it = exItem(row.dataset.id);
      row.classList.toggle('nodose', !!(it && exFilled(it) && blank(it.sets) && blank(it.reps)));
    });
  }
  // opts (v35): quiet (made again from the report view: no "Saved" message), focus (the id of what takes focus after)
  // v48: checked (the check before creating was seen, or doesn't apply)
  function openReport(opts) {
    opts = opts && typeof opts === 'object' && !opts.target ? opts : {};   // (a click event is no options)
    if (!opts.checked && !opts.quiet) {
      var open = preflightItems();
      if (open.length) { openCheck(open, opts); return; }
    }
    var lt0 = linkedTool(), withEx = state.tool === 'ex' || (lt0 && lt0 === state.tool && exCounts().exercises > 0);
    var urls = withEx ? handoutPhotoUrls().filter(function (u) { return !photoData[u]; }) : [];
    if (!urls.length) { openReportNow(opts); return; }
    if (photoWait) return;
    photoWait = true;
    var slow = setTimeout(function () { toast('Loading the exercise photos…'); }, 600);
    loadPhotos(urls, 8000).then(function () {
      clearTimeout(slow);
      photoWait = false;
      if (!els.toast.hidden && els.toast.textContent === 'Loading the exercise photos…') els.toast.hidden = true;
      openReportNow(opts);
    });
  }
  function openReportNow(opts) {
    opts = opts || {};
    var ex = state.tool === 'ex', t = state.tool, lt = linkedTool();
    // v19: a report with its linked program (made from either side) is one PDF, the report's pages first
    var both = lt && (ex || lt === t) && exCounts().exercises > 0 ? lt : '';
    var built = both ? buildBoth(both) : ex ? buildHandout() : buildReport(t);
    if (!built) return;
    // v15: the exercise handout is saved to the client's record too (the program as printed)
    var saved = both ? saveBoth(both, built.program) : ex ? saveProgram(built.program) : saveSession(state.tool, compute());
    // v35: the program to the client's phone (the same link as before for this client), once it is in their record
    var sh = (both || ex) && built.share, phone = null;
    if (sh && CLOUD && CLOUD.share(sh.token, sh.copy, sh.expires)) {
      state.ex.share = { token: sh.token, key: sh.key, expires: sh.expires };
      saveDraft();
      CLOUD.sync();                                    // (after the record's upload, if that is under way)
      phone = { token: sh.token, url: sh.url, day: sh.day, first: sh.first, key: sh.key };
    }
    var example = exampleOnPage();                     // v48: the example is never saved, and the message says so
    if (saved) {
      if (!saved.ok) toast('The session couldn’t be saved to the client record (storage is full or blocked).');
      else {
        if (!both) markSaved(t);                       // v16: what is in the record now (Return home compares with it)
        if (!opts.quiet) toast(both ? (saved.replaced ? 'Updated ' + saved.name + '’s record for this date' : 'Saved the report and the program to ' + saved.name + '’s record')
          : saved.replaced ? 'Updated ' + saved.name + '’s record for this date' : 'Saved to ' + saved.name + '’s record (' + saved.count + (saved.count === 1 ? ' session)' : ' sessions)'));
      }
      refresh();
    } else if (example && !opts.quiet) toast('Example report — nothing is saved to a record');
    homeFrom = { tool: both || t, name: saved && saved.ok ? saved.name : '', saved: !!(saved && saved.ok), example: example };
    els.back.textContent = '‹ ' + (ex ? 'Back to the program' : 'Back to results');
    // v20: a Screening report made without a program: the report view offers one too (where Matthew looked for it once
    // the report was made); the program then prints after this report, in the same PDF
    var offer = !ex && !both ? t : '';
    els.sheetEx.hidden = !offer;
    els.sheetEx.dataset.tool = offer;
    if (offer) $('sheetExQ').textContent = 'Exercises for this ' + person(offer) + '?';   // athlete on the Performance screen (v9 wording)
    current = { file: null, blob: null, title: built.rep.title, ex: !!(both || ex), phone: phone };   // v35: + the program's phone link
    pastView = null; els.home.hidden = false;         // v39: (Return home is hidden for a report made again from the record)
    renderPhoneCard();
    els.sheetTitle.innerHTML = esc(built.rep.title) + '<small>' + esc(built.file) + '</small>';
    showSheet(built, opts.focus);
  }
  // the report view with the PDF's pages (built from built.rep), Share and Save; focus: the id of what takes focus after
  function showSheet(built, focus) {
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
      var f = focus && $(focus);                       // v35: made again from the phone card: focus stays there
      (f || (share ? els.share : els.save)).focus();
    }).catch(function (err) {
      if (gen !== reportGen) return;
      els.pages.innerHTML = '<p class="sheet-msg">The PDF couldn’t be built: ' + esc(err && err.message) + '</p>';
      els.home.disabled = false;                       // the session was saved all the same
    });
  }
  function closeReport() {
    els.sheet.hidden = true;
    document.documentElement.style.overflow = '';
    if (pastView) {                                    // v39: back to the client's page, on the report's row
      var pv = pastView;
      pastView = null;
      els.home.hidden = false;
      var row = homeView && clientPage ? els.homeSec.querySelector('[data-cp="test:' + pv.tool + '|' + pv.date + '"]') : null;
      if (row) focusQuiet(row);
    }
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
    if (els.sheet.hidden || pastView) return;          // v39: (a report from the record has no Return home)
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
      return JSON.stringify([sortedPairs(x.meta), clean1(x.title), String(x.instructions || '').trim(), rows, String(x.rationale || '').trim(),   // v25: + rationale
        String(x.reason || '').trim(), x.weeks || '', x.review || '', !!x.large].concat(x.photos === false ? ['no photos'] : [], phoneOn() ? ['phone'] : []));   // v32: + the cover and large print; v34: photos switched off; v35: on their phone
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
      if (t === 'ex' ? (linkedTool() && isExample(linkedTool())) : isExample(t)) return false;   // v48: the example is never saved, so never "unsaved"
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
    // v36: the Custom battery's population and tests are the clinic's set-up for the session, not the client's: they stay
    var cu = t === 'custom' ? customSetup() : null;   // v43: + the clinic battery it runs
    state[t] = freshTool(t, keep);
    if (cu) Object.assign(state[t], cu);
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
    if (scanBusy[t]) { bumpScan(t); delete scanBusy[t]; }
    if (t === 'ex' && suggestBusy) { bumpScan('ex'); suggestBusy = false; }   // v21
    delete scanInfo[t];
    delete coachOpen[t]; delete interpOpen[t];
    if (t === 'ex') exTopOpen = false;
    retest.tool = null;
  }
  function onHome() {
    if (els.home.disabled || els.sheet.hidden) return;
    var list = unsavedTools();
    if (!list.length) { goHome(false); return; }
    els.homeList.innerHTML = list.map(function (t) {
      return '<li class="has-data"><span class="cl-t">' + esc(toolName(t)) + '</span><span class="cl-d">' + esc(contentLine(t)) + '</span></li>';
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
      Object.keys(gone).forEach(function (t) { if (scanBusy[t]) { bumpScan(t); delete scanBusy[t]; } delete scanInfo[t]; });   // v41: each page's own
      if (suggestBusy && gone.ex) { bumpScan('ex'); suggestBusy = false; }   // v21
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
      try { localStorage.setItem(draftKey(), draftJson()); } catch (e) { /* storage unavailable */ }
      closePick(false);
      render();
      showHome(true);                                  // v30: the home screen (until v29, the Screening page)
      keepAwake();                                     // nothing entered now: the screen may sleep again
      toast(homeMessage(from, st, !gone[from.tool]), { label: 'Undo', run: function () { undoHome(snap, wasLoaded); } });
    });
  }
  // 'Uploaded to Jane Doe’s clinic record — ready for the next client' and the like
  function homeMessage(from, st, kept) {
    var who = from.name ? from.name + '’s' : 'the client’s', lead;
    if (from.example) lead = 'Example results cleared, nothing saved';   // v48
    else if (!from.saved) lead = 'Not saved to a client record';
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
    try { localStorage.setItem(draftKey(), draftJson()); } catch (e) { /* storage unavailable */ }
    closePick(false);
    leaveHome();                                       // v30: back on the page it was
    render();
    window.scrollTo(0, 0);
    keepAwake();
    focusQuiet(pickBtn());
    toast('Back as it was');
  }

  // ------------------------------------------------------------------ v30: the home screen
  // The app opens on Home: a greeting, a client search, a card for anything in progress and a tile for every part of the
  // app (the four tests; Photo to handout, Build a program, the library and the templates). Return home and the logo come
  // back to it. The page in use stays drawn underneath (html.home-on hides it), so everything that refreshes it keeps
  // working, and the Screening and Exercises tabs open their sections where they were left. A tile whose page holds
  // entries asks first: carry on with them, or start afresh (Undo). #continue in the address opens where the app left off
  // instead (the test suites and bookmarks).
  var homeView = location.hash !== '#continue', homeBuilt = false, homeAskFor = null, homeClientFor = null;
  var clientPage = null;                               // v39: { key } while a client's page shows on Home
  var homeSub = '';                                    // v41: 'screening', 'ex' or 'photo' while one of Home's buttons' pages shows
  var pastView = null;                                 // v39: { key, tool, date } while a report from their record is on screen
  function homeSvg(paths) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>'; }
  var HOME_ICON = {
    screen: homeSvg('<path d="M3 12h3.5l2.5-6.5 4 13 2.5-6.5H21"/>'),                                                     // a trace: the jump, strength and speed tests
    str: homeSvg('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'),                                  // a dumbbell
    ham: homeSvg('<circle cx="15" cy="4.2" r="1.9"/><path d="M13.6 7.6 10.8 13l3.6 2.4-1.6 5.6"/><path d="M10.8 13 7 15.2 4.5 14"/><path d="M13.6 7.6 17 9.6l2.4-1.8"/><path d="M13.6 7.6 10 8.4 8.4 11"/>'),   // a sprinter: back to running
    acl: homeSvg('<path d="M9.5 3v5.8a2.6 2.6 0 0 0 5.2 0V3"/><path d="M9.5 21v-4.8a2.6 2.6 0 0 1 5.2 0V21"/><circle cx="18" cy="12.2" r="1.7"/><path d="M11 10.8l2.4 2.6"/>'),   // a knee: the bone ends, the kneecap and the ligament
    ankle: homeSvg('<path d="M8.5 3v10.6c0 1.1-.5 2-1.1 2.8-1 1.4-.4 3.6 1.5 3.6h11.2a1.3 1.3 0 0 0 .6-2.4l-4.9-2.6a4.6 4.6 0 0 1-2.4-4V3"/><circle cx="11.2" cy="14.4" r="1.15"/>'),   // v42: a lower leg and foot, the ankle bone marked
    custom: homeSvg('<path d="M4 6.5h2.5M4 12h2.5M4 17.5h2.5"/><path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M7.2 5.2 5.4 7.6 4.3 6.6"/><path d="M7.2 10.7 5.4 13.1 4.3 12.1"/>'),   // v36: a list with ticks: the tests chosen
    photo: homeSvg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
    bat: homeSvg('<path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="M3.5 12 12 16.5 20.5 12"/><path d="M3.5 16 12 20.5 20.5 16"/>'),   // v43: a clinic battery: stacked layers
    bbuild: homeSvg('<path d="M4 6.5h9M4 12h9M4 17.5h6"/><path d="M18 13.5v7M14.5 17h7"/>'),   // v43: the Battery builder: a list and a plus
    builder: homeSvg('<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9zM8.5 11h7M8.5 15h4.5"/>'),
    library: homeSvg('<path d="M3 5.5c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1z"/><path d="M12 6.5v13"/>'),
    templates: homeSvg('<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M5 17V5.5A2.5 2.5 0 0 1 7.5 3H16"/>'),
    search: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    go: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
  };
  var HOME_LINE = {
    screen: 'ForceDecks, NordBord, ForceFrame, DynaMo and SmartSpeed against the norms.',
    str: 'Each leg’s load, force or reps: asymmetry and capacity.',
    ham: 'Injured-limb results against the targets for the rehab phase.',
    acl: 'Injured-limb and symmetry results against ACLR norms for the phase.',
    ankle: 'Lateral ankle sprain: four tests and three questionnaires, out of 25.',   // v42
    custom: 'Pick any tests, or photograph your notes, and score them against the norms.',   // v36
    photo: 'Photograph a handwritten program and get a neat, printable handout.',
    builder: 'Pick from the library, type exercises or start from a template.',
    library: 'The clinic’s exercises: doses, handout cues and video links.'
  };
  function homeLine(k) { return k === 'templates' ? (CLOUD ? 'Saved programs to start from, shared by the clinic.' : 'Saved programs to start from, kept on this device.') : HOME_LINE[k]; }
  function syncTabs() {
    var section = homeView ? (homeSub === 'screening' || homeSub === 'builder' ? 'screening' : homeSub === 'ex' ? 'ex' : 'home') : state && state.tool === 'ex' ? 'ex' : 'screening';   // v41: Home's Screening and Exercise programming pages; v43: the Battery builder is Screening's
    document.querySelectorAll('.tools button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.section === section)); });
  }
  // what a tile would find: entries of a client's (the practitioner's own name and the date don't count); a program that
  // goes with a report counts once it has exercises or a title of its own
  function homeBusy(t) { return t === 'ex' ? exHasContent() || (!state.ex.link && clientContent('ex')) : clientContent(t); }
  function homeInProgress() {
    var order = [state.tool].concat(TOOLS, ['ex']);
    return order.filter(function (t, i) { return order.indexOf(t) === i && homeBusy(t); });
  }
  function homeHello() {
    var h = new Date().getHours(), nm = clean1(userName()), first = nm.split(' ')[0];
    if (/^(dr|mr|mrs|ms|miss|prof)\.?$/i.test(first)) first = nm;   // 'Dr Smith', not 'Dr'
    return 'Good ' + (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening') + (first ? ', ' + first : '');
  }
  function homeDate() {
    try { return new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return ''; }
  }
  function buildHome() {
    els.homeSec.innerHTML =
      '<div class="home-top"><div class="home-hello"><h1 id="homeHello" tabindex="-1"></h1><p id="homeDate"></p></div>' +
      '<div class="home-find" role="search"><label class="client-search" for="homeSearch">' + HOME_ICON.search + '<span class="vh">Find a client by name</span>' +
      '<input id="homeSearch" type="search" placeholder="Find a client" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-controls="homeSugg"></label>' +
      '<div class="suggest home-sugg" id="homeSugg" hidden></div></div></div>' +
      '<nav class="home-hubs" id="homeHubs" aria-label="Start"></nav>' +   // v41: Photo mode, Screening, Exercise programming
      '<section class="home-cont" id="homeCont" aria-labelledby="homeContH" hidden></section>' +
      '<section class="home-check" id="homeCheck" aria-labelledby="homeCheckH" hidden></section>' +   // v40: the check-ins
      '<div class="hsub" id="hsub"></div>' +             // v41: the page a button opens, drawn in place of the rest
      '<div class="cpage" id="cpage"></div>';           // v39: a client's page, drawn in place of the rest
    homeBuilt = true;
  }
  function homeTile(title, line, icon, busy) {
    return '<span class="tile-ic">' + icon + '</span><span class="tile-text"><b>' + esc(title) + '</b><small>' + esc(line) + '</small>' +
      (busy ? '<span class="tile-badge">' + esc(busy) + '</span>' : '') + '</span>';
  }
  function renderHome() {
    if (!state) return;
    if (!homeBuilt) buildHome();
    if (clientPage && !clients.clients[clientPage.key]) clientPage = null;   // v39: their record was deleted meanwhile
    var sub = clientPage ? '' : homeSub;
    els.homeSec.classList.toggle('cp-on', !!clientPage);
    els.homeSec.classList.toggle('sub-on', !!sub);     // v41
    els.homeSec.setAttribute('aria-labelledby', clientPage ? 'cpName' : sub ? 'hsubH' : 'homeHello');
    if (clientPage) { renderClientPage(); return; }
    if (sub) { renderHomeSub(); return; }              // v41: Screening, Exercise programming or Photo mode
    var a = document.activeElement, holder = a && a.closest && els.homeSec.contains(a) ? a.closest('[data-home]') : null, keep = holder ? holder.getAttribute('data-home') : null;   // focus kept across a redraw
    $('homeHello').textContent = homeHello();
    $('homeDate').textContent = homeDate();
    renderCheckins();                                  // v40
    var cont = homeInProgress(), cs = $('homeCont');
    cs.hidden = !cont.length;
    cs.innerHTML = !cont.length ? '' : '<h2 id="homeContH">Continue where you left off</h2><div class="cont-list">' + cont.map(function (t) {
      return '<button type="button" class="cont-card" data-home="cont:' + t + '"><span class="tile-ic">' + HOME_ICON[t === 'ex' ? 'builder' : t === 'custom' && state.custom.batId ? 'bat' : t] + '</span>' +
        '<span class="cont-text"><b><span class="vh">Continue: </span>' + esc(t === 'ex' ? 'Exercise program' : toolHead(t)) + '</b><small>' + esc(contentLine(t)) + '</small></span>' +
        '<span class="cont-go">' + HOME_ICON.go + '</span></button>';
    }).join('') + '</div>';
    $('homeHubs').innerHTML = hubsHtml();               // v41: until v40 the tiles of every tool and Exercises page
    if (keep) {
      var back = els.homeSec.querySelector('[data-home="' + keep + '"]');
      if (back) focusQuiet(back.tagName === 'LABEL' ? back.querySelector('input') : back);
    }
    if ($('homeSearch') && !$('homeSugg').hidden) homeSuggest();   // a client saved elsewhere meanwhile
  }
  function showHome(focus) {
    closePick(false);
    hideSuggest();
    clientPage = null;                                 // v39: Home itself (a client's page is opened from it)
    setHomeSub('');                                    // v41: and none of its buttons' pages
    homeView = true;
    document.documentElement.classList.add('home-on');
    renderHome();
    syncTabs();
    window.scrollTo(0, 0);
    if (focus) focusQuiet($('homeHello'));
  }
  function leaveHome() {
    if (!homeView) return;
    homeView = false;
    setHomeSub('');                                    // v41: Photo mode's photos go with it
    document.documentElement.classList.remove('home-on');
    var box = $('homeSugg'), find = $('homeSearch');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (find) find.value = '';                         // a name searched for has been dealt with
    syncTabs();
  }
  // ------------------------------------------------------------------ v41: Home's three buttons and the pages they open
  // Matthew (6 Oct): "I want "photo mode" as its own section then screening tools as its own section and Exercise
  // Programming as the 3rd button on the home screen. Then clicking on screening for example takes you to the screening
  // page where you pic what battery your want to use (custom is included in this). The same for Exercise program."
  // His choices for Photo mode: Results + exercises first; the battery picked by the clinician (never guessed from the
  // photo); the results and the exercise page taken as two photo steps; the three buttons at the top of Home, Continue
  // and Check-ins under them. Each page is drawn on Home in place of the rest, as a client's page is (homeSub).
  var HUBS = [
    ['photo', 'Photo mode', 'Photograph the results and the exercise page at the end of the appointment: the report and the handout, ready to send.'],
    ['screening', 'Screening', 'Choose the battery: Performance & readiness, LL Strength, Hamstring, ACL or Ankle-GO rehab, or a Custom battery.'],   // v48: + Ankle-GO
    ['ex', 'Exercise programming', 'Build a program, or open the exercise library and the program templates.']
  ];
  var BACK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
  var hsubDrawn = '';
  function hubsHtml() {
    var busy = { photo: false, screening: TOOLS.some(function (t) { return homeBusy(t); }), ex: homeBusy('ex') };
    var icon = { photo: HOME_ICON.photo, screening: HOME_ICON.screen, ex: HOME_ICON.builder };
    return HUBS.map(function (h) {
      return '<button type="button" class="hub hub-' + h[0] + '" data-home="hub:' + h[0] + '"><span class="tile-ic">' + icon[h[0]] + '</span>' +
        '<span class="hub-text"><b>' + esc(h[1]) + '</b><small>' + esc(h[2]) + '</small>' + (busy[h[0]] ? '<span class="tile-badge">In progress</span>' : '') + '</span>' +
        '<span class="hub-go">' + HOME_ICON.go + '</span></button>';
    }).join('');
  }
  function setHomeSub(sub) {
    if (homeSub === 'photo' && sub !== 'photo') pmReset();   // Photo mode's photos and choices go when it is left
    homeSub = sub;
    hsubDrawn = '';
    var box = $('hsub');
    if (box && !sub) box.innerHTML = '';
  }
  function openHomeSub(sub) {
    if (['photo', 'screening', 'ex', 'builder', 'team'].indexOf(sub) < 0) return;   // v43: + the Battery builder; v46: + Team
    closePick(false);
    hideSuggest();
    if (!homeView) { homeView = true; document.documentElement.classList.add('home-on'); }
    clientPage = null;
    setHomeSub(sub);
    renderHome();
    syncTabs();
    window.scrollTo(0, 0);
    focusQuiet($('hsubH'));
  }
  function closeHomeSub() {
    var was = homeSub;
    setHomeSub('');
    renderHome();
    syncTabs();
    window.scrollTo(0, 0);
    focusQuiet(els.homeSec.querySelector('[data-home="hub:' + was + '"]') || $('homeHello'));
  }
  function subHeadHtml(title, line, backAttr, backLabel, cls) {   // v47: cls (the Screening page's photo band)
    return '<button type="button" class="cp-back quiet" ' + (backAttr || 'data-home="back"') + '>' + BACK_SVG + esc(backLabel || 'Home') + '</button>' +
      '<div class="cp-head' + (cls ? ' ' + cls : '') + '"><h1 id="hsubH" tabindex="-1">' + esc(title) + '</h1>' + (line ? '<p>' + esc(line) + '</p>' : '') + '</div>';
  }
  // the page drawn only when it changed (a sync redraws Home: Photo mode's search box and its keyboard stay put)
  function renderHomeSub() {
    var box = $('hsub'), html = homeSub === 'photo' ? photoModeHtml() : homeSub === 'ex' ? exHubHtml() : homeSub === 'builder' ? builderHtml() : homeSub === 'team' ? teamHtml() : screenHubHtml();   // v46: + Team
    if (html === hsubDrawn && box.innerHTML) return;
    var a = document.activeElement, inBox = a && box.contains(a);
    var keep = inBox ? (a.id || a.getAttribute('data-pm') || a.getAttribute('data-home') || (a.getAttribute('data-pm-files') ? 'files:' + a.getAttribute('data-pm-files') : '') ||
      (a.getAttribute('data-bld') ? 'bld:' + a.getAttribute('data-bld') : '') || (a.getAttribute('data-bcat') ? 'bcat:' + a.getAttribute('data-bcat') : '')) : '';   // v43: + the builder's
    box.innerHTML = html;
    hsubDrawn = html;
    var find = $('pmFind');
    if (find && pm) find.value = pm.q;
    if (!keep) return;
    function by(attr, v) { var hit = null; box.querySelectorAll('[' + attr + ']').forEach(function (x) { if (!hit && x.getAttribute(attr) === v) hit = x; }); return hit; }
    var to = (/^[A-Za-z][\w-]*$/.test(keep) ? $(keep) : null) || by('data-pm', keep) || by('data-home', keep) || (keep.indexOf('files:') === 0 ? by('data-pm-files', keep.slice(6)) : null) ||
      (keep.indexOf('bld:') === 0 ? by('data-bld', keep.slice(4)) : null) || (keep.indexOf('bcat:') === 0 ? by('data-bcat', keep.slice(5)) : null);
    focusQuiet(to || $('hsubH'));
    if (to && (to.id === 'pmFind' || to.id === 'bldFind' || to.id === 'bldName' || to.id === 'bldAbout' || to.id === 'bldPct')) { try { to.setSelectionRange(to.value.length, to.value.length); } catch (e) { /* not a text box */ } }
  }
  // v43: the clinic's batteries (each its own tile) and the Battery builder, under the app's six. The Custom page runs one of
  // them or Custom on the spot: the In progress badge goes on the one it holds
  function batTileLine(b) { return b.about || (batteryLineFor(b.items) + ' \u00b7 ' + batPopLabel(b)); }
  function screenHubHtml() {
    var bats = tileBats(), run = state.custom.batId || '', cbusy = homeBusy('custom'), runShown = !!run && bats.some(function (b) { return b.id === run; });
    return subHeadHtml('Screening', 'Choose the battery. Results on paper or in the VALD app? Photo mode reads them for you.', '', '', 'cp-photo cp-screen') +   // v47: the testing room behind the heading
      '<div class="home-tiles" id="homeTests">' + TOOLS.map(function (t) {
        var busy = t === 'custom' ? cbusy && !runShown : homeBusy(t);
        return '<button type="button" class="tile" data-home="tool:' + t + '">' + homeTile(HEAD[t][0], homeLine(t), HOME_ICON[t], busy ? 'In progress' : '') + '</button>';
      }).join('') + '</div>' +
      '<section class="hsub-sec" aria-labelledby="homeBatsH"><h2 class="hsub-h2" id="homeBatsH">The clinic\u2019s batteries</h2>' +
      '<div class="home-tiles" id="homeBats">' + bats.map(function (b) {
        return '<button type="button" class="tile" data-home="bat:' + esc(b.id) + '">' + homeTile(b.name, batTileLine(b), HOME_ICON.bat, cbusy && run === b.id ? 'In progress' : '') + '</button>';
      }).join('') +
      '<button type="button" class="tile tile-bld" data-home="builder">' + homeTile('Battery builder', bats.length ? 'Make or change the clinic\u2019s batteries, and add tests with your own targets.'
        : 'Make the clinic\u2019s own batteries, and add tests the app doesn\u2019t have, each with your own target.', HOME_ICON.bbuild, '') + '</button></div></section>' +
      '<p class="hsub-note">Photographed results? <button type="button" class="quiet hsub-link" data-home="hub:photo">Open Photo mode</button></p>';
  }
  function exHubHtml() {
    var exBusy = homeBusy('ex');
    return subHeadHtml('Exercise programming', 'Build a program for a client, or keep the clinic’s exercise library and templates up to date.', '', '', 'cp-photo cp-ex') +   // v47: two practitioners at a laptop
      '<div class="home-tiles" id="homeEx">' +
      '<button type="button" class="tile" data-home="ex:builder">' + homeTile('Build a program', homeLine('builder'), HOME_ICON.builder, exBusy ? 'In progress' : '') + '</button>' +
      '<button type="button" class="tile" data-home="ex:library">' + homeTile('Exercise library', homeLine('library'), HOME_ICON.library, '') + '</button>' +
      '<button type="button" class="tile" data-home="ex:templates">' + homeTile('Program templates', homeLine('templates'), HOME_ICON.templates, '') + '</button></div>' +
      '<p class="hsub-note">A handwritten program? <button type="button" class="quiet hsub-link" data-home="hub:photo">Open Photo mode</button></p>';
  }

  // ------------------------------------------------------------------ v41: Photo mode
  // Results + exercises: the client (their record brings last time's results; the name never goes to Claude), the battery
  // (the last one used ticked), photos of the results, photos of the exercise page, the usual questions; then both are read
  // at once and the battery's page opens with the results filled in for checking and the program linked to it (Create
  // report + exercises makes the one PDF). Screening results: the same without the exercise page. Exercise prescription:
  // Photo to handout, as on Home until v40 (the picker itself; Add to it or Start a new program while one is in progress).
  // pm: { kind: 'both' | 'results', step, who: { key, name } (key '' and name '' when skipped), tool, r: [photos], x: [photos],
  // urls: { r: [], x: [] } (the thumbnails), q (typed in the search), msg }
  var pm = null;
  var PM_STEPS = { both: ['client', 'battery', 'results', 'ex'], results: ['client', 'battery', 'results'] };
  var PM_LABEL = { client: 'Client', battery: 'Battery', results: 'Results', ex: 'Exercise page' };
  function pmReset() {
    if (pm) ['r', 'x'].forEach(function (k) { pm.urls[k].forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }); });
    pm = null;
  }
  function pmStart(kind) {
    pmReset();
    pm = { kind: kind, step: 'client', who: null, tool: '', r: [], x: [], urls: { r: [], x: [] }, q: '', msg: '' };
    pmDraw('#hsubH');
  }
  function pmDraw(focusSel) {
    renderHome();
    window.scrollTo(0, 0);
    var el = focusSel ? els.homeSec.querySelector(focusSel) : null;
    focusQuiet(el || $('hsubH'));
  }
  function photoModeHtml() {
    if (!pm) {
      var exBusy = homeBusy('ex'), exOpt = homeTile('Exercise prescription', 'Photograph a handwritten program and get a neat, printable handout.', HOME_ICON.builder, '');
      return subHeadHtml('Photo mode', 'For the end of the appointment: photograph what you wrote down or the VALD app’s results. Claude reads them; you check before anything is made.') +
        '<div class="pm-opts">' +
        '<button type="button" class="tile pm-opt pm-main" data-pm="start:both">' + homeTile('Results + exercises', 'Photograph the screening results, then the exercise page. The report and the handout come together in one PDF, ready to send to their phone.', HOME_ICON.photo, '') + '</button>' +
        '<button type="button" class="tile pm-opt" data-pm="start:results">' + homeTile('Screening results', 'VALD screenshots or handwritten results fill a battery’s boxes, highlighted for checking.', HOME_ICON.screen, '') + '</button>' +
        // the photo picker itself, as Photo to handout was; with a program in progress it asks first
        (exBusy ? '<button type="button" class="tile pm-opt" data-home="photo">' + exOpt + '</button>'
          : '<label class="tile pm-opt file-btn" data-home="photo">' + exOpt + '<input type="file" accept="image/*" multiple data-scan-mode="fresh" aria-label="Exercise prescription: take or choose photos of a handwritten exercise program, several pages at once"></label>') +
        '</div>';
    }
    var steps = PM_STEPS[pm.kind], at = steps.indexOf(pm.step);
    var html = subHeadHtml(pm.kind === 'both' ? 'Results + exercises' : 'Screening results', '', 'data-pm="options"', 'Photo mode') +
      '<ol class="pm-steps" aria-label="Steps">' + steps.map(function (st, i) {
        var val = pmStepValue(st), inner = '<span class="n" aria-hidden="true">' + (i < at ? '✓' : i + 1) + '</span><span class="lab"><b>' + esc(PM_LABEL[st]) + '</b>' + (i < at && val ? '<small>' + esc(val) + '</small>' : '') + '</span>';
        return '<li class="' + (i < at ? 'done' : i === at ? 'cur' : '') + '"' + (i === at ? ' aria-current="step"' : '') + '>' +
          (i < at ? '<button type="button" class="pm-st" data-pm="step:' + st + '"><span class="vh">Change the </span>' + inner + '</button>' : '<span class="pm-st">' + inner + '</span>') + '</li>';
      }).join('') + '</ol>';
    html += '<section class="pm-card" aria-labelledby="pmStepH">' + (pm.step === 'client' ? pmClientHtml() : pm.step === 'battery' ? pmBatteryHtml() : pmPhotosHtml(pm.step === 'results' ? 'r' : 'x')) +
      (pm.msg ? '<p class="pm-msg" role="alert">' + esc(pm.msg) + '</p>' : '') + '</section>';
    return html;
  }
  function pmStepValue(st) {
    if (st === 'client') return pm.who ? (pm.who.name || 'No name yet') : '';
    if (st === 'battery') return pm.tool ? (pm.tool === 'custom' && pm.bat ? (batGet(pm.bat) || { name: TOOL_NAMES.custom }).name : TOOL_NAMES[pm.tool]) : '';   // v43: + the clinic's batteries
    var n = pm[st === 'results' ? 'r' : 'x'].length;
    return n ? n + (n === 1 ? ' photo' : ' photos') : 'Skipped';
  }
  function pmClientHtml() {
    return '<h2 id="pmStepH">Who is it for?</h2><p class="pm-lead">Their record brings last time’s results to compare. The name is never sent to Claude.</p>' +
      '<label class="client-search pm-find" for="pmFind">' + HOME_ICON.search + '<span class="vh">Find or add a client</span>' +
      '<input id="pmFind" type="search" placeholder="Find or add a client" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-controls="pmSugg"></label>' +
      '<div class="pm-list" id="pmSugg">' + pmListHtml() + '</div>' +
      '<div class="pm-acts"><button type="button" class="quiet pm-skip" data-pm="noname">Skip: add the name later</button></div>';
  }
  // the clients matching what is typed (and a new one by that name), or the most recent when nothing is typed
  function pmListHtml() {
    var typed = clean1(pm.q), k = E.nameKey(typed), keys;
    function row(key) {
      var cl = clients.clients[key], n = cl.sessions.length, last = '';
      cl.sessions.forEach(function (x) { if (x.date > last) last = x.date; });
      return '<button type="button" class="pm-row" data-pm="client:' + esc(key) + '"><span class="pm-row-text"><b>' + esc(cl.name) + '</b><small>' + n + (n === 1 ? ' session' : ' sessions') + (last ? ' · last ' + esc(E.displayIso(last)) : '') + '</small></span>' + HOME_ICON.go + '</button>';
    }
    if (!k) {
      keys = clientKeys().map(function (key) { var last = ''; clients.clients[key].sessions.forEach(function (x) { if (x.date > last) last = x.date; }); return [key, last]; })
        .filter(function (x) { return x[1]; }).sort(function (a, b) { return a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0; }).slice(0, 5).map(function (x) { return x[0]; });
      return keys.length ? '<p class="pm-list-h">Recent clients</p>' + keys.map(row).join('') : '<p class="pm-hint">Type a name to find a client, or to add a new one.</p>';
    }
    keys = clientKeys().filter(function (key) { return key.indexOf(k) >= 0; }).slice(0, 6);
    var html = keys.map(row).join('');
    if (!clients.clients[k] && typed.length >= 2) html += '<button type="button" class="pm-row pm-new" data-pm="new"><span class="pm-row-text"><b>New client: ' + esc(typed) + '</b><small>no record yet</small></span>' + HOME_ICON.go + '</button>';
    return html || '<p class="pm-hint">No client by that name yet. Keep typing to add them.</p>';
  }
  function pmSuggest() {
    var box = $('pmSugg'), find = $('pmFind');
    if (!box || !find || !pm) return;
    pm.q = find.value.slice(0, 120);
    box.innerHTML = pmListHtml();
    hsubDrawn = photoModeHtml();
  }
  // the battery used last: the page in progress, else the clinic's most recent screening in the records ('' on a new device)
  function pmLastTool() {
    if (TOOLS.indexOf(state.screenTool) >= 0 && homeBusy(state.screenTool)) return state.screenTool;
    var best = '', day = '';
    Object.keys(clients.clients || {}).forEach(function (k) { clients.clients[k].sessions.forEach(function (x) { if (TOOLS.indexOf(x.tool) >= 0 && x.date >= day) { day = x.date; best = x.tool; } }); });
    return best;
  }
  function pmBatteryHtml() {
    var cl = pm.who && pm.who.key ? clients.clients[pm.who.key] : null, last = {}, used = pmLastTool();
    if (cl) cl.sessions.forEach(function (x) { if (!last[x.tool] || x.date > last[x.tool]) last[x.tool] = x.date; });
    return '<h2 id="pmStepH">Which battery?</h2><p class="pm-lead">The results are scored against this battery’s norms.' + (used ? ' The one used last is marked.' : '') + '</p>' +
      '<div class="pm-list">' + TOOLS.map(function (t) {
        var bits = [];
        if (last[t]) bits.push('Last tested ' + E.displayIso(last[t]));
        else if (cl) bits.push('Not done yet');
        var spotPop = state.custom.batId ? (state.custom.spot ? state.custom.spot.pop : null) : state.custom.pop;   // v43: Custom on the spot's
        if (t === 'custom') bits.push(spotPop === null ? 'You choose who to compare against first' : 'Tests the photo holds are added');
        return '<button type="button" class="pm-row" data-pm="bat:' + t + '" aria-pressed="' + (pm.tool === t && (t !== 'custom' || !pm.bat)) + '"><span class="tile-ic">' + HOME_ICON[t] + '</span>' +
          '<span class="pm-row-text"><b>' + esc(HEAD[t][0]) + '</b>' + (bits.length ? '<small>' + esc(bits.join(' · ')) + '</small>' : '') + '</span>' +
          (t === used ? '<span class="cp-tag cur">Last used</span>' : '') + HOME_ICON.go + '</button>' +
          (t === 'custom' ? tileBats().map(function (b) {   // v43: the clinic's batteries
            return '<button type="button" class="pm-row" data-pm="cbat:' + esc(b.id) + '" aria-pressed="' + (pm.tool === 'custom' && pm.bat === b.id) + '"><span class="tile-ic">' + HOME_ICON.bat + '</span>' +
              '<span class="pm-row-text"><b>' + esc(b.name) + '</b><small>' + esc(batTileLine(b)) + '</small></span>' + HOME_ICON.go + '</button>';
          }).join('') : '');
      }).join('') + '</div>';
  }
  function pmPhotosHtml(k) {
    var files = pm[k], n = files.length, both = pm.kind === 'both', res = k === 'r', max = (res ? scanCfg() : exScanCfg()).max_photos || 6;
    var html = '<h2 id="pmStepH">' + (res ? 'Photograph the results' : 'Photograph the exercise page') + '</h2>' +
      '<p class="pm-lead">' + (res ? 'VALD app screenshots or your handwritten notes, up to ' + max + ' photos.' : 'The handwritten program, one photo a page (up to ' + max + '). A few quick questions come next.') + '</p>' +
      '<label class="pm-shot file-btn' + (n ? ' more' : '') + '">' + CAMERA + '<span>' + (n ? 'Add more photos' : 'Take or choose photos') + '</span>' +
      '<input type="file" accept="image/*" multiple data-pm-files="' + k + '" aria-label="' + esc((n ? 'Add more photos of ' : 'Take or choose photos of ') + (res ? 'the results' : 'the exercise page')) + '"></label>';
    if (n) {
      html += '<div class="pm-thumbs">' + pm.urls[k].map(function (u, i) { return '<img src="' + esc(u) + '" alt="Photo ' + (i + 1) + '">'; }).join('') + '</div>' +
        '<p class="pm-count" role="status">' + n + (n === 1 ? ' photo' : ' photos') + (n > max ? ' (only the first ' + max + ' are read)' : '') + ' <button type="button" class="quiet" data-pm="clear:' + k + '">Remove ' + (n === 1 ? 'it' : 'them') + '</button></p>';
    }
    var go = res ? (both ? 'Next: the exercise page' : 'Read the results') : 'Next: a few questions';
    html += '<div class="pm-acts"><button type="button" class="primary" data-pm="next"' + (n ? '' : ' disabled') + '>' + esc(go) + '</button>' +
      (both && (res || pm.r.length) ? '<button type="button" class="quiet pm-skip" data-pm="skip">' + (res ? 'Skip: no results photos' : 'Skip: no exercise page') + '</button>' : '') + '</div>';
    return html;
  }
  function pmNextStep() {
    var steps = PM_STEPS[pm.kind], i = steps.indexOf(pm.step);
    pm.step = steps[i + 1] || pm.step;
    pm.msg = '';
    pmDraw('#pmStepH');
  }
  function onPhotoModeClick(k) {
    var i = k.indexOf(':'), kind = i < 0 ? k : k.slice(0, i), arg = i < 0 ? '' : k.slice(i + 1);
    if (kind === 'start') { pmStart(arg === 'results' ? 'results' : 'both'); return; }
    if (!pm) return;
    if (kind === 'options') { pmReset(); pmDraw(null); focusQuiet(els.homeSec.querySelector('[data-pm="start:both"]') || $('hsubH')); return; }
    if (kind === 'step') { if (PM_STEPS[pm.kind].indexOf(arg) >= 0) { pm.step = arg; pm.msg = ''; pmDraw(arg === 'client' ? '#pmFind' : '#pmStepH'); } return; }
    if (kind === 'client' && clients.clients[arg]) { pm.who = { key: arg, name: clients.clients[arg].name }; pmNextStep(); return; }
    if (kind === 'new') { var nm = clean1(pm.q); if (nm.length >= 2) { pm.who = { key: '', name: nm }; pmNextStep(); } return; }
    if (kind === 'noname') { pm.who = { key: '', name: '' }; pmNextStep(); return; }
    if (kind === 'bat' && TOOLS.indexOf(arg) >= 0) { pm.tool = arg; pm.bat = arg === 'custom' ? '' : undefined; pmNextStep(); return; }
    if (kind === 'cbat' && batGet(arg)) { pm.tool = 'custom'; pm.bat = arg; pmNextStep(); return; }   // v43: one of the clinic's batteries
    if (kind === 'clear' && (arg === 'r' || arg === 'x')) {
      pm.urls[arg].forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } });
      pm[arg] = []; pm.urls[arg] = []; pm.msg = '';
      pmDraw('[data-pm-files="' + arg + '"]');
      return;
    }
    if (kind === 'skip') {
      if (pm.step === 'results') { pmClear('r'); pmNextStep(); }
      else if (pm.step === 'ex' && pm.r.length) { pmClear('x'); pmProceed(null); }
      return;
    }
    if (kind === 'next') {
      if (pm.step === 'results' && pm.r.length) { if (pm.kind === 'both') pmNextStep(); else pmProceed(null); }
      else if (pm.step === 'ex' && pm.x.length) pmAskThenGo();
    }
  }
  function pmClear(k) { pm.urls[k].forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }); pm[k] = []; pm.urls[k] = []; }
  function onPhotoModeFiles(input) {
    var k = input.dataset.pmFiles, files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!pm || (k !== 'r' && k !== 'x') || !files.length) return;
    var photos = files.filter(function (f) { return !f.type || f.type.indexOf('image/') === 0; });
    pm.msg = photos.length < files.length ? (photos.length ? 'Only photos can be read: ' + (files.length - photos.length) + (files.length - photos.length === 1 ? ' file was' : ' files were') + ' left out.' : 'That file isn’t a photo. Choose photos of ' + (k === 'r' ? 'the results.' : 'the exercise page.')) : '';
    photos.forEach(function (f) { pm[k].push(f); var u = ''; try { u = URL.createObjectURL(f); } catch (e) { u = ''; } pm.urls[k].push(u); });
    renderHome();
    focusQuiet(els.homeSec.querySelector(pm[k].length ? '[data-pm="next"]' : '[data-pm-files="' + k + '"]'));
  }
  // what reading needs: the AI settings file, a connection and the clinic's key (asked for once, then on it goes)
  function pmCanRead(then) {
    var msg = !DATA.ai || !scanCfg().model ? 'The AI settings file (interpretation.json) didn’t load. Reopen the app while online.'
      : navigator.onLine === false ? 'No internet connection. Connect to read the photos.' : '';
    if (msg) { pm.msg = msg; pmDraw('.pm-msg'); return false; }
    if (!aiKey()) {
      openAiSettings(function () { if (pm && aiKey()) then(); }, 'To read photos of your notes, VALD screenshots or an exercise page, the app needs a Claude API key. ' + ONCE_NOTE());
      return false;
    }
    return true;
  }
  function pmAskThenGo() {
    if (!pmCanRead(pmAskThenGo)) return;
    var files = pm.x.slice();
    openPhotoAsk(files, function (a) { if (pm) pmProceed(a); }, freshAsk());
  }
  function pmProceed(a) {
    if (!pm) return;
    if (pm.r.length && !pmCanRead(function () { pmProceed(a); })) return;
    var f = pm, t = f.tool, who = f.who || { key: '', name: '' }, rs = f.r.slice(), xs = f.x.slice();
    if (!rs.length && !xs.length) return;
    var want = who.key || E.nameKey(who.name), undos = [];
    if (!rs.length) {                                  // the exercise page only (the results skipped): a new program for them
      var had = homeBusy('ex'), ux = clearForClient('ex');
      if (had) undos.push(ux);
      if (who.name) state.ex.meta.name = who.name;
      openTool('ex', 'builder');
      if (a) { state.ex.ask = a; saveDraft(); }
      startScan(xs, { tool: 'ex', ask: a });
    } else {
      // the battery's page for them: another client's entries are cleared first (Undo); theirs carry on
      // v43: the shared Custom page holding another battery is cleared too; then it is set up for the battery chosen
      var swap = t === 'custom' && typeof f.bat === 'string' && (state.custom.batId || '') !== f.bat;
      if (homeBusy(t) && (!want || E.nameKey(state[t].meta.name) !== want || swap)) undos.push(clearForClient(t));
      if (t === 'custom' && typeof f.bat === 'string') switchBattery(f.bat);
      else if (!xs.length && linkedTool() === t && E.nameKey(state.ex.meta.name) !== want) state.ex.link = '';   // someone else's program never follows this report
      if (xs.length) { var hadX = exHasContent(), u2 = clearForClient('ex'); if (hadX) undos.push(u2); }
      if (who.key && clients.clients[who.key]) homeClientOpen(t, { key: who.key, name: who.name }, false);   // details and last time's results (draws the page)
      else { if (who.name) state[t].meta.name = who.name; openTool(t, null); }
      if (xs.length) {                                 // the program prints after this report (as Add an exercise program does)
        var x = state.ex, by = NAME_FIELDS[t] ? state[t].meta[NAME_FIELDS[t]] : '';
        x.link = t;
        followReport();
        if (blank(x.meta.practitioner) && !blank(by)) x.meta.practitioner = clean1(by);
        state.exPage = 'builder';
        if (a) x.ask = a;
        saveDraft();
      }
      startScan(rs, { tool: t, pair: !!xs.length });
      if (xs.length) startScan(xs, { tool: 'ex', ask: a });
      refresh();                                       // the summary: "Reading the exercise page…"
    }
    pmReset();
    if (undos.length) toast('Cleared the earlier entries' + (who.name ? ' for ' + who.name : ''), { label: 'Undo', run: function () { undos.slice().reverse().forEach(function (u) { u(); }); } });
  }
  // a page opened from Home (a tile, a Continue card, a tab), as it was left
  function openTool(t, page) {
    closePick(false);
    leaveHome();
    if (t === 'ex' && EX_PAGES.indexOf(page) >= 0) state.exPage = page;
    state.tool = t;
    if (TOOLS.indexOf(t) >= 0) state.screenTool = t;
    saveDraft();
    render();
    window.scrollTo(0, 0);
    if (t === 'ex') exPageOpened();
    focusQuiet(pickBtn());
    keepAwake();
  }
  function homeOpen(t, page) { if (homeBusy(t)) askHalfDone({ tool: t, page: page }); else openTool(t, page); }
  // a page made ready for someone new (the practitioner's name stays); Undo in the message puts it back
  function homeStartNew(t, page) {
    var undo = clearForClient(t);
    openTool(t, page);
    toast('New ' + (t === 'ex' ? 'program' : toolName(t)) + ' started', { label: 'Undo', run: undo });
  }
  // o: { tool, page } (a tile), { tool: 'ex', photo: true } (Photo to handout) or { tool, client: { key, name } }
  function askHalfDone(o) {
    var t = o.tool, cur = clean1(state[t].meta.name), line = contentLine(t), acts = [], text;
    function btn(cls, act, label) { return '<button type="button" class="' + cls + '" data-ask="' + act + '">' + esc(label) + '</button>'; }
    function pick(cls, mode, label, aria) {
      return '<label class="' + cls + ' file-btn"><span>' + esc(label) + '</span><input type="file" accept="image/*" multiple data-scan-mode="' + mode + '" aria-label="' + esc(aria) + '"></label>';
    }
    els.homeAskTitle.textContent = (t === 'ex' ? 'Exercise program' : toolName(t)) + ' in progress';
    var toBat = o.swap ? (o.bat ? (batGet(o.bat) || { name: 'the battery' }).name : TOOL_NAMES.custom) : '';   // v43: another battery on the shared Custom page
    if (o.swap && o.client) {
      text = line + '. Start ' + toBat + ' for ' + o.client.name + ' (this page is cleared, Undo straight after), or carry on with ' + (cur ? cur + '’s ' : '') + toolName(t) + '?';
      acts.push(btn('primary', 'new', 'Start ' + toBat + ' for ' + o.client.name));
      acts.push(btn('ghost', 'continue', 'Continue ' + toolName(t)));
    } else if (o.swap) {
      text = line + '. Start ' + toBat + ' (this page is cleared, Undo straight after), or carry on with ' + (cur ? cur + '’s ' : '') + toolName(t) + '?';
      acts.push(btn('primary', 'new', 'Start ' + toBat));
      acts.push(btn('ghost', 'continue', 'Continue ' + toolName(t)));
    } else if (o.photo) {
      text = line + '. Add the photo’s exercises to it, or start a new program?';
      acts.push(pick('primary', 'add', 'Add to it', 'Add to it: take or choose photos of the exercise page'));
      acts.push(pick('ghost', 'new', 'Start a new program', 'Start a new program: take or choose photos of the exercise page'));
    } else if (o.client && o.client.prog) {          // v39: a program chosen on the client's page
      var on = E.displayIso(o.client.prog);
      text = line + '. Open ' + o.client.name + '’s program from ' + on + ' in its place, or carry on with ' + (cur ? cur + '’s' : 'this one') + '?';
      acts.push(btn('primary', 'new', 'Open the ' + on + ' program'));
      acts.push(btn('ghost', 'continue', cur ? 'Continue ' + cur + '’s' : 'Continue it'));
    } else if (o.client) {
      text = line + '. Start a new one for ' + o.client.name + ', or carry on with ' + (cur ? cur + '’s' : 'this one') + '?';
      acts.push(btn('primary', 'new', 'Start new for ' + o.client.name));
      acts.push(btn('ghost', 'continue', cur ? 'Continue ' + cur + '’s' : 'Continue it'));
    } else {
      text = line + '. Carry on with it, or start a new one? Starting new clears this page (Undo straight after).';
      acts.push(btn('primary', 'continue', 'Continue it'));
      acts.push(btn('ghost', 'new', 'Start new'));
    }
    acts.push(btn('quiet', 'cancel', 'Cancel'));
    els.homeAskText.textContent = text;
    els.homeAskActions.innerHTML = acts.join('');
    homeAskFor = o;
    openModal(els.homeAsk, els.homeAskActions.querySelector('.primary input, button.primary'));
  }
  function onHomeAskClick(e) {
    var b = e.target.closest('button[data-ask]');
    if (!b) return;
    var o = homeAskFor, a = b.dataset.ask;
    if (a === 'cancel' || !o) { closeModal(); return; }
    closeModal(false);
    homeAskFor = null;
    if (a === 'continue') openTool(o.tool, o.tool === 'ex' ? 'builder' : null);
    else if (o.client) homeClientOpen(o.tool, o.client, true, o.bat);   // v43: (with a battery to set up once cleared)
    else if (o.bat !== undefined) batStartNew(o.bat);  // v43: a battery's tile, or Custom's while a battery ran
    else homeStartNew(o.tool, o.page);
  }
  // photos picked from the Photo to handout tile, or from Add to it / Start a new program in its question. v33: a new
  // program asks first (on Home, so Cancel changes nothing); Add to it keeps the program's cover and goes straight on
  function onHomeScanPick(input) {
    var files = Array.prototype.slice.call(input.files || []), mode = input.dataset.scanMode;
    input.value = '';
    if (!files.length) return;
    if (openModalEl === els.homeAsk) closeModal(false);
    homeAskFor = null;
    if (mode === 'add') { openTool('ex', 'builder'); startScan(files, { append: true }); return; }
    openPhotoAsk(files, function (a) {
      var undo = mode === 'new' && homeBusy('ex') ? clearForClient('ex') : null;
      openTool('ex', 'builder');
      if (undo) toast('New program started', { label: 'Undo', run: undo });
      if (a) { state.ex.ask = a; saveDraft(); }
      startScan(files, { ask: a });
    }, freshAsk());
  }
  function onHomeClick(e) {
    var sg = e.target.closest('#homeSugg button');
    if (sg) {
      var typed = clean1($('homeSearch').value);
      $('homeSugg').hidden = true;
      if (sg.dataset.homeClient) openClientPage(sg.dataset.homeClient);   // v39: their page (until v38 the chooser)
      else openHomeClient('', typed);
      return;
    }
    var cp = e.target.closest('[data-cp]');
    if (cp) { onClientPageClick(cp.dataset.cp); return; }   // v39
    var pmb = e.target.closest('[data-pm]');
    if (pmb && pmb.tagName !== 'LABEL') { onPhotoModeClick(pmb.dataset.pm); return; }   // v41
    var bb = e.target.closest('button[data-bld]');
    if (bb) { onBuilderClick(bb.dataset.bld); return; }   // v43: the Battery builder
    var tb = e.target.closest('button[data-team]');
    if (tb) { onTeamClick(tb.dataset.team); return; }   // v46: the Team page
    var el = e.target.closest('[data-home]');
    if (!el || el.tagName === 'LABEL') return;           // the photo tile opens its picker by itself
    var k = el.dataset.home, part = k.split(':');
    if (part[0] === 'hub') { openHomeSub(part[1]); return; }   // v41: one of Home's three buttons
    if (k === 'back') { closeHomeSub(); return; }
    if (part[0] === 'check') { openClientPage(k.slice(6), 'log'); return; }   // v40: a check-in: their log
    if (part[0] === 'seen') { markSeen(k.slice(5)); return; }
    if (k === 'ckall') { ckAll = !ckAll; renderCheckins(); focusQuiet(els.homeSec.querySelector('[data-home="ckall"]')); return; }
    if (k === 'builder') { if (bld.view !== 'bat') bld = freshBld(); bld.from = ''; openHomeSub('builder'); return; }   // v43 (an edit left half-way carries on)
    if (part[0] === 'bat') { openBattery(k.slice(4)); return; }   // v43: one of the clinic's batteries
    if (part[0] === 'cont') openTool(part[1], part[1] === 'ex' ? 'builder' : null);
    else if (k === 'tool:custom' && state.custom.batId) openBattery('');   // v43: Custom on the spot again
    else if (part[0] === 'tool') homeOpen(part[1], null);
    else if (k === 'ex:builder') homeOpen('ex', 'builder');
    else if (part[0] === 'ex') openTool('ex', part[1]);
    else if (k === 'photo') askHalfDone({ tool: 'ex', photo: true });
  }
  // the client search: names in the clinic's records (as the name boxes suggest them), else a new client by that name
  function homeSuggest() {
    var inp = $('homeSearch'), box = $('homeSugg');
    if (!inp || !box) return;
    var typed = clean1(inp.value), k = E.nameKey(typed);
    if (!k) { box.hidden = true; box.innerHTML = ''; return; }
    var keys = clientKeys().filter(function (key) { return key.indexOf(k) >= 0; }).slice(0, 6);
    var html = keys.map(function (key) {
      var cl = clients.clients[key], n = cl.sessions.length, last = '';
      cl.sessions.forEach(function (x) { if (x.date > last) last = x.date; });
      return '<button type="button" data-home-client="' + esc(key) + '"><b>' + esc(cl.name) + '</b><span>' + n + (n === 1 ? ' session' : ' sessions') + (last ? ' · last ' + esc(E.displayIso(last)) : '') + '</span></button>';
    }).join('');
    if (!clients.clients[k] && typed.length >= 2) html += '<button type="button" class="hs-new" data-home-new="1"><b>New client: ' + esc(typed) + '</b><span>no record yet</span></button>';
    box.innerHTML = html;
    box.hidden = !html;
  }
  function onHomeSearchKey(e) {
    var box = $('homeSugg'), items = box ? Array.prototype.slice.call(box.querySelectorAll('button')) : [];
    if (e.key === 'Enter') { e.preventDefault(); if (items[0]) items[0].click(); }
    else if (e.key === 'Escape') { if (box && !box.hidden) { e.preventDefault(); box.hidden = true; } }
    else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[0].focus(); }
  }
  function onHomeSuggKey(e) {
    var box = $('homeSugg'), items = Array.prototype.slice.call(box.querySelectorAll('button')), i = items.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[i]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i) items[i - 1].focus(); else $('homeSearch').focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); box.hidden = true; $('homeSearch').focus(); }
  }
  // a client chosen on Home: each test, with when they last did it, and their exercise program. v39: a new client typed in
  // the search; tests (true): + New test on a client's page, the tests only
  function openHomeClient(key, name, tests) {
    var cl = key ? clients.clients[key] : null;
    if (key && !cl) return;
    if (!cl && !clean1(name)) return;
    homeClientFor = { key: cl ? key : '', name: cl ? cl.name : clean1(name) };
    var last = {};
    if (cl) cl.sessions.forEach(function (x) { if (!last[x.tool] || x.date > last[x.tool]) last[x.tool] = x.date; });
    els.homeClientTitle.textContent = homeClientFor.name;
    els.homeClientDetail.textContent = tests ? 'Choose the test. Their results from last time come with it, to compare.'
      : cl ? 'Choose a test (their results from last time come with it) or their exercise program.' : 'New client, no record yet. Choose a test, or write their exercise program.';
    // v43: the clinic's batteries after Custom (each with when they last did it; Custom's line counts the on-the-spot ones)
    var lastBat = {};
    if (cl) cl.sessions.forEach(function (x) { if (x.tool === 'custom') { var bk = typeof x.batId === 'string' && x.batId ? x.batId : ''; if (!lastBat[bk] || x.date > lastBat[bk]) lastBat[bk] = x.date; } });
    var opts = [];
    TOOLS.forEach(function (t) { opts.push(t); if (t === 'custom') tileBats().forEach(function (bb) { opts.push('bat:' + bb.id); }); });
    if (!tests) opts.push('ex');
    els.homeClientList.innerHTML = opts.map(function (t) {
      var b = t.indexOf('bat:') === 0 ? batGet(t.slice(4)) : null, lt = b ? lastBat[b.id] : t === 'custom' ? lastBat[''] : last[t];
      var sub = t === 'ex' ? (last.ex ? 'Last program ' + E.displayIso(last.ex) : cl ? 'No programs yet' : '')
        : lt ? 'Last tested ' + E.displayIso(lt) : cl ? 'Not done yet' : '';
      return '<button type="button" class="hc-opt" data-hc="' + esc(t) + '"><span class="tile-ic">' + HOME_ICON[t === 'ex' ? 'builder' : b ? 'bat' : t] + '</span>' +
        '<span class="hc-text"><b>' + esc(t === 'ex' ? 'Exercise program' : b ? b.name : HEAD[t][0]) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></button>';
    }).join('');
    openModal(els.homeClientDialog, els.homeClientList.querySelector('.hc-opt'));
  }
  function onHomeClientClick(e) {
    var b = e.target.closest('button[data-hc]'), c = homeClientFor, hc = b ? b.dataset.hc : '';
    if (!b || !c) return;
    closeModal(false);
    if (hc.indexOf('bat:') === 0) clientGoBattery(hc.slice(4), c);   // v43: one of the clinic's batteries
    else if (hc === 'custom' && state.custom.batId) clientGoBattery('', c);   // Custom on the spot (a battery ran)
    else homeClientGo(hc, c);
  }
  // c: { key, name } (v39: + prog, the date of a program from their record; or blank: a new program, from their page)
  function homeClientGo(t, c) {
    var want = c.key || E.nameKey(c.name), cur = E.nameKey(state[t].meta.name);
    if (t === 'ex' && (c.prog || c.blank)) {
      // that program is on the page already (changed since or not): carry on with it
      if (c.prog && cur === want && exLoaded && exLoaded.key === want && exLoaded.date === c.prog) { openTool('ex', 'builder'); return; }
      if (exHasContent()) askHalfDone({ tool: t, client: c });   // exercises on the page (theirs or someone else's): ask first
      else homeClientOpen(t, c, false);
      return;
    }
    if (homeBusy(t)) {
      if (cur && cur === want) { openTool(t, t === 'ex' ? 'builder' : null); return; }   // their own page in progress: carry on with it
      askHalfDone({ tool: t, client: c });
      return;
    }
    homeClientOpen(t, c, false);
  }
  // the page for that client: a record's details and results from last time (or, for the program, their last saved one,
  // as Choose client does), or a new client's name; clear: Start new for them (the page held someone else's entries)
  function homeClientOpen(t, c, clear, bat) {
    var was = clean1(state[t].meta.name), undo = clear ? clearForClient(t) : null, want = c.key || E.nameKey(c.name);
    if (t === 'custom' && typeof bat === 'string') switchBattery(bat);   // v43: the battery chosen for them
    if (t === 'ex' && state.ex.link && E.nameKey(state.ex.meta.name) !== want) state.ex.link = '';   // v19: no longer that report's program
    closePick(false);
    leaveHome();
    if (t === 'ex') state.exPage = 'builder';
    state.tool = t;
    if (TOOLS.indexOf(t) >= 0) state.screenTool = t;
    if (c.key && clients.clients[c.key] && !c.blank) {
      if (t === 'ex') loadProgramFor(c.key, true, undo, was, c.prog || ''); else loadHistory(t, c.key, true, undo, was);   // (each draws the page)
    } else {
      state[t].meta.name = c.key && clients.clients[c.key] ? clients.clients[c.key].name : c.name;
      state[t].cardOpen = true;
      if (t === 'ex') exLoaded = null;                 // v39: + New program on their page: an empty builder with their name
      render();
      if (undo) toast(c.blank ? 'New program started for ' + c.name : 'Cleared ' + (was ? was + '’s' : 'the last') + ' entries for ' + c.name, { label: 'Undo', run: undo });
    }
    saveDraft();
    window.scrollTo(0, 0);
    if (t === 'ex') exPageOpened();
    focusQuiet(pickBtn());
    keepAwake();
  }

  // ------------------------------------------------------------------ v39: a client's page
  // Matthew (5 Oct): "when we search for a client - the client shows - we click on it and it takes us to a client home page -
  // there is a screening section (showing all screening and dates of screening) and a Exercise Program section where is shows
  // current or previously created programs for them." His choices: a screening opens its report again, made from the saved
  // results (to view, save or share; the app keeps no PDFs), and + New test starts one with last time's results to compare;
  // a program opens in the builder (to print again, change or send to their phone), the newest marked Current, with the
  // phone link's state. The page is drawn on Home in place of the rest; ‹ Home, the Home tab and the logo go back.
  function openClientPage(key, view) {                 // v40: view 'log': their training log
    if (!clients.clients[key]) return;
    if (!homeView) showHome(false);
    setHomeSub('');                                    // v41
    var box = $('homeSugg'), find = $('homeSearch');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (find) find.value = '';                         // the name searched for has been found
    clientPage = { key: key, view: view === 'log' ? 'log' : '' };
    renderHome();
    if (logsOn()) refreshLogs(clientTokens(key), 3000);   // v40: opened on purpose: their log read again now
    window.scrollTo(0, 0);
    focusQuiet($('cpName'));
  }
  function closeClientPage() {
    clientPage = null;
    renderHome();
    window.scrollTo(0, 0);
    focusQuiet($('homeHello'));
  }
  function cpCount(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function cpResults(x) {                              // the tests in a session: LL Strength's two legs count once
    var keys = Object.keys(x.results || {});
    if (x.tool === 'custom') {                         // v43: a Custom battery's test on each leg counts once too (the screen's own L/R metrics stay two)
      var names = {};
      keys.forEach(function (k) { names[screenMetric(k) ? k : k.replace(/ \u2014 (Left|Right)$/, '')] = 1; });
      return Object.keys(names).length;
    }
    if (x.tool !== 'str') return keys.length;
    var ids = {};
    keys.forEach(function (k) { ids[k.split('|')[0]] = 1; });
    return Object.keys(ids).length;
  }
  function cpQldDay(iso) {                             // a link's end (a moment) as its day in Queensland (UTC+10 all year)
    var t = Date.parse(iso);
    return isFinite(t) ? new Date(t + 10 * 3600 * 1000).toISOString().slice(0, 10) : '';
  }
  function renderClientPage() {
    if (logsOn()) refreshLogs(clientTokens(clientPage.key), LOG_FRESH_MS);   // v40: their training log, read again after a minute
    if (clientPage.view === 'log') { renderClientLog(); return; }             // v40
    var page = $('cpage'), key = clientPage.key, cl = clients.clients[key];
    var a = document.activeElement, holder = a && page.contains(a) ? a.closest('[data-cp]') : null, keep = holder ? holder.getAttribute('data-cp') : (a && a.id === 'cpName' ? 'name' : null);
    var ISO = /^\d{4}-\d{2}-\d{2}$/;                     // (each row's address is its tool and date)
    var tests = E.sortSessions(cl.sessions.filter(function (x) { return x && TOOLS.indexOf(x.tool) >= 0 && ISO.test(x.date); })).reverse();
    var progs = exPrograms(cl).filter(function (x) { return ISO.test(x.date); }).reverse();
    // the details: from their latest test that has each (the record keeps what was typed each time)
    var info = {};
    tests.forEach(function (x) { ['sex', 'sport'].forEach(function (f) { var v = x.meta && x.meta[f]; if (!info[f] && typeof v === 'string' && !blank(v)) info[f] = clean1(v); }); });
    var detail = [info.sex, info.sport, cpCount(tests.length, 'screening', 'screenings') + ', ' + cpCount(progs.length, 'program', 'programs')].filter(Boolean).join(' · ');
    var go = function (label) { return '<span class="cp-go"><span>' + esc(label) + '</span>' + HOME_ICON.go + '</span>'; };
    var testRows = tests.map(function (x) {
      var t = x.tool, m = x.meta || {}, n = cpResults(x), bits = [], tags = '';
      var built = t === 'custom' && typeof x.batId === 'string' && x.batId && typeof x.batName === 'string' && !blank(x.batName);   // v43: a clinic battery goes by its name
      var title = built ? clean1(x.batName) : TOOL_NAMES[t] + (t === 'custom' && typeof x.batName === 'string' && !blank(x.batName) ? ' — ' + clean1(x.batName) : '');
      if (n) bits.push(cpCount(n, 'test', 'tests'));
      if ((t === 'ham' || t === 'acl') && typeof m.phase === 'string' && m.phase) bits.push(m.phase);
      var sc = t === 'ankle' && DATA.ankle && x.results ? E.num(x.results[DATA.ankle.score.name]) : null;   // v42: the total, once every item was in
      if (sc !== null) bits.push('score ' + E.fmt(sc) + ' of ' + DATA.ankle.max);
      var by = NAME_FIELDS[t] && typeof m[NAME_FIELDS[t]] === 'string' && !blank(m[NAME_FIELDS[t]]) ? m[NAME_FIELDS[t]] : (typeof x.savedBy === 'string' ? x.savedBy : '');
      if (!blank(by)) bits.push(clean1(by));
      var co = m.coach && typeof m.coach === 'object' ? m.coach.status : '';
      if (COACH_LOOK[co]) tags = '<span class="cp-tags">' + chip(COACH_LOOK[co], co) + '</span>';
      return '<button type="button" class="cp-row" data-cp="test:' + esc(t + '|' + x.date) + '"><span class="tile-ic">' + HOME_ICON[built ? 'bat' : t] + '</span>' +
        '<span class="cp-text"><b>' + esc(title) + '</b><small><span class="cp-when">' + esc(E.displayIso(x.date)) + '</span>' + (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + '</small>' + tags + '</span>' +
        go('View report') + '</button>';
    }).join('');
    var link = clientLink(key), live = linkLive(link);
    var progRows = progs.map(function (x, i) {
      var p = x.program, n = progItems(p.items).filter(function (it) { return it.kind !== 'section'; }).length, bits = [], tags = [];
      if (n) bits.push(cpCount(n, 'exercise', 'exercises'));
      if (x.meta && typeof x.meta.practitioner === 'string' && !blank(x.meta.practitioner)) bits.push(clean1(x.meta.practitioner));
      if (!i) tags.push('<span class="cp-tag cur">Current</span>');
      if (link && link.date === x.date) {               // the program their phone shows (the newest sent to it)
        var day = cpQldDay(link.expires);
        tags.push(live ? '<span class="cp-tag phone">On their phone' + (day ? ' until ' + esc(E.displayIso(day)) : '') + '</span>'
          : '<span class="cp-tag">' + (link.stopped ? 'Phone link stopped' : 'Phone link ended') + '</span>');
      }
      return '<button type="button" class="cp-row" data-cp="prog:' + esc(x.date) + '"><span class="tile-ic">' + HOME_ICON.builder + '</span>' +
        '<span class="cp-text"><b>' + esc(clean1(exStr(p.title)) || 'Exercise program') + '</b><small><span class="cp-when">' + esc(E.displayIso(x.date)) + '</span>' + (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + '</small>' +
        (tags.length ? '<span class="cp-tags">' + tags.join('') + '</span>' : '') + '</span>' + go('Open') + '</button>';
    }).join('');
    page.innerHTML =
      '<button type="button" class="cp-back quiet" data-cp="back"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>Home</button>' +
      '<div class="cp-head"><h1 id="cpName" tabindex="-1">' + esc(cl.name) + '</h1><p>' + esc(detail) + '</p></div>' +
      '<div class="cp-cols">' +
      '<section class="cp-sec" aria-labelledby="cpTestsH"><div class="cp-sec-head"><h2 id="cpTestsH">Screening</h2>' +
      '<button type="button" class="ghost cp-add" data-cp="newtest">+ New test</button></div>' +
      (testRows ? '<div class="cp-list">' + testRows + '</div>' : '<p class="cp-empty">No screening saved yet. + New test starts one.</p>') + '</section>' +
      '<section class="cp-sec" aria-labelledby="cpProgsH"><div class="cp-sec-head"><h2 id="cpProgsH">Exercise programs</h2>' +
      '<button type="button" class="ghost cp-add" data-cp="newprog">+ New program</button></div>' +
      (logsOn() && clientTokens(key).length ? '<div class="cp-list cp-loglist">' + logCardHtml(key) + '</div>' : '') +   // v40: their training log
      (progRows ? '<div class="cp-list">' + progRows + '</div>' : '<p class="cp-empty">No programs saved yet. + New program starts one.</p>') + '</section>' +
      '</div>';
    if (keep === 'name') focusQuiet($('cpName'));
    else if (keep) { var back = page.querySelector('[data-cp="' + keep + '"]'); focusQuiet(back || $('cpName')); }
  }
  function onClientPageClick(what) {
    var key = clientPage && clientPage.key, cl = key ? clients.clients[key] : null;
    if (what === 'back' || !cl) { closeClientPage(); return; }
    var i = what.indexOf(':'), kind = i < 0 ? what : what.slice(0, i), arg = i < 0 ? '' : what.slice(i + 1);
    if (kind === 'log' || kind === 'logback') {        // v40: their training log, and back to their page
      clientPage.view = kind === 'log' ? 'log' : '';
      renderHome();
      if (kind === 'log' && logsOn()) refreshLogs(clientTokens(key), 3000);
      window.scrollTo(0, 0);
      focusQuiet(kind === 'log' ? $('cpName') : els.homeSec.querySelector('[data-cp="log"]'));
      return;
    }
    if (kind === 'seen') { markSeen(arg); return; }    // v40
    if (kind === 'newtest') openHomeClient(key, '', true);
    else if (kind === 'newprog') homeClientGo('ex', { key: key, name: cl.name, blank: true });
    else if (kind === 'prog') homeClientGo('ex', { key: key, name: cl.name, prog: arg });
    else if (kind === 'test') { var j = arg.indexOf('|'); openPastReport(key, arg.slice(0, j), arg.slice(j + 1)); }
  }
  // a tool's page as it was when a session was saved: its details, results, previous results, summary and coach band. The
  // phase, norm set, population and Custom battery come from the session; LL Strength's previous results (not kept with
  // the session) come from the record before that date, as loading the client fills them in
  function stateFromSession(cl, x) {
    var t = x.tool, s = freshTool(t), m = x.meta || {}, H = DATA.ham, A = DATA.acl;
    Object.keys(s.meta).forEach(function (f) { if (typeof m[f] === 'string') s.meta[f] = m[f]; });
    s.meta.name = cl.name;
    s.meta.date = x.date;
    if (SL(t)) {
      var pops = E.sportPopulations(DATA.screen);
      s.pop = m.pop === 'general' || pops.indexOf(m.pop) >= 0 || (t === 'custom' && m.pop === 'none') ? m.pop : 'general';   // v43: + the clinic's targets only
      if (Array.isArray(x.radar)) s.radar = x.radar.filter(function (k) { return typeof k === 'string'; });
    }
    if (t === 'custom') {
      s.battery = tidyBattery(x.battery);
      s.batName = typeof x.batName === 'string' ? x.batName : '';
      s.batId = typeof x.batId === 'string' && BAT_ID.test(x.batId) ? x.batId : '';   // v43: the clinic battery it was
      if (x.libTests && typeof x.libTests === 'object' && !Array.isArray(x.libTests)) s.libSnap = x.libTests;   // v43: its tests' targets then
      s.hamPhase = H.phases.indexOf(m.hamPhase) >= 0 ? m.hamPhase : null;
      s.aclPhase = A.phases.indexOf(m.aclPhase) >= 0 ? m.aclPhase : null;
      if (s.meta.injured !== 'Left' && s.meta.injured !== 'Right') s.meta.injured = '';
    }
    if (t === 'ham' || t === 'acl') s.phase = DATA[t].phases.indexOf(m.phase) >= 0 ? m.phase : null;
    if (t === 'acl') s.sex = A.sexes.indexOf(m.normSex) >= 0 ? m.normSex : null;
    if (t === 'ankle' && s.meta.injured !== 'Left' && s.meta.injured !== 'Right') s.meta.injured = '';   // v42
    Object.keys(x.values || {}).forEach(function (k) {
      var src = x.values[k] || {}, v = { result: '', previous: '', side: '', left: '', right: '' };
      if (t === 'ankle') { v.appr = ''; v.total = ''; }   // v42
      Object.keys(v).forEach(function (f) { if (src[f] != null && typeof src[f] !== 'object') v[f] = String(src[f]); });
      if (t === 'ankle' && v.appr !== 'No' && v.appr !== 'Yes') v.appr = '';
      s.values[k] = v;
    });
    s.interp = { text: typeof x.interp === 'string' ? x.interp : '', ai: x.interpAi === true, basis: '', reviewed: x.interpReviewed !== false };   // v48: (sessions before v48 have no flag: as printed then)
    var co = m.coach && typeof m.coach === 'object' ? m.coach : null;
    if (co) s.coach = { status: COACH_STATUS.indexOf(co.status) >= 0 ? co.status : '', mods: typeof co.mods === 'string' ? co.mods : '', retest: typeof co.retest === 'string' && E.parseDate(co.retest, ['Y-m-d']) ? co.retest : '' };
    return s;
  }
  // the previous results that aren't in the session's values (with state[t] already the rebuilt page): kept with the session
  // since v39; for one saved before, from the record before that date
  function pastPrevious(t, cl, date, x) {
    var s = state[t], hs = historySessions(t, cl), pv = x.prev && typeof x.prev === 'object' ? x.prev : null;
    var str1 = function (v) { return v != null && typeof v !== 'object' ? String(v) : ''; };
    if (pv) {
      Object.keys(pv).forEach(function (k) {
        var p = pv[k] || {}, v = s.values[k] || (s.values[k] = { result: '', previous: '', side: '', left: '', right: '' });
        if (t === 'str') { v.prevLeft = str1(p.L); v.prevRight = str1(p.R); v.prevMass = str1(p.mass); v.prevDate = str1(p.date); }
        else if (t === 'custom') v.prevMass = str1(p.mass);
      });
      return;
    }
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        if (tt.input === 'calc') return;
        [['left', 'L', 'prevLeft'], ['right', 'R', 'prevRight']].forEach(function (sd) {
          var p = E.previousFor(hs, 'str', tt.id + '|' + sd[1], date), raw = p && p.session.values && p.session.values[tt.id];
          if (!p || !raw || blank(raw[sd[0]])) return;
          var v = s.values[tt.id] || (s.values[tt.id] = { result: '', previous: '', side: '', left: '', right: '' });
          v[sd[2]] = String(raw[sd[0]]); v.prevMass = p.mass == null ? '' : String(p.mass); v.prevDate = p.date;
        });
      });
    } else if (t === 'custom') {                       // a previous load or force: the body mass it was scored with
      customSet().groups.forEach(function (g) {
        g.metrics.forEach(function (mm) {
          var v = s.values[mm.name];
          if (!v || blank(v.previous) || !/^(XBW|PCTBW|PERKG|PERBW|NPCTBW)$/.test(mm.calc || '')) return;
          var p = E.previousFor(hs.filter(function (y) { return y.values && y.values[mm.name] && !blank(y.values[mm.name].result); }), 'custom', mm.name, date);
          var raw = p && p.session.values[mm.name].result;
          if (p && String(raw).trim() === String(v.previous).trim()) v.prevMass = p.mass == null ? '' : String(p.mass);
        });
      });
    }
  }
  // a screening on the client's page: its report made again from the saved results, to view, save or share. Nothing is
  // saved and nothing on the pages in use changes; Back returns to their page
  function openPastReport(key, t, date) {
    var cl = clients.clients[key], x = null;
    if (!cl || TOOLS.indexOf(t) < 0) return;
    cl.sessions.forEach(function (y) { if (y && y.tool === t && y.date === date) x = y; });
    if (!x) return;
    var keep = state[t], built = null, why = '';
    try {
      state[t] = stateFromSession(cl, x);
      pastAsOf = date;
      pastPrevious(t, cl, date, x);
      built = buildReport(t);
      if (!built) why = blocker(computeFor(t), t);
    } catch (err) {
      why = 'something in the saved results couldn’t be read';
    } finally {
      state[t] = keep;
      pastAsOf = '';
    }
    if (!built) {
      toast('The ' + TOOL_NAMES[t] + ' report from ' + E.displayIso(date) + ' couldn’t be made again (' + String(why || 'no results were saved').replace(/\.$/, '').replace(/^./, function (ch) { return ch.toLowerCase(); }) + ').');
      return;
    }
    pastView = { key: key, tool: t, date: date };
    els.sheetEx.hidden = true;
    els.sheetEx.dataset.tool = '';
    current = { file: null, blob: null, title: built.rep.title, ex: false, phone: null };
    renderPhoneCard();
    var first = firstName(cl.name);
    els.back.textContent = '‹ Back to ' + (first ? first + '’s page' : 'their page');
    els.home.hidden = true;
    els.sheetTitle.innerHTML = esc(built.rep.title) + '<small>' + esc(built.file) + ' · made again from the record of ' + esc(E.displayIso(date)) + '</small>';
    showSheet(built, '');
  }

  // ------------------------------------------------------------------ v40: the client's training log
  // Matthew (6 Oct): "there needs to be a link from the patients program on their phone back to us - and by this i mean -
  // they can log their workouts and it shows on our end - the load sets and reps need to be editable - think long term
  // rehab or time between appointments - progressive overload is often needed for true rehab goals - clients track and
  // put in their load. Again we can check in and see if they are completing their rehab." His choices: on the phone one tap
  // marks an exercise (or the session) done and Change edits sets, reps or load, carried forward to next time; a pain score
  // (0-10) and a note per session; no progression nudge; a check-in for pain of 4 or more, or 5 days without a session.
  // The phone writes shared/<token>/logs (cloud.js › logs reads them with the clinic login); a client's tokens are in their
  // saved programs (program.share; one link per client until it is stopped). What was read is kept on this device
  // (bh-athlete-report-logs-v1) so the pages draw at once and refresh behind; signing out clears it.
  var LOG_STORE = 'bh-athlete-report-logs-v1', PAIN_FLAG = 4, QUIET_DAYS = 5, LOG_FRESH_MS = 60000, HOME_FRESH_MS = 5 * 60000;
  var logBook = null, logBusy = {}, ckAll = false;
  // the day logging began: a link sent before it is never flagged for "nothing logged yet" (its client wasn't told about
  // logging); once they log, it is checked like any other (window.BH_LOG_START: the suites' own day)
  var LOG_START = /^\d{4}-\d{2}-\d{2}$/.test(String(window.BH_LOG_START || '')) ? window.BH_LOG_START : '2026-10-05';
  var LOG_ICON = homeSvg('<path d="M4 19h16"/><path d="M7 15v-3M11 15V8M15 15v-5M19 15V5"/>');   // bars: sessions logged
  function loadLogBook() {
    if (logBook) return logBook;
    var b = null, acct = CLOUD && CLOUD.account ? CLOUD.account() : null, email = acct ? acct.email : '';
    try { b = JSON.parse(localStorage.getItem(LOG_STORE)); } catch (e) { b = null; }
    logBook = b && typeof b === 'object' && b.tokens && typeof b.tokens === 'object' && !Array.isArray(b.tokens) && b.email === email ? b : { email: email, tokens: {} };
    return logBook;
  }
  function saveLogBook() { try { localStorage.setItem(LOG_STORE, JSON.stringify(logBook)); } catch (e) { /* full: kept in memory */ } }
  function clearLogBook() { logBook = null; logBusy = {}; try { localStorage.removeItem(LOG_STORE); } catch (e) { /* storage unavailable */ } }
  function logsOn() { return !!(CLOUD && CLOUD.signedIn() && CLOUD.logs); }
  // a session as the phone sent it, tidied for showing (null: removed by the client, or unreadable)
  function tidyLogEntry(e) {
    var o = e && e.log;
    if (!o || typeof o !== 'object' || o.removed === true || !/^\d{4}-\d{2}-\d{2}$/.test(o.day || '')) return null;
    var items = (Array.isArray(o.items) ? o.items : []).slice(0, 80).filter(function (it) { return it && typeof it === 'object' && cap(it.n, 120); }).map(function (it) {
      var rx = it.rx && typeof it.rx === 'object' ? it.rx : {};
      return { n: cap(it.n, 120), g: cap(it.g, 80), done: it.done === true, sets: cap(it.sets, 20), reps: cap(it.reps, 20), load: cap(it.load, 30),
        rx: { sets: cap(rx.sets, 20), reps: cap(rx.reps, 20), load: cap(rx.load, 30) } };
    });
    var pain = typeof o.pain === 'number' && o.pain >= 0 && o.pain <= 10 ? Math.round(o.pain) : null;
    return { id: e.id, token: e.token, day: o.day, at: String(e.at || ''), items: items, pain: pain, note: typeof o.note === 'string' ? o.note.trim().slice(0, 500) : '',
      grp: cap(o.grp, 80), title: cap(o.title, 120), none: o.none === true };   // v48: none: "Couldn't do it today" (pain and a note, nothing done)
  }
  function clientTokens(key) {                         // the client's phone links, in the order first sent
    var cl = key ? clients.clients[key] : null, out = [];
    exPrograms(cl).forEach(function (x) { var sh = x.program.share; if (sh && TOKEN_RE.test(sh.token) && out.indexOf(sh.token) < 0) out.push(sh.token); });
    return out;
  }
  function clientLogs(key) {                           // every session from their links, newest first
    var book = loadLogBook(), out = [];
    clientTokens(key).forEach(function (t) {
      var e = book.tokens[t];
      (e && Array.isArray(e.list) ? e.list : []).forEach(function (x) { var y = tidyLogEntry({ id: x.id, token: t, at: x.at, log: x.log }); if (y) out.push(y); });
    });
    return out.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : (a.at < b.at ? 1 : a.at > b.at ? -1 : 0); });
  }
  // 'none' (no phone link), 'loading' (not read yet), 'denied' (the store refused: no rule for logs yet), 'error', 'ok'
  function logState(key) {
    var toks = clientTokens(key), book = loadLogBook(), st = 'ok';
    if (!toks.length || !logsOn()) return 'none';
    toks.forEach(function (t) {
      var e = book.tokens[t];
      if (!e) st = 'loading';
      else if (e.err && st === 'ok') st = e.err;
    });
    return st;
  }
  // read these links' logs (those not read in the last freshMs); the pages showing them redraw when something arrives
  function refreshLogs(tokens, freshMs) {
    if (!logsOn()) return Promise.resolve(false);
    var book = loadLogBook(), now = Date.now();
    var want = tokens.filter(function (t, i) { var e = book.tokens[t]; return tokens.indexOf(t) === i && !logBusy[t] && (!e || now - (+e.at || 0) > freshMs); });
    if (!want.length) return Promise.resolve(false);
    want.forEach(function (t) { logBusy[t] = true; });
    return Promise.all(want.map(function (t) {
      return CLOUD.logs(t).then(function (r) {
        if (logBook !== book) return false;            // signed out meanwhile
        delete logBusy[t];
        if (!r.ok && r.code === 'off') return false;
        var had = !!book.tokens[t], e = book.tokens[t] || { list: [] }, before = had ? JSON.stringify([e.list, e.err || '']) : '';
        if (r.ok) { e.list = r.logs.map(function (x) { return { id: x.id, at: x.at, log: x.log }; }); e.err = ''; }
        else e.err = r.code === 'denied' ? 'denied' : 'error';   // (what was read before stays shown)
        e.at = Date.now();
        book.tokens[t] = e;
        return !had || JSON.stringify([e.list, e.err || '']) !== before;   // the first read always redraws (no more "Checking…")
      }, function () { delete logBusy[t]; return false; });
    })).then(function (res) {
      if (logBook !== book) return false;
      saveLogBook();
      var any = res.some(Boolean);
      if (any) afterLogs();
      return any;
    });
  }
  // Home's check-ins alone (a sync or a log read redraws only this part of Home: never the tiles, whose photo picker may be open)
  function renderCheckins() {
    var sec = $('homeCheck');
    if (!sec) return;
    if (logsOn()) refreshLogs(liveTokens(), HOME_FRESH_MS);   // the clients with a working link, every five minutes at most
    var a = document.activeElement, keep = a && sec.contains(a) ? a.getAttribute('data-home') : '', html = checkinsHtml();
    sec.hidden = !html;
    if (sec.innerHTML !== html) {
      sec.innerHTML = html;
      if (keep) focusQuiet(sec.querySelector('[data-home="' + keep + '"]') || $('homeHello'));
    }
  }
  function afterLogs() {
    if (homeView && clientPage) renderHome();
    else if (homeView) renderCheckins();
    else if (state && state.tool === 'ex') { refreshExClientBar(); applyExLogged(); }
  }
  function localDay(iso) { var t = Date.parse(iso || ''); if (!isFinite(t)) return ''; var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function logDay(iso) {                               // 'Tue 6 Oct' (the year too when it isn't this one)
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!p) return '';
    var d = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3]));
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + (+p[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[2] - 1] +
      (p[1] !== todayIso().slice(0, 4) ? ' ' + p[1] : '');
  }
  function agoText(day) {
    var d = daysBetween(day, todayIso());
    return d === null ? '' : d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }
  function doseText(r) {                               // '3 × 8 · 22.5 kg'
    var sr = r.sets && r.reps ? r.sets + ' × ' + r.reps : r.sets ? r.sets + (/^\d+$/.test(r.sets) ? (r.sets === '1' ? ' set' : ' sets') : '') : r.reps;
    return [sr, r.load].filter(Boolean).join(' · ');
  }
  function doneCount(l) { return l.items.filter(function (it) { return it.done; }).length; }
  function loadKg(s) {                                 // a load as a number, when it reads as kilograms (or a bare number)
    var t = String(s || '').replace(',', '.'), m = /(\d+(?:\.\d+)?)\s*kgs?\b/i.exec(t);
    if (m) return +m[1];
    m = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(t);
    return m ? +m[1] : null;
  }
  function weekStartIso(iso) {                         // the Monday of that week
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!p) return '';
    var d = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])), back = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
  }
  // how often the current program asks for (its instructions: "3 times a week", "3x/week", "every day"), else null
  function plannedPerWeek(key) {
    var progs = exPrograms(key ? clients.clients[key] : null), p = progs.length ? progs[progs.length - 1].program : null, t = p ? String(p.instructions || '') : '';
    var m = /(\d)\s*(?:x|×|times)\s*(?:a|per|\/|each)?\s*week/i.exec(t);
    if (m && +m[1] >= 1 && +m[1] <= 7) return +m[1];
    return /\b(every|each) day\b|\bdaily\b/i.test(t) ? 7 : null;
  }
  // the check-in for a client with a live link: pain of 4 or more in the last two weeks not yet marked as seen, and days
  // without a session (counted from the last session, else from the program sent; a mark as seen starts the count again).
  // v48: + a session they couldn't do, and any note they wrote (until v47 a note with low pain never reached Home)
  function checkinFor(key) {
    var l = clientLink(key);
    if (!logsOn() || !l || !linkLive(l)) return null;
    var book = loadLogBook(), e = book.tokens[l.token];
    if (!e || !Array.isArray(e.list)) return null;    // not read yet
    var seenDoc = clients.checkins && clients.checkins[l.token], seenAt = seenDoc && !seenDoc.deleted && typeof seenDoc.seenAt === 'string' ? seenDoc.seenAt : '';
    var seenMs = Date.parse(seenAt) || 0, list = clientLogs(key), since = addDaysIso(todayIso(), -14);
    function fresh(x) { return x.day >= since && (!seenMs || (Date.parse(x.at) || 0) > seenMs); }
    var pain = list.filter(function (x) { return x.pain !== null && x.pain >= PAIN_FLAG && fresh(x); });
    var skipped = list.filter(function (x) { return x.none && fresh(x); }), noted = list.filter(function (x) { return x.note && fresh(x); });   // v48
    var done = list.filter(function (x) { return !x.none; });   // v48: a "couldn't do it" entry isn't a session
    var ref = done.length ? done[0].day : l.date, seenDay = localDay(seenAt);
    if (seenDay && seenDay > ref) ref = seenDay;
    var quiet = !list.length && l.date < LOG_START ? null : daysBetween(ref, todayIso()), reasons = [];
    if (pain.length) {
      var worst = pain.slice().sort(function (a, b) { return b.pain - a.pain || (a.day < b.day ? 1 : -1); })[0];
      reasons.push({ kind: 'pain', text: 'Pain ' + worst.pain + '/10 on ' + logDay(worst.day) + (pain.length > 1 ? ' (' + pain.length + ' sessions)' : '') });
    }
    if (skipped.length) reasons.push({ kind: 'skip', text: 'Couldn’t do the session on ' + logDay(skipped[0].day) + (skipped.length > 1 ? ' (' + skipped.length + ' times)' : '') });
    if (noted.length) reasons.push({ kind: 'note', text: 'Note on ' + logDay(noted[0].day) + ': “' + (noted[0].note.length > 70 ? noted[0].note.slice(0, 68).trim() + '…' : noted[0].note) + '”' + (noted.length > 1 ? ' (+' + (noted.length - 1) + ' more)' : '') });
    if (quiet !== null && quiet >= QUIET_DAYS) reasons.push({ kind: 'quiet', text: done.length ? 'No session logged for ' + quiet + ' days' : 'Nothing logged yet (program sent ' + quiet + ' days ago)' });
    return reasons.length ? { key: key, token: l.token, reasons: reasons, pain: pain.length ? pain[0].day : '', skip: skipped.length ? skipped[0].day : '', quiet: quiet || 0 } : null;
  }
  function liveTokens() {                              // every client's working link (for the check-ins)
    var out = [];
    Object.keys(clients.clients || {}).forEach(function (k) { var l = clientLink(k); if (l && linkLive(l) && out.indexOf(l.token) < 0) out.push(l.token); });
    return out;
  }
  function markSeen(token) {
    if (!CLOUD || !TOKEN_RE.test(token)) return;
    var map = clients.checkins || {}, old = map[token] ? JSON.parse(JSON.stringify(map[token])) : null;
    CLOUD.putDoc('checkins', token, { seenAt: new Date().toISOString(), by: userName() });
    clients = CLOUD.cache;
    CLOUD.sync();
    var redraw = function () { if (homeView && clientPage) renderHome(); else if (homeView) renderCheckins(); };
    redraw();
    if (homeView && !clientPage) focusQuiet($('homeCheck').querySelector('.ck-seen') || $('homeHello'));   // (the row has gone)
    toast('Marked as seen', { label: 'Undo', run: function () {
      if (old && !old.deleted) CLOUD.putDoc('checkins', token, old); else CLOUD.deleteDoc('checkins', token);
      CLOUD.sync();
      redraw();
    } });
  }
  // Home: who needs a look (pain first, then the longest without a session); each opens their log; Seen clears it
  function checkinsHtml() {
    if (!logsOn()) return '';
    var rows = [];
    Object.keys(clients.clients || {}).forEach(function (k) { var c = checkinFor(k); if (c) rows.push(c); });
    if (!rows.length) return '';
    rows.sort(function (a, b) { return (b.pain ? 1 : 0) - (a.pain ? 1 : 0) || (a.pain < b.pain ? 1 : a.pain > b.pain ? -1 : 0) || b.quiet - a.quiet; });
    var more = rows.length > 6 ? '<button type="button" class="quiet ck-more" data-home="ckall" aria-expanded="' + ckAll + '">' + (ckAll ? 'Show fewer' : 'Show all ' + rows.length) + '</button>' : '';
    if (!ckAll) rows = rows.slice(0, 6);
    return '<h2 id="homeCheckH">Check-ins</h2><div class="ck-list">' + rows.map(function (c) {
      var nm = clients.clients[c.key].name;
      return '<div class="ck-row' + (c.pain ? ' ck-pain' : '') + '"><button type="button" class="ck-open" data-home="check:' + esc(c.key) + '"><span class="tile-ic">' + LOG_ICON + '</span>' +
        '<span class="cont-text"><b>' + esc(nm) + '</b><small>' + c.reasons.map(function (r) { return '<span class="ck-why ck-' + r.kind + '">' + esc(r.text) + '</span>'; }).join('') + '</small></span>' +
        '<span class="cont-go">' + HOME_ICON.go + '</span></button>' +
        '<button type="button" class="ghost ck-seen" data-home="seen:' + esc(c.token) + '">Seen<span class="vh"> — ' + esc(nm) + '</span></button></div>';
    }).join('') + '</div>' + more;
  }
  // the client page's card for the log (under Exercise programs' heading)
  function logCardHtml(key) {
    var st = logState(key);
    if (st === 'none') return '';
    var list = clientLogs(key), ck = checkinFor(key), line;
    if (!list.length) line = st === 'loading' ? 'Checking their log…' : st === 'denied' ? 'The clinic store isn’t set up for training logs yet (its rules need the log lines).'
      : st === 'error' ? 'Their log couldn’t be read just now.' : 'Nothing logged yet. Sessions they log on their phone show here.';
    else {
      var since = addDaysIso(todayIso(), -6), wk = list.filter(function (x) { return x.day >= since; }).length, last = list[0];
      line = list.length + (list.length === 1 ? ' session' : ' sessions') + ' · last ' + logDay(last.day) + ' (' + agoText(last.day) + ')' + ' · ' + wk + ' in the last 7 days' +
        (last.pain !== null ? ' · pain ' + last.pain + '/10 last time' : '');
    }
    return '<button type="button" class="cp-row cp-log" data-cp="log"><span class="tile-ic">' + LOG_ICON + '</span><span class="cp-text"><b>Training log</b><small>' + esc(line) + '</small>' +
      (ck ? '<span class="cp-tags">' + ck.reasons.map(function (r) { return '<span class="cp-tag ' + (r.kind === 'pain' || r.kind === 'skip' ? 'warn' : 'idle') + '">' + esc(r.text) + '</span>'; }).join('') + '</span>' : '') +
      '</span><span class="cp-go"><span>View log</span>' + HOME_ICON.go + '</span></button>';
  }
  // sessions per week, the last 8 weeks (Monday to Sunday), one bar each; the planned number as a dashed line
  function weeksSvg(list, plan) {
    var weeks = [], start = weekStartIso(todayIso());
    for (var i = 7; i >= 0; i--) weeks.push(addDaysIso(start, -7 * i));
    var n = weeks.map(function (w) { var end = addDaysIso(w, 7); return list.filter(function (x) { return !x.none && x.day >= w && x.day < end; }).length; });   // v48: a "couldn't do it" entry isn't a session
    var top = Math.max(plan || 0, Math.max.apply(null, n), 3), W = 480, H = 170, L = 26, B = 140, T = 14, bw = (W - L - 4) / 8;
    var y = function (v) { return B - (B - T) * v / top; };
    var grid = [0, top].map(function (v) { return '<line class="lg-grid" x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="lg-ax" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>'; }).join('');
    var bars = n.map(function (v, i) {
      var x = L + 4 + i * bw + 2, h = B - y(v), w = bw - 6, lab = 'Week of ' + logDay(weeks[i]) + ': ' + v + (v === 1 ? ' session' : ' sessions');
      var shape = v ? '<path class="lg-bar' + (i === 7 ? ' now' : '') + '" d="M' + x + ' ' + B + 'V' + (B - h + 4) + 'q0 -4 4 -4h' + (w - 8) + 'q4 0 4 4V' + B + 'Z"/>' : '';
      return '<g class="lg-hit"><title>' + esc(lab) + '</title><rect x="' + (x - 2) + '" y="' + T + '" width="' + (w + 4) + '" height="' + (B - T + 22) + '" fill="transparent"/>' + shape +
        (v ? '<text class="lg-val" x="' + (x + w / 2) + '" y="' + (B - h - 4) + '" text-anchor="middle">' + v + '</text>' : '') +
        (i % 2 === 1 || i === 7 ? '<text class="lg-ax" x="' + (x + w / 2) + '" y="' + (B + 20) + '" text-anchor="middle">' + esc(i === 7 ? 'This wk' : logDay(weeks[i]).replace(/^\w+ /, '')) + '</text>' : '') + '</g>';
    }).join('');
    var target = plan ? '<line class="lg-plan" x1="' + L + '" x2="' + W + '" y1="' + y(plan) + '" y2="' + y(plan) + '"/><text class="lg-plan-t" x="' + W + '" y="' + (y(plan) - 4) + '" text-anchor="end">Plan ' + plan + ' a week</text>' : '';
    return '<svg class="lg-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Sessions per week, last 8 weeks: ' + n.join(', ') + (plan ? '; plan ' + plan + ' a week' : '')) + '">' + grid + target + bars + '</svg>';
  }
  // pain after each session (the last 12 with a score), 0-10; the check-in level as a dashed line
  function painSvg(list) {
    var pts = list.filter(function (x) { return x.pain !== null; }).slice(0, 12).reverse();
    if (pts.length < 2) return '<p class="lg-none">' + (pts.length ? 'One score so far: ' + pts[0].pain + '/10 on ' + esc(logDay(pts[0].day)) + '.' : 'No pain scores yet.') + '</p>';
    var W = 480, H = 170, L = 26, R = 12, B = 140, T = 14, step = (W - L - R) / (pts.length - 1);
    var x = function (i) { return L + i * step; }, y = function (v) { return B - (B - T) * v / 10; };
    var grid = [0, 10].map(function (v) { return '<line class="lg-grid" x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="lg-ax" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>'; }).join('');
    var flag = '<line class="lg-plan" x1="' + L + '" x2="' + W + '" y1="' + y(PAIN_FLAG) + '" y2="' + y(PAIN_FLAG) + '"/><text class="lg-plan-t" x="' + W + '" y="' + (y(PAIN_FLAG) - 4) + '" text-anchor="end">Check-in at ' + PAIN_FLAG + '</text>';
    var line = '<polyline class="lg-line" points="' + pts.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.pain).toFixed(1); }).join(' ') + '"/>';
    var dots = pts.map(function (p, i) {
      return '<g class="lg-hit"><title>' + esc(logDay(p.day) + ': pain ' + p.pain + '/10') + '</title><circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.pain).toFixed(1) + '" r="10" fill="transparent"/>' +
        '<circle class="lg-dot' + (p.pain >= PAIN_FLAG ? ' hi' : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.pain).toFixed(1) + '" r="4"/></g>';
    }).join('');
    var labs = '<text class="lg-ax" x="' + L + '" y="' + (B + 20) + '">' + esc(logDay(pts[0].day)) + '</text><text class="lg-ax" x="' + W + '" y="' + (B + 20) + '" text-anchor="end">' + esc(logDay(pts[pts.length - 1].day)) + '</text>';
    return '<svg class="lg-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Pain after sessions: ' + pts.map(function (p) { return p.pain; }).join(', ')) + '">' + grid + flag + line + dots + labs + '</svg>';
  }
  // the exercises: the current program's first (in its order), then any others logged; how often done, the last time, the load's trend
  function logExercisesHtml(key, list) {
    var progs = exPrograms(clients.clients[key]), cur = progs.length ? progItems(progs[progs.length - 1].program.items).filter(function (it) { return it.kind !== 'section'; }) : [];
    var order = [], seen = {}, rx = {};
    cur.forEach(function (it) { var k = it.name.toLowerCase(); if (!seen[k]) { seen[k] = 1; order.push(it.name); rx[k] = it; } });
    list.slice().reverse().forEach(function (l) { l.items.forEach(function (it) { var k = it.n.toLowerCase(); if (!seen[k]) { seen[k] = 1; order.push(it.n); } }); });
    var rows = order.map(function (name) {
      var k = name.toLowerCase(), had = [], done = [];
      list.forEach(function (l) { l.items.forEach(function (it) { if (it.n.toLowerCase() === k) { had.push(l); if (it.done) done.push({ l: l, it: it }); } }); });
      if (!had.length && !rx[k]) return '';
      var last = done[0], loads = done.slice(0, 8).reverse().map(function (d) { return loadKg(d.it.load); }), nums = loads.filter(function (v) { return v !== null; });
      var spark = nums.length >= 2 ? sparkSvg({ values: loads, first: nums[0], last: nums[nums.length - 1] }, 'Higher', name + ' load ') : '';
      var plan = rx[k] ? doseText({ sets: cap(rx[k].sets, 20), reps: cap(rx[k].reps, 20), load: cap(rx[k].load, 30) }) : '';
      return '<tr><th scope="row">' + esc(name) + (plan ? '<small>Plan: ' + esc(plan) + '</small>' : '') + '</th>' +
        '<td>' + (had.length ? done.length + ' of ' + had.length : '—') + '</td>' +
        '<td>' + (last ? esc(doseText(last.it) || 'done') + '<small>' + esc(logDay(last.l.day)) + '</small>' : '—') + '</td>' +
        '<td class="lg-trend">' + (nums.length >= 2 ? '<span>' + esc(E.fmt(nums[0]) + ' → ' + E.fmt(nums[nums.length - 1]) + ' kg') + '</span>' + spark : '') + '</td></tr>';
    }).join('');
    return rows ? '<div class="lg-tablewrap"><table class="lg-table"><thead><tr><th scope="col">Exercise</th><th scope="col">Done</th><th scope="col">Last time</th><th scope="col">Load</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '';
  }
  function logSessionsHtml(list) {
    return '<div class="lg-sessions">' + list.map(function (l) {
      var head = [logDay(l.day), l.grp, l.none ? 'couldn’t do it' : doneCount(l) + ' of ' + l.items.length + ' done'].filter(Boolean).join(' · ');   // v48
      return '<details class="lg-s' + (l.pain !== null && l.pain >= PAIN_FLAG ? ' hi' : '') + '"><summary><span class="lg-s-h">' + esc(head) + '</span>' +
        (l.pain !== null ? '<span class="lg-pain' + (l.pain >= PAIN_FLAG ? ' hi' : '') + '">Pain ' + l.pain + '/10</span>' : '') +
        (l.note ? '<span class="lg-note">“' + esc(l.note) + '”</span>' : '') + '</summary><ul>' + l.items.map(function (it) {
          var did = doseText(it), plan = doseText(it.rx);
          return '<li class="' + (it.done ? 'y' : 'n') + '"><span class="lg-mk" aria-hidden="true">' + (it.done ? '✓' : '–') + '</span><b>' + esc(it.n) + '</b> ' +
            (it.done ? esc(did || 'done') + (plan && plan !== did ? ' <small>(plan ' + esc(plan) + ')</small>' : '') : '<small>not done</small>') + '</li>';
        }).join('') + '</ul></details>';
    }).join('') + '</div>';
  }
  // the log's own page (on Home, in the client page's place): the check-in, four numbers, two charts, the exercises, every session
  function renderClientLog() {
    var page = $('cpage'), key = clientPage.key, cl = clients.clients[key], list = clientLogs(key), st = logState(key), ck = checkinFor(key);
    var plan = plannedPerWeek(key), since7 = addDaysIso(todayIso(), -6), since28 = addDaysIso(todayIso(), -27);
    var n7 = list.filter(function (x) { return x.day >= since7; }).length, n28 = list.filter(function (x) { return x.day >= since28; }).length, last = list[0], first = firstName(cl.name);
    var link = clientLink(key), linkLine = !link ? '' : linkLive(link) ? 'Their phone link works until ' + E.displayIso(cpQldDay(link.expires)) + '.' : link.stopped ? 'Their phone link was stopped.' : 'Their phone link has ended.';
    var tile = function (label, big, small) { return '<div class="lg-tile"><span>' + esc(label) + '</span><b>' + esc(big) + '</b>' + (small ? '<small>' + esc(small) + '</small>' : '') + '</div>'; };
    var html = '<button type="button" class="cp-back quiet" data-cp="logback"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>' + esc(first ? first + '’s page' : 'Their page') + '</button>' +
      '<div class="cp-head"><h1 id="cpName" tabindex="-1">' + esc(cl.name) + '</h1><p>' + esc('Training log, from the program on their phone. ' + linkLine) + '</p></div>';
    if (ck) html += '<div class="lg-check" role="status"><p><b>Check-in:</b> ' + ck.reasons.map(function (r) { return esc(r.text); }).join(' · ') + '</p><button type="button" class="ghost" data-cp="seen:' + esc(ck.token) + '">Mark as seen</button></div>';
    if (!list.length) {
      html += '<p class="cp-empty">' + esc(st === 'loading' ? 'Checking their log…' : st === 'denied' ? 'The clinic store isn’t set up for training logs yet: its rules need the log lines (see the notes).'
        : st === 'error' ? 'Their log couldn’t be read just now. It will try again shortly.' : 'Nothing logged yet. Sessions they log on their phone show here.') + '</p>';
    } else {
      html += '<div class="lg-tiles">' + tile('Last 7 days', n7 + (n7 === 1 ? ' session' : ' sessions'), plan ? 'plan ' + plan + ' a week' : '') + tile('Last 4 weeks', n28 + (n28 === 1 ? ' session' : ' sessions'), 'about ' + String(Math.round(n28 / 4 * 10) / 10) + ' a week') +
        tile('Last session', logDay(last.day), agoText(last.day)) + tile('Pain last session', last.pain !== null ? last.pain + '/10' : '—', last.pain !== null && last.pain >= PAIN_FLAG ? 'at or over the check-in level' : '') + '</div>' +
        '<div class="lg-charts"><section class="lg-card" aria-labelledby="lgWeeksH"><h2 id="lgWeeksH">Sessions per week</h2>' + weeksSvg(list, plan) + '</section>' +
        '<section class="lg-card" aria-labelledby="lgPainH"><h2 id="lgPainH">Pain after sessions</h2>' + painSvg(list) + '</section></div>' +
        '<section class="lg-sec" aria-labelledby="lgExH"><h2 id="lgExH">Exercises</h2>' + logExercisesHtml(key, list) + '</section>' +
        '<section class="lg-sec" aria-labelledby="lgSessH"><h2 id="lgSessH">Sessions <span>(' + list.length + ')</span></h2>' + logSessionsHtml(list) + '</section>';
    }
    var a = document.activeElement, keepId = a && page.contains(a) ? (a.getAttribute('data-cp') || a.id) : '';
    var open = []; page.querySelectorAll('details.lg-s[open]').forEach(function (d, i) { open.push(i); });   // (sessions opened stay open)
    page.innerHTML = html;
    var ds = page.querySelectorAll('details.lg-s'); open.forEach(function (i) { if (ds[i]) ds[i].open = true; });
    if (keepId) focusQuiet(page.querySelector('[data-cp="' + keepId + '"]') || $(keepId) || $('cpName'));
  }
  // the builder: what the client logged last for each exercise on the page, under its name (not printed)
  function lastLogged(key, name) {
    var k = String(name || '').trim().toLowerCase(), list = k ? clientLogs(key) : [];
    for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].items.length; j++) { var it = list[i].items[j]; if (it.done && it.n.toLowerCase() === k) return { it: it, day: list[i].day }; }
    return null;
  }
  function applyExLogged() {
    if (!state || state.tool !== 'ex') return;
    var key = E.nameKey(state.ex.meta.name), on = !!key && clients.clients[key] && logsOn() && clientTokens(key).length;
    els.entry.querySelectorAll('.ex-row[data-id]:not(.ex-sec)').forEach(function (row) {
      var it = exItem(row.dataset.id), col = row.querySelector('.ex-namecol'), el = row.querySelector('.ex-logged'), hit = on && it ? lastLogged(key, it.name) : null;
      if (!col) return;
      if (!hit) { if (el) el.remove(); return; }
      var text = 'Logged ' + logDay(hit.day) + ': ' + (doseText(hit.it) || 'done');
      if (!el) { el = document.createElement('div'); el.className = 'ex-logged'; var lib = col.querySelector('.ex-libact'); col.insertBefore(el, lib); }
      if (el.textContent !== text) el.textContent = text;
    });
  }
  function exLogBit(key) {                             // the builder's client bar: the log in a line, with View log
    if (!logsOn() || !clientTokens(key).length) return '';
    refreshLogs(clientTokens(key), LOG_FRESH_MS);
    var list = clientLogs(key);
    return ' <span class="cb-log">' + (list.length ? esc('Training log: ' + list.length + (list.length === 1 ? ' session' : ' sessions') + ', last ' + logDay(list[0].day) + '.') : 'Nothing logged on their phone yet.') +
      ' <button type="button" class="quiet" data-action="ex-viewlog" data-client="' + esc(key) + '">View log</button></span>';
  }
  function wireHome() {
    els.homeSec.addEventListener('click', onHomeClick);
    els.homeSec.addEventListener('change', function (e) {
      if (!e.target.matches) return;
      if (e.target.matches('input[data-scan-mode]')) onHomeScanPick(e.target);
      else if (e.target.matches('input[data-pm-files]')) onPhotoModeFiles(e.target);   // v41
      else if (homeSub === 'builder') onBuilderChange(e.target);   // v43
    });
    els.homeSec.addEventListener('input', function (e) {
      if (e.target.id === 'homeSearch') homeSuggest(); else if (e.target.id === 'pmFind') pmSuggest();
      else if (homeSub === 'builder') onBuilderInput(e.target);   // v43
    });
    els.homeSec.addEventListener('keydown', function (e) {
      if (e.target.id === 'pmFind' && e.key === 'Enter') { e.preventDefault(); var first = $('pmSugg') && $('pmSugg').querySelector('button'); if (first) first.click(); return; }   // v41
      if (e.key === 'Enter' && (e.target.id === 'bldPct' || e.target.id === 'bldName' || e.target.id === 'bldAbout' || e.target.id === 'bldFind')) {   // v43
        e.preventDefault();
        if (e.target.id === 'bldPct') bldPctSave(); else if (e.target.id === 'bldName') focusQuiet($('bldAbout')); else e.target.blur();
        return;
      }
      if (e.target.id === 'homeSearch') onHomeSearchKey(e);
      else if (e.target.closest && e.target.closest('#homeSugg')) onHomeSuggKey(e);
    });
    els.homeSec.addEventListener('focusin', function (e) { if (e.target.id === 'homeSearch' && clean1(e.target.value)) homeSuggest(); });
    els.homeSec.addEventListener('focusout', function () {
      setTimeout(function () { var box = $('homeSugg'); if (box && !els.homeSec.querySelector('.home-find').contains(document.activeElement)) box.hidden = true; }, 200);
    });
    // tapping a suggestion must not blur the search box before the tap lands
    els.homeSec.addEventListener('pointerdown', function (e) { if (e.target.closest('#homeSugg')) e.preventDefault(); });
    els.homeAsk.addEventListener('click', onHomeAskClick);
    els.homeAsk.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('input[data-scan-mode]')) onHomeScanPick(e.target); });
    els.homeClientList.addEventListener('click', onHomeClientClick);
    els.homeClientCancel.addEventListener('click', function () { closeModal(); });
    els.brandHome.addEventListener('click', function () {
      if (document.documentElement.classList.contains('signed-out') || !state) return;
      if (homeView && clientPage) closeClientPage();   // v39: from a client's page, Home itself
      else if (homeView && homeSub) closeHomeSub();    // v41: and from a button's page
      else if (homeView) window.scrollTo(0, 0); else showHome(true);
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
  // v15: the Exercises tab works the same way: from Screening it returns to the Exercises page last in use; a second
  // tap, already there, scrolls to the top and opens its page picker
  // v41: from Home (or one of its pages) a tab opens its section's page (choose a battery; an Exercises page), as Home's
  // buttons do; the tab of the page in use opens it too (until v40 the heading's menu); the other section's tab still goes
  // straight back to where it was left (one tap between a report and its program)
  function onSectionTab(section) {
    if (section === 'home') {                          // v30; v39: a client's page goes back to Home; v41: so does a button's page
      if (homeView && clientPage) closeClientPage(); else if (homeView && homeSub) closeHomeSub(); else if (homeView) window.scrollTo(0, 0); else showHome(true);
      return;
    }
    var sub = section === 'ex' ? 'ex' : 'screening';
    if (homeView) { if (homeSub === sub && !clientPage) window.scrollTo(0, 0); else openHomeSub(sub); return; }
    var here = section === 'ex' ? state.tool === 'ex' : state.tool !== 'ex';
    if (!here) {
      closePick(false);
      switchTool(section === 'ex' ? 'ex' : state.screenTool);
      if (section === 'ex') exPageOpened();
      return;
    }
    openHomeSub(sub);
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
    if (tool === 'custom' || tool.indexOf('bat:') === 0) {   // v43: Custom on the spot, or one of the clinic's batteries
      var id = tool === 'custom' ? '' : tool.slice(4);
      if (state.tool === 'custom' && (state.custom.batId || '') === id) { focusQuiet(pickBtn()); return; }
      pickBattery(id);
      return;
    }
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
    ['.appbar', '.workspace', '#dock', '#signin', '#cloudBar', '#updBar', '#home', '#whoPanel'].forEach(function (sel) {   // v30: and Home; v44: the new-version bar; v46: the switcher
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
    if (e.key === 'Escape') { e.preventDefault(); if (!(pinRequired && openModalEl === $('pinDialog'))) closeModal(); return; }   // v49: a staff login's first PIN can't be skipped
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
      return '<li' + (c.any ? ' class="has-data"' : '') + '><span class="cl-t">' + esc(toolName(t)) + '</span><span class="cl-d">' + esc(contentLine(t)) + '</span></li>';
    }).join('');
    if (!any) { toast('Nothing to clear — every section is already empty'); return; }
    openModal(els.clearDialog, els.clearCancel);
  }
  function clearAllData() {
    var snap = JSON.parse(draftJson()), wasLoaded = exLoaded, wasHome = homeView;   // v48: Undo in the message puts it all back
    // v36: the Custom battery's population and tests are set-up, like Tests today: kept (Choose tests › Untick all empties it)
    var cu = customSetup();                            // v43: + the clinic battery it runs
    TOOLS.forEach(function (t) { state[t] = freshTool(t); });
    Object.assign(state.custom, cu);
    state.ex = freshEx();                              // v15: the draft program only; the library, templates and records stay
    tidyState();
    exLoaded = null;
    cardPin = {};                                      // every details card open again (v11); Tests today is kept
    coachOpen = {}; interpOpen = {}; exTopOpen = false; // v18: the optional cards fold again
    // an AI draft still on its way belongs to the athlete just cleared: drop it when it arrives
    aiGen++;
    aiBusy = null; interpMsg = { tool: null, kind: '', text: '' }; interpUndo = null;
    scanBusy = {}; scanInfo = {}; TOOLS.concat(['ex']).forEach(bumpScan); suggestBusy = false;   // v41: every lane
    releaseWake();                                     // nothing entered now: the screen may sleep again
    // drop the last report built (it holds the athlete's details) and its preview, and one still being built (v16)
    reportGen++;
    homeFrom = null;
    current = { file: null, blob: null, title: '' };
    els.pages.innerHTML = '';
    els.sheetTitle.textContent = 'Report';
    // overwrite the saved draft straight away, so closing the app now can't bring the old data back
    clearTimeout(saveTimer);
    try { localStorage.setItem(draftKey(), draftJson()); } catch (e) { /* storage unavailable */ }
    closeModal(false);
    render();
    window.scrollTo(0, 0);
    els.moreBtn.focus();                               // Clear this iPad's screens is in the ⋯ menu (v11), which has closed
    toast('Screens cleared — every record is kept', { label: 'Undo', run: function () {
      undoHome(snap, wasLoaded);
      if (wasHome) showHome(false);                    // (Undo from Home: back to Home, the entries kept)
    } });
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
    if (r.status === 'Guide') {                        // v28: never rated (no target, not good or bad): it sets the training emphasis
      var gch = changeWords(r);
      return '- ' + [r.name + ': ' + v, 'not rated (no target; neither good nor bad): it sets the training emphasis, here ' + (r.guide || 'not known').toLowerCase() + ' (' + r.target + ')'].concat(gch ? [gch] : []).join(' | ');
    }
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
    if (t === 'ham' || t === 'ankle') {                // v42: + Ankle-GO (weeks since the injury)
      if (!blank(m.weeks)) return clean1(m.weeks);
      var d = daysBetween(m.doi, m.date); return d !== null && d >= 0 ? String(Math.floor(d / 7)) : '';
    }
    if (!blank(m.months)) return clean1(m.months);
    var d2 = daysBetween(m.dos, m.date); return d2 !== null && d2 >= 0 ? String(Math.floor(d2 / 30.4375)) : '';
  }
  var READERS_CLIENT = 'Readers: the client (and their coach or trainer, if they have one). Refer to the person as \u2018the client\u2019.';   // v49: was the patient
  function interpPayload(t, c) {
    var m = state[t].meta, L = [], rehab = t === 'ham' || t === 'acl' || t === 'ankle';
    var totals = 'Totals: ' + (rehab
      ? c.counts.Green + ' on target, ' + c.counts.Amber + ' close, ' + c.counts.Red + ' behind.'
      : c.counts.Green + ' on target, ' + c.counts.Amber + ' close, ' + c.counts.Red + ' off target.');
    if (SL(t)) {
      L.push(sportCtx(t) ? 'Readers: the athlete and their coach. Refer to the person as \u2018the athlete\u2019.' : READERS_CLIENT);   // v49
      L.push(t === 'custom' ? (state.custom.batId && state.custom.batName ? 'Report: the clinic\u2019s own screening battery \u201c' + clean1(state.custom.batName) + '\u201d' : 'Report: a custom screening battery chosen by the clinician') +   // v43: a clinic battery by its name
        ' (VALD force plate and related tests, lower-limb strength tests scored relative to body weight, and the clinic\u2019s own tests, which have a target only when the clinician typed one).'   // v36
        : 'Report: ' + (sportCtx(t) ? 'athlete ' : '') + 'performance and readiness screen (VALD force plate and related tests).');
      L.push('Compared against: ' + clean1(c.pop.label === POP_NONE ? 'the clinic\u2019s targets only (no population norms)' : c.pop.label) + '.');
      if (t === 'custom') L = L.concat(customRehabLines(), customLibLines());   // v37: rehab tests, against their phase; v43: the clinic's tests
      var who = joinBits([clean1(m.sex), blank(m.age) ? '' : clean1(m.age) + ' years', blank(m.mass) ? '' : clean1(m.mass) + ' kg', blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      if (who) L.push((sportCtx(t) ? 'Athlete: ' : 'Client: ') + who + '.');
      L.push('Status key: On target = meets the target; Close = close to the target; Off target = well short of the target. The DSI is not rated: it says which training emphasis the force profile points to.');   // v28
      L.push(totals);
      L.push('Results (metric: result | target | status | change since the previous test, if given):');
      L = L.concat(groupLines(c.groups, 'target', t));
    } else if (t === 'str') {
      var pct = DATA.str.amber_pct == null ? 5 : DATA.str.amber_pct;
      L.push(READERS_CLIENT);
      L.push('Report: lower-limb strength and capacity battery. Each leg is scored against a target relative to body weight (BW). RM = repetition maximum.');
      var who2 = joinBits([blank(m.mass) ? '' : 'body mass ' + clean1(m.mass) + ' kg', blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]);
      if (who2) L.push('Client: ' + who2 + '.');
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
    } else if (t === 'ankle') {                        // v42
      L.push(READERS_CLIENT);
      L.push('Report: the Ankle-GO score after a lateral ankle sprain managed without surgery: four functional tests (single-leg stance, the modified star excursion balance test, the side hop and the figure-of-8 hop) and three questionnaires (FAAM ADL, FAAM Sport and ALR-RSI, readiness to return to sport), scored on the injured leg for a total out of 25. The other leg is given for comparison.');
      var wk = sinceText(t);
      L.push('Context: ' + joinBits([blank(m.injured) ? '' : 'injured side: ' + clean1(m.injured).toLowerCase(), wk ? 'weeks since injury: ' + wk : '', blank(m.sport) ? '' : 'sport: ' + clean1(m.sport)]) + '.');
      L.push('Status key: On target = full points for the item; Close = some of its points; Behind = no points.');
      L.push(totals);
      L = L.concat(agoLines(c));
    } else {
      var S = DATA[t], acl = t === 'acl';
      L.push(READERS_CLIENT);
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
  // v37: what Claude is told about a Custom battery's rehab tests (nothing without them)
  function customRehabLines() {
    var ri = customRehabInfo();
    if (!ri) return [];
    var L = ['Rehab tests in this battery (the ' + andList([ri.ham !== null ? 'hamstring' : '', ri.acl !== null ? 'ACL' : ''].filter(Boolean)) + ' sections) are compared with research norms for the typical case at the rehab phase chosen, not with the population above: On target = at or ahead of the typical case; Close = up to 1 SD behind; Off target = more than 1 SD behind. The deficit, % of the uninjured side and LSI measures compare the injured side with the other.'];
    L.push('Rehab context: ' + joinBits([ri.injured ? 'injured side: ' + ri.injured.toLowerCase() : '', ri.ham ? 'hamstring strain phase: ' + ri.ham : '', ri.acl ? 'ACL reconstruction phase: ' + ri.acl : '']) + '.');
    ri.notes.forEach(function (x) { L.push('About the rehab norms: ' + x); });
    return L;
  }
  // v43: what Claude is told about the battery builder's tests (nothing without them): how they are rated, and left vs right
  function customLibLines() {
    var tests = state.custom.battery.map(function (it) { return it.k === 'lib' ? ltFor(it.id) : null; }).filter(Boolean);
    if (!tests.length) return [];
    var p = libBasePct(tests);
    var own = tests.filter(function (tt) { return ltPct(tt) !== p; });   // v43: tests with a Close rule of their own
    var L = ['Some tests are the clinic\u2019s own, made in its battery builder, each with a target the clinic set (as measured, or relative to body weight where the result says % BW, \u00d7 BW or N/kg): On target = at or beyond the target; Close = within ' + ltFmt(p) + '% short of it' + (own.length ? ' (unless the test has its own rule, below)' : '') + '; Off target = further away. A test without a target is tracked, not rated.'];
    own.forEach(function (tt) { L.push('- ' + clean1(tt.name) + ': Close = within ' + ltFmt(ltPct(tt)) + '% of its target (its own rule).'); });
    var d = legDiffs('custom');
    if (d.length) {
      L.push('Left vs right for the clinic\u2019s tests measured on each leg (difference as % of the higher leg):');
      d.forEach(function (x) {
        L.push('- ' + clean1(x.name) + ': left ' + E.fmt(x.L) + ', right ' + E.fmt(x.R) + (x.unit && x.unit !== 'score' ? ' ' + x.unit : '') + ' \u2014 ' +
          (x.behind && Math.round(x.pct) >= 1 ? 'the ' + x.behind.toLowerCase() + ' leg is ' + E.fmt(Math.round(x.pct)) + '% behind' + (x.dir === 'Lower' ? ' (lower is better)' : '') : 'the same on both legs'));
      });
    }
    return L;
  }
  function interpBasis(t, c) { return hashStr(interpPayload(t, c)); }

  function interpShown(t) {                            // v18: open when it holds text, is being drafted, has a message, or was opened
    return !!interpOpen[t] || !blank(state[t].interp.text) || aiBusy === t || interpMsg.tool === t;
  }
  function interpCardHtml() {
    var t = state.tool, it = state[t].interp;
    return '<section class="card interp' + (interpShown(t) ? '' : ' folded') + '" id="interpCard" aria-labelledby="interpTitle">' +
      '<div class="card-head"><div class="fold-t"><h2 id="interpTitle">Interpretation</h2>' +
      '<p class="interp-help">Optional: a short summary for the ' + (sportCtx(t) ? 'athlete and coach' : 'client') + ', printed near the top of the report.</p></div>' +
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
    // v48: an AI draft stays "not yet checked" until it is edited or passed with Looks right (the PDF's AI line says which)
    else if (it.ai && !blank(it.text) && !it.reviewed) { kind = 'done'; html = 'Drafted by Claude: read it, then edit it or tap Looks right. <button type="button" class="quiet interp-ok" data-action="interp-ok">Looks right</button>'; }
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
      // v41: Photo mode's exercise page, still being read, or not read (the builder's message says why)
      if (scanBusy.ex) return '<p class="quiet ex-flag busy" role="status">' + EX_ICON + 'Reading the exercise page…</p>';
      var n = exCounts().exercises, xi = scanInfo.ex;
      if (!n && xi && !xi.ai && (xi.kind === 'error' || xi.kind === 'empty')) return '<button type="button" class="quiet ex-flag stale" data-action="goto-program">' + EX_ICON + 'The exercise page wasn’t read: see why</button>';
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
    if (it.ai && !it.reviewed) return '<button type="button" class="quiet interp-flag stale" data-action="goto-interp">AI interpretation not checked yet</button>';   // v48
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
    it.reviewed = true;                                // v48: edited by hand counts as read
    interpUndo = null;
    if (interpMsg.tool === state.tool && interpMsg.kind === 'error') interpMsg = { tool: null, kind: '', text: '' };
    refresh();
  }
  // v48: the AI draft read and passed as it is (Looks right on the card, or in the check before Create report)
  function interpOk(quiet) {
    var it = state[state.tool].interp;
    if (!it.ai || blank(it.text) || it.reviewed) return;
    it.reviewed = true;
    if (interpMsg.tool === state.tool && interpMsg.kind === 'done') interpMsg = { tool: null, kind: '', text: '' };
    refresh();
    if (!quiet) toast('Interpretation checked');
  }
  function undoInterp() {
    if (!interpUndo || interpUndo.tool !== state.tool) return;
    state[state.tool].interp = { text: interpUndo.text, ai: interpUndo.ai, basis: interpUndo.basis, reviewed: interpUndo.reviewed !== false };
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
    callClaude(key, addProfLine(payload), interpGuideText(t)).then(function (text) {   // v24: the condition's evidence guide on rehab reports; v49: + the clinician's profession (not part of the basis)
      if (gen !== aiGen) return;                     // cleared while waiting
      var it = state[t].interp;
      if (!blank(it.text)) interpUndo = { tool: t, text: it.text, ai: it.ai, basis: it.basis, reviewed: it.reviewed };
      state[t].interp = { text: text, ai: true, basis: basis, reviewed: false };   // v48: not yet read by the clinician
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
  var KEY_NOTE = 'The key is saved only on this device and is only sent to Anthropic when you use Draft with AI or Scan photo.';
  // v13, cloud mode: the key lives in the clinic store (meta/settings) and is cached on each device for offline use
  var KEY_NOTE_CLOUD = 'The key is shared by the clinic: saved once, it reaches every signed-in device. It is kept on this device too and is only sent to Anthropic when you use Draft with AI or Scan photo.';
  // v46: a practitioner who isn't an admin can't set the clinic's key (the rules let only an admin write it); theirs stays on the iPad
  var KEY_NOTE_STAFF = 'The clinic’s shared key is set by an admin and reaches every signed-in device. A key pasted here stays on this iPad only and is only sent to Anthropic when you use Draft with AI or Scan photo.';
  function keyShared() { var a = CLOUD && CLOUD.account(); return !!CLOUD && !(a && a.staff && !a.admin); }
  function ONCE_NOTE() { return keyShared() ? 'You only need to do this once for the clinic.' : 'You only need to do this once on each device.'; }
  // then: what to do once a key is saved (e.g. carry on drafting or scanning)
  function openAiSettings(then, lead) {
    aiThen = typeof then === 'function' ? then : null;
    var k = aiKey();
    els.aiKey.value = '';
    els.aiErr.hidden = true;
    els.aiRemove.hidden = !k;
    els.aiKeyState.textContent = k ? 'A key ending in ' + k.slice(-4) + ' is saved ' + (keyShared() ? 'for the clinic' : 'on this device') + '. Paste a new one to replace it.' : (keyShared() ? KEY_NOTE_CLOUD : CLOUD ? KEY_NOTE_STAFF : KEY_NOTE);
    els.aiLead.textContent = lead || ('Drafting interpretations and reading scanned notes or VALD screenshots use Claude through the clinic’s own Claude API key.' +
      (keyShared() ? ' The key is shared by the clinic through the clinic store.' : CLOUD ? ' An admin sets the clinic’s shared key; one pasted here stays on this iPad.' : ''));
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
    if (keyShared()) { CLOUD.setting(v); CLOUD.sync(); }   // shared through meta/settings (queued like any other write); v46: admins only
    els.aiKey.value = '';
    var then = aiThen;
    aiThen = null;
    closeModal();
    toast(keyShared() ? 'API key saved for the clinic' : CLOUD ? 'API key saved on this iPad (an admin sets the clinic’s shared key)' : 'API key saved on this device');
    if (then) then();
  }
  function removeAiKey() {
    try { localStorage.removeItem(AI_KEY_STORE); } catch (e) { /* storage unavailable */ }
    if (keyShared()) { CLOUD.setting(''); CLOUD.sync(); }
    els.aiRemove.hidden = true;
    els.aiKeyState.textContent = (keyShared() ? 'Key removed for the clinic. ' : 'Key removed. ') + (keyShared() ? KEY_NOTE_CLOUD : CLOUD ? KEY_NOTE_STAFF : KEY_NOTE);
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
  // v41: one lane per page (each screening tool, and 'ex' for the program and Suggest), so Photo mode can read the results
  // and the exercise page at the same time: scanBusy[t] while that page's photos are being read, scanGen[t] counts that
  // lane's cancellations, scanInfo[t] is that page's message (until v40 one of each for the whole app)
  var scanBusy = {}, scanGen = {}, scanInfo = {};
  function scanGenOf(t) { return scanGen[t] || 0; }
  function bumpScan(t) { scanGen[t] = scanGenOf(t) + 1; }
  function anyScanBusy() { return Object.keys(scanBusy).some(function (k) { return scanBusy[k]; }); }
  var SCAN_DEFAULT = {
    effort: 'medium', max_tokens: 8000, timeout_s: 120, max_edge: 2000, max_photos: 6,
    system: [
      'You read test results from photos taken at BASE Health Noosa, a physiotherapy, exercise physiology and exercise science clinic in Queensland, Australia, and match them to the tests listed in the request. Each photo is either the clinician’s handwritten testing notes or a screenshot of a VALD app (ForceDecks, NordBord, ForceFrame, DynaMo, SmartSpeed or VALD Hub).',
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
    var unit = scoreUnit(m.unit) || 'number';
    var w = m.calc === 'PERBW' || m.calc === 'PERKG' || m.calc === 'NPCTBW' ? 'force in N (the app divides by body mass)' : 'in ' + unit;
    if (m.calc === 'LSI') return 'left and right values in the same unit (the app works out the LSI)';
    if (/(\u2014 injured|\(injured\))$/.test(m.name)) w += ', injured side only';
    else if (CALCULATED.test(m.name) && m.calc !== 'PERBW' && m.calc !== 'PERKG' && m.calc !== 'NPCTBW') w += ', only if this number itself is written';
    if (m.dir === 'Lower') w += ', lower is better';
    if (SL(t) && E.isAsym(m.name)) w += '; side = the higher side, L or R';
    return w;
  }
  // the tests Claude may fill on this tab: id t1..tN -> the app's own metric key and fields
  function scanList(t) {
    var list = [], n = 0;
    if (t === 'custom') {                              // v36: the whole catalogue (the clinician chose the tests themselves), plus the battery's own tests
      catalogue().forEach(function (c) {
        if (c.ratio) return;                           // v37: the hip ratio is worked out, never read
        if (c.k === 'ham' || c.k === 'acl') list.push({ id: 't' + (++n), key: c.name, name: c.name, what: scanWhat(c.k, c.def), fields: c.def.calc === 'LSI' ? ['left', 'right'] : ['result'], rehab: c.k });   // v37
        else if (c.k === 'screen') list.push({ id: 't' + (++n), key: c.name, name: c.name, what: scanWhat('screen', c.def), fields: E.isAsym(c.name) ? ['result', 'side'] : ['result'] });
        else if (c.k === 'lib') list.push({ id: 't' + (++n), key: c.def.id, name: c.name, what: ltScanWhat(c.def), fields: c.def.legs ? ['left', 'right'] : ['result'], lib: c.def });   // v43: the clinic's tests
        else list.push({ id: 't' + (++n), key: c.def.id, name: c.name, what: INPUT_WORD[c.def.input] + (c.detail ? ' (' + c.detail + ')' : '') + ' for each leg', fields: ['left', 'right'], str: c.def });
      });
      state.custom.battery.forEach(function (o) {
        if (o.k === 'own') list.push({ id: 't' + (++n), key: o.name, name: o.name, what: (o.unit ? 'in ' + o.unit : 'number') + (o.dir === 'Lower' ? ', lower is better' : ''), fields: ['result'], own: true });
      });
      return list;
    }
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        if (tt.input === 'calc') return;
        list.push({ id: 't' + (++n), key: tt.id, name: tt.name, what: INPUT_WORD[tt.input] + (tt.detail ? ' (' + tt.detail + ')' : '') + ' for each leg', fields: ['left', 'right'] });
      });
    } else if (t === 'ankle') {                        // v42: each leg for the tests, the % for a questionnaire (the composite is worked out)
      DATA.ankle.groups.forEach(function (g) {
        g.metrics.forEach(function (m) {
          if (m.kind === 'comp') return;
          list.push({ id: 't' + (++n), key: m.name, name: m.name, what: (m.scan || 'in ' + m.unit) + (m.dir === 'Lower' ? ', lower is better' : ''), fields: m.kind === 'q' ? ['result'] : ['left', 'right'] });
        });
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
    var L = ['Section of the app: ' + TOOL_NAMES[t] + (t === 'custom' && state.custom.batId && state.custom.batName ? ' (the clinic\u2019s battery \u201c' + clean1(state.custom.batName) + '\u201d)' : '') + '.'];   // v43
    if (t === 'custom') L.push('The clinician chose the tests themselves, so the paper may hold any of the tests listed below, and tests of the clinic\u2019s own that are not listed.');   // v36
    if (t === 'ankle') L.push('Ankle-GO after a lateral ankle sprain: left and right are the legs (for a star excursion reach, the leg standing on the floor). Apprehension notes are for the clinician to enter; leave them out.');   // v42
    if (t === 'ham' || t === 'acl' || t === 'custom') {   // v37: the Custom battery's rehab tests too
      var inj = state[t].meta.injured;
      L.push(inj ? 'Injured side: ' + inj + '. Where a test asks for the injured side and both sides are written, use the ' + inj.toLowerCase() + ' value.'
        : 'Injured side: not chosen in the app yet. Where a test asks for the injured side, use it only if the notes make the injured side clear; otherwise leave it out and mention it in unclear.');
    }
    L.push('Tests (id: name — what to look for — fields to return):');
    list.forEach(function (x) { L.push(x.id + ': ' + x.name + ' — ' + x.what + ' — ' + x.fields.join(', ')); });
    L.push('');
    L.push('Return every reading you can match. Use field "result" for a single value, "left" and "right" for each side, and "side" with the value L or R for the higher side (asymmetry tests only). Leave out tests that are not on the paper or screen.');
    if (t === 'custom') L.push('Any other test written on the paper that is not in the list goes in others, one entry per value: its name as written (a clear shorthand written out, for example "Y-balance anterior reach"), its unit if written (else an empty string) and the value as written. Where such a test was written for left and right, give two entries named "<test> \u2014 Left" and "<test> \u2014 Right". Never put a listed test in others, and never put a name or personal detail there.');   // v36
    return L.join('\n');
  }
  function scanSchema(list, t) {
    var sch = {
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
    if (t === 'custom') {                              // v36: tests of the clinic's own, written on the paper but not in the list
      sch.properties.others = { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, unit: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'unit', 'value'], additionalProperties: false } };
      sch.required.push('others');
    }
    return sch;
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
  // opts (v30): { append: true } adds a scanned exercise page after the program's rows (Photo to handout › Add to it on Home)
  // v33: { ask: answers } the clinician's answers from the form after the photos (Exercises only; none when adding pages)
  // v41: { tool } the page whose photos these are (Photo mode reads a battery's and the exercise page's together; else the
  // page in use); { pair: true } the results of Photo mode's Results + exercises (the message says both are being read)
  function startScan(files, opts) {
    var t = opts && opts.tool ? opts.tool : state.tool, exm = t === 'ex', append = exm && !!(opts && opts.append);   // exm: the Exercises tab's own prompt, schema and apply step
    var ask = exm && !append && opts && askGiven(opts.ask) ? tidyAsk(opts.ask) : null;
    if (!files.length || scanBusy[t] || (exm && suggestBusy)) return;
    var cfg = exm ? exScanCfg() : scanCfg();
    function fail(msg) { scanInfo[t] = { tool: t, kind: 'error', text: msg }; renderScanBar(); }
    if (!DATA.ai || !cfg.model) return fail('The AI settings file (interpretation.json) didn’t load. Reopen the app while online.');
    var photos = files.filter(function (f) { return !f.type || f.type.indexOf('image/') === 0; });
    if (!photos.length) return fail(exm ? 'That file isn’t a photo. Choose a photo of the exercise page.' : 'That file isn’t a photo. Choose a photo of your notes.');
    if (!aiKey()) {
      openAiSettings(function () { if (state.tool === t) startScan(files, opts); }, exm
        ? 'To read photos of a handwritten exercise page, the app needs a Claude API key. ' + ONCE_NOTE()
        : 'To read photos of your notes or VALD screenshots, the app needs a Claude API key. ' + ONCE_NOTE());
      return;
    }
    if (navigator.onLine === false) return fail(exm ? 'No internet connection. Connect to scan the exercise page, or type the exercises in.' : 'No internet connection. Connect to scan your notes, or type the results in.');
    var max = cfg.max_photos || 6, extra = photos.length > max ? photos.length - max : 0;
    photos = photos.slice(0, max);
    var gen = scanGenOf(t), list = exm ? null : scanList(t), nPhotos = photos.length;
    scanBusy[t] = true;
    scanInfo[t] = { tool: t, kind: 'busy', text: opts && opts.pair
      ? 'Reading the results (' + (nPhotos === 1 ? '1 photo' : nPhotos + ' photos') + ') and the exercise page… this can take up to a minute.'
      : 'Reading ' + (nPhotos === 1 ? (exm ? 'the exercise page' : 'your notes') : nPhotos + ' photos') + '… this can take up to a minute.' };
    renderScanBar();
    prepareAll(photos, cfg.max_edge || 2000).then(function (images) {
      if (gen !== scanGenOf(t)) throw null;
      var content = [];
      images.forEach(function (im, i) {
        if (images.length > 1) content.push({ type: 'text', text: 'Photo ' + (i + 1) + ':' });
        content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
      });
      // Exercises: only the photos and a fixed request go to Claude, never anything from the patient card or the program
      content.push({ type: 'text', text: exm ? exScanRequest(images.length, ask) : scanPrompt(t, list) });   // v33: with the answers
      var body = {
        model: cfg.model, max_tokens: cfg.max_tokens || 8000, system: [].concat(cfg.system || []).join('\n'),
        messages: [{ role: 'user', content: content }],
        output_config: { format: { type: 'json_schema', schema: exm ? exScanSchema() : scanSchema(list, t) } }
      };
      if (cfg.effort) body.output_config.effort = cfg.effort;
      return claudeRequest(aiKey(), body, cfg.endpoint, cfg.timeout_s || 120, 'read the photo');
    }).then(function (j) {
      if (gen !== scanGenOf(t)) return;
      if (j.stop_reason === 'max_tokens') throw new Error('There was too much to read in one go. Try fewer photos at a time.');
      if (j.stop_reason === 'refusal') throw new Error('Claude couldn’t read these notes. Try a clearer photo.');
      var out;
      try { out = JSON.parse(replyText(j)); } catch (e) { throw new Error('Claude’s answer couldn’t be read. Try again.'); }
      if (exm) applyExScan(out, nPhotos, append, ask); else applyScan(t, out, list);
      if (extra && scanInfo[t] && scanInfo[t].unclear) scanInfo[t].unclear.unshift('Only the first ' + max + ' photos were read (' + extra + (extra === 1 ? ' more was' : ' more were') + ' left out). Scan the rest separately.');
    }).catch(function (err) {
      if (gen !== scanGenOf(t) || err === null) return;
      scanInfo[t] = { tool: t, kind: 'error', text: err && err.message ? err.message : 'Something went wrong reading the photo. Try again.' };
    }).then(function () {
      if (gen !== scanGenOf(t)) return;
      delete scanBusy[t];
      // results filled in: the details card folds into the strip (v11), the scan's message showing under it
      var info = scanInfo[t], filled = !!(info && info.undo && (exm || info.kind === 'done'));
      if (state.tool === t && info && info.undo) {
        if (exm) { showExScan(); if (filled) foldNow(t, false); }
        else if (scanOffPage(t)) { if (filled) foldBeforeRender(t); render(); }   // a value for a section left out under Tests today
        else { showFilled(t); retest.tool = null; refresh(); applyScanMarks(); if (filled) foldNow(t, false); }
      } else if (filled) foldBeforeRender(t);          // read while on another tab: folded there for when it's opened
      // v41: the exercise page read while its report is on screen (Photo mode): the report's summary says how it went
      if (exm && state.tool !== 'ex' && !homeView && TOOLS.indexOf(state.tool) >= 0) refresh();
      renderScanBar();
      var bar = $('scanBar');
      if (bar && !bar.hidden && bar.scrollIntoView && state.tool === t) {
        var r = bar.getBoundingClientRect(), top = appbarH + (state[t].cardOpen === false ? 48 : 0);
        if (r.top < top || r.bottom > window.innerHeight) bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }
  function scanOffPage(t) {                            // a box the scan filled isn't on the page (its section isn't drawn)
    return Object.keys(scanInfo[t].undo.put).some(function (mk) {
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
    var added = [];                                    // v36: tests the photo put into the Custom battery (their keys in undo.added, for Undo)
    undo.added = [];
    function join(item, label) { if (t === 'custom' && batteryAdd(item)) { added.push(label); undo.added.push(batteryKey(tidyBattery([item])[0])); } }
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
      var key = def.key, f = r.field;
      if (t === 'custom') {                            // v36: an LL Strength test's leg is its own row here; the test joins the battery
        if (def.str) { key = strSideName(def.str, f === 'left' ? 'Left' : 'Right'); f = 'result'; join({ k: 'str', id: def.str.id }, def.name); }
        else if (def.rehab) join({ k: def.rehab, key: def.key }, def.name);   // v37: a rehab test (an LSI keeps its left and right)
        else if (def.lib) { key = def.lib.legs ? ltSideName(def.lib, f === 'left' ? 'Left' : 'Right') : def.lib.name; f = 'result'; join({ k: 'lib', id: def.lib.id }, def.name); }   // v43: each leg its own row
        else if (!def.own) join({ k: 'screen', key: def.key }, def.name);
      }
      put(key, f, v, fieldLabel(def, r.field));
    });
    if (t === 'custom') {                              // v36: tests of the clinic's own, read from the paper
      (out && Array.isArray(out.others) ? out.others : []).forEach(function (o) {
        var name = cap(o && o.name, 80), raw = String(o && o.value == null ? '' : o.value).trim(), v = raw.replace(/,/g, '.').replace(/[^\d.\-]/g, '');
        if (!name) return;
        if (E.parseInput(v) === null) { if (raw) notes.push(name + ': couldn’t use “' + raw.slice(0, 30) + '”.'); return; }
        var hit = catalogueByName(name);
        if (hit) {                                     // a catalogue test after all
          if (hit.k === 'screen') { join({ k: 'screen', key: hit.name }, hit.name); put(hit.name, 'result', v, hit.name); }
          else if ((hit.k === 'ham' || hit.k === 'acl') && hit.def.calc !== 'LSI') { join({ k: hit.k, key: hit.name }, hit.name); put(hit.name, 'result', v, hit.name); }   // v37
          else if (hit.k === 'lib') {                  // v43: one of the clinic's tests (a leg when the name says which)
            var lk = E.libKey(name), sd = !hit.def.legs ? '' : lk === E.libKey(ltSideName(hit.def, 'Left')) ? 'Left' : lk === E.libKey(ltSideName(hit.def, 'Right')) ? 'Right' : '';
            if (hit.def.legs && !sd) { notes.push(name + ' is measured on each leg: type the left and right (' + v + ').'); join({ k: 'lib', id: hit.def.id }, hit.name); }
            else { join({ k: 'lib', id: hit.def.id }, hit.name); put(sd ? ltSideName(hit.def, sd) : hit.name, 'result', v, sd ? ltSideName(hit.def, sd) : hit.name); }
          }
          else if (hit.ratio) notes.push(name + ': the hip ratio is worked out from Hip adduction and Hip abduction. Tick it under Choose tests and type each leg of both (' + v + ').');
          else if (hit.k === 'str') notes.push(name + ' is an LL Strength test: tick it under Choose tests and type each leg (' + v + ').');
          else notes.push(name + ' is worked out from left and right: tick it under Choose tests and type both sides (' + v + ').');   // v37: an LSI
          return;
        }
        var k = E.libKey(name), own = state.custom.battery.filter(function (it) { return it.k === 'own' && E.libKey(it.name) === k; })[0];
        if (!own) { own = tidyOwn({ id: newId('o-'), name: name, unit: cap(o.unit, 12), dir: 'Higher', green: null, amber: null }); if (!own) return; join(own, own.name + ' (your own test, no target)'); }
        put(own.name, 'result', v, own.name);
      });
    }
    var d = String((out && out.test_date) || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && E.parseDate(d, ['Y-m-d'])) put('meta', 'date', d, 'Test date');
    var mass = String((out && out.body_mass_kg) || '').replace(/,/g, '.').replace(/[^\d.]/g, ''), mv = E.parseInput(mass);
    if ('mass' in s.meta && mv !== null && mv >= 20 && mv <= 300) put('meta', 'mass', mass, 'Body mass');
    var keys = Object.keys(undo.put), n = keys.filter(function (k) { return k.indexOf('meta|') !== 0; }).length;
    var unclear = (out && Array.isArray(out.unclear) ? out.unclear : []).map(function (x) { return String(x).trim(); }).filter(Boolean).concat(notes);
    if (added.length) { unclear.unshift('Added to the battery: ' + added.join(', ') + '.'); fillCustomPrevious(); }   // v36: and their previous results, for a loaded client
    scanInfo[t] = {
      tool: t, kind: n ? 'done' : 'empty', n: n, unclear: unclear.slice(0, 12), undo: keys.length ? undo : null,
      date: 'meta|date' in undo.put, mass: 'meta|mass' in undo.put
    };
  }
  // Undo puts back what each box held before the scan, except boxes changed by hand since
  function undoScan() {
    if (state.tool === 'ex') { undoExScan(); return; }
    var t = state.tool, u = scanInfo[t] && scanInfo[t].undo;
    if (!u) return;
    var s = state[t], kept = 0;
    Object.keys(u.put).forEach(function (mk) {
      var i = mk.lastIndexOf('|'), key = mk.slice(0, i), f = mk.slice(i + 1);
      var cur = key === 'meta' ? s.meta[f] : val(t, key)[f];
      if (String(cur == null ? '' : cur) !== u.put[mk]) { kept++; return; }
      if (key === 'meta') s.meta[f] = u.was[mk]; else val(t, key)[f] = u.was[mk];
      if (u.had[mk]) s.scanned[mk] = true; else delete s.scanned[mk];
    });
    // v36: tests the scan put into the Custom battery go again, unless a box of theirs holds something now
    if (t === 'custom' && Array.isArray(u.added) && u.added.length) {
      var held = {};
      customSet().groups.forEach(function (g) { g.metrics.forEach(function (m) {
        var v = s.values[m.name]; if (v && ['result', 'previous', 'side', 'left', 'right'].some(function (f) { return !blank(v[f]); })) held[metricItemKey(m)] = 1;   // v37: + rehab tests; v43: + the clinic's
      }); });
      s.battery = s.battery.filter(function (it) { var k = batteryKey(it); return u.added.indexOf(k) < 0 || held[k]; });
    }
    delete scanInfo[t];
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
    Object.keys(scanInfo[t].undo.put).forEach(function (mk) {
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
  function costNote(info) {                            // v28: what the suggestion cost, from the answer's usage counts
    return info.cents ? ' This one cost about ' + info.cents + (info.cents === 1 ? ' cent' : ' cents') + (info.reused ? ' (the guides and library were reused from the last hour, at a tenth of the price).' : '.') : '';
  }
  // v33: what the clinician's answers did, after a scan with them
  function askNote(info) {
    if (!info.asked) return '';
    var w = info.wrote || [];
    return (w.length ? ' Your answers filled in the cover under the exercises (' + w.join(', ') + '): check it too.' : '') +
      (info.extra ? ' Claude added ' + info.extra + (info.extra === 1 ? ' exercise' : ' exercises') + ' you asked for (marked under ' + (info.extra === 1 ? 'it' : 'them') + ').' : '');
  }
  function renderScanBar() {
    var bar = $('scanBar'), btn = $('scanBtn'), t = state.tool, busy = !!scanBusy[t];   // v41: this page's own photos
    if (btn) {
      btn.classList.toggle('busy', busy);
      btn.setAttribute('aria-disabled', String(busy));
      btn.querySelector('[data-label]').textContent = busy ? 'Reading…' : scanLabel(t);
      var inp = $('scanFiles');
      if (inp) inp.disabled = busy;
    }
    var ib = $('importBtn');                           // v18: the Import results button says it's reading too
    if (ib) { ib.classList.toggle('busy', busy); ib.querySelector('[data-label]').innerHTML = busy ? 'Reading…' : IMPORT_LABEL; }
    var sc = $('stripScan');                           // the strip's camera (v11) says the same
    if (sc) {
      sc.classList.toggle('busy', busy);
      sc.setAttribute('aria-disabled', String(busy));
      sc.title = busy ? 'Reading…' : 'Scan photo';
    }
    var sg = $('exSuggest');                           // v21: Suggest from the report says it's working
    if (sg) { sg.classList.toggle('busy', suggestBusy); sg.setAttribute('aria-disabled', String(suggestBusy)); sg.querySelector('[data-label]').textContent = suggestBusy ? 'Suggesting…' : 'Suggest from the report'; }
    if (!bar) return;
    var info = scanInfo[t] || null;
    if (!info) { bar.hidden = true; bar.innerHTML = ''; bar.className = 'scan-bar'; return; }
    bar.hidden = false;
    bar.className = 'scan-bar ' + info.kind + (info.ai ? ' ai' : '');
    var close = '<button type="button" class="quiet scan-x" data-action="scan-close" aria-label="Close this message">×</button>';
    var ico = info.ai ? SPARKLE : CAMERA;              // v21: a suggestion from the report, not a photo
    if (info.kind === 'busy') { bar.innerHTML = '<span class="scan-ico">' + ico + '</span><span class="scan-msg">' + esc(info.text) + '</span>'; return; }
    if (info.kind === 'error') { bar.innerHTML = '<span class="scan-msg">' + esc(info.text) + '</span>' + close; return; }
    var extra = [info.date ? 'test date' : '', info.mass ? 'body mass' : ''].filter(Boolean);
    var html = '<span class="scan-ico">' + ico + '</span>' + (info.ai ? (info.kind === 'empty'
      ? '<span class="scan-msg">Claude didn’t find exercises in the library for the ' + esc(toolName(info.from)) + ' results. Nothing was changed.' + costNote(info) + '</span>'
      : '<span class="scan-msg"><b>Claude suggested ' + info.n + (info.n === 1 ? ' exercise' : ' exercises') + ' from the ' + esc(toolName(info.from)) + ' report' + (info.added ? ', after the ones already there' : '') +
        (info.own ? (info.own === info.n ? (info.n === 1 ? ', not in the library' : ', none in the library') : ', ' + info.own + ' not in the library') : '') + '.</b> Check each one, and its sets and reps, before creating the handout.' +
        (info.own ? ' More › Save to library keeps an exercise of Claude’s for next time.' : '') + costNote(info) + '</span>')
      : t === 'ex' ? (info.kind === 'empty'
      ? '<span class="scan-msg">No exercises were found on the ' + (info.photos > 1 ? 'photos' : 'photo') + '. Check it’s a photo of the exercise page, or try a clearer photo. Nothing was changed.</span>'
      : '<span class="scan-msg"><b>' + (info.added ? 'Added ' : 'Filled ') + info.n + (info.n === 1 ? ' exercise' : ' exercises') + ' from your notes' + (info.added ? ', after the ones already there' : '') + '.</b> Check them against the page before creating the handout.' +
        (info.matched ? ' ' + info.matched + ' matched your library.' : '') + askNote(info) + '</span>')
      : info.kind === 'empty'
      ? '<span class="scan-msg">Nothing on the photo matched ' + (t === 'custom' ? 'any test the app knows' : 'the ' + esc(TOOL_NAMES[t]) + ' tests') + (extra.length ? ' (only the ' + extra.join(' and ') + ')' : '') + '. ' + (t === 'custom' ? 'Try a clearer photo, or choose the tests and type the results.' : 'Check you’re on the right tab, or try a clearer photo.') + '</span>'
      : '<span class="scan-msg"><b>Filled ' + info.n + (info.n === 1 ? ' result' : ' results') + (extra.length ? ' and the ' + extra.join(' and ') : '') + ' from your notes.</b> Check the highlighted boxes against the paper or screenshot before creating the report.' + (t === 'custom' ? ' Tests the photo held were added to the battery.' : '') + '</span>');
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
  var EX_LEN = { name: 120, notes: 300, heading: 80, title: 120, instructions: 1000, rationale: 900, brief: 600, reason: 500 };   // characters kept (other boxes: 60); v27: brief = the notes for Claude; v32: reason = Why this plan
  var EX_WORDS = { name: 1, load: 1, side: 1, notes: 1 };                              // boxes that start with a capital
  // v17: delete is a bin (it shows on every row now, beside More, so it reads as delete rather than close)
  var ICON_TRASH = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.5h6V7"/></svg>';
  var GRIP = '<svg class="grip-dots" viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false" fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>';

  // link (v19): the Screening tool whose report this program prints after ('' when it prints on its own)
  // rationale (v25): Claude's "how this program fits together" note for the physiotherapist: editable, saved with the program, never printed
  // v32 (Matthew chose "Handout as the client's plan" from the brand-research review): reason = "Why this plan", a short note for
  // the client printed on the handout (Suggest drafts one); weeks = the block length and review = the next review date (ISO),
  // printed under the title; reviewAuto = the review date is worked out from the date and the block length (until changed by
  // hand); large = the handout in large print
  function freshEx() { return { meta: { name: '', date: todayIso(), practitioner: userName() }, title: '', instructions: '', rationale: '', reason: '', weeks: '', review: '', reviewAuto: false, large: false, photos: true, phone: null, share: null, items: [], seq: 1, scanned: {}, cardOpen: true, link: '', plan: freshPlan(), ask: freshAsk() }; }   // v33: ask; v34: photos (on the handout); v35: phone, share
  // v23: what Suggest from the report asks before it suggests (the person and the setting); kept with the program and saved with it.
  // v24: plus a condition (an id from guides/index.json, 'none' for none) and its stage, which pick the evidence guides sent.
  // v25: plus the condition's side (Left, Right or Both; '' while not chosen), so Claude can tell which findings the condition explains
  // v27: plus the physiotherapist's notes for Claude (brief): free text sent with the request, kept with the plan, never printed
  var PLAN = { sessions: ['2', '3', '4'], setting: ['Gym', 'Home', 'Both'], level: ['New', 'Trained'], weeks: ['4', '6', '8'] };
  var PLAN_LABEL = { sessions: 'Sessions a week', setting: 'Where', level: 'Experience (new to training, or trained)', weeks: 'Program length (weeks)' };   // v48: was Block
  var STAGES_DEFAULT = ['Early', 'Middle', 'Late', 'Ongoing'], SIDES_DEFAULT = ['Left', 'Right', 'Both'];
  function stageList() { var g = DATA.guideIndex; return g && Array.isArray(g.stages) && g.stages.length ? g.stages.map(clean1).filter(Boolean) : STAGES_DEFAULT; }
  function sideList() { var g = DATA.guideIndex; return g && Array.isArray(g.sides) && g.sides.length ? g.sides.map(clean1).filter(Boolean) : SIDES_DEFAULT; }
  function freshPlan() { return { sessions: '3', setting: 'Gym', level: 'Trained', weeks: '6', condition: 'none', stage: '', side: '', brief: '' }; }
  function tidyPlan(p) {
    var out = freshPlan();
    if (p && typeof p === 'object') {
      Object.keys(PLAN).forEach(function (k) { var v = k === 'level' && p[k] === 'New to training' ? 'New' : p[k]; if (PLAN[k].indexOf(v) >= 0) out[k] = v; });
      if (typeof p.condition === 'string' && /^[a-z0-9-]{1,32}$/.test(p.condition)) out.condition = p.condition;   // v24: checked against the index when used
      if (typeof p.stage === 'string' && stageList().indexOf(p.stage) >= 0) out.stage = p.stage;
      if (typeof p.side === 'string' && sideList().indexOf(p.side) >= 0) out.side = p.side;   // v25
      if (typeof p.brief === 'string') out.brief = p.brief.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, EX_LEN.brief);   // v27
    }
    if (out.condition === 'none') { out.stage = ''; out.side = ''; }
    return out;
  }
  function exStr(v) { return typeof v === 'string' ? v : (typeof v === 'number' && isFinite(v) ? String(v) : ''); }
  // v33: Photo to handout asks first (Matthew, 4 Oct: "I also want it to prompt - how many days, what's the injury, how long
  // is the training block and is there anything else you need me (AI) to add"). His choices: the form right after the photos
  // are picked (the camera still opens at once); every exercise and number kept as written, the answers writing the rest
  // (the title when none is written, how often in the instructions, Why this plan, the block and so the review date) and
  // Claude adding only what "anything else" asks for, marked; one list stays one list; days 2, 3, 4, 5 or Every day; the
  // injury typed in words and mentioned only in Why this plan; the block 2, 4, 6, 8 or 12 weeks; not asked again for Add to it.
  var ASK_DAYS = ['2', '3', '4', '5', 'Every day'], ASK_WEEKS = ['2', '4', '6', '8', '12'], ASK_LEN = { injury: 200, notes: 600 };
  function freshAsk() { return { days: '', injury: '', weeks: '', notes: '' }; }
  function tidyAsk(a) {
    var o = freshAsk();
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      if (ASK_DAYS.indexOf(a.days) >= 0) o.days = a.days;
      if (ASK_WEEKS.indexOf(a.weeks) >= 0) o.weeks = a.weeks;
      ['injury', 'notes'].forEach(function (k) { if (typeof a[k] === 'string') o[k] = a[k].replace(/\r\n?/g, '\n').slice(0, ASK_LEN[k]); });
    }
    return o;
  }
  function askGiven(a) { return !!(a && (a.days || a.weeks || !blank(a.injury) || !blank(a.notes))); }
  // the form between picking the photos and Claude reading them (Photo to handout on Home, and Scan exercise page in the
  // builder; Add to it goes straight on). photoAskFor: { a: the answers being given (a copy), go(answers, or null to read
  // without them) }. Cancel or Escape leaves everything as it was; Skip reads the page without answers.
  var photoAskFor = null;
  function photoAskRows(a) {
    function seg(k, label, list) {
      return '<div class="f"><span id="pa-' + k + '-l">' + esc(label) + '</span><div class="seg ask-' + k + '" role="group" aria-labelledby="pa-' + k + '-l">' +
        list.map(function (o) { return '<button type="button" data-pa="' + k + '" data-value="' + esc(o) + '" aria-pressed="' + (a[k] === o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>';
    }
    return seg('days', 'How many days a week?', ASK_DAYS) +
      '<div class="f"><label for="paInjury">What’s the injury?</label><input id="paInjury" type="text" data-pa-text="injury" maxlength="' + ASK_LEN.injury + '" value="' + esc(a.injury) + '"' +
      ' placeholder="e.g. right ankle sprain, 3 weeks ago" autocapitalize="sentences" autocomplete="off" enterkeyhint="done" aria-describedby="paInjuryHint">' +
      '<small id="paInjuryHint">Claude mentions it only in Why this plan, in everyday words.</small></div>' +
      seg('weeks', 'How long is the training block? (weeks)', ASK_WEEKS) +
      '<div class="f brief"><label for="paNotes">Anything else you’d like Claude to add?</label><textarea id="paNotes" data-pa-text="notes" rows="3" maxlength="' + ASK_LEN.notes + '"' +
      ' placeholder="e.g. add a 5-minute bike warm-up; keep the cues simple. No names or dates." autocapitalize="sentences" aria-describedby="paNotesHint">' + esc(a.notes) + '</textarea>' +
      '<small id="paNotesHint">Claude follows it; it isn’t printed as you typed it.</small></div>';
  }
  function openPhotoAsk(files, go, a) {
    var cfg = exScanCfg(), photos = files.filter(function (f) { return !f.type || f.type.indexOf('image/') === 0; });
    if (!files.length) return;
    // nothing to ask when the page can't be read now: the scan says why (busy, no settings file, not a photo, offline)
    if (scanBusy.ex || suggestBusy || !DATA.ai || !cfg.model || !photos.length || navigator.onLine === false) { go(null); return; }
    if (!aiKey()) {
      openAiSettings(function () { openPhotoAsk(files, go, a); }, 'To read photos of a handwritten exercise page, the app needs a Claude API key. ' + ONCE_NOTE());
      return;
    }
    var n = Math.min(photos.length, cfg.max_photos || 6);
    photoAskFor = { a: tidyAsk(a), go: go };
    els.photoAskTitle.textContent = n > 1 ? 'Before Claude reads the ' + n + ' pages' : 'Before Claude reads the page';
    els.photoAskGo.textContent = n > 1 ? 'Read the pages' : 'Read the page';
    els.photoAskFields.innerHTML = photoAskRows(photoAskFor.a);
    openModal(els.photoAsk, els.photoAskGo, function () { photoAskFor = null; });
  }
  function photoAskDone(use) {                         // Read the page (use: the answers as given, kept even when cleared) or Skip
    var o = photoAskFor;
    if (!o) { closeModal(); return; }
    var a = use ? tidyAsk(o.a) : null;
    closeModal();
    o.go(a);
  }
  function onPhotoAskClick(e) {                        // a choice; tapped again, it's cleared (every answer is optional)
    var b = e.target.closest('button[data-pa]');
    if (!b || !photoAskFor) return;
    var k = b.dataset.pa, a = photoAskFor.a;
    a[k] = a[k] === b.dataset.value ? '' : b.dataset.value;
    b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.value === a[k])); });
  }
  function onPhotoAskInput(e) {
    var t = e.target.closest('[data-pa-text]');
    if (t && photoAskFor) photoAskFor.a[t.dataset.paText] = t.value.slice(0, ASK_LEN[t.dataset.paText]);
  }
  // the builder's Scan exercise page: the answers start from this program's last ones and are kept with it
  function exPhotoScan(files) {
    openPhotoAsk(files, function (a) {
      if (state.tool !== 'ex') return;
      if (a) { state.ex.ask = a; saveDraft(); }
      startScan(files, { ask: a });
    }, state.ex.ask);
  }
  // v32: the block length (whole weeks, 1–52, '' when not given) and an ISO date ('' when missing or unreadable)
  function exWeeks(v) { var n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 2), 10); return n >= 1 && n <= 52 ? String(n) : ''; }
  function exIsoDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && E.parseDate(v, ['Y-m-d']) ? v : ''; }
  function addDaysIso(iso, n) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3] + n)).toISOString().slice(0, 10) : '';
  }
  // the next review follows the program's date and the block length until the date is changed by hand (or cleared)
  function autoReview() {
    var x = state.ex, w = +x.weeks || 0;
    if (!x.reviewAuto && !blank(x.review)) return;
    x.review = w ? addDaysIso(x.meta.date || todayIso(), w * 7) : '';
    x.reviewAuto = !blank(x.review);
  }
  function syncReviewBox() {                           // the date box (unless it is being changed) and "This date has passed"
    var r = $('ex-review'), p = $('exPast');
    if (r && r !== document.activeElement && r.value !== state.ex.review) r.value = state.ex.review;
    if (p) p.hidden = !exReviewPast();
  }
  // drafts from v9 and earlier have no program; anything malformed in a stored one is tidied
  function tidyEx() {
    var x = state.ex;
    if (!x || typeof x !== 'object' || Array.isArray(x)) x = state.ex = freshEx();
    if (!x.meta || typeof x.meta !== 'object' || Array.isArray(x.meta)) x.meta = { name: '', date: todayIso(), practitioner: '' };
    var dt = x.meta.date;                              // a date cleared by hand stays cleared; anything unreadable becomes today
    x.meta = { name: exStr(x.meta.name), date: dt === '' || (typeof dt === 'string' && E.parseDate(dt, ['Y-m-d'])) ? dt : todayIso(), practitioner: exStr(x.meta.practitioner) };
    x.title = exStr(x.title); x.instructions = exStr(x.instructions); x.rationale = exStr(x.rationale).slice(0, EX_LEN.rationale);   // v25
    x.reason = exStr(x.reason).slice(0, EX_LEN.reason);  // v32: the cover of the handout (drafts before v32 have none)
    x.weeks = exWeeks(x.weeks);
    x.review = exIsoDate(x.review);
    x.reviewAuto = x.reviewAuto === true && !blank(x.review);
    x.large = x.large === true;
    x.photos = x.photos !== false;                     // v34: the library's photos on the handout (on unless switched off)
    x.phone = x.phone === true || x.phone === false ? x.phone : null;   // v35: on their phone (null: as their last program)
    var sh = x.share;                                  // v35: the link last sent from this page
    x.share = sh && typeof sh === 'object' && TOKEN_RE.test(sh.token) && typeof sh.key === 'string' ? { token: sh.token, key: sh.key, expires: typeof sh.expires === 'string' ? sh.expires : '' } : null;
    x.ask = tidyAsk(x.ask);                            // v33: the photo form's answers (drafts before v33 have none)
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
        if (typeof it.libWas === 'string' && LIB_ID.test(it.libWas) && it.libWas !== o.lib) o.libWas = it.libWas;   // v17: its link before the name was typed over (v48: kept while linked to another)
        if (!o.lib && typeof it.noAuto === 'string' && it.noAuto) o.noAuto = it.noAuto.slice(0, 120);   // v48: the name unlinked by hand (its key): it doesn't link itself again
        if (!blank(it.why)) o.why = clean1(it.why).slice(0, 120);   // v21: the finding a suggested exercise is for
      }
      list.push(o);
    });
    var seq = typeof x.seq === 'number' && x.seq % 1 === 0 && x.seq > 0 && x.seq < 1e9 ? x.seq : 1;
    x.seq = Math.max(seq, top + 1);
    list.forEach(function (o) { if (!o.id) o.id = 'r' + (x.seq++); });
    x.items = list;
    var sc = x.scanned && typeof x.scanned === 'object' && !Array.isArray(x.scanned) ? x.scanned : {}, keep = {};
    Object.keys(sc).forEach(function (k) { if (sc[k] === true && (k === 'title' || k === 'instructions' || k === 'rationale' || k === 'reason' || seen[k])) keep[k] = true; });
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
  function exColumns() {                               // v48: the handout's columns: Exercise, then each column with something in it
    var u = exUsed(), main = {};
    state.ex.items.forEach(function (it) { if (it.kind === 'ex') EX_MAIN.forEach(function (f) { if (!blank(it[f])) main[f] = true; }); });
    return ['name'].concat(EX_MAIN.filter(function (f) { return main[f]; }), EX_DETAIL.filter(function (f) { return u[f]; }));
  }

  // ---- the screen: patient card (with the scan button), program card (title, instructions, the table)
  function renderExPage() {                            // v15: whichever Exercises page is in use
    if (state.exPage === 'library') renderLibrary();
    else if (state.exPage === 'templates') renderTemplates();
    else renderEx();
  }
  function renderEx() {
    els.entry.innerHTML = '<div class="pagehead">' + pickHtml('ex') + '<p>' + esc(HEAD.ex[1]) + '</p></div>' + exPatientCard() + exFindCardHtml() + exProgramCard();   // v31: the report's findings
    fitExNotes();
    fitExWraps();
    applyExMarks();
    applyExLogged();                                   // v40
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
      field('ex', 'name', 'Client name', { cls: 'wide', words: true, readonly: !!lt }) + field('ex', 'date', 'Date', { type: 'date', readonly: !!lt }) +
      field('ex', 'practitioner', 'Clinician', { words: true }) +
      '</div>' + (lt ? '<p class="note ex-linknote">The name and date come from the ' + toolName(lt) + ' report.</p>' : '') + '</section>' + stripHtml('ex') + '<div class="scan-bar" id="scanBar" role="status" aria-live="polite" hidden></div><div class="client-bar" id="clientBar" hidden></div>';
  }
  // v18: the exercises first. The title, general instructions and Save as template sit under them (folded to
  // "+ Title and instructions" while both are empty); Start from template sits with the add buttons while the program is
  // empty. No Edit mode: every row has More and its bin, and More holds Move up / Move down.
  var exTopOpen = false;                               // + Title and instructions tapped (this visit only)
  function exProgramCard() {
    var x = state.ex, rows = x.items.length > 0, top = exTopOpen || exTopFilled();
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
      exRationaleHtml() +
      '<div class="ex-top' + (top ? '' : ' folded') + '" id="exTop">' + exTopHtml(top, rows) + '</div></section>';
  }
  // v25: Claude's note on how the program fits together (which findings the condition explains, what leads this block, what the
  // next block adds and the sign that moves it on). For the physiotherapist: shown while it has text, editable, saved with the
  // program and the client record, never printed. It appears in the blue "check me" look of a suggestion until it is edited.
  function exRationaleHtml() {
    var x = state.ex;
    if (blank(x.rationale) && !x.scanned.rationale) return '';
    return '<label class="f ex-rat" for="ex-rationale"><span>How this program fits together <small>(for you, not printed)</small></span>' +
      '<textarea id="ex-rationale" data-ex="rationale" rows="3" maxlength="' + EX_LEN.rationale + '" autocapitalize="sentences">' + esc(x.rationale) + '</textarea></label>';
  }
  // v32: the handout's cover: the title, Why this plan (for the client, printed; a suggestion drafts one), the general
  // instructions, and the block length with the next review (worked out from the date until changed by hand)
  function exTopFilled() { var x = state.ex; return !blank(x.title) || !blank(x.instructions) || !blank(x.reason) || !blank(x.weeks) || !blank(x.review); }
  function exReviewPast() { var r = state.ex.review; return !blank(r) && r < todayIso(); }
  function exTopHtml(open, rows) {
    var x = state.ex;
    return (open ? '<label class="f" for="ex-title"><span>Title</span><input id="ex-title" data-ex="title" type="text" value="' + esc(x.title) + '" maxlength="' + EX_LEN.title + '"' +
      ' placeholder="Optional, e.g. Knee rehab – phase 2" autocapitalize="sentences" autocomplete="off" enterkeyhint="next"></label>' +
      '<label class="f ex-reasonf" for="ex-reason"><span>Why this plan <small>(printed for the client)</small></span><textarea id="ex-reason" data-ex="reason" rows="2" maxlength="' + EX_LEN.reason + '"' +
      ' placeholder="Optional: a sentence or two on what this block works on and how it links to their testing" autocapitalize="sentences">' + esc(x.reason) + '</textarea></label>' +
      '<label class="f" for="ex-instructions"><span>General instructions</span><textarea id="ex-instructions" data-ex="instructions" rows="2" maxlength="' + EX_LEN.instructions + '"' +
      ' placeholder="Optional, e.g. 3 × per week. Ice after if sore." autocapitalize="sentences">' + esc(x.instructions) + '</textarea></label>' +
      '<div class="ex-cover"><label class="f ex-weeks" for="ex-weeks"><span>Program length</span><span class="ex-suffix"><input id="ex-weeks" data-ex="weeks" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2"' +
      ' value="' + esc(x.weeks) + '" placeholder="e.g. 6" autocomplete="off" enterkeyhint="next"><span aria-hidden="true">weeks</span></span></label>' +
      '<label class="f ex-review" for="ex-review"><span>Next review</span><input id="ex-review" data-ex="review" type="date" value="' + esc(x.review) + '"></label></div>' +
      '<p class="ex-past" id="exPast" role="status"' + (exReviewPast() ? '' : ' hidden') + '>This date has passed.</p>' : '') +
      '<div class="ex-tplbar">' + (open ? '' : '<button type="button" class="quiet" id="exTopOpen" data-action="ex-top-open" aria-controls="exTop">+ Title, why this plan and next review</button>') +
      '<button type="button" class="quiet" id="tplSave" data-action="tpl-save" aria-haspopup="dialog"' + (rows ? '' : ' hidden') + '>Save as template</button></div>';
  }
  // v32: the section opened (and its boxes refreshed) when a suggestion, a scan or an Undo changes what it holds; never while
  // one of its boxes is being typed in
  function renderExTop() {
    var top = $('exTop'), x = state.ex;
    if (!top || top.contains(document.activeElement)) return;
    var open = exTopOpen || exTopFilled();
    top.classList.toggle('folded', !open);
    top.innerHTML = exTopHtml(open, x.items.length > 0);
    fitExNotes();
    applyExMarks();
  }
  // v15: an exercise row linked to a library exercise (the entry, or null when unlinked or the entry has gone)
  function exLinked(it) { return it && it.kind === 'ex' && it.lib ? libGet(it.lib) : null; }
  // under the name of a linked row: the cues (as printed on the handout) and ▶ when there is a video
  function exLibStripHtml(it) {
    var e = exLinked(it), pic = thumbOf(e);
    if (!e) return '';
    // v48: the link is said in words, with Unlink beside it (until v47 only More › Unlink showed a row was linked)
    var tag = '<span class="el-tag">From the library</span><button type="button" class="quiet el-unlink" data-action="ex-unlink">Unlink<span class="vh"> ' + esc(e.name) + ' from the library</span></button>';
    if (!e.cues.length && !hasVideo(e) && !pic) return tag;
    return tag + (pic ? '<button type="button" class="el-pic" data-action="ex-photo" aria-label="See ' + esc(e.name) + (e.photo ? ' photo' : ' video') + '"><img src="' + esc(pic) + '" alt=""></button>' : '') +   // v34
      '<span class="el-cues">' + esc(e.cues.join(' · ')) + '</span>' +   // v18: no Draft badge here (the library page shows it)
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
  // v48: a typed name that is exactly a library exercise (or one of its other names) links by itself, so its cues and video
  // print; the row shows "From the library" with Unlink. Unlinked by hand, that exact name (it.noAuto, its key) never
  // links itself again; another library name typed in its place does.
  // it.libWas (v17) is the link that went last, kept while the row is linked to another exercise too (v48), so a variation
  // typed after it ("Split squat with band" after "Rear-foot elevated split squat") finds its way back.
  function exRelink(it) {
    var cur = it.lib ? libGet(it.lib) : null, was = it.libWas ? libGet(it.libWas) : null;
    var m = E.libMatch(it.name, libList()), auto = !!m && it.noAuto !== E.libKey(it.name);
    function holds(e) { return !!e && nameHolds(it.name, e) && (!m || m.id === e.id); }
    if (auto) {                                        // v48: exactly a library exercise (or one of its other names)
      if (cur && cur.id === m.id) return false;
      if (cur) it.libWas = cur.id;
      it.lib = m.id; delete it.noAuto;
      if (it.libWas === it.lib) delete it.libWas;
      return true;
    }
    if (cur) {
      if (holds(cur)) return false;
      if (was && was.id !== cur.id && holds(was)) { it.lib = was.id; delete it.libWas; return true; }
      it.libWas = cur.id; it.lib = ''; return true;
    }
    if (holds(was)) { it.lib = was.id; delete it.libWas; return true; }
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
    renderExRationale();                               // v25: the box comes and goes with its text
    renderExTop();                                     // v32: and the handout's cover opens when a suggestion fills it
    fitExWraps();
    applyExMarks();
    applyExDose();                                     // v48: rows with no sets or reps
    applyExLogged();                                   // v40: what the client logged last, under each exercise
    refreshEx();
  }
  function renderExRationale() {                       // v25: show, update or remove the rationale box without redrawing the card
    var card = $('exCard'), x = state.ex, html = exRationaleHtml(), cur = card && card.querySelector('.ex-rat');
    if (!card) return;
    if (!html) { if (cur) cur.remove(); return; }
    if (cur) { var ta = cur.querySelector('textarea'); if (ta && ta.value !== x.rationale) ta.value = x.rationale; }
    else { var top = $('exTop'); if (top) top.insertAdjacentHTML('beforebegin', html); else card.insertAdjacentHTML('beforeend', html); }
    fitExNotes();
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
    ['title', 'instructions', 'rationale', 'reason'].forEach(function (k) { var el = $('ex-' + k); if (el) el.classList.toggle('scanned', !!sc[k]); });
  }
  function fitExNotes() {                              // grow the instructions box (and the rationale box, v25) to show all of it
    ['ex-instructions', 'ex-rationale', 'ex-reason'].forEach(function (id) {
      var ta = $(id);
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.max(76, ta.scrollHeight + 2) + 'px';
    });
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
  // ---- v31: the linked report's findings beside the program (Matthew, 4 Oct, from the UI research review: the off-target and
  // close results with their values and targets, worst first as in the report's Top priorities, so choosing exercises never
  // means going back to the report). In the handout panel on a wide screen (an iPad in landscape); below 1000 px, where that
  // panel sits under the program, a fold-out card above the program. Each finding is a button to its row in the report.
  // Nothing scored in the report (or no link): no card.
  var EX_FIND_MAX = 10;                                // listed; the rest are counted ('+ 3 more in the report')
  var exFindOpen = false;                              // the fold-out card opened (this visit only)
  function exFindData() {
    var lt = linkedTool();
    if (!lt) return null;
    var c = computeFor(lt), list, guide = null;
    if (lt === 'str') {
      if (!c.rows.length) return null;
      list = c.prios.map(function (r) { return { key: r.id, name: r.name, status: r.status, detail: r.text + ' · target ' + r.target }; });
    } else if (lt === 'ankle') {                       // v42: the items short of full points, with their points
      if (!c.groups.length) return null;
      list = c.prios.map(function (r) { return { key: r.name, name: r.label, status: r.status, detail: agoVal(r.result, r.unit) + ' \u00b7 ' + ptsText(r.pts, r.max) }; });
      var n0 = c.counts;
      return { tool: lt, list: list, guide: null, green: n0.Green, total: n0.Green + n0.Amber + n0.Red, ago: c.ago };
    } else {
      if (!c.groups.length) return null;
      list = E.priorities(c.groups, 999).map(function (r) {
        return { key: r.name, name: r.name, status: r.status, detail: (E.fmt(r.result) + ' ' + (r.unit || '')).trim() + (r.side ? ' (' + r.side + ' higher)' : '') + ' · target ' + r.target };
      });
      // the DSI on the screen (v28): never rated, but it sets the training emphasis
      E.flatten(c.groups).forEach(function (r) { if (!guide && r.status === 'Guide' && r.guide) guide = r; });
    }
    var n = c.counts;
    return { tool: lt, list: list, guide: guide, green: n.Green, total: n.Green + n.Amber + n.Red };
  }
  function exFindSub(d) {                              // 'Performance screen · 6 of 11 on target'
    if (d.ago) return toolName(d.tool) + ' \u00b7 ' + d.ago.total + ' of ' + d.ago.max + (d.ago.complete ? '' : ' so far');   // v42: 'Ankle-GO · 10 of 25'
    return toolName(d.tool) + (d.total ? ' · ' + d.green + ' of ' + d.total + ' on target' : '');
  }
  function exFindItem(key, name, chipHtml, detail) {
    return '<li><button type="button" class="prio-go" data-action="ex-find-go" data-goto="' + esc(key) + '"><span class="pn">' + esc(name) + '</span>' +
      chipHtml + '<span class="pd">' + esc(detail) + '</span></button></li>';
  }
  function exFindListHtml(d) {
    var h = '';
    if (d.list.length) {
      h = '<ol class="prio ex-find-list">' + d.list.slice(0, EX_FIND_MAX).map(function (f) {
        return exFindItem(f.key, f.name, chip(f.status, statusWord(f.status, d.tool)), f.detail);   // Behind on the rehab tools
      }).join('') + '</ol>' + (d.list.length > EX_FIND_MAX ? '<p class="fine">+ ' + (d.list.length - EX_FIND_MAX) + ' more in the report</p>' : '');
    } else if (d.total) {
      h = '<p class="ok">Nothing flagged — every tested result is on target.</p>';
    }
    if (d.guide) {
      h += '<ul class="prio ex-find-guide">' + exFindItem(d.guide.name, d.guide.name, chip('Guide', d.guide.guide),
        E.fmt(d.guide.result) + ' · sets the training emphasis, not a target') + '</ul>';
    }
    return h;
  }
  function exFindPeek(d) {                             // the folded card's line: the first three findings by name
    if (!d.list.length) return d.total ? 'Nothing flagged — every tested result is on target.' : (d.guide ? d.guide.name + ': ' + d.guide.guide : '');
    var names = d.list.slice(0, 3).map(function (f) { return f.name; }).join(', ');
    return names + (d.list.length > 3 ? ' + ' + (d.list.length - 3) + ' more' : '');
  }
  function exFindSideHtml() {                          // in the handout panel (shown from 1000 px)
    var d = exFindData();
    if (!d) return '';
    return '<section class="ex-find ex-find-side" aria-labelledby="exFindSideH"><h3 id="exFindSideH">From the report' + (d.list.length ? ' <small>worst first</small>' : '') + '</h3>' +
      '<p class="ex-find-sub">' + esc(exFindSub(d)) + '</p>' + exFindListHtml(d) + '</section>';
  }
  function exFindCardHtml() {                          // above the program (shown below 1000 px), folded to one line until opened
    var d = exFindData();
    if (!d) return '';
    var open = exFindOpen;
    return '<section class="card ex-find ex-find-card' + (open ? '' : ' folded') + '" id="exFindCard" aria-labelledby="exFindCardH"><div class="card-head">' +
      '<div class="fold-t"><h2 id="exFindCardH">From the report</h2><p class="ex-find-sub">' + esc(exFindSub(d)) + '</p>' +
      (open ? '' : '<p class="ex-find-peek">' + esc(exFindPeek(d)) + '</p>') + '</div>' +
      '<button type="button" class="ghost ex-find-tog" data-action="ex-find-toggle" aria-expanded="' + open + '" aria-controls="exFindBody">' + (open ? 'Hide' : 'Show') + '</button></div>' +
      '<div class="ex-find-body" id="exFindBody"' + (open ? '' : ' hidden') + '>' + exFindListHtml(d) + '</div></section>';
  }
  function toggleExFind() {
    exFindOpen = !exFindOpen;
    var card = $('exFindCard');
    if (!card) return;
    card.outerHTML = exFindCardHtml();
    var b = document.querySelector('#exFindCard .ex-find-tog');
    if (b) b.focus();
  }
  function gotoFinding(key) {                          // a finding tapped: its row in the report, flashed (as from Top priorities)
    if (!linkedTool()) return;
    backToReport();
    gotoMetric(key);
  }
  // v35: the handout panel's "On their phone" (signed in to the clinic store only), with until when the link will work
  function exPhoneFine() {                              // the line under it: what it does, and until when
    var on = phoneOn(), l = on && state.ex.phone !== true ? clientLink(exKey()) : null;
    return on ? (l ? 'Updates the link they have. ' : 'A private link and its code on the handout. ') + 'Works until ' + E.displayIso(phoneEnds().day) + '.'
      : 'A private link to the program, and its code on the handout.';
  }
  function exPhoneHtml() {
    if (!phoneReady()) return '';
    return '<label class="ex-large" for="exPhone"><input type="checkbox" id="exPhone"' + (phoneOn() ? ' checked' : '') + ' aria-describedby="exPhoneFine"><span>On their phone</span></label>' +
      '<p class="fine ex-phone-fine" id="exPhoneFine">' + esc(exPhoneFine()) + '</p>';
  }
  function renderExSummary(c) {
    var why = c.exercises ? '' : 'Add at least one exercise to create the handout.';
    // v19: linked to a report: one PDF with both, so the report has to be ready too (else its reason shows)
    var lt = linkedTool(), cand = reportFor(), nm = clean1(state.ex.meta.name), whose = nm ? nm + '’s ' : 'the ';
    if (lt && !why) { var rb = blocker(computeFor(lt), lt); if (rb) why = toolName(lt) + ' report: ' + rb.charAt(0).toLowerCase() + rb.slice(1); }
    var make = lt ? 'Create report + exercises' : 'Create handout';
    var linkHtml = lt ? '<div class="ex-link"><p class="ex-linkline">' + EX_ICON + '<span>Prints after ' + esc(whose + toolName(lt)) + ' report</span></p>' +
        '<div class="ex-linkacts"><button type="button" class="quiet" data-action="back-to-report">‹ Back to the report</button>' +
        '<button type="button" class="quiet" data-action="unlink-program">Print on its own</button></div></div>'
      : cand ? '<button type="button" class="quiet ex-flag" data-action="link-report" data-tool="' + cand + '">' + EX_ICON + 'Print with ' + esc(whose + toolName(cand)) + ' report</button>' : '';
    var cols = exColumns(), later = EX_MAIN.concat(EX_DETAIL).filter(function (f) { return cols.indexOf(f) < 0; }).map(function (f) { return EX_LABEL[f]; });   // v48: Sets, Reps and Load print only when given
    var laterText = later.length ? (later.length > 1 ? later.slice(0, -1).join(', ') + ' and ' + later[later.length - 1] : later[0]) + (later.length > 1 ? ' are' : ' is') + ' added when used.' : '';
    // v15: how many filled rows are linked to the library, and how many of those print a video QR code
    var linked = 0, vids = 0, pics = 0;
    state.ex.items.forEach(function (it) { var e = exFilled(it) && exLinked(it); if (e) { linked++; if (hasVideo(e)) vids++; if (thumbOf(e)) pics++; } });   // v34: + photos
    // v18: the panel says it in two short lines (until v17: tiles, a column list and notes)
    var counts = c.exercises + (c.exercises === 1 ? ' exercise' : ' exercises') + (c.sections ? ' · ' + c.sections + (c.sections === 1 ? ' section' : ' sections') : '') +
      (pics ? ' · ' + pics + (pics === 1 ? ' photo' : ' photos') : '') + (vids ? ' · ' + vids + (vids === 1 ? ' video' : ' videos') : '');
    var prints = (cols.length > 1 ? 'Prints ' + andList(cols.slice(1).map(function (f) { return EX_LABEL[f]; })) + '.' : 'Prints the exercise names.') + (laterText ? ' ' + laterText : '');
    // v31: the panel is redrawn as the program is typed; a findings list scrolled down stays where it was
    var was = els.summary.querySelector('.ex-sum .sum-scroll'), keepTop = was ? was.scrollTop : 0;
    els.summary.innerHTML = '<div class="sum ex-sum"><div class="sum-scroll"><h2>Exercise handout</h2>' +
      '<p class="ex-sumline">' + esc(counts) + '</p><p class="fine ex-prints">' + esc(prints) + '</p>' +
      // v32: large print for clients who find small text hard to read (kept with the program)
      '<label class="ex-large" for="exLarge"><input type="checkbox" id="exLarge"' + (state.ex.large ? ' checked' : '') + '><span>Large print</span></label>' +
      // v34: the library's photos beside the exercises (only when some have one)
      (pics ? '<label class="ex-large" for="exPhotos"><input type="checkbox" id="exPhotos"' + (state.ex.photos !== false ? ' checked' : '') + '><span>Exercise photos</span></label>' : '') +
      exPhoneHtml() +                                  // v35: on their phone
      exFindSideHtml() +
      '</div><div class="sum-foot">' + linkHtml + '<button type="button" class="primary make" data-action="report"' + (why ? ' disabled' : '') + '>' + make + '</button>' +
      (why ? '<p class="fine">' + esc(why) + '</p>' : '') +
      '<p class="fine client-line">' + esc(clientLine('ex')) + '</p></div></div>';
    if (keepTop) { var sc = els.summary.querySelector('.sum-scroll'); if (sc) sc.scrollTop = keepTop; }
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
      if (el.dataset.meta === 'date') { autoReview(); syncReviewBox(); }   // v32: the next review follows the date
      refreshEx();
      if (el.dataset.meta === 'name') suggestClients('ex', el.value);   // v15: saved clients, as on the report tools
      return;
    }
    if (el.dataset.ex === 'weeks') {                   // v32: whole weeks (digits only); the next review follows
      var digits = el.value.replace(/[^0-9]/g, '').slice(0, 2);
      if (digits !== el.value) el.value = digits;
      x.weeks = exWeeks(digits);
      autoReview();
      syncReviewBox();
      refreshEx();
      return;
    }
    if (el.dataset.ex === 'review') {                  // v32: a date chosen by hand stays (the block length no longer moves it)
      x.review = exIsoDate(el.value);
      x.reviewAuto = false;
      syncReviewBox();
      refreshEx();
      return;
    }
    if (el.dataset.ex) {                               // the title or the general instructions (v32: or Why this plan)
      x[el.dataset.ex] = el.value;
      if (x.scanned[el.dataset.ex]) { delete x.scanned[el.dataset.ex]; el.classList.remove('scanned'); }
      if (el.id === 'ex-instructions' || el.id === 'ex-rationale' || el.id === 'ex-reason') fitExNotes();
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
    if (it.kind === 'ex') row.classList.toggle('nodose', exFilled(it) && blank(it.sets) && blank(it.reps));   // v48
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
    delete it.noAuto;                                  // v48
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
    if (a === 'ex-find-toggle') { toggleExFind(); return true; }   // v31: the report's findings
    if (a === 'ex-find-go') { gotoFinding(b.dataset.goto); return true; }
    if (!a || a.indexOf('ex-') !== 0) return false;
    var row = b.closest('.ex-row'), i = row ? exIndex(row.dataset.id) : -1;
    if (i < 0) return true;
    var it = x.items[i];
    // v15: the row's library link
    if (a === 'ex-video') { var ve = exLinked(it); if (ve) openExVideo(ve); return true; }   // v34: the uploaded video, else the link
    if (a === 'ex-photo') { var pe = exLinked(it); if (pe) openExPhoto(pe); return true; }
    if (a === 'ex-unlink' || a === 'ex-linkto') {
      var to = a === 'ex-linkto' ? libGet(b.dataset.lib) : null;
      if (a === 'ex-linkto' && !to) return true;
      it.lib = to ? to.id : '';
      delete it.libWas;                                // v17: chosen by hand (a typed name won't bring the old link back)
      if (to) delete it.noAuto; else it.noAuto = E.libKey(it.name) || '';   // v48: nor link itself again under this name
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
    [els.appbar, els.cloudBar, els.updBar, $('athleteStrip')].forEach(function (el) {   // v44: + the new-version bar
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
    var phone = phoneOn() && phoneReady();             // v35: the copy for the client's phone goes with it
    var groups = [], cur = null, items = [], pgroups = [], pcur = null;
    x.items.forEach(function (it) {
      if (it.kind === 'section') {
        if (!blank(it.heading)) {
          cur = { heading: clean1(it.heading), rows: [] }; groups.push(cur); items.push({ kind: 'section', heading: cur.heading });
          pcur = { heading: cur.heading, rows: [] }; pgroups.push(pcur);
        }
        return;
      }
      if (!exFilled(it)) return;
      if (!cur) { cur = { heading: '', rows: [] }; groups.push(cur); pcur = { heading: '', rows: [] }; pgroups.push(pcur); }
      var r = {}, keep = { kind: 'ex' }, e = exLinked(it), vi = e && E.videoInfo(e.video);
      EX_FIELDS.forEach(function (f) { r[f] = clean1(it[f]); keep[f] = r[f]; });
      keep.lib = it.lib || '';
      if (e && e.cues.length) { r.cues = e.cues.slice(); keep.cues = e.cues.slice(); }
      if (phone) pcur.rows.push(phoneRow(r, e, vi));   // (before the photo: the phone has the picture's address)
      if (vi) { r.video = vi.link; keep.video = vi.link; }
      else if (e && e.clip) { r.video = e.clip.url; keep.video = e.clip.url; }   // v34: an uploaded video's code
      var pic = x.photos !== false ? thumbOf(e) : '';   // v34: its photo (or a frame of its video), when loaded
      if (pic && photoData[pic]) r.photo = photoData[pic];
      cur.rows.push(r);
      items.push(keep);
    });
    var m = x.meta, name = clean1(m.name), title = clean1(x.title), instructions = String(x.instructions || '').trim();
    var reason = String(x.reason || '').trim().slice(0, EX_LEN.reason), weeks = exWeeks(x.weeks), review = exIsoDate(x.review);   // v32: the cover
    var share = null;
    if (phone) {                                       // v35: the link, until when, and the program as the phone shows it
      var token = phoneToken(), ends = phoneEnds();
      share = { token: token, key: exKey(), expires: ends.iso, day: ends.day, url: phoneUrl(token), first: firstName(name),
        copy: { v: 1, first: firstName(name), clinician: clean1(m.practitioner), date: exIsoDate(m.date), title: title, reason: reason, instructions: instructions,
          weeks: weeks, review: review, groups: pgroups.filter(function (g) { return g.rows.length; }) } };
    }
    var program = { title: title, instructions: instructions, items: items, plan: tidyPlan(x.plan), rationale: String(x.rationale || '').trim().slice(0, EX_LEN.rationale),   // v23: the plan goes with the saved program; v25: the rationale too
      reason: reason, weeks: weeks, review: review, large: !!x.large, photos: x.photos !== false };   // v32: and the cover, as printed; v34: photos
    if (share) program.share = { token: share.token, expires: share.expires };   // v35: the client's link
    return {
      file: name ? name.replace(/[\\/:*?"<>|]+/g, '-').replace(/ /g, '_') + '_exercises.pdf' : 'exercises.pdf',
      rep: window.BHReport.exercises({
        meta: { name: name, date: E.displayIso(m.date), practitioner: withProf(m.practitioner) },   // v49: + profession (the footer too)
        title: title, instructions: instructions,
        reason: reason, weeks: weeks, review: review ? E.displayIso(review) : '', large: !!x.large,   // v32
        phone: share ? { url: share.url, until: E.displayIso(share.day) } : null,   // v35
        groups: groups.filter(function (g) { return g.rows.length; })
      }),
      program: program,
      share: share
    };
  }

  // ---- Scan exercise page: the photos go to Claude with this prompt and schema (and nothing from the patient card)
  var EX_SCAN_DEFAULT = {
    effort: 'medium', max_tokens: 8000, timeout_s: 120, max_edge: 2000, max_photos: 6,
    system: [
      'You read exercise programs from photos taken at BASE Health Noosa, a physiotherapy, exercise physiology and exercise science clinic in Queensland, Australia. The photos are a clinician’s handwritten exercise program for a client. Your answer fills a table that the practitioner checks and then prints as a handout for the client.',
      'Do your best with what is written. Any of sets, reps, load, rest, tempo, side or notes may be missing for an exercise: leave those fields as empty strings. Never invent exercises or values, and never fill in anything that is not written on the page. Keep the exercises in the order they are written.',
      'Tidy each exercise name into a clear, full name in sentence case, expanding common shorthand: SL = single-leg, DL = deadlift, BW = body weight, DB = dumbbell, KB = kettlebell, BB = barbell, TB = TheraBand, ecc = eccentric, iso = isometric, ext = extension, flex = flexion, and other standard abbreviations like these. Well-known exercise names that are normally written as initials, such as RDL, stay as they are. Keep the equipment and variations that are written (for example "SL RDL" becomes "Single-leg RDL" and "KB swing" becomes "Kettlebell swing"). When you are not sure what a piece of shorthand means, keep it exactly as written and add a note to unclear.',
      'Read the usual notation: "3x10" is sets 3 and reps 10; "3 x 8-12" is reps "8–12" (with an en dash); "3 x 30s" is reps "30 s"; "@20kg" or "20kg" is load "20 kg"; "BW" as a load is "Body weight"; "e/s", "ea side" or "each leg" is side "Each side", and "L only" is side "Left" ("R only" is "Right"); "r 90s" or "90s rest" is rest "90 s"; a tempo such as "3-1-1" is tempo, copied as written. Other short cues for an exercise (for example "slow lowering" or "keep hips level") go in its notes.',
      'Copy numbers exactly as written: don’t round, total or convert them. Keep units as written (don’t convert lb to kg or minutes to seconds), with a space between a number and its unit (20 kg, 30 s, 2 min).',
      'Section headings on the page (for example Warm-up, Day A, Day B, Gym or Home) become sections, in order, each holding the exercises written under it. If the page has no headings, return one section with an empty heading holding every exercise.',
      'Instructions for the whole program rather than one exercise (for example "3x/week" or "ice after") go in the top-level notes, written out plainly (for example "3 times a week. Ice after."). A title for the whole program, if one is written, goes in title; otherwise title is an empty string.',
      'Ignore names and any other personal details on the page (the client’s name, date of birth, phone number or address) and never include them in your answer.',
      'Put a short note in unclear for anything that is hard to read or ambiguous, naming the exercise it is about (for example "Step-up: 10 or 16 reps?"), and for any shorthand kept as written. Leave unclear empty when everything is clear.',
      'Sometimes the request also has the clinician’s answers to a few questions: how many days a week, the injury, the block length, and anything else they’d like added. With no answers, leave why_this_plan empty, set added to false on every exercise and add nothing.',
      'With answers, keep the page as the clinician wrote it: every exercise, every value and their order stay exactly as written (the rules above), and the layout stays as written: one list stays one list, done on every session day, even when the days a week are given; days or sections written on the page stay as they are.',
      'With answers, title: as written on the page; if none is written, a short title for what the exercises work on, with the block length when it is given, in sentence case (for example "Strength and balance – 6 weeks"). The injury goes only in why_this_plan: leave it out of the title and the notes.',
      'With answers, notes (the general instructions): what the page says for the whole program, with how often at the start when the days are given and the page doesn’t already say ("3 times a week." or "Every day."); if the page gives a different number of days, keep the page’s and say so in unclear. Short and plain. The handout prints the block length and the review date separately, so leave them out here.',
      'why_this_plan: 2 or 3 short sentences printed on the client’s handout under the title, written to them as “you” (only here): what this program works on and why, with the injury in everyday words as the clinician gave it, how often and for how long, and what happens next (a review at the end of the block). Warm and direct, plain Australian English; no names; no diagnosis beyond what the clinician wrote; no promises about results or returning to sport. For example: “These exercises build strength and balance in your right ankle after your sprain. Do them three times a week for the next six weeks, and we’ll review how it’s going at the end of the block.”',
      'Anything else from the clinician is an instruction: follow it. When it asks for something that isn’t on the page (an exercise, a warm-up, a cue, a rest time), add it, written the same way as the page’s exercises; set added to true on an exercise you add (false on every exercise from the page). Change something written on the page only when it asks you to. Put one line in unclear for each thing you added or changed (for example "Added a 5-minute bike warm-up, as asked."). Add nothing that wasn’t asked for.'
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
  // v33: the clinician's answers from the form after the photos (no names: the patient's and the clinician's are taken out)
  function askLines(a) {
    var x = state.ex, scrub = function (t) { return withoutName(withoutName(clean1(t), x.meta.name, 'client'), x.meta.practitioner, 'clinician'); };
    if (!askGiven(a)) return '\n\nNo answers from the clinician this time: leave why_this_plan empty, set added to false on every exercise and add nothing.';
    var L = ['', 'The clinician’s answers (use them as your instructions say):'];
    if (a.days) L.push('- How often: ' + (a.days === 'Every day' ? 'every day' : a.days + ' days a week') + ' (the same exercises each session unless the page sets out days).');
    if (!blank(a.injury)) L.push('- The injury: ' + scrub(a.injury));
    if (a.weeks) L.push('- Block length: ' + a.weeks + ' weeks.');
    if (!blank(a.notes)) L.push('- Anything else (follow it): ' + scrub(a.notes));
    return '\n' + L.join('\n');
  }
  function exScanRequest(n, ask) {
    var names = libList().slice(0, 300).map(function (e) { return e.name; });
    return 'Turn the handwritten exercise program in ' + (n > 1 ? 'these ' + n + ' photos (pages in order)' : 'this photo') +
      ' into the table format: the title and general instructions if written, then each section in the order written, with its exercises. Use an empty string for anything that isn’t written.' + askLines(ask) +
      (names.length ? '\n\nExercises in the clinic’s library (when a written exercise is clearly one of these, use this name exactly; keep any variation that is written, such as equipment, side or a hold time, in the name or notes): ' + names.join('; ') : '');
  }
  function exScanSchema() {
    var str = { type: 'string' }, ex = { type: 'object', properties: {}, required: EX_FIELDS.concat(['added']), additionalProperties: false };
    EX_FIELDS.forEach(function (f) { ex.properties[f] = str; });
    ex.properties.added = { type: 'boolean' };      // v33: an exercise the clinician's answers asked for, not on the page
    return {
      type: 'object',
      properties: {
        title: str, notes: str,
        sections: { type: 'array', items: { type: 'object', properties: { heading: str, exercises: { type: 'array', items: ex } }, required: ['heading', 'exercises'], additionalProperties: false } },
        why_this_plan: str,                            // v33: written from the clinician's answers (empty without them)
        unclear: { type: 'array', items: str }
      },
      required: ['title', 'notes', 'sections', 'why_this_plan', 'unclear'],
      additionalProperties: false
    };
  }
  // a value from Claude, tidied: no emoji or invisible characters, one line (the instructions keep their line breaks),
  // a lone dash or "n/a" counts as not written, and nothing longer than the box allows
  function exTidy(v, f) {
    var s = String(v == null ? '' : v);
    if (s.normalize) s = s.normalize('NFC');
    s = s.replace(/[\uD800-\uDFFF]/g, '').replace(/[\uFE0F\u200B-\u200D\u2060\uFEFF]/g, '');
    s = f === 'instructions' || f === 'rationale' || f === 'reason' ? s.replace(/\r\n?/g, '\n').replace(/[ \t\u00A0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      : s.replace(/\s+/g, ' ').trim();
    if (/^(?:[-–—]+|n\/?a)$/i.test(s)) return '';
    var max = EX_LEN[f] || 60;
    return s.length > max ? s.slice(0, max).trim() : s;
  }
  // replace the table with the scanned one (the title and instructions only when found); Undo puts back exactly what was there
  function applyExScan(out, photos, append, ask) {      // append (v30): after the rows already there, keeping their title and notes; ask (v33): the answers
    var x = state.ex, found = [], n = 0, extra = 0;
    (out && Array.isArray(out.sections) ? out.sections : []).forEach(function (sec) {
      if (!sec || typeof sec !== 'object') return;
      var rows = (Array.isArray(sec.exercises) ? sec.exercises : []).map(function (e) {
        var r = {};
        EX_FIELDS.forEach(function (f) { r[f] = exTidy(e && typeof e === 'object' ? e[f] : '', f); });
        if (ask && e && e.added === true) r.added = true;   // v33: asked for in "anything else", not on the page
        return r;
      }).filter(function (r) { return EX_FIELDS.some(function (f) { return r[f]; }); });
      if (!rows.length) return;
      var h = exTidy(sec.heading, 'heading');
      if (h) found.push({ heading: h });
      rows.forEach(function (r) { found.push({ row: r }); n++; });
    });
    var unclear = (out && Array.isArray(out.unclear) ? out.unclear : []).map(function (u) { return clean1(u); }).filter(Boolean).slice(0, 12);
    if (!n) { scanInfo.ex = { tool: 'ex', kind: 'empty', n: 0, photos: photos, unclear: unclear, undo: null }; return; }
    var before = exSnap();
    var marks = {}, lib = libList(), matched = 0;
    var rows = found.map(function (f) {
      var it = f.heading ? newExSection(f.heading) : newExRow(f.row);
      if (!f.heading) { var e = E.libMatch(it.name, lib); if (e) { it.lib = e.id; matched++; } }   // v15: linked; the values stay as read
      if (!f.heading && f.row.added) { it.why = 'Added by Claude, as you asked'; extra++; }   // v33: shown under the row, never printed
      marks[it.id] = true;
      return it;
    });
    var title = exTidy(out.title, 'title'), notes = exTidy(out.notes, 'instructions'), added = append && x.items.length > 0;
    if (added) {                                       // v30: the rows already there stay (and stay highlighted if not yet checked)
      Object.keys(x.scanned || {}).forEach(function (k) { if (x.scanned[k]) marks[k] = true; });
      x.items = x.items.concat(rows);
      if (title && blank(x.title)) { x.title = title; marks.title = true; }
      if (notes && blank(x.instructions)) { x.instructions = notes; marks.instructions = true; }
    } else {
      x.items = rows;
      if (title) { x.title = title; marks.title = true; } else if (x.scanned.title) marks.title = true;
      if (notes) { x.instructions = notes; marks.instructions = true; } else if (x.scanned.instructions) marks.instructions = true;
    }
    // v33: with the clinician's answers: Why this plan (blue until edited) and the block length, the review date following it
    var wrote = [];
    if (ask && !added) {
      var why = exTidy(out.why_this_plan, 'reason');
      if (title) wrote.push('the title');
      if (notes) wrote.push('the instructions');
      if (why) { x.reason = why; marks.reason = true; wrote.push('Why this plan'); }
      if (ask.weeks) { x.weeks = exWeeks(ask.weeks); autoReview(); wrote.push('a ' + x.weeks + '-week block'); }
    }
    x.scanned = marks;
    scanInfo.ex = { tool: 'ex', kind: 'done', n: n, photos: photos, unclear: unclear, undo: before, matched: matched, added: added,
      asked: !!ask && !added, wrote: wrote, weeks: ask && !added ? ask.weeks : '', extra: extra };
  }
  // the program as it is now (for an Undo), and putting it back unless Clear all replaced the program since
  function exSnap() {
    var x = state.ex;
    return { title: x.title, instructions: x.instructions, rationale: x.rationale, reason: x.reason, weeks: x.weeks, review: x.review, reviewAuto: x.reviewAuto,   // v32: the cover too
      items: JSON.parse(JSON.stringify(x.items)), scanned: Object.assign({}, x.scanned), seq: x.seq };
  }
  function exCoverBack(x, u) {                         // v32: Why this plan, the block length and the next review as they were
    x.reason = exStr(u.reason); x.weeks = exWeeks(u.weeks); x.review = exIsoDate(u.review); x.reviewAuto = u.reviewAuto === true && !blank(x.review);
  }
  function exRestore(u, prog) {
    if (state.ex !== prog) return false;
    prog.title = u.title; prog.instructions = u.instructions; prog.rationale = exStr(u.rationale); prog.items = u.items; prog.scanned = u.scanned;
    exCoverBack(prog, u);
    prog.seq = Math.max(prog.seq, u.seq);              // ids are never reused
    if (state.tool === 'ex' && state.exPage === 'builder') render(); else saveDraft();
    return true;
  }
  function showExScan() {                              // redraw the program without touching the patient card (its keyboard stays put)
    var x = state.ex, ti = $('ex-title'), tx = $('ex-instructions'), tr = $('ex-reason');
    if (ti && ti.value !== x.title) ti.value = x.title;
    if (tx && tx.value !== x.instructions) { tx.value = x.instructions; fitExNotes(); }
    if (tr && tr.value !== x.reason) { tr.value = x.reason; fitExNotes(); }   // v32
    renderExTable();
  }
  function undoExScan() {
    var u = scanInfo.ex && scanInfo.ex.undo, x = state.ex, ai = !!(scanInfo.ex && scanInfo.ex.ai);
    if (!u) return;
    x.title = u.title; x.instructions = u.instructions; x.rationale = exStr(u.rationale); x.items = u.items; x.scanned = u.scanned;
    exCoverBack(x, u);
    x.seq = Math.max(x.seq, u.seq);                    // ids are never reused
    delete scanInfo.ex;
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
  // v25 (Matthew: "the AI needs to consider how one might affect the other"): with a condition, Claude reads the report as a whole,
  // sorts the findings into those the condition explains and those that are separate, names the sections Rehab / Performance /
  // Keep up, says what leads the block, and writes a rationale for the physiotherapist that stays with the program (never printed).
  var SUGGEST_TOOLS = ['screen', 'str', 'ham', 'acl', 'ankle', 'custom'];   // v36: + the Custom battery; v42: + Ankle-GO
  var EX_SUGGEST_DEFAULT = {
    effort: 'high', max_tokens: 32000, timeout_s: 480, max_per_day: 5, cache: '1h',   // v26: the cap is per training day; v28: room for a three-day program; v29: high effort (the JSON answer leaves Claude only its hidden thinking to reason in, which medium effort often skips), room for that thinking, and the reference documents cached for an hour
    system: [
      'You suggest an exercise program for a clinician (a physiotherapist, exercise physiologist or exercise scientist) at BASE Health Noosa, a clinic in Queensland, Australia, from the results of a testing report. Your suggestions fill a draft that the clinician checks, edits and then prints as a handout for the person tested. The clinician makes every clinical decision; you are saving them the first draft.',
      'Prefer the clinic’s library listed in the request: when it has a suitable exercise, give its id exactly as written there (and leave name empty). When the library has nothing suitable for a priority, or a clearly better exercise exists, give an exercise of your own instead: leave id empty and give its name (a clear, full name in sentence case, with the equipment or variation in the name) and one short note, under 100 characters, telling the person how to do it, which prints on their handout. Never use an id that isn’t in the list.',
      'Follow the clinic’s programming guide in the request for everything it covers: which exercise family fits each finding, one exercise per training quality (never two with the same effect, such as a box jump and a squat jump), how many exercises, the order of the session, the training variables by intent, the weekly structure for the sessions given, the setting, the experience level and the block length. Where the guide is silent, use standard strength and conditioning practice.',
      'Evidence guides come with the clinic guide in the documents at the start of the request, one per topic (training variables, reading the performance tests, designing the block, rehabilitation principles, rehab and performance together, and the condition named). They are drafts the clinic is reviewing. Use them for the condition and stage given: take exercises and doses from the sections and stage-table rows that match that stage, never from a later stage; apply their pain and load rules in the notes and the instructions line; where an evidence guide and the clinic programming guide differ, the clinic guide wins.',
      'If the results or the stage hit a red line in a guide (for example a stage the guide says needs a medical review first), say so in notes and keep the program conservative rather than programming through it. Return-to-sport criteria may be quoted as training targets in why; never as a clearance.',
      'Read the whole report before choosing anything. When a condition is given (with its side and stage, or a rehab report’s injured side and phase), sort the flagged results into three groups: those the condition plausibly explains (same side or region, a quality the condition is known to lower at this stage, as the rehab-and-performance guide’s table says); deficits independent of it (the other side, another region, or a quality the condition doesn’t touch); and strengths worth keeping. A deficit the condition explains is treated inside the rehab section through the stage’s own rows, never chased with a separate performance exercise. An independent deficit gets its own work now, within the stage’s pain and load rules for the affected tissue. Where the side isn’t given, say so in the rationale and treat a one-sided deficit as unresolved rather than guessing.',
      'Decide what leads this block and say so: in the early and middle stages the condition leads and the performance section stays small and away from the injured tissue’s high-strain loads; in the late stage the two merge, with the condition’s energy-storage, running and change-of-direction work doubling as the performance section; ongoing, performance leads with a maintenance dose for the condition. Power output rests on strength: when maximal strength is low, strength leads and ballistic work stays light; when maximal strength is good and power output or reactive strength is low, ballistic and reactive work leads.',
      'One focus per block, not a little of everything. Choose it in this order and name it in the title: a condition or injury that explains the flagged results leads; otherwise the largest deficit in the quality the sport needs most (power output, maximal strength, reactive strength, eccentric hamstring strength, adductor strength, acceleration, capacity), reading results marked Off target (Behind on a rehab report) first, then Close, with maximal strength before power output when maximal strength is low and ballistic or reactive work when maximal strength is good but power output or reactive strength is low; at most one secondary quality; one heavy exercise keeps up a clear strength if there is room. The focus gets the first slot on its days and the most sets. Every other flagged result is deferred to a later block and named in the rationale, not programmed now. Don’t repeat an exercise already in the program. When two library exercises fit equally well, prefer one marked checked by a clinician.',
      'The DSI is never a deficit, a priority or a focus: it has no target and is neither good nor bad. Read with the IMTP and CMJ values, it sets the emphasis and the training variables of the power and strength work: below about 0.60, lean towards ballistic and plyometric work (light loads moved fast with maximal intent, low reps, full rest) with one heavy lift kept; 0.60 to 0.80, keep both; above about 0.80, lean towards heavy maximal strength work (about 85% of 1RM, low reps, long rest) with one ballistic exercise kept. Say in the rationale how the DSI shaped the variables.',
      'Write about the physical quality being trained, never the test score as the aim: power output, not jump height; maximal strength, not the IMTP number; reactive strength, not the RSI; eccentric hamstring strength, not the Nordic number; acceleration, not the 10 m time. Use this wording in the title, the day headings, the why lines and the rationale; the test result is the evidence and the re-test ("to increase lower-body power output (CMJ peak power 42 W/kg, target ≥ 48)", not "to improve jump height").',
      'Lay the program out by training day, as the request’s layout line says: one section per day, 3 to 5 exercises each, heading "Day 1: <what the day is for>" and so on (for example "Day 1: Power output and maximal strength", "Day 2: Rehab: Achilles loading, plus strength", "Day 3: Capacity and control"). Follow the clinic guide’s weekly structure for that number of days: the focus on the freshest days and on at least two days, heavy and high-strain work on the same tissue 48 hours or more apart, the main lifts spread across the week. The same exercise may appear on two days with different loads (a heavier and a lighter day); never two exercises for the same quality on one day. Someone new to training may get the same two or three full-body sessions repeated. Where the first and second halves of the block differ (double to single leg, isometric to loaded, a load step), say so in the exercise’s note ("weeks 1–3 …; from week 4 …") and keep the instructions line consistent with it.',
      'Notes from the clinician in the request ("From the clinician") are instructions for this program: follow them for the focus, the exercises chosen, the equipment, the days and anything to avoid, ahead of the guides’ defaults. Where a note conflicts with a red line, the stage’s pain and load rules or the clinic guide, keep the program safe, say so in notes and follow the rest of the note. Say in the rationale how the notes shaped the program.',
      'rationale: 3 to 6 plain sentences for the clinician (never printed on the handout), starting "Focus: … Secondary: … Deferred: …": what this block is for and why it leads; which findings you treated as the condition (named, with the number and side) and which as separate; which findings were deferred and to which block; what was left out or kept light because of the stage; what the next block adds or swaps and the sign or test result that opens it (a 24-hour pain level, a symmetry, a test number, a time floor); and what to re-test and when.',
      'For each exercise give every variable: sets and reps as plain numbers or ranges ("3", "8–10", or "30 s" for a hold); load as a short guide the person can act on ("Body weight", "Heavy, 2 reps in reserve", "A weight you could lift 8 times"); rest ("2 min", "60 s"); tempo only where it matters ("3 s down", "3-0-3", or empty); side ("Each side", "Left", "Right", or empty). Put the intent cue in note (under 100 characters), for example "Every rep as fast as you can on the way up"; for an exercise of your own the note also says how to do it.',
      'instructions: one line of general instructions for the handout from the plan, for example "3 sessions a week for 6 weeks, at least a day between sessions", or an empty string.',
      'why_this_plan: 2 or 3 short sentences printed on the client’s handout under the title, written to them as “you” (only here; everywhere else they are the athlete or the client): what this block works on, the main finding from their testing behind it in everyday words (at most one number, no test names or abbreviations), and what happens next, such as the retest at the end of the block. Warm and direct, plain Australian English, no names, no diagnosis, no promises about results or returning to sport. For example: “Your testing showed your legs produce less power than we’d like for your sport. This block builds strength first, then speed, three days a week. We’ll retest at the end of the six weeks to see how you’re tracking.”',
      'why: one short line, under 80 characters, naming the quality and the finding behind it, with its number and target, for example "Eccentric hamstring strength: Nordic L/R 12.9%, target ≤ 9" or "Calf capacity: right 22 reps, left 27". Plain Australian English, no jargon.',
      'title: a short title naming the block’s focus as a quality, for example "Block 1: lower-body power output (strength kept)" or "Achilles loading, weeks 1–6", or an empty string.',
      'notes: anything the clinician should know, one sentence each: why an exercise of your own was chosen over the library, or a finding that needs their judgement. Leave notes empty when there is nothing to say.',
      'Use only the information given. Don’t diagnose, predict injury or give medical advice, and never say anything about being cleared to return to sport. Refer to the person as the athlete or the client, never by a name.',
      'Think the problem through before you answer.'
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
    if (lt === 'ham' || lt === 'acl') { var ph = clean1(state[lt].phase); return ph ? 'Rehab phase (set by the clinician on the report): ' + ph + '.' : ''; }
    if (lt === 'ankle') {                              // v42: no phase: the weeks since the injury and the Ankle-GO total stand in for the stage
      var wk = sinceText('ankle'), ag = computeAnkle().ago;
      return joinBits([wk ? 'Weeks since the sprain (from the report): ' + wk : '', ag.tested ? 'Ankle-GO ' + ag.total + ' of ' + ag.max + (ag.complete ? '' : ' so far') + (ag.band ? ' (' + ag.band.label.toLowerCase() + ': ' + ag.band.short + ')' : '') : '']).replace(/ · /, '; ') + (wk || ag.tested ? '.' : '');
    }
    var s = plan && plan.stage, g = DATA.guideIndex, help = g && g.stage_help && typeof g.stage_help[s] === 'string' ? clean1(g.stage_help[s]) : '';
    return s ? 'Stage (set by the clinician): ' + s.toLowerCase() + (help ? ' (' + help + ')' : '') + '.' : '';
  }
  // v26: the program is laid out by training day: as many days as the plan's sessions a week (2–4), 3–5 exercises a day
  function planDays(plan) { var n = parseInt(plan && plan.sessions, 10); return n >= 2 && n <= 4 ? n : 3; }
  function perDay(cfg) { var n = cfg && parseInt(cfg.max_per_day, 10); return n >= 2 && n <= 8 ? n : 5; }
  function layoutLine(plan) {
    var d = planDays(plan), names = [];
    for (var i = 1; i <= d; i++) names.push('Day ' + i);
    return 'Layout: ' + d + ' training days a week, so write the program out by day (' + names.join(', ') + '), each a short session of 3 to 5 exercises with its own emphasis; the same exercise may appear on more than one day with different loads.';
  }
  function sideFor(lt, plan) {                         // v25: the condition's side for the request: the report's injured side, or the plan's ('' when not chosen)
    var s = lt === 'ham' || lt === 'acl' || lt === 'ankle' ? clean1(state[lt].meta.injured) : (plan && plan.side) || '';   // v42: + Ankle-GO
    return !s ? '' : (s === 'Both' ? 'both sides' : s.toLowerCase() + ' side');
  }
  function guideBundle(lt, plan, cfg) {                // { ids, titles, shorts, parts, chars } of the evidence guides for this request
    var g = DATA.guideIndex, ids = [], out = { ids: [], titles: [], shorts: [], parts: [], chars: 0 };
    if (!g) return out;
    var cond = conditionFor(lt, plan), always = [].concat(Array.isArray(g.always) ? g.always : []);
    always.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    if (cond) [].concat(Array.isArray(g.rehab) ? g.rehab : [], cond.guides).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    var cap = guideCap(cfg), left = cfg && cfg.guides_max_chars ? cfg.guides_max_chars : 140000;   // v25: 140000 (five guides with a condition)
    ids.forEach(function (id) {
      var body = bodyOf(DATA.guides[id], cap), meta = g.guides && g.guides[id];
      if (!body || left <= 0) return;
      body = body.slice(0, left); left -= body.length;
      var title = clean1(meta && meta.title) || id;
      out.ids.push(id); out.titles.push(title); out.shorts.push(clean1(meta && meta.short) || id);
      out.parts.push({ id: id, title: title, body: body, general: always.indexOf(id) >= 0 });   // v29: general = the same on every request (cached together)
      out.chars += body.length;
    });
    return out;
  }
  function guidesMissing(lt, plan) {                   // ids the index names for this request that didn't load
    var g = DATA.guideIndex; if (!g) return [];
    var cond = conditionFor(lt, plan), ids = [].concat(Array.isArray(g.always) ? g.always : [], cond ? [].concat(Array.isArray(g.rehab) ? g.rehab : [], cond.guides) : []);
    return ids.filter(function (id, i) { return ids.indexOf(id) === i && !DATA.guides[id]; });
  }
  // v29: the request in three parts, the long reference material first (Anthropic's advice for long documents: documents at
  // the top, the question at the end) and in the same order every time, so Claude can cache it: [0] the clinic guide, the
  // general evidence guides and the library (the same for every report), [1] the condition's guides (the same for every
  // report with that condition; absent without one), [2] this report, the plan, the notes and the instruction
  function exSuggestParts(lt, c, max, cfg) {
    var plan = tidyPlan(state.ex.plan), n = 0, ev = guideBundle(lt, plan, cfg), g = guideText(cfg);
    function doc(source, body) { n++; return '<document index="' + n + '">\n<source>' + source + '</source>\n<document_content>\n' + body + '\n</document_content>\n</document>'; }
    var shared = [], cond = [];
    if (g) shared.push(doc('Clinic programming guide (follow it; it takes precedence over general knowledge)', g));
    ev.parts.filter(function (p) { return p.general; }).forEach(function (p) { shared.push(doc('Evidence guide: ' + p.title, p.body)); });
    shared.push(doc('Library (id | name | body areas | type | equipment | checked by a clinician)', libList().slice(0, 300).map(libLine).join('\n')));
    ev.parts.filter(function (p) { return !p.general; }).forEach(function (p) { cond.push(doc('Evidence guide: ' + p.title, p.body)); });
    var head = 'Reference documents for exercise programs at BASE Health Noosa: the clinic’s programming guide, evidence guides (drafts the clinic is reviewing; where they and the clinic programming guide differ, the clinic guide wins) and the clinic’s exercise library.';
    return [head + '\n\n<documents>\n' + shared.join('\n') + '\n</documents>',
      cond.length ? 'Evidence guides for the condition in this request (use them for the condition and stage given):\n\n<documents>\n' + cond.join('\n') + '\n</documents>' : '',
      exSuggestTail(lt, c, max, cfg, plan)];
  }
  function exSuggestRequest(lt, c, max, cfg) { return exSuggestParts(lt, c, max, cfg).filter(Boolean).join('\n\n'); }   // the whole text (estimates, tests)
  function exSuggestTail(lt, c, max, cfg, plan) {
    var L = ['The report and the program to fill:', '', '<report>', addProfLine(interpPayload(lt, c)), '</report>'];   // v49: + the clinician's profession
    L.push('', 'The program: ' + planLines(plan), layoutLine(plan));   // v23; v26: the layout by day
    var cond = conditionFor(lt, plan), stage = stageFor(lt, plan), side = sideFor(lt, plan);   // v24; v25: the side
    if (cond) L.push('Condition (set by the clinician): ' + cond.label + (cond.detail ? ' (' + cond.detail + ')' : '') + ', ' + (side || 'side not given') + '.' + (stage ? ' ' + stage : ''));
    var it = state[lt].interp, who = person(lt);
    if (!blank(it.text)) L.push('', 'The clinician’s interpretation of these results (their emphasis): ' + withoutName(clean1(it.text), state[lt].meta.name, who));
    if (!blank(plan.brief)) L.push('', 'From the clinician (their instructions for this program; follow them): ' + withoutName(clean1(plan.brief), state[lt].meta.name, who));   // v27
    var have = state.ex.items.filter(function (r) { return r.kind === 'ex' && !blank(r.name); }).map(function (r) { return clean1(r.name); });
    if (have.length) L.push('', 'Already in the program (don’t repeat these): ' + have.join('; '));
    L.push('', 'Now suggest the exercise program for this report, choosing from the clinic’s library in the documents above (at most ' + max + ' exercises a day), following the clinic’s programming guide for selection, order and the training variables, and the evidence guides for the condition and stage given.');
    return L.join('\n');
  }
  // v24: what a suggestion will cost, from the text about to be sent (about 4 characters a token) at the rates in
  // interpretation.json › exercise_suggest › cost (cents per 1,000 input tokens, and cents for the answer)
  function cacheTtl(cfg) { var t = cfg && cfg.cache; return t === '5m' || t === 'off' ? t : '1h'; }   // v29: interpretation.json › exercise_suggest › cache
  function costRates(cfg) {                            // v28–v29: US cents for the model, from interpretation.json › exercise_suggest › cost
    var cost = cfg && cfg.cost && typeof cfg.cost === 'object' ? cfg.cost : {};
    function n(k, d) { return isFinite(cost[k]) && cost[k] !== null && cost[k] !== '' ? +cost[k] : d; }
    return { input: n('per_1k_input_cents', 0.2), output: n('per_1k_output_cents', 1.0), answer: n('output_cents', 10),
      read: n('cache_read_x', 0.1), write1h: n('cache_write_1h_x', 2), write5m: n('cache_write_5m_x', 1.25), chars: Math.max(1, n('chars_per_token', 3)) };
  }
  // the estimate for a suggestion that writes the cache (the first in the hour): the shared part at the write price, the rest
  // at the input price, plus a typical answer; about 3 characters to a token (Sonnet 5.5's tokenizer: about 30% more tokens than the earlier models' 4)
  function suggestCents(cfg, sharedChars, restChars) {
    var r = costRates(cfg), ttl = cacheTtl(cfg), wx = ttl === 'off' ? 1 : (ttl === '5m' ? r.write5m : r.write1h);
    return Math.max(1, Math.round(sharedChars / r.chars / 1000 * r.input * wx + (restChars || 0) / r.chars / 1000 * r.input + r.answer));
  }
  // v28: what a suggestion did cost, from the answer's usage counts at the same rates (cents per 1,000 input and output tokens)
  // v29: with caching, input is three counts: input_tokens (after the last cache point), cache_creation_input_tokens (written,
  // split by lifetime in cache_creation) and cache_read_input_tokens (reused, at a tenth)
  function usageCents(cfg, usage) {
    if (!usage || typeof usage !== 'object' || !isFinite(usage.input_tokens) || !isFinite(usage.output_tokens)) return 0;
    var r = costRates(cfg), num = function (v) { return isFinite(v) && v !== null ? +v : 0; };
    var cc = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : null;
    var w1 = cc ? num(cc.ephemeral_1h_input_tokens) : 0, w5 = cc ? num(cc.ephemeral_5m_input_tokens) : 0, wAll = num(usage.cache_creation_input_tokens);
    if (!cc && wAll) { if (cacheTtl(cfg) === '5m') w5 = wAll; else w1 = wAll; }
    var input = num(usage.input_tokens) + num(usage.cache_read_input_tokens) * r.read + w1 * r.write1h + w5 * r.write5m;
    return Math.max(1, Math.round(input / 1000 * r.input + num(usage.output_tokens) / 1000 * r.output));
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
        rationale: str,                                // v25: how the program fits together, for the physiotherapist
        why_this_plan: str,                            // v32: a short note for the client, printed on the handout
        notes: { type: 'array', items: str }
      },
      required: ['title', 'instructions', 'sections', 'rationale', 'why_this_plan', 'notes'],
      additionalProperties: false
    };
  }
  // v23: Suggest from the report asks about the person and the setting first (a small dialog; the choices are kept with the
  // program), then sends the request
  function startExSuggest() {
    if (suggestBusy || anyScanBusy()) return;          // v41: not while photos are being read (the report's or the program's)
    var lt = suggestTool();
    function fail(msg) { scanInfo.ex = { tool: 'ex', kind: 'error', ai: true, text: msg }; renderScanBar(); }
    if (!lt) return;
    var cfg = exSuggestCfg(), c = computeFor(lt), why = blocker(c, lt);
    if (why) return fail(toolName(lt) + ' report: ' + why.charAt(0).toLowerCase() + why.slice(1) + ' Then suggest again.');
    if (!DATA.ai || !cfg.model) return fail('The AI settings file (interpretation.json) didn’t load. Reopen the app while online.');
    if (!aiKey()) { openAiSettings(function () { if (state.tool === 'ex') startExSuggest(); }, 'To suggest exercises from a report, the app needs a Claude API key. ' + ONCE_NOTE()); return; }
    if (navigator.onLine === false) return fail('No internet connection. Connect to suggest exercises, or add them from the library.');
    var gen = scanGenOf('ex');
    guidesReady.then(function () {                     // v24: the guide library is usually long loaded; if not, the dialog waits for it
      if (gen !== scanGenOf('ex') || state.tool !== 'ex' || suggestBusy || anyScanBusy() || suggestTool() !== lt) return;
      renderPlanDialog(lt);
      openModal(els.suggestDialog, els.suggestGo);
    });
  }
  // v24: the lead says what goes and what it costs; the condition row (a menu on a Performance screen or LL Strength
  // report; the report's own condition and phase on a rehab report) and the stage row (while a condition is chosen)
  function suggestLeadText(lt) {
    var plan = tidyPlan(state.ex.plan), cfg = exSuggestCfg(), cond = conditionFor(lt, plan), ev = guideBundle(lt, plan, cfg);
    var what = 'Claude gets the ' + toolName(lt) + ' results (no name or date), your interpretation' + (blank(plan.brief) ? '' : ', your notes') + ', the exercises already here, the library, the clinic’s programming guide' +
      (DATA.guide ? '' : ' (not loaded: reopen the app online to fetch it)');
    if (ev.ids.length) what += ' and the evidence guide' + (ev.ids.length > 1 ? 's' : '') + ' (' + ev.shorts.join(', ') + ')';
    var missing = guidesMissing(lt, plan);
    if (missing.length) what += ' (' + missing.join(', ') + ' not loaded: reopen the app online to fetch ' + (missing.length > 1 ? 'them' : 'it') + ')';
    else if (!DATA.guideIndex) what += ' (evidence guides not loaded: reopen the app online to fetch them)';
    var shared = 40000, rest = 0, ttl = cacheTtl(cfg);
    try { var c = computeFor(lt), P = exSuggestParts(lt, c, perDay(cfg), cfg); shared = [].concat(cfg.system || []).join('\n').length + P[0].length + P[1].length; rest = P[2].length; } catch (e) { /* the default */ }
    return what + '. About ' + suggestCents(cfg, shared, rest) + ' cents' + (ttl === 'off' ? '' : ', less if you suggest again within ' + (ttl === '5m' ? 'five minutes' : 'the hour')) + '.';   // v29: the cache
  }
  function renderPlanDialog(lt) {
    var plan = state.ex.plan = tidyPlan(state.ex.plan);
    els.suggestLead.textContent = suggestLeadText(lt);
    var rows = Object.keys(PLAN).map(function (k) {
      return '<div class="f"><span id="plan-' + k + '-l">' + esc(PLAN_LABEL[k]) + '</span><div class="seg" role="group" aria-labelledby="plan-' + k + '-l">' +
        PLAN[k].map(function (o) { return '<button type="button" data-plan="' + k + '" data-value="' + esc(o) + '" aria-pressed="' + (plan[k] === o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>';
    });
    var cond = conditionFor(lt, plan), conds = conditionList();
    if (cond && cond.fixed) {                           // a rehab report: its condition, side and phase, shown, not chosen
      var ph = clean1(state[lt].phase), inj = clean1(state[lt].meta.injured);   // v25: the injured side too
      var agw = lt === 'ankle' ? sinceText('ankle') : '';   // v42: Ankle-GO has no phase: the weeks since the sprain
      if (agw) ph = agw + (agw === '1' ? ' week' : ' weeks') + ' since the sprain';
      rows.push('<div class="f cond"><span>Condition' + (inj ? ', side' : '') + (lt === 'ankle' ? (agw ? ' and time since injury' : '') : ' and phase') + ', from this report</span><p class="plan-fixed" id="planFixed">' + esc(cond.label) + (inj ? ' · ' + esc(inj) : '') + (ph ? ' · ' + esc(ph) : '') + '</p></div>');
    } else if (conds.length) {
      rows.push('<div class="f cond"><label for="planCondition">Condition (optional: adds its evidence guide)</label><select id="planCondition" data-plan-select="condition">' +
        conds.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === plan.condition ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></div>');
      if (cond) {
        var st = stageList(), sd = sideList();
        rows.push('<div class="f"><span id="plan-stage-l">Stage (early, middle, late, or ongoing maintenance)</span><div class="seg stage" role="group" aria-labelledby="plan-stage-l">' +
          st.map(function (o) { return '<button type="button" data-plan="stage" data-value="' + esc(o) + '" aria-pressed="' + (plan.stage === o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>');
        // v25: the side, so Claude can tell which findings the condition explains (a result on that side) and which are separate
        rows.push('<div class="f"><span id="plan-side-l">Side (which findings the condition can explain)</span><div class="seg side" role="group" aria-labelledby="plan-side-l">' +
          sd.map(function (o) { return '<button type="button" data-plan="side" data-value="' + esc(o) + '" aria-pressed="' + (plan.side === o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>');
      }
    }
    // v27: the physiotherapist's notes for Claude (Matthew: "a section where we can add notes or give instructions to help with a better response")
    rows.push('<div class="f brief"><label for="planBrief">Notes for Claude (optional)</label><textarea id="planBrief" data-plan-text="brief" rows="3" maxlength="' + EX_LEN.brief + '" autocapitalize="sentences" aria-describedby="planBriefHint" placeholder="The sport and position, the equipment, anything to avoid, what you want this block to do. No names or dates.">' + esc(plan.brief) + '</textarea><small id="planBriefHint">Sent to Claude with the results, kept with this program, never printed.</small></div>');
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
  function onPlanInput(e) {                            // v27: the notes for Claude, kept with the plan as typed
    var t = e.target.closest('textarea[data-plan-text]');
    if (!t) return;
    state.ex.plan[t.dataset.planText] = t.value.slice(0, EX_LEN.brief);
    saveDraft();
  }
  function onPlanChange(e) {                           // v24: the condition menu; v27: the notes (on leaving the box, the lead says they go and recounts the cost)
    var lt = els.suggestPlan.dataset.tool;
    var t = e.target.closest('textarea[data-plan-text]');
    if (t) {                                         // leaving the box: the notes tidied (trimmed, capped), the lead says they go and recounts the cost
      var tidy = state.ex.plan = tidyPlan(state.ex.plan);
      if (t.value !== tidy.brief) t.value = tidy.brief;
      saveDraft();
      if (lt) els.suggestLead.textContent = suggestLeadText(lt);
      return;
    }
    var s = e.target.closest('select[data-plan-select]');
    if (!s) return;
    var plan = state.ex.plan;
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
    if (suggestBusy || anyScanBusy()) return;
    var lt = suggestTool(), x = state.ex;
    if (!lt || !aiKey()) return;
    var cfg = exSuggestCfg(), c = computeFor(lt);
    if (blocker(c, lt)) return;
    var gen = scanGenOf('ex'), max = perDay(cfg);   // v26: per day
    suggestBusy = true;
    scanInfo.ex = { tool: 'ex', kind: 'busy', ai: true, text: 'Choosing exercises from the ' + toolName(lt) + ' report… this can take two or three minutes.' };
    renderScanBar();
    var ttl = cacheTtl(cfg), mark = ttl === 'off' ? null : (ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' });
    var blocks = exSuggestParts(lt, c, max, cfg).map(function (t, i) {   // v29: the documents (cached), then this report
      if (!t) return null;
      var b = { type: 'text', text: t };
      if (mark && i < 2) b.cache_control = mark;
      return b;
    }).filter(Boolean);
    var body = {
      model: cfg.model, max_tokens: cfg.max_tokens || 32000, system: [].concat(cfg.system || []).join('\n'),
      messages: [{ role: 'user', content: blocks }],
      output_config: { format: { type: 'json_schema', schema: exSuggestSchema() } }
    };
    if (cfg.effort) body.output_config.effort = cfg.effort;
    focusQuiet($('exSuggest'));
    claudeRequest(aiKey(), body, cfg.endpoint, cfg.timeout_s || 480, 'suggest exercises').then(function (j) {
      if (gen !== scanGenOf('ex') || state.ex !== x) return;
      if (j.stop_reason === 'max_tokens') throw new Error('Claude’s answer was cut short. Try again.');
      if (j.stop_reason === 'refusal') throw new Error('Claude didn’t suggest exercises for these results. Add them from the library instead.');
      var out;
      try { out = JSON.parse(replyText(j)); } catch (e) { throw new Error('Claude’s answer couldn’t be read. Try again.'); }
      applyExSuggest(out, lt, max);
      var si = scanInfo.ex; if (si && si.ai) { si.cents = usageCents(cfg, j.usage); si.reused = !!(j.usage && +j.usage.cache_read_input_tokens > 0); }   // v28: the bar says what it cost; v29: and whether the guides came from the cache
    }).catch(function (err) {
      if (gen !== scanGenOf('ex') || state.ex !== x) return;
      scanInfo.ex = { tool: 'ex', kind: 'error', ai: true, text: err && err.message ? err.message : 'Something went wrong suggesting exercises. Try again.' };
    }).then(function () {
      if (gen !== scanGenOf('ex')) return;
      suggestBusy = false;
      if (state.tool === 'ex' && state.exPage === 'builder') {
        if (scanInfo.ex && scanInfo.ex.undo) { renderExTable(); foldNow('ex', false); }
        renderScanBar();
        var bar = $('scanBar');
        if (bar && !bar.hidden && bar.scrollIntoView) {
          var r = bar.getBoundingClientRect(), top = appbarH + (state.ex.cardOpen === false ? 48 : 0);
          if (r.top < top || r.bottom > window.innerHeight) bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } else if (scanInfo.ex && scanInfo.ex.undo) { foldBeforeRender('ex'); saveDraft(); }   // suggested while on another page: folded there for when it's opened
    });
  }
  // the suggested rows into the program: library rows linked, Claude's own unlinked (v22), all marked to check; after the
  // rows already there. An id not in the library with no name is dropped; Undo puts back exactly what was there. v26: the
  // program comes by training day, so an exercise may appear in more than one section (a heavier and a lighter day) but
  // only once within a section and never when it is already in the program; max is the cap per section (day), and the
  // whole suggestion is capped at max × the plan's days
  function applyExSuggest(out, lt, max) {
    var x = state.ex, found = [], n = 0, own = 0, seen = {}, dropped = 0, lib = libList(), total = max * planDays(tidyPlan(x.plan));
    x.items.forEach(function (r) { if (r.kind !== 'ex') return; if (r.lib) seen[r.lib] = true; var k = E.libKey(r.name); if (k) seen['~' + k] = true; });
    (out && Array.isArray(out.sections) ? out.sections : []).forEach(function (sec) {
      if (!sec || typeof sec !== 'object') return;
      var rows = [], here = {};
      (Array.isArray(sec.exercises) ? sec.exercises : []).forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        var id = String(e.id || '').trim(), name = exTidy(e.name, 'name'), entry = libGet(id);
        if (entry && entry.deleted) entry = null;
        if (!entry && name) entry = E.libMatch(name, lib);        // Claude's own name that is a library exercise after all
        if (!entry && !name) { if (id) dropped++; return; }
        var key = entry ? entry.id : '~' + E.libKey(name), key2 = entry ? '~' + E.libKey(entry.name) : key;
        if (seen[key] || seen[key2] || here[key] || here[key2] || rows.length >= max || n >= total) return;
        here[key] = here[key2] = true; n++;
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
    if (!n) { scanInfo.ex = { tool: 'ex', kind: 'empty', ai: true, from: lt, unclear: notes, undo: null }; return; }
    var before = exSnap(), added = x.items.some(function (r) { return r.kind === 'ex' && !blank(r.name); });
    found.forEach(function (f) {
      var it = f.heading ? newExSection(f.heading) : newExRow(f.row);
      if (!f.heading) it.why = f.row.why;
      x.scanned[it.id] = true;
      x.items.push(it);
    });
    var title = exTidy(out.title, 'title'), instr = exTidy(out.instructions, 'instructions'), rat = exTidy(out.rationale, 'rationale');
    if (title && blank(x.title)) { x.title = title; x.scanned.title = true; }
    if (instr && blank(x.instructions)) { x.instructions = instr; x.scanned.instructions = true; }   // v23: e.g. "3 sessions a week for 6 weeks"
    if (rat) { x.rationale = rat; x.scanned.rationale = true; }   // v25: the new reasoning replaces the old (Undo brings it back)
    // v32: Why this plan, for the client: filled when empty or still Claude's own unedited draft (a note the physio wrote stays);
    // the block length from the plan when none is given, and with it the next review
    var why = exTidy(out.why_this_plan, 'reason');
    if (why && (blank(x.reason) || x.scanned.reason)) { x.reason = why; x.scanned.reason = true; }
    if (blank(x.weeks)) { x.weeks = exWeeks(tidyPlan(x.plan).weeks); autoReview(); }
    scanInfo.ex = { tool: 'ex', kind: 'done', ai: true, from: lt, n: n, own: own, added: added, unclear: notes, undo: before };
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
    return (coll === 'library' ? localLib : coll === 'batteries' ? localBat : localTpl).items;   // v36: + batteries
  }
  // a full write of one entry or template, or (obj null) its tombstone; false when this device couldn't store it
  function writeItem(coll, id, obj) {
    var ok = true;
    if (storeOn()) {
      if (obj) CLOUD.putDoc(coll, id, obj); else CLOUD.deleteDoc(coll, id);
      CLOUD.sync();
    } else {
      var box = coll === 'library' ? localLib : coll === 'batteries' ? localBat : localTpl;   // v36: + batteries
      box.items[id] = obj || { id: id, deleted: true };
      try { localStorage.setItem(coll === 'library' ? LIB_STORE : coll === 'batteries' ? BAT_STORE : TPL_STORE, JSON.stringify(box)); } catch (e) { ok = false; }
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
      photo: fromFile ? null : tidyMedia(o.photo, false), clip: fromFile ? null : tidyMedia(o.clip, true),   // v34: uploaded photo and video
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
  function hasVideo(e) { return !!(e && ((e.video && E.videoInfo(e.video)) || e.clip)); }   // v34: an uploaded video counts
  function doseLine(d) {                               // '3 × 8–12 · Each side · 90 s rest' (only the parts set)
    d = d || {};
    var sets = clean1(d.sets), reps = clean1(d.reps);
    var sr = sets && reps ? sets + ' × ' + reps : sets ? sets + (/^\d+$/.test(sets) ? (sets === '1' ? ' set' : ' sets') : '') : reps;
    return [sr, clean1(d.load), clean1(d.side), blank(d.rest) ? '' : clean1(d.rest) + ' rest', blank(d.tempo) ? '' : 'tempo ' + clean1(d.tempo)].filter(Boolean).join(' · ');
  }
  function libCounts(list) {
    var c = { n: list.length, video: 0, drafts: 0, photo: 0 };
    list.forEach(function (e) { if (hasVideo(e)) c.video++; if (!e.checked) c.drafts++; if (e.photo) c.photo++; });   // v34: photos
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
      : c.n + (c.n === 1 ? ' exercise' : ' exercises') + (c.photo ? ' · ' + c.photo + ' with a photo' : '') + (c.video ? ' · ' + c.video + ' with video' : '') + (c.drafts ? ' · ' + c.drafts + (c.drafts === 1 ? ' draft' : ' drafts') + ' to check' : '');
    if (!all.length) box.innerHTML = '<div class="lib-empty"><p>The library is empty. Add your first exercise.</p></div>';
    else if (!shown.length) {
      box.innerHTML = '<div class="lib-empty"><p>' + (q.length >= 2 ? 'No exercises match “' + esc(q) + '”.' : 'No exercises match these filters.') + '</p>' +
        '<button type="button" class="ghost" data-action="lib-clear">Clear filters</button></div>';
    } else box.innerHTML = shown.map(libRowHtml).join('');
    renderLibSummary(c);
  }
  function libRowHtml(e) {
    var meta = e.areas.concat(e.type ? [e.type] : []).join(' · '), dose = doseLine(e.dose), pic = thumbOf(e);
    return '<button type="button" class="lib-row" data-action="lib-open" data-lib="' + esc(e.id) + '" aria-haspopup="dialog">' +
      (pic ? '<span class="lr-pic"><img src="' + esc(pic) + '" alt="" loading="lazy"></span>' : '') +   // v34: its photo (or a frame of its video)
      '<span class="lr-main"><b class="lr-name">' + esc(e.name) + '</b>' +
      (meta ? '<span class="lr-meta">' + esc(meta) + '</span>' : '') + (dose ? '<span class="lr-dose">' + esc(dose) + '</span>' : '') + '</span>' +
      '<span class="lr-badges">' + (hasVideo(e) ? '<span class="badge vid">' + PLAY + 'Video</span>' : '') + (e.checked ? '' : '<span class="badge draft">Draft</span>') + '</span></button>';
  }
  function renderLibSummary(c) {
    if (state.tool !== 'ex' || state.exPage !== 'library') return;
    c = c || libCounts(libList());
    els.summary.innerHTML = '<div class="sum lib-sum"><div class="sum-scroll"><h2>Exercise library</h2>' +
      '<div class="tally ex-tally lib-tally"><div><b>' + c.n + '</b><span>' + (c.n === 1 ? 'Exercise' : 'Exercises') + '</span></div>' +
      '<div><b>' + c.video + '</b><span>With video</span></div><div><b>' + c.drafts + '</b><span>Drafts to check</span></div></div>' +
      '<p class="fine lib-how">Exercises you add here can be added to any program with + From library. Cues print under the exercise on the handout, its photo beside it; a video prints as a QR code.</p>' +
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
    if (libEdit) { libEdit.media = freshEditMedia(e); renderLibMedia(); }   // v34: the photo and video
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
    libEdit = { id: entry ? entry.id : '', mid: entry ? entry.id : newId('c-'), row: opts.row || '', armed: false, dirty: false, media: null };   // v34: mid = the id the files go under
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
    if (libEdit && !libEdit.away) { libMediaEnd(false); libEdit = null; }   // v34: closed without saving: unsaved uploads go
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
    if (libMediaBusy()) { libEdit.media.msg = 'Wait for the upload to finish (or Stop it), then Save.'; renderLibMedia(); return; }   // v34
    var v = readLibForm();
    if (!v.name) { libErr('Add a name.'); $('libName').focus(); return; }
    var k = E.libKey(v.name), id = libEdit.id;
    if (libList().some(function (e) { return e.id !== id && E.libKey(e.name) === k; })) { libErr('Another exercise is already called that.'); $('libName').focus(); return; }
    if (!libVideoState()) { $('libVideo').focus(); return; }
    var md = libEdit.media || {};
    var entry = tidyEntry({ id: id || libEdit.mid || newId('c-'), name: v.name, aliases: v.aliases, areas: v.areas, type: v.type, equipment: v.equipment, dose: v.dose, cues: v.cues,
      instructions: v.instructions, video: v.video, checked: v.checked, photo: md.photo || null, clip: md.clip || null,   // v34
      updatedBy: CLOUD ? userName() : '', updatedAt: new Date().toISOString() }, false);
    if (!entry) return;
    var ok = writeItem('library', entry.id, entry), row = libEdit.row ? exItem(libEdit.row) : null;
    if (row) { row.lib = entry.id; delete row.libWas; saveDraft(); }   // Save to library: that row is linked to the new exercise
    libMediaEnd(true);                                 // v34: the files it no longer uses go (unless another exercise uses them)
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
    libMediaEnd(false);                                // v34: uploads not saved go; the saved files stay (Undo puts the exercise back)
    libEdit = null;
    if (!e) { closeModal(); return; }
    writeItem('library', e.id, null);
    afterLibChange();
    closeModal();
    toast('Deleted ' + e.name, { label: 'Undo', run: function () { writeItem('library', e.id, e); afterLibChange(); } });
  }
  function libDuplicate() {                            // "<name> (copy)", as a new exercise not saved yet
    if (!libEdit || !libEdit.id) return;
    var v = readLibForm(), md = libEdit.media || {};
    if (libMediaBusy()) { md.msg = 'Wait for the upload to finish, then Duplicate.'; renderLibMedia(); return; }   // v34
    if (md.added && md.added.length) { md.added = []; }   // uploaded this edit and now shared by the copy: kept
    v.name = cap((v.name || 'Exercise') + ' (copy)', 120);
    v.photo = md.photo || null; v.clip = md.clip || null;   // v34: the copy shares the photo and video
    libEdit = { id: '', mid: newId('c-'), row: '', armed: false, dirty: true, media: null };
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
    if (libEdit) libEdit.away = true;                 // v34: the player replaces the editor for a moment
    openVideo(cap($('libName').value, 120) || 'Exercise', url, function () {
      if (libEdit) libEdit.away = false;
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
          (thumbOf(e) ? '<span class="lp-pic"><img src="' + esc(thumbOf(e)) + '" alt="" loading="lazy"></span>' : '') +   // v34
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

  // ------------------------------------------------------------------ v34: photos and videos in the library
  // Matthew (4 Oct): "add a feature where we can add Videos or Pictures to the Exercise Library". His choice, "Upload both":
  // the files go to Cloud Storage for Firebase in Sydney (cloud.js › media) with the clinic login. A library exercise may
  // have one photo and one video, besides its video link: photo { url, path, turl, tpath, w, h } and clip { url, path,
  // turl, tpath, w, h, secs, bytes, type }, where turl is a 4:3 picture (480 × 360) for the lists and the handout: the
  // middle of the photo, or a frame of the video. Photos are shrunk on the iPad (long edge 1,600 px, JPEG); a video goes
  // up as recorded (60 s and 150 MB at most). A file never changes (a new one gets a new name); one an exercise no longer
  // uses is deleted when the exercise is saved (unless another exercise still uses it: Duplicate shares them), and one
  // uploaded while editing is deleted if the editor is closed without saving. Deleting an exercise keeps its files (Undo).
  var MEDIA_HOST = 'https://firebasestorage.googleapis.com/v0/b/';
  var MEDIA_PATH = /^library\/[A-Za-z0-9][A-Za-z0-9_-]{0,149}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  var PHOTO_EDGE = 1600, THUMB_W = 480, THUMB_H = 360, CLIP_MAX_SECS = 60, CLIP_MAX_BYTES = 150 * 1024 * 1024;
  var MEDIA_CACHE = 'bh-media-v1';                     // the 4:3 pictures kept on this device (offline handouts)
  function mediaUrlOk(u) { return typeof u === 'string' && u.indexOf(MEDIA_HOST) === 0 && u.length <= 700 && !/[\s"'<>\\]/.test(u); }
  function tidyMedia(m, clip) {
    if (!m || typeof m !== 'object' || Array.isArray(m) || !mediaUrlOk(m.url) || typeof m.path !== 'string' || !MEDIA_PATH.test(m.path)) return null;
    function num(v, max) { v = +v; return isFinite(v) && v > 0 && v <= max ? Math.round(v * 10) / 10 : 0; }
    var o = { url: m.url, path: m.path, w: num(m.w, 20000), h: num(m.h, 20000) };
    if (mediaUrlOk(m.turl) && typeof m.tpath === 'string' && MEDIA_PATH.test(m.tpath)) { o.turl = m.turl; o.tpath = m.tpath; }
    if (clip) {
      o.secs = num(m.secs, 3600); o.bytes = Math.round(num(m.bytes, 1e10));
      o.type = typeof m.type === 'string' && /^video\/[a-z0-9.+-]{1,40}$/i.test(m.type) ? m.type : 'video/mp4';
    }
    return o;
  }
  function thumbOf(e) { return e ? (e.photo && e.photo.turl) || (e.clip && e.clip.turl) || '' : ''; }
  function mediaReady() { return !!(CLOUD && CLOUD.media && CLOUD.media.ready()); }
  function mediaPaths(m) { return m ? [m.path, m.tpath].filter(Boolean) : []; }
  function mediaInUse(path) {                           // still used by a saved exercise (Duplicate shares files)
    return libList().some(function (e) { return mediaPaths(e.photo).concat(mediaPaths(e.clip)).indexOf(path) >= 0; });
  }
  function dropMedia(paths) {
    if (!CLOUD || !CLOUD.media) return;
    paths.forEach(function (p) { if (p && !mediaInUse(p)) CLOUD.media.remove(p); });
  }
  function clipLen(secs) { var s = Math.round(+secs || 0); return s ? Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2) : ''; }
  function sizeText(bytes) { var mb = (+bytes || 0) / 1048576; return mb >= 10 ? Math.round(mb) + ' MB' : mb >= 0.1 ? (Math.round(mb * 10) / 10) + ' MB' : ''; }
  function fileStamp() {
    var r = '';
    try { var a = new Uint32Array(1); crypto.getRandomValues(a); r = a[0].toString(36); } catch (e) { r = Math.random().toString(36).slice(2); }
    return Date.now().toString(36) + (r + '000').slice(0, 3);
  }
  // a picture of part of an image or video (sx, sy, sw, sh) at w × h, as a JPEG
  function canvasJpeg(src, sx, sy, sw, sh, w, h, q) {
    return new Promise(function (resolve, reject) {
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
      cv.toBlob(function (b) { cv.width = cv.height = 1; if (b && b.size) resolve(b); else reject(new Error('no picture')); }, 'image/jpeg', q);
    });
  }
  function middle43(w, h) {                            // the largest 4:3 area in the middle of a w × h picture
    var tw = w, th = Math.round(w * 3 / 4);
    if (th > h) { th = h; tw = Math.round(h * 4 / 3); }
    return [Math.round((w - tw) / 2), Math.round((h - th) / 2), tw, th];
  }
  // a photo, shrunk: the picture (long edge 1,600 px at most) and its 4:3 middle at 480 × 360, both JPEG
  function makePhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, PHOTO_EDGE / Math.max(w, h)), c = middle43(w, h);
        var fw = Math.max(1, Math.round(w * sc)), fh = Math.max(1, Math.round(h * sc));
        Promise.all([canvasJpeg(img, 0, 0, w, h, fw, fh, 0.85), canvasJpeg(img, c[0], c[1], c[2], c[3], THUMB_W, THUMB_H, 0.8)]).then(function (b) {
          URL.revokeObjectURL(url);
          resolve({ full: b[0], thumb: b[1], w: fw, h: fh });
        }, function () { URL.revokeObjectURL(url); reject(new Error('Couldn’t prepare that photo. Try another one.')); });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Couldn’t open that photo. Try a photo from the camera or Photos.')); };
      img.src = url;
    });
  }
  // a video's length and size, and a 4:3 frame of it (half a second in, or the middle of a shorter clip) for its picture.
  // Played muted for a moment first (iPad Safari draws no frame of a video that hasn't played); a clip whose frame can't
  // be drawn goes up without a picture
  function readClip(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), v = document.createElement('video'), done = false, info = null;
      var timer = setTimeout(function () { finish(info ? null : new Error('Couldn’t read that video. Try another one.'), info); }, 20000);
      function finish(err, val) {
        if (done) return;
        done = true; clearTimeout(timer);
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* gone */ }
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(val);
      }
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.onerror = function () { finish(new Error('Couldn’t open that video. Try a video from the camera or Photos.')); };
      v.onloadedmetadata = function () {
        var secs = isFinite(v.duration) ? v.duration : 0;
        if (secs > CLIP_MAX_SECS + 0.5) { finish(new Error('That video is ' + Math.round(secs) + ' seconds long. Videos can be up to ' + CLIP_MAX_SECS + ' seconds: trim it in Photos first.')); return; }
        info = { secs: Math.round(secs * 10) / 10, w: v.videoWidth || 0, h: v.videoHeight || 0, poster: null };
        var seek = function () {
          v.onseeked = function () {
            if (!v.videoWidth) { finish(null, info); return; }
            var c = middle43(v.videoWidth, v.videoHeight);
            canvasJpeg(v, c[0], c[1], c[2], c[3], THUMB_W, THUMB_H, 0.8).then(function (b) { info.poster = b; finish(null, info); }, function () { finish(null, info); });
          };
          try { v.currentTime = secs ? Math.min(0.5, secs / 2) : 0.01; } catch (e) { finish(null, info); }
        };
        var p = null;
        try { p = v.play(); } catch (e) { p = null; }
        if (p && p.then) p.then(function () { v.pause(); seek(); }, seek); else seek();
      };
      v.src = url;
    });
  }
  // upload the files of one photo or video to library/<id>/, in order, with one progress figure (0–1) for them all;
  // stop.stop() halts it (the file under way is abandoned, the rest not started)
  function mediaUpload(id, files, onPct, stop) {
    var total = files.reduce(function (n, f) { return n + f.blob.size; }, 0) || 1, before = 0, out = [], cur = '';
    return files.reduce(function (p, f) {
      return p.then(function () {
        if (stop.stopped) throw { code: 'aborted' };
        var sig = {};
        stop.cur = sig;
        cur = 'library/' + id + '/' + f.name;
        return CLOUD.media.upload(cur, f.blob, f.type, { signal: sig, onProgress: function (r) { onPct((before + r * f.blob.size) / total); } }).then(function (res) {
          before += f.blob.size;
          out.push(res);
          cur = '';
          onPct(before / total);
        });
      });
    }, Promise.resolve()).then(function () { return out; }, function (err) {
      // half an upload is no use: what did arrive goes, and so does a file stopped just as it arrived
      dropMedia(out.map(function (r) { return r.path; }).concat(err && err.code === 'aborted' && cur ? [cur] : []));
      throw err;
    });
  }
  function stopper() {
    var s = { stopped: false, cur: null };
    s.stop = function () { s.stopped = true; if (s.cur && s.cur.abort) s.cur.abort(); };
    return s;
  }
  function mediaErrText(err) {
    var c = err && err.code;
    if (c === 'aborted') return '';
    if (c === 'network' || navigator.onLine === false) return 'No internet connection. Connect, then try again.';
    if (c === 'signed-out') return 'Sign in to the clinic store to add photos and videos.';
    if (c === 'plan') return 'Uploads aren’t switched on yet: the Firebase project needs the pay-as-you-go (Blaze) plan.';
    if (c === 'denied' || c === 'nobucket') return 'The clinic’s file storage isn’t ready for uploads yet (Storage and its rules in the Firebase console).';
    if (c === 'toobig') return 'That file is too big to upload.';
    if (err && err.message && !c) return err.message;   // a photo or video that couldn't be prepared says why
    return 'The upload didn’t work. Try again.';
  }

  // ---- the editor's Photo and Video boxes (#libMedia). libEdit.media: { photo, clip (as the exercise will be saved),
  // busy: { photo|clip: { pct, stop, prep } }, added: [paths uploaded in this edit], dropped: [paths to delete on Save], msg }
  function freshEditMedia(e) {
    return { photo: e && e.photo ? JSON.parse(JSON.stringify(e.photo)) : null, clip: e && e.clip ? JSON.parse(JSON.stringify(e.clip)) : null,
      busy: {}, added: [], dropped: [], msg: '' };
  }
  function libMediaBusy() { var m = libEdit && libEdit.media; return !!(m && (m.busy.photo || m.busy.clip)); }
  function mediaWhyNot() {                             // why uploads can't happen now ('' when they can)
    if (!CLOUD) return 'Photos and videos are kept in the clinic store: this copy of the app isn’t connected to one.';
    if (!CLOUD.signedIn()) return 'Sign in to the clinic store to add photos and videos.';
    if (navigator.onLine === false) return 'Connect to the internet to add a photo or video.';
    return '';
  }
  function libMediaBoxHtml(kind) {
    var m = libEdit.media, it = m[kind], busy = m.busy[kind], photo = kind === 'photo', why = mediaWhyNot();
    var label = photo ? 'Photo' : 'Video', pic = it && it.turl;
    var sub = busy ? (busy.prep ? 'Preparing…' : 'Uploading ' + Math.round(busy.pct * 100) + '%…')
      : it ? (photo ? 'On the handout and the client’s phone' : [clipLen(it.secs), sizeText(it.bytes)].filter(Boolean).join(' · ') || 'Uploaded')
      : photo ? 'Shown in the app and printed on the handout' : 'Up to ' + CLIP_MAX_SECS + ' seconds, landscape';
    var acts = '';
    if (busy) acts = '<button type="button" class="quiet" data-media="' + kind + '-stop">Stop</button>';
    else {
      if (!why) acts += '<label class="ghost file-btn lm-pick"><span>' + (it ? 'Replace' : 'Take or choose') + '</span><input type="file" accept="' + (photo ? 'image/*' : 'video/*') + '" data-media-pick="' + kind + '" aria-label="' + label + ': take or choose"></label>';
      if (it) acts += '<button type="button" class="quiet" data-media="' + kind + '-view">' + (photo ? 'View' : PLAY + 'Play') + '</button>' +
        '<button type="button" class="quiet lm-remove" data-media="' + kind + '-remove">Remove</button>';
    }
    return '<div class="lm-box" data-kind="' + kind + '"><div class="lm-pic' + (pic ? '' : ' empty') + '">' +
      (pic ? '<img src="' + esc(pic) + '" alt="" loading="lazy">' + (photo ? '' : '<span class="lm-playmark">' + PLAY + '</span>') : '<span>' + label + '</span>') + '</div>' +
      '<div class="lm-side"><b>' + label + '</b><span class="lm-sub">' + esc(sub) + '</span>' +
      (busy && !busy.prep ? '<progress max="100" value="' + Math.round(busy.pct * 100) + '" aria-label="' + label + ' upload"></progress>' : '') +
      (acts ? '<div class="lm-acts">' + acts + '</div>' : '') + '</div></div>';
  }
  function renderLibMedia() {
    var box = $('libMedia'), msg = $('libMediaMsg');
    if (!box || !libEdit || !libEdit.media) return;
    var why = mediaWhyNot(), keep = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-media') || document.activeElement.getAttribute('data-media-pick') : '';
    box.innerHTML = libMediaBoxHtml('photo') + libMediaBoxHtml('clip');
    var text = libEdit.media.msg || (why && !libEdit.media.photo && !libEdit.media.clip ? why : why ? why.replace('to add a photo or video', 'to change these') : '');
    msg.textContent = text;
    msg.hidden = !text;
    msg.classList.toggle('bad', !!libEdit.media.msg);
    if (keep) { var again = box.querySelector('[data-media="' + keep + '"], [data-media-pick="' + keep + '"]'); if (again) focusQuiet(again); }
  }
  // a photo or video picked in the editor: prepared, uploaded, then in the box (saved with the exercise on Save)
  function libPickMedia(kind, file) {
    var edit = libEdit;
    if (!edit || !file || edit.media.busy[kind]) return;
    var m = edit.media, photo = kind === 'photo', why = mediaWhyNot();
    m.msg = '';
    if (why) { m.msg = why; renderLibMedia(); return; }
    if (file.type && file.type.indexOf(photo ? 'image/' : 'video/') !== 0) { m.msg = photo ? 'That file isn’t a photo.' : 'That file isn’t a video.'; renderLibMedia(); return; }
    if (!photo && file.size > CLIP_MAX_BYTES) { m.msg = 'That video is ' + sizeText(file.size) + '. Videos can be up to ' + sizeText(CLIP_MAX_BYTES) + ': record a shorter one, or at 720p.'; renderLibMedia(); return; }
    var stop = stopper(), busy = m.busy[kind] = { pct: 0, stop: stop, prep: true }, id = edit.mid, stamp = fileStamp();
    edit.dirty = true;
    renderLibMedia();
    keepAwake();
    (photo ? makePhoto(file) : readClip(file)).then(function (p) {
      if (stop.stopped) throw { code: 'aborted' };
      busy.prep = false;
      if (libEdit === edit) renderLibMedia();
      var files;
      if (photo) files = [{ name: 'p-' + stamp + '.jpg', blob: p.full, type: 'image/jpeg' }, { name: 'p-' + stamp + '-t.jpg', blob: p.thumb, type: 'image/jpeg' }];
      else {
        var type = /^video\/[a-z0-9.+-]+$/i.test(file.type || '') ? file.type : 'video/mp4';
        var ext = /quicktime/i.test(type) ? 'mov' : /webm/i.test(type) ? 'webm' : /3gpp/i.test(type) ? '3gp' : 'mp4';
        files = [{ name: 'v-' + stamp + '.' + ext, blob: file, type: type }];
        if (p.poster) files.push({ name: 'v-' + stamp + '-t.jpg', blob: p.poster, type: 'image/jpeg' });
        busy.info = p;
      }
      return mediaUpload(id, files, function (r) {
        busy.pct = r;
        if (libEdit === edit) {                          // the bar and the figure, without redrawing the boxes
          var bx = $('libMedia') && $('libMedia').querySelector('.lm-box[data-kind="' + kind + '"]');
          var pr = bx && bx.querySelector('progress'), sb = bx && bx.querySelector('.lm-sub');
          if (pr) pr.value = Math.round(r * 100);
          if (sb) sb.textContent = 'Uploading ' + Math.round(r * 100) + '%…';
        }
      }, stop).then(function (res) {
        var made = photo ? { url: res[0].url, path: res[0].path, turl: res[1].url, tpath: res[1].path, w: p.w, h: p.h }
          : { url: res[0].url, path: res[0].path, w: p.w, h: p.h, secs: p.secs, bytes: res[0].size || file.size, type: files[0].type };
        if (!photo && res[1]) { made.turl = res[1].url; made.tpath = res[1].path; }
        return tidyMedia(made, !photo);
      });
    }).then(function (made) {
      delete m.busy[kind];
      if (libEdit !== edit || !made) { if (made) dropMedia(mediaPaths(made)); return; }   // the editor closed meanwhile
      var old = m[kind];
      if (old) {                                       // the one it replaces: gone now if it came this edit, else on Save
        var mine = mediaPaths(old).filter(function (q) { return m.added.indexOf(q) >= 0; });
        m.added = m.added.filter(function (q) { return mine.indexOf(q) < 0; });
        dropMedia(mine);
        m.dropped = m.dropped.concat(mediaPaths(old).filter(function (q) { return mine.indexOf(q) < 0; }));
      }
      m[kind] = made;
      m.added = m.added.concat(mediaPaths(made));
      if (made.turl) primePhoto(made.turl);
      renderLibMedia();
    }, function (err) {
      delete m.busy[kind];
      if (libEdit !== edit) return;
      m.msg = mediaErrText(err);
      renderLibMedia();
    });
  }
  function libMediaRemove(kind) {
    var m = libEdit && libEdit.media, it = m && m[kind];
    if (!it) return;
    var mine = mediaPaths(it).filter(function (q) { return m.added.indexOf(q) >= 0; });
    m.added = m.added.filter(function (q) { return mine.indexOf(q) < 0; });
    dropMedia(mine);                                   // uploaded this edit: gone now; saved before: gone on Save
    m.dropped = m.dropped.concat(mediaPaths(it).filter(function (q) { return mine.indexOf(q) < 0; }));
    m[kind] = null;
    m.msg = '';
    libEdit.dirty = true;
    renderLibMedia();
    var pick = $('libMedia').querySelector('[data-media-pick="' + kind + '"]');
    if (pick) focusQuiet(pick);
  }
  // the editor is closing: uploads under way stop; files uploaded this edit and not saved are deleted
  function libMediaEnd(saved) {
    var m = libEdit && libEdit.media;
    if (!m) return;
    Object.keys(m.busy).forEach(function (k) { if (m.busy[k] && m.busy[k].stop) m.busy[k].stop.stop(); });
    if (!saved) dropMedia(m.added);
    else dropMedia(m.dropped);
    m.added = []; m.dropped = [];
  }
  function onLibMediaClick(b) {
    var a = b.getAttribute('data-media'), kind = a.split('-')[0], what = a.split('-')[1], m = libEdit && libEdit.media;
    if (!m) return;
    if (what === 'stop') { if (m.busy[kind] && m.busy[kind].stop) m.busy[kind].stop.stop(); return; }
    if (what === 'remove') { libMediaRemove(kind); return; }
    if (what === 'view' && m[kind]) {
      libEdit.away = true;                             // the viewer replaces the editor for a moment: nothing is tidied up
      openMediaView(cap($('libName').value, 120) || 'Exercise', kind === 'photo' ? { photo: m.photo } : { clip: m.clip }, function () {
        if (libEdit) libEdit.away = false;
        openModal(els.libDialog, $('libMedia').querySelector('[data-media="' + a + '"]') || $('libName'), libAfter);
        return true;
      });
    }
  }

  // ---- the viewer (#videoDialog): an uploaded video plays in a <video>, an uploaded photo shows full size; a video link
  // still plays in its player (openVideo). what: { photo } or { clip }
  function openMediaView(name, what, after) {
    var box = $('videoBox'), msg = $('videoMsg'), open = $('videoOpen'), old = $('videoFrame');
    if (old) old.parentNode.removeChild(old);
    var clip = what.clip, photo = what.photo;
    $('videoTitle').textContent = name;
    box.hidden = false;
    box.classList.toggle('pic', !!photo);
    msg.hidden = true;
    open.hidden = true;
    if (clip) {
      var v = document.createElement('video');
      v.id = 'videoFrame'; v.controls = true; v.playsInline = true; v.preload = 'metadata';
      v.setAttribute('playsinline', '');
      if (clip.turl) v.poster = clip.turl;
      v.src = clip.url;
      v.title = name + ' video';
      v.onerror = function () { msg.textContent = navigator.onLine === false ? 'Videos need an internet connection.' : 'This video couldn’t be played here.'; msg.hidden = false; };
      box.appendChild(v);
    } else if (photo) {
      var img = document.createElement('img');
      img.id = 'videoFrame'; img.alt = name; img.src = photo.url;
      img.onerror = function () { msg.textContent = 'This photo couldn’t be loaded (no connection?).'; msg.hidden = false; };
      box.appendChild(img);
    }
    openModal(els.videoDialog, $('videoClose'), function (restore) {
      var f = $('videoFrame');
      if (f && f.tagName === 'VIDEO') { try { f.pause(); f.removeAttribute('src'); f.load(); } catch (e) { /* gone */ } }
      if (f) f.parentNode.removeChild(f);
      box.classList.remove('pic');
      open.hidden = false;
      return after ? after(restore) : false;
    });
  }
  // a linked exercise's video in the builder: the uploaded one, else the link
  function openExVideo(e) {
    if (!e) return;
    if (e.clip) openMediaView(e.name, { clip: e.clip });
    else if (e.video) openVideo(e.name, e.video);
  }
  function openExPhoto(e) { if (e && e.photo) openMediaView(e.name, { photo: e.photo }); else openExVideo(e); }

  // ---- the 4:3 pictures as data the handout can print (JPEG data URLs), kept on this device in the Cache API so a
  // handout made offline still has them
  var photoData = {};
  function blobToDataUrl(b) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { resolve(''); };
      r.readAsDataURL(b);
    });
  }
  function fetchPhoto(url) {
    if (photoData[url]) return Promise.resolve(photoData[url]);
    var cached = window.caches ? caches.open(MEDIA_CACHE).then(function (c) { return c.match(url); }).catch(function () { return null; }) : Promise.resolve(null);
    return cached.then(function (hit) {
      if (hit) return hit.blob();
      return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        if (window.caches) { var copy = res.clone(); caches.open(MEDIA_CACHE).then(function (c) { return c.put(url, copy); }).catch(function () {}); }
        return res.blob();
      });
    }).then(function (b) { return b ? blobToDataUrl(b) : ''; }).then(function (d) {
      d = String(d || '').replace(/^data:[^;,]*;base64,/, 'data:image/jpeg;base64,');
      if (/^data:image\/jpeg;base64,\/9j\//.test(d)) { photoData[url] = d; return d; }   // a JPEG (starts FF D8 FF)
      return null;
    }).catch(function () { return null; });
  }
  function primePhoto(url) { if (url && navigator.onLine !== false) fetchPhoto(url); }
  function loadPhotos(urls, ms) {                     // the handout's pictures, for at most ms (what's missing prints without)
    var todo = urls.filter(function (u) { return !photoData[u]; });
    if (!todo.length) return Promise.resolve();
    return Promise.race([Promise.all(todo.map(fetchPhoto)), new Promise(function (r) { setTimeout(r, ms || 6000); })]);
  }
  // the pictures the handout will print: the linked exercises' photos (or a frame of their video), unless switched off
  function handoutPhotoUrls() {
    if (state.ex.photos === false) return [];
    var out = [];
    state.ex.items.forEach(function (it) {
      var e = exFilled(it) && exLinked(it), u = thumbOf(e);
      if (u && out.indexOf(u) < 0) out.push(u);
    });
    return out;
  }

  // ------------------------------------------------------------------ v35: the client's program on their phone
  // Matthew (4 Oct): "The exercises prescribed would also be even better if it showed up on an app the patient COULD
  // download or use via HTML like we are now". His choices: a private link and QR code; the phone page shows the program
  // (no ticks yet); the link works until four weeks after the next review (twelve weeks after the program's date without
  // one), can be stopped at any time, and a new handout updates the same link. "On their phone" in the handout panel makes
  // Create handout save a copy of the program (the first name only: no surname, date of birth or results) to the clinic
  // store under a random token (shared/<token>, cloud.js) and print its code on the handout; the report view then offers
  // Show the code, Share link, Copy link and Stop sharing. A client keeps one link: a later program for them updates it (the
  // page on their home screen shows the newest) until it is stopped. x.phone: true / false as ticked, null = as their last
  // program (on while they have a link that works); x.share: { token, key (the client it was made for), expires }: the
  // link last sent from this page. The saved program keeps share: { token, expires } (stopped: true once stopped).
  var PHONE_PAGE = (function () { try { return new URL('../my-program/', location.href).href.replace(/[?#].*$/, ''); } catch (e) { return ''; } })();
  var TOKEN_RE = /^[A-Za-z0-9]{20,64}$/;
  function newToken() {                                // 24 characters from 62: about 143 random bits
    var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', out = '';
    while (out.length < 24) {
      var a = new Uint8Array(32);
      crypto.getRandomValues(a);
      for (var i = 0; i < a.length && out.length < 24; i++) if (a[i] < 248) out += abc.charAt(a[i] % 62);   // 248 = 4 × 62: no bias
    }
    return out;
  }
  function phoneReady() {                              // signed in to the clinic store, on a device that can make a token
    return !!(CLOUD && CLOUD.signedIn() && CLOUD.share && PHONE_PAGE && window.crypto && crypto.getRandomValues);
  }
  function phoneUrl(token) { return PHONE_PAGE + '#' + token; }
  function exKey() { return E.nameKey(clean1(state.ex.meta.name)) || ''; }
  // the client's link in their saved programs (the newest program that has one): { token, expires, stopped, date } or null
  function clientLink(key) {
    var cl = key ? clients.clients[key] : null, progs = exPrograms(cl);
    for (var i = progs.length - 1; i >= 0; i--) {
      var sh = progs[i].program.share;
      if (sh && typeof sh === 'object' && TOKEN_RE.test(sh.token)) return { token: sh.token, expires: String(sh.expires || ''), stopped: sh.stopped === true, date: progs[i].date };
    }
    return null;
  }
  function linkLive(l) { var t = l ? Date.parse(l.expires) : NaN; return !!l && !l.stopped && isFinite(t) && t > Date.now(); }
  function phoneOn() {
    var x = state.ex;
    return x.phone === true || (x.phone !== false && linkLive(clientLink(exKey())));
  }
  // the program's token: the link sent from this page for this client, else the client's own (unless stopped), else new
  function phoneToken() {
    var x = state.ex, key = exKey(), l;
    if (x.share && x.share.key === key && TOKEN_RE.test(x.share.token)) return x.share.token;
    l = clientLink(key);
    return l && !l.stopped ? l.token : newToken();
  }
  // until when: the end of the day four weeks after the next review (Queensland time: UTC+10 all year), else twelve weeks
  // after the program's date, and never less than four weeks from today. { day (ISO), iso (the moment) }
  function phoneEnds() {
    var x = state.ex, rv = exIsoDate(x.review), day = rv ? addDaysIso(rv, 28) : addDaysIso(exIsoDate(x.meta.date) || todayIso(), 84);
    var least = addDaysIso(todayIso(), 28);
    if (!day || day < least) day = least;
    return { day: day, iso: new Date(Date.parse(day + 'T23:59:59+10:00')).toISOString() };
  }
  function firstName(n) { return clean1(n).split(' ')[0].slice(0, 40); }
  // one exercise as the phone page shows it: the handout's words, and the library exercise's photo, video and link
  function phoneRow(r, e, vi) {
    var o = {};
    EX_FIELDS.forEach(function (f) { if (r[f]) o[f] = r[f]; });
    if (r.cues) o.cues = r.cues.slice(0, 3);
    if (e && e.photo) o.photo = { url: e.photo.url, turl: e.photo.turl || '' };
    if (e && e.clip) o.clip = { url: e.clip.url, turl: e.clip.turl || '', secs: e.clip.secs || 0 };
    if (vi && /^https?:\/\//i.test(vi.link)) o.link = vi.link;
    return o;
  }
  // the link's last write and what the report view says about it
  function phoneState(token) { return CLOUD && CLOUD.shareState ? CLOUD.shareState(token) : 'sent'; }
  // the client's saved programs with this link marked as stopped (or, for Undo, not); each one changed is uploaded again
  function markShareStopped(key, token, stopped) {
    var cl = key ? clients.clients[key] : null, changed = [];
    exPrograms(cl).forEach(function (sess) {
      var sh = sess.program.share;
      if (!sh || sh.token !== token || (sh.stopped === true) === stopped) return;
      if (stopped) sh.stopped = true; else delete sh.stopped;
      changed.push(sess);
    });
    if (!changed.length) return;
    saveClients();
    if (CLOUD) { changed.forEach(function (sess) { CLOUD.putSession(key, cl.name, sess); }); CLOUD.sync(); }
  }
  // the report view's card (#sheetPhone) for a handout: the link's state and what can be done with it, or the offer to send
  // it. current.phone: { token, url, day, first, key } when the handout on screen has the link's code
  function renderPhoneCard() {
    var card = $('sheetPhone');
    if (!card) return;
    var ph = current && current.phone, show = !!(current && current.ex) && phoneReady();
    card.hidden = !show;
    if (!show) { card.innerHTML = ''; return; }
    var who = ph ? ph.first : firstName(state.ex.meta.name), whose = who ? who + '’s' : 'their';
    var keep = document.activeElement && card.contains(document.activeElement) ? document.activeElement.id : '';
    if (!ph) {
      card.className = 'sheet-phone';
      card.innerHTML = '<p>' + PHONE_ICON + '<span><b>Send this program to ' + esc(whose) + ' phone?</b> A private link that works until ' + esc(E.displayIso(phoneEnds().day)) +
        ', with its code on the handout.</span></p><div class="sp-acts"><button type="button" class="ghost" id="phoneSend">Send to their phone</button></div>';
    } else {
      var st = phoneState(ph.token), offline = navigator.onLine === false;
      var line = st === 'denied' ? 'The clinic store refused the link: its rules need a line for shared programs (see the notes).'
        : st === 'waiting' ? (offline ? 'Waiting for a connection: the link starts working once this iPad is online.' : 'Sending the link…')
          : 'The link works until ' + E.displayIso(ph.day) + '. Show ' + (who || 'them') + ' the code to scan, or send the link.';
      card.className = 'sheet-phone on' + (st === 'denied' ? ' bad' : '');
      card.innerHTML = '<p>' + PHONE_ICON + '<span><b>On ' + esc(whose) + ' phone</b> <span class="sp-state" role="status">' + esc(line) + '</span></span></p>' +
        '<div class="sp-acts"><button type="button" class="ghost" id="phoneCode">Show the code</button>' +
        (navigator.share ? '<button type="button" class="ghost" id="phoneShare">Share link</button>' : '') +
        '<button type="button" class="ghost" id="phoneCopy">Copy link</button>' +
        '<button type="button" class="quiet sp-stop" id="phoneStop">Stop sharing</button></div>';
    }
    if (keep && $(keep)) focusQuiet($(keep));
  }
  var PHONE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
  // the handout again, from the report view, after the link was sent or stopped (quietly: no "Saved" message)
  function rebuildHandout(focusId) {
    if (els.sheet.hidden) return;
    openReport({ quiet: true, focus: focusId });
  }
  function phoneSendNow() {                            // Send to their phone (the report view): the handout again, with the code
    if (!phoneReady()) return;
    state.ex.phone = true;
    saveDraft();
    rebuildHandout('phoneCode');
  }
  function phoneStop() {
    var ph = current && current.phone, x = state.ex;
    if (!ph || !CLOUD) return;
    var was = { share: x.share, phone: x.phone };
    CLOUD.unshare(ph.token);
    markShareStopped(ph.key, ph.token, true);
    x.share = null; x.phone = false;
    saveDraft();
    CLOUD.sync();
    rebuildHandout('phoneSend');
    toast('Stopped sharing: the link no longer opens the program', { label: 'Undo', run: function () {
      if (state.ex !== x) return;
      markShareStopped(ph.key, ph.token, false);
      x.share = was.share || { token: ph.token, key: ph.key, expires: '' };
      x.phone = true;
      saveDraft();
      rebuildHandout('phoneCode');                     // sends the program to the same link again
    } });
  }
  function phoneCopyLink() {
    var ph = current && current.phone;
    if (!ph) return;
    var done = function () { toast('Link copied'); };
    try {
      navigator.clipboard.writeText(ph.url).then(done, function () { toast('Couldn’t copy here: use Share link or Show the code'); });
    } catch (e) { toast('Couldn’t copy here: use Share link or Show the code'); }
  }
  function phoneShareLink() {
    var ph = current && current.phone;
    if (!ph || !navigator.share) return;
    navigator.share({ title: 'Your exercise program', text: 'Your exercise program from BASE Health Noosa' + (ph.day ? ' (works until ' + E.displayIso(ph.day) + ')' : '') + ':', url: ph.url })
      .catch(function (err) { if (err && err.name !== 'AbortError') phoneCopyLink(); });
  }
  // the link's code, large, for the client to scan from the iPad
  function openPhoneCode() {
    var ph = current && current.phone, m = ph && window.BHReport && window.BHReport.qr ? window.BHReport.qr(ph.url) : null;
    if (!m) { toast('The code couldn’t be drawn: use Share link instead'); return; }
    var n = m.length, q = 4, d = '';
    m.forEach(function (row, r) {
      var c = 0;
      while (c < n) {
        if (!row[c]) { c++; continue; }
        var s0 = c;
        while (c < n && row[c]) c++;
        d += 'M' + (s0 + q) + ' ' + (r + q) + 'h' + (c - s0) + 'v1h-' + (c - s0) + 'z';
      }
    });
    $('phoneQr').innerHTML = '<svg viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" role="img" aria-label="Code for the link to the program" shape-rendering="crispEdges">' +
      '<rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    $('phoneQrFine').textContent = (ph.first ? 'Private to ' + ph.first + ' · ' : 'Private link · ') + 'works until ' + E.displayIso(ph.day);
    openModal($('phoneDialog'), $('phoneQrDone'));
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
    els.entry.innerHTML = '<div class="pagehead">' + pickHtml('ex') + '<p>Start a client’s program from a template in the builder (Start from template).</p></div>' +
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
      x.rationale = '';                                // v25: a template replaces the program, so Claude's reasoning about the old one goes
      x.reason = '';                                   // v32: and the note telling the client why the old one
      x.items = rows;
      x.scanned = {};
      delete scanInfo.ex;                              // a scan's Undo no longer applies
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
    $('tplSaveHint').textContent = (CLOUD ? 'Shared with the whole clinic.' : 'Saved on this device.') + ' The client’s name and the date aren’t saved.';
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
    if (a === 'ex-viewlog') { openClientPage(b.dataset.client, 'log'); return true; }   // v40: the client's training log (on Home)
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
      if (b.hasAttribute('data-media')) { onLibMediaClick(b); return; }   // v34: View / Play, Remove, Stop
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
    d.addEventListener('change', function (e) {
      if (libEdit) libEdit.dirty = true;
      var f = e.target.closest && e.target.closest('input[data-media-pick]');   // v34: a photo or video picked
      if (f) { var file = f.files && f.files[0]; f.value = ''; if (file) libPickMedia(f.getAttribute('data-media-pick'), file); }
    });
    d.addEventListener('keydown', function (e) {       // Return in a one-line box moves to the next box
      if (e.key !== 'Enter' || !e.target.matches('input:not([type=checkbox]):not([type=file])')) return;
      e.preventDefault();
      var f = modalFocusables(d).filter(function (x) { return x.matches('input:not([type=checkbox]):not([type=file]), select, textarea'); }), i = f.indexOf(e.target);   // (v34: never a photo or video picker)
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
  var PREFILL = { screen: ['sex', 'age', 'sport', 'tester'], str: ['sport', 'tester'], ham: ['injured', 'doi', 'clinician', 'sport'], acl: ['injured', 'dos', 'graft', 'surgeon', 'sport'], ankle: ['injured', 'doi', 'clinician', 'sport'], custom: ['sex', 'age', 'sport', 'tester', 'injured'] };   // v36; v37: the injured side (from Custom sessions only, as SAME_TOOL_ONLY says)
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
      ['result', 'previous', 'side', 'left', 'right', 'appr', 'total'].forEach(function (f) { if (!blank(v[f])) o[f] = String(v[f]).trim(); });   // v42: + Ankle-GO's apprehension and a questionnaire's total
      if (Object.keys(o).length) out[k] = o;
    });
    return out;
  }
  function saveSession(t, c) {
    var m = state[t].meta, name = String(m.name || '').trim(), key = E.nameKey(name);
    if (!key || isExample(t)) return null;            // v48: the example never reaches a record
    var date = m.date || todayIso(), meta = {};
    Object.keys(m).forEach(function (k) { if (k !== 'name' && !blank(m[k])) meta[k] = String(m[k]).trim(); });
    if (SL(t)) meta.pop = state[t].pop;              // v36: the Custom battery's too
    if (t === 'custom') { if (state.custom.hamPhase) meta.hamPhase = state.custom.hamPhase; if (state.custom.aclPhase) meta.aclPhase = state.custom.aclPhase; }   // v37
    if (t === 'ham' || t === 'acl') meta.phase = state[t].phase;
    if (t === 'acl') meta.normSex = state.acl.sex;
    var co = state[t].coach;                          // kept with the session, never filled back in from records
    if (coachSet(co)) meta.coach = { status: co.status, mods: String(co.mods || '').trim(), retest: co.retest };
    var sess = { tool: t, date: date, savedAt: new Date().toISOString(), meta: meta, values: compactValues(t), results: currentResults(t, c),
      mass: E.parseInput(m.mass), interp: blank(state[t].interp.text) ? '' : String(state[t].interp.text).trim() };
    if (t === 'custom') { sess.battery = tidyBattery(state.custom.battery); if (state.custom.batName) sess.batName = state.custom.batName; }   // v36: the tests done
    if (t === 'custom' && state.custom.batId) sess.batId = state.custom.batId;   // v43: the clinic battery it was
    if (t === 'custom') {                              // v43: the clinic's tests as they were rated (a report made again later shows these targets)
      var snap = {};
      sess.battery.forEach(function (it) { var tt = it.k === 'lib' ? ltFor(it.id) : null; if (tt) snap[tt.id] = ltSnapshot(tt); });
      if (Object.keys(snap).length) sess.libTests = snap;
    }
    // v39: so the client's page can make the report again as printed: the summary's AI note and the radar's chosen axes
    if (sess.interp && state[t].interp.ai) { sess.interpAi = true; if (state[t].interp.reviewed === false) sess.interpReviewed = false; }   // v48: printed as not yet checked
    if (SL(t) && Array.isArray(state[t].radar)) sess.radar = state[t].radar.filter(function (k) { return typeof k === 'string'; }).slice(0, 6);
    // v39: and the previous results the page had that the values don't keep: LL Strength's each leg (with that day's mass and
    // date), and the body mass a Custom battery's previous load was scored with
    var pv = {}, sv = state[t].values;
    Object.keys(sv).forEach(function (k) {
      var v = sv[k] || {};
      if (t === 'str' && (!blank(v.prevLeft) || !blank(v.prevRight))) pv[k] = { L: String(v.prevLeft || '').trim(), R: String(v.prevRight || '').trim(), mass: String(v.prevMass || '').trim(), date: String(v.prevDate || '') };
      else if (t === 'custom' && !blank(v.previous) && !blank(v.prevMass)) pv[k] = { mass: String(v.prevMass).trim() };
    });
    if (t === 'str' || t === 'custom') sess.prev = pv;   // (even empty: a session from before v39 has none, and is filled from the record)
    if (userName()) sess.savedBy = userName();         // v13: who saved it (the practitioner's name on this device)
    var acc = CLOUD && CLOUD.account(); if (acc && acc.staff) sess.savedById = acc.uid;   // v46: and which login
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
    if (!key || !program || (linkedTool() && isExample(linkedTool()))) return null;   // v48: nor a program linked to an example report
    var sess = { tool: 'ex', date: m.date || todayIso(), savedAt: new Date().toISOString(), meta: {}, values: {}, results: {}, mass: null, interp: '', program: program };
    if (!blank(m.practitioner)) sess.meta.practitioner = clean1(m.practitioner);
    if (userName()) sess.savedBy = userName();
    var acc2 = CLOUD && CLOUD.account(); if (acc2 && acc2.staff) sess.savedById = acc2.uid;   // v46
    return storeSession(key, name, sess);
  }
  // v15: a client's saved programs, oldest first (by date, then when saved)
  function exPrograms(cl) {
    return cl ? E.sortSessions(cl.sessions.filter(function (x) { return x && x.tool === 'ex' && x.program && typeof x.program === 'object'; })) : [];
  }
  function exHasContent() {
    var x = state.ex, c = exCounts();
    return c.exercises > 0 || c.sections > 0 || !blank(x.title) || !blank(x.instructions) || !blank(x.reason);   // v32: + Why this plan
  }
  // v15: a client chosen on the Exercises tab: the name, and their last saved program in place of the one on screen
  // (title, instructions and rows with fresh ids; each row keeps its library link, dose and notes; the cues and video
  // come from the library). The date stays (a new visit). Undo puts back what was replaced.
  var exLoaded = null;                                 // { key, date }: the program loaded last (the client bar says so)
  // v39: which (a date): that program from their record (the client's page), else the last one
  function loadProgramFor(key, picked, undoClear, was, which) {
    var cl = clients.clients[key];
    if (!cl) return;
    var x = state.ex, progs = exPrograms(cl), last = progs.slice(-1)[0];
    if (which) progs.forEach(function (p) { if (p.date === which) last = p; });
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
    x.rationale = exTidy(exStr(p.rationale), 'rationale');   // v25
    // v32: Why this plan and the block length come back; the next review is worked out again from today's date
    x.reason = exTidy(exStr(p.reason), 'reason'); x.weeks = exWeeks(p.weeks); x.large = p.large === true; x.photos = p.photos !== false;   // v34: photos
    x.phone = null; x.share = null;                    // v35: on their phone while they have a link that works
    x.review = ''; x.reviewAuto = false; autoReview();
    x.items = progItems(p.items).map(function (it) { return it.kind === 'section' ? newExSection(it.heading) : newExRow(it); });
    if (p.plan) x.plan = tidyPlan(p.plan);             // v23: the client's last plan (sessions a week, setting, experience, block)
    x.scanned = {};
    delete scanInfo.ex;                                // a scan's Undo no longer applies to this program
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
    var key = E.nameKey(state.ex.meta.name), cl = key ? clients.clients[key] : null, lt = linkedTool();
    if (lt && isExample(lt)) {                         // v48: linked to the example report: nothing here is saved either
      bar.hidden = false; bar.className = 'client-bar example';
      bar.innerHTML = '<b>Example results</b> — this program goes with the example report, so it isn’t saved to any record.';
      applyExLogged();
      return;
    }
    if (!cl) { bar.hidden = true; bar.innerHTML = ''; bar.className = 'client-bar'; return; }
    var progs = exPrograms(cl), n = progs.length, last = n ? progs[n - 1].date : '';
    bar.hidden = false;
    if (exLoaded && exLoaded.key === key) {
      bar.className = 'client-bar loaded';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> — program from ' + esc(E.displayIso(exLoaded.date)) + ' loaded.' + exLogBit(key);   // v40: + their training log
    } else if (n) {
      bar.className = 'client-bar';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> — ' + (n === 1 ? '1 saved program, from ' : n + ' saved programs, the last on ') + esc(E.displayIso(last)) + '. ' +
        '<button type="button" class="quiet" data-action="ex-loadprog" data-client="' + esc(key) + '">Load last program</button>' + exLogBit(key);
    } else {
      bar.className = 'client-bar';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> has a ' + recordWord() + '; no programs yet.';
    }
    applyExLogged();                                   // v40: the rows' last-logged lines follow the client
  }
  function earlierCount(cl, t, date) {               // v36: the Custom battery counts the screen and strength sessions it can read too
    return cl ? historySessions(t, cl).filter(function (x) { return x.tool === t && x.date < date; }).length : 0;
  }
  // fill Previous results (and unchanging details) from the client's record. picked: chosen in Choose client (v11), which
  // folds the details card once the essentials are in; otherwise it folds when earlier results were loaded (never under a
  // box being typed in, e.g. a name suggestion tapped)
  // v36: the sessions a tool's previous results, trends and Progress table are read from. The Custom battery also reads
  // the client's Performance screen sessions (the same metric names) and LL Strength sessions (each leg mapped to the
  // battery's row), cut to the battery's metrics, each as if it were a Custom session
  function historySessions(t, cl) {
    if (t !== 'custom' || !cl) return cl ? cl.sessions : [];
    var names = {}, strOf = {};
    customSet().groups.forEach(function (g) { g.metrics.forEach(function (m) { names[m.name] = 1; if (m.str || m.ratio) strOf[(m.str || m.ratio) + '|' + (m.side === 'Left' ? 'L' : 'R')] = m.name; }); });   // v37: + the hip ratio
    // v43: a clinic test renamed in the builder: results saved under its earlier names count as its own
    var alias = {}, na = 0;
    state.custom.battery.forEach(function (it) {
      var tt = it.k === 'lib' ? ltFor(it.id) : null;
      if (!tt || !tt.was) return;
      tt.was.forEach(function (old) {
        if (tt.legs) ['Left', 'Right'].forEach(function (sd) { alias[old + ' \u2014 ' + sd] = ltSideName(tt, sd); na++; });
        else { alias[old] = tt.name; na++; }
      });
    });
    function renamed(x) {
      var y = Object.assign({}, x, { results: Object.assign({}, x.results), values: Object.assign({}, x.values || {}) }), hit = false;
      Object.keys(alias).forEach(function (old) {
        var nw = alias[old];
        if (old in x.results && !(nw in y.results)) { y.results[nw] = x.results[old]; hit = true; }
        if (x.values && old in x.values && !(nw in y.values)) y.values[nw] = x.values[old];
      });
      return hit ? y : x;
    }
    var out = [];
    cl.sessions.forEach(function (x) {
      if (!x || !x.results) return;
      if (x.tool === 'custom') { out.push(na ? renamed(x) : x); return; }
      if (x.tool !== 'screen' && x.tool !== 'str' && x.tool !== 'ham' && x.tool !== 'acl') return;   // v37: + the rehab tools' sessions (same metric names)
      var res = {}, vals = {}, any = false;
      Object.keys(x.results).forEach(function (k) {
        var name = x.tool === 'str' ? strOf[k] : (names[k] ? k : '');
        if (!name) return;
        res[name] = x.results[k]; any = true;
        if (x.tool === 'str') { var id = k.split('|')[0], sd = k.split('|')[1] === 'L' ? 'left' : 'right', raw = x.values && x.values[id]; if (raw && !blank(raw[sd])) vals[name] = { result: raw[sd] }; }
        else if (x.values && x.values[k]) vals[name] = x.values[k];
      });
      if (any) out.push({ tool: 'custom', date: x.date, savedAt: x.savedAt, meta: x.meta, values: vals, results: res, mass: x.mass, from: x.tool });
    });
    return E.sortSessions(out);
  }
  // v36: tests added to a Custom battery after the client's record was loaded (Choose tests, a saved battery, Scan notes) get
  // their previous results too: only boxes with no previous of their own; the client bar's count and dates follow
  function fillCustomPrevious() {
    var s = state.custom, h = s.hist, key = E.nameKey(s.meta.name), cl = h && h.key === key ? clients.clients[key] : null;
    if (!cl) return 0;
    var hs = historySessions('custom', cl), date = s.meta.date || todayIso(), n = 0, dates = {}, have = 0;
    customSet().groups.forEach(function (g) {
      g.metrics.forEach(function (mm) {
        if (mm.calc === 'DSI' || mm.calc === 'RATIO') return;   // v37: the hip ratio's previous comes from the hip tests'
        var v = val('custom', mm.name);
        if (v.prevDate && !blank(v.previous)) { have++; dates[v.prevDate] = 1; }
        if (!blank(v.previous)) return;
        var src = /^(XBW|PCTBW|PERKG|PERBW|NPCTBW)$/.test(mm.calc || '') ? hs.filter(function (x) { return x.values && x.values[mm.name] && !blank(x.values[mm.name].result); }) : hs;
        var p = E.previousFor(src, 'custom', mm.name, date);
        if (!p) return;
        var raw = p.session.values && p.session.values[mm.name];
        v.previous = raw && !blank(raw.result) ? raw.result : String(p.value);
        v.prevDate = p.date; v.prevEdit = false; v.prevMass = p.mass == null ? '' : String(p.mass);
        dates[p.date] = 1; n++;
      });
    });
    h.n = have + n; h.dates = Object.keys(dates).sort();   // what the battery on the page has from the record now
    return n;
  }
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
      // v43: a clinic battery compares against its own choice (one asked each time: as the last time it ran for them)
      if (SL(t) && ms.pop) {
        var rb = t === 'custom' && s.batId ? runBat() : null;
        if (!(t === 'custom' && s.batId) || (rb && builtPop(rb) === null && all[j].batId === s.batId)) s.pop = ms.pop;
      }
      // v36: an empty Custom battery takes the tests done last time
      if (t === 'custom' && !s.battery.length && Array.isArray(all[j].battery)) { s.battery = tidyBattery(all[j].battery); s.batName = typeof all[j].batName === 'string' ? all[j].batName : ''; }
      break;
    }
    var hs = historySessions(t, cl);
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
          var p = E.previousFor(hs, 'str', tt.id + '|' + sd[1], date);
          var raw = p && p.session.values && p.session.values[tt.id];
          if (!p || !raw || blank(raw[sd[0]])) return;
          v[sd[2]] = raw[sd[0]]; v.prevMass = p.mass == null ? '' : String(p.mass); v.prevDate = p.date;
          got = true; dates[p.date] = 1;
        });
        if (got) n++;
      });
    } else {
      setOf(t).groups.forEach(function (g) {
        g.metrics.forEach(function (mm) {
          if (mm.calc === 'RATIO' || mm.role === 'len') return;   // v37: worked out from the hip tests' previous results; v42: the leg length has none
          // v36: a load or force needs the value as typed (the record's result is the score): only sessions that kept it
          var src = t === 'custom' && /^(XBW|PCTBW|PERKG|PERBW|NPCTBW)$/.test(mm.calc || '') ? hs.filter(function (x) { return x.values && x.values[mm.name] && !blank(x.values[mm.name].result); }) : hs;
          var v = val(t, mm.name), p = E.previousFor(src, t, mm.name, date);
          v.prevEdit = false;
          if (!p) {
            if (v.prevDate) v.previous = '';           // a value from an earlier load (e.g. another client) goes; typed ones stay
            v.prevDate = '';
            return;
          }
          var raw = p.session.values && p.session.values[mm.name];
          v.previous = raw && !blank(raw.result) ? raw.result : String(p.value);
          v.prevDate = p.date; n++; dates[p.date] = 1;
          if (t === 'custom') v.prevMass = p.mass == null ? '' : String(p.mass);   // v36: the mass a previous load was scored with
        });
      });
    }
    // v18: a returning client starts on "Only last time's tests" (one tap shows them all); the same client reloaded keeps the choice
    // (v36: not on the Custom battery, where the battery is already the tests chosen for today: one added would hide)
    if (!s.hist || s.hist.key !== key) s.onlyPrev = n > 0 && t !== 'custom' && t !== 'ankle';   // v42: nor on Ankle-GO (every item is in the score)
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
    if (isExample(t)) {                                // v48: the example's banner, in place of any record of that name
      bar.hidden = false; bar.className = 'client-bar example';
      bar.innerHTML = exampleBarHtml();
      return;
    }
    if (cl && h && h.key === key) {
      bar.hidden = false; bar.className = 'client-bar loaded';
      var on = retest.on && retest.tool === t;
      bar.innerHTML = '<b>' + esc(cl.name) + '</b>' + (h.n
        ? ' — previous results loaded from ' + esc(h.dates.map(E.displayIso).join(', ')) + ' (' + h.n + (h.n === 1 ? ' test' : ' tests') + ')'
        : ' — no earlier ' + (t === 'custom' ? 'results this battery can use' : TOOL_NAMES[t] + ' sessions') + '; details filled in') +
        (h.date !== date ? ' <button type="button" class="quiet" data-action="reload-history">Reload for this date</button>' : '') +
        (h.n && t !== 'ankle' ? ' <button type="button" class="quiet retest" data-action="retest">' + (on ? 'Show all tests' : 'Only last time’s tests') + '</button>' +   // v42: Ankle-GO scores every item
          (on ? '<span class="retest-n">Showing ' + retest.n + ' of ' + retest.total + ' tests</span>' : '') : '');
    } else if (cl) {
      var earlier = earlierCount(cl, t, date), total = cl.sessions.length;
      bar.hidden = false; bar.className = 'client-bar';
      bar.innerHTML = '<b>' + esc(cl.name) + '</b> has ' + total + (total === 1 ? ' saved session' : ' saved sessions') +
        (earlier ? ', ' + earlier + ' earlier ' + (t === 'custom' ? 'with results this battery can use' : TOOL_NAMES[t]) + '. ' : ', none earlier ' + (t === 'custom' ? 'with results this battery can use' : 'for ' + TOOL_NAMES[t]) + '. ') +
        '<button type="button" class="quiet" data-action="load-history" data-client="' + esc(key) + '">' + (earlier ? 'Load previous results' : 'Fill in details') + '</button>';
    } else { bar.hidden = true; bar.innerHTML = ''; }
  }
  function exampleBarHtml() {
    return '<b>Example results</b> — not saved to any record. <button type="button" class="quiet" data-action="example-remove">Remove</button>';
  }
  function clientLine(t) {
    var name = String(state[t].meta.name || '').trim(), cl = clientFor(name);
    if (t === 'ex' ? (linkedTool() && isExample(linkedTool())) : isExample(t)) return 'Example results: nothing on this page is saved to a record.';   // v48
    if (!name) return t === 'ex' ? 'Add a client name to save this program to a ' + recordWord() + '.' : 'Add a name to save this session to a ' + recordWord() + '.';
    var date = state[t].meta.date || todayIso();
    // one line each (v11); the client bar in the details card says how many sessions there are
    var where = CLOUD ? '’s clinic record.' : '’s client record on this device.';
    if (!cl) return 'Saves to ' + name + where;
    var same = cl.sessions.some(function (x) { return x.tool === t && x.date === date; });
    return same ? 'Updates ' + cl.name + '’s ' + recordWord() + ' for this date.' : 'Saves to ' + cl.name + where;
  }
  var pastAsOf = '';                                   // v39: a report made again from the record: only sessions before its date
  function progressData(t, c) {
    var m = state[t].meta, cl = clientFor(m.name);
    if (!cl) return null;
    var hs = historySessions(t, cl);
    if (pastAsOf) hs = hs.filter(function (x) { return x.date < pastAsOf; });   // (as it was printed: nothing from later visits)
    var p = E.progress(hs, t, { date: m.date || todayIso(), results: currentResults(t, c) }, 5);
    if (!p.rows.length) return null;
    var label = {}, unit = {}, dir = {};
    if (t === 'str') {
      DATA.str.tests.forEach(function (tt) {
        ['L', 'R'].forEach(function (k) { var id = tt.id + '|' + k; label[id] = tt.name + ' — ' + (k === 'L' ? 'Left' : 'Right'); unit[id] = SCORE_UNITS[tt.score] || ''; dir[id] = tt.dir || 'Higher'; });
      });
    } else {
      setOf(t).groups.forEach(function (g) { g.metrics.forEach(function (mm) { label[mm.name] = mm.name; unit[mm.name] = mm.scoreUnit || mm.unit || ''; dir[mm.name] = mm.dir || ''; }); });   // v42: a reach is recorded as % of leg length
      if (t === 'ankle') { var sc0 = DATA.ankle.score; label[sc0.name] = sc0.name; unit[sc0.name] = sc0.unit; dir[sc0.name] = sc0.dir; }
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
    // v48: Back up records… is an admin's, so a practitioner's login isn't pointed at it
    if (CLOUD) els.clientsFine.textContent = 'Records are kept in the clinic store and shared by every signed-in device; this device keeps a copy for when the Wi\u2011Fi is poor.' + (isAdmin() ? ' Back up records\u2026 in the \u22ef menu still saves a file.' : '');
    syncClientsEdit();
    renderClientsList();
    // no box focused at first (the iPad keyboard would cover the list): the first client, else New client / Close
    openModal(els.clientsDialog, els.clientsList.querySelector('.cl-pick') || (pick ? els.clientsNew : els.clientsClose));
  }
  function syncClientsEdit() {                         // v18: Edit (manage mode, with clients to delete) ↔ Done; v48: admins only
    els.clientsEdit.hidden = clientsMode !== 'manage' || !isAdmin() || (!clientKeys().length && !recentDeleted().length);
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
    var del = !pick && clientsEditing && isAdmin();    // v18: Delete only in Edit; otherwise every row loads its client. v48: admins
    els.clientsSummary.textContent = !keys.length ? 'No saved clients yet. A record starts when you create a report with a name filled in.'
      : pick ? loads
        : keys.length + (keys.length === 1 ? ' client, ' : ' clients, ') + total + (total === 1 ? ' session' : ' sessions') + (CLOUD ? ', in the clinic store. ' : ', saved on this device. ') +
          (del ? 'Tap Delete to remove a client (Undo is in the message after).' : homeView ? 'Tap a name to open their page.' : 'Tap a name to load it here.');
    els.clientsSearchWrap.hidden = !keys.length;
    var shown = q ? keys.filter(function (k) { return k.indexOf(q) >= 0; }) : keys;
    var recent = del ? recentDeletedHtml() : '';       // v48: under the list, in Edit
    if (!keys.length) { els.clientsList.innerHTML = recent; return; }
    if (!shown.length) { els.clientsList.innerHTML = '<p class="client-none" role="status">No clients match “' + esc(typed) + '”.</p>' + recent; return; }
    els.clientsList.innerHTML = '<ul class="client-list' + (del ? '' : ' pick') + '">' + shown.map(function (k) {
      var cl = clients.clients[k], d = '<b>' + esc(cl.name) + '</b><span>' + esc(clientDetail(cl)) + '</span>';
      return !del ? '<li><button type="button" class="cl-pick" data-action="pick-client" data-key="' + esc(k) + '">' + d + '</button></li>'
        : '<li><div class="cl-main">' + d + '</div><button type="button" class="quiet cl-del" data-action="delete-client" data-key="' + esc(k) + '">Delete</button></li>';
    }).join('') + '</ul>' + recent;
  }
  // ---- v48: Recently deleted. A deleted client's record is kept on this iPad for 30 days (in the clinic store its sessions
  // are tombstones, hidden from every device); Undo in the message, or Restore here, puts it back: the record as it was,
  // and in cloud mode each session written again (a tombstone still waiting to upload is replaced in the queue).
  var RECENT_DEL = 'bh-athlete-report-deleted-v1', RECENT_DAYS = 30, RECENT_MAX = 20;
  function recentScope() { return CLOUD ? 'cloud' : 'local'; }   // (any admin on this iPad sees them; the records are one clinic's)
  function recentDeleted() {
    var list = null;
    try { list = JSON.parse(localStorage.getItem(RECENT_DEL)); } catch (e) { list = null; }
    if (!Array.isArray(list)) return [];
    var cut = Date.now() - RECENT_DAYS * 86400000, scope = recentScope();
    return list.filter(function (x) { return x && typeof x === 'object' && x.scope === scope && typeof x.key === 'string' && Array.isArray(x.sessions) && (Date.parse(x.at) || 0) > cut; });
  }
  function saveRecent(list) {
    var scope = recentScope(), other = [];
    try { other = (JSON.parse(localStorage.getItem(RECENT_DEL)) || []).filter(function (x) { return x && x.scope !== scope; }); } catch (e) { other = []; }
    try { localStorage.setItem(RECENT_DEL, JSON.stringify(other.concat(list.slice(-RECENT_MAX)))); } catch (e) { /* storage full: Undo in the message still works */ }
  }
  function rememberDeleted(key, cl) {
    var entry = { scope: recentScope(), key: key, name: cl.name, sessions: cl.sessions, at: new Date().toISOString(), by: userName() };
    saveRecent(recentDeleted().filter(function (x) { return x.key !== key; }).concat([entry]));
    return entry;
  }
  function forgetDeleted(entry) { saveRecent(recentDeleted().filter(function (x) { return !(x.key === entry.key && x.at === entry.at); })); }
  function restoreDeleted(entry) {
    var cl = clients.clients[entry.key];
    if (!cl) { cl = clients.clients[entry.key] = { name: entry.name, sessions: [] }; }
    entry.sessions.forEach(function (x) {
      if (!x || !x.tool || !x.date) return;
      if (cl.sessions.some(function (y) { return y.tool === x.tool && y.date === x.date; })) return;   // saved again since: that one stays
      cl.sessions.push(x);
      if (CLOUD) CLOUD.putSession(entry.key, cl.name, x);
    });
    cl.sessions = E.sortSessions(cl.sessions);
    saveClients();
    if (CLOUD) CLOUD.sync();
    forgetDeleted(entry);
    if (openModalEl === els.clientsDialog) { syncClientsEdit(); renderClientsList(); }
    refresh();
    if (homeView) renderHome();
    toast('Restored ' + entry.name + '’s record');
  }
  function agoWords(iso) {                            // 'just now', '25 min ago', '3 h ago', 'yesterday', '6 days ago'
    var ms = Date.now() - (Date.parse(iso) || 0), m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : h < 24 ? h + ' h ago' : d === 1 ? 'yesterday' : d + ' days ago';
  }
  function recentDeletedHtml() {
    var list = recentDeleted().slice().reverse();
    if (!list.length) return '';
    return '<div class="cl-recent"><h3>Recently deleted</h3><p class="modal-fine">Kept on this iPad for ' + RECENT_DAYS + ' days.</p><ul class="client-list">' + list.map(function (x) {
      var n = x.sessions.length;
      return '<li><div class="cl-main"><b>' + esc(x.name) + '</b><span>' + n + (n === 1 ? ' session' : ' sessions') + ' · deleted ' + esc(agoWords(x.at)) + (x.by ? ' by ' + esc(x.by) : '') + '</span></div>' +
        '<button type="button" class="quiet cl-restore" data-action="restore-client" data-key="' + esc(x.key) + '" data-at="' + esc(x.at) + '">Restore</button></li>';
    }).join('') + '</ul></div>';
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
    if (pk && homeView && clientsMode === 'manage') { closeModal(false); openClientPage(pk.dataset.key); return; }   // v30: what to do for them; v39: their page
    if (pk) { pickFromDialog(pk.dataset.key); return; }
    var rb = e.target.closest('button[data-action="restore-client"]');   // v48
    if (rb) {
      var hit = recentDeleted().filter(function (x) { return x.key === rb.dataset.key && x.at === rb.dataset.at; })[0];
      if (hit) restoreDeleted(hit);
      return;
    }
    var b = e.target.closest('button[data-action="delete-client"]');
    if (!b || !isAdmin()) return;
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
    var entry = cl ? rememberDeleted(key, JSON.parse(JSON.stringify(cl))) : null;   // v48: Undo, and Recently deleted
    delete clients.clients[key];
    saveClients();
    if (CLOUD && cl) {                                 // v13: a tombstone per session (the data stays in the store, hidden)
      cl.sessions.forEach(function (x) { CLOUD.tombstone(key, cl.name, x); });
      CLOUD.sync();
    }
    syncClientsEdit();
    renderClientsList();
    refresh();
    if (homeView && clientPage) renderHome();          // v39: their page, if it was open, gives way to Home
    toast('Deleted ' + name + '’s record', entry ? { label: 'Undo', run: function () { restoreDeleted(entry); } } : undefined);
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

  // ------------------------------------------------------------------ v46: each practitioner their own login
  // The switcher ("Who's using this iPad?") lists everyone signed in on this device: tap your name, type your PIN and the
  // app is yours (another person's work in progress is kept under their own login; a change of person reloads the page
  // so nothing of theirs is left on screen). It shows when the iPad is locked (⋯ › Lock, or 10 minutes untouched while
  // the active person has a PIN), when the active person signs out while others remain, and on opening when locked.
  var LOCK_MS = 10 * 60000, LAST_IN = 'bh-athlete-report-lastinput-v1', PIN_TRIES = 5;
  var who = { step: 'list', uid: '', tries: 0, msg: '', busy: false }, locked = false, lastIn = 0, lastInSaved = 0, startedAs = '';
  function initials(name) {
    var parts = clean1(name).split(' ').filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function roleWord(a) { return a.staff ? (a.role === 'admin' ? 'Admin' : 'Practitioner') : 'Clinic login'; }
  function whoRow(a, extra) {
    return '<button type="button" class="who-row" data-who="pick:' + esc(a.uid) + '"' + (extra || '') + '><span class="who-av" aria-hidden="true">' + esc(initials(a.name || a.email)) + '</span>' +
      '<span class="who-text"><b>' + esc(a.name || a.email) + '</b><small>' + esc(roleWord(a) + (a.active ? ' · signed in now' : a.hasPin ? ' · PIN' : ' · password')) + '</small></span>' + HOME_ICON.go + '</button>';
  }
  function whoHtml() {
    var list = CLOUD.accounts(), cur = list.filter(function (a) { return a.uid === who.uid; })[0];
    var html = '<svg class="signin-logo" viewBox="0 0 470 114.45" aria-hidden="true" focusable="false"><use href="#brandLogo" xlink:href="#brandLogo"/></svg>';
    if (who.step === 'pin' && cur) {
      html += '<h1 id="whoTitle">' + esc(cur.name || cur.email) + '</h1><p class="signin-lead">' + (cur.hasPin ? 'Type your PIN to carry on.' : 'No PIN on this iPad yet: sign in with your password.') + '</p>' +
        '<form class="who-pin" id="whoPinForm" novalidate>' +
        (cur.hasPin ? '<label class="f" for="whoPin"><span>PIN</span><input id="whoPin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" enterkeyhint="go"></label>' : '') +
        '<p class="signin-err" id="whoErr" role="alert"' + (who.msg ? '' : ' hidden') + '>' + esc(who.msg) + '</p>' +
        (cur.hasPin ? '<button class="primary" id="whoGo" type="submit"' + (who.busy ? ' disabled' : '') + '>Continue</button>' : '') +
        '<div class="who-pin-acts"><button type="button" class="quiet" data-who="password:' + esc(cur.uid) + '">' + (cur.hasPin ? 'Use my password instead' : 'Sign in with my password') + '</button></div>' +
        // v49: someone else picks up the iPad: the way to their own login is said in words (until v48 "‹ Back", then "Someone else")
        '<button type="button" class="ghost who-not" data-who="list">Not ' + esc(firstName(cur.name || cur.email)) + '? Switch practitioner</button></form>';
    } else {
      html += '<h1 id="whoTitle">Who’s using this iPad?</h1><p class="signin-lead">Tap your name. Your own work in progress, favourites and name on the results come with you.</p>' +
        '<div class="who-list">' + list.map(function (a) { return whoRow(a); }).join('') +
        '<button type="button" class="who-row who-other" data-who="other"><span class="who-av" aria-hidden="true">+</span><span class="who-text"><b>Someone else</b><small>Sign in with your email and password</small></span>' + HOME_ICON.go + '</button></div>' +
        '<p class="signin-err" id="whoErr" role="alert"' + (who.msg ? '' : ' hidden') + '>' + esc(who.msg) + '</p>' +
        '<p class="who-foot">Everyone here shares the clinic’s records. Each person’s unfinished screens stay with their own login.</p>';
    }
    return html;
  }
  function renderWho() {
    var card = $('whoCard');
    if (!card) return;
    card.innerHTML = whoHtml();
    var pin = $('whoPin');
    if (pin) focusQuiet(pin); else focusQuiet($('whoTitle'));
  }
  function showWho(msg, step, uid) {
    closeMenu(false);
    closeModal(false);
    if (!els.sheet.hidden) closeReport();
    locked = true;
    who = { step: step || 'list', uid: uid || '', tries: 0, msg: msg || '', busy: false };
    document.documentElement.classList.add('locked');
    els.signin.hidden = true;
    $('whoPanel').hidden = false;
    renderWho();
    measureBar();
    window.scrollTo(0, 0);
  }
  function hideWho() {
    locked = false;
    document.documentElement.classList.remove('locked');
    $('whoPanel').hidden = true;
  }
  function lockApp() {                                 // ⋯ › Lock this iPad, or left alone: the switcher, this person's work kept
    if (!CLOUD || !CLOUD.signedIn()) return;
    clearTimeout(saveTimer);
    try { followReport(); localStorage.setItem(draftKey(), draftJson()); } catch (e) { /* storage unavailable */ }
    var a = CLOUD.account();
    showWho('', a && CLOUD.accounts().length === 1 ? 'pin' : 'list', a ? a.uid : '');
  }
  function noteInput() {
    lastIn = Date.now();
    if (lastIn - lastInSaved > 15000) { lastInSaved = lastIn; try { localStorage.setItem(LAST_IN, String(lastIn)); } catch (e) { /* storage unavailable */ } }
  }
  function idleLockDue() {
    if (!CLOUD || locked || !CLOUD.signedIn() || !state) return false;
    var a = CLOUD.account();
    if (!a || !a.hasPin) return false;                 // nothing to lock behind: the PIN is what lets them back in quickly
    if (updBusy()) return false;                       // Claude or an upload still working for this person
    return Date.now() - lastIn > LOCK_MS;
  }
  function lockIfIdle() { if (idleLockDue()) lockApp(); }
  // the switcher's taps
  function whoEnter(uid) {                             // the PIN (or the password) was right: this person's app
    var a = CLOUD.account();
    if (a && a.uid === uid) {                          // the same person: carry on where they were
      hideWho();
      noteInput();
      renderMenuAccount();
      measureBar();
      CLOUD.sync({ throttle: true });
      focusQuiet(homeView ? $('homeHello') : els.entry);
      if (pinNeeded()) openPinDialog(false);           // v49
      return;
    }
    who.busy = true; renderWho();
    CLOUD.switchTo(uid).then(function () { reloadForSwitch(); }, function (err) {
      who.busy = false; who.msg = 'That login no longer works here: sign in again.'; who.step = 'list'; renderWho();
    });
  }
  function reloadForSwitch() {                         // another person's app: a fresh start on Home with their own draft
    try { localStorage.setItem(LAST_IN, String(Date.now())); } catch (e) { /* storage unavailable */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* keep the address */ }
    location.reload();
  }
  function whoPinSubmit(e) {
    if (e) e.preventDefault();
    var uid = who.uid, pin = ($('whoPin') || {}).value || '';
    if (!uid || who.busy) return;
    if (!CLOUD.pinOk(pin)) { who.msg = 'Type your PIN (4 to 8 digits).'; renderWho(); return; }
    who.busy = true;
    CLOUD.checkPin(uid, pin).then(function (ok) {
      who.busy = false;
      if (ok) { who.tries = 0; who.msg = ''; whoEnter(uid); return; }
      who.tries++;
      if (who.tries >= PIN_TRIES) { who.msg = 'Five wrong PINs. Sign in with your password instead.'; renderWho(); var b = $('whoCard').querySelector('[data-who^="password:"]'); if (b) focusQuiet(b); return; }
      who.msg = 'That PIN isn’t right.'; renderWho();
      var p = $('whoPin'); if (p) { p.value = ''; focusQuiet(p); }
    });
  }
  function whoPassword(uid) {                          // the sign-in card for this person (their email filled in)
    var a = CLOUD.accounts().filter(function (x) { return x.uid === uid; })[0];
    hideWho();
    showSignIn('');
    if (a) { els.signinEmail.value = a.email; focusQuiet(els.signinPassword); }
    $('signinBack').hidden = false;
  }
  function onWhoClick(e) {
    var b = e.target.closest('button[data-who]');
    if (!b) return;
    var k = b.dataset.who, i = k.indexOf(':'), kind = i < 0 ? k : k.slice(0, i), arg = i < 0 ? '' : k.slice(i + 1);
    if (kind === 'pick') {
      var a = CLOUD.accounts().filter(function (x) { return x.uid === arg; })[0];
      if (!a) return;
      if (!a.hasPin) { whoPassword(arg); return; }
      who.step = 'pin'; who.uid = arg; who.msg = ''; who.tries = 0; renderWho();
    } else if (kind === 'password') whoPassword(arg);
    else if (kind === 'list') { who.step = 'list'; who.uid = ''; who.msg = ''; renderWho(); }
    else if (kind === 'other') { hideWho(); showSignIn(''); els.signinEmail.value = ''; $('signinBack').hidden = false; focusQuiet(els.signinEmail); }
  }
  // ---- the PIN dialog
  // v49 (Matthew: a PIN required at first sign-in for staff logins): a practitioner's own login without a PIN is asked for
  // one at sign-in and whenever the app opens, with no "Not now" (Escape and a tap outside don't close it either); the
  // only other way out is Sign out instead. The shared clinic login keeps "Not now".
  var pinFirst = false, pinRequired = false;
  function pinNeeded() { var a = CLOUD && CLOUD.signedIn() ? CLOUD.account() : null; return !!(a && a.staff && !a.hasPin); }
  function openPinDialog(first) {
    pinFirst = !!first;
    var a = CLOUD.account();
    pinRequired = pinNeeded();
    $('pinTitle').textContent = pinRequired ? 'Set your PIN' : a && a.hasPin ? 'Change your PIN' : 'Set a PIN for this iPad';
    $('pinLead').textContent = pinRequired
      ? (first ? 'You’re in. ' : '') + 'Your login needs a PIN on these iPads: it switches to you in a second and locks the iPad after 10 minutes untouched, so nobody else works under your name. 4 to 8 digits; keep it to yourself.'
      : (first ? 'You’re in. ' : '') + 'On a shared iPad, a PIN switches to you in a second and locks the iPad after 10 minutes untouched. 4 to 8 digits; keep it to yourself.';
    $('pinBox').value = ''; $('pinBox2').value = '';
    $('pinErr').hidden = true;
    $('pinCancel').textContent = pinRequired ? 'Sign out instead' : first ? 'Not now' : 'Cancel';
    openModal($('pinDialog'), $('pinBox'));
  }
  function savePin() {
    var a = $('pinBox').value, b = $('pinBox2').value, err = $('pinErr');
    if (!CLOUD.pinOk(a)) { err.textContent = 'A PIN is 4 to 8 digits.'; err.hidden = false; $('pinBox').focus(); return; }
    if (a !== b) { err.textContent = 'The two PINs don’t match.'; err.hidden = false; $('pinBox2').focus(); return; }
    CLOUD.setPin(a).then(function () {
      pinRequired = false;
      closeModal();
      renderMenuAccount();
      noteInput();
      toast('PIN saved: ⋯ › Lock this iPad, or 10 minutes untouched, brings up the switcher');
      CLOUD.sync();                                    // now, not throttled: another iPad reads the PIN from their own document
    }, function () { err.textContent = 'That PIN couldn’t be saved.'; err.hidden = false; });
  }
  // ---- v49: professions (the Team page's choice). A clinician's profession is looked up by the name in the report's
  // Clinician box (any member of the team, so a report made again from the record says it too); Claude is told the
  // signed-in person's
  var PROFESSIONS = ['Physiotherapist', 'Exercise physiologist', 'Exercise scientist'];
  function profOf(name) {
    var k = clean1(name).toLowerCase();
    if (!k || !CLOUD || !CLOUD.staffList) return '';
    var hit = CLOUD.staffList().filter(function (o) { return o.active !== false && clean1(o.name).toLowerCase() === k && PROFESSIONS.indexOf(o.profession) >= 0; })[0];
    return hit ? hit.profession : '';
  }
  function withProf(name) { var n = clean1(name), p = profOf(n); return n && p ? n + ', ' + p : n; }   // 'Matthew, Physiotherapist'
  function myProfession() { var a = CLOUD && CLOUD.signedIn() ? CLOUD.account() : null; return a && PROFESSIONS.indexOf(a.profession) >= 0 ? a.profession : ''; }
  function profLine() {                                // for Claude: who it is writing for (never a name)
    var p = myProfession();
    return p ? 'The clinician using this is ' + (/^[AEIOU]/.test(p) ? 'an ' : 'a ') + p.toLowerCase() + '.' : '';
  }
  function addProfLine(payload) { var pl = profLine(); if (!pl) return payload; var i = payload.indexOf('\n'); return i < 0 ? payload + '\n' + pl : payload.slice(0, i + 1) + pl + '\n' + payload.slice(i + 1); }
  // ---- the Team page (⋯ › Team; admins): everyone with a login, add one, switch one off
  var team = { busy: false, msg: '', editUid: '' };
  function teamHtml() {
    var a = CLOUD.account(), list = CLOUD.staffList(), admin = !!(a && a.admin);
    var html = subHeadHtml('Team', 'Everyone who can sign in. Each person has their own login and PIN and their own work in progress.', 'data-home="back"', 'Home');
    if (!admin) return html + '<p class="client-none bld-none">Only an admin can add people or change the team. Ask one of the admins listed below.</p>' + teamListHtml(list, a, false);
    html += '<section class="bld-sec" aria-labelledby="teamListH"><div class="bld-head"><h2 id="teamListH">People</h2><button type="button" class="primary" data-team="add">+ Add a practitioner</button></div>' +
      '<p class="team-lead">Adding someone creates their login and emails them a link to set their own password (the email is called “Reset your password for BASE Health Report”; it can land in Junk). If they forget it, “Forgot your password?” on the sign-in screen emails them a new link: nothing for you to do.</p>' +
      (team.msg ? '<p class="ai-err" role="alert">' + esc(team.msg) + '</p>' : '') + teamListHtml(list, a, true) + '</section>';
    if (a && !a.staff) html += '<p class="team-lead">You’re using the shared clinic login. Add yourself with your own email to get your own login; the shared one keeps working until everyone has moved across.</p>';
    return html;
  }
  function teamListHtml(list, a, admin) {
    if (!list.length) return '<p class="client-none bld-none">Nobody has their own login yet. + Add a practitioner starts with you.</p>';
    return '<div class="tpl-list bld-list">' + list.map(function (o) {
      var me = a && a.uid === o.id, off = o.active === false, nm = esc(o.name || o.email);
      return '<div class="tpl-row team-row' + (off ? ' off' : '') + '" data-uid="' + esc(o.id) + '"><div class="tpl-main"><b>' + nm + (me ? '<span class="cp-tag cur">You</span>' : '') +
        '<span class="cp-tag">' + (o.role === 'admin' ? 'Admin' : 'Practitioner') + '</span>' + (off ? '<span class="cp-tag warn">Switched off</span>' : '') + '</b><span>' + esc((o.profession ? o.profession + ' · ' : '') + (o.email || '')) + '</span></div>' +   // v49: + profession
        (admin ? '<div class="tpl-acts"><button type="button" class="ghost" data-team="edit:' + esc(o.id) + '">Edit<span class="vh"> ' + nm + '</span></button>' +
          (off ? '<button type="button" class="quiet" data-team="on:' + esc(o.id) + '">Switch on</button>'
            : '<button type="button" class="quiet" data-team="email:' + esc(o.id) + '">Email password link</button>' + (me ? '' : '<button type="button" class="quiet tpl-del" data-team="off:' + esc(o.id) + '">Switch off</button>')) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function openTeamDialog(uid) {
    var o = uid ? CLOUD.staffList().filter(function (x) { return x.id === uid; })[0] : null;
    if (uid && !o) return;
    team.editUid = uid || '';
    $('teamTitle').textContent = o ? 'Edit ' + (o.name || o.email) : 'Add a practitioner';
    $('teamLead').textContent = o ? 'Their name and profession go on the results they save; an admin can also manage the team and the Claude key.' : 'They get an email with a link to set their own password, then sign in on any iPad with their email.';
    $('tmName').value = o ? o.name || '' : '';
    $('tmEmail').value = o ? o.email || '' : '';
    $('tmEmailF').hidden = !!o;
    $('tmRole').value = o && o.role === 'admin' ? 'admin' : 'practitioner';
    $('tmProf').value = o && PROFESSIONS.indexOf(o.profession) >= 0 ? o.profession : '';   // v49
    $('tmErr').hidden = true;
    $('tmSave').textContent = o ? 'Save' : 'Add and email them';
    $('tmSave').disabled = false;
    openModal($('teamDialog'), $('tmName'));
  }
  function teamFail(msg, id) { var p = $('tmErr'); p.textContent = msg; p.hidden = false; $('tmSave').disabled = false; $('tmSave').textContent = team.editUid ? 'Save' : 'Add and email them'; if (id) $(id).focus(); }
  function teamSave() {
    var name = clean1($('tmName').value), email = $('tmEmail').value.trim().toLowerCase(), role = $('tmRole').value, prof = PROFESSIONS.indexOf($('tmProf').value) >= 0 ? $('tmProf').value : '';   // v49
    if (!name) return teamFail('Add their name.', 'tmName');
    if (!team.editUid && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return teamFail('That email doesn’t look right.', 'tmEmail');
    if (navigator.onLine === false) return teamFail('You’re offline. Connect to the internet to change the team.', null);
    $('tmSave').disabled = true; $('tmSave').textContent = team.editUid ? 'Saving…' : 'Adding…';
    var p = team.editUid ? CLOUD.staffSet(team.editUid, { name: name, role: role, profession: prof }) : CLOUD.staffAdd({ name: name, email: email, role: role, profession: prof });
    p.then(function (r) {
      closeModal();
      team.msg = '';
      if (homeView && homeSub === 'team') renderHome();
      toast(team.editUid ? 'Saved ' + name : (r && r.emailed ? 'Added ' + name + ': they’ve been emailed a link to set their password' : 'Added ' + name + ', but the email didn’t send: use Email password link'));
      renderMenuAccount();
    }, function (err) {
      var c = err && err.code;
      teamFail(c === 'EMAIL_EXISTS' ? 'That email already has a login. If they were on the team before, find them in the list and Switch on.'
        : c === 'INVALID_EMAIL' ? 'That email doesn’t look right.' : c === 'denied' ? 'The clinic store refused this: only an admin can change the team (and the store’s rules must allow it).'
        : c === 'network' ? 'No connection: try again in a moment.' : c === 'OPERATION_NOT_ALLOWED' || c === 'ADMIN_ONLY_OPERATION' ? 'Creating logins is switched off in the Firebase console (Authentication › Sign-in method › Email/Password, and Settings › User actions › Enable create).'
        : 'That didn’t work (' + (err && err.message ? err.message : c || 'unknown error') + ').', null);
    });
  }
  function onTeamClick(k) {
    var i = k.indexOf(':'), kind = i < 0 ? k : k.slice(0, i), arg = i < 0 ? '' : k.slice(i + 1);
    var a = CLOUD.account();
    if (!a || !a.admin) return;
    if (kind === 'add') { openTeamDialog(''); return; }
    if (kind === 'edit') { openTeamDialog(arg); return; }
    if (navigator.onLine === false) { toast('You’re offline: connect to change the team'); return; }
    var o = CLOUD.staffList().filter(function (x) { return x.id === arg; })[0];
    if (!o) return;
    if (kind === 'off' || kind === 'on') {
      CLOUD.staffSet(arg, { active: kind === 'on' }).then(function () {
        team.msg = '';
        if (homeView && homeSub === 'team') renderHome();
        toast(kind === 'on' ? (o.name || o.email) + ' can sign in again' : (o.name || o.email) + ' can’t sign in any more (their saved results stay)');
      }, function (err) { team.msg = 'That didn’t work' + (err && err.message ? ' (' + err.message + ')' : '') + '.'; renderHome(); });
    } else if (kind === 'email') {
      CLOUD.sendReset(o.email).then(function () { toast('Emailed ' + o.email + ' a link to set a password'); },
        function (err) { toast('The email didn’t send' + (err && err.message ? ' (' + err.message + ')' : '')); });
    }
  }
  function wireWho() {
    try { lastIn = +localStorage.getItem(LAST_IN) || 0; } catch (e) { lastIn = 0; }
    ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, noteInput, { capture: true, passive: true }); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') lockIfIdle(); });
    setInterval(lockIfIdle, 30000);
    var panel = $('whoPanel');
    panel.addEventListener('click', onWhoClick);
    panel.addEventListener('submit', whoPinSubmit);
    $('pinCancel').addEventListener('click', function () {
      if (pinRequired) { pinRequired = false; closeModal(false); askSignOut(); return; }   // v49: the only way past a required PIN
      closeModal(); if (pinFirst) toast('You can set a PIN any time: ⋯ › Your PIN');
    });
    $('pinSave').addEventListener('click', savePin);
    $('pinBox2').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); savePin(); } });
    $('pinBox').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('pinBox2').focus(); } });
    $('tmCancel').addEventListener('click', function () { closeModal(); });
    $('tmSave').addEventListener('click', teamSave);
    ['tmName', 'tmEmail'].forEach(function (id) { $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (id === 'tmName' && !$('tmEmailF').hidden) $('tmEmail').focus(); else teamSave(); } }); });
    [$('pinDialog'), $('teamDialog')].forEach(function (d) { d.addEventListener('click', function (e) { if (e.target === d && !(pinRequired && d === $('pinDialog'))) closeModal(); }); });
    var chip = $('whoChip');                           // v49: the initials in the app bar: the switcher (this person's work kept)
    if (chip) chip.addEventListener('click', function () { lockApp(); });
    var sw = $('switchItem'), pi = $('pinItem'), tm = $('teamItem'), back = $('signinBack'), forgot = $('signinForgot');
    if (sw) sw.addEventListener('click', menuAction(function () { lockApp(); }));
    if (pi) pi.addEventListener('click', menuAction(function () { openPinDialog(false); }));
    if (tm) tm.addEventListener('click', menuAction(function () { openHomeSub('team'); CLOUD.sync({ throttle: true }); }));
    if (back) back.addEventListener('click', function () { els.signin.hidden = true; document.documentElement.classList.remove('signed-out'); showWho(''); });
    if (forgot) forgot.addEventListener('click', forgotPassword);
  }
  function forgotPassword() {
    var email = els.signinEmail.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { signinError('Type your email first, then tap Forgot your password?'); els.signinEmail.focus(); return; }
    if (navigator.onLine === false) { signinError(signinMessage({ code: 'network' })); return; }
    signinError('');
    $('signinForgot').disabled = true;
    CLOUD.sendReset(email).then(function () {
      $('signinForgot').disabled = false;
      signinError('');
      toast('If ' + email + ' has a login, a link to set a new password is on its way (“Reset your password for BASE Health Report”)');
    }, function (err) {
      $('signinForgot').disabled = false;
      var c = err && err.code;
      signinError(c === 'EMAIL_NOT_FOUND' ? 'There’s no login with that email. Ask an admin to add you in ⋯ › Team.' : c === 'network' ? signinMessage(err) : 'The email couldn’t be sent (' + (err && err.message ? err.message : c) + ').');
    });
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
    if (c === 'not-staff' || c === 'inactive' || c === 'store') return err.message;   // v46: a login the team list doesn't have, switched off, or the store not answering
    if (c === 'USER_DISABLED') return 'This login has been disabled.';
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
    if (clientPage) { clientPage = null; if (homeView && state) renderHome(); }   // v39: Home itself after the next sign-in
    clearLogBook();                                    // v40: the training logs read go with the login
    document.documentElement.classList.add('signed-out');
    els.signin.hidden = false;
    $('signinNameF').hidden = true;                    // v46: asked only after the shared clinic login signs in without a name
    els.signinName.value = '';
    els.signinPassword.value = '';
    $('signinBack').hidden = !(CLOUD.accounts().length);   // v46: others signed in on this iPad: back to the switcher
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
    // v46: the shared clinic login signed in a moment ago and is now giving the name it goes by on this device
    if (!$('signinNameF').hidden && CLOUD.signedIn()) {
      if (!name) { signinError('Add your name — it’s shown on the results you save.'); els.signinName.focus(); return; }
      CLOUD.setUserName(name);
      enterApp('');
      return;
    }
    if (!email) { signinError('Type your email.'); els.signinEmail.focus(); return; }
    if (!pw) { signinError('Type the password.'); els.signinPassword.focus(); return; }
    if (navigator.onLine === false) { signinError(signinMessage({ code: 'network' })); return; }
    signinError('');
    signinBusySet(true);
    CLOUD.signIn(email, pw).then(function (acc) {
      els.signinPassword.value = '';
      if (startedAs && startedAs !== acc.uid) { reloadForSwitch(); return; }   // v46: someone else was using this iPad: their app goes, this person's loads
      if (!acc.staff && !userName()) {               // the shared clinic login: who is this?
        signinBusySet(false);
        $('signinNameF').hidden = false;
        els.signinBtn.textContent = 'Continue';
        focusQuiet(els.signinName);
        return;
      }
      enterApp(acc.staff && !acc.hasPin ? 'pin' : '');
    }, function (err) {
      signinBusySet(false);
      signinError(signinMessage(err));
      focusQuiet(err && err.code === 'network' ? els.signinBtn : els.signinPassword);
    });
  }
  // v46: signed in (the first person on this iPad, or the shared login after its name): the app with this person's draft
  function enterApp(then) {
    var was = '';
    clients = CLOUD.cache;
    libVer++;                                          // v15: the store's library and templates come with the new cache
    legacyAsked = false;
    startedAs = CLOUD.account().uid;
    var mine = loadDraft();                            // this person's own draft (a staff login's key differs from the shared one's)
    if (mine) { state = mine; tidyState(); } else if (draftKey() !== STORE) { TOOLS.forEach(function (t) { state[t] = freshTool(t); }); state.ex = freshEx(); tidyState(); }
    fillPractitioner(was);
    showApp();
    render();
    if (homeView) renderHome();
    window.scrollTo(0, 0);
    noteInput();
    CLOUD.sync();
    if (then === 'pin') openPinDialog(true);
  }
  function togglePassword() {
    var show = els.signinPassword.type === 'password';
    els.signinPassword.type = show ? 'text' : 'password';
    els.signinShow.textContent = show ? 'Hide' : 'Show';
    els.signinShow.setAttribute('aria-pressed', String(show));
    focusQuiet(els.signinPassword);
  }
  // the ⋯ menu's account line and items (stamped from the template in cloud mode)
  // v48: who may delete a client or move the records in and out (Back up / Restore): an admin, or the shared clinic login;
  // with no clinic store (local mode) the iPad's one user
  function isAdmin() { var a = CLOUD && CLOUD.account(); return !CLOUD || !!(a && a.admin); }
  function renderMenuAccount() {
    var line = $('menuAccount'), a = CLOUD.account(), chip = $('whoChip');
    if (chip) {                                        // v49: who is working, on every page (the shared login: the name typed on this iPad)
      var nm = a ? (a.staff ? a.name || a.email : userName() || 'Clinic login') : '';
      chip.hidden = !a;
      if (a) {
        chip.querySelector('.who-av').textContent = initials(nm);
        chip.setAttribute('aria-label', nm + ' is signed in: switch practitioner or lock this iPad');
        chip.title = nm + ' · switch practitioner';
      }
    }
    if (!line) return;
    var adm = isAdmin();                               // v48: Back up / Restore are an admin's
    ['adminSep', 'clientsBackup', 'restoreItem'].forEach(function (id) { var el = $(id); if (el) el.hidden = !adm; });
    // v46: a staff login goes by its Team name and role; the shared clinic login by the name typed on this device
    line.innerHTML = a ? (a.staff ? 'Signed in as <b>' + esc(a.name || a.email) + '</b> · ' + esc(a.email) + ' · ' + (a.role === 'admin' ? 'Admin' : 'Practitioner')
      : 'Signed in as <b>' + esc(a.email) + '</b> · ' + esc(userName() || 'no name yet') + ' (the shared clinic login)') : '';
    var n = CLOUD.accounts().length;
    var sw = $('switchItem'), pi = $('pinItem'), nm = $('nameItem'), tm = $('teamItem'), so = $('signOutItem');
    if (sw) { sw.hidden = !a; sw.querySelector('span').textContent = n > 1 ? 'Switch practitioner…' : 'Lock this iPad'; }
    if (pi) { pi.hidden = !a; pi.querySelector('span').textContent = a && a.hasPin ? 'Change your PIN…' : 'Set a PIN…'; }
    if (nm) nm.hidden = !a || a.staff;
    if (tm) tm.hidden = !a || !a.admin;
    if (so) so.querySelector('span').textContent = n > 1 ? 'Sign out of this iPad' : 'Sign out';
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
    else if (homeView) renderHome();                   // v30: the greeting uses the name
    toast(nm === was ? 'Name unchanged' : 'Your name is now ' + nm);
  }
  function askSignOut() {
    var n = CLOUD.pendingCount(), ch = +(CLOUD.status().changes || 0);   // v15: library and template changes wait too
    if (!n && !ch) { signOutNow(); return; }
    els.signOutText.textContent = (n && ch ? waitingWords(n, ch) + ' are' : n ? n + (n === 1 ? ' result is' : ' results are') : ch + (ch === 1 ? ' library change is' : ' library changes are')) +
      ' still waiting to upload — sign out anyway?';
    // v49: kept signed in from the required PIN (Cancel, Escape, the backdrop): back to the PIN
    openModal(els.signOutDialog, els.signOutCancel, function () { if (pinNeeded()) { setTimeout(function () { if (pinNeeded() && !openModalEl) openPinDialog(false); }, 0); return true; } return false; });
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
      if (homeView && (clientPage || homeSub)) renderHome();   // v39: a client's page shows what another device saved; v41: a button's page too (redrawn only if it changed)
      else if (homeView) renderCheckins();             // v40: and Home its check-ins
    } else if (evt.kind === 'status') {
      renderCloudBar();
      if (!els.sheet.hidden) renderPhoneCard();        // v35: the link's state (sending, waiting, refused, working)
    } else if (evt.kind === 'uploaded') {
      renderCloudBar();
      toast('Uploaded ' + evt.n + (evt.n === 1 ? ' waiting result' : ' waiting results'));
    } else if (evt.kind === 'settings') {
      applyCloudKey(evt.key);
    } else if (evt.kind === 'checkins') {              // v40: a check-in marked as seen on another device
      if (state && homeView) { if (clientPage) renderHome(); else renderCheckins(); }
    } else if (evt.kind === 'library' || evt.kind === 'templates' || evt.kind === 'batteries') {   // v15: another device changed the library or a template; v36: or a battery
      libVer++;
      if (!state) return;
      if (evt.kind === 'library') afterLibChange(); else if (evt.kind === 'batteries') afterBatChange(); else afterTplChange();
    } else if (evt.kind === 'synced') {
      libVer++;                                        // (the merged library is rebuilt from the cache on next use)
      if (state) maybeLegacyPrompt();
    } else if (evt.kind === 'signout') {
      libVer++;                                        // the store's library and templates went with the cache
      if (evt.others) showWho(evt.message || '');      // v46: others are still signed in on this iPad
      else showSignIn(evt.message || '');
    } else if (evt.kind === 'auth') {
      libVer++;
      renderMenuAccount();                             // v46: a name or role changed on the Team page
      if (state && homeView && !locked) renderHome();
    } else if (evt.kind === 'staff') {                 // v46: the team changed (here or on another device)
      if (state && homeView && homeSub === 'team') renderHome();
      renderMenuAccount();
    } else if (evt.kind === 'accounts') {
      if (locked) renderWho();
      renderMenuAccount();
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
    wireWho();                                         // v46
    if (CLOUD.signedIn()) {
      startedAs = CLOUD.account().uid;
      showApp();
      CLOUD.sync();
      if (idleLockDue()) lockApp();                    // v46: left alone (or closed) for 10 minutes: the switcher first
      else if (pinNeeded()) openPinDialog(false);      // v49: a staff login from before v49 without a PIN: one now
      else if (!CLOUD.account().staff && !userName()) openNameDialog();   // the shared login without a name yet
    } else if (CLOUD.accounts().length) showWho('');   // v46: nobody active, but people are signed in on this iPad
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
    // v42: Ankle-GO's rows, points and cut-offs (without them the battery is left out rather than the app failing to open)
    var ankle = fetchJson('ankle_go.json').catch(function () { return null; });
    Promise.all([fetchJson('norms.json'), fetchJson('hamstring_norms.json'), fetchJson('acl_norms.json'), fetchJson('strength_norms.json'), ai, explain, starter, guide, ankle]).then(function (r) {
      DATA.screen = r[0]; DATA.ham = r[1]; DATA.acl = r[2]; DATA.str = r[3]; DATA.ai = r[4];
      var ag = r[8];
      DATA.ankle = ag && Array.isArray(ag.groups) && Array.isArray(ag.items) && ag.score && Array.isArray(ag.bands) ? ag : null;
      if (!DATA.ankle && TOOLS.indexOf('ankle') >= 0) TOOLS.splice(TOOLS.indexOf('ankle'), 1);
      DATA.guide = typeof r[7] === 'string' && r[7].indexOf('<') !== 0 ? r[7] : '';   // (an HTML 404 page from an older cache is not a guide)
      DATA.explain = r[5] && r[5].metrics && typeof r[5].metrics === 'object' ? r[5] : { metrics: {} };
      localLib = loadItems(LIB_STORE);                 // v15: local mode's library and templates (cloud mode reads the store's cache)
      localTpl = loadItems(TPL_STORE);
      localBat = loadItems(BAT_STORE);                 // v36: local mode's saved batteries
      setStarter(r[6]);
      clients = loadClients();
      testsPref = loadTestsPref();
      state = loadDraft() || { v: 1, tool: 'screen', screen: freshTool('screen'), str: freshTool('str'), ham: freshTool('ham'), acl: freshTool('acl'), ankle: freshTool('ankle'), ex: freshEx() };
      tidyState();
      if (CLOUD && CLOUD.signedIn()) fillPractitioner('');   // v13: blank Clinician boxes take this device's practitioner name
      els.entry.addEventListener('input', onInput);
      els.entry.addEventListener('change', onChange);
      els.entry.addEventListener('click', onClick);
      els.entry.addEventListener('keydown', onKey);
      els.summary.addEventListener('click', onClick);
      els.summary.addEventListener('change', function (e) {   // v32: Large print (the handout panel); v34: Exercise photos
        if (e.target.id === 'exLarge') state.ex.large = e.target.checked;
        else if (e.target.id === 'exPhotos') state.ex.photos = e.target.checked;
        else if (e.target.id === 'exPhone') {          // v35: and the line under it
          state.ex.phone = e.target.checked;
          var pf = $('exPhoneFine');
          if (pf) pf.textContent = exPhoneFine();
        }
        else return;
        saveDraft();
        keepAwake();
      });
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
      els.checkDialog.addEventListener('click', onCheckClick);   // v48: the check before Create report
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
      [els.clearDialog, els.aiDialog, els.clientsDialog, els.testsDialog, els.homeDialog, els.homeAsk, els.homeClientDialog, els.checkDialog].forEach(function (d) {   // v30: + the two Home dialogs; v48: + the check
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
      wireCustomDialogs();                             // v36: Choose tests and Saved batteries
      els.back.addEventListener('click', closeReport);
      els.sheetExBtn.addEventListener('click', addProgramFromReport);   // v20
      $('sheetPhone').addEventListener('click', function (e) {          // v35: the program on the client's phone
        var b = e.target.closest('button');
        if (!b) return;
        if (b.id === 'phoneSend') phoneSendNow();
        else if (b.id === 'phoneCode') openPhoneCode();
        else if (b.id === 'phoneShare') phoneShareLink();
        else if (b.id === 'phoneCopy') phoneCopyLink();
        else if (b.id === 'phoneStop') phoneStop();
      });
      $('phoneQrDone').addEventListener('click', function () { closeModal(); });
      $('phoneDialog').addEventListener('click', function (e) { if (e.target === $('phoneDialog')) closeModal(); });
      els.suggestPlan.addEventListener('click', onPlanClick);            // v23: the Suggest from the report dialog
      els.suggestPlan.addEventListener('change', onPlanChange);          // v24: its condition menu; v27: the notes box
      els.suggestPlan.addEventListener('input', onPlanInput);            // v27: the notes for Claude
      els.suggestCancel.addEventListener('click', function () { closeModal(); });
      els.suggestGo.addEventListener('click', runExSuggest);
      els.photoAskFields.addEventListener('click', onPhotoAskClick);     // v33: the form before Claude reads the exercise page
      els.photoAskFields.addEventListener('input', onPhotoAskInput);
      els.photoAskFields.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'paInjury') { e.preventDefault(); e.target.blur(); } });
      els.photoAskCancel.addEventListener('click', function () { closeModal(); });
      els.photoAskSkip.addEventListener('click', function () { photoAskDone(false); });
      els.photoAskGo.addEventListener('click', function () { photoAskDone(true); });
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
      wireHome();                                      // v30
      if (!homeView) document.documentElement.classList.remove('home-on');   // #continue: where the app left off
      render();
      if (homeView) syncTabs();
      wireUpdate();                                    // v44: a newer version: by itself on Home, else the bar's Update
      if (CLOUD) initCloud();                          // v13: the sign-in card while signed out, else the first sync
    }).catch(function (err) {
      document.documentElement.classList.remove('home-on');   // v30: the message shows in the workspace
      els.entry.innerHTML = '<section class="card error-card"><div class="card-head"><h2>Norms not found</h2></div>' +
        '<p>The app couldn’t load its norms files (' + esc(err.message) + '). Check that norms.json, strength_norms.json, hamstring_norms.json and acl_norms.json sit next to index.html, then reload. ' +
        'If you are offline, open the app once while online so it can save a copy.</p></section>';
      try { wireUpdate(); } catch (e) { /* the page above says what to do */ }   // v44: a fixed version can still arrive
    });
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline copy unavailable */ }); });
  }
  start();
})();
