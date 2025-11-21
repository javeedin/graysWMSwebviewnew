using System;
using System.Drawing;
using System.Windows.Forms;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;

namespace WMSApp
{
    public class LoginForm : Form
    {
        private TextBox txtUsername;
        private TextBox txtPassword;
        private ComboBox cboInstance;
        private ComboBox cboBusinessUnit;
        private ComboBox cboInventoryOrg;
        private Button btnLogin;
        private Button btnCancel;
        private Label lblError;
        private CheckBox chkRememberMe;

        // Instance URLs
        private readonly Dictionary<string, string> instanceUrls = new Dictionary<string, string>
        {
            { "PROD", "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT" },
            { "TEST", "https://g09254cbbf8e7af-graystest.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT" }
        };

        public string Username { get; private set; }
        public string Password { get; private set; }
        public string InstanceName { get; private set; }
        public string BusinessUnit { get; private set; }
        public string InventoryOrg { get; private set; }
        public bool LoginSuccessful { get; private set; }

        public LoginForm()
        {
            InitializeComponent();
            LoadSettings();
        }

        private void InitializeComponent()
        {
            this.Text = "WMS Login";
            this.Size = new Size(600, 550);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = Color.FromArgb(245, 247, 250);

            // Logo/Title Panel
            Panel headerPanel = new Panel
            {
                Height = 100,
                Dock = DockStyle.Top,
                BackColor = Color.FromArgb(102, 126, 234) // #667eea
            };

            Label lblTitle = new Label
            {
                Text = "🏭 WMS Login",
                Font = new Font("Segoe UI", 24, FontStyle.Bold),
                ForeColor = Color.White,
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleCenter,
                Dock = DockStyle.Fill
            };
            headerPanel.Controls.Add(lblTitle);

            // Main content panel
            Panel contentPanel = new Panel
            {
                Location = new Point(40, 120),
                Size = new Size(520, 350),
                BackColor = Color.White,
                Padding = new Padding(20)
            };

            // Add subtle shadow effect
            contentPanel.Paint += (s, e) =>
            {
                ControlPaint.DrawBorder(e.Graphics, contentPanel.ClientRectangle,
                    Color.FromArgb(220, 220, 220), ButtonBorderStyle.Solid);
            };

            int yPosition = 20;

            // Username
            Label lblUsername = new Label
            {
                Text = "Username:",
                Location = new Point(20, yPosition),
                Size = new Size(480, 20),
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.FromArgb(60, 60, 60)
            };
            contentPanel.Controls.Add(lblUsername);

            txtUsername = new TextBox
            {
                Location = new Point(20, yPosition + 22),
                Size = new Size(480, 30),
                Font = new Font("Segoe UI", 10),
                BorderStyle = BorderStyle.FixedSingle
            };
            contentPanel.Controls.Add(txtUsername);
            yPosition += 65;

            // Password
            Label lblPassword = new Label
            {
                Text = "Password:",
                Location = new Point(20, yPosition),
                Size = new Size(480, 20),
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.FromArgb(60, 60, 60)
            };
            contentPanel.Controls.Add(lblPassword);

            txtPassword = new TextBox
            {
                Location = new Point(20, yPosition + 22),
                Size = new Size(480, 30),
                Font = new Font("Segoe UI", 10),
                UseSystemPasswordChar = true,
                BorderStyle = BorderStyle.FixedSingle
            };
            contentPanel.Controls.Add(txtPassword);
            yPosition += 65;

            // Instance Name
            Label lblInstance = new Label
            {
                Text = "Instance:",
                Location = new Point(20, yPosition),
                Size = new Size(480, 20),
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.FromArgb(60, 60, 60)
            };
            contentPanel.Controls.Add(lblInstance);

            cboInstance = new ComboBox
            {
                Location = new Point(20, yPosition + 22),
                Size = new Size(480, 30),
                Font = new Font("Segoe UI", 10),
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            cboInstance.Items.AddRange(new object[] { "PROD", "TEST" });
            cboInstance.SelectedIndex = 0;
            contentPanel.Controls.Add(cboInstance);
            yPosition += 65;

            // Business Unit (disabled for now)
            Label lblBusinessUnit = new Label
            {
                Text = "Business Unit: (Coming Soon)",
                Location = new Point(20, yPosition),
                Size = new Size(480, 20),
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.FromArgb(150, 150, 150)
            };
            contentPanel.Controls.Add(lblBusinessUnit);

            cboBusinessUnit = new ComboBox
            {
                Location = new Point(20, yPosition + 22),
                Size = new Size(480, 30),
                Font = new Font("Segoe UI", 10),
                DropDownStyle = ComboBoxStyle.DropDownList,
                Enabled = false
            };
            cboBusinessUnit.Items.Add("-- Not Implemented --");
            cboBusinessUnit.SelectedIndex = 0;
            contentPanel.Controls.Add(cboBusinessUnit);
            yPosition += 65;

            // Remember Me
            chkRememberMe = new CheckBox
            {
                Text = "Remember my credentials",
                Location = new Point(20, yPosition),
                Size = new Size(200, 20),
                Font = new Font("Segoe UI", 9),
                ForeColor = Color.FromArgb(80, 80, 80)
            };
            contentPanel.Controls.Add(chkRememberMe);
            yPosition += 30;

            // Error Label
            lblError = new Label
            {
                Location = new Point(20, yPosition),
                Size = new Size(480, 40),
                Font = new Font("Segoe UI", 9),
                ForeColor = Color.Red,
                TextAlign = ContentAlignment.MiddleCenter,
                Visible = false
            };
            contentPanel.Controls.Add(lblError);

            // Buttons Panel
            Panel buttonPanel = new Panel
            {
                Location = new Point(40, 475),
                Size = new Size(520, 50),
                BackColor = Color.Transparent
            };

            btnCancel = new Button
            {
                Text = "Cancel",
                Location = new Point(100, 10),
                Size = new Size(160, 40),
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                BackColor = Color.FromArgb(220, 220, 220),
                ForeColor = Color.FromArgb(80, 80, 80),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnCancel.FlatAppearance.BorderSize = 0;
            btnCancel.Click += BtnCancel_Click;
            buttonPanel.Controls.Add(btnCancel);

            btnLogin = new Button
            {
                Text = "🔐 Login",
                Location = new Point(270, 10),
                Size = new Size(160, 40),
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                BackColor = Color.FromArgb(102, 126, 234),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnLogin.FlatAppearance.BorderSize = 0;
            btnLogin.Click += BtnLogin_Click;
            buttonPanel.Controls.Add(btnLogin);

            // Add all panels to form
            this.Controls.Add(buttonPanel);
            this.Controls.Add(contentPanel);
            this.Controls.Add(headerPanel);

            // Set Accept button
            this.AcceptButton = btnLogin;

            // Focus on username
            this.Shown += (s, e) => txtUsername.Focus();
        }

        private async void BtnLogin_Click(object sender, EventArgs e)
        {
            // Hide previous error
            lblError.Visible = false;

            // Validate inputs
            if (string.IsNullOrWhiteSpace(txtUsername.Text))
            {
                ShowError("Please enter username");
                txtUsername.Focus();
                return;
            }

            if (string.IsNullOrWhiteSpace(txtPassword.Text))
            {
                ShowError("Please enter password");
                txtPassword.Focus();
                return;
            }

            // Disable controls during login
            SetControlsEnabled(false);
            btnLogin.Text = "⏳ Logging in...";

            try
            {
                // Get selected instance URL
                string selectedInstance = cboInstance.SelectedItem.ToString();
                string baseUrl = instanceUrls[selectedInstance];

                // Call login API
                bool isValid = await ValidateLogin(baseUrl, txtUsername.Text, txtPassword.Text);

                if (isValid)
                {
                    // Store credentials
                    Username = txtUsername.Text;
                    Password = txtPassword.Text;
                    InstanceName = selectedInstance;
                    BusinessUnit = cboBusinessUnit.SelectedItem?.ToString();
                    InventoryOrg = cboInventoryOrg?.SelectedItem?.ToString();
                    LoginSuccessful = true;

                    // Save settings if remember me is checked
                    if (chkRememberMe.Checked)
                    {
                        SaveSettings();
                    }

                    this.DialogResult = DialogResult.OK;
                    this.Close();
                }
                else
                {
                    ShowError("Invalid username or password");
                    SetControlsEnabled(true);
                    btnLogin.Text = "🔐 Login";
                    txtPassword.Clear();
                    txtPassword.Focus();
                }
            }
            catch (Exception ex)
            {
                ShowError($"Login failed: {ex.Message}");
                SetControlsEnabled(true);
                btnLogin.Text = "🔐 Login";
                System.Diagnostics.Debug.WriteLine($"[LOGIN] Error: {ex.Message}");
            }
        }

        private async Task<bool> ValidateLogin(string baseUrl, string username, string password)
        {
            try
            {
                string loginUrl = $"{baseUrl}/login?username={Uri.EscapeDataString(username)}&password={Uri.EscapeDataString(password)}";

                System.Diagnostics.Debug.WriteLine($"[LOGIN] Validating: {loginUrl}");

                using (var client = new HttpClient())
                {
                    client.Timeout = TimeSpan.FromSeconds(30);
                    var response = await client.GetAsync(loginUrl);

                    if (response.IsSuccessStatusCode)
                    {
                        string jsonResponse = await response.Content.ReadAsStringAsync();
                        System.Diagnostics.Debug.WriteLine($"[LOGIN] Response: {jsonResponse}");

                        // Check if response has data (successful login)
                        if (!string.IsNullOrWhiteSpace(jsonResponse) && jsonResponse.Length > 10)
                        {
                            return true;
                        }
                    }

                    return false;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LOGIN] Validation error: {ex.Message}");
                throw;
            }
        }

        private void BtnCancel_Click(object sender, EventArgs e)
        {
            LoginSuccessful = false;
            this.DialogResult = DialogResult.Cancel;
            this.Close();
        }

        private void ShowError(string message)
        {
            lblError.Text = message;
            lblError.Visible = true;
        }

        private void SetControlsEnabled(bool enabled)
        {
            txtUsername.Enabled = enabled;
            txtPassword.Enabled = enabled;
            cboInstance.Enabled = enabled;
            btnLogin.Enabled = enabled;
            btnCancel.Enabled = enabled;
        }

        private void LoadSettings()
        {
            try
            {
                // Load from Properties.Settings if needed
                // txtUsername.Text = Properties.Settings.Default.SavedUsername;
                // cboInstance.SelectedItem = Properties.Settings.Default.SavedInstance;
            }
            catch { }
        }

        private void SaveSettings()
        {
            try
            {
                // Save to Properties.Settings if needed
                // Properties.Settings.Default.SavedUsername = txtUsername.Text;
                // Properties.Settings.Default.SavedInstance = cboInstance.SelectedItem.ToString();
                // Properties.Settings.Default.Save();
            }
            catch { }
        }
    }
}
