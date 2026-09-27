// Shell cache only: every /admin/* response carries account data or a session, so none is stored.
const CACHE = 'shellm-admin-v5';
const SHELL = [
  '/admin/dashboard/',
  '/admin/dashboard/css/custom.css',
  '/admin/dashboard/js/app.js',
  '/admin/dashboard/js/overview.js',
  '/admin/dashboard/js/logs.js',
  '/admin/dashboard/js/keys.js',
  '/admin/dashboard/js/playground.js',
  '/admin/dashboard/js/system.js',
  '/admin/dashboard/img/favicon.svg',
  '/admin/dashboard/img/favicon-16.png',
  '/admin/dashboard/img/favicon-32.png',
  '/admin/dashboard/img/favicon-180.png',
  '/admin/dashboard/img/logo-dark.svg',
  '/admin/dashboard/img/icon-192.png',
  '/admin/dashboard/img/icon-512.png',
  '/admin/dashboard/img/icon-512-maskable.png',
  '/admin/manifest.webmanifest',
];

// The page's scripts, stylesheets and fonts come from CDNs. Without them a cold offline start
// renders no Tailwind and no Alpine, so the offline banner itself never appears.
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
];
const CDN_ORIGINS = new Set([...CDN.map((url) => new URL(url).origin), 'https://fonts.gstatic.com']);

// The page is left out: without a session it redirects, cache.put rejects a redirected response,
// and one expired session would fail the whole install. It caches itself on the first visit.
const PRECACHE = SHELL.filter((url) => url !== '/admin/dashboard/');

// skipWaiting is load-bearing: a reload does not release a waiting worker, so the post-update
// reload in system.js would otherwise be served by the very worker it is replacing.
// A CDN that is down must not fail the install, so its entries are best effort. no-cors matches
// how the page requests them, and it is the only mode these servers never refuse.
function precacheCdn(cache) {
  return Promise.allSettled(CDN.map((url) => fetch(url, { mode: 'no-cors' }).then((res) => cache.put(url, res))));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).then(() => precacheCdn(cache)))
      .then(() => self.skipWaiting()),
  );
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
  const local = url.origin === self.location.origin && SHELL.includes(url.pathname);
  if (!local && !CDN_ORIGINS.has(url.origin)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // ignoreSearch for the shell only: it was matched on the pathname, while the two font
      // stylesheets differ by nothing but their query.
      .catch(() => caches.match(request, { ignoreSearch: local }).then((cached) => cached || Response.error())),
  );
});
