/* Finance Lens — Main groups & totals: turns a flat template (one accounts line per group, e.g. loaded from a paste) into
   Main group → its lines → total, with the calculations between them (gross profit, operating profit, profit before tax,
   net profit + margins / total assets, total liabilities, total equity and liabilities, the balance check). Every line gets a
   suggested main group from its accounts (type, class, name) that the user can change; accounts in more than one line must be
   given to one line; lines of the other statement (balance sheet lines in an income statement …) can move to a new template.
   Engine: FINE.structureSuggest / structureApply (node-tested). The change is a draft until Save in the designer. */
(function () {
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var $ = function (id) { return document.getElementById(id); };
    var S = FL.structure = {};
    var KIND = { PL: 'income statement', BS: 'balance sheet' };

    /** t = the template being edited (changed in place); done({other}) after Apply */
    S.open = function (t, done) {
        S.t = t; S.done = done;
        S.sug = FINE.structureSuggest(t, FL.dims.accounts);
        S.choice = { main: {}, keep: {}, customs: {}, split: true, otherName: '' };
        S.sug.dup.forEach(function (d) { S.choice.keep[d.code] = d.rows[0]; });
        S.paint();
    };
    S.mains = function (kind) {
        var list = FINE.STRUCT[kind].filter(function (m) { return m.t !== 'f'; }).map(function (m) { return [m.id, m.name]; });
        S.sug.customs.forEach(function (c) { list.push([c.key, c.name + ' (your group)']); });
        return list.concat([['__keep', 'Outside the totals'], ['__drop', 'Leave out of the template']]);
    };
    S.paint = function () {
        var sug = S.sug, ch = S.choice, kind = sug.kind, other = kind === 'PL' ? 'BS' : 'PL';
        var others = sug.lines.filter(function (l) { return l.kind !== kind; });
        var lab = {}; sug.lines.forEach(function (l) { lab[l.id] = l.label; });
        var h = '<p class="sm" style="margin-top:0">Every line gets a <b>main group</b> (suggested from its accounts — type, class and name; change any of them), then the totals are added between the main groups. ' +
            'You can edit, rename or delete any row afterwards in the designer.</p>';
        if (sug.hasCalc) h += '<div class="callout warn sm">This template already has headers, groups or formulas — they are replaced by the new main groups and totals (lines and their accounts stay).</div>';
        if (others.length) h += '<div class="callout sm" style="margin:8px 0"><b>' + others.length + ' line(s) belong to the ' + KIND[other] + '</b> (' + others.slice(0, 6).map(function (l) { return esc(l.label); }).join(', ') + (others.length > 6 ? ' …' : '') + ').<br>' +
            '<label><input type="checkbox" id="st-split"' + (ch.split ? ' checked' : '') + '> Move them into a new ' + KIND[other] + ' template named</label> <input id="st-oname" style="width:260px" value="' + esc(ch.otherName || S.otherName()) + '">' +
            (ch.split ? '' : '<div class="sm muted">Kept here outside the totals.</div>') + '</div>';
        if (sug.dup.length) h += '<div class="callout bad sm" style="margin:8px 0"><b>' + sug.dup.length + ' account(s) are in more than one line</b> — their amounts would be counted twice. Choose the line that keeps each one:' +
            '<table class="pm-tab" style="margin-top:6px"><thead><tr><th>Account</th><th>Name</th><th>Keep it in</th></tr></thead><tbody>' +
            sug.dup.map(function (d) { return '<tr><td class="mono">' + esc(d.code) + '</td><td>' + esc(d.name) + '</td><td><select data-keep="' + esc(d.code) + '">' + d.rows.map(function (r) { return '<option value="' + esc(r) + '"' + (ch.keep[d.code] === r ? ' selected' : '') + '>' + esc(lab[r] || r) + '</option>'; }).join('') + '</select></td></tr>'; }).join('') + '</tbody></table></div>';
        h += '<div class="grid g2" style="align-items:start;gap:14px"><div><h3 style="margin:4px 0">Lines <small>' + sug.lines.length + '</small></h3><div class="scroll" style="max-height:52vh"><table class="pm-tab"><thead><tr><th>Line</th><th class="num">Accounts</th><th>Nature</th><th>Main group</th></tr></thead><tbody>' +
            sug.lines.map(function (l) {
                var k = ch.split && l.kind !== kind ? l.kind : kind, cur = ch.main[l.id] != null ? ch.main[l.id] : l.main;
                if (!ch.split && l.kind !== kind && FINE.STRUCT[kind].every(function (m) { return m.id !== cur; }) && !/^c:|^__/.test(cur)) cur = '__keep';
                var opts = S.mains(k);
                if (!opts.some(function (o) { return o[0] === cur; })) cur = '__keep';
                return '<tr' + (l.kind !== kind ? ' style="background:#f8fafc"' : '') + '><td><b>' + esc(l.label) + '</b>' + (l.cls ? ' <span class="sm muted">' + esc(l.cls) + '</span>' : '') + '</td><td class="num">' + l.n + '</td><td>' + esc(l.nature || '?') + (l.kind !== kind ? ' <span class="pm-st kind">' + (ch.split ? '→ new ' + KIND[l.kind] : KIND[l.kind]) + '</span>' : '') + '</td>' +
                    '<td><select data-main="' + esc(l.id) + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></td></tr>';
            }).join('') + '</tbody></table></div></div>' +
            '<div><h3 style="margin:4px 0">Result <small>what the template will look like</small></h3><div id="st-prev" class="scroll" style="max-height:52vh"></div></div></div>';
        FL.modal('<i class="fa-solid fa-sitemap"></i> Main groups &amp; totals · ' + esc(S.t.name || S.t.id), h,
            '<button class="btn primary" id="st-apply"><i class="fa-solid fa-wand-magic-sparkles"></i> Build main groups &amp; totals</button>');
        document.querySelectorAll('#m-body [data-main]').forEach(function (x) { x.onchange = function () { ch.main[x.dataset.main] = x.value; S.preview(); }; });
        document.querySelectorAll('#m-body [data-keep]').forEach(function (x) { x.onchange = function () { ch.keep[x.dataset.keep] = x.value; }; });
        var sp = $('st-split'); if (sp) sp.onchange = function () { ch.split = sp.checked; S.paint(); };
        var on = $('st-oname'); if (on) on.oninput = function () { ch.otherName = on.value; };
        $('st-apply').onclick = S.apply;
        S.preview();
    };
    S.otherName = function () {
        var o = S.sug.kind === 'PL' ? 'Balance sheet' : 'Income statement';
        return o + (S.t.name ? ' — ' + String(S.t.name).replace(/^(income statement|balance sheet)\s*[—-]\s*/i, '') : '');
    };
    /** Runs the engine on copies and draws the outline of both templates */
    S.preview = function () {
        var t = JSON.parse(JSON.stringify(S.t)), ch = JSON.parse(JSON.stringify(S.choice));
        ch.otherName = ch.otherName || S.otherName();
        var res = FINE.structureApply(t, S.sug, ch, FL.dims.accounts);
        var out = function (tpl) {
            return '<div class="sm" style="font-weight:700;margin:6px 0 2px">' + esc(tpl.name || '') + ' <span class="muted">' + esc(KIND[tpl.type] || tpl.type) + '</span></div><table class="pm-tab"><tbody>' + tpl.rows.map(function (r) {
                if (r.type === 'blank') return '<tr><td colspan="2" style="height:6px"></td></tr>';
                var pad = r.parent ? 'padding-left:22px' : '', b = r.type !== 'accounts' || !r.parent ? 'font-weight:700' : '';
                var right = r.type === 'formula' || r.type === 'check' ? '<code>' + esc(r.formula) + '</code>' : r.type === 'group' ? '<span class="muted">sum of its lines</span>' : '';
                return '<tr><td style="' + pad + ';' + b + (r.type === 'check' || r.format === 'pct' ? ';font-style:italic' : '') + '">' + esc(r.label || r.id) + '</td><td class="sm">' + right + '</td></tr>';
            }).join('') + '</tbody></table>';
        };
        $('st-prev').innerHTML = out(Object.assign({ name: S.t.name, type: S.sug.kind }, t)) + (res.other ? out(res.other) : '') +
            (res.warnings.length ? '<div class="callout warn sm" style="margin-top:6px">' + res.warnings.map(esc).join('<br>') + '</div>' : '');
    };
    S.apply = function () {
        var ch = S.choice; ch.otherName = ch.otherName || S.otherName();
        var res = FINE.structureApply(S.t, S.sug, ch, FL.dims.accounts), next = Promise.resolve();
        if (res.other) {
            var used = {}; FL.templates.forEach(function (x) { used[x.id] = 1; });
            res.other.id = FINE.simpleId(res.other.name, used);
            FL.templates.push(res.other);
            next = FL.saveTemplates();
        }
        next.then(function () {
            FL.closeModal();
            FL.toast('Main groups and totals added' + (res.other ? ' — "' + res.other.name + '" created with the ' + KIND[res.other.type] + ' lines' : '') + '. Check the preview, then Save.', 'ok');
            if (S.done) S.done({ structured: true, other: res.other });
        }, function (e) { FL.toast(String(e), 'err'); });
    };
})();
