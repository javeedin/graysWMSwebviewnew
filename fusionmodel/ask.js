/* Fusion Model — Ask tab: questions answered by Claude with the model's read-only tools (search, describe, measures,
   values, SQL; the user's security roles apply), a live catalog search (words + fuzzy + glossary + values + examples
   + optional vectors) and the verified examples. Host actions: fmAsk (+ fmProgress), fmAskCancel, fmSearch,
   fmExamples, fmExampleSave, fmExampleDelete. */

var AK = { thread: [], examples: null, hits: [], q: '', running: false };
var KIND_ICON = { measure: 'fa-calculator', table: 'fa-table', column: 'fa-table-columns', term: 'fa-book', example: 'fa-circle-check', value: 'fa-quote-left' };

function renderAsk() {
    if (AK.examples == null) loadExamples();
    $('ask-thread').innerHTML = AK.thread.length ? AK.thread.map(renderTurn).join('') :
        '<div class="empty"><div class="art"><i class="fa-solid fa-wand-magic-sparkles"></i></div><h2>Ask the model</h2>' +
        '<p>Claude answers from the <b>measures</b> your business defined, the glossary and the verified examples — every number comes from a query you can re-run.</p>' +
        '<div class="ask-sugg">' + ['What were sales by month this year vs last year?', 'Which customers have the most open orders?', 'What is the fill rate by trip this week?'].map(function (s) {
            return '<button class="chip" data-ask="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div></div>';
    renderSearch();
    $('ask-thread').scrollTop = 1e9;
}

function renderTurn(t, i) {
    if (t.role === 'user') return '<div class="msg user"><div class="bubble">' + esc(t.content) + '</div></div>';
    var steps = (t.steps || []).length ? '<details class="steps"><summary>' + t.steps.length + ' step' + (t.steps.length > 1 ? 's' : '') + (t.costUsd != null ? ' · $' + (+t.costUsd).toFixed(3) : '') + '</summary>' +
        t.steps.map(function (s) { return '<div>' + esc(s) + '</div>'; }).join('') + '</details>' : '';
    var q = t.query ? '<div class="ask-q"><div class="mh"><b><i class="fa-solid fa-code"></i> Query used</b><small class="muted">' + (t.queryKind === 'sql' ? 'SQL' : 'measures') + '</small>' +
        '<button class="btn sm" data-aq="run" data-i="' + i + '"><i class="fa-solid fa-play"></i> Open in Explore</button>' +
        (S.isAdmin ? '<button class="btn sm' + (t.verified ? ' ok' : '') + '" data-aq="verify" data-i="' + i + '"' + (t.verified ? ' disabled' : '') + '><i class="fa-solid fa-circle-check"></i> ' + (t.verified ? 'Verified' : 'Mark as verified') + '</button>' : '') +
        '</div><pre>' + esc(t.query) + '</pre></div>' : '';
    if (t.pending) return '<div class="msg bot"><div class="bubble"><i class="fa-solid fa-circle-notch fa-spin"></i> <span class="muted">' + esc(t.status || 'Thinking…') + '</span>' +
        (t.steps && t.steps.length ? '<div class="steps live">' + t.steps.slice(-4).map(function (s) { return '<div>' + esc(s) + '</div>'; }).join('') + '</div>' : '') +
        ' <button class="btn sm" data-aq="cancel">Stop</button></div></div>';
    if (t.error) return '<div class="msg bot"><div class="bubble err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(t.error) + steps + '</div></div>';
    // the query panel shows the query, so its copy in the text (```evaluate / ```sql) is left out
    var body = t.query ? String(t.content || '').replace(/```(evaluate|dax|sql)\n[\s\S]*?```/gi, '').trim() : t.content;
    return '<div class="msg bot"><div class="bubble">' + md(body) + steps + q + '</div></div>';
}

/** Small, safe Markdown: escapes first, then tables, code blocks, headings, lists, bold/italic/code. */
function md(src) {
    var blocks = [], text = esc(src || '').replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) { blocks.push('<pre class="code">' + code + '</pre>'); return '\u0000' + (blocks.length - 1) + '\u0000'; });
    var out = [], lines = text.split('\n'), i = 0;
    function inline(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>'); }
    while (i < lines.length) {
        var l = lines[i];
        if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
            var head = l.trim().replace(/^\||\|$/g, '').split('|'), rows = []; i += 2;
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|')); i++; }
            out.push('<table class="md"><thead><tr>' + head.map(function (h) { return '<th>' + inline(h.trim()) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                rows.map(function (r) { return '<tr>' + r.map(function (c) { var v = c.trim(); return '<td' + (/^[-−]?[$€£]?[\d.,]+%?$/.test(v) ? ' class="n"' : '') + '>' + inline(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
            continue;
        }
        var h = l.match(/^(#{1,4})\s+(.*)$/);
        if (h) { out.push('<h4>' + inline(h[2]) + '</h4>'); i++; continue; }
        if (/^\s*[-*]\s+/.test(l)) {
            var items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>'); i++; }
            out.push('<ul>' + items.join('') + '</ul>'); continue;
        }
        out.push(l.trim() ? '<p>' + inline(l) + '</p>' : ''); i++;
    }
    return out.join('').replace(/\u0000(\d+)\u0000/g, function (_, n) { return blocks[+n]; });
}

function ask(question) {
    question = (question || '').trim();
    if (!question || AK.running) return;
    var history = AK.thread.filter(function (t) { return !t.pending && !t.error; }).map(function (t) { return { role: t.role, content: t.content }; });
    AK.thread.push({ role: 'user', content: question });
    var bot = { role: 'assistant', pending: true, steps: [], status: 'Claude is reading the model…' };
    AK.thread.push(bot); AK.running = true; $('ask-in').value = '';
    renderAsk();
    fm('fmAsk', { question: question, history: history }, function (msg) {
        if (/^[^\w\s]/.test(msg)) bot.steps.push(msg); else bot.status = msg;
        renderAsk();
    }).then(function (r) {
        bot.pending = false; bot.content = r.answer; bot.steps = r.steps || bot.steps; bot.query = r.query; bot.queryKind = r.queryKind; bot.costUsd = r.costUsd; bot.question = question;
    }).catch(function (e) { bot.pending = false; bot.error = String(e); })
      .then(function () { AK.running = false; renderAsk(); });
}

// ── catalog search (left side) ───────────────────────────────
var _searchT;
function searchCatalog(q) {
    AK.q = q; clearTimeout(_searchT);
    if (!q.trim()) { AK.hits = []; renderSearch(); return; }
    _searchT = setTimeout(function () {
        fm('fmSearch', { query: q, k: 20 }).then(function (r) { if (AK.q !== q) return; AK.hits = r.hits || []; AK.note = r.note; renderSearch(); })
            .catch(function (e) { AK.hits = []; AK.note = String(e); renderSearch(); });
    }, 220);
}
function renderSearch() {
    var el = $('ask-hits'); if (!el) return;
    if (!AK.q.trim()) {
        var ex = AK.examples || [];
        el.innerHTML = '<div class="rgroup">Verified examples</div>' + (ex.length ? ex.map(function (x) {
            return '<div class="hit"><button class="hit-b" data-ask="' + esc(x.question) + '"><i class="fa-solid fa-circle-check" style="color:#15803d"></i><span><b>' + esc(x.question) + '</b><small>' + esc((x.by || '') + ' · ' + ago(x.utc)) + '</small></span></button>' +
                '<span class="hit-a"><button class="btn xs" data-xrun="' + esc(x.id) + '" title="Run its query in Explore"><i class="fa-solid fa-play"></i></button>' +
                (S.isAdmin ? '<button class="btn xs" data-xdel="' + esc(x.id) + '" title="Remove"><i class="fa-solid fa-trash"></i></button>' : '') + '</span></div>';
        }).join('') : '<div class="muted pad sm">None yet. When an answer is right, an AI admin clicks <b>Mark as verified</b> — the AI reuses it for similar questions.</div>');
        return;
    }
    el.innerHTML = (AK.hits.length ? AK.hits.map(function (h) {
        return '<button class="hit-b" data-hit="' + esc(h.kind === 'example' ? h.title : h.ref) + '" data-kind="' + h.kind + '" title="' + esc(h.detail || '') + '"><i class="fa-solid ' + (KIND_ICON[h.kind] || 'fa-circle') + '"></i><span><b>' + esc(h.kind === 'value' ? '"' + h.title + '" in ' + h.ref : h.kind === 'term' || h.kind === 'example' ? h.title : h.ref) + '</b>' +
            '<small>' + esc(h.detail || '') + '</small><small class="why">' + (h.why || []).map(function (w) { return '<em>' + esc(w) + '</em>'; }).join('') + '</small></span></button>';
    }).join('') : '<div class="muted pad sm">Nothing found.</div>') + (AK.note ? '<div class="muted pad sm">' + esc(AK.note) + '</div>' : '');
}
function loadExamples() {
    AK.examples = [];
    return fm('fmExamples').then(function (r) { AK.examples = r.examples || []; renderSearch(); }).catch(function () { });
}
function openInExplore(query, kind) {
    showTab('explore');
    $('qmode').value = kind === 'sql' ? 'sql' : 'dax';
    $('sql').value = query; runQuery();
}

document.addEventListener('click', function (e) {
    if (!$('page-ask') || $('page-ask').hidden) return;
    var b = e.target.closest('[data-ask], [data-aq], [data-hit], [data-xrun], [data-xdel], [data-act="asksend"]');
    if (!b) return;
    var d = b.dataset;
    if (d.act === 'asksend') return ask($('ask-in').value);
    if (d.ask) return ask(d.ask);
    if (d.hit) {
        // put the thing into the question box (a measure name, a column, a value filter, an example question)
        var box = $('ask-in');
        box.value = d.kind === 'example' ? d.hit : (box.value ? box.value.replace(/\s*$/, ' ') : '') + d.hit; box.focus(); return;
    }
    if (d.xrun) { var x = (AK.examples || []).find(function (y) { return y.id === d.xrun; }); if (x) openInExplore(x.query, x.kind); return; }
    if (d.xdel) {
        if (!confirm('Remove this verified example?')) return;
        return fm('fmExampleDelete', { id: d.xdel }).then(loadExamples).catch(function (x) { toast(String(x)); });
    }
    var t = AK.thread[+d.i];
    if (d.aq === 'cancel') return host('fmAskCancel').catch(function () { });
    if (d.aq === 'run' && t) return openInExplore(t.query, t.queryKind);
    if (d.aq === 'verify' && t) {
        var q = prompt('Save as a verified example. The question people ask:', t.question || '');
        if (!q) return;
        busy('Checking the query…');
        return fm('fmExampleSave', { example: { question: q, kind: t.queryKind || 'evaluate', query: t.query } })
            .then(function () { busy(null); t.verified = true; toast('Verified — the AI will reuse it'); return loadExamples(); })
            .then(renderAsk).catch(function (x) { busy(null); toast(String(x)); });
    }
});
document.addEventListener('input', function (e) { if (e.target.id === 'ask-search') searchCatalog(e.target.value); });
document.addEventListener('keydown', function (e) {
    if (e.target.id === 'ask-in' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
});
