using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace WMSApp
{
    /// <summary>
    /// Reads a DLL/EXE without loading or running it and describes what it can do.
    /// .NET assemblies: every namespace, type and member with its signature (System.Reflection.Metadata),
    /// XML-doc summaries when the .xml sits next to the DLL, the assemblies it references, the Windows APIs
    /// it calls through P/Invoke, the URLs / SQL / paths hard-coded in it and any [AiAction] methods.
    /// Native DLLs: version resource, exported functions and the Windows DLLs + functions it imports.
    /// Both get a capability fingerprint (HTTP, database, printing, registry, crypto …) with the evidence.
    /// Decompile() turns one type or member back into C# (ICSharpCode.Decompiler).
    /// Cross-platform on purpose (no WinForms) so it can be tested outside the app.
    /// </summary>
    public static class DllInspector
    {
        public const long MAX_FILE_BYTES = 300L * 1024 * 1024;
        public const int MAX_MEMBERS = 80000;
        public const int MAX_STRINGS_PER_KIND = 150;

        // ------------------------------------------------------------------ report model
        public class DllReport
        {
            public string File { get; set; }
            public string FileName { get; set; }
            public long Size { get; set; }
            public string Sha256 { get; set; }
            public DateTime Modified { get; set; }
            public string Kind { get; set; }                 // managed | mixed | native
            public string Machine { get; set; }              // AnyCPU | x86 | x64 | ARM64 …
            public string Subsystem { get; set; }
            public bool IsExe { get; set; }
            public Dictionary<string, string> Version { get; set; } = new Dictionary<string, string>();
            public AssemblyInfo Assembly { get; set; }
            public List<string> References { get; set; } = new List<string>();
            public List<ImportModule> Imports { get; set; } = new List<ImportModule>();   // native imports + P/Invoke
            public List<ExportFn> Exports { get; set; } = new List<ExportFn>();
            public int ExportsTotal { get; set; }
            public List<Capability> Capabilities { get; set; } = new List<Capability>();
            public List<NamespaceInfo> Namespaces { get; set; } = new List<NamespaceInfo>();
            public List<AiActionInfo> AiActions { get; set; } = new List<AiActionInfo>();
            public Dictionary<string, List<string>> Strings { get; set; } = new Dictionary<string, List<string>>();
            public List<string> Resources { get; set; } = new List<string>();
            public Dictionary<string, List<string>> Forwards { get; set; } = new Dictionary<string, List<string>>();
            public List<string> Warnings { get; set; } = new List<string>();
            public Stats Stats { get; set; } = new Stats();
            public bool HasXmlDocs { get; set; }
            public bool Truncated { get; set; }
        }
        public class AssemblyInfo
        {
            public string Name { get; set; }
            public string Version { get; set; }
            public string TargetFramework { get; set; }
            public string PublicKeyToken { get; set; }
            public bool ReferenceAssembly { get; set; }
            public Dictionary<string, string> Attributes { get; set; } = new Dictionary<string, string>();
        }
        public class Stats
        {
            public int Types { get; set; }
            public int PublicTypes { get; set; }
            public int Methods { get; set; }
            public int Properties { get; set; }
            public int Members { get; set; }
            public int PInvokes { get; set; }
        }
        public class NamespaceInfo
        {
            public string Name { get; set; }
            public List<TypeInfo> Types { get; set; } = new List<TypeInfo>();
        }
        public class TypeInfo
        {
            public string Id { get; set; }                   // reflection name (Outer+Inner) - what Decompile() takes
            public string Name { get; set; }
            public string Kind { get; set; }                 // class | static class | interface | struct | enum | delegate
            public string Access { get; set; }               // public | internal
            public string Base { get; set; }
            public List<string> Interfaces { get; set; }
            public List<string> Attributes { get; set; }
            public string Summary { get; set; }
            public List<MemberInfo> Members { get; set; } = new List<MemberInfo>();
        }
        public class MemberInfo
        {
            public string Kind { get; set; }                 // ctor | method | property | event | field | value
            public string Name { get; set; }
            public string Signature { get; set; }
            public string Access { get; set; }
            public bool Static { get; set; }
            public bool Async { get; set; }
            public string Summary { get; set; }
        }
        public class ImportModule
        {
            public string Dll { get; set; }
            public string Via { get; set; }                  // import | delay | pinvoke
            public List<string> Functions { get; set; } = new List<string>();
        }
        public class ExportFn
        {
            public int Ordinal { get; set; }
            public string Name { get; set; }
            public string Forward { get; set; }
        }
        public class Capability
        {
            public string Name { get; set; }
            public string Icon { get; set; }
            public List<string> Evidence { get; set; } = new List<string>();
        }
        public class AiActionInfo
        {
            public string Type { get; set; }
            public string Method { get; set; }
            public string Signature { get; set; }
            public string Description { get; set; }
            public bool RequiresApproval { get; set; } = true;
        }

        // ------------------------------------------------------------------ inspect
        public static DllReport Inspect(string path, bool includeNonPublic = false)
        {
            var fi = new FileInfo(path);
            if (!fi.Exists) throw new FileNotFoundException("File not found: " + path);
            if (fi.Length > MAX_FILE_BYTES) throw new InvalidOperationException("File is larger than " + (MAX_FILE_BYTES >> 20) + " MB");
            byte[] bytes = System.IO.File.ReadAllBytes(path);
            if (bytes.Length < 64 || bytes[0] != 'M' || bytes[1] != 'Z') throw new InvalidOperationException("Not a Windows DLL/EXE (no MZ header)");

            var r = new DllReport
            {
                File = fi.FullName, FileName = fi.Name, Size = fi.Length, Modified = fi.LastWriteTime,
                Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
            };
            using (var pe = new PEReader(ImmutableArray.Create(bytes)))
            {
                var h = pe.PEHeaders;
                if (h.PEHeader == null) throw new InvalidOperationException("Not a PE image");
                bool managed = h.CorHeader != null && pe.HasMetadata;
                bool ilOnly = managed && (h.CorHeader.Flags & CorFlags.ILOnly) != 0;
                r.Kind = !managed ? "native" : ilOnly ? "managed" : "mixed";
                r.IsExe = (h.CoffHeader.Characteristics & Characteristics.Dll) == 0;
                r.Subsystem = h.PEHeader.Subsystem.ToString();
                r.Machine = MachineName(h, managed);

                try { ReadVersionResource(pe, r); } catch (Exception ex) { r.Warnings.Add("Version resource unreadable: " + ex.Message); }
                try { ReadNativeImports(pe, r); } catch (Exception ex) { r.Warnings.Add("Import table unreadable: " + ex.Message); }
                try { ReadExports(pe, r); } catch (Exception ex) { r.Warnings.Add("Export table unreadable: " + ex.Message); }

                if (managed)
                {
                    r.Imports.RemoveAll(i => i.Dll.Equals("mscoree.dll", StringComparison.OrdinalIgnoreCase));  // every .NET DLL has it
                    var md = pe.GetMetadataReader();
                    ReadManaged(md, r, path, includeNonPublic);
                }
                else
                {
                    ScanNativeStrings(bytes, r);
                    if (r.Exports.Count == 0 && !r.IsExe) r.Warnings.Add("Native DLL with no named exports - it is probably a COM server or resource DLL.");
                    r.Warnings.Add("Native code: only the exported/imported function names, version info and embedded strings are visible - the logic itself is machine code.");
                }
            }
            r.Capabilities = Fingerprint(r);
            return r;
        }

        private static string MachineName(PEHeaders h, bool managed)
        {
            var m = h.CoffHeader.Machine;
            if (managed && m == Machine.I386 && (h.CorHeader.Flags & CorFlags.Requires32Bit) == 0 && (h.CorHeader.Flags & CorFlags.ILOnly) != 0)
                return (h.CorHeader.Flags & CorFlags.Prefers32Bit) != 0 ? "AnyCPU (32-bit preferred)" : "AnyCPU";
            switch (m)
            {
                case Machine.I386: return "x86";
                case Machine.Amd64: return "x64";
                case Machine.Arm64: return "ARM64";
                case Machine.Arm: case Machine.ArmThumb2: return "ARM";
                case Machine.IA64: return "IA64";
                default: return m.ToString();
            }
        }

        // ------------------------------------------------------------------ managed
        private static void ReadManaged(MetadataReader md, DllReport r, string path, bool includeNonPublic)
        {
            var prov = new SigProvider(md);
            var docs = LoadXmlDocs(path);
            r.HasXmlDocs = docs.Count > 0;

            if (md.IsAssembly)
            {
                var asm = md.GetAssemblyDefinition();
                var ai = new AssemblyInfo { Name = md.GetString(asm.Name), Version = asm.Version.ToString() };
                var pk = md.GetBlobBytes(asm.PublicKey);
                if (pk.Length > 0)
                {
                    var hash = SHA1.HashData(pk);
                    ai.PublicKeyToken = Convert.ToHexString(hash.Skip(hash.Length - 8).Reverse().ToArray()).ToLowerInvariant();
                }
                foreach (var ch in asm.GetCustomAttributes())
                {
                    var ca = md.GetCustomAttribute(ch);
                    string an = AttrName(md, ca);
                    if (an == null) continue;
                    if (an == "ReferenceAssemblyAttribute") { ai.ReferenceAssembly = true; continue; }
                    if (an == "TargetFrameworkAttribute")
                    {
                        var v = DecodeAttr(ca);
                        if (v != null) ai.TargetFramework = v.Value.NamedArguments.Where(n => n.Name == "FrameworkDisplayName").Select(n => n.Value as string).FirstOrDefault(s => !string.IsNullOrEmpty(s))
                                                             ?? (v.Value.FixedArguments.Length > 0 ? v.Value.FixedArguments[0].Value as string : null);
                        continue;
                    }
                    if (!an.StartsWith("Assembly")) continue;
                    var d = DecodeAttr(ca);
                    if (d == null || d.Value.FixedArguments.Length == 0 || !(d.Value.FixedArguments[0].Value is string sv)) continue;
                    string key = an.Substring(8, an.Length - 8 - 9);          // AssemblyTitleAttribute -> Title
                    if (key.Length > 0 && !ai.Attributes.ContainsKey(key)) ai.Attributes[key] = sv;
                }
                r.Assembly = ai;
                if (ai.ReferenceAssembly) r.Warnings.Add("Reference assembly: it has the signatures but no code (the real code is in the runtime's copy).");
            }

            foreach (var rh in md.AssemblyReferences)
            {
                var ar = md.GetAssemblyReference(rh);
                r.References.Add(md.GetString(ar.Name) + " " + ar.Version);
            }
            r.References.Sort(StringComparer.OrdinalIgnoreCase);
            foreach (var mh in md.ManifestResources) r.Resources.Add(md.GetString(md.GetManifestResource(mh).Name));
            // Type forwarders - a facade DLL (e.g. System.Drawing.dll) only points to where its types really live
            int fwd = 0;
            foreach (var eh in md.ExportedTypes)
            {
                var et = md.GetExportedType(eh);
                if (!et.IsForwarder || et.Implementation.Kind != HandleKind.AssemblyReference) continue;
                string to = md.GetString(md.GetAssemblyReference((AssemblyReferenceHandle)et.Implementation).Name);
                if (!r.Forwards.TryGetValue(to, out var fl)) r.Forwards[to] = fl = new List<string>();
                string ns = md.GetString(et.Namespace);
                fl.Add((ns.Length > 0 ? ns + "." : "") + md.GetString(et.Name));
                fwd++;
            }
            if (fwd > 0) r.Warnings.Add("Facade: " + fwd + " types are forwarded to " + string.Join(", ", r.Forwards.Keys) + " - inspect that DLL for the real code.");

            // P/Invoke - the Windows APIs the managed code calls directly
            var pinv = new Dictionary<string, ImportModule>(StringComparer.OrdinalIgnoreCase);
            foreach (var mh in md.MethodDefinitions)
            {
                var m = md.GetMethodDefinition(mh);
                if ((m.Attributes & MethodAttributes.PinvokeImpl) == 0) continue;
                var imp = m.GetImport();
                if (imp.Module.IsNil) continue;
                string dll = md.GetString(md.GetModuleReference(imp.Module).Name);
                string entry = imp.Name.IsNil ? md.GetString(m.Name) : md.GetString(imp.Name);
                if (!pinv.TryGetValue(dll, out var im)) pinv[dll] = im = new ImportModule { Dll = dll, Via = "pinvoke" };
                if (!im.Functions.Contains(entry)) im.Functions.Add(entry);
                r.Stats.PInvokes++;
            }
            foreach (var im in pinv.Values.OrderBy(x => x.Dll, StringComparer.OrdinalIgnoreCase)) { im.Functions.Sort(StringComparer.Ordinal); r.Imports.Add(im); }

            // Types
            var nsMap = new SortedDictionary<string, NamespaceInfo>(StringComparer.Ordinal);
            int shortNames = 0, named = 0;
            foreach (var th in md.TypeDefinitions)
            {
                var td = md.GetTypeDefinition(th);
                string name = md.GetString(td.Name);
                if (name == "<Module>" || name.StartsWith("<") || name.Contains("<>") || name.StartsWith("__")) continue;
                r.Stats.Types++;
                named++;
                if (name.Length <= 2 || !Regex.IsMatch(name, @"^[A-Za-z_][A-Za-z0-9_`]*$")) shortNames++;
                bool isPublic = TypeIsPublic(md, td);
                if (isPublic) r.Stats.PublicTypes++;
                if (!isPublic && !includeNonPublic) continue;
                if (r.Stats.Members > MAX_MEMBERS) { r.Truncated = true; continue; }

                var ti = BuildType(md, prov, th, td, docs, r, includeNonPublic);
                string ns = OuterNamespace(md, td);
                if (!nsMap.TryGetValue(ns, out var nsi)) nsMap[ns] = nsi = new NamespaceInfo { Name = ns.Length == 0 ? "(global)" : ns };
                nsi.Types.Add(ti);
            }
            foreach (var n in nsMap.Values) { n.Types.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id)); r.Namespaces.Add(n); }
            if (named > 20 && shortNames > named * 0.3)
                r.Warnings.Add("Looks obfuscated: " + shortNames + " of " + named + " type names are 1-2 characters or unreadable - decompiled code will be hard to follow.");
            if (r.Truncated) r.Warnings.Add("Very large assembly - member lists stop after " + MAX_MEMBERS + " members; decompile a type to see the rest.");
            if (!includeNonPublic && r.Stats.PublicTypes == 0 && r.Stats.Types > 0)
                r.Warnings.Add("No public types - tick \"Include internal\" to see the " + r.Stats.Types + " internal types.");

            // Hard-coded strings: URLs, SQL, paths, registry keys, Fusion/APEX endpoints
            var h = MetadataTokens.UserStringHandle(1);
            int guard = 0;
            while (!h.IsNil && guard++ < 500000)
            {
                string s;
                try { s = md.GetUserString(h); } catch { break; }
                AddString(r, s);
                h = md.GetNextHandle(h);
            }
            // Type references = the framework / library APIs this code uses (feeds the fingerprint)
            var used = new HashSet<string>(StringComparer.Ordinal);
            foreach (var trh in md.TypeReferences)
            {
                var tr = md.GetTypeReference(trh);
                string ns = md.GetString(tr.Namespace);
                if (ns.Length > 0) used.Add(ns + "." + md.GetString(tr.Name));
            }
            _usedTypes = used;
        }

        [ThreadStatic] private static HashSet<string> _usedTypes;

        private static TypeInfo BuildType(MetadataReader md, SigProvider prov, TypeDefinitionHandle th, TypeDefinition td,
            Dictionary<string, string> docs, DllReport r, bool includeNonPublic)
        {
            var gen = new GenericCtx(td.GetGenericParameters().Select(g => md.GetString(md.GetGenericParameter(g).Name)).ToArray(), null);
            string reflName = ReflectionName(md, td);
            string display = DisplayName(md, td, gen);
            string baseName = td.BaseType.IsNil ? null : prov.EntityName(td.BaseType, gen);
            var attrs = td.Attributes;
            if (baseName == "object") baseName = "Object";
            string kind = (attrs & TypeAttributes.Interface) != 0 ? "interface"
                : baseName == "Enum" ? "enum"
                : baseName == "ValueType" ? "struct"
                : baseName == "MulticastDelegate" ? "delegate"
                : (attrs & TypeAttributes.Abstract) != 0 && (attrs & TypeAttributes.Sealed) != 0 ? "static class"
                : (attrs & TypeAttributes.Abstract) != 0 ? "abstract class" : "class";
            var ti = new TypeInfo
            {
                Id = reflName, Name = display, Kind = kind,
                Access = TypeIsPublic(md, td) ? "public" : "internal",
                Base = kind == "class" || kind == "abstract class" ? (baseName == "Object" ? null : baseName) : null,
                Summary = Doc(docs, "T:" + reflName.Replace('+', '.'))
            };
            var ifs = td.GetInterfaceImplementations().Select(i => prov.EntityName(md.GetInterfaceImplementation(i).Interface, gen)).Where(x => x != null).ToList();
            if (ifs.Count > 0) ti.Interfaces = ifs;
            var tattrs = AttrList(md, td.GetCustomAttributes());
            if (tattrs.Count > 0) ti.Attributes = tattrs;
            string docPrefix = reflName.Replace('+', '.');

            if (kind == "enum")
            {
                foreach (var fh in td.GetFields())
                {
                    var f = md.GetFieldDefinition(fh);
                    string fn = md.GetString(f.Name);
                    if (fn == "value__") continue;
                    object val = null;
                    try { var c = f.GetDefaultValue(); if (!c.IsNil) val = ConstValue(md, md.GetConstant(c)); } catch { }
                    ti.Members.Add(new MemberInfo { Kind = "value", Name = fn, Signature = val == null ? fn : fn + " = " + val, Access = "public", Static = true });
                    r.Stats.Members++;
                }
                return ti;
            }
            if (kind == "delegate")
            {
                foreach (var mh in td.GetMethods())
                {
                    var m = md.GetMethodDefinition(mh);
                    if (md.GetString(m.Name) != "Invoke") continue;
                    ti.Members.Add(new MemberInfo { Kind = "method", Name = "Invoke", Signature = MethodSig(md, prov, m, gen, "Invoke"), Access = "public" });
                    r.Stats.Members++;
                }
                return ti;
            }

            // properties + events first (their accessors are skipped among the methods)
            foreach (var ph in td.GetProperties())
            {
                var p = md.GetPropertyDefinition(ph);
                var acc = p.GetAccessors();
                var getter = acc.Getter.IsNil ? (MethodDefinition?)null : md.GetMethodDefinition(acc.Getter);
                var setter = acc.Setter.IsNil ? (MethodDefinition?)null : md.GetMethodDefinition(acc.Setter);
                var any = getter ?? setter;
                if (any == null) continue;
                string access = BestAccess(getter, setter);
                if (!Visible(access, includeNonPublic)) continue;
                string pn = md.GetString(p.Name);
                string sig;
                try
                {
                    var ps = p.DecodeSignature(prov, gen);
                    string idx = ps.ParameterTypes.Length > 0 ? "this[" + string.Join(", ", ps.ParameterTypes) + "]" : pn;
                    bool pubSet = setter != null && Access(setter.Value.Attributes) == access;
                    sig = ps.ReturnType + " " + idx + " { " + (getter != null ? "get; " : "") + (setter != null ? (pubSet ? "set; " : "private set; ") : "") + "}";
                }
                catch { sig = pn; }
                ti.Members.Add(new MemberInfo
                {
                    Kind = "property", Name = pn, Signature = sig, Access = access,
                    Static = (any.Value.Attributes & MethodAttributes.Static) != 0,
                    Summary = Doc(docs, "P:" + docPrefix + "." + pn)
                });
                r.Stats.Properties++; r.Stats.Members++;
            }
            foreach (var eh in td.GetEvents())
            {
                var e = md.GetEventDefinition(eh);
                var add = e.GetAccessors().Adder;
                if (add.IsNil) continue;
                var am = md.GetMethodDefinition(add);
                string access = Access(am.Attributes);
                if (!Visible(access, includeNonPublic)) continue;
                string en = md.GetString(e.Name);
                ti.Members.Add(new MemberInfo
                {
                    Kind = "event", Name = en, Signature = "event " + prov.EntityName(e.Type, gen) + " " + en, Access = access,
                    Static = (am.Attributes & MethodAttributes.Static) != 0, Summary = Doc(docs, "E:" + docPrefix + "." + en)
                });
                r.Stats.Members++;
            }
            foreach (var mh in td.GetMethods())
            {
                var m = md.GetMethodDefinition(mh);
                string mn = md.GetString(m.Name);
                var ma = m.Attributes;
                if ((ma & MethodAttributes.SpecialName) != 0 && (mn.StartsWith("get_") || mn.StartsWith("set_") || mn.StartsWith("add_") || mn.StartsWith("remove_") || mn.StartsWith("raise_"))) continue;
                if (mn.Contains("<")) continue;
                if (mn == ".cctor") continue;
                string access = Access(ma);
                bool isPinvoke = (ma & MethodAttributes.PinvokeImpl) != 0;
                var mattrs = AttrList(md, m.GetCustomAttributes());
                bool isAsync = mattrs.Remove("AsyncStateMachine");
                // [AiAction("…", RequiresApproval = …)] - a method the chat may offer to run (always through an approval card)
                foreach (var ch in m.GetCustomAttributes())
                {
                    var ca = md.GetCustomAttribute(ch);
                    if (AttrName(md, ca) != "AiActionAttribute") continue;
                    var d = DecodeAttr(ca);
                    var act = new AiActionInfo { Type = reflName, Method = mn, Signature = MethodSig(md, prov, m, gen, mn) };
                    if (d != null)
                    {
                        if (d.Value.FixedArguments.Length > 0) act.Description = d.Value.FixedArguments[0].Value as string;
                        foreach (var na in d.Value.NamedArguments)
                        {
                            if (na.Name == "Description" && na.Value is string ds) act.Description = ds;
                            if (na.Name == "RequiresApproval" && na.Value is bool rb) act.RequiresApproval = rb;
                        }
                    }
                    r.AiActions.Add(act);
                }
                if (!Visible(access, includeNonPublic) || isPinvoke && !includeNonPublic) continue;
                bool ctor = mn == ".ctor";
                string mDisplay = ctor ? ti.Name.Split('<')[0].Split('.').Last() : mn;
                r.Stats.Methods++; r.Stats.Members++;
                string summaryKey = "M:" + docPrefix + "." + (ctor ? "#ctor" : mn);
                ti.Members.Add(new MemberInfo
                {
                    Kind = ctor ? "ctor" : mn.StartsWith("op_") ? "operator" : "method",
                    Name = mDisplay,
                    Signature = MethodSig(md, prov, m, gen, mDisplay, ctor) + (mattrs.Count > 0 ? "  [" + string.Join(", ", mattrs) + "]" : ""),
                    Access = access,
                    Static = (ma & MethodAttributes.Static) != 0,
                    Async = isAsync,
                    Summary = Doc(docs, summaryKey)
                });
            }
            foreach (var fh in td.GetFields())
            {
                var f = md.GetFieldDefinition(fh);
                string access = FieldAccess(f.Attributes);
                if (!Visible(access, includeNonPublic)) continue;
                string fn = md.GetString(f.Name);
                if (fn.Contains("<")) continue;
                string type;
                try { type = f.DecodeSignature(prov, gen); } catch { type = "?"; }
                bool isConst = (f.Attributes & FieldAttributes.Literal) != 0;
                string sig = (isConst ? "const " : (f.Attributes & FieldAttributes.InitOnly) != 0 ? "readonly " : "") + type + " " + fn;
                if (isConst)
                {
                    try { var c = f.GetDefaultValue(); if (!c.IsNil) { var v = ConstValue(md, md.GetConstant(c)); if (v != null) sig += " = " + (v is string sv ? "\"" + Trunc(sv, 200) + "\"" : v.ToString()); sig = Redact(sig); } } catch { }
                }
                ti.Members.Add(new MemberInfo
                {
                    Kind = "field", Name = fn, Signature = sig, Access = access,
                    Static = (f.Attributes & FieldAttributes.Static) != 0, Summary = Doc(docs, "F:" + docPrefix + "." + fn)
                });
                r.Stats.Members++;
            }
            return ti;
        }

        private static string MethodSig(MetadataReader md, SigProvider prov, MethodDefinition m, GenericCtx typeCtx, string display, bool ctor = false)
        {
            var mg = m.GetGenericParameters().Select(g => md.GetString(md.GetGenericParameter(g).Name)).ToArray();
            var ctx = new GenericCtx(typeCtx.TypeParams, mg);
            MethodSignature<string> sig;
            try { sig = m.DecodeSignature(prov, ctx); } catch { return display + "(…)"; }
            var names = new Dictionary<int, string>();
            foreach (var ph in m.GetParameters())
            {
                var p = md.GetParameter(ph);
                if (p.SequenceNumber > 0) names[p.SequenceNumber] = md.GetString(p.Name);
            }
            var ps = new List<string>();
            for (int i = 0; i < sig.ParameterTypes.Length; i++)
                ps.Add(sig.ParameterTypes[i] + (names.TryGetValue(i + 1, out var n) && n.Length > 0 ? " " + n : ""));
            string gen = mg.Length > 0 ? "<" + string.Join(", ", mg) + ">" : "";
            return (ctor ? "" : sig.ReturnType + " ") + display + gen + "(" + string.Join(", ", ps) + ")";
        }

        private static bool TypeIsPublic(MetadataReader md, TypeDefinition td)
        {
            var vis = td.Attributes & TypeAttributes.VisibilityMask;
            if (vis == TypeAttributes.Public) return true;
            if (vis == TypeAttributes.NestedPublic || vis == TypeAttributes.NestedFamily || vis == TypeAttributes.NestedFamORAssem)
                return TypeIsPublic(md, md.GetTypeDefinition(td.GetDeclaringType()));
            return false;
        }
        private static string OuterNamespace(MetadataReader md, TypeDefinition td)
        {
            while (!td.GetDeclaringType().IsNil) td = md.GetTypeDefinition(td.GetDeclaringType());
            return md.GetString(td.Namespace);
        }
        private static string ReflectionName(MetadataReader md, TypeDefinition td)
        {
            string n = md.GetString(td.Name);
            var dt = td.GetDeclaringType();
            if (!dt.IsNil) return ReflectionName(md, md.GetTypeDefinition(dt)) + "+" + n;
            string ns = md.GetString(td.Namespace);
            return ns.Length > 0 ? ns + "." + n : n;
        }
        private static string DisplayName(MetadataReader md, TypeDefinition td, GenericCtx gen)
        {
            string n = StripArity(md.GetString(td.Name));
            var dt = td.GetDeclaringType();
            string outer = dt.IsNil ? "" : StripGenericArgs(DisplayName(md, md.GetTypeDefinition(dt), gen)) + ".";
            int own = CountArity(md.GetString(td.Name));
            if (own > 0 && gen.TypeParams != null && gen.TypeParams.Length >= own)
                n += "<" + string.Join(", ", gen.TypeParams.Skip(gen.TypeParams.Length - own)) + ">";
            return outer + n;
        }
        private static string StripGenericArgs(string s) { int i = s.IndexOf('<'); return i < 0 ? s : s.Substring(0, i); }
        internal static string StripArity(string s) { int i = s.IndexOf('`'); return i < 0 ? s : s.Substring(0, i); }
        private static int CountArity(string s) { int i = s.IndexOf('`'); return i < 0 ? 0 : int.TryParse(s.Substring(i + 1), out var k) ? k : 0; }

        private static string Access(MethodAttributes a)
        {
            switch (a & MethodAttributes.MemberAccessMask)
            {
                case MethodAttributes.Public: return "public";
                case MethodAttributes.Family: case MethodAttributes.FamORAssem: return "protected";
                case MethodAttributes.Assembly: case MethodAttributes.FamANDAssem: return "internal";
                default: return "private";
            }
        }
        private static string FieldAccess(FieldAttributes a)
        {
            switch (a & FieldAttributes.FieldAccessMask)
            {
                case FieldAttributes.Public: return "public";
                case FieldAttributes.Family: case FieldAttributes.FamORAssem: return "protected";
                case FieldAttributes.Assembly: case FieldAttributes.FamANDAssem: return "internal";
                default: return "private";
            }
        }
        private static readonly string[] ACCESS_RANK = { "private", "internal", "protected", "public" };
        private static string BestAccess(MethodDefinition? g, MethodDefinition? s)
        {
            string a = g != null ? Access(g.Value.Attributes) : "private", b = s != null ? Access(s.Value.Attributes) : "private";
            return Array.IndexOf(ACCESS_RANK, a) >= Array.IndexOf(ACCESS_RANK, b) ? a : b;
        }
        private static bool Visible(string access, bool includeNonPublic) => includeNonPublic || access == "public" || access == "protected";

        private static readonly HashSet<string> NOISE_ATTRS = new HashSet<string>(StringComparer.Ordinal)
        {
            "Nullable", "NullableContext", "CompilerGenerated", "IsReadOnly", "DebuggerStepThrough", "DebuggerHidden",
            "DebuggerBrowsable", "DebuggerNonUserCode", "DebuggerDisplay", "EditorBrowsable", "IsByRefLike", "__DynamicallyInvokable",
            "TargetedPatchingOptOut", "NonVersionable", "Intrinsic", "MethodImpl", "SecuritySafeCritical", "SecurityCritical",
            "DynamicDependency", "RequiresUnreferencedCode", "UnconditionalSuppressMessage", "RequiresDynamicCode", "DynamicallyAccessedMembers",
            "RefSafetyRules", "ScopedRef", "NullablePublicOnly", "Extension", "ParamCollection", "IteratorStateMachine", "AsyncIteratorStateMachine",
            "SupportedOSPlatform", "UnsupportedOSPlatform", "ExcludeFromCodeCoverage", "SuppressGCTransition", "SkipLocalsInit", "StackTraceHidden",
            "DefaultMember", "Serializable", "StructLayout", "ComVisible", "TypeForwardedFrom", "Localizable", "DesignerSerializationVisibility",
            "SRCategory", "SRDescription", "Browsable", "Designer", "ToolboxItem", "DefaultEvent", "DefaultProperty", "DefaultValue", "Bindable",
            "AmbientValue", "RefreshProperties", "MergableProperty", "TypeConverter", "Editor", "ParenthesizePropertyName", "NotifyParentProperty",
            "DispId", "Guid", "InterfaceType", "ComImport", "ClassInterface", "CoClass", "PreserveSig", "MarshalAs", "LibraryImport", "UnmanagedCallersOnly"
        };
        private static List<string> AttrList(MetadataReader md, CustomAttributeHandleCollection hs)
        {
            var list = new List<string>();
            foreach (var ch in hs)
            {
                string n = AttrName(md, md.GetCustomAttribute(ch));
                if (n == null) continue;
                if (n.EndsWith("Attribute")) n = n.Substring(0, n.Length - 9);
                if (NOISE_ATTRS.Contains(n) || list.Contains(n)) continue;
                list.Add(n);
            }
            return list;
        }
        private static string AttrName(MetadataReader md, CustomAttribute ca)
        {
            try
            {
                EntityHandle parent;
                if (ca.Constructor.Kind == HandleKind.MemberReference) parent = md.GetMemberReference((MemberReferenceHandle)ca.Constructor).Parent;
                else if (ca.Constructor.Kind == HandleKind.MethodDefinition) parent = md.GetMethodDefinition((MethodDefinitionHandle)ca.Constructor).GetDeclaringType();
                else return null;
                if (parent.Kind == HandleKind.TypeReference) return md.GetString(md.GetTypeReference((TypeReferenceHandle)parent).Name);
                if (parent.Kind == HandleKind.TypeDefinition) return md.GetString(md.GetTypeDefinition((TypeDefinitionHandle)parent).Name);
            }
            catch { }
            return null;
        }
        private static CustomAttributeValue<object>? DecodeAttr(CustomAttribute ca)
        {
            try { return ca.DecodeValue(new AttrProvider()); } catch { return null; }
        }

        private static object ConstValue(MetadataReader md, Constant c)
        {
            var br = md.GetBlobReader(c.Value);
            switch (c.TypeCode)
            {
                case ConstantTypeCode.Boolean: return br.ReadBoolean();
                case ConstantTypeCode.Char: return br.ReadChar();
                case ConstantTypeCode.SByte: return br.ReadSByte();
                case ConstantTypeCode.Byte: return br.ReadByte();
                case ConstantTypeCode.Int16: return br.ReadInt16();
                case ConstantTypeCode.UInt16: return br.ReadUInt16();
                case ConstantTypeCode.Int32: return br.ReadInt32();
                case ConstantTypeCode.UInt32: return br.ReadUInt32();
                case ConstantTypeCode.Int64: return br.ReadInt64();
                case ConstantTypeCode.UInt64: return br.ReadUInt64();
                case ConstantTypeCode.Single: return br.ReadSingle();
                case ConstantTypeCode.Double: return br.ReadDouble();
                case ConstantTypeCode.String: return br.ReadUTF16(br.Length);
                default: return null;
            }
        }

        private static Dictionary<string, string> LoadXmlDocs(string path)
        {
            var d = new Dictionary<string, string>(StringComparer.Ordinal);
            try
            {
                string xml = Path.ChangeExtension(path, ".xml");
                if (!System.IO.File.Exists(xml) || new FileInfo(xml).Length > 50L * 1024 * 1024) return d;
                var doc = XDocument.Load(xml);
                foreach (var m in doc.Descendants("member"))
                {
                    string name = (string)m.Attribute("name");
                    var sum = m.Element("summary");
                    if (name == null || sum == null) continue;
                    string text = Regex.Replace(string.Concat(sum.Nodes().Select(n => n is XElement e ? ((string)e.Attribute("cref") ?? (string)e.Attribute("langword") ?? e.Value)?.Split(':').Last() : n.ToString())), @"\s+", " ").Trim();
                    if (text.Length == 0) continue;
                    int p = name.IndexOf('(');
                    string key = p > 0 ? name.Substring(0, p) : name;
                    if (!d.ContainsKey(key)) d[key] = Trunc(text, 400);
                }
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[DllInspector] xml docs: " + ex.Message); }
            return d;
        }
        private static string Doc(Dictionary<string, string> docs, string key) => docs.Count > 0 && docs.TryGetValue(key, out var s) ? s : null;

        // ------------------------------------------------------------------ strings
        private static readonly (string Kind, Regex Rx)[] STRING_KINDS =
        {
            ("URL",      new Regex(@"^\s*(https?|wss?|ftp)://[^\s""'<>]{4,}", RegexOptions.IgnoreCase)),
            ("SQL",      new Regex(@"^\s*(SELECT\s[\s\S]*\sFROM\s|INSERT\s+INTO\s|UPDATE\s+\w[\w.]*\s+SET\s|DELETE\s+FROM\s|MERGE\s+INTO\s|BEGIN\s|DECLARE\s|WITH\s+\w+\s+AS\s*\(|CREATE\s+(OR\s+REPLACE\s+)?(TABLE|VIEW|PROCEDURE|FUNCTION|PACKAGE|INDEX)\s)", RegexOptions.IgnoreCase)),
            ("Endpoint", new Regex(@"^/?(fscmRestApi|hcmRestApi|crmRestApi|xmlpserver|ords|api|wms|ai)/[\w/{}.\-]+", RegexOptions.IgnoreCase)),
            ("Path",     new Regex(@"^([A-Za-z]:\\|\\\\[\w.$-]+\\|%[A-Za-z]+%\\)[^\r\n]{2,}")),
            ("Registry", new Regex(@"^(HKEY_[A-Z_]+|HKLM|HKCU|SOFTWARE\\|System\\CurrentControlSet)[\\\w .{}-]*", RegexOptions.IgnoreCase)),
        };
        private static bool AddString(DllReport r, string s)
        {
            if (string.IsNullOrWhiteSpace(s) || s.Length < 6) return false;
            foreach (var k in STRING_KINDS)
            {
                if (!k.Rx.IsMatch(s)) continue;
                if (!r.Strings.TryGetValue(k.Kind, out var list)) r.Strings[k.Kind] = list = new List<string>();
                string v = Redact(Trunc(Regex.Replace(s.Trim(), @"\s+", " "), 400));
                if (list.Count < MAX_STRINGS_PER_KIND && !list.Contains(v)) list.Add(v);
                return true;
            }
            return false;
        }
        /// <summary>Native images: ASCII and UTF-16 runs in the file that look like URLs, paths or registry keys.</summary>
        private static void ScanNativeStrings(byte[] b, DllReport r)
        {
            int limit = Math.Min(b.Length, 64 * 1024 * 1024);
            var sb = new StringBuilder();
            for (int i = 0; i < limit; i++)                                          // ASCII
            {
                byte c = b[i];
                if (c >= 0x20 && c < 0x7f) { sb.Append((char)c); continue; }
                if (sb.Length >= 8) AddString(r, sb.ToString());
                sb.Clear();
            }
            sb.Clear();
            for (int start = 0; start < 2; start++)                                  // UTF-16LE at both alignments
                for (int i = start; i + 1 < limit; i += 2)
                {
                    char c = (char)(b[i] | b[i + 1] << 8);
                    if (c >= 0x20 && c < 0x7f) { sb.Append(c); continue; }
                    if (sb.Length >= 8) AddString(r, sb.ToString());
                    sb.Clear();
                }
        }

        // ------------------------------------------------------------------ native tables
        private static int Rva2Off(PEReader pe, int rva)
        {
            foreach (var s in pe.PEHeaders.SectionHeaders)
                if (rva >= s.VirtualAddress && rva < s.VirtualAddress + Math.Max(s.VirtualSize, s.SizeOfRawData))
                    return rva - s.VirtualAddress + s.PointerToRawData;
            return -1;
        }
        private static string AsciiZ(byte[] img, int off, int max = 512)
        {
            if (off < 0 || off >= img.Length) return null;
            int e = off;
            while (e < img.Length && e - off < max && img[e] != 0) e++;
            return Encoding.ASCII.GetString(img, off, e - off);
        }

        private static void ReadExports(PEReader pe, DllReport r)
        {
            var dir = pe.PEHeaders.PEHeader.ExportTableDirectory;
            if (dir.Size == 0 || dir.RelativeVirtualAddress == 0) return;
            byte[] img = pe.GetEntireImage().GetContent().ToArray();
            int o = Rva2Off(pe, dir.RelativeVirtualAddress);
            if (o < 0) return;
            int ordBase = BitConverter.ToInt32(img, o + 16), nFuncs = BitConverter.ToInt32(img, o + 20), nNames = BitConverter.ToInt32(img, o + 24);
            int aFuncs = Rva2Off(pe, BitConverter.ToInt32(img, o + 28)), aNames = Rva2Off(pe, BitConverter.ToInt32(img, o + 32)), aOrds = Rva2Off(pe, BitConverter.ToInt32(img, o + 36));
            r.ExportsTotal = nFuncs;
            if (aFuncs < 0 || nNames <= 0 || aNames < 0 || aOrds < 0) return;
            for (int i = 0; i < nNames && i < 20000; i++)
            {
                string name = AsciiZ(img, Rva2Off(pe, BitConverter.ToInt32(img, aNames + i * 4)));
                int idx = BitConverter.ToUInt16(img, aOrds + i * 2);
                int fr = idx < nFuncs ? BitConverter.ToInt32(img, aFuncs + idx * 4) : 0;
                string fwd = fr >= dir.RelativeVirtualAddress && fr < dir.RelativeVirtualAddress + dir.Size ? AsciiZ(img, Rva2Off(pe, fr)) : null;
                r.Exports.Add(new ExportFn { Ordinal = ordBase + idx, Name = name, Forward = fwd });
            }
            r.Exports.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        }

        private static void ReadNativeImports(PEReader pe, DllReport r)
        {
            var h = pe.PEHeaders.PEHeader;
            bool pe64 = h.Magic == PEMagic.PE32Plus;
            byte[] img = null;
            var dir = h.ImportTableDirectory;
            if (dir.Size > 0 && dir.RelativeVirtualAddress != 0)
            {
                img = pe.GetEntireImage().GetContent().ToArray();
                int o = Rva2Off(pe, dir.RelativeVirtualAddress);
                for (int d = 0; o >= 0 && d < 2000; d++, o += 20)
                {
                    int oft = BitConverter.ToInt32(img, o), nameRva = BitConverter.ToInt32(img, o + 12), ft = BitConverter.ToInt32(img, o + 16);
                    if (nameRva == 0 && ft == 0) break;
                    var im = new ImportModule { Dll = AsciiZ(img, Rva2Off(pe, nameRva)) ?? "?", Via = "import" };
                    ReadThunks(pe, img, oft != 0 ? oft : ft, pe64, 0, im);
                    r.Imports.Add(im);
                }
            }
            var dd = h.DelayImportTableDirectory;
            if (dd.Size > 0 && dd.RelativeVirtualAddress != 0)
            {
                img = img ?? pe.GetEntireImage().GetContent().ToArray();
                int o = Rva2Off(pe, dd.RelativeVirtualAddress);
                for (int d = 0; o >= 0 && d < 2000; d++, o += 32)
                {
                    int attrs = BitConverter.ToInt32(img, o), nameRva = BitConverter.ToInt32(img, o + 4), intRva = BitConverter.ToInt32(img, o + 16);
                    if (nameRva == 0) break;
                    long bias = (attrs & 1) == 0 ? (long)h.ImageBase : 0;           // old-style descriptors hold VAs
                    var im = new ImportModule { Dll = AsciiZ(img, Rva2Off(pe, (int)(nameRva - bias))) ?? "?", Via = "delay" };
                    ReadThunks(pe, img, (int)(intRva - bias), pe64, bias, im);
                    r.Imports.Add(im);
                }
            }
        }
        private static void ReadThunks(PEReader pe, byte[] img, int rva, bool pe64, long bias, ImportModule im)
        {
            int t = Rva2Off(pe, rva);
            if (t < 0) return;
            for (int i = 0; i < 20000; i++, t += pe64 ? 8 : 4)
            {
                if (t + (pe64 ? 8 : 4) > img.Length) break;
                long v = pe64 ? BitConverter.ToInt64(img, t) : BitConverter.ToUInt32(img, t);
                if (v == 0) break;
                bool byOrd = pe64 ? v < 0 : (v & 0x80000000L) != 0;
                if (byOrd) { im.Functions.Add("#" + (v & 0xFFFF)); continue; }
                int no = Rva2Off(pe, (int)((v & 0x7FFFFFFF) - bias));
                string n = no < 0 ? null : AsciiZ(img, no + 2);
                if (!string.IsNullOrEmpty(n)) im.Functions.Add(n);
            }
            im.Functions.Sort(StringComparer.Ordinal);
        }

        /// <summary>RT_VERSION → CompanyName, FileDescription, ProductName, FileVersion … (FileVersionInfo only reads this on Windows).</summary>
        private static void ReadVersionResource(PEReader pe, DllReport r)
        {
            var dir = pe.PEHeaders.PEHeader.ResourceTableDirectory;
            if (dir.Size == 0 || dir.RelativeVirtualAddress == 0) return;
            byte[] img = pe.GetEntireImage().GetContent().ToArray();
            int root = Rva2Off(pe, dir.RelativeVirtualAddress);
            if (root < 0) return;
            int Entry(int dirOff, int id)      // offset (relative to root) of the entry for id, or of the first entry when id < 0
            {
                int nNamed = BitConverter.ToUInt16(img, dirOff + 12), nId = BitConverter.ToUInt16(img, dirOff + 14);
                for (int i = 0; i < nNamed + nId; i++)
                {
                    int e = dirOff + 16 + i * 8;
                    uint nm = BitConverter.ToUInt32(img, e);
                    if (id < 0 || (nm & 0x80000000) == 0 && nm == id) return BitConverter.ToInt32(img, e + 4);
                }
                return -1;
            }
            int t = Entry(root, 16);                                                      // RT_VERSION
            if (t == -1 || (t & 0x80000000) == 0) return;
            int n = Entry(root + (t & 0x7fffffff), -1);
            if (n == -1 || (n & 0x80000000) == 0) return;
            int l = Entry(root + (n & 0x7fffffff), -1);
            if (l == -1 || (l & 0x80000000) != 0) return;
            int de = root + l;
            int dataOff = Rva2Off(pe, BitConverter.ToInt32(img, de)), size = BitConverter.ToInt32(img, de + 4);
            if (dataOff < 0 || size <= 0 || dataOff + size > img.Length) return;
            var blob = new byte[size];
            Array.Copy(img, dataOff, blob, 0, size);
            ParseVersionNode(blob, 0, size, 0, r.Version);
        }
        private static int Align4(int x) => (x + 3) & ~3;
        private static void ParseVersionNode(byte[] b, int off, int end, int depth, Dictionary<string, string> into)
        {
            if (depth > 6 || off + 6 > end) return;
            int len = BitConverter.ToUInt16(b, off), valLen = BitConverter.ToUInt16(b, off + 2), type = BitConverter.ToUInt16(b, off + 4);
            if (len < 6) return;
            int nodeEnd = Math.Min(end, off + len);
            int k = off + 6, ke = k;
            while (ke + 1 < nodeEnd && (b[ke] | b[ke + 1]) != 0) ke += 2;
            string key = Encoding.Unicode.GetString(b, k, ke - k);
            int v = Align4(ke + 2);
            int vBytes = type == 1 ? valLen * 2 : valLen;
            if (depth == 0 && key == "VS_VERSION_INFO" && valLen >= 52 && v + 52 <= nodeEnd && BitConverter.ToUInt32(b, v) == 0xFEEF04BD)
            {
                uint ms = BitConverter.ToUInt32(b, v + 8), ls = BitConverter.ToUInt32(b, v + 12);
                into["FileVersion#"] = (ms >> 16) + "." + (ms & 0xffff) + "." + (ls >> 16) + "." + (ls & 0xffff);
            }
            if (depth == 3 && type == 1 && vBytes > 0 && v + vBytes <= nodeEnd)
            {
                string val = Encoding.Unicode.GetString(b, v, vBytes).TrimEnd('\0').Trim();
                if (val.Length > 0 && !into.ContainsKey(key)) into[key] = Trunc(val, 400);
            }
            int c = Align4(v + vBytes);
            if (depth == 3) return;
            while (c + 6 <= nodeEnd)
            {
                int cl = BitConverter.ToUInt16(b, c);
                if (cl < 6) break;
                if (depth == 0 && !IsKey(b, c, "StringFileInfo")) { c = Align4(c + cl); continue; }
                ParseVersionNode(b, c, nodeEnd, depth + 1, into);
                c = Align4(c + cl);
            }
        }
        private static bool IsKey(byte[] b, int nodeOff, string key)
        {
            var kb = Encoding.Unicode.GetBytes(key);
            if (nodeOff + 6 + kb.Length > b.Length) return false;
            for (int i = 0; i < kb.Length; i++) if (b[nodeOff + 6 + i] != kb[i]) return false;
            return true;
        }

        // ------------------------------------------------------------------ capability fingerprint
        private static readonly (string Cap, string Icon, string[] Managed, string[] Native)[] CAPS =
        {
            ("Web / HTTP calls",       "fa-globe",          new[]{ "System.Net.Http.", "System.Net.WebClient", "System.Net.HttpWebRequest", "System.Net.WebRequest", "RestSharp." },          new[]{ "winhttp.dll", "wininet.dll", "urlmon.dll", "webio.dll" }),
            ("SOAP / WCF services",    "fa-envelope-open-text", new[]{ "System.ServiceModel.", "System.Web.Services." },                                                   new string[0]),
            ("Network sockets",        "fa-network-wired",  new[]{ "System.Net.Sockets.", "System.Net.NetworkInformation." },                                             new[]{ "ws2_32.dll", "wsock32.dll", "iphlpapi.dll", "mswsock.dll" }),
            ("Database",               "fa-database",       new[]{ "System.Data.", "Oracle.ManagedDataAccess.", "Microsoft.Data.SqlClient.", "Microsoft.Data.Sqlite.", "Npgsql.", "MySql.", "Dapper." }, new[]{ "odbc32.dll", "oci.dll", "sqlite3.dll", "e_sqlite3.dll" }),
            ("JSON",                   "fa-code",           new[]{ "System.Text.Json.", "Newtonsoft.Json." },                                                         new string[0]),
            ("XML",                    "fa-file-code",      new[]{ "System.Xml." },                                                                                   new[]{ "xmllite.dll", "msxml6.dll" }),
            ("Files & folders",        "fa-folder-open",    new[]{ "System.IO.File", "System.IO.FileInfo", "System.IO.Directory", "System.IO.DirectoryInfo", "System.IO.FileStream", "System.IO.Compression." },      new[]{ "CreateFileW", "CreateFileA", "FindFirstFileW", "ReadFile", "WriteFile" }),
            ("Printing",               "fa-print",          new[]{ "System.Drawing.Printing.", "PdfiumViewer.", "System.Printing." },                                new[]{ "winspool.drv", "prntvpt.dll" }),
            ("Windows UI",             "fa-window-maximize", new[]{ "System.Windows.Forms.", "System.Windows.Controls.", "System.Windows.Window" },                  new[]{ "user32.dll", "comctl32.dll", "uxtheme.dll", "dwmapi.dll" }),
            ("Graphics / imaging",     "fa-image",          new[]{ "System.Drawing.Bitmap", "System.Drawing.Graphics", "System.Drawing.Image", "System.Drawing.Imaging.", "SkiaSharp.", "System.Windows.Media.Imaging." },                                        new[]{ "gdi32.dll", "gdiplus.dll", "d2d1.dll", "dwrite.dll", "windowscodecs.dll" }),
            ("DirectX / GPU",          "fa-cube",           new string[0],                                                                                              new[]{ "d3d9.dll", "d3d11.dll", "d3d12.dll", "dxgi.dll", "d3dcompiler_47.dll" }),
            ("Registry",               "fa-sitemap",        new[]{ "Microsoft.Win32.Registry", "Microsoft.Win32.RegistryKey" },                                                                     new[]{ "RegOpenKeyExW", "RegQueryValueExW", "RegSetValueExW", "RegCreateKeyExW", "RegGetValueW" }),
            ("Cryptography",           "fa-lock",           new[]{ "System.Security.Cryptography." },                                                               new[]{ "bcrypt.dll", "ncrypt.dll", "crypt32.dll", "CryptProtectData", "CryptAcquireContextW" }),
            ("Authentication / users", "fa-user-shield",    new[]{ "System.DirectoryServices.", "System.Security.Principal.", "Microsoft.Identity." },            new[]{ "secur32.dll", "sspicli.dll", "netapi32.dll", "LogonUserW" }),
            ("Processes",              "fa-gears",          new[]{ "System.Diagnostics.Process", "System.Diagnostics.ProcessStartInfo" },                                                                    new[]{ "CreateProcessW", "CreateProcessA", "ShellExecuteW", "ShellExecuteExW", "OpenProcess" }),
            ("COM / OLE",              "fa-plug",           new[]{ "System.Runtime.InteropServices.ComTypes." },                                                    new[]{ "ole32.dll", "oleaut32.dll", "combase.dll" }),
            ("Shell / desktop",        "fa-desktop",        new[]{ "System.Windows.Forms.Clipboard" },                                                               new[]{ "shell32.dll", "shlwapi.dll", "shcore.dll" }),
            ("Email",                  "fa-envelope",       new[]{ "System.Net.Mail.", "MailKit.", "Microsoft.Office.Interop.Outlook." },                            new[]{ "mapi32.dll" }),
            ("Office / Excel",         "fa-file-excel",     new[]{ "Microsoft.Office.Interop.", "ClosedXML.", "OfficeOpenXml.", "NPOI.", "ExcelDataReader.", "DocumentFormat.OpenXml." }, new string[0]),
            ("Web browser (WebView2)", "fa-window-restore", new[]{ "Microsoft.Web.WebView2." },                                                                       new[]{ "WebView2Loader.dll" }),
            ("AI (Claude)",            "fa-robot",          new[]{ "Anthropic." },                                                                                    new string[0]),
            ("Hardware / devices",     "fa-microchip",      new[]{ "System.Management.", "System.IO.Ports." },                                                     new[]{ "setupapi.dll", "hid.dll", "cfgmgr32.dll", "winusb.dll" }),
            ("Audio / media",          "fa-volume-high",    new[]{ "System.Media.", "NAudio." },                                                                      new[]{ "winmm.dll", "mfplat.dll", "avrt.dll", "dsound.dll" }),
            ("Threads / async",        "fa-bolt",           new[]{ "System.Threading.Tasks.Task", "System.Threading.Thread" },                                     new[]{ "CreateThread", "CreateThreadpoolWork" }),
            ("Low-level Windows",      "fa-screwdriver-wrench", new string[0],                                                                                          new[]{ "ntdll.dll" }),
            ("Reflection / plugins",   "fa-puzzle-piece",   new[]{ "System.Reflection.Assembly", "System.Reflection.Emit.", "System.Runtime.Loader.", "System.Activator" },             new[]{ "LoadLibraryW", "LoadLibraryExW", "GetProcAddress" }),
        };
        private static List<Capability> Fingerprint(DllReport r)
        {
            var used = _usedTypes ?? new HashSet<string>();
            _usedTypes = null;
            var dlls = r.Imports.ToDictionary(i => i.Dll.ToLowerInvariant(), i => i, StringComparer.OrdinalIgnoreCase);
            var fns = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var im in r.Imports) foreach (var f in im.Functions) if (!fns.ContainsKey(f)) fns[f] = im.Dll;
            var refs = r.References.Select(x => x.Split(' ')[0] + ".").ToList();
            var caps = new List<Capability>();
            foreach (var c in CAPS)
            {
                var ev = new List<string>();
                foreach (var m in c.Managed)
                {
                    // "Ns." = the whole namespace; "Ns.Type" = that type only (and its generic forms)
                    var hits = used.Where(u => m.EndsWith(".") ? u.StartsWith(m, StringComparison.Ordinal) : u == m || u.StartsWith(m + "`", StringComparison.Ordinal))
                        .Take(3).Select(u => StripArity(u.Split('.').Last())).ToList();
                    if (hits.Count > 0) ev.Add(m.TrimEnd('.') + " (" + string.Join(", ", hits) + ")");
                    else if (refs.Any(x => x.StartsWith(m, StringComparison.OrdinalIgnoreCase))) ev.Add("references " + m.TrimEnd('.'));
                }
                foreach (var n in c.Native)
                {
                    if (n.EndsWith(".dll") || n.EndsWith(".drv"))
                    {
                        if (dlls.TryGetValue(n, out var im)) ev.Add(n + " (" + im.Functions.Count + " fn" + (im.Via == "pinvoke" ? ", P/Invoke" : "") + ")");
                    }
                    else if (fns.TryGetValue(n, out var dll)) ev.Add(dll + "!" + n);
                }
                if (ev.Count > 0) caps.Add(new Capability { Name = c.Cap, Icon = c.Icon, Evidence = ev.Distinct().Take(6).ToList() });
            }
            if (r.Strings.TryGetValue("URL", out var urls)) caps.Add(new Capability { Name = "URLs in the code", Icon = "fa-link", Evidence = urls.Take(4).ToList() });
            if (r.Strings.ContainsKey("SQL")) { var db = caps.FirstOrDefault(c => c.Name == "Database"); if (db != null) db.Evidence.Add(r.Strings["SQL"].Count + " SQL statements"); else caps.Add(new Capability { Name = "SQL", Icon = "fa-database", Evidence = { r.Strings["SQL"].Count + " SQL statements (sent through another API)" } }); }
            return caps;
        }

        // ------------------------------------------------------------------ text outline for the AI
        /// <summary>
        /// Compact text of the report for a prompt. Types with docs, [AiAction]s or many public members come first;
        /// when the budget runs out the rest are listed by name only (the model can ask for one type in full).
        /// </summary>
        public static string Outline(DllReport r, int maxChars = 60000, string onlyNamespace = null)
        {
            var sb = new StringBuilder();
            sb.AppendLine("DLL: " + r.FileName + "  (" + (r.Kind == "managed" ? ".NET" : r.Kind == "mixed" ? ".NET + native (C++/CLI)" : "native") + ", " + r.Machine + (r.IsExe ? ", EXE" : "") + ", " + FormatSize(r.Size) + ")");
            foreach (var k in new[] { "FileDescription", "CompanyName", "ProductName", "FileVersion", "ProductVersion", "LegalCopyright", "OriginalFilename" })
                if (r.Version.TryGetValue(k, out var v)) sb.AppendLine(k + ": " + v);
            if (r.Assembly != null)
            {
                sb.AppendLine("Assembly: " + r.Assembly.Name + " " + r.Assembly.Version + (r.Assembly.TargetFramework != null ? " for " + r.Assembly.TargetFramework : ""));
                foreach (var a in r.Assembly.Attributes) if (a.Key == "Description" || a.Key == "Title") sb.AppendLine(a.Key + ": " + a.Value);
            }
            foreach (var w in r.Warnings) sb.AppendLine("NOTE: " + w);
            if (r.Capabilities.Count > 0)
            {
                sb.AppendLine().AppendLine("CAPABILITIES (from the APIs it uses):");
                foreach (var c in r.Capabilities) sb.AppendLine("- " + c.Name + ": " + string.Join("; ", c.Evidence));
            }
            foreach (var f in r.Forwards) sb.AppendLine().AppendLine("FORWARDS to " + f.Key + " (" + f.Value.Count + "): " + string.Join(", ", f.Value.Take(80)) + (f.Value.Count > 80 ? " …" : ""));
            if (r.References.Count > 0) sb.AppendLine().AppendLine("REFERENCES: " + string.Join(", ", r.References.Select(x => x.Split(' ')[0])));
            if (r.Imports.Count > 0)
            {
                sb.AppendLine().AppendLine(r.Kind == "native" ? "IMPORTS (Windows DLL → functions):" : "P/INVOKE (Windows APIs called directly):");
                foreach (var im in r.Imports.Take(60))
                    sb.AppendLine("- " + im.Dll + (im.Via == "delay" ? " (delay-load)" : "") + ": " + string.Join(", ", im.Functions.Take(40)) + (im.Functions.Count > 40 ? " … +" + (im.Functions.Count - 40) : ""));
            }
            if (r.Exports.Count > 0)
            {
                sb.AppendLine().AppendLine("EXPORTS (" + r.Exports.Count + " named of " + r.ExportsTotal + "):");
                sb.AppendLine(string.Join(", ", r.Exports.Take(600).Select(e => e.Name + (e.Forward != null ? " → " + e.Forward : ""))) + (r.Exports.Count > 600 ? " …" : ""));
            }
            if (r.AiActions.Count > 0)
            {
                sb.AppendLine().AppendLine("[AiAction] METHODS (the chat may offer to run these through an approval card):");
                foreach (var a in r.AiActions) sb.AppendLine("- " + a.Type + "." + a.Signature + " — " + a.Description + (a.RequiresApproval ? "" : " (no approval needed)"));
            }
            foreach (var kv in r.Strings)
            {
                sb.AppendLine().AppendLine("HARD-CODED " + kv.Key.ToUpperInvariant() + " (" + kv.Value.Count + "):");
                foreach (var s in kv.Value.Take(kv.Key == "SQL" ? 25 : 40)) sb.AppendLine("- " + Trunc(s, kv.Key == "SQL" ? 300 : 200));
            }
            if (r.Namespaces.Count == 0) return Trunc(sb.ToString(), maxChars);

            sb.AppendLine().AppendLine("TYPES (" + r.Stats.PublicTypes + " public of " + r.Stats.Types + "; + public, # protected, - internal/private):");
            var types = r.Namespaces.Where(n => onlyNamespace == null || n.Name.Equals(onlyNamespace, StringComparison.OrdinalIgnoreCase))
                .SelectMany(n => n.Types.Select(t => (n.Name, t))).ToList();
            var ranked = types.OrderByDescending(x => (x.t.Summary != null ? 3 : 0) + (r.AiActions.Any(a => a.Type == x.t.Id) ? 10 : 0) + Math.Min(x.t.Members.Count, 40) / 8
                + (x.t.Kind.EndsWith("class") || x.t.Kind == "interface" ? 3 : x.t.Kind == "enum" ? -2 : 0)).ToList();
            var full = new HashSet<string>();
            int budget = maxChars - sb.Length - 2000;
            int used = 0;
            foreach (var (_, t) in ranked)
            {
                int cost = TypeText(t).Length;
                if (used + cost > budget * 0.85) continue;
                used += cost; full.Add(t.Id);
            }
            foreach (var g in types.GroupBy(x => x.Name))
            {
                sb.AppendLine("namespace " + g.Key);
                var shortOnes = new List<string>();
                foreach (var (_, t) in g)
                {
                    if (full.Contains(t.Id)) sb.Append(TypeText(t));
                    else shortOnes.Add(t.Kind.Replace("static class", "static").Replace("abstract class", "abstract").Replace("class", "c").Replace("interface", "i").Replace("struct", "s").Replace("enum", "e").Replace("delegate", "d") + ":" + t.Name);
                }
                if (shortOnes.Count > 0) sb.AppendLine("  (names only) " + string.Join(", ", shortOnes));
                if (sb.Length > maxChars) { sb.AppendLine("… truncated - ask for one namespace or type"); break; }
            }
            return Trunc(sb.ToString(), maxChars);
        }
        private static string TypeText(TypeInfo t)
        {
            var sb = new StringBuilder();
            sb.Append("  ").Append(t.Access == "public" ? "" : "internal ").Append(t.Kind).Append(' ').Append(t.Name);
            var inh = new List<string>();
            if (t.Base != null) inh.Add(t.Base);
            if (t.Interfaces != null) inh.AddRange(t.Interfaces.Take(6));
            if (inh.Count > 0) sb.Append(" : ").Append(string.Join(", ", inh));
            if (t.Attributes != null) sb.Append("  [").Append(string.Join(", ", t.Attributes.Take(5))).Append(']');
            sb.AppendLine();
            if (t.Summary != null) sb.Append("    /// ").AppendLine(Trunc(t.Summary, 240));
            if (t.Kind == "enum") { sb.Append("    ").AppendLine(string.Join(", ", t.Members.Take(25).Select(m => m.Signature)) + (t.Members.Count > 25 ? " … +" + (t.Members.Count - 25) : "")); return sb.ToString(); }
            foreach (var m in t.Members.Take(80))
            {
                sb.Append("    ").Append(m.Access == "public" ? "+ " : m.Access == "protected" ? "# " : "- ").Append(m.Static ? "static " : "").Append(m.Signature);
                if (m.Summary != null) sb.Append("  // ").Append(Trunc(m.Summary, 160));
                sb.AppendLine();
            }
            if (t.Members.Count > 80) sb.AppendLine("    … +" + (t.Members.Count - 80) + " members");
            return sb.ToString();
        }

        // ------------------------------------------------------------------ search
        public static List<object> Find(DllReport r, string q, int max = 200)
        {
            var hits = new List<object>();
            if (string.IsNullOrWhiteSpace(q)) return hits;
            var words = q.ToLowerInvariant().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            bool Match(string s) => s != null && words.All(w => s.ToLowerInvariant().Contains(w));
            foreach (var n in r.Namespaces)
                foreach (var t in n.Types)
                {
                    if (hits.Count >= max) return hits;
                    if (Match(t.Id) || Match(t.Summary)) hits.Add(new { kind = t.Kind, type = t.Id, signature = t.Name, summary = t.Summary });
                    foreach (var m in t.Members)
                        if (hits.Count < max && (Match(m.Name) || Match(m.Summary) || Match(t.Name + "." + m.Name)))
                            hits.Add(new { kind = m.Kind, type = t.Id, signature = m.Signature, summary = m.Summary });
                }
            foreach (var e in r.Exports) if (hits.Count < max && Match(e.Name)) hits.Add(new { kind = "export", type = r.FileName, signature = e.Name });
            foreach (var kv in r.Strings) foreach (var s in kv.Value) if (hits.Count < max && Match(s)) hits.Add(new { kind = "string:" + kv.Key, type = r.FileName, signature = s });
            return hits;
        }

        // ------------------------------------------------------------------ decompile
        /// <summary>
        /// C# for one type ("Ns.Type", nested "Ns.Outer+Inner") or one member ("Ns.Type::Method" - all overloads).
        /// The DLL is only read; referenced assemblies are looked up next to it and in the .NET runtime folders.
        /// </summary>
        public static string Decompile(string path, string target, int maxChars = 150000)
        {
            if (string.IsNullOrWhiteSpace(target)) throw new ArgumentException("Pick a type to decompile");
            var settings = new ICSharpCode.Decompiler.DecompilerSettings(ICSharpCode.Decompiler.CSharp.LanguageVersion.Latest)
            {
                ThrowOnAssemblyResolveErrors = false,
                ShowXmlDocumentation = true,
                RemoveDeadCode = false,
            };
            var dec = new ICSharpCode.Decompiler.CSharp.CSharpDecompiler(path, settings);
            string typeName = target, member = null;
            int sep = target.IndexOf("::", StringComparison.Ordinal);
            if (sep > 0) { typeName = target.Substring(0, sep); member = target.Substring(sep + 2); }
            var ftn = new ICSharpCode.Decompiler.TypeSystem.FullTypeName(typeName);
            string code;
            if (member == null) code = dec.DecompileTypeAsString(ftn);
            else
            {
                var td = ICSharpCode.Decompiler.TypeSystem.TypeSystemExtensions.FindType(dec.TypeSystem, ftn).GetDefinition() ?? throw new InvalidOperationException("Type not found: " + typeName);
                var handles = new List<EntityHandle>();
                bool ctor = member == td.Name || member == ".ctor";
                foreach (var m in td.Methods) if (ctor ? m.IsConstructor : m.Name == member) handles.Add(m.MetadataToken);
                foreach (var p in td.Properties) if (p.Name == member) handles.Add(p.MetadataToken);
                foreach (var e in td.Events) if (e.Name == member) handles.Add(e.MetadataToken);
                foreach (var f in td.Fields) if (f.Name == member) handles.Add(f.MetadataToken);
                if (handles.Count == 0) throw new InvalidOperationException("No member '" + member + "' in " + typeName);
                code = dec.DecompileAsString(handles);
            }
            code = Redact(code);                                  // passwords / keys never leave the PC
            return code.Length > maxChars ? code.Substring(0, maxChars) + "\n// … truncated at " + maxChars + " characters - decompile one member (Type::Member) to see the rest" : code;
        }

        // ------------------------------------------------------------------ cache, paths, redaction
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DllReport> _cache =
            new System.Collections.Concurrent.ConcurrentDictionary<string, DllReport>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Inspect once per file version (path + size + write time + scope).</summary>
        public static DllReport InspectCached(string path, bool includeNonPublic = false)
        {
            var fi = new FileInfo(path);
            if (!fi.Exists) throw new FileNotFoundException("File not found: " + path);
            string key = fi.FullName + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks + "|" + includeNonPublic;
            if (_cache.TryGetValue(key, out var r)) return r;
            if (_cache.Count > 30) _cache.Clear();
            r = Inspect(path, includeNonPublic);
            _cache[key] = r;
            return r;
        }

        public static readonly string[] EXTENSIONS = { ".dll", ".exe", ".winmd" };
        public const string DROP_FOLDER = @"C:\fusion\dll";

        /// <summary>
        /// A full path, or a bare file name looked up in the drop folder (C:\fusion\dll), the app folder and the
        /// Windows system folder. Only .dll / .exe / .winmd files are accepted.
        /// </summary>
        public static string ResolvePath(string p)
        {
            if (string.IsNullOrWhiteSpace(p)) throw new ArgumentException("No DLL given");
            p = p.Trim().Trim('"');
            if (!EXTENSIONS.Contains(Path.GetExtension(p).ToLowerInvariant())) throw new ArgumentException("Only .dll, .exe or .winmd files can be read: " + p);
            if (Path.IsPathRooted(p)) { if (System.IO.File.Exists(p)) return Path.GetFullPath(p); throw new FileNotFoundException("File not found: " + p); }
            string name = Path.GetFileName(p);
            foreach (var dir in new[] { DROP_FOLDER, AppContext.BaseDirectory, Environment.SystemDirectory })
            {
                if (string.IsNullOrEmpty(dir)) continue;
                string c = Path.Combine(dir, p);
                if (System.IO.File.Exists(c)) return Path.GetFullPath(c);
                c = Path.Combine(dir, name);
                if (System.IO.File.Exists(c)) return Path.GetFullPath(c);
            }
            throw new FileNotFoundException(name + " was not found in " + DROP_FOLDER + ", the app folder or the Windows system folder - give the full path");
        }

        /// <summary>DLLs worth offering: the drop folder, then this app's own and third-party DLLs (runtime DLLs left out).</summary>
        public static List<object> Suggest()
        {
            var list = new List<object>();
            void Add(string dir, string group, Func<string, bool> keep)
            {
                try
                {
                    if (!Directory.Exists(dir)) return;
                    foreach (var f in Directory.EnumerateFiles(dir).Where(f => EXTENSIONS.Contains(Path.GetExtension(f).ToLowerInvariant())).OrderBy(f => f, StringComparer.OrdinalIgnoreCase).Take(300))
                    {
                        string n = Path.GetFileName(f);
                        if (!keep(n)) continue;
                        var fi = new FileInfo(f);
                        list.Add(new { group, name = n, path = fi.FullName, size = fi.Length, modified = fi.LastWriteTime });
                    }
                }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[DllInspector] suggest " + dir + ": " + ex.Message); }
            }
            Add(DROP_FOLDER, "Drop folder (C:\\fusion\\dll)", n => true);
            string app = AppContext.BaseDirectory;
            Add(app, "This app", n => !Regex.IsMatch(n, @"^(System\.|Microsoft\.(Win32|VisualBasic|CSharp|Extensions|NETCore|DiaSymReader)|mscor|netstandard|clr|coreclr|hostfxr|hostpolicy|api-ms-|ucrtbase|vcruntime|msvcp|Accessibility|WindowsBase|Presentation|UIAutomation|ReachFramework|DirectWriteForwarder|createdump|mscordaccore|mscordbi|D3DCompiler|PenImc|wpfgfx|Microsoft\.Win32)", RegexOptions.IgnoreCase));
            return list;
        }

        private static readonly Regex[] SECRETS =
        {
            // "password": "x", Password = "x", pwd="x", apiKey: 'x', ClientSecret => "x"
            new Regex(@"(?i)((?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key|private[_-]?key|credential)s?\w*[""']?\s*(?:=>|[:=]|,)\s*@?[""'])([^""'\r\n]{3,})([""'])"),
            // Authorization: Basic xxx / Bearer xxx
            new Regex(@"(?i)((?:Basic|Bearer)\s+)([A-Za-z0-9+/=._\-]{12,})"),
            // Anthropic / OpenAI / GitHub / AWS style keys
            new Regex(@"()(sk-ant-[A-Za-z0-9_\-]{10,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})()"),
            // user:password@host in URLs
            new Regex(@"(?i)(\w+://[^:/\s""']+:)([^@/\s""']{3,})(@)"),
            // ?password=x&token=x in URLs / connection strings
            new Regex(@"(?i)((?:[?&;]|^)(?:password|pwd|token|key|secret|sig|apikey)=)([^&;""'\s]{3,})()"),
        };
        /// <summary>Hides passwords, keys and tokens before any text about a DLL is sent to Claude.</summary>
        public static string Redact(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            foreach (var rx in SECRETS) s = rx.Replace(s, m => m.Groups[1].Value + "***" + (m.Groups.Count > 3 ? m.Groups[3].Value : ""));
            return s;
        }

        // ------------------------------------------------------------------ helpers
        public static string FormatSize(long b) => b >= 1 << 20 ? (b / 1048576.0).ToString("0.0") + " MB" : (b / 1024.0).ToString("0") + " KB";
        private static string Trunc(string s, int n) => s == null || s.Length <= n ? s : s.Substring(0, n) + "…";

        private sealed class GenericCtx
        {
            public readonly string[] TypeParams, MethodParams;
            public GenericCtx(string[] t, string[] m) { TypeParams = t ?? new string[0]; MethodParams = m ?? new string[0]; }
        }

        /// <summary>Signature blobs → C#-looking type names (List&lt;string&gt;, int?, (int, string), ref T …).</summary>
        private sealed class SigProvider : ISignatureTypeProvider<string, GenericCtx>
        {
            private readonly MetadataReader _md;
            public SigProvider(MetadataReader md) { _md = md; }
            private static readonly Dictionary<string, string> ALIAS = new Dictionary<string, string>
            {
                ["System.Object"] = "object", ["System.String"] = "string", ["System.Boolean"] = "bool", ["System.Int32"] = "int", ["System.Int64"] = "long",
                ["System.Int16"] = "short", ["System.Byte"] = "byte", ["System.SByte"] = "sbyte", ["System.UInt32"] = "uint", ["System.UInt64"] = "ulong",
                ["System.UInt16"] = "ushort", ["System.Double"] = "double", ["System.Single"] = "float", ["System.Decimal"] = "decimal", ["System.Char"] = "char",
                ["System.Void"] = "void", ["System.IntPtr"] = "nint", ["System.UIntPtr"] = "nuint"
            };
            public string GetPrimitiveType(PrimitiveTypeCode c)
            {
                switch (c)
                {
                    case PrimitiveTypeCode.Boolean: return "bool";
                    case PrimitiveTypeCode.Byte: return "byte";
                    case PrimitiveTypeCode.SByte: return "sbyte";
                    case PrimitiveTypeCode.Char: return "char";
                    case PrimitiveTypeCode.Int16: return "short";
                    case PrimitiveTypeCode.UInt16: return "ushort";
                    case PrimitiveTypeCode.Int32: return "int";
                    case PrimitiveTypeCode.UInt32: return "uint";
                    case PrimitiveTypeCode.Int64: return "long";
                    case PrimitiveTypeCode.UInt64: return "ulong";
                    case PrimitiveTypeCode.Single: return "float";
                    case PrimitiveTypeCode.Double: return "double";
                    case PrimitiveTypeCode.String: return "string";
                    case PrimitiveTypeCode.Object: return "object";
                    case PrimitiveTypeCode.Void: return "void";
                    case PrimitiveTypeCode.IntPtr: return "nint";
                    case PrimitiveTypeCode.UIntPtr: return "nuint";
                    case PrimitiveTypeCode.TypedReference: return "TypedReference";
                    default: return c.ToString();
                }
            }
            public string GetTypeFromDefinition(MetadataReader md, TypeDefinitionHandle h, byte raw)
            {
                var td = md.GetTypeDefinition(h);
                string ns = md.GetString(td.Namespace), n = md.GetString(td.Name);
                if (ALIAS.TryGetValue(ns + "." + n, out var a)) return a;
                var dt = td.GetDeclaringType();
                return (dt.IsNil ? "" : GetTypeFromDefinition(md, dt, 0) + ".") + n;
            }
            public string GetTypeFromReference(MetadataReader md, TypeReferenceHandle h, byte raw)
            {
                var tr = md.GetTypeReference(h);
                string ns = md.GetString(tr.Namespace), n = md.GetString(tr.Name);
                if (ALIAS.TryGetValue(ns + "." + n, out var a)) return a;
                if (tr.ResolutionScope.Kind == HandleKind.TypeReference) return GetTypeFromReference(md, (TypeReferenceHandle)tr.ResolutionScope, 0) + "." + n;
                return n;
            }
            public string GetTypeFromSpecification(MetadataReader md, GenericCtx ctx, TypeSpecificationHandle h, byte raw) =>
                md.GetTypeSpecification(h).DecodeSignature(this, ctx);
            public string GetSZArrayType(string e) => e + "[]";
            public string GetArrayType(string e, ArrayShape s) => e + "[" + new string(',', Math.Max(0, s.Rank - 1)) + "]";
            public string GetByReferenceType(string e) => "ref " + e;
            public string GetPointerType(string e) => e + "*";
            public string GetPinnedType(string e) => e;
            public string GetModifiedType(string mod, string t, bool req) => mod == "InAttribute" && t.StartsWith("ref ") ? "in " + t.Substring(4) : t;
            public string GetFunctionPointerType(MethodSignature<string> s) => "delegate*<" + string.Join(", ", s.ParameterTypes.Concat(new[] { s.ReturnType })) + ">";
            public string GetGenericMethodParameter(GenericCtx c, int i) => c != null && i < c.MethodParams.Length ? c.MethodParams[i] : "M" + i;
            public string GetGenericTypeParameter(GenericCtx c, int i) => c != null && i < c.TypeParams.Length ? c.TypeParams[i] : "T" + i;
            public string GetGenericInstantiation(string g, ImmutableArray<string> args)
            {
                string b = StripArity(g);
                if (b == "Nullable" && args.Length == 1) return args[0] + "?";
                if (b == "ValueTuple" && args.Length > 1) return "(" + string.Join(", ", args) + ")";
                // nested generic (Outer`1.Inner): arguments belong to the outer type - show them once at the end
                return string.Join(".", g.Split('.').Select(StripArity)) + "<" + string.Join(", ", args) + ">";
            }
            public string EntityName(EntityHandle h, GenericCtx ctx)
            {
                try
                {
                    switch (h.Kind)
                    {
                        case HandleKind.TypeDefinition: return StripArity(GetTypeFromDefinition(_md, (TypeDefinitionHandle)h, 0));
                        case HandleKind.TypeReference: return StripArity(GetTypeFromReference(_md, (TypeReferenceHandle)h, 0));
                        case HandleKind.TypeSpecification: return GetTypeFromSpecification(_md, ctx, (TypeSpecificationHandle)h, 0);
                    }
                }
                catch { }
                return null;
            }
        }

        /// <summary>Enough of ICustomAttributeTypeProvider to read string / bool / int attribute arguments.</summary>
        private sealed class AttrProvider : ICustomAttributeTypeProvider<object>
        {
            public object GetPrimitiveType(PrimitiveTypeCode c) => c;
            public object GetSystemType() => "Type";
            public object GetSZArrayType(object e) => "array";
            public object GetTypeFromDefinition(MetadataReader md, TypeDefinitionHandle h, byte raw) => "def";
            public object GetTypeFromReference(MetadataReader md, TypeReferenceHandle h, byte raw) => "ref";
            public object GetTypeFromSerializedName(string name) => name;
            public PrimitiveTypeCode GetUnderlyingEnumType(object t) => PrimitiveTypeCode.Int32;
            public bool IsSystemType(object t) => t as string == "Type";
        }
    }
}
