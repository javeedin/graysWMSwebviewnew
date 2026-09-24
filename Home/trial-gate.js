/* ============================================================
   Shared TRIAL PERIOD GATE
   One trial for every trial module (AI Digital Employee, Fusion SQL):
   all of them read the same row of WMS_AI_TRIAL in the APEX DB
   (apex_sql/67_trial_period.sql), so extending or ending the trial
   there applies to all modules at once.

   Usage in a module page (after the body markup):
     <script src="../Home/trial-gate.js" data-module="Fusion SQL"
             data-badge="trial-badge" data-accent="#c74634"></script>
   - active trial   -> badge "TRIAL · N days left" in #data-badge
   - expired trial  -> full-screen lock with "Back to Home"
   - active <> 'Y'  -> gate disabled (licensed)
   Usage on Home: <script src="trial-gate.js" data-home="1"></script>
   marks every .module-card[data-trial] with the countdown.

   Fails open on query errors so a DB hiccup never locks users out
   (the DB row is the source of truth).
   ============================================================ */
(function () {
    var TRIAL_QUERY_URL = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/executequery';
    var TRIAL_SQL = "SELECT TO_CHAR(trial_end,'YYYY-MM-DD') AS TRIAL_END, active AS ACTIVE, message AS MESSAGE, " +
        "GREATEST(TRUNC(trial_end) - TRUNC(SYSDATE), 0) AS DAYS_LEFT, CASE WHEN SYSDATE > trial_end THEN 'Y' ELSE 'N' END AS EXPIRED " +
        "FROM wms_ai_trial WHERE ROWNUM = 1";

    var me = document.currentScript || {};
    var ds = me.dataset || {};
    var moduleName = ds.module || 'This module';
    var badgeId = ds.badge || 'trial-badge';
    var accent = ds.accent || '#7c3aed';
    var isHome = ds.home === '1';

    // ── own tiny bridge: its own requestIds, so it never collides with the page's bridge ──
    var pending = {};
    function hostQuery(cb) {
        if (!(window.chrome && window.chrome.webview)) { cb('no WebView2 host'); return; }
        var id = 'trial_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        pending[id] = cb;
        window.chrome.webview.postMessage({
            action: 'executePost', requestId: id, fullUrl: TRIAL_QUERY_URL,
            body: JSON.stringify({ sql: TRIAL_SQL, maxRows: 1, appUser: 'TRIAL_CHECK' })
        });
    }
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.addEventListener('message', function (ev) {
            var r = ev.data;
            if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
            if (!r || !r.requestId || !pending[r.requestId]) return;
            var cb = pending[r.requestId]; delete pending[r.requestId];
            if (r.action === 'error') cb(r.message || 'host error'); else cb(null, r.data);
        });
    }

    /** cb(state) with state = null (fail-open / disabled) or { expired, daysLeft, trialEnd, message }. */
    function readTrial(cb) {
        hostQuery(function (err, data) {
            if (err) { console.warn('[Trial] check failed (fail-open):', err); cb(null); return; }
            try {
                var r = typeof data === 'string' ? JSON.parse(data) : data;
                if (!r || !r.success || !r.rows || !r.rows.length) { console.warn('[Trial] no trial row (fail-open)'); cb(null); return; }
                var row = r.rows[0], o = {};
                if (Array.isArray(row)) {
                    var cols = (r.columns || []).map(function (c) { return String(c && c.name || c).toUpperCase(); });
                    row.forEach(function (v, i) { o[cols[i]] = v; });
                } else Object.keys(row).forEach(function (k) { o[k.toUpperCase()] = row[k]; });
                if (String(o.ACTIVE).toUpperCase() !== 'Y') { cb(null); return; }   // gate disabled
                cb({ expired: String(o.EXPIRED).toUpperCase() === 'Y', daysLeft: Number(o.DAYS_LEFT) || 0, trialEnd: o.TRIAL_END, message: o.MESSAGE });
            } catch (e) { console.warn('[Trial] parse failed (fail-open):', e); cb(null); }
        });
    }
    function daysText(n) { return n + ' day' + (n === 1 ? '' : 's') + ' left'; }

    function showLock(t) {
        if (document.getElementById('trial-lock')) return;
        document.body.insertAdjacentHTML('beforeend',
            '<div id="trial-lock" style="position:fixed;inset:0;background:rgba(15,23,42,0.92);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif;">' +
              '<div style="background:white;border-radius:16px;max-width:440px;width:90%;padding:2.2rem 2rem;text-align:center;box-shadow:0 30px 90px rgba(0,0,0,0.5);">' +
                '<div style="font-size:3rem;">⏳</div>' +
                '<h2 style="margin:0.8rem 0 0.4rem;color:#1e293b;font-size:1.25rem;">Trial period ended</h2>' +
                (t.trialEnd ? '<div style="font-size:11px;color:#94a3b8;margin-bottom:0.6rem;">Trial ended on ' + t.trialEnd + '</div>' : '') +
                '<p style="margin:0;color:#64748b;font-size:0.9rem;line-height:1.5;">' +
                (t.message || 'The ' + moduleName + ' trial has ended. Please contact the administrator to continue using it.') +
                '</p>' +
                '<button onclick="window.location.href=\'../Home/index.html\'" style="margin-top:1.4rem;background:' + accent + ';color:white;border:none;padding:0.6rem 1.6rem;border-radius:9px;font-weight:700;font-size:0.85rem;cursor:pointer;">Back to Home</button>' +
              '</div>' +
            '</div>');
    }
    function showBadge(t) {
        var b = document.getElementById(badgeId);
        if (!b) return;
        b.style.display = 'inline-block';
        b.textContent = 'TRIAL · ' + daysText(t.daysLeft);
        b.title = 'Trial ends ' + (t.trialEnd || '') + ' — shared by AI Digital Employee and Fusion SQL';
        if (t.daysLeft <= 3) { b.style.background = '#fee2e2'; b.style.color = '#991b1b'; }
    }
    function markHomeTiles(t) {
        document.querySelectorAll('.module-card[data-trial]').forEach(function (card) {
            var tag = card.querySelector('.trial-tag');
            if (!tag) {
                tag = document.createElement('span');
                tag.className = 'trial-tag';
                tag.style.cssText = 'position:absolute;top:12px;right:12px;font-size:10px;font-weight:800;padding:2px 8px;border-radius:10px;letter-spacing:.3px;';
                card.appendChild(tag);
            }
            if (t.expired) {
                tag.textContent = 'TRIAL ENDED';
                tag.style.background = '#fee2e2'; tag.style.color = '#991b1b';
            } else {
                tag.textContent = 'TRIAL · ' + daysText(t.daysLeft);
                tag.style.background = t.daysLeft <= 3 ? '#fee2e2' : '#fef3c7';
                tag.style.color = t.daysLeft <= 3 ? '#991b1b' : '#92400e';
            }
        });
    }

    function run() {
        readTrial(function (t) {
            if (!t) return;
            if (isHome) { markHomeTiles(t); return; }
            if (t.expired) showLock(t); else showBadge(t);
        });
    }
    function start() { setTimeout(run, 800); }   // after the host bridge is ready
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
