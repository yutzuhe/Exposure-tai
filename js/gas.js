/* js/gas.js — 雲端（自有 GAS）：通訊、token、上傳與還原。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== GAS 通訊 =====
       有填金鑰 = 新協議（v2）：全部用 POST，金鑰放在內容裡（Apps Script 讀不到 HTTP 標頭，放網址又會留在紀錄裡）。
       沒填金鑰 = 舊協議：維持原本的行為，相容舊版 GAS。
       舊版 GAS 會把收到的任何 POST 內容當成備份存起來，所以用金鑰之前一定先 GET ?action=ping 確認對方是新版，
       否則不送出任何資料，避免把含金鑰的請求寫進舊版的備份。
       金鑰另存在 localStorage，不放進 state，所以不會出現在備份檔、還原點或雲端備份裡。 */
    var GAS_TOKEN_KEY = 'exposure_radar_gas_token';
    var gasV2Verified = {};
    function getGasToken() { try { return (localStorage.getItem(GAS_TOKEN_KEY) || '').trim(); } catch (e) { return ''; } }
    function persistGasToken(value) {
        try { value = String(value || '').trim(); if (value) localStorage.setItem(GAS_TOKEN_KEY, value); else localStorage.removeItem(GAS_TOKEN_KEY); } catch (e) {}
    }
    function readGasConfig() {
        var urlEl = document.getElementById('input-gas-url'), tokenEl = document.getElementById('input-gas-token');
        return {
            url: String((urlEl && urlEl.value) || state.gasUrl || '').trim(),
            token: String(tokenEl ? tokenEl.value : getGasToken()).trim() /* 欄位被清空就是舊模式，不能退回用舊的儲存值 */
        };
    }
    async function gasFetch(url, options, timeoutMs) {
        var controller = new AbortController(), timer = setTimeout(function() { controller.abort(); }, timeoutMs || 20000);
        try { return await fetch(url, Object.assign({}, options, { signal: controller.signal })); }
        catch (e) { throw new Error(e && e.name === 'AbortError' ? '連線逾時，請稍後再試。' : (e && e.message) || '連線失敗'); }
        finally { clearTimeout(timer); }
    }
    async function gasEnsureV2(gasUrl) {
        if (gasV2Verified[gasUrl]) return;
        var res = await gasFetch(gasUrl + (gasUrl.indexOf('?') >= 0 ? '&' : '?') + 'action=ping', { cache: 'no-store' }, 15000);
        if (!res.ok) throw new Error('伺服器回應 ' + res.status);
        var info = null; try { info = await res.json(); } catch (e) {}
        if (!info || info.v !== 2) throw new Error('這個網址不是新版 GAS（不支援金鑰），所以沒有送出任何資料。請先依 gas/Code.gs 的說明部署新版，或清空金鑰欄位改用舊模式。');
        gasV2Verified[gasUrl] = true;
    }
    async function gasPost(gasUrl, body, timeoutMs) {
        var res = await gasFetch(gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }, timeoutMs);
        if (!res.ok) throw new Error('伺服器回應 ' + res.status);
        var result = await res.json();
        if (result && result.status === 'unauthorized') throw new Error('金鑰不正確，或 GAS 的指令碼屬性還沒設定 API_TOKEN。');
        if (result && result.status === 'error') throw new Error(result.message || '伺服器回報錯誤。');
        return result;
    }
    function toggleGasTokenVisible() {
        var el = document.getElementById('input-gas-token'), btn = document.getElementById('btn-gas-token-toggle'); if (!el) return;
        var show = el.type === 'password'; el.type = show ? 'text' : 'password';
        if (btn) { btn.textContent = show ? '隱藏' : '顯示'; btn.setAttribute('aria-pressed', show ? 'true' : 'false'); btn.setAttribute('aria-label', show ? '隱藏金鑰' : '顯示金鑰'); }
    }
    async function generateGasToken() {
        var el = document.getElementById('input-gas-token'); if (!el) return;
        if (el.value.trim() && !(await confirmDialog('已經有一組金鑰了。產生新的之後，GAS 指令碼屬性裡的 API_TOKEN 也必須換成新的，否則備份與查價都會被拒絕。', { title: '重新產生金鑰', okText: '產生新金鑰', danger: true }))) return;
        var bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
        var token = Array.from(bytes, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        el.value = token; persistGasToken(token); gasV2Verified = {};
        if (el.type === 'password') toggleGasTokenVisible();
        var copied = false; try { await navigator.clipboard.writeText(token); copied = true; } catch (e) {}
        showToast('已產生金鑰並填入欄位' + (copied ? '（已複製）' : '（請自行複製）') + '。\n請把同一組金鑰貼到 GAS 的指令碼屬性 API_TOKEN。', 'success', { icon: '🔑', duration: 9000 });
    }

    async function syncToCloud() {
        if (state.sandboxMode) { showToast("您當前處於沙盤推演維度，禁止上傳！", 'warn'); return; }
        if (schemaLocked) { showToast('目前的資料是較新版本的網頁存的，這個網頁用舊格式上傳會蓋掉雲端的新資料，所以已停止上傳。請改用最新版的網頁。', 'warn'); return; }
        var cfg = readGasConfig(), gasUrl = cfg.url; if (!gasUrl) { showToast("請先填寫 Google Apps Script 網址！", 'warn'); return; }
        state.gasUrl = gasUrl; persistGasToken(cfg.token); saveData(); var btn = document.getElementById('btn-sync-up'); if(btn) { btn.innerHTML = '上傳中...'; btn.disabled = true; }
        try {
            var result;
            if (cfg.token) { await gasEnsureV2(gasUrl); result = await gasPost(gasUrl, { action: 'save', token: cfg.token, state: state }, 30000); }
            else {
                var res = await gasFetch(gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(state) }, 30000); result = await res.json();
                if (result && result.status === 'unauthorized') throw new Error('這個 GAS 需要金鑰，請在金鑰欄位填入。');
            }
            if (result.status === "success") showToast("資料已安全備份至雲端。", 'success', { icon: '☁️' }); else showToast("備份失敗。", 'error'); } catch(e) { showToast("連線失敗：" + e.message, 'error'); } finally { if(btn) { btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 上傳備份'; btn.disabled = false; } }
    }

    async function syncFromCloud() {
        if (state.sandboxMode) { showToast("沙盤推演狀態下，禁止雲端下載還原！", 'warn'); return; }
        var cfg = readGasConfig(), gasUrl = cfg.url; if (!gasUrl) { showToast("請先填寫 Google Apps Script 網址！", 'warn'); return; }
        state.gasUrl = gasUrl; persistGasToken(cfg.token); saveData(); var btn = document.getElementById('btn-sync-down'); if(btn) { btn.innerHTML = '還原中...'; btn.disabled = true; }
        try {
            var result;
            if (cfg.token) { await gasEnsureV2(gasUrl); result = await gasPost(gasUrl, { action: 'load', token: cfg.token }, 30000); }
            else {
                var res = await gasFetch(gasUrl, { cache: 'no-store' }, 30000);
                if (!res.ok) throw new Error('伺服器回應 ' + res.status);
                result = await res.json();
                if (result && result.status === 'unauthorized') throw new Error('這個 GAS 需要金鑰，請在金鑰欄位填入。');
            }
            var incomingState = extractCloudState(result);
            if (incomingState && !['accounts','debts','stocks','funds','notes','history','cash','targetRatio'].some(key => Object.prototype.hasOwnProperty.call(incomingState, key))) {
                incomingState = null;
            }
            if (incomingState && result && result.cloudPrices && typeof result.cloudPrices === 'object') {
                incomingState.marketPrices = Object.assign({}, incomingState.marketPrices || {});
                Object.keys(result.cloudPrices).forEach(code => {
                    var price = Number(result.cloudPrices[code]);
                    if (Number.isFinite(price) && price > 0) incomingState.marketPrices[String(code).trim().toUpperCase()] = price;
                });
            }
            if (incomingState && result && result.cloudVix !== undefined && Number.isFinite(Number(result.cloudVix))) incomingState.vix = Number(result.cloudVix);
            if (incomingState) incomingState = migrateIncoming(incomingState, '雲端資料');
            if (incomingState) {
                ['accounts','debts','stocks','funds','notes','history'].forEach(key => {
                    if (incomingState[key] === undefined && Array.isArray(state[key])) incomingState[key] = state[key];
                });
                incomingState = normalizeStateShape(incomingState);
                var latestSnapshot = incomingState.history.length ? incomingState.history.map(item => item.date || '').filter(Boolean).sort().slice(-1)[0] : '無';
                var cloudSummary = `帳戶 ${incomingState.accounts.length} 筆 · 股票 ${incomingState.stocks.length} 筆 · 快照 ${incomingState.history.length} 筆（最新：${latestSnapshot}）`;
                if (!(await confirmDialog(`即將以雲端資料覆蓋目前資料：\n\n${cloudSummary}\n\n股價快取也會一併同步。確定繼續嗎？`, { title: '以雲端資料覆蓋', okText: '覆蓋', danger: true }))) return;
                createRestorePoint('before-cloud-sync');
                schemaLocked = false;   /* 使用者已確認要用雲端資料覆蓋，所以解除「只能看」的限制 */
                var localMarketPrices = Object.assign({}, state.marketPrices || {});
                Object.keys(incomingState).forEach(k => { state[k] = incomingState[k]; });
                state.marketPrices = Object.assign({}, localMarketPrices, incomingState.marketPrices || {});
                state.lastPriceSyncTime = incomingState.lastPriceSyncTime || null;
                var priceUpdates = applyMarketPricesToStocks();
                state.sandboxMode = false;
                state.lastSyncTime = new Date().toLocaleString('zh-TW', { hour12: false });
                saveData();
                showToastAfterReload('雲端還原與同步成功！' + (priceUpdates ? '\n已同步 ' + priceUpdates + ' 個股票價格。' : '\n雲端未提供可套用的最新股價，原有單價已保留。'), 'success', { icon: '☁️' });
                location.reload();
            } else { showToast('雲端內無有效備份資料。', 'warn'); }
        } catch(e) { showToast('雲端還原失敗：' + e.message, 'error'); } finally { if(btn) { btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> 下載還原'; btn.disabled = false; } }
    }
