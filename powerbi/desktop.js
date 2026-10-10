/* Power BI without an app registration ("Option B").
   1. Reports by link — any app.powerbi.com report link (address bar, File › Embed report › Website or portal,
      a Power BI app link or a Publish-to-web link) is saved in WMS_PBI_LINKS and shown inside the app in an
      iframe (Power BI "secure embed": the viewer signs in with their own Microsoft account; the host keeps the
      Microsoft sign-in popup working). WMS filters go into the link as Power BI URL filters.
   2. Power BI Desktop connection kit — the tables of a dataset defined in the Datasets tab are served by the
      APEX feed GET …/pbi/feed (apex_sql/77_powerbi_feed.sql). The kit writes the Power Query code, the DAX
      measures (DAX query view) and the relationships for Power BI Desktop; the Power BI service then refreshes
      the data itself on its schedule. Feed keys: only the SHA-256 is stored in WMS_PBI_FEED_KEYS, Power BI keeps
      the key as a "Web API" credential. */

var PB_FEED_BASE = PB_APEX.replace(/\/ai$/, '/');          // …/WAREHOUSEMANAGEMENT/
var PB_FEED_URL = PB_FEED_BASE + 'pbi/feed';
var PB_TAKE = 20000;
S.links = []; S.keys = []; S.feedChecked = null;

// ── links ──────────────────────────────────────────────────────
/** Any Power BI report link → { url (secure embed), isPublic, note } or { error }. */
function pbNormalizeLink(input) {
    var s = String(input || '').trim();
    var m = s.match(/src\s*=\s*["']([^"']+)["']/i); if (m) s = m[1];            // pasted <iframe …>
    s = s.replace(/&amp;/g, '&');
    var u; try { u = new URL(s); } catch (e) { return { error: 'That is not a link. Copy it from the browser address bar or File › Embed report › Website or portal.' }; }
    if (u.protocol !== 'https:' || !/(^|\.)powerbi\.com$/i.test(u.hostname)) return { error: 'Only Power BI links (https://app.powerbi.com/…) can be added.' };
    var ctid = u.searchParams.get('ctid');
    if (/^\/view$/i.test(u.pathname) && u.searchParams.get('r'))
        return { url: u.href, isPublic: true, note: 'This is a Publish to web link — anyone who has it can see the report without signing in, and URL filters do not work on it. Prefer File › Embed report › Website or portal.' };
    if (/\/reportEmbed$/i.test(u.pathname)) {
        if (!u.searchParams.get('reportId')) return { error: 'The embed link has no reportId.' };
        if (!u.searchParams.get('autoAuth')) u.searchParams.set('autoAuth', 'true');
        u.searchParams.delete('filter');
        return { url: u.href, isPublic: false };
    }
    if (/\/dashboards\//i.test(u.pathname)) return { error: 'Dashboards cannot be shown this way — pin the visuals to a report, or add the report behind the dashboard.' };
    var app = u.pathname.match(/\/groups\/me\/apps\/([0-9a-f-]{36})\/reports\/([0-9a-f-]{36})(?:\/([^/?#]+))?/i);
    var grp = u.pathname.match(/\/groups\/([^/]+)\/reports\/([0-9a-f-]{36})(?:\/([^/?#]+))?/i);
    var rid, gid, appId, page;
    if (app) { appId = app[1]; rid = app[2]; page = app[3]; }
    else if (grp) { gid = grp[1]; rid = grp[2]; page = grp[3]; }
    else return { error: 'Open the report in Power BI and copy the address, or use File › Embed report › Website or portal.' };
    var out = 'https://app.powerbi.com/reportEmbed?reportId=' + rid + (appId ? '&appId=' + appId : '') +
        (gid && gid.toLowerCase() !== 'me' ? '&groupId=' + gid : '') + '&autoAuth=true' + (ctid ? '&ctid=' + encodeURIComponent(ctid) : '') +
        (page && !/^(details|\?)$/i.test(page) ? '&pageName=' + encodeURIComponent(page) : '');
    return { url: out, isPublic: false };
}
/** Power BI URL filter names: characters other than letters/digits become _xHHHH_. */
function pbFilterName(s) { return String(s).replace(/[^A-Za-z0-9_]/g, function (c) { return '_x' + ('000' + c.charCodeAt(0).toString(16)).slice(-4) + '_'; }); }
function pbFilterExpr(filters) {
    return (filters || []).filter(function (f) { return f.table && f.column && String(f.value).trim() !== ''; }).map(function (f) {
        var vals = String(f.value).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        var q = function (x) { return f.numeric && /^-?\d+(\.\d+)?$/.test(x) ? x : "'" + x.replace(/'/g, "''") + "'"; };
        var col = pbFilterName(f.table) + '/' + pbFilterName(f.column);
        return vals.length > 1 ? col + ' in (' + vals.map(q).join(',') + ')' : col + ' eq ' + q(vals[0]);
    }).join(' and ');
}
function pbLinkUrl(link, filters) {
    var u = new URL(link.URL);
    if (link.IS_PUBLIC === 'Y') return u.href;
    u.searchParams.delete('filter');
    var expr = pbFilterExpr(filters);
    var href = u.href;
    return expr ? href + (href.indexOf('?') >= 0 ? '&' : '?') + 'filter=' + encodeURIComponent(expr).replace(/%2F/g, '/') : href;
}

function loadLinks() {
    return rows("SELECT link_id, name, url, source_url, description, folder, filters_json, is_public, created_by, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS updated " +
        'FROM wms_pbi_links ORDER BY NVL(folder, \' \'), sort_order, name', 500)
        .then(function (r) { S.links = r; return r; })
        .catch(function (e) { S.links = []; S.linkError = String(e); return []; });
}
function linkFilters(link) { try { var f = JSON.parse(link.FILTERS_JSON || '[]'); return Array.isArray(f) ? f : []; } catch (e) { return []; } }

function openLink(link, filters) {
    resetEmbed();
    S.cur = { kind: 'link', id: 'L' + link.LINK_ID, link: link, name: link.NAME };
    S.filters = filters || linkFilters(link);
    renderReportList();
    $('rbar').hidden = false; $('rtitle').textContent = link.NAME;
    $('b-save').hidden = true; $('b-edit').hidden = true; $('b-link').hidden = false;
    document.querySelector('[data-act="print"]').hidden = true;
    document.querySelector('[data-act="addfilter"]').hidden = link.IS_PUBLIC === 'Y';
    renderFilters();
    loadLinkFrame();
}
function loadLinkFrame() {
    var link = S.cur && S.cur.link; if (!link) return;
    var el = $('embed'); el.innerHTML = '';
    var f = document.createElement('iframe');
    f.src = pbLinkUrl(link, S.filters);
    f.title = link.NAME; f.allowFullscreen = true;
    f.setAttribute('allow', 'fullscreen; clipboard-write');
    el.appendChild(f);
    var hint = document.createElement('div');
    hint.className = 'embed-hint';
    hint.innerHTML = '<i class="fa-solid fa-circle-info"></i><span>Blank after <b>Sign in</b>? Click <b>Sign in once</b>: a Power BI window opens — sign in with your Outlook account, wait for the Power BI home page, close the window, and the report here reloads signed in. “Upgrade” or “no access”? Your licence is Free — start the Pro trial.</span>' +
        '<button class="btn sm primary" data-act="signinonce">Sign in once</button>' +
        '<button class="lnk" data-act="hidehint">Got it</button>';
    try { if (localStorage.getItem('pbiHintSeen') !== '1') el.appendChild(hint); } catch (e) { el.appendChild(hint); }
}

function linkModal(link) {
    var l = link || {}, fl = link ? linkFilters(link) : [];
    var folders = S.links.map(function (x) { return x.FOLDER; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    modal('<h2><i class="fa-solid fa-link"></i> ' + (link ? 'Edit report link' : 'Add a Power BI report') + '</h2>' +
        '<p class="muted">Open the report at <b>app.powerbi.com</b> and copy the address bar — or, better, <b>File › Embed report › Website or portal</b> and copy that link. Works without an app registration; each viewer signs in with their own Microsoft account.</p>' +
        '<label class="fld"><span>Power BI link</span><textarea id="l-url" rows="3" class="mono" spellcheck="false" placeholder="https://app.powerbi.com/groups/…/reports/…">' + esc(l.SOURCE_URL || l.URL || '') + '</textarea></label>' +
        '<div id="l-check" class="sm"></div>' +
        '<div class="row"><label class="fld"><span>Name</span><input id="l-name" value="' + esc(l.NAME || '') + '" placeholder="e.g. Trip performance"></label>' +
        '<label class="fld"><span>Folder <em>(optional)</em></span><input id="l-folder" list="l-folders" value="' + esc(l.FOLDER || '') + '" placeholder="e.g. Warehouse"><datalist id="l-folders">' + folders.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></label></div>' +
        '<label class="fld"><span>Description <em>(optional)</em></span><input id="l-desc" value="' + esc(l.DESCRIPTION || '') + '"></label>' +
        (fl.length ? '<p class="sm muted">Default filters: ' + fl.map(function (f) { return esc(f.table + '.' + f.column + ' = ' + f.value); }).join(', ') + ' <button class="lnk" data-mact="clearlf">clear</button></p>' : '') +
        '<div class="modal-f">' + (link ? '<button class="btn" data-mact="dellink" style="margin-right:auto;color:#b91c1c"><i class="fa-solid fa-trash"></i> Remove</button>' : '') +
        '<button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="savelink"' + (link ? ' data-id="' + link.LINK_ID + '"' : '') + '><i class="fa-solid fa-check"></i> ' + (link ? 'Save' : 'Add report') + '</button></div>');
    S.linkEdit = { link: link || null, filters: fl };
    checkLinkInput();
}
function checkLinkInput() {
    var el = $('l-url'); if (!el) return null;
    var v = el.value.trim(), c = $('l-check');
    if (!v) { c.innerHTML = ''; return null; }
    var r = pbNormalizeLink(v);
    c.innerHTML = r.error ? '<span class="err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(r.error) + '</span>'
        : '<span style="color:#15803d"><i class="fa-solid fa-circle-check"></i> Power BI report link</span>' + (r.note ? '<br><span class="warn-t"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(r.note) + '</span>' : '');
    return r;
}
function saveLink(id) {
    var r = checkLinkInput(), name = $('l-name').value.trim();
    if (!r || r.error) { toast(r ? r.error : 'Paste the Power BI link'); return; }
    if (!name) { toast('Give the report a name'); $('l-name').focus(); return; }
    var fl = S.linkEdit ? S.linkEdit.filters : [];
    var cols = { name: v(name, 200), url: v(r.url, 4000), source_url: v($('l-url').value.trim(), 4000), description: v($('l-desc').value.trim(), 1000),
        folder: v($('l-folder').value.trim(), 100), filters_json: v(JSON.stringify(fl), 4000), is_public: lit(r.isPublic ? 'Y' : 'N') };
    var sql = id
        ? 'UPDATE wms_pbi_links SET ' + Object.keys(cols).map(function (k) { return k + ' = ' + cols[k]; }).join(', ') + ', updated_by = ' + v(appUser(), 100) + ', updated_date = SYSDATE WHERE link_id = ' + (+id)
        : 'INSERT INTO wms_pbi_links (' + Object.keys(cols).join(', ') + ', created_by, updated_by) VALUES (' + Object.keys(cols).map(function (k) { return cols[k]; }).join(', ') + ', ' + v(appUser(), 100) + ', ' + v(appUser(), 100) + ')';
    busy('Saving…');
    write(sql).then(function () { busy(null); modal(null); toast(id ? 'Saved' : 'Report added'); return loadReports(); })
        .then(function () {
            var l = id ? S.links.find(function (x) { return +x.LINK_ID === +id; }) : S.links.filter(function (x) { return x.NAME === name; }).sort(function (a, b) { return b.LINK_ID - a.LINK_ID; })[0];
            if (l) openLink(l);
        }).catch(function (e) { busy(null); toast('Save failed: ' + e); });
}
function deleteLink(id) {
    if (!confirm('Remove this report from the app? (It stays in Power BI.)')) return;
    write('DELETE FROM wms_pbi_links WHERE link_id = ' + (+id)).then(function () {
        modal(null); toast('Removed'); if (S.cur && S.cur.id === 'L' + id) { S.cur = null; resetEmbed(); $('rbar').hidden = true; $('embed').innerHTML = ''; $('embed').appendChild(S.emptyEl); }
        return loadReports();
    }).catch(function (e) { toast('Remove failed: ' + e); });
}
function saveLinkFilters() {
    var l = S.cur && S.cur.link; if (!l) return;
    write('UPDATE wms_pbi_links SET filters_json = ' + v(JSON.stringify(S.filters), 4000) + ', updated_by = ' + v(appUser(), 100) + ', updated_date = SYSDATE WHERE link_id = ' + (+l.LINK_ID))
        .then(function () { l.FILTERS_JSON = JSON.stringify(S.filters); toast(S.filters.length ? 'These filters now open with the report' : 'Default filters cleared'); })
        .catch(function (e) { toast('Not saved: ' + e); });
}

// ── feed keys ──────────────────────────────────────────────────
function loadKeys() {
    return rows("SELECT key_id, name, key_hint, dataset_key, NVL(revoked, 'N') AS revoked, created_by, TO_CHAR(created_date, 'YYYY-MM-DD') AS created, " +
        "TO_CHAR(last_used, 'YYYY-MM-DD HH24:MI') AS last_used, use_count FROM wms_pbi_feed_keys ORDER BY key_id DESC", 200)
        .then(function (r) { S.keys = r; return r; }).catch(function () { S.keys = []; return []; });
}
function randomKey() {
    var a = new Uint8Array(24); crypto.getRandomValues(a);
    return 'wms_' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}
function sha256Hex(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').toUpperCase();
    });
}
function newKeyModal() {
    if (!(S.status || {}).isAdmin) { toast('Only AI admins can create feed keys'); return; }
    var dsOpts = '<option value="">Every dataset</option>' + (S.defs || []).map(function (d) { return '<option value="' + esc(d.DATASET_KEY) + '">' + esc(d.NAME) + '</option>'; }).join('');
    modal('<h2><i class="fa-solid fa-key"></i> New feed key</h2><p class="muted">Power BI uses this key to read the dataset tables from APEX. Make one per person or per report file, so you can revoke it later without breaking the others.</p>' +
        '<label class="fld"><span>Name</span><input id="k-name" placeholder="e.g. Javeed — Power BI Desktop"></label>' +
        '<label class="fld"><span>Can read</span><select id="k-ds">' + dsOpts + '</select></label>' +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="mkkey"><i class="fa-solid fa-key"></i> Create key</button></div>');
}
function createKey() {
    var name = $('k-name').value.trim(), ds = $('k-ds').value;
    if (!name) { toast('Give the key a name'); return; }
    var key = randomKey();
    busy('Creating the key…');
    sha256Hex(key).then(function (hash) {
        return write('INSERT INTO wms_pbi_feed_keys (name, key_hash, key_hint, dataset_key, created_by) VALUES (' + v(name, 200) + ', ' + lit(hash) + ', ' + lit(key.slice(0, 10) + '…') + ', ' + v(ds, 60) + ', ' + v(appUser(), 100) + ')');
    }).then(function () {
        busy(null);
        modal('<h2><i class="fa-solid fa-key"></i> Your feed key</h2><p><b>Copy it now — it is shown only once.</b> The app keeps only a fingerprint of it.</p>' +
            '<div class="keybox"><code id="k-val">' + esc(key) + '</code><button class="btn sm primary" data-copy="k-val"><i class="fa-solid fa-copy"></i> Copy</button></div>' +
            '<p class="muted sm">In Power BI Desktop, when it asks how to connect to <code>' + esc(PB_FEED_BASE) + '</code>, choose <b>Web API</b> and paste this key. Do the same in the Power BI service under the semantic model’s <b>Settings › Data source credentials</b>.</p>' +
            '<label class="fld"><span>Test it now (optional)</span></label><div class="row"><button class="btn" data-mact="testkey"><i class="fa-solid fa-vial"></i> Test the feed with this key</button><span id="k-test" class="sm"></span></div>' +
            '<div class="modal-f"><button class="btn primary" data-mact="close">Done</button></div>');
        S.lastKey = key;
        loadKeys().then(function () { if (S.tab === 'setup') renderSetup(); });
    }).catch(function (e) { busy(null); toast('Could not create the key: ' + e); });
}
function revokeKey(id) {
    if (!confirm('Revoke this key? Power BI files and refreshes using it stop working.')) return;
    write("UPDATE wms_pbi_feed_keys SET revoked = 'Y' WHERE key_id = " + (+id)).then(function () { toast('Key revoked'); return loadKeys(); }).then(renderSetup).catch(function (e) { toast(String(e)); });
}
/** GET the feed with a key: {status, rows, error}. */
function testFeed(key, ds, table) {
    var u = PB_FEED_URL + '?ds=' + encodeURIComponent(ds || '') + '&t=' + encodeURIComponent(table || '') + '&skip=0&take=5&k=' + encodeURIComponent(key || '');
    return hostRaw('executeGet', { fullUrl: u }).then(function (r) {
        var body = r.data; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
        var status = r.statusCode || (r.success ? 200 : 0);
        return { status: status, rows: body && body.items ? body.items.length : null, error: body && body.error, raw: typeof r.data === 'string' ? r.data.slice(0, 200) : '' };
    });
}
function feedVerdict(t) {
    if (t.status === 200 && t.rows != null) return { ok: true, text: 'The feed works — ' + t.rows + ' sample row(s) read.' };
    if (t.status === 404 && !t.error) return { ok: false, text: 'The feed is not installed yet — run apex_sql/77_powerbi_feed.sql once in APEX SQL Workshop.' };
    if (t.status === 401) return { ok: false, text: 'Key refused: ' + (t.error || 'unknown key') };
    return { ok: false, text: 'HTTP ' + t.status + ': ' + (t.error || t.raw || 'no answer') };
}
function runKeyTest(key, outId) {
    var out = $(outId); if (!out) return;
    var d = S.def || (S.defs[0] && { key: S.defs[0].DATASET_KEY }) || null;
    var ds = d ? d.key : 'wms_operations', table = S.def && S.def.tables[0] ? S.def.tables[0].name : 'Trips';
    out.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Testing…';
    var go = S.defs.length ? Promise.resolve() : loadDefs();
    go.then(function () {
        if (!S.def && S.defs[0]) { ds = S.defs[0].DATASET_KEY; }
        return testFeed(key, ds, table);
    }).then(function (t) {
        var vd = feedVerdict(t); S.feedChecked = vd.ok;
        out.innerHTML = '<span style="color:' + (vd.ok ? '#15803d' : '#b91c1c') + '"><i class="fa-solid ' + (vd.ok ? 'fa-circle-check' : 'fa-triangle-exclamation') + '"></i> ' + esc(vd.text) + '</span>' +
            (t.status === 404 && t.error ? '<br><span class="muted">(' + esc(ds + ' / ' + table) + ' — save the dataset first)</span>' : '');
    }).catch(function (e) { out.innerHTML = '<span class="err">' + esc(e) + '</span>'; });
}

// ── Power BI Desktop kit ───────────────────────────────────────
var M_TYPES = { String: 'type text', Int64: 'Int64.Type', Double: 'type number', DateTime: 'type datetime', Boolean: 'type logical' };
function mStr(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
function mName(s) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '#' + mStr(s); }
function daxTable(s) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : "'" + String(s).replace(/'/g, "''") + "'"; }
function daxName(s) { return '[' + String(s).replace(/\]/g, ']]') + ']'; }

function mFunction() {
    return '// WmsFeed — reads one table of a Gray\'s WMS dataset from APEX, page by page.\n' +
        '// Credentials: Web API, the feed key from the app (Power BI › Setup).\n' +
        '(dataset as text, tableName as text, columns as list, types as list) as table =>\n' +
        'let\n' +
        '    Take = ' + PB_TAKE + ',\n' +
        '    GetPage = (skip as number) as list =>\n' +
        '        Json.Document(Web.Contents(' + mStr(PB_FEED_BASE) + ', [\n' +
        '            RelativePath = "pbi/feed",\n' +
        '            Query = [ds = dataset, t = tableName, skip = Text.From(skip), take = Text.From(Take)],\n' +
        '            ApiKeyName = "k",\n' +
        '            Timeout = #duration(0, 0, 10, 0)\n' +
        '        ]))[items],\n' +
        '    Pages = List.Generate(\n' +
        '        () => [skip = 0, items = GetPage(0)],\n' +
        '        each [items] <> null,\n' +
        '        each if List.Count([items]) < Take then [skip = [skip], items = null] else [skip = [skip] + Take, items = GetPage([skip] + Take)],\n' +
        '        each [items]),\n' +
        '    Source = Table.FromRecords(List.Combine(Pages), columns, MissingField.UseNull),\n' +
        '    DateCols = List.Select(List.Zip({columns, types}), each Type.Is(_{1}, type datetime)),\n' +
        '    NoZone = Table.TransformColumns(Source, List.Transform(DateCols, (p) => {p{0}, each if _ = null then null else Text.Replace(Text.From(_), "Z", "")})),\n' +
        '    Typed = Table.TransformColumnTypes(NoZone, List.Zip({columns, types}), "en-US")\n' +
        'in\n' +
        '    Typed';
}
function mTable(d, t) {
    return 'let\n    Source = WmsFeed(' + mStr(d.key) + ', ' + mStr(t.name) + ',\n        {' + t.columns.map(function (c) { return mStr(c.name); }).join(', ') + '},\n        {' +
        t.columns.map(function (c) { return M_TYPES[c.dataType] || 'type text'; }).join(', ') + '})\nin\n    Source';
}
function daxMeasures(d) {
    var ms = []; d.tables.forEach(function (t) { (t.measures || []).forEach(function (m) { if (m.name && m.expression) ms.push({ t: t.name, m: m }); }); });
    if (!ms.length) return '';
    return 'DEFINE\n' + ms.map(function (x) { return '    MEASURE ' + daxTable(x.t) + daxName(x.m.name) + ' = ' + x.m.expression; }).join('\n') +
        '\n\nEVALUATE\n    ROW(' + ms.slice(0, 12).map(function (x) { return mStr(x.m.name) + ', ' + daxName(x.m.name); }).join(', ') + ')';
}
function kitSection(n, title, body) { return '<div class="kit-step"><div class="kit-n">' + n + '</div><div class="kit-b"><h3>' + title + '</h3>' + body + '</div></div>'; }
function codeBlock(id, code, rows) {
    return '<div class="codebox"><textarea id="' + id + '" readonly spellcheck="false" rows="' + (rows || 8) + '">' + esc(code) + '</textarea><button class="btn sm" data-copy="' + id + '"><i class="fa-solid fa-copy"></i> Copy</button></div>';
}
function desktopKit() {
    var d = S.def; if (!d) return;
    var go = S.dirty || !S.defRow ? saveDef() : Promise.resolve();
    go.then(function () {
        var withCols = d.tables.filter(function (t) { return t.columns.length; });
        if (withCols.length < d.tables.length) toast('Tables without columns are left out — click Detect columns on them first');
        var tbls = withCols.map(function (t, i) {
            return '<details' + (i === 0 ? ' open' : '') + '><summary><b>' + esc(t.name) + '</b> <small class="muted">' + t.columns.length + ' columns</small></summary>' + codeBlock('kit-t' + i, mTable(d, t), 7) + '</details>';
        }).join('');
        var dax = daxMeasures(d);
        var fmts = []; d.tables.forEach(function (t) { (t.measures || []).forEach(function (m) { if (m.formatString) fmts.push(esc(m.name) + ' → <code>' + esc(m.formatString) + '</code>'); }); });
        var rels = (d.relationships || []).map(function (r) {
            return '<li><code>' + esc(r.fromTable + '[' + r.fromColumn + ']') + '</code> (many) → <code>' + esc(r.toTable + '[' + r.toColumn + ']') + '</code> (one)' + (r.crossFilteringBehavior === 'BothDirections' ? ', both directions' : '') + '</li>';
        }).join('');
        var keys = (S.keys || []).filter(function (k) { return k.REVOKED !== 'Y' && (!k.DATASET_KEY || k.DATASET_KEY === d.key); });
        modal('<h2><i class="fa-solid fa-desktop"></i> Use “' + esc(d.name) + '” in Power BI Desktop</h2>' +
            '<p class="muted">No app registration needed. Power BI reads these tables straight from APEX, and after you publish, the Power BI service refreshes them on its own schedule.</p>' +
            kitSection(1, 'Feed key', keys.length ? '<p class="sm">You have ' + keys.length + ' key(s) that can read this dataset (' + keys.map(function (k) { return esc(k.NAME); }).join(', ') + '). Lost it? Make a new one.</p><button class="btn sm" data-mact="newkey"><i class="fa-solid fa-key"></i> New key</button>'
                : '<p class="sm">Make a key first — Power BI asks for it once.</p><button class="btn sm primary" data-mact="newkey"><i class="fa-solid fa-key"></i> Create a feed key</button>') +
            kitSection(2, 'The WmsFeed function', '<p class="sm">In Power BI Desktop: <b>Home › Get data › Blank query</b>, then <b>Advanced Editor</b>, paste this, click Done and rename the query to <b>WmsFeed</b>.</p>' + codeBlock('kit-fn', mFunction(), 10)) +
            kitSection(3, 'One query per table', '<p class="sm">For each table: <b>New Source › Blank query › Advanced Editor</b>, paste, and name the query as shown. The first time, Power BI asks how to connect to <code>' + esc(PB_FEED_BASE) + '</code> — pick <b>Web API</b>, paste the feed key, and set the privacy level to <b>Organizational</b>. Then <b>Close &amp; Apply</b>.</p>' + tbls) +
            kitSection(4, 'Relationships', rels ? '<p class="sm">Power BI often finds these itself. If not, drag them in <b>Model view</b>:</p><ul class="sm">' + rels + '</ul>' : '<p class="sm muted">None defined.</p>') +
            kitSection(5, 'Measures', dax ? '<p class="sm">Open <b>DAX query view</b>, paste this, and click <b>Update model: Add new measures</b> above the code. Then set the formats in Measure tools: ' + (fmts.join(', ') || '—') + '.</p>' + codeBlock('kit-dax', dax, 9) : '<p class="sm muted">No measures defined.</p>') +
            kitSection(6, 'Publish and schedule', '<p class="sm"><b>Home › Publish</b> to your workspace. At app.powerbi.com open the semantic model’s <b>Settings</b>: <b>Data source credentials › Edit</b> → Web API → the key; then <b>Refresh › Scheduled refresh</b> (e.g. 06:00 daily). No gateway is needed — APEX is on the internet.</p>' +
                '<p class="sm">Finally, back in the app: <b>Reports › Add report</b> and paste the report link.</p>') +
            '<div class="modal-f"><button class="btn" data-mact="kitdl"><i class="fa-solid fa-download"></i> Download all as a text file</button><button class="btn primary" data-mact="close">Done</button></div>', 'wide');
        S.kitText = '=== WmsFeed (Blank query, name it WmsFeed) ===\n' + mFunction() + '\n\n' + withCols.map(function (t) { return '=== ' + t.name + ' (Blank query, name it ' + t.name + ') ===\n' + mTable(d, t); }).join('\n\n') +
            (dax ? '\n\n=== Measures (DAX query view) ===\n' + dax : '') + '\n\n=== Relationships (Model view) ===\n' + (d.relationships || []).map(function (r) { return r.fromTable + '[' + r.fromColumn + '] -> ' + r.toTable + '[' + r.toColumn + ']'; }).join('\n') + '\n';
    }).catch(function () { });
}
function downloadText(name, text) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function copyFrom(id) {
    var el = $(id); if (!el) return;
    var t = el.value != null ? el.value : el.textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Copied'); }, function () {
        if (el.select) { el.select(); document.execCommand('copy'); toast('Copied'); }
    });
}

/** Setup: the no-registration part (feed + keys) shown above the app registration card. */
function renderDesktopSetup() {
    var st = S.status || {};
    var keys = S.keys || [];
    return '<div class="card"><h3><i class="fa-solid fa-desktop"></i> Power BI Desktop connection <span class="tag">no IT needed</span></h3>' +
        '<p class="muted sm">Power BI Desktop and the Power BI service read the dataset tables from APEX through this feed with a key. Build reports in Power BI Desktop (<b>Datasets › Power BI Desktop</b> gives you the code), publish them, then add them under <b>Reports › Add report</b>.</p>' +
        '<div class="row"><label class="fld grow"><span>Feed URL</span><input readonly class="mono" id="s-feed" value="' + esc(PB_FEED_URL) + '"></label><button class="btn" data-copy="s-feed" style="align-self:end;"><i class="fa-solid fa-copy"></i></button></div>' +
        '<div class="row"><label class="fld grow"><span>Test with a key</span><input id="s-tkey" type="password" placeholder="paste a feed key" class="mono"></label><button class="btn" data-act="testfeed" style="align-self:end;"><i class="fa-solid fa-vial"></i> Test the feed</button></div><div id="s-tout" class="sm"></div>' +
        '<div class="mh"><b>Feed keys</b><small class="muted">only a fingerprint is stored — revoke a key to cut off a file or a person</small>' + (st.isAdmin ? '<button class="btn sm primary" data-act="newkey"><i class="fa-solid fa-key"></i> New key</button>' : '') + '</div>' +
        (keys.length ? '<table class="tbl-log"><tr><th>Name</th><th>Key</th><th>Dataset</th><th>Created</th><th>Last used</th><th>Uses</th><th></th></tr>' + keys.map(function (k) {
            return '<tr' + (k.REVOKED === 'Y' ? ' class="revoked"' : '') + '><td>' + esc(k.NAME) + '</td><td class="mono">' + esc(k.KEY_HINT) + '</td><td>' + esc(k.DATASET_KEY || 'all') + '</td><td>' + esc(k.CREATED) + ' <small class="muted">' + esc(k.CREATED_BY || '') + '</small></td>' +
                '<td>' + esc(k.LAST_USED || '—') + '</td><td>' + esc(k.USE_COUNT || 0) + '</td><td>' + (k.REVOKED === 'Y' ? '<span class="st FAILED">revoked</span>' : st.isAdmin ? '<button class="btn sm" data-act="revokekey" data-id="' + k.KEY_ID + '">Revoke</button>' : '') + '</td></tr>';
        }).join('') + '</table>' : '<p class="muted sm">No keys yet.</p>') +
        '<p class="muted sm"><i class="fa-solid fa-circle-info"></i> One-time APEX step: run <code>apex_sql/77_powerbi_feed.sql</code> in SQL Workshop (creates the feed endpoint). “Test the feed” tells you if it is missing.</p></div>';
}

/** The Microsoft sign-in popup closed: reload the embedded report so it picks up the sign-in. */
function onSignInClosed() {
    if (S.cur && S.cur.kind === 'link') setTimeout(loadLinkFrame, 700);
}
/** Fallback: the report in its own app window (a normal page, not an iframe). */
function openInWindow() {
    var url = S.cur && (S.cur.kind === 'link' ? (S.cur.link.SOURCE_URL && /^https:\/\/app\.powerbi\.com\/(groups|view)/i.test(S.cur.link.SOURCE_URL) ? S.cur.link.SOURCE_URL : pbLinkUrl(S.cur.link, S.filters)) : S.cur.webUrl);
    if (!url) return;
    if (S.cur.kind === 'link' && S.filters.length && /\/groups\//.test(url)) {       // report URLs take the same ?filter=
        var ex = pbFilterExpr(S.filters); url = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'filter=' + encodeURIComponent(ex).replace(/%2F/g, '/');
    }
    pb('pbiOpenWindow', { url: url, title: S.cur.name || S.cur.link && S.cur.link.NAME }).catch(function (e) { toast(String(e)); });
}

/** Sign in to Power BI in a normal (top-level) window; closing it reloads the embedded report, which then reuses that sign-in. */
function signInOnce() {
    pb('pbiOpenWindow', { url: 'https://app.powerbi.com/home', title: 'sign in, then close this window' })
        .then(function () { toast('Sign in in the Power BI window, then close it'); })
        .catch(function (e) { toast(String(e)); });
}
