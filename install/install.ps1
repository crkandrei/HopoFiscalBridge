#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$InstallDir = Split-Path -Parent $PSScriptRoot

Write-Host "==================================="
Write-Host " HopoFiscalBridge Installer"
Write-Host "==================================="
Write-Host ""

# 1. Check Node.js
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "not found" }
    $major = [int]($nodeVersion -replace 'v(\d+)\..*','$1')
    if ($major -lt 18) {
        Write-Host "ERROR: Node.js v18+ required. Found: $nodeVersion"
        exit 1
    }
    Write-Host "Node.js found: $nodeVersion"
} catch {
    Write-Host "ERROR: Node.js is not installed. Install from https://nodejs.org (v18+)"
    exit 1
}

# 2. If service already exists, remove it cleanly
$existing = Get-Service -Name HopoFiscalBridge -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Existing service found. Removing..."
    & "$PSScriptRoot\nssm.exe" stop HopoFiscalBridge 2>&1 | Out-Null
    & "$PSScriptRoot\nssm.exe" remove HopoFiscalBridge confirm 2>&1 | Out-Null
    Write-Host "Existing service removed."
}

# 3. Generate .env (only if it doesn't exist yet)
Write-Host "Generating configuration..."
$generateEnvScript = Join-Path $PSScriptRoot "generate-env.js"
node $generateEnvScript
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to generate .env configuration"
    exit 1
}

# 4. Register service via NSSM
$nssmExe = "$PSScriptRoot\nssm.exe"
$nodeExe = (Get-Command node).Source
$appScript = Join-Path (Join-Path $InstallDir "dist") "app.js"

Write-Host "Registering Windows service..."
& $nssmExe install HopoFiscalBridge "$nodeExe" "$appScript"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install service (NSSM exit code: $LASTEXITCODE)"
    exit 1
}
& $nssmExe set HopoFiscalBridge AppDirectory "$InstallDir"
& $nssmExe set HopoFiscalBridge AppEnvironmentExtra "NODE_ENV=production"
& $nssmExe set HopoFiscalBridge Start SERVICE_AUTO_START

# 5. Start the service
Write-Host "Starting service..."
& $nssmExe start HopoFiscalBridge

Write-Host ""
Write-Host "==================================="
Write-Host " Installation complete!"
Write-Host " Verify: sc query HopoFiscalBridge"
Write-Host "==================================="
