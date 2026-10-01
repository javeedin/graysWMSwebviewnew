/* Fusion Order Management — page helpers (FOM). Built on the shared engine (core.js, FX) without changing it.
   Settings (localStorage), REST helpers for relative paths AND absolute child hrefs, fetchAllPages, a stacked dialog
   (nested dialogs: pick slip → allocate …), a persistent tab workspace (tabs keep their state while you switch views),
   LOVs (BUs, order types, orgs, payment terms, sales reps, tax codes, daily rates, return reasons), customer search
   (BI Publisher through omBip, Fusion SQL fallback), formatting, dynamic columns, Excel export (SheetJS), order
   timeline. Plain script, functions on window, no modules. */

var FOM = { ws: { tabs: [], active: {} }, memo: {} };

// ── settings (per PC) ──────────────────────────────────────────
FOM.DEFAULTS = {
    orderType: 'LSO01',                       // Register New Order default order type
    srcSystem: 'OPS',                         // SourceTransactionSystem for new orders
    shipConfirmRule: '002_Ship_Confirm_Rule', // pickWaves / shipment updates
    aiSourceId: '5',                          // AutoInvoice transaction source (batch source id)
    aiPackage: '/oracle/apps/ess/financials/receivables/transactions/autoInvoices',
    aiJob: 'AutoInvoiceMasterEss',
    buyer: 'emp, arun',                       // Branch PO buyer
    poPrefix: 'BLPO',                         // Branch PO number prefix …
    soPrefixStrip: 'BCSO',                    // … replacing this sales-order prefix
    needByDays: 7,
    cancelReason: 'CUSTOMER_REQUEST',
    returnReason: 'ORA_QTY_CHANGE',
    currencies: 'AED,USD,RWF,EUR,GBP,INR,SAR,KES,TZS,UGX,ZAR,XOF,MUR',
    taxCodes: '',                             // manual list "CODE=pct, CODE2=pct" (blank = read from Fusion)
    bipCustomer: '/Custom/fusion_client/AR/CUSTOMER_SEARCH_BY_NAME_BIP.xdo',
    custSqlFallback: 'Y',                     // search HZ_ tables with Fusion SQL when the BIP report fails
    companyName: "Gray's",
    posSubmit: 'N', posSilent: 'N'
};
FOM.cfg = function (k) { var all = lsGet('fom_settings', {}) || {}; return all[k] != null && all[k] !== '' ? all[k] : FOM.DEFAULTS[k]; };
FOM.setCfg = function (o) { var all = lsGet('fom_settings', {}) || {}; Object.keys(o).forEach(function (k) { all[k] = o[k]; }); lsSet('fom_settings', all); };

// ── small utils ────────────────────────────────────────────────
FOM.pf = function (r, keys) { if (!r) return null; for (var i = 0; i < keys.length; i++) { var v = r[keys[i]]; if (v != null && v !== '') return v; } return null; };
FOM.num = function (v) { if (v == null || v === '') return null; var n = +String(v).replace(/,/g, ''); return isNaN(n) ? null : n; };
FOM.n = function (v) { return FOM.num(v) || 0; };
FOM.r2 = function (v) { return Math.round((+v || 0) * 100 + (v >= 0 ? 1e-9 : -1e-9)) / 100; };
FOM.r3 = function (v) { return Math.round((+v || 0) * 1000) / 1000; };
FOM.sum = function (rows, f) { return rows.reduce(function (s, r) { return s + FOM.n(typeof f === 'function' ? f(r) : r[f]); }, 0); };
FOM.distinct = function (a) { var s = {}, o = []; a.forEach(function (v) { if (v != null && v !== '' && !s[v]) { s[v] = 1; o.push(v); } }); return o; };
FOM.yes = function (v) { return v === true || v === 'Y' || v === 'true' || v === 'Yes'; };
var _fomMon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
FOM.d = function (v) { if (!v) return ''; var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + '-' + _fomMon[+m[2] - 1] + '-' + m[1] : String(v); };
FOM.dt = function (v) { if (!v) return ''; var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); return m ? (+m[3]) + '-' + _fomMon[+m[2] - 1] + '-' + m[1] + ' ' + m[4] + ':' + m[5] : FOM.d(v); };
FOM.amt = function (v, ccy) { var n = FOM.num(v); return n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (ccy ? ' ' + ccy : ''); };
FOM.qty = function (v) { var n = FOM.num(v); return n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 4 }); };
FOM.days = function (n, from) { var d = from ? new Date(from + 'T00:00:00') : new Date(); d.setDate(d.getDate() + n); return FX.today(d); };
FOM.ts = function () { var d = new Date(), p = function (x) { return ('0' + x).slice(-2); }; return FX.today(d) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };
FOM.iso0 = function (d) { return (d || FX.today()).slice(0, 10) + 'T00:00:00Z'; };
FOM.humanize = function (k) { return String(k).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/\bU O M\b/g, 'UOM').replace(/\bP O\b/g, 'PO').replace(/^./, function (c) { return c.toUpperCase(); }); };
FOM.isIdKey = function (k) { return k === 'links' || /Id$/.test(k) || /Id\d+$/.test(k); };
FOM.isEmpty = function (v) { return v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length); };
FOM.val = function (k, v) {
    if (FOM.isEmpty(v)) return '<span class="muted">—</span>';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'object') return '<span class="mono">' + esc(JSON.stringify(v)).slice(0, 400) + '</span>';
    if (/Date$/.test(k) || /DateTime$/.test(k) || k === 'TransactionOn' || k === 'PricedOn') return esc(FOM.dt(v));
    return esc(v);
};
FOM.mapLimit = function (items, n, fn) {
    var i = 0, out = new Array(items.length);
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve().then(function () { return fn(items[k], k); }).then(function (r) { out[k] = r; }, function (e) { out[k] = { _error: String(e) }; }).then(next); }
    var w = []; for (var x = 0; x < Math.min(n, items.length); x++) w.push(next());
    return Promise.all(w).then(function () { return out; });
};
FOM.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
FOM.copy = function (t) { try { navigator.clipboard.writeText(t); FX.toast('Copied.'); } catch (e) { FX.toast('Copy failed', 'err'); } };
FOM.download = function (name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' })); a.download = name; a.click(); };
FOM.sqlLit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
FOM.qs = function (s) { return "'" + String(s).replace(/'/g, "''") + "'"; };

// ── status colour (spec 3.0.2) and order timeline ───────────────
FOM.stCls = function (s, code) {
    var u = String(code || s || '').toUpperCase();
    if (!u) return '';
    if (/CANCEL/.test(u)) return 'err';
    if (/CLOSE/.test(u)) return '';
    if (/DRAFT/.test(u)) return 'warn';
    if (/SHIP|FULFILL|COMPLETE/.test(u)) return 'ok';
    if (/PROGRESS|AWAIT/.test(u)) return 'done';
    return 'info';
};
FOM.chip = function (s, code) { if (!s && !code) return '<span class="muted">—</span>'; return '<span class="chip ' + FOM.stCls(s, code) + '">' + esc(String(s || code).replace(/_/g, ' ')) + '</span>'; };
FOM.lineStatus = function (l) { return String((FOM.pf(l, ['DisplayStatus', 'Status', 'FulfillLineStatus']) || '') + ' ' + (l.StatusCode || '')); };
FOM.STAGES = ['Draft', 'Booked', 'Picked', 'Shipped', 'Invoiced'];
/** → {i: 0..4, bad: label?} from the header status and the lines. */
FOM.orderStage = function (h, lines) {
    var code = String((h && (h.StatusCode || h.Status)) || '').toUpperCase();
    if (/CANCEL/.test(code) || (h && FOM.yes(h.CanceledFlag))) return { i: 1, bad: 'Canceled' };
    if (/DRAFT/.test(code) || !code) return { i: 0, hold: h && FOM.yes(h.OnHoldFlag) };
    var ls = (lines || []).filter(function (l) { return !FOM.yes(l.CanceledFlag) && !/cancel/i.test(FOM.lineStatus(l)); }).map(function (l) { return FOM.lineStatus(l).toLowerCase(); });
    var hold = h && FOM.yes(h.OnHoldFlag);
    if (/CLOSED/.test(code) || (ls.length && ls.every(function (s) { return /billed|closed|invoic/.test(s); }))) return { i: 4, hold: hold };
    if (ls.length && ls.every(function (s) { return /shipped|awaiting billing|billed|closed|fulfilled|invoic/.test(s); })) return { i: 3, hold: hold };
    if (ls.some(function (s) { return /picked|staged|pick confirm|shipped|awaiting billing/.test(s); })) return { i: 2, hold: hold };
    return { i: 1, hold: hold };
};
FOM.timeline = function (st) {
    return '<div class="fom-tl">' + FOM.STAGES.map(function (n, j) {
        var cls = st.bad && j === st.i ? 'bad' : j < st.i ? 'done' : j === st.i ? 'cur' : '';
        var ic = ['fa-pen-ruler', 'fa-clipboard-check', 'fa-hand-holding-box', 'fa-truck-fast', 'fa-file-invoice-dollar'][j];
        return '<div class="fom-st ' + cls + '"><span class="dot"><i class="fa-solid ' + (cls === 'done' ? 'fa-check' : cls === 'bad' ? 'fa-ban' : ic) + '"></i></span><b>' + (st.bad && j === st.i ? esc(st.bad) : n) + '</b></div>';
    }).join('<span class="bar"></span>') + (st.hold ? '<span class="chip warn" style="margin-left:10px"><i class="fa-solid fa-hand"></i> On hold</span>' : '') + '</div>';
};

// ── REST (relative paths and absolute hrefs) ───────────────────
/** URL for a relative resource path (FX.url) or an absolute href (child link) with the same options. */
FOM.u = function (p, o) {
    o = o || {};
    if (!/^https:\/\//.test(p)) return FX.url(p, o);
    var u; try { u = new URL(p); } catch (e) { return p; }
    var set = function (k, v) { if (v == null || v === '') return; u.searchParams.set(k, v); };
    set('q', o.q); set('finder', o.finder); set('fields', o.fields); set('expand', o.expand); set('orderBy', o.orderBy);
    if (o.limit != null) u.searchParams.set('limit', o.limit);
    if (o.offset != null) u.searchParams.set('offset', o.offset);
    if (o.total) u.searchParams.set('totalResults', 'true');
    if (o.onlyData === false) u.searchParams.delete('onlyData'); else if (!u.searchParams.has('onlyData')) u.searchParams.set('onlyData', 'true');
    Object.keys(o.params || {}).forEach(function (k) { set(k, o.params[k]); });
    return u.toString().replace(/\+/g, '%20');
};
FOM.get = function (p, o) { return FX.rest('GET', FOM.u(p, o), o); };
/** Never throws on an HTTP status → {ok, status, json, text, error}. */
FOM.raw = function (method, p, o, body) { return FX.restRaw(method, FOM.u(p, o), o || {}, body); };
/** POST/PATCH that throws a readable error (collectOrderErrors) on failure → parsed JSON. */
FOM.write = function (method, p, body, o) {
    o = Object.assign({ contentType: 'json' }, o || {});
    return FOM.raw(method, p, o, body).then(function (r) {
        if (!r.ok) { var e = new Error(FOM.errs(r.json, r.text, r.status).join('\n')); e.status = r.status; e.json = r.json; e.text = r.text; throw e; }
        return r.json || {};
    });
};
/** fetchAllPages: strips limit/offset, loops limit (500) / offset until hasMore = false or a short page. */
FOM.all = function (p, o, max, onPage) {
    o = Object.assign({}, o || {}); max = max || 20000;
    var lim = o.limit || 500, all = [];
    function page(off) {
        return FOM.get(p, Object.assign({}, o, { limit: lim, offset: off })).then(function (j) {
            var items = Array.isArray(j) ? j : (j.items || []);
            all = all.concat(items); if (onPage) onPage(all.length);
            if (!Array.isArray(j) && j.hasMore && items.length >= lim && all.length < max) return page(off + items.length);
            if (!Array.isArray(j) && j.hasMore && items.length && items.length < lim && all.length < max) return page(off + items.length);
        });
    }
    return page(o.offset || 0).then(function () { return all.slice(0, max); });
};
FOM.link = function (r, names) {
    names = [].concat(names).map(function (n) { return String(n).toLowerCase(); });
    var l = (r && r.links || []).filter(function (x) { return names.indexOf(String(x.name || '').toLowerCase()) >= 0; })[0];
    return l ? l.href : null;
};
FOM.self = function (r) { var l = (r && r.links || []).filter(function (x) { return x.rel === 'self'; })[0]; return l ? l.href.replace(/\?.*$/, '') : null; };
/** collectOrderErrors (3.3.9): title, detail, every o:errorDetails[].detail|title; else the raw text → lines. */
FOM.errs = function (j, text, status) {
    var out = [];
    if (j && typeof j === 'object') {
        if (j.title) out.push(String(j.title));
        if (j.detail && j.detail !== j.title) out.push(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail));
        (j['o:errorDetails'] || j.errorDetails || []).forEach(function (d) { var m = d.detail || d.title; if (m && out.indexOf(m) < 0) out.push((d['o:errorPath'] ? d['o:errorPath'] + ': ' : '') + m); });
        if (j.ReturnStatus === 'E' && j.ReturnMessage) out.push(j.ReturnMessage);
    }
    if (!out.length && text) out.push(String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000));
    if (!out.length) out.push('HTTP ' + (status || '?'));
    return out.join('\n').split(/\n+/).filter(Boolean);
};
FOM.emsg = function (e) { return String(e && e.message || e || 'Error'); };

// ── stacked dialogs (FX.modal allows one; flows here nest) ──────
FOM.dlgs = [];
/** o: {title, body, wide, xwide, buttons:[{label, act, cls}], onAction(act, d, btn) (false keeps open; promise → closes when it resolves !== false), onOpen(d), onClose()} → d {box, q(sel), qa(sel), close(), set(html)} */
FOM.dlg = function (o) {
    var bg = document.createElement('div'); bg.className = 'modal-bg fom-dlg'; bg.style.zIndex = 61 + FOM.dlgs.length;
    var box = document.createElement('div'); box.className = 'modal' + (o.wide ? ' wide' : '') + (o.xwide ? ' fom-xwide' : '');
    box.innerHTML = '<div class="modal-h"><h3>' + o.title + '</h3><span class="grow"></span>' + (o.head || '') + '<button class="x" data-mact="close" title="Close">&times;</button></div><div class="modal-b">' + (o.body || '') + '</div>' +
        '<div class="modal-f">' + (o.foot || '') + (o.buttons || [{ label: 'Close', act: 'close' }]).map(function (b) { return '<button class="btn ' + (b.cls || '') + '" data-mact="' + b.act + '"' + (b.id ? ' id="' + b.id + '"' : '') + (b.disabled ? ' disabled' : '') + '>' + b.label + '</button>'; }).join('') + '</div>';
    bg.appendChild(box); document.body.appendChild(bg);
    var d = { box: box, bg: bg, o: o, closed: false };
    d.q = function (s) { return box.querySelector(s); };
    d.qa = function (s) { return Array.prototype.slice.call(box.querySelectorAll(s)); };
    d.body = function () { return box.querySelector('.modal-b'); };
    d.close = function () { if (d.closed) return; d.closed = true; bg.remove(); FOM.dlgs.splice(FOM.dlgs.indexOf(d), 1); if (o.onClose) o.onClose(d); };
    FOM.dlgs.push(d);
    box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-mact]'); if (!b || !box.contains(b)) return;
        var act = b.getAttribute('data-mact');
        if (act === 'close') { d.close(); return; }
        if (!o.onAction) return;
        var r = o.onAction(act, d, b);
        if (r && r.then) { b.disabled = true; r.then(function (keep) { b.disabled = false; if (keep !== false && keep !== undefined) d.close(); }).catch(function (er) { b.disabled = false; FX.toast(FOM.emsg(er), 'err'); }); }
        else if (r === true) d.close();
    });
    if (o.onOpen) o.onOpen(d);
    var f = box.querySelector('input:not([type=checkbox]):not([readonly]):not([disabled]), select, textarea'); if (f && o.focus !== false) setTimeout(function () { try { f.focus(); } catch (e) { } }, 30);
    return d;
};
window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !FOM.dlgs.length) return;
    var ta = e.target && e.target.closest && e.target.closest('.ta'); if (ta && ta.querySelector('.ta-list:not([hidden])')) return;
    e.stopImmediatePropagation(); e.preventDefault(); FOM.dlgs[FOM.dlgs.length - 1].close();
}, true);
FOM.confirm = function (title, html, ok, cls) {
    return new Promise(function (res) {
        var yes = false;
        FOM.dlg({ title: title, body: html, buttons: [{ label: 'Cancel', act: 'close' }, { label: ok || 'OK', cls: cls || 'primary', act: 'ok' }], onAction: function (a) { if (a === 'ok') { yes = true; return true; } }, onClose: function () { res(yes); } });
    });
};
FOM.alert = function (title, html, cls) { return FOM.dlg({ title: title, body: '<div class="note ' + (cls || '') + '" style="white-space:pre-wrap">' + html + '</div>' }); };
FOM.json = function (title, obj, extra) {
    var txt = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    return FOM.dlg({ title: title, wide: true, body: (extra || '') + '<pre class="json">' + esc(txt) + '</pre>', buttons: [{ label: '<i class="fa-regular fa-copy"></i> Copy', act: 'copy' }, { label: 'Close', act: 'close' }], onAction: function (a) { if (a === 'copy') { FOM.copy(txt); return false; } } });
};
/** Show a REST call (method / url / body) before running it; resolves true on Run. */
FOM.preview = function (title, calls, okLabel, cls) {
    var html = calls.map(function (c) { return '<div class="fom-call"><b class="m ' + c.method + '">' + c.method + '</b> <span class="mono">' + esc(c.url) + '</span>' + (c.body ? '<pre class="json" style="max-height:220px;margin-top:6px">' + esc(JSON.stringify(c.body, null, 2)) + '</pre>' : '') + '</div>'; }).join('');
    return FOM.confirm(title, (calls.note ? '<div class="note">' + calls.note + '</div>' : '') + html, okLabel || 'Run', cls);
};

// ── tab components ─────────────────────────────────────────────
/** Simple tab bar: tabs [{id, label, badge, render(el, reload)}]; renders lazily and caches; returns {show(id), reload(id), badge(id, v)} */
FOM.tabs = function (el, tabs, opts) {
    opts = opts || {};
    el.innerHTML = '<div class="fom-tabs' + (opts.cls ? ' ' + opts.cls : '') + '">' + tabs.map(function (t) { return '<button data-ft="' + t.id + '"' + (t.hidden ? ' hidden' : '') + '>' + (t.icon ? '<i class="fa-solid ' + t.icon + '"></i> ' : '') + esc(t.label) + '<span class="bdg" data-fb="' + t.id + '">' + (t.badge != null ? esc(t.badge) : '') + '</span></button>'; }).join('') + '</div><div class="fom-tabb"></div>';
    var bar = el.firstChild, body = el.lastChild, panes = {}, api = { cur: null };
    api.show = function (id) {
        var t = tabs.filter(function (x) { return x.id === id; })[0] || tabs[0]; api.cur = t.id;
        Array.prototype.forEach.call(bar.children, function (b) { b.classList.toggle('on', b.getAttribute('data-ft') === t.id); });
        Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== t.id; });
        if (!panes[t.id]) { var p = document.createElement('div'); p.className = 'fom-pane'; body.appendChild(p); panes[t.id] = p; t.render(p, function () { api.reload(t.id); }); }
        if (opts.onShow) opts.onShow(t.id);
    };
    api.reload = function (id) { var p = panes[id]; if (p) { p.remove(); delete panes[id]; } if (api.cur === id) api.show(id); };
    api.badge = function (id, v) { var b = bar.querySelector('[data-fb="' + id + '"]'); if (b) b.textContent = v == null ? '' : v; };
    api.hide = function (id, h) { var b = bar.querySelector('[data-ft="' + id + '"]'); if (b) b.hidden = !!h; };
    bar.onclick = function (e) { var b = e.target.closest('[data-ft]'); if (b) api.show(b.getAttribute('data-ft')); };
    api.show(opts.start || tabs[0].id);
    return api;
};
/** Persistent workspace per area (a nav view): tabs keep their DOM (and state) while other views are shown. */
FOM.wsTabs = function (area) { return FOM.ws.tabs.filter(function (t) { return t.area === area; }); };
FOM.open = function (area, t) {
    var ex = FOM.ws.tabs.filter(function (x) { return x.id === t.id; })[0];
    if (!ex) {
        ex = Object.assign({ area: area, closable: true }, t);
        ex.el = document.createElement('div'); ex.el.className = 'fom-wsp';
        FOM.ws.tabs.push(ex);
        try { ex.build(ex.el, ex); } catch (e) { ex.el.innerHTML = '<div class="note err">' + esc(e && e.message || e) + '</div>'; console.error(e); }
    }
    FOM.ws.active[area] = ex.id;
    if (FX.cur && FX.cur.id === area) FOM.drawWs(area); else FX.show(area);
    return ex;
};
FOM.closeTab = function (id) {
    var t = FOM.ws.tabs.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    var list = FOM.wsTabs(t.area), i = list.indexOf(t);
    FOM.ws.tabs.splice(FOM.ws.tabs.indexOf(t), 1);
    if (t.onClose) t.onClose(t);
    if (FOM.ws.active[t.area] === id) { var prev = list[i - 1] || list[i + 1]; FOM.ws.active[t.area] = prev ? prev.id : null; }
    FOM.drawWs(t.area);
};
FOM.relabel = function (id, label) { var t = FOM.ws.tabs.filter(function (x) { return x.id === id; })[0]; if (t) { t.label = label; if (FX.cur && FX.cur.id === t.area) FOM.drawWs(t.area); } };
FOM.wsHost = {};
FOM.renderWs = function (area, el, extraBtns) { FOM.wsHost[area] = { el: el, extra: extraBtns || '' }; FOM.drawWs(area); };
FOM.drawWs = function (area) {
    var h = FOM.wsHost[area]; if (!h || !document.body.contains(h.el)) return;
    var list = FOM.wsTabs(area), act = FOM.ws.active[area];
    if (!list.some(function (t) { return t.id === act; })) act = FOM.ws.active[area] = list.length ? list[0].id : null;
    var strip = h.el.querySelector(':scope > .fom-ws-strip'), pane = h.el.querySelector(':scope > .fom-ws-body');
    if (!strip) { h.el.innerHTML = '<div class="fom-ws-strip"></div><div class="fom-ws-body"></div>'; strip = h.el.firstChild; pane = h.el.lastChild; strip.onclick = function (e) { var x = e.target.closest('[data-wx]'); if (x) { e.stopPropagation(); FOM.closeTab(x.getAttribute('data-wx')); return; } var b = e.target.closest('[data-wt]'); if (b) { FOM.ws.active[area] = b.getAttribute('data-wt'); FOM.drawWs(area); } }; }
    strip.innerHTML = list.map(function (t) { return '<button class="' + (t.id === act ? 'on' : '') + '" data-wt="' + esc(t.id) + '">' + (t.icon ? '<i class="fa-solid ' + t.icon + '"></i> ' : '') + esc(t.label) + (t.closable ? ' <span class="wx" data-wx="' + esc(t.id) + '" title="Close">&times;</span>' : '') + '</button>'; }).join('') + '<span class="grow"></span>' + h.extra;
    list.forEach(function (t) { if (t.el.parentNode !== pane) pane.appendChild(t.el); t.el.hidden = t.id !== act; });
    Array.prototype.slice.call(pane.children).forEach(function (c) { if (!list.some(function (t) { return t.el === c; })) c.remove(); });
    var cur = list.filter(function (t) { return t.id === act; })[0]; if (cur && cur.onShow) cur.onShow(cur);
};

// ── dynamic columns / all fields (3.0.1) ───────────────────────
FOM.dyn = function (rows, exclude) {
    exclude = exclude || []; var keys = [], seen = {};
    rows.forEach(function (r) { Object.keys(r || {}).forEach(function (k) { if (!seen[k] && !FOM.isIdKey(k) && exclude.indexOf(k) < 0 && !/^_/.test(k)) { if (!FOM.isEmpty(r[k])) { seen[k] = 1; keys.push(k); } } }); });
    return keys.map(function (k) { return { f: k, label: FOM.humanize(k), html: function (r) { return FOM.val(k, r[k]); } }; });
};
FOM.allFields = function (row, title) {
    var keys = Object.keys(row || {}).filter(function (k) { return k !== 'links' && !FOM.isEmpty(row[k]) && typeof row[k] !== 'object'; }).sort();
    var html = '<input class="fom-in" placeholder="Filter fields…" data-af style="max-width:300px"><div class="facts fom-af">' + keys.map(function (k) { return '<div data-k="' + esc(k.toLowerCase()) + '"><span>' + esc(FOM.humanize(k)) + ' <i class="muted mono">' + esc(k) + '</i></span>' + FOM.val(k, row[k]) + '</div>'; }).join('') + '</div>';
    FOM.dlg({
        title: title || 'All Oracle fields', wide: true, body: html, buttons: [{ label: 'JSON', act: 'json' }, { label: 'Close', act: 'close' }],
        onOpen: function (d) { d.q('[data-af]').oninput = function () { var v = this.value.toLowerCase(); d.qa('.fom-af > div').forEach(function (x) { x.hidden = v && x.getAttribute('data-k').indexOf(v) < 0 && x.textContent.toLowerCase().indexOf(v) < 0; }); }; },
        onAction: function (a) { if (a === 'json') { FOM.json('Record', row); return false; } }
    });
};
/** Static table (columns like FX.grid) with an optional footer row and row click. */
FOM.table = function (rows, cols, o) {
    o = o || {};
    if (!rows.length) return '<div class="empty"><i class="fa-solid ' + (o.icon || 'fa-inbox') + '"></i>' + esc(o.empty || 'Nothing here.') + '</div>';
    return '<div class="fom-tw"' + (o.maxH ? ' style="max-height:' + o.maxH + 'px"' : '') + '><table class="tbl' + (o.cls ? ' ' + o.cls : '') + '"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '">' + (c.th || esc(c.label)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r, i) { return '<tr data-i="' + i + '"' + (o.rowCls ? ' class="' + o.rowCls(r, i) + '"' : '') + '>' + cols.map(function (c) { var v = c.get ? c.get(r, i) : r[c.f]; return '<td class="' + (c.n ? 'n ' : '') + (c.mono ? 'mono' : '') + '">' + (c.html ? c.html(r, i) : c.fmt === 'chip' ? FOM.chip(v) : c.fmt === 'amt' ? FOM.amt(v) : c.fmt === 'qty' ? FOM.qty(v) : c.fmt === 'd' ? esc(FOM.d(v)) : c.fmt === 'dt' ? esc(FOM.dt(v)) : esc(v == null ? '' : v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>' +
        (o.foot ? '<tfoot><tr>' + o.foot.map(function (f) { return '<td class="' + (f && f.n ? 'n' : '') + '"><b>' + (f && f.v != null ? f.v : (f || '')) + '</b></td>'; }).join('') + '</tr></tfoot>' : '') + '</table></div>';
};
/** Client paged + filtered table inside el: cfg {rows, cols, pageSize, filter(row) text, foot(rows), onRow(row), empty} */
FOM.ptable = function (el, cfg) {
    var st = { page: 0, q: '' };
    el.innerHTML = (cfg.noFilter ? '' : '<div class="row-btns" style="margin-bottom:6px"><input class="fom-in" data-pq placeholder="Filter any column…" style="max-width:280px"><span class="muted" data-pc style="font-size:.76rem"></span><span class="grow"></span>' + (cfg.tools || '') + '</div>') + '<div data-pt></div><div class="row-btns" data-pp style="justify-content:flex-end;margin-top:6px"></div>';
    function vis() { var q = st.q; return q ? cfg.rows.filter(function (r) { return (cfg.filter ? cfg.filter(r) : JSON.stringify(r)).toLowerCase().indexOf(q) >= 0; }) : cfg.rows; }
    function draw() {
        var rows = vis(), ps = cfg.pageSize || 25, pages = Math.max(1, Math.ceil(rows.length / ps)); if (st.page >= pages) st.page = pages - 1;
        var slice = rows.slice(st.page * ps, st.page * ps + ps);
        el.querySelector('[data-pt]').innerHTML = FOM.table(slice, cfg.cols, { empty: cfg.empty, foot: cfg.foot ? cfg.foot(rows) : null, rowCls: cfg.onRow ? function () { return 'click'; } : null });
        var pc = el.querySelector('[data-pc]'); if (pc) pc.textContent = rows.length + (rows.length !== cfg.rows.length ? ' of ' + cfg.rows.length : '') + ' row(s)';
        el.querySelector('[data-pp]').innerHTML = pages > 1 ? '<button class="btn sm" data-pg="-1"' + (st.page ? '' : ' disabled') + '>‹</button><span class="muted" style="font-size:.76rem">' + (st.page * ps + 1) + '–' + Math.min(rows.length, st.page * ps + ps) + ' of ' + rows.length + '</span><button class="btn sm" data-pg="1"' + (st.page < pages - 1 ? '' : ' disabled') + '>›</button>' : '';
        st.slice = slice;
    }
    el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-pg]'); if (b) { st.page += +b.getAttribute('data-pg'); draw(); return; }
        var tr = e.target.closest('tr[data-i]'); if (tr && cfg.onRow && !e.target.closest('button, a, input, select')) cfg.onRow(st.slice[+tr.getAttribute('data-i')]);
        var a = e.target.closest('[data-ra]'); if (a && cfg.onAct) { var tr2 = a.closest('tr[data-i]'); cfg.onAct(a.getAttribute('data-ra'), st.slice[+tr2.getAttribute('data-i')], a); }
    });
    var qi = el.querySelector('[data-pq]'); if (qi) qi.oninput = function () { st.q = this.value.toLowerCase(); st.page = 0; draw(); };
    draw();
    return { draw: draw, set: function (rows) { cfg.rows = rows; st.page = 0; draw(); }, visible: vis };
};

// ── Excel (SheetJS) ────────────────────────────────────────────
/** sheets: [{name, aoa:[[...]], cols:[widths], merges:[[r0,c0,r1,c1]]}] */
FOM.xlsx = function (file, sheets) {
    if (!window.XLSX) { var s = sheets[0], q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; FOM.download(file.replace(/\.xlsx$/, '.csv'), '﻿' + s.aoa.map(function (r) { return r.map(q).join(','); }).join('\r\n'), 'text/csv'); FX.toast('Excel library not loaded — saved as CSV.'); return; }
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
        var ws = XLSX.utils.aoa_to_sheet(s.aoa);
        if (s.cols) ws['!cols'] = s.cols.map(function (w) { return { wch: w }; });
        if (s.merges) ws['!merges'] = s.merges.map(function (m) { return { s: { r: m[0], c: m[1] }, e: { r: m[2], c: m[3] } }; });
        XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    XLSX.writeFile(wb, file);
};

// ── LOVs ───────────────────────────────────────────────────────
FOM.once = function (k, fn) { k = k + '|' + FX.instance; if (!FOM.memo[k]) FOM.memo[k] = fn().catch(function (e) { delete FOM.memo[k]; throw e; }); return FOM.memo[k]; };
/** Business units from payablesOptions (deduped by name) → [{v: id, t: name, ccy}]; falls back to finBusinessUnitsLOV. */
FOM.bus = function () {
    return FOM.once('bus', function () {
        return FX.restAll('payablesOptions', { fields: 'businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency', limit: 500 }, 2000).then(function (rows) {
            var seen = {}, out = [];
            rows.forEach(function (r) { var n = r.businessUnitName || r.BusinessUnitName; if (!n || seen[n]) return; seen[n] = 1; out.push({ v: String(r.businessUnitId || r.BusinessUnitId), t: n, ccy: r.paymentCurrency || r.ledgerCurrency || '', o: r }); });
            if (!out.length) throw 'no payables options';
            return out.sort(function (a, b) { return a.t.localeCompare(b.t); });
        }).catch(function () { return FX.lov('bus').then(function (l) { return l.map(function (x) { return { v: String(x.id), t: x.v, ccy: '', o: x.o }; }); }); });
    });
};
FOM.buById = function (id) { return FOM.bus().then(function (l) { return l.filter(function (b) { return b.v === String(id); })[0] || null; }); };
/** Order types: standardLookups ORA_DOO_ORDER_TYPES (expand lookupCodes) → [{v, t, branch}] */
FOM.orderTypes = function () {
    return FOM.once('otypes', function () {
        return FX.get('standardLookups', { q: "LookupType LIKE 'ORA_DOO_ORDER_TYPES%'", expand: 'lookupCodes', limit: 500 }).then(function (j) {
            var out = [];
            (j.items || []).forEach(function (it) { (it.lookupCodes || []).forEach(function (c) { if (c.EnabledFlag === 'N') return; out.push({ v: c.LookupCode, t: c.Meaning || c.LookupCode, branch: String(c.Tag || '').toUpperCase() === 'BRANCH SALES', o: c }); }); });
            return out.sort(function (a, b) { return String(a.t).localeCompare(String(b.t)); });
        });
    });
};
FOM.isBranch = function (code) { return FOM.orderTypes().then(function (l) { var t = l.filter(function (x) { return x.v === code; })[0]; return !!(t && t.branch); }).catch(function () { return false; }); };
FOM.branchPoCode = function (code) {
    return FOM.once('bpo_' + code, function () { return FX.get('standardLookups/ORA_DOO_ORDER_TYPES/child/lookupCodes/' + encodeURIComponent(code) + '/child/lookupsDFF').then(function (j) { return ((j.items || [])[0] || {}).branchPoCode || ''; }); }).catch(function () { return ''; });
};
FOM.orgs = function () { return FOM.once('orgs', function () { return FX.restAll('inventoryOrganizations', { limit: 500 }, 5000); }); };
FOM.orgsForBu = function (buId, buName) {
    return FOM.orgs().then(function (all) {
        var f = all.filter(function (o) { return [o.BusinessUnitId, o.ManagementBusinessUnitId, o.ProfitCenterBusinessUnitId].some(function (x) { return x != null && String(x) === String(buId); }) || [o.BusinessUnitName, o.ManagementBusinessUnitName, o.ProfitCenterBusinessUnitName].some(function (x) { return x && x === buName; }); });
        return (f.length ? f : all).map(function (o) { return { v: o.OrganizationCode, t: o.OrganizationCode + ' — ' + (o.OrganizationName || ''), id: o.OrganizationId, o: o }; });
    });
};
FOM.subinvs = function (org) { return org ? FX.subinvs(org).then(function (l) { return l.map(function (x) { return x.v; }).sort(); }) : Promise.resolve([]); };
FOM.PT_FALLBACK = ['Immediate', '30 Net', '45 Net', '60 Net', 'CR7D', 'CR30D', 'CR45D'];
/** Payment terms: Fusion SQL on RA_TERMS (read-only), fallback list; the field also accepts typed values. */
FOM.paymentTerms = function () {
    return FOM.once('pterms', function () {
        return FX.sql("SELECT t.NAME FROM RA_TERMS_TL t JOIN RA_TERMS_B b ON b.TERM_ID = t.TERM_ID WHERE t.LANGUAGE = 'US' AND (b.END_DATE_ACTIVE IS NULL OR b.END_DATE_ACTIVE > SYSDATE) ORDER BY t.NAME", 2000)
            .then(function (r) { var l = FOM.distinct(r.map(function (x) { return x.NAME; })); if (!l.length) throw 'none'; return l; });
    }).catch(function () { return FOM.PT_FALLBACK.slice(); });
};
/** Salespersons: JTF resources (Fusion SQL) → [{v: name, id: resource id}]; empty on failure (manual entry). */
FOM.salesReps = function () {
    return FOM.once('reps', function () {
        return FX.sql("SELECT DISTINCT p.PARTY_NAME AS NAME, r.RESOURCE_ID AS ID FROM JTF_RS_SALESREPS r JOIN JTF_RS_RESOURCE_PROFILES rp ON rp.RESOURCE_ID = r.RESOURCE_ID JOIN HZ_PARTIES p ON p.PARTY_ID = rp.PARTY_ID WHERE NVL(r.END_DATE_ACTIVE, SYSDATE + 1) > SYSDATE ORDER BY 1", 3000)
            .then(function (r) { return r.filter(function (x) { return x.NAME; }).map(function (x) { return { v: x.NAME, id: x.ID != null && /^\d+$/.test(String(x.ID)) ? +x.ID : null }; }); });
    }).catch(function () { return []; });
};
/** Tax codes → [{code, pct}]: Settings list ("CODE=pct, …") or ZX rates (Fusion SQL). */
FOM.taxCodes = function () {
    var man = String(FOM.cfg('taxCodes') || '').trim();
    if (man) return Promise.resolve(man.split(/[,;\n]+/).map(function (s) { var m = s.split(/[=:]/); return { code: m[0].trim(), pct: FOM.n(m[1]) }; }).filter(function (t) { return t.code; }));
    return FOM.once('tax', function () {
        return FX.sql("SELECT DISTINCT TAX_RATE_CODE AS CODE, PERCENTAGE_RATE AS PCT FROM ZX_RATES_B WHERE ACTIVE_FLAG = 'Y' AND NVL(EFFECTIVE_TO, SYSDATE + 1) > SYSDATE AND PERCENTAGE_RATE IS NOT NULL ORDER BY 1", 3000)
            .then(function (r) { return r.map(function (x) { return { code: x.CODE, pct: FOM.n(x.PCT) }; }); });
    }).catch(function () { return []; });
};
FOM.taxOpts = function (list, val, blank) { return (blank !== false ? '<option value="">' + (blank || '— none —') + '</option>' : '') + list.map(function (t) { return '<option value="' + esc(t.code) + '"' + (t.code === val ? ' selected' : '') + '>' + esc(t.code) + ' (' + t.pct + '%)</option>'; }).join('') + (val && !list.some(function (t) { return t.code === val; }) ? '<option selected value="' + esc(val) + '">' + esc(val) + '</option>' : ''); };
FOM.currencies = function () { return String(FOM.cfg('currencies')).split(/[,\s]+/).filter(Boolean); };
/** Daily rate txn → base (latest on or before the date): GL_DAILY_RATES via Fusion SQL, then the currencyRates REST; null = enter manually. */
FOM.dailyRate = function (from, to, date, type) {
    if (!from || !to || from === to) return Promise.resolve(1);
    date = date || FX.today(); type = type && type !== 'User' ? type : 'Corporate';
    var sql = "SELECT * FROM (SELECT r.CONVERSION_RATE AS RATE, TO_CHAR(r.CONVERSION_DATE,'YYYY-MM-DD') AS D FROM GL_DAILY_RATES r JOIN GL_DAILY_CONVERSION_TYPES t ON t.CONVERSION_TYPE = r.CONVERSION_TYPE WHERE r.FROM_CURRENCY = " + FOM.sqlLit(from) + " AND r.TO_CURRENCY = " + FOM.sqlLit(to) + " AND t.USER_CONVERSION_TYPE = " + FOM.sqlLit(type) + " AND r.CONVERSION_DATE <= TO_DATE(" + FOM.sqlLit(date) + ",'YYYY-MM-DD') ORDER BY r.CONVERSION_DATE DESC) WHERE ROWNUM = 1";
    return FX.sql(sql, 1).then(function (r) { var v = r[0] && FOM.num(r[0].RATE); if (v == null) throw 'none'; return v; })
        .catch(function () {
            return FX.get('currencyRates', { finder: 'CurrencyRatesFinder;fromCurrency=' + from + ',toCurrency=' + to + ',userConversionType=' + type + ',startDate=' + FOM.days(-30, date) + ',endDate=' + date, limit: 50 })
                .then(function (j) { var it = (j.items || []).sort(function (a, b) { return String(b.ConversionDate || '').localeCompare(String(a.ConversionDate || '')); })[0]; return it ? FOM.num(it.ConversionRate) : null; });
        }).catch(function () { return null; });
};
FOM.returnReasons = function () {
    var fb = [['ORA_QTY_CHANGE', 'Quantity change'], ['ORA_DAMAGED', 'Damaged item'], ['ORA_DEFECTIVE', 'Defective item'], ['ORA_WRONG_ITEM', 'Wrong item shipped'], ['ORA_NOT_REQUIRED', 'No longer required']].map(function (x) { return { v: x[0], t: x[1] }; });
    return FOM.once('rr', function () { return FX.get('standardLookupsLOV', { finder: 'LookupTypeFinder;LookupType=DOO_RETURN_REASON', limit: 200 }).then(function (j) { var l = (j.items || []).map(function (x) { return { v: x.LookupCode, t: x.Meaning || x.LookupCode }; }); if (!l.length) throw 'none'; return l; }); }).catch(function () { return fb; });
};
FOM.opts = function (list, val, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) { x = typeof x === 'string' ? { v: x, t: x } : x; return '<option value="' + esc(x.v) + '"' + (String(x.v) === String(val) ? ' selected' : '') + '>' + esc(x.t) + '</option>'; }).join('') + (val && !list.some(function (x) { return String(typeof x === 'string' ? x : x.v) === String(val); }) ? '<option value="' + esc(val) + '" selected>' + esc(val) + '</option>' : ''); };

// ── customers (BI Publisher, §11/§12; Fusion SQL fallback) ─────
FOM.BIP_COLS = { PARTY_NUMBER: 'partyNumber', ACCOUNT_NAME: 'accountName', ACCOUNT_NUMBER: 'accountNumber', ADDRESS1: 'address1', ADDRESS2: 'address2', CITY: 'city', COUNTRY: 'country', CREDIT_LIMIT: 'creditLimit', PR_CREDIT_LIMIT: 'prCreditLimit', CUSTOMER_CLASS_CODE: 'customerClassCode', STATUS: 'status', CUST_ACCOUNT_ID: 'custAccountId', PARTY_ID: 'partyId', BILL_TO_SITE_USE_ID: 'billToSiteUseId', SHIP_TO_PARTY_SITE_ID: 'shipToPartySiteId', BU_NAME: 'buName' };
FOM.mapBipCust = function (row) {
    var c = {}; Object.keys(row).forEach(function (k) { var f = FOM.BIP_COLS[String(k).toUpperCase()]; if (!f) return; var v = row[k]; if (v === '' || v == null) return; c[f] = /creditLimit/i.test(f) ? FOM.num(v) : v; });
    return c;
};
/** type: 'name' | 'account' → Promise<[customer]> (source noted in .source). */
FOM.searchCustomers = function (buId, term, type) {
    var params = { BUSINESS_UNIT_ID: buId ? String(buId) : '' };
    if (type === 'account') params.account_number = term; else params.CUSTOMER_NAME = term;
    return FX.host('omBip', { path: FOM.cfg('bipCustomer'), params: params }).then(function (r) {
        if (!r || r.ok === false) throw (r && r.error) || 'Report failed';
        var l = (r.rows || []).map(FOM.mapBipCust).filter(function (c) { return c.accountName || c.accountNumber; }); l.source = 'BI Publisher'; return l;
    }).catch(function (e) {
        if (FOM.cfg('custSqlFallback') !== 'Y') throw e;
        var w = type === 'account' ? "hca.ACCOUNT_NUMBER = " + FOM.sqlLit(term) : "UPPER(hca.ACCOUNT_NAME) LIKE " + FOM.sqlLit('%' + String(term).toUpperCase() + '%');
        var sql = "SELECT * FROM (SELECT hp.PARTY_NUMBER, hca.ACCOUNT_NAME, hca.ACCOUNT_NUMBER, hl.ADDRESS1, hl.ADDRESS2, hl.CITY, hl.COUNTRY, hca.STATUS, hca.CUST_ACCOUNT_ID, hp.PARTY_ID," +
            " (SELECT MIN(su.SITE_USE_ID) FROM HZ_CUST_SITE_USES_ALL su WHERE su.CUST_ACCT_SITE_ID = cas.CUST_ACCT_SITE_ID AND su.SITE_USE_CODE = 'BILL_TO' AND su.STATUS = 'A') AS BILL_TO_SITE_USE_ID," +
            " hps.PARTY_SITE_ID AS SHIP_TO_PARTY_SITE_ID FROM HZ_CUST_ACCOUNTS hca JOIN HZ_PARTIES hp ON hp.PARTY_ID = hca.PARTY_ID" +
            " LEFT JOIN HZ_CUST_ACCT_SITES_ALL cas ON cas.CUST_ACCOUNT_ID = hca.CUST_ACCOUNT_ID AND cas.STATUS = 'A' LEFT JOIN HZ_PARTY_SITES hps ON hps.PARTY_SITE_ID = cas.PARTY_SITE_ID" +
            " LEFT JOIN HZ_LOCATIONS hl ON hl.LOCATION_ID = hps.LOCATION_ID WHERE " + w + " ORDER BY hca.ACCOUNT_NAME) WHERE ROWNUM <= 300";
        return FX.sql(sql, 300).then(function (rows) {
            var seen = {}, l = rows.map(FOM.mapBipCust).filter(function (c) { var k = c.accountNumber + '|' + c.billToSiteUseId; if (seen[k]) return false; seen[k] = 1; return true; });
            l.source = 'Fusion SQL (report failed: ' + FOM.emsg(e).slice(0, 120) + ')'; return l;
        }).catch(function (e2) { throw FOM.emsg(e) + '\nFusion SQL fallback: ' + FOM.emsg(e2); });
    });
};
/** convertBipCustomerToFill (§12.3) */
FOM.custFill = function (c) {
    var j = function (a) { return a.filter(Boolean).join(', '); };
    return { customerName: c.accountName || '', accountNumber: c.accountNumber || '', billToSite: c.billToSiteUseId || '', shipToSite: c.shipToPartySiteId || '', billToAddress: j([c.address1, c.address2, c.city]), shipToAddress: j([c.address1, c.address2, c.city, c.country]), custAccountId: c.custAccountId || '', partyId: c.partyId || '', creditLimit: c.prCreditLimit || c.creditLimit || null };
};
/** Find Customer dialog (§11) → Promise<customer|null> */
FOM.findCustomer = function (buId, buName, start) {
    return new Promise(function (res) {
        var picked = null, list = [];
        if (!buId) { FX.toast('Select a business unit first to search customers', 'err'); res(null); return; }
        FOM.dlg({
            title: '<i class="fa-solid fa-user-magnifying-glass"></i> Find Customer (' + esc(buName || buId) + ')', wide: true,
            body: '<div class="row-btns"><div class="seg" data-ct><button class="on" data-t="name">Search by Name</button><button data-t="account">Search by Account Number</button></div><input class="fom-in" data-cq placeholder="Customer name, account number…" style="flex:1" value="' + esc(start || '') + '"><button class="btn primary" data-cs><i class="fa-solid fa-magnifying-glass"></i> Search</button></div>' +
                '<div class="row-btns"><input class="fom-in" data-cf placeholder="Filter results…" style="max-width:260px"><span class="muted" data-cn style="font-size:.76rem"></span><span class="grow"></span><span class="muted" data-src style="font-size:.72rem"></span></div><div data-cl class="fom-cards"><div class="empty"><i class="fa-solid fa-users"></i>Search by customer name or account number.</div></div>',
            onClose: function () { res(picked); },
            onOpen: function (d) {
                var type = 'name';
                d.q('[data-ct]').onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; type = b.getAttribute('data-t'); d.qa('[data-ct] button').forEach(function (x) { x.classList.toggle('on', x === b); }); };
                function draw() {
                    var f = d.q('[data-cf]').value.toLowerCase();
                    var v = list.filter(function (c) { return !f || [c.accountName, c.accountNumber, c.partyNumber, c.buName].join(' ').toLowerCase().indexOf(f) >= 0; });
                    d.q('[data-cn]').textContent = list.length ? 'Showing ' + v.length + ' of ' + list.length + ' customers' : '';
                    d.q('[data-cl]').innerHTML = v.length ? v.map(function (c) {
                        return '<div class="fom-card" data-pick="' + list.indexOf(c) + '"><div class="row-btns"><b>' + esc(c.accountName || '') + '</b><span class="grow"></span>' + (c.status === 'A' ? '<span class="chip ok">Active</span>' : '<span class="chip err">Inactive</span>') + '</div>' +
                            '<div class="muted" style="font-size:.76rem">Acct <b class="mono">' + esc(c.accountNumber || '') + '</b> · Party ' + esc(c.partyNumber || '') + ' · ' + esc([c.city, c.country].filter(Boolean).join(', ')) + '</div>' +
                            '<div class="row-btns" style="font-size:.76rem"><span>Credit limit <b>' + FOM.amt(c.prCreditLimit != null ? c.prCreditLimit : c.creditLimit) + '</b></span>' + (c.buName ? '<span class="muted">BU: ' + esc(c.buName) + '</span>' : '') + '<span class="grow"></span><button class="btn sm primary" data-pick="' + list.indexOf(c) + '">Select</button></div></div>';
                    }).join('') : '<div class="empty"><i class="fa-solid fa-user-slash"></i>No customers found</div>';
                }
                function go() {
                    var t = d.q('[data-cq]').value.trim(); if (!t) { FX.toast('Please enter a customer name, account number, or party number to search', 'err'); return; }
                    d.q('[data-cl]').innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Searching…</div>';
                    FOM.searchCustomers(buId, t, type).then(function (l) { list = l; d.q('[data-src]').textContent = 'Source: ' + (l.source || ''); draw(); }).catch(function (e) { list = []; d.q('[data-cl]').innerHTML = '<div class="note err" style="white-space:pre-wrap">' + esc(FOM.emsg(e)) + '</div>'; });
                }
                d.q('[data-cs]').onclick = go; d.q('[data-cq]').onkeydown = function (e) { if (e.key === 'Enter') go(); };
                d.q('[data-cf]').oninput = draw;
                d.q('[data-cl]').onclick = function (e) { var p = e.target.closest('[data-pick]'); if (p) { picked = list[+p.getAttribute('data-pick')]; d.close(); } };
                if (start) go();
            }
        });
    });
};

// ── items / costs / on-hand (3.3.4) ────────────────────────────
FOM.costOf = function (r) { return FOM.num(FOM.pf(r, ['TotalUnitCost', 'UnitCost', 'ItemCost', 'UnitAverageCost', 'AverageUnitCost'])); };
FOM.parseVU = function (vu) { var p = String(vu || '').split(/(?<!\\)-/); return { costOrg: p[0] || '', invOrg: p[1] || '', subinv: p[2] || '', lot: p.slice(3).join('-').replace(/\\-/g, '-') }; };
FOM.uomOf = function (r) { return FOM.pf(r, ['PrimaryUOMValue', 'PrimaryUOMCode', 'PrimaryUnitOfMeasure', 'UOMCode', 'UOM']); };
FOM.searchItems = function (t, org) {
    var q = String(t).replace(/'/g, "''"), o = org ? ';OrganizationCode=' + org : '';
    return Promise.all([
        FX.get('itemsV2', { q: "ItemNumber LIKE '" + q + "%'" + o, limit: 25 }).catch(function () { return { items: [] }; }),
        FX.get('itemsV2', { q: "ItemDescription LIKE '%" + q + "%'" + o, limit: 25 }).catch(function () { return { items: [] }; })
    ]).then(function (rs) {
        var seen = {}, out = [];
        rs.forEach(function (j) { (j.items || []).forEach(function (it) { if (!it.ItemNumber || seen[it.ItemNumber]) return; seen[it.ItemNumber] = 1; out.push(it); }); });
        return out.slice(0, 40);
    });
};
FOM.itemCosts = function (item, org, offset, limit) {
    return FX.get('itemCosts', { version: 'latest', q: 'ItemNumber=' + FOM.qv(item), limit: limit || 25, offset: offset || 0 }).then(function (j) {
        var rows = (j.items || []).map(function (r) { var vu = FOM.parseVU(r.ValuationUnit); return Object.assign({ _vu: vu, _cost: FOM.costOf(r) }, r); });
        var keep = org ? rows.filter(function (r) { return r._vu.invOrg === org || r._vu.costOrg === org || r.InventoryOrganizationCode === org; }) : rows;
        return { rows: keep, all: rows, hasMore: !!j.hasMore };
    });
};
FOM.onhandQ = function (org, item, sub) { return 'OrganizationCode=' + org + ';ItemNumber=' + FOM.qv(item) + (sub ? ';SubinventoryCode=' + FOM.qv(sub) : ''); };
FOM.qv = function (v) { v = String(v); return /[\s;,'"=<>]/.test(v) ? '"' + v.replace(/"/g, '\\"') + '"' : v; };
FOM.ohQty = function (r) { return FOM.n(FOM.pf(r, ['PrimaryQuantity', 'QuantityOnhand', 'OnhandQuantity', 'Quantity'])); };
/** fetchOnhand: lots + qty for the given lot (or all). */
FOM.fetchOnhand = function (item, org, sub, lot) {
    if (!org) return Promise.reject('Pick a warehouse first');
    return FX.get('inventoryOnhandBalances', { q: FOM.onhandQ(org, item, sub), limit: 25, onlyData: false }).then(function (j) {
        var bal = j.items || [];
        return FOM.mapLimit(bal, 4, function (b) {
            if (b.LotNumber) return [b];
            var l = (b.links || []).filter(function (x) { return /lot/i.test(x.name || '') || /\/lots?\b/i.test(x.href || ''); })[0];
            return l ? FOM.all(l.href, { limit: 500 }, 2000).catch(function () { return [b]; }) : [b];
        }).then(function (chunks) {
            var rows = [].concat.apply([], chunks.map(function (c) { return Array.isArray(c) ? c : []; }));
            var lots = FOM.distinct(rows.map(function (r) { return r.LotNumber; }));
            var src = lot ? rows.filter(function (r) { return r.LotNumber === lot; }) : (rows.some(function (r) { return r.LotNumber; }) ? rows.filter(function (r) { return r.LotNumber; }) : bal);
            return { qty: FOM.sum(src, FOM.ohQty), lots: lots, rows: rows };
        });
    });
};
/** fetchReserveOptions: lot/subinventory options with qty + item / org ids. */
FOM.reserveOptions = function (item, org, sub) {
    return FOM.all('inventoryOnhandBalances', { q: FOM.onhandQ(org, item, sub), expand: 'lots', limit: 500 }, 3000).then(function (bal) {
        var itemId = null, orgId = null, g = {};
        bal.forEach(function (b) {
            itemId = itemId || b.InventoryItemId; orgId = orgId || b.OrganizationId;
            var lots = b.lots && b.lots.length ? b.lots : [b];
            lots.forEach(function (l) { var k = (l.LotNumber || '') + '|' + (b.SubinventoryCode || l.SubinventoryCode || ''); if (!g[k]) g[k] = { lot: l.LotNumber || '', subinventory: b.SubinventoryCode || l.SubinventoryCode || '', qty: 0 }; g[k].qty += FOM.n(FOM.pf(l, ['OnhandQuantity', 'PrimaryQuantity', 'QuantityOnhand', 'Quantity', 'LotQuantity'])); });
        });
        var opts = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.qty - a.qty; });
        var p = itemId ? Promise.resolve() : FX.get('itemsV2', { q: 'ItemNumber=' + FOM.qv(item) + ';OrganizationCode=' + org, limit: 1 }).then(function (j) { var it = (j.items || [])[0] || {}; itemId = it.InventoryItemId || it.ItemId || null; orgId = orgId || it.OrganizationId || null; }).catch(function () { });
        return p.then(function () { return { itemId: itemId, orgId: orgId, options: opts, lotControlled: opts.some(function (o) { return o.lot; }) }; });
    });
};
/** On-hand with lots + serials (allocation, pick confirm) → {lots:[{lot, qty, serials[]}], serials:[]} */
FOM.lotSerials = function (org, item, sub) {
    return FOM.all('inventoryOnhandBalances', { q: FOM.onhandQ(org, item, sub), expand: 'lots.lotSerials,serials', limit: 500 }, 3000).then(function (bal) {
        var lots = {}, ser = [];
        bal.forEach(function (b) {
            (b.lots || []).forEach(function (l) {
                var k = l.LotNumber || l.Lot; if (!k) return;
                if (!lots[k]) lots[k] = { lot: k, qty: 0, serials: [] };
                lots[k].qty += FOM.n(FOM.pf(l, ['OnhandQuantity', 'PrimaryQuantity', 'Quantity', 'LotQuantity']));
                (l.lotSerials || []).forEach(function (s) { var sn = s.SerialNumber || s.FmSerialNumber; if (sn && lots[k].serials.indexOf(sn) < 0) lots[k].serials.push(sn); });
            });
            (b.serials || []).forEach(function (s) { var sn = s.SerialNumber || s.FmSerialNumber; if (sn && ser.indexOf(sn) < 0) ser.push(sn); });
        });
        return { lots: Object.keys(lots).sort().map(function (k) { return lots[k]; }), serials: ser };
    });
};

// ── order child data shared by several screens ─────────────────
/** Path key of an order (OrderKey e.g. OPS:300000010754319, else HeaderId). */
FOM.okey = function (o) { var k = o && typeof o === 'object' ? (o.OrderKey || o.HeaderId) : o; return encodeURIComponent(String(k == null ? '' : k)).replace(/%3A/gi, ':'); };
FOM.opath = function (o) { return 'salesOrdersForOrderHub/' + FOM.okey(o); };
FOM.orderBase = function (o) { return FOM.self(o) || FX.url('salesOrdersForOrderHub/' + FOM.okey(o), { onlyData: false }).replace(/\?.*$/, ''); };
FOM.orderLines = function (o, expand) {
    var href = FOM.link(o, 'lines') || 'salesOrdersForOrderHub/' + FOM.okey(o) + '/child/lines';
    return FOM.all(href, { expand: expand || null, onlyData: false, limit: 500 });
};
FOM.orderTotals = function (o) { return FOM.all(FOM.link(o, 'totals') || 'salesOrdersForOrderHub/' + FOM.okey(o) + '/child/totals', { limit: 500 }); };
FOM.totRank = function (c) { c = String(c || '').toUpperCase(); return /SUBTOTAL|LINE|ITEM/.test(c) ? 0 : /DISC/.test(c) ? 1 : /SHIP|FREIGHT|HANDLING/.test(c) ? 2 : /TAX/.test(c) ? 3 : /CHARGE|MISC/.test(c) ? 4 : 5; };
FOM.totalsHtml = function (rows, ccy) {
    if (!rows.length) return '<div class="empty" style="padding:16px"><i class="fa-solid fa-calculator"></i>No totals yet.</div>';
    var grand = rows.filter(function (r) { return FOM.yes(r.PrimaryFlag); })[0] || rows.filter(function (r) { var c = String(r.TotalCode || '').toUpperCase(); return /ORDER|GRAND|NET/.test(c) && !/TAX|SHIP|DISC|SUB|LINE|CHARGE|MARGIN/.test(c); })[0];
    var rest = rows.filter(function (r) { return r !== grand; }).sort(function (a, b) { return FOM.totRank(a.TotalCode) - FOM.totRank(b.TotalCode); });
    ccy = (rows[0] && rows[0].CurrencyCode) || ccy || '';
    var row = function (r) { return '<div class="fom-tot"><span>' + esc(FOM.pf(r, ['TotalName', 'TotalCode', 'TotalTypeCode']) || '') + (FOM.yes(r.EstimatedFlag) ? ' <span class="chip">est</span>' : '') + '</span><b>' + FOM.amt(FOM.pf(r, ['TotalAmount', 'Amount', 'Value'])) + '</b></div>'; };
    return '<div class="fom-tots">' + rest.map(row).join('') + (grand ? '<div class="fom-tot grand"><span>' + esc(grand.TotalName || grand.TotalCode || 'Total') + '</span><b>' + FOM.amt(grand.TotalAmount) + ' ' + esc(ccy) + '</b></div>' : '') + '<div class="muted" style="font-size:.7rem;margin-top:4px">Amounts in ' + esc(ccy) + '</div></div>';
};
FOM.totalsDlg = function (o) {
    var d = FOM.dlg({ title: '<i class="fa-solid fa-calculator"></i> Order totals — ' + esc(o.OrderNumber || o.SourceTransactionNumber || ''), body: '<div data-t><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>', buttons: [{ label: 'Reload', act: 'reload' }, { label: 'Close', act: 'close' }], onAction: function (a) { if (a === 'reload') { load(); return false; } } });
    function load() { d.q('[data-t]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Loading…'; FOM.orderTotals(o).then(function (r) { d.q('[data-t]').innerHTML = FOM.totalsHtml(r, o.TransactionalCurrencyCode || o.AppliedCurrencyCode); }).catch(function (e) { d.q('[data-t]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; }); }
    load();
};
/** fetchReservations (3.0.7): one call per item with DemandSourceName = order/source number, de-duplicated. */
FOM.fetchReservations = function (demand, items) {
    items = FOM.distinct(items || []);
    if (!demand || !items.length) return Promise.resolve([]);
    return FOM.mapLimit(items, 4, function (it) { return FOM.all('inventoryReservations', { q: 'ItemNumber=' + FOM.qv(it) + ';DemandSourceName=' + FOM.qv(demand), limit: 500 }, 2000); }).then(function (chunks) {
        var seen = {}, out = [];
        chunks.forEach(function (c) { (Array.isArray(c) ? c : []).forEach(function (r) { if (seen[r.ReservationId]) return; seen[r.ReservationId] = 1; out.push(r); }); });
        return out;
    });
};
FOM.RES_COLS = [{ f: 'ItemNumber', label: 'Item', mono: 1 }, { f: 'LotNumber', label: 'Lot' }, { f: 'SubinventoryCode', label: 'Subinv' }, { f: 'OrganizationCode', label: 'Org' }, { label: 'Qty', n: 1, html: function (r) { return FOM.qty(r.ReservationQuantity) + ' ' + esc(r.ReservationUOMCode || ''); } }, { f: 'DemandSourceType', label: 'Demand' }, { f: 'ReservationId', label: 'Reservation Id', mono: 1 }];
FOM.reservationsDlg = function (demand, items) {
    var d = FOM.dlg({ title: '<i class="fa-solid fa-lock"></i> Reservations — order ' + esc(demand), wide: true, body: '<div data-r><i class="fa-solid fa-circle-notch fa-spin"></i> Reading reservations for ' + items.length + ' item(s)…</div>', buttons: [{ label: 'Copy query', act: 'copy' }, { label: 'Close', act: 'close' }], onAction: function (a) { if (a === 'copy') { FOM.copy(FOM.u('inventoryReservations', { q: 'ItemNumber=' + FOM.qv(items[0] || '') + ';DemandSourceName=' + FOM.qv(demand), limit: 500 })); return false; } } });
    FOM.fetchReservations(demand, items).then(function (r) { d.q('[data-r]').innerHTML = FOM.table(r, FOM.RES_COLS, { empty: 'No reservations for this order.', icon: 'fa-lock-open' }); }).catch(function (e) { d.q('[data-r]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
};
