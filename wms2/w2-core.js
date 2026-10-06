/* WMS 2.0 — core: state (instance + trip date), host bridge (the copied WMS sendMessageToCSharp), the local DuckDB copy
   (w2Put / w2Query), APEX gateway, Fusion calls, the left menu, grid, modal, drawer, busy banner and quick find.
   Every screen reads DuckDB; W2.sync fills it from the same ORDS endpoints / tables the WMS module uses. */
(function () {
    'use strict';
    var W2 = window.W2 = window.W2 || {};
    W2.ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    W2.GATEWAY = W2.ORDS + '/WAREHOUSEMANAGEMENT/ai';
    W2.FUSION = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };
    W2.pages = {}; W2.order = [];

    // ── small helpers ─────────────────────────────────────────
    var $ = W2.$ = function (id) { return document.getElementById(id); };
    W2.esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    W2.lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    W2.n = function (v) { var x = parseFloat(v); return isFinite(x) ? x : 0; };
    W2.fmt = function (v, d) { var x = W2.n(v); return x.toLocaleString(undefined, { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
    W2.pct = function (a, b) { return b ? Math.round(100 * a / b) : 0; };
    W2.ls = function (k, v) { try { if (v === undefined) { var x = localStorage.getItem(k); return x == null ? null : JSON.parse(x); } localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
    W2.user = function () { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } };
    W2.pc = function () { var k = 'w2.pcid'; var v = W2.ls(k); if (!v) { v = 'PC-' + Math.random().toString(36).slice(2, 8).toUpperCase(); W2.ls(k, v); } return v; };
    W2.toast = function (m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); };
    W2.ago = function (iso) {
        if (!iso) return 'never';
        var t = new Date(String(iso).replace(' ', 'T')).getTime(); if (!isFinite(t)) return iso;
        var s = Math.max(0, Math.round((Date.now() - t) / 1000));
        return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago';
    };
    W2.pool = function (items, n, fn) {
        var i = 0;
        function next() { if (i >= items.length || W2.stopping) return Promise.resolve(); var idx = i++; return Promise.resolve().then(function () { return fn(items[idx], idx); }).catch(function () {}).then(next); }
        var w = []; for (var k = 0; k < Math.min(n, items.length); k++) w.push(next());
        return Promise.all(w);
    };
    W2.chunks = function (a, n) { var out = []; for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

    // ── dates ─────────────────────────────────────────────────
    W2.iso = function (d) { var z = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
    W2.addDays = function (iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return W2.iso(d); };
    W2.today = function () { return W2.iso(new Date()); };
    /** Local time as YYYY-MM-DDTHH:MM:SS (the host writes synced_at the same way). */
    W2.now = function () { var d = new Date(), z = function (n) { return ('0' + n).slice(-2); }; return W2.iso(d) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); };
    W2.dmy = function (iso) { var p = iso.split('-'); return p[2] + '-' + p[1] + '-' + p[0]; };
    W2.dayName = function (iso) {
        var t = W2.today();
        if (iso === t) return 'Today'; if (iso === W2.addDays(t, 1)) return 'Tomorrow'; if (iso === W2.addDays(t, -1)) return 'Yesterday';
        return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    };
    /** Any date the endpoints return (ISO, 06-OCT-26, 06-10-2026, 2026/10/06 …) as YYYY-MM-DD, or '' */
    W2.toIso = function (v) {
        if (!v) return '';
        var s = String(v).trim(), m;
        if ((m = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
        if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
        var mon = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
        if ((m = s.toUpperCase().match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})/)) && mon[m[2]]) { var y = +m[3]; if (y < 100) y += 2000; return y + '-' + ('0' + mon[m[2]]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
        var d = new Date(s); return isFinite(d.getTime()) ? W2.iso(d) : '';
    };

    // ── state: instance + trip date (default today + 1) ───────
    W2.state = { pod: 'PROD', date: null, page: 'dash', params: {} };
    W2.pod = function () { return W2.state.pod; };
    W2.date = function () { return W2.state.date; };
    W2.setDate = function (iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return;
        W2.state.date = iso; try { sessionStorage.setItem('w2.date', iso); } catch (e) {}
        paintTop(); W2.emit('date'); W2.render();
        W2.sync.ensureFresh();
    };
    W2.setPod = function (pod) {
        W2.state.pod = pod === 'TEST' ? 'TEST' : 'PROD'; W2.ls('w2.pod', W2.state.pod);
        paintTop(); W2.emit('pod'); W2.render(); W2.sync.ensureFresh();
    };
    var listeners = {};
    W2.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
    W2.emit = function (ev, d) { (listeners[ev] || []).forEach(function (fn) { try { fn(d); } catch (e) { console.warn('[W2]', e); } }); };

    // ── host bridge (the copied WMS sendMessageToCSharp) ──────
    W2.hasHost = function () { return !!(window.chrome && window.chrome.webview); };
    /** Any host action → Promise of its data. Errors (and { ok:false }) reject with a message. */
    W2.call = function (action, payload, ms) {
        return new Promise(function (resolve, reject) {
            if (!W2.hasHost()) { reject('Open WMS 2.0 inside the Gray\'s WMS app.'); return; }
            var msg = Object.assign({ action: action, appUser: W2.user() }, payload || {});
            sendMessageToCSharp(msg, function (err, data) {
                if (err) { reject(typeof err === 'string' ? err : (err.message || JSON.stringify(err))); return; }
                resolve(data);
            }, ms || 120000, false);
        });
    };
    function parse(d) { if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return d; } } return d; }
    W2.items = function (j) { j = parse(j); return Array.isArray(j) ? j : (j && (j.items || j.ITEMS || j.rows)) || []; };
    W2.get = function (url, ms) { return W2.call('executeGet', { fullUrl: url }, ms || 120000).then(parse); };
    W2.post = function (url, body, ms) { return W2.call('executePost', { fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 120000).then(parse); };
    W2.fusionUrl = function (path, pod) { return (W2.FUSION[pod || W2.pod()] || W2.FUSION.PROD) + path; };
    W2.fusionGet = function (url, pod) { return W2.call('executeOracleFusionGet', { fullUrl: url, instance: pod || W2.pod() }, 120000).then(parse); };
    W2.fusionPost = function (url, body, pod) { return W2.call('executeOracleFusionPost', { fullUrl: url, body: JSON.stringify(body), instance: pod || W2.pod() }, 120000).then(parse); };
    W2.fusionPatch = function (url, body, pod) { return W2.call('executeOracleFusionPatch', { fullUrl: url, body: JSON.stringify(body), instance: pod || W2.pod() }, 120000).then(parse); };
    // ── APEX gateway (read / write) ───────────────────────────
    W2.apexRows = function (sql, max) {
        return W2.post(W2.GATEWAY + '/executequery', { appUser: W2.user(), sql: sql, maxRows: max || 5000 }).then(function (d) {
            if (!d || d.success === false) throw (d && d.error) || 'APEX query failed';
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    };
    W2.apexWrite = function (sql) {
        return W2.post(W2.GATEWAY + '/executewrite', { appUser: W2.user(), sql: sql }).then(function (d) {
            if (!d || d.success === false) throw (d && d.error) || 'APEX write failed';
            return d;
        });
    };

    // ── the local DuckDB copy ─────────────────────────────────
    function rowsOf(d) {
        var cols = (d.columns || []).map(function (c) { return String(c).toLowerCase(); });
        return (d.rows || []).map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; });
    }
    W2.q = function (sql, max) {
        return W2.call('w2Query', { sql: sql, maxRows: max || 200000 }, 120000).then(function (d) {
            if (!d || d.ok === false) throw (d && d.error) || 'query failed';
            return rowsOf(d);
        });
    };
    /** Several queries in one round trip; a failed one gives [] (and is logged) so a screen still draws. */
    W2.qs = function (list) {
        return W2.call('w2Queries', { queries: list }, 120000).then(function (d) {
            return (d && d.results || []).map(function (r, i) { if (r.error) { console.warn('[W2] query failed:', r.error, '\n', list[i]); return []; } return rowsOf(r); });
        });
    };
    W2.put = function (table, scope, rows, opts) {
        opts = opts || {};
        return W2.call('w2Put', { table: table, scope: scope || {}, rows: rows || [], replaceAll: !!opts.all, columns: opts.columns || W2.SCHEMA[table] || [] }, 300000).then(function (d) {
            if (!d || d.ok === false) throw (d && d.error) || 'save failed';
            return d;
        });
    };
    /** Column name as the host stores it (same rule as Wms2Store.Col). */
    W2.col = function (k) { var s = String(k || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''); if (!s) s = 'col'; if (/^\d/.test(s)) s = 'c_' + s; return s.slice(0, 60); };
    /** A row from an endpoint with lower-case column names (+ the original row as raw_json when asked). */
    W2.norm = function (row, keepRaw) {
        var o = {};
        Object.keys(row || {}).forEach(function (k) { var v = row[k]; o[W2.col(k)] = v == null ? null : (typeof v === 'object' ? JSON.stringify(v) : String(v)); });
        if (keepRaw) o.raw_json = JSON.stringify(row);
        return o;
    };
    /** The first field of a row that matches one of the names (any case) or the pattern. */
    W2.pick = function (row, names, re) {
        var keys = Object.keys(row || {});
        for (var i = 0; i < names.length; i++) { var k = keys.filter(function (x) { return x.toUpperCase() === names[i]; })[0]; if (k && row[k] != null && row[k] !== '') return row[k]; }
        if (re) { var k2 = keys.filter(function (x) { return re.test(x); })[0]; if (k2) return row[k2]; }
        return null;
    };

    // Columns every table has from the start (screens query them before the first sync)
    W2.SCHEMA = {
        w2_trips: ['pod', 'trip_date', 'trip_id', 'lorry', 'loading_bay', 'priority', 'picker', 'order_count', 'raw_json'],
        w2_trip_lines: ['pod', 'trip_date', 'trip_id', 'order_number', 'order_type', 'account_number', 'account_name', 'picker', 'pick_confirm_st', 'lorry', 'line_status', 'instance_name', 'raw_json'],
        w2_ship_lines: ['pod', 'trip_date', 'order_number', 'line', 'item', 'line_status', 'line_status_code', 'bucket', 'requested_qty', 'staged_qty', 'shipped_qty'],
        w2_ship_checked: ['pod', 'trip_date', 'order_number', 'lines', 'checked_at', 'error'],
        w2_order_lines: ['pod', 'trip_date', 'trip_id', 'order_number', 'line_number', 'item', 'status', 'fulfill_line_id', 'ordered_qty', 'raw_json'],
        w2_print: ['trip_date', 'order_number', 'trip_id', 'customer_name', 'download_status', 'print_status', 'overall_status', 'retry_count', 'error_message', 'print_completed', 'changed'],
        w2_picker: ['trip_date', 'order_number', 'picker_name', 'loading_bay', 'instance', 'assigned_at', 'pickslip', 'pickwave'],
        w2_pickers: ['pod', 'picker_name', 'raw_json'],
        w2_mra: ['pod', 'order_number', 'trip_date', 'trip_id', 'status', 'irn', 'msg', 'checked_at', 'source', 'secs', 'timings', 'log'],
        w2_mra_flag: ['instance_name', 'interface_flag', 'changed_by', 'changed_at'],
        w2_pending: ['pod', 'order_number', 'account_name', 'order_date', 'line_count', 'raw_json'],
        w2_bogo: ['pod', 'main_item', 'promo_item', 'promo_name'],
        w2_cancel_log: ['pod', 'run_id', 'ts', 'pc', 'by_user', 'trip_date', 'trip_id', 'order_number', 'line_number', 'item', 'status_before', 'fulfill_line_id', 'via', 'result', 'message', 'response'],
        w2_runs: ['pod', 'run_id', 'kind', 'trip_date', 'started_at', 'ended_at', 'ms', 'summary', 'pc', 'by_user'],
        w2_sync_runs: ['pod', 'trip_date', 'kind', 'ts', 'ms', 'steps'],
        w2_pick_runs: ['pod', 'run_id', 'trip_date', 'trip_id', 'order_number', 'mode', 'result', 'message', 'ts', 'ms']
    };
    W2.ensureTables = function () {
        return Promise.all(Object.keys(W2.SCHEMA).map(function (t) { return W2.put(t, { pod: '__schema__' }, [], { columns: W2.SCHEMA[t] }).catch(function (e) { console.warn('[W2] table', t, e); }); }));
    };

    // ── busy banner ───────────────────────────────────────────
    var busyT = null;
    W2.busy = {
        start: function (label, stop) {
            clearTimeout(busyT);
            var b = $('w2-busy'); b.className = 'on'; $('w2-busy-i').className = 'fa-solid fa-circle-notch fa-spin'; $('w2-busy-t').textContent = label;
            var x = $('w2-busy-x'); x.style.display = stop ? '' : 'none'; x.onclick = stop || null;
            W2.busy.t0 = Date.now();
        },
        step: function (label) { if ($('w2-busy').classList.contains('on')) $('w2-busy-t').textContent = label; },
        done: function (label, err) {
            var b = $('w2-busy');
            if (!label) { b.className = ''; return; }
            b.className = 'on ' + (err ? 'err' : 'ok'); $('w2-busy-i').className = err ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-check';
            $('w2-busy-t').textContent = label; $('w2-busy-x').style.display = 'none';
            busyT = setTimeout(function () { b.className = ''; }, err ? 12000 : 5000);
        }
    };

    // ── modal + drawer ────────────────────────────────────────
    W2.modal = function (title, html, buttons, width) {
        var m = document.createElement('div'); m.className = 'w2-modal';
        m.innerHTML = '<div class="box" style="--w:' + (width || 760) + 'px"><div class="hd"><span class="grow">' + title + '</span><button class="icon" data-x><i class="fa-solid fa-xmark"></i></button></div><div class="bd"></div><div class="ft"></div></div>';
        m.querySelector('.bd').innerHTML = html;
        var close = function () { m.remove(); };
        m.querySelector('[data-x]').onclick = close;
        m.addEventListener('mousedown', function (e) { if (e.target === m) close(); });
        (buttons || [{ label: 'Close' }]).forEach(function (b) {
            var e = document.createElement('button'); e.className = 'btn ' + (b.cls || ''); e.innerHTML = b.label;
            e.onclick = function () { var r = b.onClick ? b.onClick(m, close) : null; if (r !== false && !b.keep) close(); };
            m.querySelector('.ft').appendChild(e);
        });
        document.body.appendChild(m);
        m.close = close;
        return m;
    };
    W2.confirm = function (title, html, okLabel, cls) {
        return new Promise(function (resolve) {
            W2.modal(title, html, [{ label: 'Cancel', onClick: function () { resolve(false); } }, { label: okLabel || 'OK', cls: cls || 'primary', onClick: function () { resolve(true); } }], 560);
        });
    };
    W2.drawer = function (title, html) {
        var old = document.querySelector('.w2-drawer'); if (old) old.remove();
        var d = document.createElement('div'); d.className = 'w2-drawer';
        d.innerHTML = '<div class="hd"><span style="flex:1">' + title + '</span><button class="icon" data-x><i class="fa-solid fa-xmark"></i></button></div><div class="bd"></div>';
        d.querySelector('.bd').innerHTML = html;
        d.querySelector('[data-x]').onclick = function () { d.remove(); };
        document.body.appendChild(d);
        return d;
    };
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { var m = document.querySelectorAll('.w2-modal'); if (m.length) m[m.length - 1].remove(); else { var d = document.querySelector('.w2-drawer'); if (d) d.remove(); } }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); W2.find(); }
    });

    // ── grid: filter per column, sort, totals, CSV, row click ─
    /** cols: [{k, t (title), num, fmt(v,row) → html, w, sum}] · opts: {onRow(row), key, max, csv (file name), empty, title, tools (html), select} */
    W2.grid = function (el, rows, cols, opts) {
        opts = opts || {};
        var st = { sort: opts.sort || null, dir: opts.dir || 1, f: {}, sel: {} };
        var box = document.createElement('div'); box.className = 'w2g';
        el.innerHTML = ''; el.appendChild(box);
        function val(r, c) { return r[c.k]; }
        function match(v, f) {
            if (!f) return true;
            var s = String(v == null ? '' : v).toLowerCase(); f = f.trim().toLowerCase();
            if (/^[<>]=?/.test(f)) { var n = parseFloat(f.replace(/^[<>]=?/, '')), x = parseFloat(v); if (!isFinite(x)) return false; return f[0] === '<' ? (f[1] === '=' ? x <= n : x < n) : (f[1] === '=' ? x >= n : x > n); }
            if (f[0] === '=') return s === f.slice(1);
            if (f[0] === '!') return s.indexOf(f.slice(1)) < 0;
            return s.indexOf(f) >= 0;
        }
        function view() {
            var list = rows.filter(function (r) { return cols.every(function (c) { return match(val(r, c), st.f[c.k]); }); });
            if (st.sort) {
                var c = cols.filter(function (x) { return x.k === st.sort; })[0];
                list.sort(function (a, b) {
                    var x = val(a, c), y = val(b, c);
                    if (c && c.num) { x = W2.n(x); y = W2.n(y); return (x - y) * st.dir; }
                    return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), undefined, { numeric: true }) * st.dir;
                });
            }
            return list;
        }
        function draw() {
            var list = view(), max = opts.max || 1000, shown = list.slice(0, max);
            var h = '<div class="bar">' + (opts.title ? '<b>' + opts.title + '</b>' : '') + '<span class="muted xs">' + W2.fmt(list.length) + (list.length !== rows.length ? ' of ' + W2.fmt(rows.length) : '') + ' rows</span><span class="grow"></span>' + (opts.tools || '') +
                '<button class="btn sm" data-csv><i class="fa-solid fa-file-csv"></i> CSV</button></div><div class="scroll"><table><thead><tr>' +
                (opts.select ? '<th style="width:26px"><input type="checkbox" data-all></th>' : '') +
                cols.map(function (c) { return '<th data-k="' + c.k + '" class="' + (st.sort === c.k ? 'sorted' : '') + (c.num ? ' num' : '') + '"' + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + W2.esc(c.t != null ? c.t : c.k) + (st.sort === c.k ? (st.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') +
                '</tr><tr class="flt">' + (opts.select ? '<th></th>' : '') + cols.map(function (c) { return '<th><input data-f="' + c.k + '" value="' + W2.esc(st.f[c.k] || '') + '" placeholder="filter"></th>'; }).join('') + '</tr></thead><tbody>';
            h += shown.map(function (r, i) {
                var key = opts.key ? r[opts.key] : i;
                return '<tr data-i="' + i + '" class="' + (opts.onRow ? 'click ' : '') + (st.sel[key] ? 'sel' : '') + '">' + (opts.select ? '<td><input type="checkbox" data-s="' + W2.esc(key) + '"' + (st.sel[key] ? ' checked' : '') + '></td>' : '') +
                    cols.map(function (c) { var v = val(r, c); return '<td class="' + (c.num ? 'num' : '') + '" title="' + W2.esc(c.fmt ? '' : v) + '">' + (c.fmt ? c.fmt(v, r) : c.num ? W2.fmt(v, c.d || 0) : W2.esc(v)) + '</td>'; }).join('') + '</tr>';
            }).join('');
            if (!shown.length) h += '<tr><td colspan="' + (cols.length + (opts.select ? 1 : 0)) + '" class="empty">' + (opts.empty || 'Nothing to show.') + '</td></tr>';
            h += '</tbody>';
            if (cols.some(function (c) { return c.sum; }) && list.length) {
                h += '<tfoot><tr>' + (opts.select ? '<td></td>' : '') + cols.map(function (c, i) { return '<td class="' + (c.num ? 'num' : '') + '">' + (c.sum ? W2.fmt(list.reduce(function (s, r) { return s + W2.n(val(r, c)); }, 0), c.d || 0) : i === 0 ? 'Total' : '') + '</td>'; }).join('') + '</tr></tfoot>';
            }
            h += '</table></div>' + (list.length > max ? '<div class="foot">Showing the first ' + max + ' rows — filter to narrow down; CSV has all ' + list.length + '.</div>' : '');
            box.innerHTML = h;
            box.querySelectorAll('th[data-k]').forEach(function (th) { th.onclick = function () { var k = th.dataset.k; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = 1; } draw(); }; });
            box.querySelectorAll('input[data-f]').forEach(function (inp) {
                inp.oninput = function () { st.f[inp.dataset.f] = inp.value; clearTimeout(inp._t); inp._t = setTimeout(function () { var pos = inp.selectionStart; draw(); var n = box.querySelector('input[data-f="' + inp.dataset.f + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }, 250); };
            });
            box.querySelector('[data-csv]').onclick = function () { W2.csv(opts.csv || 'wms2.csv', view(), cols); };
            if (opts.onRow) box.querySelectorAll('tbody tr[data-i]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('input,button,a')) return; opts.onRow(shown[+tr.dataset.i], e); }; });
            if (opts.select) {
                box.querySelectorAll('input[data-s]').forEach(function (cb) { cb.onchange = function () { st.sel[cb.dataset.s] = cb.checked; if (opts.onSelect) opts.onSelect(api.selected()); cb.closest('tr').classList.toggle('sel', cb.checked); }; });
                var all = box.querySelector('[data-all]'); if (all) all.onchange = function () { view().forEach(function (r, i) { st.sel[opts.key ? r[opts.key] : i] = all.checked; }); draw(); if (opts.onSelect) opts.onSelect(api.selected()); };
            }
            if (opts.after) opts.after(box);
        }
        var api = {
            redraw: draw,
            set: function (r) { rows = r; draw(); },
            selected: function () { return rows.filter(function (r, i) { return st.sel[opts.key ? r[opts.key] : i]; }); },
            select: function (keys) { st.sel = {}; keys.forEach(function (k) { st.sel[k] = true; }); draw(); },
            view: view
        };
        if (opts.preselect) opts.preselect.forEach(function (k) { st.sel[k] = true; });
        draw();
        return api;
    };
    W2.csv = function (name, rows, cols) {
        cols = cols || Object.keys(rows[0] || {}).map(function (k) { return { k: k }; });
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = [cols.map(function (c) { return q(c.t || c.k); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c.k]); }).join(','); })).join('\r\n');
        var blob = new Blob(['﻿' + text], { type: 'text/csv' });
        if (typeof saveAs === 'function') saveAs(blob, name); else { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
    };

    // ── pills for statuses ────────────────────────────────────
    W2.STAGE = {
        'NOT CHECKED': ['', 'fa-hourglass-half', 'Not checked'], 'NO LINES': ['', 'fa-ban', 'No lines'], 'PENDING': ['', 'fa-clock', 'Pending'],
        'READY': ['w', 'fa-clock', 'Ready to release'], 'RELEASED': ['b', 'fa-share-from-square', 'Released to WH'], 'PART STAGED': ['b', 'fa-layer-group', 'Part staged'],
        'STAGED': ['b', 'fa-layer-group', 'Staged'], 'PART INTERFACED': ['w', 'fa-truck', 'Part interfaced'], 'INTERFACED': ['ok', 'fa-circle-check', 'Interfaced'], 'CANCELLED': ['x', 'fa-ban', 'Cancelled']
    };
    W2.stagePill = function (s) { var x = W2.STAGE[s] || ['', 'fa-circle', s || '—']; return '<span class="pill ' + x[0] + '"><i class="fa-solid ' + x[1] + '"></i>' + W2.esc(x[2]) + '</span>'; };
    W2.mraPill = function (s) {
        var m = { SENT: ['ok', 'Done'], DONE: ['ok', 'Interfaced'], ALREADY: ['ok', 'Done'], SKIPPED: ['', 'Not req.'], OFF: ['w', 'MRA off'], FAILED: ['x', 'Failed'], 'NOT SENT': ['w', 'Not sent'], 'CHECK FAILED': ['x', 'Check failed'], RUNNING: ['v', 'Sending…'] }[s] || ['', '—'];
        return '<span class="pill ' + m[0] + '">' + m[1] + '</span>';
    };
    W2.printPill = function (s) {
        var m = { PRINTED: ['ok', 'Printed'], FAILED: ['x', 'Failed'], QUEUED: ['w', 'Queued'], NONE: ['', 'Not queued'] }[s] || ['', s || '—'];
        return '<span class="pill ' + m[0] + '">' + m[1] + '</span>';
    };

    // ── pages + left menu ─────────────────────────────────────
    /** def: {title, icon, group, render(main, params) → Promise|void, badge() → {n, cls}} */
    W2.page = function (id, def) { W2.pages[id] = def; if (W2.order.indexOf(id) < 0) W2.order.push(id); };
    W2.GROUPS = [['Operate', ['dash', 'trips', 'futuretrip', 'orders', 'picking', 'pickrelease', 'autopilot', 'mra', 'printing', 'pending']], ['Analyse', ['insights']], ['Setup', ['data', 'settings']]];
    function paintNav() {
        var nav = $('nav'), h = '';
        W2.GROUPS.forEach(function (g) {
            h += '<div class="grp">' + g[0] + '</div>';
            g[1].forEach(function (id) {
                var p = W2.pages[id]; if (!p) return;
                h += '<button data-p="' + id + '" class="' + (W2.state.page === id ? 'on' : '') + '" title="' + W2.esc(p.title) + '"><i class="fa-solid ' + p.icon + '"></i><span>' + W2.esc(p.title) + '</span><b class="badge" data-b="' + id + '" style="display:none"></b></button>';
            });
        });
        h += '<button class="collapse" id="nav-min"><i class="fa-solid fa-angles-left"></i><span>Collapse</span></button>';
        nav.innerHTML = h;
        nav.querySelectorAll('button[data-p]').forEach(function (b) { b.onclick = function () { W2.go(b.dataset.p); }; });
        $('nav-min').onclick = function () { document.body.classList.toggle('nav-min'); W2.ls('w2.navmin', document.body.classList.contains('nav-min')); };
    }
    W2.badges = function (map) {
        Object.keys(map || {}).forEach(function (id) {
            var b = document.querySelector('[data-b="' + id + '"]'); if (!b) return;
            var v = map[id]; if (!v || !v.n) { b.style.display = 'none'; return; }
            b.style.display = ''; b.textContent = v.n; b.className = 'badge ' + (v.cls || '');
        });
    };
    W2.go = function (id, params) {
        if (!W2.pages[id]) id = 'dash';
        W2.state.page = id; W2.state.params = params || {};
        try { history.replaceState(null, '', '#' + id); } catch (e) {}
        document.querySelectorAll('#nav button[data-p]').forEach(function (b) { b.classList.toggle('on', b.dataset.p === id); });
        W2.render();
    };
    var renderSeq = 0;
    W2.render = function () {
        var p = W2.pages[W2.state.page]; if (!p) return;
        var seq = ++renderSeq, main = $('main');
        if (W2.charts) W2.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} });
        W2.charts = [];
        Promise.resolve().then(function () { return p.render(main, W2.state.params, function () { return seq === renderSeq; }); }).catch(function (e) {
            if (seq !== renderSeq) return;
            main.innerHTML = '<div class="callout bad"><b>This page could not be drawn.</b> ' + W2.esc(e && e.message || e) + '</div>';
            console.error('[W2] render', e);
        });
    };
    W2.chart = function (canvas, cfg) { if (typeof Chart === 'undefined' || !canvas) return null; var c = new Chart(canvas, cfg); W2.charts.push(c); return c; };
    W2.COLORS = ['#1d4ed8', '#0d9488', '#f59e0b', '#7c3aed', '#db2777', '#16a34a', '#64748b', '#ea580c'];

    // ── top bar ───────────────────────────────────────────────
    function paintTop() {
        $('t-pod').value = W2.pod(); $('t-date').value = W2.date();
        var t = W2.today();
        $('t-today').classList.toggle('on', W2.date() === t);
        $('t-tomorrow').classList.toggle('on', W2.date() === W2.addDays(t, 1));
    }
    W2.paintSync = function (info) {
        var el = $('t-sync'); if (!el) return;
        var cur = W2.sync && W2.sync.current;
        if (cur && cur.date === W2.date() && cur.pod === W2.pod()) {
            el.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> reading' + (cur.step ? ' · ' + W2.esc(cur.step) : '') + '…';
            el.title = cur.label; return;
        }
        if (info === undefined) { W2.sync.lastInfo().then(W2.paintSync); return; }
        if (!info || !info.ts) { el.innerHTML = '<span class="dot none"></span>not synced'; el.title = 'Press Refresh to read ' + W2.dayName(W2.date()) + ' from APEX and Fusion'; return; }
        var age = (Date.now() - new Date(info.ts.replace(' ', 'T')).getTime()) / 1000;
        el.innerHTML = '<span class="dot ' + (age > 600 ? 'old' : '') + '"></span>synced ' + W2.ago(info.ts);
        el.title = 'Local copy (DuckDB) of ' + W2.date() + ' · ' + W2.pod() + ' read ' + info.ts + (info.ms ? ' in ' + (info.ms / 1000).toFixed(1) + ' s' : '');
    };

    // ── quick find (Ctrl K): trips, orders, pickers, pages ────
    W2.find = function () {
        if (document.querySelector('.qf')) return;
        var q = document.createElement('div'); q.className = 'qf';
        q.innerHTML = '<div class="box"><input placeholder="Trip, order, customer, picker or page…" id="qf-i"><div id="qf-r"></div></div>';
        document.body.appendChild(q);
        var inp = q.querySelector('input'), res = q.querySelector('#qf-r'), items = [], on = 0;
        q.addEventListener('mousedown', function (e) { if (e.target === q) q.remove(); });
        inp.focus();
        function go(it) { q.remove(); it.go(); }
        function paint() { res.innerHTML = items.map(function (it, i) { return '<div class="r ' + (i === on ? 'on' : '') + '" data-i="' + i + '"><i class="fa-solid ' + it.icon + '"></i><span>' + it.html + '</span><span class="k">' + (it.k || '') + '</span></div>'; }).join('') || '<div class="r muted">Nothing found for ' + W2.esc(inp.value) + '.</div>'; res.querySelectorAll('[data-i]').forEach(function (r) { r.onclick = function () { go(items[+r.dataset.i]); }; }); }
        var tm = null;
        inp.oninput = function () {
            clearTimeout(tm); var s = inp.value.trim();
            tm = setTimeout(function () {
                var pages = W2.order.filter(function (id) { return W2.pages[id].title.toLowerCase().indexOf(s.toLowerCase()) >= 0; }).slice(0, 4)
                    .map(function (id) { return { icon: W2.pages[id].icon, html: 'Page: <b>' + W2.esc(W2.pages[id].title) + '</b>', go: function () { W2.go(id); } }; });
                if (s.length < 2) { items = pages; on = 0; paint(); return; }
                var like = W2.lit('%' + s.toLowerCase() + '%');
                W2.qs([
                    "SELECT DISTINCT trip_id, trip_date FROM w2_trip_lines WHERE lower(trip_id) LIKE " + like + " ORDER BY trip_date DESC LIMIT 6",
                    "SELECT order_number, any_value(trip_id) trip_id, any_value(trip_date) trip_date, any_value(account_name) account_name FROM w2_trip_lines WHERE lower(order_number) LIKE " + like + " OR lower(account_name) LIKE " + like + " GROUP BY 1 ORDER BY 3 DESC LIMIT 8",
                    "SELECT DISTINCT picker_name FROM w2_picker WHERE lower(picker_name) LIKE " + like + " LIMIT 4"
                ]).then(function (r) {
                    items = r[0].map(function (t) { return { icon: 'fa-truck', html: 'Trip <b>' + W2.esc(t.trip_id) + '</b>', k: t.trip_date, go: function () { if (t.trip_date && t.trip_date !== W2.date()) { W2.state.date = t.trip_date; paintTop(); } W2.go('trip', { trip: t.trip_id }); } }; })
                        .concat(r[1].map(function (o) { return { icon: 'fa-file-lines', html: 'Order <b>' + W2.esc(o.order_number) + '</b> · ' + W2.esc(o.account_name || '') + ' · trip ' + W2.esc(o.trip_id), k: o.trip_date, go: function () { if (o.trip_date && o.trip_date !== W2.date()) { W2.state.date = o.trip_date; paintTop(); } W2.go('trip', { trip: o.trip_id, order: o.order_number }); } }; }))
                        .concat(r[2].map(function (p) { return { icon: 'fa-person-walking', html: 'Picker <b>' + W2.esc(p.picker_name) + '</b>', go: function () { W2.go('picking', { picker: p.picker_name }); } }; }))
                        .concat(pages);
                    on = 0; paint();
                });
            }, 150);
        };
        inp.onkeydown = function (e) {
            if (e.key === 'ArrowDown') { on = Math.min(items.length - 1, on + 1); paint(); e.preventDefault(); }
            if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); paint(); e.preventDefault(); }
            if (e.key === 'Enter' && items[on]) go(items[on]);
            if (e.key === 'Escape') q.remove();
        };
        inp.oninput();
    };

    /** WMS 2.0 keeps its copy in DuckDB through the host actions w2Status / w2Put / w2Query (Wms2Store.cs). An app built
        before WMS 2.0 does not know them and never answers, so every screen would wait and stay empty: ask once, quickly. */
    W2.health = function () {
        $('main').innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Opening the local copy (DuckDB)…</div>';
        return W2.call('w2Status', {}, 15000).then(function (d) {
            if (d && d.ok === false) throw d.error || 'w2Status failed';
            W2.state.store = d; return true;
        }).catch(function (e) {
            var m = String(e && e.message || e);
            var old = /timeout|timed out|no response/i.test(m);
            $('main').innerHTML = '<div class="callout bad"><b>' + (old ? 'This build of the app does not have WMS 2.0\'s local database yet.' : 'The local copy (DuckDB) could not be opened.') + '</b><br>' +
                (old ? 'The page asked the app for <code>w2Status</code> and got no answer. The pages are loaded from the source folder, but the running GraysWMS.exe was built before WMS 2.0 ' +
                    '(it needs <code>classes\\Wms2Store.cs</code> and <code>classes\\Form1_Wms2Handlers.cs</code>). <b>Rebuild the app</b> (Visual Studio › Build, or <code>dotnet build</code>) and start it again.'
                    : W2.esc(m)) +
                '<div class="muted" style="margin-top:8px">' + W2.esc(m) + '</div>' +
                '<div class="row" style="margin-top:10px"><button class="btn primary" id="h-retry"><i class="fa-solid fa-rotate"></i> Try again</button></div></div>' + W2.archHtml();
            $('h-retry').onclick = function () { W2.start(); };
            return false;
        });
    };
    /** Where the data comes from — shown on the empty / error screens. */
    W2.archHtml = function () {
        return '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-diagram-project"></i> How WMS 2.0 gets its data</h3>' +
            '<div class="arch">' +
            '<div><b>APEX (ORDS)</b><span>trips, trip lines, pickers, print jobs, order lines, pending, MRA switch</span></div><i class="fa-solid fa-arrow-right"></i>' +
            '<div><b>Fusion</b><span>shipment lines (REST), MRA check (BIP)</span></div><i class="fa-solid fa-arrow-right"></i>' +
            '<div><b>App (C# host)</b><span>executeGet / executePost / executeOracleFusionGet / omBip — same calls as the WMS</span></div><i class="fa-solid fa-arrow-right"></i>' +
            '<div><b>DuckDB on this PC</b><span>C:\\fusion\\wms2\\wms2.duckdb (w2Put)</span></div><i class="fa-solid fa-arrow-right"></i>' +
            '<div><b>Every screen</b><span>reads DuckDB (w2Query) — fast, no waiting on APEX</span></div>' +
            '</div><p class="muted" style="margin:8px 0 0">APEX stays the master. A refresh reads the trip date from APEX / Fusion and replaces that date in DuckDB; it runs on open and every 3 minutes.</p></div>';
    };

    // ── start ─────────────────────────────────────────────────
    W2.start = function () {
        var pod = W2.ls('w2.pod') || (function () { try { return (sessionStorage.getItem('loggedInInstance') || '').toUpperCase(); } catch (e) { return ''; } })();
        W2.state.pod = pod === 'TEST' ? 'TEST' : 'PROD';
        var d = null; try { d = sessionStorage.getItem('w2.date'); } catch (e) {}
        W2.state.date = d || W2.addDays(W2.today(), 1);      // the trip date the warehouse works on: tomorrow
        if (W2.ls('w2.navmin')) document.body.classList.add('nav-min');
        paintNav(); paintTop();
        $('t-pod').onchange = function () { W2.setPod(this.value); };
        $('t-date').onchange = function () { W2.setDate(this.value); };
        $('t-prev').onclick = function () { W2.setDate(W2.addDays(W2.date(), -1)); };
        $('t-next').onclick = function () { W2.setDate(W2.addDays(W2.date(), 1)); };
        $('t-today').onclick = function () { W2.setDate(W2.today()); };
        $('t-tomorrow').onclick = function () { W2.setDate(W2.addDays(W2.today(), 1)); };
        $('t-refresh').onclick = function () { W2.sync.day(W2.date(), { full: true }); };
        $('t-find').onclick = W2.find;
        var h = (location.hash || '').replace('#', '');
        W2.state.page = W2.pages[h] ? h : 'dash';
        paintNav();
        if (!W2.hasHost()) { $('main').innerHTML = '<div class="callout warn"><b>Open WMS 2.0 inside the Gray\'s WMS app.</b> It reads APEX and Fusion through the app and keeps its copy in DuckDB on this PC.</div>'; return; }
        W2.health().then(function (ok) {
            if (!ok) return;
            W2.ensureTables().then(function () {
                W2.render();
                W2.sync.ensureFresh();
                W2.emit('ready');
            });
        });
        setInterval(function () { W2.sync.lastInfo().then(W2.paintSync); }, 15000);
    };
})();
