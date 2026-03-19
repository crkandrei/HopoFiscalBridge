#Requires -RunAsAdministrator

$nssmExe = "$PSScriptRoot\nssm.exe"

Write-Host "Stopping HopoFiscalBridge service..."
& $nssmExe stop HopoFiscalBridge 2>&1 | Out-Null

Write-Host "Removing HopoFiscalBridge service..."
& $nssmExe remove HopoFiscalBridge confirm

Write-Host "Service removed."
Write-Host ""
$confirm = Read-Host "Delete installation directory? (y/N)"
if ($confirm -eq 'y' -or $confirm -eq 'Y') {
    $InstallDir = Split-Path -Parent $PSScriptRoot
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Host "Installation directory deleted."
}
