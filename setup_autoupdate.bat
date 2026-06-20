@echo off
chcp 65001 >nul
echo ========================================
echo  Rezka Subtitle Dictionary - Autoupdate
echo ========================================
echo.
PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_autoupdate.ps1"
echo.
pause
