/* js/pnl.js — 持股數量（股／張）與成本、未實現損益（含純函式區塊）。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== 持股數量：儲存值永遠是「股」(shares)；「張」只是輸入與顯示方式（1 張 = 1,000 股，不足 1 張為零股）=====
       舊資料、雲端備份、匯入檔都沒有 unit 欄位 → 視為「股」，行為與以前完全相同。 */
    var SHARES_PER_LOT = 1000;
    function sharesFromInput(raw, unit) {
        var n = parseFloat(raw) || 0;
        return unit === 'lot' ? Math.round(n * SHARES_PER_LOT) : n;       /* 張 → 股：四捨五入到整股（零股最小單位是 1 股） */
    }
    function qtyForDisplay(shares, unit) {
        var n = parseFloat(shares) || 0;
        return unit === 'lot' ? n / SHARES_PER_LOT : n;
    }
    function describeShares(shares, unit) {
        shares = parseFloat(shares) || 0;
        if (!(shares > 0)) return '';
        var fmt = function(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }); };
        var lots = Math.floor(shares / SHARES_PER_LOT + 1e-9), odd = Math.round((shares - lots * SHARES_PER_LOT) * 1e6) / 1e6;
        if (unit === 'lot') {
            var base = '= ' + fmt(shares) + ' 股';
            if (lots > 0 && odd > 0) return base + '（' + fmt(lots) + ' 張 + ' + fmt(odd) + ' 股零股）';
            if (lots === 0) return base + '（零股）';
            return base;
        }
        if (lots === 0) return '零股（不足 1 張）';
        return '= ' + fmt(lots) + ' 張' + (odd > 0 ? ' ' + fmt(odd) + ' 股' : '');
    }

    /* ===== 成本價與未實現損益（均價 cost、累計已領股利 dividend 都是「選填」欄位；沒填就完全不影響任何計算）=====
       損益只看「股數 × (現價 − 均價)」，與槓桿倍率、質押無關；均價與現價都是「每股元」，與輸入單位（張／股）無關。
       下面是純函式（PNL-BEGIN/END 之間），不碰 DOM，方便單獨測試。 */
    /* PNL-BEGIN */
    function computeStockPnl(stock) {
        var shares = parseFloat(stock && stock.shares) || 0;
        var price = parseFloat(stock && stock.price) || 0;
        var cost = parseFloat(stock && stock.cost) || 0;
        var dividend = parseFloat(stock && stock.dividend) || 0;
        if (!(dividend > 0)) dividend = 0;
        var r = { hasCost: shares > 0 && cost > 0, hasPrice: price > 0, ready: false, shares: shares, dividend: dividend, basis: 0, value: 0, pnl: 0, pct: 0, total: 0, totalPct: 0 };
        if (!r.hasCost) return r;
        r.basis = shares * cost;
        if (!r.hasPrice) return r;
        r.ready = true;
        r.value = shares * price;
        r.pnl = r.value - r.basis;
        r.pct = r.pnl / r.basis * 100;
        r.total = r.pnl + dividend;
        r.totalPct = r.total / r.basis * 100;
        return r;
    }
    /* 合計只統計「已填均價且有現價」的持股；股利合計則涵蓋所有有填股利的持股 */
    function summarizePnl(stocks) {
        var s = { holdings: 0, covered: 0, missingCost: 0, missingPrice: 0, basis: 0, value: 0, pnl: 0, pct: 0, dividendAll: 0, dividendCovered: 0, total: 0, totalPct: 0 };
        (stocks || []).forEach(function(stock) {
            var p = computeStockPnl(stock);
            if (p.shares > 0) s.holdings++;
            s.dividendAll += p.dividend;
            if (p.shares > 0 && !p.hasCost) { s.missingCost++; return; }
            if (!p.hasCost) return;
            if (!p.ready) { s.missingPrice++; return; }
            s.covered++; s.basis += p.basis; s.value += p.value; s.pnl += p.pnl; s.dividendCovered += p.dividend;
        });
        if (s.basis > 0) {
            s.pct = s.pnl / s.basis * 100;
            s.total = s.pnl + s.dividendCovered;
            s.totalPct = s.total / s.basis * 100;
        }
        return s;
    }
    /* 顯示用的正負號：以「四捨五入後的整數元」判斷，所以 +0.4 元顯示成 $0、不會變成紅色上漲；正負對稱捨入 */
    function pnlSign(n) { n = Number(n) || 0; return Math.round(Math.abs(n)) === 0 ? 0 : (n > 0 ? 1 : -1); }
    function pnlMoney(n) {
        var sg = pnlSign(n);
        return (sg > 0 ? '+' : (sg < 0 ? '-' : '')) + '$' + Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-US');
    }
    function pnlPct(p) {
        p = Number(p) || 0;
        var a = Math.round(Math.abs(p) * 10) / 10;
        return (a > 0 ? (p > 0 ? '+' : '-') : '') + a.toFixed(1) + '%';
    }
    function pnlTone(n) { var sg = pnlSign(n); return sg > 0 ? 'market-up' : (sg < 0 ? 'market-down' : 'pnl-flat'); }
    function pnlArrow(n) { var sg = pnlSign(n); return sg > 0 ? '▲ ' : (sg < 0 ? '▼ ' : ''); }
    /* PNL-END */

    /* 單檔損益那一行（台股慣例：紅＝賺、綠＝賠；除了顏色還有 ▲▼ 與正負號，色盲也看得懂） */
    function pnlLineHTML(stock) {
        var p = computeStockPnl(stock);
        if (!p.hasCost) return '';
        if (!p.ready) return '<span class="pnl-na">尚無現價，算不出損益</span>';
        var html = '<span class="pnl-main ' + pnlTone(p.pnl) + '"><span class="pnl-label">未實現損益</span> ' + pnlArrow(p.pnl) + pnlMoney(p.pnl) + '（' + pnlPct(p.pct) + '）</span>';
        if (p.dividend > 0) html += '<span class="pnl-total advanced-only ' + pnlTone(p.total) + '"><span class="pnl-label">含股利</span> ' + pnlArrow(p.total) + pnlMoney(p.total) + '（' + pnlPct(p.totalPct) + '）</span>';
        return html;
    }
    function updateStockPnlLabels() {
        (state.stocks || []).forEach(function(stock, index) {
            var el = document.getElementById('stock-pnl-' + index); if (el) el.innerHTML = pnlLineHTML(stock);
        });
    }
    function renderPnlSummary() {
        var el = document.getElementById('pnl-summary'); if (!el) return;
        var s = summarizePnl(state.stocks);
        if (s.covered === 0 && s.dividendAll === 0) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        el.classList.toggle('advanced-only', s.covered === 0);      /* 只有股利、沒有損益可看時，整塊只在詳細模式出現，避免簡潔模式出現空框 */
        var html = '';
        if (s.covered > 0) {
            html += '<div class="pnl-sum-main ' + pnlTone(s.pnl) + '"><span class="pnl-label">未實現損益合計</span> ' + pnlArrow(s.pnl) + pnlMoney(s.pnl) + '（' + pnlPct(s.pct) + '）</div>';
            html += '<div class="pnl-sum-sub">成本 $' + formatNum(s.basis) + ' · 市值 $' + formatNum(s.value) + '</div>';
            var notes = [];
            if (s.missingCost > 0) notes.push(s.missingCost + ' 檔沒填均價');
            if (s.missingPrice > 0) notes.push(s.missingPrice + ' 檔沒有現價');
            if (notes.length) html += '<div class="pnl-sum-sub">以上不含：' + notes.join('、') + '</div>';
        }
        if (s.dividendAll > 0) {
            html += '<div class="pnl-sum-sub advanced-only">已領股利合計 $' + formatNum(s.dividendAll) + '</div>';
            if (s.covered > 0 && s.dividendCovered > 0) html += '<div class="pnl-sum-sub advanced-only ' + pnlTone(s.total) + '" title="只計入已填均價的持股">含股利總報酬 ' + pnlArrow(s.total) + pnlMoney(s.total) + '（' + pnlPct(s.totalPct) + '）</div>';
        }
        el.innerHTML = html;
    }
