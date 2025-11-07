# WMS WebView Application
## Release Management Architecture

**Document Version**: 1.0
**Date**: November 7, 2025
**Status**: Final Design
**Author**: Development Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [System Components](#system-components)
4. [Progressive Desktop App Model](#progressive-desktop-app-model)
5. [Release Management Workflow](#release-management-workflow)
6. [Auto-Update System](#auto-update-system)
7. [Version Management](#version-management)
8. [Technical Implementation](#technical-implementation)
9. [Security Considerations](#security-considerations)
10. [Deployment Strategy](#deployment-strategy)
11. [Troubleshooting Guide](#troubleshooting-guide)
12. [Future Enhancements](#future-enhancements)

---

## 1. Executive Summary

### Problem Statement

Traditional desktop applications require full reinstallation for every update, leading to:
- Delayed deployments
- User frustration with update processes
- Increased IT support burden
- Version fragmentation across user base

### Solution

A **Progressive Desktop App** deployment model that combines:
- Native Windows application (C# WinForms + WebView2)
- Web-based content delivery (HTML/CSS/JavaScript)
- Automatic update system with GitHub Releases as CDN
- Two-level update mechanism (quick HTML updates, full EXE updates)

### Benefits

- **Instant Updates**: HTML/JS changes deploy immediately
- **Zero Downtime**: Updates apply on next restart
- **Reduced Bandwidth**: Only changed files downloaded
- **User Control**: Optional automatic updates
- **Version Consistency**: All users stay current
- **Developer Friendly**: Simple release process

---

## 2. Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    DEVELOPER WORKFLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │   Develop    │─────▶│  Run Release │─────▶│  GitHub   │ │
│  │ Code Locally │      │     Tool     │      │  Release  │ │
│  └──────────────┘      └──────────────┘      └─────┬─────┘ │
│                                                      │       │
└──────────────────────────────────────────────────────┼───────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   GITHUB DISTRIBUTION                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  GitHub Releases (acts as CDN)                       │   │
│  │  ├── latest-release.json                            │   │
│  │  ├── v1.1.0/                                        │   │
│  │  │   ├── wms-webview-html-1.1.0.zip                │   │
│  │  │   └── WMSWebView.exe                            │   │
│  │  ├── v1.2.0/                                        │   │
│  │  │   ├── wms-webview-html-1.2.0.zip                │   │
│  │  │   └── WMSWebView.exe                            │   │
│  │  └── ...                                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                      END USER SYSTEM                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  C:\Program Files\WMSWebView\                        │  │
│  │  └── WMSWebView.exe (Native App)                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  %APPDATA%\WMSWebView\                               │  │
│  │  ├── cache\                                          │  │
│  │  │   ├── index.html                                 │  │
│  │  │   ├── app.js                                     │  │
│  │  │   ├── monitor-printing.js                        │  │
│  │  │   ├── update-manager.js                          │  │
│  │  │   ├── styles.css                                 │  │
│  │  │   └── version.json                               │  │
│  │  └── config.json                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Update Process Flow:                                 │  │
│  │  1. App checks GitHub for latest-release.json        │  │
│  │  2. Compares versions                                 │  │
│  │  3. Downloads HTML package if newer                   │  │
│  │  4. Extracts to cache folder                          │  │
│  │  5. Shows notification to user                        │  │
│  │  6. Applies on next restart                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│          │         │          │         │          │
│  C# App  │◀───────▶│ WebView2 │◀───────▶│  GitHub  │
│          │         │          │         │ Releases │
└──────────┘         └────┬─────┘         └──────────┘
     │                    │
     │                    ▼
     │            ┌──────────────┐
     │            │              │
     └───────────▶│ Update Mgr   │
                  │ (JavaScript) │
                  └──────────────┘
```

---

## 3. System Components

### 3.1 Release Management Tool (PowerShell)

**File**: `release.ps1`

**Purpose**: Automates the release creation process for developers

**Key Features**:
- Analyzes git commits since last release
- Categorizes changes (breaking, features, fixes)
- Suggests semantic version numbers automatically
- Generates changelog from commit messages
- Creates GitHub Release via GitHub CLI
- Packages HTML/JS files into distributable zip
- Updates version tracking files

**Dependencies**:
- PowerShell 7+
- Git
- GitHub CLI (`gh`) or GitHub Personal Access Token

**Workflow**:
```
Start
  ↓
Read last release version from latest-release.json
  ↓
Get all commits since last release
  ↓
Analyze commit messages:
  - Breaking changes? → MAJOR bump
  - New features? → MINOR bump
  - Bug fixes? → PATCH bump
  ↓
Generate changelog from commits
  ↓
Show preview to developer
  ↓
Developer confirms version
  ↓
Update version.json
  ↓
Create HTML package (zip)
  ↓
Create GitHub Release
  ↓
Upload package to release
  ↓
Update latest-release.json
  ↓
Done
```

### 3.2 Update Manager (JavaScript)

**File**: `update-manager.js`

**Purpose**: Handles automatic update checks and downloads for end users

**Key Features**:
- Periodic update checks (configurable interval)
- Version comparison logic
- Update notification UI
- Download and installation manager
- Settings persistence

**Configuration**:
```javascript
{
  githubReleaseAPI: "https://raw.githubusercontent.com/.../latest-release.json",
  autoUpdateHTML: true,
  autoUpdateEXE: false,
  checkIntervalMinutes: 60,
  currentVersion: "1.1.0"
}
```

**Workflow**:
```
App Starts
  ↓
Load config.json
  ↓
Initialize update manager
  ↓
Check for updates immediately
  ↓
Fetch latest-release.json from GitHub
  ↓
Compare versions:
  Remote > Local?
    Yes → Show notification banner
    No  → Hide banner
  ↓
Set up periodic timer (60 minutes)
  ↓
User clicks "Download Update"
  ↓
Send message to C# backend
  ↓
C# downloads HTML package
  ↓
C# extracts to cache folder
  ↓
Show success message
  ↓
User restarts app
  ↓
Load updated files from cache
  ↓
Done
```

### 3.3 Settings & Updates Page (HTML/JavaScript)

**Location**: `index.html` (Settings & Updates section)

**Purpose**: User interface for update management

**Features**:
- Display current version and build date
- Display update status
- Manual update check button
- Configurable settings:
  - Auto-download HTML updates
  - Check for updates on startup
  - Update check interval
- Last update check timestamp

**UI Components**:
```
┌─────────────────────────────────────────┐
│  ⚙️ Settings & Updates                  │
├─────────────────────────────────────────┤
│                                          │
│  Application Information                │
│  ┌────────────────────────────────────┐ │
│  │ Current Version:  1.1.0            │ │
│  │ Build Date:       2025-11-07       │ │
│  │ Update Status:    Up to date ✓    │ │
│  └────────────────────────────────────┘ │
│                                          │
│  Update Settings                         │
│  ┌────────────────────────────────────┐ │
│  │ ☑ Auto-download HTML updates       │ │
│  │ ☑ Check for updates on startup     │ │
│  │ Update interval: [60] minutes      │ │
│  │                                     │ │
│  │ [Save Settings]                    │ │
│  └────────────────────────────────────┘ │
│                                          │
│  Update Actions                          │
│  ┌────────────────────────────────────┐ │
│  │ [Check for Updates Now]            │ │
│  │                                     │ │
│  │ Last checked: 2025-11-07 14:30     │ │
│  └────────────────────────────────────┘ │
│                                          │
└─────────────────────────────────────────┘
```

### 3.4 Version Tracking Files

#### latest-release.json

**Purpose**: Published on GitHub, tells users about the latest available version

**Location**: GitHub repository (main branch)

**Structure**:
```json
{
  "version": "1.2.0",
  "release_date": "2025-11-07T10:30:00Z",
  "html_package_url": "https://github.com/.../v1.2.0/wms-webview-html-1.2.0.zip",
  "exe_url": "https://github.com/.../v1.2.0/WMSWebView.exe",
  "changelog_url": "https://github.com/.../releases/tag/v1.2.0"
}
```

#### version.json

**Purpose**: Included in HTML package, describes the version and files

**Location**: Bundled with HTML/JS files

**Structure**:
```json
{
  "version": "1.2.0",
  "build_date": "2025-11-07",
  "files": {
    "index.html": "2025-11-07T10:30:00Z",
    "app.js": "2025-11-07T10:30:00Z",
    "monitor-printing.js": "2025-11-07T10:30:00Z",
    "update-manager.js": "2025-11-07T10:30:00Z",
    "styles.css": "2025-11-07T10:30:00Z"
  },
  "changelog": "APEX Integration + Print Queue System"
}
```

#### config.json

**Purpose**: Application configuration, editable by users

**Location**: `%APPDATA%\WMSWebView\config.json`

**Structure**:
```json
{
  "APP_VERSION": "1.2.0",
  "HTML_SOURCE": "network",
  "NETWORK_PATH": "\\\\server\\WMS\\html",
  "APEX_BASE_URL": "https://apex-server.com/ords/workspace",
  "PDF_FOLDER": "C:\\fusion",
  "CHECK_UPDATES_ON_START": true,
  "FALLBACK_TO_LOCAL": false,
  "CACHE_BUSTER_ENABLED": true,
  "GITHUB_RELEASE_API": "https://raw.githubusercontent.com/.../latest-release.json",
  "AUTO_UPDATE_HTML": true,
  "AUTO_UPDATE_EXE": false,
  "UPDATE_CHECK_INTERVAL_MINUTES": 60
}
```

---

## 4. Progressive Desktop App Model

### Concept

A **Progressive Desktop App** combines the benefits of native applications with the flexibility of web applications:

- **Native Shell**: C# WinForms provides OS integration (system tray, file access, printing)
- **Web Content**: HTML/CSS/JS provides UI and business logic
- **Hybrid Updates**: Native shell updates rarely, web content updates frequently

### Advantages Over Traditional Desktop Apps

| Aspect | Traditional Desktop | Progressive Desktop |
|--------|-------------------|-------------------|
| **Update Speed** | Slow (full reinstall) | Fast (HTML only) |
| **Deployment** | Manual IT process | Automatic background |
| **Bandwidth** | Full app (~50MB+) | HTML package (~2MB) |
| **User Disruption** | High (uninstall/install) | Low (restart only) |
| **Version Control** | Fragmented | Consistent |
| **Rollback** | Difficult | Easy (re-download) |
| **Testing** | Production deployment | Gradual rollout possible |

### File Loading Strategy

```
App Startup
  ↓
Check cache folder exists?
  No → Create %APPDATA%\WMSWebView\cache\
  ↓
Check for cached HTML files?
  Yes → Check version.json timestamp
         ├─ Recent? → Load from cache
         └─ Old?    → Check for updates
  No  → Download from GitHub Release
  ↓
Load HTML in WebView2
  ↓
Apply cache buster query parameters
  (e.g., app.js?v=1731000000000)
  ↓
WebView2 renders UI
  ↓
JavaScript initializes
  ↓
Update manager starts periodic checks
```

### Cache Management

**Cache Location**: `%APPDATA%\WMSWebView\cache\`

**Cache Strategy**:
1. **First Load**: Download from GitHub Release
2. **Subsequent Loads**: Load from local cache
3. **Update Available**: Download new version to temp folder
4. **Next Restart**: Replace cache with new version
5. **Cache Buster**: Query parameters prevent browser cache issues

**Cache Invalidation**:
- Manual: User clicks "Check for Updates"
- Automatic: Every 60 minutes (configurable)
- Forced: App restart always checks for updates

---

## 5. Release Management Workflow

### 5.1 Developer Workflow

#### Step 1: Development

Developer works on the codebase normally:
```bash
git checkout -b feature/new-printing-options
# ... make changes ...
git add .
git commit -m "✨ NEW: Added duplex printing support"
git push origin feature/new-printing-options
```

**Best Practice**: Use conventional commit format with emojis:
- 🚀 `NEW:` or ✨ `feat:` - New features (MINOR bump)
- 🔧 `FIX:` or 🐛 `fix:` - Bug fixes (PATCH bump)
- 🚨 `BREAKING:` or ‼️ `major:` - Breaking changes (MAJOR bump)
- 📝 `docs:` - Documentation
- ♻️ `refactor:` - Code refactoring

#### Step 2: Merge to Main

After code review and approval:
```bash
git checkout main
git merge feature/new-printing-options
git push origin main
```

#### Step 3: Run Release Tool

When ready to distribute to users:
```bash
cd /path/to/graysWMSwebviewnew
./release.ps1
```

**Interactive Prompts**:
1. Shows commits since last release
2. Categorizes changes
3. Suggests version number
4. Shows changelog preview
5. Asks for confirmation
6. Creates release automatically

**Example Session**:
```
╔════════════════════════════════════════╗
║   WMS WebView - Release Tool           ║
╚════════════════════════════════════════╝

==> Analyzing repository...
  Current version: 1.1.0
  Found 5 commits since last release

╔════════════════════════════════════════╗
║         RELEASE PREVIEW                ║
╚════════════════════════════════════════╝

📦 Current Version: 1.1.0
📦 Suggested Version: 1.2.0
📝 Reason: New features detected

📊 Change Summary:
   Total commits: 5
   Files changed: 8
   ✨ New features: 2
   🔧 Bug fixes: 1

📋 Changelog:
────────────────────────────────────────
## ✨ New Features
- NEW: Duplex printing support
- NEW: Print job history tracking

## 🔧 Bug Fixes
- FIX: PDF preview rendering issue
────────────────────────────────────────

Enter version (or press Enter for 1.2.0):
✓ Version confirmed: 1.2.0

Is this a pre-release? (y/N): n

⚠️  Ready to create release v1.2.0
Proceed? (Y/n): y

==> Creating HTML package...
✓ Created: releases/wms-webview-html-1.2.0.zip

==> Creating GitHub Release...
✓ Release created successfully!
🔗 https://github.com/.../releases/tag/v1.2.0

✅ Done! Users will receive update notifications.
```

#### Step 4: Verify Release

1. Visit GitHub Releases page
2. Verify package uploaded
3. Check `latest-release.json` updated
4. Test update in application

### 5.2 Release Tool Internals

#### Version Analysis Algorithm

```javascript
function analyzeChanges(commits) {
  let hasBreaking = false;
  let hasFeatures = false;
  let hasFixes = false;

  commits.forEach(commit => {
    const msg = commit.toLowerCase();

    // Check for breaking changes
    if (msg.includes('breaking') ||
        msg.includes('major') ||
        msg.includes('🚨') ||
        msg.includes('‼️')) {
      hasBreaking = true;
    }
    // Check for new features
    else if (msg.includes('feat') ||
             msg.includes('feature') ||
             msg.includes('new') ||
             msg.includes('🚀') ||
             msg.includes('✨')) {
      hasFeatures = true;
    }
    // Check for bug fixes
    else if (msg.includes('fix') ||
             msg.includes('bug') ||
             msg.includes('🔧') ||
             msg.includes('🐛')) {
      hasFixes = true;
    }
  });

  // Determine version bump
  if (hasBreaking) {
    return 'MAJOR'; // 1.0.0 → 2.0.0
  } else if (hasFeatures) {
    return 'MINOR'; // 1.0.0 → 1.1.0
  } else if (hasFixes) {
    return 'PATCH'; // 1.0.0 → 1.0.1
  } else {
    return 'PATCH'; // Default
  }
}
```

#### Changelog Generation

```javascript
function generateChangelog(commits) {
  const breaking = [];
  const features = [];
  const fixes = [];
  const other = [];

  commits.forEach(commit => {
    const msg = commit.message;
    if (isBreaking(msg)) {
      breaking.push(msg);
    } else if (isFeature(msg)) {
      features.push(msg);
    } else if (isFix(msg)) {
      fixes.push(msg);
    } else {
      other.push(msg);
    }
  });

  let changelog = '';

  if (breaking.length > 0) {
    changelog += '## 🚨 Breaking Changes\n\n';
    breaking.forEach(item => {
      changelog += `- ${item}\n`;
    });
    changelog += '\n';
  }

  if (features.length > 0) {
    changelog += '## ✨ New Features\n\n';
    features.forEach(item => {
      changelog += `- ${item}\n`;
    });
    changelog += '\n';
  }

  if (fixes.length > 0) {
    changelog += '## 🔧 Bug Fixes\n\n';
    fixes.forEach(item => {
      changelog += `- ${item}\n`;
    });
    changelog += '\n';
  }

  return changelog;
}
```

#### Package Creation

```powershell
# Create HTML package
$packageName = "wms-webview-html-$Version.zip"
$packagePath = Join-Path "releases" $packageName

$filesToPackage = @(
    "index.html",
    "app.js",
    "monitor-printing.js",
    "printer-management-new.js",
    "update-manager.js",
    "styles.css",
    "version.json",
    "config.json"
)

Compress-Archive -Path $filesToPackage `
                 -DestinationPath $packagePath `
                 -Force
```

#### GitHub Release Creation

```powershell
# Using GitHub CLI
gh release create "v$Version" `
  --title "WMS WebView $Version" `
  --notes-file "CHANGELOG_TEMP.md"

# Upload package
gh release upload "v$Version" $packagePath
```

---

## 6. Auto-Update System

### 6.1 Update Detection

#### Periodic Check Flow

```
Timer triggers (every 60 minutes)
  ↓
Fetch latest-release.json from GitHub
  ↓
Parse JSON response
  {
    "version": "1.2.0",
    "html_package_url": "...",
    "release_date": "..."
  }
  ↓
Load current version from config.json
  { "APP_VERSION": "1.1.0" }
  ↓
Compare versions using semantic versioning
  isNewerVersion("1.2.0", "1.1.0") → true
  ↓
Update available!
  ↓
Show notification banner
```

#### Version Comparison Logic

```javascript
function isNewerVersion(remote, local) {
  // Parse versions: "1.2.0" → [1, 2, 0]
  const remoteParts = remote.split('.').map(Number);
  const localParts = local.split('.').map(Number);

  // Compare MAJOR version
  if (remoteParts[0] > localParts[0]) return true;
  if (remoteParts[0] < localParts[0]) return false;

  // Compare MINOR version
  if (remoteParts[1] > localParts[1]) return true;
  if (remoteParts[1] < localParts[1]) return false;

  // Compare PATCH version
  if (remoteParts[2] > localParts[2]) return true;
  if (remoteParts[2] < localParts[2]) return false;

  // Versions are equal
  return false;
}
```

### 6.2 Notification System

#### Notification Banner UI

```html
┌─────────────────────────────────────────────────────────┐
│ 🎉  New version available!                              │
│     Version 1.2.0 is ready to install                   │
│                                                          │
│     [View Changelog]  [Download Update]  [×]            │
└─────────────────────────────────────────────────────────┘
```

**Features**:
- Eye-catching gradient background (purple/blue)
- Prominent call-to-action buttons
- Dismissable (but reappears on next check if still applicable)
- Non-intrusive (doesn't block user interaction)
- Animated slide-down entrance

#### Notification Banner Code

```javascript
function showUpdateNotification(releaseInfo) {
  const banner = document.getElementById('update-notification');
  const versionText = document.getElementById('update-version-text');

  versionText.textContent =
    `Version ${releaseInfo.version} is ready to install`;

  banner.classList.remove('hidden');
  document.body.classList.add('update-notification-visible');
}
```

### 6.3 Download and Installation

#### Download Process

```
User clicks "Download Update"
  ↓
JavaScript sends message to C# backend
  {
    action: "download-update",
    version: "1.2.0",
    htmlPackageUrl: "https://github.com/.../html-1.2.0.zip"
  }
  ↓
C# WebView2 message handler receives message
  ↓
C# downloads ZIP file
  using (WebClient client = new WebClient()) {
    client.DownloadFile(url, tempPath);
  }
  ↓
C# extracts ZIP to temporary folder
  ZipFile.ExtractToDirectory(tempPath, extractPath);
  ↓
C# validates extracted files
  - Check version.json exists
  - Verify file integrity
  ↓
C# moves files to cache folder
  %APPDATA%\WMSWebView\cache\
  ↓
C# sends success message back to JavaScript
  ↓
JavaScript shows success notification
  "Update downloaded! Restart to apply."
  ↓
User restarts application
  ↓
App loads new files from cache
  ↓
Update complete!
```

#### C# Backend Handler (Pseudo-code)

```csharp
private async Task HandleDownloadUpdate(string messageJson) {
    var msg = JsonConvert.DeserializeObject<UpdateMessage>(messageJson);

    try {
        // Download package
        string tempPath = Path.Combine(
            Path.GetTempPath(),
            $"wms-update-{msg.Version}.zip"
        );

        using (WebClient client = new WebClient()) {
            await client.DownloadFileTaskAsync(
                msg.HtmlPackageUrl,
                tempPath
            );
        }

        // Extract to temp folder
        string extractPath = Path.Combine(
            Path.GetTempPath(),
            $"wms-update-{msg.Version}"
        );

        ZipFile.ExtractToDirectory(tempPath, extractPath);

        // Validate version.json
        string versionFile = Path.Combine(
            extractPath,
            "version.json"
        );

        if (!File.Exists(versionFile)) {
            throw new Exception("Invalid package: version.json missing");
        }

        // Move to cache folder
        string cacheFolder = Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.ApplicationData
            ),
            "WMSWebView",
            "cache"
        );

        // Backup current cache
        if (Directory.Exists(cacheFolder)) {
            string backupFolder = cacheFolder + ".backup";
            if (Directory.Exists(backupFolder)) {
                Directory.Delete(backupFolder, true);
            }
            Directory.Move(cacheFolder, backupFolder);
        }

        // Move new files to cache
        Directory.Move(extractPath, cacheFolder);

        // Send success message
        await SendMessageToJS(new {
            type = "update-download-complete",
            version = msg.Version
        });

        // Clean up
        File.Delete(tempPath);

    } catch (Exception ex) {
        // Send error message
        await SendMessageToJS(new {
            type = "update-download-failed",
            error = ex.Message
        });
    }
}
```

### 6.4 Settings Management

#### Settings Persistence

Settings are stored in two locations:

1. **config.json** (Persistent, survives updates)
   - Location: `%APPDATA%\WMSWebView\config.json`
   - Modified by: User through Settings page
   - Format: JSON

2. **localStorage** (Temporary, for UI state)
   - Location: WebView2 user data folder
   - Modified by: JavaScript
   - Format: Key-value pairs

#### Saving Settings Flow

```
User changes setting in UI
  ↓
JavaScript reads form values
  autoUpdateHTML = checkbox.checked
  checkOnStart = checkbox.checked
  interval = input.value
  ↓
JavaScript sends message to C# backend
  {
    action: "save-update-settings",
    autoUpdateHTML: true,
    checkUpdatesOnStart: true,
    updateIntervalMinutes: 60
  }
  ↓
C# reads current config.json
  ↓
C# updates relevant fields
  ↓
C# writes back to config.json
  ↓
C# sends confirmation to JavaScript
  ↓
JavaScript restarts update timer with new interval
  ↓
JavaScript shows "Settings saved!" message
```

---

## 7. Version Management

### 7.1 Semantic Versioning

The system uses **Semantic Versioning 2.0.0** (semver.org):

```
MAJOR.MINOR.PATCH

Example: 2.3.5
         │ │ │
         │ │ └─ PATCH: Bug fixes (backward compatible)
         │ └─── MINOR: New features (backward compatible)
         └───── MAJOR: Breaking changes (NOT backward compatible)
```

#### Version Bumping Rules

| Change Type | Version Bump | Example | When to Use |
|------------|--------------|---------|-------------|
| **Breaking** | MAJOR | 1.5.3 → **2**.0.0 | API changes, removed features, incompatible changes |
| **Feature** | MINOR | 1.5.3 → 1.**6**.0 | New functionality, new features (backward compatible) |
| **Fix** | PATCH | 1.5.3 → 1.5.**4** | Bug fixes, performance improvements |

#### Pre-release Versions

For testing and staging:

```
1.2.0-alpha.1    (Early testing)
1.2.0-beta.1     (Feature complete, testing)
1.2.0-rc.1       (Release candidate)
1.2.0            (Stable release)
```

To create pre-release:
```bash
./release.ps1
# When prompted: "Is this a pre-release? (y/N): y"
```

### 7.2 Version Tracking

#### Version State Diagram

```
┌────────────────────────────────────────────────────┐
│                                                     │
│  latest-release.json (GitHub)                      │
│  ┌──────────────────────────────────────────────┐ │
│  │ version: "1.2.0"                             │ │
│  │ html_package_url: "..."                      │ │
│  └──────────────────────────────────────────────┘ │
│                    │                                │
│                    │ Fetched by update manager      │
│                    ▼                                │
│  ┌──────────────────────────────────────────────┐ │
│  │ Update Manager (JavaScript)                  │ │
│  │ - Compares versions                          │ │
│  │ - Triggers download if newer                 │ │
│  └──────────────────────────────────────────────┘ │
│                    │                                │
│                    ▼                                │
│  ┌──────────────────────────────────────────────┐ │
│  │ config.json (Local)                          │ │
│  │ APP_VERSION: "1.1.0"                         │ │
│  └──────────────────────────────────────────────┘ │
│                    │                                │
│                    │ Updated after download         │
│                    ▼                                │
│  ┌──────────────────────────────────────────────┐ │
│  │ version.json (Cached)                        │ │
│  │ version: "1.2.0"                             │ │
│  │ build_date: "2025-11-07"                     │ │
│  │ files: {...}                                 │ │
│  └──────────────────────────────────────────────┘ │
│                                                     │
└────────────────────────────────────────────────────┘
```

### 7.3 Version History

Version history is maintained in:

1. **GitHub Releases**
   - Each release tagged with version (v1.2.0)
   - Release notes stored permanently
   - Packages archived for each version

2. **Git Tags**
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

3. **Changelog File** (Optional)
   - CHANGELOG.md in repository
   - Auto-generated during release
   - Human-readable format

#### Example Changelog Format

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2025-11-07

### Added
- NEW: Duplex printing support
- NEW: Print job history tracking
- NEW: Bulk print operations

### Fixed
- FIX: PDF preview rendering issue
- FIX: Memory leak in print queue

### Changed
- Improved print queue performance
- Updated UI for better usability

## [1.1.0] - 2025-11-01

### Added
- NEW: APEX Integration
- NEW: Print Queue System
- NEW: Auto-update feature

### Fixed
- FIX: Status loading from APEX
- FIX: PDF path escaping

## [1.0.0] - 2025-10-15

### Added
- Initial release
- Monitor Printing page
- Trip management
- Printer setup
```

---

## 8. Technical Implementation

### 8.1 Technology Stack

#### Frontend
- **HTML5**: Semantic markup
- **CSS3**: Styling and animations
- **JavaScript (ES6+)**: Business logic
- **jQuery 3.6**: DOM manipulation
- **DevExpress 23.2**: Data grids and UI components
- **Chart.js**: Data visualization
- **Font Awesome**: Icons

#### Backend (C#)
- **.NET Framework 4.7.2+** or **.NET 6+**
- **Windows Forms**: Native window container
- **WebView2**: Chromium-based web renderer
- **System.IO.Compression**: ZIP handling
- **System.Net.WebClient**: HTTP downloads
- **Newtonsoft.Json**: JSON serialization

#### Distribution
- **GitHub Releases**: CDN and version hosting
- **GitHub CLI**: Automated release creation
- **PowerShell 7+**: Release management scripting

#### Data Storage
- **Oracle APEX**: Backend database and REST API
- **localStorage**: Client-side temporary storage
- **JSON files**: Configuration and version tracking

### 8.2 Communication Architecture

#### JavaScript ↔ C# Bridge

```
┌─────────────────────────────────────────────┐
│           JavaScript (WebView2)              │
├─────────────────────────────────────────────┤
│                                              │
│  window.chrome.webview.postMessage({        │
│    action: "download-update",               │
│    version: "1.2.0",                        │
│    url: "..."                               │
│  });                                        │
│                                              │
└──────────────────┬──────────────────────────┘
                   │
                   │ WebView2 Message
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              C# Backend                      │
├─────────────────────────────────────────────┤
│                                              │
│  webView.WebMessageReceived += (s, e) => {  │
│    string json = e.WebMessageAsJson;        │
│    var msg = JsonConvert                    │
│              .DeserializeObject<Msg>(json); │
│                                              │
│    switch (msg.Action) {                    │
│      case "download-update":                │
│        HandleDownloadUpdate(msg);           │
│        break;                               │
│      // ... other actions                   │
│    }                                        │
│  };                                         │
│                                              │
└──────────────────┬──────────────────────────┘
                   │
                   │ Execute native operations
                   │
                   ▼
┌─────────────────────────────────────────────┐
│        Operating System / Network            │
├─────────────────────────────────────────────┤
│  - File system operations                    │
│  - HTTP downloads                            │
│  - ZIP extraction                            │
│  - Process management                        │
└─────────────────────────────────────────────┘
```

#### Message Protocol

**JavaScript → C#**:
```javascript
{
  "action": "download-update",
  "version": "1.2.0",
  "htmlPackageUrl": "https://...",
  "requestId": "uuid-12345"  // For response tracking
}
```

**C# → JavaScript**:
```javascript
{
  "type": "update-download-complete",
  "version": "1.2.0",
  "success": true,
  "requestId": "uuid-12345"
}
```

### 8.3 File System Structure

```
Production Environment
│
├── C:\Program Files\WMSWebView\
│   ├── WMSWebView.exe                      (Main executable)
│   ├── WebView2Loader.dll                  (WebView2 runtime)
│   ├── DevExpress.*.dll                    (DevExpress libraries)
│   └── Newtonsoft.Json.dll                 (JSON library)
│
├── C:\Users\<Username>\AppData\Roaming\WMSWebView\
│   ├── config.json                         (User configuration)
│   ├── cache\                              (Cached HTML/JS files)
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── monitor-printing.js
│   │   ├── printer-management-new.js
│   │   ├── update-manager.js
│   │   ├── styles.css
│   │   └── version.json
│   └── cache.backup\                       (Backup before update)
│       └── (previous version files)
│
├── C:\Users\<Username>\AppData\Local\WMSWebView\
│   └── EBWebView\                          (WebView2 user data)
│       ├── Default\
│       │   ├── Cache\
│       │   ├── Code Cache\
│       │   └── Local Storage\
│       └── ...
│
└── C:\fusion\                              (PDF storage)
    ├── 2025-11-07\
    │   ├── 1001\
    │   │   ├── ORDER001.pdf
    │   │   ├── ORDER002.pdf
    │   │   └── ...
    │   └── 1002\
    │       └── ...
    └── ...
```

### 8.4 Cache Management Strategy

#### Cache Folder Lifecycle

```
First Run
  ↓
Check: Does %APPDATA%\WMSWebView\cache exist?
  No → Download HTML package from GitHub Release
       Extract to cache folder
       Load files
  Yes → Continue
  ↓
Check: Is version.json current?
  Compare with latest-release.json
  ↓
  If outdated → Download new version
                Extract to temp folder
                On next restart: Replace cache
  If current → Load from cache
  ↓
Apply cache buster to prevent browser caching
  Load: index.html?v=1731000000000
        app.js?v=1731000000000
        etc.
```

#### Cache Invalidation

**Automatic Invalidation**:
- New version downloaded
- App restart after update

**Manual Invalidation**:
- User clicks "Check for Updates Now"
- Developer mode: Clear cache button

**Browser Cache Prevention**:
```javascript
// Query parameter cache buster
const cacheBuster = Date.now();
const scriptUrl = `app.js?v=${cacheBuster}`;

// OR use version number
const version = '1.2.0'.replace(/\./g, '');
const scriptUrl = `app.js?v=${version}`; // app.js?v=120
```

### 8.5 Error Handling

#### Download Errors

```javascript
try {
  // Attempt download
  await downloadUpdate(url);
} catch (error) {
  if (error.message.includes('network')) {
    // Network error
    showError('Unable to reach update server. Check internet connection.');
  } else if (error.message.includes('404')) {
    // Package not found
    showError('Update package not found. Please try again later.');
  } else {
    // Generic error
    showError('Update failed: ' + error.message);
  }

  // Log to console for debugging
  console.error('[Update] Download failed:', error);

  // Restore backup if update was in progress
  restoreCacheBackup();
}
```

#### Extraction Errors

```csharp
try {
    ZipFile.ExtractToDirectory(zipPath, extractPath);
}
catch (InvalidDataException ex) {
    // Corrupted ZIP file
    MessageBox.Show(
        "Update package is corrupted. Please try downloading again.",
        "Update Error",
        MessageBoxButtons.OK,
        MessageBoxIcon.Error
    );

    // Delete corrupted file
    File.Delete(zipPath);
}
catch (UnauthorizedAccessException ex) {
    // Permission denied
    MessageBox.Show(
        "Unable to extract update. Please run as administrator.",
        "Permission Error",
        MessageBoxButtons.OK,
        MessageBoxIcon.Error
    );
}
```

#### Version Mismatch Errors

```javascript
// Verify downloaded version matches expected
const downloadedVersion = await readVersionFromZip(zipPath);
const expectedVersion = latestReleaseInfo.version;

if (downloadedVersion !== expectedVersion) {
  throw new Error(
    `Version mismatch: expected ${expectedVersion}, got ${downloadedVersion}`
  );
}
```

### 8.6 Performance Considerations

#### Lazy Loading

```javascript
// Load heavy components only when needed
document.querySelector('[data-page="monitor-printing"]')
  .addEventListener('click', async () => {
    if (!window.monitorPrintingLoaded) {
      await loadMonitorPrintingModule();
      window.monitorPrintingLoaded = true;
    }
  });
```

#### Debouncing Update Checks

```javascript
let updateCheckDebounce = null;

function scheduleUpdateCheck() {
  clearTimeout(updateCheckDebounce);
  updateCheckDebounce = setTimeout(() => {
    checkForUpdates();
  }, 5000); // Wait 5 seconds before checking
}
```

#### Parallel Downloads

```javascript
// Download multiple files in parallel
const downloads = [
  downloadFile('index.html'),
  downloadFile('app.js'),
  downloadFile('styles.css')
];

const results = await Promise.all(downloads);
```

#### Compression

- HTML package is compressed as ZIP (reduces size by ~70%)
- GitHub serves files with gzip compression
- WebView2 automatically handles decompression

---

## 9. Security Considerations

### 9.1 Update Integrity

#### HTTPS Enforcement

```javascript
// Ensure all update URLs use HTTPS
function validateUpdateUrl(url) {
  if (!url.startsWith('https://')) {
    throw new Error('Update URLs must use HTTPS');
  }
  return true;
}
```

#### GitHub as Trusted Source

- All updates served from github.com
- GitHub's infrastructure provides:
  - DDoS protection
  - SSL/TLS encryption
  - CDN distribution
  - High availability

### 9.2 Code Signing (Future)

**Current State**: No code signing implemented

**Recommended Enhancement**:
```csharp
// Verify digital signature of downloaded EXE
bool VerifySignature(string exePath) {
    X509Certificate cert = X509Certificate
        .CreateFromSignedFile(exePath);

    // Verify certificate is from trusted publisher
    return cert.Subject.Contains("CN=YourCompany");
}
```

### 9.3 Access Control

#### File System Permissions

```csharp
// Ensure cache folder has appropriate permissions
DirectoryInfo cacheDir = new DirectoryInfo(cachePath);
DirectorySecurity security = cacheDir.GetAccessControl();

// Only current user can write
security.AddAccessRule(new FileSystemAccessRule(
    WindowsIdentity.GetCurrent().Name,
    FileSystemRights.Write,
    AccessControlType.Allow
));

cacheDir.SetAccessControl(security);
```

#### Update Source Validation

```javascript
// Only accept updates from approved domains
const APPROVED_DOMAINS = [
  'github.com',
  'raw.githubusercontent.com'
];

function isApprovedSource(url) {
  const domain = new URL(url).hostname;
  return APPROVED_DOMAINS.includes(domain);
}
```

### 9.4 User Data Protection

#### Configuration Security

```json
// Sensitive data should NOT be in config.json
// Use Windows Credential Manager for passwords
{
  "APEX_BASE_URL": "https://apex-server.com",
  "APEX_USER": "warehouse_user",
  // ❌ NEVER store password in plain text
  "APEX_PASSWORD": "DO NOT DO THIS"
}
```

**Recommended Approach**:
```csharp
// Store credentials securely
using System.Security.Cryptography;

// Encrypt password
string encrypted = ProtectedData.Protect(
    Encoding.UTF8.GetBytes(password),
    null,
    DataProtectionScope.CurrentUser
);

// Decrypt when needed
string decrypted = Encoding.UTF8.GetString(
    ProtectedData.Unprotect(
        Convert.FromBase64String(encrypted),
        null,
        DataProtectionScope.CurrentUser
    )
);
```

---

## 10. Deployment Strategy

### 10.1 Initial Deployment

#### Step 1: Prepare Release Package

1. Build C# application in Release mode
2. Include all dependencies (DLLs)
3. Create installer (MSI or setup.exe)
4. Include initial HTML files in installer

#### Step 2: Create Installer

**Option A: Visual Studio Installer Project**
```
WMSWebView Setup Project
├── Program Files Folder
│   ├── WMSWebView.exe
│   ├── WebView2Loader.dll
│   └── (other DLLs)
├── Application Data Folder
│   ├── config.json (template)
│   └── cache\
│       ├── index.html
│       ├── app.js
│       └── (other HTML/JS files)
└── Desktop Shortcut
```

**Option B: Inno Setup Script**
```pascal
[Setup]
AppName=WMS WebView
AppVersion=1.0.0
DefaultDirName={pf}\WMSWebView
OutputDir=releases
OutputBaseFilename=WMSWebView-Setup-1.0.0

[Files]
Source: "bin\Release\WMSWebView.exe"; DestDir: "{app}"
Source: "bin\Release\*.dll"; DestDir: "{app}"
Source: "html\*"; DestDir: "{userappdata}\WMSWebView\cache"
Source: "config.json"; DestDir: "{userappdata}\WMSWebView"

[Icons]
Name: "{commondesktop}\WMS WebView"; Filename: "{app}\WMSWebView.exe"
```

#### Step 3: Distribute Installer

1. Upload installer to GitHub Releases
2. Or deploy to network share
3. IT department installs on user machines

### 10.2 Update Deployment

#### HTML/JS Updates (Frequent)

```bash
# Developer makes changes
git add .
git commit -m "✨ NEW: Enhanced print options"
git push

# Create release
./release.ps1
# Suggested version: 1.3.0
# Confirm: Yes

# Users automatically notified within 60 minutes
# Download and apply on next restart
```

**Timeline**:
- Commit to production: **Immediate**
- Release creation: **2-3 minutes**
- User notification: **Within 60 minutes**
- Update applied: **Next app restart** (~5 seconds)

**Total time from code to users**: **~1 hour**

#### EXE Updates (Rare)

When C# code changes are needed:

```bash
# Build new EXE
msbuild /p:Configuration=Release

# Manually upload to GitHub Release
gh release upload v1.3.0 bin/Release/WMSWebView.exe

# Update latest-release.json
{
  "version": "1.3.0",
  "exe_url": "https://github.com/.../WMSWebView.exe",
  "exe_version": "1.3.0"
}
```

**User Experience**:
1. Notification: "New application version available"
2. Click "Download"
3. EXE downloads to Downloads folder
4. Prompt: "Close app and run installer?"
5. User runs installer
6. App restarts with new version

### 10.3 Rollback Strategy

#### Automatic Rollback

If update fails during extraction:
```csharp
try {
    // Extract new version
    ExtractUpdate(zipPath, cacheFolder);
}
catch (Exception ex) {
    // Restore backup
    if (Directory.Exists(backupFolder)) {
        Directory.Move(backupFolder, cacheFolder);
    }

    MessageBox.Show(
        "Update failed. Previous version restored.",
        "Update Error"
    );
}
```

#### Manual Rollback

**Option 1: Re-download previous version**
```javascript
// Allow user to select version
const versions = [
  { version: '1.2.0', url: '...' },
  { version: '1.1.0', url: '...' },
  { version: '1.0.0', url: '...' }
];

function rollbackToVersion(version) {
  downloadAndInstallVersion(version);
}
```

**Option 2: Keep backup folder**
```csharp
// Keep last 3 versions
string[] backups = new[] {
    cacheFolder + ".backup",
    cacheFolder + ".backup2",
    cacheFolder + ".backup3"
};

// Rotate backups
File.Move(backups[2], backups[3]); // Delete oldest
File.Move(backups[1], backups[2]);
File.Move(backups[0], backups[1]);
File.Move(cacheFolder, backups[0]); // New backup
```

### 10.4 Gradual Rollout (Advanced)

For large deployments, roll out updates gradually:

```javascript
// Feature flag: percentage of users to receive update
const ROLLOUT_PERCENTAGE = 50; // 50% of users

function shouldReceiveUpdate() {
  // Hash user ID to get consistent result
  const userId = getCurrentUserId();
  const hash = hashCode(userId);
  const bucket = Math.abs(hash) % 100;

  return bucket < ROLLOUT_PERCENTAGE;
}

async function checkForUpdates() {
  if (!shouldReceiveUpdate()) {
    console.log('[Update] Not in rollout group yet');
    return;
  }

  // Normal update check
  await checkForUpdatesInternal();
}
```

**Rollout Schedule**:
- Day 1: 10% of users (canary)
- Day 2: 25% of users
- Day 3: 50% of users
- Day 4: 100% of users

---

## 11. Troubleshooting Guide

### 11.1 Common Issues

#### Issue: Updates Not Downloading

**Symptoms**:
- "Check for Updates" shows "Up to date" but older version
- No update notification appears
- Console shows fetch errors

**Diagnosis**:
```javascript
// Check in browser console (F12)
console.log('Current version:', updateConfig.currentVersion);
console.log('Release API:', updateConfig.githubReleaseAPI);

// Manually fetch release info
fetch(updateConfig.githubReleaseAPI)
  .then(r => r.json())
  .then(data => console.log('Latest release:', data))
  .catch(err => console.error('Fetch error:', err));
```

**Solutions**:
1. **Check internet connection**
   ```bash
   ping github.com
   curl https://raw.githubusercontent.com/.../latest-release.json
   ```

2. **Verify GitHub URL in config.json**
   ```json
   {
     "GITHUB_RELEASE_API": "https://raw.githubusercontent.com/javeedin/graysWMSwebviewnew/main/latest-release.json"
   }
   ```

3. **Check firewall/proxy settings**
   - Add github.com to allowed domains
   - Configure proxy if needed

4. **Clear browser cache**
   ```javascript
   // In DevTools console
   caches.keys().then(keys => {
     keys.forEach(key => caches.delete(key));
   });
   location.reload();
   ```

#### Issue: Update Downloaded But Not Applied

**Symptoms**:
- "Update downloaded successfully" message appears
- After restart, still shows old version
- Files in cache folder are old

**Diagnosis**:
```csharp
// Check cache folder contents
string cacheFolder = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "WMSWebView",
    "cache"
);

Console.WriteLine("Cache folder: " + cacheFolder);
Console.WriteLine("Files:");
foreach (var file in Directory.GetFiles(cacheFolder)) {
    var info = new FileInfo(file);
    Console.WriteLine($"  {info.Name} - {info.LastWriteTime}");
}
```

**Solutions**:
1. **Check file permissions**
   - Ensure user has write access to AppData folder
   - Run app as administrator (temporary test)

2. **Manually delete cache**
   ```bash
   # Close application first
   rmdir /s "%APPDATA%\WMSWebView\cache"
   # Restart application (will re-download)
   ```

3. **Check for file locks**
   ```powershell
   # Find processes using cache files
   Get-Process | Where-Object {
     $_.Modules | Where-Object {
       $_.FileName -like "*WMSWebView\cache*"
     }
   }
   ```

#### Issue: "gh: command not found"

**Symptoms**:
- Release tool fails with "gh not recognized"
- Can't create GitHub Releases

**Solutions**:
1. **Install GitHub CLI**
   ```powershell
   winget install --id GitHub.cli
   ```

2. **Restart PowerShell**
   ```powershell
   # Close and reopen terminal
   gh --version  # Verify installation
   ```

3. **Use Personal Access Token instead**
   ```powershell
   $env:GITHUB_TOKEN = "ghp_YOUR_TOKEN"
   ./release.ps1
   ```

#### Issue: Version Numbers Not Incrementing

**Symptoms**:
- Release tool always suggests same version
- latest-release.json not updating

**Diagnosis**:
```powershell
# Check current version
Get-Content latest-release.json | ConvertFrom-Json | Select-Object version

# Check git tags
git tag --list
```

**Solutions**:
1. **Manually update latest-release.json**
   ```json
   {
     "version": "1.2.0",  // Update this
     ...
   }
   ```

2. **Run release tool with specific version**
   ```powershell
   ./release.ps1 -Version "1.3.0"
   ```

### 11.2 Debug Mode

Enable verbose logging:

```javascript
// In update-manager.js
const DEBUG_MODE = true;

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[Update Debug]', ...args);
  }
}

// Use throughout code
debugLog('Checking for updates...');
debugLog('Current version:', updateConfig.currentVersion);
debugLog('Fetch URL:', updateConfig.githubReleaseAPI);
```

### 11.3 Support Tools

#### Version Information Tool

```javascript
// Add to Settings page
function showVersionInfo() {
  const info = {
    currentVersion: updateConfig.currentVersion,
    buildDate: document.getElementById('build-date-display').textContent,
    cacheFolder: '%APPDATA%\\WMSWebView\\cache',
    lastUpdateCheck: localStorage.getItem('last-update-check-time'),
    githubAPI: updateConfig.githubReleaseAPI
  };

  alert(JSON.stringify(info, null, 2));
}
```

#### Cache Inspector

```javascript
// Show cached files and timestamps
async function inspectCache() {
  const files = [
    'index.html',
    'app.js',
    'monitor-printing.js',
    'update-manager.js',
    'version.json'
  ];

  for (const file of files) {
    const response = await fetch(file);
    const lastModified = response.headers.get('Last-Modified');
    console.log(`${file}: ${lastModified}`);
  }
}
```

---

## 12. Future Enhancements

### 12.1 Planned Improvements

#### 1. Delta Updates

**Current**: Download entire HTML package (~2MB)
**Future**: Download only changed files (~500KB)

```javascript
// Compare file hashes
const currentFiles = await loadVersionJson();
const remoteFiles = await fetchRemoteVersionJson();

const changedFiles = [];
for (const [file, hash] of Object.entries(remoteFiles)) {
  if (currentFiles[file] !== hash) {
    changedFiles.push(file);
  }
}

// Download only changed files
await downloadFiles(changedFiles);
```

**Benefits**:
- 75% reduction in download size
- Faster updates
- Lower bandwidth usage

#### 2. Automatic EXE Updates

**Current**: User manually downloads and installs EXE
**Future**: Automatic download, install, and restart

```csharp
async Task AutoUpdateEXE(string exeUrl) {
    // Download new EXE
    string newExePath = Path.Combine(
        Path.GetTempPath(),
        "WMSWebView_Update.exe"
    );

    await DownloadFileAsync(exeUrl, newExePath);

    // Create update script
    string batchPath = Path.Combine(
        Path.GetTempPath(),
        "update.bat"
    );

    File.WriteAllText(batchPath, @"
        @echo off
        timeout /t 2 /nobreak > NUL
        copy /Y ""$newExePath"" ""$currentExePath""
        start """" ""$currentExePath""
        del ""%~f0""
    ");

    // Run update script and exit
    Process.Start(batchPath);
    Application.Exit();
}
```

#### 3. Beta Channel

**Current**: Single release channel
**Future**: Beta/Stable channels

```json
// config.json
{
  "UPDATE_CHANNEL": "stable",  // or "beta"
  "GITHUB_RELEASE_API_STABLE": "https://.../latest-release.json",
  "GITHUB_RELEASE_API_BETA": "https://.../latest-release-beta.json"
}
```

```javascript
// Fetch appropriate channel
const apiUrl = updateConfig.UPDATE_CHANNEL === 'beta'
  ? updateConfig.GITHUB_RELEASE_API_BETA
  : updateConfig.GITHUB_RELEASE_API_STABLE;
```

#### 4. Digital Signatures

**Current**: No signature verification
**Future**: Verify downloaded files are authentic

```csharp
bool VerifyPackageSignature(string zipPath) {
    // Calculate hash
    using (var sha256 = SHA256.Create()) {
        using (var stream = File.OpenRead(zipPath)) {
            byte[] hash = sha256.ComputeHash(stream);
            string hashString = BitConverter
                .ToString(hash)
                .Replace("-", "");

            // Compare with published hash
            string expectedHash = await FetchPackageHash(version);
            return hashString.Equals(
                expectedHash,
                StringComparison.OrdinalIgnoreCase
            );
        }
    }
}
```

#### 5. Update Scheduling

**Current**: Updates apply on next restart
**Future**: Schedule updates for off-hours

```javascript
// Settings page
const updateSchedule = {
  enabled: true,
  time: "22:00",  // 10 PM
  days: ["monday", "wednesday", "friday"]
};

// Check if current time matches schedule
function shouldApplyUpdate() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.toLocaleDateString('en-US', { weekday: 'lowercase' });

  const [scheduleHour] = updateSchedule.time.split(':').map(Number);

  return updateSchedule.enabled &&
         updateSchedule.days.includes(day) &&
         hour === scheduleHour;
}
```

#### 6. Offline Mode

**Current**: Requires internet for updates
**Future**: Work offline with cached version

```javascript
// Service Worker for offline support
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version if available
        if (response) {
          return response;
        }

        // Try network
        return fetch(event.request)
          .catch(() => {
            // Show offline page
            return caches.match('/offline.html');
          });
      })
  );
});
```

### 12.2 Integration Possibilities

#### 1. Azure DevOps Integration

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main

steps:
- task: PowerShell@2
  inputs:
    filePath: 'release.ps1'
    arguments: '-Version $(Build.BuildNumber) -Force'

- task: GitHubRelease@1
  inputs:
    gitHubConnection: 'GitHub'
    repositoryName: '$(Build.Repository.Name)'
    action: 'create'
    target: '$(Build.SourceVersion)'
    tagSource: 'userSpecifiedTag'
    tag: 'v$(Build.BuildNumber)'
    assets: 'releases/*.zip'
```

#### 2. Slack Notifications

```powershell
# In release.ps1, after successful release
function Send-SlackNotification($Version, $Changelog) {
    $payload = @{
        text = "🚀 New Release: v$Version"
        attachments = @(
            @{
                color = "good"
                text = $Changelog
                footer = "WMS WebView Release System"
            }
        )
    } | ConvertTo-Json -Depth 10

    Invoke-RestMethod `
        -Uri $env:SLACK_WEBHOOK_URL `
        -Method Post `
        -Body $payload `
        -ContentType 'application/json'
}
```

#### 3. Analytics Integration

```javascript
// Track update adoption
async function trackUpdateInstalled(version) {
  await fetch('https://analytics.company.com/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'update_installed',
      version: version,
      timestamp: new Date().toISOString(),
      userId: getCurrentUserId()
    })
  });
}
```

---

## Appendix A: Quick Reference

### Command Cheat Sheet

```bash
# Create release (interactive)
./release.ps1

# Create release with specific version
./release.ps1 -Version "1.2.0"

# Preview release without creating
./release.ps1 -DryRun

# Force release even without changes
./release.ps1 -Force

# Check GitHub CLI status
gh auth status

# List all releases
gh release list

# View specific release
gh release view v1.2.0

# Delete release (if needed)
gh release delete v1.2.0
```

### Configuration Quick Reference

**config.json**:
```json
{
  "APP_VERSION": "1.2.0",
  "GITHUB_RELEASE_API": "https://raw.githubusercontent.com/.../latest-release.json",
  "AUTO_UPDATE_HTML": true,
  "UPDATE_CHECK_INTERVAL_MINUTES": 60
}
```

**latest-release.json**:
```json
{
  "version": "1.2.0",
  "html_package_url": "https://github.com/.../wms-webview-html-1.2.0.zip",
  "changelog_url": "https://github.com/.../releases/tag/v1.2.0"
}
```

### File Locations

| File | Location | Purpose |
|------|----------|---------|
| WMSWebView.exe | C:\Program Files\WMSWebView\ | Main application |
| config.json | %APPDATA%\WMSWebView\ | User configuration |
| Cached HTML | %APPDATA%\WMSWebView\cache\ | Updated web files |
| PDFs | C:\fusion\ | Print job PDFs |
| Logs | %APPDATA%\WMSWebView\logs\ | Application logs |

---

## Appendix B: Glossary

**Cache Buster**: Query parameter added to URLs to force fresh download (e.g., `app.js?v=123`)

**CDN**: Content Delivery Network - distributed servers for fast file delivery

**EXE**: Executable file - the native Windows application

**GitHub CLI (gh)**: Command-line tool for interacting with GitHub

**HTML Package**: ZIP file containing HTML, CSS, and JavaScript files

**Progressive Desktop App**: Desktop app with web-based UI that updates like web apps

**Release**: Tagged version of software with changelog and downloadable files

**Semantic Versioning (SemVer)**: Version numbering scheme (MAJOR.MINOR.PATCH)

**WebView2**: Microsoft's Chromium-based web renderer for desktop apps

**ZIP**: Compressed archive file format

---

## Document History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-11-07 | Initial architecture document | Development Team |

---

**END OF DOCUMENT**

---

*This document describes the release management architecture for WMS WebView Application. For implementation details, see source code and inline comments.*
