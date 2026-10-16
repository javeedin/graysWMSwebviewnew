/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Knowledge ("it learns your Fusion")

   WMS_FUSION_KNOWLEDGE (apex_sql/80_fusion_knowledge_watchdogs.sql — auto-created)
   one row per fact: kind TABLE | COLUMN | VALUE | JOIN | RULE | TERM | EXAMPLE,
   status PROPOSED → APPROVED / REJECTED, source USER | AI | LEARNED | VERIFIED.

   Where facts come from:
   - Learn from saved queries  (knowledge-engine.js reads joins, codes and flexfield names from the SQL)
   - Ask AI ```knowledge blocks (Claude proposes what it found while researching)
   - 👍 Correct on an Ask AI answer (question + SQL saved as a verified EXAMPLE, its facts proposed)
   - typed by a user
   Where they are used: every Ask AI question gets the approved facts and similar verified examples that
   match it (kbForAsk), so the answers follow this company's Fusion.
   ═══════════════════════════════════════════════════════════════ */

var KB = {
    state: 'idle',           // idle | loading | ready | missing | error
    error: null,
    facts: [],
    loadedAt: 0,
    seg: 'PROPOSED',         // PROPOSED | APPROVED | EXAMPLE | REJECTED | ALL
    kind: '',
    q: ''
};
var KB_TABLE = 'wms_fusion_knowledge';
var KB_DDL = [
    'CREATE TABLE wms_fusion_knowledge (fact_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, fact_key VARCHAR2(400) NOT NULL, ' +
    'kind VARCHAR2(10) NOT NULL, object_name VARCHAR2(128), column_name VARCHAR2(128), fact VARCHAR2(2000) NOT NULL, words VARCHAR2(400), ' +
    "example_sql VARCHAR2(4000), source VARCHAR2(10) DEFAULT 'USER', status VARCHAR2(10) DEFAULT 'PROPOSED', confidence NUMBER DEFAULT 0.5, " +
    'seen_count NUMBER DEFAULT 1, use_count NUMBER DEFAULT 0, evidence VARCHAR2(1000), instance VARCHAR2(10), created_by VARCHAR2(120), ' +
    'created_date DATE DEFAULT SYSDATE, decided_by VARCHAR2(120), decided_date DATE, last_used DATE)',
    'CREATE UNIQUE INDEX wms_fusion_knowledge_key_ux ON wms_fusion_knowledge (fact_key)'
];
var KB_KINDS = {
    COLUMN: ['Column meaning', '#7c3aed', 'fa-table-columns'],
    JOIN: ['Join', '#2563eb', 'fa-link'],
    VALUE: ['Codes used', '#0e7490', 'fa-tags'],
    TABLE: ['Table', '#57504b', 'fa-table'],
    TERM: ['Business term', '#b45309', 'fa-book'],
    RULE: ['Rule', '#c74634', 'fa-scale-balanced'],
    EXAMPLE: ['Verified example', '#15803d', 'fa-circle-check']
};

// ── Tables & loading ──────────────────────────────────────────
function kbEnsure() {
    return dbRead("SELECT table_name FROM user_tables WHERE table_name = 'WMS_FUSION_KNOWLEDGE'", 2).then(function (r) {
        if (r.length) return;
        return KB_DDL.reduce(function (p, d) { return p.then(function () { return dbWrite(d); }); }, Promise.resolve());
    });
}
function kbLoad(force) {
    if (KB.state === 'loading') return KB._p;
    if (!force && KB.state === 'ready' && Date.now() - KB.loadedAt < 5 * 60000) return Promise.resolve(KB.facts);
    KB.state = 'loading'; kbRender();
    KB._p = kbEnsure().then(function () {
        return dbRead('SELECT fact_id, fact_key, kind, object_name, column_name, fact, words, example_sql, source, status, confidence, seen_count, use_count, evidence, ' +
            "instance, created_by, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created_at, decided_by, TO_CHAR(decided_date, 'YYYY-MM-DD HH24:MI') AS decided_at, " +
            "TO_CHAR(last_used, 'YYYY-MM-DD HH24:MI') AS last_used_at FROM " + KB_TABLE + ' ORDER BY NVL(decided_date, created_date) DESC', 5000);
    }).then(function (rows) {
        KB.facts = rows.map(function (r) {
            return {
                id: r.FACT_ID, key: r.FACT_KEY, kind: r.KIND, object: r.OBJECT_NAME || '', column: r.COLUMN_NAME || '', fact: r.FACT || '',
                words: r.WORDS || '', sql: r.EXAMPLE_SQL || '', source: r.SOURCE || '', status: r.STATUS || 'PROPOSED',
                confidence: +r.CONFIDENCE || 0.5, seen: +r.SEEN_COUNT || 1, used: +r.USE_COUNT || 0, evidence: r.EVIDENCE || '',
                instance: r.INSTANCE || '', by: r.CREATED_BY || '', at: r.CREATED_AT || '', decidedBy: r.DECIDED_BY || '', decidedAt: r.DECIDED_AT || '',
                lastUsed: r.LAST_USED_AT || ''
            };
        });
        KB.state = 'ready'; KB.error = null; KB.loadedAt = Date.now();
        return KB.facts;
    }).catch(function (e) {
        KB.state = /ORA-00942/.test(String(e)) ? 'missing' : 'error'; KB.error = String(e);
        return KB.facts;
    }).then(function (f) { kbRender(); return f; });
    return KB._p;
}

/** Upserts facts by fact_key. A fact seen again gains confidence; an APPROVED / REJECTED decision is never undone. */
function kbUpsert(facts, source, status) {
    var user = appUserName();
    return kbEnsure().then(function () {
        return facts.reduce(function (p, f) {
            return p.then(function () {
                var conf = f.confidence != null ? f.confidence : (source === 'VERIFIED' ? 0.8 : source === 'AI' ? 0.6 : 0.5);
                var st = status || 'PROPOSED';
                return dbWrite('MERGE INTO ' + KB_TABLE + ' t USING (SELECT ' + vlit(f.key, 400) + ' AS fact_key FROM dual) s ON (t.fact_key = s.fact_key) ' +
                    'WHEN MATCHED THEN UPDATE SET t.seen_count = GREATEST(NVL(t.seen_count, 1), ' + (f.count || 1) + ') + ' + (f.count ? 0 : 1) +
                    ', t.confidence = LEAST(0.95, GREATEST(NVL(t.confidence, 0), ' + conf + ') + 0.05)' +
                    (f.evidence ? ', t.evidence = ' + vlit(f.evidence, 1000) : '') +
                    // approving never overrides a rejection a person made
                    (st === 'APPROVED' ? ", t.status = CASE WHEN t.status = 'REJECTED' THEN t.status ELSE 'APPROVED' END, t.decided_by = NVL(t.decided_by, " + vlit(user, 120) + '), t.decided_date = NVL(t.decided_date, SYSDATE)' : '') +
                    (f.sql ? ', t.example_sql = ' + vlit(f.sql, 4000) : '') +
                    ' WHEN NOT MATCHED THEN INSERT (fact_key, kind, object_name, column_name, fact, words, example_sql, source, status, confidence, seen_count, evidence, instance, created_by, created_date' +
                    (st === 'APPROVED' ? ', decided_by, decided_date' : '') + ') VALUES (s.fact_key, ' + lit(f.kind) + ', ' + vlit(f.object, 128) + ', ' + vlit(f.column, 128) + ', ' +
                    vlit(f.fact, 2000) + ', ' + vlit(f.words, 400) + ', ' + vlit(f.sql, 4000) + ', ' + lit(source) + ', ' + lit(st) + ', ' + conf + ', ' + (f.count || 1) + ', ' +
                    vlit(f.evidence, 1000) + ', ' + vlit(currentInstance(), 10) + ', ' + vlit(user, 120) + ', SYSDATE' +
                    (st === 'APPROVED' ? ', ' + vlit(user, 120) + ', SYSDATE' : '') + ')');
            });
        }, Promise.resolve());
    }).then(function () { KB.loadedAt = 0; });
}
function kbDecide(id, status) {
    return dbWrite('UPDATE ' + KB_TABLE + ' SET status = ' + lit(status) + ', decided_by = ' + vlit(appUserName(), 120) + ', decided_date = SYSDATE WHERE fact_id = ' + (+id))
        .then(function () {
            var f = kbFind(id); if (f) { f.status = status; f.decidedBy = appUserName(); }
            kbRender();
        }).catch(function (e) { toast('Could not save: ' + e, 'err'); });
}
function kbFind(id) { return KB.facts.filter(function (f) { return String(f.id) === String(id); })[0]; }

// ── Used by Ask AI ────────────────────────────────────────────
/** Approved facts + verified examples that match the question → {text, count, ids}. Never fails the question. */
function kbForAsk(question, tableNames) {
    if (typeof KB_ENGINE === 'undefined') return Promise.resolve({ text: '', count: 0, ids: [] });
    return kbLoad(false).then(function (facts) {
        var approved = (facts || []).filter(function (f) { return f.status === 'APPROVED'; });
        var sel = KB_ENGINE.selectFacts(approved, question, tableNames || [], { limit: 40, budget: 7000 });
        var ids = sel.map(function (f) { return f.id; }).filter(Boolean);
        if (ids.length) dbWrite('UPDATE ' + KB_TABLE + ' SET use_count = NVL(use_count, 0) + 1, last_used = SYSDATE WHERE fact_id IN (' + ids.join(',') + ')').catch(function () { });
        return { text: KB_ENGINE.promptText(sel), count: sel.length, examples: sel.filter(function (f) { return f.kind === 'EXAMPLE'; }).length, ids: ids };
    }).catch(function () { return { text: '', count: 0, ids: [] }; });
}

/** ```knowledge block in an Ask AI answer → saved as PROPOSED facts, shown as a card with Approve buttons. */
var _kbAiCards = [];
function kbRenderAiProposals(json) {
    var props = typeof KB_ENGINE !== 'undefined' ? KB_ENGINE.parseProposals(json) : [];
    if (!props.length) return '';
    var idx = _kbAiCards.push(props) - 1;
    props.forEach(function (p) { p.evidence = 'proposed by Ask AI'; });
    kbUpsert(props, 'AI').then(function () { return kbLoad(true); }).then(function () { kbPaintAiCard(idx); }).catch(function () { });
    return '<div class="kb-ai-card" id="kb-ai-card-' + idx + '"><div class="kb-ai-head"><i class="fa-solid fa-brain"></i> Claude learned ' + props.length +
        ' thing' + (props.length === 1 ? '' : 's') + ' about your Fusion</div>' +
        props.map(function (p, i) {
            return '<div class="kb-ai-row" data-i="' + i + '">' + kbKindChip(p.kind) + '<span>' + esc(p.fact) + '</span>' +
                '<span class="kb-ai-acts"><span class="fs-muted" style="font-size:.7rem;">saving…</span></span></div>';
        }).join('') +
        '<div class="kb-ai-foot">Approved facts are used for every future question. <a href="#" onclick="showTab(\'knowledge\');closeAi();return false;">Open Knowledge</a></div></div>';
}
function kbPaintAiCard(idx) {
    var card = $('kb-ai-card-' + idx), props = _kbAiCards[idx]; if (!card || !props) return;
    props.forEach(function (p, i) {
        var f = KB.facts.filter(function (x) { return x.key === p.key; })[0];
        var acts = card.querySelector('.kb-ai-row[data-i="' + i + '"] .kb-ai-acts'); if (!acts) return;
        if (!f) { acts.innerHTML = '<span class="fs-muted" style="font-size:.7rem;">not saved</span>'; return; }
        acts.innerHTML = f.status === 'APPROVED' ? '<span class="kb-ok"><i class="fa-solid fa-check"></i> approved</span>'
            : f.status === 'REJECTED' ? '<span class="fs-muted" style="font-size:.7rem;">rejected</span>'
            : '<button class="fs-btn sm primary" onclick="kbDecide(' + f.id + ',\'APPROVED\').then(function(){kbPaintAiCard(' + idx + ')})"><i class="fa-solid fa-check"></i></button>' +
              '<button class="fs-btn sm ghost" onclick="kbDecide(' + f.id + ',\'REJECTED\').then(function(){kbPaintAiCard(' + idx + ')})"><i class="fa-solid fa-xmark"></i></button>';
    });
}

/** 👍 on an Ask AI SQL block: the question + SQL become a verified example, the SQL's facts are proposed. */
function kbMarkCorrect(blockIdx, btn) {
    var sql = (_aiBlocks || [])[blockIdx], q = (window._aiBlockQ || {})[blockIdx];
    if (!sql) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    var ex = { kind: 'EXAMPLE', object: '', column: '', fact: String(q || 'Verified query').slice(0, 2000), words: (KB_ENGINE.tokens(q || '').join(' ')).slice(0, 400),
        sql: sql.slice(0, 4000), key: 'EXAMPLE|' + String(q || sql).toUpperCase().replace(/\s+/g, ' ').slice(0, 380), evidence: 'confirmed correct by ' + appUserName(), confidence: 0.9 };
    var learned = KB_ENGINE.learnFromSql(sql, 'a verified Ask AI answer');
    kbUpsert([ex], 'VERIFIED', 'APPROVED').then(function () { return kbUpsert(learned, 'VERIFIED'); })
        .then(function () {
            if (btn) { btn.innerHTML = '<i class="fa-solid fa-check"></i> Learned'; btn.classList.add('kb-learned'); }
            toast('Saved as a verified example' + (learned.length ? ' · ' + learned.length + ' fact' + (learned.length === 1 ? '' : 's') + ' to review in Knowledge' : ''));
            kbLoad(true);
        })
        .catch(function (e) { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-regular fa-thumbs-up"></i> Correct'; } toast('Could not save: ' + e, 'err'); });
}

// ── Learn from the saved queries ──────────────────────────────
function kbLearnFromQueries() {
    var go = function () {
        var qs = (FS.queries || []).filter(function (q) { return q.sql; });
        if (!qs.length) { toast('No saved queries to learn from yet', 'warn'); return; }
        var facts = KB_ENGINE.learnFromQueries(qs.map(function (q) { return { name: q.name, sql: q.sql }; }));
        var have = {}; KB.facts.forEach(function (f) { have[f.key] = f; });
        var fresh = facts.filter(function (f) { return !have[f.key]; });
        var by = {}; facts.forEach(function (f) { by[f.kind] = (by[f.kind] || 0) + 1; });
        var html = '<p>Read <b>' + qs.length + '</b> saved queries and found <b>' + facts.length + '</b> facts (' +
            Object.keys(by).map(function (k) { return by[k] + ' ' + (KB_KINDS[k] || [k])[0].toLowerCase(); }).join(', ') + '), <b>' + fresh.length + '</b> new.</p>' +
            '<div class="kb-preview">' + facts.slice(0, 60).map(function (f) {
                return '<div class="kb-prev-row">' + kbKindChip(f.kind) + '<span>' + esc(f.fact) + '</span><span class="fs-muted">' + f.count + '×' + (have[f.key] ? ' · known' : '') + '</span></div>';
            }).join('') + (facts.length > 60 ? '<div class="fs-muted" style="padding:6px;">… and ' + (facts.length - 60) + ' more</div>' : '') + '</div>' +
            '<label class="kb-check"><input type="checkbox" id="kb-auto-approve" checked> Approve straight away the facts seen in <b>3 or more</b> queries</label>';
        openModal('Learn from saved queries', html, [
            { label: 'Cancel', cls: 'ghost', onClick: closeModal },
            { label: '<i class="fa-solid fa-brain"></i> Save ' + facts.length + ' facts', cls: 'primary', onClick: function (e) {
                var auto = $('kb-auto-approve').checked, btn = e && e.currentTarget;
                if (btn) { btn.disabled = true; btn.innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;"></span> Saving…'; }
                var strong = facts.filter(function (f) { return auto && f.count >= 3; }), rest = facts.filter(function (f) { return !(auto && f.count >= 3); });
                kbUpsert(rest, 'LEARNED').then(function () { return kbUpsert(strong, 'LEARNED', 'APPROVED'); }).then(function () {
                    closeModal(); toast(facts.length + ' facts saved' + (strong.length ? ' · ' + strong.length + ' approved' : ''));
                    KB.seg = 'PROPOSED'; return kbLoad(true);
                }).catch(function (err) { toast('Could not save: ' + err, 'err'); if (btn) btn.disabled = false; });
            } }
        ], true);
    };
    if (!FS.queries || !FS.queries.length) loadQueries().then(go); else go();
}

// ── Add / edit ────────────────────────────────────────────────
function kbEdit(id) {
    var f = id ? kbFind(id) : { kind: 'COLUMN', object: '', column: '', fact: '', words: '', sql: '' };
    if (!f) return;
    var opts = Object.keys(KB_KINDS).map(function (k) { return '<option value="' + k + '"' + (f.kind === k ? ' selected' : '') + '>' + KB_KINDS[k][0] + '</option>'; }).join('');
    openModal(id ? 'Edit fact' : 'Teach Fusion SQL a fact', '<div class="kb-form">' +
        '<label>Kind<select id="kb-f-kind">' + opts + '</select></label>' +
        '<div class="kb-2"><label>Table / view<input id="kb-f-obj" value="' + esc(f.object) + '" placeholder="DOO_HEADERS_ALL"></label>' +
        '<label>Column<input id="kb-f-col" value="' + esc(f.column) + '" placeholder="ATTRIBUTE5"></label></div>' +
        '<label>Fact <span class="fs-muted">(one plain sentence; for an example: the question)</span><textarea id="kb-f-fact" rows="3" placeholder="ATTRIBUTE5 on DOO_HEADERS_ALL holds the MRA IRN of the order">' + esc(f.fact) + '</textarea></label>' +
        '<label>Business words <span class="fs-muted">(what people call it — helps Ask AI find the fact)</span><input id="kb-f-words" value="' + esc(f.words) + '" placeholder="mra irn invoice reference fiscal"></label>' +
        '<label>Example SQL <span class="fs-muted">(optional; required for a verified example)</span><textarea id="kb-f-sql" rows="5" class="kb-mono">' + esc(f.sql) + '</textarea></label></div>',
        [{ label: 'Cancel', cls: 'ghost', onClick: closeModal },
         { label: id ? 'Save' : 'Save &amp; approve', cls: 'primary', onClick: function () {
             var n = { kind: $('kb-f-kind').value, object: $('kb-f-obj').value.trim().toUpperCase(), column: $('kb-f-col').value.trim().toUpperCase(),
                 fact: $('kb-f-fact').value.trim(), words: $('kb-f-words').value.trim(), sql: $('kb-f-sql').value.trim() };
             if (!n.fact) { toast('Write the fact', 'warn'); return; }
             if (n.kind === 'EXAMPLE' && !n.sql) { toast('A verified example needs its SQL', 'warn'); return; }
             var p = id
                 ? dbWrite('UPDATE ' + KB_TABLE + ' SET kind = ' + lit(n.kind) + ', object_name = ' + vlit(n.object, 128) + ', column_name = ' + vlit(n.column, 128) +
                     ', fact = ' + vlit(n.fact, 2000) + ', words = ' + vlit(n.words, 400) + ', example_sql = ' + vlit(n.sql, 4000) + ' WHERE fact_id = ' + (+id))
                 : kbUpsert([{ kind: n.kind, object: n.object, column: n.column, fact: n.fact, words: n.words, sql: n.sql, confidence: 0.9, evidence: 'added by ' + appUserName(),
                     key: n.kind + '|' + n.object + '.' + n.column + '|' + n.fact.toUpperCase().replace(/\s+/g, ' ').slice(0, 200) }], 'USER', 'APPROVED');
             p.then(function () { closeModal(); toast('Saved'); return kbLoad(true); }).catch(function (e) { toast('Could not save: ' + e, 'err'); });
         } }], true);
}
function kbDelete(id) {
    var f = kbFind(id); if (!f) return;
    confirmModal('Delete fact', 'Delete "' + f.fact.slice(0, 120) + '"? Ask AI will stop using it.', function () {
        dbWrite('DELETE FROM ' + KB_TABLE + ' WHERE fact_id = ' + (+id)).then(function () { return kbLoad(true); }).catch(function (e) { toast('Could not delete: ' + e, 'err'); });
    });
}
function kbApproveVisible() {
    var list = kbVisible().filter(function (f) { return f.status === 'PROPOSED'; });
    if (!list.length) return;
    confirmModal('Approve ' + list.length + ' facts', 'Approve all ' + list.length + ' proposed facts shown? Ask AI will use them from the next question.', function () {
        dbWrite('UPDATE ' + KB_TABLE + " SET status = 'APPROVED', decided_by = " + vlit(appUserName(), 120) + ', decided_date = SYSDATE WHERE fact_id IN (' +
            list.map(function (f) { return +f.id; }).join(',') + ')').then(function () { toast(list.length + ' facts approved'); return kbLoad(true); })
            .catch(function (e) { toast('Could not save: ' + e, 'err'); });
    });
}

// ── Page ──────────────────────────────────────────────────────
function kbKindChip(kind) {
    var k = KB_KINDS[kind] || [kind, '#57504b', 'fa-circle'];
    return '<span class="kb-kind" style="--kc:' + k[1] + '"><i class="fa-solid ' + k[2] + '"></i> ' + esc(k[0]) + '</span>';
}
function kbVisible() {
    var q = KB.q.toLowerCase();
    return KB.facts.filter(function (f) {
        if (KB.seg === 'EXAMPLE') { if (f.kind !== 'EXAMPLE' || f.status === 'REJECTED') return false; }
        else if (KB.seg !== 'ALL' && (f.status !== KB.seg || f.kind === 'EXAMPLE' && KB.seg !== 'REJECTED')) return false;
        if (KB.kind && f.kind !== KB.kind) return false;
        if (q && [f.fact, f.object, f.column, f.words, f.sql, f.evidence].join(' ').toLowerCase().indexOf(q) < 0) return false;
        return true;
    });
}
function kbSeg(s) { KB.seg = s; kbRender(); }
function kbRender() {
    var body = $('kb-body'); if (!body) return;
    var badge = $('fs-kb-count'), prop = KB.facts.filter(function (f) { return f.status === 'PROPOSED'; }).length;
    if (badge) { badge.textContent = prop || KB.facts.filter(function (f) { return f.status === 'APPROVED'; }).length; badge.classList.toggle('muted', !prop); badge.title = prop ? prop + ' facts waiting for review' : 'approved facts'; }
    if (KB.state === 'loading' && !KB.facts.length) { body.innerHTML = '<div class="fs-empty"><div class="fs-spinner"></div><p>Loading what Fusion SQL knows…</p></div>'; return; }
    if (KB.state === 'error') { body.innerHTML = '<div class="fs-empty error"><i class="fa-solid fa-triangle-exclamation"></i><h3>Could not read the knowledge table</h3><div class="fs-error-box">' + esc(KB.error) + '</div></div>'; return; }
    var n = function (st, kind) { return KB.facts.filter(function (f) { return (!st || f.status === st) && (kind ? f.kind === kind : f.kind !== 'EXAMPLE'); }).length; };
    var approved = n('APPROVED'), examples = KB.facts.filter(function (f) { return f.kind === 'EXAMPLE' && f.status === 'APPROVED'; }).length;
    var uses = KB.facts.reduce(function (s, f) { return s + (f.used || 0); }, 0);
    var kpis = '<div class="kb-kpis">' +
        '<div class="kb-kpi"><b>' + approved + '</b><span>facts Ask AI uses</span></div>' +
        '<div class="kb-kpi"><b>' + examples + '</b><span>verified examples</span></div>' +
        '<div class="kb-kpi' + (prop ? ' warn' : '') + '"><b>' + prop + '</b><span>waiting for review</span></div>' +
        '<div class="kb-kpi"><b>' + uses.toLocaleString() + '</b><span>times used in answers</span></div></div>';
    var segs = [['PROPOSED', 'To review', n('PROPOSED')], ['APPROVED', 'Approved', approved], ['EXAMPLE', 'Verified examples', examples], ['REJECTED', 'Rejected', KB.facts.filter(function (f) { return f.status === 'REJECTED'; }).length], ['ALL', 'All', KB.facts.length]];
    var bar = '<div class="kb-bar"><div class="su-seg">' + segs.map(function (s) {
        return '<button class="' + (KB.seg === s[0] ? 'on' : '') + '" onclick="kbSeg(\'' + s[0] + '\')">' + s[1] + ' <span class="fs-badge muted">' + s[2] + '</span></button>';
    }).join('') + '</div><span style="flex:1"></span>' +
        '<select class="fs-q-owner" onchange="KB.kind=this.value;kbRender()"><option value="">All kinds</option>' + Object.keys(KB_KINDS).map(function (k) { return '<option value="' + k + '"' + (KB.kind === k ? ' selected' : '') + '>' + KB_KINDS[k][0] + '</option>'; }).join('') + '</select>' +
        (KB.seg === 'PROPOSED' && prop ? '<button class="fs-btn sm" onclick="kbApproveVisible()"><i class="fa-solid fa-check-double"></i> Approve all shown</button>' : '') + '</div>';
    var list = kbVisible();
    var rows = list.length ? list.slice(0, 400).map(function (f) {
        var conf = Math.round((f.confidence || 0) * 100);
        return '<div class="kb-row ' + f.status.toLowerCase() + '">' +
            '<div class="kb-row-main">' + kbKindChip(f.kind) +
            '<div class="kb-fact">' + esc(f.fact) +
            (f.object ? '<div class="kb-obj"><code>' + esc(f.object + (f.column ? '.' + f.column : '')) + '</code>' + (f.words ? ' <span class="kb-words">' + esc(f.words) + '</span>' : '') + '</div>' : (f.words && f.kind !== 'EXAMPLE' ? '<div class="kb-obj"><span class="kb-words">' + esc(f.words) + '</span></div>' : '')) +
            (f.sql ? '<details class="kb-sql"><summary>SQL</summary><pre>' + esc(f.sql) + '</pre></details>' : '') +
            '<div class="kb-meta"><span title="How sure: grows each time the fact is seen again"><span class="kb-conf"><i style="width:' + conf + '%"></i></span> ' + conf + '%</span>' +
            '<span><i class="fa-solid fa-eye"></i> seen ' + f.seen + '×</span><span><i class="fa-solid fa-wand-magic-sparkles"></i> used ' + f.used + '×</span>' +
            '<span>' + esc(kbSourceLabel(f.source)) + (f.evidence ? ' · ' + esc(f.evidence) : '') + '</span>' +
            (f.decidedBy ? '<span>' + esc(f.status.toLowerCase()) + ' by ' + esc(f.decidedBy) + '</span>' : '') + '</div></div></div>' +
            '<div class="kb-acts">' +
            (f.status !== 'APPROVED' ? '<button class="fs-btn sm primary" onclick="kbDecide(' + f.id + ',\'APPROVED\')" title="Ask AI will use it"><i class="fa-solid fa-check"></i> Approve</button>' : '') +
            (f.status !== 'REJECTED' ? '<button class="fs-btn sm ghost" onclick="kbDecide(' + f.id + ',\'REJECTED\')" title="Wrong — never use it"><i class="fa-solid fa-xmark"></i></button>' : '') +
            '<button class="fs-icon-btn" onclick="kbEdit(' + f.id + ')" title="Edit"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="fs-icon-btn" onclick="kbDelete(' + f.id + ')" title="Delete"><i class="fa-regular fa-trash-can"></i></button></div></div>';
    }).join('') : '<div class="fs-empty" style="padding:40px;"><i class="fa-solid fa-brain"></i><h3>' +
        (KB.facts.length ? 'Nothing here' : 'Fusion SQL does not know your Fusion yet') + '</h3><p class="fs-muted">' +
        (KB.facts.length ? 'Try another filter.' : 'Start with <b>Learn from saved queries</b>: it reads the joins, codes and flexfield names your team already uses. Ask AI also proposes facts as it researches, and 👍 <b>Correct</b> on an answer saves it as a verified example.') +
        '</p>' + (KB.facts.length ? '' : '<button class="fs-btn primary" onclick="kbLearnFromQueries()"><i class="fa-solid fa-brain"></i> Learn from saved queries</button>') + '</div>';
    body.innerHTML = kpis + bar + '<div class="kb-list">' + rows + '</div>';
}
function kbSourceLabel(s) { return { USER: 'added by a user', AI: 'proposed by Ask AI', LEARNED: 'learned from saved queries', VERIFIED: 'from a verified answer' }[s] || s || ''; }
function kbShow() { kbLoad(true); }
