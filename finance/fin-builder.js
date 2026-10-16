/* Finance Lens — Statement builder: an income statement or balance sheet as main groups → sections → accounts.
   Start from the default mapping (account type + name), click a section and click accounts to put them there (or drag,
   or tick several and Move), add subtotals (Gross profit = everything above), see the amount of every line live,
   download the mapping to Excel, fill it in, upload it back (also as new templates). Many templates per statement —
   the Statements tab picks one. Compiled to template rows by FINE.simpleCompile; the advanced designer stays for the rest. */
(function () {
    var B = FL.builder = { id: FL.ls('bd.id', 'PL'), draft: null, dirty: false, active: null, filter: 'unmapped', q: '', sel: {}, exp: {} };
    var NAT_LABEL = { income: 'Income (credit +)', expense: 'Expense (debit +)', asset: 'Asset (debit +)', liability: 'Liability (credit +)', equity: 'Equity (credit +)' };
    var TYPE_LABEL = { A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' };
    var KIND_LABEL = { PL: 'Income statement', BS: 'Balance sheet' };

    B.open = function (id, filter) {
        if (B.dirty && B.draft && B.draft.id !== id && !confirm('Discard the changes to ' + B.draft.name + '?')) return;
        var t = FL.tpl(id);
        if (t && !t.simple) { FL.designer.open(id); return; }
        if (id) { B.id = id; FL.lsSet('bd.id', id); }
        B.draft = null; B.dirty = false; B.sel = {}; B.active = null;
        if (filter) B.filter = filter;
        FL.show('builder');
    };
    B.simpleList = function () { return FL.templates.filter(function (t) { return t.simple; }); };
    B.tplIds = function () { var u = {}; FL.templates.forEach(function (t) { u[t.id] = 1; }); return u; };

    /** New template: name, kind, start from the default mapping / a copy / empty */
    B.create = function (kind) {
        kind = kind === 'BS' ? 'BS' : 'PL';
        var copies = function (k) { return B.simpleList().filter(function (t) { return t.simple.kind === k; }); };
        var opts = function (k) { return copies(k).map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; }).join(''); };
        FL.modal('<i class="fa-solid fa-plus"></i> New statement template',
            '<div class="bd-form"><label>Name<input id="nt-name" value="' + (kind === 'PL' ? 'Income statement — ' : 'Balance sheet — ') + 'my layout"></label>' +
            '<label>Statement<select id="nt-kind"><option value="PL"' + (kind === 'PL' ? ' selected' : '') + '>Income statement</option><option value="BS"' + (kind === 'BS' ? ' selected' : '') + '>Balance sheet</option></select></label>' +
            '<div class="bd-start"><label><input type="radio" name="nt-from" value="def" checked> <b>Default mapping</b> — every account placed by its type and name (you change what you like)</label>' +
            '<label><input type="radio" name="nt-from" value="copy"> A copy of <select id="nt-copy">' + opts(kind) + '</select></label>' +
            '<label><input type="radio" name="nt-from" value="empty"> Empty — I build it, or upload a mapping from Excel</label></div>' +
            '<p class="sm muted">Each statement can have as many templates as you like (management, statutory, by function, a group view …); you pick one when you run the statement.</p></div>',
            '<button class="btn primary" id="nt-go"><i class="fa-solid fa-check"></i> Create</button>');
        $('nt-kind').onchange = function () { $('nt-copy').innerHTML = opts(this.value); };
        $('nt-go').onclick = function () {
            var k = $('nt-kind').value, name = $('nt-name').value.trim() || KIND_LABEL[k], from = (document.querySelector('input[name=nt-from]:checked') || {}).value;
            var s;
            if (from === 'copy' && FL.tpl($('nt-copy').value)) s = JSON.parse(JSON.stringify(FL.tpl($('nt-copy').value).simple));
            else if (from === 'empty') s = B.emptyOf(k);
            else s = FINE.simpleDefault(k, FL.dims.accounts);
            var t = FINE.simpleTemplate({ id: FINE.simpleId(name, B.tplIds()), name: name, simple: s, colset: from === 'copy' ? (FL.tpl($('nt-copy').value) || {}).colset : null });
            FL.templates.push(t);
            FL.saveTemplates().then(function () { FL.closeModal(); FL.toast('Template "' + name + '" created', 'ok'); B.open(t.id, from === 'empty' ? 'kind' : 'unmapped'); }).catch(function (e) { FL.toast(String(e), 'err'); });
        };
    };
    B.emptyOf = function (k) {
        var u = {};
        var g = function (name, nature, extra) { return { t: 'group', id: FINE.simpleId(name, u), name: name, nature: nature, sections: [{ id: FINE.simpleId(name + ' S', u), name: name, accounts: [] }].concat(extra || []) }; };
        if (k === 'PL') return { kind: 'PL', lines: [g('Revenue', 'income'), g('Expenses', 'expense'), { t: 'subtotal', id: FINE.simpleId('Net profit', u), name: 'Net profit', of: null, margin: true }] };
        return { kind: 'BS', lines: [g('Assets', 'asset'), { t: 'subtotal', id: FINE.simpleId('Total assets', u), name: 'Total assets', of: null }, g('Liabilities', 'liability'),
            g('Equity', 'equity', [{ id: FINE.simpleId('Profit for the year', u), name: 'Profit for the year to date', accounts: [], special: 'cye' }]), { t: 'subtotal', id: FINE.simpleId('Total equity and liabilities', u), name: 'Total equity and liabilities', of: null }] };
    };

    // ── the page ──
    FL.TABS.builder = {
        render: function (el) {
            var list = B.simpleList(), adv = FL.templates.filter(function (t) { return !t.simple; });
            var t = FL.tpl(B.id); if (!t || !t.simple) t = list[0];
            if (t && (!B.draft || B.draft.id !== t.id)) { B.draft = JSON.parse(JSON.stringify(t)); B.dirty = false; }
            if (!t) B.draft = null;
            var side = '<div class="side bd-side"><h4>Statement templates</h4>' +
                ['PL', 'BS'].map(function (k) {
                    var ts = list.filter(function (x) { return x.simple.kind === k; });
                    return '<div class="bd-kind">' + KIND_LABEL[k] + '</div>' + (ts.length ? ts.map(function (x) {
                        var c = FINE.simpleCheck(x.simple, FL.dims.accounts);
                        return '<div class="item' + (B.draft && x.id === B.draft.id ? ' on' : '') + '" data-t="' + esc(x.id) + '"><i class="fa-solid ' + (k === 'PL' ? 'fa-chart-line' : 'fa-building-columns') + '"></i><div>' + esc(x.name) +
                            '<small>' + c.mapped + ' acc' + (c.unmapped.length ? ' · <b class="warn-t">' + c.unmapped.length + ' not mapped</b>' : ' · all mapped') + '</small></div></div>';
                    }).join('') : '<div class="sm muted" style="padding:4px 8px">none yet</div>');
                }).join('') +
                (adv.length ? '<span class="sep"></span><div class="bd-kind">Advanced</div>' + adv.map(function (x) { return '<div class="item adv" data-adv="' + esc(x.id) + '" title="Formulas & ranges — opens the advanced designer"><i class="fa-solid fa-pen-ruler"></i><div>' + esc(x.name) + '<small>' + esc(x.id) + ' · formulas & ranges — advanced designer</small></div></div>'; }).join('') : '') +
                '<span class="grow"></span><div class="row"><button class="btn sm primary" id="bd-paste" title="Paste account + group from Excel: validate, create missing groups, load"><i class="fa-solid fa-paste"></i> Paste mapping</button><button class="btn sm" id="bd-new"><i class="fa-solid fa-plus"></i> New template</button>' +
                '<label class="btn sm" title="Excel or CSV: Template, Main group, Nature, Section, Account"><i class="fa-solid fa-file-arrow-up"></i> Upload mapping<input type="file" accept=".xlsx,.csv,.txt" id="bd-up-side" hidden></label></div>' +
                '</div>';
            el.innerHTML = '<div class="split bd-split tpltop">' + side + '<div id="bd-main"></div></div>';
            el.querySelectorAll('.bd-side .item[data-t]').forEach(function (it) { it.onclick = function () { B.open(it.dataset.t); }; });
            el.querySelectorAll('.bd-side .item[data-adv]').forEach(function (it) { it.onclick = function () { FL.designer.open(it.dataset.adv); }; });
            $('bd-new').onclick = function () { B.create(B.draft ? B.draft.simple.kind : 'PL'); };
            $('bd-paste').onclick = function () {
                if (!B.draft) { FL.pasteMap.open({ id: '', name: 'New template', type: 'PL', rows: [] }, function (res) { if (res.built) B.open(res.built.id); }); return; }
                FL.pasteMap.open(B.draft, function (res) { if (res.built) B.open(res.built.id); else B.touch(); });
            };
            $('bd-up-side').onchange = function () { var f = this.files[0]; this.value = ''; if (f) B.upload(f); };
            if (!B.draft) { $('bd-main').innerHTML = '<div class="empty"><i class="fa-solid fa-sitemap"></i>No statement template yet — press New template' + (FL.dims.accounts.length ? '' : ' (sync a trial balance first so the accounts are known)') + '.</div>'; return; }
            return FL.data().then(function (data) { B.data = data; B.main(); });
        }
    };

    /** Amount per line (YTD for the income statement, closing balance for the balance sheet) and per account */
    B.amounts = function () {
        var d = B.draft, data = B.data, kind = d.simple.kind, tpl = FINE.simpleTemplate(JSON.parse(JSON.stringify(d)));
        var col = { id: 'v', scenario: 'ACTUAL', range: kind === 'BS' ? 'BAL' : 'YTD' };
        var st = FINE.compute(tpl, data, { period: FL.filter.period, scale: FL.filter.scale, columns: [col] }), line = {};
        st.rows.forEach(function (r) { line[r.id] = r.values[0]; if (r.type === 'check') line._chk = r; });
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), w = FINE.windowOf(col, pi, FL.filter.period), fa = data.facts.ACTUAL || {}, acc = {};
        if (w) FL.dims.accounts.forEach(function (a) {
            var f = fa[a.code]; if (!f) return;
            var v = 0;
            if (kind === 'BS') v = (f[pi.list[w.end].period_seq] || [0, 0])[1]; else for (var i = Math.max(0, w.from); i <= w.to; i++) v += (f[pi.list[i].period_seq] || [0])[0];
            if (Math.abs(v) >= 0.005) acc[a.code] = v * (FINE.isCredit(a) ? -1 : 1) / (FL.filter.scale || 1);
        });
        return { line: line, acc: acc, label: FINE.colLabel(col, pi, FL.filter.period) };
    };
    var amt = function (v) { return v == null ? '' : FINE.fmt(v, 'num', { decimals: FL.filter.scale >= 1000000 ? 1 : 0 }); };

    B.main = function () {
        var box = $('bd-main'); if (!box) return;
        var keep = { tree: (box.querySelector('.bd-tree') || {}).scrollTop, accs: (box.querySelector('.bd-alist') || {}).scrollTop };
        var d = B.draft, s = d.simple, kind = s.kind, accs = FL.dims.accounts, A = B.amounts(), chk = FINE.simpleCheck(s, accs);
        var mapped = FINE.simpleMapped(s, accs), secName = {}, natOpts = kind === 'PL' ? ['income', 'expense'] : ['asset', 'liability', 'equity'];
        s.lines.forEach(function (l) { (l.sections || []).forEach(function (x) { secName[x.id] = (l.sections.length > 1 ? l.name + ' › ' : '') + x.name; }); });
        if (B.active && !secName[B.active]) B.active = null;
        var groupName = {}; s.lines.forEach(function (l) { groupName[l.id] = l; });
        var tree = s.lines.map(function (l, ix) {
            var mv = '<span class="bd-mv"><button class="icon" data-up="' + ix + '" title="Move up"' + (ix ? '' : ' disabled') + '><i class="fa-solid fa-arrow-up"></i></button><button class="icon" data-dn="' + ix + '" title="Move down"' + (ix < s.lines.length - 1 ? '' : ' disabled') + '><i class="fa-solid fa-arrow-down"></i></button>' +
                '<button class="icon" data-del="' + ix + '" title="Remove"><i class="fa-solid fa-trash-can"></i></button></span>';
            if (l.t === 'subtotal') {
                var of = FINE.simpleOf(s, ix);
                var txt = of.map(function (id, i) { var g = groupName[id] || { name: id }, neg = kind === 'PL' && g.nature === 'expense'; return (i ? (neg ? ' − ' : ' + ') : neg ? '− ' : '') + g.name; }).join('') || 'nothing above yet';
                return '<div class="bd-st"><span class="bd-eq">=</span><input class="bd-in b" data-l="' + ix + '" data-f="name" value="' + esc(l.name) + '">' +
                    '<a class="bd-of sm" data-of="' + ix + '" title="Choose what this subtotal adds up">' + esc(txt) + (l.of && l.of.length ? '' : ' <span class="muted">(automatic)</span>') + '</a>' +
                    (kind === 'PL' ? '<label class="sm muted"><input type="checkbox" data-mg="' + ix + '"' + (l.margin ? ' checked' : '') + '> margin %</label>' : '') +
                    '<span class="grow"></span><span class="bd-amt b">' + amt(A.line[l.id]) + '</span>' + mv + '</div>';
            }
            var one = l.sections.length === 1 && !l.sections[0].special;
            return '<div class="bd-g"><div class="bd-gh"><i class="fa-solid fa-folder-open muted"></i><input class="bd-in b" data-l="' + ix + '" data-f="name" value="' + esc(l.name) + '">' +
                '<select class="bd-nat" data-l="' + ix + '" title="Nature: which side shows as positive">' + natOpts.concat(natOpts.indexOf(l.nature) < 0 ? [l.nature] : []).map(function (n) { return '<option value="' + n + '"' + (l.nature === n ? ' selected' : '') + '>' + NAT_LABEL[n] + '</option>'; }).join('') + '</select>' +
                '<span class="grow"></span><span class="bd-amt b">' + amt(A.line[l.id]) + '</span>' + mv + '</div>' +
                l.sections.map(function (x, j) {
                    var codes = x.special ? [] : (x.accounts || []), sum = one ? A.line[l.id] : A.line[x.id], isOpen = B.exp[x.id];
                    return '<div class="bd-s' + (B.active === x.id ? ' active' : '') + (x.special ? ' special' : '') + '" data-sec="' + esc(x.id) + '">' +
                        '<div class="bd-sh"><button class="icon bd-exp" data-exp="' + esc(x.id) + '" title="Show the accounts"><i class="fa-solid fa-chevron-' + (isOpen ? 'down' : 'right') + '"></i></button>' +
                        '<input class="bd-in" data-l="' + ix + '" data-s="' + j + '" data-f="sname" value="' + esc(x.name) + '">' +
                        (x.special ? '<span class="tag">profit for the year — automatic</span>' : '<span class="bd-cnt" title="Accounts in this section">' + codes.length + (x.match ? ' + rule' : '') + '</span>') +
                        '<span class="grow"></span><span class="bd-amt">' + amt(sum) + '</span>' +
                        '<span class="bd-mv"><button class="icon" data-sup="' + ix + ':' + j + '" title="Move up"' + (j ? '' : ' disabled') + '><i class="fa-solid fa-arrow-up"></i></button><button class="icon" data-sdn="' + ix + ':' + j + '" title="Move down"' + (j < l.sections.length - 1 ? '' : ' disabled') + '><i class="fa-solid fa-arrow-down"></i></button>' +
                        '<button class="icon" data-sdel="' + ix + ':' + j + '" title="Remove the section (its accounts become not mapped)"><i class="fa-solid fa-xmark"></i></button></span></div>' +
                        (isOpen && !x.special ? '<div class="bd-chips">' + (codes.length ? codes.map(function (c) { var a = (FL.dims.accounts.filter(function (z) { return z.code === c; })[0]) || { name: '(not synced)' };
                            return '<span class="bd-chip" title="' + esc(a.name) + '">' + esc(c) + ' <span class="muted">' + esc(String(a.name || '').slice(0, 28)) + '</span> <span class="bd-amt">' + amt(A.acc[c]) + '</span><a data-rm="' + esc(x.id) + '|' + esc(c) + '" title="Take it out">×</a></span>'; }).join('') : '<span class="sm muted">No accounts — click this section, then click accounts on the right.</span>') +
                            '<label class="sm muted bd-rule">Also every account matching <input data-match="' + ix + ':' + j + '" value="' + esc(x.match || '') + '" placeholder="e.g. 5011*, 5020-5099, !5050"></label></div>' : '') +
                        '</div>';
                }).join('') +
                '<button class="btn sm ghost bd-adds" data-adds="' + ix + '"><i class="fa-solid fa-plus"></i> Section</button>' + '</div>';
        }).join('');
        // accounts panel
        var q = B.q.toLowerCase(), pool = accs.filter(function (a) {
            if (B.filter === 'unmapped' && (mapped[a.code] || FINE.simpleKindOf(a) !== kind)) return false;
            if (B.filter === 'kind' && FINE.simpleKindOf(a) !== kind) return false;
            if (B.filter === 'twice' && !(mapped[a.code] && mapped[a.code].length > 1)) return false;
            return !q || (a.code + ' ' + (a.name || '') + ' ' + (a.class || '')).toLowerCase().indexOf(q) >= 0;
        });
        var shown = pool.slice(0, 600), nSel = Object.keys(B.sel).filter(function (c) { return B.sel[c]; }).length;
        var accHtml = shown.map(function (a) {
            var where = mapped[a.code] ? mapped[a.code].map(function (id) { return secName[id] || id; }).join(' + ') : '';
            return '<div class="bd-a' + (B.sel[a.code] ? ' sel' : '') + (where ? '' : ' none') + '" draggable="true" data-c="' + esc(a.code) + '"><input type="checkbox" data-ck="' + esc(a.code) + '"' + (B.sel[a.code] ? ' checked' : '') + '>' +
                '<span class="mono">' + esc(a.code) + '</span><span class="nm">' + esc(a.name || '') + '<small>' + esc(TYPE_LABEL[a.account_type] || a.account_type || '?') + (a.typeGuess ? ' (guessed)' : '') + (a.class ? ' · ' + esc(a.class) : '') +
                (where ? ' · <b>' + esc(where) + '</b>' : ' · <i>not mapped</i>') + '</small></span><span class="bd-amt">' + amt(A.acc[a.code]) + '</span></div>';
        }).join('');
        var chkRow = A.line._chk, actName = B.active ? secName[B.active] : '';
        box.innerHTML = '<div class="bd-top"><input id="bd-name" class="bd-title" value="' + esc(d.name) + '"><span class="tag">' + KIND_LABEL[kind] + '</span>' +
            '<label class="sm">Columns <select id="bd-cols">' + FINE.COLSETS[kind].map(function (c) { return '<option value="' + c.id + '"' + ((d.colset || FINE.COLSETS[kind][0].id) === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></label>' +
            '<span class="grow"></span>' +
            '<button class="btn sm" id="bd-view" title="Save and open this statement"><i class="fa-solid fa-eye"></i> View statement</button>' +
            '<button class="btn primary sm" id="bd-save"' + (B.dirty ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> ' + (B.dirty ? 'Save changes' : 'Saved') + '</button></div>' +
            '<div class="bd-tools">' +
            '<button class="btn sm" id="bd-auto"' + (chk.unmapped.length ? '' : ' disabled') + ' title="Put every account that is not mapped next to accounts of the same type and class"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-place ' + chk.unmapped.length + '</button>' +
            '<button class="btn sm" id="bd-reset" title="Start again from the default mapping (account type + name)"><i class="fa-solid fa-rotate-left"></i> Default mapping</button>' +
            '<button class="btn sm" id="bd-dl" title="Excel with every account: fill in Main group / Section for the empty rows, then upload"><i class="fa-solid fa-file-excel"></i> Download mapping</button>' +
            '<button class="btn sm" id="bd-csv" title="The same as CSV"><i class="fa-solid fa-file-csv"></i></button>' +
            '<label class="btn sm"><i class="fa-solid fa-file-arrow-up"></i> Upload mapping<input type="file" accept=".xlsx,.csv,.txt" id="bd-up" hidden></label>' +
            '<button class="btn sm" id="bd-dup"><i class="fa-regular fa-copy"></i> Duplicate</button>' +
            '<button class="btn sm" id="bd-del"><i class="fa-solid fa-trash-can"></i> Delete</button>' +
            '<button class="btn sm ghost" id="bd-adv" title="Formulas, ranges, styles and columns one by one — turns this into an advanced template"><i class="fa-solid fa-pen-ruler"></i> Advanced</button></div>' +
            '<div class="bd-stats">' +
            '<span class="tag ' + (chk.unmapped.length ? 'bad' : 'good') + '">' + (chk.unmapped.length ? '✗ ' + chk.unmapped.length + ' ' + (kind === 'PL' ? 'income / expense' : 'balance sheet') + ' account(s) not mapped' : '✓ every ' + (kind === 'PL' ? 'income and expense' : 'balance sheet') + ' account is mapped') + '</span>' +
            (chk.twice.length ? '<span class="tag bad">✗ ' + chk.twice.length + ' in two sections</span>' : '') +
            (chkRow ? '<span class="tag ' + (chkRow.ok ? 'good' : 'bad') + '">' + (chkRow.ok ? '✓ assets = equity + liabilities' : '✗ out of balance by ' + amt(chkRow.values[0])) + '</span>' : '') +
            (s.auto ? '<span class="tag" title="Accounts are placed by their type, name and class each time the data is refreshed — change anything and the mapping is yours">default mapping · follows the chart of accounts</span>' : '') +
            '<span class="sm muted">Amounts: ' + esc(A.label) + ' · ' + esc(FL.filterText()) + ' · ' + FL.scaleLabel() + '</span></div>' +
            '<div class="bd-grid"><div class="bd-tree">' + tree +
            '<div class="row" style="margin-top:8px"><button class="btn sm" id="bd-addg"><i class="fa-solid fa-folder-plus"></i> Main group</button><button class="btn sm" id="bd-addt"><i class="fa-solid fa-equals"></i> Subtotal</button></div></div>' +
            '<div class="bd-accs"><div class="bd-ah"><div class="seg" id="bd-flt">' + [['unmapped', 'Not mapped (' + chk.unmapped.length + ')'], ['kind', kind === 'PL' ? 'Income & expense' : 'Balance sheet'], ['twice', 'In two (' + chk.twice.length + ')'], ['all', 'All']].map(function (x) { return '<button data-f="' + x[0] + '" class="' + (B.filter === x[0] ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' +
            '<input id="bd-q" placeholder="Search code, name or class" value="' + esc(B.q) + '"></div>' +
            '<div class="bd-target">' + (B.active ? '<i class="fa-solid fa-bullseye"></i> Click an account to put it in <b>' + esc(actName) + '</b>' + (nSel ? ' · <button class="btn sm primary" id="bd-move">Move ' + nSel + ' ticked here</button>' : '') + ' · <a id="bd-unact">done</a>'
                : '<i class="fa-solid fa-hand-pointer"></i> Click a section on the left, then click accounts here to put them in it — or drag accounts onto a section.') + '</div>' +
            '<div class="row sm" style="margin:4px 0"><a id="bd-all">tick all ' + shown.length + '</a> · <a id="bd-none">untick</a>' + (pool.length > shown.length ? '<span class="muted"> · first 600 of ' + pool.length + ' — search to narrow</span>' : '') + '</div>' +
            '<div class="bd-alist">' + (accHtml || '<div class="empty sm">' + (B.filter === 'unmapped' ? '✓ Nothing left to map.' : 'No accounts.') + '</div>') + '</div></div></div>';
        if (keep.tree) box.querySelector('.bd-tree').scrollTop = keep.tree;
        if (keep.accs) box.querySelector('.bd-alist').scrollTop = keep.accs;
        B.wire(box);
    };

    B.touch = function () { B.dirty = true; delete B.draft.simple.auto; B.main(); };
    B.sec = function (id) { var r = null; B.draft.simple.lines.forEach(function (l) { (l.sections || []).forEach(function (x) { if (x.id === id) r = x; }); }); return r; };
    B.assign = function (codes, secId) {
        var x = B.sec(secId); if (!x || x.special || !codes.length) return;
        B.draft.simple.lines.forEach(function (l) { (l.sections || []).forEach(function (y) { if (y.accounts) y.accounts = y.accounts.filter(function (c) { return codes.indexOf(c) < 0; }); }); });
        x.accounts = (x.accounts || []).concat(codes).sort();
        codes.forEach(function (c) { delete B.sel[c]; });
        B.touch();
    };
    B.wire = function (box) {
        var d = B.draft, s = d.simple, q = function (sel) { return box.querySelector(sel); };
        var swap = function (arr, i, j) { var t = arr[i]; arr[i] = arr[j]; arr[j] = t; };
        q('#bd-name').onchange = function () { d.name = this.value.trim() || d.name; B.touch(); };
        q('#bd-cols').onchange = function () { d.colset = this.value; B.touch(); };
        box.querySelectorAll('.bd-in').forEach(function (inp) {
            inp.onclick = function (e) { e.stopPropagation(); };
            inp.onchange = function () {
                var l = s.lines[+inp.dataset.l], v = inp.value.trim(); if (!v) { inp.value = inp.defaultValue; return; }
                if (inp.dataset.f === 'name') l.name = v; else l.sections[+inp.dataset.s].name = v;
                B.touch();
            };
            inp.onkeydown = function (e) { if (e.key === 'Enter') inp.blur(); };
        });
        box.querySelectorAll('.bd-nat').forEach(function (sel) { sel.onclick = function (e) { e.stopPropagation(); }; sel.onchange = function () { s.lines[+sel.dataset.l].nature = sel.value; B.touch(); }; });
        box.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.up; swap(s.lines, i, i - 1); B.touch(); }; });
        box.querySelectorAll('[data-dn]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.dn; swap(s.lines, i, i + 1); B.touch(); }; });
        box.querySelectorAll('[data-del]').forEach(function (b) {
            b.onclick = function () {
                var i = +b.dataset.del, l = s.lines[i], n = (l.sections || []).reduce(function (k, x) { return k + (x.accounts || []).length; }, 0);
                if (n && !confirm('Remove "' + l.name + '"? Its ' + n + ' account(s) become not mapped.')) return;
                s.lines.forEach(function (z) { if (z.of) z.of = z.of.filter(function (id) { return id !== l.id; }); });
                s.lines.splice(i, 1); B.touch();
            };
        });
        var ij = function (v) { var p = v.split(':'); return [+p[0], +p[1]]; };
        box.querySelectorAll('[data-sup]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var p = ij(b.dataset.sup); swap(s.lines[p[0]].sections, p[1], p[1] - 1); B.touch(); }; });
        box.querySelectorAll('[data-sdn]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var p = ij(b.dataset.sdn); swap(s.lines[p[0]].sections, p[1], p[1] + 1); B.touch(); }; });
        box.querySelectorAll('[data-sdel]').forEach(function (b) {
            b.onclick = function (e) {
                e.stopPropagation(); var p = ij(b.dataset.sdel), l = s.lines[p[0]], x = l.sections[p[1]];
                if ((x.accounts || []).length && !confirm('Remove the section "' + x.name + '"? Its ' + x.accounts.length + ' account(s) become not mapped.')) return;
                l.sections.splice(p[1], 1); B.touch();
            };
        });
        box.querySelectorAll('[data-adds]').forEach(function (b) {
            b.onclick = function () {
                var l = s.lines[+b.dataset.adds], name = prompt('Name of the new section in "' + l.name + '":', 'New section'); if (!name) return;
                var x = { id: FINE.simpleId(name, FINE.simpleIds(s)), name: name.trim(), accounts: [] };
                l.sections.push(x); B.active = x.id; B.touch();
            };
        });
        box.querySelectorAll('[data-exp]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); B.exp[b.dataset.exp] = !B.exp[b.dataset.exp]; B.main(); }; });
        box.querySelectorAll('[data-rm]').forEach(function (a) { a.onclick = function (e) { e.stopPropagation(); var p = a.dataset.rm.split('|'), x = B.sec(p[0]); x.accounts = x.accounts.filter(function (c) { return c !== p[1]; }); B.touch(); }; });
        box.querySelectorAll('[data-match]').forEach(function (inp) { inp.onclick = function (e) { e.stopPropagation(); }; inp.onchange = function () { var p = ij(inp.dataset.match); s.lines[p[0]].sections[p[1]].match = inp.value.trim(); B.touch(); }; });
        box.querySelectorAll('[data-mg]').forEach(function (c) { c.onchange = function () { s.lines[+c.dataset.mg].margin = c.checked; B.touch(); }; });
        box.querySelectorAll('[data-of]').forEach(function (a) { a.onclick = function () { B.chooseOf(+a.dataset.of); }; });
        // sections: click = target, drop = assign
        box.querySelectorAll('.bd-s').forEach(function (el) {
            el.onclick = function () { if (el.classList.contains('special')) { FL.toast('The profit for the year is worked out from every income and expense account', ''); return; } B.active = B.active === el.dataset.sec ? null : el.dataset.sec; B.main(); };
            el.ondragover = function (e) { if (!el.classList.contains('special')) { e.preventDefault(); el.classList.add('drop'); } };
            el.ondragleave = function () { el.classList.remove('drop'); };
            el.ondrop = function (e) { e.preventDefault(); el.classList.remove('drop'); var codes = (e.dataTransfer.getData('text/plain') || '').split('\n').filter(Boolean); B.assign(codes, el.dataset.sec); };
        });
        // accounts
        box.querySelectorAll('.bd-a').forEach(function (el) {
            el.onclick = function (e) {
                if (e.target.tagName === 'INPUT') return;
                if (!B.active) { FL.toast('Click a section on the left first — then every account you click goes there', ''); return; }
                B.assign([el.dataset.c], B.active);
            };
            el.ondragstart = function (e) {
                var codes = B.sel[el.dataset.c] ? Object.keys(B.sel).filter(function (c) { return B.sel[c]; }) : [el.dataset.c];
                e.dataTransfer.setData('text/plain', codes.join('\n')); e.dataTransfer.effectAllowed = 'move';
            };
        });
        box.querySelectorAll('[data-ck]').forEach(function (c) { c.onchange = function () { B.sel[c.dataset.ck] = c.checked; B.main(); }; });
        if (q('#bd-move')) q('#bd-move').onclick = function () { B.assign(Object.keys(B.sel).filter(function (c) { return B.sel[c]; }), B.active); };
        if (q('#bd-unact')) q('#bd-unact').onclick = function () { B.active = null; B.main(); };
        q('#bd-all').onclick = function () { box.querySelectorAll('.bd-a').forEach(function (el) { B.sel[el.dataset.c] = true; }); B.main(); };
        q('#bd-none').onclick = function () { B.sel = {}; B.main(); };
        box.querySelectorAll('#bd-flt button').forEach(function (b) { b.onclick = function () { B.filter = b.dataset.f; B.main(); }; });
        q('#bd-q').oninput = function () { B.q = this.value; clearTimeout(B.qt); B.qt = setTimeout(function () { B.main(); var i = $('bd-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200); };
        q('#bd-addg').onclick = function () {
            var name = prompt('Name of the main group:', s.kind === 'PL' ? 'Other operating expenses' : 'Other current assets'); if (!name) return;
            var used = FINE.simpleIds(s), g = { t: 'group', id: FINE.simpleId(name, used), name: name.trim(), nature: s.kind === 'PL' ? 'expense' : 'asset', sections: [] };
            g.sections.push({ id: FINE.simpleId(name + ' S', used), name: name.trim(), accounts: [] });
            var at = s.lines.length; for (var i = s.lines.length - 1; i >= 0; i--) if (s.lines[i].t === 'subtotal') { at = i; break; }
            s.lines.splice(at, 0, g); B.active = g.sections[0].id; B.touch();
        };
        q('#bd-addt').onclick = function () {
            var name = prompt('Name of the subtotal (it adds up the groups above it — change that by clicking its description):', s.kind === 'PL' ? 'Operating profit' : 'Total liabilities'); if (!name) return;
            s.lines.push({ t: 'subtotal', id: FINE.simpleId(name, FINE.simpleIds(s)), name: name.trim(), of: null }); B.touch();
        };
        q('#bd-auto').onclick = function () { var c = FINE.simpleCheck(s, FL.dims.accounts), n = FINE.simplePlace(s, FL.dims.accounts, c.unmapped.map(function (a) { return a.code; })); FL.toast(n + ' account(s) placed by type and class — check them', 'ok'); B.touch(); };
        q('#bd-reset').onclick = function () { if (!confirm('Replace this layout with the default mapping (account type + name)? Save afterwards to keep it.')) return; d.simple = FINE.simpleDefault(s.kind, FL.dims.accounts); B.dirty = true; B.main(); };
        q('#bd-dl').onclick = function () { B.download('xlsx'); };
        q('#bd-csv').onclick = function () { B.download('csv'); };
        q('#bd-up').onchange = function () { var f = this.files[0]; this.value = ''; if (f) B.upload(f); };
        q('#bd-save').onclick = function () { B.save(); };
        q('#bd-view').onclick = function () { (B.dirty ? B.save() : Promise.resolve()).then(function () { FL.stmt.go(s.kind, d.id); }); };
        q('#bd-dup').onclick = function () {
            var name = prompt('Name of the copy:', d.name + ' (copy)'); if (!name) return;
            var t = FINE.simpleTemplate(Object.assign(JSON.parse(JSON.stringify(d)), { id: FINE.simpleId(name, B.tplIds()), name: name.trim() }));
            FL.templates.push(t); FL.saveTemplates().then(function () { B.dirty = false; B.open(t.id); });
        };
        q('#bd-del').onclick = function () {
            var uses = /^(PL|BS)$/.test(d.id) ? ' KPIs, monitors and the board pack use ' + d.id + '.… — they stop working until another template gets that id.' : '';
            if (!confirm('Delete the template "' + d.name + '"?' + uses)) return;
            FL.templates = FL.templates.filter(function (x) { return x.id !== d.id; });
            FL.saveTemplates().then(function () { B.dirty = false; B.draft = null; B.id = (B.simpleList()[0] || {}).id; FL.render(); });
        };
        q('#bd-adv').onclick = function () {
            if (B.dirty) { FL.toast('Save first', 'err'); return; }
            if (!confirm('Open "' + d.name + '" in the advanced designer? Saving it there turns it into an advanced template (formulas and ranges row by row) — this builder no longer edits it.')) return;
            FL.designer.open(d.id);
        };
    };
    /** What a subtotal adds up: automatic (PL everything above; BS the groups since the last subtotal) or chosen groups */
    B.chooseOf = function (ix) {
        var s = B.draft.simple, l = s.lines[ix], auto = !(l.of && l.of.length), cur = FINE.simpleOf(s, ix);
        FL.modal('<i class="fa-solid fa-equals"></i> ' + esc(l.name),
            '<label><input type="checkbox" id="of-auto"' + (auto ? ' checked' : '') + '> Automatic — ' + (s.kind === 'PL' ? 'everything above it (income +, expenses −)' : 'the groups since the previous subtotal') + '</label>' +
            '<div id="of-list" style="margin:10px 0 0 22px">' + s.lines.filter(function (x) { return x.t === 'group'; }).map(function (g) {
                return '<label style="display:block;margin:3px 0"><input type="checkbox" value="' + esc(g.id) + '"' + (cur.indexOf(g.id) >= 0 ? ' checked' : '') + '> ' + esc(g.name) + ' <span class="muted sm">' + (s.kind === 'PL' ? (g.nature === 'expense' ? '(−)' : '(+)') : '') + '</span></label>';
            }).join('') + '</div>',
            '<button class="btn primary" id="of-ok">OK</button>');
        var sync = function () { $('of-list').style.opacity = $('of-auto').checked ? 0.45 : 1; };
        $('of-auto').onchange = sync; sync();
        $('of-ok').onclick = function () {
            l.of = $('of-auto').checked ? null : Array.prototype.map.call(document.querySelectorAll('#of-list input:checked'), function (c) { return c.value; });
            FL.closeModal(); B.touch();
        };
    };
    B.save = function () {
        var d = B.draft;
        FINE.simpleTemplate(d);
        var i = FL.templates.map(function (x) { return x.id; }).indexOf(d.id), copy = JSON.parse(JSON.stringify(d));
        if (i >= 0) FL.templates[i] = copy; else FL.templates.push(copy);
        return FL.saveTemplates().then(function () { B.dirty = false; FL.templatesSaved = true; FL.toast('Template "' + d.name + '" saved', 'ok'); if (FL.tab === 'builder') FL.render(); })
            .catch(function (e) { FL.toast(String(e), 'err'); throw e; });
    };

    // ── download / upload ──
    B.rows = function () { return FINE.simpleToRows(FINE.simpleTemplate(JSON.parse(JSON.stringify(B.draft))), FL.dims.accounts); };
    B.download = function (fmt) {
        var rows = B.rows(), A = B.amounts(), d = B.draft, cols = ['Template', 'Main group', 'Nature', 'Section', 'Account', 'Account name', 'Type', 'Amount (' + A.label + ')'];
        var vals = rows.map(function (r) { return [r.template, r.group, r.nature, r.section, r.account, r.name, TYPE_LABEL[r.type] || r.type, r.account && A.acc[r.account] != null ? Math.round(A.acc[r.account] * 100) / 100 : null]; });
        var file = (d.name || 'mapping').replace(/[^\w -]+/g, '') + ' mapping';
        if (fmt === 'csv' || !window.ExcelJS) { FL.csv(file + '.csv', cols, vals); return; }
        var wb = new ExcelJS.Workbook(); wb.creator = 'Finance Lens';
        var ws = wb.addWorksheet('Mapping');
        var hr = ws.addRow(cols); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13315C' } }; });
        vals.forEach(function (v, i) {
            var row = ws.addRow(v), r = rows[i];
            if (!r.group) row.eachCell({ includeEmpty: true }, function (c, n) { if (n <= 8) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; });
            if (r.nature === 'subtotal') row.font = { bold: true, italic: true };
            row.getCell(8).numFmt = '#,##0.00;(#,##0.00);"–"';
        });
        [22, 30, 11, 34, 14, 40, 10, 16].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: 'A1', to: 'H1' };
        var how = wb.addWorksheet('How to fill');
        [['How to fill the mapping'], [''], ['One row per account, in the order the statement shows them.'], ['Main group — the heading (Revenue, Cost of sales, Operating expenses …). Rows with the same main group go together.'],
            ['Section — the line inside the main group (Staff costs, Rent …). Leave it empty and the main group is one line.'], ['Nature — ' + (d.simple.kind === 'PL' ? 'income or expense' : 'asset, liability or equity') + ' (which side shows as positive). Empty = from the account type.'],
            ['Account — the natural account value. A rule works too: 5011*, 5020-5099, !5050.'], ['Subtotal — a row with Nature = subtotal and the name in Main group (e.g. Gross profit): it adds up the groups above it.'],
            ['Template — several templates in one file make several templates; the name decides which one.'], [''], ['Yellow rows are accounts that are not mapped yet: fill in Main group and Section, then Upload mapping.']]
            .forEach(function (r, i) { var x = how.addRow(r); if (!i) x.font = { bold: true, size: 14 }; });
        how.getColumn(1).width = 120;
        wb.xlsx.writeBuffer().then(function (buf) { FL.download(file + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
    /** CSV text → rows (objects by header); separator , ; or tab; quotes; BOM */
    B.parseCsv = function (text) {
        text = String(text).replace(/^﻿/, '');
        var first = text.split(/\r?\n/)[0] || '', sep = [',', ';', '\t'].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
        var rows = [], row = [], cell = '', inQ = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; continue; }
            if (ch === '"') inQ = true;
            else if (ch === sep) { row.push(cell); cell = ''; }
            else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
            else cell += ch;
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        var head = rows.shift() || [];
        return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); }).map(function (r) { var o = {}; head.forEach(function (h, i) { o[String(h).trim()] = r[i] == null ? '' : r[i]; }); return o; });
    };
    B.readFile = function (f) {
        if (/\.xlsx$/i.test(f.name)) {
            if (!window.ExcelJS) return Promise.reject('The Excel library did not load (internet?) — save the sheet as CSV.');
            return f.arrayBuffer().then(function (buf) { var wb = new ExcelJS.Workbook(); return wb.xlsx.load(buf).then(function () {
                var ws = wb.getWorksheet('Mapping') || wb.worksheets[0], head = [], out = [];
                ws.eachRow(function (row, n) {
                    var vals = []; row.eachCell({ includeEmpty: true }, function (c, i) { vals[i - 1] = c.text == null ? '' : String(c.text); });
                    if (n === 1) { head = vals; return; }
                    var o = {}; head.forEach(function (h, i) { o[String(h || '').trim()] = vals[i] == null ? '' : vals[i]; }); out.push(o);
                });
                return out;
            }); });
        }
        return f.text().then(B.parseCsv);
    };
    /** Keeps the ids of groups / sections / subtotals with the same name (KPIs keep working) */
    B.keepIds = function (fresh, old) {
        var byName = {}, used = {};
        (old.lines || []).forEach(function (l) { byName['L|' + l.name.toLowerCase()] = l.id; (l.sections || []).forEach(function (x) { byName['S|' + l.name.toLowerCase() + '|' + x.name.toLowerCase()] = x.id; }); });
        var pick = function (key, name) { var id = byName[key]; if (id && !used[id]) { used[id] = 1; used['H_' + id] = 1; return id; } return FINE.simpleId(name, used); };
        fresh.lines.forEach(function (l) { l.id = pick('L|' + l.name.toLowerCase(), l.name); });
        fresh.lines.forEach(function (l) { (l.sections || []).forEach(function (x) { x.id = pick('S|' + l.name.toLowerCase() + '|' + x.name.toLowerCase(), x.name === l.name ? l.name + ' S' : x.name); }); });
        return fresh;
    };
    B.upload = function (f) {
        B.readFile(f).then(function (rows) {
            var cur = B.draft, res = FINE.simpleFromRows(rows, FL.dims.accounts, cur ? cur.name : f.name.replace(/\.\w+$/, ''));
            if (!res.templates.length) { FL.toast('No mapping rows found — the file needs the columns Main group, Section and Account', 'err'); return; }
            B.pending = res;
            var one = res.templates.length === 1 && cur && res.templates[0].simple.kind === cur.simple.kind;
            FL.modal('<i class="fa-solid fa-file-arrow-up"></i> Upload mapping · ' + esc(f.name),
                '<table class="t"><thead><tr><th>Template</th><th>Statement</th><th class="n">Main groups</th><th class="n">Sections</th><th class="n">Accounts</th><th class="n">Not mapped</th></tr></thead><tbody>' +
                res.templates.map(function (t) {
                    var g = t.simple.lines.filter(function (l) { return l.t === 'group'; }), c = FINE.simpleCheck(t.simple, FL.dims.accounts);
                    return '<tr><td>' + esc(t.name) + (FL.templates.some(function (x) { return x.name === t.name; }) ? ' <span class="tag">exists</span>' : '') + '</td><td>' + KIND_LABEL[t.simple.kind] + '</td><td class="n">' + g.length + '</td><td class="n">' + g.reduce(function (k, l) { return k + l.sections.length; }, 0) + '</td><td class="n">' + c.mapped + '</td><td class="n">' + c.unmapped.length + '</td></tr>';
                }).join('') + '</tbody></table>' +
                (res.warnings.length ? '<div class="callout warn sm" style="margin-top:8px">' + res.warnings.slice(0, 12).map(esc).join('<br>') + (res.warnings.length > 12 ? '<br>… ' + (res.warnings.length - 12) + ' more' : '') + '</div>' : '') +
                '<p class="sm muted">Templates with the same name are replaced (their line ids stay, so KPIs keep working); the others are added.</p>',
                (one ? '<button class="btn" id="up-cur"><i class="fa-solid fa-arrows-rotate"></i> Replace the mapping of "' + esc(cur.name) + '"</button>' : '') +
                '<button class="btn primary" id="up-new"><i class="fa-solid fa-check"></i> ' + (res.templates.length > 1 ? 'Save these ' + res.templates.length + ' templates' : 'Save as template "' + esc(res.templates[0].name) + '"') + '</button>');
            if ($('up-cur')) $('up-cur').onclick = function () { cur.simple = B.keepIds(res.templates[0].simple, cur.simple); FL.closeModal(); B.save().then(function () { B.draft = null; FL.render(); }); };
            $('up-new').onclick = function () {
                var last = null;
                res.templates.forEach(function (t) {
                    var ex = FL.templates.filter(function (x) { return x.name === t.name && x.simple; })[0];
                    if (ex) { ex.simple = B.keepIds(t.simple, ex.simple); FINE.simpleTemplate(ex); last = ex; }
                    else { last = FINE.simpleTemplate({ id: FINE.simpleId(t.name, B.tplIds()), name: t.name, simple: t.simple }); FL.templates.push(last); }
                });
                FL.saveTemplates().then(function () { FL.closeModal(); FL.toast(res.templates.length + ' template(s) saved', 'ok'); B.dirty = false; B.open(last.id); });
            };
        }).catch(function (e) { FL.toast('Could not read the file: ' + (e.message || e), 'err'); });
    };
})();
