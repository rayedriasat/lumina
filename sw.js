const CACHE_NAME = 'lumina-v6';
const SHELL_ASSETS = [
  './',
  'index.html',
  'css/tailwind.css',
  'css/style.css',
  'js/app.js',
  'js/state.js',
  'js/icons.js',
  'js/db.js',
  'js/fs.js',
  'js/render.js',
  'js/player.js',
  'js/media-index.js',
  'js/native-fs.js',
  'js/pdf-viewer.js',
  'vendor/plyr.css',
  'vendor/plyr.js',
  'vendor/pdfjs.min.mjs',
  'vendor/pdfjs.worker.min.mjs',
  'vendor/pdf_viewer.css',
  'manifest.json',
  'icon-32.png',
  'icon-  'icon-192.png',
-  'icon-512.png'
];

const UPDATE_CHECK_KEY = 'lumina_last_update_check';
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

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

async function checkForUpdates() {
  const lastCheck = await getLastUpdateCheck();
  const now = Date.now();
  
  if (now - lastCheck < UPDATE_INTERVAL) {
    return;
  }
  
  await setLastUpdateCheck(now);
  
  try {
    const response = await fetch('./index.html', { cache: 'no-cache' });
    if (!response.ok) return;
    
    const html = await response.text();
    const currentVersion = CACHE_NAME;
    const newVersionMatch = html.match(/lumina-v(\d+)/);
    
    if (newVersionMatch) {
      const newVersion = `lumina-v${newVersionMatch[1]}`;
      if (newVersion !== currentVersion) {
        console.log('[Lumina SW] New version detected:', newVersion);
        await caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
        self.clients.claim();
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({ type: 'UPDATE_AVAILABLE', version: newVersion }));
        });
        return;
      }
    }
    
    const cache = await caches.open(CACHE_NAME);
    for (const asset of SHELL_ASSETS) {
      try {
        const fetchResponse = await fetch(asset, { cache: 'no-cache' });
        if (fetchResponse.ok) {
          cache.put(asset, fetchResponse);
        }
      } catch (e) {
        console.warn('[Lumina SW] Failed to update asset:', asset, e);
      }
    }
  } catch (e) {
    console.warn('[Lumina SW] Update check failed:', e);
  }
}

async function getLastUpdateCheck() {
  try {
    const cache = await caches.open('lumina-meta');
    const response = await cache.match(UPDATE_CHECK_KEY);
    if (response) {
      const data = await response.json();
      return data.timestamp || 0;
    }
  } catch (e) {}
  return 0;
}

async function setLastUpdateCheck(timestamp) {
  try {
    const cache = await caches.open('lumina-meta');
    await cache.put(UPDATE_CHECK_KEY, new Response(JSON.stringify({ timestamp })));
  } catch (e) {}
}

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
  
  if (request.mode === 'navigate') {
    event.waitUntil(checkForUpdates());
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});