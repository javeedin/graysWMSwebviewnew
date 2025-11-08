# ========================================

# WMS Auto-Versioning Distribution Builder

# ========================================

 

param(

    [ValidateSet('patch', 'minor', 'major')]

    [string]$VersionBump = 'patch',

    [switch]$SkipGitPush = $false

)

 

Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan

Write-Host "WMS Auto-Versioning Release Builder" -ForegroundColor Cyan

Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""

 

# Step 1: Read current version

Write-Host "[1/8] Reading current version..." -ForegroundColor Green

 

$versionFile = "version.json"

if (-not (Test-Path $versionFile)) {

    Write-Host "ERROR: version.json not found!" -ForegroundColor Red

    exit 1

}

 

$versionData = Get-Content $versionFile | ConvertFrom-Json

$currentVersion = $versionData.version

 

Write-Host "  Current version: $currentVersion" -ForegroundColor Yellow

 

# Step 2: Auto-increment version

Write-Host "[2/8] Auto-incrementing version ($VersionBump bump)..." -ForegroundColor Green

 

$versionParts = $currentVersion -split '\.'

$major = [int]$versionParts[0]

$minor = [int]$versionParts[1]

$patch = [int]$versionParts[2]

 

switch ($VersionBump) {

    'major' { $major++; $minor = 0; $patch = 0 }

    'minor' { $minor++; $patch = 0 }

    'patch' { $patch++ }

}

 

$newVersion = "$major.$minor.$patch"

Write-Host "  New version: $newVersion" -ForegroundColor Green

 

# Step 3: Create versioned distribution folder

Write-Host "[3/8] Creating distribution folder..." -ForegroundColor Green

 

$distFolderName = "Wms-dist-$newVersion"

$distPath = Join-Path $PSScriptRoot $distFolderName

 

if (Test-Path $distPath) {

    Write-Host "  Removing old folder: $distFolderName" -ForegroundColor Yellow

    Remove-Item -Path $distPath -Recurse -Force

}

 

New-Item -ItemType Directory -Path $distPath -Force | Out-Null

Write-Host "  Created: $distFolderName" -ForegroundColor Gray

 

# Step 4: Copy WMS files to distribution folder

Write-Host "[4/8] Copying WMS files..." -ForegroundColor Green

 

$filesToCopy = @(

    "index.html",

    "app.js",

    "monitor-printing.js",

    "printer-management-new.js",

    "distribution-manager.js",

    "update-manager.js",

    "styles.css",

    "config.js",

    "version.json",

    "latest-release.json"

)

 

$copiedCount = 0

foreach ($file in $filesToCopy) {

    if (Test-Path $file) {

        Copy-Item -Path $file -Destination $distPath -Force

        Write-Host "  OK $file" -ForegroundColor Gray

        $copiedCount++

    } else {

        Write-Host "  SKIP (not found): $file" -ForegroundColor Yellow

    }

}

 

Write-Host "  Copied $copiedCount files" -ForegroundColor Gray

 

# Step 5: Create ZIP file

Write-Host "[5/8] Creating ZIP file..." -ForegroundColor Green

 

$zipFileName = "wms-webview-html-$newVersion.zip"

$zipPath = Join-Path $PSScriptRoot $zipFileName

 

if (Test-Path $zipPath) {

    Remove-Item -Path $zipPath -Force

}

 

try {

    Compress-Archive -Path "$distPath\*" -DestinationPath $zipPath -CompressionLevel Optimal

    $zipSize = (Get-Item $zipPath).Length / 1MB

    Write-Host "  Created: $zipFileName" -ForegroundColor Gray

    Write-Host "  Size: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Gray

}

catch {

    Write-Host "  ERROR: Failed to create ZIP: $_" -ForegroundColor Red

    exit 1

}

 

# Step 6: Update version.json and latest-release.json

Write-Host "[6/8] Updating version files..." -ForegroundColor Green

 

$currentDate = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"

$buildDate = Get-Date -Format "yyyy-MM-dd"

 

$versionData.version = $newVersion

$versionData.build_date = $buildDate

 

foreach ($key in $versionData.files.PSObject.Properties.Name) {

    $versionData.files.$key = $currentDate

}

 

$versionData | ConvertTo-Json -Depth 10 | Set-Content -Path $versionFile

Write-Host "  OK Updated version.json" -ForegroundColor Gray

 

$releaseFile = "latest-release.json"

if (Test-Path $releaseFile) {

    $releaseData = Get-Content $releaseFile | ConvertFrom-Json

    $currentBranch = git rev-parse --abbrev-ref HEAD

    $releaseData.version = $newVersion

    $releaseData.release_date = $currentDate

    $releaseData.html_package_url = "https://github.com/javeedin/graysWMSwebviewnew/releases/download/v$newVersion/$zipFileName"

    $releaseData.changelog_url = "https://github.com/javeedin/graysWMSwebviewnew/releases/tag/v$newVersion"

    $releaseData | ConvertTo-Json -Depth 10 | Set-Content -Path $releaseFile

    Write-Host "  OK Updated latest-release.json" -ForegroundColor Gray

}

 

# Step 7: Git commit and push

Write-Host "[7/8] Committing to Git..." -ForegroundColor Green

 

try {

    git add version.json latest-release.json

    $commitMessage = "Release: WMS v$newVersion - Auto-generated distribution"

    git commit -m $commitMessage

    Write-Host "  OK Committed: $commitMessage" -ForegroundColor Gray

 

    if (-not $SkipGitPush) {

        $currentBranch = git rev-parse --abbrev-ref HEAD

        Write-Host "  Pushing to branch: $currentBranch" -ForegroundColor Yellow

        git push origin $currentBranch

        Write-Host "  OK Pushed to GitHub" -ForegroundColor Gray

    } else {

        Write-Host "  SKIP push (use without -SkipGitPush to auto-push)" -ForegroundColor Yellow

    }

}

catch {

    Write-Host "  WARNING Git operation failed: $_" -ForegroundColor Yellow

    Write-Host "  You may need to push manually" -ForegroundColor Yellow

}

 

# Step 8: Summary

Write-Host "[8/8] Summary" -ForegroundColor Green

Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan

Write-Host "SUCCESS! Release Created!" -ForegroundColor Green

Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""

Write-Host "Version:        $currentVersion -> $newVersion" -ForegroundColor White

Write-Host "Dist Folder:    $distFolderName" -ForegroundColor White

Write-Host "ZIP File:       $zipFileName" -ForegroundColor White

Write-Host "Files:          $copiedCount files copied" -ForegroundColor White

Write-Host ""

 

Write-Host "Next Steps:" -ForegroundColor Cyan

Write-Host ""

Write-Host "1. CREATE GITHUB RELEASE:" -ForegroundColor Yellow

Write-Host "   Go to: https://github.com/javeedin/graysWMSwebviewnew/releases/new" -ForegroundColor Gray

Write-Host "   - Tag: v$newVersion" -ForegroundColor Gray

Write-Host "   - Title: WMS WebView HTML Package v$newVersion" -ForegroundColor Gray

Write-Host "   - Upload: $zipFileName" -ForegroundColor Gray

Write-Host "   - Publish release" -ForegroundColor Gray

Write-Host ""

 

Write-Host "2. TEST THE UPDATE:" -ForegroundColor Yellow

Write-Host "   - Run the WMSApp.exe" -ForegroundColor Gray

Write-Host "   - Click Get New Version button" -ForegroundColor Gray

Write-Host "   - Should download v$newVersion" -ForegroundColor Gray

Write-Host ""

 

Write-Host "3. OPTIONAL - Test locally first:" -ForegroundColor Yellow

Write-Host "   - Copy $distFolderName contents to C:\fusion\fusionclientweb\wms\" -ForegroundColor Gray

Write-Host "   - Launch WMS to verify it works" -ForegroundColor Gray

Write-Host ""

 

Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""