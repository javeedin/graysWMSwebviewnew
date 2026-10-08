// ============================================================
// MRA INTERFACE - switch the Shipping Agent's MRA interface on / off
// ============================================================
// WMS menu › MRA Interface. One switch per instance (PROD / TEST) stored in
// WMS_MRA_INTERFACE_CONFIG (INTERFACE_FLAG Y / N). The Shipping Agent's Print Trip
// reads it on every click: Y = interface every order to MRA first and print only
// what MRA accepts, N = print without MRA. Every change (who, when, why) goes to
// WMS_MRA_INTERFACE_LOG. Both tables are created here on first use
// (apex_sql/79_mra_interface_config.sql has the same DDL).
// Three tabs under one GLOBAL bar (date from / to, instance, quick chips — the same dates drive every tab):
//   Setup — the switches above;
//   MRA transactions history — the rows the app writes to WMS_MRA_INTERFACE_STATUS on every MRA run
//     (classes/MRAInterfaceStatus.cs): trip, status, order / customer, latest try per order; Interface to MRA
//     again (retry) and Print per order or for the ticked orders; details with MRA's request / answer;
//   All orders — the total picture: every SALES order on the trips of the dates (GETTRIPDETAILS for the date
//     range → GETTRIPDETAILS/{trip} per trip, 4 at a time; store / van transactions and cancelled lines are left
//     out) grouped by trip with the trip's lorry / bay / priority, the order's customer, type, line status,
//     released / picked / shipped / printed flags and its MRA status — the latest WMS_MRA_INTERFACE_STATUS row per
//     order (Interfaced / Failed / Skipped / Not interfaced, IRN, last try, reason). Interface to MRA and Print
//     per order, per trip ("n not done") and for the ticked orders — the same runner as the history tab.
// ============================================================

(function () {
    'use strict';
    var AI_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    var INSTANCES = ['PROD', 'TEST'];
    var st = { flags: {}, log: [], loading: false, error: null, busy: {}, tab: 'setup' };
    try { var savedTab = localStorage.getItem('mri.tab'); if (savedTab === 'history' || savedTab === 'orders') st.tab = savedTab; } catch (e) { /* storage blocked */ }
    var ready = null;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function lit(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }
    function appUser() { try { return localStorage.getItem('wms_user') || (typeof appUserName === 'function' ? appUserName() : 'WMS'); } catch (e) { return 'WMS'; } }
    function curInstance() { try { return (typeof currentInstance === 'function' ? currentInstance() : (localStorage.getItem('wms_instance') || 'PROD')).toUpperCase(); } catch (e) { return 'PROD'; } }
    function notify(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[MRA Interface]', m); }

    function call(op, payload) {
        return new Promise(function (resolve, reject) {
            if (typeof sendMessageToCSharp !== 'function') { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp({ action: 'executePost', fullUrl: AI_BASE + '/' + op, body: JSON.stringify(Object.assign({ appUser: appUser() }, payload)) }, function (err, data) {
                if (err) { reject(new Error(String(err))); return; }
                var d = data;
                if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { reject(new Error('Unexpected database reply: ' + String(data).slice(0, 150))); return; } }
                if (!d || d.success === false) { reject(new Error((d && (d.error || d.message)) || 'Database API error')); return; }
                resolve(d);
            });
        });
    }
    function read(sql, max) {
        return call('executequery', { sql: sql, maxRows: max || 100 }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                var o = {};
                if (Array.isArray(r)) cols.forEach(function (c, i) { o[c] = r[i]; });
                else Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; });
                return o;
            });
        });
    }
    function write(sql) { return call('executewrite', { sql: sql }); }

    function ensure() {
        if (ready) return ready;
        ready = read("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_MRA_INTERFACE_CONFIG', 'WMS_MRA_INTERFACE_LOG')").then(function (rows) {
            var have = {}; rows.forEach(function (r) { have[r.TABLE_NAME] = 1; });
            var steps = [];
            if (!have.WMS_MRA_INTERFACE_CONFIG) steps.push("CREATE TABLE wms_mra_interface_config (instance_name VARCHAR2(20) PRIMARY KEY, " +
                "interface_flag VARCHAR2(1) DEFAULT 'Y' NOT NULL CONSTRAINT wms_mra_cfg_flag_ck CHECK (interface_flag IN ('Y','N')), " +
                "note VARCHAR2(400), changed_by VARCHAR2(120), changed_date DATE DEFAULT SYSDATE)");
            if (!have.WMS_MRA_INTERFACE_LOG) steps.push("CREATE TABLE wms_mra_interface_log (log_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, " +
                "instance_name VARCHAR2(20) NOT NULL, old_flag VARCHAR2(1), new_flag VARCHAR2(1) NOT NULL, note VARCHAR2(400), changed_by VARCHAR2(120), changed_date DATE DEFAULT SYSDATE)");
            INSTANCES.forEach(function (i) {
                steps.push("MERGE INTO wms_mra_interface_config t USING (SELECT " + lit(i) + " AS inst FROM dual) s ON (t.instance_name = s.inst) " +
                    "WHEN NOT MATCHED THEN INSERT (instance_name, interface_flag, note, changed_by, changed_date) VALUES (s.inst, 'Y', 'Default', 'SYSTEM', SYSDATE)");
            });
            return steps.reduce(function (p, sql) { return p.then(function () { return write(sql); }); }, Promise.resolve());
        }).catch(function (e) { ready = null; throw e; });
        return ready;
    }

    function load() {
        st.loading = true; st.error = null; render();
        return ensure().then(function () {
            return Promise.all([
                read("SELECT instance_name, interface_flag, note, changed_by, TO_CHAR(changed_date, 'YYYY-MM-DD HH24:MI') AS changed_at FROM wms_mra_interface_config ORDER BY instance_name"),
                read("SELECT instance_name, old_flag, new_flag, note, changed_by, TO_CHAR(changed_date, 'YYYY-MM-DD HH24:MI') AS changed_at FROM wms_mra_interface_log ORDER BY log_id DESC FETCH FIRST 50 ROWS ONLY", 50)
            ]);
        }).then(function (res) {
            st.flags = {};
            res[0].forEach(function (r) { st.flags[String(r.INSTANCE_NAME).toUpperCase()] = r; });
            st.log = res[1];
        }).catch(function (e) { st.error = e.message; })
          .then(function () { st.loading = false; render(); });
    }

    function setFlag(inst, flag, note) {
        var cur = st.flags[inst] || {};
        var old = String(cur.INTERFACE_FLAG || 'Y').toUpperCase();
        var who = appUser().slice(0, 120), n = String(note || '').slice(0, 400);
        st.busy[inst] = true; render();
        return write("MERGE INTO wms_mra_interface_config t USING (SELECT " + lit(inst) + " AS inst FROM dual) s ON (t.instance_name = s.inst) " +
            "WHEN MATCHED THEN UPDATE SET t.interface_flag = " + lit(flag) + ", t.note = " + lit(n) + ", t.changed_by = " + lit(who) + ", t.changed_date = SYSDATE " +
            "WHEN NOT MATCHED THEN INSERT (instance_name, interface_flag, note, changed_by, changed_date) VALUES (s.inst, " + lit(flag) + ", " + lit(n) + ", " + lit(who) + ", SYSDATE)")
            .then(function () {
                return write("INSERT INTO wms_mra_interface_log (instance_name, old_flag, new_flag, note, changed_by) VALUES (" +
                    lit(inst) + ", " + lit(old) + ", " + lit(flag) + ", " + lit(n) + ", " + lit(who) + ")").catch(function (e) { console.warn('[MRA Interface] log failed:', e.message); });
            })
            .then(function () {
                notify('MRA interface for ' + inst + ' is now ' + (flag === 'Y' ? 'ENABLED' : 'DISABLED') + '.', 'success');
                if (typeof window.saMraRefreshFlags === 'function') window.saMraRefreshFlags();
            })
            .catch(function (e) { notify('Could not save the MRA setting: ' + e.message, 'error'); })
            .then(function () { st.busy[inst] = false; return load(); });
    }

    // ── MRA transactions history (WMS_MRA_INTERFACE_STATUS) ──────────────────
    var H = { loaded: false, loading: false, error: null, rows: [], sel: {}, busy: {}, live: {}, f: null, more: false, grep: '' };   // grep = the bar's filter on the rows shown (any column)
    var MAX_ROWS = 2000;
    var STATUS = ['SUCCESS', 'FAILED', 'SKIPPED', 'ALREADY_DONE'];
    var ST_LABEL = { SUCCESS: 'Success', FAILED: 'Failed', SKIPPED: 'Skipped', ALREADY_DONE: 'Already done' };
    var HIST_CSS =
        
        '.mri-tabs{display:flex;gap:.4rem;align-items:center;border-bottom:2px solid #e2e8f0;}' +
        '.mri-tabs button.rf{margin-left:auto;border:1px solid #cbd5e1;border-radius:8px;padding:.35rem .8rem;margin-bottom:.3rem;font-size:.8rem;color:#334155;background:#fff;}' +
        '.mri-tabs button{background:none;border:none;border-bottom:3px solid transparent;margin-bottom:-2px;padding:.6rem 1rem;font-weight:700;color:#64748b;cursor:pointer;font-size:.9rem;}' +
        '.mri-tabs button.on{color:#4f46e5;border-bottom-color:#4f46e5;}' +
        '.mrh-f{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-end;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:.8rem 1rem;margin-top:1rem;}' +
        '.mrh-f label{display:flex;flex-direction:column;font-size:.7rem;font-weight:700;color:#64748b;gap:.2rem;text-transform:uppercase;letter-spacing:.02em;}' +
        '.mrh-f input,.mrh-f select{border:1px solid #cbd5e1;border-radius:8px;padding:.4rem .5rem;font:inherit;font-size:.85rem;color:#0f172a;min-width:120px;}' +
        '.mrh-f .chk{flex-direction:row;align-items:center;gap:.35rem;text-transform:none;font-size:.8rem;color:#334155;padding-bottom:.45rem;}' +
        '.mrh-f .chk input{min-width:0;width:auto;margin:0;}' +
        '.mrh-btn{border:none;border-radius:8px;padding:.5rem .9rem;font-weight:700;cursor:pointer;font-size:.82rem;display:inline-flex;align-items:center;gap:.35rem;}' +
        '.mrh-btn.p{background:#4f46e5;color:#fff;} .mrh-btn.g{background:#16a34a;color:#fff;} .mrh-btn.b{background:#0ea5e9;color:#fff;} .mrh-btn.n{background:#e2e8f0;color:#334155;}' +
        '.mrh-btn:disabled{opacity:.5;cursor:not-allowed;} .mrh-btn.s{padding:.25rem .5rem;font-size:.72rem;}' +
        '.mrh-quick{display:flex;gap:.3rem;flex-wrap:wrap;} .mrh-quick button{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:.2rem .6rem;font-size:.72rem;cursor:pointer;color:#334155;}' +
        '.mrh-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin-top:.8rem;}' +
        '.mrh-kpi div{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:.6rem .8rem;cursor:pointer;} .mrh-kpi div.on{outline:2px solid #4f46e5;}' +
        '.mrh-kpi b{display:block;font-size:1.35rem;color:#0f172a;} .mrh-kpi span{font-size:.72rem;color:#64748b;font-weight:600;}' +
        '.mrh-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.8rem;padding:.55rem .8rem;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;font-size:.82rem;color:#3730a3;}' +
        '.mrh-grep{display:inline-flex;align-items:center;gap:.4rem;background:#fff;border:1px solid #c7d2fe;border-radius:8px;padding:.2rem .55rem;flex:1 1 240px;max-width:460px;color:#94a3b8;}' +
        '.mrh-grep input{border:0;outline:0;font:inherit;font-size:.8rem;flex:1;min-width:120px;background:transparent;color:#0f172a;padding:.15rem 0;}' +
        '.mrh-grep button{border:0;background:#e0e7ff;color:#3730a3;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:.65rem;line-height:18px;padding:0;}' +
        '.mrh-grep-n{font-size:.74rem;color:#3730a3;white-space:nowrap;}' +
        '.mrh-tw{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-top:.8rem;overflow:auto;max-height:62vh;}' +
        '.mrh-t{width:100%;border-collapse:collapse;font-size:.78rem;} .mrh-t th{position:sticky;top:0;background:#f8fafc;text-align:left;color:#475569;font-weight:700;padding:.5rem .6rem;border-bottom:1px solid #e2e8f0;white-space:nowrap;z-index:1;}' +
        '.mrh-t td{padding:.35rem .6rem;border-bottom:1px solid #f1f5f9;color:#1e293b;vertical-align:middle;white-space:nowrap;}' +
        '.mrh-t td.cut{max-width:220px;overflow:hidden;text-overflow:ellipsis;} .mrh-t td.cut.w{max-width:320px;} .mrh-t td.cut.n{max-width:150px;}' +
        '.mrh-t .sub{color:#64748b;font-size:.7rem;margin-left:.3rem;} .mrh-t tr:hover td{background:#f8fafc;} .mrh-t tr.sel td{background:#eef2ff;}' +
        '.mrh-t .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;} .mrh-t .why{color:#b91c1c;font-size:.74rem;}' +
        '.mrh-s{display:inline-block;font-size:.68rem;font-weight:800;border-radius:999px;padding:.12rem .55rem;white-space:nowrap;}' +
        '.mrh-s.SUCCESS{background:#dcfce7;color:#15803d;} .mrh-s.FAILED{background:#fee2e2;color:#b91c1c;} .mrh-s.SKIPPED{background:#f1f5f9;color:#475569;} .mrh-s.ALREADY_DONE{background:#e0f2fe;color:#0369a1;} .mrh-s.RUN{background:#fef9c3;color:#a16207;}' +
        '.mrh-src{font-size:.68rem;color:#64748b;} .mrh-act{display:flex;gap:.25rem;white-space:nowrap;}' +
        '.mrh-empty{padding:2rem;text-align:center;color:#94a3b8;}' +
        '.mrh-dlg{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:30000;display:flex;align-items:center;justify-content:center;}' +
        '.mrh-dlg>div{background:#fff;border-radius:14px;width:min(980px,95vw);max-height:90vh;overflow:auto;padding:1.1rem 1.25rem;box-shadow:0 24px 80px rgba(0,0,0,.35);}' +
        '.mrh-dlg h4{margin:0 0 .6rem;font-size:1.05rem;} .mrh-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.4rem .9rem;font-size:.8rem;}' +
        '.mrh-kv span.k{display:block;font-size:.68rem;color:#64748b;font-weight:700;text-transform:uppercase;}' +
        '.mrh-pre{background:#0f172a;color:#e2e8f0;border-radius:10px;padding:.7rem;font-size:.72rem;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all;}' +
        '.mrh-sec{margin-top:.8rem;} .mrh-sec h5{margin:0 0 .3rem;font-size:.8rem;color:#334155;display:flex;align-items:center;gap:.5rem;}' +
        // the global bar (dates + instance for every tab) and the All-orders tab
        '.mri-global{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-end;background:linear-gradient(100deg,#0b2545,#13315c 60%,#1e3a8a);border-radius:12px;padding:.7rem 1rem;margin-bottom:.8rem;color:#fff;}' +
        '.mri-global label{display:flex;flex-direction:column;font-size:.68rem;font-weight:700;color:#cbd5e1;gap:.2rem;text-transform:uppercase;letter-spacing:.02em;}' +
        '.mri-global input,.mri-global select{border:1px solid #334155;border-radius:8px;padding:.4rem .5rem;font:inherit;font-size:.85rem;color:#0f172a;background:#fff;min-width:120px;}' +
        '.mri-global .mrh-quick button{border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;} .mri-global .mrh-quick button:hover{background:rgba(255,255,255,.25);}' +
        '.mri-global .mrh-btn.p{background:#fff;color:#1e3a8a;} .mri-global .gl-t{font-size:.72rem;color:#cbd5e1;margin-left:auto;align-self:center;}' +
        '.mri-global .gl-h{display:flex;align-items:center;gap:.5rem;font-weight:800;font-size:.85rem;align-self:center;margin-right:.4rem;}' +
        '.mrh-s.NONE{background:#fef3c7;color:#92400e;} .mrh-s.DONE{background:#dcfce7;color:#15803d;}' +
        '.mrh-t tr.mro-trip td{background:#eef2ff;border-top:2px solid #c7d2fe;font-size:.78rem;color:#1e293b;padding:.45rem .6rem;} .mrh-t tr.mro-trip:hover td{background:#e0e7ff;}' +
        '.mro-th{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;} .mro-th b{font-size:.85rem;} .mro-th .m{color:#475569;font-weight:600;} .mro-th .mrh-s{font-size:.64rem;}' +
        '.mro-th .mrh-btn.s{padding:.15rem .5rem;font-size:.68rem;} .mro-th .sp{flex:1;}' +
        '.mro-fl{display:inline-flex;gap:.2rem;} .mro-fl i{font-size:.6rem;font-weight:800;border-radius:4px;padding:.08rem .3rem;font-style:normal;background:#f1f5f9;color:#94a3b8;} .mro-fl i.y{background:#dcfce7;color:#15803d;}' +
        '.mro-note{font-size:.74rem;color:#64748b;margin-top:.4rem;} .mro-note b{color:#334155;}' +
        '.mrh-t td.odr b{font-size:.8rem;} .mrh-t .mro-st{font-size:.7rem;color:#475569;}' +
        '.mri-tabs button .sub{font-size:.68rem;background:#e0e7ff;color:#3730a3;border-radius:999px;padding:.05rem .45rem;margin-left:.25rem;}';

    function today(off) { var d = new Date(); d.setDate(d.getDate() + (off || 0)); return d.toISOString().slice(0, 10); }
    function filters() {
        if (!H.f) {
            var saved = {}; try { saved = JSON.parse(localStorage.getItem('mri.hist.f') || '{}') || {}; } catch (e) { saved = {}; }
            H.f = { from: today(-7), to: today(0), trip: '', status: saved.status || '', inst: saved.inst || curInstance(), q: '', latest: saved.latest !== false };
        }
        return H.f;
    }
    /** The global bar (dates, instance — every tab) and the history tab's own fields, as typed. */
    function readForm() {
        var f = filters(), g = function (id) { var e = document.getElementById(id); return e ? e : null; };
        if (g('mri-from')) { f.from = g('mri-from').value || today(-7); f.to = g('mri-to').value || today(0); f.inst = g('mri-inst').value; }
        if (g('mrh-trip')) { f.trip = g('mrh-trip').value.trim(); f.status = g('mrh-status').value; f.q = g('mrh-q').value.trim(); f.latest = g('mrh-latest').checked; }
        try { localStorage.setItem('mri.hist.f', JSON.stringify({ status: f.status, inst: f.inst, latest: f.latest })); } catch (e) { /* storage blocked */ }
        return f;
    }
    function ddmmyyyy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(iso || ''); }
    /** Any date the APIs send (YYYY-MM-DD…, DD-MM-YYYY, DD/MM/YYYY, else Date.parse) → YYYY-MM-DD, '' when unreadable. */
    function isoOf(v) {
        var t = String(v == null ? '' : v).trim(), m;
        if (!t) return '';
        if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return m[1] + '-' + m[2] + '-' + m[3];
        if ((m = /^(\d{2})[-\/](\d{2})[-\/](\d{4})/.exec(t))) return m[3] + '-' + m[2] + '-' + m[1];
        var d = new Date(t); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    }
    function isoDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : today(0); }

    /** The search: rows written in the date range (inclusive), optionally only the latest try per order. */
    function histSql(f, withTrip) {
        var w = ["s.created_date >= TO_DATE('" + isoDay(f.from) + "', 'YYYY-MM-DD')", "s.created_date < TO_DATE('" + isoDay(f.to) + "', 'YYYY-MM-DD') + 1"];
        if (f.inst) w.push('s.instance_name = ' + lit(f.inst));
        if (f.trip) w.push('s.trip_id = ' + lit(f.trip.replace(/[^0-9A-Za-z_\-]/g, '')));
        if (f.q) {
            var q = lit('%' + f.q.toUpperCase().replace(/[%_]/g, '') + '%');
            w.push('(UPPER(s.order_number) LIKE ' + q + ' OR UPPER(s.customer_name) LIKE ' + q + ' OR UPPER(s.customer_number) LIKE ' + q + ' OR UPPER(s.mra_interface_id) LIKE ' + q + ')');
        }
        var cols = 's.id, TO_CHAR(s.created_date, \'YYYY-MM-DD HH24:MI:SS\') AS created_at, s.instance_name, s.trip_id, s.order_number, s.header_id, s.order_type, ' +
            'TO_CHAR(s.order_date, \'YYYY-MM-DD\') AS order_date, s.customer_number, s.customer_name, s.order_amount, s.tax_amount, s.line_count, s.invoice_type, ' +
            's.mra_interface_id, s.mra_interface_status, s.failed_step, s.failed_reason, s.gateway_problem, s.http_status, s.fusion_updated, s.source, s.app_user, s.machine, s.duration_ms' +
            (withTrip ? ", (SELECT TO_CHAR(MAX(h.trip_date), 'YYYY-MM-DD') FROM wms_trip_header h WHERE TO_CHAR(h.trip_id) = s.trip_id) AS trip_date" : '');
        var inner = 'SELECT ' + cols + ', ROW_NUMBER() OVER (PARTITION BY s.instance_name, s.order_number ORDER BY s.created_date DESC, s.id DESC) AS rn, ' +
            'COUNT(*) OVER (PARTITION BY s.instance_name, s.order_number) AS tries FROM wms_mra_interface_status s WHERE ' + w.join(' AND ');
        var outer = [];
        if (f.latest) outer.push('rn = 1');
        if (f.status) outer.push('mra_interface_status = ' + lit(f.status));
        return 'SELECT * FROM (' + inner + ')' + (outer.length ? ' WHERE ' + outer.join(' AND ') : '') + ' ORDER BY created_at DESC FETCH FIRST ' + (MAX_ROWS + 1) + ' ROWS ONLY';
    }
    function search() {
        var f = filters();
        H.loading = true; H.error = null; render();
        return read(histSql(f, true), MAX_ROWS + 1)
            .catch(function () { return read(histSql(f, false), MAX_ROWS + 1); })      // no WMS_TRIP_HEADER: without the trip date
            .then(function (rows) {
                H.more = rows.length > MAX_ROWS; H.rows = rows.slice(0, MAX_ROWS); H.loaded = true;
                var keep = {}; H.rows.forEach(function (r) { if (H.sel[r.ID]) keep[r.ID] = 1; }); H.sel = keep;
            })
            .catch(function (e) {
                H.rows = []; H.loaded = true;
                H.error = /table or view does not exist|ORA-00942/i.test(e.message)
                    ? 'The table WMS_MRA_INTERFACE_STATUS does not exist yet — it is created by the first MRA run of an updated app (or run apex_sql/90_mra_interface_status.sql).'
                    : e.message;
            })
            .then(function () { H.loading = false; render(); });
    }
    function byId(id) { for (var i = 0; i < H.rows.length; i++) if (String(H.rows[i].ID) === String(id)) return H.rows[i]; return null; }
    function money(v) { var n = Number(v); return v == null || v === '' || isNaN(n) ? '' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    /** The text of every column of a row (plus the status label and the live step), lower-cased, for the bar's filter. */
    function hay(r) {
        if (!r.__hay) {
            var parts = [];
            Object.keys(r).forEach(function (k) { if (k.indexOf('__') === 0) return; var v = r[k]; if (v == null || typeof v === 'object') return; parts.push(String(v)); });
            parts.push(ST_LABEL[r.MRA_INTERFACE_STATUS] || '');
            r.__hay = parts.join(' \u0001 ').toLowerCase();
        }
        var live = H.live[r.ID];
        return r.__hay + (live ? ' ' + String(live.text || '').toLowerCase() + ' ' + String(live.msg || '').toLowerCase() : '');
    }
    function grepTokens() { return H.grep.trim().toLowerCase().split(/\s+/).filter(Boolean); }
    /** KPI tile filter, then the bar's text filter: every word typed must be in some column of the row. */
    function shown() {
        var tok = grepTokens();
        return H.rows.filter(function (r) {
            if (H.kpi && r.MRA_INTERFACE_STATUS !== H.kpi) return false;
            if (!tok.length) return true;
            var h = hay(r);
            return tok.every(function (t) { return h.indexOf(t) >= 0; });
        });
    }
    function kpiShown() { return H.rows.filter(function (r) { return !H.kpi || r.MRA_INTERFACE_STATUS === H.kpi; }); }

    function histHtml() {
        var f = filters(), rows = shown(), counts = {}, amount = 0;
        H.rows.forEach(function (r) { counts[r.MRA_INTERFACE_STATUS] = (counts[r.MRA_INTERFACE_STATUS] || 0) + 1; });
        rows.forEach(function (r) { amount += Number(r.ORDER_AMOUNT) || 0; });
        var nSel = Object.keys(H.sel).length, busyAny = Object.keys(H.busy).length > 0;
        var opt = function (v, t, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; };
        var html = '<div class="mrh-f" style="margin-top:.6rem;">' +
            '<label>Trip ID<input id="mrh-trip" placeholder="any" value="' + esc(f.trip) + '" style="min-width:90px;width:100px;"></label>' +
            '<label>MRA status<select id="mrh-status">' + opt('', 'All', f.status) + STATUS.map(function (x) { return opt(x, ST_LABEL[x], f.status); }).join('') + '</select></label>' +
            '<label>Order / customer / IRN<input id="mrh-q" placeholder="search" value="' + esc(f.q) + '"></label>' +
            '<label class="chk"><input type="checkbox" id="mrh-latest"' + (f.latest ? ' checked' : '') + '> Latest try per order only</label>' +
            '<button class="mrh-btn p" id="mrh-go"' + (H.loading ? ' disabled' : '') + '><i class="fas fa-' + (H.loading ? 'spinner fa-spin' : 'search') + '"></i> Search</button>' +
            '<span style="font-size:.72rem;color:#64748b;align-self:center;">Runs written between the dates of the bar above' + (f.inst ? ' on ' + esc(f.inst) : ' on every instance') + '.</span>' +
            '</div>';
        if (H.error) return html + '<div class="mri-err"><i class="fas fa-exclamation-triangle"></i> ' + esc(H.error) + '</div>';
        if (!H.loaded) return html + '<div class="mrh-tw"><div class="mrh-empty"><i class="fas fa-spinner fa-spin"></i> Reading…</div></div>';
        html += '<div class="mrh-kpi">' +
            '<div data-k="" class="' + (!H.kpi ? 'on' : '') + '"><b>' + H.rows.length + (H.more ? '+' : '') + '</b><span>' + (f.latest ? 'Orders' : 'Runs') + '</span></div>' +
            STATUS.map(function (x) { return '<div data-k="' + x + '" class="' + (H.kpi === x ? 'on' : '') + '"><b>' + (counts[x] || 0) + '</b><span class="mrh-s ' + x + '">' + ST_LABEL[x] + '</span></div>'; }).join('') +
            '<div style="cursor:default;"><b>' + money(amount) + '</b><span>Order amount shown</span></div></div>';
        html += '<div class="mrh-bar"><b>' + nSel + '</b> ticked' +
            '<button class="mrh-btn g s" onclick="MraInterface.retry()"' + (!nSel || busyAny ? ' disabled' : '') + '><i class="fas fa-paper-plane"></i> Interface to MRA</button>' +
            '<button class="mrh-btn b s" onclick="MraInterface.print()"' + (!nSel || busyAny ? ' disabled' : '') + '><i class="fas fa-print"></i> Print orders</button>' +
            '<button class="mrh-btn n s" id="mrh-failed"' + (busyAny ? ' disabled' : '') + '><i class="fas fa-check-double"></i> Tick failed</button>' +
            '<button class="mrh-btn n s" id="mrh-none"><i class="fas fa-xmark"></i> Clear</button>' +
            '<span class="mrh-grep" title="Filters the rows already shown — every word must be found in some column (order, customer, IRN, reason, source, user, type, amount, time …). Esc clears. The CSV takes the rows shown."><i class="fas fa-search"></i>' +
                '<input id="mrh-grep" placeholder="Filter the rows shown — any column" value="' + esc(H.grep) + '" autocomplete="off" spellcheck="false">' +
                '<button id="mrh-grep-x" title="Clear the filter"' + (H.grep ? '' : ' style="display:none;"') + '>✕</button></span>' +
            (grepTokens().length ? '<span class="mrh-grep-n">' + rows.length + ' of ' + kpiShown().length + ' match</span>' : '') +
            '<span style="margin-left:auto;"></span><button class="mrh-btn n s" onclick="MraInterface.csv()"><i class="fas fa-file-csv"></i> CSV</button></div>';
        if (H.more) html += '<div style="font-size:.75rem;color:#a16207;margin-top:.4rem;">Showing the newest ' + MAX_ROWS + ' — narrow the dates or add a trip to see the rest.</div>';
        if (!rows.length) return html + '<div class="mrh-tw"><div class="mrh-empty">' + (grepTokens().length ? 'No row shown matches <b>' + esc(H.grep.trim()) + '</b> — the words are looked for in every column. ✕ clears the filter.' : 'No MRA runs match these filters.') + '</div></div>';
        var all = rows.every(function (r) { return H.sel[r.ID]; });
        html += '<div class="mrh-tw"><table class="mrh-t"><thead><tr><th><input type="checkbox" id="mrh-all"' + (all ? ' checked' : '') + '></th><th></th>' +
            '<th>When</th><th>Inst</th><th>Trip</th><th>Order</th><th>Customer</th><th class="num">Amount</th><th>Type</th><th>Status</th><th>MRA IRN</th><th>Failed step / reason</th><th>Source</th></tr></thead><tbody>' +
            rows.map(function (r) {
                var live = H.live[r.ID], busy = H.busy[r.ID];
                var stc = live ? live.cls : r.MRA_INTERFACE_STATUS;
                var stl = live ? live.text : (ST_LABEL[r.MRA_INTERFACE_STATUS] || r.MRA_INTERFACE_STATUS || '');
                var why = (r.FAILED_STEP ? r.FAILED_STEP + ' · ' : '') + (r.FAILED_REASON || '') + (r.GATEWAY_PROBLEM ? ' [' + r.GATEWAY_PROBLEM + ']' : '') + (live && live.msg ? ' — ' + live.msg : ''); why = why.replace(/^ — /, '');
                var cust = (r.CUSTOMER_NAME || '') + (r.CUSTOMER_NUMBER ? ' (' + r.CUSTOMER_NUMBER + ')' : '');
                return '<tr class="' + (H.sel[r.ID] ? 'sel' : '') + '"><td><input type="checkbox" data-id="' + esc(r.ID) + '"' + (H.sel[r.ID] ? ' checked' : '') + '></td>' +
                    '<td><div class="mrh-act">' +
                        '<button class="mrh-btn g s" title="Interface to MRA again" onclick="MraInterface.retry([' + JSON.stringify(String(r.ID)).replace(/"/g, '&quot;') + '])"' + (busy ? ' disabled' : '') + '><i class="fas fa-paper-plane"></i></button>' +
                        '<button class="mrh-btn b s" title="Print order" onclick="MraInterface.print([' + JSON.stringify(String(r.ID)).replace(/"/g, '&quot;') + '])"' + (busy ? ' disabled' : '') + '><i class="fas fa-print"></i></button>' +
                        '<button class="mrh-btn n s" title="Details, MRA request and answer" onclick="MraInterface.details(' + JSON.stringify(String(r.ID)).replace(/"/g, '&quot;') + ')"><i class="fas fa-magnifying-glass"></i></button>' +
                    '</div></td>' +
                    '<td>' + esc(r.CREATED_AT) + (Number(r.TRIES) > 1 ? '<span class="sub" title="Runs of this order in the range">×' + esc(r.TRIES) + '</span>' : '') + '</td>' +
                    '<td>' + esc(r.INSTANCE_NAME) + '</td>' +
                    '<td title="' + esc(r.TRIP_DATE ? 'Trip date ' + r.TRIP_DATE : '') + '">' + esc(r.TRIP_ID || '') + '</td>' +
                    '<td title="' + esc(r.ORDER_TYPE || '') + '"><b>' + esc(r.ORDER_NUMBER) + '</b></td>' +
                    '<td class="cut" title="' + esc(cust + (r.ORDER_TYPE ? ' · ' + r.ORDER_TYPE : '')) + '">' + esc(cust) + '</td>' +
                    '<td class="num">' + money(r.ORDER_AMOUNT) + '</td><td>' + esc(r.INVOICE_TYPE || '') + '</td>' +
                    '<td><span class="mrh-s ' + esc(stc) + '">' + (busy ? '<i class="fas fa-spinner fa-spin"></i> ' : '') + esc(stl) + '</span></td>' +
                    '<td class="cut n" style="font-size:.72rem;" title="' + esc(r.MRA_INTERFACE_ID || '') + '">' + esc(r.MRA_INTERFACE_ID || '') + '</td>' +
                    '<td class="cut w' + (r.FAILED_REASON || r.GATEWAY_PROBLEM ? ' why' : '') + '" title="' + esc(why) + '">' + esc(why) + '</td>' +
                    '<td class="cut n mrh-src" title="' + esc((r.SOURCE || '') + ' · ' + (r.APP_USER || '')) + '">' + esc(r.SOURCE || '') + (r.APP_USER ? ' · ' + esc(r.APP_USER) : '') + '</td>' +
                    '</tr>';
            }).join('') + '</tbody></table></div>';
        return html;
    }
    function wireHist() {
        var g = function (id) { return document.getElementById(id); };
        if (g('mrh-go')) g('mrh-go').onclick = function () { readForm(); search(); };
        ['mrh-trip', 'mrh-q'].forEach(function (id) { if (g(id)) g(id).onkeydown = function (e) { if (e.key === 'Enter') { readForm(); search(); } }; });
        document.querySelectorAll('.mrh-kpi div[data-k]').forEach(function (d) { d.onclick = function () { H.kpi = d.getAttribute('data-k') || null; render(); }; });
        document.querySelectorAll('.mrh-t input[data-id]').forEach(function (c) { c.onchange = function () { var id = c.getAttribute('data-id'); if (c.checked) H.sel[id] = 1; else delete H.sel[id]; render(); }; });
        if (g('mrh-all')) g('mrh-all').onchange = function () { var on = g('mrh-all').checked; shown().forEach(function (r) { if (on) H.sel[r.ID] = 1; else delete H.sel[r.ID]; }); render(); };
        if (g('mrh-failed')) g('mrh-failed').onclick = function () { H.sel = {}; shown().forEach(function (r) { if (r.MRA_INTERFACE_STATUS === 'FAILED') H.sel[r.ID] = 1; }); render(); };
        if (g('mrh-none')) g('mrh-none').onclick = function () { H.sel = {}; render(); };
        // the bar's filter: the whole history re-renders, so the box gets its focus and caret back
        var gi = g('mrh-grep'), gt = null;
        if (gi) {
            var regrep = function () {
                var el = g('mrh-grep'), v = el ? el.value : H.grep, pos = el ? el.selectionStart : v.length;
                H.grep = v; render();
                var n = g('mrh-grep'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ } }
            };
            gi.oninput = function () { clearTimeout(gt); gt = setTimeout(regrep, H.rows.length > 300 ? 150 : 40); };
            gi.onkeydown = function (e) { if (e.key === 'Escape') { gi.value = ''; clearTimeout(gt); regrep(); } };
            if (g('mrh-grep-x')) g('mrh-grep-x').onclick = function () { H.grep = ''; render(); var n = g('mrh-grep'); if (n) n.focus(); };
        }
    }
    function picked(ids) {
        var list = (ids && ids.length ? ids : Object.keys(H.sel)).map(byId).filter(Boolean), seen = {};
        return list.filter(function (r) { var k = r.INSTANCE_NAME + '|' + r.ORDER_NUMBER; if (seen[k]) return false; seen[k] = 1; return true; });
    }

    // ── Interface to MRA again — the same C# MRAProcessor as every other screen (its first step checks MRA
    //    already has the order, so nothing is sent twice). The run writes its own new row to the history. ──
    var credsP = null;
    function fusionCreds() {
        if (credsP) return credsP;
        credsP = new Promise(function (resolve, reject) {
            sendMessageToCSharp({ action: 'executeGet', fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/ARMODULE/fusion' }, function (err, data) {
                if (err) { reject(new Error(String(err))); return; }
                try {
                    var d = typeof data === 'string' ? JSON.parse(data) : data, it = d && d.items && d.items[0];
                    if (!it || !it.username) { reject(new Error('No Fusion credentials found (ARMODULE/fusion).')); return; }
                    resolve({ username: it.username, password: it.password1 || '' });
                } catch (e) { reject(e); }
            });
        });
        credsP.catch(function () { credsP = null; });
        return credsP;
    }
    /** One order through MRAProcessor; onStep(text) gets the live steps. */
    function mraOne(r, c, batch, onStep, source) {
        return new Promise(function (resolve) {
            var rid = 'mrh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), timer = null;
            function done(x) { clearTimeout(timer); window.chrome.webview.removeEventListener('message', h); resolve(x); }
            function h(ev) {
                var d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
                if (!d || d.requestId !== rid) return;
                if (d.action === 'mraProcessingProgress') { if (onStep) onStep(d.message || d.step || ''); return; }
                if (d.action === 'error') { done({ st: 'FAILED', msg: d.message || 'MRA processing error' }); return; }
                if (d.action !== 'processMRAInterfaceResponse') return;
                if (d.success) done({ st: 'SUCCESS', msg: 'IRN ' + (d.irnCode || '') });
                else if (d.skipped) done({ st: 'SKIPPED', msg: d.message || 'Order type not interfaced to MRA' });
                else if (/already done/i.test(d.message || '')) done({ st: 'ALREADY_DONE', msg: d.message });
                else done({ st: 'FAILED', msg: d.message || 'MRA interface failed', gw: d.gatewayProblem || null });
            }
            window.chrome.webview.addEventListener('message', h);
            timer = setTimeout(function () { done({ st: 'FAILED', msg: 'No answer within 3 minutes' }); }, 180000);
            window.chrome.webview.postMessage({ action: 'processMRAInterface', requestId: rid, orderNumber: r.ORDER_NUMBER, fusionUsername: c.username, fusionPassword: c.password,
                instance: r.INSTANCE_NAME || 'PROD', batchId: batch, source: source || 'WMS_MRA_HISTORY', tripId: r.TRIP_ID ? String(r.TRIP_ID) : undefined, appUser: appUser() });
        });
    }
    function idOf(r) { return r.ID; }
    /** Interface to MRA — one runner for both tabs: S = that tab's state ({live, busy} maps keyed by keyOf(r)), the rows
        carry ORDER_NUMBER / INSTANCE_NAME / TRIP_ID / MRA_INTERFACE_STATUS; after() runs 1.5 s after the last order
        (the history reads its new rows, All orders reads the statuses again). Orders that already reached MRA are
        never sent again (the grid's status, then the status table, then the processor's own check). */
    function mraRun(list, S, keyOf, after, source) {
        if (!list.length) return;
        if (!window.chrome || !window.chrome.webview) { notify('Open this page inside the Gray\'s WMS app.', 'error'); return; }
        var off = list.filter(function (r) { var fl = st.flags[r.INSTANCE_NAME]; return fl && String(fl.INTERFACE_FLAG).toUpperCase() === 'N'; });
        var isDone = function (r) { return r.MRA_INTERFACE_STATUS === 'SUCCESS' || r.MRA_INTERFACE_STATUS === 'ALREADY_DONE'; };
        var done = list.filter(isDone), send = list.filter(function (r) { return !isDone(r); });
        if (!send.length) { notify('Every ticked order already reached MRA — nothing is sent twice.', 'info'); return; }
        var msg = 'Interface ' + send.length + ' order(s) to MRA?' +
            (done.length ? '\n\n' + done.length + ' already reached MRA — not sent again.' : '') +
            (off.length ? '\n\nNote: the MRA switch is OFF for ' + off.map(function (r) { return r.INSTANCE_NAME; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + ' (Setup tab). This sends them anyway.' : '');
        if (!window.confirm(msg)) return;
        done.forEach(function (r) { S.live[keyOf(r)] = { cls: 'ALREADY_DONE', text: 'Already in MRA', msg: 'not sent again' }; });
        send.forEach(function (r) { S.busy[keyOf(r)] = 1; S.live[keyOf(r)] = { cls: 'RUN', text: 'Checking the MRA status table' }; });
        render();
        var batch = 'mrh_' + Date.now(), queue = [], gwStreak = 0, stop = null, res = { SUCCESS: 0, FAILED: 0, SKIPPED: 0, ALREADY_DONE: done.length, NOT_SENT: 0 };
        // the status table first (every PC, every screen): the grid may show an older try of an order that reached MRA since
        var byInst = {}; send.forEach(function (r) { (byInst[r.INSTANCE_NAME || ''] = byInst[r.INSTANCE_NAME || ''] || []).push(r); });
        var pre = typeof window.wmsMraDone !== 'function' ? Promise.resolve() : Promise.all(Object.keys(byInst).map(function (inst) {
            return window.wmsMraDone(byInst[inst].map(function (r) { return r.ORDER_NUMBER; }), inst).catch(function () { return {}; })
                .then(function (d) { byInst[inst].forEach(function (r) { var x = d[String(r.ORDER_NUMBER).trim()]; if (x) r.__done = x; }); });
        }));
        pre.then(function () {
            send.forEach(function (r) {
                var k = keyOf(r);
                if (r.__done) {
                    delete S.busy[k]; res.ALREADY_DONE++;
                    S.live[k] = { cls: 'ALREADY_DONE', text: 'Already in MRA', msg: 'not sent again' + (r.__done.irn ? ' · IRN ' + r.__done.irn : '') + (r.__done.at ? ' · ' + r.__done.at : '') };
                    delete r.__done;
                } else { queue.push(r); S.live[k] = { cls: 'RUN', text: 'Waiting' }; }
            });
            render();
            if (!queue.length) return;
            return fusionCreds().then(function (c) {
                function next() {
                    var r = queue.shift(); if (!r) return Promise.resolve();
                    var k = keyOf(r);
                    if (stop) { res.NOT_SENT++; S.live[k] = { cls: 'FAILED', text: 'Not sent', msg: stop }; delete S.busy[k]; render(); return next(); }
                    S.live[k] = { cls: 'RUN', text: 'Running' }; render();
                    return mraOne(r, c, batch, function (step) { S.live[k] = { cls: 'RUN', text: 'Running', msg: step }; render(); }, source).then(function (x) {
                        res[x.st] = (res[x.st] || 0) + 1;
                        if (x.gw) gwStreak++; else gwStreak = 0;
                        if (gwStreak >= 2) stop = 'the MRA gateway did not answer twice in a row — stopped; nothing was sent for this order, safe to retry later.';
                        S.live[k] = { cls: x.st, text: ST_LABEL[x.st] || x.st, msg: x.msg }; delete S.busy[k]; render();
                        return next();
                    });
                }
                return Promise.all([next(), next(), next()]);      // 3 at a time
            });
        }).catch(function (e) {
            list.forEach(function (r) { var k = keyOf(r); if (S.busy[k]) { delete S.busy[k]; S.live[k] = { cls: 'FAILED', text: 'Not sent', msg: e.message }; } });
            notify('MRA: ' + e.message, 'error');
        }).then(function () {
            render();
            notify('MRA: ' + res.SUCCESS + ' interfaced, ' + res.ALREADY_DONE + ' already done, ' + res.SKIPPED + ' skipped, ' + res.FAILED + ' failed' + (res.NOT_SENT ? ', ' + res.NOT_SENT + ' not sent' : '') + '.', res.FAILED || res.NOT_SENT ? 'warning' : 'success');
            setTimeout(function () { S.live = {}; after(); }, 1500);    // the new rows the runs wrote
        });
    }
    function retry(ids) { mraRun(picked(ids), H, idOf, search, 'WMS_MRA_HISTORY'); }

    // ── Print — the Shipping Agent's print: Fusion PDF (SOAP) → saved + print job row → PDF / printer choice ──
    function printRun(list, S, keyOf) {
        if (!list.length) return;
        if (typeof window.saPrintOrder !== 'function') { notify('Printing needs the Shipping Agent script (shipping-agent.js).', 'error'); return; }
        var notCleared = list.filter(function (r) { return r.MRA_INTERFACE_STATUS === 'FAILED'; });
        if (notCleared.length && !window.confirm(notCleared.length + ' of these order(s) FAILED at MRA (not fiscalised). Print anyway?')) return;
        var single = list.length === 1, n = 0, bad = 0;
        var back = function (r, msg) { var s0 = r.MRA_INTERFACE_STATUS; return { cls: s0 || 'NONE', text: s0 ? (ST_LABEL[s0] || s0) : 'Not interfaced', msg: msg }; };
        list.forEach(function (r) { S.busy[keyOf(r)] = 1; }); render();
        list.reduce(function (p, r) {
            return p.then(function () {
                var k = keyOf(r);
                S.live[k] = { cls: 'RUN', text: 'Printing' }; render();
                return Promise.resolve(window.saPrintOrder(r.ORDER_NUMBER, r.TRIP_ID || '', r.TRIP_DATE || today(0), r.INSTANCE_NAME || 'PROD', !single))
                    .then(function () { n++; S.live[k] = back(r, 'Printed / PDF downloaded'); })
                    .catch(function (e) { bad++; S.live[k] = back(r, 'Print failed: ' + e.message); })
                    .then(function () { delete S.busy[k]; render(); });
            });
        }, Promise.resolve()).then(function () {
            if (!single) notify('Print: ' + n + ' sent' + (bad ? ', ' + bad + ' failed' : '') + '.', bad ? 'warning' : 'success');
        });
    }
    function printOrders(ids) { printRun(picked(ids), H, idOf); }

    // ── All orders — every sales order on the trips of the dates, one row per order, with its MRA status ──────
    var O = { loaded: false, loading: false, error: null, step: '', trips: [], rows: [], sel: {}, busy: {}, live: {}, kpi: null, grep: '', hidden: { store: 0, cancelled: 0 }, statusErr: '', at: '' };
    var O_KIND = ['DONE', 'FAILED', 'SKIPPED', 'NONE'];
    var O_LABEL = { DONE: 'Interfaced', FAILED: 'Failed', SKIPPED: 'Skipped', NONE: 'Not interfaced' };
    var STORE = /store\s*to\s*van|van\s*to\s*store|^s2v$|^v2s$/i;
    var WM_BASE = AI_BASE.replace(/\/ai$/, '');
    var enc = encodeURIComponent;
    function getJson(url) {
        return new Promise(function (resolve, reject) {
            if (typeof sendMessageToCSharp !== 'function') { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, function (err, data) {
                if (err) { reject(new Error(String(err))); return; }
                var d = data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
                resolve(d);
            }, 120000, false);
        });
    }
    function items(r) { return Array.isArray(r) ? r : (r && Array.isArray(r.items)) ? r.items : []; }
    function pick(row, names) {
        if (!row) return '';
        var keys = Object.keys(row);
        for (var i = 0; i < names.length; i++) { var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); }); if (k && row[k] != null && row[k] !== '') return row[k]; }
        return '';
    }
    function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
    function yes(v) { v = String(v == null ? '' : v).trim().toUpperCase(); return v === 'Y' || v === 'YES' || v === 'TRUE' || v === '1' || /^(PRINTED|DONE|SUCCESS|COMPLETE|RELEASED|CONFIRMED|PICKED|SHIPPED)/.test(v); }
    function orderOf(r) { return String(pick(r, ['ORDER_NUMBER', 'order_number', 'SOURCE_ORDER_NUMBER']) || '').trim(); }
    /** n at a time; a failing item never stops the others (fn handles its own errors). */
    function pool(list, n, fn) {
        var i = 0;
        var next = function () { if (i >= list.length) return Promise.resolve(); var idx = i++; return Promise.resolve().then(function () { return fn(list[idx]); }).catch(function () {}).then(next); };
        var w = []; for (var k = 0; k < Math.min(n, list.length); k++) w.push(next());
        return Promise.all(w);
    }
    function keyOfO(r) { return r.KEY; }
    function oClass(r) { var x = r.MRA_INTERFACE_STATUS; return x === 'SUCCESS' || x === 'ALREADY_DONE' ? 'DONE' : x === 'FAILED' ? 'FAILED' : x === 'SKIPPED' ? 'SKIPPED' : 'NONE'; }
    function oById(key) { for (var i = 0; i < O.rows.length; i++) if (O.rows[i].KEY === key) return O.rows[i]; return null; }
    function oPicked(keys) { return (keys && keys.length ? keys : Object.keys(O.sel)).map(oById).filter(Boolean); }

    /** The trips of the date range on one instance (GETTRIPDETAILS: one row per trip × …; the date as the API sends it). */
    function tripsOf(inst, from, to) {
        var p = new URLSearchParams({ P_DATE_FROM: ddmmyyyy(from), P_DATE_TO: ddmmyyyy(to), P_INSTANCE_NAME: inst });
        return getJson(WM_BASE + '/GETTRIPDETAILS?' + p.toString()).then(function (r) {
            var map = {}, list = [];
            items(r).forEach(function (t) {
                var ti = String(pick(t, ['INSTANCE_NAME', 'instance_name']) || '').toUpperCase(); if (ti && ti !== inst) return;
                var id = String(pick(t, ['TRIP_ID', 'trip_id']) || '').trim(); if (!id || map[id]) return;
                map[id] = { inst: inst, trip_id: id, date: isoOf(pick(t, ['TRIP_DATE', 'trip_date'])), lorry: pick(t, ['TRIP_LORRY', 'trip_lorry', 'LORRY_NUMBER', 'lorry_number']) || '',
                    bay: pick(t, ['TRIP_LOADING_BAY', 'trip_loading_bay', 'LOADING_BAY', 'loading_bay']) || '', priority: pick(t, ['TRIP_PRIORITY', 'trip_priority', 'PRIORITY', 'priority']) || '', orders: [], error: '' };
                list.push(map[id]);
            });
            return list.sort(function (a, b) { return num(a.trip_id) - num(b.trip_id); });
        });
    }
    function ordersOf(inst, trip) { return getJson(WM_BASE + '/GETTRIPDETAILS/' + enc(trip) + '?P_INSTANCE_NAME=' + enc(inst)).then(items); }
    /** {order: {s, irn, why, at, n}} — the latest WMS_MRA_INTERFACE_STATUS row per order on the instance (every PC, every screen); chunks of 300; a missing table = none. */
    function mraStatuses(orders, inst) {
        var list = Array.from(new Set(orders.map(function (o) { return String(o || '').trim(); }).filter(Boolean))), out = {}, chunks = [];
        var last = function (c) { return 'MAX(' + c + ') KEEP (DENSE_RANK LAST ORDER BY created_date, id)'; };
        for (var i = 0; i < list.length; i += 300) chunks.push(list.slice(i, i + 300));
        return chunks.reduce(function (p, c) {
            return p.then(function () {
                return read('SELECT TRIM(order_number) AS o, ' + last('mra_interface_status') + ' AS s, ' + last('mra_interface_id') + ' AS irn, ' + last('SUBSTR(failed_reason, 1, 300)') + ' AS why, ' +
                    "TO_CHAR(MAX(created_date), 'YYYY-MM-DD HH24:MI') AS at, COUNT(*) AS n FROM wms_mra_interface_status WHERE TRIM(order_number) IN (" + c.map(lit).join(', ') + ') AND UPPER(instance_name) = ' + lit(inst) + ' GROUP BY TRIM(order_number)', 5000)
                    .then(function (rows) { rows.forEach(function (r) { out[String(r.O).trim()] = { s: String(r.S || '').toUpperCase(), irn: r.IRN || '', why: r.WHY || '', at: r.AT || '', n: Number(r.N) || 0 }; }); });
            });
        }, Promise.resolve()).then(function () { return out; }, function (e) {
            if (/ORA-00942|does not exist/i.test(String(e && e.message || e))) return out;   // table not created yet: no runs
            throw e;
        });
    }
    function applyStatus(r, x) { r.MRA_INTERFACE_STATUS = x ? x.s : ''; r.MRA_INTERFACE_ID = x ? x.irn : ''; r.MRA_WHY = x ? x.why : ''; r.MRA_AT = x ? x.at : ''; r.TRIES = x ? x.n : 0; }
    /** The MRA statuses of the rows read again (after a run; the trips stay as they are). */
    function refreshMra() {
        var byInst = {}; O.rows.forEach(function (r) { (byInst[r.INSTANCE_NAME] = byInst[r.INSTANCE_NAME] || []).push(r); });
        O.statusErr = '';
        return Promise.all(Object.keys(byInst).map(function (inst) {
            return mraStatuses(byInst[inst].map(function (r) { return r.ORDER_NUMBER; }), inst)
                .then(function (m) { byInst[inst].forEach(function (r) { applyStatus(r, m[r.ORDER_NUMBER]); }); }, function (e) { O.statusErr = e.message; });
        })).then(function () { O.rows.forEach(function (r) { delete r.__hay; }); render(); });
    }
    /** The whole picture: trips of the dates → every trip's orders (4 trips at a time) → sales orders only → the MRA status per order. */
    function loadOrders() {
        var f = filters(), insts = f.inst ? [f.inst] : INSTANCES.slice();
        O.loading = true; O.error = null; O.statusErr = ''; O.step = 'reading the trips of ' + insts.join(' / '); render();
        var trips = [], rows = [], hidden = { store: 0, cancelled: 0 };
        return insts.reduce(function (p, inst) { return p.then(function () { return tripsOf(inst, f.from, f.to).then(function (t) { trips = trips.concat(t); }); }); }, Promise.resolve())
            .then(function () {
                var n = 0;
                return pool(trips, 4, function (t) {
                    return ordersOf(t.inst, t.trip_id).then(function (list) {
                        list.forEach(function (r) {
                            var o = orderOf(r); if (!o) return;
                            var type = String(pick(r, ['ORDER_TYPE', 'order_type', 'ORDER_TYPE_CODE']) || '').trim();
                            if (STORE.test(type) || /^(S2V|V2S)[-_\s]/i.test(o)) { hidden.store++; return; }   // store / van transactions (type, or the S2V- / V2S- number) are never invoiced to MRA
                            var ls = String(pick(r, ['LINE_STATUS', 'line_status', 'STATUS']) || '').trim();
                            if (/^cancel/i.test(ls)) { hidden.cancelled++; return; }
                            var picked_ = yes(pick(r, ['PICK_CONFIRM_ST', 'pick_confirm_st'])), shipped = yes(pick(r, ['SHIP_CONFIRM_ST', 'ship_confirm_st']));
                            var closed = /closed|interfac|billing|billed|invoic|shipped/i.test(ls);
                            var released = picked_ || shipped || closed || yes(pick(r, ['PICK_RELEASE_STATUS', 'pick_release_status'])) || num(pick(r, ['picks_count', 'PICKS_COUNT'])) > 0 ||
                                num(pick(r, ['lot_count', 'LOT_COUNT'])) > 0 || !!pick(r, ['PICK_SLIP_NO', 'pick_slip_no', 'RELEASE_DATE', 'release_date']);
                            var pr = String(pick(r, ['PRINTING_ST', 'printing_st']) || '');
                            var row = { KEY: t.inst + '|' + o, INSTANCE_NAME: t.inst, TRIP_ID: t.trip_id, TRIP_DATE: t.date || isoOf(pick(r, ['TRIP_DATE', 'trip_date'])), LORRY: t.lorry, BAY: t.bay, PRIORITY: t.priority,
                                ORDER_NUMBER: o, CUSTOMER_NAME: String(pick(r, ['ACCOUNT_NAME', 'account_name', 'CUSTOMER_NAME', 'customer_name']) || ''), CUSTOMER_NUMBER: String(pick(r, ['ACCOUNT_NUMBER', 'account_number', 'CUSTOMER_NUMBER']) || ''),
                                ORDER_TYPE: type, LINE_STATUS: ls, PICKER: String(pick(r, ['picker', 'PICKER', 'PICKER_NAME', 'picker_name']) || ''), RELEASED: released, PICKED: picked_, SHIPPED: shipped || closed, PRINTING_ST: pr, PRINTED: yes(pr),
                                AMOUNT: pick(r, ['ORDER_AMOUNT', 'order_amount', 'TOTAL_AMOUNT', 'AMOUNT']), MRA_INTERFACE_STATUS: '', MRA_INTERFACE_ID: '', MRA_WHY: '', MRA_AT: '', TRIES: 0 };
                            if (!t.date) t.date = row.TRIP_DATE;
                            t.orders.push(row); rows.push(row);
                        });
                    }, function (e) { t.error = e.message; }).then(function () { n++; O.step = 'trip ' + n + ' of ' + trips.length + ' · ' + rows.length + ' orders'; render(); });
                });
            }).then(function () {
                O.step = 'MRA status of ' + rows.length + ' orders'; render();
                var byInst = {}; rows.forEach(function (r) { (byInst[r.INSTANCE_NAME] = byInst[r.INSTANCE_NAME] || []).push(r); });
                return Promise.all(Object.keys(byInst).map(function (inst) {
                    return mraStatuses(byInst[inst].map(function (r) { return r.ORDER_NUMBER; }), inst)
                        .then(function (m) { byInst[inst].forEach(function (r) { applyStatus(r, m[r.ORDER_NUMBER]); }); }, function (e) { O.statusErr = e.message; });
                }));
            }).then(function () {
                trips.sort(function (a, b) { return a.inst < b.inst ? -1 : a.inst > b.inst ? 1 : (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : num(a.trip_id) - num(b.trip_id); });
                O.trips = trips; O.rows = rows; O.hidden = hidden; O.loaded = true; O.at = new Date().toLocaleTimeString();
                var keep = {}; rows.forEach(function (r) { if (O.sel[r.KEY]) keep[r.KEY] = 1; }); O.sel = keep;
            }).catch(function (e) { O.error = e.message; O.rows = []; O.trips = []; O.loaded = true; })
            .then(function () { O.loading = false; O.step = ''; render(); });
    }
    function hayO(r) {
        if (!r.__hay) {
            var parts = [];
            Object.keys(r).forEach(function (k) { if (k.indexOf('__') === 0 || k === 'KEY') return; var v = r[k]; if (v == null || typeof v === 'object') return; parts.push(String(v)); });
            parts.push(O_LABEL[oClass(r)], r.PRINTED ? 'printed' : 'not printed', r.RELEASED ? 'released' : 'not released');
            r.__hay = parts.join(' \u0001 ').toLowerCase();
        }
        var live = O.live[r.KEY];
        return r.__hay + (live ? ' ' + String(live.text || '').toLowerCase() + ' ' + String(live.msg || '').toLowerCase() : '');
    }
    function oTokens() { return O.grep.trim().toLowerCase().split(/\s+/).filter(Boolean); }
    function oKpiMatch(r) { return !O.kpi || (O.kpi === 'PRINTED' ? r.PRINTED : O.kpi === 'NOTPRINTED' ? !r.PRINTED : oClass(r) === O.kpi); }
    function oShown() { var tok = oTokens(); return O.rows.filter(function (r) { if (!oKpiMatch(r)) return false; if (!tok.length) return true; var h = hayO(r); return tok.every(function (t) { return h.indexOf(t) >= 0; }); }); }
    function oNotDone(r) { var c = oClass(r); return c === 'NONE' || c === 'FAILED'; }
    function jsArg(v) { return JSON.stringify(String(v)).replace(/"/g, '&quot;'); }
    function dayName(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return iso || '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return (diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]) + ' ' + m[3] + '-' + m[2] + '-' + m[1];
    }
    function ordersHtml() {
        var f = filters();
        if (O.error) return '<div class="mri-err"><i class="fas fa-exclamation-triangle"></i> ' + esc(O.error) + '</div>';
        if (!O.loaded || (O.loading && !O.rows.length)) return '<div class="mrh-tw"><div class="mrh-empty"><i class="fas fa-spinner fa-spin"></i> ' + esc(O.step || 'Reading…') + '</div></div>';
        var rows = oShown(), counts = { DONE: 0, FAILED: 0, SKIPPED: 0, NONE: 0, PRINTED: 0 }, amount = 0;
        O.rows.forEach(function (r) { counts[oClass(r)]++; if (r.PRINTED) counts.PRINTED++; });
        rows.forEach(function (r) { amount += num(r.AMOUNT); });
        var nSel = Object.keys(O.sel).length, busyAny = Object.keys(O.busy).length > 0;
        var kpi = function (k, n, label, cls) { return '<div data-ok="' + k + '" class="' + (O.kpi === k ? 'on' : '') + '"><b>' + n + '</b>' + (cls ? '<span class="mrh-s ' + cls + '">' + label + '</span>' : '<span>' + label + '</span>') + '</div>'; };
        var html = '<div class="mrh-kpi">' +
            '<div style="cursor:default;"><b>' + O.trips.length + '</b><span>Trips</span></div>' +
            kpi('', O.rows.length, 'Sales orders') + kpi('DONE', counts.DONE, 'Interfaced', 'DONE') + kpi('FAILED', counts.FAILED, 'Failed', 'FAILED') + kpi('SKIPPED', counts.SKIPPED, 'Skipped', 'SKIPPED') +
            kpi('NONE', counts.NONE, 'Not interfaced', 'NONE') + kpi('PRINTED', counts.PRINTED, 'Printed') + kpi('NOTPRINTED', O.rows.length - counts.PRINTED, 'Not printed') +
            (amount ? '<div style="cursor:default;"><b>' + money(amount) + '</b><span>Order amount shown</span></div>' : '') + '</div>';
        html += '<div class="mro-note">' + (O.loading ? '<i class="fas fa-spinner fa-spin"></i> ' + esc(O.step) + ' · ' : '') + 'Trips of <b>' + esc(ddmmyyyy(f.from)) + '</b> to <b>' + esc(ddmmyyyy(f.to)) + '</b> on <b>' + esc(f.inst || 'PROD + TEST') + '</b>' +
            (O.at ? ' · read at ' + esc(O.at) : '') + (O.hidden.store ? ' · ' + O.hidden.store + ' store / van transaction(s) left out' : '') + (O.hidden.cancelled ? ' · ' + O.hidden.cancelled + ' cancelled line(s) left out' : '') +
            (O.statusErr ? ' · <span style="color:#b91c1c;">MRA status not read: ' + esc(O.statusErr) + '</span>' : '') + '</div>';
        html += '<div class="mrh-bar"><b>' + nSel + '</b> ticked' +
            '<button class="mrh-btn g s" onclick="MraInterface.oRetry()"' + (!nSel || busyAny ? ' disabled' : '') + '><i class="fas fa-paper-plane"></i> Interface to MRA</button>' +
            '<button class="mrh-btn b s" onclick="MraInterface.oPrint()"' + (!nSel || busyAny ? ' disabled' : '') + '><i class="fas fa-print"></i> Print orders</button>' +
            '<button class="mrh-btn n s" id="mro-notdone"' + (busyAny ? ' disabled' : '') + ' title="Tick the orders shown that are not interfaced yet or failed"><i class="fas fa-check-double"></i> Tick not done</button>' +
            '<button class="mrh-btn n s" id="mro-failed"' + (busyAny ? ' disabled' : '') + '><i class="fas fa-triangle-exclamation"></i> Tick failed</button>' +
            '<button class="mrh-btn n s" id="mro-none"><i class="fas fa-xmark"></i> Clear</button>' +
            '<span class="mrh-grep" title="Filters the rows shown — every word must be found in some column (trip, lorry, order, customer, type, status, IRN, reason …). Esc clears. The CSV takes the rows shown."><i class="fas fa-search"></i>' +
                '<input id="mro-grep" placeholder="Filter the rows shown — any column" value="' + esc(O.grep) + '" autocomplete="off" spellcheck="false">' +
                '<button id="mro-grep-x" title="Clear the filter"' + (O.grep ? '' : ' style="display:none;"') + '>✕</button></span>' +
            (oTokens().length ? '<span class="mrh-grep-n">' + rows.length + ' of ' + O.rows.filter(oKpiMatch).length + ' match</span>' : '') +
            '<span style="margin-left:auto;"></span><button class="mrh-btn n s" onclick="MraInterface.oCsv()"><i class="fas fa-file-csv"></i> CSV</button></div>';
        if (!O.trips.length) return html + '<div class="mrh-tw"><div class="mrh-empty">No trips between these dates on ' + esc(f.inst || 'PROD / TEST') + '.</div></div>';
        if (!rows.length) return html + '<div class="mrh-tw"><div class="mrh-empty">' + (oTokens().length ? 'No row shown matches <b>' + esc(O.grep.trim()) + '</b>.' : O.kpi ? 'No order of this kind.' : 'The trips hold no sales orders.') + '</div></div>';
        var all = rows.every(function (r) { return O.sel[r.KEY]; });
        var fl = function (on, t, title) { return '<i class="' + (on ? 'y' : '') + '" title="' + esc(title) + '">' + t + '</i>'; };
        html += '<div class="mrh-tw"><table class="mrh-t"><thead><tr><th><input type="checkbox" id="mro-all"' + (all ? ' checked' : '') + '></th><th></th>' +
            '<th>Order</th><th>Customer</th><th>Type</th><th>Line status</th><th title="Released · Picked · Shipped">Stage</th><th>Printed</th><th>MRA status</th><th>MRA IRN</th><th>Last try</th><th>Failed reason</th></tr></thead><tbody>';
        var byTrip = {}; rows.forEach(function (r) { (byTrip[r.INSTANCE_NAME + '|' + r.TRIP_ID] = byTrip[r.INSTANCE_NAME + '|' + r.TRIP_ID] || []).push(r); });
        O.trips.forEach(function (t) {
            var tk = t.inst + '|' + t.trip_id, list = byTrip[tk]; if (!list) return;
            var c = { DONE: 0, FAILED: 0, SKIPPED: 0, NONE: 0 }, nd = 0; t.orders.forEach(function (r) { c[oClass(r)]++; if (oNotDone(r)) nd++; });
            var tAll = list.every(function (r) { return O.sel[r.KEY]; });
            html += '<tr class="mro-trip"><td><input type="checkbox" data-trip="' + esc(tk) + '"' + (tAll ? ' checked' : '') + ' title="Tick every order of this trip shown"></td><td colspan="11"><div class="mro-th">' +
                '<b><i class="fas fa-truck" style="color:#4f46e5;"></i> Trip ' + esc(t.trip_id) + '</b><span class="m">' + esc(dayName(t.date)) + '</span>' + (f.inst ? '' : '<span class="m">' + esc(t.inst) + '</span>') +
                (t.lorry ? '<span class="m" title="Lorry">' + esc(t.lorry) + '</span>' : '') + (t.bay ? '<span class="m" title="Loading bay">Bay ' + esc(t.bay) + '</span>' : '') + (t.priority ? '<span class="m" title="Priority">' + esc(t.priority) + '</span>' : '') +
                '<span class="m">' + t.orders.length + ' order' + (t.orders.length === 1 ? '' : 's') + '</span>' +
                '<span class="mrh-s DONE">' + c.DONE + ' interfaced</span>' + (c.FAILED ? '<span class="mrh-s FAILED">' + c.FAILED + ' failed</span>' : '') + (c.SKIPPED ? '<span class="mrh-s SKIPPED">' + c.SKIPPED + ' skipped</span>' : '') + (c.NONE ? '<span class="mrh-s NONE">' + c.NONE + ' not interfaced</span>' : '') +
                (t.error ? '<span class="why">' + esc(t.error) + '</span>' : '') + '<span class="sp"></span>' +
                '<button class="mrh-btn g s" onclick="MraInterface.oTrip(' + jsArg(tk) + ', \'mra\')"' + (!nd || busyAny ? ' disabled' : '') + ' title="Interface every order of this trip that is not interfaced yet or failed"><i class="fas fa-paper-plane"></i> Interface ' + nd + ' not done</button>' +
                '<button class="mrh-btn b s" onclick="MraInterface.oTrip(' + jsArg(tk) + ', \'print\')"' + (busyAny ? ' disabled' : '') + ' title="Print every order of this trip"><i class="fas fa-print"></i> Print ' + t.orders.length + '</button>' +
                '</div></td></tr>';
            list.forEach(function (r) {
                var live = O.live[r.KEY], busy = O.busy[r.KEY], cls = oClass(r);
                var stc = live ? live.cls : cls, stl = live ? live.text : O_LABEL[cls] + (r.MRA_INTERFACE_STATUS === 'ALREADY_DONE' ? ' (already done)' : '');
                var why = (r.MRA_WHY || '') + (live && live.msg ? (r.MRA_WHY ? ' — ' : '') + live.msg : '');
                html += '<tr class="' + (O.sel[r.KEY] ? 'sel' : '') + '"><td><input type="checkbox" data-key="' + esc(r.KEY) + '"' + (O.sel[r.KEY] ? ' checked' : '') + '></td>' +
                    '<td><div class="mrh-act">' +
                        '<button class="mrh-btn g s" title="Interface to MRA" onclick="MraInterface.oRetry([' + jsArg(r.KEY) + '])"' + (busy || cls === 'DONE' ? ' disabled' : '') + '><i class="fas fa-paper-plane"></i></button>' +
                        '<button class="mrh-btn b s" title="Print order" onclick="MraInterface.oPrint([' + jsArg(r.KEY) + '])"' + (busy ? ' disabled' : '') + '><i class="fas fa-print"></i></button>' +
                        '<button class="mrh-btn n s" title="Every MRA try of this order (history)" onclick="MraInterface.history(' + jsArg(r.ORDER_NUMBER) + ', ' + jsArg(r.INSTANCE_NAME) + ')"' + (r.TRIES ? '' : ' disabled') + '><i class="fas fa-clock-rotate-left"></i></button>' +
                    '</div></td>' +
                    '<td class="odr"><b>' + esc(r.ORDER_NUMBER) + '</b>' + (r.PICKER ? '<div class="mro-st" title="Picker">' + esc(r.PICKER) + '</div>' : '') + '</td>' +
                    '<td class="cut" title="' + esc(r.CUSTOMER_NAME + (r.CUSTOMER_NUMBER ? ' (' + r.CUSTOMER_NUMBER + ')' : '')) + '">' + esc(r.CUSTOMER_NAME) + (r.CUSTOMER_NUMBER ? ' <span class="sub">' + esc(r.CUSTOMER_NUMBER) + '</span>' : '') + '</td>' +
                    '<td class="cut n" title="' + esc(r.ORDER_TYPE) + '">' + esc(r.ORDER_TYPE) + '</td>' +
                    '<td class="cut n" title="' + esc(r.LINE_STATUS) + '">' + esc(r.LINE_STATUS) + '</td>' +
                    '<td><span class="mro-fl">' + fl(r.RELEASED, 'R', 'Pick released') + fl(r.PICKED, 'P', 'Pick confirmed') + fl(r.SHIPPED, 'S', 'Ship confirmed / interfaced') + '</span></td>' +
                    '<td title="' + esc(r.PRINTING_ST) + '">' + (r.PRINTED ? '<span class="mrh-s SUCCESS">Printed</span>' : (r.PRINTING_ST ? '<span class="mrh-s ' + (/fail|error/i.test(r.PRINTING_ST) ? 'FAILED' : 'SKIPPED') + '">' + esc(r.PRINTING_ST) + '</span>' : '<span class="mro-st">—</span>')) + '</td>' +
                    '<td><span class="mrh-s ' + esc(stc) + '">' + (busy ? '<i class="fas fa-spinner fa-spin"></i> ' : '') + esc(stl) + '</span></td>' +
                    '<td class="cut n" style="font-size:.72rem;" title="' + esc(r.MRA_INTERFACE_ID) + '">' + esc(r.MRA_INTERFACE_ID) + '</td>' +
                    '<td class="mro-st">' + esc(r.MRA_AT) + (r.TRIES > 1 ? '<span class="sub" title="Runs of this order">×' + r.TRIES + '</span>' : '') + '</td>' +
                    '<td class="cut w' + (why ? ' why' : '') + '" title="' + esc(why) + '">' + esc(why) + '</td></tr>';
            });
        });
        return html + '</tbody></table></div>';
    }
    function wireOrders() {
        var g = function (id) { return document.getElementById(id); };
        document.querySelectorAll('.mrh-kpi div[data-ok]').forEach(function (d) { d.onclick = function () { O.kpi = d.getAttribute('data-ok') || null; render(); }; });
        document.querySelectorAll('.mrh-t input[data-key]').forEach(function (c) { c.onchange = function () { var k = c.getAttribute('data-key'); if (c.checked) O.sel[k] = 1; else delete O.sel[k]; render(); }; });
        document.querySelectorAll('.mrh-t input[data-trip]').forEach(function (c) {
            c.onchange = function () { var tk = c.getAttribute('data-trip'); oShown().forEach(function (r) { if (r.INSTANCE_NAME + '|' + r.TRIP_ID !== tk) return; if (c.checked) O.sel[r.KEY] = 1; else delete O.sel[r.KEY]; }); render(); };
        });
        if (g('mro-all')) g('mro-all').onchange = function () { var on = g('mro-all').checked; oShown().forEach(function (r) { if (on) O.sel[r.KEY] = 1; else delete O.sel[r.KEY]; }); render(); };
        if (g('mro-notdone')) g('mro-notdone').onclick = function () { O.sel = {}; oShown().forEach(function (r) { if (oNotDone(r)) O.sel[r.KEY] = 1; }); render(); };
        if (g('mro-failed')) g('mro-failed').onclick = function () { O.sel = {}; oShown().forEach(function (r) { if (oClass(r) === 'FAILED') O.sel[r.KEY] = 1; }); render(); };
        if (g('mro-none')) g('mro-none').onclick = function () { O.sel = {}; render(); };
        var gi = g('mro-grep'), gt = null;
        if (gi) {
            var regrep = function () {
                var el = g('mro-grep'), v = el ? el.value : O.grep, pos = el ? el.selectionStart : v.length;
                O.grep = v; render();
                var n = g('mro-grep'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ } }
            };
            gi.oninput = function () { clearTimeout(gt); gt = setTimeout(regrep, O.rows.length > 300 ? 150 : 40); };
            gi.onkeydown = function (e) { if (e.key === 'Escape') { gi.value = ''; clearTimeout(gt); regrep(); } };
            if (g('mro-grep-x')) g('mro-grep-x').onclick = function () { O.grep = ''; render(); var n = g('mro-grep'); if (n) n.focus(); };
        }
    }
    function oCsv() {
        var rows = oShown(); if (!rows.length) return;
        var cols = ['INSTANCE_NAME', 'TRIP_ID', 'TRIP_DATE', 'LORRY', 'BAY', 'PRIORITY', 'ORDER_NUMBER', 'CUSTOMER_NUMBER', 'CUSTOMER_NAME', 'ORDER_TYPE', 'LINE_STATUS', 'PICKER', 'RELEASED', 'PICKED', 'SHIPPED', 'PRINTING_ST', 'AMOUNT', 'MRA_INTERFACE_STATUS', 'MRA_INTERFACE_ID', 'MRA_AT', 'TRIES', 'MRA_WHY'];
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = '﻿' + cols.join(',') + '\r\n' + rows.map(function (r) { return cols.map(function (c) { var v = r[c]; return q(typeof v === 'boolean' ? (v ? 'Y' : 'N') : v); }).join(','); }).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
        a.download = 'mra_all_orders_' + filters().from + '_' + filters().to + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    }

    // ── Details: the whole row + the order header, MRA request and MRA answer (CLOBs read in pieces) ──
    function clobSql(col, id) {
        var parts = [0, 1, 2, 3].map(function (i) { return 'TO_CHAR(SUBSTR(' + col + ', ' + (i * 3900 + 1) + ', 3900)) AS p' + i; }).join(', ');
        return 'SELECT LENGTH(' + col + ') AS len, ' + parts + ' FROM wms_mra_interface_status WHERE id = ' + Number(id);
    }
    function pretty(t) { try { return JSON.stringify(JSON.parse(t), null, 2); } catch (e) { return t; } }
    function details(id) {
        var r = byId(id); if (!r) return;
        var old = document.getElementById('mrh-dlg'); if (old) old.remove();
        var d = document.createElement('div'); d.id = 'mrh-dlg'; d.className = 'mrh-dlg';
        var kv = [['Status', '<span class="mrh-s ' + esc(r.MRA_INTERFACE_STATUS) + '">' + esc(ST_LABEL[r.MRA_INTERFACE_STATUS] || r.MRA_INTERFACE_STATUS) + '</span>'],
            ['MRA IRN', esc(r.MRA_INTERFACE_ID || '—')], ['When', esc(r.CREATED_AT)], ['Instance', esc(r.INSTANCE_NAME)], ['Trip', esc((r.TRIP_ID || '—') + (r.TRIP_DATE ? ' · ' + r.TRIP_DATE : ''))],
            ['Order', esc(r.ORDER_NUMBER) + ' · header ' + esc(r.HEADER_ID || '—')], ['Order type / date', esc((r.ORDER_TYPE || '—') + ' · ' + (r.ORDER_DATE || ''))],
            ['Customer', esc((r.CUSTOMER_NUMBER || '') + ' ' + (r.CUSTOMER_NAME || ''))], ['Amount / tax', money(r.ORDER_AMOUNT) + ' / ' + money(r.TAX_AMOUNT)],
            ['Lines / invoice type', esc((r.LINE_COUNT || '—') + ' · ' + (r.INVOICE_TYPE || '—'))], ['MRA HTTP status', esc(r.HTTP_STATUS || '—') + (r.GATEWAY_PROBLEM ? ' · ' + esc(r.GATEWAY_PROBLEM) : '')],
            ['IRN written to Fusion', esc(r.FUSION_UPDATED === 'Y' ? 'Yes' : r.FUSION_UPDATED === 'N' ? 'No' : '—')], ['Source / user / PC', esc((r.SOURCE || '') + ' · ' + (r.APP_USER || '') + ' · ' + (r.MACHINE || ''))],
            ['Took', r.DURATION_MS ? (Number(r.DURATION_MS) / 1000).toFixed(1) + ' s' : '—']];
        d.innerHTML = '<div><h4><i class="fas fa-file-invoice" style="color:#4f46e5;"></i> MRA run · order ' + esc(r.ORDER_NUMBER) +
            '<button class="mrh-btn n s" style="float:right;" id="mrh-x">Close</button></h4>' +
            '<div class="mrh-kv">' + kv.map(function (x) { return '<div><span class="k">' + x[0] + '</span>' + x[1] + '</div>'; }).join('') + '</div>' +
            (r.FAILED_REASON ? '<div class="mrh-sec"><h5>Failed at ' + esc(r.FAILED_STEP || '') + '</h5><div class="mri-err" style="margin:0;">' + esc(r.FAILED_REASON) + '</div></div>' : '') +
            ['MRA_RESPONSE_JSON|MRA answer', 'MRA_REQUEST_JSON|Sent to MRA', 'ORDER_HEADER_JSON|Order header from Fusion'].map(function (x) {
                var k = x.split('|');
                return '<div class="mrh-sec"><h5>' + k[1] + ' <button class="mrh-btn n s" data-copy="' + k[0] + '"><i class="fas fa-copy"></i> Copy</button></h5><pre class="mrh-pre" id="mrh-' + k[0] + '"><i class="fas fa-spinner fa-spin"></i></pre></div>';
            }).join('') +
            '<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.9rem;">' +
            '<button class="mrh-btn g" id="mrh-d-retry"><i class="fas fa-paper-plane"></i> Interface to MRA</button>' +
            '<button class="mrh-btn b" id="mrh-d-print"><i class="fas fa-print"></i> Print order</button></div></div>';
        document.body.appendChild(d);
        var close = function () { d.remove(); };
        d.addEventListener('click', function (e) { if (e.target === d) close(); });
        document.getElementById('mrh-x').onclick = close;
        document.getElementById('mrh-d-retry').onclick = function () { close(); retry([String(r.ID)]); };
        document.getElementById('mrh-d-print').onclick = function () { close(); printOrders([String(r.ID)]); };
        var texts = {};
        ['MRA_RESPONSE_JSON', 'MRA_REQUEST_JSON', 'ORDER_HEADER_JSON'].forEach(function (col) {
            read(clobSql(col.toLowerCase(), r.ID), 1).then(function (rows) {
                var x = rows[0] || {}, t = (x.P0 || '') + (x.P1 || '') + (x.P2 || '') + (x.P3 || '');
                texts[col] = t;
                var el = document.getElementById('mrh-' + col); if (!el) return;
                el.textContent = t ? pretty(t) + (Number(x.LEN) > t.length ? '\n… (' + x.LEN + ' characters, first ' + t.length + ' shown)' : '') : '(nothing kept)';
            }).catch(function (e) { var el = document.getElementById('mrh-' + col); if (el) el.textContent = 'Could not read: ' + e.message; });
        });
        d.querySelectorAll('[data-copy]').forEach(function (b) {
            b.onclick = function () { var t = texts[b.getAttribute('data-copy')] || ''; if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { notify('Copied.', 'success'); }); };
        });
    }
    function csv() {
        var rows = shown(); if (!rows.length) return;
        var cols = ['CREATED_AT', 'INSTANCE_NAME', 'TRIP_ID', 'TRIP_DATE', 'ORDER_NUMBER', 'ORDER_TYPE', 'ORDER_DATE', 'CUSTOMER_NUMBER', 'CUSTOMER_NAME', 'ORDER_AMOUNT', 'TAX_AMOUNT',
            'INVOICE_TYPE', 'MRA_INTERFACE_STATUS', 'MRA_INTERFACE_ID', 'FAILED_STEP', 'FAILED_REASON', 'GATEWAY_PROBLEM', 'HTTP_STATUS', 'SOURCE', 'APP_USER', 'TRIES'];
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = '﻿' + cols.join(',') + '\r\n' + rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); }).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
        a.download = 'mra_history_' + filters().from + '_' + filters().to + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    }

    // ── UI ──────────────────────────────────────────────────
    function css() {
        if (document.getElementById('mri-css')) return;
        var s = document.createElement('style'); s.id = 'mri-css';
        s.textContent =
            '.mri-wrap{padding:1.25rem;margin:0;font-family:inherit;}' +
            '.mri-hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-radius:14px;padding:1.25rem 1.5rem;display:flex;align-items:center;gap:1rem;box-shadow:0 8px 24px rgba(79,70,229,.25);}' +
            '.mri-hero .ic{width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:1.4rem;}' +
            '.mri-hero h2{margin:0;font-size:1.3rem;} .mri-hero p{margin:.2rem 0 0;opacity:.9;font-size:.85rem;}' +
            '.mri-hero button{margin-left:auto;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:.45rem .9rem;cursor:pointer;font-weight:600;}' +
            '.mri-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;margin-top:1rem;}' +
            '.mri-card{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:1.1rem 1.25rem;box-shadow:0 2px 8px rgba(15,23,42,.05);transition:border-color .2s;}' +
            '.mri-card.on{border-color:#86efac;} .mri-card.off{border-color:#facc15;background:#fffbeb;}' +
            '.mri-top{display:flex;align-items:center;gap:.6rem;} .mri-inst{font-size:1.15rem;font-weight:800;color:#1e293b;}' +
            '.mri-cur{font-size:.65rem;font-weight:700;background:#e0e7ff;color:#4338ca;border-radius:8px;padding:.1rem .45rem;}' +
            '.mri-pill{margin-left:auto;font-size:.75rem;font-weight:800;border-radius:999px;padding:.25rem .75rem;}' +
            '.mri-pill.on{background:#dcfce7;color:#15803d;} .mri-pill.off{background:#fef08a;color:#dc2626;}' +
            '.mri-switch{display:flex;align-items:center;gap:.8rem;margin:1rem 0 .6rem;}' +
            '.mri-tg{position:relative;width:64px;height:34px;border-radius:999px;border:none;cursor:pointer;transition:background .2s;flex:none;}' +
            '.mri-tg::after{content:"";position:absolute;top:4px;left:4px;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);transition:left .2s;}' +
            '.mri-tg.on{background:#16a34a;} .mri-tg.on::after{left:34px;} .mri-tg.off{background:#cbd5e1;} .mri-tg:disabled{opacity:.5;cursor:wait;}' +
            '.mri-what{font-size:.85rem;color:#334155;line-height:1.4;} .mri-what b{color:#0f172a;}' +
            '.mri-meta{font-size:.75rem;color:#64748b;margin-top:.6rem;border-top:1px dashed #e2e8f0;padding-top:.6rem;}' +
            '.mri-note{font-style:italic;color:#475569;}' +
            '.mri-box{background:#fff;border:1px solid #e2e8f0;border-radius:14px;margin-top:1rem;overflow:hidden;}' +
            '.mri-box h3{margin:0;padding:.75rem 1rem;font-size:.95rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#1e293b;}' +
            '.mri-tbl{width:100%;border-collapse:collapse;font-size:.8rem;} .mri-tbl th{text-align:left;color:#64748b;font-weight:600;padding:.5rem 1rem;border-bottom:1px solid #e2e8f0;}' +
            '.mri-tbl td{padding:.5rem 1rem;border-bottom:1px solid #f1f5f9;color:#334155;}' +
            '.mri-f{display:inline-block;font-weight:800;font-size:.7rem;border-radius:6px;padding:.05rem .4rem;} .mri-f.Y{background:#dcfce7;color:#15803d;} .mri-f.N{background:#fef08a;color:#dc2626;}' +
            '.mri-how{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:1rem;font-size:.8rem;color:#334155;} .mri-how div{background:#f8fafc;border-radius:10px;padding:.75rem;}' +
            '.mri-err{margin-top:1rem;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:.75rem 1rem;font-size:.85rem;}' +
            '.mri-dlg{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:30000;display:flex;align-items:center;justify-content:center;}' +
            '.mri-dlg>div{background:#fff;border-radius:14px;width:min(460px,92vw);padding:1.25rem;box-shadow:0 24px 80px rgba(0,0,0,.35);}' +
            '.mri-dlg h4{margin:0 0 .5rem;font-size:1.05rem;} .mri-dlg p{font-size:.85rem;color:#334155;margin:.25rem 0 .75rem;}' +
            '.mri-dlg textarea{width:100%;box-sizing:border-box;min-height:70px;border:1px solid #cbd5e1;border-radius:8px;padding:.5rem;font:inherit;font-size:.85rem;}' +
            '.mri-dlg .b{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.75rem;} .mri-dlg button{border:none;border-radius:8px;padding:.5rem 1rem;font-weight:700;cursor:pointer;}' +
            '@media (max-width:700px){.mri-how{grid-template-columns:1fr;}}' + HIST_CSS;
        document.head.appendChild(s);
    }

    function card(inst) {
        var r = st.flags[inst], on = !r || String(r.INTERFACE_FLAG || 'Y').toUpperCase() !== 'N', busy = !!st.busy[inst];
        var cls = on ? 'on' : 'off';
        return '<div class="mri-card ' + cls + '">' +
            '<div class="mri-top"><i class="fas fa-server" style="color:#6366f1;"></i><span class="mri-inst">' + inst + '</span>' +
            (curInstance() === inst ? '<span class="mri-cur">this app</span>' : '') +
            '<span class="mri-pill ' + cls + '">' + (on ? 'ENABLED' : 'DISABLED') + '</span></div>' +
            '<div class="mri-switch"><button class="mri-tg ' + cls + '" ' + (busy || st.loading ? 'disabled' : '') + ' onclick="MraInterface.toggle(\'' + inst + '\')" title="' + (on ? 'Disable' : 'Enable') + ' MRA interface for ' + inst + '"></button>' +
            '<div class="mri-what">' + (busy ? '<i class="fas fa-spinner fa-spin"></i> Saving…' : on
                ? '<b>Print Trip interfaces to MRA</b> before printing — only orders MRA accepts are printed.'
                : '<b>Print Trip prints without MRA</b> — orders are not sent to MRA (shown as "MRA off").') + '</div></div>' +
            '<div class="mri-meta">' + (r ? 'Last changed by <b>' + esc(r.CHANGED_BY || '—') + '</b> on ' + esc(r.CHANGED_AT || '—') +
                (r.NOTE ? '<div class="mri-note">“' + esc(r.NOTE) + '”</div>' : '') : 'Not set yet — enabled by default') + '</div></div>';
    }

    /** The bar above the tabs: the dates and the instance every tab works with (the Setup tab has none). */
    function globalHtml() {
        var f = filters(), busy = H.loading || O.loading;
        var opt = function (v, t, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; };
        return '<div class="mri-global"><span class="gl-h"><i class="fas fa-calendar-days"></i> Dates</span>' +
            '<label>Date from<input type="date" id="mri-from" value="' + esc(f.from) + '"></label>' +
            '<label>Date to<input type="date" id="mri-to" value="' + esc(f.to) + '"></label>' +
            '<label>Instance<select id="mri-inst">' + opt('', 'All', f.inst) + INSTANCES.map(function (x) { return opt(x, x, f.inst); }).join('') + '</select></label>' +
            '<button class="mrh-btn p" id="mri-go"' + (busy ? ' disabled' : '') + '><i class="fas fa-' + (busy ? 'spinner fa-spin' : 'search') + '"></i> Apply</button>' +
            '<div class="mrh-quick"><button data-q="0">Today</button><button data-q="1">Tomorrow</button><button data-q="-1">Yesterday</button><button data-q="7">Last 7 days</button><button data-q="30">Last 30 days</button></div>' +
            '<span class="gl-t">The same dates drive the history and All orders tabs</span></div>';
    }
    function reloadTab() { if (st.tab === 'history') search(); else if (st.tab === 'orders') loadOrders(); }
    function wireGlobal() {
        var g = function (id) { return document.getElementById(id); };
        if (g('mri-go')) g('mri-go').onclick = function () { readForm(); reloadTab(); };
        ['mri-from', 'mri-to'].forEach(function (id) { if (g(id)) g(id).onkeydown = function (e) { if (e.key === 'Enter') { readForm(); reloadTab(); } }; });
        if (g('mri-inst')) g('mri-inst').onchange = function () { readForm(); reloadTab(); };
        document.querySelectorAll('.mri-global .mrh-quick button').forEach(function (b) {
            b.onclick = function () {
                var n = Number(b.getAttribute('data-q')), f = readForm();
                if (n === 0 || n === 1 || n === -1) { f.from = f.to = today(n); } else { f.from = today(-n); f.to = today(0); }
                reloadTab();
            };
        });
    }

    function render() {
        var el = document.getElementById('mra-interface'); if (!el) return;
        css();
        var logRows = st.log.length ? st.log.map(function (l) {
            return '<tr><td>' + esc(l.CHANGED_AT) + '</td><td><b>' + esc(l.INSTANCE_NAME) + '</b></td><td><span class="mri-f ' + esc(l.OLD_FLAG || 'Y') + '">' + (l.OLD_FLAG === 'N' ? 'No' : 'Yes') +
                '</span> → <span class="mri-f ' + esc(l.NEW_FLAG) + '">' + (l.NEW_FLAG === 'N' ? 'No' : 'Yes') + '</span></td><td>' + esc(l.CHANGED_BY) + '</td><td>' + esc(l.NOTE || '') + '</td></tr>';
        }).join('') : '<tr><td colspan="5" style="color:#94a3b8;text-align:center;padding:1rem;">No changes yet.</td></tr>';
        var hist = st.tab === 'history', ord = st.tab === 'orders', setup = !hist && !ord, busy = st.loading || H.loading || O.loading;
        el.innerHTML = '<div class="mri-wrap' + (setup ? '' : ' wide') + '">' + (setup ? '' : globalHtml()) +
            '<div class="mri-tabs"><button class="' + (setup ? 'on' : '') + '" onclick="MraInterface.tab(\'setup\')"><i class="fas fa-sliders"></i> Setup</button>' +
            '<button class="' + (hist ? 'on' : '') + '" onclick="MraInterface.tab(\'history\')"><i class="fas fa-clock-rotate-left"></i> MRA transactions history</button>' +
            '<button class="' + (ord ? 'on' : '') + '" onclick="MraInterface.tab(\'orders\')"><i class="fas fa-truck-fast"></i> All orders' + (O.loaded && ord ? ' <span class="sub">' + O.rows.length + '</span>' : '') + '</button>' +
            '<button class="rf" onclick="MraInterface.' + (hist ? 'search()' : ord ? 'orders()' : 'refresh()') + '"' + (busy ? ' disabled' : '') + ' title="Refresh"><i class="fas fa-sync-alt' + (busy ? ' fa-spin' : '') + '"></i> Refresh</button></div>' +
            (hist ? histHtml() + '</div>' : '') + (ord ? ordersHtml() + '</div>' : '') + (!setup ? '' :
            (st.error ? '<div class="mri-err"><i class="fas fa-exclamation-triangle"></i> Could not read the MRA setting: ' + esc(st.error) + '</div>' : '') +
            '<div class="mri-grid">' + INSTANCES.map(card).join('') + '</div>' +
            '<div class="mri-box"><h3><i class="fas fa-circle-info" style="color:#6366f1;"></i> How it works</h3><div class="mri-how">' +
            '<div><span class="mri-f Y">Enabled</span><br>On Print Trip every ready order is interfaced to MRA first. Orders MRA rejects are held back and not printed; the MRA column shows why.</div>' +
            '<div><span class="mri-f N">Disabled</span><br>Print Trip skips MRA and prints every ready order. Use it when MRA is down or not needed. The setting is read again on every Print Trip, for every agent on that instance.</div>' +
            '</div></div>' +
            '<div class="mri-box"><h3><i class="fas fa-clock-rotate-left" style="color:#6366f1;"></i> Change history</h3>' +
            '<div style="overflow-x:auto;"><table class="mri-tbl"><thead><tr><th>When</th><th>Instance</th><th>Change</th><th>By</th><th>Reason</th></tr></thead><tbody>' + logRows + '</tbody></table></div></div>' +
            '</div>');
        if (!setup) wireGlobal();
        if (hist) wireHist();
        if (ord) wireOrders();
    }

    function toggle(inst) {
        var r = st.flags[inst], on = !r || String(r.INTERFACE_FLAG || 'Y').toUpperCase() !== 'N', next = on ? 'N' : 'Y';
        var old = document.getElementById('mri-dlg'); if (old) old.remove();
        var d = document.createElement('div'); d.id = 'mri-dlg'; d.className = 'mri-dlg';
        d.innerHTML = '<div><h4>' + (next === 'N' ? '<i class="fas fa-power-off" style="color:#dc2626;"></i> Disable' : '<i class="fas fa-check-circle" style="color:#16a34a;"></i> Enable') + ' MRA interface for ' + inst + '?</h4>' +
            '<p>' + (next === 'N' ? 'Print Trip will print orders <b>without</b> interfacing them to MRA, for every agent and trip on ' + inst + '.'
                : 'Print Trip will interface every order to MRA first and print only the ones MRA accepts.') + '</p>' +
            '<label style="font-size:.8rem;font-weight:600;color:#475569;">Reason' + (next === 'N' ? ' (required)' : ' (optional)') + '</label>' +
            '<textarea id="mri-note" placeholder="' + (next === 'N' ? 'e.g. MRA portal down since 10:00' : 'e.g. MRA back online') + '"></textarea>' +
            '<div class="b"><button style="background:#e2e8f0;color:#334155;" onclick="document.getElementById(\'mri-dlg\').remove()">Cancel</button>' +
            '<button id="mri-ok" style="background:' + (next === 'N' ? '#dc2626' : '#16a34a') + ';color:#fff;">' + (next === 'N' ? 'Disable' : 'Enable') + '</button></div></div>';
        document.body.appendChild(d);
        d.addEventListener('click', function (e) { if (e.target === d) d.remove(); });
        var ta = document.getElementById('mri-note'); ta.focus();
        document.getElementById('mri-ok').onclick = function () {
            var note = ta.value.trim();
            if (next === 'N' && !note) { ta.style.borderColor = '#dc2626'; ta.placeholder = 'Please give a reason'; ta.focus(); return; }
            d.remove();
            setFlag(inst, next, note);
        };
    }

    window.MraInterface = {
        onShow: function () { render(); load(); if (st.tab === 'history' && !H.loaded) search(); if (st.tab === 'orders' && !O.loaded) loadOrders(); },
        refresh: load,
        toggle: toggle,
        tab: function (t) {
            st.tab = t === 'history' ? 'history' : t === 'orders' ? 'orders' : 'setup';
            try { localStorage.setItem('mri.tab', st.tab); } catch (e) { /* storage blocked */ }
            render();
            if (st.tab === 'history' && !H.loaded) search();
            if (st.tab === 'orders' && !O.loaded) loadOrders();
        },
        search: function () { readForm(); search(); },
        retry: function (ids) { retry(ids); },
        print: function (ids) { printOrders(ids); },
        details: function (id) { details(id); },
        csv: function () { csv(); },
        /** All orders tab: read the trips of the dates again; Interface / Print the ticked (or given) orders; one trip's orders. */
        orders: function () { readForm(); return loadOrders(); },
        oRetry: function (keys) { mraRun(oPicked(keys), O, keyOfO, refreshMra, 'WMS_MRA_ORDERS'); },
        oPrint: function (keys) { printRun(oPicked(keys), O, keyOfO); },
        oTrip: function (tk, what) {
            var list = O.rows.filter(function (r) { return r.INSTANCE_NAME + '|' + r.TRIP_ID === tk; });
            if (what === 'print') printRun(list, O, keyOfO); else mraRun(list.filter(oNotDone), O, keyOfO, refreshMra, 'WMS_MRA_ORDERS');
        },
        oCsv: function () { oCsv(); },
        state: function () { return { tab: st.tab, filters: filters(), orders: O, history: H }; },
        /** Interfaces one order from another screen (the trip grids' Interface button): {order, instance, tripId},
            onStep(text) → {st: SUCCESS | FAILED | SKIPPED | ALREADY_DONE, msg, gw}. */
        interfaceOrder: function (o, onStep, source) {
            if (!window.chrome || !window.chrome.webview) return Promise.resolve({ st: 'FAILED', msg: 'Open this inside the Gray\'s WMS app.' });
            return fusionCreds().then(function (c) {
                return mraOne({ ORDER_NUMBER: o.order, INSTANCE_NAME: o.instance, TRIP_ID: o.tripId }, c, 'trip_' + Date.now(), onStep, source || 'WMS_TRIP_GRID');
            }, function (e) { return { st: 'FAILED', msg: e.message }; });
        },
        /** Opens MRA transactions history on one order (every try, last 2 years) — the MRA column of the trip grids. */
        history: function (order, inst) {
            var f = filters();
            f.q = String(order || ''); f.trip = ''; f.status = ''; f.latest = false; f.from = today(-730); f.to = today(0);
            if (inst) f.inst = String(inst).toUpperCase();
            st.tab = 'history';
            if (typeof window.navigateToPage === 'function') window.navigateToPage('mra-interface'); else render();
            setTimeout(function () { render(); search(); }, 50);
        }
    };
})();
