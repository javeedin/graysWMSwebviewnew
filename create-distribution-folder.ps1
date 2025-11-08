# Create WMS distribution folder for testing
# Run this from your project directory: .\create-distribution-folder.ps1

$distFolder = "C:\fusion\fusionclientweb\wms"

Write-Host "`nCreating WMS distribution folder for testing..." -ForegroundColor Cyan
Write-Host "Location: $distFolder`n" -ForegroundColor Yellow

# Create directory
New-Item -ItemType Directory -Force -Path $distFolder | Out-Null
Write-Host "[1/2] Created directory: $distFolder" -ForegroundColor Green

# Copy files from current directory
$files = @(
    "index.html",
    "app.js",
    "monitor-printing.js",
    "printer-management-new.js",
    "distribution-manager.js",
    "update-manager.js",
    "styles.css",
    "config.js"
)

Write-Host "[2/2] Copying files..." -ForegroundColor Green

foreach ($file in $files) {
    if (Test-Path $file) {
        Copy-Item -Path $file -Destination $distFolder -Force
        Write-Host "  ✓ Copied: $file" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ Skipped (not found): $file" -ForegroundColor Yellow
    }
}

Write-Host "`n✅ Distribution folder created successfully!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Run the WMS application" -ForegroundColor White
Write-Host "2. Click the blue WMS button (after Clear Cache)" -ForegroundColor White
Write-Host "3. It should launch directly without asking to download!" -ForegroundColor White
