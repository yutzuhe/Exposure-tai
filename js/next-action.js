/* js/next-action.js — 下一步行動（含純函式區塊）與定期定額狙擊。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== 下一步行動：把「質押維持率／曝險／活水水位／投資現金配比／本月新增資金」合成「一個」建議 =====
       原本三個小工具各算各的、依據也不同（再平衡看投資÷現金、曝險看目標±容忍、發薪日看活水缺口），可能同時給出互相衝突的建議。
       這裡改成依風險高低排序，只挑最該先做的一件，其餘放進「其他提醒」。
       優先序：① 維持率低於 130%　② 曝險高於目標且超出容忍區　（②.5 未來 90 天現金會不夠付：有填每月收入的預報）　③ 維持率低於 166%　（③.5 現金會不夠付：沒填收入的預報）　④ 活水低於安全水位
              （④.5 未來 90 天現金會低於安全水位）　⑤ 曝險低於目標且超出容忍區（①～④都沒事才建議加碼）　⑥ 閒置活水可佈署　⑦ 投資／現金配比微調（不能與風險設定衝突）
       現金流預報（js/cashflow.js 的 buildCashflow）從 i.cashflow 傳進來；i.cashSoon 是「近 7 天要扣款／入帳」那句話，原樣顯示在卡片上。
       NEXT-ACTION-BEGIN：以下是純函式，不碰 DOM 與 state，方便單獨測試；金額文字用全域 formatNum。 */
    var NA_MIN_AMOUNT = 1000;   /* 差距小於這個金額就不提醒 */
    function naMoney(x) { return '$' + formatNum(x); }
    function naUp(x) { return Math.ceil(Math.max(0, x) / 1000 - 1e-9) * 1000; }    /* 風險相關的金額一律無條件進位到千元 */
    function naRound(x) { return Math.round(Math.max(0, x) / 1000) * 1000; }
    function naDate(s) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) + '/' + (+m[2]) : String(s || ''); }
    function naInDays(n) { return n === 0 ? '今天' : n + ' 天後'; }

    /* 本月新增資金怎麼分：先補活水缺口，再依「離目標曝險還差多少」放 2 倍槓桿或 1 倍。 */
    function allocateNewFunds(newFunds, safeLine, cash, totalInv, totalExp, totalDebt, targetPct) {
        cash = cash || 0;
        var cashShortage = Math.max(0, (safeLine || 0) - cash);
        var allocateCash = Math.min(newFunds, cashShortage), remaining = newFunds - allocateCash, allocate2X = 0, allocate1X = 0;
        if (remaining > 0) {
            var expGap = ((totalInv + cash + newFunds - totalDebt) * ((targetPct || 100) / 100)) - totalExp;
            if (expGap >= remaining * 2) allocate2X = remaining;
            else if (expGap > remaining) { allocate2X = expGap - remaining; allocate1X = remaining - allocate2X; }
            else if (expGap > 0) { allocate1X = expGap; allocateCash += (remaining - expGap); }
            else allocateCash += remaining;
        }
        return { cash: allocateCash, x2: allocate2X, x1: allocate1X };
    }

    function computeNextAction(i) {
        var money = naMoney;
        if (!(i.netWorth > 0)) {
            return { primary: { key: 'nodata', level: 'info', badge: '資料待填', title: '先輸入資產與負債', detail: '輸入帳戶、持股與借款後，這裡會告訴你下一步該做什麼。', lines: [] }, others: [], fundsNote: '', cashNote: '', metrics: null };
        }
        var target = i.targetPct, tol = i.tolerance;
        var expPct = i.totalExp / i.netWorth * 100, dev = expPct - target, absDev = Math.abs(dev);
        var expRoom = i.netWorth * target / 100 - i.totalExp;            /* >0：離目標還有多少曝險空間；<0：超出多少 */
        var hasPledge = i.pledge > 0, margin = hasPledge ? i.collateral / i.pledge * 100 : null;
        var repay = hasPledge ? Math.max(0, i.pledge - i.collateral / 1.66) : 0;          /* 還這麼多本金，維持率回到 166% */
        var addColl = hasPledge ? Math.max(0, 1.66 * i.pledge - i.collateral) : 0;        /* 或補這麼多擔保品市值 */
        var shortage = Math.max(0, i.safeLine - i.cash), excess = Math.max(0, i.cash - i.safeLine);
        var marginAlert = hasPledge && margin < 130, marginWatch = hasPledge && margin >= 130 && margin < 166;
        var over = dev > 0 && absDev >= tol, under = dev < 0 && absDev >= tol;
        var funds = i.newFunds > 0 ? i.newFunds : 0;
        var cands = [], extras = [];
        var cf = i.cashflow && i.cashflow.ok ? i.cashflow : null;
        var cashGap = !!(cf && cf.shortDate), cashDip = !!(cf && !cf.shortDate && cf.belowSafeDate && !(shortage >= NA_MIN_AMOUNT));
        var cashRisk = !!(cf && (cf.shortDate || cf.belowSafeDate));     /* 未來 90 天現金不夠付或會低於水位：先別建議加碼、也不建議把活水拿去佈署 */

        function marginLines() {
            var ls = [{ t: '還款約 ' + money(naUp(repay)) + '，維持率就能回到 166%' },
                      { t: '或補入未質押現股約 ' + money(naUp(addColl)) + (i.unpledgedStock >= addColl ? '' : (i.unpledgedStock >= NA_MIN_AMOUNT ? '（未質押現股只有 ' + money(i.unpledgedStock) + '，不夠補，建議還款）' : '（目前沒有未質押現股可以補，建議還款）')) }];
            if (repay > i.cash) ls.push({ t: '現金 ' + money(i.cash) + ' 不足以一次還清，可以分批還，或改用補券。', note: true });
            return ls;
        }
        if (marginAlert) cands.push({ prio: 1, key: 'margin-call', level: 'alert', badge: '優先處理', title: '先處理質押維持率',
            detail: '維持率 ' + margin.toFixed(1) + '%，已低於 130% 追繳參考線；先拉回 166% 以上。', lines: marginLines(),
            short: '質押維持率 ' + margin.toFixed(1) + '%，低於 130% 追繳參考線' });
        if (over) {
            var cut = -expRoom, ls2 = [{ t: '需要減少曝險約 ' + money(naRound(cut)) + '（' + money(i.totalExp) + ' → 約 ' + money(i.totalExp + expRoom) + '）' },
                { t: '換算：賣出 1 倍部位約 ' + money(naRound(cut)) + '，或 2 倍槓桿部位約 ' + money(naRound(cut / 2)) }];
            if (hasPledge) ls2.push({ t: '賣出的錢可以先還質押借款，維持率也會一起回升。', note: true });
            cands.push({ prio: 2, key: 'over-exposure', level: 'alert', badge: '優先處理', title: '降低股市曝險',
                detail: '曝險 ' + expPct.toFixed(1) + '%，比目標 ' + target + '% 高 ' + dev.toFixed(1) + ' 個百分點，超出容忍區（±' + tol + '%）。', lines: ls2,
                short: '曝險 ' + expPct.toFixed(1) + '%，比目標高 ' + dev.toFixed(1) + ' 個百分點（超出容忍區）' });
        }
        if (marginWatch) cands.push({ prio: 3, key: 'margin-watch', level: 'watch', badge: '建議處理', title: '把質押維持率拉回 166% 以上',
            detail: '維持率 ' + margin.toFixed(1) + '%，離 130% 追繳參考線還有一段，但低於 166% 安全線。', lines: marginLines(),
            short: '質押維持率 ' + margin.toFixed(1) + '%，低於 166% 安全線' });
        if (shortage >= NA_MIN_AMOUNT) cands.push({ prio: 4, key: 'buffer', level: 'watch', badge: '建議處理', title: '先補足活水儲備',
            detail: '現金低於安全水位（依 VIX 與負債推算），急用錢時可能被迫賣股。',
            lines: [{ t: '現金 ' + money(i.cash) + '，安全水位 ' + money(i.safeLine) }, { t: '建議補足約 ' + money(naUp(shortage)) }],
            short: '活水低於安全水位，缺約 ' + money(naUp(shortage)) });
        if (cashGap) {
            var gapLevel = cf.level === 'alert' ? 'alert' : 'watch', gapNeed = naUp(-cf.minBalance), gapLines = [{ t: '最大缺口約 ' + money(gapNeed) + '，要在 ' + naDate(cf.shortDate) + ' 之前補上' }];
            if (i.safeLine > 0) gapLines.push({ t: '想維持安全水位 ' + money(i.safeLine) + '，要補約 ' + money(naUp(i.safeLine - cf.minBalance)) });
            if (!cf.hasIncome) gapLines.push({ t: '預報還沒計入薪資等收入；有固定收入請到「現金流量」分頁填入，提醒才會準。', note: true });
            cands.push({ prio: gapLevel === 'alert' ? 2.5 : 3.5, key: 'cash-gap', level: gapLevel, badge: gapLevel === 'alert' ? '優先處理' : '建議處理', title: '預計現金不夠付',
                detail: '照目前已知的收支，' + naDate(cf.shortDate) + '（' + naInDays(cf.shortDays) + '）起現金會變成負的。', lines: gapLines,
                short: '預計 ' + naDate(cf.shortDate) + ' 起現金不夠付，缺約 ' + money(gapNeed) });
        } else if (cashDip) {
            cands.push({ prio: 4.5, key: 'cash-dip', level: 'watch', badge: '提前準備', title: '預計現金會低於安全水位',
                detail: naDate(cf.belowSafeDate) + '（' + naInDays(cf.belowSafeDays) + '）起，照目前已知的收支，現金會低於安全水位 ' + money(i.safeLine) + '。',
                lines: [{ t: '預計最低現金 ' + money(cf.minBalance) + '，建議在那之前補足約 ' + money(naUp(i.safeLine - cf.minBalance)) }],
                short: '預計 ' + naDate(cf.belowSafeDate) + ' 起現金低於安全水位' });
        }
        if (under) {
            if (shortage >= NA_MIN_AMOUNT || marginAlert || marginWatch || cashRisk) {
                extras.push('曝險低於目標約 ' + money(naRound(expRoom)) + '，等上面的事處理好再加碼');
            } else {
                cands.push({ prio: 5, key: 'under-exposure', level: 'info', badge: '可以加碼', title: '曝險低於目標，可以加碼',
                    detail: '曝險 ' + expPct.toFixed(1) + '%，比目標 ' + target + '% 低 ' + absDev.toFixed(1) + ' 個百分點，超出容忍區（±' + tol + '%）。',
                    lines: [{ t: '可增加曝險約 ' + money(naRound(expRoom)) },
                            excess >= NA_MIN_AMOUNT ? { t: '可動用的閒置活水約 ' + money(naRound(excess)) } : { t: '活水只夠安全水位，等下次新增資金再加碼。', note: true }],
                    short: '曝險低於目標約 ' + money(naRound(expRoom)) });
            }
        }
        if (!over && !under && !cashRisk && excess >= NA_MIN_AMOUNT && excess > i.safeLine * 0.2 && expRoom >= NA_MIN_AMOUNT) {
            cands.push({ prio: 6, key: 'idle-cash', level: 'info', badge: '可以佈署', title: '閒置活水可分批佈署',
                detail: '曝險還在目標範圍內，多出來的活水可以分批投入，不必一次到位。',
                lines: [{ t: '閒置活水約 ' + money(naRound(excess)) },
                        { t: '不超過目標曝險：1 倍部位最多再投入約 ' + money(naRound(Math.min(excess, expRoom))) + '（2 倍槓桿約 ' + money(naRound(Math.min(excess, expRoom / 2))) + '）' }],
                short: '閒置活水約 ' + money(naRound(excess)) + '，可分批佈署' });
        }
        var pool = i.cash + i.totalInv;
        if (pool > 0 && i.rebalanceTargetInv >= 0) {
            var agap = pool * (i.rebalanceTargetInv / 100) - i.totalInv, aabs = Math.abs(agap);
            if (aabs >= Math.max(NA_MIN_AMOUNT, pool * 0.01)) {
                var cashOk = agap > 0 ? i.cash - agap >= i.safeLine : true;
                var expOk = agap > 0 ? (i.totalExp + agap) / i.netWorth * 100 <= target + tol : (i.totalExp - aabs) / i.netWorth * 100 >= target - tol;
                var fine = cashOk && expOk;
                var why = !cashOk ? '會讓現金低於安全水位' : (agap > 0 ? '會讓曝險超出容忍區' : '會讓曝險低於容忍區');
                var verb = agap > 0 ? '買進' : '賣出';
                if (fine) cands.push({ prio: 7, key: 'allocation', level: 'info', badge: '可以微調', title: '投資與現金配比微調',
                    detail: '投資佔「投資＋現金」' + (i.totalInv / pool * 100).toFixed(1) + '%，你設定的目標是 ' + i.rebalanceTargetInv + '%。',
                    lines: [{ t: verb + '投資部位約 ' + money(naRound(aabs)) }], short: '投資／現金配比建議' + verb + '約 ' + money(naRound(aabs)) });
                else extras.push('資產配置小工具建議' + verb + '約 ' + money(naRound(aabs)) + '，但與目前的風險設定衝突（' + why + '），先不用理會');
            }
        }
        if (!over && !under && absDev >= tol * 0.8) extras.push('曝險接近容忍邊界（和目標差 ' + absDev.toFixed(1) + ' 個百分點）');
        if (cf && cf.stale && cf.stale.length) extras.push(cf.stale.map(function(s) { return s.name; }).join('、') + ' 的預計發放日已經過了，更新下一次的日期才會排進現金流預報');

        cands.sort(function(a, b) { return a.prio - b.prio; });
        var primary = cands.length ? cands[0] : { key: 'ok', level: 'safe', badge: '目前沒有急事', title: '維持現狀', lines: [],
            detail: '曝險 ' + expPct.toFixed(1) + '%（目標 ' + target + '%，容忍 ±' + tol + '%）' + (hasPledge ? '，維持率 ' + margin.toFixed(1) + '%' : '，沒有質押借款') + '，活水也在安全水位以上。' };
        var others = cands.slice(1).map(function(c) { return c.short; }).concat(extras);

        var fundsNote = '';
        if (funds) {
            if (primary.key === 'margin-call' || primary.key === 'margin-watch') {
                var use = Math.min(funds, repay);
                fundsNote = '本月新增資金 ' + money(funds) + '：建議先拿 ' + money(naUp(use)) + ' 還質押借款' + (funds > use ? '，剩下 ' + money(funds - use) + ' 先放現金。' : '。');
            } else if (primary.key === 'over-exposure') {
                fundsNote = '本月新增資金 ' + money(funds) + '：先放現金，暫時不要再加碼。';
            } else {
                var alloc = allocateNewFunds(funds, i.safeLine, i.cash, i.totalInv, i.totalExp, i.debt, target);
                fundsNote = '本月新增資金 ' + money(funds) + '：補活水 ' + money(alloc.cash) + '、2 倍槓桿 ' + money(alloc.x2) + '、1 倍 ' + money(alloc.x1) + '。';
            }
        }
        return { primary: primary, others: others, fundsNote: fundsNote, cashNote: i.cashSoon || '',
                 metrics: { expPct: expPct, dev: dev, margin: margin, repay: repay, addColl: addColl, shortage: shortage, excess: excess, expRoom: expRoom } };
    }
    /* NEXT-ACTION-END */

    var lastNextActionInput;   /* 不給初始值：避免載入順序造成已經算好的內容被重設 */
    function renderNextAction(res) {
        var card = document.getElementById('ui-next-action'); if (!card) return;
        var p = res.primary;
        card.setAttribute('data-level', p.level);
        setRiskLabel('ui-na-badge', p.level, p.badge);
        document.getElementById('ui-na-title').textContent = p.title;
        document.getElementById('ui-na-detail').textContent = p.detail;
        var ul = document.getElementById('ui-na-lines'); ul.textContent = '';
        (p.lines || []).forEach(function(line) { var li = document.createElement('li'); li.textContent = line.t; if (line.note) li.className = 'na-note'; ul.appendChild(li); });
        ul.hidden = !(p.lines && p.lines.length);
        var fundsEl = document.getElementById('ui-na-funds'); fundsEl.textContent = res.fundsNote || ''; fundsEl.hidden = !res.fundsNote;
        var cashEl = document.getElementById('ui-na-cash'); if (cashEl) { cashEl.textContent = res.cashNote || ''; cashEl.hidden = !res.cashNote; }
        var details = document.getElementById('ui-na-others'), list = document.getElementById('ui-na-others-list'); list.textContent = '';
        res.others.forEach(function(text) { var li = document.createElement('li'); li.textContent = text; list.appendChild(li); });
        details.hidden = !res.others.length;
        document.getElementById('ui-na-others-summary').textContent = '其他 ' + res.others.length + ' 項提醒';
    }
    function refreshNextAction() {
        if (!lastNextActionInput) return;
        lastNextActionInput.newFunds = parseFloat(document.getElementById('input-sniper-funds')?.value) || 0;
        renderNextAction(computeNextAction(lastNextActionInput));
    }

    function runSniperDCA() {
        var newFunds = parseFloat(document.getElementById('input-sniper-funds')?.value); var container = document.getElementById('sniper-result-container'); if(!container) return;
        refreshNextAction();   /* 「下一步行動」卡也要吃到這個金額 */
        if (isNaN(newFunds) || newFunds <= 0 || !lastNextActionInput) { container.style.display = 'none'; return; }
        /* 與「下一步行動」共用同一份總額（0 倍部位不會被當成 1 倍）與同一個分配函式，兩處數字一定一致 */
        var t = lastNextActionInput, a = allocateNewFunds(newFunds, state.dynamicSafeLine, state.cash, t.totalInv, t.totalExp, t.debt, state.effectiveTargetRatio);
        container.innerHTML = `<div style="font-size:12px; color:var(--text-main); line-height:1.8;">💧 補活水：<b>$${formatNum(a.cash)}</b> ｜ 🔥 2X 槓桿：<b>$${formatNum(a.x2)}</b> ｜ 🌱 1X 原型：<b>$${formatNum(a.x1)}</b></div>`;
        container.style.display = 'block';
    }
