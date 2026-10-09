// ═══════════════════════════════════════════════════════════════════════════════
// PICKER APP — the pickers' mobile app (FCPos, javeedin/reerpPOSMobileApp) inside the WMS desktop: menu item
// data-page="picker-app" (group Operate). The page shows mobile/index.html (the app's web build, written by
// tools/mobile/build-mobile.js) in phone-shaped frames and answers the app's Oracle calls: the bridge inside the build
// (mobile/bridge.js) posts every APEX / Fusion request to this page, which runs it through the desktop host's relay
// (executeGet / executePost / executeOracleFusionGet / Post / Patch) and posts the answer back — no CORS, Fusion
// credentials stay in C#. "View only" (default on, localStorage wms.pa.viewOnly) blocks the calls that change data
// (pick confirm, ship confirm, cancel, pick wave …) and lists them in the panel; off = fully live.
// PICKERS: the panel lists the mobile app's users of type PICKER from GR_MOBILE_USER (the username / password table the
// app logs in with — read DISTINCT, PICKER type only, the password column is never selected; another users table is found
// by its columns when GR_MOBILE_USER is missing, the WMS pickers list when there is none), each with the WMS picker of the
// same name (type Bulk / Individual / Relief, area) — a click opens the app in a NEW frame signed in as that picker
// (the frame's own storage is seeded with the user row, no password; audited picker_app_open), so several pickers' apps
// run side by side, each with its own login and cache. "Sign in yourself" opens a plain frame with the login screen.
// Size handheld (default) / phone / large phone / tablet, zoom fit (default) / 75–150 % (100 % = real size, the page scrolls), rotate, reload / close per frame,
// own tab; the side panel hides behind a slim Panel tab (localStorage wms.pa.side) so the apps get the whole width. Frames are kept while other
// pages are shown. window.WmsPickerApp = {onShow, open, openPicker, popup, close, reload, setViewOnly, loadPickers, state}
//
// Popup mode (WmsPickerApp.popup(name, {instance})): one picker's phone as a floating, draggable panel at the top right of ANY
// page — the Picker Monitor's cards and picker headers use it (wms/picker-phone.js). The picker is found in the users list by
// picker name / name / login; without a login the app opens on the picker name alone and the panel says so. The script talks
// to the host through sendMessageToCSharp when the page has the WMS bridge, else through its own small transport on
// window.chrome.webview (request ids pa-…, the host's restResponse / error / generic replies read like the bridge does), so it
// works on pages without app.js such as wms/picker-view.html.
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var PAGE = 'picker-app', MAX_FRAMES = 6;
    var SRC = window.WMS_PICKER_APP_SRC || '../mobile/index.html';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP', WM = ORDS + '/WAREHOUSEMANAGEMENT', GW = WM + '/ai';
    var SIZES = { handheld: [360, 640, 'Handheld · 360 × 640'], phone: [390, 844, 'Phone · 390 × 844'], large: [430, 932, 'Large phone · 430 × 932'], tablet: [820, 1180, 'Tablet · 820 × 1180'] };
    var SECRET = /(PASSWORD|PASSWD|PWD|SECRET|TOKEN|HASH|SALT|PIN)/i;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
    function hosted() { return !!(window.chrome && window.chrome.webview); }
    /** Own transport for pages without the WMS bridge (no sendMessageToCSharp): posts the message with a pa- request id and reads
     *  the host's reply the way app.js does — error → cb(message), restResponse → cb(null, data, statusCode) / cb({message,
     *  statusCode, body}), anything else → cb(null, data || reply). Ids live in OWN.pending, never in window.pendingRequests. */
    var OWN = { pending: {}, on: false };
    function ownSend(msg, cb, ms) {
        if (!OWN.on) {
            OWN.on = true;
            window.chrome.webview.addEventListener('message', function (ev) {
                var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
                if (!r || !r.requestId || !OWN.pending[r.requestId]) return;
                var w = OWN.pending[r.requestId]; delete OWN.pending[r.requestId]; clearTimeout(w.t);
                if (r.action === 'error') w.cb(r.message || (r.data && r.data.message) || 'error', null);
                else if (r.action === 'restResponse') { if (r.success === false) w.cb({ message: 'HTTP ' + r.statusCode, statusCode: r.statusCode, body: r.data }, null); else w.cb(null, r.data, r.statusCode); }
                else w.cb(null, r.data || r);
            });
        }
        var id = 'pa-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); msg.requestId = id;
        OWN.pending[id] = { cb: cb, t: setTimeout(function () { if (OWN.pending[id]) { delete OWN.pending[id]; cb('Request timed out after ' + ms + 'ms. C# did not respond for action: ' + msg.action, null); } }, ms || 120000) };
        try { window.chrome.webview.postMessage(msg); } catch (e) { var w2 = OWN.pending[id]; delete OWN.pending[id]; if (w2) clearTimeout(w2.t); cb('Error posting message to C#: ' + (e && e.message || e), null); }
    }
    function send(msg, cb, ms) { if (typeof sendMessageToCSharp === 'function') return sendMessageToCSharp(msg, cb, ms, false); return ownSend(msg, cb, ms); }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function curInstance() {
        var el = document.getElementById('current-instance-display'), v = el ? String(el.textContent || '').trim().toUpperCase() : '';
        if (!v) { try { v = String(sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || '').toUpperCase(); } catch (e) { v = ''; } }
        return v || 'PROD';
    }
    function hhmm(d) { d = d || new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
    function initials(name) { var p = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '')[1] || '')).toUpperCase(); }
    function colour(name) { var h = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return 'hsl(' + (h % 360) + ' 55% 42%)'; }
    function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function host(msg, ms) {
        return new Promise(function (resolve, reject) {
            if (!hosted()) { reject(new Error('Open this inside the Gray\'s WMS app.')); return; }
            if (/^ai/.test(String(msg.action || '')) && !msg.appUser) msg.appUser = user();   // the host resolves policies / audit rows for this login
            send(msg, function (err, data) { if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || JSON.stringify(err)))); return; } var r = data; if (typeof data === 'string') { try { r = JSON.parse(data); } catch (e) { r = data; } } resolve(r); }, ms || 60000);
        });
    }
    /** One APEX read through the AI gateway → rows with upper-case keys. */
    function gw(sql, max) {
        return host({ action: 'executePost', fullUrl: GW + '/executequery', body: JSON.stringify({ appUser: user(), sql: sql, maxRows: max || 500 }) }, 120000).then(function (d) {
            if (!d || d.success === false) throw new Error((d && d.error) || 'APEX query failed');
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) { if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; } var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x; });
        });
    }
    var st = { drawn: false, viewOnly: ls('wms.pa.viewOnly') !== '0', size: SIZES[ls('wms.pa.size')] ? ls('wms.pa.size') : 'handheld', landscape: false, frames: [], seq: 0,
        zoom: ls('wms.pa.zoom') || 'fit', side: ls('wms.pa.side') !== '0', rowTop: 0, pickers: null, pickersSrc: '', pickersErr: '', pickersBusy: false, pickersTable: '', filter: '', calls: 0, log: [], blocked: [], pop: null };

    try { st.pop = JSON.parse(ls('wms.pa.pop') || 'null'); if (st.pop && (st.pop.left > window.innerWidth - 80 || st.pop.top > window.innerHeight - 80)) st.pop = null; } catch (e) { st.pop = null; }
    function root() { return document.getElementById(PAGE); }
    function pathOf(url) { try { var u = new URL(url); return u.pathname.replace(/^\/ords\/WKSP_GRAYSAPP\//, '').replace(/^\/fscmRestApi\/resources\/[\d.]+\//, 'fusion/') + (u.search ? '?' + u.search.slice(1, 40) : ''); } catch (e) { return String(url).slice(0, 80); } }
    function frameOf(win) { for (var i = 0; i < st.frames.length; i++) { var f = st.frames[i]; if (f.el && f.el.contentWindow === win) return f; } return null; }
    function frameById(id) { for (var i = 0; i < st.frames.length; i++) if (st.frames[i].id === id) return st.frames[i]; return null; }

    // ── the pickers: the WMS pickers list (what Assign Picker uses, deleted ones out) + each one's app login ─────────
    var TYPE_COLS = ['USER_TYPE', 'USERTYPE', 'USER_ROLE', 'ROLE', 'USER_CATEGORY'], USER_COLS = ['USERNAME', 'USER_NAME', 'LOGIN', 'LOGIN_NAME', 'USER_ID', 'USERID'], NAME_COLS = ['PICKER_NAME', 'FULL_NAME', 'DISPLAY_NAME', 'NAME', 'EMPLOYEE_NAME'];
    function firstOf(r, keys) { for (var i = 0; i < keys.length; i++) if (r[keys[i]] != null && String(r[keys[i]]).trim()) return String(r[keys[i]]).trim(); return ''; }
    function key(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); }
    function upper(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { r[k.toUpperCase()] = o[k]; }); return r; }
    function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
    /** The WMS pickers (pickers/getpickers): name, type Bulk / Individual / Relief, area, category; deleted = 1 left out. */
    function loadWmsPickers() {
        return host({ action: 'executeGet', fullUrl: WM + '/pickers/getpickers' }, 60000).then(function (d) {
            var items = Array.isArray(d) ? d : (d && d.items) || [];
            return items.map(upper).filter(function (r) { var del = r.DELETED; return !(del === 1 || del === '1' || del === 'Y' || del === true); })
                .map(function (r) { return { name: firstOf(r, ['NAME', 'PICKER_NAME', 'PICKER']), pickerType: firstOf(r, ['PICKER_TYPE', 'TYPE']), area: firstOf(r, ['ASSIGNED_AREA', 'AREA']), category: firstOf(r, ['CATEGORY']), contact: firstOf(r, ['CONTACT']), id: r.PICKER_ID }; })
                .filter(function (p) { return p.name; });
        });
    }
    var USERS_TABLE = /^GR_MOBILE_USERS?$/;   // the mobile app's own users table: username + password = what the app logs in with
    /** The app logins of type PICKER from GR_MOBILE_USER (else a table found by its columns — a username and a user-type
     *  column, the LOGIN/user handler's table preferred). Only the table's non-secret columns are selected, DISTINCT,
     *  filtered to the PICKER type in the database — the password column never leaves Oracle. */
    function loadLogins() {
        var want = TYPE_COLS.concat(USER_COLS, NAME_COLS, ['PASSWORD', 'PASSWD', 'PWD']);
        var colsSql = "SELECT table_name, column_name, data_type FROM user_tab_columns WHERE table_name LIKE 'GR_MOBILE_USER%' OR column_name IN (" + want.map(sqlStr).join(', ') + ')';
        var handlerSql = "SELECT TO_CHAR(SUBSTR(h.source, 1, 4000)) AS src FROM user_ords_handlers h JOIN user_ords_templates t ON t.id = h.template_id JOIN user_ords_modules m ON m.id = t.module_id " +
            "WHERE h.method = 'GET' AND (UPPER(m.name) = 'LOGIN' OR UPPER(m.uri_prefix) LIKE '%LOGIN%') AND LOWER(t.uri_template) LIKE 'user%'";
        return Promise.all([gw(colsSql, 1000), gw(handlerSql, 10).catch(function () { return []; })]).then(function (res) {
            var tables = {}; res[0].forEach(function (r) { var t = String(r.TABLE_NAME || ''), c = String(r.COLUMN_NAME || ''); if (!t) return; (tables[t] = tables[t] || []).push({ c: c, ty: String(r.DATA_TYPE || '') }); });
            var fromHandler = {}; res[1].forEach(function (r) { var m, re = /\b(?:FROM|JOIN)\s+("?[A-Za-z0-9_$#]+"?)/gi, src = String(r.SRC || ''); while ((m = re.exec(src))) fromHandler[m[1].replace(/"/g, '').toUpperCase()] = true; });
            var best = null, bestScore = 0;
            Object.keys(tables).forEach(function (t) {
                var cols = tables[t].map(function (x) { return x.c; }), has = function (list) { return list.filter(function (c) { return cols.indexOf(c) >= 0; })[0] || ''; };
                var u = has(USER_COLS), ty = has(TYPE_COLS), mobile = USERS_TABLE.test(t);
                if (mobile) { u = u || cols.filter(function (c) { return /USER|LOGIN/.test(c) && !SECRET.test(c) && !/TYPE|ROLE|ID$/.test(c); })[0] || ''; ty = ty || cols.filter(function (c) { return /TYPE|ROLE/.test(c); })[0] || ''; }
                if (!u || (!ty && !mobile)) return;
                var score = 4 + (mobile ? 20 : 0) + (has(['PASSWORD', 'PASSWD', 'PWD']) ? 2 : 0) + (has(['PICKER_NAME']) ? 2 : 0) + (fromHandler[t] ? 5 : 0) + (/USER/.test(t) ? 1 : 0) - (/LOG$|_LOG|HIST|AUDIT|TRANS|TRX|_V$/.test(t) ? 3 : 0);
                if (score > bestScore) { bestScore = score; best = { table: t, userCol: u, typeCol: ty, mobile: mobile }; }
            });
            if (!best) return { table: '', users: [] };
            var colsP = best.mobile ? Promise.resolve(tables[best.table].map(function (x) { return { COLUMN_NAME: x.c, DATA_TYPE: x.ty }; })) : gw("SELECT column_name, data_type FROM user_tab_columns WHERE table_name = " + sqlStr(best.table) + ' ORDER BY column_id', 300);
            return colsP.then(function (cols) {
                var pick = cols.filter(function (c) { return !SECRET.test(String(c.COLUMN_NAME || '')) && !/LOB|RAW|LONG|XML/.test(String(c.DATA_TYPE || '')); }).map(function (c) { return String(c.COLUMN_NAME); });
                if (!pick.length) return { table: best.table, users: [], typeCol: best.typeCol };
                var sql = 'SELECT DISTINCT ' + pick.join(', ') + ' FROM ' + best.table + (best.typeCol ? ' WHERE UPPER(' + best.typeCol + ") LIKE '%PICK%'" : '') + ' ORDER BY ' + best.userCol;
                return gw(sql, 1000).then(function (rows) { return { table: best.table, typeCol: best.typeCol, users: rows.map(function (r) { return toLogin(r, best.table, best.userCol); }) }; });
            });
        });
    }
    function toLogin(r, src, userCol) {
        var clean = {}; Object.keys(r).forEach(function (k) { if (!SECRET.test(k)) clean[k] = r[k]; });
        var username = firstOf(r, USER_COLS) || (userCol && r[userCol] != null ? String(r[userCol]).trim() : '');
        return { username: username, pickerName: firstOf(r, ['PICKER_NAME']), name: firstOf(r, NAME_COLS) || username, type: firstOf(r, TYPE_COLS).toUpperCase(), warehouse: firstOf(r, ['WAREHOUSE', 'ORGANIZATION', 'ORG_CODE']), active: !(r.ACTIVE === 'N' || r.STATUS === 'INACTIVE' || r.IS_ACTIVE === 'N' || r.DELETED === 1 || r.DELETED === 'Y'), row: clean, src: src };
    }
    /** One list: the app logins of type PICKER (GR_MOBILE_USER — the username the app signs in with), each with the WMS
     *  picker of the same name when there is one (type Bulk / Individual / Relief, area). WMS pickers without a mobile login
     *  are counted, not shown; without any users table the WMS pickers list is shown instead. Sorted by name. */
    function loadPickers(force) {
        if (st.pickersBusy && st.pickersWait) return st.pickersWait;          // a second caller while the first read runs gets the same list
        if (st.pickers && !force) return Promise.resolve(st.pickers);
        st.pickersBusy = true; st.pickersErr = ''; paintPickers();
        var errs = [];
        return st.pickersWait = Promise.all([
            loadWmsPickers().catch(function (e) { errs.push('WMS pickers: ' + (e && e.message || e)); return []; }),
            loadLogins().catch(function (e) { errs.push('mobile users: ' + (e && e.message || e)); return { table: '', users: [] }; })
        ]).then(function (res) {
            var wms = res[0], logins = res[1], by = {}, list = [], wmsBy = {};
            st.pickersTable = logins.table || '';
            wms.forEach(function (p) { wmsBy[key(p.name)] = wmsBy[key(p.name)] || p; });
            if (logins.table) {
                logins.users.forEach(function (u) {
                    var k = key(u.username || u.name); if (!k || by[k]) return;
                    var w = wmsBy[key(u.pickerName)] || wmsBy[key(u.name)] || wmsBy[key(u.username)] || null; if (w) w.matched = true;
                    var e = by[k] = { name: u.pickerName || (w ? w.name : '') || u.name, username: u.username || u.name, pickerName: u.pickerName || (w ? w.name : ''), type: u.type || 'PICKER', pickerType: w ? w.pickerType : '', area: w ? w.area : '', category: w ? w.category : '', wms: !!w, login: u, warehouse: u.warehouse, active: u.active, row: Object.assign({}, u.row) };
                    if (w) { e.row.PICKER_TYPE = w.pickerType; e.row.ASSIGNED_AREA = w.area; }
                    list.push(e);
                });
                var noLogin = wms.filter(function (p) { return !p.matched; });
                st.pickersSrc = list.length + ' picker' + (list.length === 1 ? '' : 's') + ' with an app login in ' + logins.table + (logins.typeCol ? ' (type PICKER)' : ' (no user-type column — every mobile user)') +
                    (wms.length ? ' · ' + list.filter(function (e) { return e.wms; }).length + ' also in the WMS pickers list' + (noLogin.length ? ' · ' + noLogin.length + ' WMS picker' + (noLogin.length === 1 ? '' : 's') + ' without an app login not shown (' + noLogin.slice(0, 6).map(function (p) { return p.name; }).join(', ') + (noLogin.length > 6 ? ', …' : '') + ')' : '') : '');
            } else {
                wms.forEach(function (p) { var k = key(p.name); if (by[k]) return; by[k] = { name: p.name, username: p.name, pickerName: p.name, type: 'PICKER', pickerType: p.pickerType, area: p.area, category: p.category, wms: true, login: null, warehouse: '', active: true, row: { PICKER_NAME: p.name, USERNAME: p.name, USER_TYPE: 'PICKER', PICKER_TYPE: p.pickerType, ASSIGNED_AREA: p.area } }; list.push(by[k]); });
                st.pickersSrc = wms.length + ' from the WMS pickers list (deleted ones left out) — no mobile users table (GR_MOBILE_USER) found, so the app opens on the picker name alone';
            }
            list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
            st.pickersErr = errs.join(' · ');
            st.pickers = list; st.pickersBusy = false; paintPickers(); return list;
        }).catch(function (e) { st.pickers = []; st.pickersErr = e && e.message || String(e); st.pickersBusy = false; paintPickers(); return []; });
    }
    function visiblePickers() {
        var q = st.filter.trim().toUpperCase();
        return (st.pickers || []).filter(function (p) { return !q || (p.name + ' ' + p.username + ' ' + p.pickerType + ' ' + p.area + ' ' + p.category + ' ' + p.warehouse).toUpperCase().indexOf(q) >= 0; });
    }
    /** The user object the app keeps after its own login (AuthContext fullUserData), from the picker's row — no password. */
    function userDataOf(p, instance) {
        var u = {}; Object.keys(p.row || {}).forEach(function (k) { u[k] = p.row[k]; });
        u.username = p.username || p.name; u.user_name = u.username; u.USERNAME = u.username;
        if (p.pickerName) { u.PICKER_NAME = p.pickerName; u.picker_name = p.pickerName; }
        u.user_type = 'PICKER'; u.USER_TYPE = u.user_type; u.userType = u.user_type;
        if (p.warehouse) u.warehouse = p.warehouse;
        u.instance = instance; u.loginTime = new Date().toISOString(); u.wmsDesktop = true;
        return u;
    }

    // ── frames ───────────────────────────────────────────────────────────────────────────────────────────────────
    /** opts.pop = the floating popup (one frame, replaces the one before), opts.instance = the pod when the page has no WMS toolbar. */
    function open(picker, opts) {
        opts = opts || {};
        var pop = !!opts.pop;
        if (!pop && !st.drawn) draw();
        if (picker) { var had = st.frames.filter(function (f) { return !!f.pop === pop && f.picker && f.picker.username === picker.username; })[0]; if (had) { if (pop) showPop(); else focusFrame(had); return had; } }
        if (pop) { st.frames.filter(function (f) { return f.pop; }).forEach(function (f) { close(f.id); }); ensurePop(); }
        else if (st.frames.filter(function (f) { return !f.pop; }).length >= MAX_FRAMES) { note('At most ' + MAX_FRAMES + ' apps at a time — close one first.', 'warning'); return null; }
        var instance = String(opts.instance || curInstance()).toUpperCase(), f = { id: ++st.seq, pop: pop, picker: picker || null, label: picker ? picker.name : 'Sign in yourself', instance: instance, ready: false, loaded: false, build: null, calls: 0, el: null, missingTimer: null, openedAt: hhmm() };
        st.frames.push(f);
        var dev = document.createElement('div'); dev.className = 'pa-dev' + (pop ? ' pop' : ''); dev.id = 'pa-dev-' + f.id;
        dev.innerHTML = '<div class="pa-devhead"><span class="pa-av" style="background:' + (picker ? colour(picker.name) : '#475569') + '">' + (picker ? esc(initials(picker.name)) : '<i class="fas fa-user"></i>') + '</span>' +
            '<span class="pa-who"><b>' + esc(f.label) + '</b><small>' + (picker ? esc(picker.username) + ' · ' + esc(instance) : 'the app\'s own login screen') + '</small></span>' +
            '<span class="pa-devpills" id="pa-pills-' + f.id + '"></span>' +
            (pop ? '<label class="pa-chk pa-popview" title="View only: the app may read but every change is blocked"><input type="checkbox" data-act="view"' + (st.viewOnly ? ' checked' : '') + '> view only</label>' : '') +
            (pop ? '<button class="pa-ib" data-act="dock" title="Back to the corner (the page makes room for the phone there)"><i class="fas fa-compress-arrows-alt"></i></button>' : '') +
            '<button class="pa-ib" data-act="reload" title="Load the app again"><i class="fas fa-redo"></i></button><button class="pa-ib" data-act="close" title="Close this app"><i class="fas fa-times"></i></button></div>' +
            (pop ? '<div class="pa-pop-note" id="pa-pop-note-' + f.id + '"></div>' : '') +
            '<div class="pa-phone" id="pa-phone-' + f.id + '"><div class="pa-missing" id="pa-missing-' + f.id + '" hidden></div><iframe class="pa-screen" id="pa-frame-' + f.id + '" title="' + esc(f.label) + '" allow="camera; microphone; clipboard-write"></iframe></div>';
        var row = document.getElementById(pop ? 'pa-pop' : 'pa-frames'); row.appendChild(dev);
        dev.querySelector('[data-act="reload"]').onclick = function () { load(f); };
        dev.querySelector('[data-act="close"]').onclick = function () { close(f.id); };
        var vc = dev.querySelector('[data-act="view"]'); if (vc) vc.onchange = function () { setViewOnly(vc.checked); };
        var dk = dev.querySelector('[data-act="dock"]'); if (dk) dk.onclick = function () { dockBack(); };
        f.el = dev.querySelector('iframe');
        if (pop) { showPop(); popDrag(dev.querySelector('.pa-devhead')); }
        sizeFrames(); load(f); paintStatus(); paintPickers();
        if (picker) host({ action: 'aiAudit', source: 'WMS_PICKER_APP', actionKey: 'picker_app_open', outcome: 'OK', instance: instance, refId: 'USER:' + (picker.username || picker.name), target: picker.name, detail: 'Picker app opened as ' + picker.name + ' (' + (picker.username || '') + ') on ' + instance + ' · ' + (st.viewOnly ? 'view only' : 'LIVE') + ' · by ' + user() }, 15000).catch(function () {});
        setTimeout(function () { focusFrame(f); }, 50);
        return f;
    }
    function load(f) {
        if (!f || !f.el) return;
        f.ready = false; f.loaded = false; hideMissing(f);
        var seed = { viewOnly: st.viewOnly, label: f.label, storage: { app_instance: f.instance } };
        if (f.picker) seed.storage.userData = JSON.stringify(userDataOf(f.picker, f.instance));
        f.el.src = SRC + (SRC.indexOf('?') >= 0 ? '&' : '?') + 'wms=' + f.id + '-' + Date.now() + '#wms=' + b64url(JSON.stringify(seed));
        clearTimeout(f.missingTimer);
        f.missingTimer = setTimeout(function () { if (!f.ready) showMissing(f); }, 8000);
        paintPills(f); paintStatus();
    }
    function close(id) { var f = frameById(id); if (!f) return; clearTimeout(f.missingTimer); var dev = document.getElementById('pa-dev-' + id); if (dev) dev.remove(); st.frames = st.frames.filter(function (x) { return x.id !== id; }); if (f.pop && !st.frames.some(function (x) { return x.pop; })) { var pp = document.getElementById('pa-pop'); if (pp) pp.hidden = true; dock(); } sizeFrames(); paintStatus(); paintPickers(); paintHint(); }
    function focusFrame(f) { var dev = document.getElementById('pa-dev-' + f.id); if (dev && dev.scrollIntoView) { try { dev.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (e) { dev.scrollIntoView(); } } }
    function reloadAll() { st.frames.forEach(load); }
    function showMissing(f) {
        var el = document.getElementById('pa-missing-' + f.id); if (!el) return;
        el.innerHTML = '<i class="fas fa-mobile-alt" style="font-size:30px;color:#475569;margin-bottom:10px"></i><b>The app did not answer.</b><span style="margin-top:6px">Either the mobile build is not installed on this PC (<code>mobile/index.html</code> next to the wms folder — run <code>node tools/mobile/build-mobile.js</code>) or it is still loading.</span><button class="pa-btn primary" style="margin-top:14px"><i class="fas fa-redo"></i> Try again</button>';
        el.hidden = false; el.querySelector('button').onclick = function () { load(f); };
        paintPills(f); paintStatus();
    }
    function hideMissing(f) { var el = document.getElementById('pa-missing-' + f.id); if (el) el.hidden = true; }
    function sizeFrames() {
        var s = SIZES[st.size] || SIZES.phone, w = st.landscape ? s[1] : s[0], h = st.landscape ? s[0] : s[1];
        var scale = zoomScale(h);
        st.frames.forEach(function (f) {
            var p = document.getElementById('pa-phone-' + f.id); if (!p) return;
            var fw = w, fh = h, fs = scale;
            if (f.pop) { fw = SIZES.handheld[0]; fh = SIZES.handheld[1]; fs = popScale(fh, f); }
            p.style.width = fw + 'px'; p.style.height = fh + 'px'; p.style.transform = Math.abs(fs - 1) > 0.001 ? 'scale(' + fs.toFixed(3) + ')' : ''; p.style.transformOrigin = 'top left'; p.classList.toggle('tablet', !f.pop && st.size === 'tablet');
            var dev = document.getElementById('pa-dev-' + f.id); if (dev) { dev.style.width = Math.round((fw + 28) * fs) + 'px'; dev.style.height = f.pop ? '' : Math.round((fh + 28) * fs + 54) + 'px'; var ph = dev.querySelector('.pa-phone'); if (ph && f.pop) ph.style.marginBottom = Math.round((fh + 28) * (fs - 1)) + 'px'; }
        });
        var zl = document.getElementById('pa-zoom-now'); if (zl) zl.textContent = st.zoom === 'fit' ? Math.round(scale * 100) + ' %' : '';
        paintHint(); dock();
    }
    /** The popup phone: the handheld size, shrunk so the whole panel (header, note, phone) fits the window height — never enlarged. */
    function popScale(h, f) {
        var noteEl = document.getElementById('pa-pop-note-' + f.id), noteH = noteEl && noteEl.textContent ? noteEl.offsetHeight + 6 : 0;
        var avail = window.innerHeight - 164 - noteH;   // top 72 + margin 18 + padding 16 + header 46 + gaps 12
        return Math.max(0.45, Math.min(1, avail / (h + 28)));
    }
    /** The floating popup panel (top right, draggable by the frame's header) that holds one picker's phone. */
    function ensurePop() {
        var pp = document.getElementById('pa-pop');
        if (!pp) { pp = document.createElement('div'); pp.id = 'pa-pop'; pp.className = 'pa-pop'; pp.hidden = true; document.body.appendChild(pp); }
        return pp;
    }
    function showPop() { var pp = ensurePop(); pp.hidden = false; if (st.pop && st.pop.left != null) { pp.style.left = st.pop.left + 'px'; pp.style.top = st.pop.top + 'px'; pp.style.right = 'auto'; pp.style.bottom = 'auto'; } dock(); }
    /** Docked (in its corner, not dragged): the page gets a right padding as wide as the panel, so nothing sits under the phone. */
    function dock() {
        var pp = document.getElementById('pa-pop'), b = document.body, on = !!(pp && !pp.hidden && !st.pop);
        document.querySelectorAll('.pa-dev.pop [data-act="dock"]').forEach(function (x) { x.hidden = !st.pop; });
        if (on) { var w = Math.round(pp.getBoundingClientRect().width) + 36; if (b.style.paddingRight !== w + 'px') b.style.paddingRight = w + 'px'; b.classList.add('pa-docked'); }
        else if (b.classList.contains('pa-docked')) { b.style.paddingRight = ''; b.classList.remove('pa-docked'); }
    }
    function dockBack() { st.pop = null; try { localStorage.removeItem('wms.pa.pop'); } catch (e) { /* ok */ } var pp = document.getElementById('pa-pop'); if (pp) { pp.style.left = ''; pp.style.top = ''; pp.style.right = ''; pp.style.bottom = ''; } dock(); }
    function popDrag(head) {
        if (!head) return;
        head.addEventListener('pointerdown', function (e) {
            if (e.button !== 0 || e.target.closest('button, input, label, a')) return;
            var pp = document.getElementById('pa-pop'); if (!pp) return;
            var r = pp.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, moved = false;
            var mv = function (ev) {
                var l = Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - sx)), t = Math.max(0, Math.min(window.innerHeight - 46, ev.clientY - sy));
                moved = true; st.pop = { left: Math.round(l), top: Math.round(t) }; pp.style.left = l + 'px'; pp.style.top = t + 'px'; pp.style.right = 'auto'; pp.style.bottom = 'auto'; dock();
            };
            var up = function () { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); head.classList.remove('dragging'); if (moved) ls('wms.pa.pop', JSON.stringify(st.pop)); };
            head.classList.add('dragging'); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); e.preventDefault();
        });
    }
    /** One picker's phone in the popup: the picker found by picker name / name / login in the users list (read once), else the app
     *  opens on the name alone and the panel says so. Returns a promise of the frame. */
    function popup(who, opts) {
        opts = opts || {};
        var name = String(who || '').trim(); if (!name) return Promise.resolve(null);
        var inst = String(opts.instance || curInstance()).toUpperCase();
        ensurePop();
        return loadPickers(false).then(function (list) {
            var k = key(name), p = (list || []).filter(function (x) { return key(x.pickerName) === k || key(x.name) === k || key(x.username) === k; })[0], plain = !p;
            if (!p) p = { name: name, username: name, pickerName: name, type: 'PICKER', pickerType: '', area: '', category: '', wms: false, login: null, warehouse: '', active: true, row: { PICKER_NAME: name, USERNAME: name, USER_TYPE: 'PICKER' }, plain: true };
            var f = open(p, { pop: true, instance: inst }); if (!f) return null;
            var n = document.getElementById('pa-pop-note-' + f.id);
            if (n) n.innerHTML = plain ? '<i class="fas fa-circle-info"></i> No app login for <b>' + esc(name) + '</b>' + (st.pickersTable ? ' in ' + esc(st.pickersTable) : (hosted() ? '' : ' (no desktop host)')) + ' — the app opens on the picker name alone.' : '';
            sizeFrames();
            return f;
        });
    }
    /** The frame scale: a fixed zoom (100 % = the phone's real size, the page scrolls), or Fit = the room under the frame
     *  headers down to the bottom of the window (measured where the frames row sits; up to 160 % on a tall screen). */
    function zoomScale(h) {
        if (st.zoom !== 'fit') return Math.max(0.4, Math.min(2, (parseInt(st.zoom, 10) || 100) / 100));
        var row = document.getElementById('pa-frames'), top = row ? row.getBoundingClientRect().top : 0;
        if (top > 40) st.rowTop = top;
        var avail = window.innerHeight - (st.rowTop || 180) - 54 - 30;
        return Math.max(0.4, Math.min(1.6, avail / (h + 28)));
    }

    // ── the relay: one request of an app → the host → the answer back to that frame ──────────────────────────────
    function relay(f, win, m) {
        var t0 = Date.now(), url = String(m.url || ''), method = String(m.method || 'GET').toUpperCase();
        var apex = /oraclecloudapps\.com\//i.test(url), fusion = !apex && /\.oraclecloud\.com\//i.test(url);
        var reply = function (ok, status, body, noteText) {
            st.calls++; if (f) f.calls++;
            st.log.unshift({ at: hhmm(), who: f ? f.label : '?', method: method, path: pathOf(url), ok: ok, status: status, ms: Date.now() - t0, note: noteText || '' }); st.log = st.log.slice(0, 60); paintLog();
            try { win.postMessage({ type: 'wms-mobile-reply', id: m.id, ok: ok, status: status, body: body, contentType: 'application/json' }, '*'); } catch (e) { /* frame gone */ }
        };
        if (!hosted()) { reply(false, 503, JSON.stringify({ success: false, error: 'Open the WMS inside the Gray\'s WMS app — the relay needs the desktop host.' }), 'no host'); return; }
        var msg = null, inst = m.instance || (f && f.instance) || curInstance();
        if (apex && method === 'GET') msg = { action: 'executeGet', fullUrl: url };
        else if (apex && method === 'POST') msg = { action: 'executePost', fullUrl: url, body: m.body == null ? '' : String(m.body) };
        else if (fusion && method === 'GET') msg = { action: 'executeOracleFusionGet', fullUrl: url, instance: inst };
        else if (fusion && method === 'POST') msg = { action: 'executeOracleFusionPost', fullUrl: url, body: m.body == null ? '' : String(m.body), instance: inst };
        else if (fusion && method === 'PATCH') msg = { action: 'executeOracleFusionPatch', fullUrl: url, body: m.body == null ? '' : String(m.body), instance: inst };
        if (!msg) { reply(false, 405, JSON.stringify({ success: false, error: method + ' is not relayed by the WMS desktop.' }), 'not relayed'); return; }
        try {
            send(msg, function (err, data, statusCode) {
                if (err) { var body = err.body != null ? String(err.body) : JSON.stringify({ success: false, error: err.message || String(err) }); reply(false, err.statusCode || 500, body, err.message || ''); return; }
                reply(true, statusCode || 200, typeof data === 'string' ? data : JSON.stringify(data == null ? {} : data));
            }, 180000);
        } catch (e) { reply(false, 500, JSON.stringify({ success: false, error: e && e.message || String(e) }), 'relay error'); }
    }
    function onMessage(e) {
        var f = frameOf(e.source); if (!f) return;
        var m = e.data; if (!m || typeof m !== 'object') return;
        if (m.type === 'wms-mobile-hello') { f.ready = true; f.loaded = true; f.build = m.build || f.build; clearTimeout(f.missingTimer); hideMissing(f); try { e.source.postMessage({ type: 'wms-mobile-ready', viewOnly: st.viewOnly }, '*'); } catch (x) { /* frame gone */ } paintPills(f); paintStatus(); }
        else if (m.type === 'wms-mobile-relay') relay(f, e.source, m);
        else if (m.type === 'wms-mobile-blocked') { st.blocked.unshift({ at: hhmm(), who: f.label, method: m.method, path: pathOf(m.url) }); st.blocked = st.blocked.slice(0, 30); st.log.unshift({ at: hhmm(), who: f.label, method: m.method, path: pathOf(m.url), ok: false, status: 403, ms: 0, note: 'blocked · view only', blocked: true }); st.log = st.log.slice(0, 60); paintLog(); paintBlocked(); }
    }
    function sendMode() { st.frames.forEach(function (f) { if (f.el && f.el.contentWindow) { try { f.el.contentWindow.postMessage({ type: 'wms-mobile-mode', viewOnly: st.viewOnly }, '*'); } catch (e) { /* frame gone */ } } }); }
    window.addEventListener('message', onMessage);

    // ── page ─────────────────────────────────────────────────────────────────────────────────────────────────────
    function draw() {
        var r = root(); if (!r) return;
        r.innerHTML = '<div class="pa' + (st.side ? '' : ' side-hidden') + '">' +
            '<div class="pa-side">' +
            // ONE section: the app header, View only and the pickers — hidden as a whole by the chevron (the Panel tab brings it back)
            '<div class="pa-card pa-main"><h3><i class="fas fa-mobile-alt" style="color:#1e3a8a"></i> Picker app <small id="pa-build"></small><button class="pa-ib" id="pa-side-hide" title="Hide this panel — the apps get the whole width"><i class="fas fa-chevron-left"></i></button></h3>' +
            '<div class="pa-status" id="pa-status"></div>' +
            '<label class="pa-switch pa-switch-sm"><input type="checkbox" id="pa-viewonly"' + (st.viewOnly ? ' checked' : '') + '><span class="k"></span><span><b>View only</b><small>Pick / ship confirm, cancel and pick wave are blocked in every open app. Off = live, like the phone.</small></span></label>' +
            '<div class="pa-pickers"><div class="pa-row pa-pickers-head"><i class="fas fa-users" style="color:#1e3a8a"></i><b>Pickers</b><small id="pa-pickers-n"></small><input type="search" class="pa-sel pa-q" id="pa-q" placeholder="Find a picker…" autocomplete="off"><button class="pa-ib" id="pa-pickers-refresh" title="Read the list again"><i class="fas fa-sync-alt"></i></button></div>' +
            '<ul class="pa-plist" id="pa-plist"></ul><p class="pa-src" id="pa-src"></p>' +
            '<div class="pa-row"><button class="pa-btn" id="pa-self"><i class="fas fa-user"></i> Sign in yourself</button><small style="color:#64748b">the app\'s own login screen</small></div></div></div>' +
            '<details class="pa-card pa-fold" open><summary><i class="fas fa-desktop"></i> Screen</summary><div class="pa-row" style="margin-top:0"><select class="pa-sel" id="pa-size">' + Object.keys(SIZES).map(function (k) { return '<option value="' + k + '"' + (k === st.size ? ' selected' : '') + '>' + SIZES[k][2] + '</option>'; }).join('') + '</select>' +
            '<button class="pa-btn" id="pa-rotate" title="Rotate"><i class="fas fa-sync-alt"></i> Rotate</button><button class="pa-btn" id="pa-open" title="Open the app in its own tab"><i class="fas fa-external-link-alt"></i> Own tab</button></div>' +
            '<div class="pa-row"><label class="pa-chk" for="pa-zoom"><i class="fas fa-search-plus"></i> Zoom</label><select class="pa-sel" id="pa-zoom">' + [['fit', 'Fit to the window'], ['75', '75 %'], ['100', '100 % · real size'], ['125', '125 %'], ['150', '150 %']].map(function (z) { return '<option value="' + z[0] + '"' + (z[0] === st.zoom ? ' selected' : '') + '>' + z[1] + '</option>'; }).join('') + '</select><small id="pa-zoom-now" style="color:#64748b"></small></div></details>' +
            '<details class="pa-card pa-fold"><summary><i class="fas fa-ban"></i> Blocked by View only <small id="pa-blocked-n"></small></summary><ul class="pa-log" id="pa-blocked"></ul></details>' +
            '<details class="pa-card pa-fold"><summary><i class="fas fa-exchange-alt"></i> Calls through this PC <small id="pa-calls-n"></small></summary><ul class="pa-log" id="pa-log"></ul></details>' +
            '</div>' +
            '<div class="pa-stage"><button class="pa-sidetab" id="pa-side-show"' + (st.side ? ' hidden' : '') + ' title="Show the panel (pickers, View only, screen)"><i class="fas fa-chevron-right"></i> Panel <span class="pa-sidetab-n" id="pa-side-n"></span></button><div class="pa-hint" id="pa-hint" hidden></div><div class="pa-frames" id="pa-frames"></div></div></div>';
        r.querySelector('#pa-viewonly').onchange = function () { setViewOnly(this.checked); };
        r.querySelector('#pa-side-hide').onclick = function () { setSide(false); };
        r.querySelector('#pa-side-show').onclick = function () { setSide(true); };
        r.querySelector('#pa-size').onchange = function () { st.size = this.value; ls('wms.pa.size', st.size); sizeFrames(); };
        r.querySelector('#pa-rotate').onclick = function () { st.landscape = !st.landscape; sizeFrames(); };
        r.querySelector('#pa-zoom').onchange = function () { st.zoom = this.value; ls('wms.pa.zoom', st.zoom); sizeFrames(); };
        r.querySelector('#pa-open').onclick = function () { try { window.open(SRC, '_blank'); } catch (e) { /* blocked */ } };
        r.querySelector('#pa-self').onclick = function () { open(null); };
        r.querySelector('#pa-q').oninput = function () { st.filter = this.value; paintPickers(); };
        r.querySelector('#pa-pickers-refresh').onclick = function () { loadPickers(true); };
        st.drawn = true;
        paintStatus(); paintLog(); paintBlocked(); paintPickers(); paintHint();
        loadPickers(false);
        open(null);
    }
    function paintHint() { var el = document.getElementById('pa-hint'); if (!el) return; el.hidden = st.frames.length > 0; el.innerHTML = '<i class="fas fa-mobile-alt"></i><b>No app open.</b> ' + (st.side ? 'Click a picker on the left' : '<a id="pa-hint-side">Show the panel</a> and click a picker') + ' to open the app as that picker, or <a id="pa-hint-self">sign in yourself</a>.'; var a = el.querySelector('#pa-hint-self'); if (a) a.onclick = function () { open(null); }; var b = el.querySelector('#pa-hint-side'); if (b) b.onclick = function () { setSide(true); }; }
    /** The side panel (pickers, View only, screen, logs) hidden = the apps get the whole width; a slim Panel tab brings it back. */
    function setSide(on) {
        st.side = !!on; ls('wms.pa.side', st.side ? '1' : '0');
        var pa = root() && root().querySelector('.pa'); if (pa) pa.classList.toggle('side-hidden', !st.side);
        var tab = document.getElementById('pa-side-show'); if (tab) tab.hidden = st.side;
        paintHint(); sizeFrames();
    }
    function setViewOnly(on) {
        st.viewOnly = !!on; ls('wms.pa.viewOnly', st.viewOnly ? '1' : '0');
        var c = document.getElementById('pa-viewonly'); if (c && c.checked !== st.viewOnly) c.checked = st.viewOnly;
        document.querySelectorAll('.pa-popview input').forEach(function (x) { if (x.checked !== st.viewOnly) x.checked = st.viewOnly; });
        sendMode(); paintStatus(); st.frames.forEach(paintPills);
        if (!st.viewOnly && st.frames.some(function (f) { return f.picker; })) host({ action: 'aiAudit', source: 'WMS_PICKER_APP', actionKey: 'picker_app_live', outcome: 'OK', instance: curInstance(), refId: 'PICKERS:' + st.frames.filter(function (f) { return f.picker; }).map(function (f) { return f.picker.username || f.picker.name; }).join(','), target: st.frames.length + ' app(s)', detail: 'View only switched OFF by ' + user() + ' with picker apps open' }, 15000).catch(function () {});
    }
    function paintStatus() {
        var el = document.getElementById('pa-status'); if (!el) return;
        var ready = st.frames.filter(function (f) { return f.ready; }).length;
        var tn = document.getElementById('pa-side-n'); if (tn) tn.textContent = st.frames.length ? st.frames.length + ' open' + (st.viewOnly ? '' : ' · LIVE') : '';
        el.innerHTML = '<span class="pa-pill' + (st.frames.length ? ' ok' : '') + '">' + st.frames.length + ' app' + (st.frames.length === 1 ? '' : 's') + ' open' + (st.frames.length ? ' · ' + ready + ' connected' : '') + '</span>' +
            (hosted() ? '<span class="pa-pill ok">relay on</span>' : '<span class="pa-pill bad">no desktop host — Oracle calls will fail</span>') +
            (st.viewOnly ? '<span class="pa-pill warn"><i class="fas fa-eye"></i> view only</span>' : '<span class="pa-pill bad"><i class="fas fa-bolt"></i> live</span>');
        var b = document.getElementById('pa-build'), bf = st.frames.filter(function (f) { return f.build; })[0]; if (b) b.textContent = bf ? (bf.build.app || 'FCPos') + ' ' + (bf.build.version || '') + (bf.build.commit ? ' · ' + bf.build.commit : '') : '';
    }
    function paintPills(f) {
        var el = document.getElementById('pa-pills-' + f.id); if (!el) return;
        if (f.pop) {   // the popup header is narrow: one dot for the connection, the header turns red while changes are live
            var dev = document.getElementById('pa-dev-' + f.id); if (dev) dev.classList.toggle('live', !st.viewOnly);
            el.innerHTML = '<span class="pa-dot' + (f.ready ? ' ok' : f.loaded ? ' warn' : '') + '" title="' + (f.ready ? 'connected' : f.loaded ? 'no bridge' : 'loading…') + '"></span>' + (st.viewOnly ? '' : '<span class="pa-pill bad" title="View only is off: what is done in the app changes data">live</span>');
            return;
        }
        el.innerHTML = (f.ready ? '<span class="pa-pill ok">connected</span>' : f.loaded ? '<span class="pa-pill warn">no bridge</span>' : '<span class="pa-pill">loading…</span>') + (f.picker ? (st.viewOnly ? '<span class="pa-pill warn">view only</span>' : '<span class="pa-pill bad">live</span>') : ''); }
    function paintPickers() {
        var el = document.getElementById('pa-plist'), n = document.getElementById('pa-pickers-n'), src = document.getElementById('pa-src'); if (!el) return;
        var list = visiblePickers(), openBy = {}; st.frames.forEach(function (f) { if (f.picker) openBy[f.picker.username] = f.id; });
        if (n) n.textContent = st.pickersBusy ? 'reading…' : st.pickers ? list.length + ' picker' + (list.length === 1 ? '' : 's') : '';
        if (st.pickersBusy && !st.pickers) el.innerHTML = '<li class="pa-empty"><i class="fas fa-spinner fa-spin"></i> reading the users…</li>';
        else if (st.pickersErr && !(st.pickers || []).length) el.innerHTML = '<li class="pa-empty">Could not read the pickers: ' + esc(st.pickersErr) + '</li>';
        else if (!list.length) el.innerHTML = '<li class="pa-empty">' + (st.pickers && st.pickers.length ? 'No picker matches.' : 'No pickers found — add them on the WMS Pickers page.') + '</li>';
        else el.innerHTML = list.slice(0, 200).map(function (p) {
            var fid = openBy[p.username];
            var bits = [p.pickerType, p.area || p.category, p.warehouse].filter(Boolean).map(esc);
            var who = p.login ? esc(p.username) : '<span class="pa-nolog" title="No mobile users table — the app opens with the picker name only">no app login</span>';
            return '<li class="pa-p' + (fid ? ' open' : '') + (p.active ? '' : ' off') + '" data-u="' + esc(p.username) + '" title="' + esc(p.name) + (p.wms ? ' · WMS picker' : ' · app login only') + (p.login ? ' · login ' + esc(p.username) : '') + '"><span class="pa-av sm" style="background:' + colour(p.name) + '">' + esc(initials(p.name)) + '</span><span class="pa-who"><b>' + esc(p.name) + (p.wms || !p.login ? '' : ' <i class="fas fa-mobile-alt" style="color:#94a3b8;font-size:10px" title="App login of type PICKER — not in the WMS pickers list"></i>') + '</b><small>' + who + (bits.length ? ' · ' + bits.join(' · ') : '') + (p.active ? '' : ' · inactive') + '</small></span>' +
                '<button class="pa-btn sm' + (fid ? '' : ' primary') + '" data-open="' + esc(p.username) + '">' + (fid ? '<i class="fas fa-eye"></i> Show' : '<i class="fas fa-mobile-alt"></i> Open') + '</button></li>';
        }).join('');
        el.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { var u = b.getAttribute('data-open'), p = (st.pickers || []).filter(function (x) { return x.username === u; })[0]; if (p) open(p); }; });
        if (src) src.textContent = st.pickers && st.pickers.length ? st.pickersSrc + '. Opening a picker signs the app in as them without a password; what they do here is recorded under their name.' + (st.pickersErr ? ' Could not read: ' + st.pickersErr : '') : '';
    }
    function paintLog() {
        var el = document.getElementById('pa-log'), n = document.getElementById('pa-calls-n'); if (!el) return;
        if (n) n.textContent = st.calls ? st.calls + ' call' + (st.calls === 1 ? '' : 's') : '';
        el.innerHTML = st.log.length ? st.log.map(function (l) { return '<li' + (l.blocked ? ' class="blocked"' : '') + ' title="' + esc(l.who) + ' · ' + esc(l.path) + (l.note ? ' · ' + esc(l.note) : '') + '"><span class="w" style="background:' + colour(l.who) + '">' + esc(initials(l.who)) + '</span><span class="m">' + esc(l.method) + '</span><span class="s' + (l.ok ? '' : ' bad') + '">' + esc(l.status) + '</span><span>' + esc(l.path) + '</span><span class="t">' + (l.blocked ? 'blocked' : l.ms + ' ms') + '</span></li>'; }).join('') : '<li class="pa-empty">Nothing yet — no app has called Oracle.</li>';
    }
    function paintBlocked() {
        var el = document.getElementById('pa-blocked'), n = document.getElementById('pa-blocked-n'); if (!el) return;
        if (n) n.textContent = st.blocked.length ? st.blocked.length : '';
        el.innerHTML = st.blocked.length ? st.blocked.map(function (b) { return '<li class="blocked" title="' + esc(b.who) + ' · ' + esc(b.path) + '"><span class="w" style="background:' + colour(b.who) + '">' + esc(initials(b.who)) + '</span><span class="m">' + esc(b.method) + '</span><span>' + esc(b.path) + '</span><span class="t">' + esc(b.at) + '</span></li>'; }).join('') : '<li class="pa-empty">Nothing blocked. Turn View only off to let the apps change data.</li>';
    }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[Picker app]', m); }
    window.addEventListener('resize', function () { if (st.drawn) sizeFrames(); });

    var PA = window.WmsPickerApp = {
        onShow: function () { if (!st.drawn) draw(); else sizeFrames(); },
        setSide: setSide,
        open: function () { return open(null); },
        openPicker: function (username) { var p = (st.pickers || []).filter(function (x) { return x.username === username || x.name === username; })[0]; return p ? open(p) : null; },
        popup: popup, dockPopup: dockBack, closePopup: function () { st.frames.filter(function (f) { return f.pop; }).forEach(function (f) { close(f.id); }); },
        close: close, reload: reloadAll, setViewOnly: setViewOnly, loadPickers: function () { return loadPickers(true); },
        state: function () { return { drawn: st.drawn, viewOnly: st.viewOnly, size: st.size, landscape: st.landscape, calls: st.calls, log: st.log.slice(), blocked: st.blocked.slice(), src: SRC, zoom: st.zoom, side: st.side, pickers: st.pickers, pickersSrc: st.pickersSrc, pickersErr: st.pickersErr,
            pop: st.pop, frames: st.frames.map(function (f) { return { id: f.id, pop: !!f.pop, label: f.label, picker: f.picker ? f.picker.username : null, plain: !!(f.picker && f.picker.plain), instance: f.instance, ready: f.ready, loaded: f.loaded, calls: f.calls, build: f.build }; }) }; }
    };
    function hook() {
        var orig = window.navigateToPage;
        if (typeof orig !== 'function' || orig.__pa) return false;
        var w = function (pageId) { var r = orig.apply(this, arguments); if (pageId === PAGE) PA.onShow(); return r; };
        w.__pa = true; window.navigateToPage = w;
        return true;
    }
    if (!hook()) document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 0); });
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () { var r = root(); if (r && r.style.display !== 'none' && (location.hash === '#' + PAGE || new URLSearchParams(location.search).get('page') === PAGE)) PA.onShow(); }, 400);
    });
})();
