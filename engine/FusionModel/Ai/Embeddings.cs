using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FusionModel.Ai
{
    /// <summary>Turns texts into vectors. Search works without one (words, fuzzy, glossary, values, graph); vectors add "meaning".</summary>
    public interface IEmbedder
    {
        /// <summary>Identifies the vectors (provider + model); cached vectors of another name are not reused.</summary>
        string Name { get; }
        Task<List<float[]>> EmbedAsync(IList<string> texts, bool isQuery, CancellationToken ct);
    }

    /// <summary>
    /// Voyage AI embeddings over HTTPS (https://api.voyageai.com/v1/embeddings). The key is passed in by the host,
    /// which keeps it encrypted; nothing is stored here.
    /// </summary>
    public sealed class VoyageEmbedder : IEmbedder
    {
        private readonly HttpClient _http;
        private readonly string _key;
        private readonly string _model;
        private readonly string _url;
        public const int Batch = 128;

        public VoyageEmbedder(HttpClient http, string apiKey, string model = "voyage-3.5", string url = "https://api.voyageai.com/v1/embeddings")
        {
            _http = http; _key = apiKey; _model = string.IsNullOrWhiteSpace(model) ? "voyage-3.5" : model; _url = url;
        }

        public string Name => "voyage:" + _model;

        public async Task<List<float[]>> EmbedAsync(IList<string> texts, bool isQuery, CancellationToken ct)
        {
            var all = new List<float[]>();
            for (int i = 0; i < texts.Count; i += Batch)
            {
                var chunk = texts.Skip(i).Take(Batch).ToList();
                using var req = new HttpRequestMessage(HttpMethod.Post, _url)
                {
                    Content = new StringContent(JsonSerializer.Serialize(new { input = chunk, model = _model, input_type = isQuery ? "query" : "document" }), Encoding.UTF8, "application/json")
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _key);
                using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
                string body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode) throw new InvalidOperationException("Embeddings failed (HTTP " + (int)resp.StatusCode + "): " + (body.Length > 300 ? body.Substring(0, 300) : body));
                using var doc = JsonDocument.Parse(body);
                var rows = doc.RootElement.GetProperty("data").EnumerateArray()
                    .Select(d => (Index: d.TryGetProperty("index", out var ix) ? ix.GetInt32() : 0, Vec: d.GetProperty("embedding").EnumerateArray().Select(x => x.GetSingle()).ToArray()))
                    .OrderBy(x => x.Index).Select(x => x.Vec).ToList();
                if (rows.Count != chunk.Count) throw new InvalidOperationException("Embeddings returned " + rows.Count + " vectors for " + chunk.Count + " texts.");
                all.AddRange(rows);
            }
            return all;
        }
    }

    /// <summary>
    /// Vectors for the catalog entries, cached on disk by text hash (only new or changed entries are embedded again).
    /// </summary>
    public sealed class VectorIndex
    {
        private readonly string _path;
        private Dictionary<string, float[]> _cache = new();
        private string _name;

        public VectorIndex(string path) { _path = path; }

        public static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).Substring(0, 20);

        private sealed class Stored { public string Name { get; set; } public Dictionary<string, float[]> Vectors { get; set; } = new(); }

        /// <summary>Makes sure every entry has a vector; returns how many were embedded now.</summary>
        public async Task<int> EnsureAsync(CatalogIndex ix, IEmbedder emb, CancellationToken ct)
        {
            if (_name != emb.Name)
            {
                var st = _path != null && File.Exists(_path) ? JsonSerializer.Deserialize<Stored>(File.ReadAllText(_path)) : null;
                _cache = st != null && st.Name == emb.Name ? st.Vectors ?? new() : new();
                _name = emb.Name;
            }
            var missing = ix.Entries.Select(CatalogIndex.EmbedText).Distinct().Where(t => !_cache.ContainsKey(Hash(t))).ToList();
            if (missing.Count == 0) return 0;
            var vecs = await emb.EmbedAsync(missing, false, ct).ConfigureAwait(false);
            for (int i = 0; i < missing.Count; i++) _cache[Hash(missing[i])] = Normalise(vecs[i]);
            if (_path != null)
            {
                // keep only what the catalog still has
                var live = new HashSet<string>(ix.Entries.Select(e => Hash(CatalogIndex.EmbedText(e))));
                Json.WriteAtomic(_path, new Stored { Name = _name, Vectors = _cache.Where(kv => live.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value) });
            }
            return missing.Count;
        }

        public async Task<List<(int Doc, double Score)>> SearchAsync(CatalogIndex ix, IEmbedder emb, string question, int k, CancellationToken ct)
        {
            await EnsureAsync(ix, emb, ct).ConfigureAwait(false);
            var q = Normalise((await emb.EmbedAsync(new[] { question }, true, ct).ConfigureAwait(false))[0]);
            var list = new List<(int, double)>();
            for (int i = 0; i < ix.Entries.Count; i++)
                if (_cache.TryGetValue(Hash(CatalogIndex.EmbedText(ix.Entries[i])), out var v) && v.Length == q.Length)
                {
                    double dot = 0; for (int j = 0; j < q.Length; j++) dot += q[j] * v[j];
                    list.Add((i, dot));
                }
            return list.Where(x => x.Item2 > 0.2).OrderByDescending(x => x.Item2).Take(k).ToList();
        }

        public static float[] Normalise(float[] v)
        {
            double n = Math.Sqrt(v.Sum(x => (double)x * x));
            return n == 0 ? v : v.Select(x => (float)(x / n)).ToArray();
        }
    }
}
