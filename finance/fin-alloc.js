/* Finance Lens — Cost allocation & activity-based costing (tab `alloc`, FL.alloc = AL; engine finance/fin-alloc-engine.js FALLOC).
   Models (several: "Monthly overheads", "ABC customer profitability" …) live in {root}\alloc.json (finDocGet / finDocSave name `alloc`):
   ordered rules (pool of accounts on some dimension values → receivers on a dimension by fixed %, evenly, a GL driver, a driver table
   or the receivers' own costs), driver tables (headcount, m², orders …) and virtual dimensions (activities, products — not in the GL).
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

    AL.STARTERS = [
        { id: 'support', icon: 'fa-building', name: 'Spread a support cost centre', sub: 'e.g. HR / IT / admin costs to the cost centres they serve, by headcount',
          make: function () { return { name: 'Support costs by headcount', pool: { accounts: { type: 'E' }, where: {} }, to: { field: AL.mainField(), method: 'driver', driver: '' }, stepDown: true }; } },
        { id: 'revenue', icon: 'fa-sack-dollar', name: 'Overheads by revenue share', sub: 'costs on blank / default values spread by each receiver’s revenue',
          make: function () { return { name: 'Overheads by revenue', pool: { accounts: { type: 'E' }, where: {} }, to: { field: AL.mainField(), method: 'gl', gl: { accounts: { type: 'R' } } }, stepDown: true }; } },
        { id: 'fixed', icon: 'fa-percent', name: 'Fixed percentages', sub: 'an agreed split, e.g. 60 / 40',
          make: function () { return { name: 'Agreed split', pool: { accounts: { type: 'E' }, where: {} }, to: { field: AL.mainField(), method: 'fixed', targets: [] }, stepDown: true }; } },
        { id: 'abc1', icon: 'fa-gears', name: 'ABC step 1: resources → activities', sub: 'what share of each cost centre’s time goes to which activity',
          make: function () { AL.ensureVirtual('activity', 'Activity', ['Order handling', 'Picking & packing', 'Delivery', 'Customer service']); return { name: 'Resources to activities', pool: { accounts: { type: 'E' }, where: {} }, to: { field: 'activity', method: 'fixed', targets: [] }, stepDown: true }; } },
        { id: 'abc2', icon: 'fa-users', name: 'ABC step 2: activities → cost objects', sub: 'activity cost to customers / salespeople / products by their driver (orders, deliveries …)',
          make: function () { AL.ensureVirtual('activity', 'Activity', ['Order handling', 'Picking & packing', 'Delivery', 'Customer service']); return { name: 'Activities to cost objects', pool: { where: { activity: [] } }, to: { field: AL.mainField(), method: 'driver', driver: '' }, stepDown: true }; } },
        { id: 'blank', icon: 'fa-plus', name: 'Blank rule', sub: 'start from nothing', make: function () { return { name: 'New rule', pool: { where: {} }, to: { field: AL.mainField(), method: 'even' }, stepDown: true }; } }
    ];

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

    // ── page ──
    FL.TABS.alloc = {
        render: function (el) {
            AL.el = el;
            if (!(FL.status && FL.status.loaded)) { el.innerHTML = '<div class="empty">Load or sync data first (Data › Trial balance sync).</div>'; return; }
            el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading the allocation models…</div>';
            return AL.load().then(AL.meta).then(function () { return AL.loadRows(); }).then(function (rows) { AL.rows = rows; AL.run(); AL.paint(); })
                .catch(function (e) { el.innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
        }
    };
    AL.reload = function () { AL.loadRows().then(function (rows) { AL.rows = rows; AL.run(); AL.paint(); }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); }); };

    AL.paint = function () {
        var el = AL.el, m = AL.model(), res = AL.res, per = AL.st.periods || [];
        var pname = function (q) { var p = (AL.periods || []).filter(function (x) { return x.seq === q; })[0]; return p ? p.name : q; };
        var srcSel = '<select id="al-src"><option value="cc"' + (m.source === 'cc' ? ' selected' : '') + '>Cost centres (trial balance)</option>' +
            (AL.leds || [null]).filter(Boolean).map(function (l) { return '<option value="seg:' + l.ledger_id + '"' + (m.source === 'seg' && String(m.ledger) === String(l.ledger_id) ? ' selected' : '') + '>Segments · ' + esc(l.name || l.ledger_id) + '</option>'; }).join('') +
            (!(AL.leds || []).length ? '<option disabled>Segments: none synced (Data › Trial balance sync › Extended segments)</option>' : '') + '</select>';
        var chips = (AL.periods || []).slice(-24).map(function (p) { return '<button class="chip' + (per.indexOf(p.seq) >= 0 ? ' on' : '') + '" data-p="' + p.seq + '">' + esc(p.name) + '</button>'; }).join('');
        var head = '<div class="card al-top"><div class="row" style="gap:6px;flex-wrap:wrap">' +
            '<b><i class="fa-solid fa-share-nodes"></i> Model</b><select id="al-model">' + AL.doc.models.map(function (x) { return '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
            '<button class="btn sm" id="al-new" title="New model"><i class="fa-solid fa-plus"></i></button><button class="btn sm" id="al-dup" title="Duplicate"><i class="fa-solid fa-clone"></i></button>' +
            '<button class="btn sm" id="al-ren" title="Rename"><i class="fa-solid fa-pen"></i></button><button class="btn sm" id="al-del" title="Delete"><i class="fa-solid fa-trash"></i></button>' +
            '<span class="muted sm">Data</span>' + srcSel + '<span class="grow"></span>' +
            '<button class="btn sm" id="al-ai"><i class="fa-solid fa-wand-magic-sparkles"></i> Propose rules with AI</button>' +
            '<button class="btn sm" id="al-xl"' + (res ? '' : ' disabled') + '><i class="fa-solid fa-file-excel"></i> Excel</button>' +
            '<button class="btn sm" id="al-jr"' + (res ? '' : ' disabled') + '><i class="fa-solid fa-file-csv"></i> Journal</button>' +
            '<button class="btn sm primary" id="al-save"><i class="fa-solid fa-floppy-disk"></i> Save' + (AL.dirty ? ' *' : '') + '</button></div>' +
            '<div class="row al-pers" style="gap:4px;flex-wrap:wrap;margin-top:8px"><span class="muted sm">Periods</span>' + (chips || '<span class="muted sm">none synced for this data</span>') +
            '<a class="sm" id="al-pcur">current</a><a class="sm" id="al-pytd">year to date</a><span class="muted sm">· ' + per.map(pname).join(', ') + (FL.filter.company ? ' · company ' + esc(FL.filter.company) : '') + ' · ' + (AL.rows || []).length.toLocaleString() + ' income statement rows</span></div></div>';
        el.innerHTML = head + '<div class="al-grid"><div class="al-left" id="al-left"></div><div class="al-right" id="al-right"></div></div>';
        AL.paintLeft(); AL.paintRight(); AL.wireTop();
    };
    AL.wireTop = function () {
        var m = AL.model();
        $('al-model').onchange = function () { AL.st.model = this.value; AL.st.field = null; save(); AL.res = null; FL.render(); };
        $('al-new').onclick = function () { var n = prompt('Name of the new allocation model', 'ABC customer profitability'); if (!n) return; var x = AL.newModel(n); x.source = m.source; x.ledger = m.ledger; AL.doc.models.push(x); AL.st.model = x.id; save(); AL.dirty = true; FL.render(); };
        $('al-dup').onclick = function () { var x = clone(m); x.id = A.uid('m'); x.name = m.name + ' (copy)'; AL.doc.models.push(x); AL.st.model = x.id; save(); AL.dirty = true; FL.render(); };
        $('al-ren').onclick = function () { var n = prompt('Rename the model', m.name); if (n) { m.name = n; AL.dirty = true; AL.paint(); } };
        $('al-del').onclick = function () {
            if (AL.doc.models.length < 2) { FL.toast('Keep at least one model', 'warn'); return; }
            if (!confirm('Delete the model "' + m.name + '" and its rules?')) return;
            AL.doc.models = AL.doc.models.filter(function (x) { return x !== m; }); AL.st.model = AL.doc.models[0].id; save(); AL.store().then(function () { FL.render(); });
        };
        $('al-src').onchange = function () {
            var v = this.value; if (v === 'cc') m.source = 'cc'; else { m.source = 'seg'; if (v.indexOf(':') > 0) m.ledger = v.split(':')[1]; }
            AL.dirty = true; AL.st.periods = []; save(); FL.render();
        };
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
        $('al-save').onclick = function () { AL.store().then(function () { FL.toast('Allocation models saved', 'ok'); AL.paint(); }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); }); };
        $('al-ai').onclick = AL.aiDialog;
        $('al-xl').onclick = AL.excel;
        $('al-jr').onclick = AL.journalCsv;
    };

    // ── left: rules, drivers, virtual dimensions ──
    AL.paintLeft = function () {
        var m = AL.model(), res = AL.res, st = {};
        (res ? res.steps : []).forEach(function (s) { st[s.rule] = s; });
        var rules = (m.rules || []).map(function (r, i) {
            var s = st[r.id], warn = s && s.warn && s.warn.length;
            return '<div class="al-rule' + (r.active === false ? ' off' : '') + '" data-i="' + i + '"><div class="row" style="gap:6px"><span class="al-n">' + (i + 1) + '</span><b class="grow">' + esc(r.name || 'Rule') + '</b>' +
                '<label class="sm" title="On / off"><input type="checkbox" class="al-on"' + (r.active === false ? '' : ' checked') + '></label>' +
                '<button class="btn sm ghost" data-a="up" title="Earlier">▲</button><button class="btn sm ghost" data-a="down" title="Later">▼</button>' +
                '<button class="btn sm ghost" data-a="edit" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="btn sm ghost" data-a="del" title="Delete"><i class="fa-solid fa-trash"></i></button></div>' +
                '<div class="sm muted">' + esc(A.describe(r, AL.label)) + '</div>' +
                (s && !s.skipped ? '<div class="sm">' + (warn ? '<span class="tag warn">' + esc(s.warn.join(' · ')) + '</span> ' : '') + 'moved <b>' + money(s.allocated) + '</b> to ' + s.nTargets + ' receiver(s)' + (Math.abs(s.net) < 0.01 ? ' <span class="tag good">nets to 0</span>' : ' <span class="tag bad">off by ' + money(s.net) + '</span>') + '</div>' : '') + '</div>';
        }).join('');
        var drivers = (m.drivers || []).map(function (d, i) {
            var n = Object.keys(d.values || {}).length, tot = 0; Object.keys(d.values || {}).forEach(function (k) { tot += +d.values[k] || 0; });
            return '<div class="al-drv" data-i="' + i + '"><b>' + esc(d.name || d.id) + '</b> <span class="muted sm">' + esc(AL.label(d.field)) + ' · ' + n + ' value(s) · total ' + tot.toLocaleString() + ' ' + esc(d.unit || '') + '</span>' +
                ' <a class="sm" data-a="edit">edit</a> · <a class="sm" data-a="del">delete</a></div>';
        }).join('');
        var virt = (m.virtual || []).map(function (v, i) { return '<div class="al-drv" data-i="' + i + '"><b>' + esc(v.name || v.id) + '</b> <span class="muted sm">' + (v.values || []).length + ' value(s): ' + esc((v.values || []).slice(0, 5).join(', ')) + ((v.values || []).length > 5 ? ' …' : '') + '</span> <a class="sm" data-a="edit">edit</a> · <a class="sm" data-a="del">delete</a></div>'; }).join('');
        $('al-left').innerHTML = '<div class="card"><h3><i class="fa-solid fa-list-ol"></i> Rules <small>run in this order — a later rule can move what an earlier one allocated (step-down)</small></h3>' +
            (rules || '<p class="sm muted">No rules yet. Start with one of the patterns below, or let the AI propose a set from your cost centres and accounts.</p>') +
            '<div class="al-starters">' + AL.STARTERS.map(function (s) { return '<button class="al-st" data-s="' + s.id + '"><i class="fa-solid ' + s.icon + '"></i><b>' + esc(s.name) + '</b><span>' + esc(s.sub) + '</span></button>'; }).join('') + '</div></div>' +
            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-ruler"></i> Driver tables <small>headcount, m², orders, deliveries …</small><span class="grow"></span><button class="btn sm" id="al-dnew"><i class="fa-solid fa-plus"></i> Driver</button></h3>' +
            (drivers || '<p class="sm muted">A driver gives every receiver a number; the cost is shared in proportion. Paste them from Excel.</p>') + '</div>' +
            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-diagram-project"></i> Activities &amp; cost objects <small>dimensions that are not in the GL (ABC)</small><span class="grow"></span><button class="btn sm" id="al-vnew"><i class="fa-solid fa-plus"></i> Dimension</button></h3>' +
            (virt || '<p class="sm muted">For activity-based costing: e.g. <i>Activity</i> = Order handling, Picking, Delivery. Cost centres → activities → customers / products.</p>') + '</div>';
        var L = $('al-left');
        L.querySelectorAll('.al-rule').forEach(function (card) {
            var i = +card.dataset.i, r = m.rules[i];
            card.querySelector('.al-on').onchange = function () { r.active = this.checked; AL.changed(); };
            card.querySelectorAll('[data-a]').forEach(function (b) {
                b.onclick = function () {
                    var a = b.dataset.a;
                    if (a === 'edit') return AL.editRule(i);
                    if (a === 'del') { if (!confirm('Delete the rule "' + r.name + '"?')) return; m.rules.splice(i, 1); }
                    if (a === 'up' && i > 0) { m.rules.splice(i - 1, 0, m.rules.splice(i, 1)[0]); }
                    if (a === 'down' && i < m.rules.length - 1) { m.rules.splice(i + 1, 0, m.rules.splice(i, 1)[0]); }
                    AL.changed();
                };
            });
        });
        L.querySelectorAll('.al-st').forEach(function (b) { b.onclick = function () { var s = AL.STARTERS.filter(function (x) { return x.id === b.dataset.s; })[0], r = s.make(); r.id = A.uid('r'); m.rules.push(r); AL.editRule(m.rules.length - 1, true); }; });
        $('al-dnew').onclick = function () { AL.editDriver(-1); };
        $('al-vnew').onclick = function () { AL.editVirtual(-1); };
        L.querySelectorAll('.card:nth-child(2) .al-drv [data-a]').forEach(function (a) { a.onclick = function () { var i = +a.closest('.al-drv').dataset.i; if (a.dataset.a === 'edit') AL.editDriver(i); else if (confirm('Delete this driver?')) { m.drivers.splice(i, 1); AL.changed(); } }; });
        L.querySelectorAll('.card:nth-child(3) .al-drv [data-a]').forEach(function (a) { a.onclick = function () { var i = +a.closest('.al-drv').dataset.i; if (a.dataset.a === 'edit') AL.editVirtual(i); else if (confirm('Delete this dimension? Rules that use it stop working.')) { m.virtual.splice(i, 1); AL.changed(); } }; });
    };
    AL.changed = function () { AL.dirty = true; AL.run(); AL.paint(); };

    // ── right: results ──
    AL.paintRight = function () {
        var R = $('al-right'), res = AL.res, m = AL.model();
        if (AL.err) { R.innerHTML = '<div class="callout bad">' + esc(AL.err) + '</div>'; return; }
        if (!AL.rows || !AL.rows.length) { AL.whyEmpty(R); return; }
        var exp = 0, rev = 0; AL.rows.forEach(function (r) { if (r.type === 'E') exp += r.amount; else rev -= r.amount; });
        var note = AL.coNote ? '<div class="callout warn sm"><i class="fa-solid fa-circle-info"></i> ' + esc(AL.coNote) + '</div>' : '';
        if (!res || !(m.rules || []).length) {
            R.innerHTML = note + '<div class="kpis">' + kpi('Revenue', money(rev)) + kpi('Expenses', money(exp)) + kpi('Result', money(rev - exp)) + kpi('Rules', '0', 'add one on the left') + '</div>' +
                '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-table"></i> What you can allocate — the trial balance by <select id="al-fld0">' + AL.allFields().filter(function (f) { return !f.virtual; }).map(function (f) { return '<option value="' + f.id + '"' + (f.id === (AL.st.field || AL.mainField()) ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select>' +
                '<small>income statement accounts of the chosen periods</small></h3><div id="al-d0"></div></div>' +
                '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-list"></i> Expense accounts <small>the costs rules can move</small></h3><div id="al-d1"></div></div>' +
                '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-lightbulb"></i> How it works</h3><ol class="sm al-how">' +
                '<li><b>Pool</b> — which costs move: accounts (e.g. every expense) on some values (e.g. cost centre 900 Head office).</li>' +
                '<li><b>Receivers</b> — the dimension they move to (cost centre, salesperson, an activity …) and how: fixed %, evenly, by a GL driver (their revenue), a driver table (headcount, m², orders) or their own costs.</li>' +
                '<li><b>Order</b> — rules run one after another: support departments first, then activities, then customers / products (step-down, ABC).</li>' +
                '<li><b>Result</b> — before / after per receiver, the flows, journal lines to export. Every rule nets to zero, so the total profit never changes.</li></ol></div>';
            AL.dataView();
            $('al-fld0').onchange = function () { AL.st.field = this.value; save(); AL.dataView(); };
            return;
        }
        var moved = 0, un = 0, nT = {}; res.steps.forEach(function (s) { if (s.skipped) return; moved += s.allocated; un += s.unallocated; Object.keys(s.targets || {}).forEach(function (v) { nT[v] = 1; }); });
        var flds = AL.allFields(), lastTo = ((m.rules || []).filter(function (r) { return r.active !== false; }).slice(-1)[0] || {}).to || {};
        var field = AL.st.field && flds.some(function (f) { return f.id === AL.st.field; }) ? AL.st.field : lastTo.field || AL.mainField();
        var sum = A.summary(res, field), loss = sum.filter(function (o) { return o.revenue > 0 && o.before >= 0 && o.after < 0; });
        R.innerHTML = note + '<div class="kpis">' + kpi('Expenses in scope', money(exp)) + kpi('Cost moved', money(moved), res.steps.filter(function (s) { return !s.skipped; }).length + ' step(s) · cost can move twice (step-down / ABC)') +
            kpi('Not allocated', money(un), un ? 'no driver for some pools' : 'everything placed', Math.abs(un) >= 0.5 ? 'neg' : 'pos') +
            kpi('Receivers', Object.keys(nT).length) + kpi('Check', res.ok ? '✓ OK' : '✗', res.ok ? 'profit unchanged by every rule' : 'a rule does not net to zero', res.ok ? 'pos' : 'neg') + '</div>' +
            (res.warnings.length ? '<div class="callout warn sm"><i class="fa-solid fa-triangle-exclamation"></i> ' + res.warnings.map(esc).join('<br>') + '</div>' : '') +
            (loss.length ? '<div class="callout bad sm"><i class="fa-solid fa-arrow-trend-down"></i> <b>' + loss.length + ' ' + esc(AL.label(field)) + ' value(s) turn loss-making once costs are allocated</b>: ' + loss.slice(0, 6).map(function (o) { return esc(AL.vname(field, o.value)) + ' (' + money(o.after) + ')'; }).join(', ') + '</div>' : '') +
            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-water"></i> Where the cost flows <small>thickness = amount · biggest 60 flows · hover for details</small></h3><div id="al-sk" class="al-sk"></div></div>' +
            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-table"></i> Before and after by <select id="al-fld">' + flds.map(function (f) { return '<option value="' + f.id + '"' + (f.id === field ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select>' +
            '<small>click a row for what it gave and received</small></h3><div class="chartbox short"><canvas id="al-ch"></canvas></div><div id="al-sum"></div></div>' +
            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-shoe-prints"></i> Steps</h3><div id="al-steps"></div></div>' +
            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-book"></i> Allocation journal <small>debit receivers, credit the pools · export with Journal</small></h3><div id="al-lines"></div></div>';
        $('al-fld').onchange = function () { AL.st.field = this.value; save(); AL.paintRight(); };
        AL.sankey($('al-sk'));
        var cols = [{ label: AL.label(field), get: function (o) { return AL.vname(field, o.value); }, val: function (o) { return o.value; } },
            { label: 'Revenue', n: 1, key: 'revenue', get: function (o) { return money(o.revenue); }, val: function (o) { return o.revenue; } },
            { label: 'Direct cost', n: 1, get: function (o) { return money(o.direct); }, val: function (o) { return o.direct; } },
            { label: 'Allocated in', n: 1, get: function (o) { return money(o.inAmt); }, val: function (o) { return o.inAmt; } },
            { label: 'Allocated out', n: 1, get: function (o) { return money(o.outAmt); }, val: function (o) { return o.outAmt; } },
            { label: 'Fully loaded cost', n: 1, get: function (o) { return money(o.loaded); }, val: function (o) { return o.loaded; } },
            { label: 'Result before', n: 1, get: function (o) { return money(o.before); }, val: function (o) { return o.before; } },
            { label: 'Result after', n: 1, html: 1, get: function (o) { return '<span class="' + (o.after < 0 ? 'neg' : '') + '">' + money(o.after) + '</span>'; }, val: function (o) { return o.after; } },
            { label: 'Margin before %', n: 1, sum: false, get: function (o) { return pct(o.mBefore); }, val: function (o) { return o.mBefore; } },
            { label: 'Margin after %', n: 1, sum: false, get: function (o) { return pct(o.mAfter); }, val: function (o) { return o.mAfter; } }];
        FL.grid($('al-sum'), cols, sum, { id: 'al-sum', csv: 'allocation-' + field + '.csv', height: 420, click: function (o) { AL.trace(field, o.value); } });
        var top = sum.filter(function (o) { return o.revenue || o.loaded; }).slice(0, 15);
        FL.chart('al-ch', { type: 'bar', data: { labels: top.map(function (o) { return AL.vname(field, o.value).slice(0, 22); }), datasets: [
            { label: 'Result before', data: top.map(function (o) { return Math.round(o.before); }), backgroundColor: 'rgba(148,163,184,.7)' },
            { label: 'Result after allocation', data: top.map(function (o) { return Math.round(o.after); }), backgroundColor: top.map(function (o) { return o.after < 0 ? 'rgba(220,38,38,.75)' : 'rgba(29,78,216,.75)'; }) }] },
            options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: function (v) { return FL.compact(v); } } } } } });
        FL.grid($('al-steps'), [{ label: '#', get: function (s) { return String(res.steps.indexOf(s) + 1); } }, { label: 'Rule', key: 'name' },
            { label: 'Pool', n: 1, get: function (s) { return s.skipped ? 'off' : money(s.pool); }, val: function (s) { return s.pool; } },
            { label: 'Allocated', n: 1, get: function (s) { return money(s.allocated); }, val: function (s) { return s.allocated; } },
            { label: 'Not allocated', n: 1, get: function (s) { return money(s.unallocated); }, val: function (s) { return s.unallocated; } },
            { label: 'Receivers', n: 1, sum: false, get: function (s) { return s.nTargets == null ? '' : String(s.nTargets); }, val: function (s) { return s.nTargets; } },
            { label: 'Nets to 0', html: 1, get: function (s) { return s.skipped ? '' : Math.abs(s.net) < 0.01 ? '<span class="tag good">✓</span>' : '<span class="tag bad">' + money(s.net) + '</span>'; } },
            { label: 'Notes', get: function (s) { return (s.warn || []).join(' · '); } }], res.steps, { id: 'al-steps', totals: false });
        var used = AL.usedFields(), jr = A.journal(res, used);
        FL.grid($('al-lines'), [{ label: 'Rule', get: function (o) { return AL.ruleName(o.rule); } }, { label: 'Company', key: 'company' }, { label: 'Account', key: 'account' }]
            .concat(used.map(function (f) { return { label: AL.label(f), get: function (o) { return AL.vname(f, o.dims[f]); }, val: function (o) { return o.dims[f]; } }; }))
            .concat([{ label: 'Debit', n: 1, get: function (o) { return money(o.dr); }, val: function (o) { return o.dr; } }, { label: 'Credit', n: 1, get: function (o) { return money(o.cr); }, val: function (o) { return o.cr; } }]),
            jr, { id: 'al-lines', csv: 'allocation-journal.csv', height: 360 });
    };
    /** Before any rule: the trial balance rows by a dimension and the expense accounts */
    AL.dataView = function () {
        var f = $('al-fld0') ? $('al-fld0').value : AL.mainField(), by = {}, acc = {}, byCode = {};
        (FL.dims.accounts || []).forEach(function (a) { byCode[a.code] = a; });
        AL.rows.forEach(function (r) {
            var v = f === 'company' ? r.company : r.dims[f] == null ? '' : r.dims[f], o = by[v] = by[v] || { value: v, rev: 0, exp: 0 };
            if (r.type === 'R') o.rev -= r.amount; else { o.exp += r.amount; var a = acc[r.account] = acc[r.account] || { code: r.account, exp: 0, n: {} }; a.exp += r.amount; a.n[v] = 1; }
        });
        FL.grid($('al-d0'), [{ label: AL.label(f), get: function (o) { return AL.vname(f, o.value); }, val: function (o) { return o.value; } },
            { label: 'Revenue', n: 1, get: function (o) { return money(o.rev); }, val: function (o) { return o.rev; } },
            { label: 'Expenses', n: 1, get: function (o) { return money(o.exp); }, val: function (o) { return o.exp; } },
            { label: 'Result', n: 1, html: 1, get: function (o) { return '<span class="' + (o.rev - o.exp < 0 ? 'neg' : '') + '">' + money(o.rev - o.exp) + '</span>'; }, val: function (o) { return o.rev - o.exp; } }],
            Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.exp - a.exp; }), { id: 'al-d0', csv: 'allocation-data.csv', height: 380 });
        FL.grid($('al-d1'), [{ label: 'Account', key: 'code' }, { label: 'Name', get: function (a) { return (byCode[a.code] || {}).name || ''; } }, { label: 'Class', get: function (a) { return (byCode[a.code] || {})['class'] || ''; } },
            { label: 'Amount', n: 1, get: function (a) { return money(a.exp); }, val: function (a) { return a.exp; } },
            { label: AL.label(f) + ' values', n: 1, sum: false, get: function (a) { return String(Object.keys(a.n).length); }, val: function (a) { return Object.keys(a.n).length; } }],
            Object.keys(acc).map(function (k) { return acc[k]; }).sort(function (a, b) { return b.exp - a.exp; }), { id: 'al-d1', csv: 'allocation-expense-accounts.csv', height: 320 });
    };
    /** Nothing to allocate: say why (no periods, the company filter, only balance sheet rows, nothing synced) */
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

    // ── rule editor ──
    AL.editRule = function (i, isNew) {
        var m = AL.model(), r = clone(m.rules[i]); r.pool = r.pool || {}; r.pool.where = r.pool.where || {}; r.to = r.to || {};
        var flds = AL.allFields(), wf = Object.keys(r.pool.where).filter(function (k) { return k !== 'company'; })[0] || (r.to.field === 'activity' ? AL.mainField() : AL.mainField());
        var fsel = function (id, cur, any) { return '<select id="' + id + '">' + (any ? '<option value="">— none —</option>' : '') + flds.map(function (f) { return '<option value="' + f.id + '"' + (f.id === cur ? ' selected' : '') + '>' + esc(f.name) + (f.virtual ? ' (not in GL)' : '') + '</option>'; }).join('') + '</select>'; };
        var html = '<div class="al-ed"><label>Name <input id="re-name" value="' + esc(r.name || '') + '" style="width:60%"></label>' +
            '<div class="al-sec"><h4>1 · Pool — which costs move</h4>' +
            '<label>Accounts <input id="re-acc" value="' + esc(specIn(r.pool.accounts)) + '" placeholder="type:E = every expense · 6000-6999 · 61*, !6150 · class:Staff costs" style="width:60%"></label> <span class="sm muted" id="re-accn"></span>' +
            '<div class="row" style="gap:8px;margin:6px 0"><span class="sm">On these</span>' + fsel('re-wf', wf) + '<span class="sm muted">values (none ticked = all)</span>' +
            '<label class="sm">· % of the pool <input id="re-pct" type="number" min="0" max="100" step="0.1" value="' + esc(r.pool.pct == null ? 100 : r.pool.pct) + '" style="width:70px"></label></div>' +
            '<div id="re-wbox">' + AL.picker('re-where', wf, r.pool.where[wf]) + '</div></div>' +
            '<div class="al-sec"><h4>2 · Receivers — where it goes and how</h4><div class="row" style="gap:8px;flex-wrap:wrap"><span class="sm">Dimension</span>' + fsel('re-tf', r.to.field) +
            '<span class="sm">Method</span><select id="re-m">' + Object.keys(A.METHODS).map(function (k) { return '<option value="' + k + '"' + (k === (r.to.method || 'even') ? ' selected' : '') + '>' + esc(A.METHODS[k]) + '</option>'; }).join('') + '</select>' +
            '<label class="sm"><input type="checkbox" id="re-pc"' + (r.to.perCompany === false ? '' : ' checked') + '> within each company</label></div><div id="re-how" style="margin-top:6px"></div></div>' +
            '<div class="al-sec"><h4>3 · Posting</h4><label class="sm">Credit the pool on account <input id="re-out" value="' + esc((r.post || {}).out || '') + '" placeholder="same account" style="width:120px"></label> ' +
            '<label class="sm">Debit receivers on account <input id="re-in" value="' + esc((r.post || {})['in'] || '') + '" placeholder="same account" style="width:120px"></label> ' +
            '<label class="sm"><input type="checkbox" id="re-sd"' + (r.stepDown === false ? '' : ' checked') + '> step-down: values emptied by earlier rules receive nothing</label></div>' +
            '<div class="al-sec"><h4>Preview <small class="muted">on the loaded periods, after the rules before this one</small></h4><div id="re-pv" class="sm"></div></div></div>';
        FL.modal('<i class="fa-solid fa-share-nodes"></i> ' + (isNew ? 'New rule' : 'Edit rule'), html, '<button class="btn sm" id="re-cancel">Cancel</button><button class="btn sm primary" id="re-ok"><i class="fa-solid fa-check"></i> Use this rule</button>');
        var B = $('m-body');
        var read = function () {
            var x = clone(r); x.name = $('re-name').value.trim() || 'Rule';
            x.pool = { accounts: specOut($('re-acc').value), where: {}, pct: +$('re-pct').value };
            var w = AL.picked($('re-where')); if (w.length) x.pool.where[$('re-wf').value] = w;
            if (x.pool.pct === 100) delete x.pool.pct;
            x.to = { field: $('re-tf').value, method: $('re-m').value, perCompany: $('re-pc').checked };
            var how = $('re-how');
            if (x.to.method === 'fixed' && !how.querySelector('#re-fx')) x.to.targets = r.to.method === 'fixed' ? clone(r.to.targets || []) : [];
            else if (x.to.method === 'fixed') x.to.targets = [].map.call(how.querySelectorAll('tr[data-v]'), function (tr) { return { value: tr.dataset.v, pct: +tr.querySelector('input').value || 0 }; }).filter(function (t) { return t.pct > 0; });
            else { var only = AL.picked($('re-only')); if (only.length) x.to.targets = only; }
            var ex = $('re-ex') ? $('re-ex').value.split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean) : []; if (ex.length) x.to.exclude = ex;
            if (x.to.method === 'gl') x.to.gl = $('re-gla') ? { accounts: specOut($('re-gla').value), sign: $('re-gls').value } : (r.to.gl || { accounts: { type: 'R' } });
            if (x.to.method === 'driver') x.to.driver = $('re-drv') ? $('re-drv').value : (r.to.driver || '');
            x.post = {}; if ($('re-out').value.trim()) x.post.out = $('re-out').value.trim(); if ($('re-in').value.trim()) x.post['in'] = $('re-in').value.trim();
            x.stepDown = $('re-sd').checked;
            return x;
        };
        var paintHow = function () {
            var meth = $('re-m').value, tf = $('re-tf').value, cur = read(), h = '';
            if (meth === 'fixed') {
                var t = (cur.to.targets && cur.to.targets.length ? cur.to.targets : (r.to.method === 'fixed' ? r.to.targets : [])) || [];
                h = '<table class="t" id="re-fx"><thead><tr><th>' + esc(AL.label(tf)) + '</th><th class="n">%</th><th></th></tr></thead><tbody>' + t.map(function (x) { return '<tr data-v="' + esc(x.value) + '"><td>' + esc(AL.vname(tf, x.value)) + '</td><td class="n"><input type="number" step="0.01" value="' + esc(x.pct) + '" style="width:80px"></td><td><a data-x>×</a></td></tr>'; }).join('') + '</tbody></table>' +
                    '<div class="row" style="gap:6px;margin-top:4px"><select id="re-fxadd"><option value="">＋ add a receiver…</option>' + AL.values(tf).map(function (v) { return '<option value="' + esc(v.value) + '">' + esc(AL.vname(tf, v.value)) + '</option>'; }).join('') + '</select>' +
                    '<a class="sm" id="re-fxeven">split evenly</a><span class="sm" id="re-fxsum"></span></div>';
            } else {
                h = (meth === 'gl' ? '<label class="sm">Driver accounts <input id="re-gla" value="' + esc(specIn((cur.to.gl || r.to.gl || {}).accounts || { type: 'R' })) + '" style="width:260px" placeholder="type:R = revenue"></label> <select id="re-gls"><option value="abs">their size (revenue as positive)</option><option value="debit"' + (((r.to.gl || {}).sign) === 'debit' ? ' selected' : '') + '>debit amounts only</option></select><br>' : '') +
                    (meth === 'driver' ? '<label class="sm">Driver table <select id="re-drv">' + (m.drivers || []).map(function (d) { return '<option value="' + d.id + '"' + (d.id === r.to.driver ? ' selected' : '') + '>' + esc(d.name) + ' (' + esc(AL.label(d.field)) + ')</option>'; }).join('') + '<option value="">— none —</option></select></label> <a class="sm" id="re-drvnew">＋ new driver table</a><br>' : '') +
                    (meth === 'cost' ? '<p class="sm muted">Each receiver gets a share equal to its share of the expenses it already carries (after the earlier rules).</p>' : '') +
                    '<div class="sm" style="margin-top:4px">Only these receivers <span class="muted">(none ticked = every value' + (meth === 'gl' ? ' with driver amounts' : meth === 'driver' ? ' in the driver table' : '') + ')</span></div>' + AL.picker('re-only', tf, (r.to.method !== 'fixed' && r.to.field === tf ? r.to.targets : []) || [], {}) +
                    '<label class="sm">Never to <input id="re-ex" value="' + esc((r.to.exclude || []).join(', ')) + '" placeholder="values, comma separated" style="width:260px"></label>';
            }
            $('re-how').innerHTML = h;
            AL.wirePicker($('re-only'));
            var fx = $('re-fx');
            if (fx) {
                var sumP = function () { var s = 0; fx.querySelectorAll('input').forEach(function (x) { s += +x.value || 0; }); $('re-fxsum').innerHTML = ' total <b class="' + (Math.abs(s - 100) < 0.01 ? 'pos' : 'neg') + '">' + s.toFixed(2) + '%</b>' + (Math.abs(s - 100) >= 0.01 && s > 0 ? ' — shares are scaled to 100 %' : ''); preview(); };
                fx.querySelectorAll('[data-x]').forEach(function (a) { a.onclick = function () { a.closest('tr').remove(); sumP(); }; });
                fx.querySelectorAll('input').forEach(function (x) { x.oninput = sumP; });
                $('re-fxadd').onchange = function () { var v = this.value; if (!v || fx.querySelector('tr[data-v="' + CSS.escape(v) + '"]')) return; var tr = document.createElement('tr'); tr.dataset.v = v; tr.innerHTML = '<td>' + esc(AL.vname(tf, v)) + '</td><td class="n"><input type="number" step="0.01" value="0" style="width:80px"></td><td><a data-x>×</a></td>'; fx.querySelector('tbody').appendChild(tr); tr.querySelector('[data-x]').onclick = function () { tr.remove(); sumP(); }; tr.querySelector('input').oninput = sumP; this.value = ''; sumP(); };
                $('re-fxeven').onclick = function () { var ins = fx.querySelectorAll('input'), n = ins.length; ins.forEach(function (x, j) { x.value = n ? (j === n - 1 ? (100 - Math.round(10000 / n) / 100 * (n - 1)).toFixed(2) : (Math.round(10000 / n) / 100).toFixed(2)) : 0; }); sumP(); };
                sumP();
            }
            if ($('re-drvnew')) $('re-drvnew').onclick = function () { r = read(); m.rules[i] = r; AL.editDriver(-1, { field: tf, back: function () { AL.editRule(i, isNew); } }); };
            B.querySelectorAll('#re-how input, #re-how select').forEach(function (x) { x.addEventListener('change', preview); });
        };
        var preview = function () {
            var x = read(), accs = A.accSet(x.pool.accounts, FL.dims.accounts || []);
            $('re-accn').textContent = accs ? Object.keys(accs).length + ' account(s)' : 'every account';
            try {
                var tmp = clone(m); tmp.rules = m.rules.slice(0, i).concat([Object.assign(x, { id: x.id || 'pv', active: true })]);
                var res = A.run(tmp, AL.rows || [], FL.dims.accounts || []), s = res.steps[res.steps.length - 1];
                var tg = Object.keys(s.targets || {}).map(function (v) { return { v: v, a: s.targets[v] }; }).sort(function (a, b) { return b.a - a.a; });
                $('re-pv').innerHTML = 'Pool <b>' + money(s.pool) + '</b> on ' + s.rows + ' row(s) · moved <b>' + money(s.allocated) + '</b> to ' + tg.length + ' receiver(s)' + (s.unallocated ? ' · <span class="neg">' + money(s.unallocated) + ' not allocated</span>' : '') +
                    (s.warn.length ? '<br><span class="tag warn">' + esc(s.warn.join(' · ')) + '</span>' : '') +
                    (tg.length ? '<div class="al-pvbars">' + tg.slice(0, 12).map(function (t) { return '<div><span>' + esc(AL.vname(x.to.field, t.v).slice(0, 40)) + '</span><i style="width:' + Math.max(1, t.a / tg[0].a * 100).toFixed(0) + '%"></i><b>' + money(t.a) + '</b> <span class="muted">' + (s.allocated ? (t.a / s.allocated * 100).toFixed(1) + '%' : '') + '</span></div>'; }).join('') + (tg.length > 12 ? '<div class="muted">… ' + (tg.length - 12) + ' more</div>' : '') + '</div>' : '');
            } catch (e) { $('re-pv').textContent = String(e && e.message || e); }
        };
        AL.wirePicker($('re-where'));
        $('re-wf').onchange = function () { $('re-wbox').innerHTML = AL.picker('re-where', this.value, []); AL.wirePicker($('re-where')); $('re-where').addEventListener('change', preview); preview(); };
        $('re-tf').onchange = paintHow; $('re-m').onchange = paintHow;
        ['re-acc', 're-pct', 're-pc'].forEach(function (id) { $(id).addEventListener('change', preview); });
        $('re-where').addEventListener('change', preview);
        paintHow(); preview();
        $('re-cancel').onclick = function () { if (isNew) m.rules.splice(i, 1); FL.closeModal(); AL.paint(); };
        $('re-ok').onclick = function () {
            var x = read();
            if (x.to.method === 'driver' && !x.to.driver) { FL.toast('Choose or create a driver table', 'warn'); return; }
            if (x.to.method === 'fixed' && !(x.to.targets || []).length) { FL.toast('Add the receivers and their %', 'warn'); return; }
            x.id = r.id || A.uid('r'); m.rules[i] = x; FL.closeModal(); AL.changed();
        };
    };

    // ── driver tables ──
    AL.editDriver = function (i, opt) {
        opt = opt || {};
        var m = AL.model(), d = i >= 0 ? clone(m.drivers[i]) : { id: A.uid('d'), name: 'Headcount', unit: 'people', field: opt.field || AL.mainField(), values: {} };
        var flds = AL.allFields();
        var body = function () {
            var vals = AL.values(d.field);
            Object.keys(d.values || {}).forEach(function (v) { if (!vals.some(function (x) { return String(x.value) === v; })) vals.push({ value: v }); });
            return '<table class="t"><thead><tr><th>' + esc(AL.label(d.field)) + '</th><th class="n">' + esc(d.unit || 'value') + '</th><th class="n">share</th></tr></thead><tbody>' + vals.map(function (v) {
                return '<tr><td>' + esc(AL.vname(d.field, v.value)) + '</td><td class="n"><input type="number" step="any" data-v="' + esc(v.value) + '" value="' + esc(d.values[v.value] == null ? '' : d.values[v.value]) + '" style="width:100px"></td><td class="n muted dv-sh"></td></tr>';
            }).join('') + '</tbody></table>';
        };
        FL.modal('<i class="fa-solid fa-ruler"></i> Driver table', '<div class="row" style="gap:8px;flex-wrap:wrap"><label>Name <input id="dv-name" value="' + esc(d.name) + '"></label><label>Unit <input id="dv-unit" value="' + esc(d.unit || '') + '" style="width:100px"></label>' +
            '<label>For <select id="dv-f">' + flds.map(function (f) { return '<option value="' + f.id + '"' + (f.id === d.field ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select></label></div>' +
            '<details style="margin:8px 0"><summary class="sm">Paste from Excel (two columns: value, number)</summary><textarea id="dv-paste" rows="5" style="width:100%" placeholder="100\t12\n200\t8"></textarea><button class="btn sm" id="dv-apply">Fill</button></details>' +
            '<div class="scroll" style="max-height:48vh" id="dv-t">' + body() + '</div>',
            '<button class="btn sm" id="dv-cancel">Cancel</button><button class="btn sm primary" id="dv-ok"><i class="fa-solid fa-check"></i> Save driver</button>');
        var share = function () { var ins = $('dv-t').querySelectorAll('input'), t = 0; ins.forEach(function (x) { t += +x.value || 0; }); ins.forEach(function (x) { x.closest('tr').querySelector('.dv-sh').textContent = t && +x.value ? (+x.value / t * 100).toFixed(1) + '%' : ''; }); };
        var collect = function () { var v = {}; $('dv-t').querySelectorAll('input').forEach(function (x) { if (x.value !== '' && !isNaN(+x.value)) v[x.dataset.v] = +x.value; }); d.values = v; };
        var wire = function () { $('dv-t').querySelectorAll('input').forEach(function (x) { x.oninput = share; }); share(); };
        wire();
        $('dv-f').onchange = function () { collect(); d.field = this.value; $('dv-t').innerHTML = body(); wire(); };
        $('dv-apply').onclick = function () {
            collect();
            $('dv-paste').value.split(/\r?\n/).forEach(function (l) { var p = l.split(/\t|;|,(?=\s*-?\d)/); if (p.length >= 2 && p[0].trim() && !isNaN(+String(p[1]).replace(/\s/g, ''))) d.values[p[0].trim()] = +String(p[1]).replace(/\s/g, ''); });
            $('dv-t').innerHTML = body(); wire();
        };
        $('dv-cancel').onclick = function () { FL.closeModal(); if (opt.back) opt.back(); };
        $('dv-ok').onclick = function () {
            collect(); d.name = $('dv-name').value.trim() || 'Driver'; d.unit = $('dv-unit').value.trim();
            if (!Object.keys(d.values).length) { FL.toast('Enter at least one number', 'warn'); return; }
            if (i >= 0) m.drivers[i] = d; else (m.drivers = m.drivers || []).push(d);
            if (opt.back) { var rule = m.rules.filter(function (x) { return x.to && x.to.method === 'driver' && !x.to.driver; })[0]; if (rule) rule.to.driver = d.id; }
            AL.dirty = true; FL.closeModal(); if (opt.back) opt.back(); else AL.changed();
        };
    };
    AL.editVirtual = function (i) {
        var m = AL.model(), v = i >= 0 ? clone(m.virtual[i]) : { id: '', name: 'Activity', values: [] };
        FL.modal('<i class="fa-solid fa-diagram-project"></i> Dimension not in the GL', '<label>Name <input id="vd-name" value="' + esc(v.name) + '"></label>' +
            '<p class="sm muted">One value per line — activities (Order handling, Picking, Delivery) or cost objects (product families, channels).</p><textarea id="vd-vals" rows="10" style="width:100%">' + esc((v.values || []).join('\n')) + '</textarea>',
            '<button class="btn sm primary" id="vd-ok"><i class="fa-solid fa-check"></i> Save</button>');
        $('vd-ok').onclick = function () {
            v.name = $('vd-name').value.trim() || 'Activity';
            if (!v.id) { var base = v.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'dim', id = base, n = 2; while (AL.allFields().some(function (f) { return f.id === id; })) id = base + n++; v.id = id; }
            v.values = $('vd-vals').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (i >= 0) m.virtual[i] = v; else (m.virtual = m.virtual || []).push(v);
            FL.closeModal(); AL.changed();
        };
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
    AL.GUIDE = 'Answer with ONE ```alloc block holding JSON {"rules":[…],"drivers":[…],"virtual":[…]} (only what you add). rule = {"name","pool":{"accounts": "type:E" or a code list / ranges like "6000-6999, !6150","where":{"<field>":["values"]},"pct":100},' +
        '"to":{"field":"<field>","method":"fixed|even|gl|driver|cost","targets":[values] or for fixed [{"value","pct"}],"exclude":[values],"gl":{"accounts":"type:R"},"driver":"<driver id>","perCompany":true},"stepDown":true}. ' +
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
