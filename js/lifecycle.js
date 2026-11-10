/* js/lifecycle.js — 年齡與退休年限導航（含純函式區塊）、阻尼與再平衡設定。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== 年齡與退休年限導航 =====
       想法（生命週期投資）：年輕、資產還少時，「未來要存進來的錢」占全部資源的比例高，可以承擔較高曝險；
       越接近退休、或資產已經很多，這個比例就越低，曝險應該往下。
       share ＝ 未來儲蓄折現值 ÷（未來儲蓄折現值 ＋ 現有淨資產）；建議曝險 ＝ 最低 ＋（最高 − 最低）× share。
       區間由「未來只存得到所填金額的 50%／75%／100%」三種情境得出。下面是純函式（LIFECYCLE-BEGIN/END 之間），不碰 DOM。 */
    /* LIFECYCLE-BEGIN */
    var LIFE_RATE = 0.03;                                    /* 折現率：以今天的幣值、不假設加薪 */
    var LIFE_SCENARIOS = { low: 0.5, mid: 0.75, high: 1 };   /* 未來實際存得到「所填金額」的幾成 */
    var LIFE_STEP = 5;                                       /* 建議值四捨五入到 5%，與目標曝險滑桿的刻度一致 */
    function lifeRound(v, lo, hi) { return Math.min(hi, Math.max(lo, Math.round(v / LIFE_STEP) * LIFE_STEP)); }
    function lifeHumanCapital(annualSavings, years, rate) {
        annualSavings = Number(annualSavings) || 0; years = Number(years) || 0; rate = rate > 0 ? rate : LIFE_RATE;
        if (!(annualSavings > 0) || !(years > 0)) return 0;
        return annualSavings * (1 - Math.pow(1 + rate, -years)) / rate;
    }
    function lifeShare(humanCapital, netWorth) {
        var nw = Math.max(0, Number(netWorth) || 0), total = humanCapital + nw;
        return total > 0 ? humanCapital / total : 0;
    }
    function computeLifecycleGlide(inp) {
        inp = inp || {};
        var age = Number(inp.age) || 0, retire = Number(inp.retireAge) || 0;
        var savings = Math.max(0, Number(inp.monthlySavings) || 0), nw = Number(inp.netWorth) || 0;
        var gMax = Number(inp.glideMax), gMin = Number(inp.glideMin);
        if (!isFinite(gMax)) gMax = 200; if (!isFinite(gMin)) gMin = 100;
        var lo = Math.min(gMin, gMax), hi = Math.max(gMin, gMax);
        var r = { mode: 'incomplete', reason: '', age: age, retireAge: retire, years: 0, savings: savings, humanCapital: 0, share: 0, low: lo, mid: lo, high: lo, lo: lo, hi: hi };
        if (!(age > 0)) { r.reason = 'noAge'; return r; }
        if (age < 18 || age > 100) { r.reason = 'badAge'; return r; }
        if (!(retire > 0)) { r.reason = 'noRetire'; return r; }
        if (retire > 100) { r.reason = 'badRetire'; return r; }
        r.years = retire - age;
        if (r.years <= 0) { r.mode = 'retired'; return r; }          /* 已到退休年齡：不再有未來儲蓄，採最低曝險 */
        r.mode = 'ok';
        ['low', 'mid', 'high'].forEach(function(k) {
            var hc = lifeHumanCapital(savings * 12 * LIFE_SCENARIOS[k], r.years, LIFE_RATE), sh = lifeShare(hc, nw);
            r[k] = lifeRound(lo + (hi - lo) * sh, lo, hi);
            if (k === 'mid') { r.humanCapital = hc; r.share = sh; }
        });
        return r;
    }
    /* 自動降槓桿要採用哪個數字；年齡資料不足時一律退回原本的「淨資產進度」做法 */
    function pickGlideTarget(basis, nwTarget, life) {
        var lifeOk = !!life && (life.mode === 'ok' || life.mode === 'retired');
        if (basis === 'age') return lifeOk ? life.mid : nwTarget;
        if (basis === 'both') return lifeOk ? Math.min(nwTarget, life.mid) : nwTarget;
        return nwTarget;
    }
    function lifeVsTarget(current, life, tolerance) {
        if (!life || (life.mode !== 'ok' && life.mode !== 'retired')) return 'unknown';
        var tol = Math.max(0, Number(tolerance) || 0), cur = Number(current) || 0;
        if (cur > life.high + tol) return 'above';
        if (cur < life.low - tol) return 'below';
        return 'within';
    }
    /* LIFECYCLE-END */

    var lastLifecycle = null;
    /* 年齡只存「填寫當年的年齡＋填寫年份」，這樣明年開啟時會自動多一歲，不會停在舊年齡 */
    function lifeAgeNow() {
        if (!(state.lifeAge > 0)) return 0;
        var year = new Date().getFullYear(), base = state.lifeAgeYear > 0 ? state.lifeAgeYear : year;
        return state.lifeAge + Math.max(0, year - base);
    }
    function updateLifeAge(val) {
        var n = parseFloat(val);
        state.lifeAge = n > 0 ? n : 0; state.lifeAgeYear = state.lifeAge > 0 ? new Date().getFullYear() : 0;
        updateTotals();
    }
    function updateLifeSavings(val) {
        state.mcPmt = parseFloat(val) || 0;
        var mc = document.getElementById('mc-pmt'); if (mc) mc.value = val;
        updateTotals();
    }
    function setGlideBasis(v) { state.glideBasis = ['networth', 'age', 'both'].indexOf(v) >= 0 ? v : 'networth'; updateTotals(); }
    function setTextIfChanged(el, text) { if (el && el.textContent !== text) el.textContent = text; }
    function renderLifecycle(life, ctx) {
        var $ = function(id) { return document.getElementById(id); };
        if (!$('life-result')) return;
        var ok = life.mode === 'ok' || life.mode === 'retired', cur = Math.round(state.targetRatio || 0);
        var year = new Date().getFullYear(), elapsed = state.lifeAgeYear > 0 ? year - state.lifeAgeYear : 0;
        setTextIfChanged($('life-age-note'), (state.lifeAge > 0 && elapsed > 0) ? '你在 ' + state.lifeAgeYear + ' 年填的是 ' + state.lifeAge + ' 歲，今年自動推算為 ' + lifeAgeNow() + ' 歲。' : '');
        var msgs = { noAge: '填入目前年齡與預計退休年齡，就會算出建議曝險區間。', badAge: '年齡請填 18–100 之間的數字。',
                     noRetire: '再填預計退休年齡，就能算出建議曝險區間。', badRetire: '預計退休年齡請填 100 以內的數字。' };
        setTextIfChanged($('life-msg'), ok ? '' : (msgs[life.reason] || ''));
        $('life-main-row').hidden = !ok;
        if (ok) {
            setTextIfChanged($('life-main'), life.mid + '%');
            setTextIfChanged($('life-range'), life.low === life.high ? life.mid + '%' : life.low + '% – ' + life.high + '%');
        }
        var detail = '';
        if (life.mode === 'retired') detail = '已到預計退休年齡：之後不再有新增儲蓄，建議採最低曝險 ' + life.lo + '%。';
        else if (life.mode === 'ok') detail = life.savings > 0
            ? '距離預計退休還有 ' + life.years + ' 年；未來要存進來的錢（折現後約 $' + formatNum(life.humanCapital) + '）約占你全部資源的 ' + Math.round(life.share * 100) + '%。'
            : '每月可投入為 0：沒有未來儲蓄可以承擔波動，所以建議落在最低曝險。';
        setTextIfChanged($('life-detail'), detail);
        var rel = lifeVsTarget(cur, life, state.toleranceRatio);
        $('life-compare-row').hidden = rel === 'unknown';
        if (rel === 'within') setRiskLabel('life-compare', 'safe', '目前目標 ' + cur + '% 落在建議區間內');
        else if (rel === 'above') setRiskLabel('life-compare', 'watch', '目前目標 ' + cur + '% 高於建議區間（比上限高 ' + (cur - life.high) + ' 個百分點）');
        else if (rel === 'below') setRiskLabel('life-compare', 'info', '目前目標 ' + cur + '% 低於建議區間（比下限低 ' + (life.low - cur) + ' 個百分點，較保守）');
        var btn = $('life-apply'); btn.hidden = !ok;
        if (ok) {
            var same = cur === life.mid;
            btn.disabled = !!state.autoGlidepath || same;
            setTextIfChanged(btn, state.autoGlidepath ? '自動降槓桿開啟中（目標由自動導航決定）' : (same ? '目前目標已是建議值 ' + life.mid + '%' : '套用 ' + life.mid + '% 為目標曝險'));
        }
        var note = '';
        if (state.glideBasis !== 'networth' && !ok) note = '年齡與退休年齡還沒填完整，目前暫時改用淨資產達標進度。';
        else if (state.glideBasis === 'age') note = '目標曝險 ' + ctx.picked + '%，由年齡與退休年限決定。';
        else if (state.glideBasis === 'both') note = '淨資產進度算出 ' + ctx.nwTarget + '%、年齡算出 ' + life.mid + '%，取較低的 ' + ctx.picked + '%。';
        else note = '依淨資產達標進度（目標淨資產 $' + formatNum(state.targetNetWorth) + '）。';
        setTextIfChanged($('glide-basis-note'), note);
        var sv = $('life-savings'); if (sv && sv !== document.activeElement && sv.value !== String(state.mcPmt)) sv.value = state.mcPmt;   /* 與蒙地卡羅共用：另一邊改了這邊跟著變 */
    }
    function applyLifecycleSuggestion() {
        if (state.autoGlidepath) { showToast('自動降槓桿開啟中，目標曝險會自動更新，不需要手動套用。', 'info'); return; }
        var life = lastLifecycle; if (!life || (life.mode !== 'ok' && life.mode !== 'retired')) return;
        var before = state.targetRatio, slider = document.getElementById('input-target-ratio-slider');
        if (slider) slider.value = life.mid;
        updateTargetRatio(life.mid);
        showToast('目標曝險已從 ' + before + '% 改為 ' + life.mid + '%。\n想改回去，可在「手動設定目標曝險」調整。', 'success', { icon: '⏳' });
    }

    function toggleGlidepath(isChecked, update = true) {
        state.autoGlidepath = isChecked; var p = document.getElementById('glidepath-settings'); if(p) p.style.display = isChecked ? 'block' : 'none';
        var gcb = document.getElementById('input-auto-glidepath'); if (gcb) gcb.checked = !!isChecked;   /* 重新載入後開關要跟狀態一致 */
        var manualSlider = document.getElementById('input-target-ratio-slider');
        if(manualSlider) { manualSlider.disabled = isChecked; manualSlider.style.opacity = isChecked ? 0.4 : 1; }
        if (update) updateTotals();
    }

    function toggleDampener(isChecked, update = true) {
        state.autoDampener = isChecked; var p = document.getElementById('dampener-settings'); if(p) p.style.display = isChecked ? 'block' : 'none';
        var dcb = document.getElementById('input-auto-dampener'); if (dcb) dcb.checked = !!isChecked;
        if (update) updateTotals();
    }

    function updateBiasRatio(val) { state.biasRatio = parseFloat(val) || 0; updateTotals(); }
    function updateRebalanceTarget(val) { state.rebalanceTargetInv = parseFloat(val) || 50; updateTotals(); }
