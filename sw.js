// sw.js — Etapa LANSARE, Faza H (27 august 2026)
// Service worker minimal, doar pentru instalabilitate PWA (necesar de
// Chrome/Android ca să declanșeze beforeinstallprompt) — NU o strategie de
// cache agresivă. Cache-first strict pe assets statice (css/js/imagini/
// fonturi), network passthrough necache pentru orice altceva (HTML/API) —
// pagina servește mereu date live, niciodată o versiune veche din cache.

const CACHE_NAME = 'mydarrin-pwa-v1';
const STATIC_EXT = /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!STATIC_EXT.test(url.pathname)) return; // HTML/API — mereu direct din rețea, niciodată cache

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
