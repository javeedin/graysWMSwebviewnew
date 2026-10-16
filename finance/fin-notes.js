/* Finance Lens — notes on the statements. Any number of notes for the period on screen, or for every period (global); for this statement
   or every statement; on the whole statement or on one line; of a kind (note, commentary, action, risk). Lines with notes get a
   numbered marker, the notes are listed under the statement (numbered like a published statement), and the board pack shows them too.
   Stored twice: this PC's DuckDB file (fin_notes, host finNotesList / finNotesSave) and APEX (WMS_FIN_NOTES, FL.apexStore.notes*);
   N.load merges both by rev (a delete is a removed = true row so it reaches every PC) and writes back to the side that is older. */
(function () {
    var N = FL.notes = { all: null, loading: null, apexOk: null };
    N.KINDS = { note: ['Note', '#1d4ed8', 'fa-regular fa-note-sticky'], comment: ['Commentary', '#0d9488', 'fa-regular fa-comment'], action: ['Action', '#b45309', 'fa-solid fa-list-check'], risk: ['Risk', '#b91c1c', 'fa-solid fa-triangle-exclamation'] };
    var who = function () { return (FL.who && FL.who.user) || appUser() || 'WMS'; };
    var now = function () { var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
    var newer = function (a, b) { return !b || (a.rev || 0) > (b.rev || 0) || ((a.rev || 0) === (b.rev || 0) && String(a.changedAt || '') > String(b.changedAt || '')); };
    N.md = function (t) {
        var h = esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>');
        h = h.replace(/(?:^|\n)((?:[-•] .*(?:\n|$))+)/g, function (m, b) { return '\n<ul>' + b.trim().split('\n').map(function (l) { return '<li>' + l.replace(/^[-•] /, '') + '</li>'; }).join('') + '</ul>'; });
        return h.split(/\n{2,}/).map(function (p) { return /^\s*<ul/.test(p) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
    };

    /** Every note (removed ones too), merged from this PC and APEX; the older side is brought up to date */
    N.load = function (force) {
        if (N.all && !force) return Promise.resolve(N.all);
        if (N.loading) return N.loading;
        N.loading = Promise.all([
            FL.call('finNotesList').then(function (r) { return r.notes || []; }).catch(function (e) { console.warn('[Notes] this PC:', e); return []; }),
            FL.apexStore.notesList().catch(function (e) { console.warn('[Notes] APEX:', e); return null; })
        ]).then(function (rr) {
            var duck = {}, apex = {}, all = {};
            rr[0].forEach(function (n) { duck[n.id] = n; });
            N.apexOk = rr[1] != null;
            (rr[1] || []).forEach(function (n) { apex[n.id] = n; });
            Object.keys(duck).concat(Object.keys(apex)).forEach(function (id) { var a = duck[id], b = apex[id]; all[id] = !a ? b : !b ? a : newer(b, a) ? b : a; });
            var toDuck = [], toApex = [];
            Object.keys(all).forEach(function (id) { var n = all[id]; if (newer(n, duck[id]) && n !== duck[id]) toDuck.push(n); if (N.apexOk && n !== apex[id] && newer(n, apex[id])) toApex.push(n); });
            if (toDuck.length) FL.call('finNotesSave', { notes: toDuck }).catch(function (e) { console.warn('[Notes] not copied to this PC:', e); });
            if (toApex.length) FL.apexStore.notesSave(toApex).catch(function (e) { console.warn('[Notes] not copied to APEX:', e); });
            N.all = Object.keys(all).map(function (id) { return all[id]; });
            N.loading = null;
            return N.all;
        });
        return N.loading;
    };
    /** Saves one note on this PC and in APEX (ev = add / edit / delete for the audit) */
    N.save = function (n, ev) {
        n.rev = (n.rev || 0) + 1; n.changedBy = who(); n.changedAt = now();
        if (!n.createdAt) { n.createdAt = n.changedAt; n.createdBy = n.changedBy; }
        var i = (N.all || []).map(function (x) { return x.id; }).indexOf(n.id); if (i >= 0) N.all[i] = n; else (N.all = N.all || []).push(n);
        return FL.call('finNotesSave', { notes: [n], event: ev, target: (n.title || n.rowLabel || n.id) }).then(function () {
            return FL.apexStore.notesSave([n]).then(function () { N.apexOk = true; }, function (e) { N.apexOk = false; FL.toast('Saved on this PC — not in APEX yet (' + (e && e.message || e) + '); it is sent the next time the notes are opened', 'info'); });
        });
    };

    /** The notes shown with a statement: this period's and the global ones, of this statement or every statement, matching the ledger / company */
    N.forView = function (tplId, period, filter) {
        filter = filter || FL.filter;
        return (N.all || []).filter(function (n) {
            if (n.removed) return false;
            if (n.tpl && n.tpl !== '*' && n.tpl !== tplId) return false;
            if (n.scope !== 'GLOBAL' && +n.period !== +period) return false;
            if (n.ledger && filter.ledger && n.ledger !== filter.ledger) return false;
            if (n.company && n.company !== (filter.company || '')) return false;
            return true;
        });
    };
    /** Numbers the notes like a published statement: whole-statement notes first, then by the line's place, then by order */
    N.number = function (list, st) {
        var pos = {}; ((st && st.rows) || []).forEach(function (r, i) { pos[r.id] = i; });
        return list.slice().sort(function (a, b) {
            var pa = a.row ? (pos[a.row] != null ? pos[a.row] : 9e5) : -1, pb = b.row ? (pos[b.row] != null ? pos[b.row] : 9e5) : -1;
            return pa - pb || (a.sort || 0) - (b.sort || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        }).map(function (n, i) { return Object.assign({}, n, { no: i + 1 }); });
    };
    var scopeText = function (n) { return n.scope === 'GLOBAL' ? 'every period' : FL.periodName(n.period); };

    /** The Notes block (HTML) under a statement — also used by the board pack (plain = no buttons) */
    N.blockHtml = function (list, plain) {
        if (!list.length) return '';
        return '<div class="st-notes"><h3>Notes</h3>' + list.map(function (n) {
            var k = N.KINDS[n.kind] || N.KINDS.note;
            return '<div class="st-note" data-id="' + esc(n.id) + '" style="border-left-color:' + k[1] + '"><div class="st-nh"><span class="st-nno">' + n.no + '</span>' +
                '<span class="st-nk" style="color:' + k[1] + '">' + k[0] + '</span>' + (n.title ? '<b>' + esc(n.title) + '</b>' : '') + (n.rowLabel ? '<span class="st-nl">' + esc(n.rowLabel) + '</span>' : '') +
                '<span class="st-ns">' + esc(scopeText(n)) + (n.tpl === '*' ? ' · every statement' : '') + (n.company ? ' · ' + esc(n.company) : '') + '</span>' +
                (plain ? '' : '<span class="grow"></span><span class="st-nby">' + esc((n.changedBy || '') + ' · ' + String(n.changedAt || '').slice(0, 16)) + '</span><button class="icon" data-ned="' + esc(n.id) + '" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="icon" data-ndel="' + esc(n.id) + '" title="Delete"><i class="fa-solid fa-trash"></i></button>') +
                '</div><div class="st-nb">' + N.md(n.body) + '</div></div>';
        }).join('') + '</div>';
    };

    /** After a statement is drawn: markers on the lines, the Notes block, the toolbar count, "add a note" on every line */
    N.decorate = function (el, tpl, st) {
        return N.load().then(function () {
            if (!el.isConnected) return;
            var list = N.number(N.forView(tpl.id, FL.filter.period), st), byRow = {};
            list.forEach(function (n) { if (n.row) (byRow[n.row] = byRow[n.row] || []).push(n.no); });
            el.querySelectorAll('table.st tbody tr[data-row]').forEach(function (tr) {
                var id = tr.dataset.row, td = tr.firstElementChild; if (!td || !id || tr.classList.contains('blank')) return;
                var lv = td.querySelector('.lv') || td;
                if (byRow[id]) lv.insertAdjacentHTML('beforeend', ' <sup class="st-nref" data-row="' + esc(id) + '" title="Notes ' + byRow[id].join(', ') + '">' + byRow[id].join(',') + '</sup>');
                td.insertAdjacentHTML('beforeend', '<i class="fa-regular fa-note-sticky st-nadd" data-row="' + esc(id) + '" title="Add a note to this line"></i>');
            });
            var old = el.querySelector('.st-notes'); if (old) old.remove();
            var wrap = el.querySelector('.stmt-wrap'); if (wrap) wrap.insertAdjacentHTML('beforeend', N.blockHtml(list));
            var b = $('st-notes'); if (b) b.innerHTML = '<i class="fa-regular fa-note-sticky"></i> Notes' + (list.length ? ' <span class="st-nc">' + list.length + '</span>' : '');
            el.querySelectorAll('.st-nadd').forEach(function (i) { i.onclick = function (ev) { ev.stopPropagation(); N.edit(null, tpl, st, i.dataset.row); }; });
            el.querySelectorAll('.st-nref').forEach(function (s) { s.onclick = function (ev) { ev.stopPropagation(); var c = el.querySelector('.st-note[data-id="' + list.filter(function (n) { return n.row === s.dataset.row; })[0].id + '"]'); if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.classList.add('flash'); setTimeout(function () { c.classList.remove('flash'); }, 1400); } }; });
            el.querySelectorAll('[data-ned]').forEach(function (x) { x.onclick = function () { N.edit(N.byId(x.dataset.ned), tpl, st); }; });
            el.querySelectorAll('[data-ndel]').forEach(function (x) { x.onclick = function () { N.remove(N.byId(x.dataset.ndel)); }; });
            if (N.apexOk === false && b) b.title = 'Notes — APEX could not be reached; notes are kept on this PC and sent later';
        });
    };
    N.byId = function (id) { return (N.all || []).filter(function (n) { return n.id === id; })[0]; };
    N.remove = function (n) {
        if (!n || !confirm('Delete the note' + (n.title ? ' "' + n.title + '"' : '') + '? It is removed on every PC.')) return;
        var c = Object.assign({}, n, { removed: true });
        N.save(c, 'delete').then(function () { FL.toast('Note deleted', 'ok'); FL.render(); });
    };

    /** Add / edit a note. n = null for a new one (row = the line it starts on) */
    N.edit = function (n, tpl, st, row) {
        var isNew = !n, per = FL.filter.period;
        n = n ? Object.assign({}, n) : { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), scope: 'PERIOD', period: per, ledger: FL.filter.ledger || '', company: '', tpl: tpl.id, row: row || '', kind: 'note', title: '', body: '' };
        var rows = (st.rows || []).filter(function (r) { return r.type !== 'blank' && r.label; });
        var radio = function (name, v, cur, label) { return '<label class="sm" style="margin-right:14px"><input type="radio" name="' + name + '" value="' + v + '"' + (cur === v ? ' checked' : '') + '> ' + label + '</label>'; };
        FL.modal('<i class="fa-regular fa-note-sticky"></i> ' + (isNew ? 'Add a note' : 'Edit note') + ' · ' + esc(tpl.name),
            '<div class="grid g2"><label class="field">Kind<select id="nt-kind">' + Object.keys(N.KINDS).map(function (k) { return '<option value="' + k + '"' + (n.kind === k ? ' selected' : '') + '>' + N.KINDS[k][0] + '</option>'; }).join('') + '</select></label>' +
            '<label class="field">On<select id="nt-row"><option value="">the whole statement</option>' + rows.map(function (r) { return '<option value="' + esc(r.id) + '"' + (n.row === r.id ? ' selected' : '') + '>' + esc((r.level ? ' '.repeat(Math.min(r.level, 3)) : '') + r.label) + '</option>'; }).join('') + '</select></label></div>' +
            '<div class="field" style="margin-top:8px">Period</div>' + radio('nt-scope', 'PERIOD', n.scope, 'only ' + esc(FL.periodName(n.scope === 'GLOBAL' ? per : n.period))) + radio('nt-scope', 'GLOBAL', n.scope, 'every period (global)') +
            '<div class="field" style="margin-top:6px">Statement</div>' + radio('nt-tpl', tpl.id, n.tpl === '*' ? '*' : tpl.id, 'this statement') + radio('nt-tpl', '*', n.tpl === '*' ? '*' : tpl.id, 'every statement') +
            (FL.filter.company || n.company ? '<div style="margin-top:6px"><label class="sm"><input type="checkbox" id="nt-co"' + (n.company ? ' checked' : '') + '> only for company ' + esc(n.company || FL.filter.company) + '</label></div>' : '') +
            '<label class="field" style="margin-top:8px">Title (optional)<input id="nt-title" value="' + esc(n.title || '') + '" maxlength="300"></label>' +
            '<label class="field">Note <span class="muted sm">(**bold**, _italic_, lines starting with - make a list)</span><textarea id="nt-body" rows="8" maxlength="16000">' + esc(n.body || '') + '</textarea></label>' +
            '<div class="row" style="margin-top:8px">' + (isNew ? '' : '<button class="btn ghost" id="nt-del"><i class="fa-solid fa-trash"></i> Delete</button>') + '<span class="sm muted">' + (isNew ? '' : 'by ' + esc(n.createdBy || '') + ' · ' + esc(String(n.createdAt || '').slice(0, 16)) + (n.changedBy ? ' · changed by ' + esc(n.changedBy) + ' ' + esc(String(n.changedAt || '').slice(0, 16)) : '')) + '</span>' +
            '<span class="grow"></span><button class="btn primary" id="nt-save"><i class="fa-solid fa-floppy-disk"></i> Save note</button></div>');
        setTimeout(function () { $('nt-body').focus(); }, 50);
        if ($('nt-del')) $('nt-del').onclick = function () { FL.closeModal(); N.remove(N.byId(n.id) || n); };
        $('nt-save').onclick = function () {
            var body = $('nt-body').value.trim(), title = $('nt-title').value.trim();
            if (!body && !title) { FL.toast('Write the note first', 'err'); return; }
            var r = $('nt-row').value, scope = (document.querySelector('[name=nt-scope]:checked') || {}).value || 'PERIOD';
            Object.assign(n, { kind: $('nt-kind').value, row: r, rowLabel: r ? ((rows.filter(function (x) { return x.id === r; })[0] || {}).label || '') : '', scope: scope, period: scope === 'GLOBAL' ? null : (n.scope === 'GLOBAL' || isNew ? per : n.period),
                tpl: (document.querySelector('[name=nt-tpl]:checked') || {}).value || tpl.id, company: $('nt-co') && $('nt-co').checked ? (n.company || FL.filter.company) : '', title: title, body: body });
            this.disabled = true;
            N.save(n, isNew ? 'add' : 'edit').then(function () { FL.closeModal(); FL.toast('Note saved', 'ok'); FL.render(); }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); $('nt-save').disabled = false; });
        };
    };

    /** The Notes button: every note of this statement — this period, global, other periods — with copy from the previous period */
    N.panel = function (tpl, st) {
        N.load(true).then(function () {
            var per = FL.filter.period, mine = (N.all || []).filter(function (n) { return !n.removed && (n.tpl === tpl.id || n.tpl === '*'); });
            var here = N.number(N.forView(tpl.id, per), st), others = mine.filter(function (n) { return n.scope !== 'GLOBAL' && +n.period !== +per; });
            var byPer = {}; others.forEach(function (n) { (byPer[n.period] = byPer[n.period] || []).push(n); });
            var prev = Object.keys(byPer).map(Number).filter(function (q) { return q < per; }).sort().pop();
            var item = function (n) { var k = N.KINDS[n.kind] || N.KINDS.note; return '<div class="st-note" style="border-left-color:' + k[1] + '"><div class="st-nh"><span class="st-nk" style="color:' + k[1] + '">' + k[0] + '</span>' + (n.title ? '<b>' + esc(n.title) + '</b>' : '') + (n.rowLabel ? '<span class="st-nl">' + esc(n.rowLabel) + '</span>' : '') + '<span class="grow"></span><button class="btn sm" data-copy="' + esc(n.id) + '">Copy to ' + esc(FL.periodName(per)) + '</button></div><div class="st-nb">' + N.md(n.body) + '</div></div>'; };
            FL.modal('<i class="fa-regular fa-note-sticky"></i> Notes · ' + esc(tpl.name),
                '<div class="row"><span class="tag ' + (N.apexOk ? 'good' : 'warn') + '">' + (N.apexOk ? 'saved in APEX and on this PC' : 'APEX not reachable — kept on this PC') + '</span><span class="grow"></span>' +
                (prev ? '<button class="btn sm" id="np-roll" title="Copy every note of ' + esc(FL.periodName(prev)) + ' to ' + esc(FL.periodName(per)) + ' (edit them after)"><i class="fa-solid fa-forward"></i> Copy ' + byPer[prev].length + ' note(s) from ' + esc(FL.periodName(prev)) + '</button>' : '') +
                '<button class="btn sm primary" id="np-add"><i class="fa-solid fa-plus"></i> Add a note</button></div>' +
                '<h4 style="margin:12px 0 4px">' + esc(FL.periodName(per)) + ' and every period (' + here.length + ')</h4>' + (here.length ? N.blockHtml(here).replace('<h3>Notes</h3>', '') : '<p class="sm muted">No notes yet — add one, or use the note icon on a line.</p>') +
                (others.length ? '<h4 style="margin:14px 0 4px">Other periods (' + others.length + ')</h4>' + Object.keys(byPer).sort().reverse().map(function (q) { return '<div class="sm muted" style="margin:8px 0 2px"><b>' + esc(FL.periodName(+q)) + '</b></div>' + byPer[q].map(item).join(''); }).join('') : ''));
            var box = $('m-body');
            $('np-add').onclick = function () { N.edit(null, tpl, st); };
            box.querySelectorAll('[data-ned]').forEach(function (x) { x.onclick = function () { N.edit(N.byId(x.dataset.ned), tpl, st); }; });
            box.querySelectorAll('[data-ndel]').forEach(function (x) { x.onclick = function () { FL.closeModal(); N.remove(N.byId(x.dataset.ndel)); }; });
            var copy = function (list) {
                return list.reduce(function (p, n) { return p.then(function () { var c = Object.assign({}, n, { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), period: per, rev: 0, createdAt: '', createdBy: '' }); return N.save(c, 'add'); }); }, Promise.resolve())
                    .then(function () { FL.toast(list.length + ' note(s) copied to ' + FL.periodName(per), 'ok'); FL.closeModal(); FL.render(); });
            };
            box.querySelectorAll('[data-copy]').forEach(function (x) { x.onclick = function () { copy([N.byId(x.dataset.copy)]); }; });
            if ($('np-roll')) $('np-roll').onclick = function () { copy(byPer[prev]); };
        });
    };
})();
