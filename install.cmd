@echo off
rem Double-click to set up and start the library on Windows (runs install.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 pause
