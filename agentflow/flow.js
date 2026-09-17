// ============================================================
// AGENT FLOW - visual agentic flow builder + runner (LangGraph-style)
// ============================================================
// Build a flow on a canvas from agentic nodes (Start / Agent / Query /
// Write / HTTP / Condition / SetVar / Approve / Email / End), wire them
// with edges, save the flow as JSON in WMS_AI_FLOWS, and RUN it: the
// engine walks the graph, resolves {var} templates, calls Claude
// (aiChatSend), the guarded SQL gateways, HTTP and email through the
// existing WebView <-> C# bridge, evaluates conditions to pick a branch,
// pauses for human approval, and streams a live run trace on the canvas.
// ============================================================

(function () {
    'use strict';

    var AI_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    function appUser() { try { return localStorage.getItem('wms_user') || 'FLOW'; } catch (e) { return 'FLOW'; } }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function sqlq(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }
    function uid(p) { return (p || 'n') + Math.random().toString(36).slice(2, 8); }

    // ── node catalogue (the "controls", LangChain-style) ────────
    var TYPES = {
        start:     { label: 'Start',     color: '#0f766e', icon: 'flag',            ports: ['out'],           desc: 'Entry point — collect input variables' },
        agent:     { label: 'AI Agent',  color: '#7c3aed', icon: 'robot',           ports: ['out'],           desc: 'Ask Claude with a prompt; save the reply to a variable' },
        query:     { label: 'SQL Query', color: '#2563eb', icon: 'database',        ports: ['out'],           desc: 'Read rows via the query gateway into a variable' },
        write:     { label: 'SQL Write', color: '#dc2626', icon: 'pen-to-square',   ports: ['out'],           desc: 'INSERT/UPDATE/DELETE via the guarded write gateway' },
        http:      { label: 'HTTP Call', color: '#0891b2', icon: 'globe',           ports: ['out'],           desc: 'Call a REST API (GET/POST) into a variable' },
        condition: { label: 'Condition', color: '#b45309', icon: 'code-branch',     ports: ['true', 'false'], desc: 'Branch on an expression (true / false)' },
        setvar:    { label: 'Set Vars',  color: '#16a34a', icon: 'equals',          ports: ['out'],           desc: 'Assign / transform variables' },
        approve:   { label: 'Approval',  color: '#ca8a04', icon: 'user-check',      ports: ['out'],           desc: 'Pause for a human to approve before continuing' },
        email:     { label: 'Email',     color: '#db2777', icon: 'envelope',        ports: ['out'],           desc: 'Send an email (uses the AI Employee email settings)' },
        end:       { label: 'End',       color: '#334155', icon: 'flag-checkered',  ports: [],                desc: 'Finish; optionally output a variable' }
    };
    function defConfig(t) {
        switch (t) {
            case 'start': return { inputs: [{ key: 'input', label: 'Input', default: '' }] };
            case 'agent': return { system: 'You are a helpful assistant.', prompt: 'Answer using {input}.', outputVar: 'reply' };
            case 'query': return { sql: 'SELECT * FROM GRFU_CUSTOMER FETCH FIRST 5 ROWS ONLY', outputVar: 'rows' };
            case 'write': return { sql: '', approve: true };
            case 'http': return { method: 'GET', url: '', body: '', outputVar: 'response' };
            case 'condition': return { expr: 'rows && rows.length > 0' };
            case 'setvar': return { assignments: [{ key: 'x', value: '1' }] };
            case 'approve': return { message: 'Proceed with the next step?' };
            case 'email': return { to: '{email}', subject: '', body: '' };
            case 'end': return { outputVar: '' };
            default: return {};
        }
    }

    // ── state ───────────────────────────────────────────────
    var flow = null;           // { flow_key, name, description, nodes:[], edges:[] }
    var flowRows = [];
    var sel = null;            // selected node id
    var connecting = null;     // { from, branch } while wiring an edge
    var running = false;

    // ── bridge ──────────────────────────────────────────────
    function bridge(msg, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb && cb('bridge unavailable', null); return; }
        sendMessageToCSharp(msg, cb || function () { });
    }
    function runQuery(sql, cb) {
        bridge({ action: 'executePost', fullUrl: AI_BASE + '/executequery', body: JSON.stringify({ sql: sql, maxRows: 500, appUser: appUser() }) }, function (err, data) {
            if (err) return cb(String(err));
            try { var r = typeof data === 'string' ? JSON.parse(data) : data; if (!r.success) return cb(r.error || 'query failed'); var cols = (r.columns || []); cb(null, (r.rows || []).map(function (row) { var o = {}; cols.forEach(function (c, i) { o[String(c).toUpperCase()] = row[i]; }); return o; })); }
            catch (e) { cb(e.message); }
        });
    }
    function runWrite(sql, cb) {
        bridge({ action: 'executePost', fullUrl: AI_BASE + '/executewrite', body: JSON.stringify({ sql: sql, appUser: appUser() }) }, function (err, data) {
            if (err) return cb(String(err));
            try { var d = typeof data === 'string' ? JSON.parse(data) : data; if (!d || d.success !== true) return cb((d && d.error) || 'write failed'); cb(null, d); }
            catch (e) { cb(e.message); }
        });
    }
    function aiSend(prompt, system, cb) {
        var text = (system ? '[SYSTEM]\n' + system + '\n\n' : '') + prompt;
        bridge({ action: 'aiChatSend', text: '[CURRENT_INSTANCE: PROD]\n' + text, sessionId: null, instance: 'PROD' }, function (err, resp) {
            if (err) return cb(String(err));
            cb(null, (resp && (resp.markdown || resp.answer)) || '');
        });
    }
    function httpCall(method, url, body, cb) {
        var msg = method === 'GET' ? { action: 'executeGet', fullUrl: url } : { action: 'executePost', fullUrl: url, body: body || '' };
        bridge(msg, function (err, data) { if (err) return cb(String(err)); try { cb(null, typeof data === 'string' ? JSON.parse(data) : data); } catch (e) { cb(null, data); } });
    }
    function emailSettings() {
        try { var s = JSON.parse(localStorage.getItem('aiEmailSettings') || 'null'); if (!s || !s.username) return null; return { server: s.server || 'smtp.office365.com', port: s.port || 587, username: s.username, password: s.p ? atob(s.p) : '' }; } catch (e) { return null; }
    }
    function sendEmail(to, subject, body, cb) {
        var s = emailSettings();
        if (!s) return cb('No email settings — set them in the AI Digital Employee (Email settings).');
        bridge({ action: 'sendSmtpEmail', to: to, subject: subject, body: body, smtp: s }, function (err, data) {
            if (err) return cb(String(err));
            try { var d = typeof data === 'string' ? JSON.parse(data) : data; if (d && d.success === false) return cb(d.message || 'email failed'); cb(null, d); }
            catch (e) { cb(null, data); }
        });
    }

    // ── persistence ─────────────────────────────────────────
    function loadFlows() {
        runQuery("SELECT flow_key, name, description, active FROM wms_ai_flows ORDER BY name", function (err, rows) {
            var box = document.getElementById('af-list'); if (!box) return;
            if (err) { box.innerHTML = '<div style="font-size:11px;color:#b91c1c;">' + esc(err) + '<br>Has apex_sql/53_ai_flows.sql been run?</div>'; return; }
            flowRows = rows || [];
            box.innerHTML = flowRows.length ? flowRows.map(function (f) {
                var k = f.FLOW_KEY;
                return '<div style="display:flex;align-items:center;gap:8px;border:1px solid ' + (flow && flow.flow_key === k ? '#c4b5fd' : '#e2e8f0') + ';background:' + (flow && flow.flow_key === k ? '#f5f3ff' : 'white') + ';border-radius:8px;padding:7px 9px;margin-bottom:5px;">' +
                    '<div onclick="AgentFlow.open(\'' + esc(k) + '\')" style="flex:1;min-width:0;cursor:pointer;"><div style="font-size:11.5px;font-weight:700;color:#0f172a;">' + esc(f.NAME) + '</div><div style="font-size:9.5px;color:#94a3b8;">' + esc(k) + '</div></div>' +
                    '<button onclick="AgentFlow.del(\'' + esc(k) + '\',\'' + esc(String(f.NAME || '').replace(/'/g, '')) + '\')" title="Delete" style="border:none;background:#fef2f2;color:#dc2626;border-radius:7px;width:24px;height:24px;cursor:pointer;"><i class="fas fa-trash"></i></button></div>';
            }).join('') : '<div style="font-size:11px;color:#94a3b8;">No flows yet — New Flow.</div>';
        });
    }
    function open(key) {
        runQuery("SELECT flow_key, name, description, active, definition, LENGTH(definition) AS DEFLEN FROM wms_ai_flows WHERE flow_key = " + sqlq(key), function (err, rows) {
            if (err || !rows.length) { alert('Could not load flow: ' + (err || 'not found')); return; }
            var r = rows[0], def = null, deflen = Number(r.DEFLEN) || 0;
            try { def = JSON.parse(r.DEFINITION); } catch (e) { }
            if (!def || !def.nodes) { alert(deflen > 0 ? 'The flow is stored (' + deflen + ' chars) but came back empty — run apex_sql/35d (CLOB read fix).' : 'This flow has no stored definition — rebuild and Save.'); def = { nodes: [], edges: [] }; }
            flow = { flow_key: String(r.FLOW_KEY), name: String(r.NAME || ''), description: String(r.DESCRIPTION || ''), nodes: def.nodes || [], edges: def.edges || [], isNew: false };
            sel = null; connecting = null;
            loadFlows(); render();
        });
    }
    function newFlow() {
        flow = { flow_key: '', name: 'New Flow', description: '', isNew: true,
            nodes: [{ id: uid(), type: 'start', title: 'Start', x: 60, y: 70, config: defConfig('start') }], edges: [] };
        sel = flow.nodes[0].id; connecting = null;
        loadFlows(); render();
    }
    // chunked-CLOB save (same bulletproof approach as the Forms Designer)
    function saveFlow() {
        if (!flow) return;
        var key = (flow.flow_key || (document.getElementById('af-key') || {}).value || '').trim();
        if (!/^[A-Za-z0-9._\-]{2,100}$/.test(key)) { setStatus('<span style="color:#b91c1c;">Set a flow key (letters, digits, dots).</span>'); return; }
        flow.name = (document.getElementById('af-name') || {}).value || flow.name || key;
        var defJson = JSON.stringify({ nodes: flow.nodes, edges: flow.edges });
        var CH = 3000, chunks = []; for (var i = 0; i < defJson.length; i += CH) chunks.push(defJson.slice(i, i + CH));
        var e1 = function (s) { return s.replace(/'/g, "''"); };
        var stmts = [];
        if (flow.isNew) stmts.push("INSERT INTO wms_ai_flows (flow_key, name, description, definition, active, updated_by, updated_on) VALUES (" + [sqlq(key), sqlq(flow.name), sqlq(flow.description), 'EMPTY_CLOB()', "'Y'", sqlq(appUser()), 'SYSDATE'].join(', ') + ")");
        else stmts.push("UPDATE wms_ai_flows SET name=" + sqlq(flow.name) + ", description=" + sqlq(flow.description) + ", definition=EMPTY_CLOB(), updated_by=" + sqlq(appUser()) + ", updated_on=SYSDATE WHERE flow_key=" + sqlq(key));
        chunks.forEach(function (c) { stmts.push("UPDATE wms_ai_flows SET definition = definition || TO_CLOB('" + e1(c) + "') WHERE flow_key = " + sqlq(key)); });
        var idx = 0; setStatus('<i class="fas fa-spinner fa-spin"></i> Saving (' + stmts.length + ' parts)…');
        (function next() {
            if (idx >= stmts.length) { flow.flow_key = key; flow.isNew = false; setStatus('<span style="color:#15803d;"><i class="fas fa-check-circle"></i> Saved.</span>'); loadFlows(); return; }
            runWrite(stmts[idx], function (err) { if (err) { setStatus('<span style="color:#b91c1c;">Save failed at part ' + (idx + 1) + ': ' + esc(err) + '</span>'); return; } idx++; next(); });
        })();
    }
    function del(key, name) {
        if (!confirm('Delete flow "' + (name || key) + '"?')) return;
        runWrite('DELETE FROM wms_ai_flows WHERE flow_key = ' + sqlq(key), function (err) { if (err) { alert('Delete failed: ' + err); return; } if (flow && flow.flow_key === key) { flow = null; render(); } loadFlows(); });
    }

    // ── canvas rendering ────────────────────────────────────
    function node(id) { return (flow.nodes || []).filter(function (n) { return n.id === id; })[0]; }
    function setStatus(h) { var el = document.getElementById('af-status'); if (el) el.innerHTML = h; }

    function render() {
        var host = document.getElementById('af-editor');
        if (!host) return;
        if (!flow) { host.innerHTML = '<div style="padding:3rem;text-align:center;color:#94a3b8;font-size:13px;">Pick a flow on the left, or click <b>New Flow</b>.</div>'; return; }
        host.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
              '<input id="af-name" value="' + esc(flow.name) + '" style="font-size:14px;font-weight:800;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;min-width:180px;">' +
              (flow.isNew ? '<input id="af-key" placeholder="flow.key" style="font-size:12px;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;">' : '<span style="font-size:11px;color:#94a3b8;">' + esc(flow.flow_key) + '</span>') +
              '<div style="margin-left:auto;display:flex;gap:6px;">' +
                '<button class="af-btn" onclick="AgentFlow.run()" style="background:#16a34a;color:white;"><i class="fas fa-play"></i> Run</button>' +
                '<button class="af-btn" onclick="AgentFlow.save()" style="background:#7c3aed;color:white;"><i class="fas fa-floppy-disk"></i> Save</button>' +
              '</div>' +
            '</div>' +
            '<div id="af-status" style="font-size:11px;color:#64748b;margin-bottom:6px;min-height:14px;"></div>' +
            '<div style="display:flex;gap:10px;align-items:flex-start;">' +
              // palette
              '<div style="flex:0 0 132px;">' +
                '<div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;margin-bottom:5px;">Add node</div>' +
                Object.keys(TYPES).map(function (t) { var T = TYPES[t]; return '<div onclick="AgentFlow.add(\'' + t + '\')" title="' + esc(T.desc) + '" style="display:flex;align-items:center;gap:7px;border:1px solid #eef2f7;border-left:3px solid ' + T.color + ';border-radius:7px;padding:6px 8px;margin-bottom:5px;cursor:pointer;font-size:11.5px;font-weight:700;color:#334155;background:white;"><i class="fas fa-' + T.icon + '" style="color:' + T.color + ';width:14px;"></i> ' + T.label + '</div>'; }).join('') +
              '</div>' +
              // canvas
              '<div id="af-canvas" style="flex:1;position:relative;height:560px;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;background:#fbfcfe;background-image:radial-gradient(#e6eaf2 1px,transparent 1px);background-size:20px 20px;">' +
                '<div id="af-inner" style="position:relative;width:2000px;height:1400px;">' +
                  '<svg id="af-svg" style="position:absolute;left:0;top:0;width:2000px;height:1400px;pointer-events:none;"></svg>' +
                '</div>' +
              '</div>' +
              // inspector
              '<div id="af-inspector" style="flex:0 0 260px;border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:white;max-height:560px;overflow:auto;"></div>' +
            '</div>' +
            '<div id="af-run" style="margin-top:10px;border:1px solid #e2e8f0;border-radius:10px;background:#0b1020;color:#d1e7ff;font-family:Consolas,monospace;font-size:11.5px;padding:10px;max-height:200px;overflow:auto;display:none;"></div>';
        (flow.nodes || []).forEach(renderNode);
        drawEdges();
        renderInspector();
    }

    function renderNode(n) {
        var inner = document.getElementById('af-inner'); if (!inner) return;
        var T = TYPES[n.type] || TYPES.end;
        var el = document.createElement('div');
        el.id = 'node-' + n.id;
        el.className = 'af-node' + (sel === n.id ? ' sel' : '');
        el.style.cssText = 'position:absolute;left:' + (n.x || 40) + 'px;top:' + (n.y || 40) + 'px;width:180px;background:white;border:2px solid ' + (sel === n.id ? T.color : '#e2e8f0') + ';border-radius:10px;box-shadow:0 2px 6px rgba(15,23,42,.08);z-index:2;';
        var ports = (T.ports || []).map(function (p) {
            return '<div class="af-port" id="port-' + n.id + '-' + p + '" onclick="event.stopPropagation();AgentFlow.startEdge(\'' + n.id + '\',\'' + p + '\')" title="Drag a connection from here" ' +
                'style="flex:1;text-align:center;font-size:9px;font-weight:800;color:' + (p === 'true' ? '#16a34a' : p === 'false' ? '#dc2626' : T.color) + ';cursor:crosshair;padding:3px;border-top:1px dashed #e2e8f0;">' +
                '<i class="fas fa-circle-dot"></i> ' + (p === 'out' ? 'next' : p) + '</div>';
        }).join('');
        el.innerHTML =
            '<div class="af-head" style="background:' + T.color + ';color:white;border-radius:7px 7px 0 0;padding:5px 9px;display:flex;align-items:center;gap:6px;cursor:move;font-size:11.5px;font-weight:800;">' +
              '<i class="fas fa-' + T.icon + '"></i><span style="flex:1;">' + esc(n.title || T.label) + '</span>' +
              '<i class="fas fa-times" onclick="event.stopPropagation();AgentFlow.delNode(\'' + n.id + '\')" style="cursor:pointer;opacity:.85;"></i>' +
            '</div>' +
            '<div onclick="AgentFlow.select(\'' + n.id + '\')" style="padding:7px 9px;font-size:10.5px;color:#64748b;min-height:20px;cursor:pointer;">' + esc(nodeSummary(n)) + '</div>' +
            '<div style="display:flex;">' + ports + '</div>';
        inner.appendChild(el);
        // drag by header
        var head = el.querySelector('.af-head');
        head.addEventListener('mousedown', function (e) { startDrag(e, n); });
        // click body target for connecting
        el.addEventListener('click', function () { if (connecting) { finishEdge(n.id); } });
    }
    function nodeSummary(n) {
        var c = n.config || {};
        switch (n.type) {
            case 'start': return (c.inputs || []).map(function (x) { return x.key; }).join(', ') || 'inputs';
            case 'agent': return '“' + String(c.prompt || '').slice(0, 40) + '” → ' + (c.outputVar || 'reply');
            case 'query': return '→ ' + (c.outputVar || 'rows');
            case 'write': return (c.approve ? '🔒 ' : '') + String(c.sql || '(sql)').slice(0, 40);
            case 'http': return (c.method || 'GET') + ' ' + String(c.url || '').slice(0, 34);
            case 'condition': return 'if ' + String(c.expr || '').slice(0, 40);
            case 'setvar': return (c.assignments || []).map(function (a) { return a.key; }).join(', ');
            case 'approve': return String(c.message || '').slice(0, 40);
            case 'email': return '✉ ' + String(c.to || '');
            case 'end': return c.outputVar ? 'output ' + c.outputVar : 'finish';
            default: return '';
        }
    }

    // edges as SVG bezier between port anchors and target tops
    function anchorOut(nid, branch) { var p = document.getElementById('port-' + nid + '-' + branch); return centerRel(p); }
    function anchorIn(nid) { var el = document.getElementById('node-' + nid); if (!el) return null; var r = rectRel(el); return { x: r.x + r.w / 2, y: r.y }; }
    function centerRel(el) { if (!el) return null; var r = rectRel(el); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
    function rectRel(el) { var inner = document.getElementById('af-inner'); var ir = inner.getBoundingClientRect(); var r = el.getBoundingClientRect(); return { x: r.left - ir.left, y: r.top - ir.top, w: r.width, h: r.height }; }
    function drawEdges() {
        var svg = document.getElementById('af-svg'); if (!svg) return;
        var paths = (flow.edges || []).map(function (e) {
            var a = anchorOut(e.from, e.branch || 'out'), b = anchorIn(e.to);
            if (!a || !b) return '';
            var dy = Math.max(30, Math.abs(b.y - a.y) / 2);
            var col = e.branch === 'true' ? '#16a34a' : e.branch === 'false' ? '#dc2626' : '#94a3b8';
            var d = 'M' + a.x + ' ' + a.y + ' C ' + a.x + ' ' + (a.y + dy) + ' ' + b.x + ' ' + (b.y - dy) + ' ' + b.x + ' ' + b.y;
            return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" marker-end="url(#af-arrow)"></path>' +
                '<path d="' + d + '" fill="none" stroke="transparent" stroke-width="12" style="pointer-events:stroke;cursor:pointer;" onclick="AgentFlow.delEdge(\'' + e.id + '\')"></path>';
        }).join('');
        svg.innerHTML = '<defs><marker id="af-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#94a3b8"></path></marker></defs>' + paths;
        svg.style.pointerEvents = 'none';
        // let edge hit-paths receive clicks
        Array.prototype.forEach.call(svg.querySelectorAll('path[onclick]'), function (p) { p.style.pointerEvents = 'stroke'; });
    }

    var drag = null;
    function startDrag(e, n) {
        e.preventDefault();
        var inner = document.getElementById('af-inner'); var ir = inner.getBoundingClientRect();
        drag = { n: n, dx: e.clientX - (ir.left + (n.x || 0)), dy: e.clientY - (ir.top + (n.y || 0)) };
        document.addEventListener('mousemove', onDrag); document.addEventListener('mouseup', endDrag);
    }
    function onDrag(e) {
        if (!drag) return;
        var inner = document.getElementById('af-inner'); var ir = inner.getBoundingClientRect();
        drag.n.x = Math.max(0, e.clientX - ir.left - drag.dx); drag.n.y = Math.max(0, e.clientY - ir.top - drag.dy);
        var el = document.getElementById('node-' + drag.n.id); if (el) { el.style.left = drag.n.x + 'px'; el.style.top = drag.n.y + 'px'; }
        drawEdges();
    }
    function endDrag() { drag = null; document.removeEventListener('mousemove', onDrag); document.removeEventListener('mouseup', endDrag); }

    // ── inspector ───────────────────────────────────────────
    function renderInspector() {
        var box = document.getElementById('af-inspector'); if (!box) return;
        if (!sel) { box.innerHTML = '<div style="font-size:11px;color:#94a3b8;">Select a node to edit it. Click a port (“next / true / false”) then a target node to connect them.</div>'; return; }
        var n = node(sel); if (!n) { box.innerHTML = ''; return; }
        var T = TYPES[n.type], c = n.config || (n.config = {});
        var h = '<div style="font-size:12px;font-weight:800;color:' + T.color + ';margin-bottom:8px;"><i class="fas fa-' + T.icon + '"></i> ' + T.label + '</div>';
        h += fld('Title', 'title', n.title || '', 'node');
        if (n.type === 'start') {
            h += '<div style="font-size:10px;font-weight:800;color:#64748b;margin:8px 0 4px;">INPUT VARIABLES</div>';
            (c.inputs || []).forEach(function (inp, i) {
                h += '<div style="display:flex;gap:4px;margin-bottom:4px;">' +
                    '<input value="' + esc(inp.key) + '" oninput="AgentFlow.arr(\'inputs\',' + i + ',\'key\',this.value)" placeholder="key" style="' + ic() + 'width:70px;">' +
                    '<input value="' + esc(inp.label) + '" oninput="AgentFlow.arr(\'inputs\',' + i + ',\'label\',this.value)" placeholder="label" style="' + ic() + 'flex:1;">' +
                    '<input value="' + esc(inp.default) + '" oninput="AgentFlow.arr(\'inputs\',' + i + ',\'default\',this.value)" placeholder="default" style="' + ic() + 'width:70px;">' +
                    '<i class="fas fa-times" onclick="AgentFlow.arrDel(\'inputs\',' + i + ')" style="cursor:pointer;color:#dc2626;align-self:center;"></i></div>';
            });
            h += '<button class="af-mini" onclick="AgentFlow.arrAdd(\'inputs\',{key:\'v\',label:\'\',default:\'\'})">+ input</button>';
        } else if (n.type === 'agent') {
            h += fld('System', 'system', c.system || '', 'cfg', true) + fld('Prompt (use {var})', 'prompt', c.prompt || '', 'cfg', true) + fld('Output variable', 'outputVar', c.outputVar || '', 'cfg');
        } else if (n.type === 'query') {
            h += fld('SQL (use {var})', 'sql', c.sql || '', 'cfg', true) + fld('Output variable', 'outputVar', c.outputVar || '', 'cfg');
        } else if (n.type === 'write') {
            h += fld('SQL (use {var})', 'sql', c.sql || '', 'cfg', true) + chk('Require human approval', 'approve', !!c.approve);
        } else if (n.type === 'http') {
            h += sel2('Method', 'method', c.method || 'GET', ['GET', 'POST']) + fld('URL (use {var})', 'url', c.url || '', 'cfg') + fld('Body (POST)', 'body', c.body || '', 'cfg', true) + fld('Output variable', 'outputVar', c.outputVar || '', 'cfg');
        } else if (n.type === 'condition') {
            h += fld('Expression', 'expr', c.expr || '', 'cfg', true) + '<div style="font-size:9.5px;color:#94a3b8;margin-top:3px;">JS over your variables, e.g. <code>total &gt; 1000</code> or <code>rows.length &gt; 0</code>. Wire the <b style="color:#16a34a;">true</b> and <b style="color:#dc2626;">false</b> ports.</div>';
        } else if (n.type === 'setvar') {
            h += '<div style="font-size:10px;font-weight:800;color:#64748b;margin:8px 0 4px;">ASSIGNMENTS (value is a {template})</div>';
            (c.assignments || []).forEach(function (a, i) {
                h += '<div style="display:flex;gap:4px;margin-bottom:4px;"><input value="' + esc(a.key) + '" oninput="AgentFlow.arr(\'assignments\',' + i + ',\'key\',this.value)" placeholder="var" style="' + ic() + 'width:80px;"><input value="' + esc(a.value) + '" oninput="AgentFlow.arr(\'assignments\',' + i + ',\'value\',this.value)" placeholder="value / {template}" style="' + ic() + 'flex:1;"><i class="fas fa-times" onclick="AgentFlow.arrDel(\'assignments\',' + i + ')" style="cursor:pointer;color:#dc2626;align-self:center;"></i></div>';
            });
            h += '<button class="af-mini" onclick="AgentFlow.arrAdd(\'assignments\',{key:\'v\',value:\'\'})">+ assignment</button>';
        } else if (n.type === 'approve') {
            h += fld('Message (use {var})', 'message', c.message || '', 'cfg', true);
        } else if (n.type === 'email') {
            h += fld('To (use {var})', 'to', c.to || '', 'cfg') + fld('Subject (use {var})', 'subject', c.subject || '', 'cfg') + fld('Body (use {var})', 'body', c.body || '', 'cfg', true) +
                '<div style="font-size:9.5px;color:#94a3b8;margin-top:3px;">Uses the AI Digital Employee’s Office 365 email settings.</div>';
        } else if (n.type === 'end') {
            h += fld('Output variable (optional)', 'outputVar', c.outputVar || '', 'cfg');
        }
        box.innerHTML = h;
    }
    function ic() { return 'border:1px solid #e2e8f0;border-radius:6px;padding:5px 7px;font-size:11px;'; }
    function fld(label, key, val, scope, area) {
        var input = area
            ? '<textarea oninput="AgentFlow.setf(\'' + scope + '\',\'' + key + '\',this.value)" style="' + ic() + 'width:100%;min-height:54px;font-family:inherit;resize:vertical;">' + esc(val) + '</textarea>'
            : '<input value="' + esc(val) + '" oninput="AgentFlow.setf(\'' + scope + '\',\'' + key + '\',this.value)" style="' + ic() + 'width:100%;">';
        return '<label style="display:block;font-size:10px;font-weight:700;color:#475569;margin:6px 0 2px;">' + esc(label) + '</label>' + input;
    }
    function chk(label, key, on) { return '<label style="display:flex;align-items:center;gap:6px;font-size:11px;margin:8px 0;color:#334155;"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="AgentFlow.setf(\'cfg\',\'' + key + '\',this.checked)"> ' + esc(label) + '</label>'; }
    function sel2(label, key, val, opts) { return '<label style="display:block;font-size:10px;font-weight:700;color:#475569;margin:6px 0 2px;">' + esc(label) + '</label><select onchange="AgentFlow.setf(\'cfg\',\'' + key + '\',this.value)" style="' + ic() + 'width:100%;">' + opts.map(function (o) { return '<option ' + (o === val ? 'selected' : '') + '>' + o + '</option>'; }).join('') + '</select>'; }

    // ── engine ──────────────────────────────────────────────
    function tmpl(str, ctx) { return String(str == null ? '' : str).replace(/\{(\w+)\}/g, function (m, k) { var v = ctx[k]; return v === undefined ? m : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }); }
    function outEdge(nid, branch) { return (flow.edges || []).filter(function (e) { return e.from === nid && (e.branch || 'out') === (branch || 'out'); })[0]; }
    function logRun(html) { var el = document.getElementById('af-run'); if (el) { el.style.display = 'block'; el.innerHTML += html + '<br>'; el.scrollTop = el.scrollHeight; } }
    function hi(nid, on) { var el = document.getElementById('node-' + nid); if (el) el.style.boxShadow = on ? '0 0 0 4px rgba(124,58,237,.35)' : '0 2px 6px rgba(15,23,42,.08)'; }

    function run() {
        if (!flow || running) return;
        var start = (flow.nodes || []).filter(function (n) { return n.type === 'start'; })[0];
        if (!start) { setStatus('<span style="color:#b91c1c;">Add a Start node.</span>'); return; }
        // collect start inputs
        var ctx = {};
        var inputs = (start.config && start.config.inputs) || [];
        for (var i = 0; i < inputs.length; i++) {
            var v = prompt('Input "' + (inputs[i].label || inputs[i].key) + '":', inputs[i].default || '');
            if (v === null) return;
            ctx[inputs[i].key] = v;
        }
        running = true; var el = document.getElementById('af-run'); if (el) el.innerHTML = '';
        logRun('<span style="color:#7dd3fc;">▶ Run started</span>');
        step(start, ctx, 0);
    }
    function step(n, ctx, count) {
        if (!n) { running = false; logRun('<span style="color:#86efac;">■ Flow finished</span>'); return; }
        if (count > 200) { running = false; logRun('<span style="color:#fca5a5;">Stopped — too many steps (loop?).</span>'); return; }
        hi(n.id, true);
        var T = TYPES[n.type];
        logRun('<span style="color:' + T.color + ';">● ' + esc(n.title || T.label) + '</span>');
        var cont = function (branch) { hi(n.id, false); var e = outEdge(n.id, branch || 'out'); step(e ? node(e.to) : null, ctx, count + 1); };
        var fail = function (msg) { hi(n.id, false); running = false; logRun('<span style="color:#fca5a5;">✗ ' + esc(msg) + '</span>'); };
        var c = n.config || {};
        try {
            if (n.type === 'start') { cont(); }
            else if (n.type === 'agent') {
                aiSend(tmpl(c.prompt, ctx), c.system, function (err, reply) { if (err) return fail(err); ctx[c.outputVar || 'reply'] = reply; logRun('<span style="color:#c4b5fd;">  ↳ ' + esc(String(reply).slice(0, 120)) + '</span>'); cont(); });
            } else if (n.type === 'query') {
                runQuery(tmpl(c.sql, ctx), function (err, rows) { if (err) return fail(err); ctx[c.outputVar || 'rows'] = rows; logRun('<span style="color:#93c5fd;">  ↳ ' + (rows ? rows.length : 0) + ' row(s)</span>'); cont(); });
            } else if (n.type === 'write') {
                var doWrite = function () { runWrite(tmpl(c.sql, ctx), function (err, d) { if (err) return fail(err); logRun('<span style="color:#fca5a5;">  ↳ ' + (d && d.rowsAffected != null ? d.rowsAffected + ' row(s)' : 'ok') + '</span>'); cont(); }); };
                if (c.approve) { if (!confirm('Approve write?\n\n' + tmpl(c.sql, ctx))) return fail('Write not approved'); }
                doWrite();
            } else if (n.type === 'http') {
                httpCall(c.method || 'GET', tmpl(c.url, ctx), tmpl(c.body, ctx), function (err, data) { if (err) return fail(err); ctx[c.outputVar || 'response'] = data; cont(); });
            } else if (n.type === 'condition') {
                var res = false; try { res = !!evalExpr(c.expr, ctx); } catch (e) { return fail('Condition error: ' + e.message); }
                logRun('<span style="color:#fcd34d;">  ↳ ' + (res ? 'true' : 'false') + '</span>'); cont(res ? 'true' : 'false');
            } else if (n.type === 'setvar') {
                (c.assignments || []).forEach(function (a) { ctx[a.key] = tmpl(a.value, ctx); }); cont();
            } else if (n.type === 'approve') {
                if (!confirm(tmpl(c.message, ctx))) return fail('Stopped at approval'); cont();
            } else if (n.type === 'email') {
                sendEmail(tmpl(c.to, ctx), tmpl(c.subject, ctx), tmpl(c.body, ctx), function (err) { if (err) return fail(err); logRun('<span style="color:#f9a8d4;">  ↳ email sent</span>'); cont(); });
            } else if (n.type === 'end') {
                if (c.outputVar) logRun('<span style="color:#86efac;">  ↳ ' + esc(c.outputVar) + ' = ' + esc(String(ctx[c.outputVar]).slice(0, 200)) + '</span>');
                hi(n.id, false); running = false; logRun('<span style="color:#86efac;">■ Flow finished</span>');
            } else { cont(); }
        } catch (e) { fail(e.message); }
    }
    function evalExpr(expr, ctx) {
        var keys = Object.keys(ctx); var vals = keys.map(function (k) { return ctx[k]; });
        /* eslint-disable no-new-func */
        return Function.apply(null, keys.concat(['return (' + (expr || 'false') + ');'])).apply(null, vals);
    }

    // ── public API ──────────────────────────────────────────
    window.AgentFlow = {
        onShow: function () {
            var host = document.getElementById('agentflow');
            if (!host || host.getAttribute('data-built')) { if (host) loadFlows(); return; }
            host.setAttribute('data-built', '1');
            host.insertAdjacentHTML('beforeend', '<style>.af-btn{border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:800;cursor:pointer;}.af-mini{border:1px dashed #cbd5e1;background:#f8fafc;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:#475569;}.af-node.sel{z-index:5;}</style>' +
                '<div style="display:flex;height:100%;min-height:640px;">' +
                  '<div style="flex:0 0 210px;border-right:1px solid #e6eaf2;padding:12px;overflow:auto;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div style="font-size:12px;font-weight:800;color:#334155;"><i class="fas fa-diagram-project"></i> Flows</div>' +
                    '<button class="af-btn" onclick="AgentFlow.newFlow()" style="background:#7c3aed;color:white;padding:5px 10px;"><i class="fas fa-plus"></i> New</button></div>' +
                    '<div id="af-list"><div style="font-size:11px;color:#94a3b8;">Loading…</div></div>' +
                  '</div>' +
                  '<div id="af-editor" style="flex:1;padding:14px;overflow:auto;"></div>' +
                '</div>');
            loadFlows(); render();
        },
        newFlow: newFlow, open: open, save: saveFlow, del: del, run: run,
        add: function (t) { if (!flow) return; var n = { id: uid(), type: t, title: TYPES[t].label, x: 120 + Math.round(Math.random() * 60), y: 120 + Math.round(Math.random() * 60), config: defConfig(t) }; flow.nodes.push(n); sel = n.id; render(); },
        select: function (id) { sel = id; connecting = null; render(); },
        delNode: function (id) { flow.nodes = flow.nodes.filter(function (n) { return n.id !== id; }); flow.edges = flow.edges.filter(function (e) { return e.from !== id && e.to !== id; }); if (sel === id) sel = null; render(); },
        delEdge: function (id) { flow.edges = flow.edges.filter(function (e) { return e.id !== id; }); drawEdges(); },
        startEdge: function (from, branch) { connecting = { from: from, branch: branch }; setStatus('<span style="color:#7c3aed;">Connecting from ' + esc(branch) + ' — click a target node…</span>'); },
        setf: function (scope, key, val) { var n = node(sel); if (!n) return; if (scope === 'node') n[key] = val; else { n.config = n.config || {}; n.config[key] = val; } var el = document.getElementById('node-' + sel); if (el) { var body = el.children[1]; if (body) body.textContent = nodeSummary(n); var head = el.querySelector('.af-head span'); if (head && key === 'title') head.textContent = val; } },
        arr: function (arrKey, i, key, val) { var n = node(sel); if (!n || !n.config[arrKey] || !n.config[arrKey][i]) return; n.config[arrKey][i][key] = val; },
        arrAdd: function (arrKey, obj) { var n = node(sel); if (!n) return; (n.config[arrKey] = n.config[arrKey] || []).push(obj); renderInspector(); },
        arrDel: function (arrKey, i) { var n = node(sel); if (!n || !n.config[arrKey]) return; n.config[arrKey].splice(i, 1); renderInspector(); }
    };
    // finish an edge when a target node is clicked
    function finishEdge(toId) {
        if (!connecting || connecting.from === toId) { connecting = null; setStatus(''); return; }
        flow.edges.push({ id: uid('e'), from: connecting.from, to: toId, branch: connecting.branch });
        connecting = null; setStatus(''); drawEdges();
    }
})();
