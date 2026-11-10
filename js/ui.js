/* js/ui.js — 介面：提示（toast）、確認與輸入視窗、浮動按鈕、彩帶、顯示模式、分頁切換、戰術小工具排序與釘選、沙盤／隱私／戰情室模式。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== 統一的提示與確認：取代原生 alert / confirm / prompt =====
       showToast：不打斷操作的提示（可手動關閉、會自動消失、螢幕閱讀器會朗讀；訊息用 textContent，不會被當成 HTML）。
       confirmDialog / promptDialog：回傳 Promise 的確認與輸入視窗，使用原生 <dialog>，
       Esc 取消、Tab 不會跑出視窗；有破壞性的動作（danger）預設把焦點放在「取消」。 */
    var TOAST_PENDING_KEY = 'exposure_radar_pending_toast';
    var TOAST_ICONS = { success: '✓', error: '⚠', warn: '!', info: 'i' };
    function showToast(message, type, opts) {
        type = TOAST_ICONS[type] ? type : 'info'; opts = opts || {};
        var region = document.getElementById('toast-region'); if (!region) return null;
        var msg = String(message);
        var el = document.createElement('div'); el.className = 'toast toast-' + type;
        if (type === 'error') el.setAttribute('role', 'alert');
        var icon = document.createElement('span'); icon.className = 'toast-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = opts.icon || TOAST_ICONS[type];
        var text = document.createElement('span'); text.className = 'toast-text'; text.textContent = msg;
        var close = document.createElement('button'); close.type = 'button'; close.className = 'toast-close'; close.setAttribute('aria-label', '關閉提示'); close.textContent = '×';
        el.appendChild(icon); el.appendChild(text); el.appendChild(close);
        region.appendChild(el);
        while (region.children.length > 3) region.removeChild(region.firstChild);
        var timer = null, duration = opts.duration || ((type === 'error' ? 7000 : (type === 'warn' ? 5500 : 4000)) + (msg.length > 40 ? 2500 : 0));
        function dismiss() { clearTimeout(timer); if (!el.parentNode) return; el.classList.add('toast-leaving'); setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 180); }
        function arm() { clearTimeout(timer); timer = setTimeout(dismiss, duration); }
        close.addEventListener('click', dismiss);
        el.addEventListener('mouseenter', function() { clearTimeout(timer); });
        el.addEventListener('mouseleave', arm);
        el.addEventListener('focusin', function() { clearTimeout(timer); });
        el.addEventListener('focusout', arm);
        arm();
        return el;
    }
    /* 之後會 location.reload() 的流程：先把提示存起來，重新載入後再顯示（否則會被重新整理吃掉） */
    function showToastAfterReload(message, type, opts) {
        try { sessionStorage.setItem(TOAST_PENDING_KEY, JSON.stringify({ message: message, type: type, icon: opts && opts.icon, at: Date.now() })); } catch (e) {}
    }
    function flushPendingToast() {
        try {
            var raw = sessionStorage.getItem(TOAST_PENDING_KEY); if (!raw) return;
            sessionStorage.removeItem(TOAST_PENDING_KEY);
            var t = JSON.parse(raw);
            if (t && t.message && Date.now() - (t.at || 0) < 30000) showToast(t.message, t.type, { icon: t.icon });
        } catch (e) {}
    }

    var uiDialogResolver = null;
    function openUiDialog(cfg) {
        var dlg = document.getElementById('ui-dialog');
        if (!dlg || typeof dlg.showModal !== 'function') {
            /* 極舊的瀏覽器不支援 <dialog>：退回原生視窗，功能不受影響 */
            if (cfg.input) { var typed = window.prompt(cfg.message, cfg.value || ''); return Promise.resolve({ ok: typed !== null, value: typed }); }
            return Promise.resolve({ ok: window.confirm(cfg.message), value: '' });
        }
        if (uiDialogResolver) { var prev = uiDialogResolver; uiDialogResolver = null; prev({ ok: false, value: '' }); if (dlg.open) dlg.close('cancel'); }
        var input = document.getElementById('ui-dialog-input'), okBtn = document.getElementById('ui-dialog-ok'), cancelBtn = document.getElementById('ui-dialog-cancel');
        document.getElementById('ui-dialog-title').textContent = cfg.title || (cfg.input ? '請輸入' : '請確認');
        document.getElementById('ui-dialog-body').textContent = cfg.message || '';
        input.style.display = cfg.input ? '' : 'none'; input.value = cfg.value || ''; input.placeholder = cfg.placeholder || '';
        if (cfg.maxLength) input.maxLength = cfg.maxLength; else input.removeAttribute('maxlength');
        okBtn.textContent = cfg.okText || '確定'; cancelBtn.textContent = cfg.cancelText || '取消';
        okBtn.classList.toggle('danger', !!cfg.danger);
        dlg.setAttribute('role', cfg.input ? 'dialog' : 'alertdialog');
        return new Promise(function(resolve) {
            uiDialogResolver = resolve; dlg.returnValue = ''; dlg.showModal();
            (cfg.input ? input : (cfg.danger ? cancelBtn : okBtn)).focus();
            if (cfg.input) input.select();
        });
    }
    (function initUiDialog() {
        var dlg = document.getElementById('ui-dialog'); if (!dlg) return;
        var input = document.getElementById('ui-dialog-input');
        document.getElementById('ui-dialog-ok').addEventListener('click', function() { dlg.close('ok'); });
        document.getElementById('ui-dialog-cancel').addEventListener('click', function() { dlg.close('cancel'); });
        /* 點視窗外的背景 = 取消（點到視窗內側留白不算） */
        dlg.addEventListener('click', function(e) {
            if (e.target !== dlg) return; var r = dlg.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close('cancel');
        });
        /* isComposing：用注音／拼音選字時按 Enter 是選字，不是送出 */
        input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); dlg.close('ok'); } });
        /* close 事件是稍後才觸發的：若同時又開了新的視窗，這個遲到的事件不能拿去結算新視窗 */
        dlg.addEventListener('close', function() { if (dlg.open) return; var r = uiDialogResolver; uiDialogResolver = null; if (r) r({ ok: dlg.returnValue === 'ok', value: input.value }); });
    })();
    function confirmDialog(message, opts) {
        opts = opts || {};
        return openUiDialog({ message: message, title: opts.title, okText: opts.okText, cancelText: opts.cancelText, danger: !!opts.danger }).then(function(r) { return r.ok; });
    }
    function promptDialog(message, opts) {
        opts = opts || {};
        return openUiDialog({ message: message, title: opts.title, okText: opts.okText, cancelText: opts.cancelText, input: true, value: opts.value, placeholder: opts.placeholder, maxLength: opts.maxLength }).then(function(r) { return r.ok ? r.value : null; });
    }

    function toggleFAB() { var fab = document.getElementById('ui-fab-container'); if(fab) fab.classList.toggle('active'); }
    function triggerFabAction(action) {
        toggleFAB();
        if (action === 'recordSnapshot') { recordSnapshot(); showTab('tab-settings'); }
        else if (action === 'addStock') { addStock(); showTab('tab-overview'); }
        else if (action === 'addAccountItem') { addAccountItem(); showTab('tab-details'); }
        else if (action === 'fetchPrices') { showTab('tab-overview'); setTimeout(() => fetchPrices(), 150); }
    }
    document.addEventListener('click', function(event) { var fab = document.getElementById('ui-fab-container'); if (fab && fab.classList.contains('active') && !fab.contains(event.target)) fab.classList.remove('active'); });

    function fireConfetti() {
        var canvas = document.getElementById('confetti-canvas'); if(!canvas) return;
        var ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth; canvas.height = window.innerHeight; 
        var particles = [];
        var colors = ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#ec4899'];
        for(var i = 0; i < 160; i++) particles.push({ x: canvas.width / 2, y: canvas.height / 2 + 100, r: Math.random() * 6 + 4, dx: Math.random() * 12 - 6, dy: Math.random() * -15 - 5, color: colors[Math.floor(Math.random() * colors.length)], tilt: Math.floor(Math.random() * 10) - 10, tiltAngleInc: (Math.random() * 0.07) + 0.05, tiltAngle: 0 });
        var angle = 0;
        function render() {
            ctx.clearRect(0, 0, canvas.width, canvas.height); var active = false;
            for(var j = 0; j < particles.length; j++) {
                var p = particles[j]; p.tiltAngle += p.tiltAngleInc; p.y += (Math.cos(angle + p.dx) + 1 + p.r / 2) / 2; p.x += Math.sin(angle); p.x += p.dx; p.y += p.dy; p.dy += 0.3;
                ctx.beginPath(); ctx.lineWidth = p.r; ctx.strokeStyle = p.color; ctx.moveTo(p.x + p.tilt + p.r, p.y); ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r); ctx.stroke();
                if (p.y < canvas.height) active = true;
            }
            if (active) requestAnimationFrame(render); else ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        render();
    }
    /* 遊戲化慶祝（彩帶）只在詳細模式出現；使用者在系統開了「減少動態效果」時也不放。 */
    function triggerConfetti() {
        if (!state.detailedView) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        fireConfetti();
    }

    function setDisplayMode(isDetailed) {
        state.detailedView = !!isDetailed;
        if (!state.detailedView && state.warRoomMode) {
            state.warRoomMode = false;
            document.body.classList.remove('war-room-mode');
            var warRoomButton = document.getElementById('btn-war-room');
            if (warRoomButton) { warRoomButton.classList.remove('active'); warRoomButton.innerHTML = '<i class="fa-solid fa-table-columns"></i> 12欄戰情室'; }
        }
        document.body.classList.toggle('detailed-view', state.detailedView);
        document.body.classList.toggle('simple-view', !state.detailedView);
        var simpleButton = document.getElementById('view-mode-simple');
        var detailedButton = document.getElementById('view-mode-detailed');
        if (simpleButton) simpleButton.setAttribute('aria-pressed', String(!state.detailedView));
        if (detailedButton) detailedButton.setAttribute('aria-pressed', String(state.detailedView));
        var help = document.getElementById('view-mode-help');
        if (help) help.innerText = state.detailedView ? '顯示完整持倉明細、所有分析頁與成就' : '顯示重點與前五項；成就與完整資料在詳細模式';
        var activeTab = document.querySelector('.tab-content.active');
        if (!state.detailedView && activeTab && activeTab.classList.contains('advanced-nav')) showTab('tab-overview');
        saveData();
        updateSubCharts();
        resizeAllCharts();
    }

    function showTab(tabId) {
        if (state.warRoomMode) return;
        var requestedTab = document.getElementById(tabId);
        if (!state.detailedView && requestedTab && requestedTab.classList.contains('advanced-nav')) return;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        var tg = document.getElementById(tabId); if(tg) tg.classList.add('active');
        document.querySelectorAll('.nav-tab').forEach(el => { el.classList.remove('active'); el.removeAttribute('aria-current'); });
        var tabs = Array.from(document.querySelectorAll('.nav-tab')); var clickedTab = tabs.find(t => t.getAttribute('onclick') && t.getAttribute('onclick').includes(tabId));
        if(clickedTab) { clickedTab.classList.add('active'); clickedTab.setAttribute('aria-current', 'page'); clickedTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }
        document.querySelectorAll('.bottom-nav-item').forEach(el => { el.classList.remove('active'); el.removeAttribute('aria-current'); });
        var bTabs = Array.from(document.querySelectorAll('.bottom-nav-item')); var clickedBTab = bTabs.find(t => t.getAttribute('onclick') && t.getAttribute('onclick').includes(tabId));
        if(clickedBTab) { clickedBTab.classList.add('active'); clickedBTab.setAttribute('aria-current', 'page'); }
        resizeAllCharts();
    }

    function renderTacticsWidgets() {
        var pArea = document.getElementById('tactics-pinned-area'); var uArea = document.getElementById('tactics-unpinned-area'); var divider = document.getElementById('tactics-divider');
        if(!pArea || !uArea) return;
        if(state.tacticsPinned) state.tacticsPinned.forEach(id => { var el = document.getElementById(id); if (el) { pArea.appendChild(el); var btn = el.querySelector('.pin-btn'); if (btn) btn.classList.add('active'); el.classList.add('widget-pinned'); } });
        if(state.tacticsOrder) state.tacticsOrder.forEach(id => { if (!state.tacticsPinned.includes(id)) { var el = document.getElementById(id); if (el) { uArea.appendChild(el); var btn = el.querySelector('.pin-btn'); if (btn) btn.classList.remove('active'); el.classList.remove('widget-pinned'); } } });
        if(divider) divider.style.display = (state.tacticsPinned && state.tacticsPinned.length > 0 && !state.warRoomMode) ? 'block' : 'none';
    }

    function saveWidgetOrder() {
        var pArea = document.getElementById('tactics-pinned-area'); var uArea = document.getElementById('tactics-unpinned-area');
        state.tacticsPinned = pArea ? Array.from(pArea.children).map(el => el.id).filter(id => id) : []; 
        state.tacticsOrder = uArea ? Array.from(uArea.children).map(el => el.id).filter(id => id) : [];
        saveData(); renderTacticsWidgets(); 
    }

    window.togglePinWidget = function(widgetId) {
        if (state.tacticsPinned.includes(widgetId)) { state.tacticsPinned = state.tacticsPinned.filter(id => id !== widgetId); if (!state.tacticsOrder.includes(widgetId)) state.tacticsOrder.unshift(widgetId); } 
        else { state.tacticsPinned.push(widgetId); state.tacticsOrder = state.tacticsOrder.filter(id => id !== widgetId); }
        saveData(); renderTacticsWidgets();
    };

    function initSortableWidgets() {
        if (typeof Sortable === 'undefined') { 
            if(sortableRetry < 15) { sortableRetry++; setTimeout(initSortableWidgets, 200); }
            return; 
        }
        var uArea = document.getElementById('tactics-unpinned-area'); var pArea = document.getElementById('tactics-pinned-area');
        var opts = { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost', touchStartThreshold: 5, onEnd: saveWidgetOrder };
        if(uArea) new Sortable(uArea, opts);
        if(pArea) new Sortable(pArea, opts);
    }

    async function toggleSandbox() {
        if (!state.sandboxMode) {
            if (!(await confirmDialog("即將啟動平行沙盤推演維度。\n在此模式下的所有修改都不會儲存，確定要啟動嗎？", { title: '啟動平行沙盤', okText: '啟動' }))) return;
            realStateBackup = JSON.parse(JSON.stringify(state)); state.sandboxMode = true;
            document.body.classList.add('sandbox-mode'); document.getElementById('ui-sandbox-banner').style.display = 'flex';
            var btn = document.getElementById('btn-sandbox'); if(btn) { btn.innerHTML = '<i class="fa-solid fa-flask"></i> 退出沙盤'; btn.onclick = discardSandbox; }
        }
    }

    async function applySandbox() {
        if (await confirmDialog("套用後，目前推演的數據將直接【強制覆寫】您的真實資產檔案！確定要套用嗎？", { title: '覆寫真實資產檔案', okText: '確定套用', danger: true })) {
            state.sandboxMode = false; realStateBackup = null; 
            document.body.classList.remove('sandbox-mode'); document.getElementById('ui-sandbox-banner').style.display = 'none';
            var btn = document.getElementById('btn-sandbox'); if(btn) { btn.innerHTML = '<i class="fa-solid fa-flask"></i> 平行沙盤'; btn.onclick = toggleSandbox; }
            saveData(); showToast("套用成功！", 'success');
        }
    }

    async function discardSandbox() {
        if (await confirmDialog("確定要放棄目前所有的沙盤修改，安全折返真實宇宙嗎？", { title: '放棄沙盤修改', okText: '放棄並返回', danger: true })) {
            state = JSON.parse(JSON.stringify(realStateBackup)); state.sandboxMode = false; realStateBackup = null;
            document.body.classList.remove('sandbox-mode'); document.getElementById('ui-sandbox-banner').style.display = 'none';
            var btn = document.getElementById('btn-sandbox'); if(btn) { btn.innerHTML = '<i class="fa-solid fa-flask"></i> 平行沙盤'; btn.onclick = toggleSandbox; }
            toggleGlidepath(state.autoGlidepath, false); toggleDampener(state.autoDampener, false);
            renderStocks(); renderFunds(); renderDetailsPage(); renderSnapshots(); updateTotals(); renderTacticsWidgets();   /* 快照清單也要換回真實的，不然沙盤裡記的那筆會留在畫面上 */
        }
    }

    function toggleBlindMode() { state.blindMode = !state.blindMode; saveData(); applyBlindMode(); }
    function applyBlindMode() {
        var btn = document.getElementById('btn-blind-shield');
        if (state.blindMode) { document.body.classList.add('blind-mode'); if(btn) { btn.classList.add('active'); btn.innerHTML = '<i class="fa-solid fa-eye"></i> 解除盲視'; } } 
        else { document.body.classList.remove('blind-mode'); if(btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> 盲視'; } }
    }

    function toggleWarRoom() { state.warRoomMode = !state.warRoomMode; saveData(); applyWarRoomMode(true); }
    function applyWarRoomMode(animate) {
        var btn = document.getElementById('btn-war-room');
        if (state.warRoomMode) {
            document.body.classList.add('war-room-mode');
            if(btn) { btn.classList.add('active'); btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 退出戰情室'; }
        } else {
            document.body.classList.remove('war-room-mode');
            if(btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fa-solid fa-table-columns"></i> 12欄戰情室'; }
            showTab('tab-overview');
        }
        renderTacticsWidgets();
        if(animate) setTimeout(resizeAllCharts, 100);
    }
