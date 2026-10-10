// ============================================================
// AI Digital Employee — CONTROL tab + chat sync
// ============================================================
// Control tab (host actions in classes/Form1_AiControlHandlers.cs, tables in apex_sql/75_ai_control.sql):
//   • Status: kill switch. Anyone may PAUSE all AI actions (stopping is always safe); only AI admins resume.
//   • Inbox: approval requests that wait for a person (e.g. Shipping Agent line cancellations) — decide
//     from any PC; the requesting agent carries the decision out.
//   • Activity: WMS_AI_AUDIT — every action the AI did or was asked to do, who approved, the outcome.
//   • Usage & cost: tokens and cost per answer (API: from Anthropic's prices; CLI: its own reported cost).
//   • Settings (admins): admins, approvers, Teams / e-mail alert for new inbox requests, model prices.
// Chat sync: every chat is also saved to WMS_AI_CONVERSATIONS (per app user), so it follows the user to
// another PC. Result data (resultJson) is left out; the SQL / calls themselves are kept.
// ============================================================
(function () {
    'use strict';

    var CTL = { tab: 'inbox', days: 7, status: null, inboxView: 'PENDING', audit: { source: '', outcome: '', q: '' }, pending: 0 };
    function $(id) { return document.getElementById(id); }
    function e(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
    function user() { try { return appUserName(); } catch (x) { return 'UNKNOWN'; } }
    function money(v) { if (v == null || v === '' || isNaN(+v)) return '—'; v = +v; return v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2); }
    function kfmt(v) { v = +v || 0; return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v); }

    // ── bridge ───────────────────────────────────────────────
    function host(action, payload) {
        return new Promise(function (resolve, reject) {
            sendMessageToCSharp(Object.assign({ action: action }, payload || {}), function (err, r) {
                if (err) return reject(err);
                if (r && r.ok === false) return reject(r.error || 'failed');
                resolve(r || {});
            });
        });
    }
    function gw(path, payload) {
        return new Promise(function (resolve, reject) {
            sendMessageToCSharp({ action: 'executePost', fullUrl: AI_BASE + path, body: JSON.stringify(Object.assign({ appUser: user() }, payload)) }, function (err, data) {
                if (err) return reject(err);
                var d = data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { } }
                if (!d || d.success === false) return reject((d && d.error) || 'Database API error');
                resolve(d);
            });
        });
    }
    function rows(sql, max) {
        return gw('/executequery', { sql: sql, maxRows: max || 500 }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    }
    function write(sql) { return gw('/executewrite', { sql: sql }); }
    function clob(s) {
        s = String(s == null ? '' : s);
        if (!s) return 'EMPTY_CLOB()';
        var parts = [];
        for (var i = 0; i < s.length; i += 1000) parts.push('TO_CLOB(' + lit(s.slice(i, i + 1000)) + ')');
        return parts.join(' || ');
    }

    // ── styles ───────────────────────────────────────────────
    var css = document.createElement('style');
    css.textContent = [
        '.ctl{padding:14px 18px;overflow:auto;height:100%;box-sizing:border-box;background:#f8fafc}',
        '.ctl-status{display:flex;gap:16px;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 18px;margin-bottom:12px}',
        '.ctl-status.paused{border-color:#fecaca;background:linear-gradient(135deg,#fff1f2,#fff)}',
        '.ctl-dot{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:20px;color:#fff;background:#16a34a;flex-shrink:0}',
        '.ctl-status.paused .ctl-dot{background:#dc2626}',
        '.ctl-status h3{margin:0;font-size:16px}.ctl-status p{margin:2px 0 0;font-size:12px;color:#64748b}',
        '.ctl-roles{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}',
        '.ctl-chip{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}',
        '.ctl-chip.ok{background:#dcfce7;color:#15803d;border-color:#bbf7d0}.ctl-chip.warn{background:#fef3c7;color:#92400e;border-color:#fde68a}.ctl-chip.bad{background:#fee2e2;color:#b91c1c;border-color:#fecaca}',
        '.ctl-btn{border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;color:#334155}',
        '.ctl-btn:hover{background:#f8fafc}.ctl-btn.red{background:#dc2626;border-color:#dc2626;color:#fff}.ctl-btn.green{background:#16a34a;border-color:#16a34a;color:#fff}.ctl-btn.purple{background:#7c3aed;border-color:#7c3aed;color:#fff}',
        '.ctl-btn:disabled{opacity:.5;cursor:default}',
        '.ctl-tabs{display:flex;gap:4px;margin:4px 0 12px;border-bottom:1px solid #e2e8f0}',
        '.ctl-tab{border:0;background:none;padding:8px 14px;font-size:12.5px;font-weight:700;color:#64748b;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px}',
        '.ctl-tab.on{color:#7c3aed;border-bottom-color:#7c3aed}.ctl-tab b{background:#dc2626;color:#fff;border-radius:9px;padding:0 6px;font-size:10px;margin-left:4px}',
        '.ctl-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:10px}',
        '.ctl-inb{display:flex;gap:12px;align-items:flex-start}.ctl-inb .ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#fef3c7;color:#b45309;flex-shrink:0}',
        '.ctl-inb h4{margin:0 0 3px;font-size:13.5px}.ctl-inb .meta{font-size:11px;color:#64748b}.ctl-inb pre{white-space:pre-wrap;font-family:inherit;font-size:12px;color:#334155;background:#f8fafc;border-radius:8px;padding:8px 10px;margin:8px 0 0;max-height:180px;overflow:auto}',
        '.ctl-inb .act{display:flex;flex-direction:column;gap:6px;margin-left:auto}',
        '.ctl-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.ctl-bar select,.ctl-bar input{border:1px solid #e2e8f0;border-radius:8px;padding:6px 9px;font-size:12px;background:#fff}',
        '.ctl-tbl{width:100%;border-collapse:collapse;font-size:11.5px;background:#fff}.ctl-tbl th,.ctl-tbl td{border-bottom:1px solid #f1f5f9;padding:6px 8px;text-align:left;vertical-align:top}.ctl-tbl th{background:#f8fafc;color:#475569;position:sticky;top:0}',
        '.ctl-o{font-weight:800;font-size:10px;padding:1px 7px;border-radius:8px;background:#f1f5f9;color:#334155}',
        '.ctl-o.OK,.ctl-o.APPROVED,.ctl-o.DONE,.ctl-o.RESUMED{background:#dcfce7;color:#15803d}.ctl-o.FAILED,.ctl-o.DENIED,.ctl-o.BLOCKED,.ctl-o.REJECTED{background:#fee2e2;color:#b91c1c}',
        '.ctl-o.ASKED,.ctl-o.PENDING{background:#fef3c7;color:#92400e}.ctl-o.PAUSED{background:#ffe4e6;color:#be123c}',
        '.ctl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}.ctl-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}.ctl-kpi b{display:block;font-size:20px}.ctl-kpi span{font-size:11px;color:#64748b}',
        '.ctl-bars{display:flex;align-items:flex-end;gap:4px;height:90px;padding:6px 0}.ctl-bars div{flex:1;background:linear-gradient(180deg,#a78bfa,#7c3aed);border-radius:4px 4px 0 0;min-height:2px;position:relative}',
        '.ctl-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:1000px){.ctl-grid2{grid-template-columns:1fr}}',
        '.ctl-fld{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:10px}.ctl-fld input,.ctl-fld textarea{border:1px solid #e2e8f0;border-radius:8px;padding:7px 9px;font-size:12px;font-weight:400;font-family:inherit}',
        '.ctl-fld small{font-weight:400;color:#64748b}',
        '.usage-chip{display:inline-flex;gap:6px;align-items:center;font-size:10px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:1px 7px;margin-left:6px}'
    ].join('\n');
    document.head.appendChild(css);

    // ── mount the tab ────────────────────────────────────────
    function mount() {
        var tabs = document.querySelector('.main-tabs');
        if (!tabs || $('ptab-control')) return;
        var t = document.createElement('div');
        t.className = 'main-tab'; t.id = 'ptab-control';
        t.innerHTML = '<i class="fas fa-shield-halved"></i> Control <b id="ctl-badge" style="display:none;background:#dc2626;color:#fff;border-radius:9px;padding:0 6px;font-size:10px;margin-left:4px;"></b>';
        t.onclick = function () { switchPage('control'); };
        tabs.appendChild(t);
        var page = document.createElement('div');
        page.className = 'page'; page.id = 'page-control'; page.style.display = 'none';
        page.innerHTML = '<div class="ctl" id="ctl-root"><div style="color:#64748b;font-size:12px;">Loading…</div></div>';
        var ref = $('page-cando') || document.querySelector('.page:last-of-type');
        ref.parentNode.insertBefore(page, ref.nextSibling);
        // hook the page switcher
        var orig = window.switchPage;
        window.switchPage = function (which) {
            var ctl = which === 'control';
            $('ptab-control').classList.toggle('active', ctl);
            $('page-control').style.display = ctl ? '' : 'none';
            if (ctl) {
                document.querySelectorAll('.main-tabs .main-tab').forEach(function (x) { if (x.id !== 'ptab-control') x.classList.remove('active'); });
                document.querySelectorAll('.page').forEach(function (p) { if (p.id !== 'page-control') p.style.display = 'none'; });
                load();
                return;
            }
            $('ptab-control').classList.remove('active');
            $('page-control').style.display = 'none';
            orig(which);
        };
    }

    // ── load + render ────────────────────────────────────────
    function load() {
        return host('aiControlStatus', { fresh: true }).then(function (st) { CTL.status = st; render(); return refreshBadge(); })
            .catch(function (err) { $('ctl-root').innerHTML = '<div class="ctl-card" style="color:#b91c1c;">Could not read the AI control settings: ' + e(err) + '</div>'; });
    }
    function render() {
        var st = CTL.status || {};
        var paused = st.enabled === false;
        var roles = '<span class="ctl-chip">' + e(st.user || user()) + '</span>' +
            (st.isAdmin ? '<span class="ctl-chip ok" title="May resume the AI, edit policies and these settings">AI admin</span>' : '') +
            (st.isApprover ? '<span class="ctl-chip ok" title="May decide inbox requests">approver</span>' : '') +
            (st.settings && !st.settings.admins ? '<span class="ctl-chip warn" title="Nobody is set as AI admin yet, so everyone is. Set ADMINS in Settings.">no admins set</span>' : '');
        var h = '<div class="ctl-status' + (paused ? ' paused' : '') + '"><div class="ctl-dot"><i class="fas ' + (paused ? 'fa-pause' : 'fa-bolt') + '"></i></div>' +
            '<div><h3>' + (paused ? 'AI is PAUSED' : 'AI is running') + '</h3><p>' +
            (paused ? 'Nothing that changes or sends anything runs — chat answers, reads and reports still work. ' + (st.reason ? '<b>' + e(st.reason) + '</b> · ' : '') + (st.by ? 'by ' + e(st.by) + ' ' : '') + (st.at ? e(st.at) : '')
                : 'Chat actions, approvals, LOCAL jobs, the Shipping Agent and DB-scheduled jobs are allowed (within each user\'s policies).') + '</p></div>' +
            '<div class="ctl-roles">' + roles +
            (paused ? '<button class="ctl-btn green" data-ctl="resume"' + (st.isAdmin ? '' : ' disabled title="Only an AI admin can resume"') + '><i class="fas fa-play"></i> Resume AI</button>'
                    : '<button class="ctl-btn red" data-ctl="pause" title="Stops every AI action on every PC within a minute. Anyone may pause."><i class="fas fa-hand"></i> Pause all AI</button>') +
            '</div></div>';
        var tabs = [['inbox', 'fa-inbox', 'Inbox'], ['activity', 'fa-list-ul', 'Activity'], ['usage', 'fa-coins', 'Usage & cost'], ['settings', 'fa-sliders', 'Settings']];
        h += '<div class="ctl-tabs">' + tabs.map(function (t) {
            return '<button class="ctl-tab' + (CTL.tab === t[0] ? ' on' : '') + '" data-ctltab="' + t[0] + '"><i class="fas ' + t[1] + '"></i> ' + t[2] + (t[0] === 'inbox' && CTL.pending ? '<b>' + CTL.pending + '</b>' : '') + '</button>';
        }).join('') + '</div><div id="ctl-body"></div>';
        $('ctl-root').innerHTML = h;
        renderBody();
    }
    function renderBody() {
        var b = $('ctl-body'); if (!b) return;
        b.innerHTML = '<div style="color:#64748b;font-size:12px;padding:6px;"><i class="fas fa-circle-notch fa-spin"></i> Loading…</div>';
        ({ inbox: renderInbox, activity: renderActivity, usage: renderUsage, settings: renderSettings }[CTL.tab] || renderInbox)(b);
    }

    // Inbox
    function refreshBadge() {
        return rows("SELECT COUNT(*) AS n FROM wms_ai_inbox WHERE status = 'PENDING' AND (expires_date IS NULL OR expires_date >= SYSDATE)", 1).then(function (r) {
            CTL.pending = r.length ? +r[0].N : 0;
            var bd = $('ctl-badge'); if (bd) { bd.style.display = CTL.pending ? '' : 'none'; bd.textContent = CTL.pending; }
        }).catch(function () { });
    }
    function renderInbox(b) {
        var pending = CTL.inboxView === 'PENDING';
        var sql = "SELECT inbox_id, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created, source, requested_by, machine, action_key, instance, ref_id, title, summary, status, decided_by, " +
            "TO_CHAR(decided_date, 'YYYY-MM-DD HH24:MI') AS decided, decision_note, result_text, TO_CHAR(expires_date, 'YYYY-MM-DD HH24:MI') AS expires " +
            "FROM wms_ai_inbox WHERE " + (pending ? "status = 'PENDING' AND (expires_date IS NULL OR expires_date >= SYSDATE)" : "created_date >= SYSDATE - 14") + " ORDER BY inbox_id DESC FETCH FIRST 100 ROWS ONLY";
        rows(sql, 100).then(function (list) {
            var st = CTL.status || {};
            var h = '<div class="ctl-bar"><button class="ctl-btn' + (pending ? ' purple' : '') + '" data-inbv="PENDING">Waiting</button><button class="ctl-btn' + (pending ? '' : ' purple') + '" data-inbv="ALL">Last 14 days</button>' +
                '<span style="font-size:11px;color:#64748b;margin-left:6px;">' + (st.isApprover ? 'You can decide these requests.' : 'You are not an approver — ask an AI admin to add you in Settings.') + '</span>' +
                '<button class="ctl-btn" data-ctl="reload" style="margin-left:auto;"><i class="fas fa-rotate"></i></button></div>';
            if (!list.length) h += '<div class="ctl-card" style="text-align:center;color:#64748b;"><i class="fas fa-inbox" style="font-size:22px;color:#cbd5e1;"></i><p>' + (pending ? 'Nothing is waiting for a decision.' : 'No requests in the last 14 days.') + '</p></div>';
            list.forEach(function (r) {
                var open = r.STATUS === 'PENDING';
                h += '<div class="ctl-card ctl-inb"><div class="ic"><i class="fas ' + (r.ACTION_KEY === 'cancel_lines' ? 'fa-ban' : 'fa-hand') + '"></i></div><div style="flex:1;min-width:0;">' +
                    '<h4>#' + e(r.INBOX_ID) + ' · ' + e(r.TITLE) + ' <span class="ctl-o ' + e(r.STATUS) + '">' + e(r.STATUS) + '</span> ' +
                    '<span class="ctl-chip ' + (r.INSTANCE === 'TEST' ? '' : 'bad') + '">' + e(r.INSTANCE || 'PROD') + '</span></h4>' +
                    '<div class="meta">' + e(r.SOURCE) + ' · requested by ' + e(r.REQUESTED_BY) + (r.MACHINE ? ' on ' + e(r.MACHINE) : '') + ' · ' + e(r.CREATED) + (open && r.EXPIRES ? ' · expires ' + e(r.EXPIRES) : '') +
                    (r.DECIDED_BY ? ' · <b>' + e(r.STATUS === 'REJECTED' ? 'rejected' : 'approved') + ' by ' + e(r.DECIDED_BY) + '</b> ' + e(r.DECIDED || '') : '') + '</div>' +
                    (r.SUMMARY ? '<pre>' + e(r.SUMMARY) + '</pre>' : '') +
                    (r.DECISION_NOTE ? '<div class="meta" style="margin-top:4px;">Note: ' + e(r.DECISION_NOTE) + '</div>' : '') +
                    (r.RESULT_TEXT && r.RESULT_TEXT.indexOf('SELECTION:') !== 0 ? '<div class="meta" style="margin-top:4px;">Result: ' + e(r.RESULT_TEXT) + '</div>' : '') +
                    (r.STATUS === 'APPROVED' ? '<div class="meta" style="margin-top:4px;color:#b45309;">Approved — the requesting agent carries it out on its next run (' + e(r.MACHINE || 'its PC') + ').</div>' : '') +
                    '</div>' + (open ? '<div class="act"><button class="ctl-btn green" data-inb="approve" data-id="' + e(r.INBOX_ID) + '"' + (st.isApprover ? '' : ' disabled') + '><i class="fas fa-check"></i> Approve</button>' +
                        '<button class="ctl-btn" data-inb="reject" data-id="' + e(r.INBOX_ID) + '"' + (st.isApprover ? '' : ' disabled') + '><i class="fas fa-xmark"></i> Reject</button></div>' : '') + '</div>';
            });
            b.innerHTML = h;
        }).catch(function (err) { b.innerHTML = '<div class="ctl-card" style="color:#b91c1c;">' + e(err) + '</div>'; });
    }
    function decide(id, approve) {
        var note = prompt(approve ? 'Approve request #' + id + '? Optional note:' : 'Reject request #' + id + '? Reason (optional):', '');
        if (note === null) return;
        host('aiInboxDecide', { inboxId: +id, approve: approve, note: note }).then(function () { return refreshBadge(); }).then(function () { render(); })
            .catch(function (err) { alert(err); renderBody(); });
    }

    // Activity
    function renderActivity(b) {
        var A = CTL.audit, w = ['event_time >= SYSDATE - ' + (+CTL.days)];
        if (A.source) w.push('source = ' + lit(A.source));
        if (A.outcome) w.push('outcome = ' + lit(A.outcome));
        if (A.q) w.push("(UPPER(NVL(target, ' ') || ' ' || NVL(detail, ' ') || ' ' || NVL(app_user, ' ') || ' ' || NVL(action_key, ' ') || ' ' || NVL(ref_id, ' ')) LIKE " + lit('%' + A.q.toUpperCase() + '%') + ')');
        var sql = "SELECT audit_id, TO_CHAR(event_time, 'YYYY-MM-DD HH24:MI:SS') AS t, app_user, machine, source, action_key, outcome, approval, instance, ref_id, target, detail, model, tokens_in, tokens_out, cost_usd " +
            'FROM wms_ai_audit WHERE ' + w.join(' AND ') + ' ORDER BY audit_id DESC FETCH FIRST 300 ROWS ONLY';
        rows(sql, 300).then(function (list) {
            function sel(id, cur, opts) { return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
            var h = '<div class="ctl-bar">' + sel('ctl-days', String(CTL.days), [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']]) +
                sel('ctl-src', A.source, [['', 'All sources'], ['CHAT', 'Chat'], ['DECISION', 'Approval cards'], ['INBOX', 'Inbox'], ['SHIPPING_AGENT', 'Shipping Agent'], ['JOB', 'Jobs'], ['CONTROL', 'Control']]) +
                sel('ctl-out', A.outcome, [['', 'All outcomes'], ['OK', 'OK'], ['ASKED', 'Asked'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['DENIED', 'Denied'], ['BLOCKED', 'Blocked'], ['PAUSED', 'Paused'], ['FAILED', 'Failed']]) +
                '<input id="ctl-q" type="search" placeholder="Search user, order, path, text…" value="' + e(A.q) + '" style="min-width:240px;">' +
                '<span style="font-size:11px;color:#64748b;">' + list.length + (list.length === 300 ? '+ (newest 300)' : '') + ' event(s)</span></div>';
            h += '<div class="ctl-card" style="padding:0;overflow:auto;max-height:calc(100vh - 330px);"><table class="ctl-tbl"><thead><tr><th>Time</th><th>User</th><th>Source</th><th>Action</th><th>Outcome</th><th>Approval</th><th>Target / detail</th><th>Cost</th></tr></thead><tbody>' +
                (list.length ? list.map(function (r) {
                    return '<tr><td style="white-space:nowrap;">' + e(r.T) + '</td><td>' + e(r.APP_USER) + '<div style="color:#94a3b8;font-size:10px;">' + e(r.MACHINE || '') + '</div></td><td>' + e(r.SOURCE) + '</td>' +
                        '<td><b>' + e(r.ACTION_KEY) + '</b>' + (r.INSTANCE ? ' <span style="color:#94a3b8;">' + e(r.INSTANCE) + '</span>' : '') + '</td><td><span class="ctl-o ' + e(r.OUTCOME) + '">' + e(r.OUTCOME) + '</span></td>' +
                        '<td>' + e(r.APPROVAL || '') + '</td><td style="max-width:520px;word-break:break-word;">' + (r.TARGET ? '<code style="font-size:10.5px;">' + e(r.TARGET) + '</code><br>' : '') + e(r.DETAIL || '') +
                        (r.MODEL ? '<div style="color:#94a3b8;font-size:10px;">' + e(r.MODEL) + ' · ' + kfmt(r.TOKENS_IN) + ' in / ' + kfmt(r.TOKENS_OUT) + ' out</div>' : '') + '</td><td>' + (r.COST_USD != null ? money(r.COST_USD) : '') + '</td></tr>';
                }).join('') : '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:18px;">No events for these filters.</td></tr>') + '</tbody></table></div>';
            b.innerHTML = h;
            ['ctl-days', 'ctl-src', 'ctl-out'].forEach(function (id) { $(id).onchange = function () { CTL.days = +$('ctl-days').value; A.source = $('ctl-src').value; A.outcome = $('ctl-out').value; renderBody(); }; });
            var q = $('ctl-q'); q.onkeydown = function (ev) { if (ev.key === 'Enter') { A.q = q.value.trim(); renderBody(); } };
        }).catch(function (err) { b.innerHTML = '<div class="ctl-card" style="color:#b91c1c;">' + e(err) + '</div>'; });
    }

    // Usage & cost
    function renderUsage(b) {
        var d = +CTL.days || 7, where = "action_key = 'turn' AND event_time >= SYSDATE - " + d;
        Promise.all([
            rows('SELECT COUNT(*) AS n, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(cache_read) AS cr, SUM(cost_usd) AS cost, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS noprice FROM wms_ai_audit WHERE ' + where, 1),
            rows('SELECT app_user, COUNT(*) AS n, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(cost_usd) AS cost FROM wms_ai_audit WHERE ' + where + ' GROUP BY app_user ORDER BY SUM(NVL(cost_usd, 0)) DESC, COUNT(*) DESC', 100),
            rows("SELECT NVL(model, '(unknown)') AS model, COUNT(*) AS n, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(cost_usd) AS cost FROM wms_ai_audit WHERE " + where + ' GROUP BY NVL(model, \'(unknown)\') ORDER BY COUNT(*) DESC', 50),
            rows("SELECT TO_CHAR(TRUNC(event_time), 'YYYY-MM-DD') AS d, COUNT(*) AS n, SUM(cost_usd) AS cost FROM wms_ai_audit WHERE " + where + ' GROUP BY TRUNC(event_time) ORDER BY TRUNC(event_time)', 100)
        ]).then(function (res) {
            var t = res[0][0] || {};
            var h = '<div class="ctl-bar"><select id="ctl-days">' + [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']].map(function (o) { return '<option value="' + o[0] + '"' + (+o[0] === d ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
                '<span style="font-size:11px;color:#64748b;">Cost: API mode from Anthropic prices (editable in Settings), CLI mode as the Claude CLI reports it.</span></div>';
            h += '<div class="ctl-kpis"><div class="ctl-kpi"><b>' + (+t.N || 0) + '</b><span>AI answers</span></div><div class="ctl-kpi"><b>' + money(t.COST) + '</b><span>total cost</span></div>' +
                '<div class="ctl-kpi"><b>' + kfmt(t.TIN) + '</b><span>input tokens</span></div><div class="ctl-kpi"><b>' + kfmt(t.TOUT) + '</b><span>output tokens</span></div>' +
                '<div class="ctl-kpi"><b>' + kfmt(t.CR) + '</b><span>read from prompt cache</span></div>' +
                (+t.NOPRICE ? '<div class="ctl-kpi" title="Answers from a model with no known price — add it under Settings › Model prices"><b style="color:#b45309;">' + t.NOPRICE + '</b><span>answers without a price</span></div>' : '') + '</div>';
            var days = res[3], max = Math.max.apply(null, days.map(function (x) { return +x.COST || 0; }).concat([0.0001]));
            if (days.length > 1) h += '<div class="ctl-card"><b style="font-size:12px;">Cost per day</b><div class="ctl-bars">' + days.map(function (x) {
                return '<div title="' + e(x.D) + ': ' + x.N + ' answers, ' + money(x.COST) + '" style="height:' + Math.max(2, Math.round(84 * (+x.COST || 0) / max)) + 'px;"></div>';
            }).join('') + '</div></div>';
            function tbl(title, key, list) {
                return '<div class="ctl-card" style="padding:0;overflow:auto;"><table class="ctl-tbl"><thead><tr><th>' + title + '</th><th>Answers</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead><tbody>' +
                    (list.length ? list.map(function (r) { return '<tr><td><b>' + e(r[key]) + '</b></td><td>' + r.N + '</td><td>' + kfmt(r.TIN) + '</td><td>' + kfmt(r.TOUT) + '</td><td>' + money(r.COST) + '</td></tr>'; }).join('')
                        : '<tr><td colspan="5" style="color:#64748b;text-align:center;">No answers in this period.</td></tr>') + '</tbody></table></div>';
            }
            h += '<div class="ctl-grid2">' + tbl('User', 'APP_USER', res[1]) + tbl('Model', 'MODEL', res[2]) + '</div>';
            b.innerHTML = h;
            $('ctl-days').onchange = function () { CTL.days = +this.value; renderBody(); };
        }).catch(function (err) { b.innerHTML = '<div class="ctl-card" style="color:#b91c1c;">' + e(err) + '</div>'; });
    }

    // Settings
    function renderSettings(b) {
        var st = CTL.status || {}, s = st.settings || {}, ro = st.isAdmin ? '' : ' disabled';
        b.innerHTML = '<div class="ctl-card" style="max-width:820px;">' +
            (st.isAdmin ? '' : '<div class="ctl-chip warn" style="display:inline-block;margin-bottom:10px;">Only AI admins can change these settings.</div>') +
            '<label class="ctl-fld">AI admins <small>App logins, comma separated. They may resume the AI, edit policies and these settings. Empty = everyone (set this first).</small><input id="cs-admins" value="' + e(s.admins || '') + '"' + ro + ' placeholder="e.g. JAVEED, KHALID"></label>' +
            '<label class="ctl-fld">Approvers <small>May decide inbox requests (admins always can). Empty = everyone.</small><input id="cs-approvers" value="' + e(s.approvers || '') + '"' + ro + '></label>' +
            '<label class="ctl-fld">Teams alert for new requests <small>Incoming-webhook URL of the Teams channel that should hear about new approval requests.</small><input id="cs-teams" value="' + e(s.teamsWebhook || '') + '"' + ro + ' placeholder="https://…webhook.office.com/…"></label>' +
            '<label class="ctl-fld">E-mail alert for new requests <small>Addresses separated by ; — sent from the e-mail account saved in the AI Digital Employee (envelope button) on the PC that raises the request.</small><input id="cs-email" value="' + e(s.emailTo || '') + '"' + ro + '></label>' +
            '<label class="ctl-fld">Model prices (USD per 1M tokens) <small>JSON, only for models missing from the built-in list or to override it, e.g. {"claude-haiku-4-5":{"in":1,"out":5}}. Cache reads are charged at 10% and cache writes at 125% of the input price.</small><textarea id="cs-prices" rows="3"' + ro + '>' + e(s.modelPrices || '') + '</textarea></label>' +
            (st.isAdmin ? '<button class="ctl-btn purple" data-ctl="savesettings"><i class="fas fa-floppy-disk"></i> Save settings</button> <span id="cs-status" style="font-size:11.5px;margin-left:8px;"></span>' : '') + '</div>';
    }
    function saveSettings() {
        var p = { admins: $('cs-admins').value, approvers: $('cs-approvers').value, teamsWebhook: $('cs-teams').value, emailTo: $('cs-email').value, modelPrices: $('cs-prices').value };
        $('cs-status').textContent = 'Saving…';
        host('aiControlSettings', p).then(function () { $('cs-status').innerHTML = '<span style="color:#16a34a;">✓ Saved</span>'; return host('aiControlStatus', { fresh: true }); })
            .then(function (st) { CTL.status = st; })
            .catch(function (err) { $('cs-status').innerHTML = '<span style="color:#dc2626;">✗ ' + e(err) + '</span>'; });
    }

    // Pause / resume
    function setEnabled(on) {
        var reason = '';
        if (!on) { reason = prompt('Pause ALL AI actions on every PC? Give a short reason (shown to everyone):', ''); if (reason === null) return; }
        else if (!confirm('Resume the AI? Agents, jobs and chat actions start working again.')) return;
        host('aiControlSet', { enabled: on, reason: reason }).then(function () { return load(); }).catch(function (err) { alert(err); });
    }

    document.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-ctl],[data-ctltab],[data-inb],[data-inbv]'); if (!b || !$('page-control') || $('page-control').style.display === 'none') return;
        if (b.dataset.ctltab) { CTL.tab = b.dataset.ctltab; render(); return; }
        if (b.dataset.inbv) { CTL.inboxView = b.dataset.inbv; renderBody(); return; }
        if (b.dataset.inb) { decide(b.dataset.id, b.dataset.inb === 'approve'); return; }
        switch (b.dataset.ctl) {
            case 'pause': setEnabled(false); break;
            case 'resume': setEnabled(true); break;
            case 'reload': load(); break;
            case 'savesettings': saveSettings(); break;
        }
    });

    // Policies tab: only AI admins save (once ADMINS is set)
    function guardPolicies() {
        ['savePolicy', 'deletePolicy'].forEach(function (fn) {
            var orig = window[fn]; if (typeof orig !== 'function' || orig._guarded) return;
            window[fn] = function () {
                var args = arguments;
                host('aiControlStatus', {}).then(function (st) {
                    if (!st.isAdmin) { alert('Only an AI admin can change policies (AI Digital Employee › Control › Settings).'); return; }
                    orig.apply(null, args);
                }).catch(function () { orig.apply(null, args); });
            };
            window[fn]._guarded = true;
        });
    }

    // ── usage chip under each answer ─────────────────────────
    if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (x) { return; } }
        if (!r || r.action !== 'aiChatEvent' || r.eventType !== 'usage' || !r.usage) return;
        var u = r.usage, c = (typeof activeChat === 'function') && activeChat();
        var tip = (u.model || '') + ' · ' + kfmt(u.tokensIn) + ' in / ' + kfmt(u.tokensOut) + ' out' + (u.cacheRead ? ' · ' + kfmt(u.cacheRead) + ' cached' : '');
        var label = (u.costUsd != null ? money(u.costUsd) : kfmt((+u.tokensIn || 0) + (+u.tokensOut || 0)) + ' tok');
        if (c) {
            var last = c.messages.slice().reverse().find(function (m) { return m.role === 'assistant'; });
            if (last && !last.usage) { last.usage = u; try { saveChats(); } catch (x) { } }
        }
        var metas = document.querySelectorAll('#messages .msg.assistant .meta');
        var m = metas[metas.length - 1];
        if (m && !m.querySelector('.usage-chip')) m.insertAdjacentHTML('beforeend', '<span class="usage-chip" title="' + e(tip) + '"><i class="fas fa-coins"></i> ' + e(label) + '</span>');
    });

    // ── chat sync to APEX ────────────────────────────────────
    var SYNC_KEY = 'aiChatsSynced';
    var synced = {}; try { synced = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch (x) { synced = {}; }
    var syncTimer = null, remoteLoaded = false;
    function remoteId(c) { return (user() + ':' + c.id).slice(0, 60); }
    function slim(c) {
        // result data stays on the PC; the conversation, SQL and calls travel
        var msgs = (c.messages || []).map(function (m) {
            var x = Object.assign({}, m);
            if (x.rounds) x.rounds = x.rounds.map(function (r) { var y = Object.assign({}, r); delete y.resultJson; return y; });
            if (x.grid && typeof x.grid === 'object' && x.grid.rows && x.grid.rows.length > 200) x.grid = Object.assign({}, x.grid, { rows: x.grid.rows.slice(0, 200) });
            return x;
        });
        var json = JSON.stringify(msgs);
        while (json.length > 350000 && msgs.length > 2) { msgs.shift(); json = JSON.stringify(msgs); }
        return json;
    }
    function sig(c) { var last = (c.messages || [])[c.messages.length - 1]; return (c.messages || []).length + ':' + (last && (last.ts || '')) + ':' + (c.title || '') + ':' + (last && last.usage ? 1 : 0); }
    function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 2500); }
    function syncNow() {
        if (typeof chats === 'undefined') return;
        var todo = chats.filter(function (c) { return !c.remote && c.messages && c.messages.length && synced[c.id] !== sig(c); }).slice(0, 5);
        todo.reduce(function (p, c) {
            return p.then(function () {
                var s = sig(c), json = slim(c);
                return write('MERGE INTO wms_ai_conversations t USING (SELECT ' + lit(remoteId(c)) + ' id FROM dual) s ON (t.chat_id = s.id) ' +
                    'WHEN MATCHED THEN UPDATE SET title = ' + lit(String(c.title || '').slice(0, 400)) + ', message_count = ' + c.messages.length + ', messages_json = ' + clob(json) + ', updated_date = SYSDATE, deleted = \'N\' ' +
                    'WHEN NOT MATCHED THEN INSERT (chat_id, app_user, machine, title, message_count, messages_json) VALUES (s.id, ' + lit(user()) + ', NULL, ' + lit(String(c.title || '').slice(0, 400)) + ', ' + c.messages.length + ', ' + clob(json) + ')')
                    .then(function () { synced[c.id] = s; try { localStorage.setItem(SYNC_KEY, JSON.stringify(synced)); } catch (x) { } })
                    .catch(function (err) { console.warn('[ChatSync]', err); });
            });
        }, Promise.resolve());
    }
    function hookChats() {
        var origSave = window.saveChats;
        window.saveChats = function () { origSave.apply(null, arguments); scheduleSync(); };
        var origDel = window.deleteChat;
        window.deleteChat = function (id, ev) {
            var c = chats.find(function (x) { return x.id === id; });
            origDel.apply(null, arguments);
            if (c) write("UPDATE wms_ai_conversations SET deleted = 'Y', updated_date = SYSDATE WHERE chat_id = " + lit(c.remoteKey || remoteId(c))).catch(function () { });
        };
        var origOpen = window.openChat;
        window.openChat = function (id) {
            var c = chats.find(function (x) { return x.id === id; });
            if (c && c.remote && !c.loaded) {
                setStatus && setStatus('Loading the conversation from APEX…');
                return readRemote(c).then(function () { setStatus && setStatus(''); origOpen(id); })
                    .catch(function (err) { setStatus && setStatus(''); alert('Could not load this conversation: ' + err); });
            }
            return origOpen(id);
        };
    }
    function readRemote(c) {
        return rows('SELECT NVL(LENGTH(messages_json), 0) AS len FROM wms_ai_conversations WHERE chat_id = ' + lit(c.remoteKey), 1).then(function (r) {
            var len = r.length ? +r[0].LEN : 0, offs = [], out = '';
            for (var o = 1; o <= len; o += 9 * 1300) offs.push(o);    // 1300-char pieces stay under the 4000-byte TO_CHAR limit
            return offs.reduce(function (p, o) {
                return p.then(function () {
                    var cols = []; for (var i = 0; i < 9; i++) cols.push('TO_CHAR(SUBSTR(messages_json, ' + (o + i * 1300) + ', 1300)) AS p' + i);
                    return rows('SELECT ' + cols.join(', ') + ' FROM wms_ai_conversations WHERE chat_id = ' + lit(c.remoteKey), 1).then(function (x) {
                        if (x.length) for (var i = 0; i < 9; i++) out += x[0]['P' + i] || '';
                    });
                });
            }, Promise.resolve()).then(function () {
                c.messages = out ? JSON.parse(out) : [];
                c.loaded = true; c.remote = false;
                synced[c.id] = sig(c);
                try { localStorage.setItem(SYNC_KEY, JSON.stringify(synced)); } catch (x) { }
                saveChats();
            });
        });
    }
    function loadRemoteList() {
        if (remoteLoaded || typeof chats === 'undefined') return;
        remoteLoaded = true;
        rows("SELECT chat_id, title, message_count, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI:SS') AS created FROM wms_ai_conversations WHERE app_user = " + lit(user()) +
            " AND deleted = 'N' ORDER BY updated_date DESC FETCH FIRST 30 ROWS ONLY", 30).then(function (list) {
            var have = {}; chats.forEach(function (c) { have[remoteId(c)] = 1; });
            var added = 0;
            list.reverse().forEach(function (r) {
                if (have[r.CHAT_ID]) return;
                var localId = String(r.CHAT_ID).split(':').pop();
                if (chats.some(function (c) { return c.id === localId; })) return;
                chats.unshift({ id: localId, remoteKey: r.CHAT_ID, title: r.TITLE || 'Conversation', createdAt: Date.parse(String(r.CREATED).replace(' ', 'T')) || Date.now(), sessionId: null, messages: [], remote: true });
                added++;
            });
            if (added) { renderChatList(); console.log('[ChatSync] ' + added + ' conversation(s) from other PCs'); }
        }).catch(function (err) { remoteLoaded = false; console.warn('[ChatSync] list', err); });
    }

    // ── start ────────────────────────────────────────────────
    function start() {
        mount();
        guardPolicies();
        if (!(window.chrome && window.chrome.webview)) return;
        hookChats();
        // tables exist once the host has read the control settings
        host('aiControlStatus', {}).then(function (st) {
            CTL.status = st;
            refreshBadge();
            loadRemoteList();
            setTimeout(scheduleSync, 4000);
        }).catch(function () { });
        setInterval(function () { refreshBadge(); if ($('page-control') && $('page-control').style.display !== 'none' && CTL.tab === 'inbox') renderBody(); }, 60000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.AiControlPage = { load: load };
})();
