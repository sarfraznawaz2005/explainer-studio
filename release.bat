@echo off
REM Release Explainer Studio: notes, version bump, build, push, publish on GitHub Releases.
REM Prefers PowerShell 7 (pwsh) when it is installed.
where pwsh >nul 2>&1
if %errorlevel% == 0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" %*
)
pause
