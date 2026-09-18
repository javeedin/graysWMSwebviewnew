// ============================================================
// ORACLE CUSTOMERS - companies using Oracle Fusion, by country
// ============================================================
// There is no official public API listing Oracle Fusion customers, so this
// combines two grounded signals:
//   1) AI-compiled  - Claude lists well-known public Oracle Fusion Cloud
//      customers for the chosen country (via the aiChatSend bridge).
//   2) Job-signal   - companies currently HIRING for "Oracle Fusion" in that
//      country (reuses JobSearch.rawSearch across the enabled providers) =
//      strong evidence they run it.
// Results are merged by company and shown in a country-grouped table.
// ============================================================

(function () {
    'use strict';

    var COUNTRIES = [
        ['India', 'in'], ['United States', 'us'], ['United Kingdom', 'gb'], ['United Arab Emirates', 'ae'],
        ['Singapore', 'sg'], ['Australia', 'au'], ['Canada', 'ca'], ['Germany', 'de'], ['France', 'fr'],
        ['Saudi Arabia', 'sa'], ['South Africa', 'za'], ['Mauritius', 'mu'], ['Kenya', 'ke'], ['Nigeria', 'ng'],
        ['Malaysia', 'my'], ['Netherlands', 'nl'], ['Japan', 'jp'], ['Brazil', 'br']
    ];

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function norm(s) { return String(s || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llc|plc|corp|corporation|co|company|group|holdings|technologies|technology|solutions)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

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

    var st = { built: false };

    window.OracleCustomers = {
        init: function () {
            if (st.built) return;
            st.built = true;
            var sel = document.getElementById('oc-country');
            if (sel) sel.innerHTML = COUNTRIES.map(function (c) { return '<option value="' + c[1] + '"' + (c[1] === 'in' ? ' selected' : '') + '>' + esc(c[0]) + '</option>'; }).join('');
        },

        find: function () {
            var sel = document.getElementById('oc-country');
            var code = sel ? sel.value : 'in';
            var countryName = (COUNTRIES.filter(function (c) { return c[1] === code; })[0] || ['India'])[0];
            var industry = (document.getElementById('oc-industry') || {}).value || '';
            var useAI = document.getElementById('oc-ai').checked;
            var useJobs = document.getElementById('oc-jobs').checked;
            var status = document.getElementById('oc-status');
            var box = document.getElementById('oc-results');
            if (!useAI && !useJobs) { status.innerHTML = '<span style="color:#b45309;">Tick at least one source (AI list and/or live job postings).</span>'; return; }
            box.innerHTML = '';
            status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finding Oracle Fusion customers in ' + esc(countryName) + '…';

            var map = {};   // normKey -> { name, industry, modules, city, ai, hiring }
            var pending = (useAI ? 1 : 0) + (useJobs ? 1 : 0);
            var done = function () { if (--pending <= 0) render(map, countryName, status, box); };

            if (useAI) {
                var prompt =
                    'List companies in ' + countryName + ' that are known to use Oracle Fusion Cloud applications ' +
                    '(ERP / HCM / SCM / EPM).' + (industry ? ' Focus on the ' + industry + ' industry.' : '') + '\n' +
                    'Only include real, well-known companies you are reasonably confident use Oracle Fusion Cloud — do NOT invent names. ' +
                    'Return up to 40. Reply as strict JSON with EXACTLY one fenced code block:\n' +
                    '```json\n{ "companies": [ { "name": "", "industry": "", "modules": "", "city": "" } ] }\n```';
                aiSend(prompt, function (err, md) {
                    if (!err && md) {
                        var m = md.match(/```json\s*([\s\S]*?)```/i) || md.match(/(\{[\s\S]*\})/);
                        try {
                            var data = JSON.parse(m ? m[1] : md);
                            (data.companies || []).forEach(function (c) {
                                if (!c || !c.name) return;
                                var k = norm(c.name);
                                if (!k) return;
                                map[k] = map[k] || { name: c.name, industry: '', modules: '', city: '', ai: false, hiring: 0 };
                                map[k].ai = true;
                                map[k].industry = map[k].industry || c.industry || '';
                                map[k].modules = map[k].modules || c.modules || '';
                                map[k].city = map[k].city || c.city || '';
                            });
                        } catch (e) { }
                    }
                    done();
                });
            }

            if (useJobs) {
                if (typeof JobSearch === 'undefined' || !JobSearch.rawSearch) { done(); }
                else {
                    JobSearch.rawSearch({ keyword: 'Oracle Fusion', location: countryName, country: code }, function (jobs) {
                        (jobs || []).forEach(function (j) {
                            if (!j.company) return;
                            var hay = (j.title + ' ' + j.snippet + ' ' + (j.tags || []).join(' ')).toLowerCase();
                            if (hay.indexOf('oracle') < 0 && hay.indexOf('fusion') < 0) return;   // relevance guard
                            var k = norm(j.company);
                            if (!k) return;
                            map[k] = map[k] || { name: j.company, industry: '', modules: '', city: j.location || '', ai: false, hiring: 0 };
                            map[k].hiring += 1;
                        });
                        done();
                    });
                }
            }
        }
    };

    function render(map, countryName, status, box) {
        var rows = Object.keys(map).map(function (k) { return map[k]; });
        // rank: both signals first, then AI, then hiring count
        rows.sort(function (a, b) {
            var sa = (a.ai ? 2 : 0) + (a.hiring ? 1 : 0), sb = (b.ai ? 2 : 0) + (b.hiring ? 1 : 0);
            if (sb !== sa) return sb - sa;
            return b.hiring - a.hiring;
        });
        if (!rows.length) {
            status.innerHTML = 'No companies found for ' + esc(countryName) + '. Try enabling both sources, or add Adzuna / Google Jobs keys in Setup for the live-job signal.';
            box.innerHTML = '';
            return;
        }
        status.innerHTML = '<b>' + rows.length + '</b> compan' + (rows.length === 1 ? 'y' : 'ies') + ' using Oracle Fusion in <b>' + esc(countryName) + '</b>';
        box.innerHTML =
            '<div style="border:1px solid #eef2f7;border-radius:10px;overflow:auto;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">' +
            '<thead><tr style="background:#f8fafc;position:sticky;top:0;">' +
            ['#', 'Company', 'Industry', 'Modules', 'City', 'Signal'].map(function (h) { return '<th style="padding:8px 10px;text-align:left;font-size:10px;color:#475569;text-transform:uppercase;">' + h + '</th>'; }).join('') +
            '</tr></thead><tbody>' +
            rows.map(function (r, i) {
                var sig = (r.ai ? '<span style="font-size:9px;font-weight:800;background:#ede9fe;color:#6d28d9;padding:1px 7px;border-radius:8px;">AI</span> ' : '') +
                    (r.hiring ? '<span style="font-size:9px;font-weight:800;background:#dcfce7;color:#166534;padding:1px 7px;border-radius:8px;">Hiring ' + r.hiring + '</span>' : '');
                return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                    '<td style="padding:6px 10px;color:#94a3b8;">' + (i + 1) + '</td>' +
                    '<td style="padding:6px 10px;font-weight:700;color:#0f172a;">' + esc(r.name) + '</td>' +
                    '<td style="padding:6px 10px;color:#475569;">' + esc(r.industry || '') + '</td>' +
                    '<td style="padding:6px 10px;color:#475569;">' + esc(r.modules || '') + '</td>' +
                    '<td style="padding:6px 10px;color:#475569;">' + esc(r.city || '') + '</td>' +
                    '<td style="padding:6px 10px;">' + sig + '</td></tr>';
            }).join('') +
            '</tbody></table></div>' +
            '<div style="font-size:10.5px;color:#94a3b8;margin-top:8px;"><b>AI</b> = compiled from public information (verify before relying on it). <b>Hiring</b> = has live "Oracle Fusion" job postings in this country now (needs providers enabled in Setup).</div>';
    }
})();
