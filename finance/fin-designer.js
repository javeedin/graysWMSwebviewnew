/* Finance Lens — Template designer: statement layouts as data. Rows: header, accounts (ranges / lists / wildcards,
   basis, sign), group (sums its children), formula (row ids, + − × ÷, PCT, DIV, IF …), check (must be nil), blank, text;
   styles, indent, format, favourable direction. Columns: scenario × range × anchor, variances, % of a row; presets.
   Coverage: accounts that no row picks up, accounts picked up twice. Live preview on the current data. */
(function () {
    var D = FL.designer = { cur: FL.ls('dz.cur', 'PL'), draft: null, sel: -1, dirty: false };
    var TYPES = [['header', 'Header'], ['accounts', 'Accounts'], ['group', 'Group (sum)'], ['formula', 'Formula'], ['check', 'Check'], ['blank', 'Blank'], ['text', 'Text']];
    var RANGES = [['MTD', 'Month'], ['QTD', 'Quarter to date'], ['YTD', 'Year to date'], ['LTM', 'Last 12 months'], ['FY', 'Full year'], ['BAL', 'Balance (closing)'], ['OPEN', 'Opening balance']];
    var ATS = [['CUR', 'This period'], ['PM', 'Previous month'], ['PQ', '3 months back'], ['PY', 'Same period last year'], ['PYE', 'Last year end']];
    var PRESETS = {
        mgmt: { label: 'Month & YTD vs budget and last year', cols: function () { return JSON.parse(JSON.stringify(FIN_SEED.templates[0].columns)); } },
        yoy: { label: 'This year vs last year (YTD)', cols: function () { return [{ id: 'cy', range: 'YTD' }, { id: 'py', range: 'YTD', at: 'PY' }, { id: 'ch', kind: 'var', a: 'cy', b: 'py', label: 'Change' }, { id: 'chp', kind: 'var', a: 'cy', b: 'py', mode: 'pct', label: 'Change %' }]; } },
        bal: { label: 'Balance now · last month · year end', cols: function () { return [{ id: 'cur', range: 'BAL' }, { id: 'pm', range: 'BAL', at: 'PM' }, { id: 'pye', range: 'BAL', at: 'PYE' }, { id: 'ch', kind: 'var', a: 'cur', b: 'pye', label: 'Change vs YE' }]; } },
        trend: { label: '12-month trend', cols: function () { var c = []; for (var i = 11; i >= 0; i--) c.push({ id: 'm' + i, range: 'MTD', at: i ? 'M-' + i : 'CUR' }); return c; } },
        qtr: { label: 'Quarter, YTD, full-year budget', cols: function () { return [{ id: 'q', range: 'QTD' }, { id: 'qb', range: 'QTD', scenario: 'BUDGET' }, { id: 'qv', kind: 'var', a: 'q', b: 'qb', label: 'Var F/(U)' }, { id: 'y', range: 'YTD' }, { id: 'fyb', range: 'FY', scenario: 'BUDGET' }, { id: 'u', kind: 'pctof', of: 'y', row: '', label: '% of …' }]; } }
    };

    D.open = function (id) { D.cur = id; D.draft = null; FL.show('designer'); };

    FL.TABS.designer = {
        render: function (el) {
            var tpl = FL.tpl(D.cur) || FL.templates[0];
            if (!D.draft || D.draft.id !== (tpl && tpl.id) && !D.isNew) { D.draft = tpl ? JSON.parse(JSON.stringify(tpl)) : null; D.dirty = false; D.isNew = false; D.sel = -1; }
            el.innerHTML = '<div class="split"><div class="side"><h4>Templates</h4>' +
                FL.templates.map(function (t) { return '<div class="item' + (D.draft && t.id === D.draft.id ? ' on' : '') + '" data-t="' + esc(t.id) + '"><i class="fa-solid ' + ({ PL: 'fa-chart-line', BS: 'fa-scale-balanced', CF: 'fa-money-bill-transfer' }[t.type] || 'fa-file-lines') + '"></i><div>' + esc(t.name) + '<small>' + esc(t.id) + ' · ' + t.rows.length + ' rows</small></div></div>'; }).join('') +
                '<div class="row" style="margin-top:8px"><button class="btn sm" id="dz-new"><i class="fa-solid fa-plus"></i> New</button><button class="btn sm" id="dz-dup"><i class="fa-regular fa-copy"></i> Copy</button></div>' +
                '<div class="row"><button class="btn sm" id="dz-exp"><i class="fa-solid fa-file-export"></i> Export</button><label class="btn sm"><i class="fa-solid fa-file-import"></i> Import<input type="file" accept=".json" id="dz-imp" hidden></label></div>' +
                '<button class="btn sm ghost" id="dz-reset" title="Put back the four starter templates (your own templates stay)"><i class="fa-solid fa-rotate-left"></i> Restore starters</button></div><div id="dz-main"></div></div>';
            el.querySelectorAll('.side .item').forEach(function (it) { it.onclick = function () { if (D.dirty && !confirm('Discard the changes to ' + D.draft.name + '?')) return; D.cur = it.dataset.t; FL.lsSet('dz.cur', D.cur); D.draft = null; FL.render(); }; });
            $('dz-new').onclick = function () { D.newTpl(false); };
            $('dz-dup').onclick = function () { D.newTpl(true); };
            $('dz-exp').onclick = function () { FL.download('finance-templates.json', new Blob([JSON.stringify({ version: 1, templates: FL.templates }, null, 1)], { type: 'application/json' })); };
            $('dz-imp').onchange = function () { var f = this.files[0]; if (!f) return; f.text().then(D.importJson); };
            $('dz-reset').onclick = function () {
                if (!confirm('Put the starter templates back? Templates with the same ids (PL, PLS, BS, CF) are replaced; your other templates stay.')) return;
                FIN_SEED.templates.forEach(function (s) { var i = FL.templates.map(function (t) { return t.id; }).indexOf(s.id); var c = JSON.parse(JSON.stringify(s)); if (i >= 0) FL.templates[i] = c; else FL.templates.push(c); });
                FL.saveTemplates().then(function () { D.draft = null; FL.render(); FL.toast('Starters restored', 'ok'); });
            };
            if (!D.draft) { $('dz-main').innerHTML = '<div class="empty">No template. Press New.</div>'; return; }
            return FL.data().then(function (data) { D.data = data; D.main(); });
        }
    };

    D.newTpl = function (copy) {
        var id = prompt('Id of the new template (letters, digits, _ — used in KPI formulas, e.g. PL2):', copy ? D.draft.id + '2' : 'MY_PL');
        if (!id) return;
        id = id.trim().toUpperCase();
        if (!/^[A-Z_][A-Z0-9_]*$/.test(id)) { FL.toast('Use letters, digits and _ only', 'err'); return; }
        if (FL.tpl(id)) { FL.toast('That id is taken', 'err'); return; }
        D.draft = copy ? Object.assign(JSON.parse(JSON.stringify(D.draft)), { id: id, name: D.draft.name + ' (copy)' })
            : { id: id, name: 'New statement', type: 'CUSTOM', scale: 1000, description: '', columns: PRESETS.yoy.cols(), rows: [{ id: 'H1', type: 'header', label: 'Section', style: { bold: true } }, { id: 'L1', type: 'accounts', label: 'Line', accounts: '', level: 1 }] };
        D.isNew = true; D.dirty = true; D.sel = -1; D.cur = id;
        FL.render();
    };
    D.importJson = function (text) {
        try {
            var j = JSON.parse(text), list = j.templates || (Array.isArray(j) ? j : [j]);
            list.forEach(function (t) { if (!t.id || !t.rows) throw new Error('not a template'); var i = FL.templates.map(function (x) { return x.id; }).indexOf(t.id); if (i >= 0) FL.templates[i] = t; else FL.templates.push(t); });
            FL.saveTemplates().then(function () { FL.toast(list.length + ' template(s) imported', 'ok'); D.draft = null; FL.render(); });
        } catch (e) { FL.toast('Not a template file: ' + e.message, 'err'); }
    };

    /** Accounts no row picks up / picked up by more than one accounts row (that would double count) */
    D.coverage = function () {
        var t = D.draft, acc = FL.dims.accounts, used = {};
        t.rows.forEach(function (r) { if (r.type === 'accounts' && !r.hidden && r.basis !== 'opening') FINE.matchAccounts(r.accounts, acc).forEach(function (c) { (used[c] = used[c] || []).push(r.id || r.label); }); });
        var want = t.type === 'PL' ? function (a) { return FINE.isPl(a); } : t.type === 'BS' ? function () { return true; } : t.type === 'CF' ? function (a) { return !/^(1000|1010|10)/.test(a.code); } : function () { return false; };
        var missing = acc.filter(function (a) { return want(a) && !used[a.code]; });
        var twice = Object.keys(used).filter(function (c) { return used[c].length > 1 && t.type !== 'CF'; }).map(function (c) { return { code: c, rows: used[c] }; });
        return { missing: missing, twice: twice };
    };

    D.main = function () {
        var t = D.draft, el = $('dz-main'), cov = D.coverage();
        var opt = function (list, v) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (String(v == null ? '' : v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
        var ids = t.rows.filter(function (r) { return r.id && r.type === 'group'; }).map(function (r) { return [r.id, r.id]; });
        el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-pen-ruler"></i> ' + esc(t.name) + (D.dirty ? ' <span class="tag warn">not saved</span>' : '') + '<span class="grow"></span>' +
            (D.isNew ? '' : '<button class="btn sm" id="dz-del"><i class="fa-regular fa-trash-can"></i> Delete</button>') +
            '<button class="btn sm" id="dz-undo"' + (D.dirty ? '' : ' disabled') + '>Discard</button><button class="btn sm primary" id="dz-save"><i class="fa-solid fa-floppy-disk"></i> Save</button></h3>' +
            '<div class="grid g4"><label class="field">Name<input data-m="name" value="' + esc(t.name) + '"></label>' +
            '<label class="field">Type<select data-m="type">' + opt([['PL', 'Income statement'], ['BS', 'Balance sheet'], ['CF', 'Cash flow'], ['CUSTOM', 'Other / analysis']], t.type) + '</select></label>' +
            '<label class="field">Default amounts<select data-m="scale">' + opt([['1', 'Units'], ['1000', 'Thousands'], ['1000000', 'Millions']], t.scale) + '</select></label>' +
            '<label class="field">Description<input data-m="description" value="' + esc(t.description || '') + '"></label></div></div>' +

            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-table-columns"></i> Columns<span class="grow"></span><select id="dz-pre"><option value="">Preset…</option>' + Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '">' + esc(PRESETS[k].label) + '</option>'; }).join('') + '</select>' +
            '<button class="btn sm" id="dz-cadd"><i class="fa-solid fa-plus"></i> Column</button></h3><div class="dz-box" style="max-height:220px"><table class="dz-rows"><thead><tr><th></th><th>Id</th><th>Label (blank = automatic)</th><th>Kind</th><th>Scenario</th><th>Range</th><th>Period</th><th>A / of</th><th>B / row</th><th>Mode</th><th></th></tr></thead><tbody>' +
            t.columns.map(function (c, i) {
                var k = c.kind || 'value';
                return '<tr><td><button class="icon" data-cu="' + i + '">▲</button></td><td><input data-c="' + i + '" data-f="id" value="' + esc(c.id) + '" style="width:60px"></td><td><input data-c="' + i + '" data-f="label" value="' + esc(c.label || '') + '"></td>' +
                    '<td><select data-c="' + i + '" data-f="kind">' + opt([['value', 'Amount'], ['var', 'Variance'], ['pctof', '% of a row']], k) + '</select></td>' +
                    (k === 'value' ? '<td><select data-c="' + i + '" data-f="scenario">' + opt([['ACTUAL', 'Actual'], ['BUDGET', 'Budget']], c.scenario || 'ACTUAL') + '</select></td><td><select data-c="' + i + '" data-f="range">' + opt(RANGES, c.range || 'MTD') + '</select></td>' +
                        '<td><select data-c="' + i + '" data-f="at">' + opt(ATS.concat(/^M-/.test(c.at || '') ? [[c.at, c.at.replace('M-', '') + ' months back']] : []), c.at || 'CUR') + '</select></td><td></td><td></td><td></td>'
                        : '<td></td><td></td><td></td><td><select data-c="' + i + '" data-f="' + (k === 'var' ? 'a' : 'of') + '">' + opt(t.columns.filter(function (x) { return !x.kind; }).map(function (x) { return [x.id, x.id]; }), k === 'var' ? c.a : c.of) + '</select></td>' +
                        (k === 'var' ? '<td><select data-c="' + i + '" data-f="b">' + opt(t.columns.filter(function (x) { return !x.kind; }).map(function (x) { return [x.id, x.id]; }), c.b) + '</select></td><td><select data-c="' + i + '" data-f="mode">' + opt([['abs', 'Amount'], ['pct', '%']], c.mode || 'abs') + '</select></td>'
                            : '<td><select data-c="' + i + '" data-f="row">' + opt([['', '—']].concat(t.rows.filter(function (r) { return r.id && r.type !== 'header' && r.type !== 'blank' && r.type !== 'text'; }).map(function (r) { return [r.id, r.id + ' ' + (r.label || '')]; })), c.row) + '</select></td><td></td>')) +
                    '<td><button class="icon" data-cx="' + i + '">✕</button></td></tr>';
            }).join('') + '</tbody></table></div></div>' +

            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-list"></i> Rows <small>click a row number to select; insert goes below it</small><span class="grow"></span>' +
            TYPES.map(function (x) { return '<button class="btn sm" data-add="' + x[0] + '">+ ' + esc(x[1]) + '</button>'; }).join('') + '</h3>' +
            (cov.missing.length ? '<div class="callout warn sm"><b>' + cov.missing.length + ' account(s) are in no row</b> — their amounts are left out: ' + cov.missing.slice(0, 14).map(function (a) { return esc(a.code + ' ' + a.name); }).join(', ') + (cov.missing.length > 14 ? ' …' : '') + '</div>' : '<div class="callout good sm">Every ' + (t.type === 'PL' ? 'income statement' : t.type === 'BS' ? '' : '') + ' account is picked up by a row.</div>') +
            (cov.twice.length ? '<div class="callout bad sm"><b>' + cov.twice.length + ' account(s) are in two rows</b> (double counted in totals): ' + cov.twice.slice(0, 10).map(function (x) { return esc(x.code + ' → ' + x.rows.join(' & ')); }).join('; ') + '</div>' : '') +
            '<div class="dz-box"><table class="dz-rows"><thead><tr><th>#</th><th></th><th>Type</th><th>Id</th><th>Label</th><th>Accounts / formula</th><th>In group</th><th>Indent</th><th>Sign</th><th>Basis</th><th>Format</th><th>Better when</th><th>Style</th><th></th></tr></thead><tbody>' +
            t.rows.map(function (r, i) {
                var s = r.style || {}, n = r.type === 'accounts' ? FINE.matchAccounts(r.accounts, FL.dims.accounts).length : null;
                return '<tr class="t-' + r.type + (i === D.sel ? ' sel' : '') + '"><td><a class="sm" data-sel="' + i + '" style="cursor:pointer">' + (i + 1) + '</a></td><td style="white-space:nowrap"><button class="icon" data-up="' + i + '">▲</button><button class="icon" data-dn="' + i + '">▼</button></td>' +
                    '<td><select data-r="' + i + '" data-f="type">' + opt(TYPES, r.type) + '</select></td>' +
                    '<td><input data-r="' + i + '" data-f="id" value="' + esc(r.id || '') + '" style="width:72px"></td>' +
                    '<td><input data-r="' + i + '" data-f="label" value="' + esc(r.label || '') + '" style="min-width:170px"></td>' +
                    '<td style="min-width:200px">' + (r.type === 'accounts' ? '<div class="row" style="flex-wrap:nowrap;gap:2px"><input data-r="' + i + '" data-f="accounts" value="' + esc(typeof r.accounts === 'string' ? r.accounts : JSON.stringify(r.accounts || '')) + '" placeholder="4000-4099, 4100"><button class="icon" data-pick="' + i + '" title="Pick accounts">…</button><span class="sm ' + (n ? 'muted' : 'neg') + '">' + n + '</span></div>'
                        : r.type === 'formula' || r.type === 'check' ? '<input data-r="' + i + '" data-f="formula" class="mono" value="' + esc(r.formula || '') + '" placeholder="GP - OPEX">' : '') + '</td>' +
                    '<td><select data-r="' + i + '" data-f="parent">' + opt([['', '—']].concat(ids.filter(function (x) { return x[0] !== r.id; })), r.parent || '') + '</select></td>' +
                    '<td><input data-r="' + i + '" data-f="level" type="number" min="0" max="5" value="' + (r.level || 0) + '" style="width:44px"></td>' +
                    '<td>' + (r.type === 'accounts' ? '<select data-r="' + i + '" data-f="sign">' + opt([['auto', 'Auto'], ['credit', 'Credits +'], ['debit', 'Debits +']], r.sign || 'auto') + '</select>' : '') + '</td>' +
                    '<td>' + (r.type === 'accounts' ? '<select data-r="' + i + '" data-f="basis">' + opt([['auto', 'Auto'], ['activity', 'Movement'], ['balance', 'Closing balance'], ['change', 'Change'], ['opening', 'Opening balance']], r.basis || 'auto') + '</select>' : '') + '</td>' +
                    '<td>' + (['header', 'blank', 'text'].indexOf(r.type) < 0 ? '<select data-r="' + i + '" data-f="format">' + opt([['num', 'Amount'], ['pct', '%'], ['ratio', 'Ratio'], ['days', 'Days']], r.format || 'num') + '</select>' : '') + '</td>' +
                    '<td>' + (['header', 'blank', 'text', 'check'].indexOf(r.type) < 0 ? '<select data-r="' + i + '" data-f="favourable">' + opt([['up', 'Higher'], ['down', 'Lower']], r.favourable || 'up') + '</select>' : '') + '</td>' +
                    '<td class="styl" style="white-space:nowrap">' + [['bold', 'B'], ['italic', 'I'], ['topBorder', '‾'], ['doubleBottom', '═'], ['highlight', '■'], ['hidden', '👁']].map(function (x) {
                        var on = x[0] === 'hidden' ? r.hidden : s[x[0]]; return '<button data-st="' + i + '" data-k="' + x[0] + '" class="' + (on ? 'on' : '') + '" title="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</td>' +
                    '<td><button class="icon" data-rx="' + i + '">✕</button></td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<p class="formhelp">Accounts: <code>4000-4099</code> range · <code>4000, 4010</code> list · <code>6*</code> starts with · <code>!6950</code> leave out. Auto sign shows credits as + for revenue / liability / equity rows. Basis: movement for income statement, closing balance for balance sheet, change and opening balance for cash flows. ' +
            'Groups add the rows that name them in "In group". Formulas: row ids with <code>+ − * / ^ ( )</code>, ' + FINE.FUNCTIONS.map(function (f) { return '<code>' + f + '</code>'; }).join(' ') + '. A check row must come to nil.</p></div>' +
            '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-eye"></i> Preview <small>' + esc(FL.filterText()) + ' · ' + esc(FL.periodName(FL.filter.period)) + '</small></h3><div id="dz-prev"></div></div>';
        D.preview(); D.wire();
    };

    D.preview = function () {
        var st = FINE.compute(D.draft, D.data, FL.stmtOpts());
        $('dz-prev').innerHTML = (st.errors.length ? '<div class="stmt-err">' + st.errors.map(esc).join(' · ') + '</div>' : '') + '<div class="stmt-wrap">' + FL.stmtTable(st, { hideZero: false }) + '</div>';
    };
    D.touch = function (full) { D.dirty = true; if (full) D.main(); else { D.preview(); } };

    D.wire = function () {
        var t = D.draft, el = $('dz-main');
        el.querySelectorAll('[data-m]').forEach(function (x) { x.onchange = function () { t[x.dataset.m] = x.dataset.m === 'scale' ? +x.value : x.value; D.touch(x.dataset.m === 'type'); }; });
        el.querySelectorAll('[data-c]').forEach(function (x) {
            x.onchange = function () {
                var c = t.columns[+x.dataset.c], f = x.dataset.f, v = x.value;
                if (f === 'kind') { if (v === 'value') delete c.kind; else c.kind = v; if (v === 'var') { var vals = t.columns.filter(function (y) { return !y.kind; }); c.a = c.a || (vals[0] || {}).id; c.b = c.b || (vals[1] || vals[0] || {}).id; } if (v === 'pctof') c.of = c.of || (t.columns[0] || {}).id; D.touch(true); return; }
                if (f === 'at' && v === 'CUR') delete c.at; else if (f === 'mode' && v === 'abs') delete c.mode; else if (f === 'label' && !v) delete c.label; else c[f] = v;
                D.touch(f === 'id');
            };
        });
        el.querySelectorAll('[data-cx]').forEach(function (b) { b.onclick = function () { t.columns.splice(+b.dataset.cx, 1); D.touch(true); }; });
        el.querySelectorAll('[data-cu]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.cu; if (i > 0) { var x = t.columns[i]; t.columns[i] = t.columns[i - 1]; t.columns[i - 1] = x; D.touch(true); } }; });
        $('dz-cadd').onclick = function () { t.columns.push({ id: 'c' + (t.columns.length + 1), range: 'YTD' }); D.touch(true); };
        $('dz-pre').onchange = function () { if (!this.value) return; if (!confirm('Replace the columns with "' + PRESETS[this.value].label + '"?')) { this.value = ''; return; } t.columns = PRESETS[this.value].cols(); D.touch(true); };

        el.querySelectorAll('[data-r]').forEach(function (x) {
            x.onchange = function () {
                var r = t.rows[+x.dataset.r], f = x.dataset.f, v = x.value;
                if (f === 'level') r.level = +v || 0;
                else if (f === 'id') { var old = r.id; r.id = v.trim().toUpperCase(); t.rows.forEach(function (o) { if (o.parent === old) o.parent = r.id; }); }
                else if (f === 'parent' && !v) delete r.parent;
                else if ((f === 'sign' || f === 'basis') && v === 'auto') delete r[f];
                else if (f === 'favourable' && v === 'up') delete r.favourable;
                else if (f === 'format' && v === 'num') delete r.format;
                else r[f] = v;
                D.touch(['type', 'id', 'accounts', 'parent'].indexOf(f) >= 0);
            };
        });
        el.querySelectorAll('[data-st]').forEach(function (b) {
            b.onclick = function () {
                var r = t.rows[+b.dataset.st], k = b.dataset.k;
                if (k === 'hidden') r.hidden = !r.hidden; else { r.style = r.style || {}; r.style[k] = !r.style[k]; }
                D.touch(true);
            };
        });
        el.querySelectorAll('[data-sel]').forEach(function (a) { a.onclick = function () { D.sel = +a.dataset.sel === D.sel ? -1 : +a.dataset.sel; D.main(); }; });
        el.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.up; if (i > 0) { var x = t.rows[i]; t.rows[i] = t.rows[i - 1]; t.rows[i - 1] = x; if (D.sel === i) D.sel--; D.touch(true); } }; });
        el.querySelectorAll('[data-dn]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.dn; if (i < t.rows.length - 1) { var x = t.rows[i]; t.rows[i] = t.rows[i + 1]; t.rows[i + 1] = x; if (D.sel === i) D.sel++; D.touch(true); } }; });
        el.querySelectorAll('[data-rx]').forEach(function (b) { b.onclick = function () { t.rows.splice(+b.dataset.rx, 1); D.sel = -1; D.touch(true); }; });
        el.querySelectorAll('[data-add]').forEach(function (b) {
            b.onclick = function () {
                var type = b.dataset.add, n = 1; while (t.rows.some(function (r) { return r.id === 'R' + n; })) n++;
                var r = { id: type === 'blank' ? 'B' + n : 'R' + n, type: type, label: type === 'blank' ? '' : 'New ' + type };
                if (type === 'header') r.style = { bold: true };
                if (type === 'group') r.style = { bold: true, topBorder: true };
                if (type === 'accounts') { r.accounts = ''; r.level = 1; }
                if (type === 'formula' || type === 'check') r.formula = '';
                var at = D.sel >= 0 ? D.sel + 1 : t.rows.length;
                t.rows.splice(at, 0, r); D.sel = at; D.touch(true);
            };
        });
        el.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { D.pick(+b.dataset.pick); }; });
        $('dz-save').onclick = D.save;
        $('dz-undo').onclick = function () { D.draft = null; D.isNew = false; FL.render(); };
        if ($('dz-del')) $('dz-del').onclick = function () {
            if (!confirm('Delete the template "' + t.name + '"? KPIs that use ' + t.id + '.… stop working.')) return;
            FL.templates = FL.templates.filter(function (x) { return x.id !== t.id; });
            FL.saveTemplates().then(function () { D.draft = null; D.cur = (FL.templates[0] || {}).id; FL.render(); });
        };
    };

    D.save = function () {
        var t = D.draft, ids = {}, bad = [];
        t.rows.forEach(function (r) { if (!r.id) return; if (ids[r.id]) bad.push('row id ' + r.id + ' is used twice'); ids[r.id] = 1; });
        t.columns.forEach(function (c) { if (!c.id) bad.push('a column has no id'); });
        var st = FINE.compute(t, D.data, FL.stmtOpts());
        if (bad.length || st.errors.length) { if (!confirm('Problems:\n• ' + bad.concat(st.errors).join('\n• ') + '\n\nSave anyway?')) return; }
        var i = FL.templates.map(function (x) { return x.id; }).indexOf(t.id);
        if (i >= 0) FL.templates[i] = JSON.parse(JSON.stringify(t)); else FL.templates.push(JSON.parse(JSON.stringify(t)));
        FL.saveTemplates().then(function () { D.dirty = false; D.isNew = false; FL.toast('Template saved', 'ok'); FL.render(); }).catch(function (e) { FL.toast(String(e), 'err'); });
    };

    /** Account picker: tick accounts or ranges by class / type; writes compact ranges */
    D.pick = function (ri) {
        var r = D.draft.rows[ri], cur = {};
        FINE.matchAccounts(r.accounts, FL.dims.accounts).forEach(function (c) { cur[c] = 1; });
        var groups = {}; FL.dims.accounts.forEach(function (a) { var g = ({ A: 'Assets', L: 'Liabilities', O: 'Equity', R: 'Revenue', E: 'Expenses' }[a.account_type] || 'Other') + ' · ' + (a.class || ''); (groups[g] = groups[g] || []).push(a); });
        FL.modal('<i class="fa-solid fa-list-check"></i> Accounts for "' + esc(r.label) + '"',
            '<input id="pk-q" placeholder="Filter by code, name or class" style="width:100%;padding:6px 8px;border:1px solid var(--line2);border-radius:8px;margin-bottom:8px"><div class="scroll" style="max-height:55vh" id="pk-l">' +
            Object.keys(groups).sort().map(function (g) {
                return '<div class="pk-g" style="margin:8px 0 2px"><label><input type="checkbox" data-g="' + esc(g) + '"> <b>' + esc(g) + '</b></label></div>' +
                    groups[g].map(function (a) { return '<label class="pk-a" style="display:block;padding:1px 0 1px 22px" data-s="' + esc((a.code + ' ' + a.name + ' ' + g).toLowerCase()) + '"><input type="checkbox" data-a="' + esc(a.code) + '"' + (cur[a.code] ? ' checked' : '') + '> ' + esc(a.code + ' ' + a.name) + '</label>'; }).join('');
            }).join('') + '</div><div class="row" style="margin-top:10px"><span class="sm muted" id="pk-n"></span><span class="grow"></span><button class="btn primary" id="pk-ok">Use these accounts</button></div>');
        var count = function () { $('pk-n').textContent = document.querySelectorAll('#pk-l [data-a]:checked').length + ' selected'; };
        count();
        $('pk-l').onchange = function (e) {
            if (e.target.dataset.g) groups[e.target.dataset.g].forEach(function (a) { document.querySelector('#pk-l [data-a="' + a.code + '"]').checked = e.target.checked; });
            count();
        };
        $('pk-q').oninput = function () { var q = this.value.toLowerCase(); document.querySelectorAll('#pk-l .pk-a').forEach(function (l) { l.style.display = l.dataset.s.indexOf(q) >= 0 ? 'block' : 'none'; }); };
        $('pk-ok').onclick = function () {
            var all = FL.dims.accounts.map(function (a) { return a.code; }), on = {};
            document.querySelectorAll('#pk-l [data-a]:checked').forEach(function (c) { on[c.dataset.a] = 1; });
            // consecutive chosen accounts (in code order) become ranges
            var parts = [], start = null, prev = null;
            all.forEach(function (c) { if (on[c]) { if (start == null) start = c; prev = c; } else if (start != null) { parts.push(start === prev ? start : start + '-' + prev); start = null; } });
            if (start != null) parts.push(start === prev ? start : start + '-' + prev);
            r.accounts = parts.join(', ');
            FL.closeModal(); D.touch(true);
        };
    };
})();
