// Offline support: app shell + park data are cached on first visit so the
// map keeps working with poor coverage inside the park. Map tiles are cached
// as they are viewed (capped).
const VERSION = 'v2';
const APP = `oasis-app-${VERSION}`;
const TILES = `oasis-tiles-${VERSION}`;
const MAX_TILES = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP).then((c) => c.addAll(['./', './index.html', './data/config.json', './data/pois.geojson', './data/paths.geojson'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![APP, TILES].includes(k)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

const isTile = (url) => /tile\.openstreetmap\.org|ign\.es\/wmts/.test(url.href);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (isTile(url)) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) {
          cache.put(e.request, res.clone());
          cache.keys().then((k) => k.length > MAX_TILES && cache.delete(k[0]));
        }
        return res;
      }),
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // Network first, cache as fallback. 'no-cache' revalidates with the server
  // so a new deploy shows up on the next load instead of after ~10 minutes.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(APP).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
