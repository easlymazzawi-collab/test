@echo off
chcp 65001 >nul
title Cursor Chat Studio
cd /d "%~dp0"

echo ============================================
echo   CURSOR CHAT STUDIO
echo ============================================
echo.

where git >nul 2>nul
if %errorlevel%==0 (
  if exist ".git" (
    echo Dang lay ban moi nhat tu GitHub...
    git pull
    echo.
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js.
  echo Tai tai: https://nodejs.org  ^(ban LTS^), cai xong chay lai file nay.
  pause
  exit /b
)

echo Mo trinh duyet: http://localhost:4173
echo Dong cua so nay de tat server.
echo.
node server.js
pause
