// ============================================================
// WMS FORM ENGINE - renders and executes DB-stored form definitions
// ============================================================
// A form is ONE JSON document (WMS_AI_FORMS.definition). The engine
// renders it and executes its actions - no code per form.
//
// Definition contract:
// {
//   "title": "Sales Order", "icon": "file-invoice", "width": 1050,
//   "header": { "columns": 4, "fields": [
//     { "key","label","type": "text|number|date|textarea|checkbox|select|picker|readonly|computed",
//       "default": "value | $TODAY | $USER", "required": true, "span": 2,
//       "min","max","pattern","hint",
//       select:  "listSql" (aliases VALUE,LABEL - or 1st/2nd column; may
//                reference other header fields as :FIELDKEY -> the list
//                reloads when that field changes = DEPENDENT LIST)
//       picker:  "pickerSql" (:SEARCH placeholder), "display" (column
//                shown in the field), "map": { headerKey: COLUMN }
//       computed:"formula" e.g. "qty_total * 1.15" over header keys } ] },
//   "details": [ { "key": "lines", "title": "Order Lines",
//     "pickerSql": ":SEARCH + header :FIELDKEY placeholders",
//     "pickerMap": { columnKey: SQLCOLUMN },   // fills new rows
//     "allowManualRow": true, "allowDelete": true, "qtyKey": "qty",
//     "columns": [ { "key","label","type":"text|number|computed",
//                    "editable": true, "formula": "qty*price", "width" } ],
//     "totals": ["qty","net"],
//     "lineRulesSql": ":KEYCOL + header placeholders -> companion rows
//                     (aliases = column keys; BUY_QTY/GET_QTY compute the
//                     companion qty from the parent row's qtyKey)" } ],
//   "rules": { "submitChecks": [ { "sql","message","mode":
//              "FAIL_IF_ROWS|FAIL_IF_NO_ROWS" } ] },
//   "actions": [ { "key","label","icon","style":"primary|danger|default",
//     "validate": true, "confirm": "Are you sure?",
//     "type": "ords",       "method","url","bodyTemplate","successMessage"
//     "type": "sql",        "statement" ({key} -> escaped literal)
//     "type": "local_file", "folder","fileName" ("{key}/{TIMESTAMP}" ok)
//     "type": "chat",       "prompt" (sent to the AI with the values)
//     "type": "close" } ]
// }
//
// Placeholders. In ANY SQL: :SEARCH (pickers only) and :FIELDKEY
// (uppercase header key -> quoted literal from the live header). In
// bodyTemplate / url / fileName / prompt / statement: {key} -> header
// value; a string that is EXACTLY "{HEADER}" / "{TOTALS}" / "{<detailKey>}"
// becomes the raw object/array; "{VALUES}" the whole payload;
// {TIMESTAMP} / {FORM_KEY} also available in strings.
//
// API:
//   WMSFormEngine.open(def, opts)      opts: { formKey, values, mode:'run'|'preview',
//                                              chatHandoff(action,payload), onClose() }
//   WMSFormEngine.openByKey(formKey, opts)   loads from WMS_AI_FORMS first
// ============================================================

(function () {
    var DEFAULT_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    function aiBase() { return window.WMS_AI_BASE_URL || DEFAULT_BASE; }

    var st = null;   // current open form state

    // ── helpers ─────────────────────────────────────────────
    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
    function fmt(v) { return num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function sqlLit(v) { return "'" + String(v === undefined || v === null ? '' : v).replace(/'/g, "''") + "'"; }
    function todayIso() { return new Date().toISOString().slice(0, 10); }
    function userName() {
        try { if (typeof appUserName === 'function') return appUserName(); } catch (e) { }
        return localStorage.getItem('wms_user') || 'WMSUSER';
    }

    function runSql(sql, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb('WebView bridge unavailable', null); return; }
        sendMessageToCSharp({
            action: 'executePost', fullUrl: aiBase() + '/executequery',
            body: JSON.stringify({ sql: sql, maxRows: 500, appUser: userName() })
        }, function (err, data) {
            if (err) { cb(String(err), null); return; }
            try {
                var r = typeof data === 'string' ? JSON.parse(data) : data;
                if (!r.success) { cb(r.error || 'query failed', null); return; }
                var cols = r.columns || [];
                cb(null, (r.rows || []).map(function (row) {
                    var o = {};
                    cols.forEach(function (c, i) { o[String(c).toUpperCase()] = row[i]; });
                    return o;
                }));
            } catch (e) { cb(e.message, null); }
        });
    }

    // header-field placeholders in SQL (:FIELDKEY -> quoted literal)
    function bindHeaderSql(sql) {
        var out = String(sql);
        Object.keys(st.values).forEach(function (k) {
            out = out.replace(new RegExp(':' + k.toUpperCase() + '\\b', 'g'), sqlLit(st.values[k]));
        });
        return out;
    }
    function bindSearch(sql, text) {
        return String(sql).replace(/:SEARCH\b/g, "'%" + String(text || '').replace(/'/g, "''").toUpperCase() + "%'");
    }
    // which header fields does this SQL depend on?
    function sqlDeps(sql) {
        var deps = [];
        Object.keys((st && st.values) || {}).forEach(function (k) {
            if (new RegExp(':' + k.toUpperCase() + '\\b').test(String(sql))) deps.push(k);
        });
        return deps;
    }

    // safe-ish arithmetic evaluator for computed fields/columns
    function evalFormula(formula, scope) {
        var f = String(formula || '');
        if (!/^[\w\s+\-*/().,]*$/.test(f)) { console.warn('[FormEngine] formula rejected:', f); return 0; }
        var body = f.replace(/[A-Za-z_]\w*/g, function (id) {
            if (/^\d/.test(id)) return id;
            return '(' + num(scope[id]) + ')';
        });
        try { var v = Function('"use strict"; return (' + body + ');')(); return isNaN(v) ? 0 : v; }
        catch (e) { console.warn('[FormEngine] formula error:', f, e.message); return 0; }
    }

    // ── values / totals ─────────────────────────────────────
    function computeRow(det, row) {
        (det.columns || []).forEach(function (c) {
            if (c.type === 'computed' && c.formula) row[c.key] = evalFormula(c.formula, row);
        });
    }
    function detailTotals(det) {
        var t = {};
        (det.totals || []).forEach(function (k) {
            t[k] = (st.details[det.key] || []).reduce(function (s, r) { return s + num(r[k]); }, 0);
        });
        return t;
    }
    function headerComputed() {
        (st.def.header.fields || []).forEach(function (f) {
            if (f.type === 'computed' && f.formula) st.values[f.key] = evalFormula(f.formula, st.values);
        });
    }
    function buildPayload() {
        captureHeader();
        headerComputed();
        var payload = { header: {}, totals: {} };
        Object.keys(st.values).forEach(function (k) { payload.header[k] = st.values[k]; });
        (st.def.details || []).forEach(function (det) {
            var rows = (st.details[det.key] || []).map(function (r) {
                var o = {};
                (det.columns || []).forEach(function (c) { o[c.key] = r[c.key]; });
                if (r._rule) { o._rule = true; o._rule_ref = r._rule_ref || ''; }
                return o;
            });
            payload[det.key] = rows;
            payload.totals[det.key] = detailTotals(det);
        });
        return payload;
    }

    function captureHeader() {
        (st.def.header.fields || []).forEach(function (f) {
            var el = document.getElementById('fe-h-' + f.key);
            if (!el) return;
            if (f.type === 'checkbox') st.values[f.key] = el.checked ? 'Y' : 'N';
            else st.values[f.key] = el.value;
        });
    }

    // ── template resolution for actions ─────────────────────
    function strSub(s, payload) {
        return String(s)
            .replace(/\{TIMESTAMP\}/g, new Date().toISOString().replace(/[:.]/g, '-'))
            .replace(/\{FORM_KEY\}/g, st.formKey || '')
            .replace(/\{(\w+)\}/g, function (m, k) {
                if (payload.header[k] !== undefined) return String(payload.header[k]);
                return m;
            });
    }
    function resolveTemplate(t, payload) {
        if (t === null || t === undefined) return t;
        if (typeof t === 'string') {
            var exact = t.match(/^\{(\w+)\}$/);
            if (exact) {
                var k = exact[1];
                if (k === 'HEADER') return payload.header;
                if (k === 'TOTALS') return payload.totals;
                if (k === 'VALUES') return payload;
                if (payload[k] !== undefined) return payload[k];          // detail rows
                if (payload.header[k] !== undefined) return payload.header[k];
            }
            return strSub(t, payload);
        }
        if (Array.isArray(t)) return t.map(function (x) { return resolveTemplate(x, payload); });
        if (typeof t === 'object') {
            var o = {};
            Object.keys(t).forEach(function (k) { o[k] = resolveTemplate(t[k], payload); });
            return o;
        }
        return t;
    }

    // ── rendering ───────────────────────────────────────────
    function inputCss() { return 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;outline:none;'; }

    function fieldHtml(f) {
        var v = st.values[f.key];
        var span = f.span ? 'grid-column:span ' + f.span + ';' : '';
        var req = f.required ? ' <span style="color:#dc2626;">*</span>' : '';
        var inner;
        switch (f.type) {
            case 'select':
                // static options array, or rows loaded from listSql
                var list = st.lists[f.key] || (Array.isArray(f.options) ? f.options.map(function (o) {
                    return typeof o === 'object' ? o : { value: o, label: o };
                }) : []);
                inner = '<select id="fe-h-' + f.key + '" data-fkey="' + f.key + '" class="fe-hin" style="' + inputCss() + '">' +
                    '<option value=""></option>' +
                    list.map(function (o) {
                        return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(v) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
                    }).join('') + '</select>';
                break;
            case 'picker':
                inner = '<div style="display:flex;gap:4px;">' +
                    '<input type="text" id="fe-h-' + f.key + '" value="' + esc(v) + '" readonly style="' + inputCss() + 'background:#f8fafc;">' +
                    '<button onclick="WMSFormEngine._pick(\'' + f.key + '\')" style="border:1px solid #e2e8f0;background:#eff6ff;color:#1d4ed8;border-radius:6px;cursor:pointer;padding:0 9px;" title="Search"><i class="fas fa-search"></i></button></div>';
                break;
            case 'textarea':
                inner = '<textarea id="fe-h-' + f.key + '" data-fkey="' + f.key + '" class="fe-hin" style="' + inputCss() + 'min-height:52px;resize:vertical;">' + esc(v) + '</textarea>';
                break;
            case 'checkbox':
                inner = '<label style="display:flex;align-items:center;gap:6px;font-size:12px;padding-top:5px;cursor:pointer;">' +
                    '<input type="checkbox" id="fe-h-' + f.key + '" data-fkey="' + f.key + '" class="fe-hin"' + (v === 'Y' || v === true ? ' checked' : '') + '> ' + esc(f.checkLabel || 'Yes') + '</label>';
                break;
            case 'readonly': case 'computed':
                inner = '<input type="text" id="fe-h-' + f.key + '" value="' + esc(f.type === 'computed' && v !== '' ? fmt(v) : v) + '" readonly style="' + inputCss() + 'background:#f8fafc;">';
                break;
            case 'date':
                inner = '<input type="date" id="fe-h-' + f.key + '" data-fkey="' + f.key + '" class="fe-hin" value="' + esc(v) + '" style="' + inputCss() + '">';
                break;
            case 'number':
                inner = '<input type="number" id="fe-h-' + f.key + '" data-fkey="' + f.key + '" class="fe-hin" value="' + esc(v) + '"' +
                    (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') +
                    ' style="' + inputCss() + 'text-align:right;">';
                break;
            default:
                inner = '<input type="text" id="fe-h-' + f.key + '" data-fkey="' + f.key + '" class="fe-hin" value="' + esc(v) + '" style="' + inputCss() + '">';
        }
        return '<div style="' + span + '"><label style="display:block;font-size:10px;font-weight:700;color:#475569;margin-bottom:2px;">' + esc(f.label || f.key) + req + '</label>' + inner +
            (f.hint ? '<div style="font-size:9px;color:#94a3b8;margin-top:1px;">' + esc(f.hint) + '</div>' : '') + '</div>';
    }

    function detailHtml(det) {
        var rows = st.details[det.key] || [];
        var cols = det.columns || [];
        var t = detailTotals(det);
        var body = rows.map(function (r, ri) {
            return '<tr>' +
                '<td style="padding:4px 6px;text-align:center;color:#94a3b8;">' + (ri + 1) + '</td>' +
                cols.map(function (c) {
                    var val = r[c.key];
                    if (c.editable && c.type !== 'computed')
                        return '<td style="padding:2px;"><input type="' + (c.type === 'number' ? 'number' : 'text') + '" value="' + esc(val) + '" data-det="' + det.key + '" data-ri="' + ri + '" data-ck="' + c.key + '" class="fe-cell" style="width:' + (c.width || 80) + 'px;padding:4px;border:1px solid #e2e8f0;border-radius:5px;font-size:11px;' + (c.type === 'number' ? 'text-align:right;' : '') + '"></td>';
                    var disp = (c.type === 'number' || c.type === 'computed') ? fmt(val) : esc(val);
                    var tag = r._rule && c.key === cols[0].key ? ' <span style="font-size:8.5px;font-weight:800;padding:1px 6px;border-radius:8px;background:#dcfce7;color:#166534;">RULE</span>' : '';
                    return '<td style="padding:4px 6px;' + ((c.type === 'number' || c.type === 'computed') ? 'text-align:right;' : '') + '">' + disp + tag + '</td>';
                }).join('') +
                (det.allowDelete !== false ? '<td style="padding:4px;text-align:center;"><i class="fas fa-trash" onclick="WMSFormEngine._delRow(\'' + det.key + '\',' + ri + ')" style="cursor:pointer;color:#f87171;font-size:11px;"></i></td>' : '<td></td>') +
                '</tr>';
        }).join('');

        return '<div style="margin-top:12px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
              '<div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;">' + esc(det.title || det.key) + ' (' + rows.length + ')</div>' +
              '<div style="display:flex;gap:6px;">' +
              (det.pickerSql ? '<button onclick="WMSFormEngine._pickRows(\'' + det.key + '\')" style="border:none;background:linear-gradient(135deg,#0ea5e9,#0369a1);color:white;border-radius:7px;cursor:pointer;padding:5px 12px;font-size:11px;font-weight:700;"><i class="fas fa-plus"></i> Add…</button>' : '') +
              (det.allowManualRow ? '<button onclick="WMSFormEngine._addRow(\'' + det.key + '\')" style="border:1px solid #e2e8f0;background:white;color:#334155;border-radius:7px;cursor:pointer;padding:5px 12px;font-size:11px;font-weight:700;"><i class="fas fa-plus"></i> Row</button>' : '') +
              '</div></div>' +
            '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:auto;max-height:300px;">' +
              '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
                '<thead><tr style="background:#f8fafc;position:sticky;top:0;"><th style="padding:6px;">#</th>' +
                cols.map(function (c) { return '<th style="padding:6px;text-align:' + ((c.type === 'number' || c.type === 'computed') ? 'right' : 'left') + ';">' + esc(c.label || c.key) + '</th>'; }).join('') +
                '<th></th></tr></thead>' +
                '<tbody id="fe-det-' + det.key + '">' + (body || '<tr><td colspan="' + (cols.length + 2) + '" style="padding:1.2rem;text-align:center;color:#94a3b8;">No rows</td></tr>') + '</tbody>' +
                ((det.totals || []).length ?
                '<tfoot><tr style="background:#f8fafc;font-weight:800;"><td style="padding:5px;"></td>' +
                cols.map(function (c) {
                    return '<td style="padding:5px;text-align:right;color:#0f172a;">' + (det.totals.indexOf(c.key) >= 0 ? fmt(t[c.key]) : '') + '</td>';
                }).join('') + '<td></td></tr></tfoot>' : '') +
              '</table></div></div>';
    }

    function actionsHtml() {
        var styles = {
            primary: 'border:none;background:#16a34a;color:white;',
            danger: 'border:none;background:#dc2626;color:white;',
            default: 'border:1px solid #e2e8f0;background:white;color:#334155;'
        };
        return (st.def.actions || []).map(function (a, i) {
            return '<button id="fe-act-' + i + '" onclick="WMSFormEngine._act(' + i + ')" style="' + (styles[a.style] || styles.default) + 'border-radius:8px;cursor:pointer;padding:7px 16px;font-size:12px;font-weight:800;">' +
                (a.icon ? '<i class="fas fa-' + esc(a.icon) + '"></i> ' : '') + esc(a.label || a.key) + '</button>';
        }).join('');
    }

    // ── tab pages (header + details) ────────────────────────
    function headerTabs() {
        var fields = (st.def.header && st.def.header.fields) || [];
        if (!fields.some(function (f) { return f.tab; })) return [];
        var tabs = [];
        fields.forEach(function (f) { var t = f.tab || 'Main'; if (tabs.indexOf(t) < 0) tabs.push(t); });
        return tabs;
    }
    function detailTabs() {
        var dets = st.def.details || [];
        if (!dets.some(function (d) { return d.tab; })) return [];
        var tabs = [];
        dets.forEach(function (d) { var t = d.tab || 'Main'; if (tabs.indexOf(t) < 0) tabs.push(t); });
        return tabs;
    }
    function tabBarHtml(tabs, active, fn) {
        if (!tabs.length) return '';
        return '<div style="display:flex;gap:4px;border-bottom:2px solid #e2e8f0;margin-bottom:9px;flex-wrap:wrap;">' +
            tabs.map(function (t) {
                var on = t === active;
                return '<div onclick="WMSFormEngine.' + fn + '(\'' + esc(t).replace(/'/g, "\\'") + '\')" style="padding:5px 14px;font-size:11px;font-weight:800;cursor:pointer;border-radius:7px 7px 0 0;' +
                    (on ? 'background:#0f766e;color:white;' : 'background:#f1f5f9;color:#475569;') + '">' + esc(t) + '</div>';
            }).join('') + '</div>';
    }

    // ── reports (query grids with print) ────────────────────
    function reportHtml(r) {
        var data = st.reports[r.key];
        var body;
        if (!data) body = '<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:11px;">Click Refresh to run this report.</div>';
        else if (data.error) body = '<div style="padding:1rem;color:#dc2626;font-size:11px;">' + esc(data.error) + '</div>';
        else if (!data.rows.length) body = '<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:11px;">No data.</div>';
        else {
            var cols = Object.keys(data.rows[0]);
            body = '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
                '<thead><tr style="background:#f8fafc;position:sticky;top:0;">' + cols.map(function (c) { return '<th style="padding:6px;text-align:left;">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                data.rows.map(function (row) {
                    return '<tr style="border-bottom:1px solid #f1f5f9;">' + cols.map(function (c) { return '<td style="padding:5px 6px;">' + esc(row[c]) + '</td>'; }).join('') + '</tr>';
                }).join('') + '</tbody></table>';
        }
        return '<div style="margin-top:12px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
              '<div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;"><i class="fas fa-chart-simple"></i> ' + esc(r.title || r.key) +
              (data && data.rows ? ' (' + data.rows.length + ')' : '') + '</div>' +
              '<div style="display:flex;gap:6px;">' +
                '<button onclick="WMSFormEngine._runReport(\'' + esc(r.key) + '\')" style="border:1px solid #e2e8f0;background:white;color:#334155;border-radius:7px;cursor:pointer;padding:5px 12px;font-size:11px;font-weight:700;"><i class="fas fa-rotate"></i> Refresh</button>' +
                '<button onclick="WMSFormEngine._print(\'' + esc(r.key) + '\')" style="border:1px solid #e2e8f0;background:white;color:#334155;border-radius:7px;cursor:pointer;padding:5px 12px;font-size:11px;font-weight:700;"><i class="fas fa-print"></i> Print</button>' +
              '</div></div>' +
            '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:auto;max-height:320px;">' + body + '</div></div>';
    }
    function runReport(key) {
        var r = (st.def.reports || []).find(function (x) { return x.key === key; });
        if (!r || !r.sql) return;
        captureHeader();
        st.reports[key] = null;
        runSql(bindHeaderSql(r.sql), function (err, rows) {
            if (!st) return;
            st.reports[key] = err ? { error: err, rows: [] } : { rows: rows };
            render();
        });
    }

    // ── printing ────────────────────────────────────────────
    function printableTable(title, rows) {
        if (!rows || !rows.length) return '';
        var cols = Object.keys(rows[0]).filter(function (c) { return c.charAt(0) !== '_'; });
        return '<h3>' + esc(title) + '</h3><table><thead><tr>' +
            cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c]) + '</td>'; }).join('') + '</tr>'; }).join('') +
            '</tbody></table>';
    }
    function buildPrintHtml(scope) {
        var def = st.def;
        var payload = buildPayload();
        var body = '<h2>' + esc(def.title || st.formKey) + '</h2>' +
            '<div class="meta">' + esc(new Date().toLocaleString()) + ' — ' + esc(userName()) + '</div>';
        if (scope === 'form' || !scope) {
            body += '<table class="hdr">' + ((def.header && def.header.fields) || []).map(function (f) {
                return '<tr><th>' + esc(f.label || f.key) + '</th><td>' + esc(payload.header[f.key]) + '</td></tr>';
            }).join('') + '</table>';
            (def.details || []).forEach(function (det) {
                body += printableTable(det.title || det.key, payload[det.key]);
            });
            (def.reports || []).forEach(function (r) {
                var data = st.reports[r.key];
                if (data && data.rows && data.rows.length) body += printableTable(r.title || r.key, data.rows);
            });
        } else {
            var rep = (def.reports || []).find(function (x) { return x.key === scope; });
            var data = st.reports[scope];
            body += printableTable((rep && rep.title) || scope, (data && data.rows) || []);
        }
        return '<html><head><title>' + esc(def.title || 'Form') + '</title><style>' +
            'body{font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#111;margin:24px;}' +
            'h2{margin:0 0 2px;}h3{margin:16px 0 4px;}.meta{color:#666;font-size:10px;margin-bottom:12px;}' +
            'table{border-collapse:collapse;width:100%;margin-bottom:8px;}th,td{border:1px solid #bbb;padding:4px 7px;text-align:left;font-size:11px;}' +
            'th{background:#f0f0f0;}.hdr th{width:180px;}' +
            '</style></head><body>' + body + '</body></html>';
    }
    function doPrint(scope) {
        var html = buildPrintHtml(scope);
        var frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(frame);
        frame.contentDocument.open();
        frame.contentDocument.write(html);
        frame.contentDocument.close();
        setTimeout(function () {
            try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.warn('[FormEngine] print failed:', e); }
            setTimeout(function () { frame.remove(); }, 3000);
        }, 250);
    }

    function render() {
        captureHeader();
        headerComputed();
        var def = st.def;
        var hTabs = headerTabs();
        var hAct = hTabs.length ? (hTabs.indexOf(st.ui.headerTab) >= 0 ? st.ui.headerTab : hTabs[0]) : null;
        var hFields = ((def.header && def.header.fields) || []).filter(function (f) { return !hTabs.length || (f.tab || hTabs[0]) === hAct; });
        var dTabs = detailTabs();
        var dAct = dTabs.length ? (dTabs.indexOf(st.ui.detailTab) >= 0 ? st.ui.detailTab : dTabs[0]) : null;
        var dets = (def.details || []).filter(function (d) { return !dTabs.length || (d.tab || dTabs[0]) === dAct; });

        var bodyHtml =
            '<div style="padding:0.9rem 1.2rem;overflow-y:auto;flex:1;">' +
              tabBarHtml(hTabs, hAct, '_htab') +
              '<div style="display:grid;grid-template-columns:repeat(' + ((def.header && def.header.columns) || 4) + ',1fr);gap:8px 12px;">' +
                hFields.map(fieldHtml).join('') +
              '</div>' +
              tabBarHtml(dTabs, dAct, '_dtab').replace('margin-bottom:9px', 'margin-top:12px;margin-bottom:2px') +
              dets.map(detailHtml).join('') +
              ((def.reports || []).map(reportHtml).join('')) +
            '</div>';
        var footHtml =
            '<div style="padding:0.7rem 1.2rem;border-top:1px solid #f1f5f9;flex-shrink:0;">' +
              '<div id="fe-result" style="font-size:11px;margin-bottom:6px;"></div>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' + actionsHtml() + '</div>' +
            '</div>';
        var titleHtml =
            '<div style="padding:0.8rem 1.2rem;background:linear-gradient(135deg,#0f766e,#134e4a);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
              '<div style="font-weight:800;font-size:14px;color:white;"><i class="fas fa-' + esc(def.icon || 'wpforms') + '"></i> ' + esc(def.title || st.formKey || 'Form') +
              (st.mode === 'preview' ? ' <span style="font-size:9px;background:rgba(255,255,255,0.25);padding:2px 8px;border-radius:8px;">PREVIEW</span>' : '') + '</div>' +
              (st.container ? '' : '<button onclick="WMSFormEngine.close()" style="background:none;border:none;color:white;font-size:1.3rem;cursor:pointer;">&times;</button>') +
            '</div>';
        var hStyle = def.height ? 'height:' + def.height + 'px;max-height:94vh;' : 'max-height:94vh;';

        if (st.container) {
            st.container.innerHTML =
                '<div id="fe-modal" style="background:white;width:100%;max-width:' + (def.width || 1000) + 'px;' + (def.height ? 'height:' + def.height + 'px;' : '') +
                'border:1px solid #e2e8f0;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">' +
                titleHtml + bodyHtml + footHtml + '</div>';
        } else {
            var old = document.getElementById('fe-overlay');
            if (old) old.remove();
            document.body.insertAdjacentHTML('beforeend',
                '<div id="fe-overlay" style="position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:29000;display:flex;align-items:center;justify-content:center;">' +
                '<div id="fe-modal" style="background:white;width:96%;max-width:' + (def.width || 1000) + 'px;' + hStyle + 'border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.35);">' +
                titleHtml + bodyHtml + footHtml + '</div></div>');
        }

        // header inputs: keep state + dependent lists + computed in sync
        Array.prototype.forEach.call(document.querySelectorAll('#fe-modal .fe-hin'), function (el) {
            el.addEventListener('change', function () {
                var k = el.getAttribute('data-fkey');
                st.values[k] = el.type === 'checkbox' ? (el.checked ? 'Y' : 'N') : el.value;
                refreshDependentLists(k);
                refreshLookups(k, 0);
                headerComputed();
                syncComputedHeaderCells();
            });
        });
        // detail cells
        Array.prototype.forEach.call(document.querySelectorAll('#fe-modal .fe-cell'), function (el) {
            el.addEventListener('input', function () {
                var det = findDetail(el.getAttribute('data-det'));
                var row = (st.details[det.key] || [])[Number(el.getAttribute('data-ri'))];
                if (!row) return;
                row[el.getAttribute('data-ck')] = el.value;
                computeRow(det, row);
                syncRuleRows(det);
                refreshDetail(det);
            });
        });
    }

    function findDetail(key) {
        return (st.def.details || []).find(function (d) { return d.key === key; });
    }

    function syncComputedHeaderCells() {
        (st.def.header.fields || []).forEach(function (f) {
            if (f.type !== 'computed') return;
            var el = document.getElementById('fe-h-' + f.key);
            if (el) el.value = fmt(st.values[f.key]);
        });
    }

    // update computed cells + totals of one detail without full re-render
    function refreshDetail(det) {
        var tbody = document.getElementById('fe-det-' + det.key);
        if (!tbody) return;
        var cols = det.columns || [];
        var rows = st.details[det.key] || [];
        Array.prototype.forEach.call(tbody.rows, function (tr, ri) {
            var r = rows[ri];
            if (!r) return;
            cols.forEach(function (c, ci) {
                var td = tr.cells[ci + 1];
                if (!td) return;
                if (c.editable && c.type !== 'computed') {
                    var inp = td.querySelector('input');
                    if (inp && document.activeElement !== inp) inp.value = r[c.key];
                } else if (c.type === 'number' || c.type === 'computed') {
                    td.textContent = fmt(r[c.key]);
                }
            });
        });
        // totals row
        var tfoot = tbody.parentElement.querySelector('tfoot tr');
        if (tfoot) {
            var t = detailTotals(det);
            cols.forEach(function (c, ci) {
                var td = tfoot.cells[ci + 1];
                if (td && (det.totals || []).indexOf(c.key) >= 0) td.textContent = fmt(t[c.key]);
            });
        }
        headerComputed();
        syncComputedHeaderCells();
    }

    // ── lists (select + dependent) ──────────────────────────
    function loadSelectList(f, cb) {
        if (!f.listSql) { if (cb) cb(); return; }
        runSql(bindHeaderSql(f.listSql), function (err, rows) {
            if (err) { console.warn('[FormEngine] list', f.key, 'failed:', err); if (cb) cb(); return; }
            st.lists[f.key] = rows.map(function (r) {
                var ks = Object.keys(r);
                return { value: r.VALUE !== undefined ? r.VALUE : r[ks[0]], label: r.LABEL !== undefined ? r.LABEL : (r[ks[1]] !== undefined ? r[ks[1]] : r[ks[0]]) };
            });
            if (cb) cb();
        });
    }
    function loadAllLists(cb) {
        var fields = ((st.def.header && st.def.header.fields) || []).filter(function (f) { return f.type === 'select' && f.listSql; });
        var left = fields.length;
        if (!left) { cb(); return; }
        fields.forEach(function (f) { loadSelectList(f, function () { if (--left === 0) cb(); }); });
    }
    function refreshDependentLists(changedKey) {
        ((st.def.header && st.def.header.fields) || []).forEach(function (f) {
            if (f.type !== 'select' || !f.listSql) return;
            if (sqlDeps(f.listSql).indexOf(changedKey) < 0) return;
            loadSelectList(f, function () {
                var el = document.getElementById('fe-h-' + f.key);
                if (!el) return;
                var cur = st.values[f.key];
                el.innerHTML = '<option value=""></option>' + (st.lists[f.key] || []).map(function (o) {
                    return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(cur) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
                }).join('');
            });
        });
    }

    // ── lookup fields (auto-populate from SQL) ──────────────
    // A field with valueSql fetches its own value: the SQL returns one
    // row and the field takes the first column (or the VALUE alias).
    // :OTHERFIELD placeholders make it react - whenever a referenced
    // field changes (typed, picked or itself looked up), the lookup
    // re-runs. Cascades are followed up to 4 levels deep.
    function runLookup(f, depth) {
        var sql = bindHeaderSql(f.valueSql);
        console.log('[FormEngine] lookup', f.key, 'SQL:', sql);
        runSql(sql, function (err, rows) {
            if (!st) return;
            if (err) { console.warn('[FormEngine] lookup', f.key, 'failed:', err); return; }
            var v = '';
            if (rows.length) {
                var r0 = rows[0];
                v = r0.VALUE !== undefined ? r0.VALUE : r0[Object.keys(r0)[0]];
            }
            if (v === undefined || v === null) v = '';
            if (String(st.values[f.key]) === String(v)) return;
            st.values[f.key] = v;
            var el = document.getElementById('fe-h-' + f.key);
            if (el) {
                if (el.type === 'checkbox') el.checked = (v === 'Y' || v === true);
                else el.value = v;
            }
            headerComputed(); syncComputedHeaderCells();
            refreshDependentLists(f.key);
            refreshLookups(f.key, (depth || 0) + 1);
        });
    }
    function refreshLookups(changedKey, depth) {
        if ((depth || 0) > 4) return;
        ((st.def.header && st.def.header.fields) || []).forEach(function (f) {
            if (!f.valueSql || f.key === changedKey) return;
            if (sqlDeps(f.valueSql).indexOf(changedKey) < 0) return;
            runLookup(f, depth || 0);
        });
    }
    // on open: run lookups whose referenced fields already carry values
    function initLookups() {
        ((st.def.header && st.def.header.fields) || []).forEach(function (f) {
            if (!f.valueSql) return;
            var deps = sqlDeps(f.valueSql);
            var ready = deps.every(function (k) { return st.values[k] !== '' && st.values[k] !== undefined && st.values[k] !== null; });
            if (ready) runLookup(f, 0);
        });
    }

    // ── pickers ─────────────────────────────────────────────
    function pickerDialog(title, onSearch, footer) {
        var old = document.getElementById('fe-picker');
        if (old) old.remove();
        var html =
        '<div id="fe-picker" style="position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:29500;display:flex;align-items:center;justify-content:center;">' +
          '<div style="background:white;width:92%;max-width:760px;max-height:80vh;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.35);">' +
            '<div style="padding:0.7rem 1rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">' +
              '<div style="font-weight:800;font-size:12.5px;color:#334155;"><i class="fas fa-search"></i> ' + esc(title) + '</div>' +
              '<button onclick="document.getElementById(\'fe-picker\').remove()" style="background:none;border:none;font-size:1.2rem;color:#64748b;cursor:pointer;">&times;</button>' +
            '</div>' +
            '<div style="padding:0.6rem 1rem;display:flex;gap:6px;">' +
              '<input type="text" id="fe-picker-q" placeholder="search… (empty = first rows)" style="' + inputCss() + '">' +
              '<button id="fe-picker-go" style="border:none;background:#0f766e;color:white;border-radius:7px;cursor:pointer;padding:0 14px;font-size:12px;font-weight:700;">Search</button>' +
            '</div>' +
            '<div id="fe-picker-res" style="flex:1;overflow-y:auto;padding:0 1rem 0.6rem;"></div>' +
            (footer || '') +
          '</div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
        var go = function () {
            document.getElementById('fe-picker-res').innerHTML = '<div style="padding:1rem;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Searching…</div>';
            onSearch(document.getElementById('fe-picker-q').value.trim());
        };
        document.getElementById('fe-picker-go').addEventListener('click', go);
        document.getElementById('fe-picker-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        setTimeout(function () { document.getElementById('fe-picker-q').focus(); }, 50);
    }

    // header picker field
    function pickHeaderField(fkey) {
        var f = ((st.def.header && st.def.header.fields) || []).find(function (x) { return x.key === fkey; });
        if (!f || !f.pickerSql) { alert('No picker SQL configured for ' + fkey); return; }
        pickerDialog(f.label || fkey, function (q) {
            var sql = bindSearch(bindHeaderSql(f.pickerSql), q);
            console.log('[FormEngine] picker SQL:', sql);
            runSql(sql, function (err, rows) {
                var box = document.getElementById('fe-picker-res');
                if (!box) return;
                if (err) { box.innerHTML = '<div style="padding:1rem;color:#dc2626;font-size:11px;">' + esc(err) + '</div>'; return; }
                if (!rows.length) { box.innerHTML = '<div style="padding:1rem;color:#94a3b8;font-size:11px;text-align:center;">No matches.</div>'; return; }
                var cols = Object.keys(rows[0]);
                box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:#f8fafc;">' +
                    cols.map(function (c) { return '<th style="padding:5px;text-align:left;">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    rows.map(function (r, i) {
                        return '<tr class="fe-pick-row" data-i="' + i + '" style="border-bottom:1px solid #f1f5f9;cursor:pointer;" onmouseover="this.style.background=\'#f0fdfa\'" onmouseout="this.style.background=\'\'">' +
                            cols.map(function (c) { return '<td style="padding:5px;">' + esc(r[c]) + '</td>'; }).join('') + '</tr>';
                    }).join('') + '</tbody></table>';
                Array.prototype.forEach.call(box.querySelectorAll('.fe-pick-row'), function (el) {
                    el.addEventListener('click', function () {
                        var r = rows[Number(el.getAttribute('data-i'))];
                        captureHeader();
                        var map = f.map || {};
                        Object.keys(map).forEach(function (hk) { st.values[hk] = r[String(map[hk]).toUpperCase()]; });
                        if (f.display) st.values[f.key] = r[String(f.display).toUpperCase()];
                        document.getElementById('fe-picker').remove();
                        loadAllLists(function () {
                            if (!st) return;
                            render();   // dependent lists may use the picked values
                            // lookup fields that reference the picked/mapped keys
                            refreshLookups(f.key, 0);
                            Object.keys(map).forEach(function (hk) { refreshLookups(hk, 0); });
                        });
                    });
                });
            });
        });
    }

    // detail rows picker (multi-select)
    function pickDetailRows(detKey) {
        var det = findDetail(detKey);
        if (!det || !det.pickerSql) return;
        var found = [];
        pickerDialog(det.title || detKey,
            function (q) {
                captureHeader();
                var sql = bindSearch(bindHeaderSql(det.pickerSql), q);
                console.log('[FormEngine] detail picker SQL:', sql);
                runSql(sql, function (err, rows) {
                    var box = document.getElementById('fe-picker-res');
                    if (!box) return;
                    if (err) { box.innerHTML = '<div style="padding:1rem;color:#dc2626;font-size:11px;">' + esc(err) + '</div>'; return; }
                    if (!rows.length) { box.innerHTML = '<div style="padding:1rem;color:#94a3b8;font-size:11px;text-align:center;">No matches.</div>'; return; }
                    found = rows;
                    var cols = Object.keys(rows[0]);
                    box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:#f8fafc;"><th></th>' +
                        cols.map(function (c) { return '<th style="padding:5px;text-align:left;">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                        rows.map(function (r, i) {
                            return '<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:5px;text-align:center;"><input type="checkbox" class="fe-det-cb" data-i="' + i + '"></td>' +
                                cols.map(function (c) { return '<td style="padding:5px;">' + esc(r[c]) + '</td>'; }).join('') + '</tr>';
                        }).join('') + '</tbody></table>';
                });
            },
            '<div style="padding:0.6rem 1rem;border-top:1px solid #f1f5f9;text-align:right;"><button id="fe-picker-add" style="border:none;background:#16a34a;color:white;border-radius:7px;cursor:pointer;padding:7px 16px;font-size:12px;font-weight:700;"><i class="fas fa-plus"></i> Add selected</button></div>');
        setTimeout(function () {
            var addBtn = document.getElementById('fe-picker-add');
            if (!addBtn) return;
            addBtn.addEventListener('click', function () {
                var cbs = document.querySelectorAll('#fe-picker .fe-det-cb:checked');
                if (!cbs.length) return;
                var newIdxs = [];
                Array.prototype.forEach.call(cbs, function (cb) {
                    var r = found[Number(cb.getAttribute('data-i'))];
                    var row = {};
                    (det.columns || []).forEach(function (c) {
                        var srcCol = (det.pickerMap && det.pickerMap[c.key]) ? String(det.pickerMap[c.key]).toUpperCase() : c.key.toUpperCase();
                        row[c.key] = r[srcCol] !== undefined ? r[srcCol] : (c.default !== undefined ? c.default : (c.type === 'number' ? 0 : ''));
                    });
                    computeRow(det, row);
                    newIdxs.push((st.details[det.key] = st.details[det.key] || []).length);
                    st.details[det.key].push(row);
                });
                document.getElementById('fe-picker').remove();
                captureHeader(); render();
                applyLineRules(det, newIdxs, function (added) { if (added) { captureHeader(); render(); } });
            });
        }, 60);
    }

    // ── line rules (companion rows, e.g. BOGO) ──────────────
    function applyLineRules(det, rowIdxs, after) {
        if (!det.lineRulesSql || !rowIdxs.length) { if (after) after(0); return; }
        var queue = rowIdxs.slice();
        var added = 0;
        var firstCol = (det.columns && det.columns[0] && det.columns[0].key) || 'item_code';
        var qtyKey = det.qtyKey || 'qty';
        (function next() {
            if (!st) return;
            if (!queue.length) { if (after) after(added); return; }
            var ri = queue.shift();
            var parent = (st.details[det.key] || [])[ri];
            if (!parent || parent._rule) { next(); return; }
            var refVal = parent[firstCol];
            var dup = (st.details[det.key] || []).some(function (r) { return r._rule && r._rule_ref === refVal; });
            if (dup) { next(); return; }
            var sql = bindHeaderSql(det.lineRulesSql);
            (det.columns || []).forEach(function (c) {
                sql = sql.replace(new RegExp(':' + c.key.toUpperCase() + '\\b', 'g'), sqlLit(parent[c.key]));
            });
            console.log('[FormEngine] line rule SQL:', sql);
            runSql(sql, function (err, rows) {
                if (!st) return;
                if (err) { console.warn('[FormEngine] line rule failed:', err); next(); return; }
                (rows || []).forEach(function (r) {
                    var row = { _rule: true, _rule_ref: refVal };
                    (det.columns || []).forEach(function (c) {
                        var v = r[c.key.toUpperCase()];
                        row[c.key] = v !== undefined ? v : (c.type === 'number' ? 0 : '');
                    });
                    var buy = num(r.BUY_QTY) || 1, get = num(r.GET_QTY) || 1;
                    row._buy_qty = buy; row._get_qty = get;
                    row[qtyKey] = Math.floor(num(parent[qtyKey]) / buy) * get;
                    if (num(row[qtyKey]) <= 0) return;
                    computeRow(det, row);
                    st.details[det.key].push(row);
                    added++;
                });
                next();
            });
        })();
    }
    // keep rule rows in sync with their parent's qty
    function syncRuleRows(det) {
        var qtyKey = det.qtyKey || 'qty';
        var firstCol = (det.columns && det.columns[0] && det.columns[0].key) || 'item_code';
        (st.details[det.key] || []).forEach(function (r) {
            if (!r._rule || !r._buy_qty) return;
            var parent = (st.details[det.key] || []).find(function (p) { return !p._rule && p[firstCol] === r._rule_ref; });
            if (!parent) return;
            r[qtyKey] = Math.floor(num(parent[qtyKey]) / r._buy_qty) * (r._get_qty || 1);
            computeRow(det, r);
        });
    }

    // ── validation ──────────────────────────────────────────
    function validate(cb) {
        captureHeader();
        var errs = [];
        ((st.def.header && st.def.header.fields) || []).forEach(function (f) {
            var v = st.values[f.key];
            if (f.required && (v === '' || v === undefined || v === null)) errs.push((f.label || f.key) + ' is required.');
            if (f.type === 'number' && v !== '' && v !== undefined) {
                if (f.min !== undefined && num(v) < f.min) errs.push((f.label || f.key) + ' must be >= ' + f.min);
                if (f.max !== undefined && num(v) > f.max) errs.push((f.label || f.key) + ' must be <= ' + f.max);
            }
            if (f.pattern && v) { try { if (!new RegExp(f.pattern).test(String(v))) errs.push((f.label || f.key) + ' is not in the expected format.'); } catch (e) { } }
        });
        (st.def.details || []).forEach(function (det) {
            if (det.required && !(st.details[det.key] || []).length) errs.push('Add at least one row to ' + (det.title || det.key) + '.');
        });
        if (errs.length) { cb(errs.join('\n')); return; }

        var checks = ((st.def.rules && st.def.rules.submitChecks) || []).slice();
        (function next() {
            if (!checks.length) { cb(null); return; }
            var chk = checks.shift();
            if (!chk || !chk.sql) { next(); return; }
            runSql(bindHeaderSql(chk.sql), function (err, rows) {
                if (err) { cb((chk.message || 'Validation') + ' — check failed to run: ' + err); return; }
                var mode = String(chk.mode || 'FAIL_IF_ROWS').toUpperCase();
                var bad = mode === 'FAIL_IF_NO_ROWS' ? !rows.length : !!rows.length;
                if (bad) { cb(chk.message || 'A validation rule failed.'); return; }
                next();
            });
        })();
    }

    // ── actions ─────────────────────────────────────────────
    function showResult(ok, msg) {
        var box = document.getElementById('fe-result');
        if (!box) return;
        box.innerHTML = '<span style="color:' + (ok ? '#15803d' : '#b91c1c') + ';font-weight:700;">' +
            '<i class="fas fa-' + (ok ? 'check-circle' : 'times-circle') + '"></i> ' + esc(msg) + '</span>';
    }

    function runAction(i) {
        var a = (st.def.actions || [])[i];
        if (!a) return;
        if (a.type === 'close') { WMSFormEngine.close(); return; }
        if (a.type === 'print') { doPrint('form'); return; }
        if (st.mode === 'preview') { showResult(true, 'Preview mode — "' + (a.label || a.key) + '" would run type=' + a.type + '.'); return; }
        if (a.confirm && !window.confirm(strSub(a.confirm, buildPayload()))) return;

        var btn = document.getElementById('fe-act-' + i);
        var restore = btn ? btn.innerHTML : '';
        var busy = function (on) {
            if (!btn) return;
            btn.disabled = on;
            btn.innerHTML = on ? '<i class="fas fa-spinner fa-spin"></i> Working…' : restore;
        };

        var proceed = function () {
            var payload = buildPayload();
            if (a.type === 'ords') {
                var url = strSub(a.url || '', payload);
                var body = a.bodyTemplate ? resolveTemplate(a.bodyTemplate, payload) : payload;
                var msg = String(a.method || 'POST').toUpperCase() === 'GET'
                    ? { action: 'executeGet', fullUrl: url }
                    : { action: 'executePost', fullUrl: url, body: JSON.stringify(body) };
                busy(true);
                sendMessageToCSharp(msg, function (err, data) {
                    busy(false);
                    var respText = err ? String(err) : (typeof data === 'string' ? data : JSON.stringify(data));
                    var ok = !err;
                    try { var ro = JSON.parse(respText); if (ro && ro.success === false) ok = false; } catch (e) { }
                    showResult(ok, ok ? (a.successMessage || 'Done.') : ('Failed: ' + respText.slice(0, 300)));
                });
            } else if (a.type === 'sql') {
                var stmt = String(a.statement || '').replace(/\{(\w+)\}/g, function (m, k) {
                    return payload.header[k] !== undefined ? String(payload.header[k]).replace(/'/g, "''") : m;
                });
                busy(true);
                sendMessageToCSharp({
                    action: 'executePost', fullUrl: aiBase() + '/executewrite',
                    body: JSON.stringify({ sql: stmt, appUser: userName() })
                }, function (err, data) {
                    busy(false);
                    var d = null;
                    try { d = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { }
                    var ok = !err && d && d.success === true;
                    showResult(ok, ok ? (a.successMessage || 'Saved (' + (d.rowsAffected || 0) + ' row(s)).') : ('Failed: ' + String(err || (d && d.error) || 'unknown').slice(0, 300)));
                });
            } else if (a.type === 'local_file') {
                var fileName = strSub(a.fileName || (st.formKey || 'form') + '_{TIMESTAMP}.json', payload);
                var content = a.bodyTemplate ? resolveTemplate(a.bodyTemplate, payload) : payload;
                var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
                busy(true);
                sendMessageToCSharp({
                    action: 'saveLocalFile', folder: a.folder || 'forms', fileName: fileName, dataBase64: b64
                }, function (err, data) {
                    busy(false);
                    var d = null;
                    try { d = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { d = data; }
                    var ok = !err && d && d.success !== false;
                    showResult(ok, ok ? ('Saved locally: ' + ((d && d.path) || fileName)) : ('Save failed: ' + String(err || (d && d.error) || 'is the app updated with saveLocalFile support?').slice(0, 300)));
                });
            } else if (a.type === 'chat') {
                if (typeof st.chatHandoff === 'function') {
                    st.chatHandoff(a, payload);
                    WMSFormEngine.close();
                } else {
                    showResult(false, 'This button hands the values to the AI chat — open the form from the AI Digital Employee module to use it.');
                }
            } else {
                showResult(false, 'Unknown action type: ' + a.type);
            }
        };

        if (a.validate) {
            busy(true);
            validate(function (errMsg) {
                busy(false);
                if (errMsg) { showResult(false, errMsg); alert('Validation failed:\n\n' + errMsg); return; }
                proceed();
            });
        } else proceed();
    }

    // ── public API ──────────────────────────────────────────
    window.WMSFormEngine = {
        open: function (def, opts) {
            opts = opts || {};
            if (!def || !def.header) { alert('Invalid form definition (no header section).'); return; }
            var container = opts.container;
            if (typeof container === 'string') container = document.getElementById(container);
            st = {
                def: def, formKey: opts.formKey || '', mode: opts.mode || 'run',
                values: {}, details: {}, lists: {}, reports: {},
                ui: { headerTab: null, detailTab: null },
                container: container || null,
                chatHandoff: opts.chatHandoff, onClose: opts.onClose
            };
            var pre = opts.values || {};
            ((def.header && def.header.fields) || []).forEach(function (f) {
                var d = f.default;
                if (d === '$TODAY') d = todayIso();
                else if (d === '$USER') d = userName();
                st.values[f.key] = pre[f.key] !== undefined ? pre[f.key] : (d !== undefined ? d : '');
            });
            (def.details || []).forEach(function (det) {
                st.details[det.key] = Array.isArray(pre[det.key]) ? pre[det.key].map(function (r) {
                    var row = {};
                    (det.columns || []).forEach(function (c) { row[c.key] = r[c.key] !== undefined ? r[c.key] : (c.type === 'number' ? 0 : ''); });
                    computeRow(det, row);
                    return row;
                }) : [];
            });
            loadAllLists(function () {
                if (!st) return;
                render();
                // rules cover prefilled rows too
                (def.details || []).forEach(function (det) {
                    var idxs = (st.details[det.key] || []).map(function (_, i) { return i; });
                    if (idxs.length && det.lineRulesSql)
                        applyLineRules(det, idxs, function (added) { if (st && added) { captureHeader(); render(); } });
                });
                // auto-run reports flagged autoRun
                (def.reports || []).forEach(function (r) { if (r.autoRun) runReport(r.key); });
                // lookup fields whose referenced values were prefilled
                initLookups();
            });
            render();   // immediate paint; lists re-render when loaded
        },
        openByKey: function (formKey, opts) {
            runSql("SELECT definition FROM wms_ai_forms WHERE form_key = " + sqlLit(formKey) + " AND active = 'Y'", function (err, rows) {
                if (err) { alert('Could not load form "' + formKey + '": ' + err); return; }
                if (!rows.length) { alert('Form "' + formKey + '" not found or inactive.'); return; }
                var def;
                try { def = JSON.parse(rows[0].DEFINITION); }
                catch (e) { alert('Form "' + formKey + '" has an invalid definition (not valid JSON).'); return; }
                WMSFormEngine.open(def, Object.assign({}, opts, { formKey: formKey }));
            });
        },
        close: function () {
            if (st && st.container) st.container.innerHTML = '';
            var o = document.getElementById('fe-overlay'); if (o) o.remove();
            var p = document.getElementById('fe-picker'); if (p) p.remove();
            if (st && typeof st.onClose === 'function') st.onClose();
            st = null;
        },
        _htab: function (t) { captureHeader(); st.ui.headerTab = t; render(); },
        _dtab: function (t) { captureHeader(); st.ui.detailTab = t; render(); },
        _runReport: runReport,
        _print: doPrint,
        _pick: pickHeaderField,
        _pickRows: pickDetailRows,
        _addRow: function (detKey) {
            var det = findDetail(detKey);
            if (!det) return;
            var row = {};
            (det.columns || []).forEach(function (c) { row[c.key] = c.default !== undefined ? c.default : (c.type === 'number' ? 0 : ''); });
            computeRow(det, row);
            (st.details[detKey] = st.details[detKey] || []).push(row);
            captureHeader(); render();
        },
        _delRow: function (detKey, ri) {
            var det = findDetail(detKey);
            var rows = st.details[detKey] || [];
            var gone = rows[ri];
            rows.splice(ri, 1);
            if (gone && !gone._rule) {
                var firstCol = (det.columns && det.columns[0] && det.columns[0].key) || 'item_code';
                st.details[detKey] = rows.filter(function (r) { return !(r._rule && r._rule_ref === gone[firstCol]); });
            }
            captureHeader(); render();
        },
        _act: runAction
    };
})();
