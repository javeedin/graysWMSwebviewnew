// ============================================================
// MRA INTERFACE - switch the Shipping Agent's MRA interface on / off
// ============================================================
// WMS menu › MRA Interface. One switch per instance (PROD / TEST) stored in
// WMS_MRA_INTERFACE_CONFIG (INTERFACE_FLAG Y / N). The Shipping Agent's Print Trip
// reads it on every click: Y = interface every order to MRA first and print only
// what MRA accepts, N = print without MRA. Every change (who, when, why) goes to
// WMS_MRA_INTERFACE_LOG. Both tables are created here on first use
// (apex_sql/79_mra_interface_config.sql has the same DDL).
// Two tabs: Setup (the switches above) and MRA transactions history — the rows the app writes
// to WMS_MRA_INTERFACE_STATUS on every MRA run (classes/MRAInterfaceStatus.cs): search by date,
// trip, status, instance, order / customer; Interface to MRA again (retry) and Print per order
// or for the ticked orders; details with MRA's request / answer.
// ============================================================

(function () {
    'use strict';
    var AI_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    var INSTANCES = ['PROD', 'TEST'];
    var st = { flags: {}, log: [], loading: false, error: null, busy: {}, tab: 'setup' };
    try { if (localStorage.getItem('mri.tab') === 'history') st.tab = 'history'; } catch (e) { /* storage blocked */ }
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
    var H = { loaded: false, loading: false, error: null, rows: [], sel: {}, busy: {}, live: {}, f: null, more: false };
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
        '.mrh-sec{margin-top:.8rem;} .mrh-sec h5{margin:0 0 .3rem;font-size:.8rem;color:#334155;display:flex;align-items:center;gap:.5rem;}';

    function today(off) { var d = new Date(); d.setDate(d.getDate() + (off || 0)); return d.toISOString().slice(0, 10); }
    function filters() {
        if (!H.f) {
            var saved = {}; try { saved = JSON.parse(localStorage.getItem('mri.hist.f') || '{}') || {}; } catch (e) { saved = {}; }
            H.f = { from: today(-7), to: today(0), trip: '', status: saved.status || '', inst: saved.inst || curInstance(), q: '', latest: saved.latest !== false };
        }
        return H.f;
    }
    function readForm() {
        var f = filters(), g = function (id) { var e = document.getElementById(id); return e ? e : null; };
        if (!g('mrh-from')) return f;
        f.from = g('mrh-from').value || today(-7); f.to = g('mrh-to').value || today(0);
        f.trip = g('mrh-trip').value.trim(); f.status = g('mrh-status').value; f.inst = g('mrh-inst').value;
        f.q = g('mrh-q').value.trim(); f.latest = g('mrh-latest').checked;
        try { localStorage.setItem('mri.hist.f', JSON.stringify({ status: f.status, inst: f.inst, latest: f.latest })); } catch (e) { /* storage blocked */ }
        return f;
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
    function shown() { return H.rows.filter(function (r) { return !H.kpi || r.MRA_INTERFACE_STATUS === H.kpi; }); }

    function histHtml() {
        var f = filters(), rows = shown(), counts = {}, amount = 0;
        H.rows.forEach(function (r) { counts[r.MRA_INTERFACE_STATUS] = (counts[r.MRA_INTERFACE_STATUS] || 0) + 1; });
        rows.forEach(function (r) { amount += Number(r.ORDER_AMOUNT) || 0; });
        var nSel = Object.keys(H.sel).length, busyAny = Object.keys(H.busy).length > 0;
        var opt = function (v, t, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; };
        var html = '<div class="mrh-f">' +
            '<label>Date from<input type="date" id="mrh-from" value="' + esc(f.from) + '"></label>' +
            '<label>Date to<input type="date" id="mrh-to" value="' + esc(f.to) + '"></label>' +
            '<label>Trip ID<input id="mrh-trip" placeholder="any" value="' + esc(f.trip) + '" style="min-width:90px;width:100px;"></label>' +
            '<label>MRA status<select id="mrh-status">' + opt('', 'All', f.status) + STATUS.map(function (x) { return opt(x, ST_LABEL[x], f.status); }).join('') + '</select></label>' +
            '<label>Instance<select id="mrh-inst">' + opt('', 'All', f.inst) + INSTANCES.map(function (x) { return opt(x, x, f.inst); }).join('') + '</select></label>' +
            '<label>Order / customer / IRN<input id="mrh-q" placeholder="search" value="' + esc(f.q) + '"></label>' +
            '<label class="chk"><input type="checkbox" id="mrh-latest"' + (f.latest ? ' checked' : '') + '> Latest try per order only</label>' +
            '<button class="mrh-btn p" id="mrh-go"' + (H.loading ? ' disabled' : '') + '><i class="fas fa-' + (H.loading ? 'spinner fa-spin' : 'search') + '"></i> Search</button>' +
            '<div class="mrh-quick"><button data-q="0">Today</button><button data-q="-1">Yesterday</button><button data-q="7">Last 7 days</button><button data-q="30">Last 30 days</button></div>' +
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
            '<span style="margin-left:auto;"></span><button class="mrh-btn n s" onclick="MraInterface.csv()"><i class="fas fa-file-csv"></i> CSV</button></div>';
        if (H.more) html += '<div style="font-size:.75rem;color:#a16207;margin-top:.4rem;">Showing the newest ' + MAX_ROWS + ' — narrow the dates or add a trip to see the rest.</div>';
        if (!rows.length) return html + '<div class="mrh-tw"><div class="mrh-empty">No MRA runs match these filters.</div></div>';
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
        document.querySelectorAll('.mrh-quick button').forEach(function (b) {
            b.onclick = function () {
                var n = Number(b.getAttribute('data-q')), f = readForm();
                if (n === 0) { f.from = f.to = today(0); } else if (n === -1) { f.from = f.to = today(-1); } else { f.from = today(-n); f.to = today(0); }
                search();
            };
        });
        document.querySelectorAll('.mrh-kpi div[data-k]').forEach(function (d) { d.onclick = function () { H.kpi = d.getAttribute('data-k') || null; render(); }; });
        document.querySelectorAll('.mrh-t input[data-id]').forEach(function (c) { c.onchange = function () { var id = c.getAttribute('data-id'); if (c.checked) H.sel[id] = 1; else delete H.sel[id]; render(); }; });
        if (g('mrh-all')) g('mrh-all').onchange = function () { var on = g('mrh-all').checked; shown().forEach(function (r) { if (on) H.sel[r.ID] = 1; else delete H.sel[r.ID]; }); render(); };
        if (g('mrh-failed')) g('mrh-failed').onclick = function () { H.sel = {}; shown().forEach(function (r) { if (r.MRA_INTERFACE_STATUS === 'FAILED') H.sel[r.ID] = 1; }); render(); };
        if (g('mrh-none')) g('mrh-none').onclick = function () { H.sel = {}; render(); };
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
    function mraOne(r, c, batch) {
        return new Promise(function (resolve) {
            var rid = 'mrh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), timer = null;
            function done(x) { clearTimeout(timer); window.chrome.webview.removeEventListener('message', h); resolve(x); }
            function h(ev) {
                var d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
                if (!d || d.requestId !== rid) return;
                if (d.action === 'mraProcessingProgress') { H.live[r.ID] = { cls: 'RUN', text: 'Running', msg: d.message || d.step }; render(); return; }
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
                instance: r.INSTANCE_NAME || 'PROD', batchId: batch, source: 'WMS_MRA_HISTORY', tripId: r.TRIP_ID ? String(r.TRIP_ID) : undefined, appUser: appUser() });
        });
    }
    function retry(ids) {
        var list = picked(ids);
        if (!list.length) return;
        if (!window.chrome || !window.chrome.webview) { notify('Open this page inside the Gray\'s WMS app.', 'error'); return; }
        var off = list.filter(function (r) { var fl = st.flags[r.INSTANCE_NAME]; return fl && String(fl.INTERFACE_FLAG).toUpperCase() === 'N'; });
        var done = list.filter(function (r) { return r.MRA_INTERFACE_STATUS === 'SUCCESS' || r.MRA_INTERFACE_STATUS === 'ALREADY_DONE'; });
        var msg = 'Interface ' + list.length + ' order(s) to MRA?' +
            (done.length ? '\n\n' + done.length + ' already reached MRA — the app checks first and will not send them twice.' : '') +
            (off.length ? '\n\nNote: the MRA switch is OFF for ' + off.map(function (r) { return r.INSTANCE_NAME; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + ' (Setup tab). This sends them anyway.' : '');
        if (!window.confirm(msg)) return;
        list.forEach(function (r) { H.busy[r.ID] = 1; H.live[r.ID] = { cls: 'RUN', text: 'Waiting' }; });
        render();
        var batch = 'mrh_' + Date.now(), queue = list.slice(), gwStreak = 0, stop = null, res = { SUCCESS: 0, FAILED: 0, SKIPPED: 0, ALREADY_DONE: 0, NOT_SENT: 0 };
        fusionCreds().then(function (c) {
            function next() {
                var r = queue.shift(); if (!r) return Promise.resolve();
                if (stop) { res.NOT_SENT++; H.live[r.ID] = { cls: 'FAILED', text: 'Not sent', msg: stop }; delete H.busy[r.ID]; render(); return next(); }
                H.live[r.ID] = { cls: 'RUN', text: 'Running' }; render();
                return mraOne(r, c, batch).then(function (x) {
                    res[x.st] = (res[x.st] || 0) + 1;
                    if (x.gw) gwStreak++; else gwStreak = 0;
                    if (gwStreak >= 2) stop = 'the MRA gateway did not answer twice in a row — stopped; nothing was sent for this order, safe to retry later.';
                    H.live[r.ID] = { cls: x.st, text: ST_LABEL[x.st] || x.st, msg: x.msg }; delete H.busy[r.ID]; render();
                    return next();
                });
            }
            return Promise.all([next(), next(), next()]);      // 3 at a time
        }).catch(function (e) {
            list.forEach(function (r) { if (H.busy[r.ID]) { delete H.busy[r.ID]; H.live[r.ID] = { cls: 'FAILED', text: 'Not sent', msg: e.message }; } });
            notify('MRA: ' + e.message, 'error');
        }).then(function () {
            render();
            notify('MRA: ' + res.SUCCESS + ' interfaced, ' + res.ALREADY_DONE + ' already done, ' + res.SKIPPED + ' skipped, ' + res.FAILED + ' failed' + (res.NOT_SENT ? ', ' + res.NOT_SENT + ' not sent' : '') + '.', res.FAILED || res.NOT_SENT ? 'warning' : 'success');
            setTimeout(function () { H.live = {}; search(); }, 1500);    // the new rows the runs wrote
        });
    }

    // ── Print — the Shipping Agent's print: Fusion PDF (SOAP) → saved + print job row → PDF / printer choice ──
    function printOrders(ids) {
        var list = picked(ids);
        if (!list.length) return;
        if (typeof window.saPrintOrder !== 'function') { notify('Printing needs the Shipping Agent script (shipping-agent.js).', 'error'); return; }
        var notCleared = list.filter(function (r) { return r.MRA_INTERFACE_STATUS === 'FAILED'; });
        if (notCleared.length && !window.confirm(notCleared.length + ' of these order(s) FAILED at MRA (not fiscalised). Print anyway?')) return;
        var single = list.length === 1, n = 0, bad = 0;
        list.forEach(function (r) { H.busy[r.ID] = 1; }); render();
        list.reduce(function (p, r) {
            return p.then(function () {
                H.live[r.ID] = { cls: 'RUN', text: 'Printing' }; render();
                return Promise.resolve(window.saPrintOrder(r.ORDER_NUMBER, r.TRIP_ID || '', r.TRIP_DATE || today(0), r.INSTANCE_NAME || 'PROD', !single))
                    .then(function () { n++; H.live[r.ID] = { cls: r.MRA_INTERFACE_STATUS, text: ST_LABEL[r.MRA_INTERFACE_STATUS] || '', msg: 'Printed / PDF downloaded' }; })
                    .catch(function (e) { bad++; H.live[r.ID] = { cls: r.MRA_INTERFACE_STATUS, text: ST_LABEL[r.MRA_INTERFACE_STATUS] || '', msg: 'Print failed: ' + e.message }; })
                    .then(function () { delete H.busy[r.ID]; render(); });
            });
        }, Promise.resolve()).then(function () {
            if (!single) notify('Print: ' + n + ' sent' + (bad ? ', ' + bad + ' failed' : '') + '.', bad ? 'warning' : 'success');
        });
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

    function render() {
        var el = document.getElementById('mra-interface'); if (!el) return;
        css();
        var logRows = st.log.length ? st.log.map(function (l) {
            return '<tr><td>' + esc(l.CHANGED_AT) + '</td><td><b>' + esc(l.INSTANCE_NAME) + '</b></td><td><span class="mri-f ' + esc(l.OLD_FLAG || 'Y') + '">' + (l.OLD_FLAG === 'N' ? 'No' : 'Yes') +
                '</span> → <span class="mri-f ' + esc(l.NEW_FLAG) + '">' + (l.NEW_FLAG === 'N' ? 'No' : 'Yes') + '</span></td><td>' + esc(l.CHANGED_BY) + '</td><td>' + esc(l.NOTE || '') + '</td></tr>';
        }).join('') : '<tr><td colspan="5" style="color:#94a3b8;text-align:center;padding:1rem;">No changes yet.</td></tr>';
        var hist = st.tab === 'history';
        el.innerHTML = '<div class="mri-wrap' + (hist ? ' wide' : '') + '">' +
            '<div class="mri-tabs"><button class="' + (hist ? '' : 'on') + '" onclick="MraInterface.tab(\'setup\')"><i class="fas fa-sliders"></i> Setup</button>' +
            '<button class="' + (hist ? 'on' : '') + '" onclick="MraInterface.tab(\'history\')"><i class="fas fa-clock-rotate-left"></i> MRA transactions history</button>' +
            '<button class="rf" onclick="MraInterface.' + (hist ? 'search()' : 'refresh()') + '"' + (st.loading || H.loading ? ' disabled' : '') + ' title="Refresh"><i class="fas fa-sync-alt' + (st.loading || H.loading ? ' fa-spin' : '') + '"></i> Refresh</button></div>' +
            (hist ? histHtml() + '</div>' : '') + (hist ? '' :
            (st.error ? '<div class="mri-err"><i class="fas fa-exclamation-triangle"></i> Could not read the MRA setting: ' + esc(st.error) + '</div>' : '') +
            '<div class="mri-grid">' + INSTANCES.map(card).join('') + '</div>' +
            '<div class="mri-box"><h3><i class="fas fa-circle-info" style="color:#6366f1;"></i> How it works</h3><div class="mri-how">' +
            '<div><span class="mri-f Y">Enabled</span><br>On Print Trip every ready order is interfaced to MRA first. Orders MRA rejects are held back and not printed; the MRA column shows why.</div>' +
            '<div><span class="mri-f N">Disabled</span><br>Print Trip skips MRA and prints every ready order. Use it when MRA is down or not needed. The setting is read again on every Print Trip, for every agent on that instance.</div>' +
            '</div></div>' +
            '<div class="mri-box"><h3><i class="fas fa-clock-rotate-left" style="color:#6366f1;"></i> Change history</h3>' +
            '<div style="overflow-x:auto;"><table class="mri-tbl"><thead><tr><th>When</th><th>Instance</th><th>Change</th><th>By</th><th>Reason</th></tr></thead><tbody>' + logRows + '</tbody></table></div></div>' +
            '</div>');
        if (hist) wireHist();
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
        onShow: function () { render(); load(); if (st.tab === 'history' && !H.loaded) search(); },
        refresh: load,
        toggle: toggle,
        tab: function (t) {
            st.tab = t === 'history' ? 'history' : 'setup';
            try { localStorage.setItem('mri.tab', st.tab); } catch (e) { /* storage blocked */ }
            render();
            if (st.tab === 'history' && !H.loaded) search();
        },
        search: function () { readForm(); search(); },
        retry: function (ids) { retry(ids); },
        print: function (ids) { printOrders(ids); },
        details: function (id) { details(id); },
        csv: function () { csv(); }
    };
})();
