using System.Reflection;
using System.Text.Json;

namespace FusionModel.Packs
{
    /// <summary>
    /// A ready-made slice of the model for one Oracle Fusion area: the module, its tables (Fusion SQL on the standard
    /// tables, keys, load strategy, column types and docs), relationships, measures, glossary and reconciliation checks.
    /// </summary>
    public sealed class PackDef
    {
        public string Id { get; set; }
        public string Version { get; set; }
        public string Title { get; set; }
        public string Area { get; set; }
        public string Description { get; set; }
        public ModuleDef Module { get; set; }
        public List<TableDef> Tables { get; set; } = new();
        public List<RelationshipDef> Relationships { get; set; } = new();
        public List<MeasureDef> Measures { get; set; } = new();
        public List<GlossaryTerm> Glossary { get; set; } = new();
        public List<CheckDef> Checks { get; set; } = new();
        /// <summary>What to confirm on the customer's pod before relying on the numbers.</summary>
        public List<string> Notes { get; set; } = new();
    }

    public sealed class PackApplyResult
    {
        public string Pack { get; set; }
        public List<string> Added { get; set; } = new();
        public List<string> Updated { get; set; } = new();
        public List<string> Kept { get; set; } = new();
    }

    public static class FusionPacks
    {
        private static List<PackDef> _all;

        /// <summary>The packs shipped with the engine (Packs/fusion-packs.json, embedded).</summary>
        public static List<PackDef> All
        {
            get
            {
                if (_all != null) return _all;
                var asm = typeof(FusionPacks).Assembly;
                string name = asm.GetManifestResourceNames().First(n => n.EndsWith("fusion-packs.json", StringComparison.OrdinalIgnoreCase));
                using var s = asm.GetManifestResourceStream(name)!;
                return _all = JsonSerializer.Deserialize<List<PackDef>>(s, Json.Options) ?? new();
            }
        }

        public static PackDef Get(string id) => All.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase));

        /// <summary>
        /// Adds the pack to the model. What is missing is added; what exists is kept as the customer changed it, unless
        /// <paramref name="overwrite"/> (then tables, measures, terms and checks of the pack are replaced by the shipped ones).
        /// </summary>
        public static PackApplyResult Apply(ModelDefinition m, PackDef p, bool overwrite = false)
        {
            var r = new PackApplyResult { Pack = p.Id };
            var clone = JsonSerializer.Deserialize<PackDef>(JsonSerializer.Serialize(p, Json.Options), Json.Options)!;   // never share objects with the catalog
            if (m.Module(clone.Module.Name) == null) { m.Modules.Add(clone.Module); r.Added.Add("module " + clone.Module.Name); }

            void Upsert<T>(List<T> list, T item, Func<T, bool> same, string label)
            {
                int i = list.FindIndex(x => same(x));
                if (i < 0) { list.Add(item); r.Added.Add(label); }
                else if (overwrite) { list[i] = item; r.Updated.Add(label); }
                else r.Kept.Add(label);
            }
            foreach (var t in clone.Tables)
                Upsert(m.Tables, t, x => Eq(x.Module, t.Module) && Eq(x.Name, t.Name), "table " + t.Module + "." + t.Name);
            foreach (var rel in clone.Relationships)
                Upsert(m.Relationships, rel, x => Eq(x.FromTable, rel.FromTable) && Eq(x.FromColumn, rel.FromColumn) && Eq(x.ToTable, rel.ToTable) && Eq(x.ToColumn, rel.ToColumn),
                       "relationship " + rel.FromTable + "[" + rel.FromColumn + "] → " + rel.ToTable);
            foreach (var ms in clone.Measures) Upsert(m.Measures, ms, x => Eq(x.Name, ms.Name), "measure [" + ms.Name + "]");
            foreach (var g in clone.Glossary) Upsert(m.Glossary, g, x => Eq(x.Term, g.Term), "term " + g.Term);
            foreach (var c in clone.Checks) Upsert(m.Checks, c, x => Eq(x.Name, c.Name), "check " + c.Name);
            m.Packs[p.Id] = p.Version;
            return r;
        }

        private static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }
}
