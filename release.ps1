#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Interactive Release Management Tool for WMS WebView App

.DESCRIPTION
    This script helps create new releases by:
    - Analyzing git changes since last release
    - Suggesting appropriate version numbers (MAJOR.MINOR.PATCH)
    - Generating changelog automatically
    - Creating GitHub Releases
    - Packaging HTML/JS files

.EXAMPLE
    .\release.ps1
#>

param(
    [switch]$Force,
    [string]$Version,
    [switch]$SkipBuild,
    [switch]$DryRun
)

# =============================================================================
# Configuration
# =============================================================================

$REPO_OWNER = "javeedin"
$REPO_NAME = "graysWMSwebviewnew"
$RELEASE_BRANCH = "releases"
$LATEST_RELEASE_FILE = "latest-release.json"

# File patterns for HTML package
$HTML_FILES = @(
    "index.html",
    "app.js",
    "monitor-printing.js",
    "styles.css",
    "version.json",
    "config.json"
)

# =============================================================================
# Helper Functions
# =============================================================================

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor Gray
}

# =============================================================================
# Git Operations
# =============================================================================

function Get-LastReleaseVersion {
    if (Test-Path $LATEST_RELEASE_FILE) {
        $content = Get-Content $LATEST_RELEASE_FILE -Raw | ConvertFrom-Json
        return $content.version
    }
    return "0.0.0"
}

function Get-LastReleaseTag {
    $lastVersion = Get-LastReleaseVersion
    if ($lastVersion -eq "0.0.0") {
        # Get first commit if no releases exist
        $firstCommit = git rev-list --max-parents=0 HEAD
        return $firstCommit
    }
    return "v$lastVersion"
}

function Get-GitChangesSinceLastRelease {
    $lastTag = Get-LastReleaseTag

    # Get all commits since last release
    $commits = git log "$lastTag..HEAD" --oneline --no-merges

    # Get file changes
    $files = git diff --name-only "$lastTag..HEAD"

    return @{
        Commits = $commits
        Files = $files -split "`n" | Where-Object { $_ }
        CommitCount = ($commits | Measure-Object -Line).Lines
    }
}

function Analyze-ChangeType {
    param($Changes)

    $analysis = @{
        HasBreakingChanges = $false
        HasNewFeatures = $false
        HasBugFixes = $false
        HasMinorChanges = $false
        BreakingChangesList = @()
        NewFeaturesList = @()
        BugFixesList = @()
        MinorChangesList = @()
    }

    foreach ($commit in $Changes.Commits) {
        $commitLower = $commit.ToLower()

        # Breaking changes (MAJOR version bump)
        if ($commitLower -match '(breaking|major|🚨|‼️)') {
            $analysis.HasBreakingChanges = $true
            $analysis.BreakingChangesList += $commit
        }
        # New features (MINOR version bump)
        elseif ($commitLower -match '(feat|feature|new|add|🚀|✨|📝)') {
            $analysis.HasNewFeatures = $true
            $analysis.NewFeaturesList += $commit
        }
        # Bug fixes (PATCH version bump)
        elseif ($commitLower -match '(fix|bug|patch|🔧|🐛)') {
            $analysis.HasBugFixes = $true
            $analysis.BugFixesList += $commit
        }
        # Minor changes
        else {
            $analysis.HasMinorChanges = $true
            $analysis.MinorChangesList += $commit
        }
    }

    return $analysis
}

function Suggest-NextVersion {
    param($CurrentVersion, $Analysis)

    $parts = $CurrentVersion -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    if ($Analysis.HasBreakingChanges) {
        # MAJOR version bump
        $major++
        $minor = 0
        $patch = 0
        $reason = "Breaking changes detected"
    }
    elseif ($Analysis.HasNewFeatures) {
        # MINOR version bump
        $minor++
        $patch = 0
        $reason = "New features detected"
    }
    elseif ($Analysis.HasBugFixes -or $Analysis.HasMinorChanges) {
        # PATCH version bump
        $patch++
        $reason = "Bug fixes or minor changes detected"
    }
    else {
        $patch++
        $reason = "No changes detected, incrementing patch"
    }

    return @{
        Version = "$major.$minor.$patch"
        Reason = $reason
    }
}

function Generate-Changelog {
    param($Analysis)

    $changelog = @()

    if ($Analysis.HasBreakingChanges) {
        $changelog += "## 🚨 Breaking Changes"
        $changelog += ""
        foreach ($item in $Analysis.BreakingChangesList) {
            $changelog += "- $item"
        }
        $changelog += ""
    }

    if ($Analysis.HasNewFeatures) {
        $changelog += "## ✨ New Features"
        $changelog += ""
        foreach ($item in $Analysis.NewFeaturesList) {
            $changelog += "- $item"
        }
        $changelog += ""
    }

    if ($Analysis.HasBugFixes) {
        $changelog += "## 🔧 Bug Fixes"
        $changelog += ""
        foreach ($item in $Analysis.BugFixesList) {
            $changelog += "- $item"
        }
        $changelog += ""
    }

    if ($Analysis.HasMinorChanges) {
        $changelog += "## 📝 Other Changes"
        $changelog += ""
        foreach ($item in $Analysis.MinorChangesList) {
            $changelog += "- $item"
        }
        $changelog += ""
    }

    return $changelog -join "`n"
}

# =============================================================================
# Build and Package
# =============================================================================

function Update-VersionJson {
    param($Version)

    $versionData = @{
        version = $Version
        build_date = (Get-Date).ToString("yyyy-MM-dd")
        files = @{}
        changelog = ""
    }

    # Get file timestamps
    foreach ($file in $HTML_FILES) {
        if (Test-Path $file) {
            $timestamp = (Get-Item $file).LastWriteTimeUtc.ToString("yyyy-MM-ddTHH:mm:ssZ")
            $versionData.files[$file] = $timestamp
        }
    }

    $versionData | ConvertTo-Json -Depth 10 | Set-Content "version.json" -Encoding UTF8
    Write-Success "Updated version.json to $Version"
}

function Create-HtmlPackage {
    param($Version, $OutputDir)

    Write-Step "Creating HTML package..."

    $packageName = "wms-webview-html-$Version.zip"
    $packagePath = Join-Path $OutputDir $packageName

    # Remove old package if exists
    if (Test-Path $packagePath) {
        Remove-Item $packagePath -Force
    }

    # Create zip with HTML files
    Compress-Archive -Path $HTML_FILES -DestinationPath $packagePath -Force

    Write-Success "Created package: $packagePath"
    return $packagePath
}

function Update-LatestReleaseJson {
    param($Version, $HtmlPackageUrl, $ExeUrl)

    $releaseData = @{
        version = $Version
        release_date = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
        html_package_url = $HtmlPackageUrl
        exe_url = $ExeUrl
        changelog_url = "https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/v$Version"
    }

    $releaseData | ConvertTo-Json -Depth 10 | Set-Content $LATEST_RELEASE_FILE -Encoding UTF8
    Write-Success "Updated $LATEST_RELEASE_FILE"
}

# =============================================================================
# GitHub Release
# =============================================================================

function Test-GitHubToken {
    if (-not $env:GITHUB_TOKEN) {
        Write-Error "GITHUB_TOKEN environment variable not set"
        Write-Info "Please set GITHUB_TOKEN with a personal access token that has 'repo' permissions"
        Write-Info "Example: `$env:GITHUB_TOKEN = 'ghp_xxxxxxxxxxxx'"
        return $false
    }
    return $true
}

function Create-GitHubRelease {
    param(
        $Version,
        $Changelog,
        $PackagePath,
        [switch]$PreRelease
    )

    Write-Step "Creating GitHub Release v$Version..."

    if (-not (Test-GitHubToken)) {
        return $false
    }

    $tag = "v$Version"
    $releaseName = "WMS WebView $Version"

    # Create release using GitHub CLI (gh)
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        Write-Info "Using GitHub CLI..."

        $changelogFile = "CHANGELOG_TEMP.md"
        $Changelog | Set-Content $changelogFile

        try {
            if ($PreRelease) {
                gh release create $tag --title $releaseName --notes-file $changelogFile --prerelease
            } else {
                gh release create $tag --title $releaseName --notes-file $changelogFile
            }

            # Upload package
            gh release upload $tag $PackagePath

            Write-Success "GitHub Release created: https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/$tag"
            return $true
        }
        catch {
            Write-Error "Failed to create GitHub Release: $_"
            return $false
        }
        finally {
            Remove-Item $changelogFile -ErrorAction SilentlyContinue
        }
    }
    else {
        Write-Warning "GitHub CLI (gh) not found. Install it from: https://cli.github.com/"
        Write-Info "Or manually create release at: https://github.com/$REPO_OWNER/$REPO_NAME/releases/new"
        Write-Info "Tag: $tag"
        Write-Info "Package: $PackagePath"
        return $false
    }
}

# =============================================================================
# Interactive Workflow
# =============================================================================

function Show-ReleasePreview {
    param($CurrentVersion, $SuggestedVersion, $Analysis, $Changelog, $Changes)

    Write-Host "`n╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║                    RELEASE PREVIEW                             ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

    Write-Host "`n📦 Current Version: " -NoNewline
    Write-Host $CurrentVersion -ForegroundColor Yellow

    Write-Host "📦 Suggested Version: " -NoNewline
    Write-Host $SuggestedVersion.Version -ForegroundColor Green

    Write-Host "📝 Reason: " -NoNewline
    Write-Host $SuggestedVersion.Reason -ForegroundColor Gray

    Write-Host "`n📊 Change Summary:"
    Write-Host "   Total commits: $($Changes.CommitCount)" -ForegroundColor Gray
    Write-Host "   Files changed: $($Changes.Files.Count)" -ForegroundColor Gray

    if ($Analysis.HasBreakingChanges) {
        Write-Host "   🚨 Breaking changes: $($Analysis.BreakingChangesList.Count)" -ForegroundColor Red
    }
    if ($Analysis.HasNewFeatures) {
        Write-Host "   ✨ New features: $($Analysis.NewFeaturesList.Count)" -ForegroundColor Green
    }
    if ($Analysis.HasBugFixes) {
        Write-Host "   🔧 Bug fixes: $($Analysis.BugFixesList.Count)" -ForegroundColor Yellow
    }

    Write-Host "`n📋 Changelog Preview:"
    Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host $Changelog
    Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
}

function Start-InteractiveRelease {
    Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║           WMS WebView - Release Management Tool               ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

    # Check if we're in a git repo
    if (-not (Test-Path ".git")) {
        Write-Error "Not a git repository"
        exit 1
    }

    # Get current version
    Write-Step "Analyzing repository..."
    $currentVersion = Get-LastReleaseVersion
    Write-Info "Current version: $currentVersion"

    # Get changes since last release
    $changes = Get-GitChangesSinceLastRelease

    if ($changes.CommitCount -eq 0 -and -not $Force) {
        Write-Warning "No changes detected since last release"
        Write-Info "Use -Force to create a release anyway"
        exit 0
    }

    Write-Info "Found $($changes.CommitCount) commits since last release"

    # Analyze changes
    $analysis = Analyze-ChangeType -Changes $changes

    # Suggest version
    $suggestedVersion = Suggest-NextVersion -CurrentVersion $currentVersion -Analysis $analysis

    # Generate changelog
    $changelog = Generate-Changelog -Analysis $analysis

    # Show preview
    Show-ReleasePreview -CurrentVersion $currentVersion -SuggestedVersion $suggestedVersion `
                        -Analysis $analysis -Changelog $changelog -Changes $changes

    # Get version confirmation
    Write-Host "`n"
    if ($Version) {
        $newVersion = $Version
        Write-Info "Using provided version: $newVersion"
    } else {
        $response = Read-Host "Enter version number (or press Enter to use suggested: $($suggestedVersion.Version))"
        if ([string]::IsNullOrWhiteSpace($response)) {
            $newVersion = $suggestedVersion.Version
        } else {
            $newVersion = $response
        }
    }

    # Validate version format
    if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
        Write-Error "Invalid version format. Use MAJOR.MINOR.PATCH (e.g., 1.2.3)"
        exit 1
    }

    Write-Host "`n✓ Version confirmed: " -NoNewline -ForegroundColor Green
    Write-Host $newVersion -ForegroundColor Yellow

    # Ask for release type
    Write-Host "`nIs this a pre-release? (y/N): " -NoNewline
    $preReleaseResponse = Read-Host
    $isPreRelease = $preReleaseResponse -eq 'y' -or $preReleaseResponse -eq 'Y'

    # Confirm release
    if (-not $DryRun) {
        Write-Host "`n⚠️  Ready to create release v$newVersion" -ForegroundColor Yellow
        Write-Host "This will:"
        Write-Host "  1. Update version.json"
        Write-Host "  2. Create HTML package (zip)"
        Write-Host "  3. Create GitHub Release"
        Write-Host "  4. Update latest-release.json"
        Write-Host "`nProceed? (Y/n): " -NoNewline
        $confirm = Read-Host
        if ($confirm -eq 'n' -or $confirm -eq 'N') {
            Write-Warning "Release cancelled"
            exit 0
        }
    }

    # Create output directory
    $outputDir = "releases"
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir | Out-Null
    }

    # Update version.json
    if (-not $DryRun) {
        Update-VersionJson -Version $newVersion
    } else {
        Write-Info "[DRY RUN] Would update version.json to $newVersion"
    }

    # Create HTML package
    if (-not $DryRun) {
        $packagePath = Create-HtmlPackage -Version $newVersion -OutputDir $outputDir
    } else {
        Write-Info "[DRY RUN] Would create HTML package"
        $packagePath = "releases/wms-webview-html-$newVersion.zip"
    }

    # Create GitHub Release
    if (-not $DryRun) {
        $releaseCreated = Create-GitHubRelease -Version $newVersion -Changelog $changelog `
                                               -PackagePath $packagePath -PreRelease:$isPreRelease

        if ($releaseCreated) {
            # Update latest-release.json
            $htmlUrl = "https://github.com/$REPO_OWNER/$REPO_NAME/releases/download/v$newVersion/wms-webview-html-$newVersion.zip"
            $exeUrl = ""  # Will be added manually or in future automation

            Update-LatestReleaseJson -Version $newVersion -HtmlPackageUrl $htmlUrl -ExeUrl $exeUrl

            Write-Host "`n"
            Write-Success "═══════════════════════════════════════════════════════════════"
            Write-Success "  Release v$newVersion created successfully!"
            Write-Success "═══════════════════════════════════════════════════════════════"
            Write-Host "`n📦 Package: $packagePath" -ForegroundColor Gray
            Write-Host "🔗 Release: https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/v$newVersion" -ForegroundColor Gray
            Write-Host "`n✅ Users can now download this update from the application" -ForegroundColor Green
        }
    } else {
        Write-Info "[DRY RUN] Would create GitHub Release"
    }
}

# =============================================================================
# Main
# =============================================================================

Start-InteractiveRelease
