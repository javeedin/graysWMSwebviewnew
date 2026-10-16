using System.Diagnostics;
using FusionModel.Ai;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>Quick dashboard never holds the page: empty models answer at once, slow queries stop at their limit, cancel stops them.</summary>
    public class QuickDashboardLimitTests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fmqd_" + Guid.NewGuid().ToString("N"));
        private readonly ModelEngine _e;

        public QuickDashboardLimitTests()
        {
            Directory.CreateDirectory(_dir);
            _e = new ModelEngine(Path.Combine(_dir, "s.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared"), CacheRoot = Path.Combine(_dir, "cache"), ReadMode = "DIRECT" });
        }

        public void Dispose() { _e.Dispose(); try { Directory.Delete(_dir, true); } catch { } }

        private const string Slow = "SELECT count(*) FROM range(3000000000) a WHERE a.range % 7 = 3";

        [Fact]
        public void Empty_model_or_pack_not_loaded_says_why_at_once()
        {
            var sw = Stopwatch.StartNew();
            var ex = Assert.Throws<InvalidOperationException>(() => DashboardCopilot.Auto(_e, "t", null, null, null, default, new List<string>()));
            Assert.Contains("No measures", ex.Message);
            var m = _e.LoadModel(); FusionModel.Packs.FusionPacks.Apply(m, FusionModel.Packs.FusionPacks.Get("gl")); _e.SaveModel(m);
            Assert.Throws<InvalidOperationException>(() => DashboardCopilot.Auto(_e, "t"));
            Assert.True(sw.ElapsedMilliseconds < 5000, "took " + sw.ElapsedMilliseconds + " ms");
        }

        [Fact]
        public void A_slow_query_stops_at_its_limit_and_the_session_keeps_working()
        {
            var sw = Stopwatch.StartNew();
            var ex = Assert.Throws<TimeoutException>(() => _e.Query(Slow, 1, TimeSpan.FromMilliseconds(300)));
            Assert.True(sw.ElapsedMilliseconds < 5000, "took " + sw.ElapsedMilliseconds + " ms");
            Assert.Contains("took too long", ex.Message);
            Assert.Equal(42L, Convert.ToInt64(_e.Query("SELECT 42", 1).Rows[0][0]));
        }
    }
}
