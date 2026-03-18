using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace WMSApp
{
    /// <summary>
    /// Lightweight HTTP listener that receives push notifications from the
    /// Gray's WMS React-Native mobile app via a plain JSON POST request.
    ///
    /// Mobile app POSTs to:  http://<desktop-ip>:8766/notify
    ///
    /// Expected JSON body:
    /// {
    ///   "type":        "order_update" | "alert" | "status_change" | "action",
    ///   "orderNumber": "SO-12345",
    ///   "message":     "Human-readable text shown in the toast",
    ///   "sender":      "Driver's device name / username  (optional)",
    ///   "data":        { }   // any extra key-value pairs  (optional)
    /// }
    /// </summary>
    public class MobileNotificationListener : IDisposable
    {
        // ── Public API ────────────────────────────────────────────────────
        public event Action<MobileNotification> NotificationReceived;

        public int  Port      { get; private set; }
        public bool IsRunning { get; private set; }

        // ── Privates ──────────────────────────────────────────────────────
        private HttpListener         _listener;
        private CancellationTokenSource _cts;
        private Thread               _thread;

        private const int DEFAULT_PORT = 8766;

        public MobileNotificationListener(int port = DEFAULT_PORT)
        {
            Port = port;
        }

        // ── Start / Stop ──────────────────────────────────────────────────
        public void Start()
        {
            if (IsRunning) return;

            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://+:{Port}/notify/");
            _listener.Prefixes.Add($"http://+:{Port}/ping/");

            try
            {
                _listener.Start();
            }
            catch (HttpListenerException ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[MobileListener] Wildcard bind failed ({ex.Message}). Registering specific IPs...");

                // Wildcard (+) requires admin / netsh ACL.
                // Fall back to explicit localhost + each local IP — no admin needed.
                _listener = new HttpListener();
                _listener.Prefixes.Add($"http://localhost:{Port}/notify/");
                _listener.Prefixes.Add($"http://localhost:{Port}/ping/");
                _listener.Prefixes.Add($"http://127.0.0.1:{Port}/notify/");
                _listener.Prefixes.Add($"http://127.0.0.1:{Port}/ping/");

                foreach (var ip in GetLocalIPs())
                {
                    _listener.Prefixes.Add($"http://{ip}:{Port}/notify/");
                    _listener.Prefixes.Add($"http://{ip}:{Port}/ping/");
                }

                _listener.Start();
                System.Diagnostics.Debug.WriteLine(
                    $"[MobileListener] Fallback: listening on specific IPs on port {Port}.");
            }

            IsRunning = true;
            _cts     = new CancellationTokenSource();
            _thread  = new Thread(ListenLoop) { IsBackground = true, Name = "MobileNotifyListener" };
            _thread.Start();

            System.Diagnostics.Debug.WriteLine(
                $"[MobileListener] Started on port {Port}. Local IPs: {string.Join(", ", GetLocalIPs())}");
        }

        public void Stop()
        {
            if (!IsRunning) return;
            IsRunning = false;
            _cts?.Cancel();
            try { _listener?.Stop(); } catch { }
            System.Diagnostics.Debug.WriteLine("[MobileListener] Stopped.");
        }

        // ── Main listen loop (background thread) ──────────────────────────
        private void ListenLoop()
        {
            while (IsRunning && !_cts.IsCancellationRequested)
            {
                try
                {
                    var ctx = _listener.GetContext();   // blocks until request arrives
                    Task.Run(() => HandleRequest(ctx)); // process off the listener thread
                }
                catch (HttpListenerException)
                {
                    // Listener was stopped — normal exit
                    break;
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[MobileListener] Loop error: {ex.Message}");
                }
            }
        }

        // ── Handle a single HTTP request ──────────────────────────────────
        private void HandleRequest(HttpListenerContext ctx)
        {
            var req  = ctx.Request;
            var resp = ctx.Response;

            // CORS — required so React-Native fetch() (and browsers) can POST
            resp.Headers.Add("Access-Control-Allow-Origin",  "*");
            resp.Headers.Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
            resp.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

            try
            {
                // Preflight
                if (req.HttpMethod == "OPTIONS")
                {
                    resp.StatusCode = 204;
                    resp.Close();
                    return;
                }

                // ── /ping — health-check so the mobile app can confirm connectivity
                if (req.Url.AbsolutePath.TrimEnd('/').EndsWith("/ping", StringComparison.OrdinalIgnoreCase))
                {
                    WriteJson(resp, 200, new { status = "ok", service = "GraysWMS", port = Port });
                    return;
                }

                // ── /notify — receive notification POST
                if (req.HttpMethod != "POST")
                {
                    WriteJson(resp, 405, new { error = "POST required" });
                    return;
                }

                string body;
                using (var sr = new StreamReader(req.InputStream, req.ContentEncoding))
                    body = sr.ReadToEnd();

                System.Diagnostics.Debug.WriteLine($"[MobileListener] Received: {body}");

                MobileNotification notification;
                try
                {
                    notification = JsonConvert.DeserializeObject<MobileNotification>(body)
                                   ?? new MobileNotification { Type = "alert", Message = body };
                }
                catch
                {
                    notification = new MobileNotification { Type = "alert", Message = body };
                }

                notification.ReceivedAt = DateTime.Now;

                // Fire event on a thread-pool thread so we don't block the listener
                NotificationReceived?.Invoke(notification);

                WriteJson(resp, 200, new { status = "received", receivedAt = notification.ReceivedAt });
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[MobileListener] HandleRequest error: {ex.Message}");
                try { WriteJson(resp, 500, new { error = ex.Message }); } catch { }
            }
        }

        // ── Helpers ───────────────────────────────────────────────────────
        private static void WriteJson(HttpListenerResponse resp, int status, object payload)
        {
            resp.StatusCode  = status;
            resp.ContentType = "application/json";
            var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(payload));
            resp.ContentLength64 = bytes.Length;
            resp.OutputStream.Write(bytes, 0, bytes.Length);
            resp.Close();
        }

        /// <summary>Returns all non-loopback IPv4 addresses of this machine.</summary>
        public static string[] GetLocalIPs()
        {
            var ips = new System.Collections.Generic.List<string>();
            try
            {
                foreach (var addr in Dns.GetHostEntry(Dns.GetHostName()).AddressList)
                {
                    if (addr.AddressFamily == AddressFamily.InterNetwork &&
                        !IPAddress.IsLoopback(addr))
                        ips.Add(addr.ToString());
                }
            }
            catch { }
            if (ips.Count == 0) ips.Add("127.0.0.1");
            return ips.ToArray();
        }

        public void Dispose() => Stop();
    }

    // ── Notification payload model ─────────────────────────────────────────
    public class MobileNotification
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "alert";           // order_update | alert | status_change | action

        [JsonProperty("orderNumber")]
        public string OrderNumber { get; set; }

        [JsonProperty("message")]
        public string Message { get; set; }

        [JsonProperty("sender")]
        public string Sender { get; set; }

        [JsonProperty("data")]
        public object Data { get; set; }

        // Set by the listener, not by the mobile app
        public DateTime ReceivedAt { get; set; }
    }
}
