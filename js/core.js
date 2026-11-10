/* js/core.js — 核心計算（純函式區塊，core_test.js 單獨抽出來跑）：淨資產、曝險、維持率、壓力測試、活水水位、回撤、財富自由、階級與成就、再平衡、凱利、蒙地卡羅。不碰畫面、不讀 state。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== 核心計算（純函式，CORE-BEGIN/END 之間）=====
       淨資產、曝險、質押維持率、壓力測試、活水水位、回撤、財富自由時間、成就與階級門檻、曝險狀態、再平衡、凱利、蒙地卡羅……
       全部集中在這一區，只吃數字、只回傳數字或物件：不碰 DOM、不讀 state、不用全域變數（階級表 FLEET_LEVELS 是唯一的常數）、
       不自己呼叫 Math.random（亂數函式由呼叫端傳進來，測試時就能固定結果）。
       網頁上的 updateTotals 等函式只負責「把 state 與輸入框的值餵進來、把結果畫到畫面上」。
       單獨測試：node core_test.js（用 vm 只抽出這一區）。以後要改計算規則，先改這裡、先讓測試通過，再看畫面。 */
    /* CORE-BEGIN */
    function calculatePMT(principal, annualRate, years) { if (principal <= 0) return 0; if (annualRate <= 0) return principal / (years * 12); var monthlyRate = (annualRate / 100) / 12; var months = years * 12; return principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1); }

    /* 質押維持率燈號：≥166% 安全、≥130% 注意、未滿 130% 低於追繳線（首屏、風險情境、壓力測試共用同一組門檻） */
    function marginLevelOf(ratio) { return ratio >= 166 ? 'safe' : (ratio >= 130 ? 'watch' : 'alert'); }
    function marginLabelOf(level) { return level === 'safe' ? '安全' : (level === 'watch' ? '注意' : '低於追繳線'); }

    /* ===== 壓力測試：每個部位用「自己的槓桿倍數」估算損失 =====
       大盤瞬間下跌 s 時，倍數 m 的部位市值約下跌 m × s（單日重置型槓桿 ETF 的瞬間衝擊，
       不含複利損耗與追蹤誤差），最多跌到 0。災後淨資產、災後曝險、質押擔保品市值都呼叫同一組函式，
       口徑才會一致；以前只有淨資產算了槓桿的額外損失，維持率把擔保品一律當 1 倍，結果偏樂觀。 */
    function stressedValue(val, mult, s) { return Math.max(0, val * (1 - Math.max(0, mult) * s)); }
    function stressPortfolio(positions, s) {
        var r = { inv: 0, exp: 0, collateral: 0, unpledgedStock: 0 };
        positions.forEach(function(p) {
            var v = stressedValue(p.val, p.mult, s);
            r.inv += v; r.exp += v * Math.max(0, p.mult);
            if (p.isCollateral) r.collateral += v; else if (p.kind === 'stock') r.unpledgedStock += v;
        });
        return r;
    }
    /* 大盤還要再跌多少（0~1），擔保品市值 ÷ 質押借款才會降到 line（例如 1.3）。
       0 = 已經在線下；null = 就算大盤跌 100% 也不會觸及（例如擔保品全是 0 倍部位）。 */
    function dropToMarginLine(positions, pledge, line) {
        if (pledge <= 0) return null;
        var target = line * pledge;
        if (stressPortfolio(positions, 0).collateral <= target) return 0;
        if (stressPortfolio(positions, 1).collateral > target) return null;
        var lo = 0, hi = 1;
        for (var i = 0; i < 40; i++) { var mid = (lo + hi) / 2; if (stressPortfolio(positions, mid).collateral > target) lo = mid; else hi = mid; }
        return hi;
    }

    /* 帳戶、負債、持股、基金 → 所有加總數字。inp = { accounts, debts, stocks, funds, usdRate, livingExpense, targetNetWorth }
       positions 是每個投資部位的 { val, mult, isCollateral, kind }，壓力測試與維持率都用它。 */
    function computePortfolio(inp) {
        var accounts = inp.accounts || [], debts = inp.debts || [], stocks = inp.stocks || [], funds = inp.funds || [];
        var totalCash = accounts.reduce(function(sum, acc) { return sum + ((parseFloat(acc.balance) || 0) * (acc.currency === 'USD' ? inp.usdRate : 1)); }, 0);

        var pledge = 0, credit = 0, monthlyPledgeInterest = 0, monthlyCreditPMT = 0, weightedInterestSum = 0;
        debts.forEach(function(d) {
            var p = parseFloat(d.principal) || 0, r = parseFloat(d.rate) || 0, t = parseFloat(d.term) || 0;
            weightedInterestSum += p * r;
            if (d.type === 'pledge') { pledge += p; monthlyPledgeInterest += (p * (r / 100)) / 12; }
            else { credit += p; monthlyCreditPMT += calculatePMT(p, r, t); }
        });
        var monthlyOutflow = monthlyPledgeInterest + monthlyCreditPMT + (parseFloat(inp.livingExpense) || 0);
        var totalDebt = pledge + credit, avgRate = totalDebt > 0 ? (weightedInterestSum / totalDebt) : 2.5;

        var totalInv = 0, totalExp = 0, v1x = 0, v2x = 0, v0x = 0, collateral = 0, positions = [];
        stocks.forEach(function(s) {
            var val = (parseFloat(s.shares) || 0) * (parseFloat(s.price) || 0), mult = s.mult !== undefined ? parseFloat(s.mult) : 1;
            totalInv += val; totalExp += (val * mult);
            if (mult >= 1.5) v2x += val * mult; else if (mult > 0) v1x += val * mult; else v0x += val;
            positions.push({ val: val, mult: mult, isCollateral: !!s.isCollateral, kind: 'stock' });
            if (s.isCollateral) collateral += val;
        });
        funds.forEach(function(f) {
            var val = parseFloat(f.value) || 0, mult = f.mult !== undefined ? parseFloat(f.mult) : 1;
            totalInv += val; totalExp += (val * mult);
            if (mult >= 1.5) v2x += val * mult; else if (mult > 0) v1x += val * mult; else v0x += val;
            positions.push({ val: val, mult: mult, isCollateral: !!f.isCollateral, kind: 'fund' });
            if (f.isCollateral) collateral += val;
        });

        var netWorth = (totalInv + totalCash) - totalDebt, ratioRaw = netWorth > 0 ? (totalExp / netWorth) * 100 : 0;
        var assetsPool = totalInv + totalCash;
        var cashPct = assetsPool > 0 ? (totalCash / assetsPool) * 100 : 0, invPct = assetsPool > 0 ? (totalInv / assetsPool) * 100 : 0, debtRatio = assetsPool > 0 ? (totalDebt / assetsPool) * 100 : 0;
        var currentLiabilities = pledge + (monthlyOutflow * 12), currentRatio = currentLiabilities > 0 ? (assetsPool / currentLiabilities) : 99;
        var targetNW = parseFloat(inp.targetNetWorth) || 10000000, progressPct = netWorth > 0 ? Math.min(100, Math.max(0, (netWorth / targetNW) * 100)) : 0;
        var runwayMonths = monthlyOutflow > 0 ? (totalCash / monthlyOutflow) : 999;
        var marginRatio = pledge > 0 ? (collateral / pledge) * 100 : 999;
        var marginDropFrac = pledge > 0 ? dropToMarginLine(positions, pledge, 1.3) : null;
        return {
            totalCash: totalCash, pledge: pledge, credit: credit, totalDebt: totalDebt, avgRate: avgRate,
            monthlyPledgeInterest: monthlyPledgeInterest, monthlyCreditPMT: monthlyCreditPMT, monthlyOutflow: monthlyOutflow,
            totalInv: totalInv, totalExp: totalExp, v1x: v1x, v2x: v2x, v0x: v0x, collateral: collateral, positions: positions,
            netWorth: netWorth, ratioRaw: ratioRaw, assetsPool: assetsPool, cashPct: cashPct, invPct: invPct, debtRatio: debtRatio,
            currentLiabilities: currentLiabilities, currentRatio: currentRatio, targetNW: targetNW, progressPct: progressPct,
            runwayMonths: runwayMonths, marginRatio: marginRatio, marginDropFrac: marginDropFrac
        };
    }

    /* 大盤再跌 stressPct（0~1）之後的情境：災後淨資產、曝險、維持率，以及維持率不到 166% 時的兩種救援金額 */
    function computeStress(positions, stressPct, totalCash, totalDebt, totalPledge) {
        var st = stressPortfolio(positions, stressPct);
        var margin = totalPledge > 0 ? (st.collateral / totalPledge) * 100 : 999;
        var netWorth = (st.inv + totalCash) - totalDebt;
        return {
            netWorth: netWorth, exposurePct: netWorth > 0 ? (st.exp / netWorth) * 100 : 0,
            margin: margin, level: marginLevelOf(margin), hasPledge: totalPledge > 0,
            collateral: st.collateral, unpledgedStock: st.unpledgedStock,
            repayCashNeeded: Math.max(0, totalPledge - (st.collateral / 1.66)), addCollateralNeeded: Math.max(0, (1.66 * totalPledge) - st.collateral)
        };
    }

    /* 目標曝險的三個小步驟：依淨資產進度的下滑路徑、乖離阻尼扣減、最後生效的目標（不低於 0） */
    function nwGlideTarget(glideMax, glideMin, progressPct) { return Math.round(glideMax - ((glideMax - glideMin) * (progressPct / 100))); }
    function dampenAmountOf(enabled, biasRatio) { return enabled ? (biasRatio >= 15 ? 30 : (biasRatio >= 10 ? 20 : (biasRatio >= 5 ? 10 : 0))) : 0; }
    function effectiveTargetOf(targetRatio, dampenAmount) { return Math.max(0, targetRatio - dampenAmount); }

    /* VIX 分級（同時給「活水水位」與「波動訊號」兩處用的門檻）*/
    function vixBandOf(vix) { return vix >= 50 ? 'extreme' : (vix >= 40 ? 'high' : (vix >= 30 ? 'rising' : 'normal')); }

    /* 活水安全水位：每月流出 × 月數 ＋ 負債 × 預留比例，波動越大要留越多。
       status：deploy＝超出安全線 20% 以上，可分批佈署；balanced＝剛好；short＝不足（amount 是要補的金額）。 */
    function computeDynamicBuffer(totalCash, monthlyOutflow, totalDebt, vix) {
        var runwayMonths = vix >= 40 ? 24 : (vix >= 30 ? 12 : (vix >= 20 ? 6 : 3));
        var debtReservePct = vix >= 40 ? 0.4 : (vix >= 30 ? 0.3 : (vix >= 20 ? 0.2 : 0.1));
        var safeLine = (monthlyOutflow * runwayMonths) + (totalDebt * debtReservePct);
        var status, amount = 0;
        if (totalCash >= safeLine) {
            var excess = totalCash - safeLine;
            if (excess > (safeLine * 0.2)) { status = 'deploy'; amount = excess; } else status = 'balanced';
        } else { status = 'short'; amount = safeLine - totalCash; }
        return { runwayMonths: runwayMonths, debtReservePct: debtReservePct, safeLine: safeLine, status: status, amount: amount };
    }

    /* 回撤：目前淨資產比歷史最高（含今天）低多少，以及從最高點那天算起過了幾天。todayStr 是 YYYY-MM-DD，nowMs 是現在的毫秒時間。 */
    function computeDrawdown(netWorth, history, todayStr, nowMs) {
        var ath = netWorth, athDate = todayStr;
        if (history && history.length > 0) history.forEach(function(h) { if (h.netWorth > ath) { ath = h.netWorth; athDate = h.date; } });
        if (netWorth < ath && ath > 0) {
            return { underwater: true, ath: ath, athDate: athDate, dropPct: ((netWorth - ath) / ath) * 100, diffDays: Math.ceil(Math.abs(nowMs - new Date(athDate)) / 86400000) };
        }
        return { underwater: false, ath: ath, athDate: athDate, dropPct: 0, diffDays: 0 };
    }

    /* 財富自由還要多久：以年化 8%、每月存 pmt（空白或 0 時用 30,000）估算。reached＝已達標；ok＝推得出合理的年月（100 年內）。 */
    function computeFireTime(netWorth, targetNW, rawPmt) {
        if (netWorth >= targetNW) return { reached: true, ok: true, months: 0, years: 0, remMonths: 0 };
        var r_m = Math.pow(1 + 0.08, 1 / 12) - 1, pmt = parseFloat(rawPmt) || 30000;
        var months = Math.log((targetNW * r_m + pmt) / Math.max(1, netWorth * r_m + pmt)) / Math.log(1 + r_m);
        var y = Math.floor(months / 12), m = Math.floor(months % 12);
        return { reached: false, ok: isFinite(months) && y < 100, months: months, years: y, remMonths: m };
    }

    /* 階級：依淨資產決定目前階級，以及距離下一階還差多少 */
    var FLEET_LEVELS = [
        { min: 0, max: 100000, icon: '🛶', name: '沿岸木筏', color: '#94a3b8' },
        { min: 100000, max: 1000000, icon: '🚤', name: '武裝快艇', color: '#34d399' },
        { min: 1000000, max: 5000000, icon: '🛳️', name: '重型巡洋艦', color: '#38bdf8' },
        { min: 5000000, max: 10000000, icon: '🚀', name: '跨星系太空梭', color: '#c084fc' },
        { min: 10000000, max: 50000000, icon: '🛸', name: '星際母艦', color: '#ec4899' },
        { min: 50000000, max: Infinity, icon: '🌌', name: '宇宙霸主死星', color: '#fbbf24' }
    ];
    function computeFleet(netWorth) {
        var idx = 0; for (var i = FLEET_LEVELS.length - 1; i >= 0; i--) { if (netWorth >= FLEET_LEVELS[i].min) { idx = i; break; } }
        var lvl = FLEET_LEVELS[idx], next = FLEET_LEVELS[idx + 1] || null, pct = 100, shortfall = 0;
        if (next) { pct = Math.min(100, Math.max(0, ((netWorth - lvl.min) / (next.min - lvl.min)) * 100)); shortfall = next.min - netWorth; }
        return { idx: idx, lvl: lvl, next: next, pct: pct, shortfall: shortfall };
    }

    /* 主線任務的下一個里程碑 */
    function nextMilestoneOf(netWorth) {
        if (netWorth >= 10000000) return 50000000;
        if (netWorth >= 5000000) return 10000000;
        if (netWorth >= 3000000) return 5000000;
        if (netWorth >= 1000000) return 3000000;
        if (netWorth >= 500000) return 1000000;
        if (netWorth >= 100000) return 500000;
        return 100000;
    }

    /* 成就解鎖與三個支線任務的進度。ach 是目前的成就紀錄（不會被改動，回傳新的一份）。
       c = { netWorth, runwayMonths, debtRatio, ratioRaw, targetRatio（生效中的目標曝險）, historyCount, holdingsCount（持股＋基金筆數）}
       newUnlocks 依序是這次新解鎖的成就文字。 */
    function computeQuests(ach, c) {
        var a = {}, unlocks = [];
        Object.keys(ach || {}).forEach(function(k) { a[k] = ach[k]; });
        function unlock(key, text) { if (!a[key]) { a[key] = true; unlocks.push(text); } }
        if (c.historyCount > 0) unlock('first_blood', '🌱 啟航者 (完成第一筆快照)');
        if (c.netWorth >= 1000000) unlock('nw_1m', '💰 百萬將鋒 (淨資產突破 100 萬)');
        if (c.netWorth >= 5000000) unlock('nw_5m', '🚀 半息巡航 (淨資產突破 500 萬)');
        if (c.runwayMonths >= 6) unlock('runway_6m', '🛡️ 防禦大師 (活水防禦破 6 個月)');
        if (c.debtRatio < 30 && c.debtRatio > 0) unlock('debt_light', '🪶 無重力 (總負債比降至 30% 以下)');
        var isPerfectExp = Math.abs(c.ratioRaw - c.targetRatio) < 1.0;
        var hasAssets = c.holdingsCount > 0 && c.netWorth > 0;
        if (hasAssets && isPerfectExp) unlock('perfect_exp', '⚖️ 絕對精準 (實際曝險與目標誤差 < 1%)');

        var nextMilestone = nextMilestoneOf(c.netWorth);
        var q1Done = c.runwayMonths >= 6;
        var q1Pct = Math.min(100, Math.max(0, (c.runwayMonths / 6) * 100));
        var q2Done = (c.debtRatio < 30 && c.debtRatio > 0);
        var q2Pct = c.debtRatio <= 0 ? 0 : (c.debtRatio >= 100 ? 0 : Math.min(100, Math.max(0, (100 - c.debtRatio) / (100 - 30) * 100)));
        if (q2Done) q2Pct = 100;
        var expDiff = Math.abs(c.ratioRaw - c.targetRatio);
        var q3Done = isPerfectExp && hasAssets;
        var q3Pct = hasAssets ? Math.min(100, Math.max(0, 100 - (expDiff * 5))) : 0;
        if (q3Done) q3Pct = 100;
        return {
            achievements: a, newUnlocks: unlocks, nextMilestone: nextMilestone, mainPct: Math.min(100, Math.max(0, (c.netWorth / nextMilestone) * 100)),
            hasAssets: hasAssets, isPerfectExp: isPerfectExp, expDiff: expDiff,
            q1: { done: q1Done, pct: q1Pct }, q2: { done: q2Done, pct: q2Pct }, q3: { done: q3Done, pct: q3Pct }
        };
    }

    /* 目前曝險相對目標與容忍區的狀態：defcon 1＝超出容忍區、3＝接近邊界（容忍區的 80%）、5＝在容忍區內。淨資產 ≤ 0 時 enabled=false。 */
    function computeExposureStatus(netWorth, currentPct, targetPct, tolerance) {
        if (netWorth <= 0) return { enabled: false };
        var deviation = currentPct - targetPct, dev = Math.abs(deviation);
        var defcon = dev >= tolerance ? 1 : (dev >= tolerance * 0.8 ? 3 : 5);
        return { enabled: true, deviation: deviation, dev: dev, defcon: defcon,
            level: defcon === 1 ? 'alert' : (defcon === 3 ? 'watch' : 'safe'),
            label: defcon === 1 ? '超出容忍區' : (defcon === 3 ? '接近容忍邊界' : '在容忍區內') };
    }

    /* 首屏曝險量表的幾何：軌道 0～scaleMax（150% 與「目前／目標＋容忍」的 1.1 倍進位到 25 取大者），圓點與容忍帶的位置（0～100），以及「比目標高／低多少」的白話文字 */
    function computeGaugeModel(currentPct, targetPct, tolerance) {
        var scaleMax = Math.max(150, Math.ceil(Math.max(currentPct, targetPct + tolerance) * 1.1 / 25) * 25);
        var pos = function(v) { return Math.min(100, Math.max(0, v / scaleMax * 100)); };
        var bandLeft = pos(targetPct - tolerance), bandRight = pos(targetPct + tolerance);
        var deviation = currentPct - targetPct, dev = Math.abs(deviation), direction = deviation > 0 ? '高' : '低';
        var gapText = dev < 0.05 ? '曝險正好在目標上。'
            : '比目標' + direction + ' ' + dev.toFixed(1) + ' 個百分點' + (dev >= tolerance ? '，超出容忍區 ' + (dev - tolerance).toFixed(1) + ' 個百分點。' : '，仍在 ±' + tolerance + '% 容忍區內。');
        return { scaleMax: scaleMax, bandLeft: bandLeft, bandWidth: Math.max(0, bandRight - bandLeft), targetPos: pos(targetPct), markerPos: pos(currentPct),
            targetLabelLeft: Math.min(86, Math.max(14, pos(targetPct))), gapText: gapText };
    }

    /* 再平衡：投資部位要買或賣多少才會回到目標比例。總資產為 0 時回傳 null；gap > 0 買進、< 0 賣出；差距不到總資產 1% 視為 balanced。 */
    function computeRebalance(totalCash, totalInv, targetInvPct) {
        var totalPool = totalCash + totalInv;
        if (totalPool === 0) return null;
        var gap = (totalPool * (targetInvPct / 100)) - totalInv;
        return { totalPool: totalPool, gap: gap, balanced: Math.abs(gap) < totalPool * 0.01 };
    }

    /* 圓餅圖的資料整理：台股依代號歸戶、基金依名稱歸戶、槓桿分三桶（1 倍／1.5 倍以上／0 倍與其他）。市值 ≤ 0 的不列入。 */
    function groupHoldings(stocks, funds) {
        var groupedStocks = {}, groupedFunds = {}, leverageValues = [0, 0, 0];
        (stocks || []).forEach(function(s) {
            var code = (s.code || '').trim().toUpperCase() || '未命名台股';
            var val = (parseFloat(s.shares) || 0) * (parseFloat(s.price) || 0);
            var mult = s.mult !== undefined ? parseFloat(s.mult) : 1;
            if (val > 0) {
                groupedStocks[code] = (groupedStocks[code] || 0) + val;
                if (mult === 1) leverageValues[0] += val;
                else if (mult >= 1.5) leverageValues[1] += val;
                else leverageValues[2] += val;
            }
        });
        (funds || []).forEach(function(f) {
            var name = (f.name || '').trim() || '未命名資產';
            var val = parseFloat(f.value) || 0;
            if (val > 0) groupedFunds[name] = (groupedFunds[name] || 0) + val;
        });
        return { groupedStocks: groupedStocks, groupedFunds: groupedFunds, leverageValues: leverageValues };
    }

    /* ===== 凱利與蒙地卡羅 ===== */
    /* 輸入框文字 → 數字：空白、非數字、0 都改用預設值（報酬 8%、波動 18%、借款利率 2.5%、年數 10、每月投入 0） */
    function parseKellyInputs(raw) {
        return { mu: parseFloat(raw.mu) / 100 || 0.08, sigma: parseFloat(raw.sigma) / 100 || 0.18, r: (parseFloat(raw.rate) || 2.5) / 100 };
    }
    function parseMcInputs(raw) {
        return { years: parseFloat(raw.years) || 10, mu: parseFloat(raw.mu) / 100 || 0.08, sigma: parseFloat(raw.sigma) / 100 || 0.18, pmt: parseFloat(raw.pmt) || 0, borrowRate: (parseFloat(raw.rate) || 2.5) / 100 };
    }
    /* 凱利公式：最佳槓桿 f* = (μ − r) / σ²（不小於 0），並給 0～300% 槓桿的長期成長率曲線 */
    function computeKelly(mu, sigma, r) {
        var fullPct = Math.max(0, ((mu - r) / (sigma * sigma)) * 100);
        var labels = [], data = [];
        for (var i = 0; i <= 300; i += 10) { var frac = i / 100; labels.push(i + '%'); data.push((r + frac * (mu - r) - 0.5 * frac * frac * sigma * sigma) * 100); }
        return { fullPct: fullPct, halfPct: fullPct / 2, labels: labels, data: data };
    }
    /* 標準常態亂數（Box-Muller）。rng 是 0～1 之間的亂數函式（網頁傳 Math.random，測試傳固定序列）。 */
    function randnBm(rng) { var u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v); }
    /* 蒙地卡羅：p = { currentNW, targetNW, leverage（1＝100%）, years, mu, sigma, pmt（每月投入）, borrowRate, runs（預設 1000）, keepPaths（留幾條畫圖，預設 35）}
       ruinCount 即畫面上的「重挫機率」：任一個月資產 <= 起始淨值 × 20% 就算一次（不是真的歸零）。
       這類路徑之後以 0 計入中位數與走勢圖，屬保守假設。 */
    function simulateMonteCarlo(p, rng) {
        var runs = p.runs || 1000, keepPaths = p.keepPaths === undefined ? 35 : p.keepPaths;
        var dt = 1 / 12, months = p.years * 12;
        var mu_L = p.leverage * p.mu - Math.max(0, p.leverage - 1) * p.borrowRate, sigma_L = p.leverage * p.sigma, drift = (mu_L - 0.5 * Math.pow(sigma_L, 2)) * dt, vol = sigma_L * Math.sqrt(dt);
        var successCount = 0, ruinCount = 0, finalWealths = [], paths = [];
        for (var i = 0; i < runs; i++) {
            var W = p.currentNW, path = [W], isRuin = false;
            for (var m = 1; m <= months; m++) { W = W * Math.exp(drift + vol * randnBm(rng)) + p.pmt; if (W <= p.currentNW * 0.2) { isRuin = true; while (path.length <= months) path.push(0); break; } path.push(W); }
            var finalW = isRuin ? 0 : path[path.length - 1]; finalWealths.push(finalW); if (isRuin) ruinCount++; else if (finalW >= p.targetNW) successCount++; if (i < keepPaths) paths.push(path);
        }
        finalWealths.sort(function(a, b) { return a - b; });
        return { runs: runs, months: months, successCount: successCount, ruinCount: ruinCount, successPct: successCount * 100 / runs, ruinPct: ruinCount * 100 / runs,
            median: finalWealths[Math.floor(runs / 2)], finalWealths: finalWealths, paths: paths };
    }
    /* CORE-END */
