@echo off
echo ===================================
echo  BongoFiscalBridge Uninstaller
echo ===================================
echo.
cd /d "%~dp0.."
node install\uninstall.js
echo.
echo Service uninstalled.
pause
