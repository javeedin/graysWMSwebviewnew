/* Finance Lens — Oracle Fusion: discover the ledgers and the chart of accounts (balancing / account / cost centre segment,
   account types) and sync the journal balances into DuckDB (host: classes/FinanceFusion.cs, finFusionDiscover /
   finFusionSync with finProgress, finCancel); the account mapping (class per account → statement lines, unmapped and
   double-counted accounts, quick re-assign); and the drill from a statement line to the accounts mapped to it. */
(function () {
    var F = FL.fusion = { busy: false };
    var ROLE = { company: 'Company (balancing)', costCentre: 'Cost centre', account: 'Natural account', intercompany: 'Intercompany' };
    var TYPE = { A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' };

    F.saved = function () { return (FL.config && FL.config.fusion) || null; };

    // ═════ the Fusion card in the Data tab ═════
    F.render = function (el) {
        F.el = el;
        var admin = FL.who && FL.who.admin, sv = F.saved(), m = (FL.status || {}).meta || {};
        var h = '<h3><i class="fa-solid fa-cloud-arrow-down"></i> Oracle Fusion general ledger</h3>';
        if (m.source === 'FUSION') h += '<div class="callout good sm"><i class="fa-solid fa-circle-check"></i> Loaded from Fusion ' + esc(m.pod || '') + ' · ' + esc(m.description || '') + ' · ' + esc(m.load_mode || '') + ' at ' + esc(m.loaded_at || '') + '</div>';
        if (!admin) { el.innerHTML = h + '<p class="sm">An AI admin connects Finance Lens to Fusion: it finds the ledgers, the balancing, account and cost centre segments and the account types, then loads the balances and journals into this PC\'s DuckDB file.</p>'; return; }
        if (sv && sv.ledgers && sv.ledgers.length && !F.editing) {
            h += '<table class="t"><tbody>' + [['Pod', sv.pod || 'logged-in pod'], ['Ledgers', sv.ledgers.map(function (l) { return l.name + ' (' + l.currency + ')'; }).join(', ')],
                ['Segments', sv.ledgers.map(function (l) { return 'company ' + l.company + ' · cost centre ' + (l.costCentre || '—') + ' · account ' + l.account; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / ')],
                ['Periods', F.pname(sv.fromSeq) + ' – ' + F.pname(sv.toSeq)], ['Budget', sv.budgetSource ? sv.budgetName || sv.budgetId : 'none'], ['Journal lines', sv.journalMonths ? 'last ' + sv.journalMonths + ' month(s)' : 'not loaded']]
                .map(function (r) { return '<tr><td class="muted">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
                '<div class="row" style="margin-top:10px"><button class="btn primary" id="fu-again"><i class="fa-solid fa-rotate"></i> Sync again</button>' +
                '<label class="sm"><input type="checkbox" id="fu-incr" checked> only the last <input type="number" id="fu-last" value="' + (sv.incrementalMonths || 3) + '" min="1" max="36" style="width:46px"> period(s)</label>' +
                '<span class="grow"></span><button class="btn" id="fu-setup"><i class="fa-solid fa-sliders"></i> Change setup</button></div><div id="fu-prog"></div>';
            el.innerHTML = h;
            $('fu-setup').onclick = function () { F.editing = true; F.render(el); };
            $('fu-again').onclick = function () {
                var o = JSON.parse(JSON.stringify(sv)), incr = $('fu-incr').checked, n = Math.max(1, +$('fu-last').value || 3);
                sv.incrementalMonths = n;
                o.toSeq = F.latestSeq(sv) || o.toSeq;
                if (incr) { var cal = (sv.calendar || []).filter(function (p) { return p.seq <= o.toSeq; }); o.fromSeq = cal.length ? cal[Math.max(0, cal.length - n)].seq : o.fromSeq; o.incremental = true; o.journalMonths = Math.min(o.journalMonths || 0, n); }
                F.sync(o);
            };
            return;
        }
        h += '<p class="sm">Finance Lens reads Fusion through the read-only Fusion SQL runner: the ledgers (<code>GL_LEDGERS</code>), the chart of accounts segments and their qualifiers, the account type of every account (<code>GL_CODE_COMBINATIONS</code>), the calendar and the budgets — then loads <code>GL_BALANCES</code> summed to company × cost centre × account and the posted journal lines.</p>' +
            '<div class="row"><label class="sm">Pod <select id="fu-pod"><option value="">Logged-in pod</option><option value="PROD"' + ((sv || {}).pod === 'PROD' ? ' selected' : '') + '>PROD</option><option value="TEST"' + ((sv || {}).pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
            '<button class="btn primary" id="fu-disc"><i class="fa-solid fa-magnifying-glass-chart"></i> Discover ledgers &amp; chart of accounts</button>' +
            (sv ? '<button class="btn ghost" id="fu-back">Back</button>' : '') + '</div><div id="fu-prog"></div><div id="fu-res"></div>';
        el.innerHTML = h;
        if ($('fu-back')) $('fu-back').onclick = function () { F.editing = false; F.render(el); };
        $('fu-disc').onclick = function () { F.discover($('fu-pod').value); };
        if (F.disc) F.showDiscovery();
    };

    F.pname = function (seq) {
        var sv = F.saved(), c = (sv && sv.calendar) || (F.cal || []);
        var p = c.filter(function (x) { return x.seq === +seq; })[0];
        return p ? p.name : FL.periodName(seq);
    };
    /** The newest period that has started (today), for "sync again" */
    F.latestSeq = function (sv) {
        var today = new Date().toISOString().slice(0, 10), c = (sv.calendar || []).filter(function (p) { return !p.start || p.start <= today; });
        return c.length ? c[c.length - 1].seq : null;
    };

    F.progress = function (title, cancel) {
        var box = $('fu-prog'); if (!box) return function () { };
        box.innerHTML = '<div class="fu-prog"><div class="row"><b><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(title) + '</b><span class="grow"></span>' +
            (cancel ? '<button class="btn sm" id="fu-cancel"><i class="fa-solid fa-stop"></i> Cancel</button>' : '') + '</div><div class="fu-bar"><i id="fu-barv" style="width:0"></i></div><div class="fu-log" id="fu-log"></div></div>';
        if ($('fu-cancel')) $('fu-cancel').onclick = function () { FL.call('finCancel'); this.disabled = true; };
        return function (msg) {
            var log = $('fu-log'); if (!log) return;
            var m = /^\[(\d+)\/(\d+)\]/.exec(msg || '');
            if (m && $('fu-barv')) $('fu-barv').style.width = Math.round(+m[1] / +m[2] * 100) + '%';
            log.insertAdjacentHTML('beforeend', '<div class="' + (/^⚠/.test(msg) ? 'neg' : '') + '">' + esc(msg) + '</div>');
            while (log.childNodes.length > 200) log.removeChild(log.firstChild);
            log.scrollTop = log.scrollHeight;
        };
    };

    F.discover = function (pod) {
        if (F.busy) return;
        F.busy = true;
        var p = F.progress('Discovering ' + (pod || 'the logged-in pod') + '…', true);
        FL.call('finFusionDiscover', { pod: pod }, 30 * 60000, p).then(function (r) {
            F.busy = false;
            F.disc = r.discovery; F.disc.pod = pod;
            if ($('fu-prog')) $('fu-prog').innerHTML = '';
            F.showDiscovery();
        }).catch(function (e) { F.busy = false; if ($('fu-prog')) $('fu-prog').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
    };

    F.showDiscovery = function () {
        var d = F.disc, box = $('fu-res'); if (!box || !d) return;
        var sv = F.saved() || {}, chosen = {};
        (sv.ledgers || []).forEach(function (l) { chosen[l.id] = 1; });
        var leds = (d.ledgers || []).filter(function (l) { return l.coaId; });
        if (!Object.keys(chosen).length) leds.forEach(function (l) { if ((l.category || 'PRIMARY') === 'PRIMARY') chosen[l.id] = 1; });
        var warns = (d.log || []).filter(function (x) { return /^⚠/.test(x); });
        var h = '<h4 style="margin:14px 0 6px">1 · Ledgers <small class="muted">a dashboard by company needs the ledger of each company — tick the primary ledgers (secondary and reporting ledgers repeat the same companies)</small></h4>' +
            '<div class="scroll"><table class="t"><thead><tr><th></th><th>Ledger</th><th>Currency</th><th>Category</th><th>Chart</th><th>Calendar</th><th>Companies (balancing values)</th><th>Open periods</th></tr></thead><tbody>' +
            leds.map(function (l) {
                var open = Object.keys(l.periodStatus || {}).filter(function (k) { return l.periodStatus[k] === 'O'; });
                return '<tr><td><input type="checkbox" class="fu-led" value="' + esc(l.id) + '"' + (chosen[l.id] ? ' checked' : '') + '></td><td><b>' + esc(l.name) + '</b> <span class="muted sm">' + esc(l.shortName || '') + '</span></td><td>' + esc(l.currency) + '</td><td>' + esc(l.category || '') + '</td><td>' + esc(l.coaId) + '</td><td class="sm">' + esc(l.periodSet + ' · ' + l.periodType) + '</td>' +
                    '<td class="sm">' + (l.companies || []).slice(0, 8).map(function (c) { return '<span class="tag">' + esc(c.value) + (c.legalEntity ? ' ' + esc(c.legalEntity) : '') + '</span>'; }).join(' ') + ((l.companies || []).length > 8 ? ' +' + (l.companies.length - 8) : '') + '</td><td class="sm">' + esc(open.slice(-3).join(', ')) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        h += '<h4 style="margin:14px 0 6px">2 · Chart of accounts segments <small class="muted">found from the qualifiers and measured in GL_CODE_COMBINATIONS — change a role if Fusion is set up differently</small></h4>';
        Object.keys(d.coas || {}).forEach(function (id) {
            var c = d.coas[id], sel = (sv.coa && sv.coa[id]) || { company: c.company, costCentre: c.costCentre, account: c.account };
            h += '<div class="card" style="margin:6px 0;padding:10px"><div class="row"><b>Chart ' + esc(id) + '</b><span class="sm muted">' + (c.combinations || 0).toLocaleString() + ' account combinations</span><span class="grow"></span>' +
                Object.keys(c.accountTypes || {}).map(function (t) { return '<span class="tag">' + esc(TYPE[t] || t) + ' ' + c.accountTypes[t].toLocaleString() + '</span>'; }).join(' ') + '</div>' +
                '<table class="t"><thead><tr><th>Column</th><th>Segment</th><th>Qualifiers</th><th class="n">Values</th><th title="Share of the values that carry one account type — the natural account segment is close to 100 %">One type per value</th><th>Role</th></tr></thead><tbody>' +
                c.segments.map(function (s) {
                    var role = Object.keys(ROLE).filter(function (k) { return sel[k] === s.col || (k === 'intercompany' && c.intercompany === s.col && !sel.intercompany); })[0] || '';
                    var pur = Math.round((s.purity || 0) * 100);
                    return '<tr><td class="mono">' + esc(s.col) + '</td><td>' + esc(s.name) + '</td><td>' + (s.qualifiers || []).map(function (q) { return '<span class="tag">' + esc(q) + '</span>'; }).join(' ') + '</td><td class="n">' + (s.distinct || 0).toLocaleString() + '</td>' +
                        '<td><div class="fu-pur"><i style="width:' + pur + '%;background:' + (pur >= 95 ? 'var(--good)' : pur >= 70 ? 'var(--warn)' : 'var(--line2)') + '"></i></div><span class="sm muted">' + pur + ' %</span></td>' +
                        '<td><select class="fu-role" data-coa="' + esc(id) + '" data-col="' + esc(s.col) + '"><option value="">—</option>' + ['company', 'costCentre', 'account'].map(function (k) { return '<option value="' + k + '"' + (role === k ? ' selected' : '') + '>' + ROLE[k] + '</option>'; }).join('') + '</select>' +
                        (role === 'intercompany' ? ' <span class="tag">intercompany</span>' : '') + '</td></tr>';
                }).join('') + '</tbody></table><div class="sm muted" style="margin-top:4px">' + Object.keys(c.why || {}).map(function (k) { return '<b>' + esc(ROLE[k] || k) + ':</b> ' + esc(c.why[k]); }).join(' · ') + '</div></div>';
        });
        // periods from the first ledger's calendar
        var first = leds.filter(function (l) { return chosen[l.id]; })[0] || leds[0];
        var cal = first ? ((d.calendars || {})[first.periodSet + '|' + first.periodType] || []).filter(function (p) { return !p.adj; }) : [];
        F.cal = cal.map(function (p) { return { name: p.name, seq: p.year * 100 + p.num, start: p.start }; });
        var today = new Date().toISOString().slice(0, 10), started = F.cal.filter(function (p) { return !p.start || p.start <= today; });
        var to = sv.toSeq || (started.length ? started[started.length - 1].seq : (F.cal[F.cal.length - 1] || {}).seq);
        var toIx = Math.max(0, F.cal.map(function (p) { return p.seq; }).indexOf(to)), from = sv.fromSeq || (F.cal[Math.max(0, toIx - 23)] || {}).seq;
        var opt = function (v) { return F.cal.map(function (p) { return '<option value="' + p.seq + '"' + (p.seq === v ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join(''); };
        h += '<h4 style="margin:14px 0 6px">3 · What to load</h4><div class="row">' +
            '<label class="sm">From <select id="fu-from">' + opt(from) + '</select></label><label class="sm">To <select id="fu-to">' + opt(to) + '</select></label>' +
            '<label class="sm">Budget <select id="fu-bud"><option value="">none</option>' + (d.budgets || []).map(function (b, i) { return '<option value="' + i + '"' + (sv.budgetId === b.id && sv.budgetSource === b.source ? ' selected' : '') + '>' + esc(b.name + ' (' + b.source + ', ' + (b.rows || 0).toLocaleString() + ' rows)') + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm">Journal lines for drill-down <select id="fu-jm">' + [0, 1, 3, 6, 12, 24].map(function (n) { return '<option value="' + n + '"' + ((sv.journalMonths != null ? sv.journalMonths : 3) === n ? ' selected' : '') + '>' + (n ? 'last ' + n + ' month(s)' : 'none') + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm"><input type="checkbox" id="fu-fold" checked> fold adjustment periods into the period they close</label></div>' +
            (warns.length ? '<details class="sm" style="margin-top:8px"><summary>' + warns.length + ' Fusion object(s) not available on this pod (other ways were used)</summary>' + warns.map(esc).join('<br>') + '</details>' : '') +
            '<div class="row" style="margin-top:12px"><button class="btn primary" id="fu-sync"><i class="fa-solid fa-cloud-arrow-down"></i> Load into Finance Lens</button><span class="sm muted">Replaces the finance data on this PC · discovered in ' + ((d.ms || 0) / 1000).toFixed(1) + ' s</span></div>';
        box.innerHTML = h;
        box.querySelectorAll('.fu-role').forEach(function (s) {
            s.onchange = function () {   // one segment per role: clear the role elsewhere in the same chart
                var me = this;
                if (me.value) box.querySelectorAll('.fu-role[data-coa="' + me.dataset.coa + '"]').forEach(function (o) { if (o !== me && o.value === me.value) o.value = ''; });
            };
        });
        $('fu-sync').onclick = function () {
            var ids = Array.prototype.map.call(box.querySelectorAll('.fu-led:checked'), function (c) { return c.value; });
            if (!ids.length) { FL.toast('Tick at least one ledger', 'err'); return; }
            var roles = {};
            box.querySelectorAll('.fu-role').forEach(function (s) { var r = roles[s.dataset.coa] = roles[s.dataset.coa] || {}; if (s.value) r[s.value] = s.dataset.col; });
            var ledgers = leds.filter(function (l) { return ids.indexOf(String(l.id)) >= 0; }).map(function (l) {
                var r = roles[l.coaId] || {}, names = {};
                (l.companies || []).forEach(function (c) { if (c.legalEntity) names[c.value] = c.legalEntity; });
                return { id: l.id, name: l.name, code: l.shortName || String(l.id), currency: l.currency, coaId: l.coaId, periodSet: l.periodSet, periodType: l.periodType, category: l.category,
                    company: r.company, costCentre: r.costCentre || null, account: r.account, companyNames: names };
            });
            var bad = ledgers.filter(function (l) { return !l.company || !l.account; });
            if (bad.length) { FL.toast('Choose the company and the natural account segment for ' + bad[0].name, 'err'); return; }
            var b = $('fu-bud').value === '' ? null : d.budgets[+$('fu-bud').value];
            var o = { pod: d.pod || '', ledgers: ledgers, fromSeq: +$('fu-from').value, toSeq: +$('fu-to').value, budgetSource: b ? b.source : '', budgetId: b ? b.id : '', budgetName: b ? b.name : '',
                journalMonths: +$('fu-jm').value, foldAdjustments: $('fu-fold').checked, incremental: false };
            if (o.toSeq < o.fromSeq) { FL.toast('"From" is after "To"', 'err'); return; }
            if (!confirm('Load ' + ledgers.length + ' ledger(s), ' + F.pname(o.fromSeq) + ' – ' + F.pname(o.toSeq) + ', from Fusion? This replaces the finance data on this PC.')) return;
            o.coa = roles; o.calendar = F.cal;
            F.sync(o);
        };
    };

    F.sync = function (o) {
        if (F.busy) return;
        F.busy = true;
        var p = F.progress('Loading from Fusion…', true), t0 = Date.now();
        var opts = { pod: o.pod, ledgers: o.ledgers, fromSeq: o.fromSeq, toSeq: o.toSeq, budgetSource: o.budgetSource || '', budgetId: o.budgetId || '', journalMonths: o.journalMonths || 0,
            foldAdjustments: o.foldAdjustments !== false, incremental: !!o.incremental };
        FL.call('finFusionSync', { options: opts }, 4 * 3600000, p).then(function (r) {
            F.busy = false;
            var base = F.saved() || {};
            FL.config.fusion = o.incremental ? Object.assign({}, base, { toSeq: Math.max(base.toSeq || 0, o.toSeq) }) : Object.assign({}, base, o);
            delete FL.config.fusion.incremental;
            FL.config.fusion.lastSync = new Date().toISOString();
            FL.config.fusion.lastResult = { balances: r.balances, journals: r.journals, mode: r.mode };
            F.editing = false; F.disc = null;
            return FL.saveConfig().then(function () {
                FL.toast('Loaded ' + r.balances.toLocaleString() + ' balances and ' + r.journals.toLocaleString() + ' journal lines (' + r.mode.toLowerCase() + ') in ' + Math.round((Date.now() - t0) / 1000) + ' s', 'ok');
                FL.lsSet('filter', {});
                return FL.refresh();
            });
        }).catch(function (e) { F.busy = false; if ($('fu-prog')) $('fu-prog').insertAdjacentHTML('beforeend', '<div class="callout bad">' + esc(e) + '</div>'); });
    };

    // ═════ account mapping: class per account → statement lines ═════
    var M = FL.mapping = { q: '', only: 'all', page: 0 };
    FL.specText = function (spec) {
        if (!spec) return '—';
        if (typeof spec === 'object' && !Array.isArray(spec)) {
            var p = [];
            if (spec.type) p.push('type ' + String(spec.type).split('').map(function (t) { return TYPE[t] || t; }).join(' / '));
            if (spec.class) p.push('class ' + [].concat(spec.class).join(', '));
            if (spec.prefix) p.push('starts with ' + [].concat(spec.prefix).join(', '));
            return p.join(' · ');
        }
        return Array.isArray(spec) ? spec.join(', ') : String(spec);
    };
    M.render = function (el) {
        M.el = el;
        var accs = FL.dims.accounts, lines = FINE.accountLines(FL.templates.filter(function (t) { return t.type === 'PL' || t.type === 'BS'; }), accs);
        var main = function (code) { return (lines[code] || []).filter(function (l) { return !(l.row === 'CYE'); }); };
        var plbs = FL.templates.filter(function (t) { return t.id === 'PL' || t.id === 'BS'; });
        var useLines = FINE.accountLines(plbs, accs);
        var probs = { none: 0, dbl: 0 };
        accs.forEach(function (a) { var n = (useLines[a.code] || []).filter(function (l) { return l.row !== 'CYE'; }).length; if (!n) probs.none++; else if (n > 1) probs.dbl++; });
        var q = M.q.toLowerCase(), list = accs.filter(function (a) {
            var n = (useLines[a.code] || []).filter(function (l) { return l.row !== 'CYE'; }).length;
            if (M.only === 'none' && n) return false;
            if (M.only === 'dbl' && n < 2) return false;
            return !q || (a.code + ' ' + a.name + ' ' + (a.class || '')).toLowerCase().indexOf(q) >= 0;
        });
        var auto = FL.templates.some(function (t) { return t.auto; }), over = (FL.config && FL.config.accountClass) || {};
        var shown = list.slice(0, 400);
        el.innerHTML = '<h3><i class="fa-solid fa-diagram-project"></i> Account mapping <small>' + accs.length.toLocaleString() + ' accounts → statement lines' + (auto ? ' by class' : ' by account ranges') + '</small></h3>' +
            '<div class="row" style="margin-bottom:8px"><input id="mp-q" placeholder="Search account, name or class" value="' + esc(M.q) + '" style="flex:1;min-width:180px">' +
            '<div class="seg" id="mp-only">' + [['all', 'All'], ['none', 'In no line (' + probs.none + ')'], ['dbl', 'In two lines (' + probs.dbl + ')']].map(function (x) { return '<button data-o="' + x[0] + '" class="' + (M.only === x[0] ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' +
            '<button class="btn sm" id="mp-rebuild" title="Replace PL, PLS, BS and CF with statements built on the account classes (your other templates stay)"><i class="fa-solid fa-wand-magic-sparkles"></i> Build statements from classes</button></div>' +
            (!auto ? '<p class="sm muted">These templates pick accounts by ranges — a class change here moves an account only in templates built from classes.</p>' : '') +
            '<div class="scroll" style="max-height:420px"><table class="t"><thead><tr><th>Account</th><th>Name</th><th>Type</th><th>Class</th><th>Income statement / balance sheet line</th></tr></thead><tbody>' +
            shown.map(function (a) {
                var ls = main(a.code), cls = FINE.CLASSES[a.account_type] || [];
                if (a.class && cls.indexOf(a.class) < 0) cls = cls.concat([a.class]);
                return '<tr' + (!ls.length ? ' class="neg"' : ls.length > 1 ? ' class="warnrow"' : '') + '><td class="mono">' + esc(a.code) + '</td><td>' + esc(a.name) + '</td><td>' + esc(TYPE[a.account_type] || a.account_type || '') + '</td>' +
                    '<td><select class="mp-cls" data-code="' + esc(a.code) + '">' + cls.map(function (c) { return '<option' + (c === a.class ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' + (over[a.code] ? ' <i class="fa-solid fa-user-pen muted" title="Set by you"></i>' : '') + '</td>' +
                    '<td class="sm">' + (ls.length ? ls.map(function (l) { return '<a class="mp-line" data-t="' + esc(l.tpl) + '" data-r="' + esc(l.row) + '">' + esc(l.tpl + ' › ' + l.label) + '</a>'; }).join('<br>') : '<b>in no line — left out of the totals</b>') + '</td></tr>';
            }).join('') + '</tbody></table>' + (list.length > shown.length ? '<p class="sm muted">First 400 of ' + list.length.toLocaleString() + ' — search to narrow.</p>' : '') + '</div>';
        $('mp-q').oninput = function () { M.q = this.value; clearTimeout(M.t); M.t = setTimeout(function () { M.render(el); var i = $('mp-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
        el.querySelectorAll('#mp-only button').forEach(function (b) { b.onclick = function () { M.only = b.dataset.o; M.render(el); }; });
        el.querySelectorAll('.mp-cls').forEach(function (s) { s.onchange = function () { M.setClass(s.dataset.code, s.value); }; });
        el.querySelectorAll('.mp-line').forEach(function (a) { a.onclick = function () { FL.rowMap(FL.tpl(a.dataset.t), a.dataset.r); }; });
        $('mp-rebuild').onclick = function () {
            if (!confirm('Replace the PL, PLS, BS and CF templates with statements built from the account classes? Your other templates stay.')) return;
            var fresh = FINE.autoTemplates(), ids = fresh.map(function (t) { return t.id; });
            FL.templates = fresh.concat(FL.templates.filter(function (t) { return ids.indexOf(t.id) < 0; }));
            FL.saveTemplates().then(function () { FL.templatesSaved = true; FL.cache = {}; FL.toast('Statements rebuilt from the account classes', 'ok'); M.render(el); });
        };
    };
    M.setClass = function (code, cls) {
        FL.config.accountClass = FL.config.accountClass || {};
        FL.config.accountClass[code] = cls;
        FL.dims.accounts.forEach(function (a) { if (a.code === code) a.class = cls; });
        var ch = {}; ch[code] = cls;
        Promise.all([FL.saveConfig(), FL.call('finSetClasses', { classes: ch })]).then(function () { FL.cache = {}; FL.toast(code + ' → ' + cls, 'ok'); if (M.el && document.body.contains(M.el)) M.render(M.el); })
            .catch(function (e) { FL.toast(String(e), 'err'); });
    };

    // ═════ drill: a statement line → the accounts mapped to it ═════
    FL.rowMap = function (tpl, rowId) {
        if (!tpl) return;
        var row = (tpl.rows || []).filter(function (r) { return r.id === rowId; })[0];
        if (!row) return;
        FL.data().then(function (data) {
            var opts = FL.stmtOpts(), st = FINE.compute(tpl, data, opts), cols = st.columns.filter(function (c) { return c.kind === 'value'; }).slice(0, 4);
            var srow = st.rows.filter(function (r) { return r.id === rowId; })[0] || { values: [] };
            var head = '<div class="crumbs">' + esc(tpl.name) + ' › <b>' + esc(row.label) + '</b> · ' + esc(FL.filterText()) + '</div>';
            var info = [['Line type', row.type], ['Mapping', row.type === 'accounts' ? FL.specText(row.accounts) : row.type === 'group' ? 'sum of the lines below' : row.formula || ''],
                ['Basis', row.type === 'accounts' ? ({ activity: 'movement in the window', balance: 'closing balance', change: 'change (closing − opening)', opening: 'opening balance' }[row.basis] || (tpl.type === 'BS' ? 'closing balance' : 'movement in the window')) : ''],
                ['Sign', row.type === 'accounts' ? (row.sign || 'auto') : '']].filter(function (x) { return x[1]; });
            var html = head + '<table class="t" style="margin-bottom:10px"><tbody>' + info.map(function (x) { return '<tr><td class="muted" style="width:120px">' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
            if (row.type === 'accounts') {
                var per = {};
                cols.forEach(function (c) { FINE.explain(tpl, data, opts, rowId, c.id).forEach(function (a) { (per[a.code] = per[a.code] || { code: a.code, name: a.name, v: {} }).v[c.id] = a.amount; }); });
                var codes = FINE.matchAccounts(row.accounts, data.accounts), byCode = {}; data.accounts.forEach(function (a) { byCode[a.code] = a; });
                var list = codes.map(function (c) { var a = byCode[c] || {}; return { code: c, name: a.name, type: a.account_type, cls: a.class, v: (per[c] || { v: {} }).v }; });
                FL.rmList = list;
                html += '<p class="sm muted">' + list.length + ' account(s) mapped to this line · amounts in ' + FL.scaleLabel() + ' · click an account for companies, cost centres, months and journals</p><div class="scroll" style="max-height:52vh">' +
                    FL.table([{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Type', get: function (r) { return TYPE[r.type] || r.type || ''; } }, { label: 'Class', key: 'cls' }]
                        .concat(cols.map(function (c) { return { label: c.label, n: 1, get: function (r) { return r.v[c.id] == null ? '' : FL.num(r.v[c.id]); } }; })), list, { click: true }) + '</div>' +
                    '<p class="sm">Total ' + cols.map(function (c, i) { var ix = st.columns.indexOf(c); return esc(c.label) + ' <b>' + FL.cellText(row, c, srow.values[ix]) + '</b>'; }).join(' · ') + '</p>';
            } else {
                var kids = row.type === 'group' ? tpl.rows.filter(function (r) { return r.parent === rowId; }) : FINE.refs(FINE.parse(row.formula || '0'), []).map(function (id) { return tpl.rows.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
                html += '<p class="sm muted">Made of these lines — click one for its accounts</p>' + FL.table([{ label: 'Line', key: 'label' }, { label: 'Type', key: 'type' }].concat(cols.map(function (c) {
                    var ix = st.columns.indexOf(c);
                    return { label: c.label, n: 1, get: function (r) { var s = st.rows.filter(function (x) { return x.id === r.id; })[0]; return s ? FL.cellText(r, c, s.values[ix]) : ''; } };
                })), kids, { click: true });
                FL.rmKids = kids;
            }
            FL.modal('<i class="fa-solid fa-diagram-project"></i> ' + esc(row.label) + ' — mapped accounts', html,
                '<button class="btn sm" id="rm-ask"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask the Copilot</button><button class="btn sm" id="rm-edit"><i class="fa-solid fa-pen-ruler"></i> Edit line</button>' + (row.type === 'accounts' ? '<button class="btn sm" id="rm-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>' : ''));
            $('rm-edit').onclick = function () { FL.closeModal(); FL.designer.open(tpl.id); };
            $('rm-ask').onclick = function () { FL.closeModal(); FL.askCopilot('Explain "' + row.label + '" in the ' + tpl.name + ' for ' + FL.periodName(opts.period) + ': what drives it against budget and last year, by account, cost centre and month?'); };
            if ($('rm-csv')) $('rm-csv').onclick = function () { FL.csv(tpl.id + '-' + rowId + '-accounts.csv', ['account', 'name', 'type', 'class'].concat(cols.map(function (c) { return c.label; })), FL.rmList.map(function (r) { return [r.code, r.name, r.type, r.cls].concat(cols.map(function (c) { return r.v[c.id] == null ? '' : r.v[c.id].toFixed(2); })); })); };
            if (row.type === 'accounts') {
                var c0 = cols[0], seqs = c0 ? FINE.windowSeqs(c0, data, opts.period) : [];
                FL.wireRows($('m-body'), FL.rmList, function (a) { FL.drillAccount(a.code, { tpl: tpl, row: row, col: c0 || {}, seqs: seqs, label: row.label + (c0 ? ' · ' + FINE.colLabel(c0, data._pi, opts.period) : '') }); });
            } else FL.wireRows($('m-body'), FL.rmKids, function (r) { FL.rowMap(tpl, r.id); });
        }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
    };
})();
