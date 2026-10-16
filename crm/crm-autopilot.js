/* Customer CRM · Autopilot tab — the AI Agent page itself (../aiagent/index.html?embed=1&module=crm) in a frame,
 * not a copy: whatever changes in the AI Agent appears here too. With module=crm it starts on the Customer Desk specialist
 * (its crm_* / dc_* tools read the same APEX records as these pages), lists only the conversations started here, and hides its header.
 *
 * Bridge relay: the frame cannot reach the host itself (its window.chrome.webview talks to a CoreWebView2Frame the app does
 * not listen to), so embed.js hands every host message to this page ({__agRelay, msg}) and this page posts it to the host
 * unchanged; every message the host sends to this page is passed back down ({__agHost, data}). The host therefore sees the
 * same actions as from the AI Agent page — approvals, policies, the kill switch and the audit are unchanged.
 * The agent can open things here ({__agModule, op: 'open', what: customer | ticket | tab}). CRM.autopilot.ask(text) puts a
 * question to it from anywhere in the module. */
(function () {
    'use strict';
    var DC = window.CRM;
    function $(id) { return document.getElementById(id); }
    var AP = DC.autopilot = { frame: null, ready: false, queue: [] };
    var SRC = '../aiagent/index.html?embed=1&module=crm';

    function mount() {
        var host = $('ap-host'); if (!host || AP.frame) return;
        host.innerHTML = '<div class="ap-bar"><i class="fas fa-robot"></i> <b>Autopilot</b> — the AI Agent with the Customer Desk. It reads customers, tickets, calls, balances and statements; ' +
            'sending e-mails and statements and changing tickets stay with you on the other tabs.<span class="sp" style="flex:1"></span><a href="../aiagent/index.html" title="The full AI Agent page (every specialist)"><i class="fas fa-up-right-from-square"></i> Open the AI Agent</a></div>';
        var f = document.createElement('iframe');
        f.src = SRC; f.title = 'Autopilot'; f.setAttribute('allow', 'camera *; microphone *; clipboard-read *; clipboard-write *');   // voice, dictation, camera and Copy work in the frame
        host.appendChild(f);
        AP.frame = f;
        // a release without the AI Agent module (or a page error) never says hello: say so instead of a blank frame
        setTimeout(function () {
            if (AP.ready) return;
            var n = document.createElement('div'); n.className = 'note warn'; n.style.margin = '12px';
            n.innerHTML = '<b>The Autopilot did not start.</b> It is the AI Agent page (folder <code>aiagent</code>) — this installation may not include it, or the AI Hub needs updating. Open <a href="../aiagent/index.html">the AI Agent</a> to see why.';
            host.insertBefore(n, f);
        }, 12000);
    }
    function toFrame(m) { if (AP.frame && AP.frame.contentWindow) AP.frame.contentWindow.postMessage(m, '*'); }

    // the frame → the host (and the frame's requests to this page)
    window.addEventListener('message', function (e) {
        if (!AP.frame || e.source !== AP.frame.contentWindow || !e.data) return;
        var d = e.data;
        if (d.__agRelay) { if (window.chrome && window.chrome.webview && window.chrome.webview !== undefined) window.chrome.webview.postMessage(d.msg); return; }
        if (d.__agReady) { AP.ready = true; AP.queue.splice(0).forEach(toFrame); return; }
        if (d.__agModule && d.op === 'open') {
            if (d.what === 'customer' && d.account) DC.open360(d.bu || '', String(d.account), d.name || '', d.sub || null);
            else if (d.what === 'ticket' && d.ticket_id) DC.openTicketById(d.ticket_id);
            else if (d.what === 'ticket' && d.ticket_no) { var t = DC.tickets.filter(function (x) { return String(x.TICKET_NO).replace(/\D/g, '').replace(/^0+/, '') === String(d.ticket_no).replace(/\D/g, '').replace(/^0+/, ''); })[0]; if (t) DC.openTicketById(t.TICKET_ID); }
            else if (d.what === 'tab' && d.tab) DC.go(d.tab === 'overview' ? 'today' : d.tab);
        }
    });
    // the host → the frame (every message: the frame keeps only the replies it is waiting for)
    if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener('message', function (ev) {
        if (AP.frame) toFrame({ __agHost: 1, data: ev.data });
    });

    DC.views = DC.views || {};
    DC.views.auto = function () { mount(); return ''; };
    /** ask the Autopilot from anywhere in the module: opens the tab and sends the question */
    AP.ask = function (text, send) {
        DC.go('auto');
        var m = { __agAsk: 1, text: text, send: send !== false };
        if (AP.ready) toFrame(m); else AP.queue.push(m);
    };
})();
