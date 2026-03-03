# PowerShell script to create distribution folder for Gray's WMS WebView Application
# This script builds the project and copies all necessary files to a dist folder

param(
    [string]$Configuration = "Release",
    [string]$OutputFolder = "dist",
    [switch]$CreateZip = $false
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Gray's WMS Distribution Builder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get the script directory (project root)
$ProjectRoot = $PSScriptRoot
$DistPath = Join-Path $ProjectRoot $OutputFolder
$BuildPath = Join-Path $ProjectRoot "bin\$Configuration\net8.0-windows"

Write-Host "Configuration: $Configuration" -ForegroundColor Yellow
Write-Host "Project Root: $ProjectRoot" -ForegroundColor Yellow
Write-Host "Output Folder: $DistPath" -ForegroundColor Yellow
Write-Host ""

# Step 1: Clean previous distribution folder
if (Test-Path $DistPath) {
    Write-Host "Cleaning previous distribution folder..." -ForegroundColor Yellow
    Remove-Item -Path $DistPath -Recurse -Force
}

# Create distribution folder
Write-Host "Creating distribution folder..." -ForegroundColor Green
New-Item -ItemType Directory -Path $DistPath -Force | Out-Null

# Step 2: Build the project
Write-Host ""
Write-Host "Building project..." -ForegroundColor Green
Write-Host "Running: dotnet build -c $Configuration" -ForegroundColor Gray

try {
    $buildOutput = dotnet build -c $Configuration 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        Write-Host $buildOutput
        exit 1
    }
    Write-Host "Build completed successfully!" -ForegroundColor Green
}
catch {
    Write-Host "Build error: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Copy build output
Write-Host ""
Write-Host "Copying application files..." -ForegroundColor Green

if (-not (Test-Path $BuildPath)) {
    Write-Host "Build output path not found: $BuildPath" -ForegroundColor Red
    exit 1
}

# Copy all files from build output
Copy-Item -Path "$BuildPath\*" -Destination $DistPath -Recurse -Force

# Step 4: Copy additional files
Write-Host "Copying additional files..." -ForegroundColor Green

# Copy README
if (Test-Path "$ProjectRoot\README.md") {
    Copy-Item -Path "$ProjectRoot\README.md" -Destination $DistPath -Force
    Write-Host "  - README.md" -ForegroundColor Gray
}

# Copy SQL scripts
$SqlPath = Join-Path $ProjectRoot "apex_sql"
if (Test-Path $SqlPath) {
    $DistSqlPath = Join-Path $DistPath "apex_sql"
    New-Item -ItemType Directory -Path $DistSqlPath -Force | Out-Null
    Copy-Item -Path "$SqlPath\*" -Destination $DistSqlPath -Force
    Write-Host "  - apex_sql folder" -ForegroundColor Gray
}

# Copy documentation
$DocsPath = Join-Path $ProjectRoot "docs"
if (Test-Path $DocsPath) {
    $DistDocsPath = Join-Path $DistPath "docs"
    New-Item -ItemType Directory -Path $DistDocsPath -Force | Out-Null
    Copy-Item -Path "$DocsPath\*" -Destination $DistDocsPath -Force
    Write-Host "  - docs folder" -ForegroundColor Gray
}

# Step 5: Create a startup instruction file
Write-Host "Creating startup instructions..." -ForegroundColor Green
$StartupInstructions = @"
# Gray's WMS WebView Application - Distribution Package

## Quick Start

1. Ensure you have .NET 8.0 Runtime installed:
   - Download from: https://dotnet.microsoft.com/download/dotnet/8.0
   - You need the ".NET Desktop Runtime" for Windows

2. Ensure WebView2 Runtime is installed:
   - Usually pre-installed on Windows 11
   - Download from: https://developer.microsoft.com/microsoft-edge/webview2/

3. Run the application:
   - Double-click WMSApp.exe

## Setup

### Configure API Connection
1. Edit config.js and update the APEX_BASE_URL
2. Point it to your Oracle APEX instance

### Setup Database
Run the SQL scripts in the apex_sql folder in order:
1. 01_tables.sql
2. 02_procedures_get.sql
3. 03_procedures_post.sql
4. 04_apex_endpoints_get.sql
5. 05_apex_endpoints_post.sql
6. 06_additional_printer_procedures.sql
7. 07_printer_management_endpoints.sql

### Configure Printers
1. Launch the application
2. Go to "Printer Setup New" menu
3. Add your printers with Oracle Fusion credentials
4. Test and set as active

## Files Included

- WMSApp.exe - Main application
- *.dll - Required libraries
- *.js, *.html, *.css - Web UI files
- apex_sql/ - Database setup scripts
- docs/ - Additional documentation

## Support

For issues or questions, refer to README.md or contact the development team.

Built on: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Configuration: $Configuration
"@

Set-Content -Path (Join-Path $DistPath "START_HERE.txt") -Value $StartupInstructions -Force
Write-Host "  - START_HERE.txt" -ForegroundColor Gray

# Step 6: Create version info
Write-Host "Creating version info..." -ForegroundColor Green
$VersionInfo = @"
Gray's WMS WebView Application
Build Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Configuration: $Configuration
.NET Version: 8.0
"@
Set-Content -Path (Join-Path $DistPath "VERSION.txt") -Value $VersionInfo -Force
Write-Host "  - VERSION.txt" -ForegroundColor Gray

# Step 7: Create ZIP archive (optional)
if ($CreateZip) {
    Write-Host ""
    Write-Host "Creating ZIP archive..." -ForegroundColor Green
    $ZipFileName = "GraysWMS_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip"
    $ZipPath = Join-Path $ProjectRoot $ZipFileName

    try {
        Compress-Archive -Path "$DistPath\*" -DestinationPath $ZipPath -Force
        Write-Host "ZIP created: $ZipFileName" -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to create ZIP: $_" -ForegroundColor Red
    }
}

# Step 8: Display summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Distribution Created Successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Location: $DistPath" -ForegroundColor Yellow
Write-Host ""
Write-Host "Contents:" -ForegroundColor White

# Count files
$FileCount = (Get-ChildItem -Path $DistPath -Recurse -File | Measure-Object).Count
$FolderCount = (Get-ChildItem -Path $DistPath -Recurse -Directory | Measure-Object).Count
$TotalSize = (Get-ChildItem -Path $DistPath -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB

Write-Host "  Files: $FileCount" -ForegroundColor Gray
Write-Host "  Folders: $FolderCount" -ForegroundColor Gray
Write-Host "  Total Size: $([math]::Round($TotalSize, 2)) MB" -ForegroundColor Gray
Write-Host ""
Write-Host "To run the application:" -ForegroundColor White
Write-Host "  cd $OutputFolder" -ForegroundColor Cyan
Write-Host "  .\WMSApp.exe" -ForegroundColor Cyan
Write-Host ""

if ($CreateZip) {
    Write-Host "ZIP archive created for distribution" -ForegroundColor Green
    Write-Host ""
}

Write-Host "Read START_HERE.txt for deployment instructions" -ForegroundColor Yellow
Write-Host ""
