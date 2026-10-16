/* AI Agent — rich formatting. Everything the agent writes or shows goes through here:
   AGF.md(text)      Markdown → safe HTML: headings, tables (alignment), links, bare URLs / e-mails, bold / italic /
                     strike / ==highlight==, nested + numbered + task lists, quotes, callouts (> [!NOTE|TIP|WARNING|DANGER]),
                     rules, code with Copy, badges [[ok:Text]] (ok, warn, bad, info, muted), inline ```chart (Chart.js JSON)
                     and ```html blocks (sanitized).
   AGF.clean(html)   allow-list sanitizer (no scripts, events, iframes, forms; links become safe agent links).
   AGF.cell(v, f)    one value with a column format: link / email / number / money / percent / date / datetime / badge /
                     bar / bool / bytes / duration / text, plus colour rules.
   Links never navigate the page: http(s) opens the user's browser (host openExternalUrl), ask:… sends a follow-up
   question, page:… opens a WMS page, result:… selects a result tab, mailto: opens the mail app. */

var AGF = window.AGF = {};

AGF.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

// ── links ───────────────────────────────────────────────────────
AGF.safeHref = function (u) {
    u = String(u || '').trim();
    if (/^(https?:\/\/|mailto:|ask:|page:|result:)/i.test(u)) return u;
    if (/^www\./i.test(u)) return 'https://' + u;
    return null;
};
AGF.link = function (href, label, title) {
    var h = AGF.safeHref(href);
    if (!h) return AGF.esc(label);
    var ext = /^https?:/i.test(h), kind = ext ? 'ext' : h.split(':')[0].toLowerCase();
    var icon = ext ? ' <i class="fa-solid fa-arrow-up-right-from-square lk-i"></i>' : kind === 'ask' ? ' <i class="fa-regular fa-comment lk-i"></i>' : '';
    return '<a class="ag-link ' + kind + '" href="#" data-href="' + AGF.esc(h) + '" title="' + AGF.esc(title || (ext ? 'Opens in your browser: ' + h : h)) + '">' + label + icon + '</a>';
};
AGF.openExternal = function (url) {
    if (!/^https?:\/\//i.test(url)) return false;
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({ action: 'openExternalUrl', url: url }); // fire-and-forget
    else window.open(url, '_blank', 'noopener');
    return true;
};
AGF.follow = function (h) {
    if (/^https?:/i.test(h)) { AGF.openExternal(h); if (window.toast) toast('Opened in your browser', 'ok'); return; }
    if (/^mailto:/i.test(h)) { window.location.href = h; return; }
    var rest = h.slice(h.indexOf(':') + 1); try { rest = decodeURIComponent(rest); } catch (e) { /* plain text */ }
    if (/^ask:/i.test(h)) { var inp = document.getElementById('input'); if (inp && window.AG && AG.send) { inp.value = rest; AG.send(); } return; }
    if (/^page:/i.test(h)) { var p = rest.split('?')[0].toLowerCase(); if (AG.PAGES && AG.PAGES[p]) AG.handoff(p, {}); return; }
    if (/^result:/i.test(h) && AG.resById && AG.resById(rest)) AG.selectResult(rest);
};
document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.ag-link, [data-copy]');
    if (!a) return;
    e.preventDefault();
    if (a.hasAttribute('data-copy')) {
        var pre = a.parentNode.querySelector('code, pre');
        if (pre && navigator.clipboard) navigator.clipboard.writeText(pre.innerText).then(function () { if (window.toast) toast('Copied', 'ok'); });
        return;
    }
    AGF.follow(a.getAttribute('data-href'));
});

// ── inline Markdown ─────────────────────────────────────────────
var BADGE = { ok: 'b-ok', good: 'b-ok', success: 'b-ok', warn: 'b-warn', warning: 'b-warn', bad: 'b-bad', error: 'b-bad', danger: 'b-bad', info: 'b-info', muted: 'b-muted' };
AGF.inline = function (src) {
    var keep = [], put = function (h) { keep.push(h); return '\u0000' + (keep.length - 1) + '\u0000'; };
    var t = String(src == null ? '' : src);
    t = t.replace(/`([^`\n]+)`/g, function (_, c) { return put('<code>' + AGF.esc(c) + '</code>'); });
    t = t.replace(/\[([^\]\n]+)\]\(\s*<?((?:ask|page|result):[^)\n]+?|[^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, function (_, l, u, ti) { return put(AGF.link(u, AGF.inline(l), ti)); });
    t = t.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, function (_, u) { return put(AGF.link(u, AGF.esc(u.replace(/^mailto:/, '')))); });
    t = t.replace(/\[\[(\w+):([^\]\n]+)\]\]/g, function (_, k, x) { return put('<span class="tag ' + (BADGE[k.toLowerCase()] || 'b-info') + '">' + AGF.esc(x) + '</span>'); });
    t = t.replace(/\b((?:https?:\/\/|www\.)[^\s<>"'`*]+[^\s<>"'`*.,;:!?)\]])/g, function (u) { return put(AGF.link(u, AGF.esc(u.length > 70 ? u.slice(0, 67) + '…' : u))); });
    t = t.replace(/\b([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b/g, function (m) { return put(AGF.link('mailto:' + m, AGF.esc(m))); });
    t = AGF.esc(t)
        .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>')
        .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1<i>$2</i>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/==(.+?)==/g, '<mark>$1</mark>')
        .replace(/ {2,}$/g, '<br>');
    return t.replace(/\u0000(\d+)\u0000/g, function (_, n) { return keep[+n]; });
};

// ── block Markdown ──────────────────────────────────────────────
function splitRow(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(function (c) { return c.trim().replace(/\\\|/g, '|'); }); }
function tableHtml(head, align, body) {
    var al = function (i) { return align[i] ? ' style="text-align:' + align[i] + '"' : ''; };
    var numCol = head.map(function (_, i) { return body.length && body.every(function (r) { return r[i] == null || r[i] === '' || /^[-+]?[\d,.\s]+%?$/.test(r[i]); }); });
    return '<div class="md-table"><table class="t"><thead><tr>' + head.map(function (h, i) { return '<th' + (align[i] ? al(i) : numCol[i] ? ' class="n"' : '') + '>' + AGF.inline(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        body.map(function (r) { return '<tr>' + head.map(function (_, i) { return '<td' + (align[i] ? al(i) : numCol[i] ? ' class="n"' : '') + '>' + AGF.inline(r[i] == null ? '' : r[i]) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div>';
}
function listHtml(lines) {
    // lines: [{indent, ordered, text}] → nested lists
    var html = '', stack = [];
    lines.forEach(function (it) {
        while (stack.length && it.indent < stack[stack.length - 1].indent) html += '</li></' + stack.pop().tag + '>';
        var top = stack[stack.length - 1];
        if (!top || it.indent > top.indent) { var tag = it.ordered ? 'ol' : 'ul'; html += '<' + tag + (it.start && it.start !== 1 ? ' start="' + it.start + '"' : '') + '>'; stack.push({ indent: it.indent, tag: tag }); }
        else html += '</li>';
        var tx = it.text, task = tx.match(/^\[([ xX])\]\s+(.*)/);
        html += task ? '<li class="task"><i class="fa-' + (task[1] === ' ' ? 'regular fa-square' : 'solid fa-square-check') + '"></i> ' + AGF.inline(task[2]) : '<li>' + AGF.inline(tx);
    });
    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return html;
}
var CALLOUT = { NOTE: ['note', 'fa-circle-info'], INFO: ['note', 'fa-circle-info'], TIP: ['tip', 'fa-lightbulb'], IMPORTANT: ['tip', 'fa-star'], WARNING: ['warn', 'fa-triangle-exclamation'], CAUTION: ['bad', 'fa-hand'], DANGER: ['bad', 'fa-circle-exclamation'] };
AGF.charts = [];
function fenceHtml(lang, code) {
    lang = (lang || '').toLowerCase();
    if (lang === 'html') return '<div class="md-html">' + AGF.clean(code) + '</div>';
    if (lang === 'chart') {
        try { var spec = JSON.parse(code); var id = 'mdc_' + Math.random().toString(36).slice(2, 9); AGF.charts.push({ id: id, spec: spec }); setTimeout(AGF.drawCharts, 0); return '<div class="md-chart"><canvas id="' + id + '"></canvas></div>'; }
        catch (e) { /* not JSON: show as code */ }
    }
    return '<div class="md-code"><button class="copy" data-copy title="Copy"><i class="fa-regular fa-copy"></i></button><pre data-lang="' + AGF.esc(lang) + '"><code>' + AGF.esc(code.replace(/\n$/, '')) + '</code></pre></div>';
}
AGF.md = function (text) {
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n'), lines = src.split('\n'), out = '', i = 0;
    var para = [];
    var flush = function () { if (para.length) { out += '<p>' + para.map(AGF.inline).join('<br>') + '</p>'; para = []; } };
    while (i < lines.length) {
        var l = lines[i], m;
        if ((m = l.match(/^\s*(```+|~~~+)\s*([\w-]*)\s*$/))) {
            flush(); var fence = m[1], code = []; i++;
            while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) code.push(lines[i++]);
            i++; out += fenceHtml(m[2], code.join('\n')); continue;
        }
        if (!l.trim()) { flush(); i++; continue; }
        if ((m = l.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) { flush(); var lv = Math.min(m[1].length + 1, 6); out += '<h' + lv + ' class="md-h">' + AGF.inline(m[2]) + '</h' + lv + '>'; i++; continue; }
        if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out += '<hr>'; i++; continue; }
        if (/\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
            flush(); var head = splitRow(l), align = splitRow(lines[i + 1]).map(function (a) { return /^:-+:$/.test(a) ? 'center' : /-+:$/.test(a) ? 'right' : /^:-+/.test(a) ? 'left' : ''; }), body = [];
            i += 2; while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) body.push(splitRow(lines[i++]));
            out += tableHtml(head, align, body); continue;
        }
        if (/^\s*>/.test(l)) {
            flush(); var q = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
            var co = q[0] && q[0].match(/^\[!(\w+)\]\s*(.*)$/), kind = co && CALLOUT[co[1].toUpperCase()];
            if (kind) { var ttl = co[2] || co[1].charAt(0) + co[1].slice(1).toLowerCase(); out += '<div class="callout ' + kind[0] + '"><div class="co-t"><i class="fa-solid ' + kind[1] + '"></i> ' + AGF.inline(ttl) + '</div>' + AGF.md(q.slice(1).join('\n')) + '</div>'; }
            else out += '<blockquote>' + AGF.md(q.join('\n')) + '</blockquote>';
            continue;
        }
        if (/^\s*(?:[-*+•]|\d+[.)])\s+/.test(l)) {
            flush(); var items = [];
            while (i < lines.length) {
                var li = lines[i], mm = li.match(/^(\s*)([-*+•]|(\d+)[.)])\s+(.*)$/);
                if (mm) { items.push({ indent: mm[1].replace(/\t/g, '    ').length, ordered: !!mm[3], start: mm[3] ? +mm[3] : 1, text: mm[4] }); i++; }
                else if (li.trim() && /^\s{2,}/.test(li) && items.length) { items[items.length - 1].text += ' ' + li.trim(); i++; }
                else break;
            }
            out += listHtml(items); continue;
        }
        if (/^\s*<(div|table|p|span|h\d|ul|ol|b|strong|i|em|a|br|section|details|mark|small)\b/i.test(l)) {
            flush(); var block = [];
            while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
            out += AGF.clean(block.join('\n')); continue;
        }
        para.push(l); i++;
    }
    flush();
    return out;
};

// ── inline charts (```chart {"type":"bar","labels":[…],"datasets":[{"label":"…","data":[…]}],"title":"…"}) ──
AGF.drawCharts = function () {
    if (!window.Chart) {   // Chart.js not loaded (offline): show the numbers as a table instead
        AGF.charts = AGF.charts.filter(function (c) {
            var cv = document.getElementById(c.id); if (!cv) return true;
            var s = c.spec || {}, ds = s.datasets || [{ label: s.label || 'Value', data: s.data || s.values || [] }];
            cv.parentNode.outerHTML = (s.title ? '<p><b>' + AGF.esc(s.title) + '</b></p>' : '') + '<div class="md-table"><table class="t"><thead><tr><th></th>' + ds.map(function (d) { return '<th class="n">' + AGF.esc(d.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                (s.labels || []).map(function (l, i) { return '<tr><td>' + AGF.esc(l) + '</td>' + ds.map(function (d) { return '<td class="n">' + AGF.esc(AGF.text((d.data || [])[i], { format: 'number' })) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
            return false;
        });
        return;
    }
    AGF.charts = AGF.charts.filter(function (c) {
        var cv = document.getElementById(c.id); if (!cv) return true;   // not in the DOM yet
        var s = c.spec || {}, type = { column: 'bar', bar: 'bar', line: 'line', area: 'line', pie: 'pie', donut: 'doughnut', doughnut: 'doughnut' }[s.type] || 'bar';
        var pal = (window.AG && AG.PALETTE) || ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#7c5cd6', '#0aa1b0'];
        var ds = (s.datasets || [{ label: s.label || '', data: s.data || s.values || [] }]).slice(0, 8).map(function (d, k) {
            var col = pal[k % pal.length], round = type === 'pie' || type === 'doughnut';
            return { label: d.label, data: d.data || [], backgroundColor: round ? (d.data || []).map(function (_, j) { return pal[j % pal.length]; }) : col + (s.type === 'area' ? '33' : ''),
                borderColor: round ? '#fff' : col, fill: s.type === 'area', tension: 0.25, borderWidth: round ? 2 : (type === 'line' ? 2 : 0), borderRadius: type === 'bar' ? 4 : 0, pointRadius: type === 'line' ? 2 : 0 };
        });
        try {
            new Chart(cv, { type: type, data: { labels: s.labels || [], datasets: ds }, options: { responsive: true, maintainAspectRatio: false, indexAxis: s.type === 'bar' && s.horizontal ? 'y' : 'x',
                plugins: { legend: { display: ds.length > 1 || type === 'pie' || type === 'doughnut', position: 'bottom' }, title: { display: !!s.title, text: s.title } },
                scales: type === 'pie' || type === 'doughnut' ? {} : { y: { beginAtZero: true, grid: { color: '#eef2f7' } }, x: { grid: { display: false } } } } });
        } catch (e) { cv.parentNode.innerHTML = '<span class="muted sm">Chart: ' + AGF.esc(e.message || e) + '</span>'; }
        return false;
    });
};
if (window.MutationObserver) new MutationObserver(function () { if (AGF.charts.length) AGF.drawCharts(); }).observe(document.documentElement, { childList: true, subtree: true });

// ── HTML sanitizer (allow-list) ─────────────────────────────────
var TAGS = 'a b strong i em u s del ins mark small sub sup br hr p div span section article header footer h1 h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote pre code kbd table thead tbody tfoot tr th td caption colgroup col details summary figure figcaption img abbr time progress meter'.split(' ');
var DROP = { script: 1, style: 1, iframe: 1, object: 1, embed: 1, form: 1, input: 1, button: 1, textarea: 1, select: 1, link: 1, meta: 1, base: 1, svg: 1, math: 1, frame: 1, frameset: 1, template: 1, noscript: 1, audio: 1, video: 1 };
var ATTRS = { colspan: 1, rowspan: 1, align: 1, valign: 1, width: 1, height: 1, title: 1, alt: 1, open: 1, start: 1, value: 1, max: 1, min: 1, low: 1, high: 1, optimum: 1, datetime: 1, scope: 1, class: 1, style: 1 };
AGF.cleanStyle = function (st) {
    return String(st || '').split(';').map(function (d) { return d.trim(); }).filter(function (d) {
        if (!d || !/^[a-z-]+\s*:/i.test(d)) return false;
        var p = d.split(':')[0].trim().toLowerCase(), v = d.slice(d.indexOf(':') + 1).toLowerCase();
        if (/url\s*\(|expression|javascript:|@import|behavior|-moz-binding/.test(v)) return false;
        if (p === 'position' && /fixed|sticky/.test(v)) return false;
        if (p === 'z-index') return false;
        return true;
    }).join('; ');
};
AGF.clean = function (html) {
    var doc;
    try { doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html'); } catch (e) { return AGF.esc(html); }
    var walk = function (node) {
        Array.prototype.slice.call(node.childNodes).forEach(function (n) {
            if (n.nodeType === 3) return;
            if (n.nodeType !== 1) { n.remove(); return; }
            var tag = n.tagName.toLowerCase();
            if (DROP[tag]) { n.remove(); return; }
            walk(n);
            if (TAGS.indexOf(tag) < 0) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); return; }
            var href = tag === 'a' ? n.getAttribute('href') : null, src = tag === 'img' ? n.getAttribute('src') : null;
            Array.prototype.slice.call(n.attributes).forEach(function (a) {
                var an = a.name.toLowerCase();
                if (!ATTRS[an]) n.removeAttribute(a.name);
                else if (an === 'style') n.setAttribute('style', AGF.cleanStyle(a.value));
                else if (an === 'class') n.setAttribute('class', a.value.split(/\s+/).filter(function (c) { return /^(tag|b-\w+|callout|note|tip|warn|bad|kpi|kpis|muted|sm|n|chip|t)$/.test(c); }).join(' '));
            });
            if (tag === 'a') { var h = AGF.safeHref(href); if (h) { n.setAttribute('href', '#'); n.setAttribute('data-href', h); n.classList.add('ag-link'); if (/^https?:/i.test(h)) n.title = n.title || 'Opens in your browser: ' + h; } else n.removeAttribute('href'); }
            if (tag === 'img') { if (src && /^(https:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(src)) { n.setAttribute('src', src); n.setAttribute('loading', 'lazy'); n.setAttribute('referrerpolicy', 'no-referrer'); n.style.maxWidth = '100%'; } else n.remove(); }
        });
    };
    var root = doc.body.firstChild; walk(root);
    return root.innerHTML;
};

// ── cell formats (results grid, grid cards, reports) ────────────
AGF.FORMATS = ['text', 'link', 'email', 'number', 'money', 'percent', 'date', 'datetime', 'badge', 'bar', 'bool', 'bytes', 'duration'];
var COLORS = { green: 'b-ok', ok: 'b-ok', amber: 'b-warn', orange: 'b-warn', warn: 'b-warn', yellow: 'b-warn', red: 'b-bad', bad: 'b-bad', blue: 'b-info', info: 'b-info', grey: 'b-muted', gray: 'b-muted', muted: 'b-muted' };
var AUTO_BADGE = [[/^(ok|done|success|succeeded|completed?|accepted|approved|printed|closed|active|yes|y|true|on|pass(ed)?|valid|paid|shipped|fulfilled)$/i, 'b-ok'],
    [/^(fail(ed|ure)?|error|rejected|cancell?ed|blocked|denied|no|n|false|off|invalid|overdue|not[_ ]sent|expired)$/i, 'b-bad'],
    [/^(pending|queued|waiting|running|in[_ ]progress|partial|draft|hold|on[_ ]hold|warning|open|new|submitted|learning)$/i, 'b-warn']];
function ruleHit(v, r) {
    var n = parseFloat(v), x = parseFloat(r.value), op = r.op || '=';
    if (op === '=' || op === '==') return String(v).toLowerCase() === String(r.value).toLowerCase();
    if (op === '!=') return String(v).toLowerCase() !== String(r.value).toLowerCase();
    if (op === 'contains') return String(v).toLowerCase().indexOf(String(r.value).toLowerCase()) >= 0;
    if (isNaN(n) || isNaN(x)) return false;
    return op === '>' ? n > x : op === '>=' ? n >= x : op === '<' ? n < x : op === '<=' ? n <= x : false;
}
AGF.ruleClass = function (v, f) {
    if (!f) return '';
    if (f.colors && v != null && f.colors[String(v)] != null) return COLORS[String(f.colors[String(v)]).toLowerCase()] || '';
    var hit = (f.rules || []).filter(function (r) { return ruleHit(v, r); })[0];
    return hit ? (COLORS[String(hit.color || '').toLowerCase()] || 'b-warn') : '';
};
function toDate(v) {
    if (v == null || v === '') return null;
    var s = String(v), d = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T')) : new Date(s);
    return isNaN(d) ? null : d;
}
function numOf(v) { var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; }
AGF.fill = function (tpl, v, row) {
    return String(tpl).replace(/\{([A-Za-z0-9_ ]+|VALUE)\}/g, function (_, k) { var x = k === 'VALUE' ? v : row ? row[k] != null ? row[k] : row[k.toUpperCase()] : ''; return encodeURIComponent(x == null ? '' : x); });
};
/** Text a format would show (for CSV / copy keep the raw value; this is for display). f = {format, decimals, currency, …} */
AGF.text = function (v, f) {
    f = f || {}; if (v == null || v === '') return '';
    var fm = f.format || 'text', d = f.decimals, n;
    switch (fm) {
        case 'number': n = numOf(v); return n == null ? String(v) : n.toLocaleString(undefined, { minimumFractionDigits: d != null ? d : 0, maximumFractionDigits: d != null ? d : (Math.abs(n) >= 1000 ? 0 : 2) });
        case 'money': n = numOf(v); if (n == null) return String(v);
            try { return n.toLocaleString(undefined, { style: 'currency', currency: (f.currency || 'MUR').toUpperCase(), minimumFractionDigits: d != null ? d : 2, maximumFractionDigits: d != null ? d : 2 }); }
            catch (e) { return (f.currency || '') + ' ' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
        case 'percent': n = numOf(v); if (n == null) return String(v); if (f.ratio) n *= 100; return n.toLocaleString(undefined, { maximumFractionDigits: d != null ? d : 1 }) + ' %';
        case 'date': var dt = toDate(v); return dt ? dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : String(v);
        case 'datetime': var dtt = toDate(v); return dtt ? dtt.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : String(v);
        case 'bool': return /^(1|y|yes|true|on)$/i.test(String(v)) ? '✔' : '✘';
        case 'bytes': n = numOf(v); if (n == null) return String(v); var u = ['B', 'KB', 'MB', 'GB', 'TB'], k = 0; while (n >= 1024 && k < 4) { n /= 1024; k++; } return n.toFixed(k ? 1 : 0) + ' ' + u[k];
        case 'duration': n = numOf(v); if (n == null) return String(v); if (f.unit === 'ms') n /= 1000; if (f.unit === 'min') n *= 60;
            var h = Math.floor(n / 3600), mi = Math.floor(n % 3600 / 60), se = Math.round(n % 60); return (h ? h + 'h ' : '') + (h || mi ? mi + 'm ' : '') + se + 's';
        default: return String(v);
    }
};
/** HTML of one cell. ctx = {row (object by column name), max (for bar)} */
AGF.cell = function (v, f, ctx) {
    f = f || {}; ctx = ctx || {};
    var fm = f.format || 'auto', cls = AGF.ruleClass(v, f);
    if (v == null || v === '') return '';
    if (fm === 'auto') {
        var s = String(v);
        if (/^(https?:\/\/|www\.)\S+$/i.test(s)) return AGF.link(s, AGF.esc(s.length > 48 ? s.replace(/^https?:\/\//, '').slice(0, 45) + '…' : s.replace(/^https?:\/\//, '')));
        if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) return AGF.link('mailto:' + s, AGF.esc(s));
        return cls ? '<span class="tag ' + cls + '">' + AGF.esc(s) + '</span>' : AGF.esc(s);
    }
    if (fm === 'link' || fm === 'email') {
        var href = fm === 'email' ? 'mailto:' + v : f.url ? AGF.fill(f.url, v, ctx.row) : String(v);
        var lab = f.label ? String(f.label).replace(/\{VALUE\}/g, v) : String(v);
        return AGF.link(href, AGF.esc(lab.length > 60 ? lab.slice(0, 57) + '…' : lab));
    }
    if (fm === 'badge') return '<span class="tag ' + (cls || (AUTO_BADGE.filter(function (b) { return b[0].test(String(v).trim()); })[0] || [0, 'b-info'])[1]) + '">' + AGF.esc(v) + '</span>';
    if (fm === 'bar') {
        var n = numOf(v), mx = f.max != null ? f.max : ctx.max || n || 1, pct = n == null ? 0 : Math.max(0, Math.min(100, n / mx * 100));
        return '<span class="cbar"><span style="width:' + pct.toFixed(1) + '%"' + (cls ? ' class="' + cls + '"' : '') + '></span><em>' + AGF.esc(AGF.text(v, { format: f.of || 'number', decimals: f.decimals, currency: f.currency, ratio: f.ratio, unit: f.unit })) + '</em></span>';
    }
    var txt = AGF.esc(AGF.text(v, f));
    if (fm === 'bool') return '<span class="tag ' + (cls || (txt === '✔' ? 'b-ok' : 'b-bad')) + '">' + txt + '</span>';
    if (cls) return '<span class="tag ' + cls + '">' + txt + '</span>';
    if ((fm === 'money' || fm === 'number' || fm === 'percent') && f.negative !== false && numOf(v) < 0) return '<span class="neg">' + txt + '</span>';
    return txt;
};
AGF.isNumFormat = function (f) { return f && /^(number|money|percent|bar|bytes|duration)$/.test(f.format || ''); };
/** Validates a format spec from the model: returns an error text or null. */
AGF.checkFormat = function (name, f) {
    if (!f || typeof f !== 'object') return name + ': format must be an object';
    if (f.format && AGF.FORMATS.indexOf(f.format) < 0) return name + ': unknown format ' + f.format + ' (use ' + AGF.FORMATS.join(', ') + ')';
    if (f.url && !/^(https?:\/\/|mailto:|ask:|page:|result:)/i.test(f.url)) return name + ': url must start with https://, mailto:, ask:, page: or result:';
    return null;
};
