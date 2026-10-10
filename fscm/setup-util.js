/* Setup & Diagnostics — page helpers (SU). Built on the shared engine (core.js, FX) without changing it:
   pod URL checks, raw GET through the host relay, paging of absolute child-link URLs, a client-side paged table,
   tabs, file drop zones, Excel export (SheetJS), printable HTML reports (→ Save as PDF), small formatting helpers. */

var SU = {};

// ── pod / REST ─────────────────────────────────────────────────
SU.pod = function () { return FX.base[FX.instance]; };
SU.root = function () { return SU.pod() + '/fscmRestApi/resources/' + FX.ver + '/'; };
/** True when an absolute URL points at the logged-in pod's REST API (child links, "Run any GET"). */
SU.podUrlOk = function (url) {
    var u; try { u = new URL(url); } catch (e) { return false; }
    var p; try { p = new URL(SU.pod()); } catch (e) { return false; }
    return u.protocol === 'https:' && u.host.toLowerCase() === p.host.toLowerCase() && /^\/(fscm|hcm|crm)RestApi\/resources\//i.test(u.pathname);
};
/** GET an absolute pod URL, never throwing on HTTP status: → {status, ok, body, json, ms}. */
SU.raw = function (url) {
    if (!SU.podUrlOk(url)) return Promise.reject('Only ' + SU.pod() + '/fscmRestApi/resources/… URLs on the ' + FX.instance + ' pod can be called.');
    var t0 = Date.now();
    return FX.host('dataLoadFusionRest', { method: 'GET', url: url, body: null }).then(function (r) {
        if (!r || r.ok === false) throw (r && r.error) || 'No reply from Fusion';
        var j = null; try { j = r.body ? JSON.parse(r.body) : {}; } catch (e) { }
        FX.lastCall = { method: 'GET', url: url, status: r.status, ms: Date.now() - t0 };
        return { status: r.status, ok: r.status >= 200 && r.status < 300, body: r.body || '', json: j, ms: r.ms || (Date.now() - t0) };
    });
};
/** Add query parameters to an absolute URL (replacing ones already there). */
SU.withParams = function (url, params) {
    var u = new URL(url);
    Object.keys(params).forEach(function (k) { if (params[k] == null) u.searchParams.delete(k); else u.searchParams.set(k, params[k]); });
    return u.toString().replace(/\+/g, '%20');
};
/** Every row of an absolute collection URL (offset / hasMore paging, 500 per call). */
SU.getAllUrl = function (href, max, onPage) {
    max = max || 50000; var all = [];
    function page(off) {
        return SU.raw(SU.withParams(href, { limit: 500, offset: off, onlyData: 'true' })).then(function (r) {
            if (!r.ok) throw FX.err(r.status, r.body);
            var j = r.json || {};
            var items = Array.isArray(j) ? j : j.items ? j.items : [j];
            all = all.concat(items);
            if (onPage) onPage(all.length);
            if (j.hasMore && items.length && all.length < max) return page(off + items.length);
        });
    }
    return page(0).then(function () { return all.slice(0, max); });
};
/** Run fn over items with at most n at a time. */
SU.mapLimit = function (items, n, fn) {
    var i = 0, out = new Array(items.length);
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve().then(function () { return fn(items[k], k); }).then(function (r) { out[k] = r; }, function (e) { out[k] = { error: e }; }).then(next); }
    var w = []; for (var x = 0; x < Math.min(n, items.length); x++) w.push(next());
    return Promise.all(w).then(function () { return out; });
};
/** Child collections of a record: links that are not self / canonical / describedby / action. */
SU.childLinks = function (rec) {
    return (rec && rec.links || []).filter(function (l) { return l && l.href && l.name && !/^(self|canonical|describedby|action)$/i.test(l.rel || ''); });
};

// ── formatting ─────────────────────────────────────────────────
SU.humanize = function (k) { return String(k || '').replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase(); }).trim(); };
SU.dateGB = function (v) {
    if (!v) return '—'; var d = new Date(String(v).length === 10 ? v + 'T00:00:00' : v);
    return isNaN(d) ? esc(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
SU.val = function (v) { return v == null || v === '' ? '<span class="muted">—</span>' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'object' ? '<span class="mono">' + esc(JSON.stringify(v)) + '</span>' : esc(v); };
SU.num = function (v, dp) { if (v == null || v === '' || isNaN(+v)) return v == null ? '' : esc(v); return (+v).toLocaleString(undefined, { minimumFractionDigits: dp || 0, maximumFractionDigits: dp == null ? 3 : dp }); };
SU.pct = function (a, b) { return b ? Math.round(a * 100 / b) : 0; };
SU.bar = function (p, cls) { return '<span class="su-bar ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></span>'; };
SU.trunc = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
SU.copy = function (t) { try { navigator.clipboard.writeText(t); FX.toast('Copied.'); } catch (e) { FX.toast('Could not copy.', 'err'); } };
SU.empty = function (icon, title, text) { return '<div class="su-empty"><i class="fa-solid ' + icon + '"></i><b>' + esc(title) + '</b>' + (text ? '<span>' + text + '</span>' : '') + '</div>'; };
SU.kpi = function (value, label, cls, sub) { return '<div class="kpi su-k ' + (cls || '') + '"><b>' + value + '</b><span>' + esc(label) + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
SU.loading = function (t) { return '<div class="su-empty"><i class="fa-solid fa-circle-notch fa-spin"></i><span>' + esc(t || 'Reading Fusion…') + '</span></div>'; };
SU.err = function (e) { return '<div class="note err" style="white-space:pre-wrap">' + esc(e && e.message || e) + '</div>'; };
SU.MOD_CLS = { 'Financials': 'fin', 'Supply Chain': 'scm', 'Common': 'com' };
SU.modTag = function (m) { return '<span class="su-mod ' + (SU.MOD_CLS[m] || 'com') + '">' + esc(m) + '</span>'; };
SU.ext = function (name) { return String(name || 'export').replace(/\.[^.]+$/, ''); };
SU.safeFile = function (s) { return String(s || 'export').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120); };

// ── tabs ───────────────────────────────────────────────────────
/** tabs: [{id, label, badge, icon, closable}] → html for a tab bar (attribute data-sutab / data-suclose). */
SU.tabBar = function (tabs, on, cls) {
    return '<div class="su-tabs ' + (cls || '') + '">' + tabs.map(function (t) {
        return '<button data-sutab="' + esc(t.id) + '" class="' + (t.id === on ? 'on' : '') + '">' + (t.icon ? '<i class="fa-solid ' + t.icon + '"></i> ' : '') + esc(t.label) +
            (t.badge != null && t.badge !== '' ? ' <span class="su-badge">' + esc(t.badge) + '</span>' : '') + (t.closable ? ' <i class="fa-solid fa-xmark su-x" data-suclose="' + esc(t.id) + '" title="Close"></i>' : '') + '</button>';
    }).join('') + '</div>';
};
SU.seg = function (opts, on, attr) { return '<div class="seg">' + opts.map(function (o) { o = typeof o === 'string' ? { v: o, t: o } : o; return '<button data-' + attr + '="' + esc(o.v) + '" class="' + (o.v === on ? 'on' : '') + '">' + o.t + '</button>'; }).join('') + '</div>'; };

// ── client-side paged table ───────────────────────────────────
/** cfg: { columns:[{k, label, n, mono, w, get(r), html(r, v), title}], rows, pageSize (25), sizes, quick (bool), quickPh,
           filter(r) (extra predicate), rowsFilter(rows) → rows, sort:{k, d}, rowCls(r), onRow(r), empty, foot(rows) → <tr> html, toolbar (html), onRender(t) } */
SU.table = function (el, cfg) {
    var t = { cfg: cfg, rows: cfg.rows || [], page: 0, size: cfg.pageSize || 25, quick: '', sort: cfg.sort || null };
    var sizes = cfg.sizes || [25, 50, 100, 200, 500];
    el.innerHTML = '<div class="su-tbl">' + (cfg.quick !== false || cfg.toolbar ? '<div class="su-tbar">' + (cfg.quick !== false ? '<input type="search" data-st="q" placeholder="' + esc(cfg.quickPh || 'Search these rows…') + '">' : '') +
        (cfg.toolbar || '') + '<span class="grow"></span><span class="muted" data-st="count"></span></div>' : '') +
        '<div class="su-tscroll" data-st="body"></div><div class="su-pager" data-st="pager"></div></div>';
    var q = function (k) { return el.querySelector('[data-st="' + k + '"]'); };
    var get = function (c, r) { return c.get ? c.get(r) : r[c.k]; };
    t.view = function () {
        var rows = t.rows;
        if (cfg.rowsFilter) rows = cfg.rowsFilter(rows);
        if (cfg.filter) rows = rows.filter(cfg.filter);
        if (t.quick) rows = rows.filter(function (r) { return cfg.columns.some(function (c) { var v = get(c, r); return v != null && String(v).toLowerCase().indexOf(t.quick) >= 0; }); });
        if (t.sort) {
            var c = cfg.columns.filter(function (x) { return x.k === t.sort.k; })[0];
            if (c) rows = rows.slice().sort(function (a, b) { var x = get(c, a), y = get(c, b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * t.sort.d; });
        }
        return rows;
    };
    t.render = function () {
        var rows = t.view(); t.lastView = rows;
        var pages = Math.max(1, Math.ceil(rows.length / t.size)); if (t.page >= pages) t.page = pages - 1;
        var slice = rows.slice(t.page * t.size, (t.page + 1) * t.size);
        if (!t.rows.length) q('body').innerHTML = cfg.emptyHtml || '<div class="empty"><i class="fa-solid fa-inbox"></i>' + esc(cfg.empty || 'No rows.') + '</div>';
        else q('body').innerHTML = '<table class="tbl su-t"><thead><tr>' + cfg.columns.map(function (c) {
            return '<th data-sk="' + esc(c.k) + '" class="' + (c.n ? 'n' : '') + (c.thCls ? ' ' + c.thCls : '') + '"' + (c.w ? ' style="min-width:' + c.w + 'px"' : '') + (c.title ? ' title="' + esc(c.title) + '"' : '') + '>' + (c.th || esc(c.label)) +
                (t.sort && t.sort.k === c.k ? ' <span class="s">' + (t.sort.d > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
        }).join('') + '</tr></thead><tbody>' + slice.map(function (r, i) {
            return '<tr data-ri="' + i + '" class="' + (cfg.onRow ? 'click ' : '') + (cfg.rowCls ? cfg.rowCls(r) || '' : '') + '">' + cfg.columns.map(function (c) {
                var v = get(c, r);
                return '<td class="' + (c.n ? 'n ' : '') + (c.mono ? 'mono ' : '') + (c.cls ? (typeof c.cls === 'function' ? c.cls(r) : c.cls) : '') + '">' + (c.html ? c.html(r, v) : SU.val(v)) + '</td>';
            }).join('') + '</tr>';
        }).join('') + (cfg.foot ? cfg.foot(rows) : '') + '</tbody></table>';
        t.slice = slice;
        if (q('count')) q('count').textContent = (rows.length !== t.rows.length ? rows.length + ' of ' + t.rows.length : t.rows.length) + ' rows';
        q('pager').innerHTML = rows.length > Math.min.apply(null, sizes) || t.page ? '<button class="btn sm" data-st="prev"' + (t.page ? '' : ' disabled') + '><i class="fa-solid fa-chevron-left"></i></button>' +
            '<span>Page <b>' + (t.page + 1) + '</b> of ' + pages + '</span><button class="btn sm" data-st="next"' + (t.page < pages - 1 ? '' : ' disabled') + '><i class="fa-solid fa-chevron-right"></i></button>' +
            '<select data-st="size">' + sizes.map(function (s) { return '<option' + (s === t.size ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select><span class="muted">per page</span>' : '';
        if (cfg.onRender) cfg.onRender(t);
    };
    t.set = function (rows) { t.rows = rows || []; t.page = 0; t.render(); };
    el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-st]');
        if (b && b.tagName === 'BUTTON') { var k = b.getAttribute('data-st'); if (k === 'prev') t.page--; else if (k === 'next') t.page++; t.render(); return; }
        var th = e.target.closest('th[data-sk]');
        if (th && th.closest('.su-t') && !e.target.closest('button, a, input')) { var sk = th.getAttribute('data-sk'); t.sort = t.sort && t.sort.k === sk ? { k: sk, d: -t.sort.d } : { k: sk, d: 1 }; t.render(); return; }
        var tr = e.target.closest('tr[data-ri]');
        if (tr && cfg.onRow && !e.target.closest('button, a, input, select')) cfg.onRow(t.slice[+tr.getAttribute('data-ri')], t, e);
    });
    el.addEventListener('change', function (e) { if (e.target.getAttribute('data-st') === 'size') { t.size = +e.target.value; t.page = 0; t.render(); } });
    var qi = q('q'); if (qi) qi.addEventListener('input', function () { t.quick = this.value.toLowerCase().trim(); t.page = 0; t.render(); });
    t.render();
    return t;
};

// ── file input / drop zone ─────────────────────────────────────
/** A click-or-drop zone. accept like '.zip'; onFiles(FileList array). */
SU.dropZone = function (el, opts) {
    el.innerHTML = '<label class="su-drop' + (opts.compact ? ' compact' : '') + '"><input type="file" accept="' + esc(opts.accept) + '"' + (opts.multiple ? ' multiple' : '') + ' hidden>' +
        '<i class="fa-solid ' + (opts.icon || 'fa-file-arrow-up') + '"></i><b>' + esc(opts.title) + '</b><span>' + (opts.text || '') + '</span></label>';
    var lab = el.querySelector('.su-drop'), inp = el.querySelector('input');
    inp.addEventListener('change', function () { if (inp.files.length) opts.onFiles(Array.prototype.slice.call(inp.files)); inp.value = ''; });
    lab.addEventListener('dragover', function (e) { e.preventDefault(); lab.classList.add('over'); });
    lab.addEventListener('dragleave', function () { lab.classList.remove('over'); });
    lab.addEventListener('drop', function (e) { e.preventDefault(); lab.classList.remove('over'); if (e.dataTransfer.files.length) opts.onFiles(Array.prototype.slice.call(e.dataTransfer.files)); });
};
/** Ask for a file with a hidden input → Promise<File>. */
SU.pickFile = function (accept) {
    return new Promise(function (res) { var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = function () { res(i.files[0] || null); }; i.click(); });
};

// ── exports ────────────────────────────────────────────────────
SU.sheetName = function (s) { return String(s || 'Sheet').replace(/[:\\\/?*\[\]]/g, ' ').trim().slice(0, 31) || 'Sheet'; };
/** sheets: [{name, aoa (array of arrays, first = header), widths:[chars]}] → downloads name.xlsx */
SU.xlsx = function (fileName, sheets) {
    if (!window.XLSX) { FX.toast('The Excel library did not load (needs internet for cdnjs).', 'err'); return; }
    var wb = XLSX.utils.book_new(), used = {};
    sheets.forEach(function (s) {
        var ws = XLSX.utils.aoa_to_sheet(s.aoa);
        ws['!cols'] = (s.widths || (s.aoa[0] || []).map(function (h, i) {
            var w = String(h == null ? '' : h).length; s.aoa.slice(1, 200).forEach(function (r) { var v = r[i]; if (v != null) w = Math.max(w, String(v).length); }); return Math.min(60, Math.max(8, w + 2));
        })).map(function (w) { return { wch: w }; });
        if (s.freeze) ws['!freeze'] = s.freeze;
        var n = SU.sheetName(s.name), base = n, k = 2; while (used[n.toLowerCase()]) n = SU.sheetName(base.slice(0, 27) + ' (' + (k++) + ')'); used[n.toLowerCase()] = 1;
        XLSX.utils.book_append_sheet(wb, ws, n);
    });
    XLSX.writeFile(wb, /\.xlsx$/i.test(fileName) ? fileName : fileName + '.xlsx');
};
/** Rows of objects → aoa with a header (cols: [{label, get(r) | k}]). */
SU.aoa = function (rows, cols) {
    return [cols.map(function (c) { return c.label; })].concat(rows.map(function (r) { return cols.map(function (c) { var v = c.get ? c.get(r) : r[c.k]; return v == null ? '' : v; }); }));
};
/** Printable report in a hidden frame → the print dialog (Save as PDF). sections = html; use <section class="land"> for a landscape page. */
SU.print = function (title, html, footer) {
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    var css = '@page{size:A4 portrait;margin:14mm 12mm 16mm}@page land{size:A4 landscape;margin:12mm}section.land{page:land;break-before:page}' +
        'body{font-family:Segoe UI,Arial,sans-serif;color:#0f172a;font-size:10.5px}h1{font-size:18px;margin:0 0 4px;color:#1d4f8a}h2{font-size:13px;margin:16px 0 6px;color:#1d4f8a;border-bottom:2px solid #e2e8f0;padding-bottom:3px}' +
        '.meta{color:#64748b;margin-bottom:10px}table{border-collapse:collapse;width:100%;margin-bottom:8px}th{background:#1d4f8a;color:#fff;text-align:left;padding:4px 5px;font-size:9.5px}' +
        'td{border-bottom:1px solid #e2e8f0;padding:3px 5px;vertical-align:top}tr:nth-child(even) td{background:#f8fafc}td.n,th.n{text-align:right}.ok{color:#15803d;font-weight:700}.err{color:#b91c1c;font-weight:700}.muted{color:#94a3b8}' +
        '.mx th{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-size:8px;padding:4px 2px;vertical-align:bottom}.mx th.h{writing-mode:horizontal-tb;transform:none;font-size:9px}.mx td{font-size:8.5px;text-align:center;padding:2px}.mx td.l{text-align:left}' +
        '.cnt td{background:#dcfce7!important;font-weight:700}.foot{position:fixed;bottom:-10mm;left:0;right:0;font-size:8.5px;color:#94a3b8;display:flex;justify-content:space-between}';
    var d = f.contentWindow.document;
    d.open(); d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body>' + html +
        '<div class="foot"><span>' + esc(footer || 'Gray\'s WMS · Fusion Setup & Diagnostics') + '</span><span>' + esc(new Date().toLocaleString()) + '</span></div></body></html>');
    d.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { FX.toast('Printing is not available here.', 'err'); } setTimeout(function () { f.remove(); }, 60000); }, 300);
};
/** rows + cols → simple html table for SU.print. */
SU.ptable = function (rows, cols, cls) {
    return '<table class="' + (cls || '') + '"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + (c.h ? ' h' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr class="' + (r._cls || '') + '">' + cols.map(function (c) { var v = c.get ? c.get(r) : r[c.k]; return '<td class="' + (c.n ? 'n ' : '') + (c.cls ? (typeof c.cls === 'function' ? c.cls(r) : c.cls) : '') + '">' + (c.html ? c.html(r) : esc(v == null ? '' : v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
};

/** Header-right buttons of the current view (the #fx-vh-r slot from FX.show). */
SU.headRight = function (html) { var r = $('fx-vh-r'); if (r) r.innerHTML = html; return r; };
