using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// AI Digital Employee control plane (apex_sql/75_ai_control.sql - the tables are created here on first use):
    /// - kill switch  WMS_AI_CONTROL.AI_ENABLED: N pauses every AI action that changes or sends something
    ///                (chat, approvals, LOCAL jobs, Shipping Agent; the DB-lane runner checks it too)
    /// - audit        WMS_AI_AUDIT: one trail for what the AI did or was asked to do, incl. tokens + cost
    /// - inbox        WMS_AI_INBOX: approval requests that wait for a person, decided from any PC,
    ///                with a Teams / e-mail alert when one arrives
    /// Everything goes through the guarded APEX gateways (ai/executequery, ai/executewrite).
    /// </summary>
    public static class AiControl
    {
        private const string AI_BASE = "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai";
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

        // ------------------------------------------------------------------ gateway
        public static async Task<List<Dictionary<string, string>>> QueryAsync(string sql, string user, int maxRows = 500)
        {
            var body = JsonSerializer.Serialize(new { sql, maxRows, appUser = user ?? Environment.UserName });
            var resp = await _http.PostAsync(AI_BASE + "/executequery", new StringContent(body, Encoding.UTF8, "application/json")).ConfigureAwait(false);
            string txt = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            using var doc = JsonDocument.Parse(txt);
            var root = doc.RootElement;
            if (root.TryGetProperty("success", out var s) && s.ValueKind == JsonValueKind.False)
                throw new InvalidOperationException(root.TryGetProperty("error", out var e) ? e.GetString() : "query failed");
            var cols = new List<string>();
            if (root.TryGetProperty("columns", out var c) && c.ValueKind == JsonValueKind.Array)
                foreach (var x in c.EnumerateArray())
                    cols.Add((x.ValueKind == JsonValueKind.Object && x.TryGetProperty("name", out var n) ? n.GetString() : x.ToString()).ToUpperInvariant());
            var rows = new List<Dictionary<string, string>>();
            if (root.TryGetProperty("rows", out var r) && r.ValueKind == JsonValueKind.Array)
                foreach (var row in r.EnumerateArray())
                {
                    var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    if (row.ValueKind == JsonValueKind.Array)
                    {
                        int i = 0;
                        foreach (var v in row.EnumerateArray()) { if (i < cols.Count) d[cols[i]] = v.ValueKind == JsonValueKind.Null ? null : v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString(); i++; }
                    }
                    else if (row.ValueKind == JsonValueKind.Object)
                        foreach (var p in row.EnumerateObject()) d[p.Name.ToUpperInvariant()] = p.Value.ValueKind == JsonValueKind.Null ? null : p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString();
                    rows.Add(d);
                }
            return rows;
        }

        public static async Task WriteAsync(string sql, string user)
        {
            var body = JsonSerializer.Serialize(new { sql, appUser = user ?? Environment.UserName });
            var resp = await _http.PostAsync(AI_BASE + "/executewrite", new StringContent(body, Encoding.UTF8, "application/json")).ConfigureAwait(false);
            string txt = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            try
            {
                using var doc = JsonDocument.Parse(txt);
                if (doc.RootElement.TryGetProperty("success", out var s) && s.ValueKind == JsonValueKind.False)
                    throw new InvalidOperationException(doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() : "write failed");
            }
            catch (JsonException) { if (!resp.IsSuccessStatusCode) throw new InvalidOperationException("HTTP " + (int)resp.StatusCode); }
        }

        /// <summary>SQL string literal ('' doubled, cut to max chars); NULL for empty.</summary>
        public static string Lit(string s, int max = 4000)
        {
            if (string.IsNullOrEmpty(s)) return "NULL";
            if (s.Length > max) s = s.Substring(0, max);
            // literal limit is 4000 BYTES - keep multi-byte text safe
            while (Encoding.UTF8.GetByteCount(s) > 3900) s = s.Substring(0, s.Length - 50);
            return "'" + s.Replace("'", "''") + "'";
        }
        public static string Num(double? v) => v.HasValue ? v.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : "NULL";
        public static string Clob(string s)
        {
            if (string.IsNullOrEmpty(s)) return "EMPTY_CLOB()";
            var parts = new List<string>();
            for (int i = 0; i < s.Length; i += 1000) parts.Add("TO_CLOB(" + Lit(s.Substring(i, Math.Min(1000, s.Length - i)), 1000) + ")");
            return string.Join(" || ", parts);
        }

        // ------------------------------------------------------------------ tables
        private static readonly string[] DDL =
        {
            "WMS_AI_CONTROL|CREATE TABLE wms_ai_control (control_key VARCHAR2(60) PRIMARY KEY, control_value VARCHAR2(4000), updated_by VARCHAR2(100), updated_date DATE DEFAULT SYSDATE)",
            "WMS_AI_AUDIT|CREATE TABLE wms_ai_audit (audit_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, event_time DATE DEFAULT SYSDATE, app_user VARCHAR2(100), machine VARCHAR2(100), source VARCHAR2(30), action_key VARCHAR2(60), outcome VARCHAR2(20), approval VARCHAR2(20), instance VARCHAR2(10), ref_id VARCHAR2(200), target VARCHAR2(400), detail VARCHAR2(4000), model VARCHAR2(60), tokens_in NUMBER, tokens_out NUMBER, cache_read NUMBER, cache_write NUMBER, cost_usd NUMBER(14,6), duration_ms NUMBER)",
            "WMS_AI_INBOX|CREATE TABLE wms_ai_inbox (inbox_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, created_date DATE DEFAULT SYSDATE, source VARCHAR2(30), requested_by VARCHAR2(100), machine VARCHAR2(100), action_key VARCHAR2(60), instance VARCHAR2(10), ref_id VARCHAR2(200), sig VARCHAR2(200), title VARCHAR2(400), summary VARCHAR2(4000), payload_json CLOB, status VARCHAR2(20) DEFAULT 'PENDING', decided_by VARCHAR2(100), decided_date DATE, decision_note VARCHAR2(1000), result_text VARCHAR2(4000), expires_date DATE)",
            "WMS_AI_CONVERSATIONS|CREATE TABLE wms_ai_conversations (chat_id VARCHAR2(60) PRIMARY KEY, app_user VARCHAR2(100), machine VARCHAR2(100), title VARCHAR2(400), message_count NUMBER, messages_json CLOB, created_date DATE DEFAULT SYSDATE, updated_date DATE DEFAULT SYSDATE, deleted VARCHAR2(1) DEFAULT 'N')",
        };
        private static readonly string[] AFTER_DDL =
        {
            "CREATE INDEX wms_ai_audit_n1 ON wms_ai_audit (event_time)",
            "CREATE INDEX wms_ai_audit_n2 ON wms_ai_audit (app_user, event_time)",
            "CREATE INDEX wms_ai_inbox_n1 ON wms_ai_inbox (status, created_date)",
            "CREATE INDEX wms_ai_conversations_n1 ON wms_ai_conversations (app_user, updated_date)",
            "INSERT INTO wms_ai_control (control_key, control_value, updated_by) SELECT 'AI_ENABLED', 'Y', 'APP' FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_ai_control WHERE control_key = 'AI_ENABLED')",
        };
        private static Task _ensure;
        private static readonly object _ensureLock = new object();
        public static Task EnsureTablesAsync(string user)
        {
            lock (_ensureLock)
            {
                if (_ensure == null || _ensure.IsFaulted) _ensure = EnsureCoreAsync(user);
                return _ensure;
            }
        }
        private static async Task EnsureCoreAsync(string user)
        {
            var have = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in await QueryAsync("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_AI_CONTROL','WMS_AI_AUDIT','WMS_AI_INBOX','WMS_AI_CONVERSATIONS')", user).ConfigureAwait(false))
                have.Add(r["TABLE_NAME"]);
            bool created = false;
            foreach (var d in DDL)
            {
                var p = d.Split('|');
                if (have.Contains(p[0])) continue;
                await WriteAsync(p[1], user).ConfigureAwait(false);
                created = true;
            }
            foreach (var s in AFTER_DDL)
            {
                if (!created && s.StartsWith("CREATE INDEX")) continue;
                try { await WriteAsync(s, user).ConfigureAwait(false); } catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[AiControl] " + ex.Message); }
            }
        }

        // ------------------------------------------------------------------ settings + kill switch
        private static Dictionary<string, (string Value, string By, string At)> _settings;
        private static DateTime _settingsAt = DateTime.MinValue;
        private static readonly SemaphoreSlim _settingsGate = new SemaphoreSlim(1, 1);

        public static async Task<Dictionary<string, (string Value, string By, string At)>> SettingsAsync(string user, bool fresh = false)
        {
            if (!fresh && _settings != null && (DateTime.Now - _settingsAt).TotalSeconds < 20) return _settings;
            await _settingsGate.WaitAsync().ConfigureAwait(false);
            try
            {
                if (!fresh && _settings != null && (DateTime.Now - _settingsAt).TotalSeconds < 20) return _settings;
                await EnsureTablesAsync(user).ConfigureAwait(false);
                var d = new Dictionary<string, (string, string, string)>(StringComparer.OrdinalIgnoreCase);
                foreach (var r in await QueryAsync("SELECT control_key, control_value, updated_by, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS upd FROM wms_ai_control", user).ConfigureAwait(false))
                    d[r["CONTROL_KEY"]] = (r["CONTROL_VALUE"], r.GetValueOrDefault("UPDATED_BY"), r.GetValueOrDefault("UPD"));
                _settings = d; _settingsAt = DateTime.Now;
                return d;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[AiControl] settings: " + ex.Message);
                return _settings ?? new Dictionary<string, (string, string, string)>();   // last known; none = enabled
            }
            finally { _settingsGate.Release(); }
        }
        public static string Setting(Dictionary<string, (string Value, string By, string At)> s, string key) =>
            s.TryGetValue(key, out var v) ? v.Value : null;

        public class Status { public bool Enabled; public string Reason; public string By; public string At; }
        public static async Task<Status> StatusAsync(string user, bool fresh = false)
        {
            var s = await SettingsAsync(user, fresh).ConfigureAwait(false);
            s.TryGetValue("AI_ENABLED", out var en);
            return new Status
            {
                Enabled = !string.Equals(en.Value, "N", StringComparison.OrdinalIgnoreCase),
                Reason = Setting(s, "PAUSE_REASON"), By = en.By, At = en.At
            };
        }
        public static async Task<bool> IsEnabledAsync(string user) => (await StatusAsync(user).ConfigureAwait(false)).Enabled;

        private static bool InList(string list, string user) =>
            !string.IsNullOrWhiteSpace(user) && (list ?? "").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
                .Any(x => string.Equals(x.Trim(), user.Trim(), StringComparison.OrdinalIgnoreCase));
        /// <summary>No ADMINS set yet = everyone (bootstrap), otherwise only the listed logins.</summary>
        public static async Task<bool> IsAdminAsync(string user)
        {
            var list = Setting(await SettingsAsync(user).ConfigureAwait(false), "ADMINS");
            return string.IsNullOrWhiteSpace(list) || InList(list, user);
        }
        /// <summary>No APPROVERS set = anyone may decide inbox requests; otherwise the listed logins and the admins.</summary>
        public static async Task<bool> IsApproverAsync(string user)
        {
            var s = await SettingsAsync(user).ConfigureAwait(false);
            string ap = Setting(s, "APPROVERS");
            return string.IsNullOrWhiteSpace(ap) || InList(ap, user) || InList(Setting(s, "ADMINS"), user);
        }

        /// <summary>Anyone may pause (stopping is always safe); only admins may resume.</summary>
        public static async Task<(bool Ok, string Error)> SetEnabledAsync(bool enabled, string user, string reason)
        {
            if (enabled && !await IsAdminAsync(user).ConfigureAwait(false)) return (false, "Only an AI admin can resume the AI.");
            await EnsureTablesAsync(user).ConfigureAwait(false);
            await SetSettingAsync("AI_ENABLED", enabled ? "Y" : "N", user).ConfigureAwait(false);
            await SetSettingAsync("PAUSE_REASON", enabled ? null : (string.IsNullOrWhiteSpace(reason) ? "Paused by " + user : reason.Trim()), user).ConfigureAwait(false);
            _settings = null;
            Audit(new AuditEvent { Source = "CONTROL", Action = "kill_switch", Outcome = enabled ? "RESUMED" : "PAUSED", User = user, Detail = reason });
            return (true, null);
        }
        public static async Task SetSettingAsync(string key, string value, string user)
        {
            await WriteAsync("MERGE INTO wms_ai_control c USING (SELECT " + Lit(key, 60) + " k FROM dual) s ON (c.control_key = s.k) " +
                "WHEN MATCHED THEN UPDATE SET control_value = " + Lit(value) + ", updated_by = " + Lit(user, 100) + ", updated_date = SYSDATE " +
                "WHEN NOT MATCHED THEN INSERT (control_key, control_value, updated_by) VALUES (s.k, " + Lit(value) + ", " + Lit(user, 100) + ")", user).ConfigureAwait(false);
            _settings = null;
        }

        // ------------------------------------------------------------------ audit
        public class AuditEvent
        {
            public string User, Source = "CHAT", Action, Outcome = "OK", Approval = "NONE", Instance, Ref, Target, Detail, Model;
            public long? TokensIn, TokensOut, CacheRead, CacheWrite, DurationMs;
            public double? CostUsd;
        }
        private static readonly ConcurrentQueue<AuditEvent> _queue = new ConcurrentQueue<AuditEvent>();
        private static int _flushing;

        /// <summary>Fire-and-forget: queued and written in order in the background; never throws into the caller.</summary>
        public static void Audit(AuditEvent e)
        {
            if (e == null) return;
            e.User = string.IsNullOrWhiteSpace(e.User) ? Environment.UserName : e.User;
            _queue.Enqueue(e);
            if (Interlocked.CompareExchange(ref _flushing, 1, 0) == 0) _ = Task.Run(FlushAsync);
        }
        private static async Task FlushAsync()
        {
            try
            {
                while (_queue.TryDequeue(out var e))
                {
                    try
                    {
                        await EnsureTablesAsync(e.User).ConfigureAwait(false);
                        string Upper(string s, int max) => Lit(string.IsNullOrWhiteSpace(s) ? null : s.Trim().ToUpperInvariant(), max);
                        await WriteAsync("INSERT INTO wms_ai_audit (app_user, machine, source, action_key, outcome, approval, instance, ref_id, target, detail, model, tokens_in, tokens_out, cache_read, cache_write, cost_usd, duration_ms) VALUES (" +
                            string.Join(", ", Lit(e.User, 100), Lit(Environment.MachineName, 100), Upper(e.Source, 30), Lit(e.Action, 60), Upper(e.Outcome, 20), Upper(e.Approval, 20),
                                Upper(e.Instance, 10), Lit(e.Ref, 200), Lit(e.Target, 400), Lit(DllInspector.Redact(e.Detail), 4000), Lit(e.Model, 60),
                                Num(e.TokensIn), Num(e.TokensOut), Num(e.CacheRead), Num(e.CacheWrite), Num(e.CostUsd.HasValue ? Math.Round(e.CostUsd.Value, 6) : (double?)null), Num(e.DurationMs)) + ")", e.User).ConfigureAwait(false);
                    }
                    catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[AiControl] audit write failed: " + ex.Message); }
                }
            }
            finally
            {
                Interlocked.Exchange(ref _flushing, 0);
                if (!_queue.IsEmpty && Interlocked.CompareExchange(ref _flushing, 1, 0) == 0) _ = Task.Run(FlushAsync);
            }
        }

        // ------------------------------------------------------------------ cost
        // USD per 1M tokens (input, output) from Anthropic's published prices; cache reads ~0.1x input,
        // 5-minute cache writes 1.25x input. MODEL_PRICES in WMS_AI_CONTROL overrides / adds models.
        private static readonly Dictionary<string, (double In, double Out)> PRICES = new Dictionary<string, (double, double)>(StringComparer.OrdinalIgnoreCase)
        {
            ["claude-sonnet-5"] = (2, 10), ["claude-sonnet-5-5"] = (2, 10),
            ["claude-opus-5"] = (5, 25), ["claude-opus-5-5"] = (4, 20),
        };
        public static async Task<double?> CostAsync(string model, long tokensIn, long tokensOut, long cacheRead, long cacheWrite, string user)
        {
            if (string.IsNullOrWhiteSpace(model)) return null;
            (double In, double Out) p;
            bool found = false;
            p = default;
            try
            {
                string json = Setting(await SettingsAsync(user).ConfigureAwait(false), "MODEL_PRICES");
                if (!string.IsNullOrWhiteSpace(json))
                {
                    using var doc = JsonDocument.Parse(json);
                    foreach (var m in doc.RootElement.EnumerateObject())
                        if (model.StartsWith(m.Name, StringComparison.OrdinalIgnoreCase) && m.Value.TryGetProperty("in", out var i) && m.Value.TryGetProperty("out", out var o))
                        { p = (i.GetDouble(), o.GetDouble()); found = true; break; }
                }
            }
            catch { }
            if (!found)
                foreach (var kv in PRICES.OrderByDescending(k => k.Key.Length))
                    if (model.StartsWith(kv.Key, StringComparison.OrdinalIgnoreCase)) { p = kv.Value; found = true; break; }
            if (!found) return null;   // unknown price: tokens are still recorded
            return (tokensIn * p.In + tokensOut * p.Out + cacheRead * p.In * 0.1 + cacheWrite * p.In * 1.25) / 1_000_000.0;
        }

        // ------------------------------------------------------------------ inbox
        /// <summary>
        /// Creates a PENDING request and alerts the approvers - or returns the open one with the same fingerprint:
        /// PENDING (still waiting) or APPROVED but not yet carried out (e.g. approved while the requesting PC was off).
        /// </summary>
        public static async Task<(long Id, string Status, string Selection)> InboxCreateAsync(string user, string source, string action, string instance, string refId, string sig,
            string title, string summary, string payloadJson, int expiresHours = 48)
        {
            await EnsureTablesAsync(user).ConfigureAwait(false);
            var existing = await QueryAsync("SELECT inbox_id, status, result_text FROM wms_ai_inbox WHERE sig = " + Lit(sig, 200) +
                " AND (status = 'APPROVED' OR (status = 'PENDING' AND (expires_date IS NULL OR expires_date >= SYSDATE))) ORDER BY inbox_id DESC FETCH FIRST 1 ROWS ONLY", user).ConfigureAwait(false);
            if (existing.Count > 0) return (long.Parse(existing[0]["INBOX_ID"]), existing[0]["STATUS"], existing[0]["RESULT_TEXT"]);
            await WriteAsync("INSERT INTO wms_ai_inbox (source, requested_by, machine, action_key, instance, ref_id, sig, title, summary, payload_json, expires_date) VALUES (" +
                string.Join(", ", Lit(source, 30), Lit(user, 100), Lit(Environment.MachineName, 100), Lit(action, 60), Lit(instance, 10), Lit(refId, 200), Lit(sig, 200),
                    Lit(title, 400), Lit(summary, 4000), Clob(payloadJson), "SYSDATE + " + expiresHours + "/24") + ")", user).ConfigureAwait(false);
            var row = await QueryAsync("SELECT inbox_id FROM wms_ai_inbox WHERE sig = " + Lit(sig, 200) + " AND status = 'PENDING' ORDER BY inbox_id DESC FETCH FIRST 1 ROWS ONLY", user).ConfigureAwait(false);
            long id = row.Count > 0 ? long.Parse(row[0]["INBOX_ID"]) : 0;
            Audit(new AuditEvent { User = user, Source = source, Action = action, Outcome = "ASKED", Approval = "INBOX", Instance = instance, Ref = "INBOX:" + id + " " + refId, Detail = title });
            _ = NotifyAsync(user, id, title, summary, instance);
            return (id, "PENDING", null);
        }

        /// <summary>Statuses (and the approved selection) of the given requests.</summary>
        public static async Task<List<Dictionary<string, string>>> InboxGetAsync(string user, IEnumerable<long> ids)
        {
            var list = ids.Where(i => i > 0).Distinct().Take(200).ToList();
            if (list.Count == 0) return new List<Dictionary<string, string>>();
            await EnsureTablesAsync(user).ConfigureAwait(false);
            return await QueryAsync("SELECT inbox_id, status, decided_by, TO_CHAR(decided_date, 'YYYY-MM-DD HH24:MI') AS decided, decision_note, result_text, " +
                "CASE WHEN status = 'PENDING' AND expires_date < SYSDATE THEN 'Y' ELSE 'N' END AS expired FROM wms_ai_inbox WHERE inbox_id IN (" + string.Join(",", list) + ")", user).ConfigureAwait(false);
        }

        /// <summary>Approve / reject a PENDING request. Only one decision wins (the UPDATE is conditional on PENDING).</summary>
        public static async Task<(bool Ok, string Error)> InboxDecideAsync(string user, long id, bool approve, string note, string selectionJson)
        {
            if (!await IsApproverAsync(user).ConfigureAwait(false)) return (false, "You are not an approver for AI requests (AI Digital Employee > Control > Settings).");
            if (approve && !await IsEnabledAsync(user).ConfigureAwait(false)) return (false, "The AI is paused - resume it before approving.");
            await WriteAsync("UPDATE wms_ai_inbox SET status = " + (approve ? "'APPROVED'" : "'REJECTED'") + ", decided_by = " + Lit(user, 100) +
                ", decided_date = SYSDATE, decision_note = " + Lit(note, 1000) + (approve && !string.IsNullOrWhiteSpace(selectionJson) ? ", result_text = " + Lit("SELECTION:" + selectionJson, 4000) : "") +
                " WHERE inbox_id = " + id + " AND status = 'PENDING' AND (expires_date IS NULL OR expires_date >= SYSDATE)", user).ConfigureAwait(false);
            var r = await QueryAsync("SELECT status, decided_by, action_key, instance, ref_id, title FROM wms_ai_inbox WHERE inbox_id = " + id, user).ConfigureAwait(false);
            if (r.Count == 0) return (false, "Request not found");
            string st = r[0]["STATUS"];
            bool mine = string.Equals(r[0]["DECIDED_BY"], user, StringComparison.OrdinalIgnoreCase) && st == (approve ? "APPROVED" : "REJECTED");
            if (!mine) return (false, "Already decided (" + st + (string.IsNullOrEmpty(r[0]["DECIDED_BY"]) ? "" : " by " + r[0]["DECIDED_BY"]) + ") or expired.");
            Audit(new AuditEvent { User = user, Source = "INBOX", Action = r[0]["ACTION_KEY"], Outcome = approve ? "APPROVED" : "REJECTED", Approval = "INBOX", Instance = r[0]["INSTANCE"], Ref = "INBOX:" + id + " " + r[0]["REF_ID"], Detail = r[0]["TITLE"] + (string.IsNullOrWhiteSpace(note) ? "" : " - " + note) });
            return (true, null);
        }

        /// <summary>The requester reports what happened after an approval (DONE / FAILED) or withdraws it (CANCELLED).</summary>
        public static async Task InboxCompleteAsync(string user, long id, string status, string result)
        {
            status = (status ?? "").ToUpperInvariant();
            if (status != "DONE" && status != "FAILED" && status != "CANCELLED") status = "DONE";
            await WriteAsync("UPDATE wms_ai_inbox SET status = " + Lit(status, 20) + ", result_text = " + Lit(result, 4000) +
                " WHERE inbox_id = " + id + " AND status IN (" + (status == "CANCELLED" ? "'PENDING'" : "'APPROVED'") + ")", user).ConfigureAwait(false);
        }

        private static async Task NotifyAsync(string user, long id, string title, string summary, string instance)
        {
            string text = "AI approval needed (" + (instance ?? "PROD") + "): " + title + "\n\n" + summary +
                          "\n\nDecide in Gray's WMS > AI Digital Employee > Control > Inbox (request #" + id + ").";
            await SendAlertAsync(user, "AI approval needed: " + title, text, null, null).ConfigureAwait(false);
        }

        /// <summary>Only Teams / Power Automate webhook hosts may receive alerts.</summary>
        public static bool IsAlertWebhook(string url)
        {
            if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps) return false;
            string h = u.Host.ToLowerInvariant();
            return h.EndsWith(".webhook.office.com") || h == "outlook.office.com" || h.EndsWith(".logic.azure.com") || h.EndsWith(".powerplatform.com") || h.EndsWith(".environment.api.powerplatform.com");
        }

        /// <summary>
        /// Sends one alert to Teams (incoming webhook / Workflows) and / or e-mail (the SMTP account of SmtpVault).
        /// Blank hook / mail use the AI Control alert settings (INBOX_TEAMS_WEBHOOK / INBOX_EMAIL_TO).
        /// Returns what was sent, e.g. "teams, email", or "" when nothing was configured.
        /// </summary>
        public static async Task<string> SendAlertAsync(string user, string subject, string text, string hookOverride, string mailOverride)
        {
            var sent = new List<string>();
            try
            {
                var s = await SettingsAsync(user).ConfigureAwait(false);
                string hook = string.IsNullOrWhiteSpace(hookOverride) ? Setting(s, "INBOX_TEAMS_WEBHOOK") : hookOverride.Trim();
                string mailTo = string.IsNullOrWhiteSpace(mailOverride) ? Setting(s, "INBOX_EMAIL_TO") : mailOverride.Trim();
                if (!string.IsNullOrWhiteSpace(hook) && hook.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && (string.IsNullOrWhiteSpace(hookOverride) || IsAlertWebhook(hook)))
                {
                    var body = JsonSerializer.Serialize(new { text = text.Replace("\n", "<br>") });
                    var resp = await _http.PostAsync(hook, new StringContent(body, Encoding.UTF8, "application/json")).ConfigureAwait(false);
                    if (resp.IsSuccessStatusCode) sent.Add("teams");
                }
                if (!string.IsNullOrWhiteSpace(mailTo))
                {
                    var st = System.Text.Json.JsonSerializer.Serialize(SmtpVault.Status());
                    using var doc = JsonDocument.Parse(st);
                    string from = doc.RootElement.GetProperty("username").GetString(), server = doc.RootElement.GetProperty("server").GetString();
                    int port = doc.RootElement.GetProperty("port").GetInt32();
                    string pw = SmtpVault.PasswordFor(from);
                    if (!string.IsNullOrEmpty(from) && !string.IsNullOrEmpty(pw))
                    {
                        using var client = new System.Net.Mail.SmtpClient(server, port) { EnableSsl = true, Credentials = new System.Net.NetworkCredential(from, pw), Timeout = 30000 };
                        using var msg = new System.Net.Mail.MailMessage { From = new System.Net.Mail.MailAddress(from), Subject = subject, Body = text };
                        foreach (var to in mailTo.Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries)) msg.To.Add(to.Trim());
                        await client.SendMailAsync(msg).ConfigureAwait(false);
                        sent.Add("email");
                    }
                }
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[AiControl] alert failed: " + ex.Message); }
            return string.Join(", ", sent);
        }
    }
}
