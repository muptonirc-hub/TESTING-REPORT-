// The app has moved to base-health-report.web.app. This takes the place of the old offline copy's service worker on
// this address: it clears the copies saved here, removes itself and reloads the page, which then says where the app is.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys()
    .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.registration.unregister(); })
    .then(function () { return self.clients.matchAll({ type: 'window' }); })
    .then(function (clients) { clients.forEach(function (c) { try { c.navigate(c.url); } catch (e) { /* fine */ } }); }));
});
