$ErrorActionPreference = "SilentlyContinue"

$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$pgData = Join-Path $rootDir "pgdata"

$listening = Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
if (!$listening) {
    $pidFile = Join-Path $pgData "postmaster.pid"
    if (Test-Path $pidFile) {
        $existingPid = (Get-Content $pidFile)[0] -as [int]
        if ($existingPid -and !(Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
            Write-Host "Removing stale postmaster.pid (PID $existingPid)..."
            Remove-Item $pidFile -Force
        }
    }
    Write-Host "Starting local PostgreSQL engine on port 5433..."
    ([wmiclass]"win32_process").Create("`"$pgBin\postgres.exe`" -D `"$pgData`"") | Out-Null
    
    $attempts = 0
    while (!$listening -and $attempts -lt 15) {
        Start-Sleep -Milliseconds 500
        $listening = Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
        $attempts++
    }
}

# Ensure database nexus_db exists with UTF-8 encoding
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 5433 -U nexus -E UTF8 --lc-collate=C --lc-ctype=C -T template0 nexus_db 2>$null

Write-Host "PostgreSQL server ready on port 5433 (nexus_db)"

