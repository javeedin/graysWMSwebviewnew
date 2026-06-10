using System;
using System.Windows.Forms;

namespace FusionUpdater
{
    // Hidden background form — hosts the tray manager and message loop
    public class UpdaterForm : Form
    {
        private TrayManager? _trayManager;

        public UpdaterForm()
        {
            // Completely hidden — lives only in the tray
            ShowInTaskbar = false;
            WindowState = FormWindowState.Minimized;
            Opacity = 0;
            FormBorderStyle = FormBorderStyle.None;
            Size = new System.Drawing.Size(1, 1);
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            Hide();

            var config = UpdaterConfig.Load();

            if (string.IsNullOrEmpty(config.GitHubToken))
            {
                MessageBox.Show(
                    "Welcome to FusionUpdater!\n\n" +
                    "Please enter your GitHub token in Settings to enable automatic updates.\n\n" +
                    "Right-click the tray icon → Settings",
                    "FusionUpdater Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }

            _trayManager = new TrayManager(config);
            _trayManager.StartPolling();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            _trayManager?.Dispose();
            base.OnFormClosing(e);
        }

        // Prevent window from appearing when minimized
        protected override void SetVisibleCore(bool value)
        {
            base.SetVisibleCore(false);
        }
    }
}
