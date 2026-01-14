# Distribution System Testing Guide

## ✅ Implementation Complete

All code has been implemented for the distribution system:

### JavaScript Files
- ✅ `distribution-manager.js` - Download and launch logic
- ✅ `index.html` - Module buttons and UI
- ✅ `styles.css` - Button styling
- ✅ `config.json` - Configuration settings

### C# Implementation
- ✅ `Form1.cs` - All handlers implemented:
  - `HandleCheckDistributionFolder`
  - `HandleDownloadDistribution`
  - `HandleLaunchWMSModule`
  - `CopyDirectory` helper method
- ✅ Using statements added (System.IO, System.IO.Compression, System.Net)
- ✅ Switch cases added for all three actions

---

## 🧪 Testing Instructions

### Prerequisites

1. **Build the Application**
   ```bash
   # In Visual Studio
   Build → Rebuild Solution
   ```

2. **Create a GitHub Release** (for testing download)
   ```bash
   # Run release tool
   ./release.ps1

   # Or manually create a release with an HTML package
   ```

3. **Ensure `latest-release.json` is published** on your main branch

---

## Test 1: First Run (No WMS Installed)

### Steps:
1. Launch the application
2. Look at the header - you should see:
   - **"Fusion Client"** logo
   - **"WMS"** button (blue gradient, visible)
   - Other buttons (GL, AR, AP, OM, FA, CA) should be hidden
   - **"Admin"** user info on the right

3. Click the **WMS** button

### Expected Result:
- ❓ Dialog appears: "WMS module not installed yet. Would you like to download it now?"
- Two options: OK / Cancel

4. Click **OK**

### Expected Result:
- ✅ "Get New Version" button is automatically triggered
- ✅ Progress overlay appears with download status
- ✅ Progress bar animates from 0% to 100%
- ✅ Status text changes:
  - "Connecting to GitHub..."
  - "Downloading package from GitHub..."
  - "Extracting files..."
  - "Installing files..."
  - "Finalizing..."

5. When download completes:

### Expected Result:
- ✅ Success message: "WMS v1.X.X installed successfully!"
- ✅ Shows location: `C:\fusion\fusionclientweb\wms`
- ✅ Message: "Click the WMS button to launch the module."

6. Click **WMS** button again

### Expected Result:
- ✅ WebView navigates to `file:///C:/fusion/fusionclientweb/wms/index.html`
- ✅ WMS application loads in the same window

---

## Test 2: Manual Download via "Get New Version"

### Steps:
1. Scroll to bottom toolbar (diagnostic toolbar)
2. Find the **"Get New Version"** button (green, with download icon)

### Expected UI:
```
🔧 Diagnostics: [Check Buttons] [Force Show] [Check Grid] ... [Get New Version]
```

3. Click **"Get New Version"**

### Expected Result:
- ❓ Confirmation dialog appears:
  ```
  Download WMS version 1.X.X?

  This will download and install the latest version to:
  C:\fusion\fusionclientweb\wms

  Size: ~2MB
  Time: ~30 seconds
  ```
- Options: OK / Cancel

4. Click **OK**

### Expected Result:
- ✅ Progress overlay appears (same as Test 1)
- ✅ Downloads from GitHub Releases
- ✅ Extracts to `C:\fusion\fusionclientweb\wms\`
- ✅ Success message on completion

---

## Test 3: Update Existing Installation

### Prerequisites:
- WMS already installed in `C:\fusion\fusionclientweb\wms\`
- A newer version available on GitHub Releases

### Steps:
1. Click **"Get New Version"**
2. Confirm download

### Expected Result:
- ✅ Existing files are backed up to `C:\fusion\fusionclientweb\wms.backup\`
- ✅ New files extracted to `C:\fusion\fusionclientweb\wms\`
- ✅ Old version preserved in `.backup` folder

### Verify Backup:
```
C:\fusion\fusionclientweb\
├── wms\                 (new version)
│   ├── index.html
│   ├── app.js
│   └── ...
└── wms.backup\          (old version)
    ├── index.html
    ├── app.js
    └── ...
```

---

## Test 4: Error Handling

### Test 4.1: No Internet Connection

**Steps:**
1. Disconnect internet
2. Click "Get New Version"

**Expected Result:**
- ❌ Error message: "Failed to download new version: [network error]"
- ✅ Button returns to normal state
- ✅ No partial files left in distribution folder

### Test 4.2: Invalid GitHub URL

**Steps:**
1. Edit `config.json`:
   ```json
   {
     "GITHUB_RELEASE_API": "https://invalid-url.com/releases.json"
   }
   ```
2. Restart app
3. Click "Get New Version"

**Expected Result:**
- ❌ Error message: "Failed to fetch release info: 404"
- ✅ User can fix config and retry

### Test 4.3: Corrupted ZIP File

**Steps:**
1. Start download
2. Interrupt network during download
3. Wait for error

**Expected Result:**
- ❌ Error message: "Update package is corrupted"
- ✅ Temp file is deleted
- ✅ User can retry

### Test 4.4: Permission Denied

**Steps:**
1. Create folder: `C:\fusion\fusionclientweb\wms\`
2. Set folder to Read-Only
3. Click "Get New Version"

**Expected Result:**
- ❌ Error message: "Unable to extract update. Please run as administrator."
- ✅ No data loss
- ✅ User can fix permissions and retry

---

## Test 5: Debug Logging

### View C# Debug Output

**In Visual Studio:**
1. Run application in Debug mode (F5)
2. Open **Output** window (View → Output)
3. Click "Get New Version"

**Expected Debug Log:**
```
[C#] Starting distribution download...
[C#] Version: 1.2.0
[C#] Package URL: https://github.com/.../wms-webview-html-1.2.0.zip
[C#] Extract to: C:\fusion\fusionclientweb\wms
[C#] Temp ZIP path: C:\Users\...\Temp\wms-distribution-1.2.0.zip
[C#] Downloading from GitHub...
[C#] Download complete!
[C#] Creating distribution folder: C:\fusion\fusionclientweb\wms
[C#] Extracting ZIP file...
[C#] Extraction complete!
[C#] Temp file deleted
[C#] ✅ Distribution download complete!
```

### View JavaScript Console

**In Application:**
1. Press **F12** (DevTools)
2. Go to **Console** tab
3. Click "Get New Version"

**Expected Console Log:**
```javascript
[Distribution] Starting download...
[Distribution] Latest version: 1.2.0
[Distribution] Package URL: https://...
[Distribution] Download progress: 25%
[Distribution] Download progress: 50%
[Distribution] Download progress: 75%
[Distribution] Download progress: 100%
[Distribution] Download complete!
```

---

## Test 6: File Verification

### After Download, Verify Files Exist:

**Location:** `C:\fusion\fusionclientweb\wms\`

**Expected Files:**
```
C:\fusion\fusionclientweb\wms\
├── index.html           ✅
├── app.js               ✅
├── monitor-printing.js  ✅
├── printer-management-new.js ✅
├── update-manager.js    ✅
├── distribution-manager.js ✅
├── styles.css           ✅
├── version.json         ✅
└── config.json          ✅
```

### Verify version.json Content:

**Open:** `C:\fusion\fusionclientweb\wms\version.json`

**Expected Content:**
```json
{
  "version": "1.2.0",
  "build_date": "2025-11-07",
  "files": {
    "index.html": "2025-11-07T10:30:00Z",
    "app.js": "2025-11-07T10:30:00Z",
    ...
  }
}
```

---

## Test 7: Launch WMS Module

### Steps:
1. Click **WMS** button in header
2. Observe WebView navigation

### Expected Result:
- ✅ URL bar changes to: `file:///C:/fusion/fusionclientweb/wms/index.html`
- ✅ WMS application loads
- ✅ All JavaScript files load correctly
- ✅ Styles are applied
- ✅ DevExpress grids initialize
- ✅ No console errors

### Verify Loaded Resources (F12 → Network tab):
```
✅ index.html
✅ app.js?v=1731000000000
✅ monitor-printing.js?v=1731000000000
✅ styles.css?v=1731000000000
✅ config.json?t=1731000000000
```

---

## Test 8: Progress Reporting

### Steps:
1. Click "Get New Version"
2. Watch progress overlay

### Expected Progress Updates:
```
  0% - Connecting to GitHub...
 10% - Downloading package from GitHub...
 30% - Downloading package from GitHub...
 60% - Extracting files...
 85% - Installing files...
 95% - Finalizing...
100% - Complete!
```

### Verify Progress Bar:
- ✅ Smooth animation
- ✅ Color: Blue-purple gradient
- ✅ Fills from left to right
- ✅ Reaches 100% before closing

---

## Test 9: UI/UX Verification

### Header Module Buttons:

**Visible:**
- ✅ WMS button (blue gradient with warehouse icon)
  - Hover effect: Lifts up slightly
  - Shadow increases on hover

**Hidden (should NOT be visible):**
- ❌ GL button
- ❌ AR button
- ❌ AP button
- ❌ OM button
- ❌ FA button
- ❌ CA button

### Bottom Toolbar:

**"Get New Version" Button:**
- ✅ Green background (#4CAF50)
- ✅ Download icon (📥)
- ✅ Located after "Check Trip Data" button
- ✅ Hover effect: Slightly darker green
- ✅ Disabled during download

---

## Test 10: Edge Cases

### Test 10.1: Rapid Clicks
**Steps:** Click "Get New Version" 5 times rapidly

**Expected Result:**
- ✅ Only one download starts
- ✅ Alert: "Download already in progress. Please wait..."

### Test 10.2: Cancel Download
**Steps:**
1. Click "Get New Version"
2. Click "Cancel" on confirmation dialog

**Expected Result:**
- ✅ Download does not start
- ✅ No files created
- ✅ Button returns to normal

### Test 10.3: Empty Release
**Steps:**
1. Create GitHub Release with no files
2. Click "Get New Version"

**Expected Result:**
- ❌ Error: "Package URL not found in release info"

### Test 10.4: Large File Download
**Steps:**
1. Create release with 50MB ZIP file
2. Click "Get New Version"

**Expected Result:**
- ✅ Progress bar shows accurate percentage
- ✅ Download completes successfully
- ✅ No timeout errors

---

## Troubleshooting

### Issue: "WMS button does nothing"

**Check:**
1. Open DevTools console (F12)
2. Click WMS button
3. Look for errors

**Possible Causes:**
- JavaScript not loaded
- Message passing not working
- C# handler not responding

**Fix:**
- Verify `distribution-manager.js` is loaded
- Check C# Debug Output for errors

---

### Issue: "Download fails immediately"

**Check:**
1. Verify internet connection
2. Check `config.json`:
   ```json
   {
     "GITHUB_RELEASE_API": "https://raw.githubusercontent.com/javeedin/graysWMSwebviewnew/main/latest-release.json"
   }
   ```
3. Test URL in browser

**Fix:**
- Update GitHub URL
- Check if repository is public

---

### Issue: "Progress bar stuck at 90%"

**Check:**
1. C# Debug Output for errors
2. Temp folder: `%TEMP%\wms-distribution-*.zip`

**Possible Causes:**
- ZIP extraction failed
- Permission denied
- Corrupted file

**Fix:**
- Run as administrator
- Delete temp files manually
- Retry download

---

### Issue: "WMS launches but shows blank page"

**Check:**
1. Verify files exist: `C:\fusion\fusionclientweb\wms\index.html`
2. Open DevTools console
3. Look for 404 errors

**Possible Causes:**
- Incomplete extraction
- Missing files in ZIP package
- File permissions

**Fix:**
- Re-download distribution
- Verify ZIP contents
- Check folder permissions

---

## Success Criteria

All tests pass when:

- ✅ Header shows WMS button only (GL, AR, AP, OM, FA, CA hidden)
- ✅ "Get New Version" button appears in bottom toolbar
- ✅ Clicking WMS when not installed prompts to download
- ✅ Download progress shows real-time updates
- ✅ Files extract to `C:\fusion\fusionclientweb\wms\`
- ✅ Backup folder created on updates
- ✅ WMS module launches from distribution folder
- ✅ Error messages are user-friendly
- ✅ Debug logs are detailed and accurate
- ✅ No memory leaks or performance issues

---

## Performance Benchmarks

### Expected Timings:
- **Check folder exists:** < 100ms
- **Fetch release info:** < 2 seconds
- **Download 2MB package:** 5-30 seconds (depends on connection)
- **Extract ZIP:** 1-3 seconds
- **Launch WMS module:** < 500ms

### Memory Usage:
- **During download:** +20-50MB (temporary)
- **After extraction:** +5MB (cached files)
- **After launch:** Normal WMS memory usage

---

## Next Steps After Testing

1. ✅ **If all tests pass:**
   - Create first GitHub Release with `./release.ps1`
   - Distribute launcher EXE to users
   - Users can download WMS on first run

2. ❌ **If tests fail:**
   - Note which test failed
   - Check debug logs
   - Report issues with detailed error messages

3. 🚀 **For production deployment:**
   - Remove diagnostic toolbar (or hide it)
   - Configure correct GitHub Release URL
   - Test with real users
   - Monitor error logs

---

## Support

If you encounter any issues:

1. Check **C# Debug Output** (Visual Studio Output window)
2. Check **JavaScript Console** (F12 in application)
3. Review debug logs for specific error messages
4. Refer to `DISTRIBUTION_CSHARP_HANDLERS.md` for implementation details

---

**Version:** 1.0
**Last Updated:** 2025-11-07
**Status:** Ready for Testing
