/* BASE Health Noosa: a client's exercise program on their phone (v35). See index.html for what this page is for.
   The key after # names the shared copy in the clinic store (shared/<key>); the store hands it over until its expiry date
   and refuses it after that or once the clinic stops sharing. The last copy is kept on the phone (localStorage), so the
   program opens without a connection; a link that has ended removes it. Everything shown is escaped; only the clinic's
   own file addresses (Cloud Storage) are used for photos and videos, and only http(s) links for a video link. */
(function () {
  'use strict';
  var CFG = window.BH_CLOUD || {}, PROJECT = String(CFG.projectId || '').trim();
  var KEY_RE = /^[A-Za-z0-9]{20,64}$/, LAST = 'bh-program-key', COPY = 'bh-program-copy:';
  var MEDIA_HOST = 'https://firebasestorage.googleapis.com/v0/b/';
  var main = document.getElementById('main');
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l10.1-6.4a.6.6 0 0 0 0-1L8.92 5.1A.6.6 0 0 0 8 5.6z"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function str(v, max) { return typeof v === 'string' ? v.replace(/\s+$/, '').slice(0, max || 300) : ''; }
  function one(v, max) { return str(v, max).replace(/\s+/g, ' ').trim(); }
  function getJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function setJson(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function media(u) { return typeof u === 'string' && u.indexOf(MEDIA_HOST) === 0 && u.length < 800 && !/[\s"'<>\\]/.test(u) ? u : ''; }
  function link(u) { return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length < 2000 ? u : ''; }
  function isoDay(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function nice(iso) { var p = isoDay(iso).split('-'); return p.length === 3 ? +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0] : ''; }
  function keyFromUrl() {
    var h = String(location.hash || '').replace(/^#/, '');
    var m = /(?:^|&)k=([A-Za-z0-9]+)/.exec(h);
    var k = m ? m[1] : h;
    return KEY_RE.test(k) ? k : '';
  }
  function expired(exp) { var t = Date.parse(exp || ''); return isFinite(t) && t <= Date.now(); }

  // ---- the clinic store: shared/<key> (no sign-in; the rules decide)
  function fetchCopy(key) {
    if (!PROJECT) return Promise.reject(new Error('no store'));
    var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(PROJECT) + '/databases/(default)/documents/shared/' + key;
    var ctrl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    return fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl ? ctrl.signal : undefined }).then(function (res) {
      clearTimeout(timer);
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
    }, function (err) { clearTimeout(timer); throw err; });
  }

  // ---- drawing the program
  function doseLine(r) {
    var sets = one(r.sets, 60), reps = one(r.reps, 60), sr = sets && reps ? sets + ' × ' + reps : sets ? sets + (/^\d+$/.test(sets) ? (sets === '1' ? ' set' : ' sets') : '') : reps;
    return [sr, one(r.load, 60), one(r.side, 60), one(r.rest, 60) ? 'Rest ' + one(r.rest, 60) : '', one(r.tempo, 60) ? 'Tempo ' + one(r.tempo, 60) : ''].filter(Boolean).join(' · ');
  }
  function exHtml(r) {
    var name = one(r.name, 120), photo = r.photo || {}, clip = r.clip || {};
    var purl = media(photo.url), pthumb = media(photo.turl), curl = media(clip.url), cposter = media(clip.turl) || pthumb, vlink = link(r.link);
    var pic = '';
    if (curl) pic = '<div class="ex-media"><video controls playsinline preload="none"' + (cposter ? ' poster="' + esc(cposter) + '"' : '') + ' src="' + esc(curl) + '" aria-label="' + esc(name) + ' video"></video></div>';
    else if (pthumb || purl) pic = '<a class="ex-media" href="' + esc(purl || pthumb) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(pthumb || purl) + '" alt="' + esc(name) + '" loading="lazy"></a>';
    var cues = (Array.isArray(r.cues) ? r.cues : []).map(function (c) { return one(c, 120); }).filter(Boolean).slice(0, 3);
    var dose = doseLine(r), note = one(r.notes, 300);
    return '<article class="ex' + (pic ? '' : ' nomedia') + '">' + pic + '<div class="ex-body"><h3>' + esc(name) + '</h3>' +
      (dose ? '<p class="dose">' + esc(dose) + '</p>' : '') + (note ? '<p class="note">' + esc(note) + '</p>' : '') +
      (cues.length ? '<ul class="cues">' + cues.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
      (vlink ? '<a class="watch" href="' + esc(vlink) + '" target="_blank" rel="noopener noreferrer">' + PLAY + 'Watch the video</a>' : '') +
      '</div></article>';
  }
  function render(copy, offline) {
    var p = copy.program, first = one(p.first, 40), who = one(p.clinician, 120);
    var title = one(p.title, 120), reason = str(p.reason, 600).trim(), instr = str(p.instructions, 1200).trim();
    var weeks = /^\d{1,2}$/.test(String(p.weeks || '')) ? +p.weeks : 0, review = nice(p.review);
    document.title = (first ? first + '’s exercise program' : 'Your exercise program') + ' · BASE Health Noosa';
    var out = (offline ? '<p class="offline" role="status">No connection: this is the copy saved on this phone.</p>' : '') +
      '<h1>' + esc(first ? first + '’s exercise program' : 'Your exercise program') + '</h1>' +
      '<p class="by">' + esc((who ? 'From ' + who + ' at BASE Health Noosa' : 'From BASE Health Noosa') + (nice(p.date) ? ' · ' + nice(p.date) : '')) + '</p>' +
      (title ? '<p class="title">' + esc(title) + '</p>' : '') +
      (weeks || review ? '<ul class="cover">' + (weeks ? '<li><b>Block</b> ' + weeks + (weeks === 1 ? ' week' : ' weeks') + '</li>' : '') + (review ? '<li><b>Next review</b> ' + esc(review) + '</li>' : '') + '</ul>' : '') +
      (reason || instr ? '<section class="box">' + (reason ? '<h2>Why this plan</h2><p>' + esc(reason) + '</p>' : '') + (instr ? '<h2>Instructions</h2><p>' + esc(instr) + '</p>' : '') + '</section>' : '');
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
  function ended() {
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

  // ---- start: the key from the link (or the last one opened on this phone), the saved copy at once, then the store's
  function start() {
    var key = keyFromUrl() || (KEY_RE.test(String(getJson(LAST) || '')) ? getJson(LAST) : '');
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
    if (saved) render(saved, false);
    fetchCopy(key).then(function (r) {
      if (r.gone === 'missing' && !saved) { missing(); return; }
      if (r.gone || expired(r.expires)) { setJson(COPY + key, null); ended(); return; }
      var copy = { program: r.program, expires: r.expires, at: new Date().toISOString() };
      setJson(COPY + key, copy);
      render(copy, false);
    }, function () {
      if (saved) render(saved, true);
      else problem(navigator.onLine === false ? 'No connection. Connect to the internet to open your program the first time.' : 'Your program couldn’t be loaded just now. Try again in a moment.', true);
    });
  }
  window.addEventListener('hashchange', start);
  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) { /* fine */ } }
  start();
})();
