/* Finance Lens — Board packs › New (FL.packNew): the tab that creates a design.
   Three ways: a standard pack (the usual sections, the company brand when one is saved), a design from a PDF or a picture
   (Claude reads a board pack / report / brand guide / screenshot and proposes the colours, layout, menu, cover banner, font
   and the sections in order — host action finPackDesign, FinancePackAi.cs; only the design is used, never the numbers),
   or a copy of an existing design. The new design opens in its own tab. */
(function () {
    var N = FL.packNew = { mode: 'std', file: null, result: null };
    var D = function () { return FL.packDesign; };
    var P = function () { return FL.packs; };
    var HEX = /^#[0-9a-f]{6}$/i;

    N.render = function (body) {
        var packs = D().doc.packs, cb = P().companyBrand();
        var card = function (m, ic, title, text) { return '<button class="pk-nopt' + (N.mode === m ? ' on' : '') + '" data-m="' + m + '"><i class="fa-solid ' + ic + '"></i><b>' + title + '</b><span>' + text + '</span></button>'; };
        body.innerHTML = '<div class="card"><h3 style="margin:0 0 10px"><i class="fa-solid fa-plus"></i> New board pack</h3><div class="pk-nopts">' +
            card('std', 'fa-file-circle-plus', 'Standard pack', 'Summary, trial balance, income statement, balance sheet, cash flow, KPIs and charts' + (cb ? ' — in your company brand' : '')) +
            card('pdf', 'fa-wand-magic-sparkles', 'Design from a PDF or picture', 'Upload a board pack, report, brand guide or screenshot — the AI designs a pack that looks the same') +
            card('copy', 'fa-copy', 'Copy a design', 'Start from one of your ' + packs.length + ' design' + (packs.length === 1 ? '' : 's')) +
            '</div></div><div id="pk-nbody"></div>';
        body.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { N.mode = b.dataset.m; N.render(body); }; });
        var nb = $('pk-nbody');
        if (N.mode === 'std') {
            nb.innerHTML = '<div class="card" style="margin-top:12px"><div class="row" style="gap:10px;flex-wrap:wrap"><label class="field" style="margin:0;min-width:280px">Name<input id="pk-nname" value="Board pack ' + (packs.length + 1) + '"></label>' +
                '<label class="field" style="margin:0;min-width:220px">Title on the cover<input id="pk-ntitle" value="Monthly board pack"></label><span class="grow"></span><button class="btn primary" id="pk-ngo"><i class="fa-solid fa-check"></i> Create and open</button></div></div>';
            $('pk-ngo').onclick = function () { var p = P().newPack($('pk-nname').value.trim() || 'Board pack'); p.title = $('pk-ntitle').value.trim() || p.title; if (p.theme === 'brand') p.brand = Object.assign({}, cb); D().addPack(p); };
        } else if (N.mode === 'copy') {
            nb.innerHTML = '<div class="pk-cards" style="margin-top:12px">' + packs.map(function (p) {
                return '<div class="pk-card" data-id="' + esc(p.id) + '">' + D().mini(p) + '<div class="pk-cb"><b>' + esc(p.name) + '</b><div class="sm muted">' + esc(p.title || '') + '</div><div class="pk-ca"><button class="btn sm primary"><i class="fa-regular fa-copy"></i> Copy this</button></div></div></div>';
            }).join('') + '</div>';
            nb.querySelectorAll('[data-id]').forEach(function (c) { c.onclick = function () { var cp = JSON.parse(JSON.stringify(D().byId(c.dataset.id))); cp.id = 'p' + Date.now().toString(36); cp.name += ' (copy)'; delete cp.lastSent; delete cp.updated; D().addPack(cp); }; });
        } else N.renderPdf(nb);
    };

    // ── design from a PDF or picture ──
    N.renderPdf = function (nb) {
        var f = N.file;
        nb.innerHTML = '<div class="pk-pdf"><div class="card"><h4 class="pk-h"><i class="fa-solid fa-file-pdf"></i> 1 · The document</h4>' +
            '<label class="pk-drop" id="pk-drop"><input type="file" id="pk-file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden>' +
            (f ? '<i class="fa-solid ' + (f.pdf ? 'fa-file-pdf' : 'fa-image') + '"></i><b>' + esc(f.name) + '</b><span>' + Math.round(f.size / 1024) + ' KB · click or drop to change</span>'
               : '<i class="fa-solid fa-cloud-arrow-up"></i><b>Drop a PDF or a picture here</b><span>a board pack, management report, annual report, brand guide or a screenshot — up to 15 MB</span>') + '</label>' +
            (f ? '<div class="pk-docprev">' + (f.pdf ? '<iframe src="' + f.url + '#toolbar=0&view=FitH" title="The PDF"></iframe>' : '<img src="' + f.url + '" alt="">') + '</div>' : '') +
            '<label class="field" style="margin-top:10px">Anything to keep or change? <span class="muted sm">(optional)</span><textarea id="pk-nnotes" rows="3" placeholder="e.g. keep their colours but use a top menu; amounts in thousands; add a trial balance">' + esc(N.notes || '') + '</textarea></label>' +
            '<div class="row" style="margin-top:8px"><span class="sm muted">The AI copies the look and the order of the pages — never the numbers. Uses the Claude key of Fusion SQL › Ask AI.</span><span class="grow"></span>' +
            '<button class="btn primary" id="pk-ndesign"' + (f ? '' : ' disabled') + '><i class="fa-solid fa-wand-magic-sparkles"></i> Design it</button></div></div>' +
            '<div class="card" id="pk-nres"><h4 class="pk-h"><i class="fa-solid fa-swatchbook"></i> 2 · The proposed design</h4>' + (N.result ? '' : '<p class="muted sm">Upload a document and press <b>Design it</b>. You will see the colours, layout, cover and sections before anything is created.</p>') + '</div></div>';
        var pick = function (file) {
            if (!file) return;
            var pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
            if (!pdf && !/^image\/(png|jpe?g|webp)$/.test(file.type)) { FL.toast('Use a PDF, PNG, JPG or WebP file', 'err'); return; }
            if (file.size > 15 * 1024 * 1024) { FL.toast('The file is larger than 15 MB', 'err'); return; }
            var r = new FileReader();
            r.onload = function () {
                if (N.file && N.file.url) URL.revokeObjectURL(N.file.url);
                N.file = { name: file.name, size: file.size, mime: pdf ? 'application/pdf' : file.type, pdf: pdf, base64: String(r.result).split(',')[1], url: URL.createObjectURL(file) };
                N.result = null; N.renderPdf(nb);
            };
            r.readAsDataURL(file);
        };
        $('pk-file').onchange = function () { pick(this.files[0]); };
        var dz = $('pk-drop');
        dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); };
        dz.ondragleave = function () { dz.classList.remove('over'); };
        dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('over'); pick(e.dataTransfer.files[0]); };
        $('pk-nnotes').oninput = function () { N.notes = this.value; };
        $('pk-ndesign').onclick = function () { N.design(nb); };
        if (N.result) N.paintResult();
    };

    /** What the AI may choose from: section types, statement templates, column sets, looks */
    N.catalogue = function () {
        var t = P().TYPES;
        return JSON.stringify({
            sectionTypes: Object.keys(t).map(function (k) { return { type: k, label: t[k].label, what: t[k].what }; }),
            templates: (FL.templates || []).map(function (x) { return { id: x.id, name: x.name, kind: x.type }; }),
            columnSets: { PL: FINE.COLSETS.PL.map(function (c) { return { key: c.id, label: c.label }; }), BS: FINE.COLSETS.BS.map(function (c) { return { key: c.id, label: c.label }; }), note: 'CF uses the template columns (_tpl)' },
            layouts: P().LAYOUTS, menus: Object.keys(P().MENUS), heroStyles: Object.keys(P().HEROES), patterns: Object.keys(P().DECOS)
        });
    };
    N.design = function (nb) {
        var btn = $('pk-ndesign'); btn.disabled = true;
        var box = $('pk-nres');
        box.innerHTML = '<h4 class="pk-h"><i class="fa-solid fa-swatchbook"></i> 2 · The proposed design</h4><div class="pk-thinking"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading ' + esc(N.file.name) + ' — colours, layout and the pages…<span class="sm muted"> (about a minute)</span></div>';
        var t0 = Date.now();
        FL.call('finPackDesign', { fileName: N.file.name, mime: N.file.mime, base64: N.file.base64, notes: N.notes || '', catalogue: N.catalogue() }, 400000).then(function (r) {
            if (!r || !r.ok) throw new Error(r && r.error || 'No answer');
            var m = /```packdesign\s*([\s\S]*?)```/.exec(r.answer || '') || /```json\s*([\s\S]*?)```/.exec(r.answer || '');
            if (!m) throw new Error('The AI did not return a design. ' + String(r.answer || '').slice(0, 300));
            var d = JSON.parse(m[1]);
            N.result = { design: d, said: String(r.answer).replace(m[0], '').trim(), cost: r.costUsd, secs: Math.round((Date.now() - t0) / 1000), pack: N.toPack(d) };
            N.paintResult();
        }).catch(function (e) {
            box.innerHTML = '<h4 class="pk-h"><i class="fa-solid fa-swatchbook"></i> 2 · The proposed design</h4><p class="neg">✗ ' + esc(String(e && e.message || e)) + '</p>';
        }).then(function () { if ($('pk-ndesign')) $('pk-ndesign').disabled = false; });
    };

    /** A pack from the AI's design: every value checked against what the app offers */
    N.toPack = function (d) {
        var p = P().newPack(String(d.name || 'Designed from ' + (N.file ? N.file.name.replace(/\.[^.]+$/, '') : 'a document')).slice(0, 80));
        var pick = function (v, map, def) { return map[v] ? v : def; };
        if (d.title) p.title = String(d.title).slice(0, 120);
        if (d.company) p.company = String(d.company).slice(0, 120);
        var b = d.brand || {};
        if (HEX.test(b.a || '')) { p.theme = 'brand'; p.brand = { a: b.a.toLowerCase(), b: HEX.test(b.b || '') ? b.b.toLowerCase() : b.a.toLowerCase(), c: HEX.test(b.c || '') ? b.c.toLowerCase() : (HEX.test(b.b || '') ? b.b.toLowerCase() : b.a.toLowerCase()) }; }
        p.layout = pick(d.layout, P().LAYOUTS, 'side'); p.menu = pick(d.menu, P().MENUS, 'theme'); p.paper = pick(d.paper, P().PAPERS, 'grey'); p.font = pick(d.font, P().FONTS, 'sans');
        var h = d.hero || {};
        p.hero = { style: h.style === 'image' ? 'grad' : pick(h.style, P().HEROES, 'grad'), deco: pick(h.deco, P().DECOS, 'none'), size: pick(h.size, P().HSIZES, 'normal'), align: h.align === 'center' ? 'center' : 'left' };
        if ([0, 1, 1000, 1000000].indexOf(+d.scale) >= 0) p.scale = +d.scale;
        var tpls = FL.templates || [], byKind = function (k) { return tpls.filter(function (t) { return t.type === k; })[0]; };
        var secs = [], id = function () { return 's' + Math.random().toString(36).slice(2, 8); };
        (Array.isArray(d.sections) ? d.sections : []).slice(0, 30).forEach(function (s) {
            var type = P().TYPES[s.type] ? s.type : null; if (!type) return;
            var sec = { id: id(), type: type, title: String(s.title || P().TYPES[type].label).slice(0, 80), on: true, opts: {}, why: s.why ? String(s.why).slice(0, 200) : '' };
            if (type === 'summary') sec.opts = { kpis: true, highlights: true, attention: true, note: s.note ? String(s.note).slice(0, 2000) : '' };
            if (type === 'tb') sec.opts = { range: ['MTD', 'QTD', 'YTD', 'LTM'].indexOf(s.range) >= 0 ? s.range : 'YTD', group: 'type' };
            if (type === 'text') sec.opts = { text: String(s.text || '# ' + sec.title + '\n\nWrite here.').slice(0, 8000) };
            if (type === 'charts') sec.opts = { trend: true, margins: true, bridge: true };
            if (type === 'statement') {
                var tpl = tpls.filter(function (t) { return t.id === s.statement; })[0] || byKind(s.statement) || byKind('PL'); if (!tpl) return;
                var kind = tpl.type === 'BS' ? 'BS' : tpl.type === 'CF' ? 'CF' : 'PL';
                var cols = kind !== 'CF' && FINE.COLSETS[kind].some(function (c) { return c.id === s.cols; }) ? s.cols : '_tpl';
                sec.opts = { tpl: tpl.id, cols: cols, detail: kind !== 'CF', hideZero: true };
            }
            secs.push(sec);
        });
        if (!secs.some(function (s) { return s.type === 'summary'; })) secs.unshift({ id: id(), type: 'summary', title: 'Summary', on: true, opts: { kpis: true, highlights: true, attention: true, note: '' } });
        if (secs.length > 1) p.sections = secs;
        p.fromDoc = N.file ? N.file.name : '';
        return p;
    };

    N.paintResult = function () {
        var box = $('pk-nres'), r = N.result; if (!box || !r) return;
        var p = r.pack, t = P().themeOf(p), L = P().look(p), H = P().hero(p), notes = Array.isArray(r.design.notes) ? r.design.notes : [];
        var sw = function (c, l) { return '<span class="pk-nsw"><i style="background:' + c + '"></i>' + l + '<code>' + c + '</code></span>'; };
        box.innerHTML = '<div class="row"><h4 class="pk-h" style="margin:0"><i class="fa-solid fa-swatchbook"></i> 2 · The proposed design</h4><span class="grow"></span><span class="sm muted">' + r.secs + ' s' + (r.cost != null ? ' · $' + (+r.cost).toFixed(3) : '') + '</span></div>' +
            '<div class="pk-nres"><div>' + D().mini(p) + '</div><div><label class="field" style="margin:0">Name<input id="pk-rname" value="' + esc(p.name) + '"></label>' +
            '<div class="pk-nsws">' + sw(t.a, 'Main') + sw(t.b, 'Second') + sw(t.c, 'Accent') + '</div>' +
            '<div class="pk-chips"><span>' + esc(P().LAYOUTS[L.layout].label) + '</span><span>menu: ' + esc(P().MENUS[L.menu].label) + '</span><span>cover: ' + esc(P().HEROES[H.style]) + (H.deco !== 'none' ? ' · ' + esc(P().DECOS[H.deco]) : '') + '</span><span>' + esc(P().FONTS[L.font]) + '</span>' + (p.scale ? '<span>' + ({ 1: 'units', 1000: 'thousands', 1000000: 'millions' })[p.scale] + '</span>' : '') + '</div></div></div>' +
            (r.said ? '<div class="pk-nsaid">' + esc(r.said).replace(/\n/g, '<br>') + '</div>' : '') +
            '<div class="field" style="margin-top:8px">Sections</div><ol class="pk-nsecs">' + p.sections.map(function (s) {
                var tpl = s.type === 'statement' ? (FL.templates || []).filter(function (x) { return x.id === s.opts.tpl; })[0] : null;
                return '<li><span class="pk-ty">' + esc(P().TYPES[s.type].label) + '</span> <b>' + esc(s.title) + '</b>' + (tpl ? ' <span class="sm muted">← ' + esc(tpl.name) + (s.opts.cols && s.opts.cols !== '_tpl' ? ' · ' + esc((FINE.COLSETS[tpl.type === 'BS' ? 'BS' : 'PL'].filter(function (c) { return c.id === s.opts.cols; })[0] || {}).label || '') : '') + '</span>' : '') +
                    (s.why ? '<div class="sm muted">' + esc(s.why) + '</div>' : '') + '</li>';
            }).join('') + '</ol>' +
            (notes.length ? '<div class="pk-nnotes"><b>Notes</b><ul>' + notes.map(function (x) { return '<li>' + esc(String(x)) + '</li>'; }).join('') + '</ul></div>' : '') +
            '<div class="row" style="margin-top:10px"><button class="btn" id="pk-nagain"><i class="fa-solid fa-rotate"></i> Try again</button><span class="grow"></span><button class="btn primary" id="pk-ncreate"><i class="fa-solid fa-check"></i> Create and open</button></div>';
        $('pk-rname').oninput = function () { p.name = this.value; };
        $('pk-nagain').onclick = function () { N.design(); };
        $('pk-ncreate').onclick = function () { var cp = JSON.parse(JSON.stringify(p)); cp.sections.forEach(function (s) { delete s.why; }); N.result = null; D().addPack(cp); FL.toast('Created "' + cp.name + '" — check it and press Save', 'ok'); };
    };
})();
