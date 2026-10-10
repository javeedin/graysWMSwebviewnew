namespace WMSApp
{
    /// <summary>
    /// The script the Teach Me browser window injects into every page and frame it opens (AddScriptToExecuteOnDocumentCreated).
    /// Recording: clicks and typed values become steps with several ways to find the element again (id, name, label,
    /// placeholder, text, CSS path, frame). Nothing is recorded on a page that shows a password field (sign-in pages) and
    /// password / one-time-code fields are never read. Replay: run(step, token) finds the element (waiting up to the step's
    /// time-out), fills or clicks it like a person would (native value setter + input / change events) and answers
    /// { kind: 'tmResult', token, ok, error }. scan(regex, token) looks for a value on the page (e.g. the SR number).
    /// Frames: each frame runs its own copy; messages go up to the top frame (window.top.postMessage) and the top frame
    /// passes them to the host; commands go down to every frame and the frame whose path matches the step runs it.
    /// </summary>
    internal static class TeachAgentScript
    {
        public const string JS = """
(function () {
  if (window.__tm) return;
  var TOP = window === window.top;
  var tm = window.__tm = { rec: false, busy: {} };
  function send(msg) {
    if (TOP) { try { window.chrome.webview.postMessage(msg); } catch (e) { } }
    else { try { window.top.postMessage({ __tm: 1, up: msg }, '*'); } catch (e) { } }
  }
  function kids() { var a = []; try { for (var i = 0; i < window.frames.length; i++) a.push(window.frames[i]); } catch (e) { } return a; }
  function down(d) { kids().forEach(function (f) { try { f.postMessage({ __tm: 1, down: d }, '*'); } catch (e) { } }); }
  window.addEventListener('message', function (ev) {
    var d = ev.data; if (!d || d.__tm !== 1) return;
    if (d.up) { if (TOP) send(d.up); else { try { window.top.postMessage(d, '*'); } catch (e) { } } return; }
    if (d.down) { handle(d.down); down(d.down); }
  });
  function recOn() { return tm.rec || window.__tmRecOn === true; }
  tm.setRec = function (on) { tm.rec = !!on; window.__tmRecOn = !!on; down({ cmd: 'rec', on: !!on }); return true; };

  // ── describing an element ────────────────────────────────────
  function txt(el) { return ((el && (el.innerText || el.value || el.textContent)) || '').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function labelOf(el) {
    var l = '';
    try {
      if (el.id) { var lb = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (lb) l = txt(lb); }
      if (!l && el.getAttribute('aria-label')) l = el.getAttribute('aria-label');
      if (!l && el.getAttribute('aria-labelledby')) l = el.getAttribute('aria-labelledby').split(/\s+/).map(function (i) { var x = document.getElementById(i); return x ? txt(x) : ''; }).join(' ').trim();
      if (!l) { var p = el.closest('label'); if (p) l = txt(p); }
      if (!l && el.title) l = el.title;
    } catch (e) { }
    return String(l || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 8) {
      var p = el.parentElement; if (!p) break;
      var t = el.tagName.toLowerCase(), same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
      parts.unshift(same.length > 1 ? t + ':nth-of-type(' + (same.indexOf(el) + 1) + ')' : t);
      el = p;
    }
    return parts.length ? 'body>' + parts.join('>') : '';
  }
  function isField(el) { return /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable; }
  function describe(el) {
    return {
      tag: el.tagName.toLowerCase(), type: String(el.type || '').toLowerCase(), id: el.id || '', name: el.getAttribute('name') || '',
      label: labelOf(el), placeholder: el.getAttribute('placeholder') || '', role: el.getAttribute('role') || '',
      text: isField(el) ? '' : txt(el), css: cssPath(el), frame: TOP ? '' : location.pathname, page: location.pathname
    };
  }
  function secret(el) {
    var t = String(el.type || '').toLowerCase(), ac = String(el.getAttribute && el.getAttribute('autocomplete') || '').toLowerCase();
    return t === 'password' || /password|one-time-code/.test(ac) || /passw|(^|[_\-])(otp|pin)([_\-]|$)/i.test(el.name || '');
  }
  function signInPage() { try { return Array.prototype.some.call(document.querySelectorAll('input[type=password]'), function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); } catch (e) { return false; } }

  // ── recording ─────────────────────────────────────────────────
  var CLICKABLE = 'button,a,[role=button],[role=option],[role=menuitem],[role=tab],[role=link],[role=checkbox],[role=radio],[role=treeitem],' +
                  'input[type=checkbox],input[type=radio],input[type=submit],input[type=button],input[type=image],summary,label,li,[onclick]';
  function rec(step) { if (!recOn() || signInPage()) return; step.ts = Date.now(); send({ kind: 'tmRec', step: step }); }
  document.addEventListener('click', function (ev) {
    if (!recOn() || !ev.isTrusted) return;
    var el = ev.target && ev.target.closest ? ev.target.closest(CLICKABLE) : null;
    if (!el && ev.target && ev.target.nodeType === 1) { try { if (getComputedStyle(ev.target).cursor === 'pointer') el = ev.target; } catch (e) { } }   // plain text clicked: not a step
    if (!el || secret(el)) return;
    if (/^(input|textarea|select)$/i.test(el.tagName) && !/^(checkbox|radio|submit|button|image|file)$/.test(String(el.type || '').toLowerCase())) return;   // a click into a field: the value is recorded on change
    if (String(el.type || '').toLowerCase() === 'file') { rec({ op: 'upload', t: describe(el) }); return; }
    if (/^(checkbox|radio)$/.test(String(el.type || '').toLowerCase()) || /^(checkbox|radio)$/.test(el.getAttribute('role') || ''))
      { setTimeout(function () { rec({ op: 'check', t: describe(el), value: el.checked != null ? String(!!el.checked) : el.getAttribute('aria-checked') }); }, 0); return; }
    rec({ op: 'click', t: describe(el) });
  }, true);
  document.addEventListener('change', function (ev) {
    var el = ev.target; if (!recOn() || !el || secret(el)) return;
    var ty = String(el.type || '').toLowerCase();
    if (/^(checkbox|radio|file)$/.test(ty)) return;
    if (el.tagName === 'SELECT') { var o = el.options[el.selectedIndex]; rec({ op: 'select', t: describe(el), value: el.value, optText: o ? txt(o) : '' }); return; }
    if (/^(input|textarea)$/i.test(el.tagName)) rec({ op: 'fill', t: describe(el), value: el.value });
  }, true);
  document.addEventListener('blur', function (ev) {
    var el = ev.target; if (!recOn() || !el || !el.isContentEditable) return;
    rec({ op: 'fill', t: describe(el), value: el.innerText });
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (!recOn() || !ev.isTrusted || ev.key !== 'Enter') return;
    var el = ev.target; if (!el || secret(el) || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
    if (el.tagName === 'INPUT') { rec({ op: 'fill', t: describe(el), value: el.value }); rec({ op: 'key', key: 'Enter', t: describe(el) }); }
  }, true);

  // ── finding an element again ─────────────────────────────────
  function all(sel) { try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } }
  function vis(el) { try { var r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } }
  function smallest(list) { return list.sort(function (a, b) { return txt(a).length - txt(b).length || a.querySelectorAll('*').length - b.querySelectorAll('*').length; }); }
  function find(t) {
    var tries = [];
    if (t.id) tries.push(function () { return all('#' + CSS.escape(t.id)); });
    if (t.name) tries.push(function () { return all(t.tag + '[name="' + CSS.escape(t.name) + '"]'); });
    if (t.label) tries.push(function () { var want = t.label.toLowerCase(); return all(t.tag + (t.role ? ',[role="' + t.role + '"]' : '')).filter(function (e) { return labelOf(e).toLowerCase() === want; }); });
    if (t.placeholder) tries.push(function () { return all(t.tag + '[placeholder="' + CSS.escape(t.placeholder) + '"]'); });
    if (t.text) tries.push(function () { return smallest(all(t.tag + (t.role ? ',[role="' + t.role + '"]' : '')).filter(function (e) { return txt(e) === t.text; })); });
    if (t.text) tries.push(function () { return smallest(all(CLICKABLE + ',span,div,td').filter(function (e) { return txt(e) === t.text; })); });
    if (t.css) tries.push(function () { return all(t.css); });
    for (var i = 0; i < tries.length; i++) { var v = tries[i]().filter(vis); if (v.length) return v[0]; }
    return null;
  }

  // ── doing a step ──────────────────────────────────────────────
  function fire(el, type) { try { el.dispatchEvent(new (type.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, view: window })); } catch (e) { } }
  function click(el) { try { el.scrollIntoView({ block: 'center' }); } catch (e) { } ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (k) { fire(el, k); }); el.click(); }
  function setVal(el, v) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { }
    el.focus();
    if (el.isContentEditable) { try { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, v); } catch (e) { el.innerText = v; } }
    else {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function doStep(s, el) {
    if (s.op === 'click') { click(el); return ''; }
    if (s.op === 'fill') { if (secret(el)) throw 'That is a password field - Teach Me never types passwords.'; setVal(el, s.value == null ? '' : String(s.value)); try { el.blur(); } catch (e) { } return ''; }
    if (s.op === 'select') {
      if (el.tagName === 'SELECT') {
        var want = String(s.optText || '').toLowerCase(), opt = Array.prototype.filter.call(el.options, function (o) { return want && txt(o).toLowerCase() === want; })[0] ||
          Array.prototype.filter.call(el.options, function (o) { return o.value === String(s.value); })[0];
        if (!opt) throw 'Option "' + (s.optText || s.value) + '" is not in the list';
        setVal(el, opt.value); return '';
      }
      click(el); return '';
    }
    if (s.op === 'check') { var on = String(s.value) === 'true'; var now = el.checked != null ? !!el.checked : el.getAttribute('aria-checked') === 'true'; if (on !== now) click(el); return ''; }
    if (s.op === 'key') { ['keydown', 'keypress', 'keyup'].forEach(function (k) { el.dispatchEvent(new KeyboardEvent(k, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); }); var f = el.form; if (f && f.requestSubmit) { try { f.requestSubmit(); } catch (e) { } } return ''; }
    throw 'Unknown step ' + s.op;
  }
  function handle(d) {
    if (d.cmd === 'rec') { tm.rec = !!d.on; return; }
    if (d.cmd === 'run') runHere(d.step, d.token);
    if (d.cmd === 'scan') scanHere(d.regex, d.token);
  }
  function runHere(s, token) {
    var mine = (s.t && s.t.frame || '') === (TOP ? '' : location.pathname);
    if (!mine) return;
    var until = Date.now() + (s.timeout || 20000);
    (function tick() {
      var el = null; try { el = find(s.t || {}); } catch (e) { }
      if (el) {
        try { doStep(s, el); send({ kind: 'tmResult', token: token, ok: true, how: (el.id ? '#' + el.id : txt(el).slice(0, 40)) }); }
        catch (e) { send({ kind: 'tmResult', token: token, ok: false, error: String(e && e.message || e) }); }
        return;
      }
      if (Date.now() > until) { send({ kind: 'tmResult', token: token, ok: false, notFound: true, signIn: signInPage(), error: 'Could not find ' + JSON.stringify(s.t && (s.t.label || s.t.text || s.t.placeholder || s.t.name || s.t.id || s.t.css)) }); return; }
      setTimeout(tick, 250);
    })();
  }
  function scanHere(regex, token) {
    try { var m = new RegExp(regex).exec(document.body ? document.body.innerText : ''); if (m) send({ kind: 'tmResult', token: token, ok: true, value: m[1] || m[0] }); } catch (e) { }
  }
  tm.run = function (step, token) { runHere(step, token); down({ cmd: 'run', step: step, token: token }); return true; };
  tm.scan = function (regex, token) { scanHere(regex, token); down({ cmd: 'scan', regex: regex, token: token }); return true; };
  tm.signIn = signInPage;
})();
""";
    }
}
