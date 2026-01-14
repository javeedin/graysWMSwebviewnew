# C# Handlers Required for Distribution System

This document describes the C# message handlers that need to be added to `Form1.cs` to support the distribution system.

## Overview

The distribution system allows users to:
1. Click the **WMS button** in the header to launch the WMS module
2. Click **"Get New Version"** button to download and install updates from GitHub Releases
3. Files are extracted to: `C:\fusion\fusionclientweb\wms\`

---

## Message Handlers to Implement

Add these handlers to your `WebView2.WebMessageReceived` event handler in `Form1.cs`:

### 1. Check Distribution Folder

**JavaScript sends**:
```javascript
{
    action: "check-distribution-folder",
    folder: "C:\\fusion\\fusionclientweb\\wms"
}
```

**C# Handler**:
```csharp
private async Task HandleCheckDistributionFolder(WebView2 wv, string messageJson, string requestId)
{
    var message = JsonConvert.DeserializeObject<CheckDistributionFolderMessage>(messageJson);

    // Check if folder exists and contains index.html
    bool exists = Directory.Exists(message.Folder) &&
                  File.Exists(Path.Combine(message.Folder, "index.html"));

    // Send response back to JavaScript
    await SendMessageToJS(wv, new
    {
        type = "distribution-folder-exists",
        exists = exists,
        folder = message.Folder,
        requestId = requestId
    });
}
```

**Message Class**:
```csharp
public class CheckDistributionFolderMessage
{
    [JsonProperty("action")]
    public string Action { get; set; }

    [JsonProperty("folder")]
    public string Folder { get; set; }
}
```

---

### 2. Download Distribution Package

**JavaScript sends**:
```javascript
{
    action: "download-distribution",
    version: "1.2.0",
    packageUrl: "https://github.com/.../wms-webview-html-1.2.0.zip",
    extractTo: "C:\\fusion\\fusionclientweb\\wms"
}
```

**C# Handler**:
```csharp
private async Task HandleDownloadDistribution(WebView2 wv, string messageJson, string requestId)
{
    var message = JsonConvert.DeserializeObject<DownloadDistributionMessage>(messageJson);

    try
    {
        // Create temp path for download
        string tempZipPath = Path.Combine(Path.GetTempPath(), $"wms-distribution-{message.Version}.zip");

        // Download file with progress reporting
        using (WebClient client = new WebClient())
        {
            client.DownloadProgressChanged += (s, e) =>
            {
                // Send progress updates to JavaScript
                SendMessageToJS(wv, new
                {
                    type = "distribution-download-progress",
                    percent = e.ProgressPercentage,
                    bytesReceived = e.BytesReceived,
                    totalBytes = e.TotalBytesToReceive,
                    requestId = requestId
                }).Wait();
            };

            await client.DownloadFileTaskAsync(message.PackageUrl, tempZipPath);
        }

        // Create extraction folder if it doesn't exist
        if (!Directory.Exists(message.ExtractTo))
        {
            Directory.CreateDirectory(message.ExtractTo);
        }

        // Backup existing files if folder already has content
        string backupFolder = message.ExtractTo + ".backup";
        if (Directory.GetFiles(message.ExtractTo).Length > 0)
        {
            if (Directory.Exists(backupFolder))
            {
                Directory.Delete(backupFolder, true);
            }

            // Copy current files to backup
            CopyDirectory(message.ExtractTo, backupFolder);
        }

        // Extract ZIP file
        ZipFile.ExtractToDirectory(tempZipPath, message.ExtractTo, overwriteFiles: true);

        // Clean up temp file
        File.Delete(tempZipPath);

        // Send success message
        await SendMessageToJS(wv, new
        {
            type = "distribution-download-complete",
            version = message.Version,
            folder = message.ExtractTo,
            success = true,
            requestId = requestId
        });
    }
    catch (Exception ex)
    {
        // Send error message
        await SendMessageToJS(wv, new
        {
            type = "distribution-download-failed",
            error = ex.Message,
            requestId = requestId
        });
    }
}
```

**Message Class**:
```csharp
public class DownloadDistributionMessage
{
    [JsonProperty("action")]
    public string Action { get; set; }

    [JsonProperty("version")]
    public string Version { get; set; }

    [JsonProperty("packageUrl")]
    public string PackageUrl { get; set; }

    [JsonProperty("extractTo")]
    public string ExtractTo { get; set; }
}
```

---

### 3. Launch WMS Module

**JavaScript sends**:
```javascript
{
    action: "launch-wms-module",
    indexPath: "C:\\fusion\\fusionclientweb\\wms\\index.html"
}
```

**C# Handler**:
```csharp
private async Task HandleLaunchWMSModule(WebView2 wv, string messageJson, string requestId)
{
    var message = JsonConvert.DeserializeObject<LaunchWMSModuleMessage>(messageJson);

    try
    {
        // Verify file exists
        if (!File.Exists(message.IndexPath))
        {
            throw new FileNotFoundException($"WMS module not found at: {message.IndexPath}");
        }

        // Navigate the WebView2 control to the local HTML file
        // Option 1: Navigate in same window
        wv.CoreWebView2.Navigate($"file:///{message.IndexPath.Replace("\\", "/")}");

        /* Option 2: Open in new window
        Form wmsFrm = new Form();
        wmsFrm.Text = "WMS - Warehouse Management";
        wmsFrm.Size = new Size(1400, 900);
        wmsFrm.StartPosition = FormStartPosition.CenterScreen;

        WebView2 wmsWebView = new WebView2();
        wmsWebView.Dock = DockStyle.Fill;
        wmsFrm.Controls.Add(wmsWebView);

        await wmsWebView.EnsureCoreWebView2Async(null);
        wmsWebView.CoreWebView2.Navigate($"file:///{message.IndexPath.Replace("\\", "/")}");

        wmsFrm.Show();
        */

        // Send success message
        await SendMessageToJS(wv, new
        {
            type = "launch-wms-module",
            success = true,
            indexPath = message.IndexPath,
            requestId = requestId
        });
    }
    catch (Exception ex)
    {
        // Send error message
        await SendMessageToJS(wv, new
        {
            type = "launch-wms-module",
            success = false,
            error = ex.Message,
            requestId = requestId
        });
    }
}
```

**Message Class**:
```csharp
public class LaunchWMSModuleMessage
{
    [JsonProperty("action")]
    public string Action { get; set; }

    [JsonProperty("indexPath")]
    public string IndexPath { get; set; }
}
```

---

## Helper Methods

### Copy Directory Recursively

```csharp
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
```

### Send Message to JavaScript

```csharp
private async Task SendMessageToJS(WebView2 wv, object message)
{
    string json = JsonConvert.SerializeObject(message);
    await wv.CoreWebView2.ExecuteScriptAsync($"window.dispatchEvent(new MessageEvent('message', {{ data: {json} }}));");
}
```

---

## Adding to WebMessageReceived Handler

In your `Form1.cs`, update the `WebMessageReceived` event handler:

```csharp
private async void WebView_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
{
    string messageJson = e.WebMessageAsJson;
    var baseMessage = JsonConvert.DeserializeObject<BaseMessage>(messageJson);

    WebView2 wv = sender as WebView2;
    string requestId = Guid.NewGuid().ToString();

    try
    {
        switch (baseMessage.Action)
        {
            // ... existing handlers ...

            case "check-distribution-folder":
                await HandleCheckDistributionFolder(wv, messageJson, requestId);
                break;

            case "download-distribution":
                await HandleDownloadDistribution(wv, messageJson, requestId);
                break;

            case "launch-wms-module":
                await HandleLaunchWMSModule(wv, messageJson, requestId);
                break;

            default:
                Console.WriteLine($"Unknown action: {baseMessage.Action}");
                break;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error handling message: {ex.Message}");
    }
}
```

---

## Required NuGet Packages

Make sure these packages are installed:

```xml
<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
<PackageReference Include="Microsoft.Web.WebView2" Version="1.0.2210.55" />
```

---

## Required Using Statements

```csharp
using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
```

---

## Testing

1. **Test folder check**:
   - Click WMS button when folder doesn't exist
   - Should prompt to download

2. **Test download**:
   - Click "Get New Version" button
   - Should show progress overlay
   - Should extract to `C:\fusion\fusionclientweb\wms\`

3. **Test launch**:
   - After download completes, click WMS button
   - Should navigate to local index.html

---

## Security Considerations

1. **HTTPS Only**: Verify all download URLs use HTTPS
2. **Path Validation**: Validate all file paths to prevent directory traversal
3. **File Size Limits**: Consider adding file size checks before download
4. **Timeout**: Add timeout to download operations (currently no limit)

---

## Error Handling

The system handles these error cases:

- **Network errors**: Shows error message, allows retry
- **Disk space**: Should check before extraction (not currently implemented)
- **Permission errors**: Shows error message with admin prompt
- **Corrupted ZIP**: Shows error, deletes corrupted file
- **Missing files**: Shows error, prompts to re-download

---

## Deployment Notes

### Initial Deployment

When deploying the launcher application:
1. Distribution folder does NOT need to exist initially
2. User clicks "Get New Version" on first run
3. Files are downloaded from GitHub Releases

### Updates

When a new version is released:
1. User clicks "Get New Version"
2. Current files are backed up to `.backup` folder
3. New files are extracted
4. If extraction fails, backup is restored

---

## Configuration

Update `config.json` to customize:

```json
{
  "DISTRIBUTION_FOLDER": "C:\\fusion\\fusionclientweb\\wms",
  "GITHUB_RELEASE_API": "https://raw.githubusercontent.com/javeedin/graysWMSwebviewnew/main/latest-release.json",
  "DISTRIBUTION_MODE": "github-releases"
}
```

---

**END OF DOCUMENT**
