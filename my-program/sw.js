/* BASE Health Noosa: the client's program page (v35), kept on the phone so it opens without a connection. Online it
   asks the server first (an update shows straight away); offline, or when the network takes more than 4 seconds, it
   uses the saved copy. The clinic store and the photos and videos are on other origins: never cached or intercepted
   here (the page keeps its own copy of the program; the browser's cache keeps the pictures). */
var CACHE = 'bh-program-v1';
var FILES = ['./', 'index.html', 'program.js', 'manifest.webmanifest', '../athlete-report-app/cloud-config.js',
  '../athlete-report-app/rajdhani-700.woff2', '../athlete-report-app/icon-192.png', '../athlete-report-app/apple-touch-icon.png'];
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (f) { return c.add(new Request(f, { cache: 'reload' })).catch(function () { return null; }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('bh-program-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(new Promise(function (resolve, reject) {
    var done = false, timer = setTimeout(function () { if (!done) fallback(); }, 4000);
    function fallback() {
      done = true;
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return resolve(hit);
        if (req.mode === 'navigate') return caches.match('index.html').then(function (i) { if (i) resolve(i); else reject(new Error('offline')); });
        reject(new Error('offline'));
      });
    }
    fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then(function (res) {
      if (done) return;
      done = true; clearTimeout(timer);
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      resolve(res);
    }, function () { if (!done) { clearTimeout(timer); fallback(); } });
  }));
});
