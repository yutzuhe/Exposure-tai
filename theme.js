/* js/theme.js — 深色／淺色背景切換。
   放在 <head> 裡、樣式表之前載入：畫面出現之前就把上次選的主題套上去，淺色使用者不會每次打開都先閃一下深色。
   這是「這台裝置的顯示偏好」，不是財務資料：存在自己的 localStorage 鍵，
   不進備份檔、不進雲端同步、不受 schemaVersion 影響（手機和電腦可以各選各的）。
   顏色本身都在 css/base.css：深色是預設值，淺色是 :root[data-theme="light"] 那一組變數。 */

var THEME_KEY = 'exposure_radar_theme';

/* THEME-BEGIN —— 純函式區：不碰 DOM、不碰 localStorage，測試用 vm 單獨載入這一段 */
function normalizeTheme(v) { return v === 'light' ? 'light' : 'dark'; }
function nextTheme(cur) { return normalizeTheme(cur) === 'light' ? 'dark' : 'light'; }
/* 瀏覽器網址列／狀態列的顏色，要和頁面背景一致；iPhone 主畫面 App 的狀態列文字則要反過來 */
function themeChrome(t) {
    return normalizeTheme(t) === 'light'
        ? { color: '#eef2f7', statusBar: 'default', buttonLabel: '深色', buttonIcon: 'fa-moon', buttonTitle: '切換成深色背景' }
        : { color: '#0a0f1d', statusBar: 'black-translucent', buttonLabel: '淺色', buttonIcon: 'fa-sun', buttonTitle: '切換成淺色背景' };
}
/* THEME-END */

function readSavedTheme() {
    try { return normalizeTheme(localStorage.getItem(THEME_KEY)); } catch (e) { return 'dark'; }
}

function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/* 圖表畫在 canvas 上，吃不到 CSS 變數：用這個把目前主題的變數值讀出來 */
function themeColor(name, fallback) {
    try {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    } catch (e) { return fallback; }
}

/* 按鈕文字、圖示與網址列顏色跟著主題走。按鈕在 body 裡，head 階段還不存在，所以會在載入完成後再同步一次 */
function syncThemeChrome() {
    var t = getTheme(), c = themeChrome(t);
    try {
        var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', c.color);
        var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'); if (bar) bar.setAttribute('content', c.statusBar);
        var btn = document.getElementById('btn-theme');
        if (btn) {
            btn.setAttribute('title', c.buttonTitle); btn.setAttribute('aria-label', c.buttonTitle);
            var icon = btn.querySelector('i'); if (icon) icon.className = 'fa-solid ' + c.buttonIcon;
            var label = document.getElementById('theme-btn-label'); if (label) label.textContent = c.buttonLabel;
        }
    } catch (e) { /* 只是外觀同步，失敗不影響使用 */ }
}

function applyTheme(t, save) {
    t = normalizeTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    if (save) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 無痕模式等：這次有換，只是下次不會記得 */ } }
    syncThemeChrome();
}

/* 切換時讓顏色柔順地淡入淡出（若系統設定「減少動態效果」就直接換） */
function toggleTheme() {
    var root = document.documentElement, calm = false;
    try { calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { calm = false; }
    if (!calm) { root.classList.add('theme-fade'); setTimeout(function() { root.classList.remove('theme-fade'); }, 450); }
    applyTheme(nextTheme(getTheme()), true);
    if (typeof applyChartTheme === 'function') applyChartTheme();
}

/* ---- 啟動：這支檔案在 <head>，先套用上次的選擇 ---- */
applyTheme(readSavedTheme(), false);
document.addEventListener('DOMContentLoaded', syncThemeChrome);
/* 同一個瀏覽器開了兩個分頁時，一邊換了，另一邊跟著換 */
window.addEventListener('storage', function(e) {
    if (e.key !== THEME_KEY) return;
    applyTheme(e.newValue, false);
    if (typeof applyChartTheme === 'function') applyChartTheme();
});
