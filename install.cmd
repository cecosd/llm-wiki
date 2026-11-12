@echo off
rem Double-click to set up the library on Windows. Opens a setup window (install.ps1); this black window closes at once.
rem   install.cmd -Silent -Yes -NoStart   runs without the window, for scripts (prints to this console)
set "ARGS=%*"
if /i "%~1"=="-Silent" goto console
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install.ps1" %*
exit /b 0
:console
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 pause
