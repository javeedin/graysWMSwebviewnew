/* Finance Lens — Paste mapping: "account ⇥ group [⇥ main group]" pasted from Excel (or an .xlsx / .csv file) into any statement template.
   Validate = every account checked against the synced chart (leading zeros ignored), every pasted group matched to a line of the
   template (label / id); groups that do not exist can be created (under a group, or as a new main group), mapped to another line
   or skipped. Load = new lines are added and every account moves to its line (taken out of all others). Or build a whole new
   template from the paste. Engine: FINE.pasteParse / pasteValidate / pasteApply / pasteBuild (node-tested). */
(function () {
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var $ = function (id) { return document.getElementById(id); };
    var PM = FL.pasteMap = { text: FL.ls('pm.text', ''), filter: 'all' };
    var ST = { ok: 'OK', unknown: 'Not in the chart', conflict: 'In two groups', duplicate: 'Pasted twice', nogroup: 'No group' };

    /** Opens the dialog for template t (the draft being edited). done(result) is called after Load. */
    PM.open = function (t, done) {
        PM.t = t; PM.done = done; PM.v = null; PM.dec = {}; PM.pick = {}; PM.mode = 'into';
        PM.step1();
    };
    PM.head = function (n) {
        return '<div class="pm-steps">' + ['Paste', 'Validate', 'Load'].map(function (s, i) { return '<span class="' + (i + 1 === n ? 'on' : i + 1 < n ? 'done' : '') + '">' + (i + 1) + ' · ' + s + '</span>'; }).join('') + '</div>';
    };
    PM.step1 = function () {
        var t = PM.t;
        FL.modal('<i class="fa-solid fa-paste"></i> Paste mapping', PM.head(1) +
            '<div class="grid g2" style="align-items:start"><div>' +
            '<p class="sm" style="margin-top:0">Copy two columns from Excel — <b>account</b> and its <b>group</b> — and paste them below. A third column <b>main group</b> is optional — e.g. <i>Non-current assets</i> for Plant and equipment: the group is put under it (the main group is created when it does not exist). A header row is recognised; tabs, <code>;</code> or <code>,</code> separate the columns.</p>' +
            '<textarea id="pm-ta" class="pm-ta" placeholder="Account&#9;Group&#10;401000&#9;Revenue&#10;402000&#9;Export revenue&#10;611000&#9;Utilities&#9;Operating expenses">' + esc(PM.text) + '</textarea>' +
            '<div class="row" style="margin-top:6px"><label class="btn sm"><i class="fa-solid fa-file-excel"></i> Load Excel / CSV<input type="file" id="pm-file" accept=".xlsx,.csv,.txt" hidden></label>' +
            '<button class="btn sm" id="pm-cur" title="Fill the box with this template\'s current mapping (account ⇥ line) — edit it in Excel and paste it back"><i class="fa-solid fa-download"></i> Current mapping</button>' +
            '<button class="btn sm ghost" id="pm-clr">Clear</button><span class="grow"></span><span class="sm muted" id="pm-n"></span></div></div>' +
            '<div><div class="card" style="margin:0"><h3 style="margin-top:0">Load into</h3>' +
            '<label style="display:block;margin:4px 0"><input type="radio" name="pm-mode" value="into" checked> This template: <b>' + esc(t.name) + '</b> <span class="sm muted">(' + ({ PL: 'income statement', BS: 'balance sheet', CF: 'cash flow' }[FINE.tplKind(t) || t.type] || t.type) + ')</span></label>' +
            '<p class="sm muted" style="margin:2px 0 8px 22px">Groups are matched to its lines by name; missing ones can be created. Accounts move to their pasted line.</p>' +
            '<label style="display:block;margin:4px 0"><input type="radio" name="pm-mode" value="new"> A new template, built from the paste</label>' +
            '<p class="sm muted" style="margin:2px 0 4px 22px">Main group → line, group → section; income statement or balance sheet decided by the accounts, with totals (net profit / total assets, total equity and liabilities and the balance check).</p>' +
            '<label class="field" style="margin-left:22px">Name<input id="pm-name" value="' + esc((FINE.tplKind(t) === 'BS' ? 'Balance sheet' : 'Income statement') + ' — pasted') + '"></label></div>' +
            '<p class="sm muted">Accounts known on this PC: <b>' + FL.dims.accounts.length + '</b>' + (FL.dims.accounts.length ? '' : ' — sync a trial balance first so accounts can be checked') + '.</p></div></div>',
            '<button class="btn primary" id="pm-val"><i class="fa-solid fa-check-double"></i> Validate</button>');
        var ta = $('pm-ta');
        var count = function () { var p = FINE.pasteParse(ta.value); $('pm-n').textContent = p.rows.length + ' row(s)' + (p.header ? ' · header found' : ''); };
        ta.oninput = count; count();
        $('pm-clr').onclick = function () { ta.value = ''; count(); ta.focus(); };
        $('pm-cur').onclick = function () {
            var lines = FINE.accountLines([t], FL.dims.accounts), lab = {};
            FINE.tplTargets(t).forEach(function (x) { lab[x.id] = x.label; });
            var out = ['Account\tGroup\tName'];
            FL.dims.accounts.forEach(function (a) { var l = lines[a.code] && lines[a.code][0]; if (l && lab[l.row]) out.push(a.code + '\t' + String(lab[l.row]).split(' › ').pop() + '\t' + (a.name || '')); });
            ta.value = out.join('\n'); count();
        };
        $('pm-file').onchange = function () {
            var f = this.files[0]; this.value = ''; if (!f) return;
            PM.readFile(f).then(function (text) { ta.value = text; count(); }, function (e) { FL.toast(String(e), 'err'); });
        };
        $('pm-val').onclick = function () {
            PM.text = ta.value; FL.lsSet('pm.text', PM.text.length < 200000 ? PM.text : '');
            PM.mode = (document.querySelector('input[name=pm-mode]:checked') || {}).value || 'into';
            PM.name = $('pm-name').value.trim() || 'Pasted template';
            var p = FINE.pasteParse(PM.text);
            if (!p.rows.length) { FL.toast('Nothing to check — paste account and group columns first.', 'err'); return; }
            PM.v = FINE.pasteValidate(PM.mode === 'new' ? { type: 'CUSTOM', rows: [] } : PM.t, p, FL.dims.accounts);
            PM.dec = {}; PM.pick = {}; PM.filter = 'all';
            PM.step2();
        };
    };
    /** First sheet of an .xlsx (cell text) or a CSV → tab-separated text */
    PM.readFile = function (f) {
        if (/\.xlsx$/i.test(f.name)) {
            if (!window.ExcelJS) return Promise.reject('The Excel library did not load — save the sheet as CSV.');
            return f.arrayBuffer().then(function (buf) {
                var wb = new ExcelJS.Workbook();
                return wb.xlsx.load(buf).then(function () {
                    var ws = wb.worksheets[0], out = [];
                    ws.eachRow(function (row) { var vals = []; row.eachCell({ includeEmpty: true }, function (c, i) { vals[i - 1] = c.text == null ? '' : String(c.text).replace(/[\t\r\n]+/g, ' '); }); out.push(vals.join('\t')); });
                    return out.join('\n');
                });
            });
        }
        return f.text();
    };

    PM.step2 = function () {
        var v = PM.v, s = v.summary, isNew = PM.mode === 'new';
        var targets = isNew ? [] : FINE.tplTargets(PM.t), parents = v.parents || [];
        var chip = function (k, n, cls, label) { return n ? '<b class="' + cls + (PM.filter === k ? ' on' : '') + '" data-flt="' + k + '">' + n + ' ' + label + '</b>' : ''; };
        var h = PM.head(2) +
            '<div class="pm-kpi">' + chip('all', s.rows, '', 'rows') + chip('ok', s.ok, 'good', 'accounts OK') + chip('unknown', s.unknown, 'bad', 'not in the chart') + chip('conflict', s.conflict, 'bad', 'in two groups') +
            chip('duplicate', s.duplicate, 'warn', 'pasted twice') + chip('nogroup', s.nogroup, 'bad', 'without a group') + chip('kind', s.wrongKind, 'warn', 'belong to the other statement') +
            (isNew ? '' : chip('moves', s.moves, '', 'move from another line')) + '</div>';
        // groups
        h += '<h3 style="margin:6px 0">Groups <small>' + v.groups.length + (isNew ? ' — each becomes a line of the new template' : ' · ' + s.matched + ' found in the template · ' + s.create + ' new') + '</small></h3>' +
            '<div class="scroll" style="max-height:30vh"><table class="pm-tab"><thead><tr><th>Pasted group</th><th>Main group</th><th class="num">Accounts</th><th>Nature</th><th>In the template</th>' + (isNew ? '' : '<th>What to do</th><th>Where / name</th>') + '</tr></thead><tbody>' +
            v.groups.map(function (g, i) {
                var d = PM.dec[g.key] || (g.match ? { action: 'map', to: g.match.id } : { action: 'create', parent: g.parent, name: g.name, newMain: g.newMain });
                PM.dec[g.key] = d;
                var where = '';
                if (!isNew) {
                    if (d.action === 'map') where = '<select data-g="' + i + '" data-f="to">' + targets.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === d.to ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>';
                    else if (d.action === 'create') where = '<input data-g="' + i + '" data-f="name" value="' + esc(d.name) + '" title="Name of the new line"> under <select data-g="' + i + '" data-f="parent"><option value="">' + (d.newMain ? 'new main group "' + esc(d.newMain) + '"' : '— top level') + '</option>' +
                        parents.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === d.parent ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '</select>';
                    else where = '<span class="sm muted">its accounts stay where they are</span>';
                }
                return '<tr><td><b>' + esc(g.name) + '</b></td><td>' + esc(g.main || '') + '</td><td class="num">' + g.codes.length + (g.count !== g.codes.length ? ' <span class="sm muted">of ' + g.count + '</span>' : '') + '</td><td>' + esc(g.nature) + '</td>' +
                    '<td>' + (isNew ? '<span class="pm-st new">new line</span>' : g.match ? '<span class="pm-st map">exists</span> ' + esc(g.match.label) + (g.mismatch ? ' <span class="pm-st kind" title="The line holds ' + esc(g.mismatch) + ' accounts, the pasted ones are ' + esc(g.nature) + '">' + esc(g.nature) + ' → ' + esc(g.mismatch) + ' line</span>' : '') : '<span class="pm-st new">not found</span>') + '</td>' +
                    (isNew ? '' : '<td><select data-g="' + i + '" data-f="action">' + [['map', 'Use a line'], ['create', 'Create it'], ['skip', 'Skip']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === d.action ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td><td>' + where + '</td>') + '</tr>';
            }).join('') + '</tbody></table></div>';
        // accounts
        var rows = v.rows.filter(function (r) {
            var f = PM.filter;
            return f === 'all' || (f === 'kind' ? r.status === 'ok' && !r.kindOk : f === 'moves' ? r.status === 'ok' && r.now : r.status === f);
        });
        h += '<h3 style="margin:12px 0 6px">Accounts <small>' + rows.length + ' shown' + (PM.filter !== 'all' ? ' · <a href="#" data-flt="all">show all</a>' : '') + '</small></h3>' +
            '<div class="scroll" style="max-height:32vh"><table class="pm-tab"><thead><tr><th>Row</th><th>Pasted</th><th>Account</th><th>Name</th><th>Type</th><th>Group</th><th>Check</th>' + (isNew ? '' : '<th>Now in</th>') + '</tr></thead><tbody>' +
            rows.slice(0, 1500).map(function (r) {
                var st = r.status === 'ok' && !r.kindOk ? 'kind' : r.status;
                return '<tr><td class="sm muted">' + r.n + '</td><td class="mono">' + esc(r.account) + '</td><td class="mono">' + (r.name ? esc(r.code) : '') + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.group) + '</td>' +
                    '<td><span class="pm-st ' + st + '">' + (st === 'kind' ? 'Other statement' : ST[st]) + '</span></td>' + (isNew ? '' : '<td class="sm">' + esc(r.now) + '</td>') + '</tr>';
            }).join('') + '</tbody></table></div>';
        if (v.missing.length && !isNew) h += '<div class="callout warn sm" style="margin-top:8px"><b>' + v.missing.length + ' account(s) of this statement are in no line and not in the paste</b> — ' + v.missing.slice(0, 12).map(function (a) { return esc(a.code + ' ' + (a.name || '')); }).join(', ') + (v.missing.length > 12 ? ' …' : '') + '</div>';
        if (s.unknown) h += '<div class="callout bad sm" style="margin-top:8px">Accounts not in the synced chart are left out' + (isNew ? ' of the checks but kept in the template (they show once synced)' : '') + '. Leading zeros do not matter (<code>4000</code> = <code>04000</code>).</div>';
        if (s.conflict) {
            // an account must sit in one group only: the user picks which (the first pasted one by default)
            var cg = {}; v.rows.forEach(function (r) { if (r.status === 'conflict') { var o = cg[r.code] = cg[r.code] || { code: r.code, name: r.name, groups: [] }; if (o.groups.indexOf(r.group) < 0) o.groups.push(r.group); } });
            PM.pick = PM.pick || {};
            h += '<div class="callout warn sm" style="margin-top:8px"><b>' + Object.keys(cg).length + ' account(s) are pasted under more than one group</b> — an account can be in one group only. Choose the group for each:' +
                '<table class="pm-tab" style="margin-top:6px"><thead><tr><th>Account</th><th>Name</th><th>Group it goes to</th></tr></thead><tbody>' +
                Object.keys(cg).map(function (c) {
                    var o = cg[c], cur = PM.pick[c] || FINE.pasteKey(o.groups[0]); PM.pick[c] = cur;
                    return '<tr><td class="mono">' + esc(c) + '</td><td>' + esc(o.name) + '</td><td><select data-pick="' + esc(c) + '">' + o.groups.map(function (g) { return '<option value="' + esc(FINE.pasteKey(g)) + '"' + (FINE.pasteKey(g) === cur ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select></td></tr>';
                }).join('') + '</tbody></table></div>';
        }
        if (!isNew) h += '<label class="sm" style="display:block;margin-top:8px"><input type="checkbox" id="pm-exact"' + (PM.exact ? ' checked' : '') + '> The paste is the complete list for the lines it names — accounts not pasted are taken off those lines</label>';
        FL.modal('<i class="fa-solid fa-paste"></i> Paste mapping · ' + esc(isNew ? 'new template "' + PM.name + '"' : PM.t.name), h,
            '<button class="btn" id="pm-back"><i class="fa-solid fa-arrow-left"></i> Back</button><button class="btn primary" id="pm-load"' + (s.ok + s.conflict + s.duplicate ? '' : ' disabled') + '><i class="fa-solid fa-file-import"></i> ' + (isNew ? 'Build template' : 'Load into template') + '</button>');
        document.querySelectorAll('#m-body [data-flt]').forEach(function (b) { b.onclick = function (e) { e.preventDefault(); PM.filter = b.dataset.flt; PM.step2(); }; });
        document.querySelectorAll('#m-body [data-g]').forEach(function (x) {
            x.onchange = function () {
                var g = v.groups[+x.dataset.g], d = PM.dec[g.key];
                if (x.dataset.f === 'action') {
                    d.action = x.value;
                    if (d.action === 'map' && !d.to) d.to = g.match ? g.match.id : (FINE.suggestLine(PM.t, (FL.dims.accounts.filter(function (a) { return a.code === g.codes[0]; })[0] || {}), FL.dims.accounts) || {}).id || (targets[0] || {}).id;
                    if (d.action === 'create') { d.name = d.name || g.name; if (d.parent == null) d.parent = g.parent; }
                    PM.step2();
                } else d[x.dataset.f] = x.value;
            };
        });
        var ex = $('pm-exact'); if (ex) ex.onchange = function () { PM.exact = ex.checked; };
        document.querySelectorAll('#m-body [data-pick]').forEach(function (x) { x.onchange = function () { PM.pick[x.dataset.pick] = x.value; }; });
        $('pm-back').onclick = PM.step1;
        $('pm-load').onclick = PM.load;
    };

    PM.load = function () {
        var v = PM.v;
        if (PM.mode === 'new') {
            var b = FINE.pasteBuild(v, PM.name, FL.dims.accounts);
            if (!b) { FL.toast('Nothing to build.', 'err'); return; }
            var t = b.tpl, used = {}; FL.templates.forEach(function (x) { used[x.id] = 1; });
            t.id = FINE.simpleId(PM.name, used); t.description = 'Built from a pasted mapping';
            FL.templates.push(t);
            FL.saveTemplates().then(function () {
                PM.result(t, { built: true, lines: t.rows.filter(function (r) { return r.type === 'accounts'; }).length, warnings: b.warnings });
                if (PM.done) PM.done({ built: t });
            }, function (e) { FL.toast(String(e), 'err'); });
            return;
        }
        var conflicts = v.groups.filter(function (g) { var d = PM.dec[g.key]; return d.action === 'map' && !d.to; });
        if (conflicts.length) { FL.toast('Choose a line for ' + conflicts[0].name, 'err'); return; }
        var res = FINE.pasteApply(PM.t, v, PM.dec, FL.dims.accounts, { exact: !!PM.exact, pick: PM.pick || {} });
        PM.result(PM.t, res);
        if (PM.done) PM.done(res);
    };
    PM.result = function (t, res) {
        var cov = FINE.accountLines([t], FL.dims.accounts), kind = FINE.tplKind(t), none = 0, two = 0;
        FL.dims.accounts.forEach(function (a) { if (kind && (kind === 'PL') !== FINE.isPl(a)) return; var n = (cov[a.code] || []).length; if (!n) none++; else if (n > 1) two++; });
        FL.modal('<i class="fa-solid fa-circle-check"></i> Mapping loaded', PM.head(3) +
            '<div class="callout good"><b>' + (res.built ? 'Template "' + esc(t.name) + '" built with ' + res.lines + ' lines.' : res.moved + ' account(s) placed' + (res.created.length ? ', ' + res.created.length + ' line(s) created (' + esc(res.created.join(', ')) + ')' : '') + (res.skipped ? ', ' + res.skipped + ' skipped' : '') + '.') + '</b></div>' +
            (kind ? '<p>' + (none ? '<span class="pm-st unknown">' + none + ' account(s) of this statement in no line</span> ' : '<span class="pm-st ok">every account of this statement is in a line</span> ') + (two ? '<span class="pm-st conflict">' + two + ' in two lines</span>' : '') + '</p>' : '') +
            ((res.linked || []).length ? '<p class="sm">Added to the totals: ' + res.linked.map(function (l) { return '<b>' + esc(l.id) + '</b> in ' + esc(l.row) + ' <code>' + esc(l.formula) + '</code>'; }).join('<br>') + '</p>' : '') +
            ((res.unlinked || []).length ? '<div class="callout warn sm"><b>Add ' + res.unlinked.map(esc).join(', ') + ' to a total</b> — no formula of a line like it was found, so the totals do not include ' + (res.unlinked.length > 1 ? 'them' : 'it') + ' yet (edit the formula row, e.g. <code>… - ' + esc(res.unlinked[0]) + '</code>).</div>' : '') +
            ((res.warnings || []).length ? '<div class="callout warn sm">' + res.warnings.map(esc).join('<br>') + '</div>' : '') +
            ((res.regrouped || []).length ? '<p class="sm">Put under their main group: ' + res.regrouped.map(esc).join(', ') + '</p>' : '') +
            (!res.built && !t.simple && !(t.rows || []).some(function (r) { return r.type === 'formula'; }) ? '<div class="callout sm" style="margin-top:8px"><b>No totals yet.</b> <i>Main groups &amp; totals</i> suggests a main group for every line (Revenue, Cost of sales, Operating expenses … / Non-current assets, Current assets, Equity …) and adds the calculations — gross profit, operating profit, net profit, total assets, the balance check. You can change everything afterwards.</div>' : '') +
            '<p class="sm muted">' + (res.built ? 'Saved. It opens in the statement builder.' : 'The template is changed but <b>not saved yet</b> — check the preview, then press Save (Discard undoes it).') + '</p>',
            (!res.built && !t.simple && FL.structure ? '<button class="btn" id="pm-struct"><i class="fa-solid fa-sitemap"></i> Main groups &amp; totals</button>' : '') + '<button class="btn primary" onclick="FL.closeModal()">Done</button>');
        var sb = $('pm-struct'); if (sb) sb.onclick = function () { FL.structure.open(t, PM.done); };
    };
})();
