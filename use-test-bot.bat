@echo off
rem Double-click: this PC will run the TEST bot (settings from .env.test). Safe to use any time.
cd /d "%~dp0"
if not exist .env.test (
  echo .env.test does not exist yet. See docs\HOSTING-GUIDE.md, section 7.
  pause
  exit /b 1
)
copy /y .env.test .env >nul
echo This PC now uses the TEST bot. Double-click start.bat to run it.
pause
