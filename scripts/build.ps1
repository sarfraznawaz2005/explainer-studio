# Type-checks, tests and packages Explainer Studio into release\win-unpacked\Explainer Studio.exe (no installer).
$ErrorActionPreference = "Stop"
Set-Location -Path (Join-Path $PSScriptRoot "..")

function Step($label, [scriptblock]$cmd) {
    Write-Host "-> $label"
    & $cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "BUILD STOPPED: $label failed (exit code $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path "node_modules")) { Step "Install dependencies (first run only)" { npm install } }
if (-not (Test-Path "build\icon.ico")) { Step "Generate icons" { npm run icon } }
Step "Type-check" { npm run typecheck }
Step "Run tests" { npm test }
Step "Build and package app (video code is pre-bundled)" { npm run pack }

Write-Host ""
Write-Host "Done. The app is in 'release\win-unpacked\Explainer Studio.exe'." -ForegroundColor Green
Write-Host "Run create-shortcut.bat to add a Desktop icon for it."
Write-Host "Run installer.bat to make 'release\ExplainerStudio-Setup-<version>.exe' and the portable zip."
