// Shell cache only: every /admin/* response carries account data or a session, so none is stored.
const CACHE = 'shellm-admin-v1';
const SHELL = [
  '/admin/dashboard/',
  '/admin/dashboard/js/app.js',
  '/admin/dashboard/js/overview.js',
  '/admin/dashboard/js/logs.js',
  '/admin/dashboard/js/keys.js',
  '/admin/dashboard/img/favicon.svg',
  '/admin/dashboard/img/icon-192.png',
  '/admin/dashboard/img/icon-512.png',
  '/admin/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!SHELL.includes(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
