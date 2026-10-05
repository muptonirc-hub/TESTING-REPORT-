/* BASE Health Noosa: a client's exercise program on their phone (v35). See index.html for what this page is for.
   The key after # names the shared copy in the clinic store (shared/<key>); the store hands it over until its expiry date
   and refuses it after that or once the clinic stops sharing. The last copy is kept on the phone (localStorage), so the
   program opens without a connection; a link that has ended removes it. Everything shown is escaped; only the clinic's
   own file addresses (Cloud Storage) are used for photos and videos, and only http(s) links for a video link.
   v3 (6 Oct): the training log. Matthew: "there needs to be a link from the patients program on their phone back to us -
   they can log their workouts and it shows on our end - the load sets and reps need to be editable - think long term rehab
   or time between appointments - progressive overload is often needed for true rehab goals - clients track and put in
   their load." His choices: one tap marks an exercise (or the whole session) done, a tap on Change edits its sets, reps or
   load, and the boxes start from what they did last time, so loads carry forward; a pain score (0-10) and a note for the
   session; no progression nudges. A session goes to shared/<key>/logs/<id> (the store's rules take it only while the
   link works, and only in this shape); it is kept on the phone first and sent when there is a connection, and the
   client can change or remove it later. The clinic reads the log with its own login. */
(function () {
  'use strict';
  var CFG = window.BH_CLOUD || {}, PROJECT = String(CFG.projectId || '').trim();
  var KEY_RE = /^[A-Za-z0-9]{20,64}$/, LAST = 'bh-program-key', COPY = 'bh-program-copy:';
  var LOGS = 'bh-program-logs:', OUTBOX = 'bh-program-outbox:', LOG_ID = /^[0-9]{8}-[A-Za-z0-9]{12}$/;   // v3
  var STORE = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(PROJECT) + '/databases/(default)/documents';
  var DOCS = 'projects/' + PROJECT + '/databases/(default)/documents';             // the documents' resource names
  var MEDIA_HOST = 'https://firebasestorage.googleapis.com/v0/b/';
  var main = document.getElementById('main');
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l10.1-6.4a.6.6 0 0 0 0-1L8.92 5.1A.6.6 0 0 0 8 5.6z"/></svg>';
  var TICK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  // v3: what is on screen. view: 'program', 'log' (the form) or 'history'; form: the session being logged or changed
  var cur = { key: '', copy: null, offline: false, view: 'program', form: null, msg: '', refused: false };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function str(v, max) { return typeof v === 'string' ? v.replace(/\s+$/, '').slice(0, max || 300) : ''; }
  function one(v, max) { return str(v, max).replace(/\s+/g, ' ').trim(); }
  function getJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function setJson(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function media(u) { return typeof u === 'string' && u.indexOf(MEDIA_HOST) === 0 && u.length < 800 && !/[\s"'<>\\]/.test(u) ? u : ''; }
  function link(u) { return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length < 2000 ? u : ''; }
  function isoDay(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function nice(iso) { var p = isoDay(iso).split('-'); return p.length === 3 ? +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0] : ''; }
  function keyFromUrl() {
    var h = String(location.hash || '').replace(/^#/, '');
    var m = /(?:^|&)k=([A-Za-z0-9]+)/.exec(h);
    var k = m ? m[1] : h;
    return KEY_RE.test(k) ? k : '';
  }
  function expired(exp) { var t = Date.parse(exp || ''); return isFinite(t) && t <= Date.now(); }
  // v3: days as the phone sees them (its own time zone)
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(iso, n) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10); }
  function dayName(iso) {                              // 'Tue 6 Oct' (and the year when it isn't this one)
    var p = isoDay(iso).split('-');
    if (p.length !== 3) return '';
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return WEEKDAYS[d.getUTCDay()] + ' ' + (+p[2]) + ' ' + MONTHS[+p[1] - 1] + (p[0] !== today().slice(0, 4) ? ' ' + p[0] : '');
  }
  function norm(s) { return one(s, 120).toLowerCase(); }
  function randomId(n) {                               // letters and digits from the phone's random source
    var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', out = '', a;
    try { a = new Uint8Array(n * 2); crypto.getRandomValues(a); } catch (e) { a = null; }
    for (var i = 0; out.length < n; i++) {
      var b = a && i < a.length ? a[i] : Math.floor(Math.random() * 256);
      if (b < 248) out += abc.charAt(b % 62);
    }
    return out;
  }

  // ---- the clinic store: shared/<key> (no sign-in; the rules decide)
  function timed(url, opts) {
    var ctrl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    var o = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl ? ctrl.signal : undefined };
    Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
    return fetch(url, o).then(function (res) { clearTimeout(timer); return res; }, function (err) { clearTimeout(timer); throw err; });
  }
  function fetchCopy(key) {
    if (!PROJECT) return Promise.reject(new Error('no store'));
    return timed(STORE + '/shared/' + key).then(function (res) {
      // 403: the store refuses it (the link has ended, or was stopped); 404: there is no program under this key (not sent
      // yet, or removed after it ended)
      if (res.status === 403 || res.status === 404) return { gone: res.status === 403 ? 'ended' : 'missing' };
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json().then(function (j) {
        var f = (j && j.fields) || {}, prog = null;
        try { prog = JSON.parse(f.data && f.data.stringValue); } catch (e) { prog = null; }
        if (!prog || typeof prog !== 'object' || prog.v !== 1) throw new Error('unreadable');
        return { program: prog, expires: (f.expires && f.expires.timestampValue) || '' };
      });
    });
  }

  // ---- v3: the training log. Each session is kept on the phone (bh-program-logs:<key>) and queued (bh-program-outbox:<key>)
  // until the store has it; the store's copies are read back on opening, so another phone, or a phone whose storage was
  // cleared, shows the same sessions
  function logMap(key) {
    var m = getJson(LOGS + key);
    return m && typeof m === 'object' && m.logs && typeof m.logs === 'object' && !Array.isArray(m.logs) ? m : { logs: {} };
  }
  function saveLogMap(key, m) { setJson(LOGS + key, m); }
  function outbox(key) { var o = getJson(OUTBOX + key); return Array.isArray(o) ? o.filter(function (id) { return LOG_ID.test(id); }) : []; }
  function setOutbox(key, o) { setJson(OUTBOX + key, o.length ? o : null); }
  // a session as stored, from this phone or the store: known fields only, each to its size
  function tidyLog(o) {
    if (!o || typeof o !== 'object' || !isoDay(o.day)) return null;
    var items = (Array.isArray(o.items) ? o.items : []).slice(0, 80).map(function (it) {
      if (!it || typeof it !== 'object' || !one(it.n, 120)) return null;
      var rx = it.rx && typeof it.rx === 'object' ? it.rx : {};
      return { n: one(it.n, 120), g: one(it.g, 80), done: it.done === true, sets: one(it.sets, 20), reps: one(it.reps, 20), load: one(it.load, 30),
        rx: { sets: one(rx.sets, 20), reps: one(rx.reps, 20), load: one(rx.load, 30) }, changed: it.changed === true };
    }).filter(Boolean);
    var pain = typeof o.pain === 'number' && o.pain >= 0 && o.pain <= 10 && Math.round(o.pain) === o.pain ? o.pain : null;
    var out = { v: 1, day: o.day, at: typeof o.at === 'string' ? o.at.slice(0, 40) : '', prog: isoDay(o.prog), title: one(o.title, 120), grp: one(o.grp, 80),
      items: items, pain: pain, note: str(o.note, 500).trim() };
    if (o.removed === true) out.removed = true;
    return out;
  }
  function logsList(key) {                             // newest first; sessions removed by the client left out
    var m = logMap(key).logs, out = [];
    Object.keys(m).forEach(function (id) { var l = LOG_ID.test(id) ? tidyLog(m[id]) : null; if (l && !l.removed) { l.id = id; out.push(l); } });
    return out.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : (a.at < b.at ? 1 : a.at > b.at ? -1 : 0); });
  }
  function lastFor(key, name, except) {                // what they did last time for this exercise (any program on this link)
    var n = norm(name), list = logsList(key);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === except) continue;
      for (var j = 0; j < list[i].items.length; j++) {
        var it = list[i].items[j];
        if (it.done && norm(it.n) === n) return { sets: it.sets, reps: it.reps, load: it.load, day: list[i].day };
      }
    }
    return null;
  }
  function doneOf(l) {
    var d = l.items.filter(function (it) { return it.done; }).length;
    return d + ' of ' + l.items.length + (l.items.length === 1 ? ' exercise' : ' exercises');
  }
  // the store's copies of the sessions: a session this phone still has to send keeps this phone's version
  function fetchLogs(key) {
    if (!PROJECT) return Promise.resolve(false);
    return timed(STORE + '/shared/' + key + '/logs?pageSize=300').then(function (res) {
      if (!res.ok) return false;                       // 403: the link has ended (or the store has no rule for logs yet)
      return res.json().then(function (j) {
        var m = logMap(key), box = outbox(key), changed = false;
        (j && Array.isArray(j.documents) ? j.documents : []).forEach(function (d) {
          var id = String(d && d.name || '').split('/').pop(), f = (d && d.fields) || {}, o = null;
          if (!LOG_ID.test(id) || box.indexOf(id) >= 0) return;
          try { o = tidyLog(JSON.parse(f.data && f.data.stringValue)); } catch (e) { o = null; }
          if (!o) return;
          if (JSON.stringify(m.logs[id]) !== JSON.stringify(o)) { m.logs[id] = o; changed = true; }
        });
        if (changed) saveLogMap(key, m);
        return changed;
      });
    }).catch(function () { return false; });
  }
  var sending = false;
  function sendOutbox(key) {
    if (sending || !PROJECT || !outbox(key).length) return Promise.resolve();
    sending = true;
    var p = Promise.resolve(), stop = false;
    outbox(key).forEach(function (id) {
      p = p.then(function () {
        if (stop) return;
        var o = tidyLog(logMap(key).logs[id]);
        if (!o) { setOutbox(key, outbox(key).filter(function (x) { return x !== id; })); return; }
        var body = { writes: [{ update: { name: DOCS + '/shared/' + key + '/logs/' + id, fields: { data: { stringValue: JSON.stringify(o) }, day: { stringValue: o.day } } },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }] };
        return timed(STORE + ':commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
          if (res.ok) { setOutbox(key, outbox(key).filter(function (x) { return x !== id; })); cur.refused = false; return; }
          stop = true;
          if (res.status === 403) cur.refused = true;  // the link has ended, or the store doesn't take logs yet: kept here
        }, function () { stop = true; });
      });
    });
    return p.then(function () {
      sending = false;
      if (cur.key !== key) return;
      if (!outbox(key).length && / kept on this phone /.test(cur.msg)) cur.msg = 'Sent to the clinic.';
      if (cur.copy && cur.view !== 'log') draw(true);
    });
  }

  // ---- drawing the program
  function doseLine(r) {
    var sets = one(r.sets, 60), reps = one(r.reps, 60), sr = sets && reps ? sets + ' × ' + reps : sets ? sets + (/^\d+$/.test(sets) ? (sets === '1' ? ' set' : ' sets') : '') : reps;
    return [sr, one(r.load, 60), one(r.side, 60), one(r.rest, 60) ? 'Rest ' + one(r.rest, 60) : '', one(r.tempo, 60) ? 'Tempo ' + one(r.tempo, 60) : ''].filter(Boolean).join(' · ');
  }
  function doseShort(r) { return doseLine({ sets: r.sets, reps: r.reps, load: r.load }); }   // sets × reps · load
  function exHtml(r) {
    var name = one(r.name, 120), photo = r.photo || {}, clip = r.clip || {};
    var purl = media(photo.url), pthumb = media(photo.turl), curl = media(clip.url), cposter = media(clip.turl) || pthumb, vlink = link(r.link);
    var pic = '';
    if (curl) pic = '<div class="ex-media"><video controls playsinline preload="none"' + (cposter ? ' poster="' + esc(cposter) + '"' : '') + ' src="' + esc(curl) + '" aria-label="' + esc(name) + ' video"></video></div>';
    else if (pthumb || purl) pic = '<a class="ex-media" href="' + esc(purl || pthumb) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(pthumb || purl) + '" alt="' + esc(name) + '" loading="lazy"></a>';
    var cues = (Array.isArray(r.cues) ? r.cues : []).map(function (c) { return one(c, 120); }).filter(Boolean).slice(0, 3);
    var dose = doseLine(r), note = one(r.notes, 300), last = cur.key ? lastFor(cur.key, name) : null, lastDose = last ? doseShort(last) : '';
    return '<article class="ex' + (pic ? '' : ' nomedia') + '">' + pic + '<div class="ex-body"><h3>' + esc(name) + '</h3>' +
      (dose ? '<p class="dose">' + esc(dose) + '</p>' : '') +
      (last ? '<p class="last">Last time: ' + esc(lastDose || 'done') + ' <span>(' + esc(dayName(last.day)) + ')</span></p>' : '') +   // v3
      (note ? '<p class="note">' + esc(note) + '</p>' : '') +
      (cues.length ? '<ul class="cues">' + cues.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
      (vlink ? '<a class="watch" href="' + esc(vlink) + '" target="_blank" rel="noopener noreferrer">' + PLAY + 'Watch the video</a>' : '') +
      '</div></article>';
  }
  // v3: the log's card under the program's cover: the last session, the week so far, Log a session and Your sessions
  function logCardHtml(key) {
    var list = logsList(key), box = outbox(key).length, last = list[0], since = addDays(today(), -6);
    var week = list.filter(function (l) { return l.day >= since; }).length;
    var line = !list.length ? 'Done a session? Log it in a few taps so your physio can see how you’re going.'
      : 'Last logged ' + dayName(last.day) + ' · ' + doneOf(last) + (week ? ' · ' + week + (week === 1 ? ' session' : ' sessions') + ' in the last 7 days' : '');
    var wait = !box ? '' : '<p class="lc-wait" role="status">' + (cur.refused
      ? (box === 1 ? '1 session' : box + ' sessions') + ' couldn’t be sent to the clinic yet. ' + (box === 1 ? 'It stays' : 'They stay') + ' on this phone and will be sent when the clinic can take ' + (box === 1 ? 'it.' : 'them.')
      : (box === 1 ? '1 session is' : box + ' sessions are') + ' waiting to send. ' + (box === 1 ? 'It goes' : 'They go') + ' when this phone is online.') + '</p>';
    return '<section class="logcard" aria-labelledby="lcH"><h2 id="lcH">Your training log</h2><p class="lc-line">' + esc(line) + '</p>' + wait +
      '<div class="lc-acts"><button type="button" class="btn primary" data-act="log">Log a session</button>' +
      (list.length ? '<button type="button" class="btn" data-act="history">Your sessions (' + list.length + ')</button>' : '') + '</div>' +
      '<p class="lc-note">BASE Health Noosa can see what you log here.</p></section>';
  }
  function render(copy, offline) {
    var p = copy.program, first = one(p.first, 40), who = one(p.clinician, 120);
    var title = one(p.title, 120), reason = str(p.reason, 600).trim(), instr = str(p.instructions, 1200).trim();
    var weeks = /^\d{1,2}$/.test(String(p.weeks || '')) ? +p.weeks : 0, review = nice(p.review);
    document.title = (first ? first + '’s exercise program' : 'Your exercise program') + ' · BASE Health Noosa';
    var out = (offline ? '<p class="offline" role="status">No connection: this is the copy saved on this phone.</p>' : '') +
      (cur.msg ? '<p class="saved" role="status">' + esc(cur.msg) + '</p>' : '') +
      '<h1 id="progH" tabindex="-1">' + esc(first ? first + '’s exercise program' : 'Your exercise program') + '</h1>' +
      '<p class="by">' + esc((who ? 'From ' + who + ' at BASE Health Noosa' : 'From BASE Health Noosa') + (nice(p.date) ? ' · ' + nice(p.date) : '')) + '</p>' +
      (title ? '<p class="title">' + esc(title) + '</p>' : '') +
      (weeks || review ? '<ul class="cover">' + (weeks ? '<li><b>Block</b> ' + weeks + (weeks === 1 ? ' week' : ' weeks') + '</li>' : '') + (review ? '<li><b>Next review</b> ' + esc(review) + '</li>' : '') + '</ul>' : '') +
      (reason || instr ? '<section class="box">' + (reason ? '<h2>Why this plan</h2><p>' + esc(reason) + '</p>' : '') + (instr ? '<h2>Instructions</h2><p>' + esc(instr) + '</p>' : '') + '</section>' : '') +
      (exList(p).length ? logCardHtml(cur.key) : '');
    (Array.isArray(p.groups) ? p.groups : []).slice(0, 30).forEach(function (g) {
      var rows = (g && Array.isArray(g.rows) ? g.rows : []).slice(0, 60).filter(function (r) { return r && one(r.name, 120); });
      if (!rows.length) return;
      var h = one(g.heading, 80);
      out += (h ? '<h2 class="day">' + esc(h) + '</h2>' : '') + rows.map(exHtml).join('');
    });
    var until = untilText(copy.expires);
    out += tipHtml() + '<p class="foot">' + esc('Prepared by ' + (who ? who + ' · ' : '') + 'BASE Health Noosa. Follow your clinician’s instructions. This page is for you: please don’t share its link' +
      (until ? ', which works until ' + until : '') + '.') + '</p>';
    main.innerHTML = out;
    wireTip();
  }

  // ---- v3: logging a session
  function exList(p) {                                 // the exercises in order, as drawn: { i, name, g (its day's heading), rx (the plan) }
    var out = [];
    (Array.isArray(p.groups) ? p.groups : []).slice(0, 30).forEach(function (g) {
      var h = one(g && g.heading, 80);
      (g && Array.isArray(g.rows) ? g.rows : []).slice(0, 60).forEach(function (r) {
        if (!r || !one(r.name, 120) || out.length >= 80) return;
        out.push({ i: out.length, name: one(r.name, 120), g: h, rx: { sets: one(r.sets, 20), reps: one(r.reps, 20), load: one(r.load, 30) } });
      });
    });
    return out;
  }
  function daysOf(list) {                              // a program in days (every section headed): one day is logged at a time
    var gs = [];
    list.forEach(function (x) { if (gs.indexOf(x.g) < 0) gs.push(x.g); });
    return gs.length > 1 && gs.every(Boolean) ? gs : [];
  }
  // edit: a session from the list (to change it), else a new one: today, the day after the last one logged, nothing ticked,
  // each exercise's boxes holding what they did last time (else the plan)
  function startForm(edit) {
    var list = exList(cur.copy.program), days = daysOf(list), logs = logsList(cur.key);
    var f = { id: edit ? edit.id : '', day: edit ? edit.day : today(), grp: '', rows: {}, open: {}, pain: edit ? edit.pain : null, note: edit ? edit.note : '', warn: '', arm: false };
    if (edit) f.grp = days.indexOf(edit.grp) >= 0 ? edit.grp : '';
    else if (days.length) { var k = logs.length ? days.indexOf(logs[0].grp) : -1; f.grp = days[(k + 1) % days.length]; }
    list.forEach(function (x) {
      var it = null;
      if (edit) edit.items.forEach(function (y) { if (!it && norm(y.n) === norm(x.name)) it = y; });
      var last = it && it.done ? it : lastFor(cur.key, x.name, edit ? edit.id : ''), src = last || x.rx;
      f.rows[x.i] = { done: !!(it && it.done), sets: src.sets, reps: src.reps, load: src.load };
    });
    cur.form = f; cur.view = 'log'; cur.msg = '';
    draw();
    window.scrollTo(0, 0);
    focusEl(document.getElementById('formH'));
  }
  function shownRows() { var f = cur.form; return exList(cur.copy.program).filter(function (x) { return !f.grp || x.g === f.grp; }); }
  function fieldHtml(x, r, k, label, mode) {
    return '<label class="lx-f"><span>' + label + '</span><input type="text" data-f="' + k + '" data-i="' + x.i + '" value="' + esc(r[k]) + '" maxlength="' + (k === 'load' ? 30 : 20) + '"' +
      (mode ? ' inputmode="' + mode + '"' : '') + ' autocomplete="off" autocapitalize="off" enterkeyhint="done" aria-label="' + esc(label + ', ' + x.name) + '"></label>';
  }
  // not ticked: the plan (and last time's, when the boxes hold something else); ticked: what goes in the log
  function rowDose(x, r) {
    if (r.done) return 'Done: ' + (doseShort(r) || 'as planned');
    var plan = doseShort(x.rx), mine = doseShort(r);
    return 'Plan: ' + (plan || 'as written') + (mine && mine !== plan ? ' · Last time: ' + mine : '');
  }
  function drawForm() {
    var f = cur.form, list = exList(cur.copy.program), days = daysOf(list), shown = shownRows();
    var html = '<button type="button" class="back" data-act="program">‹ Your program</button>' +
      '<h1 id="formH" tabindex="-1">' + (f.id ? 'Change this session' : 'Log a session') + '</h1>' +
      '<label class="when"><span>Day</span><input type="date" id="logDay" value="' + esc(f.day) + '" min="' + addDays(today(), -28) + '" max="' + today() + '"></label>';
    if (days.length) {
      html += '<div class="grp" role="group" aria-labelledby="grpL"><span id="grpL">Which session?</span><div class="chips">' + days.concat(['']).map(function (g) {
        return '<button type="button" class="chip" data-grp="' + esc(g) + '" aria-pressed="' + (f.grp === g) + '">' + esc(g || 'Everything') + '</button>';
      }).join('') + '</div></div>';
    }
    html += '<p class="hint">Tap each exercise you did, or All done. Tap Change if your sets, reps or load were different.</p>' +
      '<button type="button" class="btn alldone" data-act="all">' + TICK + 'All done</button>';
    html += '<div class="lx-list">' + shown.map(function (x) {
      var r = f.rows[x.i], open = !!f.open[x.i];
      return '<div class="lx' + (r.done ? ' done' : '') + '" data-i="' + x.i + '">' +
        '<button type="button" class="lx-tick" data-act="tick" data-i="' + x.i + '" aria-pressed="' + r.done + '"><span class="tk">' + TICK + '</span><span class="vh">Done: ' + esc(x.name) + '</span></button>' +
        '<div class="lx-main"><b>' + esc(x.name) + '</b><span class="lx-dose">' + esc(rowDose(x, r)) + '</span>' +
        '<button type="button" class="lx-change" data-act="change" data-i="' + x.i + '" aria-expanded="' + open + '">' + (open ? 'Done changing' : 'Change') + '<span class="vh"> ' + esc(x.name) + '</span></button>' +
        (open ? '<div class="lx-edit">' + fieldHtml(x, r, 'sets', 'Sets', 'numeric') + fieldHtml(x, r, 'reps', 'Reps', '') + fieldHtml(x, r, 'load', 'Load', '') + '</div>' : '') +
        '</div></div>';
    }).join('') + '</div>';
    html += '<fieldset class="pain"><legend>Pain during or after <span>(0 = none, 10 = worst)</span></legend><div class="pain-grid">' +
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<button type="button" data-pain="' + n + '" aria-pressed="' + (f.pain === n) + '">' + n + '</button>'; }).join('') + '</div></fieldset>' +
      '<label class="lnote"><span>Anything to tell your physio? <small>(optional)</small></span><textarea id="logNote" rows="3" maxlength="500">' + esc(f.note) + '</textarea></label>' +
      '<p class="privacy">BASE Health Noosa can see what you log. It isn’t checked every day: if your pain is getting worse, contact the clinic.</p>' +
      (f.warn ? '<p class="warn" role="alert">' + esc(f.warn) + '</p>' : '') +
      '<div class="form-acts"><button type="button" class="btn primary" data-act="save">' + (f.id ? 'Save changes' : 'Save session') + '</button>' +
      (f.id ? '<button type="button" class="btn danger" data-act="remove">' + (f.arm ? 'Tap again to remove it' : 'Remove this session') + '</button>' : '') + '</div>';
    main.innerHTML = html;
  }
  function saveForm() {
    var f = cur.form, p = cur.copy.program, shown = shownRows(), key = cur.key;
    var items = shown.map(function (x) {
      var r = f.rows[x.i], v = { sets: one(r.sets, 20), reps: one(r.reps, 20), load: one(r.load, 30) };
      return { n: x.name, g: x.g, done: !!r.done, sets: r.done ? v.sets : '', reps: r.done ? v.reps : '', load: r.done ? v.load : '', rx: x.rx,
        changed: !!r.done && (v.sets !== x.rx.sets || v.reps !== x.rx.reps || v.load !== x.rx.load) };
    });
    if (!items.some(function (it) { return it.done; })) {
      f.warn = 'Tick at least one exercise you did (or tap All done).';
      draw(true);
      var w = main.querySelector('.warn');
      if (w) { try { w.scrollIntoView({ block: 'center' }); } catch (e) { /* old browser */ } focusEl(w); }
      return;
    }
    var day = isoDay(f.day) && f.day <= today() ? f.day : today();
    var id = f.id || day.replace(/-/g, '') + '-' + randomId(12);
    var m = logMap(key), was = f.id ? tidyLog(m.logs[f.id]) : null;   // a session changed keeps when it was first logged (its place in the list)
    m.logs[id] = tidyLog({ day: day, at: was && was.at ? was.at : new Date().toISOString(), prog: p.date, title: p.title, grp: f.grp, items: items, pain: f.pain, note: f.note });
    saveLogMap(key, m);
    var box = outbox(key).filter(function (x) { return x !== id; }); box.push(id); setOutbox(key, box);
    finishForm(f.id ? 'Session changed.' : 'Session saved.');
  }
  function removeLog() {
    var f = cur.form, key = cur.key, m = logMap(key);
    if (!f.arm) { f.arm = true; draw(); focusEl(main.querySelector('[data-act="remove"]')); return; }
    var l = tidyLog(m.logs[f.id]);
    if (l) { l.removed = true; m.logs[f.id] = l; saveLogMap(key, m); }
    var box = outbox(key).filter(function (x) { return x !== f.id; }); box.push(f.id); setOutbox(key, box);
    finishForm('Session removed.');
  }
  function finishForm(said) {
    var offline = navigator.onLine === false;
    cur.form = null; cur.view = 'program';
    cur.msg = said + (offline ? ' It’s kept on this phone and sent to the clinic when you’re back online.' : '');
    draw();
    window.scrollTo(0, 0);
    focusEl(main.querySelector('.saved'));
    sendOutbox(cur.key);
  }
  function drawHistory() {
    var list = logsList(cur.key), box = outbox(cur.key);
    var html = '<button type="button" class="back" data-act="program">‹ Your program</button><h1 id="histH" tabindex="-1">Your sessions</h1>' +
      (list.length ? '<p class="hint">Tap a session to change it.</p><ul class="hist">' + list.map(function (l) {
        var bits = [l.grp, doneOf(l), l.pain != null ? 'pain ' + l.pain + '/10' : ''].filter(Boolean).join(' · ');
        return '<li><button type="button" data-log="' + l.id + '"><b>' + esc(dayName(l.day)) + '</b><span>' + esc(bits) + '</span>' +
          (l.note ? '<small>' + esc(l.note) + '</small>' : '') + (box.indexOf(l.id) >= 0 ? '<em>Waiting to send</em>' : '') + '</button></li>';
      }).join('') + '</ul>' : '<p>No sessions logged yet.</p>');
    main.innerHTML = html;
  }
  function draw(keepPlace) {
    if (!cur.copy) return;
    var y = window.scrollY;
    if (cur.view === 'log' && cur.form) drawForm();
    else if (cur.view === 'history') drawHistory();
    else render(cur.copy, cur.offline);
    if (keepPlace) window.scrollTo(0, y);
  }
  function focusEl(el) { if (!el) return; if (!el.hasAttribute('tabindex') && !/^(BUTTON|INPUT|TEXTAREA|A)$/.test(el.tagName)) el.setAttribute('tabindex', '-1'); try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  function refocus(sel) { focusEl(main.querySelector(sel)); }
  main.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !cur.copy) return;
    var act = b.getAttribute('data-act'), f = cur.form;
    if (act === 'log') { startForm(null); return; }
    if (act === 'history') { cur.view = 'history'; cur.msg = ''; draw(); window.scrollTo(0, 0); refocus('#histH'); return; }
    if (act === 'program') { var was = cur.view; cur.view = 'program'; cur.form = null; draw(); window.scrollTo(0, 0); refocus(was === 'history' ? '[data-act="history"]' : '[data-act="log"]'); return; }
    if (b.hasAttribute('data-log')) {
      var id = b.getAttribute('data-log'), hit = null;
      logsList(cur.key).forEach(function (l) { if (l.id === id) hit = l; });
      if (hit) startForm(hit);
      return;
    }
    if (!f || cur.view !== 'log') return;
    f.warn = '';
    if (act === 'tick') { var r = f.rows[b.getAttribute('data-i')]; if (r) r.done = !r.done; f.arm = false; draw(true); refocus('[data-act="tick"][data-i="' + b.getAttribute('data-i') + '"]'); }
    else if (act === 'change') { var i = b.getAttribute('data-i'); f.open[i] = !f.open[i]; draw(true); refocus(f.open[i] ? 'input[data-i="' + i + '"][data-f="sets"]' : '[data-act="change"][data-i="' + i + '"]'); }
    else if (act === 'all') { shownRows().forEach(function (x) { f.rows[x.i].done = true; }); draw(true); refocus('[data-act="all"]'); }
    else if (b.hasAttribute('data-grp')) {
      f.grp = b.getAttribute('data-grp'); draw(true);
      Array.prototype.forEach.call(main.querySelectorAll('[data-grp]'), function (c) { if (c.getAttribute('data-grp') === f.grp) focusEl(c); });
    }
    else if (b.hasAttribute('data-pain')) { var n = +b.getAttribute('data-pain'); f.pain = f.pain === n ? null : n; draw(true); refocus('[data-pain="' + n + '"]'); }
    else if (act === 'save') saveForm();
    else if (act === 'remove') removeLog();
  });
  // typing in a box: the exercise counts as done; the page isn't redrawn (the keyboard stays), only the row's line
  main.addEventListener('input', function (e) {
    var f = cur.form, t = e.target;
    if (!f || cur.view !== 'log') return;
    if (t.id === 'logNote') { f.note = t.value; return; }
    var i = t.getAttribute('data-i'), k = t.getAttribute('data-f');
    if (!i || !k || !f.rows[i]) return;
    var r = f.rows[i];
    r[k] = t.value; r.done = true;
    var row = t.closest('.lx'), x = null;
    exList(cur.copy.program).forEach(function (y) { if (String(y.i) === i) x = y; });
    if (row && x) {
      row.classList.add('done');
      row.querySelector('.lx-tick').setAttribute('aria-pressed', 'true');
      row.querySelector('.lx-dose').textContent = rowDose(x, r);
    }
  });
  main.addEventListener('change', function (e) { if (cur.form && e.target.id === 'logDay') cur.form.day = e.target.value; });

  function ended() {
    cur.copy = null;
    document.title = 'Your exercise program · BASE Health Noosa';
    main.innerHTML = '<section class="state"><h1>This program has ended</h1><p>The link has expired or was stopped by the clinic. Ask BASE Health Noosa for your current program.</p></section>';
  }
  function missing() {
    main.innerHTML = '<section class="state"><h1>Your program isn’t here yet</h1><p>If your clinician has only just sent it, try again in a minute. Otherwise ask BASE Health Noosa for your current program.</p>' +
      '<p><button type="button" class="install retry" id="retry">Try again</button></p></section>';
    wireRetry();
  }
  function problem(msg, retry) {
    main.innerHTML = '<section class="state"><h1>Your program</h1><p>' + esc(msg) + '</p>' + (retry ? '<p><button type="button" class="install retry" id="retry">Try again</button></p>' : '') + '</section>';
    if (retry) wireRetry();
  }
  function wireRetry() { var b = document.getElementById('retry'); if (b) b.addEventListener('click', function () { main.innerHTML = '<p class="loading">Loading your program…</p>'; start(); }); }
  // the day the link ends, as the clinic sees it (Queensland: UTC+10 all year)
  function untilText(exp) {
    var t = Date.parse(exp || '');
    if (!isFinite(t)) return '';
    return nice(new Date(t + 10 * 3600000).toISOString().slice(0, 10));
  }

  // ---- keeping it handy: Add to Home Screen (iPhone: a tip; Android: the browser's install prompt)
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; var b = document.getElementById('installBtn'); if (b) b.style.display = 'inline-flex'; });
  function standalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function tipHtml() {
    if (standalone() || getJson('bh-program-tip') === 'off') return '';
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return '<div class="tip" id="tip"><p>' + (ios ? 'Keep it handy: tap Share, then <b>Add to Home Screen</b>.' : 'Keep it handy: add this page to your home screen.') +
      '<br><button type="button" class="install" id="installBtn">Add to home screen</button></p><button type="button" id="tipX" aria-label="Hide this tip">OK</button></div>';
  }
  function wireTip() {
    var x = document.getElementById('tipX'), b = document.getElementById('installBtn');
    if (x) x.addEventListener('click', function () { setJson('bh-program-tip', 'off'); var t = document.getElementById('tip'); if (t) t.remove(); });
    if (b) {
      if (installEvt) b.style.display = 'inline-flex';
      b.addEventListener('click', function () { if (!installEvt) return; installEvt.prompt(); installEvt = null; b.style.display = 'none'; });
    }
  }

  // ---- start: the key from the link (or the last one opened on this phone), the saved copy at once, then the store's;
  // v3: then the log's sessions from the store, and any still to send
  function start() {
    var key = keyFromUrl() || (KEY_RE.test(String(getJson(LAST) || '')) ? getJson(LAST) : '');
    cur = { key: key, copy: null, offline: false, view: 'program', form: null, msg: '', refused: false };
    if (!key) {
      // v2: an icon added to an iPhone's home screen before this version opens without its key (and its own storage is empty)
      problem(standalone() ? 'This icon doesn’t know which program to open. Delete it, open the link or scan the QR code on your handout from BASE Health Noosa in your browser, then add it to your Home Screen again: from then on it opens your program straight away.'
        : 'Open the link or scan the QR code on your handout from BASE Health Noosa to see your program here.');
      return;
    }
    setJson(LAST, key);
    if (window.bhManifestFor) window.bhManifestFor(key);   // v2: Add to Home Screen keeps this program (iPhone, iPad)
    if (location.hash.replace(/^#/, '') !== key) { try { history.replaceState(null, '', location.pathname + location.search + '#' + key); } catch (e) { /* fine */ } }
    var saved = getJson(COPY + key);
    if (saved && (expired(saved.expires) || !saved.program)) { setJson(COPY + key, null); saved = null; }
    if (saved) { cur.copy = saved; draw(); }
    fetchCopy(key).then(function (r) {
      if (cur.key !== key) return;
      if (r.gone === 'missing' && !saved) { missing(); return; }
      if (r.gone || expired(r.expires)) { setJson(COPY + key, null); ended(); return; }
      var copy = { program: r.program, expires: r.expires, at: new Date().toISOString() };
      setJson(COPY + key, copy);
      cur.copy = copy; cur.offline = false;
      if (cur.view !== 'log') draw(true);
      fetchLogs(key).then(function (changed) { if (changed && cur.key === key && cur.copy && cur.view !== 'log') draw(true); });
      sendOutbox(key);
    }, function () {
      if (cur.key !== key) return;
      if (saved) { cur.offline = true; if (cur.view !== 'log') draw(true); }
      else problem(navigator.onLine === false ? 'No connection. Connect to the internet to open your program the first time.' : 'Your program couldn’t be loaded just now. Try again in a moment.', true);
    });
  }
  window.addEventListener('hashchange', start);
  window.addEventListener('online', function () { if (cur.key && cur.copy) sendOutbox(cur.key); });   // v3: sessions kept while offline
  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) { /* fine */ } }
  start();
})();
