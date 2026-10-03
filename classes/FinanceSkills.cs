using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens skills: Markdown files with a small front matter (name, title, description, source, uses) that the CFO
    /// Copilot loads when a task needs them (finance\skills\ shipped with the app — adapted from Anthropic's Claude for
    /// Financial Services plugins, Apache-2.0, see finance\skills\NOTICE.md — plus custom ones an AI admin adds in the
    /// Finance Lens data folder, skills\*.md, which win over a shipped skill with the same name).
    /// </summary>
    public static class FinanceSkills
    {
        public sealed class Skill
        {
            public string Name { get; set; }
            public string Title { get; set; }
            public string Description { get; set; }
            public string Source { get; set; }          // anthropic-adapted | grays | custom
            public string Uses { get; set; }
            public string Body { get; set; }
            public bool Custom { get; set; }
        }

        private static readonly Regex NAME = new Regex("^[a-z0-9][a-z0-9-]{1,48}$");
        public static bool ValidName(string n) => !string.IsNullOrEmpty(n) && NAME.IsMatch(n);

        public static string BundledDir => Environment.GetEnvironmentVariable("FINANCE_LENS_SKILLS") is string d && d.Length > 0 ? d : Path.Combine(AppContext.BaseDirectory, "finance", "skills");   // env for tests
        public static string CustomDir => Path.Combine(FinanceLens.Root, "skills");

        public static Skill Parse(string text, string fallbackName, bool custom)
        {
            var s = new Skill { Name = fallbackName, Custom = custom, Source = custom ? "custom" : "grays", Body = text ?? "" };
            var m = Regex.Match(s.Body, @"^﻿?---\s*\r?\n(.*?)\r?\n---\s*\r?\n", RegexOptions.Singleline);
            if (m.Success)
            {
                foreach (var line in m.Groups[1].Value.Split('\n'))
                {
                    int i = line.IndexOf(':'); if (i <= 0) continue;
                    string k = line.Substring(0, i).Trim().ToLowerInvariant(), v = line.Substring(i + 1).Trim();
                    if (k == "name" && ValidName(v)) s.Name = v;
                    else if (k == "title") s.Title = v;
                    else if (k == "description") s.Description = v;
                    else if (k == "source" && !custom) s.Source = v;
                    else if (k == "uses") s.Uses = v;
                }
                s.Body = s.Body.Substring(m.Length);
            }
            s.Title ??= s.Name;
            s.Description ??= "";
            return s;
        }

        /// <summary>Every skill: shipped ones, then custom ones replacing a shipped one with the same name.</summary>
        public static List<Skill> List()
        {
            var all = new Dictionary<string, Skill>(StringComparer.OrdinalIgnoreCase);
            foreach (var (dir, custom) in new[] { (BundledDir, false), (CustomDir, true) })
            {
                try
                {
                    if (!Directory.Exists(dir)) continue;
                    foreach (var f in Directory.GetFiles(dir, "*.md").OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
                    {
                        string n = Path.GetFileNameWithoutExtension(f).ToLowerInvariant();
                        if (n == "notice" || n == "readme" || !ValidName(n)) continue;
                        var info = new FileInfo(f); if (info.Length > 200_000) continue;
                        all[n] = Parse(File.ReadAllText(f), n, custom);
                    }
                }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[Finance skills] " + dir + ": " + ex.Message); }
            }
            return all.Values.OrderBy(s => s.Custom).ThenBy(s => s.Name).ToList();
        }

        public static Skill Get(string name)
        {
            if (!ValidName((name ?? "").Trim().ToLowerInvariant())) return null;
            return List().FirstOrDefault(s => string.Equals(s.Name, name.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>The skills index for the system prompt</summary>
        public static string Index()
        {
            var sb = new StringBuilder();
            foreach (var s in List()) sb.Append("- ").Append(s.Name).Append(" — ").Append(s.Description).Append('\n');
            return sb.ToString();
        }

        public static void SaveCustom(string name, string text)
        {
            if (!ValidName(name)) throw new ArgumentException("A skill name is 2-49 lower-case letters, digits and dashes.");
            if ((text ?? "").Length > 100_000) throw new ArgumentException("The skill is too long (100,000 characters at most).");
            Directory.CreateDirectory(CustomDir);
            string f = Path.Combine(CustomDir, name + ".md");
            File.WriteAllText(f + ".tmp", text ?? "", new UTF8Encoding(false));
            File.Move(f + ".tmp", f, true);
        }

        public static bool DeleteCustom(string name)
        {
            if (!ValidName(name)) return false;
            string f = Path.Combine(CustomDir, name + ".md");
            if (!File.Exists(f)) return false;
            File.Delete(f);
            return true;
        }
    }
}
