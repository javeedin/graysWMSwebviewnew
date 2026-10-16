/* AI Agent — Order Desk, Data Loader and Reporter tools (page side).
   Orders: the app's Order Management tables (WMS_OM_ORDERS / WMS_OM_EVENTS) and the live Fusion order (REST,
   salesOrdersForOrderHub, through the host relay dataLoadFusionRest — credentials stay in C#). A prepared order goes to
   the Order Pad as its unsaved draft (om_pad_<pod>) for the user to review and save; nothing is sent to Fusion.
   Loads: the FBDI catalog shipped with the app (dataload/fbdi-catalog.js), WMS_FBDI_LOADS, Fusion REST describe / GET.
   Reports: Fusion Model reports + dashboards. */
var AG_FUSION = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };

AG.readClob = function (table, col, where) {
    var parts = []; for (var i = 0; i < 12; i++) parts.push('TO_CHAR(SUBSTR(' + col + ', ' + (i * 1300 + 1) + ', 1300)) AS p' + i);
    return rows('SELECT NVL(LENGTH(' + col + '), 0) AS len, ' + parts.join(', ') + ' FROM ' + table + ' WHERE ' + where, 1).then(function (r) {
        if (!r.length) return '';
        var s = ''; for (var i = 0; i < 12; i++) s += r[0]['P' + i] || '';
        var len = +r[0].LEN, chunks = [];
        for (var o = 12 * 1300 + 1; o <= len; o += 12 * 1300) chunks.push(o);
        return chunks.reduce(function (p, o) {
            return p.then(function (acc) {
                var q = []; for (var i = 0; i < 12; i++) q.push('TO_CHAR(SUBSTR(' + col + ', ' + (o + i * 1300) + ', 1300)) AS p' + i);
                return rows('SELECT ' + q.join(', ') + ' FROM ' + table + ' WHERE ' + where, 1).then(function (x) { for (var i = 0; i < 12; i++) acc += (x[0] || {})['P' + i] || ''; return acc; });
            });
        }, Promise.resolve(s));
    });
};
AG.fusionRest = function (path, query) {
    if (!/^[A-Za-z0-9_]+(\/[A-Za-z0-9_\-%.]+)*$/.test(path)) return Promise.reject('Bad resource path');
    var url = AG_FUSION[AG.pod] + '/fscmRestApi/resources/11.13.18.05/' + path + (query ? '?' + query : '');
    return host('dataLoadFusionRest', { method: 'GET', url: url, body: null, framework: '4' }, 180000).then(function (d) {
        if (!d || d.ok === false) throw (d && d.error) || 'Fusion REST failed';
        if (d.status >= 400) throw 'Fusion REST HTTP ' + d.status + ': ' + String(d.body || '').slice(0, 300);
        try { return JSON.parse(d.body || '{}'); } catch (e) { throw 'Fusion REST: not JSON'; }
    });
};

// ── Order Desk ──
AG.tool('om_orders_find', function (inp) {
    var w = AG.words(inp.words), st = AG.words(inp.status)[0], from = /^\d{4}-\d{2}-\d{2}$/.test(inp.from || '') ? inp.from : null, to = /^\d{4}-\d{2}-\d{2}$/.test(inp.to || '') ? inp.to : null;
    return rows("SELECT order_id, order_no, bu_name, status, verdict, customer_number, customer_name, order_type, customer_po, TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date, currency, total_net, line_count, fusion_order_no, fusion_status, SUBSTR(last_error, 1, 200) AS last_error, created_by " +
        'FROM wms_om_orders WHERE instance = ' + lit(AG.pod) + " AND status <> 'DISCARDED'" + (st ? ' AND status LIKE ' + lit('%' + st + '%') : '') +
        (from ? " AND order_date >= TO_DATE(" + lit(from) + ", 'YYYY-MM-DD')" : ' AND created_date >= SYSDATE - 60') + (to ? " AND order_date < TO_DATE(" + lit(to) + ", 'YYYY-MM-DD') + 1" : '') +
        (w.length ? ' AND ' + AG.likeAll("UPPER(order_no || ' ' || customer_number || ' ' || customer_name || ' ' || customer_po || ' ' || fusion_order_no)", w) : '') + ' ORDER BY order_id DESC FETCH FIRST 200 ROWS ONLY', 200)
        .then(function (list) { return AG.tableOut('Orders · ' + AG.pod, list, 'No orders found.'); }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Order Management') }; });
});
AG.tool('om_order_detail', function (inp) {
    var id = String(inp.id || '').trim(), where = /^\d+$/.test(id) ? 'order_id = ' + id : 'order_no = ' + lit(id) + ' AND instance = ' + lit(AG.pod);
    return rows("SELECT order_id, order_no, status, verdict, customer_number, customer_name, order_type, customer_po, TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date, currency, total_net, total_tax, total_disc, line_count, fusion_order_no, fusion_status, SUBSTR(last_error, 1, 500) AS last_error, created_by FROM wms_om_orders WHERE " + where, 1).then(function (h) {
        if (!h.length) return { ok: false, content: 'No order ' + id };
        var o = h[0], w = 'order_id = ' + o.ORDER_ID;
        return Promise.all([AG.readClob('wms_om_orders', 'lines_json', w), rows("SELECT event_type, SUBSTR(detail, 1, 300) AS detail, created_by, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS at FROM wms_om_events WHERE " + w + ' ORDER BY event_id DESC FETCH FIRST 15 ROWS ONLY', 15).catch(function () { return []; })]).then(function (r) {
            var lines = []; try { lines = JSON.parse(r[0] || '[]'); } catch (e) { }
            var ls = lines.map(function (l) { return { ITEM: l.item, DESCRIPTION: l.desc || l.description || '', TYPE: l.type, QTY: l.qty, PRICE: l.price, DISC_PCT: l.discPct != null ? l.discPct : l.disc, NET: l.net }; });
            var t = ls.length ? AG.tableOut('Order ' + o.ORDER_NO + ' · lines', ls) : { ok: true, content: '' };
            return { ok: true, content: 'Header: ' + JSON.stringify(o) + '\nTimeline: ' + JSON.stringify(r[1]) + '\nLines: ' + t.content, data: t.data };
        });
    }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Order Management') }; });
});
AG.tool('fusion_order_status', function (inp) {
    var no = String(inp.order_number || '').replace(/[^\w\-]/g, ''); if (!no) return { ok: false, content: 'order_number required' };
    return AG.fusionRest('salesOrdersForOrderHub', 'q=' + encodeURIComponent("OrderNumber='" + no + "'") + '&expand=lines&onlyData=true&limit=5').then(function (j) {
        var it = (j.items || [])[0];
        if (!it) return { ok: true, content: 'Fusion (' + AG.pod + ') has no order ' + no + '.' };
        var head = { OrderNumber: it.OrderNumber, SourceTransactionNumber: it.SourceTransactionNumber, Status: it.StatusCode, OnHold: it.OnHold, Customer: it.BuyingPartyName, OrderDate: it.TransactionOn || it.OrderedDate, Total: it.TotalAmount, Currency: it.TransactionalCurrencyCode, BU: it.BusinessUnitName };
        var lines = ((it.lines && (it.lines.items || it.lines)) || []).map(function (l) { return { LINE: l.DisplayLineNumber || l.LineNumber, ITEM: l.ProductNumber, QTY: l.OrderedQuantity, UOM: l.OrderedUOM || l.OrderedUOMCode, STATUS: l.StatusCode, ON_HOLD: l.OnHold, SCHEDULED: l.ScheduleShipDate }; });
        var t = lines.length ? AG.tableOut('Fusion order ' + no + ' · lines', lines) : { content: '' };
        return { ok: true, content: 'Header: ' + JSON.stringify(head) + '\nLines: ' + t.content, data: t.data };
    }, function (e) { return { ok: false, content: String(e) }; });
});
AG.tool('om_prepare_order', function (inp) {
    var cust = String(inp.customer || '').trim(), lines = (inp.lines || []).filter(function (l) { return l && l.item && +l.qty; });
    if (!cust || !lines.length) return { ok: false, content: 'A customer and at least one line (item, qty) are needed.' };
    var w = AG.words(cust);
    return rows('SELECT order_id, customer_number, customer_name, bu_name FROM wms_om_orders WHERE instance = ' + lit(AG.pod) + " AND status <> 'DISCARDED' AND (UPPER(customer_number) = " + lit(cust.toUpperCase()) +
        (w.length ? ' OR (' + AG.likeAll('UPPER(customer_name)', w) + ')' : '') + ') ORDER BY order_id DESC FETCH FIRST 1 ROWS ONLY', 1).then(function (r) {
        if (!r.length) return { ok: false, content: 'No earlier order for "' + cust + '" in Order Management (' + AG.pod + ') to take the customer details from. Ask the user to open the Order Pad and pick the customer (F7) — offer open_page om.' };
        return AG.readClob('wms_om_orders', 'header_json', 'order_id = ' + r[0].ORDER_ID).then(function (hj) {
            var h = {}; try { h = JSON.parse(hj || '{}'); } catch (e) { }
            var attrs = h.orderTypeAttrs || {}; delete h.orderTypeAttrs;
            var d = new Date(), z = function (n) { return ('0' + n).slice(-2); }, today = d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
            h.orderNo = ''; h.orderDate = today; h.pricingDate = today; if (inp.po) h.customerPo = inp.po; if (inp.notes) h.notes = inp.notes;
            var draft = { id: null, status: 'DRAFT', header: h, orderTypeAttrs: attrs,
                lines: lines.map(function (l, i) { return { id: 'ag' + Date.now() + i, item: String(l.item).trim(), qty: +l.qty, type: 'ORD', discAdd: 0, status: 'DRAFT' }; }) };
            try { localStorage.setItem('om_pad_' + AG.pod, JSON.stringify(draft)); localStorage.setItem('om_tab', JSON.stringify('pad')); } catch (e) { return { ok: false, content: 'Could not store the draft: ' + e }; }
            AG.tool.exec_open('om');
            return { ok: true, content: 'Draft for ' + r[0].CUSTOMER_NAME + ' (' + r[0].CUSTOMER_NUMBER + ', BU ' + r[0].BU_NAME + ') with ' + lines.length + ' line(s) is waiting in the Order Pad; prices and checks fill in when it opens. A button to open it is shown.' };
        });
    }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Order Management') }; });
});
AG.tool.exec_open = function (page) { AG.exec.open_page({ page: page }); };

// ── Data Loader ──
AG.tool('fbdi_templates_find', function (inp) {
    var T = window.FBDI_TEMPLATES || [];
    if (!T.length) return { ok: false, content: 'The FBDI catalog is not loaded.' };
    var w = String(inp.words || '').toLowerCase().split(/\W+/).filter(function (x) { return x.length > 2; });
    var scored = T.map(function (t) {
        var hay = (t.n + ' ' + t.f + ' ' + t.a + ' ' + (t.d || '') + ' ' + (t.j || '') + ' ' + (t.t || []).map(function (s) { return s.n; }).join(' ')).toLowerCase();
        var sc = w.reduce(function (s, x) { return s + (hay.indexOf(x) >= 0 ? (t.n.toLowerCase().indexOf(x) >= 0 ? 3 : 1) : 0); }, 0);
        return { t: t, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; }).slice(0, 5);
    if (!scored.length) return { ok: true, content: 'No FBDI template matches. Areas: ' + (window.FBDI_AREAS || []).map(function (a) { return a[1]; }).join(', ') };
    return { ok: true, content: scored.map(function (x) {
        var t = x.t;
        return '## ' + t.n + ' (' + t.f + '.xlsm, area ' + t.a + ')\n' + (t.d || '') + '\nImport process: ' + (t.j || '?') + (t.u ? ' · UCM account ' + t.u : '') + '\n' +
            (t.t || []).map(function (s) { var req = (s.c || []).filter(function (c) { return c.charAt(0) === '*'; }).map(function (c) { return c.slice(1); }); return '- sheet ' + s.n + ': ' + (s.c || []).length + ' columns; required: ' + (req.slice(0, 25).join(', ') || 'none marked'); }).join('\n');
    }).join('\n\n') + '\n\nPrepare & Load in the Data Loading page fills these from Excel / SQL (open_page dataload).' };
});
AG.tool('fbdi_loads', function (inp) {
    var w = AG.words(inp.words);
    return rows("SELECT load_id, load_name, template_file, instance, status, row_count, last_run_status, TO_CHAR(last_run_date, 'YYYY-MM-DD HH24:MI') AS last_run, created_by FROM wms_fbdi_loads WHERE " +
        AG.likeAll("UPPER(load_name || ' ' || template_file || ' ' || description)", w) + ' ORDER BY NVL(last_run_date, created_date) DESC FETCH FIRST 60 ROWS ONLY', 60)
        .then(function (list) { return AG.tableOut('FBDI loads', list, 'No FBDI loads yet (Data Loading › Prepare & Load).'); }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Data Loading › Prepare & Load') }; });
});
AG.tool('fusion_rest_describe', function (inp) {
    var res = String(inp.resource || '').trim();
    return AG.fusionRest(res + '/describe').then(function (j) {
        var r = (j.Resources && (j.Resources[res] || j.Resources[Object.keys(j.Resources)[0]])) || {};
        var attrs = (r.attributes || []).map(function (a) { return a.name + ' ' + a.type + (a.precision ? '(' + a.precision + ')' : '') + (a.mandatory ? ' REQUIRED' : '') + (a.updatable === false ? ' read-only' : ''); });
        var kids = Object.keys(r.children || {}), acts = (r.actions || []).map(function (a) { return a.name; });
        return { ok: true, content: res + ': ' + attrs.length + ' fields\n' + attrs.slice(0, 160).join('\n') + (kids.length ? '\nChild collections: ' + kids.join(', ') : '') + (acts.length ? '\nActions: ' + acts.join(', ') : '') };
    }, function (e) { return { ok: false, content: String(e) }; });
});
AG.tool('fusion_rest_get', function (inp) {
    var res = String(inp.resource || '').trim(), q = ['onlyData=true', 'limit=' + Math.min(50, Math.max(1, parseInt(inp.limit, 10) || 10))];
    if (inp.q) q.push('q=' + encodeURIComponent(inp.q));
    if (inp.fields) q.push('fields=' + encodeURIComponent(String(inp.fields).replace(/[^\w,;:]/g, '')));
    return AG.fusionRest(res, q.join('&')).then(function (j) {
        var items = j.items || [];
        if (!items.length) return { ok: true, content: 'No records.' };
        var cols = Object.keys(items[0]).filter(function (k) { return typeof items[0][k] !== 'object' || items[0][k] === null; }).slice(0, 40);
        var s = AG.pageResult('REST ' + res, cols, items.map(function (it) { return cols.map(function (c) { return it[c]; }); }));
        return { ok: true, content: JSON.stringify(s) + (j.hasMore ? '\n(more records exist)' : ''), data: s };
    }, function (e) { return { ok: false, content: String(e) }; });
});

// ── Reporter ──
AG.tool('model_reports', function (inp) {
    var w = String(inp.words || '').toLowerCase();
    return Promise.all([host('fmReports', {}, 60000).catch(function () { return {}; }), host('fmDashboards', {}, 60000).catch(function () { return {}; })]).then(function (r) {
        var reps = (r[0].reports || []).filter(function (x) { return !w || (x.name + ' ' + (x.description || '') + ' ' + (x.folder || '')).toLowerCase().indexOf(w) >= 0; });
        var dash = (r[1].dashboards || []).filter(function (x) { return !w || String(x.name || '').toLowerCase().indexOf(w) >= 0; });
        if (!reps.length && !dash.length) return { ok: true, content: 'No Fusion Model reports or dashboards' + (w ? ' match "' + w + '"' : '') + '.' };
        return { ok: true, content: 'Reports:\n' + reps.map(function (x) { return '- ' + x.name + (x.folder ? ' [' + x.folder + ']' : '') + ': measures ' + ((x.request || {}).measures || []).map(function (m) { return m.name; }).join(', ') + ' by ' + ((x.request || {}).groupBy || []).join(', '); }).join('\n') +
            '\nDashboards:\n' + dash.map(function (x) { return '- ' + x.name + ' (' + (x.pages || []).length + ' pages)'; }).join('\n') + '\nOpen them in Fusion Model (open_page fusionmodel).' };
    });
});
