using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// Teach Me (teachme/index.html): the local copy of every lesson and every run in one DuckDB file
    /// (C:\fusion\teachme\teachme.duckdb; env TEACHME_ROOT for tests). The page saves each lesson here AND in APEX
    /// (WMS_TEACH_LESSONS) and keeps the newer copy when they differ (version). A lesson is a JSON document
    /// (subject, title, notes, start URL, recorded steps, variables, capture rule); a few fields are kept as columns
    /// so the list can be read without parsing every document.
    /// </summary>
    public static class TeachStore
    {
        private static readonly object _lock = new();
        private static DuckDBConnection _conn;

        public static string Root
        {
            get
            {
                var env = Environment.GetEnvironmentVariable("TEACHME_ROOT");
                return string.IsNullOrWhiteSpace(env) ? @"C:\fusion\teachme" : env;
            }
        }
        public static string DbPath => Path.Combine(Root, "teachme.duckdb");

        private static DuckDBConnection Conn()
        {
            if (_conn != null) return _conn;
            Directory.CreateDirectory(Root);
            var c = new DuckDBConnection("Data Source=" + DbPath);
            c.Open();
            Exec(c, "CREATE TABLE IF NOT EXISTS teach_lessons (id VARCHAR PRIMARY KEY, subject VARCHAR, title VARCHAR, kind VARCHAR, " +
                    "version INTEGER, doc_json VARCHAR, removed VARCHAR, created_by VARCHAR, created_at VARCHAR, changed_by VARCHAR, changed_at VARCHAR)");
            Exec(c, "CREATE TABLE IF NOT EXISTS teach_runs (id VARCHAR PRIMARY KEY, lesson_id VARCHAR, lesson_title VARCHAR, lesson_version INTEGER, " +
                    "run_by VARCHAR, started_at VARCHAR, finished_at VARCHAR, status VARCHAR, result VARCHAR, values_json VARCHAR, log_json VARCHAR)");
            _conn = c;
            return c;
        }

        private static void Exec(DuckDBConnection c, string sql)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }
        private static string Lit(string s) => s == null ? "NULL" : "'" + s.Replace("'", "''") + "'";
        private static string Now() => DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
        private static string S(JsonElement e, string n) =>
            e.TryGetProperty(n, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : v.GetRawText()) : null;
        private static int I(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.TryGetInt32(out var i) ? i : 0;

        /// <summary>Insert or replace one lesson (the whole JSON document). Returns the stored version.</summary>
        public static object Save(JsonElement lesson, string user)
        {
            string id = S(lesson, "id");
            if (string.IsNullOrWhiteSpace(id) || id.Length > 60) return new { ok = false, error = "The lesson has no id." };
            lock (_lock)
            {
                var c = Conn();
                string createdBy = user, createdAt = Now();
                using (var cmd = c.CreateCommand())
                {
                    cmd.CommandText = "SELECT created_by, created_at FROM teach_lessons WHERE id = " + Lit(id);
                    using var r = cmd.ExecuteReader();
                    if (r.Read()) { createdBy = r.IsDBNull(0) ? user : r.GetString(0); createdAt = r.IsDBNull(1) ? createdAt : r.GetString(1); }
                }
                Exec(c, "DELETE FROM teach_lessons WHERE id = " + Lit(id));
                Exec(c, "INSERT INTO teach_lessons VALUES (" + string.Join(", ", Lit(id), Lit(S(lesson, "subject")), Lit(S(lesson, "title")), Lit(S(lesson, "kind")),
                    I(lesson, "version").ToString(CultureInfo.InvariantCulture), Lit(lesson.GetRawText()), Lit(S(lesson, "removed") == "Y" ? "Y" : "N"),
                    Lit(createdBy), Lit(createdAt), Lit(user), Lit(Now())) + ")");
            }
            return new { ok = true, path = DbPath };
        }

        /// <summary>Every lesson (removed ones too, so a removal also wins over an older copy elsewhere).</summary>
        public static object List()
        {
            var list = new List<object>();
            lock (_lock)
            {
                using var cmd = Conn().CreateCommand();
                cmd.CommandText = "SELECT doc_json, version, removed, changed_by, changed_at FROM teach_lessons ORDER BY subject, title";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    if (r.IsDBNull(0)) continue;
                    try
                    {
                        list.Add(new
                        {
                            doc = JsonSerializer.Deserialize<JsonElement>(r.GetString(0)),
                            version = r.IsDBNull(1) ? 0 : Convert.ToInt32(r.GetValue(1)),
                            removed = !r.IsDBNull(2) && r.GetString(2) == "Y",
                            changedBy = r.IsDBNull(3) ? null : r.GetString(3),
                            changedAt = r.IsDBNull(4) ? null : r.GetString(4)
                        });
                    }
                    catch (JsonException) { }
                }
            }
            return new { ok = true, path = DbPath, lessons = list };
        }

        public static object SaveRun(JsonElement run, string user)
        {
            string id = S(run, "id");
            if (string.IsNullOrWhiteSpace(id) || id.Length > 60) return new { ok = false, error = "The run has no id." };
            lock (_lock)
            {
                var c = Conn();
                Exec(c, "DELETE FROM teach_runs WHERE id = " + Lit(id));
                Exec(c, "INSERT INTO teach_runs VALUES (" + string.Join(", ", Lit(id), Lit(S(run, "lessonId")), Lit(S(run, "lessonTitle")),
                    I(run, "lessonVersion").ToString(CultureInfo.InvariantCulture), Lit(S(run, "runBy") ?? user), Lit(S(run, "startedAt")), Lit(S(run, "finishedAt")),
                    Lit(S(run, "status")), Lit(S(run, "result")), Lit(S(run, "values")), Lit(S(run, "log"))) + ")");
            }
            return new { ok = true };
        }

        public static object Runs(string lessonId)
        {
            var list = new List<object>();
            lock (_lock)
            {
                using var cmd = Conn().CreateCommand();
                cmd.CommandText = "SELECT id, lesson_id, lesson_title, lesson_version, run_by, started_at, finished_at, status, result, values_json FROM teach_runs" +
                                  (string.IsNullOrWhiteSpace(lessonId) ? "" : " WHERE lesson_id = " + Lit(lessonId)) + " ORDER BY started_at DESC LIMIT 200";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    string Str(int i) => r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture);
                    list.Add(new { id = Str(0), lessonId = Str(1), lessonTitle = Str(2), lessonVersion = Str(3), runBy = Str(4), startedAt = Str(5), finishedAt = Str(6), status = Str(7), result = Str(8), values = Str(9) });
                }
            }
            return new { ok = true, runs = list };
        }
    }
}
