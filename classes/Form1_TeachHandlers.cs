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
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "TEACHME", Action = "teach_run", Detail = (PStr(root, "title") ?? "") + " · " + steps.Count + " steps · " + url });
                            _tmRunCts = new CancellationTokenSource();
                            var ct = _tmRunCts.Token;
                            _ = TeachRunAsync(runId, url, steps, capture, ct);
                            data = new { ok = true, runId };
                            break;
                        }
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

        private async Task<bool> TeachSignedInAsync(CancellationToken ct, string runId)
        {
            bool told = false;
            var until = DateTime.UtcNow.AddMinutes(10);
            while (DateTime.UtcNow < until)
            {
                ct.ThrowIfCancellationRequested();
                await TeachWaitNavAsync(ct);
                if ((await TeachEvalAsync("!!(window.__tm && __tm.signIn())")) != "true") return true;
                if (!told) { TeachEvent(new { kind = "run", runId, state = "login", message = "Sign in in the Teach Me window - the lesson carries on by itself after the sign-in." }); told = true; }
                await Task.Delay(2000, ct);
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

        private async Task TeachRunAsync(string runId, string url, List<JsonElement> steps, string capture, CancellationToken ct)
        {
            string final = "error", message = null, captured = null;
            int n = steps.Count;
            try
            {
                TeachEvent(new { kind = "run", runId, state = "start", n, message = "Opening " + url });
                await OnUi(async () => { await TeachWindowAsync(url); return true; });
                await Task.Delay(800, ct);
                await TeachWaitNavAsync(ct);
                if (!await TeachSignedInAsync(ct, runId)) throw new TimeoutException("No sign-in after 10 minutes.");
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
                        TeachEvent(new { kind = "run", runId, i, n, state = "ready", message = "Everything is filled in. Check the page, then press \"" + what + "\" yourself - Teach Me never submits." });
                        stoppedForPerson = true;
                        break;
                    }
                    if (op == "pause" || op == "upload")
                    {
                        TeachEvent(new { kind = "run", runId, i, n, state = "pause", message = TS(s, "note") ?? (op == "upload" ? "Attach the file(s) in the Teach Me window, then press Continue." : "Do this step yourself, then press Continue.") });
                        if (!await TeachWaitContinueAsync(ct)) throw new OperationCanceledException();
                        continue;
                    }
                    TeachEvent(new { kind = "run", runId, i, n, state = "step", message = what });
                    await TeachWaitNavAsync(ct);
                    if (!await TeachAgentReadyAsync(ct)) throw new InvalidOperationException("The page did not load.");
                    int timeout = s.TryGetProperty("timeout", out var to) && to.TryGetInt32(out var tt) ? Math.Clamp(tt, 1000, 120000) : 20000;
                    var res = await TeachCallAsync("run", s, timeout + 3000, ct);
                    bool ok = res.HasValue && res.Value.TryGetProperty("ok", out var okv) && okv.ValueKind == JsonValueKind.True;
                    if (!ok && res.HasValue && res.Value.TryGetProperty("signIn", out var si) && si.ValueKind == JsonValueKind.True)
                    {
                        if (!await TeachSignedInAsync(ct, runId)) throw new TimeoutException("No sign-in after 10 minutes.");
                        res = await TeachCallAsync("run", s, timeout + 3000, ct);
                        ok = res.HasValue && res.Value.TryGetProperty("ok", out okv) && okv.ValueKind == JsonValueKind.True;
                    }
                    if (!ok)
                    {
                        string err = res.HasValue ? TS(res.Value, "error") : "No answer from the page";
                        if (optional) { TeachEvent(new { kind = "run", runId, i, n, state = "skip", message = "Skipped (optional): " + err }); continue; }
                        TeachEvent(new { kind = "run", runId, i, n, state = "help", message = "Step " + (i + 1) + " (" + what + "): " + err + ". Do it by hand in the Teach Me window, then press Continue." });
                        if (!await TeachWaitContinueAsync(ct)) throw new OperationCanceledException();
                        continue;
                    }
                    TeachEvent(new { kind = "run", runId, i, n, state = "done", message = what });
                    await Task.Delay(op == "click" || op == "key" ? 700 : 250, ct);
                    await TeachWaitNavAsync(ct);
                }
                final = stoppedForPerson ? "ready" : "finished";
                if (!string.IsNullOrWhiteSpace(capture))
                {
                    TeachEvent(new { kind = "run", runId, state = "watch", message = "Watching the page for the result (" + capture + ") …" });
                    var until = DateTime.UtcNow.AddMinutes(30);
                    while (DateTime.UtcNow < until && captured == null)
                    {
                        ct.ThrowIfCancellationRequested();
                        await TeachWaitNavAsync(ct);
                        var hit = await TeachCallAsync("scan", capture, 2500, ct);
                        if (hit.HasValue && TS(hit.Value, "value") is string v && v.Length > 0) captured = v;
                        else await Task.Delay(2500, ct);
                    }
                    if (captured != null) final = "captured";
                }
            }
            catch (OperationCanceledException) { final = "stopped"; message = "Stopped."; }
            catch (Exception ex) { final = "error"; message = ex.Message; Debug.WriteLine("[TeachMe] run: " + ex); }
            finally
            {
                _tmRunCts = null; _tmContinue = null;
                TeachEvent(new { kind = "run", runId, state = "end", final, message, captured });
            }
        }

        // ── AI ─────────────────────────────────────────────────────
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
