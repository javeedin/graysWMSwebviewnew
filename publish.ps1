# ============================================
# Gray's WMS - Build & Publish Script
# PowerShell Version
# ============================================

param(
    [switch]$Clean,
    [switch]$SkipBuild,
    [string]$OutputDir = "publish",
    [string]$Config = "Release",
    [string]$Runtime = "win-x64"
)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Gray's WMS - Build Script v1.2.0" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Clean if requested
if ($Clean -or (Test-Path $OutputDir)) {
    Write-Host "[1/5] Cleaning previous build..." -ForegroundColor Yellow
    if (Test-Path $OutputDir) {
        Remove-Item -Recurse -Force $OutputDir
    }
    if (Test-Path "bin") {
        Remove-Item -Recurse -Force "bin"
    }
    if (Test-Path "obj") {
        Remove-Item -Recurse -Force "obj"
    }
}

# Restore packages
Write-Host "[2/5] Restoring NuGet packages..." -ForegroundColor Yellow
dotnet restore
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Package restore failed!" -ForegroundColor Red
    exit 1
}

if (-not $SkipBuild) {
    # Build the project
    Write-Host "[3/5] Building project..." -ForegroundColor Yellow
    dotnet build -c $Config
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Build failed!" -ForegroundColor Red
        exit 1
    }
}

# Publish single-file executable
Write-Host "[4/5] Publishing single-file executable..." -ForegroundColor Yellow
$publishArgs = @(
    "publish"
    "-c", $Config
    "-o", $OutputDir
    "--self-contained", "true"
    "-r", $Runtime
    "-p:PublishSingleFile=true"
    "-p:IncludeAllContentForSelfExtract=true"
    "-p:EnableCompressionInSingleFile=true"
)

dotnet @publishArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Publish failed!" -ForegroundColor Red
    exit 1
}

# Show results
Write-Host ""
Write-Host "[5/5] Verifying output..." -ForegroundColor Yellow

$exePath = Join-Path $OutputDir "GraysWMS.exe"
if (Test-Path $exePath) {
    $exeInfo = Get-Item $exePath
    $sizeMB = [math]::Round($exeInfo.Length / 1MB, 2)

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Output: $exePath" -ForegroundColor White
    Write-Host "Size: $sizeMB MB" -ForegroundColor White
    Write-Host ""
    Write-Host "Files in output folder:" -ForegroundColor Cyan
    Get-ChildItem $OutputDir | ForEach-Object {
        $size = if ($_.PSIsContainer) { "<DIR>" } else { "{0:N0} KB" -f ($_.Length / 1KB) }
        Write-Host ("  {0,-40} {1,12}" -f $_.Name, $size)
    }
    Write-Host ""
    Write-Host "NOTE: Target machine must have WebView2 Runtime installed." -ForegroundColor Yellow
    Write-Host "Download: https://developer.microsoft.com/en-us/microsoft-edge/webview2/" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "ERROR: Output file not found!" -ForegroundColor Red
    exit 1
}
