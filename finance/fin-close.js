/* Finance Lens — Close & reconcile: the finance skills (finance/skills/*.md — adapted from Anthropic's Claude for Financial
   Services plugins, Apache-2.0 — plus custom ones) run as one-click tasks through the CFO Copilot (finAsk with `skill`):
   close package, variance commentary, accrual schedule, roll-forward, GL ↔ subledger reconciliation. Results become close
   packages (close.json) with a sign-off trail Draft → Prepared → Reviewed → Approved (a reviewer / approver is never the
   preparer), every Markdown table exports to an Excel sheet; the close policy lives in config.json `close`. */
(function () {
    var K = FL.closeTab = { skills: null, run: null, view: null, pkgs: null };
    var STATUS = ['draft', 'prepared', 'reviewed', 'approved'];
    var SRC = { 'anthropic-adapted': ['Anthropic · adapted', 'Adapted from Anthropic\'s Claude for Financial Services plugins (Apache-2.0) for a Fusion general ledger'], grays: ['Grays', 'Written for Grays'], custom: ['Custom', 'Added by an AI admin in the data folder'] };
    var TASKS = [
        { skill: 'month-end-close', icon: 'fa-file-signature', q: 'Run the month-end close for {ENTITY}, period {PERIOD}: close checks, accrual schedule, roll-forwards of the key balance sheet accounts, variance commentary and open points — staged for controller sign-off.' },
        { skill: 'variance-commentary', icon: 'fa-chart-column', q: 'Write the variance commentary for {ENTITY}, {PERIOD}: income statement and balance sheet lines over materiality, vs previous month, last year and budget, with the drivers.' },
        { skill: 'accrual-schedule', icon: 'fa-receipt', q: 'Build the accrual schedule for {ENTITY}, {PERIOD} with draft journals.' },
        { skill: 'roll-forward', icon: 'fa-arrows-rotate', q: 'Build the roll-forward for {TARGET} — {ENTITY}, {PERIOD}.', target: true },
        { skill: 'gl-recon', icon: 'fa-scale-balanced', q: 'Reconcile the GL control accounts (trade payables, trade receivables, inventory) to the Fusion subledgers for {ENTITY} at the end of {PERIOD}; trace the material breaks.', admin: true }
    ];

    K.loadSkills = function () { return K.skills ? Promise.resolve(K.skills) : FL.call('finSkills').then(function (r) { K.skills = r.skills || []; K.dir = r.dir; return K.skills; }); };
    K.loadPkgs = function () {
        return FL.call('finDocGet', { name: 'close' }).then(function (r) { var j = null; try { j = r.json ? JSON.parse(r.json) : null; } catch (e) { /* new */ } K.pkgs = (j && j.packages) || []; return K.pkgs; });
    };
    K.savePkgs = function () { return FL.call('finDocSave', { name: 'close', json: JSON.stringify({ version: 1, packages: K.pkgs }, null, 1) }); };
    K.me = function () { return (FL.who && FL.who.user) || appUser() || 'me'; };
    K.settings = function () { return Object.assign({ materialityPct: 5, materialityFloor: 10000, alwaysComment: ['REV', 'STAFF', 'CASH'], accruals: [], reconTolerance: 1 }, (FL.config && FL.config.close) || {}); };

    FL.TABS.closing = {
        render: function (el) {
            return Promise.all([K.loadSkills(), K.loadPkgs()]).then(function () { K.paint(el); });
        }
    };

    K.entity = function () { return FL.filterText(); };
    K.fill = function (q, target) { return q.replace('{ENTITY}', K.entity()).replace('{PERIOD}', FL.periodName(FL.filter.period)).replace('{TARGET}', target || 'the account'); };

    K.paint = function (el) {
        el = el || $('main');
        var sk = {}; (K.skills || []).forEach(function (s) { sk[s.name] = s; });
        var admin = FL.who && FL.who.admin, per = FL.periodName(FL.filter.period);
        var mine = K.pkgs.filter(function (p) { return p.period === FL.filter.period; });
        var custom = (K.skills || []).filter(function (s) { return s.custom && !TASKS.some(function (t) { return t.skill === s.name; }); });
        var bsRows = ((FL.tpl('BS') || {}).rows || []).filter(function (r) { return r.type === 'accounts' || r.type === 'group'; });
        el.innerHTML = '<div class="row" style="margin-bottom:10px"><h2 style="margin:0"><i class="fa-solid fa-file-signature"></i> Close & reconcile · ' + esc(per) + '</h2><span class="sm muted">' + esc(K.entity()) + ' — period and entity from the header</span><span class="grow"></span>' +
            (mine.length ? mine.map(function (p) { return '<span class="tag ' + (p.status === 'approved' ? 'good' : p.status === 'draft' ? '' : 'warn') + '">' + esc(p.title) + ': ' + esc(p.status) + '</span>'; }).join(' ') : '<span class="tag">no close package for ' + esc(per) + ' yet</span>') + '</div>' +
            '<div class="grid g2 ck-grid"><div>' +
            '<div class="card"><h3><i class="fa-solid fa-list-check"></i> Run a task <small>Claude follows the skill on your synced ledger — drafts only, nothing is posted</small></h3><div class="ck-tasks">' +
            TASKS.concat(custom.map(function (s) { return { skill: s.name, icon: 'fa-wand-magic-sparkles', q: 'Follow the skill ' + s.name + ' for {ENTITY}, {PERIOD}.' }; })).map(function (t, i) {
                var s = sk[t.skill] || { title: t.skill, description: '' }, src = SRC[s.source] || SRC.custom;
                return '<div class="ck-task"><div class="row"><i class="fa-solid ' + t.icon + '"></i><b>' + esc(s.title) + '</b><span class="tag sm" title="' + esc(src[1]) + '">' + esc(src[0]) + '</span><span class="grow"></span>' +
                    (t.admin && !admin ? '<span class="sm muted" title="The Fusion subledger side needs an AI admin; others get the GL side">GL side only</span>' : '') +
                    '<button class="btn sm primary" data-run="' + i + '"' + (K.run ? ' disabled' : '') + '><i class="fa-solid fa-play"></i> Run</button></div>' +
                    '<div class="sm muted">' + esc(s.description) + '</div>' +
                    (t.target ? '<label class="sm">Account or line <select data-tg="' + i + '">' + bsRows.map(function (r) { return '<option value="' + esc(r.label + ' (line ' + r.id + ')') + '">' + esc(r.label) + '</option>'; }).join('') + '<option value="">another account — type below</option></select></label>' : '') + '</div>';
            }).join('') + '</div>' +
            '<label class="sm" style="display:block;margin-top:8px">Extra instructions (optional) <textarea id="ck-extra" rows="2" style="width:100%" placeholder="e.g. company 01 only; materiality 50,000; comment on freight in detail"></textarea></label></div>' +
            '<div class="card" id="ck-out">' + (K.view ? '' : '<p class="sm muted">Run a task — the result appears here, with Save as close package, Excel and Continue in the Copilot.</p>') + '</div>' +
            '</div><div>' +
            '<div class="card"><h3><i class="fa-solid fa-signature"></i> Close packages <small>Draft → Prepared → Reviewed → Approved</small></h3>' + K.pkgTable() + '</div>' +
            '<div class="card"><h3><i class="fa-solid fa-sliders"></i> Close policy <small>the skills read it with close_settings</small></h3><div id="ck-set"></div></div>' +
            '<div class="card"><h3><i class="fa-solid fa-book"></i> Skills library <small>' + (K.skills || []).length + ' skill(s)</small><span class="grow"></span>' + (admin ? '<button class="btn sm" id="ck-new"><i class="fa-solid fa-plus"></i> Custom skill</button>' : '') + '</h3>' +
            '<table class="t"><tbody>' + (K.skills || []).map(function (s) { var src = SRC[s.source] || SRC.custom; return '<tr class="click" data-sk="' + esc(s.name) + '"><td><b>' + esc(s.title) + '</b><div class="sm muted">' + esc(s.description) + '</div></td><td><span class="tag sm" title="' + esc(src[1]) + '">' + esc(src[0]) + '</span></td></tr>'; }).join('') + '</tbody></table>' +
            '<p class="sm muted">Shipped skills are adapted from Anthropic\'s Claude for Financial Services (github.com/anthropics/financial-services-plugins) (Apache-2.0, see finance/skills/NOTICE.md). Custom skills: ' + esc(K.dir || '') + ' — a custom skill with the same name replaces a shipped one.</p></div>' +
            '</div></div>';
        el.querySelectorAll('[data-run]').forEach(function (b) {
            b.onclick = function () {
                var all = TASKS.concat(custom.map(function (s) { return { skill: s.name, q: 'Follow the skill ' + s.name + ' for {ENTITY}, {PERIOD}.' }; })), t = all[+b.dataset.run];
                var tg = el.querySelector('[data-tg="' + b.dataset.run + '"]'), target = tg ? tg.value : '';
                var extra = ($('ck-extra').value || '').trim();
                if (t.target && !target && !extra) { FL.toast('Pick a line, or type the account in Extra instructions', 'err'); return; }
                K.exec(t, K.fill(t.q, target || extra) + (extra ? '\nExtra instructions: ' + extra : ''));
            };
        });
        el.querySelectorAll('[data-sk]').forEach(function (r) { r.onclick = function () { K.showSkill(r.dataset.sk); }; });
        if ($('ck-new')) $('ck-new').onclick = function () { K.editSkill(null); };
        K.wirePkgs(el);
        K.paintSettings();
        if (K.view) K.paintOut();
    };

    // ── running a task ──
    K.exec = function (task, question) {
        var sk = (K.skills || []).filter(function (s) { return s.name === task.skill; })[0] || { title: task.skill };
        K.run = { task: task, title: sk.title, question: question, steps: [], started: Date.now() };
        K.view = { title: sk.title, md: '', pending: true, steps: K.run.steps, period: FL.filter.period, entity: K.entity(), skill: task.skill, question: question };
        K.paint();
        var tick = setInterval(function () { if (!K.run) return clearInterval(tick); var s = $('ck-secs'); if (s) s.textContent = Math.round((Date.now() - K.run.started) / 1000) + ' s'; }, 1000);
        FL.copilot.context().then(function (ctx) {
            return FL.call('finAsk', { question: question, skill: task.skill, history: [], context: JSON.stringify(ctx) }, 11 * 60000, function (msg) {
                if (!msg || /^(Reading the numbers|Checking the ledger|Writing the answer)/.test(msg)) return;
                K.run.steps.push(msg); K.paintOut();
            });
        }).then(function (r) {
            K.view.md = r.answer || ''; K.view.cost = r.costUsd; K.view.queries = r.queries; K.view.pending = false; K.view.steps = r.steps || K.view.steps;
        }).catch(function (e) { K.view.error = String(e && e.message || e); K.view.pending = false; })
            .then(function () { K.run = null; clearInterval(tick); if (FL.tab === 'closing') K.paint(); });
    };
    K.paintOut = function () {
        var box = $('ck-out'), v = K.view; if (!box || !v) return;
        box.innerHTML = '<div class="row"><h3 style="margin:0">' + esc(v.title) + ' · ' + esc(FL.periodName(v.period)) + '</h3><span class="sm muted">' + esc(v.entity || '') + '</span><span class="grow"></span>' +
            (v.pending ? '<span class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i> working · <span id="ck-secs">0 s</span></span><button class="btn sm" id="ck-stop"><i class="fa-solid fa-stop"></i> Stop</button>'
                : (v.md ? (v.pkgId ? '' : '<button class="btn sm primary" id="ck-save"><i class="fa-solid fa-floppy-disk"></i> Save as close package</button>') +
                    '<button class="btn sm" id="ck-xl"><i class="fa-solid fa-file-excel"></i> Excel</button><button class="btn sm" id="ck-copy"><i class="fa-regular fa-copy"></i></button>' +
                    '<button class="btn sm" id="ck-cop" title="Ask follow-up questions about this in the CFO Copilot"><i class="fa-solid fa-wand-magic-sparkles"></i> Continue in Copilot</button>' : '')) + '</div>' +
            (v.steps && v.steps.length ? '<details class="cop-steps"' + (v.pending ? ' open' : '') + '><summary>' + v.steps.length + ' step(s)</summary>' + v.steps.map(function (s) { return '<div>' + esc(s) + '</div>'; }).join('') + '</details>' : '') +
            (v.error ? '<div class="callout bad">' + esc(v.error) + '</div>' : '') +
            (v.md ? '<div class="ck-md">' + FL.copilot.md(v.md, 9000) + '</div>' : '') +
            (v.cost != null && !v.pending ? '<div class="cop-cost">$' + Number(v.cost).toFixed(3) + '</div>' : '');
        if ($('ck-stop')) $('ck-stop').onclick = function () { FL.call('finAskCancel'); };
        if ($('ck-save')) $('ck-save').onclick = K.saveView;
        if ($('ck-xl')) $('ck-xl').onclick = function () { K.excel(v); };
        if ($('ck-copy')) $('ck-copy').onclick = function () { try { navigator.clipboard.writeText(v.md); FL.toast('Copied', 'ok'); } catch (e) { /* no clipboard */ } };
        if ($('ck-cop')) $('ck-cop').onclick = function () {
            var C = FL.copilot; C.msgs.push({ role: 'user', content: v.question }); C.msgs.push({ role: 'assistant', content: v.md, steps: v.steps }); C.save(); C.show();
        };
        box.querySelectorAll('.cop-lnk').forEach(function (a) { a.onclick = function (e) { FL.copilot.onLink(e); }; });
    };

    // ── close packages + sign-off ──
    K.saveView = function () {
        var v = K.view, p = { id: 'cp' + Date.now().toString(36), period: v.period, periodName: FL.periodName(v.period), entity: v.entity, filter: Object.assign({}, FL.filter), skill: v.skill, title: v.title,
            md: v.md, question: v.question, status: 'draft', trail: [{ status: 'draft', by: K.me(), at: new Date().toISOString(), note: 'created by Claude (' + v.skill + ')' }] };
        K.pkgs.unshift(p); v.pkgId = p.id;
        K.savePkgs().then(function () { FL.toast('Saved as a draft close package', 'ok'); K.paint(); }).catch(function (e) { FL.toast(String(e), 'err'); });
    };
    K.pkgTable = function () {
        if (!K.pkgs.length) return '<p class="sm muted">No close packages yet — run a task and Save as close package.</p>';
        return '<table class="t"><thead><tr><th>Period</th><th>Package</th><th>Status</th><th>By</th></tr></thead><tbody>' + K.pkgs.slice(0, 40).map(function (p) {
            var last = p.trail[p.trail.length - 1] || {};
            return '<tr class="click" data-pk="' + esc(p.id) + '"><td>' + esc(p.periodName) + '</td><td>' + esc(p.title) + '<div class="sm muted">' + esc(p.entity || '') + '</div></td><td><span class="tag ' + (p.status === 'approved' ? 'good' : p.status === 'draft' ? '' : 'warn') + '">' + esc(p.status) + '</span></td><td class="sm">' + esc(last.by || '') + '<div class="muted">' + esc(String(last.at || '').slice(0, 16).replace('T', ' ')) + '</div></td></tr>';
        }).join('') + '</tbody></table>';
    };
    K.wirePkgs = function (el) { el.querySelectorAll('[data-pk]').forEach(function (r) { r.onclick = function () { K.openPkg(r.dataset.pk); }; }); };
    K.openPkg = function (id) {
        var p = K.pkgs.filter(function (x) { return x.id === id; })[0]; if (!p) return;
        var me = K.me(), preparer = (p.trail.filter(function (t) { return t.status === 'prepared'; })[0] || p.trail[0] || {}).by, ix = STATUS.indexOf(p.status);
        var next = STATUS[ix + 1], canNext = next && (next === 'prepared' || me !== preparer);
        FL.modal('<i class="fa-solid fa-file-signature"></i> ' + esc(p.title) + ' · ' + esc(p.periodName),
            '<div class="row sm" style="margin-bottom:8px">' + STATUS.map(function (s, i) { return '<span class="tag ' + (i <= ix ? 'good' : '') + '">' + (i <= ix ? '✓ ' : '') + s + '</span>'; }).join(' → ') + '</div>' +
            '<table class="t sm" style="margin-bottom:8px"><tbody>' + p.trail.map(function (t) { return '<tr><td>' + esc(t.status) + '</td><td>' + esc(t.by) + '</td><td>' + esc(String(t.at).slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(t.note || '') + '</td></tr>'; }).join('') + '</tbody></table>' +
            '<div class="ck-md">' + FL.copilot.md(p.md, 9100) + '</div>' +
            '<label class="sm" style="display:block;margin-top:8px">Note for the trail <input id="pk-note" style="width:100%" placeholder="e.g. accruals checked against the June invoices"></label>' +
            (next && !canNext ? '<p class="sm warn-t">The person who prepared the package cannot ' + (next === 'reviewed' ? 'review' : 'approve') + ' it.</p>' : ''),
            (canNext ? '<button class="btn primary" id="pk-next"><i class="fa-solid fa-check"></i> Mark ' + next + '</button>' : '') +
            (ix > 0 && p.status !== 'approved' ? '<button class="btn" id="pk-back"><i class="fa-solid fa-rotate-left"></i> Send back to draft</button>' : '') +
            '<button class="btn" id="pk-xl"><i class="fa-solid fa-file-excel"></i> Excel</button>' +
            (p.status === 'draft' ? '<button class="btn" id="pk-del"><i class="fa-regular fa-trash-can"></i></button>' : ''));
        var step = function (status, note) {
            p.status = status; p.trail.push({ status: status, by: me, at: new Date().toISOString(), note: note || $('pk-note').value.trim() });
            K.savePkgs().then(function () { FL.closeModal(); FL.toast('Close package ' + status, 'ok'); K.paint(); });
        };
        if ($('pk-next')) $('pk-next').onclick = function () { step(next); };
        if ($('pk-back')) $('pk-back').onclick = function () { var n = $('pk-note').value.trim(); if (!n) { FL.toast('Say why in the note', 'err'); return; } step('draft', 'sent back: ' + n); };
        $('pk-xl').onclick = function () { K.excel({ title: p.title, period: p.period, entity: p.entity, md: p.md, trail: p.trail, status: p.status }); };
        if ($('pk-del')) $('pk-del').onclick = function () { if (!confirm('Delete this draft close package?')) return; K.pkgs = K.pkgs.filter(function (x) { return x !== p; }); K.savePkgs().then(function () { FL.closeModal(); K.paint(); }); };
    };

    /** Markdown → Excel: a Package sheet with the text, one sheet per table (named after the heading above it), a Sign-off sheet */
    K.excel = function (v) {
        if (!window.ExcelJS) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var wb = new ExcelJS.Workbook(); wb.creator = 'Finance Lens';
        var main = wb.addWorksheet('Package'), used = { Package: 1 };
        main.addRow([v.title + ' · ' + FL.periodName(v.period)]).font = { bold: true, size: 14 };
        main.addRow([v.entity || '']).font = { italic: true, color: { argb: 'FF64748B' } };
        var lines = String(v.md || '').split('\n'), heading = 'Table', tables = 0;
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim().replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); }); };
        var num = function (c) { var t = c.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/^−/, '-'); return /^-?\d+(\.\d+)?$/.test(t) ? +t : /^-?\d+(\.\d+)?%$/.test(t) ? +t.slice(0, -1) / 100 : null; };
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (/^#{1,4}\s/.test(l)) { heading = l.replace(/^#+\s*/, '').replace(/[*`]/g, ''); main.addRow([heading]).font = { bold: true }; continue; }
            if (/^\s*\|.*\|\s*$/.test(l)) {
                var rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]); i--;
                var head = cells(rows[0]), body = rows.slice(/^[\s|:-]+$/.test(rows[1] || '') ? 2 : 1).map(cells);
                var name = heading.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Table', n = name, k = 2; while (used[n]) n = name.slice(0, 26) + ' ' + (k++); used[n] = 1; tables++;
                var ws = wb.addWorksheet(n), hr = ws.addRow(head); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13315C' } }; });
                body.forEach(function (r) {
                    var row = ws.addRow(r.map(function (c) { var x = num(c); return x == null ? c : x; }));
                    r.forEach(function (c, j) { if (num(c) != null) row.getCell(j + 1).numFmt = /%\s*$/.test(c) ? '0.0%' : '#,##0.00;(#,##0.00);"–"'; });
                });
                head.forEach(function (_, j) { ws.getColumn(j + 1).width = j ? 18 : 40; });
                ws.views = [{ state: 'frozen', ySplit: 1 }];
                main.addRow(['→ table on sheet "' + n + '"']).font = { italic: true, color: { argb: 'FF1D4ED8' } };
                continue;
            }
            if (l.trim()) main.addRow([l.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')]);
        }
        main.getColumn(1).width = 120;
        if (v.trail) { var so = wb.addWorksheet('Sign-off'); so.addRow(['Status', 'By', 'At', 'Note']).font = { bold: true }; v.trail.forEach(function (t) { so.addRow([t.status, t.by, t.at, t.note || '']); }); so.columns.forEach(function (c) { c.width = 28; }); }
        wb.xlsx.writeBuffer().then(function (buf) { FL.download((v.title + ' ' + FL.periodName(v.period)).replace(/[^\w -]+/g, '') + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); FL.toast(tables + ' table(s) → Excel', 'ok'); });
    };

    // ── close policy (config.json close) ──
    K.paintSettings = function () {
        var box = $('ck-set'); if (!box) return;
        var s = K.settings(), rows = [];
        ['PL', 'BS'].forEach(function (t) { ((FL.tpl(t) || {}).rows || []).forEach(function (r) { if (r.id && /accounts|group|formula/.test(r.type) && !rows.some(function (x) { return x[0] === r.id; })) rows.push([r.id, r.label]); }); });
        box.innerHTML = '<div class="grid g2"><label class="field">Materiality %<input id="cs-p" type="number" step="0.1" value="' + esc(s.materialityPct) + '"></label><label class="field">Materiality floor (amount)<input id="cs-f" type="number" value="' + esc(s.materialityFloor) + '"></label>' +
            '<label class="field">Reconciliation tolerance<input id="cs-t" type="number" step="0.01" value="' + esc(s.reconTolerance) + '"></label>' +
            '<label class="field">Always comment on<select id="cs-a" multiple size="4">' + rows.map(function (r) { return '<option value="' + esc(r[0]) + '"' + (s.alwaysComment.indexOf(r[0]) >= 0 ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') + '</select></label></div>' +
            '<h4 style="margin:8px 0 4px">Accrual policy <small class="muted">empty = Claude proposes candidates from recurring costs</small></h4>' +
            '<div class="scroll"><table class="t sm" id="cs-acc"><thead><tr><th>Accrual</th><th>Expense acct</th><th>Liability acct</th><th>Method</th><th class="n">Amount</th><th>Reverses</th><th></th></tr></thead><tbody>' +
            s.accruals.map(function (a, i) {
                return '<tr data-i="' + i + '"><td><input data-k="name" value="' + esc(a.name || '') + '"></td><td><input data-k="expense" value="' + esc(a.expense || '') + '" style="width:90px"></td><td><input data-k="liability" value="' + esc(a.liability || '') + '" style="width:90px"></td>' +
                    '<td><select data-k="method">' + [['fixed', 'fixed per month'], ['avg3', 'average of 3 months'], ['annual', 'annual ÷ 12']].map(function (m) { return '<option value="' + m[0] + '"' + (a.method === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></td>' +
                    '<td><input data-k="amount" type="number" value="' + esc(a.amount == null ? '' : a.amount) + '" style="width:100px"></td><td><input type="checkbox" data-k="reverses"' + (a.reverses !== false ? ' checked' : '') + '></td><td><button class="icon" data-rm="' + i + '"><i class="fa-regular fa-trash-can"></i></button></td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<div class="row" style="margin-top:6px"><button class="btn sm" id="cs-add"><i class="fa-solid fa-plus"></i> Accrual</button><span class="grow"></span><button class="btn sm primary" id="cs-save"><i class="fa-solid fa-floppy-disk"></i> Save policy</button></div>';
        var read = function () {
            var accr = Array.prototype.map.call(box.querySelectorAll('#cs-acc tbody tr'), function (tr) {
                var o = {}; tr.querySelectorAll('[data-k]').forEach(function (x) { o[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.type === 'number' ? (x.value === '' ? null : +x.value) : x.value.trim(); }); return o;
            }).filter(function (a) { return a.name; });
            return { materialityPct: +$('cs-p').value || 5, materialityFloor: +$('cs-f').value || 0, reconTolerance: +$('cs-t').value || 1,
                alwaysComment: Array.prototype.map.call($('cs-a').selectedOptions, function (o) { return o.value; }), accruals: accr };
        };
        $('cs-add').onclick = function () { var s2 = read(); s2.accruals.push({ name: 'New accrual', method: 'fixed', reverses: true }); FL.config.close = s2; K.paintSettings(); };
        box.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { var s2 = read(); s2.accruals.splice(+b.dataset.rm, 1); FL.config.close = s2; K.paintSettings(); }; });
        $('cs-save').onclick = function () { FL.config.close = read(); FL.saveConfig().then(function () { FL.toast('Close policy saved', 'ok'); }).catch(function (e) { FL.toast(String(e), 'err'); }); };
    };

    // ── skills library ──
    K.showSkill = function (name) {
        var s = (K.skills || []).filter(function (x) { return x.name === name; })[0]; if (!s) return;
        var admin = FL.who && FL.who.admin, src = SRC[s.source] || SRC.custom;
        FL.modal('<i class="fa-solid fa-book"></i> ' + esc(s.title), '<div class="row sm"><span class="tag">' + esc(src[0]) + '</span><span class="muted">' + esc(src[1]) + '</span></div><p class="sm">' + esc(s.description) + '</p>' +
            (s.uses ? '<p class="sm muted">Uses: ' + esc(s.uses) + '</p>' : '') + '<div class="ck-md">' + FL.copilot.md(s.body, 9200) + '</div>',
            (admin ? '<button class="btn" id="sk-edit"><i class="fa-solid fa-pen"></i> ' + (s.custom ? 'Edit' : 'Make my own version') + '</button>' : '') +
            (admin && s.custom ? '<button class="btn" id="sk-del"><i class="fa-regular fa-trash-can"></i> Delete</button>' : ''));
        if ($('sk-edit')) $('sk-edit').onclick = function () { K.editSkill(s); };
        if ($('sk-del')) $('sk-del').onclick = function () { if (!confirm('Delete the custom skill ' + s.name + '?' + (s.source === 'custom' ? '' : ' The shipped one comes back.'))) return; FL.call('finSkillDelete', { name: s.name }).then(function () { K.skills = null; FL.closeModal(); FL.render(); }); };
    };
    K.editSkill = function (s) {
        var text = s ? '---\nname: ' + s.name + '\ntitle: ' + s.title + '\ndescription: ' + s.description + (s.uses ? '\nuses: ' + s.uses : '') + '\n---\n' + s.body
            : '---\nname: my-skill\ntitle: My finance task\ndescription: What the task does and when to use it (Claude reads this to decide).\n---\n\n# My finance task\n\n## Steps\n1. …\n\n## Output\nOne Markdown table per schedule.\n';
        FL.modal('<i class="fa-solid fa-pen"></i> ' + (s ? 'Skill ' + esc(s.name) : 'New custom skill'),
            '<label class="field">Name (lower-case, digits, dashes — the same name as a shipped skill replaces it)<input id="se-n" value="' + esc(s ? s.name : 'my-skill') + '"></label>' +
            '<textarea id="se-t" class="mono" rows="22" style="width:100%">' + esc(text) + '</textarea><p class="sm muted">Front matter: name, title, description (when to use it), uses (other skills). Saved in the Finance Lens data folder, audited.</p>',
            '<button class="btn primary" id="se-s"><i class="fa-solid fa-floppy-disk"></i> Save</button>');
        $('se-s').onclick = function () {
            FL.call('finSkillSave', { name: $('se-n').value.trim().toLowerCase(), text: $('se-t').value }).then(function () { K.skills = null; FL.closeModal(); FL.toast('Skill saved', 'ok'); FL.render(); }).catch(function (e) { FL.toast(String(e), 'err'); });
        };
    };
})();
