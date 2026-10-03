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
            stopJourney();
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

    var TABS = [['timeline', 'Timeline', 'chart-gantt'], ['journey', 'Journey Replay', 'play'], ['log', 'Detailed Log', 'list'], ['repeat', 'Repetitive Works', 'repeat'], ['friction', 'Friction Detection', 'triangle-exclamation'], ['feedback', 'Feedback', 'comment-dots']];
    function renderTabs() {
        var el = document.getElementById('dh-tabs');
        if (!el) return;
        el.innerHTML = TABS.map(function (t) {
            var on = st.tab === t[0];
            return '<div onclick="DailyHistory.tab(\'' + t[0] + '\')" style="padding:7px 16px;font-size:12px;font-weight:800;cursor:pointer;border-radius:8px 8px 0 0;' +
                (on ? 'background:#0f766e;color:white;' : 'background:#f1f5f9;color:#475569;') + '"><i class="fas fa-' + t[2] + '"></i> ' + t[1] + '</div>';
        }).join('');
    }
    DailyHistory.tab = function (t) { stopJourney(); st.tab = t; renderTabs(); renderBody(); };

    function renderBody() {
        stopJourney();
        var b = document.getElementById('dh-body');
        if (!b) return;
        if (st.tab === 'feedback') { b.innerHTML = viewFeedback(); return; }
        if (!st.events.length) { b.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:2rem;text-align:center;">No activity for this date/user.</div>'; return; }
        if (st.tab === 'timeline') b.innerHTML = viewTimeline();
        else if (st.tab === 'journey') { b.innerHTML = viewJourney(); jrInit(); }
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

    // ── Journey Replay ──────────────────────────────────────
    // Animated start-to-end reconstruction: plays through the day's
    // events in order, showing which screen the user was on, how long
    // they stayed, and what they did (with the captured query params).
    var jr = { steps: [], segs: [], idx: 0, playing: false, timer: null, speed: 1, t0: 0, t1: 0 };

    function stopJourney() {
        if (jr.timer) { clearTimeout(jr.timer); jr.timer = null; }
        jr.playing = false;
    }

    function getParams(e) {
        try { if (e.META) { var m = JSON.parse(e.META); if (m && m.params && typeof m.params === 'object') return m.params; } } catch (x) { }
        return null;
    }

    // Which screen visit (segment) contains a given timestamp
    function segAt(t) {
        for (var i = 0; i < jr.segs.length; i++) { if (t >= jr.segs[i].start && t <= jr.segs[i].end) return jr.segs[i]; }
        // fall back to the nearest earlier segment
        var best = null;
        for (var j = 0; j < jr.segs.length; j++) { if (jr.segs[j].start <= t) best = jr.segs[j]; }
        return best;
    }

    function buildJourney() {
        jr.segs = segments();
        var keep = { nav: 1, entity_view: 1, action: 1, click: 1, search: 1, error: 1, idle: 1 };
        var evs = st.events.filter(function (e) { return keep[e.EVENT_TYPE]; });
        jr.steps = evs.slice(0, 800).map(function (e) {
            var t = new Date(e.TS).getTime();
            return {
                t: t, type: e.EVENT_TYPE, page: e.PAGE || '', target: e.TARGET || '',
                entType: e.ENTITY_TYPE || '', entId: e.ENTITY_ID || '',
                dwellMs: e.EVENT_TYPE === 'nav' || e.EVENT_TYPE === 'idle' ? Number(e.DUR_MS || 0) : 0,
                params: getParams(e)
            };
        });
        jr.idx = 0;
        jr.t0 = jr.steps.length ? jr.steps[0].t : 0;
        jr.t1 = jr.steps.length ? jr.steps[jr.steps.length - 1].t : 0;
    }

    var STEP_META = {
        nav:         { icon: 'location-arrow', color: '#2563eb', verb: 'Went to' },
        entity_view: { icon: 'folder-open',    color: '#7c3aed', verb: 'Opened' },
        action:      { icon: 'bolt',           color: '#16a34a', verb: 'Did' },
        click:       { icon: 'hand-pointer',   color: '#0891b2', verb: 'Clicked' },
        search:      { icon: 'magnifying-glass',color: '#0f766e', verb: 'Searched' },
        error:       { icon: 'triangle-exclamation', color: '#dc2626', verb: 'Error on' },
        idle:        { icon: 'mug-hot',        color: '#b45309', verb: 'Idle / away' }
    };
    function sm(type) { return STEP_META[type] || { icon: 'circle', color: '#64748b', verb: '' }; }

    function stepTitle(s) {
        if (s.type === 'nav') return s.page || '(screen)';
        if (s.type === 'entity_view') return (s.entType ? s.entType + ' ' + s.entId : (s.target || 'record'));
        if (s.type === 'idle') return 'Stepped away';
        return s.target || s.type;
    }

    function jrWait(s) {
        var base = 850;
        if (s.dwellMs) base += Math.min(s.dwellMs / 25, 1900);
        base = Math.max(450, Math.min(base, 2800));
        return Math.round(base / jr.speed);
    }

    function viewJourney() {
        buildJourney();
        if (!jr.steps.length) return '<div style="color:#94a3b8;padding:1.5rem;">No replayable activity for this date/user.</div>';
        var speeds = [1, 2, 4, 8].map(function (v) {
            return '<option value="' + v + '"' + (v === jr.speed ? ' selected' : '') + '>' + v + '×</option>';
        }).join('');
        return '' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
              '<button onclick="DailyHistory.jrRestart()" title="Restart" style="' + jrBtn() + '"><i class="fas fa-backward-step"></i></button>' +
              '<button onclick="DailyHistory.jrStep(-1)" title="Previous" style="' + jrBtn() + '"><i class="fas fa-caret-left"></i></button>' +
              '<button id="jr-playbtn" onclick="DailyHistory.jrToggle()" style="' + jrBtn(true) + '"><i class="fas fa-play"></i> Play</button>' +
              '<button onclick="DailyHistory.jrStep(1)" title="Next" style="' + jrBtn() + '"><i class="fas fa-caret-right"></i></button>' +
              '<label style="font-size:11px;color:#475569;font-weight:700;margin-left:6px;">Speed ' +
                '<select onchange="DailyHistory.jrSpeed(this.value)" style="padding:5px 7px;border:1px solid #e2e8f0;border-radius:7px;font-size:12px;margin-left:4px;">' + speeds + '</select></label>' +
              '<span id="jr-counter" style="font-size:11px;color:#64748b;margin-left:auto;font-weight:700;"></span>' +
            '</div>' +
            // progress bar
            '<div style="position:relative;height:6px;background:#eef2f7;border-radius:4px;margin-bottom:4px;">' +
              '<div id="jr-progress" style="position:absolute;left:0;top:0;bottom:0;width:0;background:#0f766e;border-radius:4px;transition:width .25s;"></div></div>' +
            // clickable step rail
            '<div id="jr-rail" style="display:flex;gap:4px;overflow-x:auto;padding:6px 2px 10px;"></div>' +
            // facebook-style route map of screens travelled
            '<div style="font-size:11px;font-weight:800;color:#334155;margin:6px 0 4px;"><i class="fas fa-map-location-dot" style="color:#0f766e;"></i> Route — how the user travelled between screens</div>' +
            '<div id="jr-map" style="position:relative;width:100%;border:1px solid #eef2f7;border-radius:12px;background:linear-gradient(#fbfcfe,#f6f9fb);overflow:hidden;"></div>' +
            // the animated stage
            '<div id="jr-stage" style="min-height:150px;margin:12px 0 14px;"></div>' +
            // trail of screens visited
            '<div style="font-size:11px;font-weight:800;color:#334155;margin:4px 0 6px;"><i class="fas fa-route" style="color:#0f766e;"></i> Screens visited (in order)</div>' +
            '<div id="jr-trail" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;"></div>';
    }
    function jrBtn(primary) {
        return 'padding:7px 12px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;' +
            (primary ? 'background:#0f766e;color:white;min-width:86px;' : 'background:#f1f5f9;color:#334155;');
    }

    function jrInit() {
        jr.idx = 0;
        jrBuildMap();
        jrRenderRail();
        jrRenderStep();
        jrRenderTrail();
        jrUpdateMap();
    }

    // ── Route map (Facebook-trip style) ─────────────────────
    // Merge consecutive visits to the same screen into route stops,
    // lay them out on a snaking path, and let a marker travel between
    // them as the replay plays.
    function buildRoute() {
        var r = [];
        jr.segs.forEach(function (s) {
            var last = r[r.length - 1];
            if (last && last.page === s.page) { last.end = s.end; last.dur += s.dur; }
            else r.push({ page: s.page, start: s.start, end: s.end, dur: s.dur });
        });
        return r;
    }
    function routeIdxAt(t) {
        var r = jr.route || [];
        for (var i = 0; i < r.length; i++) { if (t >= r[i].start && t <= r[i].end) return i; }
        var best = 0;
        for (var j = 0; j < r.length; j++) { if (r[j].start <= t) best = j; }
        return best;
    }
    DailyHistory.jrJumpScreen = function (i) {
        var r = jr.route || []; if (!r[i]) return;
        var start = r[i].start, target = 0;
        for (var k = 0; k < jr.steps.length; k++) { if (jr.steps[k].t >= start) { target = k; break; } target = k; }
        DailyHistory.jrJump(target);
    };

    function jrBuildMap() {
        var el = document.getElementById('jr-map');
        if (!el) return;
        jr.route = buildRoute();
        var r = jr.route;
        if (r.length < 2) {
            el.style.height = 'auto';
            el.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">' +
                (r.length === 1 ? 'Only one screen was used (' + esc(r[0].page) + ' · ' + fmtDur(r[0].dur) + ') — no travel between screens to map.' :
                    'No screen navigation captured to map.') + '</div>';
            return;
        }
        var W = el.clientWidth || 680;
        var cols = Math.max(2, Math.min(5, Math.floor(W / 155)));
        var colW = W / cols, rowH = 118, padTop = 46;
        var rows = Math.ceil(r.length / cols);
        var H = rows * rowH + 34;
        var total = r.reduce(function (s, x) { return s + x.dur; }, 0) || 1;

        r.forEach(function (n, i) {
            var row = Math.floor(i / cols);
            var colInRow = i % cols;
            var col = (row % 2 === 0) ? colInRow : (cols - 1 - colInRow); // serpentine
            n.x = Math.round(col * colW + colW / 2);
            n.y = Math.round(row * rowH + padTop);
            n.r = Math.round(18 + Math.min(14, (n.dur / total) * 46));
        });

        // connectors (one path per gap) drawn behind the pins
        var paths = '';
        for (var i = 0; i < r.length - 1; i++) {
            var a = r[i], b = r[i + 1];
            var dy = Math.abs(b.y - a.y) > 4 ? 46 : 34;
            var d = 'M' + a.x + ' ' + a.y + ' C ' + a.x + ' ' + (a.y + dy) + ' ' + b.x + ' ' + (b.y - dy) + ' ' + b.x + ' ' + b.y;
            paths += '<path id="jr-conn-' + i + '" d="' + d + '" fill="none" stroke="#cbd5e1" stroke-width="2.5" stroke-linecap="round"></path>';
        }
        var svg = '<svg width="' + W + '" height="' + H + '" style="position:absolute;left:0;top:0;pointer-events:none;">' + paths + '</svg>';

        // pins + labels
        var pins = r.map(function (n, i) {
            var c = colorFor(n.page);
            return '<div id="jr-node-' + i + '" onclick="DailyHistory.jrJumpScreen(' + i + ')" ' +
                'style="position:absolute;left:' + n.x + 'px;top:' + n.y + 'px;transform:translate(-50%,-50%);cursor:pointer;z-index:2;">' +
                '<div class="jr-pin" style="width:' + (n.r * 2) + 'px;height:' + (n.r * 2) + 'px;border-radius:50%;background:' + c + ';border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.18);' +
                'display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;transition:transform .25s,box-shadow .25s;">' + (i + 1) + '</div>' +
                '<div style="position:absolute;left:50%;top:' + (n.r * 2 + 2) + 'px;transform:translateX(-50%);white-space:nowrap;text-align:center;">' +
                '<div style="font-size:10.5px;font-weight:800;color:#334155;max-width:130px;overflow:hidden;text-overflow:ellipsis;">' + esc(n.page) + '</div>' +
                '<div style="font-size:9px;color:#94a3b8;">' + hm(new Date(n.start)) + ' · ' + fmtDur(n.dur) + '</div></div></div>';
        }).join('');

        // the travelling marker
        var traveler = '<div id="jr-traveler" style="position:absolute;left:' + r[0].x + 'px;top:' + r[0].y + 'px;transform:translate(-50%,-50%);z-index:3;' +
            'width:26px;height:26px;border-radius:50%;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;' +
            'box-shadow:0 3px 8px rgba(15,23,42,.35);transition:left .55s ease,top .55s ease;"><i class="fas fa-person-walking"></i></div>';

        el.style.height = H + 'px';
        el.innerHTML = svg + pins + traveler;
    }

    function jrUpdateMap() {
        var r = jr.route || [];
        if (r.length < 2) return;
        var t = jr.steps[jr.idx].t;
        var act = routeIdxAt(t);
        // pins: traveled = full, upcoming = dim, active = enlarged
        for (var i = 0; i < r.length; i++) {
            var node = document.getElementById('jr-node-' + i);
            if (!node) continue;
            var pin = node.querySelector('.jr-pin');
            node.style.opacity = i <= act ? '1' : '0.4';
            if (pin) {
                if (i === act) { pin.style.transform = 'scale(1.18)'; pin.style.boxShadow = '0 0 0 5px ' + colorFor(r[i].page) + '33, 0 2px 6px rgba(15,23,42,.2)'; }
                else { pin.style.transform = 'scale(1)'; pin.style.boxShadow = '0 2px 6px rgba(15,23,42,.18)'; }
            }
        }
        // connectors: traveled solid+colored, the one being crossed marches, rest grey
        for (var j = 0; j < r.length - 1; j++) {
            var p = document.getElementById('jr-conn-' + j);
            if (!p) continue;
            if (j < act) { p.setAttribute('stroke', colorFor(r[j].page)); p.setAttribute('stroke-dasharray', ''); p.classList.remove('jr-move'); p.style.opacity = '0.9'; }
            else if (j === act) { p.setAttribute('stroke', colorFor(r[j].page)); p.setAttribute('stroke-dasharray', '6 7'); p.classList.add('jr-move'); p.style.opacity = '1'; }
            else { p.setAttribute('stroke', '#cbd5e1'); p.setAttribute('stroke-dasharray', ''); p.classList.remove('jr-move'); p.style.opacity = '0.6'; }
        }
        // move the traveler to the active stop
        var tv = document.getElementById('jr-traveler');
        if (tv && r[act]) { tv.style.left = r[act].x + 'px'; tv.style.top = r[act].y + 'px'; }
    }

    function jrRenderRail() {
        var el = document.getElementById('jr-rail');
        if (!el) return;
        el.innerHTML = jr.steps.map(function (s, i) {
            var m = sm(s.type);
            var cur = i === jr.idx;
            return '<div onclick="DailyHistory.jrJump(' + i + ')" title="' + esc(hhmmss(s.t) + '  ' + m.verb + ' ' + stepTitle(s)) + '" ' +
                'style="flex:0 0 auto;width:' + (cur ? 26 : 18) + 'px;height:' + (cur ? 26 : 18) + 'px;border-radius:50%;cursor:pointer;' +
                'display:flex;align-items:center;justify-content:center;color:white;font-size:' + (cur ? 11 : 8) + 'px;' +
                'background:' + m.color + ';opacity:' + (i <= jr.idx ? 1 : 0.35) + ';' + (cur ? 'box-shadow:0 0 0 3px ' + m.color + '44;' : '') + '">' +
                '<i class="fas fa-' + m.icon + '"></i></div>';
        }).join('');
        // keep current node in view
        var cur = el.children[jr.idx];
        if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { } }
        var prog = document.getElementById('jr-progress');
        if (prog) prog.style.width = (jr.steps.length <= 1 ? 100 : (jr.idx / (jr.steps.length - 1)) * 100) + '%';
        var cnt = document.getElementById('jr-counter');
        if (cnt) cnt.textContent = 'Step ' + (jr.idx + 1) + ' of ' + jr.steps.length + '  ·  ' + hhmmss(jr.steps[jr.idx].t);
    }

    function jrRenderStep() {
        var el = document.getElementById('jr-stage');
        if (!el) return;
        var s = jr.steps[jr.idx];
        var m = sm(s.type);
        var seg = segAt(s.t);
        var screen = (s.type === 'nav' ? s.page : (seg ? seg.page : s.page)) || '(screen)';
        var dwell = s.type === 'nav' && s.dwellMs ? s.dwellMs : (seg ? seg.dur : 0);

        var paramChips = '';
        if (s.params) {
            var ks = Object.keys(s.params);
            if (ks.length) paramChips = '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">' + ks.slice(0, 20).map(function (k) {
                return '<span style="font-size:11px;background:#eef6f5;color:#0f766e;border:1px solid #d5e9e6;border-radius:7px;padding:3px 9px;">' +
                    esc(k) + ' = <b>' + esc(String(s.params[k])) + '</b></span>';
            }).join('') + '</div>';
        }

        var detail = '';
        if (s.type === 'nav') detail = 'Spent <b>' + fmtDur(dwell) + '</b> on this screen';
        else if (s.type === 'entity_view') detail = 'Viewed <b>' + esc(stepTitle(s)) + '</b>';
        else if (s.type === 'search') detail = 'Ran a query' + (paramChips ? ' with these filters:' : '');
        else if (s.type === 'idle') detail = 'Away for <b>' + fmtDur(s.dwellMs) + '</b>';
        else if (s.type === 'error') detail = 'Hit an error: <b>' + esc(s.target || '') + '</b>';
        else detail = esc(s.target || '');

        el.innerHTML =
            '<div key="' + jr.idx + '" style="animation:jrIn .34s ease;border:1px solid #eef2f7;border-left:5px solid ' + m.color + ';border-radius:12px;padding:16px 18px;background:white;box-shadow:0 1px 3px rgba(15,23,42,.05);">' +
              '<div style="display:flex;align-items:center;gap:10px;">' +
                '<div style="width:42px;height:42px;border-radius:11px;background:' + m.color + '1a;color:' + m.color + ';display:flex;align-items:center;justify-content:center;font-size:19px;"><i class="fas fa-' + m.icon + '"></i></div>' +
                '<div>' +
                  '<div style="font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:' + m.color + ';">' + esc(m.verb) + '</div>' +
                  '<div style="font-size:19px;font-weight:800;color:#0f172a;line-height:1.15;">' + esc(stepTitle(s)) + '</div>' +
                '</div>' +
                '<div style="margin-left:auto;text-align:right;">' +
                  '<div style="font-size:20px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;">' + hhmmss(s.t) + '</div>' +
                  '<div style="font-size:10px;color:#94a3b8;">on <b>' + esc(screen) + '</b></div>' +
                '</div>' +
              '</div>' +
              '<div style="margin-top:12px;font-size:13px;color:#475569;">' + detail + '</div>' +
              paramChips +
              // a bar that fills over the step's dwell, giving the sense of time passing
              '<div style="margin-top:14px;height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;">' +
                '<div id="jr-fill" style="height:100%;width:0;background:' + m.color + ';"></div></div>' +
            '</div>';

        // animate the fill for the current step's duration
        var fill = document.getElementById('jr-fill');
        if (fill) {
            var dur = jr.playing ? jrWait(s) : 600;
            fill.style.transition = 'none'; fill.style.width = '0';
            setTimeout(function () { var f = document.getElementById('jr-fill'); if (f) { f.style.transition = 'width ' + dur + 'ms linear'; f.style.width = '100%'; } }, 20);
        }
    }

    function jrRenderTrail() {
        var el = document.getElementById('jr-trail');
        if (!el) return;
        var nowT = jr.steps[jr.idx].t;
        var visited = jr.segs.filter(function (g) { return g.start <= nowT + 1000; });
        if (!visited.length) { el.innerHTML = '<span style="font-size:11px;color:#94a3b8;">No screen changes captured.</span>'; return; }
        el.innerHTML = visited.map(function (g, i) {
            var active = nowT >= g.start && nowT <= g.end;
            var chip = '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:4px 10px;border-radius:20px;' +
                'background:' + colorFor(g.page) + (active ? '' : '22') + ';color:' + (active ? 'white' : colorFor(g.page)) + ';border:1px solid ' + colorFor(g.page) + '33;' +
                (active ? 'font-weight:800;box-shadow:0 0 0 3px ' + colorFor(g.page) + '33;' : '') + '">' +
                esc(g.page) + ' <b style="opacity:.85;">' + fmtDur(g.dur) + '</b></span>';
            var arrow = i < visited.length - 1 ? '<i class="fas fa-angle-right" style="color:#cbd5e1;font-size:11px;"></i>' : '';
            return chip + arrow;
        }).join('');
    }

    function jrShow() { jrRenderRail(); jrRenderStep(); jrRenderTrail(); jrUpdateMap(); }

    DailyHistory.jrToggle = function () {
        if (jr.playing) { stopJourney(); jrSetPlayBtn(); return; }
        if (jr.idx >= jr.steps.length - 1) jr.idx = 0;
        jr.playing = true; jrSetPlayBtn(); jrTick();
    };
    DailyHistory.jrRestart = function () { stopJourney(); jr.idx = 0; jr.playing = true; jrSetPlayBtn(); jrTick(); };
    DailyHistory.jrStep = function (d) { stopJourney(); jrSetPlayBtn(); jr.idx = Math.max(0, Math.min(jr.steps.length - 1, jr.idx + d)); jrShow(); };
    DailyHistory.jrJump = function (i) { stopJourney(); jrSetPlayBtn(); jr.idx = Math.max(0, Math.min(jr.steps.length - 1, i)); jrShow(); };
    DailyHistory.jrSpeed = function (v) { jr.speed = Number(v) || 1; };

    function jrTick() { jrShow(); jr.timer = setTimeout(jrAdvance, jrWait(jr.steps[jr.idx])); }
    function jrAdvance() {
        if (!jr.playing) return;
        if (jr.idx >= jr.steps.length - 1) { stopJourney(); jrSetPlayBtn(); return; }
        jr.idx++;
        jrTick();
    }
    function jrSetPlayBtn() {
        var b = document.getElementById('jr-playbtn');
        if (!b) return;
        var done = jr.idx >= jr.steps.length - 1 && !jr.playing;
        b.innerHTML = jr.playing ? '<i class="fas fa-pause"></i> Pause' : (done ? '<i class="fas fa-rotate-right"></i> Replay' : '<i class="fas fa-play"></i> Play');
    }
    function hhmmss(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

    // relayout the route map when the window is resized (once)
    (function hookJrResize() {
        var to;
        window.addEventListener('resize', function () {
            if (st.tab !== 'journey' || !jr.steps.length) return;
            clearTimeout(to);
            to = setTimeout(function () { if (st.tab === 'journey') { jrBuildMap(); jrUpdateMap(); } }, 200);
        });
    })();

    // inject the entrance keyframe once
    (function injectJrStyle() {
        if (document.getElementById('dh-jr-style')) return;
        var s = document.createElement('style'); s.id = 'dh-jr-style';
        s.textContent = '@keyframes jrIn{from{opacity:0;transform:translateY(8px) scale(.99);}to{opacity:1;transform:none;}}' +
            '@keyframes jrDash{to{stroke-dashoffset:-26;}}' +
            '.jr-move{animation:jrDash .6s linear infinite;}';
        (document.head || document.documentElement).appendChild(s);
    })();

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
