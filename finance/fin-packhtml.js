/* Finance Lens — board packs as ONE interactive HTML file (and the e-mail that goes with it).
   FL.packs.build(pack) computes every section of a pack design (fin-packdesign.js) from the loaded data and returns
   { html, file, model }: html = a self-contained page (no CDN, works offline when opened from an e-mail) with a left
   menu — Summary, Trial balance, Income statement, Balance sheet, Cash flow, KPIs, charts, your own text — that
   shows one section at a time; statements open their lines into accounts, the trial balance opens by type, every
   table has a search box and a CSV download, Print prints the section on screen or the whole pack, a light / dark
   switch and a phone layout. model = the numbers the e-mail body needs (KPI tiles, key lines, highlights, chart).
   FL.packs.emailHtml(pack, model, opts) = an Outlook-safe message (tables + inline styles only, 640 px). */
(function () {
    var P = FL.packs = FL.packs || {};

    P.THEMES = {
        navy: { name: 'Navy', a: '#0b2545', b: '#1d4ed8', c: '#0d9488' },
        teal: { name: 'Teal', a: '#0f3d3e', b: '#0d9488', c: '#f59e0b' },
        plum: { name: 'Plum', a: '#3b0764', b: '#7c3aed', c: '#db2777' },
        graphite: { name: 'Graphite', a: '#111827', b: '#374151', c: '#2563eb' },
        forest: { name: 'Forest', a: '#14532d', b: '#16a34a', c: '#ca8a04' },
        crimson: { name: 'Crimson', a: '#450a0a', b: '#b91c1c', c: '#0ea5e9' }
    };
    P.TYPES = {
        summary: { label: 'Summary', icon: 'home', what: 'Cover, headline KPIs, highlights and your commentary' },
        tb: { label: 'Trial balance', icon: 'scale', what: 'Every account: opening, debits, credits, closing — by type, opens into accounts' },
        statement: { label: 'Statement', icon: 'file', what: 'Income statement, balance sheet, cash flow or any template — lines open into accounts' },
        kpis: { label: 'KPIs', icon: 'gauge', what: 'Every KPI: this month, last month, a year ago' },
        charts: { label: 'Charts', icon: 'chart', what: 'Revenue and profit trend, margins, profit bridge' },
        monitor: { label: 'Monitors', icon: 'bell', what: 'Monitors and covenants with their status' },
        text: { label: 'Text', icon: 'text', what: 'A page of your own text (Markdown: # headings, **bold**, - lists)' }
    };
    var ICON = {
        list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
        home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
        scale: 'M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0zM8 21h8',
        file: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8M9 9h3',
        gauge: 'M12 14l4-4M3.5 17a9 9 0 1 1 17 0',
        chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
        text: 'M4 6h16M4 12h16M4 18h10',
        print: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z',
        moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
        dl: 'M12 3v12M7 10l5 5 5-5M4 21h16',
        menu: 'M3 6h18M3 12h18M3 18h18'
    };
    P.svg = function (k, s) { return '<svg width="' + (s || 16) + '" height="' + (s || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (ICON[k] || ICON.file) + '"/></svg>'; };

    /** A new pack: Summary, Trial balance, Income statement, Balance sheet, Cash flow, KPIs, Charts */
    P.newPack = function (name) {
        var by = function (kind) { return (FL.templates || []).filter(function (t) { return t.type === kind; })[0]; };
        var pl = by('PL'), bs = by('BS'), cf = by('CF');
        var id = function () { return 's' + Math.random().toString(36).slice(2, 8); };
        var s = [{ id: id(), type: 'summary', title: 'Summary', on: true, opts: { kpis: true, highlights: true, attention: true, note: '' } },
            { id: id(), type: 'tb', title: 'Trial Balance', on: true, opts: { range: 'YTD', group: 'type', zero: false } }];
        if (pl) s.push({ id: id(), type: 'statement', title: 'Income Statement', on: true, opts: { tpl: pl.id, cols: '_tpl', detail: true, hideZero: true } });
        if (bs) s.push({ id: id(), type: 'statement', title: 'Balance Sheet', on: true, opts: { tpl: bs.id, cols: '_tpl', detail: true, hideZero: true } });
        if (cf) s.push({ id: id(), type: 'statement', title: 'Cash Flow', on: true, opts: { tpl: cf.id, cols: '_tpl', detail: false, hideZero: true } });
        s.push({ id: id(), type: 'kpis', title: 'Key indicators', on: true, opts: {} });
        s.push({ id: id(), type: 'charts', title: 'Performance', on: true, opts: { trend: true, margins: true, bridge: true } });
        return { id: 'p' + Date.now().toString(36), name: name || 'Monthly board pack', title: 'Monthly board pack', company: (FL.config.pack && FL.config.pack.company) || 'Grays Group',
            by: (FL.who && FL.who.user) || '', theme: 'navy', logo: '', scale: 0, sections: s,
            email: { to: '', cc: '', subject: '{TITLE} · {PERIOD}', intro: 'Dear all,\n\nPlease find the {PERIOD} board pack below. The full interactive pack is attached — open it in any browser and use the menu on the left.\n\nKind regards,' } };
    };

    // ── logo: transparent / dark logos on the dark menu and cover ──
    P.PLATES = { auto: 'Automatic', none: 'None (transparent)', white: 'White plate', light: 'Light grey plate', dark: 'Dark plate', brand: 'Theme colour plate' };
    P.TINTS = { none: 'As it is', knockout: 'Remove white background', white: 'All white', dark: 'All dark' };
    // ── how the pack is laid out and what the menu looks like ──
    P.LAYOUTS = { side: { label: 'Left menu', what: 'Menu on the left, one page at a time' }, right: { label: 'Right menu', what: 'Menu on the right, one page at a time' },
        rail: { label: 'Icon rail', what: 'Slim bar of icons — more room for wide statements' }, top: { label: 'Top tabs', what: 'Pages as tabs across the top' },
        cards: { label: 'Contents cards', what: 'Opens on a contents page of cards — click one to read it' }, doc: { label: 'One long page', what: 'Every page under the other, a contents bar that follows you' } };
    P.MENUS = { theme: { label: 'Theme colour' }, grad: { label: 'Gradient' }, dark: { label: 'Charcoal' }, white: { label: 'White' }, tint: { label: 'Light tint' } };
    P.PAPERS = { grey: 'Soft grey', white: 'White' };
    P.FONTS = { sans: 'Modern (Segoe UI)', serif: 'Classic (Georgia)' };
    /** The layout / menu / paper / font of a pack, with defaults */
    P.look = function (pack) {
        var k = function (v, map, d) { return map[v] ? v : d; };
        return { layout: k(pack.layout, P.LAYOUTS, 'side'), menu: k(pack.menu, P.MENUS, 'theme'), paper: k(pack.paper, P.PAPERS, 'grey'), font: k(pack.font, P.FONTS, 'sans') };
    };
    // ── the cover banner of the Summary page ──
    P.HEROES = { grad: 'Gradient', solid: 'Solid colour', dark: 'Charcoal', soft: 'Soft tint', white: 'White card', minimal: 'Minimal', image: 'Picture' };
    P.DECOS = { none: 'None', dots: 'Dots', rings: 'Rings', lines: 'Lines', grid: 'Grid', glow: 'Glow' };
    P.HSIZES = { compact: 'Compact', normal: 'Normal', tall: 'Tall' };
    /** {style, deco, size, align, c1, c2, img} of a pack's cover banner */
    P.hero = function (pack) {
        var h = pack.hero || {}, k = function (v, map, d) { return map[v] ? v : d; }, col = function (v) { return /^#[0-9a-f]{6}$/i.test(v || '') ? v : ''; };
        var style = k(h.style, P.HEROES, 'grad'); if (style === 'image' && !/^data:image\//.test(h.img || '')) style = 'grad';
        return { style: style, deco: k(h.deco, P.DECOS, 'none'), size: k(h.size, P.HSIZES, 'normal'), align: h.align === 'center' ? 'center' : 'left', c1: col(h.c1), c2: col(h.c2), img: style === 'image' ? h.img : '' };
    };
    P.lightHero = function (st) { return st === 'soft' || st === 'white' || st === 'minimal'; };
    P.lightMenu = function (m) { return m === 'white' || m === 'tint'; };
    var loadImg = function (src) { return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { no(new Error('The logo could not be read')); }; im.src = src; }); };
    /** What the logo is: {alpha: has transparent pixels, lum: average brightness 0..1 of its visible pixels, w, h} */
    P.logoInfo = function (src) {
        return loadImg(src).then(function (im) {
            var w = Math.min(200, im.naturalWidth || 200), h = Math.max(1, Math.round(w * (im.naturalHeight || 1) / (im.naturalWidth || 1)));
            var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, w, h);
            var d = cx.getImageData(0, 0, w, h).data, clear = 0, n = 0, lum = 0;
            for (var i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) clear++; if (d[i + 3] > 30) { n++; lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; } }
            return { alpha: clear > d.length / 4 * 0.02, lum: n ? lum / n : 1, w: im.naturalWidth, h: im.naturalHeight };
        });
    };
    /** The plate the logo sits on: auto = a white plate for a dark or opaque logo, none for a light transparent one (it reads on the dark menu) */
    P.logoPlate = function (pack, info) {
        var o = pack.logoOpts || {}, bg = o.bg || 'auto', tint = o.tint || 'none', th = P.THEMES[pack.theme] || P.THEMES.navy;
        if (bg === 'auto') bg = !info || (!info.alpha && tint !== 'knockout') ? 'white' : tint === 'white' ? 'none' : tint === 'dark' ? 'white' : info.lum < 0.6 ? 'white' : 'none';
        return { key: bg, color: { none: '', white: '#ffffff', light: '#f1f5f9', dark: '#0f172a', brand: th.b }[bg] || '' };
    };
    /** The logo ready to show: recoloured on a canvas when asked (works in e-mail too, where CSS filters do not) → {src, plate, size} */
    P.logoReady = function (pack) {
        if (!pack.logo) return Promise.resolve(null);
        var o = pack.logoOpts || {}, size = Math.max(24, Math.min(110, +o.size || 48));
        return P.logoInfo(pack.logo).then(function (info) {
            var tint = o.tint || 'none';
            return loadImg(pack.logo).then(function (im) {
                // always a PNG copy (≤ 480 px wide) for e-mail: Outlook shows neither SVG nor data: pictures, so it goes as an inline attachment
                var k = Math.min(1, 480 / (im.naturalWidth || 480)), cv = document.createElement('canvas');
                cv.width = Math.max(1, Math.round((im.naturalWidth || 200) * k)); cv.height = Math.max(1, Math.round((im.naturalHeight || 60) * k));
                var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, cv.width, cv.height);
                if (tint === 'white' || tint === 'dark') { cx.globalCompositeOperation = 'source-in'; cx.fillStyle = tint === 'white' ? '#ffffff' : '#0f172a'; cx.fillRect(0, 0, cv.width, cv.height); }
                if (tint === 'knockout') {   // near-white pixels become see-through (soft edge), then the plate is chosen on what is left
                    var id = cx.getImageData(0, 0, cv.width, cv.height), d = id.data, n = 0, lum = 0;
                    for (var i = 0; i < d.length; i += 4) {
                        var m = Math.min(d[i], d[i + 1], d[i + 2]);
                        if (m > 200) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (245 - m) / 45));
                        if (d[i + 3] > 30) { n++; lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; }
                    }
                    cx.putImageData(id, 0, 0);
                    info = { alpha: true, lum: n ? lum / n : 0, w: info.w, h: info.h };
                }
                var png = cv.toDataURL('image/png'), plate = P.logoPlate(pack, info);
                return { src: tint === 'none' ? pack.logo : png, png: png, plate: plate, size: size, info: info };
            });
        }).catch(function () { return { src: pack.logo, plate: { key: 'white', color: '#ffffff' }, size: size }; });
    };
    /** Inline style of the logo picture for a place (menu / cover / mail) */
    P.logoCss = function (lg, where) {
        var h = where === 'cover' ? Math.round(lg.size * 1.4) : where === 'mail' ? Math.min(56, lg.size) : lg.size;
        return 'max-height:' + h + 'px;max-width:' + (h * 4) + 'px;object-fit:contain;display:block;' + (lg.plate.color ? 'background:' + lg.plate.color + ';padding:' + Math.round(h / 8 + 2) + 'px ' + Math.round(h / 5 + 3) + 'px;border-radius:8px;' : '');
    };

    var winOf = function (range, per) {
        var list = FL.dims.periods, i = list.map(function (p) { return p.period_seq; }).indexOf(per), p = list[i] || {};
        if (range === 'MTD') return [per];
        if (range === 'QTD') return list.filter(function (x) { return x.fiscal_year === p.fiscal_year && x.quarter === p.quarter && x.period_seq <= per; }).map(function (x) { return x.period_seq; });
        if (range === 'LTM') return list.slice(Math.max(0, i - 11), i + 1).map(function (x) { return x.period_seq; });
        return list.filter(function (x) { return x.fiscal_year === p.fiscal_year && x.period_seq <= per; }).map(function (x) { return x.period_seq; });
    };
    var TYPE = { A: 'Assets', L: 'Liabilities', O: 'Equity', R: 'Revenue', E: 'Expenses' }, ORDER = { A: 1, L: 2, O: 3, R: 4, E: 5 };
    var csvCell = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csvOf = function (head, rows) { return [head.map(csvCell).join(',')].concat(rows.map(function (r) { return r.map(csvCell).join(','); })).join('\r\n'); };
    var md = function (t) {
        var h = esc(t || '');
        h = h.replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h2 class="mh">$1</h2>')
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<i>$2</i>');
        h = h.replace(/(?:^|\n)((?:- .*(?:\n|$))+)/g, function (m, block) { return '\n<ul>' + block.trim().split('\n').map(function (l) { return '<li>' + l.replace(/^- /, '') + '</li>'; }).join('') + '</ul>'; });
        return h.split(/\n{2,}/).map(function (p) { return /^\s*<(h\d|ul)/.test(p) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
    };

    /** The statement of one template for the pack (+ account detail rows when asked) */
    function stmtSection(sec, data, per) {
        var t = FL.tpl(sec.opts.tpl);
        if (!t) return { html: '<p class="muted">Template ' + esc(sec.opts.tpl) + ' no longer exists — choose another in the designer.</p>' };
        var kind = /^(PL|BS|CF)$/.test(t.type) ? t.type : 'PL';
        var opts = { period: per, scale: FL.filter.scale };
        if (sec.opts.cols && sec.opts.cols !== '_tpl' && kind !== 'CF') opts.columns = FINE.colset(kind, sec.opts.cols);
        var st = FINE.compute(t, data, opts);
        var vcols = st.columns.map(function (c, i) { return i; });
        var rows = st.rows.filter(function (r) {
            if (r.hidden) return false;
            if (sec.opts.hideZero && r.type === 'accounts' && r.values.every(function (v, i) { return st.columns[i].kind !== 'value' || !v || Math.abs(v) < 0.5; })) return false;
            return true;
        });
        var nl = sec.opts.notes !== false && FL.notes && FL.notes.all ? FL.notes.number(FL.notes.forView(t.id, per), st) : [], refs = {};
        nl.forEach(function (n) { if (n.row) (refs[n.row] = refs[n.row] || []).push(n.no); });
        var h = '<table class="st"><thead><tr><th>in ' + esc(FL.scaleLabel()) + '</th>' + st.columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
        var csv = [];
        rows.forEach(function (r, k) {
            var sub = [];
            if (sec.opts.detail && r.type === 'accounts' && r.accounts && r.accounts.length) {
                var per1 = {};
                st.columns.forEach(function (c) { if (c.kind === 'value') FINE.explain(t, data, opts, r.id, c.id).forEach(function (a) { (per1[a.code] = per1[a.code] || { code: a.code, name: a.name, raw: {} }).raw[c.id] = a.amount; }); });
                sub = Object.keys(per1).sort().map(function (code) {
                    var a = per1[code];
                    a.values = st.columns.map(function (c) {
                        if (c.kind === 'value') return a.raw[c.id] == null ? 0 : a.raw[c.id] / st.scale;
                        if (c.kind === 'var') { var va = a.raw[c.a] || 0, vb = a.raw[c.b] || 0, d = (va - vb) * (r.favourable === 'down' ? -1 : 1); return c.mode === 'pct' ? (vb ? d / Math.abs(vb) * 100 : null) : d / st.scale; }
                        return null;
                    });
                    return a;
                }).filter(function (a) { return a.values.some(function (v) { return v && Math.abs(v) >= 0.5; }); });
            }
            var gid = sec.id + '_' + k, lv = (r.level || 0) * 16;
            h += '<tr class="' + FL.rowClass(r) + (sub.length ? ' grp' : '') + '"' + (sub.length ? ' data-g="' + gid + '"' : '') + '><td><span style="padding-left:' + lv + 'px">' + (sub.length ? '<i class="cr"></i>' : '') + esc(r.label || '') + (refs[r.id] ? ' <sup class="nref">' + refs[r.id].join(',') + '</sup>' : '') + '</span></td>' +
                st.columns.map(function (c, i) { var v = r.values[i], cls = c.kind === 'var' && v != null && Math.abs(v) > 1e-9 ? (v > 0 ? 'fav' : 'unf') : ''; return '<td class="' + cls + '">' + FL.cellText(r, c, v) + '</td>'; }).join('') + '</tr>';
            sub.forEach(function (a) {
                h += '<tr class="acc" data-p="' + gid + '"><td><span style="padding-left:' + (lv + 22) + 'px">' + esc(a.name && a.name !== a.code ? a.code + ' ' + a.name : a.code) + '</span></td>' + st.columns.map(function (c, i) { return '<td>' + FL.cellText(r, c, a.values[i]) + '</td>'; }).join('') + '</tr>';
                csv.push([r.label, a.code, a.name].concat(vcols.map(function (i) { return a.values[i] == null ? '' : +a.values[i].toFixed(2); })));
            });
            if (r.type !== 'blank') csv.push([r.label, '', ''].concat(vcols.map(function (i) { var v = r.values[i]; return v == null ? '' : +(+v).toFixed(2); })));
        });
        h += '</tbody></table>';
        if (nl.length) {
            h += nl.length ? '<div class="pnotes"><h4>Notes</h4>' + nl.map(function (n) { var k = FL.notes.KINDS[n.kind] || FL.notes.KINDS.note; return '<div class="pnote" style="border-left-color:' + k[1] + '"><span class="pno">' + n.no + '</span><div><div class="pnh"><b style="color:' + k[1] + '">' + k[0] + '</b>' + (n.title ? ' · <b>' + esc(n.title) + '</b>' : '') + (n.rowLabel ? ' · <i>' + esc(n.rowLabel) + '</i>' : '') + '</div>' + FL.notes.md(n.body) + '</div></div>'; }).join('') + '</div>' : '';
        }
        return { html: h, csv: csvOf(['Line', 'Account', 'Name'].concat(st.columns.map(function (c) { return c.label; })), csv), sub: t.name + ' · ' + FL.periodName(per), st: st, tpl: t, collapsible: !!sec.opts.detail };
    }

    /** Trial balance straight from fin_balances, grouped by type (opens into accounts) or every account */
    function tbSection(sec, per) {
        var seqs = winOf(sec.opts.range || 'YTD', per); if (!seqs.length) seqs = [per];
        var first = Math.min.apply(null, seqs), last = Math.max.apply(null, seqs);
        var w = FL.where('b').concat(["b.scenario = 'ACTUAL'", 'b.period_seq IN (' + seqs.join(',') + ')']);
        var sql = 'SELECT b.account, SUM(CASE WHEN b.period_seq = ' + first + ' THEN b.begin_bal ELSE 0 END) AS opening, SUM(b.period_dr) AS dr, SUM(b.period_cr) AS cr, ' +
            'SUM(CASE WHEN b.period_seq = ' + last + ' THEN b.end_bal ELSE 0 END) AS closing FROM fin_balances b WHERE ' + w.join(' AND ') + ' GROUP BY ALL';
        return FL.rows(sql, 500000).then(function (rows) {
            var acc = {}; FL.dims.accounts.forEach(function (a) { acc[a.code] = a; });
            rows.forEach(function (r) { var a = acc[r.account] || {}; r.name = a.name || ''; r.type = a.account_type || '?'; r.cls = a.class || ''; });
            if (!sec.opts.zero) rows = rows.filter(function (r) { return [r.opening, r.dr, r.cr, r.closing].some(function (v) { return Math.abs(v) >= 0.005; }); });
            rows.sort(function (a, b) { return (ORDER[a.type] || 9) - (ORDER[b.type] || 9) || String(a.account).localeCompare(String(b.account), undefined, { numeric: true }); });
            var sc = FL.filter.scale || 1, dec = sc >= 1000 ? 0 : 2;
            var f = function (v) { return Math.abs(v) < 0.005 ? '–' : FINE.fmt(v / sc, 'num', { decimals: dec }); };
            var dc = function (v, side) { return side === 'dr' ? (v > 0.005 ? f(v) : '') : (v < -0.005 ? f(-v) : ''); };
            var cells = function (r) { return '<td>' + f(r.opening) + '</td><td>' + f(r.dr) + '</td><td>' + f(r.cr) + '</td><td>' + f(r.dr - r.cr) + '</td><td>' + dc(r.closing, 'dr') + '</td><td>' + dc(r.closing, 'cr') + '</td>'; };
            var tot = { opening: 0, dr: 0, cr: 0, closing: 0, cdr: 0, ccr: 0 };
            rows.forEach(function (r) { tot.opening += r.opening; tot.dr += r.dr; tot.cr += r.cr; tot.closing += r.closing; if (r.closing >= 0) tot.cdr += r.closing; else tot.ccr -= r.closing; });
            var byType = sec.opts.group !== 'account', h = '<table class="st tb"><thead><tr><th>Account</th><th>Opening</th><th>Debits</th><th>Credits</th><th>Net movement</th><th>Closing debit</th><th>Closing credit</th></tr></thead><tbody>';
            if (byType) {
                var g = {}; rows.forEach(function (r) { (g[r.type] = g[r.type] || []).push(r); });
                Object.keys(g).sort(function (a, b) { return (ORDER[a] || 9) - (ORDER[b] || 9); }).forEach(function (ty) {
                    var s = { opening: 0, dr: 0, cr: 0, closing: 0 }; g[ty].forEach(function (r) { s.opening += r.opening; s.dr += r.dr; s.cr += r.cr; s.closing += r.closing; });
                    var gid = sec.id + '_' + ty;
                    h += '<tr class="grp b" data-g="' + gid + '"><td><i class="cr"></i>' + esc(TYPE[ty] || 'Other') + ' <span class="n">(' + g[ty].length + ')</span></td>' + cells(s) + '</tr>';
                    g[ty].forEach(function (r) { h += '<tr class="acc" data-p="' + gid + '"><td><span style="padding-left:22px">' + esc(r.name && r.name !== r.account ? r.account + ' ' + r.name : r.account) + '</span></td>' + cells(r) + '</tr>'; });
                });
            } else rows.forEach(function (r) { h += '<tr><td>' + esc(r.name && r.name !== r.account ? r.account + ' ' + r.name : r.account) + '</td>' + cells(r) + '</tr>'; });
            h += '<tr class="b tb db"><td>Total</td><td>' + f(tot.opening) + '</td><td>' + f(tot.dr) + '</td><td>' + f(tot.cr) + '</td><td>' + f(tot.dr - tot.cr) + '</td><td>' + f(tot.cdr) + '</td><td>' + f(tot.ccr) + '</td></tr></tbody></table>';
            var okM = Math.abs(tot.dr - tot.cr) < 1, okB = Math.abs(tot.closing) < 1;
            var badge = '<div class="chips"><span class="chip ' + (okM ? 'ok' : 'bad') + '">' + (okM ? '✓ debits = credits' : '✗ debits ≠ credits ' + f(tot.dr - tot.cr)) + '</span><span class="chip ' + (okB ? 'ok' : 'bad') + '">' + (okB ? '✓ closing balances net to nil' : '✗ closing balances net to ' + f(tot.closing)) + '</span><span class="chip">' + rows.length + ' accounts</span></div>';
            return { html: badge + h, csv: csvOf(['Account', 'Name', 'Type', 'Class', 'Opening', 'Debits', 'Credits', 'Net', 'Closing'], rows.map(function (r) { return [r.account, r.name, TYPE[r.type] || r.type, r.cls, r.opening.toFixed(2), r.dr.toFixed(2), r.cr.toFixed(2), (r.dr - r.cr).toFixed(2), r.closing.toFixed(2)]; })),
                sub: ({ MTD: 'Month', QTD: 'Quarter to date', YTD: 'Year to date', LTM: 'Last 12 months' }[sec.opts.range || 'YTD']) + ' · ' + FL.periodName(first) + (first !== last ? ' – ' + FL.periodName(last) : ''), collapsible: byType };
        });
    }

    /** Builds the pack. → Promise<{html, file, model}> */
    /** Builds the pack. With pack.ledgers (2+ or 1 ledger codes) every section is built for each ledger and the document is broken out
        by ledger (a group per ledger in the menu); without, it follows the header's ledger. → Promise<{html, file, model, sections}> */
    P.build = function (pack, onStep) {
        var leds = FL.dims.ledgers || [], codes = (pack.ledgers || []).filter(function (c) { return leds.some(function (l) { return String(l.code) === String(c); }); });
        if (!codes.length) return buildOne(pack, onStep);
        var step = onStep || function () { }, keep = { ledger: FL.filter.ledger, company: FL.filter.company, cc: FL.filter.cc }, parts = [];
        var restore = function () { Object.assign(FL.filter, keep); FL.cache = {}; };
        var nameOf = function (c) { var l = leds.filter(function (x) { return String(x.code) === String(c); })[0] || {}; return (l.name || c) + (l.currency ? ' · ' + l.currency : ''); };
        return codes.reduce(function (p, code, i) {
            return p.then(function () {
                Object.assign(FL.filter, { ledger: code, company: '', cc: '' }); FL.cache = {};
                var pk = Object.assign({}, pack, { sections: (pack.sections || []).map(function (s) { return Object.assign({}, s, { id: s.id + '_l' + i }); }) });
                return buildOne(pk, function (m) { step(nameOf(code) + ': ' + m); }, true).then(function (r) { parts.push({ code: code, name: nameOf(code), r: r }); });
            });
        }, Promise.resolve()).then(function () {
            restore();
            var first = parts[0].r, multi = parts.length > 1, out = [];
            parts.forEach(function (x) { x.r.out.forEach(function (o) { out.push(Object.assign({}, o, { group: multi ? x.name : '', sub: o.sub || first.pname })); }); });
            var pre = function (x, t) { return multi ? x.code + ' · ' + t : t; };
            var model = Object.assign({}, first.model, {
                ledger: codes.join(','), ledgerName: parts.map(function (x) { return x.name; }).join(' + '), filter: multi ? parts.length + ' ledgers: ' + parts.map(function (x) { return x.name; }).join(', ') : first.model.filter,
                tiles: [].concat.apply([], parts.map(function (x) { return x.r.model.tiles.map(function (t) { return Object.assign({}, t, { label: pre(x, t.label) }); }); })),
                keyLines: [].concat.apply([], parts.map(function (x) { return x.r.model.keyLines.map(function (t) { return Object.assign({}, t, { label: pre(x, t.label) }); }); })),
                highlights: [].concat.apply([], parts.map(function (x) { return x.r.model.highlights.map(function (t) { return pre(x, t); }); })),
                attention: [].concat.apply([], parts.map(function (x) { return x.r.model.attention.map(function (t) { return pre(x, t); }); })),
                ledgers: parts.map(function (x) { return { code: x.code, name: x.name, tiles: x.r.model.tiles, keyLines: x.r.model.keyLines }; })
            });
            var keepScale = FL.filter.scale; if (pack.scale) FL.filter.scale = +pack.scale;
            var html = page(pack, first.th, first.pname, out, first.lg); FL.filter.scale = keepScale;
            var file = ((pack.title || pack.name || 'Board pack') + ' ' + first.pname + (multi ? ' ' + parts.length + ' ledgers' : '')).replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim() + '.html';
            return { html: html, file: file, model: model, sections: out.map(function (x) { return (x.group ? x.group + ' › ' : '') + x.sec.title; }), _pg: { pack: pack, th: first.th, pname: first.pname, out: out, lg: first.lg, scale: pack.scale } };
        }).catch(function (e) { restore(); throw e; });
    };
    function buildOne(pack, onStep, raw) {
        var per = FL.filter.period, pname = FL.periodName(per), cfg = FL.config, tm = FL.tplMap(), keepScale = FL.filter.scale;
        if (pack.scale) FL.filter.scale = +pack.scale;
        var th = P.THEMES[pack.theme] || P.THEMES.navy, step = onStep || function () { };
        var done = function (x) { FL.filter.scale = keepScale; return x; };
        var lg = null;
        return (FL.notes ? FL.notes.load().catch(function () { return null; }) : Promise.resolve()).then(function () { return P.logoReady(pack); }).then(function (x) { lg = x; return FL.data(); }).then(function (data) {
            var kv = {}, kPy = {}, kPm = {}, pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), i = pi.bySeq[per];
            try { kv = FINE.kpis(cfg.kpis, tm, data, per); if (i > 0) kPm = FINE.kpis(cfg.kpis, tm, data, pi.list[i - 1].period_seq); var pyS = pi.bySeq[per - 100]; if (pyS != null) kPy = FINE.kpis(cfg.kpis, tm, data, per - 100); } catch (e) { console.warn('[pack] KPIs', e); }
            var kdef = function (id) { return (cfg.kpis || []).filter(function (k) { return k.id === id; })[0]; };
            var head = (cfg.headline || []).map(kdef).filter(Boolean).slice(0, 8);
            var tiles = head.map(function (k) {
                var v = (kv[k.id] || {}).value, py = (kPy[k.id] || {}).value, d = v != null && py != null ? v - py : null, good = d == null ? null : (k.good === 'down' ? d <= 0 : d >= 0);
                return { label: k.label, value: FL.kfmt(v, k.fmt), delta: d == null ? '' : FL.kdelta(d, k.fmt) + ' vs last year', good: good };
            });
            // P&L narrative + key lines (month / YTD / budget / last year)
            var plT = tm.PL || (FL.templates || []).filter(function (t) { return t.type === 'PL'; })[0], keyLines = [], hl = [];
            if (plT) {
                var pl = FINE.compute(plT, data, { period: per, scale: 1, columns: [{ id: 'm_act', scenario: 'ACTUAL', range: 'MTD' }, { id: 'm_bud', scenario: 'BUDGET', range: 'MTD' }, { id: 'y_act', scenario: 'ACTUAL', range: 'YTD' }, { id: 'y_bud', scenario: 'BUDGET', range: 'YTD' }, { id: 'y_py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }] });
                try {
                    hl = hl.concat(FINE.narrative(pl, 'y_act', 'y_bud', { keyRows: ['REV', 'EBITDA', 'NP'], top: 3, fmt: FL.compact }).map(function (x) { return 'Year to date vs budget — ' + x.text; }));
                    hl = hl.concat(FINE.narrative(pl, 'y_act', 'y_py', { keyRows: ['REV', 'NP'], top: 0, fmt: FL.compact }).map(function (x) { return 'Year to date vs last year — ' + x.text; }));
                } catch (e) { console.warn('[pack] narrative', e); }
                var want = ['REV', 'COGS', 'GP', 'OPEX', 'EBITDA', 'EBIT', 'PBT', 'NP'];
                var pick = pl.rows.filter(function (r) { return want.indexOf(r.id) >= 0 && r.format !== 'pct'; });
                if (pick.length < 3) pick = pl.rows.filter(function (r) { return (r.type === 'formula' || r.type === 'group') && r.format !== 'pct'; }).slice(0, 7);
                keyLines = pick.map(function (r) { return { label: r.label, bold: /GP|EBITDA|NP|PBT/.test(r.id) || (r.style || {}).bold, m: r.values[0], mb: r.values[1], y: r.values[2], yb: r.values[3], py: r.values[4] }; });
            }
            var mon = []; try { mon = FINE.monitor(cfg.monitors || [], kv); } catch (e) { /* no monitors */ }
            var attention = mon.filter(function (m) { return m.status === 'breach'; }).map(function (b) { var d = kdef(b.rule.kpi) || {}; return b.rule.label + ' — ' + (d.label || '') + ' at ' + FL.kfmt(b.value, d.fmt); });
            var trendPng = null;
            if (plT && FL.chartImg) {
                try {
                    var m = FL.monthly(data, plT, ['REV', 'NP'], { scenario: 'ACTUAL', range: 'MTD' }, 12);
                    trendPng = FL.chartImg({ data: { labels: m.labels, datasets: [{ type: 'bar', label: 'Revenue', data: m.series.REV, backgroundColor: th.b, order: 2 }, { type: 'line', label: 'Net profit', data: m.series.NP, borderColor: th.c, backgroundColor: th.c, yAxisID: 'y2', order: 0, pointRadius: 2 }] },
                        options: { scales: { y: FL.moneyAxis(), y2: Object.assign(FL.moneyAxis(), { position: 'right', grid: { display: false } }) } } }, 1200, 420);
                } catch (e) { console.warn('[pack] trend chart', e); }
            }
            var led = (FL.dims.ledgers || []).filter(function (l) { return String(l.code) === String(FL.filter.ledger || ''); })[0];
            var model = { ledger: FL.filter.ledger || '', ledgerName: led ? (led.name || led.code) + (led.currency ? ' · ' + led.currency : '') : '', company: FL.filter.company || '', scale: FL.filter.scale, logo: lg, period: pname, per: per, tiles: tiles, keyLines: keyLines, highlights: hl, attention: attention, trendPng: trendPng, scaleLabel: FL.scaleLabel(), filter: FL.filterText() };

            var out = [], chain = Promise.resolve();
            (pack.sections || []).filter(function (s) { return s.on !== false; }).forEach(function (sec) {
                chain = chain.then(function () {
                    step('Building ' + sec.title + '…');
                    if (sec.type === 'summary') {
                        var o = sec.opts || {};
                        var hr = P.hero(pack), hlg = lg;
                        if (lg && P.lightHero(hr.style) && lg.plate.key === 'none' && (!lg.info || lg.info.lum > 0.6)) hlg = Object.assign({}, lg, { plate: { key: 'brand', color: hr.c1 || th.a } });
                        var h = '<div class="hero"' + (hr.c1 || hr.c2 ? ' style="' + (hr.c1 ? '--h1:' + hr.c1 + ';' : '') + (hr.c2 ? '--h2:' + hr.c2 + ';--h3:' + hr.c2 + ';' : '') + '"' : '') + '><div><div class="eyebrow">' + esc(pack.company || '') + '</div><h1>' + esc(pack.title || pack.name) + '</h1><div class="per">' + esc(pname) + '</div>' +
                            '<div class="meta">' + esc(model.filter) + ' · amounts in ' + esc(model.scaleLabel) + (pack.by ? ' · prepared by ' + esc(pack.by) : '') + ' · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '</div>' + '<!--DIST-->' + '</div>' +
                            (lg ? '<img class="logo" src="' + esc(lg.src) + '" alt="" style="' + P.logoCss(hlg, 'cover') + '">' : '') + '</div>';
                        if (o.kpis !== false && tiles.length) h += '<div class="tiles">' + tiles.map(function (t) { return '<div class="tile"><div class="tl">' + esc(t.label) + '</div><div class="tv">' + t.value + '</div><div class="td ' + (t.good == null ? '' : t.good ? 'pos' : 'neg') + '">' + esc(t.delta) + '</div></div>'; }).join('') + '</div>';
                        if (o.note) h += '<h3>Commentary</h3><div class="note">' + md(o.note) + '</div>';
                        if (o.highlights !== false && hl.length) h += '<h3>Highlights</h3><ul class="hl">' + hl.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
                        if (o.attention !== false) h += '<h3>Attention points</h3>' + (attention.length ? '<ul class="hl warn">' + attention.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">All monitors are within their limits.</p>');
                        if (trendPng) h += '<h3>Revenue and net profit, last 12 months</h3><img class="wide" src="' + trendPng + '" alt="Revenue and net profit">';
                        out.push({ sec: sec, html: h });
                        return;
                    }
                    if (sec.type === 'tb') return tbSection(sec, per).then(function (r) { out.push({ sec: sec, html: r.html, csv: r.csv, sub: r.sub, collapsible: r.collapsible, search: true }); });
                    if (sec.type === 'statement') { var r = stmtSection(sec, data, per); out.push({ sec: sec, html: r.html, csv: r.csv, sub: r.sub, collapsible: r.collapsible, search: true }); return; }
                    if (sec.type === 'kpis') {
                        var groups = {}; (cfg.kpis || []).forEach(function (k) { (groups[k.group || 'Other'] = groups[k.group || 'Other'] || []).push(k); });
                        var rows = [];
                        var h2 = '<table class="st kp"><thead><tr><th>KPI</th><th>' + esc(pname) + '</th><th>Previous month</th><th>A year ago</th><th class="l">What it means</th></tr></thead><tbody>' +
                            Object.keys(groups).map(function (g) {
                                return '<tr class="header"><td colspan="5">' + esc(g) + '</td></tr>' + groups[g].map(function (k) {
                                    rows.push([g, k.label, (kv[k.id] || {}).value, (kPm[k.id] || {}).value, (kPy[k.id] || {}).value]);
                                    return '<tr><td>' + esc(k.label) + '</td><td><b>' + FL.kfmt((kv[k.id] || {}).value, k.fmt) + '</b></td><td>' + FL.kfmt((kPm[k.id] || {}).value, k.fmt) + '</td><td>' + FL.kfmt((kPy[k.id] || {}).value, k.fmt) + '</td><td class="l muted">' + esc(k.desc || (FL.KPI_GUIDE && FL.KPI_GUIDE[k.id]) || '') + '</td></tr>';
                                }).join('');
                            }).join('') + '</tbody></table>';
                        out.push({ sec: sec, html: h2, csv: csvOf(['Group', 'KPI', pname, 'Previous month', 'A year ago'], rows), search: true });
                        return;
                    }
                    if (sec.type === 'charts') {
                        if (!plT || !FL.chartImg) { out.push({ sec: sec, html: '<p class="muted">No income statement template to chart.</p>' }); return; }
                        var o2 = sec.opts || {}, parts = [];
                        var mm = FL.monthly(data, plT, ['REV', 'NP', 'GM', 'EBITDAM', 'NPM'], { scenario: 'ACTUAL', range: 'MTD' }, 24), bb = FL.monthly(data, plT, ['REV'], { scenario: 'BUDGET', range: 'MTD' }, 24);
                        if (o2.trend !== false) parts.push('<figure><img class="wide" src="' + FL.chartImg({ data: { labels: mm.labels, datasets: [{ type: 'bar', label: 'Revenue', data: mm.series.REV, backgroundColor: th.b, order: 2 }, { type: 'line', label: 'Budget revenue', data: bb.series.REV, borderColor: '#94a3b8', borderDash: [5, 4], pointRadius: 0, order: 1 }, { type: 'line', label: 'Net profit', data: mm.series.NP, borderColor: th.c, yAxisID: 'y2', order: 0 }] }, options: { scales: { y: FL.moneyAxis(), y2: Object.assign(FL.moneyAxis(), { position: 'right', grid: { display: false } }) } } }, 1200, 400) + '"><figcaption>Revenue against budget and net profit, last 24 months</figcaption></figure>');
                        var two = [];
                        if (o2.margins !== false) two.push('<figure><img src="' + FL.chartImg({ type: 'line', data: { labels: mm.labels, datasets: [{ label: 'Gross margin %', data: mm.series.GM, borderColor: th.b, pointRadius: 0 }, { label: 'EBITDA margin %', data: mm.series.EBITDAM, borderColor: th.c, pointRadius: 0 }, { label: 'Net margin %', data: mm.series.NPM, borderColor: '#64748b', pointRadius: 0 }] } }, 600, 340) + '"><figcaption>Margins, monthly</figcaption></figure>');
                        if (o2.bridge !== false) {
                            try {
                                var pl2 = FINE.compute(plT, data, { period: per, scale: 1, columns: [{ id: 'y_act', scenario: 'ACTUAL', range: 'YTD' }, { id: 'y_py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }] });
                                var steps = FINE.bridge(pl2, 'y_py', 'y_act', 'NP', 'NP', [{ id: 'REV', label: 'Revenue' }, { id: 'COGS', label: 'Cost of sales', sign: -1 }, { id: 'OPEX', label: 'Opex', sign: -1 }, { id: 'OI', label: 'Other inc.' }, { id: 'DA', label: 'D&A', sign: -1 }, { id: 'FIN', label: 'Finance', sign: -1 }, { id: 'TAX', label: 'Tax', sign: -1 }]);
                                var run = 0, bars = steps.map(function (s) { if (s.kind !== 'step') { run = s.value; return [0, s.value]; } var r2 = [run, run + s.value]; run += s.value; return r2; });
                                two.push('<figure><img src="' + FL.chartImg({ type: 'bar', data: { labels: steps.map(function (s) { return s.kind === 'start' ? 'YTD last year' : s.kind === 'end' ? 'YTD this year' : s.label; }), datasets: [{ data: bars, backgroundColor: steps.map(function (s) { return s.kind !== 'step' ? th.a : s.value >= 0 ? '#16a34a' : '#dc2626'; }) }] }, options: { plugins: { legend: { display: false } }, scales: { y: FL.moneyAxis() } } }, 600, 340) + '"><figcaption>Net profit bridge, year to date: last year → this year</figcaption></figure>');
                            } catch (e) { console.warn('[pack] bridge', e); }
                        }
                        if (two.length) parts.push('<div class="two">' + two.join('') + '</div>');
                        out.push({ sec: sec, html: parts.join('') || '<p class="muted">No charts chosen.</p>' });
                        return;
                    }
                    if (sec.type === 'monitor') {
                        out.push({ sec: sec, html: mon.length ? '<table class="st kp"><thead><tr><th>Rule</th><th class="l">Severity</th><th>Value</th><th class="l">Status</th></tr></thead><tbody>' + mon.map(function (m) { var d = kdef(m.rule.kpi) || {}; return '<tr><td>' + esc(m.rule.label) + '</td><td class="l">' + esc(m.rule.severity || '') + '</td><td>' + FL.kfmt(m.value, d.fmt) + '</td><td class="l"><span class="chip ' + (m.status === 'breach' ? 'bad' : m.status === 'ok' ? 'ok' : '') + '">' + (m.status === 'breach' ? 'ALERT' : m.status === 'ok' ? 'OK' : 'n/a') + '</span></td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted">No monitors set up.</p>', search: true });
                        return;
                    }
                    if (sec.type === 'text') { out.push({ sec: sec, html: '<div class="prose">' + md((sec.opts || {}).text || '') + '</div>' }); return; }
                });
            });
            return chain.then(function () {
                var file = ((pack.title || pack.name || 'Board pack') + ' ' + pname).replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim() + '.html';
                if (raw) return done({ out: out, model: model, lg: lg, pname: pname, th: th });
                return done({ html: page(pack, th, pname, out, lg), file: file, model: model, sections: out.map(function (x) { return x.sec.title; }), _pg: { pack: pack, th: th, pname: pname, out: out, lg: lg, scale: pack.scale } });
            });
        }).catch(function (e) { done(); throw e; });
    }

    /** The self-contained interactive page */
    function page(pack, th, pname, out, lg, dist) {
        var look = P.look(pack), hr = P.hero(pack), mlg = lg;
        // a light transparent logo disappears on a white / tinted menu: give it the theme colour behind it there
        if (lg && P.lightMenu(look.menu) && lg.plate.key === 'none' && (!lg.info || lg.info.lum > 0.6)) mlg = Object.assign({}, lg, { plate: { key: 'brand', color: th.a } });
        var css = ':root{--a:' + th.a + ';--b:' + th.b + ';--c:' + th.c + ';--bg:#f4f6fb;--card:#fff;--ink:#0f172a;--mut:#64748b;--line:#e5e9f2;--row:#f8fafc}' +
            'html[data-theme=dark]{--bg:#0b1020;--card:#121a2e;--ink:#e5e9f5;--mut:#93a0bb;--line:#24304d;--row:#17213a}' +
            '*{box-sizing:border-box}body{margin:0;font:14px/1.5 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;background:var(--bg);color:var(--ink)}' +
            '.app{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}' +
            'nav{--nbg:var(--a);--nfg:#fff;--nmu:rgba(255,255,255,.82);--nhv:rgba(255,255,255,.08);--nonb:#fff;--nonf:var(--a);--nln:rgba(255,255,255,.12);--nbt:rgba(255,255,255,.1);--nbh:rgba(255,255,255,.2);--npp:rgba(255,255,255,.14);--ntt:#fff;background:var(--nbg);color:var(--nfg);position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:18px 12px;gap:2px;overflow-y:auto}' +
            'body.M-grad nav{--nbg:linear-gradient(180deg,var(--a),var(--b) 75%,var(--c))}body.M-dark nav{--nbg:#0b1222;--nonb:var(--b);--nonf:#fff}' +
            'body.M-white nav,body.M-tint nav{--nbg:var(--card);--nfg:var(--ink);--nmu:var(--mut);--nhv:var(--row);--nonb:var(--a);--nonf:#fff;--nln:var(--line);--nbt:var(--row);--nbh:var(--line);--npp:var(--row);--ntt:var(--a)}body.M-tint nav{--nbg:color-mix(in srgb,var(--a) 9%,var(--card));--nbt:color-mix(in srgb,var(--a) 12%,var(--card))}' +
            'body.M-white nav{border-right:1px solid var(--line)}body.M-white nav a.on{background:color-mix(in srgb,var(--b) 12%,var(--card));color:var(--a);box-shadow:inset 3px 0 0 var(--b)}html[data-theme=dark] body.M-white nav a.on,html[data-theme=dark] body.M-tint nav a.on{background:var(--b);color:#fff}html[data-theme=dark] body.M-white nav,html[data-theme=dark] body.M-tint nav{--ntt:#c7d2fe}' +
            'nav .brand{display:flex;flex-direction:column}nav .co{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;padding:0 10px}nav .tt{font-size:18px;font-weight:800;padding:2px 10px 0;line-height:1.25;color:var(--ntt)}nav .pp{display:inline-block;margin:8px 10px 14px;background:var(--npp);border-radius:99px;padding:3px 12px;font-size:12px;font-weight:700}' +
            'nav .links{display:flex;flex-direction:column;gap:2px}nav a{display:flex;align-items:center;gap:10px;color:var(--nmu);text-decoration:none;padding:9px 12px;border-radius:9px;font-weight:600;cursor:pointer}nav a:hover{background:var(--nhv);color:var(--nfg)}nav a.on{background:var(--nonb);color:var(--nonf)}' +
            'nav .ng{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;padding:12px 12px 4px;border-top:1px solid var(--nln);margin-top:6px;font-weight:700}nav .grow{flex:1}nav .tools{display:flex;gap:6px;padding:8px 6px 0;border-top:1px solid var(--nln)}nav .tools button{flex:1;display:flex;gap:6px;align-items:center;justify-content:center;background:var(--nbt);border:0;color:var(--nfg);border-radius:8px;padding:8px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}nav .tools button:hover{background:var(--nbh)}' +
            'nav .logo{margin:0 10px 12px}nav .tools .cbtn,.home,.backc{display:none}' +
            /* right menu */ 'body.L-right .app{grid-template-columns:minmax(0,1fr) 260px}body.L-right nav{order:2}body.L-right.M-white nav{border-right:0;border-left:1px solid var(--line)}body.L-right.M-white nav a.on{box-shadow:inset -3px 0 0 var(--b)}' +
            /* icon rail */ 'body.L-rail .app{grid-template-columns:78px minmax(0,1fr)}body.L-rail nav{padding:14px 9px}body.L-rail nav .co,body.L-rail nav .tt,body.L-rail nav .pp,body.L-rail nav .pwn,body.L-rail nav a span,body.L-rail nav .tools button span{display:none}body.L-rail nav a{justify-content:center;padding:11px 0}body.L-rail nav a svg{width:20px;height:20px}body.L-rail nav .ng{font-size:0;padding:0;margin:8px 8px 6px;height:1px}body.L-rail nav .tools{flex-direction:column;padding:8px 0 0}body.L-rail nav .logo{max-width:58px!important;max-height:44px!important;margin:0 auto 14px;padding:4px!important}' +
            /* top bar: top tabs, contents cards, one long page */ 'body.L-top .app,body.L-cards .app,body.L-doc .app{display:block}' +
            'body.L-top nav,body.L-cards nav,body.L-doc nav{height:auto;flex-direction:row;align-items:center;padding:10px 22px;gap:16px;z-index:10;overflow:visible;box-shadow:0 2px 10px rgba(15,23,42,.08)}body.M-grad.L-top nav,body.M-grad.L-cards nav,body.M-grad.L-doc nav{--nbg:linear-gradient(90deg,var(--a),var(--b) 70%,var(--c))}' +
            'body.L-top nav .brand,body.L-cards nav .brand,body.L-doc nav .brand{flex-direction:row;align-items:center;gap:12px;flex:none}body.L-top nav .logo,body.L-cards nav .logo,body.L-doc nav .logo{margin:0;max-height:40px!important}body.L-top nav .co,body.L-cards nav .co,body.L-doc nav .co{display:none}body.L-top nav .tt,body.L-cards nav .tt,body.L-doc nav .tt{font-size:16px;padding:0}body.L-top nav .pp,body.L-cards nav .pp,body.L-doc nav .pp{margin:0}' +
            'body.L-top nav .links,body.L-doc nav .links{flex-direction:row;flex:1;min-width:0;overflow-x:auto;scrollbar-width:thin}body.L-top nav a,body.L-doc nav a{white-space:nowrap;padding:7px 12px;flex:none}body.L-top nav .ng,body.L-doc nav .ng{display:flex;align-items:center;flex:none;border-top:0;border-left:1px solid var(--nln);margin:0 0 0 6px;padding:0 6px 0 12px;white-space:nowrap}' +
            'body.L-top nav .grow,body.L-doc nav .grow,body.L-top nav .pwn,body.L-cards nav .pwn,body.L-doc nav .pwn,body.L-cards nav .links{display:none}body.L-top nav .tools,body.L-cards nav .tools,body.L-doc nav .tools{border:0;padding:0;flex:none}body.L-cards nav .grow{display:block;flex:1}body.L-cards nav .tools .cbtn{display:flex}' +
            'body.M-white.L-top nav,body.M-white.L-cards nav,body.M-white.L-doc nav{border-right:0;border-bottom:1px solid var(--line)}body.M-white.L-top nav a.on,body.M-white.L-doc nav a.on{box-shadow:inset 0 -3px 0 var(--b);border-radius:9px 9px 0 0}' +
            /* contents cards */ 'body.L-cards .home.on{display:block;animation:fi .25s ease}body.L-cards .backc{display:block;margin-bottom:10px}.backc a{cursor:pointer;color:var(--b);font-weight:700;font-size:13px}.home h1{margin:4px 0 2px;font-size:28px}.home .hs{color:var(--mut);margin-bottom:18px}.home .hg{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--mut);margin:20px 0 8px}' +
            '.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}.pc{display:flex;flex-direction:column;gap:6px;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;cursor:pointer;color:var(--ink);font:inherit;transition:transform .15s,box-shadow .15s,border-color .15s;position:relative;overflow:hidden}.pc:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(15,23,42,.1);border-color:var(--b)}.pc .ic{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--a),var(--b));color:#fff}.pc .ic svg{width:21px;height:21px}.pc b{font-size:16px}.pc small{color:var(--mut)}.pc .no{position:absolute;right:14px;top:12px;font-size:28px;font-weight:800;color:var(--line)}' +
            /* one long page */ 'body.L-doc section{display:block;animation:none;scroll-margin-top:84px;padding-bottom:30px;margin-bottom:30px;border-bottom:1px dashed var(--line)}body.L-doc section:last-of-type{border-bottom:0}' +
            /* paper and font */ 'body.P-white{--bg:#fff}html[data-theme=dark] body.P-white{--bg:#0b1020}body.F-serif{font-family:Georgia,Cambria,"Times New Roman",serif}body.F-serif nav,body.F-serif .btn,body.F-serif .chip{font-family:"Segoe UI",system-ui,Arial,sans-serif}' +
            'main{padding:26px 34px 60px;min-width:0}section{display:none;animation:fi .25s ease}section.on{display:block}@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
            '.sh{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px}.sh h2{margin:0;font-size:24px;letter-spacing:-.01em}.sh .sub{color:var(--mut);font-size:13px}.sh .gr{flex:1}' +
            '.sh input{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 10px;font:inherit;width:210px}.btn{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 11px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}.btn:hover{border-color:var(--b);color:var(--b)}' +
            '.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(15,23,42,.04)}.scroll{overflow-x:auto}' +
            'table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}table.st th{position:sticky;top:0;background:var(--a);color:#fff;text-align:right;padding:8px 10px;font-size:12px;font-weight:600;white-space:nowrap}table.st th:first-child,table.st th.l{text-align:left}' +
            'table.st td{padding:6px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}table.st td:first-child,table.st td.l{text-align:left;white-space:normal}table.st tbody tr:hover td{background:var(--row)}' +
            'tr.header td{font-weight:700;color:var(--a);padding-top:12px;background:transparent}html[data-theme=dark] tr.header td{color:#c7d2fe}tr.blank td{height:8px;border:0}tr.text td{color:var(--mut);font-style:italic}tr.b td{font-weight:700}tr.i td{font-style:italic}tr.m td{color:var(--mut)}' +
            'tr.tb td{border-top:1.5px solid var(--ink)}tr.db td{border-bottom:3px double var(--ink)}tr.check td{font-size:12px;color:var(--mut)}tr.check.notok td{color:#dc2626;font-weight:700}td.fav{color:#16a34a}td.unf{color:#dc2626}' +
            'tr.grp{cursor:pointer}tr.grp .cr{display:inline-block;width:0;height:0;border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;margin-right:8px;transition:transform .15s;vertical-align:middle}tr.grp.open .cr{transform:rotate(90deg)}' +
            'tr.acc{display:none}tr.acc.show{display:table-row}tr.acc td{font-size:12.5px;color:var(--mut);background:var(--row)}tr.hide{display:none!important}' +
            '.hero{--h1:var(--a);--h2:var(--b);--h3:var(--c);--hd:rgba(255,255,255,.16);position:relative;overflow:hidden;display:flex;gap:20px;align-items:center;background:linear-gradient(135deg,var(--h1),var(--h2) 65%,var(--h3));color:#fff;border-radius:18px;padding:30px 34px;margin-bottom:18px}.hero>div{flex:1}.hero h1{margin:4px 0;font-size:30px}.hero .eyebrow{letter-spacing:.2em;text-transform:uppercase;font-size:12px;opacity:.8}.hero .per{font-size:22px;font-weight:800;margin:6px 0}.hero .meta{opacity:.85;font-size:13px}.hero .logo{flex:none}' +
            '.hero>*{position:relative;z-index:1}.hero::after{content:"";position:absolute;inset:0;pointer-events:none;-webkit-mask-image:linear-gradient(90deg,transparent 25%,#000);mask-image:linear-gradient(90deg,transparent 25%,#000)}' +
            'body.H-solid .hero{background:var(--h1)}body.H-dark .hero{background:linear-gradient(135deg,#0b1222,#1e293b)}body.H-dark .hero .per{color:var(--h3)}' +
            'body.H-soft .hero,body.H-white .hero,body.H-minimal .hero{color:var(--ink);--hd:color-mix(in srgb,var(--h1) 16%,transparent)}body.H-soft .hero{background:color-mix(in srgb,var(--h1) 9%,var(--card));border:1px solid color-mix(in srgb,var(--h1) 18%,var(--card))}' +
            'body.H-white .hero{background:var(--card);border:1px solid var(--line);border-left:7px solid var(--h2);box-shadow:0 6px 20px rgba(15,23,42,.06)}body.H-minimal .hero{background:none;border-radius:0;padding-left:0;padding-right:0;border-bottom:3px solid var(--h2)}' +
            'body.H-soft .hero h1,body.H-white .hero h1,body.H-minimal .hero h1{color:var(--h1)}body.H-soft .hero .per,body.H-white .hero .per,body.H-minimal .hero .per{color:var(--h2)}body.H-soft .hero .eyebrow,body.H-white .hero .eyebrow,body.H-minimal .hero .eyebrow,body.H-soft .hero .meta,body.H-white .hero .meta,body.H-minimal .hero .meta{color:var(--mut);opacity:1}' +
            'html[data-theme=dark] body.H-soft .hero h1,html[data-theme=dark] body.H-white .hero h1,html[data-theme=dark] body.H-minimal .hero h1{color:#fff}html[data-theme=dark] body.H-soft .hero .per,html[data-theme=dark] body.H-white .hero .per,html[data-theme=dark] body.H-minimal .hero .per{color:#93c5fd}' +
            'body.D-dots .hero::after{background:radial-gradient(var(--hd) 1.6px,transparent 1.8px) 0 0/18px 18px}body.D-rings .hero::after{background:repeating-radial-gradient(circle at 100% 110%,transparent 0 26px,var(--hd) 26px 28px)}body.D-lines .hero::after{background:repeating-linear-gradient(-35deg,transparent 0 16px,var(--hd) 16px 18px)}' +
            'body.D-grid .hero::after{background:linear-gradient(var(--hd) 1px,transparent 1px) 0 0/26px 26px,linear-gradient(90deg,var(--hd) 1px,transparent 1px) 0 0/26px 26px}body.D-glow .hero::after{-webkit-mask-image:none;mask-image:none;background:radial-gradient(circle at 88% 15%,var(--hd),transparent 38%),radial-gradient(circle at 70% 120%,var(--hd),transparent 45%)}' +
            'body.S-compact .hero{padding:18px 26px}body.S-compact .hero h1{font-size:23px}body.S-compact .hero .per{font-size:17px;margin:2px 0}body.S-tall .hero{padding:58px 44px;min-height:260px}body.S-tall .hero h1{font-size:40px}body.S-tall .hero .per{font-size:26px}' +
            'body.A-center .hero{flex-direction:column-reverse;text-align:center;justify-content:center}body.A-center .hero .logo{margin:0 auto}' +
            '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:8px}.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;border-top:4px solid var(--b)}.tl{font-size:12px;color:var(--mut);font-weight:600}.tv{font-size:24px;font-weight:800;margin:2px 0}.td{font-size:12px;color:var(--mut)}.pos{color:#16a34a}.neg{color:#dc2626}' +
            'h3{font-size:15px;margin:22px 0 8px;color:var(--a)}html[data-theme=dark] h3{color:#c7d2fe}.note{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--b);border-radius:10px;padding:10px 16px}.note p{margin:6px 0}ul.hl{margin:0;padding:0;list-style:none}ul.hl li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 14px;margin:6px 0;border-left:4px solid var(--c)}ul.hl.warn li{border-left-color:#dc2626}' +
            '.muted{color:var(--mut)}img.wide{width:100%;border-radius:10px;background:#fff}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.two img{width:100%;border-radius:10px;background:#fff}figure{margin:0}figcaption{color:var(--mut);font-size:12px;text-align:center;margin-top:4px}' +
            '.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.chip{border:1px solid var(--line);border-radius:99px;padding:3px 11px;font-size:12px;font-weight:600;background:var(--card)}.chip.ok{color:#15803d;border-color:#bbf7d0;background:#f0fdf4}.chip.bad{color:#b91c1c;border-color:#fecaca;background:#fef2f2}' +
            'tr.none td{text-align:center!important;color:var(--mut);padding:18px}.prose{max-width:820px}.prose h2.mh{font-size:20px}.pnotes{margin-top:18px}.pnotes h4{margin:0 0 8px;color:var(--a)}.pnote{display:flex;gap:12px;background:var(--row);border-left:4px solid var(--b);border-radius:8px;padding:9px 14px;margin:6px 0;font-size:13px}.pnote p{margin:3px 0}.pno{font-weight:800;color:var(--mut);min-width:18px}.pnh{font-size:12px;margin-bottom:2px}sup.nref{color:var(--b);font-weight:700;font-size:10px}.foot{color:var(--mut);font-size:12px;margin-top:26px;text-align:center}.foot .pw{margin-top:6px;font-size:12.5px;letter-spacing:.02em}.foot .pw b{color:var(--b)}html[data-theme=dark] .foot .pw b{color:#93c5fd}nav .pwn{font-size:11px;opacity:.65;text-align:center;padding-top:8px;color:var(--nfg)}.mtop{display:none}' +
            '@media (max-width:860px){.app,body.L-right .app,body.L-rail .app{display:block}nav,body.L-top nav,body.L-cards nav,body.L-doc nav{position:sticky;height:auto;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;padding:8px;gap:2px;z-index:5}nav .links{flex-direction:row}body.L-rail nav a span{display:inline}nav .brand,nav .grow,nav .logo,nav .pwn{display:none!important}body.L-cards nav .grow{display:block!important}nav .ng{border:0;margin:0;padding:8px 6px;white-space:nowrap}nav a,body.L-rail nav a,body.L-top nav a,body.L-doc nav a{white-space:nowrap;padding:8px 10px;flex:none}nav{align-items:center}nav .tools,body.L-rail nav .tools{border:0;padding:0;flex-direction:row}main{padding:16px}table.st td:first-child{min-width:170px}.two{grid-template-columns:1fr}.hero{padding:20px}.sh input{width:100%}}' +
            '@media print{@page{size:A4 landscape;margin:10mm}nav,.sh input,.sh .btn,.backc,.home{display:none!important}.app{display:block!important}main{padding:0}section,body.L-doc section{display:none;page-break-after:always;border:0}section.on,body.all section,body.L-doc section.on,body.all.L-doc section{display:block}tr.acc.show{display:table-row}.card{border:0;box-shadow:none;padding:0}table.st th{background:#13315c!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.hero,.tile{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
        var nav = out.map(function (x, k) { var t = P.TYPES[x.sec.type] || {}; if (x.sec.icon) t = { icon: x.sec.icon }; return (x.group && (!k || out[k - 1].group !== x.group) ? '<div class="ng">' + esc(x.group) + '</div>' : '') + '<a data-s="' + k + '" href="#' + esc(x.sec.id) + '" title="' + esc((x.group ? x.group + ' · ' : '') + x.sec.title) + '">' + P.svg(t.icon) + '<span>' + esc(x.sec.title) + '</span></a>'; }).join('');
        var secs = out.map(function (x, k) {
            var tools = (x.search ? '<input type="search" placeholder="Search this page…" data-q="' + k + '">' : '') + (x.collapsible ? '<button class="btn" data-x="' + k + '" title="Open or close every line">Expand all</button>' : '') +
                (x.csv ? '<button class="btn" data-csv="' + k + '">' + P.svg('dl', 14) + ' CSV</button>' : '') + '<button class="btn" data-pr="1">' + P.svg('print', 14) + ' Print</button>';
            return '<section id="' + esc(x.sec.id) + '" data-k="' + k + '"><div class="backc"><a data-home>\u2190 All pages</a></div>' + (x.sec.type === 'summary' ? '' : '<div class="sh"><div>' + (x.group ? '<div class="sub" style="font-weight:700;letter-spacing:.06em;text-transform:uppercase">' + esc(x.group) + '</div>' : '') + '<h2>' + esc(x.sec.title) + '</h2><div class="sub">' + esc(x.sub || pname) + ' · amounts in ' + esc(FL.scaleLabel()) + '</div></div><span class="gr"></span>' + tools + '</div>') +
                '<div class="' + (x.sec.type === 'summary' || x.sec.type === 'charts' || x.sec.type === 'text' ? '' : 'card scroll') + '">' + x.html + '</div>' +
                (x.csv ? '<script type="text/plain" id="csv' + k + '" data-name="' + esc(x.sec.title + ' ' + pname) + '.csv">' + x.csv.replace(/<\//g, '<\\/') + '</script>' : '') + '</section>';
        }).join('');
        var home = '<div class="home"><div class="co muted" style="letter-spacing:.16em;text-transform:uppercase;font-size:12px;font-weight:700">' + esc(pack.company || '') + '</div><h1>' + esc(pack.title || pack.name) + '</h1><div class="hs">' + esc(pname) + ' · ' + out.length + ' pages · choose one to read it</div>' +
            out.map(function (x, k) {
                var t = P.TYPES[x.sec.type] || {}, ic = x.sec.icon || t.icon;
                return (x.group && (!k || out[k - 1].group !== x.group) ? (k ? '</div>' : '') + '<div class="hg">' + esc(x.group) + '</div><div class="cards">' : !k ? '<div class="cards">' : '') +
                    '<button class="pc" data-go="' + k + '"><span class="no">' + (k + 1) + '</span><span class="ic">' + P.svg(ic) + '</span><b>' + esc(x.sec.title) + '</b><small>' + esc(t.what || t.label || '') + '</small></button>';
            }).join('') + (out.length ? '</div>' : '') + '</div>';
        var js = '(function(){var S=[].slice.call(document.querySelectorAll("section")),A=[].slice.call(document.querySelectorAll("nav a[data-s]"));' +
            'var B=document.body,DOC=B.classList.contains("L-doc"),CARDS=B.classList.contains("L-cards"),H=document.querySelector(".home");' +
            'function mark(k){S.forEach(function(s,i){s.classList.toggle("on",i==k)});A.forEach(function(a,i){a.classList.toggle("on",i==k)});var a=A[k];if(a&&a.scrollIntoView&&(B.classList.contains("L-top")||DOC))try{a.scrollIntoView({block:"nearest",inline:"nearest"})}catch(_){}}' +
            'function hist(id){if(location.href.indexOf("about:")!==0)try{history.replaceState(null,"","#"+id)}catch(_){}}' +
            'function go(k,now,nh){if(H)H.classList.toggle("on",CARDS&&k<0);if(CARDS&&k<0){mark(-1);window.scrollTo(0,0);if(!nh)hist("");return}mark(k);if(DOC){var y=S[k].getBoundingClientRect().top+window.pageYOffset-76;window.scrollTo({top:k?y:0,behavior:now?"auto":"smooth"})}else window.scrollTo(0,0);if(!nh)hist(S[k].id)}' +
            'function fromHash(){var h=window.PACK_START||decodeURIComponent(location.hash.slice(1)),k=CARDS?-1:0;S.forEach(function(s,i){if(s.id===h)k=i});go(k,1,!location.hash)}window.addEventListener("hashchange",fromHash);fromHash();' +
            'if(DOC){var tk=0;window.addEventListener("scroll",function(){if(tk)return;tk=requestAnimationFrame(function(){tk=0;var k=0;S.forEach(function(s,i){if(s.getBoundingClientRect().top<170)k=i});if((window.innerHeight+window.pageYOffset)>=document.body.scrollHeight-4)k=S.length-1;if(!S[k].classList.contains("on"))mark(k)})})}' +
            'document.addEventListener("keydown",function(e){if(/INPUT|TEXTAREA/.test(e.target.tagName))return;var k=S.findIndex(function(s){return s.classList.contains("on")});if(e.key==="ArrowDown"||e.key==="j"){k=Math.min(S.length-1,k+1)}else if(e.key==="ArrowUp"||e.key==="k"){k=Math.max(0,k-1)}else return;go(k);e.preventDefault()});' +
            'document.addEventListener("click",function(e){var na=e.target.closest("nav a[data-s]");if(na){e.preventDefault();go(+na.dataset.s);return}if(e.target.closest("[data-home]")){e.preventDefault();go(-1);return}var pc=e.target.closest("[data-go]");if(pc){go(+pc.dataset.go);return}var g=e.target.closest("tr.grp");if(g){var o=!g.classList.contains("open");g.classList.toggle("open",o);document.querySelectorAll(\'tr[data-p="\'+g.dataset.g+\'"]\').forEach(function(r){r.classList.toggle("show",o)});return}' +
            'var x=e.target.closest("[data-x]");if(x){var sec=x.closest("section"),gs=sec.querySelectorAll("tr.grp"),open=x.textContent.indexOf("Expand")>=0;gs.forEach(function(g){g.classList.toggle("open",open);sec.querySelectorAll(\'tr[data-p="\'+g.dataset.g+\'"]\').forEach(function(r){r.classList.toggle("show",open)})});x.textContent=open?"Collapse all":"Expand all";return}' +
            'var c=e.target.closest("[data-csv]");if(c){var t=document.getElementById("csv"+c.dataset.csv),b=new Blob(["\\ufeff"+t.textContent],{type:"text/csv"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=t.dataset.name;document.body.appendChild(a);a.click();setTimeout(function(){a.remove()},500);return}' +
            'if(e.target.closest("[data-pr]")){var ps=e.target.closest("section");if(ps)mark(S.indexOf(ps));document.body.classList.remove("all");window.print();return}if(e.target.closest("#prall")){document.body.classList.add("all");window.print();setTimeout(function(){document.body.classList.remove("all")},500);return}' +
            'if(e.target.closest("#theme")){var d=document.documentElement,n=d.dataset.theme==="dark"?"light":"dark";d.dataset.theme=n;try{localStorage.setItem("pack.theme",n)}catch(_){}}});' +
            'document.addEventListener("input",function(e){var q=e.target.dataset&&e.target.dataset.q;if(q==null)return;var v=e.target.value.toLowerCase().trim(),sec=e.target.closest("section");sec.querySelectorAll("tbody tr").forEach(function(r){var hit=!v||r.textContent.toLowerCase().indexOf(v)>=0;r.classList.toggle("hide",!hit);if(v&&hit&&r.classList.contains("acc"))r.classList.add("show")});' +
            'var tb=sec.querySelector("tbody");if(tb){var nn=tb.querySelector("tr.none");if(nn)nn.remove();if(v&&![].some.call(tb.querySelectorAll("tr"),function(r){return !r.classList.contains("hide")})){var z=document.createElement("tr");z.className="none";z.innerHTML="<td colspan=\'20\'>Nothing on this page matches \u201c"+e.target.value.replace(/[<>&]/g,"")+"\u201d</td>";tb.appendChild(z)}}' +
            'if(v)sec.querySelectorAll("tr.grp").forEach(function(g){if([].some.call(sec.querySelectorAll(\'tr[data-p="\'+g.dataset.g+\'"]\'),function(r){return !r.classList.contains("hide")})){g.classList.remove("hide");g.classList.add("open")}})});' +
            'if(window.top===window&&window.chrome&&window.chrome.webview){var tl=document.querySelector("nav .tools"),cb=document.createElement("button");cb.id="packclose";cb.title="Close the pack and go back";cb.innerHTML="\u2715 Close";tl.insertBefore(cb,tl.firstChild);' +
            'cb.onclick=function(){if(history.length>1&&document.referrer){history.back();return}try{window.chrome.webview.postMessage({action:"closeThisTab"})}catch(_){}setTimeout(function(){window.close()},300)};document.addEventListener("keydown",function(e){if(e.key==="Escape")cb.click()})}' +
            'try{var t=localStorage.getItem("pack.theme");if(t)document.documentElement.dataset.theme=t;else if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.dataset.theme="dark"}catch(_){}})();';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Finance Lens">' +
            '<title>' + esc((pack.title || pack.name) + ' — ' + pname) + '</title><style>' + css + (hr.img ? 'body.H-image .hero{background:linear-gradient(100deg,rgba(8,12,28,.82),rgba(8,12,28,.3)),url("' + hr.img.replace(/"/g, '') + '") center/cover}' : '') + '</style></head><body class="L-' + look.layout + ' M-' + look.menu + ' P-' + look.paper + ' F-' + look.font + ' H-' + hr.style + ' D-' + hr.deco + ' S-' + hr.size + ' A-' + hr.align + '"><div class="app"><nav>' +
            '<div class="brand">' + (lg ? '<img class="logo" src="' + esc(lg.src) + '" alt="" style="' + P.logoCss(mlg, 'menu') + '">' : '') + '<div class="bt"><div class="co">' + esc(pack.company || '') + '</div><div class="tt">' + esc(pack.title || pack.name) + '</div><div><span class="pp">' + esc(pname) + '</span></div></div></div><div class="links">' + nav + '</div>' +
            '<span class="grow"></span><div class="tools"><button class="cbtn" data-home title="Back to the contents">' + P.svg('list', 14) + '<span> Contents</span></button><button id="prall" title="Print every page of the pack">' + P.svg('print', 14) + '<span> Print all</span></button><button id="theme" title="Light / dark">' + P.svg('moon', 14) + '</button></div><div class="pwn">Powered by Fusion Client</div></nav>' +
            '<main>' + home + (dist ? secs.split('<!--DIST-->').join('<div class="meta" style="margin-top:8px">Document ' + esc(dist.docId) + (dist.to.length + dist.cc.length ? ' · issued to ' + esc(dist.to.concat(dist.cc).slice(0, 4).join(', ') + (dist.to.length + dist.cc.length > 4 ? ' and ' + (dist.to.length + dist.cc.length - 4) + ' more' : '')) : '') + '</div>') : secs) +
            '<div class="foot">' + (dist ? 'Document ' + esc(dist.docId) + ' · ' : '') + esc(pack.company || '') + ' · ' + esc(pack.title || pack.name) + ' · ' + esc(pname) + ' · generated on ' + esc(new Date().toLocaleString('en-GB')) + ' from the general ledger<div class="pw">Powered by <b>Fusion Client</b></div></div></main></div><script>' + js + '</script></body></html>';
    }

    /** A document ID for one issued copy: BP-yyyymmdd-XXXX */
    P.docId = function () { var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return 'BP-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); };
    /** The copy that leaves the app: the pack + a "Distribution & control" page (document ID, who it went to, by whom, how, when) and a
        line on the cover. info = {docId, to, cc, by, via, kind: 'EMAIL' | 'DOWNLOAD', status}. Bcc is never written into the document.
        → a new built object {html, file, model, sections, docId, distribution} — fingerprint THIS html (the stamp is part of it). */
    P.stamp = function (built, info) {
        var g = built._pg; if (!g) return built;
        info = info || {}; var docId = info.docId || P.docId(), when = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        var FLs = function (list) { try { return (list || '').split(/[;,\n]/).map(function (a) { return a.trim(); }).filter(Boolean); } catch (e) { return []; } };
        var to = FLs(info.to), cc = FLs(info.cc), rows = to.map(function (a) { return ['To', a]; }).concat(cc.map(function (a) { return ['Cc', a]; }));
        var dist = { docId: docId, to: to, cc: cc, by: info.by || '', via: info.via || '', kind: info.kind || 'EMAIL', at: when };
        var html = '<div class="card"><table class="st kp"><tbody>' +
            [['Document ID', '<b>' + esc(docId) + '</b>'], ['Board pack', esc((g.pack.title || g.pack.name) + ' · ' + g.pname)], ['Covers', esc(built.model.ledgerName || built.model.filter)],
                ['Issued', esc(when)], ['Issued by', esc(dist.by || (FL.who && FL.who.user) || '')], ['How', esc(dist.kind === 'EMAIL' ? 'E-mail' + (dist.via ? ' (' + dist.via + ')' : '') : 'Downloaded file')]]
                .map(function (r) { return '<tr><td class="l" style="width:200px;color:var(--mut)">' + r[0] + '</td><td class="l">' + r[1] + '</td></tr>'; }).join('') + '</tbody></table></div>' +
            (rows.length ? '<h3>Distribution list</h3><div class="card"><table class="st kp"><thead><tr><th class="l" style="width:80px"></th><th class="l">Recipient</th></tr></thead><tbody>' +
                rows.map(function (r) { return '<tr><td class="l">' + r[0] + '</td><td class="l">' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' :
                '<h3>Distribution list</h3><p class="muted">This copy was ' + (dist.kind === 'DOWNLOAD' ? 'downloaded' : 'issued') + ' without a recorded list of recipients.</p>') +
            '<h3>Checking this document</h3><div class="note"><p>This copy is recorded in the Finance Lens board pack archive under <b>' + esc(docId) + '</b>. Its SHA-256 fingerprint is written in the e-mail it came with and in the archive; ' +
            'Finance Lens › Board packs › Archive › <i>Verify</i> recomputes it — the same fingerprint means this is exactly the file that was issued.</p></div>';
        var out = g.out.concat([{ sec: { id: 'distribution', type: 'text', title: 'Distribution & control' }, html: html, group: '' }]);
        out[out.length - 1].sec.icon = 'bell';
        var keep = FL.filter.scale; if (g.scale) FL.filter.scale = +g.scale;
        var page2 = page(g.pack, g.th, g.pname, out, g.lg, dist); FL.filter.scale = keep;
        return Object.assign({}, built, { html: page2, docId: docId, distribution: dist, sections: built.sections.concat(['Distribution & control']), file: built.file.replace(/\.html$/, ' ' + docId + '.html') });
    };

    /** Outlook-safe message body. opts: {intro, tiles, keyLines, highlights, chart: 'cid:…' | data URL | null, attached: file name} */
    P.emailHtml = function (pack, model, opts) {
        opts = opts || {};
        var th = P.THEMES[pack.theme] || P.THEMES.navy, F = 'font-family:Segoe UI,Arial,Helvetica,sans-serif;';
        var fill = function (s) { return String(s || '').replace(/\{PERIOD\}/g, model.period).replace(/\{TITLE\}/g, pack.title || pack.name).replace(/\{COMPANY\}/g, pack.company || ''); };
        var n = function (v) { return v == null || isNaN(v) ? '–' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: (FL.filter.scale || 1) >= 1000 ? 0 : 2 }); };
        var h = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#eef1f7">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef1f7" style="background:#eef1f7"><tr><td align="center" style="padding:24px 10px">' +
            '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px">' +
            '<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="' + th.a + '" style="background:' + th.a + ';padding:26px 30px;border-radius:12px ' + (opts.logo && model.logo ? '0 0' : '12px 0') + ' 0;' + F + 'color:#ffffff">' +
            '<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#cbd5e1">' + esc(pack.company || '') + '</div>' +
            '<div style="font-size:24px;font-weight:bold;margin-top:4px;color:#ffffff">' + esc(pack.title || pack.name) + '</div>' +
            '<div style="font-size:16px;margin-top:6px;color:#e2e8f0">' + esc(model.period) + ' &middot; ' + esc(model.filter) + '</div></td>' +
            (opts.logo && model.logo ? '<td align="right" valign="middle" bgcolor="' + th.a + '" style="background:' + th.a + ';padding:20px 30px 20px 0;border-radius:0 12px 0 0"><img src="' + opts.logo + '" alt="' + esc(pack.company || '') + '" style="' + P.logoCss(model.logo, 'mail') + '"></td>' : '') + '</tr></table></td></tr>' +
            '<tr><td bgcolor="' + th.c + '" style="background:' + th.c + ';height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>';
        if (opts.intro) h += '<tr><td style="padding:22px 30px 6px;' + F + 'font-size:14px;line-height:1.6;color:#1e293b">' + esc(fill(opts.intro)).replace(/\n/g, '<br>') + '</td></tr>';
        if (opts.tiles !== false && model.tiles.length) {
            var tileRows = function (t) { var rowsH = '';
            for (var i = 0; i < t.length; i += 3) {
                rowsH += '<tr>' + t.slice(i, i + 3).map(function (x) {
                    return '<td width="33%" valign="top" style="padding:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-top:3px solid ' + th.b + ';border-radius:8px"><tr><td style="padding:10px 12px;' + F + '">' +
                        '<div style="font-size:11px;color:#64748b;font-weight:bold">' + esc(x.label) + '</div><div style="font-size:20px;font-weight:bold;color:#0f172a;margin:2px 0">' + x.value + '</div>' +
                        '<div style="font-size:11px;color:' + (x.good == null ? '#64748b' : x.good ? '#15803d' : '#b91c1c') + '">' + esc(x.delta) + '</div></td></tr></table></td>';
                }).join('') + '</tr>';
            }
            return rowsH; };
            var rowsH = '';
            if (model.ledgers && model.ledgers.length > 1) model.ledgers.forEach(function (l) { rowsH += '<tr><td colspan="3" style="padding:12px 6px 2px;' + F + 'font-size:13px;font-weight:bold;color:' + th.a + '">' + esc(l.name) + '</td></tr>' + tileRows(l.tiles.slice(0, 3)); });
            else rowsH = tileRows(model.tiles.slice(0, 6));
            h += '<tr><td style="padding:12px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rowsH + '</table></td></tr>';
        }
        if (opts.keyLines !== false && model.keyLines.length) {
            var th2 = 'style="' + F + 'font-size:11px;color:#ffffff;background:' + th.a + ';padding:7px 8px;text-align:right"';
            h += '<tr><td style="padding:16px 30px 4px;' + F + 'font-size:15px;font-weight:bold;color:' + th.a + '">Income statement at a glance <span style="font-size:11px;color:#64748b;font-weight:normal">(' + esc(model.scaleLabel) + ')</span></td></tr>' +
                '<tr><td style="padding:4px 30px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><th ' + th2.replace('right', 'left') + '>&nbsp;</th><th ' + th2 + '>Month</th><th ' + th2 + '>YTD</th><th ' + th2 + '>YTD budget</th><th ' + th2 + '>YTD last year</th></tr>' +
                model.keyLines.map(function (r, k) {
                    var td = 'style="' + F + 'font-size:12px;padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;' + (r.bold ? 'font-weight:bold;' : '') + (k % 2 ? 'background:#f8fafc;' : '') + '"';
                    return '<tr><td ' + td.replace('text-align:right', 'text-align:left') + '>' + esc(r.label) + '</td><td ' + td + '>' + n(r.m) + '</td><td ' + td + '>' + n(r.y) + '</td><td ' + td + '>' + n(r.yb) + '</td><td ' + td + '>' + n(r.py) + '</td></tr>';
                }).join('') + '</table></td></tr>';
        }
        if (opts.chart) h += '<tr><td style="padding:12px 30px 4px;' + F + 'font-size:15px;font-weight:bold;color:' + th.a + '">Revenue and net profit, last 12 months</td></tr><tr><td style="padding:4px 30px 8px"><img src="' + opts.chart + '" width="580" style="width:580px;max-width:100%;height:auto;border:0;display:block" alt="Revenue and net profit"></td></tr>';
        var hl = (opts.highlights !== false ? model.highlights : []).concat(model.attention.map(function (a) { return '⚠ ' + a; }));
        if (hl.length) h += '<tr><td style="padding:12px 30px 4px;' + F + 'font-size:15px;font-weight:bold;color:' + th.a + '">Highlights</td></tr><tr><td style="padding:2px 30px 8px;' + F + 'font-size:13px;line-height:1.55;color:#1e293b"><ul style="margin:0;padding-left:18px">' + hl.slice(0, 8).map(function (x) { return '<li style="margin:3px 0">' + esc(x) + '</li>'; }).join('') + '</ul></td></tr>';
        if (opts.attached) h += '<tr><td style="padding:14px 30px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;border-radius:8px"><tr><td style="padding:12px 16px;' + F + 'font-size:13px;color:#0f172a">' +
            '&#128206; <b>The full interactive pack is attached:</b> ' + esc(opts.attached) + '<br><span style="color:#64748b">Open it in any browser — the menu on the left shows the ' + esc((opts.sections || []).join(', ')) + '. Lines open into accounts, every table has search and CSV, and Print gives the whole pack.</span></td></tr></table></td></tr>';
        if (opts.fingerprint) h += '<tr><td style="padding:10px 30px 4px;' + F + 'font-size:11px;color:#64748b">Document <b>' + esc(opts.docId || '') + '</b> &middot; fingerprint (SHA-256) of the attached pack:<br><span style="font-family:Consolas,monospace;font-size:10.5px;color:#334155;word-break:break-all">' + esc(opts.fingerprint) + '</span><br>' +
            'Keep this e-mail: the same fingerprint in Finance Lens › Board packs › Archive › Verify proves the pack has not been changed since it was sent.</td></tr>';
        h += '<tr><td style="padding:18px 30px 24px;' + F + 'font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0">' + esc(pack.company || '') + ' &middot; ' + esc(pack.title || pack.name) + ' &middot; ' + esc(model.period) + ' &middot; from the general ledger<div style="margin-top:6px;font-size:12px;color:#64748b">Powered by <b style="color:' + th.b + '">Fusion Client</b></div></td></tr>' +
            '</table></td></tr></table></body></html>';
        return { html: h, subject: fill((pack.email || {}).subject || '{TITLE} · {PERIOD}') };
    };
})();
