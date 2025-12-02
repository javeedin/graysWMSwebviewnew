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

 

# Use current working directory instead of script root
# This ensures we always use the latest files from where the script is run
$workingDir = Get-Location
Write-Host "Working Directory: $workingDir" -ForegroundColor Yellow

# Step 1: Read current version

Write-Host "[1/8] Reading current version..." -ForegroundColor Green



$versionFile = Join-Path $workingDir "version.json"

if (-not (Test-Path $versionFile)) {

    Write-Host "ERROR: version.json not found at $versionFile!" -ForegroundColor Red

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

$distPath = Join-Path $workingDir $distFolderName

 

if (Test-Path $distPath) {

    Write-Host "  Removing old folder: $distFolderName" -ForegroundColor Yellow

    Remove-Item -Path $distPath -Recurse -Force

}

 

New-Item -ItemType Directory -Path $distPath -Force | Out-Null

Write-Host "  Created: $distFolderName" -ForegroundColor Gray

 

# Step 4: Copy WMS files to distribution folder

Write-Host "[4/8] Copying WMS files..." -ForegroundColor Green



$copiedCount = 0



# Copy all files from wms/ directory

$wmsPath = Join-Path $workingDir "wms"
Write-Host "  Source WMS folder: $wmsPath" -ForegroundColor Yellow

if (Test-Path $wmsPath) {

    $wmsFiles = Get-ChildItem -Path $wmsPath -File -Recurse



    foreach ($file in $wmsFiles) {

        # Get relative path from wms folder

        $relativePath = $file.FullName.Substring($wmsPath.Length + 1)

        $destPath = Join-Path $distPath $relativePath



        # Create subdirectories if needed

        $destDir = Split-Path $destPath -Parent

        if (-not (Test-Path $destDir)) {

            New-Item -ItemType Directory -Path $destDir -Force | Out-Null

        }



        Copy-Item -Path $file.FullName -Destination $destPath -Force

        Write-Host "  OK wms/$relativePath" -ForegroundColor Gray

        $copiedCount++

    }

} else {

    Write-Host "  ERROR: wms/ directory not found!" -ForegroundColor Red

    exit 1

}



# Copy root-level files

$rootFiles = @("version.json", "latest-release.json")

foreach ($file in $rootFiles) {

    $filePath = Join-Path $workingDir $file

    if (Test-Path $filePath) {

        Copy-Item -Path $filePath -Destination (Join-Path $distPath $file) -Force

        Write-Host "  OK $file" -ForegroundColor Gray

        $copiedCount++

    } else {

        Write-Host "  SKIP (not found): $file" -ForegroundColor Yellow

    }

}



Write-Host "  Copied $copiedCount files from wms/ and root" -ForegroundColor Gray

 

# Step 5: Create ZIP file

Write-Host "[5/8] Creating ZIP file..." -ForegroundColor Green



$zipFileName = "wms-webview-html-$newVersion.zip"

$zipPath = Join-Path $workingDir $zipFileName



if (Test-Path $zipPath) {

    Remove-Item -Path $zipPath -Force

}



# Add a small delay to ensure all file handles are released
Start-Sleep -Seconds 2

try {

    # Use .NET ZipFile class which is more robust than Compress-Archive
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    # Remove existing zip if it exists
    if (Test-Path $zipPath) {
        Remove-Item -Path $zipPath -Force
    }

    # Create ZIP using .NET
    [System.IO.Compression.ZipFile]::CreateFromDirectory($distPath, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

    $zipSize = (Get-Item $zipPath).Length / 1MB

    Write-Host "  Created: $zipFileName" -ForegroundColor Gray

    Write-Host "  Size: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Gray

}

catch {

    Write-Host "  ERROR: Failed to create ZIP: $_" -ForegroundColor Red
    Write-Host "  TIP: Close any Explorer windows or applications that might have files open" -ForegroundColor Yellow

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

 

$releaseFile = Join-Path $workingDir "latest-release.json"

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



# Step 6b: Update Form1.cs title with new version

Write-Host "[6b/8] Updating Form1.cs title..." -ForegroundColor Green

$form1Path = Join-Path $workingDir "Form1.cs"

if (Test-Path $form1Path) {

    $form1Content = Get-Content $form1Path -Raw

    $releaseDate = Get-Date -Format "dd-MMM-yyyy"

    # Pattern to match the this.Text line with version info
    $pattern = 'this\.Text\s*=\s*"Gray''s WMS v[\d\.]+ - [^"]*";'
    $newTitle = "this.Text = `"Gray's WMS v$newVersion - MRA Tabbed Popup | Released $releaseDate | ✓ GOOD VERSION`";"

    if ($form1Content -match $pattern) {
        $form1Content = $form1Content -replace $pattern, $newTitle
        Set-Content -Path $form1Path -Value $form1Content -NoNewline
        Write-Host "  OK Updated Form1.cs title to: Gray's WMS v$newVersion" -ForegroundColor Gray
    } else {
        Write-Host "  WARNING: Could not find title pattern in Form1.cs" -ForegroundColor Yellow
    }

} else {

    Write-Host "  SKIP Form1.cs not found" -ForegroundColor Yellow

}



# Step 7: Git commit and push

Write-Host "[7/8] Committing to Git..." -ForegroundColor Green

 

try {

    git add version.json latest-release.json Form1.cs

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