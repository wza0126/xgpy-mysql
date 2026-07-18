@echo off
chcp 65001 >nul
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
if "%1"=="" pause
