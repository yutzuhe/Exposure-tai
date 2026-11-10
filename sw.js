/* 曝險雷達 Service Worker
   - 網頁本體與圖示：network-first（有網路永遠拿最新版，網路失敗才用快取，所以離線也能開）。
   - GAS 雲端、證交所／櫃買行情、匯率等動態或跨網域請求：完全不攔截，直接連線。
   - 這個檔案與 index.html 放在同一個資料夾即可，網頁檔名不限（不再需要從網頁裡下載產生）。
   - 改版時若只是更新 index.html、css/ 或 js/ 裡的內容，不必動這裡；要讓所有人清掉舊快取時，才把 CACHE_NAME 的數字加 1。
   - 新增、刪除或改名 css/、js/ 底下的檔案時：OWN_ASSETS 要一起改（離線能不能開，就靠這份清單），CACHE_NAME 也加 1。 */
const CACHE_NAME = 'exposure-radar-shell-v3';
const CACHE_PREFIX = 'exposure-radar-';

/* 網頁用到的第三方檔案（版本固定，必須和 index.html 裡的網址一字不差；之後改網頁裡的版本號時，這裡要一起改） */
const STATIC_CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.woff2'
];
/* 同一個資料夾裡的其他檔案（有就快取，沒有也不影響安裝） */
const OWN_ASSETS = [
  './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  /* 樣式（要和 index.html 裡的 <link> 一致） */
  './css/base.css', './css/layout.css', './css/components.css', './css/widgets.css',
  /* 程式（要和 index.html 裡的 <script src> 一致；順序不影響快取） */
  './js/schema.js', './js/state.js', './js/core.js', './js/utils.js', './js/charts.js', './js/ui.js',
  './js/pwa.js', './js/storage.js', './js/gas.js', './js/lifecycle.js', './js/history.js', './js/snapshots.js',
  './js/holdings.js', './js/pnl.js', './js/next-action.js', './js/dashboard.js', './js/main.js'
];

const APP_PAGE = new URL('./', self.registration.scope).href;       // 資料夾首頁（例如 https://名稱.github.io/repo/）
const APP_INDEX = new URL('./index.html', APP_PAGE).href;
const OWN_ASSET_URLS = OWN_ASSETS.map(path => new URL(path, APP_PAGE).href);

/* 同一個頁面不管帶什麼 ?參數 或 #錨點，都存成同一份 */
function pageKey(url) {
  const u = new URL(url.href);
  u.search = '';
  u.hash = '';
  return u.href;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 只有資料夾首頁是必要的；其他檔案抓不到（例如還沒上傳圖示）不應該讓整個 Service Worker 裝不起來
    await cache.add(new Request(APP_PAGE, { cache: 'reload' }));
    await Promise.all(OWN_ASSET_URLS.concat(STATIC_CDN_ASSETS).map(url =>
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
  const isOwnAsset = OWN_ASSET_URLS.includes(url.href);
  const isStaticCdnAsset = STATIC_CDN_ASSETS.includes(url.href);

  // GAS、交易所、匯率與其他動態／跨網域請求完全略過 SW，直接由網路回應。
  if (!isAppNavigation && !isOwnAsset && !isStaticCdnAsset) return;

  const cacheKey = isAppNavigation ? pageKey(url) : request.url;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    let response;
    try {
      // Network first: 有網路時永遠取最新頁面或檔案。
      response = await fetch(request, { cache: 'no-store' });
    } catch (error) {
      // 只有網路失敗時才回退到快取，支援離線開啟。
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      if (isAppNavigation) {
        const fallback = (await cache.match(APP_PAGE)) || (await cache.match(APP_INDEX));
        if (fallback) return fallback;
      }
      throw error;
    }
    if (response.ok && (response.type === 'basic' || response.type === 'cors')) {
      try {
        await cache.put(cacheKey, response.clone());
        // 開 index.html 與開資料夾首頁是同一份內容，兩邊都更新，離線時才不會拿到舊的
        if (cacheKey === APP_INDEX) await cache.put(APP_PAGE, response.clone());
      } catch (error) { /* 快取寫入失敗（例如空間不足）不影響這次正常顯示 */ }
    }
    return response;
  })());
});
