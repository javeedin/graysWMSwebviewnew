using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta;
using Anthropic.Models.Beta.Messages;
using Microsoft.Data.Sqlite;

namespace WMSApp.FusionSql
{
    // ---------------------------------------------------------------------
    //  SQLite schema store — "Tables List" tab (§6.1)
    //  %APPDATA%\GraysWMS\FusionSql\fusion-schema.db, shareable between laptops.
    // ---------------------------------------------------------------------
    public static class FusionSchemaDb
    {
        private static readonly object _lock = new object();

        private static SqliteConnection Open(bool readOnly = false)
        {
            Directory.CreateDirectory(FusionSqlStore.Root);
            var cs = new SqliteConnectionStringBuilder
            {
                DataSource = FusionSqlStore.SchemaDbFile,
                Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate,
                Pooling = false
            }.ToString();
            var conn = new SqliteConnection(cs);
            conn.Open();
            if (!readOnly) Exec(conn, null,
                @"CREATE TABLE IF NOT EXISTS fusion_tables(owner TEXT NOT NULL, table_name TEXT NOT NULL);
                  CREATE TABLE IF NOT EXISTS fusion_indexes(owner TEXT NOT NULL, table_name TEXT NOT NULL, index_name TEXT, uniqueness TEXT, columns TEXT);
                  CREATE TABLE IF NOT EXISTS fusion_foreign_keys(owner TEXT NOT NULL, table_name TEXT NOT NULL, fk_name TEXT, fk_columns TEXT, ref_table TEXT);
                  CREATE INDEX IF NOT EXISTS ix_ft ON fusion_tables(owner, table_name);
                  CREATE INDEX IF NOT EXISTS ix_fi ON fusion_indexes(owner, table_name);
                  CREATE INDEX IF NOT EXISTS ix_ff ON fusion_foreign_keys(owner, table_name);");
            return conn;
        }

        private static void Exec(SqliteConnection c, SqliteTransaction tx, string sql)
        {
            using (var cmd = c.CreateCommand()) { cmd.Transaction = tx; cmd.CommandText = sql; cmd.ExecuteNonQuery(); }
        }

        private static string Str(JsonElement row, string name)
        {
            foreach (var p in row.EnumerateObject())
                if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
                    return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString();
            return null;
        }

        /// <summary>Replaces one owner's rows (delete + insert); other owners are untouched.</summary>
        public static object Save(string owner, JsonElement tables, JsonElement indexes, JsonElement fks)
        {
            lock (_lock)
            {
                using (var c = Open())
                using (var tx = c.BeginTransaction())
                {
                    foreach (var t in new[] { "fusion_tables", "fusion_indexes", "fusion_foreign_keys" })
                        using (var del = c.CreateCommand())
                        {
                            del.Transaction = tx;
                            del.CommandText = "DELETE FROM " + t + " WHERE owner = $o";
                            del.Parameters.AddWithValue("$o", owner);
                            del.ExecuteNonQuery();
                        }

                    int nt = Insert(c, tx, "INSERT INTO fusion_tables VALUES($o,$a)", owner, tables, r => new[] { r.ValueKind == JsonValueKind.String ? r.GetString() : Str(r, "table_name") ?? Str(r, "object_name") });
                    int ni = Insert(c, tx, "INSERT INTO fusion_indexes VALUES($o,$a,$b,$c,$d)", owner, indexes, r => new[] { Str(r, "table_name"), Str(r, "index_name"), Str(r, "uniqueness"), Str(r, "columns") });
                    int nf = Insert(c, tx, "INSERT INTO fusion_foreign_keys VALUES($o,$a,$b,$c,$d)", owner, fks, r => new[] { Str(r, "table_name"), Str(r, "fk_name"), Str(r, "fk_columns"), Str(r, "ref_table") });
                    tx.Commit();
                    return new { ok = true, path = FusionSqlStore.SchemaDbFile, counts = new { tables = nt, indexes = ni, fks = nf } };
                }
            }
        }

        private static int Insert(SqliteConnection c, SqliteTransaction tx, string sql, string owner, JsonElement rows, Func<JsonElement, string[]> map)
        {
            if (rows.ValueKind != JsonValueKind.Array) return 0;
            int n = 0;
            using (var cmd = c.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = sql;
                var names = new[] { "$a", "$b", "$c", "$d" };
                cmd.Parameters.AddWithValue("$o", owner);
                int argc = sql.Count(ch => ch == '$') - 1;
                var ps = names.Take(argc).Select(nm => cmd.Parameters.Add(nm, SqliteType.Text)).ToArray();
                foreach (var r in rows.EnumerateArray())
                {
                    var v = map(r);
                    for (int i = 0; i < ps.Length; i++) ps[i].Value = (object)v[i] ?? DBNull.Value;
                    cmd.ExecuteNonQuery();
                    n++;
                }
            }
            return n;
        }

        public static object Info()
        {
            lock (_lock)
            {
                string f = FusionSqlStore.SchemaDbFile;
                if (!File.Exists(f)) return new { ok = true, exists = false, path = f };
                using (var c = Open())
                {
                    var tables = new[] { "fusion_tables", "fusion_indexes", "fusion_foreign_keys" }
                        .Select(t => new { name = t, rows = Scalar(c, "SELECT COUNT(*) FROM " + t) }).ToList();
                    var owners = new List<object>();
                    using (var cmd = c.CreateCommand())
                    {
                        cmd.CommandText = "SELECT owner, COUNT(*) FROM fusion_tables GROUP BY owner ORDER BY owner";
                        using (var rd = cmd.ExecuteReader())
                            while (rd.Read()) owners.Add(new { owner = rd.GetString(0), tables = rd.GetInt64(1) });
                    }
                    return new { ok = true, exists = true, path = f, sizeBytes = new FileInfo(f).Length, modified = File.GetLastWriteTime(f).ToString("yyyy-MM-dd HH:mm"), tables, owners };
                }
            }
        }

        private static long Scalar(SqliteConnection c, string sql)
        {
            using (var cmd = c.CreateCommand()) { cmd.CommandText = sql; return Convert.ToInt64(cmd.ExecuteScalar()); }
        }

        /// <summary>Read-only query against the local schema DB.</summary>
        public static object Query(string sql, int rowLimit)
        {
            string err = FusionSqlService.ValidateStatement(sql, out string stmt);
            if (err != null) return new { ok = false, error = err };
            if (!File.Exists(FusionSqlStore.SchemaDbFile)) return new { ok = false, error = "No local schema database yet. Pull an owner first." };
            lock (_lock)
            {
                using (var c = Open(readOnly: true))
                using (var cmd = c.CreateCommand())
                {
                    cmd.CommandText = "SELECT * FROM (\n" + stmt + "\n) LIMIT " + Math.Clamp(rowLimit, 1, 100000);
                    using (var rd = cmd.ExecuteReader())
                    {
                        var cols = Enumerable.Range(0, rd.FieldCount).Select(rd.GetName).ToList();
                        var rows = new List<Dictionary<string, object>>();
                        while (rd.Read())
                        {
                            var d = new Dictionary<string, object>();
                            for (int i = 0; i < cols.Count; i++) d[cols[i]] = rd.IsDBNull(i) ? "" : rd.GetValue(i);
                            rows.Add(d);
                        }
                        return new { ok = true, columns = cols, rows, rowCount = rows.Count };
                    }
                }
            }
        }

        public static void ExportTo(string dest)
        {
            lock (_lock)
            {
                SqliteConnection.ClearAllPools();
                File.Copy(FusionSqlStore.SchemaDbFile, dest, true);
            }
        }

        public static void ImportFrom(string src)
        {
            // Validate it is one of ours before replacing
            using (var probe = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = src, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString()))
            {
                probe.Open();
                using (var cmd = probe.CreateCommand())
                {
                    cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('fusion_tables','fusion_indexes','fusion_foreign_keys')";
                    if (Convert.ToInt64(cmd.ExecuteScalar()) < 3) throw new InvalidDataException("This file is not a Fusion SQL schema database.");
                }
            }
            lock (_lock)
            {
                SqliteConnection.ClearAllPools();
                Directory.CreateDirectory(FusionSqlStore.Root);
                File.Copy(src, FusionSqlStore.SchemaDbFile, true);
            }
        }
    }

    // ---------------------------------------------------------------------
    //  "Ask AI" — Claude writes the SQL from the cached schema (§7.4)
    //  The API key lives on the host (DPAPI) and never reaches the page.
    // ---------------------------------------------------------------------
    public static class FusionSqlAi
    {
        private const string SYSTEM_PROMPT =
@"You are an Oracle Fusion Cloud (SaaS) SQL expert embedded in a read-only SQL workbench.
The query runs through a BI Publisher data model with DBMS_XMLGEN, as a BI user, on Oracle Database 19c.

Rules for every answer:
- Return exactly ONE read-only statement that starts with SELECT or WITH, inside a single ```sql code block.
- Use ONLY tables and columns that appear in the SCHEMA section. If the schema lacks something you need, say which table/column is missing instead of inventing it.
- Owner-qualify every table that is not owned by FUSION (for example FUSION_RO.X is fine unqualified only if the schema lists it under FUSION).
- Use {{PARAM_NAME}} tokens instead of hard-coded filter values the user did not give (the workbench prompts for them; blank means NULL, so NVL({{P}}, col) = col means 'all').
- Alias computed columns; format dates with TO_CHAR(col,'YYYY-MM-DD') when they are shown.
- No trailing semicolon, no DML/DDL, no PL/SQL, no WITH FUNCTION.
- Keep the statement compact: the runner limits it to about 2,900 characters.
After the code block, add at most three short bullet points explaining joins or assumptions.";

        public static async Task<(bool Success, string Response, string Error)> AskAsync(
            string question, string schema, JsonElement history, string model, CancellationToken ct = default)
        {
            string key = FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key))
                return (false, null, "No Claude API key saved. Click the ⚙ gear in Ask AI (or Connection → AI assistant) to add one.");

            var messages = new List<BetaMessageParam>();
            if (history.ValueKind == JsonValueKind.Array)
            {
                // Last 8 turns; must alternate and start with the user
                foreach (var h in history.EnumerateArray().TakeLast(8))
                {
                    string role = h.TryGetProperty("role", out var r) ? r.GetString() : null;
                    string content = h.TryGetProperty("content", out var c) ? c.GetString() : null;
                    if (string.IsNullOrWhiteSpace(content) || (role != "user" && role != "assistant")) continue;
                    var want = role == "user" ? Role.User : Role.Assistant;
                    if (messages.Count == 0 && want != Role.User) continue;
                    if (messages.Count > 0 && messages[messages.Count - 1].Role == want) continue;
                    messages.Add(new BetaMessageParam { Role = want, Content = content });
                }
                if (messages.Count > 0 && messages[messages.Count - 1].Role == Role.User) messages.RemoveAt(messages.Count - 1);
            }
            messages.Add(new BetaMessageParam
            {
                Role = Role.User,
                Content = "SCHEMA (OWNER.TABLE: columns)\n" + (string.IsNullOrWhiteSpace(schema) ? "(no cached schema matched — ask the user to load the schema browser first)" : schema) +
                          "\n\nQUESTION\n" + question
            });

            try
            {
                var client = new AnthropicClient { ApiKey = key };
                var resp = await client.Beta.Messages.Create(new MessageCreateParams
                {
                    Model = string.IsNullOrWhiteSpace(model) ? "claude-opus-5" : model,
                    MaxTokens = 16000,
                    System = SYSTEM_PROMPT,
                    Thinking = new BetaThinkingConfigAdaptive(),
                    OutputConfig = new BetaOutputConfig { Effort = Effort.High },
                    // Server-side refusal fallback: a declined request is re-served by Opus 4.8 in the same call
                    Betas = [AnthropicBeta.ServerSideFallback2026_06_01],
                    Fallbacks = new List<BetaFallbackParam> { new(Anthropic.Models.Messages.Model.ClaudeOpus4_8) },
                    Messages = messages,
                }, ct).ConfigureAwait(false);

                var sb = new StringBuilder();
                foreach (var block in resp.Content)
                    if (block.TryPickText(out var t)) sb.Append(t.Text);

                string stop = resp.StopReason?.ToString() ?? "";
                if (stop.IndexOf("refusal", StringComparison.OrdinalIgnoreCase) >= 0 && sb.Length == 0)
                    return (false, null, "Claude declined this request. Rephrase the question.");
                if (sb.Length == 0)
                    return (false, null, "Claude returned no text (stop reason: " + stop + ").");
                return (true, sb.ToString(), null);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[FusionSql AI] " + ex);
                return (false, null, "Claude API error: " + ex.Message);
            }
        }
    }
}
