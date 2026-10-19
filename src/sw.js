/* Screenshot Organizer service worker.
 * - Precaches the versioned app shell (the list is injected at build time).
 * - Navigation: network first, falling back to the cached shell when offline.
 * - Same-origin static assets: cache first.
 * - OCR engine and language models: cached when first used, so OCR works offline afterwards.
 * - Screenshots themselves live in IndexedDB and are never touched by the service worker.
 */
/* eslint-disable no-undef -- the precache list below is injected at build time */
const VERSION = '__SW_VERSION__';
const SHELL_CACHE = `so-shell-${VERSION}`;
const OCR_CACHE = 'so-ocr-v1';
const PRECACHE = __PRECACHE_LIST__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('so-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.includes('/ocr/')) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok) cache.put(request, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok && res.type === 'basic' && /\.(js|css|woff2?|png|svg|webmanifest)$/.test(url.pathname)) cache.put(request, res.clone());
    return res;
  })());
});
