using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace WMSApp
{
    /// <summary>
    /// The AI Agent's `hardware` tool: what this PC is, has and is connected to. Everything is READ-ONLY except the
    /// two printer controls (set_default_printer, cancel_print_jobs), which are confirm cards (policy device_control).
    /// No free shell: only fixed commands (netsh wlan, wevtutil) with fixed arguments, .NET APIs and WMI. `wmi` takes a
    /// WQL SELECT on the Win32_ / CIM_ / MSFT_ classes of the local machine — a query, never a method call.
    ///   summary, network, wifi, wifi_networks, cpu_memory, disks, usb, devices (class=… / problems), printers,
    ///   print_queue, battery, displays, bios, os, software (name=…), processes (name=…), services (name=… state=…),
    ///   events (log=System|Application), ping (host), port (host, port), wmi (query)
    /// </summary>
    public static class HardwareInfo
    {
        public static readonly string[] READ_OPS = {
            "summary", "network", "wifi", "wifi_networks", "cpu_memory", "disks", "usb", "devices", "printers", "print_queue", "battery",
            "displays", "bios", "os", "software", "processes", "services", "events", "ping", "port", "wmi" };
        public static readonly string[] CONTROL_OPS = { "set_default_printer", "cancel_print_jobs" };
        private const int MAX_ROWS = 300;

        public static bool IsControl(string op) => CONTROL_OPS.Contains((op ?? "").ToLowerInvariant());

        public static async Task<object> RunAsync(string op, Func<string, string> arg)
        {
            op = (op ?? "summary").Trim().ToLowerInvariant();
            try
            {
                object data = op switch
                {
                    "summary" => Summary(),
                    "network" => Network(),
                    "wifi" => await WifiAsync(),
                    "wifi_networks" => await WifiNetworksAsync(),
                    "cpu_memory" => CpuMemory(),
                    "disks" => Disks(),
                    "usb" => Wmi("SELECT Name, Manufacturer, PNPClass, Status, DeviceID FROM Win32_PnPEntity WHERE DeviceID LIKE 'USB%' OR PNPDeviceID LIKE 'USB%'"),
                    "devices" => Devices(arg("class"), arg("problems")),
                    "printers" => Wmi("SELECT Name, Default, WorkOffline, PrinterStatus, DetectedErrorState, ExtendedPrinterStatus, PortName, DriverName, Shared, ShareName, Network, Local, Location, Comment FROM Win32_Printer"),
                    "print_queue" => Wmi("SELECT JobId, Name, Document, Owner, JobStatus, Status, TotalPages, PagesPrinted, Size, TimeSubmitted FROM Win32_PrintJob"),
                    "battery" => Battery(),
                    "displays" => Displays(),
                    "bios" => new
                    {
                        computer = Wmi("SELECT Manufacturer, Model, SystemType, TotalPhysicalMemory, Domain, PartOfDomain, UserName FROM Win32_ComputerSystem"),
                        bios = Wmi("SELECT Manufacturer, SMBIOSBIOSVersion, SerialNumber, ReleaseDate FROM Win32_BIOS"),
                        board = Wmi("SELECT Manufacturer, Product, SerialNumber FROM Win32_BaseBoard"),
                        product = Wmi("SELECT IdentifyingNumber, Name, Vendor, UUID FROM Win32_ComputerSystemProduct")
                    },
                    "os" => new
                    {
                        os = Wmi("SELECT Caption, Version, BuildNumber, OSArchitecture, InstallDate, LastBootUpTime, RegisteredUser, Locale, CurrentTimeZone FROM Win32_OperatingSystem"),
                        timeZone = TimeZoneInfo.Local.DisplayName,
                        uptime = TimeSpan.FromMilliseconds(Environment.TickCount64).ToString(@"d\.hh\:mm"),
                        user = Environment.UserDomainName + "\\" + Environment.UserName,
                        dotnet = Environment.Version.ToString()
                    },
                    "software" => Software(arg("name")),
                    "processes" => Processes(arg("name")),
                    "services" => Services(arg("name"), arg("state")),
                    "events" => await EventsAsync(arg("log"), arg("count")),
                    "ping" => await PingAsync(arg("host")),
                    "port" => await PortAsync(arg("host"), arg("port")),
                    "wmi" => WmiQuery(arg("query")),
                    _ => null
                };
                if (data == null)
                    return new { ok = false, content = "Unknown hardware op '" + op + "'. Ops: " + string.Join(", ", READ_OPS) + "; controls (confirm card): " + string.Join(", ", CONTROL_OPS) + "." };
                return new { ok = true, content = JsonSerializer.Serialize(new { op, machine = Environment.MachineName, data }) };
            }
            catch (Exception ex)
            {
                return new { ok = false, content = "hardware " + op + " failed: " + ex.Message };
            }
        }

        /// <summary>The printer controls - called only after the confirm card (policy device_control).</summary>
        public static object Control(string op, Func<string, string> arg)
        {
            op = (op ?? "").ToLowerInvariant();
            try
            {
                string printer = arg("printer");
                if (string.IsNullOrWhiteSpace(printer)) return new { ok = false, content = "Give printer (the exact name from op printers)." };
                string lit = printer.Replace("\\", "\\\\").Replace("'", "\\'");
                using var s = new ManagementObjectSearcher("SELECT * FROM Win32_Printer WHERE Name = '" + lit + "'");
                var p = s.Get().Cast<ManagementObject>().FirstOrDefault();
                if (p == null) return new { ok = false, content = "No printer named '" + printer + "'." };
                if (op == "set_default_printer")
                {
                    var r = p.InvokeMethod("SetDefaultPrinter", null);
                    return new { ok = Convert.ToInt32(r ?? 0) == 0, content = "Default printer set to " + printer + " (result " + r + ")." };
                }
                if (op == "cancel_print_jobs")
                {
                    int n = 0, failed = 0;
                    using var js = new ManagementObjectSearcher("SELECT * FROM Win32_PrintJob");
                    foreach (ManagementObject j in js.Get())
                    {
                        string name = Convert.ToString(j["Name"]) ?? "";       // "Printer Name, 12"
                        if (!name.StartsWith(printer + ",", StringComparison.OrdinalIgnoreCase)) continue;
                        try { j.Delete(); n++; } catch { failed++; }
                    }
                    return new { ok = failed == 0, content = "Cancelled " + n + " job(s) on " + printer + (failed > 0 ? "; " + failed + " could not be cancelled (other users' jobs need admin rights)." : ".") };
                }
                return new { ok = false, content = "Unknown control op " + op };
            }
            catch (Exception ex) { return new { ok = false, content = op + " failed: " + ex.Message }; }
        }

        // ── ops ──────────────────────────────────────────────
        private static object Summary()
        {
            var cs = Wmi("SELECT Manufacturer, Model, TotalPhysicalMemory FROM Win32_ComputerSystem").FirstOrDefault();
            var cpu = Wmi("SELECT Name, NumberOfCores, NumberOfLogicalProcessors FROM Win32_Processor").FirstOrDefault();
            var os = Wmi("SELECT Caption, Version, FreePhysicalMemory, TotalVisibleMemorySize FROM Win32_OperatingSystem").FirstOrDefault();
            var up = NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Select(n => n.Name + " (" + n.NetworkInterfaceType + ")").ToList();
            return new
            {
                machine = Environment.MachineName, user = Environment.UserName, model = cs, cpu, os,
                uptime = TimeSpan.FromMilliseconds(Environment.TickCount64).ToString(@"d\.hh\:mm"),
                networkUp = up, internet = NetworkInterface.GetIsNetworkAvailable(),
                drives = DriveInfo.GetDrives().Where(d => d.IsReady).Select(d => new { d.Name, type = d.DriveType.ToString(), totalGb = Gb(d.TotalSize), freeGb = Gb(d.AvailableFreeSpace) }),
                screens = System.Windows.Forms.Screen.AllScreens.Length,
                power = System.Windows.Forms.SystemInformation.PowerStatus.PowerLineStatus.ToString(),
                hint = "More: network, wifi, devices, usb, printers, print_queue, battery, displays, bios, software, processes, services, events, ping, port, wmi"
            };
        }

        private static object Network()
        {
            return NetworkInterface.GetAllNetworkInterfaces().Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback).Select(n =>
            {
                IPInterfaceProperties ip = null; try { ip = n.GetIPProperties(); } catch { }
                return new
                {
                    n.Name, n.Description, type = n.NetworkInterfaceType.ToString(), status = n.OperationalStatus.ToString(),
                    speedMbps = n.Speed > 0 ? n.Speed / 1_000_000 : 0, mac = Mac(n),
                    ipv4 = ip?.UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork).Select(a => a.Address + "/" + a.PrefixLength).ToList(),
                    ipv6 = ip?.UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetworkV6 && !a.Address.IsIPv6LinkLocal).Select(a => a.Address.ToString()).ToList(),
                    gateway = ip?.GatewayAddresses.Select(g => g.Address.ToString()).ToList(),
                    dns = ip?.DnsAddresses.Select(d => d.ToString()).ToList(),
                    dnsSuffix = ip?.DnsSuffix,
                    dhcp = SafeDhcp(ip)
                };
            }).ToList();
        }

        private static async Task<object> WifiAsync()
        {
            string text = await RunFixedAsync("netsh", new[] { "wlan", "show", "interfaces" });
            var list = new List<Dictionary<string, string>>();
            Dictionary<string, string> cur = null;
            foreach (var raw in text.Split('\n'))
            {
                var m = Regex.Match(raw, @"^\s{2,}([^:]+?)\s*:\s(.*)$");
                if (!m.Success) continue;
                string k = m.Groups[1].Value.Trim(), v = m.Groups[2].Value.Trim();
                if (k == "Name") { cur = new Dictionary<string, string>(); list.Add(cur); }
                if (cur != null && !cur.ContainsKey(k)) cur[k] = v;
            }
            bool locationBlocked = Regex.IsMatch(text, "location permission|ms-settings:privacy-location", RegexOptions.IgnoreCase);
            return new
            {
                interfaces = list,
                note = locationBlocked
                    ? "Windows hides Wi-Fi names until location access is allowed for desktop apps (Settings › Privacy & security › Location › 'Let desktop apps access your location')."
                    : list.Count == 0 ? "No Wi-Fi adapter or the WLAN service is off." : null
            };
        }

        private static async Task<object> WifiNetworksAsync()
        {
            string text = await RunFixedAsync("netsh", new[] { "wlan", "show", "networks", "mode=bssid" });
            var nets = new List<Dictionary<string, string>>();
            Dictionary<string, string> cur = null;
            foreach (var raw in text.Split('\n'))
            {
                var ssid = Regex.Match(raw, @"^SSID \d+ : (.*)$");
                if (ssid.Success) { cur = new Dictionary<string, string> { ["SSID"] = ssid.Groups[1].Value.Trim() }; nets.Add(cur); continue; }
                var m = Regex.Match(raw, @"^\s+([^:]+?)\s*:\s(.*)$");
                if (m.Success && cur != null && !cur.ContainsKey(m.Groups[1].Value.Trim())) cur[m.Groups[1].Value.Trim()] = m.Groups[2].Value.Trim();
            }
            return new { count = nets.Count, networks = nets.Take(60), note = nets.Count == 0 ? text.Trim().Split('\n').FirstOrDefault() : null };
        }

        private static object CpuMemory()
        {
            var os = Wmi("SELECT FreePhysicalMemory, TotalVisibleMemorySize, FreeVirtualMemory, TotalVirtualMemorySize FROM Win32_OperatingSystem").FirstOrDefault();
            var top = Process.GetProcesses().Select(p => { try { return new { p.ProcessName, p.Id, mb = p.WorkingSet64 / 1048576 }; } catch { return null; } })
                .Where(x => x != null).OrderByDescending(x => x.mb).Take(15).ToList();
            return new
            {
                cpu = Wmi("SELECT Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, CurrentClockSpeed, LoadPercentage FROM Win32_Processor"),
                memory = os, memoryModules = Wmi("SELECT Manufacturer, Capacity, Speed, PartNumber, DeviceLocator FROM Win32_PhysicalMemory"),
                gpu = Wmi("SELECT Name, DriverVersion, AdapterRAM, VideoModeDescription FROM Win32_VideoController"),
                topProcessesByMemoryMb = top, thisAppMb = Process.GetCurrentProcess().WorkingSet64 / 1048576
            };
        }

        private static object Disks() => new
        {
            volumes = DriveInfo.GetDrives().Where(d => d.IsReady).Select(d => new { d.Name, d.VolumeLabel, type = d.DriveType.ToString(), format = d.DriveFormat, totalGb = Gb(d.TotalSize), freeGb = Gb(d.AvailableFreeSpace) }),
            physical = Wmi("SELECT Model, InterfaceType, MediaType, Size, Status, SerialNumber FROM Win32_DiskDrive")
        };

        private static object Devices(string cls, string problems)
        {
            if (!string.IsNullOrWhiteSpace(problems) && problems != "false")
                return Wmi("SELECT Name, PNPClass, Status, ConfigManagerErrorCode, DeviceID FROM Win32_PnPEntity WHERE ConfigManagerErrorCode <> 0");
            if (!string.IsNullOrWhiteSpace(cls))
            {
                if (!Regex.IsMatch(cls, @"^[A-Za-z0-9]{2,40}$")) throw new ArgumentException("class must be one word, e.g. Printer, Camera, Image, Ports, Bluetooth, Monitor, Keyboard, Mouse, HIDClass, Net, AudioEndpoint");
                return Wmi("SELECT Name, Manufacturer, PNPClass, Status, DeviceID FROM Win32_PnPEntity WHERE PNPClass = '" + cls + "'");
            }
            var all = Wmi("SELECT PNPClass, Status FROM Win32_PnPEntity", 5000);
            return new
            {
                byClass = all.GroupBy(d => d.TryGetValue("PNPClass", out var c) ? c ?? "(none)" : "(none)").Select(g => new { cls = g.Key, count = g.Count(), notOk = g.Count(d => (d.GetValueOrDefault("Status") ?? "OK") != "OK") })
                    .OrderByDescending(x => x.count).ToList(),
                hint = "devices class=<PNPClass> lists one class; devices problems=true lists devices with errors"
            };
        }

        private static object Battery()
        {
            var ps = System.Windows.Forms.SystemInformation.PowerStatus;
            return new
            {
                power = ps.PowerLineStatus.ToString(), charge = ps.BatteryLifePercent >= 0 ? Math.Round(ps.BatteryLifePercent * 100) + " %" : null,
                status = ps.BatteryChargeStatus.ToString(), remainingMin = ps.BatteryLifeRemaining > 0 ? ps.BatteryLifeRemaining / 60 : (int?)null,
                batteries = Wmi("SELECT Name, EstimatedChargeRemaining, BatteryStatus, DesignCapacity, FullChargeCapacity FROM Win32_Battery")
            };
        }

        private static object Displays() => new
        {
            screens = System.Windows.Forms.Screen.AllScreens.Select(s => new { s.DeviceName, s.Primary, width = s.Bounds.Width, height = s.Bounds.Height, s.BitsPerPixel }),
            monitors = Wmi("SELECT Name, Status, PNPDeviceID FROM Win32_DesktopMonitor")
        };

        private static object Software(string name)
        {
            var list = new List<Dictionary<string, string>>();
            foreach (var hive in new[] { Registry.LocalMachine, Registry.CurrentUser })
                foreach (var path in new[] { @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" })
                {
                    using var k = hive.OpenSubKey(path);
                    if (k == null) continue;
                    foreach (var sub in k.GetSubKeyNames())
                    {
                        using var s = k.OpenSubKey(sub);
                        string dn = s?.GetValue("DisplayName") as string;
                        if (string.IsNullOrWhiteSpace(dn) || (s.GetValue("SystemComponent") is int sc && sc == 1)) continue;
                        if (!string.IsNullOrWhiteSpace(name) && dn.IndexOf(name, StringComparison.OrdinalIgnoreCase) < 0) continue;
                        list.Add(new Dictionary<string, string> { ["name"] = dn, ["version"] = s.GetValue("DisplayVersion") as string, ["publisher"] = s.GetValue("Publisher") as string, ["installed"] = s.GetValue("InstallDate") as string });
                    }
                }
            var distinct = list.GroupBy(x => x["name"] + "|" + x["version"]).Select(g => g.First()).OrderBy(x => x["name"]).ToList();
            return new { count = distinct.Count, software = distinct.Take(MAX_ROWS) };
        }

        private static object Processes(string name)
        {
            var ps = Process.GetProcesses().Where(p => string.IsNullOrWhiteSpace(name) || p.ProcessName.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0)
                .Select(p =>
                {
                    try { return new { p.ProcessName, p.Id, mb = p.WorkingSet64 / 1048576, started = Try(() => p.StartTime.ToString("yyyy-MM-dd HH:mm")), title = Try(() => p.MainWindowTitle) }; }
                    catch { return null; }
                }).Where(x => x != null).OrderByDescending(x => x.mb).Take(80).ToList();
            return new { count = ps.Count, processes = ps };
        }

        private static object Services(string name, string state)
        {
            var where = new List<string>();
            if (!string.IsNullOrWhiteSpace(name)) { if (!Regex.IsMatch(name, @"^[\w .\-]{1,60}$")) throw new ArgumentException("bad service name"); where.Add("(Name LIKE '%" + name + "%' OR DisplayName LIKE '%" + name + "%')"); }
            if (!string.IsNullOrWhiteSpace(state)) { if (!Regex.IsMatch(state, @"^(Running|Stopped|Paused)$", RegexOptions.IgnoreCase)) throw new ArgumentException("state = Running, Stopped or Paused"); where.Add("State = '" + state + "'"); }
            return Wmi("SELECT Name, DisplayName, State, StartMode, StartName FROM Win32_Service" + (where.Count > 0 ? " WHERE " + string.Join(" AND ", where) : ""));
        }

        private static async Task<object> EventsAsync(string log, string count)
        {
            log = string.Equals(log, "Application", StringComparison.OrdinalIgnoreCase) ? "Application" : string.Equals(log, "PrintService", StringComparison.OrdinalIgnoreCase) ? "Microsoft-Windows-PrintService/Admin" : "System";
            int n = int.TryParse(count, out var c) ? Math.Clamp(c, 1, 50) : 20;
            string text = await RunFixedAsync("wevtutil", new[] { "qe", log, "/c:" + n, "/rd:true", "/f:text", "/q:*[System[(Level=1 or Level=2 or Level=3)]]" });
            return new { log, levels = "critical, error, warning", text = text.Length > 12000 ? text.Substring(0, 12000) + "…" : text };
        }

        private static async Task<object> PingAsync(string host)
        {
            host = CleanHost(host);
            using var p = new Ping();
            var results = new List<object>();
            for (int i = 0; i < 3; i++)
            {
                try { var r = await p.SendPingAsync(host, 2000); results.Add(new { status = r.Status.ToString(), ms = r.RoundtripTime, address = r.Address?.ToString() }); }
                catch (Exception ex) { results.Add(new { status = "Error", error = ex.InnerException?.Message ?? ex.Message }); }
            }
            return new { host, replies = results };
        }

        private static async Task<object> PortAsync(string host, string port)
        {
            host = CleanHost(host);
            if (!int.TryParse(port, out var pt) || pt < 1 || pt > 65535) throw new ArgumentException("port 1-65535 (printers: 9100 RAW, 515 LPD, 631 IPP)");
            var sw = Stopwatch.StartNew();
            using var c = new TcpClient();
            var t = c.ConnectAsync(host, pt);
            bool done = await Task.WhenAny(t, Task.Delay(3000)) == t && !t.IsFaulted && c.Connected;
            return new { host, port = pt, open = done, ms = sw.ElapsedMilliseconds, error = t.IsFaulted ? t.Exception?.InnerException?.Message : done ? null : "timeout / closed" };
        }

        private static object WmiQuery(string q)
        {
            q = (q ?? "").Trim();
            if (!Regex.IsMatch(q, @"^SELECT\s+[\w\s,*]+\s+FROM\s+(Win32_|CIM_|MSFT_)\w+(\s+WHERE\s+[^;]{1,400})?$", RegexOptions.IgnoreCase))
                throw new ArgumentException("wmi takes one WQL query: SELECT <props|*> FROM Win32_… | CIM_… | MSFT_… [WHERE …]");
            return Wmi(q);
        }

        // ── helpers ──────────────────────────────────────────
        public static List<Dictionary<string, string>> Wmi(string query, int max = MAX_ROWS)
        {
            var rows = new List<Dictionary<string, string>>();
            using var s = new ManagementObjectSearcher(new ManagementScope(@"\\.\root\cimv2"), new ObjectQuery(query), new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(20), ReturnImmediately = true });
            foreach (ManagementBaseObject o in s.Get())
            {
                var d = new Dictionary<string, string>();
                foreach (var p in o.Properties)
                {
                    if (p.Value == null) continue;
                    string v = p.Value is Array a ? string.Join(", ", a.Cast<object>()) : p.Value.ToString();
                    if (p.Type == CimType.DateTime && v.Length >= 14) { try { v = ManagementDateTimeConverter.ToDateTime(v).ToString("yyyy-MM-dd HH:mm"); } catch { } }
                    d[p.Name] = v.Length > 400 ? v.Substring(0, 400) + "…" : v;
                }
                rows.Add(d);
                o.Dispose();
                if (rows.Count >= max) break;
            }
            return rows;
        }

        /// <summary>Runs one fixed system command (no shell, fixed arguments), 20 s limit, output capped.</summary>
        private static async Task<string> RunFixedAsync(string exe, string[] args)
        {
            var psi = new ProcessStartInfo(exe) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8 };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi);
            var outT = p.StandardOutput.ReadToEndAsync();
            var errT = p.StandardError.ReadToEndAsync();
            bool exited = await Task.Run(() => p.WaitForExit(20000));
            if (!exited) { try { p.Kill(true); } catch { } }
            string o = (await outT) + (await errT);
            return o.Length > 60000 ? o.Substring(0, 60000) : o;
        }

        private static string CleanHost(string host)
        {
            host = (host ?? "").Trim();
            if (!Regex.IsMatch(host, @"^[A-Za-z0-9][A-Za-z0-9.\-:]{0,252}$")) throw new ArgumentException("host must be a name or an IP address");
            return host;
        }
        private static double Gb(long b) => Math.Round(b / 1073741824.0, 1);
        private static string Mac(NetworkInterface n) { try { var b = n.GetPhysicalAddress().GetAddressBytes(); return b.Length == 0 ? null : string.Join("-", b.Select(x => x.ToString("X2"))); } catch { return null; } }
        private static bool? SafeDhcp(IPInterfaceProperties ip) { try { return ip?.GetIPv4Properties()?.IsDhcpEnabled; } catch { return null; } }
        private static string Try(Func<string> f) { try { return f(); } catch { return null; } }
    }
}
