/* Sales Lens — the page's plumbing: host bridge, DuckDB reads, the APEX copy (WMS_SI_*), formatting, a grid, charts, dialogs.
 * Everything the screens show is read from this PC's DuckDB file (salesLensQuery) — instant, no Fusion call. The APEX copy is the
 * shared record: run summaries, the ranked opportunities, scores, feedback and simulations (other PCs and later the WMS read it). */
(function () {
    'use strict';
    var SL = window.SL = {};
    var pending = {};

    // ── host ──────────────────────────────────────────────────────
    SL.hasHost = function () { return !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage); };
    SL.user = function () { try { return (localStorage.getItem('username') || localStorage.getItem('wms_user') || '').trim(); } catch (e) { return ''; } };
    SL.host = function (action, payload, ms) {
        return new Promise(function (resolve, reject) {
            if (!SL.hasHost()) { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            var id = 'slq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            pending[id] = { resolve: resolve, reject: reject };
            setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('The app did not answer (' + action + ') — update Gray\'s WMS.')); } }, ms || 60000);
            window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: SL.user() }, payload || {}));
        });
    };
    if (SL.hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId || !pending[r.requestId]) return;
        var cb = pending[r.requestId]; delete pending[r.requestId];
        if (r.action === 'error') cb.reject(new Error(r.message || 'Host error'));
        else if (r.action === 'restResponse') cb.resolve({ rest: true, ok: r.success !== false, status: r.statusCode, text: r.data });
        else cb.resolve(r.data == null ? {} : r.data);
    });
    SL.call = function (action, payload, ms) {
        return SL.host(action, payload, ms).then(function (d) { if (d && d.ok === false) { var e = new Error(d.error || action + ' failed'); e.data = d; throw e; } return d; });
    };

    // ── DuckDB (this PC) ──────────────────────────────────────────
    function rowsOf(r) {
        return (r.rows || []).map(function (row) { var o = {}; (r.columns || []).forEach(function (c, i) { o[c] = row[i]; }); return o; });
    }
    SL.q = function (sql, max) {
        return SL.host('salesLensQuery', { sql: sql, max: max || 20000 }, 120000).then(function (r) {
            if (!r || r.ok === false) { var e = new Error((r && r.error) || 'query failed'); e.missing = r && r.missing; throw e; }
            return rowsOf(r);
        });
    };
    /** several statements in one open of the file → array of row arrays (a failing one = [] and its error in .errors) */
    SL.qs = function (sqls, max) {
        return SL.host('salesLensQueries', { sqls: sqls, max: max || 20000 }, 180000).then(function (d) {
            var out = (d.results || []).map(function (r) { return r && r.ok !== false ? rowsOf(r) : []; });
            out.errors = (d.results || []).map(function (r) { return r && r.ok === false ? r.error : null; });
            out.missing = (d.results || []).some(function (r) { return r && r.missing; });
            return out;
        });
    };
    SL.lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    SL.json = function (s, def) { if (s == null || s === '') return def; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return def; } };

    // ── formatting ────────────────────────────────────────────────
    SL.cur = 'MUR';
    SL.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    SL.n = function (v, d) { v = +v; if (!isFinite(v)) return ''; return v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
    SL.money = function (v, full) {
        v = +v; if (!isFinite(v)) return '—';
        var a = Math.abs(v);
        if (!full) { if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k'; }
        return SL.n(v, a < 100 ? 2 : 0);
    };
    SL.pct = function (v, d) { v = +v; return isFinite(v) ? v.toFixed(d == null ? 0 : d) + ' %' : '—'; };
    SL.month = function (ym) { ym = +ym; if (!ym) return ''; var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return m[ym % 100 - 1] + '-' + String(Math.floor(ym / 100)).slice(2); };
    SL.CAUSES = {
        STOCKOUT: ['Stock-out', '#dc2626'], PARTIAL: ['Partial shipment', '#ea580c'], LATE: ['Late delivery', '#d97706'], CANCEL: ['Cancelled lines', '#b45309'],
        PRICE_UP: ['Price increase', '#7c3aed'], DISCOUNT_DOWN: ['Discount reduced', '#9333ea'], MARGIN_LEAK: ['Margin leakage', '#a21caf'],
        RETURNS: ['Returns / quality', '#db2777'], PAYMENT: ['Payment / credit', '#0f766e'], CYCLE: ['Buys less often', '#0891b2'],
        INACTIVE: ['Stopped buying', '#1d4ed8'], SUBSTITUTION: ['Switched product', '#4f46e5'], SEASONAL: ['Market-wide drop', '#64748b'],
        LIFECYCLE: ['Product decline', '#475569'], UNKNOWN: ['Unknown', '#94a3b8']
    };
    SL.cause = function (k) { var c = SL.CAUSES[k] || [k || '—', '#94a3b8']; return '<span class="cz" style="--c:' + c[1] + '">' + SL.esc(c[0]) + '</span>'; };
    SL.pri = function (p) { return '<span class="pri ' + SL.esc(String(p || '').toLowerCase()) + '">' + SL.esc(p || '') + '</span>'; };
    SL.toast = function (msg, kind) {
        var t = document.createElement('div'); t.className = 'sl-toast ' + (kind || ''); t.textContent = msg;
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, kind === 'err' ? 7000 : 3500);
    };
    SL.dl = function (name, text, type) {
        var b = new Blob([text], { type: type || 'text/csv;charset=utf-8' }), a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    /** a file built in the page → the app's Save dialog (Downloads), else the browser download */
    SL.save = function (name, base64, filter, fallback) {
        if (!SL.hasHost()) { fallback(); return Promise.resolve(); }
        return SL.host('saveFileAs', { fileName: name, base64: base64, filter: filter, title: 'Save ' + name }, 600000).then(function (r) {
            if (r && r.ok) SL.toast('Saved · ' + (r.path || name)); else if (r && !r.cancelled) fallback();
        }).catch(fallback);
    };
    function b64(text) { return btoa(unescape(encodeURIComponent(text))); }
    SL.csv = function (name, cols, rows) {
        var out = [cols.map(function (c) { return '"' + String(c.label || c.k).replace(/"/g, '""') + '"'; }).join(',')];
        rows.forEach(function (r) { out.push(cols.map(function (c) { var v = c.csv ? c.csv(r) : r[c.k]; v = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v; return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',')); });
        var text = '﻿' + out.join('\r\n');
        return SL.save(name, b64(text), 'CSV|*.csv', function () { SL.dl(name, text); });
    };
    SL.xlsx = function (name, sheets) {
        if (!window.ExcelJS) { SL.toast('Excel export needs the internet (ExcelJS) — use CSV', 'err'); return Promise.resolve(); }
        var wb = new window.ExcelJS.Workbook();
        sheets.forEach(function (s) {
            var ws = wb.addWorksheet(s.name.slice(0, 31));
            ws.columns = s.cols.map(function (c) { return { header: c.label || c.k, key: c.k, width: Math.min(60, Math.max(10, (c.label || c.k).length + 4)) }; });
            s.rows.forEach(function (r) { var o = {}; s.cols.forEach(function (c) { var v = c.csv ? c.csv(r) : r[c.k]; o[c.k] = v != null && typeof v === 'object' ? JSON.stringify(v) : v; }); ws.addRow(o); });
            ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
        });
        return wb.xlsx.writeBuffer().then(function (buf) {
            var bin = '', u = new Uint8Array(buf); for (var i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
            return SL.save(name, btoa(bin), 'Excel|*.xlsx', function () { SL.dl(name, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
        });
    };

    // ── a grid: sort, a filter per column, search, CSV / Excel of the filtered rows ──
    SL.grid = function (el, o) {
        var st = { sort: o.sort || null, dir: o.dir || -1, f: {}, q: '', limit: o.limit || 300 };
        function txt(c, r) { var v = c.text ? c.text(r) : r[c.k]; return v == null ? '' : String(v); }
        function match(f, c, r) {
            if (!f) return true; var v = r[c.k], s = txt(c, r).toLowerCase(); f = f.trim().toLowerCase();
            if (/^[<>]=?-?\d/.test(f)) { var n = parseFloat(f.replace(/^[<>]=?/, '')); return f[0] === '>' ? +v >= n : +v <= n; }
            if (f[0] === '=') return s === f.slice(1); if (f[0] === '!') return s.indexOf(f.slice(1)) < 0;
            return s.indexOf(f) >= 0;
        }
        function rows() {
            var out = o.rows.filter(function (r) {
                if (st.q && !o.cols.some(function (c) { return txt(c, r).toLowerCase().indexOf(st.q) >= 0; })) return false;
                return o.cols.every(function (c) { return match(st.f[c.k], c, r); });
            });
            if (st.sort) { var c = o.cols.filter(function (x) { return x.k === st.sort; })[0] || { k: st.sort }; out.sort(function (a, b) { var x = a[c.k], y = b[c.k]; if (c.num || (typeof x === 'number' && typeof y === 'number')) return ((+x || 0) - (+y || 0)) * st.dir; return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)) * st.dir; }); }
            return out;
        }
        function paint() {
            var rs = rows(), shown = rs.slice(0, st.limit);
            var tot = o.cols.filter(function (c) { return c.sum; }).length ? '<tr class="tot">' + o.cols.map(function (c) { return '<td class="' + (c.num ? 'num' : '') + '">' + (c.sum ? SL.money(rs.reduce(function (a, r) { return a + (+r[c.k] || 0); }, 0)) : '') + '</td>'; }).join('') + '</tr>' : '';
            el.querySelector('tbody').innerHTML = shown.map(function (r, i) {
                return '<tr data-i="' + o.rows.indexOf(r) + '"' + (o.onRow ? ' class="click"' : '') + '>' + o.cols.map(function (c) { return '<td class="' + (c.num ? 'num' : '') + (c.cls ? ' ' + c.cls : '') + '">' + (c.html ? c.html(r) : SL.esc(txt(c, r))) + '</td>'; }).join('') + '</tr>';
            }).join('') + tot || '<tr><td colspan="' + o.cols.length + '" class="muted empty">' + SL.esc(o.empty || 'Nothing to show') + '</td></tr>';
            el.querySelector('.g-count').textContent = rs.length > shown.length ? 'showing ' + shown.length + ' of ' + SL.n(rs.length) : SL.n(rs.length) + ' row' + (rs.length === 1 ? '' : 's');
            el.querySelector('.g-more').style.display = rs.length > shown.length ? '' : 'none';
            el.querySelectorAll('th[data-k]').forEach(function (th) { th.classList.toggle('sorted', th.dataset.k === st.sort); th.dataset.dir = st.dir > 0 ? '▲' : '▼'; });
        }
        el.innerHTML = '<div class="g-bar"><input class="g-q" placeholder="Search every column…"><span class="g-count muted small"></span><span class="sp"></span>' +
            (o.tools || '') + '<button class="btn sm g-csv"><i class="fas fa-file-csv"></i> CSV</button><button class="btn sm g-xls"><i class="fas fa-file-excel"></i> Excel</button></div>' +
            '<div class="g-wrap"><table class="g"><thead><tr>' + o.cols.map(function (c) { return '<th data-k="' + c.k + '" class="' + (c.num ? 'num' : '') + '"' + (c.w ? ' style="min-width:' + c.w + 'px"' : '') + ' title="' + SL.esc(c.tip || '') + '">' + SL.esc(c.label) + '</th>'; }).join('') +
            '</tr><tr class="g-f">' + o.cols.map(function (c) { return '<th><input data-k="' + c.k + '" placeholder="' + (c.num ? '>, <' : 'filter') + '"></th>'; }).join('') + '</tr></thead><tbody></tbody></table></div>' +
            '<div class="g-more"><button class="btn sm">Show more</button></div>';
        el.querySelector('.g-q').oninput = function () { st.q = this.value.trim().toLowerCase(); paint(); };
        el.querySelectorAll('.g-f input').forEach(function (i) { i.oninput = function () { st.f[i.dataset.k] = i.value; paint(); }; });
        el.querySelectorAll('th[data-k]').forEach(function (th) { th.onclick = function () { if (st.sort === th.dataset.k) st.dir = -st.dir; else { st.sort = th.dataset.k; st.dir = -1; } paint(); }; });
        el.querySelector('.g-more button').onclick = function () { st.limit += 500; paint(); };
        el.querySelector('.g-csv').onclick = function () { SL.csv((o.name || 'sales-lens') + '.csv', o.cols, rows()); };
        el.querySelector('.g-xls').onclick = function () { SL.xlsx((o.name || 'sales-lens') + '.xlsx', [{ name: o.name || 'Sales Lens', cols: o.cols, rows: rows() }]); };
        el.querySelector('tbody').addEventListener('click', function (e) {
            if (e.target.closest('button,a,input')) return;
            var tr = e.target.closest('tr[data-i]'); if (tr && o.onRow) o.onRow(o.rows[+tr.dataset.i]);
        });
        paint();
        return { paint: paint, rows: rows, state: st };
    };

    // ── charts ────────────────────────────────────────────────────
    var charts = {};
    SL.chart = function (id, cfg) {
        if (charts[id]) { try { charts[id].destroy(); } catch (e) { } delete charts[id]; }
        var c = document.getElementById(id);
        if (!c || !window.Chart) { if (c) c.parentNode.innerHTML = '<div class="muted small">Charts need the internet (Chart.js).</div>'; return null; }
        cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } } }, cfg.options || {});
        charts[id] = new window.Chart(c, cfg);
        return charts[id];
    };
    SL.destroyCharts = function () { Object.keys(charts).forEach(function (k) { try { charts[k].destroy(); } catch (e) { } delete charts[k]; }); };
    SL.palette = ['#c2410c', '#2563eb', '#16a34a', '#9333ea', '#0891b2', '#d97706', '#db2777', '#475569'];

    // ── dialogs ───────────────────────────────────────────────────
    SL.modal = function (title, html, buttons, wide) {
        SL.close();
        var m = document.createElement('div'); m.className = 'sl-modal'; m.id = 'sl-modal';
        m.innerHTML = '<div class="box' + (wide ? ' wide' : '') + '"><div class="mh"><b>' + SL.esc(title) + '</b><span class="sp"></span><button class="x" title="Close (Esc)">✕</button></div><div class="mb">' + html + '</div>' +
            '<div class="mf"></div></div>';
        document.body.appendChild(m);
        var f = m.querySelector('.mf');
        (buttons || [{ label: 'Close' }]).forEach(function (b) { var e = document.createElement('button'); e.className = 'btn ' + (b.cls || ''); e.innerHTML = b.label; e.onclick = function () { if (!b.onClick || b.onClick() !== false) SL.close(); }; f.appendChild(e); });
        m.querySelector('.x').onclick = SL.close;
        m.addEventListener('mousedown', function (e) { if (e.target === m) SL.close(); });
        return m.querySelector('.mb');
    };
    SL.close = function () { var m = document.getElementById('sl-modal'); if (m) m.remove(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') SL.close(); });

    // ── APEX copy (WMS_SI_*): the shared record ───────────────────
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var A = SL.apex = {};
    A.base = function () { var b = (SL.settings && SL.settings.apexBase) || ''; return (b ? b.replace(/\/+$/, '') : ORDS) + '/WAREHOUSEMANAGEMENT/ai'; };
    A.where = function () { return (SL.settings && SL.settings.apexBase) ? 'the APEX set in Settings' : 'the app\'s APEX'; };
    A.ORDS = ORDS;
    function gw(op, body, base) {
        return SL.host('executePost', { fullUrl: (base || A.base()) + '/' + op, body: JSON.stringify(Object.assign({ appUser: SL.user() }, body)) }, 120000).then(function (r) {
            var t = r && r.rest ? r.text : r; var d; try { d = typeof t === 'string' ? JSON.parse(t) : t; } catch (e) { throw new Error('Unexpected answer from the APEX gateway'); }
            if (!d || d.success === false) throw new Error((d && (d.error || d.message)) || 'APEX gateway error');
            return d;
        });
    }
    /** wms: true = the app's own APEX (the WMS tables, e.g. the cancellation log), whatever Settings › APEX says */
    A.rows = function (sql, max, wms) {
        return gw('executequery', { sql: sql, maxRows: Math.min(max || 1000, 1000) }, wms ? ORDS + '/WAREHOUSEMANAGEMENT/ai' : null).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) { if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; } var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x; });
        });
    };
    A.write = function (sql) { return gw('executewrite', { sql: sql }); };
    function v(s, n) { if (s == null || s === '') return 'NULL'; s = String(s); if (n && s.length > n) s = s.slice(0, n); return "'" + s.replace(/'/g, "''") + "'"; }
    function num(x) { return x == null || x === '' || !isFinite(+x) ? 'NULL' : String(+x); }
    A.v = v; A.num = num;
    A.TABLES = {
        WMS_SI_RUNS: "CREATE TABLE wms_si_runs (run_id VARCHAR2(60) PRIMARY KEY, run_at VARCHAR2(30), version VARCHAR2(60), pod VARCHAR2(20), last_month NUMBER, window_from NUMBER, window_to NUMBER, lines NUMBER, customers NUMBER, items NUMBER, opportunities NUMBER, lost_revenue NUMBER, lost_margin NUMBER, recoverable_margin NUMBER, quarantined NUMBER, recon_diff NUMBER, seconds NUMBER, app_user VARCHAR2(200), pc_name VARCHAR2(100), summary_json VARCHAR2(4000), created_date DATE DEFAULT SYSDATE)",
        WMS_SI_OPPS: "CREATE TABLE wms_si_opps (run_id VARCHAR2(60), opp_id VARCHAR2(40), opp_rank NUMBER, account_number VARCHAR2(60), customer VARCHAR2(300), tier VARCHAR2(5), bu_id VARCHAR2(40), item VARCHAR2(200), description VARCHAR2(400), profit_center VARCHAR2(200), window_from NUMBER, window_to NUMBER, expected_qty NUMBER, actual_qty NUMBER, gap_qty NUMBER, drop_pct NUMBER, lost_revenue NUMBER, lost_margin NUMBER, recoverable_margin NUMBER, confidence NUMBER, score NUMBER, priority VARCHAR2(10), primary_cause VARCHAR2(30), secondary_cause VARCHAR2(30), evidence VARCHAR2(2000), action VARCHAR2(1000), owner VARCHAR2(100), salesperson VARCHAR2(200), due_date VARCHAR2(10), model_version VARCHAR2(60), scored_at VARCHAR2(30), created_date DATE DEFAULT SYSDATE, CONSTRAINT wms_si_opps_pk PRIMARY KEY (run_id, opp_id))",
        WMS_SI_FEEDBACK: "CREATE TABLE wms_si_feedback (fb_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, opp_id VARCHAR2(40), account_number VARCHAR2(60), item VARCHAR2(200), decision VARCHAR2(20), reason VARCHAR2(1000), outcome VARCHAR2(20), outcome_value NUMBER, note VARCHAR2(2000), app_user VARCHAR2(200), pc_name VARCHAR2(100), at_text VARCHAR2(30), created_date DATE DEFAULT SYSDATE)",
        WMS_SI_CUST_SCORES: "CREATE TABLE wms_si_cust_scores (run_id VARCHAR2(60), account_number VARCHAR2(60), risk NUMBER, risk_band VARCHAR2(10), revenue_12 NUMBER, revenue_at_risk NUMBER, reasons VARCHAR2(2000), model_version VARCHAR2(60), created_date DATE DEFAULT SYSDATE, CONSTRAINT wms_si_cust_pk PRIMARY KEY (run_id, account_number))",
        WMS_SI_ORDER_RISK: "CREATE TABLE wms_si_order_risk (run_id VARCHAR2(60), fulfill_line_id VARCHAR2(40), order_number VARCHAR2(60), account_number VARCHAR2(60), item VARCHAR2(200), promised VARCHAR2(10), risk NUMBER, main_risk VARCHAR2(20), value_at_risk NUMBER, reasons VARCHAR2(2000), created_date DATE DEFAULT SYSDATE, CONSTRAINT wms_si_risk_pk PRIMARY KEY (run_id, fulfill_line_id))",
        WMS_SI_SIMS: "CREATE TABLE wms_si_sims (sim_id VARCHAR2(60) PRIMARY KEY, name VARCHAR2(200), run_at VARCHAR2(30), app_user VARCHAR2(200), delta_revenue NUMBER, delta_margin NUMBER, margin_low NUMBER, margin_high NUMBER, scenario_json VARCHAR2(4000), result_json VARCHAR2(4000), model_version VARCHAR2(60), created_date DATE DEFAULT SYSDATE)",
        WMS_SI_MODELS: "CREATE TABLE wms_si_models (run_id VARCHAR2(60), model VARCHAR2(40), version VARCHAR2(60), method VARCHAR2(100), trained_at VARCHAR2(30), train_from NUMBER, train_to NUMBER, train_rows NUMBER, metrics_json VARCHAR2(2000), created_date DATE DEFAULT SYSDATE, CONSTRAINT wms_si_models_pk PRIMARY KEY (run_id, model))",
        WMS_SI_SETTINGS: "CREATE TABLE wms_si_settings (setting_key VARCHAR2(80) PRIMARY KEY, setting_value VARCHAR2(4000), changed_by VARCHAR2(200), changed_date DATE DEFAULT SYSDATE)"
    };
    var ensured = null;
    A.ensure = function () {
        if (ensured) return ensured;
        ensured = A.rows("SELECT table_name AS T FROM user_tables WHERE table_name LIKE 'WMS_SI_%'", 100).then(function (r) {
            var have = {}; r.forEach(function (x) { have[x.T] = 1; });
            var miss = Object.keys(A.TABLES).filter(function (t) { return !have[t]; });
            return miss.reduce(function (p, t) { return p.then(function () { return A.write(A.TABLES[t]); }); }, Promise.resolve()).then(function () { return miss; });
        });
        ensured.catch(function () { ensured = null; });
        return ensured;
    };
    function insertRows(table, cols, rows, size) {
        var parts = [];
        for (var i = 0; i < rows.length; i += size) parts.push(rows.slice(i, i + size));
        return parts.reduce(function (p, part) {
            return p.then(function () {
                return A.write('INSERT INTO ' + table + ' (' + cols.join(', ') + ') ' + part.map(function (r) { return 'SELECT ' + r.join(', ') + ' FROM dual'; }).join(' UNION ALL '));
            });
        }, Promise.resolve());
    }
    A.insertRows = insertRows;
    /** a finished run → APEX: the run row, the top opportunities, customer scores, order risk and model metrics (once per run id) */
    A.pushRun = function (onStep) {
        var step = onStep || function () { };
        var top = Math.max(100, Math.min(10000, +((SL.settings || {}).topToApex) || 2000));
        return A.ensure().then(function () {
            return SL.qs(['SELECT * FROM sl_runs ORDER BY built_at DESC LIMIT 1']);
        }).then(function (r) {
            var run = r[0][0]; if (!run) throw new Error('No run to copy.');
            var s = SL.json(run.summary, {});
            return A.rows('SELECT COUNT(*) AS N FROM wms_si_runs WHERE run_id = ' + v(run.run_id)).then(function (x) {
                if (+x[0].N) return { already: true, run_id: run.run_id };
                step('opportunities');
                return SL.qs(['SELECT * FROM sl_opps ORDER BY rank LIMIT ' + top,
                    'SELECT s.account_number, s.risk, s.risk_band, s.revenue_at_risk, s.reasons, c.revenue_12 FROM sl_cust_scores s LEFT JOIN sl_customers c USING (account_number) ORDER BY s.risk DESC LIMIT ' + top,
                    'SELECT * FROM sl_order_risk ORDER BY value_at_risk DESC LIMIT ' + top, 'SELECT * FROM sl_models'], top).then(function (d) {
                        var o = d[0], c = d[1], k = d[2], m = d[3];
                        return insertRows('wms_si_opps', ['run_id', 'opp_id', 'opp_rank', 'account_number', 'customer', 'tier', 'bu_id', 'item', 'description', 'profit_center', 'window_from', 'window_to', 'expected_qty', 'actual_qty', 'gap_qty', 'drop_pct', 'lost_revenue', 'lost_margin', 'recoverable_margin', 'confidence', 'score', 'priority', 'primary_cause', 'secondary_cause', 'evidence', 'action', 'owner', 'salesperson', 'due_date', 'model_version', 'scored_at'],
                            o.map(function (x) { return [v(run.run_id), v(x.opp_id), num(x.rank), v(x.account_number), v(x.customer, 300), v(x.tier), v(x.bu_id), v(x.item, 200), v(x.description, 400), v(x.profit_center, 200), num(x.window_from), num(x.window_to), num(x.expected_qty), num(x.actual_qty), num(x.gap_qty), num(x.drop_pct), num(x.lost_revenue), num(x.lost_margin), num(x.recoverable_margin), num(x.confidence), num(x.score), v(x.priority), v(x.primary_cause), v(x.secondary_cause), v(x.evidence, 1900), v(x.action, 990), v(x.owner, 100), v(x.salesperson, 200), v(x.due_date), v(x.model_version), v(x.scored_at)]; }), 25)
                            .then(function () { step('customer scores'); return insertRows('wms_si_cust_scores', ['run_id', 'account_number', 'risk', 'risk_band', 'revenue_12', 'revenue_at_risk', 'reasons', 'model_version'], c.map(function (x) { return [v(run.run_id), v(x.account_number), num(x.risk), v(x.risk_band), num(x.revenue_12), num(x.revenue_at_risk), v(typeof x.reasons === 'string' ? x.reasons : JSON.stringify(x.reasons || []), 1900), v(run.version)]; }), 60); })
                            .then(function () { step('order risk'); return insertRows('wms_si_order_risk', ['run_id', 'fulfill_line_id', 'order_number', 'account_number', 'item', 'promised', 'risk', 'main_risk', 'value_at_risk', 'reasons'], k.map(function (x) { return [v(run.run_id), v(x.fulfill_line_id), v(x.order_number), v(x.account_number), v(x.item_number), v(x.promised), num(x.risk), v(x.main_risk), num(x.value_at_risk), v(String(x['why_' + x.main_risk] || ''), 1900)]; }), 60); })
                            .then(function () { step('models'); return insertRows('wms_si_models', ['run_id', 'model', 'version', 'method', 'trained_at', 'train_from', 'train_to', 'train_rows', 'metrics_json'], m.map(function (x) { return [v(run.run_id), v(x.model), v(x.version), v(x.method), v(x.trained_at), num(x.train_from), num(x.train_to), num(x.rows), v(x.metrics, 1900)]; }), 20); })
                            .then(function () {
                                step('run');
                                return A.write('INSERT INTO wms_si_runs (run_id, run_at, version, pod, last_month, window_from, window_to, lines, customers, items, opportunities, lost_revenue, lost_margin, recoverable_margin, quarantined, recon_diff, seconds, app_user, summary_json) SELECT ' +
                                    [v(run.run_id), v(run.built_at), v(run.version), v(s.pod), num(s.last_month), num((s.window || [])[0]), num((s.window || []).slice(-1)[0]), num(s.lines), num(s.customers), num(s.items), num(s.opportunities), num((s.stats || {}).lost_revenue), num((s.stats || {}).lost_margin), num((s.stats || {}).recoverable_margin), num(s.quarantined), num(s.recon_diff), num(s.seconds), v(SL.user()), v(JSON.stringify({ steps: s.steps, stats: s.stats }), 3900)].join(', ') + ' FROM dual');
                            })
                            .then(function () { return { run_id: run.run_id, opps: o.length, customers: c.length, risk: k.length }; });
                    });
            });
        });
    };
    A.feedback = function (row) {
        return A.ensure().then(function () {
            return A.write('INSERT INTO wms_si_feedback (opp_id, account_number, item, decision, reason, outcome, outcome_value, note, app_user, at_text) SELECT ' +
                [v(row.opp_id), v(row.account_number), v(row.item), v(row.decision), v(row.reason, 990), v(row.outcome), num(row.value), v(row.note, 1990), v(SL.user()), v(row.at)].join(', ') + ' FROM dual');
        });
    };
    A.feedbackAll = function () {
        return A.rows("SELECT opp_id AS OPP_ID, decision AS DECISION, reason AS REASON, outcome AS OUTCOME, outcome_value AS VALUE, note AS NOTE, app_user AS BY_USER, at_text AS AT FROM wms_si_feedback ORDER BY fb_id", 1000);
    };
    A.sim = function (s) {
        return A.ensure().then(function () {
            return A.write('INSERT INTO wms_si_sims (sim_id, name, run_at, app_user, delta_revenue, delta_margin, margin_low, margin_high, scenario_json, result_json, model_version) SELECT ' +
                [v(s.sim_id), v((s.scenario || {}).name, 200), v(s.at), v(SL.user()), num((s.delta || {}).revenue), num((s.delta || {}).margin), num((s.range || {}).margin_low), num((s.range || {}).margin_high),
                    v(JSON.stringify(s.scenario || {}), 3900), v(JSON.stringify({ baseline: s.baseline, delta: s.delta, levers: s.levers }), 3900), v(s.model_version)].join(', ') + ' FROM dual');
        });
    };
    A.saveSettings = function (obj) {
        return A.ensure().then(function () {
            return A.write("MERGE INTO wms_si_settings t USING (SELECT 'SETTINGS' AS k FROM dual) s ON (t.setting_key = s.k) WHEN MATCHED THEN UPDATE SET setting_value = " + v(JSON.stringify(obj), 3990) +
                ', changed_by = ' + v(SL.user()) + ', changed_date = SYSDATE WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, changed_by) VALUES (s.k, ' + v(JSON.stringify(obj), 3990) + ', ' + v(SL.user()) + ')');
        });
    };
    A.status = function () {
        return A.rows("SELECT (SELECT COUNT(*) FROM wms_si_runs) AS RUNS, (SELECT MAX(run_at) FROM wms_si_runs) AS LAST_RUN, (SELECT COUNT(*) FROM wms_si_opps) AS OPPS, " +
            "(SELECT COUNT(*) FROM wms_si_feedback) AS FEEDBACK, (SELECT COUNT(*) FROM wms_si_sims) AS SIMS FROM dual", 1);
    };
})();
