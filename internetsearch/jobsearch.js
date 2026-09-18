// ============================================================
// INTERNET SEARCH - AI-enabled IT job search engine (private module)
// ============================================================
// Aggregates IT job openings from multiple public sources through the
// existing C# HTTP proxy (executeGet / executePost -> RestApiClient),
// which avoids browser CORS and keeps API keys in localStorage on this
// machine only. Results are normalized to one schema, de-duplicated,
// filtered (India-first) and rendered. Claude powers resume matching
// and JD summaries via the existing aiChatSend bridge.
//
// Providers (Phase 1):
//   keyless : Greenhouse ATS, Lever ATS, Remotive, Arbeitnow
//   free key: Adzuna (app_id+app_key), Jooble (key)
// ============================================================

(function () {
    'use strict';

    // ── storage ─────────────────────────────────────────────
    var LS = 'is_settings_v1';
    var DEF = {
        country: 'in',                       // Adzuna country code
        location: 'India',                   // free-text location filter
        indiaOnly: true,
        remoteOnly: false,
        enabled: { serpapi: false, adzuna: false, jooble: false, themuse: true, greenhouse: true, lever: true, remotive: true, arbeitnow: true },
        keys: { adzunaId: '', adzunaKey: '', jooble: '', serpapi: '' },
        // editable ATS company slugs (users curate these)
        greenhouseCos: ['razorpay', 'postman', 'freshworks', 'zomato', 'cred', 'groww', 'meesho', 'phonepe'],
        leverCos: ['swiggy', 'sharechat', 'browserstack', 'netflix']
    };
    function loadCfg() {
        try { var s = JSON.parse(localStorage.getItem(LS)); if (s) return merge(DEF, s); } catch (e) { }
        return JSON.parse(JSON.stringify(DEF));
    }
    function saveCfg() { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { } }
    function merge(d, s) {
        var o = JSON.parse(JSON.stringify(d));
        Object.keys(s || {}).forEach(function (k) {
            if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) o[k] = merge(o[k] || {}, s[k]);
            else o[k] = s[k];
        });
        return o;
    }
    var cfg = loadCfg();

    // ── small utils ─────────────────────────────────────────
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function stripHtml(h) { var d = document.createElement('div'); d.innerHTML = String(h || ''); return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim(); }
    function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function normKey(t, c) { return (String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()) + '|' + (String(c || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()); }
    function daysAgo(iso) {
        if (!iso) return '';
        var t = Date.parse(iso); if (isNaN(t)) return '';
        var d = Math.floor((Date.now() - t) / 86400000);
        return d <= 0 ? 'today' : d === 1 ? '1 day ago' : d < 30 ? d + ' days ago' : Math.floor(d / 30) + ' mo ago';
    }
    function appUser() { try { return localStorage.getItem('wms_user') || 'JOBSEARCH'; } catch (e) { return 'JOBSEARCH'; } }

    // ── C# HTTP proxy bridge (no CORS, keys stay server-side) ──
    function httpGet(url, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb('WebView bridge unavailable (open inside the WMS app)'); return; }
        sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, function (err, data) {
            if (err) { cb(err); return; }
            try { cb(null, typeof data === 'string' ? JSON.parse(data) : data); }
            catch (e) { cb('invalid JSON from ' + url); }
        });
    }
    function httpPost(url, body, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb('WebView bridge unavailable'); return; }
        sendMessageToCSharp({ action: 'executePost', fullUrl: url, body: JSON.stringify(body) }, function (err, data) {
            if (err) { cb(err); return; }
            try { cb(null, typeof data === 'string' ? JSON.parse(data) : data); }
            catch (e) { cb('invalid JSON from ' + url); }
        });
    }

    // ── provider registry ───────────────────────────────────
    var PROVIDERS = {
        serpapi:   { label: 'Google Jobs (SerpApi)', color: '#2563eb', key: true, general: true, reg: 'https://serpapi.com/users/sign_up', regLabel: 'Free trial key (100 searches) — Google Jobs' },
        adzuna:    { label: 'Adzuna',    color: '#6d28d9', key: true,  general: true, reg: 'https://developer.adzuna.com/signup', regLabel: 'Get free app_id + app_key' },
        jooble:    { label: 'Jooble',    color: '#0891b2', key: true,  general: true, reg: 'https://jooble.org/api/about', regLabel: 'Request a free API key' },
        themuse:   { label: 'The Muse',  color: '#0d9488', key: false, general: true },
        greenhouse:{ label: 'Greenhouse',color: '#16a34a', key: false, ats: true },
        lever:     { label: 'Lever',     color: '#db2777', key: false, ats: true },
        remotive:  { label: 'Remotive',  color: '#2563eb', key: false },
        arbeitnow: { label: 'Arbeitnow', color: '#b45309', key: false }
    };

    // ── adapters: each -> cb(err, [normalizedJobs], meta) ────
    // Adzuna: app_id + app_key are QUERY params (no header needed).
    // Fetches several pages (50/page) for real coverage.
    function fetchAdzuna(qy, cb) {
        if (!cfg.keys.adzunaId || !cfg.keys.adzunaKey) { cb('missing Adzuna app_id / app_key'); return; }
        var PAGES = 3, all = [], done = 0, firstErr = null;
        function mapRow(r) {
            return {
                id: 'adzuna:' + r.id, source: 'adzuna', title: r.title, company: r.company && r.company.display_name || '',
                location: r.location && r.location.display_name || '', remote: /remote|work from home|wfh/i.test(r.title + ' ' + (r.description || '')),
                url: r.redirect_url, postedAt: r.created || '',
                salary: salaryStr(r.salary_min, r.salary_max, '₹'), tags: (r.category && [r.category.label]) || [], snippet: trunc(stripHtml(r.description), 240)
            };
        }
        for (var p = 1; p <= PAGES; p++) {
            var url = 'https://api.adzuna.com/v1/api/jobs/' + encodeURIComponent(cfg.country || 'in') + '/search/' + p +
                '?app_id=' + encodeURIComponent(cfg.keys.adzunaId) + '&app_key=' + encodeURIComponent(cfg.keys.adzunaKey) +
                '&results_per_page=50&content-type=application/json' +
                (qy.keyword ? '&what=' + encodeURIComponent(qy.keyword) : '') +
                (qy.location ? '&where=' + encodeURIComponent(qy.location) : '');
            httpGet(url, function (err, j) {
                if (err) firstErr = firstErr || err;
                else if (j && j.results) all = all.concat(j.results.map(mapRow));
                if (++done === PAGES) { if (!all.length && firstErr) cb(firstErr); else cb(null, all); }
            });
        }
    }
    // "3 days ago" / "today" -> ISO (Google Jobs uses relative dates)
    function relToIso(s) {
        if (!s) return '';
        s = String(s).toLowerCase();
        if (/just posted|today|hour/.test(s)) return new Date().toISOString();
        var m = s.match(/(\d+)\s*(day|week|month)/);
        if (!m) return '';
        var mult = { day: 86400000, week: 604800000, month: 2592000000 }[m[2]] || 86400000;
        return new Date(Date.now() - (+m[1]) * mult).toISOString();
    }
    // SerpApi Google Jobs: the same results Google shows (Indeed/LinkedIn/
    // Naukri/etc. aggregated). Needs an API key; free trial = 100 searches.
    function fetchSerpApi(qy, cb) {
        if (!cfg.keys.serpapi) { cb('missing SerpApi key'); return; }
        var url = 'https://serpapi.com/search.json?engine=google_jobs&hl=en&gl=' + encodeURIComponent(cfg.country || 'in') +
            '&q=' + encodeURIComponent((qy.keyword || 'IT jobs') + (qy.location ? ' ' + qy.location : '')) +
            (qy.location ? '&location=' + encodeURIComponent(qy.location) : '') +
            '&api_key=' + encodeURIComponent(cfg.keys.serpapi);
        httpGet(url, function (err, j) {
            if (err) { cb(err); return; }
            if (j && j.error) { cb(j.error); return; }
            var out = (j && j.jobs_results || []).map(function (r) {
                var ext = r.detected_extensions || {};
                var apply = (r.apply_options && r.apply_options[0] && r.apply_options[0].link) || r.share_link || '';
                return {
                    id: 'serp:' + (r.job_id ? String(r.job_id).slice(0, 48) : (r.title + r.company_name)),
                    source: 'serpapi', title: r.title, company: r.company_name || '',
                    location: r.location || '', remote: !!ext.work_from_home || /remote|work from home|anywhere/i.test(r.location || ''),
                    url: apply, postedAt: relToIso(ext.posted_at || ''), salary: ext.salary || '',
                    tags: (ext.schedule_type ? [ext.schedule_type] : []).concat(r.via ? ['via ' + String(r.via).replace(/^via\s*/i, '')] : []),
                    snippet: trunc(r.description, 240)
                };
            });
            cb(null, out);
        });
    }
    // Jooble: key is in the PATH, POST JSON body
    function fetchJooble(qy, cb) {
        if (!cfg.keys.jooble) { cb('missing Jooble key'); return; }
        var url = 'https://jooble.org/api/' + encodeURIComponent(cfg.keys.jooble);
        httpPost(url, { keywords: qy.keyword || 'IT', location: qy.location || '', page: 1 }, function (err, j) {
            if (err) { cb(err); return; }
            var out = (j && j.jobs || []).map(function (r) {
                return {
                    id: 'jooble:' + (r.id || r.link), source: 'jooble', title: r.title, company: r.company || '',
                    location: r.location || '', remote: /remote/i.test(r.title + ' ' + (r.snippet || '')),
                    url: r.link, postedAt: r.updated || '', salary: r.salary || '', tags: r.type ? [r.type] : [],
                    snippet: trunc(stripHtml(r.snippet), 240)
                };
            });
            cb(null, out);
        });
    }
    // Greenhouse ATS: one board per company (keyless)
    function fetchGreenhouse(qy, cb) {
        var cos = (cfg.greenhouseCos || []).slice(0, 40);
        if (!cos.length) { cb(null, []); return; }
        multiCompany(cos, function (co, done) {
            httpGet('https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(co) + '/jobs?content=true', function (err, j) {
                if (err || !j || !j.jobs) { done(co, err || 'no jobs', []); return; }
                var out = j.jobs.map(function (r) {
                    return {
                        id: 'gh:' + co + ':' + r.id, source: 'greenhouse', title: r.title, company: prettyCo(co),
                        location: r.location && r.location.name || '', remote: /remote/i.test((r.location && r.location.name) || ''),
                        url: r.absolute_url, postedAt: r.updated_at || '', salary: '',
                        tags: (r.departments || []).map(function (d) { return d.name; }).filter(Boolean).slice(0, 3),
                        snippet: trunc(stripHtml(r.content), 240)
                    };
                });
                done(co, null, out);
            });
        }, qy, cb);
    }
    // Lever ATS: one account per company (keyless)
    function fetchLever(qy, cb) {
        var cos = (cfg.leverCos || []).slice(0, 40);
        if (!cos.length) { cb(null, []); return; }
        multiCompany(cos, function (co, done) {
            httpGet('https://api.lever.co/v0/postings/' + encodeURIComponent(co) + '?mode=json', function (err, arr) {
                if (err || !Array.isArray(arr)) { done(co, err || 'no jobs', []); return; }
                var out = arr.map(function (r) {
                    var cat = r.categories || {};
                    return {
                        id: 'lever:' + co + ':' + r.id, source: 'lever', title: r.text, company: prettyCo(co),
                        location: cat.location || '', remote: /remote/i.test(cat.location || cat.commitment || ''),
                        url: r.hostedUrl, postedAt: r.createdAt ? new Date(r.createdAt).toISOString() : '', salary: '',
                        tags: [cat.team, cat.commitment].filter(Boolean),
                        snippet: trunc(stripHtml(r.descriptionPlain || r.description), 240)
                    };
                });
                done(co, null, out);
            });
        }, qy, cb);
    }
    // Remotive: remote jobs (keyless)
    function fetchRemotive(qy, cb) {
        var url = 'https://remotive.com/api/remote-jobs?limit=100' + (qy.keyword ? '&search=' + encodeURIComponent(qy.keyword) : '');
        httpGet(url, function (err, j) {
            if (err) { cb(err); return; }
            var out = (j && j.jobs || []).map(function (r) {
                return {
                    id: 'remotive:' + r.id, source: 'remotive', title: r.title, company: r.company_name || '',
                    location: r.candidate_required_location || 'Remote', remote: true, url: r.url,
                    postedAt: r.publication_date || '', salary: r.salary || '',
                    tags: (r.tags || []).slice(0, 3), snippet: trunc(stripHtml(r.description), 240)
                };
            });
            cb(null, out);
        });
    }
    // The Muse: general aggregator across many companies/industries (keyless).
    // Fetches several pages; location filter applied client-side.
    function fetchTheMuse(qy, cb) {
        var PAGES = 3, all = [], done = 0, firstErr = null;
        function mapRow(r) {
            var loc = (r.locations && r.locations.map(function (l) { return l.name; }).join(', ')) || '';
            return {
                id: 'muse:' + r.id, source: 'themuse', title: r.name, company: (r.company && r.company.name) || '',
                location: loc, remote: /remote|flexible/i.test(loc), url: (r.refs && r.refs.landing_page) || '',
                postedAt: r.publication_date || '', salary: '',
                tags: (r.categories || []).map(function (c) { return c.name; }).slice(0, 3), snippet: trunc(stripHtml(r.contents), 240)
            };
        }
        for (var p = 0; p < PAGES; p++) {
            var url = 'https://www.themuse.com/api/public/jobs?page=' + p +
                (cfg.indiaOnly && (cfg.country === 'in') ? '&location=' + encodeURIComponent('India') : '');
            httpGet(url, function (err, j) {
                if (err) firstErr = firstErr || err;
                else if (j && j.results) all = all.concat(j.results.map(mapRow));
                if (++done === PAGES) { if (!all.length && firstErr) cb(firstErr); else cb(null, all); }
            });
        }
    }
    // Arbeitnow: global board (keyless)
    function fetchArbeitnow(qy, cb) {
        httpGet('https://www.arbeitnow.com/api/job-board-api', function (err, j) {
            if (err) { cb(err); return; }
            var out = (j && j.data || []).map(function (r) {
                return {
                    id: 'arbeitnow:' + r.slug, source: 'arbeitnow', title: r.title, company: r.company_name || '',
                    location: r.location || '', remote: !!r.remote, url: r.url,
                    postedAt: r.created_at ? new Date(r.created_at * 1000).toISOString() : '', salary: '',
                    tags: (r.tags || []).slice(0, 3), snippet: trunc(stripHtml(r.description), 240)
                };
            });
            cb(null, out);
        });
    }

    function salaryStr(min, max, cur) {
        if (!min && !max) return '';
        function k(n) { n = Number(n); return n >= 100000 ? (Math.round(n / 1000) + 'k') : String(Math.round(n)); }
        cur = cur || '';
        if (min && max) return cur + ' ' + k(min) + '–' + k(max);
        return cur + ' ' + k(min || max);
    }
    function prettyCo(slug) { return String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

    // run an ATS adapter across many companies, tracking per-company status
    function multiCompany(cos, oneFn, qy, cb) {
        var all = [], statuses = [], pending = cos.length;
        cos.forEach(function (co) {
            oneFn(co, function (c, err, jobs) {
                statuses.push({ company: c, ok: !err, count: jobs ? jobs.length : 0, error: err ? String(err) : '' });
                if (jobs && jobs.length) all = all.concat(jobs);
                if (--pending === 0) cb(null, all, { companies: statuses });
            });
        });
    }

    var ADAPTERS = { serpapi: fetchSerpApi, adzuna: fetchAdzuna, jooble: fetchJooble, themuse: fetchTheMuse, greenhouse: fetchGreenhouse, lever: fetchLever, remotive: fetchRemotive, arbeitnow: fetchArbeitnow };

    // Run all enabled providers for a query and return the merged normalized
    // jobs (no rendering) — used by the Oracle Customers tab for job-signal.
    function collect(qy, done) {
        var providers = Object.keys(ADAPTERS).filter(function (p) { return cfg.enabled[p]; });
        if (!providers.length) { done([]); return; }
        var out = [], pending = providers.length;
        providers.forEach(function (p) {
            try { ADAPTERS[p](qy, function (err, jobs) { if (jobs && jobs.length) out = out.concat(jobs); if (--pending === 0) done(out); }); }
            catch (e) { if (--pending === 0) done(out); }
        });
    }

    // ── search orchestration (each search opens its own result tab) ──
    var RT = {};           // tabId -> { id, results, qy, providers, sources }
    var lastResults = [];  // kept for the settings/test panel compatibility

    function stamp() { var d = new Date(); function z(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()); }

    // the header (title + Export to Excel) and containers for one result tab
    function resultShell(tid, title) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">' +
            '<div style="font-size:15px;font-weight:800;color:#0f172a;min-width:0;"><i class="fas fa-briefcase" style="color:#0f766e;"></i> ' + esc(title) + '</div>' +
            '<button class="btn btn-excel" onclick="JobSearch.exportTab(\'' + tid + '\')"><i class="fas fa-file-excel"></i> Export to Excel</button>' +
            '</div>' +
            '<div id="src-' + tid + '" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;"></div>' +
            '<div id="status-' + tid + '" style="font-size:12.5px;color:#64748b;margin:4px 0 12px;"></div>' +
            '<div id="results-' + tid + '"></div>';
    }
    function setStatusT(tid, html) { var el = document.getElementById('status-' + tid); if (el) el.innerHTML = html; }
    function renderSourcesT(tid) {
        var ctx = RT[tid]; if (!ctx) return;
        var el = document.getElementById('src-' + tid); if (!el) return;
        el.innerHTML = ctx.providers.map(function (p) {
            var s = ctx.sources[p], P = PROVIDERS[p];
            var state = !s ? '<i class="fas fa-spinner fa-spin"></i>' : (s.error ? '<i class="fas fa-triangle-exclamation" style="color:#dc2626;"></i>' : '<i class="fas fa-check" style="color:#16a34a;"></i>');
            var cnt = s && !s.error ? ' ' + s.count : '';
            var title = s && s.error ? esc(s.error) : (s ? s.ms + 'ms' : 'querying');
            return '<span title="' + esc(title) + '" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:3px 9px;border-radius:14px;border:1px solid ' + P.color + '33;background:' + P.color + '11;color:' + P.color + ';">' +
                state + ' ' + esc(P.label) + cnt + '</span>';
        }).join(' ');
    }

    function runSearch() {
        var kw = (document.getElementById('is-kw') || {}).value || '';
        var loc = (document.getElementById('is-loc') || {}).value || '';
        cfg.location = loc; saveCfg();
        var qy = { keyword: kw.trim(), location: loc.trim(), country: cfg.country };
        var providers = Object.keys(ADAPTERS).filter(function (p) { return cfg.enabled[p]; });

        var title = (qy.keyword || 'IT jobs') + (qy.location ? ' · ' + qy.location : '');
        var tab = IS.newResultTab(title.length > 30 ? title.slice(0, 28) + '…' : title, 'fa-briefcase');
        var tid = tab.id;
        tab.panel.innerHTML = resultShell(tid, title);
        var ctx = RT[tid] = { id: tid, results: [], qy: qy, providers: providers, sources: {} };

        if (!providers.length) { setStatusT(tid, '<span style="color:#b45309;">No providers enabled — open <b>Setup &amp; Keys</b> and turn some on.</span>'); return; }
        setStatusT(tid, '<i class="fas fa-spinner fa-spin"></i> Searching ' + providers.length + ' source(s)…');
        renderSourcesT(tid);

        var collected = [], pending = providers.length;
        providers.forEach(function (p) {
            var t0 = Date.now();
            ADAPTERS[p](qy, function (err, jobs, meta) {
                ctx.sources[p] = { done: true, ms: Date.now() - t0, count: jobs ? jobs.length : 0, error: err ? String(err) : '', meta: meta };
                if (jobs && jobs.length) collected = collected.concat(jobs);
                renderSourcesT(tid);
                if (--pending === 0) finish(tid, collected, qy);
            });
        });
    }

    // split a query into meaningful tokens (keeps c++, c#, .net etc.)
    function qTokens(s) {
        return String(s || '').toLowerCase().split(/[^a-z0-9+#.]+/).filter(function (t) { return t.length > 1; });
    }
    // a job is relevant if EVERY query token appears somewhere in it
    function relevant(j, toks) {
        if (!toks.length) return true;
        var hay = (j.title + ' ' + j.company + ' ' + (j.tags || []).join(' ') + ' ' + j.snippet).toLowerCase();
        return toks.every(function (t) { return hay.indexOf(t) >= 0; });
    }
    // higher = more relevant (phrase/token hits in the title weigh most)
    function relScore(j, kw, toks) {
        if (!toks.length) return 0;
        var title = (j.title || '').toLowerCase(), s = 0;
        toks.forEach(function (t) { if (title.indexOf(t) >= 0) s += 3; });
        if (kw && title.indexOf(kw) >= 0) s += 6;      // exact phrase in title
        return s;
    }
    var IN_CITIES = /india|bengaluru|bangalore|hyderabad|mumbai|pune|chennai|delhi|gurgaon|gurugram|noida|kolkata|ahmedabad|kochi|jaipur|indore|coimbatore/;
    var NON_IN = /\b(usa|u\.s|united states|canada|uk|united kingdom|europe|emea|latam|apac|americas?|us[- ]?(only|based|timezone)|est|pst|cet|philippines|nigeria|kenya|brazil|germany|france|spain|portugal|poland|ukraine|argentina|mexico|australia)\b/;
    // India-eligible: located in India, matches the typed city, or a remote
    // role that isn't restricted to some other country/region
    function indiaEligible(j, wantCity) {
        var loc = (j.location || '').toLowerCase();
        if (IN_CITIES.test(loc)) return true;
        if (wantCity && wantCity !== 'india' && loc.indexOf(wantCity) >= 0) return true;
        if (j.remote) {
            if (!loc) return true;
            if (/worldwide|anywhere|global|any location|remote/.test(loc)) return !NON_IN.test(loc);
            if (NON_IN.test(loc)) return false;   // remote but limited to other regions
            return true;                          // ambiguous remote -> allow
        }
        return false;
    }

    function finish(tid, jobs, qy) {
        var ctx = RT[tid]; if (!ctx) return;
        var kw = (qy.keyword || '').trim().toLowerCase();
        var toks = qTokens(kw);
        var wantCity = (qy.location || '').toLowerCase();
        var filtered = jobs.filter(function (j) {
            if (cfg.remoteOnly && !j.remote) return false;
            if (!relevant(j, toks)) return false;                 // relevance now enforced on ALL sources
            if (cfg.indiaOnly && !indiaEligible(j, wantCity)) return false;
            return true;
        });

        // dedup by title+company, merge apply links across sources
        var map = {}, order = [];
        filtered.forEach(function (j) {
            var k = normKey(j.title, j.company);
            if (!map[k]) { map[k] = Object.assign({ links: [] }, j); map[k].links.push({ source: j.source, url: j.url }); order.push(k); }
            else { if (j.url && !map[k].links.some(function (l) { return l.url === j.url; })) map[k].links.push({ source: j.source, url: j.url }); }
        });
        var merged = order.map(function (k) { return map[k]; });

        // rank by relevance, then recency
        merged.sort(function (a, b) {
            var d = relScore(b, kw, toks) - relScore(a, kw, toks);
            if (d) return d;
            return (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0);
        });

        ctx.results = merged; lastResults = merged;
        var note = merged.length ? '' : ' — nothing matched; try broader keywords, or enable Adzuna/Jooble in Setup for wider India coverage.';
        setStatusT(tid, '<b>' + merged.length + '</b> matching job(s) after de-duplication' + (jobs.length !== merged.length ? ' (from ' + jobs.length + ' fetched)' : '') + note +
            (merged.length ? ' <a href="javascript:void(0)" onclick="JobSearch.matchResume(\'' + tid + '\')" style="margin-left:10px;color:#0f766e;font-weight:800;text-decoration:none;"><i class="fas fa-wand-magic-sparkles"></i> Match my resume</a>' : ''));
        renderResultsT(tid);
    }

    // ── rendering (scoped to a result tab) ──────────────────
    function renderResultsT(tid) {
        var ctx = RT[tid]; if (!ctx) return;
        var el = document.getElementById('results-' + tid); if (!el) return;
        var jobs = ctx.results;
        if (!jobs.length) { el.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px;">No matching jobs. Try broader keywords, turn off "India only", or enable more providers.</div>'; return; }
        el.innerHTML = jobs.map(function (j, i) {
            var P = PROVIDERS[j.source] || { color: '#64748b', label: j.source };
            var links = (j.links || [{ source: j.source, url: j.url }]).filter(function (l) { return l.url; });
            var applyBtns = links.map(function (l) {
                var lp = PROVIDERS[l.source] || { color: '#0f766e', label: l.source };
                return '<button onclick="JobSearch.apply(\'' + encodeURIComponent(l.url) + '\')" style="font-size:11px;font-weight:800;border:none;cursor:pointer;padding:6px 13px;border-radius:8px;background:' + lp.color + ';color:#fff;"><i class="fas fa-arrow-up-right-from-square"></i> Apply · ' + esc(lp.label) + '</button>';
            }).join(' ');
            return '<div style="border:1px solid #eef2f7;border-radius:12px;padding:14px 16px;margin-bottom:10px;background:#fff;">' +
                '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">' +
                  '<div style="min-width:0;">' +
                    '<div style="font-size:15px;font-weight:800;color:#0f172a;">' + esc(j.title) + '</div>' +
                    '<div style="font-size:12px;color:#475569;margin-top:2px;"><i class="fas fa-building" style="color:#94a3b8;"></i> ' + esc(j.company || '—') +
                      ' &nbsp;·&nbsp; <i class="fas fa-location-dot" style="color:#94a3b8;"></i> ' + esc(j.location || '—') +
                      (j.remote ? ' &nbsp;<span style="font-size:9px;font-weight:800;color:#16a34a;background:#dcfce7;padding:1px 7px;border-radius:8px;">REMOTE</span>' : '') + '</div>' +
                  '</div>' +
                  '<div style="text-align:right;white-space:nowrap;">' +
                    '<span style="font-size:9px;font-weight:800;color:' + P.color + ';background:' + P.color + '18;padding:2px 8px;border-radius:8px;">' + esc(P.label.toUpperCase()) + '</span>' +
                    (j.postedAt ? '<div style="font-size:10px;color:#94a3b8;margin-top:3px;">' + esc(daysAgo(j.postedAt)) + '</div>' : '') +
                    (j.salary ? '<div style="font-size:11px;color:#0f766e;font-weight:800;margin-top:2px;">' + esc(j.salary) + '</div>' : '') +
                  '</div>' +
                '</div>' +
                (j.tags && j.tags.length ? '<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px;">' + j.tags.map(function (t) { return '<span style="font-size:10px;background:#f1f5f9;color:#475569;border-radius:6px;padding:1px 8px;">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
                (j.snippet ? '<div style="font-size:12px;color:#64748b;margin-top:8px;line-height:1.5;">' + esc(j.snippet) + '</div>' : '') +
                '<div id="is-ai-' + tid + '-' + i + '"></div>' +
                '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' + applyBtns +
                  '<button onclick="JobSearch.summarize(\'' + tid + '\',' + i + ')" style="font-size:11px;font-weight:700;padding:5px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#334155;cursor:pointer;"><i class="fas fa-wand-magic-sparkles"></i> Summarize</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // ── Export to Excel (this tab's results) ────────────────
    function exportTab(tid) {
        var ctx = RT[tid]; if (!ctx || !ctx.results.length) { alert('Nothing to export yet — run the search first.'); return; }
        var cols = ['Title', 'Company', 'Location', 'Remote', 'Posted', 'Salary', 'Source', 'Tags', 'Apply URL', 'Description'];
        var rows = ctx.results.map(function (j) {
            var url = (j.links && j.links[0] && j.links[0].url) || j.url || '';
            var posted = '';
            if (j.postedAt) { var t = Date.parse(j.postedAt); if (!isNaN(t)) posted = new Date(t).toISOString().slice(0, 10); }
            return [j.title || '', j.company || '', j.location || '', j.remote ? 'Yes' : 'No', posted, j.salary || '',
                    (PROVIDERS[j.source] && PROVIDERS[j.source].label) || j.source || '', (j.tags || []).join(', '), url, j.snippet || ''];
        });
        var fn = 'jobs_' + (ctx.qy.keyword || 'it').replace(/[^a-z0-9]+/gi, '_').slice(0, 30) + '_' + stamp() + '.xls';
        IS.exportExcel(fn, cols, rows);
    }

    // ── Providers / keys panel ──────────────────────────────
    function openProviders() {
        var m = document.createElement('div');
        m.id = 'is-prov-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML =
            '<div style="background:#fff;border-radius:14px;max-width:680px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">' +
              '<div style="padding:16px 20px;border-bottom:1px solid #eef2f7;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;">' +
                '<div style="font-size:16px;font-weight:800;color:#0f172a;"><i class="fas fa-plug" style="color:#0f766e;"></i> Job Sources & API Keys</div>' +
                '<button onclick="JobSearch.closeProviders()" style="border:none;background:#f1f5f9;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:15px;">✕</button>' +
              '</div>' +
              '<div style="padding:18px 20px;" id="is-prov-body"></div>' +
              '<div style="padding:14px 20px;border-top:1px solid #eef2f7;text-align:right;position:sticky;bottom:0;background:#fff;">' +
                '<button onclick="JobSearch.saveProviders()" style="padding:9px 20px;border:none;border-radius:9px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">Save</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(m);
        renderProvBody();
    }
    function renderProvBody() {
        var b = document.getElementById('is-prov-body'); if (!b) return;
        b.innerHTML = provRowsHtml();
    }
    // builds the intro + one card per provider (shared by modal & full page)
    function provRowsHtml() {
        var rows = Object.keys(PROVIDERS).map(function (p) {
            var P = PROVIDERS[p];
            var on = !!cfg.enabled[p];
            var head = '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">' +
                '<input type="checkbox" id="is-en-' + p + '" ' + (on ? 'checked' : '') + '>' +
                '<span style="font-size:14px;font-weight:800;color:' + P.color + ';">' + esc(P.label) + '</span>' +
                (P.key ? '<span style="font-size:9px;font-weight:800;background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:8px;">NEEDS FREE KEY</span>'
                       : '<span style="font-size:9px;font-weight:800;background:#dcfce7;color:#166534;padding:1px 7px;border-radius:8px;">NO KEY NEEDED</span>') +
                '</label>';
            var body = '';
            if (p === 'serpapi') {
                body = keyRow('SerpApi API key', 'is-k-serpapi', cfg.keys.serpapi) +
                    '<div style="font-size:11px;color:#64748b;margin:-2px 0 4px;">Returns Google Jobs results (Indeed, LinkedIn, Naukri, etc.). Free trial = 100 searches.</div>' + regLink(P);
            } else if (p === 'adzuna') {
                body = keyRow('Adzuna app_id', 'is-k-adzunaId', cfg.keys.adzunaId) + keyRow('Adzuna app_key', 'is-k-adzunaKey', cfg.keys.adzunaKey) +
                    countryRow() + regLink(P);
            } else if (p === 'jooble') {
                body = keyRow('Jooble API key', 'is-k-jooble', cfg.keys.jooble) + regLink(P);
            } else if (p === 'greenhouse') {
                body = coRow('Greenhouse company slugs (comma-separated)', 'is-gh', cfg.greenhouseCos,
                    'e.g. razorpay, postman — the slug in boards.greenhouse.io/&lt;slug&gt;');
            } else if (p === 'lever') {
                body = coRow('Lever company slugs (comma-separated)', 'is-lv', cfg.leverCos,
                    'e.g. swiggy — the slug in jobs.lever.co/&lt;slug&gt;');
            } else {
                body = '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">Public API — nothing to configure.</div>';
            }
            var test = '<button onclick="JobSearch.testProvider(\'' + p + '\')" style="margin-top:8px;font-size:11px;font-weight:700;padding:5px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#334155;cursor:pointer;"><i class="fas fa-vial"></i> Test</button>' +
                '<span id="is-test-' + p + '" style="font-size:11px;margin-left:8px;"></span>';
            return '<div style="border:1px solid #eef2f7;border-radius:10px;padding:12px 14px;margin-bottom:10px;">' + head +
                '<div style="margin-top:8px;">' + body + test + '</div></div>';
        }).join('');
        return '<div style="font-size:12px;color:#64748b;margin-bottom:12px;">Turn sources on/off and paste free API keys (stored only on this PC). ' +
            'Keyless sources work immediately.</div>' + rows;
    }
    function keyRow(label, id, val) {
        return '<div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:2px;">' + esc(label) + '</label>' +
            '<input id="' + id + '" value="' + esc(val || '') + '" style="width:100%;padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;"></div>';
    }
    function countryRow() {
        var opts = [['in', 'India'], ['gb', 'United Kingdom'], ['us', 'United States'], ['au', 'Australia'], ['ca', 'Canada'], ['de', 'Germany'], ['sg', 'Singapore'], ['ae', 'UAE']];
        return '<div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:2px;">Adzuna country</label>' +
            '<select id="is-adzuna-country" style="padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">' +
            opts.map(function (o) { return '<option value="' + o[0] + '"' + (cfg.country === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    }
    function coRow(label, id, arr, hint) {
        return '<div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:2px;">' + esc(label) + '</label>' +
            '<textarea id="' + id + '" rows="2" style="width:100%;padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:Consolas,monospace;">' + esc((arr || []).join(', ')) + '</textarea>' +
            '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + hint + '</div></div>';
    }
    function regLink(P) {
        return '<a href="' + P.reg + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:11px;font-weight:800;color:' + P.color + ';text-decoration:none;">' +
            '<i class="fas fa-arrow-up-right-from-square"></i> Register free — ' + esc(P.regLabel) + '</a>';
    }
    function readProvForm() {
        Object.keys(PROVIDERS).forEach(function (p) { var c = document.getElementById('is-en-' + p); if (c) cfg.enabled[p] = c.checked; });
        var g = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
        if (document.getElementById('is-k-adzunaId')) cfg.keys.adzunaId = g('is-k-adzunaId');
        if (document.getElementById('is-k-adzunaKey')) cfg.keys.adzunaKey = g('is-k-adzunaKey');
        if (document.getElementById('is-k-jooble')) cfg.keys.jooble = g('is-k-jooble');
        if (document.getElementById('is-k-serpapi')) cfg.keys.serpapi = g('is-k-serpapi');
        if (document.getElementById('is-adzuna-country')) cfg.country = g('is-adzuna-country');
        var parseCos = function (id) { var e = document.getElementById(id); return e ? e.value.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean) : null; };
        var gh = parseCos('is-gh'); if (gh) cfg.greenhouseCos = gh;
        var lv = parseCos('is-lv'); if (lv) cfg.leverCos = lv;
    }

    // ── AI: summarize a JD, match resume to jobs ────────────
    function aiSend(prompt, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb('AI bridge unavailable'); return; }
        sendMessageToCSharp({ action: 'aiChatSend', text: '[CURRENT_INSTANCE: PROD]\n' + prompt, sessionId: null, instance: 'PROD' }, function (err, resp) {
            if (err) { cb(String(err)); return; }
            cb(null, (resp && (resp.markdown || resp.answer)) || '');
        });
    }
    function summarize(tid, i) {
        var ctx = RT[tid]; if (!ctx) return;
        var j = ctx.results[i]; if (!j) return;
        var box = document.getElementById('is-ai-' + tid + '-' + i); if (!box) return;
        box.innerHTML = '<div style="margin-top:8px;font-size:12px;color:#0f766e;"><i class="fas fa-spinner fa-spin"></i> Summarizing…</div>';
        aiSend('Summarize this IT job posting for a candidate in 4 short bullet points: role focus, must-have skills, nice-to-haves, and any red flags. Be concise.\n\nTitle: ' + j.title + '\nCompany: ' + j.company + '\nLocation: ' + j.location + '\n\n' + j.snippet,
            function (err, md) {
                if (err) { box.innerHTML = '<div style="margin-top:8px;font-size:12px;color:#b91c1c;">AI error: ' + esc(err) + '</div>'; return; }
                box.innerHTML = '<div style="margin-top:8px;padding:10px 12px;background:#f6fbfa;border:1px solid #d5e9e6;border-radius:8px;font-size:12px;color:#334155;white-space:pre-wrap;">' + esc(md) + '</div>';
            });
    }
    var CV_TID = null;
    function matchResume(tid) {
        var ctx = RT[tid]; if (!ctx || !ctx.results.length) { alert('Run a search first.'); return; }
        CV_TID = tid;
        var m = document.createElement('div');
        m.id = 'is-cv-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:600px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);">' +
            '<div style="padding:16px 20px;border-bottom:1px solid #eef2f7;font-size:16px;font-weight:800;color:#0f172a;"><i class="fas fa-wand-magic-sparkles" style="color:#0f766e;"></i> Match my resume</div>' +
            '<div style="padding:18px 20px;">' +
              '<div style="font-size:12px;color:#64748b;margin-bottom:8px;">Paste your resume (or a summary of skills & experience). Claude will score the top ' + Math.min(ctx.results.length, 8) + ' results and explain the fit.</div>' +
              '<textarea id="is-cv" rows="9" placeholder="e.g. 8 years backend: Java, Spring Boot, AWS, Kafka, microservices; led a team of 5…" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;"></textarea>' +
            '</div>' +
            '<div style="padding:14px 20px;border-top:1px solid #eef2f7;text-align:right;">' +
              '<button onclick="JobSearch.closeCv()" style="padding:8px 16px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;font-weight:700;cursor:pointer;margin-right:8px;">Cancel</button>' +
              '<button onclick="JobSearch.runMatch()" style="padding:8px 18px;border:none;border-radius:9px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">Match</button>' +
            '</div></div>';
        document.body.appendChild(m);
    }
    function runMatch() {
        var tid = CV_TID; var ctx = RT[tid]; if (!ctx) { closeCv(); return; }
        var cv = (document.getElementById('is-cv') || {}).value || '';
        if (!cv.trim()) { alert('Paste your resume first.'); return; }
        closeCv();
        var top = ctx.results.slice(0, 8);
        var list = top.map(function (j, i) { return (i + 1) + '. ' + j.title + ' @ ' + j.company + ' (' + j.location + ') — ' + trunc(j.snippet, 160); }).join('\n');
        setStatusT(tid, '<i class="fas fa-spinner fa-spin"></i> Claude is matching your resume to ' + top.length + ' jobs…');
        aiSend('You are a career matcher. Given the RESUME and the JOB LIST, return a match score 0-100 for each job and one line on why it fits or what is missing. ' +
            'Reply as strict JSON: {"matches":[{"n":1,"score":85,"why":"..."}]} with an entry for every job number.\n\nRESUME:\n' + cv + '\n\nJOB LIST:\n' + list,
            function (err, md) {
                if (err) { setStatusT(tid, '<span style="color:#b91c1c;">AI error: ' + esc(err) + '</span>'); return; }
                var mm = md.match(/```json\s*([\s\S]*?)```/i) || md.match(/(\{[\s\S]*\})/);
                var data = null; try { data = JSON.parse(mm ? mm[1] : md); } catch (e) { }
                if (!data || !data.matches) { setStatusT(tid, '<span style="color:#b45309;">Could not parse AI match. Try again.</span>'); return; }
                var byN = {}; data.matches.forEach(function (x) { byN[x.n] = x; });
                top.forEach(function (j, i) {
                    var x = byN[i + 1]; if (!x) return;
                    var box = document.getElementById('is-ai-' + tid + '-' + i); if (!box) return;
                    var col = x.score >= 75 ? '#16a34a' : x.score >= 50 ? '#b45309' : '#dc2626';
                    box.innerHTML = '<div style="margin-top:8px;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f6fbfa;border:1px solid #d5e9e6;border-radius:8px;">' +
                        '<span style="font-size:15px;font-weight:800;color:' + col + ';white-space:nowrap;">' + x.score + '%</span>' +
                        '<span style="font-size:12px;color:#334155;">' + esc(x.why || '') + '</span></div>';
                });
                ctx.results = top.map(function (j, i) { j._score = (byN[i + 1] || {}).score || 0; return j; }).concat(ctx.results.slice(8));
                ctx.results.sort(function (a, b) { return (b._score || 0) - (a._score || 0); });
                lastResults = ctx.results;
                renderResultsT(tid);
                setStatusT(tid, '<b>Matched</b> — results re-ranked by fit. <a href="javascript:void(0)" onclick="JobSearch.matchResume(\'' + tid + '\')" style="color:#0f766e;font-weight:800;text-decoration:none;">Re-match</a>');
            });
    }

    // ── provider Test ───────────────────────────────────────
    function testProvider(p) {
        readProvForm();
        var el = document.getElementById('is-test-' + p); if (el) el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> testing…';
        ADAPTERS[p]({ keyword: 'developer', location: cfg.location || 'India', country: cfg.country }, function (err, jobs, meta) {
            if (!el) return;
            if (err) { el.innerHTML = '<span style="color:#b91c1c;"><i class="fas fa-xmark"></i> ' + esc(String(err)) + '</span>'; return; }
            var extra = '';
            if (meta && meta.companies) {
                var ok = meta.companies.filter(function (c) { return c.ok && c.count; }).length;
                extra = ' (' + ok + '/' + meta.companies.length + ' companies)';
            }
            el.innerHTML = '<span style="color:#16a34a;"><i class="fas fa-check"></i> ' + (jobs ? jobs.length : 0) + ' jobs' + extra + '</span>';
        });
    }

    // ── public API ──────────────────────────────────────────
    window.JobSearch = {
        init: function () {
            var loc = document.getElementById('is-loc'); if (loc && !loc.value) loc.value = cfg.location || 'India';
            var io = document.getElementById('is-india'); if (io) io.checked = cfg.indiaOnly;
            var ro = document.getElementById('is-remote'); if (ro) ro.checked = cfg.remoteOnly;
            var kw = document.getElementById('is-kw');
            if (kw) kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
        },
        search: runSearch,
        // run enabled providers for a query, return merged jobs (no UI)
        rawSearch: function (qy, cb) { collect(qy || {}, function (jobs) { cb(jobs); }); },
        country: function () { return cfg.country; },
        // open a job link in the system browser (keeps this page in place);
        // falls back to a new tab if the bridge is unavailable
        apply: function (encUrl) {
            var url = decodeURIComponent(encUrl || '');
            if (!url) return;
            if (typeof sendMessageToCSharp === 'function' && window.chrome && window.chrome.webview) {
                sendMessageToCSharp({ action: 'openExternalUrl', url: url });
            } else {
                window.open(url, '_blank', 'noopener');
            }
        },
        toggleIndia: function (v) { cfg.indiaOnly = !!v; saveCfg(); },
        toggleRemote: function (v) { cfg.remoteOnly = !!v; saveCfg(); },
        openProviders: openProviders,
        closeProviders: function () { var m = document.getElementById('is-prov-modal'); if (m) m.remove(); },
        saveProviders: function () { readProvForm(); saveCfg(); this.closeProviders(); },
        // full-page setup: render the provider/keys form into a container
        mountSettings: function (elId) {
            var el = document.getElementById(elId); if (!el) return;
            el.innerHTML = '<div id="is-prov-body">' + provRowsHtml() + '</div>';
        },
        saveSettings: function () {
            readProvForm(); saveCfg();
            var el = document.getElementById('is-save-note');
            if (el) { el.innerHTML = '<i class="fas fa-check"></i> Saved on this PC'; setTimeout(function () { if (el) el.innerHTML = ''; }, 2500); }
        },
        testProvider: testProvider,
        exportTab: exportTab,
        summarize: summarize,
        matchResume: matchResume,
        runMatch: runMatch,
        closeCv: function () { var m = document.getElementById('is-cv-modal'); if (m) m.remove(); }
    };
    function closeCv() { var m = document.getElementById('is-cv-modal'); if (m) m.remove(); }
})();
