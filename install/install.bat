@echo off
echo ===================================
echo  BongoFiscalBridge Installer
echo ===================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install Node.js from https://nodejs.org and re-run this installer.
    pause
    exit /b 1
)

echo Node.js found. Installing dependencies...
cd /d "%~dp0.."
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo Building application...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo Generating configuration...
node install\generate-env.js

echo Registering Windows service...
node install\setup.js

echo.
echo ===================================
echo  Installation complete!
echo  BongoFiscalBridge will start
echo  automatically on Windows boot.
echo ===================================
pause
