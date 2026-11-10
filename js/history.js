/* js/history.js — 淨值與曝險走勢：資料整理（含純函式區塊）與走勢圖。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== 淨值與曝險走勢圖：資料整理（純函式，HISTORY-BEGIN/END 之間，不碰 DOM）=====
       x 軸用「日期換算成的天數」，所以快照間隔不均時，點的位置仍照實際日期等比例排列。 */
    /* HISTORY-BEGIN */
    function histNum(v) {
        if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'object') return null;
        if (typeof v === 'string' && v.trim() === '') return null;
        var n = Number(v); return isFinite(n) ? n : null;
    }
    function parseDayNumber(dateStr) {
        if (typeof dateStr !== 'string') return null;
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr); if (!m) return null;
        var y = +m[1], mo = +m[2], d = +m[3], t = Date.UTC(y, mo - 1, d), chk = new Date(t);
        if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;   /* 擋掉 2026-02-30 這種不存在的日期 */
        return Math.round(t / 86400000);
    }
    function dayNumberToDate(n) {
        var d = new Date(Math.round(n) * 86400000), p2 = function(x) { return (x < 10 ? '0' : '') + x; };
        return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
    }
    /* 整理快照：丟掉日期或淨資產壞掉的、同一天只留最後一筆、依日期排序；曝險缺漏就是 null（圖上斷線，不當成 0）。不改動原資料 */
    function buildHistorySeries(history) {
        var byDay = {};
        (Array.isArray(history) ? history : []).forEach(function(h) {
            if (!h) return;
            var day = parseDayNumber(h.date), nw = histNum(h.netWorth);
            if (day === null || nw === null) return;
            byDay[day] = { date: h.date, day: day, netWorth: nw, exposure: histNum(h.exposure) };
        });
        return Object.keys(byDay).map(Number).sort(function(a, b) { return a - b; }).map(function(k) { return byDay[k]; });
    }
    function summarizeHistory(series) {
        series = series || [];
        var n = series.length, s = { count: n, firstDate: '', lastDate: '', spanDays: 0, nwFirst: 0, nwLast: 0, nwChange: 0, nwChangePct: null, expFirst: null, expLast: null, expChange: null };
        if (!n) return s;
        var first = series[0], last = series[n - 1];
        s.firstDate = first.date; s.lastDate = last.date; s.spanDays = last.day - first.day;
        s.nwFirst = first.netWorth; s.nwLast = last.netWorth; s.nwChange = last.netWorth - first.netWorth;
        if (first.netWorth > 0) s.nwChangePct = s.nwChange / first.netWorth * 100;
        var withExp = series.filter(function(p) { return p.exposure !== null; });
        if (withExp.length) {
            s.expFirst = withExp[0].exposure; s.expLast = withExp[withExp.length - 1].exposure;
            if (withExp.length >= 2) s.expChange = s.expLast - s.expFirst;
        }
        return s;
    }
    function histMoney(n) { return Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-US'); }
    function histSigned(n, body) { var r = Math.round(Math.abs(Number(n) || 0) * 10) / 10; return (r > 0 ? (n > 0 ? '+' : '-') : '') + body; }
    function describeHistory(s) {
        if (!s || !s.count) return '';
        var one = function(x) { return (Math.round(x * 10) / 10).toFixed(1); };
        if (s.count === 1) return '只有 1 筆快照（' + s.firstDate + '）：淨資產 $' + histMoney(s.nwLast) + (s.expLast !== null ? '、曝險 ' + one(s.expLast) + '%' : '') + '。再多記錄幾筆，就能看出趨勢。';
        var moneyTxt = (Math.round(Math.abs(s.nwChange)) === 0 ? '' : (s.nwChange > 0 ? '+' : '-')) + '$' + histMoney(s.nwChange);
        var t = s.firstDate + ' → ' + s.lastDate + '（' + s.spanDays + ' 天，共 ' + s.count + ' 筆）：淨資產 ' + moneyTxt;
        if (s.nwChangePct !== null) t += '（' + histSigned(s.nwChangePct, one(Math.abs(s.nwChangePct)) + '%') + '）';
        if (s.expChange !== null) t += '，曝險 ' + one(s.expFirst) + '% → ' + one(s.expLast) + '%（' + histSigned(s.expChange, one(Math.abs(s.expChange))) + ' 個百分點）';
        t += '。';
        if (s.expChange !== null) {
            if (s.nwChange > 0 && s.expChange <= -5) t += '曝險隨淨資產成長在下降，與降落導航的方向一致。';
            else if (s.nwChange > 0 && s.expChange >= 5) t += '淨資產成長的同時，曝險也在上升。';
            else if (s.nwChange < 0 && s.expChange >= 5) t += '淨資產下降會讓曝險比率被動升高（分母變小），建議留意維持率與現金水位。';
        }
        return t;
    }
    /* 左軸金額縮寫（台灣習慣：萬、億） */
    function compactMoney(n) {
        n = Number(n) || 0;
        var a = Math.abs(n), sign = n < 0 ? '-' : '';
        if (a >= 1e4) {
            var wan = Math.round(a / 1e4 * 10) / 10;
            if (wan < 10000) return sign + wan + '萬';
            return sign + (Math.round(a / 1e8 * 100) / 100) + '億';
        }
        return sign + Math.round(a);
    }
    function historyAxisLabel(day, spanDays) {
        var d = new Date(Math.round(day) * 86400000), m = d.getUTCMonth() + 1;
        return spanDays > 180 ? d.getUTCFullYear() + '/' + m : m + '/' + d.getUTCDate();
    }
    /* 橫軸刻度：從第一筆到最後一筆之間等距取 n 個整數天，n 依座標軸寬度決定（每個標籤留約 48px，標籤本身最寬約 45px）。
       自己決定刻度、不交給 Chart.js 去「湊整數」，這樣頭尾不會被硬塞一個邊界刻度而跟旁邊的標籤疊在一起。 */
    function historyTickValues(first, last, widthPx) {
        first = Math.round(Number(first)); last = Math.round(Number(last));
        if (!isFinite(first) || !isFinite(last) || last < first) return [];
        if (last === first) return [first];
        var w = Number(widthPx), n = Math.max(2, Math.min(5, isFinite(w) && w > 0 ? Math.floor(w / 48) : 3));
        var out = [];
        for (var i = 0; i < n; i++) { var v = Math.round(first + (last - first) * i / (n - 1)); if (!out.length || out[out.length - 1] !== v) out.push(v); }
        return out;
    }
    /* HISTORY-END */

    var historyAxisSpan = 0, historyAxisFirst = 0, historyAxisLast = 0;
    function updateHistoryChart() {
        var series = buildHistorySeries(state.history), summary = summarizeHistory(series), text = describeHistory(summary);
        var box = document.getElementById('ui-history-chart-container'), sumEl = document.getElementById('ui-history-summary'), canvas = document.getElementById('historyChart');
        if (sumEl) { setTextIfChanged(sumEl, text); sumEl.hidden = !text; }
        if (box) box.style.display = (series.length && charts.history) ? 'block' : 'none';
        if (canvas) canvas.setAttribute('aria-label', '淨資產與曝險比率走勢圖。' + (text || '目前沒有快照。'));
        if (!charts.history) return;
        historyAxisSpan = summary.spanDays;
        historyAxisFirst = series.length ? series[0].day : 0; historyAxisLast = series.length ? series[series.length - 1].day : 0;
        var pad = series.length > 1 ? Math.max(1, Math.round(summary.spanDays * 0.03)) : 3, ch = charts.history, first = series.length ? series[0].day : 0, last = series.length ? series[series.length - 1].day : 0;
        ch.data.datasets[0].data = series.map(function(p) { return { x: p.day, y: p.netWorth }; });
        ch.data.datasets[1].data = series.map(function(p) { return { x: p.day, y: p.exposure }; });
        ch.setActiveElements([]); if (ch.tooltip) ch.tooltip.setActiveElements([], { x: 0, y: 0 });   /* 資料換了就收掉提示框，避免它還指著已刪除的那一筆、點位置卡在舊的 */
        var radius = series.length > 60 ? 0 : 3;   /* 快照很多時不畫圓點，避免糊成一片（滑過仍會顯示） */
        ch.data.datasets[0].pointRadius = radius; ch.data.datasets[1].pointRadius = radius ? 4 : 0;
        ch.options.scales.x.min = series.length ? first - pad : undefined; ch.options.scales.x.max = series.length ? last + pad : undefined;   /* 頭尾各留一點空白；刻度設定 includeBounds:false，邊界不會被硬塞一個刻度去撞旁邊的標籤 */
        ch.update();
    }
