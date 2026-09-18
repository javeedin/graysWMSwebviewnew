// ============================================================
// ORACLE CUSTOMERS - free-form "Ask anything" panel
// ============================================================
// Type any question (e.g. "list Oracle Fusion customers in UAE with
// industry and modules") and the AI Digital Employee answers. The reply
// (markdown) is rendered to HTML - headings, tables, lists, links, code.
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
        clear: function () { var ta = document.getElementById('oc-q'); if (ta) ta.value = ''; var a = document.getElementById('oc-answer'); if (a) a.innerHTML = ''; },
        ask: function () {
            var ta = document.getElementById('oc-q');
            var ans = document.getElementById('oc-answer');
            var q = (ta ? ta.value : '').trim();
            if (!q) { if (ans) ans.innerHTML = '<div style="color:#b45309;font-size:12px;">Type a question first.</div>'; return; }
            ans.innerHTML = '<div style="border:1px solid #eef2f7;border-radius:12px;padding:14px 16px;background:#fff;color:#0284c7;font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Thinking…</div>';
            // light nudge so lists come back as clean tables, but keep it free-form
            var prompt = q + '\n\n(Answer in clear markdown. When listing companies or items, use a markdown table with sensible columns.)';
            aiSend(prompt, function (err, md) {
                if (err) { ans.innerHTML = '<div style="border:1px solid #fecaca;background:#fff1f2;border-radius:12px;padding:14px 16px;color:#b91c1c;font-size:13px;">AI error: ' + esc(err) + '</div>'; return; }
                if (!md) { ans.innerHTML = '<div style="border:1px solid #eef2f7;border-radius:12px;padding:14px 16px;color:#64748b;font-size:13px;">No answer returned. Try rephrasing.</div>'; return; }
                ans.innerHTML = '<div style="border:1px solid #eef2f7;border-radius:12px;padding:16px 18px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.05);">' + mdToHtml(md) +
                    '<div style="font-size:10.5px;color:#94a3b8;margin-top:10px;border-top:1px solid #f1f5f9;padding-top:8px;"><i class="fas fa-circle-info"></i> AI-generated from public information — verify before relying on it.</div></div>';
            });
        }
    };
})();
