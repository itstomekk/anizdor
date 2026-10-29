// Offline support: network first, cache as fallback. Only same-origin GETs. The /api/ cloud calls are never cached.
const CACHE = 'anizdor-v12';
const FILES = ['./', 'index.html', 'style.css', 'viz.css', 'theme.css', 'fonts.css', 'fonts/inter-latin.woff2', 'fonts/inter-latin-ext.woff2', 'visualizations.js', 'views_viz.js', 'app.js', 'ui.js', 'gedcom.js', 'tree.js', 'dates.js', 'ops.js', 'stats.js', 'checks.js', 'kin.js', 'extras.js', 'media.js', 'cloud.js', 'cloud-core.js', 'reports.js', 'views_extra.js', 'tree_export.js', 'person_pop.js', 'lifelines.js', 'demo.ged', 'icon.svg', 'logo.png', 'logo-dark.png', 'favicon-64.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
