/* js/storage.js — 資料存取：載入、儲存、遷移接線、備份還原點、匯出匯入檔案。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */
    function normalizeStateShape(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('備份檔格式不是有效物件');
        var normalized = Object.assign({}, raw);
        ['accounts','debts','stocks','funds','notes','history'].forEach(key => {
            if (!Array.isArray(normalized[key])) normalized[key] = [];
        });
        normalized.brokers = normalizeBrokerList(normalized.brokers, normalized.stocks);
        if (normalized.marketPrices !== undefined && (!normalized.marketPrices || typeof normalized.marketPrices !== 'object' || Array.isArray(normalized.marketPrices))) {
            throw new Error('備份檔的 marketPrices 格式不正確');
        }
        normalized.marketPrices = normalized.marketPrices || {};
        return normalized;
    }
    function extractCloudState(response) {
        var candidate = response;
        for (var depth = 0; depth < 5; depth++) {
            if (typeof candidate === 'string') {
                candidate = JSON.parse(candidate);
                continue;
            }
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
            if (candidate.state !== undefined) { candidate = candidate.state; continue; }
            if (candidate.data !== undefined && !Array.isArray(candidate.data)) { candidate = candidate.data; continue; }
            if (candidate.payload !== undefined) { candidate = candidate.payload; continue; }
            return candidate;
        }
        throw new Error('雲端資料包裝層過多或格式錯誤');
    }
    /* 匯入備份檔／雲端還原共用：先升到目前的資料格式；比這個網頁還新的資料直接拒絕（不然會被存成舊格式、遺失新欄位） */
    function migrateIncoming(raw, label) {
        if (!isPlainObject(raw)) return raw;   /* 不是物件：交給 normalizeStateShape 丟出原本的錯誤訊息 */
        var mig = migrateState(raw);
        if (!mig.ok) throw new Error(describeMigrationError(mig, label));
        return mig.state;
    }
    function createRestorePoint(reason) {
        try {
            localStorage.setItem('exposure_radar_restore_point', JSON.stringify(Object.assign({}, state, { restorePointReason: reason, restorePointAt: new Date().toISOString() })));
        } catch(e) {}
    }

    /* 資料比這個網頁還新時（例如手機上還開著舊版網頁）：只讀、不儲存、不上傳，免得用舊格式把新資料覆蓋掉 */
    var schemaLocked = false, schemaLockNoticeAt = 0, PRE_MIGRATION_KEY = 'exposure_radar_pre_migration_backup';
    function notifySchemaLocked() {
        if (Date.now() - schemaLockNoticeAt < 30000) return;
        schemaLockNoticeAt = Date.now();
        showToast('目前的資料是較新版本的網頁存的，這個網頁只能看、不會儲存任何變更。請改用最新版的網頁。', 'warn', { duration: 9000 });
    }
    function loadData() {
        var needSave = false;
        try {
            var historicalKeys = ['exposure_radar_v16_18_data', 'exposure_radar_v16_17_data', 'exposure_radar_v16_16_data'];
            var saved = null; for (var key of historicalKeys) { saved = localStorage.getItem(key); if (saved) break; }
            if (saved) {
                var parsed = JSON.parse(saved);
                if (parsed) {
                    var mig = migrateState(parsed);
                    if (mig.ok) {
                        parsed = mig.state;
                        if (mig.migrated) {
                            /* 第一次升版：先把升版前的原始內容另存一份，萬一整理出問題還找得回來 */
                            try { if (!localStorage.getItem(PRE_MIGRATION_KEY)) localStorage.setItem(PRE_MIGRATION_KEY, saved); } catch (e) {}
                            needSave = true;
                        }
                        if (mig.changes.length) { needSave = true; showToast('已整理舊資料：' + mig.changes.join('；') + '。', 'info', { duration: 9000 }); }
                    } else if (mig.error === 'newer') {
                        schemaLocked = true; schemaLockNoticeAt = Date.now();
                        showToast('這份資料是較新版本的網頁存的（資料格式 v' + mig.fromVersion + '），這個網頁只看得懂 v' + mig.toVersion + '。為了不弄壞資料，現在只能看、不會儲存任何變更；請改用最新版的網頁。', 'warn', { duration: 15000 });
                    }   /* 其他失敗（理論上不會發生）：照舊用原始資料載入 */
                    ['accounts','debts','stocks','funds','notes','history','marketPrices','brokers','achievements','tacticsOrder','tacticsPinned'].forEach(k => { if(parsed[k]) state[k] = parsed[k]; });
                    state.brokers = normalizeBrokerList(state.brokers, state.stocks);
                    ['cash','targetRatio','toleranceRatio','targetNetWorth','glideMax','glideMin','vix','biasRatio','kellyMu','kellySigma','mcYears','mcMu','mcSigma','mcPmt','livingExpense','rebalanceTargetInv'].forEach(k => { if(parsed[k] !== undefined) state[k] = parseFloat(parsed[k]); });
                    ['monthlyIncome','incomeDay','cfDefaultDay'].forEach(k => { if(parsed[k] !== undefined) state[k] = parseFloat(parsed[k]) > 0 ? parseFloat(parsed[k]) : 0; });   /* 現金流預報設定：壞值一律當作「沒填」 */
                    if (parsed.cfRange !== undefined) state.cfRange = cfRangeOf(parsed.cfRange);
                    ['lifeAge','lifeAgeYear','retireAge'].forEach(k => { if(parsed[k] !== undefined) state[k] = parseFloat(parsed[k]) || 0; });   /* 年齡導航欄位：壞值一律當作「沒填」 */
                    if (['networth','age','both'].indexOf(parsed.glideBasis) >= 0) state.glideBasis = parsed.glideBasis;
                    state.autoSnapshot = parsed.autoSnapshot === true;   /* 只認真正的 true；舊資料沒有這個欄位＝關閉 */
                    ['autoGlidepath','autoDampener','blindMode','warRoomMode','detailedView'].forEach(k => { if(parsed[k] !== undefined) state[k] = parsed[k]; });
                    state.marketPrices = Object.assign({}, state.marketPrices || {}, parsed.marketPrices || {});
                    if (parsed.lastSyncTime) state.lastSyncTime = parsed.lastSyncTime;
                    if (parsed.lastPriceSyncTime) state.lastPriceSyncTime = parsed.lastPriceSyncTime;
                    state.sandboxMode = false; state.gasUrl = parsed.gasUrl || state.gasUrl;
                }
            }
        } catch (e) {}

        if (!state.accounts || state.accounts.length === 0) state.accounts = [{ id: 'a1', name: '綜合活期預備金戶', balance: 0, currency: 'TWD' }];
        if (!state.debts || state.debts.length === 0) state.debts = [{ id: 'd1', type: 'pledge', name: '股票質押', principal: 0, rate: 2.5, term: 0 }];
        if (needSave) saveData();   /* 升版後立刻存成新格式，下次載入就不用再整理一次（也不會重複跳提示） */

        if (state.tacticsOrder && state.tacticsPinned && !state.tacticsOrder.includes('widget-rebalance') && !state.tacticsPinned.includes('widget-rebalance')) {
            state.tacticsOrder.unshift('widget-rebalance');
        }

        toggleGlidepath(state.autoGlidepath, false); toggleDampener(state.autoDampener, false); updateVixSignal(state.vix);
        
        var mapInputs = {
            'input-glide-max': state.glideMax, 'input-glide-min': state.glideMin, 'input-vix-value': state.vix,
            'input-tolerance-ratio-slider': state.toleranceRatio, 'input-target-networth': state.targetNetWorth,
            'input-gas-url': state.gasUrl, 'input-kelly-mu': state.kellyMu, 'input-kelly-sigma': state.kellySigma,
            'mc-years': state.mcYears, 'mc-mu': state.mcMu, 'mc-sigma': state.mcSigma, 'mc-pmt': state.mcPmt,
            'input-living-expense': state.livingExpense, 'input-rebal-slider': state.rebalanceTargetInv,
            'input-life-age': lifeAgeNow() || '', 'input-retire-age': state.retireAge > 0 ? state.retireAge : '', 'life-savings': state.mcPmt,
            'input-glide-basis': state.glideBasis, 'input-target-ratio-slider': state.targetRatio,
            'input-cf-default-day': state.cfDefaultDay > 0 ? state.cfDefaultDay : '', 'input-cf-income': state.monthlyIncome > 0 ? state.monthlyIncome : '', 'input-cf-income-day': state.incomeDay > 0 ? state.incomeDay : ''
        };
        Object.keys(mapInputs).forEach(id => { var el = document.getElementById(id); if(el) el.value = mapInputs[id]; });
        var gasTokenEl = document.getElementById('input-gas-token');
        if (gasTokenEl) { gasTokenEl.value = getGasToken(); gasTokenEl.onchange = function() { persistGasToken(gasTokenEl.value); gasV2Verified = {}; }; }
        
        var elToleranceText = document.getElementById('ui-tolerance-ratio-text'); if(elToleranceText) elToleranceText.innerText = state.toleranceRatio;
        if (!state.detailedView) state.warRoomMode = false;
        applyBlindMode();
        setDisplayMode(state.detailedView);
        applyWarRoomMode(false);
    }

    function saveData() {
        if (state.sandboxMode) return;
        if (schemaLocked) { notifySchemaLocked(); return; }
        state.schemaVersion = SCHEMA_VERSION;
        localStorage.setItem('exposure_radar_v16_18_data', JSON.stringify(state));
    }

    function exportToFile() {
        var exportState = Object.assign({}, state, { backupVersion: 'v17.6-broker-management', exportedAt: new Date().toISOString() });
        var blob = new Blob([JSON.stringify(exportState, null, 2)], { type: "application/json" }); var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `exposure_backup_v17_6_${getLocalDateString()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    
    function importFromFile(event) {
        var file = event.target.files[0]; if (!file) return; var reader = new FileReader();
        reader.onload = async function(e) { 
            try { 
                var incoming = normalizeStateShape(migrateIncoming(JSON.parse(e.target.result), '備份檔')); 
                if (!(await confirmDialog(`即將匯入備份檔並覆蓋目前資料，確定繼續嗎？`, { title: '匯入備份檔', okText: '匯入並覆蓋', danger: true }))) return;
                createRestorePoint('before-import');
                schemaLocked = false;
                Object.assign(state, cfSettingDefaults(), incoming); state.lastPriceSyncTime = incoming.lastPriceSyncTime || null; state.sandboxMode = false; saveData(); showToastAfterReload('已匯入備份檔。', 'success'); location.reload(); 
            } catch(err) { showToast("檔案讀取失敗：" + err.message, 'error'); } finally { event.target.value = ''; }
        };
        reader.readAsText(file);
    }
