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
                if (!D.doc.packs.length) { var p = P().newPack('Monthly board pack'); var old = FL.config.pack || {}; if (old.title) p.title = old.title; if (old.by) p.by = old.by; D.doc.packs.push(p); D.dirty = true; }
                return D.doc;
            });
    };
    D.store = function () {
        if (D.cur) D.cur.updated = new Date().toISOString();
        return FL.call('finDocSave', { name: 'packs', json: JSON.stringify(D.doc, null, 1) }).then(function () { D.dirty = false; D.paintHead(); FL.toast('Board pack saved', 'ok'); });
    };
    D.touch = function (noPreview) { D.dirty = true; D.paintHead(); if (!noPreview) D.schedule(); };

    FL.TABS.packs = { render: function (el) { return D.render(el); } };

    D.render = function (el) {
        return D.load().then(function () {
            var id = FL.ls('pack.cur', null);
            D.cur = D.doc.packs.filter(function (p) { return p.id === id; })[0] || D.doc.packs[0];
            el.innerHTML = '<div class="pk-shell"><aside class="card pk-list"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-book-open"></i> Board packs</h3><span class="grow"></span><button class="btn sm primary" id="pk-new" title="A new pack with the standard sections"><i class="fa-solid fa-plus"></i> New</button></div><div id="pk-items"></div>' +
                '<p class="sm muted" style="margin-top:12px">Each pack is a design. It is built from the data of the period in the header and shared as one interactive HTML file — left menu, statements that open into accounts, search, CSV and print — by download or e-mail.</p>' +
                '<button class="btn sm" style="width:100%;margin-top:6px" onclick="FL.mail.setup()"><i class="fa-solid fa-envelope-circle-check"></i> E-mail setup</button></aside>' +
                '<div class="pk-main"><div class="card pk-head" id="pk-head"></div><div class="pk-cols"><div class="pk-left" id="pk-left"></div><div class="card pk-prev"><div class="row"><b><i class="fa-regular fa-eye"></i> Preview</b><span class="sm muted" id="pk-pstat"></span><span class="grow"></span>' +
                '<div class="seg sm"><button data-v="desktop"' + (D.view === 'desktop' ? ' class="on"' : '') + '><i class="fa-solid fa-desktop"></i></button><button data-v="phone"' + (D.view === 'phone' ? ' class="on"' : '') + '><i class="fa-solid fa-mobile-screen"></i></button></div>' +
                '<button class="btn sm" id="pk-refresh"><i class="fa-solid fa-rotate"></i></button><button class="btn sm" id="pk-full" title="Open the preview full screen"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button></div>' +
                '<div class="pk-frame ' + D.view + '"><iframe id="pk-f" title="Board pack preview"></iframe></div></div></div></div></div>';
            $('pk-new').onclick = function () { var p = P().newPack('Board pack ' + (D.doc.packs.length + 1)); D.doc.packs.push(p); D.cur = p; FL.lsSet('pack.cur', p.id); D.touch(true); D.paint(); };
            $('pk-refresh').onclick = function () { D.preview(); };
            $('pk-full').onclick = function () { if (D.built) FL.packView(D.built.html, { title: D.cur.title || D.cur.name }); };
            el.querySelectorAll('.pk-prev .seg button').forEach(function (b) { b.onclick = function () { D.view = b.dataset.v; FL.lsSet('pack.view', D.view); el.querySelectorAll('.pk-prev .seg button').forEach(function (x) { x.classList.toggle('on', x === b); }); el.querySelector('.pk-frame').className = 'pk-frame ' + D.view; D.fit(); }; });
            if (!D._rs) { D._rs = true; window.addEventListener('resize', function () { if (FL.tab === 'packs') D.fit(); }); }
            D.fit();
            D.paint();
            if (!(FL.status && FL.status.loaded)) $('pk-pstat').textContent = 'no data loaded — the preview fills once a trial balance is synced';
        });
    };

    D.paint = function () { D.paintList(); D.paintHead(); D.paintLeft(); D.preview(); };

    D.paintList = function () {
        var box = $('pk-items'); if (!box) return;
        box.innerHTML = D.doc.packs.map(function (p) {
            var th = P().THEMES[p.theme] || P().THEMES.navy;
            return '<div class="pk-item' + (p === D.cur ? ' on' : '') + '" data-id="' + esc(p.id) + '"><span class="pk-sw" style="background:linear-gradient(135deg,' + th.a + ',' + th.b + ')"></span><div><b>' + esc(p.name) + '</b><small>' +
                (p.sections || []).filter(function (s) { return s.on !== false; }).length + ' sections' + (p.updated ? ' · ' + esc(String(p.updated).slice(0, 10)) : '') + (p.lastSent ? ' · sent ' + esc(p.lastSent) : '') + '</small></div></div>';
        }).join('');
        box.querySelectorAll('.pk-item').forEach(function (it) { it.onclick = function () { D.cur = D.doc.packs.filter(function (p) { return p.id === it.dataset.id; })[0]; FL.lsSet('pack.cur', D.cur.id); D.paint(); }; });
    };

    D.paintHead = function () {
        var box = $('pk-head'); if (!box || !D.cur) return;
        box.innerHTML = '<div class="row"><input id="pk-name" class="pk-name" value="' + esc(D.cur.name) + '" title="Name of this design">' +
            (D.dirty ? '<span class="tag warn">not saved</span>' : '<span class="tag good">saved</span>') +
            '<button class="btn sm" id="pk-save"' + (D.dirty ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
            '<button class="btn sm ghost" id="pk-dup" title="Duplicate"><i class="fa-regular fa-copy"></i></button><button class="btn sm ghost" id="pk-del" title="Delete this design"><i class="fa-solid fa-trash"></i></button>' +
            '<span class="grow"></span><span class="sm muted">' + esc(FL.filterText()) + ' · ' + esc(FL.periodName(FL.filter.period)) + '</span>' +
            '<button class="btn" id="pk-dl"><i class="fa-solid fa-download"></i> Download HTML</button>' +
            '<button class="btn primary" id="pk-mail"><i class="fa-solid fa-paper-plane"></i> E-mail…</button></div>';
        $('pk-name').oninput = function () { D.cur.name = this.value; D.dirty = true; D.paintList(); };
        $('pk-name').onchange = function () { D.paintHead(); };
        $('pk-save').onclick = function () { D.store(); };
        $('pk-dup').onclick = function () { var c = JSON.parse(JSON.stringify(D.cur)); c.id = 'p' + Date.now().toString(36); c.name += ' (copy)'; delete c.lastSent; D.doc.packs.push(c); D.cur = c; FL.lsSet('pack.cur', c.id); D.touch(true); D.paint(); };
        $('pk-del').onclick = function () {
            if (D.doc.packs.length < 2) { FL.toast('Keep at least one pack', 'info'); return; }
            if (!confirm('Delete the board pack design "' + D.cur.name + '"?')) return;
            D.doc.packs = D.doc.packs.filter(function (p) { return p !== D.cur; }); D.cur = D.doc.packs[0]; D.store().then(D.paint);
        };
        $('pk-dl').onclick = function () { D.ensureBuilt().then(function (b) { FL.download(b.file, new Blob([b.html], { type: 'text/html' })); }); };
        $('pk-mail').onclick = function () { D.ensureBuilt().then(function (b) { FL.mail.compose(D.cur, b, function () { D.cur.lastSent = new Date().toISOString().slice(0, 10); D.store(); }); }); };
    };

    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>'; };

    D.paintLeft = function () {
        var box = $('pk-left'), p = D.cur; if (!box || !p) return;
        var th = P().THEMES, types = P().TYPES;
        var h = '<div class="card"><h4 class="pk-h"><i class="fa-solid fa-palette"></i> Look and feel</h4><div class="grid g2">' +
            '<label class="field">Title<input data-k="title" value="' + esc(p.title || '') + '"></label><label class="field">Company / group<input data-k="company" value="' + esc(p.company || '') + '"></label>' +
            '<label class="field">Prepared by<input data-k="by" value="' + esc(p.by || '') + '"></label>' +
            '<label class="field">Amounts<select data-k="scale">' + opt(0, 'As in the header (' + FL.scaleLabel() + ')', p.scale || 0) + opt(1, 'Units', p.scale) + opt(1000, 'Thousands', p.scale) + opt(1000000, 'Millions', p.scale) + '</select></label></div>' +
            '<div class="field" style="margin-top:8px">Colours</div><div class="pk-themes">' + Object.keys(th).map(function (k) {
                return '<button class="pk-theme' + (p.theme === k ? ' on' : '') + '" data-th="' + k + '" title="' + esc(th[k].name) + '"><span style="background:' + th[k].a + '"></span><span style="background:' + th[k].b + '"></span><span style="background:' + th[k].c + '"></span></button>';
            }).join('') + '</div>' +
            '<div class="row" style="margin-top:10px"><span class="field" style="margin:0">Logo</span>' + (p.logo ? '' : '<span class="sm muted">none</span>') +
            '<label class="btn sm"><i class="fa-solid fa-image"></i> ' + (p.logo ? 'Change' : 'Add') + '<input type="file" id="pk-logo" accept="image/png,image/jpeg,image/svg+xml" hidden></label>' + (p.logo ? '<button class="btn sm ghost" id="pk-nologo">Remove</button>' : '') + '</div>' + (p.logo ? D.logoBox(p) : '') + '</div>';
        h += '<div class="card" style="margin-top:12px"><div class="row"><h4 class="pk-h" style="margin:0"><i class="fa-solid fa-list-ol"></i> Sections <span class="sm muted">— the left menu of the pack, in this order</span></h4><span class="grow"></span>' +
            '<select id="pk-add" class="sm" style="max-width:190px"><option value="">+ Add a section…</option>' + Object.keys(types).map(function (k) { return '<option value="' + k + '">' + esc(types[k].label) + ' — ' + esc(types[k].what) + '</option>'; }).join('') + '</select></div>' +
            '<div id="pk-secs" class="pk-secs">' + (p.sections || []).map(function (s, i) { return D.secHtml(s, i); }).join('') + '</div></div>';
        box.innerHTML = h;
        box.querySelectorAll('[data-k]').forEach(function (x) { x.oninput = x.onchange = function () { p[x.dataset.k] = x.dataset.k === 'scale' ? +x.value : x.value; D.touch(); }; });
        box.querySelectorAll('[data-th]').forEach(function (b) { b.onclick = function () { p.theme = b.dataset.th; D.touch(); D.paintLeft(); D.paintList(); }; });
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
        var th = FL.packs.THEMES[p.theme] || FL.packs.THEMES.navy, n = ++D._ln || (D._ln = 1);
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
