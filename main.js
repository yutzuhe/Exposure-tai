/* js/main.js — 啟動：window.onload。最後載入。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    window.onload = function() { 
        initPWA();
        loadData(); 
        initCharts(); 
        initSortableWidgets();
        renderStocks();
        renderFunds();
        renderDetailsPage();
        renderNotes();
        renderSnapshots();
        renderTacticsWidgets();
        updateTotals();
        fetchUsdExchangeRate();
        flushPendingToast();
        setTimeout(() => { isAppReady = true; }, 800);
        setTimeout(() => { maybeAutoSnapshot('load'); }, 1200);   /* 等畫面與數字都算完再記 */
    };
