using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Teach Me (teachme/index.html) - "teach*" IPC actions, reply teachResponse; live events teachEvent.
    ///   teachList / teachSave / teachRuns / teachRunSave   lessons and runs in the local DuckDB file (TeachStore); the page
    ///                                                      keeps the same rows in APEX (WMS_TEACH_LESSONS / _RUNS)
    ///   teachOpen        the Teach Me browser window on an https address (one window, the app's browser profile, so a
    ///                    sign-in is remembered; https only)
    ///   teachRecord      on / off: every click and typed value on the pages of that window comes back as a step
    ///                    (teachEvent kind step); sign-in pages and password fields are never recorded
    ///   teachRun         replays the steps the page sends (variables already filled in): waits for the person to sign
    ///                    in, finds each element again, fills / clicks it; pause / upload steps and failed steps wait for
    ///                    Continue; a step marked "stop" (the Submit button) is never pressed - the run stops there for the
    ///                    person to check and submit, then watches the page for the capture rule (e.g. the SR number)
    ///   teachContinue / teachStop
    ///   engine           native (the Teach Me window) or playwright / playwright-headless (TeachPlaywright: installed Edge,
    ///                    own profile, screenshots + trace per run; teachRunFolder opens them)
    ///   teachPadRun      engine "Power Automate Desktop": starts a desktop flow the person built in PAD through its URL
    ///                    launcher (ms-powerautomate:/console/flow/run?…), the lesson's variables as the flow's input
    ///                    arguments. PAD runs it on its own (Windows asks to confirm the first time); nothing comes back
    ///                    to the app, so the person types the result in.
    ///   teachAiBuild     "Ask AI" lesson: Claude writes a whole navigation lesson (notes, variables, steps, the ✋ Save step)
    ///                    from a name (e.g. "Create a business unit"), the Fusion instance address and a source the person
    ///                    pastes (Oracle documentation, their own steps) or an https address the host reads; it may answer
    ///                    with questions first. The steps are a draft from documentation, not recorded - the first run checks them.
    ///   teachAiFill      Claude fills the lesson's variables from the person's notes (kill switch, audited TEACHME)
    /// </summary>
    public partial class Form1
    {
        private static bool IsTeachAction(string action) =>
            action != null && action.StartsWith("teach", StringComparison.Ordinal) && action.Length > 5 && char.IsUpper(action[5]);

        private System.Windows.Forms.Form _tmForm;
        private WebView2 _tmWv, _tmPage;
        private string _tmRecScript;
        private bool _tmRecording;
        private CancellationTokenSource _tmRunCts;
        private TaskCompletionSource<bool> _tmContinue;
        private TaskCompletionSource<bool> _tmNav;
        private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _tmWait = new();

        private async Task HandleTeachAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            string user = PStr(root, "appUser");
            if (string.IsNullOrWhiteSpace(user) || user == "UNKNOWN") user = Environment.UserName;
            try
            {
                switch (action)
                {
                    case "teachList": data = await Task.Run(() => TeachStore.List()); break;
                    case "teachSave":
                        data = root.TryGetProperty("lesson", out var l) && l.ValueKind == JsonValueKind.Object
                            ? await Task.Run(() => TeachStore.Save(l, user)) : new { ok = false, error = "No lesson." };
                        break;
                    case "teachRuns": data = await Task.Run(() => TeachStore.Runs(PStr(root, "lessonId"))); break;
                    case "teachRunSave":
                        data = root.TryGetProperty("run", out var r) && r.ValueKind == JsonValueKind.Object
                            ? await Task.Run(() => TeachStore.SaveRun(r, user)) : new { ok = false, error = "No run." };
                        break;
                    case "teachOpen":
                        _tmPage = wv;
                        await TeachWindowAsync(PStr(root, "url"));
                        data = new { ok = true };
                        break;
                    case "teachRecord":
                        _tmPage = wv;
                        data = await TeachRecordAsync(PBool(root, "on"));
                        break;
                    case "teachRun":
                        {
                            _tmPage = wv;
                            if (_tmRunCts != null) { data = new { ok = false, error = "A lesson is already running - Stop it first." }; break; }
                            var steps = root.TryGetProperty("steps", out var st) && st.ValueKind == JsonValueKind.Array ? st.EnumerateArray().Select(x => x.Clone()).ToList() : new List<JsonElement>();
                            string url = PStr(root, "url"), capture = PStr(root, "capture"), runId = PStr(root, "runId") ?? Guid.NewGuid().ToString("N");
                            if (!TeachUrlOk(url)) { data = new { ok = false, error = "The lesson needs a start address that begins with https://" }; break; }
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "TEACHME", Action = "teach_run", Detail = (PStr(root, "title") ?? "") + " · " + steps.Count + " steps · " + (PStr(root, "engine") ?? "native") + " · " + url });
                            _tmRunCts = new CancellationTokenSource();
                            var ct = _tmRunCts.Token;
                            string engine = PStr(root, "engine") ?? "native";
                            if (engine != "native" && engine != "playwright" && engine != "playwright-headless") engine = "native";
                            _ = TeachRunAsync(runId, url, steps, capture, engine, ct);
                            data = new { ok = true, runId };
                            break;
                        }
                    case "teachPadRun": data = TeachPadRun(root, user); break;
                    case "teachPadOpen": data = TeachPadOpen(); break;
                    case "teachContinue": _tmContinue?.TrySetResult(true); data = new { ok = true }; break;
                    case "teachStop":
                        _tmRunCts?.Cancel();
                        _tmContinue?.TrySetResult(false);
                        data = new { ok = true };
                        break;
                    case "teachStatus":
                        data = new { ok = true, window = _tmForm != null && !_tmForm.IsDisposed, recording = _tmRecording, running = _tmRunCts != null, url = TeachUrl(), db = TeachStore.DbPath };
                        break;
                    case "teachAiFill": data = await TeachAiFillAsync(root, user); break;
                    case "teachAiBuild": data = await TeachAiBuildAsync(root, user); break;
                    case "teachRunFolder":
                        {
                            string rid = PStr(root, "runId") ?? "";
                            string dir = System.IO.Path.Combine(TeachPlaywright.Root, "runs", rid);
                            if (!System.Text.RegularExpressions.Regex.IsMatch(rid, "^[A-Za-z0-9_-]{4,60}$") || !System.IO.Directory.Exists(dir)) { data = new { ok = false, error = "No screenshots for this run." }; break; }
                            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
                            data = new { ok = true };
                            break;
                        }
                    default: data = new { ok = false, error = "Unknown action " + action }; break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[TeachMe] " + action + ": " + ex);
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "teachResponse", requestId, data }));
        }

        /// <summary>Opens the Power Automate Desktop console (to create the flow): the installed PAD.Console.Host.exe, else its URL scheme.</summary>
        private static object TeachPadOpen()
        {
            foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) })
            {
                if (string.IsNullOrEmpty(root)) continue;
                string exe = System.IO.Path.Combine(root, "Power Automate Desktop", "PAD.Console.Host.exe");
                if (System.IO.File.Exists(exe)) { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true }); return new { ok = true, how = "exe" }; }
            }
            try { Process.Start(new ProcessStartInfo("ms-powerautomate:/console") { UseShellExecute = true }); return new { ok = true, how = "url" }; }
            catch (System.ComponentModel.Win32Exception)
            {
                return new { ok = false, error = "Power Automate Desktop is not installed. Install Power Automate (free, Microsoft Store), sign in once, then try again." };
            }
        }

        /// <summary>Starts a Power Automate Desktop flow by URL with the lesson's values as input arguments.</summary>
        private object TeachPadRun(JsonElement root, string user)
        {
            string flowId = (PStr(root, "flowId") ?? "").Trim(), envId = (PStr(root, "envId") ?? "").Trim(), flowName = (PStr(root, "flowName") ?? "").Trim();
            if (flowId.Length > 0 && !Guid.TryParse(flowId, out _)) return new { ok = false, error = "The flow id must look like 1a2b3c4d-…  (Power Automate Desktop › flow › Properties › Details, \"Run URL\")." };
            if (envId.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(envId, "^[A-Za-z0-9-]{1,80}$")) return new { ok = false, error = "The environment id has characters it cannot have." };
            if (flowId.Length == 0 && (flowName.Length == 0 || flowName.Length > 200)) return new { ok = false, error = "Give the flow's name (as in Power Automate Desktop) or its id." };
            var inputs = new Dictionary<string, string>();
            if (root.TryGetProperty("inputs", out var inp) && inp.ValueKind == JsonValueKind.Object)
                foreach (var p in inp.EnumerateObject())
                {
                    if (inputs.Count >= 50) break;
                    if (!System.Text.RegularExpressions.Regex.IsMatch(p.Name, "^[A-Za-z_][A-Za-z0-9_]{0,60}$")) continue;   // PAD variable names
                    string v = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString();
                    inputs[p.Name] = v.Length > 8000 ? v.Substring(0, 8000) : v;
                }
            var url = new StringBuilder("ms-powerautomate:/console/flow/run?");
            if (flowId.Length > 0) { if (envId.Length > 0) url.Append("environmentid=").Append(envId).Append('&'); url.Append("workflowid=").Append(flowId); }
            else url.Append("workflowName=").Append(Uri.EscapeDataString(flowName));
            url.Append("&source=Other");
            if (inputs.Count > 0) url.Append("&inputArguments=").Append(Uri.EscapeDataString(JsonSerializer.Serialize(inputs)));
            if (url.Length > 30000) return new { ok = false, error = "The values are too long to hand to Power Automate Desktop (URL limit) - shorten the long texts." };
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "TEACHME", Action = "teach_pad_run", Detail = (PStr(root, "title") ?? "") + " · flow " + (flowId.Length > 0 ? flowId : flowName) + " · " + inputs.Count + " input(s)" });
            try { Process.Start(new ProcessStartInfo(url.ToString()) { UseShellExecute = true }); }
            catch (System.ComponentModel.Win32Exception)
            {
                return new { ok = false, error = "Windows has no Power Automate Desktop to hand the flow to. Install Power Automate (free with Windows 10/11, Microsoft Store), sign in once, then try again." };
            }
            // the URL with the values left out - for the log
            string shown = url.ToString(); int ia = shown.IndexOf("&inputArguments=", StringComparison.Ordinal);
            if (ia > 0) shown = shown.Substring(0, ia) + "&inputArguments=(" + inputs.Count + " values)";
            return new { ok = true, url = shown, inputs = inputs.Keys };
        }

        private static bool TeachUrlOk(string url) =>
            Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps;

        private string TeachUrl() { try { return _tmWv?.CoreWebView2?.Source; } catch { return null; } }

        private void TeachEvent(object e)
        {
            var page = _tmPage;
            if (page == null || page.IsDisposed) return;
            try { PostWebViewMessage(page, JsonSerializer.Serialize(new { action = "teachEvent", data = e })); } catch { }
        }

        /// <summary>Opens (or reuses) the Teach Me browser window and goes to url (https only; null = stay).</summary>
        private async Task TeachWindowAsync(string url)
        {
            if (url != null && !TeachUrlOk(url)) throw new InvalidOperationException("Only https:// addresses can be opened.");
            if (_tmForm == null || _tmForm.IsDisposed)
            {
                var f = new System.Windows.Forms.Form
                {
                    Text = "Teach Me - browser", Width = 1300, Height = 880, StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen, Icon = this.Icon
                };
                var w = new WebView2 { Dock = System.Windows.Forms.DockStyle.Fill };
                f.Controls.Add(w);
                f.FormClosed += (s, a) =>
                {
                    _tmForm = null; _tmWv = null; _tmRecording = false; _tmRecScript = null;
                    _tmRunCts?.Cancel(); _tmContinue?.TrySetResult(false); _tmNav?.TrySetResult(true);
                    TeachEvent(new { kind = "closed" });
                };
                _tmForm = f; _tmWv = w;
                f.Show();
                await w.EnsureCoreWebView2Async(await GetSharedEnvironmentAsync());
                await w.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(TeachAgentScript.JS);
                w.CoreWebView2.WebMessageReceived += TeachMessage;
                w.CoreWebView2.NavigationStarting += (s, e) =>
                {
                    if (!(e.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)))
                    { e.Cancel = true; TeachEvent(new { kind = "blocked", url = e.Uri }); return; }
                    _tmNav = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                };
                w.CoreWebView2.NavigationCompleted += async (s, e) =>
                {
                    _tmNav?.TrySetResult(true);
                    try { if (_tmRecording) await w.CoreWebView2.ExecuteScriptAsync("window.__tm && __tm.setRec(true)"); } catch { }
                    TeachEvent(new { kind = "nav", url = w.CoreWebView2.Source, title = w.CoreWebView2.DocumentTitle, ok = e.IsSuccess });
                };
                w.CoreWebView2.DocumentTitleChanged += (s, e) => { try { f.Text = "Teach Me - " + w.CoreWebView2.DocumentTitle; } catch { } };
                // a link that opens a new window opens here instead, so the recording and the replay stay in one window
                w.CoreWebView2.NewWindowRequested += (s, e) =>
                {
                    e.Handled = true;
                    if (TeachUrlOk(e.Uri)) w.CoreWebView2.Navigate(e.Uri);
                };
            }
            else _tmForm.Activate();
            if (url != null) _tmWv.CoreWebView2.Navigate(url);
        }

        private void TeachMessage(object sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                var m = doc.RootElement;
                string kind = m.TryGetProperty("kind", out var k) ? k.GetString() : null;
                if (kind == "tmRec" && _tmRecording && m.TryGetProperty("step", out var step))
                    TeachEvent(new { kind = "step", step = step.Clone(), url = TeachUrl() });
                else if (kind == "tmResult" && m.TryGetProperty("token", out var tk) && _tmWait.TryRemove(tk.GetString() ?? "", out var w))
                    w.TrySetResult(m.Clone());
            }
            catch (Exception ex) { Debug.WriteLine("[TeachMe] message: " + ex.Message); }
        }

        private async Task<object> TeachRecordAsync(bool on)
        {
            if (on && (_tmForm == null || _tmForm.IsDisposed)) return new { ok = false, error = "Open the lesson's start page first (Open browser)." };
            if (_tmWv == null) { _tmRecording = false; return new { ok = true, recording = false }; }
            var core = _tmWv.CoreWebView2;
            if (on && !_tmRecording)
            {
                _tmRecScript = await core.AddScriptToExecuteOnDocumentCreatedAsync("window.__tmRecOn = true;");
                _tmRecording = true;
                await core.ExecuteScriptAsync("window.__tm && __tm.setRec(true)");
                _tmForm.Activate();
            }
            else if (!on && _tmRecording)
            {
                if (_tmRecScript != null) core.RemoveScriptToExecuteOnDocumentCreated(_tmRecScript);
                _tmRecScript = null; _tmRecording = false;
                await core.ExecuteScriptAsync("window.__tm && __tm.setRec(false)");
            }
            return new { ok = true, recording = _tmRecording, url = TeachUrl() };
        }

        // ── replay ─────────────────────────────────────────────────
        private Task<T> OnUi<T>(Func<Task<T>> f) => (Task<T>)Invoke(f);

        private async Task<string> TeachEvalAsync(string js) =>
            await OnUi(async () => _tmWv?.CoreWebView2 == null ? null : await _tmWv.CoreWebView2.ExecuteScriptAsync(js));

        private async Task TeachWaitNavAsync(CancellationToken ct, int ms = 60000)
        {
            var nav = _tmNav;
            if (nav != null && !nav.Task.IsCompleted) await Task.WhenAny(nav.Task, Task.Delay(ms, ct));
        }

        private async Task<bool> TeachAgentReadyAsync(CancellationToken ct)
        {
            for (int i = 0; i < 60; i++)
            {
                ct.ThrowIfCancellationRequested();
                if ((await TeachEvalAsync("typeof window.__tm === 'object'")) == "true") return true;
                await Task.Delay(250, ct);
            }
            return false;
        }

        private async Task<JsonElement?> TeachCallAsync(string fn, object arg, int timeoutMs, CancellationToken ct)
        {
            string token = Guid.NewGuid().ToString("N");
            var w = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            _tmWait[token] = w;
            try
            {
                await TeachEvalAsync("window.__tm && __tm." + fn + "(" + JsonSerializer.Serialize(arg) + ", " + JsonSerializer.Serialize(token) + ")");
                var done = await Task.WhenAny(w.Task, Task.Delay(timeoutMs, ct));
                return done == w.Task ? w.Task.Result : (JsonElement?)null;
            }
            finally { _tmWait.TryRemove(token, out _); }
        }

        private async Task<bool> TeachWaitContinueAsync(CancellationToken ct)
        {
            _tmContinue = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using (ct.Register(() => _tmContinue?.TrySetResult(false)))
                return await _tmContinue.Task;
        }

        private static string TS(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        /// <summary>The native engine: the Teach Me window (WebView2) and the injected agent script.</summary>
        private sealed class TeachNativeDriver : ITeachDriver
        {
            private readonly Form1 f;
            public TeachNativeDriver(Form1 form) { f = form; }
            public string Name => "Native (Teach Me window)";
            public string Folder => null;
            public bool Headless => false;
            public async Task OpenAsync(string url, CancellationToken ct)
            {
                await f.OnUi(async () => { await f.TeachWindowAsync(url); return true; });
                await Task.Delay(800, ct);
                await f.TeachWaitNavAsync(ct);
            }
            public async Task<bool> SignInPageAsync() { await f.TeachWaitNavAsync(CancellationToken.None); return (await f.TeachEvalAsync("!!(window.__tm && __tm.signIn())")) == "true"; }
            public async Task<TeachStepResult> RunStepAsync(JsonElement s, int timeoutMs, CancellationToken ct)
            {
                await f.TeachWaitNavAsync(ct);
                if (!await f.TeachAgentReadyAsync(ct)) return new TeachStepResult { Ok = false, Error = "The page did not load." };
                var res = await f.TeachCallAsync("run", s, timeoutMs + 3000, ct);
                if (!res.HasValue) return new TeachStepResult { Ok = false, Error = "No answer from the page" };
                var r = res.Value;
                return new TeachStepResult
                {
                    Ok = r.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True,
                    Error = TS(r, "error"),
                    SignIn = r.TryGetProperty("signIn", out var si) && si.ValueKind == JsonValueKind.True
                };
            }
            public async Task<string> ScanAsync(string regex)
            {
                await f.TeachWaitNavAsync(CancellationToken.None);
                var hit = await f.TeachCallAsync("scan", regex, 2500, CancellationToken.None);
                return hit.HasValue ? TS(hit.Value, "value") : null;
            }
            public async Task AfterStepAsync(int index, string op, CancellationToken ct)
            {
                await Task.Delay(op == "click" || op == "key" ? 700 : 250, ct);
                await f.TeachWaitNavAsync(ct);
            }
            public Task CloseAsync(bool keepOpen) => Task.CompletedTask;
        }

        private async Task TeachRunAsync(string runId, string url, List<JsonElement> steps, string capture, string engine, CancellationToken ct)
        {
            string final = "error", message = null, captured = null;
            int n = steps.Count;
            ITeachDriver d = engine == "playwright" ? new TeachPlaywright(runId, false)
                           : engine == "playwright-headless" ? new TeachPlaywright(runId, true)
                           : new TeachNativeDriver(this);
            bool keepOpen = false;
            try
            {
                TeachEvent(new { kind = "run", runId, state = "start", n, engine = d.Name, message = "Opening " + url + " with " + d.Name });
                await d.OpenAsync(url, ct);

                async Task<bool> SignedIn()
                {
                    bool told = false;
                    var until = DateTime.UtcNow.AddMinutes(10);
                    while (DateTime.UtcNow < until)
                    {
                        ct.ThrowIfCancellationRequested();
                        if (!await d.SignInPageAsync()) return true;
                        if (d.Headless) throw new InvalidOperationException("The site asks to sign in, and a headless run cannot show the sign-in. Run the lesson once with \"Playwright (visible)\" and sign in there - the sign-in is kept for later headless runs.");
                        if (!told) { TeachEvent(new { kind = "run", runId, state = "login", message = "Sign in in the " + (d is TeachPlaywright ? "Edge" : "Teach Me") + " window - the lesson carries on by itself after the sign-in." }); told = true; }
                        await Task.Delay(2000, ct);
                    }
                    return false;
                }

                if (!await SignedIn()) throw new TimeoutException("No sign-in after 10 minutes.");
                bool stoppedForPerson = false;
                for (int i = 0; i < n; i++)
                {
                    ct.ThrowIfCancellationRequested();
                    var s = steps[i];
                    string op = TS(s, "op") ?? "click", what = TS(s, "what") ?? op;
                    bool stopHere = s.TryGetProperty("stop", out var sp) && sp.ValueKind == JsonValueKind.True;
                    bool optional = s.TryGetProperty("optional", out var opt) && opt.ValueKind == JsonValueKind.True;
                    if (stopHere)
                    {
                        TeachEvent(new { kind = "run", runId, i, n, state = "ready", message = d.Headless
                            ? "Filled in up to \"" + what + "\" - a headless run stops here and nobody can press it. Run it visible to submit."
                            : "Everything is filled in. Check the page, then press \"" + what + "\" yourself - Teach Me never submits." });
                        stoppedForPerson = true;
                        keepOpen = !d.Headless;
                        break;
                    }
                    if (op == "pause" || op == "upload")
                    {
                        if (d.Headless) throw new InvalidOperationException("Step " + (i + 1) + " needs a person (" + (op == "upload" ? "attach a file" : TS(s, "note") ?? "pause") + ") - run this lesson visible.");
                        TeachEvent(new { kind = "run", runId, i, n, state = "pause", message = TS(s, "note") ?? (op == "upload" ? "Attach the file(s) in the browser window, then press Continue." : "Do this step yourself, then press Continue.") });
                        if (!await TeachWaitContinueAsync(ct)) throw new OperationCanceledException();
                        continue;
                    }
                    TeachEvent(new { kind = "run", runId, i, n, state = "step", message = what });
                    int timeout = s.TryGetProperty("timeout", out var to) && to.TryGetInt32(out var tt) ? Math.Clamp(tt, 1000, 120000) : 20000;
                    var res = await d.RunStepAsync(s, timeout, ct);
                    if (!res.Ok && res.SignIn)
                    {
                        if (!await SignedIn()) throw new TimeoutException("No sign-in after 10 minutes.");
                        res = await d.RunStepAsync(s, timeout, ct);
                    }
                    if (!res.Ok)
                    {
                        if (optional) { TeachEvent(new { kind = "run", runId, i, n, state = "skip", message = "Skipped (optional): " + res.Error }); continue; }
                        if (d.Headless) throw new InvalidOperationException("Step " + (i + 1) + " (" + what + "): " + res.Error);
                        TeachEvent(new { kind = "run", runId, i, n, state = "help", message = "Step " + (i + 1) + " (" + what + "): " + res.Error + ". Do it by hand in the browser window, then press Continue." });
                        if (!await TeachWaitContinueAsync(ct)) throw new OperationCanceledException();
                        continue;
                    }
                    TeachEvent(new { kind = "run", runId, i, n, state = "done", message = what });
                    await d.AfterStepAsync(i, op, ct);
                }
                final = stoppedForPerson ? "ready" : "finished";
                if (!string.IsNullOrWhiteSpace(capture) && !(stoppedForPerson && d.Headless))
                {
                    TeachEvent(new { kind = "run", runId, state = "watch", message = "Watching the page for the result (" + capture + ") …" });
                    var until = DateTime.UtcNow.AddMinutes(stoppedForPerson ? 30 : 1);
                    while (DateTime.UtcNow < until && captured == null)
                    {
                        ct.ThrowIfCancellationRequested();
                        string v;
                        try { v = await d.ScanAsync(capture); }
                        catch (InvalidOperationException) when (stoppedForPerson) { message = "The browser window was closed before the result appeared."; keepOpen = false; break; }
                        if (!string.IsNullOrEmpty(v)) captured = v;
                        else await Task.Delay(2500, ct);
                    }
                    if (captured != null) { final = "captured"; keepOpen = false; }
                }
            }
            catch (OperationCanceledException) { final = "stopped"; message = "Stopped."; keepOpen = false; }
            catch (Exception ex) { final = "error"; message = ex.Message; keepOpen = false; Debug.WriteLine("[TeachMe] run: " + ex); }
            finally
            {
                try { await d.CloseAsync(keepOpen); } catch { }
                _tmRunCts = null; _tmContinue = null;
                TeachEvent(new { kind = "run", runId, state = "end", final, message, captured, engine = d.Name, folder = d.Folder != null && System.IO.Directory.Exists(d.Folder) ? runId : null });
            }
        }

        // ── AI ─────────────────────────────────────────────────────
        private static readonly System.Net.Http.HttpClient TeachHttp = new() { Timeout = TimeSpan.FromSeconds(30) };

        /// <summary>Reads an https page for an "Ask AI" source: text only, ≤ 2 MB read, ≤ 60,000 characters kept.</summary>
        private static async Task<string> TeachReadSourceAsync(string url)
        {
            if (!TeachUrlOk(url)) throw new InvalidOperationException("The source address must begin with https://");
            using var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GraysWMS-TeachMe");
            using var resp = await TeachHttp.SendAsync(req, System.Net.Http.HttpCompletionOption.ResponseHeadersRead);
            if (!resp.IsSuccessStatusCode) throw new InvalidOperationException("The source address answered " + (int)resp.StatusCode + " " + resp.ReasonPhrase + ". Copy the page's text and paste it instead.");
            var type = resp.Content.Headers.ContentType?.MediaType ?? "";
            if (type.Length > 0 && !type.StartsWith("text/", StringComparison.OrdinalIgnoreCase) && !type.Contains("html") && !type.Contains("json") && !type.Contains("xml"))
                throw new InvalidOperationException("The source address is a " + type + " file - open it and paste its text instead.");
            await using var st = await resp.Content.ReadAsStreamAsync();
            var buf = new byte[2 * 1024 * 1024]; int n = 0, r;
            while (n < buf.Length && (r = await st.ReadAsync(buf.AsMemory(n, buf.Length - n))) > 0) n += r;
            string html = Encoding.UTF8.GetString(buf, 0, n);
            string text = System.Text.RegularExpressions.Regex.Replace(html, "<(script|style|noscript|svg)[^>]*>[\\s\\S]*?</\\1>", " ", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            text = System.Text.RegularExpressions.Regex.Replace(text, "<(br|/p|/div|/li|/h[1-6]|/tr)[^>]*>", "\n", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            text = System.Text.RegularExpressions.Regex.Replace(text, "<[^>]+>", " ");
            text = System.Net.WebUtility.HtmlDecode(text);
            text = System.Text.RegularExpressions.Regex.Replace(text, "[ \\t]+", " ");
            text = System.Text.RegularExpressions.Regex.Replace(text, "\\s*\n\\s*(\\n\\s*)+", "\n\n").Trim();
            return text.Length > 60000 ? text.Substring(0, 60000) : text;
        }

        /// <summary>Claude writes a navigation lesson (notes, variables, steps) from a name, the instance and a source.</summary>
        private async Task<object> TeachAiBuildAsync(JsonElement root, string user)
        {
            string name = (PStr(root, "name") ?? "").Trim(), subject = (PStr(root, "subject") ?? "").Trim(), baseUrl = (PStr(root, "baseUrl") ?? "").Trim().TrimEnd('/');
            string instance = PStr(root, "instance") ?? "", source = PStr(root, "source") ?? "", sourceUrl = (PStr(root, "sourceUrl") ?? "").Trim(), extra = PStr(root, "extra") ?? "";
            if (name.Length == 0) return new { ok = false, error = "Give the script a name - what should it do (e.g. Create a business unit)?" };
            if (!TeachUrlOk(baseUrl)) return new { ok = false, error = "The Fusion address must begin with https://" };
            if (!await AiControl.IsEnabledAsync(user)) return new { ok = false, error = "The AI is paused (AI Digital Employee › Control)." };
            string key = WMSApp.FusionSql.FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key)) return new { ok = false, error = "No Claude API key saved (Fusion SQL › Ask AI › gear)." };
            string fetched = null;
            if (sourceUrl.Length > 0)
            {
                try { fetched = await TeachReadSourceAsync(sourceUrl); }
                catch (Exception ex) when (ex is InvalidOperationException || ex is System.Net.Http.HttpRequestException || ex is TaskCanceledException)
                { return new { ok = false, error = "Could not read the source address: " + ex.Message }; }
            }
            if (source.Length > 60000) source = source.Substring(0, 60000);
            var answers = new StringBuilder();
            if (root.TryGetProperty("answers", out var an) && an.ValueKind == JsonValueKind.Array)
                foreach (var a in an.EnumerateArray().Take(30))
                    answers.Append("- ").Append(PStr(a, "question")).Append(" → ").Append(PStr(a, "answer")).Append('\n');
            var msg = new StringBuilder();
            msg.Append("SCRIPT NAME: ").Append(name).Append('\n');
            msg.Append("SUBJECT: ").Append(subject.Length > 0 ? subject : "Oracle Fusion setups").Append('\n');
            msg.Append("INSTANCE: ").Append(instance).Append("  FUSION ADDRESS: ").Append(baseUrl).Append('\n');
            if (extra.Trim().Length > 0) msg.Append("\nWHAT THE PERSON ADDED:\n").Append(DllInspector.Redact(extra.Length > 8000 ? extra.Substring(0, 8000) : extra)).Append('\n');
            if (answers.Length > 0) msg.Append("\nANSWERS TO YOUR QUESTIONS:\n").Append(DllInspector.Redact(answers.ToString()));
            if (source.Trim().Length > 0) msg.Append("\nSOURCE (typed or pasted by the person):\n").Append(DllInspector.Redact(source)).Append('\n');
            if (fetched != null) msg.Append("\nSOURCE (read from ").Append(sourceUrl).Append("):\n").Append(DllInspector.Redact(fetched)).Append('\n');
            if (source.Trim().Length == 0 && fetched == null) msg.Append("\nNO SOURCE GIVEN - use your own knowledge of Oracle Fusion Cloud and say so in assumptions.\n");
            bool askFirst = PBool(root, "askFirst");
            msg.Append(askFirst && answers.Length == 0 ? "\nIf something you need is missing, ask (questions) and leave lesson null.\n" : "\nBuild the lesson now; put what you had to assume in assumptions.\n");

            string model = WMSApp.FusionSql.FusionSqlStore.LoadConfig().AiModel;
            if (string.IsNullOrWhiteSpace(model)) model = "claude-opus-5";
            var sw = Stopwatch.StartNew();
            var client = new AnthropicClient { ApiKey = key };
            var resp = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 16000,
                System = TEACH_BUILD_PROMPT,
                Messages = new List<MessageParam> { new MessageParam { Role = Role.User, Content = msg.ToString() } },
            });
            var answer = new StringBuilder();
            foreach (ContentBlock block in resp.Content)
                if (block.TryPickText(out TextBlock t)) answer.Append(t.Text);
            long tin = resp.Usage == null ? 0 : Convert.ToInt64(resp.Usage.InputTokens), tout = resp.Usage == null ? 0 : Convert.ToInt64(resp.Usage.OutputTokens);
            double? cost = null;
            try { cost = await AiControl.CostAsync(model, tin, tout, 0, 0, user); } catch { }
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "TEACHME", Action = "teach_ai_build", Outcome = "OK", Model = model, TokensIn = tin, TokensOut = tout, CostUsd = cost, DurationMs = sw.ElapsedMilliseconds, Detail = name + " · " + instance + " · source " + (source.Length + (fetched?.Length ?? 0)) + " chars" });
            string s = answer.ToString();
            int i0 = s.IndexOf('{'), i1 = s.LastIndexOf('}');
            if (i0 < 0 || i1 <= i0) return new { ok = false, error = resp.StopReason?.ToString() == "max_tokens" ? "Claude's answer was cut off - give a shorter source or split the script." : "Claude did not return a lesson." };
            try
            {
                using var doc = JsonDocument.Parse(s.Substring(i0, i1 - i0 + 1));
                return new { ok = true, result = doc.RootElement.Clone(), cost, sourceChars = source.Length + (fetched?.Length ?? 0), fetched = fetched != null };
            }
            catch (JsonException) { return new { ok = false, error = "Claude's answer was not valid JSON - try again." }; }
        }

        private const string TEACH_BUILD_PROMPT =
            "You write automation scripts (\"lessons\") that a browser assistant replays in Oracle Fusion Cloud Applications, mostly setup " +
            "tasks (business units, legal entities, inventory organizations, subinventories, payment terms, lookups, profile options …). " +
            "You get the script name, the instance and its Fusion address (BASE), and a source: Oracle documentation, the person's own " +
            "steps, or nothing. Answer with ONE JSON object only, no prose around it:\n" +
            "{\"questions\": [{\"name\": \"snake_case\", \"question\": \"…\", \"options\": \"a,b\" (optional)}],\n" +
            " \"lesson\": null | {\"title\": \"…\", \"subject\": \"Oracle Fusion setups › <area>\", \"tags\": \"comma, words\",\n" +
            "   \"notes\": \"Markdown: ## Purpose, ## Before you start (prerequisite setups, roles / privileges needed), ## Navigation " +
            "(the exact path, e.g. Setup and Maintenance › Search: Manage Business Unit), ## Fields (each field: what to enter, rules, " +
            "examples), ## After saving (how to check it worked, what to set up next), ## Source (where this came from)\",\n" +
            "   \"startUrl\": \"{{fusion_url}}/fscmUI/faces/FuseWelcome\",\n" +
            "   \"vars\": [{\"name\": \"snake_case\", \"label\": \"Label\", \"hint\": \"what to enter, format, example\", \"options\": \"a,b,c\" (only a fixed list), " +
            "\"def\": \"default\" (only when sensible), \"ai\": true, \"long\": false, \"required\": true}],\n" +
            "   \"steps\": [{\"op\": \"click|fill|select|check|key|pause\", \"t\": {\"tag\": \"input|textarea|select|button|a|span|div\", " +
            "\"label\": \"field label exactly as on screen\", \"text\": \"button / link text exactly as on screen\", \"role\": \"button|link|tab|menuitem|option|combobox\", " +
            "\"placeholder\": \"…\"}, \"value\": \"{{var}} or a fixed value\", \"optText\": \"{{var}}\" (select: the visible option), \"note\": \"why / what to look at\", " +
            "\"optional\": false, \"stop\": false, \"timeout\": 20000}],\n" +
            "   \"capture\": {\"regex\": \"\", \"label\": \"\"}},\n" +
            " \"assumptions\": [\"…\"], \"checks\": [\"what the person should verify in the first run\"]}\n" +
            "RULES:\n" +
            "- The first variable is always fusion_url (label \"Fusion instance\", def = BASE, options = the addresses the person gave if more than one); " +
            "the start address uses {{fusion_url}}. Never a variable or step for the user name or password - the person signs in by hand.\n" +
            "- Navigate like a person: from the home page open Setup and Maintenance (Navigator or Settings and Actions menu), open the " +
            "Tasks panel / Search, type the task name (e.g. Manage Business Unit), press Enter, click the task link; then Create (+ icon: " +
            "text \"Create\", role button), fill the fields, and the final \"Save and Close\" / \"Submit\" step has stop: true - the assistant " +
            "never presses it, the person checks and presses it. Use a pause step (op pause, note = instruction) where a choice needs a " +
            "person (e.g. picking a value in a search dialog when the LOV needs a search, uploading a file, choosing a scope set).\n" +
            "- Targets: use the visible label text exactly as Oracle Fusion shows it (label for inputs, text for buttons / links / tabs); " +
            "Fusion element ids change between sessions, so never rely on ids or CSS. A list-of-values field is a fill (type the value) " +
            "followed, when needed, by a click on the matching option (role option, text {{var}}). Dropdowns (choice lists) are select with optText.\n" +
            "- One variable per value the person must decide (name, code, legal entity, location, default set, manager, dates …); every " +
            "fill / select of such a value uses {{var}}. Mark ai: false for values the AI cannot know from a description (e.g. internal codes). " +
            "Required fields of the setup get required: true. Dates: hint the format the UI expects (e.g. m/d/yy).\n" +
            "- Ask questions (and lesson null) only when you cannot build a sensible script without the answer, e.g. which of several " +
            "setup tasks is meant, or a choice that changes the navigation; ask at most 5. Values the person types at run time are " +
            "variables, not questions.\n" +
            "- If the source is missing or thin, use your knowledge of Oracle Fusion Cloud (current Redwood / ADF pages) and list every " +
            "guess in assumptions. Steps are a draft: put in checks what to watch on the first run (e.g. a label that may differ).\n" +
            "- Never add steps that delete data, and never add more than one Save / Submit (one script = one record). Keep notes concise and practical.";

        private const string TEACH_FILL_PROMPT =
            "You fill in the variables of a lesson that a person taught a web assistant (for example how to raise an Oracle Support " +
            "Service Request). You get the lesson (subject, title, the teacher's notes) with its variables (name, label, hint, " +
            "allowed values) and the person's notes for this run (an error, an e-mail, a description). Write each value as the person " +
            "would type it into the form: clear, factual, professional; keep error messages, numbers, codes and names exactly as given; " +
            "never invent facts - when something is not known leave the value empty and list it in \"missing\". Respect the allowed " +
            "values. Never include passwords, keys or tokens. Answer with one JSON object only: " +
            "{\"values\": {\"<name>\": \"<value>\"}, \"missing\": [\"<label>\"], \"note\": \"<one line for the person>\"}";

        private async Task<object> TeachAiFillAsync(JsonElement root, string user)
        {
            string text = PStr(root, "text") ?? "";
            if (text.Trim().Length == 0) return new { ok = false, error = "Write or paste what happened first." };
            if (!await AiControl.IsEnabledAsync(user)) return new { ok = false, error = "The AI is paused (AI Digital Employee › Control)." };
            string key = WMSApp.FusionSql.FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key)) return new { ok = false, error = "No Claude API key saved (Fusion SQL › Ask AI › gear)." };
            string lesson = root.TryGetProperty("lesson", out var l) ? l.GetRawText() : "{}";
            if (lesson.Length > 40000) lesson = lesson.Substring(0, 40000);
            if (text.Length > 40000) text = text.Substring(0, 40000);
            text = DllInspector.Redact(text);
            string model = WMSApp.FusionSql.FusionSqlStore.LoadConfig().AiModel;
            if (string.IsNullOrWhiteSpace(model)) model = "claude-opus-5";
            var sw = Stopwatch.StartNew();
            var client = new AnthropicClient { ApiKey = key };
            var resp = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 6000,
                System = TEACH_FILL_PROMPT,
                Messages = new List<MessageParam> { new MessageParam { Role = Role.User, Content = "LESSON:\n" + lesson + "\n\nNOTES FOR THIS RUN:\n" + text } },
            });
            var answer = new StringBuilder();
            foreach (ContentBlock block in resp.Content)
                if (block.TryPickText(out TextBlock t)) answer.Append(t.Text);
            long tin = resp.Usage == null ? 0 : Convert.ToInt64(resp.Usage.InputTokens), tout = resp.Usage == null ? 0 : Convert.ToInt64(resp.Usage.OutputTokens);
            double? cost = null;
            try { cost = await AiControl.CostAsync(model, tin, tout, 0, 0, user); } catch { }
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "TEACHME", Action = "teach_ai_fill", Outcome = "OK", Model = model, TokensIn = tin, TokensOut = tout, CostUsd = cost, DurationMs = sw.ElapsedMilliseconds, Detail = text.Length + " chars" });
            string s = answer.ToString();
            int a = s.IndexOf('{'), b = s.LastIndexOf('}');
            if (a < 0 || b <= a) return new { ok = false, error = "Claude did not return the values." };
            try
            {
                using var doc = JsonDocument.Parse(s.Substring(a, b - a + 1));
                return new { ok = true, result = doc.RootElement.Clone(), cost };
            }
            catch (JsonException) { return new { ok = false, error = "Claude's answer was not valid JSON." }; }
        }
    }
}
