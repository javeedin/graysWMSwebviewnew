/* Finance Lens — value groups for Segment P&L: the user groups the values of a segment (e.g. Salesperson → Door to door, Pre-sales,
   Shops). Kept in config.json segGroups["<chart of accounts>|segmentN"] = { name, groups: [{ name, values: [...] }] }. The grouping is
   a field of its own (grp_segmentN, FL.segpl.decorate): pick it under Group by — it goes in with the segment under it, so the tree
   opens a group into its values; By columns shows one column per group with ▸ to open a group into its values (the group column
   stays as the subtotal). Values in no group show as "(not grouped)". */
(function () {
    var G = FL.segpl;
    var money = function (v) { return FINE.fmt((v || 0) / (FL.filter.scale || 1), 'num', { decimals: 0 }); };

    G.groupEditor = function (col) {
        var L = G.led, key = G.grpKey(col), cur = ((FL.config || {}).segGroups || {})[key];
        var d = JSON.parse(JSON.stringify(cur || { name: G.label(col) + ' group', groups: [] }));
        var map = {}; d.groups.forEach(function (g) { (g.values || []).forEach(function (v) { map[v] = g.name; }); });
        var st = { q: '', show: 'all', sel: {} }, vals = [];
        FL.modal('<i class="fa-solid fa-object-group"></i> Group the values of ' + esc(G.label(col)), '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the values…</div>',
            '<button class="btn" id="gr-del"' + (cur ? '' : ' style="display:none"') + '><i class="fa-solid fa-trash"></i> Remove grouping</button><button class="btn primary" id="gr-ok"><i class="fa-solid fa-floppy-disk"></i> Save</button>');
        // every value of the segment in this ledger, with its P&L movement over the chosen periods (biggest first)
        FL.rows('SELECT COALESCE(' + col + ", '') AS v, ROUND(SUM(CASE WHEN period_seq IN (" + (G.st.periods.join(',') || '0') + ") THEN dr - cr ELSE 0 END), 2) AS net FROM fin_gl_ext_v WHERE ledger_id = " + (+L.ledger_id) +
            ' GROUP BY 1 ORDER BY ABS(SUM(CASE WHEN period_seq IN (' + (G.st.periods.join(',') || '0') + ') THEN dr - cr ELSE 0 END)) DESC, 1', 50000).then(function (rows) {
            vals = rows.map(function (r) { return { v: r.v, name: (G.valName[col] || {})[r.v] || '', net: +r.net || 0 }; });
            paint();
        }).catch(function (e) { $('m-body').innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });

        function counts() { var c = {}; vals.forEach(function (x) { var g = map[x.v]; c[g || ''] = (c[g || ''] || 0) + 1; }); return c; }
        function paint() {
            var c = counts(), nNo = c[''] || 0, q = st.q.toLowerCase();
            var shown = vals.filter(function (x) {
                if (st.show === 'none' && map[x.v]) return false;
                if (st.show !== 'all' && st.show !== 'none' && map[x.v] !== st.show) return false;
                return !q || (x.v + ' ' + x.name).toLowerCase().indexOf(q) >= 0;
            });
            var opts = function (sel) { return '<option value="">— not grouped —</option>' + d.groups.map(function (g) { return '<option' + (g.name === sel ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join(''); };
            $('m-body').innerHTML =
                '<div class="row sm" style="gap:8px;flex-wrap:wrap"><label><b>Grouping name</b> <input id="gr-name" value="' + esc(d.name) + '" style="width:220px"></label><span class="muted">shown as a field under Group by, e.g. "Channel"</span></div>' +
                '<div class="gr-groups">' + d.groups.map(function (g, i) {
                    return '<span class="gr-chip' + (st.show === g.name ? ' on' : '') + '" data-gs="' + esc(g.name) + '"><b>' + esc(g.name) + '</b> <span class="muted">' + (c[g.name] || 0) + '</span> <a data-gren="' + i + '" title="Rename">✎</a> <a data-grm="' + i + '" title="Remove the group (its values become not grouped)">×</a></span>';
                }).join('') + '<span class="gr-chip add"><input id="gr-new" placeholder="New group, e.g. Door to door" style="width:200px"> <button class="btn sm" id="gr-add">Add</button></span></div>' +
                '<div class="row sm" style="gap:8px;flex-wrap:wrap;margin:6px 0"><input id="gr-q" placeholder="Search value or name" value="' + esc(st.q) + '" style="width:220px">' +
                '<select id="gr-show"><option value="all">all values (' + vals.length + ')</option><option value="none"' + (st.show === 'none' ? ' selected' : '') + '>not grouped (' + nNo + ')</option>' + d.groups.map(function (g) { return '<option' + (st.show === g.name ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') + '</select>' +
                '<span class="grow"></span><a id="gr-tick">tick all shown</a> · <a id="gr-untick">untick</a> · Move ticked to <select id="gr-move">' + opts('') + '</select><button class="btn sm primary" id="gr-mv">Move</button></div>' +
                '<div class="row sm" style="gap:8px;margin-bottom:6px"><span class="muted">Suggest groups from</span><button class="btn sm ghost" id="gr-sw" title="One group per first word of the value name (e.g. SHOP …, D2D …)">first word of the name</button>' +
                '<label>code prefix <select id="gr-pn">' + [1, 2, 3, 4].map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select></label><button class="btn sm ghost" id="gr-sp">suggest</button><span class="muted">— only values not grouped yet</span></div>' +
                '<div class="scroll" style="max-height:52vh"><table class="t"><thead><tr><th></th><th>Value</th><th>Name</th><th class="n">P&amp;L movement</th><th>Group</th></tr></thead><tbody>' +
                shown.slice(0, 2000).map(function (x, i) {
                    return '<tr><td><input type="checkbox" data-sel="' + esc(x.v) + '"' + (st.sel[x.v] ? ' checked' : '') + '></td><td>' + esc(x.v || '(blank)') + '</td><td>' + esc(x.name) + '</td><td class="n">' + money(x.net) + '</td><td><select data-v="' + esc(x.v) + '">' + opts(map[x.v]) + '</select></td></tr>';
                }).join('') + '</tbody></table></div>' + (shown.length > 2000 ? '<p class="sm muted">First 2,000 of ' + shown.length + ' — search to narrow.</p>' : '') +
                '<p class="sm muted">' + (vals.length - nNo) + ' of ' + vals.length + ' values grouped. Values in no group show as "(not grouped)".</p>';
            var b = $('m-body');
            $('gr-name').onchange = function () { d.name = this.value.trim() || d.name; };
            $('gr-q').oninput = function () { st.q = this.value; clearTimeout(st.t); st.t = setTimeout(function () { paint(); var i = $('gr-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
            $('gr-show').onchange = function () { st.show = this.value; paint(); };
            var add = function () { var n = $('gr-new').value.trim(); if (!n || d.groups.some(function (g) { return g.name === n; })) return; d.groups.push({ name: n, values: [] }); paint(); };
            $('gr-add').onclick = add; $('gr-new').onkeydown = function (e) { if (e.key === 'Enter') add(); };
            b.querySelectorAll('[data-gs]').forEach(function (x) { x.onclick = function (e) { if (e.target.tagName === 'A') return; st.show = st.show === x.dataset.gs ? 'all' : x.dataset.gs; paint(); }; });
            b.querySelectorAll('[data-grm]').forEach(function (a) { a.onclick = function () { var g = d.groups.splice(+a.dataset.grm, 1)[0]; Object.keys(map).forEach(function (v) { if (map[v] === g.name) delete map[v]; }); if (st.show === g.name) st.show = 'all'; paint(); }; });
            b.querySelectorAll('[data-gren]').forEach(function (a) { a.onclick = function () { var g = d.groups[+a.dataset.gren], n = prompt('Rename the group', g.name); if (!n || !n.trim() || n === g.name) return; n = n.trim(); Object.keys(map).forEach(function (v) { if (map[v] === g.name) map[v] = n; }); g.name = n; paint(); }; });
            b.querySelectorAll('select[data-v]').forEach(function (s) { s.onchange = function () { if (this.value) map[s.dataset.v] = this.value; else delete map[s.dataset.v]; paint(); }; });
            b.querySelectorAll('[data-sel]').forEach(function (c) { c.onchange = function () { if (c.checked) st.sel[c.dataset.sel] = 1; else delete st.sel[c.dataset.sel]; }; });
            $('gr-tick').onclick = function () { shown.forEach(function (x) { st.sel[x.v] = 1; }); paint(); };
            $('gr-untick').onclick = function () { st.sel = {}; paint(); };
            $('gr-mv').onclick = function () { var g = $('gr-move').value; Object.keys(st.sel).forEach(function (v) { if (g) map[v] = g; else delete map[v]; }); st.sel = {}; paint(); };
            var suggest = function (keyOf) {
                var n = 0; vals.forEach(function (x) {
                    if (map[x.v]) return; var k = keyOf(x); if (!k) return;
                    if (!d.groups.some(function (g) { return g.name === k; })) d.groups.push({ name: k, values: [] });
                    map[x.v] = k; n++;
                });
                FL.toast(n + ' value(s) grouped — check and rename the groups, then Save', n ? 'ok' : 'info'); paint();
            };
            $('gr-sw').onclick = function () { suggest(function (x) { var w = String(x.name || '').trim().split(/[\s\-_\/.,:]+/)[0]; return w ? w.toUpperCase() : ''; }); };
            $('gr-sp').onclick = function () { var n = +$('gr-pn').value; suggest(function (x) { return x.v ? String(x.v).slice(0, n) + '…' : ''; }); };
        }
        $('gr-ok').onclick = function () {
            d.name = ($('gr-name') && $('gr-name').value.trim()) || d.name;
            d.groups.forEach(function (g) { g.values = Object.keys(map).filter(function (v) { return map[v] === g.name; }); });
            d.groups = d.groups.filter(function (g) { return g.values.length; });
            FL.config.segGroups = Object.assign({}, FL.config.segGroups || {});
            if (d.groups.length) FL.config.segGroups[key] = d; else delete FL.config.segGroups[key];
            FL.saveConfig().then(function () {
                FL.closeModal(); FL.toast(d.groups.length ? 'Grouping "' + d.name + '" saved — ' + d.groups.length + ' group(s). Pick it under Group by.' : 'Grouping removed', 'ok');
                var s = G.st, gf = 'grp_' + col;
                if (d.groups.length && s.groups.indexOf(gf) < 0) { var i = s.groups.indexOf(col); if (i >= 0) s.groups.splice(i, 0, gf); else s.groups.push(gf, col); }
                if (!d.groups.length) s.groups = s.groups.filter(function (g) { return g !== gf; });
                FL.lsSet('segpl', Object.assign({}, s, { open: undefined })); G.side(); G.run();
            }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
        };
        $('gr-del').onclick = function () { if (!confirm('Remove the grouping "' + d.name + '"?')) return; d.groups = []; map = {}; $('gr-ok').onclick(); };
    };
})();
