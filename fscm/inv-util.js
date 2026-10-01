/* Fusion Inventory + Costing — shared helpers (IU) used by inventory*.js and costing.js.
   Built on fscm/core.js (FX). Plain script, functions on window, no modules. */

var IU = {};

// ── settings (per PC, localStorage) ────────────────────────────
IU.DEFAULTS = {
    masterOrg: 'MIM',                 // Item Loading: item master org
    sourceCode: 'GRAYSWMS',           // inventoryStagedTransactions SourceCode
    toIface: 'EXT', toOrderSource: 'EXT', toReqStatus: 'NEW', toEmail: '', toNeedByDays: 3, toUom: 'Ea',
    itemSource: 'rest',               // Item Master: rest | sql
    sqlLimit: 5000
};
IU.cfg = function (k) { var all = lsGet('fxinv_settings', {}) || {}; return all[k] != null && all[k] !== '' ? all[k] : IU.DEFAULTS[k]; };
IU.setCfg = function (o) { var all = lsGet('fxinv_settings', {}) || {}; Object.keys(o).forEach(function (k) { all[k] = o[k]; }); lsSet('fxinv_settings', all); };
IU.email = function () { var e = IU.cfg('toEmail'); if (e) return e; return /@/.test(FX.user) ? FX.user.toLowerCase() : ''; };

// ── small utils ────────────────────────────────────────────────
IU.first = function (r, keys) { if (!r) return null; for (var i = 0; i < keys.length; i++) { var v = r[keys[i]]; if (v != null && v !== '') return v; } return null; };
IU.num = function (v) { if (v == null || v === '') return null; var n = +v; return isNaN(n) ? null : n; };
IU.sum = function (rows, f) { return rows.reduce(function (s, r) { var n = IU.num(typeof f === 'function' ? f(r) : r[f]); return s + (n || 0); }, 0); };
IU.distinct = function (arr) { var s = {}, o = []; arr.forEach(function (v) { if (v != null && v !== '' && !s[v]) { s[v] = 1; o.push(v); } }); return o; };
IU.qty = function (v) { var n = IU.num(v); return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 4 }); };
IU.n4 = function (v) { var n = IU.num(v); return n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 4 }); };
IU.price = function (v, ccy) { var n = IU.num(v); return n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (ccy ? ' ' + ccy : ''); };
IU.compact = function (v) { var n = IU.num(v); if (n == null) return '—'; var a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k'; return n.toLocaleString('en-US', { maximumFractionDigits: 2 }); };
var _mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
IU.d = function (v) { if (!v) return ''; var s = String(v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + '-' + _mon[+m[2] - 1] + '-' + m[1] : s; };
IU.dt = function (v) { if (!v) return ''; var s = String(v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); return m ? (+m[3]) + '-' + _mon[+m[2] - 1] + '-' + m[1] + ' ' + m[4] + ':' + m[5] : IU.d(s); };
IU.label = function (k) { return String(k).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'); };
IU.days = function (n) { var d = new Date(); d.setDate(d.getDate() + n); return FX.today(d); };
IU.splitItems = function (text, cap) {
    var list = IU.distinct(String(text || '').split(/[\n,\t]|\s{2,}/).map(function (s) { return s.trim(); }).filter(Boolean));
    cap = cap || 500;
    if (list.length > cap) { FX.toast('Only the first ' + cap + ' item numbers are used (' + list.length + ' pasted).', 'err'); list = list.slice(0, cap); }
    return list;
};
IU.ops = ['>', '>=', '=', '<=', '<'];
IU.opSel = function (id, val) { return '<select id="' + id + '" style="min-width:64px">' + IU.ops.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'; };
IU.link = function (r, name) { var l = (r && r.links || []).filter(function (x) { return x.name === name || (name === 'self' && x.rel === 'self'); })[0]; return l ? l.href : null; };
IU.self = function (r) { var l = (r && r.links || []).filter(function (x) { return x.rel === 'self'; })[0]; return l ? l.href : null; };
IU.errText = function (e) { return String(e && e.message || e || '').slice(0, 400); };
IU.sqlLit = function (s) { return "'" + String(s).replace(/'/g, "''") + "'"; };

/** ValuationUnit "COSTORG-INVORG-SUBINV-LOT\-123" → parts (split on hyphens not escaped by a backslash). */
IU.parseVU = function (vu) {
    if (!vu) return { costOrg: '', invOrg: '', subinv: '', lot: '' };
    var parts = String(vu).split(/(?<!\\)-/);
    return { costOrg: parts[0] || '', invOrg: parts[1] || '', subinv: parts[2] || '', lot: parts.slice(3).join('-').replace(/\\-/g, '-') };
};

// ── Fusion paging helpers ──────────────────────────────────────
/** fetchAllPages for a full href (child link): strips limit/offset and loops limit=500. */
IU.allHref = function (href, max, onPage) {
    max = max || 20000;
    var base = String(href).replace(/([?&])(limit|offset)=[^&]*/g, '$1').replace(/[?&]+$/, '').replace(/\?&+/, '?').replace(/&&+/g, '&');
    var all = [];
    function page(off) {
        var u = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'limit=500&offset=' + off;
        return FX.rest('GET', u).then(function (j) {
            var items = Array.isArray(j) ? j : (j.items || []);
            all = all.concat(items); if (onPage) onPage(all.length);
            if (!Array.isArray(j) && j.hasMore && items.length && all.length < max) return page(off + items.length);
        });
    }
    return page(0).then(function () { return all.slice(0, max); });
};
/** Loop pages of a resource with progress + cancel token: tok = {cancel:false}. */
IU.pages = function (path, opts, size, max, onPage, tok) {
    var all = [], total = null;
    function page(off) {
        if (tok && tok.cancel) return Promise.resolve();
        return FX.get(path, Object.assign({}, opts, { limit: size, offset: off, total: off === 0 })).then(function (j) {
            if (j.totalResults != null) total = j.totalResults;
            var items = j.items || []; all = all.concat(items);
            if (onPage) onPage(all.length, total);
            if (j.hasMore && items.length && all.length < max) return page(off + items.length);
        });
    }
    return page(0).then(function () { return { rows: all.slice(0, max), total: total, cancelled: !!(tok && tok.cancel) }; });
};
/** Concurrency pool: fn(item, i) → Promise; resolves with [{ok, v, e}] in input order. */
IU.mapLimit = function (items, n, fn, onDone) {
    var out = new Array(items.length), i = 0, done = 0;
    return new Promise(function (resolve) {
        if (!items.length) { resolve(out); return; }
        function next() {
            if (i >= items.length) return;
            var k = i++;
            Promise.resolve().then(function () { return fn(items[k], k); }).then(function (v) { out[k] = { ok: true, v: v }; }, function (e) { out[k] = { ok: false, e: e }; })
                .then(function () { done++; if (onDone) onDone(done, items.length); if (done === items.length) resolve(out); else next(); });
        }
        for (var w = 0; w < Math.min(n || 6, items.length); w++) next();
    });
};

// ── dynamic columns ────────────────────────────────────────────
IU.isNumKey = function (k) { return /qty|quantity|amount|cost|value|price|dr$|cr$/i.test(k); };
IU.cell = function (k, v) {
    if (v == null || v === '') return '';
    if (/date/i.test(k)) return esc(/T\d\d:\d\d/.test(String(v)) && !/T00:00:00/.test(String(v)) ? IU.dt(v) : IU.d(v));
    if (IU.isNumKey(k) && IU.num(v) != null) return '<span style="font-family:var(--mono)">' + IU.n4(v) + '</span>';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return esc(v);
};
/** Union of keys with at least one scalar value; drops links, _keys, objects and (optionally) *Id. */
IU.dynKeys = function (rows, dropId, keep) {
    var keys = [], seen = {};
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; keys.push(k); } }); });
    return keys.filter(function (k) {
        if ((keep || []).indexOf(k) >= 0) return true;
        if (k === 'links' || k.charAt(0) === '_' || (dropId && /id$/i.test(k))) return false;
        return rows.some(function (r) { var v = r[k]; return v != null && v !== '' && typeof v !== 'object'; });
    });
};
IU.dynCols = function (rows, dropId, keep) {
    return IU.dynKeys(rows, dropId, keep).map(function (k) { return { f: k, label: IU.label(k), n: IU.isNumKey(k) && rows.some(function (r) { return IU.num(r[k]) != null; }), html: function (r) { return IU.cell(k, r[k]); } }; });
};
/** "All fields" modal: every non-null, non-links key (optionally hide *Id). */
IU.allFields = function (title, row, hideId) {
    var keys = Object.keys(row || {}).filter(function (k) { var v = row[k]; return k !== 'links' && v != null && v !== '' && typeof v !== 'object' && !(hideId && /id$/i.test(k)); }).sort();
    FX.modal({
        title: esc(title), wide: true,
        body: '<input type="search" id="iu-af-q" placeholder="Filter fields…" style="border:1px solid var(--line);border-radius:8px;padding:6px 9px">' +
            '<div class="facts" id="iu-af">' + keys.map(function (k) { return '<div data-k="' + esc(k.toLowerCase() + ' ' + String(row[k]).toLowerCase()) + '"><span>' + esc(IU.label(k)) + '</span>' + IU.cell(k, row[k]) + '</div>'; }).join('') + '</div>',
        buttons: [{ label: 'Raw JSON', act: 'raw' }, { label: 'Close', act: 'close' }],
        onOpen: function () { $('iu-af-q').oninput = function () { var q = this.value.toLowerCase(); Array.prototype.forEach.call($('iu-af').children, function (d) { d.hidden = q && d.getAttribute('data-k').indexOf(q) < 0; }); }; },
        onAction: function (a) { if (a === 'raw') { FX.json(title, row); return false; } }
    });
};

// ── sub-tabs (with closable tabs) ──────────────────────────────
/** IU.tabs(el, [{id,label,icon,render(pane, tabs)}], {inner}) → api {show(id), add(tab, closable), close(id), pane(id)} */
IU.tabs = function (el, list, opt) {
    opt = opt || {};
    var api = { list: [], cur: null };
    el.innerHTML = '<div class="stabs' + (opt.inner ? ' inner' : '') + '"></div><div class="spanes" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
    var bar = el.firstChild, panes = el.lastChild;
    function drawBar() {
        bar.innerHTML = api.list.map(function (t) { return '<button data-t="' + esc(t.id) + '" class="' + (t.id === api.cur ? 'on' : '') + '">' + (t.icon ? '<i class="fa-solid ' + t.icon + '"></i>' : '') + esc(t.label) + (t.closable ? '<span class="cx" data-x="' + esc(t.id) + '">&times;</span>' : '') + '</button>'; }).join('') + (opt.right ? '<span class="sp"></span>' + opt.right : '');
    }
    api.add = function (t, closable, noShow) {
        var ex = api.list.filter(function (x) { return x.id === t.id; })[0];
        if (!ex) {
            t.closable = !!closable; api.list.push(t);
            var p = document.createElement('div'); p.className = 'spane'; p.hidden = true; p.setAttribute('data-p', t.id); panes.appendChild(p); t.pane = p;
        }
        if (!noShow) api.show(t.id); else drawBar();
        return ex || t;
    };
    api.show = function (id) {
        var t = api.list.filter(function (x) { return x.id === id; })[0]; if (!t) return;
        api.cur = id;
        api.list.forEach(function (x) { x.pane.hidden = x.id !== id; });
        if (!t.done) { t.done = true; try { t.render(t.pane, api); } catch (e) { t.pane.innerHTML = '<div class="note err">' + esc(e && e.message || e) + '</div>'; console.error(e); } }
        else if (t.onShow) t.onShow(t.pane);
        drawBar();
        if (opt.onShow) opt.onShow(id);
    };
    api.close = function (id) {
        var i = -1; api.list.forEach(function (x, k) { if (x.id === id) i = k; }); if (i < 0) return;
        var t = api.list[i]; t.pane.remove(); api.list.splice(i, 1);
        if (api.cur === id) api.show(t.back && api.list.some(function (x) { return x.id === t.back; }) ? t.back : api.list[Math.max(0, i - 1)].id); else drawBar();
    };
    api.pane = function (id) { var t = api.list.filter(function (x) { return x.id === id; })[0]; return t && t.pane; };
    api.relabel = function (id, label) { api.list.forEach(function (x) { if (x.id === id) x.label = label; }); drawBar(); };
    bar.onclick = function (e) {
        var x = e.target.closest('[data-x]'); if (x) { e.stopPropagation(); api.close(x.getAttribute('data-x')); return; }
        var b = e.target.closest('[data-t]'); if (b) api.show(b.getAttribute('data-t'));
    };
    list.forEach(function (t) { api.add(t, false, true); });
    api.show(opt.start || list[0].id);
    return api;
};

// ── local grid: FX.grid over rows the page already has ─────────
/** cfg like FX.grid, plus rows(): array. Returns g; call g.refresh() after the rows change. */
IU.localGrid = function (el, cfg) {
    var host = document.createElement('div'); host.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0';
    el.innerHTML = ''; el.appendChild(host);
    cfg = Object.assign({}, cfg, { load: function () { return Promise.resolve(cfg.rows()); } });
    var g = FX.grid(host, cfg);
    g.refresh = function () { g.rows = cfg.rows(); g.hasMore = false; g.total = null; g.render(); if (cfg.afterLoad) cfg.afterLoad(g); };
    g.loading = function (t) { var b = host.querySelector('[data-g="body"]'); if (b) b.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>' + esc(t || 'Reading Fusion…') + '</div>'; };
    g.error = function (e) { var b = host.querySelector('[data-g="body"]'); if (b) b.innerHTML = '<div class="note err" style="margin:12px;white-space:pre-wrap">' + esc(e) + '</div>'; };
    return g;
};

IU.stats = function (list) {
    return '<div class="stats">' + list.map(function (s) { return '<div class="stat ' + (s.cls || '') + (s.k ? ' click' : '') + (s.on ? ' on' : '') + '"' + (s.k ? ' data-k="' + esc(s.k) + '"' : '') + (s.tip ? ' title="' + esc(s.tip) + '"' : '') + '><b>' + s.value + '</b><span>' + esc(s.label) + '</span></div>'; }).join('') + '</div>';
};
IU.qtyCls = function (n) { n = IU.num(n) || 0; return n > 100 ? 'qty-ok' : n > 0 ? 'qty-mid' : 'qty-zero'; };
IU.ynTag = function (v) { return v === true || v === 'Y' || v === 'true' ? '<span class="chip ok">Y</span>' : '<span class="muted">—</span>'; };

// ── charts: HTML bars + SVG donut (no library) ─────────────────
IU.PAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
IU.tip = function (e, html) {
    var t = $('iu-vtip'); if (!t) { t = document.createElement('div'); t.id = 'iu-vtip'; t.className = 'vtip'; document.body.appendChild(t); }
    if (!html) { t.hidden = true; return; }
    t.hidden = false; t.innerHTML = html; t.style.left = Math.min(e.clientX + 12, window.innerWidth - t.offsetWidth - 8) + 'px'; t.style.top = (e.clientY + 14) + 'px';
};
/** data: [{k, v, tip}] already sorted; sel = selected key; fmt(v) → text. onClick(k). */
IU.hbars = function (el, title, data, fmt, sel, onClick) {
    var max = data.reduce(function (m, d) { return Math.max(m, Math.abs(d.v || 0)); }, 0) || 1;
    el.innerHTML = '<div class="card viz"><h4>' + esc(title) + '</h4>' + (data.length ? data.map(function (d, i) {
        return '<div class="hbar' + (sel != null ? (d.k === sel ? ' sel' : ' dim') : '') + '" data-i="' + i + '"><span class="lab" title="' + esc(d.k) + '">' + esc(d.k === '' ? '(blank)' : d.k) + '</span><div class="trk"><div class="bar" style="width:' + (Math.abs(d.v || 0) / max * 100).toFixed(2) + '%"></div></div><span class="val">' + esc(fmt(d.v)) + '</span></div>';
    }).join('') : '<div class="empty">No data</div>') + '</div>';
    el.onclick = function (e) { var b = e.target.closest('[data-i]'); if (b && onClick) onClick(data[+b.getAttribute('data-i')].k); };
    el.onmousemove = function (e) { var b = e.target.closest('[data-i]'); IU.tip(e, b ? (data[+b.getAttribute('data-i')].tip || esc(data[+b.getAttribute('data-i')].k) + ': ' + esc(fmt(data[+b.getAttribute('data-i')].v))) : null); };
    el.onmouseleave = function () { IU.tip(null, null); };
};
/** Donut of [{k, v}] — top 5 + Other. */
IU.donut = function (el, title, data, fmt) {
    data = data.filter(function (d) { return d.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    if (data.length > 6) { var rest = data.slice(5).reduce(function (s, d) { return s + d.v; }, 0); data = data.slice(0, 5).concat([{ k: 'Other', v: rest, other: true }]); }
    var tot = data.reduce(function (s, d) { return s + d.v; }, 0), a0 = -Math.PI / 2, R = 70, r = 44, cx = 80, cy = 80;
    var paths = data.map(function (d, i) {
        var a1 = a0 + (d.v / tot) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
        if (data.length === 1) a1 = a0 + Math.PI * 2 - 0.0001;
        var p = 'M' + (cx + R * Math.cos(a0)) + ' ' + (cy + R * Math.sin(a0)) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + (cx + R * Math.cos(a1)) + ' ' + (cy + R * Math.sin(a1)) +
            ' L' + (cx + r * Math.cos(a1)) + ' ' + (cy + r * Math.sin(a1)) + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + (cx + r * Math.cos(a0)) + ' ' + (cy + r * Math.sin(a0)) + ' Z';
        a0 = a1;
        return '<path d="' + p + '" fill="' + (d.other ? '#94a3b8' : IU.PAL[i]) + '" data-i="' + i + '"></path>';
    }).join('');
    el.innerHTML = '<div class="card viz"><h4>' + esc(title) + '</h4>' + (tot ? '<div class="donut"><svg width="160" height="160" viewBox="0 0 160 160">' + paths + '<text x="80" y="78" text-anchor="middle" font-size="13" font-weight="700" fill="#0f172a">' + esc(IU.compact(tot)) + '</text><text x="80" y="94" text-anchor="middle" font-size="9" fill="#64748b">TOTAL</text></svg><div class="legend">' +
        data.map(function (d, i) { return '<div><i style="background:' + (d.other ? '#94a3b8' : IU.PAL[i]) + '"></i><span>' + esc(d.k || '(blank)') + '</span><b>' + (d.v / tot * 100).toFixed(1) + '%</b></div>'; }).join('') + '</div></div>' : '<div class="empty">No cost data</div>') + '</div>';
    el.onmousemove = function (e) { var p = e.target.closest('path[data-i]'); IU.tip(e, p ? esc(data[+p.getAttribute('data-i')].k) + ': ' + esc(fmt(data[+p.getAttribute('data-i')].v)) + ' (' + (data[+p.getAttribute('data-i')].v / tot * 100).toFixed(1) + '%)' : null); };
    el.onmouseleave = function () { IU.tip(null, null); };
};
/** Group records → [{k, count, sum, n, max, avg, extra sums}] */
IU.agg = function (recs, keyFn, valFn, extra) {
    var m = {}, list = [];
    recs.forEach(function (r) {
        var k = keyFn(r); k = k == null ? '' : String(k);
        var g = m[k]; if (!g) { g = m[k] = { k: k, count: 0, sum: 0, n: 0, max: null }; (extra || []).forEach(function (x) { g[x] = 0; }); list.push(g); }
        g.count++; var v = valFn(r);
        if (v != null) { g.sum += v; g.n++; g.max = g.max == null ? v : Math.max(g.max, v); }
        (extra || []).forEach(function (x) { g[x] += IU.num(r[x]) || 0; });
    });
    list.forEach(function (g) { g.avg = g.n ? g.sum / g.n : null; });
    return list;
};
/** Simple client pager for a table built by draw(rows) → html. */
IU.pagedTable = function (el, rows, cols, size, opt) {
    opt = opt || {}; var page = 0;
    function draw() {
        var n = Math.max(1, Math.ceil(rows.length / size)); if (page >= n) page = n - 1;
        var part = rows.slice(page * size, page * size + size);
        el.innerHTML = '<div style="overflow:auto"><table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            part.map(function (r, i) { return '<tr data-i="' + (page * size + i) + '" class="' + (opt.onRow ? 'click' : '') + (opt.rowCls ? ' ' + opt.rowCls(r) : '') + '">' + cols.map(function (c) { return '<td class="' + (c.n ? 'n' : '') + '">' + (c.html ? c.html(r) : esc(r[c.f])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
            '<div class="pager"><span>' + (rows.length ? (page * size + 1) + '–' + Math.min(rows.length, page * size + size) + ' of ' + rows.length : 'No rows') + '</span><span class="grow"></span>' +
            '<select data-ps>' + [10, 25, 50, 100].map(function (s) { return '<option' + (s === size ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
            '<button class="btn sm" data-pg="-1"' + (page ? '' : ' disabled') + '>‹</button><button class="btn sm" data-pg="1"' + (page < n - 1 ? '' : ' disabled') + '>›</button></div>';
    }
    el.onclick = function (e) {
        var b = e.target.closest('[data-pg]'); if (b) { page += +b.getAttribute('data-pg'); draw(); return; }
        var tr = e.target.closest('tr[data-i]'); if (tr && opt.onRow && !e.target.closest('button,a,input')) opt.onRow(rows[+tr.getAttribute('data-i')]);
    };
    el.onchange = function (e) { if (e.target.matches('[data-ps]')) { size = +e.target.value; page = 0; draw(); } };
    draw();
};

// ── multi-select picker ────────────────────────────────────────
/** IU.multi(el, list [{v,t}], selected[], onChange) → {get(), set(arr)} */
IU.multi = function (el, list, sel, onChange) {
    sel = (sel || []).slice();
    el.className = 'ms';
    el.innerHTML = '<div class="ms-box" tabindex="0"></div><div class="ms-list" hidden><input type="search" placeholder="Filter…"><div class="ms-opts"></div><div class="row-btns" style="padding:4px"><button class="link" data-ms="all">Select all</button><button class="link" data-ms="none">Clear</button></div></div>';
    var box = el.firstChild, pop = el.lastChild, flt = pop.querySelector('input'), opts = pop.querySelector('.ms-opts');
    function drawBox() { box.innerHTML = sel.length ? sel.slice(0, 6).map(function (v) { return '<span class="tag">' + esc(v) + '</span>'; }).join('') + (sel.length > 6 ? '<span class="muted">+' + (sel.length - 6) + '</span>' : '') : '<span class="muted">Select…</span>'; }
    function drawOpts() { var q = flt.value.toLowerCase(); opts.innerHTML = list.filter(function (o) { return !q || (o.v + ' ' + o.t).toLowerCase().indexOf(q) >= 0; }).slice(0, 400).map(function (o) { return '<label><input type="checkbox" value="' + esc(o.v) + '"' + (sel.indexOf(o.v) >= 0 ? ' checked' : '') + '> ' + esc(o.t) + '</label>'; }).join(''); }
    box.onclick = function () { pop.hidden = !pop.hidden; if (!pop.hidden) { drawOpts(); flt.focus(); } };
    flt.oninput = drawOpts;
    opts.onchange = function (e) { var v = e.target.value; if (e.target.checked) { if (sel.indexOf(v) < 0) sel.push(v); } else sel = sel.filter(function (x) { return x !== v; }); drawBox(); if (onChange) onChange(sel); };
    pop.onclick = function (e) { var b = e.target.closest('[data-ms]'); if (!b) return; e.preventDefault(); sel = b.getAttribute('data-ms') === 'all' ? list.map(function (o) { return o.v; }) : []; drawOpts(); drawBox(); if (onChange) onChange(sel); };
    document.addEventListener('mousedown', function (e) { if (!el.contains(e.target)) pop.hidden = true; });
    drawBox();
    return { get: function () { return sel.slice(); }, set: function (a) { sel = a.slice(); drawBox(); }, setList: function (l) { list = l; drawOpts(); } };
};

// ── export (ExcelJS when loaded, CSV otherwise) ────────────────
/** sheet: {name, title, sub:[lines], cols:[{label, get(r), num, fmt, width}], rows} */
IU.xlsx = function (file, sh) {
    if (!window.ExcelJS) { FX.csv(sh.rows, sh.cols.map(function (c) { return { label: c.label, get: c.get }; }), file.replace(/\.xlsx$/, '')); FX.toast('Excel library not loaded — saved as CSV.'); return; }
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(sh.name || 'Sheet1'), nc = sh.cols.length, r0 = 1;
    ws.mergeCells(1, 1, 1, nc); ws.getCell(1, 1).value = sh.title; ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF0F2A4A' } };
    (sh.sub || []).forEach(function (t, i) { ws.mergeCells(2 + i, 1, 2 + i, nc); ws.getCell(2 + i, 1).value = t; ws.getCell(2 + i, 1).font = { italic: true, color: { argb: 'FF64748B' } }; r0 = 2 + i; });
    var hr = r0 + 1;
    sh.cols.forEach(function (c, i) { var cell = ws.getCell(hr, i + 1); cell.value = c.label; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4F8A' } }; ws.getColumn(i + 1).width = c.width || Math.max(10, Math.min(40, c.label.length + 4)); });
    sh.rows.forEach(function (r, ri) {
        sh.cols.forEach(function (c, i) {
            var v = c.get(r), cell = ws.getCell(hr + 1 + ri, i + 1);
            if (c.num) { var n = IU.num(v); cell.value = n; if (c.fmt) cell.numFmt = c.fmt; } else cell.value = v == null ? '' : String(v);
            if (ri % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        });
    });
    ws.views = [{ state: 'frozen', ySplit: hr, xSplit: 0, topLeftCell: 'A' + (hr + 1) }];
    wb.xlsx.writeBuffer().then(function (buf) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = file; a.click();
    }).catch(function (e) { FX.toast('Excel export failed: ' + e, 'err'); });
};

// ── print (hidden iframe; works inside WebView2) ───────────────
IU.print = function (title, bodyHtml) {
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'; document.body.appendChild(f);
    var d = f.contentWindow.document;
    d.open(); d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>body{font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#111;margin:18px}h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#eef2f7;font-size:11px;text-transform:uppercase}td.n,th.n{text-align:right}.hd{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px;margin:6px 0}.hd span{color:#64748b;font-size:10px;text-transform:uppercase;display:block}.pb{page-break-after:always}.foot{margin-top:10px;font-weight:700;text-align:right}.stamp{color:#64748b;font-size:10px;margin-top:14px}</style></head><body>' + bodyHtml + '</body></html>'); d.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { FX.toast('Print failed: ' + e, 'err'); } setTimeout(function () { f.remove(); }, 2000); }, 300);
};

// ── shared org select ──────────────────────────────────────────
IU.orgOptions = function (sel, val, blank) { return FX.fillSelect(sel, FX.lov('orgs').then(function (l) { return l.map(function (o) { return { v: o.v, t: o.v + ' — ' + ((o.o && o.o.OrganizationName) || ''), id: o.id, o: o.o }; }); }), val, blank); };
IU.orgId = function (code) { return FX.lov('orgs').then(function (l) { var o = l.filter(function (x) { return x.v === code; })[0]; return o ? o.id : null; }); };

// ── cost views shared by On-hand, Receipt Costs and Item Costs ──
/** Grouped (by ValuationUnit) or flat cost table with quick filter, page sizes, PO links, refresh. opt: {refresh(), title, itemCol, typeCol} */
IU.costTable = function (el, rows, opt) {
    opt = opt || {};
    var hasVU = rows.some(function (r) { return r.ValuationUnit; }), q = '', size = 25;
    var data, cols;
    if (hasVU) {
        var m = {}; data = [];
        rows.forEach(function (r) {
            var k = r.ValuationUnit || '(none)', g = m[k];
            if (!g) { var p = IU.parseVU(r.ValuationUnit); g = m[k] = { vu: k, costOrg: p.costOrg, invOrg: p.invOrg, subinv: p.subinv, lot: p.lot, totalUnitCost: null, receiptQty: 0, onhandQty: 0, count: 0, receipts: [], refs: [], items: [], types: [], ccy: r.CurrencyCode || r.Currency || '' }; data.push(g); }
            if (r.TotalUnitCost != null && r.TotalUnitCost !== '') g.totalUnitCost = r.TotalUnitCost;
            g.receiptQty += IU.num(r.ReceiptQuantity) || 0; g.onhandQty += IU.num(r.QuantityOnhand) || 0; g.count++;
            [['receipts', r.ReceiptNumber], ['refs', r.ReferenceNumber], ['items', r.Item || r.ItemNumber], ['types', r.TransactionTypeName]].forEach(function (x) { if (x[1] != null && x[1] !== '' && g[x[0]].indexOf(String(x[1])) < 0) g[x[0]].push(String(x[1])); });
        });
        cols = [{ label: 'Cost Org', f: 'costOrg' }, { label: 'Inventory Org', f: 'invOrg' }]
            .concat(opt.itemCol ? [{ label: 'Item', html: function (g) { return esc(g.items.join(', ')); } }] : [])
            .concat(opt.typeCol ? [{ label: 'Transaction Type', html: function (g) { return esc(g.types.join(', ')); } }] : [])
            .concat([{ label: 'Subinventory', f: 'subinv' }, { label: 'Lot', html: function (g) { return g.lot ? '<span class="tag code">' + esc(g.lot) + '</span>' : ''; } },
                { label: 'Receipt #', html: function (g) { return esc(g.receipts.join(', ')); } },
                { label: 'Reference # (PO)', html: function (g) { return g.refs.map(function (x) { return '<button class="lnk" data-po="' + esc(x) + '">' + esc(x) + '</button>'; }).join(', '); } },
                { label: 'Total Unit Cost', n: 1, html: function (g) { return '<span class="mono">' + IU.n4(g.totalUnitCost) + '</span>' + (g.ccy ? ' <span class="muted">' + esc(g.ccy) + '</span>' : ''); } },
                { label: 'Receipt Qty', n: 1, html: function (g) { return IU.qty(g.receiptQty); } },
                { label: 'On-hand Qty', n: 1, html: function (g) { return '<span class="' + (g.onhandQty > 0 ? 'qty-ok' : 'muted') + '">' + IU.qty(g.onhandQty) + '</span>'; } },
                { label: '# Receipts', n: 1, f: 'count' }]);
    } else { data = rows; cols = IU.dynCols(rows, true).map(function (c) { return { label: c.label, n: c.n, html: c.html, f: c.f }; }); }
    el.innerHTML = '<div class="toolbar"><input type="search" data-cq placeholder="Filter rows…" style="min-width:240px"><span class="muted" data-cn style="font-size:.78rem"></span><span class="grow" style="flex:1"></span>' +
        (opt.refresh ? '<button class="btn sm" data-cr><i class="fa-solid fa-rotate"></i> Refresh</button>' : '') + '<button class="btn sm" data-ccsv><i class="fa-solid fa-file-csv"></i> CSV</button></div><div data-ct class="card" style="overflow:hidden"></div>';
    var ct = el.querySelector('[data-ct]');
    function text(r) { return (hasVU ? [r.vu, r.receipts.join(' '), r.refs.join(' '), r.items.join(' '), r.types.join(' ')] : Object.keys(r).map(function (k) { return typeof r[k] === 'object' ? '' : r[k]; })).join(' ').toLowerCase(); }
    function draw() {
        var vis = q ? data.filter(function (r) { return text(r).indexOf(q) >= 0; }) : data;
        el.querySelector('[data-cn]').textContent = vis.length + (vis.length !== data.length ? ' of ' + data.length : '') + (hasVU ? ' valuation units · ' + rows.length + ' records' : ' records');
        IU.pagedTable(ct, vis, cols, size);
        if (hasVU && vis.length) {
            var tb = ct.querySelector('table');
            var foot = '<tfoot><tr>' + cols.map(function (c, i) { return '<td class="' + (c.n ? 'n' : '') + '">' + (i === 0 ? 'Total (' + vis.length + ')' : c.label === 'Receipt Qty' ? IU.qty(IU.sum(vis, 'receiptQty')) : c.label === 'On-hand Qty' ? IU.qty(IU.sum(vis, 'onhandQty')) : c.label === '# Receipts' ? IU.sum(vis, 'count') : '') + '</td>'; }).join('') + '</tr></tfoot>';
            tb.insertAdjacentHTML('beforeend', foot);
        }
        var ps = ct.querySelector('[data-ps]'); if (ps) ps.addEventListener('change', function () { size = +this.value; });
    }
    el.querySelector('[data-cq]').oninput = function () { q = this.value.toLowerCase(); draw(); };
    el.addEventListener('click', function (e) {
        var p = e.target.closest('[data-po]'); if (p) { IU.poDialog(p.getAttribute('data-po')); return; }
        if (e.target.closest('[data-cr]')) opt.refresh();
        if (e.target.closest('[data-ccsv]')) FX.csv(data, cols.map(function (c) { return { label: c.label, get: function (r) { if (c.f) return r[c.f]; var d = document.createElement('div'); d.innerHTML = c.html(r); return d.textContent; } }; }), opt.csvName || 'costs');
    });
    draw();
};
/** PO drill-down dialog by order number. */
IU.poDialog = function (ref) {
    FX.modal({ title: '<i class="fa-solid fa-file-invoice" style="color:var(--accent)"></i> Purchase order ' + esc(ref), wide: true, body: '<div id="iu-po" class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>' });
    FX.get('purchaseOrders', { q: 'OrderNumber=' + FX.qv(ref), expand: 'lines' }).then(function (j) {
        var po = (j.items || [])[0], el = $('iu-po'); if (!el) return;
        if (!po) { el.innerHTML = '<div class="note">No purchase order found for Order Number ' + esc(ref) + '</div>'; return; }
        var ccy = po.CurrencyCode || po.Currency || '';
        el.className = '';
        el.innerHTML = '<div class="facts">' + [['Order', esc(po.OrderNumber)], ['Status', FX.chip(po.Status)], ['Supplier', esc(po.Supplier)], ['Supplier Site', esc(po.SupplierSite)], ['Buyer', esc(po.BuyerDisplayName || po.Buyer)], ['Procurement BU', esc(po.ProcurementBU)], ['Order Date', IU.d(po.OrderDate)], ['Currency', esc(ccy)], ['Ordered', IU.price(po.Ordered)], ['Total', IU.price(po.Total)], ['Description', esc(po.Description)]]
            .filter(function (f) { return f[1]; }).map(function (f) { return '<div><span>' + f[0] + '</span>' + f[1] + '</div>'; }).join('') + '</div><h4 style="margin-top:12px">Lines</h4>' +
            FX.table((po.lines && po.lines.items) || [], [{ f: 'LineNumber', label: 'Line' }, { f: 'LineType', label: 'Type' }, { f: 'Item', label: 'Item', fmt: 'mono' }, { f: 'Description', label: 'Description' }, { f: 'UOM', label: 'UOM' }, { f: 'Quantity', label: 'Qty', n: 1, fmt: 'num' }, { f: 'Price', label: 'Price', n: 1, fmt: 'money' }, { f: 'Ordered', label: 'Ordered', n: 1, fmt: 'money' }, { f: 'NeedByDate', label: 'Need By', html: function (r) { return IU.d(r.NeedByDate); } }, { f: 'Status', label: 'Status', fmt: 'chip' }]);
    }).catch(function (e) { var el = $('iu-po'); if (el) el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
};
/** Does an itemCosts row belong to an org (parsed invOrg / costOrg, OrganizationCode, OrganizationName)? */
IU.rowOrg = function (r, org) { if (!org) return false; var p = IU.parseVU(r.ValuationUnit); return [p.invOrg, p.costOrg, r.OrganizationCode, r.OrganizationName].indexOf(org) >= 0; };
IU.unitCost = function (r) { return IU.num(IU.first(r, ['TotalUnitCost', 'UnitCost', 'ItemCost', 'UnitAverageCost', 'AverageUnitCost'])); };
/** Item cost modal: latest itemCosts split into source / destination org, expandable cost elements. */
IU.itemCostModal = function (item, srcOrg, dstOrg) {
    FX.modal({ title: '<i class="fa-solid fa-coins" style="color:var(--warn)"></i> Item cost — ' + esc(item), wide: true, body: '<div id="iu-ic" class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading item costs…</div>' });
    var cache = {};
    FX.get('itemCosts', { version: 'latest', q: 'ItemNumber=' + FX.qv(item), limit: 500, onlyData: false }).then(function (j) {
        var rows = j.items || [], el = $('iu-ic'); if (!el) return;
        el.className = '';
        var sides = [['Source', srcOrg], ['Destination', dstOrg]].filter(function (s) { return s[1]; });
        if (!sides.length) sides = [['All orgs', null]];
        el.innerHTML = sides.map(function (s, si) {
            var part = s[1] ? rows.filter(function (r) { return IU.rowOrg(r, s[1]); }) : rows;
            var uc = part.length ? IU.unitCost(part[0]) : null, ccy = (part.filter(function (r) { return r.CurrencyCode; })[0] || {}).CurrencyCode || '';
            return '<div class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="row-btns"><b>' + esc(s[0]) + (s[1] ? ' · ' + esc(s[1]) : '') + '</b><span class="grow"></span><span class="muted">Unit cost</span><b style="font-size:1.1rem">' + (uc == null ? '—' : IU.n4(uc) + ' ' + esc(ccy)) + '</b></div>' +
                (part.length ? '<table class="tbl"><thead><tr><th>Cost Org</th><th>Inv Org</th><th>Subinv</th><th>Lot</th><th class="n">Unit Cost</th><th></th></tr></thead><tbody>' + part.map(function (r, i) {
                    var p = IU.parseVU(r.ValuationUnit), href = IU.link(r, 'costDetails') || (IU.self(r) ? IU.self(r) + '/child/costDetails' : '');
                    return '<tr><td>' + esc(p.costOrg) + '</td><td>' + esc(p.invOrg || r.OrganizationCode) + '</td><td>' + esc(p.subinv) + '</td><td>' + esc(p.lot) + '</td><td class="n mono">' + IU.n4(IU.unitCost(r)) + '</td><td>' + (href ? '<button class="btn sm" data-cd="' + esc(href) + '" data-row="' + si + '_' + i + '"><i class="fa-solid fa-layer-group"></i> Elements</button>' : '') + '</td></tr><tr hidden data-cdr="' + si + '_' + i + '"><td colspan="6"></td></tr>';
                }).join('') + '</tbody></table>' : '<div class="muted">No cost rows for this org.</div>') + '</div>';
        }).join('<div style="height:10px"></div>');
        el.onclick = function (e) {
            var b = e.target.closest('[data-cd]'); if (!b) return;
            var tr = el.querySelector('[data-cdr="' + b.getAttribute('data-row') + '"]'), href = b.getAttribute('data-cd');
            if (!tr.hidden) { tr.hidden = true; return; }
            tr.hidden = false; var td = tr.firstChild; td.innerHTML = '<span class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading cost elements…</span>';
            (cache[href] || (cache[href] = IU.allHref(href))).then(function (els) {
                td.innerHTML = els.length ? FX.table(els, [{ f: 'CostElement', label: 'Cost Element' }, { f: 'CostElementType', label: 'Type' }, { label: 'Unit Cost', n: 1, html: function (r) { return IU.n4(r.UnitCostAverage) + ' ' + esc(r.CurrencyCode || ''); } }, { label: '%', n: 1, html: function (r) { var n = IU.num(r.CostPercent); return n == null ? '' : n.toFixed(1) + '%'; } }]) +
                    '<div style="text-align:right;font-weight:700;font-size:.8rem;padding:4px 8px">Total ' + IU.n4(IU.sum(els, 'UnitCostAverage')) + '</div>' : '<span class="muted">No cost elements.</span>';
            }).catch(function (er) { delete cache[href]; td.innerHTML = '<div class="note err">' + esc(er) + '</div>'; });
        };
    }).catch(function (e) { var el = $('iu-ic'); if (el) el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
};

/** Filter-card builder: fields [{id,label,html}] + buttons html. */
IU.filterCard = function (fields, buttons) {
    return '<div class="card"><div class="filters">' + fields.map(function (f) { return '<label' + (f.style ? ' style="' + f.style + '"' : '') + '><span>' + esc(f.label) + (f.req ? ' <b style="color:var(--err)">*</b>' : '') + '</span>' + f.html + '</label>'; }).join('') + '<div class="go">' + (buttons || '') + '</div></div></div>';
};
IU.inp = function (id, ph, val, type, style) { return '<input id="' + id + '" type="' + (type || 'search') + '" placeholder="' + esc(ph || '') + '" value="' + esc(val == null ? '' : val) + '"' + (style ? ' style="' + style + '"' : '') + '>'; };
IU.enter = function (ids, fn) { ids.forEach(function (id) { var e = $(id); if (e) e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') fn(); }); }); };
