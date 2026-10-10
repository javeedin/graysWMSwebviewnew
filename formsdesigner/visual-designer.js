// ============================================================
// VISUAL DESIGNER - WYSIWYG canvas for form definitions
// ============================================================
// Renders the current definition (global `cur` from index.html) as a
// design surface. Hierarchy: Canvas > Tab pages > Sections (styled
// groups) > Regions (data-bound: single-row fields / multi-row grid)
// > Items. Drag fields between the main grid, sections and single-row
// regions; click anything to edit it in the inspector; Desktop /
// Mobile / Both device views render side by side. All edits go
// straight into cur.def - Designer, JSON and Preview read the same
// object.
// ============================================================

(function () {
    var VD = window.VD = {};
    var sel = null;              // {kind, i, di, ci, name}
    var device = 'desktop';     // 'desktop' | 'mobile' | 'both'
    var extraTabs = [];
    var drag = null;             // {kind:'field'|'column', i, di}

    function d() { return cur.def; }
    function fields() { return (d().header && d().header.fields) || []; }
    function regions() { return d().regions || []; }
    function q(s) { return String(s).replace(/'/g, "\\'"); }

    function css() {
        if (document.getElementById('vd-style')) return '';
        return '<style id="vd-style">' +
            '.vd-wrap{display:flex;gap:14px;align-items:flex-start;}' +
            '.vd-canvas-outer{flex:1;overflow:auto;padding:6px 2px 30px;}' +
            '.vd-insp{width:300px;flex-shrink:0;background:white;border:1px solid var(--border);border-radius:10px;padding:11px 13px;position:sticky;top:0;max-height:78vh;overflow-y:auto;}' +
            '.vd-form{background:white;border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.08);position:relative;display:flex;overflow:hidden;}' +
            '.vd-devlabel{font-size:9.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;margin:0 0 5px 2px;}' +
            '.vd-body{flex:1;padding:12px 16px 40px;min-width:0;}' +
            '.vd-title{padding:10px 16px;background:linear-gradient(135deg,#0f766e,#134e4a);color:white;font-weight:800;font-size:13px;cursor:pointer;}' +
            '.vd-title.vd-seld{outline:2px solid #f59e0b;outline-offset:-2px;}' +
            '.vd-fld{border:1.5px dashed #cbd5e1;border-radius:8px;padding:5px 8px;background:#fbfcfe;cursor:grab;position:relative;min-height:44px;}' +
            '.vd-fld:hover{border-color:#0f766e;}' +
            '.vd-fld.vd-seld{border:1.5px solid #0f766e;background:#f0fdfa;}' +
            '.vd-fld .lb{font-size:10px;font-weight:700;color:#475569;}' +
            '.vd-fld .ky{font-size:9px;color:#94a3b8;font-family:Consolas,monospace;}' +
            '.vd-fld .ctl{margin-top:2px;height:20px;border:1px solid #e2e8f0;border-radius:5px;background:white;font-size:9px;color:#94a3b8;display:flex;align-items:center;padding:0 6px;gap:4px;}' +
            '.vd-fld .eye{position:absolute;top:3px;right:4px;font-size:10px;cursor:pointer;color:#0f766e;}' +
            '.vd-fld.vd-hidden{opacity:0.38;}' +
            '.vd-drop{outline:2px solid #f59e0b;outline-offset:2px;}' +
            '.vd-tabbar{display:flex;gap:4px;margin-bottom:9px;flex-wrap:wrap;align-items:center;}' +
            '.vd-tab{padding:4px 13px;font-size:10.5px;font-weight:800;cursor:pointer;border-radius:7px 7px 0 0;background:#f1f5f9;color:#475569;}' +
            '.vd-tab.on{background:#0f766e;color:white;}' +
            '.vd-tab.vd-seld{outline:2px solid #f59e0b;}' +
            '.vd-add{border:1.5px dashed #94d8d0;border-radius:8px;color:#0f766e;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;background:#f7fdfc;min-height:44px;}' +
            '.vd-add:hover{background:#e2f1ef;}' +
            '.vd-sec{border:1.5px dashed #cbd5e1;border-radius:10px;padding:9px 11px;margin-top:12px;cursor:pointer;}' +
            '.vd-sec.vd-seld{border-color:#f59e0b;}' +
            '.vd-reg{border:1px solid #bfdbfe;border-radius:9px;padding:7px 9px;margin-top:8px;background:#f8fbff;cursor:pointer;}' +
            '.vd-reg.vd-seld{border:1.5px solid #f59e0b;}' +
            '.vd-reg-h{font-size:9.5px;font-weight:800;color:#1d4ed8;margin-bottom:5px;display:flex;align-items:center;gap:6px;}' +
            '.vd-det{border:1px solid var(--border);border-radius:9px;margin-top:12px;overflow:hidden;}' +
            '.vd-det-h{padding:6px 10px;background:#f8fafc;font-size:10.5px;font-weight:800;color:#475569;cursor:pointer;display:flex;justify-content:space-between;align-items:center;}' +
            '.vd-det.vd-seld .vd-det-h{background:#f0fdfa;color:#0f766e;}' +
            '.vd-cols{display:flex;gap:4px;padding:8px;flex-wrap:wrap;}' +
            '.vd-col{border:1.5px dashed #cbd5e1;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700;color:#475569;background:white;cursor:grab;}' +
            '.vd-col.vd-seld{border-style:solid;border-color:#0369a1;background:#eff8ff;color:#0369a1;}' +
            '.vd-acts{display:flex;gap:6px;justify-content:flex-end;padding:9px 12px;border-top:1px solid #f1f5f9;flex-wrap:wrap;align-items:center;}' +
            '.vd-act{border-radius:8px;padding:5px 13px;font-size:11px;font-weight:800;cursor:pointer;border:1.5px dashed transparent;}' +
            '.vd-act.vd-seld{border:1.5px solid #f59e0b;}' +
            '.vd-side{width:46px;background:#f8fafc;border-left:1px solid #e2e8f0;display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:6px;flex-shrink:0;}' +
            '.vd-sideit{width:32px;height:32px;border:1.5px dashed #cbd5e1;border-radius:8px;background:white;color:#0f766e;font-size:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;}' +
            '.vd-sideit.vd-seld{border:1.5px solid #f59e0b;}' +
            '.vd-resize{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;color:#94a3b8;font-size:11px;}' +
            '.vd-ilbl{display:block;font-size:9.5px;font-weight:700;color:#475569;margin:7px 0 2px;}' +
            '.vd-iin{width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid var(--border);border-radius:6px;font-size:11.5px;}' +
            '.vd-swrow{display:flex;gap:4px;margin-top:4px;align-items:center;}' +
            '.vd-rep{border:1px dashed #c4b5fd;border-radius:9px;margin-top:12px;padding:8px 12px;font-size:10.5px;color:#6d28d9;font-weight:700;cursor:pointer;background:#faf8ff;}' +
            '.vd-rep.vd-seld{border-style:solid;outline:1px solid #c4b5fd;}' +
            '</style>';
    }

    // ── helpers ─────────────────────────────────────────────
    function hTabs() {
        var t = [];
        fields().forEach(function (f) { var x = f.tab || null; if (x && t.indexOf(x) < 0) t.push(x); });
        extraTabs.forEach(function (x) { if (t.indexOf(x) < 0) t.push(x); });
        if (t.length && fields().some(function (f) { return !f.tab; })) t.unshift('Main');
        return t;
    }
    function curHTab() {
        var t = hTabs();
        if (!t.length) return null;
        return t.indexOf(VD._hTab) >= 0 ? VD._hTab : t[0];
    }
    function mob() { return d().mobile = d().mobile || { columns: 1, hidden: [], order: [] }; }
    function orderedFields(dev) {
        var arr = fields().map(function (f, i) { return { f: f, i: i }; });
        if (dev === 'mobile') {
            var ord = (d().mobile && d().mobile.order) || [];
            if (ord.length) arr.sort(function (a, b) {
                var ia = ord.indexOf(a.f.key), ib = ord.indexOf(b.f.key);
                return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
            });
        }
        return arr;
    }

    // ── main render ─────────────────────────────────────────
    VD.render = function () {
        var mount = document.getElementById('vd-mount');
        if (!mount) return;
        var def = d();
        var devBtn = function (dv, ico, lab) {
            return '<button class="btn ' + (device === dv ? 'btn-p' : 'btn-o') + '" onclick="VD.dev(\'' + dv + '\')"><i class="fas fa-' + ico + '"></i> ' + lab + '</button>';
        };
        mount.innerHTML = css() +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">' +
              '<div style="display:flex;gap:4px;">' +
                devBtn('desktop', 'desktop', 'Desktop') + devBtn('mobile', 'mobile-screen', 'Mobile') + devBtn('both', 'table-columns', 'Both') +
              '</div>' +
              '<div style="display:flex;gap:4px;align-items:center;font-size:10px;color:#475569;font-weight:700;">' +
                'W <input type="number" value="' + esc(def.width || 950) + '" style="width:70px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;" onchange="VD.setSize(\'width\', this.value)">' +
                'H <input type="number" value="' + esc(def.height || '') + '" placeholder="auto" style="width:70px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;" onchange="VD.setSize(\'height\', this.value)">' +
              '</div>' +
              '<span style="font-size:10px;color:#94a3b8;">Drag fields between sections, regions and tab pages · click anything to edit it on the right · eye icons on the mobile canvas hide fields on the phone</span>' +
            '</div>' +
            '<div class="vd-wrap"><div class="vd-canvas-outer"><div id="vd-canvas"></div></div>' +
            '<div class="vd-insp" id="vd-insp"></div></div>';
        VD.canvas(); VD.insp();
    };
    VD.setSize = function (k, v) {
        if (v === '' || Number(v) <= 0) delete d()[k]; else d()[k] = Number(v);
        VD.canvas();
    };

    VD.canvas = function () {
        var box = document.getElementById('vd-canvas');
        if (!box) return;
        if (device === 'both') {
            box.innerHTML = '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">' +
                '<div><div class="vd-devlabel"><i class="fas fa-desktop"></i> Desktop</div>' + buildCanvas('desktop') + '</div>' +
                '<div><div class="vd-devlabel"><i class="fas fa-mobile-screen"></i> Mobile</div>' + buildCanvas('mobile') + '</div>' +
                '</div>';
        } else {
            box.innerHTML = buildCanvas(device);
        }
    };

    // one complete canvas for one device
    function buildCanvas(dev) {
        var def = d();
        var isM = dev === 'mobile';
        var width = isM ? 390 : (def.width || 950);
        var cols = isM ? ((def.mobile && def.mobile.columns) || 1) : ((def.header && def.header.columns) || 4);
        var tabs = hTabs();
        var act = curHTab();
        var hidden = isM ? (mob().hidden || []) : [];
        var secKeys = (def.sections || []).map(function (s) { return s.key; });
        var regKeys = regions().map(function (r) { return r.key; });

        function fieldBlock(x, container) {
            var f = x.f, i = x.i;
            var isHid = hidden.indexOf(f.key) >= 0;
            var span = (!isM && f.span) ? 'grid-column:span ' + Math.min(f.span, cols) + ';' : '';
            var typeIco = { picker: 'search', select: 'caret-down', date: 'calendar', textarea: 'align-left', checkbox: 'square-check', computed: 'calculator', readonly: 'lock', number: 'hashtag' }[f.type] || 'font';
            return '<div class="vd-fld ' + (sel && sel.kind === 'field' && sel.i === i ? 'vd-seld' : '') + (isHid ? ' vd-hidden' : '') + '" style="' + span + '"' +
                ' draggable="true" ondragstart="VD.dragStart(event,\'field\',' + i + ')"' +
                ' ondragover="event.preventDefault();this.classList.add(\'vd-drop\')" ondragleave="this.classList.remove(\'vd-drop\')"' +
                ' ondrop="VD.dropInto(event,\'' + q(container) + '\',' + i + ',\'' + dev + '\')"' +
                ' onclick="VD.sel(\'field\',' + i + ')">' +
                (isM ? '<span class="eye" onclick="event.stopPropagation();VD.toggleHidden(\'' + q(esc(f.key)) + '\')"><i class="fas fa-eye' + (isHid ? '-slash' : '') + '"></i></span>' : '') +
                '<div class="lb">' + esc(f.label || f.key) + (f.required ? ' <span style="color:#dc2626;">*</span>' : '') + '</div>' +
                '<div class="ctl"><i class="fas fa-' + typeIco + '"></i> ' + esc(f.type || 'text') + '</div>' +
                '<div class="ky">' + esc(f.key) + (f.showWhen ? ' · <i class="fas fa-eye-low-vision" title="conditional"></i>' : '') + '</div>' +
                '</div>';
        }
        function grid(blocksHtml, gcols, container) {
            return '<div style="display:grid;grid-template-columns:repeat(' + gcols + ',1fr);gap:7px 10px;"' +
                ' ondragover="event.preventDefault()" ondrop="VD.dropInto(event,\'' + q(container) + '\',-1,\'' + dev + '\')">' +
                blocksHtml + '</div>';
        }
        function detChips(det, di) {
            return '<div class="vd-cols" style="padding:4px 0 0;">' +
                (det.columns || []).map(function (c, ci) {
                    return '<div class="vd-col ' + (sel && sel.kind === 'column' && sel.di === di && sel.ci === ci ? 'vd-seld' : '') + '"' +
                        ' draggable="true" ondragstart="VD.dragStart(event,\'column\',' + ci + ',' + di + ')"' +
                        ' ondragover="event.preventDefault();this.classList.add(\'vd-drop\')" ondragleave="this.classList.remove(\'vd-drop\')"' +
                        ' ondrop="VD.dropOnColumn(event,' + di + ',' + ci + ')"' +
                        ' onclick="event.stopPropagation();VD.sel(\'column\',null,' + di + ',' + ci + ')">' +
                        esc(c.label || c.key) + (c.type === 'computed' ? ' <i class="fas fa-calculator" style="font-size:8px;"></i>' : '') + '</div>';
                }).join('') +
                '<div class="vd-col" style="border-color:#94d8d0;color:#0f766e;" onclick="event.stopPropagation();VD.addColumn(' + di + ')"><i class="fas fa-plus"></i></div>' +
                '</div>';
        }

        var tabFields = orderedFields(dev).filter(function (x) {
            return !tabs.length || (x.f.tab || 'Main') === act;
        });

        function regionBox(r, ri, parentCols) {
            var body;
            if (r.display === 'multi') {
                var di = (def.details || []).findIndex(function (dd) { return dd.region === r.key; });
                body = di >= 0
                    ? '<div style="font-size:9px;color:#64748b;">grid: ' + esc((def.details[di].title || def.details[di].key)) + '</div>' + detChips(def.details[di], di)
                    : '<div style="font-size:9.5px;color:#94a3b8;">multi-row — use Generate from SQL to create the grid</div>';
            } else {
                var blocks = tabFields.filter(function (x) { return x.f.region === r.key; })
                    .map(function (x) { return fieldBlock(x, 'reg:' + r.key); }).join('');
                body = grid(blocks + '<div class="vd-add" style="min-height:40px;" onclick="event.stopPropagation();VD.addField(\'reg:' + q(r.key) + '\')"><i class="fas fa-plus"></i>&nbsp;Field</div>', isM ? cols : (r.columns || parentCols), 'reg:' + r.key);
            }
            return '<div class="vd-reg ' + (sel && sel.kind === 'region' && sel.i === ri ? 'vd-seld' : '') + '"' +
                ' onclick="event.stopPropagation();VD.sel(\'region\',' + ri + ')"' +
                (r.display !== 'multi' ? ' ondragover="event.preventDefault();this.classList.add(\'vd-drop\')" ondragleave="this.classList.remove(\'vd-drop\')" ondrop="VD.dropInto(event,\'reg:' + q(r.key) + '\',-1,\'' + dev + '\')"' : '') + '>' +
                '<div class="vd-reg-h"><i class="fas fa-database"></i> ' + esc(r.title || r.key) +
                ' <span style="font-weight:400;color:#94a3b8;">· ' + (r.display === 'multi' ? 'multi row' : 'single row') + (r.sourceSql ? ' · SQL' : '') + '</span></div>' +
                body + '</div>';
        }

        var looseBlocks = tabFields.filter(function (x) {
            return !(x.f.region && regKeys.indexOf(x.f.region) >= 0) && (!x.f.section || secKeys.indexOf(x.f.section) < 0);
        }).map(function (x) { return fieldBlock(x, 'main'); }).join('');

        var tabHtml = '';
        if (tabs.length || !isM) {
            tabHtml = '<div class="vd-tabbar">' +
                tabs.map(function (t) {
                    return '<div class="vd-tab ' + (t === act ? 'on' : '') + (sel && sel.kind === 'htab' && sel.name === t ? ' vd-seld' : '') + '"' +
                        ' onclick="VD.selTab(\'' + q(esc(t)) + '\')"' +
                        ' ondragover="event.preventDefault();this.classList.add(\'vd-drop\')" ondragleave="this.classList.remove(\'vd-drop\')"' +
                        ' ondrop="VD.dropOnTab(event,\'' + q(esc(t)) + '\')">' + esc(t) + '</div>';
                }).join('') +
                (isM ? '' : '<div class="vd-tab" style="background:none;border:1.5px dashed #94d8d0;color:#0f766e;" onclick="VD.addTab()"><i class="fas fa-plus"></i> Tab</div>') +
                '</div>';
        }

        var secsHtml = (def.sections || []).map(function (s, si) {
            if (tabs.length && (s.tab || 'Main') !== act) return '';
            var stl = s.style || {};
            var secBlocks = tabFields.filter(function (x) { return x.f.section === s.key && !(x.f.region && regKeys.indexOf(x.f.region) >= 0); })
                .map(function (x) { return fieldBlock(x, 'sec:' + s.key); }).join('');
            var sregs = regions().map(function (r, ri) { return r.section === s.key ? regionBox(r, ri, s.columns || cols) : ''; }).join('');
            var head = s.display === 'plain' ? '' :
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">' +
                '<div style="font-size:' + (stl.fontSize || 11) + 'px;font-weight:800;color:' + esc(stl.headingColor || '#0f766e') + ';">' + esc(s.title || s.key) + '</div>' +
                '<div style="flex:1;height:2px;background:' + esc(stl.lineColor || '#e2e8f0') + ';"></div></div>';
            return '<div class="vd-sec ' + (sel && sel.kind === 'section' && sel.i === si ? 'vd-seld' : '') + '"' +
                ' style="background:' + esc(stl.background || (s.display === 'card' ? '#f8fafc' : 'transparent')) + ';"' +
                ' onclick="VD.sel(\'section\',' + si + ')"' +
                ' ondragover="event.preventDefault();this.classList.add(\'vd-drop\')" ondragleave="this.classList.remove(\'vd-drop\')"' +
                ' ondrop="VD.dropInto(event,\'sec:' + q(s.key) + '\',-1,\'' + dev + '\')">' +
                head +
                grid(secBlocks + '<div class="vd-add" style="min-height:40px;" onclick="event.stopPropagation();VD.addField(\'sec:' + q(s.key) + '\')"><i class="fas fa-plus"></i>&nbsp;Field</div>', isM ? cols : (s.columns || cols), 'sec:' + s.key) +
                sregs +
                '<div style="text-align:right;margin-top:6px;"><button class="btn btn-o" style="padding:2px 9px;font-size:9.5px;" onclick="event.stopPropagation();VD.addRegionTo(\'' + q(s.key) + '\')"><i class="fas fa-plus"></i> Region</button></div>' +
                '</div>';
        }).join('');

        var looseRegsHtml = regions().map(function (r, ri) {
            if (r.section && secKeys.indexOf(r.section) >= 0) return '';
            if (tabs.length && (r.tab || 'Main') !== act) return '';
            return regionBox(r, ri, cols);
        }).join('');

        var detHtml = (def.details || []).map(function (det, di) {
            if (det.region && regKeys.indexOf(det.region) >= 0) return '';   // rendered inside its region
            return '<div class="vd-det ' + (sel && sel.kind === 'detail' && sel.di === di ? 'vd-seld' : '') + '">' +
                '<div class="vd-det-h" onclick="VD.sel(\'detail\',null,' + di + ')">' +
                  '<span><i class="fas fa-table-list"></i> ' + esc(det.title || det.key) + (det.tab ? ' <span style="font-weight:400;color:#94a3b8;">· tab: ' + esc(det.tab) + '</span>' : '') + '</span>' +
                  '<span style="font-size:9px;color:#94a3b8;">' + ((det.columns || []).length) + ' col(s)</span></div>' +
                '<div style="padding:4px 8px 8px;">' + detChips(det, di) + '</div></div>';
        }).join('');

        var repHtml = (def.reports || []).map(function (r, ri) {
            return '<div class="vd-rep ' + (sel && sel.kind === 'report' && sel.i === ri ? 'vd-seld' : '') + '" onclick="VD.sel(\'report\',' + ri + ')">' +
                '<i class="fas fa-chart-simple"></i> Report: ' + esc(r.title || r.key) + (r.autoRun ? ' · auto-run' : '') + '</div>';
        }).join('');

        var actsHtml = '<div class="vd-acts">' +
            (def.actions || []).map(function (a, i) {
                var styles = { primary: 'background:#16a34a;color:white;', danger: 'background:#dc2626;color:white;', default: 'background:white;color:#334155;border-color:#e2e8f0;border-style:solid;' };
                return '<div class="vd-act ' + (sel && sel.kind === 'action' && sel.i === i ? 'vd-seld' : '') + '" style="' + (styles[a.style] || styles.default) + '" onclick="VD.sel(\'action\',' + i + ')">' +
                    (a.icon ? '<i class="fas fa-' + esc(a.icon) + '"></i> ' : '') + esc(a.label || a.key) + '</div>';
            }).join('') +
            '<div class="vd-act" style="border:1.5px dashed #94d8d0;color:#0f766e;" onclick="VD.addAction()"><i class="fas fa-plus"></i> Button</div>' +
            '</div>';

        var sbItems = (def.sidebar && def.sidebar.items) || [];
        var sideHtml = '<div class="vd-side">' +
            sbItems.map(function (it, i) {
                return '<div class="vd-sideit ' + (sel && sel.kind === 'sideitem' && sel.i === i ? 'vd-seld' : '') + '" title="' + esc(it.label || '') + '" onclick="VD.sel(\'sideitem\',' + i + ')"><i class="fas fa-' + esc(it.icon || 'circle') + '"></i></div>';
            }).join('') +
            '<div class="vd-sideit" style="border-color:#94d8d0;" onclick="VD.addSideItem()"><i class="fas fa-plus"></i></div>' +
            '</div>';

        return '<div class="vd-form" style="width:' + width + 'px;' + (def.height && !isM ? 'min-height:' + def.height + 'px;' : '') + '">' +
              '<div style="flex:1;display:flex;flex-direction:column;min-width:0;">' +
                '<div class="vd-title ' + (sel && sel.kind === 'form' ? 'vd-seld' : '') + '" onclick="VD.sel(\'form\')"><i class="fas fa-' + esc(def.icon || 'wpforms') + '"></i> ' + esc(def.title || 'Form') +
                (def.wizard ? ' <span style="font-size:9px;background:rgba(255,255,255,0.25);padding:1px 7px;border-radius:8px;">WIZARD</span>' : '') +
                (isM ? ' <span style="font-size:9px;background:rgba(255,255,255,0.25);padding:1px 7px;border-radius:8px;">MOBILE</span>' : '') + '</div>' +
                '<div class="vd-body">' + tabHtml +
                  grid(looseBlocks + '<div class="vd-add" onclick="VD.addField(\'main\')"><i class="fas fa-plus"></i>&nbsp;Field</div>', cols, 'main') +
                  secsHtml +
                  looseRegsHtml +
                  '<div style="display:flex;gap:8px;margin-top:10px;">' +
                    '<div class="vd-add" style="flex:1;padding:7px;" onclick="VD.addSectionV()"><i class="fas fa-plus"></i>&nbsp;Section</div>' +
                    '<div class="vd-add" style="flex:1;padding:7px;" onclick="VD.addRegionTo(null)"><i class="fas fa-plus"></i>&nbsp;Region</div>' +
                    '<div class="vd-add" style="flex:1;padding:7px;" onclick="VD.addDetail()"><i class="fas fa-plus"></i>&nbsp;Detail grid</div>' +
                  '</div>' +
                  detHtml + repHtml +
                '</div>' + actsHtml +
              '</div>' + sideHtml +
              (isM ? '' : '<div class="vd-resize" onmousedown="VD.resizeStart(event)"><i class="fas fa-up-right-and-down-left-from-center" style="transform:rotate(90deg);"></i></div>') +
            '</div>';
    }

    // ── selection + inspector ───────────────────────────────
    VD.sel = function (kind, i, di, ci) {
        sel = { kind: kind, i: i, di: di, ci: ci };
        VD.canvas(); VD.insp();
    };
    VD.selTab = function (t) {
        VD._hTab = t;
        sel = { kind: 'htab', name: t };
        VD.canvas(); VD.insp();
    };
    function selObj() {
        if (!sel) return null;
        if (sel.kind === 'form') return d();
        if (sel.kind === 'section') return (d().sections || [])[sel.i];
        if (sel.kind === 'region') return regions()[sel.i];
        if (sel.kind === 'field') return fields()[sel.i];
        if (sel.kind === 'detail') return (d().details || [])[sel.di];
        if (sel.kind === 'column') return ((d().details || [])[sel.di].columns || [])[sel.ci];
        if (sel.kind === 'action') return (d().actions || [])[sel.i];
        if (sel.kind === 'sideitem') return ((d().sidebar || {}).items || [])[sel.i];
        if (sel.kind === 'report') return (d().reports || [])[sel.i];
        return null;
    }
    VD.prop = function (key, value) {
        var o = selObj();
        if (!o) return;
        if (value === '' || value === undefined) delete o[key];
        else o[key] = value;
        VD.canvas();
    };
    VD.propNum = function (key, value) { VD.prop(key, value === '' ? '' : Number(value)); };
    VD.propBool = function (key, checked) { var o = selObj(); if (!o) return; if (checked) o[key] = true; else delete o[key]; VD.canvas(); };
    VD.sprop = function (key, value) {
        var o = selObj(); if (!o) return;
        o.style = o.style || {};
        if (value === '' || value === undefined) delete o.style[key];
        else o.style[key] = key === 'fontSize' ? Number(value) : value;
        VD.canvas();
    };

    function iin(label, prop, val, kind) {
        var fn = kind === 'num' ? 'VD.propNum' : 'VD.prop';
        return '<label class="vd-ilbl">' + label + '</label>' +
            '<input class="vd-iin" type="' + (kind === 'num' ? 'number' : 'text') + '" value="' + esc(val === undefined ? '' : val) + '" onchange="' + fn + '(\'' + prop + '\', this.value)">';
    }
    function ichk(label, prop, val) {
        return '<label style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:7px;cursor:pointer;">' +
            '<input type="checkbox"' + (val ? ' checked' : '') + ' onchange="VD.propBool(\'' + prop + '\', this.checked)"> ' + label + '</label>';
    }
    function isel(label, prop, val, opts) {
        return '<label class="vd-ilbl">' + label + '</label>' +
            '<select class="vd-iin" onchange="VD.prop(\'' + prop + '\', this.value)">' +
            opts.map(function (o) { return '<option value="' + o + '"' + (o === String(val || '') ? ' selected' : '') + '>' + (o || '(none)') + '</option>'; }).join('') + '</select>';
    }

    function swHtml(o) {
        var rows = [];
        var sw = o.showWhen ? (Array.isArray(o.showWhen) ? o.showWhen : [o.showWhen]) : [];
        var fkeys = fields().map(function (f) { return f.key; });
        var ops = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'empty', 'notEmpty'];
        sw.forEach(function (c, i) {
            rows.push('<div class="vd-swrow">' +
                '<select class="vd-iin" style="flex:1;" onchange="VD.swSet(' + i + ',\'field\',this.value)">' +
                fkeys.map(function (k) { return '<option' + (k === c.field ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>' +
                '<select class="vd-iin" style="width:74px;" onchange="VD.swSet(' + i + ',\'op\',this.value)">' +
                ops.map(function (op) { return '<option' + (op === (c.op || 'eq') ? ' selected' : '') + '>' + op + '</option>'; }).join('') + '</select>' +
                '<input class="vd-iin" style="flex:1;" value="' + esc(c.value === undefined ? '' : c.value) + '" onchange="VD.swSet(' + i + ',\'value\',this.value)">' +
                '<i class="fas fa-times" style="cursor:pointer;color:#f87171;font-size:10px;" onclick="VD.swDel(' + i + ')"></i></div>');
        });
        return '<label class="vd-ilbl" style="margin-top:12px;">Show only when <span style="color:#94a3b8;font-weight:400;">(all must match)</span></label>' +
            rows.join('') +
            '<button class="btn btn-o" style="padding:2px 9px;font-size:10px;margin-top:5px;" onclick="VD.swAdd()"><i class="fas fa-plus"></i> Condition</button>';
    }
    VD.swAdd = function () {
        var o = selObj(); if (!o) return;
        var sw = o.showWhen ? (Array.isArray(o.showWhen) ? o.showWhen : [o.showWhen]) : [];
        sw.push({ field: (fields()[0] || {}).key || '', op: 'eq', value: '' });
        o.showWhen = sw;
        VD.canvas(); VD.insp();
    };
    VD.swSet = function (i, part, value) {
        var o = selObj(); if (!o || !o.showWhen) return;
        var sw = Array.isArray(o.showWhen) ? o.showWhen : [o.showWhen];
        sw[i][part] = value;
        o.showWhen = sw;
        VD.canvas();
    };
    VD.swDel = function (i) {
        var o = selObj(); if (!o) return;
        var sw = Array.isArray(o.showWhen) ? o.showWhen : [o.showWhen];
        sw.splice(i, 1);
        if (sw.length) o.showWhen = sw; else delete o.showWhen;
        VD.canvas(); VD.insp();
    };

    VD.insp = function () {
        var box = document.getElementById('vd-insp');
        if (!box) return;
        var h = '';
        var head = function (t, del) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:800;color:#0f766e;">' + t + '</div>' +
                (del ? '<button class="btn btn-d" style="padding:2px 8px;font-size:10px;" onclick="' + del + '"><i class="fas fa-trash"></i></button>' : '') + '</div>';
        };
        if (!sel) {
            h = '<div style="font-size:11px;color:#94a3b8;padding:8px 0;">Click any element on the canvas — the form title, a field, a tab, a section, a region, a grid column, a button, a side icon — to edit it here.</div>';
        } else if (sel.kind === 'form') {
            var def = d();
            h = head('<i class="fas fa-window-maximize"></i> Form') +
                iin('Title', 'title', def.title) + iin('Icon (fa)', 'icon', def.icon) +
                iin('Width px', 'width', def.width, 'num') + iin('Height px', 'height', def.height, 'num') +
                '<label class="vd-ilbl">Header columns</label><input class="vd-iin" type="number" value="' + esc((def.header && def.header.columns) || 4) + '" onchange="VD.hcols(this.value)">' +
                '<label class="vd-ilbl">Mobile columns</label><input class="vd-iin" type="number" value="' + esc((def.mobile && def.mobile.columns) || 1) + '" onchange="VD.mobCols(this.value)">' +
                ichk('Wizard (tabs become steps)', 'wizard', def.wizard) +
                '<label class="vd-ilbl" style="margin-top:10px;">Form style</label>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">' +
                '<input class="vd-iin" placeholder="font family" value="' + esc((def.style || {}).font || '') + '" onchange="VD.sprop(\'font\', this.value)">' +
                '<input class="vd-iin" placeholder="background" value="' + esc((def.style || {}).background || '') + '" onchange="VD.sprop(\'background\', this.value)">' +
                '<input class="vd-iin" placeholder="title bar color" value="' + esc((def.style || {}).accent || '') + '" onchange="VD.sprop(\'accent\', this.value)">' +
                '</div>';
        } else if (sel.kind === 'field') {
            var f = fields()[sel.i];
            if (!f) { h = ''; } else {
                h = head('<i class="fas fa-i-cursor"></i> Field — ' + esc(f.key), 'VD.delField(' + sel.i + ')') +
                    iin('Key', 'key', f.key) + iin('Label', 'label', f.label) +
                    isel('Type', 'type', f.type || 'text', FIELD_TYPES) +
                    iin('Default', 'default', f.default) +
                    iin('Span (columns)', 'span', f.span, 'num') +
                    iin('Tab page', 'tab', f.tab) +
                    isel('Region (data block)', 'region', f.region, [''].concat(regions().map(function (r) { return r.key; }))) +
                    isel('Section (styled group)', 'section', f.section, [''].concat((d().sections || []).map(function (s) { return s.key; }))) +
                    ichk('Required', 'required', f.required) +
                    swHtml(f) +
                    '<button class="btn btn-o" style="margin-top:12px;width:100%;" onclick="VD.openFull(' + sel.i + ')"><i class="fas fa-pen-ruler"></i> SQL &amp; advanced (Designer tab)</button>';
            }
        } else if (sel.kind === 'section') {
            var s = (d().sections || [])[sel.i];
            var stl2 = (s && s.style) || {};
            h = head('<i class="fas fa-layer-group"></i> Section — ' + esc(s.key), 'VD.delSectionV(' + sel.i + ')') +
                iin('Key', 'key', s.key) + iin('Heading', 'title', s.title) +
                iin('Tab page', 'tab', s.tab) +
                isel('Display', 'display', s.display || 'inline', ['inline', 'card', 'plain']) +
                iin('Columns', 'columns', s.columns, 'num') +
                '<label class="vd-ilbl" style="margin-top:10px;">Style</label>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">' +
                '<input class="vd-iin" placeholder="heading color" value="' + esc(stl2.headingColor || '') + '" onchange="VD.sprop(\'headingColor\', this.value)">' +
                '<input class="vd-iin" placeholder="line color" value="' + esc(stl2.lineColor || '') + '" onchange="VD.sprop(\'lineColor\', this.value)">' +
                '<input class="vd-iin" placeholder="background" value="' + esc(stl2.background || '') + '" onchange="VD.sprop(\'background\', this.value)">' +
                '<input class="vd-iin" placeholder="font family" value="' + esc(stl2.font || '') + '" onchange="VD.sprop(\'font\', this.value)">' +
                '<input class="vd-iin" type="number" placeholder="heading px" value="' + esc(stl2.fontSize || '') + '" onchange="VD.sprop(\'fontSize\', this.value)">' +
                '</div>' +
                swHtml(s) +
                '<button class="btn btn-o" style="margin-top:12px;width:100%;" onclick="VD.addRegionTo(\'' + q(s.key) + '\')"><i class="fas fa-plus"></i> Add region in this section</button>';
        } else if (sel.kind === 'region') {
            var r = regions()[sel.i];
            h = head('<i class="fas fa-database"></i> Region — ' + esc(r.key), 'VD.delRegionV(' + sel.i + ')') +
                iin('Key', 'key', r.key) + iin('Title', 'title', r.title) +
                isel('Inside section', 'section', r.section, [''].concat((d().sections || []).map(function (s) { return s.key; }))) +
                isel('Display', 'display', r.display || 'single', ['single', 'multi']) +
                iin('Columns (single)', 'columns', r.columns, 'num') +
                iin('Tab page (top level)', 'tab', r.tab) +
                ichk('Fetch record on open', 'fetchOnOpen', r.fetchOnOpen) +
                swHtml(r) +
                (r.sourceSql
                    ? '<button class="btn btn-p" style="margin-top:12px;width:100%;" onclick="VD.genRegion(' + sel.i + ')"><i class="fas fa-wand-magic-sparkles"></i> Generate from SQL</button>'
                    : '<div style="font-size:9.5px;color:#94a3b8;margin-top:10px;">Set the Source SQL in the Designer tab, then Generate creates the fields (single row) or the grid columns (multi row).</div>');
        } else if (sel.kind === 'htab') {
            h = head('<i class="fas fa-folder"></i> Tab page — ' + esc(sel.name)) +
                '<label class="vd-ilbl">Rename tab</label><input class="vd-iin" value="' + esc(sel.name) + '" onchange="VD.renameTab(this.value)">' +
                '<button class="btn btn-d" style="margin-top:10px;width:100%;" onclick="VD.delTab()"><i class="fas fa-trash"></i> Remove tab (items go to Main)</button>' +
                '<div style="font-size:9.5px;color:#94a3b8;margin-top:8px;">Drag any field block onto a tab name to move it there.</div>';
        } else if (sel.kind === 'detail') {
            var det = (d().details || [])[sel.di];
            h = head('<i class="fas fa-table-list"></i> Detail — ' + esc(det.key), 'VD.delDetail(' + sel.di + ')') +
                iin('Key', 'key', det.key) + iin('Title', 'title', det.title) +
                iin('Tab page', 'tab', det.tab) +
                isel('Region', 'region', det.region, [''].concat(regions().map(function (r) { return r.key; }))) +
                isel('Section', 'section', det.section, [''].concat((d().sections || []).map(function (s) { return s.key; }))) +
                iin('Qty column key', 'qtyKey', det.qtyKey) +
                ichk('Manual rows', 'allowManualRow', det.allowManualRow) +
                ichk('Required (≥ 1 row)', 'required', det.required) +
                swHtml(det) +
                '<div style="font-size:9.5px;color:#94a3b8;margin-top:8px;">Picker SQL, source SQL, line rules and totals live in the Designer tab.</div>';
        } else if (sel.kind === 'column') {
            var c = ((d().details || [])[sel.di].columns || [])[sel.ci];
            h = head('<i class="fas fa-table-columns"></i> Column — ' + esc(c.key), 'VD.delColumn(' + sel.di + ',' + sel.ci + ')') +
                iin('Key', 'key', c.key) + iin('Label', 'label', c.label) +
                isel('Type', 'type', c.type || 'text', COL_TYPES) +
                ichk('Editable', 'editable', c.editable) +
                iin('Width px', 'width', c.width, 'num') + iin('Default', 'default', c.default) +
                iin('Formula (computed)', 'formula', c.formula) +
                '<div style="font-size:9.5px;color:#94a3b8;margin-top:8px;">Lookup SQL in the Designer tab.</div>';
        } else if (sel.kind === 'action') {
            var a = (d().actions || [])[sel.i];
            h = head('<i class="fas fa-hand-pointer"></i> Button — ' + esc(a.label || a.key), 'VD.delAction(' + sel.i + ')') +
                iin('Key', 'key', a.key) + iin('Label', 'label', a.label) + iin('Icon (fa)', 'icon', a.icon) +
                isel('Style', 'style', a.style || 'default', ACTION_STYLES) +
                isel('Action type', 'type', a.type || 'ords', ACTION_TYPES) +
                ichk('Validate first', 'validate', a.validate) +
                iin('Confirm text', 'confirm', a.confirm) +
                swHtml(a) +
                '<div style="font-size:9.5px;color:#94a3b8;margin-top:8px;">URL / body / SQL / file settings in the Designer tab.</div>';
        } else if (sel.kind === 'sideitem') {
            var it = ((d().sidebar || {}).items || [])[sel.i];
            var sbp = (d().sidebar || {}).position || 'right';
            h = head('<i class="fas fa-grip-vertical"></i> Side button', 'VD.delSideItem(' + sel.i + ')') +
                iin('Icon (fa)', 'icon', it.icon) + iin('Tooltip', 'label', it.label) +
                isel('Runs action (key)', 'action', it.action, (d().actions || []).map(function (a) { return a.key; })) +
                '<label class="vd-ilbl">Panel position</label>' +
                '<select class="vd-iin" onchange="VD.sbPos(this.value)">' +
                ['right', 'left'].map(function (o) { return '<option' + (o === sbp ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>';
        } else if (sel.kind === 'report') {
            var rp = (d().reports || [])[sel.i];
            h = head('<i class="fas fa-chart-simple"></i> Report — ' + esc(rp.key), 'VD.delReport(' + sel.i + ')') +
                iin('Key', 'key', rp.key) + iin('Title', 'title', rp.title) +
                ichk('Auto-run on open', 'autoRun', rp.autoRun) +
                swHtml(rp) +
                '<div style="font-size:9.5px;color:#94a3b8;margin-top:8px;">Report SQL (with Test SQL) in the Designer tab.</div>';
        }
        box.innerHTML = h;
    };

    // ── drag & drop ─────────────────────────────────────────
    VD.dragStart = function (ev, kind, i, di) {
        drag = { kind: kind, i: i, di: di };
        ev.dataTransfer.effectAllowed = 'move';
    };
    // container: 'main' | 'sec:<key>' | 'reg:<key>'
    VD.dropInto = function (ev, container, targetI, dev) {
        ev.preventDefault(); ev.stopPropagation();
        document.querySelectorAll('.vd-drop').forEach(function (el) { el.classList.remove('vd-drop'); });
        if (!drag || drag.kind !== 'field') { drag = null; return; }
        var moved = fields()[drag.i];
        if (!moved) { drag = null; return; }
        if (container && container.indexOf('reg:') === 0) {
            moved.region = container.slice(4);
            delete moved.section;
        } else if (container && container.indexOf('sec:') === 0) {
            moved.section = container.slice(4);
            delete moved.region;
        } else {
            delete moved.section; delete moved.region;
        }
        if (dev === 'mobile') {
            var keys = orderedFields('mobile').map(function (x) { return x.f.key; });
            keys.splice(keys.indexOf(moved.key), 1);
            var at = targetI < 0 ? keys.length : keys.indexOf(fields()[targetI].key);
            if (at < 0) at = keys.length;
            keys.splice(at, 0, moved.key);
            mob().order = keys;
        } else {
            var arr = fields();
            var targetObj = targetI >= 0 ? arr[targetI] : null;
            arr.splice(drag.i, 1);
            var at2 = targetObj ? arr.indexOf(targetObj) : arr.length;
            if (at2 < 0) at2 = arr.length;
            arr.splice(at2, 0, moved);
            if (sel && sel.kind === 'field') sel.i = arr.indexOf(moved);
        }
        drag = null;
        VD.canvas(); VD.insp();
    };
    VD.dropOnTab = function (ev, tab) {
        ev.preventDefault();
        document.querySelectorAll('.vd-drop').forEach(function (el) { el.classList.remove('vd-drop'); });
        if (!drag || drag.kind !== 'field') return;
        var f = fields()[drag.i];
        if (tab === 'Main') delete f.tab; else f.tab = tab;
        drag = null;
        VD.canvas();
    };
    VD.dropOnColumn = function (ev, di, ci) {
        ev.preventDefault(); ev.stopPropagation();
        document.querySelectorAll('.vd-drop').forEach(function (el) { el.classList.remove('vd-drop'); });
        if (!drag || drag.kind !== 'column' || drag.di !== di) { drag = null; return; }
        var cols = (d().details || [])[di].columns;
        var c = cols.splice(drag.i, 1)[0];
        cols.splice(ci > drag.i ? ci - 1 : ci, 0, c);
        drag = null;
        VD.canvas();
    };

    // ── add / delete ────────────────────────────────────────
    VD.addField = function (container) {
        var t = curHTab();
        var f = { key: 'field' + (fields().length + 1), label: 'New field', type: 'text' };
        if (t && t !== 'Main') f.tab = t;
        if (container && container.indexOf('sec:') === 0) f.section = container.slice(4);
        if (container && container.indexOf('reg:') === 0) f.region = container.slice(4);
        fields().push(f);
        sel = { kind: 'field', i: fields().length - 1 };
        VD.canvas(); VD.insp();
    };
    VD.delField = function (i) { fields().splice(i, 1); sel = null; VD.canvas(); VD.insp(); };
    VD.addSectionV = function () {
        var secs = (d().sections = d().sections || []);
        secs.push({ key: 'section' + (secs.length + 1), title: 'New Section', display: 'inline', style: {} });
        var t = curHTab();
        if (t && t !== 'Main') secs[secs.length - 1].tab = t;
        sel = { kind: 'section', i: secs.length - 1 };
        VD.canvas(); VD.insp();
    };
    VD.delSectionV = function (i) {
        var s = d().sections[i];
        d().sections.splice(i, 1);
        if (s) {
            fields().forEach(function (f) { if (f.section === s.key) delete f.section; });
            (d().details || []).forEach(function (dd) { if (dd.section === s.key) delete dd.section; });
            regions().forEach(function (r) { if (r.section === s.key) delete r.section; });
        }
        sel = null; VD.canvas(); VD.insp();
    };
    VD.addRegionTo = function (secKey) {
        var regs = (d().regions = d().regions || []);
        var r = { key: 'region' + (regs.length + 1), title: 'New Region', display: 'single' };
        if (secKey) r.section = secKey;
        else {
            var t = curHTab();
            if (t && t !== 'Main') r.tab = t;
        }
        regs.push(r);
        sel = { kind: 'region', i: regs.length - 1 };
        VD.canvas(); VD.insp();
    };
    VD.delRegionV = function (i) {
        var r = regions()[i];
        d().regions.splice(i, 1);
        if (r) {
            fields().forEach(function (f) { if (f.region === r.key) delete f.region; });
            (d().details || []).forEach(function (dd) { if (dd.region === r.key) delete dd.region; });
        }
        sel = null; VD.canvas(); VD.insp();
    };
    VD.genRegion = function (i) {
        if (typeof generateRegion === 'function') generateRegion(i);
    };
    VD.addTab = function () {
        var name = prompt('Tab page name:');
        if (!name || !name.trim()) return;
        name = name.trim();
        if (extraTabs.indexOf(name) < 0) extraTabs.push(name);
        VD._hTab = name;
        sel = { kind: 'htab', name: name };
        VD.canvas(); VD.insp();
    };
    VD.renameTab = function (newName) {
        if (!sel || sel.kind !== 'htab' || !newName.trim()) return;
        var old = sel.name;
        newName = newName.trim();
        fields().forEach(function (f) { if ((f.tab || 'Main') === old) { if (newName === 'Main') delete f.tab; else f.tab = newName; } });
        (d().details || []).forEach(function (dd) { if (dd.tab === old) dd.tab = newName; });
        (d().sections || []).forEach(function (s) { if (s.tab === old) s.tab = newName; });
        regions().forEach(function (r) { if (r.tab === old) r.tab = newName; });
        var xi = extraTabs.indexOf(old);
        if (xi >= 0) extraTabs[xi] = newName;
        sel.name = newName; VD._hTab = newName;
        VD.canvas(); VD.insp();
    };
    VD.delTab = function () {
        if (!sel || sel.kind !== 'htab') return;
        var t = sel.name;
        fields().forEach(function (f) { if (f.tab === t) delete f.tab; });
        (d().details || []).forEach(function (dd) { if (dd.tab === t) delete dd.tab; });
        (d().sections || []).forEach(function (s) { if (s.tab === t) delete s.tab; });
        regions().forEach(function (r) { if (r.tab === t) delete r.tab; });
        extraTabs = extraTabs.filter(function (x) { return x !== t; });
        sel = null; VD._hTab = null;
        VD.canvas(); VD.insp();
    };
    VD.addDetail = function () {
        (d().details = d().details || []).push({ key: 'lines' + (d().details.length || ''), title: 'New grid', allowManualRow: true, allowDelete: true, qtyKey: 'qty', columns: [], totals: [] });
        sel = { kind: 'detail', di: d().details.length - 1 };
        VD.canvas(); VD.insp();
    };
    VD.delDetail = function (di) { d().details.splice(di, 1); sel = null; VD.canvas(); VD.insp(); };
    VD.addColumn = function (di) {
        var cols = (d().details[di].columns = d().details[di].columns || []);
        cols.push({ key: 'col' + (cols.length + 1), label: 'New col', type: 'text', editable: true });
        sel = { kind: 'column', di: di, ci: cols.length - 1 };
        VD.canvas(); VD.insp();
    };
    VD.delColumn = function (di, ci) { d().details[di].columns.splice(ci, 1); sel = null; VD.canvas(); VD.insp(); };
    VD.addAction = function () {
        (d().actions = d().actions || []).push({ key: 'action' + (d().actions.length + 1), label: 'New Button', type: 'ords', style: 'default', method: 'POST' });
        sel = { kind: 'action', i: d().actions.length - 1 };
        VD.canvas(); VD.insp();
    };
    VD.delAction = function (i) { d().actions.splice(i, 1); sel = null; VD.canvas(); VD.insp(); };
    VD.addSideItem = function () {
        var sb = (d().sidebar = d().sidebar || { position: 'right', items: [] });
        sb.items.push({ icon: 'star', label: 'New button', action: ((d().actions || [])[0] || {}).key || '' });
        sel = { kind: 'sideitem', i: sb.items.length - 1 };
        VD.canvas(); VD.insp();
    };
    VD.delSideItem = function (i) {
        d().sidebar.items.splice(i, 1);
        if (!d().sidebar.items.length) delete d().sidebar;
        sel = null; VD.canvas(); VD.insp();
    };
    VD.delReport = function (i) { d().reports.splice(i, 1); sel = null; VD.canvas(); VD.insp(); };
    VD.sbPos = function (v) { if (d().sidebar) d().sidebar.position = v; VD.canvas(); };

    // ── misc ────────────────────────────────────────────────
    VD.dev = function (dv) { device = dv; sel = null; VD.render(); };
    VD.hcols = function (v) { (d().header = d().header || {}).columns = Number(v) || 4; VD.canvas(); };
    VD.mobCols = function (v) { mob().columns = Number(v) || 1; VD.canvas(); };
    VD.toggleHidden = function (key) {
        var hid = mob().hidden = mob().hidden || [];
        var i = hid.indexOf(key);
        if (i >= 0) hid.splice(i, 1); else hid.push(key);
        VD.canvas();
    };
    VD.openFull = function (i) {
        pageTab = 'design';
        renderEditor();
        setTimeout(function () {
            var tr = document.getElementById('fld-adv-' + i);
            if (tr) { tr.hidden = false; tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }, 60);
    };
    VD.resizeStart = function (ev) {
        ev.preventDefault();
        var startX = ev.clientX, startY = ev.clientY;
        var def = d();
        var w0 = def.width || 950, h0 = def.height || 0;
        var frame = ev.target.closest('.vd-form');
        function mv(e) {
            def.width = Math.max(420, Math.round(w0 + (e.clientX - startX)));
            if (h0 || e.clientY - startY > 24) def.height = Math.max(300, Math.round((h0 || 500) + (e.clientY - startY)));
            if (frame) {
                frame.style.width = def.width + 'px';
                if (def.height) frame.style.minHeight = def.height + 'px';
            }
        }
        function up() {
            document.removeEventListener('mousemove', mv);
            document.removeEventListener('mouseup', up);
            VD.canvas();
            if (sel && sel.kind === 'form') VD.insp();
        }
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
    };

    window.renderVisualTab = function () { sel = null; VD.render(); };
})();
