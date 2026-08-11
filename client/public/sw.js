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


/**
 * A push arrived.
 *
 * On iOS this only ever fires for an app on the Home Screen, which is
 * why installation had to come first. `tag` collapses repeats: two
 * messages about the same job should replace one another rather than
 * stack up on a lock screen.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'My Rentals', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'My Rentals', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,
      data: { link: data.link || '/' },
    })
  );
});

/**
 * Tapping it.
 *
 * The point of a notification over a message is that it lands you where
 * you can act on it. If a window is already open, reuse it rather than
 * pile up another copy of the app.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});
