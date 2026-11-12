// 單獨抽出 CORE-BEGIN/END 之間的純函式來測；用法：node core_test.js [index.html 路徑]
// 預期值都是手算（或用封閉公式、獨立的逐步模擬）得來，不是「把函式的輸出抄下來」。
const fs = require('fs'), vm = require('vm');
const SRC = process.argv[2] || require('path').join(__dirname, 'index.html');   // 預設：和這個檔案放在同一個資料夾的 index.html
// 讀 index.html，再把它用 <script src="js/…"> 載入的本機 JS 檔依序接在後面（CORE-BEGIN/END 在 js/core.js）
function loadSource(file) {
  const path = require('path'), page = fs.readFileSync(file, 'utf8'), parts = [page];
  for (const m of page.matchAll(/<script src="([^":]+\.js)"><\/script>/g)) {
    const p = path.join(path.dirname(file), m[1]);
    if (!fs.existsSync(p)) { console.log('FAIL index.html 引用的檔案不存在：' + m[1]); process.exit(1); }
    parts.push(fs.readFileSync(p, 'utf8'));
  }
  return parts.join('\n');
}
const html = loadSource(SRC);
const a = html.indexOf('/* CORE-BEGIN */'), b = html.indexOf('/* CORE-END */');
if (a < 0 || b < 0) { console.log('FAIL 找不到 CORE-BEGIN/END'); process.exit(1); }
const block = html.slice(a, b);

let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } }
const near = (x, y, eps) => Math.abs(x - y) <= (eps === undefined ? 1e-9 : eps);
const J = x => JSON.parse(JSON.stringify(x));

// ---- 0. 純度：靜態檢查（拿掉註解後，不能出現碰 DOM／state／儲存空間／時鐘／亂數／畫面輔助函式的字眼）----
const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const banned = [/\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /\bstate\b/, /Math\.random/, /Date\.now/, /new Date\(\s*\)/, /\banimateNumber\b/, /\bformatNum\b/, /\bshowToast\b/, /getElementById/, /\bcharts\b/, /\bsetRiskLabel\b/, /\bsetTimeout\b/, /\bconsole\b/];
banned.forEach(re => t('純度：CORE 區不含 ' + re, !re.test(code)));

// 在「沒有 document、沒有 state、Math.random 一呼叫就丟錯」的環境裡執行
const ctx = {}; vm.createContext(ctx);
vm.runInContext('Math.random = function() { throw new Error("CORE 不該自己呼叫 Math.random"); };', ctx);
vm.runInContext(block, ctx);
const C = ctx;
['calculatePMT', 'marginLevelOf', 'marginLabelOf', 'stressedValue', 'stressPortfolio', 'dropToMarginLine', 'computePortfolio', 'computeStress', 'nwGlideTarget', 'dampenAmountOf', 'effectiveTargetOf',
 'vixBandOf', 'computeDynamicBuffer', 'computeDrawdown', 'computeFireTime', 'computeFleet', 'nextMilestoneOf', 'computeQuests', 'computeExposureStatus', 'computeGaugeModel', 'computeRebalance',
 'groupHoldings', 'parseKellyInputs', 'parseMcInputs', 'computeKelly', 'randnBm', 'simulateMonteCarlo', 'daysInMonth', 'parseYmd', 'countPaidByDate', 'creditLoanStatus'].forEach(n => t('有定義：' + n, typeof C[n] === 'function'));

// ---- 1. 貸款月付額 ----
t('PMT：100 萬、3%、10 年 ≈ 9,656.07', near(C.calculatePMT(1000000, 3, 10), 9656.0744698, 1e-4), C.calculatePMT(1000000, 3, 10));
t('PMT：0% 利率＝本金平均攤', C.calculatePMT(500000, 0, 5) === 500000 / 60 && C.calculatePMT(500000, -2, 5) === 500000 / 60);
t('PMT：本金 ≤ 0 → 0', C.calculatePMT(0, 3, 5) === 0 && C.calculatePMT(-100, 3, 5) === 0);
(function() {   // 逐月還款模擬：照月付額還滿期數，餘額要剛好歸零
    const P = 800000, rate = 6.5, years = 3, pmt = C.calculatePMT(P, rate, years); let bal = P;
    for (let i = 0; i < years * 12; i++) bal = bal * (1 + rate / 100 / 12) - pmt;
    t('PMT：逐月攤還模擬，期末餘額 ≈ 0', Math.abs(bal) < 1e-6, bal);
    t('PMT：總付款 > 本金（有利息）', pmt * years * 12 > P);
})();

// ---- 2. 維持率燈號 ----
t('燈號邊界：166 安全、165.99 注意、130 注意、129.99 低於追繳線', C.marginLevelOf(166) === 'safe' && C.marginLevelOf(165.99) === 'watch' && C.marginLevelOf(130) === 'watch' && C.marginLevelOf(129.99) === 'alert');
t('燈號：無質押的 999 = 安全；NaN 不會被當成安全', C.marginLevelOf(999) === 'safe' && C.marginLevelOf(NaN) === 'alert');
t('燈號文字', C.marginLabelOf('safe') === '安全' && C.marginLabelOf('watch') === '注意' && C.marginLabelOf('alert') === '低於追繳線');

// ---- 3. 壓力測試 ----
t('單一部位：1 倍跌 10% → 90%、2 倍跌 10% → 80%', near(C.stressedValue(100, 1, 0.1), 90) && near(C.stressedValue(100, 2, 0.1), 80));
t('槓桿跌過頭只會到 0，不會變負；負的倍數當 0 倍', C.stressedValue(100, 2, 0.6) === 0 && C.stressedValue(100, 2, 1) === 0 && C.stressedValue(100, -1, 0.3) === 100 && C.stressedValue(100, 0, 0.9) === 100);
const POS = [{ val: 1000000, mult: 1, isCollateral: true, kind: 'stock' }, { val: 2000000, mult: 2, isCollateral: true, kind: 'stock' }, { val: 500000, mult: 0, isCollateral: false, kind: 'fund' }, { val: 300000, mult: 1, isCollateral: false, kind: 'stock' }];
let sp = C.stressPortfolio(POS, 0.1);
t('壓力組合 10%：投資 = 90 萬 + 160 萬 + 50 萬 + 27 萬 = 327 萬', near(sp.inv, 3270000, 1e-6), sp);
t('壓力組合 10%：曝險 = 90 萬 + 160 萬×2 + 0 + 27 萬 = 437 萬', near(sp.exp, 4370000, 1e-6), sp.exp);
t('壓力組合 10%：擔保品 = 250 萬；未質押現股 = 27 萬（基金不算現股）', near(sp.collateral, 2500000, 1e-6) && near(sp.unpledgedStock, 270000, 1e-6), sp);
t('壓力組合 0%＝原值；空清單全 0', near(C.stressPortfolio(POS, 0).inv, 3800000) && J(C.stressPortfolio([], 0.3)).inv === 0);
// 離追繳線還有多遠：封閉解
const one = [{ val: 1000000, mult: 1, isCollateral: true, kind: 'stock' }], two = [{ val: 1000000, mult: 2, isCollateral: true, kind: 'stock' }];
t('離 130% 線：單一 1 倍部位，V(1−s)=1.3P → s = 1 − 1.3P/V', near(C.dropToMarginLine(one, 500000, 1.3), 1 - 1.3 * 500000 / 1000000, 1e-9), C.dropToMarginLine(one, 500000, 1.3));
t('離 130% 線：單一 2 倍部位，V(1−2s)=1.3P → s = (1 − 1.3P/V)/2', near(C.dropToMarginLine(two, 500000, 1.3), (1 - 1.3 * 500000 / 1000000) / 2, 1e-9));
t('離 130% 線：混合部位 1M(1−s)+2M(1−2s)=2.6M → s=0.08', near(C.dropToMarginLine([one[0], { val: 2000000, mult: 2, isCollateral: true, kind: 'stock' }], 2000000, 1.3), 0.08, 1e-9));
t('離追繳線：已經在線下 → 0；質押 ≤ 0 → null；擔保品全是 0 倍 → null（跌 100% 也不觸及）', C.dropToMarginLine(one, 800000, 1.3) === 0 && C.dropToMarginLine(one, 0, 1.3) === null && C.dropToMarginLine(one, -5, 1.3) === null &&
  C.dropToMarginLine([{ val: 1000000, mult: 0, isCollateral: true, kind: 'stock' }], 500000, 1.3) === null);
t('離追繳線：要跌到 100% 才剛好碰到線（0 倍部位剛好等於 130% × 質押，另有 1 倍部位）→ 1', C.dropToMarginLine([{ val: 650000, mult: 0, isCollateral: true, kind: 'fund' }, { val: 300000, mult: 1, isCollateral: true, kind: 'stock' }], 500000, 1.3) === 1);
t('離追繳線：剛好等於線（維持率 130%）→ 0', C.dropToMarginLine(one, 1000000 / 1.3, 1.3) === 0 || near(C.dropToMarginLine(one, 1000000 / 1.3, 1.3), 0, 1e-9));

// ---- 4. 總覽加總 ----
const INP = { accounts: [{ balance: 1000000, currency: 'TWD' }, { balance: 10000, currency: 'USD' }], usdRate: 30, livingExpense: 30000, targetNetWorth: 5000000,
  debts: [{ type: 'pledge', principal: 2000000, rate: 2.4, term: 0 }, { type: 'credit', principal: 600000, rate: 3, term: 5 }],
  stocks: [{ shares: 1000, price: 1000, mult: 1, isCollateral: true }, { shares: 10000, price: 200, mult: 2, isCollateral: true }],
  funds: [{ value: 500000, mult: 0, isCollateral: false }] };
const inpSnap = JSON.stringify(INP);
const P = C.computePortfolio(INP);
t('加總：現金 = 100 萬 + 1 萬美金×30 = 130 萬', near(P.totalCash, 1300000));
t('加總：質押 200 萬、信貸 60 萬、總負債 260 萬', P.pledge === 2000000 && P.credit === 600000 && P.totalDebt === 2600000);
t('加總：質押月息 = 200 萬×2.4%÷12 = 4,000；信貸月付 = PMT；每月流出 = 兩者 + 生活費', near(P.monthlyPledgeInterest, 4000) && near(P.monthlyCreditPMT, C.calculatePMT(600000, 3, 5)) && near(P.monthlyOutflow, 4000 + C.calculatePMT(600000, 3, 5) + 30000));
t('加總：加權平均利率 = (200 萬×2.4 + 60 萬×3) ÷ 260 萬', near(P.avgRate, (2000000 * 2.4 + 600000 * 3) / 2600000));
t('加總：投資 350 萬、曝險 = 100 萬 + 400 萬 = 500 萬', P.totalInv === 3500000 && P.totalExp === 5000000);
t('加總：1 倍 100 萬、2 倍以上 400 萬、0 倍 50 萬', P.v1x === 1000000 && P.v2x === 4000000 && P.v0x === 500000);
t('加總：擔保品 300 萬 → 維持率 150%', P.collateral === 3000000 && near(P.marginRatio, 150));
t('加總：淨資產 = 350 + 130 − 260 = 220 萬；曝險比 = 500 ÷ 220', near(P.netWorth, 2200000) && near(P.ratioRaw, 5000000 / 2200000 * 100));
t('加總：現金 / 投資 / 負債占總資產（480 萬）', near(P.assetsPool, 4800000) && near(P.cashPct, 1300000 / 4800000 * 100) && near(P.invPct, 3500000 / 4800000 * 100) && near(P.debtRatio, 2600000 / 4800000 * 100));
t('加總：流動比率 = 總資產 ÷（質押 + 12 個月流出）', near(P.currentLiabilities, 2000000 + P.monthlyOutflow * 12) && near(P.currentRatio, 4800000 / (2000000 + P.monthlyOutflow * 12)));
t('加總：達標進度 = 220 萬 ÷ 500 萬 = 44%；續航 = 現金 ÷ 每月流出', near(P.progressPct, 44) && near(P.runwayMonths, 1300000 / P.monthlyOutflow));
t('加總：離 130% 追繳線再跌 8%（封閉解）', near(P.marginDropFrac, 0.08, 1e-9), P.marginDropFrac);
t('加總：positions 6 個欄位齊全（val/mult/isCollateral/kind）', P.positions.length === 3 && P.positions[2].kind === 'fund' && P.positions[1].mult === 2 && P.positions[1].isCollateral === true);
t('加總：不會改動傳入的資料', JSON.stringify(INP) === inpSnap);
const E1 = C.computePortfolio({ accounts: [], debts: [], stocks: [{ shares: 1, price: 100, mult: 1.5 }, { shares: 1, price: 100, mult: 1.49 }, { shares: 1, price: 100, mult: 0.5 }, { shares: 1, price: 100, mult: 3 }], funds: [{ value: 100, mult: 1.5 }, { value: 100, mult: 0 }], usdRate: 1 });
t('倍數分桶：≥1.5 進「2 倍以上」（1.5、3、基金 1.5）、0 < 倍數 < 1.5 進「1 倍」（1.49、0.5）、0 進 0 倍；桶內放的是曝險金額', E1.v2x === 150 + 300 + 150 && near(E1.v1x, 149 + 50) && E1.v0x === 100, [E1.v1x, E1.v2x, E1.v0x]);
t('達標進度：超過目標 → 100%（上限）、剛好達標 100%', C.computePortfolio({ accounts: [{ balance: 6000000 }], usdRate: 1, targetNetWorth: 5000000 }).progressPct === 100 && C.computePortfolio({ accounts: [{ balance: 5000000 }], usdRate: 1, targetNetWorth: 5000000 }).progressPct === 100);
const E2 = C.computePortfolio({ accounts: [], debts: [{ type: 'pledge', principal: 100, rate: 1 }], stocks: [{ shares: 1, price: 100, isCollateral: true }, { shares: 1, price: 50, isCollateral: false }], funds: [{ value: 200, isCollateral: true }, { value: 70, isCollateral: false }], usdRate: 1 });
t('擔保品：股票與基金「有勾擔保品」的才算（100 + 200 = 300）→ 維持率 300%', E2.collateral === 300 && near(E2.marginRatio, 300));
// 邊界與壞資料
let E = C.computePortfolio({ accounts: [], debts: [], stocks: [], funds: [], usdRate: 30, livingExpense: 0, targetNetWorth: 0 });
t('空資料：全 0、無質押 = 999、續航 999、流動比率 99、目標預設 1,000 萬', E.netWorth === 0 && E.ratioRaw === 0 && E.marginRatio === 999 && E.marginDropFrac === null && E.runwayMonths === 999 && E.currentRatio === 99 && E.targetNW === 10000000 && E.avgRate === 2.5 && E.cashPct === 0, E);
E = C.computePortfolio({ accounts: [{ balance: 'abc' }, { balance: 100 }], debts: [{ type: 'credit', principal: 'zz', rate: '', term: null }], stocks: [], funds: [], usdRate: 30, livingExpense: 'x' });
t('壞資料：非數字當 0，不產生 NaN', E.totalCash === 100 && E.totalDebt === 0 && E.monthlyOutflow === 0 && !Object.values(E).some(v => typeof v === 'number' && isNaN(v)), E);
E = C.computePortfolio({ accounts: [{ balance: 100000 }], debts: [{ type: 'pledge', principal: 3000000, rate: 2 }], stocks: [{ shares: 100, price: 900, mult: 1, isCollateral: true }], funds: [], usdRate: 30, livingExpense: 0 });
t('負淨資產：曝險比 0、進度 0、不爆掉', E.netWorth < 0 && E.ratioRaw === 0 && E.progressPct === 0);
E = C.computePortfolio({ accounts: [], debts: [], stocks: [{ shares: 1000, price: 100 }], funds: [{ value: 100 }], usdRate: 1 });
t('沒寫倍數的持股／基金當 1 倍', E.totalExp === 100100 && E.v1x === 100100 && E.positions[0].mult === 1 && E.positions[1].mult === 1);
E = C.computePortfolio({ accounts: [{ balance: 100, currency: 'USD' }], debts: [], stocks: [], funds: [], usdRate: 31.25 });
t('美元帳戶用傳入的匯率換算', E.totalCash === 3125);
E = C.computePortfolio({ accounts: [{ balance: 1 }], debts: [{ type: 'pledge', principal: 1000, rate: 5 }, { type: 'credit', principal: 1000, rate: 0, term: 2 }], stocks: [], funds: [], usdRate: 1 });
t('只要不是 pledge 就算信貸；0% 信貸月付＝本金 ÷ 期數', near(E.monthlyCreditPMT, 1000 / 24) && E.credit === 1000 && E.pledge === 1000);

// ---- 5. 災後情境 ----
let S = C.computeStress(P.positions, 0.1, P.totalCash, P.totalDebt, P.pledge);
t('災後 10%：投資 = 90 萬 + 160 萬 + 50 萬 = 300 萬 → 淨資產 = 300 + 130 − 260 = 170 萬', near(S.netWorth, 1700000, 1e-6), S.netWorth);
t('災後 10%：曝險 = 90 萬 + 160 萬×2 = 410 萬 → 曝險比 = 410 ÷ 170', near(S.exposurePct, 4100000 / 1700000 * 100, 1e-9));
t('災後 10%：擔保品 250 萬 → 維持率 125%、低於追繳線', near(S.margin, 125, 1e-9) && S.level === 'alert' && S.hasPledge === true);
t('災後 10%：還款救援 = 質押 − 擔保品 ÷ 1.66；補券 = 1.66×質押 − 擔保品', near(S.repayCashNeeded, 2000000 - 2500000 / 1.66, 1e-6) && near(S.addCollateralNeeded, 3320000 - 2500000, 1e-6));
S = C.computeStress(P.positions, 0, P.totalCash, P.totalDebt, P.pledge);
t('災後 0%＝現況（維持率 150%、淨資產同）', near(S.margin, 150) && near(S.netWorth, P.netWorth) && S.level === 'watch' && S.repayCashNeeded > 0 === (150 < 166));
S = C.computeStress(P.positions, 0, P.totalCash, P.totalDebt, 0);
t('沒質押：維持率 999、安全、hasPledge=false、救援金額 0', S.margin === 999 && S.level === 'safe' && S.hasPledge === false && S.repayCashNeeded === 0 && S.addCollateralNeeded === 0);
S = C.computeStress([], 0.3, 0, 500000, 0);
t('災後淨資產 ≤ 0 → 曝險比 0', S.exposurePct === 0 && S.netWorth === -500000);
t('災後維持率剛好 166% → 安全、救援 0', (() => { const s = C.computeStress([{ val: 1660000, mult: 1, isCollateral: true, kind: 'stock' }], 0, 0, 0, 1000000); return s.level === 'safe' && near(s.margin, 166) && near(s.repayCashNeeded, 0, 1e-6) && near(s.addCollateralNeeded, 0, 1e-6); })());

// ---- 6. 目標曝險 ----
t('依淨資產進度的下滑路徑：0% → 上限、50% → 中間、100% → 下限、四捨五入', C.nwGlideTarget(200, 100, 0) === 200 && C.nwGlideTarget(200, 100, 50) === 150 && C.nwGlideTarget(200, 100, 100) === 100 && C.nwGlideTarget(200, 100, 33.3) === 167);
t('阻尼：4.99→0、5→10、9.99→10、10→20、14.99→20、15→30', [[4.99, 0], [5, 10], [9.99, 10], [10, 20], [14.99, 20], [15, 30], [99, 30], [0, 0], [-3, 0]].every(x => C.dampenAmountOf(true, x[0]) === x[1]));
t('阻尼：關閉時一律 0；乖離是 undefined / NaN 也是 0', C.dampenAmountOf(false, 99) === 0 && C.dampenAmountOf(true, undefined) === 0 && C.dampenAmountOf(true, NaN) === 0);
t('生效目標 = 目標 − 阻尼，不低於 0', C.effectiveTargetOf(150, 30) === 120 && C.effectiveTargetOf(20, 30) === 0 && C.effectiveTargetOf(100, 0) === 100);

// ---- 7. VIX 與活水水位 ----
t('VIX 分級邊界：29.99 一般、30 升溫、39.99 升溫、40 高、49.99 高、50 極高', [[0, 'normal'], [29.99, 'normal'], [30, 'rising'], [39.99, 'rising'], [40, 'high'], [49.99, 'high'], [50, 'extreme'], [90, 'extreme']].every(x => C.vixBandOf(x[0]) === x[1]));
let B = C.computeDynamicBuffer(220000, 40000, 1000000, 15);
t('活水（VIX 15）：3 個月流出 + 負債 10% = 12 萬 + 10 萬 = 22 萬；剛好 → 平衡', B.safeLine === 220000 && B.runwayMonths === 3 && B.debtReservePct === 0.1 && B.status === 'balanced' && B.amount === 0, B);
t('活水：超出安全線不到（含）20% → 平衡；多 1 塊就算可佈署（金額 = 超出額）', C.computeDynamicBuffer(264000, 40000, 1000000, 15).status === 'balanced' && (b2 => b2.status === 'deploy' && b2.amount === 44001)(C.computeDynamicBuffer(264001, 40000, 1000000, 15)));
t('活水：少 1 塊 → 不足，金額 = 差額', (b2 => b2.status === 'short' && b2.amount === 1)(C.computeDynamicBuffer(219999, 40000, 1000000, 15)));
t('活水分級：VIX 20 → 6 個月/20%；30 → 12/30%；40 → 24/40%；19.99 → 3/10%', [[19.99, 3, 0.1], [20, 6, 0.2], [29.99, 6, 0.2], [30, 12, 0.3], [39.99, 12, 0.3], [40, 24, 0.4], [80, 24, 0.4]].every(x => { const r = C.computeDynamicBuffer(0, 1, 0, x[0]); return r.runwayMonths === x[1] && r.debtReservePct === x[2]; }));
t('活水：安全線 = 每月流出 × 月數 + 負債 × 比例（VIX 45：5 萬×24 + 100 萬×40% = 160 萬）', C.computeDynamicBuffer(0, 50000, 1000000, 45).safeLine === 1600000);
t('活水：安全線是 0 時，有現金就是平衡（不報可佈署）', (b2 => b2.safeLine === 0 && b2.status === 'balanced')(C.computeDynamicBuffer(0, 0, 0, 10)) && C.computeDynamicBuffer(5, 0, 0, 10).status === 'deploy');

// ---- 8. 回撤 ----
const NOW = Date.parse('2026-11-09T00:00:00Z');
let D = C.computeDrawdown(1000000, [{ date: '2026-01-05', netWorth: 1200000 }, { date: '2026-10-30', netWorth: 1500000 }, { date: '2026-11-01', netWorth: 900000 }], '2026-11-09', NOW);
t('回撤：最高 150 萬（10/30）、目前 100 萬 → −33.33%、水下 10 天', D.underwater && D.ath === 1500000 && D.athDate === '2026-10-30' && near(D.dropPct, -100 / 3, 1e-9) && D.diffDays === 10, D);
t('回撤：差幾小時也進位成整天', C.computeDrawdown(1, [{ date: '2026-10-30', netWorth: 2 }], '2026-11-09', NOW + 3600000).diffDays === 11);
D = C.computeDrawdown(2000000, [{ date: '2026-01-05', netWorth: 1200000 }], '2026-11-09', NOW);
t('回撤：目前就是最高（含今天）→ 不在水下', D.underwater === false && D.ath === 2000000 && D.athDate === '2026-11-09');
t('回撤：持平 → 不在水下', C.computeDrawdown(5, [{ date: '2026-01-05', netWorth: 5 }], '2026-11-09', NOW).underwater === false);
t('回撤：沒有歷史 → 不在水下；history 是 undefined/null 也不爆', C.computeDrawdown(100, [], 'x', NOW).underwater === false && C.computeDrawdown(100, undefined, 'x', NOW).underwater === false && C.computeDrawdown(100, null, 'x', NOW).underwater === false);
t('回撤：最高點 ≤ 0 不算（負淨資產，不除以負數）', C.computeDrawdown(-5, [{ date: '2026-01-05', netWorth: -1 }], 'x', NOW).underwater === false);
t('回撤：歷史裡有壞資料（淨值是文字）不影響', C.computeDrawdown(100, [{ date: '2026-01-05', netWorth: 'x' }, { date: '2026-02-05', netWorth: 150 }], '2026-11-09', NOW).ath === 150);

// ---- 9. 財富自由時間 ----
let F = C.computeFireTime(60000000, 10000000, 30000);
t('財富自由：已達標 → reached', F.reached === true && F.ok === true);
F = C.computeFireTime(1000000, 5000000, 30000);
(function() {   // 獨立模擬：年化 8%、每月存 3 萬，滿 floor(months) 個月還沒達標、再 1 個月就達標
    const r = Math.pow(1.08, 1 / 12) - 1; let W = 1000000, n = 0;
    while (W < 5000000 && n < 5000) { W = W * (1 + r) + 30000; n++; }
    t('財富自由：與逐月模擬一致（月數落在模擬的 n−1 與 n 之間）', F.months > n - 1 - 1e-6 && F.months <= n + 1e-6 && !F.reached && F.ok && F.years === Math.floor(F.months / 12) && F.remMonths === Math.floor(F.months % 12), [F, n]);
})();
t('財富自由：每月存款空白／0／文字 → 用 3 萬；有填就用填的', (() => { const base = C.computeFireTime(1000000, 5000000, 30000).months; return [undefined, '', 0, 'abc', null].every(v => C.computeFireTime(1000000, 5000000, v).months === base) && C.computeFireTime(1000000, 5000000, 60000).months < base && C.computeFireTime(1000000, 5000000, '60000').months === C.computeFireTime(1000000, 5000000, 60000).months; })());
t('財富自由：遙遠（超過 100 年）→ ok=false', C.computeFireTime(1, 1e12, 1).ok === false);
(function() {   // 用封閉解反推「剛好第 n 個月達標」的目標金額：淨資產 0、每月存 1 → T = ((1+r)^n − 1)/r
  const r = Math.pow(1.08, 1 / 12) - 1, target = n => (Math.pow(1 + r, n) - 1) / r;
  const f70 = C.computeFireTime(0, target(840.5), 1), f99 = C.computeFireTime(0, target(1199.5), 1), f100 = C.computeFireTime(0, target(1200.5), 1);
  t('財富自由：70 年算得出（ok）；99 年 11 個月仍 ok、滿 100 年 → 不 ok', near(f70.months, 840.5, 1e-6) && f70.years === 70 && f70.remMonths === 0 && f70.ok && f99.ok && f99.years === 99 && f99.remMonths === 11 && !f100.ok && f100.years === 100, [f70, f99, f100]);
})();
t('財富自由：淨資產為負也算得出來（不爆）', (f => isFinite(f.months) && f.ok)(C.computeFireTime(-500000, 5000000, 30000)));
t('財富自由：剛好等於目標 → 已達標', C.computeFireTime(5000000, 5000000, 1).reached === true);

// ---- 10. 階級與里程碑 ----
t('階級邊界：9.99 萬木筏、10 萬快艇、100 萬巡洋艦、500 萬太空梭、1000 萬母艦、5000 萬死星', [[0, 0], [99999, 0], [100000, 1], [999999, 1], [1000000, 2], [5000000, 3], [10000000, 4], [49999999, 4], [50000000, 5], [1e12, 5]].every(x => C.computeFleet(x[0]).idx === x[1]));
let Fl = C.computeFleet(550000);
t('階級進度：55 萬在 10 萬～100 萬之間 → (55−10)/90 = 50%，距下一階 45 萬', Fl.idx === 1 && near(Fl.pct, 50) && Fl.shortfall === 450000 && Fl.next.name === '重型巡洋艦' && Fl.lvl.name === '武裝快艇');
t('階級：最高階沒有下一階，進度 100%', (f => f.next === null && f.pct === 100 && f.shortfall === 0)(C.computeFleet(60000000)));
t('階級：負淨資產歸在最低階，進度 0、距離 = 10 萬 + 負債', (f => f.idx === 0 && f.pct === 0 && f.shortfall === 100005)(C.computeFleet(-5)));
t('階級：進度在 0～100 之內（掃 0～6000 萬）', (() => { for (let v = -100; v < 60000000; v += 99991) { const f = C.computeFleet(v); if (!(f.pct >= 0 && f.pct <= 100)) return false; } return true; })());
t('里程碑：每個邊界', [[0, 100000], [99999, 100000], [100000, 500000], [499999, 500000], [500000, 1000000], [999999, 1000000], [1000000, 3000000], [2999999, 3000000], [3000000, 5000000], [4999999, 5000000],
  [5000000, 10000000], [9999999, 10000000], [10000000, 50000000], [1e9, 50000000], [-1, 100000]].every(x => C.nextMilestoneOf(x[0]) === x[1]));

// ---- 11. 成就與任務 ----
const Q0 = { netWorth: 0, runwayMonths: 0, debtRatio: 0, ratioRaw: 0, targetRatio: 100, historyCount: 0, holdingsCount: 0 };
const mk = o => Object.assign({}, Q0, o);
let Q = C.computeQuests({}, Q0);
t('成就：什麼都沒有 → 沒解鎖；沒有持股就不算「絕對精準」（誤差 100）', Q.newUnlocks.length === 0 && Object.keys(Q.achievements).length === 0);
const ach0 = { first_blood: false, nw_1m: false };
const ach0Snap = JSON.stringify(ach0);
Q = C.computeQuests(ach0, mk({ netWorth: 6000000, runwayMonths: 7, debtRatio: 20, ratioRaw: 100.5, holdingsCount: 2, historyCount: 1 }));
t('成就：一次全解鎖，順序固定', Q.newUnlocks.length === 6 && Q.newUnlocks[0].includes('啟航者') && Q.newUnlocks[1].includes('百萬將鋒') && Q.newUnlocks[2].includes('半息巡航') && Q.newUnlocks[3].includes('防禦大師') && Q.newUnlocks[4].includes('無重力') && Q.newUnlocks[5].includes('絕對精準'), Q.newUnlocks);
t('成就：不改動傳入的紀錄、回傳新的一份', JSON.stringify(ach0) === ach0Snap && Q.achievements !== ach0 && ['first_blood', 'nw_1m', 'nw_5m', 'runway_6m', 'debt_light', 'perfect_exp'].every(k => Q.achievements[k] === true));
const allAch = { first_blood: true, nw_1m: true, nw_5m: true, runway_6m: true, debt_light: true, perfect_exp: true };
t('成就：已經解鎖過的不會再通知', C.computeQuests(allAch, mk({ netWorth: 6000000, runwayMonths: 7, debtRatio: 20, ratioRaw: 100, holdingsCount: 2, historyCount: 1 })).newUnlocks.length === 0);
t('成就：已解鎖的不會被收回（條件不再成立也保留）', C.computeQuests(allAch, Q0).achievements.nw_5m === true && C.computeQuests(allAch, Q0).newUnlocks.length === 0);
t('成就：傳 undefined/null 紀錄也能用', C.computeQuests(undefined, mk({ historyCount: 3 })).achievements.first_blood === true && C.computeQuests(null, Q0).newUnlocks.length === 0);
t('成就邊界：淨資產 100 萬（含）解鎖、99.9 萬不；500 萬（含）解鎖', C.computeQuests({}, mk({ netWorth: 1000000 })).achievements.nw_1m === true && !C.computeQuests({}, mk({ netWorth: 999999 })).achievements.nw_1m && C.computeQuests({}, mk({ netWorth: 5000000 })).achievements.nw_5m === true && !C.computeQuests({}, mk({ netWorth: 4999999 })).achievements.nw_5m);
t('成就邊界：續航 6 個月（含）解鎖、5.99 不', C.computeQuests({}, mk({ runwayMonths: 6 })).achievements.runway_6m === true && !C.computeQuests({}, mk({ runwayMonths: 5.99 })).achievements.runway_6m);
t('成就邊界：負債比 < 30 且 > 0 才解鎖（0、30 都不）', C.computeQuests({}, mk({ debtRatio: 29.99 })).achievements.debt_light === true && !C.computeQuests({}, mk({ debtRatio: 30 })).achievements.debt_light && !C.computeQuests({}, mk({ debtRatio: 0 })).achievements.debt_light);
t('成就邊界：曝險誤差 0.99 解鎖、1.0 不；沒持股或淨資產 ≤ 0 不算', (() => {
  const base = { netWorth: 1000, ratioRaw: 100.99, holdingsCount: 1 };
  return C.computeQuests({}, mk(base)).achievements.perfect_exp === true && !C.computeQuests({}, mk(Object.assign({}, base, { ratioRaw: 101 }))).achievements.perfect_exp
    && !C.computeQuests({}, mk(Object.assign({}, base, { holdingsCount: 0 }))).achievements.perfect_exp && !C.computeQuests({}, mk(Object.assign({}, base, { netWorth: 0 }))).achievements.perfect_exp
    && C.computeQuests({}, mk(Object.assign({}, base, { ratioRaw: 99.01 }))).achievements.perfect_exp === true; })());
t('成就：首筆快照要有至少 1 筆歷史', C.computeQuests({}, mk({ historyCount: 1 })).achievements.first_blood === true && !C.computeQuests({}, mk({ historyCount: 0 })).achievements.first_blood);
Q = C.computeQuests({}, mk({ netWorth: 2500000, runwayMonths: 3, debtRatio: 50, ratioRaw: 104, holdingsCount: 1 }));
t('主線：250 萬 → 目標 300 萬，進度 83.3%', Q.nextMilestone === 3000000 && near(Q.mainPct, 2500000 / 3000000 * 100));
t('支線 1：續航 3 個月 → 50%、未完成；支線 2：負債比 50 → (100−50)/70 = 71.43%；支線 3：誤差 4 → 80%', !Q.q1.done && near(Q.q1.pct, 50) && !Q.q2.done && near(Q.q2.pct, 50 / 70 * 100) && !Q.q3.done && near(Q.q3.pct, 80) && near(Q.expDiff, 4), Q);
t('支線 2：負債比 ≥ 100 或 ≤ 0 → 0%；完成時 100%', C.computeQuests({}, mk({ debtRatio: 100 })).q2.pct === 0 && C.computeQuests({}, mk({ debtRatio: 150 })).q2.pct === 0 && C.computeQuests({}, mk({ debtRatio: 0 })).q2.pct === 0 && C.computeQuests({}, mk({ debtRatio: -3 })).q2.pct === 0
  && C.computeQuests({}, mk({ debtRatio: 10 })).q2.pct === 100 && C.computeQuests({}, mk({ debtRatio: 10 })).q2.done === true);
t('支線 1：續航滿 6 個月 → 100% 完成；超過也只到 100%', (q => q.q1.done && q.q1.pct === 100)(C.computeQuests({}, mk({ runwayMonths: 6 }))) && C.computeQuests({}, mk({ runwayMonths: 999 })).q1.pct === 100);
t('支線 3：沒有持股 → 0%；誤差 ≥ 20 → 0%；完成時 100%', C.computeQuests({}, mk({ netWorth: 10, ratioRaw: 100, holdingsCount: 0 })).q3.pct === 0 && C.computeQuests({}, mk({ netWorth: 10, ratioRaw: 130, holdingsCount: 1 })).q3.pct === 0
  && (q => q.q3.done && q.q3.pct === 100)(C.computeQuests({}, mk({ netWorth: 10, ratioRaw: 100.5, holdingsCount: 1 }))));
t('主線進度在 0～100 之間（負淨資產 → 0）', C.computeQuests({}, mk({ netWorth: -50 })).mainPct === 0 && C.computeQuests({}, mk({ netWorth: 1e12 })).mainPct === 100);

// ---- 12. 曝險狀態與量表 ----
t('曝險狀態：淨資產 ≤ 0 → enabled=false', C.computeExposureStatus(0, 0, 100, 5).enabled === false && C.computeExposureStatus(-1, 0, 100, 5).enabled === false);
t('曝險狀態：容忍 ±5，偏離 5 → 超出（1）、4 → 接近（3）、3.99 → 區內（5）', (() => {
  const s = d => C.computeExposureStatus(1, 100 + d, 100, 5);
  return s(5).defcon === 1 && s(5).level === 'alert' && s(5).label === '超出容忍區' && s(-5).defcon === 1 && s(4).defcon === 3 && s(4).level === 'watch' && s(-4).defcon === 3 && s(4).label === '接近容忍邊界'
    && s(3.99).defcon === 5 && s(3.99).level === 'safe' && s(0).label === '在容忍區內' && s(-3.99).defcon === 5; })());
t('曝險狀態：回傳偏離量（有正負號）與絕對值', (s => s.deviation === -7 && s.dev === 7)(C.computeExposureStatus(1, 93, 100, 5)));
let G = C.computeGaugeModel(100, 100, 5);
t('量表：100%／目標 100±5 → 軌道 0～150；容忍帶 63.3%～70%；圓點與目標線同位置', G.scaleMax === 150 && near(G.bandLeft, 95 / 150 * 100) && near(G.bandWidth, 10 / 150 * 100) && near(G.targetPos, 100 / 150 * 100) && near(G.markerPos, 100 / 150 * 100), G);
t('量表：曝險 200% → 軌道放大到 225，圓點在 88.9%', (g => g.scaleMax === 225 && near(g.markerPos, 200 / 225 * 100))(C.computeGaugeModel(200, 100, 5)));
t('量表：目標 200±20 → 軌道 ceil(242/25)×25 = 250', C.computeGaugeModel(10, 200, 20).scaleMax === 250);
t('量表：軌道永遠 ≥ 150，且是 25 的倍數', (() => { for (const c of [0, 1, 99, 150, 151, 333, 1000]) for (const tg of [0, 50, 100, 300]) { const g = C.computeGaugeModel(c, tg, 5); if (g.scaleMax < 150 || g.scaleMax % 25 !== 0) return false; } return true; })());
t('量表：位置夾在 0～100（負的曝險、超大的容忍）', (g => g.markerPos === 0 && g.bandLeft === 0 && g.targetPos >= 0 && g.targetPos <= 100)(C.computeGaugeModel(-10, 5, 50)));
t('量表：位置上限夾 100（容忍為負這種不正常的輸入也不會畫出軌道外）', C.computeGaugeModel(10, 200, -100).targetPos === 100);
t('量表：目標文字位置夾在 14～86', C.computeGaugeModel(10, 0, 5).targetLabelLeft === 14 && C.computeGaugeModel(10, 1000, 5).targetLabelLeft === 86 && near(C.computeGaugeModel(100, 100, 5).targetLabelLeft, 100 / 150 * 100));
t('量表文字：差不到 0.05 → 正好在目標上', C.computeGaugeModel(100.04, 100, 5).gapText === '曝險正好在目標上。' && C.computeGaugeModel(99.96, 100, 5).gapText === '曝險正好在目標上。');
t('量表文字：高 3 在容忍區內／低 7 超出 2', C.computeGaugeModel(103, 100, 5).gapText === '比目標高 3.0 個百分點，仍在 ±5% 容忍區內。' && C.computeGaugeModel(93, 100, 5).gapText === '比目標低 7.0 個百分點，超出容忍區 2.0 個百分點。');
t('量表文字：剛好等於容忍（偏離 5、容忍 5）算超出 0.0', C.computeGaugeModel(105, 100, 5).gapText === '比目標高 5.0 個百分點，超出容忍區 0.0 個百分點。');

// ---- 13. 再平衡 ----
t('再平衡：總資產 0 → null', C.computeRebalance(0, 0, 50) === null);
let R = C.computeRebalance(400000, 900000, 70);
t('再平衡：130 萬、目標投資 70% = 91 萬，現有 90 萬 → 買 1 萬（差距 < 1% 視為平衡）', R.totalPool === 1300000 && near(R.gap, 10000) && R.balanced === true, R);
R = C.computeRebalance(100000, 900000, 30);
t('再平衡：100 萬、目標 30% = 30 萬，現有 90 萬 → 賣 60 萬', near(R.gap, -600000) && R.balanced === false);
t('再平衡：差距 5,000（總資產 99 萬的 0.5%）→ 平衡；差距 9,999 → 平衡；差距恰為總資產 1%（10,000）→ 不算平衡（要「小於」）',
  C.computeRebalance(500000, 490000, 50).balanced === true && C.computeRebalance(509999, 490001, 50).balanced === true && C.computeRebalance(510000, 490000, 50).balanced === false && near(C.computeRebalance(510000, 490000, 50).gap, 10000));
t('再平衡：差距 5 萬、10 萬 → 不平衡', C.computeRebalance(500000, 400000, 50).balanced === false && C.computeRebalance(600000, 400000, 50).balanced === false);
t('再平衡：目標 100% 全買、0% 全賣', near(C.computeRebalance(100, 0, 100).gap, 100) && near(C.computeRebalance(0, 100, 0).gap, -100));

// ---- 14. 圓餅圖歸戶 ----
const H = C.groupHoldings([
  { code: '2330', shares: 1000, price: 900, mult: 1 }, { code: ' 2330 ', shares: 500, price: 900, mult: 1 }, { code: '', shares: 100, price: 50, mult: 2 }, { code: '00631l', shares: 100, price: 200, mult: 1.5 },
  { code: 'X', shares: 0, price: 100, mult: 0 }, { code: '00679B', shares: 1000, price: 30, mult: 0 }, { code: 'Y', shares: 10, price: 10 }, { code: 'Z', shares: 10, price: 10, mult: 1.2 }, { code: 'N', shares: 10, price: 10, mult: 'abc' }],
  [{ name: '  海外  ', value: 1000 }, { name: '海外', value: 500 }, { name: '', value: 300 }, { name: '零', value: 0 }, { name: 'neg', value: -5 }]);
t('歸戶：代號去空白、轉大寫並合併（2330 = 135 萬）；空代號 → 未命名台股；市值 0 不列', J(H.groupedStocks)['2330'] === 1350000 && J(H.groupedStocks)['未命名台股'] === 5000 && J(H.groupedStocks)['00631L'] === 20000 && !('X' in H.groupedStocks), H.groupedStocks);
t('歸戶：槓桿三桶 — 1 倍（含沒寫倍數）、1.5 倍以上、其餘（0 倍、1.2 倍、非數字）', (l => l[0] === 1350000 + 100 && l[1] === 5000 + 20000 && l[2] === 30000 + 100 + 100)(J(H.leverageValues)), H.leverageValues);
t('歸戶：基金依名稱（去空白）合併；空名稱 → 未命名資產；0 與負值不列', J(H.groupedFunds)['海外'] === 1500 && J(H.groupedFunds)['未命名資產'] === 300 && !('零' in H.groupedFunds) && !('neg' in H.groupedFunds));
t('歸戶：空清單與 undefined 不爆', (h => h.leverageValues.length === 3 && Object.keys(h.groupedStocks).length === 0)(C.groupHoldings(undefined, null)));
t('歸戶：不改動傳入的資料', (() => { const s = [{ code: ' a ', shares: 1, price: 1 }]; const before = JSON.stringify(s); C.groupHoldings(s, []); return JSON.stringify(s) === before; })());

// ---- 15. 輸入框文字轉數字 ----
t('凱利輸入：空白／非數字／0 → 預設（報酬 8%、波動 18%、借款利率 2.5%）', (k => near(k.mu, 0.08) && near(k.sigma, 0.18) && near(k.r, 0.025))(C.parseKellyInputs({ mu: '', sigma: 'abc', rate: '' })) && (k => near(k.mu, 0.08) && near(k.sigma, 0.18))(C.parseKellyInputs({ mu: '0', sigma: '0', rate: '0' })));
t('凱利輸入：有填就照填（12.5 → 0.125；負數照用）', (k => near(k.mu, 0.125) && near(k.sigma, 0.2) && near(k.r, 0.015))(C.parseKellyInputs({ mu: '12.5', sigma: '20', rate: '1.5' })) && near(C.parseKellyInputs({ mu: '-3', sigma: '18', rate: '2' }).mu, -0.03));
t('蒙地卡羅輸入：預設年數 10、每月投入 0、其餘同上', (k => k.years === 10 && k.pmt === 0 && near(k.mu, 0.08) && near(k.sigma, 0.18) && near(k.borrowRate, 0.025))(C.parseMcInputs({ years: '', mu: '', sigma: '', pmt: '', rate: '' })));
t('蒙地卡羅輸入：有填就照填', (k => k.years === 20 && k.pmt === 50000 && near(k.mu, 0.12) && near(k.sigma, 0.25) && near(k.borrowRate, 0.04))(C.parseMcInputs({ years: '20', mu: '12', sigma: '25', pmt: '50000', rate: '4' })));

// ---- 16. 凱利 ----
let K = C.computeKelly(0.08, 0.18, 0.025);
t('凱利：f* = (8% − 2.5%) ÷ 18%² = 169.75%，半凱利 84.88%', near(K.fullPct, 0.055 / 0.0324 * 100, 1e-9) && near(K.halfPct, K.fullPct / 2, 1e-12), K.fullPct);
t('凱利曲線：0%～300% 每 10% 一點，共 31 點，標籤對得上', K.labels.length === 31 && K.data.length === 31 && K.labels[0] === '0%' && K.labels[30] === '300%' && K.labels[17] === '170%');
t('凱利曲線：0% 槓桿 = 無風險利率 2.5%；100% = μ − σ²/2 = 6.38%', near(K.data[0], 2.5, 1e-12) && near(K.data[10], (0.08 - 0.5 * 0.0324) * 100, 1e-9));
t('凱利曲線：高點落在最接近 f* 的格子（170%）', K.data.indexOf(Math.max.apply(null, K.data)) === 17);
t('凱利：報酬低於借款利率 → 0%（不建議加槓桿）', (k => k.fullPct === 0 && k.halfPct === 0)(C.computeKelly(0.02, 0.18, 0.03)));

// ---- 17. 亂數與蒙地卡羅 ----
t('常態亂數：u=v=0.5 → −√(2 ln 2) ≈ −1.17741', near(C.randnBm(() => 0.5), -Math.sqrt(2 * Math.log(2)), 1e-12));
(function() {
  const seq = [0, 0, 0.25, 0, 0.75]; let i = 0; const x = C.randnBm(() => seq[i++]);
  t('常態亂數：遇到 0 會重抽（不會 log(0)）— 共抽 5 次、結果有限', i === 5 && isFinite(x), [i, x]);
})();
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; }; }
(function() {
  const rng = lcg(1); let sum = 0, sq = 0; const N = 100000;
  for (let i = 0; i < N; i++) { const z = C.randnBm(rng); sum += z; sq += z * z; }
  t('常態亂數：10 萬筆平均 ≈ 0、變異數 ≈ 1', Math.abs(sum / N) < 0.02 && Math.abs(sq / N - 1) < 0.02, [sum / N, sq / N]);
})();
const MCB = { currentNW: 1000000, targetNW: 1500000, leverage: 1, years: 1, mu: 0.12, sigma: 0, pmt: 0, borrowRate: 0.025 };
let M = C.simulateMonteCarlo(MCB, () => 0.5);
t('蒙地卡羅：波動 0、年報酬 12%、1 年 → 每條路徑都是 100 萬×e^0.12', M.finalWealths.every(w => near(w, 1000000 * Math.exp(0.12), 1e-4)) && near(M.median, 1000000 * Math.exp(0.12), 1e-4), M.median);
t('蒙地卡羅：目標 150 萬 > 112.7 萬 → 成功率 0%、重挫 0%；跑 1,000 次、留 35 條路徑、每條 13 個點（含起點）', M.successPct === 0 && M.ruinPct === 0 && M.runs === 1000 && M.paths.length === 35 && M.paths.every(p => p.length === 13 && p[0] === 1000000) && M.months === 12);
M = C.simulateMonteCarlo(Object.assign({}, MCB, { targetNW: 1100000 }), () => 0.5);
t('蒙地卡羅：目標 110 萬 < 112.7 萬 → 成功率 100%', M.successPct === 100 && M.successCount === 1000);
M = C.simulateMonteCarlo(Object.assign({}, MCB, { years: 2, leverage: 2, mu: 0.1, borrowRate: 0.03, targetNW: 1 }), () => 0.5);
t('蒙地卡羅：2 倍槓桿要扣借款成本 μL = 2×10% − 1×3% = 17%（每年）', near(M.median, 1000000 * Math.exp(0.17 * 2), 1e-3), M.median);
M = C.simulateMonteCarlo(Object.assign({}, MCB, { years: 2, leverage: 0.5, mu: 0.1, targetNW: 1 }), () => 0.5);
t('蒙地卡羅：槓桿 < 1 不用借款：μL = 0.5 × 10% = 5%', near(M.median, 1000000 * Math.exp(0.05 * 2), 1e-3));
M = C.simulateMonteCarlo(Object.assign({}, MCB, { mu: 0, pmt: 10000, targetNW: 1 }), () => 0.5);
t('蒙地卡羅：每月投入 1 萬、報酬 0 → 12 個月後 100 萬 + 12 萬', near(M.median, 1120000, 1e-6));
M = C.simulateMonteCarlo(Object.assign({}, MCB, { mu: -5, years: 2 }), () => 0.5);
t('蒙地卡羅：每月 −41.7% → 第 4 個月跌破起始 20% 就算重挫；之後以 0 補滿路徑、不算成功', M.ruinPct === 100 && M.ruinCount === 1000 && M.successCount === 0 && M.median === 0 && M.finalWealths.every(w => w === 0) &&
  M.paths.every(p => p.length === 25 && p.slice(0, 4).every(v => v > 200000) && p[4] === 0 && p.slice(4).every(v => v === 0)), M.paths[0]);
(function() {   // 重挫判定恰在「≤ 起始 20%」：用 μ=0、波動 0、每月 −80 萬讓第一個月剛好剩 20 萬（只跑 1 個月）
  const base = { currentNW: 1000000, targetNW: 1, leverage: 1, years: 1 / 12, mu: 0, sigma: 0, borrowRate: 0 };
  const hit = C.simulateMonteCarlo(Object.assign({}, base, { pmt: -800000 }), () => 0.5);
  const miss = C.simulateMonteCarlo(Object.assign({}, base, { pmt: -799999 }), () => 0.5);
  t('蒙地卡羅：只跑 1 個月（months = 1）', hit.months === 1 && miss.months === 1);
  t('蒙地卡羅：剛好剩 20%（20 萬）算重挫、多 1 塊（200,001）就不算', hit.ruinPct === 100 && miss.ruinPct === 0 && miss.median === 200001, [hit.ruinPct, miss.ruinPct, miss.median]);
})();
M = C.simulateMonteCarlo(Object.assign({}, MCB, { mu: -5, years: 2, targetNW: 0 }), () => 0.5);
t('蒙地卡羅：重挫的路徑（終值以 0 計）即使目標是 0 也不算成功，重挫優先', M.ruinCount === 1000 && M.successCount === 0);
M = C.simulateMonteCarlo(Object.assign({}, MCB, { mu: -5, pmt: 2000000, years: 1 }), () => 0.5);
t('蒙地卡羅：每月投入夠大（資產永遠高於門檻）→ 不會重挫', M.ruinPct === 0);
M = C.simulateMonteCarlo(Object.assign({}, MCB, { sigma: 0.2 }), lcg(7)); const M2 = C.simulateMonteCarlo(Object.assign({}, MCB, { sigma: 0.2 }), lcg(7)), M3 = C.simulateMonteCarlo(Object.assign({}, MCB, { sigma: 0.2 }), lcg(8));
t('蒙地卡羅：同樣的亂數序列 → 結果逐位相同；換序列 → 結果不同', JSON.stringify(M.finalWealths) === JSON.stringify(M2.finalWealths) && JSON.stringify(M.paths) === JSON.stringify(M2.paths) && JSON.stringify(M.finalWealths) !== JSON.stringify(M3.finalWealths));
(function() {   // 亂數用量：沒有重挫時，每條路徑每月恰好抽 2 個
  let calls = 0; const rng = lcg(3); C.simulateMonteCarlo(Object.assign({}, MCB, { sigma: 0.05, runs: 50 }), () => { calls++; return rng(); });
  t('蒙地卡羅：亂數用量 = 路徑數 × 月數 × 2（Box-Muller 每次 2 個）', calls === 50 * 12 * 2, calls);
})();
t('蒙地卡羅：runs 與 keepPaths 可調；機率以實際次數為分母', (m => m.runs === 10 && m.paths.length === 3 && m.finalWealths.length === 10 && m.successPct === 100)(C.simulateMonteCarlo(Object.assign({}, MCB, { targetNW: 1, runs: 10, keepPaths: 3 }), () => 0.5)));
t('蒙地卡羅：keepPaths = 0 → 不留路徑', C.simulateMonteCarlo(Object.assign({}, MCB, { keepPaths: 0, runs: 5 }), () => 0.5).paths.length === 0);
t('蒙地卡羅：機率 = 次數 × 100 ÷ 總次數，1,000 次時與「次數 ÷ 10」逐位相同（畫面上的小數位不會變）', (() => { for (let n = 0; n <= 1000; n++) if (n * 100 / 1000 !== n / 10) return false; return true; })());
(function() {   // 中位數取排序後第 runs/2 個；結果已排序
  const m = C.simulateMonteCarlo(Object.assign({}, MCB, { sigma: 0.2, runs: 1001 }), lcg(11));
  const sorted = m.finalWealths.every((v, i, arr) => i === 0 || arr[i - 1] <= v);
  t('蒙地卡羅：finalWealths 由小到大；中位數 = 第 floor(runs/2) 個', sorted && m.median === m.finalWealths[500]);
})();
(function() {   // 統計檢查：對數常態的期望值 E[W] = W0·e^(μT)；2 萬條路徑，誤差應在 1% 內
  const m = C.simulateMonteCarlo({ currentNW: 1000000, targetNW: 1, leverage: 1, years: 1, mu: 0.08, sigma: 0.2, pmt: 0, borrowRate: 0, runs: 20000, keepPaths: 0 }, lcg(2024));
  const mean = m.finalWealths.reduce((s, v) => s + v, 0) / m.runs, expect = 1000000 * Math.exp(0.08);
  t('蒙地卡羅：平均終值 ≈ W0·e^(μT)（對數常態期望值）', Math.abs(mean / expect - 1) < 0.01, [mean, expect]);
  const med = m.median, medExpect = 1000000 * Math.exp(0.08 - 0.5 * 0.04);
  t('蒙地卡羅：中位數 ≈ W0·e^(μ−σ²/2)T', Math.abs(med / medExpect - 1) < 0.01, [med, medExpect]);
})();
t('蒙地卡羅：不改動傳入的參數', (() => { const p = Object.assign({}, MCB); const s = JSON.stringify(p); C.simulateMonteCarlo(p, () => 0.5); return JSON.stringify(p) === s; })());


// ---- 18. 信貸還款進度（已還幾期 → 剩餘本金、月付額）----
t('每月天數：大小月、平年閏年（1900 平年、2000 閏年、2024 閏年）', C.daysInMonth(2025, 2) === 28 && C.daysInMonth(2024, 2) === 29 && C.daysInMonth(1900, 2) === 28 && C.daysInMonth(2000, 2) === 29 && C.daysInMonth(2026, 4) === 30 && C.daysInMonth(2026, 1) === 31 && C.daysInMonth(2026, 12) === 31);
t('每月天數：十二個月逐月核對（平年 31/28/31/30/31/30/31/31/30/31/30/31）', [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].every((n, k) => C.daysInMonth(2026, k + 1) === n));
t('日期解析：30 天的月份沒有 31 號、31 天的月份有（4／6／9／11 月 31 日不存在）', [4, 6, 9, 11].every(m => C.parseYmd('2026-' + String(m).padStart(2, '0') + '-31') === null) && [1, 3, 5, 7, 8, 10, 12].every(m => C.parseYmd('2026-' + String(m).padStart(2, '0') + '-31') !== null));
t('信貸總期數：年數 × 12 四捨五入（2.5 年 = 30 期、0.55 年 = 6.6 → 7 期）', C.creditLoanStatus({ principal: 1000, rate: 3, term: 2.5 }, 'x').total === 30 && C.creditLoanStatus({ principal: 1000, rate: 3, term: 0.55 }, 'x').total === 7);
t('日期解析：合法的 YYYY-MM-DD', (d => d.y === 2026 && d.m === 11 && d.d === 9)(C.parseYmd('2026-11-09')) && C.parseYmd(' 2024-02-29 ') !== null);
t('日期解析：不存在的日子、格式錯誤、空值都回 null', ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-1-5', '26-11-09', 'abc', '', undefined, null, '2026/11/09'].every(v => C.parseYmd(v) === null));
t('依日期算已還期數：1/31 起、11/10 → 1/31、2/28、…、10/31 共 10 期（沒有 31 號的月份算月底）', C.countPaidByDate('2026-01-31', '2026-11-10', 84) === 10);
t('依日期算已還期數：繳款日當天算已繳、前一天不算', C.countPaidByDate('2026-11-10', '2026-11-10', 84) === 1 && C.countPaidByDate('2026-11-11', '2026-11-10', 84) === 0);
t('依日期算已還期數：閏年 2/29 當天才算第 2 期（1/31 起）', C.countPaidByDate('2024-01-31', '2024-02-29', 60) === 2 && C.countPaidByDate('2024-01-31', '2024-02-28', 60) === 1);
t('依日期算已還期數：跨年（2025-11-15 起：2026-02-14 → 3 期、2026-02-15 → 4 期）', C.countPaidByDate('2025-11-15', '2026-02-14', 60) === 3 && C.countPaidByDate('2025-11-15', '2026-02-15', 60) === 4);
t('依日期算已還期數：最多到總期數；日期錯誤或期數 0 → 0', C.countPaidByDate('2020-01-05', '2026-11-10', 12) === 12 && C.countPaidByDate('abc', '2026-11-10', 12) === 0 && C.countPaidByDate('2026-01-05', '', 12) === 0 && C.countPaidByDate('2026-01-05', '2026-11-10', 0) === 0);

const LOAN = { principal: 1000000, rate: 3, term: 7 };
let L0 = C.creditLoanStatus(LOAN, '2026-11-10');
t('信貸（舊資料、沒填進度）：本金當成現在還欠的、月付額照原算法、沒有已還期數', L0.balance === 1000000 && L0.pmt === C.calculatePMT(1000000, 3, 7) && L0.paid === 0 && L0.total === 84 && L0.remaining === 84 && L0.tracked === false && L0.done === false);
let L24 = C.creditLoanStatus(Object.assign({ paid: 24 }, LOAN), '2026-11-10');
(function() {   // 獨立的逐月模擬：每月本金 × (1 + 月利率) − 月付額
  const i = 0.03 / 12, pmt = C.calculatePMT(1000000, 3, 7); let bal = 1000000;
  for (let k = 0; k < 24; k++) bal = bal * (1 + i) - pmt;
  t('信貸已還 24 期：剩餘本金 = 逐月模擬（約 735,351）', near(L24.balance, bal, 1e-6) && Math.round(L24.balance) === 735351, [L24.balance, bal]);
  t('信貸已還 24 期：月付額不變、剩 60 期、有填進度', L24.pmt === L0.pmt && L24.remaining === 60 && L24.paid === 24 && L24.tracked === true && L24.done === false);
  const L83 = C.creditLoanStatus(Object.assign({ paid: 83 }, LOAN), 'x');
  t('信貸只剩最後 1 期：剩餘本金 = 月付額 ÷ (1 + 月利率)（最後一期的現值）', near(L83.balance, pmt / (1 + i), 1e-6), [L83.balance, pmt / (1 + i)]);
  let b = 1000000; const seq = []; for (let k = 1; k <= 84; k++) { b = b * (1 + i) - pmt; seq.push(b); }
  t('信貸 84 期逐月模擬：期末餘額 ≈ 0（月付額與剩餘本金公式一致）', Math.abs(seq[83]) < 1e-6 && seq.slice(0, 83).every((v, idx) => v > 0 && (idx === 0 || v < seq[idx - 1])));
  t('信貸：每一期的剩餘本金都和逐月模擬相同（1～83 期）', (() => { for (let k = 1; k <= 83; k++) { const x = C.creditLoanStatus(Object.assign({ paid: k }, LOAN), 'x').balance; if (!near(x, seq[k - 1], 1e-5)) return false; } return true; })());
})();
let LD = C.creditLoanStatus(Object.assign({ paid: 84 }, LOAN), 'x');
t('信貸全部還完：剩餘 0、月付 0、done', LD.balance === 0 && LD.pmt === 0 && LD.done === true && LD.remaining === 0);
t('信貸已還期數超過總期數 → 當作還完（不會變負）', (l => l.balance === 0 && l.paid === 84 && l.done)(C.creditLoanStatus(Object.assign({ paid: 200 }, LOAN), 'x')));
t('信貸 0% 利率：本金 84 萬、7 年、已還 24 期 → 剩 60 萬（按期數平均）', (l => l.pmt === 10000 && l.balance === 600000)(C.creditLoanStatus({ principal: 840000, rate: 0, term: 7, paid: 24 }, 'x')));
t('已還期數的輸入：小數無條件捨去、負數與文字當 0、字串數字可用', C.creditLoanStatus(Object.assign({ paid: 24.9 }, LOAN), 'x').paid === 24 && C.creditLoanStatus(Object.assign({ paid: -5 }, LOAN), 'x').paid === 0 && C.creditLoanStatus(Object.assign({ paid: 'abc' }, LOAN), 'x').paid === 0 && C.creditLoanStatus(Object.assign({ paid: '24' }, LOAN), 'x').paid === 24);
let LA = C.creditLoanStatus(Object.assign({ progress: 'auto', firstPay: '2026-01-31' }, LOAN), '2026-11-10');
t('依繳款日自動計算：1/31 起、今天 11/10 → 已還 10 期，與手動填 10 期的結果完全相同', LA.paid === 10 && LA.balance === C.creditLoanStatus(Object.assign({ paid: 10 }, LOAN), 'x').balance && LA.tracked === true);
t('依繳款日自動計算：隨日期往後，已還期數與剩餘本金跟著變（剩餘本金遞減）', (() => { let prev = Infinity; for (const d of ['2026-01-30', '2026-01-31', '2026-02-28', '2026-06-30', '2027-01-31']) { const x = C.creditLoanStatus(Object.assign({ progress: 'auto', firstPay: '2026-01-31' }, LOAN), d); if (!(x.balance <= prev)) return false; prev = x.balance; } return true; })());
t('依繳款日自動計算：第一期還沒到 → 已還 0、剩餘本金 = 貸款金額（但算有填進度）', (l => l.paid === 0 && l.balance === 1000000 && l.tracked === true)(C.creditLoanStatus(Object.assign({ progress: 'auto', firstPay: '2026-12-01' }, LOAN), '2026-11-10')));
t('依繳款日自動計算：沒填日期／日期錯誤 → 已還 0；「自動」模式不看手動期數', (l => l.paid === 0 && l.balance === 1000000)(C.creditLoanStatus(Object.assign({ progress: 'auto', paid: 30 }, LOAN), '2026-11-10')) && C.creditLoanStatus(Object.assign({ progress: 'auto', firstPay: 'abc', paid: 30 }, LOAN), '2026-11-10').paid === 0);
t('手動模式不看繳款日', C.creditLoanStatus(Object.assign({ progress: 'manual', paid: 5, firstPay: '2020-01-01' }, LOAN), '2026-11-10').paid === 5 && C.creditLoanStatus(Object.assign({ paid: 5, firstPay: '2020-01-01' }, LOAN), '2026-11-10').paid === 5);
t('期數沒填（0 年）：沒辦法算進度，已還期數忽略、不產生 NaN 的剩餘本金', (l => l.total === 0 && l.paid === 0 && l.balance === 1000000)(C.creditLoanStatus({ principal: 1000000, rate: 3, term: 0, paid: 12 }, 'x')));
t('本金 0 的信貸：不算還清、全是 0', (l => l.balance === 0 && l.pmt === 0 && l.done === false)(C.creditLoanStatus({ principal: 0, rate: 3, term: 7, paid: 84 }, 'x')));
t('不改動傳入的資料', (() => { const d = Object.assign({ paid: 24, progress: 'auto', firstPay: '2026-01-31' }, LOAN), sn = JSON.stringify(d); C.creditLoanStatus(d, '2026-11-10'); return JSON.stringify(d) === sn; })());

(function() {   // 接進總覽加總：質押 200 萬 + 信貸 100 萬（已還 24 期）
  const base = { accounts: [{ balance: 500000 }], stocks: [], funds: [], usdRate: 1, livingExpense: 0, today: '2026-11-10' };
  const dPledge = { type: 'pledge', principal: 2000000, rate: 2.4 };
  const noProg = C.computePortfolio(Object.assign({}, base, { debts: [dPledge, Object.assign({ type: 'credit' }, LOAN)] }));
  const paid24 = C.computePortfolio(Object.assign({}, base, { debts: [dPledge, Object.assign({ type: 'credit', paid: 24 }, LOAN)] }));
  t('總覽：沒填進度 → 信貸 100 萬、月付額照舊（和改版前一樣）', noProg.credit === 1000000 && near(noProg.monthlyCreditPMT, C.calculatePMT(1000000, 3, 7)) && noProg.totalDebt === 3000000);
  t('總覽：已還 24 期 → 信貸改成剩餘本金，總負債與淨資產同步更新', near(paid24.credit, L24.balance, 1e-6) && near(paid24.totalDebt, 2000000 + L24.balance, 1e-6) && near(paid24.netWorth, 500000 - 2000000 - L24.balance, 1e-6) && near(paid24.netWorth - noProg.netWorth, 1000000 - L24.balance, 1e-6));
  t('總覽：已還 24 期 → 月付額不變，每月流出沒變', near(paid24.monthlyCreditPMT, noProg.monthlyCreditPMT, 1e-9) && near(paid24.monthlyOutflow, noProg.monthlyOutflow, 1e-9));
  t('總覽：平均利率改用剩餘本金加權', near(paid24.avgRate, (2000000 * 2.4 + L24.balance * 3) / (2000000 + L24.balance), 1e-9));
  const auto = C.computePortfolio(Object.assign({}, base, { debts: [Object.assign({ type: 'credit', progress: 'auto', firstPay: '2026-01-31' }, LOAN)] }));
  t('總覽：依繳款日自動計算（今天由外部傳入）→ 已還 10 期的剩餘本金', near(auto.credit, C.creditLoanStatus(Object.assign({ paid: 10 }, LOAN), 'x').balance, 1e-6));
  const noToday = C.computePortfolio(Object.assign({}, base, { today: undefined, debts: [Object.assign({ type: 'credit', progress: 'auto', firstPay: '2026-01-31' }, LOAN)] }));
  t('總覽：沒傳今天的日期 → 自動模式當作還沒開始還（不丟錯）', noToday.credit === 1000000);
  const done = C.computePortfolio(Object.assign({}, base, { debts: [dPledge, Object.assign({ type: 'credit', paid: 84 }, LOAN)] }));
  t('總覽：信貸還完 → 不再計入負債與每月流出', done.credit === 0 && done.monthlyCreditPMT === 0 && done.totalDebt === 2000000 && near(done.monthlyOutflow, 4000, 1e-9));
  const mixed = C.computePortfolio(Object.assign({}, base, { debts: [Object.assign({ type: 'credit', paid: 24 }, LOAN), Object.assign({ type: 'credit' }, { principal: 300000, rate: 5, term: 3 })] }));
  t('總覽：多筆信貸各算各的（一筆有進度、一筆沒有）', near(mixed.credit, L24.balance + 300000, 1e-6) && near(mixed.monthlyCreditPMT, L24.pmt + C.calculatePMT(300000, 5, 3), 1e-9));
  t('質押不受影響：質押沒有還款進度的概念', (p => p.pledge === 2000000 && near(p.monthlyPledgeInterest, 4000, 1e-9))(C.computePortfolio(Object.assign({}, base, { debts: [Object.assign({ type: 'pledge', principal: 2000000, rate: 2.4, paid: 30, progress: 'auto', firstPay: '2020-01-01' })] }))));
})();

console.log(`core_test: ${pass} 通過, ${fail} 失敗`);
process.exit(fail ? 1 : 0);
