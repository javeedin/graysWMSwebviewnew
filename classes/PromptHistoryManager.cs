using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WMSApp
{
    /// <summary>
    /// Manages saving and loading of prompt history
    /// </summary>
    public class PromptHistoryManager
    {
        private const string BASE_FOLDER = @"C:\Fusion\AutoPilot";
        private const string HISTORY_FILE = "prompt_history.json";

        private string HistoryFilePath => Path.Combine(BASE_FOLDER, HISTORY_FILE);

        public PromptHistoryManager()
        {
            EnsureFolderExists();
        }

        private void EnsureFolderExists()
        {
            if (!Directory.Exists(BASE_FOLDER))
            {
                Directory.CreateDirectory(BASE_FOLDER);
                System.Diagnostics.Debug.WriteLine($"[PromptHistory] Created folder: {BASE_FOLDER}");
            }
        }

        /// <summary>
        /// Saves a prompt and its response
        /// </summary>
        public bool SavePrompt(string prompt, string response, string promptType = "General")
        {
            try
            {
                var historyItem = new PromptHistoryItem
                {
                    Id = Guid.NewGuid().ToString(),
                    Timestamp = DateTime.Now,
                    Prompt = prompt,
                    Response = response,
                    PromptType = promptType
                };

                var history = LoadAllPrompts();
                history.Add(historyItem);

                // Save to JSON file
                var options = new JsonSerializerOptions
                {
                    WriteIndented = true,
                    Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                };

                string json = JsonSerializer.Serialize(history, options);
                File.WriteAllText(HistoryFilePath, json);

                System.Diagnostics.Debug.WriteLine($"[PromptHistory] Saved prompt: {historyItem.Id}");
                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PromptHistory ERROR] Failed to save: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Loads all saved prompts
        /// </summary>
        public List<PromptHistoryItem> LoadAllPrompts()
        {
            try
            {
                if (!File.Exists(HistoryFilePath))
                {
                    return new List<PromptHistoryItem>();
                }

                string json = File.ReadAllText(HistoryFilePath);
                var history = JsonSerializer.Deserialize<List<PromptHistoryItem>>(json);

                return history ?? new List<PromptHistoryItem>();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PromptHistory ERROR] Failed to load: {ex.Message}");
                return new List<PromptHistoryItem>();
            }
        }

        /// <summary>
        /// Gets a specific prompt by ID
        /// </summary>
        public PromptHistoryItem GetPromptById(string id)
        {
            var history = LoadAllPrompts();
            return history.FirstOrDefault(h => h.Id == id);
        }

        /// <summary>
        /// Deletes a prompt by ID
        /// </summary>
        public bool DeletePrompt(string id)
        {
            try
            {
                var history = LoadAllPrompts();
                var itemToRemove = history.FirstOrDefault(h => h.Id == id);

                if (itemToRemove != null)
                {
                    history.Remove(itemToRemove);

                    var options = new JsonSerializerOptions
                    {
                        WriteIndented = true,
                        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                    };

                    string json = JsonSerializer.Serialize(history, options);
                    File.WriteAllText(HistoryFilePath, json);

                    return true;
                }

                return false;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PromptHistory ERROR] Failed to delete: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Searches prompts by keyword
        /// </summary>
        public List<PromptHistoryItem> SearchPrompts(string keyword)
        {
            var history = LoadAllPrompts();

            if (string.IsNullOrWhiteSpace(keyword))
                return history;

            keyword = keyword.ToLower();

            return history.Where(h =>
                h.Prompt.ToLower().Contains(keyword) ||
                h.Response.ToLower().Contains(keyword) ||
                h.PromptType.ToLower().Contains(keyword)
            ).ToList();
        }

        /// <summary>
        /// Gets prompts within a date range
        /// </summary>
        public List<PromptHistoryItem> GetPromptsByDateRange(DateTime startDate, DateTime endDate)
        {
            var history = LoadAllPrompts();
            return history.Where(h => h.Timestamp >= startDate && h.Timestamp <= endDate).ToList();
        }

        /// <summary>
        /// Clears all history
        /// </summary>
        public bool ClearAllHistory()
        {
            try
            {
                if (File.Exists(HistoryFilePath))
                {
                    File.Delete(HistoryFilePath);
                }
                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PromptHistory ERROR] Failed to clear: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Exports history to a text file
        /// </summary>
        public bool ExportToText(string filePath)
        {
            try
            {
                var history = LoadAllPrompts();
                using (var writer = new StreamWriter(filePath))
                {
                    writer.WriteLine("=".PadRight(80, '='));
                    writer.WriteLine("FUSION AUTOPILOT - PROMPT HISTORY EXPORT");
                    writer.WriteLine($"Exported: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
                    writer.WriteLine($"Total Prompts: {history.Count}");
                    writer.WriteLine("=".PadRight(80, '='));
                    writer.WriteLine();

                    foreach (var item in history.OrderByDescending(h => h.Timestamp))
                    {
                        writer.WriteLine($"[{item.Timestamp:yyyy-MM-dd HH:mm:ss}] - {item.PromptType}");
                        writer.WriteLine($"ID: {item.Id}");
                        writer.WriteLine();
                        writer.WriteLine("PROMPT:");
                        writer.WriteLine(item.Prompt);
                        writer.WriteLine();
                        writer.WriteLine("RESPONSE:");
                        writer.WriteLine(item.Response);
                        writer.WriteLine();
                        writer.WriteLine("-".PadRight(80, '-'));
                        writer.WriteLine();
                    }
                }
                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PromptHistory ERROR] Failed to export: {ex.Message}");
                return false;
            }
        }
    }

    /// <summary>
    /// Represents a single prompt/response history item
    /// </summary>
    public class PromptHistoryItem
    {
        [JsonPropertyName("id")]
        public string Id { get; set; }

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("prompt")]
        public string Prompt { get; set; }

        [JsonPropertyName("response")]
        public string Response { get; set; }

        [JsonPropertyName("promptType")]
        public string PromptType { get; set; }

        [JsonIgnore]
        public string DisplayText => $"{Timestamp:yyyy-MM-dd HH:mm} - {GetTruncatedPrompt(50)}";

        private string GetTruncatedPrompt(int maxLength)
        {
            if (string.IsNullOrEmpty(Prompt))
                return "[Empty]";

            if (Prompt.Length <= maxLength)
                return Prompt;

            return Prompt.Substring(0, maxLength) + "...";
        }
    }
}