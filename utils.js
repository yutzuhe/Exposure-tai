/* js/utils.js — 小工具：格式化、跳脫字元、日期、風險標籤、數字動畫、防抖。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* =========================================================
       效能優化：Debounce 防抖封裝
       ========================================================= */
    function debounce(fn, delay) {
        var timer = null;
        return function() {
            var context = this, args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function() { fn.apply(context, args); }, delay);
        };
    }

    function animateNumber(id, newValue, prefix = '', suffix = '', decimals = 0) {
        var obj = document.getElementById(id); if (!obj) return;
        newValue = parseFloat(newValue) || 0; 
        var startValue = parseFloat(obj.getAttribute('data-val')) || 0;
        if (Math.abs(startValue - newValue) < 0.001) { 
            obj.setAttribute('data-val', newValue); 
            obj.innerText = prefix + (decimals > 0 ? newValue.toFixed(decimals) : formatNum(newValue)) + suffix; 
            return; 
        }
        obj.setAttribute('data-val', newValue);
        if (animFrames[id]) cancelAnimationFrame(animFrames[id]);
        var duration = 800; 
        var startTime = performance.now();
        function update(currentTime) {
            var progress = Math.min((currentTime - startTime) / duration, 1);
            var easeOutProgress = 1 - Math.pow(1 - progress, 4); 
            var currentVal = startValue + (newValue - startValue) * easeOutProgress;
            obj.innerText = prefix + (decimals > 0 ? currentVal.toFixed(decimals) : formatNum(currentVal)) + suffix;
            if (progress < 1) animFrames[id] = requestAnimationFrame(update); 
            else { 
                obj.innerText = prefix + (decimals > 0 ? newValue.toFixed(decimals) : formatNum(newValue)) + suffix; 
                delete animFrames[id]; 
            }
        }
        animFrames[id] = requestAnimationFrame(update);
    }

    function formatNum(num) { return Math.round(num || 0).toLocaleString(); }
    function setRiskLabel(elementId, level, text) {
        var element = document.getElementById(elementId); if (!element) return;
        element.classList.remove('status-safe', 'status-watch', 'status-alert', 'status-info');
        element.classList.add('status-' + level);
        element.innerText = text;
    }
    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, function(ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }
    function safeAttr(value) { return escapeHTML(value).replace(/`/g, '&#96;'); }
    function normalizeBrokerList(brokers, stocks) {
        var legacyNames = Array.isArray(stocks) ? stocks.map(function(stock) { return stock && stock.broker; }) : [];
        var baseNames = Array.isArray(brokers) ? brokers : DEFAULT_BROKERS;
        return Array.from(new Set(baseNames.concat(legacyNames).map(function(name) { return String(name || '').trim(); }).filter(Boolean)));
    }
    function getLocalDateString(date = new Date()) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
