// Offline support and safe updates.
//
// Each build is a "version": index.html + its hashed assets (filled in by the
// build, see vite.config.ts). A version is stored complete before it is used,
// so the page and its CSS/JS always match. Rules:
//  - pages: network first (new deploys show at once), else the stored page;
//  - hashed assets (assets/…): from storage, else network (they never change);
//  - park data and drawings: network first, else storage;
//  - map tiles: storage first, capped;
//  - never answer a CSS/JS/data request with the HTML page.
const VERSION = '__VERSION__';
const ASSETS = [/*__ASSETS__*/];
const APP = `oasis-app-${VERSION}`;
const DATA = 'oasis-data';
const TILES = 'oasis-tiles-v2';
const MAX_TILES = 1500;
const DATA_FILES = ['./data/config.json', './data/pois.geojson', './data/paths.geojson', './data/ecotour.geojson', './data/animals.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const app = await caches.open(APP);
      await app.addAll(['./', './index.html', ...ASSETS].map((u) => new Request(u, { cache: 'reload' })));
      const data = await caches.open(DATA);
      await Promise.all(DATA_FILES.map((u) => data.add(new Request(u, { cache: 'reload' })).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // keep only this version (and the data and tiles)
      for (const k of await caches.keys()) if (![APP, DATA, TILES].includes(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

const isTile = (url) => /tile\.openstreetmap\.org|ign\.es\/wmts/.test(url.href);

async function fromCacheOr(cacheName, request, fallback) {
  const hit = await caches.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // a page where a file was expected (some servers do that for missing files) is a failure
    if ((res.headers.get('content-type') || '').includes('text/html')) return Response.error();
    if (res.ok) (await caches.open(cacheName)).put(request, res.clone());
    return res;
  } catch {
    return fallback ? fallback() : Response.error();
  }
}

async function networkFirst(cacheName, request, fallback) {
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok) (await caches.open(cacheName)).put(request, res.clone());
    return res;
  } catch {
    return (await caches.match(request)) || (fallback ? fallback() : Response.error());
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isTile(url)) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) {
          cache.put(request, res.clone());
          cache.keys().then((k) => k.length > MAX_TILES && cache.delete(k[0]));
        }
        return res;
      }),
    );
    return;
  }
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    // the page: fresh if possible; offline, the stored one (always complete with its assets)
    e.respondWith(networkFirst(APP, request, () => caches.match('./index.html', { ignoreSearch: true })));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    // hashed files never change: storage first
    e.respondWith(fromCacheOr(APP, request));
    return;
  }
  e.respondWith(networkFirst(DATA, request));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const poi = e.notification.data?.poi;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list[0];
      if (client) {
        client.postMessage({ type: 'open-poi', poi });
        return client.focus();
      }
      return self.clients.openWindow(`./?poi=${encodeURIComponent(poi ?? '')}`);
    }),
  );
});
