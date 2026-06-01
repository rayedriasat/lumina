const CACHE_NAME = 'lumina-v3';
const SHELL_ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/state.js',
  'js/icons.js',
  'js/db.js',
  'js/fs.js',
  'js/render.js',
  'js/player.js',
  'js/pdf-viewer.js',
  'vendor/plyr.css',
  'vendor/plyr.js',
  'vendor/tailwindcss.js',
  'vendor/pdfjs.min.mjs',
  'vendor/pdfjs.worker.min.mjs',
  'vendor/pdf_viewer.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
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
  
  // Exclude extension requests or API calls if any
  if (url.protocol.startsWith('chrome-extension') || url.protocol === 'about:') return;

  event.respondWith(
    fetch(request)
      .then(response => {
        // Only cache successful responses for GET requests
        if (request.method === 'GET' && response.status === 200) {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, resClone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => {
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/index.html');
      }))
  );
});
