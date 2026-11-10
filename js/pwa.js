/* js/pwa.js — PWA：註冊 Service Worker、狀態顯示、安裝提示。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* =========================================================
       PWA 雙軌自適應引擎
       ========================================================= */
    /* manifest.json、sw.js 與圖示都是和網頁放在同一個資料夾的實體檔案（不再由網頁產生）。
       Service Worker 只在 https 或 localhost 註冊；用本機檔案（file://）開啟時只是不啟用離線功能，其餘照常。 */
    function pwaCanRegister() { return 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'); }
    function renderPwaStatus() {
        var el = document.getElementById('ui-pwa-status'); if (!el) return;
        function show(text, ok) { el.textContent = text; el.className = 'pwa-status' + (ok ? ' ok' : ''); }
        if (!('serviceWorker' in navigator)) { show('這個瀏覽器不支援離線與安裝功能。', false); return; }
        if (!pwaCanRegister()) { show('目前是用本機檔案開啟，離線與安裝功能需要用 https 網址（例如 GitHub Pages）才會啟用。', false); return; }
        navigator.serviceWorker.getRegistration('./').then(function(reg) {
            if (!reg) show('離線功能尚未啟用：找不到 sw.js，請確認它和網頁放在同一個資料夾。', false);
            else if (reg.active && navigator.serviceWorker.controller) show('✓ 離線功能已啟用：沒有網路時，仍可開啟最後一次載入的版本。', true);
            else if (reg.active) show('離線功能已安裝，重新整理一次就會生效。', false);
            else show('正在準備離線功能…', false);
        }).catch(function() { show('離線功能狀態讀取失敗。', false); });
    }
    function initPWA() {
        try {
            if (pwaCanRegister()) {
                navigator.serviceWorker.register('./sw.js').then(function(reg) {
                    renderPwaStatus();
                    var worker = reg.installing || reg.waiting;
                    if (worker) worker.addEventListener('statechange', renderPwaStatus);
                    navigator.serviceWorker.addEventListener('controllerchange', renderPwaStatus);
                }).catch(function() { renderPwaStatus(); });
            } else { renderPwaStatus(); }
        } catch(e) {}

        window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            deferredPwaPrompt = e;
            var btn = document.getElementById('btn-pwa-install');
            if (btn) btn.style.display = 'flex';
        });
    }

    async function installPWA() {
        if (!deferredPwaPrompt) { showToast("請使用瀏覽器選單中的「加到主畫面」或「安裝應用程式」功能。", 'info'); return; }
        deferredPwaPrompt.prompt();
        await deferredPwaPrompt.userChoice;
        deferredPwaPrompt = null;
        var btn = document.getElementById('btn-pwa-install');
        if (btn) btn.style.display = 'none';
    }
