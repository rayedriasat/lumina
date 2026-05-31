const CACHE_NAME = 'lumina-v2';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/state.js',
  '/js/icons.js',
  '/js/db.js',
  '/js/fs.js',
  '/js/render.js',
  '/js/player.js',
  '/js/pdf-viewer.js',
  '/vendor/plyr.css',
  '/vendor/plyr.js',
  '/vendor/tailwindcss.js',
  '/vendor/pdfjs.min.mjs',
  '/vendor/pdfjs.worker.min.mjs',
  '/vendor/pdf_viewer.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(err => console.error('[Lumina SW] Pre-cache failed', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => {
      if (key !== CACHE_NAME) return caches.delete(key);
    })))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.destination === 'document' || request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'manifest' || url.pathname.endsWith('.mjs')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          return response;
        }).catch(() => {
          if (request.mode === 'navigate') return caches.match('/index.html');
        });
      })
    );
  }
});
