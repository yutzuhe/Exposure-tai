/* js/state.js — 全域狀態與常數：state（所有使用者資料）、charts、色票、匯率等共用變數。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */    var usdTwdRate = 32.50; 
    var realStateBackup = null; 
    var isAppReady = false; 
    var animFrames = {}; 
    var deferredPwaPrompt = null;
    var DEFAULT_BROKERS = ['元大證券', '元大證金', '永豐證券'];
    var state = {
        schemaVersion: SCHEMA_VERSION, /* 資料格式版本：載入、儲存時都會對齊目前版本 */
        cash: 0, /* 由 updateTotals() 依各帳戶餘額加總後覆寫，這裡不放任何個人金額 */ targetRatio: 100, toleranceRatio: 5, targetNetWorth: 10000000, gasUrl: "", 
        autoGlidepath: false, glideMax: 200, glideMin: 100, vix: 15.0, dynamicSafeLine: 0,
        lifeAge: 0, lifeAgeYear: 0, retireAge: 0, glideBasis: 'networth', /* 年齡導航：0＝還沒填；glideBasis 預設沿用原本「依淨資產達標進度」 */
        autoDampener: false, biasRatio: 0.0, effectiveTargetRatio: 100,
        autoSnapshot: false, /* 自動記錄快照：預設關閉，要使用者自己打開 */
        rebalanceTargetInv: 50,
        kellyMu: 8.0, kellySigma: 18.0, mcYears: 10, mcMu: 8.0, mcSigma: 18.0, mcPmt: 30000,
        livingExpense: 30000, blindMode: false, warRoomMode: false, sandboxMode: false,
        accounts: [], debts: [], stocks: [], funds: [], notes: [], history: [], marketPrices: {}, brokers: DEFAULT_BROKERS.slice(), detailedView: false,
        achievements: { first_blood: false, nw_1m: false, nw_5m: false, runway_6m: false, debt_light: false, perfect_exp: false },
        tacticsOrder: ['widget-rebalance', 'widget-dca', 'widget-vix', 'widget-dampener', 'widget-kelly', 'widget-glide', 'widget-manual'],
        tacticsPinned: []
    };
    var charts = {};
    var chartPalette = ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#ec4899', '#22d3ee', '#14b8a6'];
    var currentFleetLevel = -1;
    var sortableRetry = 0;
