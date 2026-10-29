// Service worker: installable app shell + cached map tiles and libraries, so a patchy connection does not blank the map.
// Live game traffic is a WebSocket, which service workers never touch.
const V = 'scurry-v3', TILES = 'scurry-tiles-v1', SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
const CROSS = /^https:\/\/(tile\.openstreetmap\.org|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
async function trim(cache, max) { const ks = await cache.keys(); for (let i = 0; i < ks.length - max; i++) await cache.delete(ks[i]); }
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (CROSS.test(e.request.url)) {            // cache-first: tiles and the Leaflet/LiveKit libraries rarely change
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); trim(c, 800); } return r; }
      catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));   // app files: network first, cache when offline
});
