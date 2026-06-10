using System;
using System.Drawing;
using System.Windows.Forms;

namespace FusionUpdater
{
    public class UpdateConfirmDialog : Form
    {
        private readonly ReleaseInfo _release;
        private readonly string _localVersion;
        public bool UserConfirmed { get; private set; }

        public UpdateConfirmDialog(ReleaseInfo release, string localVersion)
        {
            _release = release;
            _localVersion = localVersion;
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            Text = "FusionClient Update Available";
            Size = new Size(480, 360);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(245, 247, 250);

            // Header panel
            var header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 70,
                BackColor = Color.FromArgb(102, 126, 234)
            };
            var titleLabel = new Label
            {
                Text = "🚀  New Update Available",
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                AutoSize = false,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter
            };
            header.Controls.Add(titleLabel);

            // Version info
            var versionPanel = new Panel { Dock = DockStyle.Top, Height = 60, Padding = new Padding(20, 10, 20, 0) };
            var versionLabel = new Label
            {
                Text = $"Current: v{_localVersion}   →   New: {_release.TagName}   (released {_release.PublishedAt:dd MMM yyyy})",
                Font = new Font("Segoe UI", 10),
                ForeColor = Color.FromArgb(60, 60, 60),
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter
            };
            versionPanel.Controls.Add(versionLabel);

            // Release notes
            var notesLabel = new Label
            {
                Text = "What's new:",
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.FromArgb(80, 80, 80),
                AutoSize = true,
                Location = new Point(20, 0)
            };
            var notesBox = new RichTextBox
            {
                Text = string.IsNullOrWhiteSpace(_release.ReleaseNotes) ? "No release notes provided." : _release.ReleaseNotes,
                ReadOnly = true,
                BackColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Segoe UI", 9),
                ScrollBars = RichTextBoxScrollBars.Vertical,
                Location = new Point(20, 25),
                Size = new Size(420, 140)
            };
            var notesPanel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(20, 10, 20, 0) };
            notesPanel.Controls.Add(notesBox);
            notesPanel.Controls.Add(notesLabel);

            // Buttons
            var buttonPanel = new Panel { Dock = DockStyle.Bottom, Height = 60, Padding = new Padding(20, 10, 20, 10) };
            var installBtn = new Button
            {
                Text = "Install Now",
                Width = 130,
                Height = 38,
                BackColor = Color.FromArgb(102, 126, 234),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                Location = new Point(buttonPanel.Width - 300, 10),
                Cursor = Cursors.Hand
            };
            installBtn.FlatAppearance.BorderSize = 0;
            installBtn.Click += (s, e) => { UserConfirmed = true; DialogResult = DialogResult.OK; Close(); };

            var laterBtn = new Button
            {
                Text = "Remind Me Later",
                Width = 140,
                Height = 38,
                BackColor = Color.FromArgb(220, 220, 220),
                ForeColor = Color.FromArgb(60, 60, 60),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10),
                Location = new Point(buttonPanel.Width - 150, 10),
                Cursor = Cursors.Hand
            };
            laterBtn.FlatAppearance.BorderSize = 0;
            laterBtn.Click += (s, e) => { UserConfirmed = false; DialogResult = DialogResult.Cancel; Close(); };

            buttonPanel.Controls.AddRange(new Control[] { installBtn, laterBtn });
            buttonPanel.Resize += (s, e) =>
            {
                installBtn.Location = new Point(buttonPanel.Width - 300, 11);
                laterBtn.Location = new Point(buttonPanel.Width - 150, 11);
            };

            Controls.AddRange(new Control[] { buttonPanel, notesPanel, versionPanel, header });
        }
    }
}
