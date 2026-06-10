using System;
using System.Drawing;
using System.Windows.Forms;

namespace FusionUpdater
{
    public class ConfigDialog : Form
    {
        private readonly UpdaterConfig _config;
        private TextBox _tokenBox = null!;
        private TextBox _ownerBox = null!;
        private TextBox _repoBox = null!;
        private TextBox _installDirBox = null!;
        private TextBox _exeBox = null!;
        private NumericUpDown _intervalBox = null!;

        public ConfigDialog(UpdaterConfig config)
        {
            _config = config;
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            Text = "Updater Settings";
            Size = new Size(480, 420);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(245, 247, 250);

            var header = new Panel { Dock = DockStyle.Top, Height = 50, BackColor = Color.FromArgb(102, 126, 234) };
            header.Controls.Add(new Label
            {
                Text = "FusionUpdater Settings",
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 12, FontStyle.Bold),
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter
            });

            var table = new TableLayoutPanel
            {
                Location = new Point(20, 65),
                Size = new Size(425, 260),
                ColumnCount = 2,
                RowCount = 6,
                AutoSize = false
            };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

            void AddRow(int row, string labelText, Control control)
            {
                table.Controls.Add(new Label
                {
                    Text = labelText,
                    Font = new Font("Segoe UI", 9),
                    ForeColor = Color.FromArgb(60, 60, 60),
                    Anchor = AnchorStyles.Left | AnchorStyles.Top,
                    AutoSize = true,
                    Margin = new Padding(0, 8, 5, 0)
                }, 0, row);
                control.Dock = DockStyle.Fill;
                control.Margin = new Padding(0, 4, 0, 4);
                table.Controls.Add(control, 1, row);
            }

            _tokenBox = new TextBox { Text = _config.GitHubToken, UseSystemPasswordChar = true };
            _ownerBox = new TextBox { Text = _config.GitHubOwner };
            _repoBox = new TextBox { Text = _config.GitHubRepo };
            _installDirBox = new TextBox { Text = _config.InstallDirectory };
            _exeBox = new TextBox { Text = _config.AppExecutable };
            _intervalBox = new NumericUpDown { Minimum = 1, Maximum = 24, Value = _config.CheckIntervalHours };

            AddRow(0, "GitHub Token:", _tokenBox);
            AddRow(1, "GitHub Owner:", _ownerBox);
            AddRow(2, "GitHub Repo:", _repoBox);
            AddRow(3, "Install Directory:", _installDirBox);
            AddRow(4, "App Executable:", _exeBox);
            AddRow(5, "Check Every (hrs):", _intervalBox);

            var saveBtn = new Button
            {
                Text = "Save",
                Location = new Point(310, 340),
                Size = new Size(100, 34),
                BackColor = Color.FromArgb(102, 126, 234),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            saveBtn.FlatAppearance.BorderSize = 0;
            saveBtn.Click += (s, e) =>
            {
                _config.GitHubToken = _tokenBox.Text.Trim();
                _config.GitHubOwner = _ownerBox.Text.Trim();
                _config.GitHubRepo = _repoBox.Text.Trim();
                _config.InstallDirectory = _installDirBox.Text.Trim();
                _config.AppExecutable = _exeBox.Text.Trim();
                _config.CheckIntervalHours = (int)_intervalBox.Value;
                _config.Save();
                MessageBox.Show("Settings saved.", "Saved", MessageBoxButtons.OK, MessageBoxIcon.Information);
                DialogResult = DialogResult.OK;
                Close();
            };

            var cancelBtn = new Button
            {
                Text = "Cancel",
                Location = new Point(200, 340),
                Size = new Size(100, 34),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10),
                Cursor = Cursors.Hand
            };
            cancelBtn.Click += (s, e) => { DialogResult = DialogResult.Cancel; Close(); };

            Controls.AddRange(new Control[] { header, table, saveBtn, cancelBtn });
        }
    }
}
