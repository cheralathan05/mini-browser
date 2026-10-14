$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$electronDir = Join-Path $rootDir "node_modules\electron"
$distDir = Join-Path $electronDir "dist"
$zipPath = Join-Path $electronDir "electron-v41.1.0-win32-x64.zip"
$pathTxt = Join-Path $electronDir "path.txt"

Write-Host "Setting up Electron in $electronDir..."

if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

$url = "https://github.com/electron/electron/releases/download/v41.1.0/electron-v41.1.0-win32-x64.zip"

Write-Host "[1/3] Downloading Electron binary with curl..."
curl.exe -L -C - --retry 5 --retry-delay 2 -o $zipPath $url

Write-Host "[2/3] Extracting Electron archive with tar..."
tar.exe -xf $zipPath -C $distDir

Write-Host "[3/3] Finalizing Electron installation..."
[System.IO.File]::WriteAllText($pathTxt, "electron.exe")

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host "SUCCESS: Electron binary installed and ready!"
