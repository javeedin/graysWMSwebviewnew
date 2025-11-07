# Release Management Guide

## Overview

This document explains the **progressive desktop app** deployment model and release management system for the WMS WebView application.

## Architecture

### Two-Level Update System

The application supports **two types of updates**:

1. **HTML/JS Updates (Quick Updates)**
   - Updates to web content only (HTML, CSS, JavaScript)
   - No application restart required
   - Users get updates instantly
   - Lightweight (small file downloads)

2. **EXE Updates (Full Updates)**
   - Updates to the C# application executable
   - Requires download and restart
   - Includes new features in the native app
   - Larger file size

### File Structure

```
GitHub Repository
├── Development Branch (main/develop)
│   └── Your daily development work (NEVER touched by release tool)
│
└── GitHub Releases (Distribution)
    ├── latest-release.json          # Points to latest version
    ├── v1.1.0/
    │   ├── wms-webview-html-1.1.0.zip
    │   └── WMSWebView.exe
    ├── v1.2.0/
    │   ├── wms-webview-html-1.2.0.zip
    │   └── WMSWebView.exe
    └── ...

User's Machine
├── C:\Program Files\WMSWebView\
│   └── WMSWebView.exe                # Main application
│
└── %APPDATA%\WMSWebView\
    ├── cache\                        # Cached HTML/JS files
    │   ├── index.html
    │   ├── app.js
    │   ├── monitor-printing.js
    │   ├── styles.css
    │   └── version.json
    └── config.json                   # User configuration
```

## Release Management Tool

### Prerequisites

1. **PowerShell 7+** (for cross-platform support)
2. **GitHub CLI (gh)** installed and authenticated
   ```bash
   # Install GitHub CLI
   # Windows: winget install GitHub.cli
   # Mac: brew install gh
   # Linux: See https://github.com/cli/cli#installation

   # Authenticate
   gh auth login
   ```

3. **Git** configured with your repository
4. **Environment Variable** (optional):
   ```bash
   # Set GitHub token if not using gh CLI
   export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
   ```

### Running the Release Tool

#### Interactive Mode (Recommended)

Simply run the script without arguments for a guided experience:

```bash
./release.ps1
```

The tool will:
1. ✅ Analyze all commits since the last release
2. ✅ Categorize changes (breaking, features, fixes)
3. ✅ Suggest an appropriate version number
4. ✅ Show you a preview of the changelog
5. ✅ Ask for your confirmation
6. ✅ Create GitHub Release automatically
7. ✅ Upload HTML package
8. ✅ Update `latest-release.json`

#### Command-Line Options

```bash
# Use a specific version number
./release.ps1 -Version "1.2.0"

# Dry run (preview without creating release)
./release.ps1 -DryRun

# Force release even with no changes
./release.ps1 -Force

# Skip build steps
./release.ps1 -SkipBuild
```

### Example Release Workflow

```bash
$ ./release.ps1

╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║           WMS WebView - Release Management Tool               ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

==> Analyzing repository...
  Current version: 1.1.0
  Found 8 commits since last release

╔════════════════════════════════════════════════════════════════╗
║                    RELEASE PREVIEW                             ║
╚════════════════════════════════════════════════════════════════╝

📦 Current Version: 1.1.0
📦 Suggested Version: 1.2.0
📝 Reason: New features detected

📊 Change Summary:
   Total commits: 8
   Files changed: 15
   ✨ New features: 3
   🔧 Bug fixes: 2

📋 Changelog Preview:
────────────────────────────────────────────────────────────────
## ✨ New Features

- 🚀 NEW: APEX Integration + Print Queue System
- 📝 Added config files for progressive app deployment
- ✨ Added update checker and settings page

## 🔧 Bug Fixes

- 🔧 FIX: Removed local file check - use ONLY APEX status
- 🔧 FIX: PDF Preview now opens with default PDF viewer
────────────────────────────────────────────────────────────────

Enter version number (or press Enter to use suggested: 1.2.0):

✓ Version confirmed: 1.2.0

Is this a pre-release? (y/N): n

⚠️  Ready to create release v1.2.0
This will:
  1. Update version.json
  2. Create HTML package (zip)
  3. Create GitHub Release
  4. Update latest-release.json

Proceed? (Y/n): y

==> Creating HTML package...
✓ Created package: releases/wms-webview-html-1.2.0.zip

==> Creating GitHub Release v1.2.0...
✓ GitHub Release created: https://github.com/javeedin/graysWMSwebviewnew/releases/tag/v1.2.0

═══════════════════════════════════════════════════════════════
  Release v1.2.0 created successfully!
═══════════════════════════════════════════════════════════════

📦 Package: releases/wms-webview-html-1.2.0.zip
🔗 Release: https://github.com/javeedin/graysWMSwebviewnew/releases/tag/v1.2.0

✅ Users can now download this update from the application
```

## Version Numbering

The tool uses **Semantic Versioning** (MAJOR.MINOR.PATCH):

### Automatic Version Suggestion

The tool analyzes commit messages and suggests versions based on keywords:

| Change Type | Keywords | Version Bump | Example |
|------------|----------|--------------|---------|
| **Breaking Changes** | `breaking`, `major`, 🚨, ‼️ | MAJOR | 1.0.0 → **2.0.0** |
| **New Features** | `feat`, `feature`, `new`, `add`, 🚀, ✨ | MINOR | 1.0.0 → 1.**1**.0 |
| **Bug Fixes** | `fix`, `bug`, `patch`, 🔧, 🐛 | PATCH | 1.0.0 → 1.0.**1** |
| **Other Changes** | Any other commits | PATCH | 1.0.0 → 1.0.**1** |

### Best Practices for Commit Messages

Use conventional commit format with emojis:

```bash
# New Features
git commit -m "🚀 NEW: Print queue system with real-time monitoring"
git commit -m "✨ feat: Add APEX integration for status updates"

# Bug Fixes
git commit -m "🔧 FIX: PDF preview now uses default viewer"
git commit -m "🐛 fix: Resolved null status from APEX endpoint"

# Breaking Changes
git commit -m "🚨 BREAKING: Changed API response format"
git commit -m "‼️ major: Refactored database schema"

# Documentation
git commit -m "📝 docs: Added release management guide"

# Other
git commit -m "♻️ refactor: Cleaned up monitor printing code"
git commit -m "🎨 style: Improved UI layout"
```

## End-User Update Experience

### Automatic Updates

1. **Background Checks**: Application checks for updates every 60 minutes (configurable)
2. **Notification Banner**: When a new version is available, a banner appears at the top
3. **One-Click Update**: User clicks "Download Update" button
4. **Seamless Installation**: Files are downloaded and cached in AppData
5. **Next Restart**: Updated files are loaded automatically

### Manual Update Check

Users can manually check for updates:

1. Navigate to **Settings & Updates** page
2. Click **"Check for Updates Now"** button
3. View current version, build date, and update status
4. Download and install updates if available

### Update Settings

Users can configure:
- ✅ **Auto-download HTML updates** (default: ON)
- ✅ **Check for updates on startup** (default: ON)
- ⏱️ **Update check interval** (default: 60 minutes)

## Configuration Files

### version.json

Tracks the current version and file timestamps:

```json
{
  "version": "1.1.0",
  "build_date": "2025-11-07",
  "files": {
    "index.html": "2025-11-07T10:30:00Z",
    "app.js": "2025-11-07T10:30:00Z",
    "monitor-printing.js": "2025-11-07T10:30:00Z",
    "styles.css": "2025-11-07T10:30:00Z"
  },
  "changelog": "APEX Integration + Print Queue System"
}
```

### latest-release.json

Published on GitHub, points users to the latest release:

```json
{
  "version": "1.1.0",
  "release_date": "2025-11-07T10:30:00Z",
  "html_package_url": "https://github.com/javeedin/graysWMSwebviewnew/releases/download/v1.1.0/wms-webview-html-1.1.0.zip",
  "exe_url": "",
  "changelog_url": "https://github.com/javeedin/graysWMSwebviewnew/releases/tag/v1.1.0"
}
```

### config.json

Application configuration:

```json
{
  "APP_VERSION": "1.1.0",
  "HTML_SOURCE": "network",
  "NETWORK_PATH": "\\\\server\\WMS\\html",
  "APEX_BASE_URL": "https://your-apex-server.com/ords/workspace",
  "PDF_FOLDER": "C:\\fusion",
  "CHECK_UPDATES_ON_START": true,
  "FALLBACK_TO_LOCAL": false,
  "CACHE_BUSTER_ENABLED": true,
  "GITHUB_RELEASE_API": "https://raw.githubusercontent.com/javeedin/graysWMSwebviewnew/main/latest-release.json",
  "AUTO_UPDATE_HTML": true,
  "AUTO_UPDATE_EXE": false,
  "UPDATE_CHECK_INTERVAL_MINUTES": 60
}
```

## Troubleshooting

### Release Tool Issues

#### "GitHub CLI (gh) not found"

**Solution**: Install GitHub CLI
```bash
# Windows
winget install GitHub.cli

# Mac
brew install gh

# Linux
sudo apt install gh
```

#### "Not a git repository"

**Solution**: Make sure you're running the script from the repository root
```bash
cd /path/to/graysWMSwebviewnew
./release.ps1
```

#### "No changes detected since last release"

**Solution**: Either commit some changes or use `-Force` flag
```bash
./release.ps1 -Force
```

#### "Failed to create GitHub Release"

**Solution**: Check your authentication
```bash
gh auth status
gh auth login
```

### Update System Issues

#### Updates not downloading

1. Check internet connection
2. Verify `GITHUB_RELEASE_API` URL in config.json
3. Check browser console for errors (F12)
4. Ensure `latest-release.json` exists on GitHub

#### Updates downloaded but not applied

1. Restart the application
2. Check AppData cache folder: `%APPDATA%\WMSWebView\cache`
3. Clear cache and re-download

#### Update notification not appearing

1. Navigate to Settings & Updates page
2. Enable "Check for updates on startup"
3. Manually check for updates

## Security Considerations

1. **HTTPS Only**: All update downloads use HTTPS
2. **GitHub as CDN**: Leverages GitHub's security and reliability
3. **No Auto-Execution**: EXE updates require manual user action
4. **Version Verification**: Each update includes version metadata

## Future Enhancements

Potential improvements for the release system:

- [ ] Digital signature verification for EXE files
- [ ] Delta updates (only download changed files)
- [ ] Rollback mechanism for failed updates
- [ ] Beta/Alpha channel support
- [ ] Automatic EXE building and uploading
- [ ] Email notifications for release creators
- [ ] Slack/Teams webhook integration

## Support

For issues or questions:

1. Check this documentation
2. Review console logs (F12 in application)
3. Check GitHub Issues
4. Contact the development team

## License

This release management system is part of the WMS WebView application.

---

**Version**: 1.0
**Last Updated**: 2025-11-07
**Maintainer**: Development Team
