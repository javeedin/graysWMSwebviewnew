/* AI Agent — page tools shared by every specialist (open_page, show_chart, make_report) and the confirm-card previews of
   the action tools. A tool returns {ok, content (what the model reads), data (what the page keeps)}. */

AG.PAGES = {
    fusionsql: '../fusionsql/index.html', wms: '../index.html', om: '../om/index.html', dataload: '../dataload/index.html',
    fusionmodel: '../fusionmodel/index.html', powerbi: '../powerbi/index.html', aihub: '../aihub/index.html', aianalysis: '../aianalysis/index.html', fscm: '../fscm/index.html'
};
/** Hand-off to another page: a one-shot localStorage note the page reads on start (Fusion SQL: sql / watch). */
AG.handoff = function (page, params) {
    params = params || {};
    try {
        // Fusion SQL restores its editor from fusionSql.editor and its tab from fusionSql.tab on start
        if (page === 'fusionsql' && params.sql) { localStorage.setItem('fusionSql.editor', JSON.stringify(String(params.sql))); localStorage.setItem('fusionSql.tab', JSON.stringify(params.tab || 'builder')); }
    } catch (e) { }
    window.location.href = AG.PAGES[page];
};

AG.tool('open_page', function (inp) {
    var page = String(inp.page || '').toLowerCase();
    if (!AG.PAGES[page]) return { ok: false, content: 'Unknown page. Pages: ' + Object.keys(AG.PAGES).join(', ') };
    var go = function () { AG.handoff(page, inp.params || {}); };
    AG.pill('Ready to open ' + page);
    var b = document.createElement('button'); b.className = 'btn sm'; b.style.alignSelf = 'center';
    b.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Open ' + esc(page) + (inp.params && inp.params.sql ? ' with the SQL' : '');
    b.onclick = go; $('timeline').appendChild(b);
    return { ok: true, content: 'A button to open ' + page + ' is shown to the user (the conversation stays saved).' };
});

AG.tool('show_chart', function (inp) {
    return AG.fetchResult(inp.result_id).then(function (r) {
        var names = r.columns.map(function (c) { return c.name.toUpperCase(); });
        var x = inp.x ? String(inp.x).toUpperCase() : null, ys = (inp.y || []).map(function (y) { return String(y).toUpperCase(); });
        var bad = [x].concat(ys).filter(function (c) { return c && names.indexOf(c) < 0; });
        if (bad.length) return { ok: false, content: 'Unknown column(s) ' + bad.join(', ') + '. Columns: ' + names.join(', ') };
        if (inp.type !== 'kpi' && !ys.length) { var num = r.columns.filter(function (c) { return c.type === 'number'; }); ys = num.slice(0, 1).map(function (c) { return c.name.toUpperCase(); }); }
        if (inp.type !== 'kpi' && (!x || !ys.length)) return { ok: false, content: 'A chart needs x (category / date) and y (numeric) columns.' };
        var res = AG.resById(inp.result_id) || AG.addResult({ result_id: inp.result_id, title: r.title, row_count: r.row_count }, true);
        res.chart = { type: inp.type || 'bar', x: x, y: ys, title: inp.title || r.title };
        AG.selectResult(inp.result_id);
        return { ok: true, content: 'Chart shown (' + res.chart.type + ' of ' + ys.join(', ') + (x ? ' by ' + x : '') + ').', data: { result_id: inp.result_id, chart: res.chart } };
    }, function (e) { return { ok: false, content: String(e) }; });
});

AG.tool('make_report', function (inp) {
    var ids = (inp.result_ids || []).filter(function (id) { return AG.resById(id) || true; });
    if (!ids.length) return { ok: false, content: 'Give the result_ids to put in the report.' };
    var rid = 'rep_' + hex16().slice(0, 8);
    AG.addResult({ result_id: rid, title: '📄 ' + (inp.title || 'Report'), report: { title: inp.title, summary: inp.summary, kpis: inp.kpis || [], result_ids: ids } });
    return { ok: true, content: 'The report "' + (inp.title || 'Report') + '" is shown in the results panel; the user can print it, save it as PDF or copy it into an e-mail.', data: { report_id: rid } };
});

// ── rich output: open a web page, format a result, render a document ──
AG.tool('open_url', function (inp) {
    var url = String(inp.url || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return { ok: false, content: 'Only http(s) addresses can be opened.' };
    var label = inp.label || url.replace(/^https?:\/\//, '');
    if (inp.open !== false) AGF.openExternal(url);
    $('timeline').insertAdjacentHTML('beforeend', '<div class="pill">' + (inp.open !== false ? 'Opened in your browser: ' : 'Link: ') + AGF.link(url, esc(label)) + '</div>');
    $('timeline').scrollTop = 1e9;
    return { ok: true, content: (inp.open !== false ? 'Opened ' : 'Shown a link to ') + url + ' in the user\'s browser (a clickable link is in the chat too).' };
});

AG.tool('format_result', function (inp) {
    return AG.fetchResult(inp.result_id).then(function (d) {
        var names = d.columns.map(function (c) { return String(c.name).toUpperCase(); }), cols = {}, errs = [];
        Object.keys(inp.columns || {}).forEach(function (k) {
            var u = k.toUpperCase(), f = inp.columns[k];
            if (names.indexOf(u) < 0) { errs.push('unknown column ' + k); return; }
            var e = AGF.checkFormat(k, f); if (e) errs.push(e); else cols[u] = f;
        });
        (inp.hide || []).concat(inp.order || []).forEach(function (k) { if (names.indexOf(String(k).toUpperCase()) < 0) errs.push('unknown column ' + k); });
        (inp.row_rules || []).forEach(function (x) { if (names.indexOf(String(x.column || '').toUpperCase()) < 0) errs.push('row rule: unknown column ' + x.column); });
        if (errs.length) return { ok: false, content: 'Not applied: ' + errs.join('; ') + '. Columns: ' + names.join(', ') };
        var r = AG.resById(inp.result_id) || AG.addResult({ result_id: inp.result_id, title: d.title, row_count: d.row_count }, true);
        var f = { title: inp.title || null, note: inp.note || null, columns: inp.merge && r.fmt ? Object.assign({}, r.fmt.columns, cols) : cols, hide: inp.hide || [], order: inp.order || [], row_rules: inp.row_rules || [] };
        r.fmt = f;
        if (inp.sort) { var si = names.indexOf(String(inp.sort.column || '').toUpperCase()); if (si >= 0) r.sort = { i: si, dir: inp.sort.desc ? -1 : 1 }; }
        AG.selectResult(inp.result_id);
        return { ok: true, content: 'Formatted ' + Object.keys(cols).length + ' column(s) of ' + inp.result_id + ' in the results panel (links open in the browser; Copy formatted keeps the look for Outlook / Teams / Excel).',
            data: { result_id: inp.result_id, title: d.title, fmt: f } };
    }, function (e) { return { ok: false, content: String(e) }; });
});

AG.tool('render', function (inp) {
    if (!inp.markdown && !inp.html) return { ok: false, content: 'Give markdown and/or html.' };
    var id = 'doc_' + hex16().slice(0, 8), doc = { title: inp.title || '', markdown: inp.markdown || '', html: inp.html || '' };
    AG.addResult({ result_id: id, title: '📝 ' + (inp.title || 'Document'), doc: doc });
    return { ok: true, content: 'The document "' + (inp.title || 'Document') + '" is shown in the results panel (Print / PDF, Copy formatted for e-mail, Save .html). Do not repeat it in the chat.',
        data: { result_id: id, title: '📝 ' + (inp.title || 'Document'), doc: doc } };
});

// ── confirm-card previews (what exactly will happen) ──
function sqlPreview(sql) { return '<pre>' + esc(sql || '') + '</pre>'; }
AG.preview.fusion_sql_run = function (i) {
    var dry = AG.lastDry && AG.lastDry[(i.sql || '').replace(/\s+/g, ' ').trim().toLowerCase()];
    return '<div class="why"><b>' + esc(i.title || 'Run on Fusion') + '</b>' + (i.why ? ' — ' + esc(i.why) : '') + '</div>' + sqlPreview(i.sql) +
        '<div class="facts">' + (dry != null ? '<span class="fact">dry run: <b>' + Number(dry).toLocaleString() + '</b> rows</span>' : '') + '<span class="fact">fetch up to ' + (i.row_limit || 5000).toLocaleString() + ' rows</span><span class="fact">read-only (BI Publisher)</span></div>';
};
AG.preview.mra_interface = function (i) {
    return '<div class="why">Send <b>' + (i.orders || []).length + '</b> order(s) to the Mauritius Revenue Authority' + (i.trip_id ? ' (trip ' + esc(i.trip_id) + ')' : '') + '. Fiscal invoices cannot be undone.</div>' +
        '<div class="facts">' + (i.orders || []).map(function (o) { return '<span class="fact">' + esc(o) + '</span>'; }).join('') + '</div>';
};
AG.preview.save_query = function (i) { return '<div class="why">Save <b>' + esc(i.name) + '</b> to the team\'s saved queries' + (i.category ? ' (' + esc(i.category) + ')' : '') + '.</div>' + (i.description ? '<div class="muted sm">' + esc(i.description) + '</div>' : '') + sqlPreview(i.sql); };
AG.preview.watchdog_create = function (i) {
    return '<div class="why">Watchdog <b>' + esc(i.name) + '</b>: every ' + (i.schedule_min || 60) + ' min, rule ' + esc(i.rule || 'AUTO') + (i.limit != null ? ' ' + i.limit : '') + (i.direction ? ' (' + esc(i.direction) + ')' : '') + '.</div>' + sqlPreview(i.sql);
};
AG.preview.schedule_job = function (i) { return '<div class="why">Run <b>' + esc(i.name) + '</b> ' + (i.every_min ? 'every ' + i.every_min + ' min' : 'daily at ' + esc(i.daily_at)) + ':</div><pre>' + esc(i.prompt) + '</pre><div class="muted sm">Read-only steps run by themselves; anything that needs a confirm waits for you.</div>'; };
AG.preview.inbox_request = function (i) { return '<div class="why">Ask an approver (AI inbox, Teams / e-mail): <b>' + esc(i.title) + '</b></div><pre>' + esc(i.detail) + '</pre>'; };
AG.preview.om_prepare_order = function (i) {
    return '<div class="why">Prepare an order in the Order Pad for <b>' + esc(i.customer) + '</b>' + (i.po ? ' (PO ' + esc(i.po) + ')' : '') + ' — you review and save it there; nothing goes to Fusion.</div>' +
        '<table class="t"><thead><tr><th>Item</th><th class="n">Qty</th></tr></thead><tbody>' + (i.lines || []).map(function (l) { return '<tr><td>' + esc(l.item) + '</td><td class="n">' + esc(l.qty) + '</td></tr>'; }).join('') + '</tbody></table>';
};
