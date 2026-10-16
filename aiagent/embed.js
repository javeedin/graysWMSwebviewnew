/* AI Agent — embedded in another module's page (e.g. Debtors › Autopilot): ../aiagent/index.html?embed=1&module=debtors in
   an iframe. Loaded FIRST, before any script that talks to the host.
   - window.AG_EMBED = {module, toParent(msg)}; body gets the class "embed" (no header / Home, chat only).
   - The host bridge goes through the parent page: an iframe's own window.chrome.webview reaches the host through a
     CoreWebView2Frame the app does not listen to, so every postMessage here is handed to the parent ({__agRelay, msg}),
     which posts it to the host as its own, and every host message the parent receives comes back ({__agHost, data}).
     Approvals, the kill switch and the audit stay exactly as on the AI Agent page — the host sees the same messages.
   Changing the AI Agent page changes every module that embeds it. */
(function () {
    var q = new URLSearchParams(location.search), inFrame = window.parent && window.parent !== window;
    if (q.get('embed') !== '1' || !inFrame) return;
    var mod = String(q.get('module') || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
    var listeners = [];
    function toParent(m) { try { window.parent.postMessage(m, '*'); } catch (e) { } }
    window.chrome = window.chrome || {};
    window.chrome.webview = {
        postMessage: function (m) { toParent({ __agRelay: 1, msg: m }); },
        addEventListener: function (type, fn) { if (type === 'message') listeners.push(fn); },
        removeEventListener: function (type, fn) { listeners = listeners.filter(function (f) { return f !== fn; }); }
    };
    window.addEventListener('message', function (e) {
        if (e.source !== window.parent || !e.data) return;
        if (e.data.__agHost) listeners.slice().forEach(function (fn) { try { fn({ data: e.data.data }); } catch (err) { console.error(err); } });
        else if (e.data.__agAsk && window.AG && AG.ask) AG.ask(e.data.text, e.data.send !== false);        // the module puts a question in the box
    });
    window.AG_EMBED = { module: mod, toParent: toParent };
    document.documentElement.classList.add('embed');
    toParent({ __agReady: 1, module: mod });
})();
