using System;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace commet_like
{
    public class PromptHistoryViewer : Form
    {
        public PromptHistoryManager _historyManager;
        private ListBox _promptListBox;
        private TextBox _searchBox;
        private RichTextBox _promptTextBox;
        private RichTextBox _responseTextBox;
        private Button _deleteButton;
        private Button _exportButton;
        private Button _clearAllButton;
        private Label _statsLabel;

        public PromptHistoryViewer(PromptHistoryManager historyManager)
        {
            _historyManager = historyManager;
            InitializeUI();
            LoadPrompts();
        }

        private void InitializeUI()
        {
            this.Text = "📚 Prompt History Viewer";
            this.Size = new Size(1000, 700);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(240, 240, 240);
            this.MinimumSize = new Size(800, 600);

            // Main container
            Panel mainPanel = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(10)
            };

            // Top panel with search and stats
            Panel topPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 80,
                BackColor = Color.White,
                Padding = new Padding(10)
            };

            Label titleLabel = new Label
            {
                Text = "📚 Saved Prompts & Responses",
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                Location = new Point(10, 10),
                AutoSize = true,
                ForeColor = Color.FromArgb(30, 120, 255)
            };

            _statsLabel = new Label
            {
                Text = "Loading...",
                Font = new Font("Segoe UI", 9),
                Location = new Point(10, 40),
                AutoSize = true,
                ForeColor = Color.Gray
            };

            Label searchLabel = new Label
            {
                Text = "🔍 Search:",
                Font = new Font("Segoe UI", 9),
                Location = new Point(400, 15),
                AutoSize = true
            };

            _searchBox = new TextBox
            {
                Location = new Point(470, 12),
                Width = 300,
                Font = new Font("Segoe UI", 10),
                BorderStyle = BorderStyle.FixedSingle
            };
            _searchBox.TextChanged += SearchBox_TextChanged;

            topPanel.Controls.AddRange(new Control[] { titleLabel, _statsLabel, searchLabel, _searchBox });

            // Left panel - List of prompts
            Panel leftPanel = new Panel
            {
                Dock = DockStyle.Left,
                Width = 350,
                Padding = new Padding(10)
            };

            Label listLabel = new Label
            {
                Text = "Prompt History",
                Dock = DockStyle.Top,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                Height = 30,
                TextAlign = ContentAlignment.MiddleLeft
            };

            _promptListBox = new ListBox
            {
                Dock = DockStyle.Fill,
                Font = new Font("Segoe UI", 9),
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.White
            };
            _promptListBox.SelectedIndexChanged += PromptListBox_SelectedIndexChanged;

            // Button panel for left side
            Panel leftButtonPanel = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 45,
                Padding = new Padding(0, 5, 0, 0)
            };

            _deleteButton = new Button
            {
                Text = "🗑️ Delete",
                Width = 100,
                Height = 35,
                Left = 0,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(255, 100, 100),
                ForeColor = Color.White,
                Enabled = false,
                Cursor = Cursors.Hand
            };
            _deleteButton.FlatAppearance.BorderColor = Color.FromArgb(200, 80, 80);
            _deleteButton.Click += DeleteButton_Click;

            _clearAllButton = new Button
            {
                Text = "🗑️ Clear All",
                Width = 100,
                Height = 35,
                Left = 110,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(200, 50, 50),
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            _clearAllButton.FlatAppearance.BorderColor = Color.FromArgb(150, 30, 30);
            _clearAllButton.Click += ClearAllButton_Click;

            _exportButton = new Button
            {
                Text = "💾 Export",
                Width = 100,
                Height = 35,
                Left = 220,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(100, 150, 255),
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            _exportButton.FlatAppearance.BorderColor = Color.FromArgb(80, 120, 200);
            _exportButton.Click += ExportButton_Click;

            leftButtonPanel.Controls.AddRange(new Control[] { _deleteButton, _clearAllButton, _exportButton });

            leftPanel.Controls.Add(_promptListBox);
            leftPanel.Controls.Add(listLabel);
            leftPanel.Controls.Add(leftButtonPanel);

            // Right panel - Display prompt and response
            Panel rightPanel = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(10)
            };

            // Prompt section
            Label promptLabel = new Label
            {
                Text = "📝 Prompt:",
                Dock = DockStyle.Top,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                Height = 30,
                TextAlign = ContentAlignment.MiddleLeft
            };

            _promptTextBox = new RichTextBox
            {
                Dock = DockStyle.Top,
                Height = 150,
                Font = new Font("Segoe UI", 10),
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.FromArgb(250, 250, 255),
                ReadOnly = true
            };

            // Response section
            Label responseLabel = new Label
            {
                Text = "💬 Response:",
                Dock = DockStyle.Top,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                Height = 30,
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(0, 10, 0, 0)
            };

            _responseTextBox = new RichTextBox
            {
                Dock = DockStyle.Fill,
                Font = new Font("Segoe UI", 10),
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.White,
                ReadOnly = true
            };

            rightPanel.Controls.Add(_responseTextBox);
            rightPanel.Controls.Add(responseLabel);
            rightPanel.Controls.Add(_promptTextBox);
            rightPanel.Controls.Add(promptLabel);

            // Add all to main panel
            mainPanel.Controls.Add(rightPanel);
            mainPanel.Controls.Add(leftPanel);
            mainPanel.Controls.Add(topPanel);

            this.Controls.Add(mainPanel);
        }

        private void LoadPrompts(string searchTerm = "")
        {
            _promptListBox.Items.Clear();

            var prompts = string.IsNullOrWhiteSpace(searchTerm)
                ? _historyManager.LoadAllPrompts()
                : _historyManager.SearchPrompts(searchTerm);

            prompts = prompts.OrderByDescending(p => p.Timestamp).ToList();

            foreach (var prompt in prompts)
            {
                _promptListBox.Items.Add(prompt);
            }

            _statsLabel.Text = $"Total: {prompts.Count} prompt(s) | Folder: C:\\Fusion\\AutoPilot";

            if (_promptListBox.Items.Count == 0)
            {
                _promptTextBox.Text = "No prompts found.";
                _responseTextBox.Text = "";
            }
        }

        private void SearchBox_TextChanged(object sender, EventArgs e)
        {
            LoadPrompts(_searchBox.Text);
        }

        public void PromptListBox_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (_promptListBox.SelectedItem is PromptHistoryItem item)
            {
                _promptTextBox.Text = $"[{item.Timestamp:yyyy-MM-dd HH:mm:ss}] - {item.PromptType}\n\n{item.Prompt}";
                _responseTextBox.Text = item.Response;
                _deleteButton.Enabled = true;
            }
            else
            {
                _promptTextBox.Text = "";
                _responseTextBox.Text = "";
                _deleteButton.Enabled = false;
            }
        }

        public void DeleteButton_Click(object sender, EventArgs e)
        {
            if (_promptListBox.SelectedItem is PromptHistoryItem item)
            {
                var result = MessageBox.Show(
                    $"Delete this prompt?",
                    "Confirm Delete",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                //                     $"Delete this prompt?\n\n{item.GetTruncatedPrompt(100)}",

                if (result == DialogResult.Yes)
                {
                    if (_historyManager.DeletePrompt(item.Id))
                    {
                        MessageBox.Show("Prompt deleted successfully!", "Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        LoadPrompts(_searchBox.Text);
                    }
                    else
                    {
                        MessageBox.Show("Failed to delete prompt.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
            }
        }

        private void ClearAllButton_Click(object sender, EventArgs e)
        {
            var result = MessageBox.Show(
                "⚠️ This will delete ALL saved prompts!\n\nAre you sure?",
                "Confirm Clear All",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            );

            if (result == DialogResult.Yes)
            {
                if (_historyManager.ClearAllHistory())
                {
                    MessageBox.Show("All prompts cleared!", "Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    LoadPrompts();
                }
                else
                {
                    MessageBox.Show("Failed to clear history.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        private void ExportButton_Click(object sender, EventArgs e)
        {
            using (SaveFileDialog saveDialog = new SaveFileDialog())
            {
                saveDialog.Filter = "Text Files (*.txt)|*.txt|All Files (*.*)|*.*";
                saveDialog.Title = "Export Prompt History";
                saveDialog.FileName = $"prompt_history_{DateTime.Now:yyyyMMdd_HHmmss}.txt";

                if (saveDialog.ShowDialog() == DialogResult.OK)
                {
                    if (_historyManager.ExportToText(saveDialog.FileName))
                    {
                        MessageBox.Show(
                            $"History exported successfully!\n\n{saveDialog.FileName}",
                            "Export Complete",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information
                        );
                    }
                    else
                    {
                        MessageBox.Show("Failed to export history.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
            }
        }
    }
}