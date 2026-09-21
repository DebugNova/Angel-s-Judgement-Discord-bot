@echo off
rem Double-click: this PC will run the REAL bot (settings from .env.production).
rem Only for emergencies, when the bot on Shulker is dead. Never run both at once.
cd /d "%~dp0"
if not exist .env.production (
  echo .env.production does not exist yet. See docs\HOSTING-GUIDE.md, Part 8.
  pause
  exit /b 1
)
echo.
echo  This switches the PC to the REAL bot.
echo  Only do this if the bot on Shulker is STOPPED or DEAD.
echo.
choice /c YN /m "Switch to the REAL bot"
if errorlevel 2 exit /b 0
copy /y .env.production .env >nul
echo This PC now uses the REAL bot. To go back: double-click use-test-bot.bat
pause
