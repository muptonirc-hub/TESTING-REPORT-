/* BASE Health Report: offline support.
   Keeps a copy of the app on the device so it opens without a connection.
   Online it always asks the server first (so updated norms and app files show up straight away),
   falling back to the saved copy when offline or when the network takes longer than 4 seconds.
   Google's endpoints (the clinic store, v13) and the exercise videos (YouTube, Vimeo, v15) are on other origins, so they are
   never cached or intercepted here. v24 adds the evidence guide library (guides/); v25 two more guides; v26 a third. */
var CACHE = 'bh-athlete-report-v28';
var FILES = ['./', 'index.html', 'app.js?v=28', 'engine.js?v=28', 'qrcode.js?v=28', 'report.js?v=28', 'report-fonts.js?v=28', 'jspdf.umd.min.js?v=28', 'cloud-config.js?v=28', 'cloud.js?v=28',
  'norms.json', 'strength_norms.json', 'hamstring_norms.json', 'acl_norms.json', 'interpretation.json', 'explainers.json', 'exercise_library.json', 'programming_guide.md', 'manifest.webmanifest',
  'guides/index.json', 'guides/training-variables.md', 'guides/rehab-principles.md', 'guides/muscle-strains.md', 'guides/acl.md', 'guides/tendinopathy.md', 'guides/ankle-sprain.md',
  'guides/groin-pain.md', 'guides/rotator-cuff.md', 'guides/pfp-oa.md', 'guides/low-back-pain.md', 'guides/performance-tests.md', 'guides/rehab-performance.md', 'guides/block-design.md',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'rajdhani-600.woff2', 'rajdhani-700.woff2'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        // one file missing from the upload shouldn't stop the rest being saved for offline use
        return Promise.all(FILES.map(function (f) { return cache.add(new Request(f, { cache: 'reload' })).catch(function () { return null; }); }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

function fromNetwork(request, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
    var target = request.mode === 'navigate' ? request.url : request;
    fetch(target, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
      clearTimeout(timer); resolve(res);
    }, function (err) { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fromNetwork(request, 4000).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match('index.html');
        return fetch(request);
      });
    })
  );
});
