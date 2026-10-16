using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens › Board packs › New › "Design from a PDF or picture": Claude looks at a board pack, report, brand guide
    /// or screenshot the user uploads and proposes a pack design (brand colours, layout, menu, cover banner, font, the
    /// sections in order mapped to this app's section types and statement templates). The answer is one ```packdesign
    /// JSON block the page turns into a pack for the user to check before it is created. Only the design is used — the
    /// numbers in the document are not copied. The Claude key is the Fusion SQL one (DPAPI, never sent to the page).
    /// </summary>
    public static class FinancePackAi
    {
        public const string DEFAULT_MODEL = "claude-opus-5-5";
        public const int MAX_BYTES = 15 * 1024 * 1024;

        public sealed class Result
        {
            public bool Ok { get; set; }
            public string Answer { get; set; }
            public string Error { get; set; }
            public string Model { get; set; }
            public long TokensIn { get; set; }
            public long TokensOut { get; set; }
            public long CacheRead { get; set; }
            public long CacheWrite { get; set; }
        }

        private const string GUIDE = @"You design board packs for Finance Lens, a CFO tool. A board pack is one interactive HTML document built from the general ledger:
a menu of pages, a cover banner on the Summary page, statements whose lines open into accounts, KPI tiles, charts.
The user uploads a document (a board pack, management report, annual report, brand guide or a screenshot). Study its look and structure and
propose a Finance Lens pack that feels the same. Copy the DESIGN only — never the numbers, names of people or confidential text.

Answer with a short paragraph of what you saw, then ONE fenced block ```packdesign containing JSON:
{
  ""name"": ""short design name"", ""title"": ""title on the cover"", ""company"": ""company or group name if shown, else empty"",
  ""brand"": { ""a"": ""#hex main colour (dark enough for white text)"", ""b"": ""#hex second colour"", ""c"": ""#hex accent"" },
  ""layout"": ""side | right | rail | top | cards | doc"",
  ""menu"": ""theme | grad | dark | white | tint"",
  ""paper"": ""grey | white"", ""font"": ""sans | serif"",
  ""hero"": { ""style"": ""grad | solid | dark | soft | white | minimal"", ""deco"": ""none | dots | rings | lines | grid | glow"", ""size"": ""compact | normal | tall"", ""align"": ""left | center"" },
  ""scale"": 0 | 1 | 1000 | 1000000,
  ""sections"": [ { ""type"": ""one of the section types"", ""title"": ""page title as in the document"", ""statement"": ""PL | BS | CF | a template id (statement sections only)"",
                  ""cols"": ""a column set key, or _tpl"", ""range"": ""MTD | QTD | YTD | LTM (trial balance only)"", ""text"": ""Markdown for text pages (structure / headings only, with placeholders)"", ""why"": ""which page of the document this matches"" } ],
  ""notes"": [ ""what could not be matched or needs the user's choice"" ]
}
Rules:
- Colours: read them from the document itself (headers, cover, charts, logo). The main colour carries white text; pick its darkest brand tone.
- layout: side = a contents column on the left; right = on the right; top = tabs along the top; cards = a contents page of tiles; doc = one long report read top to bottom (a printed PDF report is usually doc or side); rail = a slim icon bar.
- menu: dark brand menu = theme; gradient = grad; near-black = dark; white menu = white; light tinted = tint.
- hero (the cover band): gradient band = grad, flat colour = solid, black = dark, pale colour = soft, white with a coloured edge = white, plain title with a rule = minimal.
- font serif when the document uses a serif typeface for headings or text.
- scale: 1000 when amounts are in thousands, 1000000 in millions, 1 in units, 0 when unclear.
- sections: follow the document's order. Use only the section types and statement templates listed in CATALOGUE. A management commentary page = text (or the summary note);
  an income statement / P&L = statement with PL (or the best template id); balance sheet / financial position = BS; cash flow = CF; KPI / dashboard pages = kpis; charts = charts;
  trial balance = tb; exceptions / alerts = monitor. Always start with one summary section. Leave out pages that have no equivalent and list them in notes.
- cols: when the document shows month / YTD / budget / last year columns, choose the closest column set of that statement kind from CATALOGUE.";

        /// <summary>Asks Claude for a pack design from a PDF or a picture (base64). catalogue = what the page offers (section types, templates, column sets).</summary>
        public static async Task<Result> DesignAsync(string fileName, string mime, string base64, string notes, string catalogue, string model, CancellationToken ct)
        {
            var res = new Result { Model = string.IsNullOrWhiteSpace(model) ? DEFAULT_MODEL : model };
            string key = WMSApp.FusionSql.FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key)) { res.Error = "No Claude API key saved. Add it in Fusion SQL › Ask AI (⚙)."; return res; }
            if (string.IsNullOrWhiteSpace(base64)) { res.Error = "Choose a PDF or a picture first."; return res; }
            if (base64.Length / 4 * 3 > MAX_BYTES) { res.Error = "The file is larger than 15 MB — use fewer pages or a smaller picture."; return res; }
            mime = (mime ?? "").Trim().ToLowerInvariant();
            ContentBlockParam doc;
            if (mime == "application/pdf" || (fileName ?? "").EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                doc = new DocumentBlockParam { Source = new Base64PdfSource { Data = base64 } };
            else
            {
                MediaType mt = mime == "image/png" ? MediaType.ImagePng : mime == "image/gif" ? MediaType.ImageGif : mime == "image/webp" ? MediaType.ImageWebP : MediaType.ImageJpeg;
                doc = new ImageBlockParam { Source = new Base64ImageSource { Data = base64, MediaType = mt } };
            }
            if (catalogue != null && catalogue.Length > 30000) catalogue = catalogue.Substring(0, 30000);
            var content = new List<ContentBlockParam>
            {
                doc,
                new TextBlockParam { Text = "CATALOGUE (what this Finance Lens offers)\n" + (catalogue ?? "{}") +
                    "\n\nFILE: " + (fileName ?? "upload") + (string.IsNullOrWhiteSpace(notes) ? "" : "\n\nTHE USER ASKS: " + (notes.Length > 2000 ? notes.Substring(0, 2000) : notes)) +
                    "\n\nDesign the board pack now." }
            };
            var client = new AnthropicClient { ApiKey = key };
            try
            {
                var req = new MessageCreateParams
                {
                    Model = res.Model,
                    MaxTokens = 16000,
                    System = GUIDE,
                    Thinking = new ThinkingConfigAdaptive(),
                    Messages = new List<MessageParam> { new MessageParam { Role = Role.User, Content = content } },
                };
                var resp = await client.Messages.Create(req, ct).ConfigureAwait(false);
                if (resp.Usage != null)
                {
                    res.TokensIn = resp.Usage.InputTokens; res.TokensOut = resp.Usage.OutputTokens;
                    res.CacheRead = resp.Usage.CacheReadInputTokens ?? 0; res.CacheWrite = resp.Usage.CacheCreationInputTokens ?? 0;
                }
                var text = new StringBuilder();
                foreach (ContentBlock block in resp.Content) if (block.TryPickText(out TextBlock t)) text.Append(t.Text);
                if (text.Length == 0)
                {
                    string stop = resp.StopReason?.ToString() ?? "";
                    res.Error = stop.IndexOf("refusal", StringComparison.OrdinalIgnoreCase) >= 0 ? "Claude declined this request." : "Claude returned no answer (" + stop + ").";
                    return res;
                }
                res.Ok = true; res.Answer = text.ToString();
                return res;
            }
            catch (OperationCanceledException) { res.Error = "Cancelled."; return res; }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[Finance pack AI] " + ex);
                res.Error = "Claude API error: " + ex.Message;
                return res;
            }
        }
    }
}
