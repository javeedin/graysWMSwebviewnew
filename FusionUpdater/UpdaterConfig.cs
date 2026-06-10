using Newtonsoft.Json;
using System;
using System.IO;

namespace FusionUpdater
{
    public class UpdaterConfig
    {
        public string GitHubToken { get; set; } = "";
        public string GitHubOwner { get; set; } = "javeedin";
        public string GitHubRepo { get; set; } = "graysWMSwebviewnew";
        public string InstallDirectory { get; set; } = @"C:\fusion";
        public string AppExecutable { get; set; } = "FusionClient.exe";
        public int CheckIntervalHours { get; set; } = 4;

        private static readonly string ConfigPath = Path.Combine(
            Path.GetDirectoryName(System.Diagnostics.Process.GetCurrentProcess().MainModule!.FileName)!,
            "updater-config.json");

        public static UpdaterConfig Load()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    var json = File.ReadAllText(ConfigPath);
                    return JsonConvert.DeserializeObject<UpdaterConfig>(json) ?? new UpdaterConfig();
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[Config] Load failed: {ex.Message}");
            }

            var defaults = new UpdaterConfig();
            defaults.Save();
            return defaults;
        }

        public void Save()
        {
            try
            {
                var dir = Path.GetDirectoryName(ConfigPath)!;
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(ConfigPath, JsonConvert.SerializeObject(this, Formatting.Indented));
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[Config] Save failed: {ex.Message}");
            }
        }
    }
}
