/* js/schema.js — 資料版本與遷移（純函式區塊，測試單獨抽出來跑）。最先載入：state 的初始值要用到 SCHEMA_VERSION。
   一般 script（不是 ES modules）：依 index.html 裡的順序載入，共用同一個全域範圍（行內 onclick 與測試都靠這一點）。 */

    /* ===== 資料版本與遷移（純函式，SCHEMA-BEGIN/END 之間，不碰 DOM、不碰 localStorage）=====
       儲存的資料帶一個 schemaVersion（整數）；儲存用的 key 名稱（v16_18）只是名字，不代表版本，看這個欄位才準。
       之後資料結構有「不相容」的改動（欄位改名、單位改變、一個欄位拆成兩個…）時：
         1. SCHEMA_VERSION 加 1
         2. 在 SCHEMA_MIGRATIONS 補一筆 { from: 舊版, to: 新版, run: function(s) {…} }
            run 直接修改傳進來的資料，回傳「做了什麼」的說明陣列（沒事做就回傳 []）
       只是「新增欄位」不用升版：載入時缺的欄位本來就會用預設值。
       載入、匯入備份檔、雲端還原三個入口都經過 migrateState，所以舊備份永遠能升到目前版本；
       反過來，比目前網頁還新的資料會被擋下（見 loadData／importFromFile／syncFromCloud），避免舊網頁把新資料存壞。 */
    /* SCHEMA-BEGIN */
    var SCHEMA_VERSION = 1;
    var SECRET_STATE_KEYS = ['gasToken', 'apiToken', 'token'];   /* 金鑰絕不該出現在狀態、備份或雲端資料裡 */
    var META_STATE_KEYS = ['backupVersion', 'exportedAt', 'restorePointReason', 'restorePointAt', 'sandboxMode'];   /* 匯出檔／還原點附加的說明欄位，不屬於資料本身 */
    var SCHEMA_LIST_LABELS = { accounts: '帳戶', debts: '負債', stocks: '持股', funds: '基金', notes: '筆記', history: '快照' };
    function isPlainObject(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
    /* 沒有、或不是「非負整數」＝最舊的格式（0）；壞值不信任，從頭整理 */
    function readSchemaVersion(raw) {
        var v = isPlainObject(raw) ? raw.schemaVersion : undefined;
        return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0) ? v : 0;
    }
    /* 0 → 1：舊資料（還沒有版本欄位）。把會讓畫面壞掉的空項目清掉，其餘欄位原樣保留 */
    function migrateLegacyToV1(s) {
        var notes = [];
        Object.keys(SCHEMA_LIST_LABELS).forEach(function(key) {
            if (s[key] === undefined) return;
            var label = SCHEMA_LIST_LABELS[key];
            if (!Array.isArray(s[key])) { s[key] = []; notes.push(label + '資料格式不對，已改成空的'); return; }
            if (key === 'notes') {   /* 純文字的筆記不要丟掉：轉成標準的 { id, date, text } */
                var converted = 0;
                s[key] = s[key].map(function(it, i) { if (typeof it === 'string' && it.trim() !== '') { converted++; return { id: 'n-migrated-' + i, date: '', text: it }; } return it; });
                if (converted) notes.push('把 ' + converted + ' 則純文字筆記轉成標準格式');
            }
            var before = s[key].length;
            s[key] = s[key].filter(function(it) { return key === 'history' ? (isPlainObject(it) && typeof it.date === 'string') : isPlainObject(it); });
            if (s[key].length !== before) notes.push('移除 ' + (before - s[key].length) + ' 筆無法使用的' + label + '項目');
        });
        return notes;
    }
    var SCHEMA_MIGRATIONS = [{ from: 0, to: 1, run: migrateLegacyToV1 }];
    /* 不論版本，一律清掉金鑰與附加說明欄位（冪等） */
    function sanitizeState(s) {
        var notes = [];
        SECRET_STATE_KEYS.forEach(function(k) { if (Object.prototype.hasOwnProperty.call(s, k)) { delete s[k]; if (notes.indexOf('已移除資料裡不該存在的金鑰欄位') < 0) notes.push('已移除資料裡不該存在的金鑰欄位'); } });
        META_STATE_KEYS.forEach(function(k) { delete s[k]; });
        return notes;
    }
    /* 把任何版本的資料升到 target（預設＝目前版本）。不改動傳入的物件。
       成功：{ ok:true, state, fromVersion, toVersion, migrated, changes }；
       失敗：{ ok:false, error:'not-object'|'newer'|'no-path'|'failed', fromVersion, toVersion, … }（newer＝資料比這個網頁還新） */
    function migrateState(raw, migrations, target) {
        migrations = migrations || SCHEMA_MIGRATIONS; target = target === undefined ? SCHEMA_VERSION : target;
        if (!isPlainObject(raw)) return { ok: false, error: 'not-object', toVersion: target };
        var from = readSchemaVersion(raw);
        if (from > target) return { ok: false, error: 'newer', fromVersion: from, toVersion: target };
        var s = JSON.parse(JSON.stringify(raw)), cur = from, changes = [];
        if (raw.schemaVersion !== undefined && raw.schemaVersion !== null && raw.schemaVersion !== from) changes.push('資料版本欄位不正確，已當成舊格式重新整理');
        while (cur < target) {
            var step = null;
            for (var i = 0; i < migrations.length; i++) if (migrations[i].from === cur) { step = migrations[i]; break; }
            if (!step || !(step.to > cur)) return { ok: false, error: 'no-path', fromVersion: from, toVersion: target, stuckAt: cur };
            try { changes = changes.concat(step.run(s) || []); }
            catch (e) { return { ok: false, error: 'failed', fromVersion: from, toVersion: target, at: cur, message: String(e && e.message || e) }; }
            cur = step.to; s.schemaVersion = cur;
        }
        s.schemaVersion = target;
        changes = changes.concat(sanitizeState(s));
        return { ok: true, state: s, fromVersion: from, toVersion: target, migrated: from < target, changes: changes };
    }
    function describeMigrationError(mig, label) {
        label = label || '資料';
        if (mig && mig.error === 'newer') return label + '是較新版本的網頁存的（資料格式 v' + mig.fromVersion + '），這個網頁只看得懂 v' + mig.toVersion + ' 以前的格式。請改用最新版的網頁。';
        if (mig && mig.error === 'failed') return label + '的資料格式無法升級（v' + mig.fromVersion + ' → v' + mig.toVersion + '）：' + mig.message;
        if (mig && mig.error === 'no-path') return label + '的資料格式無法升級（找不到從 v' + mig.stuckAt + ' 往上的升級步驟）。';
        return label + '格式不是有效物件';
    }
    /* SCHEMA-END */
