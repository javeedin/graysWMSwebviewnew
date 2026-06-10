using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace FusionUpdater
{
    public class InstallProgress
    {
        public string Stage { get; set; } = "";
        public int Percent { get; set; }
    }

    public class UpdateInstaller
    {
        private readonly UpdaterConfig _config;
        private readonly HttpClient _httpClient;

        public UpdateInstaller(UpdaterConfig config)
        {
            _config = config;
            _httpClient = new HttpClient();
            _httpClient.DefaultRequestHeaders.UserAgent.Add(
                new ProductInfoHeaderValue("FusionUpdater", "1.0"));
            _httpClient.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/octet-stream"));
            if (!string.IsNullOrEmpty(config.GitHubToken))
                _httpClient.DefaultRequestHeaders.Authorization =
                    new AuthenticationHeaderValue("Bearer", config.GitHubToken);
        }

        public async Task InstallAsync(ReleaseInfo release, IProgress<InstallProgress> progress,
            CancellationToken ct = default)
        {
            var zipPath = Path.Combine(_config.InstallDirectory, "fusionclient_update.zip");

            // Stage 1: Download
            progress.Report(new InstallProgress { Stage = "Downloading update...", Percent = 0 });
            await DownloadAsync(release.DownloadUrl, zipPath, progress, ct);

            // Stage 2: Close running WMS
            progress.Report(new InstallProgress { Stage = "Closing WMS application...", Percent = 60 });
            await CloseWmsAsync();

            // Stage 3: Extract
            progress.Report(new InstallProgress { Stage = "Installing files...", Percent = 70 });
            ExtractZip(zipPath, _config.InstallDirectory);

            // Stage 4: Cleanup
            progress.Report(new InstallProgress { Stage = "Cleaning up...", Percent = 90 });
            try { File.Delete(zipPath); } catch { }

            // Stage 5: Relaunch
            progress.Report(new InstallProgress { Stage = "Launching application...", Percent = 95 });
            LaunchWms();

            progress.Report(new InstallProgress { Stage = "Done!", Percent = 100 });
        }

        private async Task DownloadAsync(string url, string destPath, IProgress<InstallProgress> progress,
            CancellationToken ct)
        {
            // GitHub private asset download requires redirect follow with auth header
            using var response = await _httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();

            var total = response.Content.Headers.ContentLength ?? -1L;
            var dir = Path.GetDirectoryName(destPath)!;
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

            await using var fs = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None);
            await using var stream = await response.Content.ReadAsStreamAsync(ct);

            var buffer = new byte[81920];
            long downloaded = 0;
            int read;
            while ((read = await stream.ReadAsync(buffer, ct)) > 0)
            {
                await fs.WriteAsync(buffer.AsMemory(0, read), ct);
                downloaded += read;
                if (total > 0)
                {
                    int pct = (int)(downloaded * 55 / total); // 0–55%
                    progress.Report(new InstallProgress { Stage = $"Downloading... {pct}%", Percent = pct });
                }
            }
        }

        private async Task CloseWmsAsync()
        {
            var exeName = Path.GetFileNameWithoutExtension(_config.AppExecutable);
            var processes = Process.GetProcessesByName(exeName);
            foreach (var p in processes)
            {
                try
                {
                    p.CloseMainWindow();
                }
                catch { }
            }

            // Wait up to 8 seconds for graceful exit
            for (int i = 0; i < 16; i++)
            {
                await Task.Delay(500);
                bool allGone = true;
                foreach (var p in processes)
                {
                    try { if (!p.HasExited) { allGone = false; break; } }
                    catch { }
                }
                if (allGone) return;
            }

            // Force kill if still running
            foreach (var p in processes)
            {
                try { if (!p.HasExited) p.Kill(); }
                catch { }
            }
            await Task.Delay(1000);
        }

        private void ExtractZip(string zipPath, string destDir)
        {
            using var archive = ZipFile.OpenRead(zipPath);
            foreach (var entry in archive.Entries)
            {
                // Skip the updater itself — never overwrite FusionUpdater.exe
                if (entry.FullName.Contains("FusionUpdater", StringComparison.OrdinalIgnoreCase))
                    continue;

                var destFile = Path.Combine(destDir, entry.FullName);
                var destDirFull = Path.GetDirectoryName(destFile)!;
                if (!Directory.Exists(destDirFull)) Directory.CreateDirectory(destDirFull);

                if (!string.IsNullOrEmpty(entry.Name)) // skip directory entries
                    entry.ExtractToFile(destFile, overwrite: true);
            }
        }

        private void LaunchWms()
        {
            var exePath = Path.Combine(_config.InstallDirectory, _config.AppExecutable);
            if (File.Exists(exePath))
            {
                Process.Start(new ProcessStartInfo(exePath)
                {
                    UseShellExecute = true,
                    WorkingDirectory = _config.InstallDirectory
                });
            }
        }
    }
}
