/* Fusion SCM modules — shared engine.
   One page per module (om, purchasing, inventory, costing, setup) built from "views". Every Fusion call goes through
   the host action dataLoadFusionRest (GET / POST / PATCH to https://…oraclecloud.com/fscmRestApi/resources/… only;
   the Fusion credentials stay in C#). Building blocks: FX.rest / FX.restAll, FX.grid (filters → q, paging, sort,
   quick filter, KPIs, CSV), FX.drawer (facts + child collections + actions), FX.lov (cached lists), FX.typeahead,
   FX.form, FX.modal / confirm / busy / toast, FX.apex (APEX tables through the executePost relay). */

var FX = {
    user: '', instance: 'PROD', views: [], cur: null, ver: '11.13.18.05', lovCache: {},
    base: { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' },
    apexUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai'
};

// ── utils ──────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
FX.hasHost = function () { return !!(window.chrome && window.chrome.webview); };
FX.today = function (d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
FX.daysAgo = function (n) { var d = new Date(); d.setDate(d.getDate() - n); return FX.today(d); };
FX.fmt = {
    date: function (v) { if (!v) return ''; var s = String(v); return s.length >= 10 ? s.slice(0, 10) : s; },
    dt: function (v) { if (!v) return ''; var s = String(v).replace('T', ' '); return s.slice(0, 16); },
    num: function (v, p) { if (v == null || v === '') return ''; var n = +v; return isNaN(n) ? esc(v) : n.toLocaleString(undefined, { maximumFractionDigits: p == null ? 3 : p }); },
    money: function (v) { if (v == null || v === '') return ''; var n = +v; return isNaN(n) ? esc(v) : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    yn: function (v) { return v === true || v === 'Y' || v === 'true' ? '<i class="fa-solid fa-check" style="color:var(--ok)"></i>' : ''; }
};
FX.statusCls = function (s) {
    s = String(s || '').toUpperCase();
    if (/INCOMPLETE|NOT[ _]/.test(s)) return 'warn';
    if (/CANCEL|REJECT|ERROR|FAIL|CLOSED_FOR|HOLD|BLOCK|INACTIVE|EXPIRED|SHORT/.test(s)) return 'err';
    if (/CLOSED|COMPLETE|SHIPPED|RECEIVED|BILLED|FULFILLED|INTERFACED|SUCCE|PROCESSED|DELIVERED|CONFIRMED|ACTIVE|APPROVED$|OPEN$|YES/.test(s)) return 'ok';
    if (/PENDING|DRAFT|AWAIT|INCOMPLETE|IN_PROCESS|PROCESSING|WAIT|PARTIAL|BACK|NEW|RUNNING|STAGED/.test(s)) return 'warn';
    return 'info';
};
FX.chip = function (s) { return s ? '<span class="chip ' + FX.statusCls(s) + '">' + esc(String(s).replace(/_/g, ' ')) + '</span>' : ''; };
FX.qv = function (v) { return "'" + String(v).replace(/'/g, "''") + "'"; };
FX.like = function (f, v) { v = String(v).trim(); return v.indexOf('*') >= 0 || v.indexOf('%') >= 0 ? f + " LIKE " + FX.qv(v.replace(/\*/g, '%')) : "UPPER(" + f + ") LIKE " + FX.qv('%' + v.toUpperCase() + '%'); };

// ── host bridge ────────────────────────────────────────────────
var _fxPending = {}, _fxProgress = {};
FX.host = function (action, payload, onProgress) {
    return new Promise(function (resolve, reject) {
        if (!FX.hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
        var id = 'fx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _fxPending[id] = { resolve: resolve, reject: reject };
        if (onProgress) _fxProgress[id] = onProgress;
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, instance: FX.instance, appUser: FX.user }, payload || {}));
    });
};
if (FX.hasHost()) {
    window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId || !_fxPending[r.requestId]) return;
        if (/Progress$/.test(r.action || '')) { if (_fxProgress[r.requestId]) _fxProgress[r.requestId](r); return; }
        var cb = _fxPending[r.requestId]; delete _fxPending[r.requestId]; delete _fxProgress[r.requestId];
        if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? r : r.data);
    });
}

// ── Fusion REST ────────────────────────────────────────────────
FX.url = function (path, opts) {
    opts = opts || {};
    if (/^https:\/\//.test(path)) return path;
    var api = opts.api || 'fscm', ver = opts.version || FX.ver;
    var u = FX.base[FX.instance] + '/' + api + 'RestApi/resources/' + ver + '/' + String(path).replace(/^\//, '');
    var p = [];
    if (opts.q) p.push('q=' + encodeURIComponent(opts.q));
    if (opts.finder) p.push('finder=' + encodeURIComponent(opts.finder));
    if (opts.fields) p.push('fields=' + encodeURIComponent(opts.fields));
    if (opts.expand) p.push('expand=' + encodeURIComponent(opts.expand));
    if (opts.orderBy) p.push('orderBy=' + encodeURIComponent(opts.orderBy));
    if (opts.limit != null) p.push('limit=' + opts.limit);
    if (opts.offset) p.push('offset=' + opts.offset);
    if (opts.total) p.push('totalResults=true');
    if (opts.onlyData !== false && !opts.noOnlyData) p.push('onlyData=true');
    Object.keys(opts.params || {}).forEach(function (k) { if (opts.params[k] != null && opts.params[k] !== '') p.push(k + '=' + encodeURIComponent(opts.params[k])); });
    return u + (p.length ? (u.indexOf('?') >= 0 ? '&' : '?') + p.join('&') : '');
};
FX.err = function (status, body) {
    var j = null; try { j = JSON.parse(body); } catch (e) { }
    if (!j) return 'HTTP ' + status + (body ? ': ' + String(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) : '');
    var parts = [];
    if (j.title) parts.push(j.title);
    if (j.detail) parts.push(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail));
    (j['o:errorDetails'] || []).forEach(function (d) { parts.push((d['o:errorPath'] ? d['o:errorPath'] + ': ' : '') + (d.detail || d.title || '')); });
    return parts.join('\n') || ('HTTP ' + status);
};
/** One call → parsed JSON (throws a readable message on HTTP errors).
    opts.contentType: 'action' (application/vnd.oracle.adf.action+json, for custom actions) or 'json'; default = resource item.
    opts.upsert: true sends the Upsert-Mode: true header (POST that updates the row when it exists). */
FX.rest = function (method, path, opts, body) {
    opts = opts || {};
    var url = FX.url(path, opts);
    var t0 = Date.now();
    var ct = opts.contentType === 'action' ? 'application/vnd.oracle.adf.action+json' : opts.contentType === 'json' ? 'application/json' : null;
    return FX.host('dataLoadFusionRest', { method: method || 'GET', url: url, body: body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body)), framework: opts.framework || null, contentType: ct, upsert: !!opts.upsert }).then(function (r) {
        FX.lastCall = { method: method, url: url, status: r && r.status, ms: Date.now() - t0 };
        if (!r || r.ok === false) throw (r && r.error) || 'No reply from Fusion';
        if (r.status < 200 || r.status >= 300) throw FX.err(r.status, r.body);
        if (!r.body) return {};
        try { return JSON.parse(r.body); } catch (e) { return { text: r.body }; }
    });
};
FX.get = function (path, opts) { return FX.rest('GET', path, opts); };
/** Like FX.rest but never throws on an HTTP status: → { ok (2xx), status, json (parsed or null), text, url }. Throws only when the host cannot reach Fusion. */
FX.restRaw = function (method, path, opts, body) {
    opts = opts || {};
    var url = FX.url(path, opts);
    var ct = opts.contentType === 'action' ? 'application/vnd.oracle.adf.action+json' : opts.contentType === 'json' ? 'application/json' : null;
    return FX.host('dataLoadFusionRest', { method: method || 'GET', url: url, body: body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body)), framework: opts.framework || null, contentType: ct, upsert: !!opts.upsert }).then(function (r) {
        FX.lastCall = { method: method, url: url, status: r && r.status };
        if (!r || r.ok === false) throw (r && r.error) || 'No reply from Fusion';
        var j = null; try { j = r.body ? JSON.parse(r.body) : null; } catch (e) { }
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: j, text: r.body || '', url: url, error: r.status >= 200 && r.status < 300 ? null : FX.err(r.status, r.body) };
    });
};
/** Custom action on a resource item, e.g. FX.action('draftPurchaseOrders/123', 'submit') → POST {name, parameters}. */
FX.action = function (path, name, params, opts) {
    return FX.rest('POST', path, Object.assign({ contentType: 'action', onlyData: false }, opts || {}), { name: name, parameters: params || [] });
};
/** All pages (hasMore) up to max rows. */
FX.restAll = function (path, opts, max, onPage) {
    opts = Object.assign({ limit: 500 }, opts || {}); max = max || 5000;
    var all = [];
    function page(off) {
        return FX.get(path, Object.assign({}, opts, { offset: off })).then(function (j) {
            var items = j.items || [];
            all = all.concat(items);
            if (onPage) onPage(all.length);
            if (j.hasMore && all.length < max && items.length) return page(off + items.length);
        });
    }
    return page(opts.offset || 0).then(function () { return all.slice(0, max); });
};
/** Fusion SQL runner (read-only, for things REST cannot answer). */
FX.sql = function (sql, rowLimit) {
    return FX.host('fusionSqlExecute', { sql: sql, rowLimit: rowLimit || 5000 }).then(function (r) {
        if (!r || !r.success) throw (r && r.error) || 'Query failed';
        var cols = (r.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
        return (r.rows || []).map(function (row) {
            if (!Array.isArray(row)) { var o = {}; Object.keys(row).forEach(function (k) { o[k.toUpperCase()] = row[k]; }); return o; }
            var x = {}; cols.forEach(function (c, i) { x[c] = row[i]; }); return x;
        });
    });
};

// ── APEX (own tables, through the executePost relay) ───────────
FX.apex = {
    call: function (path, payload) {
        return FX.host('executePost', { fullUrl: FX.apexUrl + path, body: JSON.stringify(Object.assign({ appUser: FX.user }, payload)) }).then(function (d) {
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw 'Unexpected response from the database API'; } }
            if (!d || d.success === false) throw (d && d.error) || 'Database API error';
            return d;
        });
    },
    read: function (sql, max) {
        return FX.apex.call('/executequery', { sql: sql, maxRows: Math.min(max || 500, 1000) }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    },
    write: function (sql) { return FX.apex.call('/executewrite', { sql: sql }); },
    lit: function (s) { return s == null || s === '' ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'"; }
};

// ── UI primitives ──────────────────────────────────────────────
FX.toast = function (t, kind) { var el = $('toast'); el.textContent = t; el.className = 'toast ' + (kind || ''); el.style.display = 'block'; clearTimeout(FX.toast.t); FX.toast.t = setTimeout(function () { el.style.display = 'none'; }, kind === 'err' ? 8000 : 3800); };
FX.busy = function (t) { $('busy').hidden = !t; if (t) $('busy-t').textContent = t; };
var _fxModal = null;
FX.modal = function (opts) {
    if (_fxModal && _fxModal.onClose) { var oc = _fxModal.onClose; _fxModal = null; oc(); }
    _fxModal = opts;
    var box = $('modal-box');
    box.className = 'modal' + (opts.wide ? ' wide' : '');
    box.innerHTML = '<div class="modal-h"><h3>' + opts.title + '</h3><button class="x" data-mact="close">&times;</button></div><div class="modal-b">' + (opts.body || '') + '</div>' +
        '<div class="modal-f">' + (opts.buttons || [{ label: 'Close', act: 'close' }]).map(function (b) { return '<button class="btn ' + (b.cls || '') + '" data-mact="' + b.act + '">' + b.label + '</button>'; }).join('') + '</div>';
    $('modal').hidden = false;
    box.onclick = function (e) {
        var b = e.target.closest('[data-mact]'); if (!b) return;
        var act = b.getAttribute('data-mact');
        if (act === 'close') { FX.closeModal(); return; }
        if (opts.onAction) {
            var r = opts.onAction(act, box, b);
            if (r && r.then) r.then(function (keep) { if (keep !== false) FX.closeModal(); }).catch(function (er) { FX.toast(String(er), 'err'); });
            else if (r !== false) FX.closeModal();
        }
    };
    if (opts.onOpen) opts.onOpen(box);
    return box;
};
FX.closeModal = function () { var o = _fxModal; _fxModal = null; $('modal').hidden = true; $('modal-box').innerHTML = ''; if (o && o.onClose) o.onClose(); };
FX.confirm = function (title, html, ok, cls) {
    return new Promise(function (res) {
        var yes = false;
        FX.modal({ title: title, body: html, buttons: [{ label: 'Cancel', act: 'close' }, { label: ok || 'OK', cls: cls || 'primary', act: 'ok' }], onAction: function (a) { if (a === 'ok') yes = true; }, onClose: function () { res(yes); } });
    });
};
FX.json = function (title, obj) { FX.modal({ title: title, wide: true, body: '<pre class="json">' + esc(JSON.stringify(obj, null, 2)) + '</pre>', buttons: [{ label: 'Copy', act: 'copy' }, { label: 'Close', act: 'close' }], onAction: function (a) { if (a === 'copy') { navigator.clipboard.writeText(JSON.stringify(obj, null, 2)); FX.toast('Copied.'); return false; } } }); };
FX.csv = function (rows, cols, name) {
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [cols.map(function (c) { return q(c.label || c.f); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(c.get ? c.get(r) : r[c.f]); }).join(','); }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = (name || 'export') + '_' + FX.today() + '.csv'; a.click();
};

// ── LOVs ───────────────────────────────────────────────────────
/** Cached lookups used by many screens. Each returns [{v, t, o}] (value, text, original). */
FX.LOVS = {
    orgs: function () { return FX.restAll('inventoryOrganizations', { fields: 'OrganizationId,OrganizationCode,OrganizationName,ManagementBusinessUnitName,LocationCode', orderBy: 'OrganizationCode' }, 2000).then(function (r) { return r.map(function (o) { return { v: o.OrganizationCode, t: o.OrganizationCode + ' · ' + (o.OrganizationName || ''), id: o.OrganizationId, o: o }; }); }); },
    bus: function () { return FX.restAll('finBusinessUnitsLOV', { fields: 'BusinessUnitId,BusinessUnitName', orderBy: 'BusinessUnitName' }, 1000).then(function (r) { return r.map(function (o) { return { v: o.BusinessUnitName, t: o.BusinessUnitName, id: o.BusinessUnitId, o: o }; }); }); },
    currencies: function () { return FX.restAll('currenciesLOV', { fields: 'CurrencyCode,Name', q: "EnabledFlag='Y'" }, 500).then(function (r) { return r.map(function (o) { return { v: o.CurrencyCode, t: o.CurrencyCode + ' · ' + (o.Name || ''), o: o }; }); }).catch(function () { return ['MUR', 'USD', 'EUR', 'GBP', 'ZAR', 'INR'].map(function (c) { return { v: c, t: c }; }); }); }
};
FX.lov = function (key, arg) {
    var k = key + '|' + FX.instance + '|' + (arg || '');
    if (!FX.lovCache[k]) FX.lovCache[k] = FX.LOVS[key](arg).catch(function (e) { delete FX.lovCache[k]; throw e; });
    return FX.lovCache[k];
};
FX.subinvs = function (org) {
    var k = 'subinv|' + FX.instance + '|' + org;
    if (!FX.lovCache[k]) FX.lovCache[k] = FX.restAll('subinventories', { q: "OrganizationCode=" + FX.qv(org), fields: 'SecondaryInventoryName,Description,OrganizationCode,QuantityTrackedFlag,AssetFlag', limit: 500 }, 2000)
        .then(function (r) { return r.map(function (s) { return { v: s.SecondaryInventoryName, t: s.SecondaryInventoryName + (s.Description ? ' · ' + s.Description : ''), o: s }; }); })
        .catch(function (e) { delete FX.lovCache[k]; throw e; });
    return FX.lovCache[k];
};
/** Fill a <select> from a LOV promise. */
FX.fillSelect = function (sel, p, val, blank) {
    sel = typeof sel === 'string' ? $(sel) : sel;
    if (!sel) return Promise.resolve();
    sel.innerHTML = '<option value="">Loading…</option>';
    return p.then(function (list) {
        sel.innerHTML = (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) { return '<option value="' + esc(x.v) + '"' + (x.v === val ? ' selected' : '') + '>' + esc(x.t) + '</option>'; }).join('');
        if (val && !list.some(function (x) { return x.v === val; })) sel.insertAdjacentHTML('beforeend', '<option selected>' + esc(val) + '</option>');
        return list;
    }).catch(function (e) { sel.innerHTML = '<option value="">(could not load)</option>'; FX.toast(String(e), 'err'); return []; });
};
/** Typeahead on an input: search(q) → Promise<[{v, t, r, o}]>; onPick(item). */
FX.typeahead = function (input, search, onPick, minLen) {
    input = typeof input === 'string' ? $(input) : input;
    var wrap = input.parentNode; if (!wrap.classList.contains('ta')) { var w = document.createElement('div'); w.className = 'ta'; wrap.insertBefore(w, input); w.appendChild(input); wrap = w; }
    var list = document.createElement('div'); list.className = 'ta-list'; list.hidden = true; wrap.appendChild(list);
    var timer = null, seq = 0, hits = [], idx = -1;
    function draw() { list.innerHTML = hits.length ? hits.map(function (h, i) { return '<div class="ta-item' + (i === idx ? ' on' : '') + '" data-i="' + i + '"><span class="code">' + esc(h.v) + '</span><span>' + esc(h.t || '') + '</span><span class="r">' + esc(h.r || '') + '</span></div>'; }).join('') : '<div class="ta-item muted">No match</div>'; }
    input.addEventListener('input', function () {
        clearTimeout(timer); var q = input.value.trim();
        if (q.length < (minLen || 2)) { list.hidden = true; return; }
        timer = setTimeout(function () {
            var s = ++seq; list.hidden = false; list.innerHTML = '<div class="ta-item muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching…</div>';
            search(q).then(function (r) { if (s !== seq) return; hits = r.slice(0, 50); idx = hits.length ? 0 : -1; draw(); }).catch(function (e) { if (s === seq) list.innerHTML = '<div class="ta-item" style="color:var(--err)">' + esc(e) + '</div>'; });
        }, 350);
    });
    input.addEventListener('keydown', function (e) {
        if (list.hidden) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!hits.length) return; idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; draw(); }
        else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(hits[idx]); }
        else if (e.key === 'Escape') list.hidden = true;
    });
    list.addEventListener('mousedown', function (e) { var it = e.target.closest('[data-i]'); if (it) { e.preventDefault(); pick(hits[+it.getAttribute('data-i')]); } });
    input.addEventListener('blur', function () { setTimeout(function () { list.hidden = true; }, 150); });
    function pick(h) { list.hidden = true; input.value = h.v; onPick(h); }
};

// ── grid ───────────────────────────────────────────────────────
/** cfg: { resource, version, fields, expand, orderBy, finder, fixedQ, qJoin (default ' and '; ';' for the v1 q syntax), pageSize,
           filters:[{id,label,type,ph,value,options,lov,blank (false = no blank option),q(v,all)}],
           columns:[{f,label,fmt,n,get(row),html(row)}], key, title, onRow(row), kpis(rows) → [{k,label,value,filter(row)}],
           actions:[{label,icon,cls,run(grid)}], transform(rows), load(grid) (custom loader → Promise<rows>), autoLoad, csvName, select } */
FX.grid = function (el, cfg) {
    var g = { cfg: cfg, rows: [], total: null, hasMore: false, offset: 0, sort: null, quick: '', kpi: null, selected: {}, el: el };
    var fid = function (f) { return 'gf_' + (cfg.id || 'g') + '_' + f.id; };
    el.innerHTML =
        (cfg.filters && cfg.filters.length ? '<div class="card"><div class="filters">' + cfg.filters.map(function (f) {
            var v = f.value == null ? '' : (typeof f.value === 'function' ? f.value() : f.value);
            if (f.type === 'select') return '<label>' + esc(f.label) + '<select id="' + fid(f) + '">' + (f.options || []).map(function (o) { o = typeof o === 'string' ? { v: o, t: o || 'All' } : o; return '<option value="' + esc(o.v) + '"' + (o.v === v ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('') + '</select></label>';
            if (f.type === 'lov') return '<label>' + esc(f.label) + '<select id="' + fid(f) + '"></select></label>';
            return '<label>' + esc(f.label) + '<input id="' + fid(f) + '" type="' + (f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'search') + '" placeholder="' + esc(f.ph || '') + '" value="' + esc(v) + '"></label>';
        }).join('') + '<div class="go">' + (cfg.actions || []).map(function (a, i) { return '<button class="btn ' + (a.cls || '') + '" data-gact="' + i + '">' + (a.icon ? '<i class="fa-solid ' + a.icon + '"></i> ' : '') + esc(a.label) + '</button>'; }).join('') +
            '<button class="btn primary" data-g="search"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div></div></div>' : '') +
        '<div class="kpis" data-g="kpis"></div>' +
        '<div class="card grid-wrap" style="display:flex;flex-direction:column"><div class="filters" style="padding:8px 12px;border-bottom:1px solid var(--line)"><input data-g="quick" type="search" placeholder="Filter these rows…" style="min-width:240px">' +
        '<span class="muted" data-g="count" style="font-size:.78rem"></span><span class="grow"></span><button class="btn sm" data-g="csv"><i class="fa-solid fa-file-csv"></i> CSV</button>' +
        '<button class="btn sm" data-g="call" title="Last Fusion call"><i class="fa-solid fa-code"></i></button></div>' +
        '<div data-g="body" style="flex:1;overflow:auto"></div><div class="grid-foot" data-g="foot"></div></div>';
    var q = function (k) { return el.querySelector('[data-g="' + k + '"]'); };
    (cfg.filters || []).forEach(function (f) {
        if (f.type === 'lov') FX.fillSelect(fid(f), typeof f.lov === 'function' ? f.lov() : FX.lov(f.lov), typeof f.value === 'function' ? f.value() : f.value, f.blank === false ? null : f.blank == null ? 'All' : f.blank);
        var inp = $(fid(f)); if (inp && inp.tagName === 'INPUT') inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') g.search(); });
    });
    el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-g="search"],[data-g="more"],[data-g="csv"],[data-g="call"]');
        if (b) {
            var k = b.getAttribute('data-g');
            if (k === 'search') g.search(); else if (k === 'more') g.load(true); else if (k === 'csv') FX.csv(g.visible(), cfg.columns, cfg.csvName || cfg.resource || 'export');
            else if (k === 'call') FX.json('Last Fusion call', FX.lastCall || {});
            return;
        }
        var a = e.target.closest('[data-gact]'); if (a) { cfg.actions[+a.getAttribute('data-gact')].run(g); return; }
        var kp = e.target.closest('[data-k]'); if (kp) { g.kpi = g.kpi === kp.getAttribute('data-k') ? null : kp.getAttribute('data-k'); g.render(); return; }
        var th = e.target.closest('th[data-c]'); if (th) { var c = +th.getAttribute('data-c'); g.sort = g.sort && g.sort.c === c ? { c: c, d: -g.sort.d } : { c: c, d: 1 }; g.render(); return; }
        var cb = e.target.closest('input[data-sel]'); if (cb) { e.stopPropagation(); g.selected[cb.getAttribute('data-sel')] = cb.checked; if (cfg.onSelect) cfg.onSelect(g); return; }
        var tr = e.target.closest('tr[data-r]'); if (tr && cfg.onRow && !e.target.closest('button, a, input, select')) cfg.onRow(g.view[+tr.getAttribute('data-r')], g);
        var rb = e.target.closest('[data-ract]'); if (rb) { var row = g.view[+rb.closest('tr').getAttribute('data-r')]; cfg.rowActions[+rb.getAttribute('data-ract')].run(row, g); }
    });
    q('quick').addEventListener('input', function () { g.quick = this.value.toLowerCase(); g.render(); });
    g.val = function (id) { var f = (cfg.filters || []).filter(function (x) { return x.id === id; })[0], e2 = f && $(fid(f)); return e2 ? e2.value.trim() : ''; };
    g.setVal = function (id, v) { var f = (cfg.filters || []).filter(function (x) { return x.id === id; })[0], e2 = f && $(fid(f)); if (e2) e2.value = v; };
    g.buildQ = function () {
        var parts = cfg.fixedQ ? [typeof cfg.fixedQ === 'function' ? cfg.fixedQ(g) : cfg.fixedQ] : [];
        (cfg.filters || []).forEach(function (f) { var v = g.val(f.id); if (v && f.q) { var p = f.q(v, g); if (p) parts.push(p); } });
        return parts.filter(Boolean).join(cfg.qJoin || ' and ');
    };
    g.search = function () {
        if (cfg.validate) { var m = cfg.validate(g); if (m) { FX.toast(m, 'err'); return; } }
        g.rows = []; g.offset = 0; g.selected = {}; g.load(false);
    };
    g.load = function (more) {
        q('body').innerHTML = more ? q('body').innerHTML : '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Reading Fusion…</div>';
        q('foot').innerHTML = more ? '<i class="fa-solid fa-circle-notch fa-spin"></i> Loading more…' : '';
        var job = cfg.load ? cfg.load(g, more) : FX.get(cfg.resource, { version: cfg.version, q: g.buildQ(), finder: typeof cfg.finder === 'function' ? cfg.finder(g) : cfg.finder, fields: cfg.fields, expand: cfg.expand, orderBy: cfg.orderBy, limit: cfg.pageSize || 100, offset: g.offset, total: !more })
            .then(function (j) { g.hasMore = !!j.hasMore; if (j.totalResults != null) g.total = j.totalResults; return j.items || []; });
        return job.then(function (items) {
            if (cfg.transform) items = cfg.transform(items, g);
            g.rows = more ? g.rows.concat(items) : items; g.offset = g.rows.length; g.render();
            if (cfg.afterLoad) cfg.afterLoad(g);
        }).catch(function (e) { q('body').innerHTML = '<div class="note err" style="margin:12px;white-space:pre-wrap">' + esc(e) + '</div>'; q('foot').innerHTML = ''; });
    };
    g.visible = function () {
        var rows = g.rows;
        if (g.kpi && cfg.kpis) { var k = cfg.kpis(g.rows).filter(function (x) { return x.k === g.kpi; })[0]; if (k && k.filter) rows = rows.filter(k.filter); }
        if (g.quick) rows = rows.filter(function (r) { return cfg.columns.some(function (c) { var v = c.get ? c.get(r) : r[c.f]; return v != null && String(v).toLowerCase().indexOf(g.quick) >= 0; }); });
        if (g.sort) {
            var c = cfg.columns[g.sort.c], get = function (r) { return c.get ? c.get(r) : r[c.f]; };
            rows = rows.slice().sort(function (a, b) { var x = get(a), y = get(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * g.sort.d; });
        }
        return rows;
    };
    g.render = function () {
        if (cfg.kpis) q('kpis').innerHTML = cfg.kpis(g.rows).map(function (k) { return '<div class="kpi' + (k.filter ? '' : '') + (g.kpi === k.k ? ' on' : '') + '"' + (k.filter ? ' data-k="' + k.k + '"' : '') + '><b>' + k.value + '</b><span>' + esc(k.label) + '</span></div>'; }).join('');
        var rows = g.view = g.visible();
        if (!g.rows.length) { q('body').innerHTML = '<div class="empty"><i class="fa-solid fa-inbox"></i>' + esc(cfg.emptyText || 'Nothing found. Change the filters and search.') + '</div>'; }
        else q('body').innerHTML = '<table class="tbl"><thead><tr>' + (cfg.select ? '<th style="width:28px"></th>' : '') + cfg.columns.map(function (c, i) {
            return '<th data-c="' + i + '" class="' + (c.n ? 'n' : '') + '">' + esc(c.label) + (g.sort && g.sort.c === i ? ' <span class="s">' + (g.sort.d > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
        }).join('') + (cfg.rowActions ? '<th></th>' : '') + '</tr></thead><tbody>' + rows.slice(0, 3000).map(function (r, i) {
            var key = cfg.key ? (typeof cfg.key === 'function' ? cfg.key(r) : r[cfg.key]) : i;
            return '<tr data-r="' + i + '" class="' + (cfg.onRow ? 'click' : '') + '">' + (cfg.select ? '<td><input type="checkbox" data-sel="' + esc(key) + '"' + (g.selected[key] ? ' checked' : '') + '></td>' : '') + cfg.columns.map(function (c) {
                var v = c.get ? c.get(r) : r[c.f], h = c.html ? c.html(r) : c.fmt === 'chip' ? FX.chip(v) : c.fmt && FX.fmt[c.fmt] ? FX.fmt[c.fmt](v) : esc(v);
                return '<td class="' + (c.n ? 'n ' : '') + (c.fmt === 'mono' ? 'mono' : '') + '">' + h + '</td>';
            }).join('') + (cfg.rowActions ? '<td style="white-space:nowrap">' + cfg.rowActions.map(function (a, ai) { return (!a.when || a.when(r)) ? '<button class="btn sm ' + (a.cls || '') + '" data-ract="' + ai + '" title="' + esc(a.label) + '">' + (a.icon ? '<i class="fa-solid ' + a.icon + '"></i>' : esc(a.label)) + '</button> ' : ''; }).join('') + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
        q('count').textContent = rows.length + (rows.length !== g.rows.length ? ' of ' + g.rows.length : '') + ' rows' + (g.total != null ? ' · ' + g.total + ' in Fusion' : '');
        q('foot').innerHTML = g.hasMore ? '<button class="btn sm" data-g="more"><i class="fa-solid fa-angles-down"></i> Load more</button><span>' + g.rows.length + ' loaded</span>' : (g.rows.length ? '<span>All ' + g.rows.length + ' loaded</span>' : '');
    };
    g.selectedRows = function () { return g.rows.filter(function (r, i) { var key = cfg.key ? (typeof cfg.key === 'function' ? cfg.key(r) : r[cfg.key]) : i; return g.selected[key]; }); };
    g.render();
    if (cfg.autoLoad) g.search();
    return g;
};

// ── drawer ─────────────────────────────────────────────────────
/** o: { title, sub, width (px, default 820), chips:[html], facts:[[label, value(html)]], tabs:[{label, render(el)} | {label, rest:{path, opts, columns}}], actions:[{label, icon, cls, run}] } */
FX.drawer = function (o) {
    FX.closeDrawer();
    var d = document.createElement('div'); d.className = 'drawer'; d.id = 'fx-drawer';
    if (o.width) d.style.width = 'min(' + o.width + 'px, 96vw)';
    var tabs = [{ label: 'Details', render: function (el) { el.innerHTML = (o.facts ? '<div class="facts">' + o.facts.filter(function (f) { return f && f[1] !== undefined && f[1] !== null && f[1] !== ''; }).map(function (f) { return '<div><span>' + esc(f[0]) + '</span>' + f[1] + '</div>'; }).join('') + '</div>' : '') + (o.extra || ''); if (o.onDetails) o.onDetails(el); } }].concat(o.tabs || []);
    d.innerHTML = '<div class="drawer-h"><div><h2>' + o.title + '</h2>' + (o.sub ? '<div class="muted" style="font-size:.78rem">' + o.sub + '</div>' : '') + '</div>' + (o.chips || []).join('') +
        '<span class="grow"></span>' + (o.raw ? '<button class="btn icon sm" data-d="raw" title="Raw record"><i class="fa-solid fa-code"></i></button>' : '') + '<button class="btn icon" data-d="close"><i class="fa-solid fa-xmark"></i></button></div>' +
        (o.actions && o.actions.length ? '<div class="acts" style="padding:10px 16px;border-bottom:1px solid var(--line)">' + o.actions.map(function (a, i) { return '<button class="btn ' + (a.cls || '') + '" data-da="' + i + '">' + (a.icon ? '<i class="fa-solid ' + a.icon + '"></i> ' : '') + esc(a.label) + '</button>'; }).join('') + '</div>' : '') +
        '<div class="drawer-tabs">' + tabs.map(function (t, i) { return '<button data-dt="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' + esc(t.label) + '</button>'; }).join('') + '</div><div class="drawer-b" id="fx-drawer-b"></div>';
    document.body.appendChild(d);
    function show(i) {
        Array.prototype.forEach.call(d.querySelectorAll('[data-dt]'), function (b) { b.classList.toggle('on', +b.getAttribute('data-dt') === i); });
        var el = $('fx-drawer-b'), t = tabs[i];
        if (t.rest) {
            el.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>';
            FX.restAll(t.rest.path, t.rest.opts || {}, t.rest.max || 2000).then(function (rows) {
                if (t.rest.transform) rows = t.rest.transform(rows);
                el.innerHTML = rows.length ? FX.table(rows, t.rest.columns) : '<div class="empty"><i class="fa-solid fa-inbox"></i>None.</div>';
                if (t.after) t.after(el, rows);
            }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
        } else t.render(el);
    }
    d.onclick = function (e) {
        var b = e.target.closest('[data-d]'); if (b) { if (b.getAttribute('data-d') === 'close') FX.closeDrawer(); else FX.json('Record', o.raw); return; }
        var t = e.target.closest('[data-dt]'); if (t) { show(+t.getAttribute('data-dt')); return; }
        var a = e.target.closest('[data-da]'); if (a) o.actions[+a.getAttribute('data-da')].run(d);
    };
    show(0);
    return d;
};
FX.closeDrawer = function () { var d = $('fx-drawer'); if (d) d.remove(); };
/** Static table html from rows + columns (same column spec as the grid). */
FX.table = function (rows, cols) {
    return '<div style="overflow:auto"><table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = c.get ? c.get(r) : r[c.f]; return '<td class="' + (c.n ? 'n ' : '') + (c.fmt === 'mono' ? 'mono' : '') + '">' + (c.html ? c.html(r) : c.fmt === 'chip' ? FX.chip(v) : c.fmt && FX.fmt[c.fmt] ? FX.fmt[c.fmt](v) : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
};
/** Facts from a record: fields = [[label, field, fmt?]] */
FX.facts = function (r, fields) { return fields.map(function (f) { var v = typeof f[1] === 'function' ? f[1](r) : r[f[1]]; return [f[0], f[2] === 'raw' ? v : f[2] === 'chip' ? FX.chip(v) : f[2] && FX.fmt[f[2]] ? FX.fmt[f[2]](v) : esc(v)]; }); };

// ── forms ──────────────────────────────────────────────────────
/** fields: [{id, label, type: text|number|date|select|lov|textarea, req, value, options, lov, wide, ph}] → html; read with FX.formVals(prefix) */
FX.form = function (prefix, fields) {
    return '<div class="form">' + fields.map(function (f) {
        var id = prefix + f.id, v = f.value == null ? '' : f.value, lab = '<span>' + esc(f.label) + (f.req ? ' <b class="r">*</b>' : '') + '</span>';
        if (f.type === 'select') return '<label class="' + (f.wide ? 'wide' : '') + '">' + lab + '<select id="' + id + '">' + (f.options || []).map(function (o) { o = typeof o === 'string' ? { v: o, t: o } : o; return '<option value="' + esc(o.v) + '"' + (o.v === v ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('') + '</select></label>';
        if (f.type === 'lov') return '<label class="' + (f.wide ? 'wide' : '') + '">' + lab + '<select id="' + id + '" data-lov="' + esc(f.lov || '') + '"></select></label>';
        if (f.type === 'textarea') return '<label class="wide">' + lab + '<textarea id="' + id + '" rows="' + (f.rows || 3) + '" placeholder="' + esc(f.ph || '') + '">' + esc(v) + '</textarea></label>';
        return '<label class="' + (f.wide ? 'wide' : '') + '">' + lab + '<input id="' + id + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '"' + (f.step ? ' step="' + f.step + '"' : '') + '></label>';
    }).join('') + '</div>';
};
FX.formVals = function (prefix, fields) {
    var o = {}, miss = [];
    fields.forEach(function (f) { var e = $(prefix + f.id); if (!e) return; var v = e.value.trim(); if (f.type === 'number' && v !== '') v = +v; o[f.id] = v; if (f.req && (v === '' || v == null)) miss.push(f.label); });
    o._missing = miss; return o;
};

// ── shell ──────────────────────────────────────────────────────
FX.MODULES = [
    { id: 'om', file: 'om.html', label: 'Order Management', icon: 'fa-cart-flatbed', c: ['#fb923c', '#c2410c'] },
    { id: 'ship', file: 'shipping.html', label: 'Shipping', icon: 'fa-truck-fast', c: ['#2dd4bf', '#0f766e'] },
    { id: 'purchasing', file: 'purchasing.html', label: 'Purchasing', icon: 'fa-file-invoice', c: ['#60a5fa', '#1d4ed8'] },
    { id: 'inventory', file: 'inventory.html', label: 'Inventory', icon: 'fa-boxes-stacked', c: ['#34d399', '#047857'] },
    { id: 'costing', file: 'costing.html', label: 'Costing', icon: 'fa-coins', c: ['#fbbf24', '#b45309'] },
    { id: 'setup', file: 'setup.html', label: 'Setup & Diagnostics', icon: 'fa-screwdriver-wrench', c: ['#a78bfa', '#6d28d9'] }
];
/** opts: { module: 'om', title, sub, views: [{id, label, icon, group, render(el)}] } */
FX.start = function (opts) {
    FX.user = (function () { try { return (sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || localStorage.getItem('username') || 'UNKNOWN').toUpperCase(); } catch (e) { return 'UNKNOWN'; } })();
    FX.instance = lsGet('fx_instance', null) || (function () { try { var v = (sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'PROD').toUpperCase(); return v === 'TEST' ? 'TEST' : 'PROD'; } catch (e) { return 'PROD'; } })();
    var m = FX.MODULES.filter(function (x) { return x.id === opts.module; })[0] || FX.MODULES[0];
    document.documentElement.style.setProperty('--mod', m.c[0]); document.documentElement.style.setProperty('--mod2', m.c[1]);
    document.title = 'Fusion ' + m.label + ' — Gray\'s';
    document.body.innerHTML =
        '<header class="top"><a class="back" href="../Home/index.html" title="Home"><i class="fa-solid fa-arrow-left"></i></a><div class="logo"><i class="fa-solid ' + m.icon + '"></i></div>' +
        '<div><h1>Fusion ' + esc(m.label) + ' <span class="ver">v12.1.0</span></h1><p>' + esc(opts.sub || '') + ' · <span>' + esc(FX.user) + '</span> · <button class="inst ' + FX.instance + '" id="fx-inst" title="Fusion pod — click to switch">' + FX.instance + '</button></p></div>' +
        '<nav class="jump">' + FX.MODULES.map(function (x) { return '<a href="' + x.file + '" class="' + (x.id === m.id ? 'on' : '') + '"><i class="fa-solid ' + x.icon + '"></i> ' + esc(x.label.split(' ')[0]) + '</a>'; }).join('') + '<a href="../Home/index.html" title="Home"><i class="fa-solid fa-house"></i></a></nav></header>' +
        '<div class="shell"><nav class="nav" id="fx-nav"></nav><main class="main" id="fx-main"></main></div>' +
        '<div class="modal-bg" id="modal" hidden><div class="modal" id="modal-box"></div></div><div class="busy" id="busy" hidden><div><i class="fa-solid fa-circle-notch fa-spin"></i><span id="busy-t"></span></div></div><div class="toast" id="toast"></div>';
    FX.views = opts.views;
    var groups = [], nav = '';
    opts.views.forEach(function (v) { if (groups.indexOf(v.group || '') < 0) groups.push(v.group || ''); });
    groups.forEach(function (gname) {
        if (gname) nav += '<h5>' + esc(gname) + '</h5>';
        opts.views.filter(function (v) { return (v.group || '') === gname; }).forEach(function (v) { nav += '<button data-v="' + v.id + '"><i class="fa-solid ' + (v.icon || 'fa-circle') + '"></i> ' + esc(v.label) + '</button>'; });
    });
    $('fx-nav').innerHTML = nav;
    $('fx-nav').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) FX.show(b.getAttribute('data-v')); };
    $('fx-inst').onclick = function () {
        FX.confirm('Switch Fusion pod', 'Switch from <b>' + FX.instance + '</b> to <b>' + (FX.instance === 'PROD' ? 'TEST' : 'PROD') + '</b>? All Fusion calls in these modules go to that pod.', 'Switch').then(function (ok) {
            if (!ok) return; lsSet('fx_instance', FX.instance === 'PROD' ? 'TEST' : 'PROD'); location.reload();
        });
    };
    $('modal').addEventListener('mousedown', function (e) { if (e.target === $('modal')) FX.closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('modal').hidden) FX.closeModal(); else FX.closeDrawer(); } });
    var want = (location.hash || '').slice(1) || lsGet('fx_view_' + m.id, opts.views[0].id);
    FX.show(opts.views.some(function (v) { return v.id === want; }) ? want : opts.views[0].id);
    if (!FX.hasHost()) FX.toast('Open this page inside the Gray\'s WMS app — Fusion calls need the host.', 'err');
};
FX.show = function (id) {
    var v = FX.views.filter(function (x) { return x.id === id; })[0]; if (!v) return;
    FX.closeDrawer();
    FX.cur = v;
    Array.prototype.forEach.call(document.querySelectorAll('#fx-nav [data-v]'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === id); });
    var mod = (document.title.match(/Fusion (.+?) —/) || [])[1] || '';
    lsSet('fx_view_' + (FX.MODULES.filter(function (x) { return x.label === mod; })[0] || {}).id, id);
    history.replaceState(null, '', '#' + id);
    var main = $('fx-main');
    main.innerHTML = '<div class="view-h"><h2><i class="fa-solid ' + (v.icon || 'fa-circle') + '"></i> ' + esc(v.label) + '</h2>' + (v.desc ? '<p>' + esc(v.desc) + '</p>' : '') + '<span class="grow"></span><span id="fx-vh-r"></span></div><div id="fx-view" style="display:flex;flex-direction:column;gap:10px;flex:1;min-height:0"></div>';
    try { v.render($('fx-view')); } catch (e) { $('fx-view').innerHTML = '<div class="note err">' + esc(e && e.message || e) + '</div>'; console.error(e); }
};
