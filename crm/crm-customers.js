/* Customer CRM · the whole Fusion customer master kept on this PC (DuckDB w2_crm_customers) and in APEX (WMS_CRM_CUSTOMERS),
 * so finding a customer by name, account, phone or e-mail never waits for Fusion.
 *   Load all Fusion customers  = every HZ_CUST_ACCOUNTS row in keyset pages by CUST_ACCOUNT_ID (resumable after Stop)
 *   Sync changes               = only accounts / parties changed since the newest change kept
 *   Copy from APEX             = another PC already loaded them: APEX → this PC's DuckDB (automatic when this PC has none)
 * Every page goes to DuckDB at once and to APEX (MERGE, 40 rows a statement) while the next page is read. */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, esc = C.esc;
    function $(id) { return document.getElementById(id); }
    var PAGE = 1000;
    var cs = C.cs = { st: { local: null, apex: null, last: null }, run: null, cache: {}, hits: null, q: '' };
    function rkey() { return 'cs.resume.' + C.pod; }

    cs.status = function () {
        return Promise.all([S.duck.custStatus(C.pod).catch(function () { return null; }), S.customers.status(C.pod).catch(function () { return null; }), S.settings.get('CUST_SYNC_' + C.pod).catch(function () { return null; })]).then(function (r) {
            cs.st = { local: r[0], apex: r[1], last: r[2], duck: !!D.duck.on };
            paint();
            return cs.st;
        });
    };
    /** this PC has none but APEX has them → copy (no Fusion call) */
    cs.auto = function () {
        return cs.status().then(function (st) { if (st.duck && st.local && !st.local.n && st.apex && st.apex.n && !cs.run) return cs.fromApex(); });
    };

    function newRun(kind, label) { cs.run = { kind: kind, label: label, rows: 0, page: 0, apex: 0, t0: Date.now(), stop: false, step: 'starting…' }; paint(); return cs.run; }
    function endRun(r, msg, cls) { r.done = true; cs.run = null; C.toast(msg, cls || 'ok', 7000); cs.cache = {}; cs.status().then(function () { if (C.tab === 'customers' && C.cuLoad) C.cuLoad(); }); }

    cs.fromApex = function () {
        var r = newRun('apex', 'Copying the customers from APEX to this PC');
        r.step = 'reading APEX…'; paint();
        return S.customers.all(C.pod).then(function (rows) {
            r.total = rows.length; var i = 0;
            function next() {
                if (r.stop) return;
                if (i >= rows.length) return;
                var part = rows.slice(i, i + 2000); i += part.length;
                r.step = 'writing to this PC'; return S.duck.custPut(C.pod, part).then(function () { r.rows = i; paint(); return next(); });
            }
            return next().then(function () { endRun(r, r.stop ? 'Stopped — ' + r.rows + ' customers copied to this PC' : r.rows + ' customers copied from APEX to this PC'); });
        }).catch(function (e) { endRun(r, 'Copy from APEX: ' + C.errText(e), 'bad'); });
    };

    /** this PC's copy → APEX (another PC then gets them without Fusion); 1,000 at a time, every row upserted */
    cs.toApex = function () {
        if (cs.run) return;
        var r = newRun('push', 'Copying the customers of this PC to APEX'), off = 0;
        r.total = (cs.st.local || {}).n || 0;
        function next() {
            if (r.stop) return Promise.resolve();
            r.step = 'reading this PC'; paint();
            return S.duck.custChunk(C.pod, 1000, off).then(function (rows) {
                if (!rows.length) return;
                off += rows.length; r.step = 'writing APEX'; paint();
                return S.customers.merge(C.pod, rows.map(function (x) { return E.custRow(E.custMaster(x), C.pod); })).then(function (x) {
                    r.rows += x.done; r.apex += x.done; r.apexFailed = (r.apexFailed || 0) + x.failed; if (x.error) r.apexErr = x.error; paint();
                    if (rows.length === 1000) return next();
                });
            });
        }
        return next().then(function () { endRun(r, (r.stop ? 'Stopped — ' : '') + r.apex.toLocaleString() + ' customers copied to APEX' + (r.apexFailed ? ' · ' + r.apexFailed + ' refused (' + r.apexErr + ')' : ''), r.apexFailed ? 'warn' : 'ok'); },
            function (e) { endRun(r, 'Copy to APEX: ' + C.errText(e), 'bad'); });
    };
    C.ACT.csToApex = function () { cs.toApex(); };
    /** one page of the kept customers (all, or matching q): DuckDB, else APEX → {rows (index entries), total, src} */
    cs.page = function (q, size, offset) {
        q = String(q || '').trim();
        function out(x, src) {
            return { total: x.total, src: src, rows: x.rows.map(function (o) {
                if (!C.master[o.account_number]) C.master[o.account_number] = E.custMaster(o);
                if (o.dff_json && !C.master[o.account_number].DFF_JSON) C.master[o.account_number].DFF_JSON = o.dff_json;
                var m = E.dffUnpack(o.dff_json).m;
                return { bu: '', account: o.account_number, name: o.customer || o.account_name, phone: o.phone || '', email: o.email || '', phoneFrom: m.p || '', emailFrom: m.e || '', dff: o.dff_json || '', src: 'Fusion master', addr: o.bill_to_address, status: o.status };
            }) };
        }
        var duck = D.duck.on !== false ? S.duck.custPage(C.pod, q, size, offset) : Promise.resolve(null);
        return duck.then(function (x) {
            if (x && (x.total || D.duck.on)) return out(x, 'pc');
            return S.customers.page(C.pod, q, size, offset).then(function (y) { return out(y, 'apex'); });
        });
    };

    /** mode 'all' (from the start, or resume) | 'changes' */
    cs.load = function (mode, resume) {
        if (cs.run) return;
        if (!D.hasHost()) { C.toast('Open the CRM inside the app to read Fusion.', 'warn'); return; }
        var st = cs.st, since = null, lastId = 0;
        if (mode === 'changes') {
            since = [st.local && st.local.maxChanged, st.apex && st.apex.maxChanged].filter(Boolean).sort().pop() || null;
            if (!since) mode = 'all';
        }
        if (mode === 'all' && resume) { var rz = C.ls(rkey(), null); if (rz && rz.lastId) lastId = rz.lastId; }
        var r = newRun(mode, mode === 'changes' ? 'Reading customers changed since ' + since : 'Loading every Fusion customer' + (lastId ? ' (continuing)' : ''));
        r.since = since; r.lastId = lastId; r.alt = 0; r.apexFailed = 0;
        var apexP = Promise.resolve(), spec = null;
        function page() {
            if (r.stop) return Promise.resolve();
            r.step = 'reading page ' + (r.page + 1) + ' from Fusion'; paint();
            var list = E.sql.customersPage(r.lastId, r.since, PAGE, spec).slice(r.alt);
            return C.fusionFirst(list, PAGE + 10, 300000).then(function (res) {
                r.alt += list.indexOf(res.sql);
                r.sql = res.sql;
                var rows = res.rows.map(function (x) { return E.custRow(x, C.pod, spec); }).filter(function (x) { return x.account_number; });
                if (r.page === 0) r.dff = /dff_/.test(res.sql) ? (/dff_o_/.test(res.sql) ? 'account, party + organization DFFs' : /dff_p_/.test(res.sql) ? 'account + party DFFs' : 'account DFFs') : spec ? 'no DFFs (the pod refused them)' : 'no DFFs';
                r.page++; r.rows += rows.length;
                res.rows.forEach(function (x) { var id = +x.CUST_ACCOUNT_ID; if (id > r.lastId) r.lastId = id; });
                if (mode === 'all') C.lsSet(rkey(), { lastId: r.lastId, rows: r.rows, at: S.now() });
                r.step = 'saving page ' + r.page; paint();
                var duckP = rows.length ? S.duck.custPut(C.pod, rows) : Promise.resolve();
                // APEX: one page at a time behind the Fusion reads
                apexP = apexP.then(function () { if (!rows.length) return; return S.customers.merge(C.pod, rows).then(function (x) { r.apex += x.done; r.apexFailed = (r.apexFailed || 0) + x.failed; if (x.error) r.apexErr = x.error; paint(); }); }).catch(function (e) { r.apexErr = C.errText(e); paint(); });
                return duckP.then(function () { if (res.rows.length >= PAGE) return page(); });
            });
        }
        r.step = 'reading the DFF labels'; paint();
        return cs.dffSpec().then(function (x) { spec = x && x.spec; }, function () { spec = null; }).then(page).then(function () { r.step = 'finishing the APEX copy…'; paint(); return apexP; }).then(function () {
            if (!r.stop && mode === 'all') C.lsSet(rkey(), null);
            var info = { at: S.now(), by: D.user(), mode: mode, rows: r.rows, dff: r.dff || '', pages: r.page, secs: Math.round((Date.now() - r.t0) / 1000), since: r.since, stopped: r.stop, apexCopied: r.apex, apexFailed: r.apexFailed || 0, apexError: r.apexErr || null };
            return S.settings.save('CUST_SYNC_' + C.pod, info).catch(function () { }).then(function () {
                endRun(r, (r.stop ? 'Stopped — ' : '') + r.rows + ' customers ' + (mode === 'changes' ? 'changed since ' + since + ' ' : '') + 'read from Fusion · kept on this PC' + (r.apexFailed ? ' · ' + r.apexFailed + ' not copied to APEX (' + r.apexErr + ')' : ' and in APEX'), r.apexFailed ? 'warn' : 'ok');
            });
        }, function (e) {
            r.err = e;
            endRun(r, 'Fusion customers: ' + C.errText(e) + (r.rows ? ' — ' + r.rows + ' kept; Load all continues from there' : ''), 'bad');
            cs.lastErr = { msg: C.errText(e), sql: e && e.sql || '', tried: e && e.tried || [] };
            paint();
        });
    };
    C.ACT.csLoad = function (el) { cs.lastErr = null; cs.load(el.dataset.mode, el.dataset.resume === '1'); };
    C.ACT.csApex = function () { cs.fromApex(); };
    C.ACT.csStop = function () { if (cs.run) { cs.run.stop = true; cs.run.step = 'stopping after this page…'; paint(); } };
    C.ACT.csErrSql = function () {
        var x = cs.lastErr || {};
        C.modal('<i class="fas fa-code"></i> Customer load · the SQL that failed', '<div class="note bad">' + esc(x.msg) + '</div><pre class="code">' + esc(x.sql) + '</pre>' +
            (x.tried && x.tried.length > 1 ? x.tried.map(function (t, i) { return '<div class="small"><b>' + (i + 1) + '.</b> <span class="badc">' + esc(t.error) + '</span></div><pre class="code sm">' + esc(t.sql) + '</pre>'; }).join('') : ''), '<button class="btn" data-act="mclose">Close</button>', true);
    };

    /** the kept customers matching q: DuckDB, else APEX → index entries; hits also become C.master rows (names in the 360) */
    cs.search = function (q, max) {
        q = String(q || '').trim(); if (q.length < 2) return Promise.resolve([]);
        var k = q.toLowerCase() + '|' + (max || 100);
        if (cs.cache[k]) return Promise.resolve(cs.cache[k]);
        var p = D.duck.on !== false ? S.duck.custSearch(C.pod, q, max || 100) : Promise.resolve([]);
        return p.then(function (rows) {
            if (rows.length || D.duck.on) return rows;
            return cs.st.apex && cs.st.apex.n ? S.customers.search(C.pod, q, max || 100) : [];
        }).then(function (rows) {
            var out = rows.map(function (x) {
                if (!C.master[x.account_number]) C.master[x.account_number] = E.custMaster(x);
                return { bu: '', account: x.account_number, name: x.customer || x.account_name, phone: x.phone || '', email: x.email || '', src: 'Fusion master', addr: x.bill_to_address, status: x.status };
            });
            cs.cache[k] = out; return out;
        }, function () { return []; });
    };

    // ── DFFs: the labels (per pod, shared in APEX), one account read again, the dialog ──
    cs.dff = {};
    /** the DFF segments of the customer tables → {spec, at, n, sql, error}; memory, else APEX settings CUST_DFF_<pod>, else Fusion */
    cs.dffSpec = function (force) {
        var pod = C.pod;
        if (!force && cs.dff[pod]) return Promise.resolve(cs.dff[pod]);
        var p = force ? Promise.resolve(null) : S.settings.get('CUST_DFF_' + pod).catch(function () { return null; });
        return p.then(function (saved) {
            if (saved && saved.spec) return (cs.dff[pod] = saved);
            if (!D.hasHost()) return null;
            return C.fusionFirst(E.sql.dffLabels(), 5000).then(function (res) {
                var spec = E.dffSpec(res.rows), x = { spec: spec, at: S.now(), by: D.user(), sql: res.sql, n: res.rows.length };
                cs.dff[pod] = x;
                return S.settings.save('CUST_DFF_' + pod, x).catch(function () { }).then(function () { return x; });
            }, function (e) { var x = { spec: null, at: S.now(), error: C.errText(e), sql: e && e.sql || '' }; cs.dff[pod] = x; return x; });
        });
    };
    /** read these accounts again from Fusion with their DFFs → kept on this PC + APEX → the kept rows */
    cs.readAccounts = function (accounts) {
        accounts = (accounts || []).filter(Boolean).slice(0, 200);
        if (!accounts.length || !D.hasHost()) return Promise.resolve([]);
        return cs.dffSpec().then(function (x) {
            var spec = x && x.spec;
            return C.fusionFirst(E.sql.customersPage(0, null, accounts.length + 5, spec, accounts), accounts.length + 10).then(function (res) {
                var rows = res.rows.map(function (r) { return E.custRow(r, C.pod, spec); }).filter(function (o) { return o.account_number; });
                // the DFFs always; other fields only where the master shown has none (the 360's live read wins)
                rows.forEach(function (o) {
                    var cur = C.master[o.account_number] || {}, km = E.custMaster(o), m = Object.assign({}, cur);
                    Object.keys(km).forEach(function (k) { if (m[k] == null || m[k] === '') m[k] = km[k]; });
                    m.DFF_JSON = o.dff_json || cur.DFF_JSON || '';
                    C.master[o.account_number] = m;
                });
                cs.cache = {};
                return Promise.all([S.duck.custPut(C.pod, rows), S.customers.merge(C.pod, rows).catch(function () { })]).then(function () { return rows; });
            });
        });
    };
    /** the DFF values as label / value tables per level */
    C.dffHtml = function (packed, empty) {
        var x = E.dffUnpack(packed), by = { A: [], P: [], O: [] };
        x.f.forEach(function (v) { (by[v.t] || (by[v.t] = [])).push(v); });
        var h = Object.keys(E.DFF_TABLES).filter(function (k) { return by[k] && by[k].length; }).map(function (k) {
            var ctx = by[k].filter(function (v) { return v.col === 'ATTRIBUTE_CATEGORY'; })[0];
            return '<h3 style="margin:12px 0 6px">' + esc(E.DFF_TABLES[k].label) + ' DFF <span class="small muted">' + esc(E.DFF_TABLES[k].table) + (ctx ? ' · context ' + esc(ctx.value) : '') + '</span></h3>' +
                '<div class="kv dff">' + by[k].filter(function (v) { return v.col !== 'ATTRIBUTE_CATEGORY'; }).map(function (v) {
                    var hit = (x.m.e && v.label === x.m.e) || (x.m.p && v.label === x.m.p);
                    return '<div class="k" title="' + esc(v.col + (v.ctx ? ' · ' + v.ctx : '')) + '">' + esc(v.label) + '</div><div class="v">' + esc(v.value) + (hit ? ' ' + C.pill('used as ' + (v.label === x.m.e ? 'e-mail' : 'phone'), 'info') : '') + '</div>';
                }).join('') + '</div>';
        }).join('');
        return h ? h + (x.cut ? '<div class="small muted">' + x.cut + ' more values did not fit.</div>' : '') : '<div class="empty">' + esc(empty || 'No DFF values kept for this customer.') + '</div>';
    };
    var dffBusy = {};
    C.ACT.cuDff = function (el) {
        var acct = el.dataset.acct, m = C.master[acct] || {};
        function body() {
            var mm = C.master[acct] || {}, st = cs.dff[C.pod] || {};
            return '<div class="kv"><div class="k">E-mail</div><div class="v">' + esc(mm.EMAIL || '—') + '</div><div class="k">Phone</div><div class="v">' + esc(mm.PHONE || '—') + '</div></div>' +
                (dffBusy[acct] ? '<div class="small" style="margin-top:8px"><span class="spin"></span> reading Fusion…</div>' : '') +
                C.dffHtml(mm.DFF_JSON, 'No DFF values kept for this customer yet — Read from Fusion.') +
                '<div class="small muted" style="margin-top:10px">' + (st.error ? '<span class="badc">DFF labels: ' + esc(st.error) + '</span>' : st.at ? 'DFF labels read ' + C.when(st.at) + (st.n != null ? ' · ' + st.n + ' segments' : '') : '') + '</div>';
        }
        function paintIt() { var box = $('mbox'), b = box && box.dataset.dff === acct ? box.querySelector('.mb') : null; if (b) b.innerHTML = body(); }
        var box = C.modal('<i class="fas fa-tags"></i> DFFs · ' + esc(m.CUSTOMER || acct) + ' <span class="small muted">' + esc(acct) + '</span>', body(),
            '<button class="btn" data-act="cuDffLabels" title="Read the DFF segment names again from Fusion"><i class="fas fa-tags"></i> Labels again</button><span class="sp"></span>' +
            '<button class="btn" data-act="cuDffRead" data-acct="' + esc(acct) + '"><i class="fas fa-cloud-arrow-down"></i> Read from Fusion</button><button class="btn" data-act="mclose">Close</button>', true);
        box.dataset.dff = acct;
        C.ACT.cuDffRead = function () {
            dffBusy[acct] = true; paintIt();
            cs.readAccounts([acct]).then(function (rows) { if (!rows.length) C.toast('Fusion did not return ' + acct, 'warn'); }, function (e) { C.toast('Fusion: ' + C.errText(e), 'bad', 7000); })
                .then(function () { dffBusy[acct] = false; paintIt(); if (C.tab === 'customers' && C.cuLoad) C.cuLoad(); if (C.tab === 'c360') C.render(); });
        };
        C.ACT.cuDffLabels = function () { cs.dffSpec(true).then(function (x) { C.toast(x && x.spec ? 'DFF labels read again (' + x.n + ' segments) — Read from Fusion or Reload all to use them' : 'DFF labels: ' + (x && x.error || 'not readable'), x && x.spec ? 'ok' : 'warn', 7000); paintIt(); }); };
        if (!m.DFF_JSON && D.hasHost() && !dffBusy[acct]) C.ACT.cuDffRead();
    };

    /** the bar on top of the Customers tab */
    cs.bar = function () {
        var st = cs.st, r = cs.run, lo = st.local, ap = st.apex, last = st.last, rz = C.ls(rkey(), null);
        var h = '<div class="card" id="cs-bar">';
        h += '<div class="cs-bar"><i class="fas fa-users" style="font-size:20px;color:#4338ca"></i>' +
            '<div class="st"><b>' + (lo ? lo.n.toLocaleString() : st.duck === false ? '—' : '…') + '</b>on this PC' + (st.duck === false ? ' (no DuckDB)' : '') + '</div>' +
            '<div class="st"><b>' + (ap ? ap.n.toLocaleString() : '…') + '</b>in APEX</div>' +
            '<div class="st">' + (last ? (last.mode === 'changes' ? 'last sync of changes ' : 'last full load ') + C.when(last.at) + ' by ' + esc(last.by || '') + ' · ' + (last.rows || 0).toLocaleString() + ' rows' + (last.stopped ? ' (stopped)' : '') + (last.apexFailed ? ' · <span class="warnc" title="' + esc(last.apexError || '') + '">' + last.apexFailed + ' not in APEX</span>' : '') : 'Fusion customers not loaded yet') +
            (lo && lo.maxChanged ? '<br>newest change kept ' + esc(lo.maxChanged) : '') + '</div><span class="sp"></span>';
        if (r) h += '<button class="btn bad" data-act="csStop"' + (r.kind === 'apex' && false ? ' disabled' : '') + '><i class="fas fa-stop"></i> Stop</button>';
        else {
            var any = (lo && lo.n) || (ap && ap.n);
            if (st.duck && lo && ap && ap.n > lo.n) h += '<button class="btn" data-act="csApex" title="No Fusion call"><i class="fas fa-download"></i> Copy ' + (ap.n - lo.n).toLocaleString() + ' from APEX</button>';
            if (st.duck && lo && ap && lo.n > ap.n) h += '<button class="btn" data-act="csToApex" title="So other PCs get them without Fusion"><i class="fas fa-upload"></i> Copy ' + (lo.n - ap.n).toLocaleString() + ' to APEX</button>';
            if (any) h += '<button class="btn pri" data-act="csLoad" data-mode="changes"><i class="fas fa-rotate"></i> Sync changes</button>';
            if (rz && rz.lastId) h += '<button class="btn" data-act="csLoad" data-mode="all" data-resume="1" title="From customer id ' + esc(rz.lastId) + '"><i class="fas fa-forward"></i> Continue the load (' + (rz.rows || 0).toLocaleString() + ' done)</button>';
            h += '<button class="btn ' + (any ? '' : 'pri') + '" data-act="csLoad" data-mode="all"><i class="fas fa-cloud-arrow-down"></i> ' + (any ? 'Reload all' : 'Load all Fusion customers') + '</button>';
        }
        h += '</div>';
        if (r) {
            var secs = Math.round((Date.now() - r.t0) / 1000), pct = r.total ? Math.round(r.rows / r.total * 100) : null;
            h += '<div class="small" style="margin-top:8px"><span class="spin"></span> ' + esc(r.label) + ' · ' + esc(r.step) + ' · <b>' + r.rows.toLocaleString() + '</b> customers' + (r.kind !== 'apex' && r.kind !== 'push' ? ' · ' + r.apex.toLocaleString() + ' in APEX' : '') + (r.total ? ' of ' + r.total.toLocaleString() : '') + ' · ' + secs + ' s' +
                (r.apexFailed ? ' · <span class="badc" title="' + esc(r.apexErr || '') + '">' + r.apexFailed + ' refused by APEX</span>' : '') + '</div><div class="cs-prog"><div style="width:' + (pct != null ? pct : Math.min(95, 5 + r.page * 4)) + '%"></div></div>';
        } else if (cs.lastErr) h += '<div class="note bad" style="margin-top:8px">' + esc(cs.lastErr.msg) + ' · <a data-act="csErrSql">Show the SQL</a></div>';
        else if (lo && lo.n && lo.nd === 0) h += '<div class="note" style="margin-top:8px"><i class="fas fa-tags"></i> The customers on this PC were loaded without their DFFs (e-mail / phone kept in the account DFF, grading, BRN, VAT …). <b>Reload all</b> once to bring the account, party and organization DFFs.</div>';
        if (last && last.dff && !r) h += '<div class="small muted" style="margin-top:4px">Last load read ' + esc(last.dff) + '.</div>';
        return h + '</div>';
    };
    function paint() { var el = $('cs-bar'); if (el && C.tab === 'customers') el.outerHTML = cs.bar(); }
    setInterval(function () { if (cs.run) paint(); }, 1000);
})();
