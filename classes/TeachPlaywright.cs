using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Playwright;

namespace WMSApp
{
    /// <summary>What a Teach Me run needs from a browser: the native Teach Me window (WebView2 + TeachAgentScript) or Playwright.</summary>
    internal interface ITeachDriver
    {
        string Name { get; }
        string Folder { get; }                                  // screenshots / trace of this run (null = none)
        bool Headless { get; }
        Task OpenAsync(string url, CancellationToken ct);
        Task<bool> SignInPageAsync();
        Task<TeachStepResult> RunStepAsync(JsonElement step, int timeoutMs, CancellationToken ct);
        Task<string> ScanAsync(string regex);
        Task AfterStepAsync(int index, string op, CancellationToken ct);
        Task CloseAsync(bool keepOpen);
    }

    internal sealed class TeachStepResult { public bool Ok; public string Error; public bool SignIn; }

    /// <summary>
    /// Teach Me's Playwright engine (NuGet Microsoft.Playwright): runs a lesson in the PC's installed Microsoft Edge (channel
    /// msedge - no browser download), visible or headless, with its own persistent profile (%LOCALAPPDATA%\GraysWMS\TeachMe\
    /// pw-profile) so a sign-in made once in the visible window is reused. Elements are found with Playwright locators
    /// (label → role + name → placeholder → id → name → text → CSS path) inside the frame the step was recorded in; actions
    /// auto-wait. Every step leaves a screenshot and the run a trace.zip (open it with "playwright show-trace") in
    /// %LOCALAPPDATA%\GraysWMS\TeachMe\runs\{runId}. Password fields are never typed.
    /// </summary>
    internal sealed class TeachPlaywright : ITeachDriver
    {
        public static string Root => Environment.GetEnvironmentVariable("TEACHME_PW_ROOT") is string r && r.Length > 0 ? r : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GraysWMS", "TeachMe");
        public string Name => Headless ? "Playwright (Edge, headless)" : "Playwright (Edge)";
        public string Folder { get; }
        public bool Headless { get; }
        private IPlaywright _pw;
        private IBrowserContext _ctx;
        private volatile bool _closed;            // the person closed the Edge window (or Edge died)
        /// <summary>The run's page, or null once the window is gone.</summary>
        private IPage PageOrNull
        {
            get { try { return _ctx == null || _closed ? null : _ctx.Pages.LastOrDefault(p => !p.IsClosed); } catch { return null; } }
        }
        /// <summary>The run's page; a clear error (not a null reference) when the Edge window was closed.</summary>
        private IPage Page => PageOrNull ?? throw new InvalidOperationException("The Edge window of this run was closed, so the run cannot go on. Run the lesson again (and leave the window open until it finishes).");

        public TeachPlaywright(string runId, bool headless)
        {
            Headless = headless;
            Folder = Path.Combine(Root, "runs", runId);
        }

        private static TeachPlaywright _last;     // a visible run's window stays open for the person; the next run closes it (one profile)

        public async Task OpenAsync(string url, CancellationToken ct)
        {
            var prev = _last; _last = this;
            if (prev != null) await prev.CloseAsync(false);
            Directory.CreateDirectory(Folder);
            // the app is published as one file: Playwright looks for its driver (.playwright) next to the exe
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PLAYWRIGHT_DRIVER_SEARCH_PATH")))
                Environment.SetEnvironmentVariable("PLAYWRIGHT_DRIVER_SEARCH_PATH", AppContext.BaseDirectory);
            try { _pw = await Playwright.CreateAsync(); }
            catch (Exception ex)
            {
                throw new InvalidOperationException("Playwright's driver did not start (" + ex.Message.Split('\n')[0] + "). The app folder must contain the .playwright folder - rebuild or reinstall the app. Use the Native engine meanwhile.");
            }
            try
            {
                var opts = new BrowserTypeLaunchPersistentContextOptions { Channel = "msedge", Headless = Headless, ViewportSize = ViewportSize.NoViewport, Args = new[] { "--start-maximized" } };
                // tests (Linux CI): TEACHME_PW_EXECUTABLE = a Chromium to use instead of Edge
                var exe = Environment.GetEnvironmentVariable("TEACHME_PW_EXECUTABLE");
                if (!string.IsNullOrEmpty(exe)) { opts.Channel = null; opts.ExecutablePath = exe; }
                _ctx = await _pw.Chromium.LaunchPersistentContextAsync(Path.Combine(Root, "pw-profile"), opts);
            }
            catch (PlaywrightException ex)
            {
                throw new InvalidOperationException("Playwright could not start Microsoft Edge (" + ex.Message.Split('\n')[0] + "). Is Edge installed, and is no other Playwright run using the profile? Use the Native engine meanwhile.");
            }
            _ctx.Close += (_, _) => _closed = true;
            try { await _ctx.Tracing.StartAsync(new TracingStartOptions { Screenshots = true, Snapshots = true, Title = "Teach Me run" }); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[TeachMe] trace: " + ex.Message); }   // a run without a trace is still a run
            var page = PageOrNull ?? await _ctx.NewPageAsync();
            await page.GotoAsync(url, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = 60000 });
        }

        public async Task<bool> SignInPageAsync()
        {
            try
            {
                var page = PageOrNull;
                if (page == null) return false;
                var pw = page.Locator("input[type=password]");
                int n = await pw.CountAsync();
                for (int i = 0; i < Math.Min(n, 5); i++) if (await pw.Nth(i).IsVisibleAsync()) return true;
            }
            catch { }
            return false;
        }

        private static string S(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private IFrame FrameFor(string path)
        {
            var page = Page;
            if (string.IsNullOrEmpty(path)) return page.MainFrame;
            foreach (var f in page.Frames)
            {
                if (f == page.MainFrame) continue;
                try { if (Uri.TryCreate(f.Url, UriKind.Absolute, out var u) && (u.AbsolutePath == path || "/" + u.AbsolutePath.TrimStart('/') == path || u.AbsolutePath.TrimStart('/') == path.TrimStart('/'))) return f; } catch { }
            }
            return null;
        }

        private static readonly Dictionary<string, AriaRole> ROLES = new(StringComparer.OrdinalIgnoreCase)
        {
            ["button"] = AriaRole.Button, ["link"] = AriaRole.Link, ["option"] = AriaRole.Option, ["menuitem"] = AriaRole.Menuitem, ["tab"] = AriaRole.Tab,
            ["checkbox"] = AriaRole.Checkbox, ["radio"] = AriaRole.Radio, ["treeitem"] = AriaRole.Treeitem, ["a"] = AriaRole.Link
        };

        /// <summary>Locators to try for a recorded element, most robust first.</summary>
        private static IEnumerable<ILocator> Candidates(IFrame f, JsonElement t)
        {
            string tag = S(t, "tag") ?? "*", role = S(t, "role"), label = S(t, "label"), text = S(t, "text"), ph = S(t, "placeholder"), id = S(t, "id"), name = S(t, "name"), css = S(t, "css");
            if (!string.IsNullOrEmpty(label)) yield return f.GetByLabel(label, new FrameGetByLabelOptions { Exact = true });
            if (!string.IsNullOrEmpty(text))
            {
                var r = !string.IsNullOrEmpty(role) && ROLES.TryGetValue(role, out var rr) ? rr : ROLES.TryGetValue(tag, out var rt) ? rt : (AriaRole?)null;
                if (r.HasValue) yield return f.GetByRole(r.Value, new FrameGetByRoleOptions { Name = text, Exact = true });
            }
            if (!string.IsNullOrEmpty(ph)) yield return f.GetByPlaceholder(ph, new FrameGetByPlaceholderOptions { Exact = true });
            if (!string.IsNullOrEmpty(id)) yield return f.Locator("[id=\"" + id.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"]");
            if (!string.IsNullOrEmpty(name)) yield return f.Locator(tag + "[name=\"" + name.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"]");
            if (!string.IsNullOrEmpty(text)) yield return f.GetByText(text, new FrameGetByTextOptions { Exact = true });
            if (!string.IsNullOrEmpty(css)) yield return f.Locator(css);
        }

        private static async Task<ILocator> Visible(ILocator loc)
        {
            try
            {
                int n = await loc.CountAsync();
                for (int i = 0; i < Math.Min(n, 8); i++) if (await loc.Nth(i).IsVisibleAsync()) return loc.Nth(i);
            }
            catch { }
            return null;
        }

        public async Task<TeachStepResult> RunStepAsync(JsonElement s, int timeoutMs, CancellationToken ct)
        {
            string op = S(s, "op") ?? "click";
            var t = s.TryGetProperty("t", out var tt) && tt.ValueKind == JsonValueKind.Object ? tt : default;
            string framePath = t.ValueKind == JsonValueKind.Object ? S(t, "frame") : null;
            var until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            ILocator el = null;
            while (el == null && DateTime.UtcNow < until)
            {
                ct.ThrowIfCancellationRequested();
                var f = FrameFor(framePath);
                if (f != null && t.ValueKind == JsonValueKind.Object)
                    foreach (var c in Candidates(f, t)) { el = await Visible(c); if (el != null) break; }
                if (el == null) await Task.Delay(300, ct);
            }
            if (el == null)
                return new TeachStepResult { Ok = false, SignIn = await SignInPageAsync(), Error = "Could not find \"" + (S(t, "label") ?? S(t, "text") ?? S(t, "placeholder") ?? S(t, "name") ?? S(t, "id") ?? "?") + "\"" };
            try
            {
                var o = new { Timeout = 15000f };
                switch (op)
                {
                    case "fill":
                        if (string.Equals(await el.GetAttributeAsync("type"), "password", StringComparison.OrdinalIgnoreCase))
                            return new TeachStepResult { Ok = false, Error = "That is a password field - Teach Me never types passwords." };
                        await el.FillAsync(S(s, "value") ?? "", new LocatorFillOptions { Timeout = o.Timeout });
                        break;
                    case "select":
                        if (string.Equals(await el.EvaluateAsync<string>("e => e.tagName"), "SELECT", StringComparison.OrdinalIgnoreCase))
                        {
                            string label = S(s, "optText"), value = S(s, "value");
                            try { await el.SelectOptionAsync(new SelectOptionValue { Label = label }, new LocatorSelectOptionOptions { Timeout = 5000 }); }
                            catch { await el.SelectOptionAsync(new SelectOptionValue { Value = value }, new LocatorSelectOptionOptions { Timeout = o.Timeout }); }
                        }
                        else await el.ClickAsync(new LocatorClickOptions { Timeout = o.Timeout });
                        break;
                    case "check":
                        await el.SetCheckedAsync(S(s, "value") == "true", new LocatorSetCheckedOptions { Timeout = o.Timeout });
                        break;
                    case "key":
                        await el.PressAsync("Enter", new LocatorPressOptions { Timeout = o.Timeout });
                        break;
                    default:
                        await el.ClickAsync(new LocatorClickOptions { Timeout = o.Timeout });
                        break;
                }
                return new TeachStepResult { Ok = true };
            }
            catch (PlaywrightException ex)
            {
                _ = Page;                    // the window was closed during the step: say so instead of "Target closed"
                return new TeachStepResult { Ok = false, Error = ex.Message.Split('\n')[0] };
            }
        }

        public async Task AfterStepAsync(int index, string op, CancellationToken ct)
        {
            var page = Page;
            try { await page.WaitForLoadStateAsync(LoadState.DOMContentLoaded, new PageWaitForLoadStateOptions { Timeout = 30000 }); } catch { }
            if (op == "click" || op == "key") await Task.Delay(500, ct);
            page = PageOrNull;               // a click may have opened a new tab
            if (page == null) return;
            try { await page.ScreenshotAsync(new PageScreenshotOptions { Path = Path.Combine(Folder, "step-" + (index + 1).ToString("00") + ".png") }); } catch { }
        }

        public async Task<string> ScanAsync(string regex)
        {
            Regex re;
            try { re = new Regex(regex, RegexOptions.None, TimeSpan.FromSeconds(2)); } catch { return null; }
            var page = Page;
            foreach (var f in page.Frames)
            {
                try
                {
                    string text = await f.Locator("body").InnerTextAsync(new LocatorInnerTextOptions { Timeout = 2000 });
                    var m = re.Match(text ?? "");
                    if (m.Success) return m.Groups.Count > 1 && m.Groups[1].Success ? m.Groups[1].Value : m.Value;
                }
                catch { }
            }
            return null;
        }

        public async Task CloseAsync(bool keepOpen)
        {
            if (_ctx != null && !_closed)
            {
                try { await _ctx.Tracing.StopAsync(new TracingStopOptions { Path = Path.Combine(Folder, "trace.zip") }); } catch { }
                var page = PageOrNull;
                if (page != null) try { await page.ScreenshotAsync(new PageScreenshotOptions { Path = Path.Combine(Folder, "last.png") }); } catch { }
            }
            if (keepOpen) return;          // the person still works in the window (e.g. presses Submit); it closes with the window
            try { if (_ctx != null && !_closed) await _ctx.CloseAsync(); } catch { }
            try { _pw?.Dispose(); } catch { }
            _ctx = null; _pw = null;
            if (_last == this) _last = null;
        }
    }
}
