const CACHE_NAME = 'exposure-radar-v17-5-cache';
const CACHE_PREFIX = 'exposure-radar-';
const APP_PAGE = './index.html';
const APP_SHELL = [APP_PAGE, './manifest.json'];
const STATIC_CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.all(STATIC_CDN_ASSETS.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isAppNavigation = sameOrigin && request.mode === 'navigate';
  const isManifest = sameOrigin && url.pathname.endsWith('/manifest.json');
  const isStaticCdnAsset = STATIC_CDN_ASSETS.includes(url.href);

  // GAS、交易所、Yahoo 與其他動態／跨網域請求完全略過 SW，直接由網路回應。
  if (!isAppNavigation && !isManifest && !isStaticCdnAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Network first: 有網路時永遠取最新頁面或靜態 CDN 檔案。
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok && (response.type === 'basic' || response.type === 'cors')) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      // 只有網路失敗時才回退到快取，支援離線開啟網站外殼。
      const cached = await cache.match(request);
      if (cached) return cached;
      if (isAppNavigation) {
        const fallback = await cache.match(new URL(APP_PAGE, self.registration.scope).href);
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});