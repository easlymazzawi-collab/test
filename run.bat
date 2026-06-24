@echo off
chcp 65001 >nul
title Telegram Topic Clone Bot
echo.
echo  ============================================
echo   TELEGRAM TOPIC CLONE BOT
echo  ============================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] Chua cai Python!
    echo Tai Python tai: https://www.python.org/downloads/
    echo Nho tick "Add Python to PATH" khi cai.
    pause
    exit /b
)

python bot.py
pause
