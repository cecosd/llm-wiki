@echo off
rem Double-click to uninstall the library on Windows. Opens a window (uninstall.ps1); this black window closes at once.
rem   uninstall.cmd -Silent -Yes                     runs without the window (removes shortcuts, site name, libraries)
rem   uninstall.cmd -Silent -Yes -DeleteEverything   also deletes this whole folder, including your library
if /i "%~1"=="-Silent" goto console
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0uninstall.ps1" %*
exit /b 0
:console
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
if errorlevel 1 pause
