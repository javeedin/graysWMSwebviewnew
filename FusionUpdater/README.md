# FusionUpdater

Auto-updater tray application for Gray's WMS FusionClient desktop app.

## How It Works

1. Runs silently in the Windows system tray
2. Checks GitHub Releases every 4 hours (configurable)
3. When a new version is found → shows a tray notification
4. User clicks notification or right-clicks tray → "Install Update"
5. Confirmation dialog shown before installing
6. Downloads the release zip, closes FusionClient, extracts files, relaunches the app

## Setup (First Time)

1. Copy `FusionUpdater.exe` and `updater-config.json` next to your `FusionClient.exe`
   (e.g. `C:\fusion\FusionUpdater.exe`)
2. Launch `FusionUpdater.exe`
3. Right-click tray icon → **Settings**
4. Enter your **GitHub Token** (a PAT with `repo` read scope for private repos)
5. Confirm the install directory matches where FusionClient is installed
6. Click **Save**

### Getting a GitHub Token

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Give it a name like "FusionUpdater"
4. Check only: `repo` (read access is all that's needed)
5. Generate and copy the token into Settings

## Building

```bash
dotnet restore
dotnet build -c Release
dotnet publish -c Release -r win-x64 --self-contained true
```

Output: `bin\Release\net8.0-windows\win-x64\publish\FusionUpdater.exe`

## Publishing a New WMS Release

After running `.\package-release.bat` which creates `fusionclient.zip`:

```bash
# Tag the release
git tag v2.1.0
git push origin v2.1.0

# Create GitHub release and upload zip
# Via GitHub UI: Releases → Draft new release → attach fusionclient.zip
```

All users running FusionUpdater will be notified automatically within 4 hours.

## Config File (`updater-config.json`)

```json
{
  "GitHubToken": "ghp_your_token_here",
  "GitHubOwner": "javeedin",
  "GitHubRepo": "graysWMSwebviewnew",
  "InstallDirectory": "C:\\fusion",
  "AppExecutable": "FusionClient.exe",
  "CheckIntervalHours": 4
}
```
