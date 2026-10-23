# Adds a Desktop shortcut to the packaged app made by build.bat.
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$exePath = Join-Path $root "release\win-unpacked\Explainer Studio.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "Explainer Studio.exe not found. Run build.bat first to package the app."
    exit 1
}

$exePath = (Resolve-Path $exePath).Path
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Explainer Studio (dev build).lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = Split-Path $exePath
$shortcut.IconLocation = $exePath
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath"
