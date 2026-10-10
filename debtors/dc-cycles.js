/* Fusion Debtors Control · Statement cycles (tab "Statement cycles", window.DC.cycles).
 * One cycle = one business unit × one month, worked through five steps:
 *   ① Checklist — the same checks for every customer of the cycle (Fusion SQL / BI Publisher / checks on the balances);
 *     a failure is fixed and run again, or bypassed with a comment (who, when, why kept)
 *   ② Archive balances — one frozen row per customer (total due, aging, overdue, items, e-mail, delivery) + the movement
 *     against the previous cycle
 *   ③ Statement check — the statement report's data-model SQL captured and fingerprinted (drift against the last cycle shown
 *     as a diff), sample PDFs, sign-off
 *   ④ Send — the archive goes to Send statements; every statement is recorded with the cycle id; coverage per customer
 *   ⑤ Close — coverage, what is left, a closing note; the audit pack (one HTML file) for the auditors
 * Engine: dc-cycle.js (DCE, pure). Store: DCS.cycle. Page plumbing: DC.api (dc-core.js). */
(function () {
    'use strict';
    var DC = window.DC, A = DC.api, E = A.E, S = A.S, P = A.P, esc = A.esc, money = A.money, pill = A.pill, kpi = A.kpi, when = A.when;
    function $(id) { return document.getElementById(id); }
    function ls(k, d) { try { var v = localStorage.getItem('dc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem('dc.' + k, JSON.stringify(v)); } catch (e) { } }

    var C = DC.cycles = { list: null, open: null, cy: null, results: {}, checks: null, cust: null, bal: null, stmts: null, events: null, sql: null, prevSql: null, snap: null, step: null, f: { bu: ls('cy.bu', ''), state: '' }, running: false };

    // ── this PC's copy (DuckDB w2_dc_*, through the WMS 2.0 file): a cycle opens from here at once; APEX is read after ──
    var L = DC.local = {
        saveCycle: function () {
            if (!C.cy) return Promise.resolve();
            return S.duck.put('w2_dc_cycles', { cycle_id: [C.cy.CYCLE_ID] }, [{ cycle_id: C.cy.CYCLE_ID, pod: C.cy.POD, json: JSON.stringify({ cy: C.cy, events: C.events || [] }), saved_at: new Date().toISOString() }]);
        },
        saveChecks: function () {
            if (!C.cy) return Promise.resolve();
            var id = C.cy.CYCLE_ID, rows = Object.keys(C.results).filter(function (k) { var r = C.results[k]; return r && r.status && r.status !== 'RUNNING'; }).map(function (k) {
                var r = C.results[k];
                return { cycle_id: id, check_id: k, status: r.status, rows_n: r.rows, amount: r.amount, ms: r.ms, error_text: r.error, ran_at: r.ranAt, ran_by: r.ranBy, bypass_note: r.bypassNote, bypass_by: r.bypassBy, bypass_at: r.bypassAt, sql_text: r.sql, truncated: r.truncated ? 'Y' : '', saved_at: new Date().toISOString() };
            });
            return S.duck.put('w2_dc_checks', { cycle_id: [id] }, rows);
        },
        saveRows: function (checkId, variant, rows) {
            var id = C.cy.CYCLE_ID;
            return S.duck.put('w2_dc_check_rows', { cycle_id: [id], check_id: [checkId], variant: [variant] }, (rows || []).map(function (r, i) { return { cycle_id: id, check_id: checkId, variant: variant, seq: i, row_json: JSON.stringify(r) }; }));
        },
        rows: function (checkId, variant) {
            if (!C.cy) return Promise.resolve([]);
            return S.duck.qs(['SELECT row_json FROM w2_dc_check_rows WHERE cycle_id = ' + S.duck.lit(C.cy.CYCLE_ID) + ' AND check_id = ' + S.duck.lit(checkId) + ' AND variant = ' + S.duck.lit(variant) + ' ORDER BY CAST(seq AS INTEGER)'])
                .then(function (r) { return r[0].map(function (x) { try { return JSON.parse(x.row_json); } catch (e) { return {}; } }); });
        },
        saveCust: function (list, info) {
            var id = C.cy.CYCLE_ID, at = info && info.readAt || new Date().toISOString();
            return S.duck.put('w2_dc_cust', { cycle_id: [id] }, (list || []).map(function (c, i) { return { cycle_id: id, seq: i, account: c.account, json: JSON.stringify(c), read_at: at }; }));
        },
        saveDrill: function (cid, key, part, rows, sql) {
            return S.duck.put('w2_dc_drill', { cycle_id: [cid], dkey: [key], part: [part] }, (rows.length ? rows : [null]).map(function (r, i) { return { cycle_id: cid, dkey: key, part: part, seq: i, row_json: r ? JSON.stringify(r) : '', sql_text: i ? '' : sql, read_at: new Date().toISOString() }; }));
        },
        drill: function (cid, key) {
            return S.duck.qs(['SELECT part, row_json, read_at FROM w2_dc_drill WHERE cycle_id = ' + S.duck.lit(cid) + ' AND dkey = ' + S.duck.lit(key) + ' ORDER BY part, CAST(seq AS INTEGER)']).then(function (r) {
                var out = {};
                r[0].forEach(function (x) { var o = out[x.part] = out[x.part] || { rows: [], at: x.read_at }; if (x.row_json) { try { o.rows.push(JSON.parse(x.row_json)); } catch (e) { } } });
                return out;
            });
        },
        /** the cycle as kept on this PC → {cy, events, results, cust, custAt} or null */
        load: function (id) {
            var k = S.duck.lit(id);
            return S.duck.qs(['SELECT json, saved_at FROM w2_dc_cycles WHERE cycle_id = ' + k, 'SELECT * FROM w2_dc_checks WHERE cycle_id = ' + k,
                'SELECT json, read_at FROM w2_dc_cust WHERE cycle_id = ' + k + ' ORDER BY CAST(seq AS INTEGER)']).then(function (r) {
                if (!r[0].length) return null;
                var j = {}; try { j = JSON.parse(r[0][0].json); } catch (e) { return null; }
                var res = {};
                r[1].forEach(function (x) { res[x.check_id] = { status: x.status, rows: x.rows_n === '' ? null : x.rows_n, amount: x.amount === '' ? null : x.amount, ms: x.ms, error: x.error_text || null, ranAt: x.ran_at, ranBy: x.ran_by, bypassNote: x.bypass_note || null, bypassBy: x.bypass_by, bypassAt: x.bypass_at, sql: x.sql_text, truncated: x.truncated === 'Y' }; });
                var cust = r[2].map(function (x) { try { return JSON.parse(x.json); } catch (e) { return null; } }).filter(Boolean);
                return { cy: j.cy, events: j.events || [], results: res, savedAt: r[0][0].saved_at, cust: cust.length ? cust : null, custAt: r[2].length ? r[2][0].read_at : null };
            });
        }
    };
    C.canRun = function () { return C.cy && !closed() && !((+C.cy.SENT_N || 0) + (+C.cy.POSTED_N || 0) > 0); };
    /** the accounting status of the rows' invoices: XLA by invoice id, 400 per query, 2 at a time; a failed chunk leaves 'Not checked' */
    C.acctFill = function (rows, onStep) {
        var chunks = E.acctChunks(rows, 400), got = [], done = 0, failed = 0;
        if (!chunks.length) return Promise.resolve(rows);
        function worker() { var c = chunks.shift(); if (!c) return Promise.resolve(); return S.fusionSql(E.acctSql(c), 5000, 300000).then(function (r) { got = got.concat(r); }, function () { failed++; }).then(function () { done++; if (onStep) onStep(done, done + chunks.length); return worker(); }); }
        return Promise.all([worker(), worker()]).then(function () { E.acctMerge(rows, got); rows.acctFailed = failed; return rows; });
    };
    C.runOne = function (id) { var x = C.defs().filter(function (c) { return c.id === id; })[0]; return x ? runMany([x]) : Promise.resolve(); };

    // ── the checklist definition: the starters, with the saved changes (WMS_DC_SETTINGS.CHECKS) on top ──
    C.defs = function () {
        var saved = C.saved || [], byId = {}, out = [];
        saved.forEach(function (c) { byId[c.id] = c; });
        E.CHECKS.forEach(function (c) { out.push(Object.assign({}, c, byId[c.id] || {})); delete byId[c.id]; });
        Object.keys(byId).forEach(function (k) { if (!byId[k].removed) out.push(Object.assign({ custom: true }, byId[k])); });
        return out.filter(function (c) { return !c.removed; });
    };
    function loadDefs() { return S.settings.get('CHECKS').then(function (v) { C.saved = Array.isArray(v) ? v : []; }).catch(function () { C.saved = []; }); }

    // ── data ──
    function loadList() {
        return S.cycle.list().then(function (r) { C.list = r; badge(); A.render(); }).catch(function (e) { C.list = []; A.toast(A.errText(e), 'bad', 7000); A.render(); });
    }
    /** the tab badge: open cycles past their send-by date */
    function badge() {
        var el = $('n-cycles'); if (!el || !C.list) return;
        var late = C.list.filter(function (c) { return c.STATUS !== 'CLOSED' && c.DUE_DATE && c.DUE_DATE < A.today(); }).length;
        el.textContent = late ? String(late) : ''; el.title = late ? late + ' open cycle(s) past their send-by date' : '';
    }
    setTimeout(function () { if (!C.list && S.hasHost()) S.cycle.list().then(function (r) { if (!C.list) { C.list = r; badge(); } }).catch(function () { }); }, 2500);
    function bu(id) { return A.bu(id) || { id: id, name: id, mail: {}, statement: {}, balances: {} }; }
    DC.openCycle = function (id) {
        C.open = id; C.cy = null; C.results = {}; C.cust = null; C.bal = null; C.stmts = null; C.events = null; C.sql = null; C.prevSql = null; C.snap = null; C.step = null;
        if (P.tab !== 'cycles') A.go('cycles'); else A.render();
        return loadCycle(id);
    };
    function apexResults(rows) {
        var out = {};
        rows.forEach(function (x) { out[x.CHECK_ID] = { status: x.STATUS, rows: x.ROWS_N, amount: x.AMOUNT, ms: x.MS, error: x.ERROR_TEXT, ranAt: x.RAN_AT, ranBy: x.RAN_BY, bypassNote: x.BYPASS_NOTE, bypassBy: x.BYPASS_BY, bypassAt: x.BYPASS_AT }; });
        return out;
    }
    /** Open a cycle: this PC's copy first (checks, every row found, the balances read — no Fusion call), then APEX, which
     *  wins where another PC ran or bypassed something since. Full rows of a check another PC ran newer are dropped here. */
    function loadCycle(id) {
        var end = A.busy('Opening the cycle…'), t0 = Date.now();
        return Promise.all([L.load(id).catch(function () { return null; }), C.saved ? null : loadDefs()]).then(function (r) {
            var loc = r[0];
            if (loc && loc.cy && C.open === id) {
                C.cy = loc.cy; C.events = loc.events; C.results = loc.results; C.src = { kind: 'pc', at: loc.savedAt, ms: Date.now() - t0 };
                if (loc.cust && !C.cust) { C.cust = loc.cust; C.custInfo = { at: loc.custAt ? new Date(loc.custAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '', src: 'this PC', missing: [] }; }
                A.render();
            }
            return Promise.all([S.cycle.get(id), S.cycle.checks(id), S.cycle.events(id)]).then(function (a) {
                if (C.open !== id) return;
                if (!a[0]) { end(); A.toast('The cycle is gone', 'bad'); C.open = null; A.render(); return; }
                var ap = apexResults(a[1]), mine = C.results || {};
                Object.keys(ap).forEach(function (k) {
                    var m = mine[k];
                    if (m && m.ranAt === ap[k].ranAt && m.status === ap[k].status) { ap[k].rowsAll = m.rowsAll; ap[k].sql = m.sql; ap[k].truncated = m.truncated; }
                });
                C.cy = a[0]; C.events = a[2]; C.results = ap; C.src = { kind: loc ? 'both' : 'apex', at: new Date().toISOString(), ms: Date.now() - t0 };
                var more = [];
                if (C.cy.SNAP_AT) more.push(S.cycle.bal(id).then(function (b) { C.bal = b; }));
                if (C.cy.SNAP_AT) more.push(S.stmt.search({ cycleId: id, limit: 50000 }).then(function (s2) { C.stmts = s2; }));
                if (C.cy.STMT_SHA) more.push(S.cycle.sql(id).then(function (t) { C.sql = t; }));
                return Promise.all(more).then(function () { end(); A.render(); L.saveCycle(); L.saveChecks(); });
            });
        }).catch(function (e) { end(); A.toast(A.errText(e), 'bad', 7000); A.render(); });
    }
    function event(ev, detail) { return S.cycle.event(C.cy.CYCLE_ID, ev, detail).then(function () { return S.cycle.events(C.cy.CYCLE_ID); }).then(function (r) { C.events = r; L.saveCycle(); }); }
    function setCycle(sets) { return S.cycle.set(C.cy.CYCLE_ID, sets).then(function () { return S.cycle.get(C.cy.CYCLE_ID); }).then(function (c) { C.cy = c; L.saveCycle(); }); }
    function closed() { return C.cy && C.cy.STATUS === 'CLOSED'; }
    function cycleObj() { return { stmtDate: C.cy.STMT_DATE, tolerance: C.cy.TOLERANCE != null && C.cy.TOLERANCE !== '' ? +C.cy.TOLERANCE : 1 }; }
    function profile(acct) { return A.profileOf(C.cy.BU_ID, acct); }

    // ══ the list ═══════════════════════════════════════════════════
    DC.views.cycles = function () {
        if (C.open) return vCycle();
        if (!C.list) { loadList(); return '<div class="card empty"><i class="fas fa-spinner fa-spin"></i></div>'; }
        var f = C.f, rows = C.list.filter(function (c) { return (!f.bu || c.BU_ID === f.bu) && (!f.state || (f.state === 'open' ? c.STATUS !== 'CLOSED' : c.STATUS === 'CLOSED')); });
        var open = C.list.filter(function (c) { return c.STATUS !== 'CLOSED'; }), late = open.filter(function (c) { return c.DUE_DATE && c.DUE_DATE < A.today(); });
        var h = '<div class="card"><div class="row"><h2 style="margin:0"><i class="fas fa-rotate"></i> Statement cycles</h2><span class="muted small">one cycle per business unit and month: checklist → archive → statement check → send → close</span><span class="sp"></span>' +
            '<select id="cy-bu"><option value="">Every business unit</option>' + P.bus.map(function (b) { return '<option value="' + esc(b.id) + '"' + (f.bu === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select>' +
            '<div class="seg" id="cy-st">' + [['', 'All'], ['open', 'Open'], ['closed', 'Closed']].map(function (x) { return '<button data-s="' + x[0] + '"' + (f.state === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>' +
            '<button class="btn pri" data-act="cyNew"><i class="fas fa-plus"></i> New cycle</button></div></div>';
        h += '<div class="kpis">' + kpi('Open cycles', open.length, late.length ? late.length + ' past their due date' : 'none late', late.length ? 'bad' : 'pri') +
            kpi('Closed', C.list.length - open.length, 'kept with their audit trail', 'ok') + '</div>';
        if (!rows.length) return h + '<div class="card empty"><i class="fas fa-rotate" style="font-size:26px;color:var(--pri)"></i><br><br>No cycle yet. <b>New cycle</b> starts the month: the checklist, the archive of the balances, the statement check, then sending.</div>';
        h += '<div class="cygrid">' + rows.map(cycleCard).join('') + '</div>';
        return h;
    };
    function cycleCard(c) {
        var st = E.CYCLE_STATUS[c.STATUS] || { label: c.STATUS, cls: '' }, steps = E.cycleSteps(c), late = c.STATUS !== 'CLOSED' && c.DUE_DATE && c.DUE_DATE < A.today();
        return '<div class="cycard" data-act="cyOpen" data-id="' + esc(c.CYCLE_ID) + '"><div class="row"><b style="font-size:16px">' + esc(E.periodLabel(c.PERIOD)) + '</b>' + pill(st.label, st.cls) + (late ? pill('late', 'bad') : '') + '<span class="sp"></span><span class="muted small">' + esc(c.POD) + '</span></div>' +
            '<div class="muted small" style="margin:2px 0 8px">' + esc(c.BU_NAME || c.BU_ID) + ' · as at ' + esc(c.STMT_DATE) + (c.OWNER_USER ? ' · ' + esc(c.OWNER_USER) : '') + (c.DUE_DATE ? ' · due ' + esc(c.DUE_DATE) : '') + '</div>' +
            '<div class="cysteps">' + steps.steps.map(function (s, i) { return '<span class="cs ' + s.state + '" title="' + esc(E.CYCLE_STEPS[i].label) + ' · ' + s.state + '"><i class="fas ' + E.CYCLE_STEPS[i].icon + '"></i></span>'; }).join('<span class="cl"></span>') + '</div>' +
            '<div class="row small" style="margin-top:8px;gap:14px">' + (c.CUSTOMERS ? '<span><b>' + esc(c.CUSTOMERS) + '</b> customers</span><span><b>' + money(+c.TOTAL_DUE) + '</b> due</span>' : '<span class="muted">balances not archived yet</span>') + (c.COVER_PCT != null && c.COVER_PCT !== '' ? '<span><b>' + esc(c.COVER_PCT) + '%</b> sent</span>' : '') + '</div></div>';
    }

    // ══ one cycle ══════════════════════════════════════════════════
    function vCycle() {
        var c = C.cy;
        if (!c) return '<div class="card empty"><i class="fas fa-spinner fa-spin"></i></div>';
        var st = E.CYCLE_STATUS[c.STATUS] || { label: c.STATUS, cls: '' }, steps = E.cycleSteps(c), show = C.step || steps.active;
        var h = '<div class="card"><div class="row"><button class="btn sm" data-act="cyBack"><i class="fas fa-arrow-left"></i> Cycles</button><b style="font-size:17px">' + esc(c.TITLE || E.periodLabel(c.PERIOD)) + '</b>' + pill(st.label, st.cls) +
            '<span class="sp"></span><span class="small muted">' + esc(c.BU_NAME) + ' · ' + esc(c.POD) + ' · statements as at <b>' + esc(c.STMT_DATE) + '</b>' + (c.OWNER_USER ? ' · owner ' + esc(c.OWNER_USER) : '') + (c.DUE_DATE ? ' · due ' + esc(c.DUE_DATE) : '') + '</span>' +
            '<button class="btn sm" data-act="cyPack" title="One HTML file with everything about this cycle — for the auditors"><i class="fas fa-file-shield"></i> Audit pack</button><button class="btn sm" data-act="cyReload"><i class="fas fa-rotate"></i></button></div>' +
            '<div class="stepper">' + steps.steps.map(function (s, i) {
                var d = E.CYCLE_STEPS[i];
                return '<button class="stp ' + s.state + (show === s.key ? ' cur' : '') + '" data-act="cyStep" data-k="' + s.key + '"><span class="n">' + (s.state === 'done' ? '<i class="fas fa-check"></i>' : i + 1) + '</span><span><b>' + d.label + '</b><span class="small">' + stepNote(s.key) + '</span></span></button>';
            }).join('') + '</div></div>';
        h += '<div class="cols"><div>' + (show === 'checks' ? vChecks() : show === 'archive' ? vArchive() : show === 'review' ? vReview() : show === 'send' ? vSend() : vClose()) + '</div><div>' + vTrail() + '</div></div>';
        return h;
    }
    function stepNote(k) {
        var c = C.cy;
        if (k === 'checks') { if (c.CHECKS_AT) return 'done ' + esc(S.local(c.CHECKS_AT)) + (c.CHECKS_SCORE != null ? ' · ' + esc(c.CHECKS_SCORE) + '%' : ''); var g = E.gate(C.defs(), C.results); return g.total - g.pending.length + ' of ' + g.total + ' run'; }
        if (k === 'archive') return c.SNAP_AT ? esc(c.CUSTOMERS) + ' customers · ' + money(+c.TOTAL_DUE) : 'frozen balances';
        if (k === 'review') return c.REVIEW_AT ? 'checked ' + esc(S.local(c.REVIEW_AT)) + (c.STMT_CHANGED === 'Y' ? ' · query changed' : '') : 'query + samples';
        if (k === 'send') return c.COVER_PCT != null && c.COVER_PCT !== '' ? esc(c.COVER_PCT) + '% sent' : 'from the archive';
        return c.CLOSED_AT ? 'closed ' + esc(S.local(c.CLOSED_AT)) : 'coverage + note';
    }
    function vTrail() {
        var ev = C.events || [];
        return '<div class="card"><h2><i class="fas fa-clock-rotate-left"></i> Trail <span class="pill">' + ev.length + '</span></h2>' +
            (ev.length ? '<div class="trail">' + ev.slice(0, 80).map(function (e) { return '<div class="tr"><div class="small muted">' + when(e.EVENT_AT) + ' · ' + esc(e.BY_USER || '') + '</div><b>' + esc(e.EVENT.replace(/_/g, ' ').toLowerCase()) + '</b>' + (e.DETAIL ? '<div class="small">' + esc(e.DETAIL) + '</div>' : '') + '</div>'; }).join('') + '</div>' : '<div class="muted small">Every step, bypass and send is written here.</div>') + '</div>';
    }

    // ── ① the checklist ──
    function vChecks() {
        var defs = C.defs(), g = E.gate(defs, C.results), locked = !C.canRun();
        var h = '<div class="card"><h2><i class="fas fa-list-check"></i> Pre-send checklist<span class="sp"></span>' +
            (locked ? pill(closed() ? 'locked — the cycle is closed' : 'locked — statements were sent', 'muted') : '<button class="btn sm" data-act="ckRunAll"' + (C.running ? ' disabled' : '') + '><i class="fas fa-play"></i> ' + (C.running ? 'Running…' : 'Run every check') + '</button>' + (g.blocking.length + g.warnings.length ? '<button class="btn sm" data-act="ckRunFailed"' + (C.running ? ' disabled' : '') + '>Run the failed again</button>' : '')) + '</h2>' +
            '<div class="small muted" style="margin-bottom:10px">The same checks apply to every customer of the cycle. A <b>blocking</b> check must pass — or be bypassed with a comment saying why. Checks on customers use the balances read for this cycle.' + (C.cust ? ' <span class="pill info">' + C.cust.length + ' customers read' + (C.custInfo && C.custInfo.at ? ' · ' + esc(C.custInfo.at) : '') + (C.custInfo && C.custInfo.src === 'this PC' ? ' · kept on this PC' : '') + '</span>' : '') + srcNote() + '</div>' +
            '<div class="gatebar"><div class="ring" style="--p:' + g.score + '"><span>' + g.score + '%</span></div><div class="row small" style="gap:14px"><span><b style="color:var(--ok)">' + g.passed.length + '</b> passed</span><span><b class="badc">' + g.blocking.length + '</b> blocking</span><span><b class="warnc">' + g.warnings.length + '</b> warnings</span><span><b>' + g.bypassed.length + '</b> bypassed</span><span><b>' + g.pending.length + '</b> not run</span></div><span class="sp"></span>' +
            (C.cy.CHECKS_AT ? pill('<i class="fas fa-check"></i> signed off ' + esc(S.local(C.cy.CHECKS_AT)) + ' by ' + esc(C.cy.CHECKS_BY || ''), 'ok') : g.ready ? '<button class="btn pri" data-act="ckDone"' + (C.running ? ' disabled' : '') + ' title="Record the checklist and go to the archive">Checklist done <i class="fas fa-arrow-right"></i></button>' :
                '<button class="btn" data-act="cyStep" data-k="archive" title="Look at the balances now; checks still failing are confirmed (bypassed with one comment) when you send">Next: preview the balances <i class="fas fa-arrow-right"></i></button>') + '</div>';
        E.AREAS.concat(['Other']).forEach(function (area) {
            var list = defs.filter(function (d) { return d.enabled !== false && (d.area === area || (area === 'Other' && E.AREAS.indexOf(d.area) < 0)); });
            if (!list.length) return;
            h += '<h3>' + esc(area) + '</h3>' + list.map(function (d) { return ckRow(d, locked); }).join('');
        });
        var off = defs.filter(function (d) { return d.enabled === false; });
        if (off.length) h += '<div class="small muted" style="margin-top:10px">Switched off in Setup: ' + off.map(function (d) { return esc(d.title); }).join(' · ') + '</div>';
        return h + '</div>';
    }
    var CK_ICON = { PASS: 'fa-circle-check okc', FAIL: 'fa-circle-xmark badc', ERROR: 'fa-triangle-exclamation warnc', RUNNING: 'fa-spinner fa-spin' };
    function ckRow(d, locked) {
        var r = C.results[d.id] || {}, st = r.status, bypassed = st && st !== 'PASS' && r.bypassNote;
        var icon = bypassed ? 'fa-circle-minus' : CK_ICON[st] || 'fa-circle muted';
        var res = !st || st === 'NOT_RUN' ? '<span class="muted">not run</span>' : st === 'RUNNING' ? 'running…' : st === 'PASS' ? '<span class="okc">passed</span>' : st === 'ERROR' ? '<span class="warnc">could not run: ' + esc(String(r.error || '').slice(0, 160)) + '</span>' : '<b class="badc">' + esc(r.rows) + (r.truncated ? '+' : '') + ' found</b>' + (r.amount != null && r.amount !== '' ? ' · ' + money(+r.amount) : '');
        return '<div class="ck' + (bypassed ? ' byp' : '') + '"><i class="fas ' + icon + '"></i><div class="tx"><b>' + esc(d.title) + '</b> ' + pill(d.severity === 'BLOCK' ? 'blocking' : 'warning', d.severity === 'BLOCK' ? 'bad' : 'warn') + ' <span class="pill muted">' + esc(d.kind === 'LOCAL' ? 'balances' : d.kind) + '</span>' +
            '<div class="small">' + res + (r.ranAt ? ' <span class="muted">· ' + when(r.ranAt) + ' · ' + esc(r.ranBy || '') + (r.ms ? ' · ' + (Math.round(+r.ms / 100) / 10) + ' s' : '') + '</span>' : '') + '</div>' +
            (bypassed ? '<div class="small byn"><i class="fas fa-user-shield"></i> Bypassed by ' + esc(r.bypassBy || '') + ' · ' + when(r.bypassAt) + ': “' + esc(r.bypassNote) + '”</div>' : '') +
            (d.help ? '<div class="small muted">' + esc(d.help) + '</div>' : '') + '</div><div class="ac">' +
            (st && st !== 'RUNNING' && st !== 'NOT_RUN' ? '<button class="btn sm' + (st === 'FAIL' ? ' pri' : '') + '" data-act="ckDetail" data-id="' + esc(d.id) + '">' + (d.compare && st !== 'ERROR' ? 'Compare' : 'Details') + '</button>' : '') +
            (!locked ? '<button class="btn sm" data-act="ckRun" data-id="' + esc(d.id) + '"' + (C.running ? ' disabled' : '') + '><i class="fas fa-play"></i></button>' : '') +
            (!locked && (st === 'FAIL' || st === 'ERROR' || st === 'NOT_RUN') && !bypassed ? '<button class="btn sm" data-act="ckBypass" data-id="' + esc(d.id) + '">Bypass…</button>' : '') + '</div></div>';
    }
    /** the customers of the cycle as read now (the checks on the balances and the archive use them) */
    function ensureCust() {
        if (C.cust) return Promise.resolve(C.cust);
        var b = bu(C.cy.BU_ID), end = A.busy('Reading the balances of ' + b.name + ' as at ' + C.cy.STMT_DATE + '…');
        return A.readBalances(b, C.cy.STMT_DATE, C.cy.POD).then(function (m) {
            end(); C.cust = m.customers; C.custInfo = { missing: m.missing, columns: m.columns, rows: m.rawCount, at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), src: 'Fusion' }; L.saveCust(C.cust);
            if (m.missing.length) A.toast('The balances answer has no column for ' + m.missing.join(', ') + ' — check Setup', 'warn', 8000);
            return C.cust;
        }, function (e) { end(); throw e; });
    }
    var ROW_LIMIT = 20000;
    function runCheck(d) {
        var b = bu(C.cy.BU_ID), vars = E.cycleVars(b, cycleObj()), t0 = Date.now(), sqlText = '';
        C.results[d.id] = Object.assign({}, C.results[d.id] || {}, { status: 'RUNNING' }); A.render();
        var p;
        if (d.kind === 'LOCAL') { sqlText = 'checked on the balances of ' + b.name + ' as at ' + C.cy.STMT_DATE; p = ensureCust().then(function (list) { return E.localCheck(d.id, list, { bu: b, profile: profile, activities: P.acts.filter(function (a) { return a.BU_ID === b.id; }) }); }); }
        else if (d.kind === 'BIP') { var prm = E.fillParams(d.params, vars); sqlText = d.path + '\n' + JSON.stringify(prm, null, 1); p = S.call('dcBipRows', { instance: C.cy.POD, path: d.path, params: prm }, 600000).then(function (x) { return x.rows || []; }); }
        else { sqlText = E.fill(d.sql, vars, 'sql'); p = S.fusionSql(sqlText, ROW_LIMIT, d.acct ? 600000 : undefined); if (d.acct) p = p.then(function (rows) { return C.acctFill(rows); }); }
        return p.then(function (rows) {
            var o = E.checkOutcome(rows); o.ms = Date.now() - t0; o.sql = sqlText; o.sample = rows; o.all = rows; o.truncated = d.kind !== 'LOCAL' && rows.length >= ROW_LIMIT; return o;
        }, function (e) { return { status: 'ERROR', rows: null, amount: null, error: A.errText(e), ms: Date.now() - t0, sql: sqlText, sample: [] }; })
            .then(function (o) {
                L.saveRows(d.id, 'check', o.all || []);
                return S.cycle.saveCheck(C.cy.CYCLE_ID, d, o).then(function () { C.results[d.id] = { status: o.status, rows: o.rows, amount: o.amount, ms: o.ms, error: o.error, ranAt: null, ranBy: S.user(), rowsAll: o.all || [], sql: o.sql, truncated: o.truncated }; },
                    function (e) { C.results[d.id] = { status: 'ERROR', error: 'Ran, but the result could not be kept in APEX: ' + A.errText(e) }; });
            });
    }
    function runMany(list) {
        if (C.running) return;
        C.running = true; A.render();
        var queue = list.slice(), ok = 0;
        function worker() { var d = queue.shift(); if (!d) return Promise.resolve(); return runCheck(d).then(function () { ok++; A.render(); return worker(); }); }
        // LOCAL checks first (one balances read), then two Fusion queries at a time
        var local = queue.filter(function (d) { return d.kind === 'LOCAL'; }); queue = queue.filter(function (d) { return d.kind !== 'LOCAL'; });
        var pLocal = local.reduce(function (p, d) { return p.then(function () { return runCheck(d).then(function () { A.render(); }); }); }, Promise.resolve());
        return Promise.all([pLocal, worker(), worker()]).then(function () {
            C.running = false;
            var g = E.gate(C.defs(), C.results);
            return event('CHECKS_RUN', list.length + ' check(s) run · ' + g.passed.length + ' passed, ' + g.blocking.length + ' blocking, ' + g.warnings.length + ' warnings').then(function () { return S.cycle.checks(C.cy.CYCLE_ID); }).then(function (r) {
                r.forEach(function (x) { var cur = C.results[x.CHECK_ID] || {}; C.results[x.CHECK_ID] = Object.assign(cur, { ranAt: x.RAN_AT, ranBy: x.RAN_BY }); });
                L.saveChecks();
                A.render(); A.toast(g.blocking.length ? g.blocking.length + ' blocking check(s) failed — fix and run again, or bypass with a comment' : 'Checks done', g.blocking.length ? 'warn' : 'ok', 6000);
            });
        }).catch(function (e) { C.running = false; A.render(); A.toast(A.errText(e), 'bad'); });
    }
    function ckDetail(id) { DC.wb.openCheck(id); }
    /** where the screen's figures come from: this PC's copy, APEX, or both */
    function srcNote() {
        var x = C.src; if (!x) return '';
        return ' <span class="pill ' + (x.kind === 'pc' ? 'vio' : 'muted') + '" title="Saved in APEX and on this PC (DuckDB). Opening a cycle shows this PC\'s copy at once, then APEX is read; nothing is run again.">' +
            (x.kind === 'pc' ? '<i class="fas fa-database"></i> from this PC · checking APEX…' : x.kind === 'both' ? '<i class="fas fa-database"></i> this PC + APEX' : '<i class="fas fa-cloud"></i> from APEX') + '</span>';
    }
    function ckBypass(id) {
        var d = C.defs().filter(function (x) { return x.id === id; })[0], r = C.results[id] || {};
        A.modal('<i class="fas fa-user-shield"></i> Bypass · ' + esc(d.title),
            '<div class="note warn" style="margin-bottom:10px">This check ' + (r.status === 'ERROR' ? 'could not run' : 'found ' + esc(r.rows) + ' item(s)' + (r.amount != null && r.amount !== '' ? ' (' + money(+r.amount) + ')' : '')) + '. Bypassing lets the cycle go on for <b>every customer</b>; your name, the time and your reason are kept with the cycle and printed in the audit pack.</div>' +
            '<div class="field"><label>Why is it all right to go on? (at least ' + E.BYPASS_MIN + ' characters)</label><textarea id="bp-note" rows="4" placeholder="e.g. 3 unapplied receipts are bank charges, cleared with Finance on 2 Oct (ref. JV 1182)"></textarea></div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="ckBypassGo" data-id="' + esc(id) + '">Bypass with this reason</button>');
        setTimeout(function () { var t = $('bp-note'); if (t) t.focus(); }, 50);
    }

    // ── ② the archive ──
    function vArchive() {
        var c = C.cy, sending = (+c.SENT_N || 0) + (+c.POSTED_N || 0) > 0;
        if (c.SNAP_AT && C.bal) {
            var bal = C.bal, q = String(C.balQ || '').toLowerCase(), rows = bal.filter(function (r) { return !q || (r.ACCOUNT_NUMBER + ' ' + r.ACCOUNT_NAME + ' ' + (r.EMAIL || '')).toLowerCase().indexOf(q) >= 0; });
            var h = '<div class="card"><h2><i class="fas fa-box-archive"></i> Archived balances <span class="pill ok">frozen ' + esc(S.local(c.SNAP_AT)) + ' · ' + esc(c.SNAP_BY || '') + '</span><span class="sp"></span>' +
                (!sending && !closed() ? '<button class="btn sm" data-act="arAgain" title="Read the balances again and replace the archive (only before any statement was sent)">Archive again</button>' : '') + '<button class="btn sm" data-act="arCsv"><i class="fas fa-file-csv"></i></button></h2>' + totalsHtml(c) + '</div>';
            h += movementHtml({ hasPrev: c.PREV_TOTAL != null && c.PREV_TOTAL !== '', newN: +c.NEW_N || 0, clearedN: +c.CLEARED_N || 0, upN: +c.UP_N || 0, downN: +c.DOWN_N || 0, prevTotal: +c.PREV_TOTAL || 0, top: topFromBal(bal) });
            h += '<div class="card"><div class="row" style="margin-bottom:8px"><input type="search" id="ar-q" placeholder="Search account, name, e-mail…" value="' + esc(C.balQ || '') + '" style="min-width:240px"><span class="sp"></span><span class="small muted">' + rows.length + ' of ' + bal.length + '</span></div>' +
                '<div class="tblw"><table class="tbl"><thead><tr><th>Account</th><th>Customer</th><th class="r">Balance</th><th class="r">Last month</th><th class="r">Overdue</th><th class="r">90+</th><th class="r">Items</th><th>Goes to</th></tr></thead><tbody>' +
                rows.slice(0, 1500).map(function (r) {
                    var diff = r.PREV_BALANCE != null && r.PREV_BALANCE !== '' ? +r.BALANCE - +r.PREV_BALANCE : null;
                    return '<tr class="click" data-act="open360" data-bu="' + esc(c.BU_ID) + '" data-acct="' + esc(r.ACCOUNT_NUMBER) + '"><td class="mono">' + esc(r.ACCOUNT_NUMBER) + '</td><td>' + esc(r.ACCOUNT_NAME) + '</td><td class="r num">' + money(+r.BALANCE) + '</td><td class="r num small">' + (r.PREV_BALANCE != null && r.PREV_BALANCE !== '' ? money(+r.PREV_BALANCE) + (diff ? ' <span class="' + (diff > 0 ? 'badc' : 'okc') + '">' + (diff > 0 ? '▲' : '▼') + '</span>' : '') : '<span class="muted">new</span>') + '</td>' +
                        '<td class="r num">' + (r.OVERDUE != null && r.OVERDUE !== '' ? money(+r.OVERDUE) : '—') + '</td><td class="r num">' + (r.D90P != null && r.D90P !== '' ? money(+r.D90P) : '—') + '</td><td class="r">' + esc(r.ITEMS_N || '') + '</td><td class="cut small" title="' + esc(r.WHY || '') + '">' + (r.DELIVERY === 'EMAIL' ? esc(r.EMAIL) : pill(esc(r.DELIVERY || ''), r.DELIVERY === 'POST' ? 'warn' : 'muted')) + '</td></tr>';
                }).join('') + '</tbody></table></div></div>';
            return h;
        }
        var h2 = '<div class="card"><h2><i class="fas fa-box-archive"></i> Archive the balances as at ' + esc(c.STMT_DATE) + '</h2><div class="small muted" style="margin-bottom:10px">One frozen row per customer — total due, aging buckets, overdue, number of items, e-mail and how the statement goes — and the totals of the cycle. Statements of this cycle are sent from this archive, so what was sent can always be shown later, even after Fusion moved on.</div>';
        if (!C.snap) {
            h2 += '<button class="btn pri" data-act="arRead"><i class="fas fa-download"></i> ' + (C.cust ? 'Prepare the archive (' + C.cust.length + ' customers read at ' + esc(C.custInfo ? C.custInfo.at : '') + ')' : 'Read the balances') + '</button>' + (C.cust ? ' <button class="btn" data-act="arReread">Read them again first</button>' : '') + '</div>';
            return h2;
        }
        var t = C.snap.totals;
        h2 += totalsHtml({ CUSTOMERS: t.customers, TOTAL_DUE: t.total, OWED: t.owed, OVERDUE: t.overdue, CUR_AMT: t.hasAging ? t.cur : null, D30: t.d30, D60: t.d60, D90: t.d90, D90P: t.d90p, CREDIT_N: t.creditN, CREDIT_AMT: t.creditAmt, EMAIL_N: t.emailN, POST_N: t.postN, NONE_N: t.noneN, ITEMS_N: t.items }) +
            '<div class="row" style="margin-top:12px"><button class="btn pri" data-act="arSave"><i class="fas fa-lock"></i> Archive these ' + t.customers + ' balances</button><button class="btn" data-act="arReread">Read again</button>' +
            '<span class="small muted">' + (C.custInfo && C.custInfo.at ? 'read ' + esc(C.custInfo.at) + (C.custInfo.src === 'this PC' ? ' · kept on this PC' : '') : '') + (C.cy.CHECKS_AT ? '' : ' · the checklist is not done — sending asks you to confirm it') + '</span></div></div>';
        return h2 + movementHtml(t.movement) + previewHtml(C.snap.rows);
    }
    /** the balances before they are archived — one row per customer, searchable */
    function previewHtml(rows) {
        var q = String(C.balQ || '').toLowerCase(), list = rows.filter(function (r) { return !q || (r.account + ' ' + r.name + ' ' + (r.email || '')).toLowerCase().indexOf(q) >= 0; });
        return '<div class="card"><h2><i class="fas fa-eye"></i> Preview — the balances that will be archived <span class="pill">' + rows.length + '</span></h2><div class="row" style="margin-bottom:8px"><input type="search" id="ar-q" placeholder="Search account, name, e-mail…" value="' + esc(C.balQ || '') + '" style="min-width:240px"><span class="sp"></span><span class="small muted">' + list.length + ' of ' + rows.length + '</span></div>' +
            '<div class="tblw"><table class="tbl"><thead><tr><th>Account</th><th>Customer</th><th class="r">Balance</th><th class="r">Last cycle</th><th class="r">Overdue</th><th class="r">90+</th><th class="r">Items</th><th>Goes to</th></tr></thead><tbody>' +
            list.slice(0, 1500).map(function (r) {
                return '<tr class="click" data-act="open360" data-bu="' + esc(C.cy.BU_ID) + '" data-acct="' + esc(r.account) + '"><td class="mono">' + esc(r.account) + '</td><td>' + esc(r.name) + '</td><td class="r num">' + money(r.balance) + '</td><td class="r num small">' + (r.prev != null ? money(r.prev) : '<span class="muted">new</span>') + '</td>' +
                    '<td class="r num">' + (r.overdue != null ? money(r.overdue) : '—') + '</td><td class="r num">' + (r.aging ? money(r.aging.d90p || 0) : '—') + '</td><td class="r">' + esc(r.items || '') + '</td><td class="cut small" title="' + esc(r.why || '') + '">' + (r.delivery === 'EMAIL' ? esc(r.email) : pill(esc(r.delivery || ''), r.delivery === 'POST' ? 'warn' : 'muted')) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
    }
    function totalsHtml(c) {
        var tot = +c.TOTAL_DUE || 0, aging = c.CUR_AMT != null && c.CUR_AMT !== '' ? [['Current', +c.CUR_AMT, '#10b981'], ['1–30', +c.D30, '#84cc16'], ['31–60', +c.D60, '#f59e0b'], ['61–90', +c.D90, '#f97316'], ['90+', +c.D90P, '#dc2626']] : null;
        var aTot = aging ? aging.reduce(function (s, a) { return s + Math.max(0, a[1] || 0); }, 0) || 1 : 1;
        return '<div class="kpis" style="margin-bottom:8px">' + kpi('Customers', c.CUSTOMERS, (+c.ITEMS_N ? esc(c.ITEMS_N) + ' items · ' : '') + (+c.EMAIL_N || 0) + ' e-mail · ' + (+c.POST_N || 0) + ' post', 'pri') + kpi('Total due', money(tot), 'owed ' + money(+c.OWED || 0), 'info') +
            kpi('Overdue', c.OVERDUE != null && c.OVERDUE !== '' ? money(+c.OVERDUE) : '—', aging ? '90+ ' + money(+c.D90P || 0) : 'aging not in the source', 'warn') + kpi('In credit', +c.CREDIT_N || 0, money(+c.CREDIT_AMT || 0), +c.CREDIT_N ? 'warn' : '') + '</div>' +
            (aging ? '<div class="aging" style="height:16px">' + aging.map(function (a) { return a[1] > 0 ? '<span style="width:' + (100 * a[1] / aTot) + '%;background:' + a[2] + '" title="' + a[0] + ': ' + money(a[1]) + '"></span>' : ''; }).join('') + '</div><div class="legend">' + aging.map(function (a) { return '<span><i style="background:' + a[2] + '"></i>' + a[0] + ' ' + money(a[1], 0) + '</span>'; }).join('') + '</div>' : '');
    }
    function topFromBal(bal) {
        return bal.filter(function (r) { return r.PREV_BALANCE != null && r.PREV_BALANCE !== '' ? +r.BALANCE !== +r.PREV_BALANCE : +r.BALANCE; })
            .map(function (r) { var was = r.PREV_BALANCE != null && r.PREV_BALANCE !== '' ? +r.PREV_BALANCE : 0; return { account: r.ACCOUNT_NUMBER, name: r.ACCOUNT_NAME, was: was, now: +r.BALANCE, diff: +r.BALANCE - was, kind: r.PREV_BALANCE == null || r.PREV_BALANCE === '' ? 'NEW' : +r.BALANCE > was ? 'UP' : 'DOWN' }; })
            .sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); }).slice(0, 10);
    }
    function movementHtml(m) {
        if (!m || !m.hasPrev) return '<div class="card small muted"><i class="fas fa-chart-line"></i> No earlier archive for this business unit — the movement against last month shows from the next cycle on.</div>';
        return '<div class="card"><h2><i class="fas fa-chart-line"></i> Against the previous cycle <span class="pill">' + money(m.prevTotal) + ' then</span></h2><div class="row small" style="gap:16px;margin-bottom:8px"><span><b>' + m.newN + '</b> new debtors</span><span><b>' + m.clearedN + '</b> cleared</span><span><b class="badc">' + m.upN + '</b> owe more</span><span><b class="okc">' + m.downN + '</b> owe less</span></div>' +
            (m.top && m.top.length ? '<table class="tbl"><thead><tr><th>Customer</th><th class="r">Then</th><th class="r">Now</th><th class="r">Change</th></tr></thead><tbody>' + m.top.map(function (x) { return '<tr><td>' + esc(x.name || x.account) + ' <span class="muted small">' + esc(x.account) + '</span> ' + pill(x.kind.toLowerCase(), x.kind === 'UP' || x.kind === 'NEW' ? 'warn' : 'ok') + '</td><td class="r num">' + money(x.was) + '</td><td class="r num">' + money(x.now) + '</td><td class="r num ' + (x.diff > 0 ? 'badc' : 'okc') + '">' + (x.diff > 0 ? '+' : '') + money(x.diff) + '</td></tr>'; }).join('') + '</tbody></table>' : '') + '</div>';
    }
    function prepareArchive(reread) {
        if (reread) C.cust = null;
        return ensureCust().then(function (list) {
            return S.cycle.previous(C.cy, 'snap').then(function (prev) { return prev ? S.cycle.bal(prev.CYCLE_ID) : []; }).then(function (prevRows) {
                C.snap = E.snapshot(list, { bu: bu(C.cy.BU_ID), profile: profile, prev: prevRows });
                A.render();
            });
        }).catch(function (e) { A.toast(A.errText(e), 'bad', 8000); A.render(); });
    }
    function saveArchive(opts) {
        opts = opts || {};
        var s = C.snap, t = s.totals, m = t.movement, end = A.busy('Archiving ' + t.customers + ' balances in APEX…'), again = !!C.cy.SNAP_AT;
        return S.cycle.saveBal(C.cy.CYCLE_ID, s.rows).then(function () {
            return setCycle({ snap_at: 'SYSDATE', snap_by: S.user(), snap_source: (bu(C.cy.BU_ID).balances || {}).kind || 'BIP', customers: t.customers, total_due: t.total, owed: t.owed, overdue: t.overdue, cur_amt: t.hasAging ? t.cur : null, d30: t.hasAging ? t.d30 : null, d60: t.hasAging ? t.d60 : null, d90: t.hasAging ? t.d90 : null, d90p: t.hasAging ? t.d90p : null,
                credit_n: t.creditN, credit_amt: t.creditAmt, email_n: t.emailN, post_n: t.postN, none_n: t.noneN, items_n: t.items, new_n: m.hasPrev ? m.newN : null, cleared_n: m.hasPrev ? m.clearedN : null, up_n: m.hasPrev ? m.upN : null, down_n: m.hasPrev ? m.downN : null, prev_total: m.hasPrev ? m.prevTotal : null, status: C.cy.REVIEW_AT || C.cy.STATUS === 'SENDING' ? C.cy.STATUS : 'ARCHIVED' });
        }).then(function () { return event(again ? 'ARCHIVED_AGAIN' : 'ARCHIVED', t.customers + ' customers · total due ' + money(t.total) + ' · overdue ' + money(t.overdue) + (m.hasPrev ? ' · ' + m.newN + ' new, ' + m.clearedN + ' cleared' : '')); })
            .then(function () { return S.cycle.bal(C.cy.CYCLE_ID); }).then(function (b) { C.bal = b; C.snap = null; end(); if (!opts.quiet) { C.step = 'review'; A.render(); A.toast('Balances archived — next: the statement check', 'ok'); } })
            .catch(function (e) { end(); A.toast(A.errText(e), 'bad', 9000); if (opts.quiet) throw e; });
    }

    // ── ③ the statement check ──
    function vReview() {
        var c = C.cy, b = bu(c.BU_ID), path = c.STMT_PATH || (b.statement || {}).path || '';
        var h = '<div class="card"><h2><i class="fas fa-code"></i> The statement report\'s query</h2><div class="small muted" style="margin-bottom:8px">The SQL behind the statement report (its BI Publisher data model) is captured with the cycle and fingerprinted, so you can show exactly what produced the statements — and see at once when somebody changed the report since the last cycle.</div>' +
            '<div class="row"><span class="mono small">' + esc(path) + '</span><span class="sp"></span><button class="btn sm' + (c.STMT_SHA ? '' : ' pri') + '" data-act="rvCapture"' + (closed() ? ' disabled' : '') + '><i class="fas fa-download"></i> ' + (c.STMT_SHA ? 'Capture again' : 'Capture the query') + '</button></div>';
        if (c.STMT_SHA) {
            h += '<div class="row small" style="margin:10px 0;gap:12px">' + pill('<i class="fas fa-fingerprint"></i> ' + esc(String(c.STMT_SHA).slice(0, 16)) + '…', 'muted') + (c.STMT_CHANGED === 'Y' ? pill('<i class="fas fa-triangle-exclamation"></i> changed since the last cycle', 'bad') : c.STMT_CHANGED === 'N' ? pill('same as the last cycle', 'ok') : pill('first cycle with a captured query', 'info')) + '<span class="muted">data model ' + esc(c.STMT_DM || '') + '</span><span class="sp"></span>' +
                (C.sql ? '<button class="btn sm" data-act="rvCopy"><i class="fas fa-copy"></i> Copy</button>' : '') + (c.STMT_CHANGED === 'Y' ? '<button class="btn sm" data-act="rvDiff">What changed</button>' : '') + '</div>' +
                (C.sql ? '<pre class="sqlbox" style="max-height:320px">' + esc(C.sql) + '</pre>' : '<div class="muted small">loading…</div>');
        }
        h += '</div>';
        var cust = C.bal && C.bal.length ? E.fromArchive(C.bal) : (C.cust || []), smp = E.samples(cust);
        if (!c.SNAP_AT) h += '<div class="card note warn small">The balances are not archived yet — the samples below use the balances read' + (C.cust ? ' (' + C.cust.length + ' customers)' : ' (none read yet: open Archive balances)') + '.</div>';
        h += '<div class="card"><h2><i class="fas fa-file-pdf"></i> Sample statements</h2><div class="small muted" style="margin-bottom:8px">Open a few statements before sending hundreds: the largest balance, the oldest debt, a credit and the longest one. Compare the figures with the archive.</div>' +
            (smp.length ? '<table class="tbl"><tbody>' + smp.map(function (x) { return '<tr><td>' + pill(esc(x.why), 'info') + '</td><td><b>' + esc(x.c.name) + '</b> <span class="muted small">' + esc(x.c.account) + '</span></td><td class="r num">' + money(x.c.balance) + '</td><td class="r"><button class="btn sm" data-act="rvSample" data-acct="' + esc(x.c.account) + '"><i class="fas fa-file-pdf"></i> Make + open</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="muted">No customer in the archive.</div>') +
            '<div class="row" style="margin-top:8px"><input type="text" id="rv-acct" placeholder="any account number" style="width:200px"><button class="btn sm" data-act="rvSampleAny">Make + open</button></div></div>';
        h += '<div class="card"><h2><i class="fas fa-signature"></i> Sign-off</h2>' + (c.REVIEW_AT ? '<div class="note"><i class="fas fa-check"></i> Checked by <b>' + esc(c.REVIEW_BY) + '</b> · ' + esc(S.local(c.REVIEW_AT)) + (c.REVIEW_NOTE ? ': “' + esc(c.REVIEW_NOTE) + '”' : '') + '</div>' :
            (!c.STMT_SHA ? '<div class="note warn" style="margin-bottom:8px">The query is not captured. If the data model cannot be read on this pod, say so in the note.</div>' : '') + (c.STMT_CHANGED === 'Y' ? '<div class="note bad" style="margin-bottom:8px">The statement query changed since the last cycle — look at <a data-act="rvDiff">what changed</a> before signing off.</div>' : '') +
            '<div class="field"><label>Note (what you checked)</label><textarea id="rv-note" rows="3" placeholder="e.g. 4 samples opened, balances and aging match the archive"></textarea></div><label class="chk" style="margin-top:6px"><input type="checkbox" id="rv-ok"> I checked the statement layout and figures</label>' +
            '<div class="row" style="margin-top:10px"><button class="btn pri" data-act="rvSign">Statement checked <i class="fas fa-arrow-right"></i></button></div>') + '</div>';
        return h;
    }
    function sha256(text) {
        var bytes = new TextEncoder().encode(text);
        if (window.crypto && crypto.subtle) return crypto.subtle.digest('SHA-256', bytes).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
        return Promise.reject(new Error('No WebCrypto here'));
    }
    function capture() {
        var c = C.cy, b = bu(c.BU_ID), path = (b.statement || {}).path, end = A.busy('Reading the statement report\'s data model…');
        var dm, txt, def;
        return S.call('bipDataModel', { instance: c.POD, path: path }, 300000).then(function (r) {
            dm = r.dataModel; txt = E.modelText(r.model);
            if (!txt.trim()) throw new Error('The data model holds no SQL data set');
            return S.call('bipDefinition', { instance: c.POD, path: path }, 120000).then(function (d) { def = d.def; }, function () { def = null; });
        }).then(function () { return sha256(E.sqlNorm(txt)); }).then(function (sha) {
            return S.cycle.previous(c, 'sql').then(function (prev) {
                var changed = prev ? (prev.STMT_SHA === sha ? 'N' : 'Y') : null;
                C.prevCycle = prev;
                return S.cycle.saveSql(c.CYCLE_ID, txt, def ? JSON.stringify(def) : '').then(function () { return setCycle({ stmt_path: path, stmt_dm: dm, stmt_sha: sha, stmt_changed: changed }); })
                    .then(function () { C.sql = txt; return event('QUERY_CAPTURED', path + ' · ' + sha.slice(0, 16) + (changed === 'Y' ? ' · CHANGED since ' + prev.PERIOD : changed === 'N' ? ' · same as ' + prev.PERIOD : '')); })
                    .then(function () { end(); A.render(); A.toast(changed === 'Y' ? 'Captured — the query changed since ' + prev.PERIOD : 'Captured', changed === 'Y' ? 'warn' : 'ok', 6000); });
            });
        }).catch(function (e) { end(); A.toast('Could not read the data model: ' + A.errText(e), 'bad', 9000); });
    }
    function showDiff() {
        var c = C.cy;
        (C.prevCycle ? Promise.resolve(C.prevCycle) : S.cycle.previous(c, 'sql')).then(function (prev) {
            if (!prev) { A.toast('No earlier cycle with a captured query', 'warn'); return; }
            return Promise.all([S.cycle.sql(prev.CYCLE_ID), C.sql ? C.sql : S.cycle.sql(c.CYCLE_ID)]).then(function (r) {
                var d = E.lineDiff(r[0], r[1]), ch = d.filter(function (x) { return x.t !== ' '; }).length;
                A.modal('<i class="fas fa-code-compare"></i> The statement query · ' + esc(prev.PERIOD) + ' → ' + esc(c.PERIOD) + ' <span class="pill bad">' + ch + ' line(s) differ</span>',
                    '<pre class="sqlbox diff">' + d.map(function (x) { return '<span class="d' + (x.t === '+' ? 'a' : x.t === '-' ? 'r' : '') + '">' + esc(x.t + ' ' + x.s) + '</span>'; }).join('\n') + '</pre>', '<button class="btn" data-act="mclose">Close</button>', true);
            });
        }).catch(function (e) { A.toast(A.errText(e), 'bad'); });
    }
    function sample(acct) {
        var c = C.cy, b = bu(c.BU_ID), r = (C.bal || []).filter(function (x) { return x.ACCOUNT_NUMBER === acct; })[0];
        var cu = r ? E.fromArchive([r])[0] : (C.cust || []).filter(function (x) { return x.account === acct; })[0] || { account: acct, name: '' }, end = A.busy('Making the statement of ' + acct + '…');
        S.call('dcStatementPdf', { instance: c.POD, path: b.statement.path, params: E.fillParams(b.statement.params, E.vars(b, c.STMT_DATE, cu)), bu: b.name || b.id, stmtDate: c.STMT_DATE, fileName: 'SAMPLE ' + acct + ' ' + (cu.name || '').slice(0, 40) }, 300000)
            .then(function (p) { end(); event('SAMPLE_PDF', acct + ' ' + (cu.name || '') + ' · ' + Math.round(p.bytes / 1024) + ' KB · ' + String(p.sha256).slice(0, 12)).then(A.render); return S.call('dcOpenFile', { path: p.path }); })
            .catch(function (e) { end(); A.toast(A.errText(e), 'bad', 8000); });
    }

    // ── ④ send ──
    function vSend() {
        var c = C.cy, plan = E.sendPlan(C.defs(), C.results, c), started = (+c.SENT_N || 0) + (+c.POSTED_N || 0) > 0;
        if (!plan.ready && !started && !closed()) return readyHtml(plan);
        if (!C.bal || !C.stmts) return '<div class="card empty"><i class="fas fa-spinner fa-spin"></i></div>';
        var cov = E.coverage(C.bal, C.stmts), k = cov.counts, f = C.sendF || '';
        var per = cov.per.filter(function (x) { return !f || (f === 'NOT_SENT' ? x.state === 'NOT_SENT' : f === 'FAILED' ? x.state === 'FAILED' || x.state === 'BOUNCED' : f === 'DONE' ? x.stmt && ['SENT', 'POSTED', 'DRAFT'].indexOf(x.stmt.STATUS) >= 0 : f === 'ANSWERED' ? x.stmt && x.stmt.RESP_STATUS : true); });
        var h = '<div class="card"><h2><i class="fas fa-paper-plane"></i> Send the statements of this cycle<span class="sp"></span>' +
            (!closed() && k.notSent ? '<button class="btn pri" data-act="sdGo" data-w="NOT_SENT"><i class="fas fa-paper-plane"></i> Send the ' + k.notSent + ' not sent</button>' : '') + (!closed() && k.failed ? '<button class="btn" data-act="sdGo" data-w="FAILED">Send the ' + k.failed + ' failed again</button>' : '') + '<button class="btn sm" data-act="sdReload"><i class="fas fa-rotate"></i></button></h2>' +
            '<div class="prog" style="height:12px"><div style="width:' + k.pct + '%"></div></div><div class="row small" style="margin:8px 0 12px;gap:16px"><b>' + k.pct + '% done</b><span>' + k.emailed + ' e-mailed</span><span>' + k.posted + ' for the post</span>' + (k.drafts ? '<span>' + k.drafts + ' in Outlook</span>' : '') + '<span class="badc">' + k.failed + ' failed</span><span>' + k.notSent + ' not sent</span><span>' + k.opened + ' opened</span><span class="okc">' + k.agreed + ' agreed</span><span class="badc">' + k.disputed + ' queried</span></div>' +
            '<div class="seg" id="sd-f" style="margin-bottom:8px">' + [['', 'All ' + k.customers], ['NOT_SENT', 'Not sent ' + k.notSent], ['FAILED', 'Failed ' + (k.failed + k.bounced)], ['DONE', 'Sent ' + k.done], ['ANSWERED', 'Answered ' + (k.agreed + k.disputed)]].map(function (x) { return '<button data-f="' + x[0] + '"' + (f === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>' +
            '<div class="tblw"><table class="tbl"><thead><tr><th>Account</th><th>Customer</th><th class="r">Balance (archived)</th><th>Goes to</th><th>Status</th><th>When</th></tr></thead><tbody>' +
            per.slice(0, 2000).map(function (x) {
                var r = x.row, s = x.stmt;
                return '<tr' + (s ? ' class="click" data-act="stmt" data-id="' + esc(s.STMT_ID) + '"' : '') + '><td class="mono">' + esc(r.ACCOUNT_NUMBER) + '</td><td>' + esc(r.ACCOUNT_NAME) + '</td><td class="r num">' + money(+r.BALANCE) + '</td><td class="cut small">' + (r.DELIVERY === 'EMAIL' ? esc(r.EMAIL) : esc(r.DELIVERY || '')) + '</td>' +
                    '<td>' + (s ? A.statePill(s) : x.state === 'NONE' ? pill('no statement', 'muted') : pill('not sent', 'warn')) + '</td><td class="small">' + (s ? when(s.SENT_AT || s.CREATED_AT) : '') + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
        return h;
    }
    /** what sending still needs — confirmed in one dialog (bypass with one comment, archive now, statement check skipped) */
    function readyHtml(plan) {
        var c = C.cy, n = C.cust ? C.cust.length : 0;
        var line = function (ok, title, body) { return '<div class="ck"><i class="fas ' + (ok ? 'fa-circle-check okc' : 'fa-circle-exclamation warnc') + '"></i><div class="tx"><b>' + title + '</b><div class="small">' + body + '</div></div></div>'; };
        return '<div class="card"><h2><i class="fas fa-paper-plane"></i> Send the statements of this cycle</h2><div class="small muted" style="margin-bottom:8px">You may send now. What is not done yet is listed here and confirmed in one step — your comment is kept with every bypassed check and printed in the audit pack.</div>' +
            line(!plan.bypass.length, 'Checklist', plan.bypass.length ? plan.bypass.length + ' check(s) will be bypassed: ' + plan.bypass.map(function (x) { return esc(x.title) + ' <span class="muted">(' + esc(x.state) + ')</span>'; }).join(' · ') : (c.CHECKS_AT ? 'done ' + esc(S.local(c.CHECKS_AT)) : 'every blocking check passed or bypassed') + (plan.warnings.length ? ' · ' + plan.warnings.length + ' warning(s)' : '')) +
            line(!plan.archive, 'Archive balances', plan.archive ? (n ? 'the ' + n + ' customers read' + (C.custInfo && C.custInfo.at ? ' at ' + esc(C.custInfo.at) : '') + ' will be archived now' : 'the balances will be read from Fusion and archived now') : esc(c.CUSTOMERS) + ' customers archived · ' + money(+c.TOTAL_DUE)) +
            line(!plan.review, 'Statement check', plan.review ? 'not signed off — recorded as sent without the statement check' : 'signed off by ' + esc(c.REVIEW_BY)) +
            '<div class="row" style="margin-top:12px"><button class="btn pri" data-act="sdConfirm"><i class="fas fa-paper-plane"></i> Send statements…</button></div></div>';
    }
    function sendConfirm() {
        var plan = E.sendPlan(C.defs(), C.results, C.cy), need = plan.bypass.length || plan.review;
        A.modal('<i class="fas fa-paper-plane"></i> Send the statements — confirm',
            (plan.bypass.length ? '<div class="note warn" style="margin-bottom:10px"><b>' + plan.bypass.length + ' check(s) will be bypassed</b> for every customer of the cycle:<ul style="margin:6px 0 0 18px;padding:0">' + plan.bypass.map(function (x) { return '<li>' + esc(x.title) + ' — ' + esc(x.state) + '</li>'; }).join('') + '</ul></div>' : '') +
            (plan.warnings.length ? '<div class="small muted" style="margin-bottom:8px">Warnings (not blocking): ' + plan.warnings.map(function (id) { var d = C.defs().filter(function (x) { return x.id === id; })[0]; return esc(d ? d.title : id); }).join(' · ') + '</div>' : '') +
            (plan.archive ? '<div class="note" style="margin-bottom:8px"><i class="fas fa-box-archive"></i> The balances are archived now' + (C.cust ? ' (' + C.cust.length + ' customers read' + (C.custInfo && C.custInfo.at ? ' at ' + esc(C.custInfo.at) : '') + ')' : ' — read from Fusion first') + ' and the statements are sent from that archive.</div>' : '') +
            (plan.review ? '<div class="note warn" style="margin-bottom:8px"><i class="fas fa-signature"></i> The statement check is not signed off — the cycle records that the statements went without it.</div>' : '') +
            (need ? '<div class="field"><label>Why is it all right to send now? (at least ' + E.BYPASS_MIN + ' characters — kept with every bypass)</label><textarea id="sd-note" rows="3" placeholder="e.g. unapplied receipts are bank charges cleared with Finance on 2 Oct; OM ↔ AR differences are timing (shipped 30 Sep, invoiced 1 Oct)"></textarea></div>' : '<div class="small">Everything is done — the statements go from the archive.</div>'),
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="sdConfirmGo">' + (need ? 'Confirm and continue to Send' : 'Continue to Send') + '</button>');
        setTimeout(function () { var t = $('sd-note'); if (t) t.focus(); }, 50);
    }
    function sendConfirmGo() {
        var plan = E.sendPlan(C.defs(), C.results, C.cy), t = $('sd-note'), note = t ? t.value.trim() : '';
        if ((plan.bypass.length || plan.review) && !E.bypassOk(note)) { A.toast('Write why (at least ' + E.BYPASS_MIN + ' characters)', 'warn'); return; }
        A.mclose();
        var id = C.cy.CYCLE_ID, defs = C.defs(), end = A.busy('Getting the cycle ready to send…');
        var chain = plan.bypass.reduce(function (p, x) {
            return p.then(function () {
                var r = C.results[x.id], d = defs.filter(function (y) { return y.id === x.id; })[0] || { id: x.id, title: x.title };
                var first = !r || !r.status || r.status === 'RUNNING' ? S.cycle.saveCheck(id, d, { status: 'NOT_RUN', rows: null, amount: null, ms: null, error: null, sql: '', sample: [] }) : Promise.resolve();
                return first.then(function () { return S.cycle.bypass(id, x.id, note); }).then(function () {
                    C.results[x.id] = Object.assign(r && r.status && r.status !== 'RUNNING' ? r : { status: 'NOT_RUN' }, { bypassNote: note, bypassBy: S.user(), bypassAt: null });
                });
            });
        }, Promise.resolve());
        chain.then(function () { return plan.bypass.length ? event('SEND_BYPASS', plan.bypass.length + ' check(s) bypassed to send (' + plan.bypass.map(function (x) { return x.title + ': ' + x.state; }).join('; ') + '): ' + note) : null; })
            .then(function () { if (C.cy.CHECKS_AT) return; var g = E.gate(defs, C.results); return setCycle({ checks_at: 'SYSDATE', checks_by: S.user(), checks_score: g.score, status: 'CHECKED' }).then(function () { return event('CHECKLIST_DONE', 'at send · ' + g.passed.length + ' passed · ' + g.bypassed.length + ' bypassed · score ' + g.score + '%'); }); })
            .then(function () { if (!plan.archive) return; return (C.snap ? Promise.resolve() : prepareArchive(false)).then(function () { if (!C.snap) throw new Error('The balances could not be read — nothing was archived'); return saveArchive({ quiet: true }); }); })
            .then(function () { if (!plan.review) return; return setCycle({ review_at: 'SYSDATE', review_by: S.user(), review_note: 'Sent without the statement check: ' + note, status: 'READY' }).then(function () { return event('STATEMENT_CHECK_SKIPPED', note); }); })
            .then(function () { return S.stmt.search({ cycleId: id, limit: 50000 }); })
            .then(function (st) { C.stmts = st; L.saveChecks(); end(); goSend('NOT_SENT'); })
            .catch(function (e) { end(); A.render(); A.toast(A.errText(e), 'bad', 9000); });
    }
    function goSend(which) {
        var c = C.cy, b = bu(c.BU_ID), cov = E.coverage(C.bal, C.stmts);
        var accts = cov.per.filter(function (x) { return which === 'FAILED' ? x.stmt && (x.stmt.STATUS === 'FAILED' || x.stmt.BOUNCED_AT) : x.state === 'NOT_SENT'; }).map(function (x) { return x.row.ACCOUNT_NUMBER; });
        if (!accts.length) { A.toast('Nothing to send', 'warn'); return; }
        var cust = E.fromArchive(C.bal); A.scoreAll(b, cust);
        P.pod = c.POD; P.buId = c.BU_ID; P.stmtDate = c.STMT_DATE;
        var R = P.run; R.customers = cust; R.missing = []; R.columns = []; R.loadedFor = b.id + '|' + c.STMT_DATE; R.loadedAt = 'archive'; R.rawCount = cust.length;
        R.cycle = { id: c.CYCLE_ID, title: E.periodLabel(c.PERIOD) + ' · ' + (c.BU_NAME || ''), snapAt: S.local(c.SNAP_AT) };
        R.f.unsent = false; R.f.positive = false; R.f.delivery = ''; R.f.q = '';
        R.sel = {}; accts.forEach(function (a) { R.sel[a] = 1; });
        A.go('run');
        A.toast(accts.length + ' customer(s) of the cycle ticked — preview, then Send', 'ok', 6000);
    }
    /** after a run of this cycle: coverage counts on the cycle row + a trail line */
    /** the open cycle's balance of one customer (Customer 360 opened from a cycle): {c, label, stmtDate} or null */
    DC.cycleCustomer = function (buId, acct) {
        if (!C.cy || String(C.cy.BU_ID) !== String(buId)) return null;
        var list = C.cust || (C.bal && C.bal.length ? E.fromArchive(C.bal) : null), c = (list || []).filter(function (x) { return String(x.account) === String(acct); })[0];
        return c ? { c: c, label: 'statement cycle ' + (C.cy.PERIOD || C.cy.STMT_DATE) + (c.fromArchive || !C.cust ? ' (archived)' : ''), stmtDate: C.cy.STMT_DATE } : null;
    };
    DC.onRunDone = function (cycleId, counts) {
        return S.stmt.search({ cycleId: cycleId, limit: 50000 }).then(function (stmts) {
            return S.cycle.bal(cycleId).then(function (bal) {
                var k = E.coverage(bal, stmts).counts;
                return S.cycle.set(cycleId, { sent_n: k.emailed + k.drafts, posted_n: k.posted, failed_n: k.failed, cover_pct: k.pct, status: { sql: "CASE WHEN status = 'CLOSED' THEN status ELSE 'SENDING' END" } }).then(function () {
                    return S.cycle.event(cycleId, 'STATEMENTS_SENT', counts ? counts.emailed + ' e-mailed, ' + counts.posted + ' for the post, ' + counts.failed + ' failed · cycle ' + k.pct + '% done' : 'one statement sent again · cycle ' + k.pct + '% done');
                }).then(function () { if (C.open === cycleId) { C.stmts = stmts; C.bal = bal; return S.cycle.get(cycleId).then(function (c) { C.cy = c; return S.cycle.events(cycleId); }).then(function (e) { C.events = e; }); } });
            });
        }).then(function () { C.list = null; }).catch(function (e) { console.warn('[DC] cycle counts', e); });
    };

    // ── ⑤ close ──
    function vClose() {
        var c = C.cy, cov = C.bal && C.stmts ? E.coverage(C.bal, C.stmts).counts : null, defs = C.defs(), byp = defs.filter(function (d) { var r = C.results[d.id]; return r && r.status !== 'PASS' && r.bypassNote; });
        var h = '<div class="card"><h2><i class="fas fa-flag-checkered"></i> Close the cycle</h2>';
        if (closed()) h += '<div class="note"><i class="fas fa-lock"></i> Closed by <b>' + esc(c.CLOSED_BY) + '</b> · ' + esc(S.local(c.CLOSED_AT)) + (c.CLOSE_NOTE ? ': “' + esc(c.CLOSE_NOTE) + '”' : '') + '</div><div class="row" style="margin-top:10px"><button class="btn" data-act="clReopen">Reopen…</button><button class="btn pri" data-act="cyPack"><i class="fas fa-file-shield"></i> Audit pack</button></div>';
        else {
            h += '<div class="kv">' + [['Checklist', c.CHECKS_AT ? 'done ' + esc(S.local(c.CHECKS_AT)) + ' · ' + byp.length + ' bypassed' : '<span class="badc">not done</span>'], ['Archive', c.SNAP_AT ? esc(c.CUSTOMERS) + ' customers · ' + money(+c.TOTAL_DUE) : '<span class="badc">not archived</span>'],
                ['Statement check', c.REVIEW_AT ? 'signed off by ' + esc(c.REVIEW_BY) + (c.STMT_CHANGED === 'Y' ? ' · <span class="badc">query changed</span>' : '') : '<span class="badc">not signed off</span>'],
                ['Sent', cov ? '<b>' + cov.pct + '%</b> — ' + cov.emailed + ' e-mailed, ' + cov.posted + ' post, <span class="' + (cov.failed ? 'badc' : '') + '">' + cov.failed + ' failed</span>, ' + cov.notSent + ' not sent' : '—'],
                ['Answers', cov ? cov.agreed + ' agreed, ' + cov.disputed + ' queried' : '—']].map(function (x) { return '<div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div>'; }).join('') + '</div>' +
                (cov && (cov.failed || cov.notSent) ? '<div class="note warn" style="margin-top:10px">' + (cov.failed + cov.notSent) + ' customer(s) did not get their statement — say why in the note.</div>' : '') +
                '<div class="field" style="margin-top:10px"><label>Closing note</label><textarea id="cl-note" rows="3" placeholder="e.g. 2 customers by hand (no e-mail), 1 queried — credit note in progress"></textarea></div>' +
                '<div class="row" style="margin-top:10px"><button class="btn pri" data-act="clGo"' + (c.REVIEW_AT ? '' : ' disabled') + '><i class="fas fa-lock"></i> Close the cycle</button><button class="btn" data-act="cyPack"><i class="fas fa-file-shield"></i> Audit pack</button></div>';
        }
        return h + '</div>';
    }

    // ── the audit pack: one self-contained HTML file ──
    function auditPack() {
        var c = C.cy, end = A.busy('Building the audit pack…');
        var need = [C.bal ? null : S.cycle.bal(c.CYCLE_ID).then(function (b) { C.bal = b; }), C.stmts ? null : S.stmt.search({ cycleId: c.CYCLE_ID, limit: 50000 }).then(function (s) { C.stmts = s; }), C.sql != null || !c.STMT_SHA ? null : S.cycle.sql(c.CYCLE_ID).then(function (t) { C.sql = t; }),
            S.cycle.checks(c.CYCLE_ID).then(function (r) { C._ckRows = r; })];
        Promise.all(need).then(function () {
            var cov = E.coverage(C.bal || [], C.stmts || []), k = cov.counts, defs = C.defs(), byId = {}; (C._ckRows || []).forEach(function (r) { byId[r.CHECK_ID] = r; });
            var e = function (s) { return esc(s == null ? '' : s); };
            var css = 'body{font:13px/1.45 Segoe UI,Arial,sans-serif;color:#0f172a;margin:28px auto;max-width:1100px;padding:0 18px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:26px 0 8px;border-bottom:2px solid #0f766e;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #e2e8f0;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f1f5f9;font-size:11px;text-transform:uppercase}.r{text-align:right}.ok{color:#15803d;font-weight:700}.bad{color:#b91c1c;font-weight:700}.warn{color:#b45309;font-weight:700}.m{color:#64748b}pre{background:#f8fafc;border:1px solid #e2e8f0;padding:10px;white-space:pre-wrap;font-size:11px}.band{background:linear-gradient(100deg,#0c3b2e,#0f766e);color:#fff;padding:18px 22px;border-radius:10px}';
            var h = '<!doctype html><html><head><meta charset="utf-8"><title>Statement cycle ' + e(c.PERIOD) + ' · ' + e(c.BU_NAME) + '</title><style>' + css + '</style></head><body>' +
                '<div class="band"><h1>Customer statements · ' + e(E.periodLabel(c.PERIOD)) + '</h1><div>' + e(c.BU_NAME) + ' · ' + e(c.POD) + ' · statements as at ' + e(c.STMT_DATE) + ' · status ' + e(c.STATUS) + '</div><div style="opacity:.8;font-size:12px">Audit pack made ' + e(new Date().toLocaleString('en-GB')) + ' by ' + e(S.user()) + ' · cycle ' + e(c.CYCLE_ID) + '</div></div>' +
                '<h2>1. Checklist</h2><p class="m">Signed off ' + e(S.local(c.CHECKS_AT)) + ' by ' + e(c.CHECKS_BY) + ' · score ' + e(c.CHECKS_SCORE) + '%</p><table><tr><th>Check</th><th>Kind</th><th>Severity</th><th>Result</th><th class="r">Found</th><th class="r">Amount</th><th>Ran</th><th>Bypass</th></tr>' +
                defs.filter(function (d) { return d.enabled !== false || byId[d.id]; }).map(function (d) { var r = byId[d.id] || {}; return '<tr><td>' + e(d.title) + '</td><td>' + e(d.kind) + '</td><td>' + e(d.severity) + '</td><td class="' + (r.STATUS === 'PASS' ? 'ok' : r.BYPASS_NOTE ? 'warn' : 'bad') + '">' + e(r.STATUS || 'not run') + '</td><td class="r">' + e(r.ROWS_N) + '</td><td class="r">' + (r.AMOUNT != null && r.AMOUNT !== '' ? money(+r.AMOUNT) : '') + '</td><td>' + e(S.local(r.RAN_AT)) + ' ' + e(r.RAN_BY) + '</td><td>' + (r.BYPASS_NOTE ? e(r.BYPASS_BY) + ' · ' + e(S.local(r.BYPASS_AT)) + ': “' + e(r.BYPASS_NOTE) + '”' : '') + '</td></tr>'; }).join('') + '</table>' +
                '<h2>2. Archived balances</h2><p class="m">Frozen ' + e(S.local(c.SNAP_AT)) + ' by ' + e(c.SNAP_BY) + ' from ' + e(c.SNAP_SOURCE) + '</p><table><tr><th>Customers</th><th class="r">Total due</th><th class="r">Overdue</th><th class="r">Current</th><th class="r">1–30</th><th class="r">31–60</th><th class="r">61–90</th><th class="r">90+</th><th class="r">In credit</th><th>E-mail / post</th></tr><tr><td>' + e(c.CUSTOMERS) + '</td><td class="r">' + money(+c.TOTAL_DUE) + '</td><td class="r">' + money(+c.OVERDUE) + '</td><td class="r">' + money(+c.CUR_AMT) + '</td><td class="r">' + money(+c.D30) + '</td><td class="r">' + money(+c.D60) + '</td><td class="r">' + money(+c.D90) + '</td><td class="r">' + money(+c.D90P) + '</td><td class="r">' + e(c.CREDIT_N) + ' · ' + money(+c.CREDIT_AMT) + '</td><td>' + e(c.EMAIL_N) + ' / ' + e(c.POST_N) + '</td></tr></table>' +
                (c.PREV_TOTAL != null && c.PREV_TOTAL !== '' ? '<p>Against the previous cycle (' + money(+c.PREV_TOTAL) + '): ' + e(c.NEW_N) + ' new, ' + e(c.CLEARED_N) + ' cleared, ' + e(c.UP_N) + ' owe more, ' + e(c.DOWN_N) + ' owe less.</p>' : '') +
                '<h2>3. Statement report</h2><p>' + e(c.STMT_PATH) + '<br>Data model ' + e(c.STMT_DM) + '<br>SHA-256 of the query: <b>' + e(c.STMT_SHA) + '</b> · ' + (c.STMT_CHANGED === 'Y' ? '<span class="bad">changed since the last cycle</span>' : c.STMT_CHANGED === 'N' ? '<span class="ok">same as the last cycle</span>' : 'first capture') + '<br>Checked by ' + e(c.REVIEW_BY) + ' · ' + e(S.local(c.REVIEW_AT)) + (c.REVIEW_NOTE ? ': “' + e(c.REVIEW_NOTE) + '”' : '') + '</p>' + (C.sql ? '<pre>' + e(C.sql) + '</pre>' : '') +
                '<h2>4. Statements sent</h2><p><b>' + k.pct + '%</b> of ' + k.deliverable + ' — ' + k.emailed + ' e-mailed, ' + k.posted + ' post, ' + k.drafts + ' Outlook drafts, ' + k.failed + ' failed, ' + k.notSent + ' not sent · ' + k.opened + ' opened · ' + k.agreed + ' agreed · ' + k.disputed + ' queried</p>' +
                '<table><tr><th>Account</th><th>Customer</th><th class="r">Archived balance</th><th>Delivery</th><th>To</th><th>Status</th><th>Sent</th><th>Opened</th><th>Answer</th><th>PDF SHA-256</th></tr>' + cov.per.map(function (x) {
                    var r = x.row, s = x.stmt || {}; return '<tr><td>' + e(r.ACCOUNT_NUMBER) + '</td><td>' + e(r.ACCOUNT_NAME) + '</td><td class="r">' + money(+r.BALANCE) + '</td><td>' + e(r.DELIVERY) + '</td><td>' + e(s.EMAIL_TO || '') + '</td><td class="' + (s.STATUS === 'FAILED' ? 'bad' : s.STATUS ? 'ok' : 'warn') + '">' + e(s.STATUS ? E.stmtState(s).label : x.state === 'NONE' ? 'no statement' : 'not sent') + (s.ERROR_TEXT ? ' — ' + e(s.ERROR_TEXT) : '') + '</td><td>' + e(S.local(s.SENT_AT || '')) + '</td><td>' + e(s.OPENS || '') + '</td><td>' + e(s.RESP_STATUS || '') + (s.RESP_COMMENT ? ': ' + e(s.RESP_COMMENT) : '') + '</td><td style="font-size:10px">' + e(s.SHA256 || '') + '</td></tr>';
                }).join('') + '</table>' +
                '<h2>5. Close</h2><p>' + (c.CLOSED_AT ? 'Closed ' + e(S.local(c.CLOSED_AT)) + ' by ' + e(c.CLOSED_BY) + (c.CLOSE_NOTE ? ': “' + e(c.CLOSE_NOTE) + '”' : '') : '<span class="warn">Not closed yet</span>') + '</p>' +
                '<h2>Trail</h2><table><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr>' + (C.events || []).slice().reverse().map(function (x) { return '<tr><td>' + e(S.local(x.EVENT_AT)) + '</td><td>' + e(x.BY_USER) + '</td><td>' + e(x.EVENT) + '</td><td>' + e(x.DETAIL) + '</td></tr>'; }).join('') + '</table>' +
                '<p class="m" style="margin-top:30px">Fusion Debtors Control · Powered by Fusion Client</p></body></html>';
            end();
            return A.saveFile('statement-cycle-' + c.PERIOD + '-' + String(c.BU_NAME || c.BU_ID).replace(/\W+/g, '_') + '.html', h, 'Web page (*.html)|*.html').then(function () { return event('AUDIT_PACK', 'downloaded'); }).then(A.render);
        }).catch(function (e) { end(); A.toast(A.errText(e), 'bad'); });
    }

    // ── new cycle ──
    function newCycle() {
        var b = A.curBu(), d = new Date(), prev = new Date(d.getFullYear(), d.getMonth() - 1, 1), per = prev.getFullYear() + '-' + ('0' + (prev.getMonth() + 1)).slice(-2);
        A.modal('<i class="fas fa-rotate"></i> New statement cycle',
            '<div class="form"><div class="field"><label>Business unit</label><select id="nc-bu">' + P.bus.filter(function (x) { return x.active !== 'N'; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (b && x.id === b.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Month</label><input type="month" id="nc-per" value="' + per + '"></div><div class="field"><label>Statement date</label><input type="date" id="nc-date" value="' + E.monthEnd(per) + '"></div>' +
            '<div class="field"><label>Pod</label><select id="nc-pod"><option' + (P.pod === 'PROD' ? ' selected' : '') + '>PROD</option><option' + (P.pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></div>' +
            '<div class="field"><label>Owner</label><input type="text" id="nc-own" value="' + esc(S.user()) + '"></div><div class="field"><label>Send by</label><input type="date" id="nc-due" value="' + A.addDays(A.today(), 5) + '"></div>' +
            '<div class="field"><label>OM ↔ AR tolerance</label><input type="number" id="nc-tol" step="0.01" value="1"></div>' +
            '<div class="field wide"><label>Note</label><input type="text" id="nc-note" placeholder="optional"></div></div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="ncGo">Create the cycle</button>');
        $('nc-per').onchange = function () { var e2 = E.monthEnd(this.value); if (e2) $('nc-date').value = e2; };
    }

    // ── actions ──
    var ACT = A.ACT;
    ACT.cyNew = newCycle;
    ACT.ncGo = function () {
        var buId = $('nc-bu').value, b = bu(buId), per = $('nc-per').value, date = $('nc-date').value;
        if (!/^\d{4}-\d{2}$/.test(per) || !date) { A.toast('Choose the month and the statement date', 'warn'); return; }
        var c = { id: E.uid('cy'), pod: $('nc-pod').value, buId: buId, buName: b.name, period: per, stmtDate: date, title: 'Customer statements · ' + E.periodLabel(per) + ' · ' + b.name, owner: $('nc-own').value.trim(), due: $('nc-due').value, tolerance: +$('nc-tol').value || 0, note: $('nc-note').value.trim() };
        var end = A.busy('Creating the cycle…');
        S.cycle.create(c).then(function () { return S.cycle.event(c.id, 'CREATED', c.title + ' · as at ' + c.stmtDate + ' · ' + c.pod + (c.note ? ' · ' + c.note : '')); })
            .then(function () { end(); A.mclose(); C.list = null; return DC.openCycle(c.id); }).catch(function (e) { end(); A.toast(A.errText(e), 'bad', 8000); });
    };
    ACT.cyOpen = function (d) { DC.openCycle(d.id); };
    ACT.cyBack = function () { C.open = null; C.cy = null; C.list = null; A.render(); };
    ACT.cyReload = function () { C.cust = null; loadCycle(C.open); };
    ACT.cyStep = function (d) { C.step = d.k; if (d.k === 'send' && !C.stmts && C.cy.SNAP_AT) S.stmt.search({ cycleId: C.cy.CYCLE_ID, limit: 50000 }).then(function (s) { C.stmts = s; A.render(); }); A.render(); };
    ACT.cyPack = auditPack;
    ACT.ckRunAll = function () { runMany(C.defs().filter(function (d) { return d.enabled !== false; })); };
    ACT.ckRunFailed = function () { runMany(C.defs().filter(function (d) { var r = C.results[d.id]; return d.enabled !== false && r && r.status !== 'PASS' && !r.bypassNote; })); };
    ACT.ckRun = function (d) { var x = C.defs().filter(function (c) { return c.id === d.id; })[0]; if (x) runMany([x]); };
    ACT.ckDetail = function (d) { ckDetail(d.id); };
    ACT.ckBypass = function (d) { ckBypass(d.id); };
    ACT.ckBypassGo = function (d) {
        var note = ($('bp-note').value || '').trim();
        if (!E.bypassOk(note)) { A.toast('Write why (at least ' + E.BYPASS_MIN + ' characters)', 'warn'); return; }
        var x = C.defs().filter(function (c) { return c.id === d.id; })[0];
        S.cycle.bypass(C.cy.CYCLE_ID, d.id, note).then(function () {
            var r = C.results[d.id] || {}; r.bypassNote = note; r.bypassBy = S.user(); r.bypassAt = null; C.results[d.id] = r; L.saveChecks();
            return event('CHECK_BYPASSED', (x ? x.title : d.id) + ' (' + (r.status === 'ERROR' ? 'could not run' : r.rows + ' found') + '): ' + note);
        }).then(function () { return S.cycle.checks(C.cy.CYCLE_ID); }).then(function (rows) { rows.forEach(function (r) { if (C.results[r.CHECK_ID]) C.results[r.CHECK_ID].bypassAt = r.BYPASS_AT; }); A.mclose(); A.render(); A.toast('Bypassed — kept with your reason', 'ok'); })
            .catch(function (e) { A.toast(A.errText(e), 'bad'); });
    };
    ACT.ckDone = function () {
        var g = E.gate(C.defs(), C.results);
        if (!g.ready) return;
        setCycle({ checks_at: 'SYSDATE', checks_by: S.user(), checks_score: g.score, status: 'CHECKED' })
            .then(function () { return event('CHECKLIST_DONE', g.passed.length + ' passed · ' + g.bypassed.length + ' bypassed · ' + g.warnings.length + ' warnings · score ' + g.score + '%'); })
            .then(function () { C.step = 'archive'; A.render(); }).catch(function (e) { A.toast(A.errText(e), 'bad'); });
    };
    ACT.ckCsv = function () { var d = C._detail; if (!d || !d.rows.length) return; var cols = Object.keys(d.rows[0]); A.csv('check-' + d.id + '-' + C.cy.PERIOD + '.csv', cols.map(function (c) { return [c, c]; }), d.rows); };
    ACT.ckCopy = function () { try { navigator.clipboard.writeText((C._detail || {}).sql || ''); A.toast('Copied', 'ok'); } catch (e) { } };
    ACT.arRead = function () { prepareArchive(false); };
    ACT.arReread = function () { prepareArchive(true); };
    ACT.arAgain = function () { if (!confirm('Read the balances again and replace the archive of this cycle?')) return; C.bal = null; C.snap = null; C.cust = null; C.cy.SNAP_AT = null; prepareArchive(true); };
    ACT.arSave = saveArchive;
    ACT.arCsv = function () {
        A.csv('archive-' + C.cy.PERIOD + '-' + String(C.cy.BU_NAME || '').replace(/\W+/g, '_') + '.csv', [['ACCOUNT_NUMBER', 'Account'], ['ACCOUNT_NAME', 'Customer'], ['CURRENCY', 'Currency'], ['BALANCE', 'Balance'], ['PREV_BALANCE', 'Previous cycle'], ['OVERDUE', 'Overdue'], ['CUR_AMT', 'Current'], ['D30', '1-30'], ['D60', '31-60'], ['D90', '61-90'], ['D90P', '90+'], ['ITEMS_N', 'Items'], ['EMAIL', 'E-mail'], ['DELIVERY', 'Delivery'], ['WHY', 'Why'], ['SCORE', 'Priority']], C.bal || []);
    };
    ACT.rvCapture = capture;
    ACT.rvDiff = showDiff;
    ACT.rvCopy = function () { try { navigator.clipboard.writeText(C.sql || ''); A.toast('Copied', 'ok'); } catch (e) { } };
    ACT.rvSample = function (d) { sample(d.acct); };
    ACT.rvSampleAny = function () { var a = ($('rv-acct').value || '').trim(); if (a) sample(a); };
    ACT.rvSign = function () {
        if (!$('rv-ok').checked) { A.toast('Tick that you checked the layout and figures', 'warn'); return; }
        var note = ($('rv-note').value || '').trim();
        if (!C.cy.STMT_SHA && !E.bypassOk(note)) { A.toast('The query is not captured — say why in the note', 'warn'); return; }
        setCycle({ review_at: 'SYSDATE', review_by: S.user(), review_note: note || null, status: 'READY' })
            .then(function () { return event('STATEMENT_CHECKED', (note || 'signed off') + (C.cy.STMT_CHANGED === 'Y' ? ' · the query had changed since the last cycle' : '')); })
            .then(function () { return S.stmt.search({ cycleId: C.cy.CYCLE_ID, limit: 50000 }); }).then(function (s) { C.stmts = s; C.step = 'send'; A.render(); }).catch(function (e) { A.toast(A.errText(e), 'bad'); });
    };
    ACT.sdGo = function (d) { goSend(d.w); };
    ACT.sdConfirm = sendConfirm;
    ACT.sdConfirmGo = sendConfirmGo;
    ACT.sdReload = function () { S.stmt.search({ cycleId: C.cy.CYCLE_ID, limit: 50000 }).then(function (s) { C.stmts = s; A.render(); }); };
    ACT.clGo = function () {
        var note = ($('cl-note').value || '').trim(), cov = C.bal && C.stmts ? E.coverage(C.bal, C.stmts).counts : { pct: 0, failed: 0, notSent: 0 };
        if ((cov.failed || cov.notSent) && !E.bypassOk(note)) { A.toast('Not every customer got the statement — say why in the note', 'warn'); return; }
        if (!confirm('Close the cycle? It becomes read-only.')) return;
        setCycle({ closed_at: 'SYSDATE', closed_by: S.user(), close_note: note || null, status: 'CLOSED', sent_n: cov.emailed + (cov.drafts || 0), posted_n: cov.posted, failed_n: cov.failed, cover_pct: cov.pct })
            .then(function () { return event('CLOSED', cov.pct + '% sent' + (note ? ' · ' + note : '')); }).then(function () { C.list = null; A.render(); A.toast('Cycle closed', 'ok'); }).catch(function (e) { A.toast(A.errText(e), 'bad'); });
    };
    ACT.clReopen = function () {
        var why = prompt('Why reopen the cycle? (kept in the trail)', ''); if (!why || !E.bypassOk(why)) { if (why != null) A.toast('Write why (at least ' + E.BYPASS_MIN + ' characters)', 'warn'); return; }
        setCycle({ closed_at: { sql: 'NULL' }, closed_by: null, status: 'SENDING' }).then(function () { return event('REOPENED', why); }).then(function () { C.list = null; A.render(); }).catch(function (e) { A.toast(A.errText(e), 'bad'); });
    };

    // ── Setup › the checklist editor ──
    DC.checklistCard = function () {
        var defs = C.saved ? C.defs() : null;
        if (!defs) { loadDefs().then(A.render); return '<div class="card"><h2><i class="fas fa-list-check"></i> Statement cycle checklist</h2><div class="muted">loading…</div></div>'; }
        return '<div class="card"><h2><i class="fas fa-list-check"></i> Statement cycle checklist <span class="sp"></span><button class="btn sm" data-act="ckAdd"><i class="fas fa-plus"></i> Add a check</button></h2><div class="small muted" style="margin-bottom:8px">Every cycle runs these. A check returns the exceptions — nothing found = passed; a column AMOUNT is added up. Values: {BU_ID} {STMT_DATE} {PERIOD_START} {MON_YY} {TOLERANCE} …</div>' +
            '<table class="tbl"><thead><tr><th>On</th><th>Check</th><th>Area</th><th>Kind</th><th>Severity</th><th></th></tr></thead><tbody>' + defs.concat(((C.saved || []).filter(function (x) { return x.removed; }))).filter(function (d) { return !d.removed; }).map(function (d) {
                return '<tr><td><input type="checkbox" class="ck-on" data-id="' + esc(d.id) + '"' + (d.enabled !== false ? ' checked' : '') + '></td><td><b>' + esc(d.title) + '</b>' + (d.custom ? ' ' + pill('yours', 'vio') : '') + '<div class="small muted">' + esc(d.id) + '</div></td><td>' + esc(d.area) + '</td><td>' + esc(d.kind) + '</td>' +
                    '<td><select class="ck-sev" data-id="' + esc(d.id) + '"><option value="BLOCK"' + (d.severity === 'BLOCK' ? ' selected' : '') + '>blocking</option><option value="WARN"' + (d.severity !== 'BLOCK' ? ' selected' : '') + '>warning</option></select></td><td class="r">' + (d.kind !== 'LOCAL' ? '<button class="btn sm" data-act="ckEdit" data-id="' + esc(d.id) + '">Edit</button>' : '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    };
    function saveDef(id, patch) {
        var list = (C.saved || []).slice(), i = list.findIndex(function (x) { return x.id === id; });
        if (i >= 0) list[i] = Object.assign({}, list[i], patch); else list.push(Object.assign({ id: id }, patch));
        return S.settings.save('CHECKS', list).then(function () { C.saved = list; A.render(); A.toast('Checklist saved', 'ok'); }).catch(function (e) { A.toast(A.errText(e), 'bad'); });
    }
    function editDef(d, isNew) {
        A.modal('<i class="fas fa-list-check"></i> ' + (isNew ? 'New check' : esc(d.title)),
            '<div class="form"><div class="field"><label>Id</label><input type="text" id="ce-id" value="' + esc(d.id || '') + '"' + (isNew ? '' : ' disabled') + ' placeholder="MY_CHECK"></div><div class="field"><label>Title (what must be true)</label><input type="text" id="ce-title" value="' + esc(d.title || '') + '"></div>' +
            '<div class="field"><label>Area</label><select id="ce-area">' + E.AREAS.map(function (a) { return '<option' + (d.area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Kind</label><select id="ce-kind"><option value="SQL"' + (d.kind !== 'BIP' ? ' selected' : '') + '>Fusion SQL</option><option value="BIP"' + (d.kind === 'BIP' ? ' selected' : '') + '>BI Publisher report</option></select></div>' +
            '<div class="field wide"><label>Fusion SQL (returns the exceptions)</label><textarea class="code" id="ce-sql" rows="9">' + esc(d.sql || '') + '</textarea></div>' +
            '<div class="field wide"><label>BI Publisher report path</label><input type="text" id="ce-path" value="' + esc(d.path || '') + '"></div><div class="field wide"><label>Report parameters (name = value)</label><textarea class="code" id="ce-params" rows="2">' + esc(Object.keys(d.params || {}).map(function (k) { return k + ' = ' + d.params[k]; }).join('\n')) + '</textarea></div>' +
            '<div class="field wide"><label>Help (shown under the check)</label><input type="text" id="ce-help" value="' + esc(d.help || '') + '"></div></div>',
            (!isNew && d.custom ? '<button class="btn bad" data-act="ceDel" data-id="' + esc(d.id) + '">Remove</button>' : '') + (!isNew && !d.custom ? '<button class="btn" data-act="ceReset" data-id="' + esc(d.id) + '">Back to the starter</button>' : '') + '<span class="sp"></span><button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="ceSave" data-new="' + (isNew ? 1 : 0) + '">Save</button>', true);
    }
    ACT.ckAdd = function () { editDef({ area: 'Other', kind: 'SQL', severity: 'WARN', sql: "SELECT … FROM … WHERE org_id = {BU_ID} AND … <= TO_DATE('{STMT_DATE}', 'YYYY-MM-DD')" }, true); };
    ACT.ckEdit = function (d) { var x = C.defs().filter(function (c) { return c.id === d.id; })[0]; if (x) editDef(x, false); };
    ACT.ceSave = function (d) {
        var id = ($('ce-id').value || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (!id) { A.toast('Give it an id', 'warn'); return; }
        var params = {}; String($('ce-params').value || '').split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) params[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
        var patch = { title: $('ce-title').value.trim() || id, area: $('ce-area').value, kind: $('ce-kind').value, sql: $('ce-sql').value, path: $('ce-path').value.trim(), params: params, help: $('ce-help').value.trim() };
        if (d.new === '1') { if (C.defs().some(function (c) { return c.id === id; })) { A.toast('That id is taken', 'warn'); return; } patch.severity = 'WARN'; patch.enabled = true; patch.custom = true; }
        A.mclose(); saveDef(id, patch);
    };
    ACT.ceDel = function (d) { if (!confirm('Remove this check from the checklist?')) return; A.mclose(); saveDef(d.id, { removed: true }); };
    ACT.ceReset = function (d) { var list = (C.saved || []).filter(function (x) { return x.id !== d.id; }); A.mclose(); S.settings.save('CHECKS', list).then(function () { C.saved = list; A.render(); }); };

    // ── wiring (filters, the checklist switches) ──
    document.addEventListener('change', function (e) {
        var t = e.target;
        if (t.id === 'cy-bu') { C.f.bu = t.value; lsSet('cy.bu', t.value); A.render(); }
        else if (t.classList && t.classList.contains('ck-on')) saveDef(t.dataset.id, { enabled: t.checked });
        else if (t.classList && t.classList.contains('ck-sev')) saveDef(t.dataset.id, { severity: t.value });
    });
    document.addEventListener('click', function (e) {
        var b = e.target.closest('#cy-st button, #sd-f button'); if (!b) return;
        if (b.dataset.s != null) { C.f.state = b.dataset.s; A.render(); }
        if (b.dataset.f != null) { C.sendF = b.dataset.f; A.render(); }
    });
    var qT = 0;
    document.addEventListener('input', function (e) { if (e.target.id === 'ar-q') { C.balQ = e.target.value; clearTimeout(qT); qT = setTimeout(function () { var pos = e.target.selectionStart; A.render(); var n = $('ar-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { } } }, 200); } });
})();
