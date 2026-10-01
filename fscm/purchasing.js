/* Fusion Purchasing — shared helpers, Manage POs, PO detail, PO Life Cycle.
   Other views: po-create.js (Create / Edit PO), receiving.js (Expected Receipts, Create ASN, Supplier Returns),
   suppliers.js (Manage Suppliers, Supplier Balance), po-loading.js (PO Loading). Everything reads Fusion live through
   FX.rest (host relay: GET / POST / PATCH only — no DELETE). */

var PUR = { params: {}, lcFlags: {}, qsUsed: false };

// ── small helpers ──────────────────────────────────────────────
PUR.dq = function (v) { return '"' + String(v).trim().replace(/"/g, '\\"') + '"'; };
PUR.recall = function (k, d) { return lsGet('pur_' + k + '_' + FX.instance, d); };
PUR.remember = function (k, v) { lsSet('pur_' + k + '_' + FX.instance, v); };
/** Remember a <select>/<input> value under key whenever it changes. */
PUR.bindRemember = function (el, key) { el = typeof el === 'string' ? $(el) : el; if (el) el.addEventListener('change', function () { if (el.value) PUR.remember(key, el.value); }); };
/** Navigate to another view with parameters (deep link inside the page). */
PUR.go = function (view, params) { PUR.params[view] = params || {}; FX.show(view); };
/** Parameters for a view: from PUR.go, else (first view only) from ?po=…&orderNumber=…&supplier=… in the page URL. */
PUR.take = function (view) {
    var p = PUR.params[view]; delete PUR.params[view];
    if (!p && !PUR.qsUsed) {
        PUR.qsUsed = true;
        try { var u = new URLSearchParams(location.search); p = {}; ['po', 'orderNumber', 'supplier', 'edit'].forEach(function (k) { if (u.get(k)) p[k] = u.get(k); }); if (p.orderNumber && !p.po) p.po = p.orderNumber; } catch (e) { p = {}; }
    }
    PUR.qsUsed = true;
    return p || {};
};
PUR.n = function (v) { var n = +v; return isNaN(n) ? 0 : n; };
PUR.sum = function (rows, f) { return rows.reduce(function (s, r) { return s + PUR.n(typeof f === 'function' ? f(r) : r[f]); }, 0); };
PUR.distinct = function (rows, f) { var m = {}; rows.forEach(function (r) { var v = typeof f === 'function' ? f(r) : r[f]; if (v != null && v !== '') m[v] = 1; }); return Object.keys(m); };
PUR.first = function (o) { for (var i = 1; i < arguments.length; i++) { var v = o && o[arguments[i]]; if (v != null && v !== '') return v; } return null; };
PUR.money = function (v, ccy) { return v == null || v === '' ? '—' : FX.fmt.money(v) + (ccy ? ' <span class="muted" style="font-size:.7em">' + esc(ccy) + '</span>' : ''); };
PUR.compact = function (v) { v = PUR.n(v); var a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : FX.fmt.num(v, 2); };
PUR.stamp = function () { var d = new Date(), p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };
PUR.download = function (name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
PUR.label = function (k) { return String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' '); };
PUR.spin = '<i class="fa-solid fa-circle-notch fa-spin muted"></i>';
/** Run fn over items with at most n in flight → Promise<results[]> (fn errors become {error}). */
PUR.pool = function (items, n, fn, onEach) {
    var out = new Array(items.length), i = 0, done = 0;
    return new Promise(function (resolve) {
        if (!items.length) { resolve(out); return; }
        function next() {
            if (i >= items.length) return;
            var k = i++;
            Promise.resolve().then(function () { return fn(items[k], k); }).then(function (r) { out[k] = r; }, function (e) { out[k] = { error: String(e) }; }).then(function () {
                done++; if (onEach) onEach(done, items.length);
                if (done === items.length) resolve(out); else next();
            });
        }
        for (var j = 0; j < Math.min(n, items.length); j++) next();
    });
};
/** KPI cards html: [{label, value, cls (good|bad|amber), sub}] */
PUR.kpis = function (list) { return '<div class="kpis">' + list.map(function (k) { return '<div class="kpi ' + (k.cls || '') + '"><b>' + k.value + '</b><span>' + esc(k.label) + '</span>' + (k.sub ? '<small>' + k.sub + '</small>' : '') + '</div>'; }).join('') + '</div>'; };
/** Horizontal bars: rows [{label, v, v2?}] → html. opts {fmt(v), legend:[a,b]} */
PUR.bars = function (rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="muted" style="font-size:.78rem">No data.</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(PUR.n(r.v), PUR.n(r.v2)); })) || 1, f = opts.fmt || function (v) { return FX.fmt.num(v, 2); };
    var two = rows.some(function (r) { return r.v2 != null; });
    return (two && opts.legend ? '<div class="pu-legend"><span><b style="background:#2a78d6"></b>' + esc(opts.legend[0]) + '</span><span><b style="background:#15803d"></b>' + esc(opts.legend[1]) + '</span></div>' : '') +
        '<div class="pu-bars">' + rows.map(function (r) {
            return '<div class="pu-bar" title="' + esc(r.title || r.label) + '"><span class="l">' + esc(r.label) + '</span><span class="t' + (two ? ' two' : '') + '"><i class="a" style="width:' + (PUR.n(r.v) / max * 100).toFixed(1) + '%"></i>' +
                (two ? '<i class="b" style="width:' + (PUR.n(r.v2) / max * 100).toFixed(1) + '%"></i>' : '') + '</span><span class="v">' + f(r.v) + (two ? ' / ' + f(r.v2) : '') + '</span></div>';
        }).join('') + '</div>';
};
/** Group rows → [{label, v}] summed by key, sorted desc, top n. */
PUR.groupSum = function (rows, key, val, n) {
    var m = {};
    rows.forEach(function (r) { var k = typeof key === 'function' ? key(r) : r[key]; k = k == null || k === '' ? '—' : String(k); m[k] = (m[k] || 0) + (val ? PUR.n(typeof val === 'function' ? val(r) : r[val]) : 1); });
    var out = Object.keys(m).map(function (k) { return { label: k, v: m[k] }; }).sort(function (a, b) { return b.v - a.v; });
    return n ? out.slice(0, n) : out;
};
/** Modal with every non-empty attribute of a record. */
PUR.allFields = function (title, o) {
    var keys = Object.keys(o || {}).filter(function (k) { return k !== 'links' && k.charAt(0) !== '_' && o[k] != null && o[k] !== ''; });
    FX.modal({
        title: title, wide: true, body: keys.length ? '<div class="facts">' + keys.map(function (k) {
            var v = o[k];
            v = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'object' ? '<span class="mono">' + esc(JSON.stringify(v)) + '</span>' : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? esc(FX.fmt.dt(v)) : esc(v);
            return '<div><span>' + esc(PUR.label(k)) + '</span>' + v + '</div>';
        }).join('') + '</div>' : '<div class="empty">No values.</div>'
    });
};
/** Print an HTML document through a hidden frame (works inside WebView2, no popup). */
PUR.print = function (title, body) {
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    var d = f.contentWindow.document;
    d.open(); d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>body{font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#111;margin:18px}h1{font-size:18px;margin:0 0 4px}h3{font-size:12px;margin:14px 0 4px;text-transform:uppercase;color:#555}table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f1f5f9}.n{text-align:right}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px}.grid span{display:block;color:#666;font-size:9px;text-transform:uppercase}.tot td{font-weight:700}.foot{margin-top:18px;color:#888;font-size:9px}@page{size:A4 landscape;margin:12mm}</style></head><body>' + body + '<div class="foot">Printed ' + new Date().toLocaleString() + ' · Gray\'s WMS · Fusion ' + FX.instance + '</div></body></html>');
    d.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { FX.toast('Printing is not available here.', 'err'); } setTimeout(function () { f.remove(); }, 60000); }, 250);
};
PUR.dueChip = function (d) {
    if (!d) return '<span class="muted">—</span>';
    var days = Math.floor((new Date(FX.fmt.date(d) + 'T00:00:00') - new Date(FX.today() + 'T00:00:00')) / 864e5);
    return '<span class="chip ' + (days < 0 ? 'err' : days <= 7 ? 'warn' : 'ok') + '" title="' + (days < 0 ? -days + ' days overdue' : 'in ' + days + ' days') + '">' + esc(FX.fmt.date(d)) + '</span>';
};

// ── LOVs used by this module ───────────────────────────────────
/** Procurement BUs from payablesOptions (id + payment/ledger currency); falls back to finBusinessUnitsLOV. v = BU id. */
FX.LOVS.payBUs = function () {
    return FX.restAll('payablesOptions', { fields: 'businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency' }, 1000).then(function (r) {
        var seen = {}, out = [];
        r.forEach(function (o) { if (!o.businessUnitName || seen[o.businessUnitName]) return; seen[o.businessUnitName] = 1; out.push({ v: String(o.businessUnitId), t: o.businessUnitName, id: o.businessUnitId, name: o.businessUnitName, ccy: o.ledgerCurrency || o.paymentCurrency, o: o }); });
        if (!out.length) throw 'payablesOptions returned no business units';
        return out.sort(function (a, b) { return a.t.localeCompare(b.t); });
    }).catch(function () {
        return FX.lov('bus').then(function (r) { return r.map(function (b) { return { v: String(b.id), t: b.t, id: b.id, name: b.v, ccy: null, o: b.o }; }); });
    });
};
PUR.buById = function (id) { return FX.lov('payBUs').then(function (l) { return l.filter(function (b) { return b.v === String(id); })[0] || null; }); };

// ── receiving requests (shared by Receive, ASN, Returns) ───────
/** POST receivingReceiptRequests → {ok, http, headerId, pStatus, retStatus, retMsg, json, text, msg}. Success rule: HTTP 2xx AND
    (no ProcessingStatusCode or SUCCESS/PENDING) AND ReturnStatus ≠ ERROR. */
PUR.receive = function (body) {
    return FX.restRaw('POST', 'receivingReceiptRequests', { onlyData: false }, body).then(function (r) {
        var j = r.json || {}, ps = PUR.first(j, 'ProcessingStatusCode', 'processingStatusCode'), rs = PUR.first(j, 'ReturnStatus', 'returnStatus'), rm = PUR.first(j, 'ReturnMessage', 'returnMessage');
        var hdr = PUR.first(j, 'HeaderInterfaceId', 'headerInterfaceId');
        var ok = r.ok && (!ps || /^(SUCCESS|PENDING)$/i.test(ps)) && String(rs || '').toUpperCase() !== 'ERROR';
        var det = (j['o:errorDetails'] || [])[0];
        var msg = ok ? (ps || 'sent') + (hdr ? ' · Hdr ' + hdr : '') : (rm || (rs ? 'ReturnStatus: ' + rs : '') || (det && det.detail) || j.detail || j.title || r.error || ('HTTP ' + r.status));
        return { ok: ok, http: r.status, headerId: hdr, pStatus: ps, retStatus: rs, retMsg: rm, json: j, text: r.text, msg: msg };
    }, function (e) { return { ok: false, http: 0, msg: String(e), text: String(e) }; });
};
/** Poll a receiving request until it leaves PENDING (tries × ms). */
PUR.pollReceipt = function (hdr, tries, ms, onTick) {
    var n = 0;
    function step() {
        n++;
        return new Promise(function (r) { setTimeout(r, ms || 2000); }).then(function () { return FX.get('receivingReceiptRequests/' + hdr); }).then(function (j) {
            var ps = String(PUR.first(j, 'ProcessingStatusCode', 'processingStatusCode') || 'PENDING').toUpperCase();
            if (onTick) onTick(n, ps);
            if (ps === 'PENDING' && n < (tries || 8)) return step();
            return { pStatus: ps, retMsg: PUR.first(j, 'ReturnMessage', 'returnMessage'), json: j };
        }).catch(function (e) { if (n < (tries || 8)) return step(); return { pStatus: 'PENDING', retMsg: String(e) }; });
    }
    return step();
};
/** Processing errors of every line of a receiving request. */
PUR.receiptErrors = function (hdr) {
    return FX.get('receivingReceiptRequests/' + hdr, { expand: 'lines' }).then(function (j) {
        var lines = (j.lines && (j.lines.items || j.lines)) || [];
        return Promise.all(lines.map(function (l) {
            var lnk = (l.links || []).filter(function (x) { return x.name === 'processingErrors'; })[0];
            var path = lnk ? lnk.href.replace(/^https?:\/\/[^/]+\/fscmRestApi\/resources\/[^/]+\//, '') : 'receivingReceiptRequests/' + hdr + '/child/lines/' + (l.InterfaceTransactionId || l.LineId) + '/child/processingErrors';
            return FX.restAll(path.split('?')[0], {}, 200).then(function (e) { return e.map(function (x) { return PUR.first(x, 'ErrorMessage', 'Message', 'ErrorMessageText', 'ErrorMessageName'); }).filter(Boolean); }).catch(function () { return []; });
        }));
    }).then(function (a) { return [].concat.apply([], a); }).catch(function (e) { return [String(e)]; });
};

// ── currency rates (Fusion currencyRates, fallback GL_DAILY_RATES) ─
/** Latest Corporate rate from→to on or before date → {rate, inverse, date, type} or null. */
PUR.fxRate = function (from, to, date) {
    if (!from || !to || from === to) return Promise.resolve({ rate: 1, inverse: 1, date: date || FX.today(), type: 'same' });
    date = date || FX.today();
    var start = new Date(date + 'T00:00:00'); start.setDate(start.getDate() - 60);
    var key = 'fx|' + FX.instance + '|' + from + '|' + to + '|' + date;
    if (FX.lovCache[key]) return FX.lovCache[key];
    var pick = function (rows) {
        rows = rows.filter(function (r) { return r.d && r.d <= date && r.rate > 0; }).sort(function (a, b) { return a.d < b.d ? 1 : -1; });
        return rows.length ? { rate: rows[0].rate, inverse: 1 / rows[0].rate, date: rows[0].d, type: rows[0].t || 'Corporate' } : null;
    };
    var p = FX.restAll('currencyRates', { finder: 'CurrencyRatesFinder;fromCurrency=' + from + ',toCurrency=' + to + ',userConversionType=Corporate,startDate=' + FX.today(start) + ',endDate=' + date }, 500)
        .then(function (r) { return pick(r.map(function (x) { return { d: FX.fmt.date(x.ConversionDate), rate: +x.ConversionRate, t: x.UserConversionType || x.ConversionType }; })); })
        .catch(function () { return null; })
        .then(function (res) {
            if (res) return res;
            return FX.sql("SELECT TO_CHAR(conversion_date,'YYYY-MM-DD') d, conversion_rate r, conversion_type t FROM gl_daily_rates WHERE from_currency = " + FX.qv(from) + " AND to_currency = " + FX.qv(to) +
                " AND UPPER(conversion_type) = 'CORPORATE' AND conversion_date <= TO_DATE(" + FX.qv(date) + ",'YYYY-MM-DD') AND conversion_date >= TO_DATE(" + FX.qv(date) + ",'YYYY-MM-DD') - 366 ORDER BY conversion_date DESC", 5)
                .then(function (rows) { return pick(rows.map(function (x) { return { d: x.D, rate: +x.R, t: x.T }; })); }).catch(function () { return null; });
        });
    FX.lovCache[key] = p;
    return p;
};

// ── PO actions (custom actions; DELETE is not available through the relay) ─
PUR.ACTIONS = [
    { res: 'draftPurchaseOrders', name: 'submit', label: 'Submit for approval', icon: 'fa-paper-plane', draft: true },
    { res: 'purchaseOrders', name: 'cancelDocument', label: 'Cancel document', icon: 'fa-ban', danger: true },
    { res: 'purchaseOrders', name: 'holdDocument', label: 'Hold', icon: 'fa-hand' },
    { res: 'purchaseOrders', name: 'releaseHoldDocument', label: 'Release hold', icon: 'fa-hand-holding' },
    { res: 'purchaseOrders', name: 'acknowledgeDocument', label: 'Acknowledge', icon: 'fa-handshake' },
    { res: 'purchaseOrders', name: 'closeDocument', label: 'Close', icon: 'fa-lock' },
    { res: 'purchaseOrders', name: 'closeForInvoicing', label: 'Close for invoicing', icon: 'fa-file-invoice-dollar' },
    { res: 'purchaseOrders', name: 'closeForReceiving', label: 'Close for receiving', icon: 'fa-truck-ramp-box' },
    { res: 'purchaseOrders', name: 'finallyCloseDocument', label: 'Finally close', icon: 'fa-circle-stop', danger: true },
    { res: 'purchaseOrders', name: 'reopenDocument', label: 'Reopen', icon: 'fa-lock-open' }
];
PUR.NO_DELETE = 'Not available yet: deleting needs HTTP DELETE, which the app\'s Fusion relay does not allow (GET / POST / PATCH only). Delete it in Fusion, or cancel the document once it is approved.';
/** Run one custom action after a confirm showing the request. → Promise<newStatus|null> */
PUR.runAction = function (res, id, name, danger) {
    var path = res + '/' + id, body = { name: name, parameters: [] };
    return FX.confirm('Run "' + esc(name) + '"', '<div class="note">POST <span class="mono">' + esc(FX.url(path, { onlyData: false })) + '</span><br>Content-Type: application/vnd.oracle.adf.action+json</div><pre class="json">' + esc(JSON.stringify(body, null, 2)) + '</pre>', 'Run ' + name, danger ? 'danger' : 'primary').then(function (ok) {
        if (!ok) return null;
        FX.busy('Running ' + name + '…');
        return FX.action(path, name).then(function (r) {
            FX.busy(false);
            var st = r && (typeof r.result === 'string' ? r.result : PUR.first(r, 'Status', 'DocumentStatus'));
            FX.toast(name + ' done' + (st ? ' → ' + st : '') + '.', 'ok');
            return st || '';
        }, function (e) { FX.busy(false); FX.modal({ title: name + ' failed', body: '<div class="note err" style="white-space:pre-wrap">' + esc(e) + '</div>' }); return null; });
    });
};
/** Actions menu for one PO. po = {POHeaderId, OrderNumber, StatusCode}. onDone(status) after a successful action. */
PUR.poActions = function (po, onDone) {
    var id = po.POHeaderId, inc = /INCOMPLETE|DRAFT/i.test(po.StatusCode || po.status || '');
    var body = '<div class="note">PO <b>' + esc(po.OrderNumber || id) + '</b> · status ' + FX.chip(po.StatusCode || po.status || '?') + ' — <i>submit</i> lives on draftPurchaseOrders; cancel / close / hold … live on purchaseOrders. Use <b>Discover</b> to list the action names your pod really offers.</div>' +
        '<div class="pu-menu">' + PUR.ACTIONS.map(function (a, i) {
            return '<button data-pa="' + i + '" class="' + (a.danger ? 'danger' : '') + '"' + (a.draft && !inc ? ' disabled title="Only for incomplete (draft) orders"' : '') + '><i class="fa-solid ' + a.icon + '"></i><span>' + esc(a.label) + '<small>' + a.res + ' · ' + a.name + '</small></span></button>';
        }).join('') +
        '<button disabled title="' + esc(PUR.NO_DELETE) + '" class="danger"><i class="fa-solid fa-trash"></i><span>Delete purchase order<small>needs DELETE — not available</small></span></button></div>' +
        '<h4 style="margin-top:6px">Custom / discovered action</h4><div class="pu-inline"><select id="pa-res"><option>purchaseOrders</option><option>draftPurchaseOrders</option></select><input id="pa-name" placeholder="action name" style="min-width:200px"><button class="btn sm" data-pa="custom"><i class="fa-solid fa-play"></i> Run</button><button class="btn sm" data-pa="disc"><i class="fa-solid fa-magnifying-glass"></i> Discover</button></div><div id="pa-disc"></div>';
    FX.modal({
        title: '<i class="fa-solid fa-bolt" style="color:var(--accent)"></i> Purchase order actions', wide: true, body: body, onOpen: function (box) {
            box.addEventListener('click', function (e) {
                var b = e.target.closest('[data-pa]'); if (!b || b.disabled) return;
                var k = b.getAttribute('data-pa');
                if (k === 'disc') { PUR.discover($('pa-res').value, $('pa-disc'), function (n) { $('pa-name').value = n; }); return; }
                var a = k === 'custom' ? { res: $('pa-res').value, name: $('pa-name').value.trim() } : PUR.ACTIONS[+k];
                if (!a.name) { FX.toast('Enter an action name.', 'err'); return; }
                FX.closeModal();
                PUR.runAction(a.res, id, a.name, a.danger).then(function (st) { if (st != null && onDone) onDone(st || (a.name === 'submit' ? 'Pending approval' : null)); });
            });
        }
    });
};
/** List the custom actions of a resource (GET {res}/describe) into el; onPick(name). */
PUR.discover = function (res, el, onPick) {
    el.innerHTML = '<div class="muted">' + PUR.spin + ' Reading ' + esc(res) + '/describe…</div>';
    FX.get(res + '/describe', { onlyData: false }).then(function (j) {
        var a = (j.Resources && j.Resources[res] && j.Resources[res].actions) || j.actions || [];
        if (!Array.isArray(a)) a = Object.keys(a).map(function (k) { return Object.assign({ name: k }, a[k]); });
        el.innerHTML = a.length ? FX.table(a, [{ label: 'Action', html: function (x) { return '<button class="link" data-pick="' + esc(x.name) + '">' + esc(x.name) + '</button>'; } }, { label: 'Method', f: 'method' }, { label: 'Parameters', get: function (x) { return (x.parameters || []).map(function (p) { return p.name; }).join(', '); } }, { label: 'Description', f: 'description' }]) : '<div class="muted">No actions listed.</div>';
        el.onclick = function (e) { var p = e.target.closest('[data-pick]'); if (p) onPick(p.getAttribute('data-pick')); };
    }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
};

// ── PO Life Cycle ──────────────────────────────────────────────
PUR.lcLoad = function (id) {
    function one(child) {
        return FX.restAll('purchaseOrderLifeCycleDetails/' + id + '/child/' + child, {}, 5000)
            .catch(function (e) { return FX.restAll('purchaseOrderLifecycleDetails/' + id + '/child/' + child, {}, 5000).catch(function () { throw e; }); });
    }
    var errs = [];
    return Promise.all([one('receipts').catch(function (e) { errs.push('Receipts: ' + e); return []; }), one('invoices').catch(function (e) { errs.push('Invoices: ' + e); return []; })]).then(function (a) {
        var paid = function (i) { var s = String(PUR.first(i, 'InvoiceStatus', 'InvoiceStatusCode') || '').toUpperCase(); return s.indexOf('PAID') >= 0 && s.indexOf('UNPAID') < 0 && s.indexOf('PARTIAL') < 0; };
        var d = { receipts: a[0], invoices: a[1], errors: errs, paid: paid };
        if (!errs.length) PUR.lcFlags[id] = { receipts: a[0].length > 0, invoices: a[1].length > 0, payment: a[1].some(paid) };
        if (PUR.poGrid && document.body.contains(PUR.poGrid.el)) PUR.poGrid.render();
        return d;
    });
};
PUR.lcRender = function (el, po, d) {
    var ccy = po.CurrencyCode || (d.receipts[0] || {}).CurrencyCode || (d.invoices[0] || {}).CurrencyCode || '';
    var R = d.receipts, I = d.invoices, ret = R.filter(function (r) { return PUR.n(r.ReturnedQuantity) > 0; });
    var rq = PUR.sum(R, 'ReceivedQuantity'), retq = PUR.sum(R, 'ReturnedQuantity'), ma = PUR.sum(I, 'MatchedAmount'), oti = PUR.sum(R, 'OpenToInvoiceAmount');
    var nRec = PUR.distinct(R, function (r) { return r.ReceiptId || r.Receipt; }).length, nInv = PUR.distinct(I, function (r) { return r.InvoiceId || r.Invoice; }).length;
    var paidN = I.filter(d.paid).length;
    var node = function (st, icon, t, sub) { return '<div class="node ' + st + '"><i class="dot fa-solid ' + icon + '"></i><b>' + t + '</b><span>' + sub + '</span></div>'; };
    var recSt = nRec ? (PUR.n(oti) > 0 || retq > 0 ? 'part' : 'ok') : '', invSt = nInv ? (oti > 0 ? 'part' : 'ok') : '', paySt = paidN ? (paidN < I.length ? 'part' : 'ok') : '';
    var lineKey = function (r) { return String(PUR.first(r, 'LineNumber') || '?'); };
    var byLine = {};
    R.forEach(function (r) { var k = lineKey(r); byLine[k] = byLine[k] || { label: 'Line ' + k, title: PUR.first(r, 'ItemOrScheduleDescription', 'LineDescription') || '', v: 0, v2: 0 }; byLine[k].v += PUR.n(r.ReceivedQuantity); });
    I.forEach(function (r) { var k = lineKey(r); byLine[k] = byLine[k] || { label: 'Line ' + k, title: PUR.first(r, 'ItemOrScheduleDescription', 'LineDescription') || '', v: 0, v2: 0 }; byLine[k].v2 += PUR.n(r.MatchedQuantity); });
    var lines = Object.keys(byLine).map(function (k) { return byLine[k]; }).sort(function (a, b) { return (b.v + b.v2) - (a.v + a.v2); }).slice(0, 12);
    var invStatus = function (r) { return PUR.first(r, 'InvoiceStatus', 'InvoiceStatusCode') || 'Unknown'; };
    var rcvCols = [
        { label: 'Receipt', get: function (r) { return PUR.first(r, 'Receipt', 'ReceiptId'); }, fmt: 'mono' }, { label: 'Date', f: 'ReceiptDate', fmt: 'date' },
        { label: 'Line', get: function (r) { return PUR.first(r, 'LineNumberScheduleNumber', 'LineNumber'); } }, { label: 'Description', get: function (r) { return PUR.first(r, 'ItemOrScheduleDescription', 'LineDescription'); } },
        { label: 'UOM', f: 'UOM' }, { label: 'Received', f: 'ReceivedQuantity', n: 1, fmt: 'num' }, { label: 'Delivered', f: 'DeliveredQuantity', n: 1, fmt: 'num' },
        { label: 'Returned', n: 1, html: function (r) { var v = PUR.n(r.ReturnedQuantity); return v > 0 ? '<b style="color:var(--err)">' + FX.fmt.num(v) + '</b>' : FX.fmt.num(v); } },
        { label: 'Open to invoice', n: 1, html: function (r) { return PUR.money(r.OpenToInvoiceAmount, ccy); } }, { label: 'Shipment', f: 'ShipmentNumber' }, { label: 'Received by', f: 'ReceivedBy' }];
    var invCols = [
        { label: 'Invoice', get: function (r) { return PUR.first(r, 'Invoice', 'InvoiceId'); }, fmt: 'mono' }, { label: 'Date', f: 'InvoicedDate', fmt: 'date' },
        { label: 'Status', html: function (r) { var s = invStatus(r), u = s.toUpperCase(); return '<span class="chip ' + (/HOLD/.test(u) ? 'err' : /UNPAID|PARTIAL/.test(u) ? 'warn' : /PAID/.test(u) ? 'ok' : 'info') + '">' + esc(s) + '</span>'; } },
        { label: 'Type', f: 'InvoiceType' }, { label: 'Line', get: function (r) { return PUR.first(r, 'LineNumberScheduleNumber', 'LineNumber'); } }, { label: 'Description', get: function (r) { return PUR.first(r, 'ItemOrScheduleDescription', 'LineDescription'); } },
        { label: 'Matched qty', f: 'MatchedQuantity', n: 1, fmt: 'num' }, { label: 'Matched amount', n: 1, html: function (r) { return PUR.money(r.MatchedAmount, ccy); } }, { label: 'Hold reason', f: 'HoldReasonCode' }, { label: 'Receipt', f: 'Receipt' }];
    var dates = function (rows, df, vf) { var m = {}; rows.forEach(function (r) { var k = FX.fmt.date(r[df]) || '—'; m[k] = (m[k] || 0) + PUR.n(r[vf]); }); return Object.keys(m).sort().slice(-15).map(function (k) { return { label: k, v: m[k] }; }); };
    var tabs = {
        overview: function () {
            return '<div class="pu-cols"><div class="pu-sec"><h4><i class="fa-solid fa-chart-bar"></i> Received vs invoiced quantity by line</h4>' + PUR.bars(lines, { legend: ['Received', 'Invoiced'] }) + '</div>' +
                '<div class="pu-sec"><h4><i class="fa-solid fa-chart-pie"></i> Invoice amount by status</h4>' + PUR.bars(PUR.groupSum(I, invStatus, 'MatchedAmount'), { fmt: function (v) { return FX.fmt.money(v); } }) + '</div></div>' +
                '<div class="muted" style="font-size:.74rem">Delivered ' + FX.fmt.num(PUR.sum(R, 'DeliveredQuantity')) + ' · Matched quantity ' + FX.fmt.num(PUR.sum(I, 'MatchedQuantity')) + '</div>';
        },
        receipts: function () {
            return '<div class="pu-cols"><div class="pu-sec"><h4>Received quantity over time</h4>' + PUR.bars(dates(R, 'ReceiptDate', 'ReceivedQuantity')) + '</div><div class="pu-sec"><h4>Received quantity by line</h4>' +
                PUR.bars(PUR.groupSum(R, function (r) { return 'Line ' + PUR.first(r, 'LineNumberScheduleNumber', 'LineNumber'); }, 'ReceivedQuantity', 12)) + '</div></div>' + (R.length ? FX.table(R, rcvCols) : '<div class="empty"><i class="fa-solid fa-inbox"></i>No receipts yet.</div>');
        },
        invoices: function () {
            return '<div class="pu-cols"><div class="pu-sec"><h4>Matched amount over time</h4>' + PUR.bars(dates(I, 'InvoicedDate', 'MatchedAmount'), { fmt: function (v) { return FX.fmt.money(v); } }) + '</div><div class="pu-sec"><h4>Invoices by status</h4>' +
                PUR.bars(PUR.groupSum(I, invStatus)) + '</div></div>' + (I.length ? FX.table(I, invCols) : '<div class="empty"><i class="fa-solid fa-inbox"></i>No invoices matched yet.</div>');
        },
        returns: function () { return '<div class="row-btns"><span class="chip warn">' + ret.length + ' return lines</span><span class="chip err">Returned qty ' + FX.fmt.num(retq) + '</span></div>' + (ret.length ? FX.table(ret, rcvCols) : '<div class="empty"><i class="fa-solid fa-inbox"></i>Nothing returned.</div>'); }
    };
    var cur = 'overview';
    el.innerHTML = (d.errors.length ? '<div class="note err">' + esc(d.errors.join(' | ')) + '</div>' : '') +
        '<div class="card pad"><div class="pu-lc">' + node('ok', 'fa-file-invoice', 'Ordered', esc(po.OrderNumber || '')) + '<span class="ln ' + (recSt ? 'ok' : '') + '"></span>' +
        node(recSt, 'fa-truck-ramp-box', 'Received', nRec + ' receipt' + (nRec === 1 ? '' : 's')) + '<span class="ln ' + (invSt ? 'ok' : '') + '"></span>' +
        node(invSt, 'fa-file-invoice-dollar', 'Invoiced', nInv + ' invoice' + (nInv === 1 ? '' : 's')) + '<span class="ln ' + (paySt ? 'ok' : '') + '"></span>' +
        node(paySt, 'fa-money-check-dollar', 'Paid', paidN ? paidN + ' paid line' + (paidN === 1 ? '' : 's') : 'not yet') + '</div></div>' +
        PUR.kpis([{ label: 'Receipts', value: nRec }, { label: 'Received qty', value: FX.fmt.num(rq) }, { label: 'Returned qty', value: FX.fmt.num(retq), cls: retq > 0 ? 'bad' : '' },
        { label: 'Invoices', value: nInv }, { label: 'Matched amount', value: PUR.money(ma, ccy) }, { label: 'Open to invoice', value: PUR.money(oti, ccy), cls: oti > 0 ? 'amber' : '' }]) +
        '<div class="card"><div class="pu-tabs" data-lc="tabs">' + [['overview', 'Overview', ''], ['receipts', 'Receipts', R.length], ['invoices', 'Invoices', I.length], ['returns', 'Returns', ret.length]].map(function (t) {
            return '<button data-lt="' + t[0] + '" class="' + (t[0] === cur ? 'on' : '') + '">' + t[1] + (t[2] !== '' ? ' <span class="cnt">' + t[2] + '</span>' : '') + '</button>';
        }).join('') + '</div><div class="pu-body" data-lc="body"></div></div>';
    var body = el.querySelector('[data-lc="body"]');
    body.innerHTML = tabs[cur]();
    el.querySelector('[data-lc="tabs"]').onclick = function (e) {
        var b = e.target.closest('[data-lt]'); if (!b) return; cur = b.getAttribute('data-lt');
        Array.prototype.forEach.call(this.querySelectorAll('[data-lt]'), function (x) { x.classList.toggle('on', x === b); });
        body.innerHTML = tabs[cur]();
    };
};
PUR.lcInto = function (el, po) {
    el.innerHTML = '<div class="muted">' + PUR.spin + ' Reading receipts and invoices for PO ' + esc(po.OrderNumber || po.POHeaderId) + '…</div>';
    return PUR.lcLoad(po.POHeaderId).then(function (d) { PUR.lcRender(el, po, d); }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
};
PUR.lifeCycle = function (po) {
    FX.modal({
        title: '<i class="fa-solid fa-timeline" style="color:var(--accent)"></i> Purchase order life cycle <span class="chip info">' + esc(po.OrderNumber || '') + '</span> <span class="muted" style="font-size:.8rem;font-weight:500">' + esc(po.Supplier || '') + '</span>',
        wide: true, body: '<div id="lc-body" style="display:flex;flex-direction:column;gap:10px"></div>',
        buttons: [{ label: '<i class="fa-solid fa-copy"></i> Copy API URLs', act: 'api' }, { label: '<i class="fa-solid fa-rotate"></i> Refresh', act: 'refresh' }, { label: 'Close', act: 'close' }],
        onOpen: function () { PUR.lcInto($('lc-body'), po); },
        onAction: function (a) {
            if (a === 'refresh') { PUR.lcInto($('lc-body'), po); return false; }
            if (a === 'api') { navigator.clipboard.writeText(['receipts', 'invoices'].map(function (c) { return FX.url('purchaseOrderLifeCycleDetails/' + po.POHeaderId + '/child/' + c); }).join('\n')); FX.toast('Copied.'); return false; }
        }
    });
};

// ── PO detail (drawer) ─────────────────────────────────────────
PUR.LINE_COLS = [
    { label: '#', f: 'LineNumber' }, { label: 'Type', f: 'LineType' }, { label: 'Item', f: 'Item', fmt: 'mono' }, { label: 'Description', f: 'Description' }, { label: 'Category', f: 'Category' },
    { label: 'UOM', f: 'UOM' }, { label: 'Qty', f: 'Quantity', n: 1, fmt: 'num' }, { label: 'Base price', f: 'BasePrice', n: 1, fmt: 'money' }, { label: 'Unit price', f: 'Price', n: 1, fmt: 'money' },
    { label: 'Ordered', f: 'Ordered', n: 1, fmt: 'money' }, { label: 'Tax', f: 'TotalTax', n: 1, fmt: 'money' }, { label: 'Total', f: 'Total', n: 1, fmt: 'money' },
    { label: 'Status', get: function (r) { return PUR.first(r, 'StatusCode', 'Status'); }, fmt: 'chip' }, { label: 'Need-by', f: 'NeedByDate', fmt: 'date' }];
PUR.linesOf = function (po) {
    var l = (po.links || []).filter(function (x) { return x.name === 'lines'; })[0];
    return FX.restAll('purchaseOrders/' + po.POHeaderId + '/child/lines', {}, 5000).catch(function (e) { if (l) return FX.restAll(l.href.split('?')[0], {}, 5000); throw e; });
};
PUR.openPO = function (po) {
    var id = po.POHeaderId, ccy = po.CurrencyCode || po.Currency || '', inc = /INCOMPLETE/i.test(po.StatusCode || '');
    var sec = function (title, icon, rows) {
        var f = rows.filter(function (x) { return x[1] != null && x[1] !== ''; });
        return f.length ? '<div class="pu-sec"><h4><i class="fa-solid ' + icon + '"></i> ' + title + '</h4><div class="facts">' + f.map(function (x) { return '<div><span>' + esc(x[0]) + '</span>' + (x[2] ? x[1] : esc(x[1])) + '</div>'; }).join('') + '</div></div>' : '';
    };
    var cache = {};
    var lines = function () { return cache.l || (cache.l = PUR.linesOf(po)); };
    FX.drawer({
        width: 1040, raw: po,
        title: '<span class="mono">' + esc(po.OrderNumber) + '</span>', sub: esc(po.Supplier || '') + (po.SupplierSite ? ' · ' + esc(po.SupplierSite) : '') + ' · ' + esc(po.ProcurementBU || ''),
        chips: [FX.chip(po.StatusCode), ccy ? '<span class="chip">' + esc(ccy) + '</span>' : ''],
        facts: [['Ordered', PUR.money(po.Ordered, ccy)], ['Tax', PUR.money(po.TotalTax, ccy)], ['Total', '<b>' + PUR.money(po.Total, ccy) + '</b>']],
        extra: '<div class="pu-cols" style="margin-top:4px">' +
            sec('General', 'fa-circle-info', [['Document style', po.DocumentStyle], ['Order date', FX.fmt.date(po.OrderDate)], ['Created', FX.fmt.dt(po.CreationDate)], ['Last updated', FX.fmt.dt(po.LastUpdateDate)], ['Created by', po.CreatedBy], ['Last updated by', po.LastUpdatedBy], ['Description', po.Description]]) +
            sec('Legal entity & supplier', 'fa-building', [['Legal entity', po.SoldToLegalEntity], ['Supplier', po.Supplier], ['Supplier site', po.SupplierSite], ['Supplier contact', po.SupplierContact]]) +
            sec('People & organizations', 'fa-users', [['Buyer', po.BuyerDisplayName || po.Buyer], ['Requester', po.RequesterDisplayName], ['Procurement BU', po.ProcurementBU], ['Requisitioning BU', po.RequisitioningBU], ['Bill-to BU', po.BillToBU]]) +
            sec('Financial & payment', 'fa-coins', [['Currency', (po.CurrencyCode || '') + (po.Currency ? ' — ' + po.Currency : '')], ['Payment terms', po.PaymentTerms], ['Rate type', po.ConversionRateType], ['Conversion rate', po.ConversionRate != null ? FX.fmt.num(po.ConversionRate, 6) : null]]) +
            sec('Locations', 'fa-location-dot', [['Ship to', po.ShipToLocationAddress || po.ShipToLocationCode], ['Bill to', po.BillToLocationAddress || po.BillToLocation]]) +
            sec('References', 'fa-link', [['Requisition', po.Requisition], ['Sales order', po.SalesOrder], ['Negotiation', po.Negotiation]]) +
            sec('Notes', 'fa-note-sticky', [['Note to supplier', po.NoteToSupplier], ['Note to receiver', po.NoteToReceiver]]) + '</div>',
        tabs: [
            {
                label: 'Lines', render: function (el) {
                    el.innerHTML = '<div class="muted">' + PUR.spin + ' Loading lines…</div>';
                    lines().then(function (rows) {
                        el.innerHTML = rows.length ? FX.table(rows, PUR.LINE_COLS) + '<div class="row-btns"><span class="grow"></span><span class="muted">' + rows.length + ' lines · Σ Total</span><b>' + PUR.money(PUR.sum(rows, 'Total'), ccy) + '</b></div>' : '<div class="empty"><i class="fa-solid fa-inbox"></i>No lines.</div>';
                    }).catch(function (e) { cache.l = null; el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
                }
            },
            {
                label: 'Schedules', render: function (el) {
                    el.innerHTML = '<div class="muted">' + PUR.spin + ' Loading schedules…</div>';
                    var errs = [];
                    (cache.s || (cache.s = lines().then(function (ls) {
                        return PUR.pool(ls, 5, function (l) {
                            var lk = (l.links || []).filter(function (x) { return x.name === 'schedules'; })[0];
                            return FX.restAll('purchaseOrders/' + id + '/child/lines/' + l.POLineId + '/child/schedules', {}, 1000)
                                .catch(function (e) { if (lk) return FX.restAll(lk.href.split('?')[0], {}, 1000); throw e; })
                                .then(function (s) { return s.map(function (x) { x._lineNumber = l.LineNumber; x._lineItem = l.Item; x._lineDescription = l.Description; return x; }); })
                                .catch(function (e) { errs.push('Line ' + l.LineNumber + ': ' + e); return []; });
                        }).then(function (a) { return { rows: [].concat.apply([], a), errs: errs }; });
                    }))).then(function (res) {
                        var S = res.rows;
                        el.innerHTML = (res.errs.length ? '<div class="note err">' + esc(res.errs.join(' | ')) + '</div>' : '') + (S.length ? FX.table(S, [
                            { label: 'Line', f: '_lineNumber' }, { label: 'Sched', f: 'ShipmentNumber' }, { label: 'Item', f: '_lineItem', fmt: 'mono' }, { label: 'Description', f: '_lineDescription' },
                            { label: 'Ship-to location', html: function (s) { return '<span title="' + esc(PUR.first(s, 'ShipToLocation', 'ShipToLocationAddress') || '') + '">' + esc(PUR.first(s, 'ShipToLocationCode', 'ShipToLocation') || '') + '</span>'; } },
                            { label: 'Destination', get: function (s) { return PUR.first(s, 'DestinationType', 'DestinationTypeCode'); } },
                            { label: 'Ship-to org', html: function (s) { return esc(s.ShipToOrganizationName || '') + (s.ShipToOrganizationCode ? ' <span class="chip">' + esc(s.ShipToOrganizationCode) + '</span>' : ''); } },
                            { label: 'UOM', f: 'UOM' }, { label: 'Qty', n: 1, get: function (s) { return PUR.first(s, 'Quantity', 'QuantityOrdered'); }, fmt: 'num' }, { label: 'Received', n: 1, get: function (s) { return s.QuantityReceived || 0; }, fmt: 'num' },
                            { label: 'Match', get: function (s) { return PUR.first(s, 'MatchApprovalLevel', 'MatchApprovalLevelCode'); } }, { label: 'Need-by', f: 'NeedByDate', fmt: 'date' },
                            { label: 'Status', get: function (s) { return PUR.first(s, 'StatusCode', 'Status'); }, fmt: 'chip' },
                            { label: '', html: function (s) { return '<button class="btn sm icon" data-si="' + S.indexOf(s) + '" title="All attributes"><i class="fa-solid fa-circle-info"></i></button>'; } }]) : '<div class="empty"><i class="fa-solid fa-inbox"></i>No schedules.</div>');
                        el.onclick = function (e) { var b = e.target.closest('[data-si]'); if (b) { var s = S[+b.getAttribute('data-si')]; PUR.allFields('Schedule — line ' + s._lineNumber + ' · ' + (s.ShipmentNumber || ''), s); } };
                    }).catch(function (e) { cache.s = null; el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
                }
            },
            { label: 'Life cycle', render: function (el) { PUR.lcInto(el, po); } }
        ],
        actions: [
            inc ? { label: 'Edit', icon: 'fa-pen', cls: 'primary', run: function () { PUR.go('po-create', { edit: id, po: po.OrderNumber }); } } : null,
            { label: 'Life cycle', icon: 'fa-timeline', run: function () { PUR.lifeCycle(po); } },
            { label: 'Print / PDF', icon: 'fa-print', run: function () { lines().then(function (ls) { PUR.printPO(po, ls); }).catch(function (e) { FX.toast(String(e), 'err'); }); } },
            { label: 'Create ASN', icon: 'fa-truck-fast', run: function () { PUR.go('asn', { po: po.OrderNumber }); } },
            { label: 'Expected receipts', icon: 'fa-truck-ramp-box', run: function () { PUR.go('receipts', { po: po.OrderNumber }); } },
            { label: 'Actions', icon: 'fa-bolt', run: function () { PUR.poActions(po, function (st) { if (st) { po.StatusCode = st; PUR.openPO(po); if (PUR.poGrid) PUR.poGrid.render(); } }); } }
        ].filter(Boolean)
    });
};
PUR.printPO = function (po, lines) {
    var ccy = po.CurrencyCode || '';
    var cell = function (l, v) { return v ? '<div><span>' + esc(l) + '</span>' + esc(v) + '</div>' : ''; };
    PUR.print('PO ' + po.OrderNumber, '<h1>Purchase Order ' + esc(po.OrderNumber) + '</h1><div>' + esc(po.Supplier || '') + (po.SupplierSite ? ' · ' + esc(po.SupplierSite) : '') + ' · Status ' + esc(po.StatusCode || '') + '</div>' +
        '<h3>Totals</h3><div class="grid">' + cell('Ordered', FX.fmt.money(po.Ordered) + ' ' + ccy) + cell('Tax', FX.fmt.money(po.TotalTax) + ' ' + ccy) + cell('Total', FX.fmt.money(po.Total) + ' ' + ccy) + '</div>' +
        '<h3>General</h3><div class="grid">' + cell('Document style', po.DocumentStyle) + cell('Order date', FX.fmt.date(po.OrderDate)) + cell('Created', FX.fmt.date(po.CreationDate)) + cell('Description', po.Description) + '</div>' +
        '<h3>Legal entity & people</h3><div class="grid">' + cell('Legal entity', po.SoldToLegalEntity) + cell('Procurement BU', po.ProcurementBU) + cell('Buyer', po.BuyerDisplayName || po.Buyer) + cell('Requester', po.RequesterDisplayName) + cell('Bill-to BU', po.BillToBU) + cell('Payment terms', po.PaymentTerms) + '</div>' +
        (po.NoteToSupplier ? '<h3>Note to supplier</h3><div>' + esc(po.NoteToSupplier) + '</div>' : '') +
        '<h3>Lines</h3><table><tr><th>#</th><th>Type</th><th>Item</th><th>Description</th><th>UOM</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Ordered</th><th class="n">Tax</th><th class="n">Total</th><th>Status</th></tr>' +
        lines.map(function (l) { return '<tr><td>' + esc(l.LineNumber) + '</td><td>' + esc(l.LineType) + '</td><td>' + esc(l.Item) + '</td><td>' + esc(l.Description) + '</td><td>' + esc(l.UOM) + '</td><td class="n">' + FX.fmt.num(l.Quantity) + '</td><td class="n">' + FX.fmt.money(l.Price) + '</td><td class="n">' + FX.fmt.money(l.Ordered) + '</td><td class="n">' + FX.fmt.money(l.TotalTax) + '</td><td class="n">' + FX.fmt.money(l.Total) + '</td><td>' + esc(PUR.first(l, 'StatusCode', 'Status') || '') + '</td></tr>'; }).join('') +
        '<tr class="tot"><td colspan="7">Total ' + esc(ccy) + '</td><td class="n">' + FX.fmt.money(PUR.sum(lines, 'Ordered')) + '</td><td class="n">' + FX.fmt.money(PUR.sum(lines, 'TotalTax')) + '</td><td class="n">' + FX.fmt.money(PUR.sum(lines, 'Total')) + '</td><td></td></tr></table>');
};

// ── View: Manage Purchase Orders ───────────────────────────────
PUR.STATUSES = ['OPEN', 'APPROVED', 'CLOSED', 'CLOSED FOR RECEIVING', 'INCOMPLETE', 'IN PROCESS'];
function purManagePOs(el) {
    var p = PUR.take('pos');
    $('fx-vh-r').innerHTML = '<button class="btn primary" id="pos-new"><i class="fa-solid fa-plus"></i> Create PO</button>';
    $('pos-new').onclick = function () { PUR.go('po-create', { fresh: true }); };
    var flag = function (r, k) { var f = PUR.lcFlags[r.POHeaderId]; return !f ? '<span class="muted" title="Open the life cycle to load">—</span>' : f[k] ? '<span class="pu-flag y">✓</span>' : '<span class="pu-flag n">✗</span>'; };
    var g = PUR.poGrid = FX.grid(el, {
        id: 'pos', resource: 'purchaseOrders', expand: 'lines', orderBy: 'CreationDate:desc', pageSize: 25, qJoin: ';', key: 'POHeaderId', select: true, csvName: 'PurchaseOrders',
        emptyText: 'No purchase orders. Pick a business unit and search.',
        filters: [
            { id: 'bu', label: 'Procurement BU *', type: 'lov', lov: 'payBUs', blank: false, value: PUR.recall('bu'), q: function (v) { return 'ProcurementBUId=' + v; } },
            { id: 'num', label: 'Order number', ph: 'e.g. 2026020223', value: p.po || '', q: function (v) { return 'OrderNumber like ' + PUR.dq(v + '*'); } },
            { id: 'sup', label: 'Supplier', ph: 'Supplier name', value: p.supplier || '', q: function (v) { return 'Supplier like ' + PUR.dq(v + '*'); } },
            { id: 'st', label: 'Status', type: 'select', options: [{ v: '', t: 'All' }].concat(PUR.STATUSES.map(function (s) { return { v: s, t: s.charAt(0) + s.slice(1).toLowerCase() }; })), q: function (v) { return 'StatusCode=' + PUR.dq(v); } },
            { id: 'dop', label: 'Created', type: 'select', value: '>', options: [{ v: '>', t: 'after' }, { v: '>=', t: 'on or after' }, { v: '=', t: 'on' }, { v: '<=', t: 'on or before' }, { v: '<', t: 'before' }] },
            { id: 'cd', label: 'Creation date', type: 'date', value: p.po ? '' : FX.daysAgo(2), q: function (v, g2) { return g2.val('num') ? null : 'CreationDate' + (g2.val('dop') || '>') + v; } }
        ],
        validate: function (g2) { return g2.val('bu') ? null : 'Procurement Business Unit is mandatory'; },
        columns: [
            { label: 'Created', f: 'CreationDate', fmt: 'date' },
            { label: 'Order', f: 'OrderNumber', html: function (r) { return '<b class="mono">' + esc(r.OrderNumber) + '</b>'; } },
            { label: 'Legal entity', f: 'SoldToLegalEntity' }, { label: 'Supplier', f: 'Supplier' },
            { label: 'Ship to', get: function (r) { return r._shipTo; }, html: function (r) { return r._enriched ? esc(r._shipTo || '—') : PUR.spin; } },
            { label: 'Status', f: 'StatusCode', fmt: 'chip' },
            { label: 'Lines', n: 1, get: function (r) { return r._lines; }, html: function (r) { return r._enriched ? '<span class="chip">' + (r._lines == null ? '?' : r._lines) + '</span>' : PUR.spin; } },
            { label: 'CCY', f: 'CurrencyCode' }, { label: 'Ordered', f: 'Ordered', n: 1, fmt: 'money' },
            { label: 'Total', f: 'Total', n: 1, html: function (r) { return '<b>' + FX.fmt.money(r.Total) + '</b>'; } },
            { label: 'Buyer', f: 'BuyerDisplayName' }, { label: 'Order date', f: 'OrderDate', fmt: 'date' },
            { label: 'Rcpt', html: function (r) { return flag(r, 'receipts'); } }, { label: 'Inv', html: function (r) { return flag(r, 'invoices'); } }, { label: 'Paid', html: function (r) { return flag(r, 'payment'); } }
        ],
        kpis: function (rows) {
            var byCcy = PUR.groupSum(rows, 'CurrencyCode', 'Total');
            return [
                { k: 'all', label: 'Purchase orders', value: rows.length },
                { k: 'inc', label: 'Incomplete', value: rows.filter(function (r) { return /INCOMPLETE/i.test(r.StatusCode); }).length, filter: function (r) { return /INCOMPLETE/i.test(r.StatusCode); } },
                { k: 'open', label: 'Open', value: rows.filter(function (r) { return /^OPEN$/i.test(r.StatusCode); }).length, filter: function (r) { return /^OPEN$/i.test(r.StatusCode); } },
                { k: 'sup', label: 'Suppliers', value: PUR.distinct(rows, 'Supplier').length }
            ].concat(byCcy.slice(0, 3).map(function (c) { return { k: 'c_' + c.label, label: 'Total · ' + c.label, value: PUR.compact(c.v), filter: function (r) { return (r.CurrencyCode || '—') === c.label; } }; }));
        },
        actions: [
            { label: 'Submit for approval', icon: 'fa-paper-plane', run: function (g2) { purBulkSubmit(g2); } },
            { label: 'Lines', icon: 'fa-list', run: function (g2) { purLinesModal(g2.rows); } },
            { label: 'Analytics', icon: 'fa-chart-column', run: function (g2) { purAnalytics(g2.rows); } },
            { label: '', icon: 'fa-plug', cls: 'icon', run: function () { FX.modal({ title: 'Approval API — discover actions', wide: true, body: '<div class="pu-inline"><button class="btn sm" data-r="draftPurchaseOrders">draftPurchaseOrders</button><button class="btn sm" data-r="purchaseOrders">purchaseOrders</button><span class="muted">submit lives on draft; cancel / change / close live on purchaseOrders</span></div><div id="disc-out"></div>', onOpen: function (box) { box.querySelector('.modal-b').onclick = function (e) { var b = e.target.closest('[data-r]'); if (b) PUR.discover(b.getAttribute('data-r'), $('disc-out'), function (n) { navigator.clipboard.writeText(n); FX.toast('Copied ' + n); }); }; } }); } }
        ],
        rowActions: [
            { label: 'Edit draft', icon: 'fa-pen', when: function (r) { return /INCOMPLETE/i.test(r.StatusCode || ''); }, run: function (r) { PUR.go('po-create', { edit: r.POHeaderId, po: r.OrderNumber }); } },
            { label: 'Life cycle', icon: 'fa-timeline', run: function (r) { PUR.lifeCycle(r); } },
            { label: 'Create ASN', icon: 'fa-truck-fast', run: function (r) { PUR.go('asn', { po: r.OrderNumber }); } },
            { label: 'Expected receipts', icon: 'fa-truck-ramp-box', run: function (r) { PUR.go('receipts', { po: r.OrderNumber }); } }
        ],
        onRow: function (r) { PUR.openPO(r); },
        afterLoad: function (g2) {
            var todo = g2.rows.filter(function (r) { return !r._enriched; });
            PUR.pool(todo, 6, function (r) {
                return FX.get('purchaseOrders/' + r.POHeaderId + '/child/lines', { limit: 1, total: true, expand: 'schedules' }).then(function (j) {
                    var it = (j.items || [])[0], sc = it && it.schedules ? (it.schedules.items || it.schedules)[0] : null;
                    r._lines = j.totalResults != null ? j.totalResults : j.count != null ? j.count : (j.items || []).length;
                    r._shipTo = sc ? PUR.first(sc, 'ShipToLocationCode', 'ShipToLocation') : null;
                }).catch(function () { r._lines = r.lines && r.lines.items ? r.lines.items.length : null; }).then(function () { r._enriched = true; });
            }, function (n, t) { if (n % 6 === 0 || n === t) g2.render(); });
        }
    });
    var bu = $('gf_pos_bu'); PUR.bindRemember(bu, 'bu');
    FX.lov('payBUs').then(function () { setTimeout(function () { if (bu.value) g.search(); }, 0); }).catch(function () { });
}
function purBulkSubmit(g) {
    var sel = g.selectedRows();
    if (!sel.length) { FX.toast('Tick the incomplete orders to submit.', 'err'); return; }
    FX.confirm('Submit for approval', 'Submit <b>' + sel.length + '</b> order(s) for approval?<div class="note" style="margin-top:8px">POST ' + esc(FX.url('draftPurchaseOrders/{POHeaderId}', { onlyData: false })) + '<br>body {"name":"submit","parameters":[]}</div>' +
        '<div style="margin-top:6px">' + sel.map(function (r) { return '<span class="chip" style="margin:2px">' + esc(r.OrderNumber) + ' · ' + esc(r.StatusCode || '') + '</span>'; }).join('') + '</div>', 'Submit').then(function (ok) {
            if (!ok) return;
            var fails = [], okN = 0, i = 0;
            (function next() {
                if (i >= sel.length) {
                    FX.busy(false); g.selected = {};
                    if (fails.length) FX.modal({ title: okN + ' submitted, ' + fails.length + ' failed', body: '<div class="note err" style="white-space:pre-wrap">' + esc(fails.join('\n')) + '</div>' }); else FX.toast(okN + ' order(s) submitted for approval.', 'ok');
                    g.search(); return;
                }
                var r = sel[i++]; FX.busy('Submitting ' + r.OrderNumber + ' (' + i + '/' + sel.length + ')…');
                FX.action('draftPurchaseOrders/' + r.POHeaderId, 'submit').then(function () { okN++; }, function (e) { fails.push(r.OrderNumber + ': ' + e); }).then(next);
            })();
        });
}
function purLinesModal(rows) {
    var L = [];
    rows.forEach(function (po) { ((po.lines && (po.lines.items || po.lines)) || []).forEach(function (l) { L.push(Object.assign({}, l, { _PONumber: po.OrderNumber, _POHeaderId: po.POHeaderId, _po: po })); }); });
    var cols = [{ label: 'PO', f: '_PONumber', html: function (r) { return '<button class="link mono" data-po="' + esc(r._POHeaderId) + '">' + esc(r._PONumber) + '</button>'; } }].concat(PUR.LINE_COLS);
    var csvCols = [{ label: 'PO Number', f: '_PONumber' }, { label: 'Line #', f: 'LineNumber' }, { label: 'Type', f: 'LineType' }, { label: 'Item', f: 'Item' }, { label: 'Description', f: 'Description' }, { label: 'Category', f: 'Category' }, { label: 'UOM', f: 'UOM' }, { label: 'Quantity', f: 'Quantity' }, { label: 'Base Price', f: 'BasePrice' }, { label: 'Unit Price', f: 'Price' }, { label: 'Ordered Amount', f: 'Ordered' }, { label: 'Tax', f: 'TotalTax' }, { label: 'Total', f: 'Total' }, { label: 'Status', get: function (r) { return PUR.first(r, 'StatusCode', 'Status'); } }, { label: 'Need-By Date', f: 'NeedByDate' }];
    var draw = function (q) {
        q = (q || '').toLowerCase();
        var v = !q ? L : L.filter(function (r) { return ['_PONumber', 'Item', 'Description', 'Category', 'LineType', 'StatusCode'].some(function (k) { return String(r[k] || '').toLowerCase().indexOf(q) >= 0; }); });
        $('pl-out').innerHTML = v.length ? FX.table(v.slice(0, 2000), cols) : '<div class="empty"><i class="fa-solid fa-inbox"></i>No lines.</div>';
        $('pl-n').textContent = v.length + ' of ' + L.length + ' lines';
        return v;
    };
    var cur = L;
    FX.modal({
        title: '<i class="fa-solid fa-list" style="color:var(--accent)"></i> Lines of the loaded orders', wide: true,
        body: '<div class="pu-inline"><input id="pl-q" type="search" placeholder="Filter by PO, item, description, category, type, status…" style="min-width:320px"><span class="muted" id="pl-n"></span></div><div id="pl-out" class="pu-scroll"></div>',
        buttons: [{ label: '<i class="fa-solid fa-file-csv"></i> Export', act: 'csv' }, { label: 'Close', act: 'close' }],
        onOpen: function () {
            cur = draw(''); $('pl-q').oninput = function () { cur = draw(this.value); };
            $('pl-out').onclick = function (e) { var b = e.target.closest('[data-po]'); if (b) { var r = L.filter(function (x) { return String(x._POHeaderId) === b.getAttribute('data-po'); })[0]; FX.closeModal(); PUR.openPO(r._po); } };
        },
        onAction: function (a) { if (a === 'csv') { FX.csv(cur, csvCols, 'PurchaseOrderLines_' + PUR.stamp()); return false; } }
    });
}
function purAnalytics(rows) {
    if (!rows.length) { FX.toast('Search first.', 'err'); return; }
    var ccys = PUR.groupSum(rows, 'CurrencyCode');
    var draw = function (ccy) {
        var R = rows.filter(function (r) { return (r.CurrencyCode || '—') === ccy; }), L = [];
        R.forEach(function (po) { ((po.lines && (po.lines.items || po.lines)) || []).forEach(function (l) { L.push(l); }); });
        var months = PUR.groupSum(R, function (r) { return String(r.OrderDate || '').slice(0, 7) || '—'; }, 'Total').sort(function (a, b) { return a.label < b.label ? -1 : 1; }).slice(-12);
        var fm = function (v) { return PUR.compact(v); };
        $('an-out').innerHTML = PUR.kpis([{ label: 'Orders', value: R.length }, { label: 'Lines', value: L.length }, { label: 'Suppliers', value: PUR.distinct(R, 'Supplier').length }, { label: 'Avg lines / PO', value: R.length ? (L.length / R.length).toFixed(1) : '0' }, { label: 'Total ordered · ' + ccy, value: FX.fmt.money(PUR.sum(R, 'Total')) }]) +
            '<div class="pu-cols"><div class="pu-sec"><h4>Status distribution</h4>' + PUR.bars(PUR.groupSum(R, 'StatusCode').map(function (x) { x.label += ' (' + Math.round(x.v / R.length * 100) + '%)'; return x; })) + '</div>' +
            '<div class="pu-sec"><h4>Monthly trend (order date)</h4>' + PUR.bars(months, { fmt: fm }) + '</div>' +
            '<div class="pu-sec"><h4>Top 10 suppliers</h4>' + PUR.bars(PUR.groupSum(R, 'Supplier', 'Total', 10), { fmt: fm }) + '</div>' +
            '<div class="pu-sec"><h4>Top 10 items</h4>' + PUR.bars(PUR.groupSum(L, function (l) { return l.Item || l.Description; }, 'Total', 10), { fmt: fm }) + '</div>' +
            '<div class="pu-sec"><h4>Top 10 categories</h4>' + PUR.bars(PUR.groupSum(L, function (l) { return l.Category || 'Uncategorized'; }, 'Total', 10), { fmt: fm }) + '</div></div>';
    };
    FX.modal({
        title: '<i class="fa-solid fa-chart-column" style="color:var(--accent)"></i> Analytics — loaded orders', wide: true,
        body: '<div class="pu-inline"><label>Currency <select id="an-ccy">' + ccys.map(function (c) { return '<option>' + esc(c.label) + '</option>'; }).join('') + '</select></label><span class="muted">Amounts are never mixed across currencies.</span></div><div id="an-out" style="display:flex;flex-direction:column;gap:10px"></div>',
        onOpen: function () { draw(ccys[0].label); $('an-ccy').onchange = function () { draw(this.value); }; }
    });
}

// ── View: PO Life Cycle (standalone) ───────────────────────────
function purLifeCycleView(el) {
    var p = PUR.take('lifecycle');
    el.innerHTML = '<div class="card"><div class="filters"><label>Purchase order<input id="lcv-po" type="search" placeholder="e.g. 2026020223" value="' + esc(p.po || PUR.recall('lc_po', '')) + '"></label>' +
        '<div class="go"><button class="btn primary" id="lcv-go"><i class="fa-solid fa-magnifying-glass"></i> Show life cycle</button></div></div></div><div id="lcv-head"></div><div id="lcv-out" style="display:flex;flex-direction:column;gap:10px"><div class="empty"><i class="fa-solid fa-timeline"></i>Enter a purchase order number to follow it from order to receipt, invoice and payment.</div></div>';
    var go = function () {
        var po = $('lcv-po').value.trim(); if (!po) { FX.toast('Enter a PO number.', 'err'); return; }
        PUR.remember('lc_po', po);
        $('lcv-out').innerHTML = '<div class="muted">' + PUR.spin + ' Finding PO ' + esc(po) + '…</div>'; $('lcv-head').innerHTML = '';
        FX.get('purchaseOrders', { q: 'OrderNumber=' + PUR.dq(po), limit: 5 }).then(function (j) {
            var r = (j.items || [])[0];
            if (!r) { $('lcv-out').innerHTML = '<div class="empty"><i class="fa-solid fa-circle-question"></i>PO ' + esc(po) + ' was not found.</div>'; return; }
            $('lcv-head').innerHTML = '<div class="card pu-head"><span class="po-no">' + esc(r.OrderNumber) + '</span>' + FX.chip(r.StatusCode) + '<span>' + esc(r.Supplier || '') + '</span><span class="muted">' + esc(r.ProcurementBU || '') + '</span>' +
                '<div class="tot"><div><span>Ordered</span><b>' + PUR.money(r.Ordered, r.CurrencyCode) + '</b></div><div><span>Total</span><b>' + PUR.money(r.Total, r.CurrencyCode) + '</b></div></div><button class="btn sm" id="lcv-open"><i class="fa-solid fa-up-right-from-square"></i> Open PO</button></div>';
            $('lcv-open').onclick = function () { PUR.openPO(r); };
            PUR.lcInto($('lcv-out'), r);
        }).catch(function (e) { $('lcv-out').innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
    };
    $('lcv-go').onclick = go; $('lcv-po').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    if (p.po) go();
}
