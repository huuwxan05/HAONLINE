const VERSION = 'haonline-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/icon.svg',
  '/assets/icon-maskable.svg',
  '/css/app.css',
  '/js/boot.js',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/router.js',
  '/js/components.js',
  '/js/auth.js',
  '/js/calls.js',
  '/js/views/feed.js',
  '/js/views/profile.js',
  '/js/views/friends.js',
  '/js/views/messages.js',
  '/js/views/media.js',
  '/js/views/communities.js',
  '/js/views/discover.js',
  '/js/views/marketplace.js',
  '/js/views/analytics.js',
  '/js/views/monetization.js',
  '/js/views/settings.js',
  '/js/views/admin.js',
];

let replacingOldCache = false;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        replacingOldCache = keys.some((key) => key !== VERSION);
      })
      .then(() => caches.open(VERSION))
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => {
        if (!replacingOldCache) return;
        return self.clients.matchAll({ type: 'window' })
          .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url).catch(() => {}))));
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return;

  if (req.mode === 'navigate' || url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('HAONLINE', {
      body: 'Bạn có thông báo mới.',
      icon: '/assets/icon.svg',
      badge: '/assets/icon.svg',
      tag: 'haonline-notification',
      data: { url: '/#/notifications' },
    }).catch(() => {}),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/#/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
