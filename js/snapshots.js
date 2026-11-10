/* js/snapshots.js — 快照：自動快照（含純函式區塊）、手動記錄、日曆、備註。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* AUTOSNAP-BEGIN */
    var AUTO_SNAPSHOT_COOLDOWN_MS = 10 * 60 * 1000;   /* 同一次開啟內，兩次嘗試至少隔 10 分鐘（抓不到股價時不要每次切回分頁都重試） */
    function isDateKey(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
    function hasSnapshotOn(history, dateStr) {
        return Array.isArray(history) && history.some(function(h) { return !!h && h.date === dateStr; });
    }
    function lastAutoSnapshotDate(history) {
        var best = null;
        if (!Array.isArray(history)) return best;
        history.forEach(function(h) { if (h && h.auto === true && isDateKey(h.date) && (best === null || h.date > best)) best = h.date; });
        return best;
    }
    function validAutoValue(v) { return typeof v === 'number' && isFinite(v); }
    /* 有沒有美元帳戶（餘額不為 0）：有的話，淨資產要靠即時匯率才準 */
    function hasUsdBalance(accounts) {
        return Array.isArray(accounts) && accounts.some(function(a) { return !!a && a.currency === 'USD' && (parseFloat(a.balance) || 0) !== 0; });
    }
    /* 組出自動記錄的那一筆；淨資產不是正數、或數字壞掉就回傳 null（寧可不記，也不要記一筆壞資料） */
    function makeAutoSnapshot(today, netWorth, exposure) {
        if (!isDateKey(today)) return null;
        if (!validAutoValue(netWorth) || netWorth <= 0) return null;
        if (!validAutoValue(exposure)) return null;
        return { date: today, netWorth: netWorth, exposure: exposure, auto: true };
    }
    /* 這一刻要不要自動記：reason 依序為 off → sandbox → busy → date → already → cooldown */
    function planAutoSnapshot(c) {
        c = c || {};
        if (c.enabled !== true) return { action: 'skip', reason: 'off' };
        if (c.sandbox) return { action: 'skip', reason: 'sandbox' };
        if (c.busy) return { action: 'skip', reason: 'busy' };
        if (!isDateKey(c.today)) return { action: 'skip', reason: 'date' };
        if (hasSnapshotOn(c.history, c.today)) return { action: 'skip', reason: 'already' };
        var cd = c.cooldownMs === undefined ? AUTO_SNAPSHOT_COOLDOWN_MS : Number(c.cooldownMs);
        var last = Number(c.lastTry), gap = Number(c.now) - last;
        if (last > 0 && isFinite(gap) && gap >= 0 && gap < cd) return { action: 'skip', reason: 'cooldown' };   /* 時鐘被往回調（gap<0）不算冷卻中 */
        return { action: 'go', reason: 'ok' };
    }
    /* AUTOSNAP-END */

    function captureSnapshotValues() {
        var el = document.getElementById('ui-net-worth'), exEl = document.getElementById('ui-exposure-ratio');
        return { netWorth: el ? parseFloat(el.getAttribute('data-val')) : 0, exposure: exEl ? parseFloat(exEl.getAttribute('data-val')) : 0 };
    }
    function hasStockCodes() { return Array.isArray(state.stocks) && state.stocks.some(function(s) { return !!s && String(s.code || '').trim() !== ''; }); }

    var autoSnapshotBusy = false, autoSnapshotLastTry = 0;
    /* 回傳字串方便測試：recorded / price-failed / changed / invalid / error，或 planAutoSnapshot 的略過原因 */
    async function maybeAutoSnapshot(trigger) {
        var plan = planAutoSnapshot({ enabled: state.autoSnapshot, sandbox: !!state.sandboxMode || schemaLocked, busy: autoSnapshotBusy, history: state.history, today: getLocalDateString(), now: Date.now(), lastTry: autoSnapshotLastTry, cooldownMs: AUTO_SNAPSHOT_COOLDOWN_MS });
        if (plan.action !== 'go') return plan.reason;
        autoSnapshotBusy = true; autoSnapshotLastTry = Date.now();
        try {
            if (hasUsdBalance(state.accounts) && !(await ensureUsdRate())) {
                /* 有美元帳戶：匯率沒抓到時畫面是用預設 32.50 估的，不能把這個數字記成今天的淨資產 */
                showToast('自動記錄快照：目前抓不到最新美元匯率，這次先不記錄；稍後再打開網頁會再試一次。', 'warn'); return 'rate-failed';
            }
            if (hasStockCodes()) {
                /* 有持股：先更新股價再記，不然會把舊價格記成今天的淨資產 */
                var fresh = await fetchPrices({ silent: true });
                if (!fresh) { showToast('自動記錄快照：目前抓不到最新股價，這次先不記錄；稍後再打開網頁會再試一次。', 'warn'); return 'price-failed'; }
            }
            /* 等股價的這段時間，使用者可能已經手動記了、關掉開關或進了沙盤，所以重新確認一次 */
            var today = getLocalDateString();
            if (!state.autoSnapshot || state.sandboxMode || schemaLocked || hasSnapshotOn(state.history, today)) return 'changed';
            var v = captureSnapshotValues(), rec = makeAutoSnapshot(today, v.netWorth, v.exposure);
            if (!rec) return 'invalid';
            state.history.push(rec);
            saveData(); renderSnapshots(); updateTotals();
            showToast('已自動記錄今天的快照。', 'success', { icon: '📸' });
            return 'recorded';
        } catch (e) { console.warn('自動記錄快照失敗:', e); return 'error'; }
        finally { autoSnapshotBusy = false; }
    }

    function toggleAutoSnapshot(isChecked) {
        state.autoSnapshot = !!isChecked; saveData(); renderAutoSnapshotUI();
        showToast(state.autoSnapshot ? '已開啟自動記錄：之後打開或切回這個網頁時，若今天還沒有快照，就會自動記一筆。' : '已關閉自動記錄，已記下的快照都還在。', 'info', { icon: '📸' });
    }
    function renderAutoSnapshotUI() {
        var cb = document.getElementById('input-auto-snapshot'); if (cb && cb.checked !== !!state.autoSnapshot) cb.checked = !!state.autoSnapshot;
        var st = document.getElementById('ui-autosnap-status');
        if (st) { var d = lastAutoSnapshotDate(state.history); setTextIfChanged(st, d ? '最近一次自動記錄：' + d : '尚未自動記錄過'); }
    }
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible' && isAppReady) maybeAutoSnapshot('visible'); });

    async function recordSnapshot() {
        var v = captureSnapshotValues(), netWorth = v.netWorth, exposure = v.exposure;
        var today = getLocalDateString();
        if (isNaN(netWorth) || netWorth <= 0) { showToast("淨資產為 0，請先配置明細！", 'warn'); return; }
        var existingIdx = state.history.findIndex(h => h.date === today); var newRecord = { date: today, netWorth: netWorth, exposure: exposure };
        if (existingIdx >= 0) {
            var wasAuto = !!state.history[existingIdx] && state.history[existingIdx].auto === true;
            var msg = wasAuto ? '今天已經有一筆自動記錄的快照（記錄當下的股價不一定是最新的）。\n要用現在的數字覆寫嗎？' : "今日已記錄過，要覆寫嗎？";
            if (await confirmDialog(msg, { title: '覆寫今日快照', okText: '覆寫' })) state.history[existingIdx] = newRecord; else return;   /* 覆寫後是手動記的，不再帶 auto 標記 */
        } else { state.history.push(newRecord); }
        saveData(); renderSnapshots(); updateTotals(); showToast("今日快照已寫入！", 'success', { icon: '📸' });
    }

    function removeSnapshot(date) { state.history = state.history.filter(h => h.date !== date); saveData(); renderSnapshots(); updateTotals(); }
    async function deleteSnapshot(date) { if (await confirmDialog('刪除這天的紀錄？', { title: '刪除快照', okText: '刪除', danger: true })) removeSnapshot(date); }

    var currentCalYear = new Date().getFullYear();
    var currentCalMonth = new Date().getMonth();
    window.changeCalMonth = function(offset) {
        currentCalMonth += offset;
        if (currentCalMonth > 11) { currentCalMonth = 0; currentCalYear++; }
        else if (currentCalMonth < 0) { currentCalMonth = 11; currentCalYear--; }
        renderSnapshots();
    };
    window.showSnapshotDetails = async function(dateStr) {
        var record = state.history.find(h => h.date === dateStr);
        /* 這個視窗本身已經問過要不要刪，所以直接刪除，不再跳第二次確認 */
        if (record && await confirmDialog('📅 日期：' + dateStr + '\n💰 淨資產：$' + formatNum(record.netWorth) + '\n🚀 曝險：' + (isFinite(Number(record.exposure)) && record.exposure !== null && record.exposure !== '' ? Number(record.exposure).toFixed(2) + '%' : '—') + (record.auto === true ? '\n🤖 自動記錄（打開網頁時自動記下）' : '') + '\n\n要刪除這天的快照紀錄嗎？', { title: '快照紀錄', okText: '刪除這天', cancelText: '關閉', danger: true })) {
            removeSnapshot(dateStr);
        }
    };

    function renderSnapshots() {
        var container = document.getElementById('snapshot-list-container'); if(!container) return;
        if (!state.history || state.history.length === 0) { 
            container.innerHTML = '<div style="text-align:center; color:var(--text-sub); font-size:13px; padding:20px; border-radius:12px; border:1px dashed var(--border-color);">尚未有快照，記錄第一筆資產吧！</div>'; 
            updateHistoryChart();   /* 沒有快照：把圖與文字摘要都收起來 */
            renderAutoSnapshotUI();
            return;
        }

        var sorted = [...state.history].sort((a, b) => a.date.localeCompare(b.date)); 
        var recordMap = {};
        for (var i = 0; i < sorted.length; i++) {
            var curr = sorted[i]; var prev = i > 0 ? sorted[i-1] : null;
            recordMap[curr.date] = { netWorth: curr.netWorth, exposure: curr.exposure, diff: prev ? (curr.netWorth - prev.netWorth) : 0, isFirst: (i === 0) };
        }

        var firstDay = new Date(currentCalYear, currentCalMonth, 1).getDay();
        var daysInMonth = new Date(currentCalYear, currentCalMonth + 1, 0).getDate();
        var monthStr = currentCalYear + '年 ' + (currentCalMonth + 1) + '月';
        var monthStart = currentCalYear + '-' + String(currentCalMonth + 1).padStart(2, '0') + '-01';
        var monthRecords = sorted.filter(function(record) { return record.date >= monthStart && record.date <= currentCalYear + '-' + String(currentCalMonth + 1).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0'); });
        var previousMonthRecords = sorted.filter(function(record) { return record.date < monthStart; });
        var monthChange = null;
        var monthChangeLabel = '';
        if (monthRecords.length > 0) {
            var monthBaseline = previousMonthRecords.length > 0 ? previousMonthRecords[previousMonthRecords.length - 1] : monthRecords[0];
            var monthLatest = monthRecords[monthRecords.length - 1];
            monthChange = Number(monthLatest.netWorth) - Number(monthBaseline.netWorth);
            monthChangeLabel = previousMonthRecords.length > 0 ? '本月淨值變化' : '本月首筆起算';
        }
        var monthChangeColor = monthChange === null ? 'var(--text-sub)' : (monthChange > 0 ? 'var(--market-up)' : (monthChange < 0 ? 'var(--market-down)' : 'var(--text-sub)'));
        var monthChangeText = monthChange === null ? '本月尚無快照' : (monthChange > 0 ? '▲ +' : (monthChange < 0 ? '▼ -' : '')) + '$' + formatNum(Math.abs(monthChange));
        var thisYear = new Date().getFullYear();
        var yearStart = thisYear + '-01-01';
        var yearRecords = sorted.filter(function(record) { return record.date >= yearStart && record.date <= thisYear + '-12-31'; });
        var previousYearRecords = sorted.filter(function(record) { return record.date < yearStart; });
        var yearChange = null;
        var yearChangeLabel = thisYear + ' 年以來';
        if (yearRecords.length > 0) {
            var yearBaseline = previousYearRecords.length > 0 ? previousYearRecords[previousYearRecords.length - 1] : yearRecords[0];
            var yearLatest = yearRecords[yearRecords.length - 1];
            yearChange = Number(yearLatest.netWorth) - Number(yearBaseline.netWorth);
            if (previousYearRecords.length === 0) yearChangeLabel += '（首筆起算）';
        }
        var yearChangeColor = yearChange === null ? 'var(--text-sub)' : (yearChange > 0 ? 'var(--market-up)' : (yearChange < 0 ? 'var(--market-down)' : 'var(--text-sub)'));
        var yearChangeText = yearChange === null ? '今年尚無快照' : (yearChange > 0 ? '▲ +' : (yearChange < 0 ? '▼ -' : '')) + '$' + formatNum(Math.abs(yearChange));

        var html = '<div style="background: rgba(15,23,42,0.6); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color);">' +
                   '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">' +
                   '<button onclick="changeCalMonth(-1)" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--accent-blue); width:36px; height:36px; border-radius:50%; cursor:pointer;"><i class="fa-solid fa-chevron-left"></i></button>' +
                   '<div style="font-size:18px; font-weight:900; color:var(--text-main);">' + monthStr + ' <span style="font-size:12px; color:var(--text-sub);">(' + sorted.length + ' 筆)</span><div style="font-size:12px; font-weight:700; color:' + monthChangeColor + '; margin-top:3px;">' + monthChangeLabel + '：' + monthChangeText + '</div><div style="font-size:12px; font-weight:700; color:' + yearChangeColor + '; margin-top:2px;">' + yearChangeLabel + '：' + yearChangeText + '</div></div>' +
                   '<button onclick="changeCalMonth(1)" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--accent-blue); width:36px; height:36px; border-radius:50%; cursor:pointer;"><i class="fa-solid fa-chevron-right"></i></button>' +
                   '</div><div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px; text-align:center;">';

        ['日','一','二','三','四','五','六'].forEach(d => { html += '<div style="color:var(--text-sub); font-size:12px; font-weight:700; padding-bottom:6px;">' + d + '</div>'; });
        for (var i = 0; i < firstDay; i++) html += '<div></div>';

        for (var day = 1; day <= daysInMonth; day++) {
            var dateStr = currentCalYear + '-' + String(currentCalMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            var rec = recordMap[dateStr];
            var cellStyle = 'border-radius: 8px; padding: 6px 2px; min-height: 52px; display:flex; flex-direction:column; justify-content:center; align-items:center;';
            var innerHtml = '<div style="font-size:14px; font-weight:700; color:var(--text-sub);">' + day + '</div>';
            if (rec) {
                cellStyle += 'cursor:pointer; ';
                if (rec.isFirst) {
                    cellStyle += 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);';
                    innerHtml = '<div style="font-size:13px; font-weight:800; color:#fff;">' + day + '</div><div style="font-size:10px; color:var(--accent-blue);">首筆</div>';
                } else if (rec.diff > 0) {
                    cellStyle += 'background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.28);';
                    innerHtml = '<div style="font-size:13px; font-weight:800; color:var(--market-up);">' + day + '</div><div style="font-size:10px; font-weight:800; color:var(--market-up);">▲' + (rec.diff/10000).toFixed(1) + '萬</div>';
                } else if (rec.diff < 0) {
                    cellStyle += 'background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.28);';
                    innerHtml = '<div style="font-size:13px; font-weight:800; color:var(--market-down);">' + day + '</div><div style="font-size:10px; font-weight:800; color:var(--market-down);">▼' + (Math.abs(rec.diff)/10000).toFixed(1) + '萬</div>';
                } else {
                    cellStyle += 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);';
                    innerHtml = '<div style="font-size:13px; font-weight:800; color:var(--text-main);">' + day + '</div><div style="font-size:10px; font-weight:700; color:var(--text-sub);">持平</div>';
                }
            }
            html += '<div style="' + cellStyle + '" ' + (rec ? 'onclick="showSnapshotDetails(\'' + dateStr + '\')"' : '') + '>' + innerHtml + '</div>';
        }
        html += '</div><div style="margin-top:12px; font-size:11px; color:var(--text-sub); text-align:center;"><span style="color:var(--market-up); font-weight:800;">▲ 紅：淨值上升</span>　<span style="color:var(--market-down); font-weight:800;">▼ 綠：淨值下降</span>　（台股慣例）</div></div>';
        container.innerHTML = html;

        updateHistoryChart();
        renderAutoSnapshotUI();
    }

    function renderNotes() {
        var container = document.getElementById('notes-list-container'); if(!container) return;
        if (!state.notes || state.notes.length === 0) { container.innerHTML = '<div style="text-align:center; color:var(--text-sub); font-size:13px; padding:20px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">神經元庫存為空</div>'; return; }
        container.innerHTML = state.notes.map((note, index) => `<div class="note-item"><div style="flex:1;"><div class="note-content-text">${escapeHTML(note.text)}</div><div style="font-size:11px; color:var(--accent-blue); margin-top:5px;">${escapeHTML(note.date)}</div></div><button class="btn-delete" onclick="deleteNote(${index})"><i class="fa-solid fa-trash-can"></i></button></div>`).join('');
    }
    function addNote() { var inputEl = document.getElementById('note-input'); if(!inputEl) return; var text = inputEl.value.trim(); if (!text) return; var now = new Date(); var dateStr = `${getLocalDateString(now)} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`; state.notes.unshift({ id: 'n'+Date.now(), date: dateStr, text: text }); inputEl.value = ''; saveData(); renderNotes(); }
    async function deleteNote(index) {
        var note = state.notes[index]; if (!note) return;
        if (await confirmDialog('確定要抹除這則筆記嗎？', { title: '抹除筆記', okText: '抹除', danger: true })) {
            var i = state.notes.indexOf(note); if (i >= 0) state.notes.splice(i, 1);
            saveData(); renderNotes();
        }
    }
