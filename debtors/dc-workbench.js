/* Fusion Debtors Control · the check workbench (window.DC.wb) and two Setup cards.
 * Workbench = a full-screen panel over the page for one checklist result: every row the check found (from this PC's
 * DuckDB copy, else APEX's first rows, else run again), totals of the amount columns, status chips that filter, a filter
 * box per column, sort, CSV — and a drill-down per row: the sales order (its OM lines, the AR invoice lines that carry
 * it, what waits in AutoInvoice, the accounting events), an AR transaction (lines, events, journal lines) or a receipt
 * (applications, events, journal lines), each part one read-only Fusion query shown with its SQL and kept on this PC.
 * Order / transaction / receipt numbers open the drill-down; the ↗ next to them opens the record in Oracle Fusion
 * (the sales order link is Oracle's documented deep link; transaction / receipt links come from Setup › Fusion links).
 * Setup cards: Database objects (check / create every table, column, index, procedure and ORDS endpoint through the
 * APEX execute API — no SQL file to run) and Fusion links. Needs dc-cycles.js (DC.cycles, DC.local). */
(function () {
    'use strict';
    var DC = window.DC, A = DC.api, E = A.E, S = A.S, P = A.P, esc = A.esc, money = A.money, pill = A.pill, when = A.when;
    var C = DC.cycles, L = DC.local;
    function $(id) { return document.getElementById(id); }
    var W = DC.wb = { stack: [], links: null };
    function copy(text, msg) { try { var p = navigator.clipboard.writeText(String(text || '')); if (p && p.then) p.then(function () { if (msg) A.toast(msg, 'ok'); }, function () { }); } catch (e) { } }
    var HIDE = /^(HEADER_ID|CUSTOMER_TRX_ID|TRX_IDS|SOURCE_ID|EVENT_ID|AE_HEADER_ID|CASH_RECEIPT_ID|FULFILL_LINE_ID|INTERFACE_LINE_ID|EVENT_STATUS_CODE|PROCESS_STATUS_CODE)$/;
    var FIRST = ['ACCOUNT_NUMBER', 'CUSTOMER', 'ACCOUNT_NAME', 'ORDER_NUMBER', 'KIND', 'TRX_NUMBER', 'RECEIPT_NUMBER', 'OM_AMOUNT', 'AR_AMOUNT', 'AMOUNT', 'DIFFERENCE', 'ACCT_STATUS'];
    var LABEL = { ACCOUNT_NUMBER: 'Customer no.', CUSTOMER: 'Customer', ORDER_NUMBER: 'Order', OM_AMOUNT: 'OM amount', AR_AMOUNT: 'AR amount', ACCT_STATUS: 'Accounting', TRX_NUMBER: 'Transaction', RECEIPT_NUMBER: 'Receipt', DIFFERENCE: 'Why', OM_LINES: 'OM lines', GL_TRANSFER: 'GL transfer', ENTRY_STATUS: 'Entry' };
    function label(c, def) { var C2 = String(c).toUpperCase(); if (C2 === 'AMOUNT' && def && def.compare) return 'Difference (OM − AR)'; return LABEL[C2] || (C2.charAt(0) + C2.slice(1).toLowerCase()).replace(/_/g, ' '); }
    function isAmt(c) { return /AMOUNT|^ENTERED_|^ACCOUNTED_|REMAINING|^PRICE$/i.test(c); }
    function colsOf(rows) { var seen = {}, out = []; (rows || []).slice(0, 200).forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } }); }); return out; }
    function order(cols) {
        var up = function (c) { return String(c).toUpperCase(); };
        return cols.slice().sort(function (a, b) {
            var ia = FIRST.indexOf(up(a)), ib = FIRST.indexOf(up(b)), ha = HIDE.test(up(a)), hb = HIDE.test(up(b));
            if (ha !== hb) return ha ? 1 : -1;
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || cols.indexOf(a) - cols.indexOf(b);
        });
    }
    function acctPill(v) {
        var s = String(v || ''); if (!s) return '';
        var cls = /^Accounted$/i.test(s) ? 'ok' : /error|not accounted|not in gl|incomplete|draft|invalid/i.test(s) ? 'bad' : /no invoice|no accounting/i.test(s) ? 'warn' : 'muted';
        return pill(esc(s), cls);
    }
    function cellHtml(col, row, fi, ri) {
        var v = row[col], C2 = String(col).toUpperCase();
        if (C2 === 'ACCT_STATUS') return acctPill(v);
        if (isAmt(col) && v !== '' && v != null && !isNaN(+v)) return '<span class="' + (+v < 0 ? 'badc' : '') + '">' + money(+v) + '</span>';
        var lk = E.cellLink(col, row);
        if (lk && lk.open) {
            var u = W.url(lk.fusion, { id: lk.id, number: lk.number });
            return '<a data-act="wbOpen" data-f="' + fi + '" data-r="' + ri + '" data-c="' + esc(col) + '">' + esc(v) + '</a> <button class="lnk" data-act="wbFusion" data-f="' + fi + '" data-r="' + ri + '" data-c="' + esc(col) + '" title="' + (u ? 'Open in Oracle Fusion' : 'Copy the number and open Oracle Fusion (set a direct link in Setup › Fusion links)') + '"><i class="fas fa-arrow-up-right-from-square"></i></button>';
        }
        if (lk && lk.customer) return '<a data-act="wbCust" data-acct="' + esc(v) + '" title="Customer 360">' + esc(v) + '</a>';
        return esc(v == null ? '' : v);
    }

    // ── Fusion links ──
    W.loadLinks = function () { if (W.links) return Promise.resolve(W.links); return S.settings.get('LINKS').then(function (v) { W.links = v || {}; return W.links; }, function () { W.links = {}; return W.links; }); };
    W.base = function (pod) { var l = W.links || {}; return (l.base && l.base[pod]) || E.POD_BASE[pod] || ''; };
    W.url = function (kind, ids) { var pod = (C.cy && C.cy.POD) || P.pod || 'PROD'; return E.fusionUrl(kind, ids, W.base(pod), (W.links || {}).templates); };
    function openExternal(u) {
        if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({ action: 'openExternalUrl', url: u });
        else window.open(u, '_blank', 'noopener');
    }
    W.openFusion = function (kind, ids) {
        var u = W.url(kind, ids);
        if (u) { openExternal(u); A.toast('Opening ' + (kind === 'ORDER' ? 'the sales order' : kind === 'TRX' ? 'the transaction' : 'the receipt') + ' in Oracle Fusion…', 'ok'); return; }
        var home = W.url('HOME', {}) || W.base((C.cy && C.cy.POD) || P.pod);
        copy(ids.number || ids.id);
        if (home) openExternal(home);
        A.toast('No direct link for this in Setup › Fusion links — the number ' + esc(ids.number || ids.id) + ' is copied; Fusion opens on its home page', 'warn', 8000);
    };

    // ── the panel ──
    function shell() {
        var el = $('cy-wb');
        if (!el) {
            el = document.createElement('div'); el.id = 'cy-wb'; el.className = 'wb';
            el.innerHTML = '<div class="wb-in"><div class="wb-top" id="wb-top"></div><div class="wb-body" id="wb-body"></div></div>';
            document.body.appendChild(el);
            el.addEventListener('input', onInput);
        }
        el.classList.add('on');
        return el;
    }
    W.close = function () { var el = $('cy-wb'); if (el) el.classList.remove('on'); W.stack = []; };
    W.back = function () { W.stack.pop(); if (!W.stack.length) W.close(); else paint(); };
    function top() { return W.stack[W.stack.length - 1]; }
    function paint() {
        var f = top(); if (!f) return;
        $('wb-top').innerHTML = '<div class="crumbs">' + W.stack.map(function (x, i) { return (i ? '<i class="fas fa-chevron-right"></i>' : '') + '<a data-act="wbTo" data-i="' + i + '"' + (i === W.stack.length - 1 ? ' class="cur"' : '') + '>' + esc(x.title) + '</a>'; }).join('') + '</div><span class="sp"></span>' +
            (W.stack.length > 1 ? '<button class="btn sm" data-act="wbBack"><i class="fas fa-arrow-left"></i> Back</button>' : '') + '<button class="btn sm" data-act="wbClose" title="Esc"><i class="fas fa-xmark"></i> Close</button>';
        $('wb-body').innerHTML = f.type === 'check' ? checkHtml(f) : drillHtml(f);
        if (f.type === 'check') paintGrid();
    }

    // ── a check's rows ──
    /** open the workbench on one check (its saved rows; variant 'all' = every order of the month for the OM ↔ AR check) */
    W.openCheck = function (id, variant) {
        var d = C.defs().filter(function (x) { return x.id === id; })[0] || { id: id, title: id };
        W.loadLinks();
        W.stack = [{ type: 'check', id: id, def: d, title: d.title, variant: variant || 'check', rows: null, src: '', filters: {}, sort: null, chip: null, showIds: false }];
        shell(); paint();
        return loadRows(top());
    };
    function loadRows(f) {
        var r = C.results[f.id] || {};
        if (f.variant === 'check' && r.rowsAll) { f.rows = r.rowsAll; f.src = 'every row, kept on this PC'; paint(); return Promise.resolve(); }
        return L.rows(f.id, f.variant).then(function (rows) {
            if (rows && rows.length) { f.rows = rows; f.src = 'every row, from this PC (' + rows.length + ')'; if (f.variant === 'check') r.rowsAll = rows; paint(); return; }
            if (f.variant === 'all') return runVariant(f);
            if (r.status === 'PASS') { f.rows = []; f.src = 'nothing found'; paint(); return; }
            return S.cycle.checkDetail(C.cy.CYCLE_ID, f.id).then(function (det) {
                f.rows = det.sample || []; f.sql = det.sql; f.src = f.rows.length < (+r.rows || 0) ? 'the first ' + f.rows.length + ' of ' + r.rows + ' rows from APEX — Run again to see every row on this PC' : 'from APEX';
                paint();
            });
        }).catch(function (e) { f.rows = []; f.src = 'could not read: ' + A.errText(e); paint(); });
    }
    function varsOf() { return E.cycleVars(A.bu(C.cy.BU_ID), { stmtDate: C.cy.STMT_DATE, tolerance: C.cy.TOLERANCE != null && C.cy.TOLERANCE !== '' ? +C.cy.TOLERANCE : 1 }, {}); }
    /** the SQL behind what is on screen: the check as it ran, or "every order of the month" (ONLY_DIFF = N) */
    function sqlOf(f) {
        if (f.sql) return f.sql;
        if (f.variant === 'all' && f.def && f.def.sql) return E.fill(f.def.sql, Object.assign(varsOf(), { ONLY_DIFF: 'N' }), 'sql');
        var r = C.results[f.id] || {};
        if (r.sql) return r.sql;
        return f.def && f.def.sql ? E.fill(f.def.sql, varsOf(), 'sql') : '';
    }
    function runVariant(f) {
        var sql = E.fill(f.def.sql, Object.assign(varsOf(), { ONLY_DIFF: 'N' }), 'sql'), t0 = Date.now(), end = A.busy('Reading every order of the month from Fusion…');
        f.sql = sql; f.err = null; f.rows = null; if (f.autoSql) { f.showSql = false; f.autoSql = false; } f.src = 'reading every order of the month (up to 10 min)…'; paint();
        return S.fusionSql(sql, 50000, 600000).then(function (rows) {
            var secs = Math.round((Date.now() - t0) / 100) / 10;
            f.rows = rows; f.src = rows.length + ' orders read now (' + secs + ' s) · reading the accounting status…'; paint();
            return DC.cycles.acctFill(rows, function (i, n) { f.src = rows.length + ' orders read (' + secs + ' s) · accounting status ' + i + ' / ' + n; var el = $('wb-src'); if (el) el.textContent = f.src; }).then(function () {
                end(); f.src = rows.length + ' orders read now (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)' + (rows.acctFailed ? ' · ' + rows.acctFailed + ' accounting chunk(s) could not be read' : '') + ' · kept on this PC';
                L.saveRows(f.id, 'all', rows); paint();
            });
        }, function (e) { end(); f.rows = []; f.err = A.errText(e); if (!f.showSql) { f.showSql = true; f.autoSql = true; } f.src = 'Fusion did not answer'; paint(); });
    }
    function filtered(f) {
        var rows = f.rows || [], fl = f.filters, keys = Object.keys(fl).filter(function (k) { return fl[k]; });
        var out = rows.filter(function (r) {
            if (f.chip && String(r[f.chip.col] == null || r[f.chip.col] === '' ? '(blank)' : r[f.chip.col]) !== f.chip.val) return false;
            return keys.every(function (k) {
                var q = String(fl[k]).trim(), v = r[k] == null ? '' : String(r[k]);
                var m = /^([<>]=?|=|!)\s*(.*)$/.exec(q);
                if (m && m[1] !== '=' && m[1] !== '!' && !isNaN(+m[2]) && m[2] !== '') { var n = +v; return m[1] === '>' ? n > +m[2] : m[1] === '<' ? n < +m[2] : m[1] === '>=' ? n >= +m[2] : n <= +m[2]; }
                if (m && m[1] === '=') return v.toLowerCase() === m[2].toLowerCase();
                if (m && m[1] === '!') return v.toLowerCase().indexOf(m[2].toLowerCase()) < 0;
                return v.toLowerCase().indexOf(q.toLowerCase()) >= 0;
            });
        });
        if (f.sort) {
            var c = f.sort.c, dir = f.sort.dir;
            out = out.slice().sort(function (a, b) { var x = a[c], y = b[c], nx = +x, ny = +y; var r = x !== '' && y !== '' && !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)); return dir * r; });
        }
        return out;
    }
    function checkHtml(f) {
        var d = f.def, r = C.results[f.id] || {}, cols = f.cols = f.rows ? order(colsOf(f.rows)) : [];
        var h = '<div class="wb-head"><div><h2 style="margin:0">' + esc(d.title) + ' ' + pill(d.severity === 'BLOCK' ? 'blocking' : 'warning', d.severity === 'BLOCK' ? 'bad' : 'warn') + '</h2><div class="small muted">' + esc(d.help || '') + '</div>' +
            '<div class="small" style="margin-top:4px">' + (r.status ? '<b>' + esc(r.status === 'PASS' ? 'passed' : r.status === 'NOT_RUN' ? 'not run' : r.status === 'ERROR' ? 'could not run' : (r.rows + (r.truncated ? '+' : '') + ' found')) + '</b>' : 'not run') + (r.ranAt ? ' · ' + when(r.ranAt) + ' · ' + esc(r.ranBy || '') : '') + (r.ms ? ' · ' + Math.round(+r.ms / 100) / 10 + ' s' : '') + ' · <span class="muted" id="wb-src">' + esc(f.src || '') + '</span></div>' +
            (r.error ? '<div class="note bad" style="margin-top:6px">' + esc(r.error) + '</div>' : '') + (r.bypassNote ? '<div class="note warn" style="margin-top:6px"><i class="fas fa-user-shield"></i> Bypassed by ' + esc(r.bypassBy || '') + ': “' + esc(r.bypassNote) + '”</div>' : '') + '</div></div>';
        if (d.compare) h += '<div class="seg" style="margin:10px 0"><button data-act="wbVariant" data-v="check"' + (f.variant === 'check' ? ' class="on"' : '') + '>Only the differences</button><button data-act="wbVariant" data-v="all"' + (f.variant === 'all' ? ' class="on"' : '') + '>Every order of the month</button></div>';
        if (f.err) h += '<div class="wb-err"><b><i class="fas fa-triangle-exclamation"></i> ' + esc(f.err) + '</b><div class="small" style="margin-top:4px">The query is below — copy it into Fusion SQL to see where the time goes, or try again (it now waits up to 10 minutes). The accounting status is read separately afterwards, so the comparison itself is the only heavy part.</div>' +
            '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="wbRetry"><i class="fas fa-rotate"></i> Try again</button><button class="btn sm" data-act="wbCopySql"><i class="fas fa-copy"></i> Copy SQL</button><button class="btn sm" data-act="wbToFsql"><i class="fas fa-database"></i> Open in Fusion SQL</button></div></div>';
        if (f.showSql) h += sqlPanel(f);
        if (!f.rows) return h + '<div class="card empty"><i class="fas fa-spinner fa-spin"></i></div>';
        h += '<div id="wb-sum"></div>';
        h += '<div class="row" style="margin:8px 0"><span class="small muted" id="wb-n"></span><span class="sp"></span><label class="chk small"><input type="checkbox" id="wb-ids"' + (f.showIds ? ' checked' : '') + '> show ids</label>' +
            '<button class="btn sm" data-act="wbClear">Clear filters</button>' +
            '<button class="btn sm" data-act="wbCsv"><i class="fas fa-file-csv"></i> CSV</button><button class="btn sm' + (f.showSql ? ' pri' : '') + '" data-act="wbSql"><i class="fas fa-code"></i> ' + (f.showSql ? 'Hide SQL' : 'SQL') + '</button>' +
            (DC.cycles.canRun() ? '<button class="btn sm" data-act="wbRerun"><i class="fas fa-play"></i> Run again</button>' : '') + '</div>';
        var vis = cols.filter(function (c) { return f.showIds || !HIDE.test(String(c).toUpperCase()); });
        h += '<div class="tblw wb-grid"><table class="tbl" id="wb-grid"><thead><tr>' + vis.map(function (c) { var s = f.sort && f.sort.c === c ? (f.sort.dir > 0 ? ' ▲' : ' ▼') : ''; return '<th class="sort' + (isAmt(c) ? ' r' : '') + '" data-act="wbSort" data-c="' + esc(c) + '">' + esc(label(c, f.def)) + s + '</th>'; }).join('') + '</tr>' +
            '<tr class="flt">' + vis.map(function (c) { return '<th><input type="search" data-wbf="' + esc(c) + '" value="' + esc(f.filters[c] || '') + '" placeholder="filter"></th>'; }).join('') + '</tr></thead><tbody></tbody><tfoot></tfoot></table></div>' +
            '<div class="small muted" style="margin-top:6px">Click a row (or an order / transaction number) for its transactions; <i class="fas fa-arrow-up-right-from-square"></i> opens it in Oracle Fusion. Filters: text, =exact, !not, &gt;100, &lt;0.</div>';
        f.vis = vis;
        return h;
    }
    function paintGrid() {
        var f = top(); if (!f || f.type !== 'check' || !f.rows) return;
        var rows = filtered(f), vis = f.vis || [], fi = W.stack.length - 1, shown = rows.slice(0, 1000);
        f.view = rows;
        var tb = document.querySelector('#wb-grid tbody'); if (!tb) return;
        tb.innerHTML = shown.length ? shown.map(function (r, i) { return '<tr class="' + (E.rowDrill(r) ? 'click' : '') + '" data-act="wbRow" data-r="' + i + '">' + vis.map(function (c) { return '<td' + (isAmt(c) ? ' class="r num"' : '') + '>' + cellHtml(c, r, fi, i) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + vis.length + '" class="muted" style="text-align:center;padding:18px">' + (f.rows.length ? 'Nothing matches the filters' : 'Nothing found') + '</td></tr>';
        var sum = E.gridSummary(rows, vis);
        document.querySelector('#wb-grid tfoot').innerHTML = rows.length ? '<tr>' + vis.map(function (c, i) { return '<td class="' + (isAmt(c) ? 'r num' : '') + '"><b>' + (i === 0 ? 'Total ' + rows.length : sum.sums[c] != null ? money(sum.sums[c]) : '') + '</b></td>'; }).join('') + '</tr>' : '';
        $('wb-n').textContent = rows.length === f.rows.length ? f.rows.length + ' rows' : rows.length + ' of ' + f.rows.length + ' rows' + (rows.length > 1000 ? ' · first 1,000 shown (CSV has all)' : '');
        // tiles: every amount column + the chips of the status columns, over the whole check (chips filter)
        var all = E.gridSummary(f.rows, vis), tiles = Object.keys(all.sums).map(function (c) { return A.kpi(label(c, f.def), money(all.sums[c]), rows.length !== f.rows.length ? 'shown: ' + money(sum.sums[c]) : '', /^AMOUNT$/i.test(c) ? (Math.abs(all.sums[c]) > 0.005 ? 'bad' : 'ok') : 'info'); });
        var chips = Object.keys(all.counts).map(function (c) {
            return '<div class="chips"><span class="small muted">' + esc(label(c, f.def)) + ':</span>' + Object.keys(all.counts[c]).sort(function (a, b) { return all.counts[c][b] - all.counts[c][a]; }).map(function (v) {
                var on = f.chip && f.chip.col === c && f.chip.val === v;
                return '<button class="chip' + (on ? ' on' : '') + '" data-act="wbChip" data-c="' + esc(c) + '" data-v="' + esc(v) + '">' + (String(c).toUpperCase() === 'ACCT_STATUS' ? acctPill(v) : esc(v)) + ' <b>' + all.counts[c][v] + '</b></button>';
            }).join('') + '</div>';
        }).join('');
        $('wb-sum').innerHTML = (tiles.length ? '<div class="kpis">' + tiles.join('') + '</div>' : '') + chips;
    }
    function onInput(e) {
        var t = e.target, f = top(); if (!f) return;
        if (t.dataset && t.dataset.wbf != null) { f.filters[t.dataset.wbf] = t.value; clearTimeout(W._t); W._t = setTimeout(paintGrid, 160); }
    }
    document.addEventListener('change', function (e) { if (e.target.id === 'wb-ids') { var f = top(); if (f) { f.showIds = e.target.checked; paint(); } } });

    // ── a drill-down ──
    W.drill = function (dr, fromRow, buId) {
        if (!dr) return;
        if (!$('cy-wb') || !$('cy-wb').classList.contains('on')) { W.stack = []; shell(); }
        W.loadLinks();
        var f = { type: 'drill', title: dr.label, dr: dr, row: fromRow || null, parts: {}, buId: buId || (W.stack[0] && W.stack[0].buId) || null };
        W.stack.push(f); paint();
        return loadDrill(f, false);
    };
    function loadDrill(f, fresh) {
        var b = A.bu(f.buId || (C.cy ? C.cy.BU_ID : P.buId)), defs = (E.DRILLS[f.dr.kind] || {}).parts || [], cid = f.buId ? 'c360' : C.cy ? C.cy.CYCLE_ID : 'none';
        return (fresh ? Promise.resolve({}) : L.drill(cid, f.dr.key)).then(function (kept) {
            var todo = [];
            defs.forEach(function (p) {
                var sql = E.drillSql(p, f.dr.vars, b);
                if (kept[p.id]) f.parts[p.id] = { rows: kept[p.id].rows, sql: sql, src: 'this PC · read ' + when(kept[p.id].at) };
                else { f.parts[p.id] = { rows: null, sql: sql }; todo.push(p); }
            });
            paint();
            var queue = todo.slice();
            function next() {
                var p = queue.shift(); if (!p) return Promise.resolve();
                var x = f.parts[p.id], t0 = Date.now();
                return S.fusionSql(x.sql, 5000).then(function (rows) { x.rows = rows; x.src = 'Fusion · ' + Math.round((Date.now() - t0) / 100) / 10 + ' s'; L.saveDrill(cid, f.dr.key, p.id, rows, x.sql); }, function (e) { x.rows = []; x.err = A.errText(e); })
                    .then(function () { if (top() === f) paint(); return next(); });
            }
            return Promise.all([next(), next()]);
        });
    }
    function drillHtml(f) {
        var dr = f.dr, d = E.DRILLS[dr.kind] || { parts: [] }, v = dr.vars, fid = W.stack.length - 1;
        var ids = dr.kind === 'ORDER' ? { id: v.HEADER_ID, number: v.ORDER_NUMBER } : dr.kind === 'TRX' ? { id: v.TRX_ID, number: v.NUMBER } : { id: v.RECEIPT_ID, number: v.NUMBER };
        var u = W.url(dr.kind, ids), row = f.row;
        var h = '<div class="wb-head"><div><h2 style="margin:0"><i class="fas ' + (dr.kind === 'ORDER' ? 'fa-cart-shopping' : dr.kind === 'TRX' ? 'fa-file-invoice-dollar' : 'fa-money-check-dollar') + '"></i> ' + esc(dr.label) + '</h2>' +
            (row ? '<div class="row small" style="gap:14px;margin-top:6px">' + ['ACCOUNT_NUMBER', 'CUSTOMER', 'OM_AMOUNT', 'AR_AMOUNT', 'AMOUNT', 'DIFFERENCE', 'ACCT_STATUS'].filter(function (k) { return row[k] != null && row[k] !== ''; }).map(function (k) { return '<span><span class="muted">' + esc(label(k, k === 'AMOUNT' && row.OM_AMOUNT != null ? { compare: true } : null)) + '</span> <b>' + (k === 'ACCT_STATUS' ? acctPill(row[k]) : isAmt(k) ? money(+row[k]) : esc(row[k])) + '</b></span>'; }).join('') + '</div>' : '') + '</div><span class="sp"></span>' +
            '<button class="btn sm pri" data-act="wbFusionDr" title="' + (u ? esc(u) : 'No direct link set in Setup › Fusion links — the number is copied') + '"><i class="fas fa-arrow-up-right-from-square"></i> Open in Oracle Fusion</button><button class="btn sm" data-act="wbDrillFresh"><i class="fas fa-rotate"></i> Read again from Fusion</button></div>';
        d.parts.forEach(function (p) {
            var x = f.parts[p.id] || {}, rows = x.rows, cols = rows ? order(colsOf(rows)).filter(function (c) { return !HIDE.test(String(c).toUpperCase()) || /CUSTOMER_TRX_ID/.test(c) && false; }) : [];
            var sum = rows ? E.gridSummary(rows, cols) : null;
            h += '<div class="card"><h2 style="font-size:14px">' + esc(p.title) + ' ' + (rows ? pill(rows.length + ' row(s)', rows.length ? 'info' : 'muted') : '<i class="fas fa-spinner fa-spin"></i>') + '<span class="sp"></span><span class="small muted">' + esc(x.src || '') + '</span></h2>' +
                (x.err ? '<div class="note bad">' + esc(x.err) + '</div>' : '') +
                (rows && rows.length ? '<div class="tblw" style="max-height:340px"><table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th' + (isAmt(c) ? ' class="r"' : '') + '>' + esc(label(c)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    rows.slice(0, 500).map(function (r, i) { return '<tr>' + cols.map(function (c) { return '<td' + (isAmt(c) ? ' class="r num"' : '') + '>' + drillCell(c, r, fid, p.id, i) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>' +
                    (Object.keys(sum.sums).length ? '<tfoot><tr>' + cols.map(function (c, i) { return '<td class="' + (isAmt(c) ? 'r num' : '') + '"><b>' + (i === 0 ? 'Total' : sum.sums[c] != null ? money(sum.sums[c]) : '') + '</b></td>'; }).join('') + '</tr></tfoot>' : '') + '</table></div>' : rows ? '<div class="small muted">Nothing.</div>' : '') +
                '<details style="margin-top:6px"><summary class="small muted">SQL</summary><pre class="sqlbox">' + esc(x.sql || '') + '</pre><button class="btn sm" data-act="wbCopy" data-p="' + esc(p.id) + '"><i class="fas fa-copy"></i> Copy</button></details></div>';
        });
        return h;
    }
    function drillCell(c, r, fid, pid, i) {
        var v = r[c], C2 = String(c).toUpperCase();
        if (C2 === 'ACCT_STATUS') return acctPill(v);
        if (isAmt(c) && v !== '' && v != null && !isNaN(+v)) return '<span class="' + (+v < 0 ? 'badc' : '') + '">' + money(+v) + '</span>';
        var lk = E.cellLink(c, r);
        if (lk && lk.open) return '<a data-act="wbDOpen" data-f="' + fid + '" data-p="' + esc(pid) + '" data-r="' + i + '" data-c="' + esc(c) + '">' + esc(v) + '</a> <button class="lnk" data-act="wbDFusion" data-f="' + fid + '" data-p="' + esc(pid) + '" data-r="' + i + '" data-c="' + esc(c) + '" title="Open in Oracle Fusion"><i class="fas fa-arrow-up-right-from-square"></i></button>';
        if (lk && lk.customer) return '<a data-act="wbCust" data-acct="' + esc(v) + '">' + esc(v) + '</a>';
        return esc(v == null ? '' : v);
    }

    // ── actions ──
    var ACT = A.ACT;
    function rowAt(d) { var f = W.stack[+d.f]; return f && f.view ? f.view[+d.r] : null; }
    function dRowAt(d) { var f = W.stack[+d.f]; return f && f.parts[d.p] && f.parts[d.p].rows ? f.parts[d.p].rows[+d.r] : null; }
    ACT.wbClose = W.close;
    ACT.wbBack = W.back;
    ACT.wbTo = function (d) { W.stack = W.stack.slice(0, +d.i + 1); paint(); };
    ACT.wbRow = function (d) { var r = top().view[+d.r]; var dr = r && E.rowDrill(r); if (dr) W.drill(dr, r); };
    ACT.wbOpen = function (d) { var r = rowAt(d), lk = r && E.cellLink(d.c, r); if (lk && lk.open) W.drill(lk.open, r); };
    ACT.wbFusion = function (d) { var r = rowAt(d), lk = r && E.cellLink(d.c, r); if (lk) W.openFusion(lk.fusion, { id: lk.id, number: lk.number }); };
    ACT.wbDOpen = function (d) { var r = dRowAt(d), lk = r && E.cellLink(d.c, r); if (lk && lk.open) W.drill(lk.open, null); };
    ACT.wbDFusion = function (d) { var r = dRowAt(d), lk = r && E.cellLink(d.c, r); if (lk) W.openFusion(lk.fusion, { id: lk.id, number: lk.number }); };
    ACT.wbFusionDr = function () { var f = top(), v = f.dr.vars, k = f.dr.kind; W.openFusion(k, k === 'ORDER' ? { id: v.HEADER_ID, number: v.ORDER_NUMBER } : k === 'TRX' ? { id: v.TRX_ID, number: v.NUMBER } : { id: v.RECEIPT_ID, number: v.NUMBER }); };
    ACT.wbDrillFresh = function () { var f = top(); f.parts = {}; paint(); loadDrill(f, true); };
    ACT.wbCust = function (d) { var b = C.cy ? C.cy.BU_ID : P.buId; W.close(); A.open360(b, d.acct); };
    ACT.wbSort = function (d) { var f = top(); f.sort = f.sort && f.sort.c === d.c ? { c: d.c, dir: -f.sort.dir } : { c: d.c, dir: isAmt(d.c) ? -1 : 1 }; paint(); };
    ACT.wbChip = function (d) { var f = top(); f.chip = f.chip && f.chip.col === d.c && f.chip.val === d.v ? null : { col: d.c, val: d.v }; paintGrid(); document.querySelectorAll('#wb-sum .chip').forEach(function (b) { b.classList.toggle('on', !!f.chip && b.dataset.c === f.chip.col && b.dataset.v === f.chip.val); }); };
    ACT.wbClear = function () { var f = top(); f.filters = {}; f.chip = null; paint(); };
    ACT.wbVariant = function (d) { var f = top(); if (f.variant === d.v) return; f.variant = d.v; f.rows = null; f.filters = {}; f.chip = null; paint(); loadRows(f); };
    ACT.wbCsv = function () { var f = top(), rows = f.view || f.rows || []; if (!rows.length) return; var cols = f.cols; A.csv('check-' + f.id + (f.variant === 'all' ? '-all' : '') + '-' + C.cy.PERIOD + '.csv', cols.map(function (c) { return [c, label(c, f.def)]; }), rows); };
    function sqlPanel(f) {
        var sql = sqlOf(f); W._sql = sql;
        return '<div class="wb-sql"><div class="row"><b class="small"><i class="fas fa-code"></i> SQL · ' + esc(f.variant === 'all' ? 'every order of the month' : 'as the check ran') + '</b>' +
            (f.def && f.def.acct ? '<span class="small muted">+ the accounting status: XLA events by invoice id, 400 per query</span>' : '') + '<span class="sp"></span>' +
            '<button class="btn sm" data-act="wbCopySql"><i class="fas fa-copy"></i> Copy</button><button class="btn sm" data-act="wbToFsql"><i class="fas fa-database"></i> Open in Fusion SQL</button></div>' +
            '<pre class="sqlbox">' + esc(sql || '(not kept — Run again to record it)') + '</pre></div>';
    }
    ACT.wbSql = function () {
        var f = top(); if (!f) return;
        if (f.type !== 'check') { var p = (f.parts && Object.keys(f.parts).map(function (k) { return f.parts[k]; }).filter(function (x) { return x && x.sql; })[0]) || {}; W._sql = p.sql; return A.modal('<i class="fas fa-code"></i> SQL', '<pre class="sqlbox">' + esc(p.sql || '') + '</pre>', '<button class="btn" data-act="wbCopySql">Copy</button><span class="sp"></span><button class="btn" data-act="mclose">Close</button>', true); }
        f.showSql = !f.showSql; f.autoSql = false; paint();
        if (f.showSql && !sqlOf(f)) S.cycle.checkDetail(C.cy.CYCLE_ID, f.id).then(function (d) { if (d && d.sql) { f.sql = d.sql; paint(); } });
    };
    ACT.wbRetry = function () { var f = top(); if (f && f.variant === 'all') { f.rows = null; runVariant(f); } else ACT.wbRerun(); };
    ACT.wbToFsql = function () {
        var sql = W._sql || sqlOf(top() || {}); if (!sql) return;
        // Fusion SQL restores its editor from fusionSql.editor (JSON) on start; opened in its own tab
        try { localStorage.setItem('fusionSql.editor', JSON.stringify(String(sql))); localStorage.setItem('fusionSql.tab', JSON.stringify('builder')); } catch (e) { }
        copy(sql, 'Opening Fusion SQL with this query (also copied)');
        try { window.open('../fusionsql/index.html', '_blank'); } catch (e) { }
    };
    ACT.wbCopySql = function () { copy(W._sql, 'Copied'); };
    ACT.wbCopy = function (d) { var f = top(); copy((f.parts[d.p] || {}).sql, 'Copied'); };
    ACT.wbRerun = function () { var f = top(); DC.cycles.runOne(f.id).then(function () { var g = W.stack[0]; if (g && g.id === f.id) { g.rows = null; g.variant = 'check'; paint(); loadRows(g); } }); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('cy-wb') && $('cy-wb').classList.contains('on') && !document.querySelector('#modal.on')) { e.stopPropagation(); W.back(); } }, true);

    // ══ Setup › Database objects ══════════════════════════════════
    var DB = W.db = { objs: null, running: false, at: null };
    DC.dbCard = function () {
        if (!DB.objs && !DB.loading) { DB.loading = true; S.objects.status().then(function (o) { DB.objs = o; DB.at = new Date(); }, function (e) { DB.err = A.errText(e); }).then(function () { DB.loading = false; A.render(); }); }
        var o = DB.objs || [], miss = o.filter(function (x) { return !x.ok; }).length;
        var h = '<div class="card"><h2><i class="fas fa-database"></i> Database objects <span class="sp"></span>' + (DB.objs ? (miss ? pill(miss + ' missing', 'bad') : pill('<i class="fas fa-check"></i> all in place', 'ok')) : '') + '</h2>' +
            '<div class="small muted" style="margin-bottom:8px">Every table, column, index, procedure and REST endpoint this module needs, created in APEX through the app\'s execute API — nothing to run in SQL Developer for a new customer. <b>Create missing</b> only adds what is not there; nothing is dropped or emptied.</div>';
        if (DB.err) h += '<div class="note bad">' + esc(DB.err) + '</div>';
        if (!DB.objs) return h + (DB.loading ? '<div class="muted"><i class="fas fa-spinner fa-spin"></i> checking…</div>' : '') + '</div>';
        h += '<div class="tblw" style="max-height:360px"><table class="tbl"><thead><tr><th>Kind</th><th>Object</th><th>Status</th><th></th></tr></thead><tbody>' + o.map(function (x, i) {
            var st = x.state === 'running' ? '<i class="fas fa-spinner fa-spin"></i> creating…' : x.ok === true ? '<span class="okc"><i class="fas fa-circle-check"></i> ' + esc(x.detail || 'ok') + '</span>' : x.ok === null ? '<span class="warnc"><i class="fas fa-circle-question"></i> ' + esc(x.detail || '') + '</span>' : '<span class="badc"><i class="fas fa-circle-xmark"></i> ' + esc(x.detail || 'missing') + '</span>';
            return '<tr><td>' + pill(x.kind, 'muted') + '</td><td class="mono small">' + esc(x.name) + (x.help ? '<div class="muted" style="font-family:inherit">' + esc(x.help) + '</div>' : '') + '</td><td class="small">' + st + '</td><td class="r"><button class="btn sm" data-act="dbSql" data-i="' + i + '" title="The statement"><i class="fas fa-code"></i></button><button class="btn sm" data-act="dbOne" data-i="' + i + '"' + (DB.running ? ' disabled' : '') + ' title="Run this statement now">Run</button></td></tr>';
        }).join('') + '</tbody></table></div>' +
            '<div class="row" style="margin-top:10px"><button class="btn" data-act="dbCheck"' + (DB.running ? ' disabled' : '') + '><i class="fas fa-rotate"></i> Check</button><button class="btn pri" data-act="dbCreate"' + (DB.running || !miss ? ' disabled' : '') + '><i class="fas fa-hammer"></i> Create missing (' + miss + ')</button>' +
            '<button class="btn" data-act="dbCode"' + (DB.running ? ' disabled' : '') + ' title="Create or replace the two procedures and the REST endpoints again (after an upgrade)">Re-create procedures + endpoints</button><span class="sp"></span><span class="small muted">' + (DB.at ? 'checked ' + DB.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '') + '</span></div></div>';
        return h;
    };
    function dbRun(list, force) {
        if (DB.running) return;
        DB.running = true; A.render();
        S.objects.create(list, force, function () { A.render(); }).then(function () {
            return S.objects.status();
        }).then(function (o) {
            DB.objs = o.map(function (x) { var was = list.filter(function (y) { return y.name === x.name && y.state === 'failed'; })[0]; return was && !x.ok ? Object.assign(x, { detail: was.detail }) : x; });
            DB.at = new Date(); DB.running = false; P.linksOk = null; S.linksCheck().then(function (ok) { P.linksOk = ok; A.render(); });
            var bad = DB.objs.filter(function (x) { return x.ok === false; }).length;
            A.render(); A.toast(bad ? bad + ' object(s) could not be created — see the list' : 'Every database object is in place', bad ? 'bad' : 'ok', 7000);
        }).catch(function (e) { DB.running = false; A.render(); A.toast(A.errText(e), 'bad', 8000); });
    }
    ACT.dbCheck = function () { DB.objs = null; DB.err = null; A.render(); };
    ACT.dbCreate = function () { if (!confirm('Create the missing database objects in APEX now?')) return; dbRun(DB.objs, false); };
    ACT.dbCode = function () { if (!confirm('Create or replace the procedures WMS_DC_PX, WMS_DC_RESP and the dc/px, dc/resp REST endpoints?')) return; dbRun(DB.objs.filter(function (x) { return x.kind === 'PROCEDURE' || x.kind === 'ORDS'; }), true); };
    ACT.dbOne = function (d) { var x = DB.objs[+d.i]; if (x) dbRun([x], true); };
    ACT.dbSql = function (d) { var x = DB.objs[+d.i]; W._sql = x.sql; A.modal('<i class="fas fa-code"></i> ' + esc(x.kind + ' · ' + x.name), '<pre class="sqlbox">' + esc(x.sql) + '</pre>', '<button class="btn" data-act="wbCopySql">Copy</button><span class="sp"></span><button class="btn" data-act="mclose">Close</button>', true); };

    // ══ Setup › Fusion links ══════════════════════════════════════
    DC.linksCard = function () {
        if (!W.links) { W.loadLinks().then(A.render); return '<div class="card"><h2><i class="fas fa-arrow-up-right-from-square"></i> Fusion links</h2><div class="muted">loading…</div></div>'; }
        var l = W.links, base = l.base || {}, t = l.templates || {};
        var f = function (id, lab, v, ph) { return '<div class="field wide"><label>' + lab + '</label><input type="text" id="' + id + '" value="' + esc(v || '') + '" placeholder="' + esc(ph || '') + '"></div>'; };
        return '<div class="card"><h2><i class="fas fa-arrow-up-right-from-square"></i> Fusion links</h2><div class="small muted" style="margin-bottom:8px">The <i class="fas fa-arrow-up-right-from-square"></i> beside an order, transaction or receipt opens it in Oracle Fusion. Sales orders use Oracle\'s documented deep link (<span class="mono">objType=SALES_ORDER</span>). For transactions and receipts paste the link your pod uses, with <span class="mono">{BASE}</span> <span class="mono">{ID}</span> (customer_trx_id / cash_receipt_id) <span class="mono">{NUMBER}</span>; left empty, the number is copied and Fusion opens on its home page.</div>' +
            '<div class="form">' + f('lk-prod', 'PROD address', base.PROD, E.POD_BASE.PROD) + f('lk-test', 'TEST address', base.TEST, E.POD_BASE.TEST) + f('lk-trx', 'AR transaction link', t.TRX, '{BASE}/…{ID}') + f('lk-rcpt', 'Receipt link', t.RECEIPT, '{BASE}/…{ID}') + '</div>' +
            '<div class="row" style="margin-top:10px"><button class="btn sm pri" data-act="lkSave">Save</button><span class="small muted">Sales order: <span class="mono">' + esc(E.LINK_DEFAULTS.ORDER) + '</span></span></div></div>';
    };
    ACT.lkSave = function () {
        var v = { base: { PROD: $('lk-prod').value.trim(), TEST: $('lk-test').value.trim() }, templates: { TRX: $('lk-trx').value.trim(), RECEIPT: $('lk-rcpt').value.trim() } };
        var bad = [v.base.PROD, v.base.TEST].filter(function (x) { return x && !/^https:\/\//i.test(x); });
        if (bad.length) { A.toast('Addresses start with https://', 'warn'); return; }
        S.settings.save('LINKS', v).then(function () { W.links = v; A.render(); A.toast('Fusion links saved', 'ok'); }).catch(function (e) { A.toast(A.errText(e), 'bad'); });
    };
})();
