/* js/report.js — 匯出報表：CSV（Excel／Google 試算表開啟）與列印／存成 PDF。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。
   報表只收「白名單」裡的欄位（帳戶、負債、持股、基金、歷史快照與幾個設定數字）：GAS 網址、金鑰、備註、成就等一律不會出現在報表裡。
   PDF 不用任何外部函式庫：把報表排成專用版面，交給瀏覽器的列印功能（目的地選「另存為 PDF」），中文字型用系統內建的，離線也能用。 */

/* REPORT-BEGIN —— 純函式區：只吃資料、只回傳資料或字串；不碰 DOM、state、時間、亂數。
   computePortfolio、creditLoanStatus、parseYmd（core.js）與 computeStockPnl、summarizePnl（pnl.js）是它唯一依賴的外部函式；測試時一起載入。
   欄位型別 type：text 文字、money 金額（整數元）、money2 金額（兩位小數，如美元餘額）、pct 百分比（兩位小數）、dec1 一位小數、num 數量（最多四位小數）、pnl／pnlpct 損益（有正負、有顏色）。 */
var RPT_TYPES = { text: 1, money: 1, money2: 1, pct: 1, dec1: 1, num: 1, pnl: 1, pnlpct: 1 };

function rptRound(n, d) { var k = Math.pow(10, d); return Math.round(n * k) / k; }
function rptFinite(v) { return typeof v === 'number' && isFinite(v); }
function rptEsc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function(ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; });
}
function rptName(v, fallback) { var s = String(v === undefined || v === null ? '' : v).trim(); return s || fallback; }

/* ---------- CSV ---------- */
/* 一格 CSV：數字原樣輸出（Excel 才會當數字）；文字含逗號、引號、換行就用雙引號包起來；
   文字若以 = + - @ 或定位／換行字元開頭，Excel 會把它當公式執行（CSV 注入），所以前面補一個單引號讓它變成純文字。 */
function csvField(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/* 列用 CRLF 分隔（Excel 的慣例）；檔案開頭要加 BOM（寫成 \uFEFF），台灣的 Excel 才會把 UTF-8 的中文開成正確的字 */
var CSV_BOM = '\uFEFF';
function toCsv(rows) { return rows.map(function(r) { return r.map(csvField).join(','); }).join('\r\n') + '\r\n'; }

/* 存進 CSV 的數值：金額取整數元、百分比兩位小數、數量最多四位 */
function rptCsvValue(v, type) {
    if (v === undefined || v === null || v === '') return null;
    if (type === 'text') return String(v);
    if (!rptFinite(v)) return null;
    if (type === 'money' || type === 'pnl') return Math.round(v) === 0 ? 0 : Math.round(v);
    if (type === 'money2' || type === 'pct' || type === 'pnlpct') return rptRound(v, 2);
    if (type === 'dec1') return rptRound(v, 1);
    return rptRound(v, 4);
}

/* ---------- 把 state 整理成報表資料 ---------- */
function rptHistoryRows(history) {
    var rows = (Array.isArray(history) ? history : []).filter(function(h) { return h && typeof h === 'object'; }).map(function(h, i) {
        var ymd = parseYmd(h.date), nw = parseFloat(h.netWorth), ex = parseFloat(h.exposure);
        return { date: String(h.date === undefined || h.date === null ? '' : h.date), ok: !!ymd, nw: isFinite(nw) ? nw : null, ex: isFinite(ex) ? ex : null, auto: h.auto === true, i: i };
    });
    /* 日期正確的依日期由舊到新（YYYY-MM-DD 的文字順序就是日期順序）；日期壞掉的放在最後，照原順序，不丟資料 */
    rows.sort(function(a, b) { if (a.ok !== b.ok) return a.ok ? -1 : 1; if (a.ok && a.date !== b.date) return a.date < b.date ? -1 : 1; return a.i - b.i; });
    return rows;
}
var RPT_HISTORY_HEADERS = [{ label: '日期', type: 'text' }, { label: '淨資產(元)', type: 'money' }, { label: '曝險比(%)', type: 'pct' }, { label: '來源', type: 'text' }];
function rptHistoryTable(history) {
    return rptHistoryRows(history).map(function(r) { return [r.date, r.nw, r.ex, r.auto ? '自動記錄' : '手動記錄']; });
}

function buildReportModel(inp) {
    inp = inp || {};
    var accounts = (Array.isArray(inp.accounts) ? inp.accounts : []).filter(function(a) { return a && typeof a === 'object'; });
    var debts = (Array.isArray(inp.debts) ? inp.debts : []).filter(function(d) { return d && typeof d === 'object'; });
    var stocks = (Array.isArray(inp.stocks) ? inp.stocks : []).filter(function(s) { return s && typeof s === 'object'; });
    var funds = (Array.isArray(inp.funds) ? inp.funds : []).filter(function(f) { return f && typeof f === 'object'; });
    var usd = inp.usdRate;
    var P = computePortfolio({ accounts: accounts, debts: debts, stocks: stocks, funds: funds, usdRate: usd, livingExpense: inp.livingExpense, targetNetWorth: inp.targetNetWorth, today: inp.today });
    var summaryPnl = summarizePnl(stocks);

    var meta = { title: '曝險雷達報表', version: String(inp.version || ''), generatedText: String(inp.generatedText || ''), today: String(inp.today || ''), usdRate: parseFloat(usd) || 0, priceSync: String(inp.priceSync || ''), sandbox: inp.sandbox === true };

    /* ----- 總覽 ----- */
    var summary = [];
    function add(label, value, type, unit, note, kpi) { summary.push({ label: label, value: value, type: type, unit: unit || '', note: note || '', kpi: !!kpi }); }
    add('淨資產', P.netWorth, 'money', '元', '總資產扣掉總負債', true);
    add('總資產（投資＋現金）', P.assetsPool, 'money', '元', '', true);
    add('　現金', P.totalCash, 'money', '元', '美元帳戶用上方匯率換算');
    add('　投資資產（持股＋基金）', P.totalInv, 'money', '元', '依最近一次查價的市值');
    add('總負債', P.totalDebt, 'money', '元', '質押借款＋信貸剩餘本金', true);
    add('　質押借款', P.pledge, 'money', '元');
    add('　信貸剩餘本金', P.credit, 'money', '元', '已記錄還款進度的信貸，只算還沒還的本金');
    add('負債比', P.debtRatio, 'pct', '%', '總負債 ÷ 總資產');
    add('股市總曝險額', P.totalExp, 'money', '元', '各部位市值 × 槓桿倍數');
    add('曝險比', P.ratioRaw, 'pct', '%', '股市總曝險額 ÷ 淨資產', true);
    var target = parseFloat(inp.targetRatio), tol = parseFloat(inp.toleranceRatio);
    if (isFinite(target)) add('目標曝險比', target, 'pct', '%', isFinite(tol) ? '容忍區間 ±' + tol + ' 個百分點' : '');
    if (P.marginRatio < 999 && isFinite(P.marginRatio)) {
        add('質押維持率', P.marginRatio, 'pct', '%', '擔保品市值 ÷ 質押借款；低於 130% 會被追繳');
        if (rptFinite(P.marginDropFrac) && P.marginDropFrac >= 0) add('　大盤再跌多少會觸及 130%', P.marginDropFrac * 100, 'pct', '%');
    } else add('質押維持率', '無質押借款', 'text', '', '');
    add('每月固定支出', P.monthlyOutflow, 'money', '元', '質押月息＋信貸月付額＋生活費');
    add('　質押月息', P.monthlyPledgeInterest, 'money', '元');
    add('　信貸月付額', P.monthlyCreditPMT, 'money', '元');
    add('　生活費', parseFloat(inp.livingExpense) || 0, 'money', '元');
    if (P.runwayMonths < 999 && isFinite(P.runwayMonths)) add('現金可支撐月數', P.runwayMonths, 'dec1', '個月', '現金 ÷ 每月固定支出');
    add('淨資產目標', P.targetNW, 'money', '元');
    add('目標達成率', P.progressPct, 'pct', '%');
    if (summaryPnl.covered > 0) {
        add('持股投入成本', summaryPnl.basis, 'money', '元', '只統計已填均價且有現價的 ' + summaryPnl.covered + ' 檔');
        add('持股未實現損益', summaryPnl.pnl, 'pnl', '元', '');
        add('　損益率', summaryPnl.pct, 'pnlpct', '%');
        if (summaryPnl.dividendCovered > 0) add('　含股利總報酬', summaryPnl.total, 'pnl', '元', '未實現損益＋累計已領股利');
        if (summaryPnl.missingCost > 0) add('　未填均價的持股', summaryPnl.missingCost, 'num', '檔', '沒有算進上面的損益');
    }

    /* ----- 帳戶 ----- */
    var accountRows = [];
    accounts.forEach(function(a) {
        var bal = parseFloat(a.balance) || 0, isUsd = a.currency === 'USD', rate = isUsd ? (parseFloat(usd) || 0) : 1;
        if (!rptName(a.name, '') && !bal) return;
        accountRows.push([rptName(a.name, '(未命名)'), isUsd ? 'USD' : 'TWD', bal, isUsd ? rate : null, bal * rate]);
    });
    var accountTable = { headers: [{ label: '名稱', type: 'text' }, { label: '幣別', type: 'text' }, { label: '餘額(原幣)', type: 'money2' }, { label: '匯率', type: 'num' }, { label: '折合台幣(元)', type: 'money' }], rows: accountRows };

    /* ----- 負債 ----- */
    var debtRows = [];
    debts.forEach(function(d) {
        var p = parseFloat(d.principal) || 0, r = parseFloat(d.rate) || 0;
        if (!rptName(d.name, '') && !p) return;
        if (d.type === 'pledge') debtRows.push([rptName(d.name, '(未命名)'), '質押', p, r, null, null, p, (p * (r / 100)) / 12, '每月繳利息']);
        else {
            var L = creditLoanStatus(d, inp.today);
            debtRows.push([rptName(d.name, '(未命名)'), '信貸', L.principal, L.rate, L.total > 0 ? L.total : null, L.tracked ? L.paid : null, L.balance, L.pmt, L.done ? '已還清' : (L.tracked ? '還款中' : '未記錄進度')]);
        }
    });
    var debtTable = { headers: [{ label: '名稱', type: 'text' }, { label: '類型', type: 'text' }, { label: '貸款金額(元)', type: 'money' }, { label: '年利率(%)', type: 'num' }, { label: '期數(月)', type: 'num' }, { label: '已還期數', type: 'num' }, { label: '剩餘本金(元)', type: 'money' }, { label: '每月支出(元)', type: 'money' }, { label: '狀態', type: 'text' }], rows: debtRows };

    /* ----- 持股 ----- */
    var stockRows = [];
    stocks.forEach(function(s) {
        var shares = parseFloat(s.shares) || 0, price = parseFloat(s.price) || 0, code = rptName(s.code, '');
        if (!code && !shares && !price) return;
        var val = shares * price, mult = s.mult !== undefined ? parseFloat(s.mult) : 1, pn = computeStockPnl(s);
        stockRows.push([
            rptName(s.broker, ''), code || '(未填代號)', shares, shares / 1000, price, val, P.totalInv > 0 ? (val / P.totalInv) * 100 : null,
            isFinite(mult) ? mult : null, isFinite(mult) ? val * mult : null, s.isCollateral ? '是' : '否',
            pn.hasCost ? (parseFloat(s.cost) || 0) : null, pn.hasCost ? pn.basis : null, pn.hasCost && pn.ready ? pn.pnl : null, pn.hasCost && pn.ready ? pn.pct : null, pn.dividend > 0 ? pn.dividend : null
        ]);
    });
    var stockTable = { headers: [
        { label: '券商', type: 'text' }, { label: '代號', type: 'text' }, { label: '股數', type: 'num' }, { label: '張數', type: 'num', pdf: false }, { label: '現價(元)', type: 'num' },
        { label: '市值(元)', type: 'money' }, { label: '占投資資產(%)', type: 'pct', pdf: false }, { label: '槓桿倍數', type: 'num' }, { label: '曝險額(元)', type: 'money' }, { label: '質押', type: 'text' },
        { label: '均價(元)', type: 'num' }, { label: '成本(元)', type: 'money', pdf: false }, { label: '未實現損益(元)', type: 'pnl' }, { label: '損益率(%)', type: 'pnlpct' }, { label: '累計股利(元)', type: 'money', pdf: false }
    ], rows: stockRows };

    /* ----- 基金與其他資產 ----- */
    var fundRows = [];
    funds.forEach(function(f) {
        var val = parseFloat(f.value) || 0, name = rptName(f.name, '');
        if (!name && !val) return;
        var mult = f.mult !== undefined ? parseFloat(f.mult) : 1;
        fundRows.push([name || '(未命名)', val, P.totalInv > 0 ? (val / P.totalInv) * 100 : null, isFinite(mult) ? mult : null, isFinite(mult) ? val * mult : null, f.isCollateral ? '是' : '否']);
    });
    var fundTable = { headers: [{ label: '名稱', type: 'text' }, { label: '現值(元)', type: 'money' }, { label: '占投資資產(%)', type: 'pct' }, { label: '槓桿倍數', type: 'num' }, { label: '曝險額(元)', type: 'money' }, { label: '質押', type: 'text' }], rows: fundRows };

    /* ----- 歷史快照 ----- */
    var historyTable = { headers: RPT_HISTORY_HEADERS, rows: rptHistoryTable(inp.history) };
    var series = rptHistoryRows(inp.history).filter(function(r) { return r.ok && r.nw !== null; }).map(function(r) { var y = parseYmd(r.date); return { date: r.date, day: Math.round(Date.UTC(y.y, y.m - 1, y.d) / 86400000), v: r.nw }; });

    return { meta: meta, summary: summary, accounts: accountTable, debts: debtTable, stocks: stockTable, funds: fundTable, history: historyTable, series: series };
}

/* ---------- CSV 版面 ---------- */
function reportCsvRows(model) {
    var rows = [], m = model.meta;
    function table(title, t) {
        rows.push([]); rows.push(['【' + title + '】']);
        rows.push(t.headers.map(function(h) { return h.label; }));
        if (!t.rows.length) { rows.push(['（沒有資料）']); return; }
        t.rows.forEach(function(r) { rows.push(r.map(function(v, i) { return rptCsvValue(v, t.headers[i].type); })); });
    }
    rows.push(['【報表資訊】']);
    rows.push(['項目', '內容']);
    rows.push(['報表', m.title + (m.version ? ' ' + m.version : '')]);
    rows.push(['產生時間', m.generatedText]);
    rows.push(['資料日期', m.today]);
    rows.push(['美元匯率（USD→TWD）', rptCsvValue(m.usdRate, 'num')]);
    rows.push(['行情最後更新', m.priceSync || '尚未查價']);
    rows.push(['資料來源', m.sandbox ? '平行沙盤推演資料（不是真實資料）' : '真實資料']);
    rows.push([]); rows.push(['【總覽】']);
    rows.push(['項目', '數值', '單位', '說明']);
    model.summary.forEach(function(s) { rows.push([s.label.replace(/^　+/, ''), rptCsvValue(s.value, s.type), s.unit, s.note]); });
    table('帳戶', model.accounts);
    table('負債', model.debts);
    table('持股', model.stocks);
    table('基金與其他資產', model.funds);
    table('歷史快照', model.history);
    return rows;
}
function reportCsv(model) { return CSV_BOM + toCsv(reportCsvRows(model)); }
/* 只有歷史快照的純表格（沒有標題列、沒有空白列），方便直接在 Excel 畫圖或做樞紐分析 */
function historyCsv(history) {
    var rows = [RPT_HISTORY_HEADERS.map(function(h) { return h.label; })];
    rptHistoryTable(history).forEach(function(r) { rows.push(r.map(function(v, i) { return rptCsvValue(v, RPT_HISTORY_HEADERS[i].type); })); });
    return CSV_BOM + toCsv(rows);
}

/* ---------- 列印版面（HTML 字串）---------- */
function rptGroup(n) { return Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 4 }); }
/* 一格要顯示的文字與樣式。損益依「四捨五入後的整數元」判斷正負，和畫面上的規則一致；台灣慣例：漲紅、跌綠，另加 ▲▼ 讓黑白列印也分得出來 */
function rptCell(v, type) {
    if (v === undefined || v === null || v === '') return { text: '–', cls: 'rp-empty' };
    if (type === 'text') return { text: String(v), cls: '' };
    if (!rptFinite(v)) return { text: '–', cls: 'rp-empty' };
    if (type === 'pnl' || type === 'pnlpct') {
        var isMoney = type === 'pnl', q = isMoney ? Math.round(v) : rptRound(v, 2);
        var body = isMoney ? rptGroup(q) : Math.abs(q).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
        return { text: (q === 0 ? '' : (q > 0 ? '▲ ' : '▼ ')) + body, cls: q === 0 ? 'rp-flat' : (q > 0 ? 'rp-up' : 'rp-down') };
    }
    var neg = v < 0 ? '-' : '';
    if (type === 'money') return { text: neg + rptGroup(Math.round(v)), cls: '' };
    if (type === 'money2') return { text: neg + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), cls: '' };
    if (type === 'pct') return { text: neg + Math.abs(rptRound(v, 2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%', cls: '' };
    if (type === 'dec1') return { text: neg + Math.abs(rptRound(v, 1)).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), cls: '' };
    return { text: neg + rptGroup(v), cls: '' };
}
function rptSummaryValue(s) {
    var c = rptCell(s.value, s.type);
    if (c.cls === 'rp-empty') return c;      /* 算不出數字（資料壞掉）就顯示 –，不要印出 $NaN */
    if (s.type === 'money') c.text = (s.value < 0 ? '-' : '') + '$' + rptGroup(Math.round(s.value));
    else if (s.type === 'pnl') c.text = c.text.replace(/(\d)/, '$$$1');
    else if (s.type === 'num' || s.type === 'dec1') c.text += (s.unit ? ' ' + s.unit : '');
    return c;
}
function rptTableHTML(title, t, opts) {
    opts = opts || {};
    var cols = [];
    t.headers.forEach(function(h, i) { if (h.pdf !== false) cols.push(i); });
    var rows = t.rows;
    var skipped = 0;
    if (opts.lastN && rows.length > opts.lastN) { skipped = rows.length - opts.lastN; rows = rows.slice(-opts.lastN); }
    var h = '<section class="rp-section"><h2>' + rptEsc(title) + '</h2>';
    if (!rows.length) return h + '<p class="rp-none">（沒有資料）</p></section>';
    h += '<table class="rp-table"><thead><tr>' + cols.map(function(i) { return '<th class="' + (t.headers[i].type === 'text' ? 'l' : 'r') + '">' + rptEsc(t.headers[i].label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function(r) {
        h += '<tr>' + cols.map(function(i) { var c = rptCell(r[i], t.headers[i].type); return '<td class="' + (t.headers[i].type === 'text' ? 'l' : 'r') + (c.cls ? ' ' + c.cls : '') + '">' + rptEsc(c.text) + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table>';
    if (skipped > 0) h += '<p class="rp-note">只列出最近 ' + opts.lastN + ' 筆；共 ' + t.rows.length + ' 筆，完整紀錄請下載 CSV。</p>';
    return h + '</section>';
}
/* 座標軸上的大數字：億、萬 */
function rptCompact(n) {
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e8) return s + rptRound(a / 1e8, 2) + '億';
    if (a >= 1e4) return s + Math.round(a / 1e4) + '萬';
    return s + Math.round(a);
}
/* 淨資產走勢：純 SVG 折線（橫軸依真實日期等比例）；少於 2 筆就不畫 */
function buildTrendSVG(series) {
    if (!Array.isArray(series) || series.length < 2) return '';
    var W = 680, H = 180, L = 62, R = 14, T = 14, B = 28;
    var d0 = series[0].day, d1 = series[series.length - 1].day, lo = Infinity, hi = -Infinity;
    series.forEach(function(p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var xs = function(day) { return d1 === d0 ? L : L + (day - d0) / (d1 - d0) * (W - L - R); };
    var ys = function(v) { return T + (hi - v) / (hi - lo) * (H - T - B); };
    var out = '<svg class="rp-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="淨資產走勢圖">';
    for (var g = 0; g < 3; g++) {
        var gv = lo + (hi - lo) * g / 2, gy = ys(gv).toFixed(1);
        out += '<line class="rp-grid" x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '"/><text class="rp-axis" x="' + (L - 6) + '" y="' + (+gy + 3).toFixed(1) + '" text-anchor="end">' + rptEsc(rptCompact(gv)) + '</text>';
    }
    out += '<polyline class="rp-line" points="' + series.map(function(p) { return xs(p.day).toFixed(1) + ',' + ys(p.v).toFixed(1); }).join(' ') + '"/>';
    var last = series[series.length - 1];
    out += '<circle class="rp-dot" cx="' + xs(last.day).toFixed(1) + '" cy="' + ys(last.v).toFixed(1) + '" r="3"/>';
    out += '<text class="rp-axis" x="' + L + '" y="' + (H - 8) + '" text-anchor="start">' + rptEsc(series[0].date) + '</text><text class="rp-axis" x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + rptEsc(last.date) + '</text></svg>';
    return out;
}
function renderReportHTML(model) {
    var m = model.meta, h = '<article class="rp-page">';
    h += '<header class="rp-head"><h1>' + rptEsc(m.title) + (m.version ? ' <small>' + rptEsc(m.version) + '</small>' : '') + '</h1><div class="rp-sub">產生時間：' + rptEsc(m.generatedText) + '　·　美元匯率 ' + rptEsc(m.usdRate) + '　·　行情最後更新：' + rptEsc(m.priceSync || '尚未查價') + '</div></header>';
    if (m.sandbox) h += '<div class="rp-warn">⚠ 這份報表是「平行沙盤」的推演資料，不是你的真實資料。</div>';
    var kpis = model.summary.filter(function(s) { return s.kpi; });
    h += '<div class="rp-kpis">' + kpis.map(function(s) { var c = rptSummaryValue(s); return '<div class="rp-kpi"><div class="rp-kpi-l">' + rptEsc(s.label) + '</div><div class="rp-kpi-v">' + rptEsc(c.text) + '</div></div>'; }).join('') + '</div>';
    h += '<section class="rp-section"><h2>總覽</h2><table class="rp-table rp-sum"><tbody>' + model.summary.map(function(s) {
        var c = rptSummaryValue(s);
        return '<tr><td class="l">' + rptEsc(s.label) + '</td><td class="r' + (c.cls ? ' ' + c.cls : '') + '">' + rptEsc(c.text) + '</td><td class="l rp-n">' + rptEsc(s.note) + '</td></tr>';
    }).join('') + '</tbody></table></section>';
    var svg = buildTrendSVG(model.series);
    if (svg) h += '<section class="rp-section"><h2>淨資產走勢</h2>' + svg + '</section>';
    h += rptTableHTML('帳戶', model.accounts) + rptTableHTML('負債', model.debts) + rptTableHTML('持股', model.stocks) + rptTableHTML('基金與其他資產', model.funds);
    h += rptTableHTML('歷史快照', model.history, { lastN: 12 });
    h += '<footer class="rp-foot">本報表由曝險雷達整理，數字為產生當下的資料與最近一次查價；僅供個人記錄與規劃，不構成投資建議。報表不含 GAS 網址與金鑰。</footer></article>';
    return h;
}
/* REPORT-END */

/* ===================== 以下碰得到畫面與 state：收集資料、下載、列印 ===================== */
var REPORT_APP_VERSION = 'V17.6';

function reportNowText() {
    var d = new Date(), p = function(n) { return String(n).padStart(2, '0'); };
    return getLocalDateString(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function collectReportInput() {
    var eff = parseFloat(state.effectiveTargetRatio);
    return {
        version: REPORT_APP_VERSION, accounts: state.accounts, debts: state.debts, stocks: state.stocks, funds: state.funds, history: state.history,
        usdRate: usdTwdRate, livingExpense: state.livingExpense, targetNetWorth: state.targetNetWorth,
        targetRatio: isFinite(eff) ? eff : state.targetRatio, toleranceRatio: state.toleranceRatio,
        today: getLocalDateString(), generatedText: reportNowText(), priceSync: state.lastPriceSyncTime || '', sandbox: !!state.sandboxMode
    };
}
function reportFileName(kind, ext) {
    return (state.sandboxMode ? '沙盤_' : '') + '曝險雷達' + kind + '_' + getLocalDateString() + '.' + ext;
}
function reportDownload(text, filename, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
}
/* 盲視模式是「怕被旁邊的人看到數字」：報表會寫出實際金額，所以先問一下 */
async function reportConfirmBlind() {
    if (!state.blindMode) return true;
    return await confirmDialog('目前是盲視模式（畫面上的金額被遮住）。報表會包含實際金額，確定要繼續嗎？', { title: '匯出報表', okText: '繼續' });
}
async function exportReportCsv() {
    if (!(await reportConfirmBlind())) return;
    reportDownload(reportCsv(buildReportModel(collectReportInput())), reportFileName('報表', 'csv'), 'text/csv;charset=utf-8');
    showToast('已下載報表（.csv）。', 'success');
}
async function exportHistoryCsv() {
    if (!(await reportConfirmBlind())) return;
    if (!rptHistoryRows(state.history).length) { showToast('還沒有歷史快照可以匯出。', 'warn'); return; }
    reportDownload(historyCsv(state.history), reportFileName('歷史快照', 'csv'), 'text/csv;charset=utf-8');
    showToast('已下載歷史快照（.csv）。', 'success');
}
/* 列印／存成 PDF：把報表排進專用容器（平常是隱藏的），列印時只印它；印完（或取消）就清掉。
   存成 PDF 時預設檔名取自網頁標題，所以列印期間暫時把標題改成報表檔名。 */
async function printReport() {
    if (!(await reportConfirmBlind())) return;
    var host = document.getElementById('print-report'); if (!host) return;
    host.innerHTML = renderReportHTML(buildReportModel(collectReportInput()));
    var oldTitle = document.title; document.title = reportFileName('報表', 'pdf').replace(/\.pdf$/, '');
    var cleaned = false;
    function cleanup() {
        if (cleaned) return; cleaned = true;
        window.removeEventListener('afterprint', cleanup); host.innerHTML = ''; document.title = oldTitle;
    }
    window.addEventListener('afterprint', cleanup);
    setTimeout(function() { try { window.print(); } catch (e) { cleanup(); showToast('這個瀏覽器無法開啟列印視窗。', 'error'); } }, 60);
}
