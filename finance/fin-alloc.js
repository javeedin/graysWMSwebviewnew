/* Finance Lens — Cost allocation (tab `alloc`, FL.alloc = AL; engine finance/fin-alloc-engine.js FALLOC).
   Allocation sets live in {root}\alloc.json (finDocGet / finDocSave name `alloc`): ordered rules, each made in three steps —
   ① source accounts (ticked account codes, optionally only some values of a dimension, % of the balance), ② allocation (receivers on
   a dimension or your own list, by percentages / equally / revenue / a number per receiver), ③ result (per account: source balance =
   total allocated, per receiver, journal lines). A rule's numbers are kept as driver table `d_<rule id>`.
   Data: income statement rows of the chosen periods from fin_balances (company × cost centre × account) or, per ledger, from the
   extended segments (fin_gl_ext_v: company × account × every synced segment). Nothing is posted to Fusion: the result is a view
   (before / after per receiver, flows, steps, journal lines to export). The Copilot can propose rules (```alloc block, preview, Apply). */
(function () {
    'use strict';
    var A = window.FALLOC; if (!A) return;
    var esc = window.esc;
    var AL = FL.alloc = { doc: null, st: FL.ls('alloc', {}), rows: null, res: null, fields: [], names: {}, busy: false };
    var money = function (v) { return v == null || isNaN(v) ? '' : FL.num(v); };
    var pct = function (v) { return v == null || isNaN(v) ? '' : v.toFixed(1) + '%'; };
    var save = function () { FL.lsSet('alloc', AL.st); };
    var clone = function (o) { return JSON.parse(JSON.stringify(o)); };


    // ── document ──
    AL.load = function () {
        if (AL.doc) return Promise.resolve(AL.doc);
        return FL.call('finDocGet', { name: 'alloc' }).then(function (r) { try { AL.doc = JSON.parse(r.json || '{}'); } catch (e) { AL.doc = {}; } })
            .catch(function () { AL.doc = {}; }).then(function () {
                AL.doc.models = AL.doc.models || []; AL.doc.runs = AL.doc.runs || [];
                if (!AL.doc.models.length) AL.doc.models.push(AL.newModel('Monthly overheads'));
                return AL.doc;
            });
    };
    AL.store = function () { return FL.call('finDocSave', { name: 'alloc', json: JSON.stringify(AL.doc, null, 1) }).then(function () { AL.dirty = false; }); };
    AL.newModel = function (name) { return { id: A.uid('m'), name: name, source: '', rules: [], drivers: [], virtual: [], created: new Date().toISOString(), owner: (FL.who || {}).user || '' }; };
    AL.model = function () { var ms = AL.doc.models, m = ms.filter(function (x) { return x.id === AL.st.model; })[0] || ms[0]; AL.st.model = m.id; return m; };
    AL.ensureVirtual = function (id, name, values) {
        var m = AL.model(); if ((m.virtual || []).some(function (v) { return v.id === id; })) return;
        (m.virtual = m.virtual || []).push({ id: id, name: name, values: values.slice() });
    };
    AL.mainField = function () { var m = AL.model(); return m.source === 'cc' ? 'cc' : (AL.fields.filter(function (f) { return /^segment/.test(f.id); })[0] || { id: 'company' }).id; };

    // ── data ──
    AL.meta = function () {
        var m = AL.model();
        return FL.rows("SELECT e.ledger_id, ANY_VALUE(l.name) AS name, ANY_VALUE(l.coa_id) AS coa_id, ANY_VALUE(l.company_segment) AS cseg, ANY_VALUE(l.account_segment) AS aseg FROM fin_gl_ext_v e LEFT JOIN fin_tb_ledgers l ON l.ledger_id = e.ledger_id AND l.pod = e.pod GROUP BY 1 ORDER BY 2", 100)
            .catch(function () { return []; }).then(function (leds) {
                AL.leds = leds;
                // a new model starts on the extended segments when the balances carry no real cost centre (trial balance synced by account)
                if (!m.source) {
                    var realCc = (FL.dims.ccs || []).some(function (c) { return c.code && !/^[-\s0]*$/.test(c.code); });
                    m.source = !realCc && leds.length ? 'seg' : 'cc';
                }
                return AL.meta2();
            });
    };
    AL.meta2 = function () {
        var m = AL.model();
        if (m.source === 'cc') {
            AL.fields = [{ id: 'company', name: 'Company' }, { id: 'cc', name: 'Cost centre' }];
            AL.periods = (FL.dims.periods || []).map(function (p) { return { seq: +p.period_seq, name: p.period_name }; });
            AL.names = { company: {}, cc: {} };
            (FL.dims.companies || []).forEach(function (c) { AL.names.company[c.code] = c.name; });
            (FL.dims.ccs || []).forEach(function (c) { AL.names.cc[c.code] = c.name; });
            return Promise.resolve();
        }
        return Promise.resolve(AL.leds || []).then(function (leds) {
                if (!leds.length) { AL.fields = [{ id: 'company', name: 'Company' }]; AL.periods = []; return; }
                var L = leds.filter(function (l) { return String(l.ledger_id) === String(m.ledger); })[0] || leds[0]; m.ledger = L.ledger_id; AL.led = L;
                var w = ' WHERE ledger_id = ' + (+L.ledger_id);
                return Promise.all([
                    FL.rows("SELECT period_seq, MIN(CASE WHEN NOT adj THEN period_name END) AS name FROM fin_gl_ext_v" + w + " AND period_seq IS NOT NULL GROUP BY 1 ORDER BY 1", 1000),
                    FL.rows("SELECT DISTINCT segments FROM fin_gl_balances_ext_sync" + w, 1000),
                    FL.rows("SELECT lower(column_name) AS col, ANY_VALUE(segment_name) AS name FROM fin_coa_segments WHERE coa_id = " + FL.q(L.coa_id || '') + " GROUP BY 1", 100).catch(function () { return []; }),
                    FL.rows("SELECT lower(column_name) AS col, value, ANY_VALUE(description) AS d FROM fin_segment_values WHERE coa_id = " + FL.q(L.coa_id || '') + " GROUP BY 1, 2", 200000).catch(function () { return []; }),
                    FL.rows("SELECT DISTINCT company FROM fin_gl_ext_v" + w + " ORDER BY 1", 5000).catch(function () { return []; })
                ]).then(function (r) {
                    AL.ledCos = (r[4] || []).map(function (x) { return String(x.company); });
                    AL.periods = r[0].map(function (p) { return { seq: +p.period_seq, name: p.name || String(p.period_seq) }; });
                    var cols = {}; r[1].forEach(function (x) { String(x.segments || '').split(',').forEach(function (c) { if (/^segment\d+$/i.test(c)) cols[c.toLowerCase()] = 1; }); });
                    var cseg = String(L.cseg || '').toLowerCase(), aseg = String(L.aseg || '').toLowerCase(), nm = {};
                    r[2].forEach(function (x) { if (x.name) nm[x.col] = x.name; });
                    var G = FL.segpl; if (G && G.segName) Object.keys(G.segName).forEach(function (k) { if (!nm[k]) nm[k] = G.segName[k]; });
                    AL.segs = Object.keys(cols).filter(function (c) { return c !== cseg && c !== aseg; }).sort(function (a, b) { return +a.slice(7) - +b.slice(7); });
                    AL.fields = [{ id: 'company', name: 'Company' }].concat(AL.segs.map(function (c) { return { id: c, name: nm[c] || c.toUpperCase() }; }));
                    AL.names = { company: {} };
                    (FL.dims.companies || []).forEach(function (c) { AL.names.company[c.code] = c.name; });
                    r[3].forEach(function (x) { (AL.names[x.col] = AL.names[x.col] || {})[x.value] = x.d; });
                });
            });
    };
    AL.allFields = function () { return AL.fields.concat((AL.model().virtual || []).map(function (v) { return { id: v.id, name: v.name || v.id, virtual: true }; })); };
    AL.label = function (f) { var x = AL.allFields().filter(function (y) { return y.id === f; })[0]; return x ? x.name : f; };
    AL.vname = function (f, v) { var n = (AL.names[f] || {})[v]; return v === '' ? '(blank)' : n && n !== v ? v + ' ' + n : v; };
    AL.defPeriods = function () { var p = AL.periods || [], cur = FL.currentPeriod ? FL.currentPeriod() : null; return p.some(function (x) { return x.seq === cur; }) ? [cur] : p.length ? [p[p.length - 1].seq] : []; };
    AL.loadRows = function () {
        var m = AL.model(), per = (AL.st.periods || []).filter(function (q) { return (AL.periods || []).some(function (p) { return p.seq === q; }); });
        if (!per.length) per = AL.st.periods = AL.defPeriods();
        if (!per.length) return Promise.resolve([]);
        var types = {}; (FL.dims.accounts || []).forEach(function (a) { types[a.code] = a.account_type; });
        var tp = function (code, t) { return t || types[code] || (FINE.guessType ? FINE.guessType({ code: code, name: '' }) : 'E'); };
        if (m.source === 'cc') {
            var w = ["scenario = 'ACTUAL'", 'period_seq IN (' + per.join(',') + ')'].concat(FL.where('', { noCc: true }));
            return FL.rows('SELECT company, cost_centre AS cc, account, SUM(period_net) AS amount FROM fin_balances WHERE ' + w.join(' AND ') + ' GROUP BY 1, 2, 3 HAVING ABS(SUM(period_net)) > 0.005', 400000)
                .then(function (rows) {
                    return rows.map(function (r) { return { company: r.company, account: String(r.account), type: tp(String(r.account)), dims: { cc: r.cc == null ? '' : String(r.cc) }, amount: +r.amount }; })
                        .filter(function (r) { return r.type === 'R' || r.type === 'E'; });
                });
        }
        if (!AL.led) return Promise.resolve([]);
        var segs = AL.segs || [], co = FL.filter.company, coSql = '', nz = function (x) { return String(x).replace(/^0+(?=.)/, ''); };
        AL.coNote = '';
        if (co) {
            var hit = (AL.ledCos || []).filter(function (c) { return nz(c) === nz(co); })[0];
            if (hit != null) coSql = ' AND company = ' + FL.q(hit);
            else AL.coNote = 'The header company ' + co + ' is not in the ledger ' + (AL.led.name || AL.led.ledger_id) + ' (its companies: ' + ((AL.ledCos || []).slice(0, 8).join(', ') || 'none') + ') — showing all of them.';
        }
        return FL.rows('SELECT company, account, ANY_VALUE(account_type) AS t' + segs.map(function (c) { return ', ' + c; }).join('') + ', SUM(dr - cr) AS amount FROM fin_gl_ext_v WHERE ledger_id = ' + (+AL.led.ledger_id) +
            ' AND period_seq IN (' + per.join(',') + ") AND COALESCE(account_type, 'E') IN ('R', 'E')" + coSql +
            ' GROUP BY company, account' + segs.map(function (c) { return ', ' + c; }).join('') + ' HAVING ABS(SUM(dr - cr)) > 0.005', 400000).then(function (rows) {
                return rows.map(function (r) { var d = {}; segs.forEach(function (c) { d[c] = r[c] == null ? '' : String(r[c]); }); return { company: r.company, account: String(r.account), type: tp(String(r.account), r.t), dims: d, amount: +r.amount }; })
                    .filter(function (r) { return r.type === 'R' || r.type === 'E'; });
            });
    };
    /** Values of a field with their expense / revenue on the loaded data (pickers, drivers, Copilot) */
    AL.values = function (f) {
        var by = {}, m = AL.model();
        (AL.rows || []).forEach(function (r) { var v = f === 'company' ? r.company : (r.dims[f] == null ? '' : r.dims[f]); var o = by[v] = by[v] || { value: v, cost: 0, rev: 0 }; if (r.type === 'R') o.rev -= r.amount; else o.cost += r.amount; });
        (m.virtual || []).filter(function (x) { return x.id === f; }).forEach(function (x) { (x.values || []).forEach(function (v) { by[v] = by[v] || { value: v, cost: 0, rev: 0 }; }); });
        (m.drivers || []).filter(function (d) { return d.field === f; }).forEach(function (d) { Object.keys(d.values || {}).forEach(function (v) { by[v] = by[v] || { value: v, cost: 0, rev: 0 }; }); });
        return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return Math.abs(b.cost) + Math.abs(b.rev) - Math.abs(a.cost) - Math.abs(a.rev) || String(a.value).localeCompare(String(b.value)); });
    };

    AL.run = function () {
        if (!AL.rows) return;
        try { AL.res = A.run(AL.model(), AL.rows, FL.dims.accounts || []); AL.err = null; } catch (e) { AL.res = null; AL.err = String(e && e.message || e); }
    };

    // ── page: rules on the left; each rule is three steps — ① source accounts, ② allocation, ③ result (allocated = source) ──
    FL.TABS.alloc = {
        render: function (el) {
            AL.el = el;
            if (!(FL.status && FL.status.loaded)) { el.innerHTML = '<div class="empty">Load or sync data first (Data › Trial balance sync).</div>'; return; }
            el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading the allocation rules…</div>';
            return AL.load().then(AL.meta).then(function () { return AL.loadRows(); }).then(function (rows) { AL.rows = rows; AL.run(); AL.paint(); })
                .catch(function (e) { el.innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
        }
    };
    AL.reload = function () { AL.loadRows().then(function (rows) { AL.rows = rows; AL.run(); AL.paint(); }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); }); };
    AL.changed = function (keepPanel) { AL.dirty = true; AL.run(); AL.paintList(); if (!keepPanel) AL.paintMain(); else AL.paintTotals(); var b = $('al-save'); if (b) b.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save *'; };
    AL.rule = function () { var m = AL.model(); return (m.rules || []).filter(function (r) { return r.id === AL.st.sel; })[0] || null; };
    AL.ruleIx = function (r) { return (AL.model().rules || []).indexOf(r); };
    /** Rows as the rule sees them: the data after the rules before it (what they moved is included) */
    AL.before = function (r) {
        var m = AL.model(), i = AL.ruleIx(r);
        if (i <= 0) return (AL.rows || []).map(function (x) { return x; });
        var tmp = clone(m); tmp.rules = m.rules.slice(0, i);
        return A.run(tmp, AL.rows || [], FL.dims.accounts || []).work;
    };
    AL.step = function (r) { return AL.res ? AL.res.steps.filter(function (s) { return s.rule === r.id; })[0] : null; };
    AL.accName = function (c) { var a = (FL.dims.accounts || []).filter(function (x) { return x.code === c; })[0]; return a ? a.name || '' : ''; };
    AL.norm = function (r) {
        r.pool = r.pool || {}; r.pool.where = r.pool.where || {}; r.to = r.to || { field: AL.mainField(), method: 'fixed', targets: [] };
        if (!Array.isArray(r.pool.accounts)) {
            var have = {}; (AL.rows || []).forEach(function (x) { have[x.account] = 1; });
            r.pool.accounts = r.pool.accounts ? FINE.matchAccounts(r.pool.accounts, (FL.dims.accounts || []).filter(function (a) { return have[a.code]; })) : [];
        }
        if (r.to.method === 'cost') r.to.method = 'even';
        if (r.to.method === 'driver' && r.to.driver && r.to.driver !== 'd_' + r.id) {
            var m = AL.model(), d = (m.drivers || []).filter(function (x) { return x.id === r.to.driver; })[0];
            if (d) m.drivers.push({ id: 'd_' + r.id, name: d.name, unit: d.unit, field: d.field, values: clone(d.values || {}) });
            r.to.driver = 'd_' + r.id;
        }
        return r;
    };
    AL.newRule = function () {
        var m = AL.model(), r = { id: A.uid('r'), name: 'Rule ' + ((m.rules || []).length + 1), active: true, pool: { accounts: [], where: {} }, to: { field: AL.mainField(), method: 'fixed', targets: [] }, stepDown: true };
        (m.rules = m.rules || []).push(r); AL.st.sel = r.id; AL.st.step = 1; save(); AL.changed();
    };

    AL.paint = function () {
        var el = AL.el, m = AL.model(), per = AL.st.periods || [];
        var pname = function (q) { var p = (AL.periods || []).filter(function (x) { return x.seq === q; })[0]; return p ? p.name : q; };
        var srcSel = '<select id="al-src"><option value="cc"' + (m.source === 'cc' ? ' selected' : '') + '>Cost centres (trial balance)</option>' +
            (AL.leds || []).map(function (l) { return '<option value="seg:' + l.ledger_id + '"' + (m.source === 'seg' && String(m.ledger) === String(l.ledger_id) ? ' selected' : '') + '>Segments · ' + esc(l.name || l.ledger_id) + '</option>'; }).join('') + '</select>';
        var chips = (AL.periods || []).slice(-24).map(function (p) { return '<button class="chip' + (per.indexOf(p.seq) >= 0 ? ' on' : '') + '" data-p="' + p.seq + '">' + esc(p.name) + '</button>'; }).join('');
        el.innerHTML = '<div class="card al-top"><div class="row" style="gap:6px;flex-wrap:wrap">' +
            '<b><i class="fa-solid fa-share-nodes"></i> Allocation set</b><select id="al-model">' + AL.doc.models.map(function (x) { return '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
            '<button class="btn sm" id="al-new" title="New set"><i class="fa-solid fa-plus"></i></button><button class="btn sm" id="al-ren" title="Rename"><i class="fa-solid fa-pen"></i></button><button class="btn sm" id="al-del" title="Delete the set"><i class="fa-solid fa-trash"></i></button>' +
            '<span class="muted sm">Data</span>' + srcSel + '<span class="grow"></span>' +
            '<button class="btn sm" id="al-ai"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggest rules</button>' +
            '<button class="btn sm" id="al-xl"><i class="fa-solid fa-file-excel"></i> Excel</button>' +
            '<button class="btn sm primary" id="al-save"><i class="fa-solid fa-floppy-disk"></i> Save' + (AL.dirty ? ' *' : '') + '</button></div>' +
            '<div class="row al-pers" style="gap:4px;flex-wrap:wrap;margin-top:8px"><span class="muted sm">Periods</span>' + (chips || '<span class="muted sm">none synced for this data</span>') +
            '<a class="sm" id="al-pcur">current</a><a class="sm" id="al-pytd">year to date</a><span class="muted sm">· ' + per.map(pname).join(', ') + ' · amounts in ' + FL.scaleLabel() + '</span></div></div>' +
            (AL.coNote ? '<div class="callout warn sm"><i class="fa-solid fa-circle-info"></i> ' + esc(AL.coNote) + '</div>' : '') +
            '<div class="al-grid"><div id="al-list"></div><div id="al-main"></div></div>';
        AL.wireTop(); AL.paintList(); AL.paintMain();
    };
    AL.wireTop = function () {
        var m = AL.model();
        $('al-model').onchange = function () { AL.st.model = this.value; AL.st.sel = null; save(); AL.res = null; FL.render(); };
        $('al-new').onclick = function () { var n = prompt('Name of the new allocation set', 'Overheads ' + new Date().getFullYear()); if (!n) return; var x = AL.newModel(n); x.source = m.source; x.ledger = m.ledger; AL.doc.models.push(x); AL.st.model = x.id; AL.st.sel = null; save(); AL.dirty = true; FL.render(); };
        $('al-ren').onclick = function () { var n = prompt('Rename the set', m.name); if (n) { m.name = n; AL.dirty = true; AL.paint(); } };
        $('al-del').onclick = function () {
            if (AL.doc.models.length < 2) { FL.toast('Keep at least one set', 'warn'); return; }
            if (!confirm('Delete the set "' + m.name + '" and its rules?')) return;
            AL.doc.models = AL.doc.models.filter(function (x) { return x !== m; }); AL.st.model = AL.doc.models[0].id; save(); AL.store().then(function () { FL.render(); });
        };
        $('al-src').onchange = function () { var v = this.value; if (v === 'cc') m.source = 'cc'; else { m.source = 'seg'; m.ledger = v.split(':')[1]; } AL.dirty = true; AL.st.periods = []; save(); FL.render(); };
        AL.el.querySelectorAll('.al-pers .chip').forEach(function (b) {
            b.onclick = function (e) {
                var q = +b.dataset.p, p = AL.st.periods || [];
                AL.st.periods = e.ctrlKey || e.metaKey || e.shiftKey ? (p.indexOf(q) >= 0 ? p.filter(function (x) { return x !== q; }) : p.concat([q])) : [q];
                if (!AL.st.periods.length) AL.st.periods = [q];
                save(); AL.reload();
            };
        });
        $('al-pcur').onclick = function () { AL.st.periods = AL.defPeriods(); save(); AL.reload(); };
        $('al-pytd').onclick = function () {
            var last = Math.max.apply(null, AL.st.periods && AL.st.periods.length ? AL.st.periods : AL.defPeriods()), y = Math.floor(last / 100);
            AL.st.periods = (AL.periods || []).filter(function (p) { return Math.floor(p.seq / 100) === y && p.seq <= last; }).map(function (p) { return p.seq; }); save(); AL.reload();
        };
        $('al-save').onclick = function () { AL.store().then(function () { FL.toast('Allocation rules saved', 'ok'); $('al-save').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); }); };
        $('al-ai').onclick = AL.aiDialog;
        $('al-xl').onclick = AL.excel;
    };

    // ── left: the rules, one line each, with their check ──
    AL.paintList = function () {
        var m = AL.model(), box = $('al-list'); if (!box) return;
        (m.rules || []).forEach(AL.norm);
        var items = (m.rules || []).map(function (r, i) {
            var s = AL.step(r), ok = s && !s.skipped && s.rows && Math.abs(s.unallocated) < 0.5 && Math.abs(s.net) < 0.01;
            var badge = r.active === false ? '<span class="tag">off</span>' : !s || !s.rows ? '<span class="tag warn">no source</span>' : ok ? '<span class="tag good">✓ ' + money(s.allocated) + '</span>' : '<span class="tag bad">✗ check</span>';
            return '<div class="al-it' + (AL.st.sel === r.id ? ' on' : '') + (r.active === false ? ' off' : '') + '" data-id="' + r.id + '"><span class="al-n">' + (i + 1) + '</span><div class="grow"><b>' + esc(r.name) + '</b><div class="sm muted">' +
                esc(((r.pool || {}).accounts || []).length + ' account(s) → ' + AL.label((r.to || {}).field)) + '</div></div>' + badge + '</div>';
        }).join('');
        box.innerHTML = '<div class="card"><h3><i class="fa-solid fa-list-ol"></i> Rules <small>run in this order</small></h3>' +
            (items || '<p class="sm muted">No rules yet.</p>') +
            '<button class="btn sm primary" id="al-add" style="width:100%;margin-top:6px"><i class="fa-solid fa-plus"></i> New rule</button>' +
            ((m.rules || []).length ? '<div class="al-it' + (AL.st.sel === 'sum' ? ' on' : '') + '" data-id="sum" style="margin-top:10px"><i class="fa-solid fa-chart-pie"></i><div class="grow"><b>Result of all rules</b><div class="sm muted">before / after, flows, journal</div></div></div>' : '') + '</div>';
        $('al-add').onclick = AL.newRule;
        box.querySelectorAll('.al-it').forEach(function (it) { it.onclick = function () { AL.st.sel = it.dataset.id; if (AL.st.sel !== 'sum') AL.st.step = AL.st.step || 1; save(); AL.paintList(); AL.paintMain(); }; });
    };

    // ── right: the selected rule's steps (or the summary) ──
    AL.paintMain = function () {
        var M = $('al-main'); if (!M) return;
        if (AL.err) { M.innerHTML = '<div class="callout bad">' + esc(AL.err) + '</div>'; return; }
        if (!AL.rows || !AL.rows.length) { AL.whyEmpty(M); return; }
        if (AL.st.sel === 'sum') return AL.paintSummary(M);
        var r = AL.rule(); if (r) AL.norm(r);
        if (!r) {
            var exp = 0, rev = 0; AL.rows.forEach(function (x) { if (x.type === 'E') exp += x.amount; else rev -= x.amount; });
            M.innerHTML = '<div class="card al-intro"><h3><i class="fa-solid fa-share-nodes"></i> Allocate costs in three steps</h3>' +
                '<div class="al-steps3"><div><b>1</b><span>Source accounts</span><small>tick the expense accounts whose balance you want to share out</small></div>' +
                '<div><b>2</b><span>Allocation</span><small>who receives it and how: percentages, equally, by revenue or by a number such as headcount</small></div>' +
                '<div><b>3</b><span>Result</span><small>every account: source balance = total allocated</small></div></div>' +
                '<p class="sm">For these periods: expenses <b>' + money(exp) + '</b> · revenue <b>' + money(rev) + '</b>. Nothing is posted to Fusion.</p>' +
                '<button class="btn primary" id="al-start"><i class="fa-solid fa-plus"></i> New rule</button></div>';
            $('al-start').onclick = AL.newRule; return;
        }
        var step = AL.st.step || 1, i = AL.ruleIx(r);
        var tab = function (n, t) { return '<button class="al-tab' + (step === n ? ' on' : '') + '" data-s="' + n + '"><b>' + n + '</b> ' + t + '</button>'; };
        M.innerHTML = '<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="al-n">' + (i + 1) + '</span><input id="al-rn" value="' + esc(r.name) + '" style="font-weight:700;min-width:220px">' +
            '<label class="sm"><input type="checkbox" id="al-ron"' + (r.active === false ? '' : ' checked') + '> on</label><span class="grow"></span>' +
            '<button class="btn sm ghost" id="al-rup" title="Run earlier">▲</button><button class="btn sm ghost" id="al-rdn" title="Run later">▼</button>' +
            '<button class="btn sm ghost" id="al-rdel" title="Delete the rule"><i class="fa-solid fa-trash"></i></button></div>' +
            '<div class="al-tabs">' + tab(1, 'Source accounts') + '<i class="fa-solid fa-chevron-right"></i>' + tab(2, 'Allocation') + '<i class="fa-solid fa-chevron-right"></i>' + tab(3, 'Result') + '</div>' +
            '<div id="al-body"></div><div class="al-foot" id="al-foot"></div></div>';
        $('al-rn').onchange = function () { r.name = this.value.trim() || r.name; AL.changed(true); };
        $('al-ron').onchange = function () { r.active = this.checked; AL.changed(); };
        $('al-rup').onclick = function () { var m = AL.model(), k = AL.ruleIx(r); if (k > 0) { m.rules.splice(k - 1, 0, m.rules.splice(k, 1)[0]); AL.changed(); } };
        $('al-rdn').onclick = function () { var m = AL.model(), k = AL.ruleIx(r); if (k < m.rules.length - 1) { m.rules.splice(k + 1, 0, m.rules.splice(k, 1)[0]); AL.changed(); } };
        $('al-rdel').onclick = function () { if (!confirm('Delete the rule "' + r.name + '"?')) return; var m = AL.model(); m.rules.splice(AL.ruleIx(r), 1); m.drivers = (m.drivers || []).filter(function (d) { return d.id !== 'd_' + r.id; }); AL.st.sel = null; AL.changed(); };
        M.querySelectorAll('.al-tab').forEach(function (b) { b.onclick = function () { AL.st.step = +b.dataset.s; save(); AL.paintMain(); }; });
        if (step === 1) AL.step1(r); else if (step === 2) AL.step2(r); else AL.step3(r);
    };
    AL.footer = function (r, back, next, nextTxt) {
        var s = AL.step(r) || {};
        $('al-foot').innerHTML = '<div class="al-tot" id="al-tot"></div><span class="grow"></span>' +
            (back ? '<button class="btn" id="al-back"><i class="fa-solid fa-arrow-left"></i> Back</button>' : '') +
            (next ? '<button class="btn primary" id="al-next">' + nextTxt + ' <i class="fa-solid fa-arrow-right"></i></button>' : '');
        if (back) $('al-back').onclick = function () { AL.st.step = back; save(); AL.paintMain(); };
        if (next) $('al-next').onclick = function () { AL.st.step = next; save(); AL.paintMain(); };
        AL.paintTotals(); return s;
    };
    /** Source balance → allocated → difference, always in view under the steps */
    AL.paintTotals = function () {
        var r = AL.rule(), box = $('al-tot'); if (!r || !box) return;
        var s = AL.step(r) || { pool: 0, allocated: 0, unallocated: 0 }, src = AL.sourceTotal(r), share = AL.share(r);
        var diff = src * share - (s.allocated || 0), ok = Math.abs(diff) < 0.5 && (s.allocated || 0) !== 0;
        box.innerHTML = '<span>Source balance <b>' + money(src) + '</b></span>' + (share !== 1 ? '<span>× ' + (share * 100).toFixed(1) + '%</span>' : '') +
            '<span>Allocated <b>' + money(s.allocated || 0) + '</b></span><span class="' + (ok ? 'pos' : 'neg') + '">' + (ok ? '✓ equal' : '✗ difference ' + money(diff)) + '</span>';
    };
    AL.share = function (r) { var p = (r.pool || {}).pct; return p == null || p === '' ? 1 : (+p || 0) / 100; };
    AL.sourceRows = function (r, rows) { return (r.pool && (r.pool.accounts || []).length) ? A.poolRows(rows || AL.before(r), r, FL.dims.accounts || []) : []; };
    AL.sourceTotal = function (r) { var t = 0; AL.sourceRows(r).forEach(function (x) { t += x.amount; }); return t; };
    var whereField = function (r) { var w = (r.pool || {}).where || {}; return Object.keys(w).filter(function (k) { return (w[k] || []).length; })[0] || ''; };

    // ① source accounts
    AL.step1 = function (r) {
        var rows = AL.before(r), wf = AL.st.fromField != null && AL.st.fromRule === r.id ? AL.st.fromField : whereField(r), wv = wf ? (r.pool.where[wf] || []) : [];
        var acc = {}, byCode = {}, showRev = !!AL.st.showRev, cls = {};
        (FL.dims.accounts || []).forEach(function (a) { byCode[a.code] = a; });
        rows.forEach(function (x) {
            if (wf && wv.length && wv.indexOf(wf === 'company' ? x.company : String(x.dims[wf] == null ? '' : x.dims[wf])) < 0) return;
            if (x.type === 'R' && !showRev) return;
            var a = acc[x.account] = acc[x.account] || { code: x.account, type: x.type, bal: 0 }; a.bal += x.amount;
        });
        var sel = {}; (r.pool.accounts || []).forEach(function (c) { sel[c] = 1; });
        var list = Object.keys(acc).map(function (k) { var a = acc[k], o = byCode[k] || {}; a.name = o.name || ''; a.cls = o['class'] || ''; cls[a.cls] = (cls[a.cls] || 0) + 1; return a; })
            .filter(function (a) { return Math.abs(a.bal) >= 0.5 || sel[a.code]; }).sort(function (a, b) { return (sel[b.code] ? 1 : 0) - (sel[a.code] ? 1 : 0) || Math.abs(b.bal) - Math.abs(a.bal); });
        var fields = AL.allFields().filter(function (f) { return !f.virtual || AL.ruleIx(r) > 0; });
        $('al-body').innerHTML = '<p class="sm">Tick the accounts whose balance this rule shares out. Balances are for the periods above' + (AL.ruleIx(r) > 0 ? ', after the rules before this one' : '') + '.</p>' +
            '<div class="row" style="gap:6px;flex-wrap:wrap"><span class="sm">Take the balances of</span><select id="s1-wf"><option value="">every ' + esc(AL.label(AL.mainField()).toLowerCase()) + ' (all of it)</option>' +
            fields.map(function (f) { return '<option value="' + f.id + '"' + (f.id === wf ? ' selected' : '') + '>only some ' + esc(f.name) + ' values</option>'; }).join('') + '</select>' +
            '<span class="sm">· allocate</span><input id="s1-pct" type="number" min="0" max="100" step="0.1" value="' + esc(r.pool.pct == null ? 100 : r.pool.pct) + '" style="width:70px"><span class="sm">% of the balance</span>' +
            '<label class="sm"><input type="checkbox" id="s1-rev"' + (showRev ? ' checked' : '') + '> show revenue accounts</label></div>' +
            (wf ? '<div id="s1-wbox" style="margin-top:6px">' + AL.picker('s1-where', wf, wv) + '</div>' : '') +
            '<div class="row" style="gap:6px;margin:8px 0;flex-wrap:wrap"><input type="search" id="s1-q" placeholder="Search account or name" style="min-width:220px"><a class="sm" id="s1-all">tick shown</a> · <a class="sm" id="s1-none">clear</a>' +
            Object.keys(cls).filter(Boolean).sort().map(function (c) { return '<button class="chip" data-c="' + esc(c) + '">' + esc(c) + ' (' + cls[c] + ')</button>'; }).join('') + '</div>' +
            '<div class="scroll" style="max-height:52vh"><table class="t al-acc"><thead><tr><th style="width:28px"><input type="checkbox" id="s1-hd"></th><th>Account</th><th>Name</th><th>Class</th><th class="n">Balance</th></tr></thead><tbody>' +
            list.map(function (a) { return '<tr data-c="' + esc(a.code) + '" data-k="' + esc(a.cls) + '" data-s="' + esc((a.code + ' ' + a.name + ' ' + a.cls).toLowerCase()) + '" class="' + (sel[a.code] ? 'on' : '') + '"><td><input type="checkbox"' + (sel[a.code] ? ' checked' : '') + '></td><td>' + esc(a.code) + '</td><td>' + esc(a.name) + '</td><td class="muted">' + esc(a.cls) + '</td><td class="n">' + money(a.bal) + '</td></tr>'; }).join('') +
            '</tbody><tfoot><tr><td></td><td colspan="3" id="s1-sum"></td><td class="n" id="s1-tot"></td></tr></tfoot></table></div>';
        var B = $('al-body'), tb = B.querySelector('.al-acc tbody');
        var apply = function (first) {
            var codes = [].filter.call(tb.querySelectorAll('tr'), function (tr) { return tr.querySelector('input').checked; }).map(function (tr) { return tr.dataset.c; });
            r.pool.accounts = codes; var t = 0; codes.forEach(function (c) { t += (acc[c] || {}).bal || 0; });
            tb.querySelectorAll('tr').forEach(function (tr) { tr.classList.toggle('on', tr.querySelector('input').checked); });
            $('s1-sum').innerHTML = '<b>' + codes.length + '</b> account(s) ticked · source balance'; $('s1-tot').innerHTML = '<b>' + money(t) + '</b>';
            if (first !== true) AL.changed(true);
        };
        tb.onchange = function () { apply(); };
        tb.querySelectorAll('tr').forEach(function (tr) { tr.onclick = function (e) { if (e.target.tagName === 'INPUT') return; var c = tr.querySelector('input'); c.checked = !c.checked; apply(); }; });
        var shown = function () { return [].filter.call(tb.querySelectorAll('tr'), function (tr) { return tr.style.display !== 'none'; }); };
        $('s1-q').oninput = function () { var q = this.value.toLowerCase(); tb.querySelectorAll('tr').forEach(function (tr) { tr.style.display = !q || tr.dataset.s.indexOf(q) >= 0 ? '' : 'none'; }); };
        $('s1-all').onclick = function () { shown().forEach(function (tr) { tr.querySelector('input').checked = true; }); apply(); };
        $('s1-none').onclick = function () { tb.querySelectorAll('input').forEach(function (x) { x.checked = false; }); apply(); };
        $('s1-hd').onchange = function () { var on = this.checked; shown().forEach(function (tr) { tr.querySelector('input').checked = on; }); apply(); };
        B.querySelectorAll('.chip[data-c]').forEach(function (c) { c.onclick = function () { tb.querySelectorAll('tr').forEach(function (tr) { if (tr.dataset.k === c.dataset.c) tr.querySelector('input').checked = true; }); apply(); }; });
        $('s1-pct').onchange = function () { var v = +this.value; r.pool.pct = v === 100 ? undefined : Math.max(0, Math.min(100, v)); AL.changed(true); };
        $('s1-rev').onchange = function () { AL.st.showRev = this.checked; save(); AL.step1(r); };
        $('s1-wf').onchange = function () { r.pool.where = {}; AL.st.fromField = this.value; AL.st.fromRule = r.id; AL.changed(true); AL.step1(r); };
        if ($('s1-where')) { AL.wirePicker($('s1-where')); $('s1-where').addEventListener('change', function () { r.pool.where = {}; var v = AL.picked($('s1-where')); if (v.length) r.pool.where[wf] = v; AL.changed(true); AL.step1(r); }); }
        apply(true);
        AL.footer(r, 0, 2, 'Next: allocation');
    };

    // ② allocation
    AL.step2 = function (r) {
        var m = AL.model(), to = r.to = r.to || {}, f = to.field || AL.mainField(), meth = to.method || 'fixed';
        if (meth === 'driver' || meth === 'number') { meth = 'driver'; to.driver = 'd_' + r.id; }
        var drv = (m.drivers || []).filter(function (d) { return d.id === 'd_' + r.id; })[0];
        var own = whereField(r) === f ? r.pool.where[f] || [] : [];
        var vals = AL.values(f).filter(function (v) { return v.value !== '' || meth !== 'gl'; });
        var tSel = {}; (to.targets || []).forEach(function (t) { tSel[typeof t === 'object' ? t.value : t] = typeof t === 'object' ? t.pct : 1; });
        var s = AL.step(r) || { targets: {} }, fields = AL.allFields();
        var M = { fixed: ['fa-percent', 'Percentages', 'you type each receiver’s %'], even: ['fa-equals', 'Equally', 'same amount to every ticked receiver'],
            gl: ['fa-sack-dollar', 'By revenue', 'in proportion to each receiver’s revenue'], driver: ['fa-hashtag', 'By a number', 'headcount, m², orders … you type per receiver'] };
        var closed = {};   // values an earlier rule emptied (step-down): they receive nothing
        if (r.stepDown !== false) (m.rules || []).slice(0, AL.ruleIx(r)).forEach(function (x) { if (x.active !== false) (((x.pool || {}).where || {})[f] || []).forEach(function (v) { closed[v] = x.name; }); });
        var input = function (v) {
            if (own.indexOf(v.value) >= 0) return '<span class="muted sm">source</span>';
            if (closed[v.value]) return '<span class="muted sm" title="Step-down: a value an earlier rule shared out receives nothing">emptied by ' + esc(closed[v.value]) + '</span>';
            if (meth === 'fixed') return '<input type="number" step="0.01" min="0" class="s2-in" value="' + esc(tSel[v.value] != null ? tSel[v.value] : '') + '" placeholder="%" style="width:90px">';
            if (meth === 'driver') return '<input type="number" step="any" min="0" class="s2-in" value="' + esc(drv && drv.values[v.value] != null ? drv.values[v.value] : '') + '" style="width:90px">';
            if (meth === 'gl') return '<input type="checkbox" class="s2-ck"' + (!(to.targets || []).length || tSel[v.value] ? ' checked' : '') + '> ' + money(v.rev);
            return '<input type="checkbox" class="s2-ck"' + (!(to.targets || []).length || tSel[v.value] ? ' checked' : '') + '>';
        };
        $('al-body').innerHTML = '<p class="sm">Who receives the source balance, and how it is shared. The share and amount columns are worked out as you type.</p>' +
            '<div class="row" style="gap:8px;flex-wrap:wrap"><span class="sm">Allocate to</span><select id="s2-f">' + fields.map(function (x) { return '<option value="' + x.id + '"' + (x.id === f ? ' selected' : '') + '>' + esc(x.name) + (x.virtual ? ' (your list)' : '') + '</option>'; }).join('') +
            '<option value="__new">＋ your own list of receivers…</option></select>' + (fields.length < 2 ? '<span class="sm muted">only Company is in the data — sync extended segments (department, salesperson …) or make your own list</span>' : '') + '</div>' +
            '<div class="al-meth">' + Object.keys(M).map(function (k) { return '<button class="' + (k === meth ? 'on' : '') + '" data-m="' + k + '"><i class="fa-solid ' + M[k][0] + '"></i><b>' + M[k][1] + '</b><span>' + M[k][2] + '</span></button>'; }).join('') + '</div>' +
            (meth === 'driver' ? '<label class="sm">What the number is <input id="s2-unit" value="' + esc(drv ? drv.unit || drv.name : 'headcount') + '" style="width:160px"></label> <a class="sm" id="s2-paste">paste from Excel</a>' : '') +
            '<div class="row" style="gap:6px;margin:6px 0"><input type="search" id="s2-q" placeholder="Search receivers" style="min-width:200px">' + (meth === 'fixed' ? '<a class="sm" id="s2-even">split evenly over the filled ones</a>' : meth === 'even' || meth === 'gl' ? '<a class="sm" id="s2-all">tick all</a> · <a class="sm" id="s2-none">none</a>' : '') + '</div>' +
            '<div class="scroll" style="max-height:50vh"><table class="t al-rcv"><thead><tr><th>' + esc(AL.label(f)) + '</th><th>' + (meth === 'fixed' ? 'Percentage' : meth === 'driver' ? esc(drv ? drv.unit || 'Number' : 'Number') : meth === 'gl' ? 'Revenue' : 'Receives') + '</th><th class="n">Share</th><th class="n">Amount</th></tr></thead><tbody>' +
            vals.map(function (v) { var a = s.targets[v.value]; return '<tr data-v="' + esc(v.value) + '" data-s="' + esc((v.value + ' ' + ((AL.names[f] || {})[v.value] || '')).toLowerCase()) + '"><td>' + esc(AL.vname(f, v.value)) + '</td><td>' + input(v) + '</td><td class="n s2-sh">' + (a && s.allocated ? pct(a / s.allocated * 100) : '') + '</td><td class="n s2-am">' + (a ? money(a) : '') + '</td></tr>'; }).join('') +
            '</tbody><tfoot><tr><td><b>Total</b></td><td id="s2-in"></td><td class="n" id="s2-sh"></td><td class="n" id="s2-am"></td></tr></tfoot></table></div>';
        var B = $('al-body'), tb = B.querySelector('.al-rcv tbody');
        var collect = function () {
            var trs = [].slice.call(tb.querySelectorAll('tr'));
            if (meth === 'fixed') to.targets = trs.map(function (tr) { var x = tr.querySelector('.s2-in'); return x && +x.value > 0 ? { value: tr.dataset.v, pct: +x.value } : null; }).filter(Boolean);
            else if (meth === 'driver') {
                var vs = {}; trs.forEach(function (tr) { var x = tr.querySelector('.s2-in'); if (x && x.value !== '' && +x.value > 0) vs[tr.dataset.v] = +x.value; });
                m.drivers = (m.drivers || []).filter(function (d) { return d.id !== 'd_' + r.id; }).concat([{ id: 'd_' + r.id, name: ($('s2-unit') || {}).value || 'Number', unit: ($('s2-unit') || {}).value || '', field: f, values: vs }]);
                to.driver = 'd_' + r.id; to.targets = [];
            } else {
                var on = trs.filter(function (tr) { var c = tr.querySelector('.s2-ck'); return c && c.checked; }).map(function (tr) { return tr.dataset.v; });
                to.targets = on.length === trs.filter(function (tr) { return tr.querySelector('.s2-ck'); }).length ? [] : on.length ? on : ['\u0000none'];
            }
            AL.changed(true); refresh();
        };
        var refresh = function () {
            var st = AL.step(r) || { targets: {} }, tIn = 0;
            tb.querySelectorAll('tr').forEach(function (tr) { var a = st.targets[tr.dataset.v]; tr.querySelector('.s2-sh').textContent = a && st.allocated ? pct(a / st.allocated * 100) : ''; tr.querySelector('.s2-am').textContent = a ? money(a) : ''; tr.classList.toggle('on', !!a); });
            tb.querySelectorAll('.s2-in').forEach(function (x) { tIn += +x.value || 0; });
            $('s2-in').innerHTML = meth === 'fixed' ? '<b class="' + (Math.abs(tIn - 100) < 0.01 ? 'pos' : 'neg') + '">' + tIn.toFixed(2) + '%</b>' + (tIn && Math.abs(tIn - 100) >= 0.01 ? ' <span class="sm muted">shares are scaled to 100 %</span>' : '') : meth === 'driver' ? '<b>' + tIn.toLocaleString() + '</b>' : '';
            $('s2-sh').innerHTML = st.allocated ? '<b>100%</b>' : ''; $('s2-am').innerHTML = '<b>' + money(st.allocated || 0) + '</b>';
            AL.paintTotals();
        };
        tb.addEventListener('change', collect);
        tb.addEventListener('input', function (e) { if (e.target.classList.contains('s2-in')) { clearTimeout(AL.t2); AL.t2 = setTimeout(collect, 350); } });
        $('s2-q').oninput = function () { var q = this.value.toLowerCase(); tb.querySelectorAll('tr').forEach(function (tr) { tr.style.display = !q || tr.dataset.s.indexOf(q) >= 0 ? '' : 'none'; }); };
        $('s2-f').onchange = function () {
            if (this.value === '__new') return AL.newList(r);
            to.field = this.value; to.targets = []; if (meth === 'driver') m.drivers = (m.drivers || []).filter(function (d) { return d.id !== 'd_' + r.id; });
            AL.changed(true); AL.step2(r);
        };
        B.querySelectorAll('.al-meth button').forEach(function (b) { b.onclick = function () { to.method = b.dataset.m; to.targets = []; if (to.method === 'gl') to.gl = { accounts: { type: 'R' } }; if (to.method === 'driver') to.driver = 'd_' + r.id; AL.changed(true); AL.step2(r); }; });
        if ($('s2-even')) $('s2-even').onclick = function () { var ins = [].filter.call(tb.querySelectorAll('.s2-in'), function (x) { return +x.value > 0; }); if (!ins.length) ins = [].slice.call(tb.querySelectorAll('.s2-in')); var n = ins.length; ins.forEach(function (x, k) { x.value = k === n - 1 ? (100 - Math.round(10000 / n) / 100 * (n - 1)).toFixed(2) : (Math.round(10000 / n) / 100).toFixed(2); }); collect(); };
        if ($('s2-all')) $('s2-all').onclick = function () { tb.querySelectorAll('tr').forEach(function (tr) { if (tr.style.display !== 'none' && tr.querySelector('.s2-ck')) tr.querySelector('.s2-ck').checked = true; }); collect(); };
        if ($('s2-none')) $('s2-none').onclick = function () { tb.querySelectorAll('.s2-ck').forEach(function (x) { x.checked = false; }); collect(); };
        if ($('s2-unit')) $('s2-unit').onchange = collect;
        if ($('s2-paste')) $('s2-paste').onclick = function () {
            var t = prompt('Paste two columns from Excel: receiver code, number (one per line)'); if (!t) return;
            t.split(/\r?\n/).forEach(function (l) { var p = l.split(/\t|;|,(?=\s*-?\d)/); if (p.length < 2) return; var tr = tb.querySelector('tr[data-v="' + CSS.escape(p[0].trim()) + '"] .s2-in'); if (tr) tr.value = +String(p[1]).replace(/\s/g, '') || ''; });
            collect();
        };
        refresh();
        AL.footer(r, 1, 3, 'Next: result');
    };
    /** "Your own list" — receivers that are not in the GL (activities, branches, products …) */
    AL.newList = function (r) {
        FL.modal('<i class="fa-solid fa-list"></i> Your own list of receivers', '<label>Name <input id="nl-name" value="Activity"></label><p class="sm muted">One receiver per line — e.g. activities (Order handling, Picking, Delivery) or branches. A later rule can share these on again (activity-based costing).</p><textarea id="nl-vals" rows="8" style="width:100%"></textarea>',
            '<button class="btn sm" id="nl-cancel">Cancel</button><button class="btn sm primary" id="nl-ok">Use this list</button>');
        $('nl-cancel').onclick = function () { FL.closeModal(); AL.step2(r); };
        $('nl-ok').onclick = function () {
            var m = AL.model(), name = $('nl-name').value.trim() || 'List', vals = $('nl-vals').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (!vals.length) { FL.toast('Type at least one receiver', 'warn'); return; }
            var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'list', id = base, n = 2; while (AL.allFields().some(function (f) { return f.id === id; })) id = base + n++;
            (m.virtual = m.virtual || []).push({ id: id, name: name, values: vals });
            r.to.field = id; r.to.targets = []; if (r.to.method === 'gl') r.to.method = 'fixed';
            FL.closeModal(); AL.changed(true); AL.step2(r);
        };
    };

    // ③ result: per source account, balance = total allocated; per receiver the amounts
    AL.step3 = function (r) {
        var s = AL.step(r) || {}, f = (r.to || {}).field, share = AL.share(r), res = AL.res;
        var srcAcc = {}; AL.sourceRows(r).forEach(function (x) { srcAcc[x.account] = (srcAcc[x.account] || 0) + x.amount; });
        var byAcc = {}, tg = {};
        (res ? res.lines : []).forEach(function (l) {
            if (l.src !== r.id || l.side !== 'in') return;
            var a = byAcc[l.origin] = byAcc[l.origin] || { code: l.origin, t: {}, total: 0 }, v = f === 'company' ? l.company : String(l.dims[f]);
            a.t[v] = (a.t[v] || 0) + l.amount; a.total += l.amount; tg[v] = (tg[v] || 0) + l.amount;
        });
        var tgs = Object.keys(tg).sort(function (a, b) { return tg[b] - tg[a]; }), shown = tgs.slice(0, 10), rest = tgs.slice(10);
        var list = Object.keys(srcAcc).map(function (c) { var a = byAcc[c] || { t: {}, total: 0 }; return { code: c, name: AL.accName(c), src: srcAcc[c], want: srcAcc[c] * share, t: a.t, total: a.total, diff: srcAcc[c] * share - a.total }; })
            .sort(function (a, b) { return Math.abs(b.src) - Math.abs(a.src); });
        var tSrc = 0, tAll = 0; list.forEach(function (a) { tSrc += a.src; tAll += a.total; });
        var ok = list.length && list.every(function (a) { return Math.abs(a.diff) < 0.5; });
        var oth = function (a) { var t = 0; rest.forEach(function (v) { t += a.t[v] || 0; }); return t; };
        $('al-body').innerHTML = (!list.length ? '<div class="callout warn">No source balance — tick accounts in step 1.</div>' :
            '<div class="al-check ' + (ok ? 'ok' : 'bad') + '"><i class="fa-solid ' + (ok ? 'fa-circle-check' : 'fa-triangle-exclamation') + '"></i><div><b>' + (ok ? 'Every account is fully allocated' : 'Not everything is allocated') + '</b><br>' +
            'Source balance ' + money(tSrc) + (share !== 1 ? ' × ' + (share * 100).toFixed(1) + '% = ' + money(tSrc * share) : '') + ' · allocated ' + money(tAll) + ' · difference ' + money(tSrc * share - tAll) +
            (s.warn && s.warn.length ? '<br><span class="sm">' + esc(s.warn.join(' · ')) + '</span>' : '') + '</div></div>') +
            '<div class="scroll" style="max-height:56vh"><table class="t al-res"><thead><tr><th>Account</th><th>Name</th><th class="n">Source balance</th>' +
            shown.map(function (v) { return '<th class="n" title="' + esc(AL.vname(f, v)) + '">' + esc(AL.vname(f, v).slice(0, 18)) + '</th>'; }).join('') + (rest.length ? '<th class="n">' + rest.length + ' others</th>' : '') +
            '<th class="n">Total allocated</th><th class="n">Difference</th></tr></thead><tbody>' +
            list.map(function (a) {
                return '<tr><td>' + esc(a.code) + '</td><td>' + esc(a.name) + '</td><td class="n"><b>' + money(a.src) + '</b></td>' + shown.map(function (v) { return '<td class="n">' + (a.t[v] ? money(a.t[v]) : '') + '</td>'; }).join('') +
                    (rest.length ? '<td class="n">' + money(oth(a)) + '</td>' : '') + '<td class="n"><b>' + money(a.total) + '</b></td><td class="n ' + (Math.abs(a.diff) < 0.5 ? 'pos' : 'neg') + '">' + (Math.abs(a.diff) < 0.5 ? '✓ 0' : money(a.diff)) + '</td></tr>';
            }).join('') + '</tbody><tfoot><tr><td><b>Total</b></td><td>' + list.length + ' account(s)</td><td class="n"><b>' + money(tSrc) + '</b></td>' + shown.map(function (v) { return '<td class="n"><b>' + money(tg[v]) + '</b></td>'; }).join('') +
            (rest.length ? '<td class="n"><b>' + money(rest.reduce(function (t, v) { return t + tg[v]; }, 0)) + '</b></td>' : '') + '<td class="n"><b>' + money(tAll) + '</b></td><td class="n"><b>' + money(tSrc * share - tAll) + '</b></td></tr></tfoot></table></div>' +
            '<details style="margin-top:10px"><summary class="sm">Journal lines of this rule (credit the source, debit the receivers)</summary><div id="s3-jr"></div></details>';
        if (list.length && res) {
            var jr = A.journal({ lines: res.lines.filter(function (l) { return l.src === r.id; }) }, f ? [f] : []);
            FL.grid($('s3-jr'), [{ label: 'Company', key: 'company' }, { label: 'Account', key: 'account' }, { label: AL.label(f), get: function (o) { return AL.vname(f, o.dims[f]); }, val: function (o) { return o.dims[f]; } },
                { label: 'Debit', n: 1, money: 1, get: function (o) { return money(o.dr); }, val: function (o) { return o.dr; } }, { label: 'Credit', n: 1, money: 1, get: function (o) { return money(o.cr); }, val: function (o) { return o.cr; } }], jr, { id: 's3-jr', csv: 'allocation-' + r.name.replace(/\W+/g, '-') + '.csv', height: 320 });
        }
        AL.footer(r, 2, 0);
        var m = AL.model(), k = AL.ruleIx(r);
        $('al-foot').insertAdjacentHTML('beforeend', k < m.rules.length - 1 ? '<button class="btn primary" id="al-nr">Next rule <i class="fa-solid fa-arrow-right"></i></button>' : '<button class="btn" id="al-nr2"><i class="fa-solid fa-plus"></i> Another rule</button> <button class="btn primary" id="al-sum">Result of all rules</button>');
        if ($('al-nr')) $('al-nr').onclick = function () { AL.st.sel = m.rules[k + 1].id; AL.st.step = 1; save(); AL.paintList(); AL.paintMain(); };
        if ($('al-nr2')) $('al-nr2').onclick = AL.newRule;
        if ($('al-sum')) $('al-sum').onclick = function () { AL.st.sel = 'sum'; save(); AL.paintList(); AL.paintMain(); };
    };

    // ── result of all rules ──
    AL.paintSummary = function (M) {
        var res = AL.res, m = AL.model(), exp = 0; AL.rows.forEach(function (x) { if (x.type === 'E') exp += x.amount; });
        var flds = AL.allFields(), lastTo = ((m.rules || []).filter(function (r) { return r.active !== false; }).slice(-1)[0] || {}).to || {};
        var field = AL.st.field && flds.some(function (f) { return f.id === AL.st.field; }) ? AL.st.field : lastTo.field || AL.mainField();
        var sum = A.summary(res, field), loss = sum.filter(function (o) { return o.revenue > 0 && o.before >= 0 && o.after < 0; });
        var srcT = 0, allT = 0; (m.rules || []).forEach(function (r) { if (r.active === false) return; var s = AL.step(r) || {}; srcT += AL.sourceTotal(r) * AL.share(r); allT += s.allocated || 0; });
        M.innerHTML = '<div class="card"><h3><i class="fa-solid fa-chart-pie"></i> Result of all rules</h3>' +
            '<div class="al-check ' + (Math.abs(srcT - allT) < 0.5 ? 'ok' : 'bad') + '"><i class="fa-solid ' + (Math.abs(srcT - allT) < 0.5 ? 'fa-circle-check' : 'fa-triangle-exclamation') + '"></i><div><b>Source balances ' + money(srcT) + ' · allocated ' + money(allT) + ' · difference ' + money(srcT - allT) + '</b><br><span class="sm">Total profit is unchanged — allocation only moves cost between receivers. Expenses in these periods: ' + money(exp) + '.</span></div></div>' +
            (loss.length ? '<div class="callout bad sm"><b>' + loss.length + ' ' + esc(AL.label(field)) + ' value(s) turn loss-making after allocation</b>: ' + loss.slice(0, 6).map(function (o) { return esc(AL.vname(field, o.value)) + ' (' + money(o.after) + ')'; }).join(', ') + '</div>' : '') +
            '<h4 style="margin:12px 0 4px">Before and after by <select id="al-fld">' + flds.map(function (f) { return '<option value="' + f.id + '"' + (f.id === field ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select> <small class="muted">click a row for what it gave and received</small></h4><div id="al-sum"></div>' +
            '<h4 style="margin:12px 0 4px">Where the cost flows</h4><div id="al-sk" class="al-sk"></div>' +
            '<h4 style="margin:12px 0 4px">Journal of all rules</h4><div id="al-lines"></div></div>';
        $('al-fld').onchange = function () { AL.st.field = this.value; save(); AL.paintMain(); };
        var mc = function (label, key, extra) { return Object.assign({ label: label, n: 1, money: 1, get: function (o) { return money(o[key]); }, val: function (o) { return o[key]; } }, extra || {}); };
        FL.grid($('al-sum'), [{ label: AL.label(field), get: function (o) { return AL.vname(field, o.value); }, val: function (o) { return o.value; } },
            mc('Revenue', 'revenue'), mc('Direct cost', 'direct'), mc('Allocated in', 'inAmt'), mc('Allocated out', 'outAmt'), mc('Cost after allocation', 'loaded'),
            mc('Result before', 'before'), mc('Result after', 'after'),
            { label: 'Margin before %', n: 1, sum: false, get: function (o) { return pct(o.mBefore); }, val: function (o) { return o.mBefore; } },
            { label: 'Margin after %', n: 1, sum: false, get: function (o) { return pct(o.mAfter); }, val: function (o) { return o.mAfter; } }], sum, { id: 'al-sum', csv: 'allocation-' + field + '.csv', height: 420, click: function (o) { AL.trace(field, o.value); } });
        AL.sankey($('al-sk'));
        var used = AL.usedFields(), jr = A.journal(res, used);
        FL.grid($('al-lines'), [{ label: 'Rule', get: function (o) { return AL.ruleName(o.rule); } }, { label: 'Company', key: 'company' }, { label: 'Account', key: 'account' }]
            .concat(used.map(function (f) { return { label: AL.label(f), get: function (o) { return AL.vname(f, o.dims[f]); }, val: function (o) { return o.dims[f]; } }; }))
            .concat([mc('Debit', 'dr'), mc('Credit', 'cr')]), jr, { id: 'al-lines', csv: 'allocation-journal.csv', height: 360 });
    };

    AL.whyEmpty = function (R) {
        var m = AL.model(), per = AL.st.periods || [];
        R.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking why there is nothing…</div>';
        if (m.source === 'cc' || !AL.led) {
            R.innerHTML = '<div class="callout warn">No income statement amounts for ' + (per.length ? 'these periods' : 'any period') + (m.source === 'cc' ? ' in the balances' : '') + '.' +
                (m.source !== 'cc' ? ' No extended segments are synced yet — Data › Trial balance sync › <i>Extended segments</i>.' : '') + (AL.coNote ? '<br>' + esc(AL.coNote) : '') + '</div>';
            return;
        }
        var w = ' WHERE ledger_id = ' + (+AL.led.ledger_id) + (per.length ? ' AND period_seq IN (' + per.join(',') + ')' : '');
        Promise.all([
            FL.rows("SELECT COALESCE(account_type, '?') AS t, COUNT(*) AS n, SUM(dr - cr) AS net FROM fin_gl_ext_v" + w + ' GROUP BY 1 ORDER BY 1', 50),
            FL.rows('SELECT company, COUNT(*) AS n FROM fin_gl_ext_v' + w + ' GROUP BY 1 ORDER BY 1', 50),
            FL.rows("SELECT COUNT(*) AS n FROM fin_gl_ext_v WHERE ledger_id = " + (+AL.led.ledger_id), 1)
        ]).then(function (r) {
            var all = r[0].reduce(function (a, x) { return a + (+x.n); }, 0), tot = (r[2][0] || {}).n || 0, why = [];
            if (!tot) why.push('Nothing from the ledger <b>' + esc(AL.led.name || AL.led.ledger_id) + '</b> is kept with extended segments on this PC. Sync them in Data › Trial balance sync › <i>Extended segments</i>.');
            else if (!all) why.push('The ledger has extended-segment rows, but none for ' + esc(per.join(', ')) + '. Pick a period chip above that is synced, or sync its segments.');
            else {
                var types = r[0].map(function (x) { return x.t; });
                if (!types.some(function (t) { return t === 'R' || t === 'E' || t === '?'; })) why.push('The rows for these periods are all balance sheet accounts (types ' + esc(types.join(', ')) + ') — cost allocation works on revenue and expense accounts.');
                if (FL.filter.company && !AL.coNote) why.push('The header company <b>' + esc(FL.filter.company) + '</b> has no income statement rows here; the ledger’s companies with rows: ' + esc(r[1].map(function (x) { return x.company; }).join(', ')) + '. Choose <i>All companies</i> in the header.');
            }
            R.innerHTML = '<div class="callout warn"><b>Nothing to allocate yet.</b><ul>' + (why.length ? why : ['No revenue or expense amounts were found.']).map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
                '<div class="sm muted">Ledger ' + esc(AL.led.name || AL.led.ledger_id) + ' · periods ' + esc(per.join(', ') || 'none') + ' · rows by account type: ' + (r[0].map(function (x) { return x.t + ' ' + x.n; }).join(', ') || 'none') + ' · companies: ' + (r[1].map(function (x) { return x.company + ' (' + x.n + ')'; }).join(', ') || 'none') + '</div>' +
                (FL.filter.company ? '<button class="btn sm" id="al-allco" style="margin-top:6px">Use all companies</button>' : '') + '</div>';
            if ($('al-allco')) $('al-allco').onclick = function () { FL.setFilter({ company: '' }); };
        }).catch(function (e) { R.innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
    };
    var kpi = function (l, v, sub, cls) { return '<div class="kpi"><div class="k-l">' + esc(l) + '</div><div class="k-v">' + v + '</div><div class="k-d ' + (cls || 'muted') + '">' + esc(sub || '') + '&nbsp;</div></div>'; };
    AL.ruleName = function (id) { var r = (AL.model().rules || []).filter(function (x) { return x.id === id; })[0]; return r ? r.name : id; };
    AL.usedFields = function () {
        var f = {}; (AL.model().rules || []).forEach(function (r) { if (r.active === false) return; if (r.to && r.to.field) f[r.to.field] = 1; Object.keys((r.pool || {}).where || {}).forEach(function (k) { if (k !== 'company') f[k] = 1; }); });
        return Object.keys(f);
    };

    /** What a value gave and received, rule by rule */
    AL.trace = function (field, value) {
        var res = AL.res, key = field + '=' + value;
        var inn = res.flows.filter(function (f) { return f.to === key; }), out = res.flows.filter(function (f) { return f.from === key || (f.from.indexOf(key) >= 0 && f.from.split(' ').indexOf(key) >= 0); });
        var tbl = function (list, other) {
            if (!list.length) return '<p class="sm muted">Nothing.</p>';
            var t = 0; list.forEach(function (f) { t += f.amount; });
            return FL.table([{ label: 'Rule', get: function (f) { return AL.ruleName(f.rule); } }, { label: other === 'from' ? 'From' : 'To', get: function (f) { var p = (other === 'from' ? f.from : f.to).split('='); return p.length === 2 ? AL.label(p[0]) + ' ' + AL.vname(p[0], p[1]) : f[other]; } },
                { label: 'Amount', n: 1, get: function (f) { return money(f.amount); } }], list.sort(function (a, b) { return b.amount - a.amount; })) + '<p class="sm">Total <b>' + money(t) + '</b></p>';
        };
        var o = A.summary(res, field).filter(function (x) { return x.value === value; })[0] || {};
        FL.modal('<i class="fa-solid fa-route"></i> ' + esc(AL.label(field) + ' ' + AL.vname(field, value)),
            '<div class="kpis">' + kpi('Revenue', money(o.revenue)) + kpi('Direct cost', money(o.direct)) + kpi('Allocated in', money(o.inAmt)) + kpi('Allocated out', money(o.outAmt)) +
            kpi('Result after', money(o.after), o.mAfter == null ? '' : 'margin ' + pct(o.mAfter) + ' (was ' + pct(o.mBefore) + ')', o.after < 0 ? 'neg' : 'pos') + '</div>' +
            '<h4>Received</h4>' + tbl(inn, 'from') + '<h4>Gave</h4>' + tbl(out, 'to'),
            '<button class="btn sm" id="al-tr-ask"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask the Copilot</button>');
        $('al-tr-ask').onclick = function () {
            FL.closeModal();
            FL.askCopilot('In the cost allocation model "' + AL.model().name + '", ' + AL.label(field) + ' ' + AL.vname(field, value) + ' has revenue ' + Math.round(o.revenue || 0) + ', direct cost ' + Math.round(o.direct || 0) +
                ', receives ' + Math.round(o.inAmt || 0) + ' of allocated cost and ends at ' + Math.round(o.after || 0) + '. Is the allocation fair for it, which driver drives most of it, and what would change the picture?');
        };
    };

    // ── Sankey (own SVG: nodes by depth, links ∝ amount) ──
    AL.sankey = function (box) {
        var sk = A.sankey(AL.res, 60);
        if (!sk.links.length) { box.innerHTML = '<p class="sm muted">No flows — the rules moved nothing for these periods.</p>'; return; }
        var maxD = 0; sk.nodes.forEach(function (n) { if (n.depth > maxD) maxD = n.depth; });
        var cols = []; sk.nodes.forEach(function (n) { (cols[n.depth] = cols[n.depth] || []).push(n); });
        var W = 1000, colW = 14, padY = 6, H = Math.max(260, Math.min(900, Math.max.apply(null, cols.map(function (c) { return c ? c.length : 0; })) * 26));
        var maxSum = Math.max.apply(null, cols.map(function (c) { return (c || []).reduce(function (a, n) { return a + n.size; }, 0); }));
        var k = (H - 20 - padY * Math.max.apply(null, cols.map(function (c) { return (c || []).length; }))) / (maxSum || 1);
        var x = function (d) { return maxD ? 10 + d * (W - 200 - colW) / maxD : 10; }, byId = {};
        cols.forEach(function (c, d) {
            if (!c) return; c.sort(function (a, b) { return b.size - a.size; });
            var y = 10; c.forEach(function (n) { n.x = x(d); n.y = y; n.h = Math.max(2, n.size * k); n.oy = 0; n.iy = 0; y += n.h + padY; byId[n.id] = n; });
        });
        var rules = (AL.model().rules || []).map(function (r) { return r.id; }), pal = FL.PAL.series;
        var lbl = function (id) { var p = id.split('='); return p.length === 2 ? AL.vname(p[0], p[1]) : id; };
        var paths = sk.links.map(function (l) {
            var a = byId[l.from], b = byId[l.to]; if (!a || !b) return '';
            var w = Math.max(1, Math.abs(l.amount) * k), y1 = a.y + a.oy + w / 2, y2 = b.y + b.iy + w / 2; a.oy += w; b.iy += w;
            var x1 = a.x + colW, x2 = b.x, mx = (x1 + x2) / 2, c = pal[rules.indexOf(l.rule) % pal.length] || '#64748b';
            return '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" stroke="' + c + '" stroke-width="' + w.toFixed(1) + '" fill="none" stroke-opacity=".35"><title>' +
                esc(AL.ruleName(l.rule) + ': ' + lbl(l.from) + ' → ' + lbl(l.to) + ' · ' + FL.num(l.amount)) + '</title></path>';
        }).join('');
        var nodes = sk.nodes.map(function (n) {
            var right = n.depth === maxD && maxD > 0, f = n.id.split('=')[0];
            return '<g><rect x="' + n.x + '" y="' + n.y + '" width="' + colW + '" height="' + n.h.toFixed(1) + '" rx="2" fill="#0f172a" fill-opacity=".75"><title>' + esc(AL.label(f) + ' ' + lbl(n.id) + ' · in ' + FL.num(n.inn) + ' · out ' + FL.num(n.out)) + '</title></rect>' +
                '<text x="' + (right ? n.x - 4 : n.x + colW + 4) + '" y="' + (n.y + n.h / 2 + 4) + '" font-size="11" text-anchor="' + (right ? 'end' : 'start') + '" fill="currentColor">' + esc(lbl(n.id).slice(0, 34)) + '</text></g>';
        }).join('');
        box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="xMinYMin meet">' + paths + nodes + '</svg>' +
            '<div class="sm muted">' + (AL.model().rules || []).filter(function (r) { return r.active !== false; }).map(function (r) { return '<span class="al-key" style="background:' + (pal[rules.indexOf(r.id) % pal.length]) + '"></span>' + esc(r.name); }).join(' &nbsp; ') + '</div>';
    };

    // ── value picker (search + ticks) ──
    AL.picker = function (id, field, sel, opts) {
        opts = opts || {}; sel = (sel || []).map(String);
        var vals = field ? AL.values(field) : [];
        return '<div class="al-pick" id="' + id + '" data-f="' + esc(field || '') + '"><input type="search" placeholder="Search ' + esc(AL.label(field || '')) + ' (' + vals.length + ')"> <a class="sm" data-a="all">tick shown</a> · <a class="sm" data-a="none">clear</a> <span class="sm muted al-pc"></span>' +
            '<div class="al-pl">' + vals.map(function (v) {
                return '<label data-s="' + esc((v.value + ' ' + ((AL.names[field] || {})[v.value] || '')).toLowerCase()) + '"><input type="checkbox" value="' + esc(v.value) + '"' + (sel.indexOf(String(v.value)) >= 0 ? ' checked' : '') + '> ' + esc(AL.vname(field, v.value)) +
                    (opts.amounts !== false && (v.cost || v.rev) ? ' <span class="muted">' + (v.cost ? 'cost ' + FL.compact(v.cost) : '') + (v.rev ? ' rev ' + FL.compact(v.rev) : '') + '</span>' : '') + '</label>';
            }).join('') + '</div></div>';
    };
    AL.wirePicker = function (box) {
        if (!box) return;
        var count = function () { box.querySelector('.al-pc').textContent = box.querySelectorAll('.al-pl input:checked').length + ' ticked'; };
        box.querySelector('input[type=search]').oninput = function () { var q = this.value.toLowerCase(); box.querySelectorAll('.al-pl label').forEach(function (l) { l.style.display = !q || l.dataset.s.indexOf(q) >= 0 ? '' : 'none'; }); };
        box.querySelectorAll('[data-a]').forEach(function (a) { a.onclick = function () { var on = a.dataset.a === 'all'; box.querySelectorAll('.al-pl label').forEach(function (l) { if (l.style.display !== 'none') l.querySelector('input').checked = on; }); count(); }; });
        box.querySelector('.al-pl').onchange = count; count();
    };
    AL.picked = function (box) { return box ? [].map.call(box.querySelectorAll('.al-pl input:checked'), function (x) { return x.value; }) : []; };
    var specIn = function (s) { return s == null ? '' : typeof s === 'object' && !Array.isArray(s) ? (s.type ? 'type:' + s.type : '') + (s['class'] ? (s.type ? '; ' : '') + 'class:' + [].concat(s['class']).join('|') : '') : Array.isArray(s) ? s.join(', ') : String(s); };
    var specOut = function (t) {
        t = String(t || '').trim(); if (!t) return null;
        var m = /^type:\s*([A-Z]+)(?:;\s*class:(.+))?$/i.exec(t); if (m) { var o = { type: m[1].toUpperCase() }; if (m[2]) o['class'] = m[2].split('|').map(function (x) { return x.trim(); }); return o; }
        var c = /^class:(.+)$/i.exec(t); if (c) return { 'class': c[1].split('|').map(function (x) { return x.trim(); }) };
        return t;
    };


    // ── exports ──
    AL.journalCsv = function () {
        if (!AL.res) return;
        var used = AL.usedFields(), jr = A.journal(AL.res, used);
        FL.csv('allocation-journal-' + AL.model().name.replace(/\W+/g, '-') + '.csv', ['rule', 'company', 'account'].concat(used.map(AL.label)).concat(['debit', 'credit']),
            jr.map(function (o) { return [AL.ruleName(o.rule), o.company, o.account].concat(used.map(function (f) { return o.dims[f]; })).concat([o.dr.toFixed(2), o.cr.toFixed(2)]); }));
    };
    AL.excel = function () {
        if (!window.ExcelJS || !AL.res) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var m = AL.model(), res = AL.res, wb = new ExcelJS.Workbook(), hdr = function (ws, cols) { var r = ws.addRow(cols); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13315C' } }; }); };
        var field = AL.st.field || AL.mainField();
        var ws = wb.addWorksheet('By ' + AL.label(field).slice(0, 25)); ws.addRow([m.name + ' — before and after by ' + AL.label(field)]).font = { bold: true, size: 13 };
        hdr(ws, [AL.label(field), 'Revenue', 'Direct cost', 'Allocated in', 'Allocated out', 'Fully loaded cost', 'Result before', 'Result after', 'Margin before %', 'Margin after %']);
        A.summary(res, field).forEach(function (o) { ws.addRow([AL.vname(field, o.value), o.revenue, o.direct, o.inAmt, o.outAmt, o.loaded, o.before, o.after, o.mBefore == null ? null : o.mBefore / 100, o.mAfter == null ? null : o.mAfter / 100]); });
        ws.columns.forEach(function (c, j) { c.width = j ? 16 : 34; if (j) c.numFmt = j >= 8 ? '0.0%' : '#,##0;(#,##0)'; });
        var w2 = wb.addWorksheet('Rules'); hdr(w2, ['#', 'Rule', 'What it does', 'Pool', 'Allocated', 'Not allocated', 'Receivers', 'Notes']);
        (m.rules || []).forEach(function (r, j) { var s = res.steps.filter(function (x) { return x.rule === r.id; })[0] || {}; w2.addRow([j + 1, r.name, A.describe(r, AL.label), s.pool, s.allocated, s.unallocated, s.nTargets, (s.warn || []).join(' · ') || (r.active === false ? 'off' : '')]); });
        w2.columns.forEach(function (c, j) { c.width = j === 2 ? 70 : j === 1 ? 30 : 14; });
        var used = AL.usedFields(), w3 = wb.addWorksheet('Journal'); hdr(w3, ['Rule', 'Company', 'Account'].concat(used.map(AL.label)).concat(['Debit', 'Credit']));
        A.journal(res, used).forEach(function (o) { w3.addRow([AL.ruleName(o.rule), o.company, o.account].concat(used.map(function (f) { return o.dims[f]; })).concat([o.dr, o.cr])); });
        (m.drivers || []).forEach(function (d) { var w = wb.addWorksheet(('Driver ' + d.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)); hdr(w, [AL.label(d.field), d.unit || 'value']); Object.keys(d.values || {}).forEach(function (k) { w.addRow([AL.vname(d.field, k), d.values[k]]); }); });
        wb.xlsx.writeBuffer().then(function (buf) { FL.download('cost-allocation-' + m.name.replace(/\W+/g, '-') + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };

    // ── AI: propose rules ──
    AL.GUIDE = 'Answer with ONE ```alloc block holding JSON {"rules":[…],"drivers":[…],"virtual":[…]} (only what you add). rule = {"name","pool":{"accounts": [list of account codes from expenseAccounts],"where":{"<field>":["values"]},"pct":100},' +
        '"to":{"field":"<field>","method":"fixed|even|gl|driver","targets":[values] or for fixed [{"value","pct"}],"exclude":[values],"gl":{"accounts":"type:R"},"driver":"<driver id>","perCompany":true},"stepDown":true}. ' +
        'driver = {"id","name","unit","field","values":{"<value>":number}} — only with numbers you can justify from the data (e.g. revenue, counts of rows); otherwise leave values empty and say what the user must fill. virtual = {"id","name","values":[…]} for activities / cost objects not in the GL. ' +
        'Rules run in order (step-down: support / head-office pools first, then activities, then cost objects). Use only fields and values from the context. Explain each rule in one line before the block.';
    AL.aiDialog = function () {
        var m = AL.model();
        FL.modal('<i class="fa-solid fa-wand-magic-sparkles"></i> Propose allocation rules', '<p class="sm">The Copilot looks at your ' + esc(AL.allFields().map(function (f) { return f.name; }).join(', ')) + ' values and expense accounts for the loaded periods and proposes rules. You see them before anything changes.</p>' +
            '<textarea id="ai-q" rows="4" style="width:100%">' + esc((m.rules || []).length ? 'Review my rules and propose what is missing so every overhead lands on the business lines that cause it.' : 'Propose a step-down allocation: head-office and support costs first, then a fair split onto the business lines by the best driver for each cost.') + '</textarea>' +
            '<div class="row" style="gap:6px;flex-wrap:wrap" id="ai-q2">' + ['ABC: cost centres → activities → salespeople', 'Spread blank / default values by revenue', 'Allocate IT by headcount', 'Check my rules for double counting'].map(function (q) { return '<button class="chip">' + esc(q) + '</button>'; }).join('') + '</div><div id="ai-out" style="margin-top:10px"></div>',
            '<button class="btn sm primary" id="ai-go"><i class="fa-solid fa-paper-plane"></i> Propose</button>');
        $('ai-q2').querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { $('ai-q').value = c.textContent; }; });
        $('ai-go').onclick = function () {
            if (AL.busy) return; AL.busy = true;
            var out = $('ai-out'), steps = [];
            out.innerHTML = '<div class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Thinking… <a id="ai-stop">stop</a></div><div class="sm muted" id="ai-st"></div>';
            $('ai-stop').onclick = function () { FL.call('finAskCancel', {}).catch(function () { /* ended */ }); };
            FL.call('finAsk', { question: $('ai-q').value + '\n\n' + AL.GUIDE, history: [], context: JSON.stringify(AL.aiContext()) }, 11 * 60000, function (msg) { steps.push(msg); if ($('ai-st')) $('ai-st').textContent = msg; })
                .then(function (r) { AL.aiShow(r.answer || '', r.costUsd); })
                .catch(function (e) { out.innerHTML = '<div class="callout bad sm">' + esc(String(e && e.message || e)) + '</div>'; })
                .then(function () { AL.busy = false; });
        };
    };
    AL.aiContext = function () {
        var m = AL.model(), ctx = { page: 'Cost allocation', model: { name: m.name, rules: m.rules, drivers: (m.drivers || []).map(function (d) { return { id: d.id, name: d.name, field: d.field, unit: d.unit, n: Object.keys(d.values || {}).length }; }), virtual: m.virtual },
            periods: AL.st.periods, fields: AL.allFields().map(function (f) { return { id: f.id, name: f.name, inGL: !f.virtual }; }), values: {}, expenseAccounts: [], source: m.source === 'cc' ? 'fin_balances (company × cost_centre × account)' : 'fin_gl_ext_v ledger ' + (AL.led || {}).ledger_id };
        AL.allFields().forEach(function (f) { ctx.values[f.id] = AL.values(f.id).slice(0, 40).map(function (v) { return { value: v.value, name: (AL.names[f.id] || {})[v.value] || '', cost: Math.round(v.cost), revenue: Math.round(v.rev) }; }); });
        var acc = {}, byCode = {}; (FL.dims.accounts || []).forEach(function (a) { byCode[a.code] = a; });
        (AL.rows || []).forEach(function (r) { if (r.type === 'E') acc[r.account] = (acc[r.account] || 0) + r.amount; });
        ctx.expenseAccounts = Object.keys(acc).sort(function (a, b) { return Math.abs(acc[b]) - Math.abs(acc[a]); }).slice(0, 60).map(function (c) { var a = byCode[c] || {}; return { code: c, name: a.name || '', class: a['class'] || '', amount: Math.round(acc[c]) }; });
        if (AL.res) ctx.lastRun = AL.res.steps.map(function (s) { return { rule: s.name, pool: Math.round(s.pool || 0), allocated: Math.round(s.allocated || 0), notAllocated: Math.round(s.unallocated || 0), warnings: s.warn }; });
        return ctx;
    };
    AL.aiParse = function (text) {
        var mm = /```alloc\s*([\s\S]*?)```/.exec(text || '') || /```json\s*(\{[\s\S]*?"rules"[\s\S]*?\})\s*```/.exec(text || '');
        if (!mm) return null;
        try {
            var o = JSON.parse(mm[1]); if (!o || !Array.isArray(o.rules)) return null;
            o.rules.forEach(function (r) { r.id = A.uid('r'); if (r.pool && typeof r.pool.accounts === 'string') r.pool.accounts = specOut(r.pool.accounts); if (r.to && r.to.gl && typeof r.to.gl.accounts === 'string') r.to.gl.accounts = specOut(r.to.gl.accounts); });
            return o;
        } catch (e) { return null; }
    };
    AL.aiShow = function (answer, cost) {
        var out = $('ai-out'); if (!out) return;
        var p = AL.aiParse(answer), m = AL.model();
        out.innerHTML = '<div class="cop-md">' + FL.copilot.md(answer.replace(/```alloc[\s\S]*?```/, ''), 990) + '</div>' + (cost ? '<div class="sm muted">cost $' + (+cost).toFixed(3) + '</div>' : '') +
            (p ? '<div class="callout sm"><b>' + p.rules.length + ' rule(s)</b>' + ((p.drivers || []).length ? ', ' + p.drivers.length + ' driver table(s)' : '') + ((p.virtual || []).length ? ', ' + p.virtual.length + ' dimension(s)' : '') + ':<ol>' +
                p.rules.map(function (r) { return '<li><b>' + esc(r.name || '') + '</b> — ' + esc(A.describe(r, AL.label)) + '</li>'; }).join('') + '</ol>' +
                '<button class="btn sm primary" id="ai-add"><i class="fa-solid fa-plus"></i> Add to this model</button> <button class="btn sm" id="ai-rep">Replace the rules</button> <button class="btn sm" id="ai-new">As a new model</button></div>'
                : '<div class="callout warn sm">No ```alloc block in the answer — ask again, or add the rules by hand.</div>');
        if (!p) return;
        var apply = function (target, replace) {
            if (replace) target.rules = [];
            target.rules = (target.rules || []).concat(p.rules);
            (p.drivers || []).forEach(function (d) { d.id = d.id || A.uid('d'); d.values = d.values || {}; target.drivers = (target.drivers || []).filter(function (x) { return x.id !== d.id; }).concat([d]); });
            (p.virtual || []).forEach(function (v) { target.virtual = (target.virtual || []).filter(function (x) { return x.id !== v.id; }).concat([v]); });
            AL.dirty = true; FL.closeModal(); AL.changed(); FL.toast(p.rules.length + ' rule(s) added — check them, then Save', 'ok');
        };
        $('ai-add').onclick = function () { apply(m, false); };
        $('ai-rep').onclick = function () { if (confirm('Replace the ' + (m.rules || []).length + ' rule(s) of this model?')) apply(m, true); };
        $('ai-new').onclick = function () { var x = AL.newModel(m.name + ' (AI)'); x.source = m.source; x.ledger = m.ledger; AL.doc.models.push(x); AL.st.model = x.id; save(); apply(x, false); };
    };
    AL.context = function () { return AL.doc ? AL.aiContext() : null; };
})();
