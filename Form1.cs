using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using System.Windows.Forms;
using WMSApp.PrintManagement;

// ADD THIS LINE to resolve ambiguity:
using JsonSerializer = System.Text.Json.JsonSerializer;

namespace WMSApp
{
    public partial class Form1 : Form
    {
        private WebView2 webView;
        private Panel urlPanel;
        private TextBox urlTextBox;
        private Button favoriteButton;
        private Button profileButton;
        private Button copilotButton;
        private Button backButton;
        private Button forwardButton;
        private Button refreshButton;
        private Button homeButton;
        private Button openFileButton;
        private Button clearCacheButton;
        private Button wmsDevButton;
        private Button wmsProdButton;
        private Button modulesButton;
        private ContextMenuStrip modulesContextMenu;
        private Label securityIcon;
        private FlowLayoutPanel tabBar;
        private ToolTip moduleToolTip;
        private ApexHtmlFileDownloader _apexDownloader;
        private Dictionary<WebView2, WebViewMessageRouter> _messageRouters = new Dictionary<WebView2, WebViewMessageRouter>();
        private Dictionary<string, Action<string, string>> _pendingRequests = new Dictionary<string, Action<string, string>>();

        private ClaudeApiHandler _claudeApiHandler;
        private PromptHistoryManager _promptHistoryManager;
        private Button historyButton;

        // Print Management Fields
        private PrintJobManager _printJobManager;
        private LocalStorageManager _storageManager;
        private PrinterService _printerService;
        private RestApiClient _restApiClient;

        // User Session Fields
        private string _loggedInUsername;
        private string _loggedInInstance;
        private string _loggedInDateTime;
        private bool _isLoggedIn = false;

        public Form1()
        {
            InitializeComponent();
            InitializeComponent1();

            // ⭐ ADD THIS TEST
            System.Diagnostics.Debug.WriteLine("========================================");
            System.Diagnostics.Debug.WriteLine("🚀 APPLICATION STARTED - TESTING DEBUG OUTPUT");
            System.Diagnostics.Debug.WriteLine("========================================");

            SetupUI();

            // Initialize the APEX downloader
            _apexDownloader = new ApexHtmlFileDownloader();
            _messageRouters = new Dictionary<WebView2, WebViewMessageRouter>();
            var restClient = new RestApiClient();
            _claudeApiHandler = new ClaudeApiHandler();
            _promptHistoryManager = new PromptHistoryManager();

            // Initialize Print Management Services
            _printJobManager = new PrintJobManager();
            _storageManager = new LocalStorageManager();
            _printerService = new PrinterService();
            _restApiClient = new RestApiClient();
        }

        private void InitializeComponent1()
        {
            this.Text = "Fusion client Webview v2 - Released 20-Nov-2025";
            this.Size = new Size(1200, 800);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(240, 240, 240);
        }

        private bool ShowLoginForm()
        {
            using (LoginForm loginForm = new LoginForm())
            {
                if (loginForm.ShowDialog() == DialogResult.OK && loginForm.LoginSuccessful)
                {
                    _loggedInUsername = loginForm.Username;
                    _loggedInInstance = loginForm.InstanceName;
                    _loggedInDateTime = DateTime.Now.ToString("MMM dd, yyyy hh:mm:ss tt");
                    _isLoggedIn = true;

                    System.Diagnostics.Debug.WriteLine($"[LOGIN] Success - User: {_loggedInUsername}, Instance: {_loggedInInstance}, DateTime: {_loggedInDateTime}");
                    return true;
                }
                return false;
            }
        }

        private void HandleLogout()
        {
            System.Diagnostics.Debug.WriteLine("[LOGOUT] Clearing user session...");

            // Clear session variables
            _isLoggedIn = false;
            _loggedInUsername = null;
            _loggedInInstance = null;
            _loggedInDateTime = null;

            System.Diagnostics.Debug.WriteLine("[LOGOUT] User session cleared successfully");
        }

        private void SetupUI()
        {
            // Initialize ToolTip
            moduleToolTip = new ToolTip
            {
                AutoPopDelay = 3000,
                InitialDelay = 500,
                ReshowDelay = 200,
                ShowAlways = true
            };

            // Title bar panel with tabs
            Panel titleBarPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 32,
                BackColor = Color.FromArgb(32, 32, 32)
            };

            // Tab bar (for custom tabs)
            tabBar = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(32, 32, 32),
                WrapContents = false,
                AutoScroll = false,
                Padding = new Padding(5, 2, 5, 0)
            };

            // New Tab button in title bar
            Button newTabButton = new Button
            {
                Text = "+",
                Width = 35,
                Height = 26,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(50, 50, 50),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 16, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            newTabButton.FlatAppearance.BorderSize = 0;
            newTabButton.Click += (s, e) => AddNewTab("https://www.google.com");

            tabBar.Controls.Add(newTabButton);
            titleBarPanel.Controls.Add(tabBar);

            // Navigation panel
            Panel navPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 50,
                BackColor = Color.White,
                Padding = new Padding(10, 10, 10, 10)
            };

            int leftPosition = 10;

            // Back button - HIDDEN
            backButton = new Button
            {
                Text = "←",
                Width = 35,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 12),
                Cursor = Cursors.Hand,
                Visible = false
            };
            backButton.FlatAppearance.BorderColor = Color.LightGray;
            backButton.Click += BackButton_Click;

            // Forward button - HIDDEN
            forwardButton = new Button
            {
                Text = "→",
                Width = 35,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 12),
                Cursor = Cursors.Hand,
                Visible = false
            };
            forwardButton.FlatAppearance.BorderColor = Color.LightGray;
            forwardButton.Click += ForwardButton_Click;

            // Refresh button - VISIBLE
            refreshButton = new Button
            {
                Text = "⟳",
                Width = 35,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 12),
                Cursor = Cursors.Hand
            };
            refreshButton.FlatAppearance.BorderColor = Color.LightGray;
            refreshButton.Click += RefreshButton_Click;
            leftPosition += 40;

            // Home button - HIDDEN
            homeButton = new Button
            {
                Text = "⌂",
                Width = 35,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 12),
                Cursor = Cursors.Hand,
                Visible = false
            };
            homeButton.FlatAppearance.BorderColor = Color.LightGray;
            homeButton.Click += HomeButton_Click;

            // Open File button - VISIBLE
            openFileButton = new Button
            {
                Text = "📁",
                Width = 35,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 12),
                Cursor = Cursors.Hand
            };
            openFileButton.FlatAppearance.BorderColor = Color.LightGray;
            openFileButton.Click += OpenFileButton_Click;
            leftPosition += 45;

            // Clear Cache button - VISIBLE
            clearCacheButton = new Button
            {
                Text = "🗑️",
                Width = 35,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 12),
                Cursor = Cursors.Hand,
                BackColor = Color.FromArgb(255, 240, 240)
            };
            clearCacheButton.FlatAppearance.BorderColor = Color.LightCoral;
            clearCacheButton.Click += ClearCacheButton_Click;
            moduleToolTip.SetToolTip(clearCacheButton, "Clear Browser Cache");
            leftPosition += 45;

            // WMS (Dev) Button - Launches local development version
            wmsDevButton = new Button
            {
                Text = "WMS (Dev)",
                Width = 85,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                BackColor = Color.FromArgb(255, 245, 200),
                ForeColor = Color.FromArgb(80, 80, 80),
                Font = new Font("Segoe UI", 8, FontStyle.Bold),
                Tag = "WMS_DEV"
            };
            wmsDevButton.FlatAppearance.BorderColor = Color.FromArgb(220, 180, 80);
            wmsDevButton.FlatAppearance.BorderSize = 1;
            wmsDevButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(255, 240, 180);
            wmsDevButton.Click += (s, e) =>
            {
                // Check if user is logged in for WMS, if not show login form
                if (!_isLoggedIn)
                {
                    if (!ShowLoginForm())
                    {
                        // User cancelled login
                        System.Diagnostics.Debug.WriteLine("[WMS Login] User cancelled login");
                        return;
                    }
                }

                // Load local development version from repository root
                // Navigate from bin/debug/net8.0 up to repository root
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "wms", "index.html"));

                if (File.Exists(indexPath))
                {
                    System.Diagnostics.Debug.WriteLine($"[WMS Dev] Launching from local: {indexPath}");
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                    // Send user session after navigation completes (handled in NavigationCompleted event)
                }
                else
                {
                    MessageBox.Show(
                        "Local WMS development files not found at:\n" + indexPath,
                        "WMS Dev Not Found",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                }
            };
            moduleToolTip.SetToolTip(wmsDevButton, "WMS Development - Local Version");
            leftPosition += 90;

            // WMS (Prod) Button - Launches production version from GitHub distribution
            wmsProdButton = new Button
            {
                Text = "WMS (Prod)",
                Width = 90,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                BackColor = Color.FromArgb(100, 180, 255),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 8, FontStyle.Bold),
                Tag = "WMS_PROD"
            };
            wmsProdButton.FlatAppearance.BorderColor = Color.FromArgb(50, 150, 255);
            wmsProdButton.FlatAppearance.BorderSize = 1;
            wmsProdButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(120, 200, 255);
            wmsProdButton.Click += (s, e) =>
            {
                // Check if user is logged in for WMS, if not show login form
                if (!_isLoggedIn)
                {
                    if (!ShowLoginForm())
                    {
                        // User cancelled login
                        System.Diagnostics.Debug.WriteLine("[WMS Login] User cancelled login");
                        return;
                    }
                }

                // Check if distribution folder exists
                string distributionFolder = "C:\\fusion\\fusionclientweb\\wms";
                string indexPath = Path.Combine(distributionFolder, "index.html");

                if (Directory.Exists(distributionFolder) && File.Exists(indexPath))
                {
                    // Distribution exists - navigate to it
                    System.Diagnostics.Debug.WriteLine($"[WMS Prod] Launching from distribution: {indexPath}");
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
                else
                {
                    // Distribution doesn't exist - prompt to download
                    System.Diagnostics.Debug.WriteLine($"[WMS Prod] Distribution not found: {distributionFolder}");
                    var result = MessageBox.Show(
                        "WMS module not installed yet.\n\n" +
                        "Would you like to download it now?\n" +
                        "This will download from GitHub and install to:\n" +
                        distributionFolder,
                        "WMS Not Installed",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question);

                    if (result == DialogResult.Yes)
                    {
                        // Navigate to local WMS page which has the distribution manager
                        string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                        string launcherPath = Path.GetFullPath(Path.Combine(repoRoot, "wms", "index.html"));
                        if (File.Exists(launcherPath))
                        {
                            string launcherUrl = "file:///" + launcherPath.Replace("\\", "/");
                            Navigate(launcherUrl);

                            // Wait for page to load, then trigger download
                            var downloadTimer = new System.Windows.Forms.Timer();
                            downloadTimer.Interval = 1500;
                            downloadTimer.Tick += (sender2, e2) =>
                            {
                                downloadTimer.Stop();
                                downloadTimer.Dispose();

                                var wv = GetCurrentWebView();
                                if (wv?.CoreWebView2 != null)
                                {
                                    System.Diagnostics.Debug.WriteLine("[WMS Prod] Triggering download...");
                                    wv.CoreWebView2.ExecuteScriptAsync("if (typeof downloadNewVersion === 'function') { downloadNewVersion(); }");
                                }
                            };
                            downloadTimer.Start();
                        }
                        else
                        {
                            MessageBox.Show(
                                "Cannot trigger download. Local WMS files not found.",
                                "Error",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error);
                        }
                    }
                }
            };
            moduleToolTip.SetToolTip(wmsProdButton, "WMS Production - GitHub Distribution");
            leftPosition += 95;

            // Modules Dropdown Button
            modulesButton = new Button
            {
                Text = "Modules ▼",
                Width = 90,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                BackColor = Color.FromArgb(240, 240, 240),
                ForeColor = Color.FromArgb(60, 60, 60),
                Font = new Font("Segoe UI", 8, FontStyle.Bold),
                Tag = "MODULES"
            };
            modulesButton.FlatAppearance.BorderColor = Color.FromArgb(180, 180, 180);
            modulesButton.FlatAppearance.BorderSize = 1;
            modulesButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(230, 230, 230);

            // Create context menu for modules dropdown
            modulesContextMenu = new ContextMenuStrip();
            modulesContextMenu.Items.Add("WMS - Warehouse Management").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "wms", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("GL - General Ledger").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "gl", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("SYNC - Oracle Fusion Sync").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "sync", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("AR - Accounts Receivable").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "ar", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("AP - Accounts Payable").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "ap", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("OM - Order Management").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "om", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("FA - Fixed Assets").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "fa", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("CA - Cash Management").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "ca", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesContextMenu.Items.Add("POS - Point of Sale").Click += (s, e) =>
            {
                string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                string indexPath = Path.GetFullPath(Path.Combine(repoRoot, "pos", "index.html"));
                if (File.Exists(indexPath))
                {
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    Navigate(fileUrl);
                }
            };

            modulesButton.Click += (s, e) =>
            {
                modulesContextMenu.Show(modulesButton, new Point(0, modulesButton.Height));
            };

            moduleToolTip.SetToolTip(modulesButton, "Select a module to launch");
            leftPosition += 95;

            // Compact Oval URL panel container
            urlPanel = new Panel
            {
                Left = leftPosition,
                Top = 10,
                Width = this.ClientSize.Width - leftPosition - 250,
                Height = 32,
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
                BackColor = Color.White
            };
            urlPanel.Paint += UrlPanel_Paint;

            // Security/Lock icon (inside oval panel on the left)
            securityIcon = new Label
            {
                Text = "🔒",
                Left = 8,
                Top = 7,
                Width = 20,
                Height = 18,
                Font = new Font("Segoe UI", 10),
                TextAlign = ContentAlignment.MiddleCenter,
                BackColor = Color.Transparent,
                Cursor = Cursors.Hand
            };
            securityIcon.Click += SecurityIcon_Click;

            // URL textbox (inside oval panel, after security icon)
            urlTextBox = new TextBox
            {
                Left = 32,
                Top = 7,
                Height = 18,
                BorderStyle = BorderStyle.None,
                Font = new Font("Segoe UI", 9),
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
            };
            urlTextBox.Width = urlPanel.Width - 150;
            urlTextBox.KeyDown += UrlTextBox_KeyDown;

            // Favorite button (star icon) - compact version
            favoriteButton = new Button
            {
                Text = "☆",
                Width = 28,
                Height = 22,
                Top = 5,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 12),
                BackColor = Color.White,
                ForeColor = Color.Gray,
                Cursor = Cursors.Hand,
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                TabStop = false
            };
            favoriteButton.FlatAppearance.BorderSize = 0;
            favoriteButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(245, 245, 245);
            favoriteButton.Click += FavoriteButton_Click;

            // Copilot button (icon version) - made more compact
            copilotButton = new Button
            {
                Text = "🤖",
                Width = 28,
                Height = 22,
                Top = 5,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 11),
                BackColor = Color.White,
                ForeColor = Color.FromArgb(0, 100, 200),
                Cursor = Cursors.Hand,
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                TabStop = false
            };
            copilotButton.FlatAppearance.BorderSize = 0;
            copilotButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(230, 240, 255);
            copilotButton.Click += CopilotButton_Click;

            // Add controls to URL panel
            urlPanel.Controls.Add(securityIcon);
            urlPanel.Controls.Add(urlTextBox);
            urlPanel.Controls.Add(favoriteButton);
            urlPanel.Controls.Add(copilotButton);

            // Position buttons from right to left inside the URL panel
            copilotButton.Left = urlPanel.Width - copilotButton.Width - 8;
            favoriteButton.Left = copilotButton.Left - favoriteButton.Width - 2;
            urlTextBox.Width = favoriteButton.Left - urlTextBox.Left - 5;

            // Profile button (outside URL panel, to the right)
            profileButton = new Button
            {
                Text = "👤",
                Width = 35,
                Height = 30,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 14),
                BackColor = Color.White,
                Cursor = Cursors.Hand,
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                TabStop = false
            };
            profileButton.Left = urlPanel.Right + 10;
            profileButton.FlatAppearance.BorderColor = Color.LightGray;
            profileButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(240, 240, 240);
            profileButton.Click += ProfileButton_Click;

            // History button (after profile button)
            historyButton = new Button
            {
                Text = "",
                Width = 60,
                Height = 30,
                Left = leftPosition,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                BackColor = Color.FromArgb(245, 235, 220),
                Tag = "His"
            };
            historyButton.Left = profileButton.Right + 5;
            historyButton.FlatAppearance.BorderColor = Color.LightGray;
            historyButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(240, 240, 240);
            historyButton.Click += HistoryButton_Click;

            // Add to navigation panel
            navPanel.Controls.Add(historyButton);

            // Settings button (3 dots)
            Button settingsButton = new Button
            {
                Text = "⋮",
                Width = 35,
                Height = 30,
                Top = 10,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 16, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            settingsButton.Left = this.ClientSize.Width - 45;
            settingsButton.FlatAppearance.BorderColor = Color.LightGray;

            // Add controls to navigation panel
            navPanel.Controls.Add(backButton);
            navPanel.Controls.Add(forwardButton);
            navPanel.Controls.Add(refreshButton);
            navPanel.Controls.Add(homeButton);
            navPanel.Controls.Add(openFileButton);
            navPanel.Controls.Add(clearCacheButton);
            navPanel.Controls.Add(wmsDevButton);
            navPanel.Controls.Add(wmsProdButton);
            navPanel.Controls.Add(modulesButton);
            // navPanel.Controls.Add(urlPanel); // HIDDEN: Address bar removed per user request
            navPanel.Controls.Add(profileButton);
            navPanel.Controls.Add(settingsButton);

            // Web content panel
            Panel contentPanel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.White
            };

            // Add controls to form
            this.Controls.Add(contentPanel);
            this.Controls.Add(navPanel);
            this.Controls.Add(titleBarPanel);

            // Create initial tab
            AddNewTab("https://www.google.com");
        }

        private void LogDebug(string message)
        {
            System.Diagnostics.Debug.WriteLine($"[DEBUG] {DateTime.Now:HH:mm:ss} - {message}");
        }

        private void HistoryButton_Click(object sender, EventArgs e)
        {
            var viewer = new PromptHistoryViewer(_promptHistoryManager);
            viewer.ShowDialog();
        }

        private void UrlPanel_Paint(object sender, PaintEventArgs e)
        {
            Panel panel = sender as Panel;
            using (GraphicsPath path = GetRoundedRectangle(panel.ClientRectangle, 16))
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

                using (SolidBrush brush = new SolidBrush(Color.FromArgb(248, 248, 248)))
                {
                    e.Graphics.FillPath(brush, path);
                }

                using (Pen pen = new Pen(Color.FromArgb(220, 220, 220), 1.5f))
                {
                    e.Graphics.DrawPath(pen, path);
                }
            }
        }

        private GraphicsPath GetRoundedRectangle(Rectangle rect, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        private async Task LoadModule(string moduleCode, string apexHtmlUrl)
        {
            try
            {
                string localFileName = GetHtmlFileNameForModule(moduleCode);
                string localFileUrl = await _apexDownloader.DownloadApexHtmlFileAsync(apexHtmlUrl, localFileName);
                Navigate(localFileUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to load module '{moduleCode}': {ex.Message}", "Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private string GetHtmlFileNameForModule(string moduleCode)
        {
            return moduleCode switch
            {
                "GL" => "general_ledger.html",
                "AR" => "accounts_receivable.html",
                "AP" => "accounts_payable.html",
                "OM" => "order_management.html",
                "FA" => "fixed_assets.html",
                "CA" => "cash_management.html",
                "WMS" => "warehouse.html",
                _ => $"{moduleCode.ToLower()}.html"
            };
        }

        private void ModuleButton_Paint(object sender, PaintEventArgs e)
        {
            Button btn = sender as Button;
            if (btn == null) return;

            string moduleCode = btn.Tag?.ToString() ?? "";
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            int iconX = 12;
            int iconY = btn.Height / 2;

            switch (moduleCode)
            {
                case "GL":
                    using (Brush blueBrush = new SolidBrush(Color.FromArgb(30, 120, 255)))
                    using (Pen bluePen = new Pen(Color.FromArgb(30, 120, 255), 1.5f))
                    {
                        e.Graphics.FillRectangle(blueBrush, iconX - 6, iconY + 1, 3, 4);
                        e.Graphics.FillRectangle(blueBrush, iconX - 2, iconY - 2, 3, 7);
                        e.Graphics.FillRectangle(blueBrush, iconX + 2, iconY - 4, 3, 9);
                    }
                    break;

                case "AR":
                    using (Font iconFont = new Font("Arial", 11, FontStyle.Bold))
                    using (Brush greenBrush = new SolidBrush(Color.FromArgb(50, 180, 50)))
                    {
                        e.Graphics.DrawString("$", iconFont, greenBrush, iconX - 5, iconY - 9);
                    }
                    break;

                case "AP":
                    using (Brush orangeBrush = new SolidBrush(Color.FromArgb(255, 120, 60)))
                    using (Pen orangePen = new Pen(Color.FromArgb(255, 120, 60), 1.5f))
                    {
                        Rectangle cardRect = new Rectangle(iconX - 6, iconY - 4, 12, 8);
                        e.Graphics.DrawRectangle(orangePen, cardRect);
                        e.Graphics.FillRectangle(orangeBrush, iconX - 6, iconY - 2, 12, 2);
                    }
                    break;

                case "OM":
                    using (Pen purplePen = new Pen(Color.FromArgb(140, 80, 220), 1.5f))
                    {
                        Rectangle boxRect = new Rectangle(iconX - 6, iconY - 4, 11, 8);
                        e.Graphics.DrawRectangle(purplePen, boxRect);
                        e.Graphics.DrawLine(purplePen, iconX - 6, iconY - 4, iconX, iconY - 1);
                        e.Graphics.DrawLine(purplePen, iconX + 5, iconY - 4, iconX, iconY - 1);
                        e.Graphics.DrawLine(purplePen, iconX, iconY - 1, iconX, iconY + 4);
                    }
                    break;

                case "FA":
                    using (Brush brownBrush = new SolidBrush(Color.FromArgb(160, 120, 80)))
                    {
                        Rectangle buildingRect = new Rectangle(iconX - 5, iconY - 5, 10, 10);
                        e.Graphics.FillRectangle(brownBrush, buildingRect);
                        using (Brush whiteBrush = new SolidBrush(Color.White))
                        {
                            e.Graphics.FillRectangle(whiteBrush, iconX - 4, iconY - 4, 2, 2);
                            e.Graphics.FillRectangle(whiteBrush, iconX + 1, iconY - 4, 2, 2);
                            e.Graphics.FillRectangle(whiteBrush, iconX - 4, iconY, 2, 2);
                            e.Graphics.FillRectangle(whiteBrush, iconX + 1, iconY, 2, 2);
                        }
                    }
                    break;

                case "CA":
                    using (Brush tealBrush = new SolidBrush(Color.FromArgb(60, 180, 160)))
                    {
                        e.Graphics.FillRectangle(tealBrush, iconX - 6, iconY - 1, 2, 6);
                        e.Graphics.FillRectangle(tealBrush, iconX - 2, iconY - 1, 2, 6);
                        e.Graphics.FillRectangle(tealBrush, iconX + 2, iconY - 1, 2, 6);
                        Point[] roof = new Point[]
                        {
                            new Point(iconX - 7, iconY - 1),
                            new Point(iconX, iconY - 5),
                            new Point(iconX + 5, iconY - 1)
                        };
                        e.Graphics.FillPolygon(tealBrush, roof);
                        e.Graphics.FillRectangle(tealBrush, iconX - 7, iconY + 5, 12, 1);
                    }
                    break;

                case "POS":
                    using (Pen orangePen = new Pen(Color.FromArgb(255, 140, 60), 1.5f))
                    using (Brush orangeBrush = new SolidBrush(Color.FromArgb(255, 140, 60)))
                    {
                        e.Graphics.DrawRectangle(orangePen, iconX - 4, iconY - 4, 8, 6);
                        e.Graphics.DrawLine(orangePen, iconX - 4, iconY - 4, iconX - 6, iconY - 6);
                        e.Graphics.FillEllipse(orangeBrush, iconX - 2, iconY + 3, 2, 2);
                        e.Graphics.FillEllipse(orangeBrush, iconX + 2, iconY + 3, 2, 2);
                    }
                    break;
            }

            Color textColor = Color.FromArgb(50, 50, 50);
            using (Font textFont = new Font("Segoe UI", 9, FontStyle.Bold))
            using (Brush textBrush = new SolidBrush(textColor))
            {
                StringFormat sf = new StringFormat
                {
                    Alignment = StringAlignment.Near,
                    LineAlignment = StringAlignment.Center
                };
                e.Graphics.DrawString(moduleCode, textFont, textBrush, iconX + 14, iconY, sf);
            }
        }

        private void SecurityIcon_Click(object sender, EventArgs e)
        {
            var wv = GetCurrentWebView();
            if (wv?.CoreWebView2 != null)
            {
                string url = wv.Source?.ToString() ?? "";
                string securityInfo;

                if (url.StartsWith("https://"))
                    securityInfo = "🔒 Secure connection (HTTPS)";
                else if (url.StartsWith("http://"))
                    securityInfo = "⚠️ Not secure (HTTP)";
                else if (url.StartsWith("file://"))
                    securityInfo = "📄 Local file";
                else
                    securityInfo = "ℹ️ Unknown protocol";

                MessageBox.Show(securityInfo, "Site Security", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private void AddNewTab(string url)
        {
            CustomTabButton tabButton = new CustomTabButton
            {
                TabText = "New Tab",
                Width = 200,
                Height = 26,
                BackColor = Color.FromArgb(50, 50, 50),
                ForeColor = Color.White
            };

            WebView2 newWebView = new WebView2
            {
                Dock = DockStyle.Fill,
                Visible = false
            };

            tabButton.WebView = newWebView;
            tabButton.Click += TabButton_Click;
            tabButton.CloseClicked += TabButton_CloseClicked;

            int insertIndex = tabBar.Controls.Count - 1;
            tabBar.Controls.Add(tabButton);
            tabBar.Controls.SetChildIndex(tabButton, insertIndex);

            Panel contentPanel = this.Controls[0] as Panel;
            contentPanel.Controls.Add(newWebView);

            SelectTab(tabButton);
            InitializeWebView(newWebView, url);
        }

        private void TabButton_Click(object sender, EventArgs e)
        {
            SelectTab(sender as CustomTabButton);
        }

        private void SelectTab(CustomTabButton tabButton)
        {
            foreach (Control ctrl in tabBar.Controls)
            {
                if (ctrl is CustomTabButton tab)
                {
                    tab.IsSelected = false;
                    tab.BackColor = Color.FromArgb(50, 50, 50);
                    if (tab.WebView != null)
                        tab.WebView.Visible = false;
                }
            }

            tabButton.IsSelected = true;
            tabButton.BackColor = Color.FromArgb(70, 70, 70);
            if (tabButton.WebView != null)
            {
                tabButton.WebView.Visible = true;
                if (tabButton.WebView.CoreWebView2 != null)
                {
                    urlTextBox.Text = tabButton.WebView.Source?.ToString() ?? "";
                    UpdateNavigationButtons(tabButton.WebView);
                    UpdateSecurityIcon(tabButton.WebView);
                }
            }
        }

        private void TabButton_CloseClicked(object sender, EventArgs e)
        {
            CustomTabButton tabButton = sender as CustomTabButton;

            int index = tabBar.Controls.IndexOf(tabButton);
            CustomTabButton nextTab = null;

            if (index > 0)
                nextTab = tabBar.Controls[index - 1] as CustomTabButton;
            else if (tabBar.Controls.Count > 2)
                nextTab = tabBar.Controls[index + 1] as CustomTabButton;

            if (tabButton.WebView != null)
            {
                Panel contentPanel = this.Controls[0] as Panel;
                contentPanel.Controls.Remove(tabButton.WebView);
                tabButton.WebView.Dispose();
            }

            tabBar.Controls.Remove(tabButton);

            if (nextTab != null)
                SelectTab(nextTab);
            else
                this.Close();
        }

        private async void InitializeWebView(WebView2 wv, string url)
        {
            try
            {
                await wv.EnsureCoreWebView2Async(null);

                // CACHE FIX: Clear browser cache to ensure tabs load properly
                try
                {
                    await wv.CoreWebView2.Profile.ClearBrowsingDataAsync(
                        CoreWebView2BrowsingDataKinds.AllDomStorage |
                        CoreWebView2BrowsingDataKinds.CacheStorage |
                        CoreWebView2BrowsingDataKinds.DiskCache);
                    System.Diagnostics.Debug.WriteLine("[CACHE] Browser cache cleared successfully");
                }
                catch (Exception cacheEx)
                {
                    System.Diagnostics.Debug.WriteLine($"[CACHE] Warning: Could not clear cache: {cacheEx.Message}");
                }

                wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                wv.CoreWebView2.Settings.AreDevToolsEnabled = true;
                wv.CoreWebView2.Settings.IsWebMessageEnabled = true;

                wv.CoreWebView2.WebMessageReceived += async (sender, args) =>
                {
                    try
                    {
                        string messageJson = args.WebMessageAsJson;
                        System.Diagnostics.Debug.WriteLine($"[C# RECEIVED] {messageJson}");

                        using (var doc = JsonDocument.Parse(messageJson))
                        {
                            var root = doc.RootElement;
                            string action = root.GetProperty("action").GetString();
                            string requestId = root.GetProperty("requestId").GetString();

                            System.Diagnostics.Debug.WriteLine($"[C#] Action: {action}, RequestId: {requestId}");

                            switch (action)
                            {
                                case "executeGet":
                                    await HandleRestApiRequest(wv, messageJson, requestId);
                                    break;

                                case "executePost":
                                    await HandleRestApiPostRequest(wv, messageJson, requestId);
                                    break;

                                case "executeDelete":
                                    await HandleRestApiDeleteRequest(wv, messageJson, requestId);
                                    break;

                                case "claudeApiTest":
                                    await HandleClaudeApiTest(wv, messageJson, requestId);
                                    break;

                                case "claudeApiRequest":
                                    await HandleClaudeApiRequest(wv, messageJson, requestId);
                                    break;

                                // Print Management Cases
                                case "enableAutoPrint":
                                    await HandleEnableAutoPrint(wv, messageJson, requestId);
                                    break;

                                case "disableAutoPrint":
                                    await HandleDisableAutoPrint(wv, messageJson, requestId);
                                    break;

                                case "downloadOrderPdf":
                                    await HandleDownloadOrderPdf(wv, messageJson, requestId);
                                    break;

                                // 🔧 NEW: Check if PDF exists locally
                                case "checkPdfExists":
                                    await HandleCheckPdfExists(wv, messageJson, requestId);
                                    break;

                                case "printOrder":
                                    await HandlePrintOrder(wv, messageJson, requestId);
                                    break;

                                case "getPrintJobs":
                                    await HandleGetPrintJobs(wv, messageJson, requestId);
                                    break;

                                case "retryFailedJobs":
                                    await HandleRetryFailedJobs(wv, messageJson, requestId);
                                    break;

                                case "configurePrinter":
                                    await HandleConfigurePrinter(wv, messageJson, requestId);
                                    break;

                                case "getPrinterConfig":
                                    await HandleGetPrinterConfig(wv, messageJson, requestId);
                                    break;

                                case "getInstalledPrinters":
                                    await HandleGetInstalledPrinters(wv, messageJson, requestId);
                                    break;

                                case "testPrinter":
                                    await HandleTestPrinter(wv, messageJson, requestId);
                                    break;

                                case "discoverBluetoothPrinters":
                                    await HandleDiscoverBluetoothPrinters(wv, messageJson, requestId);
                                    break;

                                case "discoverWifiPrinters":
                                    await HandleDiscoverWifiPrinters(wv, messageJson, requestId);
                                    break;

                                case "setInstanceSetting":
                                    await HandleSetInstanceSetting(wv, messageJson, requestId);
                                    break;

                                case "getAllPrintJobs":
                                    await HandleGetAllPrintJobs(wv, messageJson, requestId);
                                    break;

                                case "getPdfAsBase64":
                                    await HandleGetPdfAsBase64(wv, messageJson, requestId);
                                    break;

                                case "openFileInExplorer":
                                    await HandleOpenFileInExplorer(wv, messageJson, requestId);
                                    break;

                                // 🔧 NEW: Open PDF file with default viewer
                                case "openPdfFile":
                                    await HandleOpenPdfFile(wv, messageJson, requestId);
                                    break;

                                // 🔧 NEW: Print Store Transaction Report
                                case "printStoreTransaction":
                                    await HandlePrintStoreTransaction(wv, messageJson, requestId);
                                    break;

                                // 🔧 NEW: Run SOAP Report (Generic handler for any Oracle BI Publisher report)
                                case "runSoapReport":
                                    await HandleRunSoapReport(wv, messageJson, requestId);
                                    break;

                                // Distribution System Cases
                                case "check-distribution-folder":
                                    await HandleCheckDistributionFolder(wv, messageJson, requestId);
                                    break;

                                case "download-distribution":
                                    await HandleDownloadDistribution(wv, messageJson, requestId);
                                    break;

                                case "launch-wms-module":
                                    await HandleLaunchWMSModule(wv, messageJson, requestId);
                                    break;

                                case "loadLocalFile":
                                    await HandleLoadLocalFile(wv, messageJson, requestId);
                                    break;

                                case "logout":
                                    HandleLogout();
                                    break;

                                default:
                                    System.Diagnostics.Debug.WriteLine($"[C#] Unknown action: {action}");
                                    break;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C# ERROR] Message processing failed: {ex.Message}");
                        System.Diagnostics.Debug.WriteLine($"[C# ERROR] Stack trace: {ex.StackTrace}");
                    }
                };

                wv.CoreWebView2.NavigationStarting += CoreWebView2_NavigationStarting;
                wv.CoreWebView2.NavigationCompleted += CoreWebView2_NavigationCompleted;
                wv.CoreWebView2.NewWindowRequested += CoreWebView2_NewWindowRequested;
                wv.Source = new Uri(url);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error initializing browser: {ex.Message}", "Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // ========== REST API HANDLER ==========

        private async Task HandleRestApiRequest(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<RestApiWebMessage>(  // ← CHANGED HERE
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Processing executeGet request: {message.FullUrl}");

                // Check if credentials are provided
                bool hasCredentials = !string.IsNullOrEmpty(message.Username) && !string.IsNullOrEmpty(message.Password);
                if (hasCredentials)
                {
                    System.Diagnostics.Debug.WriteLine($"[C#] Using Basic Authentication for user: {message.Username}");
                }

                using (var httpClient = new HttpClient())
                {
                    httpClient.Timeout = TimeSpan.FromSeconds(1060);

                    // Create request message instead of using GetAsync directly
                    var request = new HttpRequestMessage(HttpMethod.Get, message.FullUrl);

                    // Add Basic Authentication header if credentials are provided
                    if (hasCredentials)
                    {
                        string credentials = Convert.ToBase64String(
                            System.Text.Encoding.ASCII.GetBytes($"{message.Username}:{message.Password}")
                        );
                        request.Headers.Add("Authorization", $"Basic {credentials}");
                        System.Diagnostics.Debug.WriteLine($"[C#] Added Authorization header with Basic authentication");
                    }

                    System.Diagnostics.Debug.WriteLine($"[C#] Making GET request to: {message.FullUrl}");

                    // Use SendAsync instead of GetAsync to support custom headers
                    var response = await httpClient.SendAsync(request);
                    string responseContent = await response.Content.ReadAsStringAsync();

                    System.Diagnostics.Debug.WriteLine($"[C#] REST call completed. Status: {response.StatusCode}, Length: {responseContent.Length}");

                    // Log error responses for debugging
                    if (!response.IsSuccessStatusCode)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C# ERROR] HTTP {response.StatusCode}: {response.ReasonPhrase}");
                        System.Diagnostics.Debug.WriteLine($"[C# ERROR] Response body: {responseContent.Substring(0, Math.Min(500, responseContent.Length))}");
                    }

                    // Log first 200 chars of successful responses for debugging
                    if (response.IsSuccessStatusCode && responseContent.Length > 0)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C#] Response preview: {responseContent.Substring(0, Math.Min(200, responseContent.Length))}...");
                    }

                    var resultMessage = new
                    {
                        action = "restResponse",
                        requestId = requestId,
                        data = responseContent
                    };

                    string resultJson = JsonSerializer.Serialize(resultMessage);
                    System.Diagnostics.Debug.WriteLine($"[C#] Sending response back to JS. RequestId: {requestId}, DataLength: {responseContent.Length}");
                    System.Diagnostics.Debug.WriteLine($"[C#] Response JSON (first 200 chars): {resultJson.Substring(0, Math.Min(200, resultJson.Length))}");
                    wv.CoreWebView2.PostWebMessageAsJson(resultJson);
                    System.Diagnostics.Debug.WriteLine($"[C#] ✓ Response sent successfully to WebView2");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] REST call failed: {ex.Message}");

                var errorMessage = new
                {
                    action = "error",
                    requestId = requestId,
                    data = new { message = ex.Message }
                };

                string errorJson = JsonSerializer.Serialize(errorMessage);
                wv.CoreWebView2.PostWebMessageAsJson(errorJson);
            }
        }

        private async Task HandleRestApiPostRequest(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<RestApiPostWebMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                string method = message.Method?.ToUpper() ?? "POST";
                System.Diagnostics.Debug.WriteLine($"[C#] Processing {method} request: {message.FullUrl}");
                System.Diagnostics.Debug.WriteLine($"[C#] Body: {message.Body}");

                using (var httpClient = new HttpClient())
                {
                    httpClient.Timeout = TimeSpan.FromSeconds(30);

                    HttpResponseMessage response;

                    if (method == "POST")
                    {
                        var content = new StringContent(
                            message.Body ?? "{}",
                            Encoding.UTF8,
                            "application/json"
                        );
                        response = await httpClient.PostAsync(message.FullUrl, content);
                    }
                    else if (method == "PUT")
                    {
                        var content = new StringContent(
                            message.Body ?? "{}",
                            Encoding.UTF8,
                            "application/json"
                        );
                        response = await httpClient.PutAsync(message.FullUrl, content);
                    }
                    else if (method == "DELETE")
                    {
                        response = await httpClient.DeleteAsync(message.FullUrl);
                    }
                    else
                    {
                        throw new Exception($"Unsupported HTTP method: {method}");
                    }

                    string responseContent = await response.Content.ReadAsStringAsync();

                    System.Diagnostics.Debug.WriteLine($"[C#] REST {method} completed. Status: {response.StatusCode}");
                    System.Diagnostics.Debug.WriteLine($"[C#] Response: {responseContent}");

                    var resultMessage = new
                    {
                        action = "restResponse",
                        requestId = requestId,
                        data = responseContent
                    };

                    string resultJson = JsonSerializer.Serialize(resultMessage);
                    System.Diagnostics.Debug.WriteLine($"[C#] Sending response back to JS. RequestId: {requestId}, DataLength: {responseContent.Length}");
                    System.Diagnostics.Debug.WriteLine($"[C#] Response JSON (first 200 chars): {resultJson.Substring(0, Math.Min(200, resultJson.Length))}");
                    wv.CoreWebView2.PostWebMessageAsJson(resultJson);
                    System.Diagnostics.Debug.WriteLine($"[C#] ✓ Response sent successfully to WebView2");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] REST call failed: {ex.Message}");

                var errorMessage = new
                {
                    action = "error",
                    requestId = requestId,
                    data = new { message = ex.Message }
                };

                string errorJson = JsonSerializer.Serialize(errorMessage);
                wv.CoreWebView2.PostWebMessageAsJson(errorJson);
            }
        }

        private async Task HandleRestApiDeleteRequest(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<RestApiWebMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Processing executeDelete request: {message.FullUrl}");

                // Check if credentials are provided
                bool hasCredentials = !string.IsNullOrEmpty(message.Username) && !string.IsNullOrEmpty(message.Password);
                if (hasCredentials)
                {
                    System.Diagnostics.Debug.WriteLine($"[C#] Using Basic Authentication for user: {message.Username}");
                }

                using (var httpClient = new HttpClient())
                {
                    httpClient.Timeout = TimeSpan.FromSeconds(1060);

                    // Create request message
                    var request = new HttpRequestMessage(HttpMethod.Delete, message.FullUrl);

                    // Add Basic Authentication header if credentials are provided
                    if (hasCredentials)
                    {
                        string credentials = Convert.ToBase64String(
                            System.Text.Encoding.ASCII.GetBytes($"{message.Username}:{message.Password}")
                        );
                        request.Headers.Add("Authorization", $"Basic {credentials}");
                        System.Diagnostics.Debug.WriteLine($"[C#] Added Authorization header with Basic authentication");
                    }

                    System.Diagnostics.Debug.WriteLine($"[C#] Making DELETE request to: {message.FullUrl}");

                    // Use SendAsync to support custom headers
                    var response = await httpClient.SendAsync(request);
                    string responseContent = await response.Content.ReadAsStringAsync();

                    System.Diagnostics.Debug.WriteLine($"[C#] DELETE call completed. Status: {response.StatusCode}, Length: {responseContent.Length}");

                    // Log error responses for debugging
                    if (!response.IsSuccessStatusCode)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C# ERROR] HTTP {response.StatusCode}: {response.ReasonPhrase}");
                        System.Diagnostics.Debug.WriteLine($"[C# ERROR] Response body: {responseContent.Substring(0, Math.Min(500, responseContent.Length))}");
                    }

                    // Log first 200 chars of successful responses for debugging
                    if (response.IsSuccessStatusCode && responseContent.Length > 0)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C#] Response preview: {responseContent.Substring(0, Math.Min(200, responseContent.Length))}...");
                    }

                    var resultMessage = new
                    {
                        action = "restResponse",
                        requestId = requestId,
                        data = responseContent
                    };

                    string resultJson = JsonSerializer.Serialize(resultMessage);
                    System.Diagnostics.Debug.WriteLine($"[C#] Sending response back to JS. RequestId: {requestId}, DataLength: {responseContent.Length}");
                    wv.CoreWebView2.PostWebMessageAsJson(resultJson);
                    System.Diagnostics.Debug.WriteLine($"[C#] ✓ DELETE response sent successfully to WebView2");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] DELETE call failed: {ex.Message}");

                var errorMessage = new
                {
                    action = "error",
                    requestId = requestId,
                    data = new { message = ex.Message }
                };

                string errorJson = JsonSerializer.Serialize(errorMessage);
                wv.CoreWebView2.PostWebMessageAsJson(errorJson);
            }
        }

        // ========== CLAUDE API HANDLERS ==========
        private async Task HandleClaudeApiTest(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<ClaudeApiTestMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Testing Claude API key...");

                var testResult = await _claudeApiHandler.TestApiKeyAsync(message.ApiKey);

                var resultMessage = new
                {
                    action = "claudeResponse",
                    requestId = requestId,
                    success = testResult.Success,
                    data = testResult.Success ? "API key is valid" : null,
                    error = testResult.Success ? null : testResult.Message
                };

                string resultJson = JsonSerializer.Serialize(resultMessage);
                wv.CoreWebView2.PostWebMessageAsJson(resultJson);

                System.Diagnostics.Debug.WriteLine($"[C#] Claude API test result: {testResult.Success}");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Claude API test failed: {ex.Message}");

                var errorMessage = new
                {
                    action = "claudeResponse",
                    requestId = requestId,
                    success = false,
                    error = ex.Message
                };

                string errorJson = JsonSerializer.Serialize(errorMessage);
                wv.CoreWebView2.PostWebMessageAsJson(errorJson);
            }
        }

        private async Task HandleClaudeApiRequest(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<ClaudeApiRequestMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Processing Claude API request: {message.UserQuery}");

                var queryResult = await _claudeApiHandler.QueryClaudeAsync(
                    message.ApiKey,
                    message.UserQuery,
                    message.SystemPrompt,
                    message.DataJson
                );

                var resultMessage = new
                {
                    action = "claudeResponse",
                    requestId = requestId,
                    success = queryResult.Success,
                    data = queryResult.Success ? queryResult.ResponseJson : null,
                    error = queryResult.Success ? null : queryResult.Error
                };

                string resultJson = JsonSerializer.Serialize(resultMessage);
                wv.CoreWebView2.PostWebMessageAsJson(resultJson);

                System.Diagnostics.Debug.WriteLine($"[C#] Claude API query completed: {queryResult.Success}");

                if (queryResult.Success)
                {
                    this.Invoke(new Action(() =>
                    {
                        PromptSaveAfterResponse(message.UserQuery, queryResult.ResponseJson);
                    }));
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Claude API request failed: {ex.Message}");

                var errorMessage = new
                {
                    action = "claudeResponse",
                    requestId = requestId,
                    success = false,
                    error = ex.Message
                };

                string errorJson = JsonSerializer.Serialize(errorMessage);
                wv.CoreWebView2.PostWebMessageAsJson(errorJson);
            }
        }

        private void PromptSaveAfterResponse(string prompt, string responseJson)
        {
            try
            {
                string responseText = ExtractClaudeResponseText(responseJson);

                var result = MessageBox.Show(
                    "💾 Would you like to save this prompt and response?",
                    "Save Prompt",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );

                if (result == DialogResult.Yes)
                {
                    bool saved = _promptHistoryManager.SavePrompt(prompt, responseText, "WMS Query");

                    if (saved)
                    {
                        MessageBox.Show(
                            "✅ Prompt saved successfully!\n\nView saved prompts by clicking the 📚 button.",
                            "Saved",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information
                        );
                    }
                    else
                    {
                        MessageBox.Show(
                            "❌ Failed to save prompt.",
                            "Error",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ERROR] Failed to prompt save: {ex.Message}");
            }
        }

        private string ExtractClaudeResponseText(string responseJson)
        {
            try
            {
                using (var doc = JsonDocument.Parse(responseJson))
                {
                    var root = doc.RootElement;
                    if (root.TryGetProperty("content", out var content) && content.GetArrayLength() > 0)
                    {
                        var firstContent = content[0];
                        if (firstContent.TryGetProperty("text", out var text))
                        {
                            return text.GetString();
                        }
                    }
                }
            }
            catch { }

            return responseJson;
        }

        // ========== PRINT MANAGEMENT HANDLERS ==========

        private async Task HandleEnableAutoPrint(WebView2 wv, string messageJson, string requestId)
        {
            //MessageBox.Show($"HandleEnableAutoPrint called!\n\nRequestId: {requestId}", "Debug", MessageBoxButtons.OK, MessageBoxIcon.Information);

            try
            {
                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine($"[C#] ⭐ HandleEnableAutoPrint STARTED");
                System.Diagnostics.Debug.WriteLine($"[C#] RequestId: {requestId}");
                System.Diagnostics.Debug.WriteLine($"[C#] Message JSON: {messageJson}");
                System.Diagnostics.Debug.WriteLine("====================================");

                var message = System.Text.Json.JsonSerializer.Deserialize<ToggleAutoPrintMessage>(
                    messageJson,
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Deserialized Message:");
                System.Diagnostics.Debug.WriteLine($"[C#]   - TripId: {message.TripId}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - TripDate: {message.TripDate}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - Enabled: {message.Enabled}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - Orders Count: {message.Orders?.Count ?? 0}");

                if (message.Orders != null)
                {
                    System.Diagnostics.Debug.WriteLine($"[C#] Order Details:");
                    foreach (var order in message.Orders)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C#]   - Order: {order.OrderNumber}, Customer: {order.CustomerName}, Account: {order.AccountNumber}");
                    }
                }

                System.Diagnostics.Debug.WriteLine($"[C#] Calling _printJobManager.EnableAutoPrintAsync...");

                var result = await _printJobManager.EnableAutoPrintAsync(
                    message.TripId,
                    message.TripDate,
                    message.Orders
                );

                System.Diagnostics.Debug.WriteLine($"[C#] EnableAutoPrintAsync Result:");
                System.Diagnostics.Debug.WriteLine($"[C#]   - Success: {result.Success}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - Message: {result.Message}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - TripConfig: {(result.TripConfig != null ? "Not Null" : "NULL")}");

                if (result.TripConfig != null)
                {
                    System.Diagnostics.Debug.WriteLine($"[C#]   - TripConfig.Orders.Count: {result.TripConfig.Orders?.Count ?? 0}");
                }

                var response = new
                {
                    action = "autoPrintResponse",
                    requestId = requestId,
                    success = result.Success,
                    message = result.Message,
                    data = result.TripConfig
                };

                string responseJson = System.Text.Json.JsonSerializer.Serialize(response);
                System.Diagnostics.Debug.WriteLine($"[C#] Sending response to JavaScript:");
                System.Diagnostics.Debug.WriteLine($"[C#] {responseJson}");

                wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                System.Diagnostics.Debug.WriteLine($"[C#] ✅ HandleEnableAutoPrint COMPLETED");
                System.Diagnostics.Debug.WriteLine("====================================");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] ❌ HandleEnableAutoPrint FAILED");
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Exception: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Stack Trace: {ex.StackTrace}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }
        private async Task HandleDisableAutoPrint(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<ToggleAutoPrintMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Disabling auto-print for trip {message.TripId}");

                bool success = _printJobManager.DisableAutoPrint(message.TripId, message.TripDate);

                var response = new
                {
                    action = "autoPrintResponse",
                    requestId = requestId,
                    success = success,
                    message = success ? "Auto-print disabled" : "Failed to disable auto-print"
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Disable auto-print failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        // 2. ADD THESE METHODS AT THE END OF Form1 CLASS:

        /// <summary>
        /// Get all print jobs with actual file status
        /// </summary>
        private async Task HandleGetAllPrintJobs(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Getting all print jobs...");

                // Get all print jobs from PrintJobManager
                var jobs = await PrintJobManager.GetAllPrintJobsAsync();

                System.Diagnostics.Debug.WriteLine($"[C#] Found {jobs.Count} print jobs");

                // Check actual file status for each job
                foreach (var job in jobs)
                {
                    // Check if PDF file actually exists
                    if (!string.IsNullOrEmpty(job.FilePath) && File.Exists(job.FilePath))
                    {
                        // File exists - update status if needed
                        if (job.Status == PrintJobStatus.Pending ||
                            job.Status == PrintJobStatus.Failed)
                        {
                            job.Status = PrintJobStatus.Completed;
                        }
                    }
                    else
                    {
                        // File doesn't exist - clear file path
                        job.FilePath = null;

                        // If status was completed but file is missing, mark as pending
                        if (job.Status == PrintJobStatus.Completed)
                        {
                            job.Status = PrintJobStatus.Pending;
                        }
                    }
                }

                // Convert to JSON-friendly format
                var jobsData = jobs.Select(j => new
                {
                    orderNumber = j.OrderNumber,
                    tripId = j.TripId,
                    tripDate = j.TripDate,
                    status = j.Status.ToString(),
                    filePath = j.FilePath ?? "",
                    errorMessage = j.ErrorMessage ?? "",
                    createdAt = j.CreatedAt.ToString("o"),
                    updatedAt = j.UpdatedAt?.ToString("o") ?? ""
                }).ToList();

                var response = new
                {
                    action = "getAllPrintJobsResponse",
                    requestId = requestId,
                    success = true,
                    data = new
                    {
                        jobs = jobsData,
                        count = jobsData.Count
                    }
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                System.Diagnostics.Debug.WriteLine($"[C#] Sent {jobsData.Count} print jobs to UI");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Get all print jobs failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        /// <summary>
        /// Get PDF file as Base64 for preview
        /// </summary>
        private async Task HandleGetPdfAsBase64(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Getting PDF as Base64...");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string filePath = root.GetProperty("filePath").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] File path: {filePath}");

                    if (!File.Exists(filePath))
                    {
                        throw new FileNotFoundException($"PDF file not found: {filePath}");
                    }

                    // Read file and convert to Base64
                    byte[] fileBytes = File.ReadAllBytes(filePath);
                    string base64String = Convert.ToBase64String(fileBytes);

                    System.Diagnostics.Debug.WriteLine($"[C#] PDF size: {fileBytes.Length} bytes");
                    System.Diagnostics.Debug.WriteLine($"[C#] Base64 length: {base64String.Length} chars");

                    var response = new
                    {
                        action = "getPdfAsBase64Response",
                        requestId = requestId,
                        success = true,
                        data = new
                        {
                            base64 = base64String,
                            fileName = Path.GetFileName(filePath),
                            fileSize = fileBytes.Length
                        }
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                    System.Diagnostics.Debug.WriteLine($"[C#] PDF sent to UI for preview");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Get PDF as Base64 failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        /// <summary>
        /// Open file location in Windows Explorer
        /// </summary>
        private async Task HandleOpenFileInExplorer(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Opening file in Explorer...");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string filePath = root.GetProperty("filePath").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] File path: {filePath}");

                    if (!File.Exists(filePath))
                    {
                        throw new FileNotFoundException($"File not found: {filePath}");
                    }

                    // Open Windows Explorer and select the file
                    System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{filePath}\"");

                    var response = new
                    {
                        action = "openFileInExplorerResponse",
                        requestId = requestId,
                        success = true,
                        message = "File location opened in Explorer"
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                    System.Diagnostics.Debug.WriteLine($"[C#] Explorer opened");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Open file in Explorer failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        // 🔧 NEW: Open PDF file with default PDF viewer
        private async Task HandleOpenPdfFile(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Opening PDF file with default viewer...");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string filePath = root.GetProperty("filePath").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] File path: {filePath}");

                    if (!File.Exists(filePath))
                    {
                        throw new FileNotFoundException($"PDF file not found: {filePath}");
                    }

                    // Open PDF with default application (e.g., Adobe Reader, Edge, etc.)
                    var processStartInfo = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = filePath,
                        UseShellExecute = true  // This uses the Windows file association
                    };

                    System.Diagnostics.Process.Start(processStartInfo);

                    var response = new
                    {
                        action = "openPdfFileResponse",
                        requestId = requestId,
                        success = true,
                        message = "PDF opened with default viewer"
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                    System.Diagnostics.Debug.WriteLine($"[C#] ✅ PDF opened successfully");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Open PDF file failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        // Load local HTML file content (for Sync module external pages)
        private async Task HandleLoadLocalFile(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Loading local file...");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string filePath = root.GetProperty("filePath").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] File path: {filePath}");

                    // Resolve path relative to sync folder
                    string repoRoot = Path.Combine(Application.StartupPath, "..", "..", "..");
                    string fullPath = Path.GetFullPath(Path.Combine(repoRoot, "sync", filePath));

                    System.Diagnostics.Debug.WriteLine($"[C#] Full path: {fullPath}");

                    if (!File.Exists(fullPath))
                    {
                        throw new FileNotFoundException($"File not found: {fullPath}");
                    }

                    // Read file content
                    string content = await File.ReadAllTextAsync(fullPath);

                    var response = new
                    {
                        action = "loadLocalFileResponse",
                        requestId = requestId,
                        success = true,
                        content = content,
                        filePath = filePath
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                    System.Diagnostics.Debug.WriteLine($"[C#] ✅ File loaded successfully: {filePath}");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Load local file failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        // ========== DISTRIBUTION SYSTEM HANDLERS ==========

        private async Task HandleCheckDistributionFolder(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Checking distribution folder...");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string folder = root.GetProperty("folder").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] Distribution folder: {folder}");

                    // Check if folder exists and contains index.html
                    bool exists = Directory.Exists(folder) &&
                                  File.Exists(Path.Combine(folder, "index.html"));

                    System.Diagnostics.Debug.WriteLine($"[C#] Folder exists with index.html: {exists}");

                    var response = new
                    {
                        type = "distribution-folder-exists",
                        exists = exists,
                        folder = folder,
                        requestId = requestId
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                    System.Diagnostics.Debug.WriteLine($"[C#] ✅ Distribution folder check complete");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Check distribution folder failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        private async Task HandleDownloadDistribution(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Starting distribution download...");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string version = root.GetProperty("version").GetString();
                    string packageUrl = root.GetProperty("packageUrl").GetString();
                    string extractTo = root.GetProperty("extractTo").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] Version: {version}");
                    System.Diagnostics.Debug.WriteLine($"[C#] Package URL: {packageUrl}");
                    System.Diagnostics.Debug.WriteLine($"[C#] Extract to: {extractTo}");

                    // Create temp path for download
                    string tempZipPath = Path.Combine(Path.GetTempPath(), $"wms-distribution-{version}.zip");

                    System.Diagnostics.Debug.WriteLine($"[C#] Temp ZIP path: {tempZipPath}");

                    // Download file with progress reporting
                    using (WebClient client = new WebClient())
                    {
                        client.DownloadProgressChanged += (s, e) =>
                        {
                            // Send progress updates to JavaScript
                            var progressResponse = new
                            {
                                type = "distribution-download-progress",
                                percent = e.ProgressPercentage,
                                bytesReceived = e.BytesReceived,
                                totalBytes = e.TotalBytesToReceive,
                                requestId = requestId
                            };

                            string progressJson = JsonSerializer.Serialize(progressResponse);
                            wv.CoreWebView2.PostWebMessageAsJson(progressJson);
                        };

                        System.Diagnostics.Debug.WriteLine($"[C#] Downloading from GitHub...");
                        await client.DownloadFileTaskAsync(packageUrl, tempZipPath);
                        System.Diagnostics.Debug.WriteLine($"[C#] Download complete!");
                    }

                    // Create extraction folder if it doesn't exist
                    if (!Directory.Exists(extractTo))
                    {
                        System.Diagnostics.Debug.WriteLine($"[C#] Creating distribution folder: {extractTo}");
                        Directory.CreateDirectory(extractTo);
                    }

                    // Backup existing files if folder already has content
                    string backupFolder = extractTo + ".backup";
                    if (Directory.Exists(extractTo) && Directory.GetFiles(extractTo).Length > 0)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C#] Backing up existing files to: {backupFolder}");

                        if (Directory.Exists(backupFolder))
                        {
                            Directory.Delete(backupFolder, true);
                        }

                        // Copy current files to backup
                        CopyDirectory(extractTo, backupFolder);
                    }

                    // Extract ZIP file
                    System.Diagnostics.Debug.WriteLine($"[C#] Extracting ZIP file...");
                    ZipFile.ExtractToDirectory(tempZipPath, extractTo, overwriteFiles: true);
                    System.Diagnostics.Debug.WriteLine($"[C#] Extraction complete!");

                    // Clean up temp file
                    File.Delete(tempZipPath);
                    System.Diagnostics.Debug.WriteLine($"[C#] Temp file deleted");

                    // Send success message
                    var response = new
                    {
                        type = "distribution-download-complete",
                        version = version,
                        folder = extractTo,
                        success = true,
                        requestId = requestId
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                    System.Diagnostics.Debug.WriteLine($"[C#] ✅ Distribution download complete!");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Distribution download failed: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Stack trace: {ex.StackTrace}");

                // Send error message
                var errorResponse = new
                {
                    type = "distribution-download-failed",
                    error = ex.Message,
                    requestId = requestId
                };

                string errorJson = JsonSerializer.Serialize(errorResponse);
                wv.CoreWebView2.PostWebMessageAsJson(errorJson);
            }
        }

        private async Task HandleLaunchWMSModule(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Launching WMS module...");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string indexPath = root.GetProperty("indexPath").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] Index path: {indexPath}");

                    // Verify file exists
                    if (!File.Exists(indexPath))
                    {
                        throw new FileNotFoundException($"WMS module not found at: {indexPath}");
                    }

                    // Convert Windows path to file:/// URL format
                    string fileUrl = "file:///" + indexPath.Replace("\\", "/");
                    System.Diagnostics.Debug.WriteLine($"[C#] Navigating to: {fileUrl}");

                    // Navigate the WebView2 control to the local HTML file
                    wv.CoreWebView2.Navigate(fileUrl);

                    // Send success message
                    var response = new
                    {
                        type = "launch-wms-module",
                        success = true,
                        indexPath = indexPath,
                        requestId = requestId
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                    System.Diagnostics.Debug.WriteLine($"[C#] ✅ WMS module launched successfully");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Launch WMS module failed: {ex.Message}");

                // Send error message
                var errorResponse = new
                {
                    type = "launch-wms-module",
                    success = false,
                    error = ex.Message,
                    requestId = requestId
                };

                string errorJson = JsonSerializer.Serialize(errorResponse);
                wv.CoreWebView2.PostWebMessageAsJson(errorJson);
            }
        }

        // Helper method: Copy directory recursively
        private void CopyDirectory(string sourceDir, string destDir)
        {
            // Create destination directory
            Directory.CreateDirectory(destDir);

            // Copy files
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string fileName = Path.GetFileName(file);
                string destFile = Path.Combine(destDir, fileName);
                File.Copy(file, destFile, true);
            }

            // Copy subdirectories
            foreach (string subDir in Directory.GetDirectories(sourceDir))
            {
                string dirName = Path.GetFileName(subDir);
                string destSubDir = Path.Combine(destDir, dirName);
                CopyDirectory(subDir, destSubDir);
            }
        }

        private async Task HandleDownloadOrderPdf(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<DownloadPdfMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Downloading PDF for order {message.OrderNumber}");

                var result = await _printJobManager.DownloadSingleOrderAsync(
                    message.OrderNumber,
                    message.TripId,
                    message.TripDate
                );

                var response = new
                {
                    action = "downloadPdfResponse",
                    requestId = requestId,
                    success = result.Success,
                    message = result.Message,
                    filePath = result.FilePath
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Download PDF failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        // 🔧 NEW: Check if PDF exists locally
        private async Task HandleCheckPdfExists(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<CheckPdfExistsMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Checking PDF existence for order {message.OrderNumber}");

                // Construct PDF path: C:\fusion\{tripDate}\{tripId}\{orderNumber}.pdf
                string pdfPath = Path.Combine(@"C:\fusion", message.TripDate, message.TripId.ToString(), $"{message.OrderNumber}.pdf");
                bool exists = File.Exists(pdfPath);

                System.Diagnostics.Debug.WriteLine($"[C#] PDF Path: {pdfPath}");
                System.Diagnostics.Debug.WriteLine($"[C#] PDF Exists: {exists}");

                var response = new
                {
                    action = "checkPdfExistsResponse",
                    requestId = requestId,
                    exists = exists,
                    filePath = exists ? pdfPath : null,
                    orderNumber = message.OrderNumber
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Check PDF exists failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        /// <summary>
        /// Gets the active printer configuration from APEX REST API
        /// Returns null if not found or on error (caller should fallback to local config)
        /// </summary>
        private async Task<PrinterConfig> GetActivePrinterConfigFromApexAsync()
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[Form1] Getting printer config from APEX REST...");

                string url = EndpointRegistry.GetEndpointUrl("WMS", "GETPRINTERCONFIG");
                if (string.IsNullOrEmpty(url))
                {
                    System.Diagnostics.Debug.WriteLine($"[Form1] ❌ Printer config endpoint not found in registry");
                    return null;
                }

                string jsonResponse = await _restApiClient.ExecuteGetAsync(url);

                // Parse JSON response to get active printer
                var jsonDoc = System.Text.Json.JsonDocument.Parse(jsonResponse);
                var items = jsonDoc.RootElement.GetProperty("items");

                foreach (var item in items.EnumerateArray())
                {
                    string isActive = item.GetProperty("isActive").GetString();
                    if (isActive == "Y")
                    {
                        var config = new PrinterConfig
                        {
                            PrinterName = item.GetProperty("printerName").GetString(),
                            PaperSize = item.GetProperty("paperSize").GetString(),
                            Orientation = item.GetProperty("orientation").GetString(),
                            FusionInstance = item.GetProperty("fusionInstance").GetString(),
                            FusionUsername = item.GetProperty("fusionUsername").GetString(),
                            FusionPassword = item.GetProperty("fusionPassword").GetString(),
                            AutoDownload = item.GetProperty("autoDownload").GetString() == "Y",
                            AutoPrint = item.GetProperty("autoPrint").GetString() == "Y"
                        };

                        System.Diagnostics.Debug.WriteLine($"[Form1] ✅ Got active printer config from APEX");
                        System.Diagnostics.Debug.WriteLine($"[Form1] Fusion Username: {config.FusionUsername}, Instance: {config.FusionInstance}");
                        return config;
                    }
                }

                System.Diagnostics.Debug.WriteLine($"[Form1] ❌ No active printer found in APEX");
                return null;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[Form1] ❌ Failed to get printer config from APEX: {ex.Message}");
                return null;
            }
        }

        // 🔧 NEW: Print Store Transaction Report (Generic Handler)
        private async Task HandlePrintStoreTransaction(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string orderNumber = root.GetProperty("orderNumber").GetString();
                    string instance = root.GetProperty("instance").GetString();
                    string reportPath = root.GetProperty("reportPath").GetString();
                    string parameterName = root.GetProperty("parameterName").GetString();
                    string tripId = root.GetProperty("tripId").GetString();
                    string tripDate = root.GetProperty("tripDate").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] Printing report: {reportPath}");
                    System.Diagnostics.Debug.WriteLine($"[C#] Parameter: {parameterName}={orderNumber}, Instance: {instance}");
                    System.Diagnostics.Debug.WriteLine($"[C#] TripId: {tripId}, TripDate: {tripDate}");

                    // ✅ FIX: Get credentials from APEX REST API instead of local config
                    var printerConfig = await GetActivePrinterConfigFromApexAsync();

                    if (printerConfig == null)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C#] ❌ Failed to get printer config from APEX, falling back to local config");
                        // Fallback to local config if APEX fails
                        printerConfig = _storageManager.LoadPrinterConfig();
                    }

                    if (printerConfig == null)
                    {
                        SendErrorResponse(wv, requestId, "Printer configuration not found in APEX or local storage");
                        return;
                    }

                    var username = printerConfig.FusionUsername;
                    var password = printerConfig.FusionPassword;

                    if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
                    {
                        SendErrorResponse(wv, requestId, "Fusion credentials not configured. Please check APEX printer configuration.");
                        return;
                    }

                    System.Diagnostics.Debug.WriteLine($"[C#] ✅ Using credentials from APEX - Username: {username}, Instance: {instance}");

                    // Download PDF using Generic method
                    var downloader = new WMSApp.PrintManagement.FusionPdfDownloader();
                    var result = await downloader.DownloadGenericReportPdfAsync(
                        reportPath,
                        parameterName,
                        orderNumber,
                        instance,
                        username,
                        password
                    );

                    if (!result.Success)
                    {
                        SendErrorResponse(wv, requestId, $"Failed to generate report: {result.ErrorMessage}");
                        return;
                    }

                    // Convert base64 to bytes and save to C:\fusion\{tripDate}\{tripId}\ folder
                    byte[] pdfBytes = Convert.FromBase64String(result.Base64Content);

                    // Create folder structure: C:\fusion\{tripDate}\{tripId}
                    string folderPath = Path.Combine(@"C:\fusion", tripDate, tripId);
                    Directory.CreateDirectory(folderPath);

                    // Simple filename: {orderNumber}.pdf
                    string fileName = $"{orderNumber}.pdf";
                    string filePath = Path.Combine(folderPath, fileName);

                    await File.WriteAllBytesAsync(filePath, pdfBytes);

                    System.Diagnostics.Debug.WriteLine($"[C#] Report PDF saved to: {filePath}");

                    // Send success response
                    var response = new
                    {
                        action = "printStoreTransactionResponse",
                        requestId = requestId,
                        success = true,
                        message = $"Report saved to: {filePath}",
                        filePath = filePath
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Print Store Transaction failed: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Stack trace: {ex.StackTrace}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        // 🔧 NEW: Generic SOAP Report Handler - Runs any Oracle BI Publisher report and returns Base64 data
        private async Task HandleRunSoapReport(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string reportPath = root.GetProperty("reportPath").GetString();
                    string parameterName = root.GetProperty("parameterName").GetString();
                    string parameterValue = root.GetProperty("parameterValue").GetString();
                    string instance = root.GetProperty("instance").GetString();
                    string username = root.GetProperty("username").GetString();
                    string password = root.GetProperty("password").GetString();

                    System.Diagnostics.Debug.WriteLine("====================================");
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] HandleRunSoapReport STARTED");
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] Report Path: {reportPath}");
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] Parameter: {parameterName} = {parameterValue}");
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] Instance: {instance}");
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] Username: {username}");
                    System.Diagnostics.Debug.WriteLine("====================================");

                    if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
                    {
                        System.Diagnostics.Debug.WriteLine($"[C# SOAP] ❌ ERROR: Credentials are missing");
                        SendErrorResponse(wv, requestId, "Fusion credentials not provided");
                        return;
                    }

                    // Download report and parse data (forPrint=false extracts data table)
                    var downloader = new WMSApp.PrintManagement.FusionPdfDownloader();
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] Calling DownloadGenericReportAsync (forPrint=false)...");

                    var result = await downloader.DownloadGenericReportAsync(
                        reportPath,
                        parameterName,
                        parameterValue,
                        instance,
                        username,
                        password,
                        forPrint: false  // Extract data, not PDF
                    );

                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] DownloadGenericReportAsync returned - Success: {result.Success}");

                    if (!result.Success)
                    {
                        System.Diagnostics.Debug.WriteLine($"[C# SOAP] ❌ ERROR: {result.ErrorMessage}");
                        SendErrorResponse(wv, requestId, $"Failed to run SOAP report: {result.ErrorMessage}");
                        return;
                    }

                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] ✅ SUCCESS - Data records count: {result.DataRecords?.Count ?? 0}");

                    // Return data records as JSON array (not Base64)
                    var response = new
                    {
                        action = "runSoapReportResponse",
                        requestId = requestId,
                        success = true,
                        dataRecords = result.DataRecords,  // Send parsed data directly
                        recordCount = result.DataRecords?.Count ?? 0,
                        message = "SOAP report data extracted successfully"
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] Sending {result.DataRecords?.Count ?? 0} records to JavaScript...");
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);
                    System.Diagnostics.Debug.WriteLine($"[C# SOAP] ✅ Response sent successfully");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# SOAP] ❌ EXCEPTION: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[C# SOAP] Stack trace: {ex.StackTrace}");
                SendErrorResponse(wv, requestId, $"SOAP report error: {ex.Message}");
            }
        }

        private async Task HandlePrintOrder(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<PrintPdfMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Printing order {message.OrderNumber}");

                var result = await _printJobManager.PrintSingleOrderAsync(
                    message.OrderNumber,
                    message.TripId,
                    message.TripDate
                );

                var response = new
                {
                    action = "printOrderResponse",
                    requestId = requestId,
                    success = result.Success,
                    message = result.Success ? "Print job sent" : result.ErrorMessage
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Print order failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        private async Task HandleGetPrintJobs(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine($"[C#] ⭐ HandleGetPrintJobs STARTED");
                System.Diagnostics.Debug.WriteLine($"[C#] RequestId: {requestId}");
                System.Diagnostics.Debug.WriteLine("====================================");

                var message = System.Text.Json.JsonSerializer.Deserialize<GetPrintJobsMessage>(
                    messageJson,
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Message Details:");
                System.Diagnostics.Debug.WriteLine($"[C#]   - TripId: {message.TripId ?? "NULL"}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - StartDate: {message.StartDate ?? "NULL"}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - EndDate: {message.EndDate ?? "NULL"}");

                List<PrintJob> jobs;

                if (!string.IsNullOrEmpty(message.TripId))
                {
                    System.Diagnostics.Debug.WriteLine($"[C#] Getting jobs for specific trip: {message.TripId}");
                    jobs = _storageManager.GetTripPrintJobs(message.StartDate, message.TripId);
                }
                else
                {
                    System.Diagnostics.Debug.WriteLine($"[C#] Getting ALL print jobs");
                    DateTime? startDate = string.IsNullOrEmpty(message.StartDate) ? null : DateTime.Parse(message.StartDate);
                    DateTime? endDate = string.IsNullOrEmpty(message.EndDate) ? null : DateTime.Parse(message.EndDate);
                    jobs = _storageManager.GetAllPrintJobs(startDate, endDate);
                }

                System.Diagnostics.Debug.WriteLine($"[C#] Retrieved {jobs.Count} print jobs");

                if (jobs.Count > 0)
                {
                    System.Diagnostics.Debug.WriteLine($"[C#] Sample jobs:");
                    foreach (var job in jobs.Take(3))
                    {
                        System.Diagnostics.Debug.WriteLine($"[C#]   - Order: {job.OrderNumber}, Trip: {job.TripId}, Date: {job.TripDate}, Status: {job.DownloadStatus}");
                    }
                }

                var stats = _storageManager.GetPrintJobStats();

                System.Diagnostics.Debug.WriteLine($"[C#] Print Job Stats:");
                System.Diagnostics.Debug.WriteLine($"[C#]   - Total: {stats.TotalJobs}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - Pending Download: {stats.PendingDownload}");
                System.Diagnostics.Debug.WriteLine($"[C#]   - Completed: {stats.DownloadCompleted}");

                var response = new
                {
                    action = "printJobsResponse",
                    requestId = requestId,
                    success = true,
                    data = new
                    {
                        jobs = jobs,
                        stats = stats
                    }
                };

                string responseJson = System.Text.Json.JsonSerializer.Serialize(response);
                System.Diagnostics.Debug.WriteLine($"[C#] Sending response with {jobs.Count} jobs to JavaScript");

                wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                System.Diagnostics.Debug.WriteLine($"[C#] ✅ HandleGetPrintJobs COMPLETED");
                System.Diagnostics.Debug.WriteLine("====================================");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] ❌ HandleGetPrintJobs FAILED");
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Exception: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Stack Trace: {ex.StackTrace}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }
        private async Task HandleRetryFailedJobs(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<GetPrintJobsMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Retrying failed jobs for trip {message.TripId}");

                var result = await _printJobManager.RetryFailedJobsAsync(message.TripId, message.StartDate);

                var response = new
                {
                    action = "retryJobsResponse",
                    requestId = requestId,
                    success = result.Success,
                    message = result.Message,
                    retriedCount = result.RetriedCount
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Retry failed jobs error: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        private async Task HandleConfigurePrinter(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                var message = JsonSerializer.Deserialize<ConfigurePrinterMessage>(
                    messageJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );

                System.Diagnostics.Debug.WriteLine($"[C#] Configuring printer: {message.Config.PrinterName}");

                bool success = _storageManager.SavePrinterConfig(message.Config);

                var response = new
                {
                    action = "configurePrinterResponse",
                    requestId = requestId,
                    success = success,
                    message = success ? "Printer configuration saved" : "Failed to save configuration"
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Configure printer failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        private async Task HandleSetInstanceSetting(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Setting instance setting");

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string instance = root.GetProperty("instance").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] Instance setting: {instance}");

                    bool success = _storageManager.SaveInstanceSetting(instance);

                    var response = new
                    {
                        action = "setInstanceSettingResponse",
                        requestId = requestId,
                        success = success,
                        message = success ? $"Instance setting saved: {instance}" : "Failed to save instance setting"
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Set instance setting failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }

            await Task.CompletedTask;
        }

        private async Task HandleGetPrinterConfig(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Getting printer configuration");

                var config = _storageManager.LoadPrinterConfig();

                var response = new
                {
                    action = "printerConfigResponse",
                    requestId = requestId,
                    success = true,
                    data = config
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Get printer config failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        private async Task HandleGetInstalledPrinters(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Getting installed printers");

                var printers = _printerService.GetInstalledPrinters();
                var defaultPrinter = _printerService.GetDefaultPrinter();

                var response = new
                {
                    action = "installedPrintersResponse",
                    requestId = requestId,
                    success = true,
                    data = new
                    {
                        printers = printers,
                        defaultPrinter = defaultPrinter
                    }
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                System.Diagnostics.Debug.WriteLine($"[C#] Found {printers.Count} printers");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Get printers failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        private async Task HandleTestPrinter(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    string printerName = root.GetProperty("printerName").GetString();

                    System.Diagnostics.Debug.WriteLine($"[C#] Testing printer: {printerName}");

                    var result = await _printerService.TestPrinterAsync(printerName);

                    var response = new
                    {
                        action = "testPrinterResponse",
                        requestId = requestId,
                        success = result.Success,
                        message = result.Message,
                        data = result
                    };

                    string responseJson = JsonSerializer.Serialize(response);
                    wv.CoreWebView2.PostWebMessageAsJson(responseJson);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Test printer failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }

        private async Task HandleDiscoverBluetoothPrinters(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Discovering Bluetooth printers...");

                // Get Bluetooth printers using PrinterSettings
                var bluetoothPrinters = new List<string>();

                // Note: Windows doesn't provide a direct API to filter only Bluetooth printers
                // We'll get all printers and try to identify Bluetooth ones by name patterns
                foreach (string printerName in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
                {
                    // Common Bluetooth printer patterns in names
                    if (printerName.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase) ||
                        printerName.Contains("BT", StringComparison.OrdinalIgnoreCase) ||
                        printerName.Contains("Wireless", StringComparison.OrdinalIgnoreCase))
                    {
                        bluetoothPrinters.Add(printerName);
                    }
                }

                var response = new
                {
                    action = "discoverBluetoothPrintersResponse",
                    requestId = requestId,
                    success = true,
                    printers = bluetoothPrinters,
                    count = bluetoothPrinters.Count
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                System.Diagnostics.Debug.WriteLine($"[C#] Found {bluetoothPrinters.Count} Bluetooth printer(s)");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] Bluetooth printer discovery failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }

            await Task.CompletedTask;
        }

        private async Task HandleDiscoverWifiPrinters(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[C#] Discovering WiFi/Network printers...");

                // Get network printers
                var networkPrinters = new List<string>();

                foreach (string printerName in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
                {
                    // Network printers typically have UNC paths (\\server\printer) or contain "Network"
                    if (printerName.StartsWith("\\\\") ||
                        printerName.Contains("Network", StringComparison.OrdinalIgnoreCase) ||
                        printerName.Contains("IP", StringComparison.OrdinalIgnoreCase) ||
                        printerName.Contains("WiFi", StringComparison.OrdinalIgnoreCase))
                    {
                        networkPrinters.Add(printerName);
                    }
                }

                var response = new
                {
                    action = "discoverWifiPrintersResponse",
                    requestId = requestId,
                    success = true,
                    printers = networkPrinters,
                    count = networkPrinters.Count
                };

                string responseJson = JsonSerializer.Serialize(response);
                wv.CoreWebView2.PostWebMessageAsJson(responseJson);

                System.Diagnostics.Debug.WriteLine($"[C#] Found {networkPrinters.Count} WiFi/Network printer(s)");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[C# ERROR] WiFi printer discovery failed: {ex.Message}");
                SendErrorResponse(wv, requestId, ex.Message);
            }

            await Task.CompletedTask;
        }

        private void SendErrorResponse(WebView2 wv, string requestId, string errorMessage)
        {
            var errorResponse = new
            {
                action = "error",
                requestId = requestId,
                success = false,
                message = errorMessage
            };

            string errorJson = JsonSerializer.Serialize(errorResponse);
            wv.CoreWebView2.PostWebMessageAsJson(errorJson);
        }

        // ========== NAVIGATION METHODS ==========

        private WebView2 GetCurrentWebView()
        {
            foreach (Control ctrl in tabBar.Controls)
            {
                if (ctrl is CustomTabButton tab && tab.IsSelected)
                    return tab.WebView;
            }
            return null;
        }

        private CustomTabButton GetCurrentTab()
        {
            foreach (Control ctrl in tabBar.Controls)
            {
                if (ctrl is CustomTabButton tab && tab.IsSelected)
                    return tab;
            }
            return null;
        }

        private void BackButton_Click(object sender, EventArgs e)
        {
            var wv = GetCurrentWebView();
            if (wv?.CoreWebView2 != null && wv.CoreWebView2.CanGoBack)
            {
                wv.CoreWebView2.GoBack();
            }
        }

        private void ForwardButton_Click(object sender, EventArgs e)
        {
            var wv = GetCurrentWebView();
            if (wv?.CoreWebView2 != null && wv.CoreWebView2.CanGoForward)
            {
                wv.CoreWebView2.GoForward();
            }
        }

        private void RefreshButton_Click(object sender, EventArgs e)
        {
            var wv = GetCurrentWebView();
            wv?.CoreWebView2?.Reload();
        }

        private async void ClearCacheButton_Click(object sender, EventArgs e)
        {
            try
            {
                var wv = GetCurrentWebView();
                if (wv?.CoreWebView2 != null)
                {
                    var result = MessageBox.Show(
                        "Clear browser cache and reload?\n\nThis will refresh all pages and clear cached files.",
                        "Clear Cache",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question);

                    if (result == DialogResult.Yes)
                    {
                        // Clear all browsing data
                        await wv.CoreWebView2.Profile.ClearBrowsingDataAsync(
                            CoreWebView2BrowsingDataKinds.AllDomStorage |
                            CoreWebView2BrowsingDataKinds.CacheStorage |
                            CoreWebView2BrowsingDataKinds.DiskCache |
                            CoreWebView2BrowsingDataKinds.IndexedDb |
                            CoreWebView2BrowsingDataKinds.LocalStorage |
                            CoreWebView2BrowsingDataKinds.WebSql
                        );

                        // Reload the page
                        wv.Reload();

                        MessageBox.Show(
                            "✓ Cache cleared successfully!\n\nPage is reloading...",
                            "Success",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Error clearing cache:\n\n{ex.Message}",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private void HomeButton_Click(object sender, EventArgs e)
        {
            Navigate("https://www.google.com");
        }

        private void OpenFileButton_Click(object sender, EventArgs e)
        {
            using (OpenFileDialog openFileDialog = new OpenFileDialog())
            {
                openFileDialog.Filter = "HTML Files (*.html;*.htm)|*.html;*.htm|All Files (*.*)|*.*";
                openFileDialog.Title = "Open HTML File";

                if (openFileDialog.ShowDialog() == DialogResult.OK)
                {
                    string filePath = openFileDialog.FileName;
                    Navigate("file:///" + filePath.Replace("\\", "/"));
                }
            }
        }

        private void FavoriteButton_Click(object sender, EventArgs e)
        {
            if (favoriteButton.Text == "☆")
            {
                favoriteButton.Text = "★";
                favoriteButton.ForeColor = Color.FromArgb(255, 200, 0);
                MessageBox.Show("Added to favorites!", "Favorites", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                favoriteButton.Text = "☆";
                favoriteButton.ForeColor = Color.Gray;
                MessageBox.Show("Removed from favorites!", "Favorites", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private void ProfileButton_Click(object sender, EventArgs e)
        {
            MessageBox.Show("Profile settings", "Profile", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void CopilotButton_Click(object sender, EventArgs e)
        {
            MessageBox.Show("Ask Copilot feature coming soon!", "Copilot", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void UrlTextBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter)
            {
                Navigate(urlTextBox.Text);
                e.Handled = true;
                e.SuppressKeyPress = true;
            }
            else if (e.Control && e.KeyCode == Keys.T)
            {
                AddNewTab("https://www.google.com");
                e.Handled = true;
            }
            else if (e.Control && e.KeyCode == Keys.W)
            {
                var currentTab = GetCurrentTab();
                if (currentTab != null)
                    TabButton_CloseClicked(currentTab, EventArgs.Empty);
                e.Handled = true;
            }
            else if (e.Control && e.KeyCode == Keys.O)
            {
                OpenFileButton_Click(sender, e);
                e.Handled = true;
            }
        }

        private async void Navigate(string url)
        {
            var wv = GetCurrentWebView();
            if (wv?.CoreWebView2 != null)
            {
                if (url.StartsWith("file:///") || url.StartsWith("file://"))
                {
                    try
                    {
                        // AGGRESSIVE CACHE CLEARING - Clear ALL cache before loading local files
                        System.Diagnostics.Debug.WriteLine("[CACHE] Clearing ALL cache before loading local file...");
                        await wv.CoreWebView2.Profile.ClearBrowsingDataAsync(
                            CoreWebView2BrowsingDataKinds.AllDomStorage |
                            CoreWebView2BrowsingDataKinds.CacheStorage |
                            CoreWebView2BrowsingDataKinds.DiskCache);
                        System.Diagnostics.Debug.WriteLine("[CACHE] ✅ Cache cleared successfully!");

                        wv.Source = new Uri(url);
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show($"Error loading file: {ex.Message}", "Error",
                            MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                    return;
                }

                if (!url.StartsWith("http://") && !url.StartsWith("https://"))
                {
                    url = "https://" + url;
                }

                try
                {
                    wv.Source = new Uri(url);
                }
                catch
                {
                    wv.Source = new Uri("https://www.google.com/search?q=" + Uri.EscapeDataString(url));
                }
            }
        }

        private void CoreWebView2_NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            urlTextBox.Text = e.Uri;
            UpdateSecurityIcon(GetCurrentWebView());
        }

        private async void CoreWebView2_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            var wv = sender as CoreWebView2;
            if (wv != null)
            {
                urlTextBox.Text = wv.Source;

                var currentTab = GetCurrentTab();
                if (currentTab != null)
                {
                    string title = wv.DocumentTitle;
                    if (string.IsNullOrEmpty(title))
                        title = "New Tab";
                    else if (title.Length > 20)
                        title = title.Substring(0, 20) + "...";

                    currentTab.TabText = title;
                }

                UpdateNavigationButtons(GetCurrentWebView());
                UpdateSecurityIcon(GetCurrentWebView());

                // Send user session to WMS pages after navigation completes
                string source = wv.Source.ToLower();
                if (_isLoggedIn && (source.Contains("/wms/index.html") || source.Contains("\\wms\\index.html")))
                {
                    // Add a small delay to ensure JavaScript is fully loaded
                    await System.Threading.Tasks.Task.Delay(500);
                    SendUserSessionToWebView(wv);
                }
            }
        }

        private async void SendUserSessionToWebView(CoreWebView2 wv)
        {
            try
            {
                // Escape strings for JavaScript
                string username = _loggedInUsername?.Replace("'", "\\'") ?? "";
                string instance = _loggedInInstance?.Replace("'", "\\'") ?? "";
                string loginDateTime = ("Logged in: " + _loggedInDateTime)?.Replace("'", "\\'") ?? "";

                // Call the JavaScript function directly
                string script = $"if (typeof setLoggedInUser === 'function') {{ setLoggedInUser('{username}', '{instance}', '{loginDateTime}'); }}";
                await wv.ExecuteScriptAsync(script);

                System.Diagnostics.Debug.WriteLine($"[LOGIN] Sent user session to WebView: {username} ({instance}) - {loginDateTime}");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LOGIN] Error sending user session: {ex.Message}");
            }
        }

        private void UpdateNavigationButtons(WebView2 wv)
        {
            if (wv?.CoreWebView2 != null)
            {
                backButton.Enabled = wv.CoreWebView2.CanGoBack;
                forwardButton.Enabled = wv.CoreWebView2.CanGoForward;
            }
        }

        private void UpdateSecurityIcon(WebView2 wv)
        {
            if (wv?.CoreWebView2 != null)
            {
                string url = wv.Source?.ToString() ?? "";
                if (url.StartsWith("https://"))
                {
                    securityIcon.Text = "🔒";
                    securityIcon.ForeColor = Color.Green;
                }
                else if (url.StartsWith("http://"))
                {
                    securityIcon.Text = "⚠️";
                    securityIcon.ForeColor = Color.Orange;
                }
                else if (url.StartsWith("file://"))
                {
                    securityIcon.Text = "📄";
                    securityIcon.ForeColor = Color.Blue;
                }
                else
                {
                    securityIcon.Text = "ℹ️";
                    securityIcon.ForeColor = Color.Gray;
                }
            }
        }

        private void CoreWebView2_NewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            AddNewTab(e.Uri);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == (Keys.Control | Keys.T))
            {
                AddNewTab("https://www.google.com");
                return true;
            }
            else if (keyData == (Keys.Control | Keys.W))
            {
                var currentTab = GetCurrentTab();
                if (currentTab != null)
                    TabButton_CloseClicked(currentTab, EventArgs.Empty);
                return true;
            }
            else if (keyData == (Keys.Control | Keys.O))
            {
                OpenFileButton_Click(null, EventArgs.Empty);
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }
    }

    // ========== CUSTOM TAB BUTTON ==========
    public class CustomTabButton : Control
    {
        private string tabText = "New Tab";
        private bool isSelected = false;
        private bool closeHover = false;
        private Rectangle closeRect;
        public WebView2 WebView { get; set; }
        public event EventHandler CloseClicked;

        public string TabText
        {
            get => tabText;
            set
            {
                tabText = value;
                Invalidate();
            }
        }

        public bool IsSelected
        {
            get => isSelected;
            set
            {
                isSelected = value;
                Invalidate();
            }
        }

        public CustomTabButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer, true);
            Cursor = Cursors.Hand;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);

            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            using (SolidBrush brush = new SolidBrush(BackColor))
            {
                e.Graphics.FillRectangle(brush, ClientRectangle);
            }

            Rectangle iconRect = new Rectangle(8, 6, 16, 16);
            using (Pen pen = new Pen(Color.LightGray, 1.5f))
            {
                e.Graphics.DrawEllipse(pen, iconRect);
            }

            Rectangle textRect = new Rectangle(30, 0, Width - 60, Height);
            using (SolidBrush textBrush = new SolidBrush(ForeColor))
            {
                StringFormat sf = new StringFormat
                {
                    Alignment = StringAlignment.Near,
                    LineAlignment = StringAlignment.Center,
                    Trimming = StringTrimming.EllipsisCharacter
                };
                e.Graphics.DrawString(tabText, new Font("Segoe UI", 8), textBrush, textRect, sf);
            }

            closeRect = new Rectangle(Width - 22, 6, 16, 16);
            Color closeColor = closeHover ? Color.Red : Color.LightGray;
            using (Pen closePen = new Pen(closeColor, 2))
            {
                e.Graphics.DrawLine(closePen, closeRect.Left + 3, closeRect.Top + 3,
                                   closeRect.Right - 3, closeRect.Bottom - 3);
                e.Graphics.DrawLine(closePen, closeRect.Right - 3, closeRect.Top + 3,
                                   closeRect.Left + 3, closeRect.Bottom - 3);
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            bool wasHover = closeHover;
            closeHover = closeRect.Contains(e.Location);
            if (wasHover != closeHover)
                Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            closeHover = false;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (closeRect.Contains(e.Location))
            {
                CloseClicked?.Invoke(this, EventArgs.Empty);
            }
        }
    }

    // ========== MESSAGE CLASSES ==========
    // ========== MESSAGE CLASSES ==========
    public class RestApiWebMessage
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("requestId")]
        public string RequestId { get; set; }

        [JsonPropertyName("fullUrl")]
        public string FullUrl { get; set; }

        [JsonPropertyName("username")]
        public string Username { get; set; }

        [JsonPropertyName("password")]
        public string Password { get; set; }
    }

    public class RestApiPostWebMessage
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("requestId")]
        public string RequestId { get; set; }

        [JsonPropertyName("fullUrl")]
        public string FullUrl { get; set; }

        [JsonPropertyName("body")]
        public string Body { get; set; }

        [JsonPropertyName("method")]
        public string Method { get; set; }
    }

}