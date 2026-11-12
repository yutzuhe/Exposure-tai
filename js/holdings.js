/* js/holdings.js — 帳戶與負債清單、美元匯率、股票與基金清單、券商管理、行情查詢。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* usdRateOk：這次開啟網頁後，是否真的抓到過即時匯率（沒抓到時畫面用預設 32.50 估算）；自動記錄快照要靠它判斷數字可不可信 */
    var usdRateOk = false, usdRateInflight = null;
    function fetchUsdExchangeRate() {
        if (usdRateInflight) return usdRateInflight;
        var pr = (async function() {
            try {
                var res = await fetch('https://open.er-api.com/v6/latest/USD'); var data = await res.json();
                var rate = data && data.rates ? parseFloat(data.rates.TWD) : NaN;
                if (isFinite(rate) && rate > 0) { usdTwdRate = rate; usdRateOk = true; var rateEl = document.getElementById('ui-usd-rate'); if(rateEl) rateEl.innerText = usdTwdRate.toFixed(2); updateTotals(); renderDetailsPage(); }
            } catch(e) {}
        })();
        usdRateInflight = pr; pr.then(function() { if (usdRateInflight === pr) usdRateInflight = null; });
        return pr;
    }
    /* 等匯率（最多 8 秒）：載入時那次還在跑就接著等，沒在跑就重打一次；回傳是否拿到即時匯率 */
    async function ensureUsdRate() {
        if (usdRateOk) return true;
        await Promise.race([fetchUsdExchangeRate(), new Promise(function(r) { setTimeout(r, 8000); })]);
        return usdRateOk;
    }

    function renderDetailsPage() {
        var accContainer = document.getElementById('accounts-container');
        if(accContainer && state.accounts) { accContainer.innerHTML = state.accounts.map((acc, i) => `<div class="inventory-card"><div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;"><input type="text" class="inv-input-text" style="font-weight:700;" value="${safeAttr(acc.name || '')}" oninput="updateDetailItem('accounts', ${i}, 'name', this.value)"><button class="btn-delete" onclick="removeDetailItem('accounts', ${i})"><i class="fa-solid fa-trash-can"></i></button></div><div style="display:flex; justify-content:space-between; align-items:center;"><select class="inv-select" onchange="updateDetailItem('accounts', ${i}, 'currency', this.value)"><option value="TWD" ${acc.currency==='TWD'?'selected':''}>TWD</option><option value="USD" ${acc.currency==='USD'?'selected':''}>USD</option></select><div style="display:flex; align-items:center; gap:5px;"><span style="font-size:13px; color:var(--text-sub);">${acc.currency==='USD'?'US$':'NT$'}</span><input type="number" class="inv-input-num blur-target" style="width:120px;" value="${safeAttr(acc.balance)}" oninput="updateDetailItem('accounts', ${i}, 'balance', this.value)"></div></div></div>`).join(''); }
        
        var debtContainer = document.getElementById('debts-container');
        if(debtContainer && state.debts) { debtContainer.innerHTML = state.debts.map((debt, i) => `<div class="inventory-card"><div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;"><input type="text" class="inv-input-text" style="font-weight:700;" value="${safeAttr(debt.name || '')}" oninput="updateDetailItem('debts', ${i}, 'name', this.value)"><button class="btn-delete" onclick="removeDetailItem('debts', ${i})"><i class="fa-solid fa-trash-can"></i></button></div><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><select class="inv-select" onchange="updateDetailItem('debts', ${i}, 'type', this.value)"><option value="pledge" ${debt.type==='pledge'?'selected':''}>質押 (僅繳息)</option><option value="credit" ${debt.type==='credit'?'selected':''}>信貸 (本息攤還)</option></select><div style="display:flex; align-items:center; gap:5px;"><span style="font-size:12px; color:var(--text-sub);">${debt.type === 'credit' ? '貸款金額' : '本金'} $</span><input type="number" class="inv-input-num blur-target" style="width:110px;" value="${safeAttr(debt.principal)}" oninput="updateDetailItem('debts', ${i}, 'principal', this.value)"></div></div><div style="display:flex; justify-content:flex-end; align-items:center; gap:10px; padding-top:8px; border-top:1px dashed rgba(var(--ov),0.1);"><span style="font-size:12px; color:var(--text-sub);">利率(%)</span><input type="number" class="inv-input-num" style="width:60px;" value="${safeAttr(debt.rate)}" step="0.01" oninput="updateDetailItem('debts', ${i}, 'rate', this.value)">${debt.type === 'credit' ? `<span style="font-size:12px; color:var(--text-sub);">期數(年)</span><input type="number" class="inv-input-num" style="width:50px;" value="${safeAttr(debt.term)}" step="1" oninput="updateDetailItem('debts', ${i}, 'term', this.value)">` : ''}</div><div class="debt-payday"><span>${debt.type === 'credit' ? '每月繳款日' : '每月付息日'}</span><input type="number" class="inv-input-num" id="debt-payday-${i}" style="width:60px;" min="1" max="31" step="1" inputmode="numeric" placeholder="預設" value="${safeAttr(parseInt(debt.payDay, 10) > 0 ? parseInt(debt.payDay, 10) : '')}" aria-label="每月扣款日" oninput="updateDetailItem('debts', ${i}, 'payDay', this.value)"><span>日</span></div>${debt.type === 'credit' ? debtProgressHTML(debt, i) : ''}</div>`).join(''); }
        updateDebtSummaries();
    }

    function updateDetailItem(type, idx, field, val) {
        if (field === 'payDay') { var pd = Math.floor(parseFloat(val)); if (pd >= 1 && pd <= 31) state[type][idx].payDay = pd; else delete state[type][idx].payDay; }   /* 每月扣款日：只收 1～31，清空或亂填就當作沒填（用預設日） */
        else state[type][idx][field] = (['name', 'type', 'currency', 'progress', 'firstPay'].indexOf(field) >= 0) ? val : (parseFloat(val) || 0);
        updateTotals(); if(field === 'currency' || field === 'type' || field === 'progress') renderDetailsPage();
    }

    /* 信貸的「還款進度」區：手動填已還期數，或填第一期繳款日讓網頁依今天日期自動算。剩餘本金與每月月付額的計算在 js/core.js 的 creditLoanStatus。 */
    function debtProgressHTML(debt, i) {
        var auto = debt.progress === 'auto';
        var control = auto
            ? `<span style="font-size:12px; color:var(--text-sub);">第一期繳款日</span><input type="date" class="inv-input-num" style="width:150px;" value="${safeAttr(debt.firstPay || '')}" oninput="updateDetailItem('debts', ${i}, 'firstPay', this.value)">`
            : `<span style="font-size:12px; color:var(--text-sub);">已還</span><input type="number" class="inv-input-num" style="width:64px;" min="0" step="1" value="${safeAttr(debt.paid || 0)}" oninput="updateDetailItem('debts', ${i}, 'paid', this.value)"><span style="font-size:12px; color:var(--text-sub);">期</span>`;
        return `<div class="debt-progress"><div class="debt-prog-row"><span style="font-size:12px; color:var(--text-sub);">還款進度</span><select class="inv-select" onchange="updateDetailItem('debts', ${i}, 'progress', this.value)"><option value="manual" ${auto ? '' : 'selected'}>手動填已還期數</option><option value="auto" ${auto ? 'selected' : ''}>依繳款日自動計算</option></select></div><div class="debt-prog-row">${control}</div><div class="debt-sum blur-target" id="debt-sum-${i}"></div></div>`;
    }
    /* 把每筆信貸的「已還幾期、剩餘本金、每月月付」寫到各自的摘要（輸入時不重畫整張卡片，才不會搶走游標） */
    function updateDebtSummaries() {
        var today = getLocalDateString();
        (state.debts || []).forEach(function(debt, i) {
            /* 信貸選了「依繳款日自動計算」又填了第一期繳款日：每月繳款日就是那一天，欄位改成顯示那個日期、不能改（進度本來就是依那天算的） */
            var pdEl = document.getElementById('debt-payday-' + i);
            if (pdEl) {
                var fpd = debt.type === 'credit' && debt.progress === 'auto' ? parseYmd(debt.firstPay) : null;
                if (fpd) { pdEl.disabled = true; pdEl.value = String(fpd.d); pdEl.title = '依「第一期繳款日」的日期繳款'; }
                else if (pdEl.disabled) { pdEl.disabled = false; pdEl.removeAttribute('title'); pdEl.value = parseInt(debt.payDay, 10) > 0 ? parseInt(debt.payDay, 10) : ''; }
            }
            var el = document.getElementById('debt-sum-' + i); if (!el || debt.type !== 'credit') return;
            var L = creditLoanStatus(debt, today), msg;
            el.classList.toggle('done', L.done);
            if (L.total <= 0) msg = '請先填「期數（年）」，才能計算還款進度。';
            else if (debt.progress === 'auto' && !parseYmd(debt.firstPay)) msg = '請填第一期繳款日，網頁會依今天的日期自動算已還幾期。';
            else if (L.done) msg = '🎉 已還清（共 ' + L.total + ' 期），不再計入負債與每月支出。';
            else {
                msg = '已還 ' + L.paid + '／' + L.total + ' 期 · 剩餘本金 $' + formatNum(L.balance) + ' · 每月繳 $' + formatNum(L.pmt);
                if (!L.tracked && L.principal > 0) msg += '。已經還了幾期的話，貸款金額請填「當初借的總額」，再填已還期數，剩餘本金就會自動扣掉。';
            }
            el.innerText = msg;
        });
    }
    function addAccountItem() { state.accounts.push({ id:'a'+Date.now(), name:'新活水庫', balance:0, currency:'TWD' }); renderDetailsPage(); updateTotals(); }
    function addDebtItem() { state.debts.push({ id:'d'+Date.now(), type:'credit', name:'新借貸引擎', principal:0, rate: 3.0, term: 7 }); renderDetailsPage(); updateTotals(); }
    function removeDetailItem(type, idx) { state[type].splice(idx,1); renderDetailsPage(); updateTotals(); }

    window.toggleCollateral = function(type, idx) { state[type][idx].isCollateral = !state[type][idx].isCollateral; saveData(); if (type === 'stocks') renderStocks(); else renderFunds(); updateTotals(); }

    function renderStocks() {
        var container = document.getElementById('stocks-container'); if(!container) return;
        if (!state.stocks || state.stocks.length === 0) { container.innerHTML = '<div style="text-align:center; color:var(--text-sub); font-size:13px; padding:15px; border: 1px dashed rgba(var(--ov),0.1); border-radius: 12px;">掃描無結果，陣列為空。</div>'; return; }
        var totalInvestment = getTotalStockValue();
        state.brokers = normalizeBrokerList(state.brokers, state.stocks);
        container.innerHTML = state.stocks.map((stock, index) => {
            var stockValue = (parseFloat(stock.shares)||0) * (parseFloat(stock.price)||0);
            var allocation = totalInvestment > 0 ? (stockValue / totalInvestment) * 100 : 0;
            return `<div class="inventory-card"><div class="inv-header inv-header-stock"><button class="btn-collateral ${stock.isCollateral ? 'active' : ''}" onclick="toggleCollateral('stocks', ${index})" title="設為質押擔保品"><i class="fa-solid fa-shield-halved"></i></button><select class="inv-select broker-select" data-type="stock" data-idx="${index}" data-field="broker" onchange="handleStockBrokerChange(${index}, this)" aria-label="券商名稱">${renderBrokerOptions(stock.broker || '')}</select><input type="text" class="inv-input-code" data-type="stock" data-idx="${index}" data-field="code" value="${safeAttr(stock.code || '')}" placeholder="代碼"><select class="inv-select" data-type="stock" data-idx="${index}" data-field="mult"><option value="1" ${stock.mult==1?'selected':''}>1x</option><option value="1.5" ${stock.mult==1.5?'selected':''}>1.5x</option><option value="2" ${stock.mult==2?'selected':''}>2x</option><option value="3" ${stock.mult==3?'selected':''}>3x</option><option value="0" ${stock.mult==0?'selected':''}>0x</option></select><button class="btn-delete" onclick="removeStock(${index})"><i class="fa-solid fa-trash-can"></i></button></div><div class="inv-calc"><div class="inv-qty"><div style="display:flex; align-items:center; gap:5px;"><input type="number" class="inv-input-num blur-target" data-type="stock" data-idx="${index}" data-field="shares" value="${safeAttr(qtyForDisplay(stock.shares, stock.unit))}"${stock.unit === 'lot' ? ' step="any" inputmode="decimal"' : ''} aria-label="持有數量"><select class="inv-select inv-unit" data-type="stock" data-idx="${index}" data-field="unit" aria-label="數量單位"><option value="share" ${stock.unit === 'lot' ? '' : 'selected'}>股</option><option value="lot" ${stock.unit === 'lot' ? 'selected' : ''}>張</option></select> × <input type="number" class="inv-input-num" data-type="stock" data-idx="${index}" data-field="price" value="${safeAttr(stock.price)}" step="any" aria-label="股價"> 元</div><div class="lot-hint blur-target" id="stock-lot-${index}">${describeShares(stock.shares, stock.unit)}</div></div><div style="display:flex; flex-direction:column; align-items:flex-end;"><div class="inv-value blur-target" id="stock-val-${index}">=$${formatNum(stockValue)}</div><div style="font-size:11px; color:var(--text-sub); font-weight:700;">佔比 <span id="stock-allocation-${index}" style="color:var(--accent-cyan);">${allocation.toFixed(1)}%</span></div></div></div><div class="inv-cost"><label class="cost-field" title="每股平均買入成本（含手續費也可以）；選填"><span>均價</span><input type="number" class="inv-input-num blur-target" data-type="stock" data-idx="${index}" data-field="cost" value="${safeAttr(parseFloat(stock.cost) > 0 ? parseFloat(stock.cost) : '')}" step="any" inputmode="decimal" placeholder="選填" aria-label="每股均價（成本）"></label><label class="cost-field advanced-only" title="這檔累計領到的現金股利（元）；選填"><span>累計股利</span><input type="number" class="inv-input-num blur-target" data-type="stock" data-idx="${index}" data-field="dividend" value="${safeAttr(parseFloat(stock.dividend) > 0 ? parseFloat(stock.dividend) : '')}" step="any" inputmode="decimal" placeholder="選填" aria-label="累計已領股利"></label><div class="pnl-line blur-target" id="stock-pnl-${index}">${pnlLineHTML(stock)}</div></div>${dividendFieldsHTML(stock, index)}</div>`;
        }).join('');
        attachListListeners(container);
    }

    /* 「預計股利」區：發放日、每股股利、頻率（選填）。填好就會排進「現金流量」分頁的時間表（計算在 js/cashflow.js）。 */
    function dividendFieldsHTML(stock, index) {
        var note = dividendNote(stock, getLocalDateString()), every = cfEveryOf(stock.divEvery), per = parseFloat(stock.divPerShare);
        var opts = CF_EVERY.map(function(n) { return '<option value="' + n + '"' + (n === every ? ' selected' : '') + '>' + CF_EVERY_LABEL[n] + '</option>'; }).join('');
        return '<details class="inv-div"' + (note ? ' open' : '') + '><summary>🎁 預計股利（選填）</summary><div class="inv-div-row">' +
            '<label class="cost-field"><span>預計發放日</span><input type="date" class="inv-input-num" data-type="stock" data-idx="' + index + '" data-field="divDate" value="' + safeAttr(parseYmd(stock.divDate) ? stock.divDate : '') + '" aria-label="預計股利發放日"></label>' +
            '<label class="cost-field"><span>每股股利</span><input type="number" class="inv-input-num blur-target" data-type="stock" data-idx="' + index + '" data-field="divPerShare" value="' + safeAttr(per > 0 ? per : '') + '" step="any" inputmode="decimal" placeholder="元" aria-label="每股預計股利"></label>' +
            '<label class="cost-field"><span>頻率</span><select class="inv-select" data-type="stock" data-idx="' + index + '" data-field="divEvery" aria-label="股利發放頻率">' + opts + '</select></label>' +
            '<div class="div-note blur-target" id="stock-div-' + index + '">' + escapeHTML(note) + '</div></div></details>';
    }

    function renderBrokerOptions(currentBroker) {
        var brokers = normalizeBrokerList(state.brokers, state.stocks);
        var options = '<option value="" disabled ' + (currentBroker ? '' : 'selected') + '>選擇券商</option>';
        options += brokers.map(function(broker) {
            return '<option value="' + safeAttr(broker) + '" ' + (broker === currentBroker ? 'selected' : '') + '>' + escapeHTML(broker) + '</option>';
        }).join('');
        options += '<option value="__add_broker__">＋ 新增券商…</option>';
        options += '<option value="__delete_broker__">－ 刪除券商…</option>';
        return options;
    }

    async function handleStockBrokerChange(index, select) {
        if (!state.stocks[index]) return;
        var selectedBroker = select.value;
        if (selectedBroker === '__delete_broker__') {
            select.value = state.stocks[index].broker || '';
            openBrokerManagerDialog();
            return;
        }
        if (selectedBroker === '__add_broker__') {
            var previousBroker = state.stocks[index].broker || '';
            var newBroker = await promptDialog('請輸入要新增的券商名稱：', { title: '新增券商', okText: '新增', placeholder: '例如：富邦證券', maxLength: 30 });
            if (newBroker === null || !newBroker.trim()) { select.value = previousBroker; return; }
            newBroker = newBroker.trim();
            state.brokers = normalizeBrokerList(state.brokers, state.stocks);
            if (!state.brokers.includes(newBroker)) state.brokers.push(newBroker);
            selectedBroker = newBroker;
        }
        state.stocks[index].broker = selectedBroker;
        state.brokers = normalizeBrokerList(state.brokers, state.stocks);
        saveData();
        renderStocks();
    }

    function openBrokerManagerDialog() {
        var dialog = document.getElementById('broker-manager-dialog');
        var select = document.getElementById('broker-delete-select');
        var message = document.getElementById('broker-manager-message');
        if (!dialog || !select) return;
        state.brokers = normalizeBrokerList(state.brokers, state.stocks);
        select.innerHTML = state.brokers.map(function(broker) {
            return '<option value="' + safeAttr(broker) + '">' + escapeHTML(broker) + '</option>';
        }).join('');
        if (message) message.innerText = state.brokers.length ? '' : '目前沒有可刪除的券商。';
        var deleteButton = dialog.querySelector('.broker-manager-actions .btn-delete');
        if (deleteButton) deleteButton.disabled = state.brokers.length === 0;
        if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    }

    function closeBrokerManagerDialog() {
        var dialog = document.getElementById('broker-manager-dialog');
        if (dialog && dialog.open) { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); }
    }

    async function deleteSelectedBroker() {
        var select = document.getElementById('broker-delete-select');
        var message = document.getElementById('broker-manager-message');
        if (!select || !select.value) return;
        var broker = select.value;
        var usedStocks = (state.stocks || []).filter(function(stock) { return String(stock.broker || '').trim() === broker; });
        if (usedStocks.length) {
            var usedNames = usedStocks.map(function(stock) { return stock.code || '未填代碼'; }).join('、');
            if (message) message.innerText = '此券商仍用於 ' + usedStocks.length + ' 筆持倉（' + usedNames + '），請先改選其他券商。';
            return;
        }
        if (!(await confirmDialog('確定要從券商清單刪除「' + broker + '」嗎？', { title: '刪除券商', okText: '刪除', danger: true }))) return;
        state.brokers = (state.brokers || []).filter(function(name) { return name !== broker; });
        state.brokers = normalizeBrokerList(state.brokers, state.stocks);
        saveData();
        renderStocks();
        closeBrokerManagerDialog();
    }

    function getTotalStockValue() { return (state.stocks || []).reduce((sum, s) => sum + ((parseFloat(s.shares) || 0) * (parseFloat(s.price) || 0)), 0); }
    function updateStockAllocationLabels(totalInvestment) {
        (state.stocks || []).forEach((stock, index) => {
            var label = document.getElementById('stock-allocation-' + index); if (!label) return;
            var value = (parseFloat(stock.shares) || 0) * (parseFloat(stock.price) || 0);
            label.innerText = (totalInvestment > 0 ? (value / totalInvestment) * 100 : 0).toFixed(1) + '%';
        });
    }

    function renderFunds() {
        var container = document.getElementById('funds-container'); if(!container) return;
        if (!state.funds || state.funds.length === 0) { container.innerHTML = '<div style="text-align:center; color:var(--text-sub); font-size:13px; padding:15px; border: 1px dashed rgba(var(--ov),0.1); border-radius: 12px;">掃描無結果，陣列為空。</div>'; return; }
        var totalFundVal = (state.funds || []).reduce((sum, f) => sum + (parseFloat(f.value) || 0), 0);
        container.innerHTML = state.funds.map((fund, index) => { var fVal = parseFloat(fund.value) || 0; var fPct = totalFundVal > 0 ? (fVal / totalFundVal) * 100 : 0; return `<div class="inventory-card"><div class="inv-header"><button class="btn-collateral ${fund.isCollateral ? 'active' : ''}" onclick="toggleCollateral('funds', ${index})" title="設為質押擔保品"><i class="fa-solid fa-shield-halved"></i></button><input type="text" class="inv-input-text" data-type="fund" data-idx="${index}" data-field="name" value="${safeAttr(fund.name || '')}" placeholder="基金/加密貨幣名稱"><select class="inv-select" data-type="fund" data-idx="${index}" data-field="mult"><option value="1" ${fund.mult==1?'selected':''}>1x</option><option value="1.5" ${fund.mult==1.5?'selected':''}>1.5x</option><option value="2" ${fund.mult==2?'selected':''}>2x</option><option value="3" ${fund.mult==3?'selected':''}>3x</option><option value="0" ${fund.mult==0?'selected':''}>0x</option></select><button class="btn-delete" onclick="removeFund(${index})"><i class="fa-solid fa-trash-can"></i></button></div><div class="inv-calc"><span>現值 (TWD)：</span> <div style="display:flex; align-items:center; gap:8px;">$ <input type="number" class="inv-input-num blur-target" style="width:120px;" data-type="fund" data-idx="${index}" data-field="value" value="${safeAttr(fund.value)}" step="any"><span style="font-size:11px; color:var(--text-sub); font-weight:700;">佔比 <span id="fund-allocation-${index}" style="color:var(--accent-purple);">${fPct.toFixed(1)}%</span></span></div></div></div>`; }).join('');
        attachListListeners(container);
    }

    function updateFundAllocationLabels() {
        var totalFundVal = (state.funds || []).reduce((sum, f) => sum + (parseFloat(f.value) || 0), 0);
        (state.funds || []).forEach((fund, index) => {
            var label = document.getElementById('fund-allocation-' + index); if (!label) return;
            var val = parseFloat(fund.value) || 0;
            label.innerText = (totalFundVal > 0 ? (val / totalFundVal) * 100 : 0).toFixed(1) + '%';
        });
    }

    function attachListListeners(container) {
        container.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('input', function(e) {
                var type = e.target.getAttribute('data-type'), idx = parseInt(e.target.getAttribute('data-idx')), field = e.target.getAttribute('data-field'), val = e.target.value;
                if (type === 'stock' && field === 'broker') return;
                if (type === 'stock') {
                    var stk = state.stocks[idx]; if (!stk) return;
                    if (field === 'unit') {            /* 換單位：儲存的股數不變，只換輸入框顯示的數字 */
                        stk.unit = (val === 'lot') ? 'lot' : 'share'; saveData(); renderStocks(); updateTotals();
                        var again = document.querySelector('#stocks-container select[data-field="unit"][data-idx="' + idx + '"]'); if (again) again.focus();
                        return;
                    }
                    if (field === 'shares') stk.shares = sharesFromInput(val, stk.unit);
                    else if (field === 'cost' || field === 'dividend') { var nv = parseFloat(val); if (nv > 0) stk[field] = nv; else delete stk[field]; }   /* 選填：清空或 ≤0 就當作沒填 */
                    else if (field === 'divPerShare') { var dv = parseFloat(val); if (dv > 0) stk.divPerShare = dv; else delete stk.divPerShare; }
                    else if (field === 'divDate') { if (parseYmd(val)) stk.divDate = val; else delete stk.divDate; }
                    else if (field === 'divEvery') { var de = cfEveryOf(val); if (de > 0) stk.divEvery = de; else delete stk.divEvery; }
                    else stk[field] = (field === 'price' || field === 'mult') ? (parseFloat(val) || 0) : val;
                    if (field === 'shares' || field === 'price') {
                        var valEl = document.getElementById(`stock-val-${idx}`); if(valEl) valEl.innerText = '=$' + formatNum((parseFloat(stk.shares)||0) * (parseFloat(stk.price)||0));
                        var lotEl = document.getElementById('stock-lot-' + idx); if (lotEl) lotEl.innerText = describeShares(stk.shares, stk.unit);
                    }
                    var divEl = document.getElementById('stock-div-' + idx); if (divEl) divEl.textContent = dividendNote(stk, getLocalDateString());
                } else if (type === 'fund') { state.funds[idx][field] = (field === 'value' || field === 'mult') ? (parseFloat(val) || 0) : val; }
                updateTotals();
            });
        });
    }

    function addStock() { state.stocks.push({ id: 's'+Date.now(), broker: '', code: '', shares: 0, unit: 'lot', price: 0, mult: 1, isCollateral: false }); renderStocks(); updateTotals(); }
    async function removeStock(idx) {
        var stock = state.stocks[idx]; if (!stock) return;
        if (await confirmDialog('確定要卸載' + (stock.code ? '「' + stock.code + '」' : '這個部位') + '嗎？', { title: '卸載部位', okText: '卸載', danger: true })) {
            var i = state.stocks.indexOf(stock); if (i >= 0) state.stocks.splice(i, 1);
            renderStocks(); updateTotals();
        }
    }
    function addFund() { state.funds.push({ id: 'f'+Date.now(), name: '', value: 0, mult: 1, isCollateral: false }); renderFunds(); updateTotals(); }
    async function removeFund(idx) {
        var fund = state.funds[idx]; if (!fund) return;
        if (await confirmDialog('確定要卸載' + (fund.name ? '「' + fund.name + '」' : '這個部位') + '嗎？', { title: '卸載部位', okText: '卸載', danger: true })) {
            var i = state.funds.indexOf(fund); if (i >= 0) state.funds.splice(i, 1);
            renderFunds(); updateTotals();
        }
    }

    function applyMarketPricesToStocks() {
        var updated = 0;
        (state.stocks || []).forEach(function(stock) {
            var code = String(stock.code || '').trim().toUpperCase();
            var price = Number(state.marketPrices && state.marketPrices[code]);
            if (code && Number.isFinite(price) && price > 0) { stock.price = price; updated++; }
        });
        return updated;
    }

    /* opts.silent：給自動記錄快照用，成功與「抓不到」都不跳提示（由呼叫的人自己說）；回傳 true＝至少更新了一檔、false＝沒更新到 */
    async function fetchPrices(opts) {
        var silent = !!(opts && opts.silent === true);
        var btn = document.getElementById('btn-fetch');
        if (!Array.isArray(state.stocks) || state.stocks.length === 0) { if (!silent) showToast('請先新增股票並輸入代碼。', 'warn'); return false; }
        var codes = [...new Set(state.stocks.map(s => String(s.code || '').trim().toUpperCase()).filter(Boolean))];
        if (!codes.length) { if (!silent) showToast('請先輸入股票代碼。', 'warn'); return false; }
        var original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 更新中'; }
        var prices = {};
        try {
            var controller = new AbortController(); var timeout = setTimeout(() => controller.abort(), 8000);
            var responses = await Promise.all([
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { signal: controller.signal }).catch(() => null),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes', { signal: controller.signal }).catch(() => null)
            ]);
            clearTimeout(timeout);
            if (responses[0] && responses[0].ok) {
                var twse = await responses[0].json();
                twse.forEach(item => { var code = String(item.Code || '').trim().toUpperCase(); var price = parseFloat(String(item.ClosingPrice || '').replace(/,/g, '')); if (code && price > 0) prices[code] = price; });
            }
            if (responses[1] && responses[1].ok) {
                var tpex = await responses[1].json();
                tpex.forEach(item => { var code = String(item.SecuritiesCompanyCode || item.code || '').trim().toUpperCase(); var price = parseFloat(String(item.Close || item.close || '').replace(/,/g, '')); if (code && price > 0) prices[code] = price; });
            }
        } catch (error) { console.warn('交易所股價讀取失敗:', error); }

        var missingCodes = codes.filter(code => !prices[code]);
        var gasCfg = readGasConfig(), gasReady = !!(gasCfg.url && gasCfg.token);
        if (missingCodes.length && gasReady) {
            /* 備援：交易所查不到的代碼，交給自己的 GAS 查（由 Google 的伺服器發出請求）。
               只送「交易所查不到」的代碼，其餘持股不會離開這台裝置；不再經過任何第三方 CORS 代理。 */
            try {
                await gasEnsureV2(gasCfg.url);
                var quote = await gasPost(gasCfg.url, { action: 'quote', token: gasCfg.token, codes: missingCodes }, 25000);
                if (quote && quote.prices && typeof quote.prices === 'object') {
                    Object.keys(quote.prices).forEach(code => { var price = Number(quote.prices[code]); if (Number.isFinite(price) && price > 0) prices[String(code).trim().toUpperCase()] = price; });
                }
            } catch (error) { console.warn('GAS 備援查價失敗:', error); }
        }

        codes.forEach(code => { if (Number.isFinite(Number(prices[code])) && Number(prices[code]) > 0) state.marketPrices[code] = Number(prices[code]); });
        var updated = applyMarketPricesToStocks();
        if (!updated) {
            if (btn) { btn.disabled = false; btn.innerHTML = original; }
            if (!silent) showToast('目前無法取得輸入代碼的最新股價；原有價格已保留。請確認代碼或稍後再試。', 'error');
            return false;
        }
        state.lastPriceSyncTime = new Date().toLocaleString('zh-TW', { hour12: false });
        state.lastSyncTime = state.lastPriceSyncTime;
        saveData(); renderStocks(); updateTotals();
        var status = document.getElementById('ui-api-status'); if (status) status.innerText = '最近成功查價：' + state.lastPriceSyncTime;
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
        var unresolved = codes.filter(code => !(Number(prices[code]) > 0));
        if (unresolved.length) showToast('股價更新完成，已更新 ' + updated + ' 個股票部位。\n以下代碼未取得最新報價，沿用原有價格：' + unresolved.join('、') + (gasReady ? '' : '\n（填入 GAS 網址與金鑰後，可啟用備援查價。）'), 'warn', { duration: 9000 });
        else if (!silent) showToast('股價更新完成，已更新 ' + updated + ' 個股票部位。', 'success');
        return true;
    }
