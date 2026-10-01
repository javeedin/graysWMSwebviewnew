/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Knowledge engine (pure: no DOM, no host; runs in node)

   The app learns "our Fusion" from the SQL people already wrote:
   - JOIN   facts:  which columns tables are joined on        (a.X = b.Y)
   - COLUMN facts:  what a flexfield / generic column means    (h.ATTRIBUTE5 AS MRA_IRN)
   - VALUE  facts:  which codes are used to filter a column    (l.STATUS_CODE IN ('CLOSED','SHIPPED'))
   and picks the facts that matter for a question so Ask AI uses them.
   Kinds kept in WMS_FUSION_KNOWLEDGE: TABLE, COLUMN, VALUE, JOIN, RULE, TERM, EXAMPLE.
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';

    var KEYWORDS = ('SELECT FROM WHERE AND OR NOT JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING GROUP BY ORDER HAVING UNION ALL ' +
        'MINUS INTERSECT AS WITH CASE WHEN THEN ELSE END IN IS NULL LIKE BETWEEN EXISTS DISTINCT FETCH FIRST ROWS ONLY OFFSET ' +
        'NATURAL LATERAL APPLY PARTITION OVER CONNECT START PRIOR NOCYCLE SIBLINGS DUAL ASC DESC NULLS LAST').split(' ');
    var KW = {}; KEYWORDS.forEach(function (k) { KW[k] = 1; });
    // Columns whose meaning is NOT in the name: flexfields, segments, generic attributes
    var GENERIC_COL = /^(ATTRIBUTE|GLOBAL_ATTRIBUTE|ATTRIBUTE_CHAR|ATTRIBUTE_NUMBER|ATTRIBUTE_DATE|ATTRIBUTE_TIMESTAMP|SEGMENT|INFORMATION|ATTR_|EXTN_ATTRIBUTE|TL_ATTRIBUTE|N_EXT_ATTR|C_EXT_ATTR|D_EXT_ATTR)\w*\d+$/;
    var STOP = {};
    ('the a an of to for and or in on at by with from is are was were be this that these those what which who whom how many much ' +
        'show list give get me my our all any each per as it its into than then there their them do does did can could would should ' +
        'please find display want need tell about between where when sql query table data value values').split(' ').forEach(function (w) { STOP[w] = 1; });

    // ── SQL scanning ────────────────────────────────────────────
    /** Comments out, string literals replaced by placeholders (kept in a list), upper-cased. */
    function normalise(sql) {
        var strs = [];
        var s = String(sql || '')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/--[^\n]*/g, ' ')
            .replace(/'((?:[^']|'')*)'/g, function (_, v) { strs.push(v.replace(/''/g, "'")); return ' __S' + (strs.length - 1) + '__ '; })
            .replace(/\{\{[^}]*\}\}/g, ' __P__ ')
            .replace(/\(\+\)/g, '')
            .replace(/"([A-Za-z0-9_$#]+)"/g, '$1')
            .toUpperCase()
            .replace(/\s+/g, ' ');
        return { text: s, strs: strs };
    }
    function bareTable(name) { var p = String(name).split('.'); return p[p.length - 1]; }

    /** alias → table for every "FROM/JOIN/, owner.table alias" (all scopes merged - good enough for learning). */
    function aliases(text) {
        var map = {};
        var re = /(?:\bFROM|\bJOIN|,)\s+([A-Z][A-Z0-9_$#]*(?:\.[A-Z][A-Z0-9_$#]*)?)(?:\s+(?:AS\s+)?([A-Z][A-Z0-9_$#]*))?/g, m;
        while ((m = re.exec(text))) {
            var t = m[1], a = m[2];
            // a keyword captured as the "alias" (… x FROM y) must stay available for the next match
            if (a && KW[a]) { re.lastIndex = m.index + m[0].length - a.length; a = null; }
            if (KW[t] || /^__/.test(t)) continue;
            if (m[0].charAt(0) === ',' && !inFromClause(text, m.index)) continue;   // a comma in a SELECT list, not a table list
            var table = bareTable(t);
            if (/^(DUAL)$/.test(table)) continue;
            map[table] = map[table] || table;                       // the table name itself works as a qualifier
            if (a && !KW[a]) map[a] = table;
        }
        return map;
    }
    /** True when the nearest clause keyword before pos is FROM (or a JOIN … ON-less table list). */
    function inFromClause(text, pos) {
        var head = text.slice(0, pos), best = -1, which = '';
        ['FROM', 'SELECT', 'WHERE', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'SET', 'JOIN'].forEach(function (k) {
            var i = head.lastIndexOf(' ' + k + ' ');
            if (head.indexOf(k + ' ') === 0 && i < 0) i = 0;
            if (i > best) { best = i; which = k; }
        });
        return which === 'FROM' || which === 'JOIN';
    }
    function strList(chunk, strs) {
        var out = [], m, re = /__S(\d+)__/g;
        while ((m = re.exec(chunk))) out.push(strs[+m[1]]);
        return out;
    }
    /** Splits the top-level SELECT list of the first SELECT … FROM. */
    function selectItems(text) {
        var out = [], re = /\bSELECT\s+(?:DISTINCT\s+)?/g, m;
        while ((m = re.exec(text))) {
            var i = m.index + m[0].length, depth = 0, start = i;
            for (; i < text.length; i++) {
                var c = text[i];
                if (c === '(') depth++;
                else if (c === ')') { if (depth === 0) break; depth--; }
                else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
                else if (depth === 0 && text.substr(i, 6) === ' FROM ') { break; }
            }
            out.push(text.slice(start, i).trim());
        }
        return out.filter(Boolean);
    }

    /**
     * Learns facts from one SQL text.
     * @returns [{kind, object, column, fact, words, key, evidence}]
     */
    function learnFromSql(sql, label) {
        var n = normalise(sql), text = n.text, al = aliases(text), facts = [], seen = {};
        var ev = label ? 'from "' + label + '"' : 'from a query';
        function add(f) { if (seen[f.key]) return; seen[f.key] = 1; f.evidence = ev; facts.push(f); }
        function tableOf(a) { return al[a] || null; }

        // JOIN facts: a.X = b.Y with both qualifiers known and different tables
        var jre = /\b([A-Z][A-Z0-9_$#]*)\.([A-Z][A-Z0-9_$#]*)\s*=\s*([A-Z][A-Z0-9_$#]*)\.([A-Z][A-Z0-9_$#]*)\b/g, m;
        while ((m = jre.exec(text))) {
            var t1 = tableOf(m[1]), t2 = tableOf(m[3]);
            if (!t1 || !t2 || t1 === t2) continue;
            var l = t1 + '.' + m[2], r = t2 + '.' + m[4], pair = [l, r].sort();
            add({ kind: 'JOIN', object: pair[0].split('.')[0], column: pair[0].split('.')[1], fact: pair[0] + ' = ' + pair[1],
                words: '', key: 'JOIN|' + pair[0] + '|' + pair[1] });
        }

        // VALUE facts: a.X = 'v' / a.X IN ('v1','v2') / a.X <> 'v'
        var vre = /\b([A-Z][A-Z0-9_$#]*)\.([A-Z][A-Z0-9_$#]*)\s*(=|<>|!=|NOT IN|IN)\s*(\(\s*(?:__S\d+__\s*,?\s*)+\)|__S\d+__)/g;
        while ((m = vre.exec(text))) {
            var tv = tableOf(m[1]); if (!tv) continue;
            var vals = strList(m[4], n.strs).filter(function (v) { return v.length && v.length <= 40; }).slice(0, 8);
            if (!vals.length) continue;
            var neg = /<>|!=|NOT/.test(m[3]);
            add({ kind: 'VALUE', object: tv, column: m[2],
                fact: tv + '.' + m[2] + (neg ? ' is filtered to exclude ' : ' is filtered on ') + vals.map(function (v) { return "'" + v + "'"; }).join(', '),
                words: vals.join(' ').toLowerCase(), key: 'VALUE|' + tv + '.' + m[2] + '|' + (neg ? '!' : '') + vals.slice().sort().join(',') });
        }

        // COLUMN facts: a generic column given a business name (h.ATTRIBUTE5 AS MRA_IRN, NVL(h.SEGMENT3,'x') cost_centre)
        selectItems(text).forEach(function (item) {
            var am = /(?:\bAS\s+|\)\s*|\s)([A-Z][A-Z0-9_$#]*)\s*$/.exec(item);
            if (!am || KW[am[1]]) return;
            var alias = am[1], cre = /\b([A-Z][A-Z0-9_$#]*)\.([A-Z][A-Z0-9_$#]*)\b/g, cm;
            while ((cm = cre.exec(item))) {
                var tc = tableOf(cm[1]), col = cm[2];
                if (!tc || !GENERIC_COL.test(col) || alias === col) continue;
                add({ kind: 'COLUMN', object: tc, column: col, fact: tc + '.' + col + ' holds ' + alias.replace(/_/g, ' ').toLowerCase() + ' (named ' + alias + ')',
                    words: alias.replace(/_/g, ' ').toLowerCase(), key: 'COLUMN|' + tc + '.' + col + '|' + alias });
                break;
            }
        });
        return facts;
    }

    /** Learns from many queries [{name, sql}] and merges: count = number of queries that showed the fact. */
    function learnFromQueries(queries) {
        var byKey = {};
        (queries || []).forEach(function (q) {
            learnFromSql(q.sql, q.name).forEach(function (f) {
                var k = byKey[f.key];
                if (!k) { k = byKey[f.key] = f; k.count = 0; k.sources = []; }
                k.count++;
                if (k.sources.length < 5 && q.name) k.sources.push(q.name);
            });
        });
        return Object.keys(byKey).map(function (k) {
            var f = byKey[k];
            f.confidence = Math.min(0.95, Math.round((0.5 + 0.15 * f.count) * 100) / 100);
            f.evidence = 'seen in ' + f.count + ' quer' + (f.count === 1 ? 'y' : 'ies') + (f.sources.length ? ': ' + f.sources.join(', ') : '');
            return f;
        }).sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key); });
    }

    // ── Picking the facts for a question ────────────────────────
    function tokens(s) {
        return String(s || '').toLowerCase().replace(/[^a-z0-9_ ]+/g, ' ').split(/[\s_]+/)
            .filter(function (w) { return w.length >= 3 && !STOP[w]; });
    }
    function tokenSet(s) { var o = {}; tokens(s).forEach(function (w) { o[w] = 1; o[stem(w)] = 1; }); return o; }
    function stem(w) { return w.replace(/(ies|es|s|ing|ed)$/, ''); }
    function overlap(qset, s) {
        var n = 0, seen = {};
        tokens(s).forEach(function (w) { var k = stem(w); if (seen[k]) return; seen[k] = 1; if (qset[w] || qset[k]) n++; });
        return n;
    }

    /**
     * facts: [{id, kind, object, column, fact, words, sql, confidence, status}] (approved ones)
     * Returns the most useful facts for the question within a character budget, plus similar verified examples.
     */
    function selectFacts(facts, question, tableNames, opts) {
        opts = opts || {};
        var limit = opts.limit || 40, budget = opts.budget || 6000;
        var q = tokenSet(question), tabs = {};
        (tableNames || []).forEach(function (t) { tabs[bareTable(String(t).toUpperCase())] = 1; });
        var qWords = Object.keys(q).length || 1;
        var scored = [];
        (facts || []).forEach(function (f) {
            var obj = String(f.object || '').toUpperCase(), s = 0;
            var text = [f.fact, f.words, f.object, f.column].join(' ');
            var hits = overlap(q, text);
            if (f.kind === 'EXAMPLE') {
                // similar question: share of the question's words found in the stored question
                var sim = overlap(q, f.words + ' ' + f.fact) / qWords;
                if (sim < 0.34) return;
                s = 6 + sim * 10;
            } else {
                if (obj && tabs[obj]) s += 3;
                if (f.kind === 'JOIN' && tabs[obj] && f.fact && Object.keys(tabs).some(function (t) { return t !== obj && f.fact.indexOf(t + '.') >= 0; })) s += 3;
                s += hits * 2;
                if ((f.kind === 'RULE' || f.kind === 'TERM') && hits) s += 2;
                if (!s) return;
            }
            s += (f.confidence || 0.5);
            scored.push({ f: f, s: s });
        });
        scored.sort(function (a, b) { return b.s - a.s; });
        var out = [], used = 0;
        for (var i = 0; i < scored.length && out.length < limit; i++) {
            var len = String(scored[i].f.fact || '').length + String(scored[i].f.sql || '').length + 40;
            if (used + len > budget) continue;
            used += len; out.push(scored[i].f);
        }
        return out;
    }

    /** The block appended to Ask AI's starting hints. */
    function promptText(selected) {
        if (!selected || !selected.length) return '';
        var facts = selected.filter(function (f) { return f.kind !== 'EXAMPLE'; });
        var ex = selected.filter(function (f) { return f.kind === 'EXAMPLE'; });
        var s = '\nCOMPANY KNOWLEDGE - facts about THIS company\'s Fusion, confirmed by our team. Prefer them over guesses; ' +
            'still verify columns you have not seen:\n';
        facts.forEach(function (f) { s += '- [' + f.kind + '] ' + f.fact + (f.sql ? ' | e.g. ' + String(f.sql).replace(/\s+/g, ' ').slice(0, 300) : '') + '\n'; });
        if (ex.length) {
            s += '\nVERIFIED EXAMPLES - questions our users confirmed were answered correctly (reuse their joins and filters):\n';
            ex.forEach(function (f) { s += 'Q: ' + f.fact + '\nSQL: ' + String(f.sql || '').replace(/\s+/g, ' ').slice(0, 1500) + '\n'; });
        }
        return s;
    }

    /** Parses a ```knowledge block written by Claude: JSON array of {kind, object, column, fact, words}. */
    function parseProposals(json) {
        var arr;
        try { arr = JSON.parse(json); } catch (e) { return []; }
        if (!Array.isArray(arr)) arr = [arr];
        var kinds = { TABLE: 1, COLUMN: 1, VALUE: 1, JOIN: 1, RULE: 1, TERM: 1 };
        return arr.filter(function (x) { return x && x.fact; }).slice(0, 5).map(function (x) {
            var kind = String(x.kind || 'RULE').toUpperCase(); if (!kinds[kind]) kind = 'RULE';
            var obj = String(x.object || '').toUpperCase().slice(0, 128), col = String(x.column || '').toUpperCase().slice(0, 128);
            return { kind: kind, object: obj, column: col, fact: String(x.fact).slice(0, 2000), words: String(x.words || '').slice(0, 400),
                key: kind + '|' + obj + '.' + col + '|' + String(x.fact).toUpperCase().replace(/\s+/g, ' ').slice(0, 200) };
        });
    }

    var api = { learnFromSql: learnFromSql, learnFromQueries: learnFromQueries, selectFacts: selectFacts,
        promptText: promptText, parseProposals: parseProposals, tokens: tokens, normalise: normalise, aliases: aliases };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.KB_ENGINE = api;
})(this);
