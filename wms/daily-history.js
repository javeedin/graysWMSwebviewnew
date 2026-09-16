// ============================================================
// DAILY HISTORY - user activity review (task-mining front end)
// ============================================================
// Reads WMS_ACTIVITY_LOG / WMS_USER_FEEDBACK through the read-only
// query gateway and shows, for a chosen date + user:
//   Timeline  · Detailed Log · Repetitive Works · Friction · Feedback
// One query pulls the day's events; every tab is computed from it.
// ============================================================

(function () {
    'use strict';
    var AI_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    var st = { date: null, user: '', events: [], feedback: [], tab: 'timeline' };

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function q(v) { return v === null || v === undefined || v === '' ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"; }
    function appUser() { try { return localStorage.getItem('wms_user') || 'HISTORY'; } catch (e) { return 'HISTORY'; } }
    function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function mins(ms) { return Math.round((ms || 0) / 60000); }
    function fmtDur(ms) { var m = Math.floor((ms || 0) / 60000), s = Math.round(((ms || 0) % 60000) / 1000); return m ? (m + 'm ' + s + 's') : (s + 's'); }

    function runSql(sql, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb('bridge unavailable', null); return; }
        sendMessageToCSharp({ action: 'executePost', fullUrl: AI_BASE + '/executequery', body: JSON.stringify({ sql: sql, maxRows: 8000, appUser: appUser() }) },
            function (err, data) {
                if (err) { cb(String(err), null); return; }
                try {
                    var r = typeof data === 'string' ? JSON.parse(data) : data;
                    if (!r.success) { cb(r.error || 'query failed', null); return; }
                    var cols = (r.columns || []).map(function (c) { return String(c).toUpperCase(); });
                    cb(null, (r.rows || []).map(function (row) { var o = {}; cols.forEach(function (c, i) { o[c] = row[i]; }); return o; }));
                } catch (e) { cb(e.message, null); }
            });
    }

    var COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#b45309', '#16a34a', '#db2777', '#0891b2', '#4f46e5', '#ca8a04', '#dc2626'];
    function colorFor(key) { var h = 0; key = String(key || ''); for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffff; return COLORS[Math.abs(h) % COLORS.length]; }

    // ── shell ───────────────────────────────────────────────
    window.DailyHistory = {
        onShow: function () {
            var host = document.getElementById('daily-history');
            if (!host || host.getAttribute('data-built')) { return; }
            host.setAttribute('data-built', '1');
            host.innerHTML =
            '<div class="parameters-section" style="padding:16px 20px;">' +
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
                '<div style="font-size:18px;font-weight:800;color:#0f172a;"><i class="fas fa-timeline" style="color:#0f766e;"></i> Daily History</div>' +
                '<span style="font-size:11px;color:#64748b;">See exactly what a user did on a day — timeline, full log, repeated work and friction points.</span>' +
              '</div>' +
              '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:8px;">' +
                '<div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:2px;">Date</label>' +
                  '<input type="date" id="dh-date" value="' + todayIso() + '" style="padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></div>' +
                '<div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:2px;">User</label>' +
                  '<select id="dh-user" style="padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;min-width:160px;"><option value="">Loading users…</option></select></div>' +
                '<button id="dh-load" style="padding:8px 18px;border:none;border-radius:8px;background:#0f766e;color:white;font-weight:800;font-size:13px;cursor:pointer;"><i class="fas fa-magnifying-glass"></i> Load</button>' +
                '<span id="dh-status" style="font-size:12px;color:#64748b;"></span>' +
              '</div>' +
              '<div id="dh-lastpush" style="font-size:11px;color:#64748b;margin-top:8px;"><i class="fas fa-database" style="color:#94a3b8;"></i> checking last stored activity…</div>' +
            '</div>' +
            '<div style="padding:0 20px 24px;">' +
              '<div id="dh-tabs" style="display:flex;gap:4px;border-bottom:2px solid #e2e8f0;margin-bottom:12px;flex-wrap:wrap;"></div>' +
              '<div id="dh-body"><div style="color:#94a3b8;font-size:13px;padding:2rem;text-align:center;">Pick a date and user, then Load.</div></div>' +
            '</div>';

            document.getElementById('dh-load').addEventListener('click', DailyHistory.load);
            renderTabs();
            loadUsers();
            loadLastPush();
        },
        refreshLastPush: function () { loadLastPush(); },
        load: function () {
            st.date = document.getElementById('dh-date').value || todayIso();
            st.user = document.getElementById('dh-user').value || '';
            var status = document.getElementById('dh-status');
            status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…';
            var userClause = st.user ? " AND user_name = " + q(st.user) : "";
            var evSql =
                "SELECT TO_CHAR(event_ts,'YYYY-MM-DD\"T\"HH24:MI:SS') AS TS, user_name, module, page, event_type, target, entity_type, entity_id, dur_ms, meta " +
                "FROM wms_activity_log WHERE event_ts >= TO_DATE(" + q(st.date) + ",'YYYY-MM-DD') AND event_ts < TO_DATE(" + q(st.date) + ",'YYYY-MM-DD') + 1" + userClause +
                " ORDER BY event_ts";
            runSql(evSql, function (err, rows) {
                if (err) { status.innerHTML = '<span style="color:#b91c1c;">' + esc(err) + ' — has apex_sql/51 been run?</span>'; return; }
                st.events = rows || [];
                var fbSql =
                    "SELECT TO_CHAR(feedback_ts,'HH24:MI') AS TM, user_name, page, entity_type, entity_id, lang, source, text_raw, text_en, trans_status, theme, sentiment " +
                    "FROM wms_user_feedback WHERE feedback_ts >= TO_DATE(" + q(st.date) + ",'YYYY-MM-DD') AND feedback_ts < TO_DATE(" + q(st.date) + ",'YYYY-MM-DD') + 1" + userClause + " ORDER BY feedback_ts";
                runSql(fbSql, function (e2, fb) {
                    st.feedback = fb || [];
                    status.innerHTML = st.events.length + ' event(s), ' + st.feedback.length + ' feedback';
                    renderBody();
                });
            });
        }
    };

    function loadLastPush() {
        var el = document.getElementById('dh-lastpush');
        if (!el) return;
        runSql("SELECT TO_CHAR(MAX(created_on),'YYYY-MM-DD HH24:MI:SS') AS LAST_STORED, TO_CHAR(MAX(event_ts),'YYYY-MM-DD HH24:MI:SS') AS LAST_EVENT, COUNT(*) AS TOTAL FROM wms_activity_log",
            function (err, rows) {
                if (err) { el.innerHTML = '<span style="color:#b45309;"><i class="fas fa-triangle-exclamation"></i> ' + esc(err) + '</span>'; return; }
                var r = (rows && rows[0]) || {};
                if (!r.TOTAL || Number(r.TOTAL) === 0) {
                    el.innerHTML = '<i class="fas fa-database" style="color:#94a3b8;"></i> No activity stored yet — use the app, then click the Activity Log icon and Push to DB.';
                    return;
                }
                el.innerHTML = '<i class="fas fa-database" style="color:#0f766e;"></i> Last pushed to DB: <b>' + esc(r.LAST_STORED || r.LAST_EVENT || '') + '</b>' +
                    ' · latest event: <b>' + esc(r.LAST_EVENT || '') + '</b>' +
                    ' · <b>' + esc(r.TOTAL) + '</b> total rows stored' +
                    ' <a href="javascript:void(0)" onclick="DailyHistory.refreshLastPush()" style="color:#0f766e;text-decoration:none;font-weight:700;margin-left:6px;"><i class="fas fa-rotate"></i></a>';
            });
    }

    function loadUsers() {
        runSql("SELECT DISTINCT user_name FROM wms_activity_log ORDER BY user_name", function (err, rows) {
            var sel = document.getElementById('dh-user');
            if (!sel) return;
            if (err) { sel.innerHTML = '<option value="">(all users)</option>'; return; }
            var me = appUser();
            sel.innerHTML = '<option value="">(all users)</option>' + (rows || []).map(function (r) {
                var u = r.USER_NAME || '';
                return '<option value="' + esc(u) + '"' + (u === me ? ' selected' : '') + '>' + esc(u) + '</option>';
            }).join('');
        });
    }

    var TABS = [['timeline', 'Timeline', 'chart-gantt'], ['log', 'Detailed Log', 'list'], ['repeat', 'Repetitive Works', 'repeat'], ['friction', 'Friction Detection', 'triangle-exclamation'], ['feedback', 'Feedback', 'comment-dots']];
    function renderTabs() {
        var el = document.getElementById('dh-tabs');
        if (!el) return;
        el.innerHTML = TABS.map(function (t) {
            var on = st.tab === t[0];
            return '<div onclick="DailyHistory.tab(\'' + t[0] + '\')" style="padding:7px 16px;font-size:12px;font-weight:800;cursor:pointer;border-radius:8px 8px 0 0;' +
                (on ? 'background:#0f766e;color:white;' : 'background:#f1f5f9;color:#475569;') + '"><i class="fas fa-' + t[2] + '"></i> ' + t[1] + '</div>';
        }).join('');
    }
    DailyHistory.tab = function (t) { st.tab = t; renderTabs(); renderBody(); };

    function renderBody() {
        var b = document.getElementById('dh-body');
        if (!b) return;
        if (st.tab === 'feedback') { b.innerHTML = viewFeedback(); return; }
        if (!st.events.length) { b.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:2rem;text-align:center;">No activity for this date/user.</div>'; return; }
        if (st.tab === 'timeline') b.innerHTML = viewTimeline();
        else if (st.tab === 'log') b.innerHTML = viewLog();
        else if (st.tab === 'repeat') b.innerHTML = viewRepeat();
        else if (st.tab === 'friction') b.innerHTML = viewFriction();
    }

    // ── derive page segments from nav events ────────────────
    function segments() {
        var segs = [];
        st.events.forEach(function (e) {
            if (e.EVENT_TYPE !== 'nav' || !e.DUR_MS) return;
            var end = new Date(e.TS).getTime();
            var start = end - Number(e.DUR_MS);
            segs.push({ page: e.PAGE || '(unknown)', start: start, end: end, dur: Number(e.DUR_MS) });
        });
        return segs.sort(function (a, b) { return a.start - b.start; });
    }

    function viewTimeline() {
        var segs = segments();
        var idle = st.events.filter(function (e) { return e.EVENT_TYPE === 'idle'; }).reduce(function (s, e) { return s + Number(e.DUR_MS || 0); }, 0);
        if (!segs.length) return '<div style="color:#94a3b8;padding:1.5rem;">No page-timing captured yet (needs navigation events).</div>';
        var t0 = segs[0].start, t1 = segs[segs.length - 1].end;
        var span = Math.max(t1 - t0, 60000);
        var active = segs.reduce(function (s, x) { return s + x.dur; }, 0);

        // per-page totals
        var byPage = {};
        segs.forEach(function (s) { byPage[s.page] = (byPage[s.page] || 0) + s.dur; });
        var pages = Object.keys(byPage).sort(function (a, b) { return byPage[b] - byPage[a]; });

        // hour ticks
        var ticks = '';
        var startH = new Date(t0); startH.setMinutes(0, 0, 0);
        for (var h = startH.getTime(); h <= t1; h += 3600000) {
            var left = ((h - t0) / span) * 100;
            if (left < 0 || left > 100) continue;
            ticks += '<div style="position:absolute;left:' + left + '%;top:0;bottom:0;border-left:1px dashed #e2e8f0;"></div>' +
                '<div style="position:absolute;left:' + left + '%;top:-16px;font-size:9px;color:#94a3b8;transform:translateX(-50%);">' + hm(new Date(h)) + '</div>';
        }
        var bars = segs.map(function (s) {
            var left = ((s.start - t0) / span) * 100, w = Math.max((s.dur / span) * 100, 0.4);
            return '<div title="' + esc(s.page) + ' · ' + hm(new Date(s.start)) + '–' + hm(new Date(s.end)) + ' · ' + fmtDur(s.dur) + '" ' +
                'style="position:absolute;left:' + left + '%;width:' + w + '%;top:4px;height:26px;background:' + colorFor(s.page) + ';border-radius:4px;opacity:0.9;"></div>';
        }).join('');
        // entity/action markers
        var marks = st.events.filter(function (e) { return e.EVENT_TYPE === 'entity_view' || e.EVENT_TYPE === 'action' || e.EVENT_TYPE === 'error'; }).map(function (e) {
            var x = new Date(e.TS).getTime();
            if (x < t0 || x > t1) return '';
            var left = ((x - t0) / span) * 100;
            var c = e.EVENT_TYPE === 'error' ? '#dc2626' : (e.EVENT_TYPE === 'action' ? '#16a34a' : '#2563eb');
            var lbl = (e.ENTITY_TYPE ? e.ENTITY_TYPE + ' ' + e.ENTITY_ID : (e.TARGET || e.EVENT_TYPE));
            return '<div title="' + hm(new Date(x)) + ' · ' + esc(lbl) + '" style="position:absolute;left:' + left + '%;top:34px;width:8px;height:8px;border-radius:50%;background:' + c + ';transform:translateX(-50%);"></div>';
        }).join('');

        var summary =
            '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;">' +
            tile('Active time', fmtDur(active), '#0f766e') +
            tile('Idle time', fmtDur(idle), '#b45309') +
            tile('Pages visited', String(pages.length), '#2563eb') +
            tile('First → Last', hm(new Date(t0)) + ' → ' + hm(new Date(t1)), '#7c3aed') +
            '</div>';

        var legend = pages.map(function (p) {
            return '<div style="display:inline-flex;align-items:center;gap:5px;font-size:11px;margin:0 12px 6px 0;">' +
                '<span style="width:11px;height:11px;border-radius:3px;background:' + colorFor(p) + ';display:inline-block;"></span>' +
                esc(p) + ' <b style="color:#475569;">' + mins(byPage[p]) + 'm</b></div>';
        }).join('');

        return summary +
            '<div style="position:relative;height:52px;margin:22px 0 6px;border:1px solid #eef2f7;border-radius:8px;background:#fbfcfe;">' + ticks + bars + marks + '</div>' +
            '<div style="margin-top:10px;">' + legend + '</div>' +
            '<div style="font-size:10px;color:#94a3b8;margin-top:6px;">Bars = time on a page. Dots: <span style="color:#2563eb;">●</span> entity viewed · <span style="color:#16a34a;">●</span> action · <span style="color:#dc2626;">●</span> error.</div>';
    }
    function tile(label, val, color) {
        return '<div style="background:white;border:1px solid #eef2f7;border-radius:10px;padding:9px 14px;min-width:110px;">' +
            '<div style="font-size:9.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px;">' + label + '</div>' +
            '<div style="font-size:16px;font-weight:800;color:' + color + ';margin-top:2px;">' + val + '</div></div>';
    }

    // pull meta.params (captured query filters) out of the meta CLOB and
    // render them as compact "name = value" chips under the target
    function paramsHtml(e) {
        var p = null;
        try { if (e.META) { var m = JSON.parse(e.META); p = m && m.params; } } catch (x) { }
        if (!p || typeof p !== 'object') return '';
        var keys = Object.keys(p);
        if (!keys.length) return '';
        return '<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px;">' + keys.slice(0, 20).map(function (k) {
            return '<span style="font-size:9.5px;background:#eef6f5;color:#0f766e;border:1px solid #d5e9e6;border-radius:6px;padding:1px 6px;">' +
                esc(k) + ' = <b>' + esc(String(p[k])) + '</b></span>';
        }).join('') + '</div>';
    }

    function viewLog() {
        var rows = st.events.map(function (e) {
            return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                '<td style="padding:5px 8px;white-space:nowrap;color:#64748b;vertical-align:top;">' + hm(new Date(e.TS)) + ':' + pad(new Date(e.TS).getSeconds()) + '</td>' +
                '<td style="padding:5px 8px;vertical-align:top;"><span style="font-size:9px;font-weight:800;padding:1px 7px;border-radius:8px;background:' + colorFor(e.EVENT_TYPE) + '22;color:' + colorFor(e.EVENT_TYPE) + ';">' + esc(e.EVENT_TYPE) + '</span></td>' +
                '<td style="padding:5px 8px;vertical-align:top;">' + esc(e.PAGE || '') + '</td>' +
                '<td style="padding:5px 8px;color:#475569;vertical-align:top;">' + esc(e.TARGET || '') + paramsHtml(e) + '</td>' +
                '<td style="padding:5px 8px;">' + (e.ENTITY_TYPE ? esc(e.ENTITY_TYPE + ' ' + e.ENTITY_ID) : '') + '</td>' +
                '<td style="padding:5px 8px;text-align:right;color:#0f766e;">' + (e.DUR_MS ? fmtDur(Number(e.DUR_MS)) : '') + '</td></tr>';
        }).join('');
        return '<div style="border:1px solid #eef2f7;border-radius:8px;overflow:auto;max-height:560px;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:11.5px;"><thead><tr style="background:#f8fafc;position:sticky;top:0;">' +
            ['Time', 'Type', 'Page', 'Target', 'Entity', 'Duration'].map(function (h) { return '<th style="padding:7px 8px;text-align:left;font-size:10px;color:#475569;text-transform:uppercase;">' + h + '</th>'; }).join('') +
            '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function viewRepeat() {
        // repeated actions (page + target)
        var actMap = {};
        st.events.forEach(function (e) {
            if (e.EVENT_TYPE !== 'click' && e.EVENT_TYPE !== 'action') return;
            var k = (e.PAGE || '') + ' ▸ ' + (e.TARGET || '');
            actMap[k] = (actMap[k] || 0) + 1;
        });
        var acts = Object.keys(actMap).map(function (k) { return { k: k, n: actMap[k] }; }).filter(function (x) { return x.n >= 3; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 25);

        // revisited entities
        var entMap = {};
        st.events.forEach(function (e) {
            if (!e.ENTITY_TYPE || !e.ENTITY_ID) return;
            var k = e.ENTITY_TYPE + ' ' + e.ENTITY_ID;
            entMap[k] = (entMap[k] || 0) + 1;
        });
        var ents = Object.keys(entMap).map(function (k) { return { k: k, n: entMap[k] }; }).filter(function (x) { return x.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 25);

        // 3-step page/action sequences (n-gram over the day's event stream)
        var stream = st.events.filter(function (e) { return ['nav', 'entity_view', 'action', 'click'].indexOf(e.EVENT_TYPE) >= 0; })
            .map(function (e) { return e.EVENT_TYPE + ':' + (e.PAGE || '') + (e.ENTITY_TYPE ? '/' + e.ENTITY_TYPE : (e.TARGET ? '/' + String(e.TARGET).slice(0, 18) : '')); });
        var seqMap = {};
        for (var i = 0; i + 2 < stream.length; i++) {
            var sig = stream[i] + '  →  ' + stream[i + 1] + '  →  ' + stream[i + 2];
            seqMap[sig] = (seqMap[sig] || 0) + 1;
        }
        var seqs = Object.keys(seqMap).map(function (k) { return { k: k, n: seqMap[k] }; }).filter(function (x) { return x.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 15);

        return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            block('Most repeated actions', acts, 'times', 'These are candidates for a button macro or a trained shortcut.') +
            block('Repeatedly opened trips / orders', ents, 'opens', 'The same record checked many times often signals a monitoring routine.') +
            '</div>' +
            '<div style="margin-top:16px;">' +
            block('Recurring 3-step sequences', seqs, 'times', 'A sequence the user repeats — the strongest signal for automating a process. Teach it to the Digital Employee.', true) +
            '</div>';
    }
    function block(title, arr, unit, hint, wide) {
        var body = arr.length ? arr.map(function (x) {
            return '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:' + (wide ? '11px' : '12px') + ';">' +
                '<span style="color:#334155;' + (wide ? 'font-family:Consolas,monospace;' : '') + '">' + esc(x.k) + '</span>' +
                '<span style="font-weight:800;color:#0f766e;white-space:nowrap;">' + x.n + ' ' + unit + '</span></div>';
        }).join('') : '<div style="padding:1rem;color:#94a3b8;font-size:12px;">Nothing repeated enough to report.</div>';
        return '<div style="border:1px solid #eef2f7;border-radius:10px;overflow:hidden;">' +
            '<div style="padding:8px 12px;background:#f8fafc;font-size:12px;font-weight:800;color:#334155;">' + title + '</div>' +
            '<div style="max-height:320px;overflow:auto;">' + body + '</div>' +
            '<div style="padding:6px 12px;font-size:9.5px;color:#94a3b8;background:#fcfdff;">' + hint + '</div></div>';
    }

    function viewFriction() {
        var items = [];
        // errors
        var errs = st.events.filter(function (e) { return e.EVENT_TYPE === 'error'; });
        if (errs.length) items.push(fr('Errors seen', errs.length, '#dc2626', errs.slice(0, 6).map(function (e) { return hm(new Date(e.TS)) + ' · ' + (e.PAGE || '') + ' · ' + (e.TARGET || ''); })));
        // long idle gaps
        var idles = st.events.filter(function (e) { return e.EVENT_TYPE === 'idle' && Number(e.DUR_MS) > 10 * 60000; });
        if (idles.length) items.push(fr('Long idle gaps (>10m)', idles.length, '#b45309', idles.slice(0, 6).map(function (e) { return 'ended ' + hm(new Date(e.TS)) + ' · ' + fmtDur(Number(e.DUR_MS)); })));
        // repeated searches on same page
        var srch = {}; st.events.forEach(function (e) { if (e.EVENT_TYPE === 'search') { srch[e.PAGE || ''] = (srch[e.PAGE || ''] || 0) + 1; } });
        var srepeat = Object.keys(srch).filter(function (k) { return srch[k] >= 4; });
        if (srepeat.length) items.push(fr('Repeated searching', srepeat.reduce(function (s, k) { return s + srch[k]; }, 0), '#7c3aed', srepeat.map(function (k) { return (k || '(page)') + ' · ' + srch[k] + ' searches'; })));
        // rage clicks: same target >=4 within 5s windows
        var rage = detectRage();
        if (rage.length) items.push(fr('Rapid repeated clicks', rage.length, '#dc2626', rage.slice(0, 6).map(function (r) { return r.target + ' · ' + r.n + '× at ' + r.at; })));
        // long dwell pages (>25% of active on one page)
        var segs = segments(); var byPage = {}; var total = 0;
        segs.forEach(function (s) { byPage[s.page] = (byPage[s.page] || 0) + s.dur; total += s.dur; });
        var heavy = Object.keys(byPage).filter(function (p) { return total && byPage[p] / total > 0.35; });
        if (heavy.length) items.push(fr('Time concentrated on one screen', heavy.length, '#0891b2', heavy.map(function (p) { return p + ' · ' + Math.round(byPage[p] / total * 100) + '% of active time'; })));

        if (!items.length) return '<div style="padding:1.5rem;color:#16a34a;font-size:13px;"><i class="fas fa-circle-check"></i> No friction signals detected for this day — a smooth session.</div>';
        return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">' + items.join('') + '</div>' +
            '<div style="font-size:10px;color:#94a3b8;margin-top:10px;">Friction is inferred from the activity log (errors, idle, repeated searches, rapid clicks, single-screen concentration). Pair it with the user\'s Feedback tab for the "why".</div>';
    }
    function fr(title, count, color, lines) {
        return '<div style="border:1px solid #eef2f7;border-left:4px solid ' + color + ';border-radius:10px;padding:10px 12px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-size:12.5px;font-weight:800;color:#334155;">' + title + '</div>' +
            '<div style="font-size:15px;font-weight:800;color:' + color + ';">' + count + '</div></div>' +
            '<div style="margin-top:5px;font-size:10.5px;color:#64748b;">' + lines.map(function (l) { return '<div style="padding:1px 0;">' + esc(l) + '</div>'; }).join('') + '</div></div>';
    }
    function detectRage() {
        var out = [], window = [];
        st.events.filter(function (e) { return e.EVENT_TYPE === 'click'; }).forEach(function (e) {
            var t = new Date(e.TS).getTime();
            window = window.filter(function (w) { return t - w.t < 5000 && w.target === e.TARGET; });
            window.push({ t: t, target: e.TARGET });
            if (window.length >= 4) { out.push({ target: e.TARGET || '(control)', n: window.length, at: hm(new Date(t)) }); window = []; }
        });
        return out;
    }

    function viewFeedback() {
        if (!st.feedback.length) return '<div style="padding:1.5rem;color:#94a3b8;font-size:13px;">No spoken/typed feedback for this date/user. Users leave it with the 🎙 button in the corner.</div>';
        return '<div style="display:flex;flex-direction:column;gap:10px;">' + st.feedback.map(function (f) {
            var en = f.TEXT_EN || f.TEXT_RAW || '';
            var raw = f.TEXT_RAW || '';
            var showRaw = raw && raw !== en;
            return '<div style="border:1px solid #eef2f7;border-radius:10px;padding:11px 14px;background:white;">' +
                '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:#94a3b8;margin-bottom:4px;">' +
                  '<span><i class="fas fa-clock"></i> ' + esc(f.TM) + ' · ' + esc(f.USER_NAME || '') + ' · ' + esc(f.PAGE || '') + (f.ENTITY_TYPE ? ' · ' + esc(f.ENTITY_TYPE + ' ' + f.ENTITY_ID) : '') + '</span>' +
                  '<span>' + esc(f.SOURCE || '') + ' · ' + esc(f.LANG || '') + (f.TRANS_STATUS === 'RAW' ? ' · <span style="color:#b45309;">not translated</span>' : '') + '</span></div>' +
                '<div style="font-size:13px;color:#0f172a;">' + esc(en) + '</div>' +
                (showRaw ? '<div style="font-size:11px;color:#94a3b8;margin-top:3px;">original: ' + esc(raw) + '</div>' : '') +
                (f.THEME ? '<div style="margin-top:5px;"><span style="font-size:9px;font-weight:800;padding:1px 8px;border-radius:8px;background:#ede9fe;color:#6d28d9;">' + esc(f.THEME) + '</span></div>' : '') +
                '</div>';
        }).join('') + '</div>';
    }
})();
