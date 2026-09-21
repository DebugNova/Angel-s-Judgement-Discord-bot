@echo off
rem Double-click to run Satan on this PC. Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"
title Satan - Seven Angels Bot
rem Guard against running the REAL bot here while it also runs on Shulker (two copies clash).
if exist .env.production fc /b .env .env.production >nul 2>&1 && goto :confirmreal
goto :run
:confirmreal
echo.
echo  WARNING: this will start the REAL bot (your .env is the real one).
echo  If the bot is running on Shulker, the two copies will clash.
echo  To test changes, double-click use-test-bot.bat first.
echo.
choice /c YN /m "Start the REAL bot on this PC anyway"
if errorlevel 2 exit /b 0
:run
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :error
)
echo Building...
call npx prisma generate || goto :error
call npm run build || goto :error
node dist\index.js
echo.
echo Satan has stopped.
pause
exit /b 0

:error
echo.
echo Setup failed. See the messages above.
pause
exit /b 1
