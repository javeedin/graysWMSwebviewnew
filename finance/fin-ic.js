/* Finance Lens — Inter company (tab ic). Every intercompany transaction of Oracle Fusion, month by month:
     FUN  Intercompany module transactions       AR  receivables billed to another company of the group
     AP   payables from another group company    INV inventory transfers between legal entities
     GL   journal lines on intercompany accounts BAL GL balances by company × counterparty (intercompany segment)
     + ENT legal entities / business units / organisations (to name both sides and map them to companies)
   Sync (AI admins) = host finIcSync, one month at a time → DuckDB rr_ic_* (FinanceIc.cs), then copied to APEX RR_IC_*
   (apex_sql/89_inter_company.sql, created by the page). Views: Sync & checklist (month board), Overview (findings, flows,
   network, trend), Reconciliation (pairs of companies must net to nil), Matching (AR ↔ AP, FUN → AR / AP, notes),
   Transactions, Settings (ledgers + intercompany segment, accounts, customers / suppliers, own SQL per kind).
   Matching and reconciliation run in finance/fin-ic-engine.js (FIC). Works before any GL load (FL.render lets it through). */
(function () {
    var IC = FL.ic = {};
    var KINDS = [['FUN', 'Intercompany (FUN)', 'fa-right-left'], ['AR', 'Receivables', 'fa-file-invoice-dollar'], ['AP', 'Payables', 'fa-file-invoice'],
        ['INV', 'Inventory transfers', 'fa-truck-ramp-box'], ['GL', 'GL journal lines', 'fa-book'], ['BAL', 'GL balances', 'fa-scale-balanced']];
    var KN = {}; KINDS.forEach(function (k) { KN[k[0]] = k; });
    var HOST_LABEL = { 'Legal entities': 'ENT', 'Intercompany transactions': 'FUN', 'Receivables': 'AR', 'Payables': 'AP', 'Inventory transfers': 'INV', 'GL journal lines': 'GL', 'GL balances': 'BAL' };
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var VIEWS = [['sync', 'fa-rotate', 'Sync & checklist'], ['overview', 'fa-diagram-project', 'Overview'], ['recon', 'fa-scale-balanced', 'Reconciliation'],
        ['match', 'fa-link', 'Matching'], ['trx', 'fa-table-list', 'Transactions'], ['settings', 'fa-sliders', 'Settings']];
    var STATUS = { MATCHED: ['pos', 'Matched'], TIMING: ['info', 'Timing'], DIFF: ['warn', 'Amounts differ'], SELL_ONLY: ['neg', 'No payable'], BUY_ONLY: ['neg', 'No receivable'],
        OK: ['pos', 'Nets to nil'], ONE_SIDED: ['neg', 'One side only'], CURRENCY: ['info', 'Two currencies'], COMPLETE: ['pos', 'AR + AP'], NO_AP: ['warn', 'No AP'], NO_AR: ['warn', 'No AR'], NOT_FOUND: ['neg', 'Invoices not found'], GL_ONLY: ['info', 'GL only'] };
    var today = new Date(), thisMonth = today.getFullYear() * 100 + today.getMonth() + 1;
    var S = IC.st = { pod: FL.ls('ic.pod', ''), year: FL.ls('ic.year', today.getFullYear()), view: FL.ls('ic.view', 'sync'), month: FL.ls('ic.month', null), kind: FL.ls('ic.kind', ''), mf: FL.ls('ic.mf', '') };
    var q = FL.q, money = function (v) { return v == null || v === '' ? '' : FINE.fmt(+v, 'num', { decimals: 2 }); };
    var mname = function (m) { m = +m; return m ? MON[(m % 100) - 1] + ' ' + Math.floor(m / 100) : 'every month'; };
    var chip = function (st) { var s = STATUS[st] || ['', st]; return '<span class="ic-st ' + s[0] + '">' + esc(s[1]) + '</span>'; };
    var admin = function () { return !!(FL.who && FL.who.admin); };

    IC.cfg = function () {
        FL.config = FL.config || {};
        var c = FL.config.ic = FL.config.ic || {};
        if (c.tol == null) c.tol = 1; if (c.window == null) c.window = 1; if (c.crossLe == null) c.crossLe = true; if (c.useCategory == null) c.useCategory = true;
        if (c.pageSize == null) c.pageSize = 5000; if (c.apex == null) c.apex = true;
        c.icSeg = c.icSeg || {}; c.queries = c.queries || {}; c.icAccounts = c.icAccounts || []; c.customers = c.customers || []; c.suppliers = c.suppliers || [];
        return c;
    };
    IC.months = function (y) { var out = []; for (var i = 1; i <= 12; i++) out.push(+y * 100 + i); return out; };

    // ── discovery: ledgers with their company / account / intercompany segments ──
    IC.disc = function () {
        if (IC._disc && IC._disc.pod === S.pod) return Promise.resolve(IC._disc.d);
        return (FL.fusion && FL.fusion.getDisc ? FL.fusion.getDisc(S.pod) : Promise.resolve(null)).then(function (r) { IC._disc = { pod: S.pod, d: r && r.disc }; return IC._disc.d; });
    };
    /** Every discovered ledger with the segments the sync needs (ic = chosen in Settings, else what discovery found) */
    IC.allLedgers = function () {
        var d = IC._disc && IC._disc.d; if (!d) return [];
        var roles = FL.fusion.rolesOf(d), cfg = IC.cfg();
        return (d.ledgers || []).filter(function (l) { return l.coaId; }).map(function (l) {
            var r = roles[l.coaId] || {}, coa = (d.coas || {})[l.coaId] || {};
            var ic = cfg.icSeg[l.coaId] != null ? cfg.icSeg[l.coaId] : (r.intercompany || coa.intercompany || '');
            return { id: String(l.id), name: l.name, coaId: l.coaId, currency: l.currency, company: r.company || coa.company, account: r.account || coa.account, ic: ic || null,
                why: ic && cfg.icSeg[l.coaId] == null ? ((coa.why || {}).intercompany || 'found by discovery') : ic ? 'chosen in Settings' : '', segments: coa.segments || [], companies: l.companies || [] };
        });
    };
    IC.ledgers = function () {
        var cfg = IC.cfg(), all = IC.allLedgers(), d = IC._disc && IC._disc.d;
        var ids = Array.isArray(cfg.ledgers) && cfg.ledgers.length ? cfg.ledgers : d && FL.fusion.defaultIds ? FL.fusion.defaultIds(d) : all.map(function (l) { return l.id; });
        return all.filter(function (l) { return ids.indexOf(l.id) >= 0; });
    };
    /** Intercompany accounts: the list in Settings, else the accounts classed Intercompany */
    IC.classed = function () {
        var out = {}; (FL.dims && FL.dims.accounts || []).forEach(function (a) { if (a.class === 'Intercompany') out[a.code] = 1; });
        Object.keys((FL.config || {}).accountClass || {}).forEach(function (k) { if (FL.config.accountClass[k] === 'Intercompany') out[k] = 1; });
        return Object.keys(out).sort();
    };
    IC.icAccounts = function () { var c = IC.cfg(); return c.icAccounts.length ? c.icAccounts : IC.classed(); };
    IC.options = function (months, kinds) {
        var c = IC.cfg();
        return { pod: S.pod || '', months: months, kinds: kinds, ledgers: IC.ledgers().map(function (l) { return { id: l.id, name: l.name, company: l.company, account: l.account, ic: l.ic }; }),
            icAccounts: IC.icAccounts(), icCustomers: c.customers, icSuppliers: c.suppliers, crossLeOnly: c.crossLe, useCategory: c.useCategory, pageSize: c.pageSize, queries: c.queries };
    };

    // ── what is on this PC: rr_ic_sync per kind × month × scope ──
    IC.loadStatus = function () {
        return FL.call('finIcStatus', { pod: S.pod || '' }).then(function (r) {
            var cells = {};
            (r.rows || []).forEach(function (x) {
                var k = x.kind + '|' + x.month, c = cells[k] = cells[k] || { kind: x.kind, month: +x.month, scopes: 0, ok: 0, rows: 0, total: 0, at: '', errors: [], alts: [], reads: [] };
                c.scopes++; if (x.ok) c.ok++; else if (x.error) c.errors.push(x.error);
                c.rows += +x.rows || 0; c.total += +x.total || 0; if (String(x.at) > c.at) c.at = String(x.at); if (x.alt) c.alts.push(x.alt); c.reads.push(x);
            });
            IC.cells = cells; IC.rawStatus = r.rows || [];
            return cells;
        });
    };
    IC.stateOf = function (kind, m) {
        var lv = IC.live; if (lv) { if (lv.cur === kind + '|' + m) return 'running'; if (lv.queue[kind + '|' + m]) return 'queued'; }
        var c = (IC.cells || {})[kind + '|' + m];
        if (!c) return m > thisMonth ? 'future' : 'none';
        return c.ok === c.scopes ? 'done' : c.ok ? 'part' : 'failed';
    };
    IC.missing = function (kinds, months) {
        var plan = [];
        months.forEach(function (m) { if (m > thisMonth) return; var ks = kinds.filter(function (k) { var s = IC.stateOf(k, m); return s !== 'done'; }); if (ks.length) plan.push({ month: m, kinds: ks }); });
        return plan;
    };

    // ── APEX copy: RR_IC_* (the same rows, shared by every PC) ──
    var A = IC.apex = {};
    var TCOLS = ['src_id', 'doc_number', 'line_num', 'doc_type', 'doc_date', 'gl_date', 'status', 'from_le', 'from_bu', 'from_org', 'from_company', 'to_le', 'to_bu', 'to_org', 'to_company',
        'party_number', 'party_name', 'currency', 'amount_entered', 'amount', 'account', 'item', 'quantity', 'reference', 'ref2', 'description', 'ledger_id'];
    var NUMC = { line_num: 1, amount_entered: 1, amount: 1, quantity: 1, opening: 1, dr: 1, cr: 1, closing: 1, rows_read: 1, total: 1, month: 1 };
    var TRX_DDL = function (t) {
        return 'CREATE TABLE ' + t + ' (pod VARCHAR2(20), kind VARCHAR2(10), month NUMBER, scope VARCHAR2(40), ' + TCOLS.map(function (c) {
            return c + (NUMC[c] ? ' NUMBER' : c === 'description' ? ' VARCHAR2(1000)' : c === 'party_name' || c === 'item' ? ' VARCHAR2(400)' : ' VARCHAR2(240)'); }).join(', ') + ', fetched_at DATE)';
    };
    A.TABLES = {
        RR_IC_SYNC: 'CREATE TABLE rr_ic_sync (pod VARCHAR2(20) NOT NULL, kind VARCHAR2(10) NOT NULL, month NUMBER NOT NULL, scope VARCHAR2(40) NOT NULL, ok CHAR(1), rows_read NUMBER, total NUMBER, ' +
            'alt VARCHAR2(400), error VARCHAR2(4000), fetched_at DATE, fetched_by VARCHAR2(100), copied_at DATE DEFAULT SYSDATE, copied_by VARCHAR2(100), CONSTRAINT rr_ic_sync_pk PRIMARY KEY (pod, kind, month, scope))',
        RR_IC_ENTITIES: 'CREATE TABLE rr_ic_entities (pod VARCHAR2(20), ent_type VARCHAR2(10), id VARCHAR2(40), code VARCHAR2(100), name VARCHAR2(400), le_id VARCHAR2(40), party_id VARCHAR2(40), ledger_id VARCHAR2(40), bu_id VARCHAR2(40), companies VARCHAR2(2000), fetched_at DATE)',
        RR_IC_FUN: TRX_DDL('rr_ic_fun'), RR_IC_AR: TRX_DDL('rr_ic_ar'), RR_IC_AP: TRX_DDL('rr_ic_ap'), RR_IC_INV: TRX_DDL('rr_ic_inv'), RR_IC_GL: TRX_DDL('rr_ic_gl'),
        RR_IC_BAL: 'CREATE TABLE rr_ic_bal (pod VARCHAR2(20), month NUMBER, scope VARCHAR2(40), ledger_id VARCHAR2(40), period_name VARCHAR2(30), company VARCHAR2(60), account VARCHAR2(60), ic_company VARCHAR2(60), ' +
            'currency VARCHAR2(15), opening NUMBER, dr NUMBER, cr NUMBER, closing NUMBER, fetched_at DATE)',
        RR_IC_NOTES: 'CREATE TABLE rr_ic_notes (pod VARCHAR2(20) NOT NULL, kind VARCHAR2(10) NOT NULL, src_id VARCHAR2(100) NOT NULL, month NUMBER, status VARCHAR2(20), note VARCHAR2(2000), ' +
            'noted_by VARCHAR2(100), noted_at DATE DEFAULT SYSDATE, CONSTRAINT rr_ic_notes_pk PRIMARY KEY (pod, kind, src_id))'
    };
    var ready = null, podKey = function () { return S.pod || 'LOGGED-IN'; };
    A.ensure = function () {
        if (ready) return ready;
        var names = Object.keys(A.TABLES);
        ready = FL.apexStore.read("SELECT table_name FROM user_tables WHERE table_name IN (" + names.map(function (n) { return "'" + n + "'"; }).join(', ') + ")").then(function (rows) {
            var have = {}; rows.forEach(function (r) { have[r.TABLE_NAME] = 1; });
            return names.filter(function (t) { return !have[t]; }).reduce(function (p, t) { return p.then(function () { return FL.apexStore.write(A.TABLES[t]); }); }, Promise.resolve());
        }).catch(function (e) { ready = null; throw e; });
        return ready;
    };
    var lit = function (v, c) {
        if (v == null || v === '') return 'NULL';
        if (NUMC[c]) { var n = +v; return isFinite(n) ? String(n) : 'NULL'; }
        if (c === 'fetched_at') return "TO_DATE('" + String(v).slice(0, 19).replace('T', ' ') + "', 'YYYY-MM-DD HH24:MI:SS')";
        var s = String(v); s = s.length > (c === 'description' ? 1000 : 400) ? s.slice(0, c === 'description' ? 1000 : 400) : s;
        return "'" + s.replace(/'/g, "''") + "'";
    };
    /** INSERT … SELECT … FROM dual UNION ALL in pieces of ~30 KB */
    A.insert = function (table, cols, rows, onStep) {
        var parts = [], cur = [], size = 0;
        rows.forEach(function (r) {
            var sel = 'SELECT ' + cols.map(function (c) { return lit(r[c], c); }).join(', ') + ' FROM dual';
            if (size + sel.length > 30000 && cur.length) { parts.push(cur); cur = []; size = 0; }
            cur.push(sel); size += sel.length + 11;
        });
        if (cur.length) parts.push(cur);
        return parts.reduce(function (p, part, i) {
            return p.then(function () { if (onStep) onStep(i + 1, parts.length); return FL.apexStore.write('INSERT INTO ' + table + ' (' + cols.join(', ') + ') ' + part.join(' UNION ALL ')); });
        }, Promise.resolve());
    };
    /** Copies one kind × month (every scope) from DuckDB to APEX */
    A.copy = function (kind, month, onStep) {
        var reads = IC.rawStatus.filter(function (x) { return x.kind === kind && +x.month === +month && x.ok; });
        if (!reads.length) return Promise.resolve(0);
        var dt = kind === 'ENT' ? 'rr_ic_entities' : kind === 'BAL' ? 'rr_ic_bal' : 'rr_ic_' + kind.toLowerCase(), at = "strftime(fetched_at, '%Y-%m-%d %H:%M:%S') AS fetched_at";
        var cols = kind === 'ENT' ? ['pod', 'ent_type', 'id', 'code', 'name', 'le_id', 'party_id', 'ledger_id', 'bu_id', 'companies', 'fetched_at']
            : kind === 'BAL' ? ['pod', 'month', 'scope', 'ledger_id', 'period_name', 'company', 'account', 'ic_company', 'currency', 'opening', 'dr', 'cr', 'closing', 'fetched_at']
            : ['pod', 'kind', 'month', 'scope'].concat(TCOLS, ['fetched_at']);
        var sel = kind === 'BAL' ? "SELECT * EXCLUDE (fetched_at), COALESCE(opening, 0) + COALESCE(dr, 0) - COALESCE(cr, 0) AS closing, " + at
            : "SELECT * EXCLUDE (fetched_at" + (kind === 'ENT' ? '' : ', extra_json') + "), " + at;
        var total = 0;
        return A.ensure().then(function () {
            return FL.rows(sel + ' FROM ' + dt + ' WHERE pod = ' + q(S.pod || '') + (kind === 'ENT' ? '' : ' AND month = ' + (+month)), 500000);
        }).then(function (rows) {
            total = rows.length;
            rows.forEach(function (r) { r.pod = podKey(); });
            var del = 'DELETE FROM ' + dt + ' WHERE pod = ' + q(podKey()) + (kind === 'ENT' ? '' : ' AND month = ' + (+month));
            return FL.apexStore.write(del).then(function () { return A.insert(dt.toUpperCase(), cols, rows, onStep); });
        }).then(function () {
            return reads.reduce(function (p, x) {
                return p.then(function () {
                    return FL.apexStore.write('MERGE INTO rr_ic_sync t USING (SELECT ' + q(podKey()) + ' pod, ' + q(kind) + ' kind, ' + (+month) + ' month, ' + q(x.scope) + ' scope FROM dual) s ' +
                        'ON (t.pod = s.pod AND t.kind = s.kind AND t.month = s.month AND t.scope = s.scope) WHEN MATCHED THEN UPDATE SET ok = ' + q(x.ok ? 'Y' : 'N') + ', rows_read = ' + (+x.rows || 0) + ', total = ' + (+x.total || 0) +
                        ', alt = ' + lit(x.alt, 'alt') + ', fetched_at = ' + lit(x.at, 'fetched_at') + ', fetched_by = ' + lit(x.by, 'by') + ', copied_at = SYSDATE, copied_by = ' + q((FL.who || {}).user || '') +
                        ' WHEN NOT MATCHED THEN INSERT (pod, kind, month, scope, ok, rows_read, total, alt, fetched_at, fetched_by, copied_by) VALUES (s.pod, s.kind, s.month, s.scope, ' + q(x.ok ? 'Y' : 'N') + ', ' +
                        (+x.rows || 0) + ', ' + (+x.total || 0) + ', ' + lit(x.alt, 'alt') + ', ' + lit(x.at, 'fetched_at') + ', ' + lit(x.by, 'by') + ', ' + q((FL.who || {}).user || '') + ')');
                });
            }, Promise.resolve());
        }).then(function () { return total; });
    };
    /** kind|month → {reads: n, same: n} — which reads on this PC are in APEX as they are here */
    A.status = function () {
        return A.ensure().then(function () {
            return FL.apexStore.read("SELECT kind, month, scope, rows_read, TO_CHAR(fetched_at, 'YYYY-MM-DD HH24:MI:SS') fa FROM rr_ic_sync WHERE pod = " + q(podKey()), 20000);
        }).then(function (rows) {
            var ap = {}; rows.forEach(function (r) { ap[r.KIND + '|' + r.MONTH + '|' + r.SCOPE] = r; });
            var out = {};
            (IC.rawStatus || []).filter(function (x) { return x.ok; }).forEach(function (x) {
                var k = x.kind + '|' + x.month, o = out[k] = out[k] || { reads: 0, same: 0 }, a = ap[x.kind + '|' + x.month + '|' + x.scope];
                o.reads++; if (a && +a.ROWS_READ === +x.rows && String(a.FA || '').slice(0, 16) === String(x.at || '').replace('T', ' ').slice(0, 16)) o.same++;
            });
            IC.apexState = out; return out;
        }).catch(function (e) { IC.apexState = { error: String(e && e.message || e) }; return IC.apexState; });
    };
    A.copyMany = function (list) {
        var bz = FL.busy.start('Inter company · copying to APEX'), n = 0;
        return list.reduce(function (p, it, i) {
            return p.then(function () {
                FL.busy.line(bz, (i + 1) + ' of ' + list.length + ' · ' + it.kind + ' ' + mname(it.month));
                return A.copy(it.kind, it.month, function (k, t) { if (t > 1) FL.busy.line(bz, (i + 1) + ' of ' + list.length + ' · ' + it.kind + ' ' + mname(it.month) + ' · part ' + k + ' of ' + t); }).then(function (c) { n += c; });
            });
        }, Promise.resolve()).then(function () { FL.busy.end(bz); FL.toast(n.toLocaleString() + ' row(s) copied to APEX', 'ok'); return A.status(); })
            .catch(function (e) { FL.busy.end(bz, String(e && e.message || e)); FL.toast('APEX: ' + (e && e.message || e), 'err'); });
    };
    A.notes = function (month) {
        return A.ensure().then(function () {
            return FL.apexStore.read("SELECT kind, src_id, status, note, noted_by, TO_CHAR(noted_at, 'YYYY-MM-DD HH24:MI') na FROM rr_ic_notes WHERE pod = " + q(podKey()) + (month ? ' AND month BETWEEN ' + (+month - 1) + ' AND ' + (+month + 1) : ''), 20000);
        }).then(function (rows) { var o = {}; rows.forEach(function (r) { o[r.KIND + '|' + r.SRC_ID] = r; }); return o; }).catch(function () { return {}; });
    };
    A.saveNote = function (kind, srcId, month, status, note) {
        return A.ensure().then(function () {
            return FL.apexStore.write('MERGE INTO rr_ic_notes t USING (SELECT ' + q(podKey()) + ' pod, ' + q(kind) + ' kind, ' + q(srcId) + ' src_id FROM dual) s ON (t.pod = s.pod AND t.kind = s.kind AND t.src_id = s.src_id) ' +
                'WHEN MATCHED THEN UPDATE SET status = ' + q(status) + ', note = ' + lit(note, 'note') + ', month = ' + (+month || 'NULL') + ', noted_by = ' + q((FL.who || {}).user || '') + ', noted_at = SYSDATE ' +
                'WHEN NOT MATCHED THEN INSERT (pod, kind, src_id, month, status, note, noted_by) VALUES (s.pod, s.kind, s.src_id, ' + (+month || 'NULL') + ', ' + q(status) + ', ' + lit(note, 'note') + ', ' + q((FL.who || {}).user || '') + ')');
        });
    };

    // ── sync: one host call per month (Stop ends the current month and drops the rest) ──
    IC.sync = function (plan, withEnt, label) {
        if (!admin()) { FL.toast('Only an AI admin can sync from Fusion', 'err'); return Promise.resolve(); }
        if (IC.live) { FL.toast('An intercompany sync is already running', 'info'); return Promise.resolve(); }
        if (!plan.length && !withEnt) { FL.toast('Nothing to sync — every month asked is on this PC', 'info'); return Promise.resolve(); }
        var cfg = IC.cfg(), log = FL.fusion.progress('Inter company sync' + (label ? ' · ' + label : '') + '…', 'finIcSync');
        IC.live = { cur: null, queue: {} };
        plan.forEach(function (p) { p.kinds.forEach(function (k) { IC.live.queue[k + '|' + p.month] = 1; }); });
        if (withEnt) IC.live.queue['ENT|0'] = 1;
        IC.paintBoard();
        var stopped = null, failed = [], copied = [];
        var steps = plan.slice(); if (withEnt && !steps.length) steps.push({ month: 0, kinds: [] });
        var one = function (p, i) {
            var kinds = p.kinds.slice(); if (i === 0 && withEnt) kinds.unshift('ENT');
            var mo = p.month ? [p.month] : [];
            return FL.call('finIcSync', { options: IC.options(mo, kinds) }, 3.1 * 3600000, function (m) {
                log(m);
                var mm = /^\[\d+\/\d+\] ▶ ([^·]+?)(?: · (\d{4})-(\d{2}))?(?: · |$)/.exec(String(m || ''));
                if (mm) {
                    var kk = Object.keys(HOST_LABEL).filter(function (h) { return mm[1].indexOf(h) === 0; })[0];
                    if (kk) { var key = HOST_LABEL[kk] + '|' + (mm[2] ? +mm[2] * 100 + +mm[3] : 0); if (IC.live.cur && IC.live.cur !== key) delete IC.live.queue[IC.live.cur]; IC.live.cur = key; IC.paintBoard(); }
                }
            }).then(function (r) {
                (r.results || []).forEach(function (x) { if (!x.ok) failed.push(x.kind + ' ' + mname(x.month) + ': ' + x.error); else copied.push({ kind: x.kind, month: x.month }); });
            }).then(function () {
                kinds.forEach(function (k) { delete IC.live.queue[k + '|' + (k === 'ENT' ? 0 : p.month)]; }); IC.live.cur = null;
                return IC.loadStatus().then(function () { IC.paintBoard(); });
            });
        };
        var chain = steps.reduce(function (pr, p, i) { return pr.then(function () { if (!stopped) return one(p, i).catch(function (e) { stopped = String(e && e.message || e); }); }); }, Promise.resolve());
        return chain.then(function () {
            FL.fusion.finish(stopped);
            IC.live = null;
            var uniq = {}; copied = copied.filter(function (c) { var k = c.kind + '|' + c.month; if (uniq[k]) return false; uniq[k] = 1; return true; });
            if (failed.length) FL.toast(failed.length + ' read(s) failed — ' + failed[0], 'err'); else if (!stopped) FL.toast('Intercompany data synced', 'ok');
            if (stopped) FL.toast(stopped, 'err');
            return IC.loadStatus();
        }).then(function () {
            IC.paintBoard();
            if (cfg.apex && copied.length) return A.copyMany(copied).then(function () { IC.paintBoard(); IC.md(); });
            IC.md();
        });
    };
    IC.remove = function (months, kinds) {
        if (!admin()) return;
        if (!confirm('Forget ' + (kinds ? kinds.join(', ') : 'every kind') + ' for ' + months.map(mname).join(', ') + ' on this PC? (APEX keeps its copy)')) return;
        FL.call('finIcDelete', { pod: S.pod || '', months: months, kinds: kinds || KINDS.map(function (k) { return k[0]; }) }).then(function () { return IC.loadStatus(); }).then(function () { IC.paintBoard(); IC.md(); FL.toast('Removed', 'ok'); })
            .catch(function (e) { FL.toast(String(e), 'err'); });
    };

    // ═════ page ═════
    FL.TABS.ic = { render: function (el) { return IC.render(el); } };
    IC.render = function (el) {
        var years = [], y0 = today.getFullYear(); for (var y = y0 - 4; y <= y0; y++) years.push(y);
        el.innerHTML = '<div class="ic-head card"><div class="row"><h2 style="margin:0"><i class="fa-solid fa-diagram-project"></i> Inter company</h2>' +
            '<label class="sm">Pod <select id="ic-pod"><option value="">Logged-in pod</option><option value="PROD"' + (S.pod === 'PROD' ? ' selected' : '') + '>PROD</option><option value="TEST"' + (S.pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
            '<div class="seg" id="ic-years">' + years.map(function (yy) { return '<button data-y="' + yy + '" class="' + (yy === +S.year ? 'on' : '') + '">' + yy + '</button>'; }).join('') + '</div>' +
            '<span class="grow"></span><span class="sm muted" id="ic-sum"></span></div>' +
            '<div class="seg ic-views">' + VIEWS.map(function (v) { return '<button data-v="' + v[0] + '" class="' + (S.view === v[0] ? 'on' : '') + '"><i class="fa-solid ' + v[1] + '"></i> ' + v[2] + '</button>'; }).join('') + '</div></div>' +
            '<div id="ic-body"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>';
        $('ic-pod').onchange = function () { S.pod = this.value; FL.lsSet('ic.pod', S.pod); IC._disc = null; IC.render(el); };
        el.querySelectorAll('#ic-years button').forEach(function (b) { b.onclick = function () { S.year = +b.dataset.y; FL.lsSet('ic.year', S.year); S.month = null; IC.render(el); }; });
        el.querySelectorAll('.ic-views button').forEach(function (b) { b.onclick = function () { S.view = b.dataset.v; FL.lsSet('ic.view', S.view); el.querySelectorAll('.ic-views button').forEach(function (x) { x.classList.toggle('on', x === b); }); IC.view(); }; });
        return Promise.all([IC.disc().catch(function () { return null; }), IC.loadStatus().catch(function (e) { IC.cells = {}; IC.rawStatus = []; IC.statusError = String(e); })]).then(function () { return IC.view(); });
    };
    IC.synced = function (kinds) {   // months of the year with data (any of these kinds)
        return IC.months(S.year).filter(function (m) { return (kinds || KINDS.map(function (k) { return k[0]; })).some(function (k) { var c = (IC.cells || {})[k + '|' + m]; return c && c.ok; }); });
    };
    IC.pickMonth = function () {
        var have = IC.synced();
        if (!S.month || Math.floor(S.month / 100) !== +S.year || have.indexOf(+S.month) < 0) S.month = have.length ? have[have.length - 1] : null;
        return S.month;
    };
    IC.monthBar = function (allowAll) {
        var have = IC.synced();
        return '<label class="sm">Month <select id="ic-month">' + (allowAll ? '<option value="0"' + (+S.month === 0 ? ' selected' : '') + '>Every month of ' + S.year + '</option>' : '') +
            IC.months(S.year).map(function (m) { return '<option value="' + m + '"' + (+S.month === m ? ' selected' : '') + (have.indexOf(m) < 0 ? ' disabled' : '') + '>' + mname(m) + (have.indexOf(m) < 0 ? ' — not synced' : '') + '</option>'; }).join('') + '</select></label>';
    };
    IC.wireMonth = function () { if ($('ic-month')) $('ic-month').onchange = function () { S.month = +this.value; FL.lsSet('ic.month', S.month); IC.view(); }; };
    IC.view = function () {
        var body = $('ic-body'); if (!body) return;
        Object.keys(FL.charts).forEach(function (k) { if (/^ic-/.test(k)) { try { FL.charts[k].destroy(); } catch (e) { /* gone */ } delete FL.charts[k]; } });
        var n = Object.keys(IC.cells || {}).filter(function (k) { return IC.cells[k].ok && k.indexOf('ENT|') !== 0; }).length;
        if ($('ic-sum')) $('ic-sum').textContent = n ? n + ' month × kind read(s) on this PC' : 'nothing synced yet';
        var v = S.view;
        if (v !== 'sync' && v !== 'settings' && !IC.synced().length) {
            body.innerHTML = '<div class="card empty"><i class="fa-solid fa-cloud-arrow-down"></i><p>No intercompany data for ' + S.year + ' on this PC yet.</p><button class="btn primary" id="ic-gosync">Sync &amp; checklist</button></div>';
            $('ic-gosync').onclick = function () { S.view = 'sync'; FL.lsSet('ic.view', 'sync'); FL.render(); };
            return Promise.resolve();
        }
        return ({ sync: IC.viewSync, overview: IC.viewOverview, recon: IC.viewRecon, match: IC.viewMatch, trx: IC.viewTrx, settings: IC.viewSettings }[v] || IC.viewSync)(body);
    };

    // ═════ Sync & checklist ═════
    IC.viewSync = function (body) {
        body.innerHTML = '<div class="card"><h3><i class="fa-solid fa-list-check"></i> Inter company checklist</h3><div id="ic-md"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></div>' +
            '<div class="card"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-calendar-days"></i> ' + S.year + ' by month</h3><span class="grow"></span><span id="ic-bacts"></span></div>' +
            '<div id="ic-board" class="scroll"></div>' +
            '<details class="ts-det"' + (FL.ls('ic.det', false) ? ' open' : '') + ' id="ic-det"><summary class="sm"><i class="fa-solid fa-list-check"></i> Details — every query, its SQL, sample rows and the log</summary><div id="fu-prog"></div></details></div>';
        $('ic-det').ontoggle = function () { FL.lsSet('ic.det', this.open); };
        if (FL.fusion.run) FL.fusion.paint();
        IC.paintBoard();
        return A.status().then(function () { IC.paintBoard(); IC.md(); });
    };
    IC.paintBoard = function () {
        var box = $('ic-board'); if (!box) return;
        var ms = IC.months(S.year), ks = KINDS.map(function (k) { return k[0]; }), adm = admin(), run = !!IC.live, ap = IC.apexState || {};
        var ICON = { done: '✓', part: '◐', failed: '⚠', none: '✗', future: '–', queued: '⏳', running: '<span class="ts-spin">⟳</span>' };
        var head = '<tr><th>Month</th>' + KINDS.map(function (k) {
            var miss = ms.filter(function (m) { var s = IC.stateOf(k[0], m); return m <= thisMonth && s !== 'done'; });
            return '<th title="' + esc(k[1]) + '"><i class="fa-solid ' + k[2] + '"></i> ' + esc(k[1]) + (adm && miss.length && !run ? '<br><a class="sm" data-col="' + k[0] + '">Sync ' + miss.length + ' missing</a>' : '') + '</th>';
        }).join('') + '<th>APEX</th><th></th></tr>';
        var rows = ms.map(function (m) {
            var cells = ks.map(function (k) {
                var st = IC.stateOf(k, m), c = (IC.cells || {})[k + '|' + m];
                var line = st === 'done' ? (c.rows || 0).toLocaleString() + ' rows' : st === 'part' ? c.ok + ' of ' + c.scopes + ' ledgers' : st === 'failed' ? 'failed' : st === 'running' ? 'reading…' : st === 'queued' ? 'waiting' : st === 'future' ? '' : 'not synced';
                var tip = c ? (c.rows || 0).toLocaleString() + ' rows · total ' + money(c.total) + ' · read ' + String(c.at).replace('T', ' ').slice(0, 16) + (c.alts.length ? '\nquery: ' + c.alts.join(' · ') : '') + (c.errors.length ? '\n' + c.errors.join('\n') : '') : '';
                return '<td class="ic-c ' + st + '" data-k="' + k + '" data-m="' + m + '" title="' + esc(tip) + '"><span class="ic-ci">' + ICON[st] + '</span> <span class="sm">' + esc(line) + '</span></td>';
            }).join('');
            var reads = ks.filter(function (k) { var c = (IC.cells || {})[k + '|' + m]; return c && c.ok; }), inA = reads.filter(function (k) { var a = ap[k + '|' + m]; return a && a.same === a.reads; }).length;
            var apx = ap.error ? '<span class="muted sm" title="' + esc(ap.error) + '">?</span>' : !reads.length ? '' : inA === reads.length ? '<span class="pos" title="Every read of this month is in APEX">✓</span>' :
                '<span class="warn" title="' + (reads.length - inA) + ' read(s) not in APEX yet">◐ ' + inA + '/' + reads.length + '</span>';
            var plan = IC.missing(ks, [m]), have = reads.length;
            var acts = !adm || m > thisMonth || run ? '' : (plan.length ? '<button class="btn sm primary" data-sync="' + m + '">Sync</button> ' : '') +
                (have ? '<button class="btn sm" data-over="' + m + '" title="Read every kind of this month again">Overwrite</button> <a class="ic-del" data-del="' + m + '" title="Forget this month on this PC">🗑</a>' : '');
            return '<tr><td><b>' + MON[(m % 100) - 1] + '</b></td>' + cells + '<td class="c">' + apx + '</td><td class="nowrap">' + acts + '</td></tr>';
        }).join('');
        box.innerHTML = '<table class="t ic-board"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' +
            '<p class="sm muted">✓ synced · ◐ some ledgers · ⚠ failed (hover for the reason) · ✗ not synced · click a synced cell to see its transactions. One month is read at a time; Stop in the yellow banner ends the current month and drops the rest.</p>';
        var all = IC.missing(ks, ms), copyList = [];
        ms.forEach(function (m) { ks.forEach(function (k) { var c = (IC.cells || {})[k + '|' + m], a = ap[k + '|' + m]; if (c && c.ok && !ap.error && !(a && a.same === a.reads)) copyList.push({ kind: k, month: m }); }); });
        var ent = (IC.cells || {})['ENT|0'], entA = ap['ENT|0'];
        if (ent && ent.ok && !ap.error && !(entA && entA.same === entA.reads)) copyList.push({ kind: 'ENT', month: 0 });
        if ($('ic-bacts')) $('ic-bacts').innerHTML = !adm ? '<span class="sm muted">Syncing is for AI admins</span>' : run ? '' :
            (all.length ? '<button class="btn sm primary" id="ic-all"><i class="fa-solid fa-cloud-arrow-down"></i> Sync all missing (' + all.reduce(function (s, p) { return s + p.kinds.length; }, 0) + ')</button> ' : '') +
            '<button class="btn sm" id="ic-year" title="Read every kind of every month of ' + S.year + ' again">Overwrite ' + S.year + '</button> ' +
            (copyList.length ? '<button class="btn sm" id="ic-copy" title="Copy the reads that are not in APEX yet"><i class="fa-solid fa-database"></i> Copy ' + copyList.length + ' to APEX</button>' : '');
        if ($('ic-all')) $('ic-all').onclick = function () { IC.sync(all, !(IC.cells || {})['ENT|0'], 'missing months of ' + S.year); };
        if ($('ic-year')) $('ic-year').onclick = function () { if (confirm('Read every kind of every month of ' + S.year + ' again from Fusion?')) IC.sync(ms.filter(function (m) { return m <= thisMonth; }).map(function (m) { return { month: m, kinds: ks }; }), true, S.year + ' again'); };
        if ($('ic-copy')) $('ic-copy').onclick = function () { A.copyMany(copyList).then(function () { IC.paintBoard(); IC.md(); }); };
        box.querySelectorAll('[data-col]').forEach(function (a) { a.onclick = function () { IC.sync(IC.missing([a.dataset.col], ms), false, KN[a.dataset.col][1]); }; });
        box.querySelectorAll('[data-sync]').forEach(function (b) { b.onclick = function () { var m = +b.dataset.sync; IC.sync(IC.missing(ks, [m]), !(IC.cells || {})['ENT|0'], mname(m)); }; });
        box.querySelectorAll('[data-over]').forEach(function (b) { b.onclick = function () { var m = +b.dataset.over; IC.sync([{ month: m, kinds: ks }], false, mname(m) + ' again'); }; });
        box.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { IC.remove([+b.dataset.del]); }; });
        box.querySelectorAll('td.ic-c.done, td.ic-c.part').forEach(function (td) { td.onclick = function () { S.view = 'trx'; S.kind = td.dataset.k; S.month = +td.dataset.m; FL.lsSet('ic.view', 'trx'); FL.lsSet('ic.kind', S.kind); IC.render($('main')); }; });
    };
    /** The checklist: what an intercompany sync needs, each with its state and the button that fixes it */
    IC.md = function () {
        var box = $('ic-md'); if (!box) return Promise.resolve();
        return FL.rows("SELECT ent_type, COUNT(*) n, COUNT(*) FILTER (WHERE companies IS NOT NULL AND companies <> '') co FROM rr_ic_entities WHERE pod = " + q(S.pod || '') + ' GROUP BY 1').catch(function () { return []; }).then(function (ents) {
            var e = {}; ents.forEach(function (r) { e[r.ent_type] = r; });
            var adm = admin(), items = [], leds = IC.allLedgers(), use = IC.ledgers(), accs = IC.icAccounts(), cfg = IC.cfg(), d = IC._disc && IC._disc.d;
            var entC = (IC.cells || {})['ENT|0'];
            items.push({ ok: entC && entC.ok ? (e.LE && e.LE.co ? true : null) : false, t: 'Legal entities, business units & organisations',
                d: entC && entC.ok ? (e.LE ? e.LE.n : 0) + ' legal entities (' + (e.LE ? e.LE.co : 0) + ' with their companies), ' + (e.BU ? e.BU.n : 0) + ' business units, ' + (e.ORG ? e.ORG.n : 0) + ' organisations — read ' + String(entC.at).replace('T', ' ').slice(0, 16) +
                    (e.LE && !e.LE.co ? ' · the legal entity → company link (GL_LEGAL_ENTITIES_BSVS) was not readable: names show, companies come from the GL' : '') : 'Names both sides of every transaction and maps legal entities to companies (balancing segment values).',
                a: adm ? '<button class="btn sm' + (entC && entC.ok ? '' : ' primary') + '" data-a="ent">' + (entC && entC.ok ? 'Read again' : 'Sync') + '</button>' : '' });
            items.push({ ok: !d ? false : use.length ? true : false, t: 'Ledgers',
                d: !d ? 'Nothing discovered for ' + (S.pod || 'the logged-in pod') + ' yet — the GL lines and balances need each ledger\'s company and account segments.' : use.length + ' of ' + leds.length + ' ledger(s) used: ' + use.map(function (l) { return l.name; }).join(', '),
                a: !d ? '<button class="btn sm primary" data-a="disc">Fusion setup › Discover</button>' : '<button class="btn sm" data-a="settings">Choose</button>' });
            var noIc = use.filter(function (l) { return !l.ic; });
            items.push({ ok: !use.length ? false : noIc.length ? null : true, t: 'Intercompany segment',
                d: !use.length ? 'Needs the ledgers first.' : use.map(function (l) { return l.name + ': ' + (l.ic ? l.ic + ' (' + l.why + ')' : 'none'); }).join(' · ') + (noIc.length ? ' — without it balances cannot be reconciled pair by pair (only per company).' : ''),
                a: '<button class="btn sm" data-a="settings">Set</button>' });
            var classed = IC.classed();
            items.push({ ok: accs.length ? true : noIc.length === use.length && use.length ? false : null, t: 'Intercompany accounts',
                d: accs.length ? accs.length + ' account(s)' + (cfg.icAccounts.length ? ' (your list)' : ' (classed Intercompany)') + ': ' + accs.slice(0, 8).join(', ') + (accs.length > 8 ? ' …' : '')
                    : 'None listed — GL lines are found by the intercompany segment' + (cfg.useCategory ? ' and the journal category / source' : '') + ' only.',
                a: (adm && !cfg.icAccounts.length && classed.length ? '<button class="btn sm" data-a="classed">Use ' + classed.length + ' classed account(s)</button> ' : '') + '<button class="btn sm" data-a="settings">List them</button>' });
            items.push({ ok: true, t: 'Intercompany customers & suppliers', d: 'Customers / suppliers whose party is a legal entity of the group, customer type I, supplier type INTERCOMPANY or invoice source Intercompany' +
                (cfg.customers.length || cfg.suppliers.length ? ', plus ' + cfg.customers.length + ' customer(s) and ' + cfg.suppliers.length + ' supplier(s) you listed' : '') + '.', a: '<button class="btn sm" data-a="settings">Add</button>' });
            var ms = IC.months(S.year).filter(function (m) { return m <= thisMonth; });
            KINDS.forEach(function (k) {
                var done = ms.filter(function (m) { return IC.stateOf(k[0], m) === 'done'; }).length, fail = ms.filter(function (m) { return IC.stateOf(k[0], m) === 'failed'; });
                var c0 = fail.length ? IC.cells[k[0] + '|' + fail[0]] : null;
                items.push({ ok: done === ms.length ? true : done ? null : false, t: k[1] + ' · ' + S.year, ic: k[2],
                    d: done + ' of ' + ms.length + ' month(s) synced' + (fail.length ? ' · ' + fail.length + ' failed: ' + (c0 && c0.errors[0] ? c0.errors[0].slice(0, 180) : '') : ''),
                    a: adm && done < ms.length && !IC.live ? '<button class="btn sm" data-a="kind" data-k="' + k[0] + '">Sync ' + (ms.length - done) + ' missing</button>' : '' });
            });
            var ap = IC.apexState || {}, reads = 0, same = 0;
            Object.keys(ap).forEach(function (k) { if (k !== 'error') { reads += ap[k].reads; same += ap[k].same; } });
            items.push({ ok: ap.error ? false : reads === same ? true : null, t: 'Copy in APEX (RR_IC_ tables)', d: ap.error ? 'APEX not reachable: ' + ap.error : same + ' of ' + reads + ' read(s) are in APEX as they are on this PC' + (cfg.apex ? ' · every sync is copied automatically' : ' · automatic copy is off (Settings)'),
                a: '' });
            box.innerHTML = '<table class="t ic-md">' + items.map(function (it) {
                var ic = it.ok === true ? '<i class="fa-solid fa-circle-check pos"></i>' : it.ok === false ? '<i class="fa-solid fa-circle-xmark neg"></i>' : '<i class="fa-solid fa-circle-exclamation warn"></i>';
                return '<tr><td style="width:24px">' + ic + '</td><td><b>' + (it.ic ? '<i class="fa-solid ' + it.ic + ' muted"></i> ' : '') + esc(it.t) + '</b><div class="sm muted">' + esc(it.d) + '</div></td><td class="nowrap" style="text-align:right">' + (it.a || '') + '</td></tr>';
            }).join('') + '</table>' + (adm && !IC.live ? '<div class="row" style="margin-top:6px"><button class="btn sm primary" id="ic-mdall"><i class="fa-solid fa-wand-magic-sparkles"></i> Sync everything missing for ' + S.year + '</button></div>' : '');
            box.querySelectorAll('[data-a]').forEach(function (b) {
                b.onclick = function () {
                    var a = b.dataset.a, ms2 = IC.months(S.year);
                    if (a === 'ent') IC.sync([], true, 'legal entities');
                    else if (a === 'disc') { FL.show('data'); setTimeout(function () { if (FL.dataTab) FL.dataTab.dataSetup(); }, 50); }
                    else if (a === 'settings') { S.view = 'settings'; FL.lsSet('ic.view', 'settings'); IC.render($('main')); }
                    else if (a === 'classed') { cfg.icAccounts = IC.classed(); FL.saveConfig().then(function () { FL.toast('Intercompany accounts saved', 'ok'); IC.md(); }); }
                    else if (a === 'kind') IC.sync(IC.missing([b.dataset.k], ms2), false, KN[b.dataset.k][1]);
                };
            });
            if ($('ic-mdall')) $('ic-mdall').onclick = function () { IC.sync(IC.missing(KINDS.map(function (k) { return k[0]; }), IC.months(S.year)), !(entC && entC.ok), 'everything missing for ' + S.year); };
        });
    };

    // ═════ data for the analysis views ═════
    IC.trx = function (month, kinds, around) {
        var w = around ? ' AND month BETWEEN ' + IC.shift(month, -IC.cfg().window) + ' AND ' + IC.shift(month, IC.cfg().window) : month ? ' AND month = ' + (+month) : ' AND year = ' + (+S.year);
        return FL.rows('SELECT kind, month, src_id, doc_number, line_num, doc_type, doc_date, gl_date, status, from_co, from_name, to_co, to_name, party_number, party_name, currency, amount_entered, amount, account, item, quantity, reference, ref2, description, ledger_id, scope ' +
            'FROM rr_ic_v WHERE pod = ' + q(S.pod || '') + w + (kinds ? ' AND kind IN (' + kinds.map(q).join(', ') + ')' : '') + ' ORDER BY month, kind, gl_date, doc_number', 200000);
    };
    IC.shift = function (m, n) { var y = Math.floor(m / 100), mo = m % 100 - 1 + n; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y * 100 + mo + 1; };
    IC.bal = function (month) { return FL.rows('SELECT ledger_id, period_name, company, account, ic_company, currency, opening, dr, cr, closing, net FROM rr_ic_bal_v WHERE pod = ' + q(S.pod || '') + ' AND month = ' + (+month), 100000); };
    IC.names = function () {
        return FL.rows("SELECT id, code, name, companies FROM rr_ic_entities WHERE pod = " + q(S.pod || '') + " AND ent_type = 'LE'").catch(function () { return []; }).then(function (rows) {
            var n = {}; rows.forEach(function (r) { String(r.companies || '').split(',').forEach(function (c) { if (c) n[FIC.ck(c)] = r.name; }); }); IC.coName = n; return n;
        });
    };
    IC.co = function (c) { var n = (IC.coName || {})[FIC.ck(c)]; return esc(c == null ? '?' : c) + (n ? ' <span class="muted sm">' + esc(n) + '</span>' : ''); };
    IC.analyse = function (month) {
        return Promise.all([IC.trx(month, ['AR', 'AP', 'FUN', 'GL', 'INV'], true), IC.bal(month).catch(function () { return []; }), IC.names()]).then(function (r) {
            var t = r[0], bal = r[1], cfg = IC.cfg(), by = function (k) { return t.filter(function (x) { return x.kind === k; }); };
            var inM = function (x) { return +x.month === +month; };
            var mt = FIC.match(by('AR'), by('AP'), { month: month, tol: cfg.tol, window: cfg.window });
            var fl = FIC.funLinks(by('FUN').filter(inM), by('AR'), by('AP'));
            var rc = FIC.recon(bal, { tol: cfg.tol });
            var gl = by('GL').filter(inM), glNo = gl.filter(function (x) { return FIC.isDefault(x.to_co) || x.to_co === x.from_co; });
            var arPairs = {}; by('AR').filter(inM).forEach(function (x) { arPairs[FIC.pair(x.from_co, x.to_co)] = 1; });
            var invNo = {}; by('INV').filter(inM).forEach(function (x) { var p = FIC.pair(x.from_co, x.to_co); if (!arPairs[p]) invNo[p] = (invNo[p] || 0) + Math.abs(+x.amount || 0); });
            var missing = KINDS.filter(function (k) { return IC.stateOf(k[0], month) !== 'done'; }).map(function (k) { return k[1]; });
            var res = { month: month, t: t.filter(inM), all: t, bal: bal, match: mt, fun: fl, recon: rc, gl: gl, missing: missing,
                findings: FIC.findings({ match: mt, recon: bal.length ? rc : null, funLinks: fl, glNoParty: { n: glNo.length, amount: glNo.reduce(function (s, x) { return s + Math.abs(+x.amount || 0); }, 0) },
                    invNoAr: { n: Object.keys(invNo).length, amount: Object.keys(invNo).reduce(function (s, k) { return s + invNo[k]; }, 0) }, missing: missing }) };
            IC.last = res; return res;
        });
    };

    // ═════ Overview ═════
    IC.viewOverview = function (body) {
        var m = IC.pickMonth();
        body.innerHTML = '<div class="row card">' + IC.monthBar(false) + '<span class="grow"></span><button class="btn sm" id="ic-ask"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask the Copilot</button></div><div id="ic-ov"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>';
        IC.wireMonth();
        $('ic-ask').onclick = function () { FL.askCopilot && FL.askCopilot('Review the intercompany position for ' + mname(m) + ': which pairs of companies do not agree, why, and what to fix first.'); };
        return Promise.all([IC.analyse(m), FL.rows('SELECT month, kind, COUNT(*) n, SUM(ABS(amount)) v FROM rr_ic_v WHERE pod = ' + q(S.pod || '') + ' AND year = ' + (+S.year) + ' GROUP BY 1, 2 ORDER BY 1')]).then(function (rr) {
            var a = rr[0], trend = rr[1], box = $('ic-ov'); if (!box) return;
            var sum = function (k) { return a.t.filter(function (x) { return x.kind === k; }).reduce(function (s, x) { return s + (+x.amount || 0); }, 0); };
            var cnt = function (k) { return a.t.filter(function (x) { return x.kind === k; }).length; };
            var mt = a.match, rate = Math.round(mt.rate * 100), unm = mt.totals.SELL_ONLY + mt.totals.BUY_ONLY + mt.totals.DIFF;
            var tile = function (lbl, val, sub, cls) { return '<div class="kpi ' + (cls || '') + '"><div class="k-l">' + esc(lbl) + '</div><div class="k-v">' + val + '</div><div class="k-d muted">' + sub + '</div></div>'; };
            var bad = a.recon.pairs.filter(function (p) { return p.status !== 'OK'; }).length;
            box.innerHTML = '<div class="kpis">' +
                tile('Billed to group companies (AR)', FL.compact(sum('AR')), cnt('AR') + ' invoice(s)') +
                tile('Booked by the buyers (AP)', FL.compact(sum('AP')), cnt('AP') + ' invoice(s)') +
                tile('AR ↔ AP matched', rate + ' %', (mt.counts.MATCHED + mt.counts.TIMING) + ' of ' + mt.rows.length, rate >= 95 ? 'good' : rate >= 80 ? '' : 'bad') +
                tile('Not agreed', FL.compact(unm), (mt.counts.SELL_ONLY + mt.counts.BUY_ONLY + mt.counts.DIFF) + ' item(s)', unm ? 'bad' : 'good') +
                tile('Pairs out of balance (GL)', a.bal.length ? String(bad) : '—', a.bal.length ? FL.compact(a.recon.outOfBalance) + ' to explain' : 'GL balances not synced', a.bal.length ? (bad ? 'bad' : 'good') : '') +
                tile('Inventory shipped across', FL.compact(sum('INV')), cnt('INV') + ' transfer(s)') +
                tile('Intercompany (FUN)', FL.compact(sum('FUN')), cnt('FUN') + ' transaction(s)') + '</div>' +
                '<div class="ic-g2"><div class="card"><h3><i class="fa-solid fa-triangle-exclamation"></i> What needs attention · ' + mname(m) + '</h3>' + (a.findings.length ? '<ul class="ic-find">' + a.findings.map(function (f) {
                    return '<li class="' + f.sev + '" data-go="' + esc(f.go) + '"><b>' + f.n.toLocaleString() + '</b> ' + esc(f.text) + (f.amount ? ' · <b>' + FL.compact(f.amount) + '</b>' : '') + ' <i class="fa-solid fa-angle-right muted"></i></li>'; }).join('') + '</ul>'
                    : '<p class="pos"><i class="fa-solid fa-circle-check"></i> Everything agrees for this month.</p>') + '</div>' +
                '<div class="card"><h3><i class="fa-solid fa-circle-nodes"></i> Who trades with whom</h3><div id="ic-net"></div><p class="sm muted">Arrow width = AR billed + inventory shipped from one company to the other; red = the pair\'s GL balances do not net to nil.</p></div></div>' +
                '<div class="card"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-table-cells"></i> Flows · from (rows) → to (columns)</h3><span class="grow"></span><label class="sm">Show <select id="ic-mxk">' +
                    KINDS.filter(function (k) { return k[0] !== 'BAL'; }).map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === (S.mxk || 'AR') ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></label></div><div id="ic-mx" class="scroll"></div></div>' +
                '<div class="card"><h3><i class="fa-solid fa-chart-column"></i> ' + S.year + ' — intercompany volume by month</h3><div style="height:260px"><canvas id="ic-tr"></canvas></div></div>';
            box.querySelectorAll('[data-go]').forEach(function (li) { li.onclick = function () { IC.go(li.dataset.go); }; });
            IC.network($('ic-net'), a);
            var mx = function () { IC.matrixHtml($('ic-mx'), a.t.filter(function (x) { return x.kind === (S.mxk || 'AR'); })); };
            $('ic-mxk').onchange = function () { S.mxk = this.value; mx(); }; mx();
            var ms = IC.months(S.year), ds = KINDS.filter(function (k) { return k[0] !== 'BAL'; }).map(function (k, i) {
                return { label: k[1], backgroundColor: FL.PAL.series[i % FL.PAL.series.length], data: ms.map(function (mm) { var r = trend.filter(function (x) { return +x.month === mm && x.kind === k[0]; })[0]; return r ? +r.v : 0; }), stack: 's' };
            });
            FL.chart('ic-tr', { type: 'bar', data: { labels: ms.map(function (mm) { return MON[(mm % 100) - 1]; }), datasets: ds }, options: { scales: { x: { stacked: true }, y: Object.assign({ stacked: true }, FL.moneyAxis()) } } });
        });
    };
    IC.go = function (g) {
        var p = String(g).split(':');
        if (p[0] === 'match' || p[0] === 'fun') { S.view = 'match'; S.mf = p[1] || ''; if (p[0] === 'fun') S.mf = 'FUN'; }
        else if (p[0] === 'recon') S.view = 'recon';
        else if (p[0] === 'trx') { S.view = 'trx'; S.kind = p[1] || ''; }
        else S.view = 'sync';
        FL.lsSet('ic.view', S.view); FL.lsSet('ic.mf', S.mf); FL.lsSet('ic.kind', S.kind); IC.render($('main'));
    };
    /** The group as a circle of companies with curved arrows (width = flow, red = pair out of balance) */
    IC.network = function (el, a) {
        var flows = {}, cos = {};
        a.t.filter(function (x) { return x.kind === 'AR' || x.kind === 'INV' || x.kind === 'FUN'; }).forEach(function (x) {
            if (x.from_co == null || x.to_co == null || FIC.ck(x.from_co) === FIC.ck(x.to_co)) return;
            var f = FIC.ck(x.from_co), t = FIC.ck(x.to_co); cos[f] = x.from_co; cos[t] = x.to_co; flows[f + '>' + t] = (flows[f + '>' + t] || 0) + Math.abs(+x.amount || 0);
        });
        a.recon.pairs.forEach(function (p) { cos[FIC.ck(p.a)] = cos[FIC.ck(p.a)] || p.a; cos[FIC.ck(p.b)] = cos[FIC.ck(p.b)] || p.b; });
        var ids = Object.keys(cos).sort(); if (!ids.length) { el.innerHTML = '<p class="sm muted">No flows between companies this month.</p>'; return; }
        var bad = {}; a.recon.pairs.forEach(function (p) { if (p.status === 'DIFF' || p.status === 'ONE_SIDED') { bad[FIC.ck(p.a) + '|' + FIC.ck(p.b)] = 1; bad[FIC.ck(p.b) + '|' + FIC.ck(p.a)] = 1; } });
        var W = 420, H = 300, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 42, max = Math.max.apply(null, Object.keys(flows).map(function (k) { return flows[k]; }).concat([1]));
        var pos = {}; ids.forEach(function (id, i) { var ang = -Math.PI / 2 + 2 * Math.PI * i / ids.length; pos[id] = [cx + R * Math.cos(ang), cy + R * Math.sin(ang)]; });
        var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ic-net"><defs><marker id="ic-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#64748b"/></marker>' +
            '<marker id="ic-arb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#dc2626"/></marker></defs>';
        Object.keys(flows).forEach(function (k) {
            var p = k.split('>'), s = pos[p[0]], t = pos[p[1]]; if (!s || !t) return;
            var mx = (s[0] + t[0]) / 2 + (t[1] - s[1]) * 0.18, my = (s[1] + t[1]) / 2 - (t[0] - s[0]) * 0.18, red = bad[p[0] + '|' + p[1]];
            var w = 1.5 + 9 * flows[k] / max, dx = t[0] - mx, dy = t[1] - my, L = Math.sqrt(dx * dx + dy * dy) || 1, ex = t[0] - dx / L * 21, ey = t[1] - dy / L * 21;
            svg += '<path d="M' + s[0].toFixed(1) + ',' + s[1].toFixed(1) + ' Q' + mx.toFixed(1) + ',' + my.toFixed(1) + ' ' + ex.toFixed(1) + ',' + ey.toFixed(1) + '" stroke="' + (red ? '#dc2626' : '#94a3b8') + '" stroke-opacity=".75" stroke-width="' + w.toFixed(1) +
                '" fill="none" marker-end="url(#' + (red ? 'ic-arb' : 'ic-ar') + ')"><title>' + esc(cos[p[0]] + ' → ' + cos[p[1]] + ': ' + money(flows[k])) + '</title></path>';
        });
        ids.forEach(function (id) {
            var p = pos[id], nm = (IC.coName || {})[id] || '';
            svg += '<g class="ic-node" data-co="' + esc(cos[id]) + '"><circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="17" fill="#1d4ed8"/><text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="middle" fill="#fff" font-size="11" font-weight="700">' + esc(cos[id]) + '</text>' +
                '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 31).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#475569">' + esc(nm.slice(0, 22)) + '</text></g>';
        });
        el.innerHTML = svg + '</svg>';
    };
    IC.matrixHtml = function (el, rows) {
        var mx = FIC.matrix(rows), cos = mx.cos; if (!cos.length) { el.innerHTML = '<p class="sm muted">Nothing of this kind this month.</p>'; return; }
        var max = 0; cos.forEach(function (a) { cos.forEach(function (b) { max = Math.max(max, Math.abs((mx.v[a] || {})[b] || 0)); }); });
        el.innerHTML = '<table class="t ic-mx"><thead><tr><th>From \\ to</th>' + cos.map(function (c) { return '<th class="n" title="' + esc((IC.coName || {})[FIC.ck(c)] || '') + '">' + esc(c) + '</th>'; }).join('') + '<th class="n">Total</th></tr></thead><tbody>' +
            cos.map(function (a) {
                return '<tr><th>' + IC.co(a) + '</th>' + cos.map(function (b) {
                    var v = (mx.v[a] || {})[b]; if (a === b) return '<td class="ic-diag"></td>';
                    var al = v ? (0.08 + 0.55 * Math.abs(v) / (max || 1)).toFixed(2) : 0;
                    return '<td class="n" style="' + (v ? 'background:rgba(29,78,216,' + al + ')' : '') + '" data-a="' + esc(a) + '" data-b="' + esc(b) + '">' + (v ? FL.compact(v) : '') + '</td>';
                }).join('') + '<td class="n"><b>' + FL.compact(mx.rowTotal[a] || 0) + '</b></td></tr>';
            }).join('') + '</tbody></table>';
        el.querySelectorAll('td[data-a]').forEach(function (td) { if (!td.textContent) return; td.style.cursor = 'pointer'; td.onclick = function () { IC.pairDrill(td.dataset.a, td.dataset.b); }; });
    };
    /** Every document between two companies this month, both directions */
    IC.pairDrill = function (a, b) {
        var a0 = IC.last; if (!a0) return;
        var ka = FIC.ck(a), kb = FIC.ck(b);
        var rows = a0.t.filter(function (x) { var f = FIC.ck(x.from_co), t = FIC.ck(x.to_co); return (f === ka && t === kb) || (f === kb && t === ka); });
        var bal = a0.bal.filter(function (x) { var f = FIC.ck(x.company), t = FIC.ck(x.ic_company); return (f === ka && t === kb) || (f === kb && t === ka); });
        FL.modal('<i class="fa-solid fa-right-left"></i> ' + esc(a) + ' ⇄ ' + esc(b) + ' · ' + mname(a0.month), '<div id="ic-pd1"></div>' + (bal.length ? '<h4>GL balances</h4><div id="ic-pd2"></div>' : ''));
        FL.grid($('ic-pd1'), IC.trxCols(), rows, { id: 'ic-pd1', csv: 'intercompany-' + a + '-' + b, max: 2000 });
        if (bal.length) FL.grid($('ic-pd2'), [{ label: 'Company', key: 'company' }, { label: 'Account', key: 'account' }, { label: 'Counterparty', key: 'ic_company' }, { label: 'Currency', key: 'currency' },
            { label: 'Opening', key: 'opening', n: 1, get: function (r) { return money(r.opening); }, val: function (r) { return +r.opening; } }, { label: 'Net', key: 'net', n: 1, get: function (r) { return money(r.net); }, val: function (r) { return +r.net; } },
            { label: 'Closing', key: 'closing', n: 1, get: function (r) { return money(r.closing); }, val: function (r) { return +r.closing; } }], bal, { id: 'ic-pd2' });
    };

    // ═════ Reconciliation ═════
    IC.viewRecon = function (body) {
        var m = IC.pickMonth(), cfg = IC.cfg();
        body.innerHTML = '<div class="row card">' + IC.monthBar(false) + '<label class="sm">Tolerance <input type="number" id="ic-tol" value="' + cfg.tol + '" style="width:80px" step="0.01"></label><span class="grow"></span>' +
            '<span class="sm muted">GL balances at the end of the month, by company × counterparty (intercompany segment). A\'s balance with B + B\'s balance with A should be nil.</span></div><div id="ic-rc"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>';
        IC.wireMonth();
        $('ic-tol').onchange = function () { cfg.tol = +this.value || 0; if (admin()) FL.saveConfig(); IC.view(); };
        return IC.analyse(m).then(function (a) {
            var box = $('ic-rc'); if (!box) return;
            if (!a.bal.length) { box.innerHTML = '<div class="card callout warn">GL balances are not synced for ' + mname(m) + ' — Sync &amp; checklist › GL balances.' + (IC.ledgers().some(function (l) { return !l.ic; }) ? ' Choose the intercompany segment in Settings so balances can be paired.' : '') + '</div>'; return; }
            var rc = a.recon;
            box.innerHTML = '<div class="kpis">' + ['OK', 'DIFF', 'ONE_SIDED', 'CURRENCY'].map(function (k) { return '<div class="kpi"><div class="k-l">' + chip(k) + '</div><div class="k-v">' + rc.counts[k] + '</div></div>'; }).join('') +
                '<div class="kpi ' + (rc.outOfBalance ? 'bad' : 'good') + '"><div class="k-l">To explain</div><div class="k-v">' + FL.compact(rc.outOfBalance) + '</div></div></div>' +
                '<div class="card"><h3>Pairs of companies</h3><div id="ic-rcg"></div></div>' +
                '<div class="ic-g2"><div class="card"><h3>Balances · company (rows) with counterparty (columns)</h3><div id="ic-rcm" class="scroll"></div></div>' +
                '<div class="card"><h3>On intercompany accounts without a counterparty</h3><div id="ic-rcn"></div><p class="sm muted">Balances whose intercompany segment is the default value — they cannot be paired; book them against the right company.</p></div></div>';
            FL.grid($('ic-rcg'), [{ label: 'Status', get: function (r) { return chip(r.status); }, val: function (r) { return r.status; }, html: 1 },
                { label: 'Company A', get: function (r) { return IC.co(r.a); }, val: function (r) { return r.a; }, html: 1 }, { label: 'Company B', get: function (r) { return IC.co(r.b); }, val: function (r) { return r.b; }, html: 1 },
                { label: 'A with B', n: 1, money: 1, get: function (r) { return r.ab == null ? '—' : money(r.ab); }, val: function (r) { return r.ab; } },
                { label: 'B with A', n: 1, money: 1, get: function (r) { return r.ba == null ? '—' : money(r.ba); }, val: function (r) { return r.ba; } },
                { label: 'Difference', n: 1, money: 1, get: function (r) { return '<b class="' + (r.status === 'OK' ? '' : 'neg') + '">' + money(r.diff) + '</b>'; }, val: function (r) { return r.diff; }, html: 1 },
                { label: 'Currencies', get: function (r) { return r.currencies.join(', '); } }], rc.pairs, { id: 'ic-rcg', csv: 'intercompany-reconciliation-' + m, click: function (r) { IC.pairDrill(r.a, r.b); } });
            var bm = a.bal.filter(function (x) { return !FIC.isDefault(x.ic_company); }).map(function (x) { return { from_co: x.company, to_co: x.ic_company, amount: x.closing }; });
            IC.matrixHtml($('ic-rcm'), bm);
            var nc = Object.keys(rc.noCounterparty).map(function (k) { return { company: k, amount: rc.noCounterparty[k] }; }).filter(function (r) { return Math.abs(r.amount) > 0.005; });
            $('ic-rcn').innerHTML = nc.length ? FL.table([{ label: 'Company', get: function (r) { return IC.co(r.company); }, html: 1 }, { label: 'Closing balance', n: 1, get: function (r) { return money(r.amount); } }], nc) : '<p class="pos sm"><i class="fa-solid fa-circle-check"></i> None.</p>';
        });
    };

    // ═════ Matching ═════
    IC.trxCols = function () {
        return [{ label: 'Kind', key: 'kind' }, { label: 'Month', get: function (r) { return mname(r.month); }, val: function (r) { return r.month; } }, { label: 'GL date', key: 'gl_date' },
            { label: 'Document', key: 'doc_number' }, { label: 'Type', key: 'doc_type' }, { label: 'From', get: function (r) { return IC.co(r.from_co); }, val: function (r) { return r.from_co + ' ' + (r.from_name || ''); }, html: 1 },
            { label: 'To', get: function (r) { return IC.co(r.to_co); }, val: function (r) { return r.to_co + ' ' + (r.to_name || ''); }, html: 1 }, { label: 'Party', key: 'party_name' }, { label: 'Currency', key: 'currency' },
            { label: 'Entered', n: 1, get: function (r) { return money(r.amount_entered); }, val: function (r) { return r.amount_entered; }, sum: false },
            { label: 'Amount', n: 1, money: 1, get: function (r) { return money(r.amount); }, val: function (r) { return r.amount; } }, { label: 'Account', key: 'account' }, { label: 'Item', key: 'item' },
            { label: 'Qty', n: 1, key: 'quantity', sum: false }, { label: 'Reference', key: 'reference' }, { label: 'Ref 2', key: 'ref2' }, { label: 'Status', key: 'status' }, { label: 'Description', key: 'description' }];
    };
    IC.viewMatch = function (body) {
        var m = IC.pickMonth(), cfg = IC.cfg();
        body.innerHTML = '<div class="row card">' + IC.monthBar(false) + '<label class="sm">Tolerance <input type="number" id="ic-tol" value="' + cfg.tol + '" style="width:80px" step="0.01"></label>' +
            '<label class="sm" title="A counterpart booked this many months before / after still matches (TIMING)">Timing window <select id="ic-win">' + [0, 1, 2, 3].map(function (n) { return '<option' + (+cfg.window === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select> month(s)</label>' +
            '<span class="grow"></span><span class="sm muted">Receivables of the seller ↔ payables of the buyer: same pair, then document number / reference, else the amount.</span></div><div id="ic-mt"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>';
        IC.wireMonth();
        $('ic-tol').onchange = function () { cfg.tol = +this.value || 0; if (admin()) FL.saveConfig(); IC.view(); };
        $('ic-win').onchange = function () { cfg.window = +this.value; if (admin()) FL.saveConfig(); IC.view(); };
        return Promise.all([IC.analyse(m), A.notes(m)]).then(function (rr) {
            var a = rr[0], notes = rr[1], box = $('ic-mt'); if (!box) return;
            var mt = a.match, keys = ['', 'MATCHED', 'TIMING', 'DIFF', 'SELL_ONLY', 'BUY_ONLY', 'FUN'];
            var noteOf = function (r) { var d = r.sell || r.buy; return notes[(r.sell ? 'AR' : 'AP') + '|' + d.src_id]; };
            box.innerHTML = '<div class="seg ic-mf">' + keys.map(function (k) {
                var n = k === '' ? mt.rows.length : k === 'FUN' ? a.fun.length : mt.counts[k];
                return '<button data-f="' + k + '" class="' + (S.mf === k ? 'on' : '') + '">' + (k === '' ? 'All' : k === 'FUN' ? 'Intercompany (FUN) → AR / AP' : (STATUS[k] || ['', k])[1]) + ' <span class="tag">' + n + '</span></button>'; }).join('') + '</div><div class="card" id="ic-mtg"></div>';
            box.querySelectorAll('.ic-mf button').forEach(function (b) { b.onclick = function () { S.mf = b.dataset.f; FL.lsSet('ic.mf', S.mf); IC.view(); }; });
            if (S.mf === 'FUN') {
                FL.grid($('ic-mtg'), [{ label: 'Status', get: function (r) { return chip(r.status); }, val: function (r) { return r.status; }, html: 1 },
                    { label: 'Transaction', get: function (r) { return r.fun.doc_number; } }, { label: 'From', get: function (r) { return IC.co(r.fun.from_co); }, val: function (r) { return r.fun.from_co; }, html: 1 },
                    { label: 'To', get: function (r) { return IC.co(r.fun.to_co); }, val: function (r) { return r.fun.to_co; }, html: 1 }, { label: 'Amount', n: 1, money: 1, get: function (r) { return money(r.fun.amount); }, val: function (r) { return r.fun.amount; } },
                    { label: 'AR invoice', get: function (r) { return (r.fun.reference || '') + (r.ar ? ' ✓' : r.fun.reference ? ' ✗' : ''); } }, { label: 'AP invoice', get: function (r) { return (r.fun.ref2 || '') + (r.ap ? ' ✓' : r.fun.ref2 ? ' ✗' : ''); } },
                    { label: 'FUN status', get: function (r) { return r.fun.status; } }], a.fun, { id: 'ic-fun', csv: 'intercompany-fun-' + m });
                return;
            }
            var rows = mt.rows.filter(function (r) { return !S.mf || r.status === S.mf; });
            FL.grid($('ic-mtg'), [{ label: 'Status', get: function (r) { return chip(r.status) + (r.how ? ' <span class="muted sm">by ' + r.how + '</span>' : ''); }, val: function (r) { return r.status; }, html: 1 },
                { label: 'Seller → buyer', get: function (r) { var d = r.sell || r.buy; return IC.co(d.from_co) + ' → ' + IC.co(d.to_co); }, val: function (r) { var d = r.sell || r.buy; return d.from_co + '>' + d.to_co; }, html: 1 },
                { label: 'AR document', get: function (r) { return r.sell ? r.sell.doc_number : ''; } }, { label: 'AR date', get: function (r) { return r.sell ? r.sell.gl_date : ''; } },
                { label: 'AR amount', n: 1, money: 1, get: function (r) { return r.sell ? money(r.sell.amount_entered != null ? r.sell.amount_entered : r.sell.amount) : ''; }, val: function (r) { return r.sell ? +(r.sell.amount_entered != null ? r.sell.amount_entered : r.sell.amount) : null; } },
                { label: 'AP document', get: function (r) { return r.buy ? r.buy.doc_number : ''; } }, { label: 'AP date', get: function (r) { return r.buy ? r.buy.gl_date : ''; } },
                { label: 'AP amount', n: 1, money: 1, get: function (r) { return r.buy ? money(r.buy.amount_entered != null ? r.buy.amount_entered : r.buy.amount) : ''; }, val: function (r) { return r.buy ? +(r.buy.amount_entered != null ? r.buy.amount_entered : r.buy.amount) : null; } },
                { label: 'Difference', n: 1, money: 1, get: function (r) { return r.status === 'MATCHED' || r.status === 'TIMING' ? '' : '<b class="neg">' + money(r.diff) + '</b>'; }, val: function (r) { return r.status === 'MATCHED' || r.status === 'TIMING' ? 0 : r.diff; }, html: 1 },
                { label: 'Currency', get: function (r) { return (r.sell || r.buy).currency; } },
                { label: 'Note', get: function (r) { var n = noteOf(r); return n ? '<span class="ic-note ' + (n.STATUS === 'EXPLAINED' ? 'pos' : 'warn') + '" title="' + esc((n.NOTED_BY || '') + ' · ' + (n.NA || '')) + '">' + esc(n.STATUS) + ' · ' + esc(String(n.NOTE || '').slice(0, 60)) + '</span>' : ''; }, val: function (r) { var n = noteOf(r); return n ? n.STATUS + ' ' + n.NOTE : ''; }, html: 1 }],
                rows, { id: 'ic-mt', csv: 'intercompany-matching-' + m, click: function (r) { IC.matchDialog(r, noteOf(r), m); } });
        });
    };
    IC.matchDialog = function (r, note, month) {
        var side = function (d, t) { return !d ? '<div class="card muted">No ' + t + ' found' + (r.status === 'SELL_ONLY' ? ' — the buyer has not booked it (or booked it with another number / amount)' : r.status === 'BUY_ONLY' ? ' — the seller has no receivable for it' : '') + '</div>' :
            '<div class="card"><h4>' + t + ' · ' + esc(d.doc_number) + '</h4><table class="t">' + [['Seller → buyer', d.from_co + ' → ' + d.to_co], ['GL date', d.gl_date], ['Party', d.party_name], ['Currency', d.currency], ['Entered', money(d.amount_entered)], ['Ledger amount', money(d.amount)], ['Reference', d.reference], ['Status', d.status], ['Description', d.description]]
                .map(function (x) { return '<tr><th>' + x[0] + '</th><td>' + esc(x[1] == null ? '' : x[1]) + '</td></tr>'; }).join('') + '</table></div>'; };
        var d = r.sell || r.buy, kind = r.sell ? 'AR' : 'AP';
        FL.modal('<i class="fa-solid fa-link"></i> ' + (STATUS[r.status] || ['', r.status])[1] + (r.diff && r.status !== 'MATCHED' ? ' · ' + money(r.diff) : ''), '<div class="ic-g2">' + side(r.sell, 'Receivable (AR)') + side(r.buy, 'Payable (AP)') + '</div>' +
            '<div class="card"><h4>Note (kept in APEX, every PC sees it)</h4><div class="row"><select id="ic-ns">' + ['OPEN', 'EXPLAINED', 'TO FIX'].map(function (s) { return '<option' + (note && note.STATUS === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
            '<input id="ic-nt" style="flex:1" placeholder="e.g. booked by the buyer in April, invoice 123" value="' + esc(note ? note.NOTE || '' : '') + '"><button class="btn primary" id="ic-nsave">Save note</button></div>' +
            (note ? '<p class="sm muted">' + esc((note.NOTED_BY || '') + ' · ' + (note.NA || '')) + '</p>' : '') + '</div>');
        $('ic-nsave').onclick = function () { A.saveNote(kind, d.src_id, month, $('ic-ns').value, $('ic-nt').value).then(function () { FL.toast('Note saved', 'ok'); FL.closeModal(); IC.view(); }).catch(function (e) { FL.toast(String(e), 'err'); }); };
    };

    // ═════ Transactions ═════
    IC.viewTrx = function (body) {
        if (S.month == null) IC.pickMonth();
        body.innerHTML = '<div class="row card">' + IC.monthBar(true) + '<div class="seg" id="ic-tk"><button data-k="" class="' + (!S.kind ? 'on' : '') + '">All</button>' + KINDS.filter(function (k) { return k[0] !== 'BAL'; }).map(function (k) {
            return '<button data-k="' + k[0] + '" class="' + (S.kind === k[0] ? 'on' : '') + '"><i class="fa-solid ' + k[2] + '"></i> ' + k[1] + '</button>'; }).join('') + '<button data-k="BAL" class="' + (S.kind === 'BAL' ? 'on' : '') + '"><i class="fa-solid fa-scale-balanced"></i> GL balances</button></div></div>' +
            '<div class="card" id="ic-tg"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>';
        IC.wireMonth();
        body.querySelectorAll('#ic-tk button').forEach(function (b) { b.onclick = function () { S.kind = b.dataset.k; FL.lsSet('ic.kind', S.kind); IC.view(); }; });
        if (S.kind === 'BAL') {
            return FL.rows('SELECT month, ledger_id, period_name, company, account, ic_company, currency, opening, dr, cr, closing FROM rr_ic_bal_v WHERE pod = ' + q(S.pod || '') + (+S.month ? ' AND month = ' + (+S.month) : ' AND month / 100 = ' + (+S.year)) + ' ORDER BY month, company, account', 200000).then(function (rows) {
                FL.grid($('ic-tg'), [{ label: 'Month', get: function (r) { return mname(r.month); }, val: function (r) { return r.month; } }, { label: 'Ledger', key: 'ledger_id' }, { label: 'Period', key: 'period_name' }, { label: 'Company', key: 'company' },
                    { label: 'Account', key: 'account' }, { label: 'Counterparty', key: 'ic_company' }, { label: 'Currency', key: 'currency' },
                    { label: 'Opening', n: 1, money: 1, get: function (r) { return money(r.opening); }, val: function (r) { return r.opening; } }, { label: 'Debits', n: 1, money: 1, get: function (r) { return money(r.dr); }, val: function (r) { return r.dr; } },
                    { label: 'Credits', n: 1, money: 1, get: function (r) { return money(r.cr); }, val: function (r) { return r.cr; } }, { label: 'Closing', n: 1, money: 1, get: function (r) { return money(r.closing); }, val: function (r) { return r.closing; } }],
                    rows, { id: 'ic-bal', csv: 'intercompany-balances' });
            });
        }
        return Promise.all([IC.trx(+S.month || null, S.kind ? [S.kind] : null), IC.names()]).then(function (rr) {
            FL.grid($('ic-tg'), IC.trxCols(), rr[0], { id: 'ic-trx', csv: 'intercompany-' + (S.kind || 'all') + '-' + (S.month || S.year), max: 1000 });
        });
    };

    // ═════ Settings ═════
    IC.viewSettings = function (body) {
        var cfg = IC.cfg(), adm = admin(), all = IC.allLedgers(), use = IC.ledgers().map(function (l) { return l.id; }), dis = adm ? '' : ' disabled';
        var list = function (a) { return (a || []).join('\n'); };
        body.innerHTML = (adm ? '' : '<div class="callout">Only an AI admin can change these settings.</div>') +
            '<div class="card"><h3><i class="fa-solid fa-book"></i> Ledgers and the intercompany segment</h3>' + (all.length ? '<table class="t"><thead><tr><th>Use</th><th>Ledger</th><th>Company</th><th>Account</th><th>Intercompany segment</th></tr></thead><tbody>' + all.map(function (l) {
                return '<tr><td><input type="checkbox" class="ic-led" value="' + esc(l.id) + '"' + (use.indexOf(l.id) >= 0 ? ' checked' : '') + dis + '></td><td>' + esc(l.name) + ' <span class="muted sm">' + esc(l.currency || '') + '</span></td><td>' + esc(l.company || '?') + '</td><td>' + esc(l.account || '?') + '</td>' +
                    '<td><select class="ic-seg" data-coa="' + esc(l.coaId) + '"' + dis + '><option value="">(none)</option>' + l.segments.map(function (s) { return '<option value="' + esc(s.col) + '"' + (l.ic === s.col ? ' selected' : '') + '>' + esc(s.col + ' · ' + (s.name || '')) + '</option>'; }).join('') + '</select> <span class="sm muted">' + esc(l.why || '') + '</span></td></tr>';
            }).join('') + '</tbody></table>' : '<p class="sm">No ledgers discovered for this pod — <a onclick="FL.show(\'data\'); setTimeout(function(){FL.dataTab.dataSetup();},50)">Fusion setup › Discover</a>.</p>') + '</div>' +
            '<div class="ic-g2"><div class="card"><h3><i class="fa-solid fa-hashtag"></i> Intercompany accounts</h3><p class="sm muted">Natural accounts that hold intercompany receivables / payables / income / costs (one per line, or comma separated). Empty = the accounts classed Intercompany (' + IC.classed().length + ').</p>' +
                '<textarea id="ic-accs" rows="6" style="width:100%"' + dis + '>' + esc(list(cfg.icAccounts)) + '</textarea>' + (adm && IC.classed().length ? '<button class="btn sm" id="ic-useclassed">Use the ' + IC.classed().length + ' classed account(s)</button>' : '') + '</div>' +
            '<div class="card"><h3><i class="fa-solid fa-users"></i> Customers &amp; suppliers</h3><p class="sm muted">Found automatically when their party is a legal entity of the group (customer type I, supplier type INTERCOMPANY, invoice source Intercompany). Add customer account numbers / supplier numbers that are not.</p>' +
                '<div class="ic-g2"><label class="sm">Customers<textarea id="ic-cus" rows="5" style="width:100%"' + dis + '>' + esc(list(cfg.customers)) + '</textarea></label><label class="sm">Suppliers<textarea id="ic-sup" rows="5" style="width:100%"' + dis + '>' + esc(list(cfg.suppliers)) + '</textarea></label></div></div></div>' +
            '<div class="card"><h3><i class="fa-solid fa-gear"></i> Options</h3><div class="row">' +
                '<label class="sm"><input type="checkbox" id="ic-cross"' + (cfg.crossLe ? ' checked' : '') + dis + '> inventory: only transfers between different legal entities</label>' +
                '<label class="sm"><input type="checkbox" id="ic-cat"' + (cfg.useCategory ? ' checked' : '') + dis + '> GL: also journals whose category / source says Intercompany</label>' +
                '<label class="sm"><input type="checkbox" id="ic-apex"' + (cfg.apex ? ' checked' : '') + dis + '> copy every sync to APEX (RR_IC_ tables)</label>' +
                '<label class="sm">Rows per page <input type="number" id="ic-ps" min="200" max="50000" value="' + cfg.pageSize + '" style="width:90px"' + dis + '></label></div></div>' +
            '<div class="card"><h3><i class="fa-solid fa-code"></i> Queries</h3><p class="sm muted">Each kind tries its queries in order (a pod without a table or column falls back to a simpler one). You can replace them with your own — it must return the same column names (SRC_ID, DOC_NUMBER, GL_DATE, FROM_LE / FROM_BU / FROM_ORG / FROM_COMPANY, TO_…, CURRENCY, AMOUNT_ENTERED, AMOUNT …; balances: COMPANY, ACCOUNT, IC_COMPANY, OPENING, DR, CR). ' +
                'Placeholders: {FROM} {TO} (the month as DATE literals), {MONTH}, {LEDGER_ID}, {COMPANY_SEG}, {ACCOUNT_SEG}, {IC_SEG}, {GL_IC_FILTER}.</p>' +
                '<div class="row"><select id="ic-qk">' + [['ENT', 'Legal entities']].concat(KINDS).map(function (k) { return '<option value="' + k[0] + '">' + esc(k[1]) + (cfg.queries[k[0]] ? ' · your own' : '') + '</option>'; }).join('') + '</select>' +
                '<button class="btn sm" id="ic-qshow">Show the queries it runs</button></div><div id="ic-qbox"></div></div>' +
            (adm ? '<div class="row"><button class="btn primary" id="ic-save"><i class="fa-solid fa-floppy-disk"></i> Save settings</button></div>' : '');
        var split = function (id) { return $(id).value.split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(Boolean); };
        if ($('ic-useclassed')) $('ic-useclassed').onclick = function () { $('ic-accs').value = IC.classed().join('\n'); };
        var showQ = function () {
            var k = $('ic-qk').value, own = cfg.queries[k] || '';
            FL.call('finIcSql', { kind: k, month: IC.pickMonth() || thisMonth, options: IC.options([], [k]) }).then(function (r) {
                $('ic-qbox').innerHTML = (r.alternatives || []).map(function (x, i) { return '<details' + (i === 0 ? ' open' : '') + '><summary class="sm"><b>' + (i + 1) + '.</b> ' + esc(x.label) + '</summary><pre class="ic-sql">' + esc(x.sql) + '</pre><button class="btn sm" data-run="' + i + '">▶ Test in Fusion</button> <button class="btn sm" data-copy="' + i + '">Copy</button><div data-res="' + i + '"></div></details>'; }).join('') +
                    (adm && k !== 'ENT' ? '<h4>Your own query for ' + esc((KN[k] || [k, k])[1]) + '</h4><textarea id="ic-qown" rows="8" style="width:100%;font-family:monospace">' + esc(own) + '</textarea><div class="row"><button class="btn sm" id="ic-qsave">Use this query</button><button class="btn sm" id="ic-qreset">Default queries</button></div>' : '');
                $('ic-qbox').querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { try { navigator.clipboard.writeText(r.alternatives[+b.dataset.copy].sql); FL.toast('Copied', 'ok'); } catch (e) { /* no clipboard */ } }; });
                $('ic-qbox').querySelectorAll('[data-run]').forEach(function (b) {
                    b.onclick = function () {
                        var out = $('ic-qbox').querySelector('[data-res="' + b.dataset.run + '"]'); out.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> asking Fusion…';
                        FL.call('finFusionRun', { pod: S.pod || '', sql: r.alternatives[+b.dataset.run].sql }, 300000).then(function (x) {
                            out.innerHTML = x.ok ? '<p class="sm pos">' + x.rows + ' row(s) in ' + x.ms + ' ms</p>' + FL.table(x.columns.map(function (c, i) { return { label: c, get: function (row) { return row[i]; } }; }), x.sample.slice(0, 20)) : '<div class="callout bad sm">' + esc(x.error) + '</div>';
                        }).catch(function (e) { out.innerHTML = '<div class="callout bad sm">' + esc(e) + '</div>'; });
                    };
                });
                if ($('ic-qsave')) $('ic-qsave').onclick = function () { var v = $('ic-qown').value.trim(); if (v && !/^(select|with)\b/i.test(v)) { FL.toast('One SELECT / WITH query', 'err'); return; } if (v) cfg.queries[k] = v; else delete cfg.queries[k]; FL.saveConfig().then(function () { FL.toast('Saved', 'ok'); showQ(); }); };
                if ($('ic-qreset')) $('ic-qreset').onclick = function () { delete cfg.queries[k]; FL.saveConfig().then(function () { FL.toast('Back to the default queries', 'ok'); showQ(); }); };
            }).catch(function (e) { $('ic-qbox').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
        };
        $('ic-qshow').onclick = showQ;
        if ($('ic-save')) $('ic-save').onclick = function () {
            cfg.ledgers = Array.prototype.map.call(document.querySelectorAll('.ic-led:checked'), function (c) { return c.value; });
            document.querySelectorAll('.ic-seg').forEach(function (s) { cfg.icSeg[s.dataset.coa] = s.value; });
            cfg.icAccounts = split('ic-accs'); cfg.customers = split('ic-cus'); cfg.suppliers = split('ic-sup');
            cfg.crossLe = $('ic-cross').checked; cfg.useCategory = $('ic-cat').checked; cfg.apex = $('ic-apex').checked; cfg.pageSize = Math.max(200, Math.min(50000, +$('ic-ps').value || 5000));
            FL.saveConfig().then(function () { FL.toast('Inter company settings saved', 'ok'); }).catch(function (e) { FL.toast(String(e), 'err'); });
        };
        return Promise.resolve();
    };

    /** For the Copilot: the month on screen in numbers */
    IC.context = function () {
        var a = IC.last; if (!a) return null;
        return { month: mname(a.month), pod: S.pod || 'logged-in', matching: a.match.counts, matchingTotals: a.match.totals, findings: a.findings.map(function (f) { return f.n + ' ' + f.text + (f.amount ? ' (' + f.amount + ')' : ''); }),
            pairsOutOfBalance: a.recon.pairs.filter(function (p) { return p.status !== 'OK'; }).slice(0, 25), unmatched: a.match.rows.filter(function (r) { return r.status !== 'MATCHED'; }).slice(0, 40).map(function (r) {
                var d = r.sell || r.buy; return { status: r.status, from: d.from_co, to: d.to_co, doc: d.doc_number, amount: r.amount, diff: r.diff }; }),
            tables: 'DuckDB: rr_ic_v (kind FUN/AR/AP/INV/GL, month yyyymm, from_co, to_co, amount, doc_number, reference …), rr_ic_bal_v (month, company, account, ic_company, closing), rr_ic_entities, rr_ic_sync' };
    };
})();
