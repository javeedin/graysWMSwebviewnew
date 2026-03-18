using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;

namespace WMSApp
{
    /// <summary>
    /// Raw TcpListener-based HTTP server — no HTTP.sys, no admin rights, no netsh ACL needed.
    /// Listens on 0.0.0.0:8766 so any LAN device can POST to http://&lt;pc-ip&gt;:8766/notify
    /// </summary>
    public class MobileNotificationListener : IDisposable
    {
        public event Action<MobileNotification> NotificationReceived;

        public int  Port      { get; private set; }
        public bool IsRunning { get; private set; }

        private TcpListener            _tcp;
        private CancellationTokenSource _cts;
        private Thread                 _thread;

        private const int DEFAULT_PORT = 8766;

        public MobileNotificationListener(int port = DEFAULT_PORT)
        {
            Port = port;
        }

        // ── Start / Stop ──────────────────────────────────────────────────
        public void Start()
        {
            if (IsRunning) return;

            _tcp = new TcpListener(IPAddress.Any, Port);   // 0.0.0.0 — all interfaces
            _tcp.Start();

            IsRunning = true;
            _cts      = new CancellationTokenSource();
            _thread   = new Thread(AcceptLoop) { IsBackground = true, Name = "MobileNotifyListener" };
            _thread.Start();

            System.Diagnostics.Debug.WriteLine(
                $"[MobileListener] Started on 0.0.0.0:{Port}. IPs: {string.Join(", ", GetLocalIPs())}");
        }

        public void Stop()
        {
            if (!IsRunning) return;
            IsRunning = false;
            _cts?.Cancel();
            try { _tcp?.Stop(); } catch { }
            System.Diagnostics.Debug.WriteLine("[MobileListener] Stopped.");
        }

        // ── Accept loop ───────────────────────────────────────────────────
        private void AcceptLoop()
        {
            while (IsRunning)
            {
                try
                {
                    var client = _tcp.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
                }
                catch (SocketException) { break; }   // Stop() was called
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[MobileListener] AcceptLoop error: {ex.Message}");
                }
            }
        }

        // ── Handle one HTTP connection ─────────────────────────────────────
        private void HandleClient(TcpClient client)
        {
            try
            {
                using (client)
                using (var stream = client.GetStream())
                {
                    // Read request bytes (up to 64 KB, 3-second timeout)
                    stream.ReadTimeout = 3000;
                    var buf   = new byte[65536];
                    int total = 0;
                    try
                    {
                        int read;
                        while ((read = stream.Read(buf, total, buf.Length - total)) > 0)
                        {
                            total += read;
                            // Stop once we have the full request body
                            if (HasFullRequest(buf, total)) break;
                            if (total >= buf.Length) break;
                        }
                    }
                    catch (IOException) { /* read timeout — process what we have */ }

                    string raw = Encoding.UTF8.GetString(buf, 0, total);
                    ParseAndRespond(stream, raw);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[MobileListener] HandleClient error: {ex.Message}");
            }
        }

        // ── Parse minimal HTTP request, write response ────────────────────
        private void ParseAndRespond(NetworkStream stream, string raw)
        {
            // Split head / body on double CRLF
            int sep = raw.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            string head = sep >= 0 ? raw.Substring(0, sep) : raw;
            string body = sep >= 0 ? raw.Substring(sep + 4) : "";

            string[] lines  = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
            string   reqLine = lines.Length > 0 ? lines[0] : "";
            string[] parts  = reqLine.Split(' ');
            string   method = parts.Length > 0 ? parts[0].ToUpperInvariant() : "GET";
            string   path   = parts.Length > 1 ? parts[1].ToLowerInvariant().TrimEnd('/') : "/";

            const string cors =
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n" +
                "Access-Control-Allow-Headers: Content-Type\r\n";

            // OPTIONS preflight
            if (method == "OPTIONS")
            {
                WriteResponse(stream, 204, "No Content", cors, "");
                return;
            }

            // GET /ping — health check
            if (path.EndsWith("/ping") && method == "GET")
            {
                var pong = JsonConvert.SerializeObject(new { status = "ok", service = "GraysWMS", port = Port });
                WriteResponse(stream, 200, "OK", cors + "Content-Type: application/json\r\n", pong);
                return;
            }

            // POST /notify
            if (path.EndsWith("/notify") && method == "POST")
            {
                // Content-Length may be set — trim body to it
                foreach (var line in lines)
                {
                    if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                    {
                        if (int.TryParse(line.Substring(15).Trim(), out int len) && len < body.Length)
                            body = body.Substring(0, len);
                        break;
                    }
                }

                System.Diagnostics.Debug.WriteLine($"[MobileListener] Body: {body}");

                MobileNotification notif;
                try
                {
                    notif = JsonConvert.DeserializeObject<MobileNotification>(body)
                            ?? new MobileNotification { Type = "alert", Message = body };
                }
                catch { notif = new MobileNotification { Type = "alert", Message = body }; }

                notif.ReceivedAt = DateTime.Now;
                NotificationReceived?.Invoke(notif);

                var resp = JsonConvert.SerializeObject(new { status = "received", receivedAt = notif.ReceivedAt });
                WriteResponse(stream, 200, "OK", cors + "Content-Type: application/json\r\n", resp);
                return;
            }

            WriteResponse(stream, 404, "Not Found", cors, "{\"error\":\"not found\"}");
        }

        private static void WriteResponse(NetworkStream stream, int code, string status,
                                          string extraHeaders, string body)
        {
            byte[] bodyBytes = Encoding.UTF8.GetBytes(body);
            string header =
                $"HTTP/1.1 {code} {status}\r\n" +
                $"Content-Length: {bodyBytes.Length}\r\n" +
                "Connection: close\r\n" +
                extraHeaders +
                "\r\n";
            byte[] headerBytes = Encoding.UTF8.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (bodyBytes.Length > 0)
                stream.Write(bodyBytes, 0, bodyBytes.Length);
        }

        // Detect end of HTTP request (headers + body via Content-Length)
        private static bool HasFullRequest(byte[] buf, int total)
        {
            string text = Encoding.UTF8.GetString(buf, 0, total);
            int sep = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (sep < 0) return false;   // headers not fully received yet

            string head = text.Substring(0, sep);
            foreach (var line in head.Split(new[] { "\r\n" }, StringSplitOptions.None))
            {
                if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                {
                    if (int.TryParse(line.Substring(15).Trim(), out int len))
                        return (total - sep - 4) >= len;
                    break;
                }
            }
            return true;   // no Content-Length → headers only (e.g. GET)
        }

        /// <summary>Returns all non-loopback IPv4 addresses of this machine.</summary>
        public static string[] GetLocalIPs()
        {
            var ips = new System.Collections.Generic.List<string>();
            try
            {
                foreach (var addr in Dns.GetHostEntry(Dns.GetHostName()).AddressList)
                    if (addr.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(addr))
                        ips.Add(addr.ToString());
            }
            catch { }
            if (ips.Count == 0) ips.Add("127.0.0.1");
            return ips.ToArray();
        }

        public void Dispose() => Stop();
    }

    // ── Notification payload ───────────────────────────────────────────────
    public class MobileNotification
    {
        [JsonProperty("type")]        public string   Type        { get; set; } = "alert";
        [JsonProperty("orderNumber")] public string   OrderNumber { get; set; }
        [JsonProperty("message")]     public string   Message     { get; set; }
        [JsonProperty("sender")]      public string   Sender      { get; set; }
        [JsonProperty("data")]        public object   Data        { get; set; }
        public DateTime ReceivedAt { get; set; }
    }
}
