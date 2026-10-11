/* Admin › User Access (window.ACC) — give and take modules per login on Home/access.js (WMSACCESS).
 * Logins = the table the app's /login handler reads (no password column is ever selected) + every login that already
 * has access rows + logins added by name. Every tick runs at once through ai/executewrite (MERGE / UPDATE) and writes a
 * row to WMS_USER_ACCESS_LOG. Only a login that has the Admin module (or JAVEED) may change access; others see it read-only. */
(function (root) {
    'use strict';
    var A = root.WMSACCESS, $ = function (id) { return document.getElementById(id); };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(t) { if (root.toast) root.toast(t); }
    function color(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return 'hsl(' + h + ',55%,45%)'; }
    function initials(s) { var p = String(s || '?').replace(/[._@-]+/g, ' ').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '').slice(1, 2))).toUpperCase(); }

    var ACC = root.ACC = { st: { loaded: false, busy: false, modules: [], rows: [], logins: [], src: '', sel: localStorage.getItem('acc.sel') || '', added: [], err: '', saving: {} } };
    var st = ACC.st;

    ACC.me = function () { return A.me(); };
    ACC.canEdit = function () {
        var me = A.me(); if (!me) return false;
        if (A.isSuper(me)) return true;
        return st.rows.some(function (r) { return r.APP_USER === me && r.CODE === 'admin' && r.ACTIVE === 'Y'; });
    };

    /** tables + modules + every access row + the logins (once, or again with force) */
    ACC.load = function (force) {
        if (st.busy || (st.loaded && !force)) { paint(); return Promise.resolve(); }
        st.busy = true; st.err = ''; paint();
        return A.ensure().then(function (r) {
            st.created = r.created || [];
            return Promise.all([A.modules(), A.access(), A.logins().catch(function (e) { return { table: '', users: [], error: e.message }; })]);
        }).then(function (res) {
            st.modules = res[0].filter(function (m) { return m.ACTIVE !== 'N'; });
            st.rows = res[1]; st.logins = res[2].users || []; st.src = res[2].table || ''; st.srcErr = res[2].error || '';
            st.loaded = true;
        }, function (e) { st.err = e.message || String(e); }).then(function () { st.busy = false; paint(); });
    };

    function users() {
        var by = {};
        st.logins.forEach(function (u) { by[u.user] = { user: u.user, name: u.name, type: u.type, active: u.active, login: true }; });
        st.rows.forEach(function (r) { if (!by[r.APP_USER]) by[r.APP_USER] = { user: r.APP_USER, name: '', type: '', active: true, login: false }; });
        st.added.forEach(function (u) { if (!by[u]) by[u] = { user: u, name: '', type: '', active: true, login: false, added: true }; });
        return Object.keys(by).sort().map(function (k) { var x = by[k]; x.n = count(k); return x; });
    }
    function count(u) { return st.rows.filter(function (r) { return r.APP_USER === u && r.ACTIVE === 'Y'; }).length; }
    function rowOf(u, code) { return st.rows.filter(function (r) { return r.APP_USER === u && r.CODE === code; })[0] || null; }

    function paint() { paintStatus(); ACC.paintUsers(); paintDetail(); }
    function paintStatus() {
        var el = $('acc-status'); if (!el) return;
        if (st.busy && !st.loaded) { el.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Reading the modules and the access from APEX…'; return; }
        if (st.err) { el.innerHTML = '<span class="chip err"><i class="fa-solid fa-xmark"></i> ' + esc(st.err) + '</span>' + (A.hasHost() ? '' : ' — open the Admin page inside the app.'); return; }
        var me = A.me(), withAcc = users().filter(function (u) { return u.n; }).length;
        el.innerHTML = '<span class="chip ok"><i class="fa-solid fa-database"></i> WMS_APP_MODULES · ' + st.modules.length + ' modules</span>' +
            '<span class="chip ok"><i class="fa-solid fa-users"></i> ' + withAcc + ' logins with access</span>' +
            (st.src ? '<span title="The table the /login handler reads — no password column is read">Logins from <b>' + esc(st.src) + '</b> (' + st.logins.length + ')</span>' : '<span class="chip warn">No login table found' + (st.srcErr ? ' — ' + esc(st.srcErr) : '') + ' — add logins by name</span>') +
            (st.created && st.created.length ? '<span class="chip warn">Created now: ' + esc(st.created.join(', ')) + '</span>' : '') +
            '<span style="margin-left:auto">Signed in as <b>' + esc(me || '—') + '</b> · ' + (ACC.canEdit() ? '<span class="chip ok"><i class="fa-solid fa-pen"></i> may change access</span>' : '<span class="chip warn"><i class="fa-solid fa-eye"></i> read only</span>') + '</span>' +
            (st.busy ? ' <i class="fa-solid fa-spinner spin"></i>' : '');
    }
    ACC.paintUsers = function () {
        var el = $('acc-ulist'); if (!el) return;
        var q = ($('acc-q') && $('acc-q').value || '').trim().toUpperCase(), f = $('acc-f') ? $('acc-f').value : 'all', total = st.modules.length;
        var list = users().filter(function (u) {
            if (f === 'with' && !u.n) return false;
            if (f === 'without' && u.n) return false;
            return !q || (u.user + ' ' + u.name + ' ' + u.type).toUpperCase().indexOf(q) >= 0;
        });
        el.innerHTML = list.length ? list.map(function (u) {
            return '<div class="acc-u' + (u.user === st.sel ? ' on' : '') + '" data-u="' + esc(u.user) + '"><span class="acc-av" style="background:' + color(u.user) + '">' + esc(initials(u.name || u.user)) + '</span>' +
                '<span class="tx"><b>' + esc(u.user) + '</b><small>' + esc([u.name && u.name.toUpperCase() !== u.user ? u.name : '', u.type, u.login ? '' : u.added ? 'added here' : 'not in the login table', u.active ? '' : 'inactive'].filter(Boolean).join(' · ') || ' ') + '</small></span>' +
                '<span class="acc-n' + (u.n ? ' some' : '') + '">' + u.n + ' / ' + total + '</span></div>';
        }).join('') : '<div class="acc-empty">' + (st.loaded ? 'No login matches.' : '…') + '</div>';
    };
    document.addEventListener('click', function (e) {
        var u = e.target.closest && e.target.closest('.acc-u'); if (u) { ACC.select(u.dataset.u); return; }
    });
    document.addEventListener('change', function (e) { var m = e.target.closest && e.target.closest('.acc-m[data-code]'); if (m && e.target.tagName === 'INPUT') ACC.toggle(m.dataset.code, e.target.checked); });

    ACC.select = function (u) { st.sel = u; localStorage.setItem('acc.sel', u); ACC.paintUsers(); paintDetail(); loadHist(); };
    ACC.addUser = function () {
        var v = A.key($('acc-new').value); if (!v) return;
        if (!/^[A-Z0-9._@\- ]{2,100}$/.test(v)) { toast('Use letters, digits, . _ @ - only'); return; }
        if (st.added.indexOf(v) < 0) st.added.push(v);
        $('acc-new').value = ''; ACC.select(v);
    };

    function paintDetail() {
        var el = $('acc-detail'); if (!el) return;
        var u = st.sel && users().filter(function (x) { return x.user === st.sel; })[0];
        if (!st.loaded) { el.innerHTML = '<div class="acc-empty"><i class="fa-solid fa-spinner spin"></i></div>'; return; }
        if (!u) { el.innerHTML = '<div class="acc-empty"><i class="fa-solid fa-hand-pointer" style="font-size:2rem;margin-bottom:10px;display:block"></i>Pick a login on the left to give or take modules.</div>'; return; }
        var edit = ACC.canEdit(), groups = {}, order = [];
        st.modules.forEach(function (m) { if (!groups[m.GRP]) { groups[m.GRP] = []; order.push(m.GRP); } groups[m.GRP].push(m); });
        var others = users().filter(function (x) { return x.user !== u.user && x.n; });
        el.innerHTML = '<div class="acc-dh"><span class="acc-av" style="background:' + color(u.user) + '">' + esc(initials(u.name || u.user)) + '</span><div><h3>' + esc(u.user) + '</h3><p>' +
            esc([u.name, u.type, u.n + ' of ' + st.modules.length + ' modules', A.isSuper(u.user) ? 'administrator — gets every new module' : ''].filter(Boolean).join(' · ')) + '</p></div>' +
            (edit ? '<div class="row"><button class="btn" onclick="ACC.all(true)"><i class="fa-solid fa-check-double"></i> Give all</button><button class="btn" onclick="ACC.all(false)"><i class="fa-solid fa-ban"></i> Take all</button>' +
                (others.length ? '<select id="acc-copy" title="Give this login the same modules as another"><option value="">Copy from…</option>' + others.map(function (o) { return '<option>' + esc(o.user) + '</option>'; }).join('') + '</select>' : '') +
                (u.n || rowsOf(u.user).length ? '<button class="btn" onclick="ACC.remove()" title="Delete this login\'s access rows (the audit log keeps the history)"><i class="fa-solid fa-trash"></i></button>' : '') + '</div>' : '') + '</div>' +
            (edit ? '' : '<div class="ro-note"><i class="fa-solid fa-lock"></i> Read only — only a login with the Admin module may change access.</div>') +
            '<div class="acc-groups">' + order.map(function (g) {
                var ms = groups[g], on = ms.filter(function (m) { var r = rowOf(u.user, m.CODE); return r && r.ACTIVE === 'Y'; }).length;
                return '<div class="acc-g"><h4>' + esc(g) + ' <span>' + on + ' / ' + ms.length + '</span>' + (edit ? '<button onclick="ACC.group(\'' + esc(g).replace(/'/g, "\\'") + '\', true)">all</button><button onclick="ACC.group(\'' + esc(g).replace(/'/g, "\\'") + '\', false)">none</button>' : '') + '</h4><div class="acc-mods">' +
                    ms.map(function (m) {
                        var r = rowOf(u.user, m.CODE), act = r && r.ACTIVE === 'Y', busy = st.saving[u.user + '|' + m.CODE];
                        var when = r ? (act ? '<small class="when">given ' + esc(r.GRANTED_AT || '') + (r.GRANTED_BY ? ' by ' + esc(r.GRANTED_BY) : '') + '</small>' : '<small class="when rev">taken ' + esc(r.REVOKED_AT || '') + (r.REVOKED_BY ? ' by ' + esc(r.REVOKED_BY) : '') + '</small>') : '';
                        return '<label class="acc-m' + (act ? ' on' : '') + (busy ? ' busy' : '') + (edit ? '' : ' ro') + '" data-code="' + esc(m.CODE) + '"><input type="checkbox"' + (act ? ' checked' : '') + (edit ? '' : ' disabled') + '>' +
                            '<span class="tx"><b>' + esc(m.TITLE) + '</b><small>' + esc(m.DESCR || '') + '</small>' + when + '</span></label>';
                    }).join('') + '</div></div>';
            }).join('') + '</div>' +
            '<div class="acc-hist"><details open><summary>Changes for ' + esc(u.user) + '</summary><div id="acc-uh">…</div></details></div>';
        var cp = $('acc-copy'); if (cp) cp.onchange = function () { if (cp.value) ACC.copyFrom(cp.value); };
    }
    function rowsOf(u) { return st.rows.filter(function (r) { return r.APP_USER === u; }); }
    function histTable(rows, showUser) {
        if (!rows.length) return '<div class="muted" style="font-size:.8rem;padding:6px 0">No changes recorded.</div>';
        var title = {}; st.modules.forEach(function (m) { title[m.CODE] = m.TITLE; });
        return '<table class="hist"><thead><tr><th>When</th>' + (showUser ? '<th>Login</th>' : '') + '<th>Action</th><th>Module</th><th>By</th><th>Note</th></tr></thead><tbody>' + rows.map(function (h) {
            return '<tr><td>' + esc(h.AT) + '</td>' + (showUser ? '<td>' + esc(h.APP_USER) + '</td>' : '') + '<td class="act-' + esc(h.ACTION) + '">' + esc(h.ACTION) + '</td><td>' + esc(title[h.CODE] || h.CODE) + '</td><td>' + esc(h.BY_USER) + '</td><td class="muted">' + esc(h.NOTE || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    function loadHist() {
        if (!st.sel || !st.loaded) return;
        var u = st.sel;
        A.history(u, 100).then(function (rows) { if (st.sel === u && $('acc-uh')) $('acc-uh').innerHTML = histTable(rows, false); }, function (e) { if ($('acc-uh')) $('acc-uh').textContent = e.message; });
    }
    ACC.showLog = function () {
        $('acc-mt').textContent = 'Audit log — every grant and revoke (latest 500)';
        $('acc-mb').innerHTML = '<i class="fa-solid fa-spinner spin"></i>';
        $('acc-modal').hidden = false;
        A.history('', 500).then(function (rows) { $('acc-mb').innerHTML = histTable(rows, true); }, function (e) { $('acc-mb').textContent = e.message; });
    };
    ACC.closeModal = function () { $('acc-modal').hidden = true; };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('acc-modal') && !$('acc-modal').hidden) ACC.closeModal(); });

    // ── changes (each one saved at once) ──
    function apply(user, give, take, note) {
        if (!ACC.canEdit()) { toast('Only a login with the Admin module may change access'); return Promise.resolve(); }
        var me = A.me();
        if (user === me && take.indexOf('admin') >= 0 && !A.isSuper(me) && !confirm('Take the Admin module from yourself? You will not be able to change access afterwards.')) return Promise.resolve();
        give.concat(take).forEach(function (c) { st.saving[user + '|' + c] = 1; });
        paintDetail();
        return Promise.resolve()
            .then(function () { return give.length ? A.grant(user, give, me, note) : 0; })
            .then(function () { return take.length ? A.revoke(user, take, me, note) : 0; })
            .then(function () { return A.access(); })
            .then(function (rows) {
                st.rows = rows;
                toast(user + ': ' + [give.length ? give.length + ' module' + (give.length > 1 ? 's' : '') + ' given' : '', take.length ? take.length + ' taken' : ''].filter(Boolean).join(', ') + ' — saved');
                if (user === me) { try { localStorage.removeItem('access.mods.' + me); } catch (e) { } }
            }, function (e) { toast('Not saved: ' + (e.message || e)); return A.access().then(function (rows) { st.rows = rows; }, function () { }); })
            .then(function () { st.saving = {}; paintStatus(); ACC.paintUsers(); paintDetail(); loadHist(); });
    }
    function activeCodes(u) { return st.rows.filter(function (r) { return r.APP_USER === u && r.ACTIVE === 'Y'; }).map(function (r) { return r.CODE; }); }
    ACC.toggle = function (code, on) { var u = st.sel; if (!u) return; return on ? apply(u, [code], [], 'Given in Admin › User Access') : apply(u, [], [code], 'Taken in Admin › User Access'); };
    ACC.all = function (on) {
        var u = st.sel, have = activeCodes(u);
        if (on) return apply(u, st.modules.map(function (m) { return m.CODE; }).filter(function (c) { return have.indexOf(c) < 0; }), [], 'Every module');
        if (!confirm('Take every module from ' + u + '?')) return;
        return apply(u, [], have, 'Every module taken');
    };
    ACC.group = function (g, on) {
        var u = st.sel, have = activeCodes(u), codes = st.modules.filter(function (m) { return m.GRP === g; }).map(function (m) { return m.CODE; });
        return on ? apply(u, codes.filter(function (c) { return have.indexOf(c) < 0; }), [], g + ' — all') : apply(u, [], codes.filter(function (c) { return have.indexOf(c) >= 0; }), g + ' — none');
    };
    ACC.copyFrom = function (from) {
        var u = st.sel, src = activeCodes(from), have = activeCodes(u);
        var give = src.filter(function (c) { return have.indexOf(c) < 0; }), take = have.filter(function (c) { return src.indexOf(c) < 0; });
        if (!give.length && !take.length) { toast(u + ' already has the same modules as ' + from); return; }
        if (!confirm('Give ' + u + ' the same modules as ' + from + '?\n\n' + give.length + ' to give, ' + take.length + ' to take.')) { $('acc-copy').value = ''; return; }
        return apply(u, give, take, 'Same as ' + from);
    };
    ACC.remove = function () {
        var u = st.sel; if (!ACC.canEdit()) return;
        if (!confirm('Delete every access row of ' + u + '? The login then sees no module. The audit log keeps the history.')) return;
        A.removeUser(u, A.me()).then(function () { return A.access(); }).then(function (rows) { st.rows = rows; toast(u + ': access rows deleted'); }, function (e) { toast('Not deleted: ' + e.message); })
            .then(function () { paintStatus(); ACC.paintUsers(); paintDetail(); loadHist(); });
    };
})(window);
