$ErrorActionPreference = "SilentlyContinue"

# 1. Release ports 5188 (Vite renderer) and 8001 (Backend API)
$ports = @(5188, 8001)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $pidToKill = $conn.OwningProcess
            if ($pidToKill -gt 0) {
                $proc = Get-Process -Id $pidToKill -ErrorAction SilentlyContinue
                if ($proc -and ($proc.Name -eq "node" -or $proc.Name -eq "electron")) {
                    Write-Host "Releasing port $port (stopping stale $($proc.Name) PID $pidToKill)..."
                    Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
                }
            }
        }
    }
}

# 2. Terminate any orphaned Electron processes from Milo
$staleElectrons = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*Milo-main*' }
if ($staleElectrons) {
    foreach ($proc in $staleElectrons) {
        Write-Host "Stopping orphaned Electron process PID $($proc.ProcessId)..."
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
