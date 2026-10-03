// ============================================================
// MRA INTERFACE - switch the Shipping Agent's MRA interface on / off
// ============================================================
// WMS menu › MRA Interface. One switch per instance (PROD / TEST) stored in
// WMS_MRA_INTERFACE_CONFIG (INTERFACE_FLAG Y / N). The Shipping Agent's Print Trip
// reads it on every click: Y = interface every order to MRA first and print only
// what MRA accepts, N = print without MRA. Every change (who, when, why) goes to
// WMS_MRA_INTERFACE_LOG. Both tables are created here on first use
// (apex_sql/79_mra_interface_config.sql has the same DDL).
// ============================================================

(function () {
    'use strict';
    var AI_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    var INSTANCES = ['PROD', 'TEST'];
    var st = { flags: {}, log: [], loading: false, error: null, busy: {} };
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

    // ── UI ──────────────────────────────────────────────────
    function css() {
        if (document.getElementById('mri-css')) return;
        var s = document.createElement('style'); s.id = 'mri-css';
        s.textContent =
            '.mri-wrap{padding:1.25rem;max-width:1100px;margin:0 auto;font-family:inherit;}' +
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
            '@media (max-width:700px){.mri-how{grid-template-columns:1fr;}}';
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
        el.innerHTML = '<div class="mri-wrap">' +
            '<div class="mri-hero"><div class="ic"><i class="fas fa-file-invoice"></i></div><div><h2>MRA Interface</h2>' +
            '<p>Switch the Mauritius Revenue Authority interface on or off for the Shipping Agent\'s Print Trip.</p></div>' +
            '<button onclick="MraInterface.refresh()"' + (st.loading ? ' disabled' : '') + '><i class="fas fa-sync-alt' + (st.loading ? ' fa-spin' : '') + '"></i> Refresh</button></div>' +
            (st.error ? '<div class="mri-err"><i class="fas fa-exclamation-triangle"></i> Could not read the MRA setting: ' + esc(st.error) + '</div>' : '') +
            '<div class="mri-grid">' + INSTANCES.map(card).join('') + '</div>' +
            '<div class="mri-box"><h3><i class="fas fa-circle-info" style="color:#6366f1;"></i> How it works</h3><div class="mri-how">' +
            '<div><span class="mri-f Y">Enabled</span><br>On Print Trip every ready order is interfaced to MRA first. Orders MRA rejects are held back and not printed; the MRA column shows why.</div>' +
            '<div><span class="mri-f N">Disabled</span><br>Print Trip skips MRA and prints every ready order. Use it when MRA is down or not needed. The setting is read again on every Print Trip, for every agent on that instance.</div>' +
            '</div></div>' +
            '<div class="mri-box"><h3><i class="fas fa-clock-rotate-left" style="color:#6366f1;"></i> Change history</h3>' +
            '<div style="overflow-x:auto;"><table class="mri-tbl"><thead><tr><th>When</th><th>Instance</th><th>Change</th><th>By</th><th>Reason</th></tr></thead><tbody>' + logRows + '</tbody></table></div></div>' +
            '</div>';
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
        onShow: function () { render(); load(); },
        refresh: load,
        toggle: toggle
    };
})();
