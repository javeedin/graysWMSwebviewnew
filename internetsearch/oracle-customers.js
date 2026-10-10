// ============================================================
// ORACLE CUSTOMERS - free-form "Ask the internet" panel
// ============================================================
// Type any question (e.g. "list Oracle Fusion customers in UAE with
// industry and modules"). Each question opens its OWN result tab that:
//   1) does a REAL internet search (SerpApi / Google) via the executeGet
//      bridge,
//   2) asks the AI to synthesise those web results - with a prompt that
//      HARD-FORBIDS the local WMS database (GRFU_CUSTOMER),
//   3) renders the markdown answer + a clickable "Web sources" list, and
//   4) offers Export to Excel (the answer's table, else the web sources).
// This tab is an INTERNET assistant - it never queries the local DB.
// ============================================================

(function () {
    'use strict';

    var SUGGESTIONS = [
        'List Oracle Fusion customers in the UAE with industry and modules — as a table',
        'Which banks in India use Oracle Fusion Cloud ERP?',
        'Top 20 retailers in the Middle East using Oracle Cloud, with country',
        'Compare Oracle Fusion Cloud ERP vs SAP S/4HANA in 6 bullet points',
        'Which UAE government entities have adopted Oracle Cloud?'
    ];

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function bridge(msg, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb('bridge unavailable'); return; }
        sendMessageToCSharp(msg, cb);
    }
    function aiSend(prompt, cb) {
        bridge({ action: 'aiChatSend', text: '[CURRENT_INSTANCE: PROD]\n' + prompt, sessionId: null, instance: 'PROD' }, function (err, resp) {
            if (err) return cb(String(err));
            cb(null, (resp && (resp.markdown || resp.answer)) || '');
        });
    }
    // SerpApi key is shared with the IT Jobs settings (localStorage is_settings_v1)
    function serpKey() { try { var s = JSON.parse(localStorage.getItem('is_settings_v1') || 'null'); return (s && s.keys && s.keys.serpapi) || ''; } catch (e) { return ''; } }
    // Real internet search via SerpApi (Google). Returns organic results + answer box.
    function webSearch(query, cb) {
        var key = serpKey();
        if (!key) { cb('no-key'); return; }
        var url = 'https://serpapi.com/search.json?engine=google&hl=en&num=10&q=' + encodeURIComponent(query) + '&api_key=' + encodeURIComponent(key);
        bridge({ action: 'executeGet', fullUrl: url }, function (err, data) {
            if (err) return cb(String(err));
            try {
                var j = typeof data === 'string' ? JSON.parse(data) : data;
                if (j && j.error) return cb(j.error);
                var organic = (j.organic_results || []).slice(0, 10).map(function (r) { return { title: r.title || '', link: r.link || '', snippet: r.snippet || '' }; });
                var answer = (j.answer_box && (j.answer_box.answer || j.answer_box.snippet)) || '';
                cb(null, { organic: organic, answer: answer });
            } catch (e) { cb('bad web response'); }
        });
    }
    function openUrl(u) {
        if (!u) return;
        if (typeof sendMessageToCSharp === 'function' && window.chrome && window.chrome.webview) sendMessageToCSharp({ action: 'openExternalUrl', url: u });
        else window.open(u, '_blank', 'noopener');
    }
    window.__ocOpen = openUrl;

    // ── tiny markdown -> HTML (headings, tables, lists, bold/italic/code, links) ──
    function inline(s) {
        s = esc(s);
        s = s.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:5px;font-size:12px;">$1</code>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#0284c7;">$1</a>');
        return s;
    }
    function mdToHtml(md) {
        var lines = String(md || '').replace(/\r/g, '').split('\n');
        var out = [], i = 0;
        function isTableSep(l) { return /^\s*\|?\s*:?-{2,}.*\|/.test(l) || /^\s*:?-{2,}\s*(\|\s*:?-{2,}\s*)+\|?\s*$/.test(l); }
        while (i < lines.length) {
            var line = lines[i];
            // fenced code
            if (/^```/.test(line)) {
                var code = []; i++;
                while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
                i++;
                out.push('<pre style="background:#0b1020;color:#d1e7ff;padding:11px;border-radius:8px;overflow:auto;font-size:12px;">' + esc(code.join('\n')) + '</pre>');
                continue;
            }
            // table: header row followed by separator row
            if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
                var head = line.split('|').map(function (c) { return c.trim(); }).filter(function (c, idx, arr) { return !(c === '' && (idx === 0 || idx === arr.length - 1)); });
                i += 2;
                var body = [];
                while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
                    body.push(lines[i].split('|').map(function (c) { return c.trim(); }).filter(function (c, idx, arr) { return !(c === '' && (idx === 0 || idx === arr.length - 1)); }));
                    i++;
                }
                out.push('<div style="overflow:auto;border:1px solid #eef2f7;border-radius:10px;margin:6px 0;">' +
                    '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">' +
                    '<thead><tr style="background:#f8fafc;">' + head.map(function (h) { return '<th style="padding:8px 10px;text-align:left;font-size:10.5px;color:#475569;text-transform:uppercase;">' + inline(h) + '</th>'; }).join('') + '</tr></thead>' +
                    '<tbody>' + body.map(function (r) { return '<tr style="border-top:1px solid #f1f5f9;">' + r.map(function (c) { return '<td style="padding:7px 10px;color:#334155;">' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
                continue;
            }
            // headings
            var h = line.match(/^(#{1,4})\s+(.*)$/);
            if (h) { var lvl = h[1].length; var sz = [0, 20, 17, 15, 13][lvl] || 13; out.push('<div style="font-size:' + sz + 'px;font-weight:800;color:#0f172a;margin:12px 0 6px;">' + inline(h[2]) + '</div>'); i++; continue; }
            // lists
            if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
                var ordered = /^\s*\d+\.\s+/.test(line);
                var items = [];
                while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
                out.push('<' + (ordered ? 'ol' : 'ul') + ' style="margin:6px 0 6px 20px;font-size:13px;color:#334155;line-height:1.55;">' + items.map(function (it) { return '<li>' + inline(it) + '</li>'; }).join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
                continue;
            }
            // blank
            if (line.trim() === '') { i++; continue; }
            // paragraph (gather until blank)
            var para = [line]; i++;
            while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !(/\|/.test(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) { para.push(lines[i]); i++; }
            out.push('<p style="margin:6px 0;font-size:13px;color:#334155;line-height:1.6;">' + inline(para.join(' ')) + '</p>');
        }
        return out.join('');
    }

    // ── markdown-table extractor (for Export to Excel) ──────────
    function splitRow(l) { return l.split('|').map(function (c) { return c.trim(); }).filter(function (c, idx, arr) { return !(c === '' && (idx === 0 || idx === arr.length - 1)); }); }
    function firstMdTable(md) {
        var lines = String(md || '').replace(/\r/g, '').split('\n');
        for (var i = 0; i < lines.length - 1; i++) {
            if (/\|/.test(lines[i]) && /\|/.test(lines[i + 1]) && /-/.test(lines[i + 1]) && /^[\s|:\-]+$/.test(lines[i + 1])) {
                var head = splitRow(lines[i]);
                if (!head.length) continue;
                var rows = [], j = i + 2;
                while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') { rows.push(splitRow(lines[j])); j++; }
                rows = rows.map(function (r) { while (r.length < head.length) r.push(''); return r.slice(0, head.length); });
                return { columns: head, rows: rows };
            }
        }
        return null;
    }
    function stampOC() { var d = new Date(); function z(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()); }

    // per-tab store so Export to Excel can find the answer/sources later
    var ANS = {};   // tabId -> { md, results }

    function ocShell(tid, q) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">' +
            '<div style="font-size:15px;font-weight:800;color:#0f172a;min-width:0;"><i class="fas fa-globe" style="color:#0f766e;"></i> ' + esc(q) + '</div>' +
            '<button class="btn btn-excel" onclick="OracleCustomers.exportTab(\'' + tid + '\')"><i class="fas fa-file-excel"></i> Export to Excel</button>' +
            '</div><div id="oc-ans-' + tid + '"></div>';
    }

    window.OracleCustomers = {
        init: function () {
            var chips = document.getElementById('oc-chips');
            if (chips && !chips.getAttribute('data-built')) {
                chips.setAttribute('data-built', '1');
                chips.innerHTML = SUGGESTIONS.map(function (s) {
                    return '<span onclick="OracleCustomers.fill(this)" data-q="' + esc(s) + '" style="cursor:pointer;font-size:11px;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:14px;padding:4px 11px;">' + esc(s.length > 52 ? s.slice(0, 50) + '…' : s) + '</span>';
                }).join('');
            }
            var ta = document.getElementById('oc-q');
            if (ta && !ta.getAttribute('data-bound')) {
                ta.setAttribute('data-bound', '1');
                ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); OracleCustomers.ask(); } });
            }
        },
        fill: function (el) { var ta = document.getElementById('oc-q'); if (ta) { ta.value = el.getAttribute('data-q'); ta.focus(); } },
        clear: function () { var ta = document.getElementById('oc-q'); if (ta) ta.value = ''; var w = document.getElementById('oc-warn'); if (w) w.innerHTML = ''; },

        ask: function () {
            var ta = document.getElementById('oc-q');
            var q = (ta ? ta.value : '').trim();
            var warn = document.getElementById('oc-warn');
            if (!q) { if (warn) warn.innerHTML = '<span style="color:#b45309;font-size:12px;">Type a question first.</span>'; return; }
            if (warn) warn.innerHTML = '';

            // open a fresh result tab for this question
            var tab = IS.newResultTab(q.length > 30 ? q.slice(0, 28) + '…' : q, 'fa-globe');
            var tid = tab.id;
            tab.panel.innerHTML = ocShell(tid, q);
            var ans = document.getElementById('oc-ans-' + tid);
            ANS[tid] = { md: '', results: [] };
            ans.innerHTML = '<div style="border:1px solid #eef2f7;border-radius:12px;padding:14px 16px;background:#fff;color:#0284c7;font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Searching the web…</div>';

            // Step 1: real internet search. Then feed the web results to the AI.
            webSearch(q, function (werr, web) {
                var results = (web && web.organic) || [];
                var answerBox = (web && web.answer) || '';
                var noKey = werr === 'no-key';
                ANS[tid].results = results;

                if (!noKey) ans.innerHTML = '<div style="border:1px solid #eef2f7;border-radius:12px;padding:14px 16px;background:#fff;color:#0284c7;font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Reading ' + results.length + ' web result' + (results.length === 1 ? '' : 's') + '…</div>';

                var ctx = '';
                if (answerBox) ctx += 'ANSWER BOX: ' + answerBox + '\n\n';
                if (results.length) {
                    ctx += 'WEB SEARCH RESULTS:\n' + results.map(function (r, n) {
                        return (n + 1) + '. ' + r.title + '\n   URL: ' + r.link + '\n   ' + r.snippet;
                    }).join('\n\n');
                }

                var prompt =
                    'You are an INTERNET research assistant. Answer the question below using ONLY public, real-world knowledge and the web search results provided.\n' +
                    'STRICT RULES:\n' +
                    '- DO NOT query, read, or reference the WMS / Oracle database, GRFU_CUSTOMER, or any internal/local table.\n' +
                    '- DO NOT run SQL or use any database tool. This is about companies on the public internet, not our customers.\n' +
                    '- Base your answer on the web results below (and your general knowledge of the public market). Cite which companies/facts you are confident about.\n' +
                    '- Answer in clear markdown. When listing companies or items, use a markdown table with sensible columns (e.g. Company, Country, Industry, Notes).\n' +
                    '- If the web results are thin, still give the best public-knowledge answer and say what is uncertain.\n\n' +
                    'QUESTION: ' + q + '\n\n' +
                    (ctx ? ('--- WEB CONTEXT (from live internet search) ---\n' + ctx + '\n--- END WEB CONTEXT ---') :
                        (noKey ? '(No web search key configured — answer from public knowledge only. Tip: add a SerpApi key in Setup & Keys for live results.)' : '(No web results found — answer from public knowledge only.)'));

                aiSend(prompt, function (err, md) {
                    ANS[tid].md = md || '';
                    var sourcesHtml = results.length ? (
                        '<div style="margin-top:14px;border-top:1px solid #f1f5f9;padding-top:10px;">' +
                        '<div style="font-size:10.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.3px;margin-bottom:7px;"><i class="fas fa-link"></i> Web sources</div>' +
                        results.map(function (r) {
                            return '<div style="margin-bottom:8px;">' +
                                '<a href="#" onclick="__ocOpen(' + JSON.stringify(esc(r.link)) + ');return false;" style="color:#0284c7;font-size:12.5px;font-weight:600;text-decoration:none;">' + esc(r.title || r.link) + '</a>' +
                                '<div style="font-size:11px;color:#94a3b8;">' + esc(r.link) + '</div>' +
                                (r.snippet ? '<div style="font-size:11.5px;color:#64748b;margin-top:2px;">' + esc(r.snippet) + '</div>' : '') +
                                '</div>';
                        }).join('') + '</div>'
                    ) : '';

                    if (err) {
                        ans.innerHTML = '<div style="border:1px solid #eef2f7;border-radius:12px;padding:16px 18px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.05);">' +
                            '<div style="color:#b91c1c;font-size:12.5px;margin-bottom:6px;"><i class="fas fa-triangle-exclamation"></i> AI synthesis failed (' + esc(err) + ')' + (results.length ? ' — showing raw web results.' : '.') + '</div>' +
                            sourcesHtml +
                            (noKey ? '<div style="font-size:12px;color:#64748b;">No SerpApi key configured. Add one in <b>Setup &amp; Keys</b> to enable live internet search.</div>' : '') +
                            '</div>';
                        return;
                    }
                    var bodyHtml = md ? mdToHtml(md) : '<div style="color:#64748b;font-size:13px;">No synthesis returned.</div>';
                    ans.innerHTML = '<div style="border:1px solid #eef2f7;border-radius:12px;padding:16px 18px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.05);">' + bodyHtml + sourcesHtml +
                        '<div style="font-size:10.5px;color:#94a3b8;margin-top:10px;border-top:1px solid #f1f5f9;padding-top:8px;"><i class="fas fa-globe"></i> Answered from the public internet' + (results.length ? ' (' + results.length + ' web sources)' : '') + ' — not the WMS database. Verify before relying on it.</div></div>';
                });
            });
        },

        exportTab: function (tid) {
            var d = ANS[tid];
            if (!d) { alert('Nothing to export yet.'); return; }
            var cols, rows;
            var t = firstMdTable(d.md);
            if (t && t.rows.length) { cols = t.columns; rows = t.rows; }
            else if (d.results && d.results.length) { cols = ['Title', 'URL', 'Snippet']; rows = d.results.map(function (r) { return [r.title || '', r.link || '', r.snippet || '']; }); }
            else { alert('No tabular data to export yet. Wait for the answer, or ask for a list/table.'); return; }
            IS.exportExcel('oracle_customers_' + stampOC() + '.xls', cols, rows);
        }
    };
})();
