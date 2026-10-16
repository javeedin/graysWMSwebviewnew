/* Oracle BIP Reporting · the page's own data grid and pivot (window.BIPG) — plain HTML, no DevExtreme / jQuery.
 * BIPG.grid(el, { columns, rows, height, key, name, toast, more })  → { rows(), columns(), state, setRows(), refresh(), destroy() }
 *   sticky header, click to sort (asc → desc → none), a filter box per column (contains, =x, !x, >n, <n, a..b), a search over every
 *   column, windowed rows (only what is on screen is in the DOM — 500,000 rows scroll like 50), numeric columns right-aligned with a
 *   totals row over the filtered rows, column chooser, drag to resize, CSV / Excel (ExcelJS when loaded) / Copy (TSV for Excel).
 *   Hidden columns and widths are remembered per `key` on this PC (localStorage bip.grid.<key>).
 * BIPG.pivot(el, { columns, rows, name, state, onState, toast })  → { state, refresh(), destroy() }
 *   row fields (chips, any number), column fields, value column + function (sum / count / avg / min / max), subtotal per first row
 *   field, column and grand totals, rows sorted by key or by total, CSV / Copy; the layout goes to `onState` (kept per report). */
(function (root) {
    'use strict';
    var E = root.BIPE, G = root.BIPG = {};
    var ROW_H = 30, BUFFER = 12;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function ls(k, d) { try { var v = localStorage.getItem('bip.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem('bip.' + k, JSON.stringify(v)); } catch (e) { } }
    function download(name, text, type) {
        var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
        if (root.saveAs) { root.saveAs(blob, name); return; }
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 500);
    }
    function copyText(text, toast, what) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'))).then(function () { if (toast) toast(what + ' copied — paste into Excel', 'ok'); }, function () { if (toast) toast('The clipboard is not available here', 'warn'); }); }
    function excel(name, columns, rows, toast) {
        if (!root.ExcelJS) { if (toast) toast('Excel needs ExcelJS (loaded from the CDN) — CSV written instead', 'warn'); download(name + '.csv', E.csvOf(rows, columns)); return; }
        var wb = new root.ExcelJS.Workbook(), ws = wb.addWorksheet(String(name || 'Report').slice(0, 30).replace(/[\[\]\*\/\\\?:]/g, ' ') || 'Report');
        ws.addRow(columns); rows.forEach(function (r) { ws.addRow(columns.map(function (c) { var v = r[c]; return v == null ? null : v; })); });
        ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.columns.forEach(function (col, i) { var w = Math.min(60, Math.max(10, String(columns[i] || '').length + 2)); rows.slice(0, 200).forEach(function (r) { var v = r[columns[i]]; if (v != null) w = Math.min(60, Math.max(w, String(v).length + 2)); }); col.width = w; });
        wb.xlsx.writeBuffer().then(function (buf) { download(name + '.xlsx', buf, 'application/octet-stream'); });
    }
    function kindsOf(rows, columns) { var k = {}; E.summary((rows || []).slice(0, 2000), columns).forEach(function (c) { k[c.column] = c.kind; }); return k; }
    function fmtCell(v, kind) { if (v == null) return ''; if (kind === 'number') return E.fmtNum(v); return String(v); }

    // ── grid ────────────────────────────────────────────────────
    G.grid = function (el, o) {
        o = o || {};
        var api = { el: el, state: null }, rows = o.rows || [], columns = (o.columns || (rows[0] ? Object.keys(rows[0]) : [])).slice();
        var saved = o.key ? ls('grid.' + o.key, {}) : {};
        var st = api.state = { sort: null, dir: 'asc', filters: {}, q: '', hidden: saved.hidden || {}, widths: saved.widths || {}, order: columns.slice() };
        var kinds = kindsOf(rows, columns), view = rows, raf = null, wrap, tbody, lastStart = -1, lastEnd = -1, destroyed = false;
        function save() { if (o.key) lsSet('grid.' + o.key, { hidden: st.hidden, widths: st.widths }); }
        function visible() { return st.order.filter(function (c) { return !st.hidden[c]; }); }
        function widthOf(c) {
            if (st.widths[c]) return st.widths[c];
            var w = String(c).length;
            for (var i = 0; i < Math.min(rows.length, 60); i++) { var v = rows[i][c]; if (v != null) w = Math.max(w, String(v).length); }
            return Math.max(70, Math.min(360, w * 7.5 + 22));
        }
        function compute() {
            view = E.filterRows(rows, st.filters, st.q, columns);
            if (st.sort) view = E.sortRows(view, st.sort, st.dir);
        }
        function shell() {
            el.classList.add('bg');
            el.innerHTML = '<div class="bg-bar"><input type="search" class="bg-q" placeholder="Search every column…" value="' + esc(st.q) + '"><span class="bg-count"></span><span class="bg-sp"></span>' +
                (o.more ? '<span class="bg-more muted small">' + esc(E.fmtNum(o.more.loaded)) + ' of ' + esc(E.fmtNum(o.more.total)) + ' rows loaded · <a data-g="more">load more</a></span>' : '') +
                '<button class="btn sm" data-g="cols" title="Show / hide columns"><i class="fas fa-table-columns"></i> Columns</button><button class="btn sm" data-g="csv" title="The filtered rows as a CSV file"><i class="fas fa-file-csv"></i> CSV</button><button class="btn sm" data-g="xlsx" title="The filtered rows as an Excel file"><i class="fas fa-file-excel"></i> Excel</button><button class="btn sm" data-g="copy" title="Copy the filtered rows for Excel"><i class="fas fa-copy"></i> Copy</button><button class="btn sm ghost" data-g="reset" title="Clear sorting, filters, hidden columns and widths">Reset</button></div>' +
                '<div class="bg-colpick" hidden></div>' +
                '<div class="bg-wrap" style="height:' + (o.height || 520) + 'px"><table class="bg-t"><colgroup></colgroup><thead></thead><tbody></tbody><tfoot></tfoot></table></div>';
            wrap = el.querySelector('.bg-wrap'); tbody = el.querySelector('tbody');
            wrap.addEventListener('scroll', function () { if (raf) return; raf = requestAnimationFrame(function () { raf = null; window_(); }); });
            el.addEventListener('click', onClick);
            el.addEventListener('input', onInput);
            el.addEventListener('mousedown', onDown);
        }
        function head() {
            var cols = visible();
            el.querySelector('colgroup').innerHTML = cols.map(function (c) { return '<col style="width:' + widthOf(c) + 'px">'; }).join('');
            el.querySelector('thead').innerHTML = '<tr class="bg-h">' + cols.map(function (c) { return '<th class="' + (kinds[c] === 'number' ? 'r' : '') + (st.sort === c ? ' sorted' : '') + '" data-c="' + esc(c) + '" title="' + esc(c) + ' — click to sort"><span class="bg-lbl">' + esc(c) + '</span>' + (st.sort === c ? '<i class="fas fa-arrow-' + (st.dir === 'asc' ? 'up' : 'down') + '"></i>' : '') + '<span class="bg-rs" data-rs="' + esc(c) + '"></span></th>'; }).join('') + '</tr>' +
                '<tr class="bg-f">' + cols.map(function (c) { return '<th><input type="text" class="bg-fi" data-c="' + esc(c) + '" value="' + esc(st.filters[c] || '') + '" placeholder="' + (kinds[c] === 'number' ? '>, <, a..b' : 'filter') + '" title="contains · =exact · !not · >n <n · a..b"></th>'; }).join('') + '</tr>';
        }
        function foot() {
            var cols = visible(), nums = cols.filter(function (c) { return kinds[c] === 'number'; });
            if (!nums.length || !view.length) { el.querySelector('tfoot').innerHTML = ''; return; }
            var sums = {}; nums.forEach(function (c) { sums[c] = 0; });
            view.forEach(function (r) { nums.forEach(function (c) { var n = E.num(r[c]); if (n != null) sums[c] += n; }); });
            el.querySelector('tfoot').innerHTML = '<tr class="bg-tot">' + cols.map(function (c, i) { return '<td class="' + (kinds[c] === 'number' ? 'r num' : '') + '" title="' + (kinds[c] === 'number' ? 'sum of the ' + E.fmtNum(view.length) + ' filtered rows' : '') + '">' + (kinds[c] === 'number' ? esc(E.fmtNum(sums[c], Number.isInteger(sums[c]) ? 0 : 2)) : i === 0 ? '<span class="bg-totlbl">Σ ' + esc(E.fmtNum(view.length)) + ' rows</span>' : '') + '</td>'; }).join('') + '</tr>';
        }
        function count() { var c = el.querySelector('.bg-count'); if (c) c.textContent = view.length === rows.length ? E.fmtNum(rows.length) + ' rows' : E.fmtNum(view.length) + ' of ' + E.fmtNum(rows.length) + ' rows'; }
        function window_(force) {
            var cols = visible(), total = view.length;
            var top = wrap.scrollTop, h = wrap.clientHeight || (o.height || 520);
            var start = Math.max(0, Math.floor(top / ROW_H) - BUFFER), end = Math.min(total, Math.ceil((top + h) / ROW_H) + BUFFER);
            if (!force && start === lastStart && end === lastEnd) return;
            lastStart = start; lastEnd = end;
            var html = '';
            if (!total) html = '<tr class="bg-empty"><td colspan="' + Math.max(1, cols.length) + '">' + (rows.length ? 'No row matches the filters.' : 'No rows.') + '</td></tr>';
            else {
                if (start > 0) html += '<tr class="bg-sp"><td colspan="' + cols.length + '" style="height:' + (start * ROW_H) + 'px"></td></tr>';
                for (var i = start; i < end; i++) {
                    var r = view[i]; html += '<tr>';
                    for (var j = 0; j < cols.length; j++) { var c = cols[j], v = r[c]; html += '<td class="' + (kinds[c] === 'number' ? 'r num' : '') + '" title="' + esc(v == null ? '' : String(v).slice(0, 300)) + '">' + esc(fmtCell(v, kinds[c])) + '</td>'; }
                    html += '</tr>';
                }
                if (end < total) html += '<tr class="bg-sp"><td colspan="' + cols.length + '" style="height:' + ((total - end) * ROW_H) + 'px"></td></tr>';
            }
            tbody.innerHTML = html;
        }
        function paint() { compute(); head(); foot(); count(); lastStart = -1; window_(true); }
        function colPick() {
            var box = el.querySelector('.bg-colpick'); if (!box.hidden) { box.hidden = true; return; }
            box.innerHTML = '<div class="bg-cp-bar"><a data-g="colsAll">all</a> · <a data-g="colsNone">none</a> · <a data-g="colsClose">close</a></div>' + st.order.map(function (c) { return '<label><input type="checkbox" data-col="' + esc(c) + '" ' + (st.hidden[c] ? '' : 'checked') + '> ' + esc(c) + ' <span class="muted small">' + esc(kinds[c] || '') + '</span></label>'; }).join('');
            box.hidden = false;
        }
        function onClick(e) {
            var g = e.target.closest('[data-g]');
            if (g) {
                e.preventDefault();
                var cols = visible();
                switch (g.dataset.g) {
                    case 'cols': colPick(); break;
                    case 'colsAll': st.hidden = {}; save(); paint(); colPick(); colPick(); break;
                    case 'colsNone': st.order.forEach(function (c, i) { if (i) st.hidden[c] = 1; }); save(); paint(); colPick(); colPick(); break;
                    case 'colsClose': el.querySelector('.bg-colpick').hidden = true; break;
                    case 'csv': download((o.name || 'report') + '.csv', E.csvOf(view, cols)); break;
                    case 'xlsx': excel(o.name || 'report', cols, view, o.toast); break;
                    case 'copy': copyText(cols.join('\t') + '\n' + view.map(function (r) { return cols.map(function (c) { return r[c] == null ? '' : String(r[c]).replace(/\t|\n/g, ' '); }).join('\t'); }).join('\n'), o.toast, E.fmtNum(view.length) + ' rows'); break;
                    case 'reset': st.sort = null; st.filters = {}; st.q = ''; st.hidden = {}; st.widths = {}; save(); el.querySelector('.bg-q').value = ''; paint(); break;
                    case 'more': if (o.more && o.more.onMore) o.more.onMore(); break;
                }
                return;
            }
            var th = e.target.closest('th[data-c]');
            if (th && !e.target.classList.contains('bg-rs')) {
                var c = th.dataset.c;
                if (st.sort === c) { if (st.dir === 'asc') st.dir = 'desc'; else { st.sort = null; st.dir = 'asc'; } } else { st.sort = c; st.dir = 'asc'; }
                paint();
            }
        }
        var inputT = null;
        function onInput(e) {
            var t = e.target;
            if (t.classList.contains('bg-fi')) { st.filters[t.dataset.c] = t.value; clearTimeout(inputT); inputT = setTimeout(function () { var f = document.activeElement; var c = f && f.dataset ? f.dataset.c : null; var pos = f && f.selectionStart; compute(); foot(); count(); lastStart = -1; window_(true); if (c) { var again = el.querySelector('.bg-fi[data-c="' + CSS.escape(c) + '"]'); if (again && again !== f) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (x) { } } } }, 160); }
            else if (t.classList.contains('bg-q')) { st.q = t.value; clearTimeout(inputT); inputT = setTimeout(function () { compute(); foot(); count(); lastStart = -1; window_(true); }, 160); }
            else if (t.dataset && t.dataset.col) { if (t.checked) delete st.hidden[t.dataset.col]; else st.hidden[t.dataset.col] = 1; save(); var box = el.querySelector('.bg-colpick'); paint(); box.hidden = false; }
        }
        function onDown(e) {
            var h = e.target.closest('.bg-rs'); if (!h) return;
            e.preventDefault();
            var c = h.dataset.rs, x0 = e.clientX, w0 = widthOf(c), colIdx = visible().indexOf(c), colEl = el.querySelectorAll('colgroup col')[colIdx];
            function move(ev) { var w = Math.max(40, Math.min(900, w0 + ev.clientX - x0)); st.widths[c] = w; if (colEl) colEl.style.width = w + 'px'; }
            function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(); }
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        }
        api.rows = function () { return view; };
        api.columns = function () { return visible(); };
        api.kinds = function () { return kinds; };
        api.setRows = function (r, c, more) { rows = r || []; if (c) { columns = c.slice(); st.order = c.slice(); } kinds = kindsOf(rows, columns); o.more = more || null; var m = el.querySelector('.bg-more'); if (m) m.outerHTML = o.more ? '<span class="bg-more muted small">' + esc(E.fmtNum(o.more.loaded)) + ' of ' + esc(E.fmtNum(o.more.total)) + ' rows loaded · <a data-g="more">load more</a></span>' : ''; paint(); };
        api.refresh = function () { paint(); };
        api.destroy = function () { destroyed = true; el.innerHTML = ''; el.classList.remove('bg'); };
        shell(); paint();
        return api;
    };

    // ── pivot ───────────────────────────────────────────────────
    G.pivot = function (el, o) {
        o = o || {};
        var rows = o.rows || [], columns = (o.columns || (rows[0] ? Object.keys(rows[0]) : [])).slice();
        var sm = E.summary((rows || []).slice(0, 2000), columns), kinds = {}; sm.forEach(function (c) { kinds[c.column] = c.kind; });
        var nums = columns.filter(function (c) { return kinds[c] === 'number'; }), cats = columns.filter(function (c) { return kinds[c] !== 'number'; });
        var st = Object.assign({ rows: [], cols: [], value: '', fn: 'sum', sort: 'key', subtotals: true }, o.state || {});
        st.rows = (st.rows || []).filter(function (c) { return columns.indexOf(c) >= 0; }); st.cols = (st.cols || []).filter(function (c) { return columns.indexOf(c) >= 0; });
        if (st.value && columns.indexOf(st.value) < 0) st.value = '';
        if (!st.rows.length && !o.state) {
            // the first text column that groups the rows (2–60 values), else the first text column; the first number column as the value
            var byCol = {}; sm.forEach(function (c) { byCol[c.column] = c; });
            var pick = cats.filter(function (c) { var d = byCol[c] ? byCol[c].distinct : 0; return d >= 2 && d <= 60; })[0] || cats[0];
            if (pick) st.rows = [pick]; if (nums[0]) st.value = nums[0];
        }
        var api = { el: el, state: st }, pv = null;
        function emit() { if (o.onState) o.onState({ rows: st.rows, cols: st.cols, value: st.value, fn: st.fn, sort: st.sort, subtotals: st.subtotals }); }
        function pickers() {
            var free = columns.filter(function (c) { return st.rows.indexOf(c) < 0 && st.cols.indexOf(c) < 0; });
            function chips(list, kind) { return list.map(function (c) { return '<span class="chip on">' + esc(c) + ' <a data-p="drop" data-k="' + kind + '" data-c="' + esc(c) + '" title="remove">✕</a></span>'; }).join('') + '<select data-p="add" data-k="' + kind + '"><option value="">+ add…</option>' + free.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select>'; }
            return '<div class="bp-bar"><div class="bp-f"><label>Rows</label><div class="chips">' + chips(st.rows, 'rows') + '</div></div><div class="bp-f"><label>Columns</label><div class="chips">' + chips(st.cols, 'cols') + '</div></div>' +
                '<div class="bp-f"><label>Value</label><select data-p="value"><option value="">(count of rows)</option>' + nums.map(function (c) { return '<option ' + (st.value === c ? 'selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
                '<div class="bp-f"><label>Function</label><select data-p="fn" ' + (st.value ? '' : 'disabled') + '>' + ['sum', 'avg', 'min', 'max', 'count'].map(function (f) { return '<option ' + (st.fn === f ? 'selected' : '') + '>' + f + '</option>'; }).join('') + '</select></div>' +
                '<div class="bp-f"><label>Rows sorted by</label><select data-p="sort"><option value="key" ' + (st.sort === 'key' ? 'selected' : '') + '>name</option><option value="total" ' + (st.sort === 'total' ? 'selected' : '') + '>total, largest first</option></select></div>' +
                '<div class="bp-f"><label>&nbsp;</label><label class="chk"><input type="checkbox" data-p="subtotals" ' + (st.subtotals ? 'checked' : '') + '> subtotals</label></div>' +
                '<span class="bg-sp"></span><button class="btn sm" data-p="swap" title="Rows ↔ columns"><i class="fas fa-right-left"></i> Swap</button><button class="btn sm" data-p="csv"><i class="fas fa-file-csv"></i> CSV</button><button class="btn sm" data-p="xlsx"><i class="fas fa-file-excel"></i> Excel</button><button class="btn sm" data-p="copy"><i class="fas fa-copy"></i> Copy</button></div>';
        }
        function colLabel(keys) { return keys.length ? keys.join(' · ') : (st.value ? st.fn + ' of ' + st.value : 'rows'); }
        function fmt(v) { return v == null ? '' : E.fmtNum(v, st.fn === 'count' || st.fn === 'sum' && Number.isInteger(v) ? 0 : 2); }
        function table() {
            if (!st.rows.length && !st.cols.length) return '<div class="empty">Add a row field (and a column field) to pivot the rows.</div>';
            pv = E.pivot(rows, { rows: st.rows, cols: st.cols, value: st.value, fn: st.fn, sort: st.sort });
            var sub = st.subtotals && st.rows.length > 1 && st.sort === 'key' ? E.pivot(rows, { rows: st.rows.slice(0, 1), cols: st.cols, value: st.value, fn: st.fn }) : null;
            var subBy = {}; if (sub) sub.rows.forEach(function (r) { subBy[r.keys[0]] = r; });
            var h = '<table class="bp-t"><thead><tr>' + st.rows.map(function (f) { return '<th class="bp-rh">' + esc(f) + '</th>'; }).join('') + (st.rows.length ? '' : '<th></th>') + pv.cols.map(function (k) { return '<th class="r" title="' + esc(colLabel(k)) + '">' + esc(colLabel(k)) + '</th>'; }).join('') + (pv.cols.length > 1 || !pv.cols.length ? '<th class="r bp-tot">Total</th>' : '') + '</tr></thead><tbody>';
            var showTot = pv.cols.length > 1 || !pv.cols.length;
            var prev = null, groupN = 0;
            pv.rows.forEach(function (r, i) {
                var first = r.keys[0];
                if (sub && prev != null && first !== prev && groupN > 1) h += subRow(subBy[prev]);
                if (first !== prev) groupN = 0; groupN++;
                h += '<tr>' + r.keys.map(function (k, j) { var same = j === 0 && sub && prev === first; return '<td class="bp-k' + (j ? ' bp-k2' : '') + '">' + (same ? '' : esc(k)) + '</td>'; }).join('') + (st.rows.length ? '' : '<td></td>') + r.values.map(function (v) { return '<td class="r num">' + fmt(v) + '</td>'; }).join('') + (showTot ? '<td class="r num bp-tot">' + fmt(r.total) + '</td>' : '') + '</tr>';
                prev = first;
            });
            if (sub && prev != null && groupN > 1) h += subRow(subBy[prev]);
            h += '</tbody><tfoot><tr class="bp-g"><td colspan="' + Math.max(1, st.rows.length) + '">Total · ' + esc(E.fmtNum(rows.length)) + ' rows</td>' + pv.colTotals.map(function (v) { return '<td class="r num">' + fmt(v) + '</td>'; }).join('') + (showTot ? '<td class="r num bp-tot">' + fmt(pv.grand) + '</td>' : '') + '</tr></tfoot></table>' +
                (pv.colsCut ? '<div class="warnbox" style="margin-top:6px">Only the first ' + pv.cols.length + ' column values are shown (' + pv.colsCut + ' more go into the totals) — pick a column field with fewer values.</div>' : '');
            function subRow(s) { if (!s) return ''; return '<tr class="bp-sub"><td colspan="' + st.rows.length + '">Total ' + esc(s.keys[0]) + '</td>' + s.values.map(function (v) { return '<td class="r num">' + fmt(v) + '</td>'; }).join('') + (showTot ? '<td class="r num bp-tot">' + fmt(s.total) + '</td>' : '') + '</tr>'; }
            return h;
        }
        function flat() {
            if (!pv) return { columns: [], rows: [] };
            var cols = st.rows.slice(), rowsOut = []; pv.cols.forEach(function (k) { cols.push(colLabel(k)); }); if (pv.cols.length > 1 || !pv.cols.length) cols.push('Total');
            pv.rows.forEach(function (r) { var o2 = {}; st.rows.forEach(function (f, i) { o2[f] = r.keys[i]; }); pv.cols.forEach(function (k, i) { o2[colLabel(k)] = r.values[i]; }); if (pv.cols.length > 1 || !pv.cols.length) o2.Total = r.total; rowsOut.push(o2); });
            return { columns: cols, rows: rowsOut };
        }
        function paint() { el.classList.add('bp'); el.innerHTML = pickers() + '<div class="bp-wrap">' + table() + '</div>'; }
        el.addEventListener('change', function (e) {
            var t = e.target.closest('[data-p]'); if (!t) return;
            var p = t.dataset.p;
            if (p === 'add' && t.value) { st[t.dataset.k].push(t.value); }
            else if (p === 'value') { st.value = t.value; if (!st.value) st.fn = 'count'; else if (st.fn === 'count') st.fn = 'sum'; }
            else if (p === 'fn') st.fn = t.value;
            else if (p === 'sort') st.sort = t.value;
            else if (p === 'subtotals') st.subtotals = t.checked;
            else return;
            emit(); paint();
        });
        el.addEventListener('click', function (e) {
            var t = e.target.closest('[data-p]'); if (!t || t.tagName === 'SELECT' || t.tagName === 'INPUT') return;
            e.preventDefault();
            var p = t.dataset.p;
            if (p === 'drop') { st[t.dataset.k] = st[t.dataset.k].filter(function (c) { return c !== t.dataset.c; }); emit(); paint(); }
            else if (p === 'swap') { var r = st.rows; st.rows = st.cols; st.cols = r; emit(); paint(); }
            else if (p === 'csv') { var f = flat(); download((o.name || 'report') + '-pivot.csv', E.csvOf(f.rows, f.columns)); }
            else if (p === 'xlsx') { var f2 = flat(); excel((o.name || 'report') + '-pivot', f2.columns, f2.rows, o.toast); }
            else if (p === 'copy') { var f3 = flat(); copyText(f3.columns.join('\t') + '\n' + f3.rows.map(function (r) { return f3.columns.map(function (c) { return r[c] == null ? '' : String(r[c]); }).join('\t'); }).join('\n'), o.toast, 'The pivot'); }
        });
        api.refresh = paint; api.flat = flat;
        api.destroy = function () { el.innerHTML = ''; el.classList.remove('bp'); };
        paint();
        return api;
    };
})(window);
