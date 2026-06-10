using System;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace FusionUpdater
{
    public class TrayManager : IDisposable
    {
        private readonly NotifyIcon _trayIcon;
        private readonly UpdaterConfig _config;
        private readonly UpdateChecker _checker;
        private readonly UpdateInstaller _installer;
        private System.Windows.Forms.Timer? _checkTimer;
        private ReleaseInfo? _pendingRelease;
        private bool _installing;

        public TrayManager(UpdaterConfig config)
        {
            _config = config;
            _checker = new UpdateChecker(config);
            _installer = new UpdateInstaller(config);

            _trayIcon = new NotifyIcon
            {
                Icon = LoadIcon(),
                Text = "FusionUpdater — checking for updates...",
                Visible = true,
                ContextMenuStrip = BuildContextMenu()
            };
            _trayIcon.DoubleClick += (s, e) => CheckNow();
        }

        private Icon LoadIcon()
        {
            try
            {
                var exeDir = System.IO.Path.GetDirectoryName(
                    System.Diagnostics.Process.GetCurrentProcess().MainModule!.FileName)!;
                var iconPath = System.IO.Path.Combine(exeDir, "icon.ico");
                if (System.IO.File.Exists(iconPath)) return new Icon(iconPath);
            }
            catch { }
            return SystemIcons.Application;
        }

        private ContextMenuStrip BuildContextMenu()
        {
            var menu = new ContextMenuStrip();

            var statusItem = new ToolStripMenuItem("FusionUpdater") { Enabled = false, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());

            var checkItem = new ToolStripMenuItem("Check for Updates Now");
            checkItem.Click += (s, e) => CheckNow();
            menu.Items.Add(checkItem);

            var installItem = new ToolStripMenuItem("Install Pending Update") { Enabled = false };
            installItem.Name = "installItem";
            installItem.Click += (s, e) => { if (_pendingRelease != null) ShowConfirmAndInstall(_pendingRelease); };
            menu.Items.Add(installItem);

            menu.Items.Add(new ToolStripSeparator());

            var settingsItem = new ToolStripMenuItem("Settings...");
            settingsItem.Click += (s, e) => new ConfigDialog(_config).ShowDialog();
            menu.Items.Add(settingsItem);

            menu.Items.Add(new ToolStripSeparator());

            var exitItem = new ToolStripMenuItem("Exit");
            exitItem.Click += (s, e) => Application.Exit();
            menu.Items.Add(exitItem);

            return menu;
        }

        public void StartPolling()
        {
            // Check immediately on startup
            Task.Run(async () => await PerformCheckAsync());

            // Then check periodically
            _checkTimer = new System.Windows.Forms.Timer
            {
                Interval = _config.CheckIntervalHours * 60 * 60 * 1000
            };
            _checkTimer.Tick += async (s, e) => await PerformCheckAsync();
            _checkTimer.Start();
        }

        private void CheckNow()
        {
            _trayIcon.Text = "FusionUpdater — checking...";
            Task.Run(async () => await PerformCheckAsync());
        }

        private async Task PerformCheckAsync()
        {
            try
            {
                var (hasUpdate, release) = await _checker.CheckForUpdateAsync();
                var local = _checker.GetLocalVersion();

                if (hasUpdate && release != null)
                {
                    _pendingRelease = release;
                    UpdateTrayState(hasUpdate: true, release, local);
                    ShowUpdateBalloon(release, local);
                }
                else
                {
                    _pendingRelease = null;
                    UpdateTrayState(hasUpdate: false, null, local);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[TrayManager] Check failed: {ex.Message}");
                SetTrayText("FusionUpdater — check failed");
            }
        }

        private void UpdateTrayState(bool hasUpdate, ReleaseInfo? release, string localVersion)
        {
            if (_trayIcon.ContextMenuStrip?.InvokeRequired == true)
            {
                _trayIcon.ContextMenuStrip.Invoke(() => UpdateTrayState(hasUpdate, release, localVersion));
                return;
            }

            if (hasUpdate && release != null)
            {
                SetTrayText($"FusionUpdater — update available: {release.TagName}");
                var installItem = _trayIcon.ContextMenuStrip?.Items["installItem"] as ToolStripMenuItem;
                if (installItem != null)
                {
                    installItem.Enabled = true;
                    installItem.Text = $"Install Update {release.TagName}";
                }
            }
            else
            {
                SetTrayText($"FusionUpdater — up to date (v{localVersion})");
                var installItem = _trayIcon.ContextMenuStrip?.Items["installItem"] as ToolStripMenuItem;
                if (installItem != null)
                {
                    installItem.Enabled = false;
                    installItem.Text = "Install Pending Update";
                }
            }
        }

        private void ShowUpdateBalloon(ReleaseInfo release, string localVersion)
        {
            SetTrayBalloon(
                $"FusionClient {release.TagName} is available",
                $"Your version: v{localVersion}\nDouble-click to install.",
                ToolTipIcon.Info);

            _trayIcon.BalloonTipClicked += OnBalloonClicked;
        }

        private void OnBalloonClicked(object? sender, EventArgs e)
        {
            _trayIcon.BalloonTipClicked -= OnBalloonClicked;
            if (_pendingRelease != null)
                ShowConfirmAndInstall(_pendingRelease);
        }

        private void ShowConfirmAndInstall(ReleaseInfo release)
        {
            if (_installing) return;

            var local = _checker.GetLocalVersion();
            var dialog = new UpdateConfirmDialog(release, local);
            if (dialog.ShowDialog() == DialogResult.OK && dialog.UserConfirmed)
                StartInstall(release);
        }

        private void StartInstall(ReleaseInfo release)
        {
            if (_installing) return;
            _installing = true;

            var progressDialog = new InstallProgressDialog();
            progressDialog.Show();

            var progress = new Progress<InstallProgress>(p => progressDialog.UpdateProgress(p));

            Task.Run(async () =>
            {
                try
                {
                    await _installer.InstallAsync(release, progress);

                    progressDialog.Invoke(() =>
                    {
                        progressDialog.Close();
                        MessageBox.Show($"FusionClient {release.TagName} installed successfully!\n\nThe application has been relaunched.",
                            "Update Complete", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    });

                    _pendingRelease = null;
                    _installing = false;
                    UpdateTrayState(false, null, release.Version);
                }
                catch (Exception ex)
                {
                    _installing = false;
                    progressDialog.Invoke(() =>
                    {
                        progressDialog.Close();
                        MessageBox.Show($"Update failed:\n{ex.Message}\n\nPlease try again or install manually.",
                            "Update Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    });
                }
            });
        }

        private void SetTrayText(string text)
        {
            try
            {
                // NotifyIcon.Text max 63 chars
                _trayIcon.Text = text.Length > 63 ? text[..60] + "..." : text;
            }
            catch { }
        }

        private void SetTrayBalloon(string title, string text, ToolTipIcon icon)
        {
            try
            {
                _trayIcon.BalloonTipTitle = title;
                _trayIcon.BalloonTipText = text;
                _trayIcon.BalloonTipIcon = icon;
                _trayIcon.ShowBalloonTip(8000);
            }
            catch { }
        }

        public void Dispose()
        {
            _checkTimer?.Stop();
            _checkTimer?.Dispose();
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
        }
    }
}
