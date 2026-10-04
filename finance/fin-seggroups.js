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
        var st = { q: '', show: 'none', sel: {} }, vals = [];
        FL.modal('<i class="fa-solid fa-object-group"></i> Group the values of ' + esc(G.label(col)), '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the values…</div>',
            '<button class="btn" id="gr-del"' + (cur ? '' : ' style="display:none"') + '><i class="fa-solid fa-trash"></i> Remove grouping</button><button class="btn primary" id="gr-ok"><i class="fa-solid fa-floppy-disk"></i> Save</button>');
        // every value of the segment in this ledger, with its P&L movement over the chosen periods (biggest first)
        FL.rows('SELECT COALESCE(' + col + ", '') AS v, ROUND(SUM(CASE WHEN period_seq IN (" + (G.st.periods.join(',') || '0') + ") THEN dr - cr ELSE 0 END), 2) AS net FROM fin_gl_ext_v WHERE ledger_id = " + (+L.ledger_id) +
            ' GROUP BY 1 ORDER BY ABS(SUM(CASE WHEN period_seq IN (' + (G.st.periods.join(',') || '0') + ') THEN dr - cr ELSE 0 END)) DESC, 1', 50000).then(function (rows) {
            vals = rows.map(function (r) { return { v: r.v, name: (G.valName[col] || {})[r.v] || '', net: +r.net || 0 }; });
            paint();
        }).catch(function (e) { $('m-body').innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });

        function counts() { var c = {}; vals.forEach(function (x) { var g = map[x.v]; c[g || ''] = (c[g || ''] || 0) + 1; }); return c; }
        // the list follows search + filter chip; ticked values move with one click (action bar, group chip, drag & drop, keys 1-9)
        function filtered() {
            var q = st.q.toLowerCase().trim();
            return vals.filter(function (x) {
                if (st.show === 'none' && map[x.v]) return false;
                if (st.show !== 'all' && st.show !== 'none' && map[x.v] !== st.show) return false;
                return !q || (x.v + ' ' + x.name + ' ' + (map[x.v] || 'not grouped')).toLowerCase().indexOf(q) >= 0;   // value, name or group
            });
        }
        function assign(list, g) {
            list.forEach(function (v) { if (g) map[v] = g; else delete map[v]; });
            st.sel = {}; st.last = null;
            FL.toast(list.length + ' value(s) ' + (g ? '→ ' + g : 'set to not grouped'), 'ok');
            paint(true);
        }
        function selList() { return Object.keys(st.sel); }
        function paint(keepScroll) {
            var c = counts(), nNo = c[''] || 0, shown = filtered(), nSel = selList().length;
            var sc = $('gr-list') ? $('gr-list').scrollTop : 0;
            var chip = function (key, label, n, i) {
                return '<span class="gr-chip' + (st.show === key ? ' on' : '') + (key !== 'all' ? ' gr-drop' : '') + '" data-gs="' + esc(key) + '" title="' + (key === 'all' || key === 'none' ? 'Show these' : 'Click: show this group · drop ticked rows here to move them' + (i < 9 ? ' · key ' + (i + 1) : '')) + '">' +
                    (i != null && i < 9 ? '<span class="gr-k">' + (i + 1) + '</span>' : '') + '<b>' + esc(label) + '</b> <span class="muted">' + n + '</span>' +
                    (i != null ? ' <a data-gren="' + i + '" title="Rename">✎</a> <a data-grm="' + i + '" title="Remove the group (its values become not grouped)">×</a>' : '') + '</span>';
            };
            $('m-body').innerHTML =
                '<div class="row sm" style="gap:8px;flex-wrap:wrap"><label><b>Grouping name</b> <input id="gr-name" value="' + esc(d.name) + '" style="width:220px"></label><span class="muted">shown as a field under Group by, e.g. "Channel"</span></div>' +
                '<div class="gr-groups">' + chip('all', 'All', vals.length) + chip('none', 'Not grouped', nNo) +
                d.groups.map(function (g, i) { return chip(g.name, g.name, c[g.name] || 0, i); }).join('') +
                '<span class="gr-chip add"><input id="gr-new" placeholder="New group, e.g. Door to door" style="width:190px"> <button class="btn sm" id="gr-add">Add</button></span></div>' +
                '<div class="row sm" style="gap:8px;flex-wrap:wrap;margin:6px 0"><input id="gr-q" placeholder="Search value, name or group (e.g. SP, DELIVERY, Shops)" value="' + esc(st.q) + '" style="flex:1;min-width:260px">' +
                '<span class="muted">' + shown.length + ' shown</span><button class="btn sm ghost" id="gr-paste" title="Paste a list of codes (or names) and put them in a group at once">Paste a list…</button>' +
                '<span class="muted">Suggest from</span><button class="btn sm ghost" id="gr-sw" title="One group per first word of the value name">first word</button>' +
                '<label>prefix <select id="gr-pn">' + [1, 2, 3, 4].map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select></label><button class="btn sm ghost" id="gr-sp">suggest</button></div>' +
                // action bar: appears when something is ticked
                '<div class="gr-act' + (nSel ? ' on' : '') + '">' + (nSel ? '<b>' + nSel + ' ticked</b> → move to ' + d.groups.map(function (g, i) { return '<button class="btn sm primary" data-to="' + esc(g.name) + '">' + (i < 9 ? '<span class="gr-k">' + (i + 1) + '</span> ' : '') + esc(g.name) + '</button>'; }).join('') +
                    '<button class="btn sm" data-to="">Not grouped</button><span class="grow"></span><a id="gr-untick">untick</a>'
                    : '<span class="muted">Tick rows (☐ in the header ticks every row shown, Shift+click ticks a range), then press a group — or drag them onto a group chip, or press its number key.</span>' + (d.groups.length ? '' : ' <b>Add a group first.</b>')) + '</div>' +
                '<div class="scroll" id="gr-list" style="max-height:48vh"><table class="t gr-t"><thead><tr><th><input type="checkbox" id="gr-all" title="Tick every row shown"' + (shown.length && shown.length <= 5000 && shown.every(function (x) { return st.sel[x.v]; }) ? ' checked' : '') + '></th><th>Value</th><th>Name</th><th class="n">P&amp;L movement</th><th>Group</th></tr></thead><tbody>' +
                shown.slice(0, 3000).map(function (x, i) {
                    var g = map[x.v], gi = g ? d.groups.map(function (y) { return y.name; }).indexOf(g) : -1;
                    return '<tr draggable="true" data-i="' + i + '" class="' + (st.sel[x.v] ? 'gr-on' : '') + '"><td><input type="checkbox" data-sel="' + esc(x.v) + '" data-i="' + i + '"' + (st.sel[x.v] ? ' checked' : '') + '></td><td>' + esc(x.v || '(blank)') + '</td><td>' + esc(x.name) + '</td><td class="n">' + money(x.net) + '</td>' +
                        '<td>' + (g ? '<span class="gr-badge g' + (gi % 8) + '">' + esc(g) + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
                }).join('') + '</tbody></table></div>' + (shown.length > 3000 ? '<p class="sm muted">First 3,000 of ' + shown.length + ' — search to narrow (the header tick still ticks all ' + shown.length + ').</p>' : '') +
                '<p class="sm muted">' + (vals.length - nNo) + ' of ' + vals.length + ' values grouped · values in no group show as "(not grouped)" · Save when done.</p>';
            var b = $('m-body');
            if (keepScroll && $('gr-list')) $('gr-list').scrollTop = sc;
            $('gr-name').onchange = function () { d.name = this.value.trim() || d.name; };
            $('gr-q').oninput = function () { st.q = this.value; clearTimeout(st.t); st.t = setTimeout(function () { paint(); var i = $('gr-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
            var add = function () { var n = $('gr-new').value.trim(); if (!n || d.groups.some(function (g) { return g.name === n; })) return; d.groups.push({ name: n, values: [] }); paint(true); setTimeout(function () { if ($('gr-new')) $('gr-new').focus(); }, 0); };
            $('gr-add').onclick = add; $('gr-new').onkeydown = function (e) { if (e.key === 'Enter') add(); };
            b.querySelectorAll('[data-gs]').forEach(function (x) {
                x.onclick = function (e) { if (e.target.tagName === 'A') return; st.show = x.dataset.gs; paint(); };
                if (!x.classList.contains('gr-drop')) return;
                x.ondragover = function (e) { e.preventDefault(); x.classList.add('over'); };
                x.ondragleave = function () { x.classList.remove('over'); };
                x.ondrop = function (e) { e.preventDefault(); x.classList.remove('over'); var l = selList(); if (l.length) assign(l, x.dataset.gs === 'none' ? '' : x.dataset.gs); };
            });
            b.querySelectorAll('[data-to]').forEach(function (x) { x.onclick = function () { assign(selList(), x.dataset.to); }; });
            b.querySelectorAll('[data-grm]').forEach(function (a) { a.onclick = function (e) { e.stopPropagation(); var g = d.groups.splice(+a.dataset.grm, 1)[0]; Object.keys(map).forEach(function (v) { if (map[v] === g.name) delete map[v]; }); if (st.show === g.name) st.show = 'all'; paint(); }; });
            b.querySelectorAll('[data-gren]').forEach(function (a) { a.onclick = function (e) { e.stopPropagation(); var g = d.groups[+a.dataset.gren], n = prompt('Rename the group', g.name); if (!n || !n.trim() || n === g.name) return; n = n.trim(); Object.keys(map).forEach(function (v) { if (map[v] === g.name) map[v] = n; }); if (st.show === g.name) st.show = n; g.name = n; paint(true); }; });
            if ($('gr-untick')) $('gr-untick').onclick = function () { st.sel = {}; paint(true); };
            $('gr-all').onchange = function () { if (this.checked) shown.forEach(function (x) { st.sel[x.v] = 1; }); else shown.forEach(function (x) { delete st.sel[x.v]; }); paint(true); };
            // tick: click anywhere on the row, Shift+click ticks the range from the last one
            var tick = function (i, shift) {
                var x = shown[i]; if (!x) return;
                var on = !st.sel[x.v];
                if (shift && st.last != null) { var a0 = Math.min(st.last, i), a1 = Math.max(st.last, i); for (var k = a0; k <= a1; k++) { if (on) st.sel[shown[k].v] = 1; else delete st.sel[shown[k].v]; } }
                else if (on) st.sel[x.v] = 1; else delete st.sel[x.v];
                st.last = i; paint(true);
            };
            b.querySelectorAll('tr[data-i]').forEach(function (tr) {
                tr.onclick = function (e) { if (e.target.tagName === 'INPUT') { e.preventDefault(); } tick(+tr.dataset.i, e.shiftKey); };
                tr.ondragstart = function (e) { var x = shown[+tr.dataset.i]; if (x && !st.sel[x.v]) { st.sel[x.v] = 1; } e.dataTransfer.setData('text/plain', 'gr'); e.dataTransfer.effectAllowed = 'move'; };
            });
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
            $('gr-paste').onclick = pasteList;
        }
        // keys 1-9 move the ticked rows to that group (not while typing in a box)
        st.key = function (e) {
            if (!$('gr-list') || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
            var n = +e.key; if (!(n >= 1 && n <= 9) || !d.groups[n - 1] || !selList().length) return;
            e.preventDefault(); assign(selList(), d.groups[n - 1].name);
        };
        document.addEventListener('keydown', st.key);
        var obs = setInterval(function () { if (!$('gr-list') && !$('gr-name')) { document.removeEventListener('keydown', st.key); clearInterval(obs); } }, 1000);
        // paste codes / names (one per line, or separated by commas) → a group
        function pasteList() {
            var box = document.createElement('div'); box.className = 'gr-pastebox card';
            box.innerHTML = '<b>Paste values</b> <span class="sm muted">codes or names, one per line or separated by commas / tabs (e.g. a column copied from Excel)</span>' +
                '<textarea id="gr-pt" rows="6" style="width:100%;margin:6px 0"></textarea><div class="row sm" style="gap:8px">Put them in <select id="gr-pg">' +
                d.groups.map(function (g) { return '<option>' + esc(g.name) + '</option>'; }).join('') + '<option value="__new">a new group…</option></select><span class="grow"></span><span id="gr-pinfo" class="muted"></span>' +
                '<button class="btn sm" id="gr-pc">Cancel</button><button class="btn sm primary" id="gr-pok">Put in group</button></div>';
            $('m-body').insertBefore(box, $('m-body').firstChild); $('gr-pt').focus();
            var match = function () {
                var toks = $('gr-pt').value.split(/[\n\r,;\t]+/).map(function (t) { return t.trim(); }).filter(Boolean), hit = {}, miss = [];
                toks.forEach(function (t) { var u = t.toUpperCase(), m = vals.filter(function (x) { return String(x.v).toUpperCase() === u || String(x.name).toUpperCase() === u; }); if (m.length) m.forEach(function (x) { hit[x.v] = 1; }); else miss.push(t); });
                return { hit: Object.keys(hit), miss: miss };
            };
            $('gr-pt').oninput = function () { var r = match(); $('gr-pinfo').textContent = r.hit.length + ' matched' + (r.miss.length ? ' · ' + r.miss.length + ' not found: ' + r.miss.slice(0, 5).join(', ') + (r.miss.length > 5 ? ' …' : '') : ''); };
            $('gr-pc').onclick = function () { box.remove(); };
            $('gr-pok').onclick = function () {
                var r = match(), g = $('gr-pg').value;
                if (g === '__new') { g = (prompt('Name of the new group') || '').trim(); if (!g) return; if (!d.groups.some(function (x) { return x.name === g; })) d.groups.push({ name: g, values: [] }); }
                if (!r.hit.length) { FL.toast('Nothing matched — paste codes (SP32) or names exactly as listed', 'err'); return; }
                assign(r.hit, g);
            };
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
