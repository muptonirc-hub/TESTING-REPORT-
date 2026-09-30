/* BASE Health Report: the clinic store (v13).
   One shared business login (Firebase Authentication, email + password) and one Firestore database in Sydney hold the
   client records for every device. This file talks to Google's REST endpoints with fetch and JSON only (no SDK):
   - Identity Toolkit for the sign-in and Secure Token for refreshing the hour-long id token,
   - Firestore for the records: one document per saved session in `sessions`, safety copies in `history`,
     the clinic's Claude key in `meta/settings`.
   The device keeps a full cache of the records (bh-athlete-report-cloud-v1) so the app works on poor Wi-Fi, and a
   queue of writes that have not reached Firestore yet (bh-athlete-report-pending-v1): a sync pushes the queue, then
   pulls what changed since the last pull. Local mode (no projectId in cloud-config.js) means none of this runs and the
   records stay in bh-athlete-report-clients-v1 as before. Nothing here logs tokens or the password. */
(function () {
  'use strict';
  var cfg = window.BH_CLOUD || {};
  var projectId = String(cfg.projectId || '').trim(), apiKey = String(cfg.apiKey || '').trim();
  var enabled = !!projectId;
  var AUTH = 'bh-athlete-report-auth-v1', USER = 'bh-athlete-report-user-v1', CACHE = 'bh-athlete-report-cloud-v1',
    PENDING = 'bh-athlete-report-pending-v1', DEVICE = 'bh-athlete-report-device-v1';
  var SIGNIN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=';
  var TOKEN_URL = 'https://securetoken.googleapis.com/v1/token?key=';
  var DOCS = 'projects/' + projectId + '/databases/(default)/documents';       // the resource-name prefix of every document
  var BASE = 'https://firestore.googleapis.com/v1/' + DOCS;
  var REFRESH_AHEAD_MS = 5 * 60 * 1000;                // refresh the id token when it has less than this left
  var REQUEST_TIMEOUT_MS = 25000;
  var MAX_WRITES = 400;                                // writes per commit (Firestore's limit is 500)

  // ------------------------------------------------------------------ storage helpers
  function getJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function getStr(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function setStr(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
  function str(v) { return v && typeof v.stringValue === 'string' ? v.stringValue : ''; }
  function sortSessions(list) {                        // as E.sortSessions: by date, then by when it was saved
    return list.slice().sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : ((a.savedAt || '') < (b.savedAt || '') ? -1 : 1)); });
  }
  // the client's key (E.nameKey) as lower-case hex of its UTF-8 bytes: safe in a document id, the same on every device
  function utf8Hex(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      var bytes = c < 0x80 ? [c] : c < 0x800 ? [0xC0 | (c >> 6), 0x80 | (c & 63)]
        : c < 0x10000 ? [0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)]
          : [0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
      for (var j = 0; j < bytes.length; j++) out += (bytes[j] < 16 ? '0' : '') + bytes[j].toString(16);
    }
    return out;
  }
  function sid(key, tool, date) { return utf8Hex(String(key)) + '_' + tool + '_' + date; }
  function deviceId() {
    var id = getStr(DEVICE);
    if (id) return id;
    var r = '';
    try { var a = new Uint32Array(2); crypto.getRandomValues(a); r = a[0].toString(36) + a[1].toString(36); } catch (e) { r = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
    id = 'd' + Date.now().toString(36) + r;
    setStr(DEVICE, id);
    return id;
  }

  // ------------------------------------------------------------------ state
  var auth = null;                                     // { idToken, refreshToken, exp, email, uid }
  var cache = null;                                    // { v: 1, email, syncedAt, cursorName, clients, legacy }
  var pending = [];                                    // [ { sid, kind, coll, doc, at } ] in order
  var listeners = [];
  var syncing = null, again = false, lastSyncAt = 0, retryTimer = null, backoffMs = 0;
  var status = { offline: false, failed: false, denied: false, waited: false, error: '' };
  var refreshing = null;

  function emit(evt) {
    listeners.forEach(function (fn) { try { fn(evt); } catch (e) { /* one listener failing must not stop the others */ } });
  }
  function freshCache(email) { return { v: 1, email: email || '', syncedAt: '', cursorName: '', clients: {}, legacy: 'pending' }; }
  function loadCache() {
    var c = getJson(CACHE);
    if (c && c.v === 1 && c.clients && typeof c.clients === 'object' && !Array.isArray(c.clients)) {
      c.email = String(c.email || ''); c.syncedAt = String(c.syncedAt || ''); c.cursorName = String(c.cursorName || '');
      if (c.legacy !== 'uploaded' && c.legacy !== 'never') c.legacy = 'pending';
      return c;
    }
    return freshCache(auth ? auth.email : '');
  }
  function saveCache() {
    if (!setJson(CACHE, cache)) return false;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* optional */ }
    return true;
  }
  function loadPending() {
    var p = getJson(PENDING);
    return Array.isArray(p) ? p.filter(function (x) { return x && typeof x === 'object' && x.sid && x.kind && x.doc && typeof x.doc === 'object'; }) : [];
  }
  function savePending() { setJson(PENDING, pending); }
  function loadAuth() {
    var a = getJson(AUTH);
    return a && typeof a.idToken === 'string' && a.idToken && typeof a.refreshToken === 'string' && a.refreshToken
      ? { idToken: a.idToken, refreshToken: a.refreshToken, exp: +a.exp || 0, email: String(a.email || ''), uid: String(a.uid || '') } : null;
  }
  function saveAuth() { setJson(AUTH, auth); }

  // ------------------------------------------------------------------ HTTP
  // one request with a JSON body (or a form-encoded one: form = true, as the token endpoint documents); resolves
  // { status, json } for any HTTP answer, rejects { code: 'network' } when nothing came back
  function request(url, method, body, headers, form) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    var opts = { method: method, cache: 'no-store', headers: headers || {}, signal: ctrl ? ctrl.signal : undefined };
    if (body !== undefined && form) {
      opts.headers['content-type'] = 'application/x-www-form-urlencoded';
      opts.body = Object.keys(body).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(body[k]); }).join('&');
    } else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (raw) {
        var j = null;
        try { j = JSON.parse(raw); } catch (e) { /* not JSON */ }
        return { status: res.status, json: j };
      }, function () { return { status: res.status, json: null }; });
    }, function () {
      throw { code: 'network', message: 'no connection' };
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function googleMessage(r) {                          // { error: { message } } -> the message, else the status
    var e = r && r.json && r.json.error;
    return e && typeof e.message === 'string' && e.message ? e.message : ('HTTP ' + (r ? r.status : 0));
  }

  // ------------------------------------------------------------------ sign in, refresh, sign out
  function signIn(email, password) {
    email = String(email || '').trim().toLowerCase();
    return request(SIGNIN_URL + encodeURIComponent(apiKey), 'POST', { email: email, password: String(password || ''), returnSecureToken: true }).then(function (r) {
      var j = r.json || {};
      if (r.status !== 200 || !j.idToken || !j.refreshToken) {
        var msg = googleMessage(r);
        throw { code: msg.split(/[\s:]/)[0], message: msg, status: r.status };
      }
      auth = { idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (parseInt(j.expiresIn, 10) || 3600) * 1000, email: String(j.email || email).toLowerCase(), uid: String(j.localId || '') };
      saveAuth();
      if (!cache || cache.email !== auth.email) { cache = freshCache(auth.email); saveCache(); }
      lastSyncAt = 0; backoffMs = 0;
      status = { offline: false, failed: false, denied: false, waited: pending.length > 0, error: '' };
      emit({ kind: 'auth', email: auth.email });
      return { email: auth.email, uid: auth.uid };
    });
  }
  // a new id token from the refresh token; a 400 (TOKEN_EXPIRED, INVALID_REFRESH_TOKEN, USER_DISABLED, ...) means this
  // device must sign in again
  function refresh() {
    if (refreshing) return refreshing;
    if (!auth) return Promise.reject({ code: 'signed-out' });
    var mine = auth;
    refreshing = request(TOKEN_URL + encodeURIComponent(apiKey), 'POST', { grant_type: 'refresh_token', refresh_token: mine.refreshToken }, null, true).then(function (r) {
      var j = r.json || {};
      if (r.status === 200 && j.id_token) {
        if (auth === mine) {
          auth.idToken = j.id_token;
          if (j.refresh_token) auth.refreshToken = j.refresh_token;
          auth.exp = Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000;
          if (j.user_id) auth.uid = String(j.user_id);
          saveAuth();
        }
        return auth;
      }
      if (r.status === 400) {
        signOut('Please sign in again.');
        throw { code: 'signed-out', message: googleMessage(r) };
      }
      throw { code: 'refresh', status: r.status, message: googleMessage(r) };   // 5xx, 429: try again later
    }).then(function (v) { refreshing = null; return v; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }
  function ensureToken() {
    if (!auth) return Promise.reject({ code: 'signed-out' });
    if (auth.exp - Date.now() >= REFRESH_AHEAD_MS) return Promise.resolve(auth.idToken);
    return refresh().then(function () { return auth.idToken; }, function (err) {
      if (err && err.code === 'signed-out') throw err;
      return auth.idToken;                             // the refresh didn't get through: try the token we have
    });
  }
  // signing out keeps the draft, the tests preference, the AI key cache, the practitioner name and the pending queue
  function signOut(message) {
    auth = null;
    drop(AUTH); drop(CACHE);
    cache = freshCache('');
    clearTimeout(retryTimer); retryTimer = null;
    status = { offline: false, failed: false, denied: false, waited: pending.length > 0, error: '' };
    emit({ kind: 'signout', message: message || '' });
  }

  // ------------------------------------------------------------------ Firestore requests
  // path: ':commit', ':runQuery' or '/meta/settings'. A 401 refreshes the token and retries once.
  function fs(method, path, body, query, retried) {
    return ensureToken().then(function (tok) {
      return request(BASE + path + (query ? '?' + query : ''), method, body, { 'Authorization': 'Bearer ' + tok });
    }).then(function (r) {
      if (r.status === 401 && !retried) return refresh().then(function () { return fs(method, path, body, query, true); });
      return r;
    });
  }
  function httpError(r) { return { code: 'http', status: r.status, message: googleMessage(r) }; }

  // ------------------------------------------------------------------ the queue
  function docFields(key, name, sess, deleted) {
    return {
      clientKey: { stringValue: String(key) }, name: { stringValue: String(name || '') },
      tool: { stringValue: String(sess.tool) }, date: { stringValue: String(sess.date) },
      savedAt: { stringValue: String(sess.savedAt || '') }, savedBy: { stringValue: String(sess.savedBy || '') },
      device: { stringValue: deviceId() }, deleted: { booleanValue: !!deleted },
      data: { stringValue: JSON.stringify(sess) }
    };
  }
  // one write waiting for Firestore; a newer write for the same document replaces the older one (a full replace anyway)
  function queueWrite(item) {
    item.coll = item.coll || 'sessions';
    item.at = new Date().toISOString();
    pending = pending.filter(function (x) {
      if (item.kind === 'setting') return x.kind !== 'setting';
      return x.kind === 'setting' || x.coll !== item.coll || x.sid !== item.sid;
    });
    pending.push(item);
    savePending();
    if (navigator.onLine === false) status.waited = true;
    emit({ kind: 'status' });
  }
  function putSession(key, name, sess) { queueWrite({ sid: sid(key, sess.tool, sess.date), kind: 'put', coll: 'sessions', doc: docFields(key, name, sess, false) }); }
  function tombstone(key, name, sess) { queueWrite({ sid: sid(key, sess.tool, sess.date), kind: 'tombstone', coll: 'sessions', doc: docFields(key, name, sess, true) }); }
  // the version being replaced goes to history/<sid>_<savedAt>: a cheap safety net
  function historyCopy(key, name, sess) { queueWrite({ sid: sid(key, sess.tool, sess.date) + '_' + String(sess.savedAt || ''), kind: 'put', coll: 'history', doc: docFields(key, name, sess, false) }); }
  function setting(claudeKey) { queueWrite({ sid: 'settings', kind: 'setting', coll: 'meta', doc: { claudeKey: { stringValue: String(claudeKey || '') } } }); }
  function isPending(sidValue) {
    return pending.some(function (x) { return x.coll === 'sessions' && x.sid === sidValue; });
  }
  function settingPending() { return pending.some(function (x) { return x.kind === 'setting'; }); }
  function resultsWaiting() { return pending.filter(function (x) { return x.coll === 'sessions'; }).length; }
  function dropPending(items) {
    pending = pending.filter(function (x) { return items.indexOf(x) < 0; });
    savePending();
  }

  // ------------------------------------------------------------------ push: the queue to Firestore
  function push() {
    var items = pending.slice(), writes = [], settings = [];
    items.forEach(function (it) { (it.kind === 'setting' ? settings : writes).push(it); });
    var p = Promise.resolve();
    for (var i = 0; i < writes.length; i += MAX_WRITES) {
      (function (chunk) {
        p = p.then(function () {
          var body = { writes: chunk.map(function (it) {
            return { update: { name: DOCS + '/' + it.coll + '/' + it.sid, fields: it.doc }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] };
          }) };
          return fs('POST', ':commit', body).then(function (r) {
            if (r.status !== 200) throw httpError(r);
            dropPending(chunk);
          });
        });
      })(writes.slice(i, i + MAX_WRITES));
    }
    settings.forEach(function (it) {
      p = p.then(function () {
        return fs('PATCH', '/meta/settings', { fields: it.doc }, 'updateMask.fieldPaths=claudeKey').then(function (r) {
          if (r.status !== 200) throw httpError(r);
          dropPending([it]);
        });
      });
    });
    return p.then(function () { return { all: items.length, results: items.filter(function (it) { return it.coll === 'sessions'; }).length }; });
  }

  // ------------------------------------------------------------------ pull: what changed since the last pull
  function applyDoc(d) {
    var f = d.fields || {}, docSid = String(d.name || '').split('/').pop();
    var key = str(f.clientKey), tool = str(f.tool), date = str(f.date);
    if (!key || !tool || !date) return false;
    if (isPending(docSid)) return false;               // this device's own newer version is still on its way
    var cl = cache.clients[key];
    if (f.deleted && f.deleted.booleanValue === true) {
      if (!cl) return false;
      var n = cl.sessions.length;
      cl.sessions = cl.sessions.filter(function (x) { return !(x.tool === tool && x.date === date); });
      if (!cl.sessions.length) delete cache.clients[key];
      return cl.sessions.length !== n;
    }
    var sess = null;
    try { sess = JSON.parse(str(f.data)); } catch (e) { sess = null; }
    if (!sess || typeof sess !== 'object' || Array.isArray(sess)) return false;
    sess.tool = tool; sess.date = date;                // the document's identity wins over its payload
    var name = str(f.name) || (cl ? cl.name : key);
    if (!cl) cl = cache.clients[key] = { name: name, sessions: [] };
    var changed = cl.name !== name;
    cl.name = name;                                    // documents arrive oldest change first: the last name applied is the newest
    var i = -1;
    cl.sessions.forEach(function (x, j) { if (x.tool === tool && x.date === date) i = j; });
    if (i < 0) { cl.sessions.push(sess); changed = true; }
    else if (JSON.stringify(cl.sessions[i]) !== JSON.stringify(sess)) { cl.sessions[i] = sess; changed = true; }
    cl.sessions = sortSessions(cl.sessions);
    return changed;
  }
  function pull() {
    var changed = false, got = 0, limit = api.pageSize;
    function page(cursor) {
      var q = {
        from: [{ collectionId: 'sessions' }],
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: limit
      };
      if (cursor) q.startAt = { values: [{ timestampValue: cursor.at }, { referenceValue: cursor.name }], before: false };
      else if (cache.syncedAt) q.where = { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { timestampValue: cache.syncedAt } } };
      return fs('POST', ':runQuery', { structuredQuery: q }).then(function (r) {
        if (r.status !== 200) throw httpError(r);
        var docs = [];
        (Array.isArray(r.json) ? r.json : []).forEach(function (row) { if (row && row.document && row.document.name) docs.push(row.document); });
        docs.forEach(function (d) { if (applyDoc(d)) changed = true; });
        got += docs.length;
        if (docs.length) {
          var last = docs[docs.length - 1], at = last.fields && last.fields.updatedAt && last.fields.updatedAt.timestampValue;
          cache.syncedAt = String(at || last.updateTime || cache.syncedAt);
          cache.cursorName = String(last.name);
        }
        if (docs.length >= limit) return page({ at: cache.syncedAt, name: cache.cursorName });
      });
    }
    return page(null).then(function () {
      saveCache();
      if (changed) emit({ kind: 'cache' });
      return got;
    });
  }
  // the clinic's Claude key, read after each pull (never while this device's own change to it is still queued)
  function pullSettings() {
    if (settingPending()) return Promise.resolve();
    return fs('GET', '/meta/settings').then(function (r) {
      if (r.status === 404) { emit({ kind: 'settings', key: null }); return; }
      if (r.status !== 200) throw httpError(r);
      emit({ kind: 'settings', key: str((r.json && r.json.fields || {}).claudeKey) });
    });
  }

  // ------------------------------------------------------------------ sync: push, then pull
  function scheduleRetry() {
    clearTimeout(retryTimer);
    backoffMs = backoffMs ? Math.min(backoffMs * 2, 5 * 60 * 1000) : 30000;
    retryTimer = setTimeout(function () { retryTimer = null; sync(); }, backoffMs);
  }
  function failed(err) {
    if (err && err.code === 'signed-out') return;
    if (pending.length) status.waited = true;
    if (err && err.code === 'http' && err.status === 403) { status.denied = true; status.failed = false; status.error = err.message; }
    else if (err && (err.code === 'http' || err.code === 'refresh')) { status.failed = true; status.error = err.message || ''; scheduleRetry(); }
    else { status.offline = true; status.error = ''; scheduleRetry(); }
    emit({ kind: 'status' });
  }
  function sync(opts) {
    opts = opts || {};
    if (!enabled || !auth) return Promise.resolve(false);
    if (opts.throttle && lastSyncAt && Date.now() - lastSyncAt < api.throttleMs) return Promise.resolve(false);
    if (syncing) { again = true; return syncing; }
    lastSyncAt = Date.now();
    clearTimeout(retryTimer); retryTimer = null;
    var waited = status.waited;
    syncing = push().then(function (sent) {
      status.offline = false; status.failed = false; status.denied = false; status.error = '';
      if (sent.all) {
        status.waited = false;
        emit({ kind: 'status' });
        if (waited && sent.results) emit({ kind: 'uploaded', n: sent.results });
      }
      return pull();
    }).then(function () {
      return pullSettings();
    }).then(function () {
      backoffMs = 0;
      status.offline = false; status.failed = false; status.denied = false; status.error = '';
      emit({ kind: 'status' });
      emit({ kind: 'synced' });
      return true;
    }, function (err) {
      failed(err);
      return false;
    }).then(function (ok) {
      syncing = null;
      if (again) { again = false; return sync(); }
      return ok;
    });
    return syncing;
  }

  // ------------------------------------------------------------------ the public face
  var api = {
    enabled: enabled,
    throttleMs: cfg.throttleMs != null ? +cfg.throttleMs : 30000,   // visibility and dialog triggers: at most one sync this often
    pageSize: cfg.pageSize != null ? +cfg.pageSize : 400,           // documents per pull page
    cache: null,
    sid: sid,
    signedIn: function () { return !!auth; },
    account: function () { return auth ? { email: auth.email, uid: auth.uid } : null; },
    userName: function () { return getStr(USER); },
    setUserName: function (name) { name = String(name == null ? '' : name).replace(/\s+/g, ' ').trim(); setStr(USER, name); return name; },
    deviceId: deviceId,
    signIn: signIn,
    signOut: function () { signOut(''); },
    saveCache: saveCache,
    putSession: putSession,
    tombstone: tombstone,
    historyCopy: historyCopy,
    setting: setting,
    // results waiting: the session documents in the queue (history copies and the settings write ride along uncounted)
    pendingCount: resultsWaiting,
    status: function () {
      return { pending: resultsWaiting(), queued: pending.length, offline: status.offline || navigator.onLine === false, failed: status.failed, denied: status.denied, error: status.error, syncing: !!syncing };
    },
    sync: sync,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };
  if (enabled) {
    auth = loadAuth();
    cache = loadCache();
    pending = loadPending();
    if (auth && cache.email && cache.email !== auth.email) { cache = freshCache(auth.email); saveCache(); }
    if (!auth) cache = freshCache('');                 // signed out: the cache is gone with the sign-out
    status.waited = pending.length > 0;
    window.addEventListener('online', function () { status.offline = false; emit({ kind: 'status' }); sync(); });
    window.addEventListener('offline', function () { status.offline = true; emit({ kind: 'status' }); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync({ throttle: true }); });
  } else {
    cache = freshCache('');
  }
  Object.defineProperty(api, 'cache', { get: function () { return cache; }, enumerable: true });
  window.BHCloud = api;
})();
