/* js/dashboard.js — 儀表板：updateTotals（把資料餵給 core.js、把結果畫出來）、首屏量表、維持率、風險情境、成就與任務、再平衡、階級、回撤、活水、凱利與蒙地卡羅的畫面。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    function updateFleetStatus(netWorth) {
        var fleet = computeFleet(netWorth);
        var currentLvlIdx = fleet.idx, lvl = fleet.lvl, nextLvl = fleet.next;
        var fc = document.getElementById('fleet-container'); if(!fc) return;

        document.getElementById('fleet-icon').innerText = lvl.icon;
        var nameEl = document.getElementById('fleet-name'); nameEl.innerText = lvl.name; nameEl.classList.add('tint-text'); nameEl.style.setProperty('--c', lvl.color); nameEl.style.color = 'var(--tc)';
        fc.style.borderColor = `${lvl.color}66`;

        var progressEl = document.getElementById('fleet-progress'); var nextReqEl = document.getElementById('fleet-next-req');
        if (nextLvl) {
            var pct = fleet.pct;
            if(progressEl) { progressEl.style.width = pct + '%'; progressEl.style.background = lvl.color; }
            var shortfall = fleet.shortfall;
            if(nextReqEl) nextReqEl.innerHTML = `距離升級 [<span class="tint-text" style="--c:${nextLvl.color}; color:var(--tc); font-weight:800;">${nextLvl.name}</span>] 尚需: $<span id="ui-fleet-shortfall" data-val="${shortfall}">${formatNum(shortfall)}</span>`;
        } else {
            if(progressEl) { progressEl.style.width = '100%'; progressEl.style.background = lvl.color; }
            if(nextReqEl) nextReqEl.innerHTML = `<span class="tint-text" style="--c:${lvl.color}; color:var(--tc); font-weight:800;">已達最高階級，您是宇宙的霸主！</span>`;
        }
        if (currentFleetLevel === -1) { currentFleetLevel = currentLvlIdx; } 
        else if (currentLvlIdx > currentFleetLevel && isAppReady) { triggerConfetti(); currentFleetLevel = currentLvlIdx; } 
        else if (currentLvlIdx < currentFleetLevel) { currentFleetLevel = currentLvlIdx; }
    }

    function updateVixSignal(val) {
        var vix = parseFloat(val) || 0; state.vix = vix; var res = document.getElementById('vix-signal-result'); if (!res) return;
        var band = vixBandOf(vix);
        if (band === 'extreme') { res.innerHTML = '<div class="risk-status status-alert">極高波動 · 風險升高</div>'; res.style.background = 'rgba(var(--status-alert-rgb),0.08)'; }
        else if (band === 'high') { res.innerHTML = '<div class="risk-status status-watch">高波動 · 留意風險</div>'; res.style.background = 'rgba(var(--accent-orange-rgb),0.08)'; }
        else if (band === 'rising') { res.innerHTML = '<div class="risk-status status-watch">波動升溫 · 持續觀察</div>'; res.style.background = 'rgba(var(--accent-orange-rgb),0.06)'; }
        else { res.innerHTML = '<div class="risk-status status-safe">一般波動區間</div>'; res.style.background = 'rgba(var(--accent-cyan-rgb),0.06)'; }
    }

    function setStress(val) { var slider = document.getElementById('stress-slider'); if (slider) { slider.value = val; updateStress(val); } }

    function updateDrawdown(currentNetWorth) {
        var mddEl = document.getElementById('ui-underwater-tracker'); if (!mddEl) return;
        var dd = computeDrawdown(currentNetWorth, state.history, getLocalDateString(), Date.now());
        if (dd.underwater) {
            mddEl.style.display = 'block';
            mddEl.innerHTML = `<div class="underwater-box dark-island"><div style="font-size:12px; font-weight:800; margin-bottom:8px; color:#38bdf8;"><i class="fa-solid fa-water"></i> 深海潛航監控</div><div style="display:flex; justify-content:space-between;"><div><div style="font-size:11px; color:#94a3b8;">最大回撤 (MDD)</div><div style="font-size:20px; font-weight:900; color:var(--accent-red);">${dd.dropPct.toFixed(2)}%</div></div><div style="text-align:right;"><div style="font-size:11px; color:#94a3b8;">水下天數</div><div style="font-size:20px; font-weight:900; color:#fff;">${dd.diffDays} 天</div></div></div></div>`;
        } else { mddEl.style.display = 'none'; }
    }

    function updateDynamicBuffer(totalCash, totalMonthlyOutflow, totalDebt, vix) {
        var buf = computeDynamicBuffer(totalCash, totalMonthlyOutflow, totalDebt, vix);
        state.dynamicSafeLine = buf.safeLine;
        animateNumber('ui-dyn-current-cash', totalCash, '$'); animateNumber('ui-dyn-safe-line', buf.safeLine, '$');
        var elAdviceBox = document.getElementById('ui-dyn-advice-box');
        if (elAdviceBox) {
            if (buf.status === 'deploy') elAdviceBox.innerHTML = `<div style="font-size:13px; color:var(--accent-blue); font-weight:800;">💡 閒置活水充沛：可分批佈署 $${formatNum(buf.amount)}</div>`;
            else if (buf.status === 'balanced') elAdviceBox.innerHTML = `<div style="font-size:13px; color:var(--accent-green); font-weight:800;">🛡️ 防禦完美平衡</div>`;
            else elAdviceBox.innerHTML = `<div style="font-size:13px; color:var(--accent-orange); font-weight:800;">⚠️ 建議補足 $${formatNum(buf.amount)} 活水儲備</div>`;
        }
    }

    function runKellyScanner() {
        var inp = parseKellyInputs({ mu: document.getElementById('input-kelly-mu').value, sigma: document.getElementById('input-kelly-sigma').value, rate: document.getElementById('input-kelly-rate').value });
        var k = computeKelly(inp.mu, inp.sigma, inp.r);
        document.getElementById('kelly-result-container').style.display = 'block';
        document.getElementById('ui-kelly-full').innerText = k.fullPct.toFixed(1) + '%';
        document.getElementById('ui-kelly-half').innerText = k.halfPct.toFixed(1) + '%';
        document.getElementById('ui-kelly-advice').innerHTML = `實戰建議採用 <b>Half-Kelly (${k.halfPct.toFixed(1)}%)</b> 兼顧複利成長與波動防禦。`;
        if (typeof Chart === 'undefined') return;
        var labels = k.labels, data = k.data;
        var ctx = document.getElementById('kellyChart').getContext('2d'); if (charts.kelly) charts.kelly.destroy();
        charts.kelly = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ data, borderColor: '#ec4899', backgroundColor: 'rgba(236, 72, 153, 0.1)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    }

    function runMonteCarlo() {
        var currentNW = parseFloat(document.getElementById('ui-net-worth')?.getAttribute('data-val')) || 0;
        if (currentNW <= 0) { showToast("淨資產需大於 0！", 'warn'); return; }
        var targetNW = parseFloat(state.targetNetWorth) || 10000000;
        var leverage = (parseFloat(document.getElementById('ui-exposure-ratio')?.getAttribute('data-val')) || 100) / 100;
        var inp = parseMcInputs({ years: document.getElementById('mc-years').value, mu: document.getElementById('mc-mu').value, sigma: document.getElementById('mc-sigma').value, pmt: document.getElementById('mc-pmt').value, rate: document.getElementById('input-kelly-rate').value });
        var res = simulateMonteCarlo({ currentNW: currentNW, targetNW: targetNW, leverage: leverage, years: inp.years, mu: inp.mu, sigma: inp.sigma, pmt: inp.pmt, borrowRate: inp.borrowRate }, Math.random);
        var months = res.months, paths = res.paths;
        document.getElementById('mc-result-container').style.display = 'block';
        animateNumber('mc-success-prob', res.successPct, '', '%', 1);
        animateNumber('mc-ruin-prob', res.ruinPct, '', '%', 1);
        animateNumber('mc-median-w', res.median, '$');
        if (typeof Chart === 'undefined') return;
        var ctx = document.getElementById('mcChart').getContext('2d'); if (charts.mc) charts.mc.destroy();
        var datasets = paths.map(p => ({ data: p, borderColor: 'rgba(236, 72, 153, 0.15)', borderWidth: 1, pointRadius: 0 }));
        datasets.push({ data: Array(months + 1).fill(targetNW), borderColor: '#34d399', borderWidth: 2, borderDash: [5, 5], pointRadius: 0 });
        charts.mc = new Chart(ctx, { type: 'line', data: { labels: Array.from({length: months + 1}, (_, i) => i), datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false } } } });
    }

    /* =========================================================
       🎮 戰術成就與微型任務渲染引擎
       ========================================================= */
    function checkAndRenderQuests(netWorth, runwayMonths, debtRatio, ratioRaw) {
        var qr = computeQuests(state.achievements, { netWorth: netWorth, runwayMonths: runwayMonths, debtRatio: debtRatio, ratioRaw: ratioRaw, targetRatio: state.effectiveTargetRatio,
            historyCount: state.history ? state.history.length : 0, holdingsCount: state.stocks.length + state.funds.length });
        state.achievements = qr.achievements;
        var newUnlocks = qr.newUnlocks;

        if (isAppReady && newUnlocks.length > 0 && state.detailedView) {   /* 簡潔模式：靜默解鎖，不跳通知 */
            triggerConfetti();
            setTimeout(() => { showToast("恭喜指揮官！解鎖新成就：\n" + newUnlocks.join("\n"), 'success', { icon: '🎉', duration: 8000 }); }, 400);
        }

        var bdgs = ['first','1m','5m','runway','debt','precise'];
        var achs = ['first_blood','nw_1m','nw_5m','runway_6m','debt_light','perfect_exp'];
        for(var i = 0; i < bdgs.length; i++) {
            var b = document.getElementById('badge-' + bdgs[i]);
            if(b) {
                if (state.achievements[achs[i]]) b.classList.add('unlocked');
                else b.classList.remove('unlocked');
            }
        }

        var nextMilestone = qr.nextMilestone, mainPct = qr.mainPct;
        var uiMainQuest = document.getElementById('ui-current-main-quest');
        if (uiMainQuest) {
            uiMainQuest.innerHTML = `
                <div style="font-size:13px; font-weight:800; color:var(--accent-orange); margin-bottom:6px;">
                    <i class="fa-solid fa-flag-checkered"></i> [主線] 晉升階級：淨資產突破 $${formatNum(nextMilestone)}
                </div>
                <div style="font-size:11px; color:var(--text-sub); margin-bottom:6px;">
                    目前進度：$${formatNum(netWorth)} / $${formatNum(nextMilestone)} (${mainPct.toFixed(1)}%)
                </div>
                <div class="vs-bar-container" style="height:8px; margin:0; background:var(--input-bg);">
                    <div style="background:var(--accent-orange); height:100%; width:${mainPct}%; transition: width 0.5s ease; box-shadow: 0 0 10px rgba(var(--accent-orange-rgb),0.5);"></div>
                </div>
            `;
        }

        var sideQuestsHTML = '';
        var q1Pct = qr.q1.pct;
        var q1Status = runwayMonths >= 6 ? 'completed' : '';
        var q1Icon = runwayMonths >= 6 ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-green);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--text-sub);"></i>';
        sideQuestsHTML += `
            <div class="quest-card ${q1Status}">
                <div class="quest-title">
                    <span>${q1Icon} 銅牆鐵壁</span>
                    <span style="font-size:12px; font-weight:700; color:${runwayMonths >= 6 ? 'var(--accent-green)' : 'var(--text-sub)'};">${runwayMonths > 99 ? 'MAX' : runwayMonths.toFixed(1)} / 6.0 個月</span>
                </div>
                <div class="quest-desc">將活水續航力提升至 6 個月以上，獲得「防禦大師」徽章。</div>
                <div class="vs-bar-container" style="height:4px; margin:0; border:none; background:rgba(var(--ov),0.1);">
                    <div style="background:var(--accent-green); height:100%; width:${q1Pct}%;"></div>
                </div>
            </div>
        `;

        var q2Done = qr.q2.done, q2Pct = qr.q2.pct;
        var q2Status = q2Done ? 'completed' : '';
        var q2Icon = q2Done ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-green);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--text-sub);"></i>';
        sideQuestsHTML += `
            <div class="quest-card ${q2Status}">
                <div class="quest-title">
                    <span>${q2Icon} 擺脫重力</span>
                    <span style="font-size:12px; font-weight:700; color:${q2Done ? 'var(--accent-green)' : 'var(--text-sub)'};">${debtRatio.toFixed(1)}% / &lt; 30%</span>
                </div>
                <div class="quest-desc">在保有借貸槓桿的前提下，將總負債比壓縮至 30% 以下。</div>
                <div class="vs-bar-container" style="height:4px; margin:0; border:none; background:rgba(var(--ov),0.1);">
                    <div style="background:var(--accent-blue); height:100%; width:${q2Pct}%;"></div>
                </div>
            </div>
        `;

        var expDiff = qr.expDiff, q3Done = qr.q3.done, q3Pct = qr.q3.pct;
        var q3Status = q3Done ? 'completed' : '';
        var q3Icon = q3Done ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-green);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--text-sub);"></i>';
        sideQuestsHTML += `
            <div class="quest-card ${q3Status}">
                <div class="quest-title">
                    <span>${q3Icon} 精準操盤</span>
                    <span style="font-size:12px; font-weight:700; color:${q3Done ? 'var(--accent-green)' : 'var(--text-sub)'};">誤差 ${expDiff.toFixed(1)}%</span>
                </div>
                <div class="quest-desc">完美執行再平衡，使實際曝險與目標曝險誤差小於 1%。</div>
                <div class="vs-bar-container" style="height:4px; margin:0; border:none; background:rgba(var(--ov),0.1);">
                    <div style="background:var(--accent-purple); height:100%; width:${q3Pct}%;"></div>
                </div>
            </div>
        `;

        var uiSideQuests = document.getElementById('ui-side-quests');
        if (uiSideQuests) uiSideQuests.innerHTML = sideQuestsHTML;
    }

    function renderRebalanceWidget(totalCash, totalInv) {
        var elInvText = document.getElementById('ui-rebal-inv-text'), elCashText = document.getElementById('ui-rebal-cash-text');
        if(elInvText) elInvText.innerText = state.rebalanceTargetInv;
        if(elCashText) elCashText.innerText = 100 - state.rebalanceTargetInv;
        var rb = computeRebalance(totalCash, totalInv, state.rebalanceTargetInv), resBox = document.getElementById('rebalance-result');
        if(!resBox || rb === null) return;
        var gap = rb.gap;
        resBox.innerHTML = rb.balanced ? `<div style="color:var(--accent-green); font-weight:800; text-align:center;">✅ 配比完美，無須動作</div>` : `<div style="text-align:center; font-weight:800; color:${gap > 0 ? 'var(--accent-cyan)' : 'var(--accent-red)'};">👉 建議${gap > 0 ? '買進' : '賣出'} $${formatNum(Math.abs(gap))} 投資部位</div>`;
    }
    /* 所有「算數」都在上面的 CORE 區（computePortfolio、computeStress…）；這裡只負責餵資料進去、把結果寫到畫面上。 */
    function updateTotals() {
        var P = computePortfolio({ accounts: state.accounts, debts: state.debts, stocks: state.stocks, funds: state.funds, usdRate: usdTwdRate, livingExpense: state.livingExpense, targetNetWorth: state.targetNetWorth, today: getLocalDateString() });
        var totalCashSum = P.totalCash, totalPledgeSum = P.pledge, totalCreditSum = P.credit, totalDebt = P.totalDebt, totalMonthlyOutflow = P.monthlyOutflow;
        state.cash = totalCashSum; 
        animateNumber('ui-total-cash-sum', totalCashSum); animateNumber('ui-cashflow-cash', totalCashSum, '$');

        var kr = document.getElementById('input-kelly-rate'); if (kr) kr.value = P.avgRate.toFixed(2);
        
        animateNumber('ui-total-debt-sum', totalDebt); animateNumber('ui-cashflow-pledge', totalPledgeSum, '$'); animateNumber('ui-cashflow-credit', totalCreditSum, '$');
        animateNumber('ui-monthly-pledge-interest', P.monthlyPledgeInterest, '-$'); animateNumber('ui-monthly-credit-pmt', P.monthlyCreditPMT, '-$'); animateNumber('ui-monthly-total-outflow', totalMonthlyOutflow, '-$');

        var totalInv = P.totalInv, totalExp = P.totalExp, v1x = P.v1x, v2x = P.v2x, v0x = P.v0x, collateralTotal = P.collateral, stressPositions = P.positions;
        updateStockAllocationLabels(getTotalStockValue());
        updateStockPnlLabels(); renderPnlSummary();
        updateFundAllocationLabels();
        var colEl = document.getElementById('input-collateral'); if(colEl) colEl.value = Math.round(collateralTotal);

        var netWorth = P.netWorth, ratioRaw = P.ratioRaw;
        var apiStatusEl = document.getElementById('ui-api-status');
        var lastPriceSyncText = state.lastPriceSyncTime || '尚未查價';
        if (apiStatusEl) apiStatusEl.innerText = '最近成功查價：' + lastPriceSyncText;
        var overviewPriceStatus = document.getElementById('ui-overview-price-status');
        if (overviewPriceStatus) overviewPriceStatus.innerText = '行情查詢：' + lastPriceSyncText;
        animateNumber('ui-total-inv', totalInv, '$'); animateNumber('ui-total-exp', totalExp, '$'); animateNumber('ui-net-worth', netWorth, '$'); animateNumber('ui-overview-total-assets', P.assetsPool, '$'); animateNumber('ui-overview-cash', totalCashSum, '$'); animateNumber('ui-overview-debt', totalDebt, '$'); animateNumber('ui-exposure-ratio', ratioRaw, '', '%', 2); 

        var cashPct = P.cashPct, invPct = P.invPct, debtRatio = P.debtRatio;
        var elDebtRatio = document.getElementById('ui-debt-ratio'); if (elDebtRatio) elDebtRatio.innerText = `${debtRatio.toFixed(1)}%`;
        var elCurrentRatio = document.getElementById('ui-current-ratio'); if (elCurrentRatio) elCurrentRatio.innerText = P.currentLiabilities === 0 ? '無短債' : P.currentRatio.toFixed(2);

        animateNumber('ui-bar-cash-pct', cashPct, '', '%', 1); animateNumber('ui-bar-inv-pct', invPct, '', '%', 1);
        animateNumber('ui-bar-cash-amt', totalCashSum, '$'); animateNumber('ui-bar-inv-amt', totalInv, '$');
        document.getElementById('ui-bar-cash-fill').style.width = cashPct + '%'; document.getElementById('ui-bar-inv-fill').style.width = invPct + '%';
        
        var targetNW = P.targetNW, progressPct = P.progressPct;
        document.getElementById('ui-milestone-percent').innerText = progressPct.toFixed(1) + '%'; document.getElementById('ui-progress-bar').style.width = progressPct + '%';

        var life = computeLifecycleGlide({ age: lifeAgeNow(), retireAge: state.retireAge, monthlySavings: state.mcPmt, netWorth: netWorth, glideMax: state.glideMax, glideMin: state.glideMin });
        lastLifecycle = life;
        var nwTarget = nwGlideTarget(state.glideMax, state.glideMin, progressPct);   /* 原本的做法：依淨資產達標進度 */
        var pickedGlide = pickGlideTarget(state.glideBasis, nwTarget, life);
        if (state.autoGlidepath) { state.targetRatio = pickedGlide; animateNumber('ui-glide-calculated', state.targetRatio, '', '%'); }
        var dampenAmount = dampenAmountOf(state.autoDampener, state.biasRatio);
        state.effectiveTargetRatio = effectiveTargetOf(state.targetRatio, dampenAmount);
        document.getElementById('ui-target-ratio-text').innerText = state.effectiveTargetRatio;
        var targetSlider = document.getElementById('input-target-ratio-slider');   /* 滑桿跟著實際目標走（自動降槓桿／套用建議／載入時都一致）；拖曳中不去動它 */
        if (targetSlider && targetSlider !== document.activeElement && targetSlider.value !== String(state.targetRatio)) targetSlider.value = state.targetRatio;
        var exposureContext = document.getElementById('ui-exposure-context');
        if (exposureContext) exposureContext.innerText = '目標 ' + state.effectiveTargetRatio + '% · 容忍 ±' + state.toleranceRatio + '%';
        renderLifecycle(life, { nwTarget: nwTarget, picked: pickedGlide });

        var runwayMonths = P.runwayMonths;
        document.getElementById('ui-cash-runway').innerText = totalMonthlyOutflow > 0 ? runwayMonths.toFixed(1) + ' 個月' : '無流出';

        var marginRatio = P.marginRatio, marginDropFrac = P.marginDropFrac;
        renderHeroMargin(totalPledgeSum, marginRatio, marginDropFrac);
        var marginEl = document.getElementById('ui-margin-ratio');
        if(marginEl) {
            marginEl.classList.remove('status-safe', 'status-watch', 'status-alert');
            if(totalPledgeSum === 0) {
                marginEl.innerText = "無質押";
                document.getElementById('ui-margin-drop').innerText = "--";
                setRiskLabel('ui-margin-status', 'info', '無質押借款');
            } else {
                var marginLevel = marginLevelOf(marginRatio);
                marginEl.classList.add('status-' + marginLevel);
                marginEl.innerText = marginRatio.toFixed(1) + "%";
                setRiskLabel('ui-margin-status', marginLevel, marginLabelOf(marginLevel));
                var dropFrac = marginDropFrac;
                document.getElementById('ui-margin-drop').innerText = marginRatio <= 130 ? "已達追繳線" : (dropFrac === null ? "大盤跌 100% 也不觸及" : "-" + (dropFrac * 100).toFixed(1) + "%");
            }
        }

        var stressPct = parseInt(document.getElementById('stress-slider').value) / 100;
        var sr = computeStress(stressPositions, stressPct, totalCashSum, totalDebt, totalPledgeSum);
        var stressedMargin = sr.margin;
        animateNumber('stress-networth', sr.netWorth, '$');
        animateNumber('stress-exposure', sr.exposurePct, '', '%', 1);
        document.getElementById('stress-margin-ratio').innerText = totalPledgeSum > 0 ? stressedMargin.toFixed(1) + '%' : '無質押';
        setRiskLabel('stress-margin-status', totalPledgeSum > 0 ? sr.level : 'info', totalPledgeSum > 0 ? marginLabelOf(sr.level) : '無質押');

        var rescueBox = document.getElementById('ui-margin-rescue-box');
        if (rescueBox) {
            if (totalPledgeSum === 0) {
                rescueBox.innerHTML = `<span style="color:var(--accent-green);">🛡️ 目前無質押借貸，免疫斷頭風險。</span>`;
            } else if (stressedMargin < 166) {
                rescueBox.innerHTML = `<div style="color:var(--accent-orange); font-weight:800; margin-bottom:4px;">⚡ 災後維持率低於 166% 安全線！救援方案二選一：</div>
                <div>🅰️ <b>現金還款救援</b>：動用活水償還本金 <b style="color:var(--accent-cyan);">$${formatNum(sr.repayCashNeeded)}</b></div>
                <div>🅱️ <b>補券質押救援</b>：撥入未質押現股 <b style="color:var(--accent-green);">$${formatNum(sr.addCollateralNeeded)}</b> (目前可用未質押現股災後市值：$${formatNum(sr.unpledgedStock)})</div>`;
            } else {
                rescueBox.innerHTML = `<span style="color:var(--accent-green); font-weight:700;">🛡️ 即使遭遇 -${Math.round(stressPct*100)}% 黑天鵝，災後維持率 (${stressedMargin.toFixed(1)}%) 仍高於 166% 安全護盾線！</span>`;
            }
        }

        updateDynamicBuffer(totalCashSum, totalMonthlyOutflow, totalDebt, state.vix);
        updateFleetStatus(netWorth); updateDrawdown(netWorth); updateSimulator(netWorth, totalExp, ratioRaw); 
        checkAndRenderQuests(netWorth, runwayMonths, debtRatio, ratioRaw);
        renderRebalanceWidget(totalCashSum, totalInv);
        var cashflow = refreshCashflow();   /* 現金流預報：要等 updateDynamicBuffer 算好安全水位之後 */
        lastNextActionInput = { netWorth: netWorth, totalExp: totalExp, totalInv: totalInv, cash: totalCashSum, debt: totalDebt, pledge: totalPledgeSum, collateral: collateralTotal,
            unpledgedStock: stressPortfolio(stressPositions, 0).unpledgedStock, targetPct: parseFloat(state.effectiveTargetRatio) || 100, tolerance: parseFloat(state.toleranceRatio) || 5,
            safeLine: state.dynamicSafeLine || 0, rebalanceTargetInv: state.rebalanceTargetInv, newFunds: 0,
            cashflow: cashflow, cashSoon: cfSoonText(cashflow, 3) };
        refreshNextAction();

        var elTicker = document.getElementById('ui-ticker-text');
        if (elTicker) elTicker.innerText = `🟢 VIX: ${state.vix.toFixed(1)} ｜ 🚀 曝險: ${ratioRaw.toFixed(2)}% ｜ 🛡️ 維持率: ${totalPledgeSum===0?'無借款':marginRatio.toFixed(1)+'%'} ｜ 💰 淨資產: $${formatNum(netWorth)}      `.repeat(4);

        var elChronos = document.getElementById('ui-chronos-display');
        if (elChronos) {
            document.getElementById('ui-target-networth-txt').innerText = formatNum(targetNW);
            var fire = computeFireTime(netWorth, targetNW, state.mcPmt);
            if (fire.reached) elChronos.innerHTML = '<span style="color:var(--accent-green); font-size:18px;">🎉 已突破財富自由奇異點！</span>';
            else elChronos.innerHTML = fire.ok ? `<span>${fire.years}</span><span class="chronos-unit">年</span><span>${fire.remMonths}</span><span class="chronos-unit">個月</span>` : `<span style="font-size:15px;">持續累積動能中</span>`;
        }

        updateDebtSummaries();
        runSniperDCA();
        debouncedHeavyUpdate(v1x, v2x, totalCashSum, v0x);
    }

    /* 首屏曝險量表：軌道 0～上限；上限取 150% 與「目前／目標＋容忍」的 1.1 倍（進位到 25）中較大者，
       所以曝險超過 150% 時圓點也不會跑出軌道。level 沿用 updateSimulator 的容忍判斷，量表與狀態標籤不會不一致。 */
    function renderExposureGauge(currentPct, targetPct, tolerance, level, label, enabled) {
        var gauge = document.getElementById('ui-exposure-gauge'), gapEl = document.getElementById('ui-exposure-gap'); if (!gauge) return;
        if (!enabled) {
            gauge.hidden = true;
            if (gapEl) gapEl.innerText = '請先輸入資產與負債資料，才會畫出量表。';
            return;
        }
        var gm = computeGaugeModel(currentPct, targetPct, tolerance), scaleMax = gm.scaleMax, gapText = gm.gapText;
        var band = document.getElementById('ui-eg-band'), targetEl = document.getElementById('ui-eg-target'), marker = document.getElementById('ui-eg-marker');
        var targetLabel = document.getElementById('ui-eg-target-label'), maxLabel = document.getElementById('ui-eg-max');
        gauge.hidden = false;
        if (band) { band.style.left = gm.bandLeft + '%'; band.style.width = gm.bandWidth + '%'; }
        if (targetEl) targetEl.style.left = gm.targetPos + '%';
        if (marker) { marker.style.left = gm.markerPos + '%'; marker.className = 'eg-marker status-' + level; }
        if (targetLabel) { targetLabel.innerText = '目標 ' + targetPct + '%'; targetLabel.style.left = gm.targetLabelLeft + '%'; }
        if (maxLabel) maxLabel.innerText = scaleMax + '%';
        if (gapEl) gapEl.innerText = gapText;
        gauge.setAttribute('aria-valuemax', String(scaleMax));
        gauge.setAttribute('aria-valuenow', String(Math.round(currentPct * 10) / 10));
        gauge.setAttribute('aria-valuetext', '目前曝險 ' + currentPct.toFixed(1) + '%，目標 ' + targetPct + '%，容忍 ±' + tolerance + '%，' + label + '。' + gapText);
    }

    /* 首屏質押維持率：門檻與「風險情境」分頁同一套（≥166% 安全、≥130% 注意、未滿 130% 低於追繳線） */
    function renderHeroMargin(totalPledge, marginRatio, dropFrac) {
        var valueEl = document.getElementById('ui-hero-margin-ratio'), noteEl = document.getElementById('ui-hero-margin-note'); if (!valueEl) return;
        valueEl.classList.remove('status-safe', 'status-watch', 'status-alert');
        if (!(totalPledge > 0)) {
            valueEl.innerText = '無質押';
            setRiskLabel('ui-hero-margin-status', 'info', '無質押借款');
            if (noteEl) noteEl.innerText = '目前沒有質押借款，不會被追繳。';
            return;
        }
        var level = marginLevelOf(marginRatio);
        valueEl.classList.add('status-' + level);
        valueEl.innerText = marginRatio.toFixed(1) + '%';
        setRiskLabel('ui-hero-margin-status', level, marginLabelOf(level));
        if (noteEl) noteEl.innerText = marginRatio <= 130 ? '已低於 130% 追繳參考線，請優先處理。'
            : (dropFrac === null ? '大盤跌 100% 也不會觸及 130% 追繳參考線。' : '大盤再跌約 ' + (dropFrac * 100).toFixed(1) + '% 會觸及 130% 追繳參考線。');
    }

    function updateSimulator(netWorth, totalExp, currentPct) {
        var targetPct = parseFloat(state.effectiveTargetRatio) || 100, tolerance = parseFloat(state.toleranceRatio) || 5;
        var res = document.getElementById('simulator-result');
        var es = computeExposureStatus(netWorth, currentPct, targetPct, tolerance);
        if (!es.enabled) {
            document.body.classList.remove('defcon-1', 'defcon-3', 'defcon-5');
            setRiskLabel('ui-status-badge', 'info', '資料待填');
            renderExposureGauge(0, targetPct, tolerance, 'info', '資料待填', false);
            if (res) res.innerText = '請先輸入資產與負債資料。';
            return;
        }
        var deviation = es.deviation, dev = es.dev, defconLevel = es.defcon;
        document.body.classList.remove('defcon-1', 'defcon-3', 'defcon-5'); document.body.classList.add(`defcon-${defconLevel}`);
        var level = es.level, label = es.label;
        setRiskLabel('ui-status-badge', level, label);
        renderExposureGauge(currentPct, targetPct, tolerance, level, label, true);
        if (!res) return;
        if (defconLevel === 5) { res.innerHTML = `<div class="risk-status status-safe">目前在設定的 ±${tolerance}% 容忍範圍內</div>`; return; }
        if (defconLevel === 3) { res.innerHTML = `<div class="risk-status status-watch">目前曝險${deviation < 0 ? '低於' : '高於'}目標 ${dev.toFixed(1)} 個百分點，接近容忍邊界</div>`; return; }
        res.innerHTML = `<div class="risk-status status-alert">目前曝險${deviation < 0 ? '低於' : '高於'}目標 ${dev.toFixed(1)} 個百分點，已超出容忍範圍</div>`;
    }

    function updateStateValue(key, val) { state[key] = parseFloat(val) || 0; updateTotals(); }
    function updateTargetRatio(val) { state.targetRatio = parseFloat(val) || 100; updateTotals(); }
    function updateToleranceRatio(val) { state.toleranceRatio = parseFloat(val) || 5; document.getElementById('ui-tolerance-ratio-text').innerText = state.toleranceRatio; updateTotals(); }
    function updateStress(val) { document.getElementById('stress-val').innerText = val; updateTotals(); }
