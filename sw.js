const CACHE_NAME = 'lumina-v4';
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
  'icon-32.png',
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

  if (
    request.method !== 'GET' ||
    url.protocol.startsWith('chrome-extension') ||
    url.protocol === 'about:' ||
    url.protocol === 'blob:' ||
    url.protocol === 'file:' ||
    request.headers.has('range')
  ) {
    return;
  }

  const isShellAsset = SHELL_ASSETS.some(asset => {
    const assetUrl = new URL(asset, self.location.href);
    return assetUrl.href === url.href;
  });

  if (!isShellAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.status === 200) {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, resClone));
        }
        return response;
      });
      return cached || network;
    }).catch(() => {
      if (request.mode === 'navigate') return caches.match('index.html');
    })
  );
});
