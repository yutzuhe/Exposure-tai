/* js/charts.js — 圓餅圖與其他圖表：分類顏色、百分比明細、重型更新（防抖）、四大圓餅圖更新、圖表初始化。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */
    function getCategoryColor(label) {
        var key = String(label || ''); var hash = 0;
        for (var i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
        return chartPalette[((hash % chartPalette.length) + chartPalette.length) % chartPalette.length];
    }

    /* =========================================================
       V17.3 核心新增：圓餅圖右側「逐項百分比與市值進度列」渲染器
       ========================================================= */
function getBreakdownView(labels, values, colors) {
    var items = (labels || []).map(function(label, index) {
        return { label: label, value: parseFloat(values[index]) || 0, color: colors[index] || '#38bdf8' };
    }).filter(function(item) { return item.value > 0; }).sort(function(a, b) { return b.value - a.value; });
    if (!state.detailedView && items.length > 5) {
        var hidden = items.slice(5);
        items = items.slice(0, 5);
        items.push({
            label: '其他 (' + hidden.length + ' 項)',
            value: hidden.reduce(function(total, item) { return total + item.value; }, 0),
            color: '#64748b'
        });
    }
    return {
        labels: items.map(function(item) { return item.label; }),
        values: items.map(function(item) { return item.value; }),
        colors: items.map(function(item) { return item.color; })
    };
}

function renderPctBreakdownList(containerId, labels, values, colors, emptyMsg) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var total = (values || []).reduce(function(sum, v) { return sum + (parseFloat(v) || 0); }, 0);
        if (total <= 0 || !labels || labels.length === 0) {
            container.innerHTML = `<div style="font-size:12px; color:var(--text-sub); text-align:center; padding:18px 6px; border:1px dashed rgba(var(--ov),0.08); border-radius:10px;">${emptyMsg || '尚無部位數據'}</div>`;
            return;
        }
        var items = labels.map(function(label, idx) {
            var val = parseFloat(values[idx]) || 0;
            var pct = total > 0 ? (val / total) * 100 : 0;
            var color = colors[idx % colors.length] || '#38bdf8';
            return { label: label, val: val, pct: pct, color: color };
        }).filter(function(item) { return item.val > 0; });

        // 依佔比由大到小排序，讓視覺層次更清晰
        items.sort(function(a, b) { return b.val - a.val; });

        container.innerHTML = items.map(function(item) {
            return `
            <div class="pct-legend-item">
                    <div class="pct-legend-top">
                        <div class="pct-legend-name" title="${escapeHTML(item.label)}">
                            <span class="pct-color-dot" style="background:${item.color};"></span>
                            <span>${escapeHTML(item.label)}</span>
                        </div>
                        <div class="pct-legend-stats">
                            <span class="pct-badge-val tint-text" style="--c:${item.color}; color:var(--tc);">${item.pct.toFixed(1)}%</span>
                            <span class="pct-amt-val blur-target">$${formatNum(item.val)}</span>
                        </div>
                    </div>
                    <div class="pct-mini-bar-bg">
                        <div class="pct-mini-bar-fill" style="width:${Math.min(100, Math.max(2, item.pct))}%; background:${item.color};"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    var debouncedHeavyUpdate = debounce(function(v1x, v2x, totalCashSum, v0x) {
        var radarData = [v1x, v2x, totalCashSum + v0x];
        var radarLabels = ['1X 平穩推進', '2X+ 實質曝險', '防禦活水庫存'];
        var radarColors = ['#34d399', '#ec4899', '#38bdf8'];
        if(charts.radar) {
            charts.radar.data.datasets[0].data = radarData;
            charts.radar.update('none');
        }
        renderPctBreakdownList('radar-pct-list', radarLabels, radarData, radarColors, '尚無資產配置數據');
        updateSubCharts();
        saveData();
    }, 100);

    function resizeAllCharts() {
        requestAnimationFrame(function() {
            for (var id in charts) {
                if (charts[id] && typeof charts[id].resize === 'function') charts[id].resize();
            }
        });
    }

    /* =========================================================
       V17.3 強化版：正規化歸戶與四大圓餅圖右側百分比明細同步更新
       ========================================================= */
    function updateSubCharts() {
        try {
            var hg = groupHoldings(state.stocks, state.funds), groupedStocks = hg.groupedStocks, groupedFunds = hg.groupedFunds, leverageValues = hg.leverageValues;

            var rawStockLabels = Object.keys(groupedStocks), rawStockVals = Object.values(groupedStocks);
            var stockColors = rawStockLabels.map(getCategoryColor);
            var stockView = getBreakdownView(rawStockLabels, rawStockVals, stockColors);
            if (charts.stock) {
                charts.stock.data.labels = stockView.labels;
                charts.stock.data.datasets[0].data = stockView.values;
                charts.stock.data.datasets[0].backgroundColor = stockView.colors;
                charts.stock.update('none');
            }
            renderPctBreakdownList('stock-pct-list', stockView.labels, stockView.values, stockView.colors, '尚無台股持倉');

            var levLabels = ['1X 原型部位', '1.5X+ 槓桿部位', '0X 防禦部位'];
            var levColors = ['#34d399', '#ec4899', '#38bdf8'];
            if (charts.leverage) {
                charts.leverage.data.labels = levLabels;
                charts.leverage.data.datasets[0].data = leverageValues;
                charts.leverage.update('none');
            }
            renderPctBreakdownList('leverage-pct-list', levLabels, leverageValues, levColors, '尚無槓桿配置數據');

            var rawFundLabels = Object.keys(groupedFunds), rawFundVals = Object.values(groupedFunds);
            var fundColors = rawFundLabels.map(getCategoryColor);
            var fundView = getBreakdownView(rawFundLabels, rawFundVals, fundColors);
            if (charts.fund) {
                charts.fund.data.labels = fundView.labels;
                charts.fund.data.datasets[0].data = fundView.values;
                charts.fund.data.datasets[0].backgroundColor = fundView.colors;
                charts.fund.update('none');
            }
            renderPctBreakdownList('fund-pct-list', fundView.labels, fundView.values, fundView.colors, '尚無基金或海外資產');
        } catch(e) {
            console.error('子圖表更新失敗:', e);
        }
    }

    /* 圖表畫在 canvas 上，吃不到 CSS 變數，所以顏色要在這裡從目前的主題讀出來（themeColor 在 theme.js） */
    function chartTooltipColors() {
        return {
            backgroundColor: 'rgba(' + themeColor('--surface-rgb', '15,23,42') + ', 0.94)',
            titleColor: themeColor('--accent-blue', '#38bdf8'),
            bodyColor: themeColor('--text-main', '#f8fafc'),
            borderColor: 'rgba(' + themeColor('--accent-blue-rgb', '56,189,248') + ', 0.35)'
        };
    }

    /* 切換深色／淺色時，把已經畫好的圖表換成新主題的文字、提示框與走勢圖線條顏色 */
    function applyChartTheme() {
        if (typeof Chart === 'undefined') return;
        Chart.defaults.color = themeColor('--text-sub', '#94a3b8');
        var tip = chartTooltipColors(), blue = themeColor('--accent-blue', '#38bdf8'), purple = themeColor('--accent-purple', '#c084fc');
        Object.keys(charts).forEach(function(id) {
            var c = charts[id];
            if (!c || !c.options) return;
            if (c.options.plugins && c.options.plugins.tooltip) Object.assign(c.options.plugins.tooltip, tip);
            if (id === 'history' && c.data.datasets.length > 1) {
                c.data.datasets[0].borderColor = c.data.datasets[0].backgroundColor = blue;
                c.data.datasets[1].borderColor = c.data.datasets[1].backgroundColor = purple;
                c.options.scales.y.title.color = blue; c.options.scales.y1.title.color = purple;
                c.update();   /* 走勢圖已關動畫；update('none') 不會重新套用資料集樣式，這裡用一般 update */
            } else {
                try { c.update('none'); } catch (e) { /* 圖表還沒有資料或已被銷毀：下次畫的時候就是新顏色 */ }
            }
        });
    }

    function initCharts() {
        if (typeof Chart === 'undefined') return;
        Chart.defaults.color = themeColor('--text-sub', '#94a3b8');
        var tipColors = chartTooltipColors();
        var tooltipOpt = {
            backgroundColor: tipColors.backgroundColor, titleColor: tipColors.titleColor, bodyColor: tipColors.bodyColor, borderColor: tipColors.borderColor, borderWidth: 1, padding: 10, cornerRadius: 8,
            callbacks: {
                label: function(context) {
                    var data = context.dataset.data || [];
                    var total = data.reduce((sum, val, i) => sum + (context.chart.getDataVisibility(i) ? (parseFloat(val) || 0) : 0), 0);
                    var value = parseFloat(context.parsed) || 0;
                    var pct = total > 0 ? (value / total) * 100 : 0;
                    return ' ' + context.label + ': $' + formatNum(value) + ' (' + pct.toFixed(1) + '%)';
                }
            }
        };

        // 採用左圖右表（.chart-split-layout），關閉 Canvas 內部擁擠的 Legend，交給右側高質感 HTML 百分比明細列呈現
        var cleanDoughnutOpts = {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '66%',
            plugins: {
                legend: { display: false },
                tooltip: tooltipOpt
            },
            layout: { padding: 4 }
        };

        charts.radar = new Chart(document.getElementById('radarChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['1X 平穩推進', '2X+ 實質曝險', '防禦活水庫存'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#34d399', '#ec4899', '#38bdf8'], borderWidth: 0, hoverOffset: 6 }] },
            options: cleanDoughnutOpts
        });
        charts.stock = new Chart(document.getElementById('stockChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [], backgroundColor: chartPalette, borderWidth: 0, hoverOffset: 6 }] },
            options: cleanDoughnutOpts
        });
        charts.leverage = new Chart(document.getElementById('leverageChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['1X 原型部位', '1.5X+ 槓桿部位', '0X 防禦部位'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#34d399', '#ec4899', '#38bdf8'], borderWidth: 0, hoverOffset: 6 }] },
            options: cleanDoughnutOpts
        });
        charts.fund = new Chart(document.getElementById('fundChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [], backgroundColor: chartPalette, borderWidth: 0, hoverOffset: 6 }] },
            options: cleanDoughnutOpts
        });
        /* 淨資產（左軸，實線圓點）＋曝險比率（右軸，虛線菱形點）；兩條線形狀不同，不只靠顏色分辨 */
        var historyGrid = 'rgba(148, 163, 184, 0.15)';
        charts.history = new Chart(document.getElementById('historyChart').getContext('2d'), {
            type: 'line',
            data: { datasets: [
                { label: '淨資產（左軸）', data: [], yAxisID: 'y', borderColor: themeColor('--accent-blue', '#38bdf8'), backgroundColor: themeColor('--accent-blue', '#38bdf8'), borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, tension: 0.25, fill: false },
                { label: '曝險比率（右軸）', data: [], yAxisID: 'y1', borderColor: themeColor('--accent-purple', '#c084fc'), backgroundColor: themeColor('--accent-purple', '#c084fc'), borderWidth: 2, borderDash: [6, 4], pointStyle: 'rectRot', pointRadius: 4, pointHoverRadius: 7, tension: 0.25, fill: false, spanGaps: false }
            ] },
            options: {
                responsive: true, maintainAspectRatio: false, parsing: false,
                animation: false,   /* 走勢圖不需要動畫；而且 update('none') 不會重新套用資料集樣式（圓點大小），所以改成關動畫＋一般 update() */
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { type: 'linear', bounds: 'data', grid: { display: false }, afterBuildTicks: function(scale) { scale.ticks = historyTickValues(historyAxisFirst, historyAxisLast, scale.width).map(function(v) { return { value: v }; }); }, ticks: { maxTicksLimit: 5, precision: 0, maxRotation: 0, callback: function(v) { return historyAxisLabel(v, historyAxisSpan); } } },
                    y: { position: 'left', grace: '8%', grid: { color: historyGrid }, title: { display: true, text: '淨資產', color: themeColor('--accent-blue', '#38bdf8') }, ticks: { callback: function(v) { return compactMoney(v); } } },
                    y1: { position: 'right', grace: '8%', grid: { drawOnChartArea: false }, title: { display: true, text: '曝險 %', color: themeColor('--accent-purple', '#c084fc') }, ticks: { callback: function(v) { return v + '%'; } } }
                },
                plugins: {
                    legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 10, font: { size: 11 } } },
                    tooltip: Object.assign({}, tooltipOpt, { callbacks: {
                        title: function(items) { return items.length ? dayNumberToDate(items[0].parsed.x) : ''; },
                        label: function(c) {
                            var y = c.parsed.y;
                            return c.datasetIndex === 0 ? ' 淨資產：$' + formatNum(y) : ' 曝險：' + y.toFixed(1) + '%';
                        },
                        /* 曝險缺漏的那天，曝險線上沒有點，提示框就不會列出曝險；在這裡補一句說明 */
                        afterBody: function(items) {
                            if (!items.length) return '';
                            var pt = charts.history.data.datasets[1].data[items[0].dataIndex];
                            return (pt && pt.y === null) ? ' 曝險：當時沒記錄' : '';
                        }
                    } })
                }
            }
        });

        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(() => resizeAllCharts());
            var wrContainer = document.getElementById('war-room-container');
            if (wrContainer) ro.observe(wrContainer);
        }
    }
