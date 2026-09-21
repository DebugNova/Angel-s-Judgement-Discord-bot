@echo off
rem Double-click to run Satan on this PC. Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"
title Satan - Seven Angels Bot
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :error
)
echo Building...
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
