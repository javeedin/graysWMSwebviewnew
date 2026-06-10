using System;
using System.Drawing;
using System.Windows.Forms;

namespace FusionUpdater
{
    public class InstallProgressDialog : Form
    {
        private readonly ProgressBar _progressBar;
        private readonly Label _stageLabel;
        private readonly Label _percentLabel;

        public InstallProgressDialog()
        {
            Text = "Installing Update...";
            Size = new Size(440, 180);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ControlBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(245, 247, 250);

            var header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 50,
                BackColor = Color.FromArgb(102, 126, 234)
            };
            var title = new Label
            {
                Text = "Installing FusionClient Update",
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 11, FontStyle.Bold),
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter
            };
            header.Controls.Add(title);

            _stageLabel = new Label
            {
                Text = "Preparing...",
                Font = new Font("Segoe UI", 9),
                ForeColor = Color.FromArgb(60, 60, 60),
                Location = new Point(20, 65),
                Size = new Size(300, 20)
            };

            _percentLabel = new Label
            {
                Text = "0%",
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.FromArgb(102, 126, 234),
                Location = new Point(370, 65),
                Size = new Size(40, 20),
                TextAlign = ContentAlignment.MiddleRight
            };

            _progressBar = new ProgressBar
            {
                Location = new Point(20, 90),
                Size = new Size(390, 22),
                Minimum = 0,
                Maximum = 100,
                Style = ProgressBarStyle.Continuous
            };

            Controls.AddRange(new Control[] { header, _stageLabel, _percentLabel, _progressBar });
        }

        public void UpdateProgress(InstallProgress progress)
        {
            if (InvokeRequired)
            {
                Invoke(() => UpdateProgress(progress));
                return;
            }
            _stageLabel.Text = progress.Stage;
            _percentLabel.Text = $"{progress.Percent}%";
            _progressBar.Value = Math.Max(0, Math.Min(100, progress.Percent));
        }
    }
}
