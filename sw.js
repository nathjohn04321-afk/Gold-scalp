/**
 * sw.js — service worker: app-shell caching for offline use, plus
 * notification click handling. If a backend is later added for true Web
 * Push (see README), the 'push' event handler below already displays it.
 */
const CACHE_NAME = 'golddesk-pro-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/storage.js',
  './js/sessions.js',
  './js/indicators.js',
  './js/marketEngine.js',
  './js/priceFeed.js',
  './js/analysisEngine.js',
  './js/signalEngine.js',
  './js/alerts.js',
  './js/notifications.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for same-origin navigation/app files (so updates land
// quickly); cache-first fallback keeps the last known UI working offline.
// Cross-origin requests (live price API calls) are left untouched so the
// app's own fallback-to-simulation logic in priceFeed.js stays in control.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'GoldDesk Pro', body: 'New market update available.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* plain-text push payload, use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag || 'golddesk-push',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      const existing = clientsArr.find(c => c.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
