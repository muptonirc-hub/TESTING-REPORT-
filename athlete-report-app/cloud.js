/* BASE Health Report: the clinic store (v13).
   One shared business login (Firebase Authentication, email + password) and one Firestore database in Sydney hold the
   client records for every device. This file talks to Google's REST endpoints with fetch and JSON only (no SDK):
   - Identity Toolkit for the sign-in and Secure Token for refreshing the hour-long id token,
   - Firestore for the records: one document per saved session in `sessions`, safety copies in `history`,
     the clinic's Claude key in `meta/settings`.
   The device keeps a full cache of the records (bh-athlete-report-cloud-v1) so the app works on poor Wi-Fi, and a
   queue of writes that have not reached Firestore yet (bh-athlete-report-pending-v1): a sync pushes the queue, then
   pulls what changed since the last pull. Local mode (no projectId in cloud-config.js) means none of this runs and the
   records stay in bh-athlete-report-clients-v1 as before. Nothing here logs tokens or the password.
   v15: two more collections shared by the clinic, `library` (the exercise library: the clinic's own exercises, edited
   starter entries and tombstones that hide deleted ones) and `templates` (program templates), one document per id.
   putDoc / deleteDoc queue a full write or a tombstone and update the cache at once; a pull brings sessions, then the
   library, then the templates, each with its own cursor; a push commits the results (and their history copies) first,
   then the library, then the templates, in separate commits, so a refusal on one collection never holds back another.
   v34: Cloud Storage for Firebase holds the library's photos and videos (media.upload / media.remove), with the same
   login: one multipart request per file, as the Firebase SDK's uploadBytes sends it, and the file's address with its
   download token in the answer. */
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
  // v15: the clinic's shared documents (cache[coll] = { <id>: entry | { id, deleted: true } }) and the push order: each
  // group goes in commits of its own, the results first
  var DOC_COLLS = ['library', 'templates'];
  var PUSH_ORDER = [['sessions', 'history'], ['library'], ['templates']];
  var DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/;    // safe as a Firestore document id (no '/', never '__x__')
  // v34: the project's default bucket (since late 2024 a new one is <projectId>.firebasestorage.app; cloud-config.js may
  // name another as storageBucket) and the Firebase Storage REST address the SDK uses
  var BUCKET = String(cfg.storageBucket || (projectId ? projectId + '.firebasestorage.app' : '')).trim();
  var STORAGE = 'https://firebasestorage.googleapis.com/v0/b/' + encodeURIComponent(BUCKET) + '/o';
  var MEDIA_PATH = /^library\/[A-Za-z0-9][A-Za-z0-9_-]{0,149}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

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
  // { v: 1, email, syncedAt, cursorName, clients, legacy, library, templates, cursors: { library: { at, name }, templates } }
  // (syncedAt / cursorName stay the sessions' cursor, as in v13)
  var cache = null;
  var pending = [];                                    // [ { sid, kind, coll, doc, at } ] in order
  var listeners = [];
  var syncing = null, again = false, lastSyncAt = 0, retryTimer = null, backoffMs = 0;
  // waited: results (sessions) could not be sent at some point, so their upload gets a toast; deniedColls: the
  // collections the store refused in the last sync (denied = any)
  var status = { offline: false, failed: false, denied: false, deniedColls: [], waited: false, error: '' };
  var refreshing = null;

  function emit(evt) {
    listeners.forEach(function (fn) { try { fn(evt); } catch (e) { /* one listener failing must not stop the others */ } });
  }
  function freshCursor() { return { at: '', name: '' }; }
  function freshCache(email) {
    return { v: 1, email: email || '', syncedAt: '', cursorName: '', clients: {}, legacy: 'pending',
      library: {}, templates: {}, cursors: { library: freshCursor(), templates: freshCursor() } };
  }
  function isMap(m) { return !!m && typeof m === 'object' && !Array.isArray(m); }
  function loadCache() {
    var c = getJson(CACHE);
    if (c && c.v === 1 && c.clients && typeof c.clients === 'object' && !Array.isArray(c.clients)) {
      c.email = String(c.email || ''); c.syncedAt = String(c.syncedAt || ''); c.cursorName = String(c.cursorName || '');
      if (c.legacy !== 'uploaded' && c.legacy !== 'never') c.legacy = 'pending';
      // v15: a cache from v14 or earlier has no library, templates or cursors: start them empty, so the first pull
      // fetches every document of the two collections (a damaged map is rebuilt the same way)
      var cur = isMap(c.cursors) ? c.cursors : {};
      c.cursors = {};
      DOC_COLLS.forEach(function (k) {
        var ok = isMap(c[k]), m = {};
        if (ok) Object.keys(c[k]).forEach(function (id) { if (isMap(c[k][id])) m[id] = c[k][id]; });
        c[k] = m;
        var cr = ok && isMap(cur[k]) ? cur[k] : {};
        c.cursors[k] = { at: String(cr.at || ''), name: String(cr.name || '') };
        if (!c.cursors[k].at) c.cursors[k].name = '';
      });
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
      if (!cache || cache.email !== auth.email) { cache = freshCache(auth.email); overlayPending(); saveCache(); }
      lastSyncAt = 0; backoffMs = 0;
      status = { offline: false, failed: false, denied: false, deniedColls: [], waited: resultsWaiting() > 0, error: '' };
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
  // (v15: the library and templates go with the cache; the starter file still shows after the next sign-in)
  function signOut(message) {
    auth = null;
    drop(AUTH); drop(CACHE);
    cache = freshCache('');
    clearTimeout(retryTimer); retryTimer = null;
    status = { offline: false, failed: false, denied: false, deniedColls: [], waited: resultsWaiting() > 0, error: '' };
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

  // ------------------------------------------------------------------ v34: Cloud Storage (the library's photos and videos)
  // XMLHttpRequest (not fetch) so an upload reports its progress; Authorization: Firebase <id token>, as the SDK sends it.
  // A 401 refreshes the token and tries once more. Resolves { status, json } for any answer; rejects { code: 'network' }
  // when nothing came back and { code: 'aborted' } when stopped (opts.signal.abort()).
  function storageSend(method, url, body, headers, opts, retried) {
    opts = opts || {};
    return ensureToken().then(function (tok) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader('Authorization', 'Firebase ' + tok);
        Object.keys(headers || {}).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
        if (opts.onProgress && xhr.upload) xhr.upload.onprogress = function (e) { if (e.lengthComputable && e.total) opts.onProgress(e.loaded / e.total); };
        xhr.onload = function () {
          var j = null;
          try { j = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
          resolve({ status: xhr.status, json: j });
        };
        xhr.onerror = function () { reject({ code: 'network', message: 'no connection' }); };
        xhr.onabort = function () { reject({ code: 'aborted', message: 'stopped' }); };
        if (opts.signal) opts.signal.abort = function () { try { xhr.abort(); } catch (e) { /* already done */ } };
        xhr.send(body === undefined ? null : body);
      });
    }).then(function (r) {
      if (r.status === 401 && !retried) return refresh().then(function () { return storageSend(method, url, body, headers, opts, true); });
      return r;
    });
  }
  // what went wrong, for the app's message: 'offline', 'signed-out', 'plan' (Spark answers 402: no buckets without the
  // pay-as-you-go plan), 'denied' (403: the storage rules, or no bucket access), 'nobucket' (404), 'toobig' (413), 'http'
  function storageError(r) {
    var st = r && r.status, code = st === 402 ? 'plan' : st === 403 ? 'denied' : st === 404 ? 'nobucket' : st === 413 ? 'toobig' : 'http';
    return { code: code, status: st || 0, message: googleMessage(r) };
  }
  function mediaUrl(path, token) { return STORAGE + '/' + encodeURIComponent(path) + '?alt=media&token=' + encodeURIComponent(token); }
  // upload a file to path ('library/<entry id>/<file>'): { path, url, size }; the address carries the download token
  // (anyone holding it can download that one file, which the phone page will use). Files never change once uploaded
  // (a new one gets a new name), so they may be cached for a year.
  function upload(path, blob, contentType, opts) {
    if (!enabled || !BUCKET) return Promise.reject({ code: 'local', message: 'no clinic store' });
    if (!auth) return Promise.reject({ code: 'signed-out', message: 'signed out' });
    if (!MEDIA_PATH.test(String(path))) return Promise.reject({ code: 'path', message: 'bad path' });
    var type = /^[a-z]+\/[a-z0-9.+-]+$/i.test(contentType || '') ? contentType : 'application/octet-stream';
    var boundary = 'bh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    var meta = JSON.stringify({ name: path, contentType: type, cacheControl: 'public, max-age=31536000, immutable' });
    var body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=utf-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: ' + type + '\r\n\r\n',
      blob, '\r\n--' + boundary + '--']);
    return storageSend('POST', STORAGE + '?name=' + encodeURIComponent(path), body,
      { 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': 'multipart/related; boundary=' + boundary }, opts).then(function (r) {
      var tokens = r.json && typeof r.json.downloadTokens === 'string' ? r.json.downloadTokens.split(',').filter(Boolean) : [];
      if (r.status >= 200 && r.status < 300 && tokens.length) return { path: path, url: mediaUrl(path, tokens[0]), size: +(r.json.size || 0) || blob.size };
      throw storageError(r);
    });
  }
  // delete a file: true when it has gone (or was never there), false when the store couldn't be reached or refused
  function removeFile(path) {
    if (!enabled || !BUCKET || !auth || !MEDIA_PATH.test(String(path))) return Promise.resolve(false);
    return storageSend('DELETE', STORAGE + '/' + encodeURIComponent(path)).then(function (r) {
      return r.status === 200 || r.status === 204 || r.status === 404;
    }, function () { return false; });
  }

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
    if (navigator.onLine === false && resultsWaiting()) status.waited = true;
    emit({ kind: 'status' });
  }
  function putSession(key, name, sess) { queueWrite({ sid: sid(key, sess.tool, sess.date), kind: 'put', coll: 'sessions', doc: docFields(key, name, sess, false) }); }
  function tombstone(key, name, sess) { queueWrite({ sid: sid(key, sess.tool, sess.date), kind: 'tombstone', coll: 'sessions', doc: docFields(key, name, sess, true) }); }
  // the version being replaced goes to history/<sid>_<savedAt>: a cheap safety net
  function historyCopy(key, name, sess) { queueWrite({ sid: sid(key, sess.tool, sess.date) + '_' + String(sess.savedAt || ''), kind: 'put', coll: 'history', doc: docFields(key, name, sess, false) }); }
  function setting(claudeKey) { queueWrite({ sid: 'settings', kind: 'setting', coll: 'meta', doc: { claudeKey: { stringValue: String(claudeKey || '') } } }); }
  // a write for this collection + document id is still waiting (its own newer version must not be overwritten by a pull)
  function isPending(coll, id) {
    return pending.some(function (x) { return x.coll === coll && x.sid === id; });
  }
  function settingPending() { return pending.some(function (x) { return x.kind === 'setting'; }); }
  function resultsWaiting() { return pending.filter(function (x) { return x.coll === 'sessions'; }).length; }
  function changesWaiting(coll) {                      // library / template writes in the queue (one collection or both)
    return pending.filter(function (x) { return coll ? x.coll === coll : DOC_COLLS.indexOf(x.coll) >= 0; }).length;
  }
  function dropPending(items) {
    pending = pending.filter(function (x) { return items.indexOf(x) < 0; });
    savePending();
  }

  // v15: library entries and templates. A document per id: id, name (the entry's name or the template's title),
  // deleted, data (the entry / template as JSON), updatedBy, device and updatedAt (server time). A save writes the whole
  // object; a delete writes a tombstone (deleted true, data { id, deleted: true }), which also hides a starter exercise.
  function docCollOk(coll) { return DOC_COLLS.indexOf(coll) >= 0; }
  function docIdOk(id) { return typeof id === 'string' && DOC_ID.test(id); }
  function docTitle(coll, obj) {
    var v = obj ? (coll === 'templates' ? obj.title : obj.name) : '';
    return typeof v === 'string' ? v : '';
  }
  function libFields(coll, id, obj, deleted, title) {
    var by = !deleted && obj && typeof obj.updatedBy === 'string' && obj.updatedBy ? obj.updatedBy : getStr(USER);
    return {
      id: { stringValue: id }, name: { stringValue: String(title || '') }, deleted: { booleanValue: !!deleted },
      data: { stringValue: JSON.stringify(obj) }, updatedBy: { stringValue: String(by || '') }, device: { stringValue: deviceId() }
    };
  }
  function putDoc(coll, id, obj) {
    if (!enabled || !docCollOk(coll) || !docIdOk(id) || !isMap(obj)) return false;
    if (obj.deleted === true) return deleteDoc(coll, id);
    var copy;
    try { copy = JSON.parse(JSON.stringify(obj)); } catch (e) { return false; }
    if (!isMap(copy)) return false;
    copy.id = id;                                      // the document's id is the entry's id
    cache[coll][id] = copy;
    saveCache();
    queueWrite({ sid: id, kind: 'put', coll: coll, doc: libFields(coll, id, copy, false, docTitle(coll, copy)) });
    return true;
  }
  function deleteDoc(coll, id) {
    if (!enabled || !docCollOk(coll) || !docIdOk(id)) return false;
    var was = cache[coll][id], tomb = { id: id, deleted: true };
    cache[coll][id] = tomb;
    saveCache();
    queueWrite({ sid: id, kind: 'tombstone', coll: coll, doc: libFields(coll, id, tomb, true, docTitle(coll, was)) });
    return true;
  }
  // the queued library / template writes shown in a cache built afresh (after a sign-in): they are this device's newest
  function overlayPending() {
    pending.forEach(function (x) {
      if (!docCollOk(x.coll) || !cache || !isMap(cache[x.coll])) return;
      var obj = null;
      try { obj = JSON.parse(str(x.doc && x.doc.data)); } catch (e) { obj = null; }
      if (isMap(obj)) { obj.id = x.sid; cache[x.coll][x.sid] = obj.deleted === true ? { id: x.sid, deleted: true } : obj; }
    });
  }

  // ------------------------------------------------------------------ push: the queue to Firestore
  // round = { denied: [collections the store refused this sync], message }: a 403 (the rules) is about one collection, so
  // it is noted and the other collections carry on; any other failure (network, 5xx, 429) stops the sync as in v13
  function refuse(round, colls, r) {
    colls.forEach(function (c) { if (round.denied.indexOf(c) < 0) round.denied.push(c); });
    round.message = googleMessage(r);
  }
  // the queue's writes in commits: results and their history copies first, then the library, then the templates, each
  // group in commits of its own (anything from a collection this version doesn't know goes last); then the settings
  function push(round) {
    var items = pending.slice(), groups = [], settings = [], out = { all: items.length, sent: 0, results: 0 };
    var known = [].concat.apply([], PUSH_ORDER), extra = [];
    items.forEach(function (it) {
      if (it.kind === 'setting') settings.push(it);
      else if (known.indexOf(it.coll) < 0 && extra.indexOf(it.coll) < 0) extra.push(it.coll);
    });
    PUSH_ORDER.concat(extra.map(function (c) { return [c]; })).forEach(function (colls) {
      var g = items.filter(function (it) { return it.kind !== 'setting' && colls.indexOf(it.coll) >= 0; });
      if (g.length) groups.push({ colls: colls, items: g });
    });
    var p = Promise.resolve();
    groups.forEach(function (g) {
      var refused = false;
      for (var i = 0; i < g.items.length; i += MAX_WRITES) {
        (function (chunk) {
          p = p.then(function () {
            if (refused) return;
            var body = { writes: chunk.map(function (it) {
              return { update: { name: DOCS + '/' + it.coll + '/' + it.sid, fields: it.doc }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] };
            }) };
            return fs('POST', ':commit', body).then(function (r) {
              if (r.status === 403) {
                refused = true;
                refuse(round, g.colls.filter(function (c) { return chunk.some(function (it) { return it.coll === c; }); }), r);
                return;
              }
              if (r.status !== 200) throw httpError(r);
              dropPending(chunk);
              out.sent += chunk.length;
              out.results += chunk.filter(function (it) { return it.coll === 'sessions'; }).length;
            });
          });
        })(g.items.slice(i, i + MAX_WRITES));
      }
    });
    settings.forEach(function (it) {
      p = p.then(function () {
        return fs('PATCH', '/meta/settings', { fields: it.doc }, 'updateMask.fieldPaths=claudeKey').then(function (r) {
          if (r.status === 403) { refuse(round, ['meta'], r); return; }
          if (r.status !== 200) throw httpError(r);
          dropPending([it]);
          out.sent += 1;
        });
      });
    });
    // a failure after some commits went through still says what was sent (the results' toast depends on it)
    return p.then(function () { return out; }, function (err) {
      if (err && typeof err === 'object') err.sent = out;
      throw err;
    });
  }

  // ------------------------------------------------------------------ pull: what changed since the last pull
  function applyDoc(d) {
    var f = d.fields || {}, docSid = String(d.name || '').split('/').pop();
    var key = str(f.clientKey), tool = str(f.tool), date = str(f.date);
    if (!key || !tool || !date) return false;
    if (isPending('sessions', docSid)) return false;   // this device's own newer version is still on its way
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
  // v15: a library or template document into the cache: the object (its id from the document), or the tombstone
  function applyEntry(coll, d) {
    var f = d.fields || {}, id = String(d.name || '').split('/').pop(), next = null;
    if (!id || isPending(coll, id)) return false;      // this device's own newer version is still on its way
    if (f.deleted && f.deleted.booleanValue === true) next = { id: id, deleted: true };
    else {
      try { next = JSON.parse(str(f.data)); } catch (e) { next = null; }
      if (!isMap(next)) return false;
      next.id = id;                                    // the document's identity wins over its payload
      if (next.deleted === true) next = { id: id, deleted: true };
    }
    var map = cache[coll];
    if (map[id] && JSON.stringify(map[id]) === JSON.stringify(next)) return false;
    map[id] = next;
    return true;
  }
  // every document of one collection changed since its cursor ({ at, name }: the updatedAt and resource name of the
  // last document seen), in pages ordered by (updatedAt, __name__); the cursor moves on as each page is applied.
  // A 403 notes the collection as refused and leaves its cursor; other failures are thrown. changed[coll] = true as soon
  // as a document changes the cache (so a later failure still announces what did arrive).
  function pullColl(coll, cur, apply, round, changed) {
    var limit = api.pageSize;
    function page(cursor) {
      var q = {
        from: [{ collectionId: coll }],
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: limit
      };
      if (cursor) q.startAt = { values: [{ timestampValue: cursor.at }, { referenceValue: cursor.name }], before: false };
      else if (cur.at) q.where = { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { timestampValue: cur.at } } };
      return fs('POST', ':runQuery', { structuredQuery: q }).then(function (r) {
        if (r.status === 403) { refuse(round, [coll], r); return; }
        if (r.status !== 200) throw httpError(r);
        var docs = [];
        (Array.isArray(r.json) ? r.json : []).forEach(function (row) { if (row && row.document && row.document.name) docs.push(row.document); });
        docs.forEach(function (d) { if (apply(d)) changed[coll] = true; });
        if (docs.length) {
          var last = docs[docs.length - 1], at = last.fields && last.fields.updatedAt && last.fields.updatedAt.timestampValue;
          cur.at = String(at || last.updateTime || cur.at);
          cur.name = String(last.name);
        }
        if (docs.length >= limit) return page({ at: cur.at, name: cur.name });
      });
    }
    return page(null);
  }
  // sessions (as in v13: syncedAt / cursorName), then the library, then the templates. Whatever arrived is saved even
  // when a later request fails, and the app hears { kind: 'cache' } (sessions), 'library', 'templates', in that order.
  function pull(round) {
    var changed = {}, mine = cache;
    var sc = { at: cache.syncedAt, name: cache.cursorName };   // moves on with each page applied
    var p = pullColl('sessions', sc, applyDoc, round, changed);
    DOC_COLLS.forEach(function (coll) {
      p = p.then(function () {
        if (cache !== mine) return;                    // signed out meanwhile: this cache is gone
        return pullColl(coll, cache.cursors[coll], function (d) { return applyEntry(coll, d); }, round, changed);
      });
    });
    function done() {
      if (cache !== mine) return;
      cache.syncedAt = sc.at; cache.cursorName = sc.name;
      saveCache();
      if (changed.sessions) emit({ kind: 'cache' });
      DOC_COLLS.forEach(function (coll) { if (changed[coll]) emit({ kind: coll }); });
    }
    return p.then(done, function (err) { done(); throw err; });
  }
  // the clinic's Claude key, read after each pull (never while this device's own change to it is still queued)
  function pullSettings(round) {
    if (settingPending()) return Promise.resolve();
    return fs('GET', '/meta/settings').then(function (r) {
      if (r.status === 404) { emit({ kind: 'settings', key: null }); return; }
      if (r.status === 403) { refuse(round, ['meta'], r); return; }
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
    if (resultsWaiting()) status.waited = true;
    if (err && err.code === 'http' && err.status === 403) { status.denied = true; status.failed = false; status.error = err.message; }
    else if (err && (err.code === 'http' || err.code === 'refresh')) { status.failed = true; status.error = err.message || ''; scheduleRetry(); }
    else { status.offline = true; status.error = ''; scheduleRetry(); }
    emit({ kind: 'status' });
  }
  // the collections refused in this sync (v13 showed any refusal as "denied"; deniedColls says which ones)
  function setDenied(round) {
    status.deniedColls = round.denied.slice();
    status.denied = round.denied.length > 0;
    status.error = status.denied ? String(round.message || '') : '';
    if (status.denied && resultsWaiting()) status.waited = true;
  }
  function sync(opts) {
    opts = opts || {};
    if (!enabled || !auth) return Promise.resolve(false);
    if (opts.throttle && lastSyncAt && Date.now() - lastSyncAt < api.throttleMs) return Promise.resolve(false);
    if (syncing) { again = true; return syncing; }
    lastSyncAt = Date.now();
    clearTimeout(retryTimer); retryTimer = null;
    var waited = status.waited, round = { denied: [], message: '' };
    syncing = push(round).then(function (sent) {
      status.offline = false; status.failed = false;
      setDenied(round);
      if (sent.sent) {
        if (!resultsWaiting()) status.waited = false;
        emit({ kind: 'status' });
        if (waited && sent.results) emit({ kind: 'uploaded', n: sent.results });   // the toast counts results only
      }
      return pull(round);
    }).then(function () {
      return pullSettings(round);
    }).then(function () {
      backoffMs = 0;
      status.offline = false; status.failed = false;
      setDenied(round);
      emit({ kind: 'status' });
      emit({ kind: 'synced' });
      return true;
    }, function (err) {
      var sent = err && err.sent;                      // the push stopped part-way (e.g. the library after the results)
      if (sent && sent.sent) {
        if (!resultsWaiting()) status.waited = false;
        if (waited && sent.results) emit({ kind: 'uploaded', n: sent.results });
      }
      if (round.denied.length) setDenied(round);       // refusals learnt before the failure (else, as v13, left as they were)
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
    // v15: putDoc('library' | 'templates', id, obj) queues a full write, deleteDoc(coll, id) a tombstone; both update
    // cache[coll][id] at once and return true (false: local mode, another collection, an unusable id or object)
    putDoc: putDoc,
    deleteDoc: deleteDoc,
    // results waiting: the session documents in the queue (history copies and the settings write ride along uncounted)
    pendingCount: resultsWaiting,
    // pending: results waiting; changes: library + template writes waiting (changesBy per collection); denied: the store
    // refused something in the last sync, deniedColls: which collections ('sessions', 'history', 'library', 'templates', 'meta')
    status: function () {
      return { pending: resultsWaiting(), changes: changesWaiting(), changesBy: { library: changesWaiting('library'), templates: changesWaiting('templates') },
        queued: pending.length, offline: status.offline || navigator.onLine === false, failed: status.failed, denied: status.denied,
        deniedColls: status.deniedColls.slice(), error: status.error, syncing: !!syncing };
    },
    sync: sync,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    // v34: the library's photos and videos (Cloud Storage for Firebase, same login). ready(): signed in with a bucket;
    // base: the start of every file address in that bucket (to recognise ours)
    media: {
      bucket: BUCKET,
      base: STORAGE + '/',
      ready: function () { return enabled && !!BUCKET && !!auth; },
      pathOk: function (p) { return MEDIA_PATH.test(String(p)); },
      upload: upload,
      remove: removeFile
    }
  };
  if (enabled) {
    auth = loadAuth();
    cache = loadCache();
    pending = loadPending();
    if (auth && cache.email && cache.email !== auth.email) { cache = freshCache(auth.email); overlayPending(); saveCache(); }
    if (!auth) cache = freshCache('');                 // signed out: the cache is gone with the sign-out
    status.waited = resultsWaiting() > 0;
    window.addEventListener('online', function () { status.offline = false; emit({ kind: 'status' }); sync(); });
    window.addEventListener('offline', function () { status.offline = true; emit({ kind: 'status' }); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync({ throttle: true }); });
  } else {
    cache = freshCache('');
  }
  Object.defineProperty(api, 'cache', { get: function () { return cache; }, enumerable: true });
  window.BHCloud = api;
})();
