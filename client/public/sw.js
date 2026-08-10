/**
 * The service worker exists so the app can be installed, and later so it
 * can receive push. It is deliberately not an offline cache.
 *
 * A cache-first worker on an app that changes several times a day is a
 * way to serve people yesterday's bug after it has been fixed, with no
 * way for them to clear it. Everything here goes to the network. The
 * only thing held back is a fallback for the app shell, used when the
 * network is genuinely unavailable rather than merely slow.
 */

const SHELL = 'shell-v1';

self.addEventListener('install', (event) => {
  // Take over straight away rather than waiting for every tab to close.
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/')));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().
    then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).
    then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Never serve an API response from a cache. A stale job list is worse
  // than no job list: somebody would drive to a clean that was cancelled.
  if (new URL(req.url).pathname.startsWith('/api/')) return;

  // Navigations: network first, shell only if the network fails.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
});
