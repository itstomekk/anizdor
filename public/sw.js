// Offline support: network first, cache as fallback. Only same-origin GETs. No family data passes through here (it lives in localStorage).
const CACHE = 'rodzina-v4';
const FILES = ['./', 'index.html', 'style.css', 'viz.css', 'visualizations.js', 'views_viz.js', 'app.js', 'ui.js', 'gedcom.js', 'tree.js', 'dates.js', 'ops.js', 'stats.js', 'checks.js', 'kin.js', 'extras.js', 'media.js', 'reports.js', 'views_extra.js', 'demo.ged', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
