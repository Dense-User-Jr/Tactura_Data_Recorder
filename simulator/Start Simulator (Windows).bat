@echo off
rem Tactura Sim launcher for Windows. Double-click to start.
rem First run installs dependencies; later runs start in a few seconds.
setlocal EnableExtensions
cd /d "%~dp0"
title Tactura Sim

echo.
echo   ooooo  ooo   ooo  ooooo o   o oooo   ooo       oooo  ooo  o   o
echo     o   o   o o   o   o   o   o o   o o   o     o       o   oo oo
echo     o   o   o o       o   o   o o   o o   o     o       o   o o o
echo     o   ooooo o       o   o   o oooo  ooooo      ooo    o   o o o
echo     o   o   o o       o   o   o o o   o   o         o   o   o   o
echo     o   o   o o   o   o   o   o o  o  o   o         o   o   o   o
echo     o   o   o  ooo    o    ooo  o   o o   o     oooo   ooo  o   o
echo.
echo   TACTURA / SIM  -  Galaxy Watch simulator
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

node -e "var v=process.versions.node.split('.').map(Number);process.exit((v[0]===20&&v[1]>=19)||(v[0]===22&&v[1]>=12)||v[0]>=23?0:1)"
if errorlevel 1 goto old_node

for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo   NODE ......... %NODE_VERSION%

node tools\ensure-deps.mjs
if errorlevel 1 goto install_failed

echo.
echo   Starting the simulator. Your browser will open automatically.
echo   Press Ctrl+C to stop the simulator.
echo.
call npx vite --open
if errorlevel 1 goto stopped
exit /b 0

:no_node
echo   Node.js was not found on this computer.
echo   Tactura Sim needs Node.js 20.19 or newer. The LTS version is best.
echo   Opening the download page now. Install it, then double-click this file again.
start "" "https://nodejs.org/en/download"
goto hold

:old_node
for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo   Node.js %NODE_VERSION% is too old. Tactura Sim needs 20.19+ or 22.12+.
echo   Opening the download page now. Install the LTS version, then double-click this file again.
start "" "https://nodejs.org/en/download"
goto hold

:install_failed
echo.
echo   ERROR: installing dependencies failed. See the messages above.
echo   Check your internet connection and try again.
goto hold

:stopped
echo.
echo   The simulator stopped. If you did not press Ctrl+C, see the messages above.
goto hold

:hold
echo.
pause
exit /b 1
