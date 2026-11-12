/* js/cashflow.js — 未來現金流時間表與提醒：把「已知會發生的錢進錢出」依日期排出來，推算每個日期之後的現金，找出現金不夠付、低於安全水位的日子。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

/* ===== 現金流預報（純函式，CASHFLOW-BEGIN/END 之間）=====
   只吃資料、只回傳資料：不碰 DOM、不讀 state、不呼叫時鐘（今天的日期由呼叫端傳進來）。依賴 core.js 的 parseYmd、daysInMonth、creditLoanStatus；測試時一起載入。
   會排進時間表的收支（都是「每個月固定日期」或「股利發放日」，沒有任何猜測）：
     支出：信貸每期月付額（只排「還沒還的期數」）、質押借款每月利息、每月生活費
     進帳：每月固定收入（選填，薪資等）、每檔持股預計股利（發放日 × 股數 × 每股股利，可設每月／每季／每半年／每年自動往後推）
   日期規則：每月 D 日；那個月沒有 D 日（例如 31 日遇到 2 月）就算月底。沒填扣款日的項目一律用「預設扣款日」（預設每月 1 日）。
   信貸選「依繳款日自動計算」且填了第一期繳款日時，排期完全沿用 core.js 的算法（第 k 期＝第一期繳款日起第 k 個月；已到期的期數不再排，今天到期的那期算已繳）。其他項目今天到期的當作「還沒扣款／入帳」照算。
   同一天的收支，先扣款、後入帳（保守）。預計股利是稅前、未扣二代健保補充保費與匯費。
   不含：買賣股票、薪資以外的收入、現金利息、匯率變動。 */
/* CASHFLOW-BEGIN */
var CF_RANGES = [30, 60, 90];
var CF_EVERY = [0, 1, 2, 3, 4, 6, 12];          /* 股利每隔幾個月發一次；0 = 只這一次 */
var CF_SOON_DAYS = 7;                            /* 「近期」= 7 天內（含今天） */
var CF_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
var CF_EVERY_LABEL = { 0: '只這一次', 1: '每月', 2: '每 2 個月', 3: '每季', 4: '每 4 個月', 6: '每半年', 12: '每年' };

/* 日期 ↔ 整數天數（1970-01-01 = 0），純整數運算（Howard Hinnant 的 civil 演算法），不用 Date */
function cfDayNum(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400), yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}
function cfFromDayNum(n) {
    n += 719468;
    var era = Math.floor(n / 146097), doe = n - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400, doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
}
function cfPad(n) { return (n < 10 ? '0' : '') + n; }
function cfDateStr(n) { var p = cfFromDayNum(n); return p.y + '-' + cfPad(p.m) + '-' + cfPad(p.d); }
function cfWeekday(n) { return CF_WEEK[(((n + 4) % 7) + 7) % 7]; }          /* 1970-01-01 是星期四 */
function cfShortDate(str) { var p = parseYmd(str); return p ? p.m + '/' + p.d : String(str || ''); }
function cfGroup(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function cfMoneyText(n) { return (Math.round(n) < 0 ? '-' : '') + '$' + cfGroup(n); }
function cfSignedText(n) { return (n < 0 ? '-' : '+') + '$' + cfGroup(n); }
function cfUp(n) { return Math.ceil(Math.max(0, n) / 1000 - 1e-9) * 1000; }   /* 缺口金額一律無條件進位到千元 */

/* 輸入整理：壞值一律當作「沒填」或預設值 */
function cfDay(v, fallback) { var n = Math.floor(parseFloat(v)); return (isFinite(n) && n >= 1 && n <= 31) ? n : fallback; }
function cfRangeOf(v) { var n = parseInt(v, 10); return CF_RANGES.indexOf(n) >= 0 ? n : 60; }
function cfEveryOf(v) { var n = parseInt(v, 10); return CF_EVERY.indexOf(n) >= 0 ? n : 0; }
function cfMoney(v) { var n = parseFloat(v); return (isFinite(n) && n > 0) ? n : 0; }
function cfName(v, fallback) { var s = String(v === undefined || v === null ? '' : v).trim(); return s || fallback; }

/* 從 (起始年, 起始月 0~11) 往後第 k 個月的 day 日（超過月底就算月底）的天數 */
function cfMonthDate(y0, m0, k, day) {
    var idx = y0 * 12 + m0 + k, y = Math.floor(idx / 12), m = (idx % 12) + 1;
    return cfDayNum(y, m, Math.min(day, daysInMonth(y, m)));
}
/* 每月 day 日、落在 [from, to] 的所有日期；limit > 0 時最多取這麼多次（信貸只剩幾期就最多排幾期） */
function cfMonthly(day, from, to, limit) {
    var f = cfFromDayNum(from), out = [];
    for (var k = 0; k < 40; k++) {
        var dn = cfMonthDate(f.y, f.m - 1, k, day);
        if (dn > to) break;
        if (dn >= from) { out.push(dn); if (limit > 0 && out.length >= limit) break; }
    }
    return out;
}

/* 一檔持股的股利計畫。valid = 股數、每股股利、發放日三樣都有 */
function dividendPlan(stock) {
    stock = stock && typeof stock === 'object' ? stock : {};
    var shares = cfMoney(stock.shares), per = cfMoney(stock.divPerShare), ymd = parseYmd(stock.divDate);
    return { shares: shares, perShare: per, amount: shares * per, ymd: ymd, date: ymd ? ymd.y + '-' + cfPad(ymd.m) + '-' + cfPad(ymd.d) : '', every: cfEveryOf(stock.divEvery), valid: shares > 0 && per > 0 && !!ymd };
}
/* 這個計畫在 [from, to] 內會入帳的日期；只這一次、而且日期已經過了 → stale（要提醒使用者更新） */
function cfDividendDays(plan, from, to) {
    var r = { days: [], stale: false };
    if (!plan.valid) return r;
    var y0 = plan.ymd.y, m0 = plan.ymd.m - 1, d0 = plan.ymd.d;
    if (plan.every === 0) {
        var dn = cfDayNum(y0, plan.ymd.m, d0);
        if (dn >= from && dn <= to) r.days.push(dn); else if (dn < from) r.stale = true;
        return r;
    }
    for (var k = 0; k < 1200; k += plan.every) {
        var x = cfMonthDate(y0, m0, k, d0);
        if (x > to) break;
        if (x >= from) r.days.push(x);
    }
    return r;
}
/* 持股卡片上的一行說明（空字串＝什麼都不用說） */
function dividendNote(stock, todayStr) {
    var plan = dividendPlan(stock), t = parseYmd(todayStr);
    var touched = plan.perShare > 0 || !!plan.ymd || (stock && parseInt(stock.divEvery, 10) > 0);
    if (!touched) return '';
    if (!plan.valid) return '還要填好「預計發放日」「每股股利」和持股股數，才會排進現金流預報。';
    if (plan.every === 0 && t && cfDayNum(plan.ymd.y, plan.ymd.m, plan.ymd.d) < cfDayNum(t.y, t.m, t.d)) return '發放日 ' + cfShortDate(plan.date) + ' 已經過了，更新下一次發放日才會排進預報。';
    var every = plan.every > 0 ? '，' + CF_EVERY_LABEL[plan.every] + '重複' : '';
    return '預計 ' + cfShortDate(plan.date) + ' 入帳約 ' + cfMoneyText(plan.amount) + '（稅前）' + every;
}

/* 預報的警示等級：現金會變成負的 → 有填每月收入才算 alert（沒填收入的預報只有支出，不能保證真的不夠，只給 watch）；會低於安全水位 → watch */
function cfLevel(cf) {
    if (!cf || !cf.ok) return '';
    if (cf.shortDate) return cf.hasIncome ? 'alert' : 'watch';
    if (cf.belowSafeDate) return 'watch';
    return '';
}

/* 主函式。inp = { today（YYYY-MM-DD）, days（30／60／90）, cash（現在的現金，台幣）, safeLine（現金安全水位，選填）,
                  debts, stocks, livingExpense, monthlyIncome, incomeDay, defaultDay }
   回傳 { ok, today, days, startCash, safeLine, events[], totalOut, totalIn, endCash, minBalance, minDate, shortDate, shortDays, belowSafeDate, belowSafeDays, belowSafeNow, level, soon[], stale[], defaultDay, usesDefaultDay, hasIncome, hasData }
   events[i] = { date, dayNum, inDays（離今天幾天）, weekday, kind（pledge／credit／living／income／dividend）, name, amount（支出為負）, balance（這筆發生後的現金）} */
function buildCashflow(inp) {
    inp = inp || {};
    var t = parseYmd(inp.today), days = cfRangeOf(inp.days);
    var startCash = parseFloat(inp.cash); if (!isFinite(startCash)) startCash = 0;
    var defaultDay = cfDay(inp.defaultDay, 1), incomeDay = cfDay(inp.incomeDay, 5), safe = cfMoney(inp.safeLine);
    var res = { ok: !!t, today: String(inp.today || ''), days: days, startCash: startCash, safeLine: safe, events: [], totalOut: 0, totalIn: 0, endCash: startCash, minBalance: startCash, minDate: '',
                shortDate: '', shortDays: null, belowSafeDate: '', belowSafeDays: null, belowSafeNow: safe > 0 && startCash < safe, level: '', soon: [], stale: [],
                defaultDay: defaultDay, usesDefaultDay: false, hasIncome: cfMoney(inp.monthlyIncome) > 0, hasData: false };
    if (!t) return res;
    var from = cfDayNum(t.y, t.m, t.d), to = from + days, raw = [];
    function add(dn, kind, name, amount) { raw.push({ dn: dn, kind: kind, name: name, amount: amount, order: raw.length }); }

    (Array.isArray(inp.debts) ? inp.debts : []).forEach(function(d) {
        if (!d || typeof d !== 'object') return;
        if (d.type === 'pledge') {
            var interest = cfMoney(d.principal) * (cfMoney(d.rate) / 100) / 12;
            if (!(interest > 0)) return;
            var dp = cfDay(d.payDay, 0); if (!dp) { dp = defaultDay; res.usesDefaultDay = true; }
            cfMonthly(dp, from, to).forEach(function(dn) { add(dn, 'pledge', cfName(d.name, '質押') + ' 利息', -interest); });
        } else {
            var L = creditLoanStatus(d, inp.today);
            if (L.done || !(L.pmt > 0) || !(L.remaining > 0)) return;
            var fp = parseYmd(d.firstPay), nm = cfName(d.name, '信貸') + ' 還款', dates = [];
            if (d.progress === 'auto' && fp) {
                for (var k = L.paid; k < L.total; k++) { var dn2 = cfMonthDate(fp.y, fp.m - 1, k, fp.d); if (dn2 > to) break; dates.push(dn2); }
            } else {
                var dc = cfDay(d.payDay, 0); if (!dc) { if (fp) dc = fp.d; else { dc = defaultDay; res.usesDefaultDay = true; } }
                dates = cfMonthly(dc, from, to, L.remaining);
            }
            dates.forEach(function(dn) { add(dn, 'credit', nm, -L.pmt); });
        }
    });
    var living = cfMoney(inp.livingExpense);
    if (living > 0) { res.usesDefaultDay = true; cfMonthly(defaultDay, from, to).forEach(function(dn) { add(dn, 'living', '生活費', -living); }); }
    var income = cfMoney(inp.monthlyIncome);
    if (income > 0) cfMonthly(incomeDay, from, to).forEach(function(dn) { add(dn, 'income', '固定收入', income); });
    (Array.isArray(inp.stocks) ? inp.stocks : []).forEach(function(s) {
        var plan = dividendPlan(s), r = cfDividendDays(plan, from, to), name = cfName(s && s.code, '持股') + ' 股利';
        if (r.stale) res.stale.push({ name: name, date: plan.date });
        r.days.forEach(function(dn) { add(dn, 'dividend', name, plan.amount); });
    });

    raw.sort(function(a, b) { return (a.dn - b.dn) || ((a.amount < 0 ? 0 : 1) - (b.amount < 0 ? 0 : 1)) || (a.order - b.order); });
    /* 什麼都還沒填（現金 0、也沒有借款／股利／收入，只剩預設的生活費）→ 不算「現金不夠付」：新開的網頁不該一開始就亮警示 */
    res.hasData = startCash !== 0 || raw.some(function(e) { return e.kind !== 'living'; });
    var bal = startCash, min = startCash;
    if (startCash < 0) { res.shortDate = res.today; res.shortDays = 0; }
    raw.forEach(function(e) {
        bal += e.amount;
        if (e.amount < 0) res.totalOut += -e.amount; else res.totalIn += e.amount;
        if (bal < min) { min = bal; res.minDate = cfDateStr(e.dn); }
        if (!res.shortDate && bal < 0) { res.shortDate = cfDateStr(e.dn); res.shortDays = e.dn - from; }
        if (!res.belowSafeDate && !res.belowSafeNow && safe > 0 && bal < safe) { res.belowSafeDate = cfDateStr(e.dn); res.belowSafeDays = e.dn - from; }
        res.events.push({ date: cfDateStr(e.dn), dayNum: e.dn, inDays: e.dn - from, weekday: cfWeekday(e.dn), kind: e.kind, name: e.name, amount: e.amount, balance: bal });
    });
    res.endCash = bal; res.minBalance = min;
    if (!res.hasData) { res.shortDate = ''; res.shortDays = null; res.belowSafeDate = ''; res.belowSafeDays = null; }
    res.soon = res.events.filter(function(e) { return e.inDays <= CF_SOON_DAYS; });
    res.level = cfLevel(res);
    return res;
}

/* 「近 7 天」那一句話：最多列 max 筆，其餘寫「等 N 筆」 */
function cfSoonText(cf, max) {
    if (!cf || !cf.ok || !cf.soon || !cf.soon.length) return '';
    max = max > 0 ? max : 4;
    var parts = cf.soon.slice(0, max).map(function(e) { return e.name + ' ' + cfShortDate(e.date) + ' ' + cfSignedText(e.amount); });
    return '近 ' + CF_SOON_DAYS + ' 天：' + parts.join('、') + (cf.soon.length > max ? '…等 ' + cf.soon.length + ' 筆' : '');
}
/* 現金流量分頁上方的警示文字（空字串＝沒事） */
function cfAlertText(cf) {
    if (!cf || !cf.ok) return '';
    var msg = '';
    if (cf.shortDate) msg = '照目前已知的收支，' + cfShortDate(cf.shortDate) + ' 起現金會變成負的，最大缺口約 ' + cfMoneyText(cfUp(-cf.minBalance)) + '。' + (cf.hasIncome ? '' : '預報還沒計入薪資等收入，有固定收入請填在下面的「預報設定」。');
    else if (cf.belowSafeDate) msg = '預計 ' + cfShortDate(cf.belowSafeDate) + ' 起現金會低於安全水位 ' + cfMoneyText(cf.safeLine) + '（最低 ' + cfMoneyText(cf.minBalance) + '）。';
    if (cf.stale.length) msg += (msg ? ' ' : '') + cf.stale.map(function(s) { return s.name; }).join('、') + ' 的預計發放日已經過了，請更新下一次的日期。';
    return msg;
}
/* CASHFLOW-END */

/* ===================== 以下碰得到畫面與 state：餵資料、畫到分頁上 ===================== */
/* 現金流預報的四個設定的預設值：匯入舊備份檔／雲端還原時，檔案裡沒有這些欄位就回到預設，而不是沿用這台裝置目前的設定 */
function cfSettingDefaults() { return { cfRange: 60, monthlyIncome: 0, incomeDay: 0, cfDefaultDay: 0 }; }
function cashflowInputFromState(days) {
    return { today: getLocalDateString(), days: days, cash: state.cash, safeLine: state.dynamicSafeLine, debts: state.debts, stocks: state.stocks,
             livingExpense: state.livingExpense, monthlyIncome: state.monthlyIncome, incomeDay: state.incomeDay, defaultDay: state.cfDefaultDay };
}

/* 現金流量分頁／手機底部導覽上的小圓點：alert 色＝預計現金不夠付（有填收入時）、watch 色＝可能不夠付或會低於安全水位 */
function renderCashflowDot(cf) {
    var level = cf && cf.ok ? cf.level : '';
    document.querySelectorAll('[data-cf-nav]').forEach(function(el) {
        var label = '現金流量' + (level === 'alert' ? '（預計現金不夠付，請看提醒）' : (level === 'watch' ? '（預計現金偏緊，請看提醒）' : ''));
        if (level) el.setAttribute('data-cf-dot', level); else el.removeAttribute('data-cf-dot');
        if (el.classList.contains('bottom-nav-item')) el.setAttribute('aria-label', label);
        else if (level) el.setAttribute('title', label); else el.removeAttribute('title');
    });
}

var CF_KIND_ICON = { pledge: '🪙', credit: '🏦', living: '🧾', income: '💼', dividend: '🎁' };
function renderCashflowCard(cf, all) {
    var stats = document.getElementById('cf-stats'), list = document.getElementById('cf-list'), alertEl = document.getElementById('cf-alert'), note = document.getElementById('cf-note');
    if (!stats || !list || !alertEl || !note) return;
    document.querySelectorAll('#cf-range button').forEach(function(b) { b.setAttribute('aria-pressed', String(parseInt(b.getAttribute('data-days'), 10) === cf.days)); });
    var minWhen = cf.minDate ? cfShortDate(cf.minDate) : '就是現在';
    stats.innerHTML = [
        ['未來 ' + cf.days + ' 天流出', cfMoneyText(-cf.totalOut), '', ''],
        ['未來 ' + cf.days + ' 天進帳', cfMoneyText(cf.totalIn), '', ''],
        [cf.days + ' 天後現金', cfMoneyText(cf.endCash), cf.endCash < 0 ? 'neg' : '', ''],
        ['最低現金', cfMoneyText(cf.minBalance), cf.minBalance < 0 ? 'neg' : '', minWhen]
    ].map(function(s) { return '<div class="cf-stat"><span>' + escapeHTML(s[0]) + '</span><b class="' + s[2] + '">' + escapeHTML(s[1]) + '</b>' + (s[3] ? '<small>' + escapeHTML(s[3]) + '</small>' : '') + '</div>'; }).join('');

    var msg = cfAlertText(all);          /* 提醒一律看 90 天，不受上面選的天數影響 */
    alertEl.hidden = !msg; alertEl.setAttribute('data-level', all.level || 'info'); alertEl.textContent = msg;

    var rows = '<div class="cf-row cf-edge"><div class="cf-date"><b>今天</b><span>' + escapeHTML(cfShortDate(cf.today)) + '</span></div><div class="cf-name">現在的現金</div><div class="cf-amt">' + escapeHTML(cfMoneyText(cf.startCash)) + '</div></div>';
    if (!cf.events.length) rows += '<p class="cf-empty">這段期間沒有已知的收支。到「資產負債」填入借款的扣款日、持股的預計股利，或在下面填入每月收入，這裡就會自動排出來。</p>';
    cf.events.forEach(function(e) {
        rows += '<div class="cf-row' + (e.inDays <= CF_SOON_DAYS ? ' soon' : '') + '" data-kind="' + e.kind + '"><div class="cf-date"><b>' + escapeHTML(cfShortDate(e.date)) + '</b><span>週' + e.weekday + '</span></div><div class="cf-name">' + (CF_KIND_ICON[e.kind] || '') + ' ' + escapeHTML(e.name) + '</div>' +
            '<div class="cf-amt ' + (e.amount < 0 ? 'out' : 'in') + '">' + escapeHTML(cfSignedText(e.amount)) + '<span class="cf-bal' + (e.balance < 0 ? ' neg' : '') + '">餘 ' + escapeHTML(cfMoneyText(e.balance)) + '</span></div></div>';
    });
    list.innerHTML = rows;
    note.textContent = '未填扣款日的項目（生活費、沒設日期的借款）暫以每月 ' + cf.defaultDay + ' 日計算。預計股利為稅前，未扣二代健保補充保費與匯費。不含買賣股票、薪資以外的收入與現金利息。今天到期的項目視為還沒扣款或入帳。';
}

/* 每次 updateTotals 呼叫：畫好現金流量分頁與導覽圓點，回傳 90 天的預報（給「下一步行動」用） */
function refreshCashflow() {
    var all = buildCashflow(cashflowInputFromState(90));
    renderCashflowDot(all);
    var days = cfRangeOf(state.cfRange);
    renderCashflowCard(days === 90 ? all : buildCashflow(cashflowInputFromState(days)), all);
    return all;
}
function setCashflowRange(days) { state.cfRange = cfRangeOf(days); saveData(); refreshCashflow(); }
/* 預報設定（預設扣款日、每月收入、收入入帳日）：輸入時只重算、不重畫輸入框，才不會搶走游標 */
function updateCashflowSetting(key, val) {
    var n = parseFloat(val), isDay = (key === 'cfDefaultDay' || key === 'incomeDay');
    if (isDay) n = Math.floor(n);
    state[key] = (isFinite(n) && n > 0 && (!isDay || n <= 31)) ? n : 0;
    updateTotals();
}
