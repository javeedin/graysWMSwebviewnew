/* Finance Lens — Board packs (tab `packs`): design your own packs and share them.
   A pack = a title, company, logo, colour theme, amounts and an ordered list of sections (Summary, Trial balance,
   any statement template with its columns and account detail, KPIs, charts, monitors, your own text pages).
   Saved in {root}\packs.json (finDocGet / finDocSave name `packs`). The right side is a live preview of the
   interactive HTML file (fin-packhtml.js) as it will be downloaded or e-mailed (fin-mail.js). */
(function () {
    var D = FL.packDesign = { doc: null, cur: null, dirty: false, view: FL.ls('pack.view', 'desktop'), built: null };
    var P = function () { return FL.packs; };

    D.load = function () {
        if (D.doc) return Promise.resolve(D.doc);
        return FL.call('finDocGet', { name: 'packs' }).then(function (r) { try { D.doc = JSON.parse(r.json || '{}'); } catch (e) { D.doc = {}; } })
            .catch(function () { D.doc = {}; }).then(function () {
                D.doc.packs = D.doc.packs || [];
                if (!D.doc.packs.length) { var p = P().newPack('Monthly board pack'); var old = FL.config.pack || {}; if (old.title) p.title = old.title; if (old.by) p.by = old.by; D.doc.packs.push(p); D.dirtyIds = D.dirtyIds || {}; D.dirtyIds[p.id] = 1; }
                return D.doc;
            });
    };
    D.store = function () {
        if (D.cur) D.cur.updated = new Date().toISOString();
        return FL.call('finDocSave', { name: 'packs', json: JSON.stringify(D.doc, null, 1) }).then(function () { D.dirtyIds = {}; D.paintHead(); D.paintTabs(); FL.toast('Board pack saved', 'ok'); });
    };
    // unsaved changes per design (several designs can be open in tabs)
    D.dirtyIds = {};
    Object.defineProperty(D, 'dirty', { get: function () { return !!(D.cur && D.dirtyIds[D.cur.id]); }, set: function (v) { if (!D.cur) return; if (v) D.dirtyIds[D.cur.id] = 1; else delete D.dirtyIds[D.cur.id]; } });
    D.touch = function (noPreview) { D.dirty = true; D.paintHead(); D.paintTabs(); if (!noPreview) D.schedule(); };

    FL.TABS.packs = { render: function (el) { return D.render(el); } };

    // ── tabs: Templates (the list) · one tab per design being edited · New · Distribution · Archive ──
    D.byId = function (id) { return (D.doc.packs || []).filter(function (p) { return p.id === id; })[0]; };
    D.render = function (el) {
        return D.load().then(function () {
            D.el = el;
            D.open = (FL.ls('pack.tabs', []) || []).filter(function (id) { return D.byId(id); });
            el.innerHTML = '<div class="pk-tabbar" id="pk-tabbar"></div><div id="pk-body" class="pk-body"></div>';
            if (!D._rs) { D._rs = true; window.addEventListener('resize', function () { if (FL.tab === 'packs') D.fit(); }); }
            var at = FL.ls('pack.at', 'list');
            if (/^e:/.test(at) && !D.byId(at.slice(2))) at = 'list';
            D.go(at);
        });
    };
    D.saveTabs = function () { FL.lsSet('pack.tabs', D.open); FL.lsSet('pack.at', D.at); };
    D.paintTabs = function () {
        var bar = $('pk-tabbar'); if (!bar) return;
        var tab = function (key, html, title, cls) { return '<button class="pk-tab' + (D.at === key ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-at="' + esc(key) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + html + '</button>'; };
        var h = tab('list', '<i class="fa-solid fa-layer-group"></i> Templates <span class="pk-n">' + D.doc.packs.length + '</span>', 'Every board pack design');
        D.open.forEach(function (id) {
            var p = D.byId(id); if (!p) return; var th = P().themeOf(p);
            h += tab('e:' + id, '<span class="pk-tsw" style="background:linear-gradient(135deg,' + th.a + ',' + th.b + ')"></span><span class="pk-tn">' + esc(p.name) + '</span>' + (D.dirtyIds[id] ? '<i class="pk-dot" title="Not saved"></i>' : '') +
                '<span class="pk-x" data-close="' + esc(id) + '" title="Close">×</span>', p.name, 'pk-etab');
        });
        h += tab('new', '<i class="fa-solid fa-plus"></i> New', 'Create a board pack — standard, from a PDF or picture, or a copy', 'pk-newtab');
        h += '<span class="grow"></span>' + tab('dist', '<i class="fa-solid fa-paper-plane"></i> Distribution', 'Every pack sent from the app: to whom, when, delivered, opened, read, confirmed') +
            tab('arch', '<i class="fa-solid fa-box-archive"></i> Archive', 'What the board received — the exact files kept in APEX') +
            '<button class="btn sm ghost" onclick="FL.mail.setup()" title="E-mail setup"><i class="fa-solid fa-envelope-circle-check"></i></button>';
        bar.innerHTML = h;
        bar.querySelectorAll('[data-at]').forEach(function (b) {
            b.onclick = function (e) { if (e.target.closest('[data-close]')) return; D.go(b.dataset.at); };
            b.onauxclick = function (e) { if (e.button === 1 && /^e:/.test(b.dataset.at)) { e.preventDefault(); D.closeTab(b.dataset.at.slice(2)); } };
        });
        bar.querySelectorAll('[data-close]').forEach(function (x) { x.onclick = function (e) { e.stopPropagation(); D.closeTab(x.dataset.close); }; });
    };
    D.go = function (at) {
        D.at = at; D.saveTabs(); D.paintTabs();
        var body = $('pk-body'); if (!body) return;
        clearTimeout(D._t);
        if (at === 'list') return D.renderList(body);
        if (at === 'new') return FL.packNew.render(body);
        if (at === 'dist') return FL.packTrack.render(body);
        if (at === 'arch') { body.innerHTML = '<div class="card" id="pk-arch"></div>'; return FL.packArchive.render($('pk-arch')); }
        var p = D.byId(at.slice(2)); if (!p) return D.go('list');
        D.cur = p; FL.lsSet('pack.cur', p.id);
        D.renderEditor(body);
    };
    /** Opens a design in its own tab (or switches to it) */
    D.openPack = function (id) { if (D.open.indexOf(id) < 0) D.open.push(id); D.go('e:' + id); };
    D.closeTab = function (id) {
        var p = D.byId(id);
        if (D.dirtyIds[id] && !confirm('"' + (p ? p.name : id) + '" has changes that are not saved. Close it anyway? (They stay until you leave Finance Lens — Save keeps them.)')) return;
        var k = D.open.indexOf(id); D.open = D.open.filter(function (x) { return x !== id; });
        if (D.at === 'e:' + id) D.go(D.open.length ? 'e:' + D.open[Math.max(0, k - 1)] : 'list'); else { D.saveTabs(); D.paintTabs(); }
    };
    /** Adds a new design and opens it in a tab */
    D.addPack = function (p) { D.doc.packs.push(p); D.dirtyIds[p.id] = 1; D.openPack(p.id); return p; };

    // ── Templates: every design as a card ──
    D.LAYOUT_ICON = { side: 'fa-table-columns', right: 'fa-table-columns fa-flip-horizontal', rail: 'fa-bars-staggered', top: 'fa-window-maximize', cards: 'fa-grip', doc: 'fa-scroll' };
    D.mini = function (p) {   // a small drawing of the pack: its menu, cover banner and tiles in its own colours
        var t = P().themeOf(p), L = P().look(p), H = P().hero(p), light = P().lightMenu(L.menu);
        var mbg = { theme: t.a, grad: 'linear-gradient(180deg,' + t.a + ',' + t.b + ')', dark: '#0b1222', white: '#fff', tint: 'color-mix(in srgb,' + t.a + ' 12%,#fff)' }[L.menu];
        var hbg = { grad: 'linear-gradient(135deg,' + (H.c1 || t.a) + ',' + (H.c2 || t.b) + ' 65%,' + t.c + ')', solid: H.c1 || t.a, dark: '#0f172a', soft: 'color-mix(in srgb,' + (H.c1 || t.a) + ' 12%,#fff)', white: '#fff', minimal: 'transparent', image: H.img ? 'url(' + H.img + ') center/cover' : t.a }[H.style];
        var nav = { side: 'left:0;top:0;bottom:0;width:22%', right: 'right:0;top:0;bottom:0;width:22%', rail: 'left:0;top:0;bottom:0;width:8%', top: 'left:0;right:0;top:0;height:13%', cards: 'left:0;right:0;top:0;height:11%', doc: 'left:0;right:0;top:0;height:11%' }[L.layout];
        var x0 = L.layout === 'side' ? 26 : L.layout === 'rail' ? 12 : 4, x1 = L.layout === 'right' ? 26 : 4, y0 = /top|cards|doc/.test(L.layout) ? 18 : 6;
        var body = L.layout === 'cards' ? [0, 1, 2, 3, 4, 5].map(function (i) { return '<i style="left:' + (x0 + (i % 3) * 31) + '%;top:' + (y0 + Math.floor(i / 3) * 36) + '%;width:28%;height:30%;background:#fff;border-radius:3px;box-shadow:0 0 0 1px #e2e8f0;border-top:2px solid ' + t.b + '"></i>'; }).join('') :
            '<i style="left:' + x0 + '%;right:' + x1 + '%;top:' + y0 + '%;height:28%;border-radius:4px;background:' + hbg + (H.style === 'white' ? ';box-shadow:0 0 0 1px #e2e8f0;border-left:3px solid ' + t.b : '') + (H.style === 'minimal' ? ';border-bottom:2px solid ' + t.b : '') + '"></i>' +
            [0, 1, 2].map(function (i) { return '<i style="left:calc(' + x0 + '% + ' + i * 31 * (100 - x0 - x1) / 100 + '%);width:' + 28 * (100 - x0 - x1) / 100 + '%;top:' + (y0 + 34) + '%;height:16%;background:#fff;border-radius:3px;box-shadow:0 0 0 1px #e2e8f0;border-top:2px solid ' + t.b + '"></i>'; }).join('') +
            '<i style="left:' + x0 + '%;right:' + x1 + '%;top:' + (y0 + 56) + '%;height:30%;background:#fff;border-radius:3px;box-shadow:0 0 0 1px #e2e8f0"></i>';
        return '<div class="pk-mini" style="background:' + (L.paper === 'white' ? '#fff' : '#f1f4f9') + '"><i style="' + nav + ';background:' + mbg + (light ? ';box-shadow:0 0 0 1px #e2e8f0' : '') + '"></i>' + body + '</div>';
    };
    D.renderList = function (body) {
        var q = (D.q || '').toLowerCase(), sort = FL.ls('pack.sort', 'updated');
        var list = D.doc.packs.filter(function (p) { return !q || (p.name + ' ' + (p.title || '') + ' ' + (p.company || '')).toLowerCase().indexOf(q) >= 0; })
            .sort(function (a, b) { return sort === 'name' ? String(a.name).localeCompare(b.name) : String(b[sort === 'sent' ? 'lastSent' : 'updated'] || '').localeCompare(String(a[sort === 'sent' ? 'lastSent' : 'updated'] || '')); });
        var L = P().LAYOUTS;
        body.innerHTML = '<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap"><h3 style="margin:0"><i class="fa-solid fa-book-open"></i> Board pack templates</h3><span class="sm muted">' + D.doc.packs.length + ' design' + (D.doc.packs.length === 1 ? '' : 's') + ' · each opens in its own tab</span><span class="grow"></span>' +
            '<input id="pk-q" type="search" placeholder="Search…" value="' + esc(D.q || '') + '" style="width:200px"><select id="pk-sort" class="sm">' + [['updated', 'Last changed'], ['sent', 'Last sent'], ['name', 'Name']].map(function (o) { return '<option value="' + o[0] + '"' + (sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            '<button class="btn" id="pk-frompdf"><i class="fa-solid fa-wand-magic-sparkles"></i> Design from a PDF</button><button class="btn primary" id="pk-new"><i class="fa-solid fa-plus"></i> New pack</button></div>' +
            '<p class="sm muted" style="margin:6px 0 0">A design is built from the data of the period in the header and shared as one interactive HTML file — by download or e-mail. Distribution shows who received each pack and whether they opened and confirmed it.</p></div>' +
            '<div class="pk-cards">' + (list.length ? list.map(function (p) {
                var lk = P().look(p), secs = (p.sections || []).filter(function (s) { return s.on !== false; });
                return '<div class="pk-card' + (D.open.indexOf(p.id) >= 0 ? ' open' : '') + '" data-id="' + esc(p.id) + '">' + D.mini(p) +
                    '<div class="pk-cb"><b>' + esc(p.name) + (D.dirtyIds[p.id] ? ' <i class="pk-dot" title="Not saved"></i>' : '') + '</b><div class="sm muted">' + esc(p.title || '') + (p.company ? ' · ' + esc(p.company) : '') + '</div>' +
                    '<div class="pk-chips"><span><i class="fa-solid ' + (D.LAYOUT_ICON[lk.layout] || 'fa-table-columns') + '"></i> ' + esc(L[lk.layout].label) + '</span><span>' + secs.length + ' sections</span>' + ((p.ledgers || []).length > 1 ? '<span>' + p.ledgers.length + ' ledgers</span>' : '') + (p.theme === 'brand' ? '<span>brand colours</span>' : '') + '</div>' +
                    '<div class="sm muted">' + (p.updated ? 'changed ' + esc(String(p.updated).slice(0, 10)) : 'not saved yet') + (p.lastSent ? ' · sent ' + esc(p.lastSent) : '') + '</div>' +
                    '<div class="pk-ca"><button class="btn sm primary" data-edit><i class="fa-solid fa-pen"></i> ' + (D.open.indexOf(p.id) >= 0 ? 'Go to tab' : 'Open') + '</button><button class="btn sm" data-dup title="Duplicate"><i class="fa-regular fa-copy"></i></button><button class="btn sm ghost" data-del title="Delete"><i class="fa-solid fa-trash"></i></button></div></div></div>';
            }).join('') : '<p class="muted" style="padding:20px">Nothing matches.</p>') +
            '<button class="pk-card pk-cardnew" id="pk-new2"><i class="fa-solid fa-plus"></i><b>New board pack</b><span class="sm muted">standard, from a PDF or picture, or a copy</span></button></div>';
        $('pk-q').oninput = function () { D.q = this.value; clearTimeout(D._qt); D._qt = setTimeout(function () { D.renderList(body); var x = $('pk-q'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 250); };
        $('pk-sort').onchange = function () { FL.lsSet('pack.sort', this.value); D.renderList(body); };
        $('pk-new').onclick = $('pk-new2').onclick = function () { D.go('new'); };
        $('pk-frompdf').onclick = function () { FL.packNew.mode = 'pdf'; D.go('new'); };
        body.querySelectorAll('.pk-card[data-id]').forEach(function (c) {
            var p = D.byId(c.dataset.id);
            c.onclick = function (e) {
                if (e.target.closest('[data-dup]')) { var cp = JSON.parse(JSON.stringify(p)); cp.id = 'p' + Date.now().toString(36); cp.name += ' (copy)'; delete cp.lastSent; delete cp.updated; D.addPack(cp); return; }
                if (e.target.closest('[data-del]')) {
                    if (D.doc.packs.length < 2) { FL.toast('Keep at least one pack', 'info'); return; }
                    if (!confirm('Delete the board pack design "' + p.name + '"? Packs already sent stay in Distribution and the Archive.')) return;
                    D.doc.packs = D.doc.packs.filter(function (x) { return x !== p; }); D.open = D.open.filter(function (x) { return x !== p.id; }); delete D.dirtyIds[p.id];
                    if (D.cur === p) D.cur = null;
                    D.store().then(function () { D.go('list'); });
                    return;
                }
                D.openPack(p.id);
            };
        });
    };

    // ── the editor of one design ──
    D.renderEditor = function (el) {
        el.innerHTML = '<div class="pk-main"><div class="card pk-head" id="pk-head"></div><div class="pk-cols"><div class="pk-left" id="pk-left"></div><div class="card pk-prev"><div class="row"><b><i class="fa-regular fa-eye"></i> Preview</b><span class="sm muted" id="pk-pstat"></span><span class="grow"></span>' +
            '<div class="seg sm"><button data-v="desktop"' + (D.view === 'desktop' ? ' class="on"' : '') + '><i class="fa-solid fa-desktop"></i></button><button data-v="phone"' + (D.view === 'phone' ? ' class="on"' : '') + '><i class="fa-solid fa-mobile-screen"></i></button></div>' +
            '<button class="btn sm" id="pk-refresh"><i class="fa-solid fa-rotate"></i></button><button class="btn sm" id="pk-full" title="Open the preview full screen"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button></div>' +
            '<div class="pk-frame ' + D.view + '"><iframe id="pk-f" title="Board pack preview"></iframe></div></div></div></div>';
        $('pk-refresh').onclick = function () { D.preview(); };
        $('pk-full').onclick = function () { if (D.built) FL.packView(D.built.html, { title: D.cur.title || D.cur.name }); };
        el.querySelectorAll('.pk-prev .seg button').forEach(function (b) { b.onclick = function () { D.view = b.dataset.v; FL.lsSet('pack.view', D.view); el.querySelectorAll('.pk-prev .seg button').forEach(function (x) { x.classList.toggle('on', x === b); }); el.querySelector('.pk-frame').className = 'pk-frame ' + D.view; D.fit(); }; });
        D.fit();
        D.built = null;
        D.paint();
        if (!(FL.status && FL.status.loaded)) $('pk-pstat').textContent = 'no data loaded — the preview fills once a trial balance is synced';
    };
    D.paint = function () { D.paintHead(); D.paintLeft(); D.preview(); };
    D.paintList = function () { D.paintTabs(); };

    D.paintHead = function () {
        var box = $('pk-head'); if (!box || !D.cur) return;
        box.innerHTML = '<div class="row"><input id="pk-name" class="pk-name" value="' + esc(D.cur.name) + '" title="Name of this design">' +
            (D.dirty ? '<span class="tag warn">not saved</span>' : '<span class="tag good">saved</span>') +
            '<button class="btn sm" id="pk-save"' + (D.dirty ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
            '<button class="btn sm ghost" id="pk-dup" title="Duplicate"><i class="fa-regular fa-copy"></i></button><button class="btn sm ghost" id="pk-del" title="Delete this design"><i class="fa-solid fa-trash"></i></button>' +
            '<span class="grow"></span><span class="sm muted" title="The period follows the header; the ledgers are chosen under Look and feel">' + esc(D.scopeText()) + '</span>' +
            '<button class="btn" id="pk-multi" title="One pack per ledger, all companies of each"><i class="fa-solid fa-layer-group"></i> For ledgers…</button>' +
            '<button class="btn" id="pk-arc" title="Save this pack with comments in the APEX archive — a record of what the board received"><i class="fa-solid fa-box-archive"></i> Save to archive</button>' +
            '<button class="btn" id="pk-dl"><i class="fa-solid fa-download"></i> Download HTML</button>' +
            '<button class="btn primary" id="pk-mail"><i class="fa-solid fa-paper-plane"></i> E-mail…</button></div>';
        $('pk-name').oninput = function () { D.cur.name = this.value; D.dirty = true; D.paintTabs(); };
        $('pk-name').onchange = function () { D.paintHead(); };
        $('pk-save').onclick = function () { D.store(); };
        $('pk-dup').onclick = function () { var c = JSON.parse(JSON.stringify(D.cur)); c.id = 'p' + Date.now().toString(36); c.name += ' (copy)'; delete c.lastSent; delete c.updated; D.addPack(c); };
        $('pk-del').onclick = function () {
            if (D.doc.packs.length < 2) { FL.toast('Keep at least one pack', 'info'); return; }
            if (!confirm('Delete the board pack design "' + D.cur.name + '"? Packs already sent stay in Distribution and the Archive.')) return;
            var gone = D.cur; D.doc.packs = D.doc.packs.filter(function (p) { return p !== gone; }); D.open = D.open.filter(function (x) { return x !== gone.id; }); delete D.dirtyIds[gone.id]; D.cur = null;
            D.store().then(function () { D.go('list'); });
        };
        $('pk-dl').onclick = function () {
            D.ensureBuilt().then(function (b) {
                var st = FL.packs.stamp(b, { kind: 'DOWNLOAD', by: (FL.who && FL.who.user) || '' });
                FL.download(st.file, new Blob([st.html], { type: 'text/html' }));
                setTimeout(function () { FL.packArchive.ask(D.cur, st, { event: 'DOWNLOADED', detail: st.file }); }, 600);
            });
        };
        $('pk-mail').onclick = function () {
            D.ensureBuilt().then(function (b) {
                FL.mail.compose(D.cur, b, function (r) {
                    D.cur.lastSent = new Date().toISOString().slice(0, 10); D.store();
                    var e = D.cur.email || {};
                    setTimeout(function () { FL.packArchive.ask(D.cur, r.stamped || b, { event: 'EMAILED', detail: (r.result === 'draft' ? 'opened in Outlook for ' : 'sent to ') + [e.to, e.cc].filter(Boolean).join('; ') + ' via ' + r.via + (r.by ? ' (' + r.by + ')' : '') }); }, 1300);
                });
            });
        };
        $('pk-arc').onclick = function () { D.ensureBuilt().then(function (b) { FL.packArchive.ask(D.cur, b, {}); }); };
        $('pk-multi').onclick = function () { FL.packArchive.multi(D.cur); };
    };

    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>'; };

    /** Which ledgers the pack covers: none ticked = the ledger in the header; one = that ledger; several = one document broken out by ledger */
    D.ledgerBox = function (p) {
        var leds = FL.dims.ledgers || [], sel = (p.ledgers || []).map(String);
        if (!leds.length) return '';
        var hdr = (leds.filter(function (l) { return String(l.code) === String(FL.filter.ledger); })[0] || {}).name || (leds.length > 1 ? 'all ledgers added up' : leds[0].name);
        return '<div class="field" style="margin-top:8px">Ledgers <span class="muted sm">— tick several and the pack is broken out by ledger (a menu group each)</span></div><div class="pk-leds">' +
            '<button class="pk-ledhdr' + (sel.length ? '' : ' on') + '" id="pk-ledhdr" title="Follow the Ledger of the header">As in the header <span class="muted">(' + esc(hdr) + ')</span></button>' +
            leds.map(function (l) { return '<label class="pk-ledc' + (sel.indexOf(String(l.code)) >= 0 ? ' on' : '') + '"><input type="checkbox" class="pk-led" value="' + esc(l.code) + '"' + (sel.indexOf(String(l.code)) >= 0 ? ' checked' : '') + '> ' + esc(l.name || l.code) + ' <span class="muted">' + esc(l.currency || '') + '</span></label>'; }).join('') + '</div>';
    };
    D.scopeText = function () {
        var leds = FL.dims.ledgers || [], sel = (D.cur.ledgers || []).map(String);
        var names = leds.filter(function (l) { return sel.indexOf(String(l.code)) >= 0; }).map(function (l) { return l.name || l.code; });
        return (names.length ? (names.length > 1 ? names.length + ' ledgers: ' : '') + names.join(', ') : FL.filterText()) + ' · ' + FL.periodName(FL.filter.period);
    };
    D.paintLeft = function () {
        var box = $('pk-left'), p = D.cur; if (!box || !p) return;
        var th = P().THEMES, types = P().TYPES;
        var h = '<div class="card"><h4 class="pk-h"><i class="fa-solid fa-palette"></i> Look and feel</h4><div class="grid g2">' +
            '<label class="field">Title<input data-k="title" value="' + esc(p.title || '') + '"></label><label class="field">Company / group<input data-k="company" value="' + esc(p.company || '') + '"></label>' +
            '<label class="field">Prepared by<input data-k="by" value="' + esc(p.by || '') + '"></label>' +
            '<label class="field">Amounts<select data-k="scale">' + opt(0, 'As in the header (' + FL.scaleLabel() + ')', p.scale || 0) + opt(1, 'Units', p.scale) + opt(1000, 'Thousands', p.scale) + opt(1000000, 'Millions', p.scale) + '</select></label></div>' +
            D.ledgerBox(p) +
            '<div class="field" style="margin-top:8px">Colours</div><div class="pk-themes">' + Object.keys(th).map(function (k) {
                return '<button class="pk-theme' + (p.theme === k ? ' on' : '') + '" data-th="' + k + '" title="' + esc(th[k].name) + '"><span style="background:' + th[k].a + '"></span><span style="background:' + th[k].b + '"></span><span style="background:' + th[k].c + '"></span></button>';
            }).join('') + D.brandSwatch(p) + '</div>' + (p.theme === 'brand' ? D.brandBox(p) : '') + D.lookBox(p, P().themeOf(p)) +
            '<div class="row" style="margin-top:10px"><span class="field" style="margin:0">Logo</span>' + (p.logo ? '' : '<span class="sm muted">none</span>') +
            '<label class="btn sm"><i class="fa-solid fa-image"></i> ' + (p.logo ? 'Change' : 'Add') + '<input type="file" id="pk-logo" accept="image/png,image/jpeg,image/svg+xml" hidden></label>' + (p.logo ? '<button class="btn sm ghost" id="pk-nologo">Remove</button>' : '') + '</div>' + (p.logo ? D.logoBox(p) : '') + '</div>';
        h += '<div class="card" style="margin-top:12px"><div class="row"><h4 class="pk-h" style="margin:0"><i class="fa-solid fa-list-ol"></i> Sections <span class="sm muted">— the pages of the pack (its menu), in this order</span></h4><span class="grow"></span>' +
            '<select id="pk-add" class="sm" style="max-width:190px"><option value="">+ Add a section…</option>' + Object.keys(types).map(function (k) { return '<option value="' + k + '">' + esc(types[k].label) + ' — ' + esc(types[k].what) + '</option>'; }).join('') + '</select></div>' +
            '<div id="pk-secs" class="pk-secs">' + (p.sections || []).map(function (s, i) { return D.secHtml(s, i); }).join('') + '</div></div>';
        box.innerHTML = h;
        box.querySelectorAll('[data-k]').forEach(function (x) { x.oninput = x.onchange = function () { p[x.dataset.k] = x.dataset.k === 'scale' ? +x.value : x.value; D.touch(); }; });
        box.querySelectorAll('.pk-led').forEach(function (c) {
            c.onchange = function () { p.ledgers = Array.prototype.filter.call(box.querySelectorAll('.pk-led'), function (x) { return x.checked; }).map(function (x) { return x.value; }); D.touch(); D.paintLeft(); D.paintHead(); };
        });
        if ($('pk-ledhdr')) $('pk-ledhdr').onclick = function () { p.ledgers = []; D.touch(); D.paintLeft(); D.paintHead(); };
        box.querySelectorAll('[data-th]').forEach(function (b) { b.onclick = function () { p.theme = b.dataset.th; D.touch(); D.paintLeft(); D.paintList(); }; });
        D.wireBrand(box, p);
        var hero = function () { return (p.hero = p.hero || {}); };
        box.querySelectorAll('[data-hero]').forEach(function (b) { b.onclick = function () { hero()[b.dataset.hero] = b.dataset.v; D.touch(); D.paintLeft(); }; });
        ['pk-hc1', 'pk-hc2'].forEach(function (id, n) { var x = $(id); if (x) x.onchange = function () { hero()[n ? 'c2' : 'c1'] = x.value; D.touch(); D.paintLeft(); }; });
        if ($('pk-hcreset')) $('pk-hcreset').onclick = function () { delete hero().c1; delete hero().c2; D.touch(); D.paintLeft(); };
        if ($('pk-heroimg')) $('pk-heroimg').onchange = function () {
            var f = this.files[0]; if (!f) return;
            if (f.size > 700 * 1024) { FL.toast('Use a picture smaller than 700 KB (it travels inside every pack)', 'err'); return; }
            var r = new FileReader(); r.onload = function () { hero().img = r.result; D.touch(); D.paintLeft(); }; r.readAsDataURL(f);
        };
        box.querySelectorAll('[data-look]').forEach(function (b) { b.onclick = function () { p[b.dataset.look] = b.dataset.v; D.touch(); D.paintLeft(); }; });
        $('pk-logo').onchange = function () {
            var f = this.files[0]; if (!f) return;
            if (f.size > 400 * 1024) { FL.toast('Use a logo smaller than 400 KB (it travels inside every pack and e-mail)', 'err'); return; }
            var r = new FileReader(); r.onload = function () { p.logo = r.result; D.touch(); D.paintLeft(); }; r.readAsDataURL(f);
        };
        box.querySelectorAll('[data-lo]').forEach(function (x) { x.oninput = x.onchange = function () { p.logoOpts = p.logoOpts || {}; p.logoOpts[x.dataset.lo] = x.type === 'range' ? +x.value : x.value; D.touch(); D.paintLogo(); }; });
        if (p.logo) D.paintLogo();
        if ($('pk-nologo')) $('pk-nologo').onclick = function () { p.logo = ''; D.touch(); D.paintLeft(); };
        $('pk-add').onchange = function () {
            var t = this.value; if (!t) return;
            var s = { id: 's' + Math.random().toString(36).slice(2, 8), type: t, title: types[t].label, on: true, opts: {} };
            if (t === 'statement') { var first = (FL.templates || [])[0]; s.opts = { tpl: first && first.id, cols: '_tpl', detail: true, hideZero: true }; s.title = first ? first.name : 'Statement'; }
            if (t === 'tb') s.opts = { range: 'YTD', group: 'type' };
            if (t === 'text') { s.title = 'Notes'; s.opts = { text: '# Notes\n\nWrite here.' }; }
            p.sections.push(s); D.open = s.id; D.touch(); D.paintLeft();
        };
        D.wireSecs(box);
    };

    /** The Brand swatch beside the themes */
    D.brandSwatch = function (p) {
        var t = (p.theme === 'brand' || p.brand || P().companyBrand()) ? P().themeOf(Object.assign({}, p, { theme: 'brand' })) : null;
        return '<button class="pk-theme pk-brand' + (p.theme === 'brand' ? ' on' : '') + '" data-th="brand" title="Your brand colours">' +
            (t && t.brand ? '<span style="background:' + t.a + '"></span><span style="background:' + t.b + '"></span><span style="background:' + t.c + '"></span>' : '<em>+ Brand</em>') + '</button>';
    };
    /** Brand colours: three pickers + hex, from the logo, the company brand, readable-text fix */
    D.brandBox = function (p) {
        var P0 = P(), cb = P0.companyBrand(), b = p.brand && /^#/.test(p.brand.a || '') ? p.brand : (cb || { a: '#0b2545', b: '#1d4ed8', c: '#0d9488' }), t = P0.themeOf(Object.assign({}, p, { brand: b }));
        var pick = function (k, label) { return '<label class="pk-bc"><input type="color" data-bc="' + k + '" value="' + esc(b[k] || b.a) + '"><span>' + label + '</span><input class="pk-bhex" data-bh="' + k + '" value="' + esc(b[k] || b.a) + '" maxlength="7" spellcheck="false"></label>'; };
        var fixed = b.fix !== false && t.a.toLowerCase() !== String(b.a).toLowerCase();
        return '<div class="pk-brandbox"><div class="row sm" style="gap:10px;flex-wrap:wrap">' + pick('a', 'Main') + pick('b', 'Second') + pick('c', 'Accent') + '</div>' +
            '<div class="pk-bprev" style="background:linear-gradient(135deg,' + t.a + ',' + t.b + ' 65%,' + t.c + ')"><b>Aa · Board pack</b><span style="background:' + t.c + '"></span></div>' +
            (fixed ? '<div class="sm" style="color:var(--warn)">Your main colour ' + esc(b.a) + ' is too light for white text — the pack uses ' + esc(t.a) + ' (same hue, darker). <a data-bfix="0">Use it exactly</a></div>' :
                b.fix === false && P0.contrast(b.a, '#ffffff') < 4.5 ? '<div class="sm" style="color:var(--warn)">White text on ' + esc(b.a) + ' is hard to read. <a data-bfix="1">Darken it for reading</a></div>' : '') +
            '<div class="row sm" style="margin-top:8px;gap:6px;flex-wrap:wrap">' + (p.logo ? '<button class="btn sm" id="pk-bfromlogo"><i class="fa-solid fa-wand-magic-sparkles"></i> From the logo</button>' : '<span class="muted">add a logo below to take the colours from it</span>') +
            (cb ? '<button class="btn sm" id="pk-busecb" title="' + esc(cb.a + ' ' + cb.b + ' ' + cb.c) + '">Use the company brand</button>' : '') +
            '<button class="btn sm" id="pk-bsave" title="New packs start with these colours; packs set to Brand without their own colours use them">Save as the company brand</button></div>' +
            '<div id="pk-blogo" class="pk-blogo"></div></div>';
    };
    D.wireBrand = function (box, p) {
        if (p.theme !== 'brand') return;
        var P0 = P(), cur = function () { if (!p.brand || !/^#/.test(p.brand.a || '')) p.brand = Object.assign({}, P0.companyBrand() || { a: '#0b2545', b: '#1d4ed8', c: '#0d9488' }); return p.brand; };
        var set = function (k, v) { if (!/^#[0-9a-f]{6}$/i.test(v)) return; cur()[k] = v.toLowerCase(); D.touch(); D.paintLeft(); D.paintList(); };
        box.querySelectorAll('[data-bc]').forEach(function (x) { x.onchange = function () { set(x.dataset.bc, x.value); }; });
        box.querySelectorAll('[data-bh]').forEach(function (x) { x.onchange = function () { var v = x.value.trim(); if (!/^#/.test(v)) v = '#' + v; if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; if (/^#[0-9a-f]{6}$/i.test(v)) set(x.dataset.bh, v); else FL.toast('Type a colour like #6d28d9', 'err'); }; });
        box.querySelectorAll('[data-bfix]').forEach(function (x) { x.onclick = function () { cur().fix = x.dataset.bfix === '1'; D.touch(); D.paintLeft(); D.paintList(); }; });
        if ($('pk-busecb')) $('pk-busecb').onclick = function () { p.brand = Object.assign({}, P0.companyBrand()); D.touch(); D.paintLeft(); D.paintList(); };
        if ($('pk-bsave')) $('pk-bsave').onclick = function () {
            FL.config.pack = FL.config.pack || {}; FL.config.pack.brand = Object.assign({}, cur());
            FL.saveConfig().then(function () { FL.toast('Saved as the company brand — new packs start with it', 'ok'); D.paintLeft(); }).catch(function (e) { FL.toast(String(e), 'err'); });
        };
        if ($('pk-bfromlogo')) $('pk-bfromlogo').onclick = function () {
            var out = $('pk-blogo'); out.innerHTML = '<span class="sm muted">reading the logo…</span>';
            P0.logoColours(p.logo).then(function (cols) {
                if (!cols.length) { out.innerHTML = '<span class="sm muted">No colours found — the logo is only black, white or grey. Type your brand colours above.</span>'; return; }
                var g = P0.brandFrom(cols);
                out.innerHTML = '<div class="sm muted">Colours in the logo — click one to use it as Main / Second / Accent, or take the suggestion.</div><div class="row" style="gap:6px;margin-top:5px;flex-wrap:wrap">' +
                    cols.map(function (c) { return '<span class="pk-bchip" style="background:' + c + '" title="' + c + '"><button data-lc="a" data-c="' + c + '">M</button><button data-lc="b" data-c="' + c + '">S</button><button data-lc="c" data-c="' + c + '">A</button></span>'; }).join('') +
                    '<button class="btn sm primary" id="pk-bsugg">Use suggestion <span class="pk-bmini"><i style="background:' + g.a + '"></i><i style="background:' + g.b + '"></i><i style="background:' + g.c + '"></i></span></button></div>';
                out.querySelectorAll('[data-lc]').forEach(function (x) { x.onclick = function () { set(x.dataset.lc, x.dataset.c); }; });
                $('pk-bsugg').onclick = function () { p.brand = Object.assign({}, p.brand || {}, g); D.touch(); D.paintLeft(); D.paintList(); };
            });
        };
    };

    /** Layout, menu colour, paper and font — each a row of small pictures of the result */
    D.lookBox = function (p, t) {
        var P0 = FL.packs, L = P0.look(p), light = P0.lightMenu(L.menu);
        var menuBg = function (m) { return { theme: t.a, grad: 'linear-gradient(180deg,' + t.a + ',' + t.b + ')', dark: '#0b1222', white: '#fff', tint: 'color-mix(in srgb,' + t.a + ' 12%,#fff)' }[m]; };
        var bar = function (m, css) { return '<i style="' + css + 'background:' + menuBg(m) + (P0.lightMenu(m) ? ';box-shadow:0 0 0 1px #d5dbe5' : '') + '"></i>'; };
        var ln = function (css) { return '<i style="' + css + 'background:#cfd6e2;height:3px;border-radius:2px"></i>'; };
        var body = function (x) { return ln('left:' + x + 'px;top:10px;width:22px;') + ln('left:' + x + 'px;top:16px;width:30px;') + ln('left:' + x + 'px;top:22px;width:26px;') + '<i style="left:' + x + 'px;top:28px;width:32px;height:9px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px #dfe4ec"></i>'; };
        var pic = {
            side: function (m) { return bar(m, 'left:0;top:0;bottom:0;width:15px;') + body(20); },
            right: function (m) { return bar(m, 'right:0;top:0;bottom:0;width:15px;') + body(5); },
            rail: function (m) { return bar(m, 'left:0;top:0;bottom:0;width:7px;') + body(13); },
            top: function (m) { return bar(m, 'left:0;right:0;top:0;height:7px;') + ln('left:6px;top:13px;width:30px;') + ln('left:6px;top:19px;width:46px;') + '<i style="left:6px;top:25px;width:52px;height:12px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px #dfe4ec"></i>'; },
            cards: function (m) { return bar(m, 'left:0;right:0;top:0;height:6px;') + [0, 1, 2, 3, 4, 5].map(function (i) { return '<i style="left:' + (5 + (i % 3) * 19) + 'px;top:' + (11 + Math.floor(i / 3) * 14) + 'px;width:16px;height:11px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px #dfe4ec;border-top:2px solid ' + t.b + '"></i>'; }).join(''); },
            doc: function (m) { return bar(m, 'left:0;right:0;top:0;height:6px;') + [0, 1, 2].map(function (i) { return ln('left:6px;top:' + (11 + i * 10) + 'px;width:' + (48 - i * 8) + 'px;') + '<i style="left:6px;top:' + (15 + i * 10) + 'px;width:52px;height:3px;background:#e7ebf2"></i>'; }).join(''); }
        };
        var row = function (key, map, cur, draw, name) {
            return '<div class="field" style="margin-top:10px">' + name + '</div><div class="pk-lays">' + Object.keys(map).map(function (k) {
                var m = map[k];
                return '<button class="pk-lay' + (cur === k ? ' on' : '') + '" data-look="' + key + '" data-v="' + k + '" title="' + esc(m.what || m.label || m) + '"><span class="th">' + draw(k) + '</span><span>' + esc(m.label || m) + '</span></button>';
            }).join('') + '</div>';
        };
        return row('layout', P0.LAYOUTS, L.layout, function (k) { return pic[k](L.menu); }, 'Layout') +
            row('menu', P0.MENUS, L.menu, function (k) { return pic[L.layout](k); }, 'Menu colour') +
            '<div class="sm muted" style="margin-top:4px">' + esc(P0.LAYOUTS[L.layout].what) + (light ? ' · white menus use the theme colour for the page you are on' : '') + '</div>' +
D.heroBox(p, t) +
            '<div class="row" style="margin-top:8px;gap:14px"><span class="sm">Page</span>' + Object.keys(P0.PAPERS).map(function (k) { return '<button class="btn sm' + (L.paper === k ? ' primary' : '') + '" data-look="paper" data-v="' + k + '">' + esc(P0.PAPERS[k]) + '</button>'; }).join('') +
            '<span class="sm" style="margin-left:6px">Font</span>' + Object.keys(P0.FONTS).map(function (k) { return '<button class="btn sm' + (L.font === k ? ' primary' : '') + '" data-look="font" data-v="' + k + '"' + (k === 'serif' ? ' style="font-family:Georgia,serif"' : '') + '>' + esc(P0.FONTS[k]) + '</button>'; }).join('') + '</div>';
    };

    /** The cover banner of the Summary page: style, pattern, colours, size, alignment, picture */
    D.heroBox = function (p, t) {
        var P0 = FL.packs, H = P0.hero(p), raw = p.hero || {}, c1 = H.c1 || t.a, c2 = H.c2 || t.b;
        var bg = function (st) {
            return { grad: 'linear-gradient(135deg,' + c1 + ',' + c2 + ')', solid: c1, dark: 'linear-gradient(135deg,#0b1222,#1e293b)', soft: 'color-mix(in srgb,' + c1 + ' 12%,#fff)', white: '#fff', minimal: 'transparent',
                image: raw.img ? 'linear-gradient(100deg,rgba(8,12,28,.8),rgba(8,12,28,.3)),url(' + raw.img + ') center/cover' : 'repeating-linear-gradient(45deg,#e2e8f0 0 6px,#f1f5f9 6px 12px)' }[st];
        };
        var pic = function (st) {
            var light = P0.lightHero(st) || (st === 'image' && !raw.img), ink = light ? c1 : '#fff';
            return '<i style="left:5px;right:5px;top:7px;height:24px;border-radius:4px;background:' + bg(st) + (st === 'white' ? ';box-shadow:0 0 0 1px #dfe4ec;border-left:3px solid ' + c2 : '') + (st === 'minimal' ? ';border-radius:0;border-bottom:2px solid ' + c2 : '') + '"></i>' +
                '<i style="left:10px;top:13px;width:24px;height:3px;border-radius:2px;background:' + ink + '"></i><i style="left:10px;top:19px;width:14px;height:3px;border-radius:2px;background:' + ink + ';opacity:.7"></i>' +
                '<i style="left:5px;top:34px;width:16px;height:5px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px #dfe4ec"></i><i style="left:24px;top:34px;width:16px;height:5px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px #dfe4ec"></i><i style="left:43px;top:34px;width:16px;height:5px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px #dfe4ec"></i>';
        };
        var chips = function (key, map, cur) { return Object.keys(map).map(function (k) { return '<button class="btn sm' + (cur === k ? ' primary' : '') + '" data-hero="' + key + '" data-v="' + k + '">' + esc(map[k]) + '</button>'; }).join(''); };
        return '<div class="field" style="margin-top:12px">Cover banner <span class="sm muted">(top of the Summary page)</span></div><div class="pk-lays">' + Object.keys(P0.HEROES).map(function (k) {
                return '<button class="pk-lay' + ((raw.style && FL.packs.HEROES[raw.style] ? raw.style : H.style) === k ? ' on' : '') + '" data-hero="style" data-v="' + k + '"><span class="th">' + pic(k) + '</span><span>' + esc(P0.HEROES[k]) + '</span></button>';
            }).join('') + '</div>' +
            (raw.style === 'image' ? '<div class="row sm" style="margin-top:6px"><label class="btn sm"><i class="fa-solid fa-image"></i> ' + (raw.img ? 'Change picture' : 'Choose a picture') + '<input type="file" id="pk-heroimg" accept="image/png,image/jpeg,image/webp" hidden></label>' + (raw.img ? '<span class="muted">darkened on the left so the title reads</span>' : '<span class="muted">until a picture is chosen the gradient is used · up to 700 KB</span>') + '</div>' : '') +
            '<div class="row sm pk-hrow"><span>Pattern</span>' + chips('deco', P0.DECOS, H.deco) + '</div>' +
            '<div class="row sm pk-hrow"><span>Colours</span><label title="Main colour"><input type="color" id="pk-hc1" value="' + c1 + '"></label><label title="Second colour"><input type="color" id="pk-hc2" value="' + c2 + '"></label>' +
            (H.c1 || H.c2 ? '<button class="btn sm" id="pk-hcreset">Use the theme colours</button>' : '<span class="muted">the theme colours — pick to change only the banner</span>') + '</div>' +
            '<div class="row sm pk-hrow"><span>Size</span>' + chips('size', P0.HSIZES, H.size) + '<span style="margin-left:8px">Text</span>' + chips('align', { left: 'Left', center: 'Centred' }, H.align) + '</div>';
    };

    /** Logo settings: background plate, colour, size — with a live sample on the menu, the cover and the e-mail header */
    D.logoBox = function (p) {
        var o = p.logoOpts || {}, P0 = FL.packs;
        var sel = function (k, map, cur) { return '<select data-lo="' + k + '" class="sm">' + Object.keys(map).map(function (v) { return '<option value="' + v + '"' + ((cur || Object.keys(map)[0]) === v ? ' selected' : '') + '>' + esc(map[v]) + '</option>'; }).join('') + '</select>'; };
        return '<div class="pk-logobox"><div class="row sm"><label>Background ' + sel('bg', P0.PLATES, o.bg || 'auto') + '</label><label>Colour ' + sel('tint', P0.TINTS, o.tint || 'none') + '</label>' +
            '<label>Size <input type="range" data-lo="size" min="24" max="110" step="2" value="' + (o.size || 48) + '" style="width:110px;vertical-align:middle"></label></div>' +
            '<div class="pk-logoprev" id="pk-logoprev"><span class="sm muted">checking the logo…</span></div><div class="sm muted" id="pk-logonote"></div></div>';
    };
    D.paintLogo = function () {
        var p = D.cur, box = $('pk-logoprev'); if (!box || !p.logo) return;
        var th = FL.packs.themeOf(p), n = ++D._ln || (D._ln = 1);
        FL.packs.logoReady(p).then(function (lg) {
            if (n !== D._ln || !lg) return;
            var img = function (where) { return '<img src="' + esc(lg.src) + '" style="' + FL.packs.logoCss(lg, where) + 'max-width:92%">'; };
            box.innerHTML = '<div class="pk-lp" style="background:' + th.a + '">' + img('menu') + '<small>menu</small></div>' +
                '<div class="pk-lp" style="background:linear-gradient(135deg,' + th.a + ',' + th.b + ' 65%,' + th.c + ')">' + img('cover') + '<small>cover</small></div>' +
                '<div class="pk-lp" style="background:' + th.a + '">' + '<img src="' + esc(lg.png) + '" style="' + FL.packs.logoCss(lg, 'mail') + 'max-width:92%"><small>e-mail</small></div>';
            var i = lg.info || {}, o = p.logoOpts || {}, t = [];
            t.push(i.alpha ? 'Transparent background' + ((o.tint || 'none') === 'knockout' ? ' (white removed)' : '') : 'Solid background (' + (i.w || '?') + ' × ' + (i.h || '?') + ' px)');
            if (i.lum != null) t.push(i.lum < 0.45 ? 'dark logo' : i.lum > 0.75 ? 'light logo' : 'mid-tone logo');
            if ((o.bg || 'auto') === 'auto') t.push('Automatic chose ' + FL.packs.PLATES[lg.plate.key].toLowerCase());
            if (i.alpha && i.lum < 0.45 && lg.plate.key === 'none' && (o.tint || 'none') === 'none') t.push('⚠ a dark logo on the dark menu is hard to see — choose a white plate or All white');
            if (!i.alpha && (o.tint || 'none') === 'none') t.push('tip: Remove white background makes a white-boxed logo sit on the theme colour');
            $('pk-logonote').textContent = t.join(' · ');
        });
    };

    D.secHtml = function (s, i) {
        var t = P().TYPES[s.type] || {}, o = s.opts || {}, open = D.open === s.id, body = '';
        if (s.type === 'summary') body = '<label><input type="checkbox" data-o="kpis"' + (o.kpis !== false ? ' checked' : '') + '> headline KPI tiles</label> <label><input type="checkbox" data-o="highlights"' + (o.highlights !== false ? ' checked' : '') + '> highlights from the numbers</label> <label><input type="checkbox" data-o="attention"' + (o.attention !== false ? ' checked' : '') + '> attention points (monitors)</label>' +
            '<label class="field" style="margin-top:6px">Commentary (Markdown) <a class="sm" data-act="draft" style="float:right">write a draft from the numbers</a><textarea rows="5" data-o="note">' + esc(o.note || '') + '</textarea></label>';
        else if (s.type === 'tb') body = '<div class="row"><label class="sm">Range <select data-o="range">' + opt('MTD', 'Month', o.range) + opt('QTD', 'Quarter to date', o.range) + opt('YTD', 'Year to date', o.range || 'YTD') + opt('LTM', 'Last 12 months', o.range) + '</select></label>' +
            '<label class="sm">Show <select data-o="group">' + opt('type', 'by type (opens into accounts)', o.group || 'type') + opt('account', 'every account', o.group) + '</select></label><label class="sm"><input type="checkbox" data-o="zero"' + (o.zero ? ' checked' : '') + '> include empty accounts</label></div>';
        else if (s.type === 'statement') {
            var tp = FL.tpl(o.tpl), kind = tp && /^(PL|BS)$/.test(tp.type) ? tp.type : null;
            body = '<div class="row"><label class="sm">Template <select data-o="tpl">' + (FL.templates || []).map(function (x) { return opt(x.id, x.name + ' (' + x.type + ')', o.tpl); }).join('') + '</select></label>' +
                (kind ? '<label class="sm">Columns <select data-o="cols">' + opt('_tpl', 'as in the template', o.cols || '_tpl') + FINE.COLSETS[kind].map(function (c) { return opt(c.id, c.label, o.cols); }).join('') + '</select></label>' : '') +
                '<label class="sm"><input type="checkbox" data-o="detail"' + (o.detail ? ' checked' : '') + '> lines open into accounts</label><label class="sm"><input type="checkbox" data-o="hideZero"' + (o.hideZero !== false ? ' checked' : '') + '> hide empty lines</label></div>';
        } else if (s.type === 'charts') body = '<label><input type="checkbox" data-o="trend"' + (o.trend !== false ? ' checked' : '') + '> revenue & profit trend</label> <label><input type="checkbox" data-o="margins"' + (o.margins !== false ? ' checked' : '') + '> margins</label> <label><input type="checkbox" data-o="bridge"' + (o.bridge !== false ? ' checked' : '') + '> net profit bridge</label>';
        else if (s.type === 'text') body = '<label class="field">Text (Markdown: # heading, **bold**, - list)<textarea rows="7" data-o="text">' + esc(o.text || '') + '</textarea></label>';
        else body = '<span class="sm muted">' + esc(t.what || '') + ' — nothing to set.</span>';
        return '<div class="pk-sec' + (s.on === false ? ' off' : '') + (open ? ' open' : '') + '" data-i="' + i + '" draggable="true"><div class="pk-sr"><span class="pk-grip" title="Drag to move"><i class="fa-solid fa-grip-vertical"></i></span>' +
            '<input type="checkbox" data-on' + (s.on !== false ? ' checked' : '') + ' title="In the pack"><span class="pk-ty">' + esc(t.label || s.type) + '</span><input class="pk-st" data-title value="' + esc(s.title) + '">' +
            '<button class="icon" data-mv="-1" title="Up"><i class="fa-solid fa-arrow-up"></i></button><button class="icon" data-mv="1" title="Down"><i class="fa-solid fa-arrow-down"></i></button>' +
            '<button class="icon" data-tg title="Settings"><i class="fa-solid fa-sliders"></i></button><button class="icon" data-rm title="Remove"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="pk-sb">' + body + '</div></div>';
    };

    D.wireSecs = function (box) {
        var p = D.cur, list = p.sections;
        box.querySelectorAll('.pk-sec').forEach(function (el) {
            var i = +el.dataset.i, s = list[i];
            el.querySelector('[data-on]').onchange = function () { s.on = this.checked; el.classList.toggle('off', !s.on); D.touch(); };
            el.querySelector('[data-title]').oninput = function () { s.title = this.value; D.touch(); };
            el.querySelector('[data-tg]').onclick = function () { D.open = D.open === s.id ? null : s.id; D.paintLeft(); };
            el.querySelector('[data-rm]').onclick = function () { if (!confirm('Remove the section "' + s.title + '"?')) return; list.splice(i, 1); D.touch(); D.paintLeft(); };
            el.querySelectorAll('[data-mv]').forEach(function (b) { b.onclick = function () { var j = i + +b.dataset.mv; if (j < 0 || j >= list.length) return; list.splice(j, 0, list.splice(i, 1)[0]); D.touch(); D.paintLeft(); }; });
            el.querySelectorAll('[data-o]').forEach(function (x) {
                x.oninput = x.onchange = function () {
                    s.opts = s.opts || {};
                    s.opts[x.dataset.o] = x.type === 'checkbox' ? x.checked : x.value;
                    if (x.dataset.o === 'tpl') { var t = FL.tpl(x.value); if (t && (!s.title || /^(Statement|Income Statement|Balance Sheet|Cash Flow)$/.test(s.title) || FL.templates.some(function (z) { return z.name === s.title; }))) s.title = t.name; s.opts.cols = '_tpl'; D.paintLeft(); }
                    D.touch();
                };
            });
            var dr = el.querySelector('[data-act="draft"]'); if (dr) dr.onclick = function () { D.draftNote(s); };
            el.addEventListener('dragstart', function (e) { D.drag = i; e.dataTransfer.effectAllowed = 'move'; el.classList.add('drag'); });
            el.addEventListener('dragend', function () { el.classList.remove('drag'); });
            el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('over'); });
            el.addEventListener('dragleave', function () { el.classList.remove('over'); });
            el.addEventListener('drop', function (e) { e.preventDefault(); el.classList.remove('over'); var a = D.drag; if (a == null || a === i) return; list.splice(i, 0, list.splice(a, 1)[0]); D.drag = null; D.touch(); D.paintLeft(); });
        });
    };

    /** A commentary draft from the numbers (highlights + attention points), editable */
    D.draftNote = function (s) {
        P().build(D.cur).then(function (b) {
            var m = b.model, t = '## ' + m.period + '\n\n' + m.highlights.map(function (x) { return '- ' + x; }).join('\n') + (m.attention.length ? '\n\n**Attention:**\n' + m.attention.map(function (x) { return '- ' + x; }).join('\n') : '');
            s.opts.note = (s.opts.note ? s.opts.note + '\n\n' : '') + t; D.touch(); D.paintLeft();
        }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
    };

    /** Desktop preview = the pack at 1280 px wide, scaled to the panel (else the narrow frame would show the phone layout) */
    D.fit = function () {
        var fr = document.querySelector('.pk-frame'), f = $('pk-f'); if (!fr || !f) return;
        var H = Math.max(520, window.innerHeight - 230), W = fr.clientWidth - 16;
        if (D.view === 'phone') { f.style.cssText = 'width:390px;height:' + H + 'px'; fr.style.height = ''; return; }
        var sc = Math.min(1, W / 1280);
        f.style.cssText = 'width:1280px;height:' + Math.round(H / sc) + 'px;transform:scale(' + sc + ');transform-origin:0 0;margin:0';
        fr.style.height = (H + 16) + 'px';
    };
    D.schedule = function () { clearTimeout(D._t); D._t = setTimeout(D.preview, 900); };
    D.preview = function () {
        var f = $('pk-f'); if (!f || !D.cur) return;
        if (!(FL.status && FL.status.loaded)) { f.srcdoc = '<p style="font:14px Segoe UI;color:#64748b;padding:30px">No data loaded yet — sync a trial balance (Data › Trial balance sync) and the preview fills.</p>'; return; }
        var n = ++D._n || (D._n = 1);
        $('pk-pstat').textContent = 'building…';
        return P().build(D.cur, function (m) { if ($('pk-pstat')) $('pk-pstat').textContent = m; }).then(function (b) {
            if (n !== D._n) return;
            D.built = b; D.builtFor = JSON.stringify(D.cur) + FL.filter.period + FL.filterText();
            var keep = ''; try { var on = f.contentDocument && f.contentDocument.querySelector('section.on'); keep = on ? on.id : ''; } catch (e) { /* not loaded */ }
            f.srcdoc = keep ? b.html.replace('<script>', '<script>window.PACK_START=' + JSON.stringify(keep) + ';') : b.html;   // stay on the section shown
            $('pk-pstat').textContent = b.sections.length + ' sections · ' + Math.round(b.html.length / 1024) + ' KB';
        }).catch(function (e) { if ($('pk-pstat')) $('pk-pstat').textContent = 'failed: ' + (e && e.message || e); console.error(e); });
    };
    /** The built pack for the design and filter on screen (rebuilt when either changed) */
    D.ensureBuilt = function () {
        if (!(FL.status && FL.status.loaded)) { FL.toast('Load data first', 'err'); return Promise.reject('no data'); }
        if (D.built && D.builtFor === JSON.stringify(D.cur) + FL.filter.period + FL.filterText()) return Promise.resolve(D.built);
        var bid = FL.busy.start('Building the board pack…');
        return P().build(D.cur, function (m) { FL.busy.line(bid, m); }).then(function (b) { D.built = b; D.builtFor = JSON.stringify(D.cur) + FL.filter.period + FL.filterText(); FL.busy.end(bid); return b; })
            .catch(function (e) { FL.busy.end(bid, String(e && e.message || e)); FL.toast('Pack failed: ' + (e && e.message || e), 'err'); throw e; });
    };
})();
