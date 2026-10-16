using System.IO.Compression;
using System.Text.Json;
using FusionModel;
using FusionModel.Access;
using FusionModel.Licensing;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>Product shell: signed licences, API tokens, BICC extract loading.</summary>
    public sealed class Phase5Tests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fm5_" + Guid.NewGuid().ToString("N"));
        public Phase5Tests() { Directory.CreateDirectory(_dir); }
        public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }

        [Fact]
        public void Licences_verify_only_when_signed_by_the_vendor_key_and_not_expired()
        {
            var (priv, pub) = Licences.CreateKeyPair();
            var lic = new LicenceInfo { Customer = "Terragri Ltd", Edition = "enterprise", Packs = { "gl", "ap" }, Features = { "server", "mcp" }, MaxUsers = 25, ExpiresUtc = new DateTime(2027, 12, 31, 0, 0, 0, DateTimeKind.Utc) };
            var file = Licences.Sign(lic, priv);
            Assert.Equal(Licences.KeyIdOf(pub), file.KeyId);

            // round trip through the file on disk
            string path = Path.Combine(_dir, "licence.json");
            File.WriteAllText(path, JsonSerializer.Serialize(file, Json.Options));
            var ok = Licences.VerifyFile(path, pub, new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc));
            Assert.True(ok.Valid, ok.Reason);
            Assert.True(ok.Allows("gl", "pack")); Assert.False(ok.Allows("inv", "pack"));
            Assert.True(ok.Allows("mcp")); Assert.False(ok.Allows("bicc"));
            Assert.Equal(456, ok.DaysLeft);

            Assert.False(Licences.VerifyFile(path, pub, new DateTime(2028, 1, 1, 0, 0, 0, DateTimeKind.Utc)).Valid);   // expired
            var other = Licences.CreateKeyPair();
            Assert.Contains("signature", Licences.VerifyFile(path, other.PublicKey).Reason);                                 // someone else's key
            var tampered = JsonSerializer.Deserialize<LicenceFile>(File.ReadAllText(path), Json.Options)!;
            tampered.Licence.MaxUsers = 1000;
            Assert.False(Licences.Verify(tampered, pub).Valid);                                                                   // edited
            Assert.Contains("development build", Licences.Verify(file).Reason);                                                  // no vendor key built in
        }

        [Fact]
        public void Tokens_are_stored_hashed_and_can_be_revoked()
        {
            string path = Path.Combine(_dir, "tokens.json");
            var store = new TokenStore(path);
            var (t, secret) = store.Create("Power BI", "north.user", new[] { "read", "admin", "bogus" });
            Assert.StartsWith("fm_", secret);
            Assert.Equal(new[] { "read", "admin" }, t.Scopes);
            Assert.DoesNotContain(secret, File.ReadAllText(path));
            Assert.Equal("north.user", new TokenStore(path).Validate(secret)!.User);
            Assert.Null(store.Validate(secret + "x"));
            Assert.Null(store.Validate(""));
            Assert.Equal(1, store.ActiveUsers());
            Assert.True(store.Revoke(t.Id));
            Assert.Null(new TokenStore(path).Validate(secret));
            Assert.Throws<ArgumentException>(() => store.Create("x", "", null));
        }

        [Fact]
        public void Csv_parser_and_dates()
        {
            var rows = BiccSource.Csv(new StringReader("A,B,C\r\n1,\"x, \"\"y\"\"\",\"line1\nline2\"\n2,,z")).ToList();
            Assert.Equal(3, rows.Count);
            Assert.Equal(new[] { "1", "x, \"y\"", "line1\nline2" }, rows[1]);
            Assert.Equal(new[] { "2", "", "z" }, rows[2]);
            Assert.Equal("2026-10-01", BiccSource.NormDate("2026/10/01"));
            Assert.Equal("2026-10-01 06:05:00", BiccSource.NormDate("2026-10-01T06:05:00.000+00:00"));
            Assert.Equal("not a date", BiccSource.NormDate("not a date"));
        }

        [Fact]
        public async Task Bicc_extracts_load_full_then_incremental_newest_wins()
        {
            string bicc = Path.Combine(_dir, "bicc"); Directory.CreateDirectory(bicc);
            // day 1: a full extract as a zip (BICC to UCM), VO attribute names as headers
            string zip1 = Path.Combine(bicc, "file_invoiceextractpvo-batch1-20261001_060000.zip");
            using (var z = ZipFile.Open(zip1, ZipArchiveMode.Create))
            {
                using (var w = new StreamWriter(z.CreateEntry("file_invoiceextractpvo-batch1-20261001_060000.csv").Open()))
                    w.Write("INVOICEID,INVOICENUM,INVOICEAMOUNT,LASTUPDATEDATE\n1,INV-1,100,2026/09/28\n2,INV-2,200,2026/09/30\n3,\"INV-3, credit\",-50,2026/09/29\n");
                z.CreateEntry("MANIFEST.MF");
            }
            File.SetLastWriteTimeUtc(zip1, new DateTime(2026, 10, 1, 6, 0, 0, DateTimeKind.Utc));
            var e = new ModelEngine(Path.Combine(_dir, "s.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared"), CacheRoot = Path.Combine(_dir, "cache"), ReadMode = "DIRECT" });
            e.SaveSettings(e.Settings);
            var t = new TableDef
            {
                Module = "ap", Name = "invoices", Key = { "INVOICE_ID" }, Strategy = LoadStrategy.Incremental, IncrementalColumn = "LAST_UPDATE_DATE", OverlapMinutes = 0,
                Source = new SourceDef { Kind = "bicc", Path = Path.Combine(bicc, "file_invoiceextractpvo-*"),
                    Rename = new() { ["INVOICEID"] = "INVOICE_ID", ["INVOICENUM"] = "INVOICE_NUM", ["INVOICEAMOUNT"] = "INVOICE_AMOUNT", ["LASTUPDATEDATE"] = "LAST_UPDATE_DATE" } },
                ColumnTypes = { ["INVOICE_ID"] = "BIGINT", ["INVOICE_AMOUNT"] = "DOUBLE", ["LAST_UPDATE_DATE"] = "TIMESTAMP" }
            };
            e.SaveModel(new ModelDefinition { Modules = { new ModuleDef { Name = "ap" } }, Tables = { t } });
            var r1 = await e.RefreshAsync("ap", null, false, "t", null, default);
            Assert.True(r1.Ok, r1.Error);
            Assert.Equal(3L, e.Query("SELECT COUNT(*) FROM ap.invoices").Rows[0][0]);
            Assert.Equal("INV-3, credit", e.Query("SELECT INVOICE_NUM FROM ap.invoices WHERE INVOICE_ID = 3").Rows[0][0]);

            // day 2: an incremental extract - invoice 2 changed twice (two files: the newest wins), invoice 4 is new
            string csv2 = Path.Combine(bicc, "file_invoiceextractpvo-batch2-20261002_060000.csv");
            File.WriteAllText(csv2, "INVOICEID,INVOICENUM,INVOICEAMOUNT,LASTUPDATEDATE\n2,INV-2,210,2026-10-01T10:00:00.000+00:00\n4,INV-4,400,2026-10-01T11:00:00.000+00:00\n");
            File.SetLastWriteTimeUtc(csv2, new DateTime(2026, 10, 2, 6, 0, 0, DateTimeKind.Utc));
            string csv3 = Path.Combine(bicc, "file_invoiceextractpvo-batch3-20261003_060000.csv");
            File.WriteAllText(csv3, "INVOICEID,INVOICENUM,INVOICEAMOUNT,LASTUPDATEDATE\n2,INV-2,220,2026-10-02T09:00:00.000+00:00\n");
            File.SetLastWriteTimeUtc(csv3, new DateTime(2026, 10, 3, 6, 0, 0, DateTimeKind.Utc));
            var r2 = await e.RefreshAsync("ap", null, false, "t", null, default);
            Assert.True(r2.Ok, r2.Error);
            Assert.Equal("incremental", r2.Tables[0].Mode);
            var rows = e.Query("SELECT INVOICE_ID, INVOICE_AMOUNT FROM ap.invoices ORDER BY 1").Rows.Select(x => Convert.ToInt64(x[0]) + "=" + Convert.ToDouble(x[1])).ToList();
            Assert.Equal(new[] { "1=100", "2=220", "3=-50", "4=400" }, rows);
            Assert.Equal(2, r2.Tables[0].Loaded);                        // only the changed rows were read again
        }
        [Fact]
        public async Task Fusion_sql_result_sent_to_the_model_loads_with_its_dates()
        {
            var e = new ModelEngine(Path.Combine(_dir, "s2.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared2"), CacheRoot = Path.Combine(_dir, "cache2"), ReadMode = "DIRECT" });
            e.SaveSettings(e.Settings);
            e.RegisterSource(new FusionSource((sql, max, ct) => Task.FromResult((true, (string)null, new List<Dictionary<string, object>>
            {
                new() { ["INVOICE_ID"] = "1", ["INVOICE_DATE"] = "2026-01-31T00:00:00.000+00:00", ["AMOUNT"] = "100.5", ["LAST_UPDATE_DATE"] = "2026-02-01T08:15:00.000+00:00" },
                new() { ["INVOICE_ID"] = "2", ["INVOICE_DATE"] = "2026/02/28", ["AMOUNT"] = "40", ["LAST_UPDATE_DATE"] = "" }
            })), "fusion:TEST"));
            var t = new TableDef
            {
                Module = "fsql", Name = "open_invoices", Description = "From Fusion SQL", Key = { "INVOICE_ID" }, Paging = "rownum",
                Source = new SourceDef { Kind = "fusion:TEST", Sql = "SELECT invoice_id, invoice_date, amount FROM ap_invoices_all" },
                ColumnTypes = { ["INVOICE_ID"] = "BIGINT", ["INVOICE_DATE"] = "DATE", ["AMOUNT"] = "DOUBLE", ["LAST_UPDATE_DATE"] = "TIMESTAMP" }
            };
            var m = e.AddTable(t, "Fusion SQL", replace: false);
            Assert.Equal("Fusion SQL", m.Module("fsql").Title);
            Assert.Throws<InvalidOperationException>(() => e.AddTable(t, null, replace: false));      // exists
            e.AddTable(t, null, replace: true);
            Assert.Throws<ArgumentException>(() => e.AddTable(new TableDef { Module = "Bad Name", Name = "x" }, null, false));
            var r = await e.RefreshAsync("fsql", new[] { "open_invoices" }, true, "t", null, default);
            Assert.True(r.Ok, r.Error);
            var q = e.Query("SELECT typeof(INVOICE_DATE), CAST(INVOICE_DATE AS VARCHAR), typeof(LAST_UPDATE_DATE), SUM(AMOUNT) OVER () FROM fsql.open_invoices ORDER BY INVOICE_ID");
            Assert.Equal("DATE", q.Rows[0][0]);
            Assert.Equal("2026-01-31", q.Rows[0][1]);
            Assert.Equal("2026-02-28", q.Rows[1][1]);
            Assert.Equal("TIMESTAMP", q.Rows[0][2]);
            Assert.Equal(140.5, Convert.ToDouble(q.Rows[0][3]));
        }
    }
}
