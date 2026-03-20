param(
    [Parameter(Mandatory=$true)] [string]$TempDir,
    [Parameter(Mandatory=$true)] [string]$InstallDir
)

$logDir = Join-Path $InstallDir "logs"
$logFile = Join-Path $logDir "update.log"

function Write-Log {
    param([string]$msg)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Host $line
    if (!(Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Add-Content -Path $logFile -Value $line
}

$nssmExe = Join-Path $PSScriptRoot "nssm.exe"

Write-Log "=== Update started. TempDir=$TempDir InstallDir=$InstallDir ==="

# Wait for NSSM to finish its own restart cycle before we try to stop the service
Start-Sleep -Seconds 5

# 1. Stop the service
Write-Log "Stopping HopoFiscalBridge service..."
& $nssmExe stop HopoFiscalBridge 2>&1 | Out-Null

# 2. Wait for service to reach Stopped state (max 15s)
$timeout = 15
$elapsed = 0
while ($elapsed -lt $timeout) {
    $status = (Get-Service -Name HopoFiscalBridge -ErrorAction SilentlyContinue).Status
    if ($status -eq 'Stopped') { break }
    Start-Sleep -Seconds 1
    $elapsed++
}
if ($elapsed -ge $timeout) {
    Write-Log "WARNING: Service did not stop within ${timeout}s. Forcing stop."
    & $nssmExe stop HopoFiscalBridge confirm 2>&1 | Out-Null
}
Write-Log "Service stopped."

# 3. Replace dist\ and node_modules\
try {
    Write-Log "Replacing dist\..."
    Remove-Item -Path "$InstallDir\dist" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$TempDir\dist" -Destination "$InstallDir\dist" -Recurse -Force
    Write-Log "Replacing node_modules\..."
    Remove-Item -Path "$InstallDir\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$TempDir\node_modules" -Destination "$InstallDir\node_modules" -Recurse -Force
    Write-Log "Copying package.json..."
    Copy-Item -Path "$TempDir\package.json" -Destination "$InstallDir\package.json" -Force
    Write-Log "Updating install scripts..."
    if (Test-Path "$TempDir\install\update.ps1") {
        Copy-Item -Path "$TempDir\install\update.ps1" -Destination "$InstallDir\install\update.ps1" -Force
    }
    if (Test-Path "$TempDir\install\install.ps1") {
        Copy-Item -Path "$TempDir\install\install.ps1" -Destination "$InstallDir\install\install.ps1" -Force
    }
    Write-Log "Files replaced successfully."
} catch {
    Write-Log "ERROR during file copy: $_"
}

# 4. Start the service
Write-Log "Starting HopoFiscalBridge service..."
& $nssmExe start HopoFiscalBridge 2>&1 | Out-Null
Write-Log "Service start issued."

# 5. Cleanup temp dir
try {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    $zipPath = "$TempDir.zip"
    Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
    Write-Log "Temp files cleaned up."
} catch {
    Write-Log "WARNING: cleanup failed: $_"
}

Write-Log "=== Update complete ==="
